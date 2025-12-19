let subtitleOverlay = null;
let currentVideoId = null;
const playbackCache = new Map();
const renderQueue = [];
let isRendering = false;
let messageCount = 0;

function getYouTubeVideoId() {
    try {
        return new URL(window.location.href).searchParams.get('v') || null;
    } catch {
        return null;
    }
}

function checkVideoChange() {
    const newVideoId = getYouTubeVideoId();
    if (newVideoId && newVideoId !== currentVideoId) {
        playbackCache.clear();
        renderQueue.length = 0;
        stopRendering();
        currentVideoId = newVideoId;
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

function safeSendMessage(message) {
    try {
        chrome.runtime.sendMessage(message);
    } catch {}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_VIDEO_ID') {
        sendResponse({ videoId: getYouTubeVideoId() });
        return true;
    }
    
    if (message.type === 'TRANSCRIPTION_RESULT') {
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
        });
        
        const video = document.querySelector('video');
        if (video) updateOverlayState(video);
    }
});

function attachVideoListeners() {
    const video = document.querySelector('video');
    if (!video) return;

    video.addEventListener('seeked', () => {
        stopRendering();
        updateOverlayState(video);
        safeSendMessage({ type: 'TIME_SYNC', timestamp: video.currentTime });
    });

    video.addEventListener('ratechange', () => {
        safeSendMessage({ type: 'PLAYBACK_RATE', rate: video.playbackRate });
    });

    video.addEventListener('timeupdate', () => updateOverlayPosition(video));
    video.addEventListener('pause', stopRendering);
    video.addEventListener('play', () => {
        if (renderQueue.length > 0 && !isRendering) processRenderQueue();
    });

    window.addEventListener('scroll', () => updateOverlayPosition(video), { passive: true });
    window.addEventListener('resize', () => updateOverlayPosition(video), { passive: true });

    setInterval(() => updateOverlayPosition(video), 500);
    setInterval(() => {
        if (!video.paused) safeSendMessage({ type: 'TIME_SYNC', timestamp: video.currentTime });
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
