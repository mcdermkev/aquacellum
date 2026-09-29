import React, { useEffect, useMemo, useRef, useState } from "react";
import { TankFishVisualization } from "../TankFishVisualization";
import { scoreToAmbient } from "../../utils/tankHealth";
import { tankTypeLabel } from "../../utils/tankUtils";
import { useUnitPrefs } from "../../hooks/useUnitPrefs";
import { formatVolume } from "../../utils/units";
import { countInhabitants, inhabitantKind, inhabitantSummary, speciesRecordFor, swimmingInhabitants } from "./inhabitants";
import "./LivingTank.css";

/**
 * LivingTank — Task 3 prototype (Living Tank visual engine).
 *
 * Renders a tank as an actual aquarium: tank-type-tinted water column,
 * substrate, plant/décor silhouettes, drifting caustics, rising bubbles,
 * surface shimmer, a swimming-fish layer (reusing TankFishVisualization),
 * and a glass front. The water communicates health via an ambient object:
 *   - clarity   (0..1) — higher = clearer water, less haze
 *   - tint      (0..1) — higher = greener/murkier
 *   - liveliness(0..1) — higher = fish swim faster
 *
 * Performance guards:
 *   - fish capped per variant (maxFish)
 *   - animation loop + CSS animations pause when offscreen (IntersectionObserver)
 *   - prefers-reduced-motion → static rendering (no rAF, no keyframes)
 *
 * Props:
 *   tank         — { name, tankType, volumeLiters, specimens, facility, room, rack }
 *   health       — { status, ambient: { clarity, tint, liveliness } }
 *   variant      — "card" | "hero" | "strip"
 *   fishbaseData — species data for fish visuals (optional)
 *   photoUrl     — optional background photo (behind the water tint)
 *   showLabel    — render the frosted stat label (default true)
 */

// Water-column gradients per tank type. Unknown indices fall back to Freshwater.
const TYPE_WATER = {
  0: ["#2183c0", "#0f4d78", "#082f4a"], // Freshwater — blue
  1: ["#1fb6d8", "#0a6f9e", "#063d63"], // Saltwater — bright reef cyan
  2: ["#7a8a3f", "#4a5722", "#232b12"], // Brackish — tannin green/amber
  3: ["#3f9a68", "#236641", "#123723"], // Pond — green
};

const VARIANT = {
  card:  { height: 168, maxFish: 6,  fishHeight: 130, bubbles: 5, plants: true },
  hero:  { height: 248, maxFish: 12, fishHeight: 210, bubbles: 8, plants: true },
  strip: { height: 48,  maxFish: 4,  fishHeight: 44,  bubbles: 0, plants: false },
};

/**
 * Map a 0..100 health score to an ambient water state. Canonical implementation
 * now lives in utils/tankHealth (shared with the deriveTankHealth selector);
 * re-exported here so existing importers (e.g. LivingTankPreview) keep working.
 */
export const livingTankAmbient = scoreToAmbient;

function usePrefersReducedMotion() {
  return useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );
}

