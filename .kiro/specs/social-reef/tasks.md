# The Reef — Implementation Tasks (Phased)

---

## Phase 1: Foundation & Identity (MVP Core)
*Goal: Get the social backbone running — profiles, basic content, connections, and feed.*
*Estimated: 4-6 weeks*

### Infrastructure Setup

- [x] 1. Provision Supabase project
  - Create project on Supabase (Pro plan)
  - Configure custom JWT auth bridge for Privy wallet integration
  - Set up environment variables in Vercel and local .env

- [x] 2. Create core database schema
  - Run migration: `profiles`, `currents`, `reactions`, `comments`, `follows`, `connection_requests` tables
  - Enable RLS on all tables with wallet-based policies
  - Create indexes: `currents(author_wallet, created_at)`, `follows(follower_wallet)`, `reactions(target_id)`

- [x] 3. Set up media storage (Supabase Storage MVP — R2 upgrade later)
  - Create Supabase Storage bucket `reef-media` with public access
  - Configure CORS for direct browser uploads
  - Client-side image resizing (max 2048px, WebP preferred)
  - Upload via Supabase Storage SDK (presigned R2 URLs planned for Phase 5)

- [x] 4. Extend Dexie.js schema to v10
  - Add tables: `feedCache`, `socialNotifications`, `draftContent`
  - Write migration from v9 → v10 with backward compatibility
  - Add sync utilities for offline → online content queuing

- [x] 5. Create Supabase client with Privy auth bridge
  - Implement `supabaseClient.js` service with JWT minting from Privy wallet
  - Handle token refresh and session persistence
  - Test RLS policies with authenticated requests

### Identity & Profiles

- [x] 6. Build `profiles` table seeding on first wallet connection
  - Profile created during onboarding with user-chosen display name
  - Pull existing XP/level/companion data from Dexie to populate initial profile
  - Store wallet_address as primary key
  - Unified single profile (Supabase = source of truth, displayed in header + feed + profile)

- [x] 7. Implement PublicProfile page component
  - Display: name, avatar, bio, companion tier badge, XP, tank count, species count
  - Tankmates list section
  - User's Currents feed with post count
  - Back navigation to feed
  - Privacy-aware: respect visibility settings

- [x] 8. Implement ProfileCard compact component
  - Mini card used in feeds, comments, attendee lists
  - Shows: avatar (gradient fallback), name, companion tier icon
  - Click → navigates to full PublicProfile

- [x] 9. Build profile edit functionality
  - Edit: display name, bio (280 char limit), avatar upload
  - Inline edit form on own profile page (ProfileEdit component)
  - Name chosen during onboarding, editable anytime after

- [x] 10. Implement BadgeShelf component
  - 17 badge definitions with unlock criteria based on stats (tanks, species, tier, XP, posts, insights, tankmates)
  - Visual badge row on profile (unlocked = full opacity, locked = dimmed with 🔒)
  - Shows on own profile with locked badges visible, others only see unlocked
  - Tooltips show badge name + description
  - Responsive wrap layout

### Content System — Currents

- [x] 11. Build ContentComposer component
  - Tank Current mode: select tank from Dexie, auto-populate params, add caption + photos
  - Photo upload (max 4 images, client-side resize)
  - Visibility selector (public / tankmates / private)
  - "Share on Reef" entry point from tank detail social tab
  - Submit → Supabase insert + Storage media upload

- [x] 12. Build CurrentCard component
  - Renders Tank Currents: photo grid (1-4 images), species tags, parameter chips, caption
  - Author ProfileCard header + relative timestamp
  - ReactionBar + comment count + "Watch this tank" button
  - Tank name badge link

- [x] 13. Build ReactionBar component
  - Emoji options: 🔥 🐟 💧 🌿 👏 ⭐
  - Optimistic UI: instant local toggle, background Supabase sync
  - Display reaction counts grouped by emoji
  - Prevent duplicate reactions (same emoji, same user, same target)

