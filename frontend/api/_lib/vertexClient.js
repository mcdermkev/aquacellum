// frontend/api/_lib/vertexClient.js
// Shared Vertex AI client for the Poseidon serverless functions.
//
// Auth resolution order (first match wins):
//   1. GCP_SERVICE_ACCOUNT_JSON  — inline one-line JSON (use this on Vercel)
//   2. GOOGLE_APPLICATION_CREDENTIALS — path to a key file (use this locally)
//   3. Application Default Credentials (gcloud auth / metadata server)
//
// All calls bill to the Cloud project in GCP_PROJECT_ID, so usage draws from
// the project's credits instead of the old AI Studio Developer API key.

import { GoogleAuth } from 'google-auth-library';

let _auth = null;

function getAuth() {
  if (_auth) return _auth;

  const opts = { scopes: ['https://www.googleapis.com/auth/cloud-platform'] };

  const inline = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (inline && inline.trim() !== '') {
    opts.credentials = JSON.parse(inline);
  }
  // If no inline JSON, GoogleAuth falls back to GOOGLE_APPLICATION_CREDENTIALS
  // or ambient ADC automatically.

  _auth = new GoogleAuth(opts);
  return _auth;
}

/**
 * True when enough config is present to talk to Vertex. Functions use this to
 * decide whether to run live or drop into their offline/local fallback.
 */
export function isVertexConfigured() {
  const hasProject = !!(process.env.GCP_PROJECT_ID && process.env.GCP_PROJECT_ID.trim());
  const hasCreds = !!(
    (process.env.GCP_SERVICE_ACCOUNT_JSON && process.env.GCP_SERVICE_ACCOUNT_JSON.trim()) ||
    (process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GOOGLE_APPLICATION_CREDENTIALS.trim())
  );
  return hasProject && hasCreds;
}

/**
 * POST a generateContent request to a Vertex AI Gemini model.
 * The `body` is the same shape used by the Gemini Developer API
 * ({ contents, generationConfig, safetySettings }), so existing request
 * builders and response parsing (candidates[0].content.parts[0].text) are
 * unchanged. Returns the raw fetch Response.
 *
 * @param {string} model  e.g. 'gemini-2.0-flash'
 * @param {object} body   { contents, generationConfig, safetySettings }
 */
export async function vertexGenerateContent(model, body) {
  const auth = getAuth();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse.token;

  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || 'us-central1';

  const url =
    `https://${location}-aiplatform.googleapis.com/v1/projects/${project}` +
    `/locations/${location}/publishers/google/models/${model}:generateContent`;

  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
