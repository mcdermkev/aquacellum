import React, { useEffect, useState } from "react";
import { explainTankFlags } from "../../utils/flagExplain";
import { buildFlagFixPrompt } from "../../utils/poseidonPrompts";
import { getOrInitTankSchedules } from "../../services/tankSchedules";
import "./HealthFlagExplainer.css";

/**
 * HealthFlagExplainer — the "why is this flagged?" knowledge panel (Logbook
 * Rework Task 10). Surfaces a plain-language explanation for every out-of-range
 * water parameter and overdue schedule, tied to the tank's own target ranges.
 *
 * All content is deterministic and grounded (see flagExplain.js) — targets come
 * from the envelope module, observed values from the latest reading, and the
 * why/what-to-do copy is established husbandry, never AI-generated. Renders
 * nothing when the tank has no active flags.
 *
 * Props:
 *   tank          — active tank
 *   casualModeActive
 */
export function HealthFlagExplainer({ tank, casualModeActive = false, onAskPoseidon }) {
  const [schedules, setSchedules] = useState([]);

  useEffect(() => {
    let cancelled = false;
    if (tank?.id == null) return;
    getOrInitTankSchedules(tank.id)
      .then((rows) => { if (!cancelled) setSchedules(rows || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tank?.id]);

  if (!tank) return null;
  const { items } = explainTankFlags(tank, { schedules });
  if (!items.length) return null;

  return (
    <div className="flag-explainer" data-testid="flag-explainer">
      <div className="fx-head">
        <span className="fx-head-icon" aria-hidden="true">💡</span>
        <strong className="fx-head-title">
          {casualModeActive ? "What needs attention & why" : "Flagged parameters — why & what to do"}
        </strong>
      </div>
      <ul className="fx-list">
        {items.map((it) => (
          <li key={it.id} className={`fx-item fx-item--${it.severity}`}>
            <div className="fx-item-top">
              <span className="fx-item-label">{it.label}</span>
              <span className="fx-item-nums">
                <span className="fx-observed">{it.observed}</span>
                <span className="fx-target" title="Target for this tank">target {it.target}</span>
              </span>
            </div>
            <p className="fx-why">{it.why}</p>
            <p className="fx-action"><span aria-hidden="true">→ </span>{it.action}</p>
          </li>
        ))}
      </ul>

      {onAskPoseidon && (
        <button
          type="button"
          className="fx-ask-poseidon"
          onClick={() => onAskPoseidon(buildFlagFixPrompt(tank, items))}
        >
          💬 Ask Poseidon what to do
        </button>
      )}
    </div>
  );
}
