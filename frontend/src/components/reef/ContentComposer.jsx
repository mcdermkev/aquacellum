/**
 * ContentComposer.jsx
 * 
 * Modal/drawer for creating a new Tank Current.
 * Features: tank selector, caption, photo upload (max 4), parameter snapshot,
 * species tags, visibility control.
 */

import React, { useState, useRef, useEffect } from "react";
import { db } from "../../db";
import { uploadImages, createPreviewUrl, revokePreviewUrl } from "../../services/mediaUpload";
import { uploadVideo, createVideoPreviewUrl, revokeVideoPreviewUrl, isVideoFile, getMaxVideoDuration, getVideoMetadata } from "../../services/videoUpload";
import { createCurrent } from "../../services/reefApi";
import { getCurrentWallet, isSupabaseConfigured } from "../../services/supabaseClient";
import { VideoRecorder } from "../video/VideoRecorder";

const MAX_PHOTOS = 4;
const MAX_BODY_LENGTH = 2000;

export function ContentComposer({ isOpen, onClose, onSuccess, casualModeActive = false, preselectedTank = null }) {
  const [tanks, setTanks] = useState([]);
  const [selectedTank, setSelectedTank] = useState(null);
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState([]); // [{file, previewUrl}]
  const [video, setVideo] = useState(null); // {file, previewUrl, duration}
  const [showRecorder, setShowRecorder] = useState(false);
  const [visibility, setVisibility] = useState("public");
  const [params, setParams] = useState(null); // auto-fetched from tank
  const [speciesTags, setSpeciesTags] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const videoInputRef = useRef(null);

  // Load user's tanks from Dexie
  useEffect(() => {
    if (!isOpen) return;
    const walletAddress = getCurrentWallet();
    if (!walletAddress) return;

    db.tanks
      .where("ownerAddress")
      .equals(walletAddress)
      .toArray()
      .then((userTanks) => {
        const activeTanks = userTanks.filter((t) => t.active !== false);
        setTanks(activeTanks);

        if (preselectedTank) {
          const matched = activeTanks.find((t) => t.id === preselectedTank.tankId);
          if (matched) {
            setSelectedTank(matched);

            // Pre-populate tone-adapted copy
            const volumeGal = (matched.volumeLiters * 0.264172).toFixed(0);
            if (casualModeActive) {
              setBody(`Just launched my new ${volumeGal} gallon aquarium! Target parameters are looking stable, ready to watch it grow. Happy to join the community! 🐠🌊`);
            } else {
              setBody(`Primary Containment Unit (${volumeGal}G) setup complete. Target water chemistry parameters logged. Node operational. 🧬`);
            }
          }
        }
      })
      .catch(() => setTanks([]));
  }, [isOpen, preselectedTank, casualModeActive]);

  // Auto-fetch latest parameters when tank is selected
  useEffect(() => {
    if (!selectedTank) {
      setParams(null);
      return;
    }

    db.actionLogs
      .where("tankId")
      .equals(selectedTank.id)
      .reverse()
      .limit(10)
      .toArray()
      .then((logs) => {
        // Extract latest params from recent logs
        const paramLog = logs.find(
          (l) => l.actionType === "WaterTest" || l.actionType === "ParameterLog"
        );
        if (paramLog?.details) {
          setParams({
            temp: paramLog.details.temperature || paramLog.details.temp,
            ph: paramLog.details.ph || paramLog.details.pH,
            nitrate: paramLog.details.nitrate,
            ammonia: paramLog.details.ammonia,
          });
        } else {
          setParams(null);
        }
      })
      .catch(() => setParams(null));
  }, [selectedTank]);

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      photos.forEach((p) => revokePreviewUrl(p.previewUrl));
    };
  }, []);

  const handlePhotoSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const remaining = MAX_PHOTOS - photos.length;
    const newPhotos = files.slice(0, remaining).map((file) => ({
      file,
      previewUrl: createPreviewUrl(file),
    }));
    setPhotos((prev) => [...prev, ...newPhotos]);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemovePhoto = (index) => {
    setPhotos((prev) => {
      const removed = prev[index];
      revokePreviewUrl(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  // ── Video handling ──
  const handleVideoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (videoInputRef.current) videoInputRef.current.value = "";

    if (!isVideoFile(file)) {
      setError("Invalid video type. Allowed: MP4, WebM, MOV");
      return;
    }

    const maxSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxSize) {
      setError("Video too large. Maximum 100MB.");
      return;
    }

    try {
      const meta = await getVideoMetadata(file);
      if (meta.duration > getMaxVideoDuration()) {
        setError(`Video is ${Math.round(meta.duration)}s — max is ${getMaxVideoDuration()}s. Please trim it.`);
        return;
      }

      setVideo({
        file,
        previewUrl: createVideoPreviewUrl(file),
        duration: Math.round(meta.duration),
      });
      setError(null);
    } catch {
      // If metadata extraction fails, still allow — Mux will validate
      setVideo({
        file,
        previewUrl: createVideoPreviewUrl(file),
        duration: 0,
      });
    }
  };

  const handleVideoRecorded = (file) => {
    setShowRecorder(false);
    getVideoMetadata(file).then((meta) => {
      setVideo({
        file,
        previewUrl: createVideoPreviewUrl(file),
        duration: Math.round(meta.duration),
      });
    }).catch(() => {
      setVideo({
        file,
        previewUrl: createVideoPreviewUrl(file),
        duration: 0,
      });
    });
  };

  const handleRemoveVideo = () => {
    if (video) {
      revokeVideoPreviewUrl(video.previewUrl);
      setVideo(null);
    }
  };

  const handleSubmit = async () => {
    const walletAddress = getCurrentWallet();
    if (!walletAddress) return;
    if (!body.trim() && photos.length === 0 && !video) return;

    setSubmitting(true);
    setError(null);

    try {
      // Upload photos
      let mediaUrls = [];
      let mediaAltTexts = [];
      if (photos.length > 0) {
        setUploadProgress(0);
        const { urls, altTexts, errors } = await uploadImages(
          photos.map((p) => p.file),
          ({ index, progress }) => {
            setUploadProgress(
              Math.round(((index + progress / 100) / photos.length) * 100)
            );
          }
        );
        mediaUrls = urls;
        mediaAltTexts = altTexts;
        if (errors.length > 0) {
          console.warn("[Reef Composer] Some uploads failed:", errors);
        }
        setUploadProgress(100);
      }

      // Upload video (if attached)
      let videoUploadId = null;
      let videoDuration = null;
      let videoThumbnailUrl = null;
      if (video) {
        setUploadProgress(0);
        const videoResult = await uploadVideo(video.file, {
          onProgress: (pct) => setUploadProgress(pct),
        });

        if (videoResult.error) {
          setError(`Video upload failed: ${videoResult.error}`);
          setSubmitting(false);
          return;
        }

        videoUploadId = videoResult.uploadId;
        videoDuration = videoResult.duration || video.duration;
        videoThumbnailUrl = videoResult.thumbnailUrl;
      }

      // Create the Current
      const { data, error: createError } = await createCurrent({
        authorWallet: walletAddress,
        title: selectedTank?.name || null,
        body: body.trim(),
        mediaUrls,
        mediaAltTexts,
        linkedTankId: selectedTank?.id || null,
        linkedTankName: selectedTank?.name || null,
        speciesTags,
        parametersSnapshot: params,
        visibility,
        // Video fields (new)
        videoUploadId,
        videoDuration,
        videoThumbnailUrl,
      });

      if (createError) {
        setError(createError);
        return;
      }

      // Success — reset and close
      setBody("");
      setPhotos([]);
      handleRemoveVideo();
      setSelectedTank(null);
      setParams(null);
      setSpeciesTags([]);
      setVisibility("public");
      setUploadProgress(null);

      // Mark first current posted to hide welcome cues
      localStorage.setItem("aquadex_posted_first_current", "true");
      window.dispatchEvent(new CustomEvent("aquadex_first_current_posted"));

      onSuccess?.(data);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to create post");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  if (!isOpen) return null;

  const canSubmit = (body.trim() || photos.length > 0 || video) && !submitting;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Create a new post"
    >
      <div
        className="reef-composer-modal"
        style={{
          width: "100%",
          maxWidth: "520px",
          maxHeight: "85vh",
          overflow: "auto",
          background: "rgba(15, 23, 42, 0.95)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "16px",
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.6)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#fff" }}>
            {casualModeActive ? "🪸 Share a Tank Update" : "New Current"}
          </h3>
          <button
            onClick={handleClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              fontSize: "1.2rem",
              cursor: "pointer",
              padding: "0.25rem",
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* First-post pro-tip banner */}
        {localStorage.getItem("aquadex_posted_first_current") !== "true" && (
          <div style={{
            padding: "0.6rem 0.85rem",
            borderRadius: "8px",
            border: casualModeActive 
              ? "1px solid rgba(56, 189, 248, 0.2)" 
              : "1px solid rgba(168, 85, 247, 0.25)",
            background: casualModeActive 
              ? "rgba(56, 189, 248, 0.04)" 
              : "rgba(168, 85, 247, 0.04)",
            fontSize: "0.75rem",
            color: "var(--text-secondary)",
            lineHeight: "1.4",
          }}>
            {casualModeActive
              ? "✨ Pro-tip: Linking your aquarium automatically attaches your water stats to show other keepers!"
              : "✨ Pro-tip: Linking a containment unit attaches your water chemistry snapshot to the feed log!"}
          </div>
        )}

        {/* Tank selector */}
        {tanks.length > 0 && (
          <div>
            <label style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.25rem", display: "block" }}>
              {casualModeActive ? "Which tank?" : "Linked Tank"}
            </label>
            <select
              value={selectedTank?.id || ""}
              onChange={(e) => {
                const tank = tanks.find((t) => t.id === e.target.value);
                setSelectedTank(tank || null);
              }}
              style={{
                width: "100%",
                padding: "0.5rem",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                background: "rgba(255, 255, 255, 0.04)",
                color: "#fff",
                fontSize: "0.8rem",
              }}
            >
              <option value="">None (general post)</option>
              {tanks.map((tank) => (
                <option key={tank.id} value={tank.id}>
                  {tank.name || `Tank ${tank.id.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Body textarea */}
        <div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY_LENGTH))}
            placeholder={casualModeActive
              ? "What's happening in your tank today?"
              : "Describe your observation, update, or question..."
            }
            rows={4}
            style={{
              width: "100%",
              resize: "vertical",
              padding: "0.75rem",
              borderRadius: "10px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              background: "rgba(255, 255, 255, 0.03)",
              color: "#fff",
              fontSize: "0.85rem",
              lineHeight: "1.6",
              fontFamily: "inherit",
              outline: "none",
              minHeight: "100px",
            }}
            onFocus={(e) => { e.target.style.borderColor = "rgba(56, 189, 248, 0.3)"; }}
            onBlur={(e) => { e.target.style.borderColor = "rgba(255, 255, 255, 0.08)"; }}
          />
          <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", float: "right" }}>
            {body.length}/{MAX_BODY_LENGTH}
          </span>
        </div>

        {/* Photo upload */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={photos.length >= MAX_PHOTOS || !!video}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                background: "rgba(255, 255, 255, 0.04)",
                color: photos.length >= MAX_PHOTOS || video ? "var(--text-muted)" : "#fff",
                fontSize: "0.75rem",
                cursor: photos.length >= MAX_PHOTOS || video ? "default" : "pointer",
              }}
            >
              📷 Add Photos ({photos.length}/{MAX_PHOTOS})
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={handlePhotoSelect}
              style={{ display: "none" }}
              aria-label="Select photos"
            />
          </div>

          {/* Photo previews */}
          {photos.length > 0 && (
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {photos.map((photo, i) => (
                <div key={i} style={{ position: "relative", width: "72px", height: "72px" }}>
                  <img
                    src={photo.previewUrl}
                    alt={`Upload ${i + 1}`}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      borderRadius: "8px",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                    }}
                  />
                  <button
                    onClick={() => handleRemovePhoto(i)}
                    style={{
                      position: "absolute",
                      top: "-4px",
                      right: "-4px",
                      width: "18px",
                      height: "18px",
                      borderRadius: "50%",
                      background: "rgba(239, 68, 68, 0.9)",
                      border: "none",
                      color: "#fff",
                      fontSize: "0.6rem",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Video upload */}
        <div>
          {!video && photos.length === 0 && !showRecorder && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <button
                onClick={() => videoInputRef.current?.click()}
                style={{
                  padding: "0.4rem 0.75rem",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  background: "rgba(255, 255, 255, 0.04)",
                  color: "#fff",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                🎬 Add Video
              </button>
              <button
                onClick={() => setShowRecorder(true)}
                style={{
                  padding: "0.4rem 0.75rem",
                  borderRadius: "8px",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  background: "rgba(255, 255, 255, 0.04)",
                  color: "#fff",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                ⏺️ Record
              </button>
              <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime,video/x-m4v"
                onChange={handleVideoSelect}
                style={{ display: "none" }}
                aria-label="Select video"
              />
              <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>
                Max {getMaxVideoDuration()}s
              </span>
            </div>
          )}

          {/* Video recorder */}
          {showRecorder && (
            <VideoRecorder
              onRecorded={handleVideoRecorded}
              onCancel={() => setShowRecorder(false)}
            />
          )}

          {/* Video preview */}
          {video && (
            <div style={{ position: "relative", borderRadius: "10px", overflow: "hidden" }}>
              <video
                src={video.previewUrl}
                style={{
                  width: "100%",
                  maxHeight: "200px",
                  objectFit: "cover",
                  borderRadius: "10px",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                }}
                muted
                playsInline
                preload="metadata"
              />
              {/* Duration badge */}
              {video.duration > 0 && (
                <span style={{
                  position: "absolute",
                  bottom: "8px",
                  right: "8px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: "rgba(0, 0, 0, 0.7)",
                  fontSize: "0.65rem",
                  color: "#fff",
                }}>
                  🎬 {video.duration}s
                </span>
              )}
              {/* Remove button */}
              <button
                onClick={handleRemoveVideo}
                style={{
                  position: "absolute",
                  top: "6px",
                  right: "6px",
                  width: "22px",
                  height: "22px",
                  borderRadius: "50%",
                  background: "rgba(239, 68, 68, 0.9)",
                  border: "none",
                  color: "#fff",
                  fontSize: "0.7rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                aria-label="Remove video"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Parameters snapshot (auto-detected) */}
        {params && (
          <div style={{
            padding: "0.5rem 0.75rem",
            borderRadius: "8px",
            background: "rgba(52, 211, 153, 0.05)",
            border: "1px solid rgba(52, 211, 153, 0.1)",
            fontSize: "0.7rem",
            color: "var(--text-secondary)",
          }}>
            <span style={{ fontWeight: 600, color: "var(--accent-green, #34d399)" }}>📊 Latest params attached:</span>{" "}
            {params.temp && `${params.temp}°C`}
            {params.ph && ` • pH ${params.ph}`}
            {params.nitrate && ` • NO₃ ${params.nitrate}ppm`}
          </div>
        )}

        {/* Visibility */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Visible to:</label>
          <div style={{ display: "flex", gap: "0.35rem" }}>
            {[
              { value: "public", label: "🌍 Everyone" },
              { value: "tankmates", label: "🤝 Tankmates" },
              { value: "private", label: "🔒 Only me" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setVisibility(opt.value)}
                style={{
                  padding: "0.25rem 0.5rem",
                  borderRadius: "50px",
                  border: visibility === opt.value
                    ? "1px solid rgba(56, 189, 248, 0.4)"
                    : "1px solid rgba(255, 255, 255, 0.08)",
                  background: visibility === opt.value
                    ? "rgba(56, 189, 248, 0.1)"
                    : "transparent",
                  color: visibility === opt.value ? "#fff" : "var(--text-muted)",
                  fontSize: "0.65rem",
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--accent-red, #f87171)" }}>
            ⚠️ {error}
          </p>
        )}

        {/* Upload progress */}
        {uploadProgress !== null && uploadProgress < 100 && (
          <div style={{ width: "100%", height: "3px", background: "rgba(255,255,255,0.05)", borderRadius: "2px" }}>
            <div style={{
              width: `${uploadProgress}%`,
              height: "100%",
              background: "var(--accent-blue, #38bdf8)",
              borderRadius: "2px",
              transition: "width 0.2s ease",
            }} />
          </div>
        )}

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            width: "100%",
            padding: "0.7rem",
            borderRadius: "10px",
            border: "none",
            background: canSubmit
              ? "linear-gradient(135deg, #0ea5e9, #0369a1)"
              : "rgba(255, 255, 255, 0.05)",
            color: canSubmit ? "#fff" : "var(--text-muted)",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: canSubmit ? "pointer" : "default",
            transition: "all 0.2s ease",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "Posting..." : casualModeActive ? "🪸 Share Update" : "Post Current"}
        </button>

        {/* Not configured warning */}
        {!isSupabaseConfigured() && (
          <p style={{ margin: 0, fontSize: "0.65rem", color: "var(--text-muted)", textAlign: "center" }}>
            ⚠️ Social features are in preview mode — Supabase not yet configured.
          </p>
        )}
      </div>
    </div>
  );
}
