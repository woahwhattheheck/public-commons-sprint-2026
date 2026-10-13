// Generic portable Learning decisions. Original workspace mutations remain native.
export const SCHEMAS=Object.freeze({
 context:"stellar-forge.grant-analyst-learning-context.v1",
 packet:"stellar-forge.grant-analyst-learning-packet.v1",
 draft:"stellar-forge.grant-analyst-learning-draft.v1",
 returned:"stellar-forge.grant-analyst-learning-return.v1",
 preview:"stellar-forge.grant-analyst-learning-return-preview.v1",
 guard:"stellar-forge.grant-analyst-learning-guard.v1",
 bundle:"stellar-forge.grant-analyst-learning-exchange-bundle.v1"
});
const MAX_BYTES=64*1024*1024;
const FIELDS=["title","owner","dueOn","successCriteria","status","note","evidence"];
const STATUSES=["OPEN","IN_PROGRESS","COMPLETED","WITHDRAWN"];
function need(value,message){if(!value)throw new Error(message);}
function text(value,name){need(typeof value==="string"&&value.trim(),"Supply "+name);return value.trim();}
function id(value,name){need(typeof value==="string"&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value),"Use a stable "+name);return value;}
function sourceId(value){need(typeof value==="string"&&/^[a-z0-9][a-z0-9_-]{0,179}$/.test(value),"Invalid original source edition ID");return value;}
function digest(value,name="SHA256"){need(typeof value==="string"&&/^[a-f0-9]{64}$/.test(value),"Invalid "+name);return value;}
function instant(value){need(typeof value==="string"&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value)),"Use an ISO timestamp");return value;}
function object(value,name){need(value&&typeof value==="object"&&!Array.isArray(value),"Supply "+name);return value;}
function exactKeys(value,keys,name){object(value,name);need(Object.keys(value).sort().join("|")===keys.slice().sort().join("|"),name+" fields differ");}
function plain(value,depth=0){
 need(depth<=80,"JSON nesting exceeds the complete packet limit");
 if(value===null||typeof value==="boolean")return value;
 if(typeof value==="string"){for(const c of value){const n=c.codePointAt(0);need(n<0xd800||n>0xdfff,"Unpaired Unicode surrogate");}return value;}
 if(typeof value==="number"){need(Number.isFinite(value),"Non-finite numbers are not portable JSON");return value;}
 if(Array.isArray(value))return value.map(x=>plain(x,depth+1));
 need(value&&typeof value==="object"&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null),"Use complete plain JSON values");
 const result=Object.create(null);for(const key of Object.keys(value).sort())result[key]=plain(value[key],depth+1);return result;
}
export function canonical(value){return JSON.stringify(plain(value),null,2)+"\n";}
function clone(value){return JSON.parse(JSON.stringify(value));}
function equal(a,b){return canonical(a)===canonical(b);}
function sha256Utf8(s){
const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2],H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],R=(x,n)=>(x>>>n)|(x<<(32-n));

const block=new Uint8Array(64),w=new Int32Array(64);let used=0,bytes=0;
function compress(){for(let i=0;i<16;i++)w[i]=(block[4*i]<<24)|(block[4*i+1]<<16)|(block[4*i+2]<<8)|block[4*i+3];for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(R(x,7)^R(x,18)^(x>>>3))+w[i-7]+(R(y,17)^R(y,19)^(y>>>10)))|0;}let [b,c,d,e,f,g,h,j]=H;for(let i=0;i<64;i++){const t=(j+(R(f,6)^R(f,11)^R(f,25))+((f&g)^(~f&h))+K[i]+w[i])|0,u=((R(b,2)^R(b,13)^R(b,22))+((b&c)^(b&d)^(c&d)))|0;j=h;h=g;g=f;f=(e+t)|0;e=d;d=c;c=b;b=(t+u)|0;}[b,c,d,e,f,g,h,j].forEach((x,i)=>H[i]=(H[i]+x)|0);}

