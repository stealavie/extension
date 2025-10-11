import threading
import time
from flask import Flask, request, jsonify
from flask_cors import CORS
import yt_dlp
import os

app = Flask(__name__)
CORS(app)

processing_jobs = {}

MOCK_SUBTITLE_DATA = [
    {"start": 0.5, "end": 4.0, "text": "Xin chào, đây là phụ đề được gửi từ server."},
    {"start": 4.2, "end": 7.8, "text": "Quá trình này mô phỏng API Speech-to-Text."},
    {"start": 8.0, "end": 11.5, "text": "Backend xử lý audio và trả kết quả về."},
    {"start": 12.0, "end": 15.0, "text": "Extension chỉ có nhiệm vụ hiển thị."},
    {"start": 15.2, "end": 17.5, "text": "...mô hình này chính xác hơn."},
    {"start": 18.0, "end": 22.3, "text": "Đây là câu đầu tiên của chunk thứ hai."},
    {"start": 22.8, "end": 26.5, "text": "Như bạn thấy, mọi thứ hoạt động rất mượt mà."},
    {"start": 27.0, "end": 30.0, "text": "Bước tiếp theo sẽ là tích hợp API thật."},
    {"start": 30.5, "end": 34.0, "text": "Chúng ta sẽ thay thế dữ liệu giả này bằng kết quả thực tế."},
    {"start": 34.5, "end": 39.0, "text": "Chúc các bạn thành công với dự án của mình!"}
]

def process_video_in_background(video_url, video_id, language_code):
    try:
        processing_jobs[video_id] = {'status': 'downloading', 'message': 'Đang tải file audio...', 'progress': 25}
        output_filename = os.path.join('downloads', f'{video_id}.mp3')
        os.makedirs('downloads', exist_ok=True)
        ydl_opts = {
            'format': 'bestaudio/best', 'outtmpl': output_filename,
            'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192',}],
            'noplaylist': True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])
        
        print(f"✅ Audio cho {video_id} đã tải xong.")
        processing_jobs[video_id].update({'status': 'download_complete', 'message': 'Tải audio xong, bắt đầu tạo phụ đề...', 'progress': 50})
        
        # Giai đoạn 2: Giả lập quá trình Transcribe
        print(f"▶️ Bắt đầu tạo phụ đề giả cho video {video_id} với ngôn ngữ {language_code}")
        time.sleep(2)
        processing_jobs[video_id].update({'status': 'transcribing', 'message': 'Đang xử lý âm thanh...', 'progress': 75})
        time.sleep(3)
        
        print(f"✅ Tạo phụ đề cho {video_id} hoàn tất.")
        processing_jobs[video_id] = {
            'status': 'transcription_complete',
            'message': 'Hoàn tất! Phụ đề đã sẵn sàng.',
            'progress': 100,
            'subtitles': MOCK_SUBTITLE_DATA
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

if __name__ == '__main__':
    print("🚀 Server đang chạy tại http://127.0.0.1:5000")
    app.run(host='0.0.0.0', port=5000)