- [x] 14. Build CommentThread component
  - Threaded comment display (1 level deep — replies indented under parent)
  - Comment input with 1000-char limit
  - Author ProfileCard on each comment
  - Inline reply button + input
  - Expandable (click to show/hide comments)

- [x] 15. Implement Species Insights system
  - SpeciesInsights component with category selector, 280-char composer, upvote/downvote
  - InsightCard with vote column, category badge, author ProfileCard, timestamp
  - Integrated as "💡 Tips" / "Insights" tab in species detail view (BreedGallery)
  - `species_insights` Supabase table with RLS
  - Insights ranked by net votes (upvotes - downvotes), most helpful first

### Social Graph — Tankmates

- [x] 16. Implement follow/connection system
  - "Watch this Tank" button on Tank Currents → creates `watch_tank` follow
  - "Add Tankmate" button on profiles → sends connection_request
  - Accept/decline flow for Tankmate requests (TankmateRequests panel)
  - Mutual detection: creates bidirectional follow rows on accept

- [ ] 17. Build discovery features
  - "Nearby Breeders" list using existing zoneHash grouping
  - "Breeders Who Keep [Species]" query on profiles + Dexie tank data
  - "Top Contributors This Week" leaderboard (Insights posted, Audits given)

### Feed

- [x] 18. Build ReefFeed main component
  - Tab navigation: Following / Discover (Regional planned for later)
  - Infinite scroll with cursor-based pagination (TanStack Query)
  - Loading skeletons while fetching
  - Empty states with prompts and CTAs
  - Profile navigation (click any user → full profile)
  - "My Profile" button in feed header

- [x] 19. Implement feed queries (chronological for MVP, ranking Edge Function planned)
  - Following feed: Currents from Tankmates + watched tanks, chronological
  - Discover feed: all public Currents, newest first
  - Cursor-based pagination (20 items per page)
  - Feed ranking algorithm deferred to Phase 4 (Poseidon integration)

- [x] 20. Integrate feed caching in Dexie
  - Dexie v10 `feedCache` table created
  - Schema ready for offline reading (store/retrieve implementation deferred to polish phase)

---

## Phase 2: Schools & Expert Audits
*Goal: Community organization and formalized mentorship.*
*Estimated: 3-4 weeks*

### Schools (Clubs)

- [x] 21. Create Schools database tables
  - Run migration: `schools`, `school_members`, `school_challenges`, `school_chat`
  - RLS: school chat/feed only accessible to members
  - Indexes: `school_members(wallet_address)`, `schools(school_type, slug)`

- [x] 22. Build CreateSchool wizard
  - Step 1: Name + slug (auto-generated, editable) + type selector
  - Step 2: Description + banner upload + tracked species (multi-select from catalog)
  - Step 3: Settings — member cap, invite-only toggle
  - Creates school + auto-adds creator as Founder role

- [x] 23. Build SchoolDirectory component
  - Browse all schools: grid of cards with banner, name, type badge, member count
  - Filter by type, search by name
  - "My Schools" section at top
  - Join button (instant for open schools, request for invite-only)

- [x] 24. Build SchoolPage component
  - Header: banner, name, description, type, member count, tracked species
  - Tabs: Feed / Members / Challenges / Chat / Settings (Founder/Elder only)
  - SchoolFeed: aggregated Currents from members tagged to school or tracked species
  - Member list with role badges
  - Settings: edit school info, manage roles, kick members (Founder/Elder)

- [x] 25. Build SchoolChat component
  - Persistent real-time chat (Supabase Realtime subscription on `school:{school_id}`)
  - 500-char message limit
  - Sender ProfileCard inline
  - Scroll-to-bottom, unread indicator
  - Elder/Founder moderation (delete messages, mute users)

- [x] 26. Build ChallengeCard and challenge system
  - Create Challenge form (Elders/Founders): type, title, target species, time window, reward XP
  - Active challenge display: progress bar, time remaining, leaderboard
  - Auto-track progress: query spawn records / action logs for participants
  - Auto-complete: distribute XP rewards at end_time via Edge Function cron

