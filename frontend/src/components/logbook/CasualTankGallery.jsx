import React from "react";
import { LivingTank } from "./LivingTank";
import { deriveTankHealth } from "../../utils/tankHealth";
import "./CasualTankGallery.css";

/**
 * CasualTankGallery — the Casual-mode logbook list, rendered as a gallery of
 * living aquariums instead of flat stat cards (Logbook Rework Task 5).
 *
 * Each tank is a `LivingTank` (card variant) whose water reflects real health via
 * deriveTankHealth. Tapping a card opens the detail panel; a card is also a drop
 * target so specimens dragged from the Nursery can be assigned to it (preserving
 * the existing drag-to-assign behavior).
 *
 * Props:
 *   tanks            — top-level tanks to display
 *   fishbaseData     — species data for the swimming-fish layer
 *   activeTankId     — currently-open tank (for selected styling)
 *   draggedOverTankId— tank currently being dragged over (for drop highlight)
 *   onOpen(tank)     — open the detail panel
 *   onDropSpecimen(specimenId, tankId) — assign a dragged specimen
 *   onDragEnterTank(tankId) / onDragLeaveTank() — drag highlight callbacks
 */
export function CasualTankGallery({
  tanks = [],
  fishbaseData = [],
  activeTankId = null,
  draggedOverTankId = null,
  onOpen,
  onDropSpecimen,
  onDragEnterTank,
  onDragLeaveTank,
}) {
  return (
    <div className="casual-tank-gallery">
      {tanks.map((tank) => {
        const health = deriveTankHealth(tank);
        const isActive = activeTankId != null && Number(activeTankId) === Number(tank.id);
        const isDragOver = draggedOverTankId != null && Number(draggedOverTankId) === Number(tank.id);
        const testedAgo = relativeTime(tank.latestTestTimestamp);
        const changedAgo = relativeTime(tank.latestChangeTimestamp);

        const stateClass = isDragOver
          ? "ctg-card--dragover"
          : isActive
          ? "ctg-card--active"
          : health.status === "alert"
          ? "ctg-card--alert"
          : "";

        return (
          <div
            key={tank.id}
            className={`ctg-card ${stateClass}`}
            role="button"
            tabIndex={0}
            aria-label={`Open ${tank.name || "tank"}`}
            onClick={() => onOpen && onOpen(tank)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen && onOpen(tank);
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={(e) => {
              e.preventDefault();
              onDragEnterTank && onDragEnterTank(tank.id);
            }}
            onDragLeave={() => onDragLeaveTank && onDragLeaveTank()}
            onDrop={async (e) => {
              e.preventDefault();
              onDragLeaveTank && onDragLeaveTank();
              const specimenIdStr = e.dataTransfer.getData("application/aquadex-specimen");
              if (specimenIdStr && onDropSpecimen) {
                await onDropSpecimen(Number(specimenIdStr), tank.id);
              }
            }}
          >
            <LivingTank tank={tank} health={health} variant="card" fishbaseData={fishbaseData} />

            {/* Care footer — quick glance at maintenance recency */}
            <div className="ctg-footer">
              <span className="ctg-chip" title="Last water test">🧪 {testedAgo}</span>
              <span className="ctg-chip" title="Last water change">💧 {changedAgo}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Compact relative-time label from a seconds-since-epoch timestamp. */
function relativeTime(tsSeconds) {
  if (!tsSeconds) return "—";
  const diff = Date.now() / 1000 - Number(tsSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}
