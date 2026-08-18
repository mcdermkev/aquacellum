import React, { useEffect, useMemo, useRef, useState } from "react";
import { TankFishVisualization } from "../TankFishVisualization";
import { scoreToAmbient } from "../../utils/tankHealth";
import { tankTypeLabel } from "../../utils/tankUtils";
import { useUnitPrefs } from "../../hooks/useUnitPrefs";
import { formatVolume } from "../../utils/units";
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

// Water-column gradients per tank type. Saltwater (1) is removed from the
// product; any legacy index falls back to the Freshwater gradient below.
const TYPE_WATER = {
  0: ["#2183c0", "#0f4d78", "#082f4a"], // Freshwater — blue
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
  const fishCount = specimens.length;

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
      aria-label={`${tank?.name || "Tank"} — ${typeName}, ${fishCount} fish, water status ${ambient.status}`}
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
            specimens={specimens}
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
                <span style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.7rem" }}>
                  {typeName} · {volumeLabel} · {fishCount} fish
                </span>
              )}
            </div>
            {variant === "strip" && (
              <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.72rem", whiteSpace: "nowrap" }}>
                {fishCount} fish · {volumeLabel}
              </span>
            )}
          </div>
        </div>
      )}
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
