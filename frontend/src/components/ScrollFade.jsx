import { useScrollAffordance } from "../hooks/useScrollAffordance";

/**
 * ScrollFade — a horizontally scrollable container that shows an edge fade on
 * whichever side has content hidden beyond it.
 *
 * Use this instead of `useScrollAffordance()` + a manual ref whenever the
 * container is rendered inside a loop. A hook cannot be called per iteration, so
 * `{items.map(() => <div ref={oneSharedRef} />)}` would attach the affordance to
 * whichever element rendered last and leave the rest inert. Each ScrollFade owns
 * its own hook instance, so N containers work correctly.
 *
 * For a single container in a component body either form is fine; the ref form
 * is marginally less indirection.
 *
 * The caller still owns `overflow-x`, because these containers differ (some are
 * flex rows, some wrap tables) and silently imposing it would change layout.
 *
 * @param {object} props
 * @param {string} [props.as="div"] element type to render
 * @param {boolean} [props.table=false] use the narrower table fade — an 18px bite
 *   out of a numeric cell is hard to read, and a header row already signals the
 *   clipped edge
 * @param {boolean} [props.focusable=false] add tabindex="0". Needed when the
 *   children are NOT focusable (a table, a strip of static cards): with nothing
 *   tabbable inside, a keyboard-only user cannot scroll the container at all.
 *   Leave false for tab bars — focusing a button already scrolls it into view,
 *   and an extra tab stop there is just noise.
 */
export function ScrollFade({
  as: Tag = "div",
  table = false,
  focusable = false,
  className = "",
  children,
  ...rest
}) {
  const ref = useScrollAffordance();

  const classes = ["scroll-fade", table ? "scroll-fade--table" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <Tag ref={ref} className={classes} tabIndex={focusable ? 0 : undefined} {...rest}>
      {children}
    </Tag>
  );
}
