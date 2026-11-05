import { cp } from "node:fs/promises";
import path from "node:path";
import { root, run } from "./common.mjs";

export async function patchEngineSource(sourceDir, source) {
  await cp(path.join(root,"scripts/desktop/engine-generation-limits.h"),path.join(sourceDir,"src/desktop-generation-limits.h"));
  const patch=source?.iterations_patch || "acestep-iterations.patch";
  await run("git",["apply",path.join(root,"scripts/desktop/patches",patch)],{cwd:sourceDir});
}

export async function patchWindowsPaths(sourceDir) {
  await cp(path.join(root,"scripts/desktop/engine-windows-paths.h"),path.join(sourceDir,"src/desktop-windows-paths.h"));
  await cp(path.join(root,"scripts/desktop/engine-windows-cli.cpp"),path.join(sourceDir,"tools/desktop-windows-cli.cpp"));
  await run("git",["apply",path.join(root,"scripts/desktop/patches/acestep-windows-unicode.patch")],{cwd:sourceDir});
}

export async function checkoutEngineSource(work, source) {
  const sourceDir=path.join(work,"source");
  await run("git",["clone","--filter=blob:none","--no-checkout",source.repository,sourceDir]);
  await run("git",["checkout",source.source_revision],{cwd:sourceDir});
  await run("git",["submodule","update","--init","--recursive"],{cwd:sourceDir});
  await patchEngineSource(sourceDir,source);
  return sourceDir;
}
