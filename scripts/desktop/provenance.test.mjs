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

it("requires Mimetic and the pinned audio.cpp runtime resources in Apple Silicon bundles", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "macos-provider-provenance-test-"));
  try {
    const macos = desktopTarget("macos", "arm64");
    const metadata = {
      platform: "macos", arch: "arm64", revision: manifest.engines.macos.revision,
      max_inference_steps: manifest.engines.macos.max_inference_steps,
      sandbox_patch_sha256: await hash(path.join(root, "scripts/desktop/engine-sandbox.mm")),
      recipe_sha256: await engineRecipeHash(macos),
      yue2_revision: yue2.revision,
      yue2_ggml_revision: yue2.ggml_revision,
    };
    await writeFile(path.join(work, "ace-server"), "test engine");
    await writeFile(path.join(work, "yue-synth"), "misplaced YuE2 runner");
    await recordHashes(work, metadata);
    await assert.rejects(verifyEngine(work, macos), /ACE-Step plug-in is missing/);
    await writeFile(path.join(work, "libace-server-plugin.dylib"), "test plug-in");
    await recordHashes(work, metadata);
    await assert.rejects(verifyEngine(work, macos), /YuE2 runner is missing/);
    await rm(path.join(work, "yue-synth"));
    const yue2Folder = path.join(work, path.dirname(yue2.executable));
    await mkdir(yue2Folder, { recursive: true });
    await writeFile(path.join(work, yue2.executable), "test YuE2 runner");
    await recordHashes(work, metadata);
    await assert.rejects(verifyEngine(work, macos), /instrumental planner is missing/);
    await writeFile(path.join(work, yue2.planner), "test YuE2 planner");
    const misplacedBackend = path.join(yue2Folder, "libggml-metal.so");
    await writeFile(misplacedBackend, "incompatible dynamic backend");
    await recordHashes(work, metadata);
    await assert.rejects(verifyEngine(work, macos), /YuE2 must be isolated/);
    await rm(misplacedBackend);
    await recordHashes(work, metadata);
    await assert.rejects(verifyEngine(work, macos), /shared PyTorch runtime is missing/);
    await writeFile(path.join(work, "mimetic-synth"), "test launcher");
    await mkdir(path.join(work, "pytorch"));
    await writeFile(path.join(work, "pytorch/PYTORCH_RUNTIME.json"), "test runtime receipt");
    await recordHashes(work, metadata);
    await assert.rejects(verifyEngine(work, macos), /Text2midi plug-in is missing/);
    await mkdir(path.join(work, "text2midi"));
    await writeFile(path.join(work, "text2midi/text2midi-runner"), "test plug-in");

    const runtime = path.join(work, "providers/audio.cpp");
    await mkdir(path.join(runtime, "model_specs"), { recursive: true });
    for (const file of ["audiocpp_cli", "libaudiocpp.0.dylib", "LICENSE"]) {
      await writeFile(path.join(runtime, file), "test resource");
    }
    await recordHashes(work, metadata);
    await assert.rejects(verifyEngine(work, macos), /Unexpected audio.cpp runtime inventory/);

    await writeFile(path.join(runtime, "model_specs/heartmula.json"), "test resource");
    await writeFile(path.join(runtime, "LICENSE.soxr"), "test license");
    await writeFile(path.join(runtime, "soxr-0.1.3-Source.tar.xz"), "test source archive");
    await writeFile(path.join(runtime, "model_specs/stable_audio.json"), "test resource");
    await recordHashes(work, metadata);
    await assert.rejects(verifyEngine(work, macos), /Unexpected audio.cpp runtime inventory/);

    await writeFile(path.join(runtime, "libsoxr.dylib"), "test resampler");
    await recordHashes(work, metadata);
    await verifyEngine(work, macos);

    await rm(path.join(runtime, "model_specs/stable_audio.json"));
    await recordHashes(work, metadata);
    await assert.rejects(verifyEngine(work, macos), /Unexpected audio.cpp runtime inventory/);
    await writeFile(path.join(runtime, "model_specs/stable_audio.json"), "test resource");

    await writeFile(path.join(runtime, "weights.gguf"), "test weights");
    await recordHashes(work, metadata);
    await assert.rejects(verifyEngine(work, macos), /Unexpected audio.cpp runtime inventory/);
  } finally { await rm(work, { recursive: true, force: true }); }
});
