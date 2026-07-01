import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { formatEther, parseEther } from "ethers";
import { HandshakeVerification } from "./HandshakeVerification";
import { db } from "../db";
import { haptic } from "../utils/haptics";

export function LocalBreederMap({ contractAddress, marketplaceAddress, walletAccount, casualModeActive }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanningPhase, setScanningPhase] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);
  const [hoveredDot, setHoveredDot] = useState(null);
  const [rangeFilter, setRangeFilter] = useState(10);
  const [eventFilter, setEventFilter] = useState("all");
  const [userLocation, setUserLocation] = useState({ lat: 37.7749, lng: -122.4194 });
  const [geoStatus, setGeoStatus] = useState("pending");
  const [locationLabel, setLocationLabel] = useState("Locating...");
  const [checkoutListing, setCheckoutListing] = useState(null);
  const [checkoutQuantity, setCheckoutQuantity] = useState(1);
  const [isHandshakeOpen, setIsHandshakeOpen] = useState(false);
  const [viewMode, setViewMode] = useState("radar");
  const [useMetric, setUseMetric] = useState(() => {
    const saved = localStorage.getItem("aquadex_distance_unit");
    if (saved) return saved === "km";
    return false;
  });
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [dotRevealProgress, setDotRevealProgress] = useState(0);

  const isPro = !casualModeActive;

  // Theme Color Configurations
  const primaryThemeColor = isPro ? "var(--accent-pro, #a855f7)" : "var(--accent-amber)";
  const primaryThemeGlow = isPro ? "var(--primary-pro-glow, rgba(168, 85, 247, 0.4))" : "var(--accent-amber-glow)";
  const themeAccentColor = isPro ? "#c084fc" : "#f59e0b";
  const themeCardBorder = isPro ? "rgba(168, 85, 247, 0.22)" : "rgba(251, 191, 36, 0.15)";

  const radarStrokeColor = isPro ? "rgba(168, 85, 247, 0.15)" : "rgba(251, 191, 36, 0.08)";
  const radarLabelColor = isPro ? "rgba(168, 85, 247, 0.5)" : "rgba(251, 191, 36, 0.4)";
  const pulseCircleStroke = isPro ? "rgba(168, 85, 247, 0.3)" : "rgba(251, 191, 36, 0.3)";
  const pulseCircleStrokeInactive = isPro ? "rgba(168, 85, 247, 0.1)" : "rgba(251, 191, 36, 0.1)";
  const regionFillColor = isPro ? "rgba(168, 85, 247, 0.18)" : "rgba(251, 191, 36, 0.18)";
  const regionFillColorInactive = isPro ? "rgba(168, 85, 247, 0.08)" : "rgba(251, 191, 36, 0.08)";
  const regionStrokeColor = isPro ? "rgba(168, 85, 247, 0.7)" : "rgba(251, 191, 36, 0.7)";
  const regionStrokeColorInactive = isPro ? "rgba(168, 85, 247, 0.3)" : "rgba(251, 191, 36, 0.3)";
  const sweepGradientStart = isPro ? "rgba(168, 85, 247, 0)" : "rgba(251, 191, 36, 0)";
  const sweepGradientMid = isPro ? "rgba(168, 85, 247, 0.02)" : "rgba(251, 191, 36, 0.02)";
  const sweepGradientEnd = isPro ? "rgba(168, 85, 247, 0.15)" : "rgba(251, 191, 36, 0.15)";
  const sweepLineStroke = isPro ? "rgba(168, 85, 247, 0.25)" : "rgba(251, 191, 36, 0.25)";

  const canvasRef = useRef(null);
  const mapContainerRef = useRef(null);
  const animationRef = useRef(null);
  const mappedDotsRef = useRef([]);
  const tooltipRef = useRef(null);
  const dotRevealTimerRef = useRef(null);
  const drawerRef = useRef(null);
  const dragStartY = useRef(null);

  // Distance formatting helpers
  const formatDistance = useCallback((miles) => {
    if (useMetric) return `${(miles * 1.60934).toFixed(1)} km`;
    return `${miles.toFixed(1)} mi`;
  }, [useMetric]);

  // Get user geolocation with status tracking
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoStatus("unavailable");
      setLocationLabel("Geolocation unavailable");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ lat: latitude, lng: longitude });
        setGeoStatus("granted");
        setLocationLabel(`${latitude.toFixed(2)}\u00B0N, ${Math.abs(longitude).toFixed(2)}\u00B0${longitude < 0 ? "W" : "E"}`);
      },
      (err) => {
        console.warn("Geolocation blocked/failed, using default center.", err);
        setGeoStatus("denied");
        setLocationLabel("Location access denied");
      },
      { timeout: 8000, maximumAge: 300000 }
    );
  }, []);

  // Fetch active listings offline-first
  const fetchLocalListings = async () => {
    try {
      setLoading(true);
      const local = await db.localListings.toArray();
      const cached = await db.listings.toArray();
      const merged = [...cached];
      const cachedIds = new Set(cached.map((l) => Number(l.id)));
      for (const l of local) {
        if (!cachedIds.has(Number(l.id))) merged.push(l);
      }

      const activeListings = [];
      for (const item of merged) {
        const sellerAddr = item.seller || "";
        let hash = 0;
        for (let i = 0; i < sellerAddr.length; i++) {
          hash = sellerAddr.charCodeAt(i) + ((hash << 5) - hash);
        }
        // Fuzz offsets relative to USER location (not hardcoded SF)
        const latOffsetVal = ((hash & 0xFF) / 255 - 0.5) * 0.08;
        const lngOffsetVal = (((hash >> 8) & 0xFF) / 255 - 0.5) * 0.08;
        const fuzzedLocation = {
          lat: userLocation.lat + latOffsetVal,
          lng: userLocation.lng + lngOffsetVal
        };
        const zoneHash = "0x" + Math.abs(hash).toString(16).padStart(8, "0");
        const latOffset = fuzzedLocation.lat - userLocation.lat;
        const lngOffset = fuzzedLocation.lng - userLocation.lng;
        const latMiles = latOffset * 69;
        const lngMiles = lngOffset * 55;
        const distance = Math.sqrt(latMiles * latMiles + lngMiles * lngMiles);

        activeListings.push({
          listingId: item.isBatch ? Number(item.listingId) : Number(item.tokenId || item.id),
          spawnId: item.spawnId ? Number(item.spawnId) : 0,
          quantity: item.quantity ? Number(item.quantity) : 1,
          pricePerFish: parseEther(item.price || "0").toString(),
          seller: sellerAddr,
          speciesId: Number(item.speciesId || 0),
          speciesName: item.commonName || "Unknown Specimen",
          latOffset, lngOffset, latMiles, lngMiles, distance,
          fuzzedLocation, zoneHash,
          isBatch: !!item.isBatch,
          tokenId: item.tokenId
        });
      }
      setListings(activeListings);
    } catch (err) {
      console.error("Failed to fetch map listings from Dexie:", err);
    } finally {
      setLoading(false);
      // Trigger scanning → reveal transition
      setTimeout(() => {
        setScanningPhase(false);
        let progress = 0;
        const step = () => {
          progress += 0.03;
          setDotRevealProgress(Math.min(1, progress));
          if (progress < 1) dotRevealTimerRef.current = requestAnimationFrame(step);
        };
        dotRevealTimerRef.current = requestAnimationFrame(step);
      }, 1500);
    }
  };

  useEffect(() => {
    fetchLocalListings();
    return () => { if (dotRevealTimerRef.current) cancelAnimationFrame(dotRevealTimerRef.current); };
  }, [contractAddress, marketplaceAddress, userLocation]);

  // Persist distance unit preference
  useEffect(() => {
    localStorage.setItem("aquadex_distance_unit", useMetric ? "km" : "mi");
  }, [useMetric]);

  // Dot clustering: group nearby dots
  const clusteredListings = useMemo(() => {
    if (!listings.length) return { clusters: [], singles: [] };
    const CLUSTER_DISTANCE_MILES = rangeFilter * 0.06;
    const items = listings.filter((l) => l.distance <= rangeFilter);
    const used = new Set();
    const clusters = [];
    const singles = [];

    for (let i = 0; i < items.length; i++) {
      if (used.has(i)) continue;
      const group = [items[i]];
      used.add(i);
      for (let j = i + 1; j < items.length; j++) {
        if (used.has(j)) continue;
        const dx = items[i].lngMiles - items[j].lngMiles;
        const dy = items[i].latMiles - items[j].latMiles;
        if (Math.sqrt(dx * dx + dy * dy) < CLUSTER_DISTANCE_MILES) {
          group.push(items[j]);
          used.add(j);
        }
      }
      if (group.length > 1) {
        const avgLat = group.reduce((s, g) => s + g.latMiles, 0) / group.length;
        const avgLng = group.reduce((s, g) => s + g.lngMiles, 0) / group.length;
        clusters.push({ items: group, latMiles: avgLat, lngMiles: avgLng, count: group.length });
      } else {
        singles.push(group[0]);
      }
    }
    return { clusters, singles };
  }, [listings, rangeFilter]);

  // Count visible items for empty state detection
  const visibleCount = useMemo(() => {
    return listings.filter(l => l.distance <= rangeFilter).length;
  }, [listings, rangeFilter]);

  // Mock events data
  const mockEvents = [
    { id: "evt-1", name: "Silicon Valley Aqua Swap Meet (Active)", type: "swap-meets", latMiles: 2.5, lngMiles: -3.0, description: "Officially active regional swap meet and expo. Special event Loyalty Rewards multiplier active inside bounding zone!", distance: 3.9 },
    { id: "evt-2", name: "Downtown Guppy Public Drop Point", type: "public-drops", latMiles: -4.0, lngMiles: 5.0, description: "Public drop-off point for local pickup transfers.", distance: 6.4 }
  ];

  // Radar drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || viewMode !== "radar") return;

    const ctx = canvas.getContext("2d");
    let angle = 0;
    let pulseScale = 1;
    let pulseDirection = 1;

    function drawSweepAndCenter(cX, cY, maxR, a) {
      ctx.beginPath();
      ctx.arc(cX, cY, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#60a5fa";
      ctx.shadowColor = "#60a5fa";
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.save();
      ctx.translate(cX, cY);
      ctx.rotate(a);
      const sweepGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, maxR);
      sweepGrad.addColorStop(0, sweepGradientStart);
      sweepGrad.addColorStop(0.8, sweepGradientMid);
      sweepGrad.addColorStop(1, sweepGradientEnd);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, maxR, -0.08, 0);
      ctx.lineTo(0, 0);
      ctx.fillStyle = sweepGrad;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(maxR, 0);
      ctx.strokeStyle = sweepLineStroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    const drawRadar = () => {
      ctx.fillStyle = "#090d16";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const maxRadius = Math.min(centerX, centerY) - 20;

      // Concentric rings
      ctx.strokeStyle = radarStrokeColor;
      ctx.lineWidth = 1;
      for (let r = 1; r <= 4; r++) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, (maxRadius / 4) * r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = radarLabelColor;
        ctx.font = "9px monospace";
        const labelVal = useMetric
          ? `${Math.round((rangeFilter / 4) * r * 1.60934)} km`
          : `${Math.round((rangeFilter / 4) * r)} mi`;
        ctx.fillText(labelVal, centerX + 5, centerY - (maxRadius / 4) * r + 12);
      }

      // Crosshairs
      ctx.beginPath();
      ctx.moveTo(centerX - maxRadius, centerY);
      ctx.lineTo(centerX + maxRadius, centerY);
      ctx.moveTo(centerX, centerY - maxRadius);
      ctx.lineTo(centerX, centerY + maxRadius);
      ctx.strokeStyle = radarStrokeColor;
      ctx.stroke();

      pulseScale += 0.008 * pulseDirection;
      if (pulseScale > 1.15 || pulseScale < 0.95) pulseDirection *= -1;

      // Scanning phase overlay
      if (scanningPhase) {
        const scanOp = 0.5 + 0.5 * Math.sin(Date.now() / 300);
        ctx.fillStyle = isPro ? `rgba(168,85,247,${scanOp * 0.8})` : `rgba(251,191,36,${scanOp * 0.8})`;
        ctx.font = "bold 13px 'Inter', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Scanning local zone...", centerX, centerY + maxRadius + 10);
        ctx.textAlign = "start";
        drawSweepAndCenter(centerX, centerY, maxRadius, angle);
        angle = (angle + 0.02) % (Math.PI * 2);
        animationRef.current = requestAnimationFrame(drawRadar);
        return;
      }

      const dotsCoords = [];
      const currentReveal = dotRevealProgress;

      // Draw clusters
      clusteredListings.clusters.forEach((cluster) => {
        const x = centerX + (cluster.lngMiles / rangeFilter) * maxRadius;
        const y = centerY - (cluster.latMiles / rangeFilter) * maxRadius;
        const dotAngle = Math.atan2(y - centerY, x - centerX);
        const normAngle = (dotAngle + Math.PI * 2) % (Math.PI * 2);
        const threshold = normAngle / (Math.PI * 2);
        if (currentReveal < threshold) return;
        const entryScale = Math.min(1, (currentReveal - threshold) * 5);

        dotsCoords.push({ x, y, listing: cluster.items[0], isCluster: true, cluster });

        const badgeR = 14 * entryScale;
        ctx.beginPath();
        ctx.arc(x, y, badgeR, 0, Math.PI * 2);
        ctx.fillStyle = isPro ? "rgba(168,85,247,0.35)" : "rgba(251,191,36,0.35)";
        ctx.fill();
        ctx.strokeStyle = isPro ? "rgba(168,85,247,0.7)" : "rgba(251,191,36,0.7)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px 'Inter', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(cluster.count), x, y);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
      });

      // Draw singles with reveal animation
      clusteredListings.singles.forEach((item) => {
        if (item.distance > rangeFilter) return;
        const x = centerX + (item.lngMiles / rangeFilter) * maxRadius;
        const y = centerY - (item.latMiles / rangeFilter) * maxRadius;
        const dotAngle = Math.atan2(y - centerY, x - centerX);
        const normAngle = (dotAngle + Math.PI * 2) % (Math.PI * 2);
        const threshold = normAngle / (Math.PI * 2);
        if (currentReveal < threshold) return;
        const entryScale = Math.min(1, (currentReveal - threshold) * 5);

        dotsCoords.push({ x, y, listing: item });
        const isActive = (selectedListing && selectedListing.listingId === item.listingId) ||
                         (hoveredDot && hoveredDot.listingId === item.listingId);

        const relMul = maxRadius / rangeFilter;
        // 3-mile fuzz boundary
        ctx.beginPath();
        ctx.arc(x, y, 3 * relMul * entryScale * (isActive ? pulseScale : 1), 0, Math.PI * 2);
        ctx.strokeStyle = isActive ? pulseCircleStroke : pulseCircleStrokeInactive;
        ctx.stroke();
        // 1-mile zone
        ctx.beginPath();
        ctx.arc(x, y, 1 * relMul * entryScale * (isActive ? pulseScale : 1), 0, Math.PI * 2);
        ctx.fillStyle = isActive ? regionFillColor : regionFillColorInactive;
        ctx.fill();
        ctx.strokeStyle = isActive ? regionStrokeColor : regionStrokeColorInactive;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.lineWidth = 1;
        // Center dot
        ctx.beginPath();
        ctx.arc(x, y, 4 * entryScale, 0, Math.PI * 2);
        ctx.fillStyle = isActive
          ? (isPro ? "#c084fc" : "#fbbf24")
          : (isPro ? "rgba(168,85,247,0.6)" : "rgba(251,191,36,0.6)");
        ctx.fill();
      });

      // Events
      mockEvents.forEach((evt) => {
        if (eventFilter !== "all" && eventFilter !== evt.type) return;
        if (evt.distance > rangeFilter) return;
        const x = centerX + (evt.lngMiles / rangeFilter) * maxRadius;
        const y = centerY - (evt.latMiles / rangeFilter) * maxRadius;
        dotsCoords.push({ x, y, listing: { ...evt, isEvent: true } });
        const isActive = selectedListing && selectedListing.id === evt.id;
        const rgb = evt.type === "swap-meets" ? "34,197,94" : "56,189,248";
        ctx.beginPath();
        ctx.arc(x, y, 12 * (isActive ? pulseScale : 1), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb}, ${isActive ? 0.25 : 0.15})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${rgb}, 0.7)`;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
      });

      mappedDotsRef.current = dotsCoords;
      drawSweepAndCenter(centerX, centerY, maxRadius, angle);
      angle = (angle + 0.01) % (Math.PI * 2);
      animationRef.current = requestAnimationFrame(drawRadar);
    };

    drawRadar();
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [listings, rangeFilter, selectedListing, hoveredDot, viewMode, scanningPhase, dotRevealProgress, clusteredListings, useMetric, eventFilter]);

  // Leaflet map view effect
  useEffect(() => {
    if (viewMode !== "map" || !mapContainerRef.current) return;
    // Dynamically load Leaflet CSS+JS if not already loaded
    let L = window.L;
    if (!L) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = () => initLeaflet();
      document.head.appendChild(script);
    } else {
      initLeaflet();
    }

    function initLeaflet() {
      const L = window.L;
      if (!L || !mapContainerRef.current) return;
      // Clear previous
      if (mapContainerRef.current._leaflet_id) {
        mapContainerRef.current.innerHTML = "";
        mapContainerRef.current._leaflet_id = null;
      }
      const map = L.map(mapContainerRef.current, { center: [userLocation.lat, userLocation.lng], zoom: 12, zoomControl: true, attributionControl: false });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { subdomains: "abcd", maxZoom: 19 }).addTo(map);
      // User location marker
      L.circleMarker([userLocation.lat, userLocation.lng], { radius: 8, fillColor: "#60a5fa", fillOpacity: 1, color: "#fff", weight: 2 }).addTo(map).bindPopup("You are here");
      // Listing markers
      listings.filter(l => l.distance <= rangeFilter).forEach((item) => {
        const marker = L.circleMarker([item.fuzzedLocation.lat, item.fuzzedLocation.lng], {
          radius: 6, fillColor: isPro ? "#a855f7" : "#f59e0b", fillOpacity: 0.8, color: "rgba(255,255,255,0.3)", weight: 1
        }).addTo(map);
        marker.bindPopup(`<strong>${item.speciesName}</strong><br/>Qty: ${item.quantity}<br/>~${formatDistance(item.distance)} away`);
        marker.on("click", () => { setSelectedListing(item); setMobileDrawerOpen(true); haptic("tap"); });
      });
    }
    return () => {
      if (mapContainerRef.current) {
        mapContainerRef.current.innerHTML = "";
        if (mapContainerRef.current._leaflet_id) mapContainerRef.current._leaflet_id = null;
      }
    };
  }, [viewMode, listings, rangeFilter, userLocation]);

  // Canvas click handler
  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    const clickedDot = mappedDotsRef.current.find((dot) => {
      const dist = Math.sqrt((dot.x - clickX) ** 2 + (dot.y - clickY) ** 2);
      return dist <= (18 * scaleX);
    });

    if (clickedDot) {
      if (clickedDot.isCluster) {
        const neededRange = Math.ceil(Math.max(...clickedDot.cluster.items.map(i => i.distance)) * 1.3);
        setRangeFilter(Math.min(25, Math.max(5, neededRange)));
      } else {
        setSelectedListing(clickedDot.listing);
        setMobileDrawerOpen(true);
        haptic("tap");
      }
    } else {
      setSelectedListing(null);
      setHoveredDot(null);
    }
  };

  // Hover handler for tooltip
  const handleCanvasMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);

    const nearDot = mappedDotsRef.current.find((dot) => {
      return Math.sqrt((dot.x - mouseX) ** 2 + (dot.y - mouseY) ** 2) <= (18 * scaleX);
    });

    if (nearDot && nearDot.listing) {
      setHoveredDot(nearDot.listing);
      if (tooltipRef.current) {
        tooltipRef.current.style.left = `${(nearDot.x / canvas.width) * rect.width + 12}px`;
        tooltipRef.current.style.top = `${(nearDot.y / canvas.height) * rect.height - 30}px`;
        tooltipRef.current.style.opacity = "1";
      }
    } else {
      setHoveredDot(null);
      if (tooltipRef.current) tooltipRef.current.style.opacity = "0";
    }
  };

  const handleCanvasLeave = () => {
    setHoveredDot(null);
    if (tooltipRef.current) tooltipRef.current.style.opacity = "0";
  };

  // Mobile drawer touch handlers
  const handleDrawerTouchStart = (e) => { dragStartY.current = e.touches[0].clientY; };
  const handleDrawerTouchMove = (e) => {
    if (!dragStartY.current || !drawerRef.current) return;
    const diff = e.touches[0].clientY - dragStartY.current;
    if (diff > 0) drawerRef.current.style.transform = `translateY(${diff}px)`;
  };
  const handleDrawerTouchEnd = (e) => {
    if (!dragStartY.current || !drawerRef.current) return;
    const diff = e.changedTouches[0].clientY - dragStartY.current;
    if (diff > 100) { setMobileDrawerOpen(false); setSelectedListing(null); }
    drawerRef.current.style.transform = "";
    dragStartY.current = null;
  };

  const truncateAddress = (addr) => addr ? `${addr.substring(0, 6)}...${addr.substring(38)}` : "";
  const handleCheckoutTrigger = (item) => { setCheckoutListing(item); setCheckoutQuantity(1); setIsHandshakeOpen(true); };

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", alignItems: "flex-start", position: "relative" }}>
      {/* ═══ Left: Radar / Map Card ═══ */}
      <div className="glass-card" style={{ flex: "1 1 500px", padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem", borderRadius: "var(--radius-md)", background: "rgba(15, 23, 42, 0.75)", border: `1px solid ${themeCardBorder}` }}>

        {/* Header row: title + controls */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <h3 style={{ fontSize: "1.25rem", fontWeight: "700", color: "#fff", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span>{viewMode === "radar" ? "\uD83E\uDDED" : "\uD83D\uDDFA\uFE0F"}</span> Local Proximity Field
            </h3>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              Hobbyist boundaries fuzzed within 3-mile zones
            </span>
          </div>

          {/* View Mode Toggle: Radar | Map */}
          <div style={{ display: "flex", gap: "0.25rem", background: "rgba(0,0,0,0.3)", padding: "2px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.04)" }}>
            {["radar", "map"].map((mode) => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{ padding: "0.25rem 0.75rem", fontSize: "0.72rem", fontWeight: "600", border: "none", borderRadius: "4px", cursor: "pointer", background: viewMode === mode ? (isPro ? "var(--accent-pro)" : "var(--accent-amber)") : "transparent", color: viewMode === mode ? (isPro ? "#fff" : "#0f172a") : "var(--text-muted)", textTransform: "capitalize", transition: "all 0.2s" }}>
                {mode === "radar" ? "\uD83D\uDCE1 Radar" : "\uD83D\uDDFA\uFE0F Map"}
              </button>
            ))}
          </div>
        </div>

        {/* Geolocation warning banner */}
        {geoStatus === "denied" && (
          <div style={{ padding: "0.6rem 0.85rem", background: "rgba(251, 146, 60, 0.08)", border: "1px solid rgba(251, 146, 60, 0.25)", borderRadius: "8px", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.72rem", color: "rgba(251, 191, 36, 0.9)" }}>
            <span>⚠️</span>
            <span>Location access was denied. Results are centered on a default area and may not reflect your actual neighborhood. <button onClick={() => window.location.reload()} style={{ background: "none", border: "none", color: themeAccentColor, cursor: "pointer", textDecoration: "underline", fontSize: "0.72rem", padding: 0 }}>Retry</button></span>
          </div>
        )}

        {/* Controls row: filters + range + units */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          {/* Event Filter */}
          <div style={{ display: "flex", gap: "0.25rem", background: "rgba(0,0,0,0.3)", padding: "2px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.04)" }}>
            {["all", "swap-meets", "public-drops"].map((type) => (
              <button key={type} onClick={() => { setEventFilter(type); setSelectedListing(null); }} style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem", fontWeight: "600", border: "none", borderRadius: "4px", cursor: "pointer", background: eventFilter === type ? (isPro ? "var(--accent-pro)" : "var(--accent-blue)") : "transparent", color: eventFilter === type ? (isPro ? "#fff" : "#0f172a") : "var(--text-muted)", transition: "all 0.2s" }}>
                {type === "all" ? "All" : type === "swap-meets" ? "Swap Meets" : "Drops"}
              </button>
            ))}
          </div>

          {/* Range Toggles */}
          <div style={{ display: "flex", gap: "0.25rem", background: "rgba(0,0,0,0.3)", padding: "2px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.04)" }}>
            {[5, 10, 25].map((val) => (
              <button key={val} onClick={() => { setRangeFilter(val); setSelectedListing(null); }} style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem", fontWeight: "600", border: "none", borderRadius: "4px", cursor: "pointer", background: rangeFilter === val ? primaryThemeColor : "transparent", color: rangeFilter === val ? (isPro ? "#fff" : "#0f172a") : "var(--text-muted)", transition: "all 0.2s" }}>
                {useMetric ? `${Math.round(val * 1.60934)}km` : `${val}mi`}
              </button>
            ))}
          </div>

          {/* Distance Unit Toggle */}
          <button onClick={() => setUseMetric(!useMetric)} style={{ padding: "0.25rem 0.6rem", fontSize: "0.65rem", fontWeight: "600", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "4px", cursor: "pointer", background: "rgba(0,0,0,0.2)", color: "var(--text-muted)", transition: "all 0.2s" }} title="Toggle distance units">
            {useMetric ? "km \u2192 mi" : "mi \u2192 km"}
          </button>
        </div>

        {/* Canvas / Map Area */}
        <div style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center" }}>
          {viewMode === "radar" ? (
            <>
              <canvas
                ref={canvasRef}
                width={480}
                height={480}
                onClick={handleCanvasClick}
                onMouseMove={handleCanvasMove}
                onMouseLeave={handleCanvasLeave}
                style={{ maxWidth: "100%", aspectRatio: "1/1", borderRadius: "50%", border: isPro ? "2px solid rgba(168,85,247,0.25)" : "2px solid rgba(251,191,36,0.15)", boxShadow: isPro ? "0 0 32px rgba(168,85,247,0.15), inset 0 0 40px rgba(168,85,247,0.02)" : "0 0 32px rgba(0,0,0,0.5), inset 0 0 40px rgba(251,191,36,0.02)", cursor: "pointer" }}
              />
              {/* Hover Tooltip */}
              <div ref={tooltipRef} style={{ position: "absolute", opacity: 0, pointerEvents: "none", background: "rgba(15,12,31,0.95)", border: `1px solid ${themeCardBorder}`, borderRadius: "8px", padding: "0.4rem 0.65rem", fontSize: "0.7rem", color: "#fff", whiteSpace: "nowrap", transition: "opacity 0.15s", zIndex: 100, backdropFilter: "blur(8px)" }}>
                {hoveredDot && (
                  <>
                    <strong>{hoveredDot.isEvent ? hoveredDot.name : hoveredDot.speciesName || "Breeder"}</strong>
                    {hoveredDot.distance != null && (
                      <span style={{ marginLeft: "0.5rem", color: "var(--text-muted)" }}>
                        {formatDistance(hoveredDot.distance)}
                      </span>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            /* Leaflet Map View */
            <div ref={mapContainerRef} style={{ width: "100%", height: "480px", borderRadius: "12px", overflow: "hidden", border: `1px solid ${themeCardBorder}` }} />
          )}
        </div>

        {/* Location badge + stats bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.3rem 0.65rem", background: "rgba(0,0,0,0.25)", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.04)" }}>
            <span style={{ fontSize: "0.65rem" }}>{geoStatus === "granted" ? "\uD83D\uDCCD" : "\u26A0\uFE0F"}</span>
            <span style={{ fontSize: "0.68rem", color: geoStatus === "granted" ? "var(--text-secondary)" : "rgba(251,146,60,0.8)" }}>
              {locationLabel}
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", padding: "0.3rem 0.5rem", background: "rgba(0,0,0,0.2)", borderRadius: "10px" }}>
              <strong style={{ color: themeAccentColor }}>{visibleCount}</strong> nearby
            </span>
            <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", padding: "0.3rem 0.5rem", background: "rgba(0,0,0,0.2)", borderRadius: "10px" }}>
              <strong style={{ color: themeAccentColor }}>{clusteredListings.clusters.length}</strong> clusters
            </span>
          </div>
        </div>

        {/* No breeders in range empty state */}
        {!scanningPhase && visibleCount === 0 && (
          <div style={{ textAlign: "center", padding: "1.5rem 1rem", background: "rgba(0,0,0,0.15)", borderRadius: "10px", border: "1px dashed rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>{"\uD83D\uDD2D"}</div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", margin: "0 0 0.5rem", fontWeight: "500" }}>
              No breeders found within {useMetric ? `${Math.round(rangeFilter * 1.60934)} km` : `${rangeFilter} mi`}
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "0.7rem", margin: 0 }}>
              Try expanding your range or check back later as more breeders list.
            </p>
            {rangeFilter < 25 && (
              <button onClick={() => setRangeFilter(25)} style={{ marginTop: "0.75rem", padding: "0.4rem 1rem", fontSize: "0.72rem", fontWeight: "600", background: isPro ? "rgba(168,85,247,0.15)" : "rgba(251,191,36,0.12)", border: `1px solid ${themeCardBorder}`, borderRadius: "6px", color: themeAccentColor, cursor: "pointer", transition: "all 0.2s" }}>
                Expand to {useMetric ? `${Math.round(25 * 1.60934)} km` : "25 mi"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ═══ Right: Detail Panel (Desktop) ═══ */}
      <div className="local-map-detail-desktop" style={{ width: "360px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {renderDetailContent()}
      </div>

      {/* ═══ Mobile Bottom Drawer ═══ */}
      <div className="local-map-mobile-drawer" ref={drawerRef} onTouchStart={handleDrawerTouchStart} onTouchMove={handleDrawerTouchMove} onTouchEnd={handleDrawerTouchEnd}
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9000, background: "rgba(15, 23, 42, 0.97)", borderTop: `1px solid ${themeCardBorder}`, borderRadius: "16px 16px 0 0", backdropFilter: "blur(16px)", transform: mobileDrawerOpen ? "translateY(0)" : "translateY(100%)", transition: "transform 0.3s ease", maxHeight: "70vh", overflowY: "auto", padding: "1rem 1.25rem 2rem", display: "none" /* shown via CSS media query */ }}>
        {/* Drag handle */}
        <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "rgba(255,255,255,0.15)", margin: "0 auto 1rem" }} />
        {renderDetailContent()}
      </div>

      {/* Handshake Protocol Checkout Modal */}
      {checkoutListing && (
        <HandshakeVerification
          isOpen={isHandshakeOpen}
          onClose={() => { setIsHandshakeOpen(false); setCheckoutListing(null); }}
          listing={checkoutListing}
          quantity={checkoutQuantity}
          marketplaceAddress={marketplaceAddress}
          walletAccount={walletAccount}
          onSuccess={() => { fetchLocalListings(); setSelectedListing(null); }}
        />
      )}

      {/* Responsive CSS for mobile drawer */}
      <style>{`
        .local-map-detail-desktop { display: flex; }
        .local-map-mobile-drawer { display: none !important; }
        @media (max-width: 860px) {
          .local-map-detail-desktop { display: none !important; }
          .local-map-mobile-drawer { display: block !important; }
        }
      `}</style>
    </div>
  );

  // Shared detail panel content (used by both desktop panel and mobile drawer)
  function renderDetailContent() {
    return (
      <div className="glass-card" style={{ padding: "1.5rem", background: "rgba(15, 23, 42, 0.75)", border: `1px solid ${themeCardBorder}`, borderRadius: "var(--radius-md)", minHeight: "280px", display: "flex", flexDirection: "column", justifyContent: selectedListing ? "space-between" : "center", alignItems: selectedListing ? "stretch" : "center", textAlign: selectedListing ? "left" : "center", boxShadow: isPro ? "0 0 24px rgba(168,85,247,0.1)" : "0 12px 32px rgba(0,0,0,0.4)" }}>
        {selectedListing ? (
          selectedListing.isEvent ? renderEventDetail() : renderBreederDetail()
        ) : (
          <div style={{ padding: "2rem" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>{"\uD83D\uDCE1"}</div>
            <h4 style={{ color: "#fff", fontSize: "0.95rem", fontWeight: "600", marginBottom: "0.25rem" }}>No Breeder Selected</h4>
            <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", margin: 0 }}>
              {viewMode === "radar"
                ? "Click on any glowing dot on the radar to view details and initiate checkout."
                : "Tap any marker on the map to view breeder details."}
            </p>
          </div>
        )}
      </div>
    );
  }

  function renderEventDetail() {
    return (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <span style={{ fontSize: "0.65rem", color: selectedListing.type === "swap-meets" ? "var(--accent-green)" : "var(--accent-blue)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: "700" }}>
              {"\uD83E\uDDED"} {selectedListing.type === "swap-meets" ? "Active Swap Meet Event" : "Public Drop Location"}
            </span>
            <h4 style={{ fontSize: "1.15rem", fontWeight: "700", color: "#fff", marginTop: "0.25rem" }}>{selectedListing.name}</h4>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem", fontSize: "0.85rem" }}>
            <p style={{ color: "var(--text-secondary)", margin: 0, lineHeight: "1.4" }}>{selectedListing.description}</p>
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: "0.5rem", marginTop: "0.5rem" }}>
              <span style={{ color: "var(--text-secondary)" }}>Distance</span>
              <strong style={{ color: "#fff" }}>{formatDistance(selectedListing.distance)}</strong>
            </div>
          </div>
        </div>
        <div style={{ marginTop: "1.5rem", padding: "0.75rem", background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: "6px", fontSize: "0.78rem", color: "var(--accent-green)", textAlign: "center" }}>
          {"\uD83C\uDF89"} Swap Meet Active! Orders claimed in this zone earn 2x Loyalty Rewards!
        </div>
      </>
    );
  }

  function renderBreederDetail() {
    return (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Selected Local Breeder</span>
            <h4 style={{ fontSize: "1.15rem", fontWeight: "700", color: "#fff", marginTop: "0.25rem" }}>{selectedListing.speciesName}</h4>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem", fontSize: "0.85rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.04)", paddingBottom: "0.5rem" }}>
              <span style={{ color: "var(--text-secondary)" }}>Breeder</span>
              <code style={{ color: "#fff", fontFamily: "monospace", fontSize: "0.75rem" }}>{truncateAddress(selectedListing.seller)}</code>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.04)", paddingBottom: "0.5rem" }}>
              <span style={{ color: "var(--text-secondary)" }}>Available</span>
              <strong style={{ color: "#fff" }}>{selectedListing.quantity} Fish</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.04)", paddingBottom: "0.5rem" }}>
              <span style={{ color: "var(--text-secondary)" }}>Price / Fish</span>
              <strong style={{ color: primaryThemeColor }}>${(parseFloat(formatEther(selectedListing.pricePerFish)) * 1000).toFixed(2)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.04)", paddingBottom: "0.5rem" }}>
              <span style={{ color: "var(--text-secondary)" }}>Proximity</span>
              <strong style={{ color: "var(--accent-blue)", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                {"\u26A1"} {formatDistance(selectedListing.distance)}
              </strong>
            </div>
          </div>
        </div>
        {/* Checkout controls */}
        <div style={{ marginTop: "1.5rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <label htmlFor="map-buy-qty" style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: "600" }}>Quantity:</label>
            <input type="number" id="map-buy-qty" min="1" max={selectedListing.quantity} value={checkoutQuantity} onChange={(e) => setCheckoutQuantity(Math.min(selectedListing.quantity, Math.max(1, Number(e.target.value))))} style={{ width: "60px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", color: "#fff", fontSize: "0.8rem", padding: "0.25rem 0.5rem", textAlign: "center", outline: "none" }} />
          </div>
          <button onClick={() => handleCheckoutTrigger(selectedListing)} className={isPro ? "btn-primary-pro" : "btn-primary"} style={isPro ? { width: "100%", justifyContent: "center", padding: "0.75rem" } : { background: "var(--accent-amber)", boxShadow: "0 0 16px var(--accent-amber-glow)", color: "#0f172a", fontWeight: "700", padding: "0.75rem", border: "none", borderRadius: "6px", cursor: "pointer", transition: "all 0.2s", width: "100%" }}>
            {"\uD83E\uDD1D"} Settle via Local Pickup
          </button>
        </div>
      </>
    );
  }
}
