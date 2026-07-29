import {BigDecimal, log} from "@graphprotocol/graph-ts";
import {Borrowed, Repaid, DebtWrittenOff} from "../generated/LendingEngine/LendingEngine";
import {BorrowEvent, RepayEvent, DebtWriteOffEvent, Pool, Position} from "../generated/schema";
import {poolId, toDecimal, UNKNOWN_DECIMALS} from "./helpers/common";
import {positionPool, syncPoolState} from "./helpers/pool";

export function handleBorrowed(event: Borrowed): void {
    let id = event.params.positionId.toString();
    let pool = positionPool(id);
    if (pool == null) {
        log.error("Borrowed: cannot resolve pool or borrow-asset scale for position {} — event skipped", [id]);
        return;
    }
    let dec = pool.decimals;
    let amount = toDecimal(event.params.amount, dec);
    let totalDebt = toDecimal(event.params.totalDebt, dec);

    let be = new BorrowEvent(event.transaction.hash.toHex() + "-" + event.logIndex.toString());
    be.position = id;
    be.borrower = event.params.borrower;
    be.amount = amount;
    be.totalDebt = totalDebt;
    be.timestamp = event.block.timestamp;
    be.txHash = event.transaction.hash;
    be.save();

    let position = Position.load(id);
    if (position != null) {
        position.currentDebt = totalDebt;
        position.status = "borrowed";
        position.updatedAt = event.block.timestamp;
        position.save();
    }

    syncPoolState(pool, event.block.timestamp);
}

export function handleRepaid(event: Repaid): void {
    let id = event.params.positionId.toString();
    let pool = positionPool(id);
    if (pool == null) {
        log.error("Repaid: cannot resolve pool or borrow-asset scale for position {} — event skipped", [id]);
        return;
    }
    let dec = pool.decimals;
    let amount = toDecimal(event.params.amount, dec);
    let remainingDebt = toDecimal(event.params.remainingDebt, dec);

    let re = new RepayEvent(event.transaction.hash.toHex() + "-" + event.logIndex.toString());
    re.position = id;
    re.repayer = event.params.repayer;
    re.amount = amount;
    re.remainingDebt = remainingDebt;
    re.timestamp = event.block.timestamp;
    re.txHash = event.transaction.hash;
    re.save();

    let position = Position.load(id);
    if (position != null) {
        position.currentDebt = remainingDebt;
        if (event.params.remainingDebt.isZero()) {
            position.status = "active";
        }
        position.updatedAt = event.block.timestamp;
        position.save();
    }

    syncPoolState(pool, event.block.timestamp);
}

// Bad-debt socialization: LiquidationEngine writes off a position's full remaining debt,
// zeroing its debt and recording a deficit on the shared pool.
export function handleDebtWrittenOff(event: DebtWrittenOff): void {
    let id = event.params.positionId.toString();

    // Unlike Borrowed/Repaid, this event names the borrow asset directly, so the pool resolves
    // without the Position -> Pool hop.
    let pId = poolId(event.params.borrowAsset);
    let pool = Pool.load(pId);
    if (pool == null || pool.decimals == UNKNOWN_DECIMALS) {
        log.error("DebtWrittenOff: no indexed pool, or unknown scale, for borrow asset {} — event skipped", [
            event.params.borrowAsset.toHex(),
        ]);
        return;
    }

    let wo = new DebtWriteOffEvent(event.transaction.hash.toHex() + "-" + event.logIndex.toString());
    wo.position = id;
    wo.pool = pId;
    wo.amount = toDecimal(event.params.amount, pool.decimals);
    wo.caller = event.params.caller;
    wo.timestamp = event.block.timestamp;
    wo.txHash = event.transaction.hash;
    wo.save();

    let position = Position.load(id);
    if (position != null) {
        position.currentDebt = BigDecimal.zero();
        position.updatedAt = event.block.timestamp;
        position.save();
    }

    syncPoolState(pool, event.block.timestamp);
}
