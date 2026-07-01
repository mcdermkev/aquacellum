import React, { useState, useMemo, useRef } from "react";

/**
 * GrowOutChart — Lightweight SVG sparkline/area chart for grow-out data.
 *
 * Visualizes fry population over time with:
 * - Area chart showing alive count trend
 * - Checkpoint markers (colored dots by type)
 * - Hover tooltip showing exact values at each point
 * - Survival rate trend line overlay
 * - Responsive width with fixed aspect ratio
 *
 * No external charting library required.
 */

const CHART_HEIGHT = 120;
const CHART_PADDING = { top: 12, right: 16, bottom: 24, left: 36 };

const CHECKPOINT_COLORS = {
  fry_count: { fill: "#60a5fa", label: "Fry Count" },
  cull: { fill: "#f87171", label: "Culled" },
  sold: { fill: "#fbbf24", label: "Sold" },
  loss: { fill: "#ef4444", label: "Loss" },
  moved: { fill: "#8b5cf6", label: "Moved" },
  note: { fill: "#6b7280", label: "Note" },
  narration: { fill: "#a78bfa", label: "Poseidon" },
};

/**
 * Build timeline data points from checkpoints.
 * Each point tracks the running "alive" count at that moment.
 */
function buildTimelineData(checkpoints, initialEggs) {
  if (!checkpoints || checkpoints.length === 0) return [];

  // Sort chronologically
  const sorted = [...checkpoints]
    .filter((c) => c.type !== "narration" && c.type !== "note")
    .sort((a, b) => a.timestamp - b.timestamp);

  if (sorted.length === 0) return [];

  let maxFry = initialEggs || 0;
  let totalLost = 0;
  let totalSold = 0;
  let totalCulled = 0;

  const points = [];

  for (const cp of sorted) {
    if (cp.type === "fry_count") {
      maxFry = Math.max(maxFry, cp.count || 0);
    } else if (cp.type === "loss") {
      totalLost += cp.count || 0;
    } else if (cp.type === "sold") {
      totalSold += cp.count || 0;
    } else if (cp.type === "cull") {
      totalCulled += cp.count || 0;
    }

    const alive = Math.max(0, maxFry - totalLost - totalSold - totalCulled);
    const survivalRate = maxFry > 0 ? Math.round(((maxFry - totalLost) / maxFry) * 100) : 100;

    points.push({
      timestamp: cp.timestamp,
      alive,
      maxFry,
      totalLost,
      totalSold,
      totalCulled,
      survivalRate,
      type: cp.type,
      count: cp.count,
      note: cp.note,
    });
  }

  return points;
}

