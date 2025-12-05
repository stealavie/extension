// ==================== STATE MACHINE: DUAL-MODE SUBTITLE SYSTEM ====================
class SubtitleController {
    constructor(videoElement) {
        this.video = videoElement;
        
        // Data Structures
        this.subtitleCache = [];     // Database: [{start, end, text}]
        this.renderQueue = [];        // FIFO Buffer: ["word", " ", "word"]
        
        // State Variables
        this.maxCapturedTime = 0;     // Furthest audio timestamp sent to server
        this.isLiveMode = true;       // State flag: true = Live, false = Replay
        this.LIVE_THRESHOLD = 2.0;    // Seconds of buffer tolerance
        
        // Visual State
        this.currentDisplayedText = "";
        this.typerAnimationId = null;
        this.lastTypedIndex = 0;
        
        // UI Elements
        this.overlay = null;
        this.positionInterval = null;
        
        // Initialize
        this.createOverlay();
        this.attachEventListeners();
        this.startTyper();
        
        console.log('[SubtitleController] Initialized with dual-mode system');
    }
    
    // ==================== UI CREATION ====================
    createOverlay() {
        const div = document.createElement('div');
        div.id = 'live-subtitle-overlay';
        
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
        this.overlay = div;
    }
    
    // ==================== POSITION MANAGEMENT ====================
    updateOverlayPosition() {
        if (!this.video || !this.overlay) return;
        
        const rect = this.video.getBoundingClientRect();
        
        if (rect.width === 0 || rect.height === 0) {
            this.overlay.style.opacity = '0';
            return;
        }
        
        const centerX = rect.left + (rect.width / 2);
        const bottomY = rect.bottom - (rect.height * 0.15);
        
        Object.assign(this.overlay.style, {
            width: 'auto',
            maxWidth: `${rect.width * 0.9}px`,
            left: `${centerX}px`,
            top: `${bottomY}px`,
            transform: 'translate(-50%, -100%)'
        });
    }
    
    // ==================== EVENT LISTENERS ====================
    attachEventListeners() {
        // Seek Detection (Critical for Mode Switching)
        this.video.addEventListener('seeking', () => this.handleSeek());
        this.video.addEventListener('seeked', () => this.handleSeeked());
        
        // Time Update (for Replay Mode and position sync)
        this.video.addEventListener('timeupdate', () => this.handleTimeUpdate());
        
        // Playback Rate
        this.video.addEventListener('ratechange', () => {
            this.safeSendMessage({ type: 'PLAYBACK_RATE', rate: this.video.playbackRate });
        });
        
        // Position Updates
        window.addEventListener('scroll', () => this.updateOverlayPosition(), { passive: true });
        window.addEventListener('resize', () => this.updateOverlayPosition(), { passive: true });
        
        // Periodic position check
        this.positionInterval = setInterval(() => this.updateOverlayPosition(), 500);
        
        // Periodic time sync
        setInterval(() => {
            if (!this.video.paused) {
                this.safeSendMessage({ 
                    type: 'TIME_SYNC', 
                    timestamp: this.video.currentTime 
                });
            }
        }, 2000);
    }
    
    // ==================== STATE MACHINE: MODE SWITCHING ====================
    handleSeek() {
        const currentTime = this.video.currentTime;
        
        console.log(`[SubtitleController] Seeking to ${currentTime.toFixed(2)}s, maxCaptured: ${this.maxCapturedTime.toFixed(2)}s`);
        
        // SCENARIO 1: User went BACKWARD in time (Replay Mode)
        if (currentTime < this.maxCapturedTime - this.LIVE_THRESHOLD) {
            this.switchToReplayMode();
        }
        // SCENARIO 2: User jumped to the END / FORWARD (Live Mode)
        else if (currentTime >= this.maxCapturedTime - this.LIVE_THRESHOLD) {
            this.switchToLiveMode(currentTime);
        }
    }
    
    handleSeeked() {
        // After seek completes, send sync to server
        this.safeSendMessage({ 
            type: 'TIME_SYNC', 
            timestamp: this.video.currentTime 
        });
    }
    
    switchToReplayMode() {
        if (!this.isLiveMode) return; // Already in Replay Mode
        
        console.log('[SubtitleController] 🔄 Switching to REPLAY MODE');
        this.isLiveMode = false;
        
        // Clear the Live Queue
        this.renderQueue = [];
        this.lastTypedIndex = 0;
        
        // Don't clear display immediately - let Replay Mode handle it
    }
    
    switchToLiveMode(currentTime) {
        if (this.isLiveMode && this.renderQueue.length === 0) return; // Already in Live Mode
        
        console.log('[SubtitleController] 🔄 Switching to LIVE MODE');
        this.isLiveMode = true;
        
        // Clear everything
        this.renderQueue = [];
        this.lastTypedIndex = 0;
        this.clearDisplay();
        
        // Update anchor point
        this.maxCapturedTime = currentTime;
    }
    
    // ==================== TIME UPDATE HANDLER ====================
    handleTimeUpdate() {
        // Update position
        this.updateOverlayPosition();
        
        // Track max time
        if (this.video.currentTime > this.maxCapturedTime) {
            this.maxCapturedTime = this.video.currentTime;
        }
        
        // REPLAY MODE: Pull from cache
        if (!this.isLiveMode) {
            this.renderReplayMode();
        }
        // LIVE MODE: Handled by typer loop
    }
    
