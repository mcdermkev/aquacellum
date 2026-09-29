import React, { useId } from "react";

/**
 * AquacellumMark — the brand mark, identical to the one public/js/nav.js and
 * public/js/footer.js draw on the static pages. One mark on both sides of the
 * site; if the SVG changes there, change it here.
 */
export function AquacellumMark({ size = 22 }) {
  // Gradient ids are document-global; the top bar and footer both render a
  // mark, so each instance needs its own.
  const gradId = `aq-mark-${useId().replace(/:/g, "")}`;
  const grad = `url(#${gradId})`;
  return (
    <svg width={size} height={size} viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2dd4bf" />
          <stop offset="50%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <circle cx="19" cy="19" r="15" stroke={grad} strokeWidth="2.4" fill="none" />
      <path d="M19 4 C22.5 9.5, 24 14, 22.8 19 C21.6 24, 22.5 28.5, 19 34" stroke={grad} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path d="M19 4 C15.5 9.5, 14 14, 15.2 19 C16.4 24, 15.5 28.5, 19 34" stroke={grad} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path d="M4 19 C9.5 17, 14 16.2, 19 16.2 C24 16.2, 28.5 17, 34 19" stroke="#5eead4" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.8" />
      <path d="M4 19 C9.5 21, 14 21.8, 19 21.8 C24 21.8, 28.5 21, 34 19" stroke="#a78bfa" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.8" />
      <circle cx="19" cy="19" r="4" fill={grad} />
      <circle cx="17.5" cy="17.5" r="1.3" fill="#fff" opacity="0.7" />
    </svg>
  );
}

/** The logo lockup (mark + wordmark + sub-name), same markup shape as nav.js. */
export function AquacellumLockup({ sub, href = "/", className = "app-brand" }) {
  return (
    <a href={href} className={className} aria-label="Aquacellum home">
      <span className="app-brand-mark"><AquacellumMark /></span>
      <span className="app-brand-words">
        <span className="app-brand-name">AQUACELLUM</span>
        {sub && <span className="app-brand-sub">{sub}</span>}
      </span>
    </a>
  );
}

export default AquacellumMark;
