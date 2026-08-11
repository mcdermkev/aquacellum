import React, { useEffect, useState } from "react";
import { LivingTank } from "./LivingTank";
import { deriveTankHealth } from "../../utils/tankHealth";
import { getOrInitTankSchedules } from "../../services/tankSchedules";
import { getTankPhoto } from "../../services/tankMedia";
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
  onDropSpecimenGroup,
  onDragEnterTank,
  onDragLeaveTank,
  schedulesOverride,
}) {
  // Load (and lazily provision) each tank's schedules so the living-water ambient
  // reflects overdue maintenance, not just water parameters. `schedulesOverride`
  // bypasses the DB for preview/tests.
  const [schedulesByTank, setSchedulesByTank] = useState(schedulesOverride || {});
  useEffect(() => {
    if (schedulesOverride) { setSchedulesByTank(schedulesOverride); return; }
    let cancelled = false;
    (async () => {
      const map = {};
      await Promise.all(tanks.map(async (t) => { map[t.id] = await getOrInitTankSchedules(t.id); }));
      if (!cancelled) setSchedulesByTank(map);
    })();
    return () => { cancelled = true; };
  }, [tanks, schedulesOverride]);

  // Resolve each tank's uploaded photo so the card shows it (same precedence as
  // the detail hero: durable tankMedia → legacy localStorage → none). Tanks with
  // no photo fall back to the stylized living-water look.
  const [photosByTank, setPhotosByTank] = useState({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = {};
      await Promise.all(
        tanks.map(async (t) => {
          const legacy = typeof localStorage !== "undefined" ? localStorage.getItem(`aquadex_tank_photo_${t.id}`) : null;
          map[t.id] = (await getTankPhoto(t.id)) || legacy || null;
        })
      );
      if (!cancelled) setPhotosByTank(map);
    })();
    return () => { cancelled = true; };
  }, [tanks]);

  return (
    <div className="casual-tank-gallery">
      {tanks.map((tank) => {
        const health = deriveTankHealth(tank, { schedules: schedulesByTank[tank.id] || [] });
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
            data-testid="tank-card"
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
              const groupStr = e.dataTransfer.getData("application/aquadex-specimen-group");
              if (groupStr && onDropSpecimenGroup) {
                try {
                  const ids = JSON.parse(groupStr);
                  if (Array.isArray(ids) && ids.length) await onDropSpecimenGroup(ids, tank.id);
                } catch { /* ignore malformed payload */ }
                return;
              }
              const specimenIdStr = e.dataTransfer.getData("application/aquadex-specimen");
              if (specimenIdStr && onDropSpecimen) {
                await onDropSpecimen(Number(specimenIdStr), tank.id);
              }
            }}
          >
            <LivingTank tank={tank} health={health} variant="card" fishbaseData={fishbaseData} photoUrl={photosByTank[tank.id] || undefined} />

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
