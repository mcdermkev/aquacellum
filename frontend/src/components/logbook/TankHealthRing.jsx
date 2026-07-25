import React from "react";

/**
 * TankHealthRing — compact SVG status ring driven by deriveTankHealth (Task 5).
 * Shows the tank's health at a glance: a colored arc proportional to the health
 * score, with a status word. Used in the Casual journal header (and reusable in
 * the detail hero).
 *
 * Props:
 *   health — the object returned by deriveTankHealth ({ score, status, flags })
 *   size   — pixel diameter (default 56)
 *   label  — show the status word beside the ring (default true)
 */
export function TankHealthRing({ health, size = 56, label = true }) {
  const score = Math.max(0, Math.min(100, Number(health?.score ?? 70)));
  const status = health?.status || "ok";
  const color = status === "ok" ? "#34d399" : status === "drifting" ? "#fbbf24" : "#f87171";
  const statusWord = status === "ok" ? "Thriving" : status === "drifting" ? "Needs a look" : "Needs care";

  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (score / 100) * c;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flexShrink: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 0.6s ease, stroke 0.6s ease" }}
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          fill="#fff"
          fontSize={size * 0.3}
          fontWeight="700"
        >
          {Math.round(score)}
        </text>
      </svg>
      {label && (
        <div style={{ minWidth: 0 }}>
          <div style={{ color, fontWeight: 700, fontSize: "0.9rem" }}>{statusWord}</div>
          {health?.flags?.length > 0 && (
            <div style={{ color: "var(--text-muted, #94a3b8)", fontSize: "0.72rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
              {health.flags[0]}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
