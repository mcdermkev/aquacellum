/**
 * SchoolDirectory.jsx
 * 
 * Browse all schools: grid of cards, filter by type, search by name.
 * "My Schools" section at top.
 */

import React, { useState } from "react";
import { useSchoolDirectory, useMySchools, useJoinSchool } from "../../hooks/useSchools";
import { ProfileCard } from "./ProfileCard";

const TYPE_FILTERS = [
  { value: "all", label: "All" },
  { value: "species", label: "🐟 Species" },
  { value: "regional", label: "🌍 Regional" },
  { value: "breeding", label: "🧬 Breeding" },
  { value: "conservation", label: "🌿 Conservation" },
  { value: "equipment", label: "⚙️ Equipment" },
  { value: "open", label: "🌊 Open" },
];

const TYPE_EMOJI = {
  species: "🐟",
  regional: "🌍",
  breeding: "🧬",
  conservation: "🌿",
  equipment: "⚙️",
  open: "🌊",
};

export function SchoolDirectory({ onSelectSchool, onCreateSchool }) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data: mySchoolsResult } = useMySchools();
  const mySchools = mySchoolsResult?.data || [];

  const {
    data: directoryData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useSchoolDirectory({ type: typeFilter, search: search || undefined });

  const joinSchoolMutation = useJoinSchool();

  const allSchools = directoryData?.pages?.flatMap((p) => p.data) || [];

  // Filter out schools the user is already a member of from directory
  const mySchoolIds = new Set(mySchools.map((m) => m.school?.id));

  const handleJoin = async (schoolId) => {
    await joinSchoolMutation.mutateAsync(schoolId);
  };

  return (
    <div className="school-directory" style={{ maxWidth: "800px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.2rem", color: "#fff" }}>
          🏫 Schools
        </h2>
        <button
          onClick={onCreateSchool}
          className="btn-primary"
          style={{ padding: "0.5rem 1rem", fontSize: "0.8rem" }}
        >
          + Create School
        </button>
      </div>

      {/* My Schools */}
      {mySchools.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <h3 style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.75rem", fontWeight: "600" }}>
            My Schools
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem" }}>
            {mySchools.map((membership) => {
              const school = membership.school;
              if (!school) return null;
              return (
                <button
                  key={school.id}
                  onClick={() => onSelectSchool?.(school)}
                  className="glass-card"
                  style={{
                    padding: "0.75rem",
                    border: "1px solid rgba(56, 189, 248, 0.2)",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    textAlign: "left",
                    background: "rgba(56, 189, 248, 0.04)",
                    transition: "all 0.2s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "1.2rem" }}>{TYPE_EMOJI[school.school_type] || "🏫"}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "0.8rem", fontWeight: "600", color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {school.name}
                      </div>
                      <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                        {school.member_count} member{school.member_count !== 1 ? "s" : ""} · {membership.role}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Search + Filter */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search schools..."
          style={{
            flex: "1 1 200px",
            padding: "0.6rem 1rem",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "var(--radius-sm)",
            color: "#fff",
            fontSize: "0.85rem",
          }}
        />
      </div>

      {/* Type Filter Chips */}
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setTypeFilter(f.value)}
            style={{
              padding: "0.35rem 0.75rem",
              borderRadius: "50px",
              border: `1px solid ${typeFilter === f.value ? "rgba(56, 189, 248, 0.4)" : "rgba(255,255,255,0.1)"}`,
              background: typeFilter === f.value ? "rgba(56, 189, 248, 0.12)" : "rgba(255,255,255,0.03)",
              color: typeFilter === f.value ? "#fff" : "var(--text-secondary)",
              fontSize: "0.7rem",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* School Grid */}
      {isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card" style={{ padding: "1rem", height: "140px", borderRadius: "var(--radius-sm)" }}>
              <div style={{ height: "20px", background: "rgba(255,255,255,0.05)", borderRadius: "4px", marginBottom: "0.5rem" }} />
              <div style={{ height: "14px", width: "60%", background: "rgba(255,255,255,0.03)", borderRadius: "4px" }} />
            </div>
          ))}
        </div>
      ) : allSchools.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: "3rem 1rem",
          color: "var(--text-muted)",
          fontSize: "0.85rem",
        }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>🏫</div>
          <p>No schools found. Be the first to create one!</p>
          <button onClick={onCreateSchool} className="btn-primary" style={{ marginTop: "0.75rem", padding: "0.5rem 1.25rem", fontSize: "0.8rem" }}>
            + Create School
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {allSchools.map((school) => (
            <SchoolCard
              key={school.id}
              school={school}
              isMember={mySchoolIds.has(school.id)}
              onSelect={() => onSelectSchool?.(school)}
              onJoin={() => handleJoin(school.id)}
              isJoining={joinSchoolMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Load More */}
      {hasNextPage && (
        <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="btn-secondary"
            style={{ padding: "0.5rem 1.5rem", fontSize: "0.8rem" }}
          >
            {isFetchingNextPage ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </div>
  );
}

function SchoolCard({ school, isMember, onSelect, onJoin, isJoining }) {
  return (
    <div
      className="glass-card school-card"
      style={{
        padding: "0",
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.08)",
        cursor: "pointer",
        transition: "all 0.2s ease",
      }}
      onClick={onSelect}
    >
      {/* Banner */}
      <div style={{
        height: "80px",
        background: school.banner_url
          ? `url(${school.banner_url}) center/cover`
          : `linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(168, 85, 247, 0.2) 100%)`,
        position: "relative",
      }}>
        <span style={{
          position: "absolute",
          top: "0.5rem",
          left: "0.5rem",
          background: "rgba(0,0,0,0.6)",
          padding: "0.2rem 0.5rem",
          borderRadius: "50px",
          fontSize: "0.65rem",
          color: "#fff",
        }}>
          {TYPE_EMOJI[school.school_type]} {school.school_type}
        </span>
        {school.is_invite_only && (
          <span style={{
            position: "absolute",
            top: "0.5rem",
            right: "0.5rem",
            background: "rgba(0,0,0,0.6)",
            padding: "0.2rem 0.5rem",
            borderRadius: "50px",
            fontSize: "0.6rem",
            color: "var(--text-muted)",
          }}>
            🔒 Invite Only
          </span>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: "0.75rem 1rem" }}>
        <h4 style={{ margin: "0 0 0.3rem", fontSize: "0.9rem", color: "#fff", fontWeight: "600" }}>
          {school.name}
        </h4>
        {school.description && (
          <p style={{
            margin: "0 0 0.5rem",
            fontSize: "0.7rem",
            color: "var(--text-muted)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}>
            {school.description}
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
            👥 {school.member_count} member{school.member_count !== 1 ? "s" : ""}
          </span>
          {!isMember && !school.is_invite_only && (
            <button
              onClick={(e) => { e.stopPropagation(); onJoin(); }}
              disabled={isJoining}
              className="btn-primary"
              style={{ padding: "0.3rem 0.7rem", fontSize: "0.65rem" }}
            >
              Join
            </button>
          )}
          {isMember && (
            <span style={{ fontSize: "0.65rem", color: "var(--accent-green)" }}>✓ Member</span>
          )}
        </div>
      </div>
    </div>
  );
}
