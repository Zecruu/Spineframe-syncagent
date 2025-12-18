import chokidar, { FSWatcher } from 'chokidar';
import fs from 'fs';
import path from 'path';
import { getLogger } from './logger';
import { EventEmitter } from 'events';

const logger = getLogger('FileWatcher');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEBOUNCE_MS = 500;
const VALID_EXTENSIONS = ['.hl7', '.HL7', '.txt'];

export interface FileEvent {
  filePath: string;
  fileName: string;
  createdAt: Date;
}

// Callback type for file processing
export type FileProcessCallback = (event: FileEvent) => Promise<void>;

export class FileWatcherService extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private watchFolder: string;
  private pendingFiles: Map<string, NodeJS.Timeout> = new Map();
  private processingQueue: FileEvent[] = [];
  private isProcessing: boolean = false;
  private processedFiles: Set<string> = new Set(); // Track processed files to avoid duplicates
  private fileProcessCallback: FileProcessCallback | null = null;

  constructor(watchFolder: string) {
    super();
    this.watchFolder = watchFolder;
  }

  // Set callback for file processing (allows waiting for completion)
  setFileProcessCallback(callback: FileProcessCallback): void {
    this.fileProcessCallback = callback;
  }

  async start(): Promise<void> {
    if (this.watcher) {
      await this.stop();
    }

    if (!fs.existsSync(this.watchFolder)) {
      logger.error(`Watch folder does not exist: ${this.watchFolder}`);
      throw new Error(`Watch folder does not exist: ${this.watchFolder}`);
    }

    logger.info(`Starting file watcher on: ${this.watchFolder}`);

    this.watcher = chokidar.watch(this.watchFolder, {
      ignored: /(^|[\/\\])\../, // Ignore hidden files
      persistent: true,
      ignoreInitial: false, // Process existing files on startup
      awaitWriteFinish: {
        stabilityThreshold: DEBOUNCE_MS,
        pollInterval: 100,
      },
      depth: 0, // Only watch root folder, not subfolders
    });

    this.watcher.on('add', (filePath) => this.onFileAdded(filePath));
    this.watcher.on('error', (error: unknown) => {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`File watcher error: ${errMsg}`);
      this.emit('error', error);
    });

    logger.info('File watcher started successfully');
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      logger.info('File watcher stopped');
    }

    // Clear pending debounce timers
    for (const timeout of this.pendingFiles.values()) {
      clearTimeout(timeout);
    }
    this.pendingFiles.clear();
  }

  private onFileAdded(filePath: string): void {
    const ext = path.extname(filePath).toLowerCase();

    // Only process valid extensions
    if (!VALID_EXTENSIONS.some(e => e.toLowerCase() === ext)) {
      logger.debug(`Ignoring non-HL7 file: ${filePath}`);
      return;
    }

    // Skip if already processed (chokidar can fire multiple events for same file)
    if (this.processedFiles.has(filePath)) {
      logger.debug(`File already processed, skipping: ${filePath}`);
      return;
    }

    const fileName = path.basename(filePath);
    logger.info(`New file detected: ${fileName}`);

    // Debounce - wait for file to be fully written
    if (this.pendingFiles.has(filePath)) {
      clearTimeout(this.pendingFiles.get(filePath)!);
    }

    const timeout = setTimeout(() => {
      this.pendingFiles.delete(filePath);
      this.validateAndQueueFile(filePath);
    }, DEBOUNCE_MS);

    this.pendingFiles.set(filePath, timeout);
  }

  private async validateAndQueueFile(filePath: string): Promise<void> {
    try {
      // Check if file still exists
      if (!fs.existsSync(filePath)) {
        logger.warn(`File no longer exists: ${filePath}`);
        return;
      }

      // Check file size
      const stats = fs.statSync(filePath);
      if (stats.size > MAX_FILE_SIZE) {
        logger.warn(`File too large (${stats.size} bytes), skipping: ${filePath}`);
        this.emit('file-rejected', { filePath, reason: 'File exceeds 10MB limit' });
        return;
      }

      // Check if file is locked (being written)
      const isLocked = await this.isFileLocked(filePath);
      if (isLocked) {
        logger.warn(`File is locked, will retry: ${filePath}`);
        // Retry after a short delay
        setTimeout(() => this.validateAndQueueFile(filePath), 1000);
        return;
      }

      const fileEvent: FileEvent = {
        filePath,
        fileName: path.basename(filePath),
        createdAt: stats.birthtime,
      };

      this.processingQueue.push(fileEvent);
      // Sort by creation time (oldest first)
      this.processingQueue.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      
      logger.info(`File queued for processing: ${fileEvent.fileName}`);
      this.emit('file-queued', fileEvent);
      
      this.processNextFile();
    } catch (error) {
      logger.error(`Error validating file ${filePath}: ${error}`);
    }
  }

  private async isFileLocked(filePath: string): Promise<boolean> {
    try {
      const fd = fs.openSync(filePath, 'r+');
      fs.closeSync(fd);
      return false;
    } catch {
      return true;
    }
  }

  private async processNextFile(): Promise<void> {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const fileEvent = this.processingQueue.shift()!;

    try {
      // Mark as processed to prevent duplicate processing
      this.processedFiles.add(fileEvent.filePath);

      // If callback is set, use it and wait for completion
      if (this.fileProcessCallback) {
        logger.info(`Processing file via callback: ${fileEvent.fileName}`);
        await this.fileProcessCallback(fileEvent);
      } else {
        // Fallback to event emission (but can't wait for completion)
        this.emit('file-processing', fileEvent);
      }
    } catch (error) {
      logger.error(`Error processing file ${fileEvent.fileName}: ${error}`);
      // Remove from processed set so it can be retried
      this.processedFiles.delete(fileEvent.filePath);
    } finally {
      this.isProcessing = false;
      // Process next file if any
      if (this.processingQueue.length > 0) {
        logger.info(`Queue has ${this.processingQueue.length} more files, processing next...`);
        setImmediate(() => this.processNextFile());
      }
    }
  }

  // Clear processed files tracking (useful when files are moved/deleted)
  clearProcessedFile(filePath: string): void {
    this.processedFiles.delete(filePath);
  }

  getPendingCount(): number {
    return this.processingQueue.length + this.pendingFiles.size;
  }

  getWatchFolder(): string {
    return this.watchFolder;
  }

  setWatchFolder(folder: string): void {
    this.watchFolder = folder;
  }
}

