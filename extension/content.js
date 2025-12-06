let subtitleOverlay = null;
let subtitleCache = []; // Store all subtitles: { text, start, end }
let currentSubtitle = null; // Track currently displayed subtitle
let positionInterval = null; // Timer to update position
let subtitleOverlayTop = null; // Top subtitle overlay
let subtitleOverlayBottom = null; // Bottom subtitle overlay
let messageCount = 0; // Track message index (odd/even)

// 1. Create the Subtitle UI that works on any platform
function getOrCreateOverlay(position = 'bottom') {
    // Check if we already have overlays
    const overlayId = position === 'top' ? 'live-subtitle-overlay-top' : 'live-subtitle-overlay-bottom';
    let overlay = position === 'top' ? subtitleOverlayTop : subtitleOverlayBottom;
    
    if (overlay && document.body.contains(overlay)) {
        return overlay;
    }

    // Create the container
    const div = document.createElement('div');
    div.id = overlayId;

    console.log(`[Content] Creating subtitle overlay at ${position}`);

    // Use FIXED positioning attached to BODY
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
        zIndex: position === 'top' ? '2147483647' : '2147483646',
        pointerEvents: 'none',
        transition: 'opacity 0.2s ease-in-out',
        opacity: '0',
        wordWrap: 'break-word',
        whiteSpace: 'pre-wrap',
        top: '-1000px',
        left: '0'
    });

    document.body.appendChild(div);
    
    if (position === 'top') {
        subtitleOverlayTop = div;
    } else {
        subtitleOverlayBottom = div;
    }
    
    return div;
}

// 2. Update Overlay Position to match Video
function updateOverlayPosition(video) {
    if (!video) return;

    const rect = video.getBoundingClientRect();

    // If video is not visible or off-screen, hide overlays
    if (rect.width === 0 || rect.height === 0) {
        if (subtitleOverlayTop) subtitleOverlayTop.style.opacity = '0';
        if (subtitleOverlayBottom) subtitleOverlayBottom.style.opacity = '0';
        return;
    }

    // Calculate center position
    const centerX = rect.left + (rect.width / 2);

    // Calculate positions for top and bottom subtitles
    const bottomY = rect.bottom - (rect.height * 0.15); // Bottom subtitle position
    const topY = rect.bottom - (rect.height * 0.25); // Top subtitle position (above bottom)

    // Update top overlay position
    if (subtitleOverlayTop) {
        Object.assign(subtitleOverlayTop.style, {
            width: 'auto',
            maxWidth: `${rect.width * 0.9}px`,
            left: `${centerX}px`,
            top: `${topY}px`,
            transform: 'translate(-50%, -100%)'
        });
    }

    // Update bottom overlay position
    if (subtitleOverlayBottom) {
        Object.assign(subtitleOverlayBottom.style, {
            width: 'auto',
            maxWidth: `${rect.width * 0.9}px`,
            left: `${centerX}px`,
            top: `${bottomY}px`,
            transform: 'translate(-50%, -100%)'
        });
    }
}

// 3. Function to Update Text based on current video time
function updateOverlayState(video) {
    if (!video) return;

    const currentTime = video.currentTime;
    const topOverlay = getOrCreateOverlay('top');
    const bottomOverlay = getOrCreateOverlay('bottom');

    // Sync position
    updateOverlayPosition(video);

    // Find active subtitles for top (odd messages) and bottom (even messages)
    let topSubtitle = null;
    let bottomSubtitle = null;

    // Find the most recent odd and even messages that should be visible
    for (let i = subtitleCache.length - 1; i >= 0; i--) {
        const sub = subtitleCache[i];
        if (currentTime >= sub.start && currentTime <= sub.end) {
            if (sub.isOdd && !topSubtitle) {
                topSubtitle = sub;
            } else if (!sub.isOdd && !bottomSubtitle) {
                bottomSubtitle = sub;
            }
            
            // Stop if we found both
            if (topSubtitle && bottomSubtitle) break;
        }
    }

    // Update top overlay
    if (topSubtitle) {
        topOverlay.innerText = topSubtitle.text;
        topOverlay.style.opacity = '1';
    } else {
        topOverlay.style.opacity = '0';
    }

    // Update bottom overlay
    if (bottomSubtitle) {
        bottomOverlay.innerText = bottomSubtitle.text;
        bottomOverlay.style.opacity = '1';
    } else {
        bottomOverlay.style.opacity = '0';
    }
}

// 4. Listen for Messages
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TRANSCRIPTION_RESULT') {
        const receiveTime = Date.now();
        const latency = Math.abs(receiveTime - message.startClock);
        console.log('[Content] 📺 Transcription received:', message.text);
        console.log('[Content] ⏱️ Latency:', latency, 'ms');

        messageCount++;
        const isOdd = messageCount % 2 === 1;

        // Extend end time by 2000ms (2 seconds)
        const extendedEnd = message.end + 4;

        subtitleCache.push({
            text: message.text,
            start: message.start,
            end: extendedEnd,
            isOdd: isOdd,
            messageIndex: messageCount
        });

        subtitleCache.sort((a, b) => a.start - b.start);
        if (subtitleCache.length > 200) subtitleCache.shift();

        const video = document.querySelector('video');
        if (video) updateOverlayState(video);
        
        const duration = (message.end - message.start) * 1000;

        // Save latency data to Chrome storage
        chrome.storage.local.get(['latencyData'], (result) => {
            const latencyData = result.latencyData || [];
            latencyData.push({
                latency: latency,
                timestamp: receiveTime,
                text: message.text,
                duration: duration
            });
            
            // Keep only last 1000 entries to avoid storage limits
            if (latencyData.length > 1000) {
                latencyData.shift();
            }
            
            chrome.storage.local.set({ latencyData });
        });
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