### Expert Audits

- [x] 27. Build Expert Audit request flow
  - "Request Audit" button on Tank Currents (visible to Tankmates and in Schools)
  - Request sent as notification to target auditor or posted publicly for any Master+ to claim
  - Request queue visible in auditor's Sonar center

- [x] 28. Build Expert Audit creation form
  - Scorecard: 4 sliders (Water Quality, Stocking, Husbandry, Aesthetics) — 1 to 5 stars each
  - Free-text commentary (unlimited)
  - Photos: optional annotated screenshots
  - Submit → creates `expert_audits` row + triggers XP award for both parties

- [x] 29. Build ExpertAuditCard display component
  - Gold-bordered card (existing gold glow styling)
  - Scorecard visualization: 4 radial or bar indicators
  - Auditor ProfileCard with "⭐ Verified Master Breeder" badge
  - Commentary section
  - Displays on recipient's Tank Current and their profile

- [x] 30. Wire Audit XP to existing useXPSync
  - On audit creation: trigger +25 Prestige XP for auditor, +50 for recipient
  - Use existing `window.triggerXpTracking` bridge
  - Audit completion triggers companion progression check

### Mentorship

- [x] 31. Implement Mentor/Mentee pairing
  - Master+ tier profiles show "Accepting Mentees" toggle
  - Mentee request flow: send request with message → mentor accepts/declines
  - Active pairings visible on both profiles
  - XP multiplier: interactions between mentor/mentee pair earn 1.5× XP

---

## Phase 3: Tides (Events) & Notifications
*Goal: Live events with real-time social interaction and push notifications.*
*Estimated: 4-5 weeks*

### Tides Infrastructure

- [x] 32. Create Tides database tables
  - Run migration: `tides`, `tide_attendees`, `tide_chat`, `auction_bids`
  - RLS: tide_chat readable by attendees, auction_bids by participants
  - Indexes: `tides(status, start_time)`, `tide_attendees(wallet_address)`

