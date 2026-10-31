import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prepareEngine, engineFolder } from "./prepare-engine.mjs";
import { finalizeLinux } from "./finalize-linux.mjs";
import { createMacDiskImage } from "./macos-dmg.mjs";
import { recordTitle } from "./prepare-title.mjs";
import { architecture, download, exists, files, hash, platform, recordHashes, root, run, target as desktop, verifyEngine } from "./common.mjs";

await prepareEngine(); await verifyEngine(engineFolder);
const output = path.join(root, "release"); await mkdir(output, { recursive: true });
const pkg = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(root,"package.json"),"utf8"));
const name = `Music-Generator-${pkg.version}`;
const cli = path.join(root,"node_modules/@tauri-apps/cli/tauri.js");
const target = path.join(root,"src-tauri/target/release");
let artifact;
const artifacts = [];
if (platform === "macos") {
  // GitHub exposes absent secrets as empty strings; Tauri treats even an empty certificate as configured.
  for (const key of Object.keys(process.env)) if (key.startsWith("APPLE_") && !process.env[key]) delete process.env[key];
  // Match the engine's deployment target, including the Rust supervisor and MP3 helper.
  process.env.MACOSX_DEPLOYMENT_TARGET = desktop.minimumSystemVersion;
  const config = JSON.stringify({ bundle: { macOS: { minimumSystemVersion: desktop.minimumSystemVersion } } });
  await run(process.execPath, [cli,"build","--bundles","app","--config",config]);
  const app = path.join(target,"bundle/macos/Music Generator.app");
  const identity = process.env.APPLE_SIGNING_IDENTITY || "-";
  const helper = path.join(app,"Contents/MacOS/music-engine-supervisor");
  await cp(path.join(target,"music-engine-supervisor"),helper);
  const bundledEngine = path.join(app,"Contents/Resources/engine");
  await rm(bundledEngine,{recursive:true,force:true}); await cp(engineFolder,bundledEngine,{recursive:true});
  for (const file of await files(bundledEngine)) {
    const bytes = await readFile(file);
    if (bytes.length < 4 || ![0xfeedfacf,0xcffaedfe,0xcafebabe].includes(bytes.readUInt32BE(0))) continue;
    const entitlements = ["ace-server", "mp3-codec", "music-title"].includes(path.basename(file)) ? ["--entitlements",path.join(root,"src-tauri/Engine.entitlements")] : [];
    await run("codesign",["--force","--sign",identity,...entitlements,file]);
  }
  await recordTitle(path.join(bundledEngine,"title"));
  const { files: preparedFiles, ...provenance } = await verifyEngine(engineFolder);
  await recordHashes(bundledEngine,{...provenance,prepared_files:preparedFiles});
  await run("codesign",["--force","--sign",identity,"--entitlements",path.join(root,"src-tauri/Engine.entitlements"),helper]);
  // Sign inside out; --deep signing would replace the children's inheritance entitlements.
  await run("codesign",["--force","--sign",identity,"--entitlements",path.join(root,"src-tauri/Entitlements.plist"),app]);
  await run("codesign",["--verify","--deep","--strict",app]);
  if (process.env.APPLE_SIGNING_IDENTITY && process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID) {
    console.log("Tauri signs and notarizes using the configured Apple credentials.");
  }
  artifact = path.join(output,`${name}-macos-${architecture}.zip`);
  await run("ditto",["-c","-k","--sequesterRsrc","--keepParent",app,artifact]);
  const dmg = path.join(output,`${name}-macos-${architecture}.dmg`);
  await createMacDiskImage(app, dmg); artifacts.push(dmg);
} else if (platform === "windows") {
  const runtimeDir = path.join(root,"src-tauri/resources/WebView2");
  if (!await exists(runtimeDir)) {
    const pinned = JSON.parse(await readFile(path.join(root,"models/webview2.json"),"utf8"));
    const cab = path.join(root,".cache/desktop/WebView2.cab");
    await download(pinned.url,cab,pinned.sha256);
    const unpack = path.join(root,".cache/desktop/webview-unpack"); await rm(unpack,{recursive:true,force:true}); await mkdir(unpack,{recursive:true});
    await run("expand.exe",[cab,"-F:*",unpack]);
    const dirs = await readdir(unpack); const extracted = dirs.find(n=>n.startsWith("Microsoft.WebView2.FixedVersionRuntime."));
    if (!extracted) throw new Error("Invalid WebView2 cabinet");
    await cp(path.join(unpack,extracted),runtimeDir,{recursive:true});
  }
  if (!await exists(path.join(runtimeDir,"msedgewebview2.exe"))) throw new Error("WebView2 runtime is incomplete");
  const wix = path.join(target,"bundle/msi");
  await rm(wix,{recursive:true,force:true});
  // Load runtime resources only after preparation; plain cargo tests need no downloaded WebView2.
  const config = path.join(root,"src-tauri/tauri.windows-bundle.conf.json");
  await run(process.execPath,[cli,"build","--bundles","msi","--config",config]);
  const installers = (await readdir(wix)).filter(file=>file.endsWith(".msi"));
  if (installers.length !== 1) throw new Error("Expected exactly one Windows MSI installer");
  const installer = path.join(output,`${name}-windows-x64.msi`);
  await cp(path.join(wix,installers[0]),installer); artifacts.push(installer);
  const portable = path.join(output,`${name}-windows-x64`); await rm(portable,{recursive:true,force:true}); await mkdir(portable,{recursive:true});
  await cp(path.join(target,"music-generator.exe"),path.join(portable,"Music Generator.exe"));
  await cp(engineFolder,path.join(portable,"engine"),{recursive:true});
  await cp(runtimeDir,path.join(portable,"WebView2"),{recursive:true});
  await cp(path.join(root,"LICENSE"),path.join(portable,"LICENSE"));
  await cp(path.join(root,"THIRD_PARTY_NOTICES.md"),path.join(portable,"THIRD_PARTY_NOTICES.md"));
  await cp(path.join(root,"docs/desktop.md"),path.join(portable,"README.md"));
  artifact = `${portable}.zip`;
  // Keep the portable ZIP alongside the installer.
  await run("tar.exe",["-a","-cf",artifact,"-C",output,path.basename(portable)]);
  await rm(portable,{recursive:true,force:true});
} else {
  await run(process.execPath,[cli,"build","--bundles","appimage"]);
  const folder = path.join(target,"bundle/appimage"); const file = (await readdir(folder)).find(n=>n.endsWith(".AppImage"));
  if (!file) throw new Error("AppImage was not generated");
  artifact = path.join(output,`${name}-${desktop.artifactSuffix}`);
  await finalizeLinux(path.join(folder,file), artifact, engineFolder);
}
artifacts.push(artifact);
for (const file of artifacts) {
  await writeFile(`${file}.sha256`,`${await hash(file)}  ${path.basename(file)}\n`);
  console.log(`Ready: ${file}`);
}
