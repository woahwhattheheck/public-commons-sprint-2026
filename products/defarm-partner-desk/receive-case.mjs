import {readFile,mkdir,open,rename,stat} from "node:fs/promises";
import {resolve,join,dirname} from "node:path";
import {createHash,randomBytes} from "node:crypto";
import {fileURLToPath} from "node:url";
import * as core from "./core.mjs";
import {recipientHTML} from "./offline-recipient.mjs";
const hash=x=>createHash("sha256").update(x).digest("hex");
async function atomic(path,text){const t=path+"."+randomBytes(6).toString("hex")+".tmp",f=await open(t,"wx",0o600);try{await f.writeFile(text);await f.sync();}finally{await f.close();}await rename(t,path);}
export async function receive(inputPath,outputPath){
 process.umask(0o077);const original=await readFile(resolve(inputPath)),pkg=JSON.parse(new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(original).replace(/^\uFEFF/,"")),c=core.importCase(pkg,hash);
 const output=resolve(outputPath),stage=output+".receiving-"+randomBytes(6).toString("hex");
 try{
  await stat(output);
  const previous=JSON.parse(await readFile(join(output,"manifest.json"),"utf8"));
  core.need(previous.schema==="tjlabs.defarm.received-case/1"&&previous.case_id===c.id&&Array.isArray(previous.files),"Destination is not this completed receiving");
  const allowed=["complete-case.json","case.json","original-source."+(c.source.format==="csv"?"csv":"json"),"selected-request.json","source-rows.csv","report.html"];
  if(previous.recipient==="tjlabs.defarm.offline-recipient/1")allowed.push("recipient.html");
  core.need(previous.recipient===undefined||previous.recipient==="tjlabs.defarm.offline-recipient/1","Unknown recipient edition");
  core.need(previous.files.length===allowed.length&&new Set(previous.files.map(f=>f.path)).size===allowed.length&&previous.files.every(f=>allowed.includes(f.path)),"Existing receiving inventory is incomplete");
  for(const f of previous.files){const content=await readFile(join(output,f.path));core.need(content.length===f.bytes&&hash(content)===f.sha256,"Existing received file changed: "+f.path);}
  const retained=await readFile(join(output,"complete-case.json"));
  core.need(hash(retained)===hash(original),"This destination retains another original package; choose a separate destination");
  return previous;
 }catch(e){if(e.code!=="ENOENT")throw e;try{await stat(output);throw new Error("The existing destination is incomplete; retain it and use a separate receiving destination");}catch(inner){if(inner.code!=="ENOENT")throw inner;}}
 await mkdir(stage,{recursive:false});
 const files=[
 ["complete-case.json",original],
 ["case.json",JSON.stringify(c,null,2)+"\n"],
 ["original-source."+(c.source.format==="csv"?"csv":"json"),c.source.text],
 ["selected-request.json",c.payload.text],
 ["source-rows.csv",core.csvOutput([["source_row","original_cells_json","selected_item_json"],...c.source_rows.map(r=>[r.row,JSON.stringify(r.cells??r.item),JSON.stringify(r.item)])])],
 ["report.html",core.report(c)],
 ["recipient.html",await recipientHTML(new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(original))]
 ];
 const manifest={schema:"tjlabs.defarm.received-case/1",recipient:"tjlabs.defarm.offline-recipient/1",case_id:c.id,source:resolve(inputPath),received_at:new Date().toISOString(),files:[]};
 for(const[path,body]of files){await atomic(join(stage,path),body);const actual=await readFile(join(stage,path));manifest.files.push({path,bytes:actual.length,sha256:hash(actual)});}
 await atomic(join(stage,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
 await rename(stage,output);return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{core.need(process.argv.length===4,"Usage: node receive-case.mjs COMPLETE-CASE.json NEW-OUTPUT-DIRECTORY");const result=await receive(process.argv[2],process.argv[3]);console.log(JSON.stringify(result,null,2));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
