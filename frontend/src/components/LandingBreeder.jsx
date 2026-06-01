import React, { useState } from "react";

// Set to false to immediately bypass the waitlist gate and restore direct terminal console login
const GATED = false;

export function LandingBreeder({ onEnter }) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleProvisionRequest = (e) => {
    e.preventDefault();
    if (!email.trim()) return;

    // Save record locally in local storage waitlist
    const existing = JSON.parse(localStorage.getItem("aquadex_waitlist") || "[]");
    existing.push({
      email: email.trim(),
      type: "breeder",
      timestamp: Math.round(Date.now() / 1000)
    });
    localStorage.setItem("aquadex_waitlist", JSON.stringify(existing));
    setSubmitted(true);
  };

  return (
    <div style={{
      position: "relative",
      minHeight: "100vh",
      background: "radial-gradient(circle at 90% 10%, rgba(20, 8, 48, 1) 0%, rgba(3, 2, 10, 1) 90%)",
      color: "#fff",
      fontFamily: "'Courier New', Courier, monospace",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      padding: "2rem"
    }}>
      {/* Background Matrix Grid Overlay */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundImage: "linear-gradient(rgba(168, 85, 247, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(168, 85, 247, 0.03) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
        pointerEvents: "none",
        zIndex: 0
      }} />

      {/* Glowing Purple Orbs */}
      <div style={{
        position: "absolute",
        top: "10%",
        right: "20%",
        width: "350px",
        height: "350px",
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(168, 85, 247, 0.15) 0%, rgba(168, 85, 247, 0) 70%)",
        filter: "blur(50px)",
        pointerEvents: "none",
        zIndex: 0
      }} />
      <div style={{
        position: "absolute",
        bottom: "10%",
        left: "15%",
        width: "400px",
        height: "400px",
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(139, 92, 246, 0.12) 0%, rgba(139, 92, 246, 0) 70%)",
        filter: "blur(70px)",
        pointerEvents: "none",
        zIndex: 0
      }} />

      <div style={{
        maxWidth: "960px",
        width: "100%",
        zIndex: 1
      }}>
        {/* Terminal Header */}
        <div style={{
          border: "1px solid rgba(168, 85, 247, 0.3)",
          background: "rgba(10, 5, 25, 0.8)",
          borderRadius: "8px",
          padding: "0.75rem 1.5rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "3rem",
          boxShadow: "0 0 15px rgba(168, 85, 247, 0.1)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: "#a855f7" }} />
            <strong style={{ fontSize: "0.85rem", letterSpacing: "0.1em", color: "#a855f7" }}>SYSTEM_TERMINAL: BREEDER_NODE_V1.8.8</strong>
          </div>
          <span style={{ fontSize: "0.75rem", color: "rgba(168, 85, 247, 0.5)" }}>SECURE_SESSION_ACTIVE</span>
        </div>

        <div style={{ textAlign: "center", marginBottom: "3rem" }}>
          <h1 style={{
            fontSize: "clamp(2rem, 5vw, 3.2rem)",
            fontWeight: "800",
            fontFamily: "inherit",
            background: "linear-gradient(135deg, #ffffff 30%, #a855f7 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: "0.05em",
            lineHeight: "1.2",
            margin: "0 0 1.5rem 0"
          }}>
            AQUADEX PROTOCOL BREEDING HUB
          </h1>

          <p style={{
            fontSize: "clamp(0.9rem, 2.5vw, 1.1rem)",
            color: "rgba(255, 255, 255, 0.75)",
            fontFamily: "inherit",
            maxWidth: "780px",
            margin: "0 auto",
            lineHeight: "1.6"
          }}>
            Initialize high-fidelity node terminals for EVM-based lineage registry, multi-box shipping logistics calculations, escrow verification, and regional ranking models.
          </p>
        </div>

        {/* Technical Features Matrix */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
          gap: "1.5rem",
          marginBottom: "4rem"
        }}>
          {/* Item 1 */}
          <div style={{
            background: "rgba(14, 8, 30, 0.85)",
            border: "1px solid rgba(168, 85, 247, 0.2)",
            borderRadius: "12px",
            padding: "1.5rem 2rem",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            transition: "all 0.3s ease"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.border = "1px solid rgba(168, 85, 247, 0.5)";
            e.currentTarget.style.boxShadow = "0 0 20px rgba(168, 85, 247, 0.2)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.border = "1px solid rgba(168, 85, 247, 0.2)";
            e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.4)";
          }}>
            <strong style={{ color: "#a855f7", display: "block", fontSize: "0.95rem", marginBottom: "0.5rem" }}>
              [01] ENCRYPTED LINEAGE & GENETIC PEDIGREE
            </strong>
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)", lineHeight: "1.6", margin: 0 }}>
              Verify absolute encrypted lineage records. Instantly query parents (Sire/Dam), trace spawning paths, and record certified digital birth certificates on the ledger to ensure professional breeding data integrity.
            </p>
          </div>

          {/* Item 2 */}
          <div style={{
            background: "rgba(14, 8, 30, 0.85)",
            border: "1px solid rgba(168, 85, 247, 0.2)",
            borderRadius: "12px",
            padding: "1.5rem 2rem",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            transition: "all 0.3s ease"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.border = "1px solid rgba(168, 85, 247, 0.5)";
            e.currentTarget.style.boxShadow = "0 0 20px rgba(168, 85, 247, 0.2)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.border = "1px solid rgba(168, 85, 247, 0.2)";
            e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.4)";
          }}>
            <strong style={{ color: "#a855f7", display: "block", fontSize: "0.95rem", marginBottom: "0.5rem" }}>
              [02] SECURE HANDSHAKE FRAUD PROTECTION
            </strong>
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)", lineHeight: "1.6", margin: 0 }}>
              Execute secure in-person handshakes using offline pre-image proof tokens. Bypasses typical multi-party online risks with automated escrow settlements to ensure secure physical local-pickup verification.
            </p>
          </div>

          {/* Item 3 */}
          <div style={{
            background: "rgba(14, 8, 30, 0.85)",
            border: "1px solid rgba(168, 85, 247, 0.2)",
            borderRadius: "12px",
            padding: "1.5rem 2rem",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            transition: "all 0.3s ease"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.border = "1px solid rgba(168, 85, 247, 0.5)";
            e.currentTarget.style.boxShadow = "0 0 20px rgba(168, 85, 247, 0.2)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.border = "1px solid rgba(168, 85, 247, 0.2)";
            e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.4)";
          }}>
            <strong style={{ color: "#a855f7", display: "block", fontSize: "0.95rem", marginBottom: "0.5rem" }}>
              [03] AUTOMATED LOGISTICS & BUNDLED SHIPPING
            </strong>
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)", lineHeight: "1.6", margin: 0 }}>
              Group shipping calculations dynamically using box-grouping logic: Math.ceil(tokenIds.length / 3). Matches smart contract constraints with automatic refunding mechanics for smart shipping box consolidation.
            </p>
          </div>

          {/* Item 4 */}
          <div style={{
            background: "rgba(14, 8, 30, 0.85)",
            border: "1px solid rgba(168, 85, 247, 0.2)",
            borderRadius: "12px",
            padding: "1.5rem 2rem",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            transition: "all 0.3s ease"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.border = "1px solid rgba(168, 85, 247, 0.5)";
            e.currentTarget.style.boxShadow = "0 0 20px rgba(168, 85, 247, 0.2)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.border = "1px solid rgba(168, 85, 247, 0.2)";
            e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.4)";
          }}>
            <strong style={{ color: "#a855f7", display: "block", fontSize: "0.95rem", marginBottom: "0.5rem" }}>
              [04] GOD-TIER REGIONAL RANKINGS
            </strong>
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)", lineHeight: "1.6", margin: 0 }}>
              Participate in zoneHash peer evaluations. The top-ranking Breeder in each network zone claims God-Tier visual effects for their animated Breeder Companion.
            </p>
          </div>
        </div>

        {/* Waitlist Collection Console vs direct direct console entry */}
        {GATED ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
            {submitted ? (
              <div style={{
                background: "rgba(168, 85, 247, 0.08)",
                border: "1px solid rgba(168, 85, 247, 0.4)",
                padding: "1.25rem 2.5rem",
                borderRadius: "4px",
                maxWidth: "680px",
                boxShadow: "0 0 20px rgba(168, 85, 247, 0.15)",
                color: "#c084fc",
                fontSize: "0.95rem",
                textAlign: "left",
                lineHeight: "1.6"
              }}>
                <span style={{ color: "#a855f7" }}>&gt; STATUS_CODE: 202_ACCEPTED</span><br />
                [SUCCESS] Email queued in regional node ledger. Awaiting launch confirmation.
              </div>
            ) : (
              <form onSubmit={handleProvisionRequest} style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: "0.75rem",
                width: "100%",
                maxWidth: "700px"
              }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  flex: "1 1 350px",
                  background: "rgba(10, 5, 25, 0.9)",
                  border: "1px solid rgba(168, 85, 247, 0.35)",
                  borderRadius: "4px",
                  padding: "0 1rem",
                  boxShadow: "inset 0 0 10px rgba(168, 85, 247, 0.05)"
                }}>
                  <span style={{ color: "#a855f7", marginRight: "0.5rem", fontSize: "0.85rem", fontWeight: "700" }}>&gt;</span>
                  <input
                    type="email"
                    required
                    placeholder="ENTER OPERATOR EMAIL TO DEPLOY ACCESS NODE..."
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      color: "#fff",
                      fontFamily: "inherit",
                      fontSize: "0.85rem",
                      padding: "1rem 0",
                      outline: "none",
                      letterSpacing: "0.05em"
                    }}
                  />
                </div>
                <button
                  type="submit"
                  style={{
                    padding: "1rem 2rem",
                    fontSize: "0.85rem",
                    fontWeight: "700",
                    color: "#fff",
                    fontFamily: "inherit",
                    background: "rgba(10, 5, 25, 0.9)",
                    border: "1px solid rgba(168, 85, 247, 0.8)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    boxShadow: "0 0 15px rgba(168, 85, 247, 0.2)",
                    transition: "all 0.3s ease",
                    whiteSpace: "nowrap"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "scale(1.02)";
                    e.currentTarget.style.background = "rgba(168, 85, 247, 0.1)";
                    e.currentTarget.style.boxShadow = "0 0 25px rgba(168, 85, 247, 0.4)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "none";
                    e.currentTarget.style.background = "rgba(10, 5, 25, 0.9)";
                    e.currentTarget.style.boxShadow = "0 0 15px rgba(168, 85, 247, 0.2)";
                  }}
                >
                  Request Terminal Provisioning
                </button>
              </form>
            )}
            <span style={{ fontSize: "0.7rem", color: "rgba(168, 85, 247, 0.5)" }}>
              &gt; LOCAL_CACHE_STORE: aquadex_waitlist_node
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
            <button
              onClick={() => onEnter(false)}
              style={{
                padding: "1.2rem 3rem",
                fontSize: "1.1rem",
                fontWeight: "700",
                color: "#fff",
                fontFamily: "inherit",
                background: "rgba(10, 5, 25, 0.9)",
                border: "1px solid rgba(168, 85, 247, 0.8)",
                borderRadius: "4px",
                cursor: "pointer",
                boxShadow: "0 0 20px rgba(168, 85, 247, 0.3)",
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                transition: "all 0.3s ease"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.03)";
                e.currentTarget.style.background = "rgba(168, 85, 247, 0.15)";
                e.currentTarget.style.boxShadow = "0 0 30px rgba(168, 85, 247, 0.5)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.background = "rgba(10, 5, 25, 0.9)";
                e.currentTarget.style.boxShadow = "0 0 20px rgba(168, 85, 247, 0.3)";
              }}
            >
              <span>[ INITIALIZE BREEDER TERMINAL ]</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
            
            <span style={{ fontSize: "0.75rem", color: "rgba(168, 85, 247, 0.6)" }}>
              &gt; STACK: CDP_PAYMASTER_GASLESS_VERIFICATION
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
