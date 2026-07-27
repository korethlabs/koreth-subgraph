import {BigDecimal, BigInt} from "@graphprotocol/graph-ts";
import {ProtocolStats} from "../../generated/schema";

// Oracle position values are 18-dec USD; the borrow asset on the seeded market is USDC (6-dec).
export const POSITION_VALUE_DECIMALS: u8 = 18;
export const BORROW_DECIMALS: u8 = 6;

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

export function getOrCreateProtocolStats(): ProtocolStats {
    let stats = ProtocolStats.load("1");
    if (stats == null) {
        stats = new ProtocolStats("1");
        stats.totalTVL = BigDecimal.zero();
        stats.totalBorrowed = BigDecimal.zero();
        stats.totalPositions = BigInt.zero();
        stats.totalLiquidations = BigInt.zero();
        stats.totalFeesCollected = BigDecimal.zero();
    }
    return stats;
}
