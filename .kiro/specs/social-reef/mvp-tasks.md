# The Reef — Minimal Viable Reef (MVP Ship Target)

## Progress

| Task | Status | Notes |
|---|---|---|
| Task 1: Supabase Setup & Auth Bridge | ✅ DONE | Project live, client wired, auth bridge in AuthContext |
| Task 2: MVP Database Schema | ✅ DONE | 7 tables, indexes, RLS, notification triggers |
| Task 3: Media Storage | ✅ DONE | Supabase Storage bucket `reef-media`, upload service |
| Task 4: Profile System | ✅ DONE | Unified profile — name set during onboarding, stored in Supabase, displayed in header + feed + profile page |
| Task 5: Tank Currents | ✅ DONE | ContentComposer, CurrentCard, photo grid, params |
| Task 6: Reactions & Comments | ✅ DONE | ReactionBar (6 emojis), CommentThread (1-level) |
| Task 7: Tankmate Connections | ✅ DONE | Watch tank button, request flow, TankmateRequests panel |
| Task 8: Feed | ✅ DONE | ReefFeed with Following/Discover tabs, infinite scroll |
| Task 9: Sonar Notifications | ✅ DONE | SonarBell, triggers firing, real-time subscription |
| Task 10: Navigation & Routing | ✅ DONE | Tab in App.jsx, profile navigation, back button |
| Task 11: Dexie Offline Cache | ✅ DONE | v10 schema with feedCache, draftContent tables |
| Task 12: Styling & Polish | ✅ DONE | Responsive CSS at 480/640/768px, touch targets, reduced motion, iOS zoom fix |

---

## Task 1: Supabase Project Setup & Auth Bridge

### 1.1 Provision Supabase project
- Create Supabase project (free tier is fine for MVP, upgrade later)
- Note project URL and anon key
- Add to frontend `.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` ✅
- Add service role key to Vercel env (for Edge Functions only, never exposed to client)

### 1.2 Privy → Supabase auth bridge
- Install `@supabase/supabase-js` in frontend
- Create `frontend/src/services/supabaseClient.js`:
  - Initialize Supabase client with anon key
  - On Privy wallet connect: call a Supabase Edge Function that mints a custom JWT with `wallet_address` claim
  - Use `supabase.auth.setSession()` with the returned JWT
  - Handle token refresh (re-mint on expiry)
- Create Supabase Edge Function `mint-jwt`:
  - Accepts wallet address (verified via Privy token signature)
  - Returns signed Supabase JWT with `wallet_address` in metadata
  - JWT secret = Supabase project JWT secret

### 1.3 Environment and dependency setup
- `npm install @supabase/supabase-js` in frontend
- Add Supabase types (optional but helpful): generate with `supabase gen types typescript`
- Verify connection: test a simple authenticated read from client

**Acceptance criteria:**
- [ ] Supabase project live with URL/keys in .env
- [ ] Privy login triggers Supabase JWT session
- [ ] Authenticated Supabase client can query with RLS passing

---

## Task 2: MVP Database Schema

### 2.1 Core tables migration

Run in Supabase SQL editor (or as migration file):

