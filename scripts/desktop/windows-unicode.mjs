import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "./common.mjs";

// One real F32 tensor; enough to exercise both GGML's UTF-8 reader and ACE's weight mapping.
export function pathTestGguf() {
  const parts = [];
  const u32 = value => { const b=Buffer.alloc(4);b.writeUInt32LE(value);parts.push(b); };
  const u64 = value => { const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(value));parts.push(b); };
  const string = value => { const b=Buffer.from(value,"utf8");u64(b.length);parts.push(b); };
  parts.push(Buffer.from("GGUF"));u32(3);u64(1);u64(1);
  string("general.architecture");u32(8);string("acestep-lm");
  string("test.weight");u32(1);u64(1);u32(0);u64(0);
  const header=Buffer.concat(parts);
  const result=Buffer.alloc(Math.ceil(header.length/32)*32+4);
  header.copy(result);result.writeFloatLE(0.5,result.length-4);
  return result;
}

export async function verifyWindowsPaths(executable, runtime) {
  const work = await mkdtemp(path.join(tmpdir(),"desktop-unicode-"));
  try {
    // Escapes keep fixtures independent of the checkout/compiler's source codepage.
    for (const name of ["ASCII models", "M\u00fcller \u00e4\u00f6\u00fc\u00df", "\u6771\u4eac \ud83c\udfb5"]) {
      const folder=path.join(work,name), filename=`${name}.gguf`;
      await mkdir(path.join(folder,`${filename}.dir`),{recursive:true});
      await writeFile(path.join(folder,filename),pathTestGguf());
      await run(executable,[folder,filename],{cwd:runtime,env:{...process.env,PATH:`${runtime}${path.delimiter}${process.env.PATH || ""}`},timeout:30000});
    }
  } finally {await rm(work,{recursive:true,force:true});}
}
