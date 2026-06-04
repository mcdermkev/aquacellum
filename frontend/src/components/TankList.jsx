import React, { useState, useEffect } from "react";
import { ethers, Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { FacilityTreeView } from "./FacilityTreeView";
import { getProvider, getSigner } from "../utils/smartAccount";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { db } from "../db";
import { PoseidonChatConsole } from "./PoseidonChatConsole";
import { mapContractError } from "../utils/errorHandler";
import QRCode from "qrcode";

const TANK_TYPES = ["Freshwater", "Saltwater", "Brackish", "Pond"];
const CONTAINMENT_TYPES = ["Tank", "Tub", "Basket"];

// Small inline component that renders a real QR code for a tank deep-link
function TankQRCode({ tankId, size = 40 }) {
  const canvasRef = React.useRef(null);

  React.useEffect(() => {
    if (!canvasRef.current) return;
    const url = `https://aquacellum.com/app#tank=${tankId}`;
    QRCode.toCanvas(canvasRef.current, url, {
      width: size,
      margin: 1,
      color: { dark: "#1e293b", light: "#ffffff" }
    }).catch(err => console.warn("QR render failed:", err));
  }, [tankId, size]);

  return <canvas ref={canvasRef} width={size} height={size} style={{ borderRadius: "4px" }} />;
}

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

import { useUserTanks } from "../hooks/useUserTanks";
import { useRef } from "react";
import { useSpeciesData } from "../hooks/useSpeciesData";
import { useQueryClient } from "@tanstack/react-query";

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

// Floating Animated Breeder Companion Fish Component
export function CompanionFishEntity({ 
  tier, 
  companionXp = 500, 
  mood = "calm", 
  glow = false, 
  swimSpeedMultiplier = 1.0,
  onClick, 
  onReactionComplete 
}) {
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [dir, setDir] = useState(1); // 1 = right, -1 = left
  const requestRef = useRef();
  const stateRef = useRef({ x: 50, y: 50, dir: 1, vx: 0.8, vy: 0.3 });
  const containerRef = useRef(null);

  // Local state overrides for incoming Poseidon event triggers
  const [localMood, setLocalMood] = useState(mood);
  const [localGlow, setLocalGlow] = useState(glow);
  const [localSpeed, setLocalSpeed] = useState(swimSpeedMultiplier);
  const [localGlowColor, setLocalGlowColor] = useState("");
  const timeoutRef = useRef(null);

  useEffect(() => {
    setLocalMood(mood);
  }, [mood]);

  useEffect(() => {
    setLocalGlow(glow);
  }, [glow]);

  useEffect(() => {
    setLocalSpeed(swimSpeedMultiplier);
  }, [swimSpeedMultiplier]);

  useEffect(() => {
    const handleReaction = (e) => {
      const reaction = e.detail;
      if (!reaction) return;

      console.log("[Echo Companion] Received Poseidon reaction trigger:", reaction);
      
      if (reaction.mood) setLocalMood(reaction.mood);
      if (reaction.glowActive !== undefined) setLocalGlow(reaction.glowActive);
      if (reaction.swimSpeedMultiplier !== undefined) setLocalSpeed(reaction.swimSpeedMultiplier);
      if (reaction.glowColor !== undefined) setLocalGlowColor(reaction.glowColor);

      // Clear any active reaction timeout to avoid overlaps
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Revert back to baseline state after durationMs
      if (reaction.durationMs) {
        timeoutRef.current = setTimeout(() => {
          setLocalMood(mood);
          setLocalGlow(glow);
          setLocalSpeed(swimSpeedMultiplier);
          setLocalGlowColor("");
        }, reaction.durationMs);
      }
    };

    window.addEventListener("poseidon:echo-reaction", handleReaction);
    return () => {
      window.removeEventListener("poseidon:echo-reaction", handleReaction);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [mood, glow, swimSpeedMultiplier]);

  // Handle pointer interactions smoothly
  const handleEntityClick = (e) => {
    console.log(`[Echo Companion] Clicked! Current mood: ${localMood}, XP: ${companionXp}`);
    if (onClick) onClick(e);
    if (onReactionComplete) onReactionComplete();
  };

  // Map incoming dynamic mood parameters to vector speed variations
  const dynamicSpeedModifier = localSpeed * (localMood === "excited" ? 1.6 : localMood === "happy" ? 1.2 : 1.0);

  const speedMultiplier = (() => {
    const xp = companionXp || 0;
    if (xp < 1500) return 0.7;
    if (xp < 2500) return 1.0;
    if (xp < 5000) return 1.3;
    if (xp < 10000) return 1.6;
    if (tier === "God-Tier") return 2.0;
    return 1.8; // Master
  })();

  const totalSpeedMultiplier = speedMultiplier * dynamicSpeedModifier;

  useEffect(() => {
    // Randomize initial speeds
    stateRef.current.vx = (0.5 + Math.random() * 0.8) * stateRef.current.dir;
    stateRef.current.vy = (Math.random() - 0.5) * 0.5;
  }, [tier, companionXp]);

  useEffect(() => {
    // Respect reduced motion preference — disable swimming animation
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const animate = () => {
      const state = stateRef.current;
      const container = containerRef.current;
      
      let maxX = 260;
      let maxY = 120;
      if (container && container.parentElement) {
        const parentW = container.parentElement.clientWidth;
        const parentH = container.parentElement.clientHeight;
        if (parentW > 0) maxX = parentW - 50;
        if (parentH > 0) maxY = parentH - 30;
      }
      
      // Update coordinates
      state.x += state.vx * totalSpeedMultiplier;
      state.y += state.vy * totalSpeedMultiplier;

      // Bounding box checks
      if (state.x > maxX) {
        state.x = maxX;
        state.dir = -1;
        state.vx = -Math.abs(state.vx);
      } else if (state.x < 10) {
        state.x = 10;
        state.dir = 1;
        state.vx = Math.abs(state.vx);
      }

      if (state.y > maxY) {
        state.y = maxY;
        state.vy = -Math.abs(state.vy);
      } else if (state.y < 10) {
        state.y = 10;
        state.vy = Math.abs(state.vy);
      }

      // Slightly alter vertical speed occasionally
      if (Math.random() < 0.02) {
        state.vy = (Math.random() - 0.5) * 0.6;
      }

      setPos({ x: state.x, y: state.y });
      setDir(state.dir);

      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, [totalSpeedMultiplier]);

  // Visual Evolution Mapping Matrix
  const getFishConfig = (tier, xp) => {
    const companionXpVal = xp || 0;
    if (companionXpVal < 1500) {
      return {
        scale: 0.8,
        color: "#00e5ff", // Cyan tint
        className: "",
        style: { opacity: 0.8, filter: "drop-shadow(0 0 6px #00e5ff)" }
      };
    } else if (companionXpVal < 2500) {
      return {
        scale: 1.0,
        color: "#cd7f32", // Bronze
        className: "",
        style: { filter: "drop-shadow(0 0 8px rgba(205, 127, 50, 0.7))" }
      };
    } else if (companionXpVal < 5000) {
      return {
        scale: 1.3,
        color: "#a0bec5", // Silver
        className: "",
        style: { filter: "drop-shadow(0 0 10px #38bdf8)" }
      };
    } else if (companionXpVal < 10000) {
      return {
        scale: 1.6,
        color: "#fbbf24", // Gold
        className: "",
        style: { filter: "drop-shadow(0 0 12px #fbbf24)" }
      };
    } else if (tier === "God-Tier") {
      return {
        scale: 2.5,
        color: "#ff6b35", // Koi-orange
        className: "animate-god-pulse",
        style: {}
      };
    } else { // Master
      return {
        scale: 2.0,
        color: "#d500f9", // Purple
        className: "",
        style: { filter: "drop-shadow(0 0 15px #d500f9)" }
      };
    }
  };

  const config = getFishConfig(tier, companionXp);

  // High-fidelity styling overrides ensuring click accessibility and glows
  const entityStyle = {
    position: "absolute",
    left: 0,
    top: 0,
    transform: `translate(${pos.x}px, ${pos.y}px) scale(${config.scale}) scaleX(${dir})`,
    transformOrigin: "center",
    zIndex: 1,
    pointerEvents: "auto",
    cursor: "pointer",
    transition: "transform 0.016s linear, opacity 0.4s ease, filter 0.4s ease",
    filter: localGlow 
      ? `drop-shadow(0 0 12px ${localGlowColor || (localMood === "excited" ? "#38bdf8" : "#a855f7")})` 
      : (config.style?.filter || "none"),
    opacity: localMood === "confused" ? 0.7 : (config.style?.opacity || 1.0)
  };

  return (
    <div
      ref={containerRef}
      className={`${config.className} companion-fish-container mood-${localMood}`}
      style={entityStyle}
      onClick={handleEntityClick}
    >
      <style>{`
        @keyframes godPulse {
          0% {
            filter: drop-shadow(0 0 10px rgba(255, 107, 53, 0.7));
          }
          50% {
            filter: drop-shadow(0 0 25px rgba(255, 107, 53, 1));
          }
          100% {
            filter: drop-shadow(0 0 10px rgba(255, 107, 53, 0.7));
          }
        }
        .animate-god-pulse {
          animation: godPulse 2s infinite ease-in-out;
        }
      `}</style>
      {tier === "God-Tier" ? (
        <svg width="40" height="25" viewBox="0 0 40 25" fill="none">
          {/* Barbels (Koi whiskers) */}
          <path d="M38 10C42 9 43 7 43 7" stroke={config.color} strokeWidth="0.75" strokeLinecap="round" />
          <path d="M38 15C42 16 43 18 43 18" stroke={config.color} strokeWidth="0.75" strokeLinecap="round" />
          {/* Flowy majestic trailing tail fins */}
          <path d="M5 12.5C1 5 0 2 0 0C1 6 3 10 5 12.5C3 15 1 19 0 25C0 23 1 20 5 12.5Z" fill={config.color} opacity="0.95" />
          <path d="M3 12.5C-1 7 -2 4 -2 2C-1 8 1 11 3 12.5C1 14 -1 17 -2 23C-2 21 -1 18 3 12.5Z" fill="#ffaa00" opacity="0.8" />
          {/* God-tier transformed body */}
          <path d="M40 12.5C35 17 28 20 22 20C15 20 10 16 5 12.5C10 9 15 5 22 5C28 5 35 8 40 12.5Z" fill={config.color} />
          {/* Koi white/black patches */}
          <path d="M26 6C23 6 20 8 18 10C21 11 25 9 26 6Z" fill="#ffffff" opacity="0.9" />
          <path d="M15 12C13 14 11 15 9 14C11 16 14 17 16 15C16 13 15 12 15 12Z" fill="#111111" opacity="0.95" />
          <path d="M30 14C28 15 26 15 24 13C25 11 28 12 30 14Z" fill="#ffffff" opacity="0.9" />
          {/* Dorsal flowy fin */}
          <path d="M25 5.5C19 0.5 12 0.5 9 3.5C14 3.5 18 4.5 25 5.5Z" fill={config.color} />
          <path d="M22 5.5C17 1.5 11 1.5 8 3.5C12 3.5 16 4.5 22 5.5Z" fill="#ffaa00" opacity="0.85" />
          <circle cx="34" cy="10.5" r="1.5" fill="#000" />
          <circle cx="34.5" cy="10" r="0.5" fill="#fff" />
        </svg>
      ) : (
        <svg width="40" height="25" viewBox="0 0 40 25" fill="none">
          <path d="M5 12.5L0 7.5V17.5L5 12.5Z" fill={config.color} />
          <path d="M40 12.5C35 17 28 20 22 20C15 20 10 16 5 12.5C10 9 15 5 22 5C28 5 35 8 40 12.5Z" fill={config.color} />
          <circle cx="32" cy="11.5" r="1.5" fill="#000" />
        </svg>
      )}
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

    window.addEventListener("aquadex_xp_added", fetchCompanion);
    return () => {
      window.removeEventListener("aquadex_xp_added", fetchCompanion);
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

  // Scanner Simulator State
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState("");

  // Quick Log Drawer State
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [quickLogTankId, setQuickLogTankId] = useState("");
  const [poseidonChatOpen, setPoseidonChatOpen] = useState(false);

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

  // Quick Win 7: Escape key closes overlays
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") {
        if (quickLogOpen) { setQuickLogOpen(false); return; }
        if (inlineDetailOpen) { setInlineDetailOpen(false); setInlineDetailText(""); return; }
        if (activeTank) { setActiveTank(null); return; }
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [quickLogOpen, inlineDetailOpen, activeTank]);

  // Detailed Tank View State
  const [detailSubTab, setDetailSubTab] = useState("overview"); // "overview" | "fish" | "history" | "notes"
  const [commentText, setCommentText] = useState("");
  const [commenterRole, setCommenterRole] = useState("hobbyist");
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

  const handleMoveSpecimen = async (specimenId, targetTankId) => {
    try {
      showToast(`🔄 Rehoming specimen #${specimenId} to tank #${targetTankId}...`);
      const signer = await getSigner();
      const contract = new Contract(contractAddress, aquadexAbi, signer);

      const tx = await contract.moveSpecimenToTank(specimenId, targetTankId);
      await tx.wait();

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
    const role = commenterRole;
    const text = commentText.trim();
    
    const isExpertAudit = role === "master-breeder" && text.length >= 60;

    if (isExpertAudit) {
      addXp(25, "Mentor XP (Expert Comment)");
      addXp(50, "Prestige XP (Received Expert Audit)");
    } else {
      addXp(5, "Posted Tank Observation Comment");
    }

    const newComment = {
      author,
      role,
      text,
      timestamp: Math.floor(Date.now() / 1000),
      isExpertAudit
    };

    setTankComments(prev => ({
      ...prev,
      [tankId]: [...(prev[tankId] || []), newComment]
    }));

    setCommentText("");
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
      const signer = await getSigner();
      const contract = new Contract(contractAddress, aquadexAbi, signer);

      const tempCelsiusX10 = Math.round(parseFloat(formData.temp) * 10);
      const phX10 = Math.round(parseFloat(formData.ph) * 10);
      const salinitySgX10000 = Math.round(parseFloat(formData.salinity) * 10000);
      const ammoniaPpmX100 = Math.round(parseFloat(formData.ammonia) * 100);
      const nitritePpmX100 = Math.round(parseFloat(formData.nitrite) * 100);
      const nitratePpmX100 = Math.round(parseFloat(formData.nitrate) * 100);

      const tx = await contract.logWaterParameters(
        Number(targetTankId),
        tempCelsiusX10,
        phX10,
        salinitySgX10000,
        ammoniaPpmX100,
        nitritePpmX100,
        nitratePpmX100,
        formData.notes
      );

      setTxHash(tx.hash);
      await tx.wait();

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

  return (
    <div style={{ position: "relative" }}>
      {/* 1. STICKY ACTION HEADER BAR */}
      <div className="sticky-scanner-header glass-card" style={{ borderRadius: "var(--radius-sm)" }}>
        <button className="btn-primary scanner-btn" onClick={triggerScan}>
          {casualModeActive ? "📸 Scan Tank" : "📸 [ ↓ Scan Tank ]"}
        </button>

        {/* List / Tree toggler */}
        <div style={{ display: "flex", gap: "0.25rem", background: "rgba(255,255,255,0.02)", padding: "0.25rem", borderRadius: "8px", border: "1px solid var(--glass-border)" }}>
          <button 
            className="btn-secondary" 
            onClick={() => setViewMode("list")}
            style={{ padding: "0.35rem 0.75rem", fontSize: "0.75rem", border: "none", background: viewMode === "list" ? "rgba(255,255,255,0.08)" : "none" }}
          >
            📋 Grid list
          </button>
          <button 
            className="btn-secondary" 
            onClick={() => setViewMode("tree")}
            style={{ padding: "0.35rem 0.75rem", fontSize: "0.75rem", border: "none", background: viewMode === "tree" ? "rgba(255,255,255,0.08)" : "none" }}
          >
            🏢 Facility Tree
          </button>
        </div>

        <button className="btn-secondary" onClick={() => setQuickLogOpen(true)}>
          {casualModeActive ? "✍️ Quick Log" : "✍️ [ + Quick Log ]"}
        </button>
        <button 
          className="btn-primary" 
          onClick={() => {
            setViewMode("tree");
            setOpenRegisterOnTreeMount(true);
          }}
        >
          {casualModeActive ? "➕ Add Tank" : "➕ [ + Register Unit ]"}
        </button>
      </div>

      {/* 2. DYNAMIC LOCATION CAROUSEL FILTER */}
      <div className="location-carousel" style={{ marginBottom: "2rem" }}>
        {locations.map((loc) => (
          <button 
            key={loc}
            className={`location-chip ${selectedLocation === loc ? "active" : ""}`}
            onClick={() => setSelectedLocation(loc)}
          >
            📍 {loc}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: activeTank ? "1.2fr 1fr" : "1fr", gap: "2rem", alignItems: "flex-start" }}>
        {/* LEFT VIEW COMPONENT */}
        <div>
          {viewMode === "tree" ? (
            <FacilityTreeView 
              contractAddress={contractAddress} 
              walletAccount={walletAccount} 
              onSelectTank={(t) => {
                const fullTank = tanks.find(x => x.id === t.id) || t;
                setActiveTank(fullTank);
              }}
              onReload={fetchDashboardData}
              openRegisterOnTreeMount={openRegisterOnTreeMount}
              onCloseRegister={() => setOpenRegisterOnTreeMount(false)}
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
                  const latestLogTime = tank.latestLog ? getRelativeTime(tank.latestLog.timestamp) : "Never tested";
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
                            {!casualModeActive && <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>ID: {tank.id}</span>}
                          </div>
                          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "block", marginTop: "0.15rem" }}>
                            📍 {tank.facility} › {tank.room} › {tank.rack}
                          </span>
                        </div>

                        <div style={{ textAlign: "right" }}>
                          <strong style={{ fontSize: "1.05rem", color: "#fff" }}>{tank.volumeLiters}L</strong>
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block" }}>
                            ({toGallons(tank.volumeLiters)} gal)
                          </span>
                        </div>
                      </div>

                      {/* Middle grid */}
                      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "1rem", fontSize: "0.85rem", background: "rgba(0,0,0,0.15)", padding: "0.75rem", borderRadius: "8px" }}>
                        <div>
                          <span style={{ color: "var(--text-muted)", fontSize: "0.75rem", display: "block" }}>Inhabitants</span>
                          <strong style={{ color: "var(--accent-green)" }}>{getSpecimenCount(tank)} {casualModeActive ? "Fish" : "Birth Certificates"}</strong>
                          <span style={{ color: "var(--text-secondary)", fontSize: "0.75rem", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {speciesName}
                          </span>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ color: "var(--text-muted)", fontSize: "0.75rem", display: "block" }}>Relative Timer</span>
                          <strong style={{ color: "var(--text-primary)" }}>{latestLogTime}</strong>
                          <span style={{ color: "var(--text-secondary)", fontSize: "0.75rem", display: "block" }}>Last Water Change</span>
                        </div>
                      </div>

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
              position: "relative",
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
                  {TANK_TYPES[activeTank.tankType]} {CONTAINMENT_TYPES[activeTank.containment]}
                </span>
                <h3 style={{ color: "#fff", fontSize: "1.5rem" }}>{activeTank.name}</h3>
                <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                  📍 {activeTank.facility} › {activeTank.room} › {activeTank.rack}
                </span>
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
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: "2px" }}>
                  <button
                    {...feedEvents}
                    className="btn-secondary"
                    title="Tap to log routine feeding"
                    style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.25rem", borderRadius: "var(--radius-sm) 0 0 var(--radius-sm)" }}
                  >
                    🥣 Feed
                  </button>
                  <button
                    onClick={logFeedLongPress}
                    className="btn-secondary"
                    title="Add feeding note"
                    style={{ padding: "0.35rem 0.4rem", fontSize: "0.7rem", borderRadius: "0 var(--radius-sm) var(--radius-sm) 0", color: "var(--text-muted)" }}
                  >
                    ⋯
                  </button>
                </div>
                <div style={{ display: "flex", gap: "2px" }}>
                  <button
                    {...testEvents}
                    className="btn-secondary"
                    title="Tap to log baseline water test"
                    style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.25rem", borderRadius: "var(--radius-sm) 0 0 var(--radius-sm)" }}
                  >
                    🧪 Test
                  </button>
                  <button
                    onClick={logTestLongPress}
                    className="btn-secondary"
                    title="Open detailed water log"
                    style={{ padding: "0.35rem 0.4rem", fontSize: "0.7rem", borderRadius: "0 var(--radius-sm) var(--radius-sm) 0", color: "var(--text-muted)" }}
                  >
                    ⋯
                  </button>
                </div>
                <div style={{ display: "flex", gap: "2px" }}>
                  <button
                    {...algaeEvents}
                    className="btn-secondary"
                    title="Tap to log routine algae scraping"
                    style={{ padding: "0.35rem 0.75rem", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.25rem", borderRadius: "var(--radius-sm) 0 0 var(--radius-sm)" }}
                  >
                    🧹 Clean
                  </button>
                  <button
                    onClick={logAlgaeLongPress}
                    className="btn-secondary"
                    title="Add cleaning note"
                    style={{ padding: "0.35rem 0.4rem", fontSize: "0.7rem", borderRadius: "0 var(--radius-sm) var(--radius-sm) 0", color: "var(--text-muted)" }}
                  >
                    ⋯
                  </button>
                </div>
                <button
                  onClick={() => setPoseidonChatOpen(!poseidonChatOpen)}
                  className="btn-secondary"
                  title="Talk to Poseidon AI Assistant to log care or setup systems"
                  style={{
                    padding: "0.35rem 0.75rem",
                    fontSize: "0.8rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    border: poseidonChatOpen ? "1px solid var(--accent-blue)" : "none",
                    boxShadow: poseidonChatOpen ? "0 0 8px var(--accent-blue-glow)" : "none"
                  }}
                >
                  💬 Ask Poseidon
                </button>
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
              
              {/* 2.1 OVERVIEW SUB-TAB: 2x2 Telemetry Grid */}
              {detailSubTab === "overview" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
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

                    {/* Salinity */}
                    <div className="telemetry-tile-premium" style={{ borderLeft: `3px solid ${activeTank.latestLog ? getHslColor(activeTank.latestLog.salinitySgX10000/10000, 1.000, 1.026, 0.01) : "var(--glass-border)"}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>🌊 Specific Gravity</span>
                        {activeTank.latestLog && (
                          <span className="badge" style={{ 
                            fontSize: "0.55rem", 
                            padding: "0.1rem 0.4rem", 
                            background: `${getHslColor(activeTank.latestLog.salinitySgX10000/10000, 1.000, 1.026, 0.01)}15`, 
                            color: getHslColor(activeTank.latestLog.salinitySgX10000/10000, 1.000, 1.026, 0.01),
                            borderColor: getHslColor(activeTank.latestLog.salinitySgX10000/10000, 1.000, 1.026, 0.01)
                          }}>
                            {activeTank.latestLog.salinitySgX10000/10000 >= 1.000 && activeTank.latestLog.salinitySgX10000/10000 <= 1.026 ? "Ideal" : "Warning"}
                          </span>
                        )}
                      </div>
                      <strong style={{ fontSize: "1.25rem", color: "#fff" }}>
                        {activeTank.latestLog ? (activeTank.latestLog.salinitySgX10000 / 10000).toFixed(4) : "N/A"}
                      </strong>
                      <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Saltwater standard: 1.025 SG</span>
                    </div>

                    {/* Nitrogen */}
                    <div className="telemetry-tile-premium" style={{ 
                      position: "relative",
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
                        style={{ marginTop: "0.5rem", fontSize: "0.75rem", padding: "0.35rem 0.75rem" }}
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
                        [ Log Immediate Water Change ]
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 2.2 FISH SUB-TAB: Fish inside tank — consumer label in Casual mode */}
              {detailSubTab === "fish" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <strong style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    {casualModeActive ? `Fish in this tank (${getSpecimenCount(activeTank)})` : `Registered Birth Certificates (Total: ${getSpecimenCount(activeTank)})`}
                  </strong>
                  {activeTank.specimens.length === 0 ? (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "2rem", textAlign: "center" }}>
                      {casualModeActive ? "No fish recorded in this tank yet." : "No birth certificates assigned to this containment unit."}
                    </p>
                  ) : (
                    activeTank.specimens.map(spec => (
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
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "0.6rem 0.75rem",
                          background: casualModeActive ? "rgba(14, 165, 233, 0.04)" : "rgba(0,0,0,0.2)",
                          borderRadius: "6px",
                          border: casualModeActive ? "1px solid rgba(56,189,248,0.15)" : "1px solid var(--glass-border)",
                          fontSize: "0.85rem",
                          cursor: "grab",
                          transition: "opacity 0.2s ease"
                        }}
                      >
                        <div>
                          {!casualModeActive && (
                            <strong style={{ color: "var(--accent-blue)" }}>Cert. Serial No. {spec.id.toString().padStart(3, "0")}</strong>
                          )}
                          <span style={{ color: "#fff", marginLeft: casualModeActive ? 0 : "0.5rem" }}>{spec.commonName}</span>
                          <span style={{ display: "block", fontSize: "0.7rem", color: "var(--text-muted)" }}>
                            {casualModeActive ? spec.commonName : spec.scientificName}
                          </span>
                          {casualModeActive && spec.careLevel !== undefined && (
                            <span style={{
                              display: "inline-block",
                              marginTop: "0.25rem",
                              fontSize: "0.65rem",
                              padding: "0.1rem 0.45rem",
                              borderRadius: "20px",
                              background: "rgba(34, 197, 94, 0.12)",
                              border: "1px solid rgba(34, 197, 94, 0.3)",
                              color: "#4ade80"
                            }}>
                              ✓ Registry Verified
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                          {!casualModeActive && (
                            <button 
                              className="btn-secondary"
                              onClick={(e) => {
                                e.stopPropagation();
                                onViewLineage(spec.id);
                              }}
                              style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                            >
                              Ancestry
                            </button>
                          )}
                          {onListOnMarketplace && (
                            <button 
                              className="btn-primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                onListOnMarketplace(activeTank, spec);
                              }}
                              style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
                            >
                              {casualModeActive ? "List for Sale" : "Sell"}
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* 2.3 HISTORY SUB-TAB: Water quality logging lists */}
              {detailSubTab === "history" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "250px", overflowY: "auto" }}>
                  <strong style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Environmental Logs History</strong>
                  {activeTank.logs.length === 0 ? (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "2rem", textAlign: "center" }}>No logs registered for this system yet.</p>
                  ) : (
                    [...activeTank.logs].reverse().map((log, idx) => (
                      <div key={idx} style={{ padding: "0.75rem", background: "rgba(255,255,255,0.01)", border: "1px solid var(--glass-border)", borderRadius: "4px", fontSize: "0.75rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                          <strong>{new Date(log.timestamp * 1000).toLocaleString()}</strong>
                          <span style={{ color: "var(--accent-blue)" }}>
                            Temp: {log.tempCelsiusX10/10}°C ({((log.tempCelsiusX10/10)*9/5 + 32).toFixed(1)}°F) | pH: {log.phX10/10}
                          </span>
                        </div>
                        {log.notes && <p style={{ color: "var(--text-secondary)" }}>"{log.notes}"</p>}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* 2.4 NOTES SUB-TAB: Dosing & Water changes notes */}
              {detailSubTab === "notes" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "250px", overflowY: "auto" }}>
                  <strong style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Husbandry Activity & Observations</strong>
                  {activeTank.logs.filter(l => l.notes).length === 0 && localActionLogs.length === 0 ? (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "2rem", textAlign: "center" }}>No activity logs found.</p>
                  ) : (
                    <>
                      {/* Render Dexie Action Logs */}
                      {localActionLogs.map((log) => (
                        <div key={`local-${log.id}`} style={{ padding: "0.75rem", background: "rgba(56, 189, 248, 0.04)", borderRadius: "4px", fontSize: "0.8rem", borderLeft: "2px solid var(--accent-blue)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                            <strong style={{ color: "#38bdf8" }}>{log.actionType}</strong>
                            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{new Date(log.timestamp * 1000).toLocaleString()}</span>
                          </div>
                          <span style={{ color: "#fff" }}>{log.details}</span>
                        </div>
                      ))}
                      
                      {/* Render Contract logs */}
                      {[...activeTank.logs].filter(l => l.notes).reverse().map((log, idx) => (
                        <div key={`contract-${idx}`} style={{ padding: "0.75rem", background: "rgba(0,0,0,0.15)", borderRadius: "4px", fontSize: "0.8rem", borderLeft: "2px solid var(--accent-green)" }}>
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block" }}>{new Date(log.timestamp * 1000).toLocaleDateString()}</span>
                          <span style={{ color: "#fff" }}>{log.notes}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* 2.5 SOCIAL SUB-TAB: Tank Progress Social Feed */}
              {detailSubTab === "social" && (
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
                        // Store tank info for the composer to pick up
                        window.dispatchEvent(new CustomEvent("reef_share_tank", {
                          detail: { tankId: activeTank.id, tankName: activeTank.name || `Tank ${activeTank.id.slice(0, 8)}` }
                        }));
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
                      {casualModeActive ? "Share 🪸" : "Post Current"}
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
                        const isExpert = comment.isExpertAudit;
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
                                  background: isExpert ? "rgba(255, 215, 0, 0.15)" : "rgba(255, 255, 255, 0.05)",
                                  color: isExpert ? "#ffd700" : "var(--text-secondary)",
                                  border: isExpert ? "1px solid #ffd700" : "1px solid var(--glass-border)"
                                }}>
                                  {isExpert ? "⭐ Verified Master Breeder" : "Hobbyist"}
                                </span>
                              </div>
                              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                                {getRelativeTime(comment.timestamp)}
                              </span>
                            </div>
                            <p style={{ fontSize: "0.85rem", color: isExpert ? "#fff" : "var(--text-primary)", lineHeight: "1.35", margin: 0 }}>
                              {comment.text}
                            </p>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Comment input form */}
                  <form onSubmit={handleCommentSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", borderTop: "1px solid var(--glass-border)", paddingTop: "0.75rem" }}>
                    {residingSpecies.length > 0 && (
                      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.25rem", alignItems: "center" }}>
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
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Share progress update or ask for an expert audit..."
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
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Post as:</span>
                        <select
                          value={commenterRole}
                          onChange={(e) => setCommenterRole(e.target.value)}
                          style={{
                            padding: "0.25rem 0.5rem",
                            background: "rgba(8, 12, 20, 0.9)",
                            border: "1px solid var(--glass-border)",
                            color: "#fff",
                            borderRadius: "4px",
                            fontSize: "0.75rem"
                          }}
                        >
                          <option value="hobbyist">Casual Hobbyist</option>
                          <option value="master-breeder">Verified Master Breeder</option>
                        </select>
                      </div>
                      <button
                        type="submit"
                        className="btn-primary"
                        style={{ padding: "0.35rem 0.85rem", fontSize: "0.75rem" }}
                      >
                        [ Publish Update ]
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>

            {/* Quick Actions Card Footer */}
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", borderTop: "1px solid var(--glass-border)", paddingTop: "0.75rem", marginTop: "auto" }}>
              <button 
                className="btn-secondary" 
                style={{ flex: "1 1 auto", padding: "0.4rem 0.6rem", fontSize: "0.7rem", whiteSpace: "nowrap" }}
                onClick={() => {
                  setInlineDetailType("population");
                  setInlineDetailText(getSpecimenCount(activeTank).toString());
                  setInlineDetailOpen(true);
                  setTimeout(() => inlineDetailRef.current?.focus(), 100);
                }}
              >
                🐟 Count
              </button>

              <button 
                className="btn-secondary" 
                style={{ flex: "1 1 auto", padding: "0.4rem 0.6rem", fontSize: "0.7rem", whiteSpace: "nowrap" }}
                onClick={() => {
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
                }}
              >
                🧪 Test
              </button>

              <label
                className="btn-secondary"
                style={{ flex: "1 1 auto", padding: "0.4rem 0.6rem", fontSize: "0.7rem", whiteSpace: "nowrap", cursor: "pointer", textAlign: "center", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >
                📷 Photo
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const { compressImage } = await import("../utils/imageCompression");
                      const compressed = await compressImage(file, { maxWidth: 1200, quality: 0.8 });
                      localStorage.setItem(`aquadex_tank_photo_${activeTank.id}`, compressed);
                      // Force re-render
                      setActiveTank({ ...activeTank });
                    } catch (err) {
                      console.error("Photo upload failed:", err);
                    }
                  }}
                />
              </label>
              
              {activeTank.specimens.length > 0 && onListOnMarketplace && (
                <button 
                  className="btn-primary" 
                  style={{ flex: "1 1 auto", padding: "0.4rem 0.6rem", fontSize: "0.7rem", whiteSpace: "nowrap", justifyContent: "center" }}
                  onClick={() => onListOnMarketplace(activeTank, activeTank.specimens[0])}
                >
                  🏪 List
                </button>
              )}
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

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>Salinity (SG)</span>
                    <strong style={{ color: isInsideEnvelope(Number(formData.salinity), minSafeSalinity, maxSafeSalinity) ? "#4ade80" : "#f87171" }}>
                      {formData.salinity} {isInsideEnvelope(Number(formData.salinity), minSafeSalinity, maxSafeSalinity) ? "(Ideal)" : "(Warning)"}
                    </strong>
                  </div>
                  <input 
                    type="range" 
                    min="1.0000" 
                    max="1.0300" 
                    step="0.0001" 
                    value={formData.salinity}
                    onChange={(e) => setFormData({ ...formData, salinity: e.target.value })}
                    style={{
                      width: "100%",
                      height: "6px",
                      borderRadius: "3px",
                      background: getTrackBackground(1.0000, 1.0300, minSafeSalinity, maxSafeSalinity),
                      outline: "none",
                      accentColor: isInsideEnvelope(Number(formData.salinity), minSafeSalinity, maxSafeSalinity) ? "#22c55e" : "#ef4444",
                      cursor: "pointer"
                    }}
                  />
                </div>
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
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
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
            <input
              ref={inlineDetailRef}
              type="text"
              value={inlineDetailText}
              onChange={(e) => setInlineDetailText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleInlineDetailSubmit(); }}
              placeholder={inlineDetailType === "feed" ? "e.g. Frozen brine shrimp, flakes..." : inlineDetailType === "population" ? "Enter specimen count..." : "e.g. Scraped algae, wiped glass..."}
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
          </div>
        </div>
      )}
    </div>
  );
}
