// Default configuration
const DEFAULT_CONFIG = {
    wsUrl: '',
    asrModel: 'whisper-tiny',
    targetLang: 'vie'
};

// DOM Elements
const settingsPage = document.getElementById('settings-page');
const mainPage = document.getElementById('main-page');
const wsUrlInput = document.getElementById('ws-url');
const testConnectionBtn = document.getElementById('test-connection');
const saveSettingsBtn = document.getElementById('save-settings');
const connectionStatus = document.getElementById('connection-status');
const backToSettingsBtn = document.getElementById('back-to-settings');
const recordBtn = document.getElementById('record-btn');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const asrModelSelect = document.getElementById('asr-model');
const targetLangSelect = document.getElementById('target-lang');
const displayModel = document.getElementById('display-model');
const displayLang = document.getElementById('display-lang');
const currentConfigDisplay = document.getElementById('current-config-display');
const recordingTimer = document.getElementById('recording-timer');

let isRecording = false;
let currentConfig = { ...DEFAULT_CONFIG };
let timerInterval = null;
let startTime = 0;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    setupEventListeners();
    checkInitialPage();
    updateRecordingState();
});

// Load saved configuration
async function loadConfig() {
    const result = await chrome.storage.local.get(['config', 'isRecording']);

    if (result.config) {
        currentConfig = { ...DEFAULT_CONFIG, ...result.config };
    }

    if (result.isRecording !== undefined) {
        isRecording = result.isRecording;
    }

    // Populate UI with saved values
    wsUrlInput.value = currentConfig.wsUrl || '';
    asrModelSelect.value = currentConfig.asrModel;
    targetLangSelect.value = currentConfig.targetLang;

    updateInfoDisplay();
}

// Save configuration
async function saveConfig() {
    await chrome.storage.local.set({ config: currentConfig });
    updateInfoDisplay();
}

// Setup event listeners
function setupEventListeners() {
    // Settings page
    testConnectionBtn.addEventListener('click', testConnection);
    saveSettingsBtn.addEventListener('click', saveAndContinue);
    wsUrlInput.addEventListener('input', () => {
        connectionStatus.classList.add('hidden');
    });

    // Main page
    backToSettingsBtn.addEventListener('click', showSettingsPage);
    recordBtn.addEventListener('click', toggleRecording);

    // Model selects
    asrModelSelect.addEventListener('change', (e) => {
        currentConfig.asrModel = e.target.value;
        // Auto save when changed in settings
        saveConfig();
    });

    targetLangSelect.addEventListener('change', (e) => {
        currentConfig.targetLang = e.target.value;
        saveConfig();
    });
}

// Check which page to show initially
function checkInitialPage() {
    if (currentConfig.wsUrl) {
        showMainPage();
    } else {
        showSettingsPage();
    }
}

// Page navigation
function showSettingsPage() {
    settingsPage.classList.add('active');
    mainPage.classList.remove('active');
}

function showMainPage() {
    settingsPage.classList.remove('active');
    mainPage.classList.add('active');
    updateInfoDisplay();
}

// Update info display on main page
function updateInfoDisplay() {
    displayModel.textContent = asrModelSelect.options[asrModelSelect.selectedIndex]?.text.split('(')[0].trim() || currentConfig.asrModel;
    displayLang.textContent = targetLangSelect.options[targetLangSelect.selectedIndex]?.text || currentConfig.targetLang;

    if (currentConfig.wsUrl) {
        try {
            const url = new URL(currentConfig.wsUrl);
            currentConfigDisplay.textContent = `Connected to ${url.hostname}`;
        } catch {
            currentConfigDisplay.textContent = 'Ready to capture';
        }
    }
}

// Test WebSocket connection
async function testConnection() {
    const url = wsUrlInput.value.trim();

    if (!url) {
        showStatus('error', 'Please enter a WebSocket URL');
        return;
    }

    showStatus('info', 'Testing connection...');
    testConnectionBtn.disabled = true;

    try {
        await testWebSocket(url);
        showStatus('success', '✓ Connection successful!');
    } catch (error) {
        showStatus('error', `✗ Connection failed: ${error.message}`);
    } finally {
        testConnectionBtn.disabled = false;
    }
}

// Test WebSocket connection helper
function testWebSocket(url) {
    return new Promise((resolve, reject) => {
        try {
            const ws = new WebSocket(url);
            const timeout = setTimeout(() => {
                ws.close();
                reject(new Error('Connection timeout'));
            }, 5000);

            ws.onopen = () => {
                clearTimeout(timeout);
                ws.close();
                resolve();
            };

            ws.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('Failed to connect'));
            };
        } catch (e) {
            reject(e);
        }
    });
}

// Save settings and continue to main page
async function saveAndContinue() {
    let url = wsUrlInput.value.trim();

    if (!url) {
        showStatus('error', 'Please enter a WebSocket URL');
        return;
    }

    currentConfig.wsUrl = url;
    currentConfig.asrModel = asrModelSelect.value;
    currentConfig.targetLang = targetLangSelect.value;

    await saveConfig();
    showMainPage();
}

// Show status message
function showStatus(type, message) {
    connectionStatus.className = `status-message ${type}`;
    connectionStatus.textContent = message;
    connectionStatus.classList.remove('hidden');

    if (type === 'success') {
        setTimeout(() => {
            connectionStatus.classList.add('hidden');
        }, 3000);
    }
}

// Toggle recording
async function toggleRecording() {
    if (!currentConfig.wsUrl) {
        alert('Please configure WebSocket URL in settings first');
        showSettingsPage();
        return;
    }

    isRecording = !isRecording;
    await chrome.storage.local.set({ isRecording });

    // Send message to background script
    chrome.runtime.sendMessage({
        type: isRecording ? 'START_RECORDING' : 'STOP_RECORDING',
        config: currentConfig
    });

    updateRecordingState();
}

// Update recording state UI
function updateRecordingState() {
    if (isRecording) {
        recordBtn.classList.add('recording');
        recordBtn.querySelector('.record-text').textContent = 'Stop Streaming';
        statusIndicator.classList.add('active');
        statusText.textContent = 'Live';

        // Start timer
        if (!timerInterval) {
            startTime = Date.now();
            timerInterval = setInterval(updateTimer, 1000);
        }

        // Disable settings
        backToSettingsBtn.style.opacity = '0.5';
        backToSettingsBtn.style.pointerEvents = 'none';
    } else {
        recordBtn.classList.remove('recording');
        recordBtn.querySelector('.record-text').textContent = 'Start Streaming';
        statusIndicator.classList.remove('active');
        statusText.textContent = 'Standby';

        // Stop timer
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
            recordingTimer.textContent = '00:00';
        }

        // Enable settings
        backToSettingsBtn.style.opacity = '1';
        backToSettingsBtn.style.pointerEvents = 'auto';
    }
}

function updateTimer() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const secs = (elapsed % 60).toString().padStart(2, '0');
    recordingTimer.textContent = `${mins}:${secs}`;
}

// Listen for recording state changes from background
chrome.storage.onChanged.addListener((changes) => {
    if (changes.isRecording) {
        isRecording = changes.isRecording.newValue;
        updateRecordingState();
    }
});
