// Vercel serverless function: frontend/api/poseidon.js
// Poseidon AI Gateway — Routes user queries to Gemini with species RAG context
// Runtime: Node.js serverless (needs fs access for species catalog)

import { buildSpeciesContext } from './_lib/speciesIndex.js';

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

  if (sessionData.tanks && sessionData.tanks.length > 0) {
    parts.push("## USER'S TANKS");
    for (const tank of sessionData.tanks.slice(0, 5)) {
      parts.push(`- Tank "${tank.name}" (${tank.volumeLiters}L, ${tank.tankType === 2 ? 'Saltwater' : 'Freshwater'})`);
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

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { message, mode, sessionData, conversationHistory } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing required field: message' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  // Fallback: if no API key, return a structured offline response
  if (!GEMINI_API_KEY || GEMINI_API_KEY.trim() === '') {
    return res.status(200).json({
      message: mode === 'pro'
        ? "[POSEIDON OFFLINE] Gemini API key not configured. Operating in local-only mode."
        : "🌊 I'm running in offline mode right now. My full intelligence layer isn't connected yet, but I can still help with basic tank tasks!",
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
    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

    const geminiResponse = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      }),
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
    console.error('[Poseidon Gateway] Error:', error);

    // Graceful degradation — return a helpful fallback
    return res.status(200).json({
      message: mode === 'pro'
        ? "[POSEIDON ERROR] Backend intelligence layer unreachable. Retry or use local command mode."
        : "🌊 Sorry, I'm having trouble connecting to my knowledge base right now. Try again in a moment!",
      intent: "fallback_unknown",
      action: { type: "NONE", payload: {} },
      echoReaction: { mood: "confused", glowActive: false, glowColor: "", swimSpeedMultiplier: 0.8, durationMs: 2000 },
      confidence: 0.0,
      error: true
    });
  }
}
