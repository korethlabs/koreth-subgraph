import {BigDecimal, BigInt, DataSourceContext} from "@graphprotocol/graph-ts";
import {MarketCreated} from "../generated/MarketFactory/MarketFactory";
import {Market as MarketContract} from "../generated/MarketFactory/Market";
import {ERC20} from "../generated/MarketFactory/ERC20";
import {Market as MarketTemplate} from "../generated/templates";
import {Market} from "../generated/schema";
import {lpTypeName} from "./helpers/common";

export function handleMarketCreated(event: MarketCreated): void {
    let market = new Market(event.params.marketId.toString());
    market.address = event.params.proxy;
    market.lpType = lpTypeName(event.params.lpType);
    market.borrowAsset = event.params.borrowAsset;

    // Borrow-asset metadata (decimals/symbol) — read from the token.
    let erc = ERC20.bind(event.params.borrowAsset);
    let dec = erc.try_decimals();
    market.decimals = dec.reverted ? 18 : dec.value;
    let sym = erc.try_symbol();
    market.symbol = sym.reverted ? "?" : sym.value;

    // Rates/liquidity are refined by later events; seed with zero at creation.
    market.totalSupply = BigDecimal.zero();
    market.totalBorrow = BigDecimal.zero();
    market.utilization = BigDecimal.zero();
    market.supplyRate = BigDecimal.zero();
    market.borrowRate = BigDecimal.zero();
    market.createdAt = event.block.timestamp;

    // maxLtv is static config, not in the event — read it from the market proxy.
    let cfg = MarketContract.bind(event.params.proxy).try_getConfig();
    market.maxLtv = cfg.reverted ? BigInt.zero() : cfg.value.maxLtv;

    market.save();

    // Start indexing this market proxy's Supply/Withdraw, carrying the marketId in context.
    let context = new DataSourceContext();
    context.setString("marketId", event.params.marketId.toString());
    MarketTemplate.createWithContext(event.params.proxy, context);
}
