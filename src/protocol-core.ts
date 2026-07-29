import {BigDecimal, DataSourceContext, log} from "@graphprotocol/graph-ts";
import {PoolRegistered, RiskManagerUpdated} from "../generated/ProtocolCore/ProtocolCore";
import {ERC20} from "../generated/ProtocolCore/ERC20";
import {LendingPool as LendingPoolTemplate} from "../generated/templates";
import {Pool} from "../generated/schema";
import {poolId} from "./helpers/common";

export function handlePoolRegistered(event: PoolRegistered): void {
    // registerPool() rejects a borrow asset that is already registered, so this can never
    // clobber a live entity.
    let pool = new Pool(poolId(event.params.borrowAsset));
    pool.address = event.params.pool;
    pool.borrowAsset = event.params.borrowAsset;

    // Borrow-asset metadata (decimals/symbol) — read from the token. Decimals decide the scale
    // of every borrow-side amount downstream, so a revert here is not something to paper over
    // with a default; log it loudly. 18 is only a placeholder to satisfy the non-null field.
    let erc = ERC20.bind(event.params.borrowAsset);
    let dec = erc.try_decimals();
    if (dec.reverted) {
        log.error("PoolRegistered: decimals() reverted for borrow asset {} — defaulting to 18", [
            event.params.borrowAsset.toHex(),
        ]);
    }
    pool.decimals = dec.reverted ? 18 : dec.value;
    let sym = erc.try_symbol();
    pool.symbol = sym.reverted ? "?" : sym.value;

    // Liquidity and rates are read from the pool on every event that touches it (see
    // syncPoolState in lending-pool.ts). Seed with zero — the pool has no supply yet.
    pool.totalSupply = BigDecimal.zero();
    pool.totalBorrow = BigDecimal.zero();
    pool.utilization = BigDecimal.zero();
    pool.supplyRate = BigDecimal.zero();
    pool.borrowRate = BigDecimal.zero();
    pool.createdAt = event.block.timestamp;
    pool.updatedAt = event.block.timestamp;
    pool.save();

    // Start indexing this pool proxy's Supply/Withdraw/InterestAccrued. The context carries the
    // pool id itself rather than re-deriving it, so the two cannot drift apart.
    let context = new DataSourceContext();
    context.setString("poolId", pool.id);
    LendingPoolTemplate.createWithContext(event.params.pool, context);
}

/**
 * CollateralType.currentBorrows and ProtocolStats.globalBorrowsUsd are accumulated from
 * RiskManager events and never read back, so they silently keep tracking the *old* contract
 * after a swap while the new one starts from zero. There is no way to recover from that
 * in-mapping — the RiskManager address is pinned in networks.json — so surface it and let the
 * operator redeploy the subgraph.
 */
export function handleRiskManagerUpdated(event: RiskManagerUpdated): void {
    log.error(
        "RiskManager swapped {} -> {}: borrow-exposure aggregates are now stale. Redeploy the subgraph against the new address.",
        [event.params.oldManager.toHex(), event.params.newManager.toHex()],
    );
}
