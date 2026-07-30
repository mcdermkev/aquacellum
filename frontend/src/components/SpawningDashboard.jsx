import React, { useState, useEffect } from "react";
import { db } from "../db";
import {
  formatCertSerial,
  formatLocalRecordRef,
  spawnStatusLabel,
  spawnStatusTone,
  specimenStatusLabel,
  specimenStatusTone,
} from "../utils/specimenIdentity";

/**
 * SpawningDashboard — Displays three sections under the Spawning tab:
 * 1. Registered Certificates — list of birth certificates (specimens with lineage)
 * 2. Hatchery Insights — stats about spawning activity
 * 3. Spawning Logs — chronological history of spawn events
 */
export function SpawningDashboard({ walletAccount }) {
  const [certificates, setCertificates] = useState([]);
  const [spawns, setSpawns] = useState([]);
  const [growoutData, setGrowoutData] = useState([]);
  const [speciesCatalog, setSpeciesCatalog] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("certificates");

  useEffect(() => {
    if (!walletAccount) return;
    loadDashboardData();
  }, [walletAccount]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);

      const walletLower = walletAccount.toLowerCase();

      // Load specimens (certificates) owned by this wallet.
      // After DB v18 migration, all ownerAddress fields are lowercase EOA.
      let specs = [];
      try {
        specs = await db.specimens.where("ownerAddress").equals(walletLower).toArray();
      } catch (e) {
        console.warn("Failed to load specimens:", e);
      }
      setCertificates(specs);

      // Load spawn records owned by this wallet.
      // ownerAddress is not indexed on spawns, so full-scan with filter.
      let spawnRecords = [];
      try {
        const allSpawns = await db.spawns.toArray();
        spawnRecords = allSpawns.filter(s => s.ownerAddress === walletLower);
      } catch (e) {
        console.warn("Failed to load spawns:", e);
      }
      setSpawns(spawnRecords);

      // Load growout checkpoints
      let growout = [];
      try {
        growout = await db.spawnGrowout.toArray();
      } catch (e) {
        console.warn("Failed to load growout data:", e);
      }
      setGrowoutData(growout);

      // Load species catalog for name resolution
      const catalog = {};
      try {
        const speciesRecords = await db.table("species").toArray();
        for (const sp of speciesRecords) {
          const spId = Number(sp.speciesId || sp.id || sp.specCode);
          if (spId) catalog[spId] = { commonName: sp.commonName || "", scientificName: sp.scientificName || "" };
        }
      } catch (e) {}
      try {
        const manifest = await db.speciesManifest.toArray();
        for (const sp of manifest) {
          const spId = Number(sp.speciesId);
          if (spId && !catalog[spId]) {
            catalog[spId] = { commonName: sp.commonName || "", scientificName: sp.scientificName || "" };
          }
        }
      } catch (e) {}
      setSpeciesCatalog(catalog);
    } catch (err) {
      console.error("SpawningDashboard load error:", err);
    } finally {
      setLoading(false);
    }
  };

  const getSpeciesName = (speciesId) => {
    const entry = speciesCatalog[speciesId];
    return entry?.commonName || entry?.scientificName || `Species #${speciesId}`;
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return "—";
    const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return "";
    const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
    return new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  };

  // ─── Hatchery Insights Calculations ────────────────────────────────────────
  const totalOffspring = spawns.reduce((sum, s) => sum + (s.offspringIds?.length || 0), 0);
  const uniqueSpeciesBred = [...new Set(spawns.map(s => s.speciesId))].length;
  const avgClutchSize = spawns.length > 0 ? (totalOffspring / spawns.length).toFixed(1) : "0";

  // Most recent spawn
  const lastSpawn = spawns.length > 0
    ? spawns.sort((a, b) => (b.timestamp || b.spawnId) - (a.timestamp || a.spawnId))[0]
    : null;

  // Spawn frequency (spawns in last 30 days)
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
  const recentSpawnCount = spawns.filter(s => (s.timestamp || 0) >= thirtyDaysAgo).length;

  // Species breakdown for insights
  const speciesBreakdown = {};
  for (const s of spawns) {
    const name = getSpeciesName(s.speciesId);
    speciesBreakdown[name] = (speciesBreakdown[name] || 0) + 1;
  }
  const topSpecies = Object.entries(speciesBreakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const sections = [
    { id: "certificates", icon: "📜", label: "Certificates" },
    { id: "insights", icon: "📊", label: "Hatchery Insights" },
    { id: "logs", icon: "📋", label: "Spawning Logs" },
  ];

  if (loading) {
    return (
      <div className="glass-card shimmer-placeholder" style={{ height: "300px", borderRadius: "var(--radius-md)" }} />
    );
  }

  return (
    <div style={{ marginBottom: "2rem" }}>
      {/* Section Pills */}
      <div
        style={{
          display: "flex",
          gap: "0.4rem",
          marginBottom: "1.25rem",
          padding: "0.3rem",
          background: "rgba(255, 255, 255, 0.02)",
          border: "1px solid rgba(16, 185, 129, 0.12)",
          borderRadius: "10px",
          width: "fit-content",
        }}
      >
        {sections.map((section) => {
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.45rem 0.85rem",
                border: "none",
                borderRadius: "7px",
                cursor: "pointer",
                fontSize: "0.8rem",
                fontWeight: isActive ? "600" : "400",
                color: isActive ? "#fff" : "var(--text-muted)",
                background: isActive
                  ? "linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(5, 150, 105, 0.2) 100%)"
                  : "transparent",
                boxShadow: isActive ? "0 0 10px rgba(16, 185, 129, 0.15)" : "none",
                transition: "all 0.2s ease",
              }}
              aria-current={isActive ? "true" : undefined}
            >
              <span>{section.icon}</span>
              <span>{section.label}</span>
            </button>
          );
        })}
      </div>

      {/* ─── REGISTERED CERTIFICATES ──────────────────────────────────────── */}
      {activeSection === "certificates" && (
        <div className="glass-card" style={{ padding: "1.5rem" }}>
          <h3 style={{ fontSize: "1.2rem", color: "#fff", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            📜 Registered Birth Certificates
          </h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1.25rem" }}>
            All specimens registered under your wallet with lineage information.
          </p>

          {certificates.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--text-muted)" }}>
              <span style={{ fontSize: "2rem", display: "block", marginBottom: "0.75rem" }}>🥚</span>
              <p style={{ fontSize: "0.85rem" }}>No certificates registered yet.</p>
              <p style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>Use the Spawning Wizard below to breed your first pair!</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", maxHeight: "400px", overflowY: "auto" }}>
              {certificates
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                .map((cert) => (
                  <div
                    key={cert.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0.75rem 1rem",
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: "8px",
                      transition: "border-color 0.2s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <span style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: "32px", height: "32px", borderRadius: "50%",
                        background: "linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(124, 58, 237, 0.15))",
                        fontSize: "0.9rem"
                      }}>
                        🐟
                      </span>
                      <div>
                        <div style={{ color: "#fff", fontSize: "0.85rem", fontWeight: "500" }}>
                          Cert. Serial No. {formatCertSerial(cert.id)}
                        </div>
                        <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", marginTop: "2px" }}>
                          {getSpeciesName(cert.speciesId)}
                          {cert.sireId ? ` · Sire: #${formatCertSerial(cert.sireId)}` : ""}
                          {cert.damId ? ` · Dam: #${formatCertSerial(cert.damId)}` : ""}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>
                        {formatDate(cert.createdAt)}
                      </div>
                      <div style={{
                        fontSize: "0.65rem",
                        marginTop: "2px",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: specimenStatusTone(cert.status).bg,
                        color: specimenStatusTone(cert.status).color,
                      }}>
                        {specimenStatusLabel(cert.status)}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}

          <div style={{ marginTop: "1rem", padding: "0.6rem 0.8rem", background: "rgba(16, 185, 129, 0.05)", borderRadius: "6px", border: "1px solid rgba(16, 185, 129, 0.1)" }}>
            <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
              Total Certificates: <strong style={{ color: "#fff" }}>{certificates.length}</strong>
            </span>
          </div>
        </div>
      )}

      {/* ─── HATCHERY INSIGHTS ────────────────────────────────────────────── */}
      {activeSection === "insights" && (
        <div className="glass-card" style={{ padding: "1.5rem" }}>
          <h3 style={{ fontSize: "1.2rem", color: "#fff", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            📊 Hatchery Insights
          </h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1.25rem" }}>
            Overview of your breeding performance and hatchery statistics.
          </p>

          {/* Stats Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
            <InsightCard label="Total Spawns" value={spawns.length} icon="🥚" color="168, 85, 247" />
            <InsightCard label="Total Offspring" value={totalOffspring} icon="🐟" color="16, 185, 129" />
            <InsightCard label="Avg Clutch Size" value={avgClutchSize} icon="📐" color="59, 130, 246" />
            <InsightCard label="Species Bred" value={uniqueSpeciesBred} icon="🧬" color="251, 191, 36" />
            <InsightCard label="Last 30 Days" value={recentSpawnCount} icon="📅" color="244, 63, 94" />
            <InsightCard label="Certificates" value={certificates.length} icon="📜" color="139, 92, 246" />
          </div>

          {/* Top Species */}
          {topSpecies.length > 0 && (
            <div style={{ marginTop: "0.5rem" }}>
              <h4 style={{ color: "var(--text-secondary)", fontSize: "0.8rem", marginBottom: "0.6rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Most Bred Species
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {topSpecies.map(([name, count], i) => (
                  <div key={name} style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <span style={{ color: "var(--text-muted)", fontSize: "0.7rem", width: "16px" }}>#{i + 1}</span>
                    <div style={{ flex: 1, height: "6px", background: "rgba(255,255,255,0.05)", borderRadius: "3px", overflow: "hidden" }}>
                      <div style={{
                        height: "100%",
                        width: `${(count / topSpecies[0][1]) * 100}%`,
                        background: "linear-gradient(90deg, rgba(16, 185, 129, 0.6), rgba(5, 150, 105, 0.4))",
                        borderRadius: "3px",
                        transition: "width 0.5s ease"
                      }} />
                    </div>
                    <span style={{ color: "#fff", fontSize: "0.75rem", minWidth: "100px" }}>{name}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>{count} spawn{count !== 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Last Spawn Info */}
          {lastSpawn && (
            <div style={{ marginTop: "1.25rem", padding: "0.75rem 1rem", background: "rgba(168, 85, 247, 0.05)", border: "1px solid rgba(168, 85, 247, 0.12)", borderRadius: "8px" }}>
              <div style={{ color: "var(--text-muted)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.3rem" }}>Last Spawn Event</div>
              <div style={{ color: "#fff", fontSize: "0.85rem" }}>
                {getSpeciesName(lastSpawn.speciesId)} — Sire #{formatCertSerial(lastSpawn.sireId)} × Dam #{formatCertSerial(lastSpawn.damId)}
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", marginTop: "0.2rem" }}>
                {formatDate(lastSpawn.timestamp)} at {formatTime(lastSpawn.timestamp)} · {lastSpawn.offspringIds?.length || 0} offspring
              </div>
            </div>
          )}

          {spawns.length === 0 && (
            <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--text-muted)" }}>
              <span style={{ fontSize: "2rem", display: "block", marginBottom: "0.75rem" }}>📊</span>
              <p style={{ fontSize: "0.85rem" }}>No breeding data yet.</p>
              <p style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>Complete your first spawn to see hatchery insights!</p>
            </div>
          )}
        </div>
      )}

      {/* ─── SPAWNING LOGS ────────────────────────────────────────────────── */}
      {activeSection === "logs" && (
        <div className="glass-card" style={{ padding: "1.5rem" }}>
          <h3 style={{ fontSize: "1.2rem", color: "#fff", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            📋 Spawning Logs
          </h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1.25rem" }}>
            Chronological record of all breeding events in your facility.
          </p>

          {spawns.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--text-muted)" }}>
              <span style={{ fontSize: "2rem", display: "block", marginBottom: "0.75rem" }}>📋</span>
              <p style={{ fontSize: "0.85rem" }}>No spawning events recorded.</p>
              <p style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>Each time you breed a pair, a log entry will appear here.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "450px", overflowY: "auto" }}>
              {[...spawns]
                .sort((a, b) => (b.timestamp || b.spawnId) - (a.timestamp || a.spawnId))
                .map((spawn) => {
                  const statusTone = spawnStatusTone(spawn.status);
                  return (
                    <div
                      key={spawn.spawnId}
                      style={{
                        padding: "0.85rem 1rem",
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        borderRadius: "8px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ color: "#fff", fontSize: "0.85rem", fontWeight: "500" }}>
                            Spawn #{formatLocalRecordRef(spawn.spawnId)}
                          </div>
                          <div style={{ color: "var(--text-muted)", fontSize: "0.72rem", marginTop: "3px" }}>
                            {getSpeciesName(spawn.speciesId)}
                          </div>
                        </div>
                        <div style={{
                          fontSize: "0.65rem",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          background: statusTone.bg,
                          color: statusTone.color,
                          fontWeight: "500"
                        }}>
                          {spawnStatusLabel(spawn.status)}
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", marginTop: "0.6rem" }}>
                        <div>
                          <div style={{ color: "var(--text-muted)", fontSize: "0.65rem" }}>Sire</div>
                          <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>#{formatCertSerial(spawn.sireId)}</div>
                        </div>
                        <div>
                          <div style={{ color: "var(--text-muted)", fontSize: "0.65rem" }}>Dam</div>
                          <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>#{formatCertSerial(spawn.damId)}</div>
                        </div>
                        <div>
                          <div style={{ color: "var(--text-muted)", fontSize: "0.65rem" }}>Offspring</div>
                          <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>{spawn.offspringIds?.length || 0} fry</div>
                        </div>
                      </div>

                      <div style={{ marginTop: "0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "var(--text-muted)", fontSize: "0.68rem" }}>
                          Tank #{formatLocalRecordRef(spawn.tankId)}
                        </span>
                        <span style={{ color: "var(--text-muted)", fontSize: "0.68rem" }}>
                          {formatDate(spawn.timestamp)} {formatTime(spawn.timestamp)}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {spawns.length > 0 && (
            <div style={{ marginTop: "1rem", padding: "0.6rem 0.8rem", background: "rgba(59, 130, 246, 0.05)", borderRadius: "6px", border: "1px solid rgba(59, 130, 246, 0.1)", display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
                Total Events: <strong style={{ color: "#fff" }}>{spawns.length}</strong>
              </span>
              <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
                Total Fry Produced: <strong style={{ color: "#fff" }}>{totalOffspring}</strong>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Small stat card used in Hatchery Insights */
function InsightCard({ label, value, icon, color }) {
  return (
    <div style={{
      padding: "0.85rem",
      background: `rgba(${color}, 0.04)`,
      border: `1px solid rgba(${color}, 0.12)`,
      borderRadius: "8px",
      textAlign: "center",
    }}>
      <div style={{ fontSize: "1.2rem", marginBottom: "0.3rem" }}>{icon}</div>
      <div style={{ color: "#fff", fontSize: "1.1rem", fontWeight: "600" }}>{value}</div>
      <div style={{ color: "var(--text-muted)", fontSize: "0.68rem", marginTop: "0.15rem" }}>{label}</div>
    </div>
  );
}
