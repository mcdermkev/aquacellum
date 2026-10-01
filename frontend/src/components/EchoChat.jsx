import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  ChatCircleDots,
  Microphone,
  NotePencil,
  PaperPlaneRight,
  SpeakerHigh,
  Stop,
  X,
} from "@phosphor-icons/react";
import { db } from "../db";
import { usePoseidon } from "../hooks/usePoseidon";
import { useSpeciesData } from "../hooks/useSpeciesData";
import { useEchoAttend } from "../hooks/useEchoAttend";
import { useEchoFace } from "../hooks/useEchoFace";
import { handlePoseidonAction } from "../utils/poseidonBridge";
import { POSEIDON_ACTION, actionConfirmLabel, actionLabel, requiresConfirmation } from "../utils/poseidonActions";
import { parsePoseidonMessage } from "../utils/poseidonDeepLinks";
import { identifyFish } from "../services/echoVision";
import { checkGroup, compatForQuestion, findTankInText, recordsInTank } from "../services/echoMatch";
import { ECHO_FACE } from "../services/echoBehaviour";
import { speciesRecordFor } from "./logbook/inhabitants";
import { latestReading } from "./logbook/latestReading";
import { EchoRenderer } from "./EchoRenderer";
import { CompatCard, PhotoCard } from "./EchoCards";
import { EchoPlanner } from "./EchoPlanner";
import "./EchoChat.css";

/**
 * EchoChat — talk to Echo. She is powered by Poseidon.
 *
 * The one chat in the app (mounted once in App.jsx). It replaced two: the
 * floating Poseidon widget and the docked Poseidon console. Echo herself is the
 * button now (EchoAmbient dispatches `echo:toggle`), and every "Ask Echo"
 * elsewhere opens this with `echo:open` (services/echoChatBus.js), optionally
 * with a question already asked and a tank in context.
 *
 * What makes it more than a text box:
 *   - Answer cards. A compatibility question gets a card computed from the
 *     catalog (services/echoMatch.js) under Poseidon's sentence. The card is the
 *     facts; the model only writes the words around it.
 *   - Photos. The camera button asks Poseidon what fish it is and shows ranked
 *     guesses with real match numbers (services/echoVision.js).
 *   - Voice. Speak a question (Web Speech API, where the browser has it) and
 *     she reads the answer back. Any answer can be read aloud.
 *   - A tank planner, the second tab (EchoPlanner).
 *   - She reacts. Every question brackets `echo:thinking-start/-end`, every
 *     answer sends `echo:speaking` and a mood (`poseidon:echo-reaction`), so
 *     the corner Echo and the one in this header think, talk and react together.
 *
 * Confirm before write, always. Anything Poseidon proposes to change waits in
 * the bar above the input until the keeper says yes.
 */

const PERSIST_KEY = "aquadex_poseidon_global";
const CARDS_KEY = "aquadex_echo_cards";
const NEEDS_TANK = new Set([POSEIDON_ACTION.LOG_WATER_PARAMS, POSEIDON_ACTION.LOG_HUSBANDRY]);
const NO_CARD_INTENTS = new Set(["disabled", "too_long", "rate_limited"]);

const SpeechRecognition = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;
const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";

