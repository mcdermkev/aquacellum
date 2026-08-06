import React, { useState, useEffect, useMemo } from "react";
import { ethers, Contract, parseEther } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import { awardXp } from "../utils/xp";
import { getProvider } from "../utils/smartAccount";
import { relayCreateListing } from "../services/relayer";
import { checkSellerStatus, startSellerOnboarding } from "../services/stripePayments";
import { db } from "../db";
import { Modal } from "./Modal";
import { loadSpeciesRecordLookup, getSpeciesRecord } from "../utils/speciesRecordLookup";
import { buildListingDraftFromSpecies } from "../services/listingDraft";
import { draftListingDescription } from "../services/poseidonListingDraft";
import { listParcelPresets } from "../services/parcelPresets";
import { normalizeParcelPreset, computeUsage, boxesRequired } from "../services/packingEngine";
import { useMarketplaceListings } from "../hooks/useMarketplaceListings";
import { resolveSpecimenPhoto } from "../services/tankMedia";

// normalizeSpeciesProfile's temperament classification -> this form's free-text
// Temperament <select> options. "predatory" has no dedicated option here (this
// field is a general listing descriptor, not the shipping co-bagging engine),
// so it maps to the closest existing option rather than being left unfilled.
const TEMPERAMENT_TO_SELECT_OPTION = Object.freeze({
  peaceful: "Peaceful",
  semi_aggressive: "Semi-Aggressive",
  aggressive: "Aggressive",
  territorial: "Territorial",
  predatory: "Aggressive",
});

function celsiusToFahrenheit(c) {
  if (c == null || Number.isNaN(Number(c))) return null;
  return Math.round((Number(c) * 9) / 5 + 32);
}

/**
 * Small "verified" (emerald) vs "estimated" (amber) confidence pill — icon
 * AND text, per docs/TASK_09_INC2_LISTING_FLOW_SPEC.md §3/§4.10 (never
 * color-only). Shown next to auto-populated fields so the seller always
 * knows what's known vs guessed.
 */
function ConfidencePill({ known }) {
  return (
    <span
      style={{
        fontSize: "0.58rem",
        fontWeight: 600,
        padding: "0.05rem 0.4rem",
        borderRadius: "6px",
        marginLeft: "0.4rem",
        background: known ? "rgba(52,211,153,0.12)" : "rgba(251,191,36,0.12)",
        border: `1px solid ${known ? "rgba(52,211,153,0.35)" : "rgba(251,191,36,0.35)"}`,
        color: known ? "#34d399" : "#fbbf24",
        whiteSpace: "nowrap",
      }}
    >
      {known ? "✓ verified" : "≈ estimated"}
    </span>
  );
}

const getSpecimenPhotoUrl = (commonName) => {
  if (!commonName) return "";
  const formatted = commonName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `https://oexctbbybpfvslgxlscg.supabase.co/storage/v1/object/public/fish-photos/${formatted}.jpg?width=150&height=150&resize=contain&quality=80`;
};

