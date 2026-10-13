#!/usr/bin/env node
// MIT. Regenerate one complete APM2 document edition into a new directory.
import fs from "node:fs/promises";
import {constants} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {createDocumentMaintainer} from "./document-maintainer.mjs";
import {checkWorkshareConsistency} from "./workshare_consistency.mjs";

const HERE=path.dirname(fileURLToPath(import.meta.url));
const FILE_LIMIT=32*1024*1024,TOTAL_LIMIT=128*1024*1024,MEMBER_LIMIT=4096;
const utf8=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true});
const encode=s=>new TextEncoder().encode(s);
const hash=x=>createHash("sha256").update(x).digest("hex");
const args=process.argv.slice(2),opts={authority:"preserve"};
for(let i=0;i<args.length;i++){const key=args[i];if(key==="--help"){process.stdout.write("node maintain.mjs --output NEW_DIRECTORY [--baseline FILE] [--source EDITION_DIRECTORY] [--authority preserve|structured|markdown] [--capacity-project FILE] [--pdf-receipts FILE]\n");process.exit(0);}
 if(!["--output","--baseline","--source","--authority","--capacity-project","--pdf-receipts"].includes(key)||!args[i+1]||args[i+1].startsWith("--")||opts[key.slice(2)]!==undefined&&key!=="--authority")throw Error("Unknown, repeated or missing argument: "+key);opts[key.slice(2)]=args[++i];}
