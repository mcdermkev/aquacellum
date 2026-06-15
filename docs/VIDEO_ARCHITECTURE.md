# Video & Livestream — Architecture Document

> Short-form video in The Reef social feed, always-on Tank Cams, and live
> streaming for Virtual Tides — built incrementally on the existing Supabase +
> Vercel + React stack.

---

## Vision

A hobbyist records a 30-second clip of their new Betta flaring. They post it as
a Current; it plays inline in the feed, autoplay-on-scroll, tap to unmute — like
everywhere else on the modern web, except here it's fish.

Later, they plug in a $30 Wyze cam above their tank and register it as a Tank
Cam. Friends browse "Live Tanks" and watch their community's aquariums running
in real time, dropping reactions as a Discus comes out from behind driftwood.

During a Virtual Tide (online event), the host broadcasts a live walkthrough of
their fish room. Attendees see the stream with TideChat overlaid, Poseidon
narrates species on-screen, and trades happen in the sidebar.

Three tiers of video. One architecture.

---

## Current State

| Capability | Status |
|------------|--------|
| Image upload in Currents | ✅ Working (Supabase Storage → `media_urls`) |
| Media validation | ✅ JPEG/PNG/WebP/GIF, max 5 MB |
| Alt text generation | ✅ Poseidon AI auto-generates |
| TideLiveFeed (realtime events) | ✅ Supabase Realtime channel |
| TideChat (ephemeral messages) | ✅ 300-char, rate-limited |
| Virtual Tide video | ❌ "Coming Soon" placeholder |
| Video upload | ❌ Not implemented |
| Tank Cam / persistent stream | ❌ Not implemented |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  CLIENT (React + Vite)                                                       │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────────────┐ │
│  │  VideoRecorder    │  │  VideoPlayer     │  │  TankCamViewer             │ │
│  │  (MediaRecorder)  │  │  (HLS.js / <video>)│  │  (HLS.js low-latency)    │ │
│  └────────┬─────────┘  └────────▲─────────┘  └────────────▲───────────────┘ │
│           │ upload               │ playback                │ live playback    │
│           ▼                      │                         │                  │
│  ┌──────────────────┐            │                         │                  │
│  │  videoUpload.js   │            │                         │                  │
│  │  (compress +      │            │                         │                  │
│  │   upload to Mux)  │            │                         │                  │
│  └────────┬─────────┘            │                         │                  │
└───────────┼──────────────────────┼─────────────────────────┼──────────────────┘
            │                      │                         │
            ▼                      │                         │
┌───────────────────────┐          │                         │
│  Vercel Serverless    │          │                         │
│  /api/video-upload    │ returns  │                         │
│  (presigned URL or    │──────────┘                         │
│   direct upload URL)  │  playback_id                       │
└───────────┬───────────┘                                    │
            │                                                │
            ▼                                                │
┌───────────────────────────────────────────────────────────────────────────────┐
│  MUX (or Cloudflare Stream)                                                   │
│                                                                               │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────────────────┐  │
│  │  Video Upload    │  │  Live Streaming  │  │  Asset Management           │  │
│  │  • Direct upload │  │  • RTMP ingest   │  │  • Thumbnails               │  │
│  │  • Transcoding   │  │  • WebRTC ingest │  │  • Playback URLs            │  │
│  │  • HLS delivery  │  │  • LL-HLS output │  │  • Duration / status        │  │
│  └─────────────────┘  └──────────────────┘  └─────────────────────────────┘  │
│                                                                               │
│  Webhook → /api/mux-webhook → updates Supabase row with status               │
└───────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  SUPABASE                                                                     │
│                                                                               │
│  currents table:                                                              │
│    + video_playback_id TEXT          (Mux playback ID for on-demand video)    │
│    + video_thumbnail_url TEXT        (auto-generated poster frame)            │
│    + video_duration_seconds NUMERIC  (for UI: progress bar, time badge)       │
│    + video_status TEXT               (uploading / processing / ready / error) │
│                                                                               │
│  tank_cams table (NEW):                                                       │
│    id UUID PK                                                                 │
│    owner_wallet TEXT FK → profiles                                            │
│    tank_id TEXT FK → tanks                                                    │
│    tank_name TEXT                                                             │
│    mux_live_stream_id TEXT           (Mux live stream resource ID)            │
│    mux_playback_id TEXT              (for viewers)                            │
│    stream_key TEXT                   (secret — for OBS/camera ingest)         │
│    status TEXT                       (idle / active / disconnected)           │
│    viewer_count INTEGER DEFAULT 0                                             │
│    created_at TIMESTAMPTZ                                                     │
│    last_active_at TIMESTAMPTZ                                                 │
│                                                                               │
│  tide_streams table (NEW):                                                    │
│    id UUID PK                                                                 │
│    tide_id UUID FK → tides                                                   │
│    host_wallet TEXT FK → profiles                                             │
│    mux_live_stream_id TEXT                                                    │
│    mux_playback_id TEXT                                                       │
│    stream_key TEXT                                                            │
│    status TEXT                        (idle / live / ended)                   │
│    recording_playback_id TEXT         (VOD after stream ends)                 │
│    created_at TIMESTAMPTZ                                                     │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1 — Short-Form Video in Currents

