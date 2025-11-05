# YouTube Subtitle Generator Extension

## 🎯 Tính Năng

- ✨ Giao diện hiện đại với gradient và animations
- ⚙️ Cấu hình backend URL linh hoạt (để testing)
- 📊 Hiển thị tiến trình trực quan với icon và màu sắc
- 🎬 Xem trước thông tin video với thumbnail
- 🌐 Hỗ trợ nhiều ngôn ngữ
- 📝 Hiển thị phụ đề trực tiếp trên video

## 🚀 Cài Đặt

### 1. Cài đặt Extension

1. Mở Chrome và truy cập `chrome://extensions/`
2. Bật "Developer mode" ở góc trên bên phải
3. Click "Load unpacked"
4. Chọn thư mục chứa extension này

### 2. Cài đặt Backend Server

```bash
cd server
pip install -r requirements.txt
python app.py
```

Server sẽ chạy tại `http://127.0.0.1:5000`

## 📖 Cách Sử Dụng

### Lần đầu sử dụng:

1. Click vào icon extension
2. Nhập URL backend server (ví dụ: `http://127.0.0.1:5000`)
3. Click "Kiểm Tra" để test kết nối
4. Click "Lưu & Tiếp Tục"

### Tạo phụ đề:

1. Mở một video YouTube
2. Click vào icon extension
3. Chọn ngôn ngữ gốc của video
4. Click "Tạo Phụ Đề"
5. Xem trạng thái xử lý trên trang web
6. Phụ đề sẽ hiển thị tự động khi xử lý xong

## 🎨 Giao Diện Mới

### Config Screen (`config.html`)
- Màn hình cấu hình backend URL
- Kiểm tra kết nối trước khi lưu
- Giao diện gradient hiện đại
- Thông báo trạng thái trực quan

### Main UI (`popup.html`)
- Card hiển thị thông tin video với thumbnail
- Progress bar với shimmer effect
- Icons và màu sắc cho từng trạng thái
- Nút cài đặt để quay lại config
- Responsive và modern design

### Status Display (on YouTube page)
- Floating status card với blur effect
- Icons động thay đổi theo trạng thái
- Màu sắc tương ứng với loại tiến trình
- Animation slide-in/out mượt mà

## 🔧 Mock Subtitle

Khi backend chỉ trả về HTTP 200 mà không có dữ liệu subtitle, extension sẽ tự động hiển thị mock subtitle:

```javascript
const mockSubtitles = [
    { start: 0, end: 5, text: "OK - Đã nhận phản hồi từ server" },
    { start: 5, end: 10, text: "Phụ đề mẫu đang hiển thị" },
    { start: 10, end: 15, text: "Backend sẽ cập nhật dữ liệu thực" }
];
```

## 📝 Backend API

### Health Check
```
GET /health
Response: { "status": "ok", "message": "Server đang hoạt động", "version": "1.1" }
```

### Process Video
```
POST /process
Body: { "video_url": "...", "language_code": "vi-VN" }
Response: { "status": "received", "video_id": "...", "message": "..." }
```

### Check Status
```
GET /status?video_id=...
Response: { 
    "status": "transcription_complete|processing|error", 
    "message": "...",
    "progress": 0-100,
    "subtitles": [...]  // optional
}
```

## 🎯 Status Types & Icons

- ⏳ `loading` - Đang kết nối
- ✅ `success` - Thành công
- ❌ `error` - Lỗi
- ⚙️ `processing` - Đang xử lý
- 📥 `download` - Đang tải
- 📝 `transcribe` - Đang chuyển đổi

## 🔮 Roadmap

- [ ] Remove config screen khi release product
- [ ] Tích hợp với backend thực
- [ ] Thêm tùy chọn style phụ đề
- [ ] Export phụ đề ra file SRT
- [ ] Multi-language subtitle translation
