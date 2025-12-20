let subtitleOverlay = null;
let currentVideoId = null;
const playbackCache = new Map();
const renderQueue = [];
let isRendering = false;
let messageCount = 0;

// ============== NEW: Replay Mode & Cache Management ==============
let maxCapturedTime = 0;  // Thời điểm xa nhất đã có subtitle
let isReplayMode = false; // Đang ở chế độ replay (tua ngược) hay live
const LIVE_THRESHOLD = 2.0; // Ngưỡng (giây) để xác định replay vs live

// SubtitleStorageManager - Quản lý cache subtitle trong chrome.storage.local
const SubtitleStorageManager = {
    getStorageKey(videoId) {
        return `subtitle_cache_${videoId}`;
    },

    async saveToStorage(videoId, subtitleData, maxTime) {
        if (!videoId) return;

        const key = this.getStorageKey(videoId);
        const data = {
            videoId,
            maxCapturedTime: maxTime,
            subtitles: subtitleData,
            updatedAt: Date.now()
        };

        try {
            await chrome.storage.local.set({ [key]: data });
        } catch (e) {
            console.error('Failed to save subtitle cache:', e);
        }
    },

    async loadFromStorage(videoId) {
        if (!videoId) return null;

        const key = this.getStorageKey(videoId);
        try {
            const result = await chrome.storage.local.get(key);
            return result[key] || null;
        } catch (e) {
            console.error('Failed to load subtitle cache:', e);
            return null;
        }
    },

    async clearStorage(videoId) {
        if (!videoId) return;

        const key = this.getStorageKey(videoId);
        try {
            await chrome.storage.local.remove(key);
        } catch (e) {
            console.error('Failed to clear subtitle cache:', e);
        }
    },

    async appendSubtitle(videoId, subtitle, maxTime) {
        if (!videoId) return;

        const existing = await this.loadFromStorage(videoId);
        const subtitles = existing?.subtitles || [];

        // Kiểm tra trùng lặp dựa trên start time
        const isDuplicate = subtitles.some(s =>
            Math.abs(s.start - subtitle.start) < 0.5 && s.text === subtitle.text
        );

        if (!isDuplicate) {
            subtitles.push(subtitle);
            // Sắp xếp theo thời gian
            subtitles.sort((a, b) => a.start - b.start);
            // Giới hạn số lượng
            if (subtitles.length > 500) {
                subtitles.shift();
            }
        }

        await this.saveToStorage(videoId, subtitles, maxTime);
    }
};

// ============== END NEW ==============

function getYouTubeVideoId() {
    try {
        return new URL(window.location.href).searchParams.get('v') || null;
    } catch {
        return null;
    }
}

async function checkVideoChange() {
    const newVideoId = getYouTubeVideoId();
    if (newVideoId && newVideoId !== currentVideoId) {
        playbackCache.clear();
        renderQueue.length = 0;
        stopRendering();
        currentVideoId = newVideoId;

        // Reset replay mode states
        maxCapturedTime = 0;
        isReplayMode = false;

        // Load cache từ storage nếu có
        const cachedData = await SubtitleStorageManager.loadFromStorage(newVideoId);
        if (cachedData && cachedData.subtitles && cachedData.subtitles.length > 0) {
            maxCapturedTime = cachedData.maxCapturedTime || 0;
            messageCount = 0;

            cachedData.subtitles.forEach((subtitle) => {
                messageCount++;
                const subtitleData = {
                    text: subtitle.text,
                    start: subtitle.start,
                    end: subtitle.end,
                    messageIndex: messageCount
                };
                playbackCache.set(`${subtitle.start}_${messageCount}`, subtitleData);
            });

            console.log(`[SubtitleCache] Loaded ${cachedData.subtitles.length} cached subtitles for video ${newVideoId}`);
        }

        safeSendMessage({ type: 'VIDEO_CHANGED', videoId: newVideoId });
    }
    return newVideoId;
}

function getOrCreateOverlay() {
    if (subtitleOverlay && document.body.contains(subtitleOverlay)) {
        return subtitleOverlay;
    }

    const div = document.createElement('div');
    div.id = 'live-subtitle-overlay';
    Object.assign(div.style, {
        position: 'fixed',
        textAlign: 'center',
        color: 'white',
        fontSize: '14px',
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        textShadow: '0px 0px 4px black, 1px 1px 4px black, -1px -1px 4px black',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: '8px 16px',
        borderRadius: '6px',
        zIndex: '2147483647',
        pointerEvents: 'none',
        transition: 'opacity 0.2s ease-in-out',
        opacity: '0',
        wordWrap: 'break-word',
        whiteSpace: 'pre-wrap',
        top: '-1000px',
        left: '0'
    });

    document.body.appendChild(div);
    subtitleOverlay = div;
    return div;
}

