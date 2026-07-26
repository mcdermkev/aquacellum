import React from "react";
import { computeDexCompletion } from "../../services/dexService.js";
import { FINDER_COPY } from "./finderCopy";

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

  return (
    <div className="glass-card my-dex-panel">
      <div className="my-dex-panel__header">
        <h3 className="my-dex-panel__title">
          <span aria-hidden="true">📖</span> {FINDER_COPY.dex.title}
        </h3>
        {wishlistCount > 0 && (
          <span className="my-dex-panel__wishlist-count">
            <span aria-hidden="true">♥</span> {FINDER_COPY.dex.wishlistCount(wishlistCount)}
          </span>
        )}
      </div>

      {keptCount === 0 ? (
        <p className="my-dex-panel__hint">{FINDER_COPY.dex.emptyHint}</p>
      ) : (
        <>
          <div className="my-dex-panel__stat-row">
            <span className="my-dex-panel__count">{keptCount}</span>
            <span className="my-dex-panel__count-label">
              {FINDER_COPY.dex.keptLabel}
              {totalCount > 0 ? ` · ${FINDER_COPY.dex.catalogShare(percent)}` : ""}
            </span>
          </div>
          {totalCount > 0 && (
            <div
              className="my-dex-panel__bar"
              role="progressbar"
              aria-label={FINDER_COPY.dex.progressAria}
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="my-dex-panel__bar-fill" style={{ width: `${percent}%` }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
