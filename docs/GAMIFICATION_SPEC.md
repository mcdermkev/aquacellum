# Aquacellum Unified Gamification Spec

> Single source of truth for XP, Loyalty Points, tiers, leaderboards, and rewards across both the Hobbyist and Breeder personas.

---

## 1. Core Principle: One Pool, Two Lenses

There is **one universal point balance per user** stored as `totalXp`. The two personas are cosmetic lenses applied to the same underlying number:

| Mode | Display Name | Currency Label | UI Tone |
|------|-------------|----------------|---------|
| Casual Hobbyist | "Loyalty Points" | "pts" | Warm, care-oriented, gamified |
| Pro Breeder | "Reputation XP" | "XP" | Operational, clinical, de-gamified |

**A user who switches modes does not lose or reset anything.** Their point balance, tier, companion state, and zone position all persist. Only the language and visual treatment changes.

### Why unified?

- Users who start as hobbyists and grow into breeders shouldn't lose progress.
- The regional zone leaderboard is one board per zone — mixing both personas creates authentic local competition.
- The Loyalty Rewards Pool (40% of protocol fees) distributes proportionally by points earned, so splitting the pools would halve everyone's effective share.

---

## 2. Earning Points

### 2.1 Care & Husbandry Actions (available to all users)

| Action | Points | Cooldown | Notes |
|--------|--------|----------|-------|
| Daily feeding log | +5 | 1 per day per tank | Streak bonus after 7 consecutive days |
| Water change logged | +10 | 1 per 48h per tank | |
| Water parameters tested | +8 | 1 per 48h per tank | Must include pH + temp minimum |
| Photo observation shared | +12 | 3 per day | Must tag a tank or species |
| Tank registered | +25 | No cooldown | One-time per tank |
| Species added to collection | +15 | No cooldown | One-time per species instance |

### 2.2 Marketplace Actions

| Action | Points | Notes |
|--------|--------|-------|
| Verified local pickup (buyer) | +25 | Handshake confirmed |
| Verified local pickup (seller) | +25 | Handshake confirmed |
| Listed specimen for sale | +30 | Active listing only |
| Completed online sale (seller) | +40 | Shipping confirmed |
| Purchased specimen (buyer) | +20 | Payment confirmed |

### 2.3 Breeding & Operational Actions (primarily breeder-relevant)

| Action | Points | Notes |
|--------|--------|-------|
| Minted birth certificate | +50 | On-chain registration |
| Successful spawn event | +150 | Logged with parent IDs |
| Batch shipping dispatched | +35 | 3+ specimens in one dispatch |
| Pedigree audit completed (as auditor) | +60 | Expert verification |
| Pedigree audit received (as requester) | +20 | Encourages seeking audits |

### 2.4 Community & Social Actions

| Action | Points | Notes |
|--------|--------|-------|
| Posted Tank Current (Reef) | +10 | 2 per day max |
| Published Species Insight | +20 | Long-form knowledge share |
| Received 5+ reactions on a post | +8 | Engagement quality signal |
| Joined a School | +15 | One-time per School |
| Completed a School Challenge | +varies | Set per challenge (50–300) |
| Won a School Challenge (top 3) | +bonus | 1st: +100, 2nd: +60, 3rd: +30 |
| Mentored another user | +40 | Abyssal/Hadal tier required |

### 2.5 Event Multipliers

| Condition | Multiplier |
|-----------|-----------|
| Inside active Expo event zone (GPS-verified) | 2x all points |
| Care streak (7+ consecutive days) | 1.5x care actions |
| First action of the day | +5 bonus (daily login reward) |

---

## 3. Tier Progression

### 3.1 The Canonical Tier Ladder

One ladder for all users. Labels change per mode.

| Tier | Points Required | Hobbyist Label | Breeder Label | Companion Form | Icon |
|------|----------------|----------------|---------------|----------------|------|
| 1 | 0 – 1,499 | Bronze Fry | Shallow Operator | Translucent fry | 🥚 |
| 2 | 1,500 – 2,499 | Silver Keeper | Coastal Operator | Silver-blue shimmer | 🥈 |
| 3 | 2,500 – 4,999 | Gold Aquarist | Pelagic Operator | Golden aura | 🥇 |
| 4 | 5,000 – 9,999 | Master Keeper | Abyssal Operator | Evolved deep form | 💎 |
| 5 | 10,000+ | God-Tier Champion | Hadal Champion | Legendary golden koi | 👑 |