```sql
-- Profiles
CREATE TABLE profiles (
  wallet_address TEXT PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT CHECK (char_length(bio) <= 280),
  privacy_settings JSONB DEFAULT '{"tanks": "public", "activity": "public"}',
  tank_count INTEGER DEFAULT 0,
  species_count INTEGER DEFAULT 0,
  xp_total INTEGER DEFAULT 0,
  companion_tier TEXT DEFAULT 'Bronze',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tank Currents (posts)
CREATE TABLE currents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  title TEXT,
  body TEXT CHECK (char_length(body) <= 2000),
  media_urls JSONB DEFAULT '[]',
  linked_tank_id TEXT,
  linked_tank_name TEXT,
  species_tags JSONB DEFAULT '[]',
  parameters_snapshot JSONB,
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'tankmates', 'private')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reactions
CREATE TABLE reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES currents(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (emoji IN ('🔥', '🐟', '💧', '🌿', '👏', '⭐')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_wallet, target_id, emoji)
);

-- Comments (threaded)
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  current_id UUID NOT NULL REFERENCES currents(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) <= 1000),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Follows / Connections
CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  follow_type TEXT NOT NULL CHECK (follow_type IN ('tankmate', 'watch_tank')),
  target_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  target_tank_id TEXT,
  is_mutual BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_wallet, follow_type, target_wallet, target_tank_id)
);

-- Tankmate Requests
CREATE TABLE connection_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  to_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  message TEXT CHECK (char_length(message) <= 200),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_wallet, to_wallet)
);

-- Notifications
CREATE TABLE sonar_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_wallet TEXT REFERENCES profiles(wallet_address) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('activity', 'social', 'milestone')),
  title TEXT NOT NULL,
  body TEXT,
  icon TEXT,
  link_type TEXT,
  link_id TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.2 Indexes

```sql
CREATE INDEX idx_currents_author ON currents(author_wallet, created_at DESC);
CREATE INDEX idx_currents_visibility ON currents(visibility, created_at DESC);
CREATE INDEX idx_reactions_target ON reactions(target_id);
CREATE INDEX idx_comments_current ON comments(current_id, created_at);
CREATE INDEX idx_follows_follower ON follows(follower_wallet);
CREATE INDEX idx_follows_target ON follows(target_wallet);
CREATE INDEX idx_notifications_recipient ON sonar_notifications(recipient_wallet, is_read, created_at DESC);
CREATE INDEX idx_connection_requests_to ON connection_requests(to_wallet, status);
```

### 2.3 Row-Level Security

```sql
-- Profiles: public read, owner write
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read profiles" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE 
  USING (wallet_address = (auth.jwt()->>'wallet_address'));
CREATE POLICY "Users insert own profile" ON profiles FOR INSERT 
  WITH CHECK (wallet_address = (auth.jwt()->>'wallet_address'));

-- Currents: public readable (filtered by visibility in app), author manages own
ALTER TABLE currents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public currents readable" ON currents FOR SELECT 
  USING (visibility = 'public' OR author_wallet = (auth.jwt()->>'wallet_address'));
CREATE POLICY "Authors manage own currents" ON currents FOR INSERT 
  WITH CHECK (author_wallet = (auth.jwt()->>'wallet_address'));
CREATE POLICY "Authors update own currents" ON currents FOR UPDATE 
  USING (author_wallet = (auth.jwt()->>'wallet_address'));
CREATE POLICY "Authors delete own currents" ON currents FOR DELETE 
  USING (author_wallet = (auth.jwt()->>'wallet_address'));

-- Reactions: public read, user manages own
ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read reactions" ON reactions FOR SELECT USING (true);
CREATE POLICY "Users manage own reactions" ON reactions FOR INSERT 
  WITH CHECK (user_wallet = (auth.jwt()->>'wallet_address'));
CREATE POLICY "Users delete own reactions" ON reactions FOR DELETE 
  USING (user_wallet = (auth.jwt()->>'wallet_address'));

-- Comments: public read, author manages own
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read comments" ON comments FOR SELECT USING (true);
CREATE POLICY "Users post comments" ON comments FOR INSERT 
  WITH CHECK (author_wallet = (auth.jwt()->>'wallet_address'));
CREATE POLICY "Users delete own comments" ON comments FOR DELETE 
  USING (author_wallet = (auth.jwt()->>'wallet_address'));

-- Follows: public read, user manages own
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read follows" ON follows FOR SELECT USING (true);
CREATE POLICY "Users manage own follows" ON follows FOR INSERT 
  WITH CHECK (follower_wallet = (auth.jwt()->>'wallet_address'));
CREATE POLICY "Users remove own follows" ON follows FOR DELETE 
  USING (follower_wallet = (auth.jwt()->>'wallet_address'));

-- Connection requests: parties can read, sender manages
ALTER TABLE connection_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Parties can read requests" ON connection_requests FOR SELECT 
  USING (from_wallet = (auth.jwt()->>'wallet_address') OR to_wallet = (auth.jwt()->>'wallet_address'));
CREATE POLICY "Users send requests" ON connection_requests FOR INSERT 
  WITH CHECK (from_wallet = (auth.jwt()->>'wallet_address'));
CREATE POLICY "Recipients can update requests" ON connection_requests FOR UPDATE 
  USING (to_wallet = (auth.jwt()->>'wallet_address'));

-- Notifications: only recipient reads/updates
ALTER TABLE sonar_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own notifications" ON sonar_notifications FOR SELECT 
  USING (recipient_wallet = (auth.jwt()->>'wallet_address'));
CREATE POLICY "Users update own notifications" ON sonar_notifications FOR UPDATE 
  USING (recipient_wallet = (auth.jwt()->>'wallet_address'));
