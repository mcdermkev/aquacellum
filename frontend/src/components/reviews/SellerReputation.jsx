import React, { useEffect, useState } from "react";
import { SealCheck, ChatCircleDots, Flag } from "@phosphor-icons/react";
import { fetchSellerReviews, respondToReview } from "../../services/reviewsApi";
import { reportReview } from "../../services/reefTrustApi";
import { aggregateReviews, reputationSummary } from "../../services/reviewAggregation";
import { canRespondToReview } from "../../services/reviewEligibility";
import { ReviewStars } from "./ReviewStars";
import { useAuth } from "../../contexts/AuthContext";

/**
 * SellerReputation — the full public reputation surface (Task 20 §4/§5):
 * reputation summary, per-dimension bars, and the review list with photos
 * and seller responses. Shown to EVERYONE, signed in or not — `view_reputation`
 * is a REQUIRED entitlement (frontend/src/services/entitlements.js) and is
 * never wrapped in an XP/tier check anywhere in this component.
 *
 * `deep_reputation_insights` (Hadal-gated trend analysis) is intentionally
 * NOT part of this component — it's an additive panel a caller may render
 * alongside this one, gated separately, per the spec's "base summary + full
 * review list are universal; only deeper trend analysis is gated" split.
 *
 * Props:
 *  - sellerWallet: the seller whose reviews to show
 *  - casualModeActive: softens copy
 */
