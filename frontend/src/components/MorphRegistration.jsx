import React, { useState, useEffect, useCallback, useRef } from "react";
import { Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { getProvider } from "../utils/smartAccount";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { isSupabaseConfigured } from "../services/supabaseClient";
import {
  createMorphSubmission,
  getMyMorphSubmissions,
  getAllMorphSubmissions,
  reviewMorphSubmission,
} from "../services/morphSubmissionsApi";

/**
 * MorphRegistration — Breeder Tools sub-section for submitting a new color
 * morph / fin type / pattern for curator verification.
 *
 * Submissions persist to Supabase (table: morph_submissions). Anyone can read
 * the queue; inserts are client-side; status flips (pending → verified/rejected)
 * go through the service-role route /api/update-morph-status, which verifies the
 * caller is the on-chain curator. The review panel below is only shown to the
 * curator (detected via contract.curator()).
 */

const TRAIT_TYPES = [
  { value: "color", label: "Color Morph" },
  { value: "fin", label: "Fin Type" },
  { value: "pattern", label: "Pattern" },
  { value: "scale", label: "Scale Type" },
  { value: "other", label: "Other" },
];

const STATUS_BADGES = {
  pending: { label: "Pending review", color: "var(--accent-amber, #fbbf24)", bg: "rgba(251,191,36,0.12)", border: "rgba(251,191,36,0.3)" },
  verified: { label: "Verified", color: "var(--accent-green, #34d399)", bg: "rgba(52,211,153,0.12)", border: "rgba(52,211,153,0.3)" },
  rejected: { label: "Not accepted", color: "var(--accent-red, #f87171)", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.3)" },
};

const traitLabel = (value) => TRAIT_TYPES.find((t) => t.value === value)?.label || "Other";
const normalize = (s) => (s ? s.toLowerCase().replace(/[^a-z0-9]/g, "").trim() : "");

export function MorphRegistration({ walletAccount, casualModeActive, contractAddress }) {
  const [form, setForm] = useState({
    baseSpecies: "",
    morphName: "",
    traitType: "color",
    description: "",
    proofUrl: "",
  });
  const [proofPhoto, setProofPhoto] = useState(null); // { file, preview }
  const proofInputRef = useRef(null);
  const [submissions, setSubmissions] = useState([]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);

  // Curator review state
  const [isCurator, setIsCurator] = useState(false);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [reviewBusyId, setReviewBusyId] = useState(null);
  const [reviewError, setReviewError] = useState(null);

  const configured = isSupabaseConfigured();
  const submitter = (walletAccount || "").toLowerCase();

  const loadMine = useCallback(async () => {
    if (!configured || !submitter) {
      setSubmissions([]);
      return;
    }
    const { data, error: err } = await getMyMorphSubmissions(submitter);
    if (err) {
      console.warn("[Morph] Failed to load submissions:", err);
      setSubmissions([]);
    } else {
      setSubmissions(data);
    }
  }, [configured, submitter]);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  // Detect on-chain curator role (same pattern as BreedGallery / CheckoutSummary).
  useEffect(() => {
    let active = true;
    (async () => {
      if (!contractAddress || !walletAccount) {
        if (active) setIsCurator(false);
        return;
      }
      try {
        const provider = getProvider();
        const contract = new Contract(contractAddress, aquadexAbi, provider);
        const curatorAddr = await contract.curator();
        if (active) setIsCurator(String(curatorAddr).toLowerCase() === walletAccount.toLowerCase());
      } catch (e) {
        if (active) setIsCurator(false);
      }
    })();
    return () => { active = false; };
  }, [contractAddress, walletAccount]);

  const loadReviewQueue = useCallback(async () => {
    if (!configured || !isCurator) return;
    const { data, error: err } = await getAllMorphSubmissions();
    if (err) {
      console.warn("[Morph] Failed to load review queue:", err);
      setReviewQueue([]);
    } else {
      setReviewQueue(data);
    }
  }, [configured, isCurator]);

  useEffect(() => {
    loadReviewQueue();
  }, [loadReviewQueue]);

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!configured) {
      setError("Submissions aren't available right now (backend not configured).");
      return;
    }
    if (!walletAccount) {
      setError("Connect your wallet to submit a morph.");
      return;
    }
    const baseSpecies = form.baseSpecies.trim();
    const morphName = form.morphName.trim();
    if (!baseSpecies) {
      setError("Tell us which species this morph comes from.");
      return;
    }
    if (!morphName) {
      setError("Give your morph a name.");
      return;
    }

    // Rate limit: 5 submissions per wallet per 24h (based on loaded list).
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = submissions.filter((m) => new Date(m.created_at).getTime() > dayAgo);
    if (recent.length >= 5) {
      setError("You've reached the limit of 5 morph submissions per day. Try again tomorrow.");
      return;
    }

    // Duplicate detection against this submitter's existing entries.
    const dup = submissions.find(
      (m) => normalize(m.morph_name) === normalize(morphName) && normalize(m.base_species) === normalize(baseSpecies)
    );
    if (dup) {
      setError(`"${morphName}" has already been submitted for ${baseSpecies}.`);
      return;
    }

    setSubmitting(true);
    try {
      // Handle photo upload: compress and convert to data URL for proof
      let finalProofUrl = form.proofUrl;
      if (proofPhoto?.file) {
        try {
          const { compressImage } = await import("../utils/imageCompression");
          finalProofUrl = await compressImage(proofPhoto.file, { maxWidth: 1200, quality: 0.8 });
        } catch (compressErr) {
          // Fallback: read as data URL without compression
          finalProofUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(proofPhoto.file);
          });
        }
      }

      const { error: err } = await createMorphSubmission({
        baseSpecies,
        morphName,
        traitType: form.traitType,
        description: form.description,
        proofUrl: finalProofUrl,
      });
      if (err) throw new Error(err.message || err);

      addXp(XP_ACTIONS.MORPH_REGISTERED.points, XP_ACTIONS.MORPH_REGISTERED.label);

      setSuccessMsg(
        casualModeActive
          ? `"${morphName}" submitted! A curator will take a look soon.`
          : `"${morphName}" queued for curator verification.`
      );
      setForm({ baseSpecies: "", morphName: "", traitType: "color", description: "", proofUrl: "" });
      setProofPhoto(null);
      if (proofInputRef.current) proofInputRef.current.value = "";
      await loadMine();
      if (isCurator) await loadReviewQueue();
    } catch (err) {
      setError(err.message || "Failed to submit morph.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReview = async (id, status) => {
    setReviewError(null);
    setReviewBusyId(id);
    try {
      const { error: err } = await reviewMorphSubmission({ id, status, callerWallet: walletAccount });
      if (err) throw new Error(err.message || err);
      await loadReviewQueue();
      await loadMine();
    } catch (err) {
      setReviewError(err.message || "Failed to update status.");
    } finally {
      setReviewBusyId(null);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "0.6rem 0.7rem",
    background: "rgba(255,255,255,0.03)",
    border: casualModeActive ? "1px solid var(--glass-border)" : "1px solid rgba(168, 85, 247, 0.3)",
    color: "#fff",
    borderRadius: "6px",
    outline: "none",
    fontSize: "0.85rem",
  };
  const labelStyle = { fontSize: "0.72rem", fontWeight: 600, color: "var(--text-muted, #94a3b8)", display: "block", marginBottom: "0.3rem" };

  const renderSubmissionRow = (m, { showSubmitter = false, actions = false } = {}) => {
    const badge = STATUS_BADGES[m.status] || STATUS_BADGES.pending;
    return (
      <div
        key={m.id}
        style={{
          padding: "0.7rem 0.85rem",
          borderRadius: "10px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--glass-border)",
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: "180px" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#fff" }}>
            {m.morph_name}
            <span style={{ fontSize: "0.68rem", color: "var(--text-muted, #94a3b8)", fontWeight: 400, marginLeft: "0.4rem" }}>
              {traitLabel(m.trait_type)}
            </span>
          </div>
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted, #94a3b8)", marginTop: "0.1rem" }}>
            {m.base_species} · {new Date(m.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            {showSubmitter && m.submitter_wallet && (
              <span> · {m.submitter_wallet.slice(0, 6)}…{m.submitter_wallet.slice(-4)}</span>
            )}
          </div>
          {m.description && (
            <div style={{ fontSize: "0.72rem", color: "var(--text-secondary, #cbd5e1)", marginTop: "0.25rem" }}>
              {m.description}
            </div>
          )}
          {m.proof_url && (
            <a
              href={m.proof_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: "0.7rem", color: "var(--accent-cyan, #22d3ee)", textDecoration: "none" }}
            >
              View reference ↗
            </a>
          )}
        </div>

        {actions && m.status === "pending" ? (
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button
              type="button"
              onClick={() => handleReview(m.id, "verified")}
              disabled={reviewBusyId === m.id}
              style={{
                fontSize: "0.7rem", padding: "0.3rem 0.6rem", borderRadius: "8px", cursor: "pointer",
                background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.4)", color: "var(--accent-green, #34d399)",
                opacity: reviewBusyId === m.id ? 0.6 : 1,
              }}
            >
              {reviewBusyId === m.id ? "…" : "✓ Verify"}
            </button>
            <button
              type="button"
              onClick={() => handleReview(m.id, "rejected")}
              disabled={reviewBusyId === m.id}
              style={{
                fontSize: "0.7rem", padding: "0.3rem 0.6rem", borderRadius: "8px", cursor: "pointer",
                background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.4)", color: "var(--accent-red, #f87171)",
                opacity: reviewBusyId === m.id ? 0.6 : 1,
              }}
            >
              ✕ Reject
            </button>
          </div>
        ) : (
          <span
            style={{
              fontSize: "0.65rem", fontWeight: 600, padding: "0.15rem 0.5rem", borderRadius: "10px",
              color: badge.color, background: badge.bg, border: `1px solid ${badge.border}`, whiteSpace: "nowrap",
            }}
          >
            {badge.label}
          </span>
        )}
      </div>
    );
  };

  const pendingCount = reviewQueue.filter((m) => m.status === "pending").length;

  return (
    <div style={{ maxWidth: "640px" }}>
      <div style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#fff", margin: "0 0 0.25rem" }}>
          🎨 {casualModeActive ? "Register a New Look" : "Morph Registration"}
        </h2>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted, #94a3b8)", margin: 0, lineHeight: 1.5 }}>
          {casualModeActive
            ? "Bred something that looks different — a new color or fin shape? Submit it here and a curator will review it."
            : "Submit a new color morph, fin type, or pattern for curator verification. Verified morphs can be referenced in lineage and listings."}
        </p>
      </div>

      {!configured && (
        <div style={{ padding: "0.75rem 1rem", borderRadius: "10px", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.25)", color: "var(--accent-amber, #fbbf24)", fontSize: "0.8rem", marginBottom: "1rem" }}>
          The morph registry backend isn't configured in this environment. Submissions are disabled.
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="glass-card"
        style={{
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          border: !casualModeActive ? "1px solid rgba(168, 85, 247, 0.22)" : "1px solid var(--glass-border)",
          marginBottom: "1.5rem",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div>
            <label style={labelStyle}>Base species *</label>
            <input
              type="text"
              value={form.baseSpecies}
              onChange={(e) => update("baseSpecies", e.target.value)}
              placeholder="e.g. Betta splendens"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Morph name *</label>
            <input
              type="text"
              value={form.morphName}
              onChange={(e) => update("morphName", e.target.value)}
              placeholder="e.g. Galaxy Koi"
              style={inputStyle}
            />
          </div>
        </div>

        <div>
          <label style={labelStyle}>Trait type</label>
          <select
            value={form.traitType}
            onChange={(e) => update("traitType", e.target.value)}
            style={{ ...inputStyle, background: "rgba(15, 23, 42, 0.95)" }}
          >
            {TRAIT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Description</label>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder={casualModeActive
              ? "Describe what makes this fish look different…"
              : "Distinguishing traits, how it was bred, stability across generations…"}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>

        <div>
          <label style={labelStyle}>Morph evidence photo</label>
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.6rem",
          }}>
            {/* Photo preview or upload trigger */}
            {proofPhoto?.preview ? (
              <div style={{ position: "relative", display: "inline-block" }}>
                <img
                  src={proofPhoto.preview}
                  alt="Morph evidence preview"
                  style={{
                    width: "100%",
                    maxHeight: "180px",
                    objectFit: "cover",
                    borderRadius: "8px",
                    border: "1px solid var(--glass-border)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setProofPhoto(null);
                    if (proofInputRef.current) proofInputRef.current.value = "";
                  }}
                  style={{
                    position: "absolute",
                    top: "0.4rem",
                    right: "0.4rem",
                    background: "rgba(0, 0, 0, 0.7)",
                    border: "none",
                    color: "#fff",
                    borderRadius: "50%",
                    width: "24px",
                    height: "24px",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  aria-label="Remove photo"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => proofInputRef.current?.click()}
                style={{
                  padding: "1.25rem",
                  borderRadius: "8px",
                  border: "2px dashed " + (casualModeActive ? "rgba(56, 189, 248, 0.3)" : "rgba(168, 85, 247, 0.3)"),
                  background: casualModeActive ? "rgba(56, 189, 248, 0.04)" : "rgba(168, 85, 247, 0.04)",
                  color: "var(--text-muted, #94a3b8)",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "all 0.2s ease",
                }}
              >
                📷 {casualModeActive ? "Tap to add a photo of your morph" : "Upload morph evidence photo"}
              </button>
            )}
            <input
              ref={proofInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const preview = URL.createObjectURL(file);
                setProofPhoto({ file, preview });
              }}
            />
            {/* Fallback: paste a URL if no photo uploaded */}
            {!proofPhoto && (
              <input
                type="url"
                value={form.proofUrl}
                onChange={(e) => update("proofUrl", e.target.value)}
                placeholder={casualModeActive ? "Or paste a link to a photo…" : "Or paste reference URL…"}
                style={{ ...inputStyle, fontSize: "0.78rem" }}
              />
            )}
          </div>
        </div>

        {error && (
          <div style={{ fontSize: "0.78rem", color: "var(--accent-red, #f87171)" }}>{error}</div>
        )}
        {successMsg && (
          <div style={{ fontSize: "0.78rem", color: "var(--accent-green, #34d399)" }}>{successMsg}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="submit"
            disabled={submitting || !walletAccount || !configured}
            className={casualModeActive ? "btn-primary" : "btn-primary-pro"}
            style={{ padding: "0.55rem 1.5rem", fontSize: "0.85rem", opacity: submitting || !walletAccount || !configured ? 0.6 : 1 }}
          >
            {submitting ? "Submitting…" : casualModeActive ? "Submit for review" : "Submit for verification"}
          </button>
        </div>
      </form>

      {/* Curator review panel */}
      {isCurator && (
        <div
          style={{
            marginBottom: "1.5rem",
            padding: "1.25rem",
            borderRadius: "12px",
            background: "rgba(168, 85, 247, 0.04)",
            border: "1px solid rgba(168, 85, 247, 0.25)",
          }}
        >
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, color: "#fff", margin: "0 0 0.75rem" }}>
            🛡️ Curator Review
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted, #94a3b8)", fontWeight: 400, marginLeft: "0.4rem" }}>
              {pendingCount} pending
            </span>
          </h3>
          {reviewError && (
            <div style={{ fontSize: "0.75rem", color: "var(--accent-red, #f87171)", marginBottom: "0.5rem" }}>{reviewError}</div>
          )}
          {reviewQueue.length === 0 ? (
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted, #94a3b8)" }}>No submissions in the queue.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {reviewQueue.map((m) => renderSubmissionRow(m, { showSubmitter: true, actions: true }))}
            </div>
          )}
        </div>
      )}

      {/* Submitter's own history */}
      <div>
        <h3 style={{ fontSize: "0.85rem", fontWeight: 700, color: "#fff", margin: "0 0 0.6rem" }}>
          {casualModeActive ? "Your submissions" : "Submission queue"}
          {submissions.length > 0 && (
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted, #94a3b8)", fontWeight: 400, marginLeft: "0.4rem" }}>
              ({submissions.length})
            </span>
          )}
        </h3>

        {submissions.length === 0 ? (
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted, #94a3b8)", padding: "0.75rem 0" }}>
            No morphs submitted yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {submissions.map((m) => renderSubmissionRow(m))}
          </div>
        )}
      </div>
    </div>
  );
}
