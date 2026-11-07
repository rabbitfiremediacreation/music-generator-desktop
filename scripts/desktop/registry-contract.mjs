import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const pin = JSON.parse(await readFile(new URL("../../models/title-model.json", import.meta.url)));

// Header-only fixtures exercise the real GGUF parser, not inference or checksums.
function gguf(architecture) {
  const parts = [];
  const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value); parts.push(b); };
  const u64 = value => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); parts.push(b); };
  const string = value => { const b = Buffer.from(value); u64(b.length); parts.push(b); };
  parts.push(Buffer.from("GGUF")); u32(3); u64(0); u64(architecture === undefined ? 0 : 1);
  if (architecture !== undefined) {
    string("general.architecture");
    if (typeof architecture === "string") { u32(8); string(architecture); }
    else { u32(4); u32(architecture); }
  }
  const header = Buffer.concat(parts), result = Buffer.alloc(Math.ceil(header.length / 32) * 32);
  header.copy(result);
  return result;
}

// Runs on every native engine build, including Windows with the pinned GGML DLLs.
export async function verifyRegistryContract(executable, runtime = path.dirname(executable)) {
  const work = await mkdtemp(path.join(tmpdir(), "desktop-registry-"));
  const music = ["acestep-lm", "acestep-dit", "acestep-text-enc", "acestep-vae"];
  const warning = name => `[Registry] WARNING: skipping ${name} (unknown architecture)`;
  try {
    const check = async (name, entries, expected, warnings, title = false) => {
      const folder = path.join(work, name);
      await mkdir(folder);
      for (const [filename, bytes] of entries) await writeFile(path.join(folder, filename), bytes);
      const result = spawnSync(executable, [folder], {
        cwd: runtime, encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: `${runtime}${path.delimiter}${process.env.PATH || ""}` },
      });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      assert.equal(result.stdout.trim(), expected, `Music registry changed in ${name}`);
      for (const [filename, bytes] of entries) {
        assert.deepEqual(await readFile(path.join(folder, filename)), bytes, "Scan modified a model");
      }
      const actual = result.stderr.split(/\r?\n/).filter(line => line.startsWith("[Registry] WARNING:"));
      assert.deepEqual(actual, warnings.map(warning).sort(), `${name}: ${result.stderr}`);
      if (title) assert(result.stderr.includes(`[Registry] ${pin.model.file} -> title model (handled separately)`));
      return result.stderr;
    };
    const models = music.map((arch, i) => [`music-${i}.gguf`, gguf(arch)]);
    const log = await check("shared M\u00fcller \u6771\u4eac", [
      ...models, [pin.model.file, gguf("qwen3")], ["unknown.gguf", gguf("future-music")],
      ["broken.gguf", Buffer.from("broken")], ["other-qwen.gguf", gguf("qwen3")],
    ], "1 1 1 1 1", ["broken.gguf", "other-qwen.gguf", "unknown.gguf"], true);
    for (const [i, type] of ["LM", "DiT", "Text-Enc", "VAE"].entries()) {
      assert(log.includes(`[Registry] music-${i}.gguf -> ${type}`));
    }
    await check("title-only", [[pin.model.file, gguf("qwen3")]], "0 0 0 0 0", [], true);
    for (const [name, bytes] of [
      ["unknown-title", gguf("future-music")], ["broken-title", Buffer.from("broken")],
      ["truncated-title", gguf("qwen3").subarray(0, 36)],
      ["missing-architecture", gguf()], ["invalid-architecture-type", gguf(7)],
    ]) await check(name, [[pin.model.file, bytes]], "0 0 0 0 0", [pin.model.file]);
    // A music model is classified by metadata even if it has the title model's filename.
    await check("music-with-title-name", [[pin.model.file, gguf("acestep-lm")]], "1 1 0 0 0", []);
    console.log("Registry contract passed: shared folder, title-only, unknown and damaged models.");
  } finally { await rm(work, { recursive: true, force: true }); }
}
