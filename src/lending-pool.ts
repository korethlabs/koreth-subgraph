import {Address, BigDecimal, BigInt, dataSource, log} from "@graphprotocol/graph-ts";
import {InterestAccrued, LendingPool, Supply, Withdraw} from "../generated/templates/LendingPool/LendingPool";
import {Pool, SupplyPosition} from "../generated/schema";
import {syncPoolState} from "./helpers/pool";

// poolId is carried in the data source context (set when the template was created).
function currentPoolId(): string {
    return dataSource.context().getString("poolId");
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
    // Bail on a failed refresh rather than saving: syncSupplyPosition scales the supplier's
    // shares by pool.totalSupply, so a stale value would write a plausible-looking wrong balance.
    if (!syncPoolState(pool, event.block.timestamp)) return;
    syncSupplyPosition(pool, event.params.supplier, event.block.timestamp);
}

export function handleWithdraw(event: Withdraw): void {
    let pool = Pool.load(currentPoolId());
    if (pool == null) return;
    if (!syncPoolState(pool, event.block.timestamp)) return;
    syncSupplyPosition(pool, event.params.supplier, event.block.timestamp);
}

// Interest accrual moves totalSupply, totalBorrow and utilization without any user action, so
// this is what keeps a pool's figures honest between borrows and supplies.
export function handleInterestAccrued(event: InterestAccrued): void {
    let pool = Pool.load(currentPoolId());
    if (pool == null) return;
    syncPoolState(pool, event.block.timestamp);
}
