import React, { useState, useEffect } from "react";
import { ethers, Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { getProvider, getSigner } from "../utils/smartAccount";
import { compressImage } from "../utils/imageCompression";
import { relayRegisterTank } from "../services/relayer";

const TANK_TYPES = ["Freshwater", "Saltwater", "Brackish", "Pond"];
const CONTAINMENT_TYPES = ["Tank", "Tub", "Basket"];

export function FacilityTreeView({ contractAddress, walletAccount, onSelectTank, onReload, openRegisterOnTreeMount, onCloseRegister }) {
  const [tanks, setTanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };
  
  // Registration Form Modal state
  const [isRegisterOpen, setIsRegisterOpen] = useState(openRegisterOnTreeMount || false);
  const [registerForm, setRegisterForm] = useState({
    name: "",
    tankType: "0",
    volumeLiters: "50",
    containment: "0",
    parentUnitId: "0",
    facility: "Main Room",
    room: "Aisle 1",
    rack: "Tier 2"
  });
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState(null);
  const [registerTx, setRegisterTx] = useState(null);
  const [selectedPhoto, setSelectedPhoto] = useState("");

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const compressed = await compressImage(file);
        setSelectedPhoto(compressed);
      } catch (err) {
        console.error("Error compressing image:", err);
        setRegisterError("Failed to process selected image.");
      }
    }
  };

  // Tree collapse state
  const [expandedNodes, setExpandedNodes] = useState({});

  const toggleNode = (nodePath) => {
    setExpandedNodes(prev => ({ ...prev, [nodePath]: !prev[nodePath] }));
  };

  useEffect(() => {
    if (openRegisterOnTreeMount) {
      setIsRegisterOpen(true);
    }
  }, [openRegisterOnTreeMount]);

  const handleCloseRegisterModal = () => {
    setIsRegisterOpen(false);
    setSelectedPhoto("");
    if (onCloseRegister) onCloseRegister();
  };

  const fetchTanksData = async () => {
    if (!walletAccount || !contractAddress) {
      setTanks([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const provider = getProvider();
      const contract = new Contract(contractAddress, aquadexAbi, provider);

      // 1. Discover all tank IDs
      const tankIds = [];
      let index = 0;
      while (true) {
        try {
          const id = await contract.ownerTanks(walletAccount, index);
          tankIds.push(Number(id));
          index++;
        } catch (e) {
          break;
        }
      }

      // 2. Query details in parallel
      const tankDetails = await Promise.all(
        tankIds.map(async (id) => {
          const tankData = await contract.tanks(id);
          
          // Latest parameter log
          let latestLog = null;
          try {
            let logIndex = 0;
            while (true) {
              try {
                const log = await contract.tankParameterLogs(id, logIndex);
                latestLog = log;
                logIndex++;
              } catch (e) {
                break;
              }
            }
          } catch (e) {}

          return {
            id,
            name: tankData.name,
            tankType: Number(tankData.tankType),
            volumeLiters: Number(tankData.volumeLiters),
            creationTimestamp: Number(tankData.creationTimestamp),
            active: tankData.active,
            containment: Number(tankData.containment),
            parentUnitId: Number(tankData.parentUnitId),
            facility: tankData.facility || "Main Room",
            room: tankData.room || "Garage Rack",
            rack: tankData.rack || "Outdoor Ponds",
            latestLog
          };
        })
      );

      setTanks(tankDetails.filter((t) => t.active));
    } catch (err) {
      console.error("Error fetching tanks for tree view:", err);
      setError("Failed to query facility containment units.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTanksData();
  }, [contractAddress, walletAccount]);

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!registerForm.name) return;

    setRegistering(true);
    setRegisterError(null);
    setRegisterTx(null);

    try {
      // Use local Dexie storage for beta — no on-chain write needed
      const result = await relayRegisterTank({
        name: registerForm.name,
        tankType: Number(registerForm.tankType),
        volumeLiters: Number(registerForm.volumeLiters),
        containment: Number(registerForm.containment),
        parentUnitId: Number(registerForm.parentUnitId),
        facility: registerForm.facility || "Main Room",
        room: registerForm.room || "",
        rack: registerForm.rack || "",
        ownerAddress: walletAccount,
      });

      if (!result.success) {
        throw new Error(result.error || "Relay transaction failed");
      }

      setRegisterTx(result.txHash);

      const newTankId = result.tankId;

      if (newTankId && selectedPhoto) {
        try {
          localStorage.setItem(`aquadex_tank_photo_${newTankId}`, selectedPhoto);
        } catch (storageErr) {
          console.error("Storage quota error:", storageErr);
          showToast("⚠️ Storage Quota Exceeded! Tank registered, but device is out of space for local photos.");
        }
      }

      addXp(XP_ACTIONS.REGISTER_TANK.points, XP_ACTIONS.REGISTER_TANK.label);

      setRegisterForm({
        name: "",
        tankType: "0",
        volumeLiters: "50",
        containment: "0",
        parentUnitId: "0",
        facility: "Main Room",
        room: "Aisle 1",
        rack: "Tier 2"
      });
      setSelectedPhoto("");
      handleCloseRegisterModal();
      await fetchTanksData();
      if (onReload) onReload();
    } catch (err) {
      console.error("Register unit transaction failed:", err);
      setRegisterError(err.reason || err.message || "Failed to register new containment unit.");
    } finally {
      setRegistering(false);
      setRegisterTx(null);
    }
  };

  // Check if a tank has chemical warning indicators
  const checkWarnings = (tank) => {
    if (!tank.latestLog) return null;
    const ammoniaVal = Number(tank.latestLog.ammoniaPpmX100) / 100;
    const nitriteVal = Number(tank.latestLog.nitritePpmX100) / 100;
    const nitrateVal = Number(tank.latestLog.nitratePpmX100) / 100;

    const warnings = [];
    if (ammoniaVal > 0.05) warnings.push("NH₃ Alert");
    if (nitriteVal > 0.05) warnings.push("NO₂ Alert");
    if (nitrateVal > 20.0) warnings.push("NO₃ High");
    return warnings.length > 0 ? warnings.join(" | ") : null;
  };

  // Build the hierarchical tree: Facility > Room > Rack > TopLevelUnits (with nested children recursively)
  const buildTree = () => {
    const tree = {};
    const topLevelUnits = tanks.filter(t => t.parentUnitId === 0);
    const childUnits = tanks.filter(t => t.parentUnitId !== 0);

    topLevelUnits.forEach(unit => {
      const facilityName = unit.facility || "Default Facility";
      const roomName = unit.room || "Default Room";
      const rackName = unit.rack || "Default Rack";

      if (!tree[facilityName]) tree[facilityName] = {};
      if (!tree[facilityName][roomName]) tree[facilityName][roomName] = {};
      if (!tree[facilityName][roomName][rackName]) tree[facilityName][roomName][rackName] = [];

      // Recursive child lookup function
      const getChildren = (parentUnit) => {
        return childUnits
          .filter(child => child.parentUnitId === parentUnit.id)
          .map(child => ({
            ...child,
            children: getChildren(child)
          }));
      };

      tree[facilityName][roomName][rackName].push({
        ...unit,
        children: getChildren(unit)
      });
    });

    return tree;
  };

  if (loading) {
    return (
      <div className="glass-card shimmer-placeholder" style={{ height: "400px", borderRadius: "var(--radius-md)", marginTop: "1rem" }} />
    );
  }

  if (error) {
    return (
      <div className="glass-card" style={{ padding: "2rem", border: "1px solid rgba(248,113,113,0.2)", marginTop: "1rem" }}>
        <p style={{ color: "var(--accent-red)" }}>{error}</p>
        <button className="btn-primary" onClick={fetchTanksData} style={{ marginTop: "1rem" }}>Retry</button>
      </div>
    );
  }

  const tree = buildTree();
  // Filter top-level parents for registry select box
  const possibleParents = tanks.filter(t => t.containment !== 2); // Baskets usually cannot have sub-baskets, only tanks or tubs can be parents.

  // Render a tank node recursively
  const renderTankNode = (node, depth = 0) => {
    const warning = checkWarnings(node);
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedNodes[`node-${node.id}`] !== false; // expanded by default

    return (
      <div key={node.id} style={{ marginLeft: `${depth * 16}px`, marginBottom: "0.5rem" }}>
        <div 
          className="glass-card"
          onClick={() => onSelectTank && onSelectTank(node)}
          style={{
            padding: "0.75rem 1rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            cursor: "pointer",
            background: warning ? "rgba(248, 113, 113, 0.05)" : "var(--glass-bg)",
            border: warning ? "1px solid rgba(248, 113, 113, 0.25)" : "1px solid var(--glass-border)",
            borderRadius: "var(--radius-sm)",
            position: "relative"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.75rem", opacity: 0.6 }}>[{CONTAINMENT_TYPES[node.containment]}]</span>
            <strong style={{ color: "#fff" }}>{node.name}</strong>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>ID: {node.id} ({node.volumeLiters}L)</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            {warning && (
              <span className="badge pulsate-red-badge" style={{ fontSize: "0.65rem", padding: "0.1rem 0.5rem" }}>
                ⚠️ {warning}
              </span>
            )}
            <span className={`badge ${node.tankType === 1 ? "badge-blue" : "badge-green"}`} style={{ fontSize: "0.65rem" }}>
              {TANK_TYPES[node.tankType]}
            </span>
            {hasChildren && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  toggleNode(`node-${node.id}`);
                }}
                style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: "0.25rem" }}
              >
                {isExpanded ? "▲" : "▼"}
              </button>
            )}
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div style={{ marginTop: "0.5rem", borderLeft: "1px dashed rgba(56, 189, 248, 0.2)", paddingLeft: "0.5rem" }}>
            {node.children.map(child => renderTankNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ fontSize: "1.25rem", color: "#fff" }}>Husbandry Facility Hierarchy</h3>
        <button className="btn-primary" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }} onClick={() => setIsRegisterOpen(true)}>
          [ + Register Unit ]
        </button>
      </div>

      {Object.keys(tree).length === 0 ? (
        <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)" }}>No containment units registered. Get started by clicking register unit.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {Object.keys(tree).map(facility => {
            const isFacilityExpanded = expandedNodes[facility] !== false;
            return (
              <div key={facility} className="glass-card" style={{ padding: "1.25rem", background: "rgba(255, 255, 255, 0.01)" }}>
                {/* Facility Level */}
                <div 
                  onClick={() => toggleNode(facility)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                    borderBottom: "1px solid var(--glass-border)",
                    paddingBottom: "0.5rem",
                    marginBottom: "1rem"
                  }}
                >
                  <h4 style={{ fontSize: "1.1rem", color: "var(--accent-blue)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    🏢 {facility}
                  </h4>
                  <span style={{ color: "var(--text-muted)" }}>{isFacilityExpanded ? "▲" : "▼"}</span>
                </div>

                {isFacilityExpanded && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", paddingLeft: "0.5rem" }}>
                    {Object.keys(tree[facility]).map(room => {
                      const roomKey = `${facility}-${room}`;
                      const isRoomExpanded = expandedNodes[roomKey] !== false;

                      return (
                        <div key={room} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                          {/* Room Level */}
                          <div 
                            onClick={() => toggleNode(roomKey)}
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", paddingLeft: "0.5rem" }}
                          >
                            <span style={{ fontSize: "0.95rem", fontWeight: "600", color: "var(--text-primary)" }}>
                              🚪 Room: {room}
                            </span>
                            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{isRoomExpanded ? "▲" : "▼"}</span>
                          </div>

                          {isRoomExpanded && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", paddingLeft: "1rem" }}>
                              {Object.keys(tree[facility][room]).map(rack => {
                                const rackKey = `${facility}-${room}-${rack}`;
                                const isRackExpanded = expandedNodes[rackKey] !== false;

                                return (
                                  <div key={rack} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                                    {/* Rack Level */}
                                    <div 
                                      onClick={() => toggleNode(rackKey)}
                                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", borderLeft: "2px solid var(--accent-green)", paddingLeft: "0.5rem" }}
                                    >
                                      <span style={{ fontSize: "0.85rem", fontWeight: "500", color: "var(--text-secondary)" }}>
                                        📋 Rack: {rack}
                                      </span>
                                      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{isRackExpanded ? "▲" : "▼"}</span>
                                    </div>

                                    {isRackExpanded && (
                                      <div style={{ paddingLeft: "0.5rem", marginTop: "0.25rem" }}>
                                        {tree[facility][room][rack].map(topUnit => renderTankNode(topUnit))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Form for Register Containment Unit */}
      {isRegisterOpen && (
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
            maxWidth: "480px",
            padding: "2rem",
            background: "var(--bg-secondary)",
            border: "1px solid var(--glass-border-hover)"
          }}>
            <h3 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Register Containment Unit</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
              Define locations and nesting containment structures in the registry.
            </p>

            {registerError && (
              <div style={{ 
                padding: "0.75rem", 
                borderRadius: "var(--radius-sm)", 
                background: "rgba(248, 113, 113, 0.1)", 
                color: "var(--accent-red)",
                fontSize: "0.8rem",
                marginBottom: "1rem"
              }}>
                {registerError}
              </div>
            )}

            {registerTx && (
              <div style={{ 
                padding: "0.75rem", 
                borderRadius: "var(--radius-sm)", 
                background: "var(--accent-blue-glow)", 
                color: "var(--accent-blue)",
                fontSize: "0.8rem",
                marginBottom: "1rem",
                wordBreak: "break-all"
              }}>
                <strong>Sync Pending:</strong> {registerTx}
              </div>
            )}

            <form onSubmit={handleRegisterSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "1rem", alignItems: "end" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Unit Name</label>
                  <input 
                    type="text" 
                    value={registerForm.name}
                    onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                    placeholder="e.g. Rack A - Basket 4"
                    required
                    style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Unit Photo</label>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <label style={{ 
                      flex: 1, 
                      padding: "0.5rem", 
                      background: "rgba(255,255,255,0.05)", 
                      border: "1px dashed var(--glass-border)", 
                      borderRadius: "4px", 
                      fontSize: "0.7rem", 
                      color: "var(--text-secondary)", 
                      cursor: "pointer", 
                      textAlign: "center",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }}>
                      {selectedPhoto ? "✓ Change Photo" : "📁 Choose File"}
                      <input 
                        type="file" 
                        accept="image/*"
                        onChange={handlePhotoChange}
                        style={{ display: "none" }}
                      />
                    </label>
                    {selectedPhoto && (
                      <div style={{ position: "relative", width: "32px", height: "32px", borderRadius: "4px", overflow: "hidden", border: "1px solid var(--glass-border)" }}>
                        <img src={selectedPhoto} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        <button 
                          type="button" 
                          onClick={() => setSelectedPhoto("")}
                          style={{ position: "absolute", top: 0, right: 0, background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", width: "100%", height: "100%", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0, transition: "opacity 0.2s" }}
                          onMouseEnter={(e) => e.target.style.opacity = 1}
                          onMouseLeave={(e) => e.target.style.opacity = 0}
                        >
                          &times;
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Water Type</label>
                  <select 
                    value={registerForm.tankType}
                    onChange={(e) => setRegisterForm({ ...registerForm, tankType: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem", background: "rgba(8,12,20,0.9)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                  >
                    {TANK_TYPES.map((t, idx) => <option key={idx} value={idx}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Volume (Liters)</label>
                  <input 
                    type="number" 
                    value={registerForm.volumeLiters}
                    onChange={(e) => setRegisterForm({ ...registerForm, volumeLiters: e.target.value })}
                    required
                    style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Containment Type</label>
                  <select 
                    value={registerForm.containment}
                    onChange={(e) => setRegisterForm({ ...registerForm, containment: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem", background: "rgba(8,12,20,0.9)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                  >
                    {CONTAINMENT_TYPES.map((c, idx) => <option key={idx} value={idx}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Parent Unit</label>
                  <select 
                    value={registerForm.parentUnitId}
                    onChange={(e) => setRegisterForm({ ...registerForm, parentUnitId: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem", background: "rgba(8,12,20,0.9)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                  >
                    <option value="0">None (Top-Level)</option>
                    {possibleParents.map(parent => (
                      <option key={parent.id} value={parent.id}>{parent.name} (ID: {parent.id})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Facility</label>
                  <input 
                    type="text" 
                    value={registerForm.facility}
                    onChange={(e) => setRegisterForm({ ...registerForm, facility: e.target.value })}
                    placeholder="e.g. Main Room"
                    style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Room</label>
                  <input 
                    type="text" 
                    value={registerForm.room}
                    onChange={(e) => setRegisterForm({ ...registerForm, room: e.target.value })}
                    placeholder="e.g. Room B"
                    style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Rack</label>
                  <input 
                    type="text" 
                    value={registerForm.rack}
                    onChange={(e) => setRegisterForm({ ...registerForm, rack: e.target.value })}
                    placeholder="e.g. Rack 3"
                    style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
                <button 
                  type="button" 
                  className="btn-secondary" 
                  onClick={handleCloseRegisterModal}
                  disabled={registering}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-primary" 
                  disabled={registering}
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  {registering ? "Registering..." : "Submit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toastMessage && (
        <div style={{
          position: "fixed",
          bottom: "2rem",
          right: "2rem",
          background: "rgba(10, 15, 30, 0.9)",
          backdropFilter: "blur(8px)",
          border: "1px solid var(--accent-red)",
          color: "#fff",
          padding: "1rem 1.5rem",
          borderRadius: "var(--radius-md)",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(248, 113, 113, 0.2)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          animation: "fadeIn 0.3s ease"
        }}>
          {toastMessage}
        </div>
      )}
    </div>
  );
}
