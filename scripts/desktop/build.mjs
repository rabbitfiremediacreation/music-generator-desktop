import { cp, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { macSigningSettings, withMacSigning } from "./macos-signing.mjs";
import { installSparkle, macUpdaterSettings, writeAppcast } from "./macos-updater.mjs";
import yue2 from "../../models/yue2-runtime.json" with { type: "json" };
import { prepareEngine, engineFolder } from "./prepare-engine.mjs";
import { finalizeLinux } from "./finalize-linux.mjs";
import { createMacDiskImage } from "./macos-dmg.mjs";
import { recordTitle } from "./prepare-title.mjs";
import { diffrhythm2ArtifactSuffix, diffrhythm2Enabled, prepareDiffRhythm2 } from "./prepare-diffrhythm2.mjs";
import { recordMagenta, verifyMagenta } from "./prepare-magenta.mjs";
import { architecture, download, exists, files, hash, platform, recordHashes, root, run, target as desktop, verifyEngine } from "./common.mjs";

const diffRhythm2 = diffrhythm2Enabled(process.env.MUSIC_GENERATOR_DIFFRHYTHM2, desktop);
const audioCraft = process.argv.includes("--audiocraft");
if (audioCraft && (platform !== "macos" || architecture !== "arm64")) {
  throw new Error("The experimental AudioCraft bundle requires macOS arm64");
}
const output = path.join(root, "release"); await mkdir(output, { recursive: true });
const pkg = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(root,"package.json"),"utf8"));
const signing = platform === "macos" ? macSigningSettings(process.env) : null;
const updater = platform === "macos" && !audioCraft ? macUpdaterSettings(process.env, pkg.version) : null;
const updateNotes = updater && process.env.MUSIC_GENERATOR_UPDATE_NOTES
  ? await readFile(process.env.MUSIC_GENERATOR_UPDATE_NOTES, "utf8") : undefined;
for (const key of Object.keys(process.env)) {
  if (key.startsWith("APPLE_") || key === "SPARKLE_PRIVATE_KEY") delete process.env[key];
}
await prepareEngine(); await verifyEngine(engineFolder);
const name = `Music-Generator-${pkg.version}`;
const cli = path.join(root,"node_modules/@tauri-apps/cli/tauri.js");
const target = path.join(root,"src-tauri/target/release");
let artifact;
const artifacts = [];
if (platform === "macos") {
  process.env.MACOSX_DEPLOYMENT_TARGET = desktop.minimumSystemVersion;
  const config = JSON.stringify({ bundle: { macOS: { minimumSystemVersion: desktop.minimumSystemVersion } } });
  await run(process.execPath, [cli, "build", "--bundles", "app", "--no-sign", "--config", config]);
  const app = path.join(target, "bundle/macos/Music Generator.app");
  // Tauri includes every Cargo binary; macOS uses the main executable for MCP stdio.
  await rm(path.join(app, "Contents/MacOS/music-generator-mcp"), { force: true });
  const helper = path.join(app, "Contents/MacOS/music-engine-supervisor");
  await cp(path.join(target, "music-engine-supervisor"), helper);
  const bundledEngine = path.join(app, "Contents/Resources/engine");
  await rm(bundledEngine, { recursive: true, force: true });
  await cp(engineFolder, bundledEngine, { recursive: true, verbatimSymlinks: true });
  if (audioCraft) {
    await run(process.execPath, [
      path.join(root, "scripts/desktop/audiocraft-runtime/prepare.mjs"),
      path.join(bundledEngine, "audiocraft"),
    ]);
  }

  const work = await mkdtemp(path.join(tmpdir(), "music-mac-release-"));
  try {
    await withMacSigning(signing, async (sign, notarize) => {
      const executableNames = ["ace-server", "mp3-codec", "music-title", "audiocpp_cli", "mrt2-record", "audiocraft-synth", "mimetic-synth", path.basename(yue2.executable), path.basename(yue2.planner)];
      const inherit = ["--entitlements", path.join(root, "src-tauri/Engine.entitlements")];
      for (const file of await files(bundledEngine)) {
        const handle = await open(file);
        const magic = Buffer.alloc(4);
        try {
          if ((await handle.read(magic)).bytesRead < magic.length) continue;
        } finally {
          await handle.close();
        }
        if (![0xfeedfacf, 0xcffaedfe, 0xcafebabe].includes(magic.readUInt32BE(0))) continue;
        await sign(file, executableNames.includes(path.basename(file)) ? inherit : []);
      }
      await recordTitle(path.join(bundledEngine, "title"));
      const magenta = path.join(bundledEngine, "magenta");
      if (await exists(magenta)) {
        await recordMagenta(magenta);
        await verifyMagenta(magenta);
      }
      const { files: preparedFiles, ...provenance } = await verifyEngine(engineFolder);
      await recordHashes(bundledEngine, { ...provenance, prepared_files: preparedFiles });
      await sign(helper, inherit);
      const signer = updater ? await installSparkle(app, work, updater, sign) : null;
      // Seal the final application after every resource and nested executable is in place.
      await sign(app, ["--entitlements", path.join(root, "src-tauri/Entitlements.plist")]);
      await run("codesign", ["--verify", "--deep", "--strict", app]);
      const zip = destination => run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, destination]);
      if (notarize) {
        const submission = path.join(work, "notary-submission.zip");
        await zip(submission);
        await notarize(submission, app);
        await rm(submission);
        await run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
      }
      const suffix = audioCraft ? "-audiocraft" : "";
      artifact = path.join(output, `${name}-macos-${architecture}${suffix}.zip`);
      await zip(artifact);
      const dmg = path.join(output, `${name}-macos-${architecture}${suffix}.dmg`);
      await createMacDiskImage(app, dmg);
      if (notarize) {
        await sign(dmg);
        await notarize(dmg, dmg);
      }
      artifacts.push(dmg);
      if (signer) artifacts.push(await writeAppcast(signer, output, artifact, updater, desktop.minimumSystemVersion, updateNotes));
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
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
  await cp(path.join(target,"music-generator-mcp.exe"),path.join(portable,"music-generator-mcp.exe"));
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
  const runtime = diffRhythm2 ? await prepareDiffRhythm2() : undefined;
  try {
    await run(process.execPath,[cli,"build","--bundles","appimage"]);
    const folder = path.join(target,"bundle/appimage"); const file = (await readdir(folder)).find(n=>n.endsWith(".AppImage"));
    if (!file) throw new Error("AppImage was not generated");
    const suffix = diffRhythm2 ? diffrhythm2ArtifactSuffix : desktop.artifactSuffix;
    artifact = path.join(output,`${name}-${suffix}`);
    await finalizeLinux(path.join(folder,file), artifact, engineFolder, runtime?.folder);
  } finally {
    await runtime?.cleanup();
  }
}
artifacts.push(artifact);
for (const file of artifacts) {
  await writeFile(`${file}.sha256`,`${await hash(file)}  ${path.basename(file)}\n`);
  console.log(`Ready: ${file}`);
}