- [x] 33. Build Tide creation flow
  - Council members or School Elders can create Tides
  - Form: type selector, title, description, time window, GPS bounds (for Expo), banner upload
  - Expo Tides: auto-create on-chain `LiveEvent` via `setLiveEvent()` contract call
  - Virtual Tides: stream URL input (Mux/CF Stream integration)
  - Challenge Tides: configure rules, target species, scoring method
  - Auction Tides: select specimens (from seller's tokens), set reserve prices, auction duration

- [x] 34. Build TideCalendar component
  - Grid/list view of upcoming Tides sorted by start_time
  - Filter by type, region, School
  - RSVP button (going/interested)
  - Countdown timers on imminent Tides
  - "My Upcoming Tides" section

- [x] 35. Build TidePage component
  - Pre-event view: details, RSVP count, attendee list, "I'm bringing..." swap sheet, countdown
  - Live view: switches to TideLiveFeed when status = 'live'
  - Post-event view: TideRecap with Poseidon-generated summary

### Live Event Experience

- [x] 36. Build TideLiveFeed component
  - Real-time feed via Supabase Realtime channel `tide:{tide_id}`
  - Renders: trade ticker (from on-chain events), check-in notifications, photo posts, Poseidon narration
  - Auto-scroll with "New activity" floating button when paused
  - Activity burst indicator (animated pulse when high activity)

- [x] 37. Build TideChat component
  - Ephemeral real-time chat (auto-deletes 48h after event ends via Supabase cron)
  - Poseidon system messages (narration, announcements) styled distinctly
  - 300-char limit, rate-limited to 1 msg/5 seconds per user
  - Moderation: curator can mute users in-event

- [x] 38. Build TideMap component (Expo Tides)
  - Mapbox GL JS integration
  - Fuzzed attendee pins (using zoneHash, not exact GPS)
  - GPS bounds overlay showing active Tide zone
  - "Check In" button when user is within zone bounds (browser Geolocation API)
  - Check-in awards +100 XP burst

- [x] 39. Build SwapSheet component
  - Pre-event "I'm bringing..." board
  - Attendees list species they plan to bring (searchable, linked to catalog)
  - Other attendees can "flag interest" on species
  - Becomes read-only once Tide goes live

- [x] 40. Build AuctionPanel component (Auction Tides)
  - Real-time bidding via Supabase Realtime channel `auction:{tide_id}:{token_id}`
  - Current high bid display + countdown timer
  - Bid input with minimum increment enforcement
  - Bid history list
  - On auction end: winner notification, escrow settlement trigger (on-chain)
  - Outbid notifications via Sonar

- [x] 41. Implement Tide lifecycle management (Edge Function cron)
  - Cron job checks every minute: transition Tides from 'upcoming' → 'live' → 'ended' based on time
  - On 'live': open Realtime channels, enable chat, start XP tracking
  - On 'ended': close chat writes, trigger Poseidon recap generation, distribute attendance XP
  - 48h post-end: purge tide_chat messages

### Notifications — Sonar

- [x] 42. Create Sonar notification infrastructure
  - `sonar_notifications` table created with RLS
  - Postgres trigger functions auto-dispatch notifications on reactions, comments, requests
  - Supabase Realtime subscription for live count updates
  - Web Push API integration deferred (planned for later)

- [x] 43. Build SonarCenter component (partial — dropdown mode)
  - Notification list in dropdown panel (SonarBell dropdown)
  - Mark as read (individual + mark all)
  - Click → navigate to linked content
  - Empty state with helpful prompt
  - Full-page hub deferred

- [x] 44. Build SonarBell component
  - Header icon with unread count badge
  - Dropdown preview (last 10 notifications)
  - Real-time count update via Supabase Realtime on `sonar_notifications` insert

- [x] 45. Build SonarPreferences component
  - Per-category toggle: Activity / Social / Events / Milestones / Poseidon
  - Web Push opt-in/out per category
  - Quiet hours setting (start/end time)
  - Email digest frequency: off / daily / weekly

- [x] 46. Wire notification triggers across all social actions (MVP subset)
  - New Tankmate request → notify target ✅
  - Reaction on your content → notify author ✅
  - Comment on your content → notify author ✅
  - Reply to your comment → notify parent author ✅
  - Tankmate request accepted → notify sender ✅
  - Expert Audit received → notify recipient (Phase 2)
  - Tide starting in 1h → notify RSVPs (Phase 3)
  - Auction outbid → notify previous high bidder (Phase 3)
  - Badge unlocked → notify user (Phase 4)
  - Poseidon weekly digest → notify all active users (Phase 4)

---

## Phase 4: Poseidon AI Integration & Depth Score
*Goal: AI-powered intelligence layer and full reputation system.*
*Estimated: 3-4 weeks*

### Poseidon Social Features

- [x] 47. Build Poseidon Edge Function gateway
  - Central Edge Function routing Poseidon requests to Gemini API
  - Context assembly: pulls relevant user data, social data, species data per request
  - Rate limiting: 20 requests/user/hour for interactive queries
  - Response caching for common queries (species care advice, etc.)

- [x] 48. Implement weekly Reef Digest generation
  - Cron (Sunday 9am UTC): for each active user, generate personalized digest
  - Content: highlights from Tankmates, trending Insights for their species, upcoming Tides in their region
  - Store as `sonar_notifications` with category 'poseidon'
  - PoseidonDigest component renders as a rich card in feed

- [x] 49. Implement Breeder Summary auto-generation
  - Cron (weekly): for each profile with activity, generate 2-sentence summary
  - Inputs: recent species focus, spawn count, audit activity, school participation
  - Store in `profiles.poseidon_summary`
  - Displayed on PublicProfile page

- [x] 50. Implement Spawn Thread narration
  - Trigger: on spawn stage transition (Egg → Fry → Raised)
  - Poseidon generates a narration line: "Day 14: 38 fry stable. Survival tracking above species average."
  - Stored in `currents.poseidon_narration`
  - Displayed inline on SpawnThreadCard

- [x] 51. Implement Tide narration and recaps
  - During live Tides: Poseidon posts system messages every 15 min summarizing activity
  - Post-event: generate structured recap (total attendees, trades, top species, XP awarded)
  - Recap stored in `tides.recap_content` as JSON
  - TideRecap component renders the structured recap

- [x] 52. Implement content moderation pipeline
  - On new content insert (Supabase webhook → Edge Function):
    - Image: send to Gemini Vision for appropriateness classification
    - Text: classify for spam/toxicity
  - If flagged: auto-hide content, create `moderation_flags` entry, notify curator
  - If clean: no action (content already visible)

- [x] 53. Implement Poseidon mentor matching
  - User requests mentor → Poseidon analyzes:
    - User's species, parameters, struggles (from Dexie data)
    - Available mentors' expertise (species mastered, audit history, Depth Score)
  - Returns top 3 suggested mentors with explanation
  - "Suggested Tankmates" also uses similar logic for general discovery

- [x] 54. Implement "Ask Poseidon" in social context
  - usePoseidon hook: send natural language query with context (current page, selected species, etc.)
  - Poseidon can answer: "What species go well with my tank?", "Summarize this breeder's expertise", "Draft an Insight about my Corydoras experience"
  - Response rendered in a collapsible Poseidon card within the UI

- [x] 55. Implement image alt-text generation
  - On media upload: async Edge Function sends image to Gemini Vision
  - Returns descriptive alt text: "A planted 75-gallon aquarium with a school of neon tetras and a pair of angelfish under driftwood"
  - Stored with media URL, used in `<img alt="...">` for accessibility
  - User can edit the generated alt text

### Depth Score System

- [x] 56. Implement Depth Score calculation Edge Function
  - Triggered by: audit completion, insight upvote, spawn success, trade review, moderation flag
  - Calculates delta based on signal weights (see requirements doc)
  - Inserts into `depth_score_events` table
  - Updates `profiles.depth_score` and `profiles.depth_tier`
  - Tier thresholds: Shallow (0-99), Coastal (100-499), Pelagic (500-1499), Abyssal (1500-4999), Hadal (5000+)

- [x] 57. Build DepthScoreMeter component
  - Visual progress indicator showing current score within tier
  - Tier badge with icon and label
  - Tooltip: "What is Depth Score?" explanation
  - Click → detailed breakdown of recent score events

- [x] 58. Wire Depth Score privileges
  - Coastal: can post Species Insights, join Schools
  - Pelagic: can create Schools, request Audits
  - Abyssal: can host Virtual Tides, give Audits, mentor
  - Hadal: can host Expo Tides, moderate School content, featured in discovery
  - Gate UI actions based on tier (show upgrade prompts for locked features)

- [x] 59. Implement anti-gaming detection
  - Poseidon flags: mutual upvote rings (A always upvotes B and vice versa)
  - Sudden score spikes from single source
  - Accounts with high activity but zero engagement from others
  - Flagged accounts added to curator review queue

---

## Phase 5: Search, Polish & Advanced Features
*Goal: Full-text search, Virtual Tides, and production hardening.*
*Estimated: 3-4 weeks*

### Search

- [ ] 60. Deploy Typesense search cluster
  - Create collections: `insights`, `profiles`, `schools`, `tides`
  - Configure Supabase webhook → Typesense sync (on insert/update/delete)
  - Schema: searchable fields, facets (species, type, region), sort by relevance/recency

- [ ] 61. Build search UI
  - Global search bar in header (keyboard shortcut: /)
  - Results grouped by type: Insights, Profiles, Schools, Tides
  - Filters: species, location, Depth tier, content type, date range
  - Instant results as-you-type (debounced 200ms)

- [x] 62. Implement Poseidon natural language search
  - Parse queries like "Who breeds Apistogramma near Portland?"
  - Convert to structured Typesense query + geo filter
  - Display Poseidon-enhanced results with explanation

### Virtual Tides (Livestream)

- [ ] 63. Integrate Cloudflare Stream or Mux for video
  - Stream creation API for Virtual Tide hosts
  - Embed player in TidePage (HLS adaptive bitrate)
  - Stream key management (host dashboard)
  - Viewer count + chat sync

- [ ] 64. Implement Poseidon auto-transcription for Virtual Tides
  - Post-stream: send audio to transcription API (Gemini or Whisper)
  - Poseidon summarizes transcript → generates searchable Species Insights
  - Summary stored in `tides.recap_content`
  - Key moments timestamped and linkable

### Production Hardening

- [ ] 65. Implement rate limiting across all social endpoints
  - Content creation: 10 posts/hour, 50 comments/hour, 100 reactions/hour
  - Audit requests: 3/day
  - School creation: 1/day
  - Poseidon queries: 20/hour
  - Return 429 with retry-after header

- [ ] 66. Implement full moderation admin panel
  - Curator-accessible view of flagged content queue
  - Actions: dismiss flag, hide content, warn user, mute (24h/7d), ban
  - Escalation history per user
  - Poseidon-generated case summary for each flagged item

- [ ] 67. Implement GDPR data export and deletion
  - Profile Settings → "Export My Data" (generates JSON of all social content)
  - "Delete My Account" → soft-delete with 30-day grace period
  - On permanent delete: anonymize comments/reactions, delete profile/media/notifications

- [ ] 68. Performance optimization pass
  - Feed: implement Redis/Supabase edge caching for hot feeds (top 100 users)
  - Images: verify all served as WebP with proper Cache-Control headers
  - Realtime: connection pooling, graceful reconnect on network changes
  - Bundle: code-split social components (lazy load on route)

- [ ] 69. Accessibility audit
  - Screen reader testing on all social components (feed, chat, notifications)
  - Keyboard navigation for reactions, comments, search
  - Focus management on modals/composers
  - Poseidon alt-text coverage on all user-uploaded images
  - Color contrast verification on all badges/tiers

- [ ] 70. Integration testing and launch prep
  - End-to-end tests: profile creation → post Current → receive reaction → get notification
  - Load testing: simulate 1000 concurrent Tide attendees
  - Realtime stress test: 100 messages/second in Tide chat
  - Auction settlement: verify on-chain escrow flow end-to-end
  - Mobile responsiveness audit on all social views
  - Deploy to staging environment for team testing

---

## Dependencies & Prerequisites

| Phase | Depends On |
|---|---|
| Phase 1 | Supabase project, Cloudflare R2 bucket, Privy auth (existing) |
| Phase 2 | Phase 1 complete (profiles, content, feed working) |
| Phase 3 | Phase 1 + 2 complete, Mapbox API key, Web Push VAPID keys |
| Phase 4 | Phase 1-3 complete, Gemini API quota increase for Poseidon social |
| Phase 5 | Phase 1-4 complete, Typesense Cloud instance, CF Stream/Mux account |

---

## Key Technical Decisions

1. **Supabase over custom backend**: Realtime + Postgres + Edge Functions + Auth in one platform. Avoids building WebSocket infrastructure from scratch.
2. **Cloudflare R2 over Supabase Storage**: Zero egress fees (important for image-heavy social feed), global CDN, image transformation workers.
3. **Typesense over Postgres full-text**: Sub-50ms typo-tolerant search with facets. Postgres FTS is too slow for real-time as-you-type.
4. **Depth Score separate from XP**: XP measures volume (how much you do), Depth measures quality/trust (how well you do it). Different incentives.
5. **Ephemeral Tide chat**: Keeps storage costs down, maintains event energy ("you had to be there"), reduces moderation burden.
6. **Poseidon as Edge Functions (not client-side)**: Keeps API keys server-side, enables caching, allows rate limiting, and lets Poseidon access full backend context.
