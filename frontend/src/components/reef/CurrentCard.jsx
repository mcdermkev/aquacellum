/**
 * CurrentCard.jsx
 *
 * One Reef post (a "Current"), Daylight card: photo first, then the author,
 * the words, tank and species tags (species link to their public page),
 * reactions and comments. Styles live in ReefDaylight.css.
 */

import React, { useState } from "react";
import { FishSimple } from "@phosphor-icons/react";
import { ReactionBar } from "./ReactionBar";
import { CommentThread } from "./CommentThread";
import { FollowButton } from "./FollowButton";
import { ExpertAuditForm } from "./ExpertAuditForm";
import { useUnlockGate } from "./UnlockPrompt";
import { findSpecies, speciesHref, useSpeciesLookup } from "./reefSpecies";
import { watchTank, unwatchTank, isWatchingTank } from "../../services/reefApi";
import { getCurrentWallet } from "../../services/supabaseClient";
import { sameWallet } from "../../utils/wallet";
import { useAuth } from "../../contexts/AuthContext";
import { useUnitPrefs } from "../../hooks/useUnitPrefs";
import { formatTemperature } from "../../utils/units";
import { VideoPlayer } from "../video/VideoPlayer";
import { VideoThumbnail } from "../video/VideoThumbnail";
import "./ReefDaylight.css";

/**
 * Format relative time (e.g., "2h ago", "3d ago")
 */
