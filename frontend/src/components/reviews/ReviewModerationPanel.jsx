/**
 * ReviewModerationPanel.jsx
 *
 * Curator review-reports queue (Task 20 §4). Composes the exact
 * ModerationPanel.jsx pattern (frontend/src/components/reef/ModerationPanel.jsx)
 * — same pending/resolved filter tabs, same card layout, same two-action
 * shape — rather than inventing a new moderation UI. The one structural
 * difference is the action set: reviews only ever get `dismiss` (report was
 * unfounded) or `hide` (review removed from public view), matching
 * `?action=moderate-review`'s `hide | dismiss` contract — there's no
 * mute/ban here, since a review report isn't a behavioral offense against
 * a person, it's a dispute over one piece of content.
 *
 * Auth: this component doesn't itself check `canModerate` — like
 * ModerationPanel.jsx, that's the caller's job (mount it behind the same
 * Hadal-tier gate used for the community ModerationPanel). The real
 * authorization boundary is server-side: `?action=moderate-review` requires
 * a verified curator (CURATOR_WALLET) or the CRON_SECRET backend — this UI
 * calling it with an unauthorized session simply gets a 403.
 */
import { useState, useEffect } from "react";
import { fetchReviewReports, moderateReview } from "../../services/reefTrustApi";
import { ReviewStars } from "./ReviewStars";

const ACTION_LABELS = {
  dismiss: { label: "Dismiss report", icon: "✓", color: "#10b981" },
  hide: { label: "Hide review", icon: "🙈", color: "#ef4444" },
};

function ReportedReviewCard({ item, onAction }) {
  const [actionInProgress, setActionInProgress] = useState(null);
  const review = item.review;

  const handleAction = async (action) => {
    setActionInProgress(action);
    await onAction(item.id, action);
    setActionInProgress(null);
  };

  return (
    <article
      className="mod-panel__item"
      style={{
        padding: "1rem",
        borderRadius: "10px",
        background: "rgba(255, 255, 255, 0.02)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        marginBottom: "0.75rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
        <div>
          <span
            style={{
              fontSize: "0.6rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              padding: "0.15rem 0.5rem",
              borderRadius: "4px",
              background: "rgba(251, 191, 36, 0.15)",
              color: "var(--accent-amber)",
            }}
          >
            {item.reason || "reported"}
          </span>
          <span style={{ marginLeft: "0.5rem", fontSize: "0.65rem", color: "var(--text-muted)" }}>
            {new Date(item.created_at).toLocaleDateString()}
          </span>
        </div>
        <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>#{item.id?.slice(0, 8)}</span>
      </div>

      {item.details && (
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.72rem", color: "var(--text-secondary)" }}>
          Report note: {item.details}
        </p>
      )}

      {/* The reported review itself — enough context to judge the report. */}
      {review && (
        <div
          style={{
            padding: "0.75rem",
            borderRadius: "8px",
            background: "rgba(0, 0, 0, 0.2)",
            marginBottom: "0.75rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
            <ReviewStars average={review.overall} count={0} size={12} showCount={false} />
            <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>
              {review.status === "hidden" ? "already hidden" : review.status}
            </span>
          </div>
          {review.body && (
            <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>{review.body}</p>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
        {Object.entries(ACTION_LABELS).map(([key, { label, icon, color }]) => (
          <button
            key={key}
            onClick={() => handleAction(key)}
            disabled={!!actionInProgress}
            style={{
              padding: "0.3rem 0.6rem",
              borderRadius: "6px",
              border: `1px solid ${color}33`,
              background: actionInProgress === key ? `${color}22` : "transparent",
              color,
              fontSize: "0.65rem",
              cursor: actionInProgress ? "wait" : "pointer",
              opacity: actionInProgress && actionInProgress !== key ? 0.5 : 1,
            }}
          >
            {icon} {label}
          </button>
        ))}
      </div>
    </article>
  );
}

export function ReviewModerationPanel({ onBack }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("pending"); // pending | resolved | all
  const [stats, setStats] = useState({ pending: 0, resolved: 0 });

  useEffect(() => {
    loadReports();
  }, [filter]);

  async function loadReports() {
    setLoading(true);
    setError(null);
    const result = await fetchReviewReports(filter);
    if (!result.success) {
      setReports([]);
      setError(result.error || "Could not load review reports");
    } else {
      setReports(result.reports || []);
      setStats(result.stats || { pending: 0, resolved: 0 });
    }
    setLoading(false);
  }

  async function handleAction(reportId, action) {
    const res = await moderateReview(reportId, action);
    if (!res.success) {
      setError(res.error || "Could not moderate review");
      return;
    }
    await loadReports();
  }

  return (
    <section style={{ maxWidth: "800px", margin: "0 auto" }} aria-label="Review Reports Queue">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <button
            onClick={onBack}
            style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "0.75rem", cursor: "pointer", padding: 0, marginBottom: "0.25rem" }}
          >
            ← Back
          </button>
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#fff" }}>⭐ Review Reports</h2>
        </div>
        <span
          style={{
            fontSize: "0.7rem",
            padding: "0.25rem 0.6rem",
            borderRadius: "6px",
            background: stats.pending > 0 ? "rgba(248, 113, 113, 0.1)" : "rgba(52, 211, 153, 0.1)",
            color: stats.pending > 0 ? "var(--accent-red)" : "var(--accent-green)",
            fontWeight: 600,
          }}
        >
          {stats.pending} pending
        </span>
      </div>

      <div
        style={{
          display: "flex",
          gap: "0.25rem",
          marginBottom: "1rem",
          padding: "0.25rem",
          borderRadius: "8px",
          background: "rgba(255, 255, 255, 0.03)",
          border: "1px solid rgba(255, 255, 255, 0.06)",
        }}
      >
        {[
          { key: "pending", label: `Pending (${stats.pending})` },
          { key: "resolved", label: `Resolved (${stats.resolved})` },
          { key: "all", label: "All" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            style={{
              flex: 1,
              padding: "0.4rem",
              borderRadius: "6px",
              border: "none",
              background: filter === tab.key ? "rgba(56, 189, 248, 0.12)" : "transparent",
              color: filter === tab.key ? "#fff" : "var(--text-muted)",
              fontSize: "0.7rem",
              fontWeight: filter === tab.key ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>Loading reported reviews...</div>
      ) : error ? (
        <div role="alert" style={{ textAlign: "center", padding: "1.25rem", color: "var(--accent-red)" }}>
          {error}. The queue count was not treated as zero.
        </div>
      ) : reports.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", borderRadius: "12px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid rgba(255, 255, 255, 0.05)" }}>
          <p style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>✅</p>
          <p style={{ fontSize: "0.9rem", color: "#fff", fontWeight: 600, margin: 0 }}>Queue is clear</p>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.25rem 0 0" }}>
            No {filter === "pending" ? "pending" : ""} review reports.
          </p>
        </div>
      ) : (
        <div>
          {reports.map((item) => (
            <ReportedReviewCard key={item.id} item={item} onAction={handleAction} />
          ))}
        </div>
      )}
    </section>
  );
}

export default ReviewModerationPanel;
