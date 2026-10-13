#!/usr/bin/env node
// Complete source comparison and portable human review using Node's standard library.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { INPUTS, auditAssessmentStationSources } from "./assessment_station_source_audit.mjs";
import { composeSourceScopeReport, SOURCE_SCOPE_COMPANIONS } from "./assessment_source_scope_report.mjs";
import { createSourceBankToolkit } from "./source_bank.mjs";

function main() {
  const args=process.argv.slice(2),options={application:"."},seenOptions=new Set();
  for(let i=0;i<args.length;i++) {
    const flag=args[i];
    if(flag==="--help") {
      process.stdout.write("Usage: node source_tools/assessment_station_source_audit_cli.mjs --application APPLICATION --output NEW_DIRECTORY\n");
      return;
    }
    if(!["--application","--output"].includes(flag)||i+1===args.length||args[i+1].startsWith("--"))
      throw new Error("Use --application APPLICATION --output NEW_DIRECTORY");
    if(seenOptions.has(flag))throw new Error("Repeated option "+flag);
    seenOptions.add(flag);options[flag.slice(2)]=args[++i];
  }
  if(!options.output)throw new Error("Choose a new output directory with --output");
  const application=fs.realpathSync(options.application),inputs={};
  for(const [name,identity] of Object.entries({...INPUTS,...SOURCE_SCOPE_COMPANIONS})) {
    const file=path.join(application,identity.path),fd=fs.openSync(file,fs.constants.O_RDONLY);
    try {
      const before=fs.fstatSync(fd);
      if(!before.isFile()||before.size!==identity.bytes)throw new Error("Choose the complete original source: "+identity.path);
      const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd);
      if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||bytes.length!==identity.bytes)
        throw new Error("Source changed while reading: "+identity.path);
      if(crypto.createHash("sha256").update(bytes).digest("hex")!==identity.sha256)
        throw new Error("Original source hash differs: "+identity.path);
      inputs[name]=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
    }finally{fs.closeSync(fd);}
  }
  const audit=auditAssessmentStationSources(inputs);
  const composed=composeSourceScopeReport(audit,inputs),{result,files,sourceId,archive}=composed;
  for(const [name,body] of Object.entries(audit.files))
    if(files[name]!==body)throw new Error("Report changed an original audit output: "+name);
  const portable=createSourceBankToolkit(),members=Object.entries(files),keys=new Set();
  let total=0;
  for(const [name,body] of members) {
    portable.portablePath(name);
    if(typeof body!=="string"&&!(body instanceof Uint8Array))throw new Error("Unsupported output member: "+name);
    const key=name.normalize("NFC").toLowerCase();
    if(keys.has(key))throw new Error("Output members collide: "+name);
    keys.add(key);total+=typeof body==="string"?Buffer.byteLength(body,"utf8"):body.byteLength;
  }
  if(total>128*1024*1024)throw new Error("Complete report exceeds the 128 MiB output limit");
  for(const [name] of members) {
    const parts=name.split("/");
    for(let i=1;i<parts.length;i++)
      if(keys.has(parts.slice(0,i).join("/").normalize("NFC").toLowerCase()))
        throw new Error("Output file is used as a directory: "+name);
  }
  const selected=path.resolve(options.output),parent=fs.realpathSync(path.dirname(selected));
  if(!fs.statSync(parent).isDirectory())throw new Error("Choose an existing output parent");
  const root=path.join(parent,path.basename(selected));
  fs.mkdirSync(root,{mode:0o700});
  try {
    for(const [name,body] of members) {
      const parts=name.split("/");let directory=root;
      for(const part of parts.slice(0,-1)) {
        directory=path.join(directory,part);
        try{fs.mkdirSync(directory,{mode:0o700});}
        catch(error){if(error.code!=="EEXIST")throw error;}
        const stat=fs.lstatSync(directory);
        if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error("Unsafe output parent: "+name);
      }
      const fd=fs.openSync(path.join(root,...parts),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);
      try{fs.writeFileSync(fd,body);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    }
  }catch(error){fs.rmSync(root,{recursive:true,force:true});throw error;}
  process.stdout.write(JSON.stringify({output:root,sourceId,archive,summary:result.summary,files:members.map(([name])=>name)})+"\n");
}
try{main();}catch(error){process.stderr.write(error.message+"\n");process.exitCode=1;}
