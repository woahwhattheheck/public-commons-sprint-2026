/* SPDX-License-Identifier: MIT */
(function(root,factory){
 if(typeof module==="object"&&module.exports)module.exports=factory(require("./original-adapter.cjs"),require("./vendor/connected_sha256.cjs"));
 else root.CmdbWorkspace=factory(root.CmdbOriginal,root.CmdbHash);
})(typeof globalThis!=="undefined"?globalThis:this,function(Original,Hash){
 "use strict";
 const SCHEMA="cmdb-acceptance-workspace/1",PACKAGE="cmdb-acceptance-package/1";
 const statuses=["open","assigned","correction_required","accepted_change"];
 const copy=x=>JSON.parse(JSON.stringify(x));
 const text=(v,label,max=4000)=>{if(typeof v!=="string"||!v.trim()||v.length>max)throw Error(label+" is required.");return v.trim();};
 const optional=(v,max=4000)=>{if(v==null)return "";if(typeof v!=="string"||v.length>max)throw Error("A text field is too long.");return v.trim();};
 function canonical(value){
  if(value===null||typeof value==="string"||typeof value==="boolean")return JSON.stringify(value);
  if(typeof value==="number"&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  if(value&&typeof value==="object")return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";
  throw Error("The workspace contains an unsupported value.");
 }
 const hash=x=>Hash.sha256Utf8(typeof x==="string"?x:canonical(x)).sha256;
 const id=(v,label="Operation ID")=>{text(v,label,160);if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(v))throw Error(label+" is invalid.");return v;};
 const date=v=>{if(typeof v!=="string"||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)throw Error("Use an exact UTC operation time.");return v;};
 const by=(items,value,label)=>{const row=items.find(x=>x.id===value);if(!row)throw Error(label+" is no longer available.");return row;};
 const quote=v=>'"'+String(v).replaceAll('"','""')+'"';
 const csv=(headers,rows)=>[headers.map(quote).join(","),...rows.map(r=>headers.map(k=>quote(r[k]??"")).join(","))].join("\r\n")+"\r\n";
 function metadata(w){
  if(!w||w.schema!==SCHEMA||!Number.isSafeInteger(w.revision)||w.revision<0)throw Error("Open a complete CMDB acceptance workspace.");
  for(const key of ["snapshots","mappings","runs","reviews","acceptances","events","requests"])if(!Array.isArray(w[key]))throw Error("Missing original workspace "+key+".");
  return w;
 }
 function create({id:workspaceId,label,customer,tableClass,owner,at}){
  return {schema:SCHEMA,id:id(workspaceId,"Workspace ID"),label:text(label,"Workspace name",160),customer:text(customer,"Customer",160),
   tableClass:text(tableClass,"CMDB class",160),owner:text(owner,"Operating owner",160),revision:0,createdAt:date(at),updatedAt:at,
   snapshots:[],mappings:[],runs:[],reviews:[],acceptances:[],events:[],requests:[]};
 }
 function inspectCsv(raw){
  if(typeof raw!=="string")throw Error("The full original UTF-8 CSV is required.");
  const identity=Hash.sha256Utf8(raw);if(identity.bytes>Original.MAX_BYTES)throw Error("Each original export is limited to 16 MiB.");
  try{const t=Original.parseCsv(raw);return {...identity,headers:t.headers,rows:t.records.length,parseError:null};}
  catch(error){return {...identity,headers:[],rows:null,parseError:error.message};}
 }
 function validateMapping(mapping){
  if(!mapping||!mapping.key||!Array.isArray(mapping.fields)||!mapping.fields.length||mapping.fields.length>100)throw Error("Map one stable key and at least one compared field.");
  const all=[mapping.key,...mapping.fields],seen=new Set();
  for(const row of all){
   for(const key of ["name","source","target"])text(row[key],"Mapped "+key,128);
   if(row.name==="*"||seen.has(row.name))throw Error("Canonical field names must be unique and must not be *.");
   seen.add(row.name);
  }
  for(const side of ["source","target"])if(new Set(all.map(x=>x[side])).size!==all.length)throw Error("Use each "+side+" column once.");
  return {key:copy(mapping.key),fields:copy(mapping.fields)};
 }
 function mapped(snapshot,mapping,side){
  if(snapshot.parseError)throw Error(snapshot.label+": "+snapshot.parseError);
  const table=Original.parseCsv(snapshot.text),columns=[mapping.key,...mapping.fields],problems=[];
  for(const column of columns)if(!table.headers.includes(column[side]))problems.push({row:1,kind:"Missing column",column:column[side],key:""});
  if(problems.length)return {problems,headers:table.headers,rows:table.records.length};
  const seen=new Map();
  for(const [index,row]of table.records.entries()){
   const value=row[mapping.key[side]];
   if(!value||value!==value.trim()||value.length>512||/[\x00-\x1f\x7f]/.test(value))problems.push({row:index+2,kind:"Invalid stable key",column:mapping.key[side],key:value});
   else if(seen.has(value))problems.push({row:index+2,kind:"Duplicate stable key",column:mapping.key[side],key:value,firstRow:seen.get(value)});
   else seen.set(value,index+2);
  }
  if(problems.length)return {problems,headers:table.headers,rows:table.records.length};
  const records=table.records.map(row=>Object.fromEntries(columns.map(c=>[c.name,row[c[side]]])));
  return {problems:[],headers:table.headers,rows:records.length,text:csv(columns.map(c=>c.name),records)};
 }
 function preview(w,sourceId,targetId,mapping){
  metadata(w);mapping=validateMapping(mapping);
  const source=by(w.snapshots,sourceId,"Source export"),target=by(w.snapshots,targetId,"Target export");
  if(source.side!=="source"||target.side!=="target")throw Error("Select the corresponding source and target export.");
  const one=(s,side)=>{try{return mapped(s,mapping,side);}catch(e){return {problems:[{row:null,kind:e.message,column:"",key:""}],headers:s.headers,rows:s.rows};}};
  return {source:one(source,"source"),target:one(target,"target")};
 }
 const fingerprint=f=>hash([f.record_key,f.reason,f.field,f.before_sha256,f.after_sha256]);
 function latestReviews(w,runId){const result=new Map();for(const r of w.reviews)if(r.runId===runId)result.set(r.findingId,r);return result;}
 function reviewRows(w,runId){
  const run=by(w.runs,runId,"Comparison"),reviews=latestReviews(w,runId);
  return run.audit.findings.map(f=>({...f,id:fingerprint(f),review:reviews.get(fingerprint(f))||null,status:reviews.get(fingerprint(f))?.status||"open"}));
 }
 function reviewDigest(w,runId){return hash(reviewRows(w,runId).map(row=>({id:row.id,review:row.review})));}
 function acceptance(w,runId){
  const records=w.acceptances.filter(x=>x.runId===runId),last=records.at(-1);
  return last?{...last,current:last.reviewDigest===reviewDigest(w,runId)}:null;
 }
 function lineage(w,runId){
  const run=by(w.runs,runId,"Comparison");if(!run.previousRunId)return {previousRunId:null,unchanged:0,changedOrNew:run.audit.findings.length,absent:[]};
  const old=by(w.runs,run.previousRunId,"Earlier comparison"),now=new Set(run.audit.findings.map(fingerprint)),previous=new Set(old.audit.findings.map(fingerprint));
  return {previousRunId:old.id,unchanged:[...now].filter(x=>previous.has(x)).length,changedOrNew:[...now].filter(x=>!previous.has(x)).length,
   absent:old.audit.findings.filter(f=>!now.has(fingerprint(f)))};
 }
 function transition(workspace,command){
  const w=metadata(workspace);
  if(!command||typeof command!=="object")throw Error("A complete operation is required.");
  const requestId=id(command.requestId),actor=text(command.actor,"Operating person",160),at=date(command.at),action=text(command.action,"Action",80);
  const payload=command.payload||{},requestDigest=hash({action,actor,at,payload});
  const prior=w.requests.find(x=>x.id===requestId);
  if(prior){if(prior.digest!==requestDigest)throw Error("This operation ID already records different work.");return {workspace:w,result:copy(prior.result),replayed:true};}
  if(command.expectedRevision!==w.revision)throw Error("Workspace changed in another window. Reload the current saved edition before applying this operation.");
  const next=copy(w),entityId=action+"-"+requestId;let result;
  if(action==="import"){
   if(!["source","target"].includes(payload.side))throw Error("Choose source or target.");
   if(payload.parentId){const parent=by(next.snapshots,payload.parentId,"Prior export");if(parent.side!==payload.side)throw Error("A correction must retain the original export side.");}
   const info=inspectCsv(payload.text);
   const row={id:entityId,side:payload.side,label:text(payload.label,"Export label",160),filename:text(payload.filename,"Original filename",240),
    text:payload.text,...info,parentId:payload.parentId||null,note:optional(payload.note),receivedBy:actor,receivedAt:at};
   next.snapshots.push(row);result={id:row.id,rows:row.rows,parseError:row.parseError};
  }else if(action==="mapping"){
   const row={id:entityId,label:text(payload.label,"Mapping name",160),...validateMapping(payload),createdBy:actor,createdAt:at};
   next.mappings.push(row);result={id:row.id};
  }else if(action==="compare"){
   const mapping=by(next.mappings,payload.mappingId,"Field mapping"),source=by(next.snapshots,payload.sourceId,"Source export"),target=by(next.snapshots,payload.targetId,"Target export");
   const selected=preview(next,source.id,target.id,mapping);
   if(selected.source.problems.length||selected.target.problems.length)throw Error("Resolve all source/target column and stable-key problems before comparing.");
   const audit=Original.reconcileCsv(selected.source.text,selected.target.text,{key:mapping.key.name,fields:mapping.fields.map(x=>x.name)});
   const previous=payload.previousRunId?by(next.runs,payload.previousRunId,"Earlier comparison"):null;
   if(previous&&by(next.mappings,previous.mappingId,"Earlier mapping").key.name!==mapping.key.name)throw Error("Keep the same canonical stable-key name when continuing a comparison.");
   const row={id:entityId,label:text(payload.label,"Comparison name",160),sourceId:source.id,targetId:target.id,mappingId:mapping.id,
    previousRunId:previous?.id||null,original:{source:{sha256:source.sha256,bytes:source.bytes},target:{sha256:target.sha256,bytes:target.bytes}},audit,createdBy:actor,createdAt:at};
   next.runs.push(row);
   if(payload.carryAccepted===true&&previous){
    const priorMapping=by(next.mappings,previous.mappingId,"Earlier mapping");
    const priorSource=by(next.snapshots,previous.sourceId,"Earlier source export");
    if(priorSource.sha256!==source.sha256||priorSource.bytes!==source.bytes||
       canonical(validateMapping(priorMapping))!==canonical(validateMapping(mapping)))
     throw Error("Carry accepted changes only with the same original source baseline and complete field mapping. Disable carry to review a changed baseline or mapping.");
    const priorReviews=latestReviews(next,previous.id);
    for(const f of audit.findings){const key=fingerprint(f),review=priorReviews.get(key);if(review?.status==="accepted_change")next.reviews.push({...copy(review),id:entityId+"-carry-"+key,runId:row.id,carriedFrom:review.id,actor,at});}
   }
   result={id:row.id,findings:audit.summary.findings,critical:audit.summary.critical};
  }else if(action==="review"){
   const run=by(next.runs,payload.runId,"Comparison");
   if(!statuses.includes(payload.status))throw Error("Choose an exception disposition.");
   if(!Array.isArray(payload.findingIds)||!payload.findingIds.length||new Set(payload.findingIds).size!==payload.findingIds.length)throw Error("Select at least one distinct exception.");
   const allowed=new Set(run.audit.findings.map(fingerprint));
   if(payload.findingIds.some(x=>!allowed.has(x)))throw Error("The selected exception does not belong to this comparison.");
   const owner=payload.status==="open"?optional(payload.owner,160):text(payload.owner,"Responsible owner",160);
   const note=text(payload.note,"Review note",4000),evidence=payload.status==="accepted_change"?text(payload.evidence,"Acceptance reference",2000):optional(payload.evidence,2000);
   const due=optional(payload.due,10);if(due&&!/^\d{4}-\d{2}-\d{2}$/.test(due))throw Error("Use a calendar due date.");
   for(const findingId of payload.findingIds)next.reviews.push({id:entityId+"-"+findingId,runId:run.id,findingId,status:payload.status,owner,note,evidence,due,actor,at});
   result={runId:run.id,reviewed:payload.findingIds.length};
  }else if(action==="accept"){
   const run=by(next.runs,payload.runId,"Comparison");
   if(!["ACCEPTED","REVIEW_REQUIRED","REJECTED"].includes(payload.status))throw Error("Choose a receiving decision.");
   const rows=reviewRows(next,run.id),open=rows.filter(x=>x.status!=="accepted_change");
   if(payload.status==="ACCEPTED"&&open.length)throw Error("Every exception needs an explicit accepted-change decision before accepting this comparison.");
   const row={id:entityId,runId:run.id,status:payload.status,signoffBy:text(payload.signoffBy,"Receiving reviewer",160),
    authority:text(payload.authority,"Review authority or written reference",2000),note:text(payload.note,"Receiving decision",4000),actor,at,
    reviewDigest:reviewDigest(next,run.id),source:copy(run.original),summary:copy(run.audit.summary)};
   next.acceptances.push(row);result={id:row.id,status:row.status};
  }else if(action==="settings"){
   for(const k of ["label","customer","tableClass","owner"])next[k]=text(payload[k],k,160);
   result={id:next.id};
  }else throw Error("Unknown CMDB workspace action.");
  next.revision++;next.updatedAt=at;
  next.events.push({revision:next.revision,id:requestId,action,actor,at,result:copy(result)});
  next.requests.push({id:requestId,digest:requestDigest,result:copy(result)});
  return {workspace:next,result,replayed:false};
 }
 function validate(workspace){
  const w=metadata(workspace);id(w.id,"Workspace ID");date(w.createdAt);date(w.updatedAt);
  for(const key of ["label","customer","tableClass","owner"])text(w[key],key,160);
  for(const key of ["snapshots","mappings","runs","reviews","acceptances","requests"])if(new Set(w[key].map(x=>x.id)).size!==w[key].length)throw Error("Duplicate saved "+key+" identity.");
  if(w.events.length!==w.revision||w.requests.length!==w.revision||w.events.some((e,i)=>e.revision!==i+1||e.id!==w.requests[i].id))throw Error("The original operation sequence is incomplete.");
  for(const s of w.snapshots){
   const fresh=inspectCsv(s.text);for(const k of ["bytes","sha256","headers","rows","parseError"])if(canonical(s[k])!==canonical(fresh[k]))throw Error("Original export differs: "+s.filename);
   if(!["source","target"].includes(s.side))throw Error("Saved export side differs.");
   if(s.parentId&&by(w.snapshots,s.parentId,"Prior export").side!==s.side)throw Error("Saved correction changed export side.");
  }
  for(const mapping of w.mappings)validateMapping(mapping);
  for(const run of w.runs){
   const mapping=by(w.mappings,run.mappingId,"Original mapping"),s=by(w.snapshots,run.sourceId,"Original source"),t=by(w.snapshots,run.targetId,"Original target");
   const p=preview(w,s.id,t.id,mapping);if(p.source.problems.length||p.target.problems.length)throw Error("A saved comparison has invalid original inputs.");
   const audit=Original.reconcileCsv(p.source.text,p.target.text,{key:mapping.key.name,fields:mapping.fields.map(x=>x.name)});
   if(canonical(audit)!==canonical(run.audit)||canonical(run.original)!==canonical({source:{sha256:s.sha256,bytes:s.bytes},target:{sha256:t.sha256,bytes:t.bytes}}))throw Error("Saved comparison differs from its full original inputs.");
   if(run.previousRunId)by(w.runs,run.previousRunId,"Earlier comparison");
  }
  for(const r of w.reviews){const run=by(w.runs,r.runId,"Review comparison");if(!statuses.includes(r.status)||!run.audit.findings.some(f=>fingerprint(f)===r.findingId))throw Error("Saved review has no original exception.");text(r.note,"Saved review note");text(r.actor,"Saved reviewer",160);date(r.at);if(r.status==="accepted_change"){text(r.owner,"Acceptance owner",160);text(r.evidence,"Acceptance reference",2000);}}
  for(const a of w.acceptances){const run=by(w.runs,a.runId,"Receiving comparison");if(!["ACCEPTED","REVIEW_REQUIRED","REJECTED"].includes(a.status)||canonical(a.source)!==canonical(run.original)||canonical(a.summary)!==canonical(run.audit.summary))throw Error("Saved receiving decision differs.");text(a.signoffBy,"Receiving reviewer",160);text(a.authority,"Review reference",2000);text(a.note,"Receiving note");date(a.at);}
  return w;
 }
 function pack(w){validate(w);return {schema:PACKAGE,workspace:copy(w),sha256:hash(w)};}
 function receive(input){
  const p=typeof input==="string"?JSON.parse(input):input;
  if(!p||p.schema!==PACKAGE||p.sha256!==hash(p.workspace))throw Error("Open the complete unchanged workspace package.");
  return copy(validate(p.workspace));
 }
 const escape=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 function report(w,runId){
  const run=by(w.runs,runId,"Comparison"),rows=reviewRows(w,runId),decision=acceptance(w,runId);
  const source=by(w.snapshots,run.sourceId,"Source"),target=by(w.snapshots,run.targetId,"Target"),mapping=by(w.mappings,run.mappingId,"Mapping");
  const status=decision?.current?decision.status:"REVIEW_REQUIRED";
  const table=(heads,items)=>"<table><thead><tr>"+heads.map(h=>"<th>"+escape(h)+"</th>").join("")+"</tr></thead><tbody>"+items.map(row=>"<tr>"+row.map(x=>"<td>"+escape(x)+"</td>").join("")+"</tr>").join("")+"</tbody></table>";
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(w.customer+" — CMDB receiving")+'</title><style>body{font:15px/1.55 system-ui,sans-serif;color:#191919;max-width:1200px;margin:24px auto;padding:0 18px}h1{font-size:28px}h2{font-size:19px;border-top:1px solid #bbb;padding-top:18px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #bbb;text-align:left;vertical-align:top;padding:8px;overflow-wrap:anywhere}th{background:#eee}p{overflow-wrap:anywhere}small{color:#555}@media print{tr{break-inside:avoid}h2{break-after:avoid}}</style></head><body>'+
   "<h1>"+escape(w.customer)+" — CMDB acceptance</h1><p>"+escape(w.tableClass)+" · "+escape(run.label)+"</p><p><strong>"+escape(status.replaceAll("_"," "))+"</strong></p>"+
   "<p>"+escape(decision?.current?decision.note:"Record a current receiving decision after reviewing every exception.")+"</p>"+
   (decision?"<p>Reviewer: "+escape(decision.signoffBy)+" · Reference: "+escape(decision.authority)+" · "+escape(new Date(decision.at).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric",timeZone:"UTC"}))+(decision.current?"":" · superseded by later exception review")+"</p>":"")+
   "<h2>Compared exports</h2>"+table(["Side","Original file","Rows","Original SHA-256"],[["Source",source.filename,source.rows,source.sha256],["Target",target.filename,target.rows,target.sha256]])+
   "<h2>Field mapping</h2>"+table(["Canonical field","Source column","Target column"],[mapping.key,...mapping.fields].map(x=>[x.name,x.source,x.target]))+
   "<h2>Exceptions and responsible owners</h2><p>"+rows.length+" findings; "+run.audit.summary.critical+" critical. Exact source/target values remain in the private editable workspace.</p>"+
   table(["Record","Finding / field","Disposition","Owner","Decision / reference"],rows.map(r=>[r.record_key,r.reason.replaceAll("_"," ")+" / "+r.field,r.status.replaceAll("_"," "),r.review?.owner||"Unassigned",[r.review?.note,r.review?.evidence].filter(Boolean).join(" — ")]))+
   "<h2>Source and receiving</h2><p>The comparison uses the original PR481 CMDB comparator with explicit column mapping and exact string comparison. The complete editable package retains original exports, comparisons, review history and this receiving decision.</p></body></html>";
 }
 function exceptionsCsv(w,runId){
  const columns=["record_key","reason","field","severity","status","owner","due","note","evidence","before_sha256","after_sha256"];
  const safe=v=>{let s=String(v??"");if(/^\s*[=+\-@]/u.test(s))s="'"+s;return quote(s);};
  return [columns.join(","),...reviewRows(w,runId).map(r=>columns.map(k=>safe(r[k]??r.review?.[k]??"")).join(","))].join("\r\n")+"\r\n";
 }
 return {SCHEMA,PACKAGE,create,transition,validate,pack,receive,preview,reviewRows,acceptance,lineage,report,exceptionsCsv,canonical,hash,inspectCsv,validateMapping,fingerprint,escape};
});
