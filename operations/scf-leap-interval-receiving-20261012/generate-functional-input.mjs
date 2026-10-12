#!/usr/bin/env node
import {mkdir,open,readFile,lstat} from "node:fs/promises";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {buildFunctionalInput} from "./functional-input.cjs";

const argument = process.argv[2];
if (!argument || process.argv.length !== 3) {
  process.stderr.write("Usage: node generate-functional-input.mjs /absolute/private/input-directory\n");
  process.exit(2);
}
const directory = resolve(argument);
if (directory !== argument.replace(/\/+$/, "")) throw Error("Use the canonical absolute private directory.");
await mkdir(directory,{recursive:true,mode:0o700});
const target = await lstat(directory);
if (!target.isDirectory() || target.isSymbolicLink()) throw Error("The input directory must be a real private directory.");
const sha256Utf8 = text => ({bytes:Buffer.byteLength(text,"utf8"),
  sha256:createHash("sha256").update(text,"utf8").digest("hex")});
const generated = buildFunctionalInput({directory,hashUtf8:sha256Utf8});
for (const [name,text] of Object.entries(generated.files)) {
  const path = join(directory,name);
  let file;
  try { file = await open(path,"wx",0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await lstat(path);
    if (!existing.isFile() || existing.isSymbolicLink() || await readFile(path,"utf8") !== text)
      throw Error("Existing input differs; preserve the original operation: " + path);
    continue;
  }
  try { await file.writeFile(text,{encoding:"utf8"}); await file.sync(); }
  finally { await file.close(); }
}
const parent = await open(directory,"r");
try {await parent.sync();} finally {await parent.close();}
process.stdout.write(JSON.stringify({
  status:"INPUT_READY",
  operationId:generated.manifest.operationId,
  input:join(directory,"leap-functional-input.json"),
  manifest:join(directory,"leap-functional-manifest.json"),
  files:generated.manifest.files,
  portfolio:generated.manifest.portfolio
},null,2)+"\n");
