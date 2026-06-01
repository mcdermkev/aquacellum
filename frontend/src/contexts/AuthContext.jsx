/**
 * AuthContext.jsx
 * 
 * Authentication context — MetaMask / injected wallet only.
 * Privy is disabled until environment variables are configured on Vercel.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  BASE_SEPOLIA_CHAIN_ID,
  switchToBaseSepolia,
  getProvider as getReadOnlyProvider,
} from "../utils/smartAccount";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Unified state
  const [account, setAccount] = useState(null);
  const [loginMethod, setLoginMethod] = useState(null); // "metamask" | null
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [wrongNetwork, setWrongNetwork] = useState(false);

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
  // Restore MetaMask session on page reload
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!window.ethereum) return;

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
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Disconnect
  // ─────────────────────────────────────────────────────────────────────────
  const disconnect = useCallback(async () => {
    localStorage.removeItem("aquadex_session_key");
    setAccount(null);
    setLoginMethod(null);
    setWrongNetwork(false);
    setError(null);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Get a signer for transactions
  // ─────────────────────────────────────────────────────────────────────────
  const getSigner = useCallback(async () => {
    if (loginMethod === "metamask") {
      if (!window.ethereum) throw new Error("No wallet detected.");
      const { ethers } = await import("ethers");
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== BASE_SEPOLIA_CHAIN_ID) {
        await switchToBaseSepolia();
        return new ethers.providers.Web3Provider(window.ethereum).getSigner();
      }
      return provider.getSigner();
    }

    throw new Error("Not connected. Please log in first.");
  }, [loginMethod]);

  // ─────────────────────────────────────────────────────────────────────────
  // Switch network
  // ─────────────────────────────────────────────────────────────────────────
  const handleSwitchNetwork = useCallback(async () => {
    setError(null);
    try {
      await switchToBaseSepolia();
      setWrongNetwork(false);
    } catch (err) {
      setError("Failed to switch network. Please switch manually in your wallet.");
    }
  }, []);

  const value = {
    // State
    account,
    loginMethod,
    isConnecting,
    error,
    wrongNetwork,
    ready: true,         // Always ready (no Privy init delay)
    authenticated: false, // Privy disabled

    // Actions
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
