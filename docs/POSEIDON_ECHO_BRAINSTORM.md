# POSEIDON + ECHO — Internal Brainstorm (May 27, 2026)

**Status:** Early Brainstorming / Concept Phase  
**Goal:** Define the on-device AI layer (Poseidon) and its living visual companion (Echo) for the Aquadex / Aquacellum ecosystem.  
**Tone:** Local-first, emotionally resonant, frictionless, and deeply tied to the existing gamified companion system.

---

## 1. Core Vision

**Poseidon** = The Intelligence Layer  
**Echo** = The Living Visual Companion (the fish that swims in the tank)

Poseidon is the conversational, on-device AI brain.  
Echo is the physical manifestation that lives inside the user’s aquariums and visually reacts to Poseidon’s insights and the user’s husbandry actions.

The relationship is simple and powerful:  
**Poseidon speaks. Echo reacts.**

This creates a beautiful separation:
- Users **talk to Poseidon**
- They **watch Echo** swim, glow, and evolve in their tanks

---

## 2. Naming & Personal Lore

- **Poseidon** — The AI intelligence layer (conversational brain running locally via WebGPU/WASM).
- **Echo** — The swimming visual companion.

**Personal Anchor:**  
"Echo Quest" was the first PC game the founder received from Uncle Wes. This name carries real emotional weight and makes the companion feel personal rather than purely thematic.

**Philosophy:**
- Poseidon = Wisdom / Voice
- Echo = Reflection / Presence
- The companion is not Poseidon himself — it is what Poseidon *echoes* into the physical world of the tank.

---

## 3. High-Level Architecture
User (Voice/Text)
↓
Poseidon (Local LLM in Web Worker)
↓
Function Calling + Dexie Writes + Event Dispatch
↓
Echo (SVG Canvas in TankList.jsx) ← Reacts visually
↓
useXPSync + actionLogs + Companion State

**Key Principles:**
- 90%+ of daily interactions run fully locally and offline.
- Poseidon never directly controls the UI — it triggers events that Echo and the rest of the app react to.
- Clear separation between intelligence (Poseidon) and embodiment (Echo).

---

## 4. Echo — The Visual Companion (Evolution Tiers)

Echo builds directly on the existing companion system but gains personality and reactivity through Poseidon.

### Proposed Tier Structure (refined)

| Tier          | XP Range     | Visual Style                     | Personality / Behavior                          | Poseidon Interaction |
|---------------|--------------|----------------------------------|--------------------------------------------------|----------------------|
| Fry           | 0–499        | Small, translucent, slow         | Curious, a little clumsy                         | Basic reactions     |
| Bronze        | 500–1499     | Small fish, subtle glow          | Playful, energetic                               | Starts noticing advice |
| Silver        | 1500–2499    | Sharper form, silver aura        | More graceful                                    | Reacts to insights  |
| Gold          | 2500–4999    | Golden glow, confident swim      | Regal, attentive                                 | Strong visual feedback |
| Master        | 5000–9999    | Deep neon purple aura            | Wise, calm, purposeful                           | Can "channel" Poseidon moments |
| God-Tier      | Regional #1  | Koi-style with flowy elements    | Majestic, ancient guardian feel                  | Rare "Poseidon’s Echo" visual events |

**Future Visual Direction:**
- God-Tier could gain subtle trident or wave motifs without becoming literal.
- Color and aura intensity can shift based on recent Poseidon interactions (e.g., after good advice, Echo glows warmer).

---

## 5. Poseidon — Core Capabilities (Brainstorm)

### Phase 1 (PWA)
- Conversational onboarding (parse tank description → create tank + seed logs)
- Natural language husbandry logging ("I just fed the tetras")
- Water parameter interpretation and gentle suggestions
- Compatibility & species recommendations
- Light personality based on user’s tank history

### Phase 2 (Native)
- Camera vision (photo of tank → water clarity, possible issues)
- More advanced multi-tank analysis
- Voice input as primary interface

### Long-term Agent Vision
- Sense → Plan → Act loop
- Can suggest calendar reminders, push notifications, or even trigger UI changes (with user permission)
- Hybrid: heavy lifting stays local, complex historical analysis can optionally use cloud

---

## 6. Interaction Model (Poseidon ↔ Echo)

This is the emotional core.

**Examples of desired behavior:**

- User talks to Poseidon → Echo swims a little faster or does a happy loop
- Poseidon gives a warning about parameters → Echo’s swimming slows slightly or aura dims
- User logs a good action → Echo gets a small temporary glow / speed boost
- After several days of consistent care → Echo performs a special "content" animation
- God-Tier Echo can occasionally do a rare "Poseidon’s Blessing" visual moment when particularly good advice is followed

**Rule:** Poseidon never directly animates Echo. It dispatches events. Echo’s canvas component listens and reacts. This keeps concerns cleanly separated.

---

## 7. Integration Points with Existing Codebase

- **TankList.jsx** — Main home of the `<CompanionFishEntity />` canvas
- **useXPSync.js** — Already handles husbandry → XP. Poseidon can feed into this.
- **actionLogs** table (Dexie) — Poseidon can write structured logs
- **BreedGallery / SuggestSpecies** — Poseidon could power smarter suggestions later
- **SpawningWizard** — Future: Poseidon helps suggest compatible pairs
- **Persona System** — Different tone:
  - Casual: Warm, friendly, emoji-friendly
  - Pro: Precise, data-oriented, slightly more formal

---

## 8. Technical Notes (Early)

- Run Poseidon inside a **Web Worker** (already planned)
- Use **WebGPU + WASM** (wllama or Transformers.js)
- Start with a small capable model (Gemma 3 1B or similar) for PWA
- Strong emphasis on **function calling** so Poseidon can safely trigger Dexie writes and events
- Must respect **Casual vs Pro mode** in all responses
- Full offline capability is non-negotiable

**Open Technical Questions:**
- How do we handle model download + caching elegantly on first visit?
- What is the cleanest event system between Poseidon worker and React?
- Should Poseidon have access to read the current tank state directly, or only through events?

---

## 9. Open Questions & Next Steps

### High Priority
- [ ] Define the exact event schema Poseidon can emit (e.g. `poseidon:insight-given`, `poseidon:onboarding-complete`)
- [ ] Decide on initial model + quantization strategy for PWA
- [ ] Design the first conversational onboarding flow
- [ ] Create tier-specific Echo personality + animation triggers

### Nice to Have
- Light internal lore document for Poseidon + Echo relationship
- Voice synthesis direction (even if just for future native)
- How Echo’s appearance evolves in God-Tier to feel more "Poseidonic"

---

## 10. Why This Matters

This pairing turns the existing Breeder Companion from a nice visual gamification element into something that feels **alive and responsive**. 

Poseidon removes friction.  
Echo makes the experience feel magical.

Together they have the potential to be the emotional heart of the entire Aquacellum experience.

---

**Document Owner:** McDermKev  
**Last Updated:** May 27, 2026  
**Status:** Brainstorming — Open for iteration