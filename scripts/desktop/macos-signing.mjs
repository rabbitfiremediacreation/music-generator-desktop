import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { run } from "./common.mjs";

const signingKeys = ["APPLE_SIGNING_IDENTITY", "APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD"];
const notaryKeys = ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"];

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
  const keychain = path.join(directory, "signing.keychain-db");
  const password = randomUUID();
  let created = false;
  try {
    await writeFile(certificate, Buffer.from(settings.APPLE_CERTIFICATE, "base64"), { mode: 0o600 });
    await run("security", ["create-keychain", "-p", password, keychain]);
    created = true;
    await run("security", ["unlock-keychain", "-p", password, keychain]);
    await run("security", ["import", certificate, "-k", keychain, "-P", settings.APPLE_CERTIFICATE_PASSWORD, "-T", "/usr/bin/codesign"]);
    await run("security", ["set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", password, keychain]);
    return await signedBuild(settings, build, ["--keychain", keychain]);
  } finally {
    try {
      if (created) await run("security", ["delete-keychain", keychain], { stdio: "ignore" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

async function signedBuild(settings, build, keychain = []) {
  const sign = (file, flags = []) => run("codesign", ["--force", ...keychain,
    "--sign", settings.APPLE_SIGNING_IDENTITY, "--options", "runtime", "--timestamp", ...flags, file]);
  const notarize = notaryKeys.every(key => settings[key]) ? async (upload, staple) => {
    const { stdout } = await promisify(execFile)("xcrun", [
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
