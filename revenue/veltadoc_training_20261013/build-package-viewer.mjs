#!/usr/bin/env node
// Verify the original immutable customer selection and build its complete package view.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import zip from "./host/connected_zip.cjs";
import Composer from "./compose-packages.cjs";
import core from "./tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs";
import {renderVeltadocPackageViewer} from "./package-viewer.mjs";
const here=path.dirname(fileURLToPath(import.meta.url)),hash=b=>createHash("sha256").update(b).digest("hex");
export function receiveOriginalPackages(record,input){
 if(input.schema!=="commons.veltadoc-complete-package-viewer.v1"||record.sha256!==input.working_record_sha256)throw Error("The complete original working selection changed.");
 const receivedRoot=core.applyLeadFulfillment({}, {operation_id:record.pack.id+":complete-view-receive",kind:"working-record-receive",input:{bundle:record},expected_root_sha256:core.hash(core.validateRoot({}))}).ledger;
 if(core.hash(core.leadFulfillmentExport(receivedRoot,{packId:record.pack.id,format:"working-record"}).value)!==core.hash(record))throw Error("The full working record did not reopen unchanged.");
 if(input.writer.timestamp!=="2026-10-13T00:00:00Z")throw Error("The original deterministic archive timestamp differs.");
 const decoded=gunzipSync(Buffer.from(input.envelope.payload,"base64"));
 if(decoded.length!==input.envelope.bytes||hash(decoded)!==input.envelope.sha256)throw Error("The complete package envelope differs.");
 const payload=JSON.parse(decoded);
 if(!Array.isArray(payload.packages)||payload.packages.length!==record.customer_packages.length)throw Error("The original complete package collection differs.");
 const received=[];
 for(const p of payload.packages){
  const selection=record.customer_packages.find(x=>x.id===p.package_id),edition=record.editions.find(x=>x.id===selection?.edition_id);
  if(!selection||!edition||p.edition_id!==edition.id||p.files.length!==selection.files.length)throw Error("The original package selection differs.");
  const kind=edition.kind==="sample"?"sample":"paid";
  if(p.name!=="Veltadoc-"+kind+"-profiles.zip"||p.quantity!==(kind==="sample"?1:5)||p.title!==selection.title)throw Error("The original package label or scope differs.");
  const entries=selection.files.map(ref=>{
   const f=record.customer_files.find(x=>x.id===ref.id);
   if(!f||f.revision!==ref.revision||f.sha256!==ref.sha256)throw Error("The selected original customer file changed.");
   const d=f.document,bytes=Buffer.from(d.content_base64,"base64"),declared=p.files.find(x=>x.name===d.name);
   if(!declared||bytes.length!==d.bytes||hash(bytes)!==d.sha256||declared.bytes!==d.bytes||declared.sha256!==d.sha256)throw Error("Original member differs: "+d.name);
   return {name:d.name,data:new Uint8Array(bytes),mode:0o644};
  });
  const archive=Buffer.from(zip.packStoredZip(entries,{timestamp:input.writer.timestamp})),saved=Buffer.from(p.payload,"base64");
  if(archive.length!==p.bytes||hash(archive)!==p.sha256||!archive.equals(saved))throw Error("Complete original archive differs: "+p.name);
  const opened=zip.readStoredZip(new Uint8Array(saved));
  if(opened.length!==entries.length)throw Error("Original archive members differ.");
  for(const m of opened){const f=p.files.find(x=>x.name===m.name);if(!f||m.bytes!==f.bytes||hash(m.data)!==f.sha256)throw Error("Reopened original member differs.");}
  received.push({...p,payload:undefined,bytes:archive.length,sha256:hash(archive),archive});
 }
 return received;
}
export function buildPackageView(out){
 const directory=path.resolve(out);if(fs.existsSync(directory))throw Error("Choose a new output directory; keep earlier complete deliveries.");
 const manifest=JSON.parse(fs.readFileSync(path.join(here,"source-manifest.json"),"utf8"));
 for(const file of manifest.files){if(path.isAbsolute(file.path)||file.path.split("/").includes(".."))throw Error("Invalid complete source path.");const bytes=fs.readFileSync(path.join(here,file.path));if(bytes.length!==file.bytes||hash(bytes)!==file.sha256)throw Error("Complete source differs: "+file.path);}
 const record=JSON.parse(fs.readFileSync(path.join(here,"working-record.json"),"utf8")),input=JSON.parse(fs.readFileSync(path.join(here,"package-viewer-input.json"),"utf8"));
 if(JSON.stringify(Composer.compose(record).input)!==JSON.stringify(input))throw Error("The full original package input differs from its maintained source.");
 const received=receiveOriginalPackages(record,input),html=renderVeltadocPackageViewer(input),fragment=renderVeltadocPackageViewer(input,{fragment:true});
 const original=fs.readFileSync(path.join(here,"Veltadoc-complete-packages.html"),"utf8");
 if(html!==original)throw Error("The exact saved complete package view differs from its full source.");
 fs.mkdirSync(directory,{mode:0o700});
 for(const p of received)fs.writeFileSync(path.join(directory,p.name),p.archive,{flag:"wx",mode:0o600});
 fs.writeFileSync(path.join(directory,"Veltadoc-complete-packages.html"),html,{flag:"wx",mode:0o600});
 fs.writeFileSync(path.join(directory,"Veltadoc-review-fragment.html"),fragment,{flag:"wx",mode:0o600});
 const result={schema:"commons.veltadoc-complete-package-view.v1",working_record_sha256:record.sha256,packages:received.map(({archive,...p})=>p),html:{bytes:Buffer.byteLength(html),sha256:hash(html)},fragment:{bytes:Buffer.byteLength(fragment),sha256:hash(fragment)}};
 fs.writeFileSync(path.join(directory,"package-view-result.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==3)throw Error("Usage: node build-package-viewer.mjs NEW_OUTPUT_DIRECTORY");console.log(JSON.stringify(buildPackageView(process.argv[2])));}catch(error){console.error(error.stack);process.exitCode=1;}
}
