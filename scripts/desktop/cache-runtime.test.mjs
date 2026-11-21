import { test } from "node:test";
import assert from "node:assert/strict";
import { findRuntimeArtifact, runtimeCacheKey, runtimeCachePrefix } from "./cache-runtime.mjs";
import { desktopTarget } from "./targets.mjs";

test("native runtime cache keeps both Linux backends and Mac architectures separate", async () => {
  const targets = [desktopTarget("linux", "x64", "vulkan"), desktopTarget("linux", "x64", "cuda"), desktopTarget("macos", "arm64"), desktopTarget("macos", "x64")];
  const keys = await Promise.all(targets.map(runtimeCacheKey));
  const prefixes = await Promise.all(targets.map(runtimeCachePrefix));
  assert.equal(new Set(prefixes).size, 4);
  for (const [index, key] of keys.entries()) assert(key.startsWith(prefixes[index]));
  assert.equal(new Set(keys).size, 4);
  assert.equal(await runtimeCacheKey(targets[1]), keys[1]);
});

test("cross-release cache rejects expired, failed, foreign and unrelated workflow artifacts", async () => {
  const repository = "owner/desktop", key = "native-cuda-key";
  const artifacts = [
    { id: 1, name: key, expired: true, workflow_run: { id: 1 } },
    { id: 2, name: "other-backend", workflow_run: { id: 2 } },
    ...[3, 4, 5, 6].map(id => ({ id, name: key, workflow_run: { id } })),
  ];
  const api = async route => {
    if (route.includes("/artifacts?")) return { artifacts };
    const id = Number(route.split("/").at(-1));
    assert(![1, 2].includes(id));
    return { conclusion: id === 3 ? "failure" : "success", path: id === 4 ? ".github/workflows/other.yml" : ".github/workflows/desktop.yml", head_repository: { full_name: id === 5 ? "other/repo" : repository } };
  };
  assert.equal((await findRuntimeArtifact(repository, key, api)).id, 6);
  assert.equal(await findRuntimeArtifact(repository, key, async () => ({ artifacts: [] })), undefined);
});
