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
          "Control whether Poseidon (your fish expert) and Echo (your companion) are active. You can turn either one off if you prefer a quieter experience.",
        pro:
          "Toggle the Poseidon intelligence layer and the Echo companion independently. Disabling Poseidon stops all API calls to the AI gateway. Disabling Echo hides the companion everywhere it appears — ambient presence, whispers, the dashboard card, and rare moments.",
      }}
      casualModeActive={casualModeActive}
    >
      <AiCompanionToggle
        name="Poseidon"
        description={
          casualModeActive
            ? "Freshwater fish expert & data assistant"
            : "Taxonomic intelligence • Species RAG • Spawn narration"
        }
        avatarSrc="/poseidon-avatar.jpg"
        accentRgb="6, 182, 212"
        enabled={poseidonEnabled}
        onChange={setPoseidonEnabled}
        note={
          casualModeActive
            ? undefined
            : "Turning this off also disables the Poseidon notification category below in Notifications."
        }
      />

      <AiCompanionToggle
        name="Echo"
        description={casualModeActive ? "Your evolving tank companion" : "Emotional intelligence • Companion entity • Gamification engine"}
        avatarSrc="/echo-evolved.jpg"
        accentRgb="139, 92, 246"
        enabled={echoEnabled}
        onChange={setEchoEnabled}
      />

      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.5rem", lineHeight: "1.4" }}>
        {casualModeActive
          ? "Both are enabled by default. Changes take effect immediately — no reload needed. Turning Echo off just hides it; your companion keeps its progress and comes back exactly as you left it."
          : "Preferences stored locally and applied without a reload. Disabling Poseidon halts all Edge Function calls. Disabling Echo suppresses companion rendering and rare-moment checks; stored Echo state, streak, and evolution are preserved."}
      </div>
    </SettingsSection>
  );
}

export default CompanionsSection;
