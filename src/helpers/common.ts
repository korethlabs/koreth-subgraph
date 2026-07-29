import {Address, BigDecimal, BigInt} from "@graphprotocol/graph-ts";
import {Pool, Position, ProtocolStats} from "../../generated/schema";

// Oracle position values and RiskManager's USD exposure figures are both 18-dec.
export const POSITION_VALUE_DECIMALS: u8 = 18;

// Pool entities are keyed by borrow asset. Everything that resolves a pool (PositionCreated,
// DebtWrittenOff, the template context) goes through here so the casing can never diverge.
export function poolId(borrowAsset: Address): string {
    return borrowAsset.toHex();
}

// ILPAdapter.LPType enum order (see src/interfaces/ILPAdapter.sol)
export function lpTypeName(lpType: i32): string {
    if (lpType == 0) return "UniswapV2";
    if (lpType == 1) return "UniswapV3";
    if (lpType == 2) return "Curve";
    if (lpType == 3) return "Aerodrome";
    if (lpType == 4) return "PancakeSwapV2";
    if (lpType == 5) return "PancakeSwapV3";
    return "Unknown";
}

export function exponentToBigDecimal(decimals: i32): BigDecimal {
    let bd = BigDecimal.fromString("1");
    let ten = BigDecimal.fromString("10");
    for (let i = 0; i < decimals; i++) {
        bd = bd.times(ten);
    }
    return bd;
}

// Scale a raw integer amount to a human-readable BigDecimal.
export function toDecimal(value: BigInt, decimals: i32): BigDecimal {
    return value.toBigDecimal().div(exponentToBigDecimal(decimals));
}

// Borrow/repay/liquidation amounts are denominated in the borrow asset of the position's pool,
// so their scale can only be resolved by hopping Position -> Pool. Falls back to 6 (USDC) if
// either is missing, which can only happen if an event is indexed before its pool was created.
export function borrowDecimals(positionId: string): i32 {
    let p = Position.load(positionId);
    if (p == null) return 6;
    let pool = Pool.load(p.pool);
    return pool == null ? 6 : pool.decimals;
}

export function getOrCreateProtocolStats(): ProtocolStats {
    let stats = ProtocolStats.load("1");
    if (stats == null) {
        stats = new ProtocolStats("1");
        stats.totalTVL = BigDecimal.zero();
        stats.totalBorrowed = BigDecimal.zero();
        stats.totalPositions = BigInt.zero();
        stats.totalLiquidations = BigInt.zero();
        stats.totalFeesCollected = BigDecimal.zero();
        stats.globalBorrowsUsd = BigDecimal.zero();
    }
    return stats;
}
