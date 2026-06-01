import React, { useState, useEffect, useRef } from "react";
import { ethers, Contract, formatEther } from "ethers";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import managerAbi from "../abi/AquadexManager.json";
import { getProvider, getSigner } from "../utils/smartAccount";
import { useHandshake } from "../hooks/useHandshake";
import { db } from "../db";
import { addXp, XP_ACTIONS } from "../utils/xp";

import { mapContractError } from "../utils/errorHandler";

export function HandshakeVerification({ 
  isOpen, 
  onClose, 
  listing, 
  quantity, 
  marketplaceAddress,
  walletAccount,
  onSuccess 
}) {
  const { generateCommitment, updatePurchaseId, getPendingHandshake } = useHandshake();
  const [activeRole, setActiveRole] = useState("buyer"); // "buyer" | "breeder"
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
    }
  }, [isOpen]);

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

        // 2. Increment analytics count & grant loyalty double XP
        localStorage.setItem("aquadex_cash_orders_count", Number(localStorage.getItem("aquadex_cash_orders_count") || 0) + Number(quantity));
        addXp(XP_ACTIONS.CLAIM_EXCHANGE.points * 2 * Number(quantity), `⚡ LIVE EVENT DOUBLE LOYALTY REWARDS (Cash Handshake checkout)`);

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

      const signer = await getSigner();
      const marketplaceContract = new Contract(marketplaceAddress, marketplaceAbi, signer);

      const price = BigInt(listing.pricePerFish);
      const qty = BigInt(quantity);
      const totalCost = price * qty;

      // Generate the commitment hash and store the pre-image in Dexie using a temporary ID (listingId)
      const { commitmentHash, salt: generatedSalt } = await generateCommitment(listing.listingId, pin, walletAccount);
      setSalt(generatedSalt);

      const tx = await marketplaceContract.purchaseInPerson(listing.listingId, qty, commitmentHash, {
        value: totalCost
      });
      const receipt = await tx.wait();

      // Find the BatchPurchased event to extract the purchaseId
      const event = receipt.logs
        .map(log => {
          try { return marketplaceContract.interface.parseLog(log); } catch (err) { return null; }
        })
        .find(e => e && e.name === "BatchPurchased");

      const pId = event ? Number(event.args.purchaseId) : null;
      if (!pId) {
        throw new Error("Could not parse Order ID from transaction events.");
      }

      // Update the cached pre-image in Dexie with the actual purchaseId
      await updatePurchaseId(listing.listingId, pId);

      setPurchaseId(pId);
      setStep("qr-display");
      setToast({ message: "Holding deposit secured in escrow!", type: "success" });
      
      // Dispatch XP event for locking escrow (local-first rank system)
      const xpEvent = new CustomEvent("aquadex_xp_added", {
        detail: {
          points: 15,
          label: "Holding Deposit Secured (In-Person)",
          newXp: Number(localStorage.getItem("aquadex_xp") || 0) + 15,
          levelChanged: false
        }
      });
      window.dispatchEvent(xpEvent);
      localStorage.setItem("aquadex_xp", Number(localStorage.getItem("aquadex_xp") || 0) + 15);

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

      const signer = await getSigner();
      const marketplaceContract = new Contract(marketplaceAddress, marketplaceAbi, signer);

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

      const tx = await marketplaceContract.secureInPersonRelease(Number(scanPurchaseId), Number(scanPin), finalSalt);
      await tx.wait();

      setScanSuccess(`Order Serial No. ${scanPurchaseId.padStart(3, "0")} settled successfully!`);
      setToast({ message: "Handshake verified and funds released!", type: "success" });
      
      // Dispatch XP event for Breeder
      const xpEvent = new CustomEvent("aquadex_xp_added", {
        detail: {
          points: 25,
          label: "Handshake Order Settled",
          newXp: Number(localStorage.getItem("aquadex_xp") || 0) + 25,
          levelChanged: false
        }
      });
      window.dispatchEvent(xpEvent);
      localStorage.setItem("aquadex_xp", Number(localStorage.getItem("aquadex_xp") || 0) + 25);

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

      const signer = await getSigner();
      const marketplaceContract = new Contract(marketplaceAddress, marketplaceAbi, signer);
      const managerAddress = await marketplaceContract.aquadexManager();
      const managerContract = new Contract(managerAddress, managerAbi, signer);

      let spawnId, speciesId, listingId, quantityToSettle;
      let isBatch = false;
      let tokenIds = [];

      if (scannedPayload.tokenIds) {
        tokenIds = scannedPayload.tokenIds;
      } else {
        isBatch = true;
        listingId = scannedPayload.listingId;
        quantityToSettle = scannedPayload.quantity;
        
        // Fetch listing info from registry
        const batch = await marketplaceContract.batchListings(listingId);
        spawnId = Number(batch.spawnId);
        const spawn = await managerContract.spawnLogs(spawnId);
        speciesId = Number(spawn.speciesId);
      }

      if (isBatch) {
        // Breeder first registers spawn offspring on AquadexManager to mint
        const birthTimestamp = Math.round(Date.now() / 1000);
        const ipfsMetadataUri = `ipfs://cash-spawn-${spawnId}-${Date.now()}`;
        
        setToast({ message: "Registering specimen birth certificate for cash lineage...", type: "success" });
        const mintTx = await managerContract.registerSpawnOffspring(spawnId, speciesId, birthTimestamp, ipfsMetadataUri);
        const mintReceipt = await mintTx.wait();
        
        const mintEvent = mintReceipt.logs
          .map(log => {
            try { return managerContract.interface.parseLog(log); } catch (e) { return null; }
          })
          .find(e => e && e.name === "SpecimenRegistered");
          
        const tokenId = mintEvent ? Number(mintEvent.args.tokenId) : null;
        if (!tokenId) {
          throw new Error("Could not parse Certified Registry Serial Number from specimen registration event.");
        }
        
        setToast({ message: `Minted specimen Token #${tokenId}. Settling cash handshake...`, type: "success" });
        const tx = await marketplaceContract.fulfillCashHandshake(
          tokenId,
          scannedPayload.buyer,
          Number(scannedPayload.eventId || 1),
          false, // fromEscrow = false
          listingId,
          quantityToSettle
        );
        await tx.wait();
      } else {
        // Single specimen listings
        for (const tokenId of tokenIds) {
          setToast({ message: `Settling cash handshake for Token #${tokenId}...`, type: "success" });
          const tx = await marketplaceContract.fulfillCashHandshake(
            tokenId,
            scannedPayload.buyer,
            Number(scannedPayload.eventId || 1),
            true, // fromEscrow = true
            0,
            0
          );
          await tx.wait();
        }
      }

      setScanSuccess("Cash handshake settled and lineage provenance securely recorded!");
      setToast({ message: "Cash Handshake settled and recorded!", type: "success" });

      // Breeder XP telemetry split
      const breederXp = 300 * (isBatch ? quantityToSettle : tokenIds.length);
      const xpEvent = new CustomEvent("aquadex_xp_added", {
        detail: {
          points: breederXp,
          label: "⚡ LIVE EVENT CASH HANDSHAKE COMPLETED (Provenance Logged)",
          newXp: Number(localStorage.getItem("aquadex_xp") || 0) + breederXp,
          levelChanged: false
        }
      });
      window.dispatchEvent(xpEvent);
      localStorage.setItem("aquadex_xp", Number(localStorage.getItem("aquadex_xp") || 0) + breederXp);

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
    <div style={{
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
                  {isCashHandshake ? (
                    <span>
                      🤝 <strong>Cash Handshake Bypass Mode</strong>: You are bypassing the standard escrow lock. Settle the cash amount of <strong>${(parseFloat(listing.price) * quantity * 1000).toFixed(2)}</strong> directly with the breeder. Establish a 4-digit PIN for tracking. Breeder will scan the QR code to log provenance.
                    </span>
                  ) : (
                    <span>
                      🔐 You are locking <strong>${(parseFloat(formatEther(BigInt(listing.pricePerFish) * BigInt(quantity))) * 1000).toFixed(2)}</strong> in secure holding. Establish a 4-digit verification PIN. Give this PIN or the QR code to the breeder ONLY when you have the fish in hand.
                    </span>
                  )}
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
