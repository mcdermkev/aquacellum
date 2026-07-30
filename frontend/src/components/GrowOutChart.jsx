import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { buildGrowoutTimeline } from "../utils/growoutFunnel";

/**
 * GrowOutChart — Population timeline for grow-out data, built on recharts.
 *
 * Visualizes fry population over time with:
 * - Area chart showing alive count trend
 * - Checkpoint markers (colored dots by type)
 * - Hover tooltip showing exact values at each point
 * - Survival rate trend line overlay (secondary axis)
 * - Responsive width
 *
 * Standardized onto recharts to match the Founders and Seller analytics
 * dashboards. The population/survival math (buildTimelineData) is unchanged.
 */

const CHART_HEIGHT = 132;

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
 *
 * The accumulation itself lives in utils/growoutFunnel.js — the same module the
 * tracker, the batch panel, and the achievements tab use — so the chart can never
 * disagree with the funnel summary printed directly above it.
 */
function buildTimelineData(checkpoints, initialEggs) {
  return buildGrowoutTimeline(checkpoints, initialEggs);
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

const formatDate = (ts) => {
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const formatDaysAgo = (ts) => {
  const now = Math.round(Date.now() / 1000);
  const seconds = ts > 1e12 ? Math.round(ts / 1000) : ts;
  const days = Math.round((now - seconds) / 86400);
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days}d ago`;
};

// ─── Custom marks ────────────────────────────────────────────────────────────

/** Checkpoint dot on the "alive" line, colored by checkpoint type. */
function CheckpointDot({ cx, cy, payload }) {
  if (cx == null || cy == null || !payload) return null;
  const color = CHECKPOINT_COLORS[payload.type]?.fill || "#6b7280";
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3}
      fill={color}
      stroke="rgba(14,11,26,0.8)"
      strokeWidth={1}
    />
  );
}

/** Enlarged, white-ringed dot for the hovered checkpoint. */
function CheckpointActiveDot({ cx, cy, payload }) {
  if (cx == null || cy == null || !payload) return null;
  const color = CHECKPOINT_COLORS[payload.type]?.fill || "#6b7280";
  return (
    <circle cx={cx} cy={cy} r={5} fill={color} stroke="#fff" strokeWidth={2} />
  );
}

/** Tooltip mirroring the original: date, days-ago, checkpoint type + count, alive/survival. */
function GrowOutTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const meta = CHECKPOINT_COLORS[d.type];

  return (
    <div
      style={{
        background: "rgba(15, 12, 31, 0.97)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(167, 139, 250, 0.25)",
        borderRadius: "8px",
        padding: "8px 12px",
        minWidth: "150px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", gap: "12px" }}>
        <span style={{ fontSize: "0.65rem", color: "var(--text-muted, #6b7280)" }}>
          {formatDate(d.timestamp)}
        </span>
        <span style={{ fontSize: "0.6rem", color: "var(--text-muted, #6b7280)" }}>
          {formatDaysAgo(d.timestamp)}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: meta?.fill || "#6b7280" }} />
        <span style={{ fontSize: "0.72rem", fontWeight: "600", color: "#fff" }}>
          {meta?.label || d.type}
        </span>
        {d.count > 0 && (
          <span style={{ fontSize: "0.72rem", color: "var(--text-muted, #6b7280)", fontFamily: "'JetBrains Mono', monospace" }}>
            ×{d.count}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: "12px", fontSize: "0.65rem" }}>
        <span style={{ color: "#60a5fa" }}>Alive: {d.alive}</span>
        <span style={{ color: "#34d399" }}>Survival: {d.survivalRate}%</span>
      </div>
    </div>
  );
}

export function GrowOutChart({ checkpoints, eggCount, spawnId }) {
  const data = useMemo(
    () => buildTimelineData(checkpoints, eggCount),
    [checkpoints, eggCount]
  );

  if (data.length < 2) {
    return (
      <div
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

  const maxValue = Math.max(...data.map((d) => d.alive), eggCount || 1);
  const gradId = `growout-area-${spawnId ?? "default"}`;

  return (
    <div style={{ position: "relative", marginTop: "0.75rem" }}>
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

      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <ComposedChart data={data} margin={{ top: 12, right: 8, left: -8, bottom: 4 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.06)" vertical={false} />

          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            ticks={[data[0].timestamp, data[data.length - 1].timestamp]}
            tickFormatter={formatDate}
            tick={{ fill: "rgba(156, 163, 175, 0.6)", fontSize: 8 }}
            tickLine={false}
            axisLine={false}
          />

          {/* Left axis: alive count */}
          <YAxis
            yAxisId="left"
            domain={[0, maxValue]}
            tick={{ fill: "rgba(156, 163, 175, 0.5)", fontSize: 8 }}
            tickLine={false}
            axisLine={false}
            width={30}
          />

          {/* Right axis: survival % (hidden, scales the survival line independently) */}
          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} hide />

          <Tooltip content={<GrowOutTooltip />} cursor={{ stroke: "rgba(167, 139, 250, 0.3)", strokeWidth: 0.5, strokeDasharray: "2 2" }} />

          <Area
            yAxisId="left"
            type="monotone"
            dataKey="alive"
            stroke="#60a5fa"
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
            dot={<CheckpointDot />}
            activeDot={<CheckpointActiveDot />}
            isAnimationActive={false}
          />

          <Line
            yAxisId="right"
            type="monotone"
            dataKey="survivalRate"
            stroke="#34d399"
            strokeWidth={1}
            strokeDasharray="3 3"
            strokeOpacity={0.5}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default GrowOutChart;
