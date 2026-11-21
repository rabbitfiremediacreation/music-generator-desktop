import { cp, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { macSigningSettings, withMacSigning } from "./macos-signing.mjs";
import { installSparkle, macUpdaterSettings, writeAppcast } from "./macos-updater.mjs";
import { prepareEngine, engineFolder } from "./prepare-engine.mjs";
import { finalizeLinux } from "./finalize-linux.mjs";
import { packageEngines, utilityResources } from "./engine-packages.mjs";
import { createMacDiskImage } from "./macos-dmg.mjs";
import { recordTitle } from "./prepare-title.mjs";
import { diffrhythm2ArtifactSuffix, diffrhythm2Enabled, prepareDiffRhythm2 } from "./prepare-diffrhythm2.mjs";
import { recordMagenta, verifyMagenta } from "./prepare-magenta.mjs";
import { buildBranding, buildIconConfig } from "./build-branding.mjs";
import { architecture, download, exists, files, hash, platform, root, run, target as desktop, verifyEngine } from "./common.mjs";

const diffRhythm2 = diffrhythm2Enabled(process.env.MUSIC_GENERATOR_DIFFRHYTHM2, desktop);
const audioCraft = process.argv.includes("--audiocraft");
if (audioCraft && (platform !== "macos" || architecture !== "arm64")) {
  throw new Error("The experimental AudioCraft bundle requires macOS arm64");
}
const output = path.resolve(process.env.MUSIC_GENERATOR_RELEASE_DIR || path.join(root, "release"));
await mkdir(output, { recursive: true });
const pkg = JSON.parse(await readFile(path.join(root,"package.json"),"utf8"));
const signing = platform === "macos" ? macSigningSettings(process.env) : null;
const updater = platform === "macos" && !audioCraft ? macUpdaterSettings(process.env, pkg.version) : null;
const updateNotes = updater && process.env.MUSIC_GENERATOR_UPDATE_NOTES
  ? await readFile(process.env.MUSIC_GENERATOR_UPDATE_NOTES, "utf8") : undefined;
for (const key of Object.keys(process.env)) {
  if (key.startsWith("APPLE_") || key === "SPARKLE_PRIVATE_KEY") delete process.env[key];
}
await prepareEngine();
const provenance = await verifyEngine(engineFolder);
const name = `Music-Generator-${pkg.version}`;
const cli = path.join(root,"node_modules/@tauri-apps/cli/tauri.js");
const target = path.join(root,"src-tauri/target/release");
let artifact;
const artifacts = [];
const resources = { "resources/desktop-utilities/": "engine/" };
const work = await mkdtemp(path.join(tmpdir(), "music-desktop-release-"));
async function pack(source = engineFolder) {
  const packages = await packageEngines({ source, provenance, version: pkg.version, output, work });
  process.env.MUSIC_GENERATOR_ENGINE_PACKAGES = packages.manifest;
  artifacts.push(...packages.artifacts);
  return packages.artifacts.filter(file => file.endsWith(".zip"));
}
try {
  const icons = await buildIconConfig(buildBranding(process.env.MUSIC_GENERATOR_UPDATE_BUILD), work, cli);
  if (platform === "macos") {
    process.env.MACOSX_DEPLOYMENT_TARGET = desktop.minimumSystemVersion;
    const config = JSON.stringify({ bundle: { resources, ...icons, macOS: { minimumSystemVersion: desktop.minimumSystemVersion } } });
    const app = path.join(target, "bundle/macos/Music Generator.app");
    const signedEngine = path.join(work, "signed");
    await cp(engineFolder, signedEngine, { recursive: true, verbatimSymlinks: true });
    if (audioCraft) {
      await run(process.execPath, [
        path.join(root, "scripts/desktop/audiocraft-runtime/prepare.mjs"),
        path.join(signedEngine, "audiocraft"),
      ]);
    }

    await withMacSigning(signing, async (sign, notarize) => {
      const executableNames = ["mp3-codec", "music-title"];
      const inherit = ["--entitlements", path.join(root, "src-tauri/Engine.entitlements")];
      const stagingRoot = await realpath(signedEngine);
      const codeFiles = new Map();
      for (const file of await files(signedEngine)) {
        const handle = await open(file);
        const magic = Buffer.alloc(4);
        try {
          if ((await handle.read(magic)).bytesRead < magic.length) continue;
        } finally {
          await handle.close();
        }
        if (![0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf].includes(magic.readUInt32BE(0))) continue;
        const target = await realpath(file);
        if (!target.startsWith(stagingRoot + path.sep)) throw new Error(`Engine symlink leaves its staging directory: ${file}`);
        codeFiles.set(target, executableNames.includes(path.basename(file)) ? inherit : []);
      }
      const entries = [...codeFiles];
      for (let index = 0; index < entries.length; index += 6) {
        await Promise.all(entries.slice(index, index + 6).map(([file, flags]) => sign(file, flags)));
      }
      await recordTitle(path.join(signedEngine, "title"));
      const magenta = path.join(signedEngine, "magenta");
      if (await exists(magenta)) {
        await recordMagenta(magenta);
        await verifyMagenta(magenta);
      }
      const engineArchives = await pack(signedEngine);
      if (notarize) await Promise.all(engineArchives.map(archive => notarize(archive)));
      await run(process.execPath, [cli, "build", "--bundles", "app", "--no-sign", "--config", config]);
      // Tauri includes every Cargo binary; macOS uses the main executable for MCP stdio.
      await rm(path.join(app, "Contents/MacOS/music-generator-mcp"), { force: true });
      const helper = path.join(app, "Contents/MacOS/music-engine-supervisor");
      await cp(path.join(target, "music-engine-supervisor"), helper);
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
  } else if (platform === "windows") {
    await pack();
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
    const config = JSON.parse(await readFile(path.join(root,"src-tauri/tauri.windows-bundle.conf.json"), "utf8"));
    Object.assign(config.bundle.resources, resources);
    Object.assign(config.bundle, icons);
    await run(process.execPath,[cli,"build","--bundles","msi","--config",JSON.stringify(config)]);
    const installers = (await readdir(wix)).filter(file=>file.endsWith(".msi"));
    if (installers.length !== 1) throw new Error("Expected exactly one Windows MSI installer");
    const installer = path.join(output,`${name}-windows-x64.msi`);
    await cp(path.join(wix,installers[0]),installer); artifacts.push(installer);
    const portable = path.join(output,`${name}-windows-x64`); await rm(portable,{recursive:true,force:true}); await mkdir(portable,{recursive:true});
    await cp(path.join(target,"music-generator.exe"),path.join(portable,"Music Generator.exe"));
    await cp(path.join(target,"music-generator-mcp.exe"),path.join(portable,"music-generator-mcp.exe"));
    await cp(utilityResources,path.join(portable,"engine"),{recursive:true});
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
      let source = engineFolder;
      if (runtime) {
        source = path.join(work, "linux-runtime");
        await cp(engineFolder, source, { recursive: true, verbatimSymlinks: true });
        await cp(runtime.folder, path.join(source, "diffrhythm2"), { recursive: true, verbatimSymlinks: true });
      }
      await pack(source);
      await run(process.execPath,[cli,"build","--bundles","appimage","--config",JSON.stringify({ bundle: { resources, ...icons } })]);
      const folder = path.join(target,"bundle/appimage"); const file = (await readdir(folder)).find(n=>n.endsWith(".AppImage"));
      if (!file) throw new Error("AppImage was not generated");
      const suffix = diffRhythm2 ? diffrhythm2ArtifactSuffix : desktop.artifactSuffix;
      artifact = path.join(output,`${name}-${suffix}`);
      await finalizeLinux(path.join(folder,file), artifact, utilityResources);
    } finally {
      await runtime?.cleanup();
    }
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
artifacts.push(artifact);
for (const file of artifacts) {
  await writeFile(`${file}.sha256`,`${await hash(file)}  ${path.basename(file)}\n`);
  console.log(`Ready: ${file}`);
}
