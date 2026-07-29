import {BigDecimal, DataSourceContext} from "@graphprotocol/graph-ts";
import {PoolCreated} from "../generated/PoolFactory/PoolFactory";
import {ERC20} from "../generated/PoolFactory/ERC20";
import {LendingPool as LendingPoolTemplate} from "../generated/templates";
import {Pool} from "../generated/schema";
import {poolId} from "./helpers/common";

export function handlePoolCreated(event: PoolCreated): void {
    let pool = new Pool(poolId(event.params.borrowAsset));
    pool.address = event.params.proxy;
    pool.borrowAsset = event.params.borrowAsset;

    // Borrow-asset metadata (decimals/symbol) — read from the token.
    let erc = ERC20.bind(event.params.borrowAsset);
    let dec = erc.try_decimals();
    pool.decimals = dec.reverted ? 18 : dec.value;
    let sym = erc.try_symbol();
    pool.symbol = sym.reverted ? "?" : sym.value;

    // Rates/liquidity are refined by later events; seed with zero at creation.
    pool.totalSupply = BigDecimal.zero();
    pool.totalBorrow = BigDecimal.zero();
    pool.utilization = BigDecimal.zero();
    pool.supplyRate = BigDecimal.zero();
    pool.borrowRate = BigDecimal.zero();
    pool.createdAt = event.block.timestamp;
    pool.updatedAt = event.block.timestamp;
    pool.save();

    // Start indexing this pool proxy's Supply/Withdraw. The context carries the borrow asset
    // because that — not the proxy address — is how Pool entities are keyed.
    let context = new DataSourceContext();
    context.setString("poolId", pool.id);
    LendingPoolTemplate.createWithContext(event.params.proxy, context);
}
