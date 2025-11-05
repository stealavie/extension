document.addEventListener('DOMContentLoaded', async () => {
    const serverUrlInput = document.getElementById('serverUrl');
    const saveButton = document.getElementById('saveButton');
    const testButton = document.getElementById('testButton');
    const statusMessage = document.getElementById('statusMessage');

    // Load saved URL
    const { serverUrl } = await chrome.storage.local.get('serverUrl');
    if (serverUrl) {
        serverUrlInput.value = serverUrl;
    }

    function showStatus(message, type) {
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type}`;
        statusMessage.style.display = 'block';
        
        if (type === 'success') {
            setTimeout(() => {
                statusMessage.style.display = 'none';
            }, 3000);
        }
    }

    async function testConnection(url) {
        try {
            const response = await fetch(`${url}/health`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (response.ok) {
                return { success: true, message: 'Kết nối thành công!' };
            } else {
                return { success: false, message: `Server phản hồi lỗi: ${response.status}` };
            }
        } catch (error) {
            return { success: false, message: 'Không thể kết nối đến server' };
        }
    }

    testButton.addEventListener('click', async () => {
        const url = serverUrlInput.value.trim();
        
        if (!url) {
            showStatus('Vui lòng nhập URL server', 'error');
            return;
        }

        testButton.disabled = true;
        showStatus('Đang kiểm tra kết nối...', 'info');

        const result = await testConnection(url);
        
        if (result.success) {
            showStatus(result.message, 'success');
        } else {
            showStatus(result.message, 'error');
        }
        
        testButton.disabled = false;
    });

    saveButton.addEventListener('click', async () => {
        const url = serverUrlInput.value.trim();
        
        if (!url) {
            showStatus('Vui lòng nhập URL server', 'error');
            return;
        }

        saveButton.disabled = true;
        showStatus('Đang lưu cấu hình...', 'info');

        await chrome.storage.local.set({ serverUrl: url });
        
        showStatus('Đã lưu! Đang chuyển...', 'success');
        
        setTimeout(() => {
            window.location.href = 'popup.html';
        }, 800);
    });

    // Enter key to save
    serverUrlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveButton.click();
        }
    });
});
