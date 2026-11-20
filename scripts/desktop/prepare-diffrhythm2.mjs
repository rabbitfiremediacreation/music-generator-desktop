import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { download, exists, hash, root, run } from "./common.mjs";

const invoke = promisify(execFile);
const recipe = path.join(root, "scripts/desktop/diffrhythm2-runtime");
const pins = {
  diffrhythm2: {
    repository: "https://github.com/ASLP-lab/DiffRhythm2.git",
    revision: "7804f821b797b4f276090e1a9dcd37e97d9915d5",
  },
  espeak: {
    repository: "https://github.com/espeak-ng/espeak-ng.git",
    revision: "4870adfa25b1a32b4361592f1be8a40337c58d6c",
    version: "1.52.0",
  },
  python: {
    version: "3.11.16",
    archive: "cpython-3.11.16+20260825-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz",
    url: "https://github.com/astral-sh/python-build-standalone/releases/download/20260825/cpython-3.11.16%2B20260825-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz",
    sha256: "232f75c9dd6733b41a8101b5076b2a248360722dedded5688f4ac7d5931d8eac",
  },
  phonemizer: {
    version: "3.3.0",
    url: "https://files.pythonhosted.org/packages/c4/ff/3574c55a71b42ad6944a5bf0a7d59f0251ea2ba47e51a5c4005e32e9145c/phonemizer-3.3.0.tar.gz",
    sha256: "5e0c38122effe0b331a24e674aff256874ece169d70a9cf1120337b56f8e3d0c",
  },
  torch: "2.7.0",
  cuda: "12.6",
};

const launcherName = "diffrhythm2-synth";
const recordName = "DIFFRHYTHM2_RUNTIME.json";
const lockName = "requirements-linux-x64.lock";
const buildLockName = "requirements-build.lock";
const phonemizerFiles = "phonemizer-files.json";
const phonemizerSource = "phonemizer-corresponding-source.tar.gz";
export const diffrhythm2ArtifactSuffix = "linux-x64-cuda-diffrhythm2.AppImage";

export function diffrhythm2Enabled(value, target) {
  if (value === undefined || value === "" || value === "0") return false;
  assert.equal(value, "1", "MUSIC_GENERATOR_DIFFRHYTHM2 must be 0 or 1");
  assert(target.platform === "linux" && target.arch === "x64" && target.backend === "cuda",
    "The experimental DiffRhythm 2 bundle requires Linux x86_64 with MUSIC_GENERATOR_LINUX_BACKEND=cuda");
  return true;
}

