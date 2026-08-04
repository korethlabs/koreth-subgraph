import {Address, BigDecimal, BigInt, log} from "@graphprotocol/graph-ts";
import {LendingPool} from "../../generated/templates/LendingPool/LendingPool";
import {Pool, Position} from "../../generated/schema";
import {BPS_DECIMALS, poolId, RATE_DECIMALS, toDecimal, UNKNOWN_DECIMALS} from "./common";

/**
 * Load the pool for a borrow asset, or seed a placeholder when it is missing.
 *
 * handleLendingPoolRegistered is the real constructor — this only covers the case where LendingPoolRegistered
 * landed before the data source's startBlock, which would otherwise leave Position.pool (a
 * non-nullable reference) dangling and fail the whole position query rather than just that field.
 *
 * The placeholder is deliberately fail-closed: the pool proxy address is unknown here, so
 * `decimals` gets the UNKNOWN_DECIMALS sentinel, which makes syncPoolState refuse to bind and
 * positionPool() return null. Every borrow-side amount consumer then skips the event instead of
 * mis-scaling it against a made-up scale. Does not save — the caller sets the timestamps.
 */
export function getOrCreatePool(borrowAsset: Address): Pool {
    let id = poolId(borrowAsset);
    let pool = Pool.load(id);
    if (pool == null) {
        pool = new Pool(id);
        pool.address = Address.zero();
        pool.borrowAsset = borrowAsset;
        pool.symbol = "?";
        pool.decimals = UNKNOWN_DECIMALS;
        pool.totalSupply = BigDecimal.zero();
        pool.totalBorrow = BigDecimal.zero();
        pool.utilization = BigDecimal.zero();
        pool.supplyRate = BigDecimal.zero();
        pool.borrowRate = BigDecimal.zero();
    }
    return pool;
}

/**
 * Refresh a pool's liquidity and rate fields from the contract, then save it.
 *
 * These are read rather than accumulated, deliberately. accrueInterest() credits lenders by
 * mutating totalSupply directly and emits only InterestAccrued, while withdraw() emits an
 * `amount` that already includes the withdrawer's share of that interest. An
 * add-principal / subtract-principal-plus-interest accumulator therefore ratchets downwards and
 * converges to zero on a pool that is in fact fully funded. Reading getPoolState() makes all
 * five fields self-correcting, at the cost of one eth_call per pool event.
 *
 * Returns false when the refresh could not happen, in which case nothing is written. Callers
 * must not go on to derive anything from the pool: suppliedAmount is computed against
 * pool.totalSupply, so a stale value there produces a wrong balance rather than no balance.
 *
 * This has to run on the LendingEngine events too, not just the pool template's own
 * Supply/Withdraw/InterestAccrued: borrow, repay and liquidation all move totalBorrow and the
 * rates, and accrueInterest() returns *without* emitting InterestAccrued when totalBorrow is
 * still 0 or when it already ran in this block. The first borrow against a pool hits exactly
 * that hole.
 */
export function syncPoolState(pool: Pool, timestamp: BigInt): boolean {
    // Scale unknown (decimals() reverted at registration) — totalSupply/totalBorrow cannot be
    // converted to human units, and the rate fields are meaningless without them.
    if (pool.decimals == UNKNOWN_DECIMALS) {
        log.error("syncPoolState: pool {} has unknown borrow-asset scale — state not indexed", [pool.id]);
        return false;
    }
    let res = LendingPool.bind(Address.fromBytes(pool.address)).try_getPoolState();
    if (res.reverted) {
        log.error("syncPoolState: getPoolState() reverted for pool {}", [pool.id]);
        return false;
    }
    let st = res.value;
    pool.totalSupply = toDecimal(st.totalSupply, pool.decimals);
    pool.totalBorrow = toDecimal(st.totalBorrow, pool.decimals);
    // InterestRateModel takes and returns utilization in bps (0-10000) and rates as 18-dec
    // per-second figures. Both are normalised to plain fractions here.
    pool.utilization = toDecimal(st.utilization, BPS_DECIMALS);
    pool.supplyRate = toDecimal(st.supplyRate, RATE_DECIMALS);
    pool.borrowRate = toDecimal(st.borrowRate, RATE_DECIMALS);
    pool.updatedAt = timestamp;
    pool.save();
    return true;
}

/**
 * The lending pool a position borrows from, via Position -> Pool.
 *
 * Returns null when either is unindexed, or when the pool's borrow-asset scale is unknown —
 * every caller needs `decimals` to convert an amount, so the three cases collapse into one.
 */
export function positionPool(positionId: string): Pool | null {
    let p = Position.load(positionId);
    if (p == null) return null;
    let pool = Pool.load(p.pool);
    if (pool == null || pool.decimals == UNKNOWN_DECIMALS) return null;
    return pool;
}
