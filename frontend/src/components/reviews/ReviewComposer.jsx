import React, { useState } from "react";
import { Star } from "@phosphor-icons/react";
import { submitReview } from "../../services/reviewsApi";
import { applicableRatingDimensions } from "../../services/reviewEligibility";
import { announce } from "../../utils/a11y";

const DIMENSION_LABELS = Object.freeze({
  health: "Live arrival / health",
  accuracy: "Accuracy vs. listing",
  packaging: "Packaging",
  communication: "Communication",
  fulfillment: "Fulfillment",
});

/**
 * ReviewComposer — the leave-a-review flow (Task 20 §4).
 *
 * Only ever rendered by a caller that has ALREADY checked
 * `isOrderReviewable` — this component does not re-check eligibility itself
 * (that's the server's job on submit, and the caller's job for whether to
 * show the form at all). It only knows how to collect and submit a rating.
 *
 * Rating widget uses `radiogroup`/`radio` ARIA semantics with arrow-key
 * navigation so it's fully keyboard-operable (spec §5 a11y requirement).
 *
 * Props:
 *  - orderId / orderRef: identifies the order being reviewed (at least one required)
 *  - fulfillmentMethod: a FULFILLMENT_METHODS value, drives applicableRatingDimensions
 *  - onSubmitted: (review) => void — called after a successful submit
 *  - onCancel: () => void
 *  - casualModeActive: softens copy
 */
export function ReviewComposer({ orderId, orderRef, fulfillmentMethod, onSubmitted, onCancel, casualModeActive = false }) {
  const dimensions = applicableRatingDimensions(fulfillmentMethod);
  const [overall, setOverall] = useState(0);
  const [dimensionRatings, setDimensionRatings] = useState({});
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const setDimension = (dim, value) => setDimensionRatings((prev) => ({ ...prev, [dim]: value }));

  const canSubmit = overall >= 1 && overall <= 5 && !submitting;

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitReview({
        orderId,
        orderRef,
        overall,
        ...dimensionRatings,
        body: body.trim() || undefined,
      });
      if (!res.success) {
        setError(res.error || "Could not submit your review.");
        return;
      }
      announce(casualModeActive ? "Review submitted — thank you!" : "Review submitted.");
      if (onSubmitted) onSubmitted(res.review);
    } catch (err) {
      setError(err.message || "Could not submit your review.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-card"
      aria-label={casualModeActive ? "Leave a review" : "Submit review"}
      style={{ padding: "1.1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}
    >
      <h3 style={{ fontFamily: "Outfit, sans-serif", fontSize: "1rem", color: "#fff", margin: 0 }}>
        {casualModeActive ? "How did it go?" : "Leave a review"}
      </h3>

      <RatingRadioGroup
        label={casualModeActive ? "Overall rating" : "Overall"}
        value={overall}
        onChange={setOverall}
        required
      />

      {dimensions.map((dim) => (
        <RatingRadioGroup
          key={dim}
          label={DIMENSION_LABELS[dim] || dim}
          value={dimensionRatings[dim] || 0}
          onChange={(v) => setDimension(dim, v)}
          compact
        />
      ))}

      <div>
        <label htmlFor="review-body" style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
          {casualModeActive ? "Tell other buyers about it (optional)" : "Written review (optional)"}
        </label>
        <textarea
          id="review-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={casualModeActive ? "Healthy on arrival, great communication..." : "Describe the fish, packaging, and experience."}
          style={{ width: "100%", padding: "0.6rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", fontSize: "0.8rem", fontFamily: "'Plus Jakarta Sans', sans-serif", resize: "vertical" }}
        />
      </div>

      {error && (
        <div role="alert" style={{ fontSize: "0.75rem", color: "var(--accent-red, #f87171)" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            flex: 1, minHeight: "44px", padding: "0.55rem 1rem", borderRadius: "10px", border: "none",
            background: canSubmit ? "linear-gradient(135deg, var(--teal-400, #2dd4bf), var(--violet-400, #a78bfa))" : "rgba(255,255,255,0.05)",
            color: canSubmit ? "#04231a" : "var(--text-muted)", fontWeight: 700, fontSize: "0.85rem",
            cursor: canSubmit ? "pointer" : "not-allowed",
            boxShadow: canSubmit ? "0 0 16px rgba(45,212,191,0.25)" : "none",
          }}
        >
          {submitting ? "Submitting…" : casualModeActive ? "Post review" : "Submit review"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary" style={{ minHeight: "44px", padding: "0.55rem 1rem", fontSize: "0.85rem" }}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Accessible 1-5 star rating input using ARIA `radiogroup`/`radio`
 * semantics with arrow-key navigation, per spec §5.
 */
function RatingRadioGroup({ label, value, onChange, required = false, compact = false }) {
  const handleKeyDown = (e, star) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(5, (star || value || 0) + 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(1, (star || value || 0) - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onChange(star);
    }
  };

  return (
    <div>
      <span
        id={`rating-label-${label.replace(/\s+/g, "-")}`}
        style={{ display: "block", fontSize: compact ? "0.72rem" : "0.78rem", color: "var(--text-secondary)", marginBottom: "0.3rem" }}
      >
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`rating-label-${label.replace(/\s+/g, "-")}`}
        style={{ display: "inline-flex", gap: compact ? "0.2rem" : "0.3rem" }}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            tabIndex={value === star || (value === 0 && star === 1) ? 0 : -1}
            onClick={() => onChange(star)}
            onKeyDown={(e) => handleKeyDown(e, star)}
            style={{
              width: compact ? "32px" : "44px",
              height: compact ? "32px" : "44px",
              minWidth: "32px",
              minHeight: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              cursor: "pointer",
              borderRadius: "8px",
              transition: "transform 0.15s ease",
            }}
          >
            <Star
              weight={star <= value ? "fill" : "regular"}
              size={compact ? 18 : 24}
              color={star <= value ? "#fbbf24" : "rgba(251,191,36,0.3)"}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

export default ReviewComposer;
