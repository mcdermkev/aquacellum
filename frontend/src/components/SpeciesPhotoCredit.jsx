import { useEffect, useState } from "react";
import { findPhotoAttribution, formatPhotoCredit, loadPhotoAttributions } from "../services/speciesPhotoCredits";

/** Small "Photo: author · license · source" line for a species' master photo. */
export function SpeciesPhotoCredit({ scientificName, style }) {
  const [credit, setCredit] = useState(null);

  useEffect(() => {
    let active = true;
    loadPhotoAttributions().then((entries) => {
      if (active) setCredit(formatPhotoCredit(findPhotoAttribution(entries, scientificName)));
    });
    return () => {
      active = false;
    };
  }, [scientificName]);

  if (!credit || (!credit.author && !credit.license)) return null;

  const parts = [credit.author, credit.license].filter(Boolean);
  return (
    <p style={{ margin: 0, fontSize: "0.7rem", lineHeight: 1.4, color: "rgba(255,255,255,0.8)", ...style }}>
      Photo: {parts.join(" · ")}
      {credit.sourceLabel && (
        <>
          {" · "}
          {credit.sourceUrl ? (
            <a
              href={credit.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Original photo on ${credit.sourceLabel} (opens in a new tab)`}
              style={{ color: "#7dd3fc", textDecoration: "underline" }}
            >
              {credit.sourceLabel}
            </a>
          ) : (
            credit.sourceLabel
          )}
        </>
      )}
    </p>
  );
}
