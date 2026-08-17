import React, { useState, useEffect, useRef } from "react";
import { ethers, Contract } from "ethers";
import { FishSimple, Flask, Drop, Asterisk } from "@phosphor-icons/react";
import aquadexAbi from "../abi/AquadexManager.json";
import { awardXp, XP_ACTIONS, getPointsSuffix } from "../utils/xp";
import { logCareAction, logCareActionBulk } from "../services/careLog";
import { FacilityTreeView } from "./FacilityTreeView";
import { getProvider } from "../utils/smartAccount";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { db } from "../db";
import { PoseidonChatConsole } from "./PoseidonChatConsole";
import { mapContractError } from "../utils/errorHandler";
import { TankQRCode } from "./TankQRCode";
import { CompanionFishEntity } from "./CompanionFishEntity";
import { TankFishVisualization } from "./TankFishVisualization";
import { useUserTanks } from "../hooks/useUserTanks";
import { useSpeciesData } from "../hooks/useSpeciesData";
import { useContractSpecies } from "../hooks/useSpeciesData";
import { useQueryClient } from "@tanstack/react-query";
import { relayMoveSpecimen, relayLogWaterParameters, relayMintSpecimen } from "../services/relayer";
import { archiveSpecimens, retireSpecimens } from "../services/specimenLifecycle";
import {
  RETIREMENT_OUTCOMES,
  SPECIMEN_STATUS,
  retirementOutcomeLabel,
} from "../utils/specimenIdentity";
import { SEX, SEX_OPTIONS, isKnownSex, normalizeSex, sexOptionLabel, sexSymbol } from "../utils/specimenSex";
import { LIFE_STAGE_OPTIONS, lifeStageOptionLabel, canBeCertificated } from "../utils/lifeStage";
import { PROVENANCE, provenanceText } from "../utils/provenance";
import { useUnitPrefs } from "../hooks/useUnitPrefs";
import { celsiusToFahrenheit, formatTemperature, showCelsius, showFahrenheit } from "../utils/units";
import { createCurrent } from "../services/reefApi";
import { isSupabaseConfigured } from "../services/supabaseClient";
import { ActivityLog } from "./ActivityLog";
import { NotesTab } from "./NotesTab";
import { QuickLogPanel } from "./QuickLogPanel";
import { FryNursery } from "./FryNursery";
import { CasualTankGallery } from "./logbook/CasualTankGallery";
import { TankInhabitants } from "./logbook/TankInhabitants";
import { TankScanner } from "./logbook/TankScanner";
import { JournalTimeline } from "./logbook/JournalTimeline";
import { CareCoach } from "./logbook/CareCoach";
import { ProOpsGrid } from "./logbook/ProOpsGrid";
import { LocationGroupBar, TANK_DND_MIME } from "./logbook/LocationGroupBar";
import { useTankGroups } from "../hooks/useTankGroups";
import {
  ALL_GROUPS,
  UNASSIGNED,
  assignTankToGroup,
  createGroup,
  deleteGroup,
  filterTanksByGroup,
  renameGroup,
  tankGroupName,
} from "../services/tankGroups";
import { ParamTrends } from "./logbook/ParamTrends";
import { SpeciesCareGuide } from "./logbook/SpeciesCareGuide";
import { HealthFlagExplainer } from "./logbook/HealthFlagExplainer";
import { StockingGuidance } from "./logbook/StockingGuidance";
import { ScheduleEditor } from "./logbook/ScheduleEditor";
import { LivingTank } from "./logbook/LivingTank";
import { deriveTankHealth } from "../utils/tankHealth";
import { getOrInitTankSchedules } from "../services/tankSchedules";
import { getTankPhoto, putTankPhoto, putSpecimenPhoto, resolveSpecimenPhoto } from "../services/tankMedia";
import { isInsideEnvelope, getTrackBackground, CONTAINMENT_TYPES, getWaterEnvelope, tankTypeLabel } from "../utils/tankUtils";
export function TankList({ contractAddress, walletAccount, onViewLineage, onListOnMarketplace, onSelectSpecimen, casualModeActive = false }) {
  const queryClient = useQueryClient();
  // Settings → Units & Formatting. `primaryTempUnit` collapses "both" to the
  // leading scale, for lines (like the ideal range) that show one value only.
  const { tempUnit } = useUnitPrefs();
  const primaryTempUnit = showCelsius(tempUnit) ? "c" : "f";
  const { data: fishbaseData = [] } = useSpeciesData();
  const { data: fetchedTanks = [], isLoading: tanksLoading, error: tanksError, refetch: refetchTanks } = useUserTanks(contractAddress, walletAccount);
  const tanks = fetchedTanks;
  const loading = tanksLoading;
  const error = tanksError ? (tanksError.message || "Failed to fetch tank systems from the secure registry.") : null;

  const [userAlias, setUserAlias] = useState("");
  const [draggedOverTankId, setDraggedOverTankId] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [localActionLogs, setLocalActionLogs] = useState([]);
  const [residingSpecies, setResidingSpecies] = useState([]);
  // Themed confirm dialog — replaces window.confirm() for a consistent, on-brand UX
  // { title, message, confirmLabel, danger, onConfirm } for a yes/no confirm, or
  // { title, message, danger, choices: [{ key, label, detail, icon, danger, onSelect }] }
  // when the caller needs the user to PICK an outcome rather than just assent.
  // The multi-choice form exists so an action with more than one correct
  // resolution can't silently pick one — see FryNursery's retire flow, which has
  // to distinguish "rehomed" from "deceased".
  const [confirmDialog, setConfirmDialog] = useState(null);

  const requestConfirm = ({ title, message, confirmLabel = "Confirm", danger = false, onConfirm, choices = null }) => {
    setConfirmDialog({ title, message, confirmLabel, danger, onConfirm, choices });
  };

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

  // Layout View Modes: "list" | "tree" | "quicklog"
  const [viewMode, setViewMode] = useState("list");
  // Pro list rendering: "grid" (Fish Room Ops) | "cards" (verbose legacy cards)
  const [proListView, setProListView] = useState("grid");
  const [openRegisterOnTreeMount, setOpenRegisterOnTreeMount] = useState(false);

  // Filter & Search states
  // selectedLocation is ALL_GROUPS, UNASSIGNED, or a user-defined group name.
  const [selectedLocation, setSelectedLocation] = useState(ALL_GROUPS);
  const [locationsFilterOpen, setLocationsFilterOpen] = useState(false);
  // Location groups are the keeper's own (services/tankGroups): the chip list
  // merges hand-created groups with any group name already on a tank record.
  const { groups: locationGroups, reload: reloadLocationGroups } = useTankGroups(walletAccount, tanks);
  // True while a tank card is being dragged, so the group chips can advertise
  // themselves as drop targets.
  const [tankDragActive, setTankDragActive] = useState(false);

  // Reset selected location when switching back to casual mode
  useEffect(() => {
    if (casualModeActive) {
      setSelectedLocation(ALL_GROUPS);
      setLocationsFilterOpen(false);
      setViewMode("list");
    }
  }, [casualModeActive]);

  // Tank QR scanner (real camera scan → open the matching tank)
  const [scannerOpen, setScannerOpen] = useState(false);

  // Quick Log Drawer State
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [quickLogTankId, setQuickLogTankId] = useState("");
  const [quickLogMode, setQuickLogMode] = useState("water_test"); // "water_test" | "action"

  // Add Fish Drawer State (inline, no navigation)
  const [addFishOpen, setAddFishOpen] = useState(false);
  const [addFishTankId, setAddFishTankId] = useState(null);
  const [addFishSpeciesId, setAddFishSpeciesId] = useState("");
  const [addFishSearch, setAddFishSearch] = useState("");
  const [addFishSubmitting, setAddFishSubmitting] = useState(false);
  const [addFishError, setAddFishError] = useState(null);
  const [addFishQty, setAddFishQty] = useState(1);
  const [addFishGender, setAddFishGender] = useState(SEX.UNSEXED);
  // "" means not recorded, and stays not recorded — never coerced to a stage.
  const [addFishLifeStage, setAddFishLifeStage] = useState("");
  const { data: contractSpecies = [] } = useContractSpecies(contractAddress);
  const [poseidonChatOpen, setPoseidonChatOpen] = useState(false);
  const [poseidonSeed, setPoseidonSeed] = useState(null); // grounded question seeded from a contextual "Ask Poseidon" tip
  const [activeTankSchedules, setActiveTankSchedules] = useState([]); // schedules for the open tank, so the hero ambient reflects overdue maintenance
  // Photos for the open tank. Specimen photos come from resolveSpecimenPhoto, the
  // single precedence order (hosted → Dexie → legacy localStorage → none). Writes go
  // through tankMedia, so they survive a cache clear.
  const [activeTankPhoto, setActiveTankPhoto] = useState(null);
  const [specimenPhotos, setSpecimenPhotos] = useState({}); // specimenId -> dataUrl
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const photoInputRef = useRef(null);
  const [uploadingSpecimenId, setUploadingSpecimenId] = useState(null);
  const specimenPhotoInputRef = useRef(null);
  const [farewellSpecimen, setFarewellSpecimen] = useState(null);
  // Pro list-card ⋯ overflow menu. Stored as a viewport-anchored position, not a
  // bare id, because the menu is rendered once as a fixed-position layer outside
  // the card list (renderTankCardMenu) rather than nested inside the card.
  const [cardMenu, setCardMenu] = useState(null); // { tankId, top, left, width }
  const cardMenuRef = useRef(null);

  // NOTE: both menu effects live up here with the state, ABOVE this component's
  // early returns (not-connected / loading / error). Declaring them further down
  // next to the menu's render helpers would change the hook count between a
  // loading render and a loaded one — "Rendered more hooks than during the
  // previous render".

  // A viewport-anchored layer drifts away from its trigger on scroll/resize, so
  // dismiss it instead of letting it float off.
  useEffect(() => {
    if (!cardMenu) return;
    const dismiss = () => setCardMenu(null);
    const onKey = (e) => { if (e.key === "Escape") setCardMenu(null); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [cardMenu]);

  // Measured correction: the open-position estimate can still run past the bottom
  // edge (the menu grows with the number of groups), so clamp once mounted.
  useEffect(() => {
    if (!cardMenu || !cardMenuRef.current) return;
    const height = cardMenuRef.current.offsetHeight;
    const maxTop = window.innerHeight - height - 8;
    if (cardMenu.top > maxTop) {
      setCardMenu((cur) => (cur ? { ...cur, top: Math.max(8, maxTop) } : cur));
    }
  }, [cardMenu]);

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

  useEffect(() => {
    if (quickLogOpen) {
      if (!bulkRackTarget && uniqueRacks.length > 0) {
        setBulkRackTarget(uniqueRacks[0]);
      }
      if (!bulkRoomTarget && uniqueRooms.length > 0) {
        setBulkRoomTarget(uniqueRooms[0]);
      }
    }
  }, [quickLogOpen, uniqueRacks, uniqueRooms, bulkRackTarget, bulkRoomTarget]);

  const BULK_ACTION_LABELS = {
    feed:         { emoji: "🥣", label: "Feeding",        defaultDetail: "Routine feeding (standard diet)" },
    water_change: { emoji: "💧", label: "Water Change",   defaultDetail: "Partial water change performed" },
    treatment:    { emoji: "💊", label: "Treatment",      defaultDetail: "Medication / treatment applied" },
    observation:  { emoji: "📋", label: "Observation",    defaultDetail: "Routine visual inspection" },
  };

  // Maps a bulk-log action to the actionType string the Dexie hook (useXPSync)
  // actually checks, and the XP_ACTIONS cooldown key for that type. "Treatment"
  // and "Observation" have no defined XP action — they're logged but earn no XP.
  const BULK_ACTION_TO_HOOK = {
    feed:         { actionType: "Feed",         actionKey: "LOG_FEEDING" },
    water_change: { actionType: "Water Change", actionKey: "LOG_WATER" },
  };

  const handleBulkLogSubmit = async () => {
    const targets = getBulkTargetTanks();
    if (targets.length === 0) return;
    setBulkLogSubmitting(true);
    setBulkLogResult(null);
    const detail = bulkLogDetail.trim() || BULK_ACTION_LABELS[bulkLogAction].defaultDetail;
    const ts = Math.round(Date.now() / 1000);
    const hookInfo = BULK_ACTION_TO_HOOK[bulkLogAction];
    try {
      // Each entry's actionType must match what the Dexie "creating" hook in
      // useXPSync checks for, or the tank earns no XP for it at all — and each
      // award still goes through that hook's per-tank cooldown (no separate
      // addXp() call here, which previously let a "Log All" spam-click farm
      // unlimited XP across every tank in the rack with no cooldown).
      const bulkActionType = hookInfo ? hookInfo.actionType : BULK_ACTION_LABELS[bulkLogAction].label;
      await logCareActionBulk({ tankIds: targets.map((t) => t.id), actionType: bulkActionType, details: detail, timestamp: ts });
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
  const [proPopGender, setProPopGender] = useState(SEX.UNSEXED);
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
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
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

  // Load the open tank's maintenance schedules so the detail hero's living-water
  // ambient reflects overdue maintenance (not just water parameters).
  useEffect(() => {
    let cancelled = false;
    if (activeTank?.id == null) { setActiveTankSchedules([]); return; }
    getOrInitTankSchedules(activeTank.id)
      .then((rows) => { if (!cancelled) setActiveTankSchedules(rows || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeTank?.id]);

  // Load the open tank's photo + its specimens' photos (see the state declaration note).
  const specimenIdsKey = (activeTank?.specimens || []).map((s) => s.id).join(",");
  useEffect(() => {
    let cancelled = false;
    if (activeTank?.id == null) { setActiveTankPhoto(null); setSpecimenPhotos({}); return; }
    (async () => {
      const tankPhoto = (await getTankPhoto(activeTank.id)) || localStorage.getItem(`aquadex_tank_photo_${activeTank.id}`) || null;
      if (!cancelled) setActiveTankPhoto(tankPhoto);

      const specimens = (activeTank.specimens || []).filter((s) => !s.isBatchPlaceholder);
      const entries = await Promise.all(
        specimens.map(async (s) => {
          // One resolver, one precedence order (§9.3) — this used to be an ad-hoc
          // Dexie-then-localStorage chain, which is exactly the drift resolveSpecimenPhoto
          // exists to prevent. `url` is "" when nothing resolves, so the silhouette shows.
          const { url } = await resolveSpecimenPhoto(s.id);
          return [s.id, url || ""];
        })
      );
      if (!cancelled) setSpecimenPhotos(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [activeTank?.id, specimenIdsKey]);
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
    setAddFishGender(SEX.UNSEXED);
    // Cleared per open so a stage chosen for one batch is never silently applied
    // to the next — MintSpecimen leaves birthDate populated across registrations
    // and that is exactly the stale-value trap to avoid here.
    setAddFishLifeStage("");
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
          // Still 0 — genuinely unknown, and now passed through to the chain as 0
          // instead of being rewritten to "born today". The life stage below is
          // what carries the age information a keeper actually has.
          birthTimestamp: 0,
          lifeStage: addFishLifeStage || null,
          // This drawer only ever adds fish the keeper already owns from
          // elsewhere, so the trail demonstrably starts here.
          provenance: PROVENANCE.UNVERIFIED,
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

      awardXp("MINT_SPECIMEN", { quantity: count });
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

      awardXp("SPECIMEN_REHOMED");
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

  // Bulk move: rehome several specimens at once (Inhabitants grouping + stack drag).
  // Loops the same relayer primitive as the single move, then refreshes once so the
  // list/detail don't thrash with a toast+refetch per fish.
  const handleMoveSpecimensBulk = async (specimenIds, targetTankId) => {
    const ids = (Array.isArray(specimenIds) ? specimenIds : []).map(Number).filter(Boolean);
    if (ids.length === 0 || !targetTankId) return;
    if (activeTank && Number(activeTank.id) === Number(targetTankId)) {
      showToast("⚠️ Those fish are already in this tank!");
      return;
    }
    try {
      showToast(`🔄 Rehoming ${ids.length} fish to tank #${targetTankId}...`);
      let moved = 0;
      for (const specimenId of ids) {
        const result = await relayMoveSpecimen({ specimenId, targetTankId });
        if (result?.success) moved += 1;
      }
      // Was a flat 10 regardless of how many moved; now scales with the batch and
      // is validated as such.
      if (moved > 0) awardXp("SPECIMEN_REHOMED", { quantity: moved });
      showToast(moved === ids.length
        ? `✅ Moved ${moved} fish successfully!`
        : `Moved ${moved} of ${ids.length} fish.`);
      await fetchDashboardData();
      const fresh = await refetchTanks();
      if (activeTank) {
        const updated = fresh.data?.find((t) => t.id === activeTank.id);
        if (updated) setActiveTank(updated);
      }
    } catch (err) {
      console.error(err);
      showToast(`❌ ${mapContractError(err, casualModeActive)}`);
    }
  };

  // Generate + print the tank's QR label PDF. Reachable from the detail
  // quick-actions menu (was a click on the banner corner tag).
  const printTankQRLabel = async (tank) => {
    if (!tank) return;
    try {
      const { generateTankQRLabel } = await import("../utils/pdfExport");
      await generateTankQRLabel({
        tankId: tank.id,
        tankName: tank.name,
        facility: tank.facility,
        room: tank.room,
        rack: tank.rack,
        volumeLiters: tank.volumeLiters,
        containment: CONTAINMENT_TYPES[tank.containment],
      });
    } catch (err) {
      console.error("QR label generation failed:", err);
      showToast("Could not generate the QR label.");
    }
  };

  // Open the Poseidon console pre-seeded with a grounded, contextual question.
  // The console still routes any proposed write through its confirm-before-write bar.
  const askPoseidon = (prompt) => {
    setPoseidonSeed(prompt || null);
    setPoseidonChatOpen(true);
  };

  const logFeedClick = async () => {
    // Write + advisory cooldown check go through the careLog service; XP is still
    // awarded exclusively by the useXPSync actionLogs.creating hook.
    const { allowed } = await logCareAction({
      tankId: activeTank.id, walletAccount, actionType: "Feed", details: "Routine Feeding (Standard Diet)",
    });
    const suffix = getPointsSuffix(casualModeActive);
    showToast(allowed
      ? (casualModeActive
          ? `🥣 Yum! Your fish are loving it! +${XP_ACTIONS.LOG_FEEDING.points} ${suffix}!`
          : `🥣 Feeding logged (+${XP_ACTIONS.LOG_FEEDING.points} ${suffix})`)
      : `🥣 Feeding logged (already earned ${suffix} for this tank today)`
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
    const { allowed } = await logCareAction({
      tankId: activeTank.id, walletAccount, actionType: "Scraped Algae", details: "Routine Algae Scraped",
    });
    const suffix = getPointsSuffix(casualModeActive);
    showToast(allowed
      ? (casualModeActive
          ? `🧹 Sparkly clean! Your tank is gleaming! +${XP_ACTIONS.LOG_FEEDING.points} ${suffix}!`
          : `🧹 Maintenance logged (+${XP_ACTIONS.LOG_FEEDING.points} ${suffix})`)
      : `🧹 Maintenance logged (already earned ${suffix} for this tank today)`
    );
    fetchLocalActionLogs();
    await fetchDashboardData();
  };

  const logWaterChange = async () => {
    const { allowed } = await logCareAction({
      tankId: activeTank.id, walletAccount, actionType: "Water Change", details: "Partial water change performed",
    });
    const suffix = getPointsSuffix(casualModeActive);
    showToast(allowed
      ? (casualModeActive
          ? `💧 Fresh water! Your fish are loving it! +${XP_ACTIONS.LOG_WATER.points} ${suffix}!`
          : `💧 Water change logged (+${XP_ACTIONS.LOG_WATER.points} ${suffix})`)
      : `💧 Water change logged (already earned ${suffix} for this tank recently)`
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
      const { allowed } = await logCareAction({
        tankId: activeTank.id, walletAccount, actionType: "Feed", details,
      });
      const suffix = getPointsSuffix(casualModeActive);
      showToast(allowed
        ? (casualModeActive
            ? `🥣 Custom meal logged — great care! +${XP_ACTIONS.LOG_FEEDING.points} ${suffix}!`
            : `🥣 Custom feeding logged (+${XP_ACTIONS.LOG_FEEDING.points} ${suffix})`)
        : `🥣 Custom feeding logged (already earned ${suffix} for this tank today)`
      );
    } else if (inlineDetailType === "algae") {
      const { allowed } = await logCareAction({
        tankId: activeTank.id, walletAccount, actionType: "Scraped Algae", details,
      });
      const suffix = getPointsSuffix(casualModeActive);
      showToast(allowed
        ? (casualModeActive
            ? `🧹 Custom clean logged — looking great! +${XP_ACTIONS.LOG_FEEDING.points} ${suffix}!`
            : `🧹 Custom maintenance logged (+${XP_ACTIONS.LOG_FEEDING.points} ${suffix})`)
        : `🧹 Custom maintenance logged (already earned ${suffix} for this tank today)`
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

      awardXp("MINT_SPECIMEN", { quantity: count });
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
    const { allowed } = await logCareAction({
      tankId: activeTank.id, walletAccount, actionType: "Quick Water Test",
      details: "Baseline Water Test (Temp: 24.5°C, pH: 7.2)",
    });
    const suffix = getPointsSuffix(casualModeActive);
    showToast(allowed
      ? (casualModeActive
          ? `🧪 Water looks perfect — great job! +${XP_ACTIONS.LOG_PARAMETERS.points} ${suffix}!`
          : `🧪 Water test recorded (+${XP_ACTIONS.LOG_PARAMETERS.points} ${suffix})`)
      : `🧪 Water test recorded (already earned ${suffix} for this tank recently)`
    );
    fetchLocalActionLogs();
    await fetchDashboardData();
  };

  // CareCoach dispatch — map the suggested habit to the existing logging handlers
  // (which handle the toast + XP + refresh). Casual habit-coaching loop (Task 5).
  const handleCoachAction = (kind) => {
    if (kind === "test") return logTestClick();
    if (kind === "waterChange") return logWaterChange();
  };

  // Pro Fish Room worklist — batch-log a maintenance kind across all due tanks
  // (Task 6). careLog advances each tank's schedule; a confirm avoids surprises.
  const handleWorklistLog = (kind, tankIds) => {
    const actionType = kind === "waterChange" ? "Water Change" : kind === "test" ? "Quick Water Test" : null;
    if (!actionType || !tankIds?.length) return;
    const label = kind === "waterChange" ? "water change" : "water test";
    requestConfirm({
      title: `Log ${label} for ${tankIds.length} tank${tankIds.length !== 1 ? "s" : ""}?`,
      message: `Logs a ${label} on every tank due today and resets their schedules.`,
      confirmLabel: `Log ${tankIds.length}`,
      danger: false,
      onConfirm: async () => {
        try {
          await logCareActionBulk({ tankIds, actionType, details: `Batch ${label} via worklist` });
          showToast(`✅ Logged ${label} for ${tankIds.length} tank${tankIds.length !== 1 ? "s" : ""}`);
          await fetchDashboardData();
        } catch (err) {
          console.error("Worklist batch log failed:", err);
          showToast("❌ Batch log failed. Please try again.");
        }
      },
    });
  };

  const logTestLongPress = () => {
    const lastLog = activeTank.latestLog;
    setFormData({
      temp: lastLog ? (lastLog.tempCelsiusX10/10).toString() : "24.5",
      ph: lastLog ? (lastLog.phX10/10).toString() : "7.2",
      ammonia: lastLog?.ammoniaPpmX100 ? (lastLog.ammoniaPpmX100/100).toString() : "0.0",
      nitrite: lastLog?.nitritePpmX100 ? (lastLog.nitritePpmX100/100).toString() : "0.0",
      nitrate: lastLog?.nitratePpmX100 ? (lastLog.nitratePpmX100/100).toString() : "5.0",
      notes: ""
    });
    setQuickLogMode("water_test");
    setBulkLogScope("single");
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
      const userTier = companionData?.currentTier || "Shallow";
      const normalizedTier = userTier.toLowerCase().replace("-tier", "");
      role = `${normalizedTier}-breeder`;
    }

    const text = commentText.trim();
    const isExpertAudit = (role === "master-breeder" || composerCategory === "lab-audit") && text.length >= 60;

    if (isExpertAudit) {
      // Only the GIVER's award belongs to the person writing the comment.
      //
      // This used to grant 25 ("Mentor XP") AND 50 ("Prestige XP (Received Expert
      // Audit)") to the same account — i.e. the commenter collected the receiving
      // keeper's reward as well as their own, 75 points for one side of a two-sided
      // interaction. AUDIT_RECEIVED belongs to the tank's owner and cannot be
      // granted from here, because a client can only ever award XP to itself; it
      // needs a server-side grant keyed to the audited wallet.
      awardXp("AUDIT_GIVEN");
    } else {
      awardXp("POST_COMMENT");
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
    const targets = bulkLogScope === "single" 
      ? (targetTankId ? [tanks.find(t => t.id === Number(targetTankId))] : []) 
      : getBulkTargetTanks();
    if (targets.length === 0) return;

    setSubmitting(true);
    setModalError(null);
    setTxHash(null);
    try {
      const tempCelsiusX10 = Math.round(parseFloat(formData.temp) * 10);
      const phX10 = Math.round(parseFloat(formData.ph) * 10);
      const ammoniaPpmX100 = Math.round(parseFloat(formData.ammonia) * 100);
      const nitritePpmX100 = Math.round(parseFloat(formData.nitrite) * 100);
      const nitratePpmX100 = Math.round(parseFloat(formData.nitrate) * 100);

      for (const tank of targets) {
        const result = await relayLogWaterParameters({
          tankId: tank.id,
          tempCelsiusX10,
          phX10,
          salinitySgX10000: 0,
          ammoniaPpmX100,
          nitritePpmX100,
          nitratePpmX100,
          notes: formData.notes,
        });

        if (!result.success) {
          throw new Error(result.error || `Failed to log parameters for tank ${tank.name || tank.id}`);
        }
      }

      awardXp("LOG_PARAMETERS", { quantity: targets.length });

      setFormData({
        temp: "24.5",
        ph: "7.2",
        ammonia: "0.0",
        nitrite: "0.0",
        nitrate: "5.0",
        notes: ""
      });
      setQuickLogOpen(false);
      setTxHash(null);

      await fetchDashboardData();
      
      if (activeTank) {
        const isTargeted = targets.some(t => t.id === activeTank.id);
        if (isTargeted) {
          const updated = tanks.find(t => t.id === activeTank.id);
          if (updated) {
            setActiveTank(updated);
          }
        }
      }
      showToast(`🧪 Water test logged for ${targets.length} unit${targets.length !== 1 ? "s" : ""}`);
    } catch (err) {
      console.error("Failed to log parameters:", err);
      setModalError(err.reason || err.message || "Failed to execute transaction.");
    } finally {
      setSubmitting(false);
    }
  };

  // Open the real camera QR scanner.
  const triggerScan = () => setScannerOpen(true);

  // A scanned (or manually entered) tank id resolved to one of the user's tanks.
  const handleScanSelect = (tank) => {
    setScannerOpen(false);
    if (tank) {
      setActiveTank(tank);
      showToast(`📷 Opened ${tank.name || `tank #${tank.id}`}`);
    }
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
  // Safe ranges come from the single envelope source (tankUtils.getWaterEnvelope),
  // not an inline per-type if/else. Saltwater is gone; unknown types fall back to FW.
  const _env = getWaterEnvelope(selectedLogTank ? selectedLogTank.tankType : 0);
  const minSafeTemp = _env.tempMin;
  const maxSafeTemp = _env.tempMax;
  const minSafePh = _env.phMin;
  const maxSafePh = _env.phMax;

  // Location filter setup
  // Group CRUD + assignment. Writes go to Dexie (group list) and to the tank's
  // `facility` field (membership), then the tanks query is invalidated so every
  // chip count, breadcrumb, and filtered list re-derives from one source.
  const refreshAfterGroupWrite = async () => {
    await reloadLocationGroups();
    queryClient.invalidateQueries({ queryKey: ["tanks", walletAccount] });
  };

  const handleCreateGroup = async (name) => {
    const created = await createGroup(walletAccount, name, locationGroups);
    await refreshAfterGroupWrite();
    showToast(`📍 Group "${created}" created.`);
  };

  const handleRenameGroup = async (from, to) => {
    const moved = await renameGroup(walletAccount, from, to, tanks, locationGroups);
    if (selectedLocation === from) setSelectedLocation(to);
    await refreshAfterGroupWrite();
    showToast(`📍 Renamed to "${to}"${moved ? ` — ${moved} tank${moved === 1 ? "" : "s"} updated.` : "."}`);
  };

  const handleDeleteGroup = (name) => {
    const memberCount = filterTanksByGroup(tanks, name).length;
    requestConfirm({
      title: "🗑️ Delete group",
      message: memberCount
        ? `Delete the group "${name}"? The ${memberCount} tank${memberCount === 1 ? "" : "s"} in it stay put — they just become Unassigned.`
        : `Delete the empty group "${name}"?`,
      confirmLabel: "Delete group",
      danger: true,
      onConfirm: async () => {
        try {
          await deleteGroup(walletAccount, name, tanks);
          if (selectedLocation === name) setSelectedLocation(ALL_GROUPS);
          await refreshAfterGroupWrite();
          showToast(`Group "${name}" deleted.`);
        } catch (err) {
          console.error("Delete group failed:", err);
          showToast("Failed to delete that group.");
        }
      },
    });
  };

  /** Move one tank into a group (drag-drop onto a chip, or the card's ⋯ menu). */
  const handleAssignTankToGroup = async (tankId, group) => {
    const tank = tanks.find((t) => Number(t.id) === Number(tankId));
    if (!tank) return;
    if (group !== UNASSIGNED && tankGroupName(tank) === group) return;
    try {
      const assigned = await assignTankToGroup(tank, group);
      queryClient.invalidateQueries({ queryKey: ["tanks", walletAccount] });
      // The open detail panel holds its own copy of the tank, so patch it too or
      // the header breadcrumb would keep showing the old group until reopened.
      setActiveTank((cur) => (cur && Number(cur.id) === Number(tank.id) ? { ...cur, facility: assigned } : cur));
      showToast(
        group === UNASSIGNED
          ? `📍 "${tank.name}" removed from its group.`
          : `📍 "${tank.name}" moved to ${group}.`
      );
    } catch (err) {
      console.error("Assign tank to group failed:", err);
      showToast("Failed to move that tank.");
    }
  };

  /** Shared drag-source wiring for a tank row/card. */
  const tankDragProps = (tank) => ({
    draggable: true,
    onDragStart: (e) => {
      // Don't hijack a drag that starts on a control inside the card.
      if (e.target?.closest?.("button, input, select, textarea, a")) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData(TANK_DND_MIME, String(tank.id));
      e.dataTransfer.effectAllowed = "move";
      setTankDragActive(true);
    },
    onDragEnd: () => setTankDragActive(false),
  });

  // ---------------------------------------------------------------------------
  // Pro card ⋯ overflow menu
  //
  // Previously this popover lived inside the card and relied on z-index alone.
  // That never worked: each card carries an inline `transform`, which makes it a
  // stacking context, so the popover was confined to its own card's layer and the
  // next card down painted straight over the bottom menu item — clicks landed on
  // that card instead (it "just selected the tank"). The same transform also made
  // the position:fixed click-outside scrim cover only the card.
  //
  // The fix is structural, not another z-index bump: anchor the menu in viewport
  // coordinates and render it once, outside the list.
  // ---------------------------------------------------------------------------
  const closeCardMenu = () => setCardMenu(null);

  const toggleCardMenu = (e, tankId) => {
    if (cardMenu?.tankId === tankId) { closeCardMenu(); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const width = 262;
    const estimatedHeight = 240;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - rect.bottom;
    // Flip above the trigger when there isn't room below, so the last item is
    // always reachable even for the bottom card in the list.
    const top = spaceBelow >= estimatedHeight + 12
      ? rect.bottom + 6
      : Math.max(8, rect.top - estimatedHeight - 6);
    setCardMenu({ tankId, top, left, width });
  };

  const cardMenuItemStyle = (tone) => ({
    width: "100%",
    textAlign: "left",
    padding: "0.45rem 0.6rem",
    fontSize: "0.72rem",
    fontWeight: 500,
    borderRadius: "6px",
    cursor: "pointer",
    transition: "all 0.15s ease",
    border: tone === "danger" ? "1px solid rgba(248, 113, 113, 0.25)" : "1px solid rgba(251, 191, 36, 0.25)",
    background: tone === "danger" ? "rgba(248, 113, 113, 0.06)" : "rgba(251, 191, 36, 0.06)",
    color: tone === "danger" ? "var(--accent-red, #f87171)" : "var(--accent-amber, #fbbf24)",
  });

  const handleResetTankLogs = (tank) => {
    requestConfirm({
      title: casualModeActive ? "🔄 Reset Tank" : "🔄 Reset Unit",
      message: casualModeActive
        ? `Reset "${tank.name}"? This clears all water logs and action history but keeps your fish.`
        : `Reset unit "${tank.name}"? Purges telemetry & action logs. Specimens preserved.`,
      confirmLabel: casualModeActive ? "Reset Tank" : "Reset Unit",
      danger: false,
      onConfirm: async () => {
        try {
          await db.actionLogs.where("tankId").equals(tank.id).delete();
          await db.tanks.update(tank.id, {
            latestTestTimestamp: null,
            latestChangeTimestamp: null,
            waterParams: null,
          });
          queryClient.invalidateQueries({ queryKey: ["tanks", walletAccount] });
          showToast(casualModeActive ? "🔄 Tank reset! Starting fresh." : "Unit telemetry purged.");
        } catch (err) {
          console.error("Reset tank failed:", err);
          showToast("Failed to reset tank.");
        }
      },
    });
  };

  const handleRemoveTank = (tank) => {
    requestConfirm({
      title: casualModeActive ? "🗑️ Remove Tank" : "🗑️ Decommission Unit",
      message: casualModeActive
        ? `Remove "${tank.name}"? Your fish will be moved to the Nursery where you can reassign them later.`
        : `Decommission unit "${tank.name}"? Specimens will be moved to the Nursery (unassigned pool).`,
      confirmLabel: casualModeActive ? "Remove Tank" : "Decommission",
      danger: true,
      onConfirm: async () => {
        try {
          // Move all specimens from this tank to unassigned (nursery)
          const tankSpecimens = await db.specimens
            .where("currentTankId").equals(Number(tank.id))
            .filter(s => Number(s.status) === 0)
            .toArray();
          for (const spec of tankSpecimens) {
            await db.specimens.update(spec.id, { currentTankId: 0 });
          }
          // Clear the tank's embedded specimens array
          await db.tanks.update(tank.id, { active: false, specimens: [] });
          queryClient.invalidateQueries({ queryKey: ["tanks", walletAccount] });
          const fishCount = tankSpecimens.length;
          showToast(casualModeActive
            ? `🗑️ Tank removed. ${fishCount} fish moved to Nursery.`
            : `Unit decommissioned. ${fishCount} specimen${fishCount !== 1 ? "s" : ""} moved to Nursery.`);
        } catch (err) {
          console.error("Remove tank failed:", err);
          showToast("Failed to remove tank.");
        }
      },
    });
  };

  const renderTankCardMenu = () => {
    if (!cardMenu) return null;
    const tank = tanks.find((t) => Number(t.id) === Number(cardMenu.tankId));
    if (!tank) return null;
    const currentGroup = tankGroupName(tank);

    return (
      <>
        {/* Click-outside scrim. Fixed to the viewport (the card no longer creates
            a containing block for it), so a click anywhere dismisses the menu. */}
        <div
          onClick={closeCardMenu}
          onContextMenu={closeCardMenu}
          style={{ position: "fixed", inset: 0, zIndex: 1100 }}
        />
        <div
          ref={cardMenuRef}
          role="menu"
          aria-label={`Options for ${tank.name}`}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: cardMenu.top,
            left: cardMenu.left,
            width: cardMenu.width,
            zIndex: 1101,
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
            background: "rgba(8,25,48,0.98)",
            border: "1px solid var(--glass-border)",
            borderRadius: "8px",
            padding: "0.45rem",
            maxHeight: "calc(100vh - 16px)",
            overflowY: "auto",
            boxShadow: "0 12px 30px rgba(0,0,0,0.6)",
          }}
        >
          <span style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)", padding: "0.15rem 0.25rem" }}>
            Move to group
          </span>
          {locationGroups.length === 0 ? (
            <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", padding: "0 0.25rem 0.25rem" }}>
              No groups yet — create one with “+ New group” above.
            </span>
          ) : (
            locationGroups.map((group) => {
              const isCurrent = currentGroup.toLowerCase() === group.toLowerCase();
              return (
                <button
                  key={group}
                  type="button"
                  role="menuitem"
                  disabled={isCurrent}
                  onClick={async () => {
                    closeCardMenu();
                    await handleAssignTankToGroup(tank.id, group);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "0.4rem 0.6rem",
                    fontSize: "0.72rem",
                    fontWeight: 500,
                    borderRadius: "6px",
                    border: `1px solid ${isCurrent ? "rgba(168, 85, 247, 0.4)" : "rgba(56, 189, 248, 0.2)"}`,
                    background: isCurrent ? "rgba(168, 85, 247, 0.12)" : "rgba(56, 189, 248, 0.05)",
                    color: isCurrent ? "#e9d5ff" : "#bae6fd",
                    cursor: isCurrent ? "default" : "pointer",
                  }}
                >
                  📍 {group}{isCurrent ? " · current" : ""}
                </button>
              );
            })
          )}
          {currentGroup && (
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                closeCardMenu();
                await handleAssignTankToGroup(tank.id, UNASSIGNED);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "0.4rem 0.6rem",
                fontSize: "0.72rem",
                borderRadius: "6px",
                border: "1px dashed rgba(255,255,255,0.18)",
                background: "rgba(255,255,255,0.03)",
                color: "var(--text-secondary)",
                cursor: "pointer",
              }}
            >
              ◌ Remove from group
            </button>
          )}

          <div style={{ height: "1px", background: "rgba(255,255,255,0.07)", margin: "0.15rem 0" }} />

          <button
            type="button"
            role="menuitem"
            onClick={() => { closeCardMenu(); handleResetTankLogs(tank); }}
            style={cardMenuItemStyle("warn")}
          >
            🔄 Reset logs (keep fish)
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { closeCardMenu(); handleRemoveTank(tank); }}
            style={cardMenuItemStyle("danger")}
          >
            🗑️ Remove tank (fish → Nursery)
          </button>
        </div>
      </>
    );
  };
  
  // Filter the active list to the selected group. Membership is the tank's
  // `facility` field only — the previous facility||room||rack match let a single
  // tank satisfy three different chips at once and inflated every count.
  const filteredTanks = selectedLocation === ALL_GROUPS
    ? tanks 
    : filterTanksByGroup(tanks, selectedLocation);

  const topLevelTanks = filteredTanks.filter(t => t.parentUnitId === 0);

  // Check chemistry metrics warning — thresholds come from the single envelope
  // source (tankUtils), not copy-pasted magic numbers.
  const getChemistryAlerts = (tank) => {
    if (!tank.latestLog) return [];
    const env = getWaterEnvelope(tank.tankType);
    const ammonia = Number(tank.latestLog.ammoniaPpmX100) / 100;
    const nitrite = Number(tank.latestLog.nitritePpmX100) / 100;
    const nitrate = Number(tank.latestLog.nitratePpmX100) / 100;

    const alerts = [];
    if (ammonia > env.ammoniaMax) alerts.push(`High NH₃ (${ammonia} ppm)`);
    if (nitrite > env.nitriteMax) alerts.push(`High NO₂ (${nitrite} ppm)`);
    if (nitrate > env.nitrateMax) alerts.push(`High NO₃ (${nitrate} ppm)`);
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
            <button
              className={`tank-view-btn${viewMode === "quicklog" ? " tank-view-btn--active" : ""}`}
              onClick={() => setViewMode("quicklog")}
              role="radio"
              aria-checked={viewMode === "quicklog"}
            >
              <span>⚡</span>
              <span>Batch Log</span>
            </button>
          </div>
        )}

        {/* Spacer pushes Quick Log + Register to the right */}
        <div style={{ flex: 1 }} />

        {/* Quick Log */}
        <button
          className={`tank-action-pill tank-action-pill--secondary${casualModeActive ? " tank-action-pill--casual-secondary" : " tank-action-pill--pro-secondary"}`}
          onClick={() => {
            setQuickLogMode("water_test");
            setBulkLogScope("single");
            setQuickLogOpen(true);
          }}
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

      {/* 2. LOCATION GROUPS (Pro Mode Only) — keeper-defined, drag-to-assign */}
      {!casualModeActive && (
        <LocationGroupBar
          tanks={tanks}
          groups={locationGroups}
          selected={selectedLocation}
          dragActive={tankDragActive}
          onSelect={setSelectedLocation}
          onCreate={handleCreateGroup}
          onRename={handleRenameGroup}
          onDelete={handleDeleteGroup}
          onDropTank={handleAssignTankToGroup}
        />
      )}

      <div className="tank-detail-split-grid" style={{ display: "grid", gridTemplateColumns: activeTank ? "1.2fr 1fr" : "1fr", gap: "2rem", alignItems: "start" }}>
        {/* LEFT VIEW COMPONENT */}
        <div>
          {viewMode === "quicklog" ? (
            <QuickLogPanel
              tanks={tanks}
              casualModeActive={casualModeActive}
              onComplete={() => {
                refetchTanks();
                setViewMode("list");
              }}
            />
          ) : viewMode === "tree" ? (
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
                if (casualModeActive) setViewMode("list");
              }}
              openRegisterOnTreeMount={openRegisterOnTreeMount}
              onCloseRegister={() => {
                setOpenRegisterOnTreeMount(false);
                if (casualModeActive) setViewMode("list");
              }}
            />
          ) : (
            <div className="vertical-tank-rows">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <h3 style={{ fontSize: "1.25rem", color: "#fff" }}>{casualModeActive ? "🐠 My Tanks" : "Aquarium Containment Systems"}</h3>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  {!casualModeActive && (
                    <div className="ops-viewtoggle" role="radiogroup" aria-label="List view">
                      <button type="button" className={proListView === "grid" ? "active" : ""} onClick={() => setProListView("grid")} role="radio" aria-checked={proListView === "grid"}>⚡ Grid</button>
                      <button type="button" className={proListView === "cards" ? "active" : ""} onClick={() => setProListView("cards")} role="radio" aria-checked={proListView === "cards"}>🗂 Cards</button>
                    </div>
                  )}
                  <span className="badge badge-blue">{filteredTanks.length} Units Found</span>
                </div>
              </div>

              {/* Group-level averaged parameter trends — shown whenever the list is
                  narrowed to one group (Pro). Previously this only fired when the
                  selected chip happened to be a rack name. */}
              {!casualModeActive && selectedLocation !== ALL_GROUPS && selectedLocation !== UNASSIGNED && topLevelTanks.length > 1 && (
                <div style={{ marginBottom: "1rem" }}>
                  <ParamTrends tanks={topLevelTanks} title={`"${selectedLocation}" — averaged trends`} />
                </div>
              )}

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
                        : "Register your first containment unit to begin. Head to the Breeder Tools tab or use the facility tree view to define your system topology."}
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
                    <p style={{ color: "var(--text-muted)" }}>
                      {selectedLocation !== ALL_GROUPS && selectedLocation !== UNASSIGNED
                        ? `Nothing in "${selectedLocation}" yet — pick All, then drag a tank onto the group chip (or use the tank's ⋯ menu) to move it here.`
                        : "No top-level units match the current filters."}
                    </p>
                  </div>
                )
              ) : casualModeActive ? (
                <CasualTankGallery
                  tanks={topLevelTanks}
                  fishbaseData={fishbaseData}
                  activeTankId={activeTank?.id}
                  draggedOverTankId={draggedOverTankId}
                  onOpen={setActiveTank}
                  onDropSpecimen={handleMoveSpecimen}
                  onDropSpecimenGroup={handleMoveSpecimensBulk}
                  onDragEnterTank={setDraggedOverTankId}
                  onDragLeaveTank={() => setDraggedOverTankId(null)}
                />
              ) : proListView === "grid" ? (
                <ProOpsGrid
                  tanks={topLevelTanks}
                  fishbaseData={fishbaseData}
                  activeTankId={activeTank?.id}
                  draggedOverTankId={draggedOverTankId}
                  onOpen={setActiveTank}
                  onDropSpecimen={handleMoveSpecimen}
                  onDropSpecimenGroup={handleMoveSpecimensBulk}
                  onDragEnterTank={setDraggedOverTankId}
                  onDragLeaveTank={() => setDraggedOverTankId(null)}
                  onLogDue={handleWorklistLog}
                  tankDragProps={tankDragProps}
                />
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
                      {...tankDragProps(tank)}
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
                        const groupStr = e.dataTransfer.getData("application/aquadex-specimen-group");
                        if (groupStr) {
                          try {
                            const ids = JSON.parse(groupStr);
                            if (Array.isArray(ids) && ids.length) await handleMoveSpecimensBulk(ids, tank.id);
                          } catch { /* ignore malformed payload */ }
                          return;
                        }
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
                        // "none", not "scale(1)": any non-none transform makes the card
                        // its own stacking context AND the containing block for
                        // position:fixed descendants — which is exactly what buried the
                        // ⋯ overflow menu behind the next card down and made its
                        // click-outside scrim cover only this card.
                        transform: draggedOverTankId === tank.id ? "scale(1.03)" : "none",
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
                            <span className="badge badge-green" style={{ fontSize: "0.6rem" }}>
                              {tankTypeLabel(tank.tankType)}
                            </span>
                            <h4 style={{ color: "#fff", fontSize: "1.1rem" }}>{tank.name}</h4>
                            {!casualModeActive && <span className="mono-id-chip">UNIT #{tank.id}</span>}
                          </div>
                          {!casualModeActive && (
                            <div className="micro-breadcrumbs" style={{ marginTop: "0.25rem" }}>
                              <span>📍</span>
                              {/* Only render the segments that exist, so an unassigned
                                  unit reads "Unassigned" instead of "Main Room ›› ". */}
                              {[tank.facility, tank.room, tank.rack].filter(Boolean).length === 0 ? (
                                <span style={{ opacity: 0.7 }}>Unassigned</span>
                              ) : (
                                [tank.facility, tank.room, tank.rack].filter(Boolean).map((seg, i) => (
                                  <React.Fragment key={`${seg}-${i}`}>
                                    {i > 0 && <span className="micro-breadcrumbs-separator">›</span>}
                                    <span>{seg}</span>
                                  </React.Fragment>
                                ))
                              )}
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

                      {/* Quick actions overflow — destructive actions live behind ⋯ (Task 4).
                          The menu body is rendered ONCE at the root of this view as a
                          fixed-position layer (renderTankCardMenu) instead of inside the
                          card, so the next card down can never paint over it or swallow
                          its clicks. */}
                      <div
                        style={{
                          marginTop: "0.75rem",
                          paddingTop: "0.6rem",
                          borderTop: "1px solid rgba(255, 255, 255, 0.04)",
                          display: "flex",
                          justifyContent: "flex-end",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          aria-label="Tank options"
                          aria-haspopup="menu"
                          aria-expanded={cardMenu?.tankId === tank.id}
                          title="Tank options"
                          onClick={(e) => { e.stopPropagation(); toggleCardMenu(e, tank.id); }}
                          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--glass-border)", borderRadius: "6px", color: "#fff", width: "34px", height: "28px", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1 }}
                        >
                          ⋯
                        </button>
                      </div>

                      {/* Recursive nested child containers */}
                      {renderNestedChildren(tank.id)}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Fry Nursery — unassigned specimens */}
          <FryNursery
            walletAccount={walletAccount}
            tanks={tanks}
            onRefresh={() => {
              refetchTanks();
              fetchDashboardData();
            }}
            onListOnMarketplace={onListOnMarketplace}
            casualModeActive={casualModeActive}
            fishbaseData={fishbaseData}
            contractSpecies={contractSpecies}
            requestConfirm={requestConfirm}
          />
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
                // Both modes render the tank visual via the LivingTank hero below
                // (the uploaded photo if present, otherwise stylized living water),
                // so the banner element itself needs no background image. This also
                // killed the old getSupabaseImageUrl fallback, which pointed at a
                // dead Supabase project and blanked the pro banner for photo-less
                // tanks while spamming net::ERR_FAILED.
                backgroundImage: "none"
              }}
            >
              {/* The header is a Living Tank hero in BOTH modes: it shows the
                  uploaded photo if there is one, otherwise stylized living water
                  (water reflects health) — so pro is never a flat/empty banner.
                  In pro we pass no fish here so the TankFishVisualization below owns
                  the fish layer (avoids double fish); casual uses the hero's fish. */}
              <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}>
                <LivingTank
                  tank={activeTank}
                  health={deriveTankHealth(activeTank, { schedules: activeTankSchedules })}
                  variant="hero"
                  height={200}
                  fishbaseData={casualModeActive ? fishbaseData : []}
                  photoUrl={activeTankPhoto || undefined}
                  showLabel={false}
                />
              </div>

              <div className="biotope-banner-overlay"></div>

              {/* Dynamic Tank Fish — Pro only; casual uses the LivingTank hero's own fish */}
              {!casualModeActive && activeTank.specimens && activeTank.specimens.length > 0 && (
                <TankFishVisualization
                  specimens={activeTank.specimens}
                  fishbaseData={fishbaseData}
                  containerHeight={200}
                />
              )}

              {/* Companion Fish Entity (swimming fry or hatched tier) — hidden in Pro mode */}
              {casualModeActive && companionData && companionData.eggState >= 1 && (
                <CompanionFishEntity tier={companionData.currentTier} companionXp={companionData.companionXp || 0} />
              )}

              {/* Quiet Mystery Egg UI Overlay — hidden in Pro mode */}
              {casualModeActive && companionData && companionData.eggState === 1 && (
                <div 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowBubble(true);
                    setTimeout(() => setShowBubble(false), 3000);
                  }}
                  className="echo-egg-wobble"
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
                    zIndex: 10,
                    animation: 'eggWobble 4s ease-in-out infinite',
                  }}
                  title="Something's stirring inside..."
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
              
              {/* QR tag identifier anchored over top-right — passive identifier now;
                  printing the label moved to the quick-actions menu (Task 4 declutter). */}
              <div className="qr-anchor-tag" title={`UNIT #${activeTank.id}`}>
                {/* Real QR code rendered as canvas-to-image */}
                <TankQRCode tankId={activeTank.id} size={40} />
                <span style={{ fontSize: "0.55rem", fontWeight: "700", color: "var(--bg-primary)" }}>UNIT #{activeTank.id}</span>
              </div>

              <div style={{ position: "absolute", bottom: "1rem", left: "1rem", zIndex: "2" }}>
                <span className="badge badge-green" style={{ marginBottom: "0.25rem" }}>
                  {tankTypeLabel(activeTank.tankType)} {casualModeActive ? "Tank" : CONTAINMENT_TYPES[activeTank.containment]}
                </span>
                <h3 style={{ color: "#fff", fontSize: "1.5rem" }}>{activeTank.name}</h3>
                {!casualModeActive && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                      📍 {[activeTank.facility, activeTank.room, activeTank.rack].filter(Boolean).join(" › ") || "Unassigned"}
                    </span>
                    {/* Group picker — the drag-onto-a-chip shortcut needs a keyboard
                        and touch equivalent, and this one works from every view. */}
                    <select
                      aria-label="Location group"
                      value={tankGroupName(activeTank)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handleAssignTankToGroup(activeTank.id, e.target.value || UNASSIGNED)}
                      style={{
                        background: "rgba(8,25,48,0.85)",
                        border: "1px solid var(--glass-border)",
                        borderRadius: "50px",
                        color: "#fff",
                        fontSize: "0.7rem",
                        padding: "0.2rem 0.5rem",
                        cursor: "pointer",
                      }}
                    >
                      <option value="">◌ Unassigned</option>
                      {locationGroups.map((g) => (
                        <option key={g} value={g}>📍 {g}</option>
                      ))}
                      {/* A group only present on this tank (legacy value) still needs an
                          option, or the select would silently show the wrong entry. */}
                      {tankGroupName(activeTank) && !locationGroups.some((g) => g.toLowerCase() === tankGroupName(activeTank).toLowerCase()) && (
                        <option value={tankGroupName(activeTank)}>📍 {tankGroupName(activeTank)}</option>
                      )}
                    </select>
                  </div>
                )}
              </div>
              {poseidonChatOpen && (
                <PoseidonChatConsole
                  tankId={activeTank.id}
                  casualModeActive={casualModeActive}
                  walletAccount={walletAccount}
                  seedPrompt={poseidonSeed}
                  onClose={() => { setPoseidonChatOpen(false); setPoseidonSeed(null); }}
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

              {/* Share — secondary action; opens the composer (no longer a permanent tab) */}
              <button
                type="button"
                onClick={() => setDetailSubTab("social")}
                style={{ order: 2, marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.35rem", padding: "0.4rem 0.8rem", fontSize: "0.8rem", background: "rgba(255, 255, 255, 0.03)", border: "1px solid var(--glass-border)", borderRadius: "6px", color: "#fff", cursor: "pointer" }}
                aria-label={casualModeActive ? "Share tank on The Reef" : "Share to Social Feed"}
              >
                📢 <span>Share</span>
              </button>
              
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
                    await putTankPhoto(activeTank.id, compressed); // durable (mirrors to localStorage)
                    setActiveTankPhoto(compressed);
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
                    await putSpecimenPhoto(uploadingSpecimenId, compressed); // durable (mirrors to localStorage)
                    setSpecimenPhotos((p) => ({ ...p, [uploadingSpecimenId]: compressed }));
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
                      <div className="command-console-panel command-console-panel--casual">
                        <div className="console-header">
                          <span className="console-title">✨ Quick Actions</span>
                          <span className="console-pulse-dot" />
                        </div>

                        <div>
                          <div className="console-category-header">Feeding</div>
                          <div className="console-grid">
                            <button
                              type="button"
                              onClick={() => { logFeedClick(); setQuickActionsOpen(false); }}
                              className="console-tile tile-husbandry"
                            >
                              <span className="console-tile-icon">🥣</span>
                              <span className="console-tile-label">Quick Feed</span>
                              <span className="console-tile-desc">Standard dose</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => { logFeedLongPress(); setQuickActionsOpen(false); }}
                              className="console-tile tile-husbandry"
                            >
                              <span className="console-tile-icon">🥣</span>
                              <span className="console-tile-label">Detailed Feed</span>
                              <span className="console-tile-desc">Log the details</span>
                            </button>
                          </div>
                        </div>

                        <div>
                          <div className="console-category-header">Water</div>
                          <div className="console-grid">
                            <button
                              type="button"
                              onClick={() => { logTestClick(); setQuickActionsOpen(false); }}
                              className="console-tile tile-environment"
                            >
                              <span className="console-tile-icon">🧪</span>
                              <span className="console-tile-label">Quick Test</span>
                              <span className="console-tile-desc">Log a water test</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => { logTestLongPress(); setQuickActionsOpen(false); }}
                              className="console-tile tile-environment"
                            >
                              <span className="console-tile-icon">🧪</span>
                              <span className="console-tile-label">Detailed Test</span>
                              <span className="console-tile-desc">Enter your readings</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => { logWaterChange(); setQuickActionsOpen(false); }}
                              className="console-tile tile-environment"
                            >
                              <span className="console-tile-icon">💧</span>
                              <span className="console-tile-label">Water Change</span>
                              <span className="console-tile-desc">Log a partial change</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => { logAlgaeLongPress(); setQuickActionsOpen(false); }}
                              className="console-tile tile-environment"
                            >
                              <span className="console-tile-icon">🧹</span>
                              <span className="console-tile-label">Clean</span>
                              <span className="console-tile-desc">Algae & filters</span>
                            </button>
                          </div>
                        </div>

                        <div>
                          <div className="console-category-header">Tank</div>
                          <div className="console-grid">
                            <button
                              type="button"
                              onClick={() => { setPoseidonChatOpen(!poseidonChatOpen); setQuickActionsOpen(false); }}
                              className="console-tile tile-system"
                            >
                              <span className="console-tile-icon">💬</span>
                              <span className="console-tile-label">Ask Poseidon</span>
                              <span className="console-tile-desc">Get advice</span>
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
                              className="console-tile tile-system"
                            >
                              <span className="console-tile-icon">🐟</span>
                              <span className="console-tile-label">Fish Count</span>
                              <span className="console-tile-desc">Update the count</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => { photoInputRef.current?.click(); setQuickActionsOpen(false); }}
                              className="console-tile tile-system"
                            >
                              <span className="console-tile-icon">📷</span>
                              <span className="console-tile-label">Upload Photo</span>
                              <span className="console-tile-desc">Add a photo</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => { printTankQRLabel(activeTank); setQuickActionsOpen(false); }}
                              className="console-tile tile-system"
                            >
                              <span className="console-tile-icon">🏷️</span>
                              <span className="console-tile-label">QR Label</span>
                              <span className="console-tile-desc">Printable tag</span>
                            </button>
                          </div>
                        </div>
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
                                <FishSimple size={18} weight="duotone" />
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
                                <FishSimple size={18} weight="duotone" />
                              </span>
                              <span className="console-tile-label">Detailed Feed</span>
                              <span className="console-tile-desc">Log details</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setQuickLogMode("action");
                                setBulkLogScope("rack");
                                setBulkLogAction("feed");
                                setBulkLogDetail("Routine feeding (standard diet)");
                                if (activeTank) {
                                  setQuickLogTankId(activeTank.id.toString());
                                  if (activeTank.rack) setBulkRackTarget(activeTank.rack);
                                  if (activeTank.room) setBulkRoomTarget(activeTank.room);
                                }
                                setQuickLogOpen(true);
                                setQuickActionsOpen(false);
                              }}
                              className="console-tile tile-husbandry console-span-2"
                            >
                              <span className="console-tile-icon">🥣</span>
                              <span className="console-tile-text">
                                <span className="console-tile-label">Bulk Feeding</span>
                                <span className="console-tile-desc">Log feed for entire rack/room</span>
                              </span>
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
                                <Flask size={18} weight="duotone" />
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
                                <Flask size={18} weight="duotone" />
                              </span>
                              <span className="console-tile-label">Detailed Test</span>
                              <span className="console-tile-desc">Enter measurements</span>
                            </button>
                            
                            <button
                              type="button"
                              onClick={() => { logWaterChange(); setQuickActionsOpen(false); }}
                              className="console-tile tile-environment"
                            >
                              <span className="console-tile-icon">
                                <Drop size={18} weight="duotone" />
                              </span>
                              <span className="console-tile-label">Water Change</span>
                              <span className="console-tile-desc">Log partial change</span>
                            </button>
                            
                            <button
                              type="button"
                              onClick={() => { logAlgaeLongPress(); setQuickActionsOpen(false); }}
                              className="console-tile tile-environment"
                            >
                              <span className="console-tile-icon">
                                <Asterisk size={18} weight="duotone" />
                              </span>
                              <span className="console-tile-label">Detailed Clean</span>
                              <span className="console-tile-desc">Water change & filters</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setQuickLogMode("action");
                                setBulkLogScope("rack");
                                setBulkLogAction("clean");
                                setBulkLogDetail("Routine cleaning performed.");
                                if (activeTank) {
                                  setQuickLogTankId(activeTank.id.toString());
                                  if (activeTank.rack) setBulkRackTarget(activeTank.rack);
                                  if (activeTank.room) setBulkRoomTarget(activeTank.room);
                                }
                                setQuickLogOpen(true);
                                setQuickActionsOpen(false);
                              }}
                              className="console-tile tile-environment console-span-2"
                            >
                              <span className="console-tile-icon">🧹</span>
                              <span className="console-tile-text">
                                <span className="console-tile-label">Bulk Maintenance</span>
                                <span className="console-tile-desc">Log maintenance for entire rack/room</span>
                              </span>
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
                                setProPopGender(SEX.UNSEXED);
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

                            <button
                              type="button"
                              onClick={() => { printTankQRLabel(activeTank); setQuickActionsOpen(false); }}
                              className="console-tile tile-system"
                            >
                              <span className="console-tile-icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="3" y="3" width="7" height="7" rx="1"/>
                                  <rect x="14" y="3" width="7" height="7" rx="1"/>
                                  <rect x="3" y="14" width="7" height="7" rx="1"/>
                                  <path d="M14 14h3v3h-3zM20 20h1M17 20v1"/>
                                </svg>
                              </span>
                              <span className="console-tile-label">Print QR Label</span>
                              <span className="console-tile-desc">Printable unit tag PDF</span>
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
              {["overview", "fish", "history"].map(subTab => {
                const labelMap = casualModeActive 
                  ? { overview: "About", fish: "My Fish", history: "Journal" }
                  : { overview: "Overview", fish: "Specimens", history: "History" };
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
                    <>
                    <CareCoach tank={activeTank} walletAccount={walletAccount} onAction={handleCoachAction} />
                    <HealthFlagExplainer tank={activeTank} casualModeActive={casualModeActive} onAskPoseidon={askPoseidon} />
                    <SpeciesCareGuide tank={activeTank} fishbaseData={fishbaseData} contractSpecies={contractSpecies} onAskPoseidon={askPoseidon} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                      {/* Water Type */}
                      <div className="telemetry-tile-premium" style={{ borderLeft: "3px solid var(--accent-blue)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>💧 Water Type</span>
                        </div>
                        <strong style={{ fontSize: "1.25rem", color: "#fff", display: "block", marginTop: "0.5rem" }}>
                          {tankTypeLabel(activeTank.tankType)}
                        </strong>
                        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>{tankTypeLabel(activeTank.tankType)} ecosystem</span>
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
                    </>
                  ) : (
                    <>
                      <HealthFlagExplainer tank={activeTank} casualModeActive={casualModeActive} onAskPoseidon={askPoseidon} />
                      <div className="telemetry-2x2-grid">
                        {/* Thermal */}
                        <div className="telemetry-tile-premium" style={{ borderLeft: `3px solid ${activeTank.latestLog ? getHslColor(activeTank.latestLog.tempCelsiusX10/10, minSafeTemp, maxSafeTemp, 5) : "var(--glass-border)"}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>🌡️ Thermal Chemistry</span>
                            {activeTank.latestLog && (
                              <span className="badge" style={{ 
                                fontSize: "0.55rem", 
                                padding: "0.1rem 0.4rem", 
                                background: `${getHslColor(activeTank.latestLog.tempCelsiusX10/10, minSafeTemp, maxSafeTemp, 5)}15`, 
                                color: getHslColor(activeTank.latestLog.tempCelsiusX10/10, minSafeTemp, maxSafeTemp, 5),
                                borderColor: getHslColor(activeTank.latestLog.tempCelsiusX10/10, minSafeTemp, maxSafeTemp, 5)
                              }}>
                                {activeTank.latestLog.tempCelsiusX10/10 >= minSafeTemp && activeTank.latestLog.tempCelsiusX10/10 <= maxSafeTemp ? "Ideal" : "Warning"}
                              </span>
                            )}
                          </div>
                          {/*
                            Honours Settings → Units & Formatting. The primary
                            reading keeps the large treatment and the secondary the
                            small muted one, so `tempUnit === "both"` (the default)
                            renders exactly what this tile rendered before the
                            preference existed. Picking a single unit drops the
                            secondary rather than restyling the tile.
                          */}
                          <strong style={{ fontSize: "1.25rem", color: "#fff" }}>
                            {activeTank.latestLog ? (() => {
                              const celsius = activeTank.latestLog.tempCelsiusX10 / 10;
                              const primary = showCelsius(tempUnit)
                                ? `${celsius.toFixed(1)}°C`
                                : `${celsiusToFahrenheit(celsius).toFixed(1)}°F`;
                              const showSecondary = showCelsius(tempUnit) && showFahrenheit(tempUnit);
                              return (
                                <>
                                  {primary}
                                  {showSecondary && (
                                    <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginLeft: "0.4rem" }}>
                                      / {celsiusToFahrenheit(celsius).toFixed(1)}°F
                                    </span>
                                  )}
                                </>
                              );
                            })() : "N/A"}
                          </strong>
                          {/* The range follows the primary unit only — rendering
                              both bounds in both scales makes this line unreadable. */}
                          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                            Ideal range: {formatTemperature(minSafeTemp, primaryTempUnit)} - {formatTemperature(maxSafeTemp, primaryTempUnit)}
                          </span>
                        </div>

                        {/* pH */}
                        <div className="telemetry-tile-premium" style={{ borderLeft: `3px solid ${activeTank.latestLog ? getHslColor(activeTank.latestLog.phX10/10, minSafePh, maxSafePh, 1.5) : "var(--glass-border)"}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>🧪 Acidic Level (pH)</span>
                            {activeTank.latestLog && (
                              <span className="badge" style={{ 
                                fontSize: "0.55rem", 
                                padding: "0.1rem 0.4rem", 
                                background: `${getHslColor(activeTank.latestLog.phX10/10, minSafePh, maxSafePh, 1.5)}15`, 
                                color: getHslColor(activeTank.latestLog.phX10/10, minSafePh, maxSafePh, 1.5),
                                borderColor: getHslColor(activeTank.latestLog.phX10/10, minSafePh, maxSafePh, 1.5)
                              }}>
                                {activeTank.latestLog.phX10/10 >= minSafePh && activeTank.latestLog.phX10/10 <= maxSafePh ? "Ideal" : "Warning"}
                              </span>
                            )}
                          </div>
                          <strong style={{ fontSize: "1.25rem", color: "#fff" }}>
                            {activeTank.latestLog ? (activeTank.latestLog.phX10 / 10).toFixed(1) : "N/A"}
                          </strong>
                          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Ideal range: {minSafePh.toFixed(1)} - {maxSafePh.toFixed(1)} pH</span>
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
                                ammonia: "0.0",
                                nitrite: "0.0",
                                nitrate: "0.0",
                                notes: "Immediate water change performed."
                              });
                              setQuickLogMode("water_test");
                              setBulkLogScope("single");
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

                  {/* Stocking / bioload guidance (both modes) — grounded, deterministic */}
                  <StockingGuidance
                    tank={activeTank}
                    fishbaseData={fishbaseData}
                    contractSpecies={contractSpecies}
                    casualModeActive={casualModeActive}
                  />

                  {/* Per-tank maintenance cadence editor — writes tankSchedules */}
                  <ScheduleEditor
                    tank={activeTank}
                    casualModeActive={casualModeActive}
                    onChange={() => {
                      getOrInitTankSchedules(activeTank.id)
                        .then((rows) => setActiveTankSchedules(rows || []))
                        .catch(() => {});
                    }}
                  />

                  {/* Tank Cam Setup — deferred; entry point removed from the tank view. */}
                </div>
              ) }
{/* 2.2 FISH SUB-TAB: Fish inside tank — consumer label in Casual mode */}
              {detailSubTab === "fish" && (
                <TankInhabitants
                  tank={activeTank}
                  tanks={tanks}
                  fishbaseData={fishbaseData}
                  casualModeActive={casualModeActive}
                  getSpecimenPhoto={(spec) => specimenPhotos[spec.id] || ""}
                  onAddFish={() => openAddFish(activeTank)}
                  onOpenSpecimen={(id) => onSelectSpecimen && onSelectSpecimen(id)}
                  onPhotoSpecimen={(spec) => {
                    setUploadingSpecimenId(spec.id);
                    setTimeout(() => specimenPhotoInputRef.current?.click(), 50);
                  }}
                  onListSpecimen={onListOnMarketplace ? (spec) => onListOnMarketplace(activeTank, spec) : undefined}
                  onFarewellSpecimen={(spec) => setFarewellSpecimen(spec)}
                  onViewLineage={onViewLineage ? (id) => onViewLineage(id) : undefined}
                  onMoveSpecimens={handleMoveSpecimensBulk}
                />
              )}

              {/* 2.3 ACTIVITY / HISTORY SUB-TAB: Casual gets the photo-first Journal
                  timeline; Pro keeps the dense parameter-history list. */}
              {detailSubTab === "history" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  {casualModeActive ? (
                    <JournalTimeline tank={activeTank} />
                  ) : (
                    <>
                      <ParamTrends tank={activeTank} />
                      <ActivityLog
                        onChainLogs={activeTank.logs || []}
                        actionLogs={localActionLogs}
                        casualModeActive={casualModeActive}
                      />
                    </>
                  )}
                  {/* Notes folded into History — observations live in one place now. */}
                  <NotesTab tankId={activeTank.id} />
                </div>
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
                    {/* Back — Share is an action now, not a tab */}
                    <button
                      type="button"
                      onClick={() => setDetailSubTab("overview")}
                      style={{ alignSelf: "flex-start", background: "none", border: "none", color: "var(--accent-blue)", cursor: "pointer", fontSize: "0.8rem", padding: 0 }}
                    >
                      ← Back to tank
                    </button>
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
                            // Self-described, not platform-verified — see the role
                            // chip in the composer below for why the wording changed
                            // (§9.28). The stored role key is unchanged.
                            badgeLabel = "⭐ Experienced Breeder";
                          } else if (comment.role === "hobbyist") {
                            badgeColor = "var(--text-secondary)";
                            badgeBg = "rgba(255, 255, 255, 0.05)";
                            badgeBorder = "1px solid var(--glass-border)";
                            badgeLabel = "Hobbyist";
                          } else {
                            // Breeder tiers
                            let tier = "shallow";
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
                              // Named for the tag that actually gates it (§9.28).
                              // "Master Breeder Rank" is a different thing, gated by
                              // completed sales and ratings, not Companion XP.
                              showToast("🔒 Lab Audit requires the Experienced Breeder tag");
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
                                className={`role-chip ${companionData?.currentTier?.toLowerCase() || "shallow"} ${commenterRole === "breeder" ? "active" : ""}`}
                                onClick={() => setCommenterRole("breeder")}
                              >
                                🧬 {companionData?.currentTier || "Shallow"} Breeder
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

                            {/* Self-described commenter role. It used to read
                                "⭐ Verified Master Breeder" (BREEDER_STATE_MODEL
                                §9.28), which was wrong on both words:

                                  - NOT VERIFIED. The user picks this chip for their
                                    own comment. Nothing checks it.
                                  - NOT MASTER BREEDER. That title is gated by
                                    `breederRegistry.checkMasterBreederEligibility`
                                    (tier 4 + 5 completed sales + ≥4.0 rating). This
                                    chip's gate is 10,000 Companion XP, which
                                    measures app engagement — logging feedings,
                                    posting — not breeding. You can reach it without
                                    ever having bred a fish.

                                Tagging a comment as coming from an experienced
                                breeder is genuinely useful, so the chip stays; the
                                claim it makes is what changed. The stored role key
                                `master-breeder` is UNCHANGED on purpose — existing
                                comments already carry it, and renaming it would
                                orphan them (same reason `"Not Sure"` survives as a
                                legacy sex value, §4.4).

                                Open question, not decided here: whether a purely
                                self-described tag should be XP-gated at all. The gate
                                is left as it was. */}
                            {(!casualModeActive && (companionData?.currentTier === "Master" || companionData?.currentTier === "God-Tier")) ? (
                              <div
                                className={`role-chip master ${commenterRole === "master-breeder" ? "active" : ""}`}
                                title="You're describing yourself — this tag isn't checked by Aquadex"
                                onClick={() => setCommenterRole("master-breeder")}
                              >
                                ⭐ Experienced Breeder
                              </div>
                            ) : (
                              <div
                                className="role-chip disabled"
                                title="Unlocks at Master Rank (10,000+ Companion XP)"
                                onClick={() => showToast("🔒 The Experienced Breeder tag unlocks at 10,000+ Companion XP")}
                              >
                                🔒 Experienced Breeder
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

              {/* Archive Tank — danger zone */}
              <div style={{
                marginTop: "2rem",
                padding: "1rem",
                borderTop: "1px solid rgba(248, 113, 113, 0.15)",
              }}>
                {!showArchiveConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowArchiveConfirm(true)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-muted)",
                      fontSize: "0.72rem",
                      cursor: "pointer",
                      padding: "0.4rem 0",
                      opacity: 0.7,
                      transition: "opacity 0.2s ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = "#f87171"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; e.currentTarget.style.color = "var(--text-muted)"; }}
                  >
                    {casualModeActive ? "🗑️ Archive this tank..." : "DECOMMISSION UNIT..."}
                  </button>
                ) : (
                  <div style={{
                    padding: "0.75rem",
                    background: "rgba(248, 113, 113, 0.06)",
                    border: "1px solid rgba(248, 113, 113, 0.2)",
                    borderRadius: "8px",
                  }}>
                    <p style={{ fontSize: "0.78rem", color: "#f87171", marginBottom: "0.5rem", lineHeight: 1.4 }}>
                      {getSpecimenCount(activeTank) > 0
                        ? (casualModeActive
                          ? `⚠️ This tank has ${getSpecimenCount(activeTank)} fish! Archiving will hide it from your dashboard. Fish records are preserved.`
                          : `WARNING: Unit contains ${getSpecimenCount(activeTank)} registered specimens. Archive sets active=false. Specimen records retained.`)
                        : (casualModeActive
                          ? "This will hide the tank from your dashboard. You can re-import it later from a backup."
                          : "Sets unit active=false. Reversible via data import.")}
                    </p>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await db.tanks.update(activeTank.id, { active: false });
                            queryClient.invalidateQueries({ queryKey: ["tanks", walletAccount] });
                            setActiveTank(null);
                            setShowArchiveConfirm(false);
                          } catch (err) {
                            console.error("Archive failed:", err);
                          }
                        }}
                        style={{
                          padding: "0.4rem 0.8rem",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          borderRadius: "6px",
                          border: "none",
                          background: "linear-gradient(135deg, #dc2626, #b91c1c)",
                          color: "#fff",
                          cursor: "pointer",
                          boxShadow: "0 2px 8px rgba(220, 38, 38, 0.3)",
                        }}
                      >
                        {casualModeActive ? "Yes, Archive" : "CONFIRM DECOMMISSION"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowArchiveConfirm(false)}
                        style={{
                          padding: "0.4rem 0.8rem",
                          fontSize: "0.75rem",
                          borderRadius: "6px",
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: "rgba(255,255,255,0.05)",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          </>
        )}
      </div>

      {/* 3. SIMULATED CAMERA SCANNER DIALOG */}
      {scannerOpen && (
        <TankScanner
          tanks={tanks}
          casualModeActive={casualModeActive}
          onSelect={handleScanSelect}
          onClose={() => setScannerOpen(false)}
        />
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
                  {/* Options come from SEX_OPTIONS so this control writes the
                      canonical stored value. It used to write the literal
                      "Not Sure", which no other writer produced and which three
                      readers then had to special-case alongside "Unsexed". */}
                  <div style={{ display: "flex", background: "rgba(0,0,0,0.2)", border: "1px solid var(--glass-border)", borderRadius: "6px", padding: "2px", height: "42px" }}>
                    {SEX_OPTIONS.map((option) => {
                      const g = option.value;
                      const sel = addFishGender === g;
                      return (
                        <button
                          type="button"
                          key={g}
                          onClick={() => setAddFishGender(g)}
                          style={{
                            flex: 1,
                            background: sel ? (g === SEX.MALE ? "rgba(56, 189, 248, 0.18)" : g === SEX.FEMALE ? "rgba(244, 63, 94, 0.18)" : "rgba(255, 255, 255, 0.1)") : "none",
                            border: "none",
                            borderRadius: "4px",
                            color: sel ? (g === SEX.MALE ? "#38bdf8" : g === SEX.FEMALE ? "#f43f5e" : "#fff") : "var(--text-secondary)",
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
                          <span>{option.symbol || "⚪"}</span>
                          <span>{sexOptionLabel(option, { casual: casualModeActive })}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Life stage — the age question a keeper can actually answer.
                  This surface previously collected NO age at all and hardcoded
                  birthTimestamp: 0, which the relayer then turned into "born
                  today" on-chain. Most fish added here are shop-bought young
                  adults, so an exact birth date is a guess; the stage is not.
                  Unknown stays a first-class answer (utils/lifeStage.js). */}
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                  {casualModeActive ? "How old are they?" : "Life stage"}
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> (optional)</span>
                </label>
                <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                  {LIFE_STAGE_OPTIONS.filter((o) => canBeCertificated(o.value)).map((option) => {
                    const sel = addFishLifeStage === option.value;
                    return (
                      <button
                        type="button"
                        key={option.value}
                        onClick={() => setAddFishLifeStage(sel ? "" : option.value)}
                        aria-pressed={sel}
                        style={{
                          flex: "1 1 auto",
                          minHeight: "38px",
                          padding: "0.4rem 0.75rem",
                          background: sel ? "rgba(56, 189, 248, 0.18)" : "rgba(0,0,0,0.2)",
                          border: sel ? "1px solid var(--accent-blue)" : "1px solid var(--glass-border)",
                          borderRadius: "6px",
                          color: sel ? "#fff" : "var(--text-secondary)",
                          fontSize: "0.75rem",
                          fontWeight: sel ? 600 : 400,
                          cursor: "pointer",
                        }}
                      >
                        {lifeStageOptionLabel(option, { casual: casualModeActive })}
                      </button>
                    );
                  })}
                </div>
                <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.3rem", display: "block" }}>
                  {casualModeActive
                    ? "Leave blank if you're not sure — we won't guess."
                    : "Eggs and fry are tracked as cohorts, not individual certificates, so they aren't offered here."}
                </span>
              </div>

              {/* Provenance. Fish added here come from outside Aquadex, so this
                  records that rather than letting the absence of parents be read
                  as "wild caught" — see utils/provenance.js. */}
              <div style={{
                fontSize: "0.68rem",
                color: "var(--text-muted)",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid var(--glass-border)",
                borderRadius: "6px",
                padding: "0.5rem 0.65rem",
                lineHeight: 1.5,
              }}>
                {provenanceText(PROVENANCE.UNVERIFIED, { casual: casualModeActive })}
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

      {/* MOBILE FLOATING QUICK LOG FAB — always accessible without scrolling */}
      {!quickLogOpen && (
        <button
          className="quick-log-fab"
          onClick={() => {
            setQuickLogMode("water_test");
            setBulkLogScope("single");
            setQuickLogOpen(true);
          }}
          aria-label="Quick Log"
        >
          <span>✍️</span>
        </button>
      )}

      {/* 4. QUICK LOG SLIDING DRAWER CONTAINER */}
      {quickLogOpen && (
        <div className="sliding-drawer-backdrop" onClick={() => setQuickLogOpen(false)}>
          <div className="sliding-drawer-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h3 style={{ fontSize: "1.5rem", color: "#fff" }}>
                {quickLogMode === "water_test" ? "Quick Log Water Test" : `Bulk ${BULK_ACTION_LABELS[bulkLogAction]?.label || "Action"}`}
              </h3>
              <button 
                onClick={() => {
                  setQuickLogOpen(false);
                  setModalError(null);
                  setTxHash(null);
                  setBulkLogResult(null);
                  setBulkLogScope("single");
                  setQuickLogMode("water_test");
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
                      background: bulkLogScope === opt.key ? (casualModeActive ? "rgba(56, 189, 248, 0.18)" : "rgba(168, 85, 247, 0.18)") : "transparent",
                      color: bulkLogScope === opt.key ? (casualModeActive ? "var(--accent-blue)" : "#c084fc") : "var(--text-muted)",
                      transition: "all 0.15s ease"
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── BULK ACTION PANEL (rack / room / single scope) ── */}
            {quickLogMode === "action" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

                {/* Target selector */}
                <div>
                  {bulkLogScope === "single" ? (
                    <>
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
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
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
                          background: bulkLogAction === key ? (casualModeActive ? "rgba(56, 189, 248, 0.12)" : "rgba(168, 85, 247, 0.12)") : "rgba(255,255,255,0.02)",
                          borderColor: bulkLogAction === key ? (casualModeActive ? "rgba(56, 189, 248, 0.4)" : "rgba(168, 85, 247, 0.4)") : "var(--glass-border)",
                          color: bulkLogAction === key ? (casualModeActive ? "var(--accent-blue)" : "#c084fc") : "var(--text-secondary)",
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
                          <button type="button" onClick={saveTemplate} className={casualModeActive ? "btn-primary" : "btn-primary-pro"} style={{ padding: "0.35rem 0.75rem", fontSize: "0.72rem" }}>Save</button>
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
                  className={casualModeActive ? "btn-primary" : "btn-primary-pro"}
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

            {/* ── WATER snaps/telemetry parameter form ── */}
            {quickLogMode === "water_test" && (
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
                  {bulkLogScope === "single" && residingSpecies.length > 0 && (
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

                  {bulkLogScope === "single" ? (
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
                  ) : (
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
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
                    {/* "Same as last time" quick-fill button */}
                    {activeTank?.latestLog && (
                      <div style={{ gridColumn: "span 2", marginBottom: "-0.5rem" }}>
                        <button
                          type="button"
                          onClick={() => {
                            const lastLog = activeTank.latestLog;
                            setFormData({
                              temp: lastLog.tempCelsiusX10 ? (lastLog.tempCelsiusX10/10).toString() : formData.temp,
                              ph: lastLog.phX10 ? (lastLog.phX10/10).toString() : formData.ph,
                              ammonia: lastLog.ammoniaPpmX100 ? (lastLog.ammoniaPpmX100/100).toString() : formData.ammonia,
                              nitrite: lastLog.nitritePpmX100 ? (lastLog.nitritePpmX100/100).toString() : formData.nitrite,
                              nitrate: lastLog.nitratePpmX100 ? (lastLog.nitratePpmX100/100).toString() : formData.nitrate,
                              notes: formData.notes,
                            });
                          }}
                          style={{
                            width: "100%",
                            padding: "0.5rem",
                            fontSize: "0.75rem",
                            fontWeight: 500,
                            borderRadius: "6px",
                            border: "1px dashed rgba(52, 211, 153, 0.3)",
                            background: "rgba(52, 211, 153, 0.04)",
                            color: "var(--accent-green)",
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                            fontFamily: "'Plus Jakarta Sans', sans-serif",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(52, 211, 153, 0.1)"; e.currentTarget.style.borderColor = "rgba(52, 211, 153, 0.5)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(52, 211, 153, 0.04)"; e.currentTarget.style.borderColor = "rgba(52, 211, 153, 0.3)"; }}
                        >
                          {casualModeActive ? "✨ Same as last time" : "↻ REPEAT LAST READING"}
                        </button>
                      </div>
                    )}
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
                    className={casualModeActive ? "btn-primary" : "btn-primary-pro"} 
                    disabled={submitting || (bulkLogScope !== "single" && getBulkTargetTanks().length === 0)} 
                    style={{ width: "100%", justifyContent: "center", marginTop: "1rem" }}
                  >
                    {submitting ? (
                      `Logging ${getBulkTargetTanks().length} units…`
                    ) : (
                      bulkLogScope === "single" ? (
                        casualModeActive ? "Save Water Reading" : "Confirm Test Results"
                      ) : (
                        casualModeActive 
                          ? `Save Water Reading → ${getBulkTargetTanks().length} unit${getBulkTargetTanks().length !== 1 ? "s" : ""}` 
                          : `Confirm Test Results → ${getBulkTargetTanks().length} unit${getBulkTargetTanks().length !== 1 ? "s" : ""}`
                      )
                    )}
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

      {/* Pro card ⋯ overflow menu — one fixed-position layer for the whole list,
          rendered here (not inside a card) so no card can paint over it. */}
      {renderTankCardMenu()}

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

      {/* Themed Confirm Dialog — replaces window.confirm() for a consistent, on-brand UX */}
      {confirmDialog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.6)",
            backdropFilter: "blur(6px)",
            zIndex: 10001,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmDialog(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={confirmDialog.title}
            style={{
              width: "100%",
              maxWidth: "380px",
              background: "var(--bg-secondary, #0f172a)",
              border: `1px solid ${confirmDialog.danger ? "rgba(248, 113, 113, 0.3)" : "rgba(56, 189, 248, 0.3)"}`,
              borderRadius: "14px",
              padding: "1.25rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.85rem",
              boxShadow: confirmDialog.danger
                ? "0 8px 32px rgba(0, 0, 0, 0.5), 0 0 20px rgba(248, 113, 113, 0.15)"
                : "0 8px 32px rgba(0, 0, 0, 0.5), 0 0 20px rgba(56, 189, 248, 0.15)",
              animation: "modalPopIn 0.2s cubic-bezier(0.32, 0.72, 0, 1) forwards",
            }}
          >
            <span style={{ fontSize: "0.95rem", fontWeight: "700", color: "#fff" }}>
              {confirmDialog.title}
            </span>
            <p style={{ margin: 0, fontSize: "0.82rem", lineHeight: 1.5, color: "var(--text-muted, #94a3b8)" }}>
              {confirmDialog.message}
            </p>
            {/* Multi-choice form: the user picks an outcome. Stacked so each
                option can carry its own explanatory line. */}
            {confirmDialog.choices?.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginTop: "0.25rem" }}>
                {confirmDialog.choices.map((choice) => (
                  <button
                    key={choice.key || choice.label}
                    type="button"
                    onClick={() => {
                      const action = choice.onSelect;
                      setConfirmDialog(null);
                      if (action) action();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.7rem",
                      padding: "0.7rem 0.9rem",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      borderRadius: "10px",
                      border: choice.danger
                        ? "1px solid rgba(248, 113, 113, 0.35)"
                        : "1px solid rgba(56, 189, 248, 0.3)",
                      background: choice.danger
                        ? "rgba(248, 113, 113, 0.08)"
                        : "rgba(56, 189, 248, 0.08)",
                      color: "#fff",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {choice.icon && <span style={{ fontSize: "1.1rem" }}>{choice.icon}</span>}
                    <span>
                      <span style={{ display: "block" }}>{choice.label}</span>
                      {choice.detail && (
                        <span style={{ display: "block", fontSize: "0.68rem", fontWeight: 400, color: "var(--text-muted, #94a3b8)" }}>
                          {choice.detail}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setConfirmDialog(null)}
                  style={{
                    padding: "0.55rem 0.8rem",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    borderRadius: "8px",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    background: "rgba(255, 255, 255, 0.04)",
                    color: "#e2e8f0",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.25rem" }}>
                <button
                  type="button"
                  onClick={() => setConfirmDialog(null)}
                  style={{
                    flex: 1,
                    padding: "0.55rem 0.8rem",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    borderRadius: "8px",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    background: "rgba(255, 255, 255, 0.04)",
                    color: "#e2e8f0",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const action = confirmDialog.onConfirm;
                    setConfirmDialog(null);
                    if (action) action();
                  }}
                  style={{
                    flex: 1,
                    padding: "0.55rem 0.8rem",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    borderRadius: "8px",
                    border: confirmDialog.danger ? "1px solid rgba(248, 113, 113, 0.4)" : "1px solid rgba(56, 189, 248, 0.4)",
                    background: confirmDialog.danger ? "rgba(248, 113, 113, 0.15)" : "rgba(56, 189, 248, 0.15)",
                    color: confirmDialog.danger ? "#f87171" : "#38bdf8",
                    cursor: "pointer",
                  }}
                >
                  {confirmDialog.confirmLabel}
                </button>
              </div>
            )}
          </div>
          <style>{`
            @keyframes modalPopIn {
              from { opacity: 0; transform: scale(0.95); }
              to { opacity: 1; transform: scale(1); }
            }
          `}</style>
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
                          {/* isKnownSex, not `!== "Not Sure"`: that older check let a
                              fish stored as "Unsexed" through and then fell to the
                              female branch, so unsexed fish rendered as ♀. */}
                          {isKnownSex(spec.gender) && (
                            <span style={{
                              fontSize: "0.6rem",
                              padding: "0.02rem 0.25rem",
                              borderRadius: "4px",
                              background: normalizeSex(spec.gender) === SEX.MALE ? "rgba(56, 189, 248, 0.15)" : "rgba(244, 63, 94, 0.15)",
                              color: normalizeSex(spec.gender) === SEX.MALE ? "#38bdf8" : "#f43f5e",
                              border: normalizeSex(spec.gender) === SEX.MALE ? "1px solid rgba(56, 189, 248, 0.25)" : "1px solid rgba(244, 63, 94, 0.25)",
                              fontWeight: "600",
                            }}>
                              {sexSymbol(spec.gender)}
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
                            {SEX_OPTIONS.map((option) => {
                              const g = option.value;
                              const sel = proPopGender === g;
                              return (
                                <button
                                  type="button"
                                  key={g}
                                  onClick={() => setProPopGender(g)}
                                  title={sexOptionLabel(option, { casual: casualModeActive })}
                                  aria-label={sexOptionLabel(option, { casual: casualModeActive })}
                                  style={{
                                    flex: 1,
                                    background: sel ? (g === SEX.MALE ? "rgba(56, 189, 248, 0.18)" : g === SEX.FEMALE ? "rgba(244, 63, 94, 0.18)" : "rgba(255, 255, 255, 0.1)") : "none",
                                    border: "none",
                                    borderRadius: "4px",
                                    color: sel ? (g === SEX.MALE ? "#38bdf8" : g === SEX.FEMALE ? "#f43f5e" : "#fff") : "var(--text-secondary)",
                                    fontSize: "0.68rem",
                                    fontWeight: "600",
                                    cursor: "pointer",
                                    transition: "all 0.2s ease"
                                  }}
                                >
                                  {option.symbol || "⚪"}
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
                              {/* Same fix as above: unsexed fish used to render ♀. */}
                              {isKnownSex(spec.gender) && (
                                <span style={{
                                  fontSize: "0.55rem",
                                  padding: "0 0.15rem",
                                  borderRadius: "3px",
                                  background: normalizeSex(spec.gender) === SEX.MALE ? "rgba(56, 189, 248, 0.12)" : "rgba(244, 63, 94, 0.12)",
                                  color: normalizeSex(spec.gender) === SEX.MALE ? "#38bdf8" : "#f43f5e",
                                  border: normalizeSex(spec.gender) === SEX.MALE ? "1px solid rgba(56, 189, 248, 0.2)" : "1px solid rgba(244, 63, 94, 0.2)"
                                }}>
                                  {sexSymbol(spec.gender)}
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
                Its birth certificate is kept either way.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
              {/* The two real outcomes come from RETIREMENT_OUTCOMES so this
                  modal and FryNursery's retire flow can't drift apart on either
                  the status value or the copy. See
                  docs/BREEDER_STATE_MODEL.md §4. */}
              {RETIREMENT_OUTCOMES.map((outcome) => {
                const isDeceased = outcome.status === SPECIMEN_STATUS.DECEASED;
                const rgb = isDeceased ? "239, 68, 68" : "59, 130, 246";
                return (
                  <button
                    key={outcome.key}
                    type="button"
                    onClick={async () => {
                      const spec = farewellSpecimen;
                      // Single lifecycle writer: validates the status, detaches
                      // from the tank, and mirrors to the cloud.
                      await retireSpecimens(spec.id, outcome.status);
                      const updatedSpecimens = (activeTank.specimens || []).filter(s => s.id !== spec.id);
                      setMockPopulationCounts(prev => ({
                        ...prev,
                        [activeTank.id]: updatedSpecimens.length
                      }));
                      showToast(
                        isDeceased
                          ? `Recorded memorial for ${spec.commonName}. 🕊️`
                          : `Rehomed ${spec.commonName} successfully.`
                      );
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
                      background: `rgba(${rgb}, 0.06)`,
                      border: `1px solid rgba(${rgb}, 0.25)`,
                      borderRadius: "10px",
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      fontWeight: "600",
                      textAlign: "left",
                      transition: "all 0.2s"
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = `rgba(${rgb}, 0.15)`;
                      e.currentTarget.style.borderColor = `rgba(${rgb}, 0.45)`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = `rgba(${rgb}, 0.06)`;
                      e.currentTarget.style.borderColor = `rgba(${rgb}, 0.25)`;
                    }}
                  >
                    <span style={{ fontSize: "1.2rem" }}>{outcome.icon}</span>
                    <div>
                      <span style={{ display: "block" }}>
                        {retirementOutcomeLabel(outcome, { casual: casualModeActive })}
                      </span>
                      <span style={{ display: "block", fontSize: "0.68rem", fontWeight: "normal", color: "var(--text-muted)" }}>
                        {outcome.detail}
                      </span>
                    </div>
                  </button>
                );
              })}

              {/* Option 3: Just remove it from view.
                  This used to be "Released / Other — Completely delete from local
                  registry", implemented as `db.specimens.delete`. That destroyed a
                  birth certificate, orphaning the sire/dam reference of every
                  descendant, and it didn't even hold: pullCloudDataForWallet
                  re-inserts any cloud row the device is missing, so the record
                  came back on next login. A certificate is never destroyed (see
                  services/specimenLifecycle.js) — this archives it instead, which
                  is what "remove from my tank" actually means. */}
              <button
                type="button"
                onClick={async () => {
                  const spec = farewellSpecimen;
                  await archiveSpecimens(spec.id);
                  const updatedSpecimens = (activeTank.specimens || []).filter(s => s.id !== spec.id);
                  setMockPopulationCounts(prev => ({
                    ...prev,
                    [activeTank.id]: updatedSpecimens.length
                  }));
                  showToast(`Removed ${spec.commonName} from the tank. Its certificate is kept.`);
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
                <span style={{ fontSize: "1.2rem" }}>📦</span>
                <div>
                  <span style={{ display: "block" }}>
                    {casualModeActive ? "Just remove from this tank" : "Remove from view"}
                  </span>
                  <span style={{ display: "block", fontSize: "0.68rem", fontWeight: "normal", color: "var(--text-muted)" }}>
                    Hides it without recording an outcome. The birth certificate and its lineage are kept.
                  </span>
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
