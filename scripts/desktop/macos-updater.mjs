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

export function macUpdateRelease(env, version) {
  if (env.MUSIC_GENERATOR_REQUIRE_NOTARIZATION !== "true") return null;
  assert(/^\d+\.\d+\.\d+$/.test(version), "macOS update versions must be numeric");
  const build = env.MUSIC_GENERATOR_UPDATE_BUILD;
  if (!build) return { stream: "stable", tag: `v${version}`, version, bundleVersion: version };
  const preview = /^(daily|develop)-([1-9]\d*)$/.exec(build);
  assert(preview, "Invalid macOS preview build tag");
  const [, stream, run] = preview;
  return { stream, tag: build, version, bundleVersion: run };
}

export const previewFeedBranch = stream => `desktop-feed-${stream}`;

export function appcastUrl(stream, target) {
  const feed = appcastName(target);
  if (stream === "stable") return `https://github.com/${repository}/releases/latest/download/${feed}`;
  return `https://raw.githubusercontent.com/${repository}/${previewFeedBranch(stream)}/${feed}`;
}

export function macUpdaterSettings(env, version) {
  const release = macUpdateRelease(env, version);
  if (!release) return null;
  const { SPARKLE_PUBLIC_KEY: publicKey, SPARKLE_PRIVATE_KEY: privateKey, GITHUB_REPOSITORY } = env;
  assert(GITHUB_REPOSITORY === repository, "Sparkle updates must be built in the desktop release repository");
  assert(/^[A-Za-z0-9+/]{43}=$/.test(publicKey), "Missing or invalid SPARKLE_PUBLIC_KEY");
  assert(privateKey?.trim(), "Missing SPARKLE_PRIVATE_KEY");
  return { ...release, publicKey, privateKey: privateKey.trim() };
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
  // Sparkle compares CFBundleVersion. CI's run number also orders builds with the same display version.
  if (settings.stream !== "stable") {
    await run("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleVersion ${settings.bundleVersion}`, plist]);
  }
  for (const [key, type, value] of [
    ["SUFeedURL", "string", appcastUrl(settings.stream, `macos-${architecture}`)],
    ["SUPublicEDKey", "string", settings.publicKey],
    ["SURequireSignedFeed", "bool", "true"],
    ["SUEnableInstallerLauncherService", "bool", "true"],
    ["SUEnableAutomaticChecks", "bool", "false"],
    ["SUAutomaticallyUpdate", "bool", "true"],
  ]) {
    await run("/usr/libexec/PlistBuddy", ["-c", `Add :${key} ${type} ${value}`, plist]);
  }
  const { stdout: bundleVersion } = await execute("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleVersion", plist]);
  assert.equal(bundleVersion.trim(), settings.bundleVersion);
  return signer;
}

export async function writeAppcast(signer, output, artifact, settings, minimumVersion, notes) {
  const signature = await sparkleSign(signer, settings.privateKey, ["-p", artifact]);
  assert(/^[A-Za-z0-9+/]{86}==$/.test(signature), "Invalid Sparkle archive signature");
  const filename = appcastName(`macos-${architecture}`);
  const length = (await stat(artifact)).size;
  const feed = path.join(output, filename);
  await writeFile(feed, appcastXml(settings, path.basename(artifact), minimumVersion, signature, length, notes));
  await sparkleSign(signer, settings.privateKey, [feed]);
  return feed;
}

export function appcastXml(settings, filename, minimumVersion, signature, length, notes) {
  const url = `https://github.com/${repository}/releases/download/${settings.tag}/${filename}`;
  const description = notes ? `\n      <description><![CDATA[${notes.replaceAll("]]>", "]]]]><![CDATA[>")}]]></description>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Music Generator</title>
    <item>
      <title>Music Generator ${settings.version}</title>
      <sparkle:version>${settings.bundleVersion}</sparkle:version>
      <sparkle:shortVersionString>${settings.version}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>${minimumVersion}</sparkle:minimumSystemVersion>${description}
      <enclosure url="${url}" sparkle:edSignature="${signature}" length="${length}" type="application/octet-stream"/>
    </item>
  </channel>
</rss>
`;
}
