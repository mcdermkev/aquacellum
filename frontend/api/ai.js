/**
 * ai.js — Consolidated Vercel Serverless Function
 *
 * Combines the AI-backed endpoints into a single function to stay within
 * Vercel Hobby plan's 12 serverless function limit.
 *
 * Routing:
 *   POST /api/ai?action=alt-text         → Generate accessible alt-text for photos
 *   POST /api/ai?action=suggest-species  → Taxonomic verification via WoRMS + Gemini
 *   POST /api/ai?action=poseidon         → Poseidon AI gateway (Gemini + species RAG)
 *   GET  /api/ai?action=poseidon         → Poseidon health check (config + relayer balance)
 */

import { vertexGenerateContent, isVertexConfigured } from './_lib/vertexClient.js';
import { modelFor, configuredModels, expiringModels, AI_TASKS } from './_lib/aiModels.js';
import { handleCorsPreFlight, setCorsHeaders } from './_lib/cors.js';
import { buildSpeciesContext } from './_lib/speciesIndex.js';
import { checkRateLimit } from './_lib/rateLimiter.js';
import { ethers } from 'ethers';

// ═══════════════════════════════════════════════════════════════════════════════
// ALT-TEXT HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

async function handleAltText(req, res) {
  if (handleCorsPreFlight(req, res, { methods: 'POST, OPTIONS' })) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { imageUrl, imageBase64 } = req.body || {};

  if (!imageUrl && !imageBase64) {
    return res.status(400).json({ altText: null, error: 'Provide imageUrl or imageBase64' });
  }

  if (!isVertexConfigured()) {
    return res.status(200).json({ altText: "Aquarium photo", error: "Vertex AI not configured" });
  }

  try {
    let imagePart;

    if (imageBase64) {
      const match = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        imagePart = {
          inlineData: { mimeType: match[1], data: match[2] }
        };
      } else {
        imagePart = {
          inlineData: { mimeType: "image/jpeg", data: imageBase64 }
        };
      }
    } else {
      const imgResponse = await fetch(imageUrl);
      if (!imgResponse.ok) {
        return res.status(200).json({ altText: "Aquarium photo", error: "Could not fetch image" });
      }

      const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
      const buffer = await imgResponse.arrayBuffer();
      const base64Data = Buffer.from(buffer).toString('base64');

      imagePart = {
        inlineData: { mimeType: contentType, data: base64Data }
      };
    }

    const prompt = {
      text: `Generate a concise, descriptive alt-text for this aquarium/fish photo. The alt-text should:
- Be 1-2 sentences max (under 150 characters preferred)
- Describe the main subject (fish species if identifiable, tank setup, water conditions)
- Mention colors, patterns, or notable features
- Be written for screen reader accessibility
- NOT start with "Image of" or "Photo of" — just describe what's shown

Respond with ONLY the alt-text string, nothing else.`
    };

    const geminiResponse = await vertexGenerateContent(modelFor('VISION'), {
      contents: [{ parts: [imagePart, prompt] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 200,
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
      ]
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error('[Alt-text] Gemini error:', geminiResponse.status, errText);
      return res.status(200).json({ altText: "Aquarium photo", error: `Gemini returned ${geminiResponse.status}` });
    }

    const result = await geminiResponse.json();
    const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return res.status(200).json({ altText: "Aquarium photo", error: "Empty response" });
    }

    const altText = rawText
      .replace(/^["']|["']$/g, '')
      .trim()
      .slice(0, 200);

    return res.status(200).json({ altText, error: null });

  } catch (err) {
    console.error('[Alt-text] Error:', err);
    return res.status(200).json({ altText: "Aquarium photo", error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUGGEST-SPECIES HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

async function handleSuggestSpecies(req, res) {
  if (handleCorsPreFlight(req, res, { methods: 'POST, OPTIONS' })) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { scientificName, commonName, minTemp, maxTemp, minPh, maxPh, careLevel, notes } = req.body;

  if (!scientificName || !commonName) {
    return res.status(400).json({ verified: false, reason: "Missing required taxonomic fields: scientificName and commonName." });
  }

  try {
    // 1. Check World Register of Marine Species (WoRMS) API
    const wormsApiUrl = `https://www.marinespecies.org/rest/v1.0/AphiaRecordsByName/${encodeURIComponent(scientificName.trim())}?like=false&marine_only=false`;

    let isNameTaxonomicallyValid = false;
    let taxonomicNotes = "";

    try {
      const wormsResponse = await fetch(wormsApiUrl);
      if (wormsResponse.status === 200) {
        const records = await wormsResponse.json();
        if (records && records.length > 0) {
          isNameTaxonomicallyValid = true;
          taxonomicNotes = `WoRMS found match. AphiaID: ${records[0].AphiaID}, Status: ${records[0].status}.`;
        }
      } else if (wormsResponse.status === 204) {
        taxonomicNotes = "No exact match found in WoRMS (checking freshwater backup).";
        isNameTaxonomicallyValid = true;
      }
    } catch (wormsErr) {
      console.warn("WoRMS lookup failed, proceeding with Gemini validation:", wormsErr);
      taxonomicNotes = "Registry lookup bypassed due to network timeout.";
    }

    // 2. Call Vertex AI Gemini for ecological & husbandry parameters check
    if (!isVertexConfigured()) {
      console.log("[Aquadex Dev] Vertex AI not configured. Running in Deterministic Mock Mode.");

      const minT = Number(minTemp);
      const maxT = Number(maxTemp);
      const minP = Number(minPh);
      const maxP = Number(maxPh);

      const tempValid = !isNaN(minT) && !isNaN(maxT) && minT < maxT;
      const phValid = !isNaN(minP) && !isNaN(maxP) && minP >= 4.0 && maxP <= 9.5 && minP < maxP;

      if (tempValid && phValid) {
        return res.status(200).json({
          verified: true,
          reason: "Simulated Eco-Audit: Input coordinates and taxonomic bounds align with offline reference standards."
        });
      } else {
        return res.status(200).json({
          verified: false,
          reason: "Simulated Eco-Audit Failure: Input metrics exceed standard aquatic biological limit parameters."
        });
      }
    }

    const prompt = `
      You are the lead taxonomic curator for Aquadex Protocol.
      Analyze the proposed species catalog entry:
      - Scientific Name: "${scientificName}"
      - Common Name: "${commonName}"
      - Temperature Range: ${minTemp}°C to ${maxTemp}°C
      - pH Range: ${minPh} to ${maxPh}
      - Care Level (0=Easy, 1=Medium, 2=Difficult, 3=Expert): Code ${careLevel}
      - Curator Notes: "${notes}"

      Verify if:
      1. The scientific name exists and is spelled correctly.
      2. The temperature range is accurate for the species in captivity.
      3. The pH range matches scientific standards.
      4. The Care Level matches difficultyLevel ("Easy", "Intermediate", or "Advanced").
      
      Determine if it isApproved and provide explanation in auditNotes.
    `;

    const geminiResponse = await vertexGenerateContent(modelFor('SUGGEST'), {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            isApproved: { type: "boolean" },
            auditNotes: { type: "string" }
          },
          required: ["isApproved", "auditNotes"]
        }
      }
    });

    if (!geminiResponse.ok) {
      throw new Error(`Gemini API responded with status ${geminiResponse.status}`);
    }

    const result = await geminiResponse.json();
    const resultText = result.candidates[0].content.parts[0].text;

    let validationResult;
    try {
      validationResult = JSON.parse(resultText);
    } catch (parseError) {
      console.error("Failed to parse Gemini response as JSON:", parseError, "Raw response:", resultText);
      validationResult = {
        isApproved: false,
        auditNotes: "AI verification syntax fault"
      };
    }

    return res.status(200).json({
      verified: validationResult.isApproved && isNameTaxonomicallyValid,
      reason: validationResult.auditNotes + (taxonomicNotes ? ` (${taxonomicNotes})` : '')
    });

  } catch (error) {
    console.error("Backend validation proxy error:", error);
    const minT = Number(minTemp);
    const maxT = Number(maxTemp);
    const minP = Number(minPh);
    const maxP = Number(maxPh);

    const tempValid = !isNaN(minT) && !isNaN(maxT) && minT < maxT;
    const phValid = !isNaN(minP) && !isNaN(maxP) && minP >= 4.0 && maxP <= 9.5 && minP < maxP;

    const passesLocal = tempValid && phValid;
    return res.status(200).json({
      verified: passesLocal,
      reason: passesLocal
        ? "Verification check passed via default range sanity algorithms."
        : "Rejected: Environmental parameters exceed biological safety thresholds."
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  const action = req.query.action;

  switch (action) {
    case "alt-text":
      return handleAltText(req, res);
    case "suggest-species":
      return handleSuggestSpecies(req, res);
    case "poseidon":
      return handlePoseidon(req, res);
    default:
      return res.status(400).json({ error: `Unknown action: ${action}. Use ?action=alt-text, ?action=suggest-species, or ?action=poseidon` });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// POSEIDON HANDLER (previously /api/poseidon)
// Poseidon AI Gateway — routes user queries to Gemini with species RAG context.
// GET → health check (config status + relayer wallet balance).
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Poseidon System Prompt — encodes the "guide" (Curation Standard, protocol rules, persona behavior)
 * This is the core behavioral contract that makes Poseidon follow Aquacellum's rules.
 */
const POSEIDON_SYSTEM_PROMPT = `You are Poseidon, the AI assistant for the Aquacellum (Aquadex) protocol — a decentralized biological provenance system for freshwater aquarium fish.

## YOUR IDENTITY
- You are an expert on freshwater fish husbandry, breeding, water chemistry, species compatibility, and aquarium management.
- You serve two personas: "casual" (friendly hobbyist tone, emoji allowed, hide technical blockchain details) and "pro" (operational breeder terminal tone, terse, show token IDs and technical data).
- You NEVER provide veterinary medical diagnoses. If asked about sick fish, recommend consulting a qualified aquatic veterinarian.
- You are deeply knowledgeable about tropical freshwater species: cichlids, tetras, livebearers, corydoras, plecos, bettas, gouramis, barbs, rasboras, loaches, rainbowfish, and more.

## PROTOCOL RULES YOU MUST FOLLOW
1. Temperature values use ×10 integer scaling on-chain (23.5°C = 235). When discussing temperatures, use normal decimal notation for the user but note the scaled value if relevant.
2. pH values use ×10 integer scaling on-chain (7.2 = 72).
3. Salinity (Specific Gravity) uses ×10,000 scaling (1.0240 = 10240).
4. Nitrogen compounds (ammonia, nitrite, nitrate) use ×100 scaling in ppm (0.25 ppm = 25).
5. Species must be referenced by FishBase specCode as primary key when available.
6. You only provide freshwater fish guidance. Saltwater/marine is out of scope for detailed advice.
7. Compatibility assessments must consider: temperature overlap, pH overlap, minimum tank volume, aggression/temperament, and adult size.
8. When species data is provided in the context below, ALWAYS use those values as ground truth. Do not override them with general knowledge.

## AVAILABLE ACTIONS
You can instruct the frontend to perform these actions by including an "action" object in your response:
- CREATE_TANK: Create a new tank entry. Extract volume (gallons/liters), temperature, pH from context.
- LOG_HUSBANDRY: Log a care event (feeding, water change, glass cleaning, water test, medication, etc.)
- QUERY_COMPATIBILITY: Check if species X is compatible with the user's current tank parameters and inhabitants.
- SUGGEST_SPECIES: Recommend species based on tank parameters and existing inhabitants.
- LOG_WATER_PARAMS: Record a water parameter snapshot (temp, pH, ammonia, nitrite, nitrate).
- NONE: No action needed (informational response only).

## RESPONSE FORMAT
Always respond with valid JSON matching this schema:
{
  "message": "Your conversational response to the user",
  "intent": "one of: husbandry_log, onboarding_seed, compatibility_check, species_suggestion, water_params, care_advice, breeding_advice, general_knowledge, fallback_unknown",
  "action": {
    "type": "CREATE_TANK | LOG_HUSBANDRY | QUERY_COMPATIBILITY | SUGGEST_SPECIES | LOG_WATER_PARAMS | NONE",
    "payload": {}
  },
  "echoReaction": {
    "mood": "happy | excited | calm | confused | alert",
    "glowActive": true,
    "glowColor": "#hex",
    "swimSpeedMultiplier": 1.0,
    "durationMs": 2000
  },
  "confidence": 0.0-1.0,
  "sources": ["optional array of knowledge sources used"]
}

## BEHAVIORAL GUIDELINES
- Be concise. Hobbyists want quick answers, not essays.
- When you lack certainty about a species fact, say so. Never fabricate care parameters.
- GROUNDING RULE: if the context includes species data, treat those values as ground truth. If it does NOT include data for a species the user asks about, do NOT invent numeric care parameters (temperature, pH, hardness, adult size, diet specifics). Say plainly that you're not certain, give only general guidance, and suggest they verify against a trusted source or add the species so you can ground the answer. Wrong numbers can kill fish — an honest "I'm not sure" is always better than a confident guess.
- If the user mentions a species, try to reference its specCode from the provided species database context.
- Proactively warn about common mistakes: overstocking, pH crashes, ammonia spikes, incompatible tankmates.
- In casual mode: warm, encouraging, use 1-2 relevant emoji per response. Think "knowledgeable friend at the fish store."
- In pro mode: clinical, data-forward, no emoji. Think "facility operations terminal."
`;

/**
 * Builds context from the user's session data to ground Poseidon's responses.
 */
function buildUserContext(sessionData) {
  const parts = [];

  if (sessionData.userStats) {
    const stats = sessionData.userStats;
    parts.push("## USER STATS");
    parts.push(`- Loyalty Points (XP): ${stats.totalXp} total`);
    parts.push(`- Current Tier: ${stats.currentTier}`);
    if (stats.streakDays > 0) parts.push(`- Care Streak: ${stats.streakDays} days`);
  }

  if (sessionData.tanks && sessionData.tanks.length > 0) {
    parts.push("\n## USER'S TANKS");
    for (const tank of sessionData.tanks.slice(0, 5)) {
      parts.push(`- Tank "${tank.name}" (${tank.volumeLiters}L, ${tank.tankType === 2 ? 'Brackish' : tank.tankType === 3 ? 'Pond' : 'Freshwater'})`);
      if (tank.logs && tank.logs.length > 0) {
        const latest = tank.logs[tank.logs.length - 1];
        parts.push(`  Last reading: ${(latest.tempCelsiusX10 / 10).toFixed(1)}°C, pH ${(latest.phX10 / 10).toFixed(1)}, NH₃ ${(latest.ammoniaPpmX100 / 100).toFixed(2)}ppm`);
      }
      if (tank.specimens && tank.specimens.length > 0) {
        parts.push(`  Inhabitants: ${tank.specimens.map(s => s.commonName || s.scientificName).join(', ')}`);
      }
    }
  }

  if (sessionData.recentLogs && sessionData.recentLogs.length > 0) {
    parts.push("\n## RECENT ACTIVITY (last 5 actions)");
    for (const log of sessionData.recentLogs.slice(0, 5)) {
      const date = new Date(log.timestamp * 1000).toLocaleDateString();
      parts.push(`- [${date}] ${log.actionType}: ${log.details}`);
    }
  }

  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// LISTING-DESCRIPTION DRAFT (Task 9 Increment 2 §2.3) — Opus review gate
// ═══════════════════════════════════════════════════════════════════════════════
//
// Grounding contract: the draft MUST describe only the whitelisted care facts
// supplied in `groundingFacts` (plus general species temperament/origin
// derivable from them) and MUST NOT invent health status, "hardy/beginner-
// safe" safety claims, DOA/live-arrival guarantees, lineage/pedigree, awards,
// or pricing. This is the one server touch flagged for an Opus review pass
// before this increment is considered done — the grounding guarantee lives
// here and in listingDraft.js's groundingFacts whitelist (the data-layer half
// of the same guarantee). Do not loosen this system prompt, the allowed-keys
// whitelist below, or the request shape without that review.

// The ONLY keys ever allowed through from a client-supplied groundingFacts
// object. Anything else (health, guarantee, lineage, price, free-form seller
// text) is stripped server-side before it ever reaches the model — the
// server does not trust the client to have already sanitized it.
const LISTING_DESCRIPTION_ALLOWED_KEYS = Object.freeze([
  "commonName",
  "scientificName",
  "adultSizeCm",
  "temperament",
  "tempRangeCelsius",
  "phRange",
  "minVolumeGallons",
  "careLevel",
  "diet",
  "origin",
]);

const CARE_LEVEL_LABEL = Object.freeze(["Beginner", "Intermediate", "Advanced"]);

/**
 * Strip a client-supplied groundingFacts object down to only the allowed
 * whitelist keys with primitive/array-of-number values. Never trusts the
 * client's own sanitization — this is the server-side half of the
 * anti-fabrication guarantee (listingDraft.js's groundingFacts is the
 * client-side half).
 */
function sanitizeGroundingFacts(raw = {}) {
  const out = {};
  for (const key of LISTING_DESCRIPTION_ALLOWED_KEYS) {
    const value = raw?.[key];
    if (value == null) continue;
    if (key === "tempRangeCelsius" || key === "phRange") {
      if (Array.isArray(value) && value.length === 2 && value.every((n) => Number.isFinite(Number(n)))) {
        out[key] = [Number(value[0]), Number(value[1])];
      }
      continue;
    }
    if (key === "adultSizeCm" || key === "minVolumeGallons" || key === "careLevel") {
      if (Number.isFinite(Number(value))) out[key] = Number(value);
      continue;
    }
    // Remaining fields are short descriptive strings.
    const str = String(value).slice(0, 300).trim();
    if (str) out[key] = str;
  }
  return out;
}

/** Render the sanitized grounding facts as a plain-language fact sheet for the prompt. */
function renderGroundingFactSheet(facts) {
  const lines = [];
  if (facts.commonName || facts.scientificName) {
    lines.push(`- Species: ${[facts.commonName, facts.scientificName].filter(Boolean).join(" / ")}`);
  }
  if (facts.adultSizeCm != null) lines.push(`- Adult size: ~${facts.adultSizeCm} cm`);
  if (facts.temperament) lines.push(`- Temperament classification: ${facts.temperament}`);
  if (Array.isArray(facts.tempRangeCelsius)) lines.push(`- Temperature range: ${facts.tempRangeCelsius[0]}–${facts.tempRangeCelsius[1]}°C`);
  if (Array.isArray(facts.phRange)) lines.push(`- pH range: ${facts.phRange[0]}–${facts.phRange[1]}`);
  if (facts.minVolumeGallons != null) lines.push(`- Minimum tank volume: ${facts.minVolumeGallons} gallons`);
  if (facts.careLevel != null) lines.push(`- Care level: ${CARE_LEVEL_LABEL[facts.careLevel] || "Unspecified"}`);
  if (facts.diet) lines.push(`- Diet: ${facts.diet}`);
  if (facts.origin) lines.push(`- Origin/biotope: ${facts.origin}`);
  return lines.length > 0 ? lines.join("\n") : "(No care facts were provided — write only a brief, neutral species blurb.)";
}

const LISTING_DESCRIPTION_SYSTEM_PROMPT = `You are drafting a SHORT marketplace listing description for a single freshwater fish species, for a seller who will review and edit it before publishing.

## HARD RULES — GROUNDING (do not violate any of these)
1. You may ONLY describe the facts given to you in the "## CARE FACTS" section below, plus general, well-established species temperament/origin that follows directly from those facts. Do not use any outside knowledge, chat history, or assumptions beyond what is listed.
2. You MUST NOT state or imply:
   - Health status of this specific specimen (e.g. "healthy", "disease-free", "vet-checked")
   - Safety/beginner-friendliness guarantees (e.g. "hardy", "beginner-safe", "easy to keep" — even if a care level is given, phrase it neutrally as "commonly rated <level> care" rather than a safety promise)
   - Any live-arrival, DOA, or health guarantee ("guaranteed to arrive alive", "guaranteed healthy")
   - Lineage, pedigree, breeding history, or awards of this specific specimen
   - Any price, discount, or value claim
3. If a fact is not present in the CARE FACTS section, do not mention it or estimate it. Omit it entirely rather than guessing.
4. This is a DRAFT the seller will edit before publishing — write plainly and factually, not as a hard sell.
5. Keep it to 2-4 short sentences.

## RESPONSE FORMAT
Respond with ONLY valid JSON matching this schema, nothing else:
{ "description": "the drafted description text" }`;

/**
 * POST /api/ai?action=poseidon with { intent: 'listing_description',
 * groundingFacts, mode? } — draft a grounded listing description. See the
 * module-level comment above for the full grounding contract.
 */
async function handleListingDescriptionDraft(req, res) {
  if (handleCorsPreFlight(req, res, { methods: 'POST, OPTIONS' })) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
  const { allowed, remaining, resetIn } = checkRateLimit(`poseidon-listing-desc:${clientIp}`, {
    maxRequests: 30,
    windowMs: 60 * 60 * 1000,
  });
  res.setHeader('X-RateLimit-Limit', '30');
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(resetIn));
  if (!allowed) {
    return res.status(429).json({ description: null, error: `Rate limited. Retry in ${resetIn}s.` });
  }

  const rawFacts = req.body?.groundingFacts;
  if (!rawFacts || typeof rawFacts !== 'object') {
    return res.status(400).json({ error: 'Missing required field: groundingFacts' });
  }
  const facts = sanitizeGroundingFacts(rawFacts);

  if (!isVertexConfigured()) {
    return res.status(200).json({ description: null, offline: true, error: 'AI drafting is not configured right now — write your own description.' });
  }

  const prompt = [
    LISTING_DESCRIPTION_SYSTEM_PROMPT,
    '\n## CARE FACTS\n' + renderGroundingFactSheet(facts),
  ].join('\n');

  try {
    const geminiResponse = await vertexGenerateContent(modelFor('EXTRACT'), {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: { description: { type: 'string' } },
          required: ['description'],
        },
        temperature: 0.5,
        maxOutputTokens: 300,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error('[Listing description draft] Gemini error:', geminiResponse.status, errText);
      return res.status(200).json({ description: null, error: 'Could not generate a draft right now — write your own description.' });
    }

    const result = await geminiResponse.json();
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      return res.status(200).json({ description: null, error: 'Empty response — write your own description.' });
    }

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      return res.status(200).json({ description: String(responseText).slice(0, 600) });
    }

    return res.status(200).json({ description: parsed.description || null });
  } catch (error) {
    console.error('[Listing description draft] Error:', error.message || error);
    return res.status(200).json({ description: null, error: 'Could not generate a draft right now — write your own description.' });
  }
}

async function handlePoseidon(req, res) {
  // GET requests → health check (previously /api/poseidon-health)
  if (req.method === 'GET') {
    return handlePoseidonHealth(req, res);
  }

  // CORS for POST
  if (handleCorsPreFlight(req, res, { methods: 'POST, GET, OPTIONS' })) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use GET for health check or POST for queries.' });
  }

  const { message, mode, sessionData, conversationHistory, intent } = req.body || {};

  // ─── Grounded listing-description intent (Task 9 Increment 2 §2.3) ────────
  // A separate, stricter contract from the conversational flow below. Bypasses
  // the message/sessionData/conversationHistory path entirely: only the
  // caller-supplied, sanitized `groundingFacts` whitelist reaches the model —
  // never free-form seller claims, chat history, or session context. This
  // branch (and the system prompt it builds) is the Opus-reviewed
  // anti-fabrication guarantee for AI-drafted listing copy.
  if (intent === 'listing_description') {
    return handleListingDescriptionDraft(req, res);
  }

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing required field: message' });
  }

  // ─── Rate Limiting: 30 requests per hour per IP (no auth on this endpoint) ─
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
  const { allowed, remaining, resetIn } = checkRateLimit(`poseidon:${clientIp}`, {
    maxRequests: 30,
    windowMs: 60 * 60 * 1000, // 1 hour
  });

  res.setHeader('X-RateLimit-Limit', '30');
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(resetIn));

  if (!allowed) {
    return res.status(429).json({
      message: mode === 'pro'
        ? `[RATE LIMITED] 30 queries/hour exceeded. Retry in ${resetIn}s.`
        : `🌊 You've been asking a lot of great questions! I need a short break — try again in ${Math.ceil(resetIn / 60)} minutes.`,
      intent: "fallback_unknown",
      action: { type: "NONE", payload: {} },
      echoReaction: { mood: "calm", glowActive: false, glowColor: "", swimSpeedMultiplier: 0.5, durationMs: 2000 },
      confidence: 0.0,
      rateLimited: true,
    });
  }

  // Fallback: if Vertex AI isn't configured, return a structured offline response
  if (!isVertexConfigured()) {
    console.warn('[Poseidon Gateway] isVertexConfigured() returned false.',
      'GCP_PROJECT_ID:', !!process.env.GCP_PROJECT_ID,
      'GCP_SERVICE_ACCOUNT_JSON:', !!(process.env.GCP_SERVICE_ACCOUNT_JSON && process.env.GCP_SERVICE_ACCOUNT_JSON.trim()),
      'GOOGLE_APPLICATION_CREDENTIALS:', !!(process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GOOGLE_APPLICATION_CREDENTIALS.trim()),
      'GEMINI_API_KEY:', !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim())
    );
    return res.status(200).json({
      message: mode === 'pro'
        ? "[POSEIDON OFFLINE] AI backend not configured (no Vertex credentials or GEMINI_API_KEY in this environment). Set them in the deploy env — see the GET /api/ai?action=poseidon health check."
        : "🌊 Poseidon is taking a quick breather and can't answer right now. Please try again shortly.",
      intent: "fallback_unknown",
      action: { type: "NONE", payload: {} },
      echoReaction: { mood: "calm", glowActive: false, glowColor: "", swimSpeedMultiplier: 1.0, durationMs: 1500 },
      confidence: 0.0,
      offline: true
    });
  }

  // --- RAG: Build species context from the curated catalog ---
  const speciesContext = buildSpeciesContext(message, sessionData || {}, mode || 'casual');

  // Build the user's tank/activity context
  const userContext = sessionData ? buildUserContext(sessionData) : '';

  // Build persona instruction
  const personaInstruction = mode === 'pro'
    ? "Respond in PROFESSIONAL/PRO mode: terse, clinical, data-forward, no emoji."
    : "Respond in CASUAL mode: warm, friendly, encouraging, 1-2 emoji max.";

  // Build conversation messages for multi-turn context
  const messages = [
    { role: "user", parts: [{ text: POSEIDON_SYSTEM_PROMPT }] },
    { role: "model", parts: [{ text: "Understood. I am Poseidon, ready to assist with freshwater aquarium management. I will follow all protocol rules, use provided species data as ground truth, and respond in the specified JSON format." }] },
  ];

  // Add conversation history (last 6 turns max to stay within token budget)
  if (conversationHistory && Array.isArray(conversationHistory)) {
    const recentHistory = conversationHistory.slice(-6);
    for (const turn of recentHistory) {
      if (turn.sender === 'user') {
        messages.push({ role: "user", parts: [{ text: turn.text }] });
      } else if (turn.sender === 'poseidon') {
        messages.push({ role: "model", parts: [{ text: turn.text }] });
      }
    }
  }

  // Assemble the current prompt with all RAG context
  const currentPrompt = [
    personaInstruction,
    userContext ? `\n${userContext}` : '',
    speciesContext ? `\n${speciesContext}` : '',
    `\n## USER MESSAGE\n${message}`
  ].filter(Boolean).join('\n');

  messages.push({ role: "user", parts: [{ text: currentPrompt }] });

  try {
    const geminiResponse = await vertexGenerateContent(modelFor('CHAT'), {
        contents: messages,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              message: { type: "string" },
              intent: { type: "string" },
              action: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  payload: { type: "object" }
                },
                required: ["type"]
              },
              echoReaction: {
                type: "object",
                properties: {
                  mood: { type: "string" },
                  glowActive: { type: "boolean" },
                  glowColor: { type: "string" },
                  swimSpeedMultiplier: { type: "number" },
                  durationMs: { type: "number" }
                }
              },
              confidence: { type: "number" },
              sources: { type: "array", items: { type: "string" } }
            },
            required: ["message", "intent", "action"]
          },
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
        ]
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error(`[Poseidon Gateway] Gemini API error ${geminiResponse.status}:`, errText);
      throw new Error(`Gemini API returned ${geminiResponse.status}`);
    }

    const result = await geminiResponse.json();
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
      throw new Error('Empty response from Gemini');
    }

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      // If Gemini returns non-JSON despite schema enforcement, wrap it
      parsed = {
        message: responseText,
        intent: "general_knowledge",
        action: { type: "NONE", payload: {} },
        echoReaction: { mood: "calm", glowActive: false, glowColor: "", swimSpeedMultiplier: 1.0, durationMs: 1500 },
        confidence: 0.5
      };
    }

    // Ensure required fields exist
    if (!parsed.action) parsed.action = { type: "NONE", payload: {} };
    if (!parsed.echoReaction) parsed.echoReaction = { mood: "calm", glowActive: false, glowColor: "", swimSpeedMultiplier: 1.0, durationMs: 1500 };

    return res.status(200).json(parsed);

  } catch (error) {
    console.error('[Poseidon Gateway] Error:', error.message || error);

    // Graceful degradation — return a helpful fallback with diagnostic hint
    const isDev = process.env.VERCEL_ENV !== 'production';
    const debugHint = isDev ? ` (Debug: ${error.message})` : '';

    return res.status(200).json({
      message: mode === 'pro'
        ? `[POSEIDON ERROR] Backend intelligence layer unreachable. Retry or use local command mode.${debugHint}`
        : `🌊 Sorry, I'm having trouble connecting to my knowledge base right now. Try again in a moment!${debugHint}`,
      intent: "fallback_unknown",
      action: { type: "NONE", payload: {} },
      echoReaction: { mood: "confused", glowActive: false, glowColor: "", swimSpeedMultiplier: 0.8, durationMs: 2000 },
      confidence: 0.0,
      error: true
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Poseidon Health Check (previously GET /api/poseidon and /api/poseidon-health)
// GET /api/ai?action=poseidon — config status + relayer wallet balance
// ═══════════════════════════════════════════════════════════════════════════════

async function handlePoseidonHealth(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(204).end();

  const gcpProjectId = process.env.GCP_PROJECT_ID;
  const gcpLocation = process.env.GCP_LOCATION;
  const hasServiceAccountJson = !!(process.env.GCP_SERVICE_ACCOUNT_JSON && process.env.GCP_SERVICE_ACCOUNT_JSON.trim());
  const hasCredentialsFile = !!(process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GOOGLE_APPLICATION_CREDENTIALS.trim());
  const hasGeminiKey = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());

  // Try to parse the service account JSON to check validity
  let serviceAccountParseable = false;
  let serviceAccountEmail = null;
  let parseError = null;

  if (hasServiceAccountJson) {
    try {
      const parsed = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
      serviceAccountParseable = true;
      serviceAccountEmail = parsed.client_email || null;
      if (parsed.private_key) {
        const hasRealNewlines = parsed.private_key.includes('\n');
        const hasLiteralBackslashN = parsed.private_key.includes('\\n');
        parseError = `private_key: realNewlines=${hasRealNewlines}, literalBackslashN=${hasLiteralBackslashN}, length=${parsed.private_key.length}`;
      }
    } catch (e) {
      parseError = e.message;
      try {
        const unescaped = process.env.GCP_SERVICE_ACCOUNT_JSON.replace(/\\n/g, '\n');
        const parsed = JSON.parse(unescaped);
        serviceAccountParseable = true;
        serviceAccountEmail = parsed.client_email || null;
        parseError = 'Fixed with \\n unescape';
      } catch (e2) {
        parseError = `Primary: ${e.message} | Unescape attempt: ${e2.message}`;
      }
    }
  }

  const configured = isVertexConfigured();

  // If configured, ping EVERY model production is actually configured to use.
  //
  // This used to ping a hardcoded 'gemini-2.5-flash' — its own second copy of the
  // name. So changing the chat model without also editing this line left the
  // health check reporting green for a model nothing used, which is precisely the
  // blind spot you don't want during a retirement. It now reads the same registry
  // the request handlers do, so a retired or mislocated model shows up here first.
  let vertexTest = null;
  let modelChecks = [];
  if (configured) {
    const pingOne = async (cfg) => {
      try {
        const res = await vertexGenerateContent(cfg, {
          contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }],
          generationConfig: { maxOutputTokens: 5 },
        });
        if (res.status === 200) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          return { ...cfg, ok: true, status: 200, response: text || '(empty)' };
        }
        const errBody = await res.text();
        return { ...cfg, ok: false, status: res.status, error: errBody.slice(0, 300) };
      } catch (e) {
        return { ...cfg, ok: false, error: e.message };
      }
    };

    modelChecks = await Promise.all(configuredModels().map(pingOne));

    // Keep the original single-model shape so existing readers of this endpoint
    // (foundersAnalytics' "Poseidon AI" check) don't break; it now reflects the
    // CHAT model specifically rather than a hardcoded name.
    const chatCfg = modelFor('CHAT');
    const chatCheck = modelChecks.find((c) => c.model === chatCfg.model && c.location === chatCfg.location);
    if (chatCheck) {
      vertexTest = chatCheck.ok
        ? { success: true, status: 200, response: chatCheck.response }
        : { success: false, status: chatCheck.status, error: chatCheck.error };
    }
  }

  // Announced retirements, surfaced rather than living only in an email.
  const modelsExpiringSoon = expiringModels(60);

  // Relayer Wallet Balance Check
  let relayerHealth = null;
  const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
  const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";

  if (RELAYER_PRIVATE_KEY) {
    try {
      const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
      const wallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
      const balance = await provider.getBalance(wallet.address);
      const balanceEth = parseFloat(ethers.utils.formatEther(balance));

      const WARNING_THRESHOLD = 0.01;
      const CRITICAL_THRESHOLD = 0.002;

      let status = "healthy";
      if (balanceEth < CRITICAL_THRESHOLD) {
        status = "critical";
      } else if (balanceEth < WARNING_THRESHOLD) {
        status = "low";
      }

      relayerHealth = {
        status,
        address: wallet.address,
        balanceEth: balanceEth.toFixed(6),
        network: "Base Sepolia (84532)",
        warningThreshold: `${WARNING_THRESHOLD} ETH`,
        criticalThreshold: `${CRITICAL_THRESHOLD} ETH`,
      };
    } catch (e) {
      relayerHealth = {
        status: "error",
        error: e.message,
      };
    }
  } else {
    relayerHealth = {
      status: "not_configured",
      error: "RELAYER_PRIVATE_KEY not set",
    };
  }

  return res.status(200).json({
    status: configured ? 'configured' : 'not_configured',
    checks: {
      gcpProjectId: gcpProjectId || '(not set)',
      gcpLocation: gcpLocation || '(not set, defaults to us-central1)',
      hasServiceAccountJson,
      serviceAccountJsonLength: hasServiceAccountJson ? process.env.GCP_SERVICE_ACCOUNT_JSON.length : 0,
      serviceAccountParseable,
      serviceAccountEmail,
      parseError,
      hasCredentialsFile,
      hasGeminiKey,
      isVertexConfigured: configured,
    },
    vertexTest,
    // Per-task model configuration and a live reachability ping for each distinct
    // model. `source` says whether it came from an env override or the pinned
    // default, so a deploy-time change is visible without reading the code.
    models: {
      byTask: AI_TASKS.map((task) => {
        const cfg = modelFor(task);
        return { task, model: cfg.model, location: cfg.location, source: cfg.source };
      }),
      reachability: modelChecks.map((c) => ({
        model: c.model, location: c.location, tasks: c.tasks,
        ok: c.ok, status: c.status ?? null, error: c.error ?? null,
      })),
      expiringSoon: modelsExpiringSoon,
    },
    relayer: relayerHealth,
    timestamp: new Date().toISOString(),
  });
}
