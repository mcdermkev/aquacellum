import React, { useEffect, useMemo, useRef, useState } from "react";
import { CompatCard } from "./EchoCards";
import { checkGroup, recordsInTank, searchCatalog, waterForTankType } from "../services/echoMatch";
import { speciesRecordFor } from "./logbook/inhabitants";
import { latestReading } from "./logbook/latestReading";

/**
 * EchoPlanner — "what could live in this tank?", built up one fish at a time.
 *
 * Lives in Echo's chat as its second tab. Pick a size and water type (or start
 * from one of your tanks), add species from the catalog, and the card below
 * re-checks the whole group as you go, with the same engine as the chat's
 * answer cards (services/echoMatch.js). Echo reacts to each new verdict.
 *
 * Nothing here writes anything. "Ask Echo about this plan" hands the plan to
 * the chat as a question, with this card attached.
 *
 * Props:
 *   catalog  {object[]} species catalog
 *   tanks    {object[]} the keeper's tanks (Dexie rows)
 *   seed     {{ species?: object[], tankId?: any, n: number } | null} from `echo:open-planner`
 *   casual   {boolean}
 *   onAsk    {(prompt: string, card: object) => void}
 */

const WATER_OPTIONS = Object.freeze([
  { value: "fresh", label: "Fresh" },
  { value: "salt", label: "Salt" },
  { value: "brackish", label: "Brackish" },
]);
const WATER_WORD = Object.freeze({ fresh: "freshwater", salt: "saltwater", brackish: "brackish" });

