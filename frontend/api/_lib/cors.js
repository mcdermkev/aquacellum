/**
 * cors.js — Shared CORS utility for Vercel API routes
 *
 * Restricts Access-Control-Allow-Origin to known Aquacellum origins
 * instead of using the wildcard '*'. Prevents unauthorized sites from
 * calling our API endpoints and burning Vertex AI credits or relayer ETH.
 */

const ALLOWED_ORIGINS = [
  'https://aquacellum.com',
  'https://www.aquacellum.com',
  'https://aquadex.fish',
  'https://www.aquadex.fish',
  'https://aquadex.io',
  'https://www.aquadex.io',
  // Vercel preview deployments
  'https://fish-dex-protocol.vercel.app',
  // Local development
  'http://localhost:4200',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:4200',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

/**
 * Sets CORS headers on the response, restricting origin to allowed list.
 * Returns true if the origin is allowed (or if no Origin header is present,
 * which happens for same-origin requests and server-to-server calls).
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{ methods?: string, headers?: string }} options
 * @returns {boolean} Whether the origin is allowed
 */
export function setCorsHeaders(req, res, options = {}) {
  const origin = req.headers.origin;
  const methods = options.methods || 'POST, OPTIONS';
  const headers = options.headers || 'Content-Type';

  // Allow Vercel preview URLs (pattern: *.vercel.app)
  const isVercelPreview = origin && /^https:\/\/[\w-]+\.vercel\.app$/.test(origin);

  if (origin && (ALLOWED_ORIGINS.includes(origin) || isVercelPreview)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    // No Origin header: same-origin request, server-to-server, or non-browser client
    // Allow through (CORS doesn't apply to same-origin)
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
    res.setHeader('Vary', 'Origin');
  }
  // If origin is present but not allowed, we simply don't set the header,
  // which causes the browser to block the response.

  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', headers);

  return !origin || ALLOWED_ORIGINS.includes(origin) || isVercelPreview;
}

/**
 * Handle an OPTIONS preflight request. Call this at the top of your handler.
 * Returns true if the request was a preflight and has been handled (caller should return).
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{ methods?: string, headers?: string }} options
 * @returns {boolean} Whether the request was handled as a preflight
 */
export function handleCorsPreFlight(req, res, options = {}) {
  setCorsHeaders(req, res, options);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