function formatTimestamp(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function processRenderQueue() {
    if (isRendering || renderQueue.length === 0) return;

    // Không render queue nếu đang ở replay mode
    if (isReplayMode) {
        renderQueue.length = 0;
        return;
    }

    isRendering = true;
    const { text, timestamp } = renderQueue.shift();
    const overlay = getOrCreateOverlay();
    const video = document.querySelector('video');
    const videoTime = video ? formatTimestamp(video.currentTime) : '';

    overlay.innerText = videoTime ? `[${videoTime}] ${text}` : text;
    overlay.style.opacity = '1';

    isRendering = false;
    if (renderQueue.length > 0) processRenderQueue();
}

function addToRenderQueue(text, timestamp) {
    // Không thêm vào queue nếu đang ở replay mode
    if (isReplayMode) return;

    renderQueue.push({ text, timestamp });
    if (!isRendering) processRenderQueue();
}

function stopRendering() {
    isRendering = false;
    renderQueue.length = 0;
    if (subtitleOverlay) subtitleOverlay.style.opacity = '0';
}

function updateOverlayPosition(video) {
    if (!video || !subtitleOverlay) return;

    const rect = video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
        subtitleOverlay.style.opacity = '0';
        return;
    }

    Object.assign(subtitleOverlay.style, {
        width: 'auto',
        maxWidth: `${rect.width * 0.9}px`,
        left: `${rect.left + rect.width / 2}px`,
        top: `${rect.bottom - rect.height * 0.15}px`,
        transform: 'translate(-50%, -100%)'
    });
}

function updateOverlayState(video) {
    if (!video) return;
    updateOverlayPosition(video);

    const currentTime = video.currentTime;
    const overlay = getOrCreateOverlay();
    let activeSubtitle = null;

    for (const [, subtitle] of playbackCache) {
        if (currentTime >= subtitle.start && currentTime <= subtitle.end) {
            if (!activeSubtitle || subtitle.messageIndex > activeSubtitle.messageIndex) {
                activeSubtitle = subtitle;
            }
        }
    }

    overlay.innerText = activeSubtitle?.text || '';
    overlay.style.opacity = activeSubtitle ? '1' : '0';
}

// ============== NEW: Handle seek for replay mode ==============

// Tìm subtitle tại thời điểm cụ thể (nếu có)
function findSubtitleAt(timestamp) {
    for (const [, subtitle] of playbackCache) {
        if (timestamp >= subtitle.start && timestamp <= subtitle.end) {
            return subtitle;
        }
    }
    return null;
}

// Kiểm tra xem có subtitle cover khoảng thời gian không
function hasSubtitleCoverage(timestamp) {
    // Nếu timestamp vượt quá maxCapturedTime, chắc chắn không có subtitle
    if (timestamp >= maxCapturedTime) {
        return false;
    }

    // Tìm subtitle gần nhất sau timestamp
    let nearestAfter = null;
    for (const [, subtitle] of playbackCache) {
        if (subtitle.start > timestamp) {
            if (!nearestAfter || subtitle.start < nearestAfter.start) {
                nearestAfter = subtitle;
            }
        }
    }

    // Nếu có subtitle cover timestamp trực tiếp
    if (findSubtitleAt(timestamp)) {
        return true;
    }

    // Nếu có subtitle gần đó (trong 5 giây) - coi như có coverage
    if (nearestAfter && nearestAfter.start - timestamp < 5) {
        return true;
    }

    return false;
}

function handleSeek(video) {
    const currentTime = video.currentTime;

    // Case 1: Tua đến vị trí vượt quá maxCapturedTime (chưa từng capture)
    // → Resume capture để lấy subtitle mới
    if (currentTime >= maxCapturedTime - LIVE_THRESHOLD) {
        if (isReplayMode) {
            isReplayMode = false;
            safeSendMessage({ type: 'RESUME_CAPTURE' });
            console.log(`[SubtitleCache] Live mode resumed - beyond maxCapturedTime (${currentTime}s >= ${maxCapturedTime}s)`);
        }
        stopRendering();
        updateOverlayState(video);
        safeSendMessage({ type: 'TIME_SYNC', timestamp: currentTime });
        return;
    }

    // Case 2: Tua đến vị trí có subtitle cached hoặc gần subtitle
    // → Vào replay mode, hiển thị từ cache, dừng capture
    if (hasSubtitleCoverage(currentTime)) {
        if (!isReplayMode) {
            isReplayMode = true;
            renderQueue.length = 0;
            safeSendMessage({ type: 'PAUSE_CAPTURE' });
            console.log(`[SubtitleCache] Replay mode ON - has subtitle coverage at ${currentTime}s`);
        }
    } else {
        // Case 3: Tua đến vị trí KHÔNG có subtitle (gap trong vùng đã capture)
        // → Resume capture để lấy subtitle cho gap này
        if (isReplayMode) {
            isReplayMode = false;
            safeSendMessage({ type: 'RESUME_CAPTURE' });
            console.log(`[SubtitleCache] Live mode resumed - gap detected at ${currentTime}s (no subtitle coverage)`);
        }
    }

    stopRendering();
    updateOverlayState(video);
    safeSendMessage({ type: 'TIME_SYNC', timestamp: currentTime });
}
// ============== END NEW ==============

