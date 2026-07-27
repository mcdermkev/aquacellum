import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { HandshakeVerification } from "./HandshakeVerification";
import { normalizePriceCents, formatPriceCents } from "../services/catalogQuery";
import { db } from "../db";
import { haptic } from "../utils/haptics";
import { relayGetOrders } from "../services/relayer";
import { fetchPickupForOrder } from "../services/pickupCoordinationApi";
import { FULFILLMENT_METHODS, ORDER_STATES } from "../services/marketplaceStateMachine";
import { resolveMethod, resolveCanonicalState } from "../services/buyerOrderView";

/**
 * ⚠️ UNMOUNTED — this component is not reachable in the app (Fish Finder T15).
 *
 * The "Local Sellers" / "Local Map" tab was retired: it is not in `VALID_TABS`,
 * App.jsx no longer imports or renders it, and `/app/map` redirects to
 * `/app/orders`. Both of its jobs already have better homes:
 *
 *   - Finding sellers is the Marketplace's job. The proximity discovery this
 *     map implied was fabricated (wallet-hash offsets from downtown SF) and was
 *     removed under Decision D3; the real opt-in metro-zone version (T15b) is
 *     unbuilt, so there is nothing to plot.
 *   - A pickup meetup belongs to the order that created it. `PickupPanel` (My
 *     Orders) already shows the real pin, address text, "Open in Maps"
 *     directions, seller availability slots, and handoff confirmation — strictly
 *     more than this map's mile-offset-from-geolocation pins.
 *
 * Kept on disk (rather than deleted) as the starting scaffolding for T15b: the
 * radar canvas, Leaflet loader, clustering, and responsive detail/drawer layout
 * are reusable once there is real zone data to show. If T15b is dropped, delete
 * this file and `__tests__/localBreederMapPickups.catalog.test.js` with it.
 *
 * Do not re-mount it without real data — the guard test enforces the
 * no-fabricated-data invariants that made retiring it necessary.
 */

// Terminal states where a pickup meet is no longer relevant to show on the map.
const PICKUP_MAP_TERMINAL_STATES = new Set([
  ORDER_STATES.HANDOFF_CONFIRMED,
  ORDER_STATES.CERTIFICATE_TRANSFERRED,
  ORDER_STATES.SELLER_PAID,
  ORDER_STATES.COMPLETED,
  ORDER_STATES.REFUNDED,
  ORDER_STATES.CANCELLED,
]);

