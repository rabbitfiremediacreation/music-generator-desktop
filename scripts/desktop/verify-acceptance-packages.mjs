import assert from "node:assert/strict";
import path from "node:path";
import { releaseTargets, validateAssets } from "./release-assets.mjs";

const [tag, directory, ...extra] = process.argv.slice(2);
assert(tag && directory && extra.length === 0,
  "Usage: node scripts/desktop/verify-acceptance-packages.mjs <package-version-tag> <artifact-root>");

// Read extracted platform artifacts using the same file and checksum rules as release publishing.
// Print the inventory only after all platform artifacts have passed.
const packages = [];
for (const target of releaseTargets) {
  try {
    const assets = await validateAssets(tag, target, path.join(directory, `Music-Generator-${target}`));
    for (const { name, digest } of assets.filter(asset => !asset.name.endsWith(".sha256"))) {
      packages.push({ target, name, sha256: digest.slice("sha256:".length) });
    }
  } catch (error) {
    throw new Error(`Invalid ${target} artifact: ${error.message}`, { cause: error });
  }
}

console.log(JSON.stringify({ packageVersion: tag.slice(1), packages }, null, 2));
