import assert from "node:assert/strict";
import test from "node:test";
import { macSigningSettings } from "./macos-signing.mjs";
import { appcastUrl, appcastXml, macUpdateRelease, macUpdaterSettings } from "./macos-updater.mjs";
import { hasPreviewAppcasts, publishPreviewFeeds, readPreviewFeed } from "./preview-feeds.mjs";

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
    const before = macUpdateRelease({ MUSIC_GENERATOR_UPDATE_BUILD: `${stream}-99` }, "0.2.0");
    const next = macUpdateRelease({ MUSIC_GENERATOR_UPDATE_BUILD: `${stream}-100` }, "0.2.0");
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
  assert.throws(() => macUpdaterSettings({ ...notarized, GITHUB_REPOSITORY: repository }, "0.2.0"), /SPARKLE_PUBLIC_KEY/);
});

test("preview signing and Sparkle work independently of Apple notarization", () => {
  for (const stream of ["daily", "develop"]) {
    const preview = { MUSIC_GENERATOR_UPDATE_BUILD: `${stream}-100`, GITHUB_REPOSITORY: repository };
    assert.equal(macSigningSettings(preview), null);
    assert.equal(macSigningSettings({ ...preview, APPLE_TEAM_ID: "team-without-certificate" }), null);
    assert.equal(macSigningSettings({
      ...preview,
      APPLE_SIGNING_IDENTITY: "Developer ID Application: Music Generator",
      APPLE_CERTIFICATE: "certificate-fixture",
      APPLE_CERTIFICATE_PASSWORD: "password-fixture",
    }).APPLE_SIGNING_IDENTITY, "Developer ID Application: Music Generator");
    assert.equal(macUpdaterSettings(preview, "0.2.0"), null);
    const updater = macUpdaterSettings({
      ...preview, SPARKLE_PUBLIC_KEY: Buffer.alloc(32).toString("base64"), SPARKLE_PRIVATE_KEY: "fixture",
    }, "0.2.0");
    assert.equal(updater.stream, stream);
    assert.equal(updater.bundleVersion, "100");
  }
  assert.throws(() => macSigningSettings(notarized), /Missing macOS signing settings/);
});

test("a notarized build can use a Developer ID identity from the local keychain", () => {
  const local = {
    ...notarized,
    APPLE_SIGNING_IDENTITY: "Developer ID Application: Music Generator",
    APPLE_ID: "builder@example.test",
    APPLE_PASSWORD: "notary-fixture",
    APPLE_TEAM_ID: "TEAMID",
  };
  assert.equal(macSigningSettings(local).APPLE_SIGNING_IDENTITY, local.APPLE_SIGNING_IDENTITY);
  assert.throws(() => macSigningSettings({ ...local, APPLE_CERTIFICATE: "certificate-fixture" }),
    /Missing macOS signing settings: APPLE_CERTIFICATE_PASSWORD/);
});

test("a preview offering manual downloads can retain an existing Sparkle release", async () => {
  const appcasts = Object.keys(feeds).map(name => ({ name }));
  assert.equal(hasPreviewAppcasts([{ name: "Music-Generator-0.2.0-macos-arm64.zip" }]), false);
  assert.equal(hasPreviewAppcasts(appcasts), true);
  assert.throws(() => hasPreviewAppcasts(appcasts.slice(0, 1)), /both macOS architectures/);
  assert.equal(await readPreviewFeed("daily", async () => null), null);
  const active = await readPreviewFeed("develop", async endpoint => {
    if (endpoint === ref("develop")) return { object: { sha: "head" } };
    assert.equal(endpoint, "contents/build.txt?ref=head");
    return marker(99);
  });
  assert.equal(active.tag, "develop-99");
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
