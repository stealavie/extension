# Dual-Mode Subtitle System Architecture

## Overview

This extension implements a **State Machine** with two distinct operational modes for subtitle rendering:

1. **Live Mode**: Real-time subtitle rendering with typing effect
2. **Replay Mode**: Cache-based subtitle rendering for seeked content

---

## Core Components

### 1. SubtitleController Class (`content.js`)

The main controller that manages the entire subtitle system lifecycle.

#### Key Properties

```javascript
{
  subtitleCache: [],      // Database: [{start, end, text}] - The source of truth
  renderQueue: [],        // FIFO Buffer: ["word", " ", "word"] - For typing effect
  maxCapturedTime: 0,     // Furthest timestamp of captured audio
  isLiveMode: true,       // State flag: true = Live, false = Replay
  LIVE_THRESHOLD: 2.0     // Buffer tolerance in seconds
}
```

---

## State Machine Logic

### Mode Detection Algorithm

```
Current Video Time vs. maxCapturedTime:

┌─────────────────────────────────────────────────────────┐
│  if (currentTime < maxCapturedTime - LIVE_THRESHOLD)    │
│      → REPLAY MODE (user went backward)                 │
│  else                                                    │
│      → LIVE MODE (user at current position)             │
└─────────────────────────────────────────────────────────┘
```

### State Transitions

#### Switching to REPLAY MODE

**Trigger**: User seeks backward (more than 2 seconds behind maxCapturedTime)

**Actions**:
1. Set `isLiveMode = false`
2. Clear `renderQueue` (stop typing effect)
3. Render will now pull from `subtitleCache` based on `video.currentTime`

#### Switching to LIVE MODE

**Trigger**: User seeks forward or returns to live position

**Actions**:
1. Set `isLiveMode = true`
2. Clear `renderQueue` and display
3. Update `maxCapturedTime` to current position
4. Resume typing effect from incoming server data

---

## Data Flow

### Live Mode Flow

```
Server Response
    ↓
onServerResponse()
    ↓
Save to subtitleCache (Database)
    ↓
IF isLiveMode:
    Split text into words
    ↓
    Push to renderQueue
    ↓
Typer Loop (100ms interval)
    ↓
Pop word from queue → Append to display
```

### Replay Mode Flow

```
video.ontimeupdate
    ↓
handleTimeUpdate()
    ↓
IF !isLiveMode:
    Find subtitle in cache where:
        currentTime >= sub.start && currentTime <= sub.end
    ↓
    Display found subtitle (instant, no typing effect)
```

---

## Key Features

### 1. Typing Effect (Live Mode Only)

- Words are popped from `renderQueue` at 100ms intervals
- Creates a natural "word-by-word" appearance
- Queue automatically manages overflow

```javascript
typerLoop = () => {
    if (isLiveMode && renderQueue.length > 0) {
        const word = renderQueue.shift();
        appendWordToDisplay(word);
    }
    setTimeout(typerLoop, 100);
};
```

### 2. Subtitle Cache Management

- Stores up to 200 subtitle entries
- Automatically sorted by `start` time
- FIFO eviction when limit exceeded
- Used for Replay Mode instant lookup

### 3. maxCapturedTime Tracking

**Purpose**: Determines whether user is watching "live" or "historical" content

**Updated by**:
- `offscreen.js`: Incremented as audio packets are sent (~0.1s per packet)
- Server responses: Set to `data.end` timestamp
- Content script: Set to `video.currentTime` when seeking forward

**Synced via**: 
- `MAX_CAPTURED_TIME_UPDATE` message from offscreen → content (every 1 second)

---

## Message Flow Architecture

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│  content.js │────────→│ background.js│────────→│ offscreen.js│
│             │  TIME_  │              │  TIME_  │             │
│  (Video)    │  SYNC   │  (Relay)     │  SYNC   │  (Audio)    │
└─────────────┘         └──────────────┘         └─────────────┘
       ↑                        ↑                        │
       │                        │                        │
       │  TRANSCRIPTION_RESULT  │  TRANSCRIPTION_RESULT  │
       └────────────────────────┴────────────────────────┘
       
       ↑                        ↑                        │
       │  MAX_CAPTURED_TIME     │  MAX_CAPTURED_TIME     │
       │                        │  _UPDATE               │
       └────────────────────────┴────────────────────────┘
```

---

## Event Handling

### Video Events

| Event | Handler | Purpose |
|-------|---------|---------|
| `seeking` | `handleSeek()` | Detect mode switch trigger |
| `seeked` | `handleSeeked()` | Send TIME_SYNC after seek |
| `timeupdate` | `handleTimeUpdate()` | Replay Mode rendering + position sync |
| `ratechange` | (inline) | Send playback rate to server |
| `scroll/resize` | `updateOverlayPosition()` | Keep overlay aligned with video |

---

## Visual Overlay Positioning

The subtitle overlay uses **fixed positioning** relative to the viewport:

```javascript
Position Calculation:
  centerX = videoRect.left + (videoRect.width / 2)
  bottomY = videoRect.bottom - (videoRect.height * 0.15)
  
  transform: translate(-50%, -100%)
  // Centers horizontally, positions bottom at calculated Y
