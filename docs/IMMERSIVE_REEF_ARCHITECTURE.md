# Immersive Reef — WebXR Architecture Sketch

> A walkable, AI-narrated underwater reef built on the existing Aquadex species
> database, viewable in VR headsets or flat-screen browsers via the same URL.

---

## Vision

You load a page. The ocean opens around you. Fish you've catalogued swim past in
their actual habitats — rocky cichlid caves, planted tetra streams, loricariid
driftwood tangles. You look at one; a voice (or text bubble) tells you its story
in Casual or Pro mode, pulled live from `fishbase_master.json`. You can speak or
type to ask questions. The AI narrates like a guide who actually knows the fish.

In VR: full spatial immersion, head-tracked, hand-interactive.
On desktop/mobile: orbit camera, click-to-inspect, same data and narration.

---

## Stack Choice (rationale)

| Layer | Tool | Why |
|-------|------|-----|
| 3D engine | **Three.js** via `@react-three/fiber` | React already in your stack; R3F wraps Three.js idiomatically in JSX components |
| WebXR | `@react-three/xr` | Adds VR/AR session management to R3F with one `<XR>` wrapper |
| Physics/interaction | `@react-three/drei` | Pre-built helpers: environment maps, text, gaze cursors, sky, water shader |
| AI narration | Existing **Poseidon** serverless endpoint + Web Speech API | You already have an AI chat backend; reuse it with a voice layer |
| Species data | Existing `fishbase_master.json` + `useSpeciesData` hook | Zero new data needed — the reef reads what you already built |
| Audio | Web Audio API + spatial positioning | Ambient reef sounds, directional narration |

**No new backend required.** This is a new Vite entry point (`reef-xr.html`)
alongside your existing pages.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  reef-xr.html  (new Vite entry)                                 │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  <Canvas>  (@react-three/fiber)                          │    │
│  │                                                          │    │
│  │  ┌──────────┐  ┌───────────┐  ┌────────────────────┐    │    │
│  │  │  <XR>    │  │ <Ocean>   │  │ <ReefEnvironment>  │    │    │
│  │  │  session │  │ water     │  │ rocks, coral, sand  │    │    │
│  │  │  manager │  │ shader    │  │ procedural + GLTF   │    │    │
│  │  └──────────┘  └───────────┘  └────────────────────┘    │    │
│  │                                                          │    │
│  │  ┌────────────────────────────────────────────────┐      │    │
│  │  │  <SpeciesSwarm>                                │      │    │
│  │  │  Maps fishbase_master.json → instanced fish    │      │    │
│  │  │  Each species = a FishEntity with:             │      │    │
│  │  │    • boid swimming AI (schooling behavior)     │      │    │
│  │  │    • habitat zone placement (by ecology data)  │      │    │
│  │  │    • interaction hitbox (gaze/click/grab)      │      │    │
│  │  └────────────────────────────────────────────────┘      │    │
│  │                                                          │    │
│  │  ┌────────────────────────────────────────────────┐      │    │
│  │  │  <NarrationLayer>                              │      │    │
│  │  │  On inspect:                                   │      │    │
│  │  │    1. Read personality.vibeLine (instant)      │      │    │
│  │  │    2. TTS via Web Speech API                   │      │    │
│  │  │    3. If user asks deeper → Poseidon AI call   │      │    │
│  │  │    4. Response spoken + displayed as 3D text   │      │    │
│  │  └────────────────────────────────────────────────┘      │    │
│  │                                                          │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  <ReefHUD>  (2D overlay or spatial UI in VR)             │    │
│  │  • Species info card (Casual/Pro toggle)                 │    │
│  │  • Minimap showing biome zones                           │    │
│  │  • Voice input indicator                                 │    │
│  │  • Collection progress                                   │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘

External calls:
  fishbase_master.json ←── static fetch (already exists)
  /api/poseidon        ←── AI narration (already exists)
  Web Speech API       ←── browser-native TTS/STT
