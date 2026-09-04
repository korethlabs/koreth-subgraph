#!/usr/bin/env node
// Download (once) and run the matchstick test binary.
//
// This exists instead of `graph test` because that command is broken in graph-cli 0.93.3: it
// resolves binary-install ^1.1.0, whose install() pipes the download through `tar.x`, while
// matchstick publishes its releases as bare executables. Every invocation dies with
// "TAR_BAD_ARCHIVE: Unrecognized archive format" before a single test compiles — on every
// platform, so this is not a local quirk that CI would escape. The same version mismatch also
// makes `graph test` forward its own subcommand name to the binary as a test filter.
//
// Duplicating graph-cli's platform selection is acceptable here in a way that duplicating, say,
// ABI extraction would not be: there is no source of truth being copied that could drift out from
// under us, and the failure mode of getting it wrong is a 404 at download time rather than a
// plausible-looking wrong answer.
import {chmodSync, existsSync, mkdirSync, renameSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {arch, platform} from "node:os";

// Pinned, not "latest": the binary and the matchstick-as library in devDependencies are two
// halves of one tool and have to agree. Bump them together.
const VERSION = "0.6.0";

// SHA-256 of each release asset, checked before the download is ever made executable. A release
// asset is mutable — the tag pins which file is requested, not what that file contains — so
// without this the CI runner fetches an attacker-controlled executable and runs it with the
// repository checked out.
//
// The check is unconditional on purpose. An integrity check behind an opt-in env var is off
// exactly when it matters, which buys nothing beyond the appearance of having one.
//
// To bump: change VERSION, run the script, and take the hashes from the mismatch errors — but
// only after confirming the release is the one you expect. A hash copied from whatever arrived
// is a record of what was downloaded, not a check on it.
const SHA256 = {
    "binary-linux-22": "e11131536716f2a6daaa242beb7c3f89784017ba2a73128fcf80027296e80c85",
    "binary-macos-12-m1": "cd05611b588649e629e42e4ea0915d811d1ddbb73e8edd392a718c81b4361dbd",
    "binary-macos-12": "b6799d0548afeefb1b992f591ac11b76205df6843891a4563702531f788e4c78",
};

const here = dirname(fileURLToPath(import.meta.url));
const subgraphRoot = join(here, "..");
const cacheDir = join(subgraphRoot, "node_modules", ".matchstick");

function assetName() {
    const p = platform();
    const a = arch();
    if (p === "linux" && a === "x64") return "binary-linux-22";
    if (p === "darwin" && a === "arm64") return "binary-macos-12-m1";
    if (p === "darwin" && a === "x64") return "binary-macos-12";
    // Named rather than guessed. A wrong asset either fails to execute or, worse, runs and
    // reports results from a build for another platform.
    throw new Error(`No matchstick ${VERSION} release for ${p}/${a}. Run the tests in CI or Docker.`);
}

const asset = assetName();
// A platform added above but not to SHA256 would otherwise reach the comparison with an
// undefined expectation and fail with a confusing message. Say which of the two is missing.
if (!SHA256[asset]) throw new Error(`No pinned sha256 for ${asset} — add it to SHA256 before use.`);

const binaryPath = join(cacheDir, `${asset}-${VERSION}`);

if (!existsSync(binaryPath)) {
    const url = `https://github.com/LimeChain/matchstick/releases/download/${VERSION}/${asset}`;
    console.error(`Downloading matchstick ${VERSION} (${asset})...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText} for ${url}`);
    mkdirSync(cacheDir, {recursive: true});
    // Written to a temp name and renamed, so an interrupted download cannot leave a truncated
    // file that every later run treats as already installed.
    const partial = `${binaryPath}.partial`;
    const bytes = Buffer.from(await res.arrayBuffer());

    const expected = SHA256[asset];
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) {
        // Nothing is written and nothing is made executable: the bad bytes never reach a path
        // that a later run would treat as an installed binary.
        throw new Error(
            `matchstick ${VERSION} (${asset}) failed its integrity check.\n` +
                `  expected sha256 ${expected}\n` +
                `  actual   sha256 ${actual}\n` +
                `Refusing to execute it.`,
        );
    }

    writeFileSync(partial, bytes);
    chmodSync(partial, 0o755);
    // Renamed only after the hash matches, so an interrupted or tampered download cannot leave a
    // file that every later run skips re-verifying.
    renameSync(partial, binaryPath);
}

// Forward argv so `npm run test -- <datasource>` still filters, and propagate the exit code —
// matchstick returns 1 when a test fails, which is what makes this usable as a CI gate.
const result = spawnSync(binaryPath, process.argv.slice(2), {cwd: subgraphRoot, stdio: "inherit"});
if (result.error) throw result.error;
process.exit(result.status === null ? 1 : result.status);
