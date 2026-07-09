/**
 * AuthContext.jsx
 * 
 * Unified authentication context supporting:
 *   1. Privy embedded wallets (email/Google login — no extension needed)
 *   2. MetaMask / injected wallet (advanced users, external wallet linking)
 * 
 * The Privy path is preferred for onboarding (zero friction for hobbyists).
 * MetaMask remains available as a fallback and for Pro users who want 
 * full self-custody control.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { usePrivy, useWallets, useCreateWallet } from "@privy-io/react-auth";
import { ethers } from "ethers";
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_RPC_URL,
  switchToBaseSepolia,
  getProvider as getReadOnlyProvider,
  registerSignerResolver,
  unregisterSignerResolver,
} from "../utils/smartAccount";
import { authenticateWithWallet, clearReefSession, refreshSession, sessionNeedsRefresh, isSupabaseConfigured } from "../services/supabaseClient";
import { setUserSigner, clearUserSigner } from "../services/smartAccountClient";
import { setSessionTokenGetter } from "../services/stripePayments";
import { setSessionTokenGetter as setShippingSessionTokenGetter } from "../services/shipping";
import { ensureProfile, updateProfile } from "../services/reefApi";
import { identifyUser, resetAnalyticsIdentity, trackEvent } from "../services/analytics";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Privy hooks
  const {
    ready: privyReady,
    authenticated: privyAuthenticated,
    user: privyUser,
    login: privyLogin,
    logout: privyLogout,
    getAccessToken,
  } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();

  // Unified state
  const [account, setAccount] = useState(null);
  const [loginMethod, setLoginMethod] = useState(null); // "privy" | "metamask" | null
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [wrongNetwork, setWrongNetwork] = useState(false);

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVY PATH: Embedded wallet via email/Google
  // ─────────────────────────────────────────────────────────────────────────
  const connectPrivy = useCallback(async () => {
    setError(null);
    setIsConnecting(true);
    try {
      // If already authenticated, create wallet if missing
      if (privyAuthenticated) {
        if (wallets?.length) {
          const embeddedWallet = wallets.find(w => w.walletClientType === "privy") || wallets[0];
          if (embeddedWallet?.address) {
            setAccount(embeddedWallet.address);
            setLoginMethod("privy");
            setWrongNetwork(false);
            return;
          }
        }
        // Create embedded wallet
        const wallet = await createWallet();
        if (wallet?.address) {
          setAccount(wallet.address);
          setLoginMethod("privy");
          setWrongNetwork(false);
        }
        return;
      }
      await privyLogin();
    } catch (err) {
      if (err.message?.includes("closed")) {
        setError("Login cancelled.");
      } else if (err.message?.includes("already")) {
        // Already has a wallet — will be resolved by useEffect
      } else {
        console.error("Privy login failed:", err);
        setError(err.message || "Login failed. Please try again.");
      }
    } finally {
      setIsConnecting(false);
    }
  }, [privyLogin, privyAuthenticated, wallets, createWallet]);

  // Resolve Privy embedded wallet address when authenticated
  useEffect(() => {
    if (!privyReady || !privyAuthenticated) return;

    // Try to get address from wallets array first
    if (wallets?.length) {
      const embeddedWallet = wallets.find(w => w.walletClientType === "privy") || wallets[0];
      if (embeddedWallet?.address) {
        setAccount(embeddedWallet.address);
        setLoginMethod("privy");
        setWrongNetwork(false);
        return;
      }
    }

    // Fallback: extract wallet address from Privy user object
    if (privyUser?.wallet?.address) {
      setAccount(privyUser.wallet.address);
      setLoginMethod("privy");
      setWrongNetwork(false);
      return;
    }

    // Fallback 2: check linkedAccounts for embedded wallet
    if (privyUser?.linkedAccounts?.length) {
      const walletAccount = privyUser.linkedAccounts.find(
        a => a.type === "wallet" && a.walletClientType === "privy"
      ) || privyUser.linkedAccounts.find(a => a.type === "wallet");
      if (walletAccount?.address) {
        setAccount(walletAccount.address);
        setLoginMethod("privy");
        setWrongNetwork(false);
        return;
      }
    }

    // No wallet found — need to create one
    createWallet()
      .then((wallet) => {
        setAccount(wallet.address);
        setLoginMethod("privy");
        setWrongNetwork(false);
      })
      .catch((err) => {
        console.warn("[AuthContext] Failed to create embedded wallet:", err);
      });
  }, [privyReady, privyAuthenticated, wallets, privyUser, createWallet]);

  // Retry wallet resolution after a short delay if authenticated but no account
  useEffect(() => {
    if (!privyReady || !privyAuthenticated || account) return;

    const retryTimer = setTimeout(() => {
      if (wallets?.length) {
        const w = wallets.find(w => w.walletClientType === "privy") || wallets[0];
        if (w?.address) {
          setAccount(w.address);
          setLoginMethod("privy");
          setWrongNetwork(false);
        }
      }
    }, 2000);

    return () => clearTimeout(retryTimer);
  }, [privyReady, privyAuthenticated, account, wallets]);

  // ─────────────────────────────────────────────────────────────────────────
  // REEF SOCIAL: Bridge wallet auth to Supabase session (JWT bridge)
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (account) {
      // Get the Privy access token to authenticate with the JWT bridge.
      // For Privy users, this mints a real Supabase JWT with wallet_address claim.
      // For MetaMask-only users (no Privy session), falls back to header mode.
      const initSession = async () => {
        let privyToken = null;
        if (privyAuthenticated && getAccessToken) {
          try {
            privyToken = await getAccessToken();
          } catch (err) {
            console.warn("[Reef] Could not get Privy token, falling back to header mode:", err.message);
          }
        }
        await authenticateWithWallet(account, privyToken);
      };
      initSession();
    } else {
      clearReefSession();
    }
  }, [account, privyAuthenticated]);

  // ─────────────────────────────────────────────────────────────────────────
  // ANALYTICS: identify the wallet with PostHog once connected, reset on
  // disconnect. `signup` is inferred by checking whether ensureProfile()
  // just inserted a brand-new row (created_at within the last few seconds of
  // the call) — there's no separate "new user" flag returned by ensureProfile,
  // and adding one would touch every other ensureProfile call site.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!account) {
      resetAnalyticsIdentity();
      return;
    }
    identifyUser(account, { login_method: loginMethod });
    trackEvent("login", { login_method: loginMethod });

    (async () => {
      try {
        const { data: profile } = await ensureProfile(account);
        if (profile?.created_at) {
          const ageMs = Date.now() - new Date(profile.created_at).getTime();
          if (ageMs < 15000) {
            trackEvent("signup", { login_method: loginMethod });
          }
        }
      } catch {
        // Best-effort — never block auth on an analytics lookup.
      }
    })();
  }, [account, loginMethod]);

  // ─────────────────────────────────────────────────────────────────────────
  // EMAIL CAPTURE: mirror the Privy-linked email onto profiles.email so the
  // retention system (server-side push+email nudges) can reach the user.
  // Privy exposes the email either as a directly-linked email account
  // (user.email.address, present when the user logged in via email/OTP) or
  // via an OAuth-linked account like Google (user.google.email) — the app's
  // login methods are ['email', 'google'], so both are checked. Runs once per
  // session when both the wallet and an email become available, and only
  // writes when the value actually differs from what's stored (avoids a
  // redundant UPDATE on every login).
  // ─────────────────────────────────────────────────────────────────────────
  const emailCaptureAttemptedRef = useRef(null);

  useEffect(() => {
    if (!account || !privyAuthenticated || !privyUser) return;
    if (!isSupabaseConfigured()) return;

    const email = privyUser.email?.address || privyUser.google?.email || null;
    if (!email) return;

    // Only attempt once per (account, email) pair per session — profile reads/
    // writes are cheap but there's no reason to repeat them on every re-render.
    const attemptKey = `${account}:${email}`;
    if (emailCaptureAttemptedRef.current === attemptKey) return;
    emailCaptureAttemptedRef.current = attemptKey;

    (async () => {
      try {
        // Ensure the profile row exists (no-ops if it's already there), then
        // sync the email only if it's missing or stale.
        const { data: profile } = await ensureProfile(account);
        if (profile && profile.email !== email) {
          await updateProfile(account, { email });
        }
      } catch (err) {
        console.warn("[AuthContext] Email capture failed:", err.message);
      }
    })();
  }, [account, privyAuthenticated, privyUser]);

  // ─────────────────────────────────────────────────────────────────────────
  // SESSION REFRESH: Re-mint Supabase JWT before expiry
  // ─────────────────────────────────────────────────────────────────────────
  const refreshIntervalRef = useRef(null);

  useEffect(() => {
    // Only set up refresh for Privy-authenticated users
    if (!account || !privyAuthenticated || !getAccessToken) {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      return;
    }

    // Check every 5 minutes if the session needs refresh
    refreshIntervalRef.current = setInterval(async () => {
      if (sessionNeedsRefresh()) {
        try {
          const token = await getAccessToken();
          if (token) {
            await refreshSession(token);
          }
        } catch (err) {
          console.warn("[Reef] Session refresh failed:", err.message);
        }
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, [account, privyAuthenticated, getAccessToken]);

  // Register Privy signer resolver so all getSigner() calls use embedded wallet
  useEffect(() => {
    if (loginMethod !== "privy" || !wallets?.length) {
      return;
    }

    const resolver = async () => {
      const embeddedWallet = wallets.find(w => w.walletClientType === "privy") || wallets[0];
      if (!embeddedWallet) {
        // Wallet not loaded yet — throw so we don't fall through to MetaMask
        throw new Error("Embedded wallet not yet available");
      }

      // Get ethers provider from Privy wallet
      const provider = await embeddedWallet.getEthersProvider();

      // Switch to Base Sepolia if needed
      try {
        await embeddedWallet.switchChain(BASE_SEPOLIA_CHAIN_ID);
      } catch (err) {
        console.warn("Chain switch failed for embedded wallet:", err);
      }

      return provider.getSigner();
    };

    registerSignerResolver(resolver);
    return () => unregisterSignerResolver();
  }, [loginMethod, wallets]);

  // Register user's EIP-1193 provider with smartAccountClient for per-user smart wallets
  useEffect(() => {
    if (!account) {
      clearUserSigner();
      return;
    }

    // Privy path: use embedded wallet's EIP-1193 provider
    if (wallets?.length) {
      const embeddedWallet = wallets.find(w => w.walletClientType === "privy") || wallets[0];
      if (embeddedWallet?.address) {
        (async () => {
          try {
            const eip1193Provider = await embeddedWallet.getEthereumProvider();
            setUserSigner(eip1193Provider, embeddedWallet.address);
          } catch (err) {
            console.warn("[AuthContext] Failed to register Privy user signer:", err);
          }
        })();
        return () => clearUserSigner();
      }
    }

    // MetaMask path: use window.ethereum as the EIP-1193 provider
    if (loginMethod === "metamask" && window.ethereum) {
      setUserSigner(window.ethereum, account);
      return () => clearUserSigner();
    }

    return () => clearUserSigner();
  }, [account, wallets, loginMethod]);

  // Register the Privy session-token getter with the payments service so
  // checkout + release can authorize from the logged-in session (no wallet
  // signature popup). Cleared when the user isn't Privy-authenticated, so
  // self-custody / logged-out flows fall back to wallet-signature release.
  useEffect(() => {
    if (privyAuthenticated && typeof getAccessToken === "function") {
      setSessionTokenGetter(getAccessToken);
      setShippingSessionTokenGetter(getAccessToken);
    } else {
      setSessionTokenGetter(null);
      setShippingSessionTokenGetter(null);
    }
    return () => {
      setSessionTokenGetter(null);
      setShippingSessionTokenGetter(null);
    };
  }, [privyAuthenticated, getAccessToken]);

  // ─────────────────────────────────────────────────────────────────────────
  // METAMASK PATH: Direct injected wallet connection
  // ─────────────────────────────────────────────────────────────────────────
  const connectMetaMask = useCallback(async () => {
    setError(null);
    setIsConnecting(true);

    try {
      if (!window.ethereum) {
        throw new Error("No wallet detected. Please install MetaMask or Coinbase Wallet.");
      }

      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const addr = accounts[0];

      // Check and switch to Base Sepolia if needed
      const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
      const currentChainId = parseInt(chainIdHex, 16);

      if (currentChainId !== BASE_SEPOLIA_CHAIN_ID) {
        await switchToBaseSepolia();
      }

      setAccount(addr);
      setLoginMethod("metamask");
      setWrongNetwork(false);
    } catch (err) {
      if (err.code === 4001) {
        setError("Connection cancelled.");
      } else {
        console.error("Wallet connection failed:", err);
        setError(err.message || "Failed to connect wallet.");
      }
    } finally {
      setIsConnecting(false);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // MetaMask event listeners
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!window.ethereum || loginMethod !== "metamask") return;

    const handleAccountsChanged = (accounts) => {
      if (!accounts || accounts.length === 0) {
        setAccount(null);
        setLoginMethod(null);
        setWrongNetwork(false);
      } else {
        setAccount(accounts[0]);
      }
    };

    const handleChainChanged = (chainIdHex) => {
      const onCorrectChain = parseInt(chainIdHex, 16) === BASE_SEPOLIA_CHAIN_ID;
      setWrongNetwork(!onCorrectChain);
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, [loginMethod]);

  // ─────────────────────────────────────────────────────────────────────────
  // Restore MetaMask session on page reload (only if no Privy session active)
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!window.ethereum || privyAuthenticated) return;

    const checkExistingSession = async () => {
      try {
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        if (accounts && accounts.length > 0) {
          const chainId = await window.ethereum.request({ method: "eth_chainId" });
          const onCorrectChain = parseInt(chainId, 16) === BASE_SEPOLIA_CHAIN_ID;
          if (onCorrectChain) {
            setAccount(accounts[0]);
            setLoginMethod("metamask");
            setWrongNetwork(false);
          } else {
            setWrongNetwork(true);
          }
        }
      } catch (err) {
        // Silently ignore — wallet may not be unlocked yet
      }
    };

    const timer = setTimeout(checkExistingSession, 300);
    return () => clearTimeout(timer);
  }, [privyAuthenticated]);

  // ─────────────────────────────────────────────────────────────────────────
  // Disconnect
  // ─────────────────────────────────────────────────────────────────────────
  const disconnect = useCallback(async () => {
    localStorage.removeItem("aquadex_session_key");

    if (loginMethod === "privy") {
      try {
        await privyLogout();
      } catch (err) {
        console.warn("Privy logout failed:", err);
      }
    }

    unregisterSignerResolver();
    clearUserSigner();
    setAccount(null);
    setLoginMethod(null);
    setWrongNetwork(false);
    setError(null);
  }, [loginMethod, privyLogout]);

  // ─────────────────────────────────────────────────────────────────────────
  // Get a signer for transactions
  // ─────────────────────────────────────────────────────────────────────────
  const getSigner = useCallback(async () => {
    if (loginMethod === "privy" && wallets?.length) {
      const embeddedWallet = wallets.find(w => w.walletClientType === "privy") || wallets[0];
      if (embeddedWallet) {
        try {
          await embeddedWallet.switchChain(BASE_SEPOLIA_CHAIN_ID);
        } catch (err) {
          // Continue — chain may already be correct
        }
        const provider = await embeddedWallet.getEthersProvider();
        return provider.getSigner();
      }
    }

    if (loginMethod === "metamask") {
      if (!window.ethereum) throw new Error("No wallet detected.");
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== BASE_SEPOLIA_CHAIN_ID) {
        await switchToBaseSepolia();
        return new ethers.providers.Web3Provider(window.ethereum).getSigner();
      }
      return provider.getSigner();
    }

    throw new Error("Not connected. Please log in first.");
  }, [loginMethod, wallets]);

  // ─────────────────────────────────────────────────────────────────────────
  // Switch network
  // ─────────────────────────────────────────────────────────────────────────
  const handleSwitchNetwork = useCallback(async () => {
    setError(null);
    try {
      if (loginMethod === "privy" && wallets?.length) {
        const embeddedWallet = wallets.find(w => w.walletClientType === "privy") || wallets[0];
        await embeddedWallet.switchChain(BASE_SEPOLIA_CHAIN_ID);
      } else {
        await switchToBaseSepolia();
      }
      setWrongNetwork(false);
    } catch (err) {
      setError("Failed to switch network. Please switch manually in your wallet.");
    }
  }, [loginMethod, wallets]);

  const value = {
    // State
    account,
    loginMethod,
    isConnecting,
    error,
    wrongNetwork,
    ready: privyReady,
    authenticated: privyAuthenticated,

    // Actions
    connectPrivy,
    connectMetaMask,
    disconnect,
    getSigner,
    handleSwitchNetwork,

    // Utilities
    getReadOnlyProvider,
    getAccessToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
