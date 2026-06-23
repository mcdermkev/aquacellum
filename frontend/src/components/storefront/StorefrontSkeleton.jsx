/**
 * StorefrontSkeleton.jsx — Content-aware glassmorphic loading skeleton
 * Mirrors the final storefront layout with shimmer placeholders.
 * No spinners, no emoji — just premium glassmorphic shimmers.
 */
import React from "react";

export function StorefrontSkeleton() {
  return (
    <div className="sf-skeleton" aria-busy="true" aria-label="Loading storefront">
      {/* Banner skeleton */}
      <div className="sf-skeleton__banner shimmer-placeholder" />

      {/* Profile header skeleton */}
      <div className="sf-skeleton__header">
        <div className="sf-skeleton__avatar shimmer-placeholder" />
        <div className="sf-skeleton__info">
          <div className="shimmer-placeholder" style={{ width: "45%", height: 24, borderRadius: 6 }} />
          <div className="shimmer-placeholder" style={{ width: "30%", height: 16, borderRadius: 4, marginTop: 8 }} />
          <div className="shimmer-placeholder" style={{ width: "70%", height: 14, borderRadius: 4, marginTop: 12 }} />
        </div>
      </div>

      {/* Stats bar skeleton */}
      <div className="sf-skeleton__stats">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="sf-skeleton__stat-item glass-card">
            <div className="shimmer-placeholder" style={{ width: "60%", height: 22, borderRadius: 4 }} />
            <div className="shimmer-placeholder" style={{ width: "80%", height: 12, borderRadius: 4, marginTop: 6 }} />
          </div>
        ))}
      </div>

      {/* Listings grid skeleton */}
      <div className="sf-skeleton__section-title">
        <div className="shimmer-placeholder" style={{ width: 180, height: 20, borderRadius: 4 }} />
      </div>
      <div className="sf-skeleton__grid">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="sf-skeleton__card glass-card">
            <div className="shimmer-placeholder" style={{ width: "100%", height: 180, borderRadius: "var(--radius-sm)" }} />
            <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="shimmer-placeholder" style={{ width: "75%", height: 18, borderRadius: 4 }} />
              <div className="shimmer-placeholder" style={{ width: "55%", height: 14, borderRadius: 4 }} />
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <div className="shimmer-placeholder" style={{ width: 60, height: 22, borderRadius: 50 }} />
                <div className="shimmer-placeholder" style={{ width: 70, height: 22, borderRadius: 50 }} />
              </div>
              <div className="shimmer-placeholder" style={{ width: "100%", height: 38, borderRadius: "var(--radius-sm)", marginTop: 8 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
