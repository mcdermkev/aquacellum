# Aquadex Protocol — Frontend

The Aquadex Protocol frontend is a React 18 + Vite application deployed on Vercel. It connects to smart contracts on **Base Sepolia** testnet for species cataloging, specimen management, tank tracking, and peer-to-peer marketplace trading.

## 🌐 Live Demo

**https://aquacellum.com**

Connect a MetaMask wallet on Base Sepolia to interact with the full app.

---

## 📜 Deployed Contracts (Base Sepolia)

| Contract | Address | Explorer |
|----------|---------|----------|
| **AquadexManager** | `0x351ca8f34D94F29F6f865Afa419A636324473DeF` | [BaseScan](https://sepolia.basescan.org/address/0x351ca8f34D94F29F6f865Afa419A636324473DeF) |
| **AquadexMarketplace** | `0x16168B514144e0380610b78d904a4de51ba03Ca3` | [BaseScan](https://sepolia.basescan.org/address/0x16168B514144e0380610b78d904a4de51ba03Ca3) |

**Network:** Base Sepolia (Chain ID: 84532)  
**Curator:** `0xc42eD9F8Fc56F89380a8eD337169899f425Dc934`

---

## 🪙 Getting Base Sepolia Testnet ETH

To test transactions you need free testnet ETH. Options:

1. **Alchemy Faucet** — https://www.alchemy.com/faucets/base-sepolia  
2. **QuickNode Faucet** — https://faucet.quicknode.com/base/sepolia  
3. **Superchain Faucet** — https://app.optimism.io/faucet (select Base Sepolia)

Most faucets require a wallet address and give 0.01–0.1 ETH per request. That's more than enough for dozens of test transactions (gas is extremely cheap on Base Sepolia).

---

## 🛠 Local Development

```bash
cd frontend
npm install
npm run dev
```

The app runs at `http://localhost:5173` by default.

### Environment Variables

Create a `frontend/.env` file (already present in the repo):

```
VITE_MANAGER_ADDRESS=0x351ca8f34D94F29F6f865Afa419A636324473DeF
VITE_MARKETPLACE_ADDRESS=0x16168B514144e0380610b78d904a4de51ba03Ca3
VITE_CHAIN_ID=84532
VITE_RPC_URL=https://sepolia.base.org
VITE_BLOCK_EXPLORER=https://sepolia.basescan.org
```

### Build for Production

```bash
npm run build
```

Output goes to `frontend/dist/`.

---

## 🧪 Testing the Marketplace

Since this is a testnet deployment, you can test buying and selling using **two MetaMask accounts** in the same browser:

1. In MetaMask, create a second account (Account 2).
2. Send a small amount of testnet ETH from your main wallet to Account 2 (or use a faucet).
3. With Account 1: list a specimen for sale on the marketplace.
4. Switch to Account 2 in MetaMask: purchase the listing.
5. The app will detect the account switch automatically.

This lets you exercise the full buy/sell/escrow flow solo.

---

## 📁 Key Frontend Files

| Path | Purpose |
|------|---------|
| `src/App.jsx` | Root component, contract address constants |
| `src/utils/smartAccount.js` | Provider/signer setup, chain switching |
| `src/components/ConnectWallet.jsx` | MetaMask connection + network guard |
| `src/abi/AquadexManager.json` | Manager contract ABI |
| `src/abi/AquadexMarketplace.json` | Marketplace contract ABI |
| `public/species-images/` | Local species imagery (95 images) |
| `public/fishbase_master.json` | Full species reference database |

---

## 🏗 Tech Stack

- **React 18.3** + **Vite 8**
- **ethers.js v6** (loaded via CDN to avoid bundling issues)
- **Base Sepolia** (EVM L2 testnet)
- **Vercel** (hosting + serverless functions)
- **Gemini 1.5 Flash** (AI species validation via `/api/suggest-species`)
