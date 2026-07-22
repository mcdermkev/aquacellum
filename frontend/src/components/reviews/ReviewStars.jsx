import React from "react";
import { Star, StarHalf } from "@phosphor-icons/react";

/**
 * ReviewStars — compact star-rating display badge (Task 20 §4/§5).
 *
 * Purely presentational: renders whatever count is given, in the brand's
 * amber "achievement/gold" token — the one place amber-as-rating is
 * correct per the brand kit. Icon AND number, never color/stars alone
 * (the numeric value is always rendered alongside the stars).
 *
 * Props:
 *  - average: number (0-5)
 *  - count: number of reviews backing the average
 *  - size: icon pixel size (default 14)
 *  - showCount: whether to render "(N reviews)" (default true)
 */
export function ReviewStars({ average = 0, count = 0, size = 14, showCount = true }) {
  const rounded = Math.round((Number(average) || 0) * 2) / 2; // nearest half-star
  const fullStars = Math.floor(rounded);
  const hasHalfStar = rounded - fullStars === 0.5;

  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
      role="img"
      aria-label={`Rated ${average.toFixed(1)} out of 5 stars${count ? ` from ${count} review${count === 1 ? "" : "s"}` : ""}`}
    >
      <span style={{ display: "inline-flex", alignItems: "center" }} aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => {
          if (i < fullStars) return <Star key={i} weight="fill" size={size} color="#fbbf24" />;
          if (i === fullStars && hasHalfStar) return <StarHalf key={i} weight="fill" size={size} color="#fbbf24" />;
          return <Star key={i} weight="regular" size={size} color="rgba(251,191,36,0.3)" />;
        })}
      </span>
      <span style={{ fontFamily: "monospace", fontSize: `${size * 0.75}px`, fontWeight: 600, color: "#fff" }}>
        {average.toFixed(1)}
      </span>
      {showCount && (
        <span style={{ fontSize: `${size * 0.65}px`, color: "var(--text-muted)" }}>
          ({count} review{count === 1 ? "" : "s"})
        </span>
      )}
    </span>
  );
}

export default ReviewStars;