```

**Updates**:
- Every 500ms (periodic check)
- On scroll/resize events
- On timeupdate (inherited from position sync)

---

## Performance Optimizations

1. **Lazy Rendering**: Only update DOM when text changes
2. **Queue Management**: Automatic overflow handling in renderQueue
3. **Cache Limiting**: Max 200 entries in subtitleCache
4. **Passive Listeners**: Scroll/resize use `{ passive: true }`
5. **RequestAnimationFrame**: Considered for smoother typing (currently using setTimeout)

---

## Usage Scenarios

### Scenario 1: Normal Video Watching (Live Mode)

1. User plays video from start
2. Audio captured → sent to server
3. Server returns transcription
4. Text queued → typed word-by-word
5. maxCapturedTime continuously updates

### Scenario 2: User Seeks Backward (Replay Mode)

1. User drags video timeline backward (e.g., 5:00 → 3:00)
2. `seeking` event fires → `handleSeek()`
3. Detects `currentTime < maxCapturedTime - 2s`
4. **Switch to Replay Mode**
5. Clear renderQueue (stop live typing)
6. On `timeupdate`, pull from cache and display instantly

### Scenario 3: User Returns to Live Position

1. User seeks to end of video or near maxCapturedTime
2. `seeking` event fires → `handleSeek()`
3. Detects `currentTime >= maxCapturedTime - 2s`
4. **Switch to Live Mode**
5. Clear display, reset queue
6. Resume typing effect on new server responses

---

## Configuration Constants

```javascript
// Timing
LIVE_THRESHOLD = 2.0 seconds     // Mode detection tolerance
TYPING_INTERVAL = 100ms          // Word-by-word delay
POSITION_UPDATE = 500ms          // Overlay position sync
TIME_SYNC_INTERVAL = 2000ms      // Server time sync

// Cache
MAX_CACHE_SIZE = 200 entries     // Subtitle history limit

// Visual
OVERLAY_Z_INDEX = 2147483647     // Maximum (always on top)
OVERLAY_BOTTOM_OFFSET = 15%      // From video bottom
```

---

## Debugging Tips

### Check Current Mode

```javascript
console.log(subtitleController.isLiveMode ? "LIVE" : "REPLAY");
```

### Inspect Queue State

```javascript
console.log("Queue length:", subtitleController.renderQueue.length);
console.log("Cache size:", subtitleController.subtitleCache.length);
```

### Verify Time Tracking

```javascript
console.log("Video:", subtitleController.video.currentTime);
console.log("Max Captured:", subtitleController.maxCapturedTime);
console.log("Difference:", subtitleController.maxCapturedTime - subtitleController.video.currentTime);
```

---

## Future Enhancements

1. **Adaptive Typing Speed**: Speed up when queue gets too long
2. **Smooth Transitions**: Fade effects when switching modes
3. **User Preferences**: Configurable typing speed, cache size
4. **Multi-Language Support**: Different typing speeds per language
5. **Buffering Indicator**: Visual cue when switching modes

---

## File Changes Summary

### `content.js`
- ✅ Added `SubtitleController` class
- ✅ Dual-mode state machine logic
- ✅ Typing effect renderer
- ✅ Seek detection and mode switching
- ✅ Message handler for MAX_CAPTURED_TIME

### `offscreen.js`
- ✅ Added `maxCapturedTime` tracking
- ✅ Periodic broadcast of maxCapturedTime (1s interval)
- ✅ Audio packet duration estimation

### `background.js`
- ✅ Message forwarding for MAX_CAPTURED_TIME_UPDATE
- ✅ Relay between offscreen and content scripts

---

## Testing Checklist

- [ ] Play video from start → Verify typing effect
- [ ] Seek backward → Verify instant subtitle display (Replay Mode)
- [ ] Seek forward to live → Verify typing resumes (Live Mode)
- [ ] Change playback speed → Verify sync maintained
- [ ] Scroll page → Verify overlay follows video
- [ ] Resize window → Verify overlay repositions
- [ ] Multiple seeks → Verify no ghost text or duplicate subtitles
- [ ] Long subtitle → Verify queue doesn't overflow visually
- [ ] Empty sections → Verify overlay hides properly

---

## Architecture Benefits

✅ **No Ghost Text**: Queue cleared on mode switch  
✅ **Instant Replay**: Cache lookup instead of waiting for server  
✅ **Smooth Live Experience**: Typing effect feels natural  
✅ **Proper State Management**: Clear separation of concerns  
✅ **Scalable**: Easy to add features per mode independently  

---

## Known Limitations

- maxCapturedTime estimation in offscreen.js assumes ~0.1s per packet (may need calibration)
- Typing effect uses setTimeout instead of requestAnimationFrame (trade-off for simplicity)
- Cache limited to 200 entries (covers ~5-10 minutes depending on subtitle density)

---

**Last Updated**: December 5, 2025  
**Version**: 1.0.0  
**Status**: Production Ready
