import {BigDecimal, DataSourceContext, log} from "@graphprotocol/graph-ts";
import {
    LendingPoolRegistered,
    LpPoolRemoved,
    LpPoolWhitelisted,
    RiskManagerUpdated,
} from "../generated/ProtocolCore/ProtocolCore";
import {ERC20} from "../generated/ProtocolCore/ERC20";
import {LendingPool as LendingPoolTemplate} from "../generated/templates";
import {CollateralPool, Pool} from "../generated/schema";
import {collateralPoolId, poolId, UNKNOWN_DECIMALS} from "./helpers/common";

export function handleLendingPoolRegistered(event: LendingPoolRegistered): void {
    // registerLendingPool() rejects a borrow asset that is already registered, so this can never
    // clobber a live entity.
    let pool = new Pool(poolId(event.params.borrowAsset));
    pool.address = event.params.pool;
    pool.borrowAsset = event.params.borrowAsset;

    // Borrow-asset metadata (decimals/symbol) — read from the token. Decimals decide the scale of
    // every borrow-side amount downstream, and core never calls decimals() itself, so a token
    // without it can genuinely reach registerLendingPool(). Defaulting to 18 would mis-scale a 6-dec
    // asset by 1e12 and quietly poison the protocol-wide aggregates, so store -1 instead: the
    // "scale unknown" sentinel, which positionPool() turns into a null so every consumer of a
    // borrow-side amount skips the event instead of converting. The entity is still created so
    // that Position.pool — a non-nullable reference — resolves.
    let erc = ERC20.bind(event.params.borrowAsset);
    let dec = erc.try_decimals();
    if (dec.reverted) {
        log.error(
            "LendingPoolRegistered: decimals() reverted for borrow asset {} — pool indexed with unknown scale, its amounts will be skipped",
            [event.params.borrowAsset.toHex()],
        );
    }
    pool.decimals = dec.reverted ? UNKNOWN_DECIMALS : dec.value;
    let sym = erc.try_symbol();
    pool.symbol = sym.reverted ? "?" : sym.value;

    // Liquidity and rates are read from the pool on every event that touches it (see
    // syncPoolState in helpers/pool.ts). Seed with zero — the pool has no supply yet.
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
 * Load-or-create rather than create: whitelistLpPool() rejects a pool that is already whitelisted,
 * but a pool that was removed can be whitelisted again, and that second event must revive the
 * existing entity rather than orphan its history behind a new one.
 */
export function handleLpPoolWhitelisted(event: LpPoolWhitelisted): void {
    let id = collateralPoolId(event.params.pool);
    let pool = CollateralPool.load(id);
    if (pool == null) {
        pool = new CollateralPool(id);
        pool.address = event.params.pool;
    }
    pool.whitelisted = true;
    pool.whitelistedAt = event.block.timestamp;
    // Cleared, not left behind: a pool that is accepted again has no removal date, and a stale one
    // would read as "removed" to anything looking at the field instead of the flag.
    pool.removedAt = null;
    pool.save();
}

export function handleLpPoolRemoved(event: LpPoolRemoved): void {
    let pool = CollateralPool.load(collateralPoolId(event.params.pool));
    // removeLpPool() requires the pool be whitelisted, so its entity must already exist. If it does
    // not, this subgraph missed the whitelisting — inventing an entity here would paper over that
    // with a row whose whitelistedAt is a fiction.
    if (pool == null) {
        log.error("LpPoolRemoved: no CollateralPool for {} — the whitelisting event was not indexed", [
            event.params.pool.toHex(),
        ]);
        return;
    }
    pool.whitelisted = false;
    pool.removedAt = event.block.timestamp;
    pool.save();
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
