// Export Service - Polls SpineFrame for pending claims and writes HL7 files to ProClaim import folder
// Updated for SpineFrame v2.2.27+ queue system with confirmation flow
// Updated to support ADT^A08 patient insurance update exports

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { SpineFrameApiClient } from './apiClient';
import { AppConfig } from '../models/config';
import { ExportClaim, ExportClinicInfo, ConfirmExportResult, AdtExport, ConfirmAdtExportResult } from '../models/api';
import { generateDFTP03, generateADTA08 } from './hl7Generator';
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

  private async waitForFolderAccess(folder: string): Promise<void> {
    let attempt = 0;

    while (true) {
      attempt++;
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
          // Use longer delay after many attempts (30s after 10 attempts, 60s after 20)
          const delayMs = attempt <= 10 ? 3000 : attempt <= 20 ? 30000 : 60000;

          // Only log every few attempts after the first 10 to reduce log spam
          if (attempt <= 10 || attempt % 10 === 0) {
            logger.warn(`Export folder not accessible (attempt ${attempt}): ${folder} - waiting ${delayMs/1000}s...`);
          }

          await new Promise(resolve => setTimeout(resolve, delayMs));
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

    // Poll for DFT (claims) exports
    try {
      logger.info('Polling for pending exports...');
      const response = await this.apiClient.getPendingExports();
      logger.info(`Pending exports response: ok=${response.ok}, count=${response.count}, fetchId=${response.fetchId || 'N/A'}`);

      if (response.ok && response.count > 0) {
        // Pass fetchId for new queue confirmation system (v2.2.27+)
        await this.processExports(response.claims, response.clinic, response.fetchId);
      }
    } catch (error) {
      logger.error(`Export poll failed: ${error}`);
      this.stats.errorsToday++;
      this.addActivity('error', `Poll failed: ${(error as Error).message}`);
    }

    // Poll for ADT (patient insurance update) exports
    // Check if ADT exports are enabled (default: true)
    const adtEnabled = this.config.export?.adt?.enabled !== false;
    if (adtEnabled) {
      await this.pollForAdtExports();
    }
  }

  private async pollForAdtExports(): Promise<void> {
    try {
      const response = await this.apiClient.getPendingAdtExports();

      if (response.ok && response.count > 0) {
        logger.info(`Pending ADT exports response: ok=${response.ok}, count=${response.count}, fetchId=${response.fetchId}`);
        await this.processAdtExports(response.exports, response.fetchId);
      }
    } catch (error) {
      // Don't fail if ADT endpoint doesn't exist (older SpineFrame versions)
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('404') || errMsg.includes('Not Found')) {
        // Endpoint doesn't exist - silently skip
        logger.debug('ADT export endpoint not available (older SpineFrame version)');
      } else {
        logger.error(`ADT export poll failed: ${error}`);
        this.addActivity('error', `ADT poll failed: ${errMsg}`);
      }
    }
  }

  private async processExports(claims: ExportClaim[], clinic: ExportClinicInfo, fetchId?: string): Promise<void> {
    this.emit('status', 'exporting');
    logger.info(`Processing ${claims.length} pending exports${fetchId ? ` (fetchId: ${fetchId})` : ''}`);

    // Log claim details for debugging
    claims.forEach((claim, i) => {
      logger.info(`Claim ${i + 1} (${claim.claimId}): ${claim.billingCodes.length} billing codes`);
      logger.info(`  Patient: ${claim.patient.firstName} ${claim.patient.lastName}, DOB: ${claim.patient.dob}`);
      logger.info(`  Payer: ${claim.payer.name}, PayerID: ${claim.payer.payerId}, CoverId: ${claim.payer.coverId || 'N/A'}`);
      logger.info(`  IN1 Pre-formatted: in1_2="${claim.payer.in1_2 || 'N/A'}", in1_3="${claim.payer.in1_3 || 'N/A'}", in1_17="${claim.payer.in1_17 || 'N/A'}", in1_36="${claim.payer.in1_36 || 'N/A'}"`);
      logger.info(`  PolicyNumber: ${claim.payer.policyNumber || 'N/A'}, MemberId: ${claim.payer.memberId || 'N/A'}, Group: ${claim.payer.groupNumber || 'N/A'}`);
      claim.billingCodes.forEach((code, j) => {
        logger.info(`  Code ${j + 1}: ${code.code}, modifiers: ${JSON.stringify(code.modifiers || [])}`);
      });
    });

    // Track results for each claim (for new confirmation system)
    const results: ConfirmExportResult[] = [];
    let successCount = 0;
    let failCount = 0;

    try {
      // Process each claim individually for better error tracking
      for (const claim of claims) {
        try {
          // Generate HL7 content for this claim
          const hl7Content = generateDFTP03(claim, clinic);

          // Generate unique filename per claim
          const fileName = this.generateFileName(clinic.code, claim.claimId);
          const filePath = path.join(this.config.export!.outputFolder, fileName);

          // Write file
          fs.writeFileSync(filePath, hl7Content, 'utf-8');
          logger.info(`Wrote export file: ${fileName} for claim ${claim.claimId}`);

          results.push({
            claimId: claim.claimId,
            success: true,
            fileName,
          });
          successCount++;

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error(`Failed to export claim ${claim.claimId}: ${errorMsg}`);
          results.push({
            claimId: claim.claimId,
            success: false,
            error: errorMsg,
          });
          failCount++;
        }
      }

      // Confirm results back to SpineFrame (new queue system v2.2.27+)
      if (fetchId) {
        try {
          const confirmResponse = await this.apiClient.confirmExport(fetchId, results);
          logger.info(`Export confirmation: ${confirmResponse.message}`);

          if (confirmResponse.errors && confirmResponse.errors.length > 0) {
            confirmResponse.errors.forEach(err => {
              logger.warn(`Claim ${err.claimId} confirmation error: ${err.error}`);
            });
          }
        } catch (confirmError) {
          // Log but don't fail - claims are already written locally
          logger.error(`Failed to confirm export with SpineFrame: ${confirmError}`);
          this.addActivity('error', `Confirmation failed (files written locally): ${(confirmError as Error).message}`);
        }
      } else {
        // Fallback: Use legacy markExported for older SpineFrame versions
        if (successCount > 0) {
          const successfulClaimIds = results.filter(r => r.success).map(r => r.claimId);
          const anyFileName = results.find(r => r.success)?.fileName || 'unknown';
          await this.apiClient.markExported(successfulClaimIds, anyFileName, this.config.export!.format);
        }
      }

      // Update stats
      this.stats.exportedToday += successCount;
      this.stats.errorsToday += failCount;
      if (successCount > 0) {
        this.stats.lastExportAt = new Date();
      }

      if (successCount > 0) {
        this.addActivity('success', `Exported ${successCount} claim(s)${failCount > 0 ? `, ${failCount} failed` : ''}`);
      }
      if (failCount > 0 && successCount === 0) {
        this.addActivity('error', `All ${failCount} claims failed to export`);
      }

      this.emit('exported', { count: successCount, failed: failCount });
      this.emit('stats-updated', this.stats);

    } catch (error) {
      this.stats.errorsToday++;
      logger.error(`Export processing failed: ${error}`);
      this.addActivity('error', `Export failed: ${(error as Error).message}`);
    } finally {
      this.emit('status', 'idle');
    }
  }

  private generateFileName(clinicCode: string, claimId?: string): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
    // Add claim suffix for unique per-claim files
    const claimSuffix = claimId ? `_${claimId.substring(claimId.length - 6)}` : '';
    const pattern = this.config.export?.fileNamePattern || 'DFT_{clinicCode}_{timestamp}.hl7';
    return pattern
      .replace('{clinicCode}', clinicCode)
      .replace('{timestamp}', timestamp)
      .replace('.hl7', `${claimSuffix}.hl7`);
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

  /**
   * Process ADT^A08 exports for patient insurance updates
   */
  private async processAdtExports(exports: AdtExport[], fetchId: string): Promise<void> {
    this.emit('status', 'exporting');
    logger.info(`Processing ${exports.length} pending ADT exports (fetchId: ${fetchId})`);

    const results: ConfirmAdtExportResult[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const adtExport of exports) {
      try {
        // Validate: proclaimPatientRecord is required
        if (!adtExport.patient.proclaimPatientRecord) {
          throw new Error('Missing proclaimPatientRecord - patient does not exist in ProClaim');
        }

        // Log details
        logger.info(`ADT Export (${adtExport.queueId}): Patient ${adtExport.patient.proclaimPatientRecord} - ${adtExport.patient.lastName}, ${adtExport.patient.firstName}`);
        logger.info(`  Trigger: ${adtExport.trigger}, Insurance count: ${adtExport.insurance.length}`);
        adtExport.insurance.forEach((ins, i) => {
          logger.info(`  Insurance ${i + 1}: ${ins.provider}, PayerID: ${ins.payerId}, CoverId: ${ins.coverId || 'N/A'}, MemberId: ${ins.memberId}`);
        });

        // Generate ADT^A08 message
        const clinicCode = this.config.api.clinicId;
        const emrLinkType = this.config.export?.emrLinkType || 'EMD85';
        const hl7Content = generateADTA08(adtExport, clinicCode, emrLinkType);

        // Generate filename
        const fileName = this.generateAdtFileName(adtExport.patient.proclaimPatientRecord);
        const filePath = path.join(this.config.export!.outputFolder, fileName);

        // Write file
        fs.writeFileSync(filePath, hl7Content, 'utf-8');
        logger.info(`Wrote ADT export file: ${fileName} for patient ${adtExport.patient.proclaimPatientRecord}`);

        results.push({
          queueId: adtExport.queueId,
          success: true,
          fileName,
        });
        successCount++;
        this.stats.exportedToday++;

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to export ADT for queue ${adtExport.queueId}: ${errorMsg}`);
        results.push({
          queueId: adtExport.queueId,
          success: false,
          error: errorMsg,
        });
        failCount++;
        this.stats.errorsToday++;
      }
    }

    // Confirm results back to SpineFrame
    try {
      const confirmResponse = await this.apiClient.confirmAdtExport(fetchId, results);
      logger.info(`ADT Export confirmation: ${confirmResponse.message}`);

      if (confirmResponse.errors && confirmResponse.errors.length > 0) {
        confirmResponse.errors.forEach(err => {
          logger.warn(`ADT queue ${err.queueId} confirmation error: ${err.error}`);
        });
      }
    } catch (confirmError) {
      logger.error(`Failed to confirm ADT export with SpineFrame: ${confirmError}`);
      this.addActivity('error', `ADT confirmation failed (files written locally): ${(confirmError as Error).message}`);
    }

    // Update stats
    if (successCount > 0) {
      this.stats.lastExportAt = new Date();
      this.addActivity('success', `Exported ${successCount} ADT update(s)${failCount > 0 ? `, ${failCount} failed` : ''}`);
    }
    if (failCount > 0 && successCount === 0) {
      this.addActivity('error', `All ${failCount} ADT exports failed`);
    }

    this.emit('exported', { count: successCount, failed: failCount, type: 'ADT' });
    this.emit('stats-updated', this.stats);
    this.emit('status', 'idle');
  }

  /**
   * Generate filename for ADT^A08 files
   */
  private generateAdtFileName(proclaimPatientRecord: string): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
    return `ADT_A08_${proclaimPatientRecord}_${timestamp}.hl7`;
  }
}
