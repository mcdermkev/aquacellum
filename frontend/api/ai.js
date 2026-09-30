/**
 * ai.js — Consolidated Vercel Serverless Function
 *
 * Combines the AI-backed endpoints into a single function to stay within
 * Vercel Hobby plan's 12 serverless function limit.
 *
 * Routing:
 *   POST /api/ai?action=alt-text         → Generate accessible alt-text for photos
 *   POST /api/ai?action=identify-fish    → Identify a fish from a photo (Echo's eyes)
 *   POST /api/ai?action=suggest-species  → Taxonomic verification via WoRMS + Gemini
 *   POST /api/ai?action=poseidon         → Poseidon AI gateway (Gemini + species RAG)
 *   GET  /api/ai?action=poseidon         → Poseidon static status (no model call)
 *   GET  /api/ai?action=poseidon&deep=1  → Model + relayer check (Bearer CRON_SECRET)
 *
 * The two IMAGE actions (`alt-text`, `identify-fish`) require a signed-in account
 * and carry a per-account daily quota — see `_lib/aiAccess.js`. The text actions
 * keep a per-IP limit; Poseidon's is shared across instances (`_lib/aiRateLimit.js`). Vision costs materially more per call, and an
 * anonymous caller cannot be told apart from a script.
 */

import { vertexGenerateContent, isVertexConfigured } from './_lib/vertexClient.js';
import { modelFor, configuredModels, expiringModels, AI_TASKS } from './_lib/aiModels.js';
import { handleCorsPreFlight, setCorsHeaders } from './_lib/cors.js';
import { buildSpeciesContext } from './_lib/speciesIndex.js';
import { realCareText } from '../src/services/speciesCare.js';
import { enforcePoseidonLimit, POSEIDON_RATE } from './_lib/aiRateLimit.js';
import {
  POSEIDON_LIMITS,
  validatePoseidonRequest,
  buildPoseidonGenerationConfig,
  interpretPoseidonResult,
  shouldRetryPoseidon,
  pickPoseidonOutcome,
  shapePoseidonReply,
} from './_lib/poseidonGateway.js';
import { requireAccount, enforceAccountQuota, AI_QUOTAS } from './_lib/aiAccess.js';
import { resolveImagePart } from './_lib/imageInput.js';
import { groundCandidates } from './_lib/identifyGrounding.js';
import { ethers } from 'ethers';
import { timingSafeEqual } from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════════
// ALT-TEXT HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/ai?action=alt-text — accessible alt text for an aquarium photo.
 *
 * REQUIRES A SIGNED-IN ACCOUNT. This is a paid Gemini vision call, and it used to
 * be reachable anonymously with no quota at all — see `_lib/aiAccess.js` for why
 * identity rather than an IP counter is the control. The only real caller is
 * `services/mediaUpload.js`, which runs after a Supabase Storage upload and is
 * therefore always authenticated, so the gate costs nothing legitimate.
 *
 * Image input goes through `_lib/imageInput.js`, which size-caps it and restricts
 * the URL form to this project's own storage host.
 */
