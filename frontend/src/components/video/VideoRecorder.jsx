/**
 * VideoRecorder.jsx
 * 
 * In-app camera recording component for creating video Currents.
 * Features:
 * - Live camera preview
 * - Circular countdown timer (60s max)
 * - Tap to start/stop recording
 * - Front/back camera toggle (mobile)
 * - Returns recorded file for upload
 */

import React, { useRef, useState, useCallback, useEffect } from "react";
import { getMaxVideoDuration } from "../../services/videoUpload";

const MAX_DURATION = getMaxVideoDuration();

/**
 * Circular progress ring for recording timer.
 */
function TimerRing({ seconds, maxSeconds }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const progress = seconds / maxSeconds;
  const dashOffset = circumference * (1 - progress);

  return (
    <svg width="64" height="64" style={{ transform: "rotate(-90deg)" }}>
      {/* Background ring */}
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        stroke="rgba(255, 255, 255, 0.15)"
        strokeWidth="3"
      />
      {/* Progress ring */}
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        stroke={progress > 0.8 ? "#f87171" : "#38bdf8"}
        strokeWidth="3"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 1s linear, stroke 0.3s ease" }}
      />
    </svg>
  );
}

/**
 * In-app video recorder with live camera preview.
 * 
 * @param {object} props
 * @param {function} props.onRecorded - Callback with the recorded File
 * @param {function} props.onCancel - Called when user dismisses the recorder
 */
export function VideoRecorder({ onRecorded, onCancel }) {
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [facingMode, setFacingMode] = useState("environment"); // back camera default
  const [error, setError] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);

  // ── Start camera preview ──
  const startCamera = useCallback(async (facing) => {
    try {
      // Stop any existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: true,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setCameraReady(true);
      setError(null);
    } catch (err) {
      console.error("[VideoRecorder] Camera error:", err);
      if (err.name === "NotAllowedError") {
        setError("Camera access denied. Please allow camera permissions.");
      } else if (err.name === "NotFoundError") {
        setError("No camera found on this device.");
      } else {
        setError("Could not start camera: " + err.message);
      }
    }
  }, []);

  // Initialize camera on mount
  useEffect(() => {
    startCamera(facingMode);

    return () => {
      // Cleanup on unmount
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // ── Toggle front/back camera ──
  const handleFlipCamera = () => {
    if (isRecording) return; // Don't flip while recording
    const newFacing = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newFacing);
    startCamera(newFacing);
  };

  // ── Start recording ──
  const handleStartRecording = () => {
    if (!streamRef.current) return;

    chunksRef.current = [];
    setSeconds(0);

    // Determine supported mime type
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "video/mp4";

    const recorder = new MediaRecorder(streamRef.current, {
      mimeType,
      videoBitsPerSecond: 2_500_000, // 2.5 Mbps for decent quality
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const extension = mimeType.includes("webm") ? "webm" : "mp4";
      const file = new File([blob], `reef-video-${Date.now()}.${extension}`, {
        type: mimeType,
      });
      onRecorded(file);
    };

    recorder.start(1000); // Collect data every second
    mediaRecorderRef.current = recorder;
    setIsRecording(true);

    // Start countdown timer
    timerRef.current = setInterval(() => {
      setSeconds((prev) => {
        const next = prev + 1;
        if (next >= MAX_DURATION) {
          handleStopRecording();
        }
        return next;
      });
    }, 1000);
  };

  // ── Stop recording ──
  const handleStopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    setIsRecording(false);
  }, []);

  // ── Cancel and close ──
  const handleCancel = () => {
    if (isRecording) {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current?.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    onCancel();
  };

  // ── Error state ──
  if (error) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <span style={{ fontSize: "2rem" }}>📷</span>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)" }}>
          {error}
        </p>
        <button
          onClick={onCancel}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: "8px",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            background: "rgba(255, 255, 255, 0.05)",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        maxWidth: "480px",
        borderRadius: "12px",
        overflow: "hidden",
        background: "#000",
      }}
    >
      {/* Camera preview */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: "100%",
          aspectRatio: "16/9",
          objectFit: "cover",
          transform: facingMode === "user" ? "scaleX(-1)" : "none",
        }}
      />

      {/* Top bar: close + flip camera */}
      <div
        style={{
          position: "absolute",
          top: "8px",
          left: "8px",
          right: "8px",
          display: "flex",
          justifyContent: "space-between",
          zIndex: 2,
        }}
      >
        <button
          onClick={handleCancel}
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            background: "rgba(0, 0, 0, 0.5)",
            border: "none",
            color: "#fff",
            fontSize: "1rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-label="Close camera"
        >
          ✕
        </button>
        <button
          onClick={handleFlipCamera}
          disabled={isRecording}
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            background: "rgba(0, 0, 0, 0.5)",
            border: "none",
            color: "#fff",
            fontSize: "0.9rem",
            cursor: isRecording ? "default" : "pointer",
            opacity: isRecording ? 0.4 : 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-label="Flip camera"
        >
          🔄
        </button>
      </div>

      {/* Recording indicator */}
      {isRecording && (
        <div
          style={{
            position: "absolute",
            top: "12px",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            padding: "0.2rem 0.6rem",
            borderRadius: "50px",
            background: "rgba(239, 68, 68, 0.8)",
            fontSize: "0.7rem",
            color: "#fff",
            fontWeight: 600,
          }}
          role="status"
          aria-live="polite"
        >
          <span style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "#fff",
            animation: "pulse 1s ease-in-out infinite",
          }} />
          {seconds}s / {MAX_DURATION}s
        </div>
      )}

      {/* Bottom controls: record button with timer ring */}
      <div
        style={{
          position: "absolute",
          bottom: "16px",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <div style={{ position: "relative", width: "64px", height: "64px" }}>
          {/* Timer ring */}
          {isRecording && <TimerRing seconds={seconds} maxSeconds={MAX_DURATION} />}

          {/* Record/Stop button */}
          <button
            onClick={isRecording ? handleStopRecording : handleStartRecording}
            disabled={!cameraReady}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: isRecording ? "28px" : "44px",
              height: isRecording ? "28px" : "44px",
              borderRadius: isRecording ? "6px" : "50%",
              background: isRecording ? "#f87171" : "#ef4444",
              border: isRecording ? "none" : "3px solid rgba(255, 255, 255, 0.8)",
              cursor: cameraReady ? "pointer" : "default",
              transition: "all 0.2s ease",
            }}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
          />
        </div>

        {!isRecording && (
          <span style={{ fontSize: "0.65rem", color: "rgba(255, 255, 255, 0.6)" }}>
            Tap to record (max {MAX_DURATION}s)
          </span>
        )}
      </div>

      {/* Keyframe animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

export default VideoRecorder;
