# Onboarding Wizard — Task List

## Overview

A narrative-driven walkthrough wizard that introduces new users to Poseidon (AI assistant) and Echo (companion fish), establishes their identity/wallet, and loads the species database in the background — all without the user ever seeing a loading screen.

---

## Phase 1: Infrastructure & Auth

### 1.1 Re-enable Privy Embedded Wallets
- [x] Configure Privy environment variables on Vercel
- [x] Update `AuthContext.jsx` to support Privy login alongside MetaMask
- [x] Wire `registerSignerResolver()` in `smartAccount.js` to use Privy's embedded wallet signer
- [x] Add login methods: email, Google (no seed phrase, no extension required)
- [x] Ensure MetaMask remains available as a "link external wallet" upgrade path for Pro users

### 1.2 Wallet UX Abstraction
- [x] Casual mode: Hide all blockchain terminology — frame as "Secure Aquarium Logbook"
- [x] Pro mode: Show operator node designation, note MPC key provisioning
- [x] Generate friendly alias for wallet address (e.g., "Aquarist #4821") stored in Dexie `userProfile`
- [x] Never surface hex addresses, private keys, or chain IDs to casual users

---

## Phase 2: Wizard Component

### 2.1 Scaffold `OnboardingWizard.jsx`
- [x] Full-screen overlay component, glassmorphic card style (matches `SpawningWizard`)
- [x] 4-step stepper with progress nodes
- [x] Renders on first visit only (gate via `localStorage` key: `aquadex_onboarding_complete`)
- [x] Poseidon dialogue drives each step (scripted responses, not NLP parsing)
- [x] Dual-mode copy: all text adapts to casual/pro based on persona selection in Step 1

### 2.2 Step 1 — "Meet Poseidon" (Welcome + Persona Selection)
- [x] Poseidon introduces himself in chat-bubble dialogue
- [x] User selects path: "I keep fish at home" (Casual) or "I breed professionally" (Pro)
- [x] Selection sets `casualModeActive` for the session and persists to Dexie `userProfile`
- [x] Poseidon's tone shifts immediately to confirm the selection — make it feel like he "heard" them
- [x] Persona choice is reversible later via Settings (with a small warning about tone/UI shift)
- [x] Settings toggle: "Switch to Pro Mode" / "Switch to Casual Mode" with confirmation dialog

### 2.3 Step 2 — "Your Logbook Identity" (Wallet Creation)
- [x] Trigger Privy login (email/Google) — embedded wallet created behind the scenes
- [x] Poseidon narrates the moment:
  - Casual: *"I've created your secure Aquarium Logbook. Your entries are cryptographically yours."*
  - Pro: *"Operator node initialized. Embedded signing key provisioned via MPC."*
- [x] Generate deterministic friendly alias from wallet address + fish-themed word list (e.g., "Coral-Tetra-4821")
- [x] Store alias in Dexie `userProfile`; never show hex address in casual mode
- [x] Casual micro-explanation: *"This keeps your logbook entries yours — even if you switch devices later."*
- [x] Pro mode: be more direct about the embedded signer and key recovery options
- [x] On success, register signer and set `account` in AuthContext
- [x] Fallback: If Privy unavailable, guide MetaMask install/connection with friendly framing

### 2.4 Step 3 — "Echo Awakens" (Companion Introduction)
- [x] Render translucent egg with gentle pulse animation
- [x] Poseidon explains Echo's role: *"This is Echo — your companion. As you care for your fish, Echo grows with you."*
- [x] Interactive moment: user taps/clicks egg → wobble animation → Poseidon reacts
- [x] Keep teaching extremely light — one line on XP loop: *"Every time you care for your fish, Echo gets a little stronger too."*
- [x] Real education happens naturally through use, not in the wizard
- [x] Tap area must be generous (minimum 48×48px touch target), especially for mobile

