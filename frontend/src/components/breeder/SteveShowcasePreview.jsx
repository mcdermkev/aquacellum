import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useSpeciesData } from "../../hooks/useSpeciesData";
import { CasualTankGallery } from "../logbook/CasualTankGallery";
import { readOwnerShowcaseTanks } from "../../services/showcaseDatasetV3";
import { readLocalShowcasePreview } from "../../services/showcaseLocalPreview";

/**
 * SteveShowcasePreview — the simple "here's my room" view.
 *
 * The point of the showcase is to show off a fish room. This does exactly that
 * and nothing else: as soon as Steve opens the tab (already logged in), it reads
 * his real My Aquariums tanks and fish from this device and renders them as the
 * same living-aquarium gallery the app already uses. No wallet signature, no
 * "confirm N tanks", no enroll/import/publish ceremony — those live behind the
 * advanced tools. This is the everyday, easy path.
 */
const panel = { padding: "1.15rem", border: "1px solid var(--glass-border)", borderRadius: "12px" };

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
    <div className="glass-card" style={{ ...panel, padding: "clamp(.8rem, 2vw, 1.4rem)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ color: "var(--text-primary)", margin: ".2rem 0" }}>{preview?.title || "Your fish room"}</h2>
          <p style={{ color: "var(--text-secondary)", margin: 0 }}>
            {preview?.description || "A live view of your tanks and fish, straight from My Aquariums."}
          </p>
          {phase === "ready" && (
            <p style={{ color: "var(--text-muted)", fontSize: ".82rem", marginBottom: 0 }}>
              {tankCount} tank{tankCount === 1 ? "" : "s"} · {fishCount} fish · your tank photos appear automatically.
            </p>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: ".6rem", flexWrap: "wrap" }}>
          {isOwner && isPublic !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
              <span style={{ fontSize: ".8rem", fontWeight: 600, color: isPublic ? "var(--accent-green, #34d399)" : "var(--text-muted)" }}>
                {isPublic ? "Public" : "Private"}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={isPublic}
                aria-label={isPublic ? "Showcase is public — click to make private" : "Showcase is private — click to make public"}
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
      {isOwner && (
        <p style={{ color: "var(--text-muted)", fontSize: ".78rem", margin: ".5rem 0 0" }}>
          {isPublic === null
            ? ""
            : isPublic
              ? <>Your showcase is live at <code>/showcase/{SHOWCASE_SLUG}</code>. Anyone with the link can view it.</>
              : "Your showcase is private — only you can see it. Flip the switch to publish it."}
          {visError && <span role="alert" style={{ color: "var(--accent-red)", marginLeft: ".5rem" }}>{visError}</span>}
        </p>
      )}

      <div style={{ marginTop: "1rem" }}>
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
