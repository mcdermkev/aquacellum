import React, { useRef, useEffect } from "react";
import QRCode from "qrcode";

/**
 * TankQRCode — Renders a small inline QR code for a tank's deep-link URL.
 * Used in the tank detail panel header as a scannable identifier.
 */
export function TankQRCode({ tankId, size = 40 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
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
