import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const joseMocks = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: joseMocks.createRemoteJWKSet,
  jwtVerify: joseMocks.jwtVerify,
}));

const originalPrivyAppId = process.env.PRIVY_APP_ID;
const originalVitePrivyAppId = process.env.VITE_PRIVY_APP_ID;

async function loadVerifier() {
  vi.resetModules();
  return import("../../api/_lib/verifyPrivyToken.js");
}

function request(token = "valid-token-value") {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} };
}

beforeEach(() => {
  delete process.env.PRIVY_APP_ID;
  delete process.env.VITE_PRIVY_APP_ID;
  joseMocks.createRemoteJWKSet.mockReset();
  joseMocks.jwtVerify.mockReset();
  joseMocks.createRemoteJWKSet.mockReturnValue({ type: "test-jwks" });
});

afterEach(() => {
  if (originalPrivyAppId === undefined) delete process.env.PRIVY_APP_ID;
  else process.env.PRIVY_APP_ID = originalPrivyAppId;

  if (originalVitePrivyAppId === undefined) delete process.env.VITE_PRIVY_APP_ID;
  else process.env.VITE_PRIVY_APP_ID = originalVitePrivyAppId;
});

describe("Privy server trust configuration", () => {
  it("fails before creating a JWKS client when the server app ID is absent", async () => {
    process.env.VITE_PRIVY_APP_ID = "browser-id-must-not-be-authority";
    const { verifyPrivyToken } = await loadVerifier();

    await expect(verifyPrivyToken(request())).resolves.toMatchObject({
      verified: false,
      code: "PRIVY_APP_ID_MISSING",
    });
    expect(joseMocks.createRemoteJWKSet).not.toHaveBeenCalled();
    expect(joseMocks.jwtVerify).not.toHaveBeenCalled();
  });

  it("rejects a malformed server app ID before constructing its URL", async () => {
    process.env.PRIVY_APP_ID = "bad/app/id";
    const { verifyPrivyToken } = await loadVerifier();

    await expect(verifyPrivyToken(request())).resolves.toMatchObject({
      verified: false,
      code: "PRIVY_APP_ID_INVALID",
    });
    expect(joseMocks.createRemoteJWKSet).not.toHaveBeenCalled();
  });

  it("uses only the server app ID for the JWKS path and audience", async () => {
    process.env.PRIVY_APP_ID = "server-app-id";
    process.env.VITE_PRIVY_APP_ID = "different-browser-id";
    joseMocks.jwtVerify.mockResolvedValue({
      payload: { sub: "did:privy:user-1", wallet_address: "0x1111111111111111111111111111111111111111" },
    });
    const { verifyPrivyToken } = await loadVerifier();

    await expect(verifyPrivyToken(request())).resolves.toEqual({
      verified: true,
      userId: "did:privy:user-1",
      walletAddress: "0x1111111111111111111111111111111111111111",
    });
    expect(String(joseMocks.createRemoteJWKSet.mock.calls[0][0])).toBe(
      "https://auth.privy.io/api/v1/apps/server-app-id/jwks.json",
    );
    expect(joseMocks.jwtVerify).toHaveBeenCalledWith(
      "valid-token-value",
      { type: "test-jwks" },
      { issuer: "privy.io", audience: "server-app-id" },
    );
  });
});

describe("Privy token result contract", () => {
  beforeEach(() => {
    process.env.PRIVY_APP_ID = "server-app-id";
  });

  it("allows an account token without inventing a wallet claim", async () => {
    joseMocks.jwtVerify.mockResolvedValue({ payload: { sub: "did:privy:email-user" } });
    const { verifyPrivyToken } = await loadVerifier();

    await expect(verifyPrivyToken(request())).resolves.toEqual({
      verified: true,
      userId: "did:privy:email-user",
      walletAddress: null,
    });
  });

  it("rejects a missing authorization header before token verification", async () => {
    const { verifyPrivyToken } = await loadVerifier();

    await expect(verifyPrivyToken(request(null))).resolves.toMatchObject({
      verified: false,
      code: "AUTH_HEADER_INVALID",
    });
    expect(joseMocks.jwtVerify).not.toHaveBeenCalled();
  });

  it("rejects a verified payload without a subject", async () => {
    joseMocks.jwtVerify.mockResolvedValue({ payload: { wallet_address: "0x1111111111111111111111111111111111111111" } });
    const { verifyPrivyToken } = await loadVerifier();

    await expect(verifyPrivyToken(request())).resolves.toMatchObject({
      verified: false,
      code: "TOKEN_SUB_MISSING",
    });
  });

  it("maps expiry and signature failures to stable codes", async () => {
    const { verifyPrivyToken } = await loadVerifier();

    joseMocks.jwtVerify.mockRejectedValueOnce({ code: "ERR_JWT_EXPIRED", message: "secret detail" });
    await expect(verifyPrivyToken(request())).resolves.toMatchObject({
      verified: false,
      code: "TOKEN_EXPIRED",
    });

    joseMocks.jwtVerify.mockRejectedValueOnce({
      code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
      message: "secret detail",
    });
    await expect(verifyPrivyToken(request())).resolves.toMatchObject({
      verified: false,
      code: "TOKEN_SIGNATURE_INVALID",
    });
  });

  it("does not return arbitrary verifier exception text", async () => {
    joseMocks.jwtVerify.mockRejectedValue({
      code: "ERR_JWT_CLAIM_VALIDATION_FAILED",
      message: "sensitive upstream detail",
    });
    const { verifyPrivyToken } = await loadVerifier();

    const result = await verifyPrivyToken(request());
    expect(result).toMatchObject({ verified: false, code: "TOKEN_INVALID" });
    expect(result.error).not.toContain("sensitive upstream detail");
  });
});

describe("Privy configuration HTTP mapping", () => {
  it("uses one generic 503 response for missing or invalid server trust", async () => {
    const { respondToPrivyConfigurationFailure } = await loadVerifier();
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };

    expect(respondToPrivyConfigurationFailure({ code: "PRIVY_APP_ID_MISSING" }, res)).toBe(true);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "Authentication service unavailable" });
    expect(respondToPrivyConfigurationFailure({ code: "TOKEN_EXPIRED" }, res)).toBe(false);
  });
});