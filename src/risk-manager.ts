import {BigDecimal, BigInt} from "@graphprotocol/graph-ts";
import {
    RiskManager,
    CollateralConfigSet,
    LPTypeBorrowCapUpdated,
    BorrowRecorded,
    AccrualRecorded,
    RepayRecorded
} from "../generated/RiskManager/RiskManager";
import {CollateralType} from "../generated/schema";
import {getOrCreateProtocolStats, lpTypeName, toDecimal, POSITION_VALUE_DECIMALS} from "./helpers/common";

function getOrCreateCollateralType(lpType: i32): CollateralType {
    let id = lpTypeName(lpType);
    let ct = CollateralType.load(id);
    if (ct == null) {
        ct = new CollateralType(id);
        ct.lpType = lpType;
        ct.maxLtv = BigInt.zero();
        ct.liquidationThreshold = BigInt.zero();
        ct.liquidationBonus = BigInt.zero();
        ct.haircut = BigInt.zero();
        ct.borrowCap = BigInt.zero();
        ct.enabled = false;
        ct.currentBorrows = BigDecimal.zero();
    }
    return ct;
}

// CollateralConfigSet carries only the lpType, so the params have to be read back from the
// contract. That is deliberate on the core side: the struct has six fields and would make an
// expensive event for something that changes rarely.
export function handleCollateralConfigSet(event: CollateralConfigSet): void {
    let lpType = event.params.lpType;
    let ct = getOrCreateCollateralType(lpType);

    let res = RiskManager.bind(event.address).try_getCollateralConfig(lpType);
    if (!res.reverted) {
        ct.maxLtv = res.value.maxLtv;
        ct.liquidationThreshold = res.value.liquidationThreshold;
        ct.liquidationBonus = res.value.liquidationBonus;
        ct.haircut = res.value.haircut;
        ct.borrowCap = res.value.borrowCap;
        ct.enabled = res.value.enabled;
    }
    ct.updatedAt = event.block.timestamp;
    ct.save();
}

// The cap can also be moved on its own, without rewriting the whole config.
export function handleLPTypeBorrowCapUpdated(event: LPTypeBorrowCapUpdated): void {
    let ct = getOrCreateCollateralType(event.params.lpType);
    ct.borrowCap = event.params.cap;
    ct.updatedAt = event.block.timestamp;
    ct.save();
}

// Borrow/Accrual/Repay each carry the per-type USD delta plus the new protocol-wide total, so
// per-type exposure is accumulated here while the global figure is taken as reported.
function applyBorrowDelta(
    lpType: i32,
    amountUsd: BigInt,
    newGlobalBorrows: BigInt,
    timestamp: BigInt,
    isIncrease: boolean
): void {
    let amount = toDecimal(amountUsd, POSITION_VALUE_DECIMALS);
    let ct = getOrCreateCollateralType(lpType);
    ct.currentBorrows = isIncrease ? ct.currentBorrows.plus(amount) : ct.currentBorrows.minus(amount);
    if (ct.currentBorrows.lt(BigDecimal.zero())) ct.currentBorrows = BigDecimal.zero();
    ct.updatedAt = timestamp;
    ct.save();

    let stats = getOrCreateProtocolStats();
    stats.globalBorrowsUsd = toDecimal(newGlobalBorrows, POSITION_VALUE_DECIMALS);
    stats.save();
}

export function handleBorrowRecorded(event: BorrowRecorded): void {
    applyBorrowDelta(
        event.params.lpType,
        event.params.amountUsd,
        event.params.newGlobalBorrows,
        event.block.timestamp,
        true
    );
}

export function handleAccrualRecorded(event: AccrualRecorded): void {
    applyBorrowDelta(
        event.params.lpType,
        event.params.amountUsd,
        event.params.newGlobalBorrows,
        event.block.timestamp,
        true
    );
}

export function handleRepayRecorded(event: RepayRecorded): void {
    applyBorrowDelta(
        event.params.lpType,
        event.params.amountUsd,
        event.params.newGlobalBorrows,
        event.block.timestamp,
        false
    );
}