```

---

## Key Components (detailed)

### 1. ReefEnvironment — the world itself

```jsx
// Pseudocode sketch
function ReefEnvironment() {
  return (
    <group>
      {/* Underwater lighting — caustics, god rays, blue tint */}
      <ambientLight intensity={0.3} color="#1a6b8a" />
      <directionalLight position={[5, 20, 5]} intensity={0.8} color="#87ceeb" />
      <CausticsProjector /> {/* animated caustic pattern on sand */}

      {/* Ocean surface (visible when looking up) */}
      <Ocean position={[0, 15, 0]} />

      {/* Terrain: procedural or GLTF reef structures */}
      <ReefRocks />       {/* instanced rocky formations */}
      <CoralGarden />     {/* randomized coral placements */}
      <SandFloor />       {/* textured plane with ripples */}
      <DriftwoodCluster />{/* for loricariid habitat zones */}
      <PlantBed />        {/* for tetra/rasbora zones */}

      {/* Particle effects */}
      <Particles type="plankton" count={2000} />
      <Particles type="bubbles" count={200} />

      {/* Spatial audio: ambient reef sounds */}
      <PositionalAudio src="/audio/reef-ambient.mp3" loop />
    </group>
  );
}
```

**Biome zones** are mapped from the species database itself:
- Rocky cichlid zone (species where `ecology.biotope` mentions rock/cave)
- Planted community zone (tetras, rasboras, livebearers)
- Driftwood/bottom zone (plecos, corydoras, loaches)
- Open water pelagic zone (danios, barbs)

Each species is spawned into its correct biome based on existing data fields.

### 2. SpeciesSwarm — living fish from your database

```jsx
function SpeciesSwarm({ speciesData, onInspect }) {
  // Group species by biome zone using ecology data
  const biomes = useBiomeClassifier(speciesData);

  return (
    <>
      {biomes.map(biome => (
        <BiomeZone key={biome.id} position={biome.worldPos}>
          {biome.species.map(sp => (
            <FishSchool
              key={sp.specCode}
              species={sp}
              count={getSchoolSize(sp)}  // from ecology.socialBehavior
              behavior="boid"             // schooling AI
              onGaze={() => onInspect(sp)} // trigger narration
            />
          ))}
        </BiomeZone>
      ))}
    </>
  );
}
```

**Fish rendering options (progressive fidelity):**
1. **Phase 1 (MVP):** Stylized SVG-to-3D extrusions using your existing fish SVGs from CompanionFishEntity, or low-poly procedural fish meshes colored per species.
2. **Phase 2:** AI-generated 3D fish models (Hunyuan3D / TRELLIS from a reference photo → GLTF).
3. **Phase 3:** Full photorealistic fish with skeletal animation, per-species.

**Schooling behavior:** A simple boid system (separation, alignment, cohesion) gives convincing schooling. The `socialBehavior` field tells you school size — "must be kept in a school of 5+" → spawn 6–8 instances.

### 3. NarrationLayer — the AI guide

This is the "holographic archive" piece. Two tiers of narration:

**Tier 1 — Instant (no API call):**
When you look at / click a fish, immediately show:
- `personality.vibeLine[mode]` as floating 3D text
- `commonName` + `scientificName`
- TTS reads the vibeLine aloud (Web Speech API, zero latency)

**Tier 2 — Deep dive (Poseidon call):**
If the user asks a question (voice or text), route it to your existing `/api/poseidon` endpoint with the species context:

```js
async function askAboutSpecies(species, question) {
  const context = {
    name: species.commonName,
    scientific: species.scientificName,
    ecology: species.ecology,
    diet: species.diet,
    reproduction: species.reproduction,
    personality: species.personality
  };

  const response = await fetch('/api/poseidon', {
    method: 'POST',
    body: JSON.stringify({
      message: question,
      context: `You are narrating an immersive reef experience. The user is 
                looking at ${context.name}. Here is everything known about it: 
                ${JSON.stringify(context)}. Answer conversationally.`
    })
  });

  return response.json();
}
```

The response is:
- Displayed as a speech bubble / holographic text panel near the fish
- Spoken aloud via TTS
- Optionally: the user spoke via STT (Speech-to-Text), making it fully conversational

### 4. XR Session — VR/AR entry

```jsx
function ImmersiveReefApp() {
  return (
    <Canvas>
      <XR>
        <Controllers />  {/* hand controllers for grabbing/pointing */}
        <Hands />         {/* hand tracking if available */}

        {/* Teleport locomotion — point and click to move */}
        <TeleportTarget>
          <ReefEnvironment />
        </TeleportTarget>

        <SpeciesSwarm speciesData={data} onInspect={handleInspect} />
        <NarrationLayer activeSpecies={inspected} mode={mode} />
      </XR>
    </Canvas>
  );
}
```

**Fallback for non-VR:**
```jsx
// If no XR device, same scene with orbit controls
<OrbitControls enablePan enableZoom maxPolarAngle={Math.PI * 0.85} />
```

Same URL works on Quest, Vision Pro, desktop, and phone.

---

## Data Flow (no new database needed)

```
fishbase_master.json (326 species, ecology, personality)
        │
        ▼
useSpeciesData() hook (already exists)
        │
        ▼
useBiomeClassifier() — NEW hook, groups by habitat
        │
        ▼
<SpeciesSwarm> renders fish in correct zones
        │
        ▼ (on gaze/click)
getPersonality(species, mode) — already exists in utils/personality.js
        │
        ▼
<NarrationLayer> displays + speaks
        │
        ▼ (if user asks deeper)