-- Inserts handled by Edge Functions (service role), not client
```

**Acceptance criteria:**
- [ ] All tables created with constraints
- [ ] Indexes applied
- [ ] RLS policies tested: user can only write own data, can read public data
- [ ] Supabase Studio shows tables populated after test inserts

---

## Task 3: Cloudflare R2 Media Upload

### 3.1 R2 bucket setup
- Create Cloudflare R2 bucket: `aquacellum-media`
- Enable public access via custom domain or R2 public URL
- Configure CORS: allow origin from aquacellum.com + localhost:5173

### 3.2 Presigned URL Edge Function
- Create Supabase Edge Function `generate-upload-url`:
  - Accepts: `{ filename, contentType }` (authenticated request)
  - Generates R2 presigned PUT URL (valid 5 minutes)
  - Returns: `{ uploadUrl, publicUrl }` where publicUrl is the final CDN path
  - File path structure: `uploads/{wallet_address}/{timestamp}-{filename}`

### 3.3 Client upload service
- Create `frontend/src/services/mediaUpload.js`:
  - `uploadImage(file)` → calls Edge Function for presigned URL → PUT file directly to R2 → returns publicUrl
  - Client-side resize before upload: max 2048px on longest edge (canvas API)
  - Progress tracking (XHR with onprogress)
  - Returns the public CDN URL to store in `currents.media_urls`

**Acceptance criteria:**
- [ ] Can upload an image from browser → appears at public R2 URL
- [ ] Images resized client-side before upload (< 2MB)
- [ ] Upload works authenticated only (presigned URL requires valid session)

---

## Task 4: Profile System

### 4.1 Auto-create profile on wallet connect
- In the Privy auth flow (after JWT mint): check if `profiles` row exists for wallet
- If not: insert new profile with wallet_address, pull tank_count/species_count/xp from Dexie
- If exists: continue (profile already seeded)

### 4.2 PublicProfile page component
- Route: accessible from feed cards, tankmate lists, etc.
- Layout:
  - Header: avatar (or gradient placeholder), display name (or truncated wallet), companion tier badge
  - Bio section
  - Stats row: XP total, tank count, species count
  - Privacy indicator (what's visible)
  - "Add Tankmate" / "Already Tankmates" / "Request Pending" button (contextual)
  - Tank Currents list (their public posts, paginated)

### 4.3 Profile edit (settings panel)
- Inline edit on own profile page (or settings modal):
  - Display name text input
  - Bio textarea (280 char counter)
  - Avatar: upload button → mediaUpload service → save URL to profile
  - Privacy toggles: tanks (public/tankmates/private), activity (public/tankmates/private)
- Save → Supabase update → optimistic UI

### 4.4 ProfileCard compact component
- Used everywhere: feed posts, comments, attendee lists
- Shows: avatar thumbnail (32px), display name, companion tier icon
- Click → navigates to PublicProfile
- Wallet fallback: if no display_name, show `0xAb...cD12`

**Acceptance criteria:**
- [ ] Profile auto-created on first login
- [ ] Can edit name, bio, avatar
- [ ] Public profile page displays all info
- [ ] Privacy settings respected (tankmates-only content hidden from non-tankmates)
- [ ] ProfileCard renders correctly in all contexts

---

## Task 5: Tank Currents (Content Creation & Display)

### 5.1 ContentComposer component
- Floating action button (bottom-right) or "New Post" in feed header
- Opens modal/drawer:
  - **Tank selector**: dropdown of user's tanks from Dexie (id + name)
  - **Caption**: textarea, 2000 char limit with counter
  - **Photos**: multi-image upload (max 4), drag-and-drop or file picker
    - Each image: preview thumbnail, remove button
    - Uses mediaUpload service
  - **Parameters snapshot** (optional): auto-pull latest pH, temp, nitrate from Dexie action logs for selected tank
  - **Species tags** (optional): multi-select from species in selected tank
  - **Visibility**: public / tankmates only / private (radio or dropdown)
  - **Post button**: disabled until at least caption OR photo provided
- Submit flow:
  1. Upload images to R2 (parallel)
  2. Insert `currents` row with media_urls, params, species_tags
  3. Close composer, prepend new post to feed (optimistic)

### 5.2 CurrentCard component
- Renders a single Tank Current in the feed:
  - Header: ProfileCard (author) + timestamp (relative: "2h ago")
  - Tank name badge (if linked)
  - Caption text (with "Show more" for > 300 chars)
  - Photo grid: 1 photo = full width, 2 = side by side, 3-4 = grid layout
  - Parameters chip row (if snapshot): 🌡️ 25.5°C | pH 7.2 | NO₃ 15ppm
  - Species tags as small badges
  - Footer: ReactionBar + comment count button + "Watch Tank" button
- Click on photo → lightbox/fullscreen view

### 5.3 Feed integration
- New Currents appear at top of Following feed (chronological)
- Infinite scroll pagination (20 items per page, cursor = last created_at)

**Acceptance criteria:**
- [ ] Can create a Tank Current with caption + photos + optional params
- [ ] Current appears in feed immediately after posting
- [ ] Photo grid renders correctly for 1-4 images
- [ ] Parameters and species tags display when present
- [ ] Visibility respected (private posts hidden from others)

---

## Task 6: Reactions & Comments

### 6.1 ReactionBar component
- Row of 6 emoji buttons: 🔥 🐟 💧 🌿 👏 ⭐
- Each shows count of unique users who reacted with that emoji
- Click to toggle your reaction (optimistic UI):
  - If not reacted: insert reaction row, increment count locally
  - If already reacted with same emoji: delete reaction row, decrement
- Highlighted state for emojis the current user has used
- Compact mode: only show emojis with count > 0

### 6.2 CommentThread component
- Expandable section below CurrentCard (click "💬 X comments" to open)
- Comment list: sorted by created_at ascending (oldest first, like a conversation)
- Each comment:
  - ProfileCard (author) + relative timestamp
  - Comment body text
  - "Reply" button → shows inline reply input (creates child comment with parent_comment_id)
- Threading: max 1 level deep (replies shown indented under parent, no deeper nesting)
- Comment input at bottom: textarea + "Post" button (1000 char limit)
- Load more: show first 5 comments, "View all X comments" button loads rest

### 6.3 Notification triggers
- When someone reacts to your Current → notify author
- When someone comments on your Current → notify author
- When someone replies to your comment → notify parent comment author

**Acceptance criteria:**
- [ ] Can react with any of 6 emojis, toggle on/off
- [ ] Reaction counts update in real-time (optimistic + server sync)
- [ ] Can post comments and replies (1 level threading)
- [ ] Notifications fire for reactions and comments on your content

---

## Task 7: Tankmate Connections & Following

### 7.1 Watch Tank
- "Watch" button on CurrentCards linked to a tank
- Click → creates `follows` row with type `watch_tank`, stores target_wallet + target_tank_id
- Watching a tank means: future Currents from that tank appear in your Following feed
- "Watching" state shown on button (toggle to unwatch)
- No notification to tank owner (low-friction, one-way)

### 7.2 Tankmate request flow
- "Add Tankmate" button on PublicProfile page
- Click → opens small modal: optional message (200 chars) + "Send Request" button
- Creates `connection_requests` row (status: pending)
- Recipient sees notification in Sonar: "0xAb...cD wants to be your Tankmate"
- Recipient can Accept or Decline:
  - Accept: creates mutual `follows` rows (type: tankmate, is_mutual: true for both), notifies sender
  - Decline: updates status, no notification to sender
- On profile: button shows contextual state:
  - "Add Tankmate" (no relationship)
  - "Request Pending" (you sent, awaiting response)
  - "Accept / Decline" (they sent to you)
  - "✓ Tankmates" (mutual)
  - "Remove Tankmate" (in settings/overflow menu)

### 7.3 Feed filtering based on connections
- Following feed shows:
  - All public Currents from your Tankmates
  - All Currents from tanks you Watch (regardless of author Tankmate status)
  - Currents with visibility "tankmates" from your mutual Tankmates
- Sorted chronologically (newest first)
- Empty state: "You're not following anyone yet. Find breeders to connect with!"

### 7.4 Tankmate list
- Section on own profile: "My Tankmates" → list of ProfileCards
- Click → navigate to their profile
- Count shown on profile stats row

**Acceptance criteria:**
- [ ] Can watch a tank (one-way, no approval needed)
- [ ] Can send/accept/decline Tankmate requests
- [ ] Mutual Tankmate status visible on profiles
- [ ] Following feed populated from watched tanks + Tankmates
- [ ] Tankmates-only content visible to mutual connections

---

## Task 8: Feed (The Reef Feed)

### 8.1 ReefFeed main component
- Top-level social view (new route/tab in app)
- Two sub-tabs: **Following** (default) | **Discover**
- Following: chronological Currents from your connections (Task 7.3 logic)
- Discover: all public Currents from all users, newest first (simple global feed for discovery)
- Both use infinite scroll (TanStack Query `useInfiniteQuery` with cursor pagination)

### 8.2 Feed data fetching
- Create `frontend/src/hooks/useReefFeed.js`:
  - `useFollowingFeed()`: query Supabase for Currents where author is in your follows list, ordered by created_at DESC, paginated
  - `useDiscoverFeed()`: query all public Currents ordered by created_at DESC, paginated
  - Include reaction counts and comment counts as aggregated subqueries (or separate lightweight queries)
  - Cache first page in Dexie `feedCache` for offline/instant load

### 8.3 Feed UX
- Pull-to-refresh (mobile) / refresh button (desktop)
- Loading skeletons (3 placeholder cards while fetching)
- New post indicator: "X new posts" banner at top when new content arrives (poll every 30s or Supabase Realtime subscription on `currents` table inserts)
- Scroll position preservation on back-navigation

### 8.4 Empty states
- Following (no connections): "Your feed is empty. Find breeders to follow!" + link to Discover
- Discover (no content): "No one has posted yet. Be the first!" + prompt to create

**Acceptance criteria:**
- [ ] Following feed shows content from Tankmates + watched tanks
- [ ] Discover feed shows all public content
- [ ] Infinite scroll works with no janky behavior
- [ ] New post indicator appears for fresh content
- [ ] Empty states guide users to next action
- [ ] First page cached for instant re-open

---

## Task 9: Sonar Notifications (Basic)

### 9.1 Notification dispatch (server-side)
- Create Supabase Edge Function `dispatch-notification`:
  - Accepts: `{ recipient_wallet, category, title, body, icon, link_type, link_id }`
  - Inserts into `sonar_notifications`
  - Called by other Edge Functions or database triggers

- Create database triggers (Postgres functions) for auto-dispatch:
  - On `reactions` INSERT → notify Current author: "🔥 {reactor} reacted to your post"
  - On `comments` INSERT → notify Current author: "💬 {commenter} commented on your post"
  - On `comments` INSERT with parent_comment_id → also notify parent comment author: "↩️ {replier} replied to your comment"
  - On `connection_requests` INSERT → notify target: "🤝 {sender} wants to be your Tankmate"
  - On `connection_requests` UPDATE (accepted) → notify sender: "✓ {accepter} accepted your Tankmate request!"
  - On `follows` INSERT (watch_tank) → optionally notify tank owner: "👁️ Someone is watching your tank" (debounced, max 1/hour)

### 9.2 SonarBell component
- In app header: bell icon 🔔 with unread count badge (red dot + number)
- Unread count: query `sonar_notifications` WHERE is_read = false, count
- Real-time update: Supabase Realtime subscription on `sonar_notifications` inserts for current user
- Click → opens SonarCenter dropdown/panel

### 9.3 SonarCenter component
- Dropdown (desktop) or full-page (mobile) notification list
- Each notification: icon + title + body + relative timestamp + read/unread indicator
- Click notification → mark as read + navigate to linked content (link_type + link_id → route)
- "Mark all as read" button
- Grouped by day (Today, Yesterday, This Week)
- Load more pagination (20 per page)

### 9.4 Mark as read logic
- Individual: on click → update `is_read = true`
- Bulk: "Mark all read" → update all unread for user
- Auto-mark: when SonarCenter is opened, mark visible notifications as read after 3 seconds

**Acceptance criteria:**
- [ ] Notifications fire for: reactions, comments, replies, tankmate requests, request accepted
- [ ] Bell icon shows correct unread count
- [ ] Real-time: new notification increments count without page refresh
- [ ] Click notification navigates to relevant content
- [ ] Mark as read works (individual + bulk)

---

## Task 10: Navigation & Routing Integration

### 10.1 Add Reef to main app navigation
- New nav item in sidebar/header: "The Reef" (🪸 icon or wave icon)
- Routes:
  - `/reef` → ReefFeed (default Following tab)
  - `/reef/discover` → Discover tab
  - `/reef/profile/{wallet}` → PublicProfile
  - `/reef/notifications` → SonarCenter (full page, mobile fallback)
- Integrate with existing app layout (glassmorphic styling, dual-mode aware)

### 10.2 Entry points from existing features
- On TankList: "Share as Current" button on each tank → opens ContentComposer pre-filled with that tank
- On tank detail social tab: link to "View on The Reef" for public-facing version
- On breeder companion panel: link to "View My Reef Profile"

### 10.3 Dual-mode labels
- Casual mode: "The Reef", "Tankmates", "Currents", "Sonar"
- Pro mode: "Social Feed", "Connections", "Posts", "Notifications"

**Acceptance criteria:**
- [ ] Reef accessible from main navigation
- [ ] All routes work with browser back/forward
- [ ] Entry points from existing tank features work
- [ ] Labels switch correctly between casual/pro modes

---

## Task 11: Dexie Offline Cache & Sync

### 11.1 Schema migration to v10
- Add new Dexie tables:
  ```
  feedCache: '++id, contentId, authorWallet, createdAt'
  socialNotifications: '++id, category, isRead, createdAt'
  draftContent: '++id, type, status, createdAt'
  ```
- Backward-compatible migration (no data loss from v9 tables)

### 11.2 Offline feed reading
- On successful feed fetch: store first 30 items in `feedCache`
- On app open (before network): display cached feed immediately
- Stale indicator on items: "Cached • Updated 5m ago"
- When online: refresh and replace cache

### 11.3 Offline content creation
- If network unavailable when user submits a Current:
  - Save to `draftContent` with status 'queued'
  - Show in feed with "Pending upload..." indicator
  - On reconnect: auto-retry upload (images first, then post)
  - On success: update status to 'published', remove pending indicator

**Acceptance criteria:**
- [ ] Feed loads from cache instantly on repeat visits
- [ ] Content creation works offline (queued and synced later)
- [ ] No data loss during v9 → v10 migration
- [ ] Cached content clearly marked as potentially stale

---

## Task 12: Styling & Polish

### 12.1 Component styling (glassmorphic, matching existing app)
- All Reef components use existing CSS variables (--glass-bg, --glass-border, --accent-blue, etc.)
- CurrentCard: frosted glass card with subtle border, rounded corners
- ProfileCard: compact, fits inline in feed headers and comments
- ReactionBar: pill-shaped buttons with hover glow
- CommentThread: indented replies with connecting line
- SonarCenter: dark overlay dropdown with notification rows
- ContentComposer: modal with frosted backdrop

### 12.2 Responsive design
- Feed: single column on mobile (< 768px), comfortable width on desktop (max-width 640px, centered)
- Photo grids: stack vertically on mobile for 3-4 images
- Composer: full-screen modal on mobile, centered modal on desktop
- Profile: stack avatar above info on mobile, side-by-side on desktop

### 12.3 Loading & error states
- Skeleton loaders for feed cards (pulse animation)
- Error boundary with retry button on feed fetch failures
- Toast notifications for actions: "Current posted!", "Tankmate request sent!"
- Empty states with illustration/emoji and clear CTA

**Acceptance criteria:**
- [ ] Visual consistency with existing app aesthetic
- [ ] Usable on mobile (375px+) and desktop
- [ ] All loading states covered (no blank flashes)
- [ ] Error handling graceful with retry options

---

## Implementation Order (Recommended)

```
Week 1:  Tasks 1 + 2 (infrastructure — Supabase, schema, auth bridge)
Week 2:  Tasks 3 + 4 (media upload + profiles)
Week 3:  Tasks 5 + 6 (content creation + reactions/comments)
Week 4:  Tasks 7 + 8 (connections + feed)
Week 5:  Tasks 9 + 10 (notifications + routing)
Week 6:  Tasks 11 + 12 (offline cache + polish)
```

**Total: ~6 weeks to shippable MVP**

---

## Success Metrics (Post-Ship)

- Users can create a profile and post Tank Currents with photos
- Feed populates with content from Tankmates and watched tanks
- Users can react and comment on each other's content
- Notifications fire and display for all social actions
- Works offline for reading, queues writes for later sync
- Visual quality matches existing app (glassmorphic, responsive)
- No dead ends (every empty state points to next action)

---

## What Comes Next (After MVP Ships)

Once this is live and users are engaging:
1. **Species Insights** — micro-tips on species pages (quick win, reuses comment infrastructure)
2. **Expert Audits** — structured reviews (builds on profiles + notifications)
3. **Schools** — clubs (builds on feed + profiles + connections)
4. **Tides** — events (builds on everything above + on-chain LiveEvent)
5. **Poseidon AI** — intelligence layer across all features
6. **Depth Score** — reputation system
