document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('startButton');
    const statusText = document.getElementById('status-text');
    const languageSelect = document.getElementById('language-select');
    const thumbnailImg = document.getElementById('video-thumbnail');
    const titleText = document.getElementById('video-title');
    const progressBarFill = document.getElementById('progress-bar-fill');

    async function getVideoInfo() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url || !tab.url.includes("youtube.com/watch")) {
            titleText.textContent = "Không phải trang video YouTube";
            startButton.disabled = true;
            return;
        }

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                const title = document.querySelector('h1.style-scope.ytd-watch-metadata')?.innerText;
                const thumbnail = document.querySelector('link[rel="image_src"]')?.href;
                return { title, thumbnail };
            }
        });

        const { title, thumbnail } = results[0].result;
        if (title) titleText.textContent = title;
        if (thumbnail) thumbnailImg.src = thumbnail;
    }

    getVideoInfo();

    startButton.addEventListener('click', async () => {
        startButton.disabled = true;
        languageSelect.disabled = true;
        statusText.textContent = 'Đang gửi yêu cầu...';
        progressBarFill.style.width = '30%';

        const selectedLang = languageSelect.value;
        await chrome.storage.local.set({ 'selectedLanguage': selectedLang });
        
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        }, () => {
            statusText.textContent = 'Đã gửi! Xem trạng thái trên trang web.';
            progressBarFill.style.width = '100%';
            setTimeout(() => window.close(), 1500);
        });
    });
});