import {BigDecimal, BigInt} from "@graphprotocol/graph-ts";
import {CollateralType} from "../../generated/schema";
import {lpTypeName} from "./common";

/**
 * Load a collateral type, or seed one with zeroed risk params.
 *
 * Does not save — callers set `updatedAt` and persist, since what they know about the entity
 * differs (RiskManager has real config, PositionManager only knows the type exists).
 *
 * The seeded defaults read as "disabled, zero LTV", which is the fail-closed direction: a
 * consumer that filters on `enabled` skips it rather than lending against unknown risk params.
 */
export function getOrCreateCollateralType(lpType: i32): CollateralType {
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