### 3.2 Tier Privileges

Privileges unlock based on tier regardless of mode:

| Privilege | Tier Required |
|-----------|--------------|
| Post Tank Currents (social feed) | Bronze (all) |
| Join Schools | Bronze (all) |
| Create Schools | Silver |
| Request Pedigree Audits | Silver |
| Give Pedigree Audits (expert) | Master |
| Mentor other users | Master |
| Host Virtual Tides (online events) | Master |
| Host Expo Tides (physical events) | Hadal |
| Community moderation tools | Hadal |
| Eligible for God-Tier zone champion | Hadal (10,000+ pts) |

### 3.3 Demotion Policy

- Tiers are **permanent once reached** — no demotion from inactivity.
- God-Tier zone champion status IS competitive (see Zone Leaderboards below), but your tier level itself never drops.

---

## 4. Zone Leaderboards (Regional Rankings)

### 4.1 How Zones Work

- Every user is assigned a **zoneHash** — a deterministic geographic bucket derived from their approximate location (city/metro level, not precise GPS).
- Zones are ~15–30 mile radius buckets. Dense metro areas get multiple zones; rural areas get larger zones.
- Zone assignment happens at account creation or first location permission grant. Users can request a zone transfer once per 90 days.

### 4.2 Zone Leaderboard Rules

- **One leaderboard per zone.** Hobbyists and breeders compete on the same board.
- Ranked by `totalXp` (lifetime cumulative, no decay).
- The **#1 ranked user** in each zone holds the **God-Tier Champion** title for that zone.
- If someone surpasses the current champion, they automatically claim the title. The previous champion retains their tier level (Hadal/Master) but loses the "Champion" designation.
- Only users at Tier 5 (10,000+ pts) are eligible for the Champion title. If no one in a zone has 10k+, the champion slot is vacant.

### 4.3 Zone Leaderboard Display

**Where it shows up:**
- Breeder landing page (breeder.html) — marketing showcase
- Hobbyist landing page (hobbyist.html) — "be the top Keeper" teaser
- App dashboard — sidebar widget showing your zone rank + top 5
- User profile — zone rank badge if top 10

**Data shown per entry:**
- Rank position
- Display name (or wallet abbreviated if no name set)
- Total points
- Tier badge
- Primary specialty (most-kept species genus or breeding focus)
- Active listings count

---

## 5. Other Leaderboards

### 5.1 Global Depth Leaderboard

- Platform-wide ranking by total XP (top 100 displayed).
- Shows in The Reef's Discover tab.
- Primarily aspirational — no exclusive rewards beyond bragging rights.

### 5.2 Weekly Contributors (The Reef)

- Rolling 7-day window.
- Ranked by: Insights posted + Audits given + Challenge completions.
- Resets every Monday 00:00 UTC.
- Shows in The Reef Discovery Panel.
- Top 3 get a "Contributor of the Week" badge on their profile (non-permanent, refreshes weekly).

### 5.3 School Challenge Leaderboards

- Per-challenge, ephemeral.
- Each challenge defines its own scoring metric (specimens bred, care streak days, photo likes, etc.)
- Top 3 shown on ChallengeCard component.
- Full board accessible by tapping into the challenge.
- XP rewards distributed at challenge end to all participants proportionally + bonus for top 3.

---

## 6. Loyalty Rewards Pool (Economic Loop)

### 6.1 Fee Structure

Every marketplace transaction incurs a **4% protocol fee**, distributed:

| Slice | % of Fee | Purpose |
|-------|----------|---------|
| Marine Conservation Treasury | 25% | Coral reef restoration, sustainable aquaculture grants |
| User Loyalty Rewards Pool | 40% | Redistributed to active users |
| Platform Operations | 35% | Infrastructure, development, support |

### 6.2 How the Rewards Pool Pays Out

The Loyalty Rewards Pool accumulates from all marketplace transactions. Distribution happens **monthly** via platform credits:

