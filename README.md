# Koreth Subgraph

The Graph indexer for the **Koreth** protocol. Indexes positions, lending pools, borrows,
repays, liquidations, and bad-debt write-offs from
[`koreth-v1-core`](https://github.com/korethlabs/koreth-v1-core) so apps and analytics can
query protocol state without RPC fan-out.

## Data sources

| Source                   | Events                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `ProtocolCore`           | `PoolRegistered` (spawns a `LendingPool` template per proxy), `RiskManagerUpdated`               |
| `RiskManager`            | `CollateralConfigSet`, `LPTypeBorrowCapUpdated`, `BorrowRecorded`, `AccrualRecorded`, `RepayRecorded` |
| `PositionManager`        | `PositionCreated`, `PositionClosed`, `PositionLiquidated`                                        |
| `LendingEngine`          | `Borrowed`, `Repaid`, `DebtWrittenOff`                                                           |
| `LiquidationEngine`      | `LiquidationExecuted`                                                                            |
| `LendingPool` (template) | `Supply`, `Withdraw`, `InterestAccrued`                                                          |

Pools come from `ProtocolCore.PoolRegistered`, not `PoolFactory.PoolCreated`: `registerPool()` is
the single chokepoint every pool passes through — the factory calls it too — and it enforces
`pool.borrowAsset() == borrowAsset`. Indexing the factory instead would miss pools a `PoolAdmin`
registers directly, and would go blind entirely if `setPoolFactory()` re-pointed the factory.

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

`DebtWrittenOff` (bad-debt socialization) zeroes the position's `currentDebt` and records a
`DebtWriteOffEvent`.

### Read, don't accumulate

`Pool`'s liquidity/rate fields and `SupplyPosition`'s share fields are read from
`LendingPool.getPoolState()` / `shares()` / `totalShares()` on every event that touches the pool,
rather than accumulated from event params. `accrueInterest()` credits lenders by mutating
`totalSupply` directly, and `withdraw()` emits an `amount` that already includes the withdrawer's
share of that interest — so an accumulator adds principal but subtracts principal-plus-interest and
drifts towards zero on a pool that is actually fully funded. Reading costs one `eth_call` per pool
event and makes every field self-correcting.

Amounts denominated in a borrow asset (`Borrowed`, `Repaid`, `LiquidationExecuted`) resolve their
scale via `Position -> Pool`. There is no fallback: pools are per borrow asset, so guessing between
a 6-dec USDC pool and an 18-dec WETH pool is wrong by `1e12`, and these amounts feed protocol-wide
aggregates. If the scale can't be resolved the event is skipped and logged.

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
