import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { architecture, exists, files, hash, platform, root, run } from "./common.mjs";

const repository = "https://github.com/magenta/magenta-realtime.git";
const catalog = JSON.parse(await readFile(path.join(root, "models/catalog.json"), "utf8"));
const { runtime } = catalog.profiles.find(profile => profile.selection.provider === "magenta-realtime-2" && profile.selection.synthesis === "mrt2_small");
const recipeFolder = path.join(root, "scripts/desktop/magenta-runtime");
const entitlements = path.join(root, "src-tauri/Engine.entitlements");
const required = ["mrt2-record", "mlx.metallib", "LICENSE-MagentaRT"];
const proofName = "MAGENTA_RUNTIME.json";
const nativeDependencies = ["mlx", "metal_cpp", "fmt", "json", "sentencepiece", "tensorflow-lite"];
const tfliteDependencies = ["abseil-cpp", "eigen", "farmhash", "fft2d", "flatbuffers", "gemmlowp", "cpuinfo", "ml_dtypes", "ruy", "protobuf"];
export const magentaFolder = path.join(root, "src-tauri/resources", path.dirname(runtime.executable));

async function recipe() {
  return (await Promise.all([
    fileURLToPath(import.meta.url),
    path.join(recipeFolder, "register.cmake"),
    path.join(recipeFolder, "record.cpp"),
    path.join(root, "scripts/desktop/engine-sandbox.mm"),
    entitlements,
  ].map(hash))).join(":");
}

async function inventory(folder) {
  return (await files(folder)).map(file => path.relative(folder, file)).filter(file => file !== proofName).sort();
}

export async function verifyMagenta(folder = magentaFolder, checkRecipe = true) {
  const proof = JSON.parse(await readFile(path.join(folder, proofName), "utf8"));
  if (proof.revision !== runtime.revision || proof.platform !== "macos" || proof.arch !== "arm64" || !required.every(file => file in proof.files)) {
    throw Error("Magenta runtime target or revision mismatch");
  }
  if (checkRecipe && proof.recipe !== await recipe()) throw Error("Magenta runtime build recipe changed");
  const actual = await inventory(folder);
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(proof.files).sort())) throw Error("Magenta runtime resource inventory changed");
  for (const file of actual) {
    if (await hash(path.join(folder, file)) !== proof.files[file]) throw Error(`Magenta runtime resource mismatch: ${file}`);
  }
  return proof;
}

export async function recordMagenta(folder = magentaFolder) {
  const sums = {};
  for (const file of await inventory(folder)) sums[file] = await hash(path.join(folder, file));
  const proof = { revision: runtime.revision, platform: "macos", arch: "arm64", recipe: await recipe(), files: sums };
  await writeFile(path.join(folder, proofName), JSON.stringify(proof, null, 2) + "\n");
}

function sourceRevision(source) {
  return execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

async function configureCore(source) {
  const upstream = execFileSync("git", ["-C", source, "show", "HEAD:CMakeLists.txt"], { encoding: "utf8" });
  // Studio uses the core library. The upstream plugin targets fetch SDKs even
  // when building a different target, so leave those targets out of configure.
  const coreOnly = upstream.replace(/^add_subdirectory\(examples\/[^)]+\)\r?\n/gm, "");
  if (coreOnly === upstream) throw Error("Could not isolate the pinned Magenta core build");
  await writeFile(path.join(source, "CMakeLists.txt"), coreOnly);
}

async function copyNotices(directory, dependency, staging) {
  if (!await exists(directory)) return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const notice = /^(LICENSE|COPYING|NOTICE)(\.|$)/i.test(entry.name)
      || (dependency === "fft2d" && entry.name === "readme2d.txt");
    if (entry.isFile() && notice) {
      await cp(path.join(directory, entry.name), path.join(staging, `${dependency}-${entry.name}`));
    }
  }
}

export async function stageMagenta(source, build, folder = magentaFolder) {
  if (sourceRevision(source) !== runtime.revision) throw Error("Magenta source checkout does not match the pinned revision");
  const deps = path.join(build, "_deps");
  await mkdir(path.dirname(folder), { recursive: true });
  const staging = await mkdtemp(path.join(path.dirname(folder), ".magenta-"));
  try {
    const executable = path.join(staging, "mrt2-record");
    await cp(path.join(build, "music-generator/mrt2-record"), executable);
    await cp(path.join(deps, "mlx-build/mlx/backend/metal/kernels/mlx.metallib"), path.join(staging, "mlx.metallib"));
    await cp(path.join(source, "LICENSE"), path.join(staging, "LICENSE-MagentaRT"));
    for (const dependency of [...nativeDependencies, ...tfliteDependencies]) {
      await copyNotices(path.join(deps, `${dependency}-src`), dependency, staging);
    }
    for (const dependency of ["absl", "darts_clone", "esaxx", "protobuf-lite"]) {
      await copyNotices(path.join(deps, "sentencepiece-src/third_party", dependency), `sentencepiece-${dependency}`, staging);
    }
    // TensorFlow Lite can place its dependency sources outside FetchContent's
    // normal _deps directory. Include the notices in either build layout.
    for (const dependency of tfliteDependencies) {
      await copyNotices(path.join(build, dependency), dependency, staging);
    }
    await run("codesign", ["--force", "--sign", "-", executable]);
    await recordMagenta(staging);
    await verifyMagenta(staging);
    await rm(folder, { recursive: true, force: true });
    await rename(staging, folder);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function prepareMagenta(folder = magentaFolder) {
  if (platform !== "macos" || architecture !== "arm64") throw Error("Magenta RealTime 2 requires native Apple Silicon macOS");
  try { await verifyMagenta(folder); return; } catch { /* Prepare the pinned runtime. */ }
  const cache = path.join(root, ".cache/desktop/magenta", runtime.revision);
  const source = path.join(cache, "source");
  const build = path.join(cache, "build");
  if (!await exists(path.join(source, "CMakeLists.txt"))) {
    await mkdir(source, { recursive: true });
    await run("git", ["init", "--quiet", source]);
    await run("git", ["-C", source, "fetch", "--no-tags", "--depth=1", repository, runtime.revision]);
    await run("git", ["-C", source, "checkout", "--quiet", "--detach", "FETCH_HEAD"]);
  }
  if (sourceRevision(source) !== runtime.revision) throw Error("Magenta source checkout does not match the pinned revision");
  await configureCore(source);
  await run("cmake", [
    "-S", source, "-B", build, "-G", "Ninja",
    "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_OSX_ARCHITECTURES=arm64", "-DBUILD_SHARED_LIBS=OFF",
    "-DCMAKE_POSITION_INDEPENDENT_CODE=ON",
    "-DCMAKE_POLICY_VERSION_MINIMUM=3.5",
    `-DCMAKE_PROJECT_TOP_LEVEL_INCLUDES=${path.join(recipeFolder, "register.cmake")}`,
  ]);
  await run("cmake", ["--build", build, "--target", "mrt2-record", "--parallel", "4"]);
  await stageMagenta(source, build, folder);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareMagenta();