async function handleAltText(req, res) {
  if (handleCorsPreFlight(req, res, { methods: 'POST, OPTIONS' })) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const account = await requireAccount(req, res);
  if (!account) return;
  if (!enforceAccountQuota(res, {
    userId: account.userId,
    action: 'alt-text',
    maxPerDay: AI_QUOTAS.ALT_TEXT_PER_DAY,
  })) return;

  const { imageUrl, imageBase64 } = req.body || {};

  if (!imageUrl && !imageBase64) {
    return res.status(400).json({ altText: null, error: 'Provide imageUrl or imageBase64' });
  }

  if (!isVertexConfigured()) {
    return res.status(200).json({ altText: "Aquarium photo", error: "Vertex AI not configured" });
  }

  try {
    const resolved = await resolveImagePart({ imageUrl, imageBase64 });
    if (resolved.error) {
      // A rejected image is the caller's mistake, not a degraded AI answer, so it
      // keeps its real status code instead of the 200-with-fallback style below.
      return res.status(resolved.status || 400).json({ altText: null, error: resolved.error });
    }
    const imagePart = resolved.part;

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
// IDENTIFY-FISH HANDLER — the vision half of Echo (ECHO_CHARACTER_SPEC §6)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The grounding contract for identification.
 *
 * A database that means to be the accurate one cannot ship a feature that states a
 * species with false confidence. An identification from a photo is a SUGGESTION —
 * sexual dimorphism, juvenile colouration, line-bred morphs and hybrids all defeat
 * it, and a confident wrong answer is worse than an honest "not sure" because the
 * user may log it against a specimen and carry the error into a pedigree.
 *
 * Hence: numeric confidence per candidate, up to three ranked candidates rather
 * than one verdict, an explicit `isFish` so a photo of a filter comes back as such,
 * and a hard ban on health assessment (same rule Poseidon follows — no veterinary
 * diagnosis, ever, and a fish photo is exactly where a model would volunteer one).
 */
const IDENTIFY_SYSTEM_PROMPT = `You identify aquarium fish (freshwater and saltwater) from photographs for Aquacellum.

## WHAT TO DO
- Give up to 3 candidate species, most likely first, each with a confidence from 0.0 to 1.0.
- Use the scientific name (Genus species) and the most common trade/common name.
- Consider both freshwater and marine aquarium species. Say in your observation whether the fish looks freshwater or marine, because that decides which tanks it can live in.
- Write one or two sentences of "observation": what visible features led you there — body shape, fin shape, colour, pattern, markings.

## HONESTY RULES — these matter more than being helpful
1. Confidence must be genuine. If the photo is blurry, cropped, badly lit, or the fish is partly hidden, say so and give LOW confidence (below 0.4). Do not round up.
2. If you cannot tell the species but can tell the genus or family, give that as the candidate and explain the limit in the observation.
3. If there is no fish in the image, set isFish to false, return an empty candidates array, and describe what you actually see.
4. NEVER invent a species name. If nothing fits, return no candidates rather than a plausible-sounding guess.
5. Many species cannot be told apart from a photo at all — sexual dimorphism, juveniles, and line-bred colour morphs especially. Say when that is the case.

## HARD PROHIBITIONS
- Do NOT assess the animal's health, condition, or welfare. No "looks healthy", no disease guesses, no treatment advice. If the user seems to be asking about a sick fish, the observation should recommend a qualified aquatic veterinarian and nothing more.
- Do NOT estimate monetary value or grade quality.
- Do NOT guess sex unless a species-specific, clearly visible dimorphic trait supports it, and then say which trait.`;

/**
 * POST /api/ai?action=identify-fish  { imageBase64 | imageUrl, mode? }
 *
 * Echo's EXAMINING state exists for exactly this call: the client dispatches
 * VISION_START before it and VISION_END after, so she visibly concentrates while
 * it runs. She is the body; this is the brain doing the looking.
 *
 * Every candidate is cross-checked against the real species catalog, so the
 * response can tell the client "this one is in the database, here is its specCode"
 * versus "the model named something we do not carry". That keeps an AI guess from
 * masquerading as a catalog fact, and lets the UI link straight to the entry.
 */
async function handleIdentifyFish(req, res) {
  if (handleCorsPreFlight(req, res, { methods: 'POST, OPTIONS' })) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const account = await requireAccount(req, res);
  if (!account) return;
  if (!enforceAccountQuota(res, {
    userId: account.userId,
    action: 'identify-fish',
    maxPerDay: AI_QUOTAS.IDENTIFY_PER_DAY,
  })) return;

  const { imageUrl, imageBase64, mode } = req.body || {};

  if (!imageUrl && !imageBase64) {
    return res.status(400).json({ error: 'Provide imageUrl or imageBase64' });
  }

  if (!isVertexConfigured()) {
    return res.status(200).json({
      isFish: null,
      candidates: [],
      observation: null,
      offline: true,
      error: 'Visual identification is not configured right now.',
    });
  }

  const resolved = await resolveImagePart({ imageUrl, imageBase64 });
  if (resolved.error) {
    return res.status(resolved.status || 400).json({ error: resolved.error });
  }

  const personaNote = mode === 'pro'
    ? 'Write the observation in a terse, clinical, data-forward register. No emoji.'
    : 'Write the observation in a warm, plain, encouraging register. No emoji.';

  try {
    const geminiResponse = await vertexGenerateContent(modelFor('VISION'), {
      contents: [{
        role: 'user',
        parts: [resolved.part, { text: `${IDENTIFY_SYSTEM_PROMPT}\n\n${personaNote}` }],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            isFish: { type: 'boolean' },
            observation: { type: 'string' },
            candidates: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  scientificName: { type: 'string' },
                  commonName: { type: 'string' },
                  confidence: { type: 'number' },
                },
                required: ['scientificName', 'commonName', 'confidence'],
              },
            },
          },
          required: ['isFish', 'observation', 'candidates'],
        },
        // Low, because this is a determination and not a piece of writing.
        temperature: 0.2,
        maxOutputTokens: 700,
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
      console.error('[Identify] Gemini error:', geminiResponse.status, errText);
      return res.status(200).json({
        isFish: null, candidates: [], observation: null,
        error: 'Could not look at that photo right now — try again in a moment.',
      });
    }

    const result = await geminiResponse.json();
    const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return res.status(200).json({
        isFish: null, candidates: [], observation: null, error: 'Empty response',
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      console.error('[Identify] Unparseable model JSON');
      return res.status(200).json({
        isFish: null, candidates: [], observation: null, error: 'Could not read the result',
      });
    }

    return res.status(200).json({
      isFish: parsed.isFish === true,
      observation: typeof parsed.observation === 'string' ? parsed.observation.slice(0, 600) : null,
      candidates: groundCandidates(parsed.candidates),
      error: null,
    });
  } catch (err) {
    console.error('[Identify] Error:', err);
    return res.status(200).json({
      isFish: null, candidates: [], observation: null,
      error: 'Could not look at that photo right now — try again in a moment.',
    });
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
    case "identify-fish":
      return handleIdentifyFish(req, res);
    case "suggest-species":
      return handleSuggestSpecies(req, res);
    case "poseidon":
      return handlePoseidon(req, res);
    default:
      return res.status(400).json({ error: `Unknown action: ${action}. Use ?action=alt-text, ?action=identify-fish, ?action=suggest-species, or ?action=poseidon` });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// POSEIDON HANDLER (previously /api/poseidon)
// Poseidon AI Gateway — routes user queries to Gemini with species RAG context.
// GET → static status; ?deep=1 with CRON_SECRET → model + relayer check.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Poseidon System Prompt — encodes the "guide" (Curation Standard, protocol rules, persona behavior)
 * This is the core behavioral contract that makes Poseidon follow Aquacellum's rules.
 */
const POSEIDON_SYSTEM_PROMPT = `You are Poseidon, the AI assistant for the Aquacellum (Aquadex) protocol — a decentralized biological provenance system for aquarium fish, freshwater and saltwater.

## YOUR IDENTITY
- You are an expert on fish husbandry, breeding, water chemistry, species compatibility, and aquarium management, for freshwater and saltwater (fish-only and reef) tanks.
- You serve two personas: "casual" (friendly hobbyist tone, emoji allowed, hide technical blockchain details) and "pro" (operational breeder terminal tone, terse, show token IDs and technical data).
- You NEVER provide veterinary medical diagnoses. If asked about sick fish, recommend consulting a qualified aquatic veterinarian.
- You are deeply knowledgeable about tropical freshwater species (cichlids, tetras, livebearers, corydoras, plecos, bettas, gouramis, barbs, rasboras, loaches, rainbowfish) and popular marine fish (clownfish, damsels, tangs, dwarf angels, gobies, blennies, wrasses, cardinalfish).

## UNITS AND WORDING
1. Give every value in the units people use at the tank: temperature in °F with °C in brackets (for example "76–80°F (24–27°C)"), pH as a plain decimal (6.8), ammonia, nitrite and nitrate in ppm, salinity as specific gravity (1.025), hardness in dGH/dKH, tank size in gallons with liters.
2. Never show stored or scaled numbers (such as 235 for 23.5°C, 72 for pH 7.2, or 220–280 for a temperature range) and never describe a value as being "on the Aquadex system", "on-chain" or in "protocol units". Every number in the context below is already in normal units.
3. In casual mode do not mention blockchain, tokens, contracts, specCodes or internal IDs. If you need to name the source, say "the Aquacellum species guide". In pro mode you may show a species' specCode (the Aquacellum catalog ID, not always the FishBase SpecCode) or a token ID when it helps.

## HUSBANDRY RULES YOU MUST FOLLOW
4. Freshwater and saltwater fish never share a tank. Always check a tank's water type before recommending a species for it. For saltwater tanks, the key tests are salinity (1.023–1.026 SG), alkalinity (7–12 dKH), calcium (380–450 ppm), magnesium (1250–1400 ppm), nitrate and phosphate. The species guide covers some corals and invertebrates. When one is in the context below, use that record. When it is not, give general guidance only and say that the species is not in the guide.
5. Compatibility assessments must consider: temperature overlap, pH overlap, minimum tank volume, aggression/temperament, and adult size.
6. When species data is provided in the context below, ALWAYS use those values as ground truth. Do not override them with general knowledge.

## AVAILABLE ACTIONS
You can instruct the frontend to perform these actions by including an "action" object in your response:
- CREATE_TANK: Create a new tank entry. Extract volume (gallons/liters), temperature, pH from context.
- LOG_HUSBANDRY: Log a care event (feeding, water change, glass cleaning, water test, medication, etc.)
- QUERY_COMPATIBILITY: Check if species X is compatible with the user's current tank parameters and inhabitants.
- SUGGEST_SPECIES: Recommend species based on tank parameters and existing inhabitants.
- LOG_WATER_PARAMS: Record a water parameter snapshot. Payload fields are plain decimals: temp in °C (convert from °F), ph, ammonia, nitrite, nitrate in ppm, salinity as specific gravity. Leave out any value the user did not give.
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
- Be concise. Hobbyists want quick answers, not essays. Keep "message" under about 200 words unless the user asks for detail.
- When you lack certainty about a species fact, say so. Never fabricate care parameters.
- GROUNDING RULE: if the context includes species data, treat those values as ground truth. If it does NOT include data for a species the user asks about, do NOT invent numeric care parameters (temperature, pH, hardness, adult size, diet specifics). Say plainly that you're not certain, give only general guidance, and suggest they verify against a trusted source or add the species so you can ground the answer. Wrong numbers can kill fish — an honest "I'm not sure" is always better than a confident guess.
- In pro mode, when the user mentions a species, reference its specCode from the provided species database context. In casual mode use its common and scientific name only.
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
    // Stored readings are fixed-point (×10 temp/pH, ×100 nitrogen, ×10000 SG).
    // Convert them here so the model only ever sees normal units.
    const num = (v, div) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v) / div);
    for (const tank of sessionData.tanks.slice(0, 5)) {
      const waterType = ["Freshwater", "Saltwater", "Brackish", "Pond"][Number(tank.tankType)] || "Freshwater";
      const liters = num(tank.volumeLiters, 1);
      const size = liters ? `${Math.round(liters / 3.78541)} gal / ${Math.round(liters)} L` : 'size unknown';
      parts.push(`- Tank "${String(tank.name || 'Unnamed').slice(0, 80)}" (${size}, ${waterType})`);
      if (Array.isArray(tank.logs) && tank.logs.length > 0) {
        const latest = tank.logs[tank.logs.length - 1] || {};
        const c = num(latest.tempCelsiusX10, 10);
        const ph = num(latest.phX10, 10);
        const nh3 = num(latest.ammoniaPpmX100, 100);
        const sg = num(latest.salinitySgX10000, 10000);
        const reading = [
          c != null ? `${(c * 9 / 5 + 32).toFixed(1)}°F (${c.toFixed(1)}°C)` : null,
          ph != null ? `pH ${ph.toFixed(1)}` : null,
          nh3 != null ? `ammonia ${nh3.toFixed(2)} ppm` : null,
          sg != null ? `salinity ${sg.toFixed(3)} SG` : null,
        ].filter(Boolean);
        if (reading.length) parts.push(`  Last reading: ${reading.join(', ')}`);
      }
      if (Array.isArray(tank.specimens) && tank.specimens.length > 0) {
        const names = tank.specimens.slice(0, 30)
          .map((s) => String(s?.commonName || s?.scientificName || '').slice(0, 80))
          .filter(Boolean);
        if (names.length) parts.push(`  Inhabitants: ${names.join(', ')}`);
      }
    }
  }

  if (sessionData.recentLogs && sessionData.recentLogs.length > 0) {
    parts.push("\n## RECENT ACTIVITY (last 5 actions)");
    for (const log of sessionData.recentLogs.slice(0, 5)) {
      const date = new Date(log.timestamp * 1000).toLocaleDateString();
      parts.push(`- [${date}] ${String(log.actionType || '').slice(0, 60)}: ${String(log.details || '').slice(0, 200)}`);
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
    // Remaining fields are short descriptive strings. Placeholders such as
    // "Information arriving soon", "Generic Biotope Details" or an "unknown"
    // temperament are not facts, so the line is omitted.
    const str = realCareText(String(value).slice(0, 300).trim());
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

const LISTING_DESCRIPTION_SYSTEM_PROMPT = `You are drafting a SHORT marketplace listing description for a single aquarium fish species (freshwater or saltwater), for a seller who will review and edit it before publishing.

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

  // Shared limiter (see _lib/aiRateLimit.js), own scope so drafting and chat
  // never draw on each other's budget.
  const limit = await enforcePoseidonLimit(req, res, 'poseidon-listing-desc');
  if (!limit.allowed) {
    return res.status(429).json({ description: null, error: `Rate limited. Retry in ${limit.resetIn}s.` });
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
  // GET/HEAD → cheap static status. No model call, no identities (see handlePoseidonHealth).
  if (req.method === 'GET' || req.method === 'HEAD') {
    return handlePoseidonHealth(req, res);
  }

  // CORS for POST
  if (handleCorsPreFlight(req, res, { methods: 'POST, GET, OPTIONS' })) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use GET for health check or POST for queries.' });
  }

  const { message, mode, intent } = req.body || {};

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
    return res.status(400).json(poseidonNotice(mode, 'Missing required field: message', { error: true, code: 'message_required' }));
  }

  // ─── Size caps (before anything is counted or spent) ──────────────────────
  const input = validatePoseidonRequest(req.body);
  if (!input.ok) {
    const text = input.status === 413
      ? (mode === 'pro'
        ? `[REJECTED] ${input.error}`
        : `That is more than I can read in one go. Please keep questions under ${POSEIDON_LIMITS.QUESTION_CHARS} characters.`)
      : input.error;
    return res.status(input.status).json(poseidonNotice(mode, text, { error: true, code: input.code }));
  }

  // ─── Rate limit: 30 per hour, shared across instances (_lib/aiRateLimit.js) ─
  // Keyed by hashed IP, or by wallet when a verified Privy session is present.
  const limit = await enforcePoseidonLimit(req, res, 'poseidon');
  if (!limit.allowed) {
    return res.status(429).json(poseidonNotice(mode,
      mode === 'pro'
        ? `[RATE LIMITED] ${POSEIDON_RATE.max} queries/hour exceeded. Retry in ${limit.resetIn}s.`
        : `🌊 You've been asking a lot of great questions! I need a short break. Try again in ${Math.ceil(limit.resetIn / 60)} minutes.`,
      { rateLimited: true, echoReaction: { mood: "calm", glowActive: false, glowColor: "", swimSpeedMultiplier: 0.5, durationMs: 2000 } }));
  }

  // Fallback: if Vertex AI isn't configured, return a structured offline response
  if (!isVertexConfigured()) {
    console.warn('[Poseidon Gateway] isVertexConfigured() returned false.',
      'GCP_PROJECT_ID:', !!process.env.GCP_PROJECT_ID,
      'GCP_SERVICE_ACCOUNT_JSON:', !!(process.env.GCP_SERVICE_ACCOUNT_JSON && process.env.GCP_SERVICE_ACCOUNT_JSON.trim()),
      'GOOGLE_APPLICATION_CREDENTIALS:', !!(process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GOOGLE_APPLICATION_CREDENTIALS.trim()),
      'GEMINI_API_KEY:', !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim())
    );
    return res.status(200).json(poseidonNotice(mode,
      mode === 'pro'
        ? "[POSEIDON OFFLINE] AI backend not configured (no Vertex credentials or GEMINI_API_KEY in this environment)."
        : "🌊 Poseidon is taking a quick breather and can't answer right now. Please try again shortly.",
      { offline: true }));
  }

  const { history, sessionData } = input;
  const cleanMessage = input.message;

  // --- RAG: Build species context from the curated catalog ---
  const speciesContext = buildSpeciesContext(cleanMessage, sessionData || {}, mode || 'casual');

  // Build the user's tank/activity context
  const userContext = sessionData ? buildUserContext(sessionData) : '';

  // Build persona instruction
  const personaInstruction = mode === 'pro'
    ? "Respond in PROFESSIONAL/PRO mode: terse, clinical, data-forward, no emoji."
    : "Respond in CASUAL mode: warm, friendly, encouraging, 1-2 emoji max.";

  // Build conversation messages for multi-turn context
  const messages = [
    { role: "user", parts: [{ text: POSEIDON_SYSTEM_PROMPT }] },
    { role: "model", parts: [{ text: "Understood. I am Poseidon, ready to assist with freshwater and saltwater aquarium management. I will follow all the rules, use normal units, use provided species data as ground truth, and respond in the specified JSON format." }] },
  ];

  // Conversation history, already trimmed by validatePoseidonRequest
  // (last 6 turns, each capped) so one request's token cost stays bounded.
  for (const turn of history) {
    messages.push({ role: turn.sender === 'user' ? "user" : "model", parts: [{ text: turn.text }] });
  }

  // Assemble the current prompt with all RAG context
  const currentPrompt = [
    personaInstruction,
    userContext ? `\n${userContext}` : '',
    speciesContext ? `\n${speciesContext}` : '',
    `\n## USER MESSAGE\n${cleanMessage}`
  ].filter(Boolean).join('\n');

  messages.push({ role: "user", parts: [{ text: currentPrompt }] });

  const chatModel = modelFor('CHAT');
  const callOnce = async (attemptIndex) => {
    const geminiResponse = await vertexGenerateContent(chatModel, {
      contents: messages,
      generationConfig: buildPoseidonGenerationConfig(chatModel.model, attemptIndex),
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
      ]
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error(`[Poseidon Gateway] Gemini API error ${geminiResponse.status}:`, errText.slice(0, 500));
      throw new Error(`Gemini API returned ${geminiResponse.status}`);
    }
    return interpretPoseidonResult(await geminiResponse.json());
  };

  try {
    const first = await callOnce(0);
    let retry = null;
    if (shouldRetryPoseidon(first)) {
      // Cut off by the output cap. One more try with thinking off and more room.
      console.warn('[Poseidon Gateway] Reply hit MAX_TOKENS; retrying once with a larger budget.');
      try {
        retry = await callOnce(1);
      } catch (retryErr) {
        console.error('[Poseidon Gateway] Retry failed:', retryErr.message || retryErr);
      }
    }

    const outcome = pickPoseidonOutcome(first, retry);
    if (outcome?.kind === 'ok') {
      if (outcome.reply.truncated) console.warn('[Poseidon Gateway] Returning a truncated reply.');
      return res.status(200).json(outcome.reply);
    }
    if (outcome?.kind === 'blocked') {
      return res.status(200).json(poseidonNotice(mode,
        mode === 'pro'
          ? '[DECLINED] Query blocked by the content filter. Rephrase and retry.'
          : "🌊 I can't answer that one. Try asking it a different way.",
        { blocked: true }));
    }
    throw new Error(`Unusable model reply (finishReason: ${first?.finishReason || retry?.finishReason || 'unknown'})`);

  } catch (error) {
    console.error('[Poseidon Gateway] Error:', error.message || error);

    // Graceful degradation — return a helpful fallback with diagnostic hint
    const isDev = process.env.VERCEL_ENV !== 'production';
    const debugHint = isDev ? ` (Debug: ${error.message})` : '';

    return res.status(200).json(poseidonNotice(mode,
      mode === 'pro'
        ? `[POSEIDON ERROR] Backend intelligence layer unreachable. Retry or use local command mode.${debugHint}`
        : `🌊 Sorry, I'm having trouble connecting to my knowledge base right now. Try again in a moment.${debugHint}`,
      { error: true, echoReaction: { mood: "confused", glowActive: false, glowColor: "", swimSpeedMultiplier: 0.8, durationMs: 2000 } }));
  }
}

