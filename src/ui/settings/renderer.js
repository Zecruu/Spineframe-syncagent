const { ipcRenderer } = require('electron');

// Tab functionality
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const tabId = tab.dataset.tab;
    
    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    document.getElementById(tabId).classList.add('active');
  });
});

// DOM Elements
const apiUrl = document.getElementById('apiUrl');
const clinicId = document.getElementById('clinicId');
const apiKey = document.getElementById('apiKey');
const toggleApiKey = document.getElementById('toggleApiKey');
const testConnection = document.getElementById('testConnection');
const connectionStatus = document.getElementById('connectionStatus');

const watchFolder = document.getElementById('watchFolder');
const processedFolder = document.getElementById('processedFolder');
const failedFolder = document.getElementById('failedFolder');

const autoStart = document.getElementById('autoStart');
const moveToProcessed = document.getElementById('moveToProcessed');
const deleteAfterSync = document.getElementById('deleteAfterSync');
const showNotifications = document.getElementById('showNotifications');
const minimizeToTray = document.getElementById('minimizeToTray');
const syncInterval = document.getElementById('syncInterval');
const maxRetries = document.getElementById('maxRetries');

const logLevel = document.getElementById('logLevel');

// Load config
async function loadConfig() {
  const config = await ipcRenderer.invoke('get-config');
  if (!config) return;

  // Connection
  apiUrl.value = config.api?.baseUrl || '';
  clinicId.value = config.api?.clinicId || '';
  apiKey.value = config.api?.apiKey || '';

  // Folders
  watchFolder.value = config.folders?.watch || '';
  processedFolder.value = config.folders?.processed || '';
  failedFolder.value = config.folders?.failed || '';

  // Behavior
  autoStart.checked = config.behavior?.autoStart ?? true;
  moveToProcessed.checked = config.behavior?.moveToProcessed ?? true;
  deleteAfterSync.checked = config.behavior?.deleteAfterSync ?? false;
  showNotifications.checked = config.behavior?.showNotifications ?? true;
  minimizeToTray.checked = config.behavior?.minimizeToTray ?? true;
  syncInterval.value = config.behavior?.syncIntervalSeconds || 60;
  maxRetries.value = config.behavior?.maxRetries || 3;

  // Logging
  logLevel.value = config.logging?.level || 'INFO';
}

// Save config
async function saveConfig() {
  const config = {
    version: '1.0',
    api: {
      baseUrl: apiUrl.value,
      clinicId: clinicId.value,
      apiKey: apiKey.value,
    },
    folders: {
      watch: watchFolder.value,
      processed: processedFolder.value,
      failed: failedFolder.value,
    },
    behavior: {
      autoStart: autoStart.checked,
      moveToProcessed: moveToProcessed.checked,
      deleteAfterSync: deleteAfterSync.checked,
      showNotifications: showNotifications.checked,
      minimizeToTray: minimizeToTray.checked,
      syncIntervalSeconds: parseInt(syncInterval.value, 10),
      maxRetries: parseInt(maxRetries.value, 10),
    },
    logging: {
      level: logLevel.value,
      maxFileSizeMB: 10,
      retentionDays: 7,
    },
  };

  await ipcRenderer.invoke('save-config', config);
  window.close();
}

// Event Listeners
toggleApiKey.addEventListener('click', () => {
  apiKey.type = apiKey.type === 'password' ? 'text' : 'password';
  toggleApiKey.textContent = apiKey.type === 'password' ? '👁️' : '🙈';
});

testConnection.addEventListener('click', async () => {
  connectionStatus.className = 'status-message';
  connectionStatus.textContent = 'Testing...';
  connectionStatus.style.display = 'block';

  const result = await ipcRenderer.invoke('test-connection');
  connectionStatus.className = `status-message ${result.ok ? 'success' : 'error'}`;
  connectionStatus.textContent = result.message;
});

// Folder browse buttons
document.getElementById('browseWatch').addEventListener('click', async () => {
  const folder = await ipcRenderer.invoke('select-folder');
  if (folder) watchFolder.value = folder;
});

document.getElementById('browseProcessed').addEventListener('click', async () => {
  const folder = await ipcRenderer.invoke('select-folder');
  if (folder) processedFolder.value = folder;
});

document.getElementById('browseFailed').addEventListener('click', async () => {
  const folder = await ipcRenderer.invoke('select-folder');
  if (folder) failedFolder.value = folder;
});

// Mutual exclusion for delete/move
moveToProcessed.addEventListener('change', () => {
  if (moveToProcessed.checked) deleteAfterSync.checked = false;
});

deleteAfterSync.addEventListener('change', () => {
  if (deleteAfterSync.checked) moveToProcessed.checked = false;
});

// Log actions
document.getElementById('openLogFolder').addEventListener('click', () => {
  ipcRenderer.invoke('open-log-folder');
});

// About tab - Updates
const updateStatus = document.getElementById('updateStatus');
const checkUpdatesBtn = document.getElementById('checkUpdatesBtn');
const downloadUpdateBtn = document.getElementById('downloadUpdateBtn');
const installUpdateBtn = document.getElementById('installUpdateBtn');
const githubLink = document.getElementById('githubLink');

checkUpdatesBtn.addEventListener('click', async () => {
  updateStatus.innerHTML = '<p>Checking for updates...</p>';
  checkUpdatesBtn.disabled = true;

  const result = await ipcRenderer.invoke('check-for-updates');

  if (result.available) {
    updateStatus.innerHTML = `<p class="update-available">✨ ${result.message}</p>`;
    downloadUpdateBtn.style.display = 'inline-block';
  } else {
    updateStatus.innerHTML = `<p class="up-to-date">✅ ${result.message}</p>`;
  }
  checkUpdatesBtn.disabled = false;
});

downloadUpdateBtn.addEventListener('click', async () => {
  updateStatus.innerHTML = '<p>Downloading update...</p>';
  downloadUpdateBtn.disabled = true;

  await ipcRenderer.invoke('download-update');

  updateStatus.innerHTML = '<p class="update-ready">✅ Update downloaded! Click "Install & Restart" to apply.</p>';
  downloadUpdateBtn.style.display = 'none';
  installUpdateBtn.style.display = 'inline-block';
});

installUpdateBtn.addEventListener('click', () => {
  ipcRenderer.invoke('install-update');
});

githubLink.addEventListener('click', (e) => {
  e.preventDefault();
  require('electron').shell.openExternal('https://github.com/Zecruu/Spineframe-syncagent');
});

// Check update status on load
async function checkUpdateStatus() {
  const status = await ipcRenderer.invoke('get-update-status');
  if (status.downloaded) {
    updateStatus.innerHTML = '<p class="update-ready">✅ Update ready to install!</p>';
    installUpdateBtn.style.display = 'inline-block';
  } else if (status.available) {
    updateStatus.innerHTML = `<p class="update-available">✨ Version ${status.version} is available!</p>`;
    downloadUpdateBtn.style.display = 'inline-block';
  }
}

// Footer buttons
document.getElementById('saveBtn').addEventListener('click', saveConfig);
document.getElementById('cancelBtn').addEventListener('click', () => window.close());

// Initialize
loadConfig();
checkUpdateStatus();