    // ==================== REPLAY MODE RENDERING ====================
    renderReplayMode() {
        const currentTime = this.video.currentTime;
        
        // Find subtitle for current time
        const activeSubtitle = this.subtitleCache.find(sub =>
            currentTime >= sub.start && currentTime <= sub.end
        );
        
        if (activeSubtitle) {
            if (this.currentDisplayedText !== activeSubtitle.text) {
                this.setDisplayText(activeSubtitle.text);
                this.showOverlay();
            }
        } else {
            if (this.currentDisplayedText !== "") {
                this.hideOverlay();
            }
        }
    }
    
    // ==================== LIVE MODE: TYPING EFFECT ====================
    startTyper() {
        const typeNextWord = () => {
            if (this.isLiveMode && this.renderQueue.length > 0) {
                const word = this.renderQueue.shift();
                this.appendWordToDisplay(word);
            }
            
            // Continue animation loop
            this.typerAnimationId = requestAnimationFrame(typeNextWord);
        };
        
        // Start the loop with a slower interval using setTimeout
        const typerLoop = () => {
            if (this.isLiveMode && this.renderQueue.length > 0) {
                const word = this.renderQueue.shift();
                this.appendWordToDisplay(word);
            }
            setTimeout(typerLoop, 100); // 100ms interval for typing
        };
        
        typerLoop();
    }
    
    appendWordToDisplay(word) {
        if (this.currentDisplayedText === "") {
            this.currentDisplayedText = word;
        } else {
            this.currentDisplayedText += word;
        }
        
        this.setDisplayText(this.currentDisplayedText);
        this.showOverlay();
    }
    
    // ==================== SERVER RESPONSE HANDLER ====================
    onServerResponse(payload) {
        console.log(`[SubtitleController] Server response - Mode: ${this.isLiveMode ? 'LIVE' : 'REPLAY'}`);
        
        // 1. ALWAYS save to cache (the "Database")
        this.subtitleCache.push({
            start: payload.start,
            end: payload.end,
            text: payload.text
        });
        
        // Sort and limit cache size
        this.subtitleCache.sort((a, b) => a.start - b.start);
        if (this.subtitleCache.length > 200) {
            this.subtitleCache.shift();
        }
        
        // 2. Update maxCapturedTime
        if (payload.end > this.maxCapturedTime) {
            this.maxCapturedTime = payload.end;
        }
        
        // 3. Only push to render queue if in LIVE MODE
        if (this.isLiveMode) {
            // Clear previous live text when new sentence arrives
            this.clearDisplay();
            
            // Split into words and push to queue
            const words = payload.text.split(' ');
            for (let i = 0; i < words.length; i++) {
                this.renderQueue.push(words[i]);
                if (i < words.length - 1) {
                    this.renderQueue.push(' '); // Add space between words
                }
            }
            
            console.log(`[SubtitleController] Queued ${this.renderQueue.length} items for typing effect`);
        }
    }
    
    // ==================== DISPLAY HELPERS ====================
    setDisplayText(text) {
        this.currentDisplayedText = text;
        if (this.overlay) {
            this.overlay.innerText = text;
        }
    }
    
    clearDisplay() {
        this.currentDisplayedText = "";
        if (this.overlay) {
            this.overlay.innerText = "";
            this.overlay.style.opacity = '0';
        }
    }
    
    showOverlay() {
        if (this.overlay) {
            this.overlay.style.opacity = '1';
        }
    }
    
    hideOverlay() {
        if (this.overlay) {
            this.overlay.style.opacity = '0';
        }
        this.currentDisplayedText = "";
    }
    
    // ==================== UTILITIES ====================
    safeSendMessage(message) {
        try {
            chrome.runtime.sendMessage(message);
        } catch (error) {
            console.log('[SubtitleController] Extension reloaded, message not sent:', message.type);
        }
    }
    
    // ==================== CLEANUP ====================
    destroy() {
        if (this.positionInterval) {
            clearInterval(this.positionInterval);
        }
        if (this.typerAnimationId) {
            cancelAnimationFrame(this.typerAnimationId);
        }
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
    }
}

// ==================== GLOBAL CONTROLLER INSTANCE ====================
let subtitleController = null;

// ==================== MESSAGE LISTENER ====================
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TRANSCRIPTION_RESULT') {
        console.log('[Content] 📺 Transcription received:', message.text);
        
        if (subtitleController) {
            subtitleController.onServerResponse({
                text: message.text,
                start: message.start,
                end: message.end
            });
        }
    } else if (message.type === 'MAX_CAPTURED_TIME') {
        // Update maxCapturedTime from offscreen (for sync)
        if (subtitleController && message.timestamp > subtitleController.maxCapturedTime) {
            subtitleController.maxCapturedTime = message.timestamp;
            console.log(`[Content] Updated maxCapturedTime to ${message.timestamp.toFixed(2)}s`);
        }
    }
});

// ==================== VIDEO DETECTION & INITIALIZATION ====================
function attachVideoListeners() {
    const video = document.querySelector('video');
    if (video && !subtitleController) {
        console.log('[Content] 🎥 Video element found - Initializing Dual-Mode Subtitle System');
        
        // Create the controller
        subtitleController = new SubtitleController(video);
    }
}

// Run on load
attachVideoListeners();

// Observer for SPA (Single Page Applications)
const observer = new MutationObserver(() => {
    if (!document.querySelector('video')) return;
    attachVideoListeners();
    observer.disconnect();
});
observer.observe(document.body, { childList: true, subtree: true });

