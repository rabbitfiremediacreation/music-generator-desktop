import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { desktopTarget } from "./targets.mjs";
import yue2 from "../../models/yue2-runtime.json" with { type: "json" };

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const manifest = JSON.parse(await readFile(path.join(root, "models/manifest.json"), "utf8"));
export const platform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
export const architecture = process.arch;
export const target = desktopTarget(platform, architecture, process.env.MUSIC_GENERATOR_LINUX_BACKEND || "vulkan");
export const aceMacPlugin = "libace-server-plugin.dylib";
export const audioCppDirectory = "providers/audio.cpp";
export const audioCppRuntime = JSON.parse(await readFile(path.join(root, "models/audio-cpp-runtime.json"), "utf8"));

export function audioCppSupported(buildTarget) {
  return buildTarget.platform === "macos" && buildTarget.arch === "arm64";
}

export function shipsYue2(buildTarget = target) {
  return buildTarget.platform === yue2.platform && buildTarget.arch === yue2.arch;
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

export async function hash(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

export async function exists(file) { return stat(file).then(() => true, () => false); }

export async function files(folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await files(file)); else if (entry.isFile() || (entry.isSymbolicLink() && (await stat(file)).isFile())) result.push(file);
  }
  return result;
}

export async function download(url, file, checksum) {
  if (await exists(file) && (!checksum || await hash(file) === checksum)) return;
  await mkdir(path.dirname(file), { recursive: true });
  console.log(`Downloading ${new URL(url).pathname.split("/").pop()}…`);
  await run(process.platform === "win32" ? "curl.exe" : "curl", ["--fail", "--location", "--retry", "3", "--output", file, url]);
  if (checksum && await hash(file) !== checksum) throw new Error(`Checksum mismatch: ${file}`);
}
