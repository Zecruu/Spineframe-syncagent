import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { AppConfig, DEFAULT_CONFIG } from '../models/config';
import { getLogger } from './logger';

const logger = getLogger('ConfigManager');
let configPath: string;
let currentConfig: AppConfig | null = null;

export function getConfigDir(): string {
  const appDataPath = process.env.APPDATA || app?.getPath('appData') || '';
  return path.join(appDataPath, 'SpineFrameSyncAgent');
}

export function initializeConfigManager(): void {
  const configDir = getConfigDir();
  configPath = path.join(configDir, 'config.json');
  
  // Ensure config directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

export function configExists(): boolean {
  initializeConfigManager();
  return fs.existsSync(configPath);
}

export function loadConfig(): AppConfig {
  initializeConfigManager();
  
  if (!fs.existsSync(configPath)) {
    logger.info('No config file found, using defaults');
    return { ...DEFAULT_CONFIG };
  }

  try {
    const rawConfig = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(rawConfig) as AppConfig;
    
    // Decrypt API key if encrypted
    if (config.api.apiKey && config.api.apiKey.startsWith('encrypted:')) {
      const encryptedBase64 = config.api.apiKey.replace('encrypted:', '');
      const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
      
      if (safeStorage.isEncryptionAvailable()) {
        config.api.apiKey = safeStorage.decryptString(encryptedBuffer);
      } else {
        logger.warn('Encryption not available, API key stored in plain text');
        config.api.apiKey = encryptedBase64;
      }
    }

    currentConfig = config;
    logger.info('Config loaded successfully');
    return config;
  } catch (error) {
    logger.error(`Failed to load config: ${error}`);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: AppConfig): void {
  initializeConfigManager();

  try {
    logger.info(`Saving config to: ${configPath}`);
    logger.info(`API Key length: ${config.api.apiKey?.length || 0}`);

    // Deep copy to avoid modifying the original config
    const configToSave: AppConfig = {
      ...config,
      api: { ...config.api },
      folders: { ...config.folders },
      behavior: { ...config.behavior },
      logging: { ...config.logging },
    };

    // Encrypt API key for storage
    if (configToSave.api.apiKey && !configToSave.api.apiKey.startsWith('encrypted:')) {
      if (safeStorage.isEncryptionAvailable()) {
        const encryptedBuffer = safeStorage.encryptString(configToSave.api.apiKey);
        configToSave.api.apiKey = `encrypted:${encryptedBuffer.toString('base64')}`;
        logger.info('API key encrypted successfully');
      } else {
        logger.warn('Encryption not available, storing API key in base64');
        configToSave.api.apiKey = `encrypted:${Buffer.from(configToSave.api.apiKey).toString('base64')}`;
      }
    }

    fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2), 'utf-8');
    currentConfig = config; // Keep the unencrypted version in memory
    logger.info(`Config saved successfully to ${configPath}`);
  } catch (error) {
    logger.error(`Failed to save config: ${error}`);
    throw error;
  }
}

export function getCurrentConfig(): AppConfig | null {
  return currentConfig;
}

export function updateConfig(updates: Partial<AppConfig>): AppConfig {
  const config = loadConfig();
  const updatedConfig = {
    ...config,
    ...updates,
    api: { ...config.api, ...updates.api },
    folders: { ...config.folders, ...updates.folders },
    behavior: { ...config.behavior, ...updates.behavior },
    logging: { ...config.logging, ...updates.logging },
  };
  saveConfig(updatedConfig);
  return updatedConfig;
}

