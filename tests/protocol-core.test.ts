import {Address, BigInt, ethereum} from "@graphprotocol/graph-ts";
import {
    afterEach,
    assert,
    beforeEach,
    createMockedFunction,
    clearStore,
    describe,
    newMockEvent,
    test,
} from "matchstick-as/assembly/index";
import {
    LendingPoolRegistered,
    LpPoolRemoved,
    LpPoolWhitelisted,
} from "../generated/ProtocolCore/ProtocolCore";
import {
    handleLendingPoolRegistered,
    handleLpPoolRemoved,
    handleLpPoolWhitelisted,
} from "../src/protocol-core";

// Lowercase throughout. Entity ids come from Address.toHex(), which lowercases, so a
// mixed-case literal here would build an event whose entity is stored under a different key
// than the one the assertions look up — a test failure that looks like a handler bug.
const LP_POOL = "0x1111111111111111111111111111111111111111";
const BORROW_ASSET = "0x2222222222222222222222222222222222222222";
const POOL_PROXY = "0x3333333333333333333333333333333333333333";

const WHITELIST_TS: i32 = 1000;
const REMOVE_TS: i32 = 2000;
const REWHITELIST_TS: i32 = 3000;

function buildLpPoolWhitelisted(pool: string, lpType: i32, timestamp: i32): LpPoolWhitelisted {
    let event = changetype<LpPoolWhitelisted>(newMockEvent());
    event.parameters = new Array<ethereum.EventParam>();
    event.parameters.push(
        new ethereum.EventParam("pool", ethereum.Value.fromAddress(Address.fromString(pool))),
    );
    // The second parameter. Its absence from the manifest is what made this handler match no
    // topic0 and index nothing, so the fixture carries it even though the entity does not.
    event.parameters.push(new ethereum.EventParam("lpType", ethereum.Value.fromI32(lpType)));
    event.block.timestamp = BigInt.fromI32(timestamp);
    return event;
}

function buildLpPoolRemoved(pool: string, timestamp: i32): LpPoolRemoved {
    let event = changetype<LpPoolRemoved>(newMockEvent());
    event.parameters = new Array<ethereum.EventParam>();
    event.parameters.push(
        new ethereum.EventParam("pool", ethereum.Value.fromAddress(Address.fromString(pool))),
    );
    event.block.timestamp = BigInt.fromI32(timestamp);
    return event;
}

function buildLendingPoolRegistered(
    borrowAsset: string,
    poolProxy: string,
    timestamp: i32,
): LendingPoolRegistered {
    let event = changetype<LendingPoolRegistered>(newMockEvent());
    event.parameters = new Array<ethereum.EventParam>();
    event.parameters.push(
        new ethereum.EventParam(
            "borrowAsset",
            ethereum.Value.fromAddress(Address.fromString(borrowAsset)),
        ),
    );
    event.parameters.push(
        new ethereum.EventParam("pool", ethereum.Value.fromAddress(Address.fromString(poolProxy))),
    );
    event.block.timestamp = BigInt.fromI32(timestamp);
    return event;
}

