/**
 * TankCamSetup.jsx
 * 
 * Tank Cam setup panel shown in tank settings.
 * Creates a Mux live stream and displays RTMP credentials for the user
 * to configure on their camera/OBS.
 */

import React, { useState } from "react";
import { useMyTankCams, useCreateTankCam, useDeleteTankCam } from "../../hooks/useTankCam";
import { getCurrentWallet } from "../../services/supabaseClient";

const STATUS_LABELS = {
  idle: { label: "Offline", color: "#6b7280", icon: "⚫" },
  active: { label: "Live", color: "#ef4444", icon: "🔴" },
  disconnected: { label: "Disconnected", color: "#f59e0b", icon: "🟡" },
};

export function TankCamSetup({ tankId, tankName }) {
  const walletAddress = getCurrentWallet();
  const { data: myCams = [], isLoading } = useMyTankCams(walletAddress);
  const createMutation = useCreateTankCam();
  const deleteMutation = useDeleteTankCam();

  const [showCredentials, setShowCredentials] = useState(false);
  const [newCamResult, setNewCamResult] = useState(null);
  const [copied, setCopied] = useState(null);

  // Find existing cam for this tank (or any cam by this user)
  const existingCam = myCams.find((c) => c.tank_id === tankId) || myCams[0];

  const handleSetup = async () => {
    try {
      const result = await createMutation.mutateAsync({
        walletAddress,
        tankId,
        tankName,
      });
      setNewCamResult(result);
      setShowCredentials(true);
    } catch (err) {
      // Error handled by mutation
    }
  };

  const handleDelete = async () => {
    if (!existingCam) return;
    if (!confirm("Remove Tank Cam? This will stop any active stream.")) return;

    await deleteMutation.mutateAsync({
      walletAddress,
      camId: existingCam.id,
      liveStreamId: existingCam.mux_live_stream_id,
    });
    setNewCamResult(null);
    setShowCredentials(false);
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  if (isLoading) {
    return <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Loading cam status…</p>;
  }

  // ── Existing cam: show status + credentials ──
  if (existingCam && !newCamResult) {
    const statusInfo = STATUS_LABELS[existingCam.status] || STATUS_LABELS.idle;

    return (
      <div
        style={{
          padding: "1rem",
          borderRadius: "10px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h4 style={{ margin: 0, fontSize: "0.85rem", color: "#fff" }}>📹 Tank Cam</h4>
          <span style={{ fontSize: "0.7rem", color: statusInfo.color, fontWeight: 600 }}>
            {statusInfo.icon} {statusInfo.label}
          </span>
        </div>

        <button
          onClick={() => setShowCredentials(!showCredentials)}
          style={{
            padding: "0.4rem 0.75rem",
            borderRadius: "6px",
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.04)",
            color: "#fff",
            fontSize: "0.7rem",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          {showCredentials ? "Hide" : "Show"} Stream Credentials
        </button>

        {showCredentials && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <CredentialField
              label="RTMP URL"
              value="rtmp://global-live.mux.com/app"
              copied={copied}
              onCopy={copyToClipboard}
            />
            <CredentialField
              label="Stream Key"
              value={existingCam.stream_key}
              sensitive
              copied={copied}
              onCopy={copyToClipboard}
            />
            <p style={{ margin: 0, fontSize: "0.6rem", color: "var(--text-muted)" }}>
              Enter these into your camera app (OBS, Larix, Wyze RTMP) to start streaming.
            </p>
          </div>
        )}

        <button
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          style={{
            padding: "0.35rem 0.6rem",
            borderRadius: "6px",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            background: "rgba(239, 68, 68, 0.05)",
            color: "#f87171",
            fontSize: "0.65rem",
            cursor: "pointer",
          }}
        >
          {deleteMutation.isPending ? "Removing…" : "Remove Tank Cam"}
        </button>
      </div>
    );
  }

  // ── New cam result: show credentials ──
  if (newCamResult) {
    return (
      <div
        style={{
          padding: "1rem",
          borderRadius: "10px",
          background: "rgba(52, 211, 153, 0.04)",
          border: "1px solid rgba(52, 211, 153, 0.15)",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        <h4 style={{ margin: 0, fontSize: "0.85rem", color: "#34d399" }}>
          ✓ Tank Cam Created!
        </h4>
        <p style={{ margin: 0, fontSize: "0.7rem", color: "var(--text-secondary)" }}>
          Configure your camera or streaming app with these credentials:
        </p>

        <CredentialField
          label="RTMP URL"
          value={newCamResult.rtmpUrl}
          copied={copied}
          onCopy={copyToClipboard}
        />
        <CredentialField
          label="Stream Key"
          value={newCamResult.streamKey}
          sensitive
          copied={copied}
          onCopy={copyToClipboard}
        />

        <div style={{
          padding: "0.5rem 0.75rem",
          borderRadius: "6px",
          background: "rgba(56, 189, 248, 0.05)",
          border: "1px solid rgba(56, 189, 248, 0.1)",
          fontSize: "0.65rem",
          color: "var(--text-muted)",
        }}>
          <strong>Compatible apps:</strong> OBS Studio, Streamlabs, Larix Broadcaster, Prism Live, Wyze Cam (RTMP firmware)
        </div>
      </div>
    );
  }

  // ── No cam: show setup button ──
  return (
    <div
      style={{
        padding: "1rem",
        borderRadius: "10px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.75rem",
        textAlign: "center",
      }}
    >
      <span style={{ fontSize: "1.5rem" }}>📹</span>
      <p style={{ margin: 0, fontSize: "0.8rem", color: "#fff" }}>Tank Cam</p>
      <p style={{ margin: 0, fontSize: "0.7rem", color: "var(--text-muted)" }}>
        Point a webcam at your tank and share a live feed with the community. Always-on, ambient, meditative.
      </p>
      <button
        onClick={handleSetup}
        disabled={createMutation.isPending}
        style={{
          padding: "0.5rem 1rem",
          borderRadius: "8px",
          border: "none",
          background: "linear-gradient(135deg, #0ea5e9, #0369a1)",
          color: "#fff",
          fontSize: "0.8rem",
          fontWeight: 600,
          cursor: createMutation.isPending ? "default" : "pointer",
          opacity: createMutation.isPending ? 0.7 : 1,
        }}
      >
        {createMutation.isPending ? "Setting up…" : "Enable Tank Cam"}
      </button>
      {createMutation.error && (
        <p style={{ margin: 0, fontSize: "0.65rem", color: "#f87171" }}>
          {createMutation.error.message}
        </p>
      )}
    </div>
  );
}

function CredentialField({ label, value, sensitive = false, copied, onCopy }) {
  const [revealed, setRevealed] = useState(!sensitive);
  const displayValue = revealed ? value : "••••••••••••••••••••";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
      <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", fontWeight: 600 }}>{label}</span>
      <div style={{ display: "flex", gap: "0.3rem" }}>
        <code
          style={{
            flex: 1,
            padding: "0.35rem 0.5rem",
            borderRadius: "4px",
            background: "rgba(0,0,0,0.3)",
            fontSize: "0.6rem",
            color: "#e5e7eb",
            fontFamily: "monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayValue}
        </code>
        {sensitive && (
          <button
            onClick={() => setRevealed(!revealed)}
            style={{
              padding: "0.25rem 0.4rem",
              borderRadius: "4px",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: "0.6rem",
              cursor: "pointer",
            }}
          >
            {revealed ? "Hide" : "Show"}
          </button>
        )}
        <button
          onClick={() => onCopy(value, label)}
          style={{
            padding: "0.25rem 0.4rem",
            borderRadius: "4px",
            border: "1px solid rgba(255,255,255,0.1)",
            background: copied === label ? "rgba(52,211,153,0.1)" : "transparent",
            color: copied === label ? "#34d399" : "var(--text-muted)",
            fontSize: "0.6rem",
            cursor: "pointer",
          }}
        >
          {copied === label ? "✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default TankCamSetup;
