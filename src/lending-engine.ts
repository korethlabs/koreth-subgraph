import {BigDecimal} from "@graphprotocol/graph-ts";
import {Borrowed, Repaid, DebtWrittenOff} from "../generated/LendingEngine/LendingEngine";
import {BorrowEvent, RepayEvent, DebtWriteOffEvent, Position} from "../generated/schema";
import {borrowDecimals, getOrCreateProtocolStats, poolId, toDecimal} from "./helpers/common";

export function handleBorrowed(event: Borrowed): void {
    let id = event.params.positionId.toString();
    let dec = borrowDecimals(id);
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

    let stats = getOrCreateProtocolStats();
    stats.totalBorrowed = stats.totalBorrowed.plus(amount);
    stats.save();
}

export function handleRepaid(event: Repaid): void {
    let id = event.params.positionId.toString();
    let dec = borrowDecimals(id);
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

    let stats = getOrCreateProtocolStats();
    stats.totalBorrowed = stats.totalBorrowed.minus(amount);
    if (stats.totalBorrowed.lt(BigDecimal.zero())) {
        stats.totalBorrowed = BigDecimal.zero();
    }
    stats.save();
}

// Bad-debt socialization: LiquidationEngine writes off a position's full remaining debt,
// zeroing its debt and recording a deficit on the shared pool. Mirror that here — clear
// currentDebt and remove the written-off amount from protocol totalBorrowed.
export function handleDebtWrittenOff(event: DebtWrittenOff): void {
    let id = event.params.positionId.toString();
    let dec = borrowDecimals(id);
    let amount = toDecimal(event.params.amount, dec);

    let wo = new DebtWriteOffEvent(event.transaction.hash.toHex() + "-" + event.logIndex.toString());
    wo.position = id;
    wo.pool = poolId(event.params.borrowAsset);
    wo.amount = amount;
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

    let stats = getOrCreateProtocolStats();
    stats.totalBorrowed = stats.totalBorrowed.minus(amount);
    if (stats.totalBorrowed.lt(BigDecimal.zero())) {
        stats.totalBorrowed = BigDecimal.zero();
    }
    stats.save();
}