**Goal:** Users can record or select a video clip (15–60s) and post it as a
Current. It plays inline in the feed with autoplay-on-scroll behavior.

### 1.1 Client-Side Recording & Selection

```
┌────────────────────────────────────────────────────────────┐
│  <VideoRecorder />                                         │
│                                                            │
│  Two modes:                                                │
│  A) File picker: <input type="file" accept="video/*">     │
│     → user selects from gallery                            │
│  B) In-app camera: MediaRecorder API                       │
│     → record directly, 60s max, with timer UI              │
│                                                            │
│  Both produce a Blob → passed to videoUpload.js            │
└────────────────────────────────────────────────────────────┘
```

**Recording constraints:**
- Max duration: 60 seconds (enforced client-side via `MediaRecorder.stop()` on timer)
- Resolution cap: 1080p (if source is higher, scale down on canvas before encoding)
- Preferred codec: VP9/WebM or H.264/MP4 (browser-dependent; Mux accepts both)
- Max file size: 100 MB pre-upload (Mux handles transcoding to multiple bitrates)

**UX during recording:**
- Circular timer ring around record button
- Live preview via `<video>` playing the camera stream
- Tap to stop early
- Post-recording: trim handles for start/end (optional v1.1 enhancement)

### 1.2 Upload Pipeline — `videoUpload.js`

Mirrors the existing `mediaUpload.js` pattern but targets Mux instead of
Supabase Storage (video transcoding is not something you want to DIY).

```js
// videoUpload.js — pseudocode outline

const MAX_VIDEO_DURATION_S = 60;
const MAX_VIDEO_SIZE_MB = 100;
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export async function uploadVideo(file, onProgress) {
  // 1. Validate type + size
  // 2. Extract duration via <video> element preload="metadata"
  //    → reject if > 60s
  // 3. Request upload URL from /api/video-upload
  //    → returns { uploadUrl, assetId, playbackId }
  // 4. PUT file to Mux direct upload URL with progress tracking
  // 5. Return { playbackId, thumbnailUrl (placeholder until webhook), duration }
}
```

### 1.3 Serverless API — `/api/video-upload.js`

```js
// Vercel serverless function
// POST /api/video-upload
// Auth: wallet signature or Privy session token

import Mux from "@mux/mux-node";

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});

export default async function handler(req, res) {
  // 1. Verify auth (wallet or Privy token)
  // 2. Create a Mux Direct Upload
  const upload = await mux.video.uploads.create({
    new_asset_settings: {
      playback_policy: ["public"],
      encoding_tier: "baseline", // cheaper tier for short clips
    },
    cors_origin: process.env.FRONTEND_ORIGIN,
  });
  // 3. Return upload URL + asset info to client
  res.json({
    uploadUrl: upload.url,
    uploadId: upload.id,
  });
}
```

### 1.4 Webhook — `/api/mux-webhook.js`

Mux sends webhooks when transcoding completes. We update Supabase with the
final playback ID, thumbnail, and duration.

