import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { download, files, recordHashes, root, run, target, verifyEngine } from "./common.mjs";
import { verifyLinuxRuntime } from "./linux-runtime.mjs";
import { verifyDiffRhythm2 } from "./prepare-diffrhythm2.mjs";

// linuxdeploy rewrites/strips ELF resources; restore the verified engine before final packing.
export async function finalizeLinux(image, destination, engine, diffrhythm2Runtime) {
  const work = await mkdtemp(path.join(tmpdir(), "music-appimage-"));
  try {
    await run(image, ["--appimage-extract"], { cwd: work });
    const appdir = path.join(work, "squashfs-root");
    const record = (await files(appdir)).find(file => path.basename(file) === "VERSION.desktop.json");
    assert(record, "AppImage engine resources are missing");
    const bundledEngine = path.dirname(record);
    await rm(bundledEngine, { recursive: true, force: true });
    await cp(engine, bundledEngine, { recursive: true });
    if (diffrhythm2Runtime) {
      // Preserve wheel loader paths and leave the standard build and runtime cache intact.
      await cp(diffrhythm2Runtime, path.join(bundledEngine, "diffrhythm2"), {
        recursive: true,
        verbatimSymlinks: true,
      });
      const provenance = JSON.parse(await readFile(path.join(bundledEngine, "VERSION.desktop.json"), "utf8"));
      await recordHashes(bundledEngine, provenance);
    }
    const provenance = await verifyEngine(bundledEngine);
    await verifyDiffRhythm2(bundledEngine, provenance, Boolean(diffrhythm2Runtime));
    await verifyLinuxRuntime(bundledEngine, target.backend, appdir);
    const pinned = JSON.parse(await readFile(path.join(root, "models/appimage.json"), "utf8"));
    const tool = path.join(root, `.cache/desktop/appimagetool-${pinned.version}.AppImage`);
    await download(pinned.url, tool, pinned.sha256); await chmod(tool, 0o755);
    await run(tool, ["--appimage-extract-and-run", "--no-appstream", appdir, destination], {
      env: { ...process.env, ARCH: "x86_64" },
    });
    await chmod(destination, 0o755);
  } finally { await rm(work, { recursive: true, force: true }); }
}
