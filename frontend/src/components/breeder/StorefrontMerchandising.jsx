/**
 * StorefrontMerchandising.jsx — Featured collections & storefront sections
 * editor (Task 21A). Mounted in BreederTerminal's Store section alongside
 * StorefrontSetup.
 *
 * Thin by design: all ordering/resolution logic is the pure, tested
 * storeMerchandising.assembleStorefrontLayout — the live preview below
 * renders through that exact function, the same one the public store page
 * (store.html) uses, so what a seller sees here is what buyers will see.
 *
 * Reorder has both a pointer path (drag) and a keyboard path (up/down
 * buttons + aria), per docs/TASK_21A_MERCHANDISING_SPEC.md §5. Drag itself
 * is intentionally simple (HTML5 dnd on the section list) since the up/down
 * buttons are the primary, always-available reorder mechanism — not a
 * fallback bolted on after the fact.
 *
 * Props: { walletAccount, casualModeActive, listings }
 *   - listings: this seller's own listings (BreederTerminal already filters
 *     useMarketplaceListings to the seller — composed, not refetched here).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Storefront,
  Star,
  Stack,
  Plus,
  Trash,
  Eye,
  EyeSlash,
  ArrowUp,
  ArrowDown,
  Check,
  Warning,
  SpinnerGap,
  CaretDown,
  CaretUp,
} from "@phosphor-icons/react";
import { fetchStoreSections, saveStoreSections } from "../../services/storeMerchandisingApi";
import {
  assembleStorefrontLayout,
  validateSectionDraft,
  SECTION_TYPES,
  SECTION_COPY,
  MAX_SECTIONS,
  MAX_LISTING_REFS,
} from "../../services/storeMerchandising.js";
import { getListingKey, formatPriceCents, normalizePriceCents } from "../../services/catalogQuery.js";
import { announce, prefersReducedMotion } from "../../utils/a11y.js";
import { ScrollFade } from "../ScrollFade";

function listingLabel(item) {
  const key = getListingKey(item);
  const qty = item.isBatch ? ` (${item.quantity ?? "?"} available)` : "";
  return `${item.commonName || "Unknown species"}${qty} — ${formatPriceCents(normalizePriceCents(item))} · ${key}`;
}

function draftId(section) {
  // Local-only stable key for React lists before a section has a server id.
  return section.id || section._localId;
}

let _localIdCounter = 0;
function nextLocalId() {
  _localIdCounter += 1;
  return `local-${Date.now()}-${_localIdCounter}`;
}

export function StorefrontMerchandising({ walletAccount, casualModeActive = false, listings = [] }) {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null); // null | { success, message }
  const [dragIndex, setDragIndex] = useState(null);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  useEffect(() => {
    if (!walletAccount) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await fetchStoreSections(walletAccount);
      if (cancelled) return;
      if (res.success) {
        setSections((res.sections || []).map((s) => ({ ...s, _localId: nextLocalId() })));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [walletAccount]);

  // The live preview — renders through the exact function the public store
  // page uses. `profile` is intentionally omitted (not read by the fn yet).
  const previewSections = useMemo(
    () => assembleStorefrontLayout(null, listings, sections),
    [listings, sections]
  );

  const addSection = (type) => {
    if (sections.length >= MAX_SECTIONS) return;
    setSections((prev) => [
      ...prev,
      {
        _localId: nextLocalId(),
        id: null,
        type,
        title: type === SECTION_TYPES.FEATURED ? "Featured" : "New collection",
        listingRefs: [],
        sortOrder: prev.length,
        visible: true,
      },
    ]);
  };

  const removeSection = (localId) => {
    setSections((prev) => prev.filter((s) => draftId(s) !== localId).map((s, idx) => ({ ...s, sortOrder: idx })));
  };

  const updateSection = (localId, patch) => {
    setSections((prev) => prev.map((s) => (draftId(s) === localId ? { ...s, ...patch } : s)));
  };

  const toggleListingRef = (localId, key) => {
    setSections((prev) =>
      prev.map((s) => {
        if (draftId(s) !== localId) return s;
        const has = s.listingRefs.includes(key);
        if (has) return { ...s, listingRefs: s.listingRefs.filter((r) => r !== key) };
        if (s.listingRefs.length >= MAX_LISTING_REFS) return s;
        return { ...s, listingRefs: [...s.listingRefs, key] };
      })
    );
  };

  const moveSection = useCallback((index, direction) => {
    setSections((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      const reindexed = next.map((s, idx) => ({ ...s, sortOrder: idx }));
      announce(`Moved ${reindexed[target].title || "section"} to position ${target + 1} of ${reindexed.length}`);
      return reindexed;
    });
  }, []);

  // ── Drag-to-reorder (pointer path; keyboard path is moveSection above) ──
  const handleDragStart = (index) => (e) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (index) => (e) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    setSections((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(index, 0, moved);
      return next.map((s, idx) => ({ ...s, sortOrder: idx }));
    });
    setDragIndex(index);
  };
  const handleDragEnd = () => setDragIndex(null);

  const validationError = useMemo(() => {
    for (const section of sections) {
      const result = validateSectionDraft(section);
      if (!result.ok) return result.error;
    }
    return null;
  }, [sections]);

  const handleSave = async () => {
    if (validationError) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const payload = sections.map((s) => ({
        type: s.type,
        title: s.title,
        listingRefs: s.listingRefs,
        sortOrder: s.sortOrder,
        visible: s.visible,
      }));
      const res = await saveStoreSections(payload);
      if (res.success) {
        setSections((res.sections || []).map((s) => ({ ...s, _localId: nextLocalId() })));
        setSaveResult({ success: true, message: SECTION_COPY.saved });
        announce(SECTION_COPY.saved);
      } else {
        setSaveResult({ success: false, message: res.error || SECTION_COPY.saveFailed });
      }
    } catch (err) {
      setSaveResult({ success: false, message: err.message || SECTION_COPY.saveFailed });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="sf-merch" style={{ padding: "1.5rem" }}>
        <SpinnerGap size={20} className="sf-setup__spinner" /> Loading storefront layout…
      </div>
    );
  }

  return (
    <div className="sf-merch" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "1.25rem", marginTop: "1.25rem" }}>
      <div className="sf-setup__header" style={{ marginBottom: "1rem" }}>
        <Stack weight="duotone" size={26} style={{ color: "var(--violet-400, #a78bfa)" }} />
        <div>
          <h2 className="sf-setup__title">Storefront Layout</h2>
          <p className="sf-setup__subtitle">
            {casualModeActive
              ? "Feature your best fish and group listings into collections"
              : "Configure featured highlights and named collections for your public storefront"}
          </p>
        </div>
      </div>

      {sections.length === 0 && (
        <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1rem" }}>
          {SECTION_COPY.emptyState}
        </p>
      )}

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {sections.map((section, index) => (
          <li
            key={draftId(section)}
            draggable
            onDragStart={handleDragStart(index)}
            onDragOver={handleDragOver(index)}
            onDragEnd={handleDragEnd}
            className="glass-card"
            style={{
              padding: "0.9rem 1rem",
              border: section.type === SECTION_TYPES.FEATURED
                ? "1px solid rgba(45,212,191,0.35)"
                : "1px solid var(--glass-border, rgba(255,255,255,0.08))",
              transition: reducedMotion ? "none" : "border-color 0.3s cubic-bezier(0.4,0,0.2,1)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", flexWrap: "wrap" }}>
              {section.type === SECTION_TYPES.FEATURED ? (
                <Star weight="duotone" size={18} style={{ color: "var(--teal-400, #2dd4bf)", marginTop: "0.3rem" }} />
              ) : (
                <Stack weight="duotone" size={18} style={{ color: "var(--violet-400, #a78bfa)", marginTop: "0.3rem" }} />
              )}

              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <input
                  type="text"
                  value={section.title || ""}
                  onChange={(e) => updateSection(draftId(section), { title: e.target.value.slice(0, 60) })}
                  placeholder={section.type === SECTION_TYPES.FEATURED ? "Featured" : "Collection name"}
                  maxLength={60}
                  aria-label={`Section title (${section.type})`}
                  className="sf-setup__input"
                  style={{ marginBottom: "0.4rem" }}
                />
                <ListingPicker
                  listings={listings}
                  selectedKeys={section.listingRefs}
                  onToggle={(key) => toggleListingRef(draftId(section), key)}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => moveSection(index, -1)}
                  disabled={index === 0}
                  aria-label={SECTION_COPY.moveUp}
                  title={SECTION_COPY.moveUp}
                  style={reorderBtnStyle(index === 0)}
                >
                  <ArrowUp size={14} weight="bold" />
                </button>
                <button
                  type="button"
                  onClick={() => moveSection(index, 1)}
                  disabled={index === sections.length - 1}
                  aria-label={SECTION_COPY.moveDown}
                  title={SECTION_COPY.moveDown}
                  style={reorderBtnStyle(index === sections.length - 1)}
                >
                  <ArrowDown size={14} weight="bold" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => updateSection(draftId(section), { visible: !section.visible })}
                aria-label={section.visible ? SECTION_COPY.visibleLabel : SECTION_COPY.hiddenLabel}
                title={section.visible ? SECTION_COPY.visibleLabel : SECTION_COPY.hiddenLabel}
                style={reorderBtnStyle(false)}
              >
                {section.visible ? <Eye size={14} weight="bold" /> : <EyeSlash size={14} weight="bold" />}
              </button>

              <button
                type="button"
                onClick={() => removeSection(draftId(section))}
                aria-label={SECTION_COPY.removeSection}
                title={SECTION_COPY.removeSection}
                style={{ ...reorderBtnStyle(false), color: "var(--accent-red, #f87171)" }}
              >
                <Trash size={14} weight="bold" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => addSection(SECTION_TYPES.FEATURED)}
          disabled={sections.length >= MAX_SECTIONS}
          style={addBtnStyle}
        >
          <Star size={14} weight="bold" /> {SECTION_COPY.addFeatured}
        </button>
        <button
          type="button"
          onClick={() => addSection(SECTION_TYPES.COLLECTION)}
          disabled={sections.length >= MAX_SECTIONS}
          style={addBtnStyle}
        >
          <Plus size={14} weight="bold" /> {SECTION_COPY.addCollection}
        </button>
      </div>

      {validationError && (
        <div style={{ marginTop: "0.75rem", fontSize: "0.78rem", color: "var(--accent-red, #f87171)", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <Warning size={14} weight="bold" /> {validationError}
        </div>
      )}

      <div style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className="sf-setup__submit"
          onClick={handleSave}
          disabled={saving || !!validationError}
        >
          {saving ? (<><SpinnerGap size={16} className="sf-setup__spinner" /> Saving…</>) : (<><Storefront size={16} weight="bold" /> Save layout</>)}
        </button>
      </div>

      {saveResult && (
        <div className={`sf-setup__result ${saveResult.success ? "sf-setup__result--success" : "sf-setup__result--error"}`} style={{ marginTop: "0.75rem" }}>
          {saveResult.success ? <Check size={16} weight="bold" /> : <Warning size={16} weight="bold" />}
          <span>{saveResult.message}</span>
        </div>
      )}

      {/* Live preview — composes assembleStorefrontLayout, the same fn
          store.html's public render will consume. */}
      <div style={{ marginTop: "1.5rem" }}>
        <h3 className="sf-setup__policies-title" style={{ marginBottom: "0.6rem" }}>{SECTION_COPY.previewTitle}</h3>
        {previewSections.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>No active listings to preview yet.</p>
        ) : (
          previewSections.map((section) => (
            <div key={section.id} style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "0.4rem" }}>
                {section.title}
              </div>
              {/* ScrollFade, not a ref: this renders once per section, and a
                  single shared ref would only ever attach to the last one. */}
              <ScrollFade
                focusable
                role="group"
                aria-label={`${section.title} preview`}
                style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.25rem" }}
              >
                {section.listings.map((item) => (
                  <div
                    key={getListingKey(item)}
                    className="glass-card"
                    style={{
                      minWidth: "140px",
                      padding: "0.6rem 0.7rem",
                      border: section.type === SECTION_TYPES.FEATURED
                        ? "1px solid rgba(45,212,191,0.3)"
                        : "1px solid var(--glass-border, rgba(255,255,255,0.08))",
                      fontSize: "0.72rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <strong style={{ display: "block", color: "#fff", fontSize: "0.78rem" }}>{item.commonName}</strong>
                    {formatPriceCents(normalizePriceCents(item))}
                  </div>
                ))}
              </ScrollFade>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Compact, collapsible listing multi-select — no new dialog, just a details/summary panel. */
function ListingPicker({ listings, selectedKeys, onToggle }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ ...reorderBtnStyle(false), width: "auto", padding: "0.35rem 0.6rem", display: "inline-flex", gap: "0.35rem", fontSize: "0.72rem" }}
        aria-expanded={open}
      >
        {open ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
        {selectedKeys.length} listing{selectedKeys.length === 1 ? "" : "s"} selected
      </button>
      {open && (
        <div
          style={{
            marginTop: "0.4rem",
            maxHeight: "220px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            padding: "0.5rem",
            borderRadius: "8px",
            background: "rgba(255,255,255,0.02)",
            border: "1px solid var(--glass-border, rgba(255,255,255,0.08))",
          }}
        >
          {listings.length === 0 ? (
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>No listings yet.</span>
          ) : (
            listings.map((item) => {
              const key = getListingKey(item);
              const checked = selectedKeys.includes(key);
              return (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.74rem", color: "var(--text-secondary)", cursor: "pointer" }}>
                  <input type="checkbox" checked={checked} onChange={() => onToggle(key)} style={{ width: "14px", height: "14px" }} />
                  {listingLabel(item)}
                </label>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function reorderBtnStyle(disabled) {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "36px",
    height: "36px",
    minWidth: "36px",
    minHeight: "36px",
    borderRadius: "8px",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid var(--glass-border, rgba(255,255,255,0.1))",
    color: disabled ? "var(--text-muted)" : "var(--text-secondary)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
  };
}

const addBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.4rem",
  padding: "0.5rem 0.85rem",
  minHeight: "44px",
  fontSize: "0.78rem",
  fontWeight: 600,
  background: "rgba(255,255,255,0.03)",
  border: "1px dashed var(--glass-border, rgba(255,255,255,0.15))",
  borderRadius: "8px",
  color: "var(--text-secondary)",
  cursor: "pointer",
};
