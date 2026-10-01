import React from "react";
import { SettingsSection } from "../SettingsSection";
import { AiCompanionToggle } from "../AiCompanionToggle";

/**
 * CompanionsSection — Settings → AI Companions ("Intelligence Layer" in Pro).
 *
 * Split out of the old DataPortabilityWidget.jsx.
 *
 * ⚠️ Deliberately does NOT host `reef/VoiceSettings` (docs/SETTINGS_SPEC.md
 * D-S-7). Phase 3 briefly embedded it here, reading handoff §3.5's "belongs
 * beside AI Companion Preferences". That was wrong: the voice profile keys are
 * read only by `reef/hooks/useVoiceProfiles.js` → `useNarration` →
 * `NarrationLayer`/`VoicePanel`, all of which render only inside
 * `ImmersiveReef` on `/reef-xr.html` — a page that is intentionally unlinked.
 * Surfacing the sliders here would let a user retune a voice that nothing they
 * can reach ever speaks with, which is the same "collects intent, delivers
 * nothing" defect this rework exists to remove. The controls stay in the reef
 * HUD, beside the only feature they affect.
 */
export function CompanionsSection({
  casualModeActive,
  poseidonEnabled,
  echoEnabled,
  setPoseidonEnabled,
  setEchoEnabled,
}) {
  return (
    <SettingsSection
      id="companions"
      icon={null}
      title={{ casual: "AI Companions", pro: "Intelligence Layer" }}
      description={{
        casual:
          "Echo is your fish guide, powered by Poseidon. Choose whether she answers questions and whether she sits in the corner of the screen.",
        pro:
          "Echo, powered by Poseidon. The two switches are independent: one stops all AI gateway calls, the other hides her on screen.",
      }}
      casualModeActive={casualModeActive}
    >
      {/* One character since 2026-09-30: Echo, powered by Poseidon. These two
          switches are the two halves of her, the answers (Poseidon) and the
          character on screen (Echo). The stored keys are unchanged. */}
      <AiCompanionToggle
        name="Echo's answers (Poseidon)"
        description={
          casualModeActive
            ? "Chat, photo ID and answer cards"
            : "AI gateway • species-grounded answers • photo ID"
        }
        avatarSrc="/echo/face.webp"
        accentRgb="13, 148, 136"
        enabled={poseidonEnabled}
        onChange={setPoseidonEnabled}
        note={
          casualModeActive
            ? undefined
            : "Turning this off also disables the Poseidon notification category below in Notifications."
        }
      />

      <AiCompanionToggle
        name="Echo on screen"
        description={casualModeActive ? "She sits in the corner, notices things in your logs, and opens the chat when tapped" : "Corner presence • log notices"}
        avatarSrc="/echo/face.webp"
        accentRgb="3, 105, 161"
        enabled={echoEnabled}
        onChange={setEchoEnabled}
      />

      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.5rem", lineHeight: "1.4" }}>
        {casualModeActive
          ? "Both are on by default and changes apply straight away. With Echo off screen, a small Ask Echo button opens the chat instead. Nothing is lost either way."
          : "Stored locally, applied without a reload. Answers off halts all gateway calls. Off screen hides her and her notices; she holds no per-account state."}
      </div>
    </SettingsSection>
  );
}

export default CompanionsSection;
