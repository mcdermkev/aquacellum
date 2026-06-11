import React, {
  forwardRef,
  useImperativeHandle,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// Poseidon's avatar lives in /public so it is served from the site root.
const POSEIDON_AVATAR = "/poseidon-avatar.jpg";

// ─────────────────────────────────────────────────────────────────────────────
// Dialogue Script — Poseidon's canonical onboarding copy
// Ported from the original OnboardingWizard so the revamped flow keeps the same
// persona-aware voice. Entries that vary by persona are objects keyed by
// "casual" | "pro"; entries that are persona-neutral are plain strings.
// ─────────────────────────────────────────────────────────────────────────────
export const DIALOGUE = {
  welcome:
    "Hello there. I'm Poseidon — your guide through these waters. I'll help you keep track of your fish, their stories, and everything that keeps them thriving. Before we begin… tell me how you keep fish.",

  personaConfirm: {
    casual:
      "Wonderful. Then we'll keep things simple and friendly. This is your personal aquarium logbook — nothing complicated, just the things that matter to you and your fish. I'll be right here whenever you need me.",
    pro: "Understood. Then we'll work with precision. This is your operational node. We'll track lineages, water chemistry, and breeding outcomes with the clarity your work deserves. I'm ready when you are.",
  },

  walletPending: {
    casual: "One moment while I set up your secure logbook…",
    pro: "Initializing operator node…",
  },

  walletSuccess: {
    casual:
      "There. Your entries are now cryptographically yours. Even if you switch devices, your history travels with you. No complicated keys to remember — just your fish and their stories.",
    pro: "Embedded signing key provisioned via MPC. Your actions on-chain are now tied to this identity. You can link an external wallet later if you need full self-custody control.",
  },

  namePrompt: {
    casual:
      "One last thing — what should I call you? I've suggested a name, but you can change it to whatever you like.",
    pro: "Designate your operator callsign. A default has been generated from your node address.",
  },

  echoIntro: {
    casual:
      "And this… is Echo. As you care for your fish, Echo grows alongside you. Feedings, water changes, successful spawns — every bit of care strengthens your companion. Go ahead… tap the egg.",
    pro: "This is Echo — your companion node. Every logged action, every verified spawn, every water parameter you record contributes to Echo's development. Tap the egg when you're ready.",
  },

  echoTapped: {
    casual:
      "There you go. Echo felt that. Keep tending your tanks and Echo will hatch, then grow stronger with you. It's a quiet kind of partnership.",
    pro: "Acknowledged. Echo is now linked to your operator profile. Continued accurate record-keeping will increase its tier and capabilities over time.",
  },

  echoNudge: "Go on, give it a tap.",

  tankSetupIntro: {
    casual: "Let's set up your first display tank. What size is it, roughly?",
    pro: "Initialize your primary containment unit. Enter volume, target parameters, and intended use.",
  },

  tankComplete: {
    casual:
      "Perfect. Your first tank is now logged. You just earned your first bit of experience — Echo felt that too. Welcome to Aquadex. Your journey starts here.",
    pro: "Unit initialized and recorded. First operational log complete. Echo's baseline has been established. You're ready to begin proper work.",
  },

  catalogSyncing: "Echo is syncing with the species archive… almost there.",
};

/**
 * resolveLine — pick the persona-aware copy for a dialogue entry.
 *
 * Pure helper (no React) so it can be unit-tested in isolation.
 *
 * @param {string|{casual?:string,pro?:string}} entry  A DIALOGUE value.
 * @param {"casual"|"pro"|boolean|null} persona  Persona, or the legacy
 *        `casualMode` boolean (true ⇒ casual, false ⇒ pro).
 * @returns {string} The resolved line, or "" when nothing matches.
 */
export function resolveLine(entry, persona) {
  if (entry == null) return "";
  if (typeof entry === "string") return entry;

  // Normalize persona: accept "casual"/"pro" strings or a casualMode boolean.
  let mode;
  if (persona === true) mode = "casual";
  else if (persona === false) mode = "pro";
  else mode = persona;

  if (mode === "casual" || mode === "pro") {
    // Fall back to the other tone if the requested one is missing.
    return entry[mode] ?? entry.casual ?? entry.pro ?? "";
  }
  // Unknown persona → default to casual, then pro.
  return entry.casual ?? entry.pro ?? "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Typing indicator — three bouncing dots (reuses `typingBounce` keyframes)
// ─────────────────────────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <span className="typing-dots" aria-hidden="true">
      <span>●</span>
      <span>●</span>
      <span>●</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A single chat row. Poseidon messages show his avatar; user messages align right.
// ─────────────────────────────────────────────────────────────────────────────
function NarratorRow({ text, sender = "poseidon", isTyping = false }) {
  const isPoseidon = sender === "poseidon";

  return (
    <div
      className={`poseidon-row poseidon-row--${isPoseidon ? "poseidon" : "user"}`}
      style={{
        display: "flex",
        gap: "0.6rem",
        alignItems: "flex-end",
        justifyContent: isPoseidon ? "flex-start" : "flex-end",
        marginBottom: "0.75rem",
      }}
    >
      {isPoseidon && (
        <img
          className="poseidon-avatar"
          src={POSEIDON_AVATAR}
          alt="Poseidon"
          draggable={false}
        />
      )}
      <div
        className="poseidon-bubble"
        style={
          isPoseidon
            ? undefined
            : {
                // User bubbles mirror the bubble corner to the opposite side.
                borderTopLeftRadius: "var(--radius-md)",
                borderTopRightRadius: "4px",
                background: "rgba(168, 85, 247, 0.10)",
                borderColor: "rgba(168, 85, 247, 0.25)",
              }
        }
      >
        {isTyping ? <TypingDots /> : text}
      </div>
    </div>
  );
}

/**
 * PoseidonNarrator — chat-style narration pane for onboarding.
 *
 * Renders Poseidon's avatar beside each of his chat bubbles and preserves the
 * original typing-indicator → reveal rhythm. The chat container is an
 * `aria-live="polite"` log so newly revealed lines are announced to assistive
 * technology.
 *
 * Drive the conversation imperatively via a ref:
 *
 *   const narrator = useRef(null);
 *   await narrator.current.addMessage(DIALOGUE.welcome);          // Poseidon
 *   await narrator.current.addMessage("Casual", "user", 0);       // the user
 *   await narrator.current.say(DIALOGUE.echoIntro, persona);      // persona-aware
 *
 * `addMessage(text, sender, delay)` returns a Promise that resolves once the
 * message has been revealed, so callers can sequence dialogue with `await`.
 *
 * Validates: Requirements 1.3, 8.2, 8.6, 9.1
 */
export const PoseidonNarrator = forwardRef(function PoseidonNarrator(
  { persona = null, typingDelay = 800, className = "", onMessageRevealed },
  ref
) {
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);

  const endRef = useRef(null);
  const timersRef = useRef(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Clear any pending typing timers so we don't update after unmount.
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };
  }, []);

  // Auto-scroll to the newest line as messages/typing state change.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Core API: show a typing indicator for `delay` ms, then reveal the message.
  const addMessage = useCallback(
    (text, sender = "poseidon", delay = typingDelay) =>
      new Promise((resolve) => {
        // User messages appear instantly (no typing beat for the human).
        const showTyping = sender === "poseidon" && delay > 0;
        if (showTyping) setIsTyping(true);

        const reveal = () => {
          if (!mountedRef.current) {
            resolve();
            return;
          }
          setIsTyping(false);
          const message = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            text,
            sender,
          };
          setMessages((prev) => [...prev, message]);
          if (typeof onMessageRevealed === "function") {
            onMessageRevealed(message);
          }
          resolve();
        };

        if (delay > 0) {
          const timer = setTimeout(() => {
            timersRef.current.delete(timer);
            reveal();
          }, delay);
          timersRef.current.add(timer);
        } else {
          reveal();
        }
      }),
    [typingDelay, onMessageRevealed]
  );

  // Convenience: resolve persona-aware copy then narrate it as Poseidon.
  const say = useCallback(
    (entry, personaOverride = persona, delay = typingDelay) =>
      addMessage(resolveLine(entry, personaOverride), "poseidon", delay),
    [addMessage, persona, typingDelay]
  );

  // Clear the transcript (used when replaying onboarding).
  const reset = useCallback(() => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current.clear();
    setIsTyping(false);
    setMessages([]);
  }, []);

  useImperativeHandle(
    ref,
    () => ({ addMessage, say, reset, getMessages: () => messages }),
    [addMessage, say, reset, messages]
  );

  return (
    <div
      className={`poseidon-narrator onboarding-chat-area${
        className ? ` ${className}` : ""
      }`}
      role="log"
      aria-live="polite"
      aria-label="Poseidon conversation"
    >
      {messages.map((msg) => (
        <NarratorRow key={msg.id} text={msg.text} sender={msg.sender} />
      ))}
      {isTyping && <NarratorRow sender="poseidon" isTyping />}
      <div ref={endRef} />
    </div>
  );
});

export default PoseidonNarrator;
