import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { applicationVersions, sha256, validateAssets, validateReleaseVersion } from "./release-assets.mjs";

const execute = promisify(execFile);

function githubClient(repository, tag) {
  const gh = async args => (await execute("gh", args, { maxBuffer: 8 * 1024 * 1024 })).stdout;
  return {
    release: async () => JSON.parse(await gh(["api", `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`])),
    digest: async asset => {
      const directory = await mkdtemp(path.join(tmpdir(), "music-release-asset-"));
      try {
        await gh(["release", "download", tag, "--repo", repository, "--pattern", asset.name, "--dir", directory]);
        return `sha256:${await sha256(path.join(directory, asset.name))}`;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    upload: async asset => {
      await gh(["release", "upload", tag, asset.file, "--repo", repository]);
      console.log(`Uploaded ${asset.name}`);
    },
  };
}

// Compare all existing assets before uploading; retries only fill missing files.
export async function publishRelease({ repository, tag, target, directory }, client = githubClient(repository, tag)) {
  assert(/^[\w.-]+\/[\w.-]+$/.test(repository), "Invalid release repository");
  const assets = await validateAssets(tag, target, directory);
  const release = await client.release();
  assert.equal(release.tag_name, tag, "Unexpected release tag");
  assert.equal(release.draft, false, "Release must already be published");
  const missing = [];
  for (const asset of assets) {
    const existing = release.assets.find(candidate => candidate.name === asset.name);
    if (!existing) missing.push(asset);
    else {
      const digest = existing.digest || await client.digest(existing);
      assert.equal(digest, asset.digest, `Existing release asset differs: ${asset.name}`);
      console.log(`Already uploaded: ${asset.name}`);
    }
  }
  for (const asset of missing) await client.upload(asset);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: Object.fromEntries(["repository", "tag", "target", "directory"].map(name => [name, { type: "string" }])) });
  for (const name of ["repository", "tag", "target", "directory"]) assert(values[name], `Missing --${name}`);
  validateReleaseVersion(values.tag, await applicationVersions(fileURLToPath(new URL("../../", import.meta.url))));
  await publishRelease({ ...values, directory: path.resolve(values.directory) });
}
