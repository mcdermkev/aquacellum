import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  getSpeciesVisual,
  getFishSVGPaths,
  getFinAccentPath,
} from "../utils/fishVisualMapping";

/**
 * TankFishVisualization — Renders animated SVG fish for each specimen in a tank.
 *
 * Each fish is drawn with species-accurate colors, body shape, and relative size
 * derived from FishBase data. Fish swim independently with randomized paths
 * using a single requestAnimationFrame loop for performance.
 *
 * Props:
 * - specimens: array of specimen objects from tank.specimens (must have speciesId, commonName, scientificName)
 * - fishbaseData: array of FishBase species objects (from useSpeciesData hook)
 * - maxVisible: cap on rendered fish (default 15) for performance
 * - containerWidth: width of the container in px (default 100% of parent)
 * - containerHeight: height of the container in px (default 200)
 */

const MAX_FISH_DEFAULT = 15;
const PADDING = 12; // px from edges

export function TankFishVisualization({
  specimens = [],
  fishbaseData = [],
  maxVisible = MAX_FISH_DEFAULT,
  containerWidth,
  containerHeight = 180,
  speedMultiplier = 1,
}) {
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const fishStateRef = useRef([]);
  const [fishPositions, setFishPositions] = useState([]);

  // Check reduced motion preference
  const prefersReducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  // Build fish visual configs from specimens + fishbase data
  const fishConfigs = useMemo(() => {
    if (!specimens.length) return [];

    // Take up to maxVisible specimens (skip batch placeholders)
    const visibleSpecimens = specimens
      .filter((s) => !s.isBatchPlaceholder && Number(s.status) === 0)
      .slice(0, maxVisible);

    return visibleSpecimens.map((specimen, index) => {
      // Find matching FishBase species data
      const speciesData = fishbaseData.find(
        (fb) =>
          fb.specCode === specimen.speciesId ||
          fb.commonName === specimen.commonName ||
          fb.scientificName === specimen.scientificName
      );

      const visual = getSpeciesVisual(speciesData || { family: "", maxLengthCm: 5 });
      const svgPaths = getFishSVGPaths(visual.bodyShape);
      const finAccent = getFinAccentPath(visual.finStyle);

      return {
        id: specimen.id || index,
        commonName: specimen.commonName || "Unknown Fish",
        visual,
        svgPaths,
        finAccent,
        // Unique seed for initial position/phase randomization
        seed: index * 137.5 + (specimen.speciesId || 0) * 73.1,
      };
    });
  }, [specimens, fishbaseData, maxVisible]);

  // Initialize fish positions and movement state
  useEffect(() => {
    if (!fishConfigs.length) {
      fishStateRef.current = [];
      setFishPositions([]);
      return;
    }

    const w = containerWidth || (containerRef.current?.clientWidth || 300);
    const h = containerHeight;

    const states = fishConfigs.map((config, i) => {
      const seed = config.seed;
      // Pseudo-random from seed
      const pseudoRand = (offset) => {
        const x = Math.sin(seed + offset) * 10000;
        return x - Math.floor(x);
      };

      const startX = PADDING + pseudoRand(1) * (w - PADDING * 2 - 40);
      const startY = PADDING + pseudoRand(2) * (h - PADDING * 2 - 20);
      const dir = pseudoRand(3) > 0.5 ? 1 : -1;
      const baseSpeed = config.visual.swimSpeed * speedMultiplier;

      return {
        x: startX,
        y: startY,
        dir,
        vx: (0.3 + pseudoRand(4) * 0.5) * dir * baseSpeed,
        vy: (pseudoRand(5) - 0.5) * 0.3 * baseSpeed,
        phase: pseudoRand(6) * Math.PI * 2,
        // Occasional direction jitter timer
        nextJitterTime: 1000 + pseudoRand(7) * 3000,
        jitterAccum: 0,
      };
    });

    fishStateRef.current = states;
    setFishPositions(states.map((s) => ({ x: s.x, y: s.y, dir: s.dir })));
  }, [fishConfigs, containerWidth, containerHeight, speedMultiplier]);

  // Animation loop
  useEffect(() => {
    if (prefersReducedMotion || !fishConfigs.length) return;

    let lastTime = performance.now();

    const animate = (now) => {
      const dt = Math.min(now - lastTime, 50); // cap delta to avoid jumps
      lastTime = now;

      const w = containerWidth || (containerRef.current?.clientWidth || 300);
      const h = containerHeight;
      const states = fishStateRef.current;
      let needsUpdate = false;

      for (let i = 0; i < states.length; i++) {
        const s = states[i];
        const config = fishConfigs[i];
        if (!config) continue;

        const speed = config.visual.swimSpeed * speedMultiplier;
        const scaleFactor = dt / 16; // normalize to ~60fps

        // Update position
        s.x += s.vx * scaleFactor;
        s.y += s.vy * scaleFactor;

        // Boundary checks with direction reversal
        const fishWidth = 40 * config.visual.relativeScale;
        const fishHeight = 25 * config.visual.relativeScale;

        if (s.x > w - PADDING - fishWidth) {
          s.x = w - PADDING - fishWidth;
          s.dir = -1;
          s.vx = -Math.abs(s.vx);
        } else if (s.x < PADDING) {
          s.x = PADDING;
          s.dir = 1;
          s.vx = Math.abs(s.vx);
        }

        if (s.y > h - PADDING - fishHeight) {
          s.y = h - PADDING - fishHeight;
          s.vy = -Math.abs(s.vy) * 0.8;
        } else if (s.y < PADDING) {
          s.y = PADDING;
          s.vy = Math.abs(s.vy) * 0.8;
        }

        // Occasional vertical jitter for natural movement
        s.jitterAccum += dt;
        if (s.jitterAccum > s.nextJitterTime) {
          s.jitterAccum = 0;
          s.nextJitterTime = 1500 + Math.random() * 3000;
          s.vy = (Math.random() - 0.5) * 0.4 * speed;
          // Slight horizontal speed variation
          const absVx = Math.abs(s.vx);
          s.vx = s.dir * (0.3 + Math.random() * 0.5) * speed;
        }

        needsUpdate = true;
      }

      if (needsUpdate) {
        setFishPositions(states.map((s) => ({ x: s.x, y: s.y, dir: s.dir })));
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [fishConfigs, prefersReducedMotion, containerWidth, containerHeight, speedMultiplier]);

  if (!fishConfigs.length) return null;

  return (
    <div
      ref={containerRef}
      className="tank-fish-visualization"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 2,
      }}
      aria-hidden="true"
    >
      {fishConfigs.map((config, index) => {
        const pos = fishPositions[index];
        if (!pos) return null;

        return (
          <FishSVG
            key={config.id}
            config={config}
            x={pos.x}
            y={pos.y}
            dir={pos.dir}
            reducedMotion={prefersReducedMotion}
          />
        );
      })}
    </div>
  );
}

/**
 * Individual fish SVG — memoized for performance.
 */
const FishSVG = React.memo(function FishSVG({ config, x, y, dir, reducedMotion }) {
  const { visual, svgPaths, finAccent } = config;
  const { colors, relativeScale } = visual;

  const size = relativeScale;
  const width = 40 * size;
  const height = 25 * size;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: `translate(${x}px, ${y}px) scaleX(${dir})`,
        width: `${width}px`,
        height: `${height}px`,
        transition: reducedMotion ? "none" : "transform 0.06s linear",
        opacity: 0.9,
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox="0 0 40 25"
        fill="none"
        style={{ display: "block" }}
      >
        {/* Tail fin */}
        <path d={svgPaths.tailPath} fill={colors.secondary} opacity="0.9" />

        {/* Body with gradient */}
        <defs>
          <linearGradient
            id={`body-grad-${config.id}`}
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor={colors.accent} />
            <stop offset="50%" stopColor={colors.primary} />
            <stop offset="100%" stopColor={colors.secondary} />
          </linearGradient>
        </defs>
        <path
          d={svgPaths.bodyPath}
          fill={`url(#body-grad-${config.id})`}
        />

        {/* Dorsal fin */}
        <path d={svgPaths.dorsalPath} fill={colors.secondary} opacity="0.85" />

        {/* Fin accent (pectoral/ventral) */}
        <path d={finAccent} fill={colors.accent} opacity="0.7" />

        {/* Eye */}
        <circle
          cx={svgPaths.eyePosition.cx}
          cy={svgPaths.eyePosition.cy}
          r="1.4"
          fill="#000"
        />
        <circle
          cx={svgPaths.eyePosition.cx + 0.4}
          cy={svgPaths.eyePosition.cy - 0.3}
          r="0.5"
          fill="#fff"
        />
      </svg>
    </div>
  );
});
