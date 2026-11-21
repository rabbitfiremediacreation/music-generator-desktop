import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, open, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { root, run } from "./common.mjs";

export const pluginLinkerFlags = [
  "-dynamiclib",
  "-Wl,-exported_symbol,_music_generator_engine_main_v1",
];

export async function prepareArm64MachO(file) {
  const header = Buffer.alloc(4);
  const fd = await open(file);
  try {
    if ((await fd.read(header)).bytesRead !== header.length) return;
  } finally {
    await fd.close();
  }
  if (![0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf].includes(header.readUInt32BE())) return;
  const archs = execFileSync("lipo", ["-archs", file], { encoding: "utf8" }).trim().split(/\s+/);
  if (!archs.includes("arm64")) throw new Error(`Missing arm64 slice: ${file}`);
  if (archs.length > 1) {
    const thin = `${file}.arm64`;
    await run("lipo", [file, "-thin", "arm64", "-output", thin]);
    await rename(thin, file);
  }
  await run("codesign", ["--force", "--sign", "-", file], { stdio: ["ignore", "ignore", "pipe"] });
}

// Build-time checks run without the packaged sandbox supervisor.
export async function probeMacPlugin(plugin, args, options = {}) {
  const work = await mkdtemp(path.join(tmpdir(), "music-engine-plugin-"));
  try {
    const probe = path.join(work, "probe");
    await run("/usr/bin/xcrun", ["clang++",
      path.join(root, "scripts/desktop/macos-plugin-probe.cpp"), "-o", probe]);
    const result = spawnSync(probe, [path.resolve(plugin), ...args], {
      encoding: "utf8", timeout: 15000, ...options,
    });
    if (result.error) throw result.error;
    return result;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
