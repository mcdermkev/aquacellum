/**
 * Alt-Text Generator — Auto-generates accessible alt text for uploaded images.
 * 
 * Uses the Poseidon/Gemini Vision API to describe aquarium photos.
 * Respects the Poseidon enabled/disabled toggle from settings.
 * Falls back to a generic description if generation fails.
 */

const ALT_TEXT_API_URL = '/api/generate-alt-text';
const ALT_TEXT_CACHE_PREFIX = 'aquadex_alt_text_';

/**
 * Generate alt text for an uploaded image.
 * 
 * @param {string} imageUrl - The public CDN URL of the uploaded image
 * @param {Object} [context] - Optional context for better descriptions
 * @param {string} [context.speciesName] - Species shown in the image
 * @param {string} [context.tankName] - Tank the photo is from
 * @returns {Promise<string>} The generated alt text (or a fallback)
 */
export async function generateAltText(imageUrl, context = {}) {
  // Check if Poseidon is disabled
  if (localStorage.getItem('aquadex_poseidon_enabled') === 'false') {
    return buildFallbackAlt(context);
  }

  if (!imageUrl) return 'Aquarium photo';

  // Check cache first
  const cacheKey = ALT_TEXT_CACHE_PREFIX + hashUrl(imageUrl);
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(ALT_TEXT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl }),
    });

    if (!response.ok) {
      return buildFallbackAlt(context);
    }

    const data = await response.json();
    const altText = data.altText || buildFallbackAlt(context);

    // Cache the result to avoid re-generating for the same image
    try {
      localStorage.setItem(cacheKey, altText);
    } catch {
      // localStorage full — skip caching
    }

    return altText;
  } catch (err) {
    console.warn('[Alt-text] Generation failed:', err);
    return buildFallbackAlt(context);
  }
}

/**
 * Generate alt text from a base64 image (before upload).
 * Useful for generating alt text during the upload process itself.
 * 
 * @param {string} base64Data - Data URL (data:image/...;base64,...)
 * @param {Object} [context] - Optional context
 * @returns {Promise<string>}
 */
export async function generateAltTextFromBase64(base64Data, context = {}) {
  if (localStorage.getItem('aquadex_poseidon_enabled') === 'false') {
    return buildFallbackAlt(context);
  }

  if (!base64Data) return 'Aquarium photo';

  try {
    const response = await fetch(ALT_TEXT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64Data }),
    });

    if (!response.ok) return buildFallbackAlt(context);

    const data = await response.json();
    return data.altText || buildFallbackAlt(context);
  } catch (err) {
    console.warn('[Alt-text] Base64 generation failed:', err);
    return buildFallbackAlt(context);
  }
}

/**
 * Batch generate alt text for multiple image URLs.
 * Processes in parallel with a concurrency limit.
 * 
 * @param {string[]} imageUrls - Array of CDN URLs
 * @param {Object} [context] - Shared context for all images
 * @returns {Promise<Map<string, string>>} Map of url → alt text
 */
export async function generateAltTextsForUrls(imageUrls, context = {}) {
  const results = new Map();

  if (localStorage.getItem('aquadex_poseidon_enabled') === 'false') {
    for (const url of imageUrls) {
      results.set(url, buildFallbackAlt(context));
    }
    return results;
  }

  // Process 2 at a time to avoid rate limits
  const CONCURRENCY = 2;
  for (let i = 0; i < imageUrls.length; i += CONCURRENCY) {
    const batch = imageUrls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(url => generateAltText(url, context))
    );

    batch.forEach((url, idx) => {
      const result = batchResults[idx];
      results.set(url, result.status === 'fulfilled' ? result.value : buildFallbackAlt(context));
    });
  }

  return results;
}

/**
 * Build a context-aware fallback alt text when AI generation isn't available.
 */
function buildFallbackAlt(context = {}) {
  const parts = [];
  if (context.speciesName) parts.push(context.speciesName);
  if (context.tankName) parts.push(`in ${context.tankName}`);

  if (parts.length > 0) {
    return `Aquarium photo: ${parts.join(' ')}`;
  }
  return 'Aquarium photo';
}

/**
 * Simple hash of a URL for cache key generation.
 */
function hashUrl(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