**Eligibility:** Any user with 1+ marketplace transaction (buy or sell) in the past 90 days AND a minimum of 500 total XP.

**Distribution formula:**

```
user_share = (user_xp_earned_this_month / total_xp_earned_by_all_eligible_users_this_month) * pool_balance
```

- Only XP earned *during the distribution month* counts toward share calculation (not lifetime XP). This rewards active participation.
- Credits are deposited as **platform balance** usable toward future marketplace purchases (not withdrawable as cash).
- Credits expire after 12 months of non-use.

### 6.3 Tier-Based Discount (Immediate Benefit)

In addition to the monthly pool distribution, tiers grant a **passive marketplace discount** on purchases:

| Tier | Discount |
|------|----------|
| Bronze Fry | 0% |
| Silver Keeper | 2% off listing price |
| Gold Aquarist | 4% off listing price |
| Master Keeper | 6% off listing price |
| Hadal Champion | 8% off listing price |

This discount is funded from the platform operations slice (not the rewards pool) and displays at checkout.

---

## 7. Badges & Achievements

Badges are **non-transferable visual indicators** displayed on user profiles via BadgeShelf. They have no economic value but serve as social proof.

### 7.1 Badge Categories

| Category | Examples | Unlock Source |
|----------|----------|---------------|
| Collection | First Tank, 5 Tanks, 10 Tanks, 10 Species, 50 Species, 100 Species | Asset counts |
| Tier | Silver Tier, Gold Tier, Master Tier, God-Tier Champion | Reaching tier |
| Community | Reef Pioneer (first post), Active Voice (10 posts), Knowledge Sharer (first insight) | Social activity |
| XP Milestones | Rising Current (500), Tidal Force (2000), Poseidon's Favor (5000) | Lifetime XP |
| Social | Social Swimmer (5 tankmates) | Connections |
| Event | Expo Attendee, Challenge Victor, Care Streak (30 days) | Specific achievements |

### 7.2 Badge Display

- Profile page: Full BadgeShelf with all unlocked badges.
- Profile cards (compact): Top 3 most-recently-earned badges.
- Zone Leaderboard: Highest-tier badge shown next to name.

---

## 8. Companion Integration

The companion (Echo for hobbyists, unnamed breeder companion) is **one entity** tied to the user's tier:

| Tier | Visual State | Behavior |
|------|-------------|----------|
| Bronze | Translucent fry, shy | Basic mood reactions |
| Silver | Silver-blue shimmer | Reactive moods based on care streak |
| Gold | Golden aura glow | Proactive care suggestions, spawn alerts |
| Master | Deep evolved form | Full advisory capability, mentorship nudges |
| Hadal/Champion | Legendary golden koi | Pulsing neon aura, full personality, zone status indicator |

- In Casual mode: Companion is prominent, named "Echo," personality is warm and poetic.
- In Pro mode: Companion is minimized/hidden, toasts are operational, no personality overlay.
- Companion state (visual tier, mood) is derived from `totalXp` and recent care streak quality — never stored separately.

---

## 9. Data Model Changes

### 9.1 Simplified User Profile Schema

```
userProfile:
  walletAddress    (PK)
  displayName
  totalXp          (single unified pool — replaces prestigeXp + hobbyistXp)
  currentTier      (derived from totalXp, cached)
  zoneHash         (geographic bucket)
  monthlyXp        (XP earned in current distribution period, resets monthly)
  rewardCredits    (platform credit balance from pool distributions)
  companionState   (derived from tier, not stored independently)
  streakDays       (current consecutive care days)
  lastActiveDate
  isCouncilMember
  onboardingComplete
  preferredMode    ("casual" | "pro")
```

### 9.2 Migration from Current Schema

- `prestigeXp + hobbyistXp` → sum into `totalXp`
- `breederCompanion.companionXp` → redundant, derive from `totalXp`
- `breederCompanion.currentTier` → derive from `totalXp` thresholds
- Keep `breederCompanion.eggState` and `selectedStats` for visual customization only

### 9.3 XP Event Log (Supabase)

