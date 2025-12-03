import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'path';
import { SyncStats } from '../services/syncService';

export type TrayStatus = 'connected' | 'syncing' | 'error' | 'paused';

interface TrayCallbacks {
  onOpenDashboard: () => void;
  onSyncNow: () => void;
  onTogglePause: () => void;
  onSettings: () => void;
  onOpenWatchFolder: () => void;
  onViewLogs: () => void;
  onExit: () => void;
}

export class TrayManager {
  private tray: Tray | null = null;
  private status: TrayStatus = 'connected';
  private callbacks: TrayCallbacks;
  private isPaused: boolean = false;
  private syncedToday: number = 0;

  constructor(callbacks: TrayCallbacks) {
    this.callbacks = callbacks;
    this.createTray();
  }

  private getIconPath(): string {
    // Use the main icon for tray (16x16 version)
    return path.join(__dirname, '../../assets/icons', 'icon_16x16.png');
  }

  private createTray(): void {
    const iconPath = this.getIconPath();

    // Create a simple icon if assets don't exist yet
    let icon;
    try {
      icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) {
        icon = this.createDefaultIcon();
      }
    } catch {
      icon = this.createDefaultIcon();
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip('SpineFrame Sync Agent - Connected');
    this.updateContextMenu();

    // Double-click opens dashboard
    this.tray.on('double-click', () => {
      this.callbacks.onOpenDashboard();
    });
  }

  private createDefaultIcon(): Electron.NativeImage {
    // Create a simple 16x16 colored icon
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);
    
    const colors: Record<TrayStatus, [number, number, number]> = {
      connected: [0, 200, 0],    // Green
      syncing: [255, 200, 0],    // Yellow
      error: [255, 0, 0],        // Red
      paused: [128, 128, 128],   // Gray
    };

    const [r, g, b] = colors[this.status];

    for (let i = 0; i < size * size; i++) {
      canvas[i * 4] = r;
      canvas[i * 4 + 1] = g;
      canvas[i * 4 + 2] = b;
      canvas[i * 4 + 3] = 255;
    }

    return nativeImage.createFromBuffer(canvas, { width: size, height: size });
  }

  private updateContextMenu(): void {
    const pauseLabel = this.isPaused ? '▶️ Resume Syncing' : '⏸️ Pause Syncing';

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '📊 Open Dashboard',
        click: () => this.callbacks.onOpenDashboard(),
      },
      {
        label: '🔄 Sync Now',
        click: () => this.callbacks.onSyncNow(),
        enabled: !this.isPaused,
      },
      {
        label: pauseLabel,
        click: () => {
          this.isPaused = !this.isPaused;
          this.callbacks.onTogglePause();
          this.updateContextMenu();
        },
      },
      { type: 'separator' },
      {
        label: '⚙️ Settings',
        click: () => this.callbacks.onSettings(),
      },
      {
        label: '📁 Open Watch Folder',
        click: () => this.callbacks.onOpenWatchFolder(),
      },
      {
        label: '📋 View Logs',
        click: () => this.callbacks.onViewLogs(),
      },
      { type: 'separator' },
      {
        label: '❌ Exit',
        click: () => this.callbacks.onExit(),
      },
    ]);

    this.tray?.setContextMenu(contextMenu);
  }

  setStatus(status: TrayStatus): void {
    if (status === 'paused') {
      this.isPaused = true;
    } else if (status === 'connected') {
      this.isPaused = false;
    }

    this.status = status;
    // Use the main icon - we keep the same logo but can add overlay/badge in future
    const iconPath = this.getIconPath();
    try {
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        this.tray?.setImage(icon);
      }
    } catch {
      // Keep existing icon
    }
    this.updateContextMenu();
  }

  updateTooltip(stats: SyncStats): void {
    this.syncedToday = stats.syncedToday;
    const statusText = this.isPaused ? 'Paused' : 
                       this.status === 'syncing' ? 'Syncing...' :
                       this.status === 'error' ? 'Error' : 'Connected';
    
    this.tray?.setToolTip(`SpineFrame Sync Agent - ${statusText} (${stats.syncedToday} files synced today)`);
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}