### 2.5 Step 4 — "Your First Tank" (Guided Action)
- [x] Mini tank setup wizard (volume, pH, temp) — reuse logic from `MarketplaceBoard` display tank wizard
- [x] Pre-fill reasonable defaults based on persona:
  - Casual: "Community tank, 20 gallons" with friendly species suggestions
  - Pro: Neutral/empty or "Breeding rack – Unit 01"
- [x] Casual framing: "Let's set up your first display tank. What size is it?"
- [x] Pro framing: "Initialize primary containment unit. Specify parameters."
- [x] On completion: award first XP (+15), Echo egg glows brighter
- [x] Transition to main dashboard

---

## Phase 3: Background Database Hydration

### 3.1 Parallel Catalog Load
- [x] On wizard mount: immediately kick off `fishbase_master.json` fetch + Dexie bulk insert
- [x] Completely decoupled from wizard UI steps — no blocking, no dependency
- [x] Track internal state flag: `catalogReady: boolean`

### 3.2 Timing Edge Cases
- [x] **User is slow (typical):** DB finishes before Step 4. No spinner ever shown.
- [x] **User is fast, DB still loading:** Hold at transitional moment after wizard completion
  - Echo's egg pulses with subtle progress ring
  - Poseidon: *"Echo is syncing with the species archive... almost there."*
  - Show small "Species archive syncing…" line under Echo during hold state (not pure silence)
  - Feels intentional, not broken
- [ ] **Bad connection fallback:** Prioritize loading top 50 popular species first, backfill remainder
  - Step 4 (tank species selection) only needs a subset to function

### 3.3 Transition Gating
- [x] Wizard "Complete" button checks `catalogReady` flag
- [x] If true → navigate to dashboard immediately
- [x] If false → hold on Echo animation beat, subtle egg glow increases with progress
- [x] Never show a traditional loading bar — user sees companion behavior, not infrastructure

---

## Phase 4: Polish & Edge Cases

### 4.1 Returning Users
- [x] Skip wizard entirely if `aquadex_onboarding_complete` is set in localStorage
- [x] Provide "Replay Intro" option in settings for users who want to revisit (or show to friends)

