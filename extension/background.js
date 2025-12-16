// Khi Extension mới được cài hoặc reload, reset trạng thái về OFF
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ isRecording: false });
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.type === 'START_RECORDING') {
        await startRecording(message.config);
    } else if (message.type === 'STOP_RECORDING') {
        await stopRecording();
    }
    // Forward transcription from Offscreen -> Active Tab
    else if (message.type === 'TRANSCRIPTION_RESULT') {
        console.log('[Background] 📨 Forwarding transcription to content script:', message);
        // Find the active tab to display subtitles
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'TRANSCRIPTION_RESULT',
                    text: message.text,
                    start: message.start,
                    end: message.end,
                    // timestamp: message.timestamp,
                    startClock: message.startClock
                });
            }
        });
    }
    // Forward ALREADY_TRANSCRIBED from Offscreen -> Active Tab
    else if (message.type === 'ALREADY_TRANSCRIBED') {
        console.log('[Background] 💾 Forwarding cached subtitles to content script');
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'ALREADY_TRANSCRIBED',
                    video_id: message.video_id,
                    subtitles: message.subtitles
                });
            }
        });
    }
    // Forward TIME_SYNC, PLAYBACK_RATE, and VIDEO_CHANGED from Content Script -> Offscreen
    else if (message.type === 'TIME_SYNC' || message.type === 'PLAYBACK_RATE' || message.type === 'VIDEO_CHANGED') {
        // Forward to offscreen document
        try {
            chrome.runtime.sendMessage(message);
        } catch (e) {
            console.log("Could not forward to offscreen:", e);
        }
    }
});

async function startRecording(config) {
    try {
        // Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
            console.error('No active tab found');
            return;
        }

        // Get current video ID from content script
        let videoId = null;
        try {
            const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_ID' });
            videoId = response?.videoId || null;
            console.log('[Background] 📺 Current video ID:', videoId);
        } catch (e) {
            console.log('[Background] Could not get video ID from content script:', e);
        }

        // Check and create offscreen document if needed
        const existingContexts = await chrome.runtime.getContexts({});
        const offscreenDocument = existingContexts.find(
            (c) => c.contextType === 'OFFSCREEN_DOCUMENT'
        );

        if (!offscreenDocument) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['USER_MEDIA'],
                justification: 'Recording tab audio for real-time transcription',
            });
        }

        // Get Stream ID of current tab
        const streamId = await chrome.tabCapture.getMediaStreamId({
            targetTabId: tab.id
        });

        // Send START command with config, streamId, and videoId
        setTimeout(() => {
            chrome.runtime.sendMessage({
                type: 'START_RECORDING',
                streamId: streamId,
                config: config,
                videoId: videoId  // Include initial video ID
            });
        }, 300);

        // Update state
        await chrome.storage.local.set({ isRecording: true });

    } catch (error) {
        console.error('Error starting recording:', error);
        await chrome.storage.local.set({ isRecording: false });
    }
}

async function stopRecording() {
    try {
        // Send STOP command to offscreen
        try {
            chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
        } catch (e) {
            // Ignore if offscreen doesn't respond
        }

        // Close Offscreen Document to free RAM
        try {
            await chrome.offscreen.closeDocument();
        } catch (e) {
            console.log("Offscreen document not found or already closed");
        }

        // Update state
        await chrome.storage.local.set({ isRecording: false });

    } catch (error) {
        console.error('Error stopping recording:', error);
    }
}