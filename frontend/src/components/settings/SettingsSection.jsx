import React, { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { announce } from "../../utils/a11y";

/**
 * SettingsSection — the one card primitive for the entire Settings panel.
 *
 * Before this (docs/SETTINGS_SPEC.md §5), every card in Settings re-implemented
 * the same glass-card styling inline — `padding: "2rem"`, `maxWidth: "600px"`,
 * `var(--radius-md)`, the same shadow — nine times, with casual/pro drift
 * handled as a per-card ternary. `FontSizeSettings` and `HighContrastToggle`
 * used a *different* visual language entirely (navy panel, `maxWidth: 640`,
 * 14px radius, `system-ui`), which is why the top of the tab looked like a
 * different product than the bottom. This file is the fix: one primitive,
 * styled from `SettingsDaylight.css` under `.st-section*` (AC-2).
 *
 * `title` / `description` each accept EITHER a plain string (identical copy in
 * both modes — the explicit way to say "this heading is deliberately
 * unbranched") OR a `{ casual, pro }` pair. A plain string is how the
 * "Data Management & Portability" bug (unbranched heading, branched body)
 * becomes impossible to write by accident (AC-4).
 *
 * Sections are individually collapsible with per-`id` persisted state, and
 * `id` doubles as the deep-link anchor (`#settings/<id>`, AC-1's "stable,
 * used for deep links… and tests").
 */

const COLLAPSE_STORAGE_PREFIX = "aquadex_settings_collapsed_";

function resolveCopy(value, casualModeActive) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return casualModeActive ? value.casual : value.pro;
}

function loadCollapsed(id, defaultCollapsed) {
  try {
    const raw = localStorage.getItem(`${COLLAPSE_STORAGE_PREFIX}${id}`);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // fall through to default
  }
  return !!defaultCollapsed;
}

function persistCollapsed(id, collapsed) {
  try {
    localStorage.setItem(`${COLLAPSE_STORAGE_PREFIX}${id}`, collapsed ? "1" : "0");
  } catch {
    // non-fatal — collapse state simply won't be remembered
  }
}

/**
 * @param {object} props
 * @param {string} props.id - stable id; used for the deep-link anchor
 *   (`id="settings-<id>"`), the collapse-persistence key, and by tests.
 * @param {React.ReactNode} [props.icon] - decorative icon element (a Phosphor
 *   icon, e.g. `<Bell size={20} />`), rendered in a tile with `aria-hidden`.
 * @param {string|{casual:string, pro:string}} props.title
 * @param {string|{casual:string, pro:string}} [props.description]
 * @param {boolean} props.casualModeActive
 * @param {"default"|"info"|"danger"} [props.tone="default"]
 * @param {boolean} [props.defaultCollapsed=false]
 * @param {React.ReactNode} [props.badge]
 * @param {React.ReactNode} props.children
 */
export function SettingsSection({
  id,
  icon,
  title,
  description,
  casualModeActive,
  tone = "default",
  defaultCollapsed = false,
  badge = null,
  children,
}) {
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(id, defaultCollapsed));

  const resolvedTitle = resolveCopy(title, casualModeActive);
  const resolvedDescription = resolveCopy(description, casualModeActive);
  const headingId = `settings-${id}-heading`;
  const bodyId = `settings-${id}-body`;

  const handleToggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    persistCollapsed(id, next);
    announce(`${resolvedTitle} section ${next ? "collapsed" : "expanded"}`);
  };

  // The heading wraps the toggle button (not the other way round): a heading
  // inside a <button> is flattened to plain text by assistive tech, so the
  // section would drop out of the heading outline. The badge sits beside the
  // heading, outside the button, so it is not read as part of the button name.
  return (
    <section
      id={`settings-${id}`}
      className={`st-section st-section--${tone}`}
      aria-labelledby={headingId}
      data-settings-section={id}
    >
      <div className={`st-section-head${badge ? " st-section-head--badge" : ""}`}>
        <h3 id={headingId} className="st-section-title">
          <button
            type="button"
            className="st-section-toggle"
            onClick={handleToggleCollapse}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
          >
            {icon && (
              <span className="st-section-icon" aria-hidden="true">
                {icon}
              </span>
            )}
            <span className="st-section-name">{resolvedTitle}</span>
            <CaretDown
              className={`st-section-caret${collapsed ? " st-section-caret--collapsed" : ""}`}
              size={18}
              weight="bold"
              aria-hidden="true"
            />
          </button>
        </h3>
        {badge && <span className="st-section-badge">{badge}</span>}
      </div>

      {!collapsed && (
        <div id={bodyId} className="st-section-body">
          {resolvedDescription && (
            <p className="st-section-desc">{resolvedDescription}</p>
          )}
          {children}
        </div>
      )}
    </section>
  );
}

export default SettingsSection;
