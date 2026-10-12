#!/usr/bin/env node
// MIT. Retain the complete reviewed cohort and exact native destination before execution.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { validateInput, retain } from "./DISTRIBUTION_RECEIVING.mjs";
const args=process.argv.slice(2),options={};
const valueFlags=new Set(["--cohort","--repository","--source-commit","--directory","--receiving-directory","--operation-id","--out","--python","--npm","--npm-cache"]);
const booleanFlags=new Set(["--source-offline","--install-online"]);
for(let index=0;index<args.length;index++){
  const key=args[index];
  assert(valueFlags.has(key)||booleanFlags.has(key),"Use a declared original input option: "+key);
  assert(!Object.hasOwn(options,key),"Supply each original selection once.");
  if(booleanFlags.has(key))options[key]=true;
  else{assert(args[index+1]&&!args[index+1].startsWith("--"),"Supply "+key);options[key]=args[++index];}
}
for(const key of ["--cohort","--repository","--source-commit","--directory","--operation-id","--out"])
  assert(options[key],"Supply "+key);
const cohortBytes=await fs.readFile(resolve(options["--cohort"]));
const cohort=JSON.parse(cohortBytes.toString("utf8"));
const input=validateInput({
  format:"commons.haystack.distribution-receiving.v1",operationId:options["--operation-id"],
  directory:resolve(options["--directory"]),repository:resolve(options["--repository"]),
  sourceCommit:options["--source-commit"],cohort,
  ...(options["--receiving-directory"]?{receivingDirectory:resolve(options["--receiving-directory"])}:{}),
  ...(options["--python"]?{python:options["--python"]}:{}),
  ...(options["--npm"]?{npm:options["--npm"]}:{}),
  ...(options["--npm-cache"]?{npmCache:resolve(options["--npm-cache"])}:{}),
  sourceOffline:options["--source-offline"]??false,installOffline:!options["--install-online"]
});
const bytes=Buffer.from(JSON.stringify(input,null,2)+"\n"),path=resolve(options["--out"]);
await retain(path,bytes);
process.stdout.write(JSON.stringify({
  operationId:input.operationId,input:path,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),
  sourceCommit:input.sourceCommit,sourceFiles:input.cohort.files.length,receivingDirectory:input.receivingDirectory??null
})+"\n");