if(!opts.output)throw Error("--output is required");
const safe=n=>typeof n==="string"&&n.length<2000&&!n.includes("\\")&&!/[\x00-\x1f]/.test(n)&&!n.startsWith("/")&&n.split("/").every(p=>p&&p!=="."&&p!==".."&&p.length<=240&&!/[<>:"|?*]/.test(p)&&!/[. ]$/.test(p)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
const tracked=new Map();
async function read(file,limit=FILE_LIMIT){
 const absolute=path.resolve(file),handle=await fs.open(absolute,constants.O_RDONLY|constants.O_NONBLOCK|(constants.O_NOFOLLOW||0));
 try{const before=await handle.stat();if(!before.isFile()||before.size>limit)throw Error("Choose a bounded regular source file: "+absolute);
 const chunks=[];let count=0;
 while(true){const buffer=Buffer.alloc(Math.min(65536,limit-count+1));const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;count+=bytesRead;if(count>limit)throw Error("Source exceeds byte limit: "+absolute);chunks.push(buffer.subarray(0,bytesRead));}
 const after=await handle.stat();if(before.size!==count||after.size!==count||before.mtimeMs!==after.mtimeMs)throw Error("Source changed during read: "+absolute);
 const body=Buffer.concat(chunks,count),identity={bytes:count,sha256:hash(body)};
 const old=tracked.get(absolute);if(old&&(old.bytes!==count||old.sha256!==identity.sha256))throw Error("Source changed during preparation: "+absolute);tracked.set(absolute,identity);return body;
 }finally{await handle.close();}
}
async function text(file,limit){return utf8.decode(await read(file,limit));}
async function directory(root){
 const output={},folded=new Set();let total=0;
 async function visit(dir,prefix){const entries=await fs.readdir(dir,{withFileTypes:true});entries.sort((a,b)=>a.name.localeCompare(b.name,"en"));
 for(const entry of entries){const name=prefix+entry.name,full=path.join(dir,entry.name);if(!safe(name)||name!==name.normalize("NFC"))throw Error("Nonportable source member: "+name);
 const key=name.toLowerCase();if(folded.has(key))throw Error("Case-colliding source member: "+name);folded.add(key);
 if(entry.isSymbolicLink())throw Error("Source symlink is not a retained member: "+name);
 if(entry.isDirectory())await visit(full,name+"/");else if(entry.isFile()){if(Object.keys(output).length>=MEMBER_LIMIT)throw Error("Source member limit exceeded");const body=await read(full);total+=body.length;if(total>TOTAL_LIMIT)throw Error("Complete source exceeds byte limit");output[name]=maintainer.names.includes(name)||["capacity-project.json","capacity-report.html","EDITION.json","PDF_EDITIONS.json","MANIFEST.json"].includes(name)?utf8.decode(body):new Uint8Array(body);}else throw Error("Source is not a regular member: "+name);
 }}
 await visit(root,"");return output;
}
const baselinePath=path.resolve(opts.baseline||path.join(HERE,"APM2_Base_Edition.json"));
const baselineText=await text(baselinePath,8*1024*1024),baseline=JSON.parse(baselineText);
const maintainer=createDocumentMaintainer({sha256:hash,utf8Encode:encode,checkWorkshareConsistency});
maintainer.validateBaseline(baseline);
let input;
if(opts.source){const root=path.resolve(opts.source),stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error("Choose an ordinary source edition directory");input=await directory(root);}
const tools={};
for(const name of ["document-maintainer.mjs","workshare_consistency.mjs","maintain.mjs","REGENERATE.md"])tools["tools/"+name]=await text(path.join(HERE,name));
tools["tools/APM2_Base_Edition.json"]=baselineText;
let capacityProject,capacityReport;
if(opts["capacity-project"]||input?.["capacity-project.json"]!==undefined){
 capacityProject=opts["capacity-project"]?await text(opts["capacity-project"],8*1024*1024):input["capacity-project.json"];
 const modelPath=path.resolve(HERE,"../capacity/model.js"),modelText=await text(modelPath);
 const declared=(baseline.capacityCurrent||baseline.capacity).find(x=>x.path==="model.js");
 if(hash(modelText)!==declared.sha256||encode(modelText).length!==declared.bytes)throw Error("Use the original bound capacity model");
 const model=createRequire(import.meta.url)(modelPath),project=model.parseProject(capacityProject);
 capacityReport=model.reportHTML(project);
}
const pdfAttachments=[];
if(opts["pdf-receipts"]){
 const receiptPath=path.resolve(opts["pdf-receipts"]),receipts=JSON.parse(await text(receiptPath,1024*1024));
 if(!Array.isArray(receipts)||receipts.length>2)throw Error("PDF receipt must contain at most one binder and one offer");
 for(const receipt of receipts){if(!safe(receipt.pdf_path))throw Error("PDF receipt needs a portable relative PDF path");
 const full=path.resolve(path.dirname(receiptPath),receipt.pdf_path);
 const relative=path.relative(path.dirname(receiptPath),full);if(relative.startsWith(".."+path.sep)||path.isAbsolute(relative))throw Error("PDF leaves receipt directory");
 pdfAttachments.push({...receipt,content:new Uint8Array(await read(full))});}
}
const result=maintainer.compose({baseline,files:input,authority:opts.authority,capacityProject,capacityReport,tools,pdfAttachments});
for(const [name,identity]of [...tracked]){const current=await read(name);if(current.length!==identity.bytes||hash(current)!==identity.sha256)throw Error("Original source changed before output");}
const requested=path.resolve(opts.output),parent=await fs.realpath(path.dirname(requested)),output=path.join(parent,path.basename(requested));
if(!safe(path.basename(output)))throw Error("Output name is not portable");
if(opts.source){const source=await fs.realpath(opts.source),relative=path.relative(source,output);if(relative===""||(!relative.startsWith(".."+path.sep)&&relative!==".."&&!path.isAbsolute(relative)))throw Error("Output must be outside the original source directory");}
if(Object.keys(result.files).length>MEMBER_LIMIT||Object.values(result.files).reduce((sum,body)=>sum+(typeof body==="string"?encode(body).length:body.length),0)>TOTAL_LIMIT)throw Error("Complete output exceeds the portable package limits");
let owned=false;
try{
 await fs.mkdir(output,{recursive:false});owned=true;
 for(const name of Object.keys(result.files).sort()){if(!safe(name))throw Error("Unsafe output path: "+name);const full=path.join(output,...name.split("/"));await fs.mkdir(path.dirname(full),{recursive:true});
 const handle=await fs.open(full,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW||0),0o600);
 try{await handle.writeFile(result.files[name]);}finally{await handle.close();}}
 process.stdout.write(JSON.stringify({directory:output,authority:result.edition.authority,input_id:result.edition.input_id,files:Object.keys(result.files).length,manifest_sha256:hash(result.files["MANIFEST.json"]),pdf_editions:result.edition.pdfs},null,2)+"\n");
}catch(error){if(owned)await fs.rm(output,{recursive:true,force:true});throw error;}
