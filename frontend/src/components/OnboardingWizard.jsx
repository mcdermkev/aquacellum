import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useCatalogHydration } from "../hooks/useCatalogHydration";
import { addXp } from "../utils/xp";
import { generateAlias } from "../utils/generateAlias";
import { db } from "../db";
import { ensureProfile, updateProfile } from "../services/reefApi";
import { authenticateWithWallet, isSupabaseConfigured } from "../services/supabaseClient";
import { relayRegisterTank } from "../services/relayer";

// ─────────────────────────────────────────────────────────────────────────────
// Dialogue Script — Poseidon's canonical onboarding copy
// ─────────────────────────────────────────────────────────────────────────────
const DIALOGUE = {
  welcome: "Hello there. I'm Poseidon — your guide through these waters. I'll help you keep track of your fish, their stories, and everything that keeps them thriving. Before we begin… tell me how you keep fish.",

  personaConfirm: {
    casual: "Wonderful. Then we'll keep things simple and friendly. This is your personal aquarium logbook — nothing complicated, just the things that matter to you and your fish. I'll be right here whenever you need me.",
    pro: "Understood. Then we'll work with precision. This is your operational node. We'll track lineages, water chemistry, and breeding outcomes with the clarity your work deserves. I'm ready when you are.",
  },

  walletPending: {
    casual: "One moment while I set up your secure logbook…",
    pro: "Initializing operator node…",
  },

  walletSuccess: {
    casual: "There. Your entries are now cryptographically yours. Even if you switch devices, your history travels with you. No complicated keys to remember — just your fish and their stories.",
    pro: "Embedded signing key provisioned via MPC. Your actions on-chain are now tied to this identity. You can link an external wallet later if you need full self-custody control.",
  },

  echoIntro: {
    casual: "And this… is Echo. As you care for your fish, Echo grows alongside you. Feedings, water changes, successful spawns — every bit of care strengthens your companion. Go ahead… tap the egg.",
    pro: "This is Echo — your companion node. Every logged action, every verified spawn, every water parameter you record contributes to Echo's development. Tap the egg when you're ready.",
  },

  echoTapped: {
    casual: "There you go. Echo felt that. Keep tending your tanks and Echo will hatch, then grow stronger with you. It's a quiet kind of partnership.",
    pro: "Acknowledged. Echo is now linked to your operator profile. Continued accurate record-keeping will increase its tier and capabilities over time.",
  },

  echoNudge: "Go on, give it a tap.",

  tankSetupIntro: {
    casual: "Let's set up your first display tank. What size is it, roughly?",
    pro: "Initialize your primary containment unit. Enter volume, target parameters, and intended use.",
  },

  tankComplete: {
    casual: "Perfect. Your first tank is now logged. You just earned your first bit of experience — Echo felt that too. Welcome to Aquadex. Your journey starts here.",
    pro: "Unit initialized and recorded. First operational log complete. Echo's baseline has been established. You're ready to begin proper work.",
  },

  catalogSyncing: "Echo is syncing with the species archive… almost there.",
};

