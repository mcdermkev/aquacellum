import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useSpeciesData } from "../../hooks/useSpeciesData";
import { CasualTankGallery } from "../logbook/CasualTankGallery";
import { readLocalShowcasePreview } from "../../services/showcaseLocalPreview";
import { ShowcaseVideoGallery } from "./ShowcaseVideoGallery";
import {
  bootstrapShowcaseOwner,
  createShowcaseRoom,
  enrollShowcaseDataset,
  finalizeShowcaseDatasetImport,
  finalizeShowcaseHero,
  issueShowcaseWalletNonce,
  linkShowcaseWalletClaim,
  consumeShowcaseWalletProof,
  previewShowcaseMedia,
  previewShowcasePublication,
  publishShowcaseHero,
  putShowcasePlacement,
  readShowcaseIdentityState,
  readShowcaseMediaStatus,
  readShowcaseRoom,
  revokeShowcaseMedia,
  setShowcasePublication,
  stageShowcaseHero,
  stageShowcaseIdentityCandidates,
  startShowcaseDatasetImport,
  updateShowcaseRoom,
  uploadShowcaseDatasetChunk,
  uploadShowcaseHeroSource,
} from "../../services/showcaseOwnerApi";
import {
  bindShowcaseDatasetEnrollment,
  bindShowcaseDatasetImport,
  getShowcaseDatasetState,
  prepareShowcaseDatasetV3,
  readOwnerShowcaseTanks,
  recordShowcaseDatasetResult,
  typedTankId,
} from "../../services/showcaseDatasetV3";

const STEVE_WALLET = "0xef0931458159097a62fddd0ca798f269b5ce98f7";
const CHAIN_ID = "84532";
// The showcase publishes the exact set of tanks the owner selects and confirms.
// There is no fixed count; the only ceiling is the server room tank limit (100).
// The atomic publication still binds expected == matched == actual placements,
// so the security invariant is preserved for whatever number the owner confirms.
const MAX_TANK_COUNT = 100;
const MUTATION_BLOCKING_PHASES = new Set([
  "bootstrapping", "wallet-linking", "enrolling", "import-starting", "chunk-upload",
  "finalizing", "verifying", "room-checking", "room-creating", "room-saving", "placing",
  "preview-loading", "publishing", "unpublishing", "conflict", "error", "revision-stale",
  "publication-blocked",
]);

const panel = { padding: "1.15rem", border: "1px solid var(--glass-border)", borderRadius: "12px" };
const inputStyle = { width: "100%", minHeight: "42px", padding: "0.55rem 0.7rem", color: "var(--text-primary)", background: "rgba(var(--ink-rgb), 0.04)", border: "1px solid var(--glass-border)", borderRadius: "8px" };

function messageFor(error) {
  if (error?.code === "durable_mapping_missing") return error.message;
  if (error?.code === "revision_conflict") return "The server revision changed. Refresh before making another change.";
  if (error?.code === "identity_conflict") return "An identity conflict prevents publication. Stop and review the server identity state.";
  return error?.message || "The showcase operation could not be completed.";
}

function slugify(value) {
  return String(value || "tank").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 63) || "tank";
}

function imageExtension(file) {
  if (file?.type === "image/jpeg") return /\.jpeg$/i.test(file.name || "") ? "jpeg" : "jpg";
  if (file?.type === "image/png") return "png";
  if (file?.type === "image/webp") return "webp";
  return null;
}

const CANONICAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECOVERABLE_MEDIA_STATES = new Set(["staging", "processing", "approved"]);

function pendingHeroStorageKey(ownerAddress) {
  return `aquadex:showcase:pending-room-hero:v1:${ownerAddress}`;
}

// This local handle is recovery evidence only, never authority. Every use is revalidated by the
// Privy owner-bound media-status RPC and the preview RPC independently binds the exact room.
function readPendingHeroHandle(ownerAddress) {
  try {
    const value = JSON.parse(localStorage.getItem(pendingHeroStorageKey(ownerAddress)) || "null");
    if (!value || Object.keys(value).sort().join(",") !== "assetId,roomId"
        || !CANONICAL_UUID_RE.test(value.roomId) || !CANONICAL_UUID_RE.test(value.assetId)) return null;
    return value;
  } catch {
    return null;
  }
}

function writePendingHeroHandle(ownerAddress, value) {
  try {
    const key = pendingHeroStorageKey(ownerAddress);
    if (!value) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ roomId: value.roomId, assetId: value.assetId }));
  } catch {
    // Storage denial must not weaken server authorization. It only removes reload recovery.
  }
}

function localIdMap(datasetState) {
  const aliases = datasetState?.identityPackage?.identity?.aliases || [];
  return new Map(aliases.map((row) => [typedTankId(row.entityKey), row.value]));
}

async function readCompleteIdentityState() {
  const first = await readShowcaseIdentityState();
  const conflicts = [...(first.data.conflicts || [])];
  let cursor = first.data.conflictNextCursor;
  let pages = 0;
  while (cursor && pages < 100) {
    const next = await readShowcaseIdentityState({ entityCursor: null, entityLimit: 1, conflictCursor: cursor, conflictLimit: 50 });
    conflicts.push(...(next.data.conflicts || []));
    cursor = next.data.conflictNextCursor;
    pages++;
  }
  return {
    ...first,
    data: { ...first.data, conflicts, conflictNextCursor: cursor, conflictsIncomplete: !!cursor },
  };
}

function identityHasOpenConflict(identityState) {
  return identityState?.conflictsIncomplete === true
    || (identityState?.conflicts || []).some((item) => item.status === "open");
}

