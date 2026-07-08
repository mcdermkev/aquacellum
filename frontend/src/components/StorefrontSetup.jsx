/**
 * StorefrontSetup.jsx — "Setup My Store" panel for breeders.
 *
 * Allows beta testers (and eventually earned Master Breeders) to create
 * or edit their storefront profile: slug, display name, bio, specialties,
 * location, and avatar. Writes to Supabase via /api/storefront-detail?action=setup endpoint.
 *
 * Gated by beta allowlist in the parent (App.jsx passes `isEligible` prop).
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
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
  ImageSquare,
  UploadSimple,
  Trash,
  Truck,
  FirstAid,
  Handshake,
  UserCircle,
  Bank,
} from "@phosphor-icons/react";
import { uploadImage, createPreviewUrl, revokePreviewUrl } from "../services/mediaUpload";
import { getProfile } from "../services/reefApi";
import { startSellerOnboarding, checkSellerStatus } from "../services/stripePayments";
import { SellerAnalytics } from "./storefront/SellerAnalytics";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const MAX_BIO = 280;
const MAX_SPECIALTIES = 5;
const MAX_POLICY = 1500;

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

  // Branding: banner (uploadable) + avatar (pulled from the app profile)
  const [bannerUrl, setBannerUrl] = useState(existingProfile?.bannerUrl || existingProfile?.banner_url || "");
  const [bannerPreview, setBannerPreview] = useState(existingProfile?.bannerUrl || existingProfile?.banner_url || null);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [bannerError, setBannerError] = useState(null);
  const bannerInputRef = useRef(null);

  const [appAvatarUrl, setAppAvatarUrl] = useState(
    existingProfile?.avatarUrl || existingProfile?.avatar_url || null
  );

  // Store policies
  const [shippingPolicy, setShippingPolicy] = useState(existingProfile?.policies?.shipping || "");
  const [doaPolicy, setDoaPolicy] = useState(existingProfile?.policies?.doa || "");
  const [handshakePolicy, setHandshakePolicy] = useState(existingProfile?.policies?.handshake || "");

  // UI state
  const [slugStatus, setSlugStatus] = useState(null); // null | "checking" | "available" | "taken" | "invalid"
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null); // null | { success, message }
  const [showPreview, setShowPreview] = useState(false);

  // Stripe payouts (Connect) state
  const [payoutStatus, setPayoutStatus] = useState(null); // { connected, onboardingComplete }
  const [payoutLoading, setPayoutLoading] = useState(true);
  const [connectingPayouts, setConnectingPayouts] = useState(false);

  const isEditing = !!existingProfile;

  // Pull the breeder's avatar from their existing in-app profile so the
  // storefront stays visually consistent with the rest of Aquacellum.
  // We don't ask them to upload a second one — it mirrors profiles.avatar_url.
  useEffect(() => {
    if (!walletAccount) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await getProfile(walletAccount);
        if (!cancelled && data?.avatar_url) {
          setAppAvatarUrl(data.avatar_url);
        }
      } catch {
        // Best-effort — fall back to whatever the storefront already had.
      }
    })();
    return () => { cancelled = true; };
  }, [walletAccount]);

  // Clean up any object URL preview on unmount
  useEffect(() => {
    return () => {
      if (bannerPreview && bannerPreview.startsWith("blob:")) revokePreviewUrl(bannerPreview);
    };
  }, [bannerPreview]);

  // Load Stripe Connect payout status so the seller knows if they can be paid.
  useEffect(() => {
    if (!walletAccount) return;
    let cancelled = false;
    (async () => {
      setPayoutLoading(true);
      try {
        const status = await checkSellerStatus(walletAccount);
        if (!cancelled) setPayoutStatus(status);
      } catch {
        if (!cancelled) setPayoutStatus({ connected: false, onboardingComplete: false });
      } finally {
        if (!cancelled) setPayoutLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [walletAccount]);

  // Start (or resume) Stripe Connect onboarding — redirects to Stripe's hosted flow.
  const handleConnectPayouts = async () => {
    if (!walletAccount) return;
    setConnectingPayouts(true);
    try {
      const res = await startSellerOnboarding({
        walletAddress: walletAccount,
        displayName: displayName || undefined,
      });
      if (res.success && res.onboardingUrl) {
        window.location.href = res.onboardingUrl;
      } else {
        setSaveResult({ success: false, message: res.error || "Could not start Stripe onboarding." });
      }
    } catch (e) {
      setSaveResult({ success: false, message: e.message || "Stripe onboarding failed." });
    } finally {
      setConnectingPayouts(false);
    }
  };

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
        const res = await fetch(`/api/storefront-detail?action=check-slug&slug=${encodeURIComponent(slug)}`);
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

  const handleBannerSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBannerError(null);

    // Immediate local preview while the upload runs
    if (bannerPreview && bannerPreview.startsWith("blob:")) revokePreviewUrl(bannerPreview);
    const localPreview = createPreviewUrl(file);
    setBannerPreview(localPreview);
    setBannerUploading(true);

    try {
      const { url, error } = await uploadImage(file);
      if (error || !url) {
        setBannerError(error || "Upload failed. Try again.");
        setBannerPreview(bannerUrl || null);
      } else {
        setBannerUrl(url);
        setBannerPreview(url);
      }
    } catch (err) {
      setBannerError(err.message || "Upload failed. Try again.");
      setBannerPreview(bannerUrl || null);
    } finally {
      setBannerUploading(false);
      if (localPreview.startsWith("blob:")) revokePreviewUrl(localPreview);
    }
  };

  const removeBanner = () => {
    if (bannerPreview && bannerPreview.startsWith("blob:")) revokePreviewUrl(bannerPreview);
    setBannerUrl("");
    setBannerPreview(null);
    setBannerError(null);
    if (bannerInputRef.current) bannerInputRef.current.value = "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!slug || slugStatus === "taken" || slugStatus === "invalid") return;
    if (!displayName.trim()) return;

    setSaving(true);
    setSaveResult(null);

    try {
      const res = await fetch("/api/storefront-detail?action=setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: walletAccount,
          slug: slug.toLowerCase(),
          displayName: displayName.trim(),
          bio: bio.trim(),
          specialties,
          location: location.trim() || null,
          avatarUrl: appAvatarUrl || null,
          bannerUrl: bannerUrl || null,
          shippingPolicy: shippingPolicy.trim() || null,
          doaPolicy: doaPolicy.trim() || null,
          handshakePolicy: handshakePolicy.trim() || null,
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
        {/* Branding: banner + avatar */}
        <div className="sf-setup__field">
          <label className="sf-setup__label">Store Banner</label>
          <div className="sf-setup__banner-editor">
            <div
              className={`sf-setup__banner-drop ${bannerPreview ? "sf-setup__banner-drop--has-image" : ""}`}
              onClick={() => !bannerUploading && bannerInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !bannerUploading) {
                  e.preventDefault();
                  bannerInputRef.current?.click();
                }
              }}
              aria-label="Upload store banner image"
            >
              {bannerPreview ? (
                <img src={bannerPreview} alt="Store banner preview" className="sf-setup__banner-img" />
              ) : (
                <div className="sf-setup__banner-empty">
                  <ImageSquare weight="duotone" size={26} />
                  <span>Add a banner or background</span>
                  <small>Wide image works best — 1500×500</small>
                </div>
              )}

              {bannerUploading && (
                <div className="sf-setup__banner-overlay">
                  <SpinnerGap size={22} className="sf-setup__spinner" />
                  <span>Uploading…</span>
                </div>
              )}

              {/* Avatar preview, pulled from the app profile, floating on the banner */}
              <div className="sf-setup__avatar-float" title="Pulled from your app profile">
                {appAvatarUrl ? (
                  <img src={appAvatarUrl} alt="Your avatar" className="sf-setup__avatar-img" />
                ) : (
                  <div className="sf-setup__avatar-placeholder">
                    {displayName?.charAt(0)?.toUpperCase() || <UserCircle weight="duotone" size={28} />}
                  </div>
                )}
              </div>
            </div>

            <div className="sf-setup__banner-actions">
              <button
                type="button"
                className="sf-setup__banner-btn"
                onClick={() => bannerInputRef.current?.click()}
                disabled={bannerUploading}
              >
                <UploadSimple size={14} weight="bold" />
                {bannerPreview ? "Replace banner" : "Upload banner"}
              </button>
              {bannerPreview && (
                <button
                  type="button"
                  className="sf-setup__banner-btn sf-setup__banner-btn--danger"
                  onClick={removeBanner}
                  disabled={bannerUploading}
                >
                  <Trash size={14} weight="bold" /> Remove
                </button>
              )}
            </div>
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleBannerSelect}
              style={{ display: "none" }}
            />
          </div>
          <span className="sf-setup__hint">
            {bannerError ? (
              <span style={{ color: "#f87171" }}>{bannerError}</span>
            ) : (
              <>Your avatar is pulled automatically from your app profile.</>
            )}
          </span>
        </div>

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

        {/* Store Policies */}
        <div className="sf-setup__policies">
          <div className="sf-setup__policies-head">
            <h3 className="sf-setup__policies-title">Store Policies</h3>
            <p className="sf-setup__policies-sub">
              Set buyer expectations up front. These show on your public storefront.
            </p>
          </div>

          <div className="sf-setup__field">
            <label className="sf-setup__label" htmlFor="sf-shipping">
              <Truck size={15} weight="duotone" style={{ color: "var(--accent-blue)" }} />
              Shipping Policy
              <span className="sf-setup__char-count">{shippingPolicy.length}/{MAX_POLICY}</span>
            </label>
            <textarea
              id="sf-shipping"
              value={shippingPolicy}
              onChange={(e) => setShippingPolicy(e.target.value.slice(0, MAX_POLICY))}
              placeholder="How you ship (carrier, ship days, heat/cold packs), live-arrival guarantee, and who covers shipping costs."
              rows={3}
              maxLength={MAX_POLICY}
              className="sf-setup__textarea"
            />
          </div>

          <div className="sf-setup__field">
            <label className="sf-setup__label" htmlFor="sf-doa">
              <FirstAid size={15} weight="duotone" style={{ color: "#f87171" }} />
              Dead-on-Arrival (DOA) Policy
              <span className="sf-setup__char-count">{doaPolicy.length}/{MAX_POLICY}</span>
            </label>
            <textarea
              id="sf-doa"
              value={doaPolicy}
              onChange={(e) => setDoaPolicy(e.target.value.slice(0, MAX_POLICY))}
              placeholder="Your DOA guarantee — claim window (e.g. photos within 2 hours of delivery), what's covered, and how refunds or replacements work."
              rows={3}
              maxLength={MAX_POLICY}
              className="sf-setup__textarea"
            />
          </div>

          <div className="sf-setup__field">
            <label className="sf-setup__label" htmlFor="sf-handshake">
              <Handshake size={15} weight="duotone" style={{ color: "var(--accent-green)" }} />
              In-Person / Handshake Rules
              <span className="sf-setup__char-count">{handshakePolicy.length}/{MAX_POLICY}</span>
            </label>
            <textarea
              id="sf-handshake"
              value={handshakePolicy}
              onChange={(e) => setHandshakePolicy(e.target.value.slice(0, MAX_POLICY))}
              placeholder="Local pickup / meetup rules — accepted payment, where you meet, bag/acclimation guidance, and any local-only terms."
              rows={3}
              maxLength={MAX_POLICY}
              className="sf-setup__textarea"
            />
          </div>
        </div>

        {/* Payouts — Stripe Connect */}
        <div className="sf-setup__field" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "1rem", marginTop: "0.5rem" }}>
          <label className="sf-setup__label">
            <Bank size={15} weight="duotone" style={{ color: "var(--accent-green)" }} />
            Payouts
          </label>
          <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", margin: "0 0 0.75rem 0", lineHeight: 1.5 }}>
            Buyers pay in USD at checkout. Connect a Stripe account to receive your payouts — you keep 96% of each sale (the platform fee is 4%), and the buyer covers card processing. Funds for shipped and local-pickup orders are held in escrow until the buyer confirms handoff.
          </p>
          {payoutLoading ? (
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <SpinnerGap size={14} className="sf-setup__spinner" /> Checking payout status…
            </div>
          ) : payoutStatus?.onboardingComplete ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", color: "var(--accent-green)" }}>
              <Check size={16} weight="bold" /> Payouts active — you're ready to sell.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "flex-start" }}>
              {payoutStatus?.connected && (
                <span style={{ fontSize: "0.78rem", color: "var(--accent-amber, #fbbf24)", display: "flex", gap: "0.4rem", alignItems: "center" }}>
                  <Warning size={14} weight="bold" /> Stripe setup started but not finished.
                </span>
              )}
              <button
                type="button"
                onClick={handleConnectPayouts}
                disabled={connectingPayouts || !walletAccount}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.6rem 1rem", fontSize: "0.85rem", fontWeight: 600,
                  background: "var(--accent-green, #34d399)", color: "#04231a",
                  border: "none", borderRadius: "8px", cursor: connectingPayouts ? "wait" : "pointer",
                  opacity: (!walletAccount || connectingPayouts) ? 0.6 : 1,
                }}
              >
                {connectingPayouts ? (
                  <><SpinnerGap size={16} className="sf-setup__spinner" /> Redirecting to Stripe…</>
                ) : (
                  <><Bank size={16} weight="bold" /> {payoutStatus?.connected ? "Finish Stripe setup" : "Connect payouts with Stripe"}</>
                )}
              </button>
              <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                You'll be redirected to Stripe to securely add your bank details. No card or crypto needed.
              </span>
            </div>
          )}
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

      {/* Premium seller analytics — visible once the store is published */}
      {isEditing && (
        <SellerAnalytics walletAccount={walletAccount} casualModeActive={casualModeActive} />
      )}
    </div>
  );
}