describe("handleLpPoolWhitelisted / handleLpPoolRemoved", () => {
    beforeEach(() => {
        clearStore();
    });

    afterEach(() => {
        clearStore();
    });

    test("whitelisting creates a CollateralPool keyed by the pool address", () => {
        handleLpPoolWhitelisted(buildLpPoolWhitelisted(LP_POOL, 1, WHITELIST_TS));

        assert.entityCount("CollateralPool", 1);
        assert.fieldEquals("CollateralPool", LP_POOL, "address", LP_POOL);
        assert.fieldEquals("CollateralPool", LP_POOL, "whitelisted", "true");
        assert.fieldEquals("CollateralPool", LP_POOL, "whitelistedAt", WHITELIST_TS.toString());
        assert.fieldEquals("CollateralPool", LP_POOL, "removedAt", "null");
    });

    // The entity carries no lpType, deliberately — the schema keeps only the acceptance set,
    // because which DEX a pool belongs to is a question the chain answers better. So the id is
    // the address alone, and two pools of different types are two entities rather than one
    // keyed on a type that is not part of the key.
    test("the id is the pool address alone, independent of lpType", () => {
        handleLpPoolWhitelisted(buildLpPoolWhitelisted(LP_POOL, 1, WHITELIST_TS));
        handleLpPoolWhitelisted(buildLpPoolWhitelisted(POOL_PROXY, 3, WHITELIST_TS));

        assert.entityCount("CollateralPool", 2);
        assert.fieldEquals("CollateralPool", LP_POOL, "whitelisted", "true");
        assert.fieldEquals("CollateralPool", POOL_PROXY, "whitelisted", "true");
    });

    test("removal is soft: the entity survives with a removedAt timestamp", () => {
        handleLpPoolWhitelisted(buildLpPoolWhitelisted(LP_POOL, 1, WHITELIST_TS));
        handleLpPoolRemoved(buildLpPoolRemoved(LP_POOL, REMOVE_TS));

        // Not deleted. A consumer filters on the flag; the row and its whitelistedAt stay.
        assert.entityCount("CollateralPool", 1);
        assert.fieldEquals("CollateralPool", LP_POOL, "whitelisted", "false");
        assert.fieldEquals("CollateralPool", LP_POOL, "removedAt", REMOVE_TS.toString());
        assert.fieldEquals("CollateralPool", LP_POOL, "whitelistedAt", WHITELIST_TS.toString());
    });

    test("re-whitelisting revives the same entity and clears removedAt", () => {
        handleLpPoolWhitelisted(buildLpPoolWhitelisted(LP_POOL, 1, WHITELIST_TS));
        handleLpPoolRemoved(buildLpPoolRemoved(LP_POOL, REMOVE_TS));
        handleLpPoolWhitelisted(buildLpPoolWhitelisted(LP_POOL, 1, REWHITELIST_TS));

        // One entity, not two: the history is not orphaned behind a new id.
        assert.entityCount("CollateralPool", 1);
        assert.fieldEquals("CollateralPool", LP_POOL, "whitelisted", "true");
        assert.fieldEquals("CollateralPool", LP_POOL, "whitelistedAt", REWHITELIST_TS.toString());
        // A stale removal date would read as "removed" to anything looking at the field.
        assert.fieldEquals("CollateralPool", LP_POOL, "removedAt", "null");
    });

    // The fail-closed branch. removeLpPool() requires the pool be whitelisted, so reaching this
    // handler without an entity means the whitelisting was never indexed. Inventing one here
    // would paper over that with a row whose whitelistedAt is a fiction.
    test("removal without a prior whitelisting creates nothing", () => {
        handleLpPoolRemoved(buildLpPoolRemoved(LP_POOL, REMOVE_TS));

        assert.entityCount("CollateralPool", 0);
        assert.notInStore("CollateralPool", LP_POOL);
    });

    // The same branch, guarding the part that would still be wrong if it created nothing: the
    // handler must return rather than throw. A throw is a fatalError, which halts indexing
    // permanently with no resume — the failure this repo trades data loss to avoid.
    test("removal of an unknown pool leaves an existing pool untouched", () => {
        handleLpPoolWhitelisted(buildLpPoolWhitelisted(LP_POOL, 1, WHITELIST_TS));

        handleLpPoolRemoved(buildLpPoolRemoved(BORROW_ASSET, REMOVE_TS));

        assert.entityCount("CollateralPool", 1);
        assert.fieldEquals("CollateralPool", LP_POOL, "whitelisted", "true");
        assert.fieldEquals("CollateralPool", LP_POOL, "removedAt", "null");
    });
});

describe("handleLendingPoolRegistered", () => {
    beforeEach(() => {
        clearStore();
    });

    afterEach(() => {
        clearStore();
    });

    test("decimals are taken from the borrow asset, not assumed", () => {
        createMockedFunction(Address.fromString(BORROW_ASSET), "decimals", "decimals():(uint8)")
            .withArgs([])
            .returns([ethereum.Value.fromI32(6)]);
        createMockedFunction(Address.fromString(BORROW_ASSET), "symbol", "symbol():(string)")
            .withArgs([])
            .returns([ethereum.Value.fromString("USDC")]);

        handleLendingPoolRegistered(
            buildLendingPoolRegistered(BORROW_ASSET, POOL_PROXY, WHITELIST_TS),
        );

        assert.entityCount("Pool", 1);
        // 6, not 18. A pool defaulted to 18 would mis-scale every USDC amount by 1e12.
        assert.fieldEquals("Pool", BORROW_ASSET, "decimals", "6");
        assert.fieldEquals("Pool", BORROW_ASSET, "symbol", "USDC");
        assert.fieldEquals("Pool", BORROW_ASSET, "address", POOL_PROXY);
        assert.fieldEquals("Pool", BORROW_ASSET, "borrowAsset", BORROW_ASSET);
    });

    // The other fail-closed path, and the one that decides whether a wrong number or no number
    // reaches the aggregates. A token whose decimals() reverts can genuinely reach
    // registerLendingPool(), because core never calls decimals() itself.
    test("a reverting decimals() stores the sentinel rather than defaulting to 18", () => {
        createMockedFunction(Address.fromString(BORROW_ASSET), "decimals", "decimals():(uint8)")
            .withArgs([])
            .reverts();
        createMockedFunction(Address.fromString(BORROW_ASSET), "symbol", "symbol():(string)")
            .withArgs([])
            .reverts();

        handleLendingPoolRegistered(
            buildLendingPoolRegistered(BORROW_ASSET, POOL_PROXY, WHITELIST_TS),
        );

        // The entity is still created — Position.pool is a non-nullable reference and must
        // resolve — but it is marked unusable rather than plausible.
        assert.entityCount("Pool", 1);
        assert.fieldEquals("Pool", BORROW_ASSET, "decimals", "-1");
        assert.fieldEquals("Pool", BORROW_ASSET, "symbol", "?");
    });
});
