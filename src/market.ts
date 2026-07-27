import {BigDecimal, BigInt, dataSource} from "@graphprotocol/graph-ts";
import {Supply, Withdraw} from "../generated/templates/Market/Market";
import {Market, SupplyPosition} from "../generated/schema";
import {toDecimal} from "./helpers/common";

// marketId is carried in the data source context (set when the template was created).
function currentMarketId(): string {
    return dataSource.context().getString("marketId");
}

export function handleSupply(event: Supply): void {
    let mId = currentMarketId();
    let market = Market.load(mId);
    if (market == null) return;

    let amount = toDecimal(event.params.amount, market.decimals);
    market.totalSupply = market.totalSupply.plus(amount);
    market.save();

    let id = mId + "-" + event.params.supplier.toHex();
    let sp = SupplyPosition.load(id);
    if (sp == null) {
        sp = new SupplyPosition(id);
        sp.market = mId;
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
    let mId = currentMarketId();
    let market = Market.load(mId);
    if (market == null) return;

    let amount = toDecimal(event.params.amount, market.decimals);
    market.totalSupply = market.totalSupply.minus(amount);
    if (market.totalSupply.lt(BigDecimal.zero())) market.totalSupply = BigDecimal.zero();
    market.save();

    let id = mId + "-" + event.params.supplier.toHex();
    let sp = SupplyPosition.load(id);
    if (sp == null) return;
    sp.shares = sp.shares.minus(event.params.shares);
    if (sp.shares.lt(BigInt.zero())) sp.shares = BigInt.zero();
    sp.suppliedAmount = sp.suppliedAmount.minus(amount);
    if (sp.suppliedAmount.lt(BigDecimal.zero())) sp.suppliedAmount = BigDecimal.zero();
    sp.updatedAt = event.block.timestamp;
    sp.save();
}
