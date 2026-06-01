import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import "dotenv/config";

// ---------------------------------------------------------------------------
// Aquadex Protocol — Hardhat v3 Configuration
// Target Network: Base Sepolia Testnet (Chain ID: 84532)
// ---------------------------------------------------------------------------

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha, hardhatVerify],

  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
      // viaIR enables the Yul intermediate representation pipeline,
      // required for complex contracts with many custom errors.
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    // Base Sepolia Testnet — Hardhat v3 requires explicit type: "http"
    // accounts defaults to "remote" when no private key is set (compile-time safe)
    baseSepolia: {
      type: "http",
      chainType: "generic",
      url: BASE_SEPOLIA_RPC_URL,
      chainId: 84532,
      accounts: PRIVATE_KEY && PRIVATE_KEY !== "your_private_key_here"
        ? [PRIVATE_KEY]
        : "remote",
    },
  },

  // ---------------------------------------------------------------------------
  // Contract verification — Hardhat v3 uses verify.etherscan (not etherscan.*)
  // Uses Etherscan API v2 unified key — one key works for all supported chains.
  // Base Sepolia is registered via chainDescriptors.
  // ---------------------------------------------------------------------------
  verify: {
    etherscan: {
      apiKey: ETHERSCAN_API_KEY,
    },
  },

  chainDescriptors: {
    // Base Sepolia — register with BaseScan endpoints
    84532: {
      name: "Base Sepolia",
      blockExplorers: {
        etherscan: {
          name: "BaseScan",
          url: "https://sepolia.basescan.org",
          apiUrl: "https://api-sepolia.basescan.org/api",
        },
      },
    },
  },
});