```js
// POST /api/mux-webhook
// Mux signature verification

export default async function handler(req, res) {
  // 1. Verify Mux webhook signature
  // 2. Handle event types:
  //    "video.asset.ready" → update currents row:
  //      video_status = "ready"
  //      video_playback_id = asset.playback_ids[0].id
  //      video_thumbnail_url = `https://image.mux.com/${playbackId}/thumbnail.webp`
  //      video_duration_seconds = asset.duration
  //    "video.asset.errored" → video_status = "error"
  //    "video.upload.asset_created" → video_status = "processing"
  res.status(200).end();
}
```

### 1.5 Feed Playback — `<VideoPlayer />`

```jsx
function VideoPlayer({ playbackId, thumbnailUrl, duration, autoPlay = true }) {
  // Uses Mux's HLS URL: https://stream.mux.com/{playbackId}.m3u8
  // Loads hls.js for non-Safari browsers, native HLS for Safari/iOS
  //
  // Behavior:
  // - Intersection Observer: autoplay muted when >50% visible
  // - Tap/click: toggle mute (first interaction) → toggle play/pause
  // - Duration badge in bottom-right corner
  // - Poster: thumbnailUrl (Mux auto-generated)
  // - Loading state: blurred thumbnail + spinner
  // - Error state: "Video unavailable" with retry button
}
```

**Autoplay-on-scroll (TikTok pattern):**
```
┌─────────────────────────────┐
│  IntersectionObserver        │
│  threshold: 0.5              │
│                             │
│  onIntersect:               │
│    → video.play() (muted)   │
│                             │
│  onLeave:                   │
│    → video.pause()          │
│    → video.currentTime = 0  │
└─────────────────────────────┘
```

### 1.6 Database Changes

```sql
-- Add video fields to existing currents table
ALTER TABLE currents
  ADD COLUMN video_playback_id TEXT,
  ADD COLUMN video_thumbnail_url TEXT,
  ADD COLUMN video_duration_seconds NUMERIC,
  ADD COLUMN video_status TEXT DEFAULT NULL;

-- Index for filtering video-only Currents
CREATE INDEX idx_currents_has_video ON currents (video_playback_id)
  WHERE video_playback_id IS NOT NULL;
```

### 1.7 AI Integration (leveraging existing Poseidon)

When a video finishes processing, an async job can:
1. Sample 3–5 frames from the video via Mux's frame URLs:
   `https://image.mux.com/{playbackId}/thumbnail.webp?time={seconds}`
2. Send each frame to the existing `/api/generate-alt-text` endpoint
3. Combine results into a video description:
   "30s clip: Cardinal Tetras schooling in a planted tank, Amano Shrimp
   grazing on driftwood at 0:15, CO2 bubbles visible"
4. Store as `video_alt_text` for accessibility + search indexing

---

## Phase 2 — Tank Cams (Always-On Ambient Streams)

**Goal:** Users register a persistent webcam pointed at their tank. Friends can
browse live Tank Cams, watch in real time, and drop reactions.

This is the differentiator. No one else does this well for fishkeeping.

### 2.1 Concept: Ambient vs. Performative

Traditional livestreaming (Twitch, YouTube Live) is performative — you "go
live," you perform, you end. Tank Cams are ambient. The camera is always on.
The fish don't know you're watching. There's no host performing. It's meditative.

This means:
- No "start stream" button in the app — the camera runs independently
- The app just *observes* whether the stream is active
- Viewers can come and go; no obligation on the tank owner
- It's closer to a security camera feed than a Twitch stream

