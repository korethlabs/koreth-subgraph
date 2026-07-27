import {BigDecimal, BigInt} from "@graphprotocol/graph-ts";
import {LiquidationExecuted} from "../generated/LiquidationEngine/LiquidationEngine";
import {LiquidationEvent, Position, Market} from "../generated/schema";
import {getOrCreateProtocolStats, toDecimal, POSITION_VALUE_DECIMALS} from "./helpers/common";

// repayAmount is in the position's market borrow asset — resolve its decimals.
function borrowDecimals(positionId: string): i32 {
    let p = Position.load(positionId);
    if (p == null) return 6;
    let m = Market.load(p.market);
    return m == null ? 6 : m.decimals;
}

export function handleLiquidationExecuted(event: LiquidationExecuted): void {
    let id = event.params.positionId.toString();
    let seized = toDecimal(event.params.collateralSeized, POSITION_VALUE_DECIMALS); // 18-dec USD

    let le = new LiquidationEvent(event.transaction.hash.toHex() + "-" + event.logIndex.toString());
    le.position = id;
    le.liquidator = event.params.liquidator;
    le.repayAmount = toDecimal(event.params.repayAmount, borrowDecimals(id)); // borrow asset
    le.collateralSeized = seized;
    le.liquidatorProfit = toDecimal(event.params.liquidatorProfit, POSITION_VALUE_DECIMALS); // always 0
    le.timestamp = event.block.timestamp;
    le.txHash = event.transaction.hash;
    le.save();

    // Reduce the position's collateral and protocol TVL by the seized value (partial liquidation).
    let position = Position.load(id);
    if (position != null) {
        position.depositValue = position.depositValue.minus(seized);
        if (position.depositValue.lt(BigDecimal.zero())) position.depositValue = BigDecimal.zero();
        position.updatedAt = event.block.timestamp;
        position.save();
    }

    let stats = getOrCreateProtocolStats();
    stats.totalLiquidations = stats.totalLiquidations.plus(BigInt.fromI32(1));
    stats.totalTVL = stats.totalTVL.minus(seized);
    if (stats.totalTVL.lt(BigDecimal.zero())) stats.totalTVL = BigDecimal.zero();
    stats.save();
}
