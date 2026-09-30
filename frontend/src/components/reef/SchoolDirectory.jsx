/**
 * SchoolDirectory.jsx
 *
 * The Clubs directory (clubs are "schools" in the data model). One grid of
 * Daylight cards: banner or a generated teal header, name, one-line
 * description, real member count, tracked species with their photos, an
 * official badge and join/leave. Search matches names, descriptions and
 * species; the species picker narrows to clubs that track one species.
 */

import React, { useMemo, useState } from "react";
import { MagnifyingGlass, SealCheck, Lock, Users, Plus } from "@phosphor-icons/react";
import { useSchoolDirectory, useMySchools, useJoinSchool, useLeaveSchool, useOfficialSchools } from "../../hooks/useSchools";
import { clubInitials } from "./reefEvents";
import { findSpecies, speciesHref, trackedSpeciesLabel, useSpeciesLookup } from "./reefSpecies";
import "./ReefDaylight.css";

const TYPE_FILTERS = [
  { value: "all", label: "All" },
  { value: "species", label: "Species" },
  { value: "regional", label: "Regional" },
  { value: "breeding", label: "Breeding" },
  { value: "conservation", label: "Conservation" },
  { value: "equipment", label: "Equipment" },
  { value: "open", label: "Open" },
];

const TYPE_LABELS = {
  species: "Species club",
  regional: "Regional club",
  breeding: "Breeding club",
  conservation: "Conservation club",
  equipment: "Equipment club",
  open: "Open club",
  club: "Club",
};

function norm(v) {
  return String(v || "").toLowerCase();
}

function memberLabel(n) {
  const count = Number(n) || 0;
  return `${count} ${count === 1 ? "member" : "members"}`;
}

function bannerVariant(name) {
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 3) + 1;
}

/** Banner photo, or initials on a teal gradient, plus the lead species photo. */
export function ClubBanner({ school, lookup, children, as: Tag = "div" }) {
  const lead = trackedSpeciesLabel(school?.tracked_species?.[0]);
  const leadMatch = school?.tracked_species?.length ? findSpecies(lookup, lead) : null;
  const style = school?.banner_url ? { backgroundImage: `url(${school.banner_url})` } : undefined;
  return (
    <Tag
      className={`reef-club-banner reef-club-banner--${bannerVariant(school?.name)} ${school?.banner_url ? "reef-club-banner--photo" : ""}`}
      style={style}
    >
      {!school?.banner_url && (
        <span className="reef-club-initials" aria-hidden="true">{clubInitials(school?.name)}</span>
      )}
      {leadMatch?.photo && <img className="reef-club-photo" src={leadMatch.photo} alt="" loading="lazy" />}
      {children}
    </Tag>
  );
}

/** Tracked species chips; linked to the species page when the index knows it. */
export function SpeciesChips({ species = [], lookup, limit = 3 }) {
  const list = (Array.isArray(species) ? species : []).map(trackedSpeciesLabel).filter((s) => s.commonName || s.scientificName);
  if (list.length === 0) return null;
  return (
    <>
      {list.slice(0, limit).map((s) => {
        const match = findSpecies(lookup, s);
        const label = s.commonName || match?.name || s.scientificName;
        const key = `${s.scientificName}-${s.commonName}`;
        return match ? (
          <a key={key} className="reef-chip reef-chip--species" href={speciesHref(match.slug)} title={s.scientificName || match.scientificName}>
            {match.photo && <img src={match.photo} alt="" loading="lazy" />}
            {label}
          </a>
        ) : (
          <span key={key} className="reef-chip reef-chip--species" title={s.scientificName}>{label}</span>
        );
      })}
      {list.length > limit && <span className="reef-chip">+{list.length - limit} more</span>}
    </>
  );
}

