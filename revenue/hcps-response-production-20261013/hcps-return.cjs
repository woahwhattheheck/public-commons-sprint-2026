/* Whole prime-review return reconciliation for the original HCPS response desk. */
(function(global){
"use strict";
const C=global.HCPSCore||(typeof require==="function"?require("./hcps-core.cjs"):null);
const FORMAT="commons.hcps.review-history.v1",MAX_HISTORY=512*1024*1024,MAX_ARCHIVES=128;
const own=(o,k)=>Object.hasOwn(o,k),plain=v=>v&&typeof v==="object"&&!Array.isArray(v);
const text=(v,n=12000)=>{C.need(typeof v==="string"&&v.length<=n,"Keep complete bounded review text.");return v;};
const hash=v=>C.sha(C.canonical(v));
const safeSet=(o,k,v)=>Object.defineProperty(o,k,{value:C.clone(v),enumerable:true,configurable:true,writable:true});
const pointer=parts=>"/"+parts.map(v=>String(v).replace(/~/g,"~0").replace(/\//g,"~1")).join("/");
const cell=(o,k)=>own(o,k)?{present:true,value:C.clone(o[k])}:{present:false};
const missing=()=>({present:false});
function same(a,b){return a.present===b.present&&(!a.present||C.equal(a.value,b.value));}
function history(w){return w.returnReview||{format:FORMAT,archives:{},issues:[],decisions:[]};}
function copyWithHistory(w){const next=C.clone(w);if(!next.returnReview)next.returnReview=history(next);return next;}
function sourceBudget(w){let total=Object.values(w.objects).reduce((n,o)=>n+o.bytes,0);for(const a of Object.values(history(w).archives))total+=a.bytes;C.need(total<=MAX_HISTORY,"The complete original documents and returned/issued archive history exceed512MiB. Preserve the prior whole working copy.");return total;}
function checkContext(ctx){return ctx||{depth:0,validatedArchives:new Set(),activeArchives:new Set()};}
function unapplied(outer){const rows=Object.keys(outer.format==="commons.hcps.working-copy.v1"?outer.rawEditors:{}).sort();const drafts=outer.format==="commons.hcps.working-copy.v1"?outer.ui?.primeReview?.drafts:null;if(Array.isArray(drafts))for(const d of drafts)if(d&&typeof d.id==="string"&&!d.completed&&(d.raw||d.preview||d.pending||d.note))rows.push("prime-review:"+d.id);return rows.sort();}
async function readPackage(raw,ctx){
 text(raw,800*1024*1024);let outer;
 try{outer=JSON.parse(raw);}catch(e){throw Error("Receive the complete original JSON workspace or working-copy file.");}
 C.need(plain(outer),"Keep the whole returned file.");
 const working=outer.format==="commons.hcps.working-copy.v1",p=working?outer.package:outer;
 C.need(plain(p)&&p.format==="commons.hcps.response-package.v1","Use an original HCPS workspace or working-copy package.");
 const complete=C.canonical(p.workspace);
 C.need(p.bytes===C.bytes(complete).length&&p.sha256===await C.sha(complete),"The complete original package identity differs.");
 const context=checkContext(ctx);C.need(context.depth<=16,"This incoming custody nesting exceeds16 generations; preserve its complete original file.");
 await C.validate(p.workspace,context);
 const rawEditors=working?outer.rawEditors:{};
 C.need(plain(rawEditors),"Keep the complete unfinished-editor map.");
 return{workspace:p.workspace,rawEditors,unappliedEditors:unapplied(outer),ui:working?outer.ui:null,name:working?outer.name:null,packageSha256:await C.sha(raw),packageBytes:C.bytes(raw).length};
}
async function archive(w,raw,kind){
 const h=history(w),sha256=await C.sha(raw),size=C.bytes(raw).length;
 const prior=h.archives[sha256];
 if(prior)C.need(prior.raw===raw&&prior.bytes===size,"The complete original archive differs.");
 else{C.need(Object.keys(h.archives).length<MAX_ARCHIVES,"Preserve the complete128-file review history before another issue or return.");h.archives[sha256]={kind,bytes:size,raw};}
 sourceBudget(w);return sha256;
}
function checkAttribution(value){text(value.actor,1000);text(value.note);text(value.requestId,200);text(value.at,100);C.need(value.actor.trim()&&value.note.trim()&&value.requestId&&value.at,"Name the reviewer, original request, time and purpose.");}
async function issue(w,inputs){
 checkAttribution(inputs);
 const requestSha256=await hash({kind:"issue",...inputs});
 const prior=history(w).issues.find(x=>x.id===inputs.requestId);
 if(prior){C.need(prior.requestSha256===requestSha256,"This original issue request already names different inputs.");await C.validate(w);return{workspace:C.clone(w),issue:C.clone(prior),raw:history(w).archives[prior.archiveSha256].raw,replayed:true};}
 await C.validate(w);
 C.need(await hash(w)===inputs.expectedWorkspaceSha256,"The author working copy changed. Retain this draft and select the reviewed source again.");
 const baseline=w.editions.find(x=>x.id===inputs.editionId);
 C.need(baseline,"Choose the exact reviewed edition to issue.");
 const outgoing=C.clone(w);outgoing.draft=C.clone(baseline.draft);
 const raw=await C.pack(outgoing),next=copyWithHistory(w),archiveSha256=await archive(next,raw,"issued");
 const value={id:inputs.requestId,requestSha256,originalRequest:C.clone(inputs),archiveSha256,baselineEditionId:baseline.id,baselineEditionSha256:baseline.sha256,baselineDraftSha256:baseline.draftSha256,issuedAt:inputs.at,actor:inputs.actor,note:inputs.note};
 next.returnReview.issues.push(value);await C.validate(next);
 return{workspace:next,issue:value,raw,replayed:false};
}
async function binding(w,issueId,raw,ctx){
 const retained=history(w).issues.find(x=>x.id===issueId);C.need(retained,"Select an original issue retained by this author working copy.");
 const source=history(w).archives[retained.archiveSha256];C.need(source,"Keep the complete issued source file.");
 const issued=await readPackage(source.raw,ctx),incoming=await readPackage(raw,ctx),returned=incoming.workspace;
 C.need(issued.workspace.workspaceId===w.workspaceId&&returned.workspaceId===w.workspaceId,"This complete returned file belongs to another source workspace.");
 C.need(C.equal(issued.workspace.seed,w.seed)&&C.equal(returned.seed,w.seed),"The returned file uses another original solicitation/source edition.");
 const baseline=issued.workspace.editions.find(e=>e.id===retained.baselineEditionId),currentBase=w.editions.find(e=>e.id===retained.baselineEditionId),returnedBase=returned.editions.find(e=>e.id===retained.baselineEditionId);
 C.need(baseline&&currentBase&&returnedBase&&baseline.sha256===retained.baselineEditionSha256&&baseline.draftSha256===retained.baselineDraftSha256&&C.equal(baseline,currentBase)&&C.equal(baseline,returnedBase),"Retain the complete proven common reviewed edition in both workspaces.");
 C.need(C.equal(issued.workspace.draft,baseline.draft),"The issued source differs from its selected complete reviewed edition.");
 C.need(returned.receiving.some(x=>x.sourceWorkspaceId===w.workspaceId&&x.packageSha256===retained.archiveSha256),"The returned copy has no original receiving link to this exact issued file.");
 return{issue:retained,baseline,incoming,returned};
}
function status(b,c,r){if(same(c,r))return"same-change";if(same(r,b))return"author-change";if(same(c,b))return"returned-change";return"conflict";}
function changes(before,current,returned){
 const rows=[];
 function add(parts,b,c,r,kind="field"){
  if(same(b,c)&&same(b,r))return;
  rows.push({id:kind+":"+pointer(parts),path:pointer(parts),parts,kind,baseline:b,current:c,returned:r,status:status(b,c,r)});
 }
 function walk(parts,b,c,r){
  if(same(b,c)&&same(b,r))return;
  if(b.present&&c.present&&r.present&&plain(b.value)&&plain(c.value)&&plain(r.value)){
   const keys=[...new Set([...Object.keys(b.value),...Object.keys(c.value),...Object.keys(r.value)])].sort();
   for(const k of keys)walk([...parts,k],cell(b.value,k),cell(c.value,k),cell(r.value,k));
  }else add(parts,b,c,r);
 }
 const grouped=new Set(["requirements","slides","documents","actor","note"]);
 for(const name of [...new Set([...Object.keys(before),...Object.keys(current),...Object.keys(returned)])].sort()){
  if(!grouped.has(name))walk([name],cell(before,name),cell(current,name),cell(returned,name));
 }
 for(const name of ["requirements","slides","documents"]){
  const aa=new Map(before[name].map(x=>[x.id,x])),bb=new Map(current[name].map(x=>[x.id,x])),cc=new Map(returned[name].map(x=>[x.id,x]));
  for(const id of [...new Set([...aa.keys(),...bb.keys(),...cc.keys()])]){
   const a=aa.has(id)?{present:true,value:aa.get(id)}:missing(),b=bb.has(id)?{present:true,value:bb.get(id)}:missing(),c=cc.has(id)?{present:true,value:cc.get(id)}:missing();
   if(!a.present||!b.present||!c.present)add([name,id],a,b,c,"record");
   else for(const key of [...new Set([...Object.keys(a.value),...Object.keys(b.value),...Object.keys(c.value)])].sort())if(key!=="id")walk([name,id,key],cell(a.value,key),cell(b.value,key),cell(c.value,key));
  }
 }
 const order=d=>({present:true,value:d.documents.map(x=>x.id)});
 add(["documents"],order(before),order(current),order(returned),"order");
 return rows;
}
function publicIssue(i){return{id:i.id,archiveSha256:i.archiveSha256,baselineEditionId:i.baselineEditionId,baselineEditionSha256:i.baselineEditionSha256,issuedAt:i.issuedAt,actor:i.actor,note:i.note};}
async function preview(w,inputs){
 await C.validate(w);
 const b=await binding(w,inputs.issueId,inputs.raw),rows=changes(b.baseline.draft,w.draft,b.returned.draft);
 const value={format:"commons.hcps.return-preview.v1",workspaceId:w.workspaceId,currentWorkspaceSha256:await hash(w),currentDraftSha256:await hash(w.draft),issue:publicIssue(b.issue),baseline:{id:b.baseline.id,sha256:b.baseline.sha256,draftSha256:b.baseline.draftSha256,number:b.baseline.number},returned:{sha256:b.incoming.packageSha256,bytes:b.incoming.packageBytes,workspaceId:b.returned.workspaceId,draftSha256:await hash(b.returned.draft),editions:b.returned.editions.length,unappliedEditors:b.incoming.unappliedEditors},changes:rows,counts:{all:rows.length,conflicts:rows.filter(x=>x.status==="conflict").length,author:rows.filter(x=>x.status==="author-change").length,returned:rows.filter(x=>x.status==="returned-change").length,same:rows.filter(x=>x.status==="same-change").length}};
 value.previewSha256=await hash(value);return value;
}
function locate(root,parts){
 let at=root;
 for(const part of parts){if(Array.isArray(at)){at=at.find(x=>x.id===part);C.need(at,"An explicitly selected original record is absent.");}else{C.need(plain(at)&&own(at,part),"A selected field parent is absent.");at=at[part];}}
 return at;
}
function patch(d,row,value){
 C.need(plain(value)&&typeof value.present==="boolean"&&Object.keys(value).every(x=>["present","value"].includes(x))&&(!value.present||own(value,"value")),"Choose exact field presence and complete JSON value.");
 const parent=locate(d,row.parts.slice(0,-1)),key=row.parts.at(-1);
 if(Array.isArray(parent)){
  const index=parent.findIndex(x=>x.id===key);
  if(!value.present){if(index>=0)parent.splice(index,1);}
  else{C.need(plain(value.value)&&value.value.id===key,"A chosen full record must retain its exact source ID.");if(index>=0)parent[index]=C.clone(value.value);else parent.push(C.clone(value.value));}
 }else if(value.present)safeSet(parent,key,value.value);else delete parent[key];
}
function chosen(row,choice){
 C.need(plain(choice)&&choice.id===row.id&&["current","returned","custom"].includes(choice.choice),"Choose current, returned or complete custom content for every listed change.");
 if(choice.choice==="custom"){C.need(plain(choice.value)&&typeof choice.value.present==="boolean","Custom content needs explicit presence and its complete JSON value.");return choice.value;}
 return row[choice.choice];
}
function documentMaterial(d,id){const f=d.documents.find(x=>x.id===id);return f?C.clone(f):null;}
function requirementMaterial(d,r){return{record:C.clone(r),documents:r.evidence.map(e=>({evidence:C.clone(e),document:documentMaterial(d,e.documentId)}))};}
function sourceReviewMaterial(d,name){return{review:C.clone(d[name]),document:documentMaterial(d,d[name].documentId)};}
function reviewNeeds(d,current,returned){
 const rows=[];
 for(const r of d.requirements){
  if(!["complete","not-applicable"].includes(r.status))continue;
  const material=requirementMaterial(d,r),a=current.requirements.find(x=>x.id===r.id),b=returned.requirements.find(x=>x.id===r.id);
  if(!C.equal(material,requirementMaterial(current,a))&&!C.equal(material,requirementMaterial(returned,b)))rows.push({id:"requirement:"+r.id,kind:"requirement",recordId:r.id,message:"This assembled completion decision differs from both fully attributed material selections. Explicitly reopen or review the complete resulting evidence."});
 }
 for(const name of ["matrix","summaries"]){if(d[name].reviewed&&!C.equal(sourceReviewMaterial(d,name),sourceReviewMaterial(current,name))&&!C.equal(sourceReviewMaterial(d,name),sourceReviewMaterial(returned,name)))rows.push({id:"source:"+name,kind:"source",recordId:name,message:"The reviewed source/document selection changed. Explicitly reopen or review this resulting original source."});}
 return rows;
}
function assemble(base,current,returned,rows,choices,resolutions,seed,actor,note){
 C.need(Array.isArray(choices)&&choices.length===rows.length&&choices.every((x,i)=>x.id===rows[i].id),"Retain one ordered explicit choice for every compared change.");
 const d=C.clone(current);let order=null;
 for(let i=0;i<rows.length;i++){const value=chosen(rows[i],choices[i]);if(rows[i].kind==="order"){C.need(value.present&&Array.isArray(value.value),"Keep an explicit complete document order.");order=C.clone(value.value);}else patch(d,rows[i],value);}
 if(order){const byId=new Map(d.documents.map(x=>[x.id,x]));C.need(order.length===byId.size&&new Set(order).size===order.length&&order.every(id=>byId.has(id)),"The selected document order must include every retained document exactly once. Resolve added/deleted documents and the full order explicitly.");d.documents=order.map(id=>byId.get(id));}
 d.actor=actor;d.note=note;C.validateDraft(d,seed);
 const needed=reviewNeeds(d,current,returned);
 C.need(Array.isArray(resolutions),"Retain explicit material-review decisions.");const map=new Map(resolutions.map(r=>[r.id,r]));
 C.need(map.size===resolutions.length&&resolutions.every(r=>needed.some(n=>n.id===r.id)),"Each material-review decision must identify exactly one current finding.");
 for(const n of needed){
  const r=map.get(n.id);if(!r)continue;text(r.reason);C.need(r.reason.trim()&&["reopen","review"].includes(r.mode),"Record an explicit review/reopening and reason.");
  if(n.kind==="requirement"){
   const v=d.requirements.find(x=>x.id===n.recordId);
   if(r.mode==="reopen"){C.need(["open","in-progress","ready-for-review"].includes(r.status),"Choose a non-complete requirement state.");v.status=r.status;v.reviewer="";v.decisionDate="";}
   else{C.need(["complete","not-applicable"].includes(r.status),"Choose an explicit reviewed completion/applicability state.");text(r.reviewer,1000);text(r.decisionDate,40);text(r.note);C.need(r.reviewer.trim()&&/^\d{4}-\d{2}-\d{2}$/.test(r.decisionDate)&&r.note.trim(),"Record reviewer, ISO date and complete decision basis.");if(r.status==="complete")C.need(v.evidence.length,"A reviewed completion needs its selected original evidence.");Object.assign(v,{status:r.status,reviewer:r.reviewer,decisionDate:r.decisionDate,note:r.note});}
  }else{const v=d[n.recordId];if(r.mode==="reopen")v.reviewed=false;else{text(r.reviewer,1000);text(r.note);C.need(v.documentId&&r.reviewer.trim()&&r.note.trim(),"Review the exact retained document with named reviewer and basis.");Object.assign(v,{reviewed:true,reviewer:r.reviewer,note:r.note});}}
 }
 C.validateDraft(d,seed);return{draft:d,materialReviews:needed,unresolved:needed.filter(n=>!map.has(n.id))};
}
async function plan(w,inputs){
 checkAttribution(inputs);const p=await preview(w,inputs);C.need(p.previewSha256===inputs.expectedPreviewSha256,"The complete author or returned source changed. Preserve the choices and compare the exact originals again.");
 C.need(!p.returned.unappliedEditors.length||inputs.acknowledgeUnapplied===true,"The full returned file includes unapplied editor text. Explicitly acknowledge its retained originals before choosing applied content.");
 const b=await binding(w,inputs.issueId,inputs.raw),result=assemble(b.baseline.draft,w.draft,b.returned.draft,p.changes,inputs.choices,inputs.materialReviews||[],w.seed,inputs.actor,inputs.note);
 const objects={...w.objects};
 for(const [sha,value] of Object.entries(b.returned.objects)){if(objects[sha])C.need(C.equal(objects[sha],value),"The same original document hash has conflicting whole bytes.");else objects[sha]=C.clone(value);}
 await C.verifyDocuments(result.draft,objects);
 const value={format:"commons.hcps.return-plan.v1",workspaceId:w.workspaceId,requestId:inputs.requestId,at:inputs.at,actor:inputs.actor,note:inputs.note,issueId:inputs.issueId,issueSha256:p.issue.archiveSha256,previewSha256:p.previewSha256,currentWorkspaceSha256:p.currentWorkspaceSha256,beforeDraftSha256:p.currentDraftSha256,returnedSha256:p.returned.sha256,returnedBytes:p.returned.bytes,baselineEditionId:p.baseline.id,baselineEditionSha256:p.baseline.sha256,acknowledgeUnapplied:inputs.acknowledgeUnapplied===true,unappliedEditors:p.returned.unappliedEditors,changes:p.changes,choices:C.clone(inputs.choices),materialReviews:C.clone(inputs.materialReviews||[]),requiredMaterialReviews:result.materialReviews,unresolved:result.unresolved,beforeDraft:C.clone(w.draft),draft:result.draft,draftSha256:await hash(result.draft)};
 value.planSha256=await hash(value);return{plan:value,objects};
}
async function apply(w,inputs){
 const material={...inputs};delete material.expectedPlanSha256;const requestSha256=await hash(material);
 const prior=history(w).decisions.find(r=>r.requestId===inputs.requestId);
 if(prior){C.need(prior.requestSha256===requestSha256&&prior.planSha256===inputs.expectedPlanSha256,"This original return request already names different whole decisions.");await C.validate(w);return{workspace:C.clone(w),decision:C.clone(prior),replayed:true};}
 const result=await plan(w,inputs),p=result.plan;
 C.need(inputs.expectedPlanSha256===p.planSha256,"Retain and review this exact complete plan before applying it.");
 C.need(p.unresolved.length===0,"Resolve each changed-material review explicitly before saving this edition.");
 let next=copyWithHistory(w);next.objects=result.objects;next.draft=C.clone(p.draft);
 const archiveSha256=await archive(next,inputs.raw,"returned");C.need(archiveSha256===p.returnedSha256,"The whole returned file changed.");
 next=await C.saveEdition(next,{actor:inputs.actor,note:inputs.note,at:inputs.at,editionId:inputs.requestId});
 const requestMetadata={...material};delete requestMetadata.raw;
 const edition=next.editions.at(-1),record={requestId:inputs.requestId,requestSha256,requestMetadata:C.clone(requestMetadata),issueId:inputs.issueId,returnedSha256:p.returnedSha256,planSha256:p.planSha256,editionId:edition.id,editionSha256:edition.sha256,appliedAt:inputs.at,plan:p};
 next.returnReview.decisions.push(record);await C.validate(next);return{workspace:next,decision:record,replayed:false};
}
async function validateHistory(w,context){
 if(!w.returnReview)return w;const h=w.returnReview,ctx=checkContext(context);
 C.need(plain(h)&&h.format===FORMAT&&plain(h.archives)&&Array.isArray(h.issues)&&Array.isArray(h.decisions),"Keep the whole original issue/return review history.");
 C.need(Object.keys(h.archives).length<=MAX_ARCHIVES&&h.issues.length<=128&&h.decisions.length<=128,"Preserve the complete bounded review history.");
 sourceBudget(w);const parsed=new Map();
 for(const [key,a] of Object.entries(h.archives)){
  C.need(/^[0-9a-f]{64}$/.test(key)&&plain(a)&&["issued","returned"].includes(a.kind),"An original review archive identity differs.");
  text(a.raw,800*1024*1024);C.need(a.bytes===C.bytes(a.raw).length&&await C.sha(a.raw)===key,"The whole retained issue/return bytes differ.");
  if(!ctx.validatedArchives.has(key)){C.need(!ctx.activeArchives.has(key)&&ctx.depth<16,"The original review archive custody is cyclic or too deeply nested.");ctx.activeArchives.add(key);try{await readPackage(a.raw,{...ctx,depth:ctx.depth+1});ctx.validatedArchives.add(key);}finally{ctx.activeArchives.delete(key);}}
 }
 const issues=new Set(),requests=new Set();
 for(const i of h.issues){
  C.need(plain(i)&&!issues.has(i.id)&&h.archives[i.archiveSha256]?.kind==="issued","Keep unique original issues and their whole source files.");issues.add(i.id);
  C.need(plain(i.originalRequest)&&await hash({kind:"issue",...i.originalRequest})===i.requestSha256&&i.originalRequest.requestId===i.id&&i.originalRequest.editionId===i.baselineEditionId&&i.originalRequest.actor===i.actor&&i.originalRequest.note===i.note&&i.originalRequest.at===i.issuedAt,"The original issued request differs.");
  for(const key of ["id","requestSha256","baselineEditionId","baselineEditionSha256","baselineDraftSha256","issuedAt","actor","note"])text(i[key],key==="note"?12000:1000);
  const outer=JSON.parse(h.archives[i.archiveSha256].raw);C.need(outer.format==="commons.hcps.response-package.v1","An issued original must be a whole reviewed workspace package.");const source=outer.workspace;
  C.need(source?.workspaceId===w.workspaceId&&C.equal(source.seed,w.seed),"An issued archive belongs to another original source.");
  const e=w.editions.find(e=>e.id===i.baselineEditionId),incoming=source.editions.find(e=>e.id===i.baselineEditionId);
  C.need(e&&incoming&&C.equal(e,incoming)&&e.sha256===i.baselineEditionSha256&&e.draftSha256===i.baselineDraftSha256&&C.equal(source.draft,e.draft),"An issued complete baseline differs.");
 }
 for(const r of h.decisions){
  C.need(plain(r)&&!requests.has(r.requestId)&&issues.has(r.issueId)&&h.archives[r.returnedSha256]?.kind==="returned","Keep each original applied request, issue and complete returned file.");requests.add(r.requestId);
  C.need(plain(r.requestMetadata)&&await hash({...r.requestMetadata,raw:h.archives[r.returnedSha256].raw})===r.requestSha256,"The original complete apply request differs.");
  const p=r.plan;C.need(plain(p)&&p.format==="commons.hcps.return-plan.v1"&&p.requestId===r.requestId&&p.issueId===r.issueId&&p.returnedSha256===r.returnedSha256&&p.planSha256===r.planSha256,"The complete retained review decision differs.");
  const material={...p};delete material.planSha256;C.need(await hash(material)===p.planSha256&&p.workspaceId===w.workspaceId,"The retained full plan identity differs.");
  C.need(r.requestMetadata.requestId===r.requestId&&r.requestMetadata.issueId===r.issueId&&r.requestMetadata.expectedPreviewSha256===p.previewSha256&&r.requestMetadata.at===p.at&&r.requestMetadata.actor===p.actor&&r.requestMetadata.note===p.note&&C.equal(r.requestMetadata.choices,p.choices)&&C.equal(r.requestMetadata.materialReviews||[],p.materialReviews)&&(r.requestMetadata.acknowledgeUnapplied===true)===p.acknowledgeUnapplied,"The retained original request and full plan differ.");
  const e=w.editions.find(e=>e.id===r.editionId);
  C.need(e&&e.id===r.requestId&&e.sha256===r.editionSha256&&e.createdAt===r.appliedAt&&e.createdAt===p.at&&e.actor===p.actor&&e.note===p.note&&e.draftSha256===p.draftSha256&&C.equal(e.draft,p.draft),"The original decision and immutable reviewed edition differ.");
  C.need(p.beforeDraftSha256===await hash(p.beforeDraft)&&p.draftSha256===await hash(p.draft),"The complete before/after content differs.");
  C.validateDraft(p.beforeDraft,w.seed);await C.verifyDocuments(p.beforeDraft,w.objects);
  const issue=h.issues.find(i=>i.id===r.issueId),issued=JSON.parse(h.archives[issue.archiveSha256].raw).workspace;
  const original=JSON.parse(h.archives[r.returnedSha256].raw),returned=original.format==="commons.hcps.working-copy.v1"?original.package.workspace:original.workspace;
  const baseline=issued.editions.find(x=>x.id===issue.baselineEditionId),returnedBase=returned.editions.find(x=>x.id===issue.baselineEditionId);
  C.need(C.equal(returned.seed,w.seed)&&returnedBase&&C.equal(returnedBase,baseline),"The full original returned baseline or issued-source seed differs.");
  const rawEditors=original.format==="commons.hcps.working-copy.v1"?original.rawEditors:{};C.need(plain(rawEditors)&&C.equal(unapplied(original),p.unappliedEditors)&&(!p.unappliedEditors.length||p.acknowledgeUnapplied===true),"Keep the original unfinished-editor acknowledgement.");
  C.need(p.issueSha256===issue.archiveSha256&&p.baselineEditionId===baseline.id&&p.baselineEditionSha256===baseline.sha256&&returned.workspaceId===w.workspaceId&&returned.receiving.some(x=>x.sourceWorkspaceId===w.workspaceId&&x.packageSha256===issue.archiveSha256),"The retained decision changed its original issue/return binding.");
  const rows=changes(baseline.draft,p.beforeDraft,returned.draft);
  C.need(C.equal(rows,p.changes),"The original complete compared changes differ.");
  const assembled=assemble(baseline.draft,p.beforeDraft,returned.draft,rows,p.choices,p.materialReviews,w.seed,p.actor,p.note);
  C.need(assembled.unresolved.length===0&&C.equal(assembled.materialReviews,p.requiredMaterialReviews)&&C.equal(assembled.draft,p.draft),"The retained choices no longer reconstruct the exact reviewed edition.");
 }
 return w;
}
const api={FORMAT,MAX_HISTORY,MAX_ARCHIVES,readPackage,history,issue,preview,plan,apply,validateHistory,changes,sourceBudget};
global.HCPSReturns=api;if(typeof module!=="undefined")module.exports=api;
})(typeof globalThis!=="undefined"?globalThis:window);
