import { ethers } from "ethers";

async function main() {
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  try {
    const blockNumber = await provider.getBlockNumber();
    console.log("Connected to localhost node at block:", blockNumber);
    const codeManager = await provider.getCode("0x5FbDB2315678afecb367f032d93F642f64180aa3");
    const codeMarketplace = await provider.getCode("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
    console.log("Manager code deployed:", codeManager !== "0x");
    console.log("Marketplace code deployed:", codeMarketplace !== "0x");
  } catch (e) {
    console.error("Failed to connect to provider:", e.message);
  }
}

main();