export async function prepareDiffRhythm2() {
  const work = await mkdtemp(path.join(tmpdir(), "music-diffrhythm2-"));
  const cleanup = () => rm(work, { recursive: true, force: true });
  const folder = path.join(work, "runtime");
  await mkdir(folder);
  try {
    await preparePython(folder);
    await prepareEspeak(folder, work);
    const upstream = path.join(work, "diffrhythm2-source");
    await checkout(upstream, pins.diffrhythm2);
    const bundledSource = path.join(folder, "upstream");
    await mkdir(bundledSource);
    for (const name of ["LICENSE", "README.md", "bigvgan", "diffrhythm2", "g2p"]) {
      await cp(path.join(upstream, name), path.join(bundledSource, name), { recursive: true });
    }
    await lazyJapaneseImport(bundledSource);
    for (const name of [launcherName, "runner.py", lockName, buildLockName, phonemizerFiles]) {
      await cp(path.join(recipe, name), path.join(folder, name));
    }
    await verifyPhonemizerFiles(folder);
    await chmod(path.join(folder, launcherName), 0o755);
    await writeFile(path.join(folder, recordName), `${JSON.stringify(await runtimeRecord(folder), null, 2)}\n`);
    await probe(folder);
    return { folder, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

async function checkout(destination, source) {
  await mkdir(destination);
  await run("git", ["init", "--quiet"], { cwd: destination });
  await run("git", ["-c", "fetch.fsckObjects=true", "fetch", "--quiet", "--depth=1", "--no-tags", source.repository, source.revision], { cwd: destination });
  await run("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], { cwd: destination });
  const result = await invoke("git", ["rev-parse", "HEAD"], { cwd: destination });
  assert.equal(result.stdout.trim(), source.revision, "Unexpected checked-out runtime source revision");
}

async function preparePython(folder) {
  const cache = path.join(root, ".cache/desktop/diffrhythm2");
  const archive = path.join(cache, pins.python.archive);
  await download(pins.python.url, archive, pins.python.sha256);
  const phonemizerArchive = path.join(cache, phonemizerSource);
  await download(pins.phonemizer.url, phonemizerArchive, pins.phonemizer.sha256);
  await cp(phonemizerArchive, path.join(folder, phonemizerSource));
  await run("tar", ["-xf", archive, "-C", folder]);
  const python = path.join(folder, "python/bin/python3.11");
  const result = await invoke(python, ["-I", "--version"]);
  assert.equal(result.stdout.trim(), `Python ${pins.python.version}`);
  const pip = ["-I", "-m", "pip", "--isolated", "--disable-pip-version-check"];
  const install = [...pip, "install", "--index-url", "https://pypi.org/simple", "--no-cache-dir", "--no-compile", "--require-hashes", "--no-deps"];
  await run(python, [...install, "--requirement", path.join(recipe, buildLockName)]);
  await run(python, [...install, "--no-build-isolation", "--requirement", path.join(recipe, lockName)]);
  await run(python, [...pip, "check"]);
}

async function prepareEspeak(folder, work) {
  const source = path.join(work, "espeak-source");
  const build = path.join(work, "espeak-build");
  const install = path.join(work, "espeak-install");
  const runtime = path.join(folder, "espeak");
  await checkout(source, pins.espeak);
  const script = path.join(recipe, "build-espeak.sh");
  await run("sh", [script, source, build, install]);
  const library = path.join(runtime, "lib/libespeak-ng.so.1");
  await mkdir(path.dirname(library), { recursive: true });
  await mkdir(path.join(runtime, "share"));
  await cp(path.join(install, "usr/share/espeak-ng-data"), path.join(runtime, "share/espeak-ng-data"), { recursive: true });
  await cp(path.join(install, "usr/lib/libespeak-ng.so.1"), library, { dereference: true });
  await run("patchelf", ["--remove-rpath", library]);
  await cp(script, path.join(source, "build-bundled-espeak.sh"));
  await run("tar", ["-czf", path.join(runtime, "espeak-ng-corresponding-source.tar.gz"), "--exclude=.git", "-C", work, path.basename(source)]);
  for (const name of await readdir(source)) {
    if (name.startsWith("COPYING")) await cp(path.join(source, name), path.join(runtime, name));
  }
}

async function lazyJapaneseImport(upstream) {
  // The selected en/zh path is unchanged and does not load the Japanese dictionary.
  const file = path.join(upstream, "g2p/g2p/cleaners.py");
  const source = await readFile(file, "utf8");
  const statement = "from g2p.g2p.japanese import japanese_to_ipa";
  const condition = '    elif language == "ja":\n';
  assert(source.includes(`${statement}\n`) && source.includes(condition), "Unexpected pinned G2P cleaners source");
  const modified = `${condition}        # Music Generator enables English and Mandarin lyrics.\n        ${statement}\n\n`;
  await writeFile(file, source.replace(`${statement}\n`, "").replace(condition, modified));
}

async function runtimeRecord(folder) {
  const [requirements, buildRequirements, phonemizerData] = await Promise.all(
    [lockName, buildLockName, phonemizerFiles].map(name => hash(path.join(folder, name))),
  );
  return { ...pins, requirements_sha256: requirements, build_requirements_sha256: buildRequirements, phonemizer_files_sha256: phonemizerData };
}

async function verifyPhonemizerFiles(folder) {
  const { repository, revision, files } = JSON.parse(await readFile(path.join(folder, phonemizerFiles), "utf8"));
  assert.equal(repository, pins.diffrhythm2.repository);
  assert.equal(revision, pins.diffrhythm2.revision);
  for (const [relative, { bytes, sha256 }] of Object.entries(files)) {
    assert(relative.startsWith("g2p/") && !relative.split("/").includes(".."), `Invalid phonemizer path: ${relative}`);
    const file = path.join(folder, "upstream", relative);
    assert.equal((await stat(file)).size, bytes, `Incorrect phonemizer data size: ${relative}`);
    assert.equal(await hash(file), sha256, `Incorrect phonemizer data checksum: ${relative}`);
  }
}

async function probe(folder) {
  const launcher = path.join(folder, launcherName);
  const { stdout } = await invoke(launcher, ["--check-runtime"], {
    timeout: 120_000,
    env: { ...process.env, CUDA_VISIBLE_DEVICES: "" },
  });
  const result = JSON.parse(stdout.trim().split("\n").at(-1));
  assert.equal(result.torch_version.split("+")[0], pins.torch, "Unexpected bundled PyTorch version");
  assert.equal(result.cuda_version, pins.cuda, "Expected the PyTorch CUDA build");
  assert.equal(result.phonemizer, "ok", "The bundled phonemizer failed its runtime check");
  console.log("DiffRhythm 2 bundled phonemizer and CUDA-enabled PyTorch loaded for the model-free package check.");
}

export async function verifyDiffRhythm2(engine, provenance, expected) {
  const folder = path.join(engine, "diffrhythm2");
  assert.equal(await exists(folder), expected, "Unexpected DiffRhythm 2 runtime inventory in the desktop bundle");
  if (!expected) return;
  for (const name of [launcherName, recordName, lockName, buildLockName, "runner.py", phonemizerFiles, phonemizerSource, "espeak/espeak-ng-corresponding-source.tar.gz"]) {
    assert(provenance.files[`diffrhythm2/${name}`], `DiffRhythm 2 runtime missing from checksums: ${name}`);
  }
  const record = JSON.parse(await readFile(path.join(folder, recordName), "utf8"));
  assert.deepEqual(record, await runtimeRecord(recipe));
  await verifyPhonemizerFiles(folder);
  await probe(folder);
}
