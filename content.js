console.log('Content script đang chạy...');

// --- Global variables for state management and cleanup ---
let currentTaskId = null; // Store the ID of the current running job
let pollingIntervalId = null; // Store the ID of the current polling timer
let currentVideoUrl = null; // Track the currently processing video URL
let allSubtitles = []; // Subtitle data array
let videoElement = null;
let subtitleContainer = null;
let timeUpdateListenerAttached = false;
let currentStartTime = 0;
let totalVideoDuration = null;

// Function to handle cleanup when navigating away from the current video
function cleanupOldJob() {
    console.log('Cleaning up previous job...');
    
    // 1. Clear the polling interval
    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }

    // 2. Remove the custom status display
    const statusDisplay = document.getElementById('audio-fetcher-status');
    if (statusDisplay) {
        statusDisplay.remove();
    }

    // 3. Remove the custom subtitle container
    const subtitleContainer = document.getElementById('custom-subtitle-container');
    if (subtitleContainer) {
        subtitleContainer.remove();
    }
    
    // 4. Reset subtitle data
    allSubtitles.length = 0;
    
    // Reset control variables
    currentStartTime = 0;
    timeUpdateListenerAttached = false; 
    totalVideoDuration = null;
    currentTaskId = null;
}


// Wrap the main execution logic into a function
async function main() {
    // Stop any previously running job and clean up the page elements
    cleanupOldJob(); 
    
    currentVideoUrl = window.location.href;

    // --- Configuration (inside main to refresh on navigation) ---
    const storage = await chrome.storage.local.get(['selectedLanguage', 'serverUrl']);
    const languageCode = storage.selectedLanguage || 'vi-VN';
    const serverUrl = storage.serverUrl || 'http://127.0.0.1:5000';
    
    const CHUNK_DURATION = 20; // seconds
    const POLLING_INTERVAL = 2000; // Poll every 2 seconds
    currentStartTime = 0; // Reset to 00:00
    totalVideoDuration = null; // Will be determined later

    // --- Status Display Setup ---
    // (Ensure this part creates the status display every time main() runs)
    const statusDisplay = document.createElement('div');
    statusDisplay.id = 'audio-fetcher-status';
    statusDisplay.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
            <div id="status-icon" style="font-size: 20px;">⏳</div>
            <p id="status-text-on-page" style="margin: 0; flex: 1; font-size: 14px;"></p>
        </div>
        <div id="progress-container" style="width: 100%; background-color: #444; border-radius: 8px; overflow: hidden; height: 6px;">
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
    const progressContainerElement = document.getElementById('progress-container');

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
    
    // Helper to convert seconds to MM:SS or H:MM:SS format
    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        
        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m.toString()}:${s.toString().padStart(2, '0')}`;
    }

    // --- Subtitle Management ---

    function setupSubtitleDisplay() {
        if (!videoElement) videoElement = document.querySelector('video.html5-main-video');
        const videoContainer = document.querySelector('.html5-video-player');
        if (!videoElement || !videoContainer) return;

        if (totalVideoDuration === null) {
            totalVideoDuration = videoElement.duration;
            console.log('Video Duration:', totalVideoDuration);
        }

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

        if (!timeUpdateListenerAttached) {
            videoElement.addEventListener('timeupdate', () => {
                const currentTime = videoElement.currentTime;
                // Only look for subtitles that are already processed
                const currentSubtitle = allSubtitles.find(
                    line => currentTime >= line.start && currentTime <= line.end
                );
                subtitleContainer.textContent = currentSubtitle ? currentSubtitle.text : '';
            });
            timeUpdateListenerAttached = true;
        }
    }
    
    // --- Main Logic: Chunker and Poller Loop ---

    async function startNextChunk() {
        // If navigation has occurred, stop immediately
        if (window.location.href !== currentVideoUrl) {
            console.log('Video URL changed during processing. Stopping chunker.');
            return cleanupOldJob();
        }

        // 1. Calculate the current chunk's time window
        let nextStartTime = currentStartTime;
        let nextEndTime = currentStartTime + CHUNK_DURATION;

        // Ensure we don't exceed the video duration
        if (totalVideoDuration !== null && nextStartTime >= totalVideoDuration) {
            updateStatus('✅ Hoàn tất toàn bộ phụ đề!', 100, 'success');
             setTimeout(() => { 
                statusDisplay.style.opacity = '0'; 
                statusDisplay.style.transform = 'translateX(50px)';
                setTimeout(() => statusDisplay.remove(), 300);
            }, 5000);
            return;
        }
        
        // Cap the end time at the video duration
        if (totalVideoDuration !== null && nextEndTime > totalVideoDuration) {
            nextEndTime = totalVideoDuration;
        }
        
        // 🌟 NEW: Visual Feedback and Progress Bar Toggle
        if (currentStartTime > 0) {
             progressContainerElement.style.display = 'none'; // Hide progress bar after first chunk
             updateStatus(`Đã xử lý: ${formatTime(nextStartTime)}. Đang xử lý ${formatTime(nextStartTime)} - ${formatTime(nextEndTime)}...`, 50, 'processing');
        } else {
             progressContainerElement.style.display = 'block'; // Show progress bar for the first chunk
             updateStatus(`Đang tải chunk đầu tiên (00:00 - ${formatTime(nextEndTime)})...`, 10, 'download');
        }


        try {
            // 2. Initial POST request for the chunk
            const initialResponse = await fetch(`${serverUrl}/transcribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    video_url: currentVideoUrl, 
                    start_time: formatTime(nextStartTime), 
                    end_time: formatTime(nextEndTime),     
                    language_code: languageCode 
                }),
            });
            
            const initialData = await initialResponse.json();

            if (!initialResponse.ok || initialResponse.status !== 202) {
                throw new Error(`Server initial response failed: ${initialData.message || 'Unknown error'}`);
            }

            const newTaskId = initialData.task_id;
            currentTaskId = newTaskId; // Store the task ID

            // 3. Polling for the current chunk
            pollingIntervalId = setInterval(async () => {
                // Pre-check for navigation within the interval
                if (window.location.href !== currentVideoUrl) {
                    clearInterval(pollingIntervalId);
                    return cleanupOldJob();
                }

                try {
                    const statusResponse = await fetch(`${serverUrl}/status?video_id=${newTaskId}`, {
                        headers: {
                            'Content-Type': 'application/json',
                            'ngrok-skip-browser-warning': 'true'
                        }
                    });
                    
                    const contentType = statusResponse.headers.get('content-type');
                    if (!contentType || !contentType.includes('application/json')) {
                        clearInterval(pollingIntervalId);
                        throw new Error('Server returned non-JSON data during polling.');
                    }
                    
                    const statusData = await statusResponse.json();
                    
                    // Display status logic (simplified for subsequent chunks)
                    if (currentStartTime === 0) { 
                        let statusType = 'processing';
                        if (statusData.message && statusData.message.includes('tải')) statusType = 'download';
                        if (statusData.message && (statusData.message.includes('chuyển đổi') || statusData.message.includes('transcrib'))) statusType = 'transcribe';
                        updateStatus(statusData.message || 'Đang xử lý...', statusData.progress || 0, statusType);
                    } else {
                        // For subsequent chunks, just update the generic status text
                        statusTextElement.textContent = `Đã xử lý: ${formatTime(nextStartTime)}. Đang xử lý ${formatTime(nextStartTime)} - ${formatTime(nextEndTime)}...`;
                    }

                    if (statusData.status === 'transcription_complete') {
                        clearInterval(pollingIntervalId); // Stop polling this chunk
                        pollingIntervalId = null; // Clear the stored ID
                        
                        if (statusData.subtitles && Array.isArray(statusData.subtitles) && statusData.subtitles.length > 0) {
                            const validSubtitles = statusData.subtitles.filter(sub => 
                                sub.start !== null && sub.end !== null && sub.text && sub.text.trim() !== ''
                            );
                            
                            // 4. Save results and setup display
                            allSubtitles.push(...validSubtitles);
                            setupSubtitleDisplay(); // Ensure listener is attached
                            
                            // 5. Prepare for next chunk
                            currentStartTime = nextEndTime;
                            
                            // Start the next chunk immediately after a brief pause
                            setTimeout(() => startNextChunk(), 200);

                        } else {
                            // If chunk returns no valid subtitles, just move to the next chunk
                            console.warn(`Chunk ${formatTime(nextStartTime)}-${formatTime(nextEndTime)} returned no valid subtitles. Moving to next chunk.`);
                            currentStartTime = nextEndTime;
                            setTimeout(() => startNextChunk(), 200);
                        }

                    } else if (statusData.status === 'error') {
                        clearInterval(pollingIntervalId);
                        pollingIntervalId = null;
                        updateStatus(`❌ Lỗi tại ${formatTime(nextStartTime)}: ${statusData.message}`, 100, 'error');
                        // STOP the chunking process on error
                    }
                } catch (pollError) {
                    console.error('Poll error:', pollError);
                    clearInterval(pollingIntervalId);
                    pollingIntervalId = null;
                    updateStatus(`❌ Lỗi kết nối khi kiểm tra trạng thái chunk ${formatTime(nextStartTime)}`, null, 'error');
                    // STOP the chunking process on error
                }
            }, POLLING_INTERVAL);
            
        } catch (error) {
            console.error('Error in chunk processing:', error);
            updateStatus('❌ Không thể bắt đầu chunk. Dừng xử lý.', 100, 'error');
        }
    }

    // --- Initial Entry Point Logic ---

    // Find video element to determine total duration before starting
    videoElement = document.querySelector('video.html5-main-video');
    
    // Use a Mutation Observer to watch for the video element and duration to load
    // This handles cases where the video loads after the content script runs
    
    updateStatus('Đang chờ video tải...', 10, 'loading');
    
    const observer = new MutationObserver((mutationsList, observer) => {
        videoElement = document.querySelector('video.html5-main-video');
        if (videoElement && !isNaN(videoElement.duration) && videoElement.duration > 0) {
            observer.disconnect(); // Stop observing once the element is found and has a valid duration
            totalVideoDuration = videoElement.duration;
            console.log(`Video duration found: ${totalVideoDuration}s. Starting process.`);
            setupSubtitleDisplay(); // Setup display container early
            startNextChunk(); // Start the looping process
        }
    });

    // Start observing the video player container for element changes (where video loads)
    const videoPlayer = document.querySelector('.html5-video-player');
    if (videoPlayer) {
        observer.observe(videoPlayer, { childList: true, subtree: true });
    } else {
        // Fallback for non-standard players or different layout
        observer.observe(document.body, { childList: true, subtree: true });
    }
}

// --- Video Navigation Tracking (Primary Entry Point) ---

// Listen for navigation events to clean up if user navigates away
let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
    const newUrl = window.location.href;
    if (newUrl !== lastUrl) {
        lastUrl = newUrl;
        if (currentTaskId || pollingIntervalId) {
            console.log('Detected navigation away from video. Cleaning up.');
            cleanupOldJob();
        }
    }
});

// Observe for navigation changes to clean up if needed
urlObserver.observe(document, { subtree: true, childList: true });

// Only run main() when explicitly triggered by user clicking the Start button in popup
// Check if already processing to prevent duplicate runs
if (!currentTaskId && !pollingIntervalId) {
    console.log('Content script loaded and ready. Starting transcription...');
    main();
} else {
    console.log('Content script already running. Ignoring duplicate injection.');
}