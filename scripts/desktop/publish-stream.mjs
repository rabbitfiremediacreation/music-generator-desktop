import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { applicationVersions, validateAssets, validateReleaseVersion } from "./release-assets.mjs";

const gh = promisify(execFile);
const {
  UPDATE_STREAM: stream,
  GITHUB_REPOSITORY: repository,
  GITHUB_RUN_NUMBER: run,
  GITHUB_SHA: revision,
  GITHUB_SERVER_URL: server,
  GITHUB_RUN_ID: runId,
} = process.env;
assert(stream === "daily" || stream === "develop", "Invalid update stream");
assert(/^[1-9]\d*$/.test(run), "Invalid workflow run number");
assert(/^[a-f0-9]{40}$/.test(revision), "Invalid source revision");

const tag = `${stream}-${run}`;
const versions = await applicationVersions(".");
const versionTag = `v${versions[0]}`;
validateReleaseVersion(versionTag, versions);
const targets = ["macos-arm64", "macos-x64", "windows-x64", "linux-x64", "linux-x64-cuda"];
const assets = (await Promise.all(targets.map(target =>
  validateAssets(versionTag, target, path.join("packages", `Music-Generator-${target}`)),
))).flat();

async function release(action, ...args) {
  const { stdout } = await gh("gh", ["release", action, tag, "--repo", repository, ...args]);
  return stdout;
}

let existing;
try {
  existing = JSON.parse(await release("view", "--json", "isDraft,isPrerelease,targetCommitish"));
} catch (error) {
  if (error.stderr?.trim() !== "release not found") throw error;
}
if (existing) {
  assert(existing.isPrerelease && existing.targetCommitish === revision, `Unexpected release for ${tag}`);
  if (!existing.isDraft) {
    console.log(`${tag} is already published.`);
    process.exit(0);
  }
} else {
  const channel = stream === "daily" ? "Daily" : "Develop";
  await release("create", "--target", revision, "--draft", "--prerelease",
    "--title", `${channel} ${versions[0]} (build ${run})`,
    "--notes", `Build from main at ${revision}. [Workflow run](${server}/${repository}/actions/runs/${runId}).`);
}

// Only the draft is mutable. A failed upload leaves the previous public build available.
await release("upload", "--clobber", ...assets.map(asset => asset.file));
console.log(await release("edit", "--draft=false", "--latest=false"));