### 2.2 How It Works (User Flow)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Tank Owner Setup (one-time)                                        │
│                                                                     │
│  1. Go to Tank Settings → "Tank Cam" toggle                        │
│  2. App creates a Mux Live Stream resource via /api/tank-cam-setup  │
│  3. App displays the RTMP URL + Stream Key                          │
│     (e.g., rtmp://global-live.mux.com/app + sk_live_xxx)            │
│  4. Owner configures their camera/OBS with those credentials        │
│     Supported cameras:                                              │
│       • Wyze Cam v3 (RTMP firmware)                                 │
│       • Any IP camera with RTMP output                              │
│       • OBS Studio (desktop)                                        │
│       • Phone as webcam (via Larix Broadcaster, Prism Live)         │
│  5. When camera connects, Mux webhook fires → status = "active"    │
│  6. Tank Cam appears in "Live Tanks" discovery feed                 │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Viewer Experience                                                   │
│                                                                     │
│  1. Browse "Live Tanks" section (sorted by viewer count / friends)  │
│  2. Tap a Tank Cam → full-screen low-latency HLS player            │
│  3. Overlay: tank name, owner profile, species list, reactions      │
│  4. Drop emoji reactions (float up like Periscope hearts)           │
│  5. Optional: Poseidon can narrate species if AI detection is on    │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.3 API Endpoints

```
POST /api/tank-cam-setup
  → Creates Mux live stream, stores in tank_cams table
  → Returns { rtmpUrl, streamKey, playbackId }

DELETE /api/tank-cam-setup?camId=xxx
  → Disables and deletes the Mux live stream resource

GET /api/tank-cams
  → Returns active Tank Cams (status = "active") sorted by viewer_count
  → Includes owner profile, tank info, playback ID

POST /api/mux-webhook (extended)
  → "video.live_stream.active" → tank_cams.status = "active"
  → "video.live_stream.idle"   → tank_cams.status = "idle"
  → "video.live_stream.disconnected" → tank_cams.status = "disconnected"
```

### 2.4 Low-Latency Playback

For Tank Cams, sub-5-second latency matters (reactions should feel real-time).

Mux supports LL-HLS (Low-Latency HLS) out of the box:
```
https://stream.mux.com/{playbackId}.m3u8?redundant_streams=true&max_resolution=720p
```

With `hls.js` configured for low-latency:
```js
const hls = new Hls({
  lowLatencyMode: true,
  liveSyncDurationCount: 2,
  liveMaxLatencyDurationCount: 5,
});
```

### 2.5 Viewer Presence & Reactions

```
┌─────────────────────────────────────────────────────────────────┐
│  Supabase Realtime Channel per Tank Cam                         │
│                                                                 │
│  Channel: "tank-cam:{camId}"                                    │
│                                                                 │
│  Presence: track viewer count (Supabase Presence API)           │
│  Broadcast: reactions (emoji + position) from viewers           │
│                                                                 │
│  Viewer joins:                                                  │
│    channel.track({ wallet, joined_at })                         │
│  Viewer reacts:                                                 │
│    channel.send({ type: "reaction", emoji: "🐠" })             │
│  UI renders floating emoji animation on all viewers' screens    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.6 Privacy & Moderation

- Tank Cams are **opt-in** — only shows tank, not room/person
- Owner can set visibility: `public` | `tankmates_only` | `link_only`
- Owner can disable at any time (kills the Mux stream resource)
- Report button for inappropriate streams → flags for manual review
- No recording/archiving by default (Mux doesn't record unless configured)

---

## Phase 3 — Virtual Tide Livestream

**Goal:** Replace the "Coming Soon" placeholder in Virtual Tides with actual
live video from the host, overlaid with TideChat, TideLiveFeed, and trade/auction UI.

### 3.1 How It Differs From Tank Cams

| Aspect | Tank Cam | Tide Stream |
|--------|----------|-------------|
| Duration | Always-on (hours/days) | Event-scoped (1–3 hours) |
| Host presence | Passive (no host performing) | Active (host talking to audience) |
| Recording | Optional | Always recorded (becomes VOD recap) |
| Chat | Emoji reactions only | Full TideChat overlay |
| Latency need | 3–5s acceptable | Sub-3s preferred |
| End state | Camera disconnects | Stream ends → VOD available |

### 3.2 Host Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  Host starts Virtual Tide stream                                     │
│                                                                     │
│  1. Host opens Tide management → "Go Live" button                   │
│  2. Two options:                                                    │
│     A) Browser-based (WebRTC → Mux via WHIP)                       │
│        → Single click, camera + mic from browser                    │
│        → Lower quality but zero setup                               │
│     B) External (OBS/Streamlabs)                                    │
│        → Copy RTMP URL + key, configure externally                  │
│        → Higher quality, screen share, overlays                     │
│  3. Mux webhook fires → tide_streams.status = "live"               │
│  4. TidePage detects live status → renders <TideStreamPlayer />     │
│  5. All attendees see the stream + chat + live feed                 │
│  6. Host clicks "End Stream" → Mux stops, VOD begins processing    │
│  7. Webhook: recording ready → tide_streams.recording_playback_id   │
│  8. TidePage post-event shows VOD in Recap tab                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.3 Browser-Based Streaming (WHIP)

For hosts who don't want OBS, use Mux's WebRTC ingest via WHIP (WebRTC-HTTP
Ingestion Protocol). The browser captures camera+mic and pushes directly to Mux.

```js
// Simplified WHIP connection
async function startBrowserStream(streamKey) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, frameRate: 30 },
    audio: true,
  });

  // Use Mux's WHIP endpoint
  const whipUrl = `https://global-live.mux.com/app/${streamKey}/whip`;

  const pc = new RTCPeerConnection();
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const response = await fetch(whipUrl, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: offer.sdp,
  });

  const answerSdp = await response.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return { pc, stream }; // caller holds refs to stop later
}
```

### 3.4 Viewer Layout During Live Tide

```
┌──────────────────────────────────────────────────────────┐
│  ┌────────────────────────────────────────┐ ┌─────────┐ │
│  │                                        │ │  Chat   │ │
│  │          VIDEO PLAYER                  │ │  Panel  │ │
│  │          (LL-HLS stream)               │ │         │ │
│  │                                        │ │  msg... │ │
│  │  ┌─────────────────────────────────┐   │ │  msg... │ │
│  │  │  Floating reactions overlay     │   │ │  msg... │ │
│  │  └─────────────────────────────────┘   │ │         │ │
│  │                                        │ │  [input]│ │
│  │  🔴 LIVE  👥 47 viewers  🕐 01:23:45  │ │         │ │
│  └────────────────────────────────────────┘ └─────────┘ │
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │  Live Feed ticker: trades, check-ins, Poseidon msgs  ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  On mobile: video full-width, chat as bottom sheet       │
└──────────────────────────────────────────────────────────┘
```

### 3.5 Poseidon Integration During Streams

During a Virtual Tide, Poseidon can auto-generate narration:
1. Sample a frame from the live stream every 30s (via Mux thumbnail API on the live asset)
2. Run species detection on the frame
3. If new species detected → push a system message to TideChat:
   "🐙 Poseidon: I see a group of Discus — looks like Symphysodon aequifasciatus, the Blue variety"
4. Host can toggle this on/off in Tide settings

---

## Phase 4 — AI-Powered Video Features (Future)

### 4.1 Species Auto-Tagging in Uploaded Videos

```
Upload completes → Mux webhook fires "ready"
  → Async job samples 5 frames at even intervals
  → Each frame → /api/suggest-species (already exists)
  → Deduplicated species list stored on the Current
  → Video appears in species-specific searches
