import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useSpeciesData } from "../../hooks/useSpeciesData";
import { CasualTankGallery } from "../logbook/CasualTankGallery";
import { readOwnerShowcaseTanks } from "../../services/showcaseDatasetV3";
import { readLocalShowcasePreview } from "../../services/showcaseLocalPreview";

/**
 * SteveShowcasePreview: the simple "here's my room" view. Its header uses the
 * same Daylight treatment as the public Fish Room page.
 *
 * The point of the showcase is to show off a fish room. This does exactly that
 * and nothing else: as soon as Steve opens the tab (already logged in), it reads
 * his real My Aquariums tanks and fish from this device and renders them as the
 * same living-aquarium gallery the app already uses. No wallet signature, no
 * "confirm N tanks", no enroll/import/publish ceremony — those live behind the
 * advanced tools. This is the everyday, easy path.
 */
const panel = { padding: "1.15rem", border: "1px solid var(--glass-border)", borderRadius: "12px" };

// Daylight styles that echo the public Fish Room page (showcase.html).
const hero = {
  display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap",
  padding: "clamp(1rem, 3vw, 1.8rem)",
  background: "radial-gradient(circle at 8% 0%, rgba(245,158,11,.10), transparent 42%), linear-gradient(130deg, #ffffff 0%, #f5f9fa 55%, var(--bg-band) 100%)",
  borderBottom: "1px solid var(--line)",
};
const eyebrow = {
  display: "flex", alignItems: "center", gap: ".6rem", color: "var(--accent-teal)",
  fontSize: ".7rem", fontWeight: 800, letterSpacing: ".16em", textTransform: "uppercase", marginBottom: ".7rem",
};
const title = {
  color: "var(--text-primary)", margin: 0, fontFamily: "var(--font-display)", fontWeight: 700,
  fontSize: "clamp(1.8rem, 4vw, 2.8rem)", lineHeight: 1, letterSpacing: "-.04em",
};
const pill = {
  minHeight: "42px", display: "inline-flex", alignItems: "center", padding: "0 16px", borderRadius: "999px",
  border: "1px solid var(--line)", background: "#fff", color: "var(--text-primary)",
  fontWeight: 700, fontSize: ".8rem", textDecoration: "none",
};
const pillTeal = { ...pill, background: "var(--accent-teal)", borderColor: "var(--accent-teal)", color: "#fff" };
const stats = { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", borderBottom: "1px solid var(--line)", background: "#fff" };
const stat = { padding: ".9rem .5rem", textAlign: "center", borderRight: "1px solid var(--line)" };
const statValue = { display: "block", fontFamily: "var(--font-display)", fontSize: "1.4rem", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" };
const srOnly = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" };
const statLabel = { color: "var(--text-muted)", fontSize: ".64rem", textTransform: "uppercase", letterSpacing: ".12em" };

// This curated showcase and the wallet allowed to flip its public/private state.
const SHOWCASE_SLUG = "ggstevericefishnj";
const SHOWCASE_OWNER_WALLET = "0xef0931458159097a62fddd0ca798f269b5ce98f7";

export function SteveShowcasePreview() {
  const { ready, authenticated, account, loginMethod, getAccessToken } = useAuth();
  const { data: fishbaseData = [] } = useSpeciesData();
  const normalizedAccount = typeof account === "string" ? account.toLowerCase() : null;
  const isOwner = normalizedAccount === SHOWCASE_OWNER_WALLET;

  const [phase, setPhase] = useState("loading"); // loading | ready | empty | sign-in | error
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  // Public/private toggle state (owner only). null = unknown/loading.
  const [isPublic, setIsPublic] = useState(null);
  const [visBusy, setVisBusy] = useState(false);
  const [visError, setVisError] = useState(null);

  const loadRoom = useCallback(async () => {
    if (!normalizedAccount) return;
    setPhase("loading");
    setError(null);
    try {
      const tanks = await readOwnerShowcaseTanks(normalizedAccount);
      if (!tanks.length) { setPreview(null); setPhase("empty"); return; }
      const next = await readLocalShowcasePreview({
        ownerAddress: normalizedAccount,
        selectedTankIds: tanks.map((tank) => tank.id),
      });
      setPreview(next);
      setPhase("ready");
    } catch (err) {
      setError(err?.message || "Could not load your room.");
      setPhase("error");
    }
  }, [normalizedAccount]);

  useEffect(() => {
    if (!ready) { setPhase("loading"); return; }
    if (!authenticated || !normalizedAccount || loginMethod !== "privy") { setPhase("sign-in"); return; }
    loadRoom();
  }, [ready, authenticated, normalizedAccount, loginMethod, loadRoom]);

  // Cloud sync can bring in more tanks a moment after login; refresh when it lands.
  useEffect(() => {
    if (!normalizedAccount) return undefined;
    const onSync = (event) => {
      const wallet = typeof event.detail?.wallet === "string" ? event.detail.wallet.toLowerCase() : null;
      if (wallet === normalizedAccount) loadRoom();
    };
    window.addEventListener("aquadex:cloud-sync-complete", onSync);
    return () => window.removeEventListener("aquadex:cloud-sync-complete", onSync);
  }, [normalizedAccount, loadRoom]);

  // Load current public/private state for the owner.
  useEffect(() => {
    if (!isOwner || !authenticated || typeof getAccessToken !== "function") return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token || cancelled) return;
        const res = await fetch(`/api/storefront-detail?action=curated-visibility&slug=${encodeURIComponent(SHOWCASE_SLUG)}`, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && typeof data.isPublic === "boolean") setIsPublic(data.isPublic);
      } catch {
        // Non-fatal — the toggle just stays in an unknown state.
      }
    })();
    return () => { cancelled = true; };
  }, [isOwner, authenticated, getAccessToken]);

  const toggleVisibility = useCallback(async () => {
    if (visBusy || typeof getAccessToken !== "function") return;
    const next = !isPublic;
    setVisBusy(true);
    setVisError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Please sign in again.");
      const res = await fetch(`/api/storefront-detail?action=curated-visibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ slug: SHOWCASE_SLUG, isPublic: next }),
      });
      if (!res.ok) throw new Error(res.status === 403 ? "Not authorized to change this showcase." : "Could not update visibility.");
      const data = await res.json();
      setIsPublic(typeof data.isPublic === "boolean" ? data.isPublic : next);
    } catch (err) {
      setVisError(err?.message || "Could not update visibility.");
    } finally {
      setVisBusy(false);
    }
  }, [visBusy, getAccessToken, isPublic]);

  const tankCount = preview?.tanks?.length || 0;
  const fishCount = (preview?.tanks || []).reduce((sum, tank) => sum + (tank.specimens?.length || 0), 0);

  return (
    <div className="glass-card" style={{ ...panel, padding: 0, overflow: "hidden" }}>
      {/* Header mirrors the public Fish Room hero (/showcase/<slug>): eyebrow,
          display title, plain description, and the same pill buttons. */}
      <div style={hero}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <div style={eyebrow}>
            <span aria-hidden="true" style={{ width: "28px", height: "1px", background: "currentColor" }} />
            Fish Room{isOwner && isPublic !== null ? ` · ${isPublic ? "Public" : "Private"}` : ""}
          </div>
          <h2 style={title}>{preview?.title || "Your fish room"}</h2>
          <p style={{ color: "var(--text-secondary)", margin: ".6rem 0 0", maxWidth: "620px", lineHeight: 1.6 }}>
            {preview?.description || "A live view of your tanks and fish, straight from My Aquariums."}
          </p>
          {isOwner && isPublic && (
            <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap", marginTop: "1rem" }}>
              <a href={`/showcase/${SHOWCASE_SLUG}`} target="_blank" rel="noopener noreferrer" style={pillTeal}>
                View the public page<span style={srOnly}> (opens in a new tab)</span>
              </a>
              <a href={`/store/${SHOWCASE_SLUG}`} target="_blank" rel="noopener noreferrer" style={pill}>
                View the store<span style={srOnly}> (opens in a new tab)</span>
              </a>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: ".6rem", flexWrap: "wrap" }}>
          {isOwner && isPublic !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
              <span style={{ fontSize: ".8rem", fontWeight: 600, color: isPublic ? "var(--accent-green)" : "var(--text-muted)" }}>
                {isPublic ? "Public" : "Private"}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={isPublic}
                aria-label={isPublic ? "Showcase is public. Click to make it private" : "Showcase is private. Click to make it public"}
                onClick={toggleVisibility}
                disabled={visBusy}
                title={isPublic
                  ? "Anyone with the link can see this showcase. Click to make it private."
                  : "Only you can see this showcase. Click to make it public."}
                style={{
                  position: "relative", width: "46px", height: "26px", borderRadius: "999px",
                  border: "1px solid var(--glass-border)", cursor: visBusy ? "wait" : "pointer",
                  background: isPublic ? "var(--accent-green-fill)" : "rgba(var(--ink-rgb), 0.12)",
                  transition: "background .2s", opacity: visBusy ? 0.6 : 1, flexShrink: 0,
                }}
              >
                <span style={{
                  position: "absolute", top: "2px", left: isPublic ? "22px" : "2px",
                  width: "20px", height: "20px", borderRadius: "50%", background: "#fff",
                  transition: "left .2s",
                }} />
              </button>
            </div>
          )}
          {(phase === "ready" || phase === "empty" || phase === "error") && (
            <button type="button" className="btn-secondary" onClick={loadRoom}>Refresh</button>
          )}
        </div>
      </div>

      {phase === "ready" && (
        <div style={stats} aria-label="Room summary">
          <div style={stat}><strong style={statValue}>{tankCount}</strong><span style={statLabel}>{tankCount === 1 ? "Tank" : "Tanks"}</span></div>
          <div style={{ ...stat, borderRight: 0 }}><strong style={statValue}>{fishCount}</strong><span style={statLabel}>Fish</span></div>
        </div>
      )}

      <div style={{ padding: "clamp(.8rem, 2vw, 1.4rem)" }}>
        {isOwner && (
          <p style={{ color: "var(--text-muted)", fontSize: ".78rem", margin: "0 0 1rem" }}>
            {isPublic === null
              ? ""
              : isPublic
                ? <>Your showcase is live at <code>/showcase/{SHOWCASE_SLUG}</code>. Anyone with the link can view it.</>
                : "Your showcase is private, so only you can see it. Flip the switch to publish it."}
            {visError && <span role="alert" style={{ color: "var(--accent-red)", marginLeft: ".5rem" }}>{visError}</span>}
          </p>
        )}
        {phase === "ready" && (
          <p style={{ color: "var(--text-muted)", fontSize: ".82rem", margin: "0 0 1rem" }}>
            Your tanks and fish from My Aquariums. Tank photos appear automatically.
          </p>
        )}
        {phase === "loading" && <p style={{ color: "var(--text-secondary)" }}>Loading your room…</p>}

        {phase === "sign-in" && (
          <p style={{ color: "var(--accent-amber)" }}>Sign in to see your fish room.</p>
        )}

        {phase === "empty" && (
          <p style={{ color: "var(--text-secondary)" }}>
            No tanks yet on this device. Add tanks and fish in My Aquariums and they will appear here automatically.
          </p>
        )}

        {phase === "error" && (
          <p role="alert" style={{ color: "var(--accent-red)" }}>{error}</p>
        )}

        {phase === "ready" && (
          <CasualTankGallery tanks={preview.tanks} fishbaseData={fishbaseData} />
        )}
      </div>
    </div>
  );
}
