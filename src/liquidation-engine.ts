import {BigDecimal, BigInt, log} from "@graphprotocol/graph-ts";
import {LiquidationExecuted} from "../generated/LiquidationEngine/LiquidationEngine";
import {LiquidationEvent, Position} from "../generated/schema";
import {borrowDecimals, getOrCreateProtocolStats, toDecimal, POSITION_VALUE_DECIMALS} from "./helpers/common";

export function handleLiquidationExecuted(event: LiquidationExecuted): void {
    let id = event.params.positionId.toString();
    let seized = toDecimal(event.params.collateralSeized, POSITION_VALUE_DECIMALS); // 18-dec USD

    let dec = borrowDecimals(id);
    if (dec < 0) {
        log.error("LiquidationExecuted: cannot resolve borrow-asset decimals for position {} — event skipped", [id]);
        return;
    }

    let le = new LiquidationEvent(event.transaction.hash.toHex() + "-" + event.logIndex.toString());
    le.position = id;
    le.liquidator = event.params.liquidator;
    le.repayAmount = toDecimal(event.params.repayAmount, dec); // borrow asset
    le.collateralSeized = seized;
    le.liquidatorProfit = toDecimal(event.params.liquidatorProfit, POSITION_VALUE_DECIMALS); // always 0
    le.timestamp = event.block.timestamp;
    le.txHash = event.transaction.hash;
    le.save();

    let stats = getOrCreateProtocolStats();
    stats.totalLiquidations = stats.totalLiquidations.plus(BigInt.fromI32(1));

    // On a full liquidation, markLiquidated() already fired PositionLiquidated earlier in this
    // same transaction and removed the position's entire depositValue from TVL. Subtracting the
    // seized value again here would double-count it. Only the partial path — where the position
    // survives with collateral above dust and no PositionLiquidated is emitted — adjusts here.
    let position = Position.load(id);
    if (position != null && position.status != "liquidated") {
        position.depositValue = position.depositValue.minus(seized);
        if (position.depositValue.lt(BigDecimal.zero())) position.depositValue = BigDecimal.zero();
        position.updatedAt = event.block.timestamp;
        position.save();

        stats.totalTVL = stats.totalTVL.minus(seized);
        if (stats.totalTVL.lt(BigDecimal.zero())) stats.totalTVL = BigDecimal.zero();
    }
    stats.save();
}
