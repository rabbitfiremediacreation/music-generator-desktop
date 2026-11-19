import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { audioCppDirectory, audioCppSupported, run, target } from "./common.mjs";

export async function verifyMacSandbox(app, engine) {
  const entitlements = file => execFileSync("codesign",["-d","--entitlements",":-","--xml",file],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
  const enabled = (xml,key) => xml.includes(`<key>${key}</key><true/>`) || new RegExp(`<key>${key.replaceAll(".","\\.")}</key>\\s*<true\\s*/>`).test(xml);
  const parent = entitlements(app);
  assert(enabled(parent,"com.apple.security.app-sandbox"), "Main app is not sandboxed");
  assert(!enabled(parent,"com.apple.security.inherit"), "Main app must not use child inheritance");
  const helpers = [path.join(path.dirname(app),"music-engine-supervisor"),path.join(engine,"ace-server"),path.join(engine,"mp3-codec"),path.join(engine,"title/music-title")];
  if (audioCppSupported(target)) helpers.push(path.join(engine, audioCppDirectory, "audiocpp_cli"));
  for (const file of helpers) {
    const child = entitlements(file);
    assert(enabled(child,"com.apple.security.app-sandbox") && enabled(child,"com.apple.security.inherit"), "Engine helper must inherit the app sandbox");
    assert.equal((child.match(/<key>com\.apple\.security\./g) || []).length, 2, "Child must have only the two inheritance entitlements");
  }
  const denied = await mkdtemp(path.join(homedir(),"Library/Application Support/MusicGenerator-SandboxProbe-"));
  try {
    const sentinel = path.join(denied,"unselected.txt"); await writeFile(sentinel,"Sandbox boundary fixture");
    await run(app,["--sandbox-probe",sentinel]);
  } finally { await rm(denied,{recursive:true,force:true}); }
}
