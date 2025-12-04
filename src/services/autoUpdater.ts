import { autoUpdater, UpdateInfo } from 'electron-updater';
import { BrowserWindow, dialog, Notification } from 'electron';
import { getLogger } from './logger';

const logger = getLogger('AutoUpdater');

let updateAvailable = false;
let updateDownloaded = false;
let latestVersion: string | null = null;
let downloadResolve: ((value: boolean) => void) | null = null;

export function initializeAutoUpdater(): void {
  // Configure auto-updater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Set GitHub as the update provider (uses releases)
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Zecruu',
    repo: 'Spineframe-syncagent',
  });

  // Event handlers
  autoUpdater.on('checking-for-update', () => {
    logger.info('Checking for updates...');
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    logger.info(`Update available: v${info.version}`);
    updateAvailable = true;
    latestVersion = info.version;

    // Show notification
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'SpineFrame Sync Agent Update',
        body: `Version ${info.version} is available. Click to download.`,
        icon: undefined,
      });
      notification.on('click', () => {
        downloadUpdate();
      });
      notification.show();
    }
  });

  autoUpdater.on('update-not-available', () => {
    logger.info('No updates available');
    updateAvailable = false;
  });

  autoUpdater.on('download-progress', (progress) => {
    logger.debug(`Download progress: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    logger.info(`Update downloaded: v${info.version}`);
    updateDownloaded = true;

    // Resolve the download promise if waiting
    if (downloadResolve) {
      downloadResolve(true);
      downloadResolve = null;
    }

    // Show notification
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'Update Ready to Install',
        body: `Version ${info.version} has been downloaded. Restart to install.`,
        icon: undefined,
      });
      notification.on('click', () => {
        quitAndInstall();
      });
      notification.show();
    }
  });

  autoUpdater.on('error', (error) => {
    logger.error(`Auto-updater error: ${error.message}`);
    // Reject the download promise if waiting
    if (downloadResolve) {
      downloadResolve(false);
      downloadResolve = null;
    }
  });

  // Check for updates on startup (after 10 seconds)
  setTimeout(() => {
    checkForUpdates();
  }, 10000);

  // Check for updates every 4 hours
  setInterval(() => {
    checkForUpdates();
  }, 4 * 60 * 60 * 1000);
}

export async function checkForUpdates(): Promise<{ available: boolean; version?: string }> {
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.updateInfo) {
      return { available: updateAvailable, version: result.updateInfo.version };
    }
    return { available: false };
  } catch (error) {
    logger.error(`Failed to check for updates: ${(error as Error).message}`);
    return { available: false };
  }
}

export async function downloadUpdate(): Promise<boolean> {
  try {
    logger.info('Starting update download...');

    // Create a promise that resolves when download is complete
    const downloadPromise = new Promise<boolean>((resolve) => {
      downloadResolve = resolve;

      // Timeout after 5 minutes
      setTimeout(() => {
        if (downloadResolve) {
          logger.warn('Download timed out');
          downloadResolve(false);
          downloadResolve = null;
        }
      }, 5 * 60 * 1000);
    });

    // Start the download
    autoUpdater.downloadUpdate();

    // Wait for download to complete
    const success = await downloadPromise;
    logger.info(`Update download completed: ${success}`);
    return success;
  } catch (error) {
    logger.error(`Failed to download update: ${(error as Error).message}`);
    return false;
  }
}

export function quitAndInstall(): void {
  logger.info('Quitting and installing update...');
  // isSilent = false (show installer), isForceRunAfter = true (restart app after install)
  autoUpdater.quitAndInstall(false, true);
}

export function getUpdateStatus(): { available: boolean; downloaded: boolean; version: string | null } {
  return {
    available: updateAvailable,
    downloaded: updateDownloaded,
    version: latestVersion,
  };
}

export async function checkForUpdatesManual(): Promise<{ available: boolean; version?: string; message: string }> {
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.updateInfo && updateAvailable) {
      return {
        available: true,
        version: result.updateInfo.version,
        message: `Version ${result.updateInfo.version} is available!`,
      };
    }
    return { available: false, message: 'You are running the latest version.' };
  } catch (error) {
    return { available: false, message: `Failed to check: ${(error as Error).message}` };
  }
}

