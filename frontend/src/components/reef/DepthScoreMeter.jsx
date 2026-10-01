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
import { Anchor, CaretDown, Info } from "@phosphor-icons/react";
import { useDepthScore, useDepthScoreHistory } from "../../hooks/useDepthScore";
import { DEPTH_TIERS } from "../../services/depthScoreApi";
import "./ProfileDaylight.css";

/**
 * Derive a Depth tier key from a raw reputation score.
 */
function deriveTierFromScore(score) {
  for (let i = DEPTH_TIERS.length - 1; i >= 0; i--) {
    if (score >= DEPTH_TIERS[i].min) return DEPTH_TIERS[i].key;
  }
  return "Shallow";
}

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

export function DepthScoreMeter({ walletAddress, compact = false, casualModeActive = false, fallbackScore, fallbackTier }) {
  const { data: scoreData, isLoading } = useDepthScore(walletAddress);
  const [showDetails, setShowDetails] = useState(false);
  const { data: history = [] } = useDepthScoreHistory(walletAddress, { limit: 10 });

  // Profile Depth fields are an initial rendering fallback only. XP is never
  // substituted here because it is a separate activity ledger.
  const resolvedScore = scoreData?.depth_score ?? fallbackScore ?? 0;
  const resolvedTier = scoreData?.depth_tier ?? fallbackTier ?? deriveTierFromScore(resolvedScore);

  // If still loading from Supabase AND no fallback was provided, show skeleton
  if (isLoading && fallbackScore == null) {
    return compact ? null : (
      <div className="depth-meter depth-meter--loading">
        <div className="skeleton-text" style={{ width: "120px", height: "1.2rem" }} />
      </div>
    );
  }

  const score = resolvedScore;
  const tier = resolvedTier;
  const currentTierInfo = DEPTH_TIERS.find((t) => t.key === tier) || DEPTH_TIERS[0];
  const currentTierIndex = DEPTH_TIERS.findIndex((t) => t.key === tier);
  const nextTier = DEPTH_TIERS[currentTierIndex + 1];

  // Calculate progress within current tier
  const tierMin = currentTierInfo.min;
  const tierMax = nextTier ? nextTier.min : currentTierInfo.min + 1000;
  const progress = Math.max(0, Math.min(((score - tierMin) / (tierMax - tierMin)) * 100, 100));

  if (compact) {
    return (
      <span
        className="depth-meter-compact"
        style={{ color: currentTierInfo.color }}
        title={casualModeActive
          ? `Community reputation: ${currentTierInfo.hobbyistLabel || tier} (${score} Depth points)`
          : `Depth Score: ${score} (${tier})`
        }
      >
        {casualModeActive ? (currentTierInfo.hobbyistLabel || tier) : tier}
      </span>
    );
  }

  return (
    <div className="depth-meter" aria-label={`Depth Score: ${score}, Tier: ${tier}`}>
      {/* Tier badge: opens the recent Depth changes */}
      <button
        type="button"
        className="depth-meter__badge"
        onClick={() => setShowDetails(!showDetails)}
        aria-expanded={showDetails}
        aria-label={`${tier}, ${score} Depth points. Show Depth details`}
      >
        <span className="depth-meter__icon" aria-hidden="true">
          <Anchor size={20} weight="bold" />
        </span>
        <span className="depth-meter__info">
          <span className="depth-meter__tier">{tier}</span>
          <span className="depth-meter__score">{score} pts</span>
        </span>
        <CaretDown size={16} weight="bold" className="depth-meter__caret" aria-hidden="true" />
      </button>

      {/* Progress bar */}
      <div className="depth-meter__progress">
        <div
          className="depth-meter__bar"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={nextTier ? `Depth progress to ${nextTier.label}` : `${tier}, top Depth tier`}
        >
          <div className="depth-meter__fill" style={{ width: `${progress}%` }} />
        </div>
        {nextTier && (
          <span className="depth-meter__next">
            {casualModeActive
              ? `Next reputation tier: ${nextTier.hobbyistLabel || nextTier.label} at ${nextTier.min} Depth points`
              : `${nextTier.label} at ${nextTier.min}`
            }
          </span>
        )}
      </div>

      {/* How Depth differs from XP */}
      <p className="depth-meter__hint pf-hint">
        <Info size={16} weight="bold" aria-hidden="true" />
        <span>
          {casualModeActive
            ? "Depth is community trust, separate from your points. Verified helpful contributions raise it."
            : "Depth is separate from XP. Verified expert audits raise it."}
        </span>
      </p>

      {/* Expandable details */}
      {showDetails && (
        <div className="depth-meter__details">
          <h4>Recent Depth changes</h4>
          {history.length === 0 ? (
            <p className="pf-muted">No Depth changes yet.</p>
          ) : (
            <div className="depth-meter__history">
              {history.map((event) => (
                <ScoreEventRow key={event.id} event={event} />
              ))}
            </div>
          )}

          {/* Tier explanation */}
          <details className="depth-meter__explainer">
            <summary>What is Depth?</summary>
            <p>
              Depth Score measures verified quality and trust in the community.
              It is separate from XP, which tracks activity. Depth currently rewards
              verified Expert Audits and can decrease after confirmed moderation.
            </p>
            <div className="depth-meter__tiers-list">
              {DEPTH_TIERS.map((t) => (
                <div key={t.key} className="depth-meter__tier-row">
                  <span>{t.label}</span>
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
