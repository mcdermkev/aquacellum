import React, { useState, useEffect, useRef } from "react";
import { ethers, Contract, formatEther } from "ethers";
import managerAbi from "../abi/AquadexManager.json";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import { HandshakeVerification } from "./HandshakeVerification";
import { getProvider } from "../utils/smartAccount";

export function LocalBreederMap({ contractAddress, marketplaceAddress, walletAccount }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);
  const [rangeFilter, setRangeFilter] = useState(10); // 5 | 10 | 25 miles
  const [eventFilter, setEventFilter] = useState("all");
  const [userLocation, setUserLocation] = useState({ lat: 37.7749, lng: -122.4194 }); // Default SF
  const [checkoutListing, setCheckoutListing] = useState(null);
  const [checkoutQuantity, setCheckoutQuantity] = useState(1);
  const [isHandshakeOpen, setIsHandshakeOpen] = useState(false);

  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const mappedDotsRef = useRef([]); // Hold screen coordinates for click detection

  // Get user geolocation
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (err) => {
          console.warn("Geolocation blocked/failed, using default center.", err);
        }
      );
    }
  }, []);

  // Fetch active listings on-chain
  const fetchLocalListings = async () => {
    try {
      setLoading(true);
      const provider = getProvider();
      const managerContract = new Contract(contractAddress, managerAbi, provider);
      const marketplaceContract = new Contract(marketplaceAddress, marketplaceAbi, provider);

      const activeListings = [];
      let spawnId = 1;

      while (true) {
        let spawnLog;
        try {
          spawnLog = await managerContract.spawnLogs(spawnId);
        } catch (err) {
          break;
        }

        if (!spawnLog || spawnLog.spawnId === 0n) {
          break;
        }

        const listingId = await marketplaceContract.spawnToListing(Number(spawnLog.spawnId));
        if (listingId > 0n) {
          const listing = await marketplaceContract.batchListings(listingId);
          if (listing.isActive) {
            const species = await managerContract.speciesCatalog(Number(spawnLog.speciesId));
            
            // Generate deterministic fuzzed offset from breeder address hash relative to SF center
            const sellerAddr = listing.seller;
            let hash = 0;
            for (let i = 0; i < sellerAddr.length; i++) {
              hash = sellerAddr.charCodeAt(i) + ((hash << 5) - hash);
            }
            const latOffsetVal = ((hash & 0xFF) / 255 - 0.5) * 0.08;
            const lngOffsetVal = (((hash >> 8) & 0xFF) / 255 - 0.5) * 0.08;

            const fuzzedLocation = {
              lat: 37.7749 + latOffsetVal,
              lng: -122.4194 + lngOffsetVal
            };
            const zoneHash = "0x" + Math.abs(hash).toString(16).padStart(8, "0");

            // Calculate relative offset and distance from user's location based on fuzzedLocation
            const latOffset = fuzzedLocation.lat - userLocation.lat;
            const lngOffset = fuzzedLocation.lng - userLocation.lng;
            const latMiles = latOffset * 69;
            const lngMiles = lngOffset * 55;
            const distance = Math.sqrt(latMiles * latMiles + lngMiles * lngMiles);

            activeListings.push({
              listingId: Number(listing.listingId),
              spawnId: Number(listing.spawnId),
              quantity: Number(listing.quantity),
              pricePerFish: listing.pricePerFish.toString(),
              seller: sellerAddr,
              speciesId: Number(spawnLog.speciesId),
              speciesName: species.commonName || "Unknown Specimen",
              latOffset,
              lngOffset,
              latMiles,
              lngMiles,
              distance,
              fuzzedLocation,
              zoneHash
            });
          }
        }
        spawnId++;
      }

      setListings(activeListings);
    } catch (err) {
      console.error("Failed to fetch map listings:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLocalListings();
  }, [contractAddress, marketplaceAddress, userLocation]);

  // Radar map drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    let angle = 0;
    let pulseScale = 1;
    let pulseDirection = 1;

    const drawRadar = () => {
      // Clear with dark blue-gray space theme background
      ctx.fillStyle = "#090d16";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const maxRadius = Math.min(centerX, centerY) - 20;

      // Draw concentric radar grids
      ctx.strokeStyle = "rgba(251, 191, 36, 0.08)";
      ctx.lineWidth = 1;
      for (let r = 1; r <= 4; r++) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, (maxRadius / 4) * r, 0, Math.PI * 2);
        ctx.stroke();

        // Range labels
        ctx.fillStyle = "rgba(251, 191, 36, 0.4)";
        ctx.font = "9px monospace";
        ctx.fillText(
          `${Math.round((rangeFilter / 4) * r)} mi`,
          centerX + 5,
          centerY - (maxRadius / 4) * r + 12
        );
      }

      // Draw crosshairs
      ctx.beginPath();
      ctx.moveTo(centerX - maxRadius, centerY);
      ctx.lineTo(centerX + maxRadius, centerY);
      ctx.moveTo(centerX, centerY - maxRadius);
      ctx.lineTo(centerX, centerY + maxRadius);
      ctx.stroke();

      // Pulse calculations for glow effects
      pulseScale += 0.008 * pulseDirection;
      if (pulseScale > 1.15 || pulseScale < 0.95) {
        pulseDirection *= -1;
      }

      // Draw active dots and boundary zones
      const dotsCoords = [];
      listings.forEach((item) => {
        // Only render listings inside current range filter
        if (item.distance > rangeFilter) return;

        // Calculate canvas position relative to selected range filter
        const x = centerX + (item.lngMiles / rangeFilter) * maxRadius;
        const y = centerY - (item.latMiles / rangeFilter) * maxRadius;

        dotsCoords.push({ x, y, listing: item });

        const isHovered = selectedListing && selectedListing.listingId === item.listingId;

        // Relative multiplier scale based on range filter and canvas boundary size
        const relativeMultiplier = maxRadius / rangeFilter;

        // 1. Draw fuzzed 3-mile outer boundaries ring (pulse circle)
        const outerBoundaryRadius = 3 * relativeMultiplier;
        ctx.beginPath();
        ctx.arc(x, y, outerBoundaryRadius * (isHovered ? pulseScale : 1), 0, Math.PI * 2);
        ctx.strokeStyle = isHovered 
          ? "rgba(251, 191, 36, 0.3)" 
          : "rgba(251, 191, 36, 0.1)";
        ctx.stroke();

        // 2. Draw fuzzy regional location radius ring (1-mile zone) to protect personal address
        const oneMileRadius = 1 * relativeMultiplier;
        ctx.beginPath();
        ctx.arc(x, y, oneMileRadius * (isHovered ? pulseScale : 1), 0, Math.PI * 2);
        ctx.fillStyle = isHovered 
          ? "rgba(251, 191, 36, 0.18)" 
          : "rgba(251, 191, 36, 0.08)";
        ctx.fill();
        ctx.strokeStyle = isHovered 
          ? "rgba(251, 191, 36, 0.7)" 
          : "rgba(251, 191, 36, 0.3)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.lineWidth = 1; // reset
      });

      // Render Mock Events on the radar screen
      const mockEvents = [
        {
          id: "evt-1",
          name: "Silicon Valley Aqua Swap Meet (Active)",
          type: "swap-meets",
          latMiles: 2.5,
          lngMiles: -3.0,
          description: "Officially active regional swap meet and expo. Special event Loyalty Rewards multiplier active inside bounding zone!",
          distance: 3.9
        },
        {
          id: "evt-2",
          name: "Downtown Guppy Public Drop Point",
          type: "public-drops",
          latMiles: -4.0,
          lngMiles: 5.0,
          description: "Public drop-off point for local pickup transfers.",
          distance: 6.4
        }
      ];

      mockEvents.forEach((evt) => {
        if (eventFilter !== "all" && eventFilter !== evt.type) return;
        if (evt.distance > rangeFilter) return;

        const x = centerX + (evt.lngMiles / rangeFilter) * maxRadius;
        const y = centerY - (evt.latMiles / rangeFilter) * maxRadius;

        dotsCoords.push({ x, y, listing: { ...evt, isEvent: true } });

        const isHovered = selectedListing && selectedListing.id === evt.id;
        const eventColor = evt.type === "swap-meets" ? "var(--accent-green)" : "var(--accent-blue)";
        const eventColorRGB = evt.type === "swap-meets" ? "34, 197, 94" : "56, 189, 248";

        // Draw event pulsing outer area
        ctx.beginPath();
        ctx.arc(x, y, 12 * (isHovered ? pulseScale : 1), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${eventColorRGB}, ${isHovered ? 0.25 : 0.15})`;
        ctx.fill();
        ctx.strokeStyle = eventColor;
        ctx.stroke();

        // Draw Event Center Marker (Star or triangle shape)
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
      });

      mappedDotsRef.current = dotsCoords;

      // Draw User/Center Dot
      ctx.beginPath();
      ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
      ctx.fillStyle = "var(--accent-blue)";
      ctx.shadowColor = "var(--accent-blue)";
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Draw sweep line (rotating line)
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(angle);
      
      // Sweep gradient
      const sweepGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, maxRadius);
      sweepGrad.addColorStop(0, "rgba(251, 191, 36, 0)");
      sweepGrad.addColorStop(0.8, "rgba(251, 191, 36, 0.02)");
      sweepGrad.addColorStop(1, "rgba(251, 191, 36, 0.15)");
      
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, maxRadius, -0.08, 0);
      ctx.lineTo(0, 0);
      ctx.fillStyle = sweepGrad;
      ctx.fill();

      // Sweep line edge
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(maxRadius, 0);
      ctx.strokeStyle = "rgba(251, 191, 36, 0.25)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore();

      // Increment rotation
      angle = (angle + 0.01) % (Math.PI * 2);

      animationRef.current = requestAnimationFrame(drawRadar);
    };

    drawRadar();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [listings, rangeFilter, selectedListing]);

  // Click handler for canvas dots with dynamic scaling coefficients relative to bounding box
  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    // Detect if we clicked near any mapped dot (tolerance scaled: 15px * scaleX)
    const clickedDot = mappedDotsRef.current.find((dot) => {
      const dist = Math.sqrt((dot.x - clickX) ** 2 + (dot.y - clickY) ** 2);
      return dist <= (15 * scaleX);
    });

    if (clickedDot) {
      setSelectedListing(clickedDot.listing);
    } else {
      setSelectedListing(null);
    }
  };

  const truncateAddress = (addr) => {
    if (!addr) return "";
    return `${addr.substring(0, 6)}...${addr.substring(38)}`;
  };

  const handleCheckoutTrigger = (item) => {
    setCheckoutListing(item);
    setCheckoutQuantity(1);
    setIsHandshakeOpen(true);
  };

  return (
    <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", alignItems: "flex-start" }}>
      {/* Map Left Screen */}
      <div 
        className="glass-card" 
        style={{ 
          flex: "1 1 500px", 
          padding: "1.5rem", 
          display: "flex", 
          flexDirection: "column", 
          gap: "1.25rem",
          borderRadius: "var(--radius-md)",
          background: "rgba(15, 23, 42, 0.75)",
          border: "1px solid rgba(251, 191, 36, 0.15)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h3 style={{ fontSize: "1.25rem", fontWeight: "700", color: "#fff", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span>🧭</span> Local Proximity Field
            </h3>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Hobbyist boundaries fuzzed dynamically inside 3-mile zones
            </span>
          </div>

          {/* Event Status Filter */}
          <div style={{ display: "flex", gap: "0.25rem", background: "rgba(0,0,0,0.3)", padding: "2px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.04)", marginRight: "0.5rem" }}>
            {["all", "swap-meets", "public-drops"].map((type) => (
              <button
                key={type}
                onClick={() => {
                  setEventFilter(type);
                  setSelectedListing(null);
                }}
                style={{
                  padding: "0.25rem 0.65rem",
                  fontSize: "0.75rem",
                  fontWeight: "600",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  background: eventFilter === type ? "var(--accent-blue)" : "transparent",
                  color: eventFilter === type ? "#0f172a" : "var(--text-muted)",
                  textTransform: "capitalize",
                  transition: "all 0.2s"
                }}
              >
                {type === "all" ? "All" : type === "swap-meets" ? "Swap Meets" : "Public Drops"}
              </button>
            ))}
          </div>

          {/* Range Toggles */}
          <div style={{ display: "flex", gap: "0.25rem", background: "rgba(0,0,0,0.3)", padding: "2px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.04)" }}>
            {[5, 10, 25].map((val) => (
              <button
                key={val}
                onClick={() => {
                  setRangeFilter(val);
                  setSelectedListing(null);
                }}
                style={{
                  padding: "0.25rem 0.65rem",
                  fontSize: "0.75rem",
                  fontWeight: "600",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  background: rangeFilter === val ? "var(--accent-amber)" : "transparent",
                  color: rangeFilter === val ? "#0f172a" : "var(--text-muted)",
                  transition: "all 0.2s"
                }}
              >
                {val}M
              </button>
            ))}
          </div>
        </div>

        {/* Canvas Area */}
        <div style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center" }}>
          <canvas
            ref={canvasRef}
            width={480}
            height={480}
            onClick={handleCanvasClick}
            style={{
              maxWidth: "100%",
              aspectRatio: "1/1",
              borderRadius: "50%",
              border: "2px solid rgba(251, 191, 36, 0.15)",
              boxShadow: "0 0 32px rgba(0, 0, 0, 0.5), inset 0 0 40px rgba(251, 191, 36, 0.02)",
              cursor: "pointer"
            }}
          />
        </div>
      </div>

      {/* Details Side Panel Drawer */}
      <div 
        style={{ 
          width: "360px", 
          flexShrink: 0, 
          display: "flex", 
          flexDirection: "column", 
          gap: "1.5rem" 
        }}
      >
        <div 
          className="glass-card"
          style={{
            padding: "1.5rem",
            background: "rgba(15, 23, 42, 0.75)",
            border: "1px solid rgba(255, 255, 255, 0.05)",
            borderRadius: "var(--radius-md)",
            minHeight: "300px",
            display: "flex",
            flexDirection: "column",
            justifyContent: selectedListing ? "space-between" : "center",
            alignItems: selectedListing ? "stretch" : "center",
            textAlign: selectedListing ? "left" : "center",
            boxShadow: "0 12px 32px rgba(0,0,0,0.4)"
          }}
        >
          {selectedListing ? (
            selectedListing.isEvent ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div>
                    <span style={{ fontSize: "0.65rem", color: selectedListing.type === "swap-meets" ? "var(--accent-green)" : "var(--accent-blue)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: "700" }}>
                      🧭 {selectedListing.type === "swap-meets" ? "Active Swap Meet Event" : "Public Drop Location"}
                    </span>
                    <h4 style={{ fontSize: "1.2rem", fontWeight: "700", color: "#fff", marginTop: "0.25rem" }}>
                      {selectedListing.name}
                    </h4>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem", fontSize: "0.85rem" }}>
                    <p style={{ color: "var(--text-secondary)", margin: 0, lineHeight: "1.4" }}>
                      {selectedListing.description}
                    </p>
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: "0.5rem", marginTop: "0.5rem" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Distance from you</span>
                      <strong style={{ color: "#fff" }}>{selectedListing.distance.toFixed(1)} miles</strong>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: "2rem", padding: "0.75rem", background: "rgba(34, 197, 94, 0.05)", border: "1px solid rgba(34, 197, 94, 0.2)", borderRadius: "6px", fontSize: "0.8rem", color: "var(--accent-green)", textAlign: "center" }}>
                  🎉 Swap Meet Active! Visit Order Tracking & Protections to claim orders inside this zone for 2x Double Loyalty Rewards!
                </div>
              </>
            ) : (
              <>
                {/* Mapped Breeder Info Card */}
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div>
                    <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Selected Local Breeder
                    </span>
                    <h4 style={{ fontSize: "1.2rem", fontWeight: "700", color: "#fff", marginTop: "0.25rem" }}>
                      {selectedListing.speciesName}
                    </h4>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem", fontSize: "0.85rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.04)", paddingBottom: "0.5rem" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Breeder Account</span>
                      <code style={{ color: "#fff", fontFamily: "monospace" }}>{truncateAddress(selectedListing.seller)}</code>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.04)", paddingBottom: "0.5rem" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Available Quantity</span>
                      <strong style={{ color: "#fff" }}>{selectedListing.quantity} Fish</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.04)", paddingBottom: "0.5rem" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Price Per Fish</span>
                      <strong style={{ color: "var(--accent-amber)" }}>${(parseFloat(formatEther(selectedListing.pricePerFish)) * 1000).toFixed(2)}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.04)", paddingBottom: "0.5rem" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Fuzzed Proximity</span>
                      <strong style={{ color: "var(--accent-blue)", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                        ⚡ {selectedListing.distance.toFixed(1)} miles
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Action Button inside slide drawer */}
                <div style={{ marginTop: "2rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <label htmlFor="map-buy-qty" style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: "600" }}>
                      Checkout Quantity:
                    </label>
                    <input
                      type="number"
                      id="map-buy-qty"
                      min="1"
                      max={selectedListing.quantity}
                      value={checkoutQuantity}
                      onChange={(e) => setCheckoutQuantity(Math.min(selectedListing.quantity, Math.max(1, Number(e.target.value))))}
                      style={{
                        width: "60px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "4px",
                        color: "#fff",
                        fontSize: "0.8rem",
                        padding: "0.25rem 0.5rem",
                        textAlign: "center",
                        outline: "none"
                      }}
                    />
                  </div>
                  
                  <button
                    onClick={() => handleCheckoutTrigger(selectedListing)}
                    className="btn-primary"
                    style={{
                      background: "var(--accent-amber)",
                      boxShadow: "0 0 16px var(--accent-amber-glow)",
                      color: "#0f172a",
                      fontWeight: "700",
                      padding: "0.75rem",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      transition: "all 0.2s"
                    }}
                  >
                    🤝 Settle via Local Pickup
                  </button>
                </div>
              </>
            )
          ) : (
            <div style={{ padding: "2rem" }}>
              <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>📡</div>
              <h4 style={{ color: "#fff", fontSize: "0.95rem", fontWeight: "600", marginBottom: "0.25rem" }}>
                No Breeder Selected
              </h4>
              <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", margin: 0 }}>
                Click on any glowing amber transmitter dot on the radar grid to view breeder availability details and trigger handshake checkout.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Handshake Protocol Checkout Modal */}
      {checkoutListing && (
        <HandshakeVerification
          isOpen={isHandshakeOpen}
          onClose={() => {
            setIsHandshakeOpen(false);
            setCheckoutListing(null);
          }}
          listing={checkoutListing}
          quantity={checkoutQuantity}
          marketplaceAddress={marketplaceAddress}
          walletAccount={walletAccount}
          onSuccess={() => {
            fetchLocalListings();
            setSelectedListing(null);
          }}
        />
      )}
    </div>
  );
}
