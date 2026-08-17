import React, { useState, useEffect, useRef } from "react";
import { ethers, Contract, formatEther } from "ethers";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import managerAbi from "../abi/AquadexManager.json";
import { getProvider } from "../utils/smartAccount";
import { relayPurchaseBatch, relaySettleHandshake } from "../services/relayer";
import { normalizePriceCents, formatPriceCents } from "../services/catalogQuery";
import { useHandshake } from "../hooks/useHandshake";
import { db } from "../db";
import { awardXp, XP_ACTIONS } from "../utils/xp";

import { mapContractError } from "../utils/errorHandler";

export function HandshakeVerification({ 
  isOpen, 
  onClose, 
  listing, 
  quantity, 
  marketplaceAddress,
  walletAccount,
  onSuccess,
  // Task 19: the seller fulfillment queue opens this modal directly on the
  // "Breeder (Scan / Verify)" tab (a seller scanning a buyer's pickup/cash
  // code has no reason to land on the buyer tab first). Optional and
  // additive — every existing caller (HatcheryLogs, LocalBreederMap) omits
  // it and keeps the buyer-first default.
  defaultRole = "buyer",
}) {
  const { generateCommitment, updatePurchaseId, getPendingHandshake } = useHandshake();
  const [activeRole, setActiveRole] = useState(defaultRole === "breeder" ? "breeder" : "buyer"); // "buyer" | "breeder"
  const [step, setStep] = useState("pin-entry"); // "pin-entry" | "locking" | "qr-display"
  const [insideEventZone, setInsideEventZone] = useState(true);
  const [currentEventId, setCurrentEventId] = useState(1);
  const [isCashHandshake, setIsCashHandshake] = useState(false);
  const [cashHandshakePayload, setCashHandshakePayload] = useState(null);
  const [pin, setPin] = useState("");
  const [salt, setSalt] = useState("");
  const [purchaseId, setPurchaseId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  
  // Breeder scanning role state
  const [scanPin, setScanPin] = useState("");
  const [scanPurchaseId, setScanPurchaseId] = useState("");
  const [scanSalt, setScanSalt] = useState("");
  const [scanSuccess, setScanSuccess] = useState("");
  const [scanError, setScanError] = useState("");
  const [scannedPayload, setScannedPayload] = useState(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const dialogRef = useRef(null);

  // Task 21D a11y fix: this modal predated the shared accessible Modal
  // component and had no Escape-to-close or initial-focus handling — mirror
  // Modal.jsx's own behavior locally rather than migrating to <Modal> (this
  // component has camera/scan state that would need re-verifying against a
  // structural rewrite, which is out of scope for a hardening pass).
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const timer = setTimeout(() => dialogRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, onClose]);

  // If modal closes, reset states and camera stream
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setPin("");
      setSalt("");
      setPurchaseId(null);
      setStep("pin-entry");
      setError("");
      setScanPin("");
      setScanPurchaseId("");
      setScanSalt("");
      setScanSuccess("");
      setScanError("");
      setToast(null);
      setIsCashHandshake(false);
      setCashHandshakePayload(null);
      setScannedPayload(null);
    } else {
      // Re-apply the requested default role each time the modal opens, so a
      // caller that always wants the breeder scan tab (Task 19's seller
      // queue) doesn't get stuck on whatever tab was active last time.
      setActiveRole(defaultRole === "breeder" ? "breeder" : "buyer");
    }
  }, [isOpen, defaultRole]);

  // Handle active role tab changes
  useEffect(() => {
    if (activeRole === "breeder" && isOpen) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [activeRole, isOpen]);

  const startCamera = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }
    } catch (err) {
      console.warn("Camera access denied or unavailable, using mock interface fallback:", err);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  // Buyer locks escrow on-chain
  const handleLockEscrow = async (e) => {
    e.preventDefault();
    if (pin.length !== 4 || isNaN(Number(pin))) {
      setError("Please enter a valid 4-digit PIN");
      return;
    }

    try {
      setLoading(true);
      setError("");

      if (isCashHandshake) {
        // Cash Handshake Bypass Flow
        const payload = {
          type: "cash_handshake",
          buyer: walletAccount,
          listingId: listing.listingId,
          quantity: Number(quantity),
          pricePerFish: listing.price,
          seller: listing.seller,
          eventId: currentEventId,
          timestamp: Math.round(Date.now() / 1000)
        };

        // 1. Immediate local Dexie inventory deduction
        const dexieListing = await db.listings.get(listing.id);
        if (dexieListing) {
          const newQty = Number(dexieListing.quantity || 0) - Number(quantity);
          if (newQty <= 0) {
            await db.listings.delete(listing.id);
          } else {
            dexieListing.quantity = newQty;
            await db.listings.put(dexieListing);
          }
        }

        // 2. Increment analytics count & award the purchase.
        //
        // The hardcoded ×2 "LIVE EVENT DOUBLE LOYALTY REWARDS" is gone: it was
        // unconditional (no event was ever checked), and the label matched
        // `includes("handshake")` server-side, so the claim was rejected and rolled
        // back every time. Event multipliers are validated and applied server-side.
        localStorage.setItem("aquadex_cash_orders_count", Number(localStorage.getItem("aquadex_cash_orders_count") || 0) + Number(quantity));
        awardXp("CLAIM_EXCHANGE", { quantity: Number(quantity) });

        setCashHandshakePayload(payload);
        setStep("qr-display");
        setToast({ message: "Cash Handshake QR Generated!", type: "success" });

        const sellerAddress = listing.seller;
        if (onSuccess) {
          onSuccess(sellerAddress);
        }
        return;
      }

      setStep("locking");

      const price = Number(listing.price || 0);
      const qty = Number(quantity);

      // Generate the commitment hash and store the pre-image in Dexie using a temporary ID (listingId)
      const { commitmentHash, salt: generatedSalt } = await generateCommitment(listing.listingId, pin, walletAccount);
      setSalt(generatedSalt);

      // Beta: lock in-person batch order locally (no MetaMask, no gas)
      const result = await relayPurchaseBatch({
        listingId: listing.listingId,
        quantity: qty,
        buyer: walletAccount,
        seller: listing.seller || "",
        pricePerFishEth: listing.price || "0",
        commonName: listing.commonName || "Juvenile Fry Batch",
        fulfillmentType: 1, // in-person handshake
        // Capture the seller's sealed pedigree while the listing is in hand. This is
        // the only moment the buyer can (§9.25, T3 §2.6) — see relayPurchaseBatch.
        pedigreeDocument: listing.pedigreeDocument || null,
        pedigreeHash: listing.pedigreeHash || null,
        pedigreeChain: listing.pedigreeChain || [],
        lifeStage: listing.lifeStage || null,
        speciesId: listing.speciesId ?? null,
        scientificName: listing.scientificName || "",
      });
      if (!result.success) {
        throw new Error(result.error || "Could not lock holding deposit.");
      }

      const pId = result.purchaseId;

      // Update the cached pre-image in Dexie with the actual purchaseId
      await updatePurchaseId(listing.listingId, pId);

      setPurchaseId(pId);
      setStep("qr-display");
      setToast({ message: "Deposit secured — your payment is protected!", type: "success" });
      
      // Was a hand-rolled `aquadex_xp_added` event plus a direct
      // `localStorage.setItem("aquadex_xp", ...)`. That incremented one mirror while
      // `aquadex_xp_profile.points` — the number getXp() returns and the UI shows —
      // never moved, so the award was invisible in the place it mattered. The label
      // also matched no server rule, so the Dexie half was rejected and rolled back.
      awardXp("DEPOSIT_SECURED");

      const sellerAddress = listing.seller;
      if (onSuccess) {
        onSuccess(sellerAddress);
      }

    } catch (err) {
      console.error("Lock escrow error:", err);
      setError(mapContractError(err, false));
      setStep("pin-entry");
    } finally {
      setLoading(false);
    }
  };

  // Breeder verifies / releases funds on-chain using scanned credentials
  const handleVerifyRelease = async (e) => {
    e.preventDefault();
    if (!scanPurchaseId || !scanPin) {
      setScanError("Please enter both Order Serial No. and PIN");
      return;
    }

    try {
      setLoading(true);
      setScanError("");
      setScanSuccess("");

      // Resolve the salt either from the scanSalt state or by querying local Dexie store
      let finalSalt = scanSalt;
      if (!finalSalt) {
        const cached = await getPendingHandshake(scanPurchaseId);
        if (cached && cached.salt) {
          finalSalt = cached.salt;
        }
      }

      if (!finalSalt) {
        throw new Error("Handshake salt not found in local cache. Please scan the QR code containing the pre-image.");
      }

      // Beta: settle handshake locally (no MetaMask, no gas)
      const result = await relaySettleHandshake({ purchaseId: Number(scanPurchaseId) });
      if (!result.success) throw new Error(result.error || "Settlement failed");

      setScanSuccess(`Order Serial No. ${scanPurchaseId.padStart(3, "0")} settled successfully!`);
      setToast({ message: "Handshake verified and funds released!", type: "success" });
      
      // The seller side of a verified in-person pickup — which is exactly what
      // VERIFIED_PICKUP_SELLER is, at the same 25 points this hand-rolled event used.
      awardXp("VERIFIED_PICKUP_SELLER");

      if (onSuccess) {
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1500);
      }
    } catch (err) {
      console.error("Verification error:", err);
      setError(mapContractError(err, false));
    } finally {
      setLoading(false);
    }
  };

  const handleSettleCashHandshake = async () => {
    if (!scannedPayload) {
      setScanError("No valid Cash Handshake payload loaded");
      return;
    }

    try {
      setLoading(true);
      setScanError("");
      setScanSuccess("");

      let quantityToSettle;
      let isBatch = false;
      let tokenIds = [];

      if (scannedPayload.tokenIds) {
        tokenIds = scannedPayload.tokenIds;
      } else {
        isBatch = true;
        quantityToSettle = scannedPayload.quantity;
      }

      // Beta: settle cash handshake locally + mint lineage specimen (no MetaMask, no gas)
      if (isBatch) {
        setToast({ message: "Registering specimen birth certificate for cash lineage...", type: "success" });
        const result = await relaySettleHandshake({ purchaseId: Number(scannedPayload.listingId) });
        if (!result.success) throw new Error(result.error || "Settlement failed");
      } else {
        const result = await relaySettleHandshake({ tokenIds });
        if (!result.success) throw new Error(result.error || "Settlement failed");
      }

      setScanSuccess("Cash handshake settled and lineage provenance securely recorded!");
      setToast({ message: "Cash Handshake settled and recorded!", type: "success" });

      // A completed sale, per item settled.
      //
      // ⚠️ THIS IS A DELIBERATE AMOUNT CHANGE, and the only one in this pass. The old
      // value was `300 * quantity` under the label "⚡ LIVE EVENT CASH HANDSHAKE
      // COMPLETED" — 300 points per fish, double SPAWN_BREED, with no canonical action
      // behind it. It also never actually paid out: the label matched
      // `includes("handshake")`, resolving to VERIFIED_PICKUP_SELLER's 25 against a
      // claim of 300×N, so the server rejected it and the client rolled it back every
      // time. "Preserving" 300×N would therefore not preserve anything anyone has ever
      // received — it would newly inject the largest award in the game into the
      // economy. COMPLETED_SALE (40) is what genuinely happened here.
      const settledCount = isBatch ? quantityToSettle : tokenIds.length;
      awardXp("COMPLETED_SALE", { quantity: settledCount });

      if (onSuccess) {
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1500);
      }
    } catch (err) {
      console.error("Verification error:", err);
      setError(mapContractError(err, false));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const qrData = isCashHandshake && cashHandshakePayload
    ? JSON.stringify(cashHandshakePayload)
    : JSON.stringify({ purchaseId, pin, salt });
  const qrColor = isCashHandshake ? "10b981" : "f59e0b";
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&color=${qrColor}&bgcolor=0f172a&data=${encodeURIComponent(qrData)}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="In-person handshake verification"
      ref={dialogRef}
      tabIndex={-1}
      style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(3, 7, 18, 0.85)",
      backdropFilter: "blur(8px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
      padding: "1rem"
    }}>
      {toast && (
        <div style={{
          position: "absolute",
          top: "1.5rem",
          left: "1.5rem",
          right: "1.5rem",
          padding: "0.75rem 1rem",
          borderRadius: "6px",
          background: toast.type === "error" ? "rgba(239, 68, 68, 0.95)" : "rgba(16, 185, 129, 0.95)",
          color: "#fff",
          fontSize: "0.8rem",
          fontWeight: "600",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          backdropFilter: "blur(4px)",
          zIndex: 10000,
          border: toast.type === "error" ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid rgba(16, 185, 129, 0.3)"
        }}>
          <span>{toast.type === "error" ? "❌" : "✅"}</span>
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button onClick={() => setToast(null)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: "1rem", fontWeight: "700" }}>&times;</button>
        </div>
      )}
      <div 
        className="glass-card"
        style={{
          width: "480px",
          maxWidth: "100%",
          background: "rgba(15, 23, 42, 0.95)",
          border: "1px solid rgba(251, 191, 36, 0.2)",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.8), inset 0 0 20px rgba(251, 191, 36, 0.05)",
          borderRadius: "var(--radius-md)",
          padding: "1.75rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
          animation: "fadeIn 0.3s ease-out"
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ color: "#fff", fontSize: "1.25rem", fontWeight: "700", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ color: "var(--accent-amber)" }}>🤝</span> In-Person Handshake Verification
            </h2>
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Secure Local Holding Settle
            </span>
          </div>
          <button 
            onClick={onClose}
            aria-label="Close handshake verification"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "50%",
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = "#fff"}
            onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-muted)"}
          >
            ✕
          </button>
        </div>

        {/* Role Tabs */}
        <div style={{
          display: "flex",
          background: "rgba(0,0,0,0.3)",
          borderRadius: "6px",
          padding: "2px",
          border: "1px solid rgba(255,255,255,0.04)"
        }}>
          <button
            onClick={() => setActiveRole("buyer")}
            style={{
              flex: 1,
              padding: "0.5rem",
              fontSize: "0.8rem",
              fontWeight: "600",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              background: activeRole === "buyer" ? "rgba(251, 191, 36, 0.15)" : "transparent",
              color: activeRole === "buyer" ? "var(--accent-amber)" : "var(--text-muted)",
              transition: "all 0.2s"
            }}
          >
            Buyer (Get PIN / QR)
          </button>
          <button
            onClick={() => setActiveRole("breeder")}
            style={{
              flex: 1,
              padding: "0.5rem",
              fontSize: "0.8rem",
              fontWeight: "600",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              background: activeRole === "breeder" ? "rgba(251, 191, 36, 0.15)" : "transparent",
              color: activeRole === "breeder" ? "var(--accent-amber)" : "var(--text-muted)",
              transition: "all 0.2s"
            }}
          >
            Breeder (Scan / Verify)
          </button>
        </div>

        {/* Tab Content */}
        {activeRole === "buyer" ? (
          /* Buyer Flow */
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {step === "pin-entry" && (
              <form onSubmit={handleLockEscrow} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{
                  padding: "0.75rem 1rem",
                  borderRadius: "6px",
                  background: isCashHandshake ? "rgba(16, 185, 129, 0.03)" : "rgba(251, 191, 36, 0.03)",
                  border: isCashHandshake ? "1px solid rgba(16, 185, 129, 0.1)" : "1px solid rgba(251, 191, 36, 0.1)",
                  fontSize: "0.8rem",
                  color: "var(--text-secondary)"
                }}>
                  {/* This is the screen that tells someone what they are about to
                      pay, and BOTH branches were computing it from a hardcoded
                      1000:1 "ETH→USD" rate:

                        cash:   parseFloat(listing.price) * quantity * 1000
                        escrow: formatEther(pricePerFish * quantity) * 1000

                      `listing.price` is already dollars, so the cash line showed a
                      $25 fish as "$25,000.00". Aquadex settles in USD; there is no
                      exchange rate to apply. Both now use the canonical
                      marketplace formatter, and an unknown price says so instead of
                      quoting a confident wrong number. */}
                  {(() => {
                    const unitCents = normalizePriceCents(listing);
                    const totalCents = Number.isFinite(unitCents) ? unitCents * Number(quantity || 1) : 0;
                    const totalText = totalCents > 0 ? formatPriceCents(totalCents) : "the listed price";

                    return isCashHandshake ? (
                      <span>
                        🤝 <strong>Cash Handshake Mode</strong>: You are paying <strong>{totalText}</strong> directly to the breeder in cash. Establish a 4-digit PIN for tracking. Breeder will scan the QR code to log provenance.
                      </span>
                    ) : (
                      <span>
                        🔐 Your payment of <strong>{totalText}</strong> will be held securely until pickup is confirmed. Establish a 4-digit verification PIN. Give this PIN or the QR code to the breeder ONLY when you have the fish in hand.
                      </span>
                    );
                  })()}
                </div>

                {/* Gated Event Zone Check for Cash Handshake */}
                {(insideEventZone === true || !!currentEventId) ? (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem",
                    background: "rgba(16, 185, 129, 0.05)",
                    border: "1px solid rgba(16, 185, 129, 0.2)",
                    borderRadius: "4px"
                  }}>
                    <input 
                      type="checkbox" 
                      id="cash-handshake-verification-toggle"
                      checked={isCashHandshake}
                      onChange={(e) => setIsCashHandshake(e.target.checked)}
                      style={{ cursor: "pointer" }}
                    />
                    <label htmlFor="cash-handshake-verification-toggle" style={{ fontSize: "0.75rem", color: "#fff", cursor: "pointer", fontWeight: "600" }}>
                      🤝 Enable [ Cash Handshake ] Bypass
                    </label>
                  </div>
                ) : (
                  <div style={{
                    fontSize: "0.7rem",
                    color: "var(--text-muted)",
                    padding: "0.5rem",
                    background: "rgba(255, 255, 255, 0.02)",
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                    borderRadius: "4px",
                    textAlign: "center"
                  }}>
                    📍 Cash Handshake only available inside active live event zones.
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: "600" }}>4-Digit Handshake PIN</label>
                    <button 
                      type="button" 
                      onClick={() => {
                        const randomPin = Math.floor(1000 + Math.random() * 9000).toString();
                        setPin(randomPin);
                      }}
                      style={{
                        background: "rgba(251, 191, 36, 0.1)",
                        border: "1px solid rgba(251, 191, 36, 0.2)",
                        borderRadius: "4px",
                        fontSize: "0.65rem",
                        color: "var(--accent-amber)",
                        cursor: "pointer",
                        padding: "0.15rem 0.4rem"
                      }}
                    >
                      🎲 Generate Random PIN
                    </button>
                  </div>
                  <input 
                    type="text" 
                    maxLength={4}
                    placeholder="e.g. 1234"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    style={{
                      background: "rgba(0,0,0,0.3)",
                      border: "1px solid rgba(251, 191, 36, 0.2)",
                      borderRadius: "6px",
                      color: "#fff",
                      fontSize: "1.25rem",
                      fontWeight: "700",
                      padding: "0.75rem",
                      textAlign: "center",
                      letterSpacing: "0.5em",
                      outline: "none"
                    }}
                  />
                </div>

                {error && (
                  <div style={{ color: "#ef4444", fontSize: "0.75rem", textAlign: "center" }}>
                    ⚠️ {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary"
                  style={{
                    background: isCashHandshake ? "var(--accent-green)" : "var(--accent-amber)",
                    boxShadow: isCashHandshake ? "0 0 16px var(--accent-green-glow)" : "0 0 16px var(--accent-amber-glow)",
                    color: isCashHandshake ? "#fff" : "#0f172a",
                    fontWeight: "700",
                    padding: "0.75rem",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                >
                  {loading ? "Processing..." : isCashHandshake ? "Generate Cash Handshake QR" : "Secure Funds & Generate QR"}
                </button>
              </form>
            )}

            {step === "locking" && (
              <div style={{ textAlign: "center", padding: "2rem 0", display: "flex", flexDirection: "column", gap: "1rem", alignItems: "center" }}>
                <div style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "50%",
                  border: "3px solid rgba(251, 191, 36, 0.2)",
                  borderTopColor: "var(--accent-amber)",
                  animation: "spin 1s linear infinite"
                }} />
                <h4 style={{ color: "#fff", margin: 0 }}>Securing Holding Deposit...</h4>
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", maxWidth: "260px" }}>
                  Please confirm the transaction in your account to lock funds.
                </p>
              </div>
            )}

            {step === "qr-display" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.25rem", padding: "0.5rem 0" }}>
                <div style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(251, 191, 36, 0.3)",
                  borderRadius: "8px",
                  padding: "1rem",
                  boxShadow: "0 0 20px rgba(251, 191, 36, 0.1)"
                }}>
                  {/* Public QR API request with native SVG fallback */}
                  <img 
                    src={qrUrl} 
                    alt="Handshake Verification QR" 
                    style={{ display: "block", borderRadius: "4px", width: "200px", height: "200px" }}
                    onError={(e) => {
                      // Offline/Failed fallback (beautiful matrix design)
                      e.target.style.display = "none";
                      const parent = e.target.parentNode;
                      const fallback = document.createElement("div");
                      fallback.style.width = "200px";
                      fallback.style.height = "200px";
                      fallback.style.background = "linear-gradient(135deg, rgba(251,191,36,0.1) 0%, rgba(245,158,11,0.03) 100%)";
                      fallback.style.border = "2px dashed var(--accent-amber)";
                      fallback.style.display = "flex";
                      fallback.style.flexDirection = "column";
                      fallback.style.alignItems = "center";
                      fallback.style.justifyContent = "center";
                      fallback.style.gap = "0.5rem";
                      fallback.innerHTML = `<span style="font-size: 2rem;">📳</span><span style="font-size: 0.7rem; color: #fff; font-weight: 700; text-transform: uppercase;">Offline QR Mode</span>`;
                      parent.appendChild(fallback);
                    }}
                  />
                </div>

                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Handshake PIN</div>
                  <div style={{ fontSize: "2rem", fontWeight: "800", letterSpacing: "0.2em", color: "var(--accent-amber)", marginTop: "0.25rem" }}>
                    {pin}
                  </div>
                  <div style={{ fontSize: "0.65rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
                    Order Serial No.: <strong>#{purchaseId ? purchaseId.toString().padStart(3, "0") : ""}</strong>
                  </div>
                </div>

                <div style={{
                  padding: "0.5rem 1rem",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: "4px",
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  textAlign: "center"
                }}>
                  Show this screen to the breeder. When they enter/scan the details, the secure registry settles funds to them.
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Breeder Scanner Flow */
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ position: "relative", width: "100%", height: "180px", borderRadius: "8px", overflow: "hidden", background: "#020617", border: "1px solid rgba(255,255,255,0.06)" }}>
              {/* Mock camera stream */}
              <video 
                ref={videoRef}
                autoPlay 
                playsInline
                style={{ width: "100%", height: "100%", objectFit: "cover", opacity: streamRef.current ? 0.8 : 0.2 }}
              />
              
              {/* Scan overlay grid */}
              <div style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                <div style={{
                  width: "120px",
                  height: "120px",
                  border: "2px solid var(--accent-amber)",
                  borderRadius: "6px",
                  boxShadow: "0 0 0 1000px rgba(0,0,0,0.6)",
                  position: "relative"
                }}>
                  {/* Pulsing neon scan line */}
                  <div style={{
                    position: "absolute",
                    left: 0,
                    width: "100%",
                    height: "2px",
                    background: "var(--accent-amber)",
                    boxShadow: "0 0 8px var(--accent-amber-glow)",
                    top: "10%",
                    animation: "radarScan 2s linear infinite"
                  }} />
                </div>
              </div>

              {!streamRef.current && (
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  gap: "0.25rem",
                  zIndex: 3
                }}>
                  <span style={{ fontSize: "1.5rem" }}>📷</span>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Simulated Scanner Active</span>
                </div>
              )}
            </div>

            {/* Manual Verification Form */}
            <form onSubmit={handleVerifyRelease} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <label style={{ fontSize: "0.7rem", color: "var(--text-secondary)", fontWeight: "600" }}>Order Serial No.</label>
                  <input 
                    type="text"
                    placeholder="e.g. 002"
                    value={scanPurchaseId}
                    onChange={(e) => setScanPurchaseId(e.target.value.replace(/\D/g, ""))}
                    style={{
                      background: "rgba(0,0,0,0.3)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "6px",
                      color: "#fff",
                      fontSize: "0.85rem",
                      padding: "0.5rem 0.75rem",
                      outline: "none"
                    }}
                  />
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <label style={{ fontSize: "0.7rem", color: "var(--text-secondary)", fontWeight: "600" }}>Handshake PIN</label>
                  <input 
                    type="text"
                    maxLength={4}
                    placeholder="4-digit PIN"
                    value={scanPin}
                    onChange={(e) => setScanPin(e.target.value.replace(/\D/g, ""))}
                    style={{
                      background: "rgba(0,0,0,0.3)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "6px",
                      color: "#fff",
                      fontSize: "0.85rem",
                      padding: "0.5rem 0.75rem",
                      textAlign: "center",
                      letterSpacing: "0.2em",
                      outline: "none"
                    }}
                  />
                </div>
              </div>

              {/* Developer Verification Helper for Localhost */}
              <div style={{
                padding: "0.5rem 0.75rem",
                borderRadius: "4px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.04)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                  💡 Test simulation mode
                </span>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {pin && purchaseId && (
                    <button 
                      type="button"
                      onClick={() => {
                        setScanPurchaseId(purchaseId.toString());
                        setScanPin(pin);
                        setScanSalt(salt);
                      }}
                      style={{
                        background: "rgba(251, 191, 36, 0.1)",
                        border: "1px solid rgba(251, 191, 36, 0.2)",
                        borderRadius: "4px",
                        fontSize: "0.65rem",
                        color: "var(--accent-amber)",
                        cursor: "pointer",
                        padding: "0.15rem 0.4rem"
                      }}
                    >
                      Auto-Fill Current Buy
                    </button>
                  )}
                  {isCashHandshake && cashHandshakePayload && (
                    <button 
                      type="button"
                      onClick={() => {
                        setScannedPayload(cashHandshakePayload);
                        setScanSuccess("Cash Handshake payload auto-filled!");
                      }}
                      style={{
                        background: "rgba(16, 185, 129, 0.1)",
                        border: "1px solid rgba(16, 185, 129, 0.2)",
                        borderRadius: "4px",
                        fontSize: "0.65rem",
                        color: "var(--accent-green)",
                        cursor: "pointer",
                        padding: "0.15rem 0.4rem"
                      }}
                    >
                      Auto-Fill Cash Handshake
                    </button>
                  )}
                </div>
              </div>

              {/* Paste QR JSON Payload */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <label style={{ fontSize: "0.7rem", color: "var(--text-secondary)", fontWeight: "600" }}>Or Scan/Paste QR JSON Payload</label>
                <textarea 
                  placeholder='{"type":"cash_handshake",...}'
                  value={scannedPayload ? JSON.stringify(scannedPayload) : ""}
                  onChange={(e) => {
                    if (!e.target.value) {
                      setScannedPayload(null);
                      return;
                    }
                    try {
                      const parsed = JSON.parse(e.target.value);
                      if (parsed && parsed.type === "cash_handshake") {
                        setScannedPayload(parsed);
                        setScanError("");
                        setScanSuccess("Valid Cash Handshake payload loaded!");
                      } else {
                        setScanError("Invalid payload type");
                        setScannedPayload(null);
                      }
                    } catch (err) {
                      setScanError("Invalid JSON format");
                      setScannedPayload(null);
                    }
                  }}
                  style={{
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "6px",
                    color: "#fff",
                    fontSize: "0.75rem",
                    padding: "0.5rem",
                    outline: "none",
                    height: "60px",
                    fontFamily: "monospace",
                    resize: "none"
                  }}
                />
              </div>

              {scanError && (
                <div style={{ color: "#ef4444", fontSize: "0.75rem", textAlign: "center" }}>
                  ⚠️ {scanError}
                </div>
              )}

              {scanSuccess && (
                <div style={{ color: "#10b981", fontSize: "0.75rem", textAlign: "center" }}>
                  ✅ {scanSuccess}
                </div>
              )}

              {scannedPayload && scannedPayload.type === "cash_handshake" ? (
                <button
                  type="button"
                  onClick={handleSettleCashHandshake}
                  disabled={loading}
                  className="btn-primary"
                  style={{
                    background: "var(--accent-green)",
                    boxShadow: "0 0 16px var(--accent-green-glow)",
                    color: "#fff",
                    fontWeight: "700",
                    padding: "0.65rem",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                >
                  {loading ? "Settling Cash Handshake..." : "🤝 Settle Cash Handshake"}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary"
                  style={{
                    background: "var(--accent-blue)",
                    boxShadow: "0 0 16px var(--accent-blue-glow)",
                    color: "#fff",
                    fontWeight: "700",
                    padding: "0.65rem",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                >
                  {loading ? "Releasing..." : "Verify & Settle Funds"}
                </button>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
