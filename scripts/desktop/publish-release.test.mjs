import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applicationVersions, expectedAssets, sha256, validateAssets, validateReleaseVersion } from "./release-assets.mjs";
import { publishRelease } from "./publish-release.mjs";

const tag = "v0.1.0";
const targets = ["macos-arm64", "macos-x64", "windows-x64", "linux-x64", "linux-x64-cuda"];

async function fixture(t, target = "windows-x64") {
  const directory = await mkdtemp(path.join(tmpdir(), "music-release-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of expectedAssets(tag, target).filter(name => !name.endsWith(".sha256"))) {
    const file = path.join(directory, name);
    await writeFile(file, `Test bundle for ${target}: ${name}`);
    await writeFile(`${file}.sha256`, `${await sha256(file)}  ${name}\n`);
  }
  return { repository: "owner/desktop", tag, target, directory };
}

function fakeClient(assets = []) {
  const uploaded = [];
  const downloaded = [];
  return {
    uploaded, downloaded,
    release: async () => ({ tag_name: tag, draft: false, prerelease: true, assets }),
    digest: async asset => { downloaded.push(asset.name); return asset.downloadDigest; },
    upload: async asset => { uploaded.push(asset.name); assets.push({ ...asset }); },
  };
}

for (const target of targets) {
  test(`publishes exactly the expected ${target} files, including checksums`, async t => {
    const options = await fixture(t, target);
    const client = fakeClient();
    await publishRelease(options, client);
    assert.deepEqual(client.uploaded, expectedAssets(tag, target));
  });
}

test("platform asset sets contain seven distinct bundles and seven checksums", () => {
  const names = targets.flatMap(target => expectedAssets(tag, target));
  assert.equal(names.length, 14);
  assert.equal(new Set(names).size, 14);
  assert.equal(names.filter(name => name.endsWith(".sha256")).length, 7);
  assert.throws(() => expectedAssets(tag, "linux-arm64"), /Unknown release platform/);
  assert.throws(() => expectedAssets("main", "windows-x64"), /Invalid release tag/);
});

test("requires matching npm, Cargo and Tauri versions and an exact v-prefixed tag", async () => {
  const versions = await applicationVersions(fileURLToPath(new URL("../../", import.meta.url)));
  validateReleaseVersion(`v${versions[0]}`, versions);
  for (const invalid of [["0.1.0", "0.2.0", "0.1.0"], ["0.1.0", undefined, "0.1.0"], []]) {
    assert.throws(() => validateReleaseVersion(tag, invalid));
  }
  assert.throws(() => validateReleaseVersion("v0.2.0", ["0.1.0", "0.1.0", "0.1.0"]), /versions differ/);
  assert.throws(() => validateReleaseVersion("0.1.0", ["0.1.0", "0.1.0", "0.1.0"]), /versions differ/);
});

test("rejects missing, unexpected and corrupt files before contacting GitHub", async t => {
  const mutations = [
    async (directory, name) => rm(path.join(directory, `${name}.sha256`)),
    async directory => writeFile(path.join(directory, "unexpected.zip"), "unexpected"),
    async (directory, name) => writeFile(path.join(directory, name), "corrupt"),
    async (directory, name) => writeFile(path.join(directory, `${name}.sha256`), `${"0".repeat(64)}  ../other.zip\n`),
  ];
  for (const mutate of mutations) {
    const options = await fixture(t);
    const [name] = expectedAssets(tag, options.target);
    await mutate(options.directory, name);
    await assert.rejects(publishRelease(options, { release: () => assert.fail("GitHub must not be called") }));
  }
});

test("rejects directories and symlinks masquerading as release assets", async t => {
  for (const kind of ["directory", "symlink"]) {
    const options = await fixture(t);
    const [name] = expectedAssets(tag, options.target);
    const file = path.join(options.directory, name);
    await rm(file);
    if (kind === "directory") await mkdir(file);
    else await symlink(`${file}.sha256`, file);
    await assert.rejects(validateAssets(tag, options.target, options.directory), /regular file/);
  }
});

test("skips identical assets and preserves unrelated platforms", async t => {
  const options = await fixture(t);
  const assets = await validateAssets(tag, options.target, options.directory);
  const existing = [...assets, { name: "other-platform.zip", digest: "sha256:unrelated" }];
  const client = fakeClient(existing);
  await publishRelease(options, client);
  assert.deepEqual(client.uploaded, []);
  assert.deepEqual(client.downloaded, []);
  assert.equal(existing.length, 3);
});

test("hashes existing assets when GitHub has no digest", async t => {
  const options = await fixture(t);
  const assets = await validateAssets(tag, options.target, options.directory);
  const client = fakeClient(assets.map(({ name, digest }) => ({ name, downloadDigest: digest })));
  await publishRelease(options, client);
  assert.deepEqual(client.uploaded, []);
  assert.deepEqual(client.downloaded, assets.map(asset => asset.name));
});

test("a conflicting existing checksum blocks every upload, including missing bundles", async t => {
  const options = await fixture(t);
  const [, checksum] = expectedAssets(tag, options.target);
  const client = fakeClient([{ name: checksum, digest: `sha256:${"0".repeat(64)}` }]);
  await assert.rejects(publishRelease(options, client), /Existing release asset differs/);
  assert.deepEqual(client.uploaded, []);
});

test("retries a partial upload without overwriting its successful files", async t => {
  const options = await fixture(t, "macos-arm64");
  const client = fakeClient();
  const upload = client.upload;
  client.upload = async asset => {
    if (client.uploaded.length === 1) throw Error("Upload interrupted");
    await upload(asset);
  };
  await assert.rejects(publishRelease(options, client), /Upload interrupted/);
  assert.equal(client.uploaded.length, 1);
  client.upload = upload;
  await publishRelease(options, client);
  assert.deepEqual(client.uploaded, expectedAssets(tag, options.target));
});

test("rejects drafts and an unexpected release tag before uploading", async t => {
  const options = await fixture(t);
  for (const release of [{ tag_name: tag, draft: true }, { tag_name: "v9.0.0", draft: false }]) {
    const client = fakeClient();
    client.release = async () => release;
    await assert.rejects(publishRelease(options, client));
    assert.deepEqual(client.uploaded, []);
  }
});