export function LocalBreederMap({ contractAddress, marketplaceAddress, walletAccount, casualModeActive }) {
  const navigate = useNavigate();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanningPhase, setScanningPhase] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);
  const [hoveredDot, setHoveredDot] = useState(null);
  const [rangeFilter, setRangeFilter] = useState(10);
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

  // Task 25: "My Pickups" layer — the buyer's own active PREPAID_PICKUP
  // orders, drawn as REAL (un-fuzzed) pins, same technique as `mockEvents`
  // below (real latMiles/lngMiles offsets from userLocation, not the fuzzed
  // seller-hash offsets `listings` uses). The discovery radar's fuzzed dots
  // are otherwise completely unchanged.
  const [myPickups, setMyPickups] = useState([]);
  const [showMyPickups, setShowMyPickups] = useState(true);

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
      // No fabricated seller locations (Decision D3 / T15). The old radar
      // placed every seller at a wallet-hash offset from the buyer — pure
      // fiction. There is no real, public per-seller location today (pickup
      // coordinates are order-scoped/private by design), so until the real
      // opt-in zone-discovery feature (T15) lands, the discovery radar plots
      // NO seller dots. Only the real "My Pickups" layer (order-scoped, actual
      // pickup coordinates) is shown.
      setListings([]);
    } catch (err) {
      console.error("Failed to fetch map listings from Dexie:", err);
    } finally {
      setLoading(false);
      // No "Scanning local zone..." phase (Decision D3 / T15). It held the map
      // for 1.5s and swept the radar as if querying nearby sellers; nothing is
      // queried, and it also delayed the user's real pickup pins. The map now
      // renders what it has immediately.
      setScanningPhase(false);
      setDotRevealProgress(1);
    }
  };

  useEffect(() => {
    fetchLocalListings();
    return () => { if (dotRevealTimerRef.current) cancelAnimationFrame(dotRevealTimerRef.current); };
  }, [contractAddress, marketplaceAddress, userLocation]);

  // Task 25: fetch the buyer's own active prepaid-pickup orders + their
  // resolved (real, un-fuzzed) pickup spot. Uses the same order-scoped
  // reveal gate every buyer surface uses (fetchPickupForOrder) — this map
  // never reads pickup_locations directly, so the reveal rule (exact
  // coordinates only to the buyer/seller on that order) still holds.
  useEffect(() => {
    if (!walletAccount) { setMyPickups([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const { purchases = [] } = await relayGetOrders(walletAccount);
        const activePickupOrders = purchases.filter((o) => {
          if (o.role !== "Buyer") return false;
          if (resolveMethod(o) !== FULFILLMENT_METHODS.PREPAID_PICKUP) return false;
          return !PICKUP_MAP_TERMINAL_STATES.has(resolveCanonicalState(o));
        });

        const resolved = [];
        for (const order of activePickupOrders) {
          try {
            const res = await fetchPickupForOrder(order.key);
            if (cancelled) return;
            const loc = res?.location;
            if (!res?.success || loc?.lat == null || loc?.lng == null) continue;

            const latOffset = loc.lat - userLocation.lat;
            const lngOffset = loc.lng - userLocation.lng;
            resolved.push({
              id: `pickup-${order.purchaseId}`,
              orderKey: `batch-${order.purchaseId}`,
              purchaseId: order.purchaseId,
              label: loc.label || order.commonName || "Pickup",
              latMiles: latOffset * 69,
              lngMiles: lngOffset * 55,
              distance: Math.sqrt((latOffset * 69) ** 2 + (lngOffset * 55) ** 2),
            });
          } catch {
            // Non-fatal — skip this order's pin rather than failing the whole layer.
          }
        }
        if (!cancelled) setMyPickups(resolved);
      } catch {
        if (!cancelled) setMyPickups([]);
      }
    })();
    return () => { cancelled = true; };
  }, [walletAccount, userLocation]);

  const handleOpenPickupOrder = useCallback((pickup) => {
    navigate(`/app/orders?order=${encodeURIComponent(pickup.orderKey)}`);
  }, [navigate]);

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


  // No community-events layer at all (Decision D3 / T15). This used to be a
  // hardcoded `mockEvents` array of invented swap-meets and "public drop
  // points"; emptying it left an events pipeline that could never carry
  // anything, so the layer (draw pass, filter control, and detail panel) is
  // gone entirely. It returns when a real events source exists.

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

      // Task 25: "My Pickups" — the buyer's own real (un-fuzzed) pickup pins,
      // drawn from real latMiles/lngMiles offsets and visually distinct (a pin
      // marker) so a buyer never confuses their own confirmed meet spot with
      // any future discovery marker.
      if (showMyPickups) {
        myPickups.forEach((pickup) => {
          if (pickup.distance > rangeFilter) return;
          const x = centerX + (pickup.lngMiles / rangeFilter) * maxRadius;
          const y = centerY - (pickup.latMiles / rangeFilter) * maxRadius;
          dotsCoords.push({ x, y, listing: { ...pickup, isMyPickup: true } });
          const isActive = selectedListing && selectedListing.id === pickup.id;
          ctx.beginPath();
          ctx.arc(x, y, 10 * (isActive ? pulseScale : 1), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(244, 114, 182, ${isActive ? 0.3 : 0.18})`;
          ctx.fill();
          ctx.strokeStyle = "rgba(244, 114, 182, 0.8)";
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
        });
      }

      mappedDotsRef.current = dotsCoords;
      drawSweepAndCenter(centerX, centerY, maxRadius, angle);
      angle = (angle + 0.01) % (Math.PI * 2);
      animationRef.current = requestAnimationFrame(drawRadar);
    };

    drawRadar();
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [listings, rangeFilter, selectedListing, hoveredDot, viewMode, scanningPhase, dotRevealProgress, clusteredListings, useMetric, myPickups, showMyPickups]);

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
      // No seller-dot markers: the discovery radar plots no fabricated seller
      // locations (Decision D3 / T15). `listings` is intentionally empty until
      // the real opt-in zone-discovery feature (T15) lands.

      // Task 25: My Pickups markers (real, un-fuzzed) — round-trip to the order.
      if (showMyPickups) {
        myPickups.filter((p) => p.distance <= rangeFilter).forEach((pickup) => {
          const pickupLat = userLocation.lat + pickup.latMiles / 69;
          const pickupLng = userLocation.lng + pickup.lngMiles / 55;
          const marker = L.circleMarker([pickupLat, pickupLng], {
            radius: 8, fillColor: "#f472b6", fillOpacity: 0.85, color: "#fff", weight: 2
          }).addTo(map);
          marker.bindPopup(`<strong>📍 ${pickup.label}</strong><br/>~${formatDistance(pickup.distance)} away`);
          marker.on("click", () => handleOpenPickupOrder(pickup));
        });
      }
    }
    return () => {
      if (mapContainerRef.current) {
        mapContainerRef.current.innerHTML = "";
        if (mapContainerRef.current._leaflet_id) mapContainerRef.current._leaflet_id = null;
      }
    };
  }, [viewMode, listings, rangeFilter, userLocation, myPickups, showMyPickups, handleOpenPickupOrder]);

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
      } else if (clickedDot.listing?.isMyPickup) {
        // Task 25: a My Pickups pin round-trips straight to the order's
        // PickupPanel rather than opening the (fuzzed-radar-oriented)
        // breeder detail panel — there's no checkout to initiate here.
        handleOpenPickupOrder(clickedDot.listing);
        haptic("tap");
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
              <span>{viewMode === "radar" ? "\uD83E\uDDED" : "\uD83D\uDDFA\uFE0F"}</span> Pickup Map
            </h3>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              {/* Honest subtitle (Decision D3 / T15). The old copy — "Hobbyist
                  boundaries fuzzed within 3-mile zones" — described a seller
                  fuzzing system that no longer exists (it was wallet-hash
                  fiction). This map shows only real data: the pickup spots for
                  your own confirmed orders. */}
              Your confirmed pickup meetups. Breeder discovery isn&apos;t live yet.
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
          {/* The "All / Swap Meets / Drops" event filter was removed (Decision
              D3 / T15): the only events it could ever match were hardcoded fake
              ones, so with those gone the control could never change anything.
              It comes back with a real community-events source, not before. */}

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

          {/* Task 25: My Pickups layer toggle */}
          {myPickups.length > 0 && (
            <button
              onClick={() => setShowMyPickups((v) => !v)}
              aria-pressed={showMyPickups}
              style={{ padding: "0.25rem 0.6rem", fontSize: "0.65rem", fontWeight: "600", border: showMyPickups ? "1px solid rgba(244,114,182,0.5)" : "1px solid rgba(255,255,255,0.06)", borderRadius: "4px", cursor: "pointer", background: showMyPickups ? "rgba(244,114,182,0.12)" : "rgba(0,0,0,0.2)", color: showMyPickups ? "#f472b6" : "var(--text-muted)", transition: "all 0.2s" }}
              title="Toggle your pickup orders on the map"
            >
              📍 My Pickups ({myPickups.length})
            </button>
          )}
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
          {/* Stats reflect the only real layer on this map. The old
              "N nearby / N clusters" counters were always 0 (there are no
              seller dots) and read as "nobody is near you" — Decision D3. */}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", padding: "0.3rem 0.5rem", background: "rgba(0,0,0,0.2)", borderRadius: "10px" }}>
              <strong style={{ color: themeAccentColor }}>{myPickups.length}</strong> {myPickups.length === 1 ? "pickup" : "pickups"}
            </span>
          </div>
        </div>

        {/* Honest empty state (Decision D3 / T15).
            The old copy said "No breeders found within N mi — try expanding
            your range or check back later as more breeders list", which framed
            an unbuilt feature as a completed search that found nobody, and
            offered an "Expand range" button that could never change the result.
            Local breeder discovery needs sellers to publish an approximate
            location, and nothing in the product asks them to yet, so we say
            that plainly and point at the surface that does work. */}
        {!scanningPhase && myPickups.length === 0 && (
          <div style={{ textAlign: "center", padding: "1.5rem 1rem", background: "rgba(0,0,0,0.15)", borderRadius: "10px", border: "1px dashed rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>{"\uD83D\uDCCD"}</div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", margin: "0 0 0.5rem", fontWeight: "500" }}>
              Nothing on your map yet
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "0.7rem", margin: 0, lineHeight: 1.5 }}>
              This map shows the meetup spot for orders you&apos;ve arranged as a local
              pickup. Finding breeders near you isn&apos;t available yet — it needs sellers
              to share an approximate area first, and we don&apos;t ask them to.
            </p>
            <button
              onClick={() => navigate("/app/directory")}
              style={{ marginTop: "0.75rem", padding: "0.4rem 1rem", fontSize: "0.72rem", fontWeight: "600", background: isPro ? "rgba(168,85,247,0.15)" : "rgba(251,191,36,0.12)", border: `1px solid ${themeCardBorder}`, borderRadius: "6px", color: themeAccentColor, cursor: "pointer", transition: "all 0.2s" }}
            >
              Browse the marketplace
            </button>
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
          renderBreederDetail()
        ) : (
          /* Honest idle copy (Decision D3 / T15): the old text invited the user
             to "click any glowing dot ... and initiate checkout", but the only
             markers this map draws are their own pickup pins. */
          <div style={{ padding: "2rem" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>{"\uD83D\uDCCD"}</div>
            <h4 style={{ color: "#fff", fontSize: "0.95rem", fontWeight: "600", marginBottom: "0.25rem" }}>
              {myPickups.length > 0 ? "No pickup selected" : "Nothing selected"}
            </h4>
            <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", margin: 0 }}>
              {myPickups.length > 0
                ? `${viewMode === "radar" ? "Click" : "Tap"} one of your pickup pins to open that order.`
                : "Your local-pickup orders show up here with their meetup spot."}
            </p>
          </div>
        )}
      </div>
    );
  }

  // `renderEventDetail` was deleted along with the fabricated events layer
  // (Decision D3 / T15). It rendered invented swap-meet copy plus an unbacked
  // "Orders claimed in this zone earn 2x Loyalty Rewards!" promise — a reward
  // multiplier that exists nowhere in the gamification rules.

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
              {/* Money goes through the canonical marketplace parser/formatter
                  (catalogQuery.js), the same one the board, cart, and
                  availability aggregate use. This previously read
                  `formatEther(pricePerFish) * 1000`, which is meaningless for
                  USD-cents listings and would have printed a wrong price the
                  moment this panel got real data again. */}
              <strong style={{ color: primaryThemeColor }}>
                {(() => {
                  const cents = normalizePriceCents(selectedListing);
                  // formatPriceCents coerces a missing price to "$0.00", so an
                  // unknown price is shown as unknown rather than as free.
                  return Number.isFinite(cents) && cents > 0 ? formatPriceCents(cents) : "—";
                })()}
              </strong>
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
