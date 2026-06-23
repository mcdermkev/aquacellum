/**
 * BreederHeader.jsx — Storefront profile header component.
 * Renders the banner, avatar, breeder name, tier badge, bio, specialties,
 * and Master Breeder trust badge. Full glassmorphism + responsive.
 */
import React, { useState } from "react";
import { ShieldCheck, Star, MapPin, Trophy, Crown } from "@phosphor-icons/react";

const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs";

// Tier color mapping
const TIER_COLORS = {
  "Shallow": { color: "#94a3b8", bg: "rgba(148, 163, 184, 0.12)", border: "rgba(148, 163, 184, 0.3)" },
  "Coastal": { color: "#38bdf8", bg: "rgba(56, 189, 248, 0.12)", border: "rgba(56, 189, 248, 0.3)" },
  "Pelagic": { color: "#34d399", bg: "rgba(52, 211, 153, 0.12)", border: "rgba(52, 211, 153, 0.3)" },
  "Abyssal": { color: "#a78bfa", bg: "rgba(167, 139, 250, 0.12)", border: "rgba(167, 139, 250, 0.3)" },
  "Hadal": { color: "#fbbf24", bg: "rgba(251, 191, 36, 0.12)", border: "rgba(251, 191, 36, 0.3)" },
  "God-Tier": { color: "#f472b6", bg: "rgba(244, 114, 182, 0.12)", border: "rgba(244, 114, 182, 0.3)" },
};

export function BreederHeader({ profile, stats }) {
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const [avatarLoaded, setAvatarLoaded] = useState(false);

  const bannerUrl = profile.bannerCid ? `${IPFS_GATEWAY}/${profile.bannerCid}` : null;
  const avatarUrl = profile.avatarCid ? `${IPFS_GATEWAY}/${profile.avatarCid}` : null;
  const tierStyle = TIER_COLORS[profile.currentTier] || TIER_COLORS["Shallow"];

  return (
    <header className="sf-header" role="banner" aria-label={`${profile.displayName} storefront header`}>
      {/* Banner */}
      <div className="sf-header__banner">
        {bannerUrl ? (
          <>
            <img
              src={bannerUrl}
              alt=""
              className={`sf-header__banner-img ${bannerLoaded ? "sf-header__banner-img--loaded" : ""}`}
              onLoad={() => setBannerLoaded(true)}
              onError={(e) => { e.target.style.display = "none"; }}
            />
            {!bannerLoaded && <div className="sf-header__banner-shimmer shimmer-placeholder" />}
          </>
        ) : (
          <div className="sf-header__banner-fallback" />
        )}
        <div className="sf-header__banner-overlay" />
      </div>

      {/* Profile row */}
      <div className="sf-header__profile">
        {/* Avatar */}
        <div className="sf-header__avatar-wrap">
          {avatarUrl ? (
            <>
              <img
                src={avatarUrl}
                alt={`${profile.displayName} avatar`}
                className={`sf-header__avatar ${avatarLoaded ? "sf-header__avatar--loaded" : ""}`}
                onLoad={() => setAvatarLoaded(true)}
                onError={(e) => { e.target.style.display = "none"; }}
              />
              {!avatarLoaded && <div className="sf-header__avatar-shimmer shimmer-placeholder" />}
            </>
          ) : (
            <div className="sf-header__avatar-placeholder">
              {profile.displayName?.charAt(0)?.toUpperCase() || "?"}
            </div>
          )}
          {profile.isMasterBreeder && (
            <div className="sf-header__master-crown" aria-label="Master Breeder">
              <Crown weight="fill" size={16} color="#fbbf24" />
            </div>
          )}
        </div>

        {/* Name + Badges */}
        <div className="sf-header__info">
          <div className="sf-header__name-row">
            <h1 className="sf-header__name">{profile.displayName}</h1>
            {profile.isMasterBreeder && (
              <span className="sf-header__trust-badge" aria-label="Master Breeder verified">
                <ShieldCheck weight="fill" size={14} />
                Master Breeder
              </span>
            )}
          </div>

          {/* Tier badge */}
          <span
            className="sf-header__tier-badge"
            style={{ background: tierStyle.bg, borderColor: tierStyle.border, color: tierStyle.color }}
          >
            <Trophy weight="fill" size={12} />
            {profile.currentTier}
          </span>

          {/* Bio */}
          {profile.bio && <p className="sf-header__bio">{profile.bio}</p>}

          {/* Meta row: location + specialties */}
          <div className="sf-header__meta">
            {profile.location && (
              <span className="sf-header__location">
                <MapPin weight="fill" size={13} />
                {profile.location}
              </span>
            )}
            {profile.specialties?.length > 0 && (
              <div className="sf-header__specialties">
                {profile.specialties.map((s) => (
                  <span key={s} className="sf-header__specialty-chip">{s}</span>
                ))}
              </div>
            )}
          </div>

          {/* Rating */}
          {stats.avgRating > 0 && (
            <div className="sf-header__rating">
              <Star weight="fill" size={14} color="#fbbf24" />
              <span className="sf-header__rating-value">{stats.avgRating.toFixed(1)}</span>
              <span className="sf-header__rating-count">({stats.reviewCount} reviews)</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
