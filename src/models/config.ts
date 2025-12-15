// Configuration types for SpineFrame Sync Agent

export interface ApiConfig {
  baseUrl: string;
  clinicId: string;
  apiKey: string; // Stored encrypted
}

export interface FoldersConfig {
  watch: string;      // Google Drive folder (input) - where SpineFrame exports HL7 files
  proclaim: string;   // ProClaim folder (output) - where files are copied for ProClaim to import
  processed: string;  // Optional: where to move files after successful copy
  failed: string;     // Optional: where to move files that fail to copy
}

export interface BehaviorConfig {
  autoStart: boolean;
  syncIntervalSeconds: number;
  maxRetries: number;
  deleteAfterSync: boolean;
  moveToProcessed: boolean;
  showNotifications: boolean;
  minimizeToTray: boolean;
}

export interface LoggingConfig {
  level: 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG';
  maxFileSizeMB: number;
  retentionDays: number;
}

export interface AppConfig {
  version: string;
  api: ApiConfig;
  folders: FoldersConfig;
  behavior: BehaviorConfig;
  logging: LoggingConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
  version: '1.0',
  api: {
    baseUrl: 'https://app.spineframe.com',
    clinicId: '',
    apiKey: ''
  },
  folders: {
    watch: '',
    proclaim: '',
    processed: '',
    failed: ''
  },
  behavior: {
    autoStart: true,
    syncIntervalSeconds: 60,
    maxRetries: 3,
    deleteAfterSync: false,
    moveToProcessed: true,
    showNotifications: true,
    minimizeToTray: true
  },
  logging: {
    level: 'INFO',
    maxFileSizeMB: 10,
    retentionDays: 7
  }
};

