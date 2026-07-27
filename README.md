# Koreth Subgraph

The Graph indexer for the **Koreth** protocol. Indexes positions, markets, borrows,
repays, liquidations, and bad-debt write-offs from
[`koreth-v1-core`](https://github.com/korethlabs/koreth-v1-core) so apps and analytics can
query protocol state without RPC fan-out.

## Data sources

| Source              | Events                                                        |
| ------------------- | ------------------------------------------------------------- |
| `MarketFactory`     | `MarketCreated` (spawns a `Market` template per proxy)        |
| `PositionManager`   | `PositionCreated`, `PositionClosed`, `PositionLiquidated`     |
| `LendingEngine`     | `Borrowed`, `Repaid`, `DebtWrittenOff`                        |
| `LiquidationEngine` | `LiquidationExecuted`                                          |
| `Market` (template) | `Supply`, `Withdraw`                                           |

`DebtWrittenOff` (bad-debt socialization) zeroes the position's `currentDebt`, records a
`DebtWriteOffEvent`, and removes the written-off amount from `ProtocolStats.totalBorrowed`.

## ABIs

ABIs in `abis/*.json` are the bare ABI arrays graph-cli expects. For local dev they are
regenerated from the core Foundry build by `prepare-local`, which also writes `networks.json`
from `koreth-v1-core/deployments/local.json`:

```bash
# after `forge build` + a local deploy in koreth-v1-core (override path with CORE_ROOT)
npm run prepare-local
```

Committed `networks.json` addresses are `0x0` placeholders — real addresses are injected at
build/deploy time via `graph build --network mainnet`.

## Build & deploy

```bash
npm install
npm run codegen           # generate AssemblyScript types from schema + ABIs
npm run build             # codegen + compile mappings to WASM

# local (graph-node + IPFS running on localhost)
npm run prepare-local
npm run create-local
npm run deploy-local
```

## License

`MIT` (see [LICENSE](./LICENSE)).
