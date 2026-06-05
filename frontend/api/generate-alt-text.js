// Vercel serverless function: frontend/api/generate-alt-text.js
// Generates accessible alt-text for user-uploaded aquarium photos via Gemini Vision.

/**
 * Accepts either:
 * - { imageUrl: "https://..." } — CDN URL of an already-uploaded image
 * - { imageBase64: "data:image/..." } — base64-encoded image data
 * 
 * Returns: { altText: "Descriptive alt text...", error?: string }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { imageUrl, imageBase64 } = req.body || {};

  if (!imageUrl && !imageBase64) {
    return res.status(400).json({ altText: null, error: 'Provide imageUrl or imageBase64' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY || GEMINI_API_KEY.trim() === '') {
    return res.status(200).json({ altText: "Aquarium photo", error: "API key not configured" });
  }

  try {
    // Build the image part for Gemini
    let imagePart;

    if (imageBase64) {
      // Extract mime type and data from data URL
      const match = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        imagePart = {
          inlineData: {
            mimeType: match[1],
            data: match[2]
          }
        };
      } else {
        // Assume raw base64 jpeg
        imagePart = {
          inlineData: {
            mimeType: "image/jpeg",
            data: imageBase64
          }
        };
      }
    } else {
      // Fetch the image from URL and convert to base64
      const imgResponse = await fetch(imageUrl);
      if (!imgResponse.ok) {
        return res.status(200).json({ altText: "Aquarium photo", error: "Could not fetch image" });
      }

      const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
      const buffer = await imgResponse.arrayBuffer();
      const base64Data = Buffer.from(buffer).toString('base64');

      imagePart = {
        inlineData: {
          mimeType: contentType,
          data: base64Data
        }
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

    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

    const geminiResponse = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [imagePart, prompt]
        }],
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
      }),
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

    // Clean up: remove quotes, trim, cap length
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
