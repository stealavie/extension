let socket = null;
let audioContext = null;
let processor = null;
let stream = null;
let currentConfig = null;
let maxCapturedTime = 0; // Track the furthest timestamp we've sent audio for

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
        // Update our max captured time tracker
        if (message.timestamp > maxCapturedTime) {
            maxCapturedTime = message.timestamp;
        }
        
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

    // WebSocket Setup - Use URL from config
    socket = new WebSocket(currentConfig.wsUrl);
    socket.binaryType = "arraybuffer"; 

    socket.onopen = () => {
        console.log("[Offscreen] ✅ WebSocket Connected to:", currentConfig.wsUrl);
        // Send configuration to server
        socket.send(JSON.stringify({
            type: 'config',
            transcriptionModel: currentConfig.asrModel,
            translationModel: currentConfig.translationModel,
            sourceLang: 'auto',
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
            // Prepend header: [origin_lang (1 byte), target_lang (1 byte), timestamp (8 bytes)]
            const audioData = e.data;
            const headerSize = 10; // 1 + 1 + 8 bytes
            const packet = new Uint8Array(headerSize + audioData.byteLength);
            
            // Byte 0: Source/Origin Language (0=English, 1=Vietnamese)
            packet[0] = currentConfig.sourceLang || 0;
            
            // Byte 1: Target Language (0=English, 1=Vietnamese)
            packet[1] = currentConfig.targetLang || 1;
            
            // Bytes 2-9: Timestamp (8 bytes, uint64 little-endian)
            const timestamp = BigInt(Date.now());
            const view = new DataView(packet.buffer);
            view.setBigUint64(2, timestamp, true); // true = little-endian
            
            // Bytes 10+: Audio data (Int16Array as bytes)
            packet.set(new Uint8Array(audioData.buffer), headerSize);
            
            // Send the complete packet
            socket.send(packet);
            
            // Update maxCapturedTime based on audio buffer duration
            // Assuming each packet represents ~0.1 seconds of audio
            maxCapturedTime += 0.1;
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
                    timestamp: data.timestamp
                });
                
                // Update maxCapturedTime based on server response
                if (data.end > maxCapturedTime) {
                    maxCapturedTime = data.end;
                }
                
                // Send to Background, which forwards to Content Script
                chrome.runtime.sendMessage({
                    type: 'TRANSCRIPTION_RESULT',
                    text: data.text,
                    start: data.start,
                    end: data.end,
                    timestamp: data.timestamp
                });
            }
        } catch (e) {
            console.error("[Offscreen] ❌ Error parsing server message:", e);
        }
    };
    
    // Periodically broadcast maxCapturedTime to content script
    setInterval(() => {
        try {
            chrome.runtime.sendMessage({
                type: 'MAX_CAPTURED_TIME_UPDATE',
                timestamp: maxCapturedTime
            });
        } catch (e) {
            // Ignore if content script is not ready
        }
    }, 1000); // Every second

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