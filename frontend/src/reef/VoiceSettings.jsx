import React, { useState } from "react";
import { useVoiceProfiles } from "./hooks/useVoiceProfiles";

/**
 * VoiceSettings — Panel for configuring Poseidon & Echo voice profiles.
 *
 * Lets users:
 * - Select a specific browser voice for each character
 * - Adjust pitch, rate, and volume sliders
 * - Preview each voice with a sample line
 * - Reset to auto-detected defaults
 */
export function VoiceSettings({ onClose }) {
  const {
    voices,
    ready,
    poseidonProfile,
    echoProfile,
    speakAs,
    updateProfile,
    resetProfiles,
  } = useVoiceProfiles();

  const [activePreview, setActivePreview] = useState(null);

  // Filter to English voices for the selector (show all as fallback)
  const englishVoices = voices.filter(v => v.lang && v.lang.startsWith("en"));
  const voiceList = englishVoices.length > 0 ? englishVoices : voices;

  const previewLines = {
    poseidon:
      "I am Poseidon. The ocean remembers every creature that has ever swum through its depths.",
    echo:
      "Hey! Look at this one — it's so colorful! Want me to tell you about it?",
  };

  const handlePreview = (character) => {
    setActivePreview(character);
    speakAs(character, previewLines[character], {
      onEnd: () => setActivePreview(null),
      onError: () => setActivePreview(null),
    });
  };

  const handleStopPreview = () => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setActivePreview(null);
  };

  if (!ready) {
    return (
      <div style={panelStyle}>
        <p style={{ color: "#94a3b8", fontSize: 13 }}>Loading voices…</p>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15, color: "#38bdf8" }}>
          🎙️ Voice Profiles
        </h3>
        {onClose && (
          <button onClick={onClose} style={closeBtnStyle} aria-label="Close voice settings">
            ✕
          </button>
        )}
      </div>

      <p style={{ fontSize: 11, color: "#64748b", marginBottom: 16, lineHeight: 1.4 }}>
        Give Poseidon and Echo unique voices in the Immersive Reef. Pick a voice,
        adjust the tone, and preview how each character sounds.
      </p>

      {/* Poseidon Voice */}
      <CharacterVoiceCard
        character="poseidon"
        label="🔱 Poseidon"
        subtitle="Deep, authoritative ocean guide"
        profile={poseidonProfile}
        voiceList={voiceList}
        onUpdate={(updates) => updateProfile("poseidon", updates)}
        onPreview={() => handlePreview("poseidon")}
        isPreviewing={activePreview === "poseidon"}
        onStopPreview={handleStopPreview}
        accentColor="#38bdf8"
      />

      {/* Echo Voice */}
      <CharacterVoiceCard
        character="echo"
        label="🐟 Echo"
        subtitle="Bright, playful companion"
        profile={echoProfile}
        voiceList={voiceList}
        onUpdate={(updates) => updateProfile("echo", updates)}
        onPreview={() => handlePreview("echo")}
        isPreviewing={activePreview === "echo"}
        onStopPreview={handleStopPreview}
        accentColor="#a78bfa"
      />

      {/* Reset button */}
      <div style={{ marginTop: 16, textAlign: "center" }}>
        <button
          onClick={resetProfiles}
          style={{
            padding: "6px 14px",
            fontSize: 11,
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: 6,
            color: "#f87171",
            cursor: "pointer",
          }}
        >
          Reset to Default Voices
        </button>
      </div>
    </div>
  );
}

/** Individual character voice card */
function CharacterVoiceCard({
  character,
  label,
  subtitle,
  profile,
  voiceList,
  onUpdate,
  onPreview,
  isPreviewing,
  onStopPreview,
  accentColor,
}) {
  return (
    <div style={{ ...cardStyle, borderColor: `${accentColor}33` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: accentColor }}>{label}</div>
          <div style={{ fontSize: 10, color: "#64748b" }}>{subtitle}</div>
        </div>
        <button
          onClick={isPreviewing ? onStopPreview : onPreview}
          style={{
            padding: "5px 10px",
            fontSize: 11,
            background: isPreviewing ? "rgba(239, 68, 68, 0.12)" : `${accentColor}15`,
            border: `1px solid ${isPreviewing ? "#ef4444" : accentColor}`,
            borderRadius: 6,
            color: isPreviewing ? "#ef4444" : accentColor,
            cursor: "pointer",
          }}
        >
          {isPreviewing ? "⏹ Stop" : "▶ Preview"}
        </button>
      </div>

      {/* Voice selector */}
      <label style={labelStyle}>
        Voice
        <select
          value={profile.voiceURI || ""}
          onChange={(e) => onUpdate({ voiceURI: e.target.value || null })}
          style={selectStyle}
        >
          <option value="">Auto-detect</option>
          {voiceList.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang}){v.localService ? "" : " ☁️"}
            </option>
          ))}
        </select>
      </label>

      {/* Pitch slider */}
      <SliderRow
        label="Pitch"
        value={profile.pitch}
        min={0.3}
        max={2.0}
        step={0.05}
        onChange={(val) => onUpdate({ pitch: val })}
        accentColor={accentColor}
      />

      {/* Rate slider */}
      <SliderRow
        label="Speed"
        value={profile.rate}
        min={0.4}
        max={1.8}
        step={0.05}
        onChange={(val) => onUpdate({ rate: val })}
        accentColor={accentColor}
      />

      {/* Volume slider */}
      <SliderRow
        label="Volume"
        value={profile.volume}
        min={0.1}
        max={1.0}
        step={0.05}
        onChange={(val) => onUpdate({ volume: val })}
        accentColor={accentColor}
      />
    </div>
  );
}

/** Reusable slider row */
function SliderRow({ label, value, min, max, step, onChange, accentColor }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
      <span style={{ fontSize: 10, color: "#94a3b8", width: 42 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor }}
        aria-label={`${label} slider`}
      />
      <span style={{ fontSize: 10, color: "#64748b", width: 28, textAlign: "right" }}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}

// --- Styles ---

const panelStyle = {
  position: "absolute",
  top: 16,
  right: 16,
  width: 320,
  maxHeight: "85vh",
  overflowY: "auto",
  background: "rgba(10, 22, 40, 0.95)",
  border: "1px solid rgba(56, 189, 248, 0.2)",
  borderRadius: 14,
  padding: "16px 18px",
  color: "#e2e8f0",
  fontFamily: "system-ui, sans-serif",
  backdropFilter: "blur(14px)",
  zIndex: 200,
};

const closeBtnStyle = {
  background: "none",
  border: "none",
  color: "#94a3b8",
  fontSize: 16,
  cursor: "pointer",
};

const cardStyle = {
  background: "rgba(15, 23, 42, 0.6)",
  border: "1px solid",
  borderRadius: 10,
  padding: "12px 14px",
  marginBottom: 12,
};

const labelStyle = {
  display: "block",
  fontSize: 10,
  color: "#94a3b8",
  marginBottom: 4,
};

const selectStyle = {
  display: "block",
  width: "100%",
  marginTop: 3,
  padding: "5px 8px",
  fontSize: 11,
  background: "rgba(15, 23, 42, 0.9)",
  border: "1px solid rgba(56, 189, 248, 0.2)",
  borderRadius: 6,
  color: "#e2e8f0",
};
