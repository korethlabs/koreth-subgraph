import {Address, BigDecimal, BigInt} from "@graphprotocol/graph-ts";
import {
    PositionCreated,
    PositionClosed,
    PositionLiquidated,
    PositionManager
} from "../generated/PositionManager/PositionManager";
import {Position} from "../generated/schema";
import {getOrCreateProtocolStats, lpTypeName, toDecimal, POSITION_VALUE_DECIMALS} from "./helpers/common";

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

    // Enrich pool/token0/token1/amount/marketId from the on-chain struct
    // (PositionCreated does not carry them).
    let pm = PositionManager.bind(event.address);
    let res = pm.try_getPosition(event.params.positionId);
    if (!res.reverted) {
        position.pool = res.value.pool;
        position.token0 = res.value.token0;
        position.token1 = res.value.token1;
        position.amount = res.value.amount;
        position.market = res.value.marketId.toString();
    } else {
        // Satisfy non-null schema fields if the call ever reverts.
        position.pool = Address.zero();
        position.token0 = Address.zero();
        position.token1 = Address.zero();
        position.market = "0";
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

export function handlePositionLiquidated(event: PositionLiquidated): void {
    let position = Position.load(event.params.positionId.toString());
    if (position != null) {
        let stats = getOrCreateProtocolStats();
        stats.totalTVL = stats.totalTVL.minus(position.depositValue);
        stats.save();

        position.status = "liquidated";
        position.updatedAt = event.block.timestamp;
        position.save();
    }
}
