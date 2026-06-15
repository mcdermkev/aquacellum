/**
 * VideoPlayer.jsx
 * 
 * HLS video player for The Reef feed.
 * Features:
 * - Autoplay-on-scroll (muted) via IntersectionObserver
 * - Tap to unmute → tap again to pause
 * - Duration badge overlay
 * - Loading state with blurred thumbnail
 * - Graceful fallback for browsers without HLS support
 * - Accessible controls and captions
 */

import React, { useRef, useState, useEffect, useCallback } from "react";

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
 * Inline video player for Mux-hosted videos.
 * 
 * @param {object} props
 * @param {string} props.playbackId - Mux playback ID
 * @param {string} [props.thumbnailUrl] - Poster/thumbnail image URL
 * @param {number} [props.duration] - Duration in seconds (for badge display)
 * @param {string} [props.altText] - Accessible description
 * @param {boolean} [props.autoPlayOnScroll=true] - Enable autoplay when in viewport
 */
export function VideoPlayer({
  playbackId,
  thumbnailUrl,
  duration,
  altText,
  autoPlayOnScroll = true,
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hlsRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(false);

  const streamUrl = `https://stream.mux.com/${playbackId}.m3u8`;
  const posterUrl = thumbnailUrl || `https://image.mux.com/${playbackId}/thumbnail.webp?time=2`;

  // ── Initialize HLS playback ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackId) return;

    let hls = null;

    // Check if native HLS is supported (Safari/iOS)
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
    } else {
      // Dynamically import hls.js for other browsers
      import("hls.js").then(({ default: Hls }) => {
        if (!Hls.isSupported()) {
          // Final fallback: try direct source
          video.src = streamUrl;
          return;
        }

        hls = new Hls({
          maxBufferLength: 10,
          maxMaxBufferLength: 30,
          startLevel: -1, // Auto quality selection
        });

        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hlsRef.current = hls;

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            console.error("[VideoPlayer] Fatal HLS error:", data);
            setHasError(true);
          }
        });
      }).catch(() => {
        // If hls.js fails to load, try direct playback
        video.src = streamUrl;
      });
    }

    return () => {
      if (hls) {
        hls.destroy();
        hlsRef.current = null;
      }
    };
  }, [playbackId, streamUrl]);

  // ── Autoplay on scroll via IntersectionObserver ──
  useEffect(() => {
    if (!autoPlayOnScroll || !containerRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const video = videoRef.current;
        if (!video) return;

        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          // Visible: attempt autoplay (muted)
          video.muted = true;
          setIsMuted(true);
          video.play().then(() => {
            setIsPlaying(true);
          }).catch(() => {
            // Autoplay blocked — user needs to interact
            setIsPlaying(false);
          });
        } else {
          // Not visible: pause and reset
          video.pause();
          video.currentTime = 0;
          setIsPlaying(false);
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [autoPlayOnScroll]);

  // ── Video event handlers ──
  const handleLoadedData = () => setIsLoading(false);
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };
  const handleEnded = () => {
    setIsPlaying(false);
    if (videoRef.current) videoRef.current.currentTime = 0;
  };
  const handleError = () => setHasError(true);

  // ── User interaction: tap to unmute/pause ──
  const handleTap = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isMuted && isPlaying) {
      // First tap: unmute
      video.muted = false;
      setIsMuted(false);
    } else if (!isMuted && isPlaying) {
      // Second tap: pause
      video.pause();
      setIsPlaying(false);
    } else {
      // Tap on paused video: play unmuted
      video.muted = false;
      setIsMuted(false);
      video.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [isMuted, isPlaying]);

  const handleRetry = () => {
    setHasError(false);
    setIsLoading(true);
    const video = videoRef.current;
    if (video) {
      video.load();
    }
  };

  // Show/hide controls on hover/touch
  const handleMouseEnter = () => setShowControls(true);
  const handleMouseLeave = () => setShowControls(false);

  // ── Error state ──
  if (hasError) {
    return (
      <div
        style={{
          position: "relative",
          width: "100%",
          paddingBottom: "56.25%",
          background: "rgba(0, 0, 0, 0.3)",
          borderRadius: "10px",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
          }}
        >
          <span style={{ fontSize: "1.5rem" }}>⚠️</span>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Video unavailable
          </p>
          <button
            onClick={handleRetry}
            style={{
              padding: "0.3rem 0.75rem",
              borderRadius: "6px",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              background: "rgba(255, 255, 255, 0.05)",
              color: "#fff",
              fontSize: "0.7rem",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onClick={handleTap}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        position: "relative",
        width: "100%",
        paddingBottom: "56.25%", // 16:9 aspect ratio
        borderRadius: "10px",
        overflow: "hidden",
        cursor: "pointer",
        background: "#000",
      }}
      role="button"
      aria-label={altText || "Video post — tap to unmute"}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleTap(); }}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        poster={posterUrl}
        muted={isMuted}
        playsInline
        loop
        preload="metadata"
        onLoadedData={handleLoadedData}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onError={handleError}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />

      {/* Loading overlay */}
      {isLoading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.4)",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              border: "3px solid rgba(255, 255, 255, 0.2)",
              borderTopColor: "#fff",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
        </div>
      )}

      {/* Muted indicator */}
      {isMuted && isPlaying && (
        <div
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            background: "rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.75rem",
          }}
          aria-hidden="true"
        >
          🔇
        </div>
      )}

      {/* Play button (when paused and not autoplaying) */}
      {!isPlaying && !isLoading && (
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
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              background: "rgba(0, 0, 0, 0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backdropFilter: "blur(4px)",
            }}
          >
            <span style={{ fontSize: "1.2rem", marginLeft: "3px" }}>▶</span>
          </div>
        </div>
      )}

      {/* Duration badge */}
      {duration > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: "8px",
            right: "8px",
            padding: "2px 6px",
            borderRadius: "4px",
            background: "rgba(0, 0, 0, 0.7)",
            fontSize: "0.65rem",
            color: "#fff",
            fontVariantNumeric: "tabular-nums",
          }}
          aria-hidden="true"
        >
          {formatDuration(duration - currentTime)}
        </div>
      )}

      {/* Progress bar (visible on hover/touch) */}
      {showControls && duration > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "3px",
            background: "rgba(255, 255, 255, 0.2)",
          }}
        >
          <div
            style={{
              width: `${(currentTime / duration) * 100}%`,
              height: "100%",
              background: "var(--accent-blue, #38bdf8)",
              transition: "width 0.1s linear",
            }}
          />
        </div>
      )}

      {/* Inline keyframe animation for spinner */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default VideoPlayer;
