// Default configuration
const DEFAULT_CONFIG = {
    wsUrl: '',
    asrModel: 'whisper-base',
    translationModel: 'google-translate',
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
const translationModelSelect = document.getElementById('translation-model');
const langButtons = document.querySelectorAll('.lang-btn');
const serverUrlDisplay = document.getElementById('server-url');

let isRecording = false;
let currentConfig = { ...DEFAULT_CONFIG };

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
    translationModelSelect.value = currentConfig.translationModel;
    
    // Set active language button
    langButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === currentConfig.targetLang);
    });
    
    // Update server URL display
    updateServerDisplay();
}

// Save configuration
async function saveConfig() {
    await chrome.storage.local.set({ config: currentConfig });
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
        saveConfig();
    });
    
    translationModelSelect.addEventListener('change', (e) => {
        currentConfig.translationModel = e.target.value;
        saveConfig();
    });
    
    // Language buttons
    langButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            langButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentConfig.targetLang = btn.dataset.lang;
            saveConfig();
        });
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
    await saveConfig();
    updateServerDisplay();
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

// Update server URL display
function updateServerDisplay() {
    if (currentConfig.wsUrl) {
        try {
            const url = new URL(currentConfig.wsUrl);
            serverUrlDisplay.textContent = url.hostname;
            serverUrlDisplay.title = currentConfig.wsUrl;
        } catch {
            serverUrlDisplay.textContent = currentConfig.wsUrl;
        }
    } else {
        serverUrlDisplay.textContent = 'Not configured';
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
        recordBtn.querySelector('.record-text').textContent = 'Stop Recording';
        statusIndicator.classList.add('active');
        statusText.textContent = 'Recording...';
        
        // Disable model/language changes during recording
        asrModelSelect.disabled = true;
        translationModelSelect.disabled = true;
        langButtons.forEach(btn => btn.disabled = true);
    } else {
        recordBtn.classList.remove('recording');
        recordBtn.querySelector('.record-text').textContent = 'Start Recording';
        statusIndicator.classList.remove('active');
        statusText.textContent = 'Ready';
        
        // Enable controls
        asrModelSelect.disabled = false;
        translationModelSelect.disabled = false;
        langButtons.forEach(btn => btn.disabled = false);
    }
}

// Listen for recording state changes from background
chrome.storage.onChanged.addListener((changes) => {
    if (changes.isRecording) {
        isRecording = changes.isRecording.newValue;
        updateRecordingState();
    }
});