function safeSendMessage(message) {
    try {
        chrome.runtime.sendMessage(message);
    } catch { }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_VIDEO_ID') {
        sendResponse({ videoId: getYouTubeVideoId() });
        return true;
    }

    if (message.type === 'TRANSCRIPTION_RESULT') {
        // Bỏ qua nếu đang ở replay mode
        if (isReplayMode) return;

        messageCount++;
        const extendedEnd = message.end + 4;
        const subtitleData = {
            text: message.text,
            start: message.start,
            end: extendedEnd,
            messageIndex: messageCount
        };

        playbackCache.set(`${message.start}_${messageCount}`, subtitleData);
        if (playbackCache.size > 500) {
            playbackCache.delete(playbackCache.keys().next().value);
        }

        // Cập nhật maxCapturedTime
        if (extendedEnd > maxCapturedTime) {
            maxCapturedTime = extendedEnd;
        }

        // Lưu vào persistent storage
        SubtitleStorageManager.appendSubtitle(currentVideoId, {
            text: message.text,
            start: message.start,
            end: extendedEnd
        }, maxCapturedTime);

        addToRenderQueue(message.text, message.start);
    }

    if (message.type === 'ALREADY_TRANSCRIBED') {
        playbackCache.clear();
        renderQueue.length = 0;
        stopRendering();

        message.subtitles.forEach((subtitle) => {
            messageCount++;
            const subtitleData = {
                text: subtitle.translate_text,
                start: subtitle.start,
                end: subtitle.end + 4,
                messageIndex: messageCount
            };
            playbackCache.set(`${subtitle.start}_${messageCount}`, subtitleData);

            // Cập nhật maxCapturedTime
            if (subtitleData.end > maxCapturedTime) {
                maxCapturedTime = subtitleData.end;
            }
        });

        // Lưu tất cả vào persistent storage
        const subtitlesToSave = message.subtitles.map(s => ({
            text: s.translate_text,
            start: s.start,
            end: s.end + 4
        }));
        SubtitleStorageManager.saveToStorage(currentVideoId, subtitlesToSave, maxCapturedTime);

        const video = document.querySelector('video');
        if (video) updateOverlayState(video);
    }
});

function attachVideoListeners() {
    const video = document.querySelector('video');
    if (!video) return;

    video.addEventListener('seeked', () => {
        handleSeek(video);
    });

    video.addEventListener('ratechange', () => {
        safeSendMessage({ type: 'PLAYBACK_RATE', rate: video.playbackRate });
    });

    video.addEventListener('timeupdate', () => {
        updateOverlayPosition(video);

        // Kiểm tra nếu đang replay mode và đã vượt qua maxCapturedTime
        if (isReplayMode && video.currentTime >= maxCapturedTime - LIVE_THRESHOLD) {
            isReplayMode = false;
            safeSendMessage({ type: 'RESUME_CAPTURE' });
            console.log(`[SubtitleCache] Auto-resumed live mode at ${video.currentTime}s`);
        }

        // Cập nhật overlay khi ở replay mode
        if (isReplayMode) {
            updateOverlayState(video);
        }
    });

    video.addEventListener('pause', stopRendering);
    video.addEventListener('play', () => {
        if (renderQueue.length > 0 && !isRendering && !isReplayMode) processRenderQueue();
    });

    window.addEventListener('scroll', () => updateOverlayPosition(video), { passive: true });
    window.addEventListener('resize', () => updateOverlayPosition(video), { passive: true });

    setInterval(() => updateOverlayPosition(video), 500);
    setInterval(() => {
        if (!video.paused && !isReplayMode) {
            safeSendMessage({ type: 'TIME_SYNC', timestamp: video.currentTime });
        }
    }, 2000);
}

attachVideoListeners();
checkVideoChange();

const observer = new MutationObserver(() => {
    if (!document.querySelector('video')) return;
    attachVideoListeners();
    checkVideoChange();
    observer.disconnect();
});
observer.observe(document.body, { childList: true, subtree: true });

let lastUrl = window.location.href;
setInterval(() => {
    if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        checkVideoChange();
    }
}, 1000);
