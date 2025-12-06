let socket = null;
let audioContext = null;
let processor = null;
let stream = null;
let currentConfig = null;

console.log('[Offscreen] Script loaded');

chrome.runtime.onMessage.addListener((message) => {
    console.log('[Offscreen] Received message:', message.type);
    
    if (message.type === 'START_RECORDING') {
        currentConfig = message.config;
        console.log('[Offscreen] Config received:', currentConfig);
        startCapture(message.streamId);
    } else if (message.type === 'STOP_RECORDING') {
        stopCapture();
    }
    // Forward sync messages to WebSocket
    else if (message.type === 'TIME_SYNC' && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'time_sync',
            timestamp: message.timestamp
        }));
    }
    else if (message.type === 'PLAYBACK_RATE' && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'playback_rate',
            rate: message.rate
        }));
    }
});

async function startCapture(streamId) {
    if (!currentConfig || !currentConfig.wsUrl) {
        console.error("[Offscreen] ❌ No WebSocket URL configured");
        return;
    }

    console.log('[Offscreen] Starting capture...');
    console.log('[Offscreen] WebSocket URL:', currentConfig.wsUrl);
    console.log('[Offscreen] StreamId:', streamId);
    console.log('[Offscreen] Origin Lang:', currentConfig.originLang);
    console.log('[Offscreen] Target Lang:', currentConfig.targetLang);

    // WebSocket Setup - Use URL from config
    socket = new WebSocket(currentConfig.wsUrl);
    socket.binaryType = "arraybuffer"; 

    socket.onopen = () => {
        console.log("[Offscreen] ✅ WebSocket Connected to:", currentConfig.wsUrl);
        // Send configuration to server
        socket.send(JSON.stringify({
            type: 'config',
            asrModel: currentConfig.asrModel,
            translationModel: currentConfig.translationModel,
            originLang: currentConfig.originLang,
            targetLang: currentConfig.targetLang
        }));
    };
    
    socket.onerror = (err) => console.error("[Offscreen] ❌ WebSocket Error:", err);
    
    socket.onclose = (event) => {
        console.log("[Offscreen] WebSocket Disconnected", event.code, event.reason);
    };

    // Get Stream
    console.log('[Offscreen] Requesting audio stream...');
    stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            mandatory: {
                chromeMediaSource: 'tab',
                chromeMediaSourceId: streamId
            }
        },
        video: false
    });
    console.log('[Offscreen] ✅ Got audio stream');

    // Create Audio Context (Force 16kHz)
    console.log('[Offscreen] Creating AudioContext...');
    audioContext = new AudioContext({ sampleRate: 16000 });

    // Load the separate Processor file
    // ensure 'pcm-processor.js' is accessible in your extension/server path
    try {
        console.log('[Offscreen] Loading pcm-processor.js...');
        await audioContext.audioWorklet.addModule('pcm-processor.js');
        console.log('[Offscreen] ✅ Loaded pcm-processor.js');
    } catch (e) {
        console.error("[Offscreen] ❌ Failed to load pcm-processor.js. Check file path!", e);
        return;
    }

    // Create Nodes
    const source = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');

    // Handle Data from Processor
    workletNode.port.onmessage = (e) => {
        // e.data contains the Int16Array from the processor
        if (socket.readyState === WebSocket.OPEN) {
            // Create a buffer with 2 bytes for languages + 8 bytes for timestamp + audio data
            const timestamp = Date.now();
            const audioData = new Uint8Array(e.data.buffer);
            
            // Total buffer: 1 (origin) + 1 (target) + 8 (timestamp) + audioData.length
            const combinedBuffer = new ArrayBuffer(10 + audioData.length);
            const view = new DataView(combinedBuffer);
            
            // Convert language codes: 'vie' = 1, 'en' = 0
            const originLangCode = currentConfig.originLang === 'vie' ? 1 : 0;
            const targetLangCode = currentConfig.targetLang === 'vie' ? 1 : 0;
            
            // Write origin language (first byte)
            view.setUint8(0, originLangCode);
            
            // Write target language (second byte)
            view.setUint8(1, targetLangCode);
            
            // Write timestamp as 64-bit integer (bytes 2-9)
            view.setBigUint64(2, BigInt(timestamp), true); // true = little-endian
            
            // Copy audio data after languages and timestamp (starting at byte 10)
            const combinedArray = new Uint8Array(combinedBuffer);
            combinedArray.set(audioData, 10);
            
            socket.send(combinedBuffer);
        }
    };

    // Handle Messages FROM Server (Receiving Text)
    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('[Offscreen] 📨 Received from server:', data);
            
            if (data.type === 'transcription') {
                console.log('[Offscreen] 📝 Transcription:', {
                    text: data.text,
                    start: data.start,
                    end: data.end,
                    // timestamp: data.timestamp,
                    startClock: data.startClock
                });
                // Send to Background, which forwards to Content Script
                chrome.runtime.sendMessage({
                    type: 'TRANSCRIPTION_RESULT',
                    text: data.text,
                    start: data.start,
                    end: data.end,
                    // timestamp: data.timestamp,
                    startClock: data.startClock
                });
            }
        } catch (e) {
            console.error("[Offscreen] ❌ Error parsing server message:", e);
        }
    };

    // Connect Graph
    // Source -> Worklet -> Destination (to keep audio alive)
    source.connect(workletNode);
    workletNode.connect(audioContext.destination);
    
    // Also connect Source -> Destination directly so user hears the audio clearly
    source.connect(audioContext.destination);
    
    console.log('[Offscreen] ✅ Audio pipeline connected and streaming'); 
}

function stopCapture() {
    console.log('[Offscreen] Stopping capture...');
    if (socket) {
        socket.close();
        socket = null;
    }
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    if (processor) {
        processor.disconnect();
        processor = null;
    }
    console.log("[Offscreen] ✅ Capture stopped");
}

// Hàm helper chuyển đổi format
function convertFloat32ToInt16(buffer) {
    let l = buffer.length;
    let buf = new Int16Array(l);
    while (l--) {
        // Clamp giá trị trong khoảng -1 đến 1 và nhân với 32767
        buf[l] = Math.min(1, Math.max(-1, buffer[l])) * 0x7FFF;
    }
    return buf.buffer;
}