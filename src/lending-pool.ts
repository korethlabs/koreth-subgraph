import {Address, BigDecimal, BigInt, dataSource, log} from "@graphprotocol/graph-ts";
import {InterestAccrued, LendingPool, Supply, Withdraw} from "../generated/templates/LendingPool/LendingPool";
import {Pool, SupplyPosition} from "../generated/schema";
import {BPS_DECIMALS, RATE_DECIMALS, toDecimal, UNKNOWN_DECIMALS} from "./helpers/common";

// poolId is carried in the data source context (set when the template was created).
function currentPoolId(): string {
    return dataSource.context().getString("poolId");
}

/**
 * Refresh the pool's liquidity and rate fields from the contract.
 *
 * These are read rather than accumulated, deliberately. accrueInterest() credits lenders by
 * mutating totalSupply directly and emits only InterestAccrued, while withdraw() emits an
 * `amount` that already includes the withdrawer's share of that interest. An
 * add-principal / subtract-principal-plus-interest accumulator therefore ratchets downwards
 * and converges to zero on a pool that is in fact fully funded. Reading getPoolState() makes
 * all five fields self-correcting, at the cost of one eth_call per pool event.
 */
function syncPoolState(pool: Pool, timestamp: BigInt): void {
    // Scale unknown (decimals() reverted at registration) — totalSupply/totalBorrow cannot be
    // converted to human units, and the rate fields are meaningless without them.
    if (pool.decimals == UNKNOWN_DECIMALS) {
        log.error("syncPoolState: pool {} has unknown borrow-asset scale — state not indexed", [pool.id]);
        return;
    }
    let res = LendingPool.bind(Address.fromBytes(pool.address)).try_getPoolState();
    if (res.reverted) {
        log.error("syncPoolState: getPoolState() reverted for pool {}", [pool.id]);
        return;
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
}

/**
 * Rewrite a supplier's position from the pool's own share accounting.
 *
 * `shares` is authoritative on-chain, and the redeemable value is shares * totalSupply /
 * totalShares — which tracks accrued interest for free. Accumulating the Supply/Withdraw
 * `amount` params instead would report principal only, and would drift permanently once
 * interest accrues. Note totalShares includes the DEAD_SHARES minted on first supply, which is
 * exactly what makes this ratio correct.
 */
function syncSupplyPosition(pool: Pool, supplier: Address, timestamp: BigInt): void {
    let bound = LendingPool.bind(Address.fromBytes(pool.address));
    let sharesRes = bound.try_shares(supplier);
    let totalSharesRes = bound.try_totalShares();
    if (sharesRes.reverted || totalSharesRes.reverted) {
        log.error("syncSupplyPosition: share reads reverted for pool {} supplier {}", [
            pool.id,
            supplier.toHex(),
        ]);
        return;
    }

    let id = pool.id + "-" + supplier.toHex();
    let sp = SupplyPosition.load(id);
    if (sp == null) {
        sp = new SupplyPosition(id);
        sp.pool = pool.id;
        sp.user = supplier;
    }
    sp.shares = sharesRes.value;
    sp.suppliedAmount = totalSharesRes.value.isZero()
        ? BigDecimal.zero()
        : pool.totalSupply.times(sharesRes.value.toBigDecimal()).div(totalSharesRes.value.toBigDecimal());
    sp.updatedAt = timestamp;
    sp.save();
}

export function handleSupply(event: Supply): void {
    let pool = Pool.load(currentPoolId());
    if (pool == null) return;
    syncPoolState(pool, event.block.timestamp);
    pool.save();
    syncSupplyPosition(pool, event.params.supplier, event.block.timestamp);
}

export function handleWithdraw(event: Withdraw): void {
    let pool = Pool.load(currentPoolId());
    if (pool == null) return;
    syncPoolState(pool, event.block.timestamp);
    pool.save();
    syncSupplyPosition(pool, event.params.supplier, event.block.timestamp);
}

// Interest accrual moves totalSupply, totalBorrow and utilization without any user action, so
// this is the only event that keeps a quiet pool's figures honest.
export function handleInterestAccrued(event: InterestAccrued): void {
    let pool = Pool.load(currentPoolId());
    if (pool == null) return;
    syncPoolState(pool, event.block.timestamp);
    pool.save();
}
