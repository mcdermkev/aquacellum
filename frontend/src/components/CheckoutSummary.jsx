import React, { useState, useEffect } from "react";
import { ethers, Contract, formatEther, parseEther } from "ethers";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import managerAbi from "../abi/AquadexManager.json";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { getProvider, getSigner } from "../utils/smartAccount";
import { fetchListingsByBreed } from "../utils/listingManager";
import { useHandshake } from "../hooks/useHandshake";
import { db } from "../db";

const ESCROW_STATES = ["LOCKED", "RELEASED", "REFUNDED"];
const SHIPPING_STATUSES = ["LOCKED", "DISPATCHED", "RELEASED", "DISPUTED", "REFUNDED"];

const mapContractError = (err, isCasual) => {
  const errStr = (err.reason || err.message || err.data?.message || "").toLowerCase();
  
  if (errStr.includes("maxbatchexceeded") || errStr.includes("batchquantityexceeded")) {
    return isCasual 
      ? "Whoops! To ensure safe transport, you can only bundle up to 6 fish per order. Let's split this into two boxes!" 
      : "Security Protocol: Shipping box allocation limits reached. Consolidate current queue or initialize a secondary transport manifest (Max 6 specimens per batch).";
  }
  if (errStr.includes("safetywindownotelapsed") || errStr.includes("escrowlocked") || errStr.includes("escrownotdispatched")) {
    return "Security Notice: This specimen is safely secured in transit escrow protection. Custody transfer controls unlock automatically once the standard transit safety window closes.";
  }
  if (errStr.includes("invalidcommitment")) {
    return "Verification Fault: Handshake security tokens or PIN parameters do not match. Please re-scan the secure handshake voucher.";
  }
  
  return isCasual 
    ? "Oops, something went wrong with the transaction. Please try again."
    : (err.reason || err.message || "Transaction failed.");
};

