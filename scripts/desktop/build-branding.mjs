import path from "node:path";

export function buildBranding(tag = "") {
  if (/^develop-[1-9]\d*$/.test(tag)) return "dev";
  if (/^daily-[1-9]\d*$/.test(tag)) return "nightly";
  return "";
}

export async function buildIconConfig(branding, work, cli) {
  if (!branding) return {};
  const { root, run } = await import("./common.mjs");
  const artwork = path.join(root, "static", "branding", `${branding}.svg`);
  const icons = path.join(work, "brand-icons");
  await run(process.execPath, [cli, "icon", artwork, "--output", icons]);
  // Tauri's WiX resource iterator drops the drive prefix from absolute paths.
  const bundlePath = process.platform === "win32"
    ? path.relative(path.join(root, "src-tauri"), icons).split(path.sep).join("/")
    : icons;
  return {
    icon: ["32x32.png", "128x128.png", "128x128@2x.png", "icon.icns", "icon.ico"].map(file => path.posix.join(bundlePath, file)),
  };
}
