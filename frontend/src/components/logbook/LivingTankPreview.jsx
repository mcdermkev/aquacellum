import React, { useMemo, useState } from "react";
import { LivingTank, livingTankAmbient } from "./LivingTank";
import { CasualTankGallery } from "./CasualTankGallery";
import { JournalTimeline } from "./JournalTimeline";
import { CareCoach } from "./CareCoach";
import { ProOpsGrid } from "./ProOpsGrid";
import { ParamTrends } from "./ParamTrends";
import { SpeciesCareGuide } from "./SpeciesCareGuide";

/**
 * LivingTankPreview — standalone prototype gallery for the Task 3 Living Tank
 * engine. Reachable at `?preview=living-tank`. Renders the same mock tank as
 * card / hero / strip variants with live controls to drive tank type, fish
 * count, and health so the water can be watched degrading (clear → murky,
 * lively → sluggish). No app data or navigation required.
 */

// Mock species keyed so TankFishVisualization's fishbase matcher resolves
// each specimen (matches on specCode === speciesId). Families are chosen to
// exercise different body shapes / colors / fin styles / sizes.
const MOCK_SPECIES = [
  { specCode: 1, speciesId: 1, family: "characidae",     maxLengthCm: 3,  commonName: "Neon Tetra",       scientificName: "Paracheirodon innesi" },
  { specCode: 2, speciesId: 2, family: "osphronemidae",  maxLengthCm: 8,  commonName: "Dwarf Gourami",    scientificName: "Trichogaster lalius" },
  { specCode: 3, speciesId: 3, family: "callichthyidae", maxLengthCm: 6,  commonName: "Corydoras",        scientificName: "Corydoras aeneus" },
  { specCode: 4, speciesId: 4, family: "loricariidae",   maxLengthCm: 12, commonName: "Bristlenose Pleco", scientificName: "Ancistrus sp." },
  { specCode: 5, speciesId: 5, family: "cichlidae",      maxLengthCm: 15, commonName: "Convict Cichlid",  scientificName: "Amatitlania nigrofasciata" },
];

// A stocking recipe: pull fish in this proportion as the count grows.
const STOCK_ORDER = [1, 1, 1, 3, 1, 3, 2, 1, 3, 5, 1, 2, 3, 1, 4, 1, 3, 2, 1, 5];

function makeSpecimens(count) {
  return Array.from({ length: count }).map((_, i) => {
    const speciesId = STOCK_ORDER[i % STOCK_ORDER.length];
    const sp = MOCK_SPECIES.find((s) => s.speciesId === speciesId);
    return {
      id: 1000 + i,
      speciesId,
      commonName: sp.commonName,
      scientificName: sp.scientificName,
      status: 0,
      gender: i % 2 === 0 ? "Male" : "Female",
    };
  });
}

// Mock tanks with varying health for the gallery demo (drive deriveTankHealth
// via latestLog: healthy / drifting / ammonia-emergency / never-tested).
const NOW = Math.round(Date.now() / 1000);
const GALLERY_TANKS = [
  {
    id: 1, name: "Community 76L", tankType: 0, volumeLiters: 76, specimens: makeSpecimens(9),
    latestTestTimestamp: NOW - 2 * 3600, latestChangeTimestamp: NOW - 3 * 86400,
    latestLog: { tempCelsiusX10: 245, phX10: 70, ammoniaPpmX100: 0, nitritePpmX100: 0, nitratePpmX100: 500, timestamp: NOW - 2 * 3600 },
  },
  {
    id: 2, name: "Grow-Out 50L", tankType: 0, volumeLiters: 50, specimens: makeSpecimens(14),
    latestTestTimestamp: NOW - 6 * 86400, latestChangeTimestamp: NOW - 8 * 86400,
    latestLog: { tempCelsiusX10: 300, phX10: 90, ammoniaPpmX100: 0, nitritePpmX100: 0, nitratePpmX100: 2500, timestamp: NOW - 6 * 86400 },
  },
  {
    id: 3, name: "Quarantine 38L", tankType: 0, volumeLiters: 38, specimens: makeSpecimens(3),
    latestTestTimestamp: NOW - 3600, latestChangeTimestamp: NOW - 86400,
    latestLog: { tempCelsiusX10: 250, phX10: 72, ammoniaPpmX100: 50, nitritePpmX100: 0, nitratePpmX100: 500, timestamp: NOW - 3600 },
  },
  { id: 4, name: "Nano 20L", tankType: 3, volumeLiters: 20, specimens: makeSpecimens(5) }, // pond, never tested
];