export function CheckoutSummary({ 
  contractAddress, 
  marketplaceAddress, 
  walletAccount,
  preselectedOrderForCheckout,
  clearPreselectedOrder,
  displayTank,
  casualModeActive = false
}) {
  const { getPendingHandshake } = useHandshake();
  const [purchases, setPurchases] = useState([]);
  const [shippingEscrows, setShippingEscrows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentLocation, setCurrentLocation] = useState({ isInsideEventZone: true });
  const [insideEventZone, setInsideEventZone] = useState(true);
  
  // Selected order details
  const [selectedOrder, setSelectedOrder] = useState(null); // { type: "batch" | "shipping", data: ... }
  const [pinInput, setPinInput] = useState("");
  const [trackingInput, setTrackingInput] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [actionTx, setActionTx] = useState(null);
  
  // Curator state
  const [isCurator, setIsCurator] = useState(false);

  // Consolidated Checkout Cart States
  const [pendingTokenIds, setPendingTokenIds] = useState([]);
  const [allActiveListings, setAllActiveListings] = useState([]);
  const [fishbaseLookup, setFishbaseLookup] = useState({});
  const [fishbaseData, setFishbaseData] = useState([]);

  // Cash Handshake States
  const [isCashHandshake, setIsCashHandshake] = useState(false);
  const [cashHandshakePayload, setCashHandshakePayload] = useState(null);
  const [currentEventId, setCurrentEventId] = useState(1);

  useEffect(() => {
    if (preselectedOrderForCheckout && !loading) {
      const { type, id } = preselectedOrderForCheckout;
      if (type === "pending_purchase") {
        const tokenIdNum = Number(id);
        if (!pendingTokenIds.includes(tokenIdNum)) {
          setPendingTokenIds(prev => [...prev, tokenIdNum]);
        }
      } else if (type === "shipping") {
        const match = shippingEscrows.find(o => Number(o.tokenId) === Number(id));
        if (match) {
          setSelectedOrder({ type: "shipping", data: match });
        }
      } else if (type === "batch") {
        const match = purchases.find(o => Number(o.purchaseId) === Number(id));
        if (match) {
          setSelectedOrder({ type: "batch", data: match });
        }
      }
      if (clearPreselectedOrder) {
        clearPreselectedOrder();
      }
    }
  }, [preselectedOrderForCheckout, loading, shippingEscrows, purchases, clearPreselectedOrder, pendingTokenIds]);

  useEffect(() => {
    fetch("/fishbase_master.json")
      .then((res) => {
        if (!res.ok) throw new Error("Reference data load failed");
        return res.json();
      })
      .then((data) => {
        const lookup = {};
        data.forEach((item) => {
          lookup[item.scientificName.toLowerCase()] = item.tankMetrics;
        });
        setFishbaseLookup(lookup);
        setFishbaseData(data);
      })
      .catch((err) => console.error("Error loading fishbase reference:", err));
  }, []);

  const loadAllListings = async () => {
    if (!walletAccount || !marketplaceAddress) return;
    try {
      const provider = getProvider();
      const listingsData = await fetchListingsByBreed(null, contractAddress, marketplaceAddress, provider);
      setAllActiveListings(listingsData);
    } catch (e) {
      console.error("Failed to load active listings in CheckoutSummary:", e);
    }
  };

  useEffect(() => {
    loadAllListings();
  }, [contractAddress, marketplaceAddress, walletAccount]);

  const calculateCompatibility = (item) => {
    if (!displayTank) return 0;
    const nameKey = item.scientificName ? item.scientificName.toLowerCase() : "";
    const metrics = fishbaseLookup[nameKey];
    const minVol = metrics?.minVolumeGallons ?? 30;

    const simVolume = Number(displayTank.volume);
    const simPh = Number(displayTank.ph);
    const simTemp = Number(displayTank.temp);

    let pVol = 0;
    if (simVolume < minVol) {
      pVol = ((minVol - simVolume) / minVol) * 100;
    }

    let pPh = 0;
    if (simPh < item.minPh) {
      pPh = ((item.minPh - simPh) / 1.5) * 100;
    } else if (simPh > item.maxPh) {
      pPh = ((simPh - item.maxPh) / 1.5) * 100;
    }
    pPh = Math.min(100, pPh);

    let pTemp = 0;
    if (simTemp < item.minTemp) {
      pTemp = ((item.minTemp - simTemp) / 5.0) * 100;
    } else if (simTemp > item.maxTemp) {
      pTemp = ((simTemp - item.maxTemp) / 5.0) * 100;
    }
    pTemp = Math.min(100, pTemp);

    const sVol = Math.max(0, 100 - pVol);
    const sPh = Math.max(0, 100 - pPh);
    const sTemp = Math.max(0, 100 - pTemp);

    const rawScore = (sVol / 100) * (sPh / 100) * (sTemp / 100) * 100;
    return Math.round(rawScore);
  };

  const handleConsolidatedCheckout = async () => {
    if (pendingTokenIds.length === 0) return;
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const signer = await getSigner();
      const marketContract = new Contract(marketplaceAddress, marketplaceAbi, signer);

      const firstId = pendingTokenIds[0];
      const firstListing = allActiveListings.find(l => Number(l.tokenId) === firstId);
      if (!firstListing) throw new Error("First listing not found in active listings");

      const seller = firstListing.seller;
      const consolidatedShippingFee = parseEther(firstListing.shippingFee);

      let totalSubtotal = 0n;
      for (const tid of pendingTokenIds) {
        const item = allActiveListings.find(l => Number(l.tokenId) === tid);
        if (!item) throw new Error(`Listing not found for token ${tid}`);
        if (item.seller.toLowerCase() !== seller.toLowerCase()) {
          throw new Error("All items in consolidated checkout must be from the same seller");
        }
        totalSubtotal += parseEther(item.price);
      }

      const totalCostWei = totalSubtotal + consolidatedShippingFee;

      const tx = await marketContract.purchaseMultipleSpecimens(pendingTokenIds, {
        value: totalCostWei
      });

      setActionTx(tx.hash);
      await tx.wait();

      addXp(XP_ACTIONS.CLAIM_EXCHANGE.points * pendingTokenIds.length, `Consolidated checkout: ${pendingTokenIds.length} specimens`);

      setPendingTokenIds([]);
      await fetchOrders();
      await loadAllListings();
    } catch (err) {
      console.error("Consolidated checkout failed:", err);
      setActionError(mapContractError(err, casualModeActive));
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  const handleCashCheckout = async () => {
    if (pendingTokenIds.length === 0) return;
    setActionLoading(true);
    setActionError(null);

    try {
      const firstId = pendingTokenIds[0];
      const firstListing = allActiveListings.find(l => Number(l.tokenId) === firstId);
      if (!firstListing) throw new Error("First listing not found in active listings");
      const seller = firstListing.seller;

      // 1. Generate payload
      const payload = {
        type: "cash_handshake",
        buyer: walletAccount,
        tokenIds: [...pendingTokenIds],
        seller: seller,
        totalCost: totalCost,
        eventId: currentEventId,
        timestamp: Math.round(Date.now() / 1000)
      };

      // 2. Immediate local Dexie inventory deduction
      for (const tid of pendingTokenIds) {
        await db.listings.delete(tid);
      }

      // 3. Increment analytics count & grant loyalty double XP
      localStorage.setItem("aquadex_cash_orders_count", Number(localStorage.getItem("aquadex_cash_orders_count") || 0) + pendingTokenIds.length);
      addXp(XP_ACTIONS.CLAIM_EXCHANGE.points * 2 * pendingTokenIds.length, `⚡ LIVE EVENT DOUBLE LOYALTY REWARDS (Cash Handshake checkout)`);

      // 4. Save payload to open QR Modal
      setCashHandshakePayload(payload);

      // 5. Clear cart & update local views
      setPendingTokenIds([]);
      await fetchOrders();
      await loadAllListings();
    } catch (err) {
      console.error("Cash checkout failed:", err);
      setActionError(mapContractError(err, casualModeActive));
    } finally {
      setActionLoading(false);
    }
  };

  const fetchOrders = async () => {
    if (!walletAccount || !marketplaceAddress) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setActionError(null);

      const provider = getProvider();
      const marketContract = new Contract(marketplaceAddress, marketplaceAbi, provider);
      const managerContract = new Contract(contractAddress, managerAbi, provider);

      // Check if user is curator
      try {
        const curatorAddr = await managerContract.curator();
        setIsCurator(curatorAddr.toLowerCase() === walletAccount.toLowerCase());
      } catch (e) {
        console.warn("Failed to check curator status:", e);
      }

      // Discover orders. Since Solidity mappings are not enumerable, we can search recent IDs.
      // For shipping escrows: they are indexed by tokenId. We can search from tokenId = 1 to totalSpecimensMinted.
      // For batch purchases: they are indexed by purchaseId. We can search from 1 to a reasonable upper bound or read events.
      // We will loop to read from 1 up to a small limit for local testing.
      const totalSpecimens = Number(await managerContract.totalSpecimensMinted());
      
      // Load shipping escrows
      const fetchedShipping = [];
      for (let i = 1; i <= totalSpecimens; i++) {
        try {
          const esc = await marketContract.shippingEscrows(i);
          if (esc.buyer !== "0x0000000000000000000000000000000000000000") {
            // Check if user is buyer or seller
            const isBuyer = esc.buyer.toLowerCase() === walletAccount.toLowerCase();
            const isSeller = esc.seller.toLowerCase() === walletAccount.toLowerCase();
            if (isBuyer || isSeller || isCurator) {
              // Fetch species name
              const spec = await managerContract.specimens(i);
              const species = await managerContract.speciesCatalog(Number(spec.speciesId));
              fetchedShipping.push({
                tokenId: i,
                buyer: esc.buyer,
                seller: esc.seller,
                price: formatEther(esc.price),
                shippingFee: formatEther(esc.shippingFee),
                amountLocked: formatEther(esc.amountLocked),
                trackingNumber: esc.trackingNumber,
                dispatchTimestamp: Number(esc.dispatchTimestamp),
                status: Number(esc.status),
                commonName: species.commonName,
                role: isBuyer ? "Buyer" : isSeller ? "Seller" : "Curator"
              });
            }
          }
        } catch (e) {}
      }

      // Load batch purchases (e.g. search purchaseId from 1 to 50 for local nodes)
      const fetchedBatches = [];
      for (let i = 1; i <= 50; i++) {
        try {
          const purch = await marketContract.escrowPurchases(i);
          if (purch.buyer !== "0x0000000000000000000000000000000000000000") {
            const isBuyer = purch.buyer.toLowerCase() === walletAccount.toLowerCase();
            
            // Get listing details to find seller
            const listing = await marketContract.batchListings(purch.listingId);
            const isSeller = listing.seller.toLowerCase() === walletAccount.toLowerCase();

            if (isBuyer || isSeller || isCurator) {
              // Resolve breed info from spawn records
              let commonName = "Juvenile Fry Batch";
              try {
                const spawnRec = await managerContract.spawnRecords(listing.spawnId);
                // Sire species
                const sireSpec = await managerContract.specimens(Number(spawnRec.sireId || 1));
                const species = await managerContract.speciesCatalog(Number(sireSpec.speciesId));
                commonName = `${species.commonName} Fry`;
              } catch (e) {}

              fetchedBatches.push({
                purchaseId: i,
                listingId: Number(purch.listingId),
                buyer: purch.buyer,
                seller: listing.seller,
                quantity: Number(purch.quantity),
                amountLocked: formatEther(purch.amountLocked),
                state: Number(purch.state),
                fulfillmentType: Number(purch.fulfillmentType),
                commonName,
                role: isBuyer ? "Buyer" : isSeller ? "Seller" : "Curator"
              });
            }
          }
        } catch (e) {
          break; // Stop querying if it errors out or goes out of bounds
        }
      }

      setShippingEscrows(fetchedShipping);
      setPurchases(fetchedBatches);
    } catch (err) {
      console.error("Error reading orders:", err);
      setError("Failed to fetch order tracking details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [contractAddress, marketplaceAddress, walletAccount]);

  const handleKeypadPress = (val) => {
    if (val === "C") {
      setPinInput("");
    } else if (val === "⌫") {
      setPinInput(prev => prev.slice(0, -1));
    } else if (pinInput.length < 4) {
      setPinInput(prev => prev + val);
    }
  };

  // Secure local release with PIN (Seller calls)
  const handleInPersonReleaseSubmit = async () => {
    if (pinInput.length !== 4) return;
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const signer = await getSigner();
      const marketContract = new Contract(marketplaceAddress, marketplaceAbi, signer);

      const handshake = await getPendingHandshake(selectedOrder.data.purchaseId);
      const salt = handshake ? handshake.salt : null;
      if (!salt) {
        throw new Error("Handshake salt not found in local cache. Breeder must scan the QR code or ensure the pre-image is persisted.");
      }

      const tx = await marketContract.secureInPersonRelease(selectedOrder.data.purchaseId, Number(pinInput), salt);
      setActionTx(tx.hash);
      await tx.wait();

      const baseXp = XP_ACTIONS.CLAIM_EXCHANGE.points;
      const isInsideEventZone = insideEventZone === true || !!currentEventId;
      const finalXp = isInsideEventZone ? baseXp * 2 : baseXp;
      const finalLabel = isInsideEventZone 
        ? "⚡ LIVE EVENT DOUBLE LOYALTY REWARDS UNLOCKED!" 
        : "Verified In-Person Handshake";

      addXp(finalXp, finalLabel);
      
      setPinInput("");
      setSelectedOrder(null);
      await fetchOrders();
    } catch (err) {
      console.error("PIN release failed:", err);
      const isInvalidCredentials = 
        (err.message && err.message.includes("Invalid verification credentials")) || 
        (err.reason && err.reason.includes("Invalid verification credentials")) ||
        (err.data && err.data.message && err.data.message.includes("Invalid verification credentials"));
        
      if (isInvalidCredentials) {
        setActionError("Invalid verification credentials: The PIN or salt does not match the buyer's commitment.");
      } else {
        setActionError(mapContractError(err, casualModeActive));
      }
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  // Dispatch Shipping (Seller calls)
  const handleDispatchShipping = async () => {
    if (!trackingInput) return;
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const signer = await getSigner();
      const marketContract = new Contract(marketplaceAddress, marketplaceAbi, signer);

      const tx = await marketContract.dispatchShipping(selectedOrder.data.tokenId, trackingInput);
      setActionTx(tx.hash);
      await tx.wait();

      setTrackingInput("");
      setSelectedOrder(null);
      await fetchOrders();
    } catch (err) {
      console.error("Dispatch shipping failed:", err);
      setActionError(mapContractError(err, casualModeActive));
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  // Release Shipping Escrow (Buyer at any time, Seller after 3 days)
  const handleReleaseShipping = async () => {
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const signer = await getSigner();
      const marketContract = new Contract(marketplaceAddress, marketplaceAbi, signer);

      const tx = await marketContract.releaseShippingEscrow(selectedOrder.data.tokenId);
      setActionTx(tx.hash);
      await tx.wait();

      setSelectedOrder(null);
      await fetchOrders();
    } catch (err) {
      console.error("Release shipping failed:", err);
      setActionError(err.reason || err.message || "Failed to release shipping escrow.");
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  // Dispute Shipping Escrow (Buyer calls)
  const handleDisputeShipping = async () => {
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const signer = await getSigner();
      const marketContract = new Contract(marketplaceAddress, marketplaceAbi, signer);

      const tx = await marketContract.disputeShipping(selectedOrder.data.tokenId);
      setActionTx(tx.hash);
      await tx.wait();

      setSelectedOrder(null);
      await fetchOrders();
    } catch (err) {
      console.error("Dispute failed:", err);
      setActionError(err.reason || err.message || "Failed to initiate shipping dispute.");
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  // Resolve Shipping Dispute (Curator calls)
  const handleResolveDispute = async (refundBuyer) => {
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const signer = await getSigner();
      const marketContract = new Contract(marketplaceAddress, marketplaceAbi, signer);

      const tx = await marketContract.resolveShippingDispute(selectedOrder.data.tokenId, refundBuyer);
      setActionTx(tx.hash);
      await tx.wait();

      setSelectedOrder(null);
      await fetchOrders();
    } catch (err) {
      console.error("Resolve dispute failed:", err);
      setActionError(err.reason || err.message || "Failed to resolve shipping dispute.");
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  // Release Batch Escrow (Buyer calls for shipping batch)
  const handleReleaseBatch = async () => {
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const signer = await getSigner();
      const marketContract = new Contract(marketplaceAddress, marketplaceAbi, signer);

      const tx = await marketContract.releaseEscrow(selectedOrder.data.purchaseId);
      setActionTx(tx.hash);
      await tx.wait();

      setSelectedOrder(null);
      await fetchOrders();
    } catch (err) {
      console.error("Release batch failed:", err);
      setActionError(err.reason || err.message || "Failed to release batch escrow.");
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  // Refund Batch Escrow (Seller calls)
  const handleRefundBatch = async () => {
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const signer = await getSigner();
      const marketContract = new Contract(marketplaceAddress, marketplaceAbi, signer);

      const tx = await marketContract.refundEscrow(selectedOrder.data.purchaseId);
      setActionTx(tx.hash);
      await tx.wait();

      setSelectedOrder(null);
      await fetchOrders();
    } catch (err) {
      console.error("Refund batch failed:", err);
      setActionError(err.reason || err.message || "Failed to refund batch escrow.");
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  if (loading) {
    return <div className="glass-card shimmer-placeholder" style={{ height: "300px", borderRadius: "var(--radius-md)" }} />;
  }

  const cartItems = pendingTokenIds.map(tid => allActiveListings.find(l => Number(l.tokenId) === tid)).filter(Boolean);
  const activeSeller = cartItems[0]?.seller;
  const subtotal = cartItems.reduce((acc, item) => acc + parseFloat(item.price), 0);
  const firstShippingFee = cartItems[0] ? parseFloat(cartItems[0].shippingFee) : 0;
  const N = cartItems.length;
  const boxesCount = Math.ceil(N / 3) || 1;
  const totalShippingFee = firstShippingFee * boxesCount;
  const totalInvoiceCost = subtotal + totalShippingFee;
  const excessRefund = firstShippingFee * (boxesCount - 1);
  const totalCost = subtotal + firstShippingFee; // Net secure payment matching contract requirement

  const recommendedAddons = allActiveListings.filter((item) => {
    if (!item.seller || item.seller.toLowerCase() !== activeSeller?.toLowerCase()) return false;
    if (item.isBatch) return false;
    if (pendingTokenIds.includes(Number(item.tokenId))) return false;
    return calculateCompatibility(item) === 100;
  });

  const handleAddAddon = (tokenId) => {
    setPendingTokenIds(prev => [...prev, Number(tokenId)]);
  };

  const renderBoxGrid = () => {
    const boxesCount = Math.ceil(N / 3) || 1;
    const boxes = [];
    for (let b = 0; b < boxesCount; b++) {
      const slots = [];
      for (let s = 0; s < 3; s++) {
        const itemIndex = b * 3 + s;
        const isOccupied = itemIndex < N;
        const occupiedItem = cartItems[itemIndex];
        slots.push({ isOccupied, item: occupiedItem });
      }
      boxes.push(slots);
    }
    return (
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0" }}>
        {boxes.map((box, idx) => {
          const occupiedCount = box.filter(s => s.isOccupied).length;
          const pct = Math.round((occupiedCount / 3) * 100);
          return (
            <div 
              key={idx} 
              className="glass-card" 
              style={{ 
                padding: "1rem", 
                width: "160px", 
                display: "flex", 
                flexDirection: "column", 
                alignItems: "center",
                border: "1px solid var(--glass-border-hover)",
                background: "rgba(255, 255, 255, 0.02)"
              }}
            >
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                📦 Box {idx + 1} ({pct}% Full)
              </span>
              <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.5rem" }}>
                {box.map((slot, sIdx) => (
                  <div 
                    key={sIdx} 
                    style={{ 
                      width: "32px", 
                      height: "32px", 
                      borderRadius: "4px", 
                      background: slot.isOccupied ? "var(--accent-blue-glow)" : "rgba(255,255,255,0.03)", 
                      border: slot.isOccupied ? "1px solid var(--accent-blue)" : "1px solid rgba(255,255,255,0.08)",
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "center",
                      fontSize: "0.9rem",
                      color: "#fff"
                    }}
                    title={slot.isOccupied ? slot.item.commonName : "Empty Slot"}
                  >
                    {slot.isOccupied ? "🐠" : ""}
                  </div>
                ))}
              </div>
              <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)", textAlign: "center" }}>
                {occupiedCount} / 3 specimens
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {pendingTokenIds.length > 0 && (
        <div 
          className="glass-card" 
          style={{ 
            padding: "2rem", 
            marginBottom: "2rem", 
            border: "1px solid var(--accent-blue)", 
            background: "rgba(14, 20, 36, 0.45)" 
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
            <div>
              <h3 style={{ fontSize: "1.35rem", color: "#fff", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span>📦</span> Consolidated Shipping & Box Optimization
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: 0 }}>
                Grouping specimens from seller <span style={{ fontFamily: "monospace", color: "var(--accent-blue)" }}>{activeSeller}</span> to optimize box utilization and save shipping fees.
              </p>
            </div>
            <button 
              className="btn-secondary" 
              onClick={() => setPendingTokenIds([])} 
              style={{ border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)", padding: "0.4rem 1rem", fontSize: "0.75rem" }}
            >
              Clear Cart
            </button>
          </div>

          {actionError && (
            <div style={{ padding: "0.75rem", background: "rgba(248, 113, 113, 0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)", fontSize: "0.8rem", borderRadius: "4px", marginBottom: "1rem" }}>
              {actionError}
            </div>
          )}

          {actionTx && (
            <div style={{ padding: "0.75rem", background: "var(--accent-blue-glow)", border: "1px solid rgba(56, 189, 248, 0.3)", color: "var(--accent-blue)", fontSize: "0.8rem", borderRadius: "4px", marginBottom: "1rem", wordBreak: "break-all" }}>
              <strong>Transaction pending:</strong> {actionTx}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "2rem", width: "100%" }}>
            {/* Left side: Items and Box visualization */}
            <div style={{ flex: "1 1 500px" }}>
              <h4 style={{ color: "#fff", fontSize: "0.95rem", marginBottom: "0.75rem" }}>Selected Specimens ({N})</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
                {cartItems.map((item) => (
                  <div 
                    key={item.tokenId} 
                    style={{ 
                      display: "flex", 
                      justifyContent: "space-between", 
                      alignItems: "center", 
                      padding: "0.75rem 1rem", 
                      background: "rgba(255,255,255,0.02)", 
                      borderRadius: "6px",
                      border: "1px solid rgba(255,255,255,0.05)"
                    }}
                  >
                    <div>
                      <strong style={{ color: "#fff", fontSize: "0.85rem" }}>{item.commonName}</strong>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", fontStyle: "italic" }}>{item.scientificName}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                      <span style={{ fontFamily: "monospace", color: "var(--accent-green)", fontSize: "0.9rem", fontWeight: "600" }}>
                        ${(parseFloat(item.price) * 1000).toFixed(2)}
                      </span>
                      <button 
                        onClick={() => setPendingTokenIds(prev => prev.filter(id => id !== item.tokenId))}
                        style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "1.1rem", cursor: "pointer", padding: "0 0.5rem" }}
                        title="Remove"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <h4 style={{ color: "#fff", fontSize: "0.95rem", marginBottom: "0.5rem" }}>Box Utilization Visualizer</h4>
              {renderBoxGrid()}
            </div>

            {/* Right side: Summary and checkout details */}
            <div style={{ width: "300px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div 
                className="glass-card" 
                style={{ 
                  padding: "1.25rem", 
                  background: "rgba(0,0,0,0.15)", 
                  border: "1px solid rgba(255,255,255,0.05)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem"
                }}
              >
                <h4 style={{ color: "#fff", fontSize: "0.9rem", margin: 0, textTransform: "uppercase", letterSpacing: "0.05em" }}>Checkout Summary</h4>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  <span>Subtotal:</span>
                  <span style={{ fontFamily: "monospace", color: "#fff" }}>${(subtotal * 1000).toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  <span>📦 Consolidated Shipping Boxes ({boxesCount}):</span>
                  <span style={{ fontFamily: "monospace", color: "#fff" }}>${(totalShippingFee * 1000).toFixed(2)}</span>
                </div>
                {((firstShippingFee * N) - totalShippingFee) > 0 && casualModeActive && (
                  <div style={{ 
                    display: "flex", 
                    justifyContent: "space-between", 
                    fontSize: "0.8rem", 
                    color: "var(--accent-green)",
                    background: "rgba(34, 197, 94, 0.05)",
                    padding: "0.25rem 0.5rem",
                    borderRadius: "4px"
                  }}>
                    <span>✨ Bundling Savings:</span>
                    <span style={{ fontFamily: "monospace" }}>-${(((firstShippingFee * N) - totalShippingFee) * 1000).toFixed(2)}</span>
                  </div>
                )}
                {boxesCount > 1 && !casualModeActive && (
                  <div style={{ 
                    display: "flex", 
                    justifyContent: "space-between", 
                    fontSize: "0.8rem", 
                    color: "var(--accent-green)",
                    background: "rgba(34, 197, 94, 0.05)",
                    padding: "0.25rem 0.5rem",
                    borderRadius: "4px"
                  }}>
                    <span>Automated Box Logistics Refund:</span>
                    <span style={{ fontFamily: "monospace" }}>-${(excessRefund * 1000).toFixed(2)}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "0.75rem", marginTop: "0.25rem" }}>
                  <strong style={{ color: "#fff" }}>Net Secure Payment:</strong>
                  <strong style={{ fontFamily: "monospace", color: "var(--accent-green)" }}>${(totalCost * 1000).toFixed(2)}</strong>
                </div>
                {casualModeActive && (
                  <div style={{
                    padding: "0.75rem",
                    background: "rgba(56, 189, 248, 0.05)",
                    border: "1px solid rgba(56, 189, 248, 0.15)",
                    borderRadius: "6px",
                    marginTop: "0.5rem"
                  }}>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0, lineHeight: "1.4" }}>
                      ℹ️ Multi-item orders are bundled into optimal shipping boxes. We automate all logistics to minimize your shipping costs instantly.
                    </p>
                  </div>
                )}

                {/* Gated Event Zone Check for Cash Handshake */}
                {(insideEventZone === true || !!currentEventId) ? (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem",
                    background: "rgba(16, 185, 129, 0.05)",
                    border: "1px solid rgba(16, 185, 129, 0.2)",
                    borderRadius: "4px",
                    marginTop: "0.25rem",
                    marginBottom: "0.25rem"
                  }}>
                    <input 
                      type="checkbox" 
                      id="cash-handshake-toggle"
                      checked={isCashHandshake}
                      onChange={(e) => setIsCashHandshake(e.target.checked)}
                      style={{ cursor: "pointer" }}
                    />
                    <label htmlFor="cash-handshake-toggle" style={{ fontSize: "0.75rem", color: "#fff", cursor: "pointer", fontWeight: "600" }}>
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
                    marginTop: "0.25rem",
                    marginBottom: "0.25rem",
                    textAlign: "center"
                  }}>
                    📍 Cash Handshake only available inside active live event zones.
                  </div>
                )}

                <button 
                  className="btn-primary" 
                  disabled={actionLoading} 
                  onClick={isCashHandshake && (insideEventZone === true || !!currentEventId) ? handleCashCheckout : handleConsolidatedCheckout}
                  style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem" }}
                >
                  {actionLoading ? "Processing checkout..." : isCashHandshake && (insideEventZone === true || !!currentEventId) ? "Generate Cash Handshake QR" : "Complete Checkout (Consolidated)"}
                </button>
                {casualModeActive && (
                  <div style={{
                    marginTop: "1rem",
                    padding: "1rem",
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "8px"
                  }}>
                    <h5 style={{ color: "#fff", margin: "0 0 0.5rem 0", fontSize: "0.85rem" }}>What happens next?</h5>
                    <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "var(--text-muted)", fontSize: "0.75rem", lineHeight: "1.5" }}>
                      <li>The breeder is notified and begins preparing your fish.</li>
                      <li>Your payment is locked securely in escrow.</li>
                      <li>Payment is only released when your fish arrives safely or you pick it up!</li>
                    </ul>
                  </div>
                )}
              </div>

              {/* Cash Handshake QR Code Modal */}
              {cashHandshakePayload && (() => {
                const qrData = JSON.stringify(cashHandshakePayload);
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&color=10b981&bgcolor=0f172a&data=${encodeURIComponent(qrData)}`;
                return (
                  <div style={{
                    position: "fixed",
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: "rgba(0, 0, 0, 0.8)",
                    backdropFilter: "blur(8px)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    zIndex: 2000, padding: "1rem"
                  }}>
                    <div className="glass-card" style={{
                      width: "100%", maxWidth: "420px", padding: "2rem",
                      background: "var(--bg-secondary)", border: "1px solid var(--accent-green)",
                      textAlign: "center", position: "relative"
                    }}>
                      <button 
                        onClick={() => setCashHandshakePayload(null)}
                        style={{ position: "absolute", top: "1rem", right: "1.25rem", background: "none", border: "none", color: "var(--text-muted)", fontSize: "1.25rem", cursor: "pointer" }}
                      >
                        &times;
                      </button>
                      <span style={{ fontSize: "2.5rem" }}>💵</span>
                      <h3 style={{ color: "#fff", marginTop: "0.5rem" }}>Cash Handshake QR Code</h3>
                      <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1.5rem" }}>
                        Show this QR code to the Breeder to complete the cash transfer and record lineage provenance.
                      </p>
                      
                      <div style={{
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(16, 185, 129, 0.3)",
                        borderRadius: "8px", padding: "1rem", display: "inline-block",
                        marginBottom: "1.5rem"
                      }}>
                        <img src={qrUrl} alt="Cash Handshake QR" style={{ display: "block", borderRadius: "4px", width: "200px", height: "200px" }} />
                      </div>

                      <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", textAlign: "left", background: "rgba(0,0,0,0.2)", padding: "0.75rem", borderRadius: "6px" }}>
                        <div>Buyer: <span style={{ fontFamily: "monospace", fontSize: "0.7rem" }}>{cashHandshakePayload.buyer}</span></div>
                        <div>Seller: <span style={{ fontFamily: "monospace", fontSize: "0.7rem" }}>{cashHandshakePayload.seller}</span></div>
                        <div>Specimens: <strong>{cashHandshakePayload.tokenIds.length}</strong></div>
                        <div>Total Price: <strong>${(cashHandshakePayload.totalCost * 1000).toFixed(2)}</strong></div>
                        <div>Event ID: <strong>{cashHandshakePayload.eventId}</strong></div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Recommended Add-ons section */}
              {recommendedAddons.length > 0 && (
                <div 
                  className="glass-card" 
                  style={{ 
                    padding: "1.25rem", 
                    background: "rgba(34, 197, 94, 0.02)", 
                    border: "1px solid rgba(34, 197, 94, 0.15)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem"
                  }}
                >
                  <h4 style={{ color: "var(--accent-green)", fontSize: "0.85rem", margin: 0, fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    🐠 Recommended Add-ons (100% Match)
                  </h4>
                  <p style={{ color: "var(--text-muted)", fontSize: "0.7rem", margin: 0 }}>
                    Other species from this breeder that perfectly match your tank:
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "160px", overflowY: "auto" }}>
                    {recommendedAddons.map((addon) => (
                      <div 
                        key={addon.tokenId}
                        onClick={() => handleAddAddon(addon.tokenId)}
                        className="glass-card"
                        style={{ 
                          padding: "0.5rem", 
                          background: "rgba(255,255,255,0.01)", 
                          cursor: "pointer", 
                          display: "flex", 
                          justifyContent: "space-between", 
                          alignItems: "center",
                          border: "1px solid rgba(255,255,255,0.03)"
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1, paddingRight: "0.5rem" }}>
                          <strong style={{ fontSize: "0.75rem", color: "#fff", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {addon.commonName}
                          </strong>
                          <span style={{ fontSize: "0.65rem", color: "var(--accent-green)", fontWeight: "600" }}>
                            [100% Match]
                          </span>
                        </div>
                        <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--accent-green)", flexShrink: 0 }}>
                          +${(parseFloat(addon.price) * 1000).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: "1.25rem", color: "#fff" }}>Order Tracking & Protections</h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.5rem" }}>
        {/* Shipping orders */}
        {shippingEscrows.map((order) => (
          <div 
            key={`ship-${order.tokenId}`} 
            className="glass-card" 
            style={{ 
              padding: "1.25rem", 
              display: "flex", 
              flexDirection: "column", 
              gap: "0.75rem",
              border: order.status === 3 ? "1px solid var(--accent-red)" : "1px solid var(--glass-border)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="badge badge-blue" style={{ fontSize: "0.6rem" }}>Shipping Order</span>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Cert. Serial No. {order.tokenId.toString().padStart(3, "0")}</span>
            </div>

            <div>
              <h4 style={{ color: "#fff" }}>{order.commonName}</h4>
              <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                Role: <strong>{order.role}</strong>
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
              <span>Subtotal:</span>
              <strong style={{ fontFamily: "monospace" }}>${(parseFloat(order.price) * 1000).toFixed(2)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
              <span>Shipping Fee:</span>
              <strong style={{ fontFamily: "monospace" }}>${(parseFloat(order.shippingFee) * 1000).toFixed(2)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.25rem" }}>
              <span>Total Locked:</span>
              <strong style={{ fontFamily: "monospace", color: "var(--accent-green)" }}>${(parseFloat(order.amountLocked) * 1000).toFixed(2)}</strong>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Status:</span>
              <span className={`badge ${
                order.status === 2 ? "badge-green" : 
                order.status === 3 ? "badge-red" : 
                order.status === 4 ? "badge-amber" : 
                "badge-blue"
              }`} style={{ fontSize: "0.65rem" }}>
                {SHIPPING_STATUSES[order.status]}
              </span>
            </div>

            <button 
              className="btn-secondary" 
              style={{ width: "100%", marginTop: "0.5rem", padding: "0.4rem" }}
              onClick={() => setSelectedOrder({ type: "shipping", data: order })}
            >
              Fulfillment Detail
            </button>
          </div>
        ))}

        {/* Batch / In-Person Orders */}
        {purchases.map((order) => (
          <div 
            key={`batch-${order.purchaseId}`} 
            className="glass-card" 
            style={{ 
              padding: "1.25rem", 
              display: "flex", 
              flexDirection: "column", 
              gap: "0.75rem"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="badge badge-amber" style={{ fontSize: "0.6rem" }}>
                {order.fulfillmentType === 1 ? "🤝 In-Person Pickup" : "📦 Batch Shipping"}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Order Serial No. {order.purchaseId.toString().padStart(3, "0")}</span>
            </div>

            <div>
              <h4 style={{ color: "#fff" }}>{order.commonName} (Qty: {order.quantity})</h4>
              <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                Role: <strong>{order.role}</strong>
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
              <span>Total Locked:</span>
              <strong style={{ fontFamily: "monospace", color: "var(--accent-green)" }}>${(parseFloat(order.amountLocked) * 1000).toFixed(2)}</strong>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Status:</span>
              <span className={`badge ${
                order.state === 1 ? "badge-green" : 
                order.state === 2 ? "badge-red" : 
                "badge-blue"
              }`} style={{ fontSize: "0.65rem" }}>
                {ESCROW_STATES[order.state]}
              </span>
            </div>

            <button 
              className="btn-secondary" 
              style={{ width: "100%", marginTop: "0.5rem", padding: "0.4rem" }}
              onClick={() => setSelectedOrder({ type: "batch", data: order })}
            >
              Fulfillment Detail
            </button>
          </div>
        ))}
      </div>

      {/* Selected Order Detail Drawer / Overlay */}
      {selectedOrder && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.75)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          padding: "1rem"
        }}>
          <div className="glass-card" style={{
            width: "100%",
            maxWidth: "460px",
            padding: "2rem",
            background: "var(--bg-secondary)",
            border: "1px solid var(--glass-border-hover)",
            position: "relative"
          }}>
            <button 
              onClick={() => {
                setSelectedOrder(null);
                setPinInput("");
                setTrackingInput("");
                setActionError(null);
              }}
              style={{ position: "absolute", top: "1rem", right: "1.25rem", background: "none", border: "none", color: "var(--text-muted)", fontSize: "1.25rem", cursor: "pointer" }}
            >
              &times;
            </button>

            <h3 style={{ fontSize: "1.35rem", marginBottom: "0.25rem", color: "#fff" }}>Order Tracking & Fulfillment Details</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1.5rem" }}>
              {selectedOrder.type === "shipping" ? `Shipping Certificate Serial No. ${selectedOrder.data.tokenId.toString().padStart(3, "0")}` : `Batch Order Serial No. ${selectedOrder.data.purchaseId.toString().padStart(3, "0")}`}
            </p>

            {actionError && (
              <div style={{ padding: "0.75rem", background: "rgba(248, 113, 113, 0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)", fontSize: "0.8rem", borderRadius: "4px", marginBottom: "1rem" }}>
                {actionError}
              </div>
            )}

            {actionTx && (
              <div style={{ padding: "0.75rem", background: "var(--accent-blue-glow)", border: "1px solid rgba(56, 189, 248, 0.3)", color: "var(--accent-blue)", fontSize: "0.8rem", borderRadius: "4px", marginBottom: "1rem", wordBreak: "break-all" }}>
                <strong>Transaction pending:</strong> {actionTx}
              </div>
            )}

            {/* BATCH ORDER FULLFILLMENTS */}
            {selectedOrder.type === "batch" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem", borderRadius: "4px", fontSize: "0.85rem" }}>
                  <div>Specimen: <strong>{selectedOrder.data.commonName}</strong></div>
                  <div>Quantity: <strong>{selectedOrder.data.quantity}</strong></div>
                  <div>Seller: <span style={{ fontSize: "0.75rem", fontFamily: "monospace" }}>{selectedOrder.data.seller}</span></div>
                  <div>Buyer: <span style={{ fontSize: "0.75rem", fontFamily: "monospace" }}>{selectedOrder.data.buyer}</span></div>
                  <div>State: <span className="badge badge-blue" style={{ fontSize: "0.65rem" }}>{ESCROW_STATES[selectedOrder.data.state]}</span></div>
                </div>

                {selectedOrder.data.state === 0 && selectedOrder.data.fulfillmentType === 1 && (
                  // Local Pickup Pathway
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem", textAlign: "center" }}>
                    {selectedOrder.data.role === "Buyer" ? (
                      <div>
                        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}>
                          Provide this secure 4-digit PIN to the breeder when picking up your specimens:
                        </p>
                        <div style={{ fontSize: "2rem", fontWeight: "700", letterSpacing: "0.25em", color: "var(--accent-amber)", background: "rgba(0,0,0,0.3)", padding: "0.5rem 1rem", borderRadius: "8px", display: "inline-block" }}>
                          {/* In local dev, PIN can be read or is pre-communicated. We can simulate displaying a generated pin from local storage or mock */}
                          {"2541"}
                        </div>
                        <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
                          Once entered by the breeder, your locked loyalty holding funds will release automatically.
                        </p>
                      </div>
                    ) : selectedOrder.data.role === "Seller" ? (
                      <div>
                        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.75rem" }}>
                          Enter the 4-digit verification PIN provided by the buyer to release locked escrow funds:
                        </p>
                        
                        <div style={{ fontSize: "1.5rem", height: "40px", fontWeight: "600", color: "var(--accent-blue)", marginBottom: "0.5rem", letterSpacing: "0.5em" }}>
                          {pinInput || "----"}
                        </div>

                        {/* GPS Event Bounding Zone Simulator Checkbox */}
                        <div style={{ 
                          display: "flex", 
                          alignItems: "center", 
                          justifyContent: "center", 
                          gap: "0.5rem", 
                          marginBottom: "1rem",
                          padding: "0.5rem",
                          background: currentLocation.isInsideEventZone ? "rgba(34, 197, 94, 0.08)" : "rgba(255,255,255,0.02)",
                          border: currentLocation.isInsideEventZone ? "1px solid rgba(34, 197, 94, 0.2)" : "1px solid rgba(255,255,255,0.05)",
                          borderRadius: "4px"
                        }}>
                          <input 
                            type="checkbox" 
                            id="gps-event-zone"
                            checked={currentLocation.isInsideEventZone}
                            onChange={(e) => setCurrentLocation({ isInsideEventZone: e.target.checked })}
                            style={{ cursor: "pointer" }}
                          />
                          <label htmlFor="gps-event-zone" style={{ fontSize: "0.75rem", color: currentLocation.isInsideEventZone ? "var(--accent-green)" : "var(--text-muted)", cursor: "pointer", fontWeight: "600" }}>
                            {currentLocation.isInsideEventZone ? "⚡ Inside Active Event Zone (2x Loyalty Rewards)" : "📍 Outside Event Zone (1x Loyalty Rewards)"}
                          </label>
                        </div>

                        <div className="pin-keypad" style={{ marginBottom: "1.25rem" }}>
                          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map(btn => (
                            <button 
                              key={btn} 
                              type="button" 
                              className="keypad-btn" 
                              onClick={() => handleKeypadPress(btn)}
                            >
                              {btn}
                            </button>
                          ))}
                        </div>

                        <button 
                          className="btn-primary" 
                          style={{ width: "100%", justifyContent: "center" }}
                          disabled={pinInput.length !== 4 || actionLoading}
                          onClick={handleInPersonReleaseSubmit}
                        >
                          {actionLoading ? "Confirming PIN..." : "Confirm Handshake Verification"}
                        </button>
                      </div>
                    ) : (
                      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Awaiting in-person verification handshake.</p>
                    )}
                  </div>
                )}

                {selectedOrder.data.state === 0 && selectedOrder.data.fulfillmentType === 0 && (
                  // Batch Shipping Pathway
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    {selectedOrder.data.role === "Buyer" && (
                      <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={actionLoading} onClick={handleReleaseBatch}>
                        Release Funds
                      </button>
                    )}
                    {selectedOrder.data.role === "Seller" && (
                      <button className="btn-secondary" style={{ flex: 1, border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)" }} disabled={actionLoading} onClick={handleRefundBatch}>
                        Cancel & Refund
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* SHIPPING SINGLE ORDER FULLFILLMENTS */}
            {selectedOrder.type === "shipping" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem", borderRadius: "4px", fontSize: "0.85rem" }}>
                  <div>Specimen: <strong>{selectedOrder.data.commonName}</strong></div>
                  <div>Seller: <span style={{ fontSize: "0.75rem", fontFamily: "monospace" }}>{selectedOrder.data.seller}</span></div>
                  <div>Buyer: <span style={{ fontSize: "0.75rem", fontFamily: "monospace" }}>{selectedOrder.data.buyer}</span></div>
                  {selectedOrder.data.trackingNumber && (
                    <div>Tracking Number: <strong style={{ color: "var(--accent-blue)" }}>{selectedOrder.data.trackingNumber}</strong></div>
                  )}
                  {selectedOrder.data.dispatchTimestamp > 0 && (
                    <div>Dispatched Date: <span>{new Date(selectedOrder.data.dispatchTimestamp * 1000).toLocaleString()}</span></div>
                  )}
                </div>

                {selectedOrder.data.status === 0 && (
                  // Status: LOCKED (Awaiting Dispatch)
                  <div>
                    {selectedOrder.data.role === "Seller" ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Enter Shipping Carrier / Tracking ID:</label>
                        <input 
                          type="text" 
                          value={trackingInput}
                          onChange={(e) => setTrackingInput(e.target.value)}
                          placeholder="e.g. USPS 94001000..."
                          style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                        />
                        <button className="btn-primary" style={{ justifyContent: "center" }} disabled={!trackingInput || actionLoading} onClick={handleDispatchShipping}>
                          {actionLoading ? "Updating Status..." : "Mark Dispatched"}
                        </button>
                      </div>
                    ) : (
                      <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>Awaiting breeder carrier dispatch & tracking submission.</p>
                    )}
                  </div>
                )}

                {selectedOrder.data.status === 1 && (
                  // Status: DISPATCHED
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    <div style={{ padding: "0.75rem", background: "rgba(56, 189, 248, 0.05)", border: "1px solid rgba(56, 189, 248, 0.2)", borderRadius: "4px", fontSize: "0.8rem", textAlign: "center" }}>
                      <strong>Transit Safety Windows:</strong> Funds are locked in holding. Buyer has 3 days from dispatch to raise disputes before seller release unlocks.
                    </div>

                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {selectedOrder.data.role === "Buyer" && (
                        <>
                          <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={actionLoading} onClick={handleReleaseShipping}>
                            Release Funds
                          </button>
                          <button className="btn-secondary" style={{ flex: 1, border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)" }} disabled={actionLoading} onClick={handleDisputeShipping}>
                            Dispute Order
                          </button>
                        </>
                      )}

                      {selectedOrder.data.role === "Seller" && (
                        <button 
                          className="btn-primary" 
                          style={{ width: "100%", justifyContent: "center" }}
                          disabled={actionLoading || (Date.now() / 1000) < (selectedOrder.data.dispatchTimestamp + 3 * 86400)}
                          onClick={handleReleaseShipping}
                        >
                          {(Date.now() / 1000) >= (selectedOrder.data.dispatchTimestamp + 3 * 86400) ? "Auto-Release Funds" : "Locked (Holding Window Active)"}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {selectedOrder.data.status === 3 && (
                  // Status: DISPUTED
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    <div style={{ padding: "0.75rem", background: "rgba(248, 113, 113, 0.05)", border: "1px solid rgba(248, 113, 113, 0.2)", borderRadius: "4px", fontSize: "0.8rem", textAlign: "center", color: "var(--accent-red)" }}>
                      ⚠️ <strong>Disputed Shipment:</strong> This order is in conflict. Awaiting review and arbitration by the Curator.
                    </div>

                    {isCurator && (
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={actionLoading} onClick={() => handleResolveDispute(false)}>
                          Release to Seller
                        </button>
                        <button className="btn-secondary" style={{ flex: 1, border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)", justifyContent: "center" }} disabled={actionLoading} onClick={() => handleResolveDispute(true)}>
                          Refund Buyer
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {(selectedOrder.data.status === 2 || selectedOrder.data.status === 4) && (
                  <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    Order resolved. State is permanent.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
