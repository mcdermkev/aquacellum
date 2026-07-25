import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import "./TankScanner.css";

/**
 * TankScanner — real camera QR scanner for tank labels (replaces the old
 * simulation that just picked a random tank).
 *
 * Tank QR codes (TankQRCode.jsx + generateTankQRLabel in pdfExport.js) encode
 * the deep link `https://aquacellum.com/app#tank=<id>`. This opens the rear
 * camera, decodes frames with jsQR, extracts the tank id, and hands back the
 * matching tank. A manual unit-number entry is always available as a fallback
 * (camera denied / unavailable / poor lighting).
 *
 * Props:
 *   tanks            — the user's tanks, to resolve a scanned id → tank
 *   casualModeActive — copy ("tank" vs "unit")
 *   onSelect(tank)   — a scanned/entered id matched one of the user's tanks
 *   onClose()        — dismiss
 */

const DECODE_INTERVAL_MS = 160; // throttle jsQR so it doesn't run every frame
const MAX_DECODE_WIDTH = 640; // downscale big camera frames for decode speed

/**
 * Extract a tank id from a scanned QR payload. Accepts the app deep link
 * (`…#tank=123` or `…?tank=123`) or a bare number. Exported for testing.
 */
export function parseTankIdFromScan(text) {
  if (text == null) return null;
  const m = String(text).match(/tank=(\d+)/i);
  if (m) return Number(m[1]);
  const bare = String(text).trim();
  if (/^\d+$/.test(bare)) return Number(bare);
  return null;
}

export function TankScanner({ tanks = [], casualModeActive = false, onSelect, onClose }) {
  const noun = casualModeActive ? "tank" : "unit";
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const doneRef = useRef(false);
  const lastDecodeRef = useRef(0);

  const [status, setStatus] = useState("starting"); // "starting" | "scanning" | "error"
  const [errorMsg, setErrorMsg] = useState("");
  const [notFoundId, setNotFoundId] = useState(null);
  const [manual, setManual] = useState("");

  const stopCamera = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const resolveId = (id) => {
    const tank = tanks.find((t) => Number(t.id) === Number(id));
    if (tank) {
      doneRef.current = true;
      stopCamera();
      onSelect && onSelect(tank);
      return true;
    }
    setNotFoundId(id);
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
        if (code && code.data) {
          const id = parseTankIdFromScan(code.data);
          if (id != null && resolveId(id)) return;
        }
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
    const id = parseTankIdFromScan(manual);
    if (id != null) resolveId(id);
    else setNotFoundId(manual);
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

        {notFoundId != null && (
          <div className="ts-notfound" role="alert">
            {`${casualModeActive ? "Tank" : "Unit"} #${notFoundId} isn't in your account.`}
          </div>
        )}

        {/* Manual fallback — always available */}
        <form className="ts-manual" onSubmit={submitManual}>
          <input
            type="text"
            inputMode="numeric"
            value={manual}
            onChange={(e) => { setManual(e.target.value); setNotFoundId(null); }}
            placeholder={`Or enter ${noun} number`}
            aria-label={`${casualModeActive ? "Tank" : "Unit"} number`}
          />
          <button type="submit" className="btn-primary" disabled={!manual.trim()}>Open</button>
        </form>
      </div>
    </div>
  );
}
