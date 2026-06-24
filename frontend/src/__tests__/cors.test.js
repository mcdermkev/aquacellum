/**
 * Unit tests for the CORS utility.
 * 
 * Run with: npx vitest --run src/__tests__/cors.test.js
 */

import { describe, it, expect, beforeEach } from "vitest";
import { setCorsHeaders, handleCorsPreFlight } from "../../api/_lib/cors.js";

/**
 * Mock request/response for testing CORS headers.
 */
function createMockReq(method = "POST", origin = null) {
  return {
    method,
    headers: origin ? { origin } : {},
  };
}

function createMockRes() {
  const headers = {};
  let statusCode = 200;
  return {
    setHeader: (key, value) => { headers[key] = value; },
    getHeader: (key) => headers[key],
    status: (code) => {
      statusCode = code;
      return { end: () => {} };
    },
    _headers: headers,
    _statusCode: statusCode,
  };
}

describe("CORS Utility", () => {
  describe("setCorsHeaders", () => {
    it("sets CORS headers for allowed production origins", () => {
      const req = createMockReq("POST", "https://aquacellum.com");
      const res = createMockRes();

      const allowed = setCorsHeaders(req, res);
      
      expect(allowed).toBe(true);
      expect(res._headers["Access-Control-Allow-Origin"]).toBe("https://aquacellum.com");
      expect(res._headers["Vary"]).toBe("Origin");
    });

    it("allows localhost development origins", () => {
      const req = createMockReq("POST", "http://localhost:5173");
      const res = createMockRes();

      const allowed = setCorsHeaders(req, res);
      
      expect(allowed).toBe(true);
      expect(res._headers["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
    });

    it("allows Vercel preview deployments", () => {
      const req = createMockReq("POST", "https://my-branch-abc123.vercel.app");
      const res = createMockRes();

      const allowed = setCorsHeaders(req, res);
      
      expect(allowed).toBe(true);
      expect(res._headers["Access-Control-Allow-Origin"]).toBe("https://my-branch-abc123.vercel.app");
    });

    it("blocks unknown origins (no header set)", () => {
      const req = createMockReq("POST", "https://evil-site.com");
      const res = createMockRes();

      const allowed = setCorsHeaders(req, res);
      
      expect(allowed).toBe(false);
      // Should NOT set Access-Control-Allow-Origin for the evil origin
      expect(res._headers["Access-Control-Allow-Origin"]).toBeUndefined();
    });

    it("allows same-origin requests (no Origin header)", () => {
      const req = createMockReq("POST"); // no origin
      const res = createMockRes();

      const allowed = setCorsHeaders(req, res);
      
      expect(allowed).toBe(true);
      // Falls back to first allowed origin
      expect(res._headers["Access-Control-Allow-Origin"]).toBe("https://aquacellum.com");
    });

    it("sets custom methods and headers", () => {
      const req = createMockReq("POST", "https://aquacellum.com");
      const res = createMockRes();

      setCorsHeaders(req, res, { methods: "GET, POST", headers: "Content-Type, Authorization" });
      
      expect(res._headers["Access-Control-Allow-Methods"]).toBe("GET, POST");
      expect(res._headers["Access-Control-Allow-Headers"]).toBe("Content-Type, Authorization");
    });

    it("rejects HTTP vercel.app origins (must be HTTPS)", () => {
      const req = createMockReq("POST", "http://my-branch.vercel.app");
      const res = createMockRes();

      const allowed = setCorsHeaders(req, res);
      
      expect(allowed).toBe(false);
    });
  });

  describe("handleCorsPreFlight", () => {
    it("handles OPTIONS preflight and returns true", () => {
      const req = createMockReq("OPTIONS", "https://aquacellum.com");
      const res = createMockRes();

      const handled = handleCorsPreFlight(req, res);
      
      expect(handled).toBe(true);
    });

    it("does not handle non-OPTIONS requests", () => {
      const req = createMockReq("POST", "https://aquacellum.com");
      const res = createMockRes();

      const handled = handleCorsPreFlight(req, res);
      
      expect(handled).toBe(false);
    });

    it("still sets CORS headers on non-OPTIONS", () => {
      const req = createMockReq("POST", "https://aquacellum.com");
      const res = createMockRes();

      handleCorsPreFlight(req, res);
      
      expect(res._headers["Access-Control-Allow-Origin"]).toBe("https://aquacellum.com");
    });
  });
});
