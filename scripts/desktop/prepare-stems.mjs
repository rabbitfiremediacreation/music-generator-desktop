import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { download, root, run, target } from "./common.mjs";
import { pluginLinkerFlags, probeMacPlugin } from "./macos-plugin.mjs";

export const stemRuntimeFiles = [
  "prepare-stems.mjs", "stems-runtime/runner.py", "stems-runtime/requirements-macos-arm64.txt",
];
const folder = path.join(root, "scripts/desktop/stems-runtime");
const source = {
  file: "demucs-4.0.1.tar.gz",
  url: "https://files.pythonhosted.org/packages/87/38/55f835ebd9f443465087a6954ede19d4a41aebdf5e28567e89b99d6d2f57/demucs-4.0.1.tar.gz",
  sha256: "e45a5a788bae79767c37bbf6e69aae03862ddcca05550fb79b926346a177d713",
};

export async function prepareStems({ cache, python, interpreter, packages, uv }) {
  const archive = path.join(cache, source.file);
  await download(source.url, archive, source.sha256);
  const code = path.join(path.dirname(python), "demucs-source");
  await mkdir(code);
  await run("tar", ["-xf", archive, "-C", code, "--strip-components=1", "demucs-4.0.1/demucs", "demucs-4.0.1/LICENSE"]);
  await cp(path.join(code, "demucs"), path.join(packages, "demucs"), { recursive: true });
  const licenses = path.join(python, "licenses", "demucs");
  await mkdir(licenses, { recursive: true });
  await cp(path.join(code, "LICENSE"), path.join(licenses, "LICENSE"));
  const requirements = path.join(folder, "requirements-macos-arm64.txt");
  await run(uv, ["--no-config", "--cache-dir", path.join(cache, "uv-cache"), "pip", "install",
    "--python", interpreter, "--python-platform", "aarch64-apple-darwin", "--target", packages,
    "--require-hashes", "--no-build", "--no-deps", "--link-mode", "copy", "-r", requirements]);
  await cp(path.join(folder, "runner.py"), path.join(python, "stem_runner.py"));
  const executable = path.join(python, "stem-runner");
  await run("clang++", [
    "-std=c++17", "-O2", "-arch", "arm64", `-mmacosx-version-min=${target.minimumSystemVersion}`,
    '-DMUSIC_PYTHON_HOME="."', '-DMUSIC_PYTHON_SCRIPT="stem_runner.py"',
    "-I", path.join(python, "include/python3.11"), path.join(root, "scripts/desktop/embedded-python-plugin.cpp"),
    path.join(python, "lib/libpython3.11.dylib"), ...pluginLinkerFlags, "-Wl,-rpath,@loader_path/lib", "-o", executable,
  ]);
  return { ...source, bytes: (await stat(archive)).size };
}

export async function verifyStems(python) {
  const executable = path.join(python, "stem-runner");
  const result = await probeMacPlugin(executable, ["probe"], { timeout: 60000 });
  const status = result.status === 0 && JSON.parse(result.stdout.trim().split("\n").at(-1));
  if (status?.engine !== "demucs" || status.version !== "4.0.1") {
    throw Error(`Demucs plug-in self-test failed: ${result.stderr || result.stdout}`);
  }
}
