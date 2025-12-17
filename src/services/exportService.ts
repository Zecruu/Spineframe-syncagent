// Export Service - Polls SpineFrame for pending claims and writes HL7 files to ProClaim import folder

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { SpineFrameApiClient } from './apiClient';
import { AppConfig } from '../models/config';
import { ExportClaim, ExportClinicInfo } from '../models/api';
import { generateDFTP03 } from './hl7Generator';
import { getLogger } from './logger';

const logger = getLogger('ExportService');

export interface ExportStats {
  exportedToday: number;
  lastExportAt: Date | null;
  errorsToday: number;
}

export interface ExportActivityItem {
  timestamp: Date;
  type: 'success' | 'error' | 'info';
  message: string;
  fileName?: string;
}

export class ExportService extends EventEmitter {
  private apiClient: SpineFrameApiClient;
  private config: AppConfig;
  private pollInterval: NodeJS.Timeout | null = null;
  private stats: ExportStats = {
    exportedToday: 0,
    lastExportAt: null,
    errorsToday: 0,
  };
  private activityLog: ExportActivityItem[] = [];
  private isPaused: boolean = false;

  constructor(config: AppConfig, apiClient: SpineFrameApiClient) {
    super();
    this.config = config;
    this.apiClient = apiClient;
  }

  async start(): Promise<void> {
    logger.info(`ExportService.start() called - enabled=${this.config.export?.enabled}, outputFolder=${this.config.export?.outputFolder || 'NOT SET'}`);

    if (!this.config.export?.enabled) {
      logger.info('Export service disabled - export.enabled is false');
      return;
    }

    if (!this.config.export.outputFolder) {
      logger.warn('Export output folder not configured - export.outputFolder is empty');
      return;
    }

    // Ensure output folder exists (with retry for cloud drives like Google Drive)
    await this.waitForFolderAccess(this.config.export.outputFolder);

    // Start polling
    const intervalMs = (this.config.export?.pollIntervalSeconds || 30) * 1000;
    logger.info(`Starting export polling every ${intervalMs / 1000} seconds`);
    this.startPolling();
    logger.info('Export service started successfully');
    this.emit('started');
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    logger.info('Export service stopped');
    this.emit('stopped');
  }

  private async waitForFolderAccess(folder: string, maxRetries: number = 10, delayMs: number = 3000): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (fs.existsSync(folder)) {
          logger.info(`Export folder accessible: ${folder}`);
          return;
        }
        fs.mkdirSync(folder, { recursive: true });
        logger.info(`Created export folder: ${folder}`);
        return;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (errMsg.includes('ENOENT') || errMsg.includes('EACCES') || errMsg.includes('EPERM')) {
          logger.warn(`Export folder not accessible (attempt ${attempt}/${maxRetries}): ${folder}`);
          if (attempt < maxRetries) {
            logger.info(`Waiting ${delayMs/1000}s for cloud drive to mount...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          } else {
            throw new Error(`Export folder not accessible after ${maxRetries} attempts: ${folder}`);
          }
        } else {
          throw error;
        }
      }
    }
  }

  pause(): void {
    this.isPaused = true;
    this.emit('paused');
  }

  resume(): void {
    this.isPaused = false;
    this.emit('resumed');
  }

  private startPolling(): void {
    const intervalMs = (this.config.export?.pollIntervalSeconds || 30) * 1000;
    
    // Initial poll
    this.pollForExports();

    this.pollInterval = setInterval(() => {
      this.pollForExports();
    }, intervalMs);
  }

  private async pollForExports(): Promise<void> {
    if (this.isPaused) {
      logger.info('Export poll skipped - service is paused');
      return;
    }

    try {
      logger.info('Polling for pending exports...');
      const response = await this.apiClient.getPendingExports();
      logger.info(`Pending exports response: ok=${response.ok}, count=${response.count}`);

      if (response.ok && response.count > 0) {
        await this.processExports(response.claims, response.clinic);
      }
    } catch (error) {
      logger.error(`Export poll failed: ${error}`);
      this.stats.errorsToday++;
      this.addActivity('error', `Poll failed: ${(error as Error).message}`);
    }
  }

  private async processExports(claims: ExportClaim[], clinic: ExportClinicInfo): Promise<void> {
    this.emit('status', 'exporting');
    logger.info(`Processing ${claims.length} pending exports`);

    // Log billing codes and modifiers for debugging
    claims.forEach((claim, i) => {
      logger.info(`Claim ${i + 1} (${claim.claimId}): ${claim.billingCodes.length} billing codes`);
      claim.billingCodes.forEach((code, j) => {
        logger.info(`  Code ${j + 1}: ${code.code}, modifiers: ${JSON.stringify(code.modifiers || [])}`);
      });
    });

    try {
      // Generate HL7 content for all claims
      const hl7Messages = claims.map(claim => generateDFTP03(claim, clinic));
      const hl7Content = hl7Messages.join('\r\n');

      // Generate filename
      const fileName = this.generateFileName(clinic.code);
      const filePath = path.join(this.config.export!.outputFolder, fileName);

      // Write file
      fs.writeFileSync(filePath, hl7Content, 'utf-8');
      logger.info(`Wrote export file: ${fileName}`);

      // Mark claims as exported
      const claimIds = claims.map(c => c.claimId);
      await this.apiClient.markExported(claimIds, fileName, this.config.export!.format);

      // Update stats
      this.stats.exportedToday += claims.length;
      this.stats.lastExportAt = new Date();
      
      this.addActivity('success', `Exported ${claims.length} claim(s)`, fileName);
      this.emit('exported', { count: claims.length, fileName });
      this.emit('stats-updated', this.stats);

    } catch (error) {
      this.stats.errorsToday++;
      logger.error(`Export processing failed: ${error}`);
      this.addActivity('error', `Export failed: ${(error as Error).message}`);
    } finally {
      this.emit('status', 'idle');
    }
  }

  private generateFileName(clinicCode: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const pattern = this.config.export?.fileNamePattern || 'DFT_{clinicCode}_{timestamp}.hl7';
    return pattern
      .replace('{clinicCode}', clinicCode)
      .replace('{timestamp}', timestamp);
  }

  private addActivity(type: ExportActivityItem['type'], message: string, fileName?: string): void {
    const item: ExportActivityItem = { timestamp: new Date(), type, message, fileName };
    this.activityLog.unshift(item);
    if (this.activityLog.length > 50) {
      this.activityLog = this.activityLog.slice(0, 50);
    }
    this.emit('activity', item);
  }

  getStats(): ExportStats {
    return { ...this.stats };
  }

  getActivityLog(): ExportActivityItem[] {
    return [...this.activityLog];
  }

  updateConfig(config: AppConfig, apiClient?: SpineFrameApiClient): void {
    this.config = config;
    if (apiClient) {
      this.apiClient = apiClient;
    }
  }
}

