import { mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import pinned from "../../models/webview2.json" with { type: "json" };
import { download, exists, root, run } from "./common.mjs";

export async function prepareWebView() {
  const resources = path.join(root, "src-tauri/resources");
  const runtime = path.join(resources, "WebView2");
  if (await exists(path.join(runtime, "msedgewebview2.exe"))) return runtime;

  const cab = path.join(root, ".cache/desktop/WebView2.cab");
  await download(pinned.url, cab, pinned.sha256);
  await mkdir(resources, { recursive: true });
  const unpack = await mkdtemp(path.join(resources, ".webview-"));
  try {
    await run("expand.exe", [cab, "-F:*", unpack]);
    const extracted = (await readdir(unpack)).find(name => name.startsWith("Microsoft.WebView2.FixedVersionRuntime."));
    if (!extracted || !await exists(path.join(unpack, extracted, "msedgewebview2.exe"))) {
      throw new Error("WebView2 runtime is incomplete");
    }
    await rm(runtime, { recursive: true, force: true });
    await rename(path.join(unpack, extracted), runtime);
    return runtime;
  } finally {
    await rm(unpack, { recursive: true, force: true });
  }
}
