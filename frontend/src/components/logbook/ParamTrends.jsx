import React, { useEffect, useState } from "react";
import { db } from "../../db";
import { getWaterEnvelope } from "../../utils/tankUtils";
import { normalizeReading } from "../../utils/tankHealth";
import "./ParamTrends.css";

/**
 * ParamTrends — per-tank water-parameter trend charts (Logbook Rework Task 6).
 *
 * Lightweight, dependency-free SVG sparklines for the parameters that matter most
 * (temperature, pH, nitrate), each with the safe-envelope band shaded green so
 * drift is obvious before it's a problem. Reads the Task 1 `paramReadings` table
 * plus any on-chain parameter logs. This is also the data feed shape the Breeder
 * Terminal analytics will consume.
 *
 * Props:
 *   tank             — active tank (tankType → envelope; id → readings)
 *   readingsOverride — optional readings array (preview/tests; bypasses Dexie)
 */
const METRICS = [
  { key: "temp", label: "Temperature", unit: "°C", bandKey: ["tempMin", "tempMax"], decimals: 1 },
  { key: "ph", label: "pH", unit: "", bandKey: ["phMin", "phMax"], decimals: 1 },
  { key: "nitrate", label: "Nitrate", unit: "ppm", bandKey: [0, "nitrateMax"], decimals: 0 },
];

export function ParamTrends({ tank, readingsOverride }) {
  const [readings, setReadings] = useState(readingsOverride || null);

  useEffect(() => {
    if (readingsOverride) { setReadings(readingsOverride); return; }
    let cancelled = false;
    (async () => {
      const idKeys = [tank?.id, String(tank?.id), Number(tank?.id)];
      let rows = [];
      try {
        rows = await db.paramReadings.where("tankId").anyOf(idKeys).toArray();
      } catch { /* table absent */ }
      const onChain = Array.isArray(tank?.logs) ? tank.logs : [];
      if (!cancelled) setReadings([...rows, ...onChain]);
    })();
    return () => { cancelled = true; };
  }, [tank?.id, readingsOverride]);

  if (readings === null) {
    return <p className="pt-empty">Loading parameter history…</p>;
  }

  const env = getWaterEnvelope(tank?.tankType);

  return (
    <div className="param-trends">
      <div className="pt-title">📈 Parameter trends</div>
      <div className="pt-grid">
        {METRICS.map((m) => {
          const series = buildTrendSeries(readings, m.key);
          const bandMin = typeof m.bandKey[0] === "number" ? m.bandKey[0] : env[m.bandKey[0]];
          const bandMax = typeof m.bandKey[1] === "number" ? m.bandKey[1] : env[m.bandKey[1]];
          return (
            <Sparkline
              key={m.key}
              label={m.label}
              unit={m.unit}
              decimals={m.decimals}
              series={series}
              bandMin={bandMin}
              bandMax={bandMax}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Build a sorted {t,v} series for a metric from mixed readings. Exported for tests. */
export function buildTrendSeries(readings, key) {
  return (Array.isArray(readings) ? readings : [])
    .map(normalizeReading)
    .filter(Boolean)
    .filter((r) => r[key] != null && !Number.isNaN(Number(r[key])))
    .map((r) => ({ t: Number(r.timestamp) || 0, v: Number(r[key]) }))
    .sort((a, b) => a.t - b.t);
}

const W = 300;
const H = 56;
const PAD = 4;

function Sparkline({ label, unit, decimals, series, bandMin, bandMax }) {
  const inRange = (v) => v >= bandMin && v <= bandMax;

  if (series.length === 0) {
    return (
      <div className="pt-card">
        <div className="pt-card-head"><span>{label}</span><span className="pt-latest pt-muted">—</span></div>
        <div className="pt-nodata">No readings yet</div>
      </div>
    );
  }

  const values = series.map((p) => p.v);
  const dMin = Math.min(...values, bandMin);
  const dMax = Math.max(...values, bandMax);
  const span = (dMax - dMin) || 1;
  const pad = span * 0.12;
  const lo = dMin - pad;
  const hi = dMax + pad;

  const x = (i) => (series.length === 1 ? W / 2 : PAD + (i / (series.length - 1)) * (W - PAD * 2));
  const y = (v) => PAD + (1 - (v - lo) / (hi - lo)) * (H - PAD * 2);

  const bandTop = y(bandMax);
  const bandBottom = y(bandMin);
  const path = series.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const last = series[series.length - 1];
  const lastOk = inRange(last.v);

  return (
    <div className="pt-card">
      <div className="pt-card-head">
        <span>{label}</span>
        <span className="pt-latest" style={{ color: lastOk ? "#34d399" : "#f87171" }}>
          {last.v.toFixed(decimals)}{unit ? ` ${unit}` : ""}
        </span>
      </div>
      <svg className="pt-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label} trend`}>
        {/* Safe-envelope band */}
        <rect x="0" y={Math.min(bandTop, bandBottom)} width={W} height={Math.abs(bandBottom - bandTop)} fill="rgba(52, 211, 153, 0.12)" />
        <line x1="0" y1={bandTop} x2={W} y2={bandTop} stroke="rgba(52,211,153,0.35)" strokeWidth="1" strokeDasharray="3 3" />
        <line x1="0" y1={bandBottom} x2={W} y2={bandBottom} stroke="rgba(52,211,153,0.35)" strokeWidth="1" strokeDasharray="3 3" />
        {/* Trend line */}
        <path d={path} fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* Points */}
        {series.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.v)} r={i === series.length - 1 ? 3 : 1.6}
            fill={inRange(p.v) ? "#34d399" : "#f87171"} />
        ))}
      </svg>
      <div className="pt-range">Safe: {fmt(bandMin, decimals)}–{fmt(bandMax, decimals)}{unit ? ` ${unit}` : ""}</div>
    </div>
  );
}

function fmt(v, d) {
  return Number(v).toFixed(d);
}