function emit(n){block[used++]=n;if(used===64){compress();used=0;}}
for(const c of s){const n=c.codePointAt(0);if(n<128){emit(n);bytes++;}else if(n<2048){emit(192|(n>>6));emit(128|(n&63));bytes+=2;}else if(n<65536){emit(224|(n>>12));emit(128|((n>>6)&63));emit(128|(n&63));bytes+=3;}else{emit(240|(n>>18));emit(128|((n>>12)&63));emit(128|((n>>6)&63));emit(128|(n&63));bytes+=4;}}
const bit=bytes*8;emit(128);while(used!==56)emit(0);for(let i=7;i>=0;i--)emit(i>=4?Math.floor(bit/4294967296/2**((i-4)*8))&255:Math.floor(bit/2**(i*8))&255);
return {bytes,sha256:H.map(x=>(x>>>0).toString(16).padStart(8,"0")).join("")};
}
export function identityText(value){need(typeof value==="string","Supply literal UTF-8 text");plain(value);const result=sha256Utf8(value);need(result.bytes<=MAX_BYTES,"Complete exchange exceeds the 64 MiB file limit; retain it whole and select a smaller review scope");return result;}
export function parseExchange(value){const bytes=identityText(value);need(bytes.bytes>0,"Empty exchange");return JSON.parse(value);}
function checksum(value){return identityText(canonical(value)).sha256;}
function sourceIDs(cycle,selection){return [...new Set([cycle.baseline.report.edition.id,...cycle.reviews.map(x=>x.snapshot.report.edition.id),...(selection.mode==="review"?[selection.edition]:[])])].sort();}
function bookIDs(cycle,selected){return [...new Set([selected.id,cycle.baseline.report.codebook.id,...cycle.reviews.map(x=>x.snapshot.report.codebook.id)])].sort();}
function inspectContext(contextText){
 const literal=identityText(contextText),c=parseExchange(contextText);object(c,"original context");
 need(c.schema===SCHEMAS.context,"Unsupported original context");id(c.workspaceId,"workspace ID");text(c.workspaceName,"workspace name");instant(c.createdAt);
 const s=c.selection;object(s,"context selection");need(["action","review"].includes(s.mode),"Select action or whole review mode");
 exactKeys(s,s.mode==="action"?["mode","cycle","action"]:["mode","cycle","edition","grantIds"],"Context selection");id(s.cycle,"cycle ID");
 const cycle=c.cycle;need(cycle?.schema==="tjlabs.grant-analyst-learning.v1"&&cycle.id===s.cycle,"Selected original cycle differs");digest(c.cycleSha256);
 need(Array.isArray(cycle.actions)&&cycle.actions.length>0&&Array.isArray(cycle.reviews),"Retain every original action and review");
 const actions=new Set();for(const a of cycle.actions){id(a.id,"action ID");need(!actions.has(a.id),"Duplicate original action");actions.add(a.id);need(Array.isArray(a.revisions)&&a.revisions.length>0,"Retain complete action revisions");for(let i=0;i<a.revisions.length;i++){const r=a.revisions[i];need(r.revision===i+1,"Original action revision sequence differs");for(const f of ["title","owner","dueOn","successCriteria","reviewer","note","evidence"])text(r[f],f);need(STATUSES.includes(r.status),"Original action status differs");}}
 need(cycle.baseline?.report?.workspace===c.workspaceId,"Baseline belongs to another workspace");
 const reviews=new Set();for(const r of cycle.reviews){id(r.id,"review ID");need(!reviews.has(r.id),"Duplicate original review");reviews.add(r.id);need(r.snapshot?.report?.workspace===c.workspaceId,"Review belongs to another workspace");}
 const book=c.selectedCodebook;object(book,"selected original codebook");id(book.id,"codebook ID");digest(c.selectedCodebookSha256);
 need(Array.isArray(c.codebooks)&&Array.isArray(c.sources),"Retain original source and codebook context");
 const books=new Map();for(const row of c.codebooks){id(row.id,"codebook ID");need(!books.has(row.id),"Duplicate original codebook");books.set(row.id,row);}
 need(equal([...books.keys()].sort(),bookIDs(cycle,book))&&equal(books.get(book.id),book),"Complete original codebook population differs");
 const sources=new Map();for(const row of c.sources){object(row.edition,"original source edition");sourceId(row.edition.id);need(!sources.has(row.edition.id),"Duplicate original source");const actual=identityText(row.text);need(row.bytes===actual.bytes&&row.sha256===actual.sha256&&row.edition.bytes===actual.bytes&&row.edition.sha256===actual.sha256,"Original source literal bytes differ");sources.set(row.edition.id,row);}
 need(equal([...sources.keys()].sort(),sourceIDs(cycle,s)),"Complete original source population differs");
 for(const snap of [cycle.baseline,...cycle.reviews.map(x=>x.snapshot)]){need(sources.has(snap.report.edition.id)&&sources.get(snap.report.edition.id).sha256===snap.report.edition.sha256,"Retained finding source differs");need(books.has(snap.report.codebook.id),"Retained finding codebook absent");digest(snap.sha256);need(Number.isSafeInteger(snap.bytes)&&snap.bytes>0,"Original snapshot size differs");}
 if(s.mode==="action"){id(s.action,"action ID");need(actions.has(s.action),"Selected original action absent");need(c.snapshot===null&&c.report===null&&c.comparison===null,"Action context must not invent a later review snapshot");}
 else{
  sourceId(s.edition);need(Array.isArray(s.grantIds)&&s.grantIds.length>0&&new Set(s.grantIds).size===s.grantIds.length&&s.grantIds.every(x=>typeof x==="string"&&x.length),"Select distinct original grant references");
  const snap=c.snapshot;need(snap&&c.report&&c.comparison,"Retain the full later snapshot, report and comparison");digest(c.snapshotSha256);
  need(snap.sha256===c.snapshotSha256&&snap.report.edition.id===s.edition&&snap.report.codebook.id===book.id&&snap.report.workspace===c.workspaceId&&equal(snap.references,s.grantIds),"Later snapshot selection differs");
  const report=clone(c.report);delete report.createdAt;need(equal(report,snap.report),"Current complete report differs from retained snapshot");
  const rows=new Map(snap.report.rows.map(r=>[r.grantId,r]));need(s.grantIds.every(key=>rows.get(key)?.reviewState==="CURRENT"),"Referenced grants are not current in the retained snapshot");
 }
 return {context:c,contextText,contextSha256:literal.sha256,contextBytes:literal.bytes};
}
function packetPayload(p){const {sha256,...body}=p;return body;}
export function issuePacket(contextText,options){
 const c=inspectContext(contextText);object(options,"packet metadata");
 const p={schema:SCHEMAS.packet,id:id(options.id,"packet ID"),issuedAt:instant(options.issuedAt),issuedBy:text(options.issuedBy,"issuing operator"),recipient:text(options.recipient,"intended reviewer"),instructions:text(options.instructions,"review instructions"),contextText,contextSha256:c.contextSha256,contextBytes:c.contextBytes};
 return {...p,sha256:checksum(p)};
}
export function inspectPacket(packet,depth=0){
 need(depth<=12,"Rebase lineage exceeds the portable depth limit");object(packet,"packet");need(packet.schema===SCHEMAS.packet,"Unsupported Learning packet");
 exactKeys(packet,["schema","id","issuedAt","issuedBy","recipient","instructions","contextText","contextSha256","contextBytes","sha256",...(packet.rebase?["rebase"]:[])],"Packet");
 id(packet.id,"packet ID");instant(packet.issuedAt);for(const k of ["issuedBy","recipient","instructions"])text(packet[k],k);
 need(checksum(packetPayload(packet))===digest(packet.sha256),"Packet content changed");
 const c=inspectContext(packet.contextText);need(c.contextSha256===packet.contextSha256&&c.contextBytes===packet.contextBytes,"Literal original context changed");
 if(packet.rebase){
  const r=packet.rebase;exactKeys(r,["parentReturn","reason","reviewer","recordedAt","choices"],"Rebase record");text(r.reason,"rebase reason");text(r.reviewer,"rebase reviewer");instant(r.recordedAt);
  const old=inspectReturn(r.parentReturn,depth+1);
  need(old.context.workspaceId===c.context.workspaceId&&equal(old.context.selection,c.context.selection),"Rebase changed original workspace or selection");
  validateChoices(previewContexts(r.parentReturn,old,c),r.choices);
 }
 return {packet,context:c.context};
}
function selectedActions(c){return c.selection.mode==="action"?c.cycle.actions.filter(x=>x.id===c.selection.action):c.cycle.actions;}
function initialDecision(c,reviewer,reviewId){
 return {reviewer,reviewId:c.selection.mode==="review"?reviewId:null,interpretation:"",limitations:"",
 actions:selectedActions(c).map(a=>{const r=a.revisions.at(-1);return {id:a.id,title:r.title,owner:r.owner,dueOn:r.dueOn,successCriteria:r.successCriteria,status:r.status,note:"",evidence:""};})};
}
function validDate(value){return typeof value==="string"&&/^\d{4}-\d\d-\d\d$/.test(value)&&Number(value.slice(0,4))>=1&&Number.isFinite(Date.parse(value+"T00:00:00Z"))&&new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value;}
function decisionCheck(c,d,complete){
 exactKeys(d,["reviewer","reviewId","interpretation","limitations","actions"],"Saved decision");
 for(const k of ["reviewer","interpretation","limitations"])need(typeof d[k]==="string","Decision "+k+" must be text");
 const ids=selectedActions(c).map(a=>a.id);need(Array.isArray(d.actions)&&d.actions.length===ids.length&&equal(d.actions.map(a=>a.id).sort(),ids.slice().sort()),"Review every selected original action exactly once");
 for(const row of d.actions){exactKeys(row,["id",...FIELDS],"Action decision");for(const k of FIELDS)need(typeof row[k]==="string","Decision "+k+" must be text");if(complete){for(const k of FIELDS)text(row[k],k);need(validDate(row.dueOn),"Use a valid YYYY-MM-DD due date");need(STATUSES.includes(row.status),"Choose an explicit action status");}}
 if(c.selection.mode==="review"){need(typeof d.reviewId==="string","Review ID must be saved as text");if(complete){id(d.reviewId,"new review ID");need(!c.cycle.reviews.some(r=>r.id===d.reviewId),"This native review ID already exists");text(d.interpretation,"review interpretation");text(d.limitations,"evidence limitations");}}
 else need(d.reviewId===null&&d.interpretation===""&&d.limitations==="","Action-only return cannot add a whole-cycle interpretation");
 if(complete)text(d.reviewer,"reviewing operator");return d;
}
function historyBody(row){const {sha256,...value}=row;return value;}
function draftPayload(d){const {packet,sha256,...value}=d;return {...value,packetSha256:packet.sha256};}
function finishDraft(d){return {...d,sha256:checksum(draftPayload(d))};}
export function createDraft(packet,{id:identity,recordedAt,editor}){
 const {context}=inspectPacket(packet);const decision=initialDecision(context,text(editor,"draft editor"),context.selection.mode==="review"?"review-"+checksum({id:id(identity,"draft ID")}).slice(0,40):null);
 const first={revision:1,previousSha256:null,recordedAt:instant(recordedAt),editor:text(editor,"draft editor"),decision};
 first.sha256=checksum(first);return finishDraft({schema:SCHEMAS.draft,id:id(identity,"draft ID"),packet:clone(packet),history:[first]});
}
export function inspectDraft(draft,depth=0){
 exactKeys(draft,["schema","id","packet","history","sha256"],"Draft");need(draft.schema===SCHEMAS.draft,"Unsupported Learning draft");id(draft.id,"draft ID");
 const {packet,context}=inspectPacket(draft.packet,depth);need(Array.isArray(draft.history)&&draft.history.length>0,"Retain complete draft history");
 let prior=null;for(let i=0;i<draft.history.length;i++){const row=draft.history[i];exactKeys(row,["revision","previousSha256","recordedAt","editor","decision","sha256"],"Draft revision");need(row.revision===i+1&&row.previousSha256===prior,"Draft history chain differs");instant(row.recordedAt);text(row.editor,"draft editor");decisionCheck(context,row.decision,false);need(checksum(historyBody(row))===digest(row.sha256),"Saved draft revision changed");prior=row.sha256;}
 need(checksum(draftPayload(draft))===digest(draft.sha256),"Saved draft changed");return {draft,packet,context,decision:clone(draft.history.at(-1).decision)};
}
export function saveDraft(draft,decision,{recordedAt,editor}){
 const {context}=inspectDraft(draft);decisionCheck(context,decision,false);
 const row={revision:draft.history.length+1,previousSha256:draft.history.at(-1).sha256,recordedAt:instant(recordedAt),editor:text(editor,"draft editor"),decision:clone(decision)};
 row.sha256=checksum(row);return finishDraft({...clone(draft),history:[...clone(draft.history),row]});
}
function returnPayload(r){const {draft,sha256,...value}=r;return {...value,draftSha256:draft.sha256};}
export function createReturn(draft,{id:identity,submittedAt,submittedBy}){
 const checked=inspectDraft(draft);decisionCheck(checked.context,checked.decision,true);
 const r={schema:SCHEMAS.returned,id:id(identity,"return ID"),submittedAt:instant(submittedAt),submittedBy:text(submittedBy,"returning reviewer"),draft:clone(draft)};
 return {...r,sha256:checksum(returnPayload(r))};
}
export function inspectReturn(returned,depth=0){
 exactKeys(returned,["schema","id","submittedAt","submittedBy","draft","sha256"],"Return");need(returned.schema===SCHEMAS.returned,"Unsupported Learning return");id(returned.id,"return ID");instant(returned.submittedAt);text(returned.submittedBy,"returning reviewer");
 const checked=inspectDraft(returned.draft,depth);decisionCheck(checked.context,checked.decision,true);need(checksum(returnPayload(returned))===digest(returned.sha256),"Returned decision changed");return {returned,...checked};
}
function sameSelection(a,b){return a.workspaceId===b.workspaceId&&equal(a.selection,b.selection);}
export function previewReturn(returned,currentContextText,depth=0){
 const old=inspectReturn(returned,depth),fresh=inspectContext(currentContextText);return previewContexts(returned,old,fresh);
}
function previewContexts(returned,old,fresh){
 const issued=old.context,current=fresh.context;
 need(sameSelection(issued,current),"Select the same original workspace, cycle, action and evidence references");
 const conflicts=[];
 for(const [key,label] of [["cycleSha256","Cycle history changed"],["selectedCodebookSha256","Selected codebook changed"],...(issued.selection.mode==="review"?[["snapshotSha256","Selected source review or report changed"]]:[])])if(issued[key]!==current[key])conflicts.push({kind:key,message:label,issued:issued[key],current:current[key]});
 const actions=old.decision.actions.map(row=>{
  const before=issued.cycle.actions.find(a=>a.id===row.id)?.revisions.at(-1),now=current.cycle.actions.find(a=>a.id===row.id)?.revisions.at(-1);
  need(before&&now,"An original action is absent from current context");
  return {id:row.id,issued:clone(before),current:clone(now),returned:clone(row),changes:FIELDS.map(field=>({field,issued:before[field],current:now[field],returned:row[field],hostChanged:before[field]!==now[field],reviewerChanged:before[field]!==row[field],choiceRequired:before[field]!==now[field]&&row[field]!==now[field]}))};
 });
 if(issued.cycleSha256===current.cycleSha256)need(equal(issued.cycle,current.cycle),"Matching cycle digest has a different displayed original cycle");
 if(issued.selectedCodebookSha256===current.selectedCodebookSha256)need(equal(issued.selectedCodebook,current.selectedCodebook),"Matching codebook digest has a different original definition");
 if(issued.selection.mode==="review"&&issued.snapshotSha256===current.snapshotSha256)need(equal(issued.snapshot.report,current.snapshot.report)&&equal(issued.snapshot.references,current.snapshot.references),"Matching evidence digest has a different complete report");
 if(issued.selection.mode==="review"&&current.cycle.reviews.some(r=>r.id===old.decision.reviewId))conflicts.push({kind:"reviewId",message:"The returned native review ID is already present"});
 return {schema:SCHEMAS.preview,returnSha256:returned.sha256,packetSha256:old.packet.sha256,currentContextSha256:fresh.contextSha256,canApply:conflicts.length===0,conflicts,actions,issued:clone(issued),current:clone(current)};
}
function validateChoices(preview,choices){
 object(choices,"explicit rebase choices");need(choices.context==="accept-current-context","Explicitly acknowledge the complete current context");object(choices.actions,"action field choices");
 const ids=new Set(preview.actions.map(a=>a.id));for(const key of Object.keys(choices.actions))need(ids.has(key),"Choice refers to another action");
 for(const action of preview.actions){const selected=choices.actions[action.id]||{};object(selected,"action choices");for(const field of Object.keys(selected))need(FIELDS.includes(field)&&["current","returned"].includes(selected[field]),"Unknown rebase field choice");for(const change of action.changes)if(change.choiceRequired)need(["current","returned"].includes(selected[change.field]),"Choose current or returned "+action.id+" / "+change.field);}
}
export function rebaseReturn(returned,currentContextText,{id:identity,recordedAt,reviewer,reason,choices}){
 const checked=inspectReturn(returned),preview=previewReturn(returned,currentContextText);need(!preview.canApply,"This return already matches current context");validateChoices(preview,choices);text(reason,"rebase reason");text(reviewer,"rebasing operator");
 const packet=issuePacket(currentContextText,{id:id(identity,"new packet ID"),issuedAt:recordedAt,issuedBy:reviewer,recipient:checked.packet.recipient,instructions:checked.packet.instructions});
 packet.rebase={parentReturn:clone(returned),reason:reason.trim(),reviewer:reviewer.trim(),recordedAt:instant(recordedAt),choices:clone(choices)};packet.sha256=checksum(packetPayload(packet));
 let draft=createDraft(packet,{id:identity,recordedAt,editor:reviewer});
 const decision=clone(checked.decision);decision.reviewer=reviewer.trim();if(decision.reviewId&&preview.current.cycle.reviews.some(r=>r.id===decision.reviewId))decision.reviewId="review-"+checksum({id:identity}).slice(0,40);
 for(const a of preview.actions){const target=decision.actions.find(x=>x.id===a.id);for(const change of a.changes)if(choices.actions[a.id]?.[change.field]==="current")target[change.field]=change.current;}
 return saveDraft(draft,decision,{recordedAt,editor:reviewer});
}
export function prepareApply(returned,currentContextText){
 const checked=inspectReturn(returned),preview=previewReturn(returned,currentContextText);need(preview.canApply,"Current context differs; review and explicitly rebase this return first");
 const c=preview.current,d=checked.decision;
 const guard={schema:SCHEMAS.guard,workspaceId:c.workspaceId,cycleSha256:c.cycleSha256,selectedCodebookSha256:c.selectedCodebookSha256,selection:clone(c.selection),packetSha256:checked.packet.sha256,returnSha256:returned.sha256,...(c.selection.mode==="review"?{snapshotSha256:c.snapshotSha256}:{})};
 const actions=d.actions.map(a=>({...clone(a),expectedRevision:c.cycle.actions.find(x=>x.id===a.id).revisions.at(-1).revision}));
 if(c.selection.mode==="action"){const {id:action,...row}=actions[0];return {action:"cycle-action",body:{cycle:c.cycle.id,action,...row,reviewer:d.reviewer,_merchantLearningExchange:guard}};}
 return {action:"cycle-review",body:{cycle:c.cycle.id,id:d.reviewId,codebook:c.selectedCodebook.id,edition:c.selection.edition,grantIds:clone(c.selection.grantIds),reviewer:d.reviewer,interpretation:d.interpretation,limitations:d.limitations,actions,_merchantLearningExchange:guard}};
}
export function createBundle({id:identity,createdAt,packets=[],drafts=[],returns=[],operations=[],applications=[]}){
 for(const p of packets)inspectPacket(p);for(const d of drafts)inspectDraft(d);for(const r of returns)inspectReturn(r);
 const b={schema:SCHEMAS.bundle,id:id(identity,"exchange bundle ID"),createdAt:instant(createdAt),packets:clone(packets),drafts:clone(drafts),returns:clone(returns),operations:clone(operations),applications:clone(applications)};
 inspectApplications(b);return {...b,sha256:checksum(b)};
}
function inspectApplications(bundle){
 const returned=new Map(bundle.returns.map(r=>[r.sha256,r]));
 need(returned.size===bundle.returns.length,"Duplicate return identity in bundle");
 const operations=new Map(),requestIds=new Set();
 for(const o of bundle.operations){
  exactKeys(o,["id","returnSha256","contextText","request"],"Retained operation");id(o.id,"operation ID");need(!operations.has(o.id),"Duplicate retained operation");operations.set(o.id,o);
  digest(o.returnSha256);need(returned.has(o.returnSha256),"Bundle must include the full selected return");
  const expected=prepareApply(returned.get(o.returnSha256),o.contextText);exactKeys(o.request,["action","body"],"Original request");need(o.request.action===expected.action,"Original action differs");
  const {requestId,...body}=o.request.body;need(typeof requestId==="string"&&/^[A-Za-z0-9._:-]{1,180}$/.test(requestId)&&!requestIds.has(requestId),"Invalid or duplicate original request ID");requestIds.add(requestId);
  need(equal(body,expected.body),"Original request body differs from the selected return");
 }
 const seen=new Set();for(const a of bundle.applications){
  exactKeys(a,["operationId","returnSha256","contextText","request","receipt"],"Native application record");id(a.operationId,"operation ID");
  need(!seen.has(a.operationId),"Duplicate original application receipt");seen.add(a.operationId);
  const o=operations.get(a.operationId);need(o&&a.returnSha256===o.returnSha256&&a.contextText===o.contextText&&equal(a.request,o.request),"Native receipt does not reference the exact retained operation");
  const expected=prepareApply(returned.get(a.returnSha256),a.contextText);object(a.receipt,"original request receipt");instant(a.receipt.completedAt);
  need(a.receipt.action===a.request.action&&a.receipt.fingerprint===checksum({action:expected.action,body:expected.body})&&a.receipt.result?.cycle===expected.body.cycle,"Original native receipt differs");
  if(expected.action==="cycle-action")need(a.receipt.result.action===expected.body.action&&a.receipt.result.revision===expected.body.expectedRevision+1&&a.receipt.result.status===expected.body.status,"Native action result differs");
  else{need(a.receipt.result.review===expected.body.id&&a.receipt.result.snapshotSha256===expected.body._merchantLearningExchange.snapshotSha256,"Native complete review result differs");need(equal(a.receipt.result.actions,expected.body.actions.map(r=>({action:r.id,revision:r.expectedRevision+1,status:r.status}))),"Complete native action result population differs");}
 }
}
export function inspectBundle(bundle){
 exactKeys(bundle,["schema","id","createdAt","packets","drafts","returns","operations","applications","sha256"],"Exchange bundle");need(bundle.schema===SCHEMAS.bundle,"Unsupported exchange bundle");id(bundle.id,"bundle ID");instant(bundle.createdAt);
 for(const key of ["packets","drafts","returns","operations","applications"])need(Array.isArray(bundle[key]),"Complete bundle population absent");
 for(const p of bundle.packets)inspectPacket(p);for(const d of bundle.drafts)inspectDraft(d);for(const r of bundle.returns)inspectReturn(r);inspectApplications(bundle);
 const {sha256,...body}=bundle;need(checksum(body)===digest(sha256),"Complete exchange bundle changed");return clone(bundle);
}
