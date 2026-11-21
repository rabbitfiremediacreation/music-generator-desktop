import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import yue2 from "../../models/yue2-runtime.json" with { type: "json" };
import { aceMacPlugin, audioCppDirectory, audioCppSupported, run, shipsYue2, target } from "./common.mjs";

export async function verifyMacSandbox(app, engines, utilities, probeWithArchives) {
  const entitlements = file => execFileSync("codesign",["-d","--entitlements",":-","--xml",file],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
  const enabled = (xml,key) => xml.includes(`<key>${key}</key><true/>`) || new RegExp(`<key>${key.replaceAll(".","\\.")}</key>\\s*<true\\s*/>`).test(xml);
  const parent = entitlements(app);
  assert(enabled(parent,"com.apple.security.app-sandbox"), "Main app is not sandboxed");
  assert(!enabled(parent,"com.apple.security.inherit"), "Main app must not use child inheritance");
  const helpers = [path.join(path.dirname(app),"music-engine-supervisor"),path.join(utilities,"mp3-codec"),path.join(utilities,"title/music-title")];
  const plugins = [path.join(engines["ace-step"], aceMacPlugin)];
  if (audioCppSupported(target)) plugins.push(path.join(engines["audio-cpp"], audioCppDirectory, "audiocpp_cli"));
  if (engines.magenta) plugins.push(path.join(engines.magenta, "magenta/mrt2-record"));
  if (engines.audiocraft) plugins.push(path.join(engines.audiocraft, "audiocraft/audiocraft-synth"));
  if (target.arch === "arm64") {
    plugins.push(path.join(engines.pytorch, "mimetic-synth"), path.join(engines.pytorch, "text2midi/text2midi-runner"), path.join(engines.pytorch, "pytorch/stem-runner"));
  }
  if (shipsYue2()) plugins.push(path.join(engines.yue2, yue2.executable), path.join(engines.yue2, yue2.planner));
  for (const file of plugins) {
    await run("codesign", ["--verify", "--strict", file]);
    const exports = execFileSync("nm", ["-gU", file], { encoding: "utf8" });
    assert.match(exports, /\b_music_generator_engine_main_v1\s*$/m, `Engine plug-in entry missing: ${file}`);
  }
  for (const file of helpers) {
    await run("codesign", ["--verify", "--strict", file]);
    const child = entitlements(file);
    assert(enabled(child,"com.apple.security.app-sandbox") && enabled(child,"com.apple.security.inherit"), "Engine helper must inherit the app sandbox");
    assert.equal((child.match(/<key>com\.apple\.security\./g) || []).length, 2, "Child must have only the two inheritance entitlements");
  }
  const denied = await mkdtemp(path.join(homedir(),"Library/Application Support/MusicGenerator-SandboxProbe-"));
  try {
    const sentinel = path.join(denied,"unselected.txt"); await writeFile(sentinel,"Sandbox boundary fixture");
    console.log(await probeWithArchives(app, ["--sandbox-probe", sentinel]));
  } finally { await rm(denied,{recursive:true,force:true}); }
}
