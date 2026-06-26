// Vercel serverless function: frontend/api/poseidon.js
// Poseidon AI Gateway — Routes user queries to Gemini with species RAG context
// Also serves health check via GET method (consolidated from poseidon-health.js)
// Runtime: Node.js serverless (needs fs access for species catalog)

import { buildSpeciesContext } from './_lib/speciesIndex.js';
import { vertexGenerateContent, isVertexConfigured } from './_lib/vertexClient.js';
import { handleCorsPreFlight, setCorsHeaders } from './_lib/cors.js';
import { checkRateLimit } from './_lib/rateLimiter.js';
import { ethers } from "ethers";

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

  // User's loyalty/XP stats
  if (sessionData.userStats) {
    const stats = sessionData.userStats;
    parts.push("## USER STATS");
    parts.push(`- Loyalty Points (XP): ${stats.totalXp} total`);
    parts.push(`- Current Tier: ${stats.currentTier}`);
    if (stats.streakDays > 0) parts.push(`- Care Streak: ${stats.streakDays} days`);
    if (stats.monthlyXp > 0) parts.push(`- This Month: ${stats.monthlyXp} pts earned`);
  }

  if (sessionData.tanks && sessionData.tanks.length > 0) {
    parts.push("\n## USER'S TANKS");
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
  // GET requests → health check (previously /api/poseidon-health)
  if (req.method === 'GET') {
    return handleHealth(req, res);
  }

  // CORS for POST
  if (handleCorsPreFlight(req, res, { methods: 'POST, GET, OPTIONS' })) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use GET for health check or POST for queries.' });
  }

  const { message, mode, sessionData, conversationHistory } = req.body || {};

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
    const geminiResponse = await vertexGenerateContent('gemini-2.5-flash', {
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
// Health Check Handler (previously /api/poseidon-health)
// GET /api/poseidon — returns configuration status + relayer wallet balance
// ═══════════════════════════════════════════════════════════════════════════════

async function handleHealth(req, res) {
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

  // If configured, attempt a real Vertex AI ping
  let vertexTest = null;
  if (configured) {
    try {
      const testRes = await vertexGenerateContent('gemini-2.5-flash', {
        contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }],
        generationConfig: { maxOutputTokens: 5 },
      });
      const testStatus = testRes.status;
      if (testStatus === 200) {
        const testData = await testRes.json();
        const text = testData.candidates?.[0]?.content?.parts?.[0]?.text;
        vertexTest = { success: true, status: testStatus, response: text || '(empty)' };
      } else {
        const errBody = await testRes.text();
        vertexTest = { success: false, status: testStatus, error: errBody.slice(0, 500) };
      }
    } catch (e) {
      vertexTest = { success: false, error: e.message, stack: e.stack?.split('\n').slice(0, 3).join(' | ') };
    }
  }

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
    relayer: relayerHealth,
    timestamp: new Date().toISOString(),
  });
}
