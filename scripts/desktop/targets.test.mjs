import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { desktopTarget } from "./targets.mjs";
import { engineRecipeHash } from "./common.mjs";

describe("native desktop engine targets", () => {
  it("builds a portable Intel CPU engine with the same deployment target as its app", () => {
    const intel = desktopTarget("macos", "x64");
    assert.equal(intel.cpuOnly, true);
    assert.equal(intel.minimumSystemVersion, "12.7");
    for (const option of ["-DGGML_METAL=OFF", "-DGGML_BLAS=OFF", "-DGGML_NATIVE=OFF", "-DGGML_CPU_ALL_VARIANTS=ON", "-DCMAKE_OSX_ARCHITECTURES=x86_64", `-DCMAKE_OSX_DEPLOYMENT_TARGET=${intel.minimumSystemVersion}`]) assert(intel.cmake.includes(option));
    for (const option of ["-DGGML_BLAS=OFF", "-DCMAKE_OSX_ARCHITECTURES=x86_64", "-DCMAKE_OSX_DEPLOYMENT_TARGET=12.7"]) assert(intel.titleCmake.includes(option));
  });
  it("targets macOS Sonoma on Apple Silicon with Metal acceleration", () => {
    const arm = desktopTarget("macos", "arm64");
    assert.equal(arm.cpuOnly, false);
    assert(arm.cmake.includes("-DGGML_METAL=ON"));
    assert.equal(arm.minimumSystemVersion, "14.0");
    assert(arm.cmake.includes("-DCMAKE_OSX_ARCHITECTURES=arm64"));
    assert(arm.cmake.includes("-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0"));
    assert(!arm.cmake.includes("-DGGML_BLAS=OFF"));
    assert(!arm.titleCmake.includes("-DGGML_BLAS=OFF"));
    assert(arm.titleCmake.includes("-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0"));
  });
  it("rejects unsupported architectures", () => {
    assert.throws(() => desktopTarget("macos", "ia32"));
    assert.throws(() => desktopTarget("windows", "arm64"));
  });
  it("keeps the default app bundle minimum aligned with its Apple Silicon engine", async () => {
    const config = JSON.parse(await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
    assert.equal(config.bundle.macOS.minimumSystemVersion, desktopTarget("macos", "arm64").minimumSystemVersion);
  });
  it("can fingerprint every engine build input, including the compatibility patch", async () => {
    assert.match(await engineRecipeHash(), /^[a-f0-9]{64}$/);
  });
  it("keeps the existing Vulkan artifact and excludes CUDA from its engines", () => {
    const linux = desktopTarget("linux", "x64");
    assert.equal(linux.backend, "vulkan");
    assert.equal(linux.artifactSuffix, "linux-x64.AppImage");
    assert(linux.cmake.includes("-DGGML_VULKAN=ON"));
    assert(linux.cmake.includes("-DGGML_CUDA=OFF"));
  });
  it("builds a separate CUDA artifact without requiring a GPU on the build host", () => {
    const linux = desktopTarget("linux", "x64", "cuda");
    assert.equal(linux.artifactSuffix, "linux-x64-cuda.AppImage");
    assert(linux.cmake.includes("-DGGML_CUDA=ON"));
    assert(linux.cmake.includes("-DGGML_VULKAN=OFF"));
    assert(linux.cmake.includes("-DGGML_CUDA_NO_VMM=ON"));
    assert(linux.cmake.includes("-DGGML_CPU_ALL_VARIANTS=ON"));
    const architectures = linux.cmake.find(option => option.startsWith("-DCMAKE_CUDA_ARCHITECTURES="));
    assert(architectures && !architectures.includes("native"));
  });
  it("rejects an unknown Linux backend rather than reusing the Vulkan cache", () => {
    assert.throws(() => desktopTarget("linux", "x64", "cdua"));
  });
});
