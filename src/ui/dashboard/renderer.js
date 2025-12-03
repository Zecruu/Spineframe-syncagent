const { ipcRenderer } = require('electron');

// DOM Elements
const statusIndicator = document.getElementById('statusIndicator');
const syncedToday = document.getElementById('syncedToday');
const exportedToday = document.getElementById('exportedToday');
const pending = document.getElementById('pending');
const errorsToday = document.getElementById('errorsToday');
const activityLog = document.getElementById('activityLog');
const syncNowBtn = document.getElementById('syncNowBtn');
const openFolderBtn = document.getElementById('openFolderBtn');
const settingsBtn = document.getElementById('settingsBtn');
const pauseBanner = document.getElementById('pauseBanner');
const resumeBtn = document.getElementById('resumeBtn');

// State
let isPaused = false;
let config = null;

// Initialize
async function init() {
  config = await ipcRenderer.invoke('get-config');
  const stats = await ipcRenderer.invoke('get-stats');
  const exportStats = await ipcRenderer.invoke('get-export-stats');
  const activity = await ipcRenderer.invoke('get-activity-log');

  if (stats) updateStats(stats, exportStats);
  if (activity) {
    activityLog.innerHTML = '';
    activity.slice(0, 20).forEach(item => addActivityItem(item));
  }
}

// Update stats display
function updateStats(stats, exportStats) {
  syncedToday.textContent = stats.syncedToday || 0;
  exportedToday.textContent = exportStats?.exportedToday || 0;
  pending.textContent = stats.pending || 0;
  errorsToday.textContent = (stats.errorsToday || 0) + (exportStats?.errorsToday || 0);
}

// Format time ago
function formatTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return date.toLocaleDateString();
}

// Add activity item
function addActivityItem(item) {
  const div = document.createElement('div');
  div.className = `activity-item ${item.type}`;
  
  const time = new Date(item.timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const icon = item.type === 'success' ? '✓' : item.type === 'error' ? '✗' : 'ℹ️';
  
  div.innerHTML = `
    <span class="activity-time">${timeStr}</span>
    <span class="activity-icon">${icon}</span>
    <span class="activity-message">${item.message}</span>
  `;
  
  // Add at the top
  if (activityLog.firstChild) {
    activityLog.insertBefore(div, activityLog.firstChild);
  } else {
    activityLog.appendChild(div);
  }
  
  // Keep only 20 items
  while (activityLog.children.length > 20) {
    activityLog.removeChild(activityLog.lastChild);
  }
}

// Update status indicator
function updateStatus(status) {
  const dot = statusIndicator.querySelector('.status-dot');
  const text = statusIndicator.querySelector('.status-text');
  
  dot.className = `status-dot ${status}`;
  
  const statusTexts = {
    connected: 'Connected to SpineFrame',
    syncing: 'Syncing...',
    error: 'Connection Error',
    paused: 'Syncing Paused',
  };
  
  text.textContent = statusTexts[status] || 'Unknown';
}

// Event Listeners
syncNowBtn.addEventListener('click', async () => {
  await ipcRenderer.invoke('sync-now');
});

openFolderBtn.addEventListener('click', async () => {
  if (config?.folders?.watch) {
    await ipcRenderer.invoke('open-folder', config.folders.watch);
  }
});

settingsBtn.addEventListener('click', () => {
  // Settings window is opened from main process
  ipcRenderer.send('open-settings');
});

resumeBtn.addEventListener('click', async () => {
  await ipcRenderer.invoke('toggle-pause');
});

// IPC Event Handlers
ipcRenderer.on('stats-updated', (event, stats) => {
  updateStats(stats);
});

ipcRenderer.on('activity', (event, item) => {
  addActivityItem(item);
});

ipcRenderer.on('paused', (event, paused) => {
  isPaused = paused;
  pauseBanner.style.display = paused ? 'flex' : 'none';
  updateStatus(paused ? 'paused' : 'connected');
});

// Initialize on load
init();

// Refresh stats every minute
setInterval(async () => {
  const stats = await ipcRenderer.invoke('get-stats');
  const exportStats = await ipcRenderer.invoke('get-export-stats');
  if (stats) updateStats(stats, exportStats);
}, 60000);

