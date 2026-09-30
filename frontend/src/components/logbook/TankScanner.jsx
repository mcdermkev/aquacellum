import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import "./TankScanner.css";
import { parseTankScan, resolveTankScan } from "../../utils/tankLabel";

/**
 * TankScanner — real camera QR scanner for tank labels (replaces the old
 * simulation that just picked a random tank).
 *
 * Tank QR labels (utils/tankLabel.js `tankLabelTarget`) encode either the
 * private deep link `https://aquacellum.com/app#tank=<id>` or, for a tank the
 * owner published, its public page `https://aquacellum.com/t/<token>`. This
 * opens the rear camera, decodes frames with jsQR, and hands the payload to
 * `resolveTankScan`:
 *   - private label for one of the user's tanks: open it (onSelect)
 *   - public label this wallet published from this device: open the tank too
 *   - any other public label: offer "Open public page" (/t/<token>)
 *   - anything else: a plain "not a tank label" message
 * A manual entry (tank number or pasted link) is always available as a
 * fallback (camera denied / unavailable / poor lighting).
 *
 * Props:
 *   tanks            — the user's tanks, to resolve a scanned id → tank
 *   walletAccount    — whose remembered publications to match public labels against
 *   casualModeActive — copy ("tank" vs "unit")
 *   onSelect(tank)   — a scanned/entered label matched one of the user's tanks
 *   onClose()        — dismiss
 */

const DECODE_INTERVAL_MS = 160; // throttle jsQR so it doesn't run every frame
const MAX_DECODE_WIDTH = 640; // downscale big camera frames for decode speed

/**
 * The tank id on a private label (`…/app#tank=123`, `…/app?tank=123`) or a
 * bare number, else null. Exported for testing.
 */
export function parseTankIdFromScan(text) {
  const scan = parseTankScan(text);
  return scan.kind === "private" ? scan.tankId : null;
}

function sameNotice(a, b) {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.tankId === b.tankId && a.url === b.url;
}

export function TankScanner({ tanks = [], walletAccount = null, casualModeActive = false, onSelect, onClose }) {
  const noun = casualModeActive ? "tank" : "unit";
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const doneRef = useRef(false);
  const lastDecodeRef = useRef(0);

  const [status, setStatus] = useState("starting"); // "starting" | "scanning" | "error"
  const [errorMsg, setErrorMsg] = useState("");
  // What the last scan or entry was, when it didn't open a tank:
  // { kind: "not-found", tankId } | { kind: "public", url } | { kind: "unknown" } | null
  const [notice, setNotice] = useState(null);
  const [manual, setManual] = useState("");

  const stopCamera = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  // Act on a scan or manual entry. Returns true when a tank was opened.
  const handleScan = (text) => {
    const result = resolveTankScan(text, { tanks, wallet: walletAccount });
    if (result.action === "open") {
      doneRef.current = true;
      stopCamera();
      onSelect && onSelect(result.tank);
      return true;
    }
    const next =
      result.action === "not-found" ? { kind: "not-found", tankId: result.tankId }
      : result.action === "public" ? { kind: "public", url: result.url }
      : { kind: "unknown" };
    // The camera sees the same code many times a second; don't re-render for repeats.
    setNotice((prev) => (sameNotice(prev, next) ? prev : next));
    return false;
  };

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      if (cancelled || doneRef.current) return;
      const v = videoRef.current;
      const c = canvasRef.current;
      const now = performance.now();
      if (v && c && v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth && now - lastDecodeRef.current >= DECODE_INTERVAL_MS) {
        lastDecodeRef.current = now;
        const scale = Math.min(1, MAX_DECODE_WIDTH / v.videoWidth);
        const w = Math.round(v.videoWidth * scale);
        const h = Math.round(v.videoHeight * scale);
        c.width = w; c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const code = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
        if (code && code.data && handleScan(code.data)) return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const start = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus("error");
        setErrorMsg(`Camera isn't available here. Enter the ${noun} number below instead.`);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.setAttribute("playsinline", "true"); // iOS: don't go fullscreen
          await v.play().catch(() => {});
        }
        setStatus("scanning");
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        setStatus("error");
        setErrorMsg(
          err && err.name === "NotAllowedError"
            ? `Camera permission was denied. Allow camera access, or enter the ${noun} number below.`
            : `Couldn't start the camera. Enter the ${noun} number below.`
        );
      }
    };

    start();
    return () => { cancelled = true; stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitManual = (e) => {
    e.preventDefault();
    handleScan(manual);
  };

  return (
    <div className="tank-scanner-backdrop" role="dialog" aria-modal="true" aria-label={`Scan ${noun} QR code`}>
      <div className="tank-scanner glass-card">
        <div className="ts-head">
          <strong>📷 Scan {noun} QR</strong>
          <button type="button" className="ts-close" onClick={() => { stopCamera(); onClose && onClose(); }} aria-label="Close scanner">✕</button>
        </div>

        {status !== "error" ? (
          <div className="ts-viewport">
            <video ref={videoRef} className="ts-video" muted playsInline />
            <div className="ts-reticle" aria-hidden="true" />
            {status === "scanning" && <div className="ts-laser" aria-hidden="true" />}
            <span className="ts-hint">{status === "starting" ? "Starting camera…" : `Point at the ${noun}'s QR label`}</span>
          </div>
        ) : (
          <div className="ts-error">{errorMsg}</div>
        )}

        {/* Offscreen decode canvas */}
        <canvas ref={canvasRef} style={{ display: "none" }} />

        {notice?.kind === "not-found" && (
          <div className="ts-notfound" role="alert">
            {`${casualModeActive ? "Tank" : "Unit"} #${notice.tankId} isn't in your account.`}
          </div>
        )}
        {notice?.kind === "public" && (
          <div className="ts-public" role="status">
            <span>This is a public tank page. It isn't one of your {noun}s on this device.</span>
            <a className="btn-primary" href={notice.url} onClick={() => stopCamera()}>Open public page</a>
          </div>
        )}
        {notice?.kind === "unknown" && (
          <div className="ts-notfound" role="alert">
            This code isn't a tank label.
          </div>
        )}

        {/* Manual fallback — always available */}
        <form className="ts-manual" onSubmit={submitManual}>
          <input
            type="text"
            inputMode="numeric"
            value={manual}
            onChange={(e) => { setManual(e.target.value); setNotice(null); }}
            placeholder={`Or enter ${noun} number`}
            aria-label={`${casualModeActive ? "Tank" : "Unit"} number`}
          />
          <button type="submit" className="btn-primary" disabled={!manual.trim()}>Open</button>
        </form>
      </div>
    </div>
  );
}
