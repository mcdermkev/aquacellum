import React, { useEffect, useRef, useState } from "react";
import {
  ALL_GROUPS,
  UNASSIGNED,
  MAX_GROUP_NAME_LENGTH,
  countUnassigned,
  filterTanksByGroup,
  normalizeGroupName,
} from "../../services/tankGroups";
import "./LocationGroupBar.css";

/** MIME type for a tank being dragged. Kept in sync with the drag sources in
 *  ProOpsGrid and the TankList card rows. */
export const TANK_DND_MIME = "application/aquadex-tank";

/**
 * LocationGroupBar — the Logbook's "filter by location" chips, but the groups
 * are the keeper's own (Task: user-defined groups + drag-to-assign).
 *
 * Three jobs:
 *   1. Filter the tank list to one group.
 *   2. Create / rename / delete groups inline — no hardcoded room names.
 *   3. Act as a drop target: drag a tank from the list onto a chip to move it
 *      into that group. A "Move to group" menu on each tank card mirrors this
 *      for touch and keyboard, so drag is a shortcut, never the only path.
 *
 * Props:
 *   tanks            — all tanks (unfiltered) for the counts
 *   groups           — group names from useTankGroups
 *   selected         — ALL_GROUPS | UNASSIGNED | group name
 *   dragActive       — a tank is mid-drag; chips advertise as drop targets
 *   onSelect(group)
 *   onCreate(name)         — async; throws with a user-facing message
 *   onRename(from, to)     — async
 *   onDelete(name)         — async
 *   onDropTank(tankId, group) — async; group "" / UNASSIGNED un-assigns
 */
