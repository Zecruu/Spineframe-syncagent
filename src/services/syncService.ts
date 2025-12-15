import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { FileWatcherService, FileEvent } from './fileWatcher';
import { SpineFrameApiClient } from './apiClient';
import { parseHL7, parsePatientFromADT, parseEncounterFromDFT, parseNoteFromORU, splitHL7Batch } from './hl7Parser';
import { AppConfig } from '../models/config';
import { getLogger } from './logger';

const logger = getLogger('SyncService');

export interface SyncStats {
  syncedToday: number;
  pending: number;
  errorsToday: number;
  lastSyncAt: Date | null;
}

export interface SyncActivityItem {
  timestamp: Date;
  type: 'success' | 'error' | 'info';
  message: string;
  fileName?: string;
}

export class SyncService extends EventEmitter {
  private fileWatcher: FileWatcherService | null = null;
  private apiClient: SpineFrameApiClient;
  private config: AppConfig;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private stats: SyncStats = {
    syncedToday: 0,
    pending: 0,
    errorsToday: 0,
    lastSyncAt: null,
  };
  private activityLog: SyncActivityItem[] = [];
  private retryCount: Map<string, number> = new Map();
  private isPaused: boolean = false;

  constructor(config: AppConfig, apiClient: SpineFrameApiClient) {
    super();
    this.config = config;
    this.apiClient = apiClient;
  }