export function EchoPlanner({ catalog = [], tanks = [], seed = null, casual = true, onAsk }) {
  const [fromTankId, setFromTankId] = useState("");
  const [gallons, setGallons] = useState("20");
  const [water, setWater] = useState("fresh");
  const [picked, setPicked] = useState([]);
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);

  const resolve = (rec) => (rec?.tankMetrics || rec?.waterTypes ? rec : speciesRecordFor(rec, catalog)) || null;

  const startFromTank = (id) => {
    setFromTankId(id);
    const tank = tanks.find((t) => String(t.id) === String(id));
    if (!tank) return;
    const liters = Number(tank.volumeLiters);
    if (Number.isFinite(liters) && liters > 0) setGallons(String(Math.round(liters / 3.78541)));
    setWater(waterForTankType(tank.tankType));
    setPicked(recordsInTank(tank, catalog));
  };

  // A new `echo:open-planner` starts a new plan: its species, and its tank if
  // it named one. Keyed on `seed.n` so the same fish twice still restarts.
  const seedKey = seed?.n ?? null;
  useEffect(() => {
    if (!seedKey || !seed) return;
    const tank = seed.tankId != null ? tanks.find((t) => String(t.id) === String(seed.tankId)) : null;
    const fromSeed = (Array.isArray(seed.species) ? seed.species : []).map(resolve).filter(Boolean);
    if (tank) {
      const liters = Number(tank.volumeLiters);
      setFromTankId(String(tank.id));
      if (Number.isFinite(liters) && liters > 0) setGallons(String(Math.round(liters / 3.78541)));
      setWater(waterForTankType(tank.tankType));
      const inTank = recordsInTank(tank, catalog);
      setPicked([...fromSeed, ...inTank.filter((r) => !fromSeed.some((s) => s.scientificName === r.scientificName))]);
    } else {
      setFromTankId("");
      setPicked(fromSeed);
      const w = fromSeed[0]?.waterTypes;
      if (Array.isArray(w) && w.length && !w.includes("freshwater")) setWater(w.includes("marine") ? "salt" : "brackish");
    }
    setQuery("");
    // Only a new seed restarts the plan; catalog/tank refreshes must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  const fromTank = tanks.find((t) => String(t.id) === String(fromTankId)) || null;
  const results = useMemo(
    () => searchCatalog(catalog, query, { water, exclude: picked, max: 6 }),
    [catalog, query, water, picked],
  );

  const plan = useMemo(() => {
    if (!picked.length) return null;
    const g = Number(gallons);
    return checkGroup({
      species: picked,
      tank: {
        name: fromTank?.name || "This tank",
        gallons: Number.isFinite(g) && g > 0 ? g : null,
        water,
        reading: fromTank ? latestReading(fromTank.logs) : null,
      },
    });
  }, [picked, gallons, water, fromTank]);

  // Echo reacts when the verdict changes, not on every keystroke.
  const verdict = plan?.verdict ?? null;
  const mood = plan?.mood ?? null;
  const lastVerdict = useRef(null);
  useEffect(() => {
    const key = verdict ? `${verdict}:${picked.length}` : null;
    if (!key || key === lastVerdict.current) {
      lastVerdict.current = key;
      return;
    }
    lastVerdict.current = key;
    window.dispatchEvent(new CustomEvent("poseidon:echo-reaction", { detail: { mood, durationMs: 1400 } }));
  }, [verdict, mood, picked.length]);

  const add = (rec) => {
    setPicked((list) => (list.some((r) => r.scientificName === rec.scientificName) ? list : [...list, rec]));
    setQuery("");
    searchRef.current?.focus();
  };
  const remove = (rec) => setPicked((list) => list.filter((r) => r.scientificName !== rec.scientificName));

  const askAboutPlan = () => {
    if (!plan || !onAsk) return;
    const g = Number(gallons);
    const size = Number.isFinite(g) && g > 0 ? `${g} gallon ` : "";
    const where = fromTank ? `my tank "${fromTank.name}" (${size}${WATER_WORD[water]})` : `a ${size}${WATER_WORD[water]} tank`;
    onAsk(`I'm planning ${where} with ${plan.names.join(", ")}. What do you think, and what would you change?`, plan);
  };

  return (
    <div className="echo-plan">
      <p className="echo-plan__intro">
        {casual
          ? "Pick a tank and add fish. I check each one against the species guide as you go."
          : "Stocking planner. Every add is checked against the species guide."}
      </p>

      {tanks.length > 0 && (
        <label className="echo-plan__field">
          <span>Start from</span>
          <select value={fromTankId} onChange={(e) => (e.target.value ? startFromTank(e.target.value) : setFromTankId(""))}>
            <option value="">A new tank</option>
            {tanks.map((t) => (
              <option key={t.id} value={String(t.id)}>{t.name || "Unnamed tank"}</option>
            ))}
          </select>
        </label>
      )}

      <div className="echo-plan__grid">
        <label className="echo-plan__field">
          <span>Size (gallons)</span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="2000"
            value={gallons}
            onChange={(e) => setGallons(e.target.value)}
          />
        </label>
        <fieldset className="echo-plan__water">
          <legend>Water</legend>
          <div className="echo-plan__segs">
            {WATER_OPTIONS.map((o) => (
              <label key={o.value} className={`echo-plan__seg${water === o.value ? " echo-plan__seg--on" : ""}`}>
                <input type="radio" name="echo-plan-water" value={o.value} checked={water === o.value} onChange={() => setWater(o.value)} />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <label className="echo-plan__field">
        <span>Add a fish</span>
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the species guide"
          autoComplete="off"
        />
      </label>

      {query.trim() && (
        <ul className="echo-plan__results" aria-label="Matching species">
          {results.length === 0 && <li className="echo-plan__empty">No {WATER_WORD[water]} species match that name.</li>}
          {results.map((rec) => (
            <li key={rec.scientificName}>
              <button type="button" className="echo-plan__result" onClick={() => add(rec)}>
                {rec.masterPhotoUrl ? <img src={rec.masterPhotoUrl} alt="" loading="lazy" decoding="async" /> : <span className="echo-plan__nophoto" aria-hidden="true">🐟</span>}
                <span className="echo-plan__names">
                  <strong>{rec.commonName || rec.scientificName}</strong>
                  <em>{rec.scientificName}</em>
                </span>
                <span className="echo-plan__add" aria-hidden="true">Add</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {picked.length > 0 && (
        <ul className="echo-plan__picked" aria-label="In this plan">
          {picked.map((rec) => (
            <li key={rec.scientificName} className="echo-plan__chip">
              <span>{rec.commonName || rec.scientificName}</span>
              <button type="button" onClick={() => remove(rec)} aria-label={`Remove ${rec.commonName || rec.scientificName}`}>×</button>
            </li>
          ))}
        </ul>
      )}

      {plan ? (
        <>
          <CompatCard result={plan} />
          <button type="button" className="echo-plan__ask" onClick={askAboutPlan}>
            Ask Echo about this plan
          </button>
        </>
      ) : (
        <p className="echo-plan__hint">Add a fish to see how it fits.</p>
      )}
    </div>
  );
}

export default EchoPlanner;