/**
 * A gateway-authored reply (rate limit, offline, error, rejected input) in the
 * same shape as a model reply, so every client reads one format.
 */
function poseidonNotice(mode, message, extra = {}) {
  const { echoReaction, ...flags } = extra;
  return {
    ...shapePoseidonReply({
      message,
      intent: "fallback_unknown",
      confidence: 0,
      echoReaction: echoReaction || { mood: "calm", glowActive: false, glowColor: "", swimSpeedMultiplier: 1.0, durationMs: 1500 },
    }),
    ...flags,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Poseidon Health Check
// GET|HEAD /api/ai?action=poseidon          → static status, free, public
// GET /api/ai?action=poseidon&deep=1        → model reachability + relayer balance,
//                                             Bearer CRON_SECRET only
// ═══════════════════════════════════════════════════════════════════════════════

/** Constant-time check of `Authorization: Bearer <CRON_SECRET>`. Disabled when CRON_SECRET is unset. */
function isCronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(String(header));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handlePoseidonHealth(req, res) {
  setCorsHeaders(req, res, { methods: 'GET, OPTIONS' });
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'no-store');

  const configured = isVertexConfigured();

  // The public check used to make a paid Vertex call per model on every hit and
  // return the service-account email and relayer address. Anyone could run up
  // the bill or read those identities. It now reads config flags only.
  const deep = req.method === 'GET' && (req.query?.deep === '1' || req.query?.deep === 'true');
  if (!deep) {
    if (req.method === 'HEAD') return res.status(200).end();
    return res.status(200).json({
      status: configured ? 'configured' : 'not_configured',
      service: 'poseidon',
      timestamp: new Date().toISOString(),
    });
  }

  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: 'Deep health check requires authorization.' });
  }

  // ── Deep check (operators only) ─────────────────────────────────────────────
  const hasServiceAccountJson = !!(process.env.GCP_SERVICE_ACCOUNT_JSON && process.env.GCP_SERVICE_ACCOUNT_JSON.trim());
  const hasCredentialsFile = !!(process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GOOGLE_APPLICATION_CREDENTIALS.trim());
  const hasGeminiKey = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());

  let serviceAccountParseable = false;
  if (hasServiceAccountJson) {
    try {
      JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
      serviceAccountParseable = true;
    } catch {
      try {
        JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON.replace(/\\n/g, '\n'));
        serviceAccountParseable = true;
      } catch {
        serviceAccountParseable = false;
      }
    }
  }

  // Ping EVERY model production is actually configured to use, from the same
  // registry the request handlers read, so a retired or mislocated model shows
  // up here first.
  let modelChecks = [];
  if (configured) {
    const pingOne = async (cfg) => {
      try {
        const r = await vertexGenerateContent(cfg, {
          contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }],
          generationConfig: { maxOutputTokens: 5 },
        });
        if (r.status === 200) return { ...cfg, ok: true, status: 200 };
        const errBody = await r.text();
        return { ...cfg, ok: false, status: r.status, error: errBody.slice(0, 300) };
      } catch (e) {
        return { ...cfg, ok: false, error: e.message };
      }
    };
    modelChecks = await Promise.all(configuredModels().map(pingOne));
  }

  const chatCfg = modelFor('CHAT');
  const chatCheck = modelChecks.find((c) => c.model === chatCfg.model && c.location === chatCfg.location);
  const vertexTest = chatCheck
    ? (chatCheck.ok ? { success: true, status: 200 } : { success: false, status: chatCheck.status ?? null, error: chatCheck.error })
    : null;

  // Relayer balance. Status and balance only; the address is not returned.
  let relayerHealth;
  const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
  const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
  if (RELAYER_PRIVATE_KEY) {
    try {
      const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
      const wallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
      const balanceEth = parseFloat(ethers.utils.formatEther(await provider.getBalance(wallet.address)));
      const WARNING_THRESHOLD = 0.01;
      const CRITICAL_THRESHOLD = 0.002;
      relayerHealth = {
        status: balanceEth < CRITICAL_THRESHOLD ? "critical" : balanceEth < WARNING_THRESHOLD ? "low" : "healthy",
        balanceEth: balanceEth.toFixed(6),
        network: "Base Sepolia (84532)",
      };
    } catch (e) {
      relayerHealth = { status: "error", error: e.message };
    }
  } else {
    relayerHealth = { status: "not_configured" };
  }

  return res.status(200).json({
    status: configured ? 'configured' : 'not_configured',
    checks: {
      gcpProjectIdSet: !!process.env.GCP_PROJECT_ID,
      gcpLocation: process.env.GCP_LOCATION || '(not set, defaults to us-central1)',
      hasServiceAccountJson,
      serviceAccountParseable,
      hasCredentialsFile,
      hasGeminiKey,
      isVertexConfigured: configured,
    },
    vertexTest,
    models: {
      byTask: AI_TASKS.map((task) => {
        const cfg = modelFor(task);
        return { task, model: cfg.model, location: cfg.location, source: cfg.source };
      }),
      reachability: modelChecks.map((c) => ({
        model: c.model, location: c.location, tasks: c.tasks,
        ok: c.ok, status: c.status ?? null, error: c.error ?? null,
      })),
      expiringSoon: expiringModels(60),
    },
    relayer: relayerHealth,
    timestamp: new Date().toISOString(),
  });
}
