// pcm-processor.js
class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        // Buffer size: 4096 samples (approx 256ms at 16kHz)
        // This prevents flooding the WebSocket with too many tiny packets
        this.bufferSize = 4096;
        this.buffer = new Int16Array(this.bufferSize);
        this.bytesWritten = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;

        const inputChannel = input[0]; // Mono channel

        for (let i = 0; i < inputChannel.length; i++) {
            let sample = inputChannel[i];

            // 1. Clamp the value between -1.0 and 1.0
            sample = Math.max(-1, Math.min(1, sample));

            // 2. Convert Float32 to Int16 (PCM)
            // 0x7FFF = 32767, 0x8000 = 32768
            const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            
            this.buffer[this.bytesWritten] = int16;
            this.bytesWritten++;

            // 3. Flush if buffer is full
            if (this.bytesWritten >= this.bufferSize) {
                this.flush();
            }
        }

        return true; // Keep processor alive
    }

    flush() {
        // Send the buffer to the main thread
        // We create a copy to send because the internal buffer will be reused
        const bufferToSend = this.buffer.slice(0, this.bytesWritten);
        
        // Post message (using Transferable objects for performance)
        this.port.postMessage(bufferToSend, [bufferToSend.buffer]);
        
        this.bytesWritten = 0;
    }
}

// Register the processor with the ID 'pcm-processor'
registerProcessor('pcm-processor', PCMProcessor);