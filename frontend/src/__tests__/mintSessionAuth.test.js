import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeJwt } from "jose";

const verifierMocks = vi.hoisted(() => ({
  getConfiguration: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("../../api/_lib/verifyPrivyToken.js", () => ({
  getPrivyAuthConfiguration: verifierMocks.getConfiguration,
  verifyPrivyToken: verifierMocks.verify,
}));

const originalSecret = process.env.SUPABASE_JWT_SECRET;
const testSecret = "r1-test-secret-that-is-long-enough-for-hs256";
const tokenWallet = "0xAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const otherWallet = "0xBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function fakeReq(body = {}) {
  return {
    method: "POST",
    headers: { authorization: "Bearer valid-privy-token-value" },
    body,
  };
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end() {
      return this;
    },
  };
}

async function loadHandler() {
  vi.resetModules();
  return (await import("../../api/mint-session.js")).default;
}

async function invoke(body = {}) {
  const handler = await loadHandler();
  const res = fakeRes();
  await handler(fakeReq(body), res);
  return res;
}

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = testSecret;
  verifierMocks.getConfiguration.mockReset();
  verifierMocks.verify.mockReset();
  verifierMocks.getConfiguration.mockReturnValue({ configured: true, appId: "server-app-id" });
  verifierMocks.verify.mockResolvedValue({
    verified: true,
    userId: "did:privy:user-1",
    walletAddress: tokenWallet,
  });
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = originalSecret;
});

describe("mint-session wallet authority", () => {
  it("mints from the verified token wallet when the body assertion is absent", async () => {
    const res = await invoke();

    expect(res.statusCode).toBe(200);
    expect(res.body.wallet_address).toBe(tokenWallet.toLowerCase());
    expect(decodeJwt(res.body.access_token)).toMatchObject({
      role: "authenticated",
      iss: "supabase",
      sub: "did:privy:user-1",
      aud: "authenticated",
      wallet_address: tokenWallet.toLowerCase(),
    });
  });

  it("accepts a matching body wallet only as an assertion", async () => {
    const res = await invoke({ walletAddress: tokenWallet.toLowerCase() });
    expect(res.statusCode).toBe(200);
    expect(res.body.wallet_address).toBe(tokenWallet.toLowerCase());
  });

  it("rejects a token without a wallet even when the body supplies one", async () => {
    verifierMocks.verify.mockResolvedValue({
      verified: true,
      userId: "did:privy:email-user",
      walletAddress: null,
    });

    const res = await invoke({ walletAddress: otherWallet });
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/verified linked wallet/i);
  });

  it("rejects a valid but different body wallet", async () => {
    const res = await invoke({ walletAddress: otherWallet });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a malformed body wallet instead of ignoring it", async () => {
    const res = await invoke({ walletAddress: "not-a-wallet" });
    expect(res.statusCode).toBe(400);
  });

  it("maps failed Privy verification to 401", async () => {
    verifierMocks.verify.mockResolvedValue({
      verified: false,
      code: "TOKEN_SIGNATURE_INVALID",
      error: "Invalid token signature",
    });

    const res = await invoke({ walletAddress: tokenWallet });
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Invalid token signature");
  });
});

describe("mint-session fail-closed configuration", () => {
  it("returns 503 before verification when the server Privy app ID is unavailable", async () => {
    verifierMocks.getConfiguration.mockReturnValue({
      configured: false,
      code: "PRIVY_APP_ID_MISSING",
      error: "Authentication service is not configured",
    });

    const res = await invoke({ walletAddress: tokenWallet });
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "Auth bridge not configured" });
    expect(verifierMocks.verify).not.toHaveBeenCalled();
  });

  it("returns a generic 503 when the Supabase signing secret is unavailable", async () => {
    delete process.env.SUPABASE_JWT_SECRET;

    const res = await invoke({ walletAddress: tokenWallet });
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "Auth bridge not configured" });
    expect(verifierMocks.verify).not.toHaveBeenCalled();
  });
});
