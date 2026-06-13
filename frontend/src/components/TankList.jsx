import React, { useState, useEffect, useRef } from "react";
import { ethers, Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { FacilityTreeView } from "./FacilityTreeView";
import { getProvider } from "../utils/smartAccount";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { db } from "../db";
import { PoseidonChatConsole } from "./PoseidonChatConsole";
import { mapContractError } from "../utils/errorHandler";
import { TankQRCode } from "./TankQRCode";
import { CompanionFishEntity } from "./CompanionFishEntity";
import { useUserTanks } from "../hooks/useUserTanks";
import { useSpeciesData } from "../hooks/useSpeciesData";
import { useContractSpecies } from "../hooks/useSpeciesData";
import { useQueryClient } from "@tanstack/react-query";
import { relayMoveSpecimen, relayLogWaterParameters, relayMintSpecimen } from "../services/relayer";
import { createCurrent } from "../services/reefApi";
import { isSupabaseConfigured } from "../services/supabaseClient";

const TANK_TYPES = ["Freshwater", "Saltwater", "Brackish", "Pond"];
const CONTAINMENT_TYPES = ["Tank", "Tub", "Basket"];

const getSupabaseImageUrl = (activeTank) => {
  if (!activeTank) return "";
  
  // Dynamic fallback hierarchy:
  // Evaluate activeTank.inhabitants[0].commonName or activeTank.species first.
  // If undefined, fallback cleanly to activeTank.name.
  const targetName = 
    (activeTank.inhabitants && activeTank.inhabitants[0] && activeTank.inhabitants[0].commonName) || 
    activeTank.species || 
    activeTank.name || 
    "";

  const formatted = targetName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `https://oexctbbybpfvslgxlscg.supabase.co/storage/v1/object/public/fish-photos/${formatted}.jpg?width=300&height=300&resize=contain&quality=80`;
};


const isInsideEnvelope = (val, safeMin, safeMax) => {
  return val >= safeMin && val <= safeMax;
};

const getTrackBackground = (minVal, maxVal, safeMin, safeMax) => {
  if (safeMin === undefined || safeMax === undefined) {
    return "rgba(255,255,255,0.1)";
  }
  const pctMin = ((safeMin - minVal) / (maxVal - minVal)) * 100;
  const pctMax = ((safeMax - minVal) / (maxVal - minVal)) * 100;
  return `linear-gradient(to right, rgba(239, 68, 68, 0.45) 0%, rgba(239, 68, 68, 0.45) ${pctMin}%, rgba(34, 197, 94, 0.65) ${pctMin}%, rgba(34, 197, 94, 0.65) ${pctMax}%, rgba(239, 68, 68, 0.45) ${pctMax}%, rgba(239, 68, 68, 0.45) 100%)`;
};

/* ─── ActivityLog ────────────────────────────────────────────── */
const ACTION_COLORS = {
  "Water Change": "#38bdf8",
  "Fed Fish": "#34d399",
  "Cleaned Filter": "#a78bfa",
  "Tested Water": "#fbbf24",
  "Added Fertilizer": "#6ee7b7",
  "Dosed Medication": "#f87171",
};

function ActivityLog({ onChainLogs, actionLogs, casualModeActive }) {
  // Safely extract primitive values from ethers.js Result objects (never spread them)
  const safeOnChain = Array.isArray(onChainLogs) ? onChainLogs : [];
  const safeAction  = Array.isArray(actionLogs)  ? actionLogs  : [];

  const waterItems = safeOnChain.map((l, i) => {
    const ts        = Number(l.timestamp || 0) * 1000;
    const tempRaw   = l.tempCelsiusX10 !== undefined ? Number(l.tempCelsiusX10) : (l.temp !== undefined ? Number(l.temp) : 0);
    const phRaw     = l.phX10          !== undefined ? Number(l.phX10)          : (l.ph   !== undefined ? Number(l.ph)   : 0);
    const notesStr  = typeof l.notes === "string" ? l.notes : "";
    return { _type: "water", _ts: ts, _id: i, tempRaw, phRaw, notesStr };
  });

  const actionItems = safeAction.map((l, i) => ({
    _type:      "action",
    _ts:        Number(l.timestamp || 0) * 1000,
    _id:        i,
    actionType: typeof l.actionType === "string" ? l.actionType : "Care Log",
    details:    typeof l.details    === "string" ? l.details    : "",
  }));

  const merged = [...waterItems, ...actionItems].sort((a, b) => b._ts - a._ts);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "280px", overflowY: "auto" }}>
      <strong style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
        {casualModeActive ? "Activity Log" : "Environmental Logs History"}
      </strong>
      {merged.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "2rem", textAlign: "center" }}>
          No activity logged yet. Use Quick Actions to log care tasks!
        </p>
      ) : merged.map((log) =>
        log._type === "action" ? (
          <div key={`a-${log._id}`} style={{
            padding: "0.65rem 0.85rem",
            background: "rgba(56,189,248,0.04)",
            border: `1px solid ${(ACTION_COLORS[log.actionType] || "#38bdf8")}33`,
            borderLeft: `3px solid ${ACTION_COLORS[log.actionType] || "#38bdf8"}`,
            borderRadius: "8px",
            fontSize: "0.8rem",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.2rem" }}>
              <strong style={{ color: ACTION_COLORS[log.actionType] || "#38bdf8" }}>{log.actionType}</strong>
              <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{new Date(log._ts).toLocaleString()}</span>
            </div>
            {log.details ? <span style={{ color: "var(--text-secondary)" }}>{log.details}</span> : null}
          </div>
        ) : (
          <div key={`w-${log._id}`} style={{
            padding: "0.65rem 0.85rem",
            background: "rgba(255,255,255,0.01)",
            border: "1px solid var(--glass-border)",
            borderLeft: "3px solid var(--accent-green)",
            borderRadius: "8px",
            fontSize: "0.75rem",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.2rem" }}>
              <strong style={{ color: "var(--accent-green)" }}>💧 Water Parameters</strong>
              <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{new Date(log._ts).toLocaleString()}</span>
            </div>
            <span style={{ color: "var(--accent-blue)" }}>
              Temp: {(log.tempRaw / 10).toFixed(1)}°C ({((log.tempRaw / 10) * 9 / 5 + 32).toFixed(1)}°F) | pH: {(log.phRaw / 10).toFixed(1)}
            </span>
            {log.notesStr ? <p style={{ color: "var(--text-secondary)", marginTop: "0.25rem", margin: 0 }}>"{log.notesStr}"</p> : null}
          </div>
        )
      )}
    </div>
  );
}
/* ──────────────────────────────────────────────────────────── */


/* ─── NotesTab ──────────────────────────────────────────────── */
function NotesTab({ tankId }) {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [dbReady, setDbReady] = useState(true);

  const loadNotes = async () => {
    try {
      const rows = await db.tankNotes.where("tankId").equals(tankId).toArray();
      setNotes(rows.sort((a, b) => b.createdAt - a.createdAt));
    } catch (e) {
      console.warn("tankNotes not ready:", e);
      setDbReady(false);
      setNotes([]);
    }
  };

  useEffect(() => { loadNotes(); }, [tankId]);

  const saveNote = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await db.tankNotes.add({ tankId, text: draft.trim(), createdAt: Date.now() });
      setDraft("");
      await loadNotes();
    } catch (e) {
      console.warn("Failed to save note:", e);
    } finally {
      setSaving(false);
    }
  };

  const deleteNote = async (id) => {
    try {
      await db.tankNotes.delete(id);
      await loadNotes();
    } catch (e) {
      console.warn("Failed to delete note:", e);
    }
  };

  if (!dbReady) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
        📝 Notes are upgrading… Please refresh the page once.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "1rem" }}>📝</span>
        <strong style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Tank Notes</strong>
      </div>

      {/* Compose area */}
      <div style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--glass-border)",
        borderRadius: "10px",
        padding: "0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Write a note about water changes, feeding, observations..."
          rows={3}
          style={{
            width: "100%",
            background: "rgba(0,0,0,0.25)",
            border: "1px solid var(--glass-border)",
            borderRadius: "6px",
            color: "#fff",
            fontSize: "0.8rem",
            padding: "0.6rem 0.75rem",
            resize: "vertical",
            outline: "none",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
          onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveNote(); }}
        />
        <button
          onClick={saveNote}
          disabled={saving || !draft.trim()}
          style={{
            alignSelf: "flex-end",
            padding: "0.4rem 1.1rem",
            background: draft.trim() ? "linear-gradient(135deg,#38bdf8,#6366f1)" : "rgba(255,255,255,0.08)",
            border: "none",
            borderRadius: "6px",
            color: draft.trim() ? "#fff" : "var(--text-muted)",
            fontWeight: "600",
            fontSize: "0.78rem",
            cursor: draft.trim() ? "pointer" : "not-allowed",
            transition: "all 0.2s",
          }}
        >
          {saving ? "Saving…" : "Save Note"}
        </button>
      </div>

      {/* Notes list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "220px", overflowY: "auto" }}>
        {notes.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", textAlign: "center", padding: "1.5rem 0" }}>
            No notes yet. Add your first observation above!
          </p>
        ) : notes.map(note => (
          <div key={note.id} style={{
            background: "rgba(56,189,248,0.04)",
            border: "1px solid rgba(56,189,248,0.15)",
            borderRadius: "8px",
            padding: "0.65rem 0.85rem",
            display: "flex",
            gap: "0.5rem",
            alignItems: "flex-start",
          }}>
            <div style={{ flex: 1 }}>
              <p style={{ color: "#fff", fontSize: "0.8rem", margin: 0, lineHeight: 1.5 }}>{note.text}</p>
              <span style={{ color: "var(--text-muted)", fontSize: "0.68rem" }}>
                {new Date(note.createdAt).toLocaleString()}
              </span>
            </div>
            <button
              onClick={() => deleteNote(note.id)}
              title="Delete note"
              style={{
                background: "none",
                border: "none",
                color: "rgba(239,68,68,0.6)",
                cursor: "pointer",
                fontSize: "0.9rem",
                padding: "0.1rem 0.2rem",
                lineHeight: 1,
                flexShrink: 0,
              }}
            >✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TankList({ contractAddress, walletAccount, onViewLineage, onListOnMarketplace, onSelectSpecimen, casualModeActive = false }) {
  const queryClient = useQueryClient();
  const { data: fishbaseData = [] } = useSpeciesData();
  const { data: fetchedTanks = [], isLoading: tanksLoading, error: tanksError, refetch: refetchTanks } = useUserTanks(contractAddress, walletAccount);
  const tanks = fetchedTanks;
  const loading = tanksLoading;
  const error = tanksError ? (tanksError.message || "Failed to fetch tank systems from the secure registry.") : null;

  const [showWelcomeModal, setShowWelcomeModal] = useState(() => {
    const show = localStorage.getItem("aquadex_show_welcome_guidance") === "true";
    if (show) {
      localStorage.removeItem("aquadex_show_welcome_guidance");
    }
    return show;
  });
  const [userAlias, setUserAlias] = useState("");
  const [draggedOverTankId, setDraggedOverTankId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [localActionLogs, setLocalActionLogs] = useState([]);
  const [residingSpecies, setResidingSpecies] = useState([]);

  // Detailed Tank View State (must be declared before fetchLocalActionLogs which references it)
  const [activeTank, setActiveTank] = useState(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const fetchLocalActionLogs = async () => {
    if (activeTank) {
      try {
        const logs = await db.actionLogs.where("tankId").equals(activeTank.id).toArray();
        setLocalActionLogs(logs.reverse());
      } catch (e) {
        console.warn("Failed to fetch local action logs:", e);
      }
    }
  };

  useEffect(() => {
    fetchLocalActionLogs();
  }, [activeTank]);

  useEffect(() => {
    const fetchResidingSpecies = async () => {
      if (!activeTank) return;
      try {
        const tankFromDb = await db.tanks.get(activeTank.id);
        const specs = tankFromDb ? (tankFromDb.specimens || []) : [];
        const unique = [];
        const seen = new Set();
        specs.forEach(s => {
          if (s.speciesId && !seen.has(s.speciesId)) {
            seen.add(s.speciesId);
            unique.push({
              speciesId: s.speciesId,
              commonName: s.commonName,
              scientificName: s.scientificName
            });
          }
        });
        setResidingSpecies(unique);
      } catch (e) {
        console.warn("Failed to fetch residing species from Dexie:", e);
      }
    };
    fetchResidingSpecies();
  }, [activeTank, tanks]);

  const [companionData, setCompanionData] = useState(null);
  const [showBubble, setShowBubble] = useState(false);

  useEffect(() => {
    if (!walletAccount) return;
    const fetchCompanion = async () => {
      const data = await db.breederCompanion.get(walletAccount);
      setCompanionData(data || null);
    };
    fetchCompanion();

    db.userProfile.get(walletAccount).then((profile) => {
      if (profile && profile.alias) {
        setUserAlias(profile.alias);
      }
    }).catch(() => {});

    const handleXpAdded = async () => {
      fetchCompanion();
      await fetchDashboardData();
    };

    window.addEventListener("aquadex_xp_added", handleXpAdded);
    return () => {
      window.removeEventListener("aquadex_xp_added", handleXpAdded);
    };
  }, [walletAccount]);

  // Mock population counts for Update Count action
  const [mockPopulationCounts, setMockPopulationCounts] = useState({});

  const getSpecimenCount = (tank) => {
    if (!tank) return 0;
    return mockPopulationCounts[tank.id] !== undefined ? mockPopulationCounts[tank.id] : tank.specimens.length;
  };

  // Layout View Modes: "list" | "tree"
  const [viewMode, setViewMode] = useState("list");
  const [openRegisterOnTreeMount, setOpenRegisterOnTreeMount] = useState(false);

  // Filter & Search states
  const [selectedLocation, setSelectedLocation] = useState("All");
  const [locationsFilterOpen, setLocationsFilterOpen] = useState(false);

  // Reset selected location when switching back to casual mode
  useEffect(() => {
    if (casualModeActive) {
      setSelectedLocation("All");
      setLocationsFilterOpen(false);
      setViewMode("list");
    }
  }, [casualModeActive]);

  // Scanner Simulator State
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState("");

  // Quick Log Drawer State
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [quickLogTankId, setQuickLogTankId] = useState("");

  // Add Fish Drawer State (inline, no navigation)
  const [addFishOpen, setAddFishOpen] = useState(false);
  const [addFishTankId, setAddFishTankId] = useState(null);
  const [addFishSpeciesId, setAddFishSpeciesId] = useState("");
  const [addFishSearch, setAddFishSearch] = useState("");
  const [addFishSubmitting, setAddFishSubmitting] = useState(false);
  const [addFishError, setAddFishError] = useState(null);
  const [addFishQty, setAddFishQty] = useState(1);
  const [addFishGender, setAddFishGender] = useState("Not Sure");
  const { data: contractSpecies = [] } = useContractSpecies(contractAddress);
  const [poseidonChatOpen, setPoseidonChatOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const photoInputRef = useRef(null);
  const [uploadingSpecimenId, setUploadingSpecimenId] = useState(null);
  const specimenPhotoInputRef = useRef(null);
  const [farewellSpecimen, setFarewellSpecimen] = useState(null);
  const [activeMenuSpecimenId, setActiveMenuSpecimenId] = useState(null);

  // Bulk / Rack-Level Logging State (Phase 1)
  const [bulkLogScope, setBulkLogScope] = useState("single"); // "single" | "rack" | "room"
  const [bulkLogAction, setBulkLogAction] = useState("feed");  // "feed" | "water_change" | "treatment" | "observation"
  const [bulkLogDetail, setBulkLogDetail] = useState("");
  const [bulkLogSubmitting, setBulkLogSubmitting] = useState(false);
  const [bulkLogResult, setBulkLogResult] = useState(null); // { count, action } after submit

  // Saved action templates stored in localStorage
  const [savedTemplates, setSavedTemplates] = useState(() => {
    try {
      const raw = localStorage.getItem("aquadex_action_templates");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [templateName, setTemplateName] = useState("");
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  const persistTemplates = (updated) => {
    setSavedTemplates(updated);
    try { localStorage.setItem("aquadex_action_templates", JSON.stringify(updated)); } catch {}
  };

  const saveTemplate = () => {
    if (!templateName.trim() || !bulkLogDetail.trim()) return;
    const t = { name: templateName.trim(), action: bulkLogAction, detail: bulkLogDetail.trim() };
    persistTemplates([...savedTemplates.filter(x => x.name !== t.name), t]);
    setTemplateName("");
    setShowSaveTemplate(false);
    showToast("✅ Template saved!");
  };

  const deleteTemplate = (name) => {
    persistTemplates(savedTemplates.filter(x => x.name !== name));
  };

  // Derive unique racks and rooms from the loaded tanks list for the bulk scope selectors
  const uniqueRacks = [...new Set(tanks.map(t => t.rack).filter(Boolean))];
  const uniqueRooms = [...new Set(tanks.map(t => t.room).filter(Boolean))];

  // Which tanks are targeted by the current bulk scope selection
  const getBulkTargetTanks = () => {
    if (bulkLogScope === "single") {
      const t = tanks.find(x => x.id === Number(quickLogTankId));
      return t ? [t] : [];
    }
    if (bulkLogScope === "rack") {
      const selectedRack = bulkRackTarget || uniqueRacks[0];
      return tanks.filter(t => t.rack === selectedRack);
    }
    if (bulkLogScope === "room") {
      const selectedRoom = bulkRoomTarget || uniqueRooms[0];
      return tanks.filter(t => t.room === selectedRoom);
    }
    return [];
  };

  const [bulkRackTarget, setBulkRackTarget] = useState("");
  const [bulkRoomTarget, setBulkRoomTarget] = useState("");

  const BULK_ACTION_LABELS = {
    feed:         { emoji: "🥣", label: "Feeding",        defaultDetail: "Routine feeding (standard diet)" },
    water_change: { emoji: "💧", label: "Water Change",   defaultDetail: "Partial water change performed" },
    treatment:    { emoji: "💊", label: "Treatment",      defaultDetail: "Medication / treatment applied" },
    observation:  { emoji: "📋", label: "Observation",    defaultDetail: "Routine visual inspection" },
  };

  const handleBulkLogSubmit = async () => {
    const targets = getBulkTargetTanks();
    if (targets.length === 0) return;
    setBulkLogSubmitting(true);
    setBulkLogResult(null);
    const detail = bulkLogDetail.trim() || BULK_ACTION_LABELS[bulkLogAction].defaultDetail;
    const ts = Math.round(Date.now() / 1000);
    try {
      for (const tank of targets) {
        await db.actionLogs.add({
          tankId: tank.id,
          actionType: BULK_ACTION_LABELS[bulkLogAction].label,
          timestamp: ts,
          details: detail
        });
      }
      addXp(targets.length * 3, `Bulk ${BULK_ACTION_LABELS[bulkLogAction].label}`);
      setBulkLogResult({ count: targets.length, action: BULK_ACTION_LABELS[bulkLogAction].label });
      setBulkLogDetail("");
      fetchLocalActionLogs();
      await fetchDashboardData();
      showToast(`${BULK_ACTION_LABELS[bulkLogAction].emoji} ${BULK_ACTION_LABELS[bulkLogAction].label} logged for ${targets.length} unit${targets.length !== 1 ? "s" : ""}`);
    } catch (err) {
      console.error("Bulk log failed:", err);
      showToast("❌ Bulk log failed. Please try again.");
    } finally {
      setBulkLogSubmitting(false);
    }
  };

  // Inline Detail Input State (replaces browser prompt() for mobile UX)
  const [inlineDetailOpen, setInlineDetailOpen] = useState(false);
  const [inlineDetailType, setInlineDetailType] = useState(""); // "feed" | "algae" | "population"
  const [inlineDetailText, setInlineDetailText] = useState("");
  const inlineDetailRef = useRef(null);

  // Pro Mode quick log population states
  const [proPopAction, setProPopAction] = useState("add"); // "add" | "remove"
  const [proPopSpeciesId, setProPopSpeciesId] = useState("");
  const [proPopGender, setProPopGender] = useState("Not Sure");
  const [proPopQty, setProPopQty] = useState(1);
  const [proPopSubmitting, setProPopSubmitting] = useState(false);

  // Quick Win 7: Escape key closes overlays
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") {
        if (addFishOpen) { setAddFishOpen(false); return; }
        if (quickLogOpen) { setQuickLogOpen(false); return; }
        if (inlineDetailOpen) { setInlineDetailOpen(false); setInlineDetailText(""); return; }
        if (activeTank) { setActiveTank(null); return; }
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [quickLogOpen, inlineDetailOpen, activeTank, addFishOpen]);

  // Detailed Tank View State
  const [detailSubTab, setDetailSubTab] = useState("overview"); // "overview" | "fish" | "history" | "notes"
  const [commentText, setCommentText] = useState("");
  const [commenterRole, setCommenterRole] = useState("hobbyist");
  const [composerCategory, setComposerCategory] = useState("observation"); // "observation" | "telemetry" | "spawning" | "lab-audit"
  const [broadcastToReef, setBroadcastToReef] = useState(false);
  const [spawnClutchSize, setSpawnClutchSize] = useState("");
  const [spawnStage, setSpawnStage] = useState("Eggs");
  const commentInputRef = useRef(null);

  useEffect(() => {
    if (detailSubTab === "social") {
      const isHatched = companionData && companionData.eggState >= 2;
      setCommenterRole(casualModeActive || !isHatched ? "hobbyist" : "breeder");
      setComposerCategory("observation");
    }
  }, [detailSubTab, casualModeActive, companionData]);
  const [tankComments, setTankComments] = useState(() => {
    const cached = localStorage.getItem("aquadex_tank_comments");
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {}
    }
    return {
      "1": [
        {
          author: "0x9965503B1a0594001a1c367f032d93F642f64180",
          role: "master-breeder",
          text: "Excellent water parameter consistency! Temp matches scientific requirements. Recommend feeding live Daphnia to optimize spawning yield.",
          timestamp: Math.floor(Date.now() / 1000) - 7200,
          isExpertAudit: true
        },
        {
          author: "0x3C44CdDdB6a9400e238b4c2b93f140bb3f0512AF",
          role: "hobbyist",
          text: "Nice setup! What kind of filter are you using for this volume?",
          timestamp: Math.floor(Date.now() / 1000) - 14400,
          isExpertAudit: false
        }
      ]
    };
  });

  useEffect(() => {
    localStorage.setItem("aquadex_tank_comments", JSON.stringify(tankComments));
  }, [tankComments]);

  // Long Press Hook Implementation
  const useLongPress = (onLongPress, onClick, { delay = 500 } = {}) => {
    const [timer, setTimer] = useState(null);
    const [isLongPress, setIsLongPress] = useState(false);

    const start = (e) => {
      e.preventDefault();
      setIsLongPress(false);
      const id = setTimeout(() => {
        setIsLongPress(true);
        onLongPress(e);
      }, delay);
      setTimer(id);
    };

    const stop = (e) => {
      e.preventDefault();
      clearTimeout(timer);
      if (!isLongPress) {
        onClick(e);
      }
    };

    const cancel = () => {
      clearTimeout(timer);
    };

    return {
      onMouseDown: start,
      onMouseUp: stop,
      onMouseLeave: cancel,
      onTouchStart: start,
      onTouchEnd: stop
    };
  };

  const openAddFish = (tank) => {
    setAddFishTankId(tank.id);
    setAddFishSpeciesId("");
    setAddFishSearch("");
    setAddFishQty(1);
    setAddFishGender("Not Sure");
    setAddFishError(null);
    setAddFishOpen(true);
  };

  const handleAddFishSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!addFishSpeciesId) {
      setAddFishError("Please select a species first.");
      return;
    }
    setAddFishSubmitting(true);
    setAddFishError(null);
    try {
      const species = contractSpecies.find(s => String(s.speciesId) === String(addFishSpeciesId)) || {};
      const count = Number(addFishQty) || 1;

      for (let i = 0; i < count; i++) {
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        const result = await relayMintSpecimen({
          speciesId: Number(addFishSpeciesId),
          birthTimestamp: 0,
          breeder: walletAccount,
          currentTankId: Number(addFishTankId),
          ownerAddress: walletAccount,
          commonName: species.commonName || "Specimen",
          scientificName: species.scientificName || "Unknown",
          gender: addFishGender,
        });
        if (!result.success) throw new Error(result.error || "Failed to add fish");

        if (i === 0) {
          // Notify onboarding tour / listeners
          window.dispatchEvent(new CustomEvent("aquadex:specimen_added", { detail: { tokenId: result.specimenId } }));
        }
      }

      addXp(XP_ACTIONS.MINT_SPECIMEN?.points * count, XP_ACTIONS.MINT_SPECIMEN?.label);
      showToast(casualModeActive
        ? `🐟 ${count > 1 ? `${count} ` : ""}${species.commonName || "Fish"} added to your tank!`
        : `✅ ${count} birth certificate${count > 1 ? "s" : ""} registered for ${species.commonName || "specimen"}`
      );

      setAddFishOpen(false);
      await fetchDashboardData();

      // Refresh the active tank view
      const fresh = await refetchTanks();
      const updated = fresh.data?.find(t => t.id === Number(addFishTankId));
      if (updated) setActiveTank(updated);
    } catch (err) {
      console.error("Add fish failed:", err);
      setAddFishError(mapContractError(err, casualModeActive));
    } finally {
      setAddFishSubmitting(false);
    }
  };

  const handleMoveSpecimen = async (specimenId, targetTankId) => {
    try {
      showToast(`🔄 Rehoming specimen #${specimenId} to tank #${targetTankId}...`);

      // Beta: move locally via relayer (no MetaMask, no gas)
      const result = await relayMoveSpecimen({ specimenId, targetTankId });
      if (!result.success) {
        throw new Error(result.error || "Move failed");
      }

      addXp(10, "Specimen Rehomed");
      showToast(`✅ Specimen #${specimenId} moved successfully!`);
      await fetchDashboardData();

      // Refresh active tank
      if (activeTank) {
        setTimeout(async () => {
          const fresh = await refetchTanks();
          const updated = fresh.data?.find(t => t.id === activeTank.id);
          if (updated) setActiveTank(updated);
        }, 500);
      }
    } catch (err) {
      console.error(err);
      showToast(`❌ ${mapContractError(err, casualModeActive)}`);
    }
  };

  const logFeedClick = async () => {
    await db.actionLogs.add({
      tankId: activeTank.id,
      actionType: "Feed",
      timestamp: Math.round(Date.now() / 1000),
      details: "Routine Feeding (Standard Diet)"
    });
    addXp(2, "Logged Tank Feeding");
    showToast(casualModeActive
      ? "🥣 Yum! Your fish are loving it! +10 Loyalty Points!"
      : "🥣 Feeding logged"
    );
    fetchLocalActionLogs();
    await fetchDashboardData();
  };

  const logFeedLongPress = async () => {
    setInlineDetailType("feed");
    setInlineDetailText("Fed frozen brine shrimp");
    setInlineDetailOpen(true);
    setTimeout(() => inlineDetailRef.current?.focus(), 100);
  };

  const logAlgaeClick = async () => {
    await db.actionLogs.add({
      tankId: activeTank.id,
      actionType: "Scraped Algae",
      timestamp: Math.round(Date.now() / 1000),
      details: "Routine Algae Scraped"
    });
    addXp(2, "Logged Algae Scraping");
    showToast(casualModeActive
      ? "🧹 Sparkly clean! Your tank is gleaming! +10 Loyalty Points!"
      : "🧹 Maintenance logged"
    );
    fetchLocalActionLogs();
    await fetchDashboardData();
  };

  const logAlgaeLongPress = async () => {
    setInlineDetailType("algae");
    setInlineDetailText("Scraped green spot algae & wiped glass");
    setInlineDetailOpen(true);
    setTimeout(() => inlineDetailRef.current?.focus(), 100);
  };

  const handleInlineDetailSubmit = async () => {
    if (!inlineDetailText.trim()) {
      setInlineDetailOpen(false);
      return;
    }
    const details = inlineDetailText.trim();
    if (inlineDetailType === "feed") {
      await db.actionLogs.add({
        tankId: activeTank.id,
        actionType: "Feed",
        timestamp: Math.round(Date.now() / 1000),
        details: details
      });
      addXp(3, "Logged Custom Feeding");
      showToast(casualModeActive
        ? "🥣 Custom meal logged — great care! +10 Loyalty Points!"
        : "🥣 Custom feeding logged"
      );
    } else if (inlineDetailType === "algae") {
      await db.actionLogs.add({
        tankId: activeTank.id,
        actionType: "Scraped Algae",
        timestamp: Math.round(Date.now() / 1000),
        details: details
      });
      addXp(3, "Logged Custom Algae Scraping");
      showToast(casualModeActive
        ? "🧹 Custom clean logged — looking great! +10 Loyalty Points!"
        : "🧹 Custom maintenance logged"
      );
    } else if (inlineDetailType === "population") {
      const newCount = parseInt(details, 10);
      if (!isNaN(newCount) && newCount >= 0) {
        setMockPopulationCounts(prev => ({
          ...prev,
          [activeTank.id]: newCount
        }));
        setActiveTank(prev => ({
          ...prev,
          specimens: new Array(newCount).fill(null).map((_, idx) => prev.specimens[idx] || {
            id: 9999 + idx,
            speciesId: prev.specimens[0]?.speciesId || 1,
            commonName: prev.specimens[0]?.commonName || "Mock Specimen",
            scientificName: prev.specimens[0]?.scientificName || "Mockus specimenus",
            status: 0
          })
        }));
        showToast(`✅ Population count updated to ${newCount}`);
      } else {
        showToast("⚠️ Please enter a valid number");
      }
    }
    setInlineDetailOpen(false);
    setInlineDetailText("");
    fetchLocalActionLogs();
    await fetchDashboardData();
  };

  const handleProPopAddSubmit = async () => {
    if (!proPopSpeciesId) {
      showToast("⚠️ Please select a species");
      return;
    }
    setProPopSubmitting(true);
    try {
      const species = contractSpecies.find(s => String(s.speciesId) === String(proPopSpeciesId)) || {};
      const count = Number(proPopQty) || 1;

      for (let i = 0; i < count; i++) {
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        const result = await relayMintSpecimen({
          speciesId: Number(proPopSpeciesId),
          birthTimestamp: 0,
          breeder: walletAccount,
          currentTankId: Number(activeTank.id),
          ownerAddress: walletAccount,
          commonName: species.commonName || "Specimen",
          scientificName: species.scientificName || "Unknown",
          gender: proPopGender,
        });
        if (!result.success) throw new Error(result.error || "Failed to add fish");

        if (i === 0) {
          window.dispatchEvent(new CustomEvent("aquadex:specimen_added", { detail: { tokenId: result.specimenId } }));
        }
      }

      addXp(XP_ACTIONS.MINT_SPECIMEN?.points * count, XP_ACTIONS.MINT_SPECIMEN?.label);
      showToast(`✅ ${count} birth certificate${count > 1 ? "s" : ""} registered for ${species.commonName || "specimen"}`);

      setInlineDetailOpen(false);
      await fetchDashboardData();

      // Refresh the active tank view
      const fresh = await refetchTanks();
      const updated = fresh.data?.find(t => t.id === Number(activeTank.id));
      if (updated) setActiveTank(updated);
    } catch (err) {
      console.error("Pro population add failed:", err);
      showToast(`❌ Add failed: ${err.message || err}`);
    } finally {
      setProPopSubmitting(false);
    }
  };


  const logTestClick = async () => {
    await db.actionLogs.add({
      tankId: activeTank.id,
      actionType: "Quick Water Test",
      timestamp: Math.round(Date.now() / 1000),
      details: "Baseline Water Test (Temp: 24.5°C, pH: 7.2, Salinity: 1.020)"
    });
    addXp(2, "Logged Baseline Water Test");
    showToast(casualModeActive
      ? "🧪 Water looks perfect — great job! +15 Loyalty Points!"
      : "🧪 Water test recorded"
    );
    fetchLocalActionLogs();
    await fetchDashboardData();
  };

  const logTestLongPress = () => {
    setFormData({
      temp: activeTank.latestLog ? (activeTank.latestLog.tempCelsiusX10/10).toString() : "24.5",
      ph: activeTank.latestLog ? (activeTank.latestLog.phX10/10).toString() : "7.2",
      salinity: activeTank.latestLog ? (activeTank.latestLog.salinitySgX10000/10000).toString() : "1.0000",
      ammonia: "0.0",
      nitrite: "0.0",
      nitrate: "5.0",
      notes: ""
    });
    setQuickLogTankId(activeTank.id.toString());
    setQuickLogOpen(true);
  };

  const feedEvents = useLongPress(logFeedLongPress, logFeedClick);
  const algaeEvents = useLongPress(logAlgaeLongPress, logAlgaeClick);
  const testEvents = useLongPress(logTestLongPress, logTestClick);

  const handleCommentSubmit = (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;

    const tankId = activeTank.id;
    const author = walletAccount || "0x0000000000000000000000000000000000000000";
    let role = commenterRole;

    // Normalize to current breeder tier if posted as a Breeder in Pro Mode
    if (!casualModeActive && role === "breeder") {
      const userTier = companionData?.currentTier || "Bronze";
      const normalizedTier = userTier.toLowerCase().replace("-tier", "");
      role = `${normalizedTier}-breeder`;
    }

    const text = commentText.trim();
    const isExpertAudit = (role === "master-breeder" || composerCategory === "lab-audit") && text.length >= 60;

    if (isExpertAudit) {
      addXp(25, "Mentor XP (Expert Comment)");
      addXp(50, "Prestige XP (Received Expert Audit)");
    } else {
      addXp(5, "Posted Tank Observation Comment");
    }

    const safeLogs = Array.isArray(activeTank.logs) ? activeTank.logs : [];
    let tempVal = "24.5°C";
    let phVal = "7.2 pH";
    if (safeLogs.length > 0) {
      const lastLog = [...safeLogs].sort((a,b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0];
      const tempRaw = lastLog.tempCelsiusX10 !== undefined ? Number(lastLog.tempCelsiusX10) : (lastLog.temp !== undefined ? Number(lastLog.temp) : 245);
      const phRaw = lastLog.phX10 !== undefined ? Number(lastLog.phX10) : (lastLog.ph !== undefined ? Number(lastLog.ph) : 72);
      tempVal = `${(tempRaw / 10).toFixed(1)}°C`;
      phVal = `${(phRaw / 10).toFixed(1)} pH`;
    }
    const specCount = getSpecimenCount(activeTank);

    const newComment = {
      author,
      role,
      text,
      timestamp: Math.floor(Date.now() / 1000),
      isExpertAudit,
      category: composerCategory,
      telemetry: composerCategory === "telemetry" ? {
        temp: tempVal,
        ph: phVal,
        specimens: specCount
      } : null,
      spawning: composerCategory === "spawning" ? {
        clutchSize: spawnClutchSize || "N/A",
        stage: spawnStage
      } : null
    };

    setTankComments(prev => ({
      ...prev,
      [tankId]: [...(prev[tankId] || []), newComment]
    }));

    // Broadcast to the Reef if toggled
    if (broadcastToReef) {
      if (isSupabaseConfigured()) {
        let snap = null;
        if (safeLogs.length > 0) {
          const lastLog = [...safeLogs].sort((a,b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0];
          const tempRaw = lastLog.tempCelsiusX10 !== undefined ? Number(lastLog.tempCelsiusX10) : (lastLog.temp !== undefined ? Number(lastLog.temp) : 245);
          const phRaw = lastLog.phX10 !== undefined ? Number(lastLog.phX10) : (lastLog.ph !== undefined ? Number(lastLog.ph) : 72);
          snap = {
            temp: tempRaw / 10,
            ph: phRaw / 10
          };
        }
        createCurrent({
          authorWallet: author,
          title: activeTank.name || `Tank ${activeTank.id.slice(0, 8)}`,
          body: text,
          linkedTankId: activeTank.id,
          linkedTankName: activeTank.name,
          speciesTags: residingSpecies.map(s => s.commonName),
          parametersSnapshot: snap,
          visibility: "public"
        }).then(({ data, error }) => {
          if (error) {
            console.error("Failed to broadcast current to the Reef:", error);
            showToast(`⚠️ Stored locally. Reef broadcast failed: ${error}`);
          } else {
            showToast("🚀 Broadcasted update to The Reef feed!");
          }
        }).catch(err => {
          console.error("Reef broadcast error:", err);
          showToast("⚠️ Stored locally. Reef connection issue.");
        });
      } else {
        showToast("💾 Saved locally (Reef broadcast in preview mode).");
      }
    } else {
      showToast("💾 Observation logged successfully!");
    }

    setCommentText("");
    setSpawnClutchSize("");
    setSpawnStage("Eggs");
  };

  // Parameter Logging Form State (inside Quick Log or Detail panel)
  const [formData, setFormData] = useState({
    temp: "24.5",
    ph: "7.2",
    salinity: "1.0000",
    ammonia: "0.0",
    nitrite: "0.0",
    nitrate: "5.0",
    notes: ""
  });
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState(null);
  const [txHash, setTxHash] = useState(null);

  // Load tanks, logs, and inhabitants
  const fetchDashboardData = async () => {
    await refetchTanks();
  };

  useEffect(() => {
    if (tanks.length > 0 && !quickLogTankId) {
      setQuickLogTankId(tanks[0].id.toString());
    }
  }, [tanks, quickLogTankId]);

  // Handle Water Parameter Logging
  const handleLogSubmit = async (e, targetTankId) => {
    e.preventDefault();
    if (!targetTankId) return;

    setSubmitting(true);
    setModalError(null);
    setTxHash(null);
    try {
      const tempCelsiusX10 = Math.round(parseFloat(formData.temp) * 10);
      const phX10 = Math.round(parseFloat(formData.ph) * 10);
      const salinitySgX10000 = Math.round(parseFloat(formData.salinity) * 10000);
      const ammoniaPpmX100 = Math.round(parseFloat(formData.ammonia) * 100);
      const nitritePpmX100 = Math.round(parseFloat(formData.nitrite) * 100);
      const nitratePpmX100 = Math.round(parseFloat(formData.nitrate) * 100);

      // Beta: log locally via relayer (no MetaMask, no gas)
      const result = await relayLogWaterParameters({
        tankId: Number(targetTankId),
        tempCelsiusX10,
        phX10,
        salinitySgX10000,
        ammoniaPpmX100,
        nitritePpmX100,
        nitratePpmX100,
        notes: formData.notes,
      });

      if (!result.success) {
        throw new Error(result.error || "Failed to log parameters");
      }

      addXp(XP_ACTIONS.LOG_PARAMETERS.points, XP_ACTIONS.LOG_PARAMETERS.label);

      setFormData({
        temp: "24.5",
        ph: "7.2",
        salinity: "1.0000",
        ammonia: "0.0",
        nitrite: "0.0",
        nitrate: "5.0",
        notes: ""
      });
      setQuickLogOpen(false);
      setTxHash(null);

      await fetchDashboardData();
      
      // If we are currently viewing the updated tank in the detail view, refresh it
      if (activeTank && activeTank.id === Number(targetTankId)) {
        const updated = tanks.find(t => t.id === Number(targetTankId));
        if (updated) {
          setActiveTank(updated);
        }
      }
    } catch (err) {
      console.error("Failed to log parameters:", err);
      setModalError(err.reason || err.message || "Failed to execute transaction.");
    } finally {
      setSubmitting(false);
    }
  };

  // Scanner simulation triggers
  const triggerScan = () => {
    setScannerOpen(true);
    setScanning(true);
    setScanResult("");
    setTimeout(() => {
      setScanning(false);
      // Pick a random tank from owner list
      if (tanks.length > 0) {
        const randomTank = tanks[Math.floor(Math.random() * tanks.length)];
        setScanResult(randomTank.name);
        setTimeout(() => {
          setActiveTank(randomTank);
          setScannerOpen(false);
        }, 1200);
      } else {
        setScanResult("No active tanks registered.");
      }
    }, 2000);
  };

  // Convert Liters to US Gallons
  const toGallons = (liters) => {
    return (liters * 0.264172).toFixed(1);
  };

  // Calculate relative time since last log
  const getRelativeTime = (timestamp) => {
    if (!timestamp) return "Never tested";
    const diff = Math.floor(Date.now() / 1000) - Number(timestamp);
    if (diff < 60) return "Just now";
    const mins = Math.floor(diff / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  // Automated HSL color coding generator for parameters (ideal -> red alert)
  const getHslColor = (value, minIdeal, maxIdeal, factor = 1) => {
    const val = parseFloat(value);
    if (isNaN(val)) return "hsl(200, 10%, 60%)";

    // Standard deviation check
    if (val >= minIdeal && val <= maxIdeal) {
      return "hsl(140, 75%, 45%)"; // pure emerald green for healthy ranges
    }

    const dist = val < minIdeal ? minIdeal - val : val - maxIdeal;
    const maxDeviation = factor;
    const percentDeviation = Math.min(1, dist / maxDeviation);

    // Interpolate between Green (140) and Red (0)
    const hue = Math.round(140 - percentDeviation * 140);
    return `hsl(${hue}, 85%, 45%)`;
  };

  if (!walletAccount) {
    return (
      <div className="glass-card" style={{ padding: "3rem", textAlign: "center", marginTop: "2rem" }}>
        <h2 style={{ marginBottom: "1rem", color: "var(--text-secondary)" }}>Not Connected</h2>
        <p style={{ color: "var(--text-muted)", maxWidth: "450px", margin: "0 auto" }}>
          Connect your account to manage your aquariums.
        </p>
      </div>
    );
  }

  if (loading) {
    return <LoadingSkeleton variant="tanks" count={3} />;
  }

  if (error) {
    return (
      <div className="glass-card" style={{ padding: "2rem", border: "1px solid rgba(248, 113, 113, 0.2)", marginTop: "2rem" }}>
        <h3 style={{ color: "var(--accent-red)", marginBottom: "0.5rem" }}>Connection Error</h3>
        <p style={{ color: "var(--text-secondary)" }}>{error}</p>
        <button className="btn-primary" onClick={fetchDashboardData} style={{ marginTop: "1rem" }}>Retry Connection</button>
      </div>
    );
  }

  // Determine safe parameters based on selected quick log tank or active tank
  const selectedLogTank = tanks.find(t => t.id.toString() === quickLogTankId.toString()) || activeTank || tanks[0];
  let minSafeTemp = 22.0;
  let maxSafeTemp = 28.0;
  let minSafePh = 6.5;
  let maxSafePh = 8.2;
  let minSafeSalinity = 1.0000;
  let maxSafeSalinity = 1.0250;

  if (selectedLogTank) {
    const typeIdx = selectedLogTank.tankType;
    if (typeIdx === 1) { // Saltwater
      minSafeTemp = 24.0;
      maxSafeTemp = 27.0;
      minSafePh = 8.0;
      maxSafePh = 8.4;
      minSafeSalinity = 1.0200;
      maxSafeSalinity = 1.0260;
    } else if (typeIdx === 2) { // Brackish
      minSafeTemp = 22.0;
      maxSafeTemp = 28.0;
      minSafePh = 7.2;
      maxSafePh = 8.2;
      minSafeSalinity = 1.0050;
      maxSafeSalinity = 1.0150;
    } else if (typeIdx === 3) { // Pond
      minSafeTemp = 10.0;
      maxSafeTemp = 28.0;
      minSafePh = 6.8;
      maxSafePh = 8.0;
      minSafeSalinity = 1.0000;
      maxSafeSalinity = 1.0010;
    } else { // Freshwater (0)
      minSafeTemp = 22.0;
      maxSafeTemp = 26.0;
      minSafePh = 6.5;
      maxSafePh = 7.8;
      minSafeSalinity = 1.0000;
      maxSafeSalinity = 1.0020;
    }
  }

  // Location filter setup
  const locations = ["All", "Main Room", "Garage Rack", "Outdoor Ponds"];
  
  // Filter active list of tanks based on selected chip location
  const filteredTanks = selectedLocation === "All" 
    ? tanks 
    : tanks.filter(t => t.facility === selectedLocation || t.room === selectedLocation || t.rack === selectedLocation);

  const topLevelTanks = filteredTanks.filter(t => t.parentUnitId === 0);

  // Check chemistry metrics warning
  const getChemistryAlerts = (tank) => {
    if (!tank.latestLog) return [];
    const ammonia = Number(tank.latestLog.ammoniaPpmX100) / 100;
    const nitrite = Number(tank.latestLog.nitritePpmX100) / 100;
    const nitrate = Number(tank.latestLog.nitratePpmX100) / 100;

    const alerts = [];
    if (ammonia > 0.05) alerts.push(`High NH₃ (${ammonia} ppm)`);
    if (nitrite > 0.05) alerts.push(`High NO₂ (${nitrite} ppm)`);
    if (nitrate > 20.0) alerts.push(`High NO₃ (${nitrate} ppm)`);
    return alerts;
  };

  // Recursive component to render nested child cards (e.g. baskets)
  const renderNestedChildren = (parentId) => {
    const children = tanks.filter(t => t.parentUnitId === parentId);
    if (children.length === 0) return null;

    return (
      <div className="nested-children-container">
        {children.map(child => {
          const childAlerts = getChemistryAlerts(child);
          const hasAlert = childAlerts.length > 0;
          return (
            <div key={child.id} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div 
                className="nested-basket-card"
                onClick={(e) => {
                  e.stopPropagation();
                  // Find matching loaded tank data to have full logs and specimens
                  const fullTank = tanks.find(x => x.id === child.id) || child;
                  setActiveTank(fullTank);
                }}
                style={{
                  border: hasAlert ? "1px dashed var(--accent-red)" : "1px dashed rgba(255, 255, 255, 0.12)",
                  background: hasAlert ? "rgba(248, 113, 113, 0.02)" : "rgba(255, 255, 255, 0.01)"
                }}
              >
                <div style={{ display: "flex", flex: "1", flexDirection: "column", gap: "0.25rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "0.7rem", color: "var(--accent-blue)" }}>[{CONTAINMENT_TYPES[child.containment]}]</span>
                    <strong style={{ color: "#fff", fontSize: "0.85rem" }}>{child.name}</strong>
                    {!casualModeActive && <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>ID: {child.id}</span>}
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.75rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>
                      Species: {child.specimens.map(s => s.commonName).filter((v, i, a) => a.indexOf(v) === i).join(", ") || "None"}
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>•</span>
                    <span style={{ color: "var(--accent-green)" }}>{getSpecimenCount(child)} Fish</span>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  {hasAlert && (
                    <span className="badge pulsate-red-badge" style={{ fontSize: "0.6rem", padding: "0.1rem 0.5rem" }}>
                      ⚠️ Health Alert
                    </span>
                  )}
                  {child.latestLog && (
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                      Last test: {getRelativeTime(child.latestLog.timestamp)}
                    </span>
                  )}
                  <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{child.volumeLiters}L</span>
                </div>
              </div>
              {/* Recursive child containment lookup */}
              {renderNestedChildren(child.id)}
            </div>
          );
        })}
      </div>
    );
  };

  const handleWelcomeShare = () => {
    setShowWelcomeModal(false);
    const targetTank = tanks.find(t => t.active) || tanks[0];
    if (targetTank) {
      window.dispatchEvent(new CustomEvent("reef_share_tank", {
        detail: { tankId: targetTank.id, tankName: targetTank.name || `Tank ${targetTank.id}` }
      }));
    } else {
      window.dispatchEvent(new CustomEvent("reef_share_tank", {
        detail: { tankId: null, tankName: "" }
      }));
    }
  };

  return (
    <div style={{ position: "relative" }}>
      {/* 0. WELCOME OVERLAY FOR GUIDED ONBOARDING */}
      {showWelcomeModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(12px)",
            padding: "1rem"
          }}
        >
          <div
            className="glass-card"
            style={{
              width: "100%",
              maxWidth: "500px",
              padding: "2rem",
              borderRadius: "16px",
              border: casualModeActive 
                ? "1px solid rgba(56, 189, 248, 0.25)" 
                : "1px solid rgba(168, 85, 247, 0.25)",
              boxShadow: "0 24px 80px rgba(0, 0, 0, 0.8)",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              gap: "1.5rem",
              background: "rgba(15, 23, 42, 0.95)",
              color: "#fff",
              position: "relative"
            }}
          >
            <div>
              <span style={{ fontSize: "3rem", display: "block", marginBottom: "0.5rem" }}>🪸</span>
              <h3 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
                {casualModeActive 
                  ? `Welcome aboard, ${userAlias || "Keeper"}!` 
                  : `Operator Call Sign Confirmed: ${userAlias || "Operator"}`}
              </h3>
              <p style={{ 
                margin: "0.75rem 0 0", 
                fontSize: "0.9rem", 
                color: "var(--text-secondary)", 
                lineHeight: "1.6" 
              }}>
                {casualModeActive 
                  ? "Your display tank is officially set up! Let's introduce your new aquarium to the community on The Reef. Sharing publishes your initial water stats and unlocks early loyalty achievements!"
                  : "Primary Containment Unit registered on local registry. Let's establish your node connection by publishing your setup parameters to The Reef database."}
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <button
                type="button"
                onClick={handleWelcomeShare}
                style={{
                  width: "100%",
                  padding: "0.85rem",
                  borderRadius: "10px",
                  border: "none",
                  background: casualModeActive
                    ? "linear-gradient(135deg, #0ea5e9, #0369a1)"
                    : "linear-gradient(135deg, #a855f7, #7c3aed)",
                  color: "#fff",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: casualModeActive 
                    ? "0 4px 15px rgba(14, 165, 233, 0.3)" 
                    : "0 4px 15px rgba(168, 85, 247, 0.3)"
                }}
              >
                {casualModeActive ? "Share Tank & Visit The Reef" : "Publish Setup to The Reef"}
              </button>
              
              <button
                type="button"
                onClick={() => setShowWelcomeModal(false)}
                style={{
                  width: "100%",
                  padding: "0.85rem",
                  borderRadius: "10px",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  background: "rgba(255, 255, 255, 0.03)",
                  color: "var(--text-muted)",
                  fontSize: "0.85rem",
                  cursor: "pointer"
                }}
              >
                {casualModeActive ? "Explore Dashboard first" : "Go to Operator Console"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 1. STICKY ACTION HEADER BAR — Premium Glassmorphic */}
      <div
        className={`tank-action-bar glass-card ${casualModeActive ? "tank-action-bar--casual" : "tank-action-bar--pro"}`}
        style={{ marginBottom: "1.5rem" }}
      >
        {/* Primary CTA: Scan */}
        <button
          className={`tank-action-pill tank-action-pill--scan${casualModeActive ? " tank-action-pill--casual" : " tank-action-pill--pro"}`}
          onClick={triggerScan}
          aria-label={casualModeActive ? "Scan Tank" : "Scan Unit"}
        >
          <span>📸</span>
          <span>{casualModeActive ? "Scan Tank" : "Scan Unit"}</span>
        </button>

        {/* View mode toggler (Pro only) */}
        {!casualModeActive && (
          <div
            className="tank-view-toggle"
            role="radiogroup"
            aria-label="View mode"
          >
            <button
              className={`tank-view-btn${viewMode === "list" ? " tank-view-btn--active" : ""}`}
              onClick={() => setViewMode("list")}
              role="radio"
              aria-checked={viewMode === "list"}
            >
              <span>📋</span>
              <span>Grid list</span>
            </button>
            <button
              className={`tank-view-btn${viewMode === "tree" ? " tank-view-btn--active" : ""}`}
              onClick={() => setViewMode("tree")}
              role="radio"
              aria-checked={viewMode === "tree"}
            >
              <span>🏢</span>
              <span>Facility Tree</span>
            </button>
          </div>
        )}

        {/* Spacer pushes Quick Log + Register to the right */}
        <div style={{ flex: 1 }} />

        {/* Quick Log */}
        <button
          className={`tank-action-pill tank-action-pill--secondary${casualModeActive ? " tank-action-pill--casual-secondary" : " tank-action-pill--pro-secondary"}`}
          onClick={() => setQuickLogOpen(true)}
          aria-label="Quick Log"
        >
          <span>✍️</span>
          <span>Quick Log</span>
        </button>

        {/* Register / Add Tank */}
        <button
          className={`tank-action-pill tank-action-pill--register${casualModeActive ? " tank-action-pill--casual" : " tank-action-pill--pro"}`}
          onClick={() => {
            setViewMode("tree");
            setOpenRegisterOnTreeMount(true);
          }}
          aria-label={casualModeActive ? "Add Tank" : "Register Unit"}
        >
          <span>+</span>
          <span>{casualModeActive ? "Add Tank" : "Register Unit"}</span>
        </button>
      </div>

      {/* 2. DYNAMIC LOCATION CAROUSEL (Pro Mode Only) */}
      {!casualModeActive && (
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.7rem", fontWeight: "700", color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              📍 Filter by Location
            </span>
            {selectedLocation !== "All" && (
              <button 
                type="button"
                onClick={() => setSelectedLocation("All")} 
                style={{ 
                  background: "none", 
                  border: "none", 
                  color: "var(--accent-blue)", 
                  fontSize: "0.75rem", 
                  fontWeight: "600",
                  cursor: "pointer", 
                  textDecoration: "underline",
                  padding: 0 
                }}
              >
                Reset Filter
              </button>
            )}
          </div>
          <div className="location-carousel-container">
            {locations.map((loc) => {
              // Calculate how many tanks match this location
              const count = loc === "All" 
                ? tanks.length 
                : tanks.filter(t => t.facility === loc || t.room === loc || t.rack === loc).length;
              
              return (
                <button 
                  key={loc}
                  className={`location-chip-premium ${selectedLocation === loc ? "active" : ""}`}
                  onClick={() => setSelectedLocation(loc)}
                >
                  <span>📍</span>
                  <span>{loc}</span>
                  <span style={{ 
                    fontSize: "0.65rem", 
                    opacity: 0.8,
                    background: selectedLocation === loc ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)",
                    padding: "0.05rem 0.35rem",
                    borderRadius: "10px",
                    marginLeft: "0.25rem",
                    fontWeight: "700"
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: activeTank ? "1.2fr 1fr" : "1fr", gap: "2rem", alignItems: "start" }}>
        {/* LEFT VIEW COMPONENT */}
        <div>
          {viewMode === "tree" ? (
            <FacilityTreeView 
              contractAddress={contractAddress} 
              walletAccount={walletAccount} 
              casualModeActive={casualModeActive}
              onSelectTank={(t) => {
                const fullTank = tanks.find(x => x.id === t.id) || t;
                setActiveTank(fullTank);
              }}
              onReload={() => {
                fetchDashboardData();
                if (casualModeActive) setViewMode("grid");
              }}
              openRegisterOnTreeMount={openRegisterOnTreeMount}
              onCloseRegister={() => {
                setOpenRegisterOnTreeMount(false);
                if (casualModeActive) setViewMode("grid");
              }}
            />
          ) : (
            <div className="vertical-tank-rows">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <h3 style={{ fontSize: "1.25rem", color: "#fff" }}>{casualModeActive ? "🐠 My Tanks" : "Aquarium Containment Systems"}</h3>
                <span className="badge badge-blue">{filteredTanks.length} Units Found</span>
              </div>

              {topLevelTanks.length === 0 ? (
                tanks.length === 0 ? (
                  <div className="glass-card" style={{ padding: "3rem 2rem", textAlign: "center", maxWidth: "520px", margin: "2rem auto" }}>
                    <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>
                      {casualModeActive ? "🐠" : "🧪"}
                    </div>
                    <h2 style={{ color: "#fff", marginBottom: "0.75rem", fontSize: "1.4rem" }}>
                      {casualModeActive
                        ? "Welcome to Aquadex!"
                        : "Welcome to Aquadex"}
                    </h2>
                    <p style={{ color: "var(--text-secondary)", lineHeight: "1.6", marginBottom: "1.5rem" }}>
                      {casualModeActive
                        ? "Create your first aquarium to start tracking your fish. You'll be able to log water parameters, catalog species, and monitor tank health all in one place."
                        : "Register your first containment unit to begin. Head to the Register tab or use the facility tree view to define your system topology."}
                    </p>
                    <button
                      className="btn-primary"
                      onClick={() => {
                        setViewMode("tree");
                        setOpenRegisterOnTreeMount(true);
                      }}
                      style={{ padding: "0.75rem 1.5rem", fontSize: "1rem" }}
                    >
                      {casualModeActive ? "➕ Create My First Tank" : "➕ Register Containment Unit"}
                    </button>
                    <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "1rem" }}>
                      {casualModeActive
                        ? "Or switch to Facility Tree view above to set up rooms and racks first."
                        : "This will open the facility tree registration workflow."}
                    </p>
                  </div>
                ) : (
                  <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
                    <p style={{ color: "var(--text-muted)" }}>No top-level units match the current filters.</p>
                  </div>
                )
              ) : (
                topLevelTanks.map((tank) => {
                  const alerts = getChemistryAlerts(tank);
                  const hasAlert = alerts.length > 0;
                  const latestTestTime = tank.latestTestTimestamp ? getRelativeTime(tank.latestTestTimestamp) : "Never tested";
                  const latestChangeTime = tank.latestChangeTimestamp ? getRelativeTime(tank.latestChangeTimestamp) : "Never changed";
                  const speciesName = tank.specimens.map(s => s.commonName).filter((v, i, a) => a.indexOf(v) === i).join(", ") || "No inhabitants";

                  return (
                    <div 
                      key={tank.id} 
                      className="tank-row-card"
                      onClick={() => setActiveTank(tank)}
                      onDragOver={(e) => {
                        e.preventDefault();
                      }}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        setDraggedOverTankId(tank.id);
                      }}
                      onDragLeave={() => {
                        setDraggedOverTankId(null);
                      }}
                      onDrop={async (e) => {
                        e.preventDefault();
                        setDraggedOverTankId(null);
                        const specimenIdStr = e.dataTransfer.getData("application/aquadex-specimen");
                        if (specimenIdStr) {
                          const specId = Number(specimenIdStr);
                          const targetTankId = tank.id;
                          if (activeTank && activeTank.id === targetTankId) {
                            showToast("⚠️ Specimen is already in this tank!");
                            return;
                          }
                          await handleMoveSpecimen(specId, targetTankId);
                        }
                      }}
                      style={{
                        cursor: "pointer",
                        transform: draggedOverTankId === tank.id ? "scale(1.03)" : "scale(1)",
                        border: draggedOverTankId === tank.id
                          ? "1px solid #38bdf8"
                          : activeTank && activeTank.id === tank.id 
                            ? "1px solid var(--accent-blue)" 
                            : hasAlert 
                              ? "1px solid rgba(248, 113, 113, 0.4)" 
                              : "1px solid var(--glass-border)",
                        boxShadow: draggedOverTankId === tank.id
                          ? "0 0 20px rgba(56, 189, 248, 0.4)"
                          : activeTank && activeTank.id === tank.id 
                            ? "0 0 15px var(--accent-blue-glow)" 
                            : "none",
                        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                      }}
                    >
                      {/* Header line */}
                      <div className="tank-row-header">
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span className={`badge ${tank.tankType === 1 ? "badge-blue" : "badge-green"}`} style={{ fontSize: "0.6rem" }}>
                              {TANK_TYPES[tank.tankType]}
                            </span>
                            <h4 style={{ color: "#fff", fontSize: "1.1rem" }}>{tank.name}</h4>
                            {!casualModeActive && <span className="mono-id-chip">UNIT #{tank.id}</span>}
                          </div>
                          {!casualModeActive && (
                            <div className="micro-breadcrumbs" style={{ marginTop: "0.25rem" }}>
                              <span>📍</span>
                              <span>{tank.facility}</span>
                              <span className="micro-breadcrumbs-separator">›</span>
                              <span>{tank.room}</span>
                              <span className="micro-breadcrumbs-separator">›</span>
                              <span>{tank.rack}</span>
                            </div>
                          )}
                        </div>

                        <div style={{ textAlign: "right" }}>
                          {casualModeActive ? (
                            <>
                              <strong style={{ fontSize: "1.05rem", color: "#fff" }}>{toGallons(tank.volumeLiters)} gal</strong>
                              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block" }}>
                                (approx {tank.volumeLiters}L)
                              </span>
                            </>
                          ) : (
                            <>
                              <strong style={{ fontSize: "1.05rem", color: "#fff" }}>{tank.volumeLiters}L</strong>
                              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block" }}>
                                ({toGallons(tank.volumeLiters)} gal)
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Middle grid */}
                      {casualModeActive ? (
                        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "1rem", fontSize: "0.85rem", background: "rgba(0,0,0,0.15)", padding: "0.75rem", borderRadius: "8px" }}>
                          <div>
                            <span style={{ color: "var(--text-muted)", fontSize: "0.75rem", display: "block" }}>Inhabitants</span>
                            <strong style={{ color: "var(--accent-green)" }}>{getSpecimenCount(tank)} Fish</strong>
                            <span style={{ color: "var(--text-secondary)", fontSize: "0.75rem", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {speciesName}
                            </span>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <span style={{ color: "var(--text-muted)", fontSize: "0.75rem", display: "block" }}>Water Care</span>
                            <strong style={{ color: "var(--text-primary)", fontSize: "0.85rem", display: "block", marginTop: "0.15rem" }}>
                              🧪 Test: {latestTestTime}
                            </strong>
                            <span style={{ color: "var(--text-secondary)", fontSize: "0.75rem", display: "block", marginTop: "0.15rem" }}>
                              💧 Change: {latestChangeTime}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1rem", marginTop: "1.0rem", borderTop: "1px solid rgba(255, 255, 255, 0.04)", paddingTop: "0.75rem" }}>
                          <div>
                            <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "0.4rem" }}>Inhabitants</span>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                              <span className="specimen-tag-glass" style={{ fontWeight: "700", color: "var(--accent-green)", borderColor: "rgba(52, 211, 153, 0.2)" }}>
                                👥 {getSpecimenCount(tank)} Certificates
                              </span>
                              {tank.specimens.length > 0 ? (
                                tank.specimens.map(s => s.commonName)
                                  .filter((v, i, a) => a.indexOf(v) === i)
                                  .slice(0, 2)
                                  .map(name => (
                                    <span key={name} className="specimen-tag-glass">{name}</span>
                                  ))
                              ) : (
                                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Empty Unit</span>
                              )}
                              {tank.specimens.map(s => s.commonName).filter((v, i, a) => a.indexOf(v) === i).length > 2 && (
                                <span className="specimen-tag-glass" style={{ fontSize: "0.65rem" }}>+ more</span>
                              )}
                            </div>
                          </div>

                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <div className="telemetry-indicator-group">
                              <div className="telemetry-row">
                                <span className="telemetry-status-label">Water Test:</span>
                                <span className="telemetry-status-value">
                                  <span className={`status-light-pulse ${
                                    hasAlert ? "red" : (latestTestTime.includes("h ago") || latestTestTime.includes("m ago") || latestTestTime.includes("s ago")) ? "green" : "orange"
                                  }`} />
                                  {latestTestTime}
                                </span>
                              </div>
                              <div className="telemetry-row">
                                <span className="telemetry-status-label">Water Change:</span>
                                <span className="telemetry-status-value">
                                  <span className={`status-light-pulse ${
                                    latestChangeTime.includes("Never") ? "red" : (latestChangeTime.includes("day") || latestChangeTime.includes("h ago") || latestChangeTime.includes("m ago") || latestChangeTime.includes("s ago")) ? "green" : "orange"
                                  }`} />
                                  {latestChangeTime}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Alerts panel */}
                      {hasAlert && (
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.4rem 0.75rem", background: "rgba(248, 113, 113, 0.08)", borderLeft: "3px solid var(--accent-red)", borderRadius: "4px", fontSize: "0.75rem" }}>
                          <span className="badge pulsate-red-badge" style={{ fontSize: "0.55rem" }}>ALERT</span>
                          <span style={{ color: "var(--accent-red)" }}>{alerts.join(" | ")}</span>
                        </div>
                      )}

                      {/* Recursive nested child containers */}
                      {renderNestedChildren(tank.id)}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* RIGHT: DETAILED ACTIVE TANK PANEL — Full-screen bottom sheet on mobile */}
        {activeTank && (
          <>
            {/* Backdrop overlay for mobile */}
            <div 
              className="tank-detail-backdrop"
              onClick={() => setActiveTank(null)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.6)",
                backdropFilter: "blur(4px)",
                zIndex: 999,
                opacity: 1,
                transition: "opacity 0.3s ease",
              }}
            />
            <div className="glass-card biotope-detail-panel tank-detail-sheet" style={{
              padding: "1.5rem",
              border: casualModeActive
                ? "1px solid rgba(56, 189, 248, 0.22)"
                : "1px solid rgba(168, 85, 247, 0.3)",
              boxShadow: casualModeActive
                ? "0 0 24px rgba(56, 189, 248, 0.07), inset 0 0 60px rgba(14, 165, 233, 0.03)"
                : "0 0 28px rgba(168, 85, 247, 0.1), inset 0 0 60px rgba(139, 92, 246, 0.04)",
              background: casualModeActive
                ? "rgba(8, 25, 48, 0.98)"
                : "rgba(14, 8, 30, 0.98)",
              "--sheet-bg": casualModeActive
                ? "rgba(8, 25, 48, 0.95)"
                : "rgba(14, 8, 30, 0.95)",
              position: "sticky",
              top: "1rem",
              maxHeight: "calc(100vh - 2rem)",
              overflowY: "auto",
              transition: "all 0.5s ease"
            }}>
              
              {/* Drag handle for mobile — swipe down to dismiss */}
              <div 
                className="tank-sheet-handle" 
                style={{
                  width: "40px",
                  height: "4px",
                  borderRadius: "2px",
                  background: "rgba(255, 255, 255, 0.3)",
                  margin: "0 auto 1rem",
                  cursor: "grab",
                }}
                onTouchStart={(e) => {
                  const startY = e.touches[0].clientY;
                  const sheet = e.currentTarget.closest('.tank-detail-sheet');
                  let currentY = startY;
                  
                  const onMove = (moveEvent) => {
                    currentY = moveEvent.touches[0].clientY;
                    const diff = currentY - startY;
                    if (diff > 0) {
                      sheet.style.transform = `translateY(${diff}px)`;
                      sheet.style.transition = 'none';
                    }
                  };
                  
                  const onEnd = () => {
                    const diff = currentY - startY;
                    sheet.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
                    if (diff > 120) {
                      sheet.style.transform = 'translateY(100%)';
                      setTimeout(() => setActiveTank(null), 300);
                    } else {
                      sheet.style.transform = 'translateY(0)';
                    }
                    document.removeEventListener('touchmove', onMove);
                    document.removeEventListener('touchend', onEnd);
                  };
                  
                  document.addEventListener('touchmove', onMove, { passive: true });
                  document.addEventListener('touchend', onEnd);
                }}
              />

              {/* Close button for detailed panel */}
              <button 
                onClick={() => setActiveTank(null)}
                className="tank-detail-close-btn"
                style={{
                  position: "absolute",
                  top: "0.75rem",
                  right: "0.75rem",
                  background: "rgba(0, 0, 0, 0.6)",
                  border: "1px solid var(--glass-border)",
                  color: "#fff",
                  borderRadius: "50%",
                  width: "44px",
                  height: "44px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  zIndex: 20,
                  fontSize: "1.4rem",
                }}
                aria-label="Close tank details"
              >
                &times;
              </button>

            {/* Biotope banner image */}
            <div 
              className="biotope-banner"
              style={{ 
                backgroundImage: `url('${localStorage.getItem(`aquadex_tank_photo_${activeTank.id}`) || getSupabaseImageUrl(activeTank)}')` 
              }}
            >
              <div className="biotope-banner-overlay"></div>

              {/* Companion Fish Entity (swimming fry or hatched tier) — hidden in Pro mode */}
              {casualModeActive && companionData && companionData.companionXp >= 500 && (
                <CompanionFishEntity tier={companionData.currentTier} companionXp={companionData.companionXp} />
              )}

              {/* Quiet Mystery Egg UI Overlay — hidden in Pro mode */}
              {casualModeActive && companionData && companionData.eggState === 1 && (
                <div 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowBubble(true);
                    setTimeout(() => setShowBubble(false), 3000);
                  }}
                  style={{
                    position: 'absolute',
                    bottom: '12px',
                    right: '12px',
                    width: '24px',
                    height: '32px',
                    borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.4), rgba(255,255,255,0.1))',
                    border: '1px solid rgba(255,255,255,0.2)',
                    backdropFilter: 'blur(3px)',
                    cursor: 'pointer',
                    boxShadow: '0 0 10px rgba(0,229,255,0.2)',
                    transition: 'transform 0.2s ease',
                    zIndex: 10
                  }}
                  title="Quiet Mystery Egg"
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                  {showBubble && (
                    <div style={{
                      position: 'absolute',
                      bottom: '38px',
                      right: '0',
                      background: 'rgba(8, 12, 20, 0.95)',
                      color: '#00e5ff',
                      border: '1px solid rgba(0,229,255,0.3)',
                      borderRadius: '6px',
                      padding: '6px 12px',
                      fontSize: '11px',
                      whiteSpace: 'nowrap',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                      zIndex: 20,
                      pointerEvents: 'none'
                    }}>
                      Wait, it's not Easter?! 🥚
                    </div>
                  )}
                </div>
              )}
              
              {/* QR tag identifier anchored over top-right — real generated QR */}
              <div className="qr-anchor-tag" style={{ cursor: "pointer" }} onClick={async (e) => {
                e.stopPropagation();
                // Generate printable QR label PDF for this tank
                try {
                  const { generateTankQRLabel } = await import("../utils/pdfExport");
                  await generateTankQRLabel({
                    tankId: activeTank.id,
                    tankName: activeTank.name,
                    facility: activeTank.facility,
                    room: activeTank.room,
                    rack: activeTank.rack,
                    volumeLiters: activeTank.volumeLiters,
                    containment: CONTAINMENT_TYPES[activeTank.containment]
                  });
                } catch (err) {
                  console.error("QR label generation failed:", err);
                }
              }} title="Click to print QR label">
                {/* Real QR code rendered as canvas-to-image */}
                <TankQRCode tankId={activeTank.id} size={40} />
                <span style={{ fontSize: "0.55rem", fontWeight: "700", color: "var(--bg-primary)" }}>UNIT #{activeTank.id}</span>
              </div>

              <div style={{ position: "absolute", bottom: "1rem", left: "1rem", zIndex: "2" }}>
                <span className={`badge ${activeTank.tankType === 1 ? "badge-blue" : "badge-green"}`} style={{ marginBottom: "0.25rem" }}>
                  {TANK_TYPES[activeTank.tankType]} {casualModeActive ? "Tank" : CONTAINMENT_TYPES[activeTank.containment]}
                </span>
                <h3 style={{ color: "#fff", fontSize: "1.5rem" }}>{activeTank.name}</h3>
                {!casualModeActive && (
                  <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    📍 {activeTank.facility} › {activeTank.room} › {activeTank.rack}
                  </span>
                )}
              </div>
              {poseidonChatOpen && (
                <PoseidonChatConsole
                  tankId={activeTank.id}
                  casualModeActive={casualModeActive}
                  walletAccount={walletAccount}
                  onClose={() => setPoseidonChatOpen(false)}
                />
              )}
            </div>

            {/* Inline Quick-Tap Action Sheet Toolbar */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem 1rem",
              background: "rgba(255, 255, 255, 0.02)",
              border: "1px solid var(--glass-border)",
              borderRadius: "8px",
              margin: "1rem 0"
            }}>
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em" }}>Quick Actions:</span>
              
              {/* Invisible Photo Input */}
              <input
                type="file"
                ref={photoInputRef}
                accept="image/*"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const { compressImage } = await import("../utils/imageCompression");
                    const compressed = await compressImage(file, { maxWidth: 1200, quality: 0.8 });
                    localStorage.setItem(`aquadex_tank_photo_${activeTank.id}`, compressed);
                    setActiveTank({ ...activeTank });
                  } catch (err) {
                    console.error("Photo upload failed:", err);
                  }
                }}
              />

              {/* Invisible Specimen Photo Input */}
              <input
                type="file"
                ref={specimenPhotoInputRef}
                accept="image/*"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !uploadingSpecimenId) return;
                  try {
                    const { compressImage } = await import("../utils/imageCompression");
                    const compressed = await compressImage(file, { maxWidth: 1200, quality: 0.8 });
                    localStorage.setItem(`aquadex_specimen_photo_${uploadingSpecimenId}`, compressed);
                    setActiveTank({ ...activeTank });
                    showToast("Specimen photo updated!");
                  } catch (err) {
                    console.error("Specimen photo upload failed:", err);
                  }
                }}
              />

              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setQuickActionsOpen(!quickActionsOpen)}
                  className="btn-secondary"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.4rem 1rem",
                    fontSize: "0.8rem",
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: "6px",
                    color: "#fff",
                    cursor: "pointer"
                  }}
                >
                  ⚡ Log Care / Actions <span style={{ fontSize: "0.6rem", transition: "transform 0.2s", display: "inline-block", transform: quickActionsOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
                </button>

                {quickActionsOpen && (
                  <>
                    {/* Click-away backdrop overlay */}
                    <div 
                      onClick={() => setQuickActionsOpen(false)}
                      style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 99
                      }}
                    />
                    {casualModeActive ? (
                      <div style={{
                        position: "absolute",
                        top: "calc(100% + 0.5rem)",
                        left: 0,
                        zIndex: 100,
                        width: "240px",
                        background: "rgba(8, 25, 48, 0.98)",
                        backdropFilter: "blur(20px)",
                        border: "1px solid var(--glass-border-hover)",
                        borderRadius: "8px",
                        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.7), 0 0 15px rgba(56, 189, 248, 0.05)",
                        padding: "0.4rem 0",
                        display: "flex",
                        flexDirection: "column"
                      }}>
                        <div style={{ padding: "0.4rem 1rem 0.2rem", fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em" }}>Log Husbandry</div>
                        
                        <button
                          type="button"
                          onClick={() => { logFeedClick(); setQuickActionsOpen(false); }}
                          className="dropdown-action-item"
                        >
                          <span style={{ marginRight: "0.25rem" }}>🥣</span> Quick Feed
                        </button>
                        <button
                          type="button"
                          onClick={() => { logFeedLongPress(); setQuickActionsOpen(false); }}
                          className="dropdown-action-item"
                        >
                          <span style={{ marginRight: "0.25rem" }}>🥣</span> Detailed Feed...
                        </button>

                        <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)", margin: "0.3rem 0" }} />
                        <div style={{ padding: "0.4rem 1rem 0.2rem", fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em" }}>Log Environment</div>

                        <button
                          type="button"
                          onClick={() => { logTestClick(); setQuickActionsOpen(false); }}
                          className="dropdown-action-item"
                        >
                          <span style={{ marginRight: "0.25rem" }}>🧪</span> Quick Water Test
                        </button>
                        <button
                          type="button"
                          onClick={() => { logTestLongPress(); setQuickActionsOpen(false); }}
                          className="dropdown-action-item"
                        >
                          <span style={{ marginRight: "0.25rem" }}>🧪</span> Detailed Test...
                        </button>

                        <button
                          type="button"
                          onClick={() => { logAlgaeClick(); setQuickActionsOpen(false); }}
                          className="dropdown-action-item"
                        >
                          <span style={{ marginRight: "0.25rem" }}>🧹</span> Quick Clean
                        </button>
                        <button
                          type="button"
                          onClick={() => { logAlgaeLongPress(); setQuickActionsOpen(false); }}
                          className="dropdown-action-item"
                        >
                          <span style={{ marginRight: "0.25rem" }}>🧹</span> Detailed Clean...
                        </button>

                        <div style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)", margin: "0.3rem 0" }} />
                        <div style={{ padding: "0.4rem 1rem 0.2rem", fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em" }}>Tank Operations</div>

                        <button
                          type="button"
                          onClick={() => { setPoseidonChatOpen(!poseidonChatOpen); setQuickActionsOpen(false); }}
                          className="dropdown-action-item"
                        >
                          <span style={{ marginRight: "0.25rem" }}>💬</span> Ask Poseidon AI
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setInlineDetailType("population");
                            setInlineDetailText(getSpecimenCount(activeTank).toString());
                            setInlineDetailOpen(true);
                            setTimeout(() => inlineDetailRef.current?.focus(), 100);
                            setQuickActionsOpen(false);
                          }}
                          className="dropdown-action-item"
                        >
                          <span style={{ marginRight: "0.25rem" }}>🐟</span> Update Fish Count
                        </button>
                        <button
                          type="button"
                          onClick={() => { photoInputRef.current?.click(); setQuickActionsOpen(false); }}
                          className="dropdown-action-item"
                        >
                          <span style={{ marginRight: "0.25rem" }}>📷</span> Upload Photo
                        </button>
                      </div>
                    ) : (
                      <div className="command-console-panel">
                        <div className="console-header">
                          <span className="console-title">
                            ⚡ Command Console
                          </span>
                          <span className="console-pulse-dot" />
                        </div>
                        
                        <div>
                          <div className="console-category-header">Husbandry</div>
                          <div className="console-grid">
                            <button
                              type="button"
                              onClick={() => { logFeedClick(); setQuickActionsOpen(false); }}
                              className="console-tile tile-husbandry"
                            >
                              <span className="console-tile-icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M2 12h20a10 10 0 0 1-20 0z" />
                                  <circle cx="8" cy="7" r="1.2" fill="currentColor"/>
                                  <circle cx="12" cy="5" r="1.2" fill="currentColor"/>
                                  <circle cx="16" cy="7" r="1.2" fill="currentColor"/>
                                </svg>
                              </span>
                              <span className="console-tile-label">Quick Feed</span>
                              <span className="console-tile-desc">Standard dose</span>
                            </button>
                            
                            <button
                              type="button"
                              onClick={() => { logFeedLongPress(); setQuickActionsOpen(false); }}
                              className="console-tile tile-husbandry"
                            >
                              <span className="console-tile-icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M2 12h20a10 10 0 0 1-20 0z" />
                                  <circle cx="8" cy="7" r="1.2" fill="currentColor"/>
                                  <circle cx="12" cy="5" r="1.2" fill="currentColor"/>
                                  <circle cx="16" cy="7" r="1.2" fill="currentColor"/>
                                </svg>
                              </span>
                              <span className="console-tile-label">Detailed Feed</span>
                              <span className="console-tile-desc">Log details</span>
                            </button>
                          </div>
                        </div>

                        <div>
                          <div className="console-category-header">Environment</div>
                          <div className="console-grid">
                            <button
                              type="button"
                              onClick={() => { logTestClick(); setQuickActionsOpen(false); }}
                              className="console-tile tile-environment"
                            >
                              <span className="console-tile-icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M6 3h12M9 3v8L4 19A2 2 0 0 0 6 22h12a2 2 0 0 0 2-3L15 11V3" />
                                  <path d="M6 18h12" />
                                </svg>
                              </span>
                              <span className="console-tile-label">Quick Test</span>
                              <span className="console-tile-desc">Nominal parameters</span>
                            </button>
                            
                            <button
                              type="button"
                              onClick={() => { logTestLongPress(); setQuickActionsOpen(false); }}
                              className="console-tile tile-environment"
                            >
                              <span className="console-tile-icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M6 3h12M9 3v8L4 19A2 2 0 0 0 6 22h12a2 2 0 0 0 2-3L15 11V3" />
                                  <path d="M6 18h12" />
                                </svg>
                              </span>
                              <span className="console-tile-label">Detailed Test</span>
                              <span className="console-tile-desc">Enter measurements</span>
                            </button>
                            
                            <button
                              type="button"
                              onClick={() => { logAlgaeClick(); setQuickActionsOpen(false); }}
                              className="console-tile tile-environment"
                            >
                              <span className="console-tile-icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
                                </svg>
                              </span>
                              <span className="console-tile-label">Quick Clean</span>
                              <span className="console-tile-desc">Algae sweep</span>
                            </button>
                            
                            <button
                              type="button"
                              onClick={() => { logAlgaeLongPress(); setQuickActionsOpen(false); }}
                              className="console-tile tile-environment"
                            >
                              <span className="console-tile-icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
                                </svg>
                              </span>
                              <span className="console-tile-label">Detailed Clean</span>
                              <span className="console-tile-desc">Water change & filters</span>
                            </button>
                          </div>
                        </div>

                        <div>
                          <div className="console-category-header">System Operations</div>
                          <div className="console-grid">
                            <button
                              type="button"
                              onClick={() => { setPoseidonChatOpen(!poseidonChatOpen); setQuickActionsOpen(false); }}
                              className="console-tile tile-system console-span-2"
                            >
                              <span className="console-tile-icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                  <path d="M13 8l-3 4h3l-1 4 3-4h-3z" fill="currentColor" />
                                </svg>
                              </span>
                              <span className="console-tile-text">
                                <span className="console-tile-label">Ask Poseidon AI</span>
                                <span className="console-tile-desc">Diagnose anomalies & check parameters</span>
                              </span>
                            </button>
                                                        <button
                              type="button"
                              onClick={() => {
                                setInlineDetailType("population");
                                setInlineDetailText(getSpecimenCount(activeTank).toString());
                                setInlineDetailOpen(true);
                                setProPopAction("add");
                                if (contractSpecies.length > 0) {
                                  setProPopSpeciesId(String(contractSpecies[0].speciesId));
                                } else {
                                  setProPopSpeciesId("");
                                }
                                setProPopGender("Not Sure");
                                setProPopQty(1);
                                setTimeout(() => inlineDetailRef.current?.focus(), 100);
                                setQuickActionsOpen(false);
                              }}
                              className="console-tile tile-system"
                            >
                              <span className="console-tile-icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M20 12c0-3.5-3-6-7-6-3 0-6 2-8 5 2 3 5 5 8 5 4 0 7-2.5 7-6z"/>
                                  <path d="M2 12c1.5-2 3.5-3 6-3M2 12c1.5 2 3.5 3 6 3"/>
                                  <path d="M12 10a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" fill="currentColor"/>
                                  <path d="M20 12l2 2v-4l-2 2z"/>
                                </svg>
                              </span>
                              <span className="console-tile-label">Population</span>
                              <span className="console-tile-desc">Update specimen count</span>
                            </button>
                            
                            <button
                              type="button"
                              onClick={() => { photoInputRef.current?.click(); setQuickActionsOpen(false); }}
                              className="console-tile tile-system"
                            >
                              <span className="console-tile-icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                                  <circle cx="12" cy="13" r="4"/>
                                </svg>
                              </span>
                              <span className="console-tile-label">Upload Photo</span>
                              <span className="console-tile-desc">Attach visual log</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Subtabs Menu */}
            <div className="horizontal-subtabs">
              {["overview", "fish", "history", "notes", "social"].map(subTab => {
                const labelMap = casualModeActive 
                  ? { overview: "About", fish: "My Fish", history: "Activity", notes: "Notes", social: "Community" }
                  : { overview: "Overview", fish: "Specimens", history: "Parameter History", notes: "Observations", social: "Social Feed" };
                return (
                  <button 
                    key={subTab} 
                    className={`subtab-item ${detailSubTab === subTab ? "active" : ""}`}
                    onClick={() => setDetailSubTab(subTab)}
                  >
                    {labelMap[subTab]}
                  </button>
                );
              })}
            </div>

            {/* Detail Content rendering */}
            <div style={{ minHeight: "220px" }}>
              
              {/* 2.1 OVERVIEW SUB-TAB: Telemetry Grid or Casual System Specs */}
              {detailSubTab === "overview" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {casualModeActive ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                      {/* Water Type */}
                      <div className="telemetry-tile-premium" style={{ borderLeft: "3px solid var(--accent-blue)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>💧 Water Type</span>
                        </div>
                        <strong style={{ fontSize: "1.25rem", color: "#fff", display: "block", marginTop: "0.5rem" }}>
                          {TANK_TYPES[activeTank.tankType]}
                        </strong>
                        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Freshwater ecosystem</span>
                      </div>

                      {/* Volume */}
                      <div className="telemetry-tile-premium" style={{ borderLeft: "3px solid var(--accent-green)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>📐 Tank Volume</span>
                        </div>
                        <strong style={{ fontSize: "1.25rem", color: "#fff", display: "block", marginTop: "0.5rem" }}>
                          {toGallons(activeTank.volumeLiters)} gal
                        </strong>
                        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Approx. {activeTank.volumeLiters} Liters</span>
                      </div>

                      {/* Population */}
                      <div className="telemetry-tile-premium" style={{ borderLeft: "3px solid var(--accent-amber)", gridColumn: "span 2", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>🐠 Current Population</span>
                          <strong style={{ fontSize: "1.25rem", color: "#fff", display: "block", marginTop: "0.4rem" }}>
                            {getSpecimenCount(activeTank)} Fish
                          </strong>
                          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>Total specimens in this tank</span>
                        </div>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => openAddFish(activeTank)}
                          style={{
                            padding: "0.5rem 1rem",
                            fontSize: "0.82rem",
                            fontWeight: "600",
                            borderRadius: "8px",
                            background: "linear-gradient(135deg, var(--accent-amber), #d97706)",
                            border: "none",
                            color: "#fff",
                            boxShadow: "0 4px 12px rgba(245, 158, 11, 0.2)",
                            transition: "all 0.2s ease",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.4rem"
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = "translateY(-1px)";
                            e.currentTarget.style.boxShadow = "0 6px 16px rgba(245, 158, 11, 0.4)";
                            e.currentTarget.style.background = "linear-gradient(135deg, #d97706, #b45309)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = "translateY(0)";
                            e.currentTarget.style.boxShadow = "0 4px 12px rgba(245, 158, 11, 0.2)";
                            e.currentTarget.style.background = "linear-gradient(135deg, var(--accent-amber), #d97706)";
                          }}
                        >
                          + Add Fish
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="telemetry-2x2-grid">
                        {/* Thermal */}
                        <div className="telemetry-tile-premium" style={{ borderLeft: `3px solid ${activeTank.latestLog ? getHslColor(activeTank.latestLog.tempCelsiusX10/10, 22.0, 27.0, 5) : "var(--glass-border)"}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>🌡️ Thermal Chemistry</span>
                            {activeTank.latestLog && (
                              <span className="badge" style={{ 
                                fontSize: "0.55rem", 
                                padding: "0.1rem 0.4rem", 
                                background: `${getHslColor(activeTank.latestLog.tempCelsiusX10/10, 22.0, 27.0, 5)}15`, 
                                color: getHslColor(activeTank.latestLog.tempCelsiusX10/10, 22.0, 27.0, 5),
                                borderColor: getHslColor(activeTank.latestLog.tempCelsiusX10/10, 22.0, 27.0, 5)
                              }}>
                                {activeTank.latestLog.tempCelsiusX10/10 >= 22.0 && activeTank.latestLog.tempCelsiusX10/10 <= 27.0 ? "Ideal" : "Warning"}
                              </span>
                            )}
                          </div>
                          <strong style={{ fontSize: "1.25rem", color: "#fff" }}>
                            {activeTank.latestLog ? (
                              <>
                                {(activeTank.latestLog.tempCelsiusX10 / 10).toFixed(1)}°C
                                <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginLeft: "0.4rem" }}>
                                  / {((activeTank.latestLog.tempCelsiusX10 / 10) * 9 / 5 + 32).toFixed(1)}°F
                                </span>
                              </>
                            ) : "N/A"}
                          </strong>
                          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Ideal range: 22.0°C - 27.0°C</span>
                        </div>

                        {/* pH */}
                        <div className="telemetry-tile-premium" style={{ borderLeft: `3px solid ${activeTank.latestLog ? getHslColor(activeTank.latestLog.phX10/10, 6.5, 8.0, 1.5) : "var(--glass-border)"}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>🧪 Acidic Level (pH)</span>
                            {activeTank.latestLog && (
                              <span className="badge" style={{ 
                                fontSize: "0.55rem", 
                                padding: "0.1rem 0.4rem", 
                                background: `${getHslColor(activeTank.latestLog.phX10/10, 6.5, 8.0, 1.5)}15`, 
                                color: getHslColor(activeTank.latestLog.phX10/10, 6.5, 8.0, 1.5),
                                borderColor: getHslColor(activeTank.latestLog.phX10/10, 6.5, 8.0, 1.5)
                              }}>
                                {activeTank.latestLog.phX10/10 >= 6.5 && activeTank.latestLog.phX10/10 <= 8.0 ? "Ideal" : "Warning"}
                              </span>
                            )}
                          </div>
                          <strong style={{ fontSize: "1.25rem", color: "#fff" }}>
                            {activeTank.latestLog ? (activeTank.latestLog.phX10 / 10).toFixed(1) : "N/A"}
                          </strong>
                          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Ideal range: 6.5 - 8.0 pH</span>
                        </div>
                        {/* Nitrogen */}
                        <div className="telemetry-tile-premium" style={{ 
                          position: "relative",
                          gridColumn: "span 2",
                          borderLeft: `3px solid ${activeTank.latestLog ? (
                            (Number(activeTank.latestLog.ammoniaPpmX100)/100 > 0.05 || Number(activeTank.latestLog.nitritePpmX100)/100 > 0.05) 
                              ? "var(--accent-red)" 
                              : Number(activeTank.latestLog.nitratePpmX100)/100 > 20.0 
                                ? "var(--accent-amber)" 
                                : "var(--accent-green)"
                          ) : "var(--glass-border)"}`
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>🧬 Nitrogen Cycle</span>
                            {activeTank.latestLog && (Number(activeTank.latestLog.ammoniaPpmX100)/100 > 0.05 || Number(activeTank.latestLog.nitritePpmX100)/100 > 0.05) ? (
                              <span className="badge pulsate-red-badge" style={{ fontSize: "0.55rem", padding: "0.1rem 0.4rem" }}>
                                CRITICAL
                              </span>
                            ) : activeTank.latestLog && Number(activeTank.latestLog.nitratePpmX100)/100 > 20.0 ? (
                              <span className="badge badge-amber" style={{ fontSize: "0.55rem", padding: "0.1rem 0.4rem" }}>
                                HIGH NO₃
                              </span>
                            ) : activeTank.latestLog ? (
                              <span className="badge badge-green" style={{ fontSize: "0.55rem", padding: "0.1rem 0.4rem" }}>
                                Safe
                              </span>
                            ) : null}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", fontSize: "0.75rem", color: "var(--text-primary)", marginTop: "0.25rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span>Ammonia:</span>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                                <strong style={{ color: activeTank.latestLog && (activeTank.latestLog.ammoniaPpmX100/100) > 0.05 ? "var(--accent-red)" : "var(--accent-green)" }}>
                                  {activeTank.latestLog ? (activeTank.latestLog.ammoniaPpmX100/100).toFixed(2) : "0.00"} ppm
                                </strong>
                                {activeTank.latestLog && (activeTank.latestLog.ammoniaPpmX100/100) > 0.05 && (
                                  <span className="badge pulsate-red-badge" style={{ fontSize: "0.5rem", padding: "0.05rem 0.25rem" }}>Critical NH₃</span>
                                )}
                              </div>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span>Nitrite:</span>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                                <strong style={{ color: activeTank.latestLog && (activeTank.latestLog.nitritePpmX100/100) > 0.05 ? "var(--accent-red)" : "var(--accent-green)" }}>
                                  {activeTank.latestLog ? (activeTank.latestLog.nitritePpmX100/100).toFixed(2) : "0.00"} ppm
                                </strong>
                                {activeTank.latestLog && (activeTank.latestLog.nitritePpmX100/100) > 0.05 && (
                                  <span className="badge pulsate-red-badge" style={{ fontSize: "0.5rem", padding: "0.05rem 0.25rem" }}>Critical NO₂</span>
                                )}
                              </div>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span>Nitrate:</span>
                              <strong style={{ color: activeTank.latestLog && (activeTank.latestLog.nitratePpmX100/100) > 20 ? "var(--accent-amber)" : "var(--text-primary)" }}>
                                {activeTank.latestLog ? (activeTank.latestLog.nitratePpmX100/100).toFixed(1) : "0.0"} ppm
                              </strong>
                            </div>
                          </div>
                        </div>
                      </div>

                      {getChemistryAlerts(activeTank).length > 0 && (
                        <div className="glass-card" style={{ padding: "0.75rem 1rem", border: "1px solid rgba(248, 113, 113, 0.3)", background: "rgba(248, 113, 113, 0.05)", borderRadius: "var(--radius-sm)" }}>
                          <h4 style={{ color: "var(--accent-red)", fontSize: "0.85rem", marginBottom: "0.25rem" }}>⚠️ Chemistry Safety Warning</h4>
                          <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                            One or more nitrogen compounds exceed safe husbandry levels. High ammonia/nitrites can be fatal to specimens. Perform an immediate 25% water change.
                          </p>
                          <button
                            className="btn-primary"
                            style={{ 
                              marginTop: "0.5rem", 
                              fontSize: "0.75rem", 
                              padding: "0.4rem 0.85rem",
                              background: "linear-gradient(135deg, var(--accent-amber) 0%, #d97706 100%)",
                              border: "none",
                              boxShadow: "0 4px 12px rgba(251, 191, 36, 0.2)",
                              color: "#fff"
                            }}
                            onClick={() => {
                              setFormData({
                                temp: activeTank.latestLog ? (activeTank.latestLog.tempCelsiusX10/10).toString() : "24.5",
                                ph: activeTank.latestLog ? (activeTank.latestLog.phX10/10).toString() : "7.2",
                                salinity: activeTank.latestLog ? (activeTank.latestLog.salinitySgX10000/10000).toString() : "1.0000",
                                ammonia: "0.0",
                                nitrite: "0.0",
                                nitrate: "0.0",
                                notes: "Immediate water change performed."
                              });
                              setQuickLogTankId(activeTank.id.toString());
                              setQuickLogOpen(true);
                            }}
                          >
                            Log Immediate Water Change
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) }
{/* 2.2 FISH SUB-TAB: Fish inside tank — consumer label in Casual mode */}
              {detailSubTab === "fish" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                    <strong style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                      {casualModeActive ? `Fish in this tank (${getSpecimenCount(activeTank)})` : `Registered Birth Certificates (Total: ${getSpecimenCount(activeTank)})`}
                    </strong>
                    <button
                      className="btn-primary"
                      onClick={() => openAddFish(activeTank)}
                      style={{ padding: "0.35rem 0.75rem", fontSize: "0.78rem", whiteSpace: "nowrap" }}
                    >
                      + Add Fish
                    </button>
                  </div>
                  {activeTank.specimens.length === 0 ? (
                    <div style={{ padding: "2rem", textAlign: "center" }}>
                      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
                        {casualModeActive ? "No fish recorded in this tank yet." : "No birth certificates assigned to this containment unit."}
                      </p>
                      <button
                        className="btn-primary"
                        onClick={() => openAddFish(activeTank)}
                        style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}
                      >
                        {casualModeActive ? "+ Add your first fish" : "+ Register first specimen"}
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Click interceptor to dismiss the dropdown when clicking outside */}
                      {activeMenuSpecimenId && (
                        <div 
                          style={{
                            position: "fixed",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            zIndex: 998,
                            background: "transparent",
                            cursor: "default"
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuSpecimenId(null);
                          }}
                        />
                      )}

                      {activeTank.specimens.map(spec => {
                        const matchedSpecies = fishbaseData.find(f => Number(f.speciesId) === Number(spec.speciesId));
                        const masterPhotoUrl = matchedSpecies?.masterPhotoUrl || "";
                        const customPhoto = localStorage.getItem(`aquadex_specimen_photo_${spec.id}`);
                        const finalImgSrc = customPhoto || masterPhotoUrl;
                        const displayScientificName = spec.scientificName || matchedSpecies?.scientificName || "";

                        return (
                          <div 
                            key={spec.id} 
                            onClick={() => onSelectSpecimen && onSelectSpecimen(spec.id)}
                            draggable="true"
                            onDragStart={(e) => {
                              e.dataTransfer.setData("application/aquadex-specimen", spec.id.toString());
                              e.dataTransfer.effectAllowed = "move";
                              e.currentTarget.style.opacity = "0.5";
                            }}
                            onDragEnd={(e) => {
                              e.currentTarget.style.opacity = "1";
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.transform = "translateY(-1px)";
                              e.currentTarget.style.background = casualModeActive 
                                ? "linear-gradient(135deg, rgba(14, 165, 233, 0.08) 0%, rgba(14, 165, 233, 0.02) 100%)" 
                                : "rgba(255, 255, 255, 0.04)";
                              e.currentTarget.style.borderColor = casualModeActive 
                                ? "rgba(56, 189, 248, 0.3)" 
                                : "rgba(255, 255, 255, 0.15)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = "translateY(0)";
                              e.currentTarget.style.background = casualModeActive 
                                ? "linear-gradient(135deg, rgba(14, 165, 233, 0.04) 0%, rgba(14, 165, 233, 0.01) 100%)" 
                                : "rgba(0,0,0,0.2)";
                              e.currentTarget.style.borderColor = casualModeActive 
                                ? "rgba(56, 189, 248, 0.15)" 
                                : "var(--glass-border)";
                            }}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: casualModeActive ? "0.75rem 1rem" : "0.6rem 0.75rem",
                              background: casualModeActive 
                                ? "linear-gradient(135deg, rgba(14, 165, 233, 0.04) 0%, rgba(14, 165, 233, 0.01) 100%)" 
                                : "rgba(0,0,0,0.2)",
                              borderRadius: casualModeActive ? "12px" : "8px",
                              border: casualModeActive ? "1px solid rgba(56,189,248,0.15)" : "1px solid var(--glass-border)",
                              fontSize: "0.85rem",
                              cursor: "grab",
                              transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                              gap: "0.75rem",
                              marginBottom: "0.5rem",
                              position: "relative"
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flex: 1, minWidth: 0 }}>
                              {/* Fish Avatar / Image */}
                              {finalImgSrc ? (
                                <img 
                                  src={finalImgSrc} 
                                  alt={spec.commonName}
                                  style={{
                                    width: "44px",
                                    height: "44px",
                                    borderRadius: "8px",
                                    objectFit: "cover",
                                    border: "1px solid rgba(255, 255, 255, 0.1)",
                                    flexShrink: 0
                                  }}
                                />
                              ) : (
                                <div style={{
                                  width: "44px",
                                  height: "44px",
                                  borderRadius: "8px",
                                  background: "linear-gradient(135deg, rgba(56, 189, 248, 0.1), rgba(14, 165, 233, 0.2))",
                                  border: "1px solid rgba(56, 189, 248, 0.2)",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: "1.2rem",
                                  flexShrink: 0
                                }}>
                                  🐠
                                </div>
                              )}
                              
                              <div style={{ minWidth: 0, flex: 1 }}>
                                {!casualModeActive && (
                                  <strong style={{ color: "var(--accent-blue)", display: "block", fontSize: "0.75rem" }}>
                                    Cert. Serial No. {spec.id.toString().padStart(3, "0")}
                                  </strong>
                                )}
                                <span style={{ color: "#fff", fontWeight: "600", display: "inline-flex", alignItems: "center", gap: "0.4rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{spec.commonName}</span>
                                  {spec.gender && spec.gender !== "Not Sure" && (
                                    <span style={{
                                      fontSize: "0.6rem",
                                      padding: "0.05rem 0.35rem",
                                      borderRadius: "4px",
                                      background: spec.gender === "Male" ? "rgba(56, 189, 248, 0.15)" : "rgba(244, 63, 94, 0.15)",
                                      color: spec.gender === "Male" ? "#38bdf8" : "#f43f5e",
                                      border: spec.gender === "Male" ? "1px solid rgba(56, 189, 248, 0.25)" : "1px solid rgba(244, 63, 94, 0.25)",
                                      fontWeight: "600",
                                      flexShrink: 0
                                    }}>
                                      {spec.gender === "Male" ? "♂" : "♀"}
                                    </span>
                                  )}
                                </span>
                                <span style={{ display: "block", fontSize: "0.7rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: displayScientificName ? "italic" : "normal" }}>
                                  {casualModeActive ? (displayScientificName || "Unknown species") : displayScientificName}
                                </span>
                                {casualModeActive && spec.careLevel !== undefined && (
                                  <span style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "0.2rem",
                                    marginTop: "0.25rem",
                                    fontSize: "0.6rem",
                                    padding: "0.05rem 0.35rem",
                                    borderRadius: "20px",
                                    background: "rgba(34, 197, 94, 0.12)",
                                    border: "1px solid rgba(34, 197, 94, 0.3)",
                                    color: "#4ade80"
                                  }}>
                                    ✓ Registry Verified
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Action buttons */}
                            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                              {casualModeActive ? (
                                <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveMenuSpecimenId(activeMenuSpecimenId === spec.id ? null : spec.id);
                                    }}
                                    style={{
                                      background: activeMenuSpecimenId === spec.id ? "rgba(56, 189, 248, 0.15)" : "rgba(255, 255, 255, 0.05)",
                                      border: activeMenuSpecimenId === spec.id ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid rgba(255, 255, 255, 0.08)",
                                      borderRadius: "8px",
                                      width: "32px",
                                      height: "32px",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      color: activeMenuSpecimenId === spec.id ? "#38bdf8" : "rgba(255, 255, 255, 0.8)",
                                      cursor: "pointer",
                                      fontSize: "0.85rem",
                                      transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                                      padding: 0
                                    }}
                                    title="Actions"
                                    onMouseEnter={(e) => {
                                      if (activeMenuSpecimenId !== spec.id) {
                                        e.currentTarget.style.background = "rgba(56, 189, 248, 0.15)";
                                        e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.3)";
                                        e.currentTarget.style.color = "#38bdf8";
                                      }
                                    }}
                                    onMouseLeave={(e) => {
                                      if (activeMenuSpecimenId !== spec.id) {
                                        e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
                                        e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.08)";
                                        e.currentTarget.style.color = "rgba(255, 255, 255, 0.8)";
                                      }
                                    }}
                                  >
                                    •••
                                  </button>

                                  {activeMenuSpecimenId === spec.id && (
                                    <div style={{
                                      position: "absolute",
                                      right: 0,
                                      top: "calc(100% + 6px)",
                                      background: "rgba(10, 25, 47, 0.96)",
                                      backdropFilter: "blur(16px)",
                                      WebkitBackdropFilter: "blur(16px)",
                                      border: "1px solid rgba(56, 189, 248, 0.25)",
                                      borderRadius: "10px",
                                      padding: "0.4rem",
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: "0.2rem",
                                      boxShadow: "0 12px 30px -4px rgba(0, 0, 0, 0.7), 0 0 15px rgba(56, 189, 248, 0.15)",
                                      zIndex: 1000,
                                      minWidth: "160px"
                                    }}>
                                      {/* Add/Update Photo Button */}
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setActiveMenuSpecimenId(null);
                                          setUploadingSpecimenId(spec.id);
                                          setTimeout(() => specimenPhotoInputRef.current?.click(), 50);
                                        }}
                                        style={{
                                          background: "none",
                                          border: "none",
                                          borderRadius: "6px",
                                          color: "#fff",
                                          padding: "0.5rem 0.6rem",
                                          fontSize: "0.78rem",
                                          textAlign: "left",
                                          cursor: "pointer",
                                          transition: "all 0.15s ease",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "0.5rem"
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.background = "none";
                                        }}
                                      >
                                        <span style={{ fontSize: "0.95rem" }}>📷</span> {customPhoto ? "Update Photo" : "Add Photo"}
                                      </button>

                                      {/* List for Sale Button */}
                                      {onListOnMarketplace && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setActiveMenuSpecimenId(null);
                                            onListOnMarketplace(activeTank, spec);
                                          }}
                                          style={{
                                            background: "none",
                                            border: "none",
                                            borderRadius: "6px",
                                            color: "#38bdf8",
                                            padding: "0.5rem 0.6rem",
                                            fontSize: "0.78rem",
                                            textAlign: "left",
                                            cursor: "pointer",
                                            transition: "all 0.15s ease",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem"
                                          }}
                                          onMouseEnter={(e) => {
                                            e.currentTarget.style.background = "rgba(56, 189, 248, 0.12)";
                                          }}
                                          onMouseLeave={(e) => {
                                            e.currentTarget.style.background = "none";
                                          }}
                                        >
                                          <span style={{ fontSize: "0.95rem" }}>💼</span> List for Sale
                                        </button>
                                      )}

                                      {/* Say Farewell Button */}
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setActiveMenuSpecimenId(null);
                                          setFarewellSpecimen(spec);
                                        }}
                                        style={{
                                          background: "none",
                                          border: "none",
                                          borderRadius: "6px",
                                          color: "#f43f5e",
                                          padding: "0.5rem 0.6rem",
                                          fontSize: "0.78rem",
                                          textAlign: "left",
                                          cursor: "pointer",
                                          transition: "all 0.15s ease",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "0.5rem"
                                        }}
                                        onMouseEnter={(e) => {
                                          e.currentTarget.style.background = "rgba(244, 63, 94, 0.12)";
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.background = "none";
                                        }}
                                      >
                                        <span style={{ fontSize: "0.95rem" }}>🌊</span> Farewell / Release
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <>
                                  <button 
                                    className="btn-secondary"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onViewLineage(spec.id);
                                    }}
                                    style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", minHeight: "32px" }}
                                  >
                                    Ancestry
                                  </button>
                                  {onListOnMarketplace && (
                                    <button 
                                      className="btn-primary"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onListOnMarketplace(activeTank, spec);
                                      }}
                                      style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", minHeight: "32px" }}
                                    >
                                      Sell
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}

              {/* 2.3 ACTIVITY / HISTORY SUB-TAB: Action logs + water parameter logs */}
              {detailSubTab === "history" && (
                <ActivityLog
                  onChainLogs={activeTank.logs || []}
                  actionLogs={localActionLogs}
                  casualModeActive={casualModeActive}
                />
              )}

              {/* 2.4 NOTES SUB-TAB: Freeform tank notes editor */}
              {detailSubTab === "notes" && (
                <NotesTab tankId={activeTank.id} />
              )}

              {/* 2.5 SOCIAL SUB-TAB: Tank Progress Social Feed */}
              {detailSubTab === "social" && (() => {
                const isHatched = companionData && companionData.eggState >= 2;
                const safeLogs = Array.isArray(activeTank.logs) ? activeTank.logs : [];
                let tempVal = "24.5°C";
                let phVal = "7.2 pH";
                if (safeLogs.length > 0) {
                  const lastLog = [...safeLogs].sort((a,b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0];
                  const tempRaw = lastLog.tempCelsiusX10 !== undefined ? Number(lastLog.tempCelsiusX10) : (lastLog.temp !== undefined ? Number(lastLog.temp) : 245);
                  const phRaw = lastLog.phX10 !== undefined ? Number(lastLog.phX10) : (lastLog.ph !== undefined ? Number(lastLog.ph) : 72);
                  tempVal = `${(tempRaw / 10).toFixed(1)}°C`;
                  phVal = `${(phRaw / 10).toFixed(1)} pH`;
                }
                const specCount = getSpecimenCount(activeTank);

                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    {/* Share on The Reef CTA */}
                    <div style={{
                      padding: "0.75rem 1rem",
                      borderRadius: "10px",
                      background: "rgba(56, 189, 248, 0.04)",
                      border: "1px solid rgba(56, 189, 248, 0.12)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "0.75rem",
                    }}>
                      <div>
                        <p style={{ margin: 0, fontSize: "0.8rem", color: "#fff", fontWeight: 500 }}>
                          {casualModeActive ? "🪸 Share this tank on The Reef" : "Post to Social Feed"}
                        </p>
                        <p style={{ margin: "0.15rem 0 0", fontSize: "0.65rem", color: "var(--text-muted)" }}>
                          {casualModeActive ? "Show other fishkeepers your setup" : "Publish a Tank Current with parameters"}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          // In both modes, clicking "Post Current" sets category to Telemetry
                          setComposerCategory("telemetry");
                          
                          // Pre-fill telemetry report
                          const reportText = `📊 TELEMETRY Snapshot: Operating stable. Parameters: Temp: ${tempVal}, pH: ${phVal}. Total specimens registered: ${specCount}.`;
                          setCommentText(reportText);
                          setCommenterRole(casualModeActive || !isHatched ? "hobbyist" : "breeder");
                          
                          showToast("📋 Pre-filled parameter snapshot in telemetry deck!");
                          setTimeout(() => commentInputRef.current?.focus(), 100);
                        }}
                        style={{
                          padding: "0.4rem 0.8rem",
                          borderRadius: "8px",
                          border: "none",
                          background: "linear-gradient(135deg, #0ea5e9, #0369a1)",
                          color: "#fff",
                          fontSize: "0.7rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        Post Current
                      </button>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Tank Progress Social Feed</strong>
                      <span className="badge badge-blue">{(tankComments[activeTank.id] || []).length} Updates</span>
                    </div>

                    {/* Comment list */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "250px", overflowY: "auto", paddingRight: "4px" }}>
                      {(!tankComments[activeTank.id] || tankComments[activeTank.id].length === 0) ? (
                        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "2rem", textAlign: "center" }}>No social updates or expert audits yet.</p>
                      ) : (
                        tankComments[activeTank.id].map((comment, idx) => {
                          const isExpert = comment.isExpertAudit || comment.category === "lab-audit";
                          
                          let badgeColor = "var(--text-secondary)";
                          let badgeBg = "rgba(255, 255, 255, 0.05)";
                          let badgeBorder = "1px solid var(--glass-border)";
                          let badgeLabel = "Hobbyist";

                          if (isExpert) {
                            badgeColor = "#ffd700";
                            badgeBg = "rgba(255, 215, 0, 0.15)";
                            badgeBorder = "1px solid #ffd700";
                            badgeLabel = "⭐ Verified Master Breeder";
                          } else if (comment.role === "hobbyist") {
                            badgeColor = "var(--text-secondary)";
                            badgeBg = "rgba(255, 255, 255, 0.05)";
                            badgeBorder = "1px solid var(--glass-border)";
                            badgeLabel = "Hobbyist";
                          } else {
                            // Breeder tiers
                            let tier = "bronze";
                            if (typeof comment.role === "string" && comment.role.endsWith("-breeder")) {
                              tier = comment.role.split("-")[0];
                            }
                            const colorMap = {
                              bronze: "#cd7f32",
                              silver: "#c0c0c0",
                              gold: "#ffd700",
                              master: "#a855f7",
                              god: "#f43f5e"
                            };
                            const bgMap = {
                              bronze: "rgba(205, 127, 50, 0.15)",
                              silver: "rgba(192, 192, 192, 0.15)",
                              gold: "rgba(255, 215, 0, 0.15)",
                              master: "rgba(168, 85, 247, 0.15)",
                              god: "rgba(244, 63, 94, 0.15)"
                            };
                            const color = colorMap[tier] || "#a855f7";
                            badgeColor = color;
                            badgeBg = bgMap[tier] || "rgba(168, 85, 247, 0.15)";
                            badgeBorder = `1px solid ${color}44`;
                            badgeLabel = `${tier.charAt(0).toUpperCase() + tier.slice(1)} Breeder`;
                          }

                          const cardStyle = isExpert ? {
                            padding: "0.85rem",
                            borderRadius: "8px",
                            background: "rgba(255, 215, 0, 0.03)",
                            border: "1px solid #ffd700",
                            boxShadow: "0 0 10px #ffd700, inset 0 0 5px #ffd700",
                            transition: "all 0.3s ease"
                          } : {
                            padding: "0.75rem",
                            borderRadius: "8px",
                            background: "rgba(255, 255, 255, 0.02)",
                            border: "1px solid var(--glass-border)"
                          };

                          return (
                            <div key={idx} style={cardStyle}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                  <strong style={{ fontSize: "0.8rem", color: isExpert ? "#ffd700" : "var(--accent-blue)" }}>
                                    {comment.author.slice(0, 6)}...{comment.author.slice(-4)}
                                  </strong>
                                  <span className="badge" style={{
                                    fontSize: "0.6rem",
                                    padding: "0.1rem 0.35rem",
                                    background: badgeBg,
                                    color: badgeColor,
                                    border: badgeBorder
                                  }}>
                                    {badgeLabel}
                                  </span>
                                  {comment.category && comment.category !== "observation" && (
                                    <span style={{
                                      fontSize: "0.6rem",
                                      padding: "0.1rem 0.35rem",
                                      borderRadius: "4px",
                                      background: "rgba(255,255,255,0.03)",
                                      border: "1px solid rgba(255,255,255,0.08)",
                                      color: "var(--text-muted)",
                                      textTransform: "uppercase"
                                    }}>
                                      {comment.category === "telemetry" ? "🌡️ Telemetry" : comment.category === "spawning" ? "🍼 Spawn" : "🔬 Audit"}
                                    </span>
                                  )}
                                </div>
                                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                                  {getRelativeTime(comment.timestamp)}
                                </span>
                              </div>
                              <p style={{ fontSize: "0.85rem", color: isExpert ? "#fff" : "var(--text-primary)", lineHeight: "1.35", margin: 0 }}>
                                {comment.text}
                              </p>
                              {comment.telemetry && (
                                <div className="feed-telemetry-badge" style={{ marginTop: "0.5rem" }}>
                                  <span>🌡️ Temp: {comment.telemetry.temp}</span>
                                  <span style={{ opacity: 0.3 }}>|</span>
                                  <span>🧪 pH: {comment.telemetry.ph}</span>
                                  <span style={{ opacity: 0.3 }}>|</span>
                                  <span>🐟 Population: {comment.telemetry.specimens}</span>
                                </div>
                              )}
                              {comment.spawning && (
                                <div className="feed-spawn-badge" style={{ marginTop: "0.5rem" }}>
                                  <span>🥚 Spawning Log: {comment.spawning.clutchSize} Eggs / Fry</span>
                                  <span style={{ opacity: 0.3 }}>|</span>
                                  <span>Stage: {comment.spawning.stage}</span>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Comment input form */}
                    <form onSubmit={handleCommentSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", borderTop: "1px solid var(--glass-border)", paddingTop: "0.75rem" }}>
                      
                      {/* Composer Category Tabs */}
                      <div className="composer-category-tabs">
                        <button
                          type="button"
                          className={`composer-tab-btn ${composerCategory === "observation" ? "active" : ""}`}
                          onClick={() => {
                            setComposerCategory("observation");
                            setCommentText("");
                          }}
                        >
                          📝 Note
                        </button>
                        <button
                          type="button"
                          className={`composer-tab-btn ${composerCategory === "telemetry" ? "active" : ""}`}
                          onClick={() => {
                            setComposerCategory("telemetry");
                            const reportText = `📊 TELEMETRY Snapshot: Operating stable. Parameters: Temp: ${tempVal}, pH: ${phVal}. Total specimens registered: ${specCount}.`;
                            setCommentText(reportText);
                          }}
                        >
                          🌡️ Telemetry
                        </button>
                        <button
                          type="button"
                          className={`composer-tab-btn ${composerCategory === "spawning" ? "active" : ""}`}
                          onClick={() => {
                            setComposerCategory("spawning");
                            const spText = `🥚 SPAWNING EVENT: Spawn log recorded.`;
                            setCommentText(spText);
                          }}
                        >
                          🍼 Spawning
                        </button>
                        <button
                          type="button"
                          className={`composer-tab-btn ${composerCategory === "lab-audit" ? "active" : ""} ${(!casualModeActive && (companionData?.currentTier === "Master" || companionData?.currentTier === "God-Tier")) ? "" : "disabled"}`}
                          onClick={() => {
                            if (!casualModeActive && (companionData?.currentTier === "Master" || companionData?.currentTier === "God-Tier")) {
                              setComposerCategory("lab-audit");
                              const auditText = `🔬 EXPERT LAB AUDIT: Verified water parameter chemistry. Parameters are stable. Spawning conditions optimized.`;
                              setCommentText(auditText);
                            } else {
                              showToast("🔒 Lab Audit requires Master Breeder Rank!");
                            }
                          }}
                        >
                          {(!casualModeActive && (companionData?.currentTier === "Master" || companionData?.currentTier === "God-Tier")) ? "🔬 Lab Audit" : "🔒 Lab Audit"}
                        </button>
                      </div>

                      {/* Telemetry Live Preview Widget */}
                      {composerCategory === "telemetry" && (
                        <div className="telemetry-preview-card">
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 500 }}>
                            📊 Parameter Attachment Preview
                          </span>
                          <div className="telemetry-preview-pills">
                            <span className="telemetry-preview-pill">🌡️ Temp: {tempVal}</span>
                            <span className="telemetry-preview-pill">🧪 pH: {phVal}</span>
                            <span className="telemetry-preview-pill">🐟 Pop: {specCount} Specimens</span>
                          </div>
                        </div>
                      )}

                      {/* Spawning Milestone Widget */}
                      {composerCategory === "spawning" && (
                        <div style={{
                          display: "flex",
                          gap: "0.75rem",
                          alignItems: "center",
                          padding: "0.5rem 0.75rem",
                          background: "rgba(168, 85, 247, 0.03)",
                          border: "1px dashed rgba(168, 85, 247, 0.25)",
                          borderRadius: "6px"
                        }}>
                          <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Clutch Size:</label>
                            <input
                              type="number"
                              value={spawnClutchSize}
                              onChange={(e) => setSpawnClutchSize(e.target.value)}
                              placeholder="e.g. 150"
                              style={{
                                width: "65px",
                                padding: "0.2rem 0.4rem",
                                background: "rgba(0,0,0,0.35)",
                                border: "1px solid var(--glass-border)",
                                color: "#fff",
                                borderRadius: "4px",
                                fontSize: "0.75rem",
                                outline: "none"
                              }}
                            />
                          </div>
                          <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                            <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Stage:</label>
                            <select
                              value={spawnStage}
                              onChange={(e) => setSpawnStage(e.target.value)}
                              style={{
                                padding: "0.2rem 0.4rem",
                                background: "rgba(0,0,0,0.35)",
                                border: "1px solid var(--glass-border)",
                                color: "#fff",
                                borderRadius: "4px",
                                fontSize: "0.75rem",
                                outline: "none",
                                cursor: "pointer"
                              }}
                            >
                              <option value="Eggs">🥚 Eggs</option>
                              <option value="Fry">🍼 Fry</option>
                              <option value="Juveniles">🐠 Juveniles</option>
                              <option value="Evolved">🧬 Evolved</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {residingSpecies.length > 0 && (
                        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.15rem", alignItems: "center" }}>
                          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Tap to add species:</span>
                          {residingSpecies.map(sp => (
                            <button
                              key={sp.speciesId}
                              type="button"
                              onClick={() => {
                                setCommentText(prev => prev ? `${prev} ${sp.commonName}` : sp.commonName);
                              }}
                              style={{
                                padding: "0.2rem 0.5rem",
                                fontSize: "0.65rem",
                                background: "rgba(168, 85, 247, 0.12)",
                                border: "1px solid rgba(168, 85, 247, 0.3)",
                                color: "#a855f7",
                                borderRadius: "20px",
                                cursor: "pointer"
                              }}
                            >
                              🐠 {sp.commonName}
                            </button>
                          ))}
                        </div>
                      )}

                      <div>
                        <textarea
                          ref={commentInputRef}
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          placeholder={composerCategory === "telemetry" ? "Describe your parameters stability..." : composerCategory === "spawning" ? "Describe spawning details..." : "Share a progress update or observation..."}
                          rows="2"
                          required
                          style={{
                            width: "100%",
                            padding: "0.5rem",
                            background: "rgba(255, 255, 255, 0.03)",
                            border: "1px solid var(--glass-border)",
                            color: "#fff",
                            borderRadius: "4px",
                            fontSize: "0.8rem",
                            resize: "none"
                          }}
                        />
                      </div>

                      {/* Broadcast to Reef Toggle */}
                      <div className="broadcast-toggle-container">
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={{ fontSize: "0.75rem", color: "#fff", fontWeight: 500 }}>Broadcast to The Reef 🪸</span>
                          <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Publish globally to other breeders</span>
                        </div>
                        <label className="broadcast-switch">
                          <input
                            type="checkbox"
                            checked={broadcastToReef}
                            onChange={(e) => setBroadcastToReef(e.target.checked)}
                          />
                          <span className="broadcast-slider"></span>
                        </label>
                      </div>

                      {/* Role selection and publish button */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "1rem", flexWrap: "wrap" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                          <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>Post observation as:</span>
                          <div className="role-chip-group">
                            <div
                              className={`role-chip hobbyist ${commenterRole === "hobbyist" ? "active" : ""}`}
                              onClick={() => setCommenterRole("hobbyist")}
                            >
                              🧑‍🌾 Casual Hobbyist
                            </div>
                            
                            {(!casualModeActive && isHatched) ? (
                              <div
                                className={`role-chip ${companionData?.currentTier?.toLowerCase() || "bronze"} ${commenterRole === "breeder" ? "active" : ""}`}
                                onClick={() => setCommenterRole("breeder")}
                              >
                                🧬 {companionData?.currentTier || "Bronze"} Breeder
                              </div>
                            ) : (
                              <div
                                className="role-chip disabled"
                                title="Unlocks when companion hatches in Pro Mode"
                                onClick={() => showToast("🔒 Breeder identity unlocks when your Breeder Companion hatches!")}
                              >
                                🔒 Breeder
                              </div>
                            )}

                            {(!casualModeActive && (companionData?.currentTier === "Master" || companionData?.currentTier === "God-Tier")) ? (
                              <div
                                className={`role-chip master ${commenterRole === "master-breeder" ? "active" : ""}`}
                                onClick={() => setCommenterRole("master-breeder")}
                              >
                                ⭐ Verified Master Breeder
                              </div>
                            ) : (
                              <div
                                className="role-chip disabled"
                                title="Requires Master Rank (10,000+ Companion XP)"
                                onClick={() => showToast("🔒 Verified Master Breeder rank requires 10,000+ Companion XP!")}
                              >
                                🔒 Master Breeder
                              </div>
                            )}
                          </div>
                        </div>

                        <button
                          type="submit"
                          className="btn-primary"
                          style={{ padding: "0.4rem 1rem", fontSize: "0.75rem", borderRadius: "6px", height: "32px" }}
                        >
                          Publish Update
                        </button>
                      </div>
                    </form>
                  </div>
                );
              })()}
            </div>
          </div>
          </>
        )}
      </div>

      {/* 3. SIMULATED CAMERA SCANNER DIALOG */}
      {scannerOpen && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.85)",
          backdropFilter: "blur(12px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2000,
          padding: "1rem"
        }}>
          <div className="glass-card" style={{
            width: "100%",
            maxWidth: "400px",
            padding: "2rem",
            background: "var(--bg-secondary)",
            textAlign: "center",
            border: "1px solid var(--accent-blue)"
          }}>
            <h3 style={{ color: "#fff", marginBottom: "1rem" }}>📸 Barcode / QR Tag Scanner</h3>
            
            <div style={{ 
              width: "240px", 
              height: "240px", 
              margin: "0 auto 1.5rem", 
              border: "2px solid var(--accent-blue)", 
              borderRadius: "16px",
              position: "relative",
              overflow: "hidden",
              background: "rgba(0,0,0,0.5)"
            }}>
              {/* Laser scanner line effect */}
              {scanning && (
                <div style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  height: "3px",
                  background: "var(--accent-blue)",
                  boxShadow: "0 0 10px var(--accent-blue)",
                  top: 0,
                  animation: "scanner-sweep 2s linear infinite"
                }}></div>
              )}
              
              <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "0.5rem" }}>
                <span style={{ fontSize: "2rem" }}>📷</span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  {scanning ? "Detecting containment QR identifier..." : "Decoding..."}
                </span>
              </div>
            </div>

            {scanResult && (
              <div style={{ padding: "0.75rem", background: "var(--accent-blue-glow)", borderRadius: "8px", fontSize: "0.85rem", color: "var(--accent-blue)" }}>
                <strong>Linked Unit:</strong> {scanResult}
              </div>
            )}

            <button 
              className="btn-secondary" 
              onClick={() => setScannerOpen(false)}
              style={{ width: "100%", marginTop: "1rem" }}
            >
              Cancel Scan
            </button>
          </div>
        </div>
      )}

      {/* 3.5 ADD FISH SLIDING DRAWER */}
      {addFishOpen && (
        <div className="sliding-drawer-backdrop" onClick={() => setAddFishOpen(false)}>
          <div className="sliding-drawer-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.05rem", color: "#fff" }}>
                {casualModeActive ? "🐟 Add Fish to Tank" : "🐟 Register Specimen"}
              </h3>
              <button
                onClick={() => { setAddFishOpen(false); setAddFishError(null); }}
                style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "1.5rem", cursor: "pointer", lineHeight: 1 }}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {addFishError && (
              <div style={{ padding: "0.6rem 0.75rem", marginBottom: "1rem", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "6px", color: "#fca5a5", fontSize: "0.8rem" }}>
                {addFishError}
              </div>
            )}

            <form onSubmit={handleAddFishSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                  Search species
                </label>
                <input
                  type="text"
                  value={addFishSearch}
                  onChange={(e) => setAddFishSearch(e.target.value)}
                  placeholder="Type a common or scientific name..."
                  style={{ width: "100%", padding: "0.75rem", background: "rgba(8,12,20,0.9)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                />
              </div>

              <div style={{ maxHeight: "300px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {contractSpecies.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", padding: "1rem", textAlign: "center" }}>
                    No registered species found in the catalog yet.
                  </p>
                ) : (
                  contractSpecies
                    .filter(s => {
                      const q = addFishSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (s.commonName || "").toLowerCase().includes(q) ||
                             (s.scientificName || "").toLowerCase().includes(q);
                    })
                    .slice(0, 50)
                    .map(s => {
                      const selected = String(s.speciesId) === String(addFishSpeciesId);
                      return (
                        <button
                          type="button"
                          key={s.speciesId}
                          onClick={() => setAddFishSpeciesId(String(s.speciesId))}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            textAlign: "left",
                            padding: "0.6rem 0.75rem",
                            background: selected ? "rgba(56,189,248,0.15)" : "rgba(0,0,0,0.2)",
                            border: selected ? "1px solid var(--accent-blue)" : "1px solid var(--glass-border)",
                            borderRadius: "6px",
                            cursor: "pointer",
                            color: "#fff"
                          }}
                        >
                          <span>
                            <strong style={{ fontSize: "0.85rem" }}>{s.commonName}</strong>
                            <span style={{ display: "block", fontSize: "0.7rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                              {s.scientificName}
                            </span>
                          </span>
                          {selected && <span style={{ color: "var(--accent-blue)", fontSize: "1.1rem" }}>✓</span>}
                        </button>
                      );
                    })
                )}
              </div>

              <div style={{ display: "flex", gap: "1rem", marginTop: "0.25rem" }}>
                {/* Quantity */}
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                    Quantity
                  </label>
                  <div style={{ display: "flex", alignItems: "center", background: "rgba(0,0,0,0.2)", border: "1px solid var(--glass-border)", borderRadius: "6px", overflow: "hidden", height: "42px" }}>
                    <button
                      type="button"
                      onClick={() => setAddFishQty(prev => Math.max(1, prev - 1))}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#fff",
                        width: "36px",
                        height: "100%",
                        cursor: "pointer",
                        fontSize: "1.1rem",
                        fontWeight: "600",
                        transition: "background 0.2s"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={addFishQty}
                      onChange={(e) => setAddFishQty(Math.max(1, parseInt(e.target.value) || 1))}
                      style={{
                        flex: 1,
                        background: "none",
                        border: "none",
                        color: "#fff",
                        textAlign: "center",
                        fontSize: "0.9rem",
                        fontWeight: "600",
                        outline: "none",
                        width: "100%"
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setAddFishQty(prev => prev + 1)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#fff",
                        width: "36px",
                        height: "100%",
                        cursor: "pointer",
                        fontSize: "1.1rem",
                        fontWeight: "600",
                        transition: "background 0.2s"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Gender */}
                <div style={{ flex: 1.2 }}>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                    Gender
                  </label>
                  <div style={{ display: "flex", background: "rgba(0,0,0,0.2)", border: "1px solid var(--glass-border)", borderRadius: "6px", padding: "2px", height: "42px" }}>
                    {["Male", "Female", "Not Sure"].map((g) => {
                      const sel = addFishGender === g;
                      return (
                        <button
                          type="button"
                          key={g}
                          onClick={() => setAddFishGender(g)}
                          style={{
                            flex: 1,
                            background: sel ? (g === "Male" ? "rgba(56, 189, 248, 0.18)" : g === "Female" ? "rgba(244, 63, 94, 0.18)" : "rgba(255, 255, 255, 0.1)") : "none",
                            border: "none",
                            borderRadius: "4px",
                            color: sel ? (g === "Male" ? "#38bdf8" : g === "Female" ? "#f43f5e" : "#fff") : "var(--text-secondary)",
                            fontSize: "0.72rem",
                            fontWeight: "600",
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "0.2rem"
                          }}
                        >
                          <span>{g === "Male" ? "♂" : g === "Female" ? "♀" : "⚪"}</span>
                          <span>{g}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={addFishSubmitting || !addFishSpeciesId}
                style={{ padding: "0.75rem", fontSize: "0.9rem", opacity: (addFishSubmitting || !addFishSpeciesId) ? 0.6 : 1 }}
              >
                {addFishSubmitting
                  ? (casualModeActive ? "Adding..." : "Registering...")
                  : (casualModeActive ? "Add to Tank" : "Register Birth Certificate")}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 4. QUICK LOG SLIDING DRAWER CONTAINER */}
      {quickLogOpen && (
        <div className="sliding-drawer-backdrop" onClick={() => setQuickLogOpen(false)}>
          <div className="sliding-drawer-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h3 style={{ fontSize: "1.5rem", color: "#fff" }}>
                {bulkLogScope === "single" ? "Quick Log Water Test" : `Bulk ${BULK_ACTION_LABELS[bulkLogAction]?.label || "Action"}`}
              </h3>
              <button 
                onClick={() => {
                  setQuickLogOpen(false);
                  setModalError(null);
                  setTxHash(null);
                  setBulkLogResult(null);
                  setBulkLogScope("single");
                }} 
                style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "1.5rem", cursor: "pointer", minWidth: "44px", minHeight: "44px" }}
                aria-label="Close quick log"
              >
                &times;
              </button>
            </div>

            {/* ── SCOPE SELECTOR ── */}
            <div style={{ marginBottom: "1.25rem" }}>
              <span style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem", fontWeight: "600" }}>
                Log Scope
              </span>
              <div style={{ display: "flex", gap: "0.35rem", background: "rgba(255,255,255,0.02)", padding: "0.25rem", borderRadius: "8px", border: "1px solid var(--glass-border)" }}>
                {[
                  { key: "single", label: "Single Tank" },
                  { key: "rack",   label: "Entire Rack" },
                  { key: "room",   label: "Entire Room" },
                ].map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => { setBulkLogScope(opt.key); setBulkLogResult(null); }}
                    style={{
                      flex: 1,
                      padding: "0.4rem 0.5rem",
                      fontSize: "0.75rem",
                      fontWeight: "600",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      background: bulkLogScope === opt.key ? "rgba(56, 189, 248, 0.18)" : "transparent",
                      color: bulkLogScope === opt.key ? "var(--accent-blue)" : "var(--text-muted)",
                      transition: "all 0.15s ease"
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── BULK ACTION PANEL (rack / room scope) ── */}
            {bulkLogScope !== "single" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

                {/* Target selector */}
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                    {bulkLogScope === "rack" ? "Target Rack" : "Target Room"}
                  </label>
                  <select
                    value={bulkLogScope === "rack" ? bulkRackTarget : bulkRoomTarget}
                    onChange={(e) => bulkLogScope === "rack" ? setBulkRackTarget(e.target.value) : setBulkRoomTarget(e.target.value)}
                    style={{ width: "100%", padding: "0.75rem", background: "rgba(8,12,20,0.9)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                  >
                    {(bulkLogScope === "rack" ? uniqueRacks : uniqueRooms).map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                  {/* Affected unit count badge */}
                  {(() => {
                    const count = getBulkTargetTanks().length;
                    return count > 0 ? (
                      <span style={{ display: "inline-block", marginTop: "0.4rem", fontSize: "0.7rem", color: "var(--accent-green)", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: "20px", padding: "0.1rem 0.6rem" }}>
                        {count} unit{count !== 1 ? "s" : ""} will be logged
                      </span>
                    ) : (
                      <span style={{ display: "inline-block", marginTop: "0.4rem", fontSize: "0.7rem", color: "var(--text-muted)" }}>
                        No units found for this selection
                      </span>
                    );
                  })()}
                </div>

                {/* Action type selector */}
                <div>
                  <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}>Action Type</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
                    {Object.entries(BULK_ACTION_LABELS).map(([key, { emoji, label }]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => { setBulkLogAction(key); setBulkLogDetail(""); }}
                        style={{
                          padding: "0.6rem 0.75rem",
                          fontSize: "0.8rem",
                          fontWeight: "600",
                          border: "1px solid",
                          borderRadius: "6px",
                          cursor: "pointer",
                          textAlign: "left",
                          background: bulkLogAction === key ? "rgba(56, 189, 248, 0.12)" : "rgba(255,255,255,0.02)",
                          borderColor: bulkLogAction === key ? "rgba(56, 189, 248, 0.4)" : "var(--glass-border)",
                          color: bulkLogAction === key ? "var(--accent-blue)" : "var(--text-secondary)",
                          transition: "all 0.15s ease"
                        }}
                      >
                        {emoji} {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Saved templates */}
                {savedTemplates.filter(t => t.action === bulkLogAction).length > 0 && (
                  <div>
                    <span style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Saved Templates</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      {savedTemplates.filter(t => t.action === bulkLogAction).map(t => (
                        <div key={t.name} style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                          <button
                            type="button"
                            onClick={() => setBulkLogDetail(t.detail)}
                            style={{
                              padding: "0.25rem 0.65rem",
                              fontSize: "0.72rem",
                              background: "rgba(251, 191, 36, 0.08)",
                              border: "1px solid rgba(251, 191, 36, 0.3)",
                              color: "var(--accent-amber)",
                              borderRadius: "20px",
                              cursor: "pointer"
                            }}
                          >
                            ⚡ {t.name}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteTemplate(t.name)}
                            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.75rem", padding: "0.1rem 0.2rem" }}
                            aria-label={`Delete template ${t.name}`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Detail / notes */}
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                    Notes <span style={{ color: "var(--text-muted)" }}>(optional)</span>
                  </label>
                  <textarea
                    value={bulkLogDetail}
                    onChange={(e) => setBulkLogDetail(e.target.value)}
                    placeholder={BULK_ACTION_LABELS[bulkLogAction]?.defaultDetail}
                    rows="2"
                    style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", resize: "none", fontSize: "0.85rem" }}
                  />
                  {/* Save as template */}
                  {bulkLogDetail.trim() && (
                    <div style={{ marginTop: "0.4rem" }}>
                      {!showSaveTemplate ? (
                        <button type="button" onClick={() => setShowSaveTemplate(true)} style={{ background: "none", border: "none", color: "var(--accent-blue)", fontSize: "0.72rem", cursor: "pointer", padding: 0 }}>
                          + Save as template
                        </button>
                      ) : (
                        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginTop: "0.25rem" }}>
                          <input
                            type="text"
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                            placeholder="Template name…"
                            style={{ flex: 1, padding: "0.35rem 0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", fontSize: "0.75rem" }}
                          />
                          <button type="button" onClick={saveTemplate} className="btn-primary" style={{ padding: "0.35rem 0.75rem", fontSize: "0.72rem" }}>Save</button>
                          <button type="button" onClick={() => { setShowSaveTemplate(false); setTemplateName(""); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.85rem" }}>×</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Success result */}
                {bulkLogResult && (
                  <div style={{ padding: "0.75rem 1rem", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: "6px", color: "var(--accent-green)", fontSize: "0.8rem" }}>
                    ✅ {bulkLogResult.action} logged for {bulkLogResult.count} unit{bulkLogResult.count !== 1 ? "s" : ""}
                  </div>
                )}

                <button
                  type="button"
                  className="btn-primary"
                  disabled={bulkLogSubmitting || getBulkTargetTanks().length === 0}
                  onClick={handleBulkLogSubmit}
                  style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem" }}
                >
                  {bulkLogSubmitting
                    ? `Logging ${getBulkTargetTanks().length} units…`
                    : `Log ${BULK_ACTION_LABELS[bulkLogAction]?.emoji} ${BULK_ACTION_LABELS[bulkLogAction]?.label} → ${getBulkTargetTanks().length} unit${getBulkTargetTanks().length !== 1 ? "s" : ""}`
                  }
                </button>
              </div>
            )}

            {/* ── SINGLE TANK: on-chain water parameter form (unchanged) ── */}
            {bulkLogScope === "single" && (
              <>
            {modalError && (
              <div style={{ padding: "0.75rem", background: "rgba(248, 113, 113, 0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)", fontSize: "0.8rem", borderRadius: "4px", marginBottom: "1rem" }}>
                {modalError}
              </div>
            )}

            {txHash && (
              <div style={{ padding: "0.75rem", background: "var(--accent-blue-glow)", border: "1px solid rgba(56, 189, 248, 0.3)", color: "var(--accent-blue)", fontSize: "0.8rem", borderRadius: "4px", marginBottom: "1rem", wordBreak: "break-all" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
                  <div style={{
                    width: "12px",
                    height: "12px",
                    border: "2px solid rgba(56, 189, 248, 0.3)",
                    borderTopColor: "var(--accent-blue)",
                    borderRadius: "50%",
                    animation: "shimmer 1s linear infinite",
                  }} />
                  <strong>{casualModeActive ? "Saving your data…" : "Confirming on Base…"}</strong>
                </div>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                  {casualModeActive ? "This takes a few seconds." : "Usually 5–15 seconds."}
                </span>
                {!casualModeActive && (
                  <>
                    <br />
                    <a 
                      href={`https://sepolia.basescan.org/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: "0.65rem", color: "var(--accent-blue)", fontFamily: "monospace", textDecoration: "underline" }}
                    >
                      View on BaseScan →
                    </a>
                  </>
                )}
              </div>
            )}

            <form onSubmit={(e) => handleLogSubmit(e, quickLogTankId)} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              {residingSpecies.length > 0 && (
                <div style={{ padding: "0.5rem 0.75rem", background: "rgba(255,255,255,0.02)", border: "1px solid var(--glass-border)", borderRadius: "6px" }}>
                  <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.4rem", fontWeight: "600" }}>
                    Quick-Insert Residing Species:
                  </span>
                  <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                    {residingSpecies.map(sp => (
                      <button
                        key={sp.speciesId}
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            notes: prev.notes ? `${prev.notes} ${sp.commonName}` : sp.commonName
                          }));
                        }}
                        style={{
                          padding: "0.25rem 0.6rem",
                          fontSize: "0.7rem",
                          background: "rgba(56, 189, 248, 0.12)",
                          border: "1px solid rgba(56, 189, 248, 0.3)",
                          color: "#38bdf8",
                          borderRadius: "20px",
                          cursor: "pointer"
                        }}
                      >
                        🐠 {sp.commonName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>Target System</label>
                <select 
                  value={quickLogTankId} 
                  onChange={(e) => setQuickLogTankId(e.target.value)}
                  style={{ width: "100%", padding: "0.75rem", background: "rgba(8,12,20,0.9)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                >
                  {tanks.map(t => (
                    <option key={`opt-${t.id}`} value={t.id}>{t.name} (ID: {t.id})</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Temp (°C)</span>
                    <strong style={{ color: isInsideEnvelope(Number(formData.temp), minSafeTemp, maxSafeTemp) ? "#4ade80" : "#f87171" }}>
                      {formData.temp}°C {isInsideEnvelope(Number(formData.temp), minSafeTemp, maxSafeTemp) ? "(Ideal)" : "(Warning)"}
                    </strong>
                  </div>
                  <input 
                    type="range" 
                    min="10" 
                    max="35" 
                    step="0.1" 
                    value={formData.temp}
                    onChange={(e) => setFormData({ ...formData, temp: e.target.value })}
                    style={{
                      width: "100%",
                      height: "6px",
                      borderRadius: "3px",
                      background: getTrackBackground(10, 35, minSafeTemp, maxSafeTemp),
                      outline: "none",
                      accentColor: isInsideEnvelope(Number(formData.temp), minSafeTemp, maxSafeTemp) ? "#22c55e" : "#ef4444",
                      cursor: "pointer"
                    }}
                  />
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>pH Level</span>
                    <strong style={{ color: isInsideEnvelope(Number(formData.ph), minSafePh, maxSafePh) ? "#4ade80" : "#f87171" }}>
                      {formData.ph} {isInsideEnvelope(Number(formData.ph), minSafePh, maxSafePh) ? "(Ideal)" : "(Warning)"}
                    </strong>
                  </div>
                  <input 
                    type="range" 
                    min="4.5" 
                    max="9.5" 
                    step="0.1" 
                    value={formData.ph}
                    onChange={(e) => setFormData({ ...formData, ph: e.target.value })}
                    style={{
                      width: "100%",
                      height: "6px",
                      borderRadius: "3px",
                      background: getTrackBackground(4.5, 9.5, minSafePh, maxSafePh),
                      outline: "none",
                      accentColor: isInsideEnvelope(Number(formData.ph), minSafePh, maxSafePh) ? "#22c55e" : "#ef4444",
                      cursor: "pointer"
                    }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Ammonia (ppm)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    value={formData.ammonia}
                    onChange={(e) => setFormData({ ...formData, ammonia: e.target.value })}
                    required
                    style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Nitrite (ppm)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    value={formData.nitrite}
                    onChange={(e) => setFormData({ ...formData, nitrite: e.target.value })}
                    required
                    style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Nitrate (ppm)</label>
                  <input 
                    type="number" 
                    step="0.1" 
                    value={formData.nitrate}
                    onChange={(e) => setFormData({ ...formData, nitrate: e.target.value })}
                    required
                    style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Observations Notes</label>
                <textarea 
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Notes on maintenance, cleaning, behavior..."
                  rows="3"
                  style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", resize: "none" }}
                />
              </div>

              <button 
                type="submit" 
                className="btn-primary" 
                disabled={submitting} 
                style={{ width: "100%", justifyContent: "center", marginTop: "1rem" }}
              >
                {submitting ? (casualModeActive ? "Saving water snapshot..." : "Writing telemetry log...") : (casualModeActive ? "Save Water Reading" : "Confirm Test Results")}
              </button>
            </form>
            </>
            )}
          </div>
        </div>
      )}


      {/* Sweeper animation style inline block */}
      <style>{`
        @keyframes scanner-sweep {
          0% { top: 0%; }
          50% { top: 100%; }
          100% { top: 0%; }
        }
      `}</style>

      {/* Floating Action Toast Notification */}
      {toastMessage && (
        <div style={{
          position: "fixed",
          bottom: "2rem",
          right: "2rem",
          background: "rgba(14, 116, 144, 0.95)",
          color: "#fff",
          padding: "0.75rem 1.5rem",
          borderRadius: "8px",
          boxShadow: "0 0 15px rgba(56, 189, 248, 0.4)",
          border: "1px solid rgba(56, 189, 248, 0.4)",
          zIndex: 9999,
          fontSize: "0.85rem",
          backdropFilter: "blur(8px)",
          pointerEvents: "none"
        }}>
          {toastMessage}
        </div>
      )}

      {/* Inline Detail Input — replaces browser prompt() for premium mobile UX */}
      {inlineDetailOpen && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.6)",
          backdropFilter: "blur(6px)",
          zIndex: 10000,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          padding: "1rem",
        }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setInlineDetailOpen(false);
              setInlineDetailText("");
            }
          }}
        >
          <div style={{
            width: "100%",
            maxWidth: "480px",
            background: "var(--bg-secondary)",
            border: "1px solid var(--glass-border-hover)",
            borderRadius: "16px 16px 8px 8px",
            padding: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            boxShadow: "0 -8px 32px rgba(0, 0, 0, 0.5)",
            animation: "sheetSlideUp 0.25s cubic-bezier(0.32, 0.72, 0, 1) forwards"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: "600", color: "#fff" }}>
                {inlineDetailType === "feed" 
                  ? (casualModeActive ? "🥣 What did you feed?" : "🥣 Custom Feeding Details")
                  : inlineDetailType === "population"
                  ? (casualModeActive ? "🐠 Which fish do you want to remove?" : "🐠 Update Population Count")
                  : (casualModeActive ? "🧹 What did you clean?" : "🧹 Maintenance Details")}
              </span>
              <button
                onClick={() => { setInlineDetailOpen(false); setInlineDetailText(""); }}
                style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "1.2rem", cursor: "pointer", padding: "4px", minWidth: "44px", minHeight: "44px", display: "flex", alignItems: "center", justifyContent: "center" }}
                aria-label="Cancel"
              >
                &times;
              </button>
            </div>
            {inlineDetailType === "population" ? (
              casualModeActive ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "250px", overflowY: "auto", paddingRight: "4px", margin: "0.5rem 0" }}>
                  {(!activeTank.specimens || activeTank.specimens.length === 0) ? (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "1.5rem" }}>
                      No fish in this tank to remove.
                    </p>
                  ) : (
                    activeTank.specimens.map(spec => (
                      <div 
                        key={spec.id} 
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "0.6rem 0.75rem",
                          background: "rgba(239, 68, 68, 0.04)",
                          borderRadius: "8px",
                          border: "1px solid rgba(239, 68, 68, 0.15)",
                          fontSize: "0.85rem"
                        }}
                      >
                        <span style={{ color: "#fff", fontWeight: "500", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                          🐠 {spec.commonName}
                          {spec.gender && spec.gender !== "Not Sure" && (
                            <span style={{
                              fontSize: "0.6rem",
                              padding: "0.02rem 0.25rem",
                              borderRadius: "4px",
                              background: spec.gender === "Male" ? "rgba(56, 189, 248, 0.15)" : "rgba(244, 63, 94, 0.15)",
                              color: spec.gender === "Male" ? "#38bdf8" : "#f43f5e",
                              border: spec.gender === "Male" ? "1px solid rgba(56, 189, 248, 0.25)" : "1px solid rgba(244, 63, 94, 0.25)",
                              fontWeight: "600",
                            }}>
                              {spec.gender === "Male" ? "♂" : "♀"}
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => setFarewellSpecimen(spec)}
                          style={{
                            background: "rgba(56, 189, 248, 0.08)",
                            border: "1px solid rgba(56, 189, 248, 0.25)",
                            color: "#38bdf8",
                            padding: "0.25rem 0.65rem",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "0.75rem",
                            fontWeight: "600",
                            transition: "all 0.2s"
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "rgba(239, 68, 68, 0.22)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)";
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", margin: "0.5rem 0" }}>
                  {/* Segmented Add / Remove Control */}
                  <div style={{
                    display: "flex",
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: "8px",
                    padding: "2px"
                  }}>
                    <button
                      type="button"
                      onClick={() => setProPopAction("add")}
                      style={{
                        flex: 1,
                        background: proPopAction === "add" ? "rgba(52, 211, 153, 0.15)" : "none",
                        border: "none",
                        borderRadius: "6px",
                        color: proPopAction === "add" ? "var(--accent-green)" : "var(--text-secondary)",
                        fontSize: "0.75rem",
                        fontWeight: "600",
                        padding: "0.5rem",
                        cursor: "pointer",
                        transition: "all 0.2s"
                      }}
                    >
                      ➕ Add Specimen
                    </button>
                    <button
                      type="button"
                      onClick={() => setProPopAction("remove")}
                      style={{
                        flex: 1,
                        background: proPopAction === "remove" ? "rgba(248, 113, 113, 0.15)" : "none",
                        border: "none",
                        borderRadius: "6px",
                        color: proPopAction === "remove" ? "var(--accent-red)" : "var(--text-secondary)",
                        fontSize: "0.75rem",
                        fontWeight: "600",
                        padding: "0.5rem",
                        cursor: "pointer",
                        transition: "all 0.2s"
                      }}
                    >
                      ➖ Remove Specimen
                    </button>
                  </div>

                  {proPopAction === "add" ? (
                    /* Add Specimen Flow */
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      <div>
                        <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
                          Species to Register
                        </label>
                        {contractSpecies.length === 0 ? (
                          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", textAlign: "center", padding: "0.5rem" }}>
                            No species registered in the catalog yet.
                          </p>
                        ) : (
                          <select
                            value={proPopSpeciesId}
                            onChange={(e) => setProPopSpeciesId(e.target.value)}
                            style={{
                              width: "100%",
                              padding: "0.6rem 0.75rem",
                              background: "rgba(0, 0, 0, 0.3)",
                              border: "1px solid var(--glass-border)",
                              borderRadius: "6px",
                              color: "#fff",
                              fontSize: "0.85rem",
                              outline: "none"
                            }}
                          >
                            {contractSpecies.map(s => (
                              <option key={s.speciesId} value={s.speciesId} style={{ background: "#0e1424", color: "#fff" }}>
                                {s.commonName} ({s.scientificName})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                        {/* Quantity */}
                        <div style={{ flex: 1 }}>
                          <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
                            Quantity
                          </label>
                          <div style={{ display: "flex", alignItems: "center", background: "rgba(0,0,0,0.2)", border: "1px solid var(--glass-border)", borderRadius: "6px", overflow: "hidden", height: "36px" }}>
                            <button
                              type="button"
                              onClick={() => setProPopQty(prev => Math.max(1, prev - 1))}
                              style={{ background: "none", border: "none", color: "#fff", width: "30px", height: "100%", cursor: "pointer", fontSize: "1rem", fontWeight: "600" }}
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="1"
                              value={proPopQty}
                              onChange={(e) => setProPopQty(Math.max(1, parseInt(e.target.value) || 1))}
                              style={{ flex: 1, background: "none", border: "none", color: "#fff", textAlign: "center", fontSize: "0.85rem", outline: "none", width: "100%" }}
                            />
                            <button
                              type="button"
                              onClick={() => setProPopQty(prev => prev + 1)}
                              style={{ background: "none", border: "none", color: "#fff", width: "30px", height: "100%", cursor: "pointer", fontSize: "1rem", fontWeight: "600" }}
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {/* Gender */}
                        <div style={{ flex: 1.5 }}>
                          <label style={{ display: "block", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
                            Gender
                          </label>
                          <div style={{ display: "flex", background: "rgba(0,0,0,0.2)", border: "1px solid var(--glass-border)", borderRadius: "6px", padding: "2px", height: "36px" }}>
                            {["Male", "Female", "Not Sure"].map((g) => {
                              const sel = proPopGender === g;
                              return (
                                <button
                                  type="button"
                                  key={g}
                                  onClick={() => setProPopGender(g)}
                                  style={{
                                    flex: 1,
                                    background: sel ? (g === "Male" ? "rgba(56, 189, 248, 0.18)" : g === "Female" ? "rgba(244, 63, 94, 0.18)" : "rgba(255, 255, 255, 0.1)") : "none",
                                    border: "none",
                                    borderRadius: "4px",
                                    color: sel ? (g === "Male" ? "#38bdf8" : g === "Female" ? "#f43f5e" : "#fff") : "var(--text-secondary)",
                                    fontSize: "0.68rem",
                                    fontWeight: "600",
                                    cursor: "pointer",
                                    transition: "all 0.2s ease"
                                  }}
                                >
                                  {g === "Male" ? "♂" : g === "Female" ? "♀" : "⚪"}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={handleProPopAddSubmit}
                        className="btn-primary"
                        disabled={proPopSubmitting || !proPopSpeciesId}
                        style={{ width: "100%", padding: "0.6rem", fontSize: "0.85rem", minHeight: "40px", marginTop: "0.25rem", opacity: (proPopSubmitting || !proPopSpeciesId) ? 0.6 : 1 }}
                      >
                        {proPopSubmitting ? "Registering Specimen..." : "Register Birth Certificate"}
                      </button>
                    </div>
                  ) : (
                    /* Remove Specimen Flow */
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "200px", overflowY: "auto", paddingRight: "4px" }}>
                      {(!activeTank.specimens || activeTank.specimens.length === 0) ? (
                        <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", textAlign: "center", padding: "1rem" }}>
                          No specimens in this tank to remove.
                        </p>
                      ) : (
                        activeTank.specimens.map(spec => (
                          <div 
                            key={spec.id} 
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "0.5rem 0.65rem",
                              background: "rgba(255, 255, 255, 0.01)",
                              borderRadius: "6px",
                              border: "1px solid var(--glass-border)",
                              fontSize: "0.8rem"
                            }}
                          >
                            <span style={{ color: "#fff", fontWeight: "500", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                              🐠 {spec.commonName}
                              <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>#{spec.id}</span>
                              {spec.gender && spec.gender !== "Not Sure" && (
                                <span style={{
                                  fontSize: "0.55rem",
                                  padding: "0 0.15rem",
                                  borderRadius: "3px",
                                  background: spec.gender === "Male" ? "rgba(56, 189, 248, 0.12)" : "rgba(244, 63, 94, 0.12)",
                                  color: spec.gender === "Male" ? "#38bdf8" : "#f43f5e",
                                  border: spec.gender === "Male" ? "1px solid rgba(56, 189, 248, 0.2)" : "1px solid rgba(244, 63, 94, 0.2)"
                                }}>
                                  {spec.gender === "Male" ? "♂" : "♀"}
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => { setFarewellSpecimen(spec); setInlineDetailOpen(false); }}
                              style={{
                                background: "rgba(239, 68, 68, 0.08)",
                                border: "1px solid rgba(239, 68, 68, 0.25)",
                                color: "#f87171",
                                padding: "0.2rem 0.5rem",
                                borderRadius: "4px",
                                cursor: "pointer",
                                fontSize: "0.7rem",
                                fontWeight: "600",
                                transition: "all 0.2s"
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "rgba(239, 68, 68, 0.2)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "rgba(239, 68, 68, 0.08)";
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            ) : (
              <>
                <input
                  ref={inlineDetailRef}
                  type="text"
                  value={inlineDetailText}
                  onChange={(e) => setInlineDetailText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleInlineDetailSubmit(); }}
                  placeholder={inlineDetailType === "feed" ? "e.g. Frozen brine shrimp, flakes..." : "e.g. Scraped algae, wiped glass..."}
                  style={{
                    width: "100%",
                    padding: "0.75rem 1rem",
                    background: "rgba(0, 0, 0, 0.3)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: "8px",
                    color: "#fff",
                    fontSize: "0.9rem",
                    outline: "none",
                    minHeight: "48px"
                  }}
                />
                <button
                  onClick={handleInlineDetailSubmit}
                  className="btn-primary"
                  style={{ width: "100%", padding: "0.75rem", fontSize: "0.9rem", minHeight: "48px" }}
                >
                  {casualModeActive ? "Save" : "Log Entry"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Farewell Modal */}
      {farewellSpecimen && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.75)",
          backdropFilter: "blur(8px)",
          zIndex: 20000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
        }}
          onClick={() => setFarewellSpecimen(null)}
        >
          <div style={{
            width: "100%",
            maxWidth: "400px",
            background: "rgba(10, 15, 30, 0.95)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "16px",
            padding: "1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            boxShadow: "0 10px 40px rgba(0, 0, 0, 0.8)",
            textAlign: "center"
          }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <span style={{ fontSize: "2.5rem", display: "block", marginBottom: "0.5rem" }}>👋</span>
              <h3 style={{ color: "#fff", fontSize: "1.2rem", margin: "0 0 0.25rem 0" }}>Say Farewell to {farewellSpecimen.commonName}</h3>
              <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", margin: 0 }}>
                Choose how you would like to record the departure of this fish.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
              {/* Option 1: Rehomed */}
              <button
                type="button"
                onClick={async () => {
                  const spec = farewellSpecimen;
                  await db.specimens.update(spec.id, { status: 2 });
                  const updatedSpecimens = (activeTank.specimens || []).filter(s => s.id !== spec.id);
                  await db.tanks.update(activeTank.id, { specimens: updatedSpecimens });
                  setMockPopulationCounts(prev => ({
                    ...prev,
                    [activeTank.id]: updatedSpecimens.length
                  }));
                  showToast(`Rehomed ${spec.commonName} successfully.`);
                  await fetchDashboardData();
                  const fresh = await refetchTanks();
                  const updated = fresh.data?.find(t => t.id === activeTank.id);
                  if (updated) {
                    setActiveTank(updated);
                  }
                  setFarewellSpecimen(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  gap: "0.75rem",
                  padding: "0.85rem 1rem",
                  background: "rgba(59, 130, 246, 0.06)",
                  border: "1px solid rgba(59, 130, 246, 0.25)",
                  borderRadius: "10px",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: "600",
                  textAlign: "left",
                  transition: "all 0.2s"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(59, 130, 246, 0.15)";
                  e.currentTarget.style.borderColor = "rgba(59, 130, 246, 0.45)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(59, 130, 246, 0.06)";
                  e.currentTarget.style.borderColor = "rgba(59, 130, 246, 0.25)";
                }}
              >
                <span style={{ fontSize: "1.2rem" }}>🏠</span>
                <div>
                  <span style={{ display: "block" }}>Rehomed / Sold</span>
                  <span style={{ display: "block", fontSize: "0.68rem", fontWeight: "normal", color: "var(--text-muted)" }}>Fish has been moved to a new home.</span>
                </div>
              </button>

              {/* Option 2: Deceased */}
              <button
                type="button"
                onClick={async () => {
                  const spec = farewellSpecimen;
                  await db.specimens.update(spec.id, { status: 1 });
                  const updatedSpecimens = (activeTank.specimens || []).filter(s => s.id !== spec.id);
                  await db.tanks.update(activeTank.id, { specimens: updatedSpecimens });
                  setMockPopulationCounts(prev => ({
                    ...prev,
                    [activeTank.id]: updatedSpecimens.length
                  }));
                  showToast(`Recorded memorial for ${spec.commonName}. 🕊️`);
                  await fetchDashboardData();
                  const fresh = await refetchTanks();
                  const updated = fresh.data?.find(t => t.id === activeTank.id);
                  if (updated) {
                    setActiveTank(updated);
                  }
                  setFarewellSpecimen(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  gap: "0.75rem",
                  padding: "0.85rem 1rem",
                  background: "rgba(239, 68, 68, 0.06)",
                  border: "1px solid rgba(239, 68, 68, 0.25)",
                  borderRadius: "10px",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: "600",
                  textAlign: "left",
                  transition: "all 0.2s"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
                  e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.45)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(239, 68, 68, 0.06)";
                  e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.25)";
                }}
              >
                <span style={{ fontSize: "1.2rem" }}>🕊️</span>
                <div>
                  <span style={{ display: "block" }}>Passed Away</span>
                  <span style={{ display: "block", fontSize: "0.68rem", fontWeight: "normal", color: "var(--text-muted)" }}>Record as deceased to preserve history.</span>
                </div>
              </button>

              {/* Option 3: Released / Other */}
              <button
                type="button"
                onClick={async () => {
                  const spec = farewellSpecimen;
                  await db.specimens.delete(spec.id);
                  const updatedSpecimens = (activeTank.specimens || []).filter(s => s.id !== spec.id);
                  await db.tanks.update(activeTank.id, { specimens: updatedSpecimens });
                  setMockPopulationCounts(prev => ({
                    ...prev,
                    [activeTank.id]: updatedSpecimens.length
                  }));
                  showToast(`Removed ${spec.commonName} from the tank.`);
                  await fetchDashboardData();
                  const fresh = await refetchTanks();
                  const updated = fresh.data?.find(t => t.id === activeTank.id);
                  if (updated) {
                    setActiveTank(updated);
                  }
                  setFarewellSpecimen(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  gap: "0.75rem",
                  padding: "0.85rem 1rem",
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "10px",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: "600",
                  textAlign: "left",
                  transition: "all 0.2s"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
                  e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.25)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)";
                  e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.12)";
                }}
              >
                <span style={{ fontSize: "1.2rem" }}>🌊</span>
                <div>
                  <span style={{ display: "block" }}>Released / Other</span>
                  <span style={{ display: "block", fontSize: "0.68rem", fontWeight: "normal", color: "var(--text-muted)" }}>Completely delete from local registry.</span>
                </div>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setFarewellSpecimen(null)}
              className="btn-secondary"
              style={{
                width: "100%",
                padding: "0.75rem",
                fontSize: "0.85rem",
                borderRadius: "10px",
                marginTop: "0.5rem"
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
