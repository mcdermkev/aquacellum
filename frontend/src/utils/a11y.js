/**
 * a11y.js
 * 
 * Accessibility utilities for The Reef social components.
 * Provides focus management, keyboard navigation helpers, and ARIA utilities.
 */

/**
 * Trap focus within a container element (for modals/dialogs).
 * Returns a cleanup function.
 */
export function trapFocus(containerEl) {
  if (!containerEl) return () => {};

  const focusableSelectors = [
    "a[href]",
    "button:not([disabled])",
    "textarea:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable]",
  ].join(", ");

  const focusableEls = containerEl.querySelectorAll(focusableSelectors);
  const firstFocusable = focusableEls[0];
  const lastFocusable = focusableEls[focusableEls.length - 1];

  function handleKeydown(e) {
    if (e.key !== "Tab") return;

    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable?.focus();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable?.focus();
      }
    }
  }

  containerEl.addEventListener("keydown", handleKeydown);

  // Focus first element
  firstFocusable?.focus();

  return () => {
    containerEl.removeEventListener("keydown", handleKeydown);
  };
}

/**
 * Announce a message to screen readers via a live region.
 * Creates a temporary aria-live element that self-destructs.
 */
export function announce(message, priority = "polite") {
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", priority);
  el.setAttribute("aria-atomic", "true");
  el.style.position = "absolute";
  el.style.left = "-9999px";
  el.style.width = "1px";
  el.style.height = "1px";
  el.style.overflow = "hidden";

  document.body.appendChild(el);

  // Delay to ensure screen reader picks it up
  setTimeout(() => {
    el.textContent = message;
  }, 50);

  // Clean up after announcement
  setTimeout(() => {
    document.body.removeChild(el);
  }, 3000);
}

/**
 * Keyboard interaction helper for reaction buttons.
 * Enables Enter and Space to trigger click on non-button elements.
 */
export function handleKeyActivate(callback) {
  return (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      callback(e);
    }
  };
}

/**
 * Generate a descriptive label for a reaction emoji + count.
 */
export function reactionAriaLabel(emoji, count, userReacted) {
  const emojiNames = {
    "🔥": "fire",
    "🐟": "fish",
    "💧": "water",
    "🌿": "plant",
    "👏": "applause",
    "⭐": "star",
  };
  const name = emojiNames[emoji] || "reaction";
  const state = userReacted ? "Remove your" : "Add";
  return `${state} ${name} reaction. ${count} ${count === 1 ? "person has" : "people have"} reacted.`;
}

/**
 * Generate a skip-to-content link target ID.
 * Call this at the top of main content areas.
 */
export const SKIP_TO_FEED = "reef-feed-main";
export const SKIP_TO_SEARCH = "reef-search-input";

/**
 * Prefersreduced motion check.
 */
export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Color contrast check utility — returns whether a combination passes WCAG AA.
 * Based on relative luminance calculation.
 */
export function meetsContrastAA(foreground, background, largeText = false) {
  const ratio = getContrastRatio(foreground, background);
  return largeText ? ratio >= 3 : ratio >= 4.5;
}

function getContrastRatio(color1, color2) {
  const l1 = getRelativeLuminance(color1);
  const l2 = getRelativeLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function getRelativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : null;
}
