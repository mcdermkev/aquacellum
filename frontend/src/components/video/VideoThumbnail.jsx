/**
 * VideoThumbnail.jsx
 * 
 * Displays a video poster frame with duration badge and play icon overlay.
 * Used in feed cards when a video is still processing or as a preview.
 */

import React from "react";

/**
 * Format seconds into m:ss display.
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Video thumbnail with play overlay and duration badge.
 * 
 * @param {object} props
 * @param {string} props.thumbnailUrl - Poster image URL
 * @param {number} [props.duration] - Video duration in seconds
 * @param {string} [props.status] - Video processing status (uploading, processing, ready, error)
 * @param {function} [props.onClick] - Click handler
 */
export function VideoThumbnail({ thumbnailUrl, duration, status, onClick }) {
  const isProcessing = status === "uploading" || status === "processing";
  const hasError = status === "error";

  return (
    <div
      onClick={!isProcessing && !hasError ? onClick : undefined}
      style={{
        position: "relative",
        width: "100%",
        paddingBottom: "56.25%", // 16:9
        borderRadius: "10px",
        overflow: "hidden",
        cursor: isProcessing || hasError ? "default" : "pointer",
        background: "#111",
      }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label="Play video"
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
    >
      {/* Thumbnail image */}
      {thumbnailUrl && (
        <img
          src={thumbnailUrl}
          alt="Video thumbnail"
          loading="lazy"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: isProcessing ? "blur(2px) brightness(0.6)" : "none",
            transition: "filter 0.3s ease",
          }}
        />
      )}

      {/* Processing overlay */}
      {isProcessing && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            background: "rgba(0, 0, 0, 0.4)",
          }}
          role="status"
          aria-label="Video processing"
        >
          <div
            style={{
              width: "28px",
              height: "28px",
              border: "3px solid rgba(255, 255, 255, 0.2)",
              borderTopColor: "#38bdf8",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <span style={{ fontSize: "0.7rem", color: "rgba(255, 255, 255, 0.8)" }}>
            {status === "uploading" ? "Uploading…" : "Processing…"}
          </span>
        </div>
      )}

      {/* Error overlay */}
      {hasError && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.3rem",
            background: "rgba(0, 0, 0, 0.5)",
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>⚠️</span>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
            Video failed to process
          </span>
        </div>
      )}

      {/* Play icon (when ready) */}
      {!isProcessing && !hasError && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              background: "rgba(0, 0, 0, 0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backdropFilter: "blur(4px)",
            }}
          >
            <span style={{ fontSize: "1rem", marginLeft: "2px", color: "#fff" }}>▶</span>
          </div>
        </div>
      )}

      {/* Duration badge */}
      {duration > 0 && !isProcessing && (
        <div
          style={{
            position: "absolute",
            bottom: "6px",
            right: "6px",
            padding: "2px 5px",
            borderRadius: "3px",
            background: "rgba(0, 0, 0, 0.7)",
            fontSize: "0.6rem",
            color: "#fff",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatDuration(duration)}
        </div>
      )}

      {/* Video icon badge (top-left) */}
      <div
        style={{
          position: "absolute",
          top: "6px",
          left: "6px",
          padding: "2px 6px",
          borderRadius: "3px",
          background: "rgba(0, 0, 0, 0.6)",
          fontSize: "0.6rem",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          gap: "3px",
        }}
      >
        🎬 Video
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default VideoThumbnail;