### 4.2 Mid-Wizard Abandonment
- [x] If user closes tab during Step 2 (wallet creation): treat as incomplete
- [x] On return, restart wizard cleanly from the beginning (don't leave half-state)
- [x] Persist partial progress only after wallet is successfully created (Step 2 complete)

### 4.3 Error Handling
- [x] Privy login fails → offer MetaMask fallback with clear messaging
- [ ] Network offline → wizard steps 1, 3, 4 still work (local-first); step 2 deferred with explanation
- [x] Database fetch fails → retry with exponential backoff; don't block wizard progression

### 4.4 Mobile Experience
- [x] Glassmorphic card + stepper must work well in portrait orientation
- [x] Echo egg tap target: minimum 48×48px (WCAG touch target)
- [x] Step transitions: test on small viewports (375px width minimum)
- [x] Poseidon chat bubbles: responsive text sizing, no horizontal overflow

### 4.5 Animations & Micro-interactions
- [x] Poseidon chat bubbles: typing indicator → reveal (feels conversational)
- [x] Step transitions: smooth card slide or fade
- [x] Echo egg: idle pulse, tap wobble, glow intensity tied to XP/progress
- [x] Stepper nodes: match existing `wizard-step-node` classes from SpawningWizard

---

## Appendix: Poseidon Dialogue Script

The canonical copy for each wizard step. Rendered as chat bubbles with typing indicators between each message.

---

### Step 1 — "Meet Poseidon" (Welcome + Persona Selection)

**Initial greeting (same for both modes):**

> **Poseidon:** Hello there. I'm Poseidon — your guide through these waters. I'll help you keep track of your fish, their stories, and everything that keeps them thriving. Before we begin… tell me how you keep fish.

**After user selects "I keep fish at home" (Casual):**

> **Poseidon:** Wonderful. Then we'll keep things simple and friendly. This is your personal aquarium logbook — nothing complicated, just the things that matter to you and your fish. I'll be right here whenever you need me.

**After user selects "I breed professionally" (Pro):**

> **Poseidon:** Understood. Then we'll work with precision. This is your operational node. We'll track lineages, water chemistry, and breeding outcomes with the clarity your work deserves. I'm ready when you are.

---

### Step 2 — "Your Logbook Identity" (Wallet Creation)

*Note: These lines trigger after Privy login succeeds. Show a "One moment…" typing indicator during the 1-3 second wallet provisioning gap.*

**Casual mode:**

> **Poseidon:** One moment while I set up your secure logbook…
>
> There. Your entries are now cryptographically yours. Even if you switch devices, your history travels with you. No complicated keys to remember — just your fish and their stories.

**Pro mode:**

> **Poseidon:** Initializing operator node…
>
> Embedded signing key provisioned via MPC. Your actions on-chain are now tied to this identity. You can link an external wallet later if you need full self-custody control.

---

### Step 3 — "Echo Awakens" (Companion Introduction)

**Casual mode:**

> **Poseidon:** And this… is Echo. As you care for your fish, Echo grows alongside you. Feedings, water changes, successful spawns — every bit of care strengthens your companion. Go ahead… tap the egg.

*(After user taps the egg and it wobbles)*

> **Poseidon:** There you go. Echo felt that. Keep tending your tanks and Echo will hatch, then grow stronger with you. It's a quiet kind of partnership.

**Pro mode:**

> **Poseidon:** This is Echo — your companion node. Every logged action, every verified spawn, every water parameter you record contributes to Echo's development. Tap the egg when you're ready.

*(After user taps the egg and it wobbles)*

> **Poseidon:** Acknowledged. Echo is now linked to your operator profile. Continued accurate record-keeping will increase its tier and capabilities over time.

**Inactivity nudge (if no tap after ~6 seconds):**

> **Poseidon:** Go on, give it a tap.

---

### Step 4 — "Your First Tank" (Guided Action)

**Casual mode — during setup:**

> **Poseidon:** Let's set up your first display tank. What size is it, roughly? And what kind of fish are you thinking of keeping?

*(After user completes the mini setup)*

> **Poseidon:** Perfect. Your first tank is now logged. You just earned your first bit of experience — Echo felt that too. Welcome to Aquadex. Your journey starts here.

**Pro mode — during setup:**

> **Poseidon:** Initialize your primary containment unit. Enter volume, target parameters, and intended use (display, grow-out, breeding, etc.).

*(After user completes the mini setup)*

> **Poseidon:** Unit initialized and recorded. First operational log complete. Echo's baseline has been established. You're ready to begin proper work.

---

### Tone Reference

| Aspect | Casual Mode | Pro Mode |
|--------|-------------|----------|
| Language | Warm, friendly, hobbyist-focused | Precise, operational, respectful |
| Emotional tone | Encouraging, almost gentle | Calm, competent, professional |
| References | "your fish", "your tank", "stories" | "specimens", "containment unit", "protocol" |
| Length | Slightly more conversational | Slightly more concise |
| After persona choice | Immediately shifts to warm/friendly | Immediately shifts to precise |

**Tone guardrails:**
- Pro mode should feel like an expert colleague, not a military terminal. Avoid over-using "Acknowledged" or single-word robotic confirmations.
- Casual mode can be gentle but should never feel patronizing or overly childish.
- Both modes: Poseidon is always calm, never urgent or anxious.

---

## Dependencies & Notes

| Dependency | Status | Notes |
|---|---|---|
| `@privy-io/react-auth` | In `package.json`, disabled | Needs env vars on Vercel to activate |
| `smartAccount.js` signer resolver | Wired, unused | Ready for Privy signer registration |
| `fishbase_master.json` | 326 species, ~1-2MB | Current load via `useSpeciesData.js` |
| Dexie `userProfile` table | Exists | Store persona, onboarding state, alias |
| Dexie `breederCompanion` table | Exists | Echo state persistence |
| `SpawningWizard.jsx` | Reference | Reuse stepper pattern and glassmorphic style |
| Base Paymaster (gasless) | Planned, not active | Future enhancement after Privy is live |
