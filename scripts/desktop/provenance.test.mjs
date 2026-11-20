import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import yue2 from "../../models/yue2-runtime.json" with { type: "json" };
import { desktopTarget } from "./targets.mjs";
import { audioCppDirectory, engineRecipeHash, hash, manifest, recordHashes, root, verifyEngine } from "./common.mjs";

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

async function macosFixture(work) {
  const macos = desktopTarget("macos", "arm64");
  const metadata = {
    platform: macos.platform, arch: macos.arch, revision: manifest.engines.macos.revision,
    max_inference_steps: manifest.engines.macos.max_inference_steps,
    recipe_sha256: await engineRecipeHash(macos),
    sandbox_patch_sha256: await hash(path.join(root, "scripts/desktop/engine-sandbox.mm")),
    yue2_revision: yue2.revision,
    yue2_ggml_revision: yue2.ggml_revision,
  };
  const yue2Runner = path.join(work, yue2.executable);
  const audioCpp = path.join(work, audioCppDirectory);
  const heartmulaSpec = path.join(audioCpp, "model_specs", "heartmula.json");
  await writeFile(path.join(work, "ace-server"), "test engine");
  await writeFile(yue2Runner, "test YuE2 runner");
  await mkdir(path.dirname(heartmulaSpec), { recursive: true });
  for (const file of ["audiocpp_cli", "libaudiocpp.0.dylib", "LICENSE"]) {
    await writeFile(path.join(audioCpp, file), "test resource");
  }
  await writeFile(heartmulaSpec, "test resource");
  return { macos, metadata, yue2Runner, audioCpp, heartmulaSpec };
}

it("requires the pinned YuE2 runner in the Apple Silicon bundle", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "yue2-provenance-test-"));
  try {
    const { macos, metadata, yue2Runner } = await macosFixture(work);
    await rm(yue2Runner);
    await recordHashes(work, metadata);
    await assert.rejects(verifyEngine(work, macos), /YuE2 runner is missing/);
    await writeFile(yue2Runner, "test YuE2 runner");
    await recordHashes(work, metadata);
    await verifyEngine(work, macos);
    await writeFile(yue2Runner, "changed runner");
    await assert.rejects(verifyEngine(work, macos), /failed verification: yue-synth/);
  } finally { await rm(work, { recursive: true, force: true }); }
});

it("requires only the pinned audio.cpp runtime resources in Apple Silicon bundles", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "macos-provider-provenance-test-"));
  try {
    const { macos, metadata, audioCpp, heartmulaSpec } = await macosFixture(work);
    await rm(heartmulaSpec);
    await recordHashes(work, metadata);
    await assert.rejects(verifyEngine(work, macos), /Unexpected audio.cpp runtime inventory/);

    await writeFile(heartmulaSpec, "test resource");
    await recordHashes(work, metadata);
    await verifyEngine(work, macos);

    await writeFile(path.join(audioCpp, "weights.gguf"), "test weights");
    await recordHashes(work, metadata);
    await assert.rejects(verifyEngine(work, macos), /Unexpected audio.cpp runtime inventory/);
  } finally { await rm(work, { recursive: true, force: true }); }
});