export function LivingTank({
  tank,
  health,
  variant = "card",
  fishbaseData = [],
  photoUrl,
  showLabel = true,
  height,
}) {
  const cfg = VARIANT[variant] || VARIANT.card;
  const rootHeight = height != null ? height : cfg.height;
  // Fish are distributed across `fishHeight` px vertically (see
  // TankFishVisualization); it must track the tank's ACTUAL visible height or
  // fish end up positioned below a short container (e.g. the 40px Pro ops-grid
  // strip) and get clipped, leaving the water looking empty. The chrome
  // allowance is small for the strip (no label) and larger for card/hero.
  const chromeAllowance = variant === "strip" ? 6 : 38;
  const fishHeight = typeof height === "number"
    ? Math.max(24, height - chromeAllowance)
    : cfg.fishHeight;
  const rootRef = useRef(null);
  const [inView, setInView] = useState(true);
  const reducedMotion = usePrefersReducedMotion();

  const ambient = health?.ambient || livingTankAmbient(70);
  const type = Number(tank?.tankType ?? 0);
  const typeName = tankTypeLabel(type);
  const [top, mid, bottom] = TYPE_WATER[type] || TYPE_WATER[0];

  // Pause everything when scrolled offscreen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.05 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const animate = inView && !reducedMotion;
  const specimens = (tank?.specimens || []).filter((s) => Number(s?.status ?? 0) === 0);
  // Only fish swim. Corals sit on the rock and inverts on the sand; drawing a
  // zoanthid as a grey fish silhouette was the most visible saltwater bug.
  const swimmers = swimmingInhabitants(specimens, fishbaseData);
  const corals = specimens.filter((s) => inhabitantKind(s, fishbaseData) === "coral");
  const summary = inhabitantSummary(countInhabitants(tank, fishbaseData));
  const fishCount = swimmers.length;

  // Volume respects the user's unit preference. This line is the one a new keeper
  // asked about: they typed "20" into a field labelled gallons and the card read
  // "76L", because storage is litres (correctly) and the display was hardcoded to
  // match storage rather than the entry unit.
  const { volumeUnit } = useUnitPrefs();
  const volumeLabel = tank?.volumeLiters != null ? formatVolume(tank.volumeLiters, volumeUnit) : "--";

  const waterBg = `linear-gradient(to bottom, ${top} 0%, ${mid} 55%, ${bottom} 100%)`;
  const hazeOpacity = (1 - ambient.clarity) * 0.85;
  const tintOpacity = ambient.tint * 0.6;
  const fishOpacity = 0.55 + 0.45 * ambient.clarity;
  const fishBlur = ambient.clarity < 0.5 ? (0.5 - ambient.clarity) * 3 : 0;

  return (
    <div
      ref={rootRef}
      className={`lt-root lt-${variant}${animate ? " lt--animate" : ""}`}
      style={{ height: rootHeight }}
      role="img"
      aria-label={`${tank?.name || "Tank"}: ${typeName}, ${summary}, water status ${ambient.status}`}
      data-testid="living-tank"
      data-status={ambient.status}
      data-animated={animate ? "true" : "false"}
    >
      {/* Water column (+ optional photo behind it) */}
      <div
        className="lt-water"
        style={{
          background: photoUrl
            ? `${waterBg}`
            : waterBg,
        }}
      >
        {photoUrl && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `url('${photoUrl}')`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              // Show the keeper's actual photo clearly. It used to render at
              // opacity 0.35 with mix-blend luminosity, which washed a real tank
              // photo out to a near-invisible ghost in casual (it looked fine in
              // pro, which paints the photo at full opacity). The surface
              // shimmer, caustics and fish layers still sit on top for the
              // "living" effect.
              opacity: 0.92,
            }}
          />
        )}
      </div>

      {/* Surface shimmer */}
      <div className="lt-surface" />

      {/* Caustic light bands */}
      <div className="lt-caustic" />
      <div className="lt-caustic lt-caustic-2" />

      {/* Fish layer — unmounted when offscreen so its rAF loop stops */}
      {inView && fishCount > 0 && (
        <div
          className="lt-fish"
          data-max-fish={cfg.maxFish}
          style={{ opacity: fishOpacity, filter: fishBlur ? `blur(${fishBlur}px)` : "none" }}
        >
          <TankFishVisualization
            specimens={swimmers}
            fishbaseData={fishbaseData}
            maxVisible={cfg.maxFish}
            containerHeight={fishHeight}
            speedMultiplier={0.35 + ambient.liveliness}
          />
        </div>
      )}

      {/* Plants / décor */}
      {cfg.plants && (
        <svg className="lt-plants" viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
          <g fill="rgba(6, 30, 18, 0.75)">
            <path className="lt-plant lt-plant-a" d="M40 100 C30 70 55 55 42 25 C60 50 52 78 60 100 Z" />
            <path className="lt-plant lt-plant-b" d="M70 100 C64 74 84 60 74 34 C92 58 82 82 92 100 Z" />
            <path className="lt-plant lt-plant-c" d="M240 100 C232 66 258 52 246 22 C268 50 256 80 266 100 Z" />
            <path className="lt-plant lt-plant-a" d="M210 100 C204 78 220 66 212 44 C228 64 220 84 228 100 Z" />
          </g>
          <g fill="rgba(120, 90, 40, 0.5)">
            <path d="M150 100 C146 88 150 80 152 72 C156 82 154 92 158 100 Z" />
            <path d="M162 100 C160 90 164 84 168 78 C168 88 166 94 172 100 Z" />
          </g>
        </svg>
      )}

      {/* Substrate */}
      <div className="lt-substrate" />

      {/* Corals on the rock line (reef tanks) */}
      {corals.length > 0 && variant !== "strip" && (
        <CoralLayer corals={corals} fishbaseData={fishbaseData} max={variant === "hero" ? 8 : 5} />
      )}

      {/* Bubbles */}
      {cfg.bubbles > 0 && (
        <div className="lt-bubbles" aria-hidden="true">
          {Array.from({ length: cfg.bubbles }).map((_, i) => (
            <span
              key={i}
              className="lt-bubble"
              style={{
                left: `${8 + (i * 83) % 84}%`,
                animationDuration: `${4 + (i % 4)}s`,
                animationDelay: `${(i * 0.9) % 4}s`,
                width: `${3 + (i % 3)}px`,
                height: `${3 + (i % 3)}px`,
              }}
            />
          ))}
        </div>
      )}

      {/* Health tint + haze (murk) */}
      <div className="lt-tint" style={{ opacity: tintOpacity }} />
      {hazeOpacity > 0.01 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 6,
            pointerEvents: "none",
            background: "rgba(150, 170, 110, 1)",
            opacity: hazeOpacity * 0.4,
            transition: "opacity 0.6s ease",
          }}
        />
      )}

      {/* Glass front */}
      <div className="lt-glass" />

      {/* Label / content */}
      {showLabel && (
        <div className="lt-content">
          <div className="lt-label">
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <StatusDot status={ambient.status} />
                <strong
                  style={{
                    color: "#fff",
                    fontSize: variant === "strip" ? "0.8rem" : "0.95rem",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {tank?.name || "Untitled Tank"}
                </strong>
              </div>
              {variant !== "strip" && (
                <span style={{ color: "rgba(255,255,255,0.85)", fontSize: "0.72rem" }}>
                  {typeName} · {volumeLabel} · {summary}
                </span>
              )}
            </div>
            {variant === "strip" && (
              <span style={{ color: "rgba(255,255,255,0.85)", fontSize: "0.72rem", whiteSpace: "nowrap" }}>
                {summary} · {volumeLabel}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Coral silhouettes by catalog coralType. Stylized, like the fish: the shape
// says "branching SPS" or "mushroom", not a specific morph.
const CORAL_COLORS = {
  SPS: ["#f472b6", "#c084fc"],
  LPS: ["#34d399", "#a3e635"],
  soft: ["#f9a8d4", "#fcd34d"],
  zoanthid: ["#fb923c", "#4ade80"],
  mushroom: ["#60a5fa", "#f87171"],
  anemone: ["#fda4af", "#fdba74"],
};

function CoralShape({ type, color, accent }) {
  switch (type) {
    case "SPS": // branching
      return (
        <g fill={color}>
          <rect x="18" y="12" width="4" height="28" rx="2" />
          <rect x="9" y="18" width="4" height="20" rx="2" transform="rotate(-18 11 28)" />
          <rect x="27" y="17" width="4" height="21" rx="2" transform="rotate(18 29 27)" />
          <circle cx="20" cy="12" r="2.4" fill={accent} />
        </g>
      );
    case "LPS": // fleshy tentacles
      return (
        <g fill={color}>
          {[8, 14, 20, 26, 32].map((x, i) => (
            <path key={x} d={`M${x} 40 C${x - 3} ${30 - (i % 2) * 6} ${x + 3} ${22 - (i % 3) * 3} ${x} ${16 + (i % 2) * 4}`} stroke={color} strokeWidth="3.4" fill="none" strokeLinecap="round" />
          ))}
          {[8, 14, 20, 26, 32].map((x, i) => <circle key={`t${x}`} cx={x} cy={16 + (i % 2) * 4} r="2.2" fill={accent} />)}
        </g>
      );
    case "zoanthid": // polyp carpet
      return (
        <g>
          {[7, 14, 21, 28, 34].map((x, i) => (
            <g key={x}>
              <circle cx={x} cy={34 - (i % 2) * 4} r="4.2" fill={color} />
              <circle cx={x} cy={34 - (i % 2) * 4} r="1.8" fill={accent} />
            </g>
          ))}
        </g>
      );
    case "mushroom": // discs
      return (
        <g>
          <ellipse cx="14" cy="34" rx="9" ry="4.5" fill={color} />
          <ellipse cx="28" cy="30" rx="8" ry="4" fill={accent} />
        </g>
      );
    default: // soft corals, anemones: a swaying tuft
      return (
        <g fill={color}>
          <path d="M20 40 C12 30 10 20 16 12 C18 20 20 24 20 40 Z" />
          <path d="M20 40 C28 30 30 20 24 12 C22 20 20 24 20 40 Z" fill={accent} />
          <path d="M20 40 C20 28 18 18 20 8 C22 18 22 28 20 40 Z" />
        </g>
      );
  }
}

function CoralLayer({ corals, fishbaseData, max }) {
  const shown = corals.slice(0, max);
  return (
    <div className="lt-corals" aria-hidden="true">
      {shown.map((c, i) => {
        const type = speciesRecordFor(c, fishbaseData)?.marine?.coralType || "soft";
        const [color, accent] = CORAL_COLORS[type] || CORAL_COLORS.soft;
        // Spread across the rock line, alternating depth so they don't stack.
        const left = 6 + ((i * 97) % 84);
        return (
          <svg
            key={c.id ?? i}
            className="lt-coral"
            viewBox="0 0 40 42"
            style={{ left: `${left}%`, bottom: `${i % 2 ? 10 : 12}%`, width: i % 3 === 0 ? 40 : 32 }}
          >
            <CoralShape type={type} color={color} accent={accent} />
          </svg>
        );
      })}
    </div>
  );
}

function StatusDot({ status }) {
  const color = status === "ok" ? "#34d399" : status === "drifting" ? "#fbbf24" : "#f87171";
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 8px ${color}`,
        flexShrink: 0,
      }}
    />
  );
}
