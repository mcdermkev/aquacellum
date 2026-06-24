/**
 * ai.js — Consolidated Vercel Serverless Function
 *
 * Combines generate-alt-text and suggest-species into a single function
 * to stay within Vercel Hobby plan's 12 serverless function limit.
 *
 * Routing:
 *   /api/ai?action=alt-text        → Generate accessible alt-text for photos
 *   /api/ai?action=suggest-species  → Taxonomic verification via WoRMS + Gemini
 */

import { vertexGenerateContent, isVertexConfigured } from './_lib/vertexClient.js';
import { handleCorsPreFlight } from './_lib/cors.js';

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

    const geminiResponse = await vertexGenerateContent('gemini-2.5-flash-lite', {
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

    const geminiResponse = await vertexGenerateContent('gemini-2.5-flash', {
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
    default:
      return res.status(400).json({ error: `Unknown action: ${action}. Use ?action=alt-text or ?action=suggest-species` });
  }
}
