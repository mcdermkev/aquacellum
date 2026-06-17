// frontend/api/_lib/vertexClient.js
// Shared Vertex AI client for the Poseidon serverless functions.
//
// Auth: Manual JWT signing for GCP service account authentication.
// This avoids google-auth-library's key handling which can fail on Node 24+
// with "DECODER routines::unsupported" when running on Vercel.
//
// Auth resolution order (first match wins):
//   1. GCP_SERVICE_ACCOUNT_JSON  — inline JSON (use this on Vercel)
//   2. GOOGLE_APPLICATION_CREDENTIALS — path to a key file (local dev)
//
// Fallback: If Vertex auth fails but GEMINI_API_KEY is set, falls back to the
// Google AI Studio (generativelanguage.googleapis.com) endpoint.

import { createSign, createPrivateKey } from 'crypto';
import { readFileSync } from 'fs';

let _cachedToken = null;
let _cachedTokenExpiry = 0;

/**
 * Parse the service account credentials from environment.
 */
function getCredentials() {
  const inline = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (inline && inline.trim()) {
    try {
      const parsed = JSON.parse(inline);
      if (parsed.private_key && !parsed.private_key.includes('\n')) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      return parsed;
    } catch {
      try {
        const unescaped = inline.replace(/\\"/g, '"').replace(/\\n/g, '\n');
        return JSON.parse(unescaped);
      } catch (e) {
        console.error('[VertexClient] Cannot parse GCP_SERVICE_ACCOUNT_JSON:', e.message);
        return null;
      }
    }
  }

  const filePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (filePath && filePath.trim()) {
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (e) {
      console.error('[VertexClient] Cannot read credentials file:', e.message);
      return null;
    }
  }

  return null;
}

/**
 * Base64url encode (no padding).
 */
function base64url(data) {
  const b64 = typeof data === 'string'
    ? Buffer.from(data).toString('base64')
    : data.toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Create a signed JWT for Google OAuth2 token exchange.
 * Uses explicit key object creation for Node 24+ / OpenSSL 3.x compatibility.
 */
function createJwt(credentials, scope) {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600; // 1 hour

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: credentials.client_email,
    sub: credentials.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: expiry,
    scope: scope,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  // Use createPrivateKey to normalize the key format for OpenSSL 3.x
  let privateKey;
  try {
    privateKey = createPrivateKey({ key: credentials.private_key, format: 'pem' });
  } catch {
    // Fallback: use raw PEM string directly
    privateKey = credentials.private_key;
  }

  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(privateKey);
  const signatureB64 = base64url(signature);

  return { jwt: `${signingInput}.${signatureB64}`, expiry };
}

/**
 * Exchange a signed JWT for a Google OAuth2 access token.
 */
async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if still valid (with 60s buffer)
  if (_cachedToken && _cachedTokenExpiry > now + 60) {
    return _cachedToken;
  }

  const scope = 'https://www.googleapis.com/auth/cloud-platform';
  const { jwt, expiry } = createJwt(credentials, scope);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${errBody}`);
  }

  const tokenData = await response.json();
  _cachedToken = tokenData.access_token;
  _cachedTokenExpiry = expiry;
  return _cachedToken;
}

/**
 * True when enough config is present to talk to an AI endpoint.
 */
export function isVertexConfigured() {
  const hasProject = !!(process.env.GCP_PROJECT_ID && process.env.GCP_PROJECT_ID.trim());
  const hasCreds = !!(
    (process.env.GCP_SERVICE_ACCOUNT_JSON && process.env.GCP_SERVICE_ACCOUNT_JSON.trim()) ||
    (process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GOOGLE_APPLICATION_CREDENTIALS.trim())
  );
  const hasGeminiKey = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  return (hasProject && hasCreds) || hasGeminiKey;
}

/**
 * POST a generateContent request to Vertex AI Gemini.
 * Falls back to Google AI Studio if Vertex auth fails but GEMINI_API_KEY is set.
 *
 * @param {string} model  e.g. 'gemini-2.5-flash'
 * @param {object} body   { contents, generationConfig, safetySettings }
 * @returns {Promise<Response>} Raw fetch Response
 */
export async function vertexGenerateContent(model, body) {
  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || 'us-central1';
  const geminiApiKey = process.env.GEMINI_API_KEY;

  const credentials = getCredentials();

  // Try Vertex AI first if credentials are available
  if (project && credentials) {
    try {
      const token = await getAccessToken(credentials);

      const url =
        `https://${location}-aiplatform.googleapis.com/v1/projects/${project}` +
        `/locations/${location}/publishers/google/models/${model}:generateContent`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      // Return directly for success or client errors
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }

      console.warn(`[VertexClient] Vertex returned ${response.status}, trying fallback...`);
    } catch (authErr) {
      console.warn('[VertexClient] Vertex auth failed:', authErr.message);
      var _vertexAuthError = authErr;
    }
  }

  // Fallback: Google AI Studio with API key
  if (geminiApiKey && geminiApiKey.trim()) {
    const aiStudioUrl =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

    const fallbackResponse = await fetch(aiStudioUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (fallbackResponse.status === 429) {
      const errData = await fallbackResponse.json().catch(() => ({}));
      const vertexReason = _vertexAuthError ? ` Vertex auth error: ${_vertexAuthError.message}` : '';
      throw new Error(
        `[VertexClient] AI Studio credits depleted: ${errData.error?.message || 'quota exceeded'}.${vertexReason}`
      );
    }

    return fallbackResponse;
  }

  throw new Error(
    '[VertexClient] No AI credentials available. Set GCP_PROJECT_ID + service account OR GEMINI_API_KEY.'
  );
}
