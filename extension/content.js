let subtitleOverlay = null;
let subtitleCache = []; // Store all subtitles: { text, start, end }
let currentSubtitle = null; // Track currently displayed subtitle
let positionInterval = null; // Timer to update position

// 1. Create the Subtitle UI that works on any platform
function getOrCreateOverlay() {
    // If we already have one and it's still in the DOM, return it
    if (subtitleOverlay && document.body.contains(subtitleOverlay)) {
        return subtitleOverlay;
    }

    // Create the container
    const div = document.createElement('div');
    div.id = 'live-subtitle-overlay';

    console.log('[Content] Creating subtitle overlay (Fixed Overlay Mode v2)');

    // Use FIXED positioning attached to BODY
    // We will update top/left/width dynamically to match the video
    Object.assign(div.style, {
        position: 'fixed',
        textAlign: 'center',
        color: 'white',
        fontSize: '24px',
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        textShadow: '0px 0px 4px black, 1px 1px 4px black, -1px -1px 4px black',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: '8px 16px',
        borderRadius: '6px',
        zIndex: '2147483647',      // Maximum Z-Index
        pointerEvents: 'none',     // Click-through
        transition: 'opacity 0.2s ease-in-out',
        opacity: '0',              // Hidden by default
        wordWrap: 'break-word',
        whiteSpace: 'pre-wrap',
        // Initial off-screen pos
        top: '-1000px',
        left: '0'
    });

    document.body.appendChild(div);
    subtitleOverlay = div;
    return div;
}

// 2. Update Overlay Position to match Video
function updateOverlayPosition(video) {
    if (!video || !subtitleOverlay) return;

    const rect = video.getBoundingClientRect();

    // If video is not visible or off-screen, hide overlay
    if (rect.width === 0 || rect.height === 0) {
        subtitleOverlay.style.opacity = '0';
        return;
    }

    // Position overlay near the bottom of the video rect
    // We use fixed positioning relative to the viewport

    // Calculate center position
    const centerX = rect.left + (rect.width / 2);

    // Calculate bottom position (e.g., 10% from bottom of video)
    // We want it slightly above the bottom controls usually
    const bottomY = rect.bottom - (rect.height * 0.15);

    Object.assign(subtitleOverlay.style, {
        width: 'auto',
        maxWidth: `${rect.width * 0.9}px`, // Max 90% of video width
        left: `${centerX}px`,
        top: `${bottomY}px`,
        transform: 'translate(-50%, -100%)' // Center horizontally, and move up so 'top' is the bottom anchor
    });
}

// 3. Function to Update Text based on current video time
function updateOverlayState(video) {
    if (!video) return;

    const currentTime = video.currentTime;
    const overlay = getOrCreateOverlay();

    // Sync position
    updateOverlayPosition(video);

    // Find a subtitle that should be visible NOW
    const activeSubtitle = subtitleCache.find(sub =>
        currentTime >= sub.start && currentTime <= sub.end
    );

    if (activeSubtitle) {
        if (currentSubtitle !== activeSubtitle) {
            overlay.innerText = activeSubtitle.text;
            overlay.style.opacity = '1';
            currentSubtitle = activeSubtitle;
        }
    } else {
        if (currentSubtitle !== null) {
            overlay.style.opacity = '0';
            currentSubtitle = null;
        }
    }
}

// 4. Listen for Messages
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TRANSCRIPTION_RESULT') {
        console.log('[Content] 📺 Transcription received:', message.text);

        subtitleCache.push({
            text: message.text,
            start: message.start,
            end: message.end
        });

        subtitleCache.sort((a, b) => a.start - b.start);
        if (subtitleCache.length > 200) subtitleCache.shift();

        const video = document.querySelector('video');
        if (video) updateOverlayState(video);
    }
});

function safeSendMessage(message) {
    try {
        chrome.runtime.sendMessage(message);
    } catch (error) {
        console.log('[Content] Extension reloaded, message not sent:', message.type);
    }
}

// 5. Monitor Video Events
function attachVideoListeners() {
    const video = document.querySelector('video');
    if (video) {
        console.log('[Content] 🎥 Video element found (Fixed Overlay Mode v2)');

        // Clean up old interval if exists
        if (positionInterval) clearInterval(positionInterval);

        // 1. Seek
        video.addEventListener('seeked', () => {
            currentSubtitle = null;
            updateOverlayState(video);
            chrome.runtime.sendMessage({ type: 'TIME_SYNC', timestamp: video.currentTime });
        });

        // 2. Rate
        video.addEventListener('ratechange', () => {
            safeSendMessage({ type: 'PLAYBACK_RATE', rate: video.playbackRate });
        });

        // 3. Time Update (Sync + Position)
        video.addEventListener('timeupdate', () => {
            updateOverlayState(video);
        });

        // 4. Scroll/Resize (Update Position)
        window.addEventListener('scroll', () => updateOverlayPosition(video), { passive: true });
        window.addEventListener('resize', () => updateOverlayPosition(video), { passive: true });

        // 5. Periodic Position Check (for layout changes that don't trigger resize)
        positionInterval = setInterval(() => {
            updateOverlayPosition(video);
        }, 500);

        // 6. Periodic Sync
        setInterval(() => {
            if (!video.paused) {
                safeSendMessage({ type: 'TIME_SYNC', timestamp: video.currentTime });
            }
        }, 2000);
    }
}

// Run on load
attachVideoListeners();

// Observer for SPA
const observer = new MutationObserver(() => {
    if (!document.querySelector('video')) return;
    attachVideoListeners();
    observer.disconnect();
});
observer.observe(document.body, { childList: true, subtree: true });
