import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pin from "../../models/yue2-runtime.json" with { type: "json" };
import { root, run, shipsYue2, target } from "./common.mjs";

const executableName = path.basename(pin.executable);
const plannerName = path.basename(pin.planner);

export async function prepareYue2(engine, work) {
  const source = path.join(work, "yue2-cpp");
  const build = path.join(work, "yue2-build");
  await run("git", ["init", source]);
  await run("git", ["fetch", "--depth", "1", "--no-tags", pin.repository, pin.revision], { cwd: source });
  await run("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: source });
  await run("git", ["submodule", "update", "--init", "--depth", "1", "ggml"], { cwd: source });
  const ggml = execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.join(source, "ggml"), encoding: "utf8" }).trim();
  assert.equal(ggml, pin.ggml_revision, "YuE2 GGML revision mismatch");

  await cp(path.join(root, "scripts/desktop/engine-sandbox.mm"), path.join(source, "desktop-sandbox.mm"));
  const cmake = path.join(source, "CMakeLists.txt");
  const original = await readFile(cmake, "utf8");
  const project = "project(yue2-ggml LANGUAGES C CXX)";
  assert(original.includes(project), "YuE2 CMake project declaration changed");
  const sandbox = [executableName, plannerName].map(name =>
    `target_sources(${name} PRIVATE desktop-sandbox.mm)
target_link_libraries(${name} PRIVATE "-framework Foundation")`
  ).join("\n");
  await writeFile(cmake, `${original.replace(project, "project(yue2-ggml LANGUAGES C CXX OBJC OBJCXX)")}\n${sandbox}\n`);
  await run("cmake", [
    "-S", source, "-B", build, "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=OFF", "-DGGML_BACKEND_DL=OFF", "-DGGML_NATIVE=OFF", "-DGGML_OPENMP=OFF",
    "-DGGML_ACCELERATE=ON", "-DGGML_BLAS=ON", "-DGGML_BLAS_VENDOR=Apple",
    "-DGGML_METAL=ON", "-DGGML_METAL_EMBED_LIBRARY=ON",
    "-DCMAKE_OSX_ARCHITECTURES=arm64", `-DCMAKE_OSX_DEPLOYMENT_TARGET=${target.minimumSystemVersion}`,
  ]);
  await run("cmake", ["--build", build, "--config", "Release", "--target", plannerName, executableName, "--parallel", "2"]);

  const executable = path.join(engine, pin.executable);
  const planner = path.join(engine, pin.planner);
  // GGML scans the executable and working directories even in a static build.
  await mkdir(path.dirname(executable), { recursive: true });
  await cp(path.join(build, executableName), executable);
  await cp(path.join(build, plannerName), planner);
  await cp(path.join(source, "LICENSE"), path.join(engine, "LICENSE-yue2.cpp"));
  await cp(path.join(source, "ggml/LICENSE"), path.join(engine, "LICENSE-yue2-ggml"));
  const yyjson = await readFile(path.join(source, "vendor/yyjson/yyjson.h"), "utf8");
  const notice = yyjson.match(/^\/\*[\s\S]+?\*\//)?.[0];
  assert(notice?.includes("Copyright"), "YuE2 yyjson license header is missing");
  await writeFile(path.join(engine, "LICENSE-yue2-yyjson"), `${notice}\n`);
  await run("codesign", ["--force", "--sign", "-", executable]);
  await run("codesign", ["--force", "--sign", "-", planner]);
  await verifyYue2Binary(engine);
}

// Upstream prints its build ID and CLI syntax to stderr, with status 1 on --help.
export async function verifyYue2Binary(engine) {
  await verifyRunner(path.join(engine, pin.executable), ["--model", "--vae", "--request", "--out"]);
  await verifyRunner(path.join(engine, pin.planner), ["--model", "--request", "--out"]);
}

async function verifyRunner(executable, arguments_) {
  execFileSync("codesign", ["--verify", "--strict", executable]);
  const dependencies = execFileSync("otool", ["-L", executable], { encoding: "utf8" });
  for (const line of dependencies.trimEnd().split("\n").slice(1)) {
    assert(/^\s+\/(usr\/lib|System\/Library)\//.test(line), `YuE2 runner depends on ${line.trim()}`);
  }
  // The build process has no app sandbox for the distributed helper to inherit.
  const work = await mkdtemp(path.join(tmpdir(), "music-yue2-cli-"));
  try {
    const probe = path.join(work, path.basename(executable));
    await cp(executable, probe);
    execFileSync("codesign", ["--force", "--sign", "-", probe], { stdio: "pipe" });
    const result = spawnSync(probe, ["--help"], { encoding: "utf8", timeout: 15000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 1, `YuE2 runner did not print its CLI contract: ${result.signal || result.stderr}`);
    assert(result.stderr.startsWith(`yue2.cpp ${pin.revision.slice(0, 7)}`), "YuE2 runner revision mismatch");
    for (const arg of arguments_) assert(result.stderr.includes(arg), `YuE2 runner lacks ${arg}`);
  } finally { await rm(work, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(shipsYue2(), "YuE2 runner target is unavailable");
  const work = await mkdtemp(path.join(tmpdir(), "music-yue2-"));
  const engine = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "src-tauri/resources/engine");
  try { await prepareYue2(engine, work); } finally { await rm(work, { recursive: true, force: true }); }
}