  async start(): Promise<void> {
    if (!this.config.folders.watch) {
      throw new Error('Watch folder not configured');
    }

    // Ensure processed/failed folders exist
    this.ensureFoldersExist();

    // Initialize file watcher
    this.fileWatcher = new FileWatcherService(this.config.folders.watch);
    
    this.fileWatcher.on('file-processing', (event: FileEvent) => {
      this.processFile(event);
    });

    this.fileWatcher.on('file-queued', () => {
      this.updatePendingCount();
    });

    this.fileWatcher.on('error', (error) => {
      this.addActivity('error', `File watcher error: ${error.message}`);
    });

    await this.fileWatcher.start();

    // Start heartbeat
    this.startHeartbeat();

    logger.info('Sync service started');
    this.emit('started');
  }

  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.fileWatcher) {
      await this.fileWatcher.stop();
      this.fileWatcher = null;
    }

    logger.info('Sync service stopped');
    this.emit('stopped');
  }

  pause(): void {
    this.isPaused = true;
    this.emit('paused');
    logger.info('Sync service paused');
  }

  resume(): void {
    this.isPaused = false;
    this.emit('resumed');
    logger.info('Sync service resumed');
  }

  isPausedState(): boolean {
    return this.isPaused;
  }

  private ensureFoldersExist(): void {
    const folders = [
      this.config.folders.processed,
      this.config.folders.failed,
    ];

    for (const folder of folders) {
      if (folder && !fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
        logger.info(`Created folder: ${folder}`);
      }
    }
  }

  private startHeartbeat(): void {
    const intervalMs = this.config.behavior.syncIntervalSeconds * 1000;
    
    // Send initial heartbeat
    this.sendHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, intervalMs);
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      const pendingCount = this.fileWatcher?.getPendingCount() || 0;
      await this.apiClient.sendHeartbeat(pendingCount);
      this.emit('heartbeat-sent');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Heartbeat failed: ${errorMessage}`);

      // Check for specific error types
      if (errorMessage.includes('No API key configured')) {
        this.addActivity('error', 'No API key configured. Please reconfigure in Settings.');
        this.emit('credentials-invalid', error);
      } else if (errorMessage.includes('401') || errorMessage.includes('Invalid')) {
        this.addActivity('error', 'Invalid API credentials. Please reconfigure in Settings.');
        this.emit('credentials-invalid', error);
      } else {
        this.emit('heartbeat-failed', error);
      }
    }
  }

  private async processFile(event: FileEvent): Promise<void> {
    if (this.isPaused) {
      logger.info(`Skipping file (paused): ${event.fileName}`);
      return;
    }

    this.emit('status', 'syncing');
    logger.info(`Processing file: ${event.fileName}`);

    try {
      const content = fs.readFileSync(event.filePath, 'utf-8');
      const messages = splitHL7Batch(content);

      for (const msgContent of messages) {
        await this.processHL7Message(msgContent, event.fileName);
      }

      // Success - handle file disposition
      await this.handleSuccessfulFile(event.filePath);
      
      this.stats.syncedToday++;
      this.stats.lastSyncAt = new Date();
      this.apiClient.setLastSyncAt(this.stats.lastSyncAt.toISOString());
      
      this.addActivity('success', `File processed successfully`, event.fileName);
      this.emit('file-synced', event);
      
    } catch (error) {
      await this.handleFailedFile(event.filePath, error as Error);
    } finally {
      this.updatePendingCount();
      this.emit('status', 'idle');
    }
  }

  private async processHL7Message(content: string, fileName: string): Promise<void> {
    const message = parseHL7(content);
    logger.info(`Processing ${message.messageType} message from ${fileName}`);

    switch (message.messageType) {
      case 'ADT^A04':
      case 'ADT^A08':
      case 'ADT^A31': {
        const patient = parsePatientFromADT(message);
        if (patient) {
          await this.apiClient.upsertPatient({
            externalSystem: 'ProClaim',
            ...patient,
          });
        }
        break;
      }
      case 'DFT^P03': {
        const encounter = parseEncounterFromDFT(message);
        if (encounter) {
          await this.apiClient.createEncounterCharge({
            externalSystem: 'ProClaim',
            ...encounter,
          });
        }
        break;
      }
      case 'ORU^R01': {
        const note = parseNoteFromORU(message);
        if (note) {
          await this.apiClient.createNote({
            externalSystem: 'ProClaim',
            ...note,
          });
        }
        break;
      }
      default:
        logger.warn(`Unknown message type: ${message.messageType}, skipping`);
        this.addActivity('info', `Skipped unknown message type: ${message.messageType}`, fileName);
    }
  }

  private async handleSuccessfulFile(filePath: string): Promise<void> {
    const fileName = path.basename(filePath);
    this.retryCount.delete(filePath);

    if (this.config.behavior.deleteAfterSync) {
      fs.unlinkSync(filePath);
      logger.info(`Deleted file: ${fileName}`);
    } else if (this.config.behavior.moveToProcessed && this.config.folders.processed) {
      const destPath = path.join(this.config.folders.processed, fileName);
      fs.renameSync(filePath, destPath);
      logger.info(`Moved file to processed: ${fileName}`);
    }
  }

  private async handleFailedFile(filePath: string, error: Error): Promise<void> {
    const fileName = path.basename(filePath);
    const currentRetries = this.retryCount.get(filePath) || 0;

    this.stats.errorsToday++;
    logger.error(`Failed to process ${fileName}: ${error.message}`);

    if (currentRetries < this.config.behavior.maxRetries) {
      this.retryCount.set(filePath, currentRetries + 1);
      this.addActivity('error', `Failed (retry ${currentRetries + 1}/${this.config.behavior.maxRetries}): ${error.message}`, fileName);

      // Re-queue for retry after delay
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          this.fileWatcher?.emit('file-processing', { filePath, fileName, createdAt: new Date() });
        }
      }, 5000);
    } else {
      // Max retries reached, move to failed folder
      this.retryCount.delete(filePath);
      this.addActivity('error', `Failed permanently: ${error.message}`, fileName);

      if (this.config.folders.failed) {
        const destPath = path.join(this.config.folders.failed, fileName);
        fs.renameSync(filePath, destPath);
        logger.info(`Moved file to failed: ${fileName}`);
      }

      this.emit('file-failed', { filePath, error });
    }
  }

  private updatePendingCount(): void {
    this.stats.pending = this.fileWatcher?.getPendingCount() || 0;
    this.emit('stats-updated', this.stats);
  }

  private addActivity(type: SyncActivityItem['type'], message: string, fileName?: string): void {
    const item: SyncActivityItem = {
      timestamp: new Date(),
      type,
      message,
      fileName,
    };

    this.activityLog.unshift(item);
    // Keep only last 100 items
    if (this.activityLog.length > 100) {
      this.activityLog = this.activityLog.slice(0, 100);
    }

    this.emit('activity', item);
  }

  getStats(): SyncStats {
    return { ...this.stats };
  }

  getActivityLog(): SyncActivityItem[] {
    return [...this.activityLog];
  }

  async syncNow(): Promise<void> {
    logger.info('Manual sync triggered');
    this.addActivity('info', 'Manual sync triggered');
    // Re-scan watch folder
    if (this.fileWatcher) {
      await this.fileWatcher.stop();
      await this.fileWatcher.start();
    }
  }

  updateConfig(config: AppConfig, apiClient?: SpineFrameApiClient): void {
    this.config = config;
    if (apiClient) {
      this.apiClient = apiClient;
    }
  }
}
