import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { download, exists, hash, root, run } from "../common.mjs";
import { pluginLinkerFlags, probeMacPlugin } from "../macos-plugin.mjs";

const exec = promisify(execFile);
const recipe = fileURLToPath(new URL(".", import.meta.url));
const cache = path.join(root, ".cache/desktop/audiocraft");
const python = {
  archive: "cpython-3.11.15-macos-arm64.tar.gz",
  url: "https://github.com/astral-sh/python-build-standalone/releases/download/20260807/cpython-3.11.15%2B20260807-aarch64-apple-darwin-install_only_stripped.tar.gz",
  sha256: "76b27e15a5be9539b830fc698e2646d001b84a66500eeb5228cee46909d6f2cf",
};
const audiocraft = {
  archive: "audiocraft-1.3.0.tar.gz",
  url: "https://files.pythonhosted.org/packages/5e/f2/3403638d5074ec68f1d0ad0dd48beb10569b69d401714593e4e143c17965/audiocraft-1.3.0.tar.gz",
  sha256: "d82ade3eb4f934ee1adb438ae687a2bf59d33ca4a20039beab072548c038ac80",
};
const requirements = path.join(recipe, "requirements-macos-arm64.txt");
const buildRequirements = path.join(recipe, "build-requirements-macos-arm64.txt");
const patchFile = path.join(recipe, "audiocraft-local.patch");

async function extract(source, workspace) {
  const archive = path.join(cache, source.archive);
  await download(source.url, archive, source.sha256);
  await run("/usr/bin/tar", ["-xzf", archive, "-C", workspace]);
}

async function installDependencies(interpreter) {
  const pip = ["-IB", "-m", "pip", "--isolated", "--disable-pip-version-check", "--cache-dir", path.join(cache, "pip")];
  const install = ["install", "--require-hashes", "--no-deps", "--no-compile"];
  const packages = path.join(cache, "packages");
  if (await exists(packages)) {
    install.push("--no-index", "--find-links", packages);
  }
  await run(interpreter, [...pip, ...install, "--only-binary", ":all:", "-r", buildRequirements]);
  await run(interpreter, [...pip, ...install, "--no-build-isolation", "-r", requirements]);
  await run(interpreter, [...pip, "check"]);
  await run(interpreter, [...pip, "uninstall", "--yes", "wheel", "setuptools", "pip"]);
}

async function removeExternalAudioBackends(sitePackages) {
  const plugins = [
    ["torio/lib", /^(?:lib|_)torio_ffmpeg\d*\.so$/],
    ["torchaudio/lib", /^(?:lib|_)torchaudio_sox\.so$/],
  ];
  // The text-only runner writes PCM WAV directly. These optional TorchAudio plugins probe
  // for system FFmpeg or SoX libraries, so keep only the installed runtime's tensor operations.
  for (const [relativePath, plugin] of plugins) {
    const folder = path.join(sitePackages, relativePath);
    for (const file of await readdir(folder)) {
      if (plugin.test(file)) await rm(path.join(folder, file));
    }
  }
}

export async function prepareAudiocraft(destination) {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("The AudioCraft runtime is available for arm64 macOS CPU builds");
  }
  destination = path.resolve(destination);
  if (await exists(destination)) throw new Error(`AudioCraft runtime destination already exists: ${destination}`);
  await mkdir(path.dirname(destination), { recursive: true });
  const workspace = await mkdtemp(path.join(path.dirname(destination), ".audiocraft-"));
  try {
    const bundle = path.join(workspace, "runtime");
    await mkdir(bundle);
    await extract(python, bundle);
    await extract(audiocraft, workspace);
    const source = path.join(workspace, "audiocraft-1.3.0");
    const embedded = path.join(bundle, "python");
    const interpreter = path.join(embedded, "bin/python3.11");
    const library = path.join(embedded, "lib/libpython3.11.dylib");
    const sitePackages = path.join(embedded, "lib/python3.11/site-packages");

    await installDependencies(interpreter);
    await removeExternalAudioBackends(sitePackages);
    await run("/usr/bin/patch", ["-p1", "-i", patchFile], { cwd: source });
    await cp(path.join(source, "audiocraft"), path.join(sitePackages, "audiocraft"), { recursive: true });
    await cp(path.join(source, "LICENSE"), path.join(bundle, "LICENSE-AudioCraft"));
    await cp(path.join(recipe, "audiocraft_synth.py"), path.join(bundle, "audiocraft_synth.py"));

    const libraryId = "@rpath/libpython3.11.dylib";
    const { stdout } = await exec("/usr/bin/otool", ["-D", library]);
    if (stdout.trim().split("\n").at(-1) !== libraryId) {
      await run("/usr/bin/install_name_tool", ["-id", libraryId, library]);
      await run("/usr/bin/codesign", ["--force", "--sign", "-", library]);
    }
    const executable = path.join(bundle, "audiocraft-synth");
    await run("/usr/bin/xcrun", [
      "clang++", "-std=c++17", "-arch", "arm64", "-mmacosx-version-min=14.0",
      `-I${path.join(embedded, "include/python3.11")}`, `-L${path.join(embedded, "lib")}`,
      ...pluginLinkerFlags, "-Wl,-rpath,@loader_path/python/lib", "-lpython3.11", "-framework", "Foundation",
      '-DMUSIC_PYTHON_SCRIPT="audiocraft_synth.py"',
      path.join(root, "scripts/desktop/embedded-python-plugin.cpp"), path.join(root, "scripts/desktop/engine-sandbox.mm"),
      "-o", executable,
    ]);
    await rm(path.join(embedded, "bin"), { recursive: true });
    await rm(path.join(embedded, "include"), { recursive: true });
    console.log("Verifying the bundled AudioCraft CPU runtime…");
    const probe = await probeMacPlugin(executable, ["--self-test"], { env: { PATH: "" }, timeout: 60000 });
    if (probe.status !== 0 || probe.stdout.trim() !== "audiocraft-synth/1") {
      throw new Error(`Unexpected AudioCraft protocol: ${probe.stderr || probe.stdout}`);
    }

    const metadata = {
      revision: "72cb16f9fb239e9cf03f7bd997198c7d7a67a01c+desktop.1",
      python,
      audiocraft,
      patch_sha256: await hash(patchFile),
      requirements_sha256: await hash(requirements),
      build_requirements_sha256: await hash(buildRequirements),
    };
    await writeFile(path.join(bundle, "audiocraft-runtime.json"), JSON.stringify(metadata, null, 2) + "\n");
    await rename(bundle, destination);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [, , destination] = process.argv;
  if (!destination || process.argv.length !== 3) {
    throw new Error("Usage: node scripts/desktop/audiocraft-runtime/prepare.mjs <new-destination>");
  }
  await prepareAudiocraft(destination);
}
