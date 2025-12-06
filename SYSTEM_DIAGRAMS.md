# Visual System Diagrams

## State Machine Flow

```
                    ┌──────────────────────────────────┐
                    │   SubtitleController Created    │
                    │      isLiveMode = true           │
                    └──────────────┬───────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────────┐
                    │        LIVE MODE                 │
                    │  ┌────────────────────────┐      │
                    │  │  Server Response       │      │
                    │  │         ↓              │      │
                    │  │  Save to Cache         │      │
                    │  │         ↓              │      │
                    │  │  Push to RenderQueue   │      │
                    │  │         ↓              │      │
                    │  │  Typing Effect         │      │
                    │  └────────────────────────┘      │
                    └──────────────┬───────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
        Seek        │              │              │   Seek
        Backward    ▼              │              ▼   Forward
        ───────►  REPLAY           │           LIVE   ◄───────
                    │              │              │
                    │              │              │
                    ▼              ▼              ▼
        ┌─────────────────┐                ┌──────────────┐
        │  REPLAY MODE    │                │  LIVE MODE   │
        │  ┌──────────┐   │                │  (resumed)   │
        │  │timeupdate│   │                │              │
        │  │    ↓     │   │                │              │
        │  │Find in   │   │                │              │
        │  │Cache     │   │                │              │
        │  │    ↓     │   │                │              │
        │  │Display   │   │                │              │
        │  │Instantly │   │                │              │
        │  └──────────┘   │                │              │
        └─────────────────┘                └──────────────┘
```

---

## Data Structure Visualization

```
┌─────────────────────────────────────────────────────────────┐
│                   SubtitleController                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │ subtitleCache (The Database)                       │    │
│  ├────────────────────────────────────────────────────┤    │
│  │ [                                                  │    │
│  │   { start: 0.0,  end: 2.5,  text: "Hello world" },│    │
│  │   { start: 2.6,  end: 5.1,  text: "How are you" },│    │
│  │   { start: 5.2,  end: 7.8,  text: "I am fine"   },│    │
│  │   ...                                              │    │
│  │ ] (max 200 entries)                                │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │ renderQueue (FIFO Buffer - Live Mode Only)        │    │
│  ├────────────────────────────────────────────────────┤    │
│  │ ["Hello", " ", "world", " ", "from", " ", "AI"]   │    │
│  │   ▲                                          │          │
│  │   │ push                             shift   │          │
│  │   │ (from server)                    (typer)│          │
│  │                                              ▼          │
│  │                                          Display         │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  State Variables:                                          │
│  ├─ isLiveMode: true/false                                │
│  ├─ maxCapturedTime: 45.2 (seconds)                       │
│  ├─ LIVE_THRESHOLD: 2.0 (seconds)                         │
│  └─ currentDisplayedText: "Hello world from"               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Message Flow Sequence

```
┌─────────┐        ┌──────────┐        ┌──────────┐        ┌────────┐
│ Video   │        │ Content  │        │Background│        │Offscreen│
│ Player  │        │  Script  │        │  Script  │        │Document │
└────┬────┘        └─────┬────┘        └─────┬────┘        └────┬────┘
     │                   │                    │                  │
     │ seeking           │                    │                  │
     ├──────────────────>│                    │                  │
     │                   │                    │                  │
     │              handleSeek()              │                  │
     │                   │                    │                  │
     │                   │  TIME_SYNC         │                  │
     │                   ├───────────────────>│                  │
     │                   │                    │  TIME_SYNC       │
     │                   │                    ├─────────────────>│
     │                   │                    │                  │
     │                   │                    │ (Audio Capture)  │
     │                   │                    │<─────────────────┤
     │                   │                    │                  │
     │                   │                    │ TRANSCRIPTION    │
     │                   │  TRANSCRIPTION     │<─────────────────┤
     │                   │<───────────────────┤                  │
     │                   │                    │                  │
     │              onServerResponse()        │                  │
     │                   │                    │                  │
     │                   │ MAX_CAPTURED_TIME  │ MAX_CAPTURED_    │
     │                   │<───────────────────┤<─────TIME_UPDATE─┤
     │                   │                    │                  │
     │  Display subtitle │                    │                  │
     │<──────────────────┤                    │                  │
     │                   │                    │                  │
```

---

## Mode Decision Tree

```
                        User Seeks Video
                              │
                              ▼
                    ┌─────────────────────┐
                    │ Get currentTime     │
                    │ Get maxCapturedTime │
                    └──────────┬──────────┘
                              │
                              ▼
          ┌───────────────────────────────────────┐
          │                                       │
          │  currentTime < maxCapturedTime - 2s?  │
          │                                       │
          └───────────┬───────────────┬───────────┘
                      │               │
                 YES  │               │  NO
                      ▼               ▼
          ┌─────────────────┐   ┌──────────────┐
          │  REPLAY MODE    │   │  LIVE MODE   │
          ├─────────────────┤   ├──────────────┤
          │ • Clear queue   │   │ • Clear all  │
          │ • Set flag      │   │ • Reset time │
          │ • Render from   │   │ • Resume     │
          │   cache         │   │   typing     │
          └─────────────────┘   └──────────────┘
```

---

## Typing Effect Timeline

```
Time:     0ms    100ms   200ms   300ms   400ms   500ms   600ms
          │       │       │       │       │       │       │
