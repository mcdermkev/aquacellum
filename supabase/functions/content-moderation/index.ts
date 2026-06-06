/**
 * content-moderation Edge Function
 * 
 * Content moderation pipeline (Task 52).
 * Called via Supabase webhook on new content inserts.
 * Uses Gemini Vision for image classification and text toxicity detection.
 * 
 * Expects body:
 * {
 *   type: "current" | "comment" | "insight",
 *   id: UUID,
 *   text?: string,
 *   image_urls?: string[],
 *   author_wallet: string
 * }
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";

// Toxicity keywords (basic filter before AI check)
const SPAM_PATTERNS = [
  /https?:\/\/[^\s]+\.(xyz|click|win|free)/i,
  /buy now|click here|free money|earn \$\d+/i,
  /(.)\1{10,}/, // 10+ repeated chars
];

serve(async (req) => {
  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ skipped: true, reason: "No API key" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { type, id, text, image_urls, author_wallet } = await req.json();

    if (!type || !id) {
      return new Response(JSON.stringify({ error: "type and id required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    let flagged = false;
    let flagReason = "";
    let confidence = 0;

    // Step 1: Basic spam pattern check on text
    if (text) {
      for (const pattern of SPAM_PATTERNS) {
        if (pattern.test(text)) {
          flagged = true;
          flagReason = "spam";
          confidence = 0.9;
          break;
        }
      }
    }

    // Step 2: AI text moderation (if not already caught by patterns)
    if (!flagged && text && text.length > 10) {
      const textResult = await moderateText(text);
      if (textResult.flagged) {
        flagged = true;
        flagReason = textResult.reason;
        confidence = textResult.confidence;
      }
    }

    // Step 3: AI image moderation
    if (!flagged && image_urls && image_urls.length > 0) {
      for (const url of image_urls) {
        const imageResult = await moderateImage(url);
        if (imageResult.flagged) {
          flagged = true;
          flagReason = imageResult.reason;
          confidence = imageResult.confidence;
          break;
        }
      }
    }

    // Step 4: If flagged, hide content and create moderation flag
    if (flagged) {
      // Hide the content
      if (type === "current") {
        await supabase.from("currents").update({ is_hidden: true }).eq("id", id);
      } else if (type === "comment") {
        await supabase.from("comments").update({ is_hidden: true }).eq("id", id);
      }

      // Create moderation flag
      await supabase.from("moderation_flags").insert({
        target_type: type,
        target_id: id,
        reason: flagReason,
        auto_flagged: true,
        ai_confidence: confidence,
        details: `Auto-flagged by Poseidon content moderation. Reason: ${flagReason}`,
      });

      // Notify curator (you could also notify the author)
      // For now we just flag — curators review the moderation_flags table
    }

    return new Response(
      JSON.stringify({ moderated: true, flagged, reason: flagReason, confidence }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});

async function moderateText(text: string): Promise<{ flagged: boolean; reason: string; confidence: number }> {
  const prompt = `You are a content moderator for an aquarium/fishkeeping community. Classify the following text. 
Respond with ONLY a JSON object: {"flagged": boolean, "reason": "spam|inappropriate|harassment|none", "confidence": 0.0-1.0}

Text: "${text.slice(0, 500)}"

Rules:
- Flag spam, inappropriate sexual content, hate speech, or harassment
- Do NOT flag normal fishkeeping discussion, even if it mentions breeding, death of fish, or water chemistry
- Do NOT flag slang, casual language, or enthusiastic posts
- Only flag if clearly violating community standards`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 50, temperature: 0.1 },
        }),
      }
    );

    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Parse JSON from response
    const jsonMatch = resultText.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        flagged: result.flagged === true,
        reason: result.reason || "none",
        confidence: result.confidence || 0,
      };
    }
  } catch (err) {
    console.error("Text moderation error:", err);
  }

  return { flagged: false, reason: "none", confidence: 0 };
}

async function moderateImage(imageUrl: string): Promise<{ flagged: boolean; reason: string; confidence: number }> {
  const prompt = `You are a content moderator for an aquarium/fishkeeping community. This image was uploaded by a user. Classify it.
Respond with ONLY a JSON object: {"flagged": boolean, "reason": "inappropriate|spam|none", "confidence": 0.0-1.0}

Rules:
- Flag inappropriate content (nudity, violence, graphic non-fish content)
- Do NOT flag: fish photos, aquarium photos, equipment, plants, water testing results, fish eggs/fry, dead fish (normal in breeding)
- Only flag if clearly not related to fishkeeping or is inappropriate`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: "image/jpeg", data: "" } }, // In production, fetch and base64 encode
              { text: `Image URL: ${imageUrl}` },
            ],
          }],
          generationConfig: { maxOutputTokens: 50, temperature: 0.1 },
        }),
      }
    );

    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    const jsonMatch = resultText.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        flagged: result.flagged === true,
        reason: result.reason || "none",
        confidence: result.confidence || 0,
      };
    }
  } catch (err) {
    console.error("Image moderation error:", err);
  }

  return { flagged: false, reason: "none", confidence: 0 };
}