```

### 4.2 Behavior Highlight Clips

AI analyzes uploaded video for "interesting moments":
- Flaring, feeding, spawning, chasing, schooling
- Auto-generates 5–10s highlight clips with timestamps
- Displayed as "Moments" on the Current detail view

### 4.3 Health Comparison Over Time

User uploads weekly clips of the same tank. AI compares:
- Fish count (did any disappear?)
- Color saturation (stress indicators)
- Activity level (lethargy detection)
- Plant growth progression

Pairs with existing parameter tracking for a full picture.

---

## Tech Stack Additions

| Package | Purpose | Phase |
|---------|---------|-------|
| `@mux/mux-node` | Server-side Mux API (uploads, live streams, webhooks) | 1 |
| `hls.js` | HLS playback in non-Safari browsers | 1 |
| `@mux/mux-player-react` | (Optional) Drop-in React player with built-in controls | 1 |
| No client-side video compression lib | Mux handles all transcoding server-side | — |

**Why Mux over alternatives:**
- Cloudflare Stream: Cheaper per-minute but no live WebRTC ingest (WHIP), weaker
  developer tooling, no React player component.
- AWS IVS: More infrastructure to manage, pricing scales worse for small projects.
- YouTube/Twitch embeds: Loss of control, branding conflicts, ads.
- Self-hosted (nginx-rtmp): Operational burden, no adaptive bitrate, no CDN.

Mux gives you upload → transcode → HLS delivery → live streaming → webhooks →
thumbnails → analytics in one SDK with a generous free tier (no cost under
1,000 minutes/month of video delivered).

---

## File Structure (new files)

```
frontend/
├── api/
│   ├── video-upload.js          ← Direct upload URL creation
│   ├── mux-webhook.js           ← Webhook handler (video ready, stream status)
│   ├── tank-cam-setup.js        ← Create/delete Tank Cam live streams
│   └── tank-cams.js             ← List active Tank Cams
├── src/
│   ├── components/
│   │   ├── video/
│   │   │   ├── VideoRecorder.jsx      ← In-app camera recording UI
│   │   │   ├── VideoPlayer.jsx        ← HLS playback with autoplay-on-scroll
│   │   │   ├── VideoThumbnail.jsx     ← Poster frame with duration badge
│   │   │   └── FloatingReactions.jsx  ← Periscope-style emoji overlay
│   │   ├── tank-cam/
│   │   │   ├── TankCamSetup.jsx       ← RTMP credentials display + copy
│   │   │   ├── TankCamViewer.jsx      ← Low-latency stream player + reactions
│   │   │   └── TankCamDiscovery.jsx   ← Browse live cams grid
│   │   └── reef/
│   │       └── TideStreamPlayer.jsx   ← Live stream for Virtual Tides
│   ├── services/
│   │   └── videoUpload.js             ← Client upload logic (mirrors mediaUpload.js)
│   └── hooks/
│       ├── useVideoUpload.js          ← TanStack mutation for video upload
│       ├── useTankCam.js              ← Query + realtime for Tank Cam state
│       └── useTideStream.js           ← Query for Tide live stream state
└── ...existing files
```

---

## Database Migrations Summary

```sql
-- Phase 1: Video in Currents
ALTER TABLE currents
  ADD COLUMN video_playback_id TEXT,
  ADD COLUMN video_thumbnail_url TEXT,
  ADD COLUMN video_duration_seconds NUMERIC,
  ADD COLUMN video_status TEXT,
  ADD COLUMN video_alt_text TEXT;

