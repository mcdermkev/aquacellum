import React, { useEffect, useState } from "react";
import { db } from "../../db";
import { getWaterEnvelope } from "../../utils/tankUtils";
import { normalizeReading } from "../../utils/tankHealth";
import { useUnitPrefs } from "../../hooks/useUnitPrefs";
import { resolveTempScale } from "../../utils/units";
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
 * Also supports a RACK mode: pass `tanks` (the rack's tanks) instead of a single
 * `tank` and readings across the whole rack are averaged into a daily series, so
 * a breeder can watch a rack drift as one line (per the plan's per-rack trends).
 *
 * Props:
 *   tank             — active tank (tankType → envelope; id → readings)  [single mode]
 *   tanks            — rack tanks; when provided, renders averaged rack trends [rack mode]
 *   title            — optional heading override
 *   readingsOverride — optional readings array (preview/tests; bypasses Dexie)
 */
/**
 * `temp` carries no literal unit string: it is resolved per-render from the
 * keeper's Settings → Units & Formatting → Temperature choice. `isTemp` marks the
 * one metric whose values are in Celsius and therefore need converting alongside
 * its label — a sparkline has a single axis, so labelling it °F while plotting
 * Celsius would be a chart that lies. See `resolveTempScale` for why "both"
 * resolves to Celsius here.
 */
const METRICS = [
  { key: "temp", label: "Temperature", unit: null, isTemp: true, bandKey: ["tempMin", "tempMax"], decimals: 1 },
  { key: "ph", label: "pH", unit: "", bandKey: ["phMin", "phMax"], decimals: 1 },
  { key: "nitrate", label: "Nitrate", unit: "ppm", bandKey: [0, "nitrateMax"], decimals: 0 },
];

const DAY_SECONDS = 86400;

export function ParamTrends({ tank, tanks, title, readingsOverride }) {
  const { tempUnit } = useUnitPrefs();
  const tempScale = resolveTempScale(tempUnit);
  const rackMode = Array.isArray(tanks) && tanks.length > 0;
  const loadTanks = rackMode ? tanks : (tank ? [tank] : []);
  // Envelope from the (first) tank's type; racks are typically one water type.
  const envTankType = rackMode ? tanks[0]?.tankType : tank?.tankType;
  const loadKey = loadTanks.map((t) => t?.id).join(",");

  const [readings, setReadings] = useState(readingsOverride || null);

  useEffect(() => {
    if (readingsOverride) { setReadings(readingsOverride); return; }
    let cancelled = false;
    (async () => {
      const all = [];
      for (const t of loadTanks) {
        const idKeys = [t?.id, String(t?.id), Number(t?.id)];
        try {
          const rows = await db.paramReadings.where("tankId").anyOf(idKeys).toArray();
          all.push(...rows);
        } catch { /* table absent */ }
        if (Array.isArray(t?.logs)) all.push(...t.logs);
      }
      if (!cancelled) setReadings(all);
    })();
    return () => { cancelled = true; };
  }, [loadKey, readingsOverride]);

  if (readings === null) {
    return <p className="pt-empty">Loading parameter history…</p>;
  }

  const env = getWaterEnvelope(envTankType);

  return (
    <div className="param-trends">
      <div className="pt-title">📈 {title || (rackMode ? "Rack trends (averaged)" : "Parameter trends")}</div>
      <div className="pt-grid">
        {METRICS.map((m) => {
          let series = buildTrendSeries(readings, m.key);
          if (rackMode) series = bucketAverageSeries(series, DAY_SECONDS);
          let bandMin = typeof m.bandKey[0] === "number" ? m.bandKey[0] : env[m.bandKey[0]];
          let bandMax = typeof m.bandKey[1] === "number" ? m.bandKey[1] : env[m.bandKey[1]];

          // Convert the series AND the safe band together, so the shaded
          // in-range region still means the same water it did in Celsius.
          if (m.isTemp && tempScale.scale === "f") {
            series = series.map((p) => ({ ...p, v: tempScale.convert(p.v) }));
            bandMin = tempScale.convert(bandMin);
            bandMax = tempScale.convert(bandMax);
          }

          return (
            <Sparkline
              key={m.key}
              label={m.label}
              unit={m.isTemp ? tempScale.suffix : m.unit}
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

/**
 * Average a {t,v} series into fixed time buckets (default one day), one point per
 * bucket at the bucket start. Used for rack trends where several tanks report on
 * the same day — a single averaged line reads far cleaner than every tank's
 * points interleaved. Pure; exported for tests.
 */
export function bucketAverageSeries(series, bucketSeconds = DAY_SECONDS) {
  const bucket = Number(bucketSeconds) > 0 ? Number(bucketSeconds) : DAY_SECONDS;
  const groups = new Map(); // bucketStart -> { sum, n }
  for (const p of Array.isArray(series) ? series : []) {
    const start = Math.floor(Number(p.t) / bucket) * bucket;
    const g = groups.get(start) || { sum: 0, n: 0 };
    g.sum += Number(p.v);
    g.n += 1;
    groups.set(start, g);
  }
  return [...groups.entries()]
    .map(([t, g]) => ({ t, v: g.sum / g.n }))
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
