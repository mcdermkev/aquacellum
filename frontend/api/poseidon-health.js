// Vercel serverless function: frontend/api/poseidon-health.js
// Health check for Poseidon AI Gateway + Relayer wallet — reveals configuration status without exposing secrets.

import { isVertexConfigured, vertexGenerateContent } from './_lib/vertexClient.js';
import { ethers } from "ethers";
import { handleCorsPreFlight } from './_lib/cors.js';

export default async function handler(req, res) {
  if (handleCorsPreFlight(req, res, { methods: 'GET, OPTIONS' })) return;

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
      // Check if private key has actual newlines (required for RSA signing)
      if (parsed.private_key) {
        const hasRealNewlines = parsed.private_key.includes('\n');
        const hasLiteralBackslashN = parsed.private_key.includes('\\n');
        parseError = `private_key: realNewlines=${hasRealNewlines}, literalBackslashN=${hasLiteralBackslashN}, length=${parsed.private_key.length}`;
      }
    } catch (e) {
      parseError = e.message;
      // Try with unescaping
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
      // vertexGenerateContent returns a Response object or throws
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

  // ─── Relayer Wallet Balance Check ───────────────────────────────────────────
  let relayerHealth = null;
  const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
  const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";

  if (RELAYER_PRIVATE_KEY) {
    try {
      const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
      const wallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
      const balance = await provider.getBalance(wallet.address);
      const balanceEth = parseFloat(ethers.utils.formatEther(balance));

      // Threshold: warn below 0.01 ETH, critical below 0.002 ETH
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
