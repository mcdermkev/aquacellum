/**
 * ProfileEdit.jsx
 * 
 * Inline profile editor — lets users change their display name, bio, and avatar.
 * Shown on the user's own profile page as an "Edit Profile" toggle.
 */

import React, { useState, useRef } from "react";
import { Camera, PencilSimple, WarningCircle } from "@phosphor-icons/react";
import { useUpdateProfile } from "../../hooks/useReefProfile";
import { uploadImage, createPreviewUrl, revokePreviewUrl } from "../../services/mediaUpload";
import { getCurrentWallet } from "../../services/supabaseClient";
import "./ProfileDaylight.css";
// DataPrivacySettings is intentionally NOT imported here any more — Settings →
// Privacy & Data is its single home (docs/SETTINGS_SPEC.md D-S-1).

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
        // An `aquadex:avatar_set` CustomEvent used to be dispatched here. Its only
        // listener was the onboarding tour's profile step, which has been deleted,
        // so the event became a dispatch into the void — the exact one-sided seam
        // that scripts/seams/report.mjs exists to catch. Removed rather than left
        // firing, since a listener-less event reads like a working notification.
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
    <div className="pf-edit">
      <h3>Edit profile</h3>

      {/* Avatar */}
      <div className="pf-edit-avatar-row">
        <button
          type="button"
          className="pf-edit-avatar"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Change profile photo"
          style={avatarPreview ? { backgroundImage: `url(${avatarPreview})` } : undefined}
        >
          {!avatarPreview && <Camera size={24} weight="duotone" aria-hidden="true" />}
          <span className="pf-edit-avatar-badge" aria-hidden="true">
            <PencilSimple size={12} weight="bold" />
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleAvatarSelect}
          style={{ display: "none" }}
        />
        <p className="pf-muted">
          {casualModeActive ? "Tap to change your photo" : "Click to change your photo"}
        </p>
      </div>

      {/* Display name */}
      <div className="reef-form-field">
        <label className="reef-form-label" htmlFor="pf-edit-name">Display name</label>
        <input
          id="pf-edit-name"
          type="text"
          className="reef-form-input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value.slice(0, 30))}
          placeholder="Your name"
          maxLength={30}
        />
      </div>

      {/* Bio */}
      <div className="reef-form-field">
        <label className="reef-form-label" htmlFor="pf-edit-bio">Bio</label>
        <textarea
          id="pf-edit-bio"
          className="reef-form-input reef-form-textarea"
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 280))}
          placeholder={casualModeActive ? "Tell other keepers about you and your tanks" : "What you keep and breed"}
          rows={3}
          maxLength={280}
        />
        <span className="pf-edit-count">{bio.length}/280</span>
      </div>

      {/* Error */}
      {error && (
        <p className="pf-error" role="alert">
          <WarningCircle size={16} weight="bold" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {/* Actions */}
      <div className="pf-edit-actions">
        <button type="button" className="reef-btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="reef-btn reef-btn--primary"
          onClick={handleSave}
          disabled={saving || !displayName.trim()}
        >
          {saving ? "Saving…" : casualModeActive ? "Save" : "Save changes"}
        </button>
      </div>

      {/*
        Data & Privacy MOVED to Settings → Privacy & Data (docs/SETTINGS_SPEC.md
        D-S-1). This used to render `DataPrivacySettings` inline, which made Reef →
        ProfileEdit the only route to account deletion — the highest-stakes control
        in the product — while Settings offered "Reset Local Data", which merely
        clears this browser. A user intending to delete their account found the
        wrong button in the more obvious place.

        Settings is now the single entry point. This is a link, not a second copy:
        two live renders of a deletion flow means two places to keep a
        confirmation gate correct.
      */}
      <div className="pf-edit-data">
        <h4>{casualModeActive ? "Your data" : "Data and privacy"}</h4>
        <p>Export your data or delete your account in Settings.</p>
        <button
          type="button"
          className="reef-btn"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("aquadex:navigate-tab", {
                detail: { tab: "settings", section: "privacy" },
              })
            )
          }
        >
          Open Settings
        </button>
      </div>
    </div>
  );
}
