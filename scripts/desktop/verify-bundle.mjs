import { verifyTitle } from "./prepare-title.mjs";
import assert from "node:assert/strict";
import { once } from "node:events";
import { execFileSync, spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { architecture, exists, files, hash, platform, root, run, target, verifyEngine } from "./common.mjs";
import { verifyMacSandbox } from "./verify-macos-sandbox.mjs";
import { verifyLinuxRuntime } from "./linux-runtime.mjs";
import { verifyIterationContract } from "./engine-contract.mjs";
import { msiArguments } from "./windows-msi.mjs";

function startupLocation(app) {
  return JSON.parse(execFileSync(app, ["--startup-location-probe"], { encoding: "utf8", timeout: 15000 }));
}

// Exercise the distributed files from a relocated directory, without loading any models.
const output = path.join(root, "release");
const diskImage = process.argv.includes("--dmg");
const installer = process.argv.includes("--msi");
assert(!installer || platform === "windows", "MSI verification requires Windows");
assert(!diskImage || platform === "macos", "DMG verification requires macOS");
const suffix = installer ? "-windows-x64.msi" : diskImage ? `-macos-${architecture}.dmg` : platform === "linux" ? `-${target.artifactSuffix}` : `-${platform}-${architecture}.zip`;
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const filename = `Music-Generator-${version}${suffix}`;
const artifact = path.join(output, filename);
assert(await exists(artifact), `Platform bundle is missing: ${filename}`);
assert.equal(await hash(artifact), (await readFile(`${artifact}.sha256`, "utf8")).split(/\s/)[0]);
const work = await mkdtemp(path.join(tmpdir(), "Music Generator portable test "));
const mount = path.join(work, "mounted");
let mounted = false;
let installed = false;
const installDir = path.join(work, "installed app");
const installerLogs = path.join(root, "test-results/windows-msi");
if (installer) await mkdir(installerLogs, { recursive: true });
async function msiexec(operation, logName, directory) {
  const log = path.join(installerLogs, logName);
  console.log(`Windows Installer ${operation}: ${artifact}; log: ${log}`);
  try {
    await run("msiexec.exe", msiArguments(operation, artifact, log, directory), {
      windowsVerbatimArguments: true, timeout: 10 * 60 * 1000,
    });
    console.log(`Windows Installer ${operation} completed.`);
  } catch (error) {
    if (await exists(log)) {
      const bytes = await readFile(log);
      const text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.toString("utf16le") : bytes.toString("utf8");
      console.error(text.slice(-24000));
    }
    throw error;
  }
}
try {
  if (installer) {
    await msiexec("/i", "install.log", installDir);
    installed = true;
  } else if (diskImage) {
    await run("hdiutil", ["verify", artifact]);
    await mkdir(mount);
    await run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, artifact]);
    mounted = true;
    assert.equal(await readlink(path.join(mount, "Applications")), "/Applications");
    const mountedApp = path.join(mount, "Music Generator.app/Contents/MacOS/music-generator");
    assert.equal(startupLocation(mountedApp).installation_required, true, "App must require installation while running from the read-only DMG");
    await run("ditto", [path.join(mount, "Music Generator.app"), path.join(work, "Music Generator.app")]);
    await run("hdiutil", ["detach", mount]); mounted = false;
  } else if (platform === "linux") {
    await chmod(artifact, 0o755);
    await run(artifact, ["--appimage-extract"], { cwd: work });
  } else if (platform === "windows") {
    await run("tar.exe", ["-xf", artifact, "-C", work]);
  } else {
    await run("ditto", ["-x", "-k", artifact, work]);
  }
  const extracted = await files(installer ? installDir : work);
  const record = extracted.find(file => path.basename(file) === "VERSION.desktop.json");
  assert(record, "Bundled engine manifest is missing");
  const engine = path.dirname(record);
  await verifyEngine(engine);
  await verifyTitle(path.join(engine,"title"),false);
  if(platform!=="macos") { const text=execFileSync(path.join(engine,"title",platform==="windows"?"music-title.exe":"music-title"),["--self-test"],{encoding:"utf8",timeout:30000});assert(text.includes("music-title=ready"),"Title runtime did not start"); }
  if(platform==="linux")await verifyLinuxRuntime(engine,target.backend,path.join(work,"squashfs-root"));
  const app = extracted.find(file => path.basename(file) === (platform === "windows" ? (installer ? "music-generator.exe" : "Music Generator.exe") : "music-generator"));
  assert(app, "Application executable is missing");
  await verifyIterationContract(path.join(engine,platform === "windows" ? "ace-server.exe" : "ace-server"),app);
  const probe = JSON.parse(execFileSync(app, ["--synthesis-backend-probe", engine, "--cpu"], { cwd: engine, encoding: "utf8", timeout: 15000 }).trim().split(/\r?\n/).at(-1));
  assert.equal(probe, "cpu", "Relocated model-free backend probe must initialize the CPU runtime");
  if (platform === "macos") await run("codesign", ["--verify", "--deep", "--strict", path.dirname(path.dirname(path.dirname(app)))]);
  if (platform === "windows") {
    assert(await exists(path.join(path.dirname(app), "WebView2/msedgewebview2.exe")), "Fixed WebView2 is missing");
    for (const dll of ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"]) {
      assert(await exists(path.join(engine, dll)), `Engine runtime ${dll} is missing`);
    }
  }
  if (platform === "macos") {
    assert.equal(startupLocation(app).installation_required, false, "Copied app must start after ejecting the DMG");
    const expectedArch = architecture === "x64" ? "x86_64" : "arm64";
    for (const file of extracted) {
      const bytes = await readFile(file);
      if (bytes.length < 4 || ![0xfeedfacf,0xcffaedfe,0xcafebabe].includes(bytes.readUInt32BE(0))) continue;
      assert.equal(execFileSync("lipo", ["-archs", file], { encoding: "utf8" }).trim(), expectedArch, `Wrong Mach-O architecture: ${file}`);
      const headers = execFileSync("otool", ["-l", file], { encoding: "utf8" });
      const versions = [...headers.matchAll(/cmd LC_BUILD_VERSION[\s\S]*?\n\s+minos ([\d.]+)|cmd LC_VERSION_MIN_MACOSX[\s\S]*?\n\s+version ([\d.]+)/g)];
      assert(versions.length, `No macOS deployment target in ${file}`);
      for (const version of versions) {
        const actual = (version[1] || version[2]).split(".").map(Number); while (actual.length < 3) actual.push(0);
        const limit = target.minimumSystemVersion.split(".").map(Number); limit.push(0);
        assert(actual[0] < limit[0] || (actual[0] === limit[0] && (actual[1] < limit[1] || (actual[1] === limit[1] && actual[2] <= limit[2]))), `Higher deployment target in ${file}: ${version[1] || version[2]}`);
      }
    }
    const bundle = path.dirname(path.dirname(path.dirname(app)));
    const minimum = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :LSMinimumSystemVersion", path.join(bundle, "Contents/Info.plist")], { encoding: "utf8" }).trim();
    assert.equal(minimum, target.minimumSystemVersion);
    const identifier = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", path.join(bundle, "Contents/Info.plist")], { encoding: "utf8" }).trim();
    assert.equal(identifier, "de.alphatester.music-generator", "Unexpected package identifier");
    if (target.cpuOnly) {
      assert(!extracted.some(file => /ggml-metal/i.test(path.basename(file))), "Intel bundle must not include a Metal backend");
      assert(!extracted.some(file => /ggml-blas/i.test(path.basename(file))), "Monterey Intel bundle must not include the macOS 13.3+ BLAS backend");
    }
    await verifyMacSandbox(app, engine);
  } else {
  const listener = createServer();
  listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const models = path.join(work, "metadata fixture"); await mkdir(models);
  // A tensor-free GGUF permits registry/HTTP startup only; this does not test inference.
  const metadata = Buffer.alloc(96);
  metadata.write("GGUF"); metadata.writeUInt32LE(3, 4); metadata.writeBigUInt64LE(1n, 16);
  metadata.writeBigUInt64LE(20n, 24); metadata.write("general.architecture", 32);
  metadata.writeUInt32LE(8, 52); metadata.writeBigUInt64LE(10n, 56); metadata.write("acestep-lm", 64);
  await writeFile(path.join(models, "smoke.gguf"), metadata);
  const child = spawn(app, ["--engine-supervisor", path.join(engine, platform === "windows" ? "ace-server.exe" : "ace-server"), "--host", "127.0.0.1", "--port", String(port), "--models", models], {
    cwd: engine, stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, GGML_BACKEND: "CPU" },
  });
  let log = "";
  child.stdout.on("data", chunk => { log += chunk; });
  child.stderr.on("data", chunk => { log += chunk; });
  const exited = once(child, "exit");
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 120 && child.exitCode === null; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) { console.log("Bundled engine health:", await response.text()); healthy = true; break; }
      } catch { /* Wait for the bundled server to open its port. */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(healthy, `Relocated bundle failed to start its engine:\n${log}`);
    child.stdin.end();
    const stopped = await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("Bundled supervisor did not stop")), 10000).unref())]);
    assert.equal(stopped[0], 0, log);
    console.log("Bundle checksum, relocated resources, CPU engine startup and supervisor shutdown passed.");
  } finally {
    child.stdin.end();
    if (child.exitCode === null) child.kill();
  }
  const wav = Buffer.alloc(44 + 44100 * 2 * 2);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  const original = path.join(work, "export fixture.wav"), encoded = path.join(work, "exported.mp3");
  await writeFile(original, wav);
  await run(path.join(engine, platform === "windows" ? "mp3-codec.exe" : "mp3-codec"), ["-i", original, "-o", encoded, "-b", "192"], { cwd: engine });
  const mp3 = await readFile(encoded);
  assert(mp3.length >= 1000 && (mp3.subarray(0, 3).toString() === "ID3" || (mp3[0] === 255 && (mp3[1] & 224) === 224)), "Invalid encoded MP3");
  assert.deepEqual(await readFile(original), wav, "MP3 export changed the original WAV");
  console.log("Bundled MP3 conversion at 192 kbit/s passed; original WAV preserved.");
  }
} finally {
  try {
    if (installed) {
      await msiexec("/x", "uninstall.log");
      assert(!await exists(path.join(installDir, "music-generator.exe")), "MSI uninstall left the application behind");
      assert(!await exists(path.join(installDir, "engine/ace-server.exe")), "MSI uninstall left the engine behind");
      assert(!await exists(path.join(installDir, "WebView2/msedgewebview2.exe")), "MSI uninstall left WebView2 behind");
    }
    if (mounted) await run("hdiutil", ["detach", mount]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
