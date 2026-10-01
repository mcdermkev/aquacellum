/**
 * Arrow-key movement for a single-choice group (the WAI-ARIA radio group
 * pattern): Down/Right go to the next option, Up/Left to the previous one, both
 * wrapping, and Home/End jump to the first/last option.
 *
 * Pure so the keyboard contract can be unit-tested without a DOM. Callers move
 * focus to the returned index (and, for a plain radio group, select it).
 *
 * @param {string} key - `KeyboardEvent.key`.
 * @param {number} index - index of the option that has focus.
 * @param {number} count - number of options in the group.
 * @returns {number|null} the index to move to, or null when the key is not a
 *   navigation key (let the browser handle it).
 */
export function nextRadioIndex(key, index, count) {
  if (!Number.isInteger(count) || count <= 0) return null;
  const current = Number.isInteger(index) && index >= 0 && index < count ? index : 0;
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowUp":
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export default nextRadioIndex;
