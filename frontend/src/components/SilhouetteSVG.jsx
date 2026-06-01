import React from "react";

// FishSilhouetteSVG - renders a stylized fish with a dynamic gradient signature
export function FishSilhouetteSVG({ specimenId = 0, style }) {
  const seed = (Number(specimenId) * 123) % 360;
  const hue1 = seed;
  const hue2 = (seed + 120) % 360;
  const gradId = `fish-grad-${specimenId}`;
  return (
    <svg 
      width="100%" 
      height="100%" 
      viewBox="0 0 24 24" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={`hsl(${hue1}, 80%, 60%)`} />
          <stop offset="100%" stopColor={`hsl(${hue2}, 85%, 45%)`} />
        </linearGradient>
      </defs>
      <path 
        d="M2 12c3-4 8-5 13-2 1.5.9 3 2.5 4.5 2.5 1.5 0 2.5-.5 3.5-1.5-.5 2-.5 4 0 6-1-1-2-1.5-3.5-1.5-1.5 0-3 1.6-4.5 2.5-5 3-10 2-13-2z" 
        fill={`url(#${gradId})`}
        fillOpacity="0.75"
      />
      <circle cx="15" cy="11" r="1" fill="#fff" opacity="0.9" />
    </svg>
  );
}

// PlantSilhouetteSVG - renders a stylized aquatic plant with dynamic gradient
export function PlantSilhouetteSVG({ specCode = 9001, style }) {
  const seed = (Number(specCode) * 77) % 360;
  const hue1 = (seed + 100) % 360;
  const hue2 = (seed + 140) % 360;
  const gradId = `plant-grad-${specCode}`;
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="100%" x2="50%" y2="0%">
          <stop offset="0%" stopColor={`hsl(${hue1}, 70%, 30%)`} />
          <stop offset="100%" stopColor={`hsl(${hue2}, 80%, 55%)`} />
        </linearGradient>
      </defs>
      {/* Stem */}
      <line x1="12" y1="22" x2="12" y2="10" stroke={`url(#${gradId})`} strokeWidth="1.5" strokeLinecap="round" />
      {/* Left leaf */}
      <path d="M12 16 Q7 13 6 8 Q10 10 12 14" fill={`url(#${gradId})`} fillOpacity="0.8" />
      {/* Right leaf */}
      <path d="M12 13 Q17 10 18 5 Q14 8 12 12" fill={`url(#${gradId})`} fillOpacity="0.8" />
      {/* Top frond */}
      <path d="M12 10 Q11 6 12 3 Q13 6 12 10" fill={`url(#${gradId})`} fillOpacity="0.9" />
    </svg>
  );
}
