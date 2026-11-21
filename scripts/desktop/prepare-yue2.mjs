import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pin from "../../models/yue2-runtime.json" with { type: "json" };
import { root, run, shipsYue2, target } from "./common.mjs";
import { probeMacPlugin } from "./macos-plugin.mjs";

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
  await cp(path.join(root, "scripts/desktop/macos-plugin-main.cpp"), path.join(source, "desktop-plugin-main.cpp"));
  const cmake = path.join(source, "CMakeLists.txt");
  const original = await readFile(cmake, "utf8");
  const project = "project(yue2-ggml LANGUAGES C CXX)";
  assert(original.includes(project), "YuE2 CMake project declaration changed");
  const plugins = [executableName, plannerName].map(name =>
    `get_target_property(plugin_sources ${name} SOURCES)
get_target_property(plugin_includes ${name} INCLUDE_DIRECTORIES)
get_target_property(plugin_libraries ${name} LINK_LIBRARIES)
get_target_property(plugin_dependencies ${name} MANUALLY_ADDED_DEPENDENCIES)
add_library(${name}-plugin SHARED \${plugin_sources} desktop-sandbox.mm desktop-plugin-main.cpp)
if(plugin_dependencies)
    add_dependencies(${name}-plugin \${plugin_dependencies})
endif()
target_compile_definitions(${name}-plugin PRIVATE main=music_generator_upstream_main)
target_include_directories(${name}-plugin PRIVATE \${plugin_includes})
target_link_libraries(${name}-plugin PRIVATE \${plugin_libraries} "-framework Foundation")
target_link_options(${name}-plugin PRIVATE "LINKER:-exported_symbol,_music_generator_engine_main_v1")
set_target_properties(${name}-plugin PROPERTIES OUTPUT_NAME ${name} PREFIX "" SUFFIX "")`
  ).join("\n");
  await writeFile(cmake, `${original.replace(project, "project(yue2-ggml LANGUAGES C CXX OBJC OBJCXX)")}\n${plugins}\n`);
  await run("cmake", [
    "-S", source, "-B", build, "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=OFF", "-DCMAKE_POSITION_INDEPENDENT_CODE=ON", "-DGGML_BACKEND_DL=OFF", "-DGGML_NATIVE=OFF", "-DGGML_OPENMP=OFF",
    "-DGGML_ACCELERATE=ON", "-DGGML_BLAS=ON", "-DGGML_BLAS_VENDOR=Apple",
    "-DGGML_METAL=ON", "-DGGML_METAL_EMBED_LIBRARY=ON",
    "-DCMAKE_OSX_ARCHITECTURES=arm64", `-DCMAKE_OSX_DEPLOYMENT_TARGET=${target.minimumSystemVersion}`,
  ]);
  await run("cmake", ["--build", build, "--config", "Release", "--target", `${plannerName}-plugin`, `${executableName}-plugin`, "--parallel", "4"]);

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
  for (const line of dependencies.trimEnd().split("\n").slice(2)) {
    assert(/^\s+\/(usr\/lib|System\/Library)\//.test(line), `YuE2 runner depends on ${line.trim()}`);
  }
  const result = await probeMacPlugin(executable, ["--help"]);
  assert.equal(result.status, 1, `YuE2 runner did not print its CLI contract: ${result.signal || result.stderr}`);
  assert(result.stderr.startsWith(`yue2.cpp ${pin.revision.slice(0, 7)}`), "YuE2 runner revision mismatch");
  for (const arg of arguments_) assert(result.stderr.includes(arg), `YuE2 runner lacks ${arg}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(shipsYue2(), "YuE2 runner target is unavailable");
  const work = await mkdtemp(path.join(tmpdir(), "music-yue2-"));
  const engine = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "src-tauri/resources/engine");
  try { await prepareYue2(engine, work); } finally { await rm(work, { recursive: true, force: true }); }
}
