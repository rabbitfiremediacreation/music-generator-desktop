import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { msiArguments } from "./windows-msi.mjs";

test("MSI paths with spaces use Windows Installer property quoting", () => {
  const args = msiArguments("/i", "C:\\Test builds\\Music Generator.msi", "C:\\Test logs\\install.log", "C:\\Test app\\installed app");
  assert.equal(args.join(" "), '/qn /norestart /L*v! "C:\\Test logs\\install.log" /i "C:\\Test builds\\Music Generator.msi" INSTALLDIR="C:\\Test app\\installed app"');
  assert(!msiArguments("/x", "app.msi", "uninstall.log").some(arg => arg.startsWith("INSTALLDIR=")));
  assert.throws(() => msiArguments("/i", 'bad"path.msi', "install.log"), /Invalid/);
});

test("Windows Installer accepts the spaced-path command line without opening a help dialog", { skip: process.platform !== "win32" }, async () => {
  const work = await mkdtemp(path.join(tmpdir(), "MSI command line test "));
  try {
    const args = msiArguments("/i", path.join(work, "missing package.msi"), path.join(work, "install.log"), path.join(work, "installed app"));
    // A missing package must fail promptly with 1619, not hang in a syntax/help dialog.
    assert.throws(() => execFileSync("msiexec.exe", args, {
      windowsVerbatimArguments: true, timeout: 15000, stdio: "ignore",
    }), error => error.status === 1619);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
