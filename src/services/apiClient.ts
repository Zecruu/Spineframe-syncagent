import axios, { AxiosInstance, AxiosError } from 'axios';
import os from 'os';
import {
  HeartbeatRequest,
  HeartbeatResponse,
  PatientUpsertRequest,
  PatientUpsertResponse,
  EncounterChargeRequest,
  EncounterChargeResponse,
  NoteRequest,
  NoteResponse,
  StatusResponse,
  ApiErrorResponse,
  PendingExportsResponse,
  MarkExportedRequest,
  MarkExportedResponse,
} from '../models/api';
import { AppConfig } from '../models/config';
import { getLogger, maskApiKey } from './logger';

const logger = getLogger('APIClient');
const AGENT_VERSION = '1.0.0';

export class SpineFrameApiClient {
  private client: AxiosInstance;
  private config: AppConfig;
  private lastSyncAt: string | null = null;

  constructor(config: AppConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.api.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.api.apiKey}`,
        'X-Clinic-Id': config.api.clinicId,
        'X-Agent-Version': AGENT_VERSION,
        'X-Agent-Hostname': os.hostname(),
      },
    });

    // Request interceptor for logging
    this.client.interceptors.request.use((request) => {
      logger.debug(`API Request: ${request.method?.toUpperCase()} ${request.url}`);
      return request;
    });

    // Response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`API Response: ${response.status} ${response.statusText}`);
        return response;
      },
      (error: AxiosError) => {
        const status = error.response?.status || 'N/A';
        const data = error.response?.data as ApiErrorResponse | undefined;
        logger.error(`API Error: ${status} - ${data?.error || error.message}`);
        return Promise.reject(error);
      }
    );
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
    this.client.defaults.baseURL = config.api.baseUrl;
    this.client.defaults.headers['Authorization'] = `Bearer ${config.api.apiKey}`;
    this.client.defaults.headers['X-Clinic-Id'] = config.api.clinicId;
  }

  setLastSyncAt(dateTime: string): void {
    this.lastSyncAt = dateTime;
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await this.getStatus();
      if (response.ok) {
        return { ok: true, message: 'Connection successful!' };
      }
      return { ok: false, message: 'Connection failed: Invalid response' };
    } catch (error) {
      const axiosError = error as AxiosError<ApiErrorResponse>;
      const message = axiosError.response?.data?.error || axiosError.message;
      return { ok: false, message: `Connection failed: ${message}` };
    }
  }

  async sendHeartbeat(pendingFiles: number): Promise<HeartbeatResponse> {
    const request: HeartbeatRequest = {
      agentVersion: AGENT_VERSION,
      hostname: os.hostname(),
      osUser: os.userInfo().username,
      watchFolder: this.config.folders.watch,
      pendingFiles,
      lastSyncAt: this.lastSyncAt,
    };

    const response = await this.client.post<HeartbeatResponse>('/api/hl7/agent-heartbeat', request);
    logger.info(`Heartbeat sent - ${response.data.message}`);
    return response.data;
  }

  async upsertPatient(patient: PatientUpsertRequest): Promise<PatientUpsertResponse> {
    const response = await this.client.post<PatientUpsertResponse>('/api/hl7/patient-upsert', patient);
    logger.info(`Patient ${patient.externalId} ${response.data.created ? 'created' : 'updated'}`);
    return response.data;
  }

  async createEncounterCharge(encounter: EncounterChargeRequest): Promise<EncounterChargeResponse> {
    const response = await this.client.post<EncounterChargeResponse>('/api/hl7/encounter-charge', encounter);
    logger.info(`Encounter ${encounter.visitExternalId} ${response.data.created ? 'created' : 'updated'}`);
    return response.data;
  }

  async createNote(note: NoteRequest): Promise<NoteResponse> {
    const response = await this.client.post<NoteResponse>('/api/hl7/note', note);
    logger.info(`Note created for patient ${note.patientExternalId}`);
    return response.data;
  }

  async getStatus(): Promise<StatusResponse> {
    const response = await this.client.get<StatusResponse>('/api/hl7/status');
    return response.data;
  }

  // Export endpoints (SpineFrame → ProClaim)
  async getPendingExports(): Promise<PendingExportsResponse> {
    const response = await this.client.get<PendingExportsResponse>('/api/hl7/pending-exports');
    if (response.data.count > 0) {
      logger.info(`Retrieved ${response.data.count} pending exports`);
    }
    return response.data;
  }

  async markExported(claimIds: string[], fileName: string, format: string): Promise<MarkExportedResponse> {
    const request: MarkExportedRequest = {
      claimIds,
      fileName,
      format,
      hostname: os.hostname(),
    };
    const response = await this.client.post<MarkExportedResponse>('/api/hl7/mark-exported', request);
    logger.info(`Marked ${response.data.markedCount} claims as exported`);
    return response.data;
  }
}

let apiClientInstance: SpineFrameApiClient | null = null;

export function initializeApiClient(config: AppConfig): SpineFrameApiClient {
  apiClientInstance = new SpineFrameApiClient(config);
  logger.info(`API Client initialized - ${config.api.baseUrl}, Clinic: ${config.api.clinicId}`);
  return apiClientInstance;
}

export function getApiClient(): SpineFrameApiClient | null {
  return apiClientInstance;
}

