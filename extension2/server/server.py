import asyncio
import websockets
import torch
import numpy as np
import multiprocessing
import time
import json
import whisper
from pyngrok import ngrok

# --- CONFIGURATION ---
VAD_SAMPLE_RATE = 16000
VAD_WINDOW = 512       # Silero specific
SILENCE_LIMIT = 10     # 10 chunks * 32ms = ~320ms of silence marks "End of Sentence"
PORT=5001

# ==========================================
# PROCESS B: The Heavy ASR Worker
# ==========================================
def asr_worker_process(input_queue, output_queue):
    """
    Reads (audio_np, timestamp, duration) from input_queue.
    Writes {"text": ..., "start": ..., "end": ...} to output_queue.
    """
    print("[ASR Worker] Initializing Model...")

    # Load ASR Model here (e.g., Whisper)
    # We load it HERE so it lives in this process's memory

    model = whisper.load_model("large-v3") # 'tiny', 'base', 'small', etc.

    print("[ASR Worker] Model Loaded. Waiting for audio...")

    while True:
        try:
            # 1. Get data: (audio_np, start_time_seconds, duration)
            data_packet = input_queue.get()

            if data_packet is None: break

            audio_np, start_offset, duration = data_packet

            # 2. Transcribe
            # Whisper expects float32 array
            result = model.transcribe(audio_np, fp16=False)
            text = result['text'].strip()

            if text:
                end_offset = start_offset + duration
                print(f"[ASR] {start_offset:.2f}s -> {end_offset:.2f}s: {text}")

                # 3. Send result back to Main Process
                response = {
                    "type": "transcription",
                    "text": text,
                    "start": start_offset,
                    "end": end_offset
                }
                output_queue.put(response)

                # Write to File
                with open("transcription.txt", "a", encoding="utf-8") as f:
                    timestamp = time.strftime("%H:%M:%S")
                    f.write(f"[{timestamp}] ({start_offset:.2f}s) {text}\n")
            else:
                print("[ASR] (Empty transcription)")

        except Exception as e:
            print(f"[ASR Worker Error] {e}")

