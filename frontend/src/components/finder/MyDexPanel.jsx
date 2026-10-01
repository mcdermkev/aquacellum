import { BookOpen, Heart } from "@phosphor-icons/react";
import { computeDexCompletion } from "../../services/dexService.js";
import { FINDER_COPY } from "./finderCopy";
import "./FishFinderDaylight.css";

/**
 * Dex completion → card tier (COSMETIC_EXPRESSION_SPEC.md §5).
 *
 * The card's border progressively warms as completion grows, so even at a
 * glance a keeper can tell roughly where they stand. Same thresholds as the
 * badges in BadgeShelf (25/50/75/100%). The tones live in
 * FishFinderDaylight.css as `.ff-dex--{tier}`.
 */
function dexTier(percent) {
  if (percent >= 100) return "complete";
  if (percent >= 75) return "gold";
  if (percent >= 50) return "silver";
  if (percent >= 25) return "bronze";
  return null;
}

/**
 * MyDexPanel — the "My Dex" collection summary (Fish Finder Rework Task 9).
 *
 * Presentation-only: reads dexEntries/candidates and composes
 * `computeDexCompletion` (dexService.js) for the percentage — never
 * re-derives collection math. No XP/write logic lives here; that's
 * dexService.js/useDex.js.
 */
export function MyDexPanel({ dexEntries = [], candidates = [], wishlistCount = 0 }) {
  const { keptCount, totalCount, percent } = computeDexCompletion(dexEntries, candidates);
  const tier = dexTier(percent);

  return (
    <div className={`ff-card ff-dex${tier ? ` ff-dex--${tier}` : ""}`}>
      <div className="ff-dex-head">
        <h3 className="ff-dex-title">
          <BookOpen size={18} aria-hidden="true" />
          {FINDER_COPY.dex.title}
        </h3>
        {wishlistCount > 0 && (
          <span className="ff-dex-wish">
            <Heart size={15} weight="fill" aria-hidden="true" />
            {FINDER_COPY.dex.wishlistCount(wishlistCount)}
          </span>
        )}
      </div>

      {keptCount === 0 ? (
        <p className="ff-dex-hint">{FINDER_COPY.dex.emptyHint}</p>
      ) : (
        <>
          <div className="ff-dex-stat">
            <span className="ff-dex-count">{keptCount}</span>
            <span className="ff-dex-count-label">
              {FINDER_COPY.dex.keptLabel}
              {totalCount > 0 ? ` · ${FINDER_COPY.dex.catalogShare(percent)}` : ""}
            </span>
          </div>
          {totalCount > 0 && (
            <div
              className="ff-dex-bar"
              role="progressbar"
              aria-label={FINDER_COPY.dex.progressAria}
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="ff-dex-bar-fill" style={{ width: `${percent}%` }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
