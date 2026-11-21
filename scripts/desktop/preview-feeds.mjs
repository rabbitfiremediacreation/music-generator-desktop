import assert from "node:assert/strict";
import { previewFeedBranch } from "./macos-updater.mjs";
import { appcastName } from "./release-assets.mjs";

const feedNames = ["macos-arm64", "macos-x64"].map(appcastName);

export function githubFeedClient(repository, token) {
  assert(token, "Missing GitHub token for publishing update feeds");
  return async (endpoint, { method = "GET", body, allow = [] } = {}) => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${endpoint}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (allow.includes(response.status)) return null;
    if (!response.ok) throw new Error(`${method} ${endpoint}: HTTP ${response.status}`);
    return response.json();
  };
}

/** Advance both architectures in one commit, even when Develop builds finish out of order. */
export async function publishPreviewFeeds({ stream, run, feeds }, request) {
  assert(stream === "daily" || stream === "develop", "Invalid preview stream");
  assert(/^[1-9]\d*$/.test(run), "Invalid preview run number");
  const tree = [...feedNames, "build.txt"].map(name => {
    const content = name === "build.txt" ? `${run}\n` : feeds[name];
    assert(content, `Missing preview feed ${name}`);
    return { path: name, mode: "100644", type: "blob", content };
  });
  const branch = previewFeedBranch(stream);
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await request(`git/ref/heads/${branch}`, { allow: [404] });
    if (head) {
      const marker = await request(`contents/build.txt?ref=${head.object.sha}`);
      const published = Buffer.from(marker.content, "base64").toString("utf8").trim();
      assert(/^[1-9]\d*$/.test(published), `Invalid published build in ${branch}`);
      if (BigInt(published) >= BigInt(run)) return `${stream}-${published}`;
    }

    const createdTree = await request("git/trees", { method: "POST", body: { tree } });
    const commit = await request("git/commits", {
      method: "POST",
      body: {
        message: `Publish ${stream}-${run} Sparkle feeds`,
        tree: createdTree.sha,
        parents: head ? [head.object.sha] : [],
      },
    });
    const updated = head
      ? await request(`git/refs/heads/${branch}`, { method: "PATCH", body: { sha: commit.sha, force: false }, allow: [409, 422] })
      : await request("git/refs", { method: "POST", body: { ref: `refs/heads/${branch}`, sha: commit.sha }, allow: [409, 422] });
    if (updated) return `${stream}-${run}`;
  }
  throw new Error(`Could not advance Sparkle feeds on ${branch}`);
}
