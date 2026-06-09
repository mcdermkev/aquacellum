import React, { useState, useEffect, useRef } from "react";

/**
 * CompanionFishEntity — Animated Breeder Companion Fish
 * 
 * Floats inside the tank detail panel, responds to Poseidon reaction events,
 * evolves visually based on companion XP tier (Bronze → God-Tier).
 * Respects prefers-reduced-motion.
 */
export function CompanionFishEntity({ 
  tier, 
  companionXp = 500, 
  mood = "calm", 
  glow = false, 
  swimSpeedMultiplier = 1.0,
  onClick, 
  onReactionComplete 
}) {
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [dir, setDir] = useState(1); // 1 = right, -1 = left
  const requestRef = useRef();
  const stateRef = useRef({ x: 50, y: 50, dir: 1, vx: 0.8, vy: 0.3 });
  const containerRef = useRef(null);

  // Local state overrides for incoming Poseidon event triggers
  const [localMood, setLocalMood] = useState(mood);
  const [localGlow, setLocalGlow] = useState(glow);
  const [localSpeed, setLocalSpeed] = useState(swimSpeedMultiplier);
  const [localGlowColor, setLocalGlowColor] = useState("");
  const timeoutRef = useRef(null);

  useEffect(() => {
    setLocalMood(mood);
  }, [mood]);

  useEffect(() => {
    setLocalGlow(glow);
  }, [glow]);

  useEffect(() => {
    setLocalSpeed(swimSpeedMultiplier);
  }, [swimSpeedMultiplier]);

  useEffect(() => {
    const handleReaction = (e) => {
      const reaction = e.detail;
      if (!reaction) return;

      console.log("[Echo Companion] Received Poseidon reaction trigger:", reaction);
      
      if (reaction.mood) setLocalMood(reaction.mood);
      if (reaction.glowActive !== undefined) setLocalGlow(reaction.glowActive);
      if (reaction.swimSpeedMultiplier !== undefined) setLocalSpeed(reaction.swimSpeedMultiplier);
      if (reaction.glowColor !== undefined) setLocalGlowColor(reaction.glowColor);

      // Clear any active reaction timeout to avoid overlaps
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Revert back to baseline state after durationMs
      if (reaction.durationMs) {
        timeoutRef.current = setTimeout(() => {
          setLocalMood(mood);
          setLocalGlow(glow);
          setLocalSpeed(swimSpeedMultiplier);
          setLocalGlowColor("");
        }, reaction.durationMs);
      }
    };

    window.addEventListener("poseidon:echo-reaction", handleReaction);
    return () => {
      window.removeEventListener("poseidon:echo-reaction", handleReaction);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [mood, glow, swimSpeedMultiplier]);

  // Handle pointer interactions smoothly
  const handleEntityClick = (e) => {
    console.log(`[Echo Companion] Clicked! Current mood: ${localMood}, XP: ${companionXp}`);
    if (onClick) onClick(e);
    if (onReactionComplete) onReactionComplete();
  };

  // Map incoming dynamic mood parameters to vector speed variations
  const dynamicSpeedModifier = localSpeed * (localMood === "excited" ? 1.6 : localMood === "happy" ? 1.2 : 1.0);

  const speedMultiplier = (() => {
    const xp = companionXp || 0;
    if (xp < 1500) return 0.7;
    if (xp < 2500) return 1.0;
    if (xp < 5000) return 1.3;
    if (xp < 10000) return 1.6;
    if (tier === "God-Tier") return 2.0;
    return 1.8; // Master
  })();

  const totalSpeedMultiplier = speedMultiplier * dynamicSpeedModifier;

  useEffect(() => {
    // Randomize initial speeds
    stateRef.current.vx = (0.5 + Math.random() * 0.8) * stateRef.current.dir;
    stateRef.current.vy = (Math.random() - 0.5) * 0.5;
  }, [tier, companionXp]);

  useEffect(() => {
    // Respect reduced motion preference — disable swimming animation
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const animate = () => {
      const state = stateRef.current;
      const container = containerRef.current;
      
      let maxX = 260;
      let maxY = 120;
      if (container && container.parentElement) {
        const parentW = container.parentElement.clientWidth;
        const parentH = container.parentElement.clientHeight;
        if (parentW > 0) maxX = parentW - 50;
        if (parentH > 0) maxY = parentH - 30;
      }
      
      // Update coordinates
      state.x += state.vx * totalSpeedMultiplier;
      state.y += state.vy * totalSpeedMultiplier;

      // Bounding box checks
      if (state.x > maxX) {
        state.x = maxX;
        state.dir = -1;
        state.vx = -Math.abs(state.vx);
      } else if (state.x < 10) {
        state.x = 10;
        state.dir = 1;
        state.vx = Math.abs(state.vx);
      }

      if (state.y > maxY) {
        state.y = maxY;
        state.vy = -Math.abs(state.vy);
      } else if (state.y < 10) {
        state.y = 10;
        state.vy = Math.abs(state.vy);
      }

      // Slightly alter vertical speed occasionally
      if (Math.random() < 0.02) {
        state.vy = (Math.random() - 0.5) * 0.6;
      }

      setPos({ x: state.x, y: state.y });
      setDir(state.dir);

      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, [totalSpeedMultiplier]);

  // Visual Evolution Mapping Matrix
  const getFishConfig = (tier, xp) => {
    const companionXpVal = xp || 0;
    if (companionXpVal < 1500) {
      return {
        scale: 0.8,
        color: "#00e5ff", // Cyan tint
        className: "",
        style: { opacity: 0.8, filter: "drop-shadow(0 0 6px #00e5ff)" }
      };
    } else if (companionXpVal < 2500) {
      return {
        scale: 1.0,
        color: "#cd7f32", // Bronze
        className: "",
        style: { filter: "drop-shadow(0 0 8px rgba(205, 127, 50, 0.7))" }
      };
    } else if (companionXpVal < 5000) {
      return {
        scale: 1.3,
        color: "#a0bec5", // Silver
        className: "",
        style: { filter: "drop-shadow(0 0 10px #38bdf8)" }
      };
    } else if (companionXpVal < 10000) {
      return {
        scale: 1.6,
        color: "#fbbf24", // Gold
        className: "",
        style: { filter: "drop-shadow(0 0 12px #fbbf24)" }
      };
    } else if (tier === "God-Tier") {
      return {
        scale: 2.5,
        color: "#ff6b35", // Koi-orange
        className: "animate-god-pulse",
        style: {}
      };
    } else { // Master
      return {
        scale: 2.0,
        color: "#d500f9", // Purple
        className: "",
        style: { filter: "drop-shadow(0 0 15px #d500f9)" }
      };
    }
  };

  const config = getFishConfig(tier, companionXp);

  // High-fidelity styling overrides ensuring click accessibility and glows
  const entityStyle = {
    position: "absolute",
    left: 0,
    top: 0,
    transform: `translate(${pos.x}px, ${pos.y}px) scale(${config.scale}) scaleX(${dir})`,
    transformOrigin: "center",
    zIndex: 1,
    pointerEvents: "auto",
    cursor: "pointer",
    transition: "transform 0.016s linear, opacity 0.4s ease, filter 0.4s ease",
    filter: localGlow 
      ? `drop-shadow(0 0 12px ${localGlowColor || (localMood === "excited" ? "#38bdf8" : "#a855f7")})` 
      : (config.style?.filter || "none"),
    opacity: localMood === "confused" ? 0.7 : (config.style?.opacity || 1.0)
  };

  return (
    <div
      ref={containerRef}
      className={`${config.className} companion-fish-container mood-${localMood}`}
      style={entityStyle}
      onClick={handleEntityClick}
    >
      <style>{`
        @keyframes godPulse {
          0% {
            filter: drop-shadow(0 0 10px rgba(255, 107, 53, 0.7));
          }
          50% {
            filter: drop-shadow(0 0 25px rgba(255, 107, 53, 1));
          }
          100% {
            filter: drop-shadow(0 0 10px rgba(255, 107, 53, 0.7));
          }
        }
        .animate-god-pulse {
          animation: godPulse 2s infinite ease-in-out;
        }
      `}</style>
      {tier === "God-Tier" ? (
        <svg width="40" height="25" viewBox="0 0 40 25" fill="none">
          {/* Barbels (Koi whiskers) */}
          <path d="M38 10C42 9 43 7 43 7" stroke={config.color} strokeWidth="0.75" strokeLinecap="round" />
          <path d="M38 15C42 16 43 18 43 18" stroke={config.color} strokeWidth="0.75" strokeLinecap="round" />
          {/* Flowy majestic trailing tail fins */}
          <path d="M5 12.5C1 5 0 2 0 0C1 6 3 10 5 12.5C3 15 1 19 0 25C0 23 1 20 5 12.5Z" fill={config.color} opacity="0.95" />
          <path d="M3 12.5C-1 7 -2 4 -2 2C-1 8 1 11 3 12.5C1 14 -1 17 -2 23C-2 21 -1 18 3 12.5Z" fill="#ffaa00" opacity="0.8" />
          {/* God-tier transformed body */}
          <path d="M40 12.5C35 17 28 20 22 20C15 20 10 16 5 12.5C10 9 15 5 22 5C28 5 35 8 40 12.5Z" fill={config.color} />
          {/* Koi white/black patches */}
          <path d="M26 6C23 6 20 8 18 10C21 11 25 9 26 6Z" fill="#ffffff" opacity="0.9" />
          <path d="M15 12C13 14 11 15 9 14C11 16 14 17 16 15C16 13 15 12 15 12Z" fill="#111111" opacity="0.95" />
          <path d="M30 14C28 15 26 15 24 13C25 11 28 12 30 14Z" fill="#ffffff" opacity="0.9" />
          {/* Dorsal flowy fin */}
          <path d="M25 5.5C19 0.5 12 0.5 9 3.5C14 3.5 18 4.5 25 5.5Z" fill={config.color} />
          <path d="M22 5.5C17 1.5 11 1.5 8 3.5C12 3.5 16 4.5 22 5.5Z" fill="#ffaa00" opacity="0.85" />
          <circle cx="34" cy="10.5" r="1.5" fill="#000" />
          <circle cx="34.5" cy="10" r="0.5" fill="#fff" />
        </svg>
      ) : (
        <svg width="40" height="25" viewBox="0 0 40 25" fill="none">
          <path d="M5 12.5L0 7.5V17.5L5 12.5Z" fill={config.color} />
          <path d="M40 12.5C35 17 28 20 22 20C15 20 10 16 5 12.5C10 9 15 5 22 5C28 5 35 8 40 12.5Z" fill={config.color} />
          <circle cx="32" cy="11.5" r="1.5" fill="#000" />
        </svg>
      )}
    </div>
  );
}
