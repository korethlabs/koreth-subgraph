import {Address, BigDecimal, BigInt} from "@graphprotocol/graph-ts";
import {
    PositionCreated,
    PositionClosed,
    PositionLiquidated,
    PositionManager
} from "../generated/PositionManager/PositionManager";
import {Position} from "../generated/schema";
import {getOrCreateProtocolStats, lpTypeName, poolId, toDecimal, POSITION_VALUE_DECIMALS} from "./helpers/common";

export function handlePositionCreated(event: PositionCreated): void {
    let id = event.params.positionId.toString();
    let position = new Position(id);
    position.owner = event.params.owner;
    position.lpToken = event.params.lpToken;
    position.tokenId = event.params.tokenId;
    position.amount = BigInt.zero();
    position.lpType = lpTypeName(event.params.lpType);
    position.depositValue = toDecimal(event.params.value, POSITION_VALUE_DECIMALS);
    position.currentDebt = BigDecimal.zero();
    position.status = "active";
    position.depositTimestamp = event.block.timestamp;
    position.updatedAt = event.block.timestamp;

    // Both protocol-side links come straight off the event: the shared pool is identified by
    // its borrow asset, and risk params are keyed by LP type.
    position.pool = poolId(event.params.borrowAsset);
    position.collateralType = lpTypeName(event.params.lpType);

    // The AMM-side fields still need the on-chain struct — PositionCreated does not carry them.
    let pm = PositionManager.bind(event.address);
    let res = pm.try_getPosition(event.params.positionId);
    if (!res.reverted) {
        position.lpPool = res.value.pool;
        position.token0 = res.value.token0;
        position.token1 = res.value.token1;
        position.amount = res.value.amount;
    } else {
        // Satisfy non-null schema fields if the call ever reverts.
        position.lpPool = Address.zero();
        position.token0 = Address.zero();
        position.token1 = Address.zero();
    }
    position.save();

    let stats = getOrCreateProtocolStats();
    stats.totalPositions = stats.totalPositions.plus(BigInt.fromI32(1));
    stats.totalTVL = stats.totalTVL.plus(position.depositValue);
    stats.save();
}

export function handlePositionClosed(event: PositionClosed): void {
    let position = Position.load(event.params.positionId.toString());
    if (position != null) {
        let stats = getOrCreateProtocolStats();
        stats.totalTVL = stats.totalTVL.minus(position.depositValue);
        stats.save();

        position.status = "closed";
        position.currentDebt = BigDecimal.zero();
        position.updatedAt = event.block.timestamp;
        position.save();
    }
}

// Emitted by markLiquidated(), which LiquidationEngine only calls when the position is being
// wound up entirely — the seized collateral goes to the liquidator and any remainder is returned
// to the borrower. So the whole remaining depositValue leaves the protocol here.
//
// This fires BEFORE LiquidationExecuted in the same transaction. handleLiquidationExecuted
// therefore checks for this status and skips its own TVL adjustment, otherwise the seized
// portion would be subtracted twice.
export function handlePositionLiquidated(event: PositionLiquidated): void {
    let position = Position.load(event.params.positionId.toString());
    if (position != null) {
        let stats = getOrCreateProtocolStats();
        stats.totalTVL = stats.totalTVL.minus(position.depositValue);
        if (stats.totalTVL.lt(BigDecimal.zero())) stats.totalTVL = BigDecimal.zero();
        stats.save();

        position.depositValue = BigDecimal.zero();
        position.status = "liquidated";
        position.updatedAt = event.block.timestamp;
        position.save();
    }
}
