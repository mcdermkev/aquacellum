// poseidonWorker.js - Rule-Based local intent parser for Poseidon + Echo "Very Light v1"
self.onmessage = async function (e) {
  const { text, mode, persona, personaTone } = e.data;
  if (!text) return;

  const input = text.toLowerCase().trim();
  const activePersona = (personaTone || persona || mode || "casual").toLowerCase() === "pro" ? "professional" : "casual";
  const timestamp = Date.now();

  // Generate eventId using crypto or fallback
  let eventId;
  try {
    eventId = self.crypto.randomUUID();
  } catch (err) {
    eventId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Regular Expression Definitions
  const onboardingRegex = /new\s+tank|gallon|setup/i;
  const husbandryRegex = /fed|feed|scrap|clean|glass|water\s*test|parameter|ph/i;
  
  // Strict clinical / medical intercept definitions
  const medicalRegex = /sick|white\s+spots?|cure|disease|illness|dying|bloat|ich|velvet|fungus/i;

  let intent = "fallback_unknown";
  let message = "I'm still learning about your aquarium ecosystem. Could you try saying that another way?";
  let action = { type: "NONE", payload: {} };
  let echoReaction = {
    mood: "confused",
    glowActive: false,
    glowColor: "",
    swimSpeedMultiplier: 1.0,
    durationMs: 1500
  };

  // 1. Check Medical Intercept First
  if (medicalRegex.test(input)) {
    intent = "fallback_unknown";
    message = activePersona === "professional"
      ? "Diagnostics layer offline: Medical queries regarding fish pathology are unsupported in this version. Consult a qualified veterinarian."
      : "I'm sorry to hear your fish might be feeling unwell! Unfortunately, my medical diagnostic tools are offline in this beta version. Please check with an aquatic veterinarian.";
    action = { type: "NONE", payload: {} };
    echoReaction = {
      mood: "confused",
      glowActive: false,
      glowColor: "",
      swimSpeedMultiplier: 0.8,
      durationMs: 2500
    };

  // 2. Check Onboarding Seed
  } else if (onboardingRegex.test(input)) {
    intent = "onboarding_seed";
    message = activePersona === "professional"
      ? "System initialization: Creating primary containment unit profile."
      : "🐠 Welcome! Let's get your beautiful new aquarium setup started.";
    action = { type: "CREATE_TANK", payload: { rawQuery: text } };
    echoReaction = {
      mood: "happy",
      glowActive: true,
      glowColor: "#a855f7",
      swimSpeedMultiplier: 1.3,
      durationMs: 3000
    };

  // 3. Check Husbandry Log
  } else if (husbandryRegex.test(input)) {
    intent = "husbandry_log";
    action = { type: "LOG_HUSBANDRY", payload: { rawQuery: text } };
    
    // Sub-intent tone parsing
    if (input.includes("fed") || input.includes("feed")) {
      message = activePersona === "professional"
        ? "Husbandry event noted: Nutritional input cycle recorded successfully."
        : "🥣 I've logged the feeding for your fish! Look how happy they are.";
      echoReaction = {
        mood: "excited",
        glowActive: true,
        glowColor: "#38bdf8",
        swimSpeedMultiplier: 1.6,
        durationMs: 2500
      };
    } else if (input.includes("clean") || input.includes("scrape") || input.includes("glass")) {
      message = activePersona === "professional"
        ? "Maintenance event noted: Algae removal / glass clarity restoration logged."
        : "🧹 Excellent! I've recorded the tank glass cleaning.";
      echoReaction = {
        mood: "happy",
        glowActive: true,
        glowColor: "#a855f7",
        swimSpeedMultiplier: 1.2,
        durationMs: 2000
      };
    } else {
      // Water test / parameter fallback
      message = activePersona === "professional"
        ? "Telemetry analysis: Baseline water parameters submitted to local database."
        : "🧪 Water test registered! Keeping tracking of those parameters is key.";
      echoReaction = {
        mood: "calm",
        glowActive: true,
        glowColor: "#38bdf8",
        swimSpeedMultiplier: 1.0,
        durationMs: 2000
      };
    }
  }

  // Dispatch fully compliant PoseidonEventPayload
  self.postMessage({
    eventId,
    timestamp,
    intent,
    personaTone: activePersona,
    message,
    action,
    echoReaction
  });
};
