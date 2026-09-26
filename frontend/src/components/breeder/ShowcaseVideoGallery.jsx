import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import {
  finalizeShowcaseVideo,
  getShowcaseVideoPlayback,
  putShowcaseVideo,
  readShowcaseVideos,
  revokeShowcaseVideo,
  stageShowcaseVideo,
  uploadShowcaseVideoSource,
} from "../../services/showcaseOwnerApi.js";

const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const ACTIVE_STATES = new Set(["staging", "queued", "processing"]);
const TERMINAL_STATES = new Set(["revoked", "deleted", "rejected", "errored"]);

function pendingKey(ownerAddress, roomId) {
  return `aquacellum:showcase-video:v1:${String(ownerAddress || "").toLowerCase()}:${roomId || "none"}`;
}

function readPending(ownerAddress, roomId) {
  try {
    const parsed = JSON.parse(localStorage.getItem(pendingKey(ownerAddress, roomId)) || "null");
    if (!parsed || parsed.roomId !== roomId || typeof parsed.operationId !== "string"
        || typeof parsed.videoId !== "string" || typeof parsed.uploadIntentId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePending(ownerAddress, roomId, value) {
  try {
    const key = pendingKey(ownerAddress, roomId);
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch { /* recovery storage is best effort; server state remains authoritative */ }
}

function errorMessage(error) {
  if (typeof error?.message === "string" && error.message) return error.message;
  return "The video action could not be completed. Refresh server state before retrying.";
}

function draftFor(video, index) {
  const gallery = video.gallery;
  return {
    title: gallery?.title || `Fish room video ${index + 1}`,
    caption: gallery?.caption || "",
    altText: gallery?.alt || "Steve's fish room video.",
    displayOrder: Number.isInteger(gallery?.order) ? gallery.order : index,
    visibility: gallery?.visibility || "private",
    approved: false,
  };
}

function SignedHlsVideo({ url, title }) {
  const ref = useRef(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || !url) return undefined;
    let hls = null;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
    } else if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.loadSource(url);
      hls.attachMedia(video);
    }
    return () => {
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [url]);
  return <video ref={ref} controls playsInline preload="metadata" aria-label={title}
    style={{ width: "100%", maxHeight: "420px", borderRadius: "10px", background: "#000" }} />;
}

export function ShowcaseVideoGallery({ roomId, ownerAddress, enabled }) {
  const [videos, setVideos] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [file, setFile] = useState(null);
  const [pending, setPending] = useState(() => readPending(ownerAddress, roomId));
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);
  const [playback, setPlayback] = useState({});
  const [revokeApproved, setRevokeApproved] = useState({});

  const refresh = useCallback(async () => {
    if (!roomId) return [];
    const response = await readShowcaseVideos(roomId);
    const rows = Array.isArray(response.data?.videos) ? response.data.videos : [];
    setVideos(rows);
    setDrafts((current) => {
      const next = { ...current };
      rows.forEach((video, index) => { if (!next[video.videoId]) next[video.videoId] = draftFor(video, index); });
      return next;
    });
    const handle = readPending(ownerAddress, roomId);
    if (handle) {
      const recovered = rows.find((video) => video.videoId === handle.videoId);
      if (!recovered || TERMINAL_STATES.has(recovered.state)) {
        writePending(ownerAddress, roomId, null);
        setPending(null);
      } else if (recovered.state !== "staging") {
        writePending(ownerAddress, roomId, null);
        setPending(null);
      } else {
        setPending(handle);
      }
    }
    return rows;
  }, [ownerAddress, roomId]);

  useEffect(() => {
    if (!enabled || !roomId) return;
    setPhase("loading");
    refresh().then(() => { setPhase("idle"); setError(null); })
      .catch((failure) => { setPhase("error"); setError(errorMessage(failure)); });
  }, [enabled, refresh, roomId]);

  const processing = useMemo(() => videos.some((video) => ACTIVE_STATES.has(video.state) && video.state !== "staging"), [videos]);
  useEffect(() => {
    if (!enabled || !processing) return undefined;
    let stopped = false;
    let checking = false;
    const timer = setInterval(async () => {
      if (checking || stopped) return;
      checking = true;
      try {
        await refresh();
        if (!stopped) setError(null);
      } catch (failure) {
        if (!stopped) setError(errorMessage(failure));
      } finally {
        checking = false;
      }
    }, 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [enabled, processing, refresh]);

  const finalizePending = useCallback(async (handle) => {
    setPhase("finalizing");
    const finalized = await finalizeShowcaseVideo({
      roomId, videoId: handle.videoId, uploadIntentId: handle.uploadIntentId,
    });
    writePending(ownerAddress, roomId, null);
    setPending(null);
    await refresh();
    setPhase(finalized.data?.state || "queued");
  }, [ownerAddress, refresh, roomId]);

  const upload = async () => {
    if (!file || file.type !== "video/mp4" || file.size < 1 || file.size > MAX_VIDEO_BYTES) {
      setError("Choose one MP4 video no larger than 250 MiB.");
      return;
    }
    setError(null);
    setPhase("staging");
    let handle = pending;
    try {
      const operationId = handle?.operationId || crypto.randomUUID();
      const staged = await stageShowcaseVideo({ roomId, operationId });
      const next = {
        roomId,
        operationId,
        videoId: staged.data.videoId,
        uploadIntentId: staged.data.uploadIntentId,
      };
      if (handle && (handle.videoId !== next.videoId || handle.uploadIntentId !== next.uploadIntentId)) {
        throw new Error("The recovered upload no longer matches server state.");
      }
      handle = next;
      writePending(ownerAddress, roomId, handle);
      setPending(handle);
      setPhase("uploading");
      await uploadShowcaseVideoSource({ file, upload: staged.data.upload });
      await finalizePending(handle);
      setFile(null);
    } catch (failure) {
      setPhase("recovery-required");
      setError(`${errorMessage(failure)} The source is never uploaded twice automatically; use “Finalize observed upload” or refresh.`);
      await refresh().catch(() => {});
    }
  };

  const save = async (video) => {
    const draft = drafts[video.videoId];
    if (!draft?.approved) return;
    setPhase(`saving:${video.videoId}`);
    setError(null);
    try {
      await putShowcaseVideo({
        roomId,
        videoId: video.videoId,
        expectedRevision: video.gallery?.revision ?? null,
        title: draft.title,
        caption: draft.caption.trim() || null,
        altText: draft.altText,
        displayOrder: Number(draft.displayOrder),
        visibility: draft.visibility,
      });
      await refresh();
      setDrafts((all) => ({ ...all, [video.videoId]: { ...all[video.videoId], approved: false } }));
      setPhase("idle");
    } catch (failure) {
      setPhase("state-stale");
      setError(errorMessage(failure));
      await refresh().catch(() => {});
    }
  };

  const preview = async (video) => {
    setError(null);
    try {
      const token = await getShowcaseVideoPlayback({ roomId, videoId: video.videoId });
      setPlayback((all) => ({ ...all, [video.videoId]: token.data.playbackUrl }));
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const revoke = async (video) => {
    if (!revokeApproved[video.videoId]) return;
    setPhase(`revoking:${video.videoId}`);
    setError(null);
    try {
      const latestRows = await refresh();
      const latest = latestRows.find((item) => item.videoId === video.videoId);
      if (!latest || TERMINAL_STATES.has(latest.state)) throw new Error("The video is already unavailable.");
      await revokeShowcaseVideo({
        roomId, videoId: latest.videoId, expectedRevision: latest.revision,
      });
      setPlayback((all) => ({ ...all, [video.videoId]: null }));
      setRevokeApproved((all) => ({ ...all, [video.videoId]: false }));
      await refresh();
      setPhase("idle");
    } catch (failure) {
      setPhase("state-stale");
      setError(errorMessage(failure));
    }
  };

  const updateDraft = (videoId, changes) => setDrafts((all) => ({
    ...all,
    [videoId]: { ...all[videoId], ...changes, approved: false },
  }));

  return (
    <div className="glass-card" style={{ padding: "1rem" }}>
      <h4 style={{ color: "#fff", marginTop: 0 }}>7. Signed room video gallery</h4>
      <p style={{ color: "var(--text-secondary)" }}>
        MP4 sources stay private, are validated by the durable worker, and receive signed Mux playback only.
        Gallery entries are room-level and capped at 20.
      </p>
      {!enabled && <p style={{ color: "#fbbf24" }}>Signed room video is not configured in this environment.</p>}
      <input type="file" accept="video/mp4,.mp4" disabled={!enabled || phase === "uploading" || phase === "finalizing"}
        onChange={(event) => { setFile(event.target.files?.[0] || null); setError(null); }} />
      <button type="button" className="btn-secondary" style={{ marginLeft: ".6rem" }}
        disabled={!enabled || !file || phase === "uploading" || phase === "finalizing" || videos.length >= 20}
        onClick={upload}>{pending ? "Resume this staged upload once" : "Upload one private MP4"}</button>
      {pending && <button type="button" className="btn-secondary" style={{ marginLeft: ".6rem" }}
        disabled={phase === "finalizing"} onClick={() => finalizePending(pending).catch((failure) => {
          setPhase("recovery-required"); setError(errorMessage(failure));
        })}>Finalize observed upload</button>}
      <p style={{ color: "var(--text-muted)", fontSize: ".8rem" }}>Video state: <strong>{phase}</strong> · {videos.length}/20 retained assets</p>
      {error && <p role="alert" style={{ color: "#f87171" }}>{error}</p>}
      <button type="button" className="btn-secondary" onClick={() => refresh().catch((failure) => setError(errorMessage(failure)))}>Refresh videos</button>

      {videos.map((video, index) => {
        const draft = drafts[video.videoId] || draftFor(video, index);
        const terminal = TERMINAL_STATES.has(video.state);
        return (
          <section key={video.videoId} style={{ borderTop: "1px solid var(--glass-border)", marginTop: "1rem", paddingTop: "1rem" }}>
            <p style={{ color: "var(--text-muted)", fontSize: ".76rem" }}>
              <code>{video.videoId}</code> · state {video.state} · revision {video.revision}
              {video.durationSeconds ? ` · ${Number(video.durationSeconds).toFixed(1)}s` : ""}
            </p>
            {video.state === "ready" && !terminal && <>
              <div style={{ display: "grid", gap: ".55rem" }}>
                <input value={draft.title} maxLength={120} placeholder="Approved title"
                  onChange={(event) => updateDraft(video.videoId, { title: event.target.value })} />
                <textarea value={draft.caption} maxLength={1000} placeholder="Optional caption"
                  onChange={(event) => updateDraft(video.videoId, { caption: event.target.value })} />
                <input value={draft.altText} maxLength={500} placeholder="Required accessible description"
                  onChange={(event) => updateDraft(video.videoId, { altText: event.target.value })} />
                <div style={{ display: "flex", gap: ".55rem", flexWrap: "wrap" }}>
                  <input type="number" min="0" max="19" value={draft.displayOrder}
                    onChange={(event) => updateDraft(video.videoId, { displayOrder: Number(event.target.value) })} />
                  <select value={draft.visibility}
                    onChange={(event) => updateDraft(video.videoId, { visibility: event.target.value })}>
                    <option value="private">Private</option>
                    <option value="unlisted">Unlisted room only</option>
                    <option value="public">Public</option>
                  </select>
                </div>
              </div>
              <label style={{ display: "flex", gap: ".5rem", color: "var(--text-secondary)", marginTop: ".6rem" }}>
                <input type="checkbox" checked={draft.approved}
                  onChange={(event) => setDrafts((all) => ({ ...all, [video.videoId]: { ...draft, approved: event.target.checked } }))} />
                Steve approves this exact title, caption, alt text, order, and visibility.
              </label>
              <button type="button" className="btn-primary" disabled={!draft.approved || !draft.title.trim()
                || !draft.altText.trim() || !Number.isInteger(Number(draft.displayOrder))
                || Number(draft.displayOrder) < 0 || Number(draft.displayOrder) > 19}
                onClick={() => save(video)}>{video.gallery ? "Update approved gallery entry" : "Add approved gallery entry"}</button>
              <button type="button" className="btn-secondary" style={{ marginLeft: ".6rem" }} onClick={() => preview(video)}>
                Load fresh 60-second preview
              </button>
              {playback[video.videoId] && <div style={{ marginTop: ".8rem" }}>
                <SignedHlsVideo url={playback[video.videoId]} title={draft.altText || draft.title} />
              </div>}
            </>}
            {!terminal && <div style={{ marginTop: ".8rem" }}>
              <label style={{ display: "flex", gap: ".5rem", color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={!!revokeApproved[video.videoId]}
                  onChange={(event) => setRevokeApproved((all) => ({ ...all, [video.videoId]: event.target.checked }))} />
                Revoke this video, deny new tokens immediately, and queue source/provider deletion.
              </label>
              <button type="button" className="btn-secondary" disabled={!revokeApproved[video.videoId]}
                onClick={() => revoke(video)}>Revoke video</button>
            </div>}
          </section>
        );
      })}
    </div>
  );
}
