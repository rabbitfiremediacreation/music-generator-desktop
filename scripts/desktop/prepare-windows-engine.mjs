import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { download, files, root, run } from "./common.mjs";
import { checkoutEngineSource, patchWindowsPaths } from "./engine-source.mjs";
import { verifyWindowsPaths } from "./windows-unicode.mjs";
import { verifyRegistryContract } from "./registry-contract.mjs";

export function dllExports(text) {
  const names=[...text.matchAll(/^\s+\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+(\w+)\b/gm)].map(match=>match[1]);
  assert(names.length>0,"Native GGML DLL exports are missing");
  return names;
}

async function visualStudioTools() {
  const vswhere=path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)","Microsoft Visual Studio/Installer/vswhere.exe");
  const installation=execFileSync(vswhere,["-latest","-property","installationPath"],{encoding:"utf8"}).trim();
  const tools=path.join(installation,"VC/Tools/MSVC");
  const versions=(await readdir(tools)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  return path.join(tools,versions[0],"bin/Hostx64/x64");
}

// Rebuild the matching engine core; retain the pinned, checksum-verified CUDA/Vulkan/CPU DLLs.
export async function prepareWindowsEngine(cache, work, source) {
  const archive=path.join(cache,`windows-${source.sha256}.zip`);
  await download(source.url,archive,source.sha256);
  const unpacked=path.join(work,"unpacked");await mkdir(unpacked);
  await run("tar.exe",["-xf",archive,"-C",unpacked]);
  const server=(await files(unpacked)).find(file=>path.basename(file)==="ace-server.exe");
  assert(server,"Pinned archive contains no Windows server");
  const runtime=path.dirname(server);
  const sourceDir=await checkoutEngineSource(work,source);
  await patchWindowsPaths(sourceDir);
  await cp(path.join(root,"scripts/desktop/engine-windows-paths-test.cpp"),path.join(sourceDir,"tools/desktop-windows-paths-test.cpp"));
  await appendFile(path.join(sourceDir,"CMakeLists.txt"),'\nadd_executable(desktop-windows-paths-test tools/desktop-windows-paths-test.cpp tools/desktop-windows-cli.cpp)\nlink_ggml_backends(desktop-windows-paths-test)\n');
  const ggmlRevision=execFileSync("git",["rev-parse","HEAD"],{cwd:path.join(sourceDir,"ggml"),encoding:"utf8"}).trim();
  assert.equal(ggmlRevision,source.ggml_revision,"Windows GGML headers differ from the pinned DLL archive");
  const shim=path.join(work,"ggml-imports");await mkdir(shim);
  await cp(path.join(sourceDir,"ggml/include"),path.join(shim,"include"),{recursive:true});
  await cp(path.join(root,"scripts/desktop/windows-ggml-imports.cmake"),path.join(shim,"CMakeLists.txt"));
  const tools=await visualStudioTools();
  for (const name of ["ggml","ggml-base"]) {
    const exports=dllExports(execFileSync(path.join(tools,"dumpbin.exe"),["/nologo","/exports",path.join(runtime,`${name}.dll`)],{encoding:"utf8"}));
    const definition=path.join(shim,`${name}.def`);
    await writeFile(definition,`LIBRARY ${name}.dll\nEXPORTS\n${exports.join("\n")}\n`);
    await run(path.join(tools,"lib.exe"),["/nologo",`/def:${definition}`,"/machine:x64",`/out:${path.join(shim,`${name}.lib`)}`]);
  }
  const build=path.join(work,"build");
  await run("cmake",["-S",sourceDir,"-B",build,"-G","Visual Studio 17 2022","-A","x64",`-DGGML_SOURCE_DIR=${shim}`,`-DGGML_IMPORT_LIB_DIR=${shim}`,`-DWINDOWS_RUNTIME=${runtime}`]);
  const targets=["ace-server","ace-synth","ace-lm","ace-understand","mp3-codec"];
  await run("cmake",["--build",build,"--config","Release","--target",...targets,"desktop-windows-paths-test","desktop-registry-test","--parallel","2"]);
  await verifyRegistryContract(path.join(build,"Release/desktop-registry-test.exe"),runtime);
  await verifyWindowsPaths(path.join(build,"Release/desktop-windows-paths-test.exe"),runtime);
  for (const name of targets) await cp(path.join(build,"Release",`${name}.exe`),path.join(runtime,`${name}.exe`));
  await rm(path.join(runtime,"SHA256SUMS.txt"),{force:true});
  await writeFile(path.join(runtime,"README.txt"),
    `ACE-Step desktop engine ${source.revision}\n\n`+
    `Engine core rebuilt from ${source.repository} at ${source.source_revision}, with the checked-in desktop iteration, title registry and Windows Unicode path patches.\n`+
    `Rebuilt programs: ${targets.map(name=>`${name}.exe`).join(", ")}.\n`+
    `GGML headers: ${source.ggml_revision}. The original CUDA, Vulkan and CPU runtime DLLs remain unchanged from the SHA-256-pinned archive ${source.sha256}.\n`+
    `The DiT limit is 200 iterations. VERSION.desktop.json contains the final complete runtime inventory and checksums.\n`);
  return runtime;
}
