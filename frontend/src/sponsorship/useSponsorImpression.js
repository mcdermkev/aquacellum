import { useEffect, useRef } from "react";
import { useSponsorContext } from "./SponsorProvider";

/**
 * useSponsorImpression
 * 
 * Tracks when a sponsored element becomes visible to the user.
 * Fires a single impression event per mount cycle to avoid duplicate counts.
 * 
 * Usage:
 *   useSponsorImpression(sponsorId, surface, isVisible);
 * 
 * The hook only fires once per mount. If you need to track repeated visibility
 * (e.g. scrolling in/out of viewport), pass a changing `isVisible` boolean.
 */
export function useSponsorImpression(sponsorId, surface, isVisible = true) {
  const { logImpression } = useSponsorContext();
  const hasFired = useRef(false);

  useEffect(() => {
    if (sponsorId && surface && isVisible && !hasFired.current) {
      logImpression(sponsorId, surface, "view");
      hasFired.current = true;
    }
  }, [sponsorId, surface, isVisible, logImpression]);
}

/**
 * useSponsorClick
 * 
 * Returns a click handler that logs a click event for a sponsored element.
 * 
 * Usage:
 *   const handleClick = useSponsorClick(sponsorId, surface);
 *   <a onClick={handleClick} href={productLink}>...</a>
 */
export function useSponsorClick(sponsorId, surface) {
  const { logImpression } = useSponsorContext();

  return () => {
    if (sponsorId && surface) {
      logImpression(sponsorId, surface, "click");
    }
  };
}
