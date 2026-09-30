/**
 * ContentComposer.jsx
 * 
 * The "Share a tank update" dialog (a post is a "current" in the data).
 * Features: tank selector, caption, photo upload (max 4), parameter snapshot,
 * species tags, visibility control.
 */

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { db } from "../../db";
import { uploadImages, createPreviewUrl, revokePreviewUrl } from "../../services/mediaUpload";
import { uploadVideo, createVideoPreviewUrl, revokeVideoPreviewUrl, isVideoFile, getMaxVideoDuration, getVideoMetadata } from "../../services/videoUpload";
import { createCurrent } from "../../services/reefApi";
import { getCurrentWallet, isSupabaseConfigured } from "../../services/supabaseClient";
import { VideoRecorder } from "../video/VideoRecorder";
import { SPECIES_SECTIONS } from "../../constants/speciesSections";
import { useUnitPrefs } from "../../hooks/useUnitPrefs";
import { formatTemperature } from "../../utils/units";
import "./ReefComposer.css";

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
  const { tempUnit } = useUnitPrefs();
  const [speciesTags, setSpeciesTags] = useState([]);
  const [section, setSection] = useState(null); // species-page section routing
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

            // A starting line from what we actually know (the tank's size).
            // No claims about water quality: the keeper adds those.
            const volumeGal = Math.round(Number(matched.volumeLiters) * 0.264172);
            setBody(volumeGal > 0 ? `Just set up a new ${volumeGal} gallon tank.` : "Just set up a new tank.");
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
        setError(`Video is ${Math.round(meta.duration)}s. The limit is ${getMaxVideoDuration()}s, so please trim it.`);
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
        section,
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
      setSection(null);
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

  // Escape closes; focus lands in the text box when the composer opens.
  const textRef = useRef(null);
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => textRef.current?.focus(), 50);
    return () => { document.removeEventListener("keydown", onKey); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, submitting]);

  if (!isOpen) return null;

  const canSubmit = (body.trim() || photos.length > 0 || video) && !submitting;
  const firstPost = (() => {
    try { return localStorage.getItem("aquadex_posted_first_current") !== "true"; } catch { return false; }
  })();
  const hasReading = !!params && (params.temp != null || params.ph != null || params.nitrate != null);
  const VISIBILITY = [
    { value: "public", label: "Everyone", hint: "Anyone can see it on Explore" },
    { value: "tankmates", label: "Tankmates", hint: "Only people you are connected with" },
    { value: "private", label: "Only me", hint: "A private note in your feed" },
  ];

  return createPortal(
    <div
      className="rcomp-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="rcomp" role="dialog" aria-modal="true" aria-labelledby="rcomp-title">
        <div className="rcomp-head">
          <div>
            <p className="rcomp-kicker">The Reef</p>
            <h3 className="rcomp-title" id="rcomp-title">Share a tank update</h3>
          </div>
          <button type="button" className="rcomp-close" onClick={handleClose} disabled={submitting} aria-label="Close">
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {firstPost && tanks.length > 0 && (
          <p className="rcomp-tip">
            Pick one of your tanks and its latest logged water test is added to the post, so other keepers can see your numbers.
          </p>
        )}

        {tanks.length > 0 && (
          <div className="rcomp-field">
            <label className="rcomp-label" htmlFor="rcomp-tank">Tank <span className="rcomp-optional">(optional)</span></label>
            <select
              id="rcomp-tank"
              className="rcomp-select"
              value={selectedTank?.id || ""}
              onChange={(e) => {
                const tank = tanks.find((t) => String(t.id) === e.target.value);
                setSelectedTank(tank || null);
              }}
            >
              <option value="">No tank, a general post</option>
              {tanks.map((tank) => (
                <option key={tank.id} value={tank.id}>
                  {tank.name || `Tank ${String(tank.id).slice(0, 8)}`}
                </option>
              ))}
            </select>
            {selectedTank && (
              hasReading ? (
                <p className="rcomp-reading">
                  <strong>Latest water test attached:</strong>{" "}
                  {[
                    params.temp != null && formatTemperature(params.temp, tempUnit, { parenthesizeSecond: true }),
                    params.ph != null && `pH ${params.ph}`,
                    params.nitrate != null && `nitrate ${params.nitrate} ppm`,
                  ].filter(Boolean).join(", ")}
                </p>
              ) : (
                <p className="rcomp-note">No water test logged for this tank yet, so no readings are attached.</p>
              )
            )}
          </div>
        )}

        <div className="rcomp-field">
          <label className="rcomp-label" htmlFor="rcomp-body">What&apos;s happening?</label>
          <textarea
            id="rcomp-body"
            ref={textRef}
            className="rcomp-text"
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY_LENGTH))}
            placeholder="A new fish, a spawn, a question, or how the tank looks today"
            rows={4}
          />
          <span className="rcomp-count" aria-live="polite">{body.length}/{MAX_BODY_LENGTH}</span>
        </div>

        <div className="rcomp-field">
          <span className="rcomp-label">Photos or a video <span className="rcomp-optional">(optional)</span></span>
          {!showRecorder && !video && (
            <div className="rcomp-media-actions">
              <button
                type="button"
                className="rcomp-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={photos.length >= MAX_PHOTOS}
              >
                Add photos ({photos.length}/{MAX_PHOTOS})
              </button>
              {photos.length === 0 && (
                <>
                  <button type="button" className="rcomp-btn" onClick={() => videoInputRef.current?.click()}>Add a video</button>
                  <button type="button" className="rcomp-btn" onClick={() => setShowRecorder(true)}>Record</button>
                  <span className="rcomp-note">Videos up to {getMaxVideoDuration()} seconds</span>
                </>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            onChange={handlePhotoSelect}
            hidden
            aria-label="Select photos"
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/x-m4v"
            onChange={handleVideoSelect}
            hidden
            aria-label="Select video"
          />

          {photos.length > 0 && (
            <ul className="rcomp-thumbs">
              {photos.map((photo, i) => (
                <li key={photo.previewUrl}>
                  <img src={photo.previewUrl} alt={`Photo ${i + 1} to upload`} />
                  <button type="button" className="rcomp-remove" onClick={() => handleRemovePhoto(i)} aria-label={`Remove photo ${i + 1}`}>
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {showRecorder && (
            <VideoRecorder onRecorded={handleVideoRecorded} onCancel={() => setShowRecorder(false)} />
          )}

          {video && (
            <div className="rcomp-video">
              <video src={video.previewUrl} muted playsInline preload="metadata" />
              {video.duration > 0 && <span className="rcomp-duration">{video.duration}s</span>}
              <button type="button" className="rcomp-remove" onClick={handleRemoveVideo} aria-label="Remove video">
                <span aria-hidden="true">×</span>
              </button>
            </div>
          )}
        </div>

        {speciesTags.length > 0 && (
          <div className="rcomp-field">
            <span className="rcomp-label">What is it about?</span>
            <div className="rcomp-chips">
              <button type="button" className="rcomp-chip" aria-pressed={section === null} onClick={() => setSection(null)}>General</button>
              {SPECIES_SECTIONS.map((sec) => (
                <button key={sec.id} type="button" className="rcomp-chip" aria-pressed={section === sec.id} onClick={() => setSection(sec.id)} title={sec.description}>
                  {sec.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <fieldset className="rcomp-field rcomp-visibility">
          <legend className="rcomp-label">Who can see it</legend>
          <div className="rcomp-chips">
            {VISIBILITY.map((opt) => (
              <label key={opt.value} className="rcomp-chip rcomp-chip--radio" title={opt.hint}>
                <input
                  type="radio"
                  name="rcomp-visibility"
                  value={opt.value}
                  checked={visibility === opt.value}
                  onChange={() => setVisibility(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
          <p className="rcomp-note">{VISIBILITY.find((o) => o.value === visibility)?.hint}</p>
        </fieldset>

        {error && <p className="rcomp-error" role="alert">{error}</p>}

        {uploadProgress !== null && uploadProgress < 100 && (
          <div className="rcomp-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress} aria-label="Upload progress">
            <span style={{ width: `${uploadProgress}%` }} />
          </div>
        )}

        <div className="rcomp-actions">
          <button type="button" className="rcomp-btn" onClick={handleClose} disabled={submitting}>Cancel</button>
          <button type="button" className="rcomp-btn rcomp-btn--primary" onClick={handleSubmit} disabled={!canSubmit} aria-busy={submitting}>
            {submitting ? "Posting…" : "Post"}
          </button>
        </div>

        {!isSupabaseConfigured() && (
          <p className="rcomp-note">Posting isn&apos;t connected in this build, so nothing will be saved.</p>
        )}
      </div>
    </div>,
    document.body
  );
}
