import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { download, files, root, run } from "./common.mjs";

// linuxdeploy rewrites/strips ELF resources; restore the verified helpers before final packing.
export async function finalizeLinux(image, destination, utilities) {
  const work = await mkdtemp(path.join(tmpdir(), "music-appimage-"));
  try {
    await run(image, ["--appimage-extract"], { cwd: work });
    const appdir = path.join(work, "squashfs-root");
    const record = (await files(appdir)).find(file => path.basename(file) === "TITLE_RUNTIME.json");
    assert(record, "AppImage utilities are missing");
    const bundledUtilities = path.dirname(path.dirname(record));
    await rm(bundledUtilities, { recursive: true, force: true });
    await cp(utilities, bundledUtilities, { recursive: true });
    const pinned = JSON.parse(await readFile(path.join(root, "models/appimage.json"), "utf8"));
    const tool = path.join(root, `.cache/desktop/appimagetool-${pinned.version}.AppImage`);
    await download(pinned.url, tool, pinned.sha256); await chmod(tool, 0o755);
    await run(tool, ["--appimage-extract-and-run", "--no-appstream", appdir, destination], {
      env: { ...process.env, ARCH: "x86_64" },
    });
    await chmod(destination, 0o755);
  } finally { await rm(work, { recursive: true, force: true }); }
}
