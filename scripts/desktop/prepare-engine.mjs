import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareTitle, recordTitle, verifyTitle } from "./prepare-title.mjs";
import { cudaBuildOptions, prepareCuda } from "./prepare-cuda.mjs";
import { copyCudaRuntime, relocateLinuxRuntime } from "./linux-runtime.mjs";
import { checkoutEngineSource } from "./engine-source.mjs";
import { prepareWindowsEngine } from "./prepare-windows-engine.mjs";
import { verifyIterationContract } from "./engine-contract.mjs";
import { verifyRegistryContract } from "./registry-contract.mjs";
import { architecture, engineRecipeHash, exists, files, hash, manifest, platform, recordHashes, root, run, target, verifyEngine } from "./common.mjs";

export const engineFolder = path.join(root, "src-tauri/resources/engine");

export async function prepareEngine() {
  try { await verifyEngine(engineFolder); await verifyTitle(); console.log("Engine resources verified."); return; } catch { /* Rebuild incomplete or changed resources. */ }
  const source = manifest.engines[platform];
  const cache = path.join(root, ".cache/desktop"); await mkdir(cache, { recursive: true });
  const work = await mkdtemp(path.join(tmpdir(), "music-engine-"));
  try {
    let built;
    if (platform === "linux" || platform === "macos") {
      const sourceDir = await checkoutEngineSource(work, source);
      built = path.join(sourceDir, "build");
      if (platform === "macos") {
        // New libc++ headers expose float from_chars even when the deployment OS lacks it.
        await run("git", ["apply", path.join(root,"scripts/desktop/patches/acestep-macos-compat.patch")], { cwd: sourceDir });
        await cp(path.join(root,"scripts/desktop/engine-sandbox.mm"), path.join(sourceDir,"desktop-sandbox.mm"));
        const cmake = path.join(sourceDir,"CMakeLists.txt");
        await writeFile(cmake,(await readFile(cmake,"utf8")).replace("LANGUAGES C CXX)","LANGUAGES C CXX OBJC OBJCXX)"));
        await appendFile(cmake, '\ntarget_sources(ace-server PRIVATE desktop-sandbox.mm)\ntarget_link_libraries(ace-server PRIVATE "-framework Foundation")\n');
      }
      const options = [...target.cmake];
      if (target.backend === "cuda") options.push(...await cudaBuildOptions());
      await run("cmake", ["-S", sourceDir, "-B", built, "-DCMAKE_BUILD_TYPE=Release", ...options]);
      await run("cmake", ["--build", built, "--config", "Release", "-j", "2"]);
      await verifyRegistryContract(path.join(built,"desktop-registry-test"));
      for (const file of await files(sourceDir)) if (/^(LICENSE|COPYING)/i.test(path.basename(file))) await cp(file, path.join(built, `LICENSE-${path.relative(sourceDir,file).replaceAll(path.sep,"-")}`));
    } else {
      built = await prepareWindowsEngine(cache, work, source);
    }
    const iterationLimit = await verifyIterationContract(path.join(built, platform === "windows" ? "ace-server.exe" : "ace-server"));
    await rm(engineFolder, { recursive: true, force: true }); await mkdir(engineFolder, { recursive: true }); await writeFile(path.join(engineFolder,".gitkeep"), "");
    // Preserve the complete runtime directory, including dynamically loaded GPU backends.
    for (const file of await files(built)) {
      const relative = path.relative(built, file);
      if (relative.split(path.sep).some((p) => p === "CMakeFiles" || p === "_deps") || /\.(o|a|obj|pdb|lib)$/.test(file) || path.basename(file) === "desktop-registry-test") continue;
      const dest = path.join(engineFolder, relative); await mkdir(path.dirname(dest), { recursive: true }); await cp(file, dest, { dereference: true });
      if (platform === "linux" && /\.so(?:\.\d+)*$/.test(file) && path.dirname(dest) !== engineFolder) await cp(file, path.join(engineFolder,path.basename(file)), { dereference: true });
    }
    if (platform === "macos") await relocateMac();
    if (platform === "windows") await copyWindowsCrt();
    await prepareTitle();
    if (platform === "linux") {
      if (target.backend === "cuda") await copyCudaRuntime(engineFolder, await prepareCuda());
      await relocateLinuxRuntime(engineFolder);
      // Relocation changes helper bytes after their initial provenance was written.
      await recordTitle();
    }
    await recordHashes(engineFolder, { platform, arch: architecture, backend: target.backend, revision: source.revision, source: source.url || source.repository, source_revision: source.source_revision || source.revision, archive_sha256: source.sha256 || null, max_inference_steps:iterationLimit, sandbox_patch_sha256: platform === "macos" ? await hash(path.join(root,"scripts/desktop/engine-sandbox.mm")) : null, recipe_sha256: await engineRecipeHash() });
    await verifyEngine(engineFolder);
    console.log(`Prepared ${platform} engine ${source.revision}.`);
  } finally { await rm(work, { recursive: true, force: true }); }
}

async function copyWindowsCrt() {
  const vswhere = path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)","Microsoft Visual Studio/Installer/vswhere.exe");
  const installation = execFileSync(vswhere,["-latest","-property","installationPath"],{encoding:"utf8"}).trim();
  const redistRoot = path.join(installation,"VC/Redist/MSVC");
  const versions=(await readdir(redistRoot)).filter(n=>/^\d/.test(n)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  const candidates=await files(path.join(redistRoot,versions[0],"x64"));
  for (const file of candidates) if (/^(vcruntime140(?:_1)?|msvcp140(?:_[12])?|concrt140)\.dll$/i.test(path.basename(file))) await cp(file,path.join(engineFolder,path.basename(file)));
}

async function relocateMac() {
  const all = await files(engineFolder);
  for (const file of all) {
    const bytes = await readFile(file);
    if (bytes.length < 4 || ![0xfeedfacf,0xcffaedfe,0xcafebabe].includes(bytes.readUInt32BE(0))) continue;
    const headers = execFileSync("otool", ["-l", file], { encoding: "utf8" });
    for (const match of headers.matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (.+?) \(offset/g)) {
      if (match[1].startsWith("/")) await run("install_name_tool", ["-delete_rpath", match[1], file]);
    }
    if (!headers.includes("path @loader_path (offset")) await run("install_name_tool", ["-add_rpath", "@loader_path", file]);
    const dependencies = execFileSync("otool", ["-L", file], { encoding: "utf8" });
    for (const line of dependencies.split("\n").slice(1)) {
      const dependency = line.trim().split(" (compatibility")[0];
      if (dependency.startsWith("/") && !dependency.startsWith("/usr/lib/") && !dependency.startsWith("/System/") && await exists(path.join(engineFolder, path.basename(dependency)))) await run("install_name_tool", ["-change", dependency, `@loader_path/${path.basename(dependency)}`, file]);
    }
    const inheritance = ["ace-server", "mp3-codec"].includes(path.basename(file)) ? ["--entitlements",path.join(root,"src-tauri/Engine.entitlements")] : [];
    await run("codesign", ["--force", "--sign", "-", ...inheritance, file]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareEngine();
