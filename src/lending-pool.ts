import {BigDecimal, BigInt, dataSource} from "@graphprotocol/graph-ts";
import {Supply, Withdraw} from "../generated/templates/LendingPool/LendingPool";
import {Pool, SupplyPosition} from "../generated/schema";
import {toDecimal} from "./helpers/common";

// poolId is carried in the data source context (set when the template was created).
function currentPoolId(): string {
    return dataSource.context().getString("poolId");
}

export function handleSupply(event: Supply): void {
    let pId = currentPoolId();
    let pool = Pool.load(pId);
    if (pool == null) return;

    let amount = toDecimal(event.params.amount, pool.decimals);
    pool.totalSupply = pool.totalSupply.plus(amount);
    pool.updatedAt = event.block.timestamp;
    pool.save();

    let id = pId + "-" + event.params.supplier.toHex();
    let sp = SupplyPosition.load(id);
    if (sp == null) {
        sp = new SupplyPosition(id);
        sp.pool = pId;
        sp.user = event.params.supplier;
        sp.shares = BigInt.zero();
        sp.suppliedAmount = BigDecimal.zero();
    }
    sp.shares = sp.shares.plus(event.params.shares);
    sp.suppliedAmount = sp.suppliedAmount.plus(amount);
    sp.updatedAt = event.block.timestamp;
    sp.save();
}

export function handleWithdraw(event: Withdraw): void {
    let pId = currentPoolId();
    let pool = Pool.load(pId);
    if (pool == null) return;

    let amount = toDecimal(event.params.amount, pool.decimals);
    pool.totalSupply = pool.totalSupply.minus(amount);
    if (pool.totalSupply.lt(BigDecimal.zero())) pool.totalSupply = BigDecimal.zero();
    pool.updatedAt = event.block.timestamp;
    pool.save();

    let id = pId + "-" + event.params.supplier.toHex();
    let sp = SupplyPosition.load(id);
    if (sp == null) return;
    sp.shares = sp.shares.minus(event.params.shares);
    if (sp.shares.lt(BigInt.zero())) sp.shares = BigInt.zero();
    sp.suppliedAmount = sp.suppliedAmount.minus(amount);
    if (sp.suppliedAmount.lt(BigDecimal.zero())) sp.suppliedAmount = BigDecimal.zero();
    sp.updatedAt = event.block.timestamp;
    sp.save();
}
