let subtitleOverlay = null;
let hideTimer = null;

// 1. Create the Subtitle UI that works on any platform
function getOrCreateOverlay(videoElement) {
    // If we already have one and it's still in the DOM, return it
    if (subtitleOverlay && document.body.contains(subtitleOverlay)) {
        return subtitleOverlay;
    }

    // Create the container
    const div = document.createElement('div');
    div.id = 'live-subtitle-overlay';
    
    console.log('[Content] Creating subtitle overlay');
    
    // Use FIXED positioning to work on any platform
    Object.assign(div.style, {
        position: 'fixed',         // Fixed to viewport, not relative to parent
        bottom: '80px',            // Distance from bottom of screen
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'auto',
        maxWidth: '80%',           // Max width
        textAlign: 'center',
        color: 'white',
        fontSize: '28px',
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        textShadow: '0px 0px 6px black, 2px 2px 6px black, -2px -2px 6px black', // Strong outline
        backgroundColor: 'rgba(0, 0, 0, 0.8)', // More opaque background
        padding: '10px 20px',
        borderRadius: '8px',
        zIndex: '2147483647',      // Maximum Z-Index to stay on top
        pointerEvents: 'none',     // Allow clicks to pass through
        transition: 'opacity 0.3s ease-in-out',
        opacity: '0',              // Hidden by default
        wordWrap: 'break-word',
        whiteSpace: 'pre-wrap'
    });

    // Append directly to body to ensure it's always visible
    document.body.appendChild(div);
    
    console.log('[Content] ✅ Subtitle overlay created and appended to body');
    
    subtitleOverlay = div;
    return div;
}

// 2. Function to Update Text with timing control
function updateSubtitle(text, start, end) {
    const video = document.querySelector('video');
    if (!video) return;

    const overlay = getOrCreateOverlay(video);
    const currentTime = video.currentTime;
    
    // Calculate when subtitle should appear and disappear based on video timeline
    const displayDuration = (end - start) * 1000; // Convert to milliseconds
    
    console.log('[Content] ⏱️ Subtitle timing:', {
        videoTime: currentTime.toFixed(2),
        subtitleStart: start.toFixed(2),
        subtitleEnd: end.toFixed(2),
        duration: (displayDuration / 1000).toFixed(2) + 's'
    });
    
    overlay.innerText = text;
    overlay.style.opacity = '1';

    // Clear previous timer
    if (hideTimer) clearTimeout(hideTimer);

    // Auto-hide based on the actual subtitle duration from server
    hideTimer = setTimeout(() => {
        overlay.style.opacity = '0';
    }, displayDuration);
}

// 3. Listen for Messages from Background/Offscreen
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TRANSCRIPTION_RESULT') {
        console.log('[Content] 📺 Transcription received:', {
            text: message.text,
            start: message.start,
            end: message.end
        });
        updateSubtitle(message.text, message.start, message.end);
    }
});

// Helper function to safely send messages
function safeSendMessage(message) {
    try {
        chrome.runtime.sendMessage(message);
    } catch (error) {
        // Extension context invalidated (extension reloaded)
        console.log('[Content] Extension reloaded, message not sent:', message.type);
    }
}

// 4. Monitor Video Events for Sync
function attachVideoListeners() {
    const video = document.querySelector('video');
    if (video) {
        // 1. Handle Seeking (Time Skip)
        video.addEventListener('seeked', () => {
            chrome.runtime.sendMessage({
                type: 'TIME_SYNC',
                timestamp: video.currentTime
            });
        });

        // 2. Handle Speed Change
        video.addEventListener('ratechange', () => {
            safeSendMessage({
                type: 'PLAYBACK_RATE',
                rate: video.playbackRate
            });
        });
        
        // 3. Periodic Sync (Optional but recommended for drift correction)
        setInterval(() => {
            if(!video.paused) {
                safeSendMessage({
                    type: 'TIME_SYNC',
                    timestamp: video.currentTime
                });
            }
        }, 2000); // Sync every 2 seconds
    }
}

// Run on load
attachVideoListeners();

// Also run if DOM changes (e.g. SPA navigation)
const observer = new MutationObserver(() => {
    if (!document.querySelector('video')) return;
    attachVideoListeners();
    observer.disconnect();
});
observer.observe(document.body, { childList: true, subtree: true });
