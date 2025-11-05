import json
import threading
import time
from flask import Flask, request, jsonify
from flask_cors import CORS
import yt_dlp
import requests
import os

app = Flask(__name__)
CORS(app)

processing_jobs = {}

SERVER_URL = "https://8803b6a4d8ff.ngrok-free.app/upload"

def process_video_in_background(video_url, video_id, language_code):
    try:
        processing_jobs[video_id] = {'status': 'downloading', 'message': 'Đang tải file audio...', 'progress': 25}
        output_filename = os.path.join('downloads', f'{video_id}')
        os.makedirs('downloads', exist_ok=True)
        ydl_opts = {
            # From the first dict
            'format': 'bestaudio/best',
            'outtmpl': output_filename, # Make sure 'output_filename' is defined
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'noplaylist': True,
            
            # From the second dict
            'extractor_args': {
                'youtube': {
                    'player_client': ['default', '-tv_simply'],
                },
            },
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])
        
        print(f"✅ Audio cho {video_id} đã tải xong.")
        processing_jobs[video_id].update({'status': 'download_complete', 'message': 'Tải audio xong, bắt đầu tạo phụ đề...', 'progress': 50})
        
        # Giai đoạn 2: Giả lập quá trình Transcribe
        print(f"▶️ Bắt đầu tạo phụ đề giả cho video {video_id} với ngôn ngữ {language_code}")
        time.sleep(2)
        processing_jobs[video_id].update({'status': 'transcribing', 'message': 'Đang xử lý âm thanh...', 'progress': 75})
        # Đường dẫn đến file âm thanh bạn muốn gửi
        try:
            with open(f"{output_filename}.mp3", 'rb') as f:
                files = {'file': (f"{output_filename}.mp3", f)}
                response = requests.post(SERVER_URL, files=files)
                
                # In status code trước
                print(f"Status Code: {response.status_code}")

                # Thử parse JSON
                response_data = response.json()
                print(f"Response JSON: {response_data}")

        except json.JSONDecodeError:
            # Đây chính là lỗi của bạn! 
            # Nó xảy ra khi server không trả về JSON (ví dụ: trả về HTML lỗi)
            print("--- LỖI: Không thể decode JSON từ server ---")
            print("Đây là nội dung thô (text) mà server đã trả về:")
            print(response.text) # In ra nội dung HTML/text để gỡ lỗi

        except FileNotFoundError:
            print(f"Lỗi: Không tìm thấy file tại '{output_filename}'")
        except requests.exceptions.ConnectionError:
            print(f"Lỗi: Không thể kết nối đến server tại '{SERVER_URL}'.")
            print("Bạn đã chạy server 'audio_upload_app.py' chưa?")
        except Exception as e:
            print(f"Đã xảy ra một lỗi khác: {e}")
        
        print(f"✅ Tạo phụ đề cho {video_id} hoàn tất.")
        processing_jobs[video_id] = {
            'status': 'transcription_complete',
            'message': 'Hoàn tất! Phụ đề đã sẵn sàng.',
            'progress': 100,
            # 'subtitles': MOCK_SUBTITLE_DATA
        }

    except Exception as e:
        print(f"❌ Lỗi khi xử lý video {video_id}: {e}")
        processing_jobs[video_id] = {'status': 'error', 'message': str(e)}

@app.route('/process', methods=['POST'])
def process_video_request():
    data = request.get_json()
    video_url = data.get('video_url')
    language_code = data.get('language_code', 'vi-VN')
    if not video_url or 'v=' not in video_url:
        return jsonify({'status': 'error', 'message': 'URL video không hợp lệ'}), 400
    video_id = video_url.split('v=')[1].split('&')[0]
    if video_id in processing_jobs and processing_jobs[video_id]['status'] not in ['error', 'not_found']:
         return jsonify({'status': 'already_processed', 'message': 'Video này đang được xử lý hoặc đã xử lý xong.'})

    thread = threading.Thread(target=process_video_in_background, args=(video_url, video_id, language_code))
    thread.start()
    return jsonify({'status': 'received', 'message': 'Đã nhận yêu cầu.', 'video_id': video_id})

@app.route('/status', methods=['GET'])
def get_status():
    video_id = request.args.get('video_id')
    if not video_id:
        return jsonify({'status': 'error', 'message': 'Thiếu video_id'}), 400
    job_status = processing_jobs.get(video_id, {'status': 'not_found'})
    return jsonify(job_status)

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint for testing server connectivity"""
    return jsonify({
        'status': 'ok', 
        'message': 'Server đang hoạt động',
        'version': '1.1'
    }), 200

if __name__ == '__main__':
    print("🚀 Server đang chạy tại http://127.0.0.1:5000")
    app.run(host='0.0.0.0', port=5000)