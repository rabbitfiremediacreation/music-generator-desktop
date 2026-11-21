import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { architecture, download, exists, files, hash, platform, root, run, target } from "./common.mjs";
import { pluginLinkerFlags, prepareArm64MachO, probeMacPlugin } from "./macos-plugin.mjs";
import { prepareStems, stemRuntimeFiles, verifyStems } from "./prepare-stems.mjs";
import { prepareText2midi } from "./prepare-text2midi.mjs";

const cache = path.join(root, ".cache/desktop/mimetic-runtime");
const directory = path.join(root, "scripts/desktop/mimetic-runtime");
const shim = path.join(root, "scripts/desktop/engine-sandbox.mm");
const midiResources = path.join(root, "src-tauri/resources/text2midi");
const sources = {
  mimetic: {
    file: "mimetic-a0.tar.gz",
    url: "https://codeload.github.com/micknoise/mimetic-a0/tar.gz/c4331b95f2db653c6268973a3096c8f0a77a4a61",
    bytes: 146434,
    sha256: "cf7cf40a757cc12cfecde09446f85a55330566caf0f96d0a9619d645838c2067",
  },
  stableAudio: {
    file: "stable-audio-tools.tar.gz",
    url: "https://codeload.github.com/Stability-AI/stable-audio-tools/tar.gz/3241adba4fc2a85cf5b29d9eb68d42f40a28e820",
    bytes: 415778,
    sha256: "43f84b9f63f051776c3cf808dd84561abf7785e0d66d603b85d8e44c1a863fdb",
  },
  t5License: {
    file: "t5-LICENSE",
    url: "https://raw.githubusercontent.com/google-research/text-to-text-transfer-transformer/42909aa15d1fbd16c69333aa474a00ae8ed9fde4/LICENSE",
    bytes: 11358,
    sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
  },
  python: {
    file: "python.tar.gz",
    url: "https://github.com/astral-sh/python-build-standalone/releases/download/20251014/cpython-3.11.14%2B20251014-aarch64-apple-darwin-install_only_stripped.tar.gz",
    bytes: 18836160,
    sha256: "cd54cc868a9b1056fbd4654509431f402f0365329618e2583b60c82f73da4e56",
  },
  uv: {
    file: "uv.whl",
    url: "https://files.pythonhosted.org/packages/ea/00/08f4e93989129bb3378f20315dddcac6f8cf26a12bdd90443a340e7ecdb4/uv-0.8.24-py3-none-macosx_11_0_arm64.whl",
    bytes: 18187983,
    sha256: "a2bd708a545c1c21d7be8575f4cff00d0cff26be13fc81e3f7e54b8751fb90c0",
  },
};

function supportsPyTorchBundle() {
  return platform === "macos" && architecture === "arm64";
}

async function recipe() {
  const paths = [fileURLToPath(import.meta.url), ...await files(directory), shim,
    ...["macos-plugin.mjs", "prepare-text2midi.mjs", "embedded-python-plugin.cpp", ...stemRuntimeFiles].map(file => path.join(root, "scripts/desktop", file)),
    ...["text2midi.py", "decoder.py", "vocab_remi.json", "LICENSE.upstream", "LICENSE.vocab", "NOTICE"].map(file => path.join(midiResources, file))];
  return { target: target.minimumSystemVersion, hashes: await Promise.all(paths.sort().map(hash)) };
}

async function extract(archive, destination) {
  await mkdir(destination, { recursive: true });
  await run("tar", ["-xf", path.join(cache, archive), "-C", destination, "--strip-components=1"]);
}