export function GrowOutChart({ checkpoints, eggCount, spawnId }) {
  const containerRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [chartWidth, setChartWidth] = useState(320);

  // Measure container width
  React.useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        setChartWidth(containerRef.current.offsetWidth);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const data = useMemo(
    () => buildTimelineData(checkpoints, eggCount),
    [checkpoints, eggCount]
  );

  if (data.length < 2) {
    return (
      <div
        ref={containerRef}
        style={{
          padding: "1rem",
          textAlign: "center",
          color: "var(--text-muted, #6b7280)",
          fontSize: "0.72rem",
          background: "rgba(255,255,255,0.02)",
          borderRadius: "8px",
          border: "1px dashed rgba(139, 92, 246, 0.15)",
        }}
      >
        📈 Add at least 2 checkpoints to see the timeline chart
      </div>
    );
  }

  // Calculate drawing area
  const drawWidth = chartWidth - CHART_PADDING.left - CHART_PADDING.right;
  const drawHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

  // Scale helpers
  const timeMin = data[0].timestamp;
  const timeMax = data[data.length - 1].timestamp;
  const timeRange = Math.max(timeMax - timeMin, 1);
  const maxValue = Math.max(...data.map((d) => d.alive), eggCount || 1);

  const scaleX = (ts) => CHART_PADDING.left + ((ts - timeMin) / timeRange) * drawWidth;
  const scaleY = (val) => CHART_PADDING.top + drawHeight - (val / maxValue) * drawHeight;

  // Build area path (alive count)
  const areaPath = (() => {
    const pts = data.map((d) => `${scaleX(d.timestamp)},${scaleY(d.alive)}`);
    const baseline = `${scaleX(data[data.length - 1].timestamp)},${scaleY(0)} ${scaleX(data[0].timestamp)},${scaleY(0)}`;
    return `M ${pts.join(" L ")} L ${baseline} Z`;
  })();

  // Build line path (alive count)
  const linePath = data.map((d) => `${scaleX(d.timestamp)},${scaleY(d.alive)}`).join(" L ");

  // Build survival rate line
  const survivalPath = data
    .map((d) => `${scaleX(d.timestamp)},${scaleY((d.survivalRate / 100) * maxValue)}`)
    .join(" L ");

  // Format timestamp for tooltip
  const formatDate = (ts) => {
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const formatDaysAgo = (ts) => {
    const now = Math.round(Date.now() / 1000);
    const days = Math.round((now - ts) / 86400);
    if (days === 0) return "Today";
    if (days === 1) return "1 day ago";
    return `${days}d ago`;
  };

  return (
    <div ref={containerRef} style={{ position: "relative", marginTop: "0.75rem" }}>
      {/* Chart Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <span style={{ fontSize: "0.68rem", fontWeight: "600", color: "var(--text-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Population Timeline
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "0.6rem", color: "var(--text-muted, #6b7280)" }}>
            <span style={{ width: "8px", height: "2px", background: "#60a5fa", borderRadius: "1px", display: "inline-block" }} />
            Alive
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "0.6rem", color: "var(--text-muted, #6b7280)" }}>
            <span style={{ width: "8px", height: "2px", background: "#34d399", borderRadius: "1px", display: "inline-block", opacity: 0.6 }} />
            Survival %
          </span>
        </div>
      </div>

      <svg
        width={chartWidth}
        height={CHART_HEIGHT}
        style={{ display: "block", overflow: "visible" }}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {/* Defs */}
        <defs>
          <linearGradient id={`area-grad-${spawnId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Y-axis grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = CHART_PADDING.top + drawHeight * (1 - pct);
          return (
            <g key={pct}>
              <line
                x1={CHART_PADDING.left} y1={y}
                x2={CHART_PADDING.left + drawWidth} y2={y}
                stroke="rgba(139, 92, 246, 0.06)" strokeWidth="0.5"
              />
              <text x={CHART_PADDING.left - 6} y={y + 3} textAnchor="end" fontSize="8" fill="rgba(156, 163, 175, 0.5)">
                {Math.round(maxValue * pct)}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill={`url(#area-grad-${spawnId})`} />

        {/* Alive line */}
        <path d={`M ${linePath}`} fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Survival rate line (dashed) */}
        <path d={`M ${survivalPath}`} fill="none" stroke="#34d399" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" strokeLinecap="round" />

        {/* Checkpoint dots */}
        {data.map((d, i) => {
          const cx = scaleX(d.timestamp);
          const cy = scaleY(d.alive);
          const color = CHECKPOINT_COLORS[d.type]?.fill || "#6b7280";
          const isHovered = hoverIndex === i;

          return (
            <g key={i}>
              {/* Invisible larger hit area */}
              <circle
                cx={cx} cy={cy} r="10"
                fill="transparent"
                onMouseEnter={() => setHoverIndex(i)}
                style={{ cursor: "pointer" }}
              />
              {/* Visible dot */}
              <circle
                cx={cx} cy={cy}
                r={isHovered ? 5 : 3}
                fill={color}
                stroke={isHovered ? "#fff" : "rgba(14,11,26,0.8)"}
                strokeWidth={isHovered ? 2 : 1}
                style={{ transition: "r 0.15s, stroke-width 0.15s" }}
              />
              {/* Vertical crosshair on hover */}
              {isHovered && (
                <line
                  x1={cx} y1={CHART_PADDING.top}
                  x2={cx} y2={CHART_PADDING.top + drawHeight}
                  stroke="rgba(167, 139, 250, 0.3)" strokeWidth="0.5" strokeDasharray="2 2"
                />
              )}
            </g>
          );
        })}

        {/* X-axis time labels */}
        {data.length > 0 && (
          <>
            <text x={scaleX(data[0].timestamp)} y={CHART_HEIGHT - 4} textAnchor="start" fontSize="8" fill="rgba(156, 163, 175, 0.5)">
              {formatDate(data[0].timestamp)}
            </text>
            <text x={scaleX(data[data.length - 1].timestamp)} y={CHART_HEIGHT - 4} textAnchor="end" fontSize="8" fill="rgba(156, 163, 175, 0.5)">
              {formatDate(data[data.length - 1].timestamp)}
            </text>
          </>
        )}
      </svg>

      {/* Hover Tooltip */}
      {hoverIndex !== null && data[hoverIndex] && (
        <div
          style={{
            position: "absolute",
            left: Math.min(
              Math.max(scaleX(data[hoverIndex].timestamp) - 80, 0),
              chartWidth - 170
            ),
            top: -8,
            transform: "translateY(-100%)",
            background: "rgba(15, 12, 31, 0.97)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(167, 139, 250, 0.25)",
            borderRadius: "8px",
            padding: "8px 12px",
            minWidth: "150px",
            pointerEvents: "none",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            zIndex: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <span style={{ fontSize: "0.65rem", color: "var(--text-muted, #6b7280)" }}>
              {formatDate(data[hoverIndex].timestamp)}
            </span>
            <span style={{ fontSize: "0.6rem", color: "var(--text-muted, #6b7280)" }}>
              {formatDaysAgo(data[hoverIndex].timestamp)}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
            <span style={{
              width: "8px", height: "8px", borderRadius: "50%",
              background: CHECKPOINT_COLORS[data[hoverIndex].type]?.fill || "#6b7280",
            }} />
            <span style={{ fontSize: "0.72rem", fontWeight: "600", color: "#fff" }}>
              {CHECKPOINT_COLORS[data[hoverIndex].type]?.label || data[hoverIndex].type}
            </span>
            {data[hoverIndex].count > 0 && (
              <span style={{ fontSize: "0.72rem", color: "var(--text-muted, #6b7280)", fontFamily: "'JetBrains Mono', monospace" }}>
                ×{data[hoverIndex].count}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: "12px", fontSize: "0.65rem" }}>
            <span style={{ color: "#60a5fa" }}>Alive: {data[hoverIndex].alive}</span>
            <span style={{ color: "#34d399" }}>Survival: {data[hoverIndex].survivalRate}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default GrowOutChart;