Queue:   [Hello] [" "]  [world] [" "]  [from]  [" "]   [AI]
          │       │       │       │       │       │       │
Display:  H       H       Hw      Hw      Hwf     Hwf     HwfA
          e       e       eo      eo      er      er      er
          l       l       l       l       o       o       o
          l       l       lr      lr      m       m       m
          o       o       o       o               
                          d       d
                                  
Result:
  0ms:   "Hello"
  200ms: "Hello world"
  400ms: "Hello world from"
  600ms: "Hello world from AI"
```

---

## Cache Lookup Visualization (Replay Mode)

```
Video Timeline:
  0s─────10s────20s────30s────40s────50s────60s
         │                    │           │
         └─ User at 10s       │           └─ maxCapturedTime
                              └─ Cache covers up to here

subtitleCache:
  [{start: 0,  end: 2.5,  text: "..."}, ← Not shown (before 10s)
   {start: 2.6, end: 5.1,  text: "..."}, ← Not shown
   {start: 8.0, end: 11.5, text: "MATCHED!"}, ← DISPLAYED!
   {start: 12.0, end: 15.2, text: "..."}, ← Not shown (after 10s)
   ...]

Lookup Logic:
  currentTime = 10.0
  Find where: 10.0 >= start AND 10.0 <= end
  → Found: {start: 8.0, end: 11.5, text: "MATCHED!"}
  → Display instantly
```

---

## Component Interaction Map

```
┌────────────────────────────────────────────────────────────┐
│                        Browser Tab                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌──────────────┐           ┌────────────────────────┐    │
│  │ Video Element│           │  Subtitle Overlay      │    │
│  │   <video>    │           │  (Fixed Position)      │    │
│  │              │  events   │                        │    │
│  │  • seeking   ├──────────>│  content.js            │    │
│  │  • seeked    │           │  SubtitleController    │    │
│  │  • timeupdate│           │                        │    │
│  │  • ratechange│           │  • isLiveMode          │    │
│  └──────────────┘           │  • renderQueue         │    │
│                             │  • subtitleCache       │    │
│                             │  • maxCapturedTime     │    │
│                             └───────┬────────────────┘    │
│                                     │ chrome.runtime     │
│                                     │ .sendMessage       │
└─────────────────────────────────────┼────────────────────┘
                                      │
                  ┌───────────────────┴───────────────────┐
                  │                                       │
                  ▼                                       │
┌────────────────────────────┐            ┌──────────────┴───────┐
│  background.js             │            │  offscreen.js        │
│  (Service Worker)          │            │  (Hidden Document)   │
├────────────────────────────┤            ├──────────────────────┤
│  • Message Relay           │◄──────────>│  • Audio Capture     │
│  • Tab Management          │  messages  │  • WebSocket Client  │
│                            │            │  • maxCapturedTime   │
└────────────────────────────┘            │    Tracking          │
                                          └──────────┬───────────┘
                                                     │ WebSocket
                                                     │
                                          ┌──────────▼───────────┐
                                          │  Backend Server      │
                                          │  (Python/Jupyter)    │
                                          ├──────────────────────┤
                                          │  • ASR Processing    │
                                          │  • Translation       │
                                          │  • Result Streaming  │
                                          └──────────────────────┘
```

---

## Performance Optimization Flow

```
Server Response Arrives
        │
        ▼
┌───────────────────┐
│ onServerResponse()│
└────────┬──────────┘
         │
         ├─────► Save to Cache (O(n log n) sort, O(1) push)
         │
         ├─────► Update maxCapturedTime (O(1))
         │
         └─────► IF isLiveMode:
                    │
                    ├─► Clear display (O(1))
                    │
                    ├─► Split text (O(m) where m = words)
                    │
                    └─► Push to queue (O(m))

Typer Loop (100ms interval)
        │
        ▼
┌──────────────────┐
│ Check isLiveMode │ ◄── Fast boolean check
└────────┬─────────┘
         │
         └─────► IF true & queue not empty:
                    │
                    ├─► Shift word (O(1) with array shift)
                    │
                    └─► Append to display (O(1) DOM update)

Replay Mode (on timeupdate)
        │
        ▼
┌──────────────────┐
│ renderReplayMode │
└────────┬─────────┘
         │
         ├─────► Find in cache (O(n) linear search)
         │          Could optimize with binary search O(log n)
         │
         └─────► IF found & different:
                    │
                    └─► Update display (O(1) DOM update)
```

---

## Memory Management

```
┌─────────────────────────────────────────────────────────┐
│             Memory Footprint Analysis                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  subtitleCache (max 200 entries):                      │
│    200 × ~100 bytes = ~20 KB                           │
│                                                         │
│  renderQueue (typical 10-20 words):                    │
│    20 × ~10 bytes = ~200 bytes                         │
│                                                         │
│  Overlay DOM element:                                  │
│    ~1 KB                                               │
│                                                         │
│  Controller instance:                                  │
│    ~2 KB                                               │
│                                                         │
│  Total: ~23 KB (negligible for modern browsers)        │
│                                                         │
└─────────────────────────────────────────────────────────┘

Eviction Strategy:
  When cache reaches 201 entries:
    1. Sort by start time (already sorted on insert)
    2. Remove first (oldest) entry
    3. Maintains FIFO order
```

---

**Note**: All diagrams are text-based for maximum compatibility. For interactive visualizations, consider using tools like Mermaid or PlantUML with the same logic.
