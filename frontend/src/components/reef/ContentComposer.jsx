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
import { createCurrent } from "../../services/reefApi";
import { getCurrentWallet, isSupabaseConfigured } from "../../services/supabaseClient";

const MAX_PHOTOS = 4;
const MAX_BODY_LENGTH = 2000;

export function ContentComposer({ isOpen, onClose, onSuccess, casualModeActive = false }) {
  const [tanks, setTanks] = useState([]);
  const [selectedTank, setSelectedTank] = useState(null);
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState([]); // [{file, previewUrl}]
  const [visibility, setVisibility] = useState("public");
  const [params, setParams] = useState(null); // auto-fetched from tank
  const [speciesTags, setSpeciesTags] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

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
        setTanks(userTanks.filter((t) => t.active !== false));
      })
      .catch(() => setTanks([]));
  }, [isOpen]);

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

  const handleSubmit = async () => {
    const walletAddress = getCurrentWallet();
    if (!walletAddress) return;
    if (!body.trim() && photos.length === 0) return;

    setSubmitting(true);
    setError(null);

    try {
      // Upload photos
      let mediaUrls = [];
      if (photos.length > 0) {
        setUploadProgress(0);
        const { urls, errors } = await uploadImages(
          photos.map((p) => p.file),
          ({ index, progress }) => {
            setUploadProgress(
              Math.round(((index + progress / 100) / photos.length) * 100)
            );
          }
        );
        mediaUrls = urls;
        if (errors.length > 0) {
          console.warn("[Reef Composer] Some uploads failed:", errors);
        }
        setUploadProgress(100);
      }

      // Create the Current
      const { data, error: createError } = await createCurrent({
        authorWallet: walletAddress,
        title: selectedTank?.name || null,
        body: body.trim(),
        mediaUrls,
        linkedTankId: selectedTank?.id || null,
        linkedTankName: selectedTank?.name || null,
        speciesTags,
        parametersSnapshot: params,
        visibility,
      });

      if (createError) {
        setError(createError);
        return;
      }

      // Success — reset and close
      setBody("");
      setPhotos([]);
      setSelectedTank(null);
      setParams(null);
      setSpeciesTags([]);
      setVisibility("public");
      setUploadProgress(null);
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

  const canSubmit = (body.trim() || photos.length > 0) && !submitting;

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
              disabled={photos.length >= MAX_PHOTOS}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                background: "rgba(255, 255, 255, 0.04)",
                color: photos.length >= MAX_PHOTOS ? "var(--text-muted)" : "#fff",
                fontSize: "0.75rem",
                cursor: photos.length >= MAX_PHOTOS ? "default" : "pointer",
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
