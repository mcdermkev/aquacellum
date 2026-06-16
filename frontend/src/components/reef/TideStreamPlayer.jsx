/**
 * TideStreamPlayer.jsx
 * 
 * Live stream player for Virtual Tides.
 * Shows: LL-HLS video, LIVE badge, viewer count, elapsed time.
 * Host view: Go Live button, RTMP credentials, End Stream.
 * Viewer view: Stream player with floating reactions.
 */

import React, { useRef, useEffect, useState, useCallback } from "react";
import { useTideStream, useCreateTideStream, useEndTideStream } from "../../hooks/useTideStream";
import { useTankCamPresence } from "../../hooks/useTankCam";
import { FloatingReactions } from "../tank-cam/FloatingReactions";
import { getCurrentWallet } from "../../services/supabaseClient";

const REACTION_EMOJIS = ["🐠", "🔥", "💧", "🌿", "😍", "👏"];

/**
 * Elapsed time display (HH:MM:SS format).
 */
function ElapsedTimer({ startTime }) {
  const [elapsed, setElapsed] = useState("00:00:00");

  useEffect(() => {
    if (!startTime) return;
    const start = new Date(startTime).getTime();

    const update = () => {
      const diff = Math.max(0, Date.now() - start);
      const h = String(Math.floor(diff / 3600000)).padStart(2, "0");
      const m = String(Math.floor((diff / 60000) % 60)).padStart(2, "0");
      const s = String(Math.floor((diff / 1000) % 60)).padStart(2, "0");
      setElapsed(`${h}:${m}:${s}`);
    };

    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [startTime]);

  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{elapsed}</span>;
}

/**
 * Host controls: setup stream, go live, end stream.
 */
function HostControls({ tideId, stream, onStreamCreated }) {
  const walletAddress = getCurrentWallet();
  const createStream = useCreateTideStream();
  const endStream = useEndTideStream();
  const [showCredentials, setShowCredentials] = useState(false);
  const [copied, setCopied] = useState(null);

  const handleCreate = async () => {
    const result = await createStream.mutateAsync({ walletAddress, tideId });
    if (onStreamCreated) onStreamCreated(result);
  };

  const handleEnd = async () => {
    if (!confirm("End the livestream? The recording will be available as a VOD.")) return;
    await endStream.mutateAsync({
      walletAddress,
      tideId,
      streamId: stream?.mux_live_stream_id,
    });
  };

  const copy = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  // No stream created yet — show setup button
  if (!stream) {
    return (
      <div style={{
        padding: "2rem",
        textAlign: "center",
        borderRadius: "12px",
        background: "rgba(99, 102, 241, 0.05)",
        border: "1px solid rgba(99, 102, 241, 0.15)",
      }}>
        <p style={{ fontSize: "2rem", margin: "0 0 0.75rem" }}>🎥</p>
        <h3 style={{ margin: "0 0 0.5rem", color: "#fff", fontSize: "1rem" }}>
          Set Up Livestream
        </h3>
        <p style={{ margin: "0 0 1rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Create a stream to broadcast to your attendees. You can use OBS, Streamlabs, or stream directly from your browser.
        </p>
        <button
          onClick={handleCreate}
          disabled={createStream.isPending}
          style={{
            padding: "0.6rem 1.5rem",
            borderRadius: "10px",
            border: "none",
            background: "linear-gradient(135deg, #6366f1, #4f46e5)",
            color: "#fff",
            fontSize: "0.85rem",
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(99, 102, 241, 0.25)",
          }}
        >
          {createStream.isPending ? "Setting up…" : "🎬 Create Stream"}
        </button>
        {createStream.error && (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.7rem", color: "#f87171" }}>
            {createStream.error.message}
          </p>
        )}
      </div>
    );
  }

  // Stream exists — show credentials + controls
  return (
    <div style={{
      padding: "1.25rem",
      borderRadius: "12px",
      background: stream.status === "live"
        ? "rgba(239, 68, 68, 0.05)"
        : "rgba(99, 102, 241, 0.05)",
      border: `1px solid ${stream.status === "live" ? "rgba(239, 68, 68, 0.2)" : "rgba(99, 102, 241, 0.15)"}`,
      display: "flex",
      flexDirection: "column",
      gap: "0.75rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={{ margin: 0, fontSize: "0.85rem", color: "#fff" }}>
          🎬 Host Controls
        </h4>
        <span style={{
          padding: "3px 8px",
          borderRadius: "4px",
          fontSize: "0.65rem",
          fontWeight: 700,
          background: stream.status === "live" ? "rgba(239, 68, 68, 0.9)" : "rgba(99, 102, 241, 0.2)",
          color: "#fff",
        }}>
          {stream.status === "live" ? "● LIVE" : stream.status === "ended" ? "Ended" : "Ready"}
        </span>
      </div>

      {/* RTMP Credentials */}
      {stream.status !== "ended" && (
        <>
          <button
            onClick={() => setShowCredentials(!showCredentials)}
            style={{
              padding: "0.35rem 0.6rem",
              borderRadius: "6px",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: "var(--text-muted)",
              fontSize: "0.7rem",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            {showCredentials ? "Hide" : "Show"} Stream Credentials (for OBS)
          </button>

          {showCredentials && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <code style={{ flex: 1, padding: "0.3rem 0.5rem", borderRadius: "4px", background: "rgba(0,0,0,0.3)", fontSize: "0.6rem", color: "#e5e7eb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  rtmp://global-live.mux.com/app
                </code>
                <button onClick={() => copy("rtmp://global-live.mux.com/app", "url")} style={{ padding: "0.2rem 0.4rem", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.1)", background: copied === "url" ? "rgba(52,211,153,0.1)" : "transparent", color: copied === "url" ? "#34d399" : "var(--text-muted)", fontSize: "0.6rem", cursor: "pointer" }}>
                  {copied === "url" ? "✓" : "Copy"}
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <code style={{ flex: 1, padding: "0.3rem 0.5rem", borderRadius: "4px", background: "rgba(0,0,0,0.3)", fontSize: "0.6rem", color: "#e5e7eb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {stream.stream_key || "••••••••••••"}
                </code>
                {stream.stream_key && (
                  <button onClick={() => copy(stream.stream_key, "key")} style={{ padding: "0.2rem 0.4rem", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.1)", background: copied === "key" ? "rgba(52,211,153,0.1)" : "transparent", color: copied === "key" ? "#34d399" : "var(--text-muted)", fontSize: "0.6rem", cursor: "pointer" }}>
                    {copied === "key" ? "✓" : "Copy"}
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* End Stream button */}
      {stream.status === "live" && (
        <button
          onClick={handleEnd}
          disabled={endStream.isPending}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: "8px",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            background: "rgba(239, 68, 68, 0.08)",
            color: "#f87171",
            fontSize: "0.75rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {endStream.isPending ? "Ending…" : "⏹ End Stream"}
        </button>
      )}
    </div>
  );
}

/**
 * Stream viewer component — LL-HLS player.
 */
function StreamViewer({ playbackId, tideId }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [error, setError] = useState(null);

  const { viewerCount, reactions, sendReaction } = useTankCamPresence(
    `tide-${tideId}`,
    !!playbackId
  );

  const streamUrl = `https://stream.mux.com/${playbackId}.m3u8?redundant_streams=true&max_resolution=720p`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackId) return;

    let hls = null;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      video.play().catch(() => {});
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (!Hls.isSupported()) { video.src = streamUrl; return; }

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
          video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) setError("Stream unavailable");
        });
      });
    }

    return () => { if (hls) hls.destroy(); };
  }, [playbackId, streamUrl]);

  return (
    <div style={{ position: "relative", borderRadius: "12px", overflow: "hidden", background: "#000" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={false}
        style={{ width: "100%", aspectRatio: "16/9", objectFit: "contain", display: "block" }}
      />

      {error && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{error}</p>
        </div>
      )}

      {/* Overlay: LIVE + viewers */}
      <div style={{
        position: "absolute", top: "8px", left: "8px", right: "8px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ padding: "3px 8px", borderRadius: "4px", background: "rgba(239, 68, 68, 0.9)", fontSize: "0.6rem", fontWeight: 700, color: "#fff" }}>
          ● LIVE
        </span>
        <span style={{ padding: "3px 8px", borderRadius: "4px", background: "rgba(0,0,0,0.6)", fontSize: "0.65rem", color: "#fff" }}>
          👁️ {viewerCount}
        </span>
      </div>

      {/* Floating reactions */}
      <FloatingReactions reactions={reactions} />

      {/* Reaction bar */}
      <div style={{
        position: "absolute", bottom: "8px", left: "50%", transform: "translateX(-50%)",
        display: "flex", gap: "0.4rem", padding: "0.3rem 0.6rem",
        borderRadius: "50px", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
      }}>
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => sendReaction(emoji)}
            style={{ width: "30px", height: "30px", borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.08)", fontSize: "1rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            aria-label={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Main TideStreamPlayer — combines host controls + viewer.
 */
export function TideStreamPlayer({ tideId, hostWallet, tideStartTime }) {
  const { stream, status, playbackId, isLive, isLoading } = useTideStream(tideId);
  const walletAddress = getCurrentWallet();
  const isHost = walletAddress && walletAddress === hostWallet;

  if (isLoading) {
    return (
      <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-muted)" }}>
        Loading stream…
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Host controls (only visible to the tide host) */}
      {isHost && (
        <HostControls tideId={tideId} stream={stream} />
      )}

      {/* Stream player (visible when live) */}
      {isLive && playbackId && (
        <StreamViewer playbackId={playbackId} tideId={tideId} />
      )}

      {/* Waiting for stream (not host, not live yet) */}
      {!isHost && !isLive && status !== "ended" && (
        <div style={{
          padding: "2rem",
          textAlign: "center",
          borderRadius: "12px",
          background: "rgba(99, 102, 241, 0.05)",
          border: "1px solid rgba(99, 102, 241, 0.15)",
        }}>
          <p style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>🎥</p>
          <h3 style={{ margin: "0 0 0.5rem", color: "#fff", fontSize: "0.9rem" }}>
            Stream Starting Soon
          </h3>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-muted)" }}>
            The host hasn't started streaming yet. Stay tuned!
          </p>
        </div>
      )}

      {/* VOD available after stream ends */}
      {status === "ended" && stream?.recording_playback_id && (
        <div style={{ borderRadius: "12px", overflow: "hidden" }}>
          <div style={{ padding: "0.5rem 0.75rem", background: "rgba(99, 102, 241, 0.08)", fontSize: "0.75rem", color: "#a5b4fc", fontWeight: 600 }}>
            📼 Recording Available
          </div>
          <video
            src={`https://stream.mux.com/${stream.recording_playback_id}.m3u8`}
            controls
            playsInline
            poster={`https://image.mux.com/${stream.recording_playback_id}/thumbnail.webp?time=5`}
            style={{ width: "100%", aspectRatio: "16/9", objectFit: "contain", background: "#000" }}
          />
        </div>
      )}
    </div>
  );
}

export default TideStreamPlayer;
