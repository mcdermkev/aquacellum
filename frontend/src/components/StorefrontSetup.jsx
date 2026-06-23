/**
 * StorefrontSetup.jsx — "Setup My Store" panel for breeders.
 *
 * Allows beta testers (and eventually earned Master Breeders) to create
 * or edit their storefront profile: slug, display name, bio, specialties,
 * location, and avatar. Writes to Supabase via /api/storefront/setup endpoint.
 *
 * Gated by beta allowlist in the parent (App.jsx passes `isEligible` prop).
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Storefront,
  Check,
  Warning,
  Link as LinkIcon,
  Pencil,
  SpinnerGap,
  Eye,
  Plus,
  X,
} from "@phosphor-icons/react";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const MAX_BIO = 280;
const MAX_SPECIALTIES = 5;

const SPECIALTY_SUGGESTIONS = [
  "Dwarf Cichlids", "African Cichlids", "Livebearers", "Corydoras",
  "Bettas", "Plecos", "Tetras", "Barbs", "Rainbowfish", "Gouramis",
  "Shrimp", "Rare Imports", "Wild-Caught", "Nano Fish", "Loaches",
];

export function StorefrontSetup({ walletAccount, casualModeActive, existingProfile }) {
  // Form state
  const [slug, setSlug] = useState(existingProfile?.slug || "");
  const [displayName, setDisplayName] = useState(existingProfile?.display_name || existingProfile?.displayName || "");
  const [bio, setBio] = useState(existingProfile?.bio || "");
  const [specialties, setSpecialties] = useState(existingProfile?.specialties || []);
  const [location, setLocation] = useState(existingProfile?.location || "");
  const [newSpecialty, setNewSpecialty] = useState("");

  // UI state
  const [slugStatus, setSlugStatus] = useState(null); // null | "checking" | "available" | "taken" | "invalid"
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null); // null | { success, message }
  const [showPreview, setShowPreview] = useState(false);

  const isEditing = !!existingProfile;

  // Slug validation with debounce
  useEffect(() => {
    if (!slug) {
      setSlugStatus(null);
      return;
    }
    if (!SLUG_REGEX.test(slug)) {
      setSlugStatus("invalid");
      return;
    }
    // If editing and slug hasn't changed, it's still theirs
    if (isEditing && slug === existingProfile?.slug) {
      setSlugStatus("available");
      return;
    }

    setSlugStatus("checking");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/storefront/check-slug?slug=${encodeURIComponent(slug)}`);
        const data = await res.json();
        setSlugStatus(data.available ? "available" : "taken");
      } catch {
        // If check fails, allow submission (server will validate)
        setSlugStatus("available");
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [slug, isEditing, existingProfile?.slug]);

  const handleSlugChange = (e) => {
    const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setSlug(val);
  };

  const addSpecialty = (spec) => {
    const trimmed = spec.trim();
    if (!trimmed || specialties.length >= MAX_SPECIALTIES) return;
    if (!specialties.includes(trimmed)) {
      setSpecialties([...specialties, trimmed]);
    }
    setNewSpecialty("");
  };

  const removeSpecialty = (spec) => {
    setSpecialties(specialties.filter((s) => s !== spec));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!slug || slugStatus === "taken" || slugStatus === "invalid") return;
    if (!displayName.trim()) return;

    setSaving(true);
    setSaveResult(null);

    try {
      const res = await fetch("/api/storefront/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: walletAccount,
          slug: slug.toLowerCase(),
          displayName: displayName.trim(),
          bio: bio.trim(),
          specialties,
          location: location.trim() || null,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setSaveResult({ success: true, message: casualModeActive
          ? "Your store is live! Share it with buyers."
          : "Storefront published successfully." });
      } else {
        setSaveResult({ success: false, message: data.error || "Failed to save. Try again." });
      }
    } catch (err) {
      setSaveResult({ success: false, message: "Network error. Check your connection." });
    } finally {
      setSaving(false);
    }
  };

  const storefrontUrl = slug ? `${window.location.origin}/store/${slug}` : null;

  return (
    <div className="sf-setup">
      <div className="sf-setup__header">
        <Storefront weight="duotone" size={28} style={{ color: "var(--accent-blue)" }} />
        <div>
          <h2 className="sf-setup__title">
            {isEditing ? "Edit My Storefront" : "Setup My Storefront"}
          </h2>
          <p className="sf-setup__subtitle">
            {casualModeActive
              ? "Create your own store page where buyers can browse your fish"
              : "Configure your persistent branded sales presence on Aquacellum"}
          </p>
        </div>
      </div>

      <form className="sf-setup__form" onSubmit={handleSubmit}>
        {/* Slug */}
        <div className="sf-setup__field">
          <label className="sf-setup__label" htmlFor="sf-slug">
            Store URL
            <span className="sf-setup__required">*</span>
          </label>
          <div className="sf-setup__slug-input">
            <span className="sf-setup__slug-prefix">aquadex.fish/store/</span>
            <input
              id="sf-slug"
              type="text"
              value={slug}
              onChange={handleSlugChange}
              placeholder="your-store-name"
              maxLength={32}
              required
              aria-describedby="sf-slug-hint"
              className={`sf-setup__input ${slugStatus === "taken" || slugStatus === "invalid" ? "sf-setup__input--error" : ""} ${slugStatus === "available" ? "sf-setup__input--success" : ""}`}
            />
            <span className="sf-setup__slug-status">
              {slugStatus === "checking" && <SpinnerGap size={16} className="sf-setup__spinner" />}
              {slugStatus === "available" && <Check size={16} weight="bold" style={{ color: "#34d399" }} />}
              {slugStatus === "taken" && <Warning size={16} weight="bold" style={{ color: "#f87171" }} />}
              {slugStatus === "invalid" && <Warning size={16} weight="bold" style={{ color: "#fbbf24" }} />}
            </span>
          </div>
          <span id="sf-slug-hint" className="sf-setup__hint">
            {slugStatus === "taken" && "This slug is already taken. Try another."}
            {slugStatus === "invalid" && "3-32 characters, lowercase letters, numbers, and hyphens only."}
            {slugStatus === "available" && "Available!"}
            {!slugStatus && "Lowercase letters, numbers, and hyphens. 3-32 characters."}
          </span>
        </div>

        {/* Display Name */}
        <div className="sf-setup__field">
          <label className="sf-setup__label" htmlFor="sf-name">
            Display Name
            <span className="sf-setup__required">*</span>
          </label>
          <input
            id="sf-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Coral Kings Aquatics"
            maxLength={60}
            required
            className="sf-setup__input"
          />
        </div>

        {/* Bio */}
        <div className="sf-setup__field">
          <label className="sf-setup__label" htmlFor="sf-bio">
            Bio
            <span className="sf-setup__char-count">{bio.length}/{MAX_BIO}</span>
          </label>
          <textarea
            id="sf-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO))}
            placeholder="Tell buyers about your breeding program, specialties, and shipping practices..."
            rows={3}
            maxLength={MAX_BIO}
            className="sf-setup__textarea"
          />
        </div>

        {/* Location */}
        <div className="sf-setup__field">
          <label className="sf-setup__label" htmlFor="sf-location">
            Location
          </label>
          <input
            id="sf-location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Portland, OR"
            maxLength={60}
            className="sf-setup__input"
          />
          <span className="sf-setup__hint">Helps local buyers find you. City + state is enough.</span>
        </div>

        {/* Specialties */}
        <div className="sf-setup__field">
          <label className="sf-setup__label">
            Specialties
            <span className="sf-setup__char-count">{specialties.length}/{MAX_SPECIALTIES}</span>
          </label>
          <div className="sf-setup__specialties">
            {specialties.map((s) => (
              <span key={s} className="sf-setup__specialty-tag">
                {s}
                <button
                  type="button"
                  onClick={() => removeSpecialty(s)}
                  className="sf-setup__specialty-remove"
                  aria-label={`Remove ${s}`}
                >
                  <X size={10} weight="bold" />
                </button>
              </span>
            ))}
            {specialties.length < MAX_SPECIALTIES && (
              <div className="sf-setup__specialty-add">
                <input
                  type="text"
                  value={newSpecialty}
                  onChange={(e) => setNewSpecialty(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSpecialty(newSpecialty);
                    }
                  }}
                  placeholder="Add specialty..."
                  maxLength={30}
                  className="sf-setup__specialty-input"
                />
                <button
                  type="button"
                  onClick={() => addSpecialty(newSpecialty)}
                  className="sf-setup__specialty-add-btn"
                  disabled={!newSpecialty.trim()}
                >
                  <Plus size={12} weight="bold" />
                </button>
              </div>
            )}
          </div>
          {/* Quick suggestions */}
          <div className="sf-setup__suggestions">
            {SPECIALTY_SUGGESTIONS.filter((s) => !specialties.includes(s)).slice(0, 6).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addSpecialty(s)}
                className="sf-setup__suggestion-chip"
                disabled={specialties.length >= MAX_SPECIALTIES}
              >
                + {s}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="sf-setup__actions">
          <button
            type="submit"
            className="sf-setup__submit"
            disabled={saving || !slug || !displayName.trim() || slugStatus === "taken" || slugStatus === "invalid"}
          >
            {saving ? (
              <><SpinnerGap size={16} className="sf-setup__spinner" /> Saving...</>
            ) : isEditing ? (
              <><Pencil size={16} weight="bold" /> Update Storefront</>
            ) : (
              <><Storefront size={16} weight="bold" /> Publish My Store</>
            )}
          </button>

          {storefrontUrl && slugStatus === "available" && (
            <button
              type="button"
              className="sf-setup__preview-btn"
              onClick={() => window.open(`/store/${slug}`, "_blank")}
            >
              <Eye size={16} weight="bold" /> Preview
            </button>
          )}
        </div>

        {/* Result message */}
        {saveResult && (
          <div className={`sf-setup__result ${saveResult.success ? "sf-setup__result--success" : "sf-setup__result--error"}`}>
            {saveResult.success ? <Check size={16} weight="bold" /> : <Warning size={16} weight="bold" />}
            <span>{saveResult.message}</span>
            {saveResult.success && storefrontUrl && (
              <a
                href={`/store/${slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="sf-setup__result-link"
              >
                <LinkIcon size={14} /> View Store
              </a>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
