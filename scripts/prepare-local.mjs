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
    // Pools are indexed off ProtocolCore, not PoolFactory: registerPool() is the single
    // chokepoint every pool passes through, including factory-created ones.
    ProtocolCore: {artifact: "ProtocolCore.sol/ProtocolCore.json", key: "core"},
    RiskManager: {artifact: "RiskManager.sol/RiskManager.json", key: "riskManager"},
};

// ABIs needed only for eth_call bindings inside mappings (not datasources, no address/startBlock).
const CALL_ABIS = {
    LendingPool: "LendingPool.sol/LendingPool.json",
};

mkdirSync(abisDir, {recursive: true});

// The trailing newline is not cosmetic for the files under abis/: CI regenerates those and
// requires the result to be byte-identical to the committed copies, so anything that makes a
// checked-in ABI differ from this function's output is a permanent failure — and every editor and
// formatter that touches them will add the newline back. networks.json goes through here too, but
// it is per-deployment state that nothing compares; it is written the same way for consistency.
function writeJson(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function exportAbi(name, artifact) {
    const art = JSON.parse(readFileSync(join(outDir, artifact), "utf8"));
    if (!Array.isArray(art.abi)) throw new Error(`No .abi array in ${artifact}`);
    writeJson(join(abisDir, `${name}.json`), art.abi);
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
writeJson(join(abisDir, "ERC20.json"), ERC20_ABI);
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
writeJson(join(subgraphRoot, "networks.json"), networks);
console.log(`net  -> networks.json (startBlock ${startBlock})`);