function loadCards() {
  try {
    const raw = sessionStorage.getItem(CARDS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveCards(cards) {
  try {
    // Photo thumbnails are object URLs; they die with the page, so they are not kept.
    const lean = {};
    for (const [key, list] of Object.entries(cards)) {
      const kept = list.filter((c) => !c.pending).map((c) => ({ ...c, thumb: null }));
      if (kept.length) lean[key] = kept;
    }
    sessionStorage.setItem(CARDS_KEY, JSON.stringify(lean));
  } catch {
    // Storage full or blocked: cards just won't survive a reload.
  }
}

/** Text for speech: no emoji, no stray markdown. */
function speakable(text) {
  return String(text || "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[*_#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function actionResultText(type, res) {
  if (res?.ok && res.ran) {
    if (type === POSEIDON_ACTION.CREATE_TANK) return "Tank created. It's in your tanks now.";
    if (type === POSEIDON_ACTION.LOG_WATER_PARAMS) return "Saved to the tank's water log.";
    if (type === POSEIDON_ACTION.LOG_HUSBANDRY) return "Logged.";
    return "Done.";
  }
  if (res?.reason === "nothing-to-write") return "I didn't find anything to save in that, so nothing was changed.";
  return "That didn't work, and nothing was changed.";
}

/** Poseidon's text with species and tab names as tappable links. */
function MessageText({ text, onNavigate }) {
  const segments = parsePoseidonMessage(text);
  if (segments.length === 1 && segments[0].type === "text") return <span>{text}</span>;
  return (
    <span>
      {segments.map((seg, i) => {
        if (seg.type === "species") {
          return (
            <button key={i} type="button" className="echo-chat__link" onClick={() => onNavigate({ type: "species", query: seg.query })}>
              {seg.content}
            </button>
          );
        }
        if (seg.type === "nav") {
          return (
            <button key={i} type="button" className="echo-chat__link echo-chat__link--nav" onClick={() => onNavigate({ type: "nav", tab: seg.tab })}>
              {seg.content}
            </button>
          );
        }
        return <span key={i}>{seg.content}</span>;
      })}
    </span>
  );
}

export function EchoChat({ walletAddress, casualModeActive = true, activeTab = "tanks", showLauncher = false }) {
  const casual = casualModeActive !== false;
  const mode = casual ? "casual" : "pro";

  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState("chat");
  const [contextTankId, setContextTankId] = useState(null);
  const [tanks, setTanks] = useState([]);
  const [plannerSeed, setPlannerSeed] = useState(null);
  const [seed, setSeed] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionNote, setActionNote] = useState(null);
  const [cards, setCards] = useState(loadCards);
  const [inputText, setInputText] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [micNote, setMicNote] = useState(null);
  const [speakingId, setSpeakingId] = useState(null);

  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const endRef = useRef(null);
  const openerRef = useRef(null);
  const busyRef = useRef(false);
  const recRef = useRef(null);
  const heardRef = useRef("");
  const thumbsRef = useRef([]);
  const seededRef = useRef(null);

  const { data: catalog = [] } = useSpeciesData();
  const {
    messages,
    isLoading,
    isOnline,
    sendMessage,
    initGreeting,
    clearConversation,
    requestsRemaining,
  } = usePoseidon({ tankId: contextTankId, mode, walletAddress, persistKey: PERSIST_KEY });

  const face = useEchoFace(isOpen);
  useEchoAttend(panelRef, isOpen);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const tanksRef = useRef(tanks);
  tanksRef.current = tanks;

  // ─── Tanks (for context, cards and the planner) ─────────────────────────
  const refreshTanks = useCallback(async () => {
    try {
      const rows = await db.tanks.filter((t) => t.active !== false).toArray();
      setTanks(rows);
      return rows;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (isOpen) refreshTanks();
  }, [isOpen, refreshTanks]);

  const contextTank = useMemo(
    () => (contextTankId == null ? null : tanks.find((t) => String(t.id) === String(contextTankId)) || null),
    [tanks, contextTankId],
  );

  // ─── Cards ──────────────────────────────────────────────────────────────
  useEffect(() => saveCards(cards), [cards]);

  const addCard = useCallback((anchorId, card) => {
    setCards((prev) => ({ ...prev, [anchorId]: [...(prev[anchorId] || []).filter((c) => c.id !== card.id), card] }));
  }, []);

  const updateCard = useCallback((anchorId, cardId, patch) => {
    setCards((prev) => ({
      ...prev,
      [anchorId]: (prev[anchorId] || []).map((c) => (c.id === cardId ? { ...c, ...patch } : c)),
    }));
  }, []);

  // ─── Open, close, and tell everyone ─────────────────────────────────────
  const open = useCallback(() => {
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    try { recRef.current?.abort(); } catch { /* not listening */ }
    if (canSpeak) window.speechSynthesis.cancel();
    setSpeakingId(null);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("echo:chat-state", { detail: { open: isOpen } }));
    if (isOpen) {
      // Phones: no autofocus, or the keyboard covers her answer.
      const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
      if (!coarse) {
        const t = setTimeout(() => inputRef.current?.focus(), 60);
        return () => clearTimeout(t);
      }
    } else if (openerRef.current && document.contains(openerRef.current)) {
      openerRef.current.focus();
      openerRef.current = null;
    }
    return undefined;
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && messages.length === 0) initGreeting();
  }, [isOpen, messages.length, initGreeting]);

  // Tapping Echo toggles; `echo:open` and `echo:open-planner` come from the
  // rest of the app. preventDefault tells the static-page mount of Echo that
  // there is a chat here, so it does not navigate to /poseidon.html.
  useEffect(() => {
    const onToggle = (e) => {
      e.preventDefault?.();
      setIsOpen((v) => {
        if (!v && document.activeElement instanceof HTMLElement) openerRef.current = document.activeElement;
        return !v;
      });
    };
    const onOpen = (e) => {
      const d = e?.detail || {};
      if (d.tankId != null) setContextTankId(d.tankId);
      setView("chat");
      open();
      if (d.seedPrompt) setSeed({ text: String(d.seedPrompt), n: Date.now() });
    };
    const onOpenPlanner = (e) => {
      const d = e?.detail || {};
      setPlannerSeed({ species: Array.isArray(d.species) ? d.species : [], tankId: d.tankId ?? null, n: Date.now() });
      setView("plan");
      open();
    };
    window.addEventListener("echo:toggle", onToggle);
    window.addEventListener("echo:open", onOpen);
    window.addEventListener("echo:open-planner", onOpenPlanner);
    return () => {
      window.removeEventListener("echo:toggle", onToggle);
      window.removeEventListener("echo:open", onOpen);
      window.removeEventListener("echo:open-planner", onOpenPlanner);
    };
  }, [open]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  useEffect(() => () => {
    for (const url of thumbsRef.current) URL.revokeObjectURL(url);
  }, []);

  // ─── Speaking ───────────────────────────────────────────────────────────
  const speak = useCallback((msg) => {
    if (!canSpeak || !msg) return;
    const synth = window.speechSynthesis;
    if (speakingId === msg.id) {
      synth.cancel();
      setSpeakingId(null);
      return;
    }
    synth.cancel();
    const text = speakable(msg.text);
    if (!text) return;
    const u = new window.SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.pitch = 1.1;
    u.onend = () => setSpeakingId((id) => (id === msg.id ? null : id));
    u.onerror = () => setSpeakingId((id) => (id === msg.id ? null : id));
    setSpeakingId(msg.id);
    // She talks for as long as the voice does (roughly 14 characters a second).
    window.dispatchEvent(new CustomEvent("echo:speaking", { detail: { durationMs: Math.min(20000, 800 + text.length * 70) } }));
    synth.speak(u);
  }, [speakingId]);

  // ─── Asking ─────────────────────────────────────────────────────────────
  const tankFor = useCallback((text, rows) => {
    if (contextTankId != null) {
      const t = rows.find((r) => String(r.id) === String(contextTankId));
      if (t) return t;
    }
    return findTankInText(text, rows);
  }, [contextTankId]);

  const ask = useCallback(async (raw, opts = {}) => {
    const text = String(raw || "").trim();
    if (!text || busyRef.current) return null;
    busyRef.current = true;
    setPendingAction(null);
    setActionNote(null);

    window.dispatchEvent(new CustomEvent("echo:thinking-start"));
    let reply = null;
    let card = opts.card || null;
    let cardArgs = null;
    let rows = [];
    let tank = null;
    try {
      rows = tanksRef.current.length ? tanksRef.current : await refreshTanks();
      tank = tankFor(text, rows);
      cardArgs = {
        text,
        catalog,
        tank: tank ? { ...tank, reading: latestReading(tank.logs) } : null,
        tankRecords: tank && catalog.length ? recordsInTank(tank, catalog) : [],
      };
      // The card is worked out BEFORE asking and sent along, so Echo's
      // sentence agrees with it (api/_lib/poseidonGateway.js compatCardContext).
      if (!card && catalog.length) card = compatForQuestion(cardArgs);
      reply = await sendMessage(text, { compatCard: card });
    } finally {
      busyRef.current = false;
      window.dispatchEvent(new CustomEvent("echo:thinking-end"));
    }
    if (!reply) return null;

    if (NO_CARD_INTENTS.has(reply.intent)) {
      card = null;
    } else if (!card && catalog.length && cardArgs) {
      // The question did not read like a compatibility question but the answer
      // treated it as one: show the card anyway.
      const force = /compat/i.test(String(reply.intent || "")) || reply.action?.type === POSEIDON_ACTION.QUERY_COMPATIBILITY;
      if (force) card = compatForQuestion({ ...cardArgs, force: true });
    }
    if (card) addCard(reply.id, { id: `compat-${reply.id}`, kind: "compat", result: card });

    // She talks while the answer lands, then shows how she feels about it. A
    // card's verdict wins over the model's mood: it is the fact.
    const length = String(reply.text || "").length;
    window.dispatchEvent(new CustomEvent("echo:speaking", { detail: { durationMs: Math.min(6000, 1200 + length * 20) } }));
    const mood = card?.mood || reply.echoReaction?.mood || null;
    if (mood) {
      window.dispatchEvent(new CustomEvent("poseidon:echo-reaction", { detail: { ...(reply.echoReaction || {}), mood } }));
    }

    if (reply.action && requiresConfirmation(reply.action.type)) {
      const onlyTank = rows.length === 1 ? rows[0] : null;
      setPendingAction({
        type: reply.action.type,
        payload: reply.action.payload || {},
        msgId: reply.id,
        tankId: tank?.id ?? onlyTank?.id ?? null,
      });
    }

    if (opts.viaVoice) speak(reply);
    return reply;
  }, [sendMessage, refreshTanks, tankFor, catalog, addCard, speak]);

  const askRef = useRef(ask);
  askRef.current = ask;

  // A question handed over by `echo:open` is asked once, after the tank it
  // came with has been set.
  useEffect(() => {
    if (!seed || seededRef.current === seed.n) return;
    seededRef.current = seed.n;
    askRef.current(seed.text);
  }, [seed]);

  const onSubmit = (e) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || isLoading) return;
    setInputText("");
    ask(text);
  };

  // ─── The confirm-before-write bar ───────────────────────────────────────
  const confirmAction = async () => {
    const a = pendingAction;
    if (!a) return;
    setPendingAction(null);
    const res = await handlePoseidonAction({
      type: a.type,
      payload: a.payload,
      tankId: a.tankId ?? undefined,
      walletAddress,
    });
    if (a.type === POSEIDON_ACTION.NAVIGATE && res?.ok) {
      close();
      return;
    }
    const ok = !!(res?.ok && res.ran);
    setActionNote({ msgId: a.msgId, ok, text: actionResultText(a.type, res) });
    window.dispatchEvent(new CustomEvent("poseidon:echo-reaction", { detail: { mood: ok ? "happy" : "confused" } }));
    if (ok) refreshTanks();
  };

  const pendingTank = pendingAction?.tankId != null
    ? tanks.find((t) => String(t.id) === String(pendingAction.tankId)) || null
    : null;
  const pendingNeedsTank = pendingAction && NEEDS_TANK.has(pendingAction.type) && !pendingTank;

  // ─── Photos ─────────────────────────────────────────────────────────────
  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setView("chat");
    const list = messagesRef.current;
    const anchor = list[list.length - 1]?.id || "init";
    const id = `photo-${Date.now()}`;
    let thumb = null;
    try {
      thumb = URL.createObjectURL(file);
      thumbsRef.current.push(thumb);
    } catch {
      thumb = null;
    }
    addCard(anchor, { id, kind: "photo", thumb, pending: true, result: null });
    setPhotoBusy(true);
    let result;
    try {
      result = await identifyFish(file, { mode });
    } catch {
      result = { success: false, error: "I couldn't look at that photo." };
    } finally {
      setPhotoBusy(false);
    }
    updateCard(anchor, id, { pending: false, result });
    const top = result?.candidates?.[0];
    const mood = !result?.success
      ? "concerned"
      : !top
        ? "confused"
        : Number(top.confidence) >= 0.6 ? "happy" : "alert";
    window.dispatchEvent(new CustomEvent("poseidon:echo-reaction", { detail: { mood } }));
  };

  const askAboutCandidate = (c) => {
    ask(`Tell me about keeping ${c.scientificName}${c.commonName ? ` (${c.commonName})` : ""}.`);
  };

  const checkCandidate = (c) => {
    if (!contextTank) return;
    const rec = speciesRecordFor({ scientificName: c.scientificName, commonName: c.catalogCommonName || c.commonName }, catalog);
    if (!rec) return;
    const others = recordsInTank(contextTank, catalog).filter((r) => r.scientificName !== rec.scientificName);
    const card = checkGroup({ species: [rec, ...others], tank: { ...contextTank, reading: latestReading(contextTank.logs) } });
    ask(`Could ${rec.commonName || rec.scientificName} live in my tank "${contextTank.name}"?`, { card });
  };

  // ─── Voice in ───────────────────────────────────────────────────────────
  const toggleMic = () => {
    if (!SpeechRecognition) return;
    if (listening) {
      try { recRef.current?.stop(); } catch { /* already stopped */ }
      return;
    }
    setMicNote(null);
    let rec;
    try {
      rec = new SpeechRecognition();
    } catch {
      setMicNote("Voice isn't available in this browser.");
      return;
    }
    rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    heardRef.current = "";
    rec.onresult = (ev) => {
      let heard = "";
      for (let i = 0; i < ev.results.length; i += 1) heard += ev.results[i][0].transcript;
      heardRef.current = heard;
      setInputText(heard);
    };
    rec.onerror = (ev) => {
      if (ev?.error === "not-allowed" || ev?.error === "service-not-allowed") setMicNote("Microphone access is blocked for this site.");
      else if (ev?.error === "no-speech") setMicNote("I didn't catch that. Tap the mic and try again.");
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      const heard = heardRef.current.trim();
      heardRef.current = "";
      if (heard) {
        setInputText("");
        askRef.current(heard, { viaVoice: true });
      }
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setMicNote("Voice isn't available right now.");
    }
  };

  // ─── Misc ───────────────────────────────────────────────────────────────
  const newConversation = () => {
    clearConversation();
    setCards({});
    setPendingAction(null);
    setActionNote(null);
    for (const url of thumbsRef.current) URL.revokeObjectURL(url);
    thumbsRef.current = [];
    initGreeting();
  };

  const onNavigate = useCallback((link) => {
    if (link.type === "nav") {
      window.dispatchEvent(new CustomEvent("poseidon:navigate", { detail: { tab: link.tab } }));
    } else if (link.type === "species") {
      window.dispatchEvent(new CustomEvent("poseidon:navigate", { detail: { tab: "gallery", search: link.query } }));
    }
    close();
  }, [close]);

  useEffect(() => {
    if (isOpen && view === "chat") endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, cards, isLoading, isOpen, view, actionNote]);

  const chips = useMemo(() => {
    if (contextTank) {
      const n = contextTank.name || "this tank";
      return casual
        ? [
            { label: "Are my fish OK together?", ask: `Are the fish in my tank "${n}" compatible with each other?` },
            { label: "What could I add?", ask: `What fish could I add to my tank "${n}"?` },
            { label: "How's my last water test?", ask: `How does the latest water test for my tank "${n}" look?` },
            { label: "Plan changes", plan: true },
          ]
        : [
            { label: "Compatibility: this tank", ask: `Check compatibility of the inhabitants of "${n}".` },
            { label: "Stocking options", ask: `Suggest species for "${n}".` },
            { label: "Review last test", ask: `Review the latest water test for "${n}".` },
            { label: "Planner", plan: true },
          ];
    }
    const byTab = activeTab === "breeder"
      ? { label: casual ? "Spawning conditions" : "Spawning conditions", ask: "What conditions help fish spawn, and how do I raise the fry?" }
      : { label: casual ? "Help me set up a first tank" : "New tank setup", ask: "Help me set up my first tank." };
    return casual
      ? [
          { label: "Can a betta live with neon tetras?", ask: "Can a betta live with neon tetras?" },
          { label: "What fish is this?", photo: true },
          { label: "Plan a tank", plan: true },
          byTab,
        ]
      : [
          { label: "Betta + neon tetra", ask: "Can a betta live with neon tetras?" },
          { label: "Identify from photo", photo: true },
          { label: "Stocking planner", plan: true },
          byTab,
        ];
  }, [contextTank, casual, activeTab]);

  const runChip = (chip) => {
    if (chip.plan) {
      setPlannerSeed({ species: [], tankId: contextTank?.id ?? null, n: Date.now() });
      setView("plan");
    } else if (chip.photo) {
      fileRef.current?.click();
    } else if (chip.ask) {
      ask(chip.ask);
    }
  };

  const quota = isOnline
    ? `${requestsRemaining} ${casual ? "questions left this hour" : "left this hour"}`
    : "Offline";

  const launcher = showLauncher && !isOpen ? (
    <button type="button" className="echo-chat-launcher" onClick={open} aria-label="Open chat with Echo">
      <ChatCircleDots size={22} weight="duotone" aria-hidden="true" />
      <span>Ask Echo</span>
    </button>
  ) : null;

  if (!isOpen) return launcher;

  const panel = (
    <div
      ref={panelRef}
      className={`echo-chat echo-chat--${mode}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="echo-chat-title"
    >
      <header className="echo-chat__head">
        <div className="echo-chat__me" aria-hidden="true">
          <EchoRenderer size={58} expression={face} animated />
          <span className={`echo-chat__status${isOnline ? "" : " echo-chat__status--off"}`} />
        </div>
        <div className="echo-chat__titles">
          <h2 id="echo-chat-title" className="echo-chat__title">Echo</h2>
          <p className="echo-chat__sub">Powered by Poseidon</p>
          <p className="echo-chat__quota">{quota}</p>
        </div>
        <div className="echo-chat__headbtns">
          <button type="button" className="echo-chat__iconbtn" onClick={newConversation} aria-label="Start a new conversation" title="New conversation">
            <NotePencil size={18} aria-hidden="true" />
          </button>
          <button type="button" className="echo-chat__iconbtn" onClick={close} aria-label="Close chat" title="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="echo-chat__tabs" role="tablist" aria-label="Echo">
        <button
          type="button"
          role="tab"
          id="echo-tab-chat"
          aria-selected={view === "chat"}
          aria-controls="echo-panel-chat"
          className={`echo-chat__tab${view === "chat" ? " echo-chat__tab--on" : ""}`}
          onClick={() => setView("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          role="tab"
          id="echo-tab-plan"
          aria-selected={view === "plan"}
          aria-controls="echo-panel-plan"
          className={`echo-chat__tab${view === "plan" ? " echo-chat__tab--on" : ""}`}
          onClick={() => setView("plan")}
        >
          Plan a tank
        </button>
      </div>

      {contextTank && view === "chat" && (
        <div className="echo-chat__context">
          <span>About <strong>{contextTank.name || "this tank"}</strong></span>
          <button type="button" onClick={() => setContextTankId(null)} aria-label={`Stop talking about ${contextTank.name || "this tank"}`}>×</button>
        </div>
      )}

      {view === "plan" ? (
        <div className="echo-chat__body" role="tabpanel" id="echo-panel-plan" aria-labelledby="echo-tab-plan">
          <EchoPlanner
            catalog={catalog}
            tanks={tanks}
            seed={plannerSeed}
            casual={casual}
            onAsk={(prompt, card) => {
              setView("chat");
              ask(prompt, { card });
            }}
          />
        </div>
      ) : (
        <div className="echo-chat__body" role="tabpanel" id="echo-panel-chat" aria-labelledby="echo-tab-chat">
          <ol className="echo-chat__list" aria-live="polite" aria-relevant="additions">
            {messages.map((msg) => {
              const mine = msg.sender === "user";
              const attached = cards[msg.id] || [];
              return (
                <li key={msg.id} className={`echo-chat__row${mine ? " echo-chat__row--me" : ""}`}>
                  {!mine && <img className="echo-chat__avatar" src={ECHO_FACE} alt="" aria-hidden="true" />}
                  <div className="echo-chat__stack">
                    <div className={`echo-chat__bubble${mine ? " echo-chat__bubble--me" : ""}`}>
                      <span className="echo-sr">{mine ? "You: " : "Echo: "}</span>
                      {!casual && !mine && msg.intent && msg.intent !== "init" && (
                        <span className="echo-chat__meta">
                          {msg.intent.replace(/_/g, " ")}
                          {msg.confidence != null ? ` · ${Math.round(msg.confidence * 100)}% confidence` : ""}
                        </span>
                      )}
                      {mine ? <span>{msg.text}</span> : <MessageText text={msg.text} onNavigate={onNavigate} />}
                    </div>
                    {!mine && canSpeak && msg.intent !== "init" && (
                      <button
                        type="button"
                        className="echo-chat__speak"
                        onClick={() => speak(msg)}
                        aria-label={speakingId === msg.id ? "Stop reading" : "Read this aloud"}
                        aria-pressed={speakingId === msg.id}
                      >
                        {speakingId === msg.id ? <Stop size={14} aria-hidden="true" /> : <SpeakerHigh size={14} aria-hidden="true" />}
                        <span>{speakingId === msg.id ? "Stop" : "Listen"}</span>
                      </button>
                    )}
                    {attached.map((c) => (
                      c.kind === "compat"
                        ? <CompatCard key={c.id} result={c.result} />
                        : c.pending
                          ? (
                            <div key={c.id} className="echo-card echo-card--photo echo-card--pending" role="status">
                              {c.thumb && <img className="echo-card__thumb" src={c.thumb} alt="Your photo" />}
                              <span>{casual ? "Taking a look…" : "Analysing image…"}</span>
                            </div>
                          )
                          : (
                            <PhotoCard
                              key={c.id}
                              result={c.result}
                              thumb={c.thumb}
                              onAsk={askAboutCandidate}
                              onCheck={contextTank ? checkCandidate : undefined}
                              tankName={contextTank?.name || null}
                            />
                          )
                    ))}
                    {actionNote?.msgId === msg.id && (
                      <p className={`echo-chat__note${actionNote.ok ? " echo-chat__note--ok" : ""}`} role="status">{actionNote.text}</p>
                    )}
                  </div>
                </li>
              );
            })}
            {isLoading && (
              <li className="echo-chat__row" aria-label="Echo is thinking">
                <img className="echo-chat__avatar" src={ECHO_FACE} alt="" aria-hidden="true" />
                <div className="echo-chat__bubble echo-chat__bubble--typing" aria-hidden="true">
                  <span /><span /><span />
                </div>
              </li>
            )}
          </ol>

          {messages.length <= 1 && !isLoading && (
            <div className="echo-chat__chips" aria-label="Ideas to ask">
              {chips.map((chip) => (
                <button key={chip.label} type="button" className="echo-chat__chip" onClick={() => runChip(chip)}>
                  {chip.label}
                </button>
              ))}
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {pendingAction && (
        <div className="echo-chat__confirm" role="alert">
          <p>
            {casual
              ? `Echo wants to ${actionLabel(pendingAction.type, { casual: true })}`
              : `Proposed: ${actionLabel(pendingAction.type, { casual: false })}`}
            {pendingTank ? ` for ${pendingTank.name}` : ""}.
          </p>
          {pendingNeedsTank && tanks.length > 0 && (
            <label className="echo-chat__confirmtank">
              <span>Which tank?</span>
              <select
                value=""
                onChange={(e) => setPendingAction((a) => (a ? { ...a, tankId: e.target.value || null } : a))}
              >
                <option value="">Choose a tank</option>
                {tanks.map((t) => <option key={t.id} value={String(t.id)}>{t.name || "Unnamed tank"}</option>)}
              </select>
            </label>
          )}
          <div className="echo-chat__confirmbtns">
            <button type="button" className="echo-chat__yes" onClick={confirmAction} disabled={pendingNeedsTank}>
              {actionConfirmLabel(pendingAction.type, { casual })}
            </button>
            <button type="button" className="echo-chat__no" onClick={() => setPendingAction(null)}>
              {casual ? "Not now" : "Skip"}
            </button>
          </div>
        </div>
      )}

      {view === "chat" && (
        <form className="echo-chat__form" onSubmit={onSubmit}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPhoto}
            hidden
            tabIndex={-1}
            aria-hidden="true"
          />
          <button
            type="button"
            className="echo-chat__tool"
            onClick={() => fileRef.current?.click()}
            disabled={photoBusy}
            aria-label="Send Echo a photo of a fish"
            title="What fish is this?"
          >
            <Camera size={20} aria-hidden="true" />
          </button>
          {SpeechRecognition && (
            <button
              type="button"
              className={`echo-chat__tool${listening ? " echo-chat__tool--live" : ""}`}
              onClick={toggleMic}
              aria-label={listening ? "Stop listening" : "Ask by voice"}
              aria-pressed={listening}
              title={listening ? "Stop" : "Ask by voice"}
            >
              <Microphone size={20} weight={listening ? "fill" : "regular"} aria-hidden="true" />
            </button>
          )}
          <label className="echo-sr" htmlFor="echo-chat-input">Message Echo</label>
          <input
            id="echo-chat-input"
            ref={inputRef}
            className="echo-chat__input"
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={listening ? "Listening…" : casual ? "Ask Echo anything" : "Query"}
            maxLength={1000}
            disabled={isLoading}
            autoComplete="off"
          />
          <button type="submit" className="echo-chat__send" disabled={!inputText.trim() || isLoading} aria-label="Send">
            <PaperPlaneRight size={18} weight="fill" aria-hidden="true" />
          </button>
        </form>
      )}
      {micNote && view === "chat" && <p className="echo-chat__micnote" role="status">{micNote}</p>}
    </div>
  );

  return (
    <>
      {launcher}
      {createPortal(panel, document.body)}
    </>
  );
}

export default EchoChat;
