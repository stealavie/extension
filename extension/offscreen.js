let socket = null;
let audioContext = null;
let stream = null;
let currentConfig = null;
let currentVideoId = null;
let isPaused = false; // NEW: Flag để tạm dừng gửi audio khi ở replay mode

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'START_RECORDING') {
        currentConfig = message.config;
        currentVideoId = message.videoId || null;
        isPaused = false; // Reset pause state khi start recording
        startCapture(message.streamId);
    } else if (message.type === 'STOP_RECORDING') {
        stopCapture();
    } else if (message.type === 'VIDEO_CHANGED') {
        currentVideoId = message.videoId;
        isPaused = false; // Reset pause state khi video thay đổi
        sendToSocket({ type: 'video_changed', videoId: currentVideoId });
    } else if (message.type === 'TIME_SYNC') {
        sendToSocket({ type: 'time_sync', timestamp: message.timestamp });
    } else if (message.type === 'PLAYBACK_RATE') {
        sendToSocket({ type: 'playback_rate', rate: message.rate });
    } else if (message.type === 'PAUSE_CAPTURE') {
        // NEW: Tạm dừng gửi audio data (replay mode)
        isPaused = true;
        console.log('[Offscreen] Audio capture PAUSED (replay mode)');
    } else if (message.type === 'RESUME_CAPTURE') {
        // NEW: Tiếp tục gửi audio data (live mode)
        isPaused = false;
        console.log('[Offscreen] Audio capture RESUMED (live mode)');
    }
});

function sendToSocket(data) {
    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    }
}

async function startCapture(streamId) {
    if (!currentConfig?.wsUrl) return;

    socket = new WebSocket(currentConfig.wsUrl);
    socket.binaryType = 'arraybuffer';

    socket.onopen = () => {
        sendToSocket({
            type: 'config',
            asrModel: currentConfig.asrModel,
            translationModel: currentConfig.translationModel
        });
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'transcription') {
                chrome.runtime.sendMessage({
                    type: 'TRANSCRIPTION_RESULT',
                    text: data.text,
                    start: data.start,
                    end: data.end,
                    startClock: data.startClock
                });
            } else if (data.type === 'ALREADY_TRANSCRIBED') {
                chrome.runtime.sendMessage({
                    type: 'ALREADY_TRANSCRIBED',
                    video_id: data.video_id,
                    subtitles: data.subtitles
                });
            }
        } catch { }
    };

    stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: streamId
            }
        },
        video: false
    });

    audioContext = new AudioContext({ sampleRate: 16000 });

    try {
        await audioContext.audioWorklet.addModule('pcm-processor.js');
    } catch (e) {
        console.error('Failed to load pcm-processor.js:', e);
        return;
    }

    const source = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');

    workletNode.port.onmessage = (e) => {
        if (socket?.readyState !== WebSocket.OPEN) return;

        // NEW: Skip gửi audio khi đang ở replay mode
        if (isPaused) return;

        const timestamp = Date.now();
        const audioData = new Uint8Array(e.data.buffer);
        const originLangCode = currentConfig.originLang === 'vie' ? 1 : 0;
        const targetLangCode = currentConfig.targetLang === 'vie' ? 1 : 0;

        const videoIdString = currentVideoId || '';
        const videoIdBytes = new TextEncoder().encode(videoIdString);
        const videoIdLength = videoIdBytes.length;

        const buffer = new ArrayBuffer(12 + videoIdLength + audioData.length);
        const view = new DataView(buffer);
        const arr = new Uint8Array(buffer);

        view.setUint8(0, originLangCode);
        view.setUint8(1, targetLangCode);
        view.setBigUint64(2, BigInt(timestamp), true);
        view.setUint16(10, videoIdLength, true);
        arr.set(videoIdBytes, 12);
        arr.set(audioData, 12 + videoIdLength);

        socket.send(buffer);
    };

    source.connect(workletNode);
    workletNode.connect(audioContext.destination);
    source.connect(audioContext.destination);
}

function stopCapture() {
    socket?.close();
    socket = null;
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    audioContext?.close();
    audioContext = null;
}
