// MIT. Complete shared-draft inventory, receiving and selective recovery.
import {listDrafts,loadDraft,saveDraft,readDraftRecords,commitDraftRecords} from './drafts.mjs';

export const MAX_ARCHIVE_BYTES=256*1024*1024;
export const MAX_RECORDS=5000;
const ARCHIVE='stellar-forge.saved-project-archive.v1';
const BODY='stellar-forge.saved-project-archive-body.v1';
const JOURNAL='stellar-forge.saved-project-receipt.v1';
const WORK='stellar-forge.saved-project-working.v1';
const PREFIX='draft-library-journal:';
const WORK_PREFIX='draft-library-working:';
const SCOPE='The original shared Stellar Forge drafts store. Separate companion-reader and Source Desk stores are outside this archive.';
const enc=new TextEncoder();
const clone=value=>structuredClone(value);
const need=(test,message)=>{if(!test)throw new Error(message);};
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const now=()=>new Date().toISOString();
const text=value=>JSON.stringify(value)+'\n';
const utf8=value=>enc.encode(value);
const cleanName=value=>(String(value||'saved-projects').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-|-$/g,'').slice(0,100)||'saved-projects');
async function sha(value){need(globalThis.crypto?.subtle,'Open this desk through HTTPS or the original loopback host.');return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?utf8(value):value)),x=>x.toString(16).padStart(2,'0')).join('');}
const key=(value,label='record ID')=>{need(typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\u0000-\u001f]/.test(value),'Use the complete original '+label+'.');return value;};
const iso=value=>{need(typeof value==='string'&&Number.isFinite(Date.parse(value)),'The original timestamp is invalid.');return value;};
const isJournal=r=>r?.id?.startsWith(PREFIX)&&r?.input?.schema===JOURNAL;
const isWork=r=>r?.id?.startsWith(WORK_PREFIX)&&r?.input?.schema===WORK;
const ordinary=r=>!isJournal(r)&&!isWork(r);
function recordShape(r){need(r&&typeof r==='object'&&!Array.isArray(r),'A complete saved record is required.');key(r.id);need(Number.isSafeInteger(r.revision)&&r.revision>=1,'The original saved revision is invalid.');need(typeof r.name==='string'&&typeof r.updatedAt==='string'&&own(r,'input'),'The complete original saved metadata and input are required.');iso(r.updatedAt);return r;}
const binaryTypes={Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,DataView};
if(typeof BigInt64Array!=='undefined')binaryTypes.BigInt64Array=BigInt64Array;
if(typeof BigUint64Array!=='undefined')binaryTypes.BigUint64Array=BigUint64Array;
function base64(bytes){let result='';for(let offset=0;offset<bytes.length;offset+=24576)result+=btoa(String.fromCharCode(...bytes.subarray(offset,offset+24576)));return result;}
function unbase64(value){need(typeof value==='string'&&value.length%4===0&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'The retained binary value is invalid.');const raw=atob(value);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
// The tagged representation preserves unfinished undefined values, exact special
// numbers, sparse arrays and managed binary values rather than JSON-normalizing them.
function pack(value){
  const nodes=[],seen=new Map();
  function visit(v,depth=0){
    need(depth<=128&&nodes.length<=4000000,'This record exceeds the complete structured-value bound.');
    if(v===null)return ['null'];if(v===undefined)return ['undefined'];
    if(typeof v==='string')return ['string',v];if(typeof v==='boolean')return ['boolean',v];
    if(typeof v==='number')return ['number',Number.isNaN(v)?'NaN':v===Infinity?'Infinity':v===-Infinity?'-Infinity':Object.is(v,-0)?'-0':String(v)];
    if(typeof v==='bigint')return ['bigint',String(v)];
    need(v&&typeof v==='object','This saved value requires its original application export.');
    if(seen.has(v))return ['ref',seen.get(v)];
    const id=nodes.length;seen.set(v,id);nodes.push(null);let node;
    if(Array.isArray(v)){
      need(Object.keys(v).every(k=>/^(0|[1-9]\d*)$/.test(k)&&Number(k)<v.length),'An array has additional properties which need its original application export.');
      const entries=[];for(let i=0;i<v.length;i++)if(own(v,i))entries.push([i,visit(v[i],depth+1)]);
      node=['array',v.length,entries];
    }else if(v instanceof Date)node=['date',Number.isNaN(v.getTime())?'invalid':v.toISOString()];
    else if(v instanceof ArrayBuffer)node=['buffer',base64(new Uint8Array(v))];
    else if(ArrayBuffer.isView(v)){const name=v.constructor.name;need(own(binaryTypes,name),'Unsupported saved binary view.');node=['view',name,visit(v.buffer,depth+1),v.byteOffset,v.byteLength];}
    else{need(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null,'This structured value requires its original application export.');need(Object.getOwnPropertySymbols(v).length===0,'Symbol properties require their original application export.');node=['object',Object.entries(v).map(([k,child])=>[k,visit(child,depth+1)])];}
    nodes[id]=node;return ['ref',id];
  }
  const root=visit(value);return ['graph',root,nodes];
}
function unpack(value){
  need(Array.isArray(value)&&value.length===3&&value[0]==='graph'&&Array.isArray(value[2])&&value[2].length<=4000000,'Invalid complete structured graph.');
  const nodes=value[2],objects=new Array(nodes.length);
  const size=(v,n)=>need(Array.isArray(v)&&v.length===n,'Invalid structured-value fields.');
  function scalar(v){
    need(Array.isArray(v),'Invalid structured value.');const t=v[0];
    if(t==='ref'){size(v,2);need(Number.isSafeInteger(v[1])&&v[1]>=0&&v[1]<objects.length&&objects[v[1]]!==undefined,'Invalid original object reference.');return objects[v[1]];}
    if(t==='null'||t==='undefined'){size(v,1);return t==='null'?null:undefined;}
    if(t==='string'||t==='boolean'){size(v,2);need(typeof v[1]===t,'Invalid original scalar.');return v[1];}
    if(t==='number'){size(v,2);need(typeof v[1]==='string','Invalid original number.');const n=v[1]==='NaN'?NaN:v[1]==='Infinity'?Infinity:v[1]==='-Infinity'?-Infinity:Number(v[1]);need(['NaN','Infinity','-Infinity','-0'].includes(v[1])||Number.isFinite(n)&&String(n)===v[1],'Invalid original number spelling.');return n;}
    need(t==='bigint','Unsupported original scalar.');size(v,2);need(typeof v[1]==='string'&&/^-?(0|[1-9]\d*)$/.test(v[1]),'Invalid original integer.');return BigInt(v[1]);
  }
  for(let i=0;i<nodes.length;i++){
    const n=nodes[i];need(Array.isArray(n),'Invalid original graph node.');
    if(n[0]==='object'){size(n,2);need(Array.isArray(n[1]),'Invalid object fields.');objects[i]={};}
    else if(n[0]==='array'){size(n,3);need(Number.isSafeInteger(n[1])&&n[1]>=0&&n[1]<=4000000&&Array.isArray(n[2]),'Invalid original array.');objects[i]=new Array(n[1]);}
    else if(n[0]==='date'){size(n,2);const d=n[1]==='invalid'?new Date(NaN):new Date(n[1]);need(n[1]==='invalid'||Number.isFinite(d.getTime())&&d.toISOString()===n[1],'Invalid original date.');objects[i]=d;}
    else if(n[0]==='buffer'){size(n,2);objects[i]=unbase64(n[1]).buffer;}
    else need(n[0]==='view','Unsupported original graph node.');
  }
  for(let i=0;i<nodes.length;i++)if(nodes[i][0]==='view'){
    const n=nodes[i];size(n,5);need(own(binaryTypes,n[1]),'Unsupported saved binary view.');const buffer=scalar(n[2]);need(buffer instanceof ArrayBuffer&&Number.isSafeInteger(n[3])&&Number.isSafeInteger(n[4])&&n[3]>=0&&n[4]>=0&&n[3]+n[4]<=buffer.byteLength,'Invalid original binary bounds.');
    try{const Constructor=binaryTypes[n[1]];objects[i]=n[1]==='DataView'?new DataView(buffer,n[3],n[4]):new Constructor(buffer,n[3],n[4]/Constructor.BYTES_PER_ELEMENT);need(objects[i].byteLength===n[4],'Invalid original binary length.');}catch{throw new Error('Invalid saved binary view alignment.');}
  }
  for(let i=0;i<nodes.length;i++){
    const n=nodes[i],used=new Set();
    if(n[0]==='object')for(const entry of n[1]){size(entry,2);need(typeof entry[0]==='string'&&!used.has(entry[0]),'Duplicate original object field.');used.add(entry[0]);Object.defineProperty(objects[i],entry[0],{value:scalar(entry[1]),enumerable:true,writable:true,configurable:true});}
    if(n[0]==='array')for(const entry of n[2]){size(entry,2);need(Number.isSafeInteger(entry[0])&&entry[0]>=0&&entry[0]<n[1]&&!used.has(entry[0]),'Invalid original array index.');used.add(entry[0]);objects[i][entry[0]]=scalar(entry[1]);}
  }
  return scalar(value[1]);
}
async function pin(record){recordShape(record);const value=pack(record),raw=JSON.stringify(value),bytes=utf8(raw).length;need(bytes<=MAX_ARCHIVE_BYTES,'One saved record exceeds the complete archive limit.');return {id:record.id,bytes,sha256:await sha(raw),value};}
async function unpin(row){need(row&&typeof row==='object'&&typeof row.sha256==='string'&&/^[a-f0-9]{64}$/.test(row.sha256),'The original record digest is absent.');const raw=JSON.stringify(row.value);need(utf8(raw).length===row.bytes&&await sha(raw)===row.sha256,'A complete original saved record changed.');const r=recordShape(unpack(row.value));need(r.id===row.id,'The original record identity changed.');return r;}
function typeOf(r){
  const s=r.input?.schema;
  if(s==='stellar-forge.grant-submission-draft.v1')return ['submission','SCF submission',{label:'Open submission',href:'./grant-submission.html?draft='+encodeURIComponent(r.id)}];
  if(s==='stellar-forge.grant-review-round.v1')return ['review','Submission review',{label:'Open recorded review',href:'./grant-review-round.html?review='+encodeURIComponent(r.id)}];
  if(s==='stellar-forge.grant-review-working-copy.v1')return ['review-working','Review working copy',{label:'Open independent working copy',href:'./grant-review-round.html?working='+encodeURIComponent(r.id)}];
  if(r.id.startsWith('cocart-'))return ['cocart','CoCart setup',{label:'Open CoCart setup',href:'./cocart.html?draft='+encodeURIComponent(r.id)}];
  if(Array.isArray(r.input?.resources)&&typeof r.input?.folder==='string'&&!String(s||'').startsWith('stellar-forge.grant-'))return ['merchant','Merchant setup',{label:'Open merchant setup',href:'./index.html?draft='+encodeURIComponent(r.id)+'#merchant-setup'}];
  return ['other','Other retained project',null];
}
async function summary(r,p=null){p=p||await pin(r);const [kind,kindLabel,workflow]=typeOf(r);return {id:r.id,revision:r.revision,name:r.name,updatedAt:r.updatedAt,kind,kindLabel,bytes:p.bytes,sha256:p.sha256,workflow};}
function receiptSummary(r){const v=r.input.receipt;return {id:r.id,requestId:v.requestId,kind:v.kind,at:v.at,label:v.label,archiveId:v.archiveId??null,records:(v.restored?.length||0)+(v.replaced?.length||0)+(v.kept?.length||0)+(v.removed?.length||0)};}
function workSummary(r){return {id:r.id,revision:r.revision,name:r.name,updatedAt:r.updatedAt};}
function sorted(rows){return [...rows].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));}
export async function readLibrary(){
  const rows=await readDraftRecords();
  return {scope:SCOPE,records:await Promise.all(sorted(rows.filter(ordinary)).map(r=>summary(r))),receipts:sorted(rows.filter(isJournal)).map(receiptSummary),working:sorted(rows.filter(isWork)).map(workSummary)};
}
async function download(value,filename){const raw=typeof value==='string'?value:text(value),bytes=utf8(raw).length;need(bytes<=MAX_ARCHIVE_BYTES,'The complete selected download exceeds 256 MiB; choose fewer projects without changing their contents.');return {text:raw,filename,bytes,sha256:await sha(raw)};}
function archiveShape(body){need(body?.schema===BODY&&typeof body.label==='string'&&typeof body.scope==='string','Unsupported complete saved-project archive.');iso(body.createdAt);for(const name of ['projects','history','working'])need(Array.isArray(body[name]),'The complete '+name+' inventory is absent.');const rows=[...body.projects,...body.history,...body.working];need(rows.length>0&&rows.length<=MAX_RECORDS&&new Set(rows.map(r=>r.id)).size===rows.length,'The complete inventory exceeds its limit or repeats an ID.');return rows;}
async function archiveView(raw){
  need(typeof raw==='string'&&utf8(raw).length<=MAX_ARCHIVE_BYTES,'Choose a complete saved-project archive within 256 MiB.');
  let env;try{env=JSON.parse(raw);}catch{throw new Error('The retained original file is not complete JSON. Its raw text can still be saved or downloaded.');}
  need(env?.schema===ARCHIVE&&typeof env.sha256==='string','Unsupported saved-project archive.');
  archiveShape(env.body);const bodyHash=await sha(JSON.stringify(env.body));
  need(bodyHash===env.sha256&&env.id==='saved-projects-'+bodyHash,'The complete archive identity does not match its original content.');
  const groups={};
  for(const name of ['projects','history','working']){groups[name]=[];for(const row of env.body[name]){const r=await unpin(row);need(name==='projects'?ordinary(r):name==='history'?isJournal(r):isWork(r),'A retained record is in the wrong archive group.');groups[name].push(r);}}
  return {id:env.id,label:env.body.label,createdAt:env.body.createdAt,records:await Promise.all(groups.projects.map((r,i)=>summary(r,env.body.projects[i]))),history:groups.history.map(receiptSummary),working:groups.working.map(workSummary),sha256:await sha(raw),bytes:utf8(raw).length,_text:raw};
}
export async function exportProjects({ids,label='Saved Stellar Forge projects',includeHistory=true,includeWorking=true}={}){
  need(Array.isArray(ids)&&new Set(ids).size===ids.length,'Select distinct complete saved projects.');
  need(typeof includeHistory==='boolean'&&typeof includeWorking==='boolean','Choose explicit complete history and working-copy options.');
  const rows=await readDraftRecords(),byId=new Map(rows.map(r=>[r.id,r]));
  const selected=ids.map(id=>{key(id);const row=byId.get(id);need(row&&ordinary(row),'A selected project changed or is no longer available. Refresh the original inventory.');return row;});
  const histories=includeHistory?rows.filter(isJournal):[],working=includeWorking?rows.filter(isWork):[];
  const count=selected.length+histories.length+working.length;need(count>0&&count<=MAX_RECORDS,'Choose 1–5,000 complete project, history and working records for this archive.');
  const body={schema:BODY,label:String(label),createdAt:now(),scope:SCOPE,projects:await Promise.all(selected.map(pin)),history:await Promise.all(histories.map(pin)),working:await Promise.all(working.map(pin))};
  const digest=await sha(JSON.stringify(body)),id='saved-projects-'+digest;
  const file=await download({schema:ARCHIVE,id,sha256:digest,body},cleanName(label)+'.saved-projects.json');
  return {...file,archiveId:id,summary:{label:body.label,createdAt:body.createdAt,records:body.projects.length,receipts:body.history.length,working:body.working.length}};
}
export const openArchive=archiveView;
async function selectedArchive(value){need(value&&typeof value._text==='string','Use the complete verified original archive.');const checked=await archiveView(value._text);need(value.id===checked.id&&value.sha256===checked.sha256,'The selected archive changed.');return checked;}
async function reviewHash(value){const copy=clone(value);delete copy.reviewSha256;return sha(JSON.stringify(copy));}
async function validateReview(review,kind){need(review?.kind===kind&&await reviewHash(review)===review.reviewSha256,'The retained original comparison changed. Prepare an explicit new comparison.');return review;}
export async function reviewReceiving(archive){
  const a=await selectedArchive(archive),body=JSON.parse(a._text).body,current=new Map((await readDraftRecords()).map(r=>[r.id,r])),rows=[],expected=[];
  for(let i=0;i<body.projects.length;i++){
    const original=body.projects[i],existing=current.get(original.id)||null,p=existing?await pin(existing):null;
    need(!existing||ordinary(existing),'An existing library journal reserves this project identity.');
    const status=!existing?'NEW':p.sha256===original.sha256?'IDENTICAL':'CONFLICT';
    rows.push({id:original.id,incoming:a.records[i],current:existing?await summary(existing,p):null,status,defaultChoice:status==='NEW'?'restore':'keep',allowed:status==='NEW'?['restore','keep']:status==='CONFLICT'?['replace','keep']:['keep']});
    expected.push({id:original.id,record:p});
  }
  const review={kind:'receive',archiveId:a.id,archiveSha256:a.sha256,rows,_expected:expected};
  review.reviewSha256=await reviewHash(review);return review;
}
function requestId(value){key(value,'receiving request ID');need(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value),'Use a stable original receiving request ID.');return value;}
async function currentFor(ids){const map=new Map((await readDraftRecords()).map(r=>[r.id,r]));return Promise.all(ids.map(id=>map.has(id)?summary(map.get(id)):Promise.resolve({id,absent:true})));}
function storedReceiptShape(r){need(isJournal(r)&&r.input.receipt?.id===r.id,'The original receiving receipt is absent or inconsistent.');return r.input;}
async function completed(id,requestHash){
  const row=await loadDraft(id);if(!row)return null;const value=storedReceiptShape(row);
  need(value.requestHash===requestHash,'This original receiving request already selected different input or decisions.');
  return {receipt:clone(value.receipt),replayed:true,current:await currentFor(value.projectIds)};
}
function newRecord(id,input,at,revision=1){return {id,revision,name:String(input.folder||'Saved project'),resources:Array.isArray(input.resources)?input.resources.length:0,updatedAt:at,input:clone(input)};}
function journalRecord(id,input,at){return newRecord(id,input,at);}
export async function commitReceiving({archive,review,choices,requestId:rid,label='Received saved projects'}){
  rid=requestId(rid);const a=await selectedArchive(archive);await validateReview(review,'receive');
  need(review.archiveId===a.id&&review.archiveSha256===a.sha256,'The comparison belongs to another original archive.');
  need(choices&&typeof choices==='object'&&!Array.isArray(choices)&&Object.keys(choices).length===review.rows.length,'Retain one explicit choice for every incoming project.');
  for(const row of review.rows)need(own(choices,row.id)&&row.allowed.includes(choices[row.id]),'Choose a supported receiving action for '+row.incoming.name+'.');
  const request={kind:'receive',requestId:rid,archiveId:a.id,archiveSha256:a.sha256,reviewSha256:review.reviewSha256,choices:clone(choices),label:String(label)};
  const requestHash=await sha(JSON.stringify(request)),id=PREFIX+rid;
  const replay=await completed(id,requestHash);if(replay)return replay;
  const body=JSON.parse(a._text).body,incoming=new Map(body.projects.map(r=>[r.id,r])),before=[],after=[],expected=[],puts=[],at=now();
  const receipt={id,requestId:rid,kind:'receive',at,label:String(label),archiveId:a.id,archiveSha256:a.sha256,restored:[],replaced:[],kept:[]};
  for(const row of review.rows){
    const old=review._expected.find(x=>x.id===row.id);need(old,'The original comparison inventory is incomplete.');
    const original=old.record?await unpin(old.record):null;expected.push({id:row.id,record:original});
    const choice=choices[row.id];if(choice==='keep'){receipt.kept.push({id:row.id});continue;}
    const selected=await unpin(incoming.get(row.id));before.push({id:row.id,record:old.record});
    const next=choice==='restore'?selected:{...selected,revision:original.revision+1,updatedAt:at};
    puts.push(next);after.push({id:row.id,record:await pin(next)});
    receipt[choice==='restore'?'restored':'replaced'].push({id:row.id,revision:next.revision});
  }
  const value={schema:JOURNAL,folder:'Saved-project receiving — '+String(label),requestHash,request,receipt,projectIds:review.rows.map(r=>r.id),archiveText:a._text,before,after};
  const outcome=await commitDraftRecords({receiptId:id,requestHash,expected,puts,removals:[],receiptRecord:journalRecord(id,value,at)});
  return {receipt:clone(outcome.record.input.receipt),replayed:outcome.replayed,current:await currentFor(value.projectIds)};
}
export async function readReceipt(id){
  key(id);const row=await loadDraft(id),value=storedReceiptShape(row);
  let passive={history:[],working:[]};if(value.archiveText){const a=await archiveView(value.archiveText);passive={history:a.history,working:a.working};}
  return {receipt:clone(value.receipt),current:await currentFor(value.projectIds),passive};
}
export async function exportReceipt(id){const row=await loadDraft(key(id));storedReceiptShape(row);return download({schema:'stellar-forge.saved-project-receipt-export.v1',record:await pin(row)},cleanName(row.name)+'.receipt.json');}
export async function reviewUndo(receiptId){
  const saved=await loadDraft(key(receiptId)),value=storedReceiptShape(saved);
  need(value.receipt.kind==='receive','Select an original receiving receipt for selective restoration.');
  const originals=new Map(value.before.map(x=>[x.id,x.record])),current=new Map((await readDraftRecords()).map(r=>[r.id,r])),rows=[],expected=[];
  for(const applied of value.after){
    const oldPin=originals.get(applied.id)||null,old=oldPin?await unpin(oldPin):null;
    const received=await unpin(applied.record),actual=current.get(applied.id)||null,actualPin=actual?await pin(actual):null;
    const status=!actual?'ABSENT':actualPin.sha256===applied.record.sha256?'UNCHANGED':'STAFF_CHANGED';
    rows.push({id:applied.id,status,canRestore:status==='UNCHANGED',before:old?await summary(old,oldPin):null,current:actual?await summary(actual,actualPin):null,after:await summary(received,applied.record)});
    expected.push({id:applied.id,record:actualPin,before:oldPin,accepted:applied.record});
  }
  const review={kind:'undo',receiptId,receiptSha256:(await pin(saved)).sha256,rows,_expected:expected};review.reviewSha256=await reviewHash(review);return review;
}
export async function commitUndo({review,ids,requestId:rid,label='Selective restoration'}){
  rid=requestId(rid);await validateReview(review,'undo');need(Array.isArray(ids)&&new Set(ids).size===ids.length,'Select distinct original received projects to restore.');
  const known=new Map(review.rows.map(r=>[r.id,r]));for(const id of ids)need(known.has(id),'The selected restoration is not in this original receipt.');
  const request={kind:'undo',requestId:rid,receiptId:review.receiptId,reviewSha256:review.reviewSha256,ids:[...ids],label:String(label)};
  const requestHash=await sha(JSON.stringify(request)),id=PREFIX+rid,replay=await completed(id,requestHash);if(replay)return replay;
  const original=await loadDraft(review.receiptId);storedReceiptShape(original);need((await pin(original)).sha256===review.receiptSha256,'The original receiving receipt changed.');
  const puts=[],removals=[],expected=[{id:original.id,record:original}],before=[],after=[],at=now();
  const receipt={id,requestId:rid,kind:'undo',at,label:String(label),archiveId:original.input.receipt.archiveId,originalReceiptId:original.id,restored:[],replaced:[],kept:[],removed:[],skipped:[]};
  for(const row of review.rows){
    const e=review._expected.find(x=>x.id===row.id);need(e,'The retained restoration comparison is incomplete.');
    if(!ids.includes(row.id)||!row.canRestore){receipt.skipped.push({id:row.id,reason:!row.canRestore?row.status:'NOT_SELECTED'});continue;}
    need(e.record&&e.accepted.sha256===e.record.sha256,'Only unchanged received values can be restored.');
    const actual=await unpin(e.record);expected.push({id:row.id,record:actual});before.push({id:row.id,record:e.record});
    if(e.before){const previous=await unpin(e.before),next={...previous,revision:actual.revision+1,updatedAt:at};puts.push(next);after.push({id:row.id,record:await pin(next)});receipt.restored.push({id:row.id,revision:next.revision});}
    else{removals.push(row.id);after.push({id:row.id,record:null});receipt.removed.push({id:row.id});}
  }
  const value={schema:JOURNAL,folder:'Saved-project restoration — '+String(label),requestHash,request,receipt,projectIds:review.rows.map(r=>r.id),archiveText:null,before,after,originalReceipt:await pin(original)};
  const outcome=await commitDraftRecords({receiptId:id,requestHash,expected,puts,removals,receiptRecord:journalRecord(id,value,at)});
  return {receipt:clone(outcome.record.input.receipt),replayed:outcome.replayed,current:await currentFor(value.projectIds)};
}
export async function saveWorking({id=null,revision=0,value}){
  need(value&&typeof value==='object'&&!Array.isArray(value),'Retain the complete unfinished desk input.');
  const raw=JSON.stringify(pack(value));need(utf8(raw).length<=MAX_ARCHIVE_BYTES*2+1048576,'This complete working copy exceeds the local retention limit. Keep its original file and export the decisions.');
  const selected=id===null?WORK_PREFIX+crypto.randomUUID():key(id);need(selected.startsWith(WORK_PREFIX),'Choose a saved library working copy.');
  const label=String(value.label||value.filename||'Unfinished receiving').slice(0,1000);
  const result=await saveDraft({id:selected,revision,input:{schema:WORK,folder:'Saved-project work — '+label,value:clone(value)}});
  return workSummary(result);
}
export async function loadWorking(id){const r=await loadDraft(key(id));need(isWork(r),'The complete unfinished library copy is absent.');return {id:r.id,revision:r.revision,value:clone(r.input.value)};}
export async function recoverWorking(receiptId,sourceWorkingId){
  const r=await loadDraft(key(receiptId)),value=storedReceiptShape(r);need(value.archiveText,'This receipt has no incoming working copies.');
  const a=await archiveView(value.archiveText),body=JSON.parse(a._text).body,selected=body.working.find(x=>x.id===sourceWorkingId);need(selected,'The exact passive working copy is absent.');
  const original=await unpin(selected);need(isWork(original),'The retained working copy has the wrong source kind.');
  const recovered=clone(original.input.value);
  // Preserve every original field in provenance; target-bound requests remain
  // passive and cannot become a request against this recipient's current store.
  recovered.importedWorkingOriginal={schema:'stellar-forge.passive-working-source.v1',record:clone(selected),receiptId};
  recovered.review=null;recovered.requestId=null;recovered.pending=null;recovered.completedReceipt=null;
  recovered.needsComparison=true;recovered.mode='receive';recovered.receiptId=null;recovered.undoReview=null;recovered.undoIds=[];
  recovered.label=String(recovered.label||original.name)+' — received copy';
  const saved=await saveWorking({id:null,revision:0,value:recovered});
  return loadWorking(saved.id);
}
export async function downloadProject(id){
  const row=await loadDraft(key(id));need(row&&ordinary(row),'The complete selected project is absent.');
  return download({schema:'stellar-forge.saved-project-record.v1',record:await pin(row)},cleanName(row.name)+'.saved-record.json');
}
