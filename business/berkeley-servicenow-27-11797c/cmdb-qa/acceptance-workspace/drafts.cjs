/* SPDX-License-Identifier: MIT */
(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory(require("./workspace.cjs"),require("./vendor/connected_sha256.cjs"));else root.CmdbDrafts=factory(root.CmdbWorkspace,root.CmdbHash);})(typeof globalThis!=="undefined"?globalThis:this,function(C,H){
 "use strict";
 const GROUPS={intake:"intake",mapping:"mapping",compare:"comparison",review:"comparison",accept:"receiving"};
 const MAX_BYTES=256*1024*1024;
 const plain=x=>x&&typeof x==="object"&&!Array.isArray(x);
 const copy=x=>JSON.parse(JSON.stringify(x));
 const text=(x,name,max=1000000)=>{if(typeof x!=="string"||x.length>max)throw Error("Invalid recovery "+name+".");return x;};
 const stamp=x=>{text(x,"time",80);if(!Number.isFinite(Date.parse(x)))throw Error("Invalid recovery time.");};
 function validateEntry(entry,bases,workspaceId){
  if(!plain(entry)||!Object.hasOwn(GROUPS,entry.group))throw Error("Unknown unfinished-work group.");
  text(entry.id,"identity",200);text(entry.runId,"comparison identity",200);
  const base=bases[entry.baseSha256];if(!base)throw Error("Original unfinished-work edition is missing.");
  const w=C.receive(base);if(w.id!==workspaceId)throw Error("Unfinished work belongs to another workspace.");
  if(["review","accept"].includes(entry.group)&&!w.runs.some(r=>r.id===entry.runId))throw Error("Original unfinished comparison is missing.");
  if(!["review","accept"].includes(entry.group)&&entry.runId!=="")throw Error("Unexpected unfinished comparison identity.");
  stamp(entry.createdAt);stamp(entry.updatedAt);
  if(!plain(entry.values)||Object.keys(entry.values).length>5000)throw Error("Invalid unfinished form fields.");
  const prefixes={intake:/^import-(side|label|parent|note)$/,mapping:/^(mapping-(source|target|label)|key-(name|source|target)|field-(name|source|target)-\d+)$/,compare:/^(compare-(source|target|mapping|label|previous)|carry-accepted)$/,review:/^review-(status|owner|due|note|evidence)$/,accept:/^accept-(status|person|authority|note)$/};
  for(const [key,value]of Object.entries(entry.values)){if(!prefixes[entry.group].test(key)||!(typeof value==="boolean"||typeof value==="string"&&value.length<=1000000))throw Error("Invalid unfinished form value.");}
  if(entry.mapping!==null){
   if(entry.group!=="mapping"||!plain(entry.mapping)||!plain(entry.mapping.key)||!Array.isArray(entry.mapping.fields)||entry.mapping.fields.length>1000)throw Error("Invalid unfinished mapping.");
   text(entry.mapping.label,"mapping label");
   for(const field of [entry.mapping.key,...entry.mapping.fields])for(const key of ["name","source","target"])text(field[key],"mapping field");
  }
  if(!Array.isArray(entry.findings)||new Set(entry.findings).size!==entry.findings.length)throw Error("Invalid unfinished findings.");
  if(entry.findings.length){
   if(entry.group!=="review")throw Error("Unexpected unfinished findings.");
   const allowed=new Set(C.reviewRows(w,entry.runId).map(row=>row.id));for(const id of entry.findings)if(!allowed.has(id))throw Error("Unfinished finding differs from its original comparison.");
  }
  if(entry.file!==null){
   if(entry.group!=="intake"||!plain(entry.file))throw Error("Unexpected unfinished source file.");
   text(entry.file.name,"filename",1000);text(entry.file.type,"media type",200);text(entry.file.text,"original file",16*1024*1024);
   const identity=H.sha256Utf8(entry.file.text);if(identity.bytes>16*1024*1024||identity.bytes!==entry.file.bytes||identity.sha256!==entry.file.sha256)throw Error("Unfinished original CSV identity differs.");
  }
  return entry;
 }
 function pack(workspace,entries,bases,{at=new Date().toISOString()}={}){
  const current=C.pack(workspace),body={schema:"cmdb-unfinished-work/1",createdAt:at,workspace:current,bases:copy(bases),entries:copy(entries)};
  stamp(at);if(!entries.length)throw Error("There is no unfinished work to save.");
  for(const [sha,base]of Object.entries(body.bases)){C.receive(base);if(base.sha256!==sha)throw Error("Original edition identity differs.");}
  if(new Set(entries.map(e=>e.id)).size!==entries.length)throw Error("Duplicate unfinished-work identity.");
  for(const entry of body.entries)validateEntry(entry,body.bases,workspace.id);
  const packet={...body,sha256:C.hash(body)},raw=JSON.stringify(packet,null,2)+"\n";
  if(H.sha256Utf8(raw).bytes>MAX_BYTES)throw Error("The complete recovery exceeds 256 MiB. Save individual unfinished groups with their original workspace editions.");
  return packet;
 }
 function receive(raw){
  if(typeof raw==="string"&&H.sha256Utf8(raw).bytes>MAX_BYTES)throw Error("The complete recovery exceeds 256 MiB.");
  const packet=typeof raw==="string"?JSON.parse(raw):copy(raw);
  if(!plain(packet)||packet.schema!=="cmdb-unfinished-work/1")throw Error("Open a complete CMDB unfinished-work file.");
  const {sha256,...body}=packet;if(C.hash(body)!==sha256)throw Error("The unfinished-work file identity differs.");
  if(!plain(body.bases)||!Array.isArray(body.entries)||body.entries.length>1000)throw Error("Invalid unfinished-work contents.");
  const workspace=C.receive(body.workspace);
  const rebuilt=pack(workspace,body.entries,body.bases,{at:body.createdAt});
  if(C.canonical(rebuilt)!==C.canonical(packet))throw Error("Unexpected unfinished-work fields.");
  return {workspace,entries:copy(body.entries),bases:copy(body.bases),packet};
 }
 return {GROUPS,MAX_BYTES,pack,receive};
});
