console.log('Content script đang chạy...');

(async () => {
    const storage = await chrome.storage.local.get(['selectedLanguage', 'serverUrl']);
    const languageCode = storage.selectedLanguage || 'vi-VN';
    const serverUrl = storage.serverUrl || 'http://127.0.0.1:5000';

    const oldStatusDisplay = document.getElementById('audio-fetcher-status');
    if (oldStatusDisplay) oldStatusDisplay.remove();

    const statusDisplay = document.createElement('div');
    statusDisplay.id = 'audio-fetcher-status';
    statusDisplay.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
            <div id="status-icon" style="font-size: 20px;">⏳</div>
            <p id="status-text-on-page" style="margin: 0; flex: 1; font-size: 14px;"></p>
        </div>
        <div style="width: 100%; background-color: #444; border-radius: 8px; overflow: hidden; height: 6px;">
            <div id="progress-bar-on-page" style="width: 0%; height: 100%; background: linear-gradient(90deg, #3ea6ff, #68bfff); transition: width 0.5s ease; position: relative;">
                <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent); animation: shimmer 2s infinite;"></div>
            </div>
        </div>
        <style>
            @keyframes shimmer {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(100%); }
            }
        </style>
    `;
    Object.assign(statusDisplay.style, {
        position: 'fixed', 
        top: '80px', 
        right: '20px', 
        backgroundColor: '#282828',
        color: 'white', 
        padding: '18px', 
        borderRadius: '12px', 
        zIndex: '9999',
        fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif', 
        fontSize: '14px', 
        border: '1px solid #4d4d4d',
        boxShadow: '0 6px 20px rgba(0,0,0,0.5)', 
        width: '320px',
        backdropFilter: 'blur(10px)',
        animation: 'slideIn 0.3s ease'
    });
    
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateX(50px);
            }
            to {
                opacity: 1;
                transform: translateX(0);
            }
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(statusDisplay);

    const statusTextElement = document.getElementById('status-text-on-page');
    const statusIconElement = document.getElementById('status-icon');
    const progressBarElement = document.getElementById('progress-bar-on-page');

    function updateStatus(message, progress, type = 'loading') {
        if (message) statusTextElement.textContent = message;
        if (progress !== null && progress !== undefined) {
            progressBarElement.style.width = `${progress}%`;
        }
        
        const icons = {
            loading: '⏳',
            success: '✅',
            error: '❌',
            processing: '⚙️',
            download: '📥',
            transcribe: '📝'
        };
        
        const colors = {
            loading: '#3ea6ff',
            success: '#4caf50',
            error: '#e74c3c',
            processing: '#ff9800',
            download: '#9c27b0',
            transcribe: '#00bcd4'
        };
        
        if (icons[type]) statusIconElement.textContent = icons[type];
        if (colors[type]) statusDisplay.style.borderColor = colors[type];
    }

    function setupSubtitleDisplay(subtitleData) {
        const videoElement = document.querySelector('video.html5-main-video');
        const videoContainer = document.querySelector('.html5-video-player');
        if (!videoElement || !videoContainer) return;

        let subtitleContainer = document.getElementById('custom-subtitle-container');
        if (!subtitleContainer) {
            subtitleContainer = document.createElement('div');
            subtitleContainer.id = 'custom-subtitle-container';
            Object.assign(subtitleContainer.style, {
                position: 'absolute', 
                bottom: '12%', 
                left: '50%', 
                transform: 'translateX(-50%)',
                color: 'white', 
                backgroundColor: 'rgba(0, 0, 0, 0.85)', 
                padding: '12px 24px',
                borderRadius: '8px', 
                fontSize: '28px', 
                fontFamily: '"Segoe UI", Arial, sans-serif',
                textAlign: 'center', 
                zIndex: '9998', 
                pointerEvents: 'none', 
                maxWidth: '85%',
                textShadow: '2px 2px 6px rgba(0,0,0,0.9)',
                fontWeight: '600',
                lineHeight: '1.4',
                letterSpacing: '0.5px'
            });
            videoContainer.appendChild(subtitleContainer);
        }

        videoElement.addEventListener('timeupdate', () => {
            const currentTime = videoElement.currentTime;
            const currentSubtitle = subtitleData.find(
                line => currentTime >= line.start && currentTime <= line.end
            );
            subtitleContainer.textContent = currentSubtitle ? currentSubtitle.text : '';
        });
    }

    try {
        updateStatus('Đang kết nối server...', 10, 'loading');
        const videoUrl = window.location.href;

        const initialResponse = await fetch(`${serverUrl}/transcribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_url: videoUrl, language_code: languageCode }),
        });
        
        const initialData = await initialResponse.json();

        if (initialResponse.ok && initialResponse.status === 200) {
            updateStatus('Server đã nhận yêu cầu', 20, 'success');
            
            // Check if we have actual subtitle data
            if (initialData.subtitles && Array.isArray(initialData.subtitles) && initialData.subtitles.length > 0) {
                // Use real subtitle data
                updateStatus('Phụ đề đã sẵn sàng!', 100, 'success');
                setupSubtitleDisplay(initialData.subtitles);
                setTimeout(() => { 
                    statusDisplay.style.opacity = '0'; 
                    statusDisplay.style.transform = 'translateX(50px)';
                    setTimeout(() => statusDisplay.remove(), 300);
                }, 3000);
            } else if (initialData.status === 'received' && initialData.video_id) {
                // Poll for status updates
                const intervalId = setInterval(async () => {
                    try {
                        const statusResponse = await fetch(`${serverUrl}/status?video_id=${initialData.video_id}`);
                        const statusData = await statusResponse.json();

                        // Determine status type based on message
                        let statusType = 'processing';
                        if (statusData.message.includes('tải')) statusType = 'download';
                        if (statusData.message.includes('chuyển đổi') || statusData.message.includes('transcrib')) statusType = 'transcribe';

                        updateStatus(statusData.message, statusData.progress, statusType);

                        if (statusData.status === 'transcription_complete') {
                            clearInterval(intervalId);
                            
                            if (statusData.subtitles && Array.isArray(statusData.subtitles)) {
                                setupSubtitleDisplay(statusData.subtitles);
                                updateStatus('Phụ đề đã sẵn sàng!', 100, 'success');
                            } else {
                                // Mock subtitle for testing
                                const mockSubtitles = [
                                    { start: 0, end: 5, text: "OK - Phụ đề mẫu đã được tạo" },
                                    { start: 5, end: 10, text: "Đây là dòng phụ đề thứ hai" },
                                    { start: 10, end: 15, text: "Backend sẽ gửi dữ liệu thực sau" }
                                ];
                                setupSubtitleDisplay(mockSubtitles);
                                updateStatus('✨ Hoàn tất! (Mock subtitle)', 100, 'success');
                            }
                            
                            setTimeout(() => { 
                                statusDisplay.style.opacity = '0'; 
                                statusDisplay.style.transform = 'translateX(50px)';
                                setTimeout(() => statusDisplay.remove(), 300);
                            }, 5000);
                        } else if (statusData.status === 'error') {
                            clearInterval(intervalId);
                            updateStatus(`Lỗi: ${statusData.message}`, statusData.progress, 'error');
                        }
                    } catch (pollError) {
                        clearInterval(intervalId);
                        updateStatus('Lỗi kết nối khi kiểm tra trạng thái', null, 'error');
                    }
                }, 2000);
            } else {
                // If backend just returns 200 OK without subtitle data or polling info
                const mockSubtitles = [
                    { start: 0, end: 5, text: "OK - Đã nhận phản hồi từ server" },
                    { start: 5, end: 10, text: "Phụ đề mẫu đang hiển thị" },
                    { start: 10, end: 15, text: "Backend sẽ cập nhật dữ liệu thực" }
                ];
                setupSubtitleDisplay(mockSubtitles);
                updateStatus('✨ Hoàn tất! (Mock subtitle)', 100, 'success');
                setTimeout(() => { 
                    statusDisplay.style.opacity = '0'; 
                    statusDisplay.style.transform = 'translateX(50px)';
                    setTimeout(() => statusDisplay.remove(), 300);
                }, 5000);
            }
        } else {
            updateStatus(`Server phản hồi: ${initialData.message || 'Lỗi không xác định'}`, 100, 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        updateStatus('❌ Không thể kết nối đến server', 100, 'error');
    }
})();