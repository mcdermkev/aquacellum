import React, { useState } from "react";

// Set to false to immediately bypass the waitlist gate and restore direct dashboard login
const GATED = false;

export function LandingHobbyist({ onEnter }) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleJoinWaitlist = (e) => {
    e.preventDefault();
    if (!email.trim()) return;

    // Save record locally in local storage waitlist
    const existing = JSON.parse(localStorage.getItem("aquadex_waitlist") || "[]");
    existing.push({
      email: email.trim(),
      type: "hobbyist",
      timestamp: Math.round(Date.now() / 1000)
    });
    localStorage.setItem("aquadex_waitlist", JSON.stringify(existing));
    setSubmitted(true);
  };

  return (
    <div style={{
      position: "relative",
      minHeight: "100vh",
      background: "radial-gradient(circle at 10% 20%, rgba(8, 25, 48, 1) 0%, rgba(3, 7, 18, 1) 90%)",
      color: "#fff",
      fontFamily: "'Outfit', 'Inter', sans-serif",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      padding: "2rem"
    }}>
      {/* Background Orbs */}
      <div style={{
        position: "absolute",
        top: "15%",
        left: "20%",
        width: "350px",
        height: "350px",
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, rgba(56, 189, 248, 0) 70%)",
        filter: "blur(40px)",
        pointerEvents: "none",
        zIndex: 0
      }} />
      <div style={{
        position: "absolute",
        bottom: "15%",
        right: "15%",
        width: "400px",
        height: "400px",
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(14, 165, 233, 0.12) 0%, rgba(14, 165, 233, 0) 70%)",
        filter: "blur(60px)",
        pointerEvents: "none",
        zIndex: 0
      }} />

      <div style={{
        maxWidth: "960px",
        width: "100%",
        zIndex: 1,
        textAlign: "center"
      }}>
        {/* Logo and Tag */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
          <div style={{
            background: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 20px rgba(14, 165, 233, 0.4)"
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              <path d="M2 12h20" />
            </svg>
          </div>
          <div>
            <span style={{ fontSize: "0.75rem", letterSpacing: "0.15em", color: "#38bdf8", fontWeight: "700", textTransform: "uppercase" }}>Aquadex Platform</span>
            <h1 style={{ fontSize: "2rem", fontWeight: "800", margin: 0, letterSpacing: "0.05em" }}>AQUADEX</h1>
          </div>
        </div>

        <h2 style={{
          fontSize: "clamp(2rem, 5vw, 3.5rem)",
          fontWeight: "800",
          background: "linear-gradient(135deg, #ffffff 0%, #cbd5e1 50%, #38bdf8 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          lineHeight: "1.2",
          marginBottom: "1rem"
        }}>
          Your Beautiful Digital Logbook
        </h2>

        <p style={{
          fontSize: "clamp(1rem, 2.5vw, 1.25rem)",
          color: "rgba(255, 255, 255, 0.7)",
          maxWidth: "640px",
          margin: "0 auto 3rem auto",
          lineHeight: "1.6"
        }}>
          Track water chemistry with fluid sliders, log daily feedings with one-tap shortcuts, and find nearby hobbyists on local proximity swap maps.
        </p>

        {/* Feature Grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1.5rem",
          marginBottom: "4rem"
        }}>
          {/* Feature 1 */}
          <div className="feature-card">
            <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🎚️</div>
            <h3 style={{ fontSize: "1.2rem", fontWeight: "700", marginBottom: "0.5rem", color: "#38bdf8" }}>Frictionless Water Sliders</h3>
            <p style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.6)", lineHeight: "1.5", margin: 0 }}>
              Adjust pH, temperature, and salinity using visual color-coded sliders designed to match natural target habitats perfectly.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="feature-card">
            <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🥣</div>
            <h3 style={{ fontSize: "1.2rem", fontWeight: "700", marginBottom: "0.5rem", color: "#38bdf8" }}>One-Tap Husbandry Logging</h3>
            <p style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.6)", lineHeight: "1.5", margin: 0 }}>
              Log routine feedings, cleanings, and water snapshot tests instantly with quick-tap shortcuts. Earn loyalty rewards.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="feature-card">
            <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>📍</div>
            <h3 style={{ fontSize: "1.2rem", fontWeight: "700", marginBottom: "0.5rem", color: "#38bdf8" }}>Local Sellers & Proximity Maps</h3>
            <p style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.6)", lineHeight: "1.5", margin: 0 }}>
              Discover local sellers, trade specimens safely, and establish direct contact within your regional fishkeeper community.
            </p>
          </div>
        </div>

        {/* Waitlist collection interface vs active direct entrance */}
        {GATED ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
            {submitted ? (
              <div style={{
                background: "rgba(14, 165, 233, 0.1)",
                border: "1px solid rgba(56, 189, 248, 0.35)",
                padding: "1.25rem 2rem",
                borderRadius: "12px",
                maxWidth: "500px",
                boxShadow: "0 8px 32px rgba(56, 189, 248, 0.15)",
                animation: "shimmer 3s ease-in-out infinite",
                color: "#38bdf8",
                fontWeight: "600",
                fontSize: "1.05rem"
              }}>
                🎉 You're in queue! We will notify you when the logbook opens.
              </div>
            ) : (
              <form onSubmit={handleJoinWaitlist} style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: "0.75rem",
                width: "100%",
                maxWidth: "600px"
              }}>
                <input
                  type="email"
                  required
                  placeholder="Enter your email address..."
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{
                    flex: "1 1 300px",
                    padding: "1rem 1.5rem",
                    borderRadius: "50px",
                    background: "rgba(15, 23, 42, 0.6)",
                    border: "1px solid rgba(56, 189, 248, 0.25)",
                    color: "#fff",
                    fontSize: "0.95rem",
                    outline: "none",
                    transition: "all 0.3s ease",
                    boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)"
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.border = "1px solid rgba(56, 189, 248, 0.6)";
                    e.currentTarget.style.boxShadow = "0 0 10px rgba(56, 189, 248, 0.15), inset 0 2px 4px rgba(0,0,0,0.3)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.border = "1px solid rgba(56, 189, 248, 0.25)";
                    e.currentTarget.style.boxShadow = "inset 0 2px 4px rgba(0,0,0,0.3)";
                  }}
                />
                <button
                  type="submit"
                  style={{
                    padding: "1rem 2rem",
                    fontSize: "0.95rem",
                    fontWeight: "700",
                    color: "#fff",
                    background: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
                    border: "none",
                    borderRadius: "50px",
                    cursor: "pointer",
                    boxShadow: "0 6px 18px rgba(14, 165, 233, 0.3)",
                    transition: "all 0.3s ease",
                    whiteSpace: "nowrap"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "scale(1.03)";
                    e.currentTarget.style.boxShadow = "0 8px 22px rgba(14, 165, 233, 0.45)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "none";
                    e.currentTarget.style.boxShadow = "0 6px 18px rgba(14, 165, 233, 0.3)";
                  }}
                >
                  Join waitlist (Coming Soon)
                </button>
              </form>
            )}
            <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.6)" }}>
              🔒 Your data stays locally cached inside this browser context.
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
            <button
              onClick={() => onEnter(true)}
              className="btn-cta"
            >
              <span>Open My Aquarium Logbook</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
            <span style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.6)" }}>
              ⚡ Secured instantly via Biometric Login
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
