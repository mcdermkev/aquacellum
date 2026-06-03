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

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
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

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Privy hooks
  const {
    ready: privyReady,
    authenticated: privyAuthenticated,
    user: privyUser,
    login: privyLogin,
    logout: privyLogout,
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

  // Register Privy signer resolver so all getSigner() calls use embedded wallet
  useEffect(() => {
    if (loginMethod !== "privy" || !wallets?.length) {
      return;
    }

    const resolver = async () => {
      const embeddedWallet = wallets.find(w => w.walletClientType === "privy") || wallets[0];
      if (!embeddedWallet) return null;

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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