# ==========================================
# PROCESS A: WebSocket + VAD (Main Process)
# ==========================================
async def audio_handler(websocket, vad_model, asr_input_queue, asr_output_queue):
    print("[WebSocket] Client connected")

    # Buffers
    sentence_buffer = [] # Stores chunks of active speech
    silence_counter = 0  # Counts consecutive silent chunks
    is_speaking = False

    # --- TIME SYNCHRONIZATION STATE ---
    # The timestamp of the video when we last received a sync message
    anchor_video_time = 0.0
    # How many audio samples we have processed since that sync message
    samples_since_anchor = 0
    # Current playback speed (1.0, 1.5, 2.0, etc.)
    playback_rate = 1.0
    # Timestamp where the current sentence started
    sentence_start_video_time = 0.0

    try:
        while True:
            # 1. Check for ASR results to send back to Client
            while not asr_output_queue.empty():
                result = asr_output_queue.get_nowait()
                await websocket.send(json.dumps(result))

            # 2. Receive Data (Wait briefly)
            try:
                message = await asyncio.wait_for(websocket.recv(), timeout=0.05)
            except asyncio.TimeoutError:
                continue

            # 3. Handle Message Type
            if isinstance(message, str):
                # === JSON CONTROL MESSAGE ===
                try:
                    data = json.loads(message)

                    if data.get('type') == 'time_sync':
                        # Client says: "Video is exactly at X seconds right now"
                        anchor_video_time = float(data['timestamp'])
                        samples_since_anchor = 0 # Reset counter
                        # print(f"[Sync] Time reset to {anchor_video_time}s")

                    elif data.get('type') == 'playback_rate':
                        # Client says: "Video speed changed to X"
                        # Before changing rate, update anchor to current calculated time
                        # so we don't lose progress calculated with old rate
                        current_offset = (samples_since_anchor / VAD_SAMPLE_RATE) * playback_rate
                        anchor_video_time += current_offset
                        samples_since_anchor = 0

                        playback_rate = float(data['rate'])
                        print(f"[Sync] Speed set to {playback_rate}x")

                except json.JSONDecodeError:
                    print("[Error] Invalid JSON received")
                continue

            # === BINARY AUDIO MESSAGE ===
            # 4. Preprocessing
            audio_int16 = np.frombuffer(message, dtype=np.int16)
            audio_float32 = audio_int16.astype(np.float32) / 32768.0
            audio_tensor = torch.from_numpy(audio_float32)

            # 5. VAD Loop (Split big chunk into 512-sample small chunks)
            number_of_chunks = len(audio_tensor) // VAD_WINDOW

            for i in range(number_of_chunks):
                start = i * VAD_WINDOW
                end = start + VAD_WINDOW
                chunk = audio_tensor[start:end]

                # Calculate current video time for this specific chunk
                # Formula: Anchor + (AudioDuration * PlaybackRate)
                # AudioDuration = Samples / SampleRate
                chunk_duration_wall_clock = VAD_WINDOW / VAD_SAMPLE_RATE
                chunk_duration_video_time = chunk_duration_wall_clock * playback_rate

                current_video_time = anchor_video_time + ((samples_since_anchor + start) / VAD_SAMPLE_RATE) * playback_rate

                # Check VAD
                # Add dimension [1, 512]
                vad_prob = vad_model(chunk.unsqueeze(0), VAD_SAMPLE_RATE).item()

                if vad_prob > 0.7:
                    # SPEECH DETECTED
                    if not is_speaking:
                        print(".", end="", flush=True) # Visual indicator
                        # Mark exactly when this sentence started in VIDEO TIME
                        sentence_start_video_time = current_video_time

                    is_speaking = True
                    silence_counter = 0
                    sentence_buffer.append(chunk)
                else:
                    # SILENCE DETECTED
                    if is_speaking:
                        # We were speaking, now we are silent. Count silence.
                        sentence_buffer.append(chunk) # Keep slight silence for naturalness
                        silence_counter += 1

                        # 4. END OF SENTENCE LOGIC
                        if silence_counter >= SILENCE_LIMIT:
                            print(f"\n[VAD] End of sentence detected. Sending {len(sentence_buffer)} chunks to ASR...")

                            # Combine chunks into one big numpy array
                            full_audio = torch.cat(sentence_buffer).numpy()

                            # Calculate duration of the speech segment in video time
                            # (Total samples in buffer / Rate) * Speed
                            speech_duration = (len(full_audio) / VAD_SAMPLE_RATE) * playback_rate

                            # Send to ASR Process via Queue
                            asr_input_queue.put((full_audio, sentence_start_video_time, speech_duration))

                            # Reset
                            sentence_buffer = []
                            is_speaking = False
                            silence_counter = 0

            # Update sample counter
            samples_since_anchor += len(audio_tensor)

    except websockets.exceptions.ConnectionClosed:
        print("\n[WebSocket] Client disconnected")

async def main():
    # 1. Setup Ngrok Tunnel
    # Note: Ngrok http tunnel supports WebSockets automatically
    public_url = ngrok.connect(PORT).public_url
    print(f" * ngrok tunnel \"{public_url}\" -> \"ws://127.0.0.1:{PORT}\"")
    print(f" * CLIENT CONNECT URL: {public_url.replace('https', 'wss').replace('http', 'ws')}")

    # 2. Setup Multiprocessing Queue
    asr_input_queue = multiprocessing.Queue()
    asr_output_queue = multiprocessing.Queue()

    # 3. Start ASR Process
    p = multiprocessing.Process(target=asr_worker_process, args=(asr_input_queue, asr_output_queue))
    p.start()

    # 4. Load VAD Model (In Main Process)
    print("[Main] Loading VAD Model...")
    vad_model, utils = torch.hub.load(repo_or_dir='snakers4/silero-vad',
                                      model='silero_vad',
                                      force_reload=False)

    # 5. Start WebSocket Server
    print(f"[Main] Starting WebSocket Server on port {PORT}...")
    async with websockets.serve(lambda ws: audio_handler(ws, vad_model, asr_input_queue, asr_output_queue), "localhost", PORT):
        await asyncio.Future()  # Run forever

# Windows requires this guard for multiprocessing
if __name__ == "__main__":
    # Clear previous file
    open("transcription.txt", "w").close()

    try:
        # Attempt standard run (Works in Terminal)
        asyncio.run(main())
    except RuntimeError as e:
        if "running event loop" in str(e):
            print("⚠️  Detected Jupyter/Colab environment.")
            try:
                import nest_asyncio
                nest_asyncio.apply()
                print("✅ Applied nest_asyncio patch. Starting server...")
                asyncio.run(main())
            except ImportError:
                print("❌ Error: Please run '!pip install nest_asyncio' to use this in a notebook.")
                print("   Alternatively, you can manually run 'await main()' in a new cell.")
        else:
            raise e
    except KeyboardInterrupt:
        print("Stopping...")