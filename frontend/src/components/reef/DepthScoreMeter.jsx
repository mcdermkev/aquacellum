/**
 * DepthScoreMeter.jsx
 * 
 * Visual progress indicator showing current Depth Score within tier.
 * - Tier badge with icon and label
 * - Progress bar to next tier
 * - Tooltip with explanation
 * - Click → detailed breakdown of recent score events
 */

import { useState } from "react";
import { useDepthScore, useDepthScoreHistory } from "../../hooks/useDepthScore";
import { DEPTH_TIERS } from "../../services/depthScoreApi";

function ScoreEventRow({ event }) {
  const isPositive = event.delta > 0;
  return (
    <div className="depth-event-row">
      <span className={`depth-event-delta ${isPositive ? "depth-event-delta--positive" : "depth-event-delta--negative"}`}>
        {isPositive ? "+" : ""}{event.delta}
      </span>
      <span className="depth-event-reason">{event.reason}</span>
      <time className="depth-event-time">
        {new Date(event.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </time>
    </div>
  );
}

export function DepthScoreMeter({ walletAddress, compact = false }) {
  const { data: scoreData, isLoading } = useDepthScore(walletAddress);
  const [showDetails, setShowDetails] = useState(false);
  const { data: history = [] } = useDepthScoreHistory(walletAddress, { limit: 10 });

  if (isLoading || !scoreData) {
    return compact ? null : (
      <div className="depth-meter depth-meter--loading">
        <div className="skeleton-text" style={{ width: "120px", height: "1.2rem" }} />
      </div>
    );
  }

  const { depth_score: score, depth_tier: tier } = scoreData;
  const currentTierInfo = DEPTH_TIERS.find((t) => t.key === tier) || DEPTH_TIERS[0];
  const currentTierIndex = DEPTH_TIERS.findIndex((t) => t.key === tier);
  const nextTier = DEPTH_TIERS[currentTierIndex + 1];

  // Calculate progress within current tier
  const tierMin = currentTierInfo.min;
  const tierMax = nextTier ? nextTier.min : currentTierInfo.min + 1000;
  const progress = Math.min(((score - tierMin) / (tierMax - tierMin)) * 100, 100);

  if (compact) {
    return (
      <span
        className="depth-meter-compact"
        style={{ color: currentTierInfo.color }}
        title={`Depth Score: ${score} (${tier})`}
      >
        {currentTierInfo.icon} {tier}
      </span>
    );
  }

  return (
    <div className="depth-meter" aria-label={`Depth Score: ${score}, Tier: ${tier}`}>
      {/* Tier badge */}
      <button
        className="depth-meter__badge"
        onClick={() => setShowDetails(!showDetails)}
        style={{ borderColor: currentTierInfo.color }}
        aria-expanded={showDetails}
        aria-label="View depth score details"
      >
        <span className="depth-meter__icon">{currentTierInfo.icon}</span>
        <div className="depth-meter__info">
          <span className="depth-meter__tier" style={{ color: currentTierInfo.color }}>
            {tier}
          </span>
          <span className="depth-meter__score">{score} pts</span>
        </div>
      </button>

      {/* Progress bar */}
      <div className="depth-meter__progress">
        <div className="depth-meter__bar">
          <div
            className="depth-meter__fill"
            style={{ width: `${progress}%`, backgroundColor: currentTierInfo.color }}
          />
        </div>
        {nextTier && (
          <span className="depth-meter__next">
            {nextTier.icon} {nextTier.label} at {nextTier.min}
          </span>
        )}
      </div>

      {/* Expandable details */}
      {showDetails && (
        <div className="depth-meter__details">
          <h4>Recent Score Activity</h4>
          {history.length === 0 ? (
            <p className="text-muted text-sm">No score events yet. Contribute to the community to earn Depth!</p>
          ) : (
            <div className="depth-meter__history">
              {history.map((event) => (
                <ScoreEventRow key={event.id} event={event} />
              ))}
            </div>
          )}

          {/* Tier explanation */}
          <details className="depth-meter__explainer">
            <summary>What is Depth Score?</summary>
            <p>
              Depth Score measures your quality and trust in the community.
              Unlike XP (which tracks volume), Depth rewards meaningful contributions:
              Expert Audits, helpful Species Insights, spawn success, and mentoring others.
            </p>
            <div className="depth-meter__tiers-list">
              {DEPTH_TIERS.map((t) => (
                <div key={t.key} className="depth-meter__tier-row">
                  <span style={{ color: t.color }}>{t.icon} {t.label}</span>
                  <span className="text-muted">{t.min}+ pts</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

export default DepthScoreMeter;