export function SellerReputation({ sellerWallet, casualModeActive = false }) {
  const { account } = useAuth() || {};
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reportingId, setReportingId] = useState(null);
  const [respondingId, setRespondingId] = useState(null);
  const [responseText, setResponseText] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchSellerReviews(sellerWallet, { limit: 50 });
      setReviews(res.success ? res.reviews || [] : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!sellerWallet) return;
    load();
  }, [sellerWallet]);

  const aggregate = aggregateReviews(reviews);
  const summary = reputationSummary(aggregate);

  const handleReport = async (reviewId) => {
    const reason = window.prompt(
      "Why are you reporting this review? (spam, inappropriate, misinformation, harassment, other)"
    );
    if (!reason) return;
    const normalized = reason.trim().toLowerCase();
    const allowed = ["spam", "inappropriate", "misinformation", "harassment", "other"];
    const finalReason = allowed.includes(normalized) ? normalized : "other";
    setReportingId(reviewId);
    try {
      await reportReview(reviewId, finalReason);
    } finally {
      setReportingId(null);
    }
  };

  const startResponse = (reviewId) => {
    setRespondingId(reviewId);
    setResponseText("");
  };

  const submitResponse = async (reviewId) => {
    if (!responseText.trim()) return;
    await respondToReview(reviewId, responseText.trim());
    setRespondingId(null);
    setResponseText("");
    await load();
  };

  if (loading) {
    return <div className="shimmer-placeholder" style={{ height: "180px", borderRadius: "12px" }} />;
  }

  return (
    <section aria-label={casualModeActive ? "Reviews" : "Seller reputation"} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h2 style={{ fontFamily: "Outfit, sans-serif", fontSize: "1.1rem", color: "#fff", margin: 0 }}>
        {casualModeActive ? "Reviews" : "Seller Reputation"}
      </h2>

      {/* Reputation summary — never a fake perfect rating for a New seller */}
      <div className="glass-card" style={{ padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
          <ReviewStars average={aggregate.average} count={aggregate.count} size={18} />
          <span
            style={{
              fontSize: "0.72rem", fontWeight: 600, padding: "0.2rem 0.6rem", borderRadius: "12px",
              background: summary.tone === "good" ? "rgba(52,211,153,0.1)" : summary.tone === "new" ? "rgba(255,255,255,0.04)" : "rgba(251,191,36,0.1)",
              color: summary.tone === "good" ? "#34d399" : summary.tone === "new" ? "var(--text-muted)" : "#fbbf24",
            }}
          >
            {summary.label}
          </span>
        </div>

        {/* Per-dimension bars — teal→cyan progression, health leans emerald */}
        {aggregate.count > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {Object.entries(aggregate.dimensionAverages)
              .filter(([, value]) => value != null)
              .map(([dim, value]) => (
                <DimensionBar key={dim} dimension={dim} value={value} />
              ))}
          </div>
        )}
      </div>

      {/* Review list */}
      {reviews.length === 0 ? (
        <div className="glass-card" style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
          {casualModeActive ? "No reviews yet — be the first to leave one after your order arrives!" : "No published reviews yet."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {reviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              viewerWallet={account}
              respondingId={respondingId}
              responseText={responseText}
              onResponseTextChange={setResponseText}
              onStartResponse={startResponse}
              onSubmitResponse={submitResponse}
              onCancelResponse={() => setRespondingId(null)}
              onReport={handleReport}
              reportingId={reportingId}
              casualModeActive={casualModeActive}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const DIMENSION_LABELS = Object.freeze({
  health: "Live arrival / health",
  accuracy: "Accuracy",
  packaging: "Packaging",
  communication: "Communication",
  fulfillment: "Fulfillment",
});

function DimensionBar({ dimension, value }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  const isHealth = dimension === "health";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
      <span style={{ fontSize: "0.68rem", color: "var(--text-secondary)", width: "150px", flexShrink: 0 }}>
        {DIMENSION_LABELS[dimension] || dimension}
      </span>
      <div style={{ flex: 1, height: "6px", borderRadius: "3px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`, height: "100%", borderRadius: "3px",
            background: isHealth ? "#34d399" : "linear-gradient(90deg, #2dd4bf, #22d3ee)",
          }}
        />
      </div>
      <span style={{ fontSize: "0.68rem", fontFamily: "monospace", color: "var(--text-secondary)", width: "24px", textAlign: "right" }}>
        {value.toFixed(1)}
      </span>
    </div>
  );
}

function ReviewCard({
  review, viewerWallet, respondingId, responseText, onResponseTextChange,
  onStartResponse, onSubmitResponse, onCancelResponse, onReport, reportingId, casualModeActive,
}) {
  const canRespond = canRespondToReview(
    { sellerWallet: review.sellerWallet, sellerResponse: review.sellerResponse },
    { viewerWallet }
  );
  const isResponding = respondingId === review.id;

  return (
    <article className="glass-card" style={{ padding: "1rem 1.1rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.4rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <ReviewStars average={review.overall} count={0} size={13} showCount={false} />
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", fontSize: "0.65rem", fontWeight: 600, color: "#2dd4bf" }}
            title="Verified purchase"
          >
            <SealCheck weight="duotone" size={14} color="#2dd4bf" />
            Verified purchase
          </span>
        </div>
        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
          {review.createdAt ? new Date(review.createdAt).toLocaleDateString() : ""}
        </span>
      </div>

      {review.body && (
        <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.55, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {review.body}
        </p>
      )}

      {Array.isArray(review.photoUrls) && review.photoUrls.length > 0 && (
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {review.photoUrls.map((url, idx) => (
            <img
              key={idx}
              src={url}
              alt={`Review photo ${idx + 1}`}
              loading="lazy"
              style={{ width: "64px", height: "64px", borderRadius: "8px", objectFit: "cover", border: "1px solid var(--glass-border)" }}
            />
          ))}
        </div>
      )}

      {review.sellerResponse && (
        <div style={{ marginLeft: "0.5rem", paddingLeft: "0.75rem", borderLeft: "2px solid rgba(167,139,250,0.4)" }}>
          <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "#a78bfa", textTransform: "uppercase", letterSpacing: "0.03em" }}>
            Seller response
          </span>
          <p style={{ margin: "0.2rem 0 0", fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
            {review.sellerResponse}
          </p>
        </div>
      )}

      {canRespond && !isResponding && (
        <button
          type="button"
          onClick={() => onStartResponse(review.id)}
          style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "0.3rem", background: "none", border: "none", color: "#a78bfa", fontSize: "0.72rem", cursor: "pointer", padding: 0, minHeight: "32px" }}
        >
          <ChatCircleDots size={14} /> Respond
        </button>
      )}

      {isResponding && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <textarea
            value={responseText}
            onChange={(e) => onResponseTextChange(e.target.value)}
            placeholder="Thank the buyer or clarify anything — this is shown publicly."
            rows={2}
            maxLength={1000}
            style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", fontSize: "0.78rem", fontFamily: "inherit", resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button type="button" onClick={() => onSubmitResponse(review.id)} className="btn-primary" style={{ minHeight: "32px", padding: "0.3rem 0.75rem", fontSize: "0.72rem" }}>
              Post response
            </button>
            <button type="button" onClick={onCancelResponse} className="btn-secondary" style={{ minHeight: "32px", padding: "0.3rem 0.75rem", fontSize: "0.72rem" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => onReport(review.id)}
        disabled={reportingId === review.id}
        aria-label={casualModeActive ? "Report this review" : "Report review"}
        style={{ alignSelf: "flex-end", display: "inline-flex", alignItems: "center", gap: "0.25rem", background: "none", border: "none", color: "var(--text-muted)", fontSize: "0.65rem", cursor: "pointer", padding: 0, minHeight: "32px" }}
      >
        <Flag size={12} /> {reportingId === review.id ? "Reporting…" : "Report"}
      </button>
    </article>
  );
}

export default SellerReputation;
