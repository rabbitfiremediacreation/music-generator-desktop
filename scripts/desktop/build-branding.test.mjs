import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBranding, buildIconConfig } from "./build-branding.mjs";

test("uses the canonical update-stream tags to select desktop branding", async () => {
  assert.equal(buildBranding("develop-23"), "dev");
  assert.equal(buildBranding("daily-45"), "nightly");
  for (const tag of [undefined, "", "v0.2.0", "daily-0", "develop-test"]) {
    assert.equal(buildBranding(tag), "");
  }
  assert.deepEqual(await buildIconConfig(""), {});
});
