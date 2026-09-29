/**
 * MarineTestFields — the saltwater part of the water test (docs/SALTWATER_SPEC.md).
 *
 * Shown instead of GH / total alkalinity when the tank is saltwater. Salinity
 * and alkalinity (dKH) have sliders against the tank's envelope; calcium,
 * magnesium and phosphate are optional number fields, because many fish-only
 * keepers don't test them. A blank field isn't saved (see marineLogFields).
 */
import { envelopeForTank, getTrackBackground, isInsideEnvelope } from "../utils/tankUtils";
import { normalizeReading } from "../utils/tankHealth";

const labelStyle = { display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" };
const numberStyle = { width: "100%", padding: "0.5rem", background: "rgba(var(--ink-rgb), 0.03)", border: "1px solid var(--glass-border)", color: "var(--text-primary)", borderRadius: "4px" };
const hintStyle = { fontSize: "0.6rem", color: "var(--text-muted)" };

function status(value, min, max) {
  if (value === "" || value === undefined || value === null || min == null || max == null) return null;
  return isInsideEnvelope(Number(value), min, max);
}

function Slider({ id, label, unit, value, min, max, step, safeMin, safeMax, hint, onChange }) {
  const ok = status(value, safeMin, safeMax);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
        <label htmlFor={id} style={{ color: "var(--text-secondary)" }}>{label}</label>
        <strong style={{ color: ok ? "var(--accent-green)" : "var(--accent-red)" }}>
          {value}{unit ? ` ${unit}` : ""} {ok ? "(Ideal)" : "(Warning)"}
        </strong>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
        style={{
          width: "100%", height: "6px", borderRadius: "3px", outline: "none", cursor: "pointer",
          background: getTrackBackground(min, max, safeMin, safeMax),
          accentColor: ok ? "#22c55e" : "#ef4444",
        }}
      />
      <span id={`${id}-hint`} style={hintStyle}>{hint} Target {safeMin}–{safeMax}{unit ? ` ${unit}` : ""}.</span>
    </div>
  );
}

function Optional({ id, label, value, step, placeholder, target, onChange, ok }) {
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <input
        id={id}
        type="number"
        min="0"
        step={step}
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
        style={{ ...numberStyle, ...(ok === false ? { borderColor: "rgba(248, 113, 113, 0.6)" } : {}) }}
      />
      <span id={`${id}-hint`} style={{ ...hintStyle, ...(ok === false ? { color: "var(--accent-red)" } : {}) }}>
        {ok === false ? "Outside target. " : ""}{target ? `Target ${target}. ` : "No target for a fish-only tank. "}Optional.
      </span>
    </div>
  );
}

export function MarineTestFields({ formData, setFormData, env }) {
  const set = (key) => (value) => setFormData({ ...formData, [key]: value });
  const salinity = formData.salinity ?? "1.025";
  const ca = formData.ca ?? "";
  const mg = formData.mg ?? "";
  const po4 = formData.po4 ?? "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
        <Slider
          id="marine-salinity" label="Salinity (SG)" unit="" value={salinity} min="1.015" max="1.030" step="0.001"
          safeMin={env.salinityMin} safeMax={env.salinityMax} hint="From a refractometer or hydrometer." onChange={set("salinity")}
        />
        <Slider
          id="marine-kh" label="Alkalinity (dKH)" unit="dKH" value={formData.kh} min="0" max="20" step="0.1"
          safeMin={env.khMin} safeMax={env.khMax} hint="Keep it steady; swings matter more than the number." onChange={set("kh")}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
        {/* A fish-only tank has no calcium / magnesium / phosphate target
            (tankUtils MARINE_STYLE_OVERRIDES), so say so instead of "null–null". */}
        <Optional id="marine-ca" label="Calcium (ppm)" value={ca} step="5" placeholder="420" target={env.caMin != null ? `${env.caMin}–${env.caMax}` : null}
          ok={status(ca, env.caMin, env.caMax)} onChange={set("ca")} />
        <Optional id="marine-mg" label="Magnesium (ppm)" value={mg} step="10" placeholder="1350" target={env.mgMin != null ? `${env.mgMin}–${env.mgMax}` : null}
          ok={status(mg, env.mgMin, env.mgMax)} onChange={set("mg")} />
        <Optional id="marine-po4" label="Phosphate (ppm)" value={po4} step="0.01" placeholder="0.05" target={env.po4Max != null ? `≤ ${env.po4Max}` : null}
          ok={po4 === "" || env.po4Max == null ? null : Number(po4) <= env.po4Max} onChange={set("po4")} />
      </div>
    </div>
  );
}

/**
 * The saltwater readings from a tank's last log, on the tank detail. Only the
 * values that were actually tested are listed.
 */
export function MarineReadingTile({ tank, casual = false }) {
  const r = normalizeReading(tank?.latestLog);
  if (!r) return null;
  const env = envelopeForTank(tank);
  const fishOnly = tank?.marineStyle === "fish_only";
  // `target` null = this tank style has no target for it (fish-only Ca/Mg/PO4):
  // the value is shown without a verdict.
  const rows = [
    r.salinity !== undefined && { label: casual ? "Salinity" : "Salinity (SG)", value: `${r.salinity.toFixed(3)}`, ok: isInsideEnvelope(r.salinity, env.salinityMin, env.salinityMax), target: `${env.salinityMin}–${env.salinityMax}` },
    r.kh !== undefined && { label: "Alkalinity", value: `${r.kh.toFixed(1)} dKH`, ok: env.khMin == null || isInsideEnvelope(r.kh, env.khMin, env.khMax), target: env.khMin != null ? `${env.khMin}–${env.khMax}` : null },
    r.ca !== undefined && { label: "Calcium", value: `${Math.round(r.ca)} ppm`, ok: env.caMin == null || isInsideEnvelope(r.ca, env.caMin, env.caMax), target: env.caMin != null ? `${env.caMin}–${env.caMax}` : null },
    r.mg !== undefined && { label: "Magnesium", value: `${Math.round(r.mg)} ppm`, ok: env.mgMin == null || isInsideEnvelope(r.mg, env.mgMin, env.mgMax), target: env.mgMin != null ? `${env.mgMin}–${env.mgMax}` : null },
    r.po4 !== undefined && { label: "Phosphate", value: `${r.po4.toFixed(2)} ppm`, ok: env.po4Max == null || r.po4 <= env.po4Max, target: env.po4Max != null ? `≤ ${env.po4Max}` : null },
  ].filter(Boolean);
  if (!rows.length) return null;
  return (
    <div className="telemetry-tile-premium" style={{ gridColumn: "span 2" }}>
      <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
        <span aria-hidden="true">🪸 </span>{casual ? "Saltwater readings" : "Saltwater chemistry"}{fishOnly ? " · fish only" : " · reef targets"}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.78rem", color: "var(--text-primary)", marginTop: "0.35rem" }}>
        {rows.map((row) => (
          <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
            <span>{row.label}</span>
            <span style={{ textAlign: "right" }}>
              <strong style={{ color: row.target == null ? "var(--text-primary)" : row.ok ? "var(--accent-green)" : "var(--accent-red)" }}>
                {row.value}{row.target != null && !row.ok ? " (outside target)" : ""}
              </strong>
              <span style={{ display: "block", fontSize: "0.68rem", color: "var(--text-muted)" }}>
                {row.target != null ? `Target ${row.target}` : "No target for fish only"}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MarineTestFields;
