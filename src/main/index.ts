import { app, BrowserWindow, ipcMain, shell, Notification } from 'electron';
import path from 'path';
import { initializeLogger, getLogger } from '../services/logger';
import { loadConfig, saveConfig, configExists, getConfigDir } from '../services/configManager';
import { initializeApiClient, getApiClient } from '../services/apiClient';
import { SyncService, SyncStats, SyncActivityItem } from '../services/syncService';
import { TrayManager } from './tray';
import { AppConfig } from '../models/config';
import { setAutoStart, getAutoStartEnabled } from '../services/autoStart';

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let wizardWindow: BrowserWindow | null = null;
let trayManager: TrayManager | null = null;
let syncService: SyncService | null = null;
let config: AppConfig;
let logger: ReturnType<typeof getLogger>;

const isDev = process.env.NODE_ENV === 'development';

function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 550,
    resizable: false,
    frame: true,
    show: false,
    icon: path.join(__dirname, '../../assets/icons/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../ui/dashboard/index.html'));

  mainWindow.on('close', (event) => {
    if (config?.behavior?.minimizeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function createWizardWindow(): BrowserWindow {
  wizardWindow = new BrowserWindow({
    width: 600,
    height: 500,
    resizable: false,
    frame: true,
    show: true,
    modal: true,
    icon: path.join(__dirname, '../../assets/icons/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  wizardWindow.loadFile(path.join(__dirname, '../ui/wizard/index.html'));

  wizardWindow.on('closed', () => {
    wizardWindow = null;
  });

  return wizardWindow;
}

function createSettingsWindow(): BrowserWindow {
  if (settingsWindow) {
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 550,
    height: 500,
    resizable: false,
    frame: true,
    show: true,
    icon: path.join(__dirname, '../../assets/icons/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, '../ui/settings/index.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  return settingsWindow;
}

async function initializeApp(): Promise<void> {
  const configDir = getConfigDir();
  initializeLogger(configDir);
  logger = getLogger('Main');
  
  logger.info('SpineFrame Sync Agent starting...');

  // Check if first run
  if (!configExists()) {
    logger.info('First run detected, showing setup wizard');
    createWizardWindow();
    return;
  }

  // Load existing config
  config = loadConfig();
  
  // Initialize API client
  const apiClient = initializeApiClient(config);

  // Initialize sync service
  syncService = new SyncService(config, apiClient);
  
  setupSyncServiceListeners();

  // Create main window (hidden initially)
  createMainWindow();

  // Create tray
  trayManager = new TrayManager({
    onOpenDashboard: () => {
      mainWindow?.show();
      mainWindow?.focus();
    },
    onSyncNow: () => syncService?.syncNow(),
    onTogglePause: () => {
      if (syncService?.isPausedState()) {
        syncService?.resume();
      } else {
        syncService?.pause();
      }
    },
    onSettings: () => createSettingsWindow(),
    onOpenWatchFolder: () => {
      if (config?.folders?.watch) {
        shell.openPath(config.folders.watch);
      }
    },
    onViewLogs: () => {
      shell.openPath(path.join(configDir, 'logs'));
    },
    onExit: () => {
      app.quit();
    },
  });

  // Start sync service
  try {
    await syncService.start();
    trayManager.setStatus('connected');
  } catch (error) {
    logger.error(`Failed to start sync service: ${error}`);
    trayManager.setStatus('error');
  }
}

function setupSyncServiceListeners(): void {
  if (!syncService) return;

  syncService.on('status', (status: string) => {
    if (status === 'syncing') {
      trayManager?.setStatus('syncing');
    } else {
      trayManager?.setStatus('connected');
    }
  });

  syncService.on('stats-updated', (stats: SyncStats) => {
    mainWindow?.webContents.send('stats-updated', stats);
    trayManager?.updateTooltip(stats);
  });

  syncService.on('activity', (item: SyncActivityItem) => {
    mainWindow?.webContents.send('activity', item);

    // Show notification for errors if enabled
    if (item.type === 'error' && config?.behavior?.showNotifications) {
      new Notification({
        title: 'SpineFrame Sync Error',
        body: item.message,
        icon: path.join(__dirname, '../../assets/icons/icon.png'),
      }).show();
    }
  });

  syncService.on('paused', () => {
    trayManager?.setStatus('paused');
    mainWindow?.webContents.send('paused', true);
  });

  syncService.on('resumed', () => {
    trayManager?.setStatus('connected');
    mainWindow?.webContents.send('paused', false);
  });

  syncService.on('heartbeat-failed', () => {
    trayManager?.setStatus('error');
  });
}

// IPC Handlers
ipcMain.handle('get-config', () => config);
ipcMain.handle('save-config', async (_event, newConfig: AppConfig) => {
  saveConfig(newConfig);
  config = newConfig;
  syncService?.updateConfig(config);
  getApiClient()?.updateConfig(config);

  // Update auto-start setting
  setAutoStart(newConfig.behavior?.autoStart ?? false);

  return { success: true };
});

ipcMain.handle('test-connection', async () => {
  const apiClient = getApiClient();
  if (!apiClient) return { ok: false, message: 'API client not initialized' };
  return apiClient.testConnection();
});

ipcMain.handle('get-stats', () => syncService?.getStats());
ipcMain.handle('get-activity-log', () => syncService?.getActivityLog());
ipcMain.handle('sync-now', () => syncService?.syncNow());
ipcMain.handle('toggle-pause', () => {
  if (syncService?.isPausedState()) {
    syncService?.resume();
  } else {
    syncService?.pause();
  }
  return syncService?.isPausedState();
});

ipcMain.handle('open-folder', (_event, folderPath: string) => {
  shell.openPath(folderPath);
});

ipcMain.handle('select-folder', async () => {
  const { dialog } = await import('electron');
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('wizard-complete', async (_event, newConfig: AppConfig) => {
  saveConfig(newConfig);
  config = newConfig;
  wizardWindow?.close();

  // Set auto-start if enabled
  setAutoStart(newConfig.behavior?.autoStart ?? false);

  // Initialize everything
  const apiClient = initializeApiClient(config);
  syncService = new SyncService(config, apiClient);
  setupSyncServiceListeners();

  createMainWindow();
  mainWindow?.show();

  trayManager = new TrayManager({
    onOpenDashboard: () => mainWindow?.show(),
    onSyncNow: () => syncService?.syncNow(),
    onTogglePause: () => {
      if (syncService?.isPausedState()) syncService?.resume();
      else syncService?.pause();
    },
    onSettings: () => createSettingsWindow(),
    onOpenWatchFolder: () => config?.folders?.watch && shell.openPath(config.folders.watch),
    onViewLogs: () => shell.openPath(path.join(getConfigDir(), 'logs')),
    onExit: () => app.quit(),
  });

  try {
    await syncService.start();
    trayManager.setStatus('connected');
  } catch (error) {
    logger.error(`Failed to start sync service: ${error}`);
    trayManager.setStatus('error');
  }
});

// App lifecycle
app.whenReady().then(initializeApp);

app.on('window-all-closed', () => {
  // Don't quit on window close - keep running in tray
});

app.on('activate', () => {
  if (mainWindow === null && configExists()) {
    createMainWindow();
  }
});

app.on('before-quit', async () => {
  await syncService?.stop();
});
