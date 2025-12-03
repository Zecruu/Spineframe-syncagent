const { ipcRenderer } = require('electron');
const path = require('path');

// State
let currentStep = 1;
const totalSteps = 3;

// DOM Elements
const steps = document.querySelectorAll('.step');
const stepContents = document.querySelectorAll('.wizard-step');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

// Step 1 elements
const apiUrl = document.getElementById('apiUrl');
const clinicId = document.getElementById('clinicId');
const apiKey = document.getElementById('apiKey');
const toggleApiKey = document.getElementById('toggleApiKey');
const testConnectionBtn = document.getElementById('testConnectionBtn');
const connectionStatus = document.getElementById('connectionStatus');

// Step 2 elements
const watchFolder = document.getElementById('watchFolder');
const processedFolder = document.getElementById('processedFolder');
const browseWatchFolder = document.getElementById('browseWatchFolder');
const browseProcessedFolder = document.getElementById('browseProcessedFolder');

// Step 3 elements
const autoStart = document.getElementById('autoStart');
const showNotifications = document.getElementById('showNotifications');
const retryFailed = document.getElementById('retryFailed');

// Navigation
function updateStepDisplay() {
  steps.forEach((step, index) => {
    step.classList.remove('active', 'completed');
    if (index + 1 === currentStep) {
      step.classList.add('active');
    } else if (index + 1 < currentStep) {
      step.classList.add('completed');
    }
  });

  stepContents.forEach((content, index) => {
    content.classList.toggle('hidden', index + 1 !== currentStep);
  });

  prevBtn.disabled = currentStep === 1;
  nextBtn.textContent = currentStep === totalSteps ? '✓ Complete Setup' : 'Next →';
}

function validateCurrentStep() {
  switch (currentStep) {
    case 1:
      return apiUrl.value && clinicId.value && apiKey.value;
    case 2:
      return watchFolder.value;
    case 3:
      return true;
    default:
      return false;
  }
}

prevBtn.addEventListener('click', () => {
  if (currentStep > 1) {
    currentStep--;
    updateStepDisplay();
  }
});

nextBtn.addEventListener('click', async () => {
  if (!validateCurrentStep()) {
    alert('Please fill in all required fields');
    return;
  }

  if (currentStep < totalSteps) {
    currentStep++;
    updateStepDisplay();
  } else {
    await completeSetup();
  }
});

// Step 1: API Configuration
toggleApiKey.addEventListener('click', () => {
  apiKey.type = apiKey.type === 'password' ? 'text' : 'password';
  toggleApiKey.textContent = apiKey.type === 'password' ? '👁️' : '🙈';
});

testConnectionBtn.addEventListener('click', async () => {
  connectionStatus.className = 'connection-status';
  connectionStatus.textContent = 'Testing connection...';
  connectionStatus.style.display = 'block';

  // Temporarily save config for testing
  const testConfig = {
    api: {
      baseUrl: apiUrl.value,
      clinicId: clinicId.value,
      apiKey: apiKey.value,
    }
  };

  try {
    const result = await ipcRenderer.invoke('test-connection', testConfig);
    connectionStatus.className = `connection-status ${result.ok ? 'success' : 'error'}`;
    connectionStatus.textContent = result.message;
  } catch (error) {
    connectionStatus.className = 'connection-status error';
    connectionStatus.textContent = `Error: ${error.message}`;
  }
});

// Step 2: Folder Selection
browseWatchFolder.addEventListener('click', async () => {
  const folder = await ipcRenderer.invoke('select-folder');
  if (folder) {
    watchFolder.value = folder;
    // Auto-set processed folder
    if (!processedFolder.value) {
      processedFolder.value = path.join(folder, 'Processed');
    }
  }
});

browseProcessedFolder.addEventListener('click', async () => {
  const folder = await ipcRenderer.invoke('select-folder');
  if (folder) {
    processedFolder.value = folder;
  }
});

// Complete Setup
async function completeSetup() {
  const afterSync = document.querySelector('input[name="afterSync"]:checked').value;

  const config = {
    version: '1.0',
    api: {
      baseUrl: apiUrl.value,
      clinicId: clinicId.value,
      apiKey: apiKey.value,
    },
    folders: {
      watch: watchFolder.value,
      processed: processedFolder.value || path.join(watchFolder.value, 'Processed'),
      failed: path.join(watchFolder.value, 'Failed'),
    },
    behavior: {
      autoStart: autoStart.checked,
      syncIntervalSeconds: 60,
      maxRetries: retryFailed.checked ? 3 : 0,
      deleteAfterSync: afterSync === 'delete',
      moveToProcessed: afterSync === 'move',
      showNotifications: showNotifications.checked,
      minimizeToTray: true,
    },
    logging: {
      level: 'INFO',
      maxFileSizeMB: 10,
      retentionDays: 7,
    },
  };

  await ipcRenderer.invoke('wizard-complete', config);
}

// Initialize
updateStepDisplay();

