import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createPublicKey, verify } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { architecture, download, root, run } from "./common.mjs";
import { appcastName } from "./release-assets.mjs";

const execute = promisify(execFile);
const sparkleVersion = "2.10.1";
const sparkleDigest = "1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27";
const repository = "rabbitfiremediacreation/music-generator-desktop";

export function macUpdaterSettings(env, version) {
  if (env.MUSIC_GENERATOR_REQUIRE_NOTARIZATION !== "true") return null;
  const { SPARKLE_PUBLIC_KEY: publicKey, SPARKLE_PRIVATE_KEY: privateKey, GITHUB_REPOSITORY } = env;
  assert(GITHUB_REPOSITORY === repository, "Stable updates must be built in the desktop release repository");
  assert(/^[A-Za-z0-9+/]{43}=$/.test(publicKey), "Missing or invalid SPARKLE_PUBLIC_KEY");
  assert(privateKey?.trim(), "Missing SPARKLE_PRIVATE_KEY");
  assert(/^\d+\.\d+\.\d+$/.test(version), "Stable macOS release versions must be numeric");
  return { publicKey, privateKey: privateKey.trim(), version };
}

function sparkleSign(binary, privateKey, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["--ed-key-file", "-", ...args], { stdio: ["pipe", "pipe", "ignore"] });
    let result = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { result += chunk; });
    child.stdin.on("error", reject);
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve(result.trim());
      else reject(new Error(`Sparkle signing failed (exit ${code})`));
    });
    child.stdin.end(`${privateKey}\n`);
  });
}

export async function installSparkle(app, work, settings, sign) {
  const archive = path.join(root, ".cache/desktop", `Sparkle-${sparkleVersion}.tar.xz`);
  await download(`https://github.com/sparkle-project/Sparkle/releases/download/${sparkleVersion}/Sparkle-${sparkleVersion}.tar.xz`, archive, sparkleDigest);
  await run("tar", ["-xf", archive, "-C", work, "./Sparkle.framework", "./bin/sign_update", "./LICENSE"]);
  const signer = path.join(work, "bin/sign_update");

  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519",
    x: Buffer.from(settings.publicKey, "base64").toString("base64url") }, format: "jwk" });
  const challenge = path.join(work, "key-check");
  const message = Buffer.from("Music Generator Sparkle key check");
  await writeFile(challenge, message);
  const signature = await sparkleSign(signer, settings.privateKey, ["-p", challenge]);
  assert(verify(null, message, key, Buffer.from(signature, "base64")), "Sparkle signing keys do not match");

  const framework = path.join(app, "Contents/Frameworks/Sparkle.framework");
  await mkdir(path.dirname(framework), { recursive: true });
  await rm(framework, { recursive: true, force: true });
  await run("ditto", [path.join(work, "Sparkle.framework"), framework]);
  const version = path.join(framework, "Versions/B");
  await rm(path.join(version, "XPCServices/Downloader.xpc"), { recursive: true, force: true });
  for (const part of ["XPCServices/Installer.xpc", "Autoupdate", "Updater.app"]) {
    await sign(path.join(version, part));
  }
  await sign(framework);
  await run("ditto", [path.join(work, "LICENSE"), path.join(app, "Contents/Resources/Sparkle-LICENSE.txt")]);

  const plist = path.join(app, "Contents/Info.plist");
  const feed = appcastName(`macos-${architecture}`);
  for (const [key, type, value] of [
    ["SUFeedURL", "string", `https://github.com/${repository}/releases/latest/download/${feed}`],
    ["SUPublicEDKey", "string", settings.publicKey],
    ["SURequireSignedFeed", "bool", "true"],
    ["SUEnableInstallerLauncherService", "bool", "true"],
    ["SUEnableAutomaticChecks", "bool", "false"],
    ["SUAutomaticallyUpdate", "bool", "true"],
  ]) {
    await run("/usr/libexec/PlistBuddy", ["-c", `Add :${key} ${type} ${value}`, plist]);
  }
  const { stdout: bundleVersion } = await execute("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleVersion", plist]);
  assert.equal(bundleVersion.trim(), settings.version);
  return signer;
}

export async function writeAppcast(signer, output, artifact, settings, minimumVersion) {
  const signature = await sparkleSign(signer, settings.privateKey, ["-p", artifact]);
  assert(/^[A-Za-z0-9+/]{86}==$/.test(signature), "Invalid Sparkle archive signature");
  const filename = appcastName(`macos-${architecture}`);
  const url = `https://github.com/${repository}/releases/download/v${settings.version}/${path.basename(artifact)}`;
  const length = (await stat(artifact)).size;
  const feed = path.join(output, filename);
  await writeFile(feed, `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Music Generator</title>
    <item>
      <title>Music Generator ${settings.version}</title>
      <sparkle:version>${settings.version}</sparkle:version>
      <sparkle:shortVersionString>${settings.version}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>${minimumVersion}</sparkle:minimumSystemVersion>
      <enclosure url="${url}" sparkle:edSignature="${signature}" length="${length}" type="application/octet-stream"/>
    </item>
  </channel>
</rss>
`);
  await sparkleSign(signer, settings.privateKey, [feed]);
  return feed;
}
