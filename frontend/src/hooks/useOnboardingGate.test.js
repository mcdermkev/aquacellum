/**
 * Unit tests for useOnboardingGate resolution logic.
 *
 * Covers the cache-vs-profile precedence (Requirements 6.1, 6.2, 6.6) and the
 * Supabase → Dexie fallback when reading the per-account flag.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the React/Privy auth chain so importing the hook module is side-effect free.
vi.mock("../contexts/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../services/supabaseClient", () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock("../services/reefApi", () => ({ getProfile: vi.fn() }));
vi.mock("../db", () => ({ db: { userProfile: { get: vi.fn() } } }));

import { resolveGate, fetchAccountOnboardingComplete } from "./useOnboardingGate";
import { isSupabaseConfigured } from "../services/supabaseClient";
import { getProfile } from "../services/reefApi";
import { db } from "../db";

const ACCOUNT = "0xabc";

describe("resolveGate", () => {
  it("fast-path: cached completion never shows onboarding, even before auth is ready", () => {
    expect(
      resolveGate({ cacheComplete: true, ready: false, authenticated: false, account: null })
    ).toEqual({ showOnboarding: false, loading: false });
  });

  it("loads while the auth subsystem is not ready", () => {
    expect(
      resolveGate({ cacheComplete: false, ready: false, authenticated: false, account: null })
    ).toEqual({ showOnboarding: false, loading: true });
  });

  it("does not show onboarding when the user is not authenticated", () => {
    expect(
      resolveGate({ cacheComplete: false, ready: true, authenticated: false, account: null })
    ).toEqual({ showOnboarding: false, loading: false });
  });

  it("shows onboarding when authenticated but no account has resolved yet (new user)", () => {
    expect(
      resolveGate({ cacheComplete: false, ready: true, authenticated: true, account: null })
    ).toEqual({ showOnboarding: true, loading: false });
  });

  it("loads while the account is known but the profile flag is unresolved", () => {
    expect(
      resolveGate({
        cacheComplete: false,
        ready: true,
        authenticated: true,
        account: ACCOUNT,
        profileResolved: false,
      })
    ).toEqual({ showOnboarding: false, loading: true });
  });

  it("shows onboarding when the resolved profile flag is incomplete", () => {
    expect(
      resolveGate({
        cacheComplete: false,
        ready: true,
        authenticated: true,
        account: ACCOUNT,
        profileResolved: true,
        profileComplete: false,
      })
    ).toEqual({ showOnboarding: true, loading: false });
  });

  it("does not show onboarding when the resolved profile flag is complete", () => {
    expect(
      resolveGate({
        cacheComplete: false,
        ready: true,
        authenticated: true,
        account: ACCOUNT,
        profileResolved: true,
        profileComplete: true,
      })
    ).toEqual({ showOnboarding: false, loading: false });
  });
});

describe("fetchAccountOnboardingComplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the Supabase flag when configured and present (true)", async () => {
    isSupabaseConfigured.mockReturnValue(true);
    getProfile.mockResolvedValue({ data: { onboarding_complete: true }, error: null });

    await expect(fetchAccountOnboardingComplete(ACCOUNT)).resolves.toBe(true);
    expect(db.userProfile.get).not.toHaveBeenCalled();
  });

  it("uses the Supabase flag when configured and present (false)", async () => {
    isSupabaseConfigured.mockReturnValue(true);
    getProfile.mockResolvedValue({ data: { onboarding_complete: false }, error: null });

    await expect(fetchAccountOnboardingComplete(ACCOUNT)).resolves.toBe(false);
    expect(db.userProfile.get).not.toHaveBeenCalled();
  });

  it("falls back to the Dexie mirror when the Supabase column is absent", async () => {
    isSupabaseConfigured.mockReturnValue(true);
    getProfile.mockResolvedValue({ data: { display_name: "x" }, error: null });
    db.userProfile.get.mockResolvedValue({ onboardingComplete: true });

    await expect(fetchAccountOnboardingComplete(ACCOUNT)).resolves.toBe(true);
    expect(db.userProfile.get).toHaveBeenCalledWith(ACCOUNT);
  });

  it("falls back to the Dexie mirror when Supabase is not configured", async () => {
    isSupabaseConfigured.mockReturnValue(false);
    db.userProfile.get.mockResolvedValue({ onboardingComplete: false });

    await expect(fetchAccountOnboardingComplete(ACCOUNT)).resolves.toBe(false);
    expect(getProfile).not.toHaveBeenCalled();
  });

  it("returns false when no profile exists in either source", async () => {
    isSupabaseConfigured.mockReturnValue(false);
    db.userProfile.get.mockResolvedValue(undefined);

    await expect(fetchAccountOnboardingComplete(ACCOUNT)).resolves.toBe(false);
  });

  it("falls back to Dexie when the Supabase read throws", async () => {
    isSupabaseConfigured.mockReturnValue(true);
    getProfile.mockRejectedValue(new Error("network"));
    db.userProfile.get.mockResolvedValue({ onboardingComplete: true });

    await expect(fetchAccountOnboardingComplete(ACCOUNT)).resolves.toBe(true);
  });
});
