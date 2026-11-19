import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { audioCppDirectory, audioCppSupported, download, root, run, target } from "./common.mjs";

const pin = JSON.parse(await readFile(path.join(root, "models/audio-cpp-runtime.json"), "utf8"));

export async function prepareAudioCpp(engineFolder, cache, work) {
  if (!audioCppSupported(target)) return;

  const { macos_arm64_metal: archive, heartmula_spec: spec, revision } = pin;
  const archiveFile = path.join(cache, `audio-cpp-${revision}-macos-arm64.tar.gz`);
  const specFile = path.join(cache, `audio-cpp-${revision}-heartmula.json`);
  await download(archive.url, archiveFile, archive.sha256);
  await download(`https://raw.githubusercontent.com/0xShug0/audio.cpp/${revision}/${spec.path}`, specFile, spec.sha256);
  if ((await stat(archiveFile)).size !== archive.bytes || (await stat(specFile)).size !== spec.bytes) {
    throw new Error("Wrong size for pinned audio.cpp input");
  }

  const sdk = path.join(work, "audio-cpp-sdk");
  const folder = path.join(engineFolder, audioCppDirectory);
  const library = path.join(folder, "libaudiocpp.0.dylib");
  const launcher = path.join(folder, "audiocpp_cli");
  await mkdir(sdk);
  // Extract the C SDK components used by the native launcher.
  await run("tar", ["-xf", archiveFile, "-C", sdk, "./include/audiocpp.h", "./libs/libaudiocpp.0.1.0.dylib", "./LICENSE"]);
  await mkdir(path.join(folder, "model_specs"), { recursive: true });
  await cp(path.join(sdk, "libs/libaudiocpp.0.1.0.dylib"), library);
  await cp(path.join(sdk, "LICENSE"), path.join(folder, "LICENSE"));
  await cp(specFile, path.join(folder, spec.path));
  await run("xcrun", [
    "clang++", "-arch", "arm64", `-mmacosx-version-min=${target.minimumSystemVersion}`, "-std=c++20", "-O2",
    "-I", path.join(sdk, "include"), path.join(root, "scripts/desktop/audio-cpp-launcher.cpp"),
    path.join(root, "scripts/desktop/engine-sandbox.mm"), library, "-framework", "Foundation",
    "-Wl,-rpath,@loader_path", "-o", launcher,
  ]);
  await run("codesign", ["--force", "--sign", "-", library]);
  // Development callers run outside App Sandbox. build.mjs signs the packaged helper for inheritance.
  await run("codesign", ["--force", "--sign", "-", launcher]);
  if (execFileSync(launcher, ["--version"], { encoding: "utf8", timeout: 60000 }).trim() !== `audio.cpp ${pin.version}`) {
    throw new Error("Pinned audio.cpp runtime did not report the expected version");
  }
}