export function ListSpecimenModal({ 
  isOpen, 
  onClose, 
  contractAddress, 
  marketplaceAddress, 
  walletAccount, 
  onSuccess,
  preselectedListSpecimen,
  preselectedListTank
}) {
  const [tokenId, setTokenId] = useState("");
  const [price, setPrice] = useState("");
  // Default to shipping — it reaches the most buyers. Sellers can switch to
  // local pickup (which is fee-free at live events). Shipping itself is
  // buyer-paid and quoted live at checkout — no flat fee to set here.
  const [isShipping, setIsShipping] = useState(true);
  // Set when we auto-fill care fields from species reference data, so we can
  // show a small "prefilled, editable" hint.
  const [carePrefilled, setCarePrefilled] = useState(false);
  // Per-field confidence map from buildListingDraftFromSpecies — drives the
  // "verified" vs "estimated" pills (spec §3: never present a guess as fact).
  const [careConfidence, setCareConfidence] = useState(null);
  // The buyer-parity compatibility verdict/headline (compatibilityExplanation.js,
  // via listingDraft.js) — "here's what buyers will see." No seller tank
  // context exists in this flow, so this deterministically shows the
  // engine's own "select a tank" placeholder rather than a fabricated verdict.
  const [compatibilityPreview, setCompatibilityPreview] = useState(null);
  // The anti-fabrication whitelist passed to Poseidon for the AI draft —
  // never free-form seller text, never health/guarantee/lineage/price fields.
  const [groundingFacts, setGroundingFacts] = useState(null);
  // Packing profile — derived default from packingEngine.deriveDefaultPackingProfile,
  // editable by the seller via the preset preview below. Sent through to
  // relayCreateListing so the listing carries its own packing starting point.
  const [packingProfile, setPackingProfile] = useState(null);
  // Seller's parcel presets (Task 9 Inc2 §2.4 editor) + the one selected here
  // to preview capacity against. Purely a preview — presets are edited in the
  // Breeder Terminal's Shipping section, not here.
  const [parcelPresets, setParcelPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState(null);
  // Price suggestion (median/range of comparable active listings for this
  // species) — a hint, never a promise; null below the sample floor.
  const [priceSuggestion, setPriceSuggestion] = useState(null);
  // Poseidon-drafted description state — the AI draft is clearly distinct
  // from the seller's own text until they choose to use it.
  const [aiDraftText, setAiDraftText] = useState(null);
  const [aiDraftLoading, setAiDraftLoading] = useState(false);
  const [aiDraftError, setAiDraftError] = useState(null);
  const [step, setStep] = useState(1); // 1: Input/Check, 2: Approve, 3: List
  const [isApproved, setIsApproved] = useState(false);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);
  const [specimenInfo, setSpecimenInfo] = useState(null);

  // Seller payout (Stripe Connect) readiness. Buyers can't complete checkout for
  // a seller who hasn't finished onboarding, so we surface it before listing.
  // null = unknown/not yet checked, true/false once resolved.
  const [sellerPayoutReady, setSellerPayoutReady] = useState(null);
  const [onboardingPayout, setOnboardingPayout] = useState(false);

  // Enhanced listing fields
  const [description, setDescription] = useState("");
  const [age, setAge] = useState("");
  const [ageUnit, setAgeUnit] = useState("months");
  const [size, setSize] = useState("");
  const [diet, setDiet] = useState("");
  const [temperament, setTemperament] = useState("");
  const [careLevel, setCareLevel] = useState(0); // 0=Beginner, 1=Intermediate, 2=Advanced
  const [minTemp, setMinTemp] = useState("");
  const [maxTemp, setMaxTemp] = useState("");
  const [minPh, setMinPh] = useState("");
  const [maxPh, setMaxPh] = useState("");
  const [tankSizeMin, setTankSizeMin] = useState("");
  const [healthStatus, setHealthStatus] = useState("healthy"); // healthy, treated, quarantine
  const [doaGuarantee, setDoaGuarantee] = useState(true);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);

  // Owned-specimen picker — lets sellers tap the fish they mean instead of
  // memorizing/typing its Certificate Serial No. Falls back to manual entry
  // for edge cases (e.g. specimen not synced locally).
  const [ownedSpecimens, setOwnedSpecimens] = useState([]);
  const [loadingOwned, setLoadingOwned] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);

  useEffect(() => {
    if (!isOpen || preselectedListSpecimen) return;
    let cancelled = false;
    (async () => {
      setLoadingOwned(true);
      try {
        const all = await db.specimens.toArray();
        const mine = all.filter(
          (s) => (s.ownerAddress || "").toLowerCase() === (walletAccount || "").toLowerCase() && s.status === 0
        );
        // Newest first so recently added/hatched fish are easiest to find.
        mine.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        if (!cancelled) setOwnedSpecimens(mine);
      } catch (err) {
        console.warn("Failed to load owned specimens:", err);
        if (!cancelled) setOwnedSpecimens([]);
      } finally {
        if (!cancelled) setLoadingOwned(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, preselectedListSpecimen, walletAccount]);

  const handleSelectOwnedSpecimen = (spec) => {
    setTokenId(String(spec.id));
    verifyToken(Number(spec.id));
  };

  useEffect(() => {
    if (!isOpen) {
      // Reset state on close
      setTokenId("");
      setPrice("");
      setIsShipping(true);
      setStep(1);
      setIsApproved(false);
      setError(null);
      setSpecimenInfo(null);
      setCarePrefilled(false);
      setTxHash(null);
      // Reset enhanced fields
      setDescription("");
      setAge("");
      setAgeUnit("months");
      setSize("");
      setDiet("");
      setTemperament("");
      setCareLevel(0);
      setMinTemp("");
      setMaxTemp("");
      setMinPh("");
      setMaxPh("");
      setTankSizeMin("");
      setHealthStatus("healthy");
      setDoaGuarantee(true);
      setPhotoFile(null);
      setPhotoPreview(null);
      setSellerPayoutReady(null);
      setOnboardingPayout(false);
      setManualEntry(false);
      setOwnedSpecimens([]);
      setCareConfidence(null);
      setCompatibilityPreview(null);
      setGroundingFacts(null);
      setPackingProfile(null);
      setSelectedPresetId(null);
      setPriceSuggestion(null);
      setAiDraftText(null);
      setAiDraftLoading(false);
      setAiDraftError(null);
    }
  }, [isOpen]);

  // Check the seller's Stripe payout readiness when the modal opens so we can
  // nudge them to connect before a buyer hits a dead end at checkout.
  useEffect(() => {
    if (!isOpen || !walletAccount) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await checkSellerStatus(walletAccount);
        if (!cancelled) setSellerPayoutReady(!!(status.connected && status.onboardingComplete));
      } catch {
        if (!cancelled) setSellerPayoutReady(null);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, walletAccount]);

  // Load the seller's parcel presets (Task 9 Inc2 §2.4) — a preview only;
  // presets themselves are managed in the Breeder Terminal's Shipping
  // section. Default preset (if any) is preselected.
  useEffect(() => {
    if (!isOpen || !walletAccount) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await listParcelPresets();
        if (cancelled) return;
        const presets = res.success ? res.presets || [] : [];
        setParcelPresets(presets);
        const def = presets.find((p) => p.isDefault) || presets[0];
        if (def) setSelectedPresetId(def.id);
      } catch {
        if (!cancelled) setParcelPresets([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, walletAccount]);

  // Same-species active listings, for the price suggestion (median/range of
  // comparables). Filtered client-side to this specimen's speciesId once
  // known; the hook itself is the shared source buyers' catalog also uses.
  const { data: allListingsForPricing = [] } = useMarketplaceListings(contractAddress, marketplaceAddress);

  const handleStartPayoutOnboarding = async () => {
    setOnboardingPayout(true);
    setError(null);
    try {
      const result = await startSellerOnboarding({ walletAddress: walletAccount });
      if (result.success && result.onboardingUrl) {
        window.location.href = result.onboardingUrl;
      } else {
        throw new Error(result.error || "Could not start payout setup");
      }
    } catch (err) {
      setError(err.message || "Could not start payout setup");
      setOnboardingPayout(false);
    }
  };

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Photo must be under 5MB.");
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result);
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (isOpen && preselectedListSpecimen) {
      const tid = preselectedListSpecimen.id || preselectedListSpecimen.specimenId || preselectedListSpecimen.tokenId;
      if (tid && !isNaN(Number(tid))) {
        setTokenId(tid.toString());
        verifyToken(Number(tid));
      } else {
        setError("This specimen cannot be listed (batch pending individual registration).");
      }
    }
  }, [isOpen, preselectedListSpecimen]);

  // Reuse what the fish already is: once the specimen resolves, pre-fill the
  // species-level care fields (temp/pH/tank/care level) from Spec-Dex via the
  // shared listingDraft.js core (Task 9 Increment 2 §2.1/§2.2) — the same
  // normalizeSpeciesProfile/deriveDefaultPackingProfile/compatibility engines
  // buyers' pages use. Only fills EMPTY fields, so seller edits always win.
  // Also derives the packing profile + the sanitized groundingFacts whitelist
  // for the "Draft with Poseidon" assist below.
  useEffect(() => {
    if (!isOpen || !specimenInfo?.scientificName) return;
    let cancelled = false;
    (async () => {
      const lookup = await loadSpeciesRecordLookup();
      if (cancelled) return;
      const record = getSpeciesRecord(specimenInfo.scientificName, lookup) || {
        scientificName: specimenInfo.scientificName,
        commonName: specimenInfo.commonName,
      };
      const draft = buildListingDraftFromSpecies(record, { quantity: 1 });
      if (cancelled) return;

      let filledAny = false;
      const { care } = draft;
      if (care.tempRangeCelsius) {
        const [minC, maxC] = care.tempRangeCelsius;
        const minF = celsiusToFahrenheit(minC);
        const maxF = celsiusToFahrenheit(maxC);
        if (minF != null) { setMinTemp((v) => v || String(minF)); filledAny = true; }
        if (maxF != null) { setMaxTemp((v) => v || String(maxF)); filledAny = true; }
      }
      if (care.phRange) {
        setMinPh((v) => v || String(care.phRange[0]));
        setMaxPh((v) => v || String(care.phRange[1]));
        filledAny = true;
      }
      if (care.minVolumeGallons != null) {
        setTankSizeMin((v) => v || String(care.minVolumeGallons));
        filledAny = true;
      }
      if (care.careLevel != null) setCareLevel(care.careLevel);
      if (care.temperament && care.temperament !== "unknown") {
        const option = TEMPERAMENT_TO_SELECT_OPTION[care.temperament];
        if (option) { setTemperament((v) => v || option); filledAny = true; }
      }
      if (care.diet) { setDiet((v) => v || care.diet); filledAny = true; }

      setCareConfidence(care.dataConfidence);
      setCompatibilityPreview(draft.compatibilityPreview);
      setGroundingFacts(draft.groundingFacts);
      setPackingProfile(draft.packingProfile);

      // Prefill the specimen's own photo, resolved through the one precedence order
      // (§9.3): hosted CDN copy, then the durable Dexie row, then the legacy
      // localStorage blob. Nothing resolving leaves the preview empty — the picker's
      // own empty state — rather than prefilling a stand-in image.
      const { url: savedPhoto } = await resolveSpecimenPhoto(specimenInfo.id);
      if (savedPhoto && !cancelled) setPhotoPreview((p) => p || savedPhoto);
      if (filledAny && !cancelled) setCarePrefilled(true);
    })();
    return () => { cancelled = true; };
  }, [isOpen, specimenInfo]);

  // Price suggestion (§2.1 buildPriceSuggestion) — median/range of comparable
  // ACTIVE listings for this same species. A hint shown alongside the price
  // field; null (and hidden) below the sample floor rather than a misleading
  // single-comp number.
  useEffect(() => {
    if (!specimenInfo?.speciesId) { setPriceSuggestion(null); return; }
    const comparables = (allListingsForPricing || []).filter(
      (l) => Number(l.speciesId) === Number(specimenInfo.speciesId)
    );
    const draft = buildListingDraftFromSpecies(
      { speciesId: specimenInfo.speciesId },
      { comparables, speciesId: specimenInfo.speciesId }
    );
    setPriceSuggestion(draft.priceSuggestion);
  }, [specimenInfo, allListingsForPricing]);

  // The parcel preset currently selected for the capacity preview, normalized
  // through the same engine the packing/cart math uses. Falls back to
  // PACKING_DEFAULTS (via normalizeParcelPreset's own null handling) when the
  // seller has no presets yet.
  const selectedPresetPreview = useMemo(() => {
    const raw = parcelPresets.find((p) => p.id === selectedPresetId);
    return normalizeParcelPreset(
      raw
        ? {
            label: raw.label,
            usable_weight_oz: raw.usableWeightOz,
            max_bags: raw.maxBags,
            usable_volume_in3: raw.usableVolumeIn3,
            thermal_pack_space_in3: raw.thermalPackSpaceIn3,
            max_livestock: raw.maxLivestock,
          }
        : {}
    );
  }, [parcelPresets, selectedPresetId]);

  const packingBoxesNeeded = useMemo(() => {
    if (!packingProfile) return 0;
    const usage = computeUsage([packingProfile]);
    return boxesRequired(selectedPresetPreview, usage);
  }, [packingProfile, selectedPresetPreview]);

  const handleDraftWithPoseidon = async () => {
    if (!groundingFacts) return;
    setAiDraftLoading(true);
    setAiDraftError(null);
    try {
      const result = await draftListingDescription(groundingFacts);
      if (result.description) {
        setAiDraftText(result.description);
      } else {
        setAiDraftError(result.error || "Couldn't generate a draft — write your own description.");
      }
    } finally {
      setAiDraftLoading(false);
    }
  };

  const applyAiDraft = () => {
    if (!aiDraftText) return;
    setDescription(aiDraftText);
    setAiDraftText(null);
  };


  const verifyToken = async (idToVerify) => {
    if (!idToVerify || isNaN(idToVerify)) {
      setError("Invalid specimen ID. Please enter a valid Certificate Serial No.");
      return;
    }

    setChecking(true);
    setError(null);
    setSpecimenInfo(null);

    try {
      const provider = getProvider();
      const contract = new Contract(contractAddress, aquadexAbi, provider);

      // Verify owner
      const owner = await contract.ownerOf(Number(idToVerify));
      if (owner.toLowerCase() !== walletAccount.toLowerCase()) {
        setError("You do not own this Certificate Serial No.");
        setChecking(false);
        return;
      }

      // Fetch Specimen Detail
      const data = await contract.specimens(Number(idToVerify));
      if (Number(data.specimenId) === 0) {
        setError("Certificate does not exist.");
        setChecking(false);
        return;
      }

      // Get Species Common Name
      const speciesInfo = await contract.speciesCatalog(Number(data.speciesId));

      setSpecimenInfo({
        id: Number(data.specimenId),
        speciesId: Number(data.speciesId),
        commonName: speciesInfo.commonName,
        scientificName: speciesInfo.scientificName,
        sireId: Number(data.sireId),
        damId: Number(data.damId),
      });

      // Check approval
      const approvedAddr = await contract.getApproved(Number(idToVerify));
      const approvedForMarket = approvedAddr.toLowerCase() === marketplaceAddress.toLowerCase();
      setIsApproved(approvedForMarket);

      if (approvedForMarket) {
        setStep(3); // Skip approval step
      } else {
        setStep(2); // Go to approval step
      }
    } catch (err) {
      // Beta fallback: check local-first specimens (Dexie) before failing
      try {
        const local = await db.specimens.get(Number(idToVerify));
        if (local && (local.ownerAddress || "").toLowerCase() === walletAccount.toLowerCase()) {
          setSpecimenInfo({
            id: local.id,
            speciesId: Number(local.speciesId),
            commonName: local.commonName,
            scientificName: local.scientificName,
            sireId: Number(local.sireId || 0),
            damId: Number(local.damId || 0),
          });
          setIsApproved(false);
          setStep(2);
          setChecking(false);
          return;
        }
      } catch (localErr) {
        console.warn("Local specimen lookup failed:", localErr);
      }
      console.error("Verification failed:", err);
      setError(err.reason || err.message || "Failed to verify birth certificate ownership.");
    } finally {
      setChecking(false);
    }
  };

  const verifyAndCheckApproval = async (e) => {
    if (e) e.preventDefault();
    if (!tokenId || isNaN(tokenId)) return;
    await verifyToken(Number(tokenId));
  };

  const handleApprove = async () => {
    setError(null);
    setSubmitting(true);
    setTxHash(null);

    try {
      // Beta: no on-chain ERC-721 approval needed for local-first listings.
      setIsApproved(true);
      setStep(3);
    } catch (err) {
      console.error("Approval failed:", err);
      setError(err.message || "Approval failed.");
    } finally {
      setSubmitting(false);
      setTxHash(null);
    }
  };

  const handleList = async () => {
    if (!price || isNaN(price) || Number(price) <= 0) {
      setError("Please specify a valid price greater than zero.");
      return;
    }

    setError(null);
    setSubmitting(true);
    setTxHash(null);

    try {
      // USD is the canonical price (this is a Web2-masked marketplace: buyers pay
      // dollars via Stripe). The seller enters dollars; store cents for Stripe.
      // Shipping itself is buyer-paid and quoted live at checkout (ShipEngine) —
      // sellers never set a flat shipping fee, so it's always 0 here.
      const priceCentsUSD = Math.round(parseFloat(price) * 100);
      const shippingFeeCents = 0;

      // Beta: store listing locally (no MetaMask, no gas)
      const result = await relayCreateListing({
        tokenId: Number(tokenId),
        priceCentsUSD,
        shippingFeeCents,
        priceUsd: parseFloat(price).toFixed(2),
        isShipping,
        seller: walletAccount,
        speciesId: specimenInfo?.speciesId || 0,
        commonName: specimenInfo?.commonName || "Specimen",
        scientificName: specimenInfo?.scientificName || "Unknown",
        sireId: specimenInfo?.sireId || 0,
        damId: specimenInfo?.damId || 0,
        // Enhanced listing details
        description: description.trim(),
        age: age ? `${age} ${ageUnit}` : "",
        size: size ? `${size} inches` : "",
        diet: diet.trim(),
        temperament: temperament.trim(),
        careLevel: Number(careLevel),
        minTemp: minTemp ? Number(minTemp) : 0,
        maxTemp: maxTemp ? Number(maxTemp) : 0,
        minPh: minPh ? Number(minPh) : 0,
        maxPh: maxPh ? Number(maxPh) : 0,
        tankSizeMin: tankSizeMin ? Number(tankSizeMin) : 0,
        healthStatus,
        doaGuarantee,
        photoDataUrl: photoPreview || "",
        // Packing profile (Task 9 Increment 2 / Task 11) — the seller-editable
        // default derived from species size/temperament. Additive: existing
        // callers of relayCreateListing that never pass this are unaffected.
        packingProfile: packingProfile || undefined,
      });

      if (!result.success) {
        throw new Error(result.error || "Listing failed");
      }

      // Trigger XP Telemetry & Toast
      awardXp("LIST_DIRECTORY");

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error("Listing failed:", err);
      setError(err.message || "Listing failed.");
    } finally {
      setSubmitting(false);
      setTxHash(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Publish Directory Entry"
      className="sliding-drawer-content"
      fullScreenMobile={true}
    >
        <button 
          onClick={onClose} 
          style={{
            position: "absolute",
            top: "1.5rem",
            right: "1.5rem",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: "1.75rem",
            cursor: "pointer",
            zIndex: 10
          }}
        >
          &times;
        </button>

        <h3 style={{ fontSize: "1.5rem", color: "#fff", marginTop: "1rem" }}>
          List Specimen for Sale
        </h3>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          List your verified specimen in the marketplace catalog. Other breeders will be able to discover and purchase it.
        </p>

        {error && (
          <div style={{
            padding: "0.75rem",
            backgroundColor: "rgba(248, 113, 113, 0.08)",
            border: "1px solid rgba(248, 113, 113, 0.2)",
            color: "var(--accent-red)",
            borderRadius: "4px",
            fontSize: "0.8rem"
          }}>
            {error}
          </div>
        )}

        {txHash && (
          <div style={{
            padding: "0.75rem",
            backgroundColor: "var(--accent-blue-glow)",
            border: "1px solid rgba(56, 189, 248, 0.2)",
            color: "var(--accent-blue)",
            borderRadius: "4px",
            fontSize: "0.8rem",
            wordBreak: "break-all"
          }}>
            <strong>Creating Listing:</strong> Syncing listing entry to directory catalog...
          </div>
        )}

        {step === 1 && (
          preselectedListSpecimen ? (
            <div style={{ textAlign: "center", padding: "2.5rem 1rem", display: "flex", flexDirection: "column", gap: "0.75rem", alignItems: "center" }}>
              <div style={{ width: "24px", height: "24px", border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "var(--accent-blue)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                Retrieving registry certificate details...
              </span>
            </div>
          ) : !manualEntry ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                Pick the fish you want to list
              </label>

              {loadingOwned && (
                <div style={{ textAlign: "center", padding: "1.5rem 0", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                  Loading your fish...
                </div>
              )}

              {!loadingOwned && ownedSpecimens.length === 0 && (
                <div style={{ padding: "1rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}>
                  No available fish found. If you know the certificate serial number, you can enter it manually below.
                </div>
              )}

              {!loadingOwned && ownedSpecimens.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "320px", overflowY: "auto", paddingRight: "0.25rem" }}>
                  {ownedSpecimens.map((spec) => {
                    const photoUrl = getSpecimenPhotoUrl(spec.commonName);
                    return (
                      <button
                        key={spec.id}
                        type="button"
                        onClick={() => handleSelectOwnedSpecimen(spec)}
                        disabled={checking}
                        style={{
                          display: "flex", alignItems: "center", gap: "0.75rem",
                          padding: "0.6rem 0.75rem", borderRadius: "8px", textAlign: "left",
                          background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)",
                          color: "#fff", cursor: checking ? "default" : "pointer"
                        }}
                      >
                        <img
                          src={photoUrl}
                          alt={spec.commonName}
                          style={{ width: "40px", height: "40px", borderRadius: "6px", objectFit: "cover", flexShrink: 0, background: "rgba(255,255,255,0.05)" }}
                          onError={(e) => {
                            e.target.src = "https://images.unsplash.com/photo-1522069169874-c58ec4b76be5?auto=format&fit=crop&w=80&h=80&q=80";
                          }}
                        />
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem", flex: 1, minWidth: 0 }}>
                          <strong style={{ fontSize: "0.85rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {spec.commonName || "Unnamed Specimen"}
                            {spec.breederStockTag ? ` "${spec.breederStockTag}"` : ""}
                          </strong>
                          <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
                            CERT #{String(spec.id).padStart(3, "0")}
                          </span>
                        </div>
                        {checking && tokenId === String(spec.id) && (
                          <div style={{ width: "16px", height: "16px", border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "var(--accent-blue)", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                onClick={() => setManualEntry(true)}
                style={{ background: "none", border: "none", color: "var(--accent-blue)", fontSize: "0.75rem", cursor: "pointer", padding: "0.35rem 0", alignSelf: "flex-start" }}
              >
                Enter certificate serial number manually →
              </button>
            </div>
          ) : (
            <form onSubmit={verifyAndCheckApproval} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
                  Certificate Serial No.
                </label>
                <input 
                  type="number"
                  value={tokenId}
                  onChange={(e) => setTokenId(e.target.value)}
                  placeholder="e.g. 001"
                  required
                  style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                />
              </div>
              <button 
                type="submit" 
                className="btn-primary-pro" 
                disabled={checking}
                style={{ justifyContent: "center" }}
              >
                {checking ? "Verifying Access..." : "Verify Ownership"}
              </button>
              {ownedSpecimens.length > 0 && (
                <button
                  type="button"
                  onClick={() => setManualEntry(false)}
                  style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "0.75rem", cursor: "pointer", padding: "0.1rem 0", alignSelf: "flex-start" }}
                >
                  ← Back to fish picker
                </button>
              )}
            </form>
          )
        )}


        {step > 1 && specimenInfo && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            
            {/* Step Progress Timeline */}
            <div className="listing-timeline">
              <div className="listing-timeline-line">
                <div 
                  className="listing-timeline-line-fill" 
                  style={{ width: step === 2 ? "0%" : step === 3 ? "50%" : "100%" }}
                />
              </div>
              <div className="listing-timeline-node completed">
                <div className="listing-timeline-circle">✓</div>
                <div className="listing-timeline-label">Verify</div>
              </div>
              <div className={`listing-timeline-node ${step === 2 ? "active" : "completed"}`}>
                <div className="listing-timeline-circle">{step > 2 ? "✓" : "2"}</div>
                <div className="listing-timeline-label">Confirm</div>
              </div>
              <div className={`listing-timeline-node ${step === 3 ? "active" : ""}`}>
                <div className="listing-timeline-circle">3</div>
                <div className="listing-timeline-label">List</div>
              </div>
            </div>


            {/* Digital Collector's Certificate Card */}
            {(() => {
              const sireId = Number(specimenInfo.sireId || 0);
              const damId = Number(specimenInfo.damId || 0);
              let pedigreeClass = "pedigree-wild";
              let pedigreeLabel = "Wild Caught";
              
              if (sireId === 0 && damId === 0) {
                pedigreeClass = "pedigree-wild";
                pedigreeLabel = "Wild Caught";
              } else if ((sireId !== 0 && damId === 0) || (sireId === 0 && damId !== 0)) {
                pedigreeClass = "pedigree-f1";
                pedigreeLabel = "Ancestral F1";
              } else {
                pedigreeClass = "pedigree-purebred";
                pedigreeLabel = "Purebred Pedigree";
              }

              const photoUrl = getSpecimenPhotoUrl(specimenInfo.commonName);

              return (
                <div className={`registry-cert-card ${pedigreeClass}`}>
                  <img 
                    src={photoUrl} 
                    alt={specimenInfo.commonName} 
                    className="registry-cert-img" 
                    onError={(e) => {
                      e.target.src = "https://images.unsplash.com/photo-1522069169874-c58ec4b76be5?auto=format&fit=crop&w=150&h=150&q=80";
                    }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>
                        Verified Birth Certificate
                      </span>

                      <span className={`badge ${pedigreeClass === "pedigree-wild" ? "badge-amber" : pedigreeClass === "pedigree-f1" ? "badge-blue" : "badge-green"}`} style={{ fontSize: "0.55rem" }}>
                        {pedigreeLabel}
                      </span>
                    </div>
                    <strong style={{ color: "#fff", fontSize: "0.95rem" }}>{specimenInfo.commonName}</strong>
                    <span style={{ fontSize: "0.7rem", fontStyle: "italic", color: "var(--text-secondary)" }}>
                      {specimenInfo.scientificName}
                    </span>
                    <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.25rem", alignItems: "center" }}>
                      <span style={{ fontSize: "0.55rem", padding: "0.1rem 0.35rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", borderRadius: "4px", color: "var(--text-muted)", fontFamily: "monospace" }}>
                        CERT #{specimenInfo.id.toString().padStart(3, "0")}
                      </span>
                      {sireId > 0 && (
                        <span style={{ fontSize: "0.55rem", padding: "0.1rem 0.35rem", background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.15)", borderRadius: "4px", color: "var(--accent-blue)" }}>
                          Sire: #{sireId}
                        </span>
                      )}
                      {damId > 0 && (
                        <span style={{ fontSize: "0.55rem", padding: "0.1rem 0.35rem", background: "rgba(244,63,94,0.06)", border: "1px solid rgba(244,63,94,0.15)", borderRadius: "4px", color: "#fda4af" }}>
                          Dam: #{damId}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Step 2 Render */}
            {step === 2 && (
              <div>
                <p style={{ fontSize: "0.825rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
                  <strong>Step 2 of 3: Confirm Listing Rights</strong><br />
                  Confirm your permission to list this specimen certificate in the public directory catalog.
                </p>
                <button 
                  onClick={handleApprove} 
                  className="btn-primary-pro" 
                  disabled={submitting}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  {submitting ? "Confirming..." : "Confirm Listing Rights"}
                </button>

              </div>
            )}

            {/* Step 3 Render */}
            {step === 3 && (() => {
              const sireId = Number(specimenInfo.sireId || 0);
              const damId = Number(specimenInfo.damId || 0);
              let globalAvg = "$50.00";
              let lineageVal = "$48.00";

              if (sireId === 0 && damId === 0) {
                globalAvg = "$35.00";
                lineageVal = "$32.00";
              } else if ((sireId !== 0 && damId === 0) || (sireId === 0 && damId !== 0)) {
                globalAvg = "$50.00";
                lineageVal = "$48.00";
              } else {
                globalAvg = "$75.00";
                lineageVal = "$72.00";
              }

              const parseVal = parseFloat(price) || 0;
              const feeVal = parseVal * 0.04;
              const payoutVal = Math.max(0, parseVal - feeVal);

              const maxScale = parseFloat(globalAvg.replace("$", "")) * 2;
              const markerPercent = Math.min(100, Math.max(0, (parseVal / maxScale) * 100));

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  {/* Delivery Method selector */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
                      Delivery Method
                    </label>
                    <div className="delivery-tile-group">
                      <div 
                        className={`delivery-tile ${!isShipping ? "active" : ""}`}
                        onClick={() => setIsShipping(false)}
                      >
                        <span className="delivery-tile-icon">📍</span>
                        <span className="delivery-tile-label">Local Pickup Only</span>
                      </div>
                      <div 
                        className={`delivery-tile ${isShipping ? "active" : ""}`}
                        onClick={() => setIsShipping(true)}
                      >
                        <span className="delivery-tile-icon">🚚</span>
                        <span className="delivery-tile-label">Shipping Available</span>
                        <span style={{ fontSize: "0.55rem", color: "#34d399", fontWeight: 600 }}>Recommended · reaches the most buyers</span>
                      </div>
                    </div>
                    <p style={{ fontSize: "0.65rem", color: "var(--text-muted)", margin: "0.4rem 0 0" }}>
                      Tip: local pickup is fee-free during live events.
                    </p>
                  </div>

                  {/* Price fields */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                      Price per fish ($)
                    </label>
                    <input 
                      type="number"
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="e.g. 50.00"
                      required
                      style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", outline: "none" }}
                    />
                    {/* Price suggestion — a hint from comparable active listings,
                        never a promise (buildPriceSuggestion, §2.1). Hidden below
                        the sample floor rather than showing a misleading number. */}
                    {priceSuggestion && (
                      <button
                        type="button"
                        onClick={() => setPrice((parseFloat(priceSuggestion.suggestedCents) / 100).toFixed(2))}
                        style={{
                          marginTop: "0.4rem", display: "block", background: "rgba(56,189,248,0.06)",
                          border: "1px solid rgba(56,189,248,0.2)", borderRadius: "6px", padding: "0.4rem 0.6rem",
                          color: "var(--text-secondary)", fontSize: "0.68rem", cursor: "pointer", textAlign: "left", width: "100%",
                        }}
                      >
                        💡 Similar listings suggest ~${(priceSuggestion.suggestedCents / 100).toFixed(2)}{" "}
                        (${(priceSuggestion.low / 100).toFixed(2)}–${(priceSuggestion.high / 100).toFixed(2)}).{" "}
                        <span style={{ textDecoration: "underline", color: "var(--accent-blue)" }}>Use this price</span>
                        <div style={{ color: "var(--text-muted)", marginTop: "0.15rem" }}>{priceSuggestion.basis}</div>
                      </button>
                    )}
                  </div>

                  {/* Shipping is buyer-paid at checkout via live ShipEngine rates —
                      sellers don't set a flat fee. Just a heads-up here. */}
                  {isShipping && (
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.65rem 0.75rem", background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.15)", borderRadius: "6px" }}>
                      <span style={{ fontSize: "0.9rem" }}>🚚</span>
                      <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                        Shipping is quoted live at checkout based on the buyer's address — you don't set a fee. Add your ship-from address in Settings so buyers can get accurate rates.
                      </span>
                    </div>
                  )}

                  {/* --- Enhanced Listing Details Section --- */}
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "1rem", marginTop: "0.5rem" }}>
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", letterSpacing: "0.04em" }}>
                      Specimen Details (helps buyers decide)
                    </span>
                    {carePrefilled && (
                      <div style={{ fontSize: "0.65rem", color: "#34d399", marginTop: "0.35rem" }}>
                        ✨ Auto-filled from Spec-Dex care data for {specimenInfo.commonName} — edit anything.
                      </div>
                    )}
                  </div>

                  {/* Buyer-parity compatibility preview — "here's what buyers
                      will see" (§2.2). Read-only mirror of the exact engine
                      buyers get; reuses its icon+text verdict language so it's
                      never color-only. */}
                  {compatibilityPreview && (
                    <div
                      style={{
                        padding: "0.65rem 0.75rem", borderRadius: "8px",
                        background: compatibilityPreview.verdict === "ok" ? "rgba(52,211,153,0.06)" : "rgba(251,191,36,0.06)",
                        border: `1px solid ${compatibilityPreview.verdict === "ok" ? "rgba(52,211,153,0.25)" : "rgba(251,191,36,0.25)"}`,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.25rem" }}>
                        <span aria-hidden="true">{compatibilityPreview.verdict === "ok" ? "✅" : "🔎"}</span>
                        <strong style={{ fontSize: "0.75rem", color: "#fff" }}>
                          Buyer view: {compatibilityPreview.headline}
                        </strong>
                      </div>
                      <p style={{ margin: 0, fontSize: "0.68rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                        {compatibilityPreview.reasons[0]}
                      </p>
                    </div>
                  )}

                  {/* Photo Upload */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                      Specimen Photo
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      {photoPreview ? (
                        <div style={{ position: "relative" }}>
                          <img
                            src={photoPreview}
                            alt="Specimen preview"
                            style={{ width: "64px", height: "64px", borderRadius: "8px", objectFit: "cover", border: "1px solid var(--glass-border)" }}
                          />
                          <button
                            type="button"
                            onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                            style={{ position: "absolute", top: "-6px", right: "-6px", width: "18px", height: "18px", borderRadius: "50%", background: "rgba(248,113,113,0.9)", border: "none", color: "#fff", fontSize: "0.6rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <label style={{
                          width: "64px", height: "64px", borderRadius: "8px",
                          border: "2px dashed var(--glass-border)", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexDirection: "column", gap: "0.15rem",
                          background: "rgba(255,255,255,0.02)", transition: "border-color 0.2s"
                        }}>
                          <span style={{ fontSize: "1.2rem" }}>📷</span>
                          <span style={{ fontSize: "0.55rem", color: "var(--text-muted)" }}>Add</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handlePhotoSelect}
                            style={{ display: "none" }}
                          />
                        </label>
                      )}
                      <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", maxWidth: "180px" }}>
                        Upload a clear photo of this specific fish. Max 5MB.
                      </span>
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                      <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                        Description / Seller Notes
                      </label>
                      {groundingFacts && (
                        <button
                          type="button"
                          onClick={handleDraftWithPoseidon}
                          disabled={aiDraftLoading}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: "0.35rem",
                            padding: "0.3rem 0.65rem", borderRadius: "16px", border: "none", cursor: "pointer",
                            background: "linear-gradient(135deg, #a78bfa, #22d3ee)",
                            boxShadow: "0 0 12px rgba(167,139,250,0.35)",
                            color: "#0b0f1a", fontSize: "0.68rem", fontWeight: 700,
                            minHeight: "32px", opacity: aiDraftLoading ? 0.7 : 1,
                          }}
                        >
                          ✨ {aiDraftLoading ? "Drafting…" : "Draft with Poseidon"}
                        </button>
                      )}
                    </div>

                    {/* AI draft — clearly distinct (violet left-border) and
                        explicitly labeled per §2.3/§3; editable, never
                        auto-applied. Announced to screen readers so its
                        provisional status isn't conveyed by color alone. */}
                    {aiDraftText && (
                      <div
                        role="note"
                        aria-label="AI draft, review before publishing"
                        style={{
                          marginBottom: "0.5rem", padding: "0.6rem 0.75rem",
                          borderLeft: "3px solid #a78bfa", background: "rgba(167,139,250,0.06)",
                          borderRadius: "0 6px 6px 0", fontSize: "0.75rem", color: "var(--text-secondary)",
                        }}
                      >
                        <div style={{ fontSize: "0.62rem", fontWeight: 700, color: "#c4b5fd", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                          AI draft — review before publishing
                        </div>
                        <p style={{ margin: "0 0 0.5rem", lineHeight: 1.5 }}>{aiDraftText}</p>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button type="button" onClick={applyAiDraft} style={{ background: "none", border: "none", color: "#a78bfa", fontSize: "0.68rem", fontWeight: 600, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                            Use this draft
                          </button>
                          <button type="button" onClick={() => setAiDraftText(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "0.68rem", cursor: "pointer", padding: 0 }}>
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                    {aiDraftError && (
                      <div style={{ marginBottom: "0.5rem", fontSize: "0.68rem", color: "var(--text-muted)" }}>
                        {aiDraftError}
                      </div>
                    )}

                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="e.g. Beautiful coloration, eats pellets eagerly, peaceful in community tank..."
                      rows={3}
                      maxLength={500}
                      style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none", resize: "vertical", fontSize: "0.8rem", fontFamily: "inherit" }}
                    />
                    <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", float: "right" }}>{description.length}/500</span>
                  </div>

                  {/* Age & Size Row */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                        Age
                      </label>
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        <input
                          type="number"
                          min="0"
                          value={age}
                          onChange={(e) => setAge(e.target.value)}
                          placeholder="e.g. 6"
                          style={{ flex: 1, padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
                        />
                        <select
                          value={ageUnit}
                          onChange={(e) => setAgeUnit(e.target.value)}
                          style={{ padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none", fontSize: "0.75rem" }}
                        >
                          <option value="weeks">wks</option>
                          <option value="months">mo</option>
                          <option value="years">yr</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                        Size (inches)
                      </label>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        value={size}
                        onChange={(e) => setSize(e.target.value)}
                        placeholder="e.g. 3.5"
                        style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
                      />
                    </div>
                  </div>

                  {/* Diet & Temperament Row */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                        Diet
                        {careConfidence && <ConfidencePill known={careConfidence.diet} />}
                      </label>
                      <input
                        type="text"
                        value={diet}
                        onChange={(e) => setDiet(e.target.value)}
                        placeholder="e.g. Pellets, frozen brine"
                        style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                        Temperament
                        {careConfidence && <ConfidencePill known={careConfidence.temperament} />}
                      </label>
                      <select
                        value={temperament}
                        onChange={(e) => setTemperament(e.target.value)}
                        style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
                      >
                        <option value="">Select...</option>
                        <option value="Peaceful">Peaceful</option>
                        <option value="Semi-Aggressive">Semi-Aggressive</option>
                        <option value="Aggressive">Aggressive</option>
                        <option value="Schooling">Schooling</option>
                        <option value="Territorial">Territorial</option>
                      </select>
                    </div>
                  </div>

                  {/* Care Level */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                      Care Level
                    </label>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {[
                        { val: 0, label: "Beginner", icon: "✨", color: "rgba(34,211,238,0.15)", border: "rgba(34,211,238,0.4)" },
                        { val: 1, label: "Intermediate", icon: "⚡", color: "rgba(251,191,36,0.15)", border: "rgba(251,191,36,0.4)" },
                        { val: 2, label: "Advanced", icon: "🔥", color: "rgba(248,113,113,0.15)", border: "rgba(248,113,113,0.4)" },
                      ].map(({ val, label, icon, color, border }) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setCareLevel(val)}
                          style={{
                            flex: 1, padding: "0.5rem 0.25rem", borderRadius: "6px", cursor: "pointer",
                            background: careLevel === val ? color : "rgba(255,255,255,0.02)",
                            border: `1px solid ${careLevel === val ? border : "var(--glass-border)"}`,
                            color: careLevel === val ? "#fff" : "var(--text-muted)",
                            fontSize: "0.7rem", fontWeight: careLevel === val ? "600" : "400",
                            transition: "all 0.15s ease", textAlign: "center"
                          }}
                        >
                          {icon} {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Water Parameters Row */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                      Water Parameters (recommended range)
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
                      <div>
                        <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>
                          Temp (°F){careConfidence && <ConfidencePill known={careConfidence.tempRangeCelsius} />}
                        </span>
                        <div style={{ display: "flex", gap: "0.2rem", alignItems: "center" }}>
                          <input type="number" value={minTemp} onChange={(e) => setMinTemp(e.target.value)} placeholder="72" style={{ width: "100%", padding: "0.45rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", outline: "none", fontSize: "0.75rem" }} />
                          <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>-</span>
                          <input type="number" value={maxTemp} onChange={(e) => setMaxTemp(e.target.value)} placeholder="82" style={{ width: "100%", padding: "0.45rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", outline: "none", fontSize: "0.75rem" }} />
                        </div>
                      </div>
                      <div>
                        <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>
                          pH{careConfidence && <ConfidencePill known={careConfidence.phRange} />}
                        </span>
                        <div style={{ display: "flex", gap: "0.2rem", alignItems: "center" }}>
                          <input type="number" step="0.1" value={minPh} onChange={(e) => setMinPh(e.target.value)} placeholder="6.5" style={{ width: "100%", padding: "0.45rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", outline: "none", fontSize: "0.75rem" }} />
                          <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>-</span>
                          <input type="number" step="0.1" value={maxPh} onChange={(e) => setMaxPh(e.target.value)} placeholder="7.5" style={{ width: "100%", padding: "0.45rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", outline: "none", fontSize: "0.75rem" }} />
                        </div>
                      </div>
                      <div>
                        <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>
                          Min Tank (gal){careConfidence && <ConfidencePill known={careConfidence.minVolumeGallons} />}
                        </span>
                        <input type="number" value={tankSizeMin} onChange={(e) => setTankSizeMin(e.target.value)} placeholder="20" style={{ width: "100%", padding: "0.45rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", outline: "none", fontSize: "0.75rem" }} />
                      </div>
                    </div>
                  </div>

                  {/* Packing profile + parcel-preset capacity preview (§2.1/§2.4).
                      The derived default from deriveDefaultPackingProfile,
                      previewed against the seller's own parcel preset so they
                      see how their fish packs before they ship it. */}
                  {packingProfile && (
                    <div style={{ padding: "0.65rem 0.75rem", borderRadius: "8px", background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.2)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem", flexWrap: "wrap", gap: "0.4rem" }}>
                        <strong style={{ fontSize: "0.72rem", color: "#fff" }}>📦 Packing profile</strong>
                        {parcelPresets.length > 0 && (
                          <select
                            value={selectedPresetId ?? ""}
                            onChange={(e) => setSelectedPresetId(Number(e.target.value))}
                            style={{ fontSize: "0.68rem", padding: "0.25rem 0.4rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px" }}
                          >
                            {parcelPresets.map((p) => (
                              <option key={p.id} value={p.id}>{p.label}</option>
                            ))}
                          </select>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: "0.68rem", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                        ~{packingProfile.bagCount} bag{packingProfile.bagCount === 1 ? "" : "s"} · {packingProfile.packedWeightOz}oz ·{" "}
                        {packingProfile.volumeIn3}in³{packingProfile.requiresThermalPack ? " · thermal pack" : ""}
                        {packingProfile.separationRequired ? " · ships alone" : ""}
                      </p>
                      <p style={{ margin: "0.3rem 0 0", fontSize: "0.65rem", color: parcelPresets.length === 0 ? "var(--text-muted)" : (packingBoxesNeeded > 1 ? "#fbbf24" : "#34d399") }}>
                        {parcelPresets.length === 0
                          ? "Using a default box estimate — add a parcel preset in Shipping settings for an exact fit."
                          : packingBoxesNeeded > 1
                            ? `This fish alone would need ${packingBoxesNeeded} of this box size.`
                            : "Fits comfortably in one of this box size."}
                      </p>
                    </div>
                  )}

                  {/* Health & Guarantee Row */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                        Health Status
                      </label>
                      <select
                        value={healthStatus}
                        onChange={(e) => setHealthStatus(e.target.value)}
                        style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
                      >
                        <option value="healthy">Healthy — No Issues</option>
                        <option value="treated">Recently Treated</option>
                        <option value="quarantine">In Quarantine</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                        DOA Guarantee
                      </label>
                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.2rem" }}>
                        <button
                          type="button"
                          onClick={() => setDoaGuarantee(true)}
                          style={{
                            flex: 1, padding: "0.5rem", borderRadius: "6px", cursor: "pointer",
                            background: doaGuarantee ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.02)",
                            border: `1px solid ${doaGuarantee ? "rgba(34,197,94,0.4)" : "var(--glass-border)"}`,
                            color: doaGuarantee ? "#34d399" : "var(--text-muted)",
                            fontSize: "0.7rem", fontWeight: doaGuarantee ? "600" : "400"
                          }}
                        >
                          ✓ Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setDoaGuarantee(false)}
                          style={{
                            flex: 1, padding: "0.5rem", borderRadius: "6px", cursor: "pointer",
                            background: !doaGuarantee ? "rgba(248,113,113,0.12)" : "rgba(255,255,255,0.02)",
                            border: `1px solid ${!doaGuarantee ? "rgba(248,113,113,0.4)" : "var(--glass-border)"}`,
                            color: !doaGuarantee ? "#f87171" : "var(--text-muted)",
                            fontSize: "0.7rem", fontWeight: !doaGuarantee ? "600" : "400"
                          }}
                        >
                          ✕ No
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Dynamic Pricing Calculator Ledger */}
                  {parseVal > 0 && (
                    <div className="receipt-ledger">
                      <div className="receipt-row">
                        <span>List Price:</span>
                        <span className="receipt-val-usd">
                          ${parseVal.toFixed(2)} USD
                        </span>
                      </div>
                      <div className="receipt-row">
                        <span>Marketplace Fee (4%):</span>
                        <span className="receipt-val-usd" style={{ color: "var(--accent-red)" }}>
                          -${feeVal.toFixed(2)} USD
                        </span>
                      </div>
                      <div className="receipt-row total">
                        <span>Est. Net Payout:</span>
                        <span className="receipt-val-usd">
                          ${payoutVal.toFixed(2)} USD
                        </span>
                      </div>
                    </div>
                  )}


                  {/* Market Intelligence Block */}
                  {(() => {
                    let pedigreeClass = "pedigree-wild";
                    let pedigreeLabel = "Wild Caught";
                    let pedigreeGlowClass = "";
                    let pedigreeBadgeClass = "badge-amber";

                    if (sireId === 0 && damId === 0) {
                      pedigreeClass = "pedigree-wild";
                      pedigreeLabel = "Wild Caught";
                      pedigreeBadgeClass = "badge-amber";
                    } else if ((sireId !== 0 && damId === 0) || (sireId === 0 && damId !== 0)) {
                      pedigreeClass = "pedigree-f1";
                      pedigreeLabel = "Ancestral F1";
                      pedigreeBadgeClass = "badge-blue";
                    } else {
                      pedigreeClass = "pedigree-purebred";
                      pedigreeLabel = "Purebred Pedigree";
                      pedigreeGlowClass = "pedigree-purebred-glow";
                      pedigreeBadgeClass = "badge-green";
                    }

                    return (
                      <div 
                        className={`glass-card ${pedigreeClass}`} 
                        style={{ 
                          padding: "1rem", 
                          display: "flex", 
                          flexDirection: "column", 
                          gap: "0.5rem", 
                          background: "rgba(255,255,255,0.015)"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", fontWeight: "600", textTransform: "uppercase" }}>
                            📊 Market Intelligence
                          </span>
                          <span className={`badge ${pedigreeBadgeClass} ${pedigreeGlowClass}`} style={{ fontSize: "0.6rem" }}>
                            {pedigreeLabel}
                          </span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.75rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-muted)" }}>Global Platform Avg:</span>
                            <strong style={{ color: "#fff", fontFamily: "monospace" }}>{globalAvg}</strong>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-muted)" }}>Lineage Valuation Track:</span>
                            <strong style={{ color: "var(--accent-blue)", fontFamily: "monospace" }}>{lineageVal}</strong>
                          </div>
                        </div>

                        {/* Visual valuation slider */}
                        <div style={{ marginTop: "0.25rem" }}>
                          <div className="price-valuation-bar">
                            <div className="price-valuation-fill" style={{ width: `${markerPercent}%` }} />
                            {parseVal > 0 && (
                              <div className="price-valuation-marker" style={{ left: `${markerPercent}%` }} />
                            )}
                          </div>
                          <div className="price-valuation-labels">
                            <span>$0</span>
                            <span>Avg: {globalAvg}</span>
                            <span>Premium: ${maxScale.toFixed(0)}</span>
                          </div>
                          {parseVal > 0 && (
                            <span style={{ 
                              fontSize: "0.6rem", 
                              color: parseVal < parseFloat(lineageVal.replace("$","")) ? "var(--accent-green)" : parseVal > parseFloat(globalAvg.replace("$","")) ? "#c084fc" : "var(--accent-blue)",
                              display: "block",
                              marginTop: "0.3rem",
                              fontWeight: "600",
                              textAlign: "center"
                            }}>
                              {parseVal < parseFloat(lineageVal.replace("$","")) ? "🔥 Undervalued / Deal Price" : parseVal > parseFloat(globalAvg.replace("$","")) ? "📈 Premium Breed Pricing" : "⚖️ Solid Market Average"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Payout readiness nudge — sellers must connect Stripe to be paid */}
                  {sellerPayoutReady === false && (
                    <div style={{ padding: "0.85rem 1rem", borderRadius: "8px", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.3)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <span style={{ fontSize: "1.1rem" }}>💳</span>
                        <strong style={{ color: "#fbbf24", fontSize: "0.82rem" }}>Connect payouts to get paid</strong>
                      </div>
                      <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                        You can list now, but buyers can't complete checkout until your payout account is set up. It only takes a couple of minutes.
                      </p>
                      <button
                        type="button"
                        onClick={handleStartPayoutOnboarding}
                        disabled={onboardingPayout}
                        className="btn-secondary"
                        style={{ alignSelf: "flex-start", fontSize: "0.72rem", padding: "0.4rem 0.9rem", borderColor: "rgba(251,191,36,0.4)", color: "#fbbf24" }}
                      >
                        {onboardingPayout ? "Opening setup…" : "Set up payouts →"}
                      </button>
                    </div>
                  )}
                  {sellerPayoutReady === true && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.7rem", color: "#34d399" }}>
                      <span>✅</span> Payouts connected — you're all set to get paid.
                    </div>
                  )}

                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                    <button 
                      type="button"
                      onClick={() => setStep(1)} 
                      className="btn-secondary" 
                      disabled={submitting}
                      style={{ flex: 1 }}
                    >
                      Back
                    </button>
                    <button 
                      type="button"
                      onClick={handleList} 
                      className="btn-primary-pro" 
                      disabled={submitting}
                      style={{ flex: 2, justifyContent: "center" }}
                    >
                      {submitting ? "Listing..." : "Create Listing"}

                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
    </Modal>
  );
}