async function retainLicenses(runtime, mimetic, stableAudio) {
  const licenses = path.join(runtime, "licenses");
  const mimeticLicenses = path.join(licenses, "mimetic-a0");
  const stableAudioLicenses = path.join(licenses, "stable-audio-tools");
  const t5Licenses = path.join(licenses, "t5-base");
  await mkdir(mimeticLicenses, { recursive: true });
  await mkdir(stableAudioLicenses, { recursive: true });
  await mkdir(t5Licenses, { recursive: true });
  await Promise.all([
    cp(path.join(mimetic, "LICENSE"), path.join(mimeticLicenses, "LICENSE")),
    cp(path.join(mimetic, "NOTICE"), path.join(mimeticLicenses, "NOTICE")),
    cp(path.join(stableAudio, "LICENSE"), path.join(stableAudioLicenses, "LICENSE")),
    cp(path.join(stableAudio, "LICENSES"), path.join(stableAudioLicenses, "third-party"), { recursive: true }),
    cp(path.join(cache, sources.t5License.file), path.join(t5Licenses, "LICENSE")),
  ]);
}

async function verifyMimeticRuntime(destination) {
  const executable = path.join(destination, "mimetic-synth");
  const result = await probeMacPlugin(executable, ["--self-test"], { timeout: 600000 });
  if (result.status !== 0) throw Error(`Mimetic A0 self-test failed: ${result.stderr}`);
  const details = JSON.parse(result.stdout.trim().split("\n").at(-1));
  if (details.runtime !== "mimetic-a0" || details.python !== "3.11.14" || details.torch !== "2.7.1" || !details.isolated) {
    throw Error("Unexpected Mimetic A0 runtime revision");
  }
  return details;
}

