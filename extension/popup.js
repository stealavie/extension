const DEFAULT_CONFIG = {
    wsUrl: '',
    asrModel: 'whisper-base',
    translationModel: 'google-translate',
    originLang: 'vie',
    targetLang: 'en'
};

const elements = {};
let isRecording = false;
let currentConfig = { ...DEFAULT_CONFIG };

document.addEventListener('DOMContentLoaded', async () => {
    cacheElements();
    await loadConfig();
    setupEventListeners();
    checkInitialPage();
    updateRecordingState();
});

function cacheElements() {
    elements.settingsPage = document.getElementById('settings-page');
    elements.mainPage = document.getElementById('main-page');
    elements.wsUrlInput = document.getElementById('ws-url');
    elements.testConnectionBtn = document.getElementById('test-connection');
    elements.saveSettingsBtn = document.getElementById('save-settings');
    elements.connectionStatus = document.getElementById('connection-status');
    elements.backToSettingsBtn = document.getElementById('back-to-settings');
    elements.recordBtn = document.getElementById('record-btn');
    elements.statusIndicator = document.getElementById('status-indicator');
    elements.statusText = document.getElementById('status-text');
    elements.asrModelSelect = document.getElementById('asr-model');
    elements.translationModelSelect = document.getElementById('translation-model');
    elements.originLangButtons = document.querySelectorAll('.origin-lang-btn');
    elements.targetLangButtons = document.querySelectorAll('.target-lang-btn');
    elements.serverUrlDisplay = document.getElementById('server-url');
}

async function loadConfig() {
    const result = await chrome.storage.local.get(['config', 'isRecording']);
    if (result.config) currentConfig = { ...DEFAULT_CONFIG, ...result.config };
    if (result.isRecording !== undefined) isRecording = result.isRecording;
    
    elements.wsUrlInput.value = currentConfig.wsUrl || '';
    elements.asrModelSelect.value = currentConfig.asrModel;
    elements.translationModelSelect.value = currentConfig.translationModel;
    
    elements.originLangButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === currentConfig.originLang);
    });
    elements.targetLangButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === currentConfig.targetLang);
    });
    
    updateServerDisplay();
}

async function saveConfig() {
    await chrome.storage.local.set({ config: currentConfig });
}

function setupEventListeners() {
    elements.testConnectionBtn.addEventListener('click', testConnection);
    elements.saveSettingsBtn.addEventListener('click', saveAndContinue);
    elements.wsUrlInput.addEventListener('input', () => elements.connectionStatus.classList.add('hidden'));
    elements.backToSettingsBtn.addEventListener('click', showSettingsPage);
    elements.recordBtn.addEventListener('click', toggleRecording);
    
    elements.asrModelSelect.addEventListener('change', (e) => {
        currentConfig.asrModel = e.target.value;
        saveConfig();
    });
    
    elements.translationModelSelect.addEventListener('change', (e) => {
        currentConfig.translationModel = e.target.value;
        saveConfig();
    });
    
    elements.originLangButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.originLangButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentConfig.originLang = btn.dataset.lang;
            saveConfig();
        });
    });
    
    elements.targetLangButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.targetLangButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentConfig.targetLang = btn.dataset.lang;
            saveConfig();
        });
    });
}

function checkInitialPage() {
    currentConfig.wsUrl ? showMainPage() : showSettingsPage();
}

function showSettingsPage() {
    elements.settingsPage.classList.add('active');
    elements.mainPage.classList.remove('active');
}

function showMainPage() {
    elements.settingsPage.classList.remove('active');
    elements.mainPage.classList.add('active');
}

async function testConnection() {
    const url = elements.wsUrlInput.value.trim();
    if (!url) {
        showStatus('error', 'Please enter a WebSocket URL');
        return;
    }
    
    showStatus('info', 'Testing connection...');
    elements.testConnectionBtn.disabled = true;
    
    try {
        await testWebSocket(url);
        showStatus('success', '✓ Connection successful!');
    } catch (error) {
        showStatus('error', `✗ Connection failed: ${error.message}`);
    } finally {
        elements.testConnectionBtn.disabled = false;
    }
}

function testWebSocket(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Connection timeout'));
        }, 5000);
        
        ws.onopen = () => { clearTimeout(timeout); ws.close(); resolve(); };
        ws.onerror = () => { clearTimeout(timeout); reject(new Error('Failed to connect')); };
    });
}

async function saveAndContinue() {
    const url = elements.wsUrlInput.value.trim();
    if (!url) {
        showStatus('error', 'Please enter a WebSocket URL');
        return;
    }
    currentConfig.wsUrl = url;
    await saveConfig();
    updateServerDisplay();
    showMainPage();
}

function showStatus(type, message) {
    elements.connectionStatus.className = `status-message ${type}`;
    elements.connectionStatus.textContent = message;
    elements.connectionStatus.classList.remove('hidden');
    
    if (type === 'success') {
        setTimeout(() => elements.connectionStatus.classList.add('hidden'), 3000);
    }
}

function updateServerDisplay() {
    if (currentConfig.wsUrl) {
        try {
            elements.serverUrlDisplay.textContent = new URL(currentConfig.wsUrl).hostname;
            elements.serverUrlDisplay.title = currentConfig.wsUrl;
        } catch {
            elements.serverUrlDisplay.textContent = currentConfig.wsUrl;
        }
    } else {
        elements.serverUrlDisplay.textContent = 'Not configured';
    }
}

async function toggleRecording() {
    if (!currentConfig.wsUrl) {
        alert('Please configure WebSocket URL in settings first');
        showSettingsPage();
        return;
    }
    
    isRecording = !isRecording;
    await chrome.storage.local.set({ isRecording });
    
    chrome.runtime.sendMessage({
        type: isRecording ? 'START_RECORDING' : 'STOP_RECORDING',
        config: currentConfig
    });
    
    updateRecordingState();
}

function updateRecordingState() {
    const controls = [elements.asrModelSelect, elements.translationModelSelect];
    
    if (isRecording) {
        elements.recordBtn.classList.add('recording');
        elements.recordBtn.querySelector('.record-text').textContent = 'Stop Recording';
        elements.statusIndicator.classList.add('active');
        elements.statusText.textContent = 'Recording...';
        controls.forEach(c => c.disabled = true);
    } else {
        elements.recordBtn.classList.remove('recording');
        elements.recordBtn.querySelector('.record-text').textContent = 'Start Recording';
        elements.statusIndicator.classList.remove('active');
        elements.statusText.textContent = 'Ready';
        controls.forEach(c => c.disabled = false);
    }
}

chrome.storage.onChanged.addListener((changes) => {
    if (changes.isRecording) {
        isRecording = changes.isRecording.newValue;
        updateRecordingState();
    }
});