// Mock on-chain species catalog (temp/pH/care level) for the care-guide demo.
const PREVIEW_CONTRACT_SPECIES = [
  { speciesId: 1, commonName: "Neon Tetra", careLevel: 1, minTemp: 22, maxTemp: 26, minPh: 6.0, maxPh: 7.0 },
  { speciesId: 2, commonName: "Dwarf Gourami", careLevel: 2, minTemp: 24, maxTemp: 28, minPh: 6.5, maxPh: 7.5 },
  { speciesId: 3, commonName: "Corydoras", careLevel: 0, minTemp: 22, maxTemp: 26, minPh: 6.5, maxPh: 7.5 },
  { speciesId: 4, commonName: "Bristlenose Pleco", careLevel: 0, minTemp: 22, maxTemp: 27, minPh: 6.5, maxPh: 7.5 },
  { speciesId: 5, commonName: "Convict Cichlid", careLevel: 2, minTemp: 22, maxTemp: 28, minPh: 7.0, maxPh: 8.0 },
];

// Mock parameter readings (normalized) for the trends demo, trending toward drift.
const MOCK_READINGS = [
  { timestamp: NOW - 12 * 86400, temp: 24.2, ph: 7.1, nitrate: 5 },
  { timestamp: NOW - 9 * 86400, temp: 24.6, ph: 7.2, nitrate: 8 },
  { timestamp: NOW - 6 * 86400, temp: 25.1, ph: 7.3, nitrate: 14 },
  { timestamp: NOW - 3 * 86400, temp: 25.8, ph: 7.5, nitrate: 19 },
  { timestamp: NOW - 1 * 86400, temp: 26.4, ph: 7.7, nitrate: 26 },
];

// Mock schedules for the ops-grid worklist demo (bypasses Dexie; no DB writes).
const PREVIEW_SCHEDULES = {
  1: [
    { kind: "waterChange", lastDoneAt: NOW - 8 * 86400, nextDueAt: NOW - 1 * 86400, enabled: true },
    { kind: "test", lastDoneAt: NOW - 2 * 86400, nextDueAt: NOW + 5 * 86400, enabled: true },
  ],
  2: [
    { kind: "waterChange", lastDoneAt: NOW - 9 * 86400, nextDueAt: NOW - 2 * 86400, enabled: true },
    { kind: "test", lastDoneAt: null, nextDueAt: NOW, enabled: true },
  ],
  3: [{ kind: "waterChange", lastDoneAt: null, nextDueAt: NOW, enabled: true }],
  4: [{ kind: "test", lastDoneAt: NOW - 1 * 86400, nextDueAt: NOW + 6 * 86400, enabled: true }],
};

// Mock journal entries for the timeline demo (real component reads Dexie by tankId).
const MOCK_JOURNAL = [
  { key: "j1", kind: "feed", icon: "🥣", title: "Fed the fish", detail: "Frozen brine shrimp", ms: Date.now() - 40 * 60 * 1000 },
  { key: "j2", kind: "waterChange", icon: "💧", title: "40% water change", detail: "Vacuumed substrate, topped off", ms: Date.now() - 3 * 3600 * 1000 },
  { key: "j3", kind: "reading", icon: "🧪", title: "Water reading", detail: "24.5°C · pH 7.2 · NH₃ 0.00 · NO₃ 5", ms: Date.now() - 26 * 3600 * 1000 },
  { key: "j4", kind: "note", icon: "📝", title: "Note", detail: "The angelfish pair are starting to guard a corner — possible spawning site?", ms: Date.now() - 3 * 86400 * 1000 },
  { key: "j5", kind: "clean", icon: "🧹", title: "Cleaned the tank", detail: "Scraped algae off the front glass", ms: Date.now() - 5 * 86400 * 1000 },
];

// Saltwater (index 1) intentionally omitted — Aquacellum is freshwater-focused.
const TYPES = [
  { value: 0, label: "Freshwater" },
  { value: 2, label: "Brackish" },
  { value: 3, label: "Pond" },
];
const TYPE_CYCLE = TYPES.map((t) => t.value); // [0, 2, 3] — used to vary the demo strips