export async function preparePyTorch(destination = path.join(root, "src-tauri/resources/engine")) {
  if (!supportsPyTorchBundle()) return;
  const desiredRecipe = await recipe();
  const executable = path.join(destination, "mimetic-synth");
  const runtime = path.join(destination, "pytorch");
  const midi = path.join(destination, "text2midi");
  const marker = "PYTORCH_RUNTIME.json";
  const previous = await readFile(path.join(runtime, marker), "utf8").then(JSON.parse).catch(() => null);
  if (JSON.stringify(previous?.recipe) === JSON.stringify(desiredRecipe)
    && await exists(executable) && await exists(path.join(midi, "text2midi-runner"))
    && await exists(path.join(runtime, "stem-runner"))) return;

  await mkdir(cache, { recursive: true });
  await Promise.all(Object.values(sources).map(async source => {
    const archive = path.join(cache, source.file);
    await download(source.url, archive, source.sha256);
    if ((await stat(archive)).size !== source.bytes) throw Error(`Unexpected Mimetic A0 source size: ${source.file}`);
  }));
  const work = await mkdtemp(path.join(cache, "build-"));
  try {
    const mimetic = path.join(work, "source");
    const stableAudio = path.join(work, "stable-audio-tools");
    const python = path.join(work, "pytorch");
    const stage = path.join(work, "mimetic-synth");
    await Promise.all([
      extract(sources.mimetic.file, mimetic),
      extract(sources.stableAudio.file, stableAudio),
      extract(sources.python.file, python),
    ]);
    const uvRoot = path.join(work, "uv");
    const interpreter = path.join(python, "bin/python3.11");
    await run(interpreter, ["-I", "-B", "-m", "zipfile", "-e", path.join(cache, sources.uv.file), uvRoot]);
    const uv = path.join(uvRoot, "uv-0.8.24.data/scripts/uv");
    await run("chmod", ["755", uv]);
    const requirements = path.join(work, "requirements.txt");
    await run(uv, ["--no-config", "--cache-dir", path.join(cache, "uv-cache"), "export", "--frozen", "--no-dev", "--no-emit-project", "--no-emit-package", "stable-audio-tools", "--output-file", requirements, "--quiet"], { cwd: mimetic });
    const packages = path.join(python, "lib/python3.11/site-packages");
    const wheelhouse = path.join(cache, "wheelhouse");
    await mkdir(wheelhouse, { recursive: true });
    await run(uv, [
      "--no-config", "--cache-dir", path.join(cache, "uv-cache"), "pip", "sync", requirements,
      "--python", interpreter, "--python-platform", "aarch64-apple-darwin", "--target", packages,
      "--find-links", wheelhouse, "--link-mode", "copy", "--require-hashes", "--no-build",
    ], { env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: target.minimumSystemVersion } });
    await run(uv, [
      "--no-config", "--cache-dir", path.join(cache, "uv-cache"), "pip", "install",
      "--python", interpreter, "--python-platform", "aarch64-apple-darwin", "--target", packages,
      "--require-hashes", "--no-build", "--no-deps", "--link-mode", "copy", "-r", path.join(directory, "requirements-midi.txt"),
    ]);
    await cp(path.join(stableAudio, "stable_audio_tools"), path.join(packages, "stable_audio_tools"), { recursive: true });
    const packageRoot = path.join(packages, "mimetic_a0");
    await mkdir(packageRoot);
    await Promise.all(["__init__.py", "model.py", "generate.py"].map(file => cp(path.join(mimetic, "mimetic_a0", file), path.join(packageRoot, file))));
    await retainLicenses(python, mimetic, stableAudio);
    await cp(path.join(directory, "generate_clip.py"), path.join(python, "generate_clip.py"));

    const lib = path.join(python, "lib/libpython3.11.dylib");
    await run("install_name_tool", ["-id", "@rpath/libpython3.11.dylib", lib]);
    await run("clang++", [
      "-std=c++17", "-O2", "-arch", "arm64", `-mmacosx-version-min=${target.minimumSystemVersion}`,
      "-I", path.join(python, "include/python3.11"), path.join(directory, "launcher.cpp"), shim,
      lib, "-framework", "Foundation", ...pluginLinkerFlags, "-Wl,-rpath,@loader_path/pytorch/lib", "-o", stage,
    ]);
    await prepareText2midi(work, python, packages);
    const demucs = await prepareStems({ cache, python, interpreter, packages, uv });
    await Promise.all([
      rm(path.join(python, "bin"), { recursive: true, force: true }),
      rm(path.join(python, "include"), { recursive: true, force: true }),
      rm(path.join(python, "lib/pkgconfig"), { recursive: true, force: true }),
      rm(path.join(python, "lib/python3.11/ensurepip"), { recursive: true, force: true }),
      rm(path.join(python, "share/man"), { recursive: true, force: true }),
      rm(path.join(packages, "bin"), { recursive: true, force: true }),
    ]);
    for (const file of [stage, ...await files(python)]) await prepareArm64MachO(file);
    const details = await verifyMimeticRuntime(work);
    await verifyStems(python);
    const midiCheck = await probeMacPlugin(path.join(work, "text2midi/text2midi-runner"), ["--self-test"], { timeout: 60000 });
    if (midiCheck.status !== 0 || midiCheck.stdout.trim() !== "text2midi-runner/1") {
      throw new Error(`Text2midi plug-in self-test failed: ${midiCheck.stderr || midiCheck.stdout}`);
    }
    const bytes = (await stat(stage)).size + (await Promise.all((await files(python)).map(file => stat(file).then(result => result.size)))).reduce((sum, size) => sum + size, 0);
    await writeFile(path.join(python, marker), JSON.stringify({ recipe: desiredRecipe, sources: { ...sources, demucs }, details, bytes }, null, 2) + "\n");
    await mkdir(destination, { recursive: true });
    await rm(runtime, { recursive: true, force: true });
    await rm(midi, { recursive: true, force: true });
    await rm(path.join(destination, "mimetic-python"), { recursive: true, force: true });
    await rm(executable, { force: true });
    await cp(python, runtime, { recursive: true, verbatimSymlinks: true });
    await cp(path.join(work, "text2midi"), midi, { recursive: true });
    await cp(stage, executable);
    console.log(`Prepared shared PyTorch runtime (${bytes} bytes).`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!supportsPyTorchBundle()) throw Error("The shared PyTorch runtime requires Apple Silicon");
  await preparePyTorch(process.argv[2] && path.resolve(process.argv[2]));
}