CREATE INDEX idx_currents_video ON currents (video_playback_id)
  WHERE video_playback_id IS NOT NULL;

-- Phase 2: Tank Cams
CREATE TABLE tank_cams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_wallet TEXT NOT NULL REFERENCES profiles(wallet_address),
  tank_id TEXT,
  tank_name TEXT,
  mux_live_stream_id TEXT NOT NULL,
  mux_playback_id TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  visibility TEXT NOT NULL DEFAULT 'public',
  viewer_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ
);

CREATE INDEX idx_tank_cams_active ON tank_cams (status, viewer_count DESC)
  WHERE status = 'active';

-- Phase 3: Tide Streams
CREATE TABLE tide_streams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tide_id UUID NOT NULL REFERENCES tides(id),
  host_wallet TEXT NOT NULL REFERENCES profiles(wallet_address),
  mux_live_stream_id TEXT NOT NULL,
  mux_playback_id TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  recording_playback_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS policies (examples)
ALTER TABLE tank_cams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tank cam owners manage their own" ON tank_cams
  FOR ALL USING (owner_wallet = auth.jwt() ->> 'wallet_address');

CREATE POLICY "Public cams visible to all" ON tank_cams
  FOR SELECT USING (visibility = 'public' AND status = 'active');
```

---

## Environment Variables

```bash
# Mux (add to .env / Vercel project settings)
MUX_TOKEN_ID=your_mux_token_id
MUX_TOKEN_SECRET=your_mux_token_secret
MUX_WEBHOOK_SECRET=your_webhook_signing_secret

