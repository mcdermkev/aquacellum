import React, { useState } from "react";
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
 * styled from `styles/index.css` under `.settings-section*` (AC-2).
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
 * @param {string} [props.icon] - decorative emoji/icon, rendered with
 *   `aria-hidden`.
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

  return (
    <section
      id={`settings-${id}`}
      className={`settings-section settings-section--${tone}`}
      aria-labelledby={headingId}
      data-settings-section={id}
    >
      <div className="settings-section__header">
        <button
          type="button"
          className="settings-section__toggle"
          onClick={handleToggleCollapse}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
        >
          {icon && (
            <span className="settings-section__icon" aria-hidden="true">
              {icon}
            </span>
          )}
          <h3 id={headingId} className="settings-section__title">
            {resolvedTitle}
          </h3>
          {badge}
          <span
            className={`settings-section__chevron${collapsed ? " settings-section__chevron--collapsed" : ""}`}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>
      </div>

      {!collapsed && (
        <div id={bodyId} className="settings-section__body">
          {resolvedDescription && (
            <p className="settings-section__description">{resolvedDescription}</p>
          )}
          {children}
        </div>
      )}
    </section>
  );
}

export default SettingsSection;