export function ShowcaseOwnerBuilder() {
  const { ready, authenticated, account, loginMethod, sessionBridgeReady, connectPrivy, getSigner } = useAuth();
  const { data: fishbaseData = [] } = useSpeciesData();
  const normalizedAccount = typeof account === "string" ? account.toLowerCase() : null;
  const authorizedWallet = normalizedAccount === STEVE_WALLET;
  const authAllowed = ready && authenticated && !!normalizedAccount && authorizedWallet && loginMethod === "privy" && sessionBridgeReady;

  const [phase, setPhase] = useState("auth-loading");
  const [error, setError] = useState(null);
  const [bootstrap, setBootstrap] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [roomState, setRoomState] = useState(null);
  const [tanks, setTanks] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectionConfirmed, setSelectionConfirmed] = useState(false);
  const [localPreview, setLocalPreview] = useState(null);
  const [localPreviewPhase, setLocalPreviewPhase] = useState("idle");
  const [localPreviewError, setLocalPreviewError] = useState(null);
  const [walletLinked, setWalletLinked] = useState(false);
  const [datasetState, setDatasetState] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewRevision, setPreviewRevision] = useState(null);
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const [placementDrafts, setPlacementDrafts] = useState({});
  const [roomDraft, setRoomDraft] = useState({
    slug: "ggstevericefishnj",
    title: "GG Steve Rice Fish NJ",
    description: "Steve's Medaka fish room.",
  });
  const [heroFile, setHeroFile] = useState(null);
  const [mediaStatus, setMediaStatus] = useState(null);
  const [mediaPhase, setMediaPhase] = useState("idle");
  const [mediaError, setMediaError] = useState(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState(null);
  const [heroAltText, setHeroAltText] = useState("");
  const [heroFocalX, setHeroFocalX] = useState(0.5);
  const [heroFocalY, setHeroFocalY] = useState(0.5);
  const [heroPublishApproved, setHeroPublishApproved] = useState(false);
  const [heroRevokeApproved, setHeroRevokeApproved] = useState(false);
  const mediaPreviewUrlRef = useRef(null);

  const replaceMediaPreviewUrl = useCallback((nextUrl) => {
    if (mediaPreviewUrlRef.current) URL.revokeObjectURL(mediaPreviewUrlRef.current);
    mediaPreviewUrlRef.current = nextUrl;
    setMediaPreviewUrl(nextUrl);
  }, []);

  const applyDatasetDrafts = useCallback((state, rawTanks) => {
    if (!state?.identityPackage) return;
    const byId = new Map(rawTanks.map((tank) => [String(tank.id), tank]));
    const entityToLocal = localIdMap(state);
    setPlacementDrafts((current) => {
      const next = { ...current };
      for (const tankId of entityToLocal.keys()) {
        if (next[tankId]) continue;
        const tank = byId.get(entityToLocal.get(tankId));
        next[tankId] = { label: tank?.name || "", slug: slugify(tank?.name), approved: false };
      }
      return next;
    });
  }, []);

  const refreshOwnerState = useCallback(async () => {
    if (!authAllowed) return;
    setPhase("bootstrapping");
    setError(null);
    setPreview(null);
    setPreviewRevision(null);
    setPublishConfirmed(false);
    try {
      // Local My Aquariums data is useful even when the publication backend is unavailable. Load it
      // first so Steve can always compose and inspect a private device preview.
      const [rawTanks, localDataset] = await Promise.all([
        readOwnerShowcaseTanks(normalizedAccount),
        getShowcaseDatasetState(normalizedAccount),
      ]);
      setTanks(rawTanks);
      setDatasetState(localDataset || null);
      if (localDataset?.selectedTankIds) setSelectedIds(localDataset.selectedTankIds.map(Number));
      setLocalPreview(null);
      setLocalPreviewPhase("idle");
      setLocalPreviewError(null);

      const [bootstrapResult, roomResult, identityResult] = await Promise.all([
        bootstrapShowcaseOwner(),
        readShowcaseRoom(),
        readCompleteIdentityState(),
      ]);
      setBootstrap(bootstrapResult.data);
      setRoomState(roomResult.data);
      setIdentity(identityResult.data);
      if (roomResult.data.room) {
        setRoomDraft({
          slug: roomResult.data.room.slug,
          title: roomResult.data.room.title,
          description: roomResult.data.room.description || "",
        });
      }

      const pendingHero = readPendingHeroHandle(normalizedAccount);
      if (pendingHero) {
        if (!roomResult.data.room || pendingHero.roomId !== roomResult.data.room.roomId) {
          writePendingHeroHandle(normalizedAccount, null);
          setMediaStatus(null);
          setMediaPhase("idle");
        } else {
          try {
            const recovered = await readShowcaseMediaStatus(pendingHero.assetId);
            if (RECOVERABLE_MEDIA_STATES.has(recovered.data.state)) {
              setMediaStatus(recovered.data);
              setMediaPhase(recovered.data.state);
              setMediaError(null);
            } else {
              writePendingHeroHandle(normalizedAccount, null);
              setMediaStatus(recovered.data);
              setMediaPhase(recovered.data.state);
            }
          } catch (mediaErr) {
            if (mediaErr?.code === "not_found") {
              writePendingHeroHandle(normalizedAccount, null);
              setMediaStatus(null);
              setMediaPhase("idle");
            } else {
              setMediaError(messageFor(mediaErr));
              setMediaPhase("recovery-error");
            }
          }
        }
      }

      applyDatasetDrafts(localDataset, rawTanks);
      const hasConflict = identityHasOpenConflict(identityResult.data);
      setPhase(hasConflict ? "conflict" : roomResult.data.room ? (roomResult.data.room.visibility === "private" ? "private-editable" : "must-make-private") : "tank-selection");
    } catch (err) {
      setError(messageFor(err));
      setPhase("error");
    }
  }, [applyDatasetDrafts, authAllowed, normalizedAccount]);

  useEffect(() => {
    if (!ready) { setPhase("auth-loading"); return; }
    if (!authenticated || !account || loginMethod !== "privy") { setPhase("sign-in-required"); return; }
    if (!authorizedWallet) { setPhase("wrong-wallet"); return; }
    if (!sessionBridgeReady) { setPhase("session-loading"); return; }
    refreshOwnerState();
  }, [ready, authenticated, account, loginMethod, authorizedWallet, sessionBridgeReady, refreshOwnerState]);

  useEffect(() => {
    if (!authAllowed || !normalizedAccount) return undefined;
    let stopped = false;
    const handleCloudSyncComplete = (event) => {
      const syncedWallet = typeof event.detail?.wallet === "string" ? event.detail.wallet.toLowerCase() : null;
      if (syncedWallet !== normalizedAccount) return;

      // Cloud hydration may replace tank content without changing local IDs.
      // Invalidate the owner's prior approval before any refreshed snapshot can
      // be previewed or imported, then require an explicit confirmation again.
      setSelectionConfirmed(false);
      setLocalPreview(null);
      setLocalPreviewPhase("idle");
      setLocalPreviewError(null);

      readOwnerShowcaseTanks(normalizedAccount)
        .then((rawTanks) => {
          if (stopped) return;
          setTanks(rawTanks);
          setSelectedIds((current) => current.filter((id) => rawTanks.some((tank) => Number(tank.id) === Number(id))));
        })
        .catch((syncError) => {
          if (!stopped) console.warn("[Showcase] Failed to refresh tanks after cloud sync:", syncError);
        });
    };
    window.addEventListener("aquadex:cloud-sync-complete", handleCloudSyncComplete);
    return () => {
      stopped = true;
      window.removeEventListener("aquadex:cloud-sync-complete", handleCloudSyncComplete);
    };
  }, [authAllowed, normalizedAccount]);

  useEffect(() => () => {
    if (mediaPreviewUrlRef.current) URL.revokeObjectURL(mediaPreviewUrlRef.current);
    mediaPreviewUrlRef.current = null;
  }, []);

  useEffect(() => {
    if (!normalizedAccount || !roomState?.room?.roomId || !mediaStatus?.assetId) return;
    if (RECOVERABLE_MEDIA_STATES.has(mediaStatus.state)) {
      writePendingHeroHandle(normalizedAccount, {
        roomId: roomState.room.roomId, assetId: mediaStatus.assetId,
      });
    } else if (["published", "revoked", "deleted", "rejected"].includes(mediaStatus.state)) {
      writePendingHeroHandle(normalizedAccount, null);
    }
  }, [mediaStatus?.assetId, mediaStatus?.state, normalizedAccount, roomState?.room?.roomId]);

  useEffect(() => {
    if (!authAllowed || mediaStatus?.state !== "processing" || !mediaStatus.assetId) return undefined;
    let stopped = false;
    let checking = false;
    let timer;
    const check = async () => {
      if (stopped || checking) return;
      checking = true;
      try {
        const result = await readShowcaseMediaStatus(mediaStatus.assetId);
        if (!stopped) {
          setMediaStatus(result.data);
          setMediaPhase(result.data.state);
          setMediaError(null);
        }
      } catch (err) {
        if (!stopped) {
          setMediaError(messageFor(err));
          setMediaPhase("status-error");
          clearInterval(timer);
        }
      } finally {
        checking = false;
      }
    };
    timer = setInterval(check, 2500);
    check();
    return () => { stopped = true; clearInterval(timer); };
  }, [authAllowed, mediaStatus?.assetId, mediaStatus?.state]);

  useEffect(() => {
    replaceMediaPreviewUrl(null);
    const hasHero = (mediaStatus?.variants || []).some((item) => item.variant === "hero" && item.mime === "image/webp");
    if (!authAllowed || roomState?.room?.visibility !== "private" || mediaStatus?.state !== "approved"
        || mediaStatus.metadataStripped !== true || !mediaStatus.assetId || !hasHero) return undefined;
    const controller = new AbortController();
    let stopped = false;
    previewShowcaseMedia({
      roomId: roomState.room.roomId, assetId: mediaStatus.assetId, variant: "hero",
    }, { signal: controller.signal }).then((blob) => {
      if (stopped) return;
      const objectUrl = URL.createObjectURL(blob);
      replaceMediaPreviewUrl(objectUrl);
      setMediaPhase("preview-ready");
      setMediaError(null);
    }).catch((err) => {
      if (stopped || err?.code === "request_aborted") return;
      setMediaError(messageFor(err));
      setMediaPhase("preview-denied");
    });
    return () => { stopped = true; controller.abort(); replaceMediaPreviewUrl(null); };
  }, [authAllowed, mediaStatus?.assetId, mediaStatus?.metadataStripped, mediaStatus?.revision,
    mediaStatus?.state, mediaStatus?.variants, replaceMediaPreviewUrl, roomState?.room?.roomId,
    roomState?.room?.visibility]);

  const openConflicts = useMemo(() => {
    const conflicts = (identity?.conflicts || []).filter((item) => item.status === "open");
    if (identity?.conflictsIncomplete) conflicts.push({ conflictId: "incomplete", reason: "CONFLICT_STATE_INCOMPLETE", candidateCount: "unknown" });
    return conflicts;
  }, [identity]);
  const room = roomState?.room || null;
  const selectedSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);
  const localPreviewSchedules = useMemo(() => Object.fromEntries(
    (localPreview?.tanks || []).map((tank) => [tank.id, []])
  ), [localPreview]);
  const eligibleTanks = useMemo(
    () => (roomState?.available || []).filter((item) => item.kind === "tank" && item.eligible === true),
    [roomState]
  );
  const eligibleIds = useMemo(() => new Set(eligibleTanks.map((item) => item.entityId)), [eligibleTanks]);
  const permittedEntityIds = useMemo(() => {
    const ids = new Set();
    for (const row of datasetState?.identityPackage?.identity?.tanks || []) {
      const id = typedTankId(row.entityKey);
      if (eligibleIds.has(id)) ids.add(id);
    }
    return ids;
  }, [datasetState, eligibleIds]);
  const requiredEntityIds = useMemo(
    () => (datasetState?.identityPackage?.identity?.tanks || []).map((row) => typedTankId(row.entityKey)).sort(),
    [datasetState]
  );
  const publicationPlacementsReady = useMemo(() => {
    const target = requiredEntityIds.length;
    if (target < 1 || permittedEntityIds.size !== target) return false;
    const required = new Set(requiredEntityIds);
    const placements = roomState?.placements || [];
    return placements.length === target
      && placements.every((item) => required.has(item.tankId) && item.visibility === "public")
      && (roomState?.placementNextCursor ?? null) === null
      && (roomState?.availableNextCursor ?? null) === null;
  }, [requiredEntityIds, permittedEntityIds, roomState]);
  const finalizeResult = datasetState?.finalizeResult;
  const identityMutationBlocked = openConflicts.length > 0
    || (finalizeResult && (finalizeResult.eligible !== true || Number(finalizeResult.conflictCount) > 0))
    || MUTATION_BLOCKING_PHASES.has(phase);

  const toggleTank = (id) => {
    if (datasetState?.selectedTankIds) return;
    setSelectionConfirmed(false);
    setLocalPreview(null);
    setLocalPreviewPhase("idle");
    setLocalPreviewError(null);
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < MAX_TANK_COUNT ? [...current, id] : current);
  };

  const handleLocalPreview = async () => {
    const uniqueIds = new Set(selectedIds.map(String));
    if (!authAllowed || normalizedAccount !== STEVE_WALLET || !selectionConfirmed
        || selectedIds.length < 1 || uniqueIds.size !== selectedIds.length) {
      setLocalPreviewError("Select at least one Steve-owned tank and confirm before previewing.");
      return;
    }
    setLocalPreviewPhase("loading");
    setLocalPreviewError(null);
    try {
      const next = await readLocalShowcasePreview({
        ownerAddress: normalizedAccount,
        selectedTankIds: selectedIds,
      });
      setLocalPreview(next);
      setLocalPreviewPhase("ready");
    } catch (previewError) {
      setLocalPreview(null);
      setLocalPreviewPhase("error");
      setLocalPreviewError(messageFor(previewError));
    }
  };

  const handleLinkWallet = async () => {
    if (identityMutationBlocked) return;
    setPhase("wallet-linking");
    setError(null);
    try {
      try {
        await linkShowcaseWalletClaim(CHAIN_ID);
      } catch (claimError) {
        if (claimError?.code !== "wallet_unavailable") throw claimError;

        const issued = await issueShowcaseWalletNonce({ wallet: normalizedAccount, chainId: CHAIN_ID });
        const signer = await getSigner();
        if (!signer) {
          throw new Error("The connected wallet cannot sign the ownership proof.", { cause: claimError });
        }

        const signerAddress = (await signer.getAddress()).toLowerCase();
        if (signerAddress !== normalizedAccount) {
          throw new Error("The signing wallet does not match the connected showcase wallet.", { cause: claimError });
        }

        const signature = await signer.signMessage(issued.data.message);
        await consumeShowcaseWalletProof({
          nonceId: issued.data.nonceId,
          nonce: issued.data.nonce,
          wallet: normalizedAccount,
          chainId: CHAIN_ID,
          issuedAt: issued.data.issuedAt,
          expirationTime: issued.data.expirationTime,
          signature,
        });
      }
      setWalletLinked(true);
      setPhase("tank-selection");
    } catch (err) {
      setError(messageFor(err));
      setPhase("error");
    }
  };

  const handleImport = async () => {
    if (identityMutationBlocked || !walletLinked || selectedIds.length < 1 || !selectionConfirmed) return;
    setError(null);
    setPreview(null);
    try {
      setPhase("enrolling");
      const serverHasExistingDataset = identity?.datasetsTruncated === true
        || (identity?.datasets || []).some((item) => item.active || ["enrolled", "adopted", "staged"].includes(item.status));
      const prepared = await prepareShowcaseDatasetV3({ ownerAddress: normalizedAccount, selectedTankIds: selectedIds, serverHasExistingDataset });
      const enrollment = await enrollShowcaseDataset(prepared.state.enrollmentRequest);
      const packaged = await bindShowcaseDatasetEnrollment(normalizedAccount, enrollment.data);
      setDatasetState(packaged);

      setPhase("import-starting");
      const started = await startShowcaseDatasetImport(packaged.startRequest);
      if (started.data.processingState !== "staged") throw new Error("The dataset import was quarantined. Stop and review the enrollment binding.");
      const bound = await bindShowcaseDatasetImport(normalizedAccount, started.data);
      setDatasetState(bound);

      setPhase("chunk-upload");
      if (!started.data.sealed) {
        for (const request of bound.chunkRequests) await uploadShowcaseDatasetChunk(request);
      }

      setPhase("finalizing");
      const finalized = await finalizeShowcaseDatasetImport(bound.finalizeRequest);
      const storedFinalize = await recordShowcaseDatasetResult(normalizedAccount, { finalizeResult: finalized.data });
      setDatasetState(storedFinalize);
      if (finalized.data.eligible !== true || Number(finalized.data.conflictCount) > 0) {
        const [nextIdentity, nextRoom, nextDataset] = await Promise.all([
          readCompleteIdentityState(), readShowcaseRoom(), getShowcaseDatasetState(normalizedAccount),
        ]);
        setIdentity(nextIdentity.data);
        setRoomState(nextRoom.data);
        setDatasetState(nextDataset);
        applyDatasetDrafts(nextDataset, tanks);
        setPhase("conflict");
        return;
      }

      setPhase("verifying");
      const staged = await stageShowcaseIdentityCandidates(bound.candidateRequest);
      await recordShowcaseDatasetResult(normalizedAccount, { candidateResult: staged.data });
      const [nextIdentity, nextRoom, nextDataset] = await Promise.all([
        readCompleteIdentityState(), readShowcaseRoom(), getShowcaseDatasetState(normalizedAccount),
      ]);
      setIdentity(nextIdentity.data);
      setRoomState(nextRoom.data);
      setDatasetState(nextDataset);
      applyDatasetDrafts(nextDataset, tanks);
      const hasConflict = identityHasOpenConflict(nextIdentity.data);
      setPhase(hasConflict ? "conflict" : nextRoom.data.room ? "private-editable" : "room-absent");
    } catch (err) {
      setError(messageFor(err));
      setPhase(err?.code === "identity_conflict" ? "conflict" : "error");
    }
  };

  const handleCreateRoom = async () => {
    if (identityMutationBlocked || !walletLinked) return;
    setError(null);
    setPreview(null);
    setPhase("room-checking");
    try {
      const fresh = await readShowcaseRoom();
      setRoomState(fresh.data);
      if (fresh.data.room) {
        setPhase(fresh.data.room.visibility === "private" ? "private-editable" : "must-make-private");
        return;
      }
      setPhase("room-creating");
      await createShowcaseRoom({ ...roomDraft, description: roomDraft.description || null, schematic: { zones: [] } });
      await refreshOwnerState();
    } catch (err) {
      setError(messageFor(err));
      setPhase("error");
    }
  };

  const handleSaveRoom = async () => {
    if (identityMutationBlocked || !walletLinked || !room || room.visibility !== "private") return;
    setError(null);
    setPreview(null);
    setPhase("room-saving");
    try {
      await updateShowcaseRoom({
        roomId: room.roomId, expectedRevision: room.revision, ...roomDraft,
        description: roomDraft.description || null, schematic: { zones: room.schematic?.zones || [] },
      });
      await refreshOwnerState();
    } catch (err) {
      setError(messageFor(err));
      setPhase(err?.code === "revision_conflict" ? "revision-stale" : "error");
    }
  };

  const handlePlace = async (tankId) => {
    const draft = placementDrafts[tankId];
    if (identityMutationBlocked || !walletLinked || !room || room.visibility !== "private" || !permittedEntityIds.has(tankId) || !draft?.approved || !draft.label.trim()) return;
    const existing = (roomState.placements || []).find((item) => item.tankId === tankId);
    setError(null);
    setPreview(null);
    setPhase("placing");
    try {
      await putShowcasePlacement({
        roomId: room.roomId,
        tankId,
        expectedRevision: existing ? existing.revision : null,
        slug: draft.slug,
        visibility: "public",
        label: draft.label.trim(),
        caption: null,
        facts: { volume: true, tankType: true, publishedInhabitantCount: false },
        placement: existing?.placement || {
          x: ((roomState.placements || []).length % 3) * 34,
          y: Math.floor((roomState.placements || []).length / 3) * 28,
          width: null, height: null, focalX: null, focalY: null, zoneId: null,
          order: (roomState.placements || []).length,
        },
      });
      await refreshOwnerState();
    } catch (err) {
      setError(messageFor(err));
      setPhase(err?.code === "revision_conflict" ? "revision-stale" : "error");
    }
  };

  const handlePreview = async () => {
    if (identityMutationBlocked || !room || !publicationPlacementsReady) return;
    setPhase("preview-loading");
    setError(null);
    setPreview(null);
    setPreviewRevision(null);
    setPublishConfirmed(false);
    try {
      const result = await previewShowcasePublication(room.roomId);
      setPreview(result.data);
      setPreviewRevision(room.revision);
      setPublishConfirmed(false);
      setPhase("preview-ready");
    } catch (err) {
      setError(messageFor(err));
      setPhase("publication-blocked");
    }
  };

  const handleVisibility = async (visibility) => {
    if (!room || (visibility !== "private" && (identityMutationBlocked || !walletLinked || !preview || !publishConfirmed
        || !publicationPlacementsReady || previewRevision !== room.revision || (roomState.blockers || []).length))) return;
    setPhase(visibility === "private" ? "unpublishing" : "publishing");
    setError(null);
    try {
      let expectedRevision = room.revision;
      let expectedPlacements = [];
      let approvedPreview = null;
      if (visibility !== "private") {
        const [freshIdentity, freshRoom, freshPreview] = await Promise.all([
          readCompleteIdentityState(), readShowcaseRoom(), previewShowcasePublication(room.roomId),
        ]);
        setIdentity(freshIdentity.data);
        setRoomState(freshRoom.data);
        const hasConflict = identityHasOpenConflict(freshIdentity.data);
        const currentRoom = freshRoom.data.room;
        const required = new Set(requiredEntityIds);
        const freshEligible = new Set((freshRoom.data.available || [])
          .filter((item) => item.kind === "tank" && item.eligible === true)
          .map((item) => item.entityId));
        const freshPlacements = freshRoom.data.placements || [];
        const freshPlacementsReady = required.size >= 1
          && freshPlacements.length === required.size
          && freshPlacements.every((item) => required.has(item.tankId) && item.visibility === "public")
          && [...required].every((tankId) => freshEligible.has(tankId));
        if (hasConflict || !currentRoom || currentRoom.visibility !== "private"
            || currentRoom.revision !== previewRevision || (freshRoom.data.blockers || []).length
            || !freshPlacementsReady
            || JSON.stringify(freshPreview.data) !== JSON.stringify(preview)) {
          setPreview(null);
          setPreviewRevision(null);
          setPublishConfirmed(false);
          setPhase(hasConflict ? "conflict" : "revision-stale");
          setError("Server state changed after approval. Review a fresh publication preview.");
          return;
        }
        expectedRevision = currentRoom.revision;
        expectedPlacements = freshPlacements
          .map((item) => ({ tankId: item.tankId, revision: item.revision }))
          .sort((a, b) => a.tankId.localeCompare(b.tankId));
        approvedPreview = freshPreview.data;
      }
      await setShowcasePublication({ roomId: room.roomId, expectedRevision, visibility, expectedPlacements, approvedPreview });
      setPreview(null);
      setPreviewRevision(null);
      setPublishConfirmed(false);
      await refreshOwnerState();
    } catch (err) {
      setPreview(null);
      setPreviewRevision(null);
      setPublishConfirmed(false);
      setError(messageFor(err));
      setPhase(err?.code === "revision_conflict" ? "revision-stale" : "publication-blocked");
    }
  };

  const handleHeroUpload = async () => {
    const extension = imageExtension(heroFile);
    if (!authAllowed || !room || room.visibility !== "private" || !extension
        || !Number.isSafeInteger(heroFile?.size) || heroFile.size < 1 || heroFile.size > 8 * 1024 * 1024) {
      setMediaError("Choose a JPEG, PNG, or WebP image no larger than 8 MiB while the room is private.");
      return;
    }
    setMediaPhase("staging");
    setMediaError(null);
    setHeroPublishApproved(false);
    setHeroRevokeApproved(false);
    replaceMediaPreviewUrl(null);
    let staged = null;
    let finalized = false;
    try {
      staged = await stageShowcaseHero({ roomId: room.roomId, fileExtension: extension });
      writePendingHeroHandle(normalizedAccount, {
        roomId: room.roomId, assetId: staged.data.assetId,
      });
      setMediaStatus({ assetId: staged.data.assetId, state: "staging", revision: 0, variants: [] });
      setMediaPhase("uploading");
      await uploadShowcaseHeroSource({ file: heroFile, upload: staged.data.upload });
      setMediaPhase("finalizing");
      await finalizeShowcaseHero({
        assetId: staged.data.assetId, uploadIntentId: staged.data.uploadIntentId,
      });
      finalized = true;
      const status = await readShowcaseMediaStatus(staged.data.assetId);
      setMediaStatus(status.data);
      setMediaPhase(status.data.state);
      setHeroFile(null);
    } catch (err) {
      // An ambiguous source PUT is never replayed. If finalization definitely did not return, make
      // one owner-bound best-effort revocation at the staging revision and leave refresh available.
      if (staged && !finalized) {
        try {
          await revokeShowcaseMedia({ assetId: staged.data.assetId, expectedRevision: 0 });
          const status = await readShowcaseMediaStatus(staged.data.assetId);
          setMediaStatus(status.data);
        } catch {
          // A revision conflict can mean finalization committed despite a lost response. Do not
          // guess or retry; the explicit status refresh below is the recovery path.
        }
      }
      setMediaError(messageFor(err));
      setMediaPhase("upload-error");
    }
  };

  const handleRefreshMedia = async () => {
    if (!mediaStatus?.assetId) return;
    setMediaPhase("status-loading");
    setMediaError(null);
    try {
      const result = await readShowcaseMediaStatus(mediaStatus.assetId);
      setMediaStatus(result.data);
      setMediaPhase(result.data.state);
    } catch (err) {
      setMediaError(messageFor(err));
      setMediaPhase("status-error");
    }
  };

  const handlePublishHero = async () => {
    if (!room || room.visibility !== "private" || mediaStatus?.state !== "approved"
        || !heroPublishApproved || !heroAltText.trim()) return;
    setMediaPhase("publishing");
    setMediaError(null);
    try {
      const fresh = await readShowcaseMediaStatus(mediaStatus.assetId);
      if (fresh.data.state !== "approved" || fresh.data.metadataStripped !== true
          || fresh.data.revision !== mediaStatus.revision) {
        setMediaStatus(fresh.data);
        setHeroPublishApproved(false);
        setMediaPhase("state-stale");
        setMediaError("The processed image changed. Review the private preview again.");
        return;
      }
      await publishShowcaseHero({
        roomId: room.roomId, assetId: mediaStatus.assetId, altText: heroAltText.trim(),
        focalX: Number(heroFocalX), focalY: Number(heroFocalY),
      });
      const status = await readShowcaseMediaStatus(mediaStatus.assetId);
      setMediaStatus(status.data);
      setMediaPhase(status.data.state);
      setHeroPublishApproved(false);
      replaceMediaPreviewUrl(null);
      await refreshOwnerState();
    } catch (err) {
      setMediaError(messageFor(err));
      setMediaPhase(err?.code === "revision_conflict" ? "state-stale" : "publish-error");
    }
  };

  const handleRevokeHero = async () => {
    if (!mediaStatus?.assetId || !heroRevokeApproved) return;
    setMediaPhase("revoking");
    setMediaError(null);
    try {
      const fresh = await readShowcaseMediaStatus(mediaStatus.assetId);
      await revokeShowcaseMedia({ assetId: mediaStatus.assetId, expectedRevision: fresh.data.revision });
      const status = await readShowcaseMediaStatus(mediaStatus.assetId);
      setMediaStatus(status.data);
      setMediaPhase(status.data.state);
      setHeroPublishApproved(false);
      setHeroRevokeApproved(false);
      replaceMediaPreviewUrl(null);
      await refreshOwnerState();
    } catch (err) {
      setMediaError(messageFor(err));
      setMediaPhase(err?.code === "revision_conflict" ? "state-stale" : "revoke-error");
    }
  };

  if (!ready || phase === "auth-loading" || phase === "session-loading") return <div className="glass-card" style={panel}>Loading authenticated showcase tools…</div>;
  if (phase === "sign-in-required") return (
    <div className="glass-card" style={panel}>
      <h3 style={{ color: "var(--text-primary)", marginTop: 0 }}>Privy sign-in required</h3>
      <p style={{ color: "var(--text-secondary)" }}>MetaMask-only and signed-out sessions cannot access owner showcase mutations.</p>
      <button type="button" className="btn-primary" onClick={connectPrivy}>Sign in with Privy</button>
    </div>
  );
  if (phase === "wrong-wallet") return (
    <div className="glass-card" style={{ ...panel, borderColor: "rgba(248,113,113,.45)" }}>
      <h3 style={{ color: "var(--accent-red)", marginTop: 0 }}>Wrong owner wallet</h3>
      <p style={{ color: "var(--text-secondary)" }}>Connected: <code>{normalizedAccount}</code></p>
      <p style={{ color: "var(--text-secondary)" }}>Required: <code>{STEVE_WALLET}</code></p>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div className="glass-card" style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h3 style={{ color: "var(--text-primary)", margin: "0 0 .35rem" }}>Fish Room owner tools</h3>
            <div style={{ color: "var(--text-muted)", fontSize: ".78rem" }}>Authenticated owner: <code>{normalizedAccount}</code></div>
          </div>
          <button type="button" className="btn-secondary" onClick={refreshOwnerState} disabled={phase === "bootstrapping"}>Refresh server state</button>
        </div>
        <p style={{ color: "var(--text-secondary)", marginBottom: 0 }}>State: <strong>{phase}</strong>. The room remains private while editing.</p>
        {error && <p role="alert" style={{ color: "var(--accent-red)", marginBottom: 0 }}>{error}</p>}
      </div>

      {!walletLinked && (
        <div className="glass-card" style={panel}>
          <h4 style={{ color: "var(--text-primary)", marginTop: 0 }}>1. Link the verified wallet claim</h4>
          <p style={{ color: "var(--text-secondary)" }}>This is an explicit, owner-authorized action. It does not enroll a dataset or create a room.</p>
          <button type="button" className="btn-primary" onClick={handleLinkWallet} disabled={!bootstrap || identityMutationBlocked}>Link this wallet</button>
        </div>
      )}

      <div className="glass-card" style={panel}>
        <h4 style={{ color: "var(--text-primary)", marginTop: 0 }}>2. Confirm your showcase tanks</h4>
        <p style={{ color: "var(--text-secondary)" }}>Only active raw Dexie rows owned by the authenticated wallet are shown. Nothing is selected by label. Select the tanks you want to show.</p>
        {tanks.length === 0 ? <p style={{ color: "var(--accent-amber)" }}>No owner-scoped active local tanks were found on this browser.</p> : tanks.map((tank) => (
          <label key={tank.id} style={{ display: "flex", alignItems: "center", gap: ".65rem", padding: ".55rem 0", color: "var(--text-primary)" }}>
            <input type="checkbox" checked={selectedSet.has(String(tank.id))} disabled={!!datasetState?.selectedTankIds} onChange={() => toggleTank(tank.id)} />
            <span>{tank.name} <small style={{ color: "var(--text-muted)" }}>local #{tank.id}</small></span>
          </label>
        ))}
        <p style={{ color: selectedIds.length >= 1 ? "var(--accent-green)" : "var(--accent-amber)" }}>{selectedIds.length} of {tanks.length} selected</p>
        <label style={{ display: "flex", gap: ".55rem", color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={selectionConfirmed} onChange={(event) => {
            setSelectionConfirmed(event.target.checked);
            setLocalPreview(null);
            setLocalPreviewPhase("idle");
            setLocalPreviewError(null);
          }} />
          I confirm these are Steve's intended showcase tanks.
        </label>
        <div style={{ display: "flex", gap: ".65rem", flexWrap: "wrap", marginTop: ".8rem" }}>
          <button type="button" className="btn-primary" onClick={handleLocalPreview}
            disabled={localPreviewPhase === "loading" || selectedIds.length < 1 || !selectionConfirmed}>
            {localPreviewPhase === "loading" ? "Building room preview…" : "Show these tanks now"}
          </button>
          <button type="button" className="btn-secondary" onClick={handleImport}
            disabled={identityMutationBlocked || !walletLinked || selectedIds.length < 1 || !selectionConfirmed}>
            Enroll and import later
          </button>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: ".8rem", marginBottom: 0 }}>
          The visual preview reads this device only. It does not create IDs, import, publish, or assign reference media.
        </p>
        {localPreviewError && <p role="alert" style={{ color: "var(--accent-red)", marginBottom: 0 }}>{localPreviewError}</p>}
      </div>

      {localPreview && (
        <div className="glass-card" style={{ ...panel, padding: "clamp(.8rem, 2vw, 1.4rem)" }}>
          <div style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: ".6rem", color: "var(--accent-teal)", fontSize: ".7rem", fontWeight: 800, letterSpacing: ".16em", textTransform: "uppercase" }}>
              <span aria-hidden="true" style={{ width: "28px", height: "1px", background: "currentColor" }} />
              Private device preview. Not imported or published
            </div>
            <h2 style={{ color: "var(--text-primary)", margin: ".6rem 0 .4rem", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "clamp(1.6rem, 3.6vw, 2.4rem)", lineHeight: 1, letterSpacing: "-.04em" }}>{localPreview.title}</h2>
            <p style={{ color: "var(--text-secondary)", margin: 0 }}>{localPreview.description}</p>
            <p style={{ color: "var(--text-muted)", fontSize: ".82rem", marginBottom: 0 }}>
              Showing {localPreview.tanks.length} real My Aquariums tanks and their active local fish. Existing device photos appear automatically; missing media stays missing.
            </p>
          </div>
          <CasualTankGallery
            tanks={localPreview.tanks}
            fishbaseData={fishbaseData}
            schedulesOverride={localPreviewSchedules}
          />
        </div>
      )}

      {openConflicts.length > 0 && (
        <div className="glass-card" style={{ ...panel, borderColor: "rgba(248,113,113,.45)" }}>
          <h4 style={{ color: "var(--accent-red)", marginTop: 0 }}>Identity conflict. Stopped</h4>
          {openConflicts.map((conflict) => <div key={conflict.conflictId} style={{ color: "var(--text-secondary)" }}>{conflict.reason} ({conflict.candidateCount} candidates)</div>)}
        </div>
      )}

      {walletLinked && datasetState?.finalizeResult?.eligible && !room && !identityMutationBlocked && (
        <div className="glass-card" style={panel}>
          <h4 style={{ color: "var(--text-primary)", marginTop: 0 }}>3. Create the lifetime room</h4>
          <RoomFields draft={roomDraft} onChange={setRoomDraft} />
          <button type="button" className="btn-primary" style={{ marginTop: ".8rem" }} onClick={handleCreateRoom}>Re-read, then create once</button>
        </div>
      )}

      {room && (
        <div className="glass-card" style={panel}>
          <h4 style={{ color: "var(--text-primary)", marginTop: 0 }}>4. Private room</h4>
          <p style={{ color: room.visibility === "private" ? "var(--accent-green)" : "var(--accent-amber)" }}>Visibility: {room.visibility} · room revision {room.revision}</p>
          {room.visibility !== "private" ? (
            <button type="button" className="btn-primary" onClick={() => handleVisibility("private")}>Make private</button>
          ) : (
            <>
              <RoomFields draft={roomDraft} onChange={setRoomDraft} />
              <button type="button" className="btn-secondary" style={{ marginTop: ".8rem" }} disabled={!walletLinked || identityMutationBlocked} onClick={handleSaveRoom}>Save room metadata with revision {room.revision}</button>
            </>
          )}
        </div>
      )}

      {room?.visibility === "private" && datasetState?.identityPackage && !identityMutationBlocked && (
        <div className="glass-card" style={panel}>
          <h4 style={{ color: "var(--text-primary)", marginTop: 0 }}>5. Place server-eligible tanks</h4>
          <p style={{ color: "var(--text-secondary)" }}>Only canonical IDs returned as <code>eligible: true</code> by the latest room read can be placed. Each label requires approval.</p>
          {[...permittedEntityIds].map((tankId) => {
            const draft = placementDrafts[tankId] || { label: "", slug: "", approved: false };
            const existing = (roomState.placements || []).find((item) => item.tankId === tankId);
            return (
              <div key={tankId} style={{ padding: ".8rem 0", borderTop: "1px solid var(--glass-border)" }}>
                <code style={{ color: "var(--text-muted)", fontSize: ".72rem" }}>{tankId}</code>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: ".6rem", marginTop: ".5rem" }}>
                  <input style={inputStyle} value={draft.label} placeholder="Approved public label" onChange={(event) => setPlacementDrafts((all) => ({ ...all, [tankId]: { ...draft, label: event.target.value, approved: false } }))} />
                  <input style={inputStyle} value={draft.slug} placeholder="public-slug" onChange={(event) => setPlacementDrafts((all) => ({ ...all, [tankId]: { ...draft, slug: slugify(event.target.value), approved: false } }))} />
                </div>
                <label style={{ display: "flex", gap: ".5rem", color: "var(--text-secondary)", margin: ".55rem 0" }}>
                  <input type="checkbox" checked={draft.approved} onChange={(event) => setPlacementDrafts((all) => ({ ...all, [tankId]: { ...draft, approved: event.target.checked } }))} />
                  Steve approves this public label and slug.
                </label>
                <button type="button" className="btn-secondary" disabled={!walletLinked || !draft.approved || !draft.label.trim() || !draft.slug} onClick={() => handlePlace(tankId)}>{existing ? `Update at revision ${existing.revision}` : "Place tank"}</button>
              </div>
            );
          })}
          {permittedEntityIds.size === 0 && <p style={{ color: "var(--accent-amber)" }}>No selected tank is currently server-eligible. Refresh identity state; do not place guessed IDs.</p>}
        </div>
      )}

      {room?.visibility === "private" && (
        <div className="glass-card" style={panel}>
          <h4 style={{ color: "var(--text-primary)", marginTop: 0 }}>6. Private processed room image</h4>
          <p style={{ color: "var(--text-secondary)" }}>
            The source uploads to the private processing pipeline. Only the approved, metadata-stripped
            WebP derivative is previewed here through a fresh owner-authenticated, no-store byte request.
          </p>
          {!bootstrap?.capabilities?.media && <p style={{ color: "var(--accent-amber)" }}>Private room media is not enabled in this environment.</p>}
          <input
            key={mediaStatus?.assetId || "new-hero"}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={!bootstrap?.capabilities?.media || ["staging", "uploading", "finalizing", "processing", "publishing", "revoking"].includes(mediaPhase)}
            onChange={(event) => {
              setHeroFile(event.target.files?.[0] || null);
              setHeroPublishApproved(false);
              setMediaError(null);
            }}
          />
          <button
            type="button"
            className="btn-secondary"
            style={{ margin: ".8rem 0 0 .6rem" }}
            onClick={handleHeroUpload}
            disabled={!bootstrap?.capabilities?.media || !heroFile || ["staging", "uploading", "finalizing", "processing", "publishing", "revoking"].includes(mediaPhase)}
          >
            Upload once and process privately
          </button>
          <p style={{ color: "var(--text-muted)", fontSize: ".8rem" }}>
            Media state: <strong>{mediaPhase}</strong>
            {mediaStatus?.assetId && <> · asset <code>{mediaStatus.assetId}</code> · revision {mediaStatus.revision ?? "unknown"}</>}
          </p>
          {mediaError && <p role="alert" style={{ color: "var(--accent-red)" }}>{mediaError}</p>}
          {mediaStatus?.assetId && (
            <button type="button" className="btn-secondary" onClick={handleRefreshMedia}
              disabled={["status-loading", "publishing", "revoking"].includes(mediaPhase)}>
              Refresh processing status
            </button>
          )}

          {mediaPreviewUrl && mediaStatus?.state === "approved" && (
            <div style={{ marginTop: "1rem" }}>
              <img
                src={mediaPreviewUrl}
                alt={heroAltText.trim() || "Private processed room preview"}
                style={{ width: "100%", maxHeight: "520px", objectFit: "cover", borderRadius: "10px", border: "1px solid var(--glass-border)" }}
              />
              <p style={{ color: "var(--accent-green)" }}>Private derivative verified. This blob URL exists only in this browser session and is revoked on every state change.</p>
              <label style={{ color: "var(--text-secondary)", display: "block" }}>
                Approved public alt text
                <input style={inputStyle} maxLength={500} value={heroAltText}
                  onChange={(event) => { setHeroAltText(event.target.value); setHeroPublishApproved(false); }} />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(130px,1fr))", gap: ".6rem", marginTop: ".6rem" }}>
                <label style={{ color: "var(--text-secondary)" }}>Focal X (0–1)
                  <input style={inputStyle} type="number" min="0" max="1" step="0.01" value={heroFocalX}
                    onChange={(event) => { setHeroFocalX(event.target.value); setHeroPublishApproved(false); }} />
                </label>
                <label style={{ color: "var(--text-secondary)" }}>Focal Y (0–1)
                  <input style={inputStyle} type="number" min="0" max="1" step="0.01" value={heroFocalY}
                    onChange={(event) => { setHeroFocalY(event.target.value); setHeroPublishApproved(false); }} />
                </label>
              </div>
              <label style={{ display: "flex", gap: ".55rem", color: "var(--text-secondary)", marginTop: ".7rem" }}>
                <input type="checkbox" checked={heroPublishApproved} onChange={(event) => setHeroPublishApproved(event.target.checked)} />
                Steve approves this exact processed image, alt text, and focal point for the room.
              </label>
              <button type="button" className="btn-primary" style={{ marginTop: ".8rem" }} onClick={handlePublishHero}
                disabled={!heroPublishApproved || !heroAltText.trim() || !Number.isFinite(Number(heroFocalX))
                  || !Number.isFinite(Number(heroFocalY)) || Number(heroFocalX) < 0 || Number(heroFocalX) > 1
                  || Number(heroFocalY) < 0 || Number(heroFocalY) > 1 || mediaPhase === "publishing"}>
                Publish approved image to the private room
              </button>
            </div>
          )}

          {mediaStatus?.assetId && !["revoked", "deleted", "rejected"].includes(mediaStatus.state) && (
            <div style={{ marginTop: "1rem", paddingTop: ".8rem", borderTop: "1px solid var(--glass-border)" }}>
              <label style={{ display: "flex", gap: ".55rem", color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={heroRevokeApproved} onChange={(event) => setHeroRevokeApproved(event.target.checked)} />
                Revoke this asset and deny all future private/public byte requests.
              </label>
              <button type="button" className="btn-secondary" style={{ marginTop: ".6rem" }}
                disabled={!heroRevokeApproved || mediaPhase === "revoking"} onClick={handleRevokeHero}>
                Revoke image
              </button>
            </div>
          )}
        </div>
      )}

      {room?.visibility === "private" && bootstrap?.capabilities?.video === true && (
        <ShowcaseVideoGallery
          roomId={room.roomId}
          ownerAddress={normalizedAccount}
          enabled
        />
      )}

      {room && (
        <div className="glass-card" style={panel}>
          <h4 style={{ color: "var(--text-primary)", marginTop: 0 }}>8. Exact server publication preview</h4>
          {(roomState.blockers || []).length > 0 && <p style={{ color: "var(--accent-red)" }}>Blockers: {(roomState.blockers || []).join(", ")}</p>}
          {!publicationPlacementsReady && room.visibility === "private" && (
            <p style={{ color: "var(--accent-amber)" }}>Publication requires exactly the confirmed canonical tanks, all server-eligible and placed with public placement visibility.</p>
          )}
          <button type="button" className="btn-secondary" disabled={identityMutationBlocked || !publicationPlacementsReady} onClick={handlePreview}>Load fresh server preview</button>
          {preview && (
            <>
              <pre style={{ maxHeight: "420px", overflow: "auto", whiteSpace: "pre-wrap", color: "var(--text-secondary)", background: "var(--bg-band)", padding: ".8rem", borderRadius: "8px" }}>{JSON.stringify(preview, null, 2)}</pre>
              {room.visibility === "private" && (
                <>
                  <label style={{ display: "flex", gap: ".55rem", color: "var(--text-secondary)" }}>
                    <input type="checkbox" checked={publishConfirmed} onChange={(event) => setPublishConfirmed(event.target.checked)} />
                    Steve approves this exact server projection for public publication.
                  </label>
                  <button type="button" className="btn-primary" style={{ marginTop: ".8rem" }} disabled={identityMutationBlocked || !walletLinked || !publishConfirmed || !publicationPlacementsReady || previewRevision !== room.revision || (roomState.blockers || []).length > 0} onClick={() => handleVisibility("public")}>Publish {requiredEntityIds.length} approved tank{requiredEntityIds.length === 1 ? "" : "s"} with room revision {room.revision}</button>
                </>
              )}
            </>
          )}
          {room.visibility !== "private" && <button type="button" className="btn-primary" style={{ marginTop: ".8rem" }} onClick={() => handleVisibility("private")}>Make private</button>}
        </div>
      )}
    </div>
  );
}

function RoomFields({ draft, onChange }) {
  return (
    <div style={{ display: "grid", gap: ".6rem" }}>
      <label style={{ color: "var(--text-secondary)" }}>Public slug<input style={inputStyle} value={draft.slug} onChange={(event) => onChange({ ...draft, slug: slugify(event.target.value) })} /></label>
      <label style={{ color: "var(--text-secondary)" }}>Title<input style={inputStyle} value={draft.title} maxLength={80} onChange={(event) => onChange({ ...draft, title: event.target.value })} /></label>
      <label style={{ color: "var(--text-secondary)" }}>Description<textarea style={{ ...inputStyle, minHeight: "90px" }} value={draft.description} maxLength={1000} onChange={(event) => onChange({ ...draft, description: event.target.value })} /></label>
    </div>
  );
}
