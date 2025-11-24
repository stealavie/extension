```python
import asyncio
import websockets
import torch
import numpy as np
import multiprocessing
import time
import json
import whisper
from pyngrok import ngrok
import os

# --- CONFIGURATION ---
VAD_SAMPLE_RATE = 16000
VAD_WINDOW = 512       # Silero specific (512 samples)

# === VAD TRIGGER POINT CONFIGURATION ===
# Chunk duration: T_chunk = VAD_WINDOW / SAMPLE_RATE = 512 / 16000 = 0.032s (32ms)
SILENCE_THRESHOLD = 0.3  # seconds - Im lặng > 0.3s để cắt câu
SILENCE_CHUNKS = int(SILENCE_THRESHOLD / (VAD_WINDOW / VAD_SAMPLE_RATE))  # ~10 chunks

MIN_SENTENCE_LENGTH = 1.0  # seconds - Độ dài tối thiểu để ASR có ý nghĩa
MAX_SENTENCE_LENGTH = 8.0  # seconds - Force cut để tránh trễ quá lớn

PORT=5001

# ==========================================
# PROCESS B: The Heavy ASR Worker
# ==========================================
def asr_worker_process(input_queue, output_queue):
    """
    Reads messages from input_queue.
    Message format:
    1. Audio Data: {"type": "audio", "data": audio_np, "start": start_time, "duration": duration}
    2. Config: {"type": "config", "asrModel": "...", "targetLang": "..."}
    """
    print("[ASR Worker] Initializing...")

    # Check if CUDA is available for faster processing
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[ASR Worker] Using device: {device}")
    
    # Default Model
    current_model_name = "whisper-tiny"
    model = None
    
    def load_asr_model(model_name):
        nonlocal model
        print(f"[ASR Worker] Loading model: {model_name}...")
        try:
            if model_name == "whisper-tiny":
                model = whisper.load_model("tiny", device=device)
            elif model_name == "whisper-large-v3":
                model = whisper.load_model("large-v3", device=device)
            elif model_name == "whisper-finetune":
                # PLACEHOLDER: Insert path to your fine-tuned Whisper model
                finetune_path = "path/to/your/whisper-finetune.pt" 
                if os.path.exists(finetune_path):
                    model = whisper.load_model(finetune_path, device=device)
                else:
                    print(f"[ASR Worker] ⚠️ Fine-tune path not found: {finetune_path}. Fallback to base.")
                    model = whisper.load_model("base", device=device)
            elif model_name == "wav2vec":
                # PLACEHOLDER: Load Wav2Vec model from HuggingFace
                print("[ASR Worker] Wav2Vec requested (Placeholder implementation)")
                # from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
                # model = ...
                # For now fallback to whisper base to keep it running
                model = whisper.load_model("base", device=device)
            elif model_name == "wav2vec-finetune":
                # PLACEHOLDER: Insert path to your fine-tuned Wav2Vec model
                finetune_path = "path/to/your/wav2vec-finetune"
                print(f"[ASR Worker] Loading Wav2Vec fine-tune from {finetune_path} (Placeholder)")
                model = whisper.load_model("base", device=device)
            else:
                print(f"[ASR Worker] Unknown model {model_name}, using base.")
                model = whisper.load_model("base", device=device)
                
            print(f"[ASR Worker] ✅ Model {model_name} loaded.")
        except Exception as e:
            print(f"[ASR Worker] ❌ Error loading model: {e}")
            model = whisper.load_model("base", device=device)

    # Initial load
    load_asr_model(current_model_name)
    
    use_fp16 = device == "cuda"

    while True:
        try:
            message = input_queue.get()
            if message is None: break

            msg_type = message.get("type")

            if msg_type == "config":
                new_model = message.get("asrModel")
                target_lang = message.get("targetLang")
                print(f"[ASR Worker] ⚙️ Config received: Model={new_model}, Lang={target_lang}")
                
                if new_model and new_model != current_model_name:
                    current_model_name = new_model
                    load_asr_model(current_model_name)
                
                # Store target lang if needed for translation logic later
                # current_target_lang = target_lang 

            elif msg_type == "audio":
                audio_np = message["data"]
                start_offset = message["start"]
                duration = message["duration"]

                # Transcribe
                # Note: For real translation, you might use task='translate' and specify target language
                # But standard Whisper only translates TO English. 
                # For other languages, you typically transcribe then translate with another model.
                
                if model:
                    result = model.transcribe(
                        audio_np, 
                        fp16=use_fp16,
                        language=None, # Auto-detect or set specific
                        task='transcribe',
                        no_speech_threshold=0.6,
                        condition_on_previous_text=False,
                        beam_size=1,
                        best_of=1
                    )
                    text = result['text'].strip()

                    if text:
                        end_offset = start_offset + duration
                        print(f"[ASR] ⏱️ {start_offset:.2f}s -> {end_offset:.2f}s: {text}")

                        response = {
                            "type": "transcription",
                            "text": text,
                            "start": start_offset,
                            "end": end_offset
                        }
                        output_queue.put(response)

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
    sentence_buffer = [] 
    silence_counter = 0  
    is_speaking = False

    # Sync State
    anchor_video_time = 0.0
    samples_since_anchor = 0
    playback_rate = 1.0
    sentence_start_video_time = 0.0

    def send_to_asr():
        nonlocal sentence_buffer, is_speaking, silence_counter, sentence_start_video_time
        
        if len(sentence_buffer) == 0:
            return
            
        print(f"\n[VAD] ✂️ Cutting sentence. Sending {len(sentence_buffer)} chunks to ASR...")
        
        full_audio = torch.cat(sentence_buffer).numpy()
        speech_duration = (len(full_audio) / VAD_SAMPLE_RATE) * playback_rate
        
        # Send formatted message to ASR Worker
        asr_input_queue.put({
            "type": "audio",
            "data": full_audio,
            "start": sentence_start_video_time,
            "duration": speech_duration
        })
        
        sentence_buffer = []
        is_speaking = False
        silence_counter = 0

    try:
        while True:
            # 1. Check for ASR results
            while not asr_output_queue.empty():
                result = asr_output_queue.get_nowait()
                await websocket.send(json.dumps(result))

            # 2. Receive Data
            try:
                message = await asyncio.wait_for(websocket.recv(), timeout=0.05)
            except asyncio.TimeoutError:
                continue

            # 3. Handle Message
            if isinstance(message, str):
                try:
                    data = json.loads(message)

                    if data.get('type') == 'config':
                        print(f"[WebSocket] ⚙️ Config received: {data}")
                        # Forward config to ASR worker
                        asr_input_queue.put(data)

                    elif data.get('type') == 'time_sync':
                        anchor_video_time = float(data['timestamp'])
                        samples_since_anchor = 0
                        print(f"[Sync] ⏱️ Time reset to {anchor_video_time:.2f}s")

                    elif data.get('type') == 'playback_rate':
                        current_offset = (samples_since_anchor / VAD_SAMPLE_RATE) * playback_rate
                        anchor_video_time += current_offset
                        samples_since_anchor = 0
                        playback_rate = float(data['rate'])
                        print(f"[Sync] ⚡ Speed set to {playback_rate}x")

                except json.JSONDecodeError:
                    print("[Error] Invalid JSON received")
                continue

            # === BINARY AUDIO MESSAGE ===
            audio_int16 = np.frombuffer(message, dtype=np.int16)
            audio_float32 = audio_int16.astype(np.float32) / 32768.0
            audio_tensor = torch.from_numpy(audio_float32)

            # VAD Loop
            number_of_chunks = len(audio_tensor) // VAD_WINDOW

            for i in range(number_of_chunks):
                start = i * VAD_WINDOW
                end = start + VAD_WINDOW
                chunk = audio_tensor[start:end]

                current_video_time = anchor_video_time + ((samples_since_anchor + start) / VAD_SAMPLE_RATE) * playback_rate
                buffer_duration = (len(sentence_buffer) * VAD_WINDOW) / VAD_SAMPLE_RATE

                vad_prob = vad_model(chunk.unsqueeze(0), VAD_SAMPLE_RATE).item()

                if vad_prob > 0.7:
                    if not is_speaking:
                        print(".", end="", flush=True)
                        sentence_start_video_time = current_video_time

                    is_speaking = True
                    silence_counter = 0
                    sentence_buffer.append(chunk)
                    
                    if buffer_duration >= MAX_SENTENCE_LENGTH:
                        print(f" [FORCE CUT]", end="")
                        send_to_asr()
                        
                else:
                    if is_speaking:
                        sentence_buffer.append(chunk)
                        silence_counter += 1

                        if silence_counter >= SILENCE_CHUNKS and buffer_duration >= MIN_SENTENCE_LENGTH:
                            print(f" [SENTENCE END]", end="")
                            send_to_asr()

            samples_since_anchor += len(audio_tensor)

    except websockets.exceptions.ConnectionClosed:
        print("\n[WebSocket] Client disconnected")

async def main():
    public_url = ngrok.connect(PORT).public_url
    print(f" * ngrok tunnel \"{public_url}\" -> \"ws://127.0.0.1:{PORT}\"")
    print(f" * CLIENT CONNECT URL: {public_url.replace('https', 'wss').replace('http', 'ws')}")

    asr_input_queue = multiprocessing.Queue()
    asr_output_queue = multiprocessing.Queue()

    p = multiprocessing.Process(target=asr_worker_process, args=(asr_input_queue, asr_output_queue))
    p.start()

    print("[Main] Loading VAD Model...")
    vad_model, utils = torch.hub.load(repo_or_dir='snakers4/silero-vad',
                                      model='silero_vad',
                                      force_reload=False)

    print(f"[Main] Starting WebSocket Server on port {PORT}...")
    async with websockets.serve(lambda ws: audio_handler(ws, vad_model, asr_input_queue, asr_output_queue), "localhost", PORT):
        await asyncio.Future()

if __name__ == "__main__":
    open("transcription.txt", "w").close()
    try:
        asyncio.run(main())
    except RuntimeError as e:
        if "running event loop" in str(e):
            import nest_asyncio
            nest_asyncio.apply()
            asyncio.run(main())
        else:
            raise e
    except KeyboardInterrupt:
        print("Stopping...")
```