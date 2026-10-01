/**
 * Keyboard movement for the Breed Gallery tablists (WAI-ARIA tabs pattern
 * with automatic activation). Pure, so the component needs no extra hooks:
 * the caller activates tabs[next] and focuses it.
 *
 * Returns the index to move to for ArrowRight / ArrowLeft (wrapping), Home and
 * End, or null for any other key or an empty list. A negative index (nothing
 * selected) is treated as 0.
 */
export function nextTabIndex(key, index, count) {
  if (!count || count <= 0) return null;
  const current = index < 0 ? 0 : index;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
