import React, { useState, useEffect, useRef } from "react";

/**
 * BreederUXPolish — Premium UX micro-components for breeder tools.
 *
 * Exports:
 * - AnimatedFunnel: Animated egg→fry→alive pipeline with count-up and flowing particles
 * - ConfettiCelebration: Canvas-based confetti burst for spawn success
 * - EmptyStateIllustration: SVG illustrations for various empty states
 * - BreederSkeleton: Consistent shimmer skeleton for breeder sections
 */

// ─── Animated Funnel ────────────────────────────────────────────────────────
export function AnimatedFunnel({ eggs, fry, alive, sold, lost, survivalRate }) {
  const [animatedValues, setAnimatedValues] = useState({ eggs: 0, fry: 0, alive: 0, sold: 0, lost: 0 });
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  // Animate on mount / value change
  useEffect(() => {
    setVisible(true);
    const duration = 800;
    const start = Date.now();
    const targets = { eggs: eggs || 0, fry: fry || 0, alive: alive || 0, sold: sold || 0, lost: lost || 0 };

    const animate = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3); // easeOutCubic

      setAnimatedValues({
        eggs: Math.round(targets.eggs * ease),
        fry: Math.round(targets.fry * ease),
        alive: Math.round(targets.alive * ease),
        sold: Math.round(targets.sold * ease),
        lost: Math.round(targets.lost * ease),
      });

      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [eggs, fry, alive, sold, lost]);

  const stages = [
    { label: "Eggs", value: animatedValues.eggs, color: "#fbbf24", icon: "🥚" },
    { label: "Fry", value: animatedValues.fry, color: "#60a5fa", icon: "🐟" },
    { label: "Alive", value: animatedValues.alive, color: "#34d399", icon: "💚" },
    { label: "Sold", value: animatedValues.sold, color: "#fbbf24", icon: "💰" },
    { label: "Lost", value: animatedValues.lost, color: "#f87171", icon: "💀" },
  ];

  return (
    <div ref={ref} style={{
      display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center",
      opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(8px)",
      transition: "opacity 0.4s ease, transform 0.4s ease",
    }}>
      {stages.map((stage, i) => (
        <React.Fragment key={stage.label}>
          <div style={{ textAlign: "center", position: "relative" }}>
            <div style={{
              fontSize: "1.1rem", fontWeight: "700", color: stage.color,
              fontFamily: "'JetBrains Mono', monospace",
              transition: "color 0.3s",
            }}>
              {stage.value || "—"}
            </div>
            <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginTop: "1px", display: "flex", alignItems: "center", gap: "2px", justifyContent: "center" }}>
              <span>{stage.icon}</span> {stage.label}
            </div>
            {/* Pulse ring on non-zero values */}
            {stage.value > 0 && (
              <div style={{
                position: "absolute", inset: "-4px", borderRadius: "8px",
                border: `1px solid ${stage.color}`,
                opacity: 0.15, animation: "funnel-pulse 2s ease-in-out infinite",
                animationDelay: `${i * 0.2}s`,
              }} />
            )}
          </div>
          {i < stages.length - 1 && i < 2 && (
            <div style={{ position: "relative", width: "20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="20" height="12" viewBox="0 0 20 12">
                <path d="M2 6 L14 6 M11 3 L14 6 L11 9" fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="1.5" strokeLinecap="round">
                  <animate attributeName="opacity" values="0.3;0.8;0.3" dur="1.5s" repeatCount="indefinite" begin={`${i * 0.3}s`} />
                </path>
                {/* Flowing particle */}
                <circle r="2" fill={stages[i + 1].color} opacity="0.6">
                  <animateMotion dur="1.2s" repeatCount="indefinite" begin={`${i * 0.4}s`}>
                    <mpath xlinkHref={`#funnel-path-${i}`} />
                  </animateMotion>
                </circle>
                <path id={`funnel-path-${i}`} d="M2 6 L14 6" fill="none" />
              </svg>
            </div>
          )}
        </React.Fragment>
      ))}
      {survivalRate !== null && survivalRate !== undefined && (
        <div style={{ marginLeft: "auto", textAlign: "center" }}>
          <div style={{
            fontSize: "1.1rem", fontWeight: "700",
            color: survivalRate >= 80 ? "#34d399" : survivalRate >= 50 ? "#fbbf24" : "#f87171",
          }}>
            {survivalRate}%
          </div>
          <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Survival</div>
        </div>
      )}
      <style>{`
        @keyframes funnel-pulse {
          0%, 100% { transform: scale(1); opacity: 0.15; }
          50% { transform: scale(1.08); opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

// ─── Confetti Celebration ───────────────────────────────────────────────────
export function ConfettiCelebration({ trigger, duration = 2500 }) {
  const canvasRef = useRef(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!trigger) return;
    setActive(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const colors = ["#a78bfa", "#34d399", "#60a5fa", "#fbbf24", "#f472b6", "#e879f9"];
    const particles = [];

    for (let i = 0; i < 60; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 40,
        y: canvas.height / 2,
        vx: (Math.random() - 0.5) * 12,
        vy: -Math.random() * 10 - 4,
        size: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 10,
        gravity: 0.2 + Math.random() * 0.1,
        opacity: 1,
      });
    }

    const startTime = Date.now();
    let animId;

    const render = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed > duration) { setActive(false); return; }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const fadeProgress = Math.max(0, (elapsed - duration * 0.7) / (duration * 0.3));

      for (const p of particles) {
        p.x += p.vx;
        p.vy += p.gravity;
        p.y += p.vy;
        p.vx *= 0.98;
        p.rotation += p.rotationSpeed;
        p.opacity = Math.max(0, 1 - fadeProgress);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.4);
        ctx.restore();
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [trigger, duration]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 100,
        width: "100%", height: "100%",
      }}
    />
  );
}

// ─── Empty State Illustrations ──────────────────────────────────────────────
export function EmptyStateIllustration({ type = "spawn", size = 120 }) {
  const illustrations = {
    spawn: (
      <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
        {/* Egg shape */}
        <ellipse cx="60" cy="62" rx="28" ry="34" fill="rgba(251,191,36,0.08)" stroke="rgba(251,191,36,0.25)" strokeWidth="1.5" />
        <ellipse cx="60" cy="62" rx="18" ry="22" fill="rgba(251,191,36,0.04)" stroke="rgba(251,191,36,0.12)" strokeWidth="1" strokeDasharray="3 3" />
        {/* Sparkles */}
        <circle cx="38" cy="40" r="2" fill="rgba(167,139,250,0.4)"><animate attributeName="opacity" values="0.2;0.8;0.2" dur="2s" repeatCount="indefinite" /></circle>
        <circle cx="82" cy="48" r="1.5" fill="rgba(52,211,153,0.4)"><animate attributeName="opacity" values="0.3;0.9;0.3" dur="1.8s" repeatCount="indefinite" begin="0.5s" /></circle>
        <circle cx="72" cy="85" r="1.5" fill="rgba(96,165,250,0.4)"><animate attributeName="opacity" values="0.2;0.7;0.2" dur="2.2s" repeatCount="indefinite" begin="0.3s" /></circle>
        {/* Question mark */}
        <text x="60" y="68" textAnchor="middle" fontSize="18" fill="rgba(251,191,36,0.3)" fontWeight="bold">?</text>
      </svg>
    ),
    growout: (
      <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
        {/* Chart outline */}
        <rect x="20" y="30" width="80" height="60" rx="6" fill="rgba(96,165,250,0.04)" stroke="rgba(96,165,250,0.15)" strokeWidth="1.5" />
        {/* Grid lines */}
        <line x1="20" y1="50" x2="100" y2="50" stroke="rgba(96,165,250,0.08)" strokeWidth="0.5" />
        <line x1="20" y1="70" x2="100" y2="70" stroke="rgba(96,165,250,0.08)" strokeWidth="0.5" />
        {/* Placeholder trend line */}
        <path d="M30 75 Q50 65, 60 55 Q70 45, 90 40" fill="none" stroke="rgba(96,165,250,0.25)" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 4">
          <animate attributeName="stroke-dashoffset" values="8;0" dur="1.5s" repeatCount="indefinite" />
        </path>
        {/* Fish icon */}
        <text x="60" y="108" textAnchor="middle" fontSize="16" fill="rgba(96,165,250,0.3)">📊</text>
      </svg>
    ),
    lineage: (
      <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
        {/* Tree structure */}
        <circle cx="60" cy="30" r="10" fill="rgba(52,211,153,0.08)" stroke="rgba(52,211,153,0.25)" strokeWidth="1.5" />
        <circle cx="35" cy="70" r="8" fill="rgba(96,165,250,0.08)" stroke="rgba(96,165,250,0.25)" strokeWidth="1.5" />
        <circle cx="85" cy="70" r="8" fill="rgba(244,114,182,0.08)" stroke="rgba(244,114,182,0.25)" strokeWidth="1.5" />
        {/* Connectors */}
        <path d="M60 40 Q60 55, 43 62" fill="none" stroke="rgba(167,139,250,0.2)" strokeWidth="1.5" />
        <path d="M60 40 Q60 55, 77 62" fill="none" stroke="rgba(167,139,250,0.2)" strokeWidth="1.5" />
        {/* Labels */}
        <text x="60" y="34" textAnchor="middle" fontSize="8" fill="rgba(52,211,153,0.5)" fontWeight="bold">F0</text>
        <text x="35" y="74" textAnchor="middle" fontSize="7" fill="rgba(96,165,250,0.5)">♂</text>
        <text x="85" y="74" textAnchor="middle" fontSize="7" fill="rgba(244,114,182,0.5)">♀</text>
        {/* Animated pulse */}
        <circle cx="60" cy="30" r="10" fill="none" stroke="rgba(52,211,153,0.3)" strokeWidth="1">
          <animate attributeName="r" values="10;16;10" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
        </circle>
      </svg>
    ),
    achievements: (
      <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
        {/* Trophy */}
        <path d="M45 50 H75 L70 80 H50 Z" fill="rgba(251,191,36,0.06)" stroke="rgba(251,191,36,0.2)" strokeWidth="1.5" />
        <rect x="55" y="80" width="10" height="12" fill="rgba(251,191,36,0.04)" stroke="rgba(251,191,36,0.15)" strokeWidth="1" />
        <rect x="48" y="92" width="24" height="4" rx="2" fill="rgba(251,191,36,0.08)" stroke="rgba(251,191,36,0.15)" strokeWidth="1" />
        {/* Handles */}
        <path d="M45 55 Q35 55, 35 65 Q35 72, 45 70" fill="none" stroke="rgba(251,191,36,0.2)" strokeWidth="1.5" />
        <path d="M75 55 Q85 55, 85 65 Q85 72, 75 70" fill="none" stroke="rgba(251,191,36,0.2)" strokeWidth="1.5" />
        {/* Star */}
        <text x="60" y="70" textAnchor="middle" fontSize="14" fill="rgba(251,191,36,0.3)">★</text>
        {/* Sparkles */}
        <circle cx="40" cy="40" r="2" fill="rgba(167,139,250,0.3)"><animate attributeName="opacity" values="0;1;0" dur="1.5s" repeatCount="indefinite" /></circle>
        <circle cx="80" cy="42" r="1.5" fill="rgba(52,211,153,0.3)"><animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="indefinite" begin="0.7s" /></circle>
      </svg>
    ),
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", marginBottom: "0.75rem" }}>
      {illustrations[type] || illustrations.spawn}
    </div>
  );
}

// ─── Skeleton Loading Component ─────────────────────────────────────────────
export function BreederSkeleton({ rows = 3, type = "card" }) {
  if (type === "table") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{
            height: "42px", borderRadius: "6px",
            background: "linear-gradient(90deg, rgba(139,92,246,0.04) 25%, rgba(139,92,246,0.08) 50%, rgba(139,92,246,0.04) 75%)",
            backgroundSize: "200% 100%",
            animation: "skeleton-shimmer 1.5s ease-in-out infinite",
            animationDelay: `${i * 0.1}s`,
          }} />
        ))}
      </div>
    );
  }

  if (type === "stats") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(80px, 1fr))", gap: "0.5rem" }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{
            height: "64px", borderRadius: "8px",
            background: "linear-gradient(90deg, rgba(139,92,246,0.04) 25%, rgba(139,92,246,0.08) 50%, rgba(139,92,246,0.04) 75%)",
            backgroundSize: "200% 100%",
            animation: "skeleton-shimmer 1.5s ease-in-out infinite",
            animationDelay: `${i * 0.15}s`,
          }} />
        ))}
      </div>
    );
  }

  // Default: card skeleton
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          height: "80px", borderRadius: "12px",
          background: "linear-gradient(90deg, rgba(139,92,246,0.03) 25%, rgba(139,92,246,0.07) 50%, rgba(139,92,246,0.03) 75%)",
          backgroundSize: "200% 100%",
          animation: "skeleton-shimmer 1.5s ease-in-out infinite",
          animationDelay: `${i * 0.2}s`,
        }} />
      ))}
      <style>{`
        @keyframes skeleton-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

// ─── Success Toast with animation ───────────────────────────────────────────
export function SuccessToast({ message, visible, onDismiss }) {
  if (!visible) return null;

  return (
    <div style={{
      position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
      padding: "12px 20px", borderRadius: "12px",
      background: "rgba(15, 12, 31, 0.95)", backdropFilter: "blur(12px)",
      border: "1px solid rgba(52, 211, 153, 0.3)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4), 0 0 12px rgba(52,211,153,0.1)",
      display: "flex", alignItems: "center", gap: "10px",
      zIndex: 9999,
      animation: "toast-slide-up 0.3s ease-out",
    }}>
      <span style={{ fontSize: "1.1rem" }}>✓</span>
      <span style={{ fontSize: "0.82rem", color: "#fff", fontWeight: "500" }}>{message}</span>
      <button onClick={onDismiss} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "1rem", marginLeft: "8px" }}>×</button>
      <style>{`
        @keyframes toast-slide-up {
          from { opacity: 0; transform: translateX(-50%) translateY(12px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
}
