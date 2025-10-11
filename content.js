console.log('Content script đang chạy...');

(async () => {
    const { selectedLanguage } = await chrome.storage.local.get('selectedLanguage');
    const languageCode = selectedLanguage || 'vi-VN';

    const oldStatusDisplay = document.getElementById('audio-fetcher-status');
    if (oldStatusDisplay) oldStatusDisplay.remove();

    const statusDisplay = document.createElement('div');
    statusDisplay.id = 'audio-fetcher-status';
    statusDisplay.innerHTML = `
        <p id="status-text-on-page" style="margin: 0 0 8px 0;"></p>
        <div style="width: 100%; background-color: #555; border-radius: 4px; overflow: hidden;">
            <div id="progress-bar-on-page" style="width: 0%; height: 5px; background-color: #3ea6ff; transition: width 0.5s ease;"></div>
        </div>
    `;
    Object.assign(statusDisplay.style, {
        position: 'fixed', top: '80px', right: '20px', backgroundColor: '#282828',
        color: 'white', padding: '15px', borderRadius: '8px', zIndex: '9999',
        fontFamily: 'Arial, sans-serif', fontSize: '14px', border: '1px solid #333',
        boxShadow: '0 4px 8px rgba(0,0,0,0.3)', width: '250px'
    });
    document.body.appendChild(statusDisplay);

    const statusTextElement = document.getElementById('status-text-on-page');
    const progressBarElement = document.getElementById('progress-bar-on-page');

    function updateStatus(message, progress, isError = false) {
        if (message) statusTextElement.textContent = message;
        if (progress !== null && progress !== undefined) {
            progressBarElement.style.width = `${progress}%`;
        }
        statusDisplay.style.borderColor = isError ? '#e74c3c' : '#333';
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
                position: 'absolute', bottom: '10%', left: '50%', transform: 'translateX(-50%)',
                color: 'white', backgroundColor: 'rgba(0, 0, 0, 0.7)', padding: '10px 20px',
                borderRadius: '8px', fontSize: '24px', fontFamily: 'Arial, sans-serif',
                textAlign: 'center', zIndex: '9998', pointerEvents: 'none', maxWidth: '80%',
                textShadow: '2px 2px 4px black'
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
        updateStatus('Đang gửi yêu cầu...', 10);
        const videoUrl = window.location.href;
        const initialResponse = await fetch('http://127.0.0.1:5000/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_url: videoUrl, language_code: languageCode }),
        });
        const initialData = await initialResponse.json();

        if (initialData.status === 'received') {
            updateStatus('Server đã nhận yêu cầu.', 15);
            const intervalId = setInterval(async () => {
                try {
                    const statusResponse = await fetch(`http://127.0.0.1:5000/status?video_id=${initialData.video_id}`);
                    const statusData = await statusResponse.json();

                    updateStatus(statusData.message, statusData.progress);

                    if (statusData.status === 'transcription_complete') {
                        clearInterval(intervalId);
                        setupSubtitleDisplay(statusData.subtitles);
                        setTimeout(() => { statusDisplay.style.opacity = '0'; statusDisplay.style.pointerEvents = 'none'; }, 5000);
                    } else if (statusData.status === 'error') {
                        clearInterval(intervalId);
                        updateStatus(`Lỗi: ${statusData.message}`, statusData.progress, true);
                    }
                } catch (pollError) {
                    clearInterval(intervalId);
                    updateStatus('Lỗi kết nối khi kiểm tra trạng thái.', null, true);
                }
            }, 2000);
        } else {
            updateStatus(`Server phản hồi: ${initialData.message}`, 100, true);
        }
    } catch (error) {
        updateStatus('Lỗi: Không thể gửi yêu cầu đến server.', 100, true);
    }
})();