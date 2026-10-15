#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const C=require("./order-review-core.cjs");
const sha=raw=>crypto.createHash("sha256").update(raw).digest("hex");
const fail=(v,m)=>{if(!v)throw Error(m);};
function read(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let raw;
 try{const stat=fs.fstatSync(fd);fail(stat.isFile()&&stat.size>0,"Choose a complete nonempty regular workspace file.");raw=fs.readFileSync(fd);fail(raw.length===stat.size,"The workspace changed during reading.");}finally{fs.closeSync(fd);}
 const text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(raw),e=C.parseJSON(text.charCodeAt(0)===0xfeff?text.slice(1):text);
 fail(e.schema==="tjl-order-review-portable.v1","Choose a complete exported workspace JSON.");C.validate(e.workspace);
 fail(sha(Buffer.from(C.stable(e.workspace),"utf8"))===e.sha256,"The complete workspace checksum differs.");
 for(const s of e.workspace.sources)fail(sha(Buffer.from(s.original_text,"utf8"))===s.sha256,"Original source differs: "+s.filename);
 const pending=e.workspace.writing&&e.workspace.writing.pending_source;if(pending){const raw=Buffer.from(pending.base64,"base64");fail(raw.length===pending.bytes&&sha(raw)===pending.sha256,"Pending original source differs.");}
 return e.workspace;
}
function syncDirectory(dir){if(process.platform==="win32")return;const fd=fs.openSync(dir,fs.constants.O_RDONLY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function publish(filename,body){
 const out=path.resolve(filename),raw=Buffer.isBuffer(body)?body:Buffer.from(body,"utf8");fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});
 try{
  const fd=fs.openSync(out,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{fail(fs.fstatSync(fd).isFile(),"Existing output is not a regular file.");const old=fs.readFileSync(fd);fail(old.equals(raw),"Output already has different bytes; choose a new path: "+out);}finally{fs.closeSync(fd);}
  return{path:out,bytes:raw.length,sha256:sha(raw),reused:true};
 }catch(e){if(e.code!=="ENOENT")throw e;}
 const temporary=path.join(path.dirname(out),"."+path.basename(out)+"."+crypto.randomUUID()+".tmp");let created=false;
 try{const fd=fs.openSync(temporary,"wx",0o600);created=true;try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.linkSync(temporary,out);syncDirectory(path.dirname(out));}
 catch(e){if(e.code==="EEXIST"){const fd=fs.openSync(out,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{fail(fs.fstatSync(fd).isFile()&&fs.readFileSync(fd).equals(raw),"A concurrent writer created a different output; choose another path.");}finally{fs.closeSync(fd);}}else throw e;}
 finally{if(created){fs.unlinkSync(temporary);syncDirectory(path.dirname(out));}}
 return{path:out,bytes:raw.length,sha256:sha(raw),reused:false};
}
function safeName(s){return s.replace(/[^A-Za-z0-9._-]/g,"_").slice(0,140)||"source.txt";}
function main(args){
 const [command,file,...rest]=args;if(!["inspect","compare","sources","decisions"].includes(command)||!file)throw Error("Usage: node order-review-cli.cjs inspect FILE | compare FILE BEFORE_ID AFTER_ID [OUT.json] | sources FILE DIRECTORY | decisions FILE OUT.csv");
 const s=read(file);let result;
 if(command==="inspect"){fail(rest.length===0,"Inspect takes only the complete file.");result={workspace:s.name,id:s.id,revision:s.revision,sources:s.sources.map(x=>({id:x.id,name:x.filename,role:x.kind,rows:x.rows.length,system:x.system,sha256:x.sha256,mapping:C.mapping(s,x.id)})),bindings:s.bindings.length,reviews:s.reviews.map(r=>({id:r.id,title:r.title,current:r.versions[r.versions.length-1]}))};}
 if(command==="compare"){fail(rest.length===2||rest.length===3,"Choose baseline ID, later ID and optional output.");result=C.compare(s,rest[0],rest[1]);if(rest[2])result=publish(rest[2],JSON.stringify(result,null,2)+"\n");}
 if(command==="sources"){fail(rest.length===1,"Choose one output directory.");const directory=path.resolve(rest[0]);result={workspace_id:s.id,files:s.sources.map(x=>publish(path.join(directory,x.id+"__"+safeName(x.filename)),x.original_text))};}
 if(command==="decisions"){fail(rest.length===1,"Choose one new CSV output.");result=publish(rest[0],C.decisionsCSV(s));}
 process.stdout.write(JSON.stringify(result,null,2)+"\n");
}
if(require.main===module){try{main(process.argv.slice(2));}catch(e){process.stderr.write(JSON.stringify({error:e.message})+"\n");process.exitCode=1;}}
module.exports={read,publish,main};
