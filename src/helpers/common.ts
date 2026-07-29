import {Address, BigDecimal, BigInt} from "@graphprotocol/graph-ts";
import {ProtocolStats} from "../../generated/schema";

// Oracle position values and RiskManager's USD exposure figures are both 18-dec.
export const POSITION_VALUE_DECIMALS: u8 = 18;

// InterestRateModel expresses utilization and risk params in basis points, and per-second
// interest rates as 18-dec fixed point.
export const BPS_DECIMALS: u8 = 4;
export const RATE_DECIMALS: u8 = 18;

/**
 * Pool.decimals when the borrow asset's decimals() reverted.
 *
 * There is deliberately no default. Pools exist per borrow asset, so DAI/WETH pools are 18-dec
 * while USDC/USDT are 6-dec: guessing is wrong by a factor of 1e12, and these amounts feed the
 * protocol-wide ProtocolStats aggregates, so one bad guess corrupts a global figure rather than
 * just its own subtree. positionPool() folds this into a null, and callers skip the event.
 */
export const UNKNOWN_DECIMALS: i32 = -1;

// Pool entities are keyed by borrow asset. Everything that resolves a pool (PositionCreated,
// DebtWrittenOff, the template context) goes through here so the casing can never diverge.
export function poolId(borrowAsset: Address): string {
    return borrowAsset.toHex();
}

// ILPAdapter.LPType enum order (see src/interfaces/ILPAdapter.sol).
// This doubles as the CollateralType entity id, so the fallback keeps the numeric value: if core
// adds a seventh LP type before the subgraph is redeployed, a bare "Unknown" would merge every
// unrecognised type into one entity and scramble its risk params and currentBorrows.
export function lpTypeName(lpType: i32): string {
    if (lpType == 0) return "UniswapV2";
    if (lpType == 1) return "UniswapV3";
    if (lpType == 2) return "Curve";
    if (lpType == 3) return "Aerodrome";
    if (lpType == 4) return "PancakeSwapV2";
    if (lpType == 5) return "PancakeSwapV3";
    return "Unknown-" + lpType.toString();
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
        stats.totalPositions = BigInt.zero();
        stats.totalLiquidations = BigInt.zero();
        stats.totalFeesCollected = BigDecimal.zero();
        stats.globalBorrowsUsd = BigDecimal.zero();
    }
    return stats;
}
