import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { diffrhythm2Enabled, verifyDiffRhythm2 } from "./prepare-diffrhythm2.mjs";
import { desktopTarget } from "./targets.mjs";

it("only bundles DiffRhythm 2 on explicit Linux CUDA opt-in", () => {
  const cuda = desktopTarget("linux", "x64", "cuda");
  assert.equal(diffrhythm2Enabled(undefined, cuda), false);
  assert.equal(diffrhythm2Enabled("0", cuda), false);
  assert.equal(diffrhythm2Enabled("1", cuda), true);
  assert.throws(() => diffrhythm2Enabled("true", cuda), /must be 0 or 1/);
  for (const target of [desktopTarget("linux", "x64"), desktopTarget("macos", "arm64"), desktopTarget("windows", "x64")]) {
    assert.throws(() => diffrhythm2Enabled("1", target), /requires Linux x86_64/);
  }
});

it("rejects accidental inclusion in a standard bundle and unrecorded experimental runtime files", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "music-diffrhythm2-verification-"));
  try {
    await verifyDiffRhythm2(work, { files: {} }, false);
    await mkdir(path.join(work, "diffrhythm2"));
    await assert.rejects(verifyDiffRhythm2(work, { files: {} }, false), /Unexpected DiffRhythm 2 runtime inventory/);
    await assert.rejects(verifyDiffRhythm2(work, { files: {} }, true), /missing from checksums/);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

it("starts only the app-local Python from a relocated path and preserves request arguments", { skip: process.platform === "win32" }, async () => {
  const work = await mkdtemp(path.join(tmpdir(), "DiffRhythm 2 歌詞 portable test "));
  try {
    const launcher = path.join(work, "diffrhythm2-synth");
    await cp(new URL("./diffrhythm2-runtime/diffrhythm2-synth", import.meta.url), launcher);
    const python = path.join(work, "python/bin/python3.11");
    await mkdir(path.dirname(python), { recursive: true });
    await writeFile(python, '#!/bin/sh\nprintf "%s\\n" "$PYTHONPATH" "$PHONEMIZER_ESPEAK_LIBRARY" "$ESPEAK_DATA_PATH" "$HF_HUB_OFFLINE" "${PYTHONHOME-unset}" "$@"\n');
    await chmod(python, 0o755);
    const output = execFileSync("sh", [launcher, "--lyrics", "歌 something"], {
      encoding: "utf8",
      env: { ...process.env, PYTHONHOME: "/wrong/interpreter" },
    });
    const runtime = await realpath(work);
    assert.deepEqual(output.trimEnd().split("\n"), [
      path.join(runtime, "upstream"), path.join(runtime, "espeak/lib/libespeak-ng.so.1"),
      path.join(runtime, "espeak/share"), "1", "unset", "-s", "-B", path.join(runtime, "runner.py"), "--lyrics", "歌 something",
    ]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
