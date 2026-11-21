import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pin from "../../models/cuda-linux.json" with { type: "json" };
import { files, run } from "./common.mjs";

const cudaLibrary = /^lib(?:cudart|cublas(?:Lt)?)\.so\.\d+$/;

// Ship only runtime SONAMEs; the NVIDIA driver and compiler stay outside the app.
export async function copyCudaRuntime(engine, sdk, manifest = pin) {
  for (const name of Object.keys(manifest.runtime)) assert(cudaLibrary.test(name), `Not a CUDA redistributable: ${name}`);
  const destination = path.join(engine, "cuda");
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.join(destination, "licenses"), { recursive: true });
  for (const [name, component] of Object.entries(manifest.runtime)) {
    await cp(path.join(sdk, "lib", name), path.join(destination, name), { dereference: true });
    await cp(path.join(sdk, "licenses", `${component}.txt`), path.join(destination, "licenses", `${component}.txt`));
  }
  await writeFile(path.join(destination, "CUDA_RUNTIME.json"), JSON.stringify(manifest, null, 2) + "\n");
}

export function linuxRpath(file, engine) {
  const relative = path.relative(path.dirname(file), engine).split(path.sep).join("/");
  const base = relative ? `$ORIGIN/${relative}` : "$ORIGIN";
  return [...new Set(["$ORIGIN", base, `${base}/cuda`])].join(":");
}

export async function isElf(file) {
  const handle = await open(file, "r");
  try {
    const bytes = Buffer.alloc(4);
    await handle.read(bytes, 0, 4, 0);
    return bytes.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  } finally { await handle.close(); }
}

export async function relocateLinuxRuntime(engine) {
  for (const file of await files(engine)) if (await isElf(file)) await run("patchelf", ["--set-rpath", linuxRpath(file, engine), file]);
}

export function assertLinuxDependencies(output, engine) {
  assert(!/=>\s+not found/.test(output), `Unresolved Linux runtime dependency:\n${output}`);
  assert(!/\blibcuda\.so/.test(output), "Runtime must load the host driver dynamically, without a bundled stub");
  for (const match of output.matchAll(/(\S+)\s+=>\s+(\/.*?)\s+\(/g)) {
    if (!cudaLibrary.test(match[1])) continue;
    const relative = path.relative(engine, match[2]);
    assert(!relative.startsWith("..") && !path.isAbsolute(relative), `CUDA dependency resolved outside the app: ${match[2]}`);
  }
}

export async function verifyLinuxRuntime(engine, backend, appdir) {
  const all = await files(engine);
  const names = all.map(file => path.basename(file));
  if (backend === "cuda") {
    for (const name of Object.keys(pin.runtime)) assert(names.includes(name), `CUDA runtime missing: ${name}`);
    const manifest = JSON.parse(await readFile(path.join(engine, "cuda/CUDA_RUNTIME.json"), "utf8"));
    assert.deepEqual(manifest, pin, "Wrong pinned CUDA runtime");
    assert(names.some(name => /^libggml-cuda.*\.so/.test(name)), "ACE-Step CUDA backend missing");
    assert(!names.some(name => /ggml-vulkan|libvulkan\.so/.test(name)), "CUDA package contains Vulkan resources");
  } else {
    assert(names.some(name => /^libggml-vulkan.*\.so/.test(name)), "ACE-Step Vulkan backend missing");
    assert(!names.some(name => cudaLibrary.test(name) || /ggml-cuda/.test(name)), "Vulkan package contains CUDA resources");
  }
  const packaged = appdir ? await files(appdir) : all;
  assert(!packaged.some(file => /^libcuda\.so/.test(path.basename(file))), "NVIDIA driver/stub must not be bundled");
  for (const file of all) {
    if (path.relative(engine, file).startsWith(`diffrhythm2${path.sep}`)) continue;
    if (!await isElf(file)) continue;
    const rpath = execFileSync("patchelf", ["--print-rpath", file], { encoding: "utf8" }).trim();
    assert(rpath.split(":").every(value => value.startsWith("$ORIGIN")), `Nonportable runtime search path in ${file}: ${rpath}`);
    const dependencies = execFileSync("ldd", [file], { encoding: "utf8", env: { ...process.env, LD_LIBRARY_PATH: "", LD_PRELOAD: "" } });
    assertLinuxDependencies(dependencies, engine);
  }
  console.log(`${backend} engine dependencies resolve without a system CUDA toolkit or bundled driver.`);
}
