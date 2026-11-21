import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "./common.mjs";

const signingKeys = ["APPLE_SIGNING_IDENTITY", "APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD"];
const notaryKeys = ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"];

export function macSigningSettings(env) {
  const keys = [...signingKeys, ...notaryKeys];
  const values = Object.fromEntries(keys.map(key => [key, env[key]]));
  const required = env.MUSIC_GENERATOR_REQUIRE_NOTARIZATION === "true";
  const missing = keys.filter(key => !values[key]);
  if (required && missing.length) throw new Error(`Missing macOS signing settings: ${missing.join(", ")}`);
  if (!signingKeys.every(key => values[key])) return null;
  if (!values.APPLE_SIGNING_IDENTITY.startsWith("Developer ID Application: ")) {
    throw new Error("A Developer ID Application signing identity is required");
  }
  return values;
}

export async function withMacSigning(settings, build) {
  if (!settings) {
    return build((file, flags = []) => run("codesign", ["--force", "--sign", "-", ...flags, file]));
  }
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
    const sign = (file, flags = []) => run("codesign", ["--force", "--keychain", keychain,
      "--sign", settings.APPLE_SIGNING_IDENTITY, "--options", "runtime", "--timestamp", ...flags, file]);
    const notarize = notaryKeys.every(key => settings[key]) ? async (upload, staple) => {
      await run("xcrun", ["notarytool", "submit", upload, "--wait", "--timeout", "45m",
        "--apple-id", settings.APPLE_ID, "--password", settings.APPLE_PASSWORD, "--team-id", settings.APPLE_TEAM_ID]);
      await run("xcrun", ["stapler", "staple", staple]);
      await run("xcrun", ["stapler", "validate", staple]);
    } : undefined;
    return await build(sign, notarize);
  } finally {
    try {
      if (created) await run("security", ["delete-keychain", keychain], { stdio: "ignore" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
