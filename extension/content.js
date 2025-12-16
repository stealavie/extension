let subtitleOverlay = null;
let positionInterval = null; // Timer to update position
let currentVideoId = null; // Track current video ID

// ============ DUAL-CACHE ARCHITECTURE ============
// Storage A: Playback Cache (for seeking/rewinding)
const playbackCache = new Map(); // Key: timestamp, Value: { text, start, end, startClock }

// Storage B: Render Queue (FIFO for live streaming effect)
const renderQueue = []; // Array of { text, messageIndex }

// Rendering state
let isRendering = false;
let currentRenderingText = '';
let currentWordIndex = 0;
let renderingTimer = null;
let messageCount = 0;

// Function to extract YouTube video ID from URL
function getYouTubeVideoId() {
    try {
        const url = new URL(window.location.href);
        const videoId = url.searchParams.get('v');
        return videoId || null;
    } catch (e) {
        console.error('[Content] Error extracting video ID:', e);
        return null;
    }
}

// Function to detect video changes
function checkVideoChange() {
    const newVideoId = getYouTubeVideoId();
    
    if (newVideoId && newVideoId !== currentVideoId) {
        console.log('[Content] 🎬 Video changed:', currentVideoId, '->', newVideoId);
        
        // Clear caches when video changes
        playbackCache.clear();
        renderQueue.length = 0;
        stopRendering();
        
        // Update current video ID
        currentVideoId = newVideoId;
        
        // Notify background/offscreen about video change
        safeSendMessage({ 
            type: 'VIDEO_CHANGED', 
            videoId: newVideoId 
        });
        
        console.log('[Content] 📺 Now watching video ID:', newVideoId);
    }
    
    return newVideoId;
}

