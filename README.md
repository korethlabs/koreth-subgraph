# Koreth Subgraph

The Graph indexer for the **Koreth** protocol. Indexes positions, lending pools, borrows,
repays, liquidations, and bad-debt write-offs from
[`koreth-v1-core`](https://github.com/korethlabs/koreth-v1-core) so apps and analytics can
query protocol state without RPC fan-out.

## Data sources

| Source                   | Events                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `PoolFactory`            | `PoolCreated` (spawns a `LendingPool` template per proxy)                                        |
| `RiskManager`            | `CollateralConfigSet`, `LPTypeBorrowCapUpdated`, `Borrow`/`Accrual`/`RepayRecorded`              |
| `PositionManager`        | `PositionCreated`, `PositionClosed`, `PositionLiquidated`                                        |
| `LendingEngine`          | `Borrowed`, `Repaid`, `DebtWrittenOff`                                                           |
| `LiquidationEngine`      | `LiquidationExecuted`                                                                            |
| `LendingPool` (template) | `Supply`, `Withdraw`                                                                             |

## Shared-pool model

Liquidity and risk are indexed as two separate axes, mirroring the contracts:

- **`Pool`** — one per borrow asset (USDC, USDT, …), holding liquidity and rates. Keyed by the
  borrow-asset address, because that is what `PositionCreated` and `DebtWrittenOff` both carry.
- **`CollateralType`** — one per `ILPAdapter.LPType`, holding LTV, liquidation threshold/bonus,
  haircut and borrow cap. These apply across every pool at once.

A `Position` therefore links to both. Its `lpPool` field is the *AMM* pair the LP token belongs
to and is unrelated to `pool`.

`CollateralType.currentBorrows` is accumulated from the `BorrowRecorded` / `AccrualRecorded` /
`RepayRecorded` events, which each carry the per-type USD delta, so per-collateral exposure never
requires a contract read.

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
