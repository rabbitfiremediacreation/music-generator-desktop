import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { root, run, target } from "./common.mjs";
import { pluginLinkerFlags, prepareArm64MachO } from "./macos-plugin.mjs";

export async function prepareText2midi(engine, python, packages) {
  const resources = path.join(root, "src-tauri/resources/text2midi");
  const folder = path.join(engine, "text2midi");
  const launcher = path.join(folder, "text2midi-runner");
  await mkdir(folder, { recursive: true });
  for (const name of ["text2midi.py", "vocab_remi.json", "LICENSE.upstream", "LICENSE.vocab", "NOTICE"]) {
    await cp(path.join(resources, name), path.join(folder, name));
  }
  await cp(path.join(resources, "decoder.py"), path.join(packages, "decoder.py"));
  await run("/usr/bin/xcrun", [
    "clang++", "-std=c++17", "-arch", "arm64", `-mmacosx-version-min=${target.minimumSystemVersion}`,
    "-I", path.join(python, "include/python3.11"), '-DMUSIC_PYTHON_SCRIPT="text2midi.py"',
    '-DMUSIC_PYTHON_HOME="../pytorch"',
    path.join(root, "scripts/desktop/embedded-python-plugin.cpp"),
    path.join(root, "scripts/desktop/engine-sandbox.mm"),
    path.join(python, "lib/libpython3.11.dylib"), "-framework", "Foundation", ...pluginLinkerFlags,
    "-Wl,-rpath,@loader_path/../pytorch/lib", "-o", launcher,
  ]);
  await prepareArm64MachO(launcher);
}