function timeAgo(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function truncateWallet(wallet) {
  if (!wallet) return "A keeper";
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function initialsFor(name) {
  const words = String(name || "").replace(/^0x/i, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

/** Photo grid: 1 = full width, 2 = side by side, 3-4 = grid. */
function PhotoGrid({ urls, altTexts }) {
  if (!urls || urls.length === 0) return null;
  const count = Math.min(urls.length, 4);
  return (
    <div className={`reef-post-media reef-post-media--${count}`}>
      {urls.slice(0, 4).map((url, i) => (
        <div key={i} className="reef-post-photo">
          <img src={url} alt={altTexts?.[i] || `Tank photo ${i + 1}`} loading="lazy" />
        </div>
      ))}
    </div>
  );
}

/** Water test snapshot chips. */
function ParameterChips({ snapshot }) {
  const { tempUnit } = useUnitPrefs();
  if (!snapshot) return null;

  const chips = [];
  if (snapshot.temp) chips.push(`Temp ${formatTemperature(snapshot.temp, tempUnit)}`);
  if (snapshot.ph) chips.push(`pH ${snapshot.ph}`);
  if (snapshot.nitrate) chips.push(`Nitrate ${snapshot.nitrate} ppm`);
  if (snapshot.ammonia) chips.push(`Ammonia ${snapshot.ammonia} ppm`);
  if (chips.length === 0) return null;

  return (
    <div className="reef-tags" aria-label="Water test">
      {chips.map((label) => (
        <span key={label} className="reef-chip reef-chip--param">{label}</span>
      ))}
    </div>
  );
}

function SpeciesTag({ tag, lookup }) {
  const match = findSpecies(lookup, { commonName: tag });
  if (!match) return <span className="reef-chip reef-chip--species">{tag}</span>;
  return (
    <a className="reef-chip reef-chip--species" href={speciesHref(match.slug)} title={`${match.name} (${match.scientificName})`}>
      {match.photo && <img src={match.photo} alt="" loading="lazy" />}
      {tag}
    </a>
  );
}

export function CurrentCard({ current, onProfileClick, casualModeActive = false }) {
  const [showFullBody, setShowFullBody] = useState(false);
  const [watching, setWatching] = useState(null); // null = unknown, true/false
  const [showAuditForm, setShowAuditForm] = useState(false);
  const auditGate = useUnlockGate("canGiveAudits");
  const lookup = useSpeciesLookup();
  const profile = current.profiles;
  const body = current.body || "";
  const isLong = body.length > 300;
  const displayBody = isLong && !showFullBody ? body.slice(0, 300) + "…" : body;
  const { account } = useAuth();
  const currentWallet = account || getCurrentWallet();
  const isOwnPost = sameWallet(current.author_wallet, currentWallet);
  const authorName = profile?.display_name || truncateWallet(profile?.wallet_address || current.author_wallet);
  const tankName = (current.linked_tank_name || "").trim();

  // Check watch status on mount for posts with linked tanks
  React.useEffect(() => {
    if (!currentWallet || !current.linked_tank_id || !current.author_wallet || isOwnPost) return;
    isWatchingTank(current.author_wallet, current.linked_tank_id).then(setWatching);
  }, [currentWallet, current.linked_tank_id, current.author_wallet, isOwnPost]);

  const handleToggleWatch = async () => {
    if (!current.linked_tank_id || !current.author_wallet) return;
    if (watching) {
      await unwatchTank(current.author_wallet, current.linked_tank_id);
      setWatching(false);
    } else {
      await watchTank(current.author_wallet, current.linked_tank_id);
      setWatching(true);
    }
  };

  return (
    <article className="reef-post" aria-label={`Post by ${authorName}`}>
      {/* Photo first */}
      <PhotoGrid urls={current.media_urls} altTexts={current.media_alt_texts} />

      {current.video_playback_id && current.video_status === "ready" && (
        <div className="reef-post-video">
          <VideoPlayer
            playbackId={current.video_playback_id}
            thumbnailUrl={current.video_thumbnail_url}
            duration={current.video_duration_seconds}
            altText={current.video_alt_text}
          />
        </div>
      )}
      {current.video_status && current.video_status !== "ready" && !current.video_playback_id && (
        <VideoThumbnail
          thumbnailUrl={current.video_thumbnail_url}
          duration={current.video_duration_seconds}
          status={current.video_status}
        />
      )}

      <div className="reef-post-body">
        <div className="reef-post-head">
          <button type="button" className="reef-author" onClick={() => onProfileClick?.(current.author_wallet)}>
            <span className="reef-avatar" aria-hidden="true">
              {profile?.avatar_url ? <img src={profile.avatar_url} alt="" loading="lazy" /> : initialsFor(authorName)}
            </span>
            <span className="reef-author-text">
              <span className="reef-author-name">{authorName}</span>
              <span className="reef-author-meta">
                <time dateTime={current.created_at}>{timeAgo(current.created_at)}</time>
              </span>
            </span>
          </button>
          {!isOwnPost && <FollowButton targetWallet={current.author_wallet} compact />}
        </div>

        {body && (
          <div>
            <p className="reef-post-text">{displayBody}</p>
            {isLong && (
              <button type="button" className="reef-link reef-post-more" onClick={() => setShowFullBody(!showFullBody)}>
                {showFullBody ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}

        <ParameterChips snapshot={current.parameters_snapshot} />

        {(tankName || current.species_tags?.length > 0) && (
          <div className="reef-tags">
            {tankName && (
              <span className="reef-chip">
                <FishSimple size={15} aria-hidden="true" />
                <span className="reef-sr-only">Tank: </span>
                {tankName}
              </span>
            )}
            {(current.species_tags || []).map((tag, i) => (
              <SpeciesTag key={`${tag}-${i}`} tag={tag} lookup={lookup} />
            ))}
          </div>
        )}

        <div className="reef-post-foot">
          <ReactionBar currentId={current.id} />
          <div className="reef-post-tools">
            {current.linked_tank_id && !isOwnPost && currentWallet && (
              <button
                type="button"
                className="reef-btn reef-btn--sm reef-btn--ghost"
                onClick={() => {
                  if (auditGate.checkAccess()) setShowAuditForm(true);
                }}
                title={casualModeActive ? "Give this tank a review" : "Submit an expert audit"}
              >
                {casualModeActive ? "Review tank" : "Audit"}
              </button>
            )}
            {current.linked_tank_id && !isOwnPost && currentWallet && watching !== null && (
              <button
                type="button"
                className="reef-btn reef-btn--sm reef-btn--ghost"
                onClick={handleToggleWatch}
                aria-pressed={!!watching}
                title={watching ? "Stop watching this tank" : "Get this tank's updates in your feed"}
              >
                {watching ? "Watching tank" : "Watch tank"}
              </button>
            )}
          </div>
        </div>

        <CommentThread currentId={current.id} />
      </div>

      {showAuditForm && (
        <ExpertAuditForm
          recipientWallet={current.author_wallet}
          targetCurrentId={current.id}
          targetTankId={current.linked_tank_id}
          casualModeActive={casualModeActive}
          onClose={() => setShowAuditForm(false)}
          onSubmitted={() => setShowAuditForm(false)}
        />
      )}
    </article>
  );
}
