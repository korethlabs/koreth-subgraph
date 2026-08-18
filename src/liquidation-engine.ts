import {BigDecimal, BigInt, log} from "@graphprotocol/graph-ts";
import {LiquidationExecuted} from "../generated/LiquidationEngine/LiquidationEngine";
import {LiquidationEvent, Position} from "../generated/schema";
import {getOrCreateProtocolStats, toDecimal, POSITION_VALUE_DECIMALS} from "./helpers/common";
import {positionPool, syncPoolState} from "./helpers/pool";

export function handleLiquidationExecuted(event: LiquidationExecuted): void {
    let id = event.params.positionId.toString();
    let seized = toDecimal(event.params.collateralSeized, POSITION_VALUE_DECIMALS); // 18-dec USD

    // Only repayAmount is denominated in the borrow asset. The collateral figures below are
    // 18-dec oracle USD and the liquidation count is scale-free, so an unresolvable pool costs
    // us the LiquidationEvent — not TVL, which would otherwise drift permanently upward.
    let pool = positionPool(id);
    if (pool != null) {
        let le = new LiquidationEvent(event.transaction.hash.toHex() + "-" + event.logIndex.toString());
        le.position = id;
        le.liquidator = event.params.liquidator;
        le.repayAmount = toDecimal(event.params.repayAmount, pool.decimals); // borrow asset
        le.collateralSeized = seized;
        le.timestamp = event.block.timestamp;
        le.txHash = event.transaction.hash;
        le.save();
    } else {
        log.error(
            "LiquidationExecuted: cannot resolve pool or borrow-asset scale for position {} — LiquidationEvent skipped",
            [id],
        );
    }

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

    // The repay leg moved the pool's totalBorrow and rates.
    if (pool != null) syncPoolState(pool, event.block.timestamp);
}
