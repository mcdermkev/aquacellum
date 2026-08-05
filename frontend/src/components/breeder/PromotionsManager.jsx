/**
 * PromotionsManager.jsx — Seller promotions authoring + customer segments
 * (Task 21B, Tier B). Mounted as a new "Promotions" subsection in
 * BreederTerminal.
 *
 * MONEY BOUNDARY: this component only creates/lists/pauses/deletes
 * promotion rows and previews `evaluatePromotion` against a sample cart —
 * it never applies a discount to a real order. See promotionEngine.js's
 * documented checkout seam (Tier A/Opus, not built here).
 *
 * Basic single-promo authoring (create/list/pause/delete) is a core seller
 * tool and is NEVER gated. Only the customer-segments view gates on
 * `customer_segmentation` (Hadal) — an earned analytical convenience.
 *
 * Props: { walletAccount, casualModeActive }
 *
 * `totalXp` was removed: it existed only to gate customer segmentation, which now
 * opens on verified sales instead. Leaving the prop would be a parameter nothing
 * reads — the dead-control shape this codebase has been clearing out.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Tag,
  Gift,
  Users,
  Plus,
  Trash,
  Eye,
  EyeSlash,
  Check,
  Warning,
  SpinnerGap,
} from "@phosphor-icons/react";
import { listPromotions, savePromotion, deletePromotion, fetchCustomerSegments } from "../../services/promotionsApi";
import {
  evaluatePromotion,
  validatePromotionDraft,
  normalizePromotion,
  PROMOTION_TYPES,
  PROMOTION_SCOPES,
  PROMOTION_FUNDING,
  PROMOTION_COPY,
} from "../../services/promotionEngine.js";
import { formatPriceCents } from "../../services/catalogQuery.js";
import { hasEntitlement } from "../../services/entitlements.js";
import { useActivityFacts } from "../../hooks/useActivityFacts.js";
import { announce } from "../../utils/a11y.js";

const EMPTY_DRAFT = {
  code: "",
  type: PROMOTION_TYPES.PERCENT,
  value: "",
  scope: PROMOTION_SCOPES.STORE,
  minSubtotalCents: "",
  usageLimit: "",
  funding: PROMOTION_FUNDING.SELLER_FUNDED,
  active: true,
};

// A sample $50 cart used purely for the "preview this promo" affordance —
// never a real order.
const SAMPLE_CART = { items: [{ listingKey: "sample", unitPriceCents: 5000, quantity: 1 }] };

export function PromotionsManager({ walletAccount, casualModeActive = false }) {
  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [segments, setSegments] = useState(null);
  const [segmentsLoading, setSegmentsLoading] = useState(false);

  // Segments need a customer base to segment, so this opens on verified sales
  // rather than XP. `verifiedSales` comes from settled orders — never from the
  // self-reported grow-out `sold` count, which is the distinction breederStats.js
  // exists to enforce.
  const activity = useActivityFacts(walletAccount);
  const canSeeSegments = hasEntitlement("customer_segmentation", { activity });

  const refresh = async () => {
    setLoading(true);
    const res = await listPromotions();
    setPromotions(res.success ? (res.promotions || []) : []);
    setLoading(false);
  };

  useEffect(() => {
    if (!walletAccount) { setLoading(false); return; }
    refresh();
  }, [walletAccount]);

  useEffect(() => {
    if (!walletAccount || !canSeeSegments) return;
    let cancelled = false;
    (async () => {
      setSegmentsLoading(true);
      const res = await fetchCustomerSegments();
      if (!cancelled) {
        setSegments(res.success ? res.segments : null);
        setSegmentsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [walletAccount, canSeeSegments]);

  const startCreate = () => {
    setDraft(EMPTY_DRAFT);
    setCreating(true);
    setSaveResult(null);
  };

  const cancelCreate = () => {
    setCreating(false);
    setSaveResult(null);
  };

  const set = (key) => (e) => {
    const value = key === "active" ? e.target.checked : e.target.value;
    setDraft((d) => ({ ...d, [key]: value }));
  };

  // Build the payload the engine + server both validate, coercing the form's
  // string inputs to the numeric/optional shape validatePromotionDraft expects.
  const buildPayload = (source) => ({
    code: source.code.trim() ? source.code.trim() : null,
    type: source.type,
    value: source.type === PROMOTION_TYPES.PERCENT
      ? Math.round((Number(source.value) || 0) * 100) // buyer enters a percent, e.g. 10 -> 1000 bps
      : Math.round((Number(source.value) || 0) * 100), // buyer enters dollars, e.g. 5 -> 500 cents
    scope: source.scope,
    scopeRefs: [],
    minSubtotalCents: source.minSubtotalCents ? Math.round(Number(source.minSubtotalCents) * 100) : 0,
    usageLimit: source.usageLimit ? Math.round(Number(source.usageLimit)) : null,
    funding: source.funding,
    active: source.active !== false,
  });

  const payload = useMemo(() => buildPayload(draft), [draft]);
  const validation = useMemo(() => validatePromotionDraft(payload), [payload]);
  const preview = useMemo(() => evaluatePromotion(payload, SAMPLE_CART), [payload]);

  const handleSave = async () => {
    if (!validation.ok) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await savePromotion(payload);
      if (res.success) {
        setSaveResult({ success: true, message: PROMOTION_COPY.saved });
        announce(PROMOTION_COPY.saved);
        setCreating(false);
        await refresh();
      } else {
        setSaveResult({ success: false, message: res.error || PROMOTION_COPY.saveFailed });
      }
    } catch (err) {
      setSaveResult({ success: false, message: err.message || PROMOTION_COPY.saveFailed });
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePause = async (promo) => {
    // Send the promo's own already-normalized bps/cents values straight
    // through (not the string-input draft shape) — only `active` flips.
    const n = normalizePromotion(promo);
    const res = await savePromotion({
      id: n.id,
      code: n.code,
      type: n.type,
      value: n.value,
      scope: n.scope,
      scopeRefs: n.scopeRefs,
      minSubtotalCents: n.minSubtotalCents,
      startsAt: n.startsAt,
      endsAt: n.endsAt,
      usageLimit: n.usageLimit,
      funding: n.funding,
      active: !n.active,
    });
    if (res.success) {
      announce(promo.active ? PROMOTION_COPY.pausedLabel : PROMOTION_COPY.activeLabel);
      await refresh();
    }
  };

  const handleDelete = async (id) => {
    const res = await deletePromotion(id);
    if (res.success) {
      announce(PROMOTION_COPY.removePromotion);
      await refresh();
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "1.5rem" }}>
        <SpinnerGap size={20} className="sf-setup__spinner" /> Loading promotions…
      </div>
    );
  }

  return (
    <div className="sf-merch">
      <div className="sf-setup__header" style={{ marginBottom: "1rem" }}>
        <Tag weight="duotone" size={26} style={{ color: "var(--amber-400, #fbbf24)" }} />
        <div>
          <h2 className="sf-setup__title">Promotions</h2>
          <p className="sf-setup__subtitle">
            {casualModeActive
              ? "Create discount codes or automatic deals for buyers"
              : "Author codes and automatic promotions for your storefront"}
          </p>
        </div>
      </div>

      {promotions.length === 0 && !creating && (
        <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1rem" }}>{PROMOTION_COPY.emptyState}</p>
      )}

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {promotions.map((promo) => (
          <li key={promo.id} className="glass-card" style={{ padding: "0.75rem 1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.6rem", flexWrap: "wrap" }}>
              <div>
                <strong style={{ color: "#fff", fontFamily: "'JetBrains Mono', monospace" }}>
                  {promo.code || "Automatic"}
                </strong>
                <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
                  {promo.type === PROMOTION_TYPES.PERCENT ? `${promo.value / 100}% off` : `${formatPriceCents(promo.value)} off`}
                  {" · "}{promo.scope}
                  {" · "}{PROMOTION_COPY[promo.funding]}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <span style={{ fontSize: "0.7rem", color: promo.active ? "var(--teal-400, #2dd4bf)" : "var(--text-muted)" }}>
                  {promo.active ? PROMOTION_COPY.activeLabel : PROMOTION_COPY.pausedLabel}
                </span>
                <button
                  type="button"
                  onClick={() => handleTogglePause(promo)}
                  aria-label={promo.active ? "Pause promotion" : "Activate promotion"}
                  style={iconBtnStyle}
                >
                  {promo.active ? <EyeSlash size={14} weight="bold" /> : <Eye size={14} weight="bold" />}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(promo.id)}
                  aria-label={PROMOTION_COPY.removePromotion}
                  style={{ ...iconBtnStyle, color: "var(--accent-red, #f87171)" }}
                >
                  <Trash size={14} weight="bold" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {creating ? (
        <div className="glass-card" style={{ padding: "1rem", marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <label style={fieldLabelStyle} htmlFor="promo-code">
            Code (leave blank for an automatic discount)
          </label>
          <input
            id="promo-code"
            type="text"
            value={draft.code}
            onChange={set("code")}
            placeholder="e.g. WELCOME10"
            maxLength={40}
            className="sf-setup__input"
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
            <div>
              <label style={fieldLabelStyle} htmlFor="promo-type">Discount type</label>
              <select id="promo-type" value={draft.type} onChange={set("type")} className="sf-setup__input">
                <option value={PROMOTION_TYPES.PERCENT}>Percent off</option>
                <option value={PROMOTION_TYPES.FIXED}>Fixed amount off</option>
              </select>
            </div>
            <div>
              <label style={fieldLabelStyle} htmlFor="promo-value">
                {draft.type === PROMOTION_TYPES.PERCENT ? "Percent (e.g. 10 for 10%)" : "Dollar amount off"}
              </label>
              <input
                id="promo-value"
                type="number"
                min="0"
                step="any"
                value={draft.value}
                onChange={set("value")}
                className="sf-setup__input"
              />
            </div>
          </div>

          <div>
            <label style={fieldLabelStyle} htmlFor="promo-scope">Applies to</label>
            <select id="promo-scope" value={draft.scope} onChange={set("scope")} className="sf-setup__input">
              <option value={PROMOTION_SCOPES.STORE}>Entire store</option>
            </select>
            <span className="sf-setup__hint">Collection/listing-specific promotions are configured from the merchandising editor once a collection exists.</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
            <div>
              <label style={fieldLabelStyle} htmlFor="promo-min">Minimum order ($, optional)</label>
              <input id="promo-min" type="number" min="0" step="any" value={draft.minSubtotalCents} onChange={set("minSubtotalCents")} className="sf-setup__input" />
            </div>
            <div>
              <label style={fieldLabelStyle} htmlFor="promo-limit">Usage limit (optional)</label>
              <input id="promo-limit" type="number" min="1" step="1" value={draft.usageLimit} onChange={set("usageLimit")} className="sf-setup__input" />
            </div>
          </div>

          <div>
            <label style={fieldLabelStyle} htmlFor="promo-funding">Who covers this discount</label>
            <select id="promo-funding" value={draft.funding} onChange={set("funding")} className="sf-setup__input">
              <option value={PROMOTION_FUNDING.SELLER_FUNDED}>{PROMOTION_COPY.seller_funded}</option>
              <option value={PROMOTION_FUNDING.PLATFORM_FUNDED}>{PROMOTION_COPY.platform_funded}</option>
            </select>
          </div>

          {/* Preview only — never a charge. */}
          <div style={{ padding: "0.6rem 0.75rem", borderRadius: "8px", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)" }}>
            <strong style={{ fontSize: "0.75rem", color: "var(--amber-400, #fbbf24)" }}>{PROMOTION_COPY.previewTitle}</strong>
            <p style={{ margin: "0.3rem 0 0", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
              {preview.applicable
                ? `This would take ${formatPriceCents(preview.discountCents)} off a ${formatPriceCents(5000)} order.`
                : `Not yet applicable to a sample order (${preview.reason}).`}
            </p>
          </div>

          {!validation.ok && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", color: "var(--accent-red, #f87171)" }}>
              <Warning size={14} weight="bold" /> {validation.error}
            </div>
          )}

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="sf-setup__submit" onClick={handleSave} disabled={saving || !validation.ok}>
              {saving ? (<><SpinnerGap size={16} className="sf-setup__spinner" /> Saving…</>) : (<><Gift size={16} weight="bold" /> Save promotion</>)}
            </button>
            <button type="button" onClick={cancelCreate} style={{ ...iconBtnStyle, width: "auto", padding: "0.5rem 0.9rem" }}>
              Cancel
            </button>
          </div>

          {saveResult && (
            <div className={`sf-setup__result ${saveResult.success ? "sf-setup__result--success" : "sf-setup__result--error"}`}>
              {saveResult.success ? <Check size={16} weight="bold" /> : <Warning size={16} weight="bold" />}
              <span>{saveResult.message}</span>
            </div>
          )}
        </div>
      ) : (
        <button type="button" onClick={startCreate} style={addBtnStyle}>
          <Plus size={14} weight="bold" /> {PROMOTION_COPY.addPromotion}
        </button>
      )}

      {/* Customer segments — gated behind customer_segmentation (Hadal). */}
      <div style={{ marginTop: "1.5rem", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "1.25rem" }}>
        <div className="sf-setup__header" style={{ marginBottom: "0.75rem" }}>
          <Users weight="duotone" size={24} style={{ color: "var(--violet-400, #a78bfa)" }} />
          <div>
            <h2 className="sf-setup__title" style={{ fontSize: "1.1rem" }}>{PROMOTION_COPY.segmentsTitle}</h2>
          </div>
        </div>

        {!canSeeSegments ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{PROMOTION_COPY.segmentsLocked}</p>
        ) : segmentsLoading ? (
          <SpinnerGap size={18} className="sf-setup__spinner" />
        ) : segments ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
            <SegmentColumn title={PROMOTION_COPY.repeatBuyers} buyers={segments.repeatBuyers} />
            <SegmentColumn title={PROMOTION_COPY.highValueBuyers} buyers={segments.highValueBuyers} showSpend />
            <SegmentColumn title={PROMOTION_COPY.atRiskBuyers} buyers={segments.atRiskBuyers} />
          </div>
        ) : (
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>No segment data yet.</p>
        )}
      </div>
    </div>
  );
}

function SegmentColumn({ title, buyers = [], showSpend = false }) {
  return (
    <div className="glass-card" style={{ padding: "0.75rem 1rem" }}>
      <strong style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>{title}</strong>
      {buyers.length === 0 ? (
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.4rem 0 0" }}>None yet.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: "0.4rem 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          {buyers.map((b) => (
            <li key={b.alias} style={{ fontSize: "0.75rem", color: "var(--text-primary, #fff)", display: "flex", justifyContent: "space-between" }}>
              <span>{b.alias}</span>
              {showSpend && <span style={{ color: "var(--text-muted)" }}>{formatPriceCents(b.totalSpentCents)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const fieldLabelStyle = { fontSize: "0.72rem", color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" };

const iconBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "32px",
  height: "32px",
  minWidth: "32px",
  minHeight: "32px",
  borderRadius: "8px",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--glass-border, rgba(255,255,255,0.1))",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

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
  marginTop: "1rem",
};