// 1. Create the Subtitle UI that works on any platform
function getOrCreateOverlay() {
    if (subtitleOverlay && document.body.contains(subtitleOverlay)) {
        return subtitleOverlay;
    }

    // Create the container
    const div = document.createElement('div');
    div.id = 'live-subtitle-overlay';

    console.log('[Content] Creating subtitle overlay');

    // Use FIXED positioning attached to BODY
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

// ============ FIFO RENDERING LOOP ============

/**
 * Processes the render queue and displays subtitles word-by-word
 * with a 0.5-second interval between words
 */
async function processRenderQueue() {
    // Prevent multiple rendering loops from running simultaneously
    if (isRendering) return;
    
    // Check if queue is empty
    if (renderQueue.length === 0) {
        isRendering = false;
        return;
    }
    
    isRendering = true;
    
    // Pop the first item from the queue
    const queueItem = renderQueue.shift();
    const { text } = queueItem;
    
    console.log(`[FIFO Renderer] Processing: "${text}"`);
    
    // Split text into words
    const words = text.trim().split(/\s+/);
    
    // Get the overlay
    const overlay = getOrCreateOverlay();
    
    // Clear the overlay content
    overlay.innerText = '';
    overlay.style.opacity = '1';
    
    // Render words incrementally
    for (let i = 0; i < words.length; i++) {
        currentWordIndex = i;
        
        // Append the current word
        if (i === 0) {
            overlay.innerText = words[i];
        } else {
            overlay.innerText += ' ' + words[i];
        }
        
        // Wait 0.2 seconds before next word (except for the last word)
        if (i < words.length - 1) {
            await new Promise(resolve => {
                renderingTimer = setTimeout(resolve, 200);
            });
        }
    }
    
    // Wait a bit before clearing and processing next item
    await new Promise(resolve => {
        renderingTimer = setTimeout(resolve, 500);
    });
    
    // Clear the overlay after completion
    overlay.style.opacity = '0';
    overlay.innerText = '';
    
    isRendering = false;
    
    // Process next item in queue
    processRenderQueue();
}

/**
 * Add subtitle to render queue and trigger processing
 */
function addToRenderQueue(text, messageIndex) {
    renderQueue.push({ text, messageIndex });
    
    console.log(`[FIFO Queue] Added: "${text}" | Queue size: ${renderQueue.length}`);
    
    // Trigger processing if not already running
    if (!isRendering) {
        processRenderQueue();
    }
}

/**
 * Stop current rendering (for seeking/interruptions)
 */
function stopRendering() {
    if (renderingTimer) {
        clearTimeout(renderingTimer);
        renderingTimer = null;
    }
    
    isRendering = false;
    currentWordIndex = 0;
    currentRenderingText = '';
    
    // Clear queue
    renderQueue.length = 0;
    
    // Hide overlay
    if (subtitleOverlay) subtitleOverlay.style.opacity = '0';
    
    console.log('[FIFO Renderer] Stopped and cleared');
}

// 2. Update Overlay Position to match Video
function updateOverlayPosition(video) {
    if (!video) return;

    const rect = video.getBoundingClientRect();

    // If video is not visible or off-screen, hide overlay
    if (rect.width === 0 || rect.height === 0) {
        if (subtitleOverlay) subtitleOverlay.style.opacity = '0';
        return;
    }

    // Calculate center position
    const centerX = rect.left + (rect.width / 2);
    const bottomY = rect.bottom - (rect.height * 0.15); // Bottom subtitle position

    // Update overlay position
    if (subtitleOverlay) {
        Object.assign(subtitleOverlay.style, {
            width: 'auto',
            maxWidth: `${rect.width * 0.9}px`,
            left: `${centerX}px`,
            top: `${bottomY}px`,
            transform: 'translate(-50%, -100%)'
        });
    }
}

// 3. Function to Update Text based on current video time (PLAYBACK MODE - uses Storage A)
function updateOverlayState(video) {
    if (!video) return;

    const currentTime = video.currentTime;
    const overlay = getOrCreateOverlay();

    // Sync position
    updateOverlayPosition(video);

    // Find active subtitle from playback cache (Storage A)
    let activeSubtitle = null;

    // Search through playback cache for matching timestamp (most recent one)
    for (const [timestamp, subtitle] of playbackCache) {
        if (currentTime >= subtitle.start && currentTime <= subtitle.end) {
            if (!activeSubtitle || subtitle.messageIndex > activeSubtitle.messageIndex) {
                activeSubtitle = subtitle;
            }
        }
    }

    // Update overlay (show full text immediately during playback/seeking)
    if (activeSubtitle) {
        overlay.innerText = activeSubtitle.text;
        overlay.style.opacity = '1';
    } else {
        overlay.style.opacity = '0';
    }
}

// 4. Listen for Messages and Populate Both Caches
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TRANSCRIPTION_RESULT') {
        const receiveTime = Date.now();
        const latency = Math.abs(receiveTime - message.startClock);
        console.log('[Content] 📺 Transcription received:', message.text);
        console.log('[Content] ⏱️ Latency:', latency, 'ms');

        messageCount++;

        // ============ STORAGE A: PLAYBACK CACHE ============

        // Store full subtitle data with extended end time for seeking/playback
        const extendedEnd = message.end + 4;
        const subtitleData = {
            text: message.text,
            start: message.start,
            end: extendedEnd,
            messageIndex: messageCount,
            startClock: message.startClock
        };
        
        // Use start timestamp as key (or could use a combination of start+messageIndex)
        const cacheKey = `${message.start}_${messageCount}`;
        playbackCache.set(cacheKey, subtitleData);
        
        // Limit cache size to prevent memory issues
        if (playbackCache.size > 500) {
            // Remove oldest entry
            const firstKey = playbackCache.keys().next().value;
            playbackCache.delete(firstKey);
        }
        
        console.log(`[Storage A] Cached: "${message.text}" | Cache size: ${playbackCache.size}`);

        // ============ STORAGE B: RENDER QUEUE (FIFO) ============

        // Add only the text to the render queue for live streaming effect
        addToRenderQueue(message.text, messageCount);
        
        // Calculate duration for analytics
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
    // Handle cached subtitles from server
    else if (message.type === 'ALREADY_TRANSCRIBED') {
        console.log('[Content] 💾 Received cached subtitles:', message.subtitles.length);
        
        // Clear existing caches for fresh start
        playbackCache.clear();
        renderQueue.length = 0;
        stopRendering();
        
        // Process all cached subtitles
        message.subtitles.forEach((subtitle, index) => {
            messageCount++;
            
            // Add to playback cache
            const extendedEnd = subtitle.end + 4;
            const subtitleData = {
                text: subtitle.translate_text,
                start: subtitle.start,
                end: extendedEnd,
                messageIndex: messageCount,
                startClock: Date.now() // Use current time as reference
            };
            
            const cacheKey = `${subtitle.start}_${messageCount}`;
            playbackCache.set(cacheKey, subtitleData);
            
            console.log(`[Content] 💾 Cached subtitle ${index + 1}/${message.subtitles.length}: "${subtitle.translate_text}" [${subtitle.start}s - ${subtitle.end}s]`);
        });
        
        console.log(`[Content] ✅ Loaded ${message.subtitles.length} cached subtitles into playback cache`);
        
        // Get current video element and update overlay based on current time
        const video = document.querySelector('video');
        if (video) {
            updateOverlayState(video);
        }
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
        console.log('[Content] 🎥 Video element found (FIFO Streaming Mode)');

        // Clean up old interval if exists
        if (positionInterval) clearInterval(positionInterval);

        // 1. Seek - Stop FIFO rendering and switch to playback mode
        video.addEventListener('seeked', () => {
            console.log('[Content] 🔍 Seek detected - stopping FIFO renderer');
            
            // Stop the word-by-word rendering
            stopRendering();
            
            // Use playback cache (Storage A) for immediate display
            updateOverlayState(video);
            
            // Sync with backend
            chrome.runtime.sendMessage({ type: 'TIME_SYNC', timestamp: video.currentTime });
        });

        // 2. Rate
        video.addEventListener('ratechange', () => {
            safeSendMessage({ type: 'PLAYBACK_RATE', rate: video.playbackRate });
        });

        // 3. Time Update - Only update position, don't interfere with FIFO rendering
        video.addEventListener('timeupdate', () => {
            // Only update overlay positions, not content
            updateOverlayPosition(video);
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
        
        // 7. Pause - Stop FIFO rendering
        video.addEventListener('pause', () => {
            console.log('[Content] ⏸️ Pause detected - stopping FIFO renderer');
            stopRendering();
        });
        
        // 8. Play - Resume processing queue if items exist
        video.addEventListener('play', () => {
            console.log('[Content] ▶️ Play detected');
            if (renderQueue.length > 0 && !isRendering) {
                console.log('[Content] Resuming FIFO rendering');
                processRenderQueue();
            }
        });
    }
}

// Run on load
attachVideoListeners();
checkVideoChange(); // Initialize video ID

// Observer for SPA
const observer = new MutationObserver(() => {
    if (!document.querySelector('video')) return;
    attachVideoListeners();
    checkVideoChange(); // Check for video change
    observer.disconnect();
});
observer.observe(document.body, { childList: true, subtree: true });

// Monitor URL changes (for YouTube SPA navigation)
let lastUrl = window.location.href;
setInterval(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('[Content] URL changed, checking for video change...');
        checkVideoChange();
    }
}, 1000);
