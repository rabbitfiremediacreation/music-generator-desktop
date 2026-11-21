import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { githubFeedClient, hasPreviewAppcasts, publishPreviewFeeds, readPreviewFeed } from "./preview-feeds.mjs";
import { appcastName, applicationVersions, releaseTargets, sha256, validateAssets, validateReleaseVersion } from "./release-assets.mjs";

const gh = promisify(execFile);
const {
  UPDATE_STREAM: stream,
  GITHUB_REPOSITORY: repository,
  GITHUB_RUN_NUMBER: run,
  GITHUB_SHA: revision,
} = process.env;
assert(stream === "daily" || stream === "develop", "Invalid update stream");
assert(/^[1-9]\d*$/.test(run), "Invalid workflow run number");
assert(/^[a-f0-9]{40}$/.test(revision), "Invalid source revision");

const tag = `${stream}-${run}`;
const macAppcasts = releaseTargets.filter(target => target.startsWith("macos-")).map(appcastName);
const versions = await applicationVersions(".");
const versionTag = `v${versions[0]}`;
validateReleaseVersion(versionTag, versions);

async function release(action, ...args) {
  const { stdout } = await gh("gh", ["release", action, tag, "--repo", repository, ...args]);
  return stdout;
}

let existing;
try {
  existing = JSON.parse(await release("view", "--json", "assets,isDraft,isPrerelease,targetCommitish"));
} catch (error) {
  if (error.stderr?.trim() !== "release not found") throw error;
}
if (existing) {
  assert(existing.isPrerelease && existing.targetCommitish === revision, `Unexpected release for ${tag}`);
}
let withAppcasts;
if (!existing || existing.isDraft) {
  const notes = "update-notes/release-notes.md";
  assert((await readFile(notes, "utf8")).trim(), "Missing generated update notes");
  const assets = (await Promise.all(releaseTargets.map(target =>
    validateAssets(versionTag, target, path.join("packages", `Music-Generator-${target}`), { releaseTag: tag }),
  ))).flat();
  withAppcasts = hasPreviewAppcasts(assets);
  if (!existing) {
    const channel = stream === "daily" ? "Daily" : "Develop";
    await release("create", "--target", revision, "--draft", "--prerelease",
      "--title", `${channel} ${versions[0]} (build ${run})`,
      "--notes-file", notes);
  } else if (!withAppcasts) {
    // A draft may contain feed assets from an earlier attempt with Sparkle enabled.
    const appcastAssets = new Set(macAppcasts.flatMap(name => [name, `${name}.sha256`]));
    for (const asset of existing.assets.filter(asset => appcastAssets.has(asset.name))) {
      await release("delete-asset", asset.name, "--yes");
    }
  }

  // Only the draft is mutable. A failed upload leaves the previous public build available.
  await release("upload", "--clobber", ...assets.map(asset => asset.file));
  console.log(await release("edit", "--notes-file", notes, "--draft=false", "--latest=false"));
} else {
  withAppcasts = hasPreviewAppcasts(existing.assets);
}

const request = githubFeedClient(repository, process.env.GH_TOKEN);
let activeTag;
if (withAppcasts) {
  // A retry uses the published feed because rebuilt archives can differ from the public ZIPs.
  const directory = await mkdtemp(path.join(tmpdir(), "music-preview-feeds-"));
  try {
    await release("download", "--pattern", "appcast-macos-*", "--dir", directory);
    const feeds = Object.fromEntries(await Promise.all(macAppcasts.map(async name => {
      const file = path.join(directory, name);
      assert.equal((await readFile(`${file}.sha256`, "utf8")).trimEnd(), `${await sha256(file)}  ${name}`);
      return [name, await readFile(file, "utf8")];
    })));
    activeTag = await publishPreviewFeeds({ stream, run, feeds }, request);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else {
  activeTag = (await readPreviewFeed(stream, request))?.tag;
  console.log(`${tag} offers manual downloads with update notes.`);
}
if (activeTag) console.log(`Active ${stream} Sparkle feeds point to ${activeTag}.`);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `active_tag=${activeTag ?? ""}\n`);
