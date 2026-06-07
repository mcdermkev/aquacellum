/**
 * ProfileEdit.jsx
 * 
 * Inline profile editor — lets users change their display name, bio, and avatar.
 * Shown on the user's own profile page as an "Edit Profile" toggle.
 */

import React, { useState, useRef } from "react";
import { useUpdateProfile } from "../../hooks/useReefProfile";
import { uploadImage, createPreviewUrl, revokePreviewUrl } from "../../services/mediaUpload";
import { getCurrentWallet } from "../../services/supabaseClient";
import { DataPrivacySettings } from "./DataPrivacySettings";

export function ProfileEdit({ profile, onSave, onCancel, casualModeActive = false }) {
  const [displayName, setDisplayName] = useState(profile?.display_name || "");
  const [bio, setBio] = useState(profile?.bio || "");
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(profile?.avatar_url || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const updateProfile = useUpdateProfile();

  const handleAvatarSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Revoke old preview
    if (avatarPreview && avatarPreview !== profile?.avatar_url) {
      revokePreviewUrl(avatarPreview);
    }

    setAvatarFile(file);
    setAvatarPreview(createPreviewUrl(file));
  };

  const handleSave = async () => {
    const walletAddress = getCurrentWallet();
    if (!walletAddress) return;

    setSaving(true);
    setError(null);

    try {
      const updates = {};

      // Name
      if (displayName.trim() !== (profile?.display_name || "")) {
        updates.display_name = displayName.trim() || null;
      }

      // Bio
      if (bio.trim() !== (profile?.bio || "")) {
        updates.bio = bio.trim() || null;
      }

      // Avatar upload
      if (avatarFile) {
        const { url, error: uploadError } = await uploadImage(avatarFile);
        if (uploadError) {
          setError(`Avatar upload failed: ${uploadError}`);
          setSaving(false);
          return;
        }
        updates.avatar_url = url;
      }

      if (Object.keys(updates).length > 0) {
        updateProfile.mutate(
          { walletAddress, updates },
          {
            onSuccess: (result) => {
              if (result.data) {
                onSave?.(result.data);
              } else {
                onSave?.({ ...profile, ...updates });
              }
            },
            onError: (err) => {
              setError(err.message || "Failed to save");
            },
          }
        );
      } else {
        onSave?.(profile);
      }
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        padding: "1.25rem",
        borderRadius: "12px",
        background: "rgba(255, 255, 255, 0.02)",
        border: "1px solid rgba(56, 189, 248, 0.12)",
      }}
    >
      <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600, color: "#fff" }}>
        {casualModeActive ? "✏️ Edit Your Profile" : "Edit Profile"}
      </h3>

      {/* Avatar */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            background: avatarPreview
              ? `url(${avatarPreview}) center/cover`
              : "linear-gradient(135deg, #374151, #1f2937)",
            border: "2px solid rgba(56, 189, 248, 0.3)",
            cursor: "pointer",
            flexShrink: 0,
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Click to change avatar"
        >
          {!avatarPreview && (
            <span style={{ fontSize: "1.2rem" }}>📷</span>
          )}
          <div style={{
            position: "absolute",
            bottom: "-2px",
            right: "-2px",
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            background: "var(--accent-blue)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.5rem",
            color: "#fff",
            fontWeight: 700,
          }}>
            ✎
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleAvatarSelect}
          style={{ display: "none" }}
        />
        <p style={{ margin: 0, fontSize: "0.65rem", color: "var(--text-muted)" }}>
          {casualModeActive ? "Tap to upload a photo" : "Click to change avatar"}
        </p>
      </div>

      {/* Display name */}
      <div>
        <label style={{ fontSize: "0.7rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.3rem" }}>
          {casualModeActive ? "Display Name" : "Callsign"}
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value.slice(0, 30))}
          placeholder="Your name..."
          maxLength={30}
          style={{
            width: "100%",
            padding: "0.6rem 0.8rem",
            borderRadius: "8px",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            background: "rgba(255, 255, 255, 0.03)",
            color: "#fff",
            fontSize: "0.85rem",
            outline: "none",
          }}
          onFocus={(e) => { e.target.style.borderColor = "rgba(56, 189, 248, 0.3)"; }}
          onBlur={(e) => { e.target.style.borderColor = "rgba(255, 255, 255, 0.1)"; }}
        />
      </div>

      {/* Bio */}
      <div>
        <label style={{ fontSize: "0.7rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.3rem" }}>
          Bio
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 280))}
          placeholder={casualModeActive ? "Tell other fishkeepers about yourself..." : "Describe your operation..."}
          rows={3}
          maxLength={280}
          style={{
            width: "100%",
            padding: "0.6rem 0.8rem",
            borderRadius: "8px",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            background: "rgba(255, 255, 255, 0.03)",
            color: "#fff",
            fontSize: "0.8rem",
            lineHeight: "1.5",
            resize: "vertical",
            fontFamily: "inherit",
            outline: "none",
            minHeight: "70px",
          }}
          onFocus={(e) => { e.target.style.borderColor = "rgba(56, 189, 248, 0.3)"; }}
          onBlur={(e) => { e.target.style.borderColor = "rgba(255, 255, 255, 0.1)"; }}
        />
        <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", float: "right" }}>
          {bio.length}/280
        </span>
      </div>

      {/* Error */}
      {error && (
        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--accent-red)" }}>
          ⚠️ {error}
        </p>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          disabled={saving}
          style={{
            padding: "0.45rem 1rem",
            borderRadius: "8px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            background: "transparent",
            color: "var(--text-muted)",
            fontSize: "0.75rem",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !displayName.trim()}
          style={{
            padding: "0.45rem 1rem",
            borderRadius: "8px",
            border: "none",
            background: saving ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #0ea5e9, #0369a1)",
            color: saving ? "var(--text-muted)" : "#fff",
            fontSize: "0.75rem",
            fontWeight: 600,
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving..." : casualModeActive ? "Save ✨" : "Save Changes"}
        </button>
      </div>

      {/* Data & Privacy Section */}
      <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid rgba(255, 255, 255, 0.05)" }}>
        <DataPrivacySettings casualModeActive={casualModeActive} />
      </div>
    </div>
  );
}