export function SchoolDirectory({ onSelectSchool, onCreateSchool, signedIn = false, onRequireSignIn }) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("");
  const [pendingId, setPendingId] = useState(null);
  const [errors, setErrors] = useState({});
  const lookup = useSpeciesLookup();

  const { data: mySchoolsResult } = useMySchools();
  const mySchools = mySchoolsResult?.data || [];
  const { data: officialResult } = useOfficialSchools();
  const officialSchools = officialResult?.data || [];

  const { data: directoryData, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useSchoolDirectory({ type: typeFilter });

  const joinSchoolMutation = useJoinSchool();
  const leaveSchoolMutation = useLeaveSchool();

  const roleById = useMemo(() => {
    const m = new Map();
    for (const membership of mySchools) if (membership.school?.id) m.set(membership.school.id, membership.role);
    return m;
  }, [mySchools]);

  // Official clubs are listed in full (the directory is paged), then merged with
  // the directory by id so each club shows once.
  const allSchools = useMemo(() => {
    const byId = new Map();
    const pages = directoryData?.pages?.flatMap((p) => p.data) || [];
    const officials = officialSchools.filter((s) => typeFilter === "all" || s.school_type === typeFilter);
    for (const s of [...pages, ...officials]) if (s?.id && !byId.has(s.id)) byId.set(s.id, s);
    // Official (maintained species) clubs first, then by size, then by name.
    return [...byId.values()].sort(
      (a, b) => Number(!!b.is_official) - Number(!!a.is_official) || (b.member_count || 0) - (a.member_count || 0) || String(a.name).localeCompare(String(b.name))
    );
  }, [directoryData, officialSchools, typeFilter]);

  const speciesOptions = useMemo(() => {
    const seen = new Map();
    for (const s of allSchools) {
      for (const entry of s.tracked_species || []) {
        const { commonName, scientificName } = trackedSpeciesLabel(entry);
        const key = norm(scientificName || commonName);
        if (key && !seen.has(key)) seen.set(key, { key, label: commonName || scientificName });
      }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [allSchools]);

  const q = norm(search.trim());
  const visible = allSchools.filter((s) => {
    const species = (s.tracked_species || []).map(trackedSpeciesLabel);
    if (speciesFilter && !species.some((sp) => norm(sp.scientificName || sp.commonName) === speciesFilter)) return false;
    if (!q) return true;
    return (
      norm(s.name).includes(q) ||
      norm(s.description).includes(q) ||
      species.some((sp) => norm(sp.commonName).includes(q) || norm(sp.scientificName).includes(q))
    );
  });
  const mine = visible.filter((s) => roleById.has(s.id));
  const others = visible.filter((s) => !roleById.has(s.id));
  const filtering = !!q || !!speciesFilter || typeFilter !== "all";

  const runMembership = async (school, action) => {
    if (!signedIn) return onRequireSignIn?.();
    setPendingId(school.id);
    setErrors((e) => ({ ...e, [school.id]: null }));
    try {
      const mutation = action === "join" ? joinSchoolMutation : leaveSchoolMutation;
      const res = await mutation.mutateAsync(school.id);
      if (res?.error) {
        setErrors((e) => ({ ...e, [school.id]: action === "join" ? "Couldn't join this club. Try again." : "Couldn't leave this club. Try again." }));
      }
    } catch {
      setErrors((e) => ({ ...e, [school.id]: "Something went wrong. Try again." }));
    } finally {
      setPendingId(null);
    }
  };

  const renderCard = (school) => (
    <ClubCard
      key={school.id}
      school={school}
      lookup={lookup}
      role={roleById.get(school.id) || null}
      pending={pendingId === school.id}
      error={errors[school.id]}
      onSelect={() => onSelectSchool?.(school)}
      onJoin={() => runMembership(school, "join")}
      onLeave={() => runMembership(school, "leave")}
    />
  );

  return (
    <div className="school-directory">
      <div className="reef-section-head">
        <div>
          <h3 className="reef-section-title">Clubs</h3>
          <p className="reef-section-sub">Clubs bring keepers together around a species, a region or a shared interest.</p>
        </div>
        <button type="button" className="reef-btn reef-btn--soft" onClick={onCreateSchool}>
          <Plus size={16} weight="bold" aria-hidden="true" />
          Start a club
        </button>
      </div>

      <div className="reef-clubs-toolbar">
        <label className="reef-field">
          <span className="reef-field-label">Search clubs</span>
          <span style={{ position: "relative", display: "block" }}>
            <MagnifyingGlass size={18} aria-hidden="true" style={{ position: "absolute", left: "0.9rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
            <input
              type="search"
              className="reef-input"
              style={{ paddingLeft: "2.5rem" }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Club name or species"
            />
          </span>
        </label>
        <label className="reef-field">
          <span className="reef-field-label">Species</span>
          <select className="reef-input" value={speciesFilter} onChange={(e) => setSpeciesFilter(e.target.value)}>
            <option value="">Any species</option>
            {speciesOptions.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="reef-filters" role="group" aria-label="Club type">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className="reef-filter"
            aria-pressed={typeFilter === f.value}
            onClick={() => setTypeFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="reef-club-grid" aria-busy="true" aria-label="Loading clubs">
          {[1, 2, 3].map((i) => (
            <div key={i} className="reef-skeleton" style={{ height: 230 }} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="reef-empty reef-empty--flat">
          <h3 className="reef-empty-title">{filtering ? "No clubs match that" : "No clubs yet"}</h3>
          <p className="reef-empty-lead">
            {filtering
              ? "Try another name or species, or clear the filters."
              : "Start one for the fish you keep and invite other keepers."}
          </p>
          <div className="reef-empty-actions">
            {filtering && (
              <button
                type="button"
                className="reef-btn"
                onClick={() => {
                  setSearch("");
                  setSpeciesFilter("");
                  setTypeFilter("all");
                }}
              >
                Clear filters
              </button>
            )}
            <button type="button" className="reef-btn reef-btn--primary" onClick={onCreateSchool}>Start a club</button>
          </div>
        </div>
      ) : (
        <>
          {mine.length > 0 && (
            <section className="reef-club-section" aria-labelledby="reef-my-clubs">
              <h4 id="reef-my-clubs" className="reef-kicker" style={{ marginBottom: "0.6rem" }}>Your clubs</h4>
              <div className="reef-club-grid">{mine.map(renderCard)}</div>
            </section>
          )}
          <section className="reef-club-section" aria-labelledby="reef-all-clubs">
            <h4 id="reef-all-clubs" className="reef-kicker" style={{ marginBottom: "0.6rem" }}>
              {mine.length > 0 ? "More clubs" : filtering ? `${visible.length} ${visible.length === 1 ? "club" : "clubs"}` : "All clubs"}
            </h4>
            {others.length > 0 ? (
              <div className="reef-club-grid">{others.map(renderCard)}</div>
            ) : (
              <p className="reef-section-sub">You&apos;re in every club that matches.</p>
            )}
          </section>
        </>
      )}

      {hasNextPage && (
        <div style={{ textAlign: "center", marginTop: "0.5rem" }}>
          <button type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="reef-btn">
            {isFetchingNextPage ? "Loading…" : "Load more clubs"}
          </button>
        </div>
      )}
    </div>
  );
}

function ClubCard({ school, lookup, role, pending, error, onSelect, onJoin, onLeave }) {
  const isMember = !!role;
  const hasSpecies = Array.isArray(school.tracked_species) && school.tracked_species.length > 0;
  return (
    <article className="reef-club-card">
      <button type="button" className="reef-club-open" onClick={onSelect}>
        <ClubBanner school={school} lookup={lookup} as="span">
          <span className="reef-club-flags">
            {school.is_official && (
              <span className="reef-badge reef-badge--official">
                <SealCheck size={14} weight="fill" aria-hidden="true" /> Official
              </span>
            )}
            {school.is_invite_only && (
              <span className="reef-badge">
                <Lock size={13} weight="bold" aria-hidden="true" /> Invite only
              </span>
            )}
          </span>
        </ClubBanner>
        <span className="reef-club-body">
          <span className="reef-club-name">{school.name}</span>
          {school.description && <span className="reef-club-desc">{school.description}</span>}
          <span className="reef-club-meta">
            <Users size={15} aria-hidden="true" /> {memberLabel(school.member_count)}
            {TYPE_LABELS[school.school_type] && <> · {TYPE_LABELS[school.school_type]}</>}
          </span>
        </span>
      </button>

      {hasSpecies && (
        <div className="reef-club-species">
          <SpeciesChips species={school.tracked_species} lookup={lookup} limit={2} />
        </div>
      )}

      {error && <p className="reef-club-error" role="alert">{error}</p>}

      <div className="reef-club-foot">
        {isMember ? (
          <>
            <span className="reef-member-tag">{role === "founder" ? "You started this club" : "Joined"}</span>
            {role !== "founder" && (
              <button type="button" className="reef-btn reef-btn--sm reef-btn--ghost" onClick={onLeave} disabled={pending}>
                {pending ? "Leaving…" : "Leave"}
              </button>
            )}
          </>
        ) : school.is_invite_only ? (
          <span className="reef-section-sub" style={{ margin: 0 }}>Join by invite</span>
        ) : (
          <>
            <span />
            <button type="button" className="reef-btn reef-btn--sm reef-btn--primary" onClick={onJoin} disabled={pending}>
              {pending ? "Joining…" : "Join"}
            </button>
          </>
        )}
      </div>
    </article>
  );
}
