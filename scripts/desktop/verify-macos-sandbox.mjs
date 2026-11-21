import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import yue2 from "../../models/yue2-runtime.json" with { type: "json" };
import { audioCppDirectory, audioCppSupported, exists, run, shipsYue2, target } from "./common.mjs";

export async function verifyMacSandbox(app, engine) {
  const entitlements = file => execFileSync("codesign",["-d","--entitlements",":-","--xml",file],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
  const enabled = (xml,key) => xml.includes(`<key>${key}</key><true/>`) || new RegExp(`<key>${key.replaceAll(".","\\.")}</key>\\s*<true\\s*/>`).test(xml);
  const parent = entitlements(app);
  assert(enabled(parent,"com.apple.security.app-sandbox"), "Main app is not sandboxed");
  assert(!enabled(parent,"com.apple.security.inherit"), "Main app must not use child inheritance");
  const helpers = [path.join(path.dirname(app),"music-engine-supervisor"),path.join(engine,"ace-server"),path.join(engine,"mp3-codec"),path.join(engine,"title/music-title")];
  if (audioCppSupported(target)) helpers.push(path.join(engine, audioCppDirectory, "audiocpp_cli"));
  const magenta = path.join(engine, "magenta");
  if (await exists(magenta)) helpers.push(path.join(magenta, "mrt2-record"));
  const audioCraft = path.join(engine, "audiocraft", "audiocraft-synth");
  if (await exists(audioCraft)) helpers.push(audioCraft);
  if (target.arch === "arm64") helpers.push(path.join(engine, "mimetic-synth"));
  if (shipsYue2()) helpers.push(path.join(engine, yue2.executable), path.join(engine, yue2.planner));
  for (const file of helpers) {
    const child = entitlements(file);
    assert(enabled(child,"com.apple.security.app-sandbox") && enabled(child,"com.apple.security.inherit"), "Engine helper must inherit the app sandbox");
    assert.equal((child.match(/<key>com\.apple\.security\./g) || []).length, 2, "Child must have only the two inheritance entitlements");
  }
  const denied = await mkdtemp(path.join(homedir(),"Library/Application Support/MusicGenerator-SandboxProbe-"));
  try {
    const sentinel = path.join(denied,"unselected.txt"); await writeFile(sentinel,"Sandbox boundary fixture");
    await run(app,["--sandbox-probe",sentinel]);
    for (const runtime of shipsYue2() ? [yue2.executable, yue2.planner] : []) {
      const args = ["--engine-supervisor", path.join(engine, runtime), "--help"];
      const options = { encoding: "utf8", timeout: 15000, env: { ...process.env, MUSIC_SANDBOX_DENIED_PATH: sentinel } };
      await assert.rejects(promisify(execFile)(app, args, options), error => {
        assert.equal(error.code, 1, error.stderr);
        assert.match(error.stderr, /\[Desktop Sandbox\] Unselected file access denied/);
        assert(error.stderr.includes(`yue2.cpp ${yue2.revision.slice(0, 7)}`), "Signed YuE2 helper did not start");
        return true;
      });
      console.log("App Sandbox: native YuE2 runtime starts and denies access to an unselected file.");
    }
  } finally { await rm(denied,{recursive:true,force:true}); }
}
