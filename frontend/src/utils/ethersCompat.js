/**
 * ethersCompat.js
 * 
 * Shim that re-exports from the global `window.ethers` (loaded via UMD script tag).
 * This completely avoids Vite/Rollup bundling ethers, which causes TDZ errors
 * due to circular dependencies in the @ethersproject/* packages.
 *
 * The UMD build (ethers.umd.min.js) is pre-bundled by the ethers team with
 * all circular deps resolved, so it loads without issues as a plain script.
 */

const _ethers = window.ethers;

const { Contract, ContractFactory, providers, utils, constants } = _ethers;
const { JsonRpcProvider, Web3Provider, StaticJsonRpcProvider } = providers;
const { solidityKeccak256, solidityPack, formatEther, parseEther, formatUnits, parseUnits } = utils;

const ZeroAddress = constants.AddressZero;
const AddressZero = constants.AddressZero;

// Named exports
export {
  _ethers as ethers,
  Contract,
  ContractFactory,
  providers,
  utils,
  constants,
  JsonRpcProvider,
  Web3Provider,
  StaticJsonRpcProvider,
  solidityKeccak256,
  formatEther,
  parseEther,
  formatUnits,
  parseUnits,
  ZeroAddress,
  AddressZero,
};

// Default export
export default _ethers;
