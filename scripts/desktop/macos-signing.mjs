import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { run } from "./common.mjs";

const signingKeys = ["APPLE_SIGNING_IDENTITY", "APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD"];
const notaryKeys = ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"];
const execute = promisify(execFile);

export function macSigningSettings(env) {
  const keys = [...signingKeys, ...notaryKeys];
  const values = Object.fromEntries(keys.map(key => [key, env[key]]));
  const required = env.MUSIC_GENERATOR_REQUIRE_NOTARIZATION === "true";
  const hasCertificate = values.APPLE_CERTIFICATE || values.APPLE_CERTIFICATE_PASSWORD;
  const requiredKeys = hasCertificate ? keys : ["APPLE_SIGNING_IDENTITY", ...notaryKeys];
  const missing = requiredKeys.filter(key => !values[key]);
  if (required && missing.length) throw new Error(`Missing macOS signing settings: ${missing.join(", ")}`);
  const canSign = hasCertificate ? signingKeys.every(key => values[key]) : missing.length === 0;
  if (!canSign) return null;
  if (!values.APPLE_SIGNING_IDENTITY.startsWith("Developer ID Application: ")) {
    throw new Error("A Developer ID Application signing identity is required");
  }
  return values;
}

export async function withMacSigning(settings, build) {
  if (!settings) {
    return build((file, flags = []) => run("codesign", ["--force", "--sign", "-", ...flags, file]));
  }
  if (!settings.APPLE_CERTIFICATE) return signedBuild(settings, build);
  const directory = await mkdtemp(path.join(tmpdir(), "music-signing-"));
  const certificate = path.join(directory, "certificate.p12");
  const password = randomUUID();
  let keychain;
  let previousSearchList;
  try {
    const keychainPath = path.join(await realpath(directory), "signing.keychain-db");
    const { stdout } = await execute("security", ["list-keychains", "-d", "user"]);
    const searchList = [...stdout.matchAll(/^\s*"([^"\n]+)"$/gm)].map(([, file]) => file);
    await writeFile(certificate, Buffer.from(settings.APPLE_CERTIFICATE, "base64"), { mode: 0o600 });
    await run("security", ["create-keychain", "-p", password, keychainPath]);
    keychain = keychainPath;
    previousSearchList = searchList;
    await run("security", ["set-keychain-settings", "-lut", "21600", keychain]);
    await run("security", ["unlock-keychain", "-p", password, keychain]);
    await run("security", ["import", certificate, "-k", keychain, "-P", settings.APPLE_CERTIFICATE_PASSWORD, "-T", "/usr/bin/codesign"]);
    await run("security", ["set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", password, keychain], { stdio: "ignore" });
    await run("security", ["list-keychains", "-d", "user", "-s", keychain, ...searchList]);
    const { stdout: identities } = await execute("security", ["find-identity", "-v", "-p", "codesigning", keychain]);
    const identity = importedSigningIdentity(identities, settings.APPLE_SIGNING_IDENTITY);
    return await signedBuild(settings, build, ["--keychain", keychain], identity);
  } finally {
    try {
      if (keychain) await run("security", ["delete-keychain", keychain], { stdio: "ignore" });
    } finally {
      try {
        if (previousSearchList) await run("security", ["list-keychains", "-d", "user", "-s", ...previousSearchList]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}

export function importedSigningIdentity(output, name) {
  const matches = [...output.matchAll(/^\s*\d+\) ([0-9a-f]{40}) "([^"\n]+)"$/gim)]
    .filter(([, , identity]) => identity.normalize() === name.trim().normalize());
  if (matches.length !== 1) {
    throw new Error("The P12 must contain exactly one valid code-signing identity matching APPLE_SIGNING_IDENTITY");
  }
  return matches[0][1];
}

async function signedBuild(settings, build, keychain = [], identity = settings.APPLE_SIGNING_IDENTITY) {
  const sign = (file, flags = []) => run("codesign", ["--force", ...keychain,
    "--sign", identity, "--options", "runtime", "--timestamp", ...flags, file]);
  const notarize = notaryKeys.every(key => settings[key]) ? async (upload, staple) => {
    const { stdout } = await execute("xcrun", [
      "notarytool", "submit", upload, "--wait", "--timeout", "45m", "--output-format", "json",
      "--apple-id", settings.APPLE_ID, "--password", settings.APPLE_PASSWORD, "--team-id", settings.APPLE_TEAM_ID,
    ]).catch(error => { throw new Error(`Notarization command failed for ${path.basename(upload)} (exit ${error.code})`); });
    const { status, id } = JSON.parse(stdout);
    if (status !== "Accepted") throw new Error(`Notarization ${status} for ${path.basename(upload)} (submission ${id})`);
    console.log(`Apple notarized ${path.basename(upload)} (${id})`);
    if (staple) {
      await run("xcrun", ["stapler", "staple", staple]);
      await run("xcrun", ["stapler", "validate", staple]);
    }
  } : undefined;
  return build(sign, notarize);
}
