// Configuration types for SpineFrame Sync Agent

export interface ApiConfig {
  baseUrl: string;
  clinicId: string;
  apiKey: string; // Stored encrypted
}

export interface FoldersConfig {
  watch: string;
  processed: string;
  failed: string;
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

export interface ExportConfig {
  enabled: boolean;
  pollIntervalSeconds: number;
  outputFolder: string;
  format: 'hl7' | 'x12' | 'csv' | 'json';
  fileNamePattern: string;
}

export interface AppConfig {
  version: string;
  api: ApiConfig;
  folders: FoldersConfig;
  behavior: BehaviorConfig;
  logging: LoggingConfig;
  export: ExportConfig;
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
  },
  export: {
    enabled: false,
    pollIntervalSeconds: 30,
    outputFolder: '',
    format: 'hl7',
    fileNamePattern: 'DFT_{clinicCode}_{timestamp}.hl7'
  }
};

