import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildBranding, buildIconConfig } from "./build-branding.mjs";
import { root } from "./common.mjs";

test("uses the canonical update-stream tags to select desktop branding", async () => {
  assert.equal(buildBranding("develop-23"), "dev");
  assert.equal(buildBranding("daily-45"), "nightly");
  for (const tag of [undefined, "", "v0.2.0", "daily-0", "develop-test"]) {
    assert.equal(buildBranding(tag), "");
  }
  assert.deepEqual(await buildIconConfig(""), {});
});

test("the Develop installer can resolve its generated ICO from the Tauri project", async () => {
  const project = path.join(root, "src-tauri");
  const target = path.join(project, "target");
  await mkdir(target, { recursive: true });
  const work = await mkdtemp(path.join(target, "brand-test-"));
  try {
    const cli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
    const config = await buildIconConfig("dev", work, cli);
    const ico = config.icon.find(file => file.endsWith(".ico"));
    assert.ok(ico);
    if (process.platform === "win32") {
      assert.match(ico, /^target\/brand-test-[^/]+\/brand-icons\/icon\.ico$/);
    }
    const header = (await readFile(path.resolve(project, ico))).subarray(0, 4);
    assert.deepEqual([...header], [0, 0, 1, 0]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
