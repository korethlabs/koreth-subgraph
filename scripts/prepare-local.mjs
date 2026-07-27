#!/usr/bin/env node
// Prepare the subgraph for a local (anvil fork) deploy:
//   1. Extract bare ABI arrays from the Foundry artifacts into ./abis/*.json
//      (graph-cli needs the ABI array, not Foundry's { abi, bytecode, ... } wrapper).
//   2. Generate ./networks.json from koreth-v1-core/deployments/local.json so
//      `graph build --network mainnet` injects the deployed addresses + startBlock.
//
// Usage (from the subgraph repo): node scripts/prepare-local.mjs
// Sibling multi-repo layout: contracts live in koreth-v1-core. Override with CORE_ROOT.
import {readFileSync, writeFileSync, mkdirSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const subgraphRoot = join(here, "..");
const contractsRoot = process.env.CORE_ROOT || join(subgraphRoot, "..", "koreth-v1-core");
const outDir = join(contractsRoot, "out");
const abisDir = join(subgraphRoot, "abis");
const deployments = join(contractsRoot, "deployments", "local.json");

// dataSource name -> { artifact: Foundry out path, key: deployments/local.json key }
const SOURCES = {
    PositionManager: {artifact: "PositionManager.sol/PositionManager.json", key: "positionManager"},
    LendingEngine: {artifact: "LendingEngine.sol/LendingEngine.json", key: "lendingEngine"},
    LiquidationEngine: {artifact: "LiquidationEngine.sol/LiquidationEngine.json", key: "liquidationEngine"},
    MarketFactory: {artifact: "MarketFactory.sol/MarketFactory.json", key: "marketFactory"},
};

// ABIs needed only for eth_call bindings inside mappings (not datasources, no address/startBlock).
const CALL_ABIS = {
    Market: "Market.sol/Market.json",
};

mkdirSync(abisDir, {recursive: true});

function exportAbi(name, artifact) {
    const art = JSON.parse(readFileSync(join(outDir, artifact), "utf8"));
    if (!Array.isArray(art.abi)) throw new Error(`No .abi array in ${artifact}`);
    writeFileSync(join(abisDir, `${name}.json`), JSON.stringify(art.abi, null, 2));
    console.log(`abi  -> abis/${name}.json`);
}

// 1. Export ABIs
for (const [name, {artifact}] of Object.entries(SOURCES)) exportAbi(name, artifact);
for (const [name, artifact] of Object.entries(CALL_ABIS)) exportAbi(name, artifact);

// Minimal ERC20 ABI for reading borrow-asset metadata (decimals/symbol) inside mappings.
const ERC20_ABI = [
    {name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{name: "", type: "uint8"}]},
    {name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{name: "", type: "string"}]},
];
writeFileSync(join(abisDir, "ERC20.json"), JSON.stringify(ERC20_ABI, null, 2));
console.log("abi  -> abis/ERC20.json");

// 2. Generate networks.json from the deployment
const dep = JSON.parse(readFileSync(deployments, "utf8"));
const startBlock = Number(dep.deployBlock);
if (!Number.isFinite(startBlock)) throw new Error(`Bad deployBlock in ${deployments}`);

const networks = {mainnet: {}};
for (const [name, {key}] of Object.entries(SOURCES)) {
    const address = dep[key];
    if (!address) throw new Error(`Missing '${key}' in ${deployments}`);
    networks.mainnet[name] = {address, startBlock};
}
writeFileSync(join(subgraphRoot, "networks.json"), JSON.stringify(networks, null, 2));
console.log(`net  -> networks.json (startBlock ${startBlock})`);
