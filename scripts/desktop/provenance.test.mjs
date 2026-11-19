import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { desktopTarget } from "./targets.mjs";
import yue2 from "../../models/yue2-runtime.json" with { type: "json" };
import { engineRecipeHash, hash, manifest, recordHashes, root, verifyEngine } from "./common.mjs";

it("rejects a cached engine from the other Linux variant or an older build recipe", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "linux-provenance-test-"));
  try {
    const vulkan = desktopTarget("linux", "x64"), cuda = desktopTarget("linux", "x64", "cuda");
    const metadata = { platform: "linux", arch: "x64", revision: manifest.engines.linux.revision, backend: "vulkan", max_inference_steps:200, recipe_sha256: await engineRecipeHash(vulkan) };
    await writeFile(path.join(work, "ace-server"), "test engine");
    await recordHashes(work, metadata);
    await verifyEngine(work, vulkan);
    await assert.rejects(verifyEngine(work, cuda), /Linux backend changed/);
    assert.notEqual(await engineRecipeHash(cuda), metadata.recipe_sha256);
    await recordHashes(work, { ...metadata, recipe_sha256: "stale" });
    await assert.rejects(verifyEngine(work, vulkan), /build recipe changed/);
    await recordHashes(work, { ...metadata, backend: "cuda", recipe_sha256: await engineRecipeHash(cuda) });
    await verifyEngine(work, cuda);
    await assert.rejects(verifyEngine(work, vulkan), /Linux backend changed/);
    await writeFile(path.join(work, "unrecorded.so"), "extra library");
    await assert.rejects(verifyEngine(work, cuda), /inventory changed/);
    await rm(path.join(work, "unrecorded.so"));
    await mkdir(path.join(work, "heartmula"));
    await writeFile(path.join(work, "heartmula/HEART_RUNTIME.json"), "retired provider");
    await recordHashes(work, { ...metadata, backend: "cuda", recipe_sha256: await engineRecipeHash(cuda) });
    await assert.rejects(verifyEngine(work, cuda), /Retired provider resources/);
  } finally { await rm(work, { recursive: true, force: true }); }
});

it("rejects the old Windows iteration limit even when target and file hashes match", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "windows-step-contract-"));
  try {
    const windows = desktopTarget("windows", "x64");
    await writeFile(path.join(work, "ace-server.exe"), "old engine");
    await recordHashes(work, {
      platform:"windows",arch:"x64",revision:manifest.engines.windows.revision,
      recipe_sha256:await engineRecipeHash(windows),max_inference_steps:100,
    });
    await assert.rejects(verifyEngine(work,windows),/iteration limit/);
  } finally { await rm(work,{recursive:true,force:true}); }
});

it("requires the pinned YuE2 runner in the Apple Silicon bundle", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "yue2-provenance-test-"));
  try {
    const mac = desktopTarget("macos", "arm64");
    const metadata = {
      platform: mac.platform, arch: mac.arch, revision: manifest.engines.macos.revision,
      max_inference_steps: manifest.engines.macos.max_inference_steps,
      recipe_sha256: await engineRecipeHash(mac),
      sandbox_patch_sha256: await hash(path.join(root, "scripts/desktop/engine-sandbox.mm")),
    };
    await writeFile(path.join(work, "ace-server"), "test engine");
    await recordHashes(work, metadata);
    await assert.rejects(verifyEngine(work, mac), /YuE2 runner is missing/);
    await writeFile(path.join(work, yue2.executable), "test YuE2 runner");
    await recordHashes(work, { ...metadata, yue2_revision: yue2.revision, yue2_ggml_revision: yue2.ggml_revision });
    await verifyEngine(work, mac);
    await writeFile(path.join(work, yue2.executable), "changed runner");
    await assert.rejects(verifyEngine(work, mac), /failed verification: yue-synth/);
  } finally { await rm(work, { recursive: true, force: true }); }
});
