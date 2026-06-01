import { network } from "hardhat";
const connection = await network.create();
const { ethers } = connection;
console.log("Provider keys:", Object.keys(ethers.provider));
console.log("typeof ethers.provider.send:", typeof ethers.provider.send);
