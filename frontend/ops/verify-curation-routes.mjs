/**
 * verify-curation-routes.mjs
 *
 * Exercises the Breeders Council curation routes on api/species.js by invoking
 * the real handler with mock req/res objects. No server needed, which also
 * sidesteps the `vercel dev` recursion this project hits (the `dev` script is
 * itself `vercel dev`, so `vercel dev` refuses to start).
 *
 * What it actually proves, and why each matters:
 *   - the four ?action= routes dispatch at all
 *   - suggest/vote/promote return 401 with NO auth and with a FORGED bearer
 *     token, i.e. they refuse before touching the database or the curator key
 *   - GET on promote is 405, so the mutating path is not reachable by a link
 *   - curation responses use the RESTRICTED origin allowlist: a disallowed
 *     origin gets no Access-Control-Allow-Origin at all, an allowed one is
 *     echoed back verbatim rather than '*'
 *   - the public read routes still use the open '*' policy, so scoping the
 *     curation branch did not regress the public species API
 *
 * Read-only against production: the only mutating routes are called without
 * valid credentials, so they cannot write.
 *
 * Usage, from the frontend/ directory (reads .env for Supabase config):
 *   node ops/verify-curation-routes.mjs
 *
 * Exits 0 when every check passes, 1 otherwise. One line of expected noise on
 * stderr: "[Auth] Privy token verification failed: ERR_JWS_INVALID" is the
 * forged-token case being correctly rejected.
 *
 * See docs/SPECIES_SUGGESTION_APPROVAL_SPEC.md.
 */
import { readFileSync } from "fs";

// The handler reads Supabase config at module scope, so load env first.
for (const line of readFileSync("./.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { default: handler } = await import("../api/species.js");

function mockRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
  return res;
}

async function call({ method = "GET", query = {}, body = undefined, headers = {} }) {
  const req = { method, query, body, headers, socket: { remoteAddress: "127.0.0.1" } };
  const res = mockRes();
  await handler(req, res);
  return res;
}

let fails = 0;
function check(name, cond, detail) {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + JSON.stringify(detail)}`);
}

console.log("=== route dispatch ===");

const queue = await call({ method: "GET", query: { action: "queue" } });
check("action=queue returns 200", queue.statusCode === 200, queue.body);
check("action=queue reports configured", queue.body?.configured === true, queue.body);
check("action=queue returns an array", Array.isArray(queue.body?.suggestions), queue.body);
console.log(`      queue currently holds ${queue.body?.suggestions?.length ?? "?"} suggestions`);

console.log("\n=== the mutating routes must refuse without a verified Privy token ===");
for (const action of ["suggest", "vote", "promote"]) {
  const r = await call({ method: "POST", query: { action }, body: {} });
  check(`action=${action} unauthenticated -> 401`, r.statusCode === 401, {
    status: r.statusCode,
    body: r.body,
  });
}

console.log("\n=== a forged Bearer token must not pass ===");
const forged = await call({
  method: "POST",
  query: { action: "promote" },
  body: { suggestionId: "00000000-0000-0000-0000-000000000000" },
  headers: { authorization: "Bearer " + "x".repeat(64) },
});
check("forged token on promote -> 401", forged.statusCode === 401, {
  status: forged.statusCode,
  body: forged.body,
});

console.log("\n=== method guards ===");
const wrongMethod = await call({ method: "GET", query: { action: "promote" } });
check("GET on promote -> 405", wrongMethod.statusCode === 405, {
  status: wrongMethod.statusCode,
  body: wrongMethod.body,
});

console.log("\n=== CORS: curation uses the restricted allowlist, not '*' ===");
const cors = await call({
  method: "GET",
  query: { action: "queue" },
  headers: { origin: "https://evil.example.com" },
});
check(
  "disallowed origin gets no ACAO header",
  cors.headers["access-control-allow-origin"] === undefined,
  cors.headers
);
const good = await call({
  method: "GET",
  query: { action: "queue" },
  headers: { origin: "https://aquadex.fish" },
});
check(
  "allowed origin is echoed back (not '*')",
  good.headers["access-control-allow-origin"] === "https://aquadex.fish",
  good.headers
);

console.log("\n=== the public read routes still use open CORS ===");
const pub = await call({ method: "GET", query: { stats: "true" }, headers: { origin: "https://evil.example.com" } });
check("public stats route keeps ACAO '*'", pub.headers["access-control-allow-origin"] === "*", pub.headers);
check("public stats route returns 200", pub.statusCode === 200, pub.statusCode);

console.log(`\n${fails === 0 ? "ALL ROUTE CHECKS PASSED" : fails + " ROUTE CHECK(S) FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
