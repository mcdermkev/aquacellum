import React from "react";

/**
 * OnboardingLayout — dual-pane responsive shell for the onboarding experience.
 *
 * Renders a narration pane (Poseidon avatar + dialogue + controls) and a visual
 * stage pane (Echo egg/tank scene) using the shared `onboarding-*` CSS classes
 * added in task 2.1.
 *
 * Responsive behavior is handled entirely by CSS:
 *   - >=768px: two-column grid (narration | stage)
 *   - <768px:  panes stack vertically with the stage on top, narration below
 *     (via the `@media (max-width:767px)` rules in index.css)
 *
 * Content is supplied via render slots so callers can compose any narration or
 * stage content:
 *   <OnboardingLayout narration={<PoseidonNarrator/>} stage={<EchoStage/>} />
 *
 * The whole layout is wrapped in an `onboarding-card` glass surface unless the
 * caller opts out via `card={false}` (e.g. to render the layout edge-to-edge).
 *
 * Validates: Requirements 1.1, 1.2
 */
export function OnboardingLayout({
  narration,
  stage,
  className = "",
  card = true,
}) {
  const layout = (
    <div className={`onboarding-layout${className ? ` ${className}` : ""}`}>
      {/* Narration first in DOM so the >=768px grid renders narration | stage
          (left | right). On narrow viewports the CSS media query uses `order`
          to flip the visual order to stage-on-top, narration-below. */}
      <div className="onboarding-pane--narration">{narration}</div>
      <div className="onboarding-pane--stage">{stage}</div>
    </div>
  );

  if (!card) {
    return layout;
  }

  return <div className="onboarding-card">{layout}</div>;
}

export default OnboardingLayout;
