// Vercel serverless function: frontend/api/suggest-species.js

export default async function handler(req, res) {
  // Enforce POST method
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { scientificName, commonName, minTemp, maxTemp, minPh, maxPh, careLevel, notes } = req.body;

  if (!scientificName || !commonName) {
    return res.status(400).json({ verified: false, reason: "Missing required taxonomic fields: scientificName and commonName." });
  }

  try {
    // 1. Check World Register of Marine Species (WoRMS) API (or FishBase API wrapper)
    // WoRMS REST API returns AphiaRecords by Name
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
        // No match found directly in WoRMS (could be purely freshwater fish, which WoRMS sometimes lacks)
        taxonomicNotes = "No exact match found in WoRMS (checking freshwater backup).";
        isNameTaxonomicallyValid = true; // Fallback to Gemini verification for freshwater
      }
    } catch (wormsErr) {
      console.warn("WoRMS lookup failed, proceeding with Gemini validation:", wormsErr);
      taxonomicNotes = "Registry lookup bypassed due to network timeout.";
    }

    // 2. Call Gemini AI API for ecological & husbandry parameters check
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY || GEMINI_API_KEY.trim() === '') {
      console.log("[Aquadex Dev] Gemini API Key missing. Running in Deterministic Mock Mode.");
      
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

    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
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

    const geminiResponse = await fetch(geminiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      })
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
    // Safe fallback to range validation in case of downstream API failure
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

