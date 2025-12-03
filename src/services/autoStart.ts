import { app } from 'electron';
import { getLogger } from './logger';

const logger = getLogger('AutoStart');

export function setAutoStart(enable: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: enable,
      openAsHidden: true, // Start minimized to tray
      path: process.execPath,
      args: ['--hidden'],
    });
    
    logger.info(`Auto-start ${enable ? 'enabled' : 'disabled'}`);
  } catch (error) {
    logger.error(`Failed to set auto-start: ${error}`);
  }
}

export function getAutoStartEnabled(): boolean {
  try {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
  } catch (error) {
    logger.error(`Failed to get auto-start status: ${error}`);
    return false;
  }
}