// ─────────────────────────────────────────────────────────────────────────────
// Chat Bubble Component
// ─────────────────────────────────────────────────────────────────────────────
function ChatBubble({ text, sender = "poseidon", isTyping = false }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: sender === "poseidon" ? "flex-start" : "flex-end",
        marginBottom: "0.75rem",
        animation: "fadeSlideIn 0.4s ease forwards",
      }}
    >
      <div
        style={{
          maxWidth: "85%",
          padding: "0.85rem 1.1rem",
          borderRadius:
            sender === "poseidon"
              ? "4px 16px 16px 16px"
              : "16px 4px 16px 16px",
          background:
            sender === "poseidon"
              ? "rgba(56, 189, 248, 0.08)"
              : "rgba(168, 85, 247, 0.08)",
          border:
            sender === "poseidon"
              ? "1px solid rgba(56, 189, 248, 0.15)"
              : "1px solid rgba(168, 85, 247, 0.15)",
          fontSize: "0.875rem",
          lineHeight: "1.6",
          color: "var(--text-primary)",
        }}
      >
        {isTyping ? (
          <span className="typing-dots">
            <span>●</span><span>●</span><span>●</span>
          </span>
        ) : (
          text
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Echo Egg Component
// ─────────────────────────────────────────────────────────────────────────────
function EchoEgg({ onTap, tapped, glowIntensity = 0 }) {
  const [wobble, setWobble] = useState(false);

  const handleTap = () => {
    if (tapped) return;
    setWobble(true);
    setTimeout(() => setWobble(false), 600);
    onTap();
  };

  return (
    <div
      onClick={handleTap}
      role="button"
      aria-label="Tap Echo's egg"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleTap(); }}
      style={{
        width: "120px",
        height: "150px",
        margin: "1.5rem auto",
        cursor: tapped ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "48px",
        minWidth: "48px",
      }}
    >
      <div
        style={{
          width: "80px",
          height: "100px",
          borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%",
          background: `radial-gradient(ellipse at 30% 30%, 
            rgba(56, 189, 248, ${0.15 + glowIntensity * 0.003}), 
            rgba(14, 20, 36, 0.9))`,
          border: `2px solid rgba(56, 189, 248, ${0.2 + glowIntensity * 0.005})`,
          boxShadow: `
            0 0 ${20 + glowIntensity * 0.3}px rgba(56, 189, 248, ${0.1 + glowIntensity * 0.002}),
            inset 0 -10px 20px rgba(0, 0, 0, 0.3)
          `,
          animation: wobble
            ? "eggWobble 0.6s ease"
            : "eggPulse 3s ease-in-out infinite",
          transition: "box-shadow 0.5s ease",
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stepper Header
// ─────────────────────────────────────────────────────────────────────────────
function StepperHeader({ currentStep, totalSteps = 4 }) {
  return (
    <div className="wizard-steps-header" style={{ marginBottom: "1.5rem" }}>
      <div className="wizard-steps-line" />
      <div
        className="wizard-steps-line-fill"
        style={{ width: `${((currentStep - 1) / (totalSteps - 1)) * 100}%` }}
      />
      {Array.from({ length: totalSteps }, (_, i) => i + 1).map((num) => (
        <div
          key={num}
          className={`wizard-step-node ${
            currentStep === num ? "active" : currentStep > num ? "completed" : ""
          }`}
        >
          {currentStep > num ? "✓" : num}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Onboarding Wizard
// ─────────────────────────────────────────────────────────────────────────────
export function OnboardingWizard({ onComplete }) {
  const { connectPrivy, connectMetaMask, account, isConnecting, authenticated, ready } = useAuth();
  const { catalogReady, progress } = useCatalogHydration();

  // Recover persona from localStorage if returning from OAuth redirect
  const savedPersona = localStorage.getItem("aquadex_casual_mode");
  const initialCasualMode = savedPersona !== null ? savedPersona === "true" : null;

  const [step, setStep] = useState(1);
  const [casualMode, setCasualMode] = useState(initialCasualMode);
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [eggTapped, setEggTapped] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [tankVolume, setTankVolume] = useState("20");
  const [tankPh, setTankPh] = useState("7.0");
  const [tankTemp, setTankTemp] = useState("25.0");
  const [tankUse, setTankUse] = useState("display");
  const [showNudge, setShowNudge] = useState(false);
  const [tankSubmitted, setTankSubmitted] = useState(false);

  const messagesEndRef = useRef(null);
  const nudgeTimerRef = useRef(null);
  const welcomeSentRef = useRef(false);
  const oauthRedirectHandledRef = useRef(false);

  // Detect OAuth redirect return: Privy is authenticated + persona was chosen + still on step 1
  useEffect(() => {
    if (oauthRedirectHandledRef.current) return;
    if (ready && authenticated && casualMode !== null && step === 1) {
      oauthRedirectHandledRef.current = true;
      // Generate default name from wallet
      if (account && !displayName) {
        setDisplayName(generateAlias(account));
      }
      // Go to step 2 (name input) instead of skipping to step 3
      setStep(2);
    }
  }, [ready, authenticated, casualMode, step, account, displayName]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Add a message with typing delay
  const addMessage = useCallback((text, sender = "poseidon", delay = 800) => {
    return new Promise((resolve) => {
      setIsTyping(true);
      setTimeout(() => {
        setIsTyping(false);
        setMessages((prev) => [...prev, { id: Date.now() + Math.random(), text, sender }]);
        resolve();
      }, delay);
    });
  }, []);

  // Step 1: Initial welcome message (guarded against StrictMode double-fire)
  useEffect(() => {
    if (welcomeSentRef.current) return;
    welcomeSentRef.current = true;

    // If we already know we're returning from OAuth, show wallet success + name prompt
    if (ready && authenticated && casualMode !== null) {
      const mode = casualMode ? "casual" : "pro";
      addMessage(DIALOGUE.walletSuccess[mode], "poseidon", 800).then(() => {
        const namePrompt = casualMode
          ? "One last thing — what should I call you? I've suggested a name, but you can change it to whatever you like."
          : "Designate your operator callsign. A default has been generated from your node address.";
        addMessage(namePrompt, "poseidon", 800);
      });
    } else {
      addMessage(DIALOGUE.welcome, "poseidon", 1200);
    }
  }, [addMessage, ready, authenticated, casualMode]);

  // Step 3: Nudge timer if egg not tapped after 6 seconds
  useEffect(() => {
    if (step === 3 && !eggTapped && !showNudge) {
      nudgeTimerRef.current = setTimeout(() => {
        setShowNudge(true);
        addMessage(DIALOGUE.echoNudge, "poseidon", 400);
      }, 6000);
    }
    return () => {
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    };
  }, [step, eggTapped, showNudge, addMessage]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handlePersonaSelect = async (isCasual) => {
    setCasualMode(isCasual);
    localStorage.setItem("aquadex_casual_mode", isCasual.toString());

    const mode = isCasual ? "casual" : "pro";
    await addMessage(DIALOGUE.personaConfirm[mode], "poseidon", 1000);

    // Advance to step 2 — don't show wallet pending message yet, wait for user to click
    setStep(2);
  };

  const handleConnectWallet = async () => {
    const mode = casualMode ? "casual" : "pro";
    await addMessage(DIALOGUE.walletPending[mode], "poseidon", 400);
    try {
      // Primary: Use Privy (email/Google embedded wallet)
      await connectPrivy();
      // Account resolution handled by useEffect watching `account`
    } catch (err) {
      await addMessage(
        "Hmm, something went wrong. Let's try another way.",
        "poseidon",
        600
      );
    }
  };

  const handleConnectMetaMask = async () => {
    const mode = casualMode ? "casual" : "pro";
    await addMessage(DIALOGUE.walletPending[mode], "poseidon", 400);
    try {
      await connectMetaMask();
    } catch (err) {
      await addMessage(
        "Hmm, something went wrong connecting your wallet. Let's try again.",
        "poseidon",
        600
      );
    }
  };

  // Watch for account connection success (fires when Privy or MetaMask resolves)
  const accountHandledRef = useRef(false);
  useEffect(() => {
    if (step === 2 && account && casualMode !== null && !accountHandledRef.current) {
      accountHandledRef.current = true;
      const mode = casualMode ? "casual" : "pro";

      // Generate a friendly alias as default display name
      const alias = generateAlias(account);
      setDisplayName(alias);

      // Store in local Dexie
      db.userProfile.get(account).then((profile) => {
        if (profile) {
          db.userProfile.update(account, { alias });
        } else {
          db.userProfile.add({
            walletAddress: account,
            level: 1,
            prestigeXp: 0,
            hobbyistXp: 0,
            isCouncilMember: false,
            persona: mode,
            alias,
          });
        }
      }).catch((err) => {
        console.warn("Failed to store alias in userProfile:", err);
      });

      addMessage(DIALOGUE.walletSuccess[mode], "poseidon", 1200).then(() => {
        // Show name prompt
        const namePrompt = casualMode
          ? "One last thing — what should I call you? I've suggested a name, but you can change it to whatever you like."
          : "Designate your operator callsign. A default has been generated from your node address.";
        addMessage(namePrompt, "poseidon", 800);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  const handleNameConfirm = async () => {
    const name = displayName.trim();
    if (!name) return;

    const mode = casualMode ? "casual" : "pro";

    // Create Supabase profile with the chosen name
    if (isSupabaseConfigured() && account) {
      try {
        await authenticateWithWallet(account);
        await ensureProfile(account, {
          display_name: name,
          companion_tier: "Bronze",
        });
        // Update display_name if profile already existed
        await updateProfile(account, { display_name: name });
      } catch (err) {
        console.warn("[Reef] Profile creation during onboarding failed:", err);
      }
    }

    // Also update the Dexie alias to match
    try {
      await db.userProfile.update(account, { alias: name });
    } catch (err) {
      // Non-critical
    }

    const confirmMsg = casualMode
      ? `Nice to meet you, ${name}. Let's get your logbook set up.`
      : `Operator "${name}" acknowledged. Proceeding with initialization.`;
    await addMessage(confirmMsg, "poseidon", 800);

    setTimeout(() => {
      setStep(3);
      addMessage(DIALOGUE.echoIntro[mode], "poseidon", 1000);
    }, 600);
  };

  const handleEggTap = async () => {
    setEggTapped(true);
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);

    const mode = casualMode ? "casual" : "pro";
    await addMessage(DIALOGUE.echoTapped[mode], "poseidon", 1000);

    // Brief pause then advance to step 4
    setTimeout(async () => {
      setStep(4);
      await addMessage(DIALOGUE.tankSetupIntro[mode], "poseidon", 800);
    }, 1200);
  };

  const handleTankSubmit = async (e) => {
    e.preventDefault();
    const mode = casualMode ? "casual" : "pro";

    // Save display tank to localStorage
    const tank = { volume: tankVolume, ph: tankPh, temp: tankTemp, use: tankUse };
    localStorage.setItem("aquadex_display_tank", JSON.stringify(tank));

    // Register tank on-chain via relayer (your deployer wallet pays gas)
    let newTankId = null;

    try {
      await addMessage("Setting up your first tank... one moment.", "poseidon", 400);

      // Map tankUse to tank type enum (0=Display, 1=Breeding, 2=Quarantine, 3=Growout, 4=Hospital)
      const tankTypeMap = { display: 0, breeding: 1, quarantine: 2, growout: 3, hospital: 4 };
      const tankType = tankTypeMap[tankUse] || 0;

      // Convert gallons to liters (rough: 1 gal ≈ 3.785 L)
      const volumeLiters = Math.round(Number(tankVolume) * 3.785);

      const result = await relayRegisterTank({
        name: casualMode ? "My First Tank" : "Primary Unit",
        tankType,
        volumeLiters,
        containment: 0,
        parentUnitId: 0,
        facility: "Main Room",
        room: "",
        rack: "",
        ownerAddress: account,
      });

      if (result.success) {
        newTankId = result.tankId;
        await addMessage(DIALOGUE.tankComplete[mode], "poseidon", 800);
      } else {
        throw new Error(result.error || "Registration failed");
      }
    } catch (err) {
      console.error("Tank registration failed:", err);
      // Still proceed with onboarding even if on-chain fails
      await addMessage(
        mode === "casual"
          ? "Hmm, the tank registration didn't go through — but don't worry, you can add it later from the Aquariums tab. Let's keep going!"
          : "On-chain registration failed. You can retry from the Aquariums tab. Proceeding.",
        "poseidon", 800
      );
    }

    // Award first XP
    addXp("first_tank_setup", 15);

    // Initialize Echo in Dexie if we have an account
    if (account) {
      try {
        const existing = await db.breederCompanion.get(account);
        if (!existing) {
          await db.breederCompanion.add({
            walletAddress: account,
            eggState: 1,
            companionXp: 15,
            currentTier: "Bronze",
            selectedStats: {},
            zoneHash: null,
          });
        }
      } catch (err) {
        console.warn("Failed to initialize Echo companion in Dexie:", err);
      }

      // Store persona in userProfile
      try {
        const profile = await db.userProfile.get(account);
        if (profile) {
          await db.userProfile.update(account, { persona: casualMode ? "casual" : "pro", hobbyistXp: 15 });
        }
      } catch (err) {
        console.warn("Failed to save persona to userProfile:", err);
      }
    }

    setTankSubmitted(true);

    // Check if catalog is ready before transitioning
    if (catalogReady) {
      setTimeout(finishOnboarding, 2000);
    } else {
      // Hold with syncing message
      setTimeout(async () => {
        await addMessage(DIALOGUE.catalogSyncing, "poseidon", 600);
      }, 1500);
    }
  };

  // Watch for catalog to become ready after step 4 completion
  useEffect(() => {
    if (step === 4 && catalogReady && tankSubmitted) {
      const timer = setTimeout(finishOnboarding, 2000);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogReady, step, tankSubmitted]);

  const finishOnboarding = () => {
    localStorage.setItem("aquadex_onboarding_complete", "true");
    if (onComplete) onComplete(casualMode);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="onboarding-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "var(--bg-primary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        overflow: "hidden",
      }}
    >
      {/* Ambient glow */}
      <div style={{
        position: "absolute",
        top: "15%",
        left: "10%",
        width: "300px",
        height: "300px",
        borderRadius: "50%",
        background: "var(--accent-blue)",
        filter: "blur(150px)",
        opacity: 0.1,
        pointerEvents: "none",
      }} />

      <div
        className="glass-card onboarding-wizard-card"
        style={{
          width: "100%",
          maxWidth: "520px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          padding: "2rem",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--glass-border)",
          overflowY: "auto",
        }}
      >
        {/* Stepper */}
        <StepperHeader currentStep={step} />

        {/* Chat area */}
        <div
          className="onboarding-chat-area"
          style={{
            flex: 1,
            overflowY: "auto",
            marginBottom: "1.25rem",
            minHeight: "200px",
            maxHeight: "45vh",
            paddingRight: "0.5rem",
          }}
        >
          {messages.map((msg) => (
            <ChatBubble key={msg.id} text={msg.text} sender={msg.sender} />
          ))}
          {isTyping && <ChatBubble text="" sender="poseidon" isTyping />}
          <div ref={messagesEndRef} />
        </div>

        {/* Step-specific interactive area */}
        <div className="onboarding-action-area">
          {/* Step 1: Persona buttons */}
          {step === 1 && casualMode === null && (
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                className="btn-primary"
                onClick={() => handlePersonaSelect(true)}
                style={{
                  flex: 1,
                  minWidth: "180px",
                  padding: "0.85rem 1.25rem",
                  fontSize: "0.9rem",
                }}
              >
                🐠 I keep fish at home
              </button>
              <button
                className="btn-primary"
                onClick={() => handlePersonaSelect(false)}
                style={{
                  flex: 1,
                  minWidth: "180px",
                  padding: "0.85rem 1.25rem",
                  fontSize: "0.9rem",
                  background: "linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)",
                }}
              >
                🧬 I breed professionally
              </button>
            </div>
          )}

          {/* Step 2: Connect wallet + Choose name */}
          {step === 2 && !account && (
            <div style={{ textAlign: "center" }}>
              <button
                className="btn-primary"
                onClick={handleConnectWallet}
                disabled={isConnecting}
                style={{
                  padding: "0.85rem 2rem",
                  fontSize: "0.9rem",
                  minWidth: "200px",
                }}
              >
                {isConnecting ? "Connecting…" : casualMode ? "Create My Logbook" : "Initialize Node"}
              </button>
              <p style={{
                fontSize: "0.7rem",
                color: "var(--text-muted)",
                marginTop: "0.75rem",
              }}>
                {casualMode
                  ? "Sign up with email or Google — no extensions or passwords needed."
                  : "Email or Google login provisions an embedded MPC signing key."}
              </p>
              <button
                onClick={handleConnectMetaMask}
                disabled={isConnecting}
                style={{
                  marginTop: "0.75rem",
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  fontSize: "0.7rem",
                  cursor: "pointer",
                  textDecoration: "underline",
                  padding: "0.5rem",
                }}
              >
                {casualMode ? "Or connect an existing wallet" : "Link external wallet (MetaMask)"}
              </button>
            </div>
          )}

          {/* Step 2b: Choose display name (after wallet connected) */}
          {step === 2 && account && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", alignItems: "center" }}>
              <div style={{ width: "100%", maxWidth: "320px" }}>
                <label style={{ 
                  fontSize: "0.7rem", 
                  color: "var(--text-secondary)", 
                  display: "block", 
                  marginBottom: "0.4rem",
                  textAlign: "left",
                }}>
                  {casualMode ? "Your display name" : "Operator callsign"}
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value.slice(0, 30))}
                  placeholder={casualMode ? "Enter your name..." : "Enter callsign..."}
                  maxLength={30}
                  style={{
                    width: "100%",
                    padding: "0.75rem 1rem",
                    background: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid rgba(56, 189, 248, 0.2)",
                    borderRadius: "var(--radius-sm)",
                    color: "#fff",
                    fontSize: "1rem",
                    fontWeight: 600,
                    textAlign: "center",
                    outline: "none",
                    transition: "border-color 0.2s ease",
                  }}
                  onFocus={(e) => { e.target.style.borderColor = "rgba(56, 189, 248, 0.5)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "rgba(56, 189, 248, 0.2)"; }}
                  onKeyDown={(e) => { if (e.key === "Enter" && displayName.trim()) handleNameConfirm(); }}
                  autoFocus
                />
                <p style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginTop: "0.3rem", textAlign: "center" }}>
                  {casualMode ? "This is how other fishkeepers will see you" : "Visible on your operator profile"}
                </p>
              </div>
              <button
                className="btn-primary"
                onClick={handleNameConfirm}
                disabled={!displayName.trim()}
                style={{
                  padding: "0.7rem 2rem",
                  fontSize: "0.85rem",
                  opacity: displayName.trim() ? 1 : 0.5,
                }}
              >
                {casualMode ? "That's me! ✨" : "Confirm Callsign"}
              </button>
            </div>
          )}

          {/* Step 3: Echo egg */}
          {step === 3 && (
            <EchoEgg
              onTap={handleEggTap}
              tapped={eggTapped}
              glowIntensity={progress}
            />
          )}

          {/* Step 4: Tank setup form */}
          {step === 4 && (
            <form onSubmit={handleTankSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: "120px" }}>
                  <label style={{ fontSize: "0.7rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.3rem" }}>
                    {casualMode ? "Tank Size (gallons)" : "Volume (gal)"}
                  </label>
                  <input
                    type="number"
                    value={tankVolume}
                    onChange={(e) => setTankVolume(e.target.value)}
                    min="1"
                    required
                    style={{
                      width: "100%",
                      padding: "0.6rem",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid var(--glass-border)",
                      color: "#fff",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "0.85rem",
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: "100px" }}>
                  <label style={{ fontSize: "0.7rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.3rem" }}>
                    pH
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={tankPh}
                    onChange={(e) => setTankPh(e.target.value)}
                    min="4"
                    max="10"
                    required
                    style={{
                      width: "100%",
                      padding: "0.6rem",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid var(--glass-border)",
                      color: "#fff",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "0.85rem",
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: "100px" }}>
                  <label style={{ fontSize: "0.7rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.3rem" }}>
                    Temp (°C)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={tankTemp}
                    onChange={(e) => setTankTemp(e.target.value)}
                    min="10"
                    max="38"
                    required
                    style={{
                      width: "100%",
                      padding: "0.6rem",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid var(--glass-border)",
                      color: "#fff",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "0.85rem",
                    }}
                  />
                </div>
              </div>

              {/* Tank use — Pro mode gets structured selector */}
              {!casualMode && (
                <div>
                  <label style={{ fontSize: "0.7rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.3rem" }}>
                    Intended Use
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {["display", "grow-out", "breeding", "quarantine"].map((use) => (
                      <button
                        key={use}
                        type="button"
                        onClick={() => setTankUse(use)}
                        className={tankUse === use ? "btn-primary" : "btn-secondary"}
                        style={{
                          padding: "0.4rem 0.8rem",
                          fontSize: "0.75rem",
                          textTransform: "capitalize",
                        }}
                      >
                        {use}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="btn-primary"
                style={{
                  padding: "0.8rem",
                  fontSize: "0.9rem",
                  marginTop: "0.5rem",
                }}
              >
                {casualMode ? "Save My Tank ✨" : "Initialize Unit"}
              </button>
            </form>
          )}
        </div>

        {/* Catalog sync indicator (only visible during post-wizard hold) */}
        {step === 4 && !catalogReady && messages.some(m => m.text === DIALOGUE.catalogSyncing) && (
          <div style={{
            textAlign: "center",
            marginTop: "0.75rem",
            fontSize: "0.7rem",
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
          }}>
            <span style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "var(--accent-blue)",
              animation: "eggPulse 1.5s ease-in-out infinite",
            }} />
            Species archive syncing… {progress}%
          </div>
        )}
      </div>
    </div>
  );
}