/api/poseidon — already deployed
```

---

## File Structure (new files only)

```
frontend/
├── reef-xr.html                    ← new Vite entry point
├── src/
│   ├── reef/
│   │   ├── ImmersiveReef.jsx       ← root component
│   │   ├── ReefEnvironment.jsx     ← terrain, lighting, particles
│   │   ├── SpeciesSwarm.jsx        ← fish instances + boid AI
│   │   ├── FishSchool.jsx          ← single species school logic
│   │   ├── FishMesh.jsx            ← procedural or loaded fish geometry
│   │   ├── NarrationLayer.jsx      ← inspection UI + TTS + Poseidon
│   │   ├── ReefHUD.jsx             ← 2D/spatial overlay UI
│   │   ├── BiomeZone.jsx           ← habitat region wrapper
│   │   ├── CausticsProjector.jsx   ← light caustics shader
│   │   └── hooks/
│   │       ├── useBiomeClassifier.js  ← groups species by habitat
│   │       ├── useBoidSwim.js         ← schooling behavior
│   │       ├── useNarration.js        ← TTS + STT + Poseidon bridge
│   │       └── useReefAudio.js        ← spatial audio management
│   └── ...existing src/
└── public/
    ├── audio/
    │   ├── reef-ambient.mp3        ← underwater ambience loop
    │   └── narration-chime.mp3     ← inspection trigger sound
    ├── models/
    │   ├── coral-cluster.glb       ← reusable coral GLTF
    │   ├── rock-formation.glb      ← reef rocks
    │   └── fish/                   ← per-species GLTF (Phase 2+)
    └── ...existing public/
```

---

## New Dependencies

```json
{
  "@react-three/fiber": "^8.x",
  "@react-three/drei": "^9.x",
  "@react-three/xr": "^6.x",
  "three": "^0.170.x"
}
```

That's it. Four packages. Everything else (React, Vite, species data, Poseidon AI,
personality system) already exists in your project.

---

## Implementation Phases

### Phase 1 — Proof of Concept ✅ COMPLETE

**Goal:** Walk into an underwater scene and see fish from your database swimming.

- [x] Add Three.js + R3F + XR dependencies
- [x] Create `reef-xr.html` entry + `ImmersiveReef.jsx`
- [x] Basic underwater environment (blue fog, sand plane, simple lighting)
- [x] Procedural low-poly fish meshes (colored capsules with fins)
- [x] Load species from `fishbase_master.json`, spawn as boid schools
- [x] Click/gaze on fish → show name + vibeLine text
- [x] Desktop orbit controls

### Phase 2 — Narration + VR ✅ COMPLETE

**Goal:** Voice interaction and headset support.

- [x] Wire TTS (Web Speech API) to narration layer
- [x] Wire STT for voice questions → Poseidon API
- [x] Add `<XR>` wrapper with controllers + teleport
- [x] Biome zones with distinct terrain (rocks, plants, driftwood)
- [x] Caustics shader + particle effects (plankton, bubbles)
- [x] God rays (volumetric light shafts)
- [x] Spatial audio (synthesized underwater ambient + ducking)

### Phase 3 — Polish + AI-Generated Assets ✅ COMPLETE

**Goal:** Photorealistic fish, richer environments, generative expansion.

- [x] Progressive fidelity fish models (GLTF → Sprite → Procedural fallback)
- [x] Species PNG billboard sprites using existing images
- [x] Gaussian splat viewer for captured real aquariums
- [x] Generative biome system (5 biome templates: volcanic, tropical, kelp, crystal, blackwater)
- [x] Biome selector UI
- [x] Companion Echo fish as VR guide (follows camera, reacts to inspections)
- [x] Multiplayer presence system (BroadcastChannel for same-device, upgrade path to WebSocket)
- [x] Peer avatars (glowing orbs with look direction)
- [x] Asset pipeline documentation (models/fish/README.md, splats/README.md)

---

## The "Holodeck" Connection

This isn't a metaphor. What you're building with this:

| Holodeck feature | This project's implementation |
|---|---|
| Enter an authored world | Load reef-xr.html → you're underwater |
| World populated by living things | Species from your real database, swimming with AI behavior |
| Knowledgeable guide | Poseidon AI narrates, answers questions about any species |
| Responds to you | Voice input (STT) → AI response (TTS) → spatial audio |
| Explorable, spatial | Teleport between biome zones in VR |
| Educational/experiential | Not reading about fish — standing among them |
| Shareable experience | WebXR = URL-based, anyone with a headset enters the same world |

The gap between this and a "real holodeck" is just fidelity and sensory channels.
The architecture, the data flow, and the interaction model are identical.

---

## Quick Start (when you're ready to build)

```bash
cd frontend
npm install @react-three/fiber @react-three/drei @react-three/xr three
```

Then create `reef-xr.html` as a new Vite entry, wire it to `ImmersiveReef.jsx`,
and start with a blue void + one swimming fish reading from your species data.
Everything after that is iteration.
