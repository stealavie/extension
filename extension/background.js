chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ isRecording: false });
});

chrome.runtime.onMessage.addListener(async (message) => {
    if (message.type === 'START_RECORDING') {
        await startRecording(message.config);
    } else if (message.type === 'STOP_RECORDING') {
        await stopRecording();
    } else if (message.type === 'TRANSCRIPTION_RESULT' || message.type === 'ALREADY_TRANSCRIBED') {
        forwardToActiveTab(message);
    } else if (['TIME_SYNC', 'PLAYBACK_RATE', 'VIDEO_CHANGED', 'PAUSE_CAPTURE', 'RESUME_CAPTURE'].includes(message.type)) {
        try { chrome.runtime.sendMessage(message); } catch { }
    }
});

function forwardToActiveTab(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, message);
    });
}

async function startRecording(config) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;

        let videoId = null;
        try {
            const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_ID' });
            videoId = response?.videoId || null;
        } catch { }

        const existingContexts = await chrome.runtime.getContexts({});
        if (!existingContexts.find(c => c.contextType === 'OFFSCREEN_DOCUMENT')) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['USER_MEDIA'],
                justification: 'Recording tab audio for real-time transcription',
            });
        }

        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });

        setTimeout(() => {
            chrome.runtime.sendMessage({
                type: 'START_RECORDING',
                streamId,
                config,
                videoId
            });
        }, 300);

        await chrome.storage.local.set({ isRecording: true });
    } catch (error) {
        console.error('Error starting recording:', error);
        await chrome.storage.local.set({ isRecording: false });
    }
}

async function stopRecording() {
    try {
        try { chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }); } catch { }
        try { await chrome.offscreen.closeDocument(); } catch { }
        await chrome.storage.local.set({ isRecording: false });
    } catch (error) {
        console.error('Error stopping recording:', error);
    }
}