# Frontend origin (for CORS on direct uploads)
FRONTEND_ORIGIN=https://aquadex.io
```

---

## Cost Estimate (Mux Pricing — as of 2025)

| Usage tier | Video stored | Delivered | Live | Monthly cost |
|------------|-------------|-----------|------|--------------|
| MVP / beta | < 50 videos | < 1,000 min | 0 | **Free** (free tier covers this) |
| Growth (100 DAU) | ~200 videos | ~5,000 min | 2–3 Tank Cams | ~$20–40 |
| Scale (1,000 DAU) | ~2,000 videos | ~50,000 min | 20+ Tank Cams | ~$200–400 |

Mux charges:
- Storage: $0.007/min stored/month
- Delivery: $0.00XX/min delivered (varies by resolution)
- Live: Same delivery rate, no extra "live" fee
- Encoding: One-time $0.015/min for transcoding

For a fishkeeping community app, this is negligible until you hit real scale.

---

## Implementation Priority

```
Phase 1 (Video in Currents)          ← 1–2 weeks
  ├── videoUpload.js service
  ├── /api/video-upload endpoint
  ├── /api/mux-webhook endpoint
  ├── VideoPlayer component
  ├── VideoRecorder component
  ├── DB migration (currents columns)
  └── Feed integration (CurrentCard renders video)

Phase 2 (Tank Cams)                  ← 2–3 weeks
  ├── /api/tank-cam-setup endpoint
  ├── TankCamSetup component (settings page)
  ├── TankCamViewer component (LL-HLS + reactions)
  ├── TankCamDiscovery component (browse grid)
  ├── Supabase Realtime channel for presence/reactions
  ├── DB migration (tank_cams table)
  └── Mux webhook extension (live stream status)

Phase 3 (Tide Livestream)            ← 1–2 weeks (builds on Phase 2)
  ├── /api/tide-stream-setup endpoint
  ├── TideStreamPlayer component
  ├── WHIP browser streaming option
  ├── TidePage integration (replace Coming Soon)
  ├── VOD recording for post-event recap
  └── DB migration (tide_streams table)

Phase 4 (AI Video Features)          ← ongoing
  ├── Species auto-tagging pipeline
  ├── Behavior highlight detection
  └── Health comparison tool
```

---

## Security Considerations

1. **Stream keys are secrets** — never expose in client-side code or API responses
   to non-owners. Store in `stream_key` column with RLS policy restricting SELECT
   to the owner wallet only.

2. **Webhook verification** — always verify Mux webhook signatures before processing.
   Reject unsigned or malformed payloads.

3. **Upload authorization** — `/api/video-upload` must verify the caller is
   authenticated (Privy session or wallet signature) before issuing a Mux upload URL.
   Rate limit to 10 uploads/hour per wallet.

4. **Content moderation** — Mux offers optional moderation add-ons. For MVP,
   rely on community reporting (same pattern as Current flagging). Phase 2+:
   enable Mux's auto-moderation for live streams.

5. **CORS** — Mux direct uploads require `cors_origin` matching your domain.
   Set to your production URL only (not `*`).

---

## Relationship to Existing Systems

| Existing system | How video integrates |
|----------------|---------------------|
| `mediaUpload.js` | `videoUpload.js` follows same pattern; both return URLs stored in `currents` |
| `createCurrent()` in reefApi | Gains optional `videoPlaybackId` param alongside `mediaUrls` |
| `ReefFeed` / `CurrentCard` | Detects `video_playback_id` → renders `<VideoPlayer>` instead of `<img>` |
| `TidePage` / `TideLiveFeed` | Phase 3 replaces "Coming Soon" with `<TideStreamPlayer>` |
| `generateAltText` | Extended to sample video frames for video descriptions |
| Supabase Realtime | Already used for TideChat/LiveFeed; Tank Cam reactions use same infra |
| Poseidon AI | Species detection on video frames; narration during live streams |
| XP system | Post video = XP; first Tank Cam setup = badge/XP; host a Tide stream = XP |

---

## The "Always-On Aquarium" Differentiator

No social platform does ambient video well for niche communities. YouTube Live
requires a channel. Twitch is performative. Instagram Live expires. What we're
building with Tank Cams is:

- **Zero-effort for the owner** — plug in a camera once, forget about it
- **Meditative for viewers** — watch fish swim, no host talking at you
- **Social without pressure** — drop a 🐠 reaction, leave, come back later
- **Data-rich** — because we know what tank it is, what species are in it,
  what parameters look like, we can overlay contextual info no other platform can

This is the fishkeeping equivalent of a lofi hip-hop stream — except it's real
fish in real tanks belonging to people in your community.
