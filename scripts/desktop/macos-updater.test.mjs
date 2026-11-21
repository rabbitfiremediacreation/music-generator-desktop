import assert from "node:assert/strict";
import test from "node:test";
import { appcastUrl, appcastXml, macUpdateRelease, macUpdaterSettings } from "./macos-updater.mjs";
import { publishPreviewFeeds } from "./preview-feeds.mjs";

const notarized = { MUSIC_GENERATOR_REQUIRE_NOTARIZATION: "true" };
const repository = "rabbitfiremediacreation/music-generator-desktop";
const feeds = {
  "appcast-macos-arm64.xml": "<?xml version=\"1.0\"?>\n<!-- signed Apple Silicon feed -->\n",
  "appcast-macos-x64.xml": "<?xml version=\"1.0\"?>\n<!-- signed Intel feed -->\n",
};
const ref = stream => `git/ref/heads/desktop-feed-${stream}`;
const marker = run => ({ content: Buffer.from(`${run}\n`).toString("base64") });

test("keeps the Stable feed and orders preview packages by the CI build number", () => {
  assert.equal(macUpdateRelease({}, "0.2.0"), null);
  const stable = macUpdateRelease(notarized, "0.2.0");
  assert.deepEqual(stable, { stream: "stable", tag: "v0.2.0", version: "0.2.0", bundleVersion: "0.2.0" });
  assert.equal(appcastUrl(stable.stream, "macos-arm64"),
    `https://github.com/${repository}/releases/latest/download/appcast-macos-arm64.xml`);

  for (const stream of ["daily", "develop"]) {
    const before = macUpdateRelease({ ...notarized, MUSIC_GENERATOR_UPDATE_BUILD: `${stream}-99` }, "0.2.0");
    const next = macUpdateRelease({ ...notarized, MUSIC_GENERATOR_UPDATE_BUILD: `${stream}-100` }, "0.2.0");
    assert.equal(before.version, next.version);
    assert(Number(before.bundleVersion) < Number(next.bundleVersion));
    assert.equal(appcastUrl(next.stream, "macos-x64"),
      `https://raw.githubusercontent.com/${repository}/desktop-feed-${stream}/appcast-macos-x64.xml`);
    const xml = appcastXml(next, "Music-Generator-0.2.0-macos-x64.zip", "13.3", "fixture", 42);
    assert(xml.includes("<sparkle:version>100</sparkle:version>"));
    assert(xml.includes("<sparkle:shortVersionString>0.2.0</sparkle:shortVersionString>"));
    assert(xml.includes(`releases/download/${stream}-100/Music-Generator-0.2.0-macos-x64.zip`));
  }
  assert.throws(() => macUpdateRelease({ ...notarized, MUSIC_GENERATOR_UPDATE_BUILD: "daily-0" }, "0.2.0"), /preview build tag/);
  assert.throws(() => macUpdaterSettings({ ...notarized, MUSIC_GENERATOR_UPDATE_BUILD: "develop-100", GITHUB_REPOSITORY: repository }, "0.2.0"), /SPARKLE_PUBLIC_KEY/);
});

test("creates a preview feed branch with both signed appcasts in the same commit", async () => {
  const calls = [];
  const result = await publishPreviewFeeds({ stream: "daily", run: "100", feeds }, async (endpoint, options) => {
    calls.push([endpoint, options]);
    switch (endpoint) {
      case ref("daily"): return null;
      case "git/trees": return { sha: "tree" };
      case "git/commits": return { sha: "commit" };
      case "git/refs": return {};
      default: assert.fail(endpoint);
    }
  });
  assert.equal(result, "daily-100");
  assert.deepEqual(Object.fromEntries(calls[1][1].body.tree.map(({ path, content }) => [path, content])), {
    ...feeds, "build.txt": "100\n",
  });
  assert.deepEqual(calls[2][1].body.parents, []);
  assert.deepEqual(calls[3][1].body, { ref: "refs/heads/desktop-feed-daily", sha: "commit" });
});

test("a losing Develop publication retry leaves the newer build active", async () => {
  let head = "previous";
  let updates = 0;
  const result = await publishPreviewFeeds({ stream: "develop", run: "100", feeds }, async (endpoint, options) => {
    switch (endpoint) {
      case ref("develop"): return { object: { sha: head } };
      case "contents/build.txt?ref=previous": return marker(99);
      case "contents/build.txt?ref=winner": return marker(101);
      case "git/trees": return { sha: "tree" };
      case "git/commits":
        assert.deepEqual(options.body.parents, ["previous"]);
        return { sha: "commit" };
      case "git/refs/heads/desktop-feed-develop":
        assert.equal(options.body.force, false);
        updates++;
        head = "winner";
        return null;
      default: assert.fail(endpoint);
    }
  });
  assert.equal(result, "develop-101");
  assert.equal(updates, 1);
});
