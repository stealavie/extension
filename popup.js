document.addEventListener('DOMContentLoaded', async () => {
    const startButton = document.getElementById('startButton');
    const configButton = document.getElementById('configButton');
    const statusText = document.getElementById('status-text');
    const languageSelect = document.getElementById('language-select');
    const thumbnailImg = document.getElementById('video-thumbnail');
    const titleText = document.getElementById('video-title');
    const progressBarFill = document.getElementById('progress-bar-fill');

    // Check if server URL is configured
    const { serverUrl } = await chrome.storage.local.get('serverUrl');
    if (!serverUrl) {
        window.location.href = 'config.html';
        return;
    }

    async function getVideoInfo() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url || !tab.url.includes("youtube.com/watch")) {
            titleText.textContent = "❌ Không phải trang video YouTube";
            startButton.disabled = true;
            statusText.textContent = "Vui lòng mở một video YouTube";
            statusText.className = 'error-message';
            return;
        }

        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const title = document.querySelector('h1.style-scope.ytd-watch-metadata')?.innerText || 
                                 document.querySelector('h1.title')?.innerText;
                    const thumbnail = document.querySelector('link[rel="image_src"]')?.href ||
                                     document.querySelector('meta[property="og:image"]')?.content;
                    const channel = document.querySelector('ytd-channel-name a')?.innerText ||
                                   document.querySelector('#owner-name a')?.innerText;
                    return { title, thumbnail, channel };
                }
            });

            const { title, thumbnail, channel } = results[0].result;
            
            if (title) {
                titleText.textContent = title;
            }
            
            if (thumbnail) {
                thumbnailImg.src = thumbnail;
            } else {
                thumbnailImg.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="68"><rect fill="%23333"/></svg>';
            }
            
            if (channel) {
                document.getElementById('video-channel').textContent = `📺 ${channel}`;
            }

            statusText.textContent = "✅ Sẵn sàng tạo phụ đề";
            statusText.className = 'success-message';
        } catch (error) {
            console.error('Error getting video info:', error);
            titleText.textContent = "Lỗi khi tải thông tin video";
            statusText.textContent = "⚠️ Không thể tải thông tin video";
            statusText.className = 'error-message';
        }
    }

    await getVideoInfo();

    configButton.addEventListener('click', () => {
        window.location.href = 'config.html';
    });

    startButton.addEventListener('click', async () => {
        startButton.disabled = true;
        configButton.disabled = true;
        languageSelect.disabled = true;
        statusText.textContent = '⏳ Đang gửi yêu cầu...';
        statusText.className = '';
        progressBarFill.style.width = '30%';

        const selectedLang = languageSelect.value;
        await chrome.storage.local.set({ 'selectedLanguage': selectedLang });
        
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
            });
            
            statusText.textContent = '✅ Đã gửi! Xem trạng thái trên trang web.';
            statusText.className = 'success-message';
            progressBarFill.style.width = '100%';
            
            setTimeout(() => window.close(), 1500);
        } catch (error) {
            console.error('Error executing script:', error);
            statusText.textContent = '❌ Lỗi: Không thể thực thi script';
            statusText.className = 'error-message';
            startButton.disabled = false;
            configButton.disabled = false;
            languageSelect.disabled = false;
            progressBarFill.style.width = '0%';
        }
    });
});