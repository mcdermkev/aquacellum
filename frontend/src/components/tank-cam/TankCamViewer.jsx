/**
 * TankCamViewer.jsx
 * 
 * Low-latency live stream viewer for Tank Cams.
 * Features:
 * - LL-HLS playback via hls.js
 * - Viewer count (Supabase Presence)
 * - Floating emoji reactions (broadcast)
 * - Owner info + tank name overlay
 * - LIVE indicator
 */

import React, { useRef, useEffect, useState } from "react";
import { useTankCamPresence } from "../../hooks/useTankCam";
import { FloatingReactions } from "./FloatingReactions";
import { ProfileCard } from "../reef/ProfileCard";

const REACTION_EMOJIS = ["🐠", "🔥", "💧", "🌿", "😍", "👏"];

export function TankCamViewer({ cam, onClose }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);

  const { viewerCount, reactions, sendReaction } = useTankCamPresence(cam.id, true);

  const streamUrl = `https://stream.mux.com/${cam.mux_playback_id}.m3u8?redundant_streams=true&max_resolution=720p`;

  // ── Initialize LL-HLS playback ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !cam.mux_playback_id) return;

    let hls = null;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      video.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (!Hls.isSupported()) {
          video.src = streamUrl;
          return;
        }

        hls = new Hls({
          lowLatencyMode: true,
          liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 5,
          maxBufferLength: 8,
        });

        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().then(() => setIsPlaying(true)).catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            if (data.type === "networkError") {
              setError("Stream offline or unavailable");
            } else {
              setError("Playback error");
            }
          }
        });
      }).catch(() => {
        video.src = streamUrl;
      });
    }

    return () => {
      if (hls) {
        hls.destroy();
        hlsRef.current = null;
      }
    };
  }, [cam.mux_playback_id, streamUrl]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99998,
        background: "#000",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Video */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />

        {/* Error overlay */}
        {error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.7)",
              gap: "0.5rem",
            }}
          >
            <span style={{ fontSize: "2rem" }}>📡</span>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{error}</p>
          </div>
        )}

        {/* Top overlay: LIVE badge + close + viewer count */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            padding: "12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            background: "linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span
              style={{
                padding: "3px 8px",
                borderRadius: "4px",
                background: "rgba(239, 68, 68, 0.9)",
                fontSize: "0.65rem",
                fontWeight: 700,
                color: "#fff",
                letterSpacing: "0.05em",
              }}
            >
              ● LIVE
            </span>
            <span style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.8)" }}>
              👁️ {viewerCount}
            </span>
          </div>

          <button
            onClick={onClose}
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              background: "rgba(0,0,0,0.5)",
              border: "none",
              color: "#fff",
              fontSize: "1rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label="Close viewer"
          >
            ✕
          </button>
        </div>

        {/* Bottom overlay: tank info */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "12px",
            background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          {cam.profiles && (
            <ProfileCard
              walletAddress={cam.profiles.wallet_address}
              displayName={cam.profiles.display_name}
              avatarUrl={cam.profiles.avatar_url}
              companionTier={cam.profiles.companion_tier}
              compact
            />
          )}
          {cam.tank_name && (
            <span style={{
              padding: "2px 8px",
              borderRadius: "50px",
              background: "rgba(56, 189, 248, 0.15)",
              border: "1px solid rgba(56, 189, 248, 0.3)",
              fontSize: "0.65rem",
              color: "#38bdf8",
            }}>
              🐠 {cam.tank_name}
            </span>
          )}
        </div>

        {/* Floating reactions */}
        <FloatingReactions reactions={reactions} />
      </div>

      {/* Reaction bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
          padding: "12px 16px",
          background: "rgba(15, 23, 42, 0.95)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => sendReaction(emoji)}
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)",
              fontSize: "1.2rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "transform 0.1s ease, background 0.1s ease",
            }}
            onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.85)"; }}
            onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
            aria-label={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

export default TankCamViewer;
