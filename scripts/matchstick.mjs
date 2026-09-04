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
import {spawnSync} from "node:child_process";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {arch, platform} from "node:os";

// Pinned, not "latest": the binary and the matchstick-as library in devDependencies are two
// halves of one tool and have to agree. Bump them together.
const VERSION = "0.6.0";

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
    writeFileSync(partial, Buffer.from(await res.arrayBuffer()));
    chmodSync(partial, 0o755);
    renameSync(partial, binaryPath);
}

// Forward argv so `npm run test -- <datasource>` still filters, and propagate the exit code —
// matchstick returns 1 when a test fails, which is what makes this usable as a CI gate.
const result = spawnSync(binaryPath, process.argv.slice(2), {cwd: subgraphRoot, stdio: "inherit"});
if (result.error) throw result.error;
process.exit(result.status === null ? 1 : result.status);