```sql
xp_events:
  id              UUID (PK)
  wallet_address  TEXT
  action_type     TEXT (enum of action codes)
  points_awarded  INTEGER
  multiplier      DECIMAL (1.0, 1.5, 2.0)
  final_points    INTEGER (points_awarded * multiplier)
  zone_hash       TEXT
  created_at      TIMESTAMP
  metadata        JSONB (challenge_id, tank_id, etc.)
```

This table powers:
- Zone leaderboard aggregation
- Monthly reward distribution calculation
- Weekly contributor board
- Audit trail / anti-gaming detection

---

## 10. Anti-Gaming & Integrity

| Risk | Mitigation |
|------|-----------|
| Spam feeding logs for points | Cooldown per action per tank (1 per day for feeding, 1 per 48h for water changes) |
| Fake tanks for registration bonus | Tank must have 1+ species added within 7 days or registration XP is revoked |
| Multi-account zone manipulation | One zone champion per verified wallet; Privy identity binding |
| GPS spoofing for expo multiplier | Expo zones require active event codes + GPS within bounding box + time window |
| Bot social activity | Rate limits on posts (2/day), reactions (30/day), comments (20/day) |

---

## 11. Where Everything Shows Up (UI Surface Map)

| Surface | What's Displayed | Persona Visibility |
|---------|------------------|-------------------|
| **Dashboard sidebar** | XP bar + tier + zone rank widget | Both (different labels) |
| **Profile page** | Full BadgeShelf, tier, total XP, zone rank | Both |
| **Breeder landing (breeder.html)** | Zone Leaderboard showcase, tier ladder, XP actions | Breeder marketing |
| **Hobbyist landing (hobbyist.html)** | Loyalty card, tier companion progression, rewards pool | Hobbyist marketing |
| **The Reef — Discover tab** | Weekly Contributors board, Global Depth leaderboard | Both |
| **The Reef — Schools** | Per-challenge leaderboards on ChallengeCards | Both |
| **Marketplace checkout** | Tier discount badge, rewards pool contribution note | Both |
| **Companion widget** | Visual tier state, mood, streak indicator | Casual only (hidden in Pro) |
| **XP toast notifications** | "+X pts" on each action | Casual: celebratory / Pro: subtle |
| **App Settings** | Full XP history, tier progress, zone info, mode toggle | Both |

---

## 12. Implementation Priority

| Phase | Scope | Dependencies |
|-------|-------|-------------|
| **Phase 1** | Unify `prestigeXp + hobbyistXp` → `totalXp`. Single tier ladder. Mode-aware labels. | db.js migration, xp.js refactor, useXPSync.js update |
| **Phase 2** | Zone leaderboard API (Supabase). Zone assignment flow. Dashboard widget. | Supabase table, location permission UX |
| **Phase 3** | Monthly Rewards Pool distribution logic. Credit balance at checkout. | Stripe/payment integration, scheduled function |
| **Phase 4** | Tier-based marketplace discounts. Anti-gaming cooldowns. | CheckoutSummary.jsx update, server-side validation |
| **Phase 5** | Weekly contributor board, refined badge system, challenge XP payouts. | Reef social features stable |

---

## 13. Resolved Design Decisions

1. **Zone size tuning** — Zones are **population-density-adaptive**. Dense metros get smaller zones (more competition per bucket); rural areas get larger zones so there's always a meaningful pool of competitors. Prevents one user auto-winning an empty zone.
2. **Credit expiry UX** — Credits expire silently after 12 months of non-use. No notification system needed — keeps the UX clean and avoids nagging. Users who are active enough to earn credits are active enough to spend them.
3. **Pro mode XP visibility** — XP is **not shown by default** in Pro mode. Available via a collapsible stats panel in Settings/Dashboard that the user can expand on demand. No toasts, no progress bars in the main workflow.
4. **Cross-zone visibility** — Users **can browse other zones' leaderboards**. Zone picker/search in the leaderboard UI lets you explore any region. Encourages community curiosity and event travel.
5. **Seasonal resets** — Yes, a **quarterly seasonal contributor board** will exist alongside the weekly one. Rewards for the seasonal board are **TBD pending real user engagement data** post-launch. The weekly board ships first; seasonal layer added once we have 2–3 months of usage patterns to calibrate reward thresholds.
