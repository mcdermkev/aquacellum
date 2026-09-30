import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Modal } from "../Modal";
import { publishTank } from "../../services/boothApi";
import { CONTAINMENT_TYPES } from "../../utils/tankUtils";
import {
  PRIVATE_LABEL_NOTE,
  readTankPublication,
  saveTankPublication,
  tankLabelTarget,
  tankPublicSnapshot,
  tankRefFor,
} from "../../utils/tankLabel";
import "./TankLabelDialog.css";

/**
 * TankLabelDialog — "Print label" for a tank in My Aquariums.
 *
 * A published tank's label opens its public `/t/<token>` page, which anyone can
 * read. An unpublished tank gets a choice, and nothing is published until the
 * owner presses Publish after seeing exactly what becomes public:
 *   - Publish a public page (the existing `publish-tank` call, no listings)
 *   - Print a private label (`/app#tank=<id>`, marked as owner-only)
 *
 * Steps: "choose" → "confirm" → "public", or "choose" → "private".
 */
export function TankLabelDialog({ isOpen, tank, walletAccount, casualModeActive = false, onClose, onNotify }) {
  const [publication, setPublication] = useState(() => readTankPublication(walletAccount, tank?.id));
  const initialTarget = tankLabelTarget(tank, publication);
  const [step, setStep] = useState(initialTarget.kind === "public" ? "public" : "choose");
  const [busy, setBusy] = useState(null); // null | "publish" | "unpublish" | "download"
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("");
  const [qrSrc, setQrSrc] = useState(null);
  const headingRef = useRef(null);
  const firstStep = useRef(true);

  const signedIn = !!walletAccount;
  const tankName = String(tank?.name || "").trim() || "this tank";
  const snapshot = useMemo(() => tankPublicSnapshot(tank), [tank]);

  const target = useMemo(() => {
    if (step === "public") return tankLabelTarget(tank, publication);
    if (step === "private") return tankLabelTarget(tank, null);
    return null;
  }, [step, tank, publication]);

  // Render the preview QR from the same URL the PDF will encode.
  useEffect(() => {
    let cancelled = false;
    setQrSrc(null);
    if (!target?.url) return undefined;
    QRCode.toDataURL(target.url, { width: 240, margin: 1, color: { dark: "#1e293b", light: "#ffffff" } })
      .then((src) => { if (!cancelled) setQrSrc(src); })
      .catch(() => { if (!cancelled) setQrSrc(null); });
    return () => { cancelled = true; };
  }, [target?.url]);

  // Move focus to the new step's heading so keyboard and screen reader users
  // land on what changed. The Modal handles the first focus on open.
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    headingRef.current?.focus();
  }, [step]);

  const go = (next) => { setError(null); setStep(next); };

  const sendPublish = async (isPublic) => {
    const data = await publishTank({
      tankRef: tankRefFor(tank),
      title: snapshot.title,
      specimens: snapshot.specimens,
      facts: snapshot.facts,
      listingIds: [],
      isPublic,
    });
    const saved = saveTankPublication(walletAccount, tank.id, { ...data, isPublic });
    if (!saved) throw new Error("The server did not return a public link. Try again.");
    return saved;
  };

  const handlePublish = async () => {
    if (!signedIn || busy) return;
    setBusy("publish");
    setError(null);
    try {
      const saved = await sendPublish(true);
      setPublication(saved);
      setStatus("Published. This label now opens the public page.");
      setStep("public");
    } catch (err) {
      setError(err?.message || "Could not publish the tank. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleUnpublish = async () => {
    if (!signedIn || busy) return;
    setBusy("unpublish");
    setError(null);
    try {
      const saved = await sendPublish(false);
      setPublication(saved);
      setStatus("The public page is down. Labels you already printed show a not found page until you publish again.");
      setStep("choose");
    } catch (err) {
      setError(err?.message || "Could not take the page down. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async () => {
    if (!target?.url || busy) return;
    setBusy("download");
    setError(null);
    try {
      const { generateTankQRLabel } = await import("../../utils/pdfExport");
      await generateTankQRLabel({
        tankId: tank.id,
        tankName: tank.name,
        facility: tank.facility,
        room: tank.room,
        rack: tank.rack,
        volumeLiters: tank.volumeLiters,
        containment: CONTAINMENT_TYPES[tank.containment],
        target,
      });
      if (typeof onNotify === "function") onNotify("Label downloaded. Print it at 100% scale.");
    } catch (err) {
      console.error("QR label generation failed:", err);
      setError("Could not make the label. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const volume = Number(snapshot.facts.volumeLiters);
  const sizeText = Number.isFinite(volume) && volume > 0 ? `${Math.round(volume / 3.78541)} gal · ${volume} L` : "";
  const typeAndSize = [snapshot.facts.tankType, sizeText].filter(Boolean).join(", ");
  const speciesNames = snapshot.specimens.map((s) => (s.scientificName && s.scientificName !== s.publicName ? `${s.publicName} (${s.scientificName})` : s.publicName));

  const headingId = `tlabel-heading-${tank?.id ?? "none"}`;

  return (
    <Modal isOpen={isOpen} onClose={busy ? () => {} : onClose} ariaLabel={`Print a label for ${tankName}`} className="tlabel-card" fullScreenMobile>
      <div className="tlabel">
        <div className="tlabel-head">
          <div className="tlabel-head-text">
            <p className="tlabel-kicker">{casualModeActive ? "Tank label" : "QR label"}</p>
            <h3 className="tlabel-title" id={headingId} ref={headingRef} tabIndex={-1}>
              {step === "confirm" ? "Publish a public page" : step === "public" ? "Public label" : step === "private" ? "Private label" : `Print a label for ${tankName}`}
            </h3>
          </div>
          <button type="button" className="tlabel-close" onClick={onClose} disabled={!!busy} aria-label="Close label dialog">
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <p className="tlabel-status" role="status" aria-live="polite">{status}</p>
        {error && <p className="tlabel-error" role="alert">{error}</p>}

        {!tank?.id && (
          <p className="tlabel-text">This tank has no id yet, so there is nothing for a label to open. Save the tank and try again.</p>
        )}

        {tank?.id && step === "choose" && (
          <>
            <p className="tlabel-text">Choose what the QR code opens when someone scans it.</p>
            <div className="tlabel-choices">
              <button
                type="button"
                className="tlabel-choice"
                onClick={() => go("confirm")}
                disabled={!signedIn}
                aria-describedby="tlabel-choice-public-desc"
              >
                <strong>Publish a public page for this tank</strong>
                <span id="tlabel-choice-public-desc">
                  {signedIn
                    ? "Anyone who scans the label sees this tank's page, with no app or account. Good for a fish room or a club."
                    : "Sign in to publish a public page. A private label works without signing in."}
                </span>
              </button>
              <button type="button" className="tlabel-choice" onClick={() => go("private")} aria-describedby="tlabel-choice-private-desc">
                <strong>Print a private label</strong>
                <span id="tlabel-choice-private-desc">
                  Opens this tank only in your app, on a device where you have it. Anyone else who scans it gets nothing.
                </span>
              </button>
            </div>
          </>
        )}

        {tank?.id && step === "confirm" && (
          <>
            <p className="tlabel-text">This is what anyone with the link or the QR code will see:</p>
            <dl className="tlabel-public-list">
              <div>
                <dt>Tank name</dt>
                <dd>{snapshot.title}</dd>
              </div>
              <div>
                <dt>What lives in it</dt>
                <dd>
                  {speciesNames.length
                    ? speciesNames.join(", ")
                    : "No species listed yet. The page will say the keeper hasn't listed the fish."}
                </dd>
              </div>
              {typeAndSize && (
                <div>
                  <dt>Tank type and size</dt>
                  <dd>{typeAndSize}</dd>
                </div>
              )}
            </dl>
            <p className="tlabel-note">
              Not shared: where the tank is (facility, room, rack), nicknames, notes, water tests, photos, prices, or your wallet address.
              The page is a copy of the list above as it is now; publish again later to update it. You can take it down from this dialog.
            </p>
            <div className="tlabel-actions">
              <button type="button" className="btn-secondary tlabel-btn" onClick={() => go("choose")} disabled={!!busy}>
                Back
              </button>
              <button type="button" className="btn-primary tlabel-btn" onClick={handlePublish} disabled={!signedIn || !!busy} aria-busy={busy === "publish"}>
                {busy === "publish" ? "Publishing…" : "Publish this page"}
              </button>
            </div>
          </>
        )}

        {tank?.id && (step === "public" || step === "private") && target && (
          <>
            <p className="tlabel-text">
              {target.kind === "public"
                ? "This label opens the tank's public page. Anyone who scans it can see it."
                : "This label opens the tank in your app only. It is for your own tanks, not for visitors."}
            </p>

            <figure className="tlabel-preview" aria-label="Label preview">
              <div className="tlabel-sheet">
                {qrSrc
                  ? <img className="tlabel-qr" src={qrSrc} alt={`QR code for ${target.shortUrl}`} />
                  : <div className="tlabel-qr tlabel-qr-empty" aria-hidden="true" />}
                {target.kind === "public" && <span className="tlabel-sheet-kicker">Scan to see this tank</span>}
                <span className="tlabel-sheet-name">{tank.name || "Aquarium"}</span>
                <span className="tlabel-sheet-meta">
                  {[CONTAINMENT_TYPES[tank.containment] || "Tank", Number(tank.volumeLiters) > 0 ? `${Number(tank.volumeLiters)}L` : ""].filter(Boolean).join(" • ")}
                </span>
                {target.kind === "private" && (
                  <>
                    {[tank.facility, tank.room, tank.rack].some((p) => String(p || "").trim()) && (
                      <span className="tlabel-sheet-meta">
                        {[tank.facility, tank.room, tank.rack].map((p) => String(p || "").trim()).filter(Boolean).join(" › ")}
                      </span>
                    )}
                    <span className="tlabel-sheet-id">ID: {tank.id}</span>
                  </>
                )}
                <span className="tlabel-sheet-url">{target.shortUrl}</span>
                {target.note && <span className="tlabel-sheet-note">{target.note}</span>}
              </div>
              <figcaption className="tlabel-note">Printed as a 2 by 3 inch PDF label.</figcaption>
            </figure>

            {target.kind === "public" && (
              <p className="tlabel-note">
                <a href={target.url} target="_blank" rel="noopener noreferrer">Open the public page</a> to check it before you print.
              </p>
            )}
            {target.kind === "private" && (
              <p className="tlabel-note">The label says, in small print: “{PRIVATE_LABEL_NOTE}”</p>
            )}

            <div className="tlabel-actions">
              {step === "private" && (
                <button type="button" className="btn-secondary tlabel-btn" onClick={() => go("choose")} disabled={!!busy}>
                  Back
                </button>
              )}
              {step === "public" && signedIn && (
                <button type="button" className="btn-secondary tlabel-btn" onClick={handleUnpublish} disabled={!!busy} aria-busy={busy === "unpublish"}>
                  {busy === "unpublish" ? "Taking it down…" : "Take the public page down"}
                </button>
              )}
              <button type="button" className="btn-primary tlabel-btn" onClick={handleDownload} disabled={!!busy || !target.url} aria-busy={busy === "download"}>
                {busy === "download" ? "Making the label…" : "Download label (PDF)"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default TankLabelDialog;
