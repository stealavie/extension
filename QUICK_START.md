# Quick Start Guide: Dual-Mode Subtitle System

## What Changed?

Your extension now has **intelligent subtitle rendering** with two modes:

### 🎬 Live Mode (Default)
- Subtitles appear **word-by-word** with a typing effect
- Active when watching current/live content
- Smooth, engaging user experience

### 📼 Replay Mode (Auto-switch)
- Subtitles appear **instantly** from cache
- Activates automatically when you seek backward
- No waiting for server responses

---

## How It Works (User Perspective)

### Normal Watching
1. Play a video
2. Subtitles appear word-by-word as audio is processed
3. Natural, typewriter-like effect

### Seeking Backward
1. Drag the video timeline back (e.g., to replay a section)
2. **Subtitles instantly appear** from memory
3. No lag, no waiting

### Returning to Live
1. Seek forward to the current position
2. System automatically switches back to Live Mode
3. Typing effect resumes

---

## Technical Details

### Mode Detection
```
If you seek more than 2 seconds behind the furthest captured audio:
  → Replay Mode (instant display)
Otherwise:
  → Live Mode (typing effect)
```

### Data Storage
- **Cache**: Stores last 200 subtitle entries
- **Queue**: Buffers incoming words for typing effect
- **Sync**: Tracks max captured time for intelligent switching

---

## Console Logging

You'll see messages like:

```
[SubtitleController] Initialized with dual-mode system
[SubtitleController] Seeking to 30.50s, maxCaptured: 45.20s
[SubtitleController] 🔄 Switching to REPLAY MODE
[SubtitleController] Server response - Mode: LIVE
```

---

## Performance Metrics

- **Typing Speed**: 100ms per word
- **Position Update**: Every 500ms
- **Time Sync**: Every 2 seconds
- **Cache Sync**: Every 1 second

---

## Troubleshooting

### Subtitles not appearing?
- Check console for `SubtitleController Initialized`
- Verify WebSocket connection in Network tab

### Typing too slow/fast?
- Edit `setTimeout(typerLoop, 100)` in content.js
- Lower = faster, Higher = slower

### Mode not switching?
- Check `maxCapturedTime` in console
- Adjust `LIVE_THRESHOLD` (currently 2.0s)

### Overlay positioning issues?
- Check video element is properly detected
- Inspect `updateOverlayPosition()` calculations

---

## Files Modified

✅ `extension/content.js` - Main controller with dual-mode logic  
✅ `extension/offscreen.js` - Audio tracking + time sync  
✅ `extension/background.js` - Message forwarding  

---

## Next Steps

1. **Test** the extension with a video
2. **Observe** the mode switching by seeking
3. **Adjust** timing constants if needed
4. **Monitor** console for any errors

---

## Quick Test Procedure

1. Load extension
2. Open a video (YouTube, etc.)
3. Start recording (extension popup)
4. Watch for 10 seconds (Live Mode)
5. Seek back 5 seconds → Should see instant subtitles
6. Seek forward to end → Should resume typing effect

---

**Status**: ✅ Ready to Use  
**Mode**: Automatic (no user configuration needed)  
**Performance**: Optimized for real-time streaming
