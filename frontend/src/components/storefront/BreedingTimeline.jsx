/**
 * BreedingTimeline.jsx — Breeding history timeline component.
 * Shows spawn records in a vertical timeline with glassmorphic cards.
 * Expandable for viewing offspring details.
 */
import React, { useState } from "react";
import { Egg, CaretDown, CaretUp, Check } from "@phosphor-icons/react";

export function BreedingTimeline({ history }) {
  const [expanded, setExpanded] = useState(false);
  const displayCount = expanded ? history.length : Math.min(5, history.length);
  const visibleHistory = history.slice(0, displayCount);

  if (!history || history.length === 0) {
    return (
      <section className="sf-timeline" aria-label="Breeding history">
        <h2 className="sf-section-title">Breeding History</h2>
        <div className="sf-timeline__empty glass-card">
          <Egg weight="duotone" size={32} style={{ opacity: 0.5, color: "var(--accent-blue)" }} />
          <p className="sf-timeline__empty-text">
            No breeding records yet. Check back as this breeder grows their program.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="sf-timeline" aria-label="Breeding history">
      <h2 className="sf-section-title">
        Breeding History
        <span className="sf-section-count">{history.length} spawns</span>
      </h2>

      <div className="sf-timeline__list">
        {visibleHistory.map((record, idx) => (
          <div
            key={record.spawnId || idx}
            className="sf-timeline__item glass-card"
            style={{ animationDelay: `${idx * 60}ms` }}
          >
            <div className="sf-timeline__dot">
              <Egg weight="fill" size={14} />
            </div>
            <div className="sf-timeline__content">
              <div className="sf-timeline__row">
                <span className="sf-timeline__species">
                  {record.species || "Unknown Species"}
                </span>
                <span className="sf-timeline__date">
                  {formatDate(record.spawnDate)}
                </span>
              </div>
              <div className="sf-timeline__details">
                <span className="sf-timeline__offspring">
                  {record.offspringCount} offspring
                </span>
                <span className={`sf-timeline__status sf-timeline__status--${record.status}`}>
                  <Check weight="bold" size={10} />
                  {record.status}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {history.length > 5 && (
        <button
          className="sf-timeline__toggle"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? "Show fewer breeding records" : "Show all breeding records"}
        >
          {expanded ? (
            <>Show Less <CaretUp weight="bold" size={14} /></>
          ) : (
            <>View All {history.length} Spawns <CaretDown weight="bold" size={14} /></>
          )}
        </button>
      )}
    </section>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