export function LocationGroupBar({
  tanks = [],
  groups = [],
  selected = ALL_GROUPS,
  dragActive = false,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onDropTank,
}) {
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [editingGroup, setEditingGroup] = useState(null); // group name being renamed
  const [editDraft, setEditDraft] = useState("");
  const [dropTarget, setDropTarget] = useState(null); // group name (or UNASSIGNED) hovered while dragging
  const [error, setError] = useState(null);
  const createInputRef = useRef(null);
  const editInputRef = useRef(null);

  useEffect(() => { if (creating) createInputRef.current?.focus(); }, [creating]);
  useEffect(() => { if (editingGroup) editInputRef.current?.focus(); }, [editingGroup]);

  const unassignedCount = countUnassigned(tanks);

  const beginCreate = () => {
    setError(null);
    setDraftName("");
    setCreating(true);
  };

  const cancelCreate = () => {
    setCreating(false);
    setDraftName("");
    setError(null);
  };

  const submitCreate = async () => {
    const clean = normalizeGroupName(draftName);
    if (!clean) { cancelCreate(); return; }
    try {
      await onCreate?.(clean);
      setCreating(false);
      setDraftName("");
      setError(null);
    } catch (e) {
      setError(e?.message || "Could not create that group.");
    }
  };

  const beginEdit = (group) => {
    setError(null);
    setEditingGroup(group);
    setEditDraft(group);
  };

  const cancelEdit = () => {
    setEditingGroup(null);
    setEditDraft("");
    setError(null);
  };

  const submitEdit = async () => {
    const clean = normalizeGroupName(editDraft);
    if (!clean || clean === editingGroup) { cancelEdit(); return; }
    try {
      await onRename?.(editingGroup, clean);
      cancelEdit();
    } catch (e) {
      setError(e?.message || "Could not rename that group.");
    }
  };

  /** Only claim the drop when a tank is actually being dragged — specimen drags
   *  use their own MIME types and must fall through untouched. */
  const isTankDrag = (e) => Array.from(e.dataTransfer?.types || []).includes(TANK_DND_MIME);

  const handleDragOver = (e, group) => {
    if (!isTankDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget !== group) setDropTarget(group);
  };

  const handleDrop = async (e, group) => {
    if (!isTankDrag(e)) return;
    e.preventDefault();
    setDropTarget(null);
    const raw = e.dataTransfer.getData(TANK_DND_MIME);
    const tankId = Number(raw);
    if (!raw || Number.isNaN(tankId)) return;
    await onDropTank?.(tankId, group);
  };

  const renderCount = (count, isActive) => (
    <span className={`locgroup-count ${isActive ? "is-active" : ""}`}>{count}</span>
  );

  return (
    <div className="locgroup-bar" data-tank-dragging={dragActive ? "true" : "false"}>
      <div className="locgroup-header">
        <span className="locgroup-title">📍 Groups</span>
        <span className="locgroup-hint">Drag a tank onto a group to move it</span>
        {selected !== ALL_GROUPS && (
          <button type="button" className="locgroup-reset" onClick={() => onSelect?.(ALL_GROUPS)}>
            Reset filter
          </button>
        )}
      </div>

      <div className="locgroup-chips">
        {/* All */}
        <div className={`locgroup-chip ${selected === ALL_GROUPS ? "is-active" : ""}`}>
          <button type="button" className="locgroup-chip-main" onClick={() => onSelect?.(ALL_GROUPS)}>
            <span>All</span>
            {renderCount(tanks.length, selected === ALL_GROUPS)}
          </button>
        </div>

        {/* User-defined groups */}
        {groups.map((group) => {
          const isActive = selected === group;
          const isEditing = editingGroup === group;
          const count = filterTanksByGroup(tanks, group).length;

          if (isEditing) {
            return (
              <div key={group} className="locgroup-chip is-editing">
                <input
                  ref={editInputRef}
                  className="locgroup-input"
                  value={editDraft}
                  maxLength={MAX_GROUP_NAME_LENGTH}
                  aria-label={`Rename group ${group}`}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); submitEdit(); }
                    if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                  }}
                />
                <button type="button" className="locgroup-mini" title="Save name" aria-label="Save group name" onClick={submitEdit}>✓</button>
                <button type="button" className="locgroup-mini" title="Cancel" aria-label="Cancel rename" onClick={cancelEdit}>✕</button>
              </div>
            );
          }

          return (
            <div
              key={group}
              className={`locgroup-chip ${isActive ? "is-active" : ""} ${dropTarget === group ? "is-droptarget" : ""}`}
              onDragOver={(e) => handleDragOver(e, group)}
              onDragLeave={() => setDropTarget((cur) => (cur === group ? null : cur))}
              onDrop={(e) => handleDrop(e, group)}
              data-testid="locgroup-chip"
            >
              <button
                type="button"
                className="locgroup-chip-main"
                onClick={() => onSelect?.(group)}
                title={`Show only ${group}`}
              >
                <span aria-hidden="true">📍</span>
                <span className="locgroup-name">{group}</span>
                {renderCount(count, isActive)}
              </button>
              <button
                type="button"
                className="locgroup-mini"
                title={`Rename ${group}`}
                aria-label={`Rename group ${group}`}
                onClick={() => beginEdit(group)}
              >
                ✎
              </button>
              <button
                type="button"
                className="locgroup-mini locgroup-mini--danger"
                title={`Delete ${group}`}
                aria-label={`Delete group ${group}`}
                onClick={() => onDelete?.(group)}
              >
                🗑
              </button>
            </div>
          );
        })}

        {/* Unassigned — only when something is actually unassigned */}
        {unassignedCount > 0 && (
          <div
            className={`locgroup-chip locgroup-chip--unassigned ${selected === UNASSIGNED ? "is-active" : ""} ${dropTarget === UNASSIGNED ? "is-droptarget" : ""}`}
            onDragOver={(e) => handleDragOver(e, UNASSIGNED)}
            onDragLeave={() => setDropTarget((cur) => (cur === UNASSIGNED ? null : cur))}
            onDrop={(e) => handleDrop(e, UNASSIGNED)}
          >
            <button type="button" className="locgroup-chip-main" onClick={() => onSelect?.(UNASSIGNED)} title="Tanks with no group">
              <span aria-hidden="true">◌</span>
              <span className="locgroup-name">Unassigned</span>
              {renderCount(unassignedCount, selected === UNASSIGNED)}
            </button>
          </div>
        )}

        {/* Create */}
        {creating ? (
          <div className="locgroup-chip is-editing">
            <input
              ref={createInputRef}
              className="locgroup-input"
              value={draftName}
              maxLength={MAX_GROUP_NAME_LENGTH}
              placeholder="Group name…"
              aria-label="New group name"
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); submitCreate(); }
                if (e.key === "Escape") { e.preventDefault(); cancelCreate(); }
              }}
            />
            <button type="button" className="locgroup-mini" title="Create group" aria-label="Create group" onClick={submitCreate}>✓</button>
            <button type="button" className="locgroup-mini" title="Cancel" aria-label="Cancel new group" onClick={cancelCreate}>✕</button>
          </div>
        ) : (
          <button type="button" className="locgroup-add" onClick={beginCreate}>
            + New group
          </button>
        )}
      </div>

      {error && <p className="locgroup-error" role="alert">{error}</p>}
    </div>
  );
}