export function LivingTankPreview() {
  const [score, setScore] = useState(85);
  const [tankType, setTankType] = useState(0);
  const [fishCount, setFishCount] = useState(11);
  const [tapped, setTapped] = useState(null);

  const specimens = useMemo(() => makeSpecimens(fishCount), [fishCount]);
  const ambient = livingTankAmbient(score);
  const health = { status: ambient.status, ambient };

  const tank = {
    name: "Primary Community Tank",
    tankType,
    volumeLiters: 76,
    specimens,
    facility: "Main Room",
    room: "Main Room",
    rack: "—",
  };

  const statusCopy =
    ambient.status === "ok"
      ? "Healthy — clear water, fish lively"
      : ambient.status === "drifting"
      ? "Drifting — water hazing, fish slowing"
      : "Alert — murky water, sluggish fish";

  const statusColor =
    ambient.status === "ok" ? "#34d399" : ambient.status === "drifting" ? "#fbbf24" : "#f87171";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(1200px 600px at 50% -10%, #0b2135 0%, #050b14 60%, #03070e 100%)",
        color: "#e6eef7",
        padding: "2rem max(1.5rem, (100vw - 1100px) / 2)",
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      }}
    >
      <header style={{ marginBottom: "1.5rem" }}>
        <div style={{ fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "#5b9bd5" }}>
          Logbook Rework · Task 3 Prototype
        </div>
        <h1 style={{ fontSize: "1.6rem", margin: "0.25rem 0 0.4rem" }}>Living Tank engine</h1>
        <p style={{ margin: 0, color: "rgba(230,238,247,0.6)", fontSize: "0.9rem", maxWidth: 640 }}>
          The same tank rendered as three variants. Drag the health slider to watch the water
          communicate status — clarity, tint, and fish liveliness all respond. Enable your OS
          "reduce motion" setting to see the static fallback.
        </p>
      </header>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "1.5rem",
          alignItems: "center",
          padding: "1rem 1.25rem",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          marginBottom: "2rem",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", minWidth: 240, flex: 1 }}>
          <span style={{ fontSize: "0.75rem", color: "rgba(230,238,247,0.7)" }}>
            Tank health: <strong style={{ color: statusColor }}>{score}</strong> · {statusCopy}
          </span>
          <input type="range" min={0} max={100} value={score} onChange={(e) => setScore(Number(e.target.value))} />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", minWidth: 200, flex: 1 }}>
          <span style={{ fontSize: "0.75rem", color: "rgba(230,238,247,0.7)" }}>Fish count: <strong>{fishCount}</strong></span>
          <input type="range" min={0} max={20} value={fishCount} onChange={(e) => setFishCount(Number(e.target.value))} />
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <span style={{ fontSize: "0.75rem", color: "rgba(230,238,247,0.7)" }}>Water type</span>
          <div style={{ display: "flex", gap: "0.35rem" }}>
            {TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setTankType(t.value)}
                style={{
                  padding: "0.35rem 0.65rem",
                  fontSize: "0.75rem",
                  borderRadius: 8,
                  cursor: "pointer",
                  border: tankType === t.value ? "1px solid #38bdf8" : "1px solid rgba(255,255,255,0.12)",
                  background: tankType === t.value ? "rgba(56,189,248,0.15)" : "transparent",
                  color: tankType === t.value ? "#7dd3fc" : "rgba(230,238,247,0.7)",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Card + Strip row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "2rem" }}>
        <section>
          <SectionTitle>Card variant (Casual gallery)</SectionTitle>
          <LivingTank tank={tank} health={health} variant="card" fishbaseData={MOCK_SPECIES} />
        </section>
        <section>
          <SectionTitle>Strip variant (Pro ops row)</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <LivingTank tank={tank} health={health} variant="strip" fishbaseData={MOCK_SPECIES} />
            <LivingTank
              tank={{ ...tank, name: "Grow-Out 2", tankType: TYPE_CYCLE[(TYPE_CYCLE.indexOf(tankType) + 1) % TYPE_CYCLE.length], volumeLiters: 50 }}
              health={{ status: "drifting", ambient: livingTankAmbient(55) }}
              variant="strip"
              fishbaseData={MOCK_SPECIES}
            />
            <LivingTank
              tank={{ ...tank, name: "Quarantine", tankType: TYPE_CYCLE[(TYPE_CYCLE.indexOf(tankType) + 2) % TYPE_CYCLE.length], volumeLiters: 38 }}
              health={{ status: "alert", ambient: livingTankAmbient(25) }}
              variant="strip"
              fishbaseData={MOCK_SPECIES}
            />
          </div>
        </section>
      </div>

      {/* Hero */}
      <section style={{ marginBottom: "2rem" }}>
        <SectionTitle>Hero variant (detail view)</SectionTitle>
        <LivingTank tank={tank} health={health} variant="hero" fishbaseData={MOCK_SPECIES} />
      </section>

      {/* Health comparison strip */}
      <section>
        <SectionTitle>Ambient response — same tank, three health states</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
          {[
            { label: "Healthy (85)", s: 85 },
            { label: "Drifting (52)", s: 52 },
            { label: "Alert (20)", s: 20 },
          ].map((c) => (
            <div key={c.label}>
              <div style={{ fontSize: "0.72rem", color: "rgba(230,238,247,0.6)", marginBottom: "0.4rem" }}>{c.label}</div>
              <LivingTank
                tank={tank}
                health={{ status: livingTankAmbient(c.s).status, ambient: livingTankAmbient(c.s) }}
                variant="card"
                fishbaseData={MOCK_SPECIES}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Casual Tank Gallery — the live Task 5 surface, fed mock tanks */}
      <section style={{ marginTop: "2rem" }}>
        <SectionTitle>Casual Tank Gallery (live component · mock tanks · varying health)</SectionTitle>
        {tapped && (
          <p style={{ fontSize: "0.75rem", color: "#7dd3fc", margin: "0 0 0.5rem" }}>
            Tapped <strong>{tapped}</strong> — opens the detail panel in the real app.
          </p>
        )}
        <CasualTankGallery
          tanks={GALLERY_TANKS}
          fishbaseData={MOCK_SPECIES}
          onOpen={(t) => setTapped(t.name)}
        />
      </section>

      {/* Pro Fish Room Operations grid — cross-tank, needs-attention first + worklist */}
      <section style={{ marginTop: "2rem" }}>
        <SectionTitle>Pro Fish Room Operations grid (live component · worklist + needs-attention sort)</SectionTitle>
        <ProOpsGrid
          tanks={GALLERY_TANKS}
          fishbaseData={MOCK_SPECIES}
          onOpen={(t) => setTapped(t.name)}
          onLogDue={(kind, ids) => setTapped(`worklist: ${kind} × ${ids.length}`)}
          schedulesOverride={PREVIEW_SCHEDULES}
        />
      </section>

      {/* Species Care Guide — the knowledge layer (what your fish need) */}
      <section style={{ marginTop: "2rem", maxWidth: 560 }}>
        <SectionTitle>Species Care Guide (knowledge layer · care needs per species)</SectionTitle>
        <SpeciesCareGuide tank={GALLERY_TANKS[0]} fishbaseData={MOCK_SPECIES} contractSpecies={PREVIEW_CONTRACT_SPECIES} />
      </section>

      {/* Care Coach — the habit engine, one per health scenario */}
      <section style={{ marginTop: "2rem", maxWidth: 560 }}>
        <SectionTitle>Care Coach (habit engine · reads health + recency)</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <CareCoach tank={GALLERY_TANKS[2]} onAction={(k) => setTapped(`coach: ${k}`)} />
          <CareCoach tank={{ ...GALLERY_TANKS[0], latestTestTimestamp: NOW - 9 * 86400 }} onAction={(k) => setTapped(`coach: ${k}`)} />
          <CareCoach tank={GALLERY_TANKS[0]} onAction={(k) => setTapped(`coach: ${k}`)} />
        </div>
      </section>

      {/* Parameter trends — sparklines with safe-envelope bands */}
      <section style={{ marginTop: "2rem" }}>
        <SectionTitle>Parameter trends (live component · envelope bands · mock readings)</SectionTitle>
        <ParamTrends tank={GALLERY_TANKS[0]} readingsOverride={MOCK_READINGS} />
      </section>

      {/* Casual Journal timeline — health ring header + photo-first story */}
      <section style={{ marginTop: "2rem", maxWidth: 560 }}>
        <SectionTitle>Casual Journal timeline (live component · health ring + mock story)</SectionTitle>
        <JournalTimeline tank={GALLERY_TANKS[1]} entriesOverride={MOCK_JOURNAL} />
      </section>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h2 style={{ fontSize: "0.8rem", fontWeight: 600, color: "rgba(230,238,247,0.75)", margin: "0 0 0.6rem", letterSpacing: "0.02em" }}>
      {children}
    </h2>
  );
}
