// MIT. Complete colleague source review over the original Flowable source drafts.
import {validateProgrammeDraft,programmeUtf8,programmeSourceSha256} from './programme-authoring.mjs';

export const PROGRAMME_SOURCE_REVIEW_SCHEMA='stellar-forge.flowable-programme-source-review.v1';
export const PROGRAMME_SOURCE_REVIEW_WORK_SCHEMA='stellar-forge.flowable-programme-source-review-work.v1';
export const PROGRAMME_SOURCE_REVIEW_LIMIT=64*1024*1024;
export const PROGRAMME_SOURCE_REVIEW_CHOICES=Object.freeze(['KEEP_CURRENT','TAKE_RETURNED','USE_BASELINE']);
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const clone=v=>JSON.parse(JSON.stringify(v));
const need=(v,message)=>{if(!v)throw new Error(message);};
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
function fields(v,keys,label){need(plain(v),label+' must be an object.');for(const k of Object.keys(v))need(keys.includes(k),'Unknown '+label+' field: '+k);}
function text(v,n,label){need(typeof v==='string'&&v.length<=n&&!v.includes('\u0000'),label+' must be complete text within its limit.');}
function named(v,n,label){text(v,n,label);need(v.trim().length>0,label+' is required.');}
function stamp(v){need(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v)&&Number.isFinite(Date.parse(v)),'Use a complete UTC issue/review timestamp.');}
function canonical(v){
 if(v===null||typeof v!=='object')return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
}
const same=(a,b)=>canonical(a)===canonical(b);
function bounded(v,label){need(programmeUtf8(JSON.stringify(v)).length+1<=PROGRAMME_SOURCE_REVIEW_LIMIT,label+' exceeds the complete 64 MiB exchange limit. Retain the existing edition and issue a separately identified continuation.');}
function hasher(opts={}){const h=opts.hash??programmeSourceSha256;need(typeof h==='function','Use the original complete-byte hash function.');return async value=>{const d=await h(programmeUtf8(typeof value==='string'?value:canonical(value)));need(digest(d),'The complete source hash is invalid.');return d;};}
function meta(v,kind){
 const keys=kind==='issue'?['id','at','label','issuer','recipient','note']:['id','at','reviewer','note'];
 fields(v,keys,kind);need(id(v.id),'Use a distinct '+kind+' identity.');stamp(v.at);
 if(kind==='issue'){named(v.label,300,'Issue label');named(v.issuer,200,'Issuer');named(v.recipient,200,'Recipient');}
 else named(v.reviewer,200,'Recorded reviewer');
 text(v.note??'',65536,'Review note');
 return {...v,note:v.note??''};
}
function choicesShape(v){need(plain(v),'Keep explicit row choices as an object.');for(const[k,x]of Object.entries(v)){text(k,2100,'Row key');need(PROGRAMME_SOURCE_REVIEW_CHOICES.includes(x),'Use an explicit source-review choice.');}return clone(v);}
function shape(value){
 fields(value,['schema','issue','blobs','snapshots','returns','adoptions','selectedReturnId'],'source exchange');
 need(value.schema===PROGRAMME_SOURCE_REVIEW_SCHEMA,'Select a complete Flowable source-review exchange.');
 fields(value.issue,['id','at','label','issuer','recipient','note','authorDraftId','baselineSha256'],'issued baseline');
 const i=value.issue;meta({id:i.id,at:i.at,label:i.label,issuer:i.issuer,recipient:i.recipient,note:i.note},'issue');
 need(id(i.authorDraftId)&&digest(i.baselineSha256),'Retain the original issuing draft and complete baseline identity.');
 need(Array.isArray(value.blobs)&&value.blobs.length<=8192,'Retain the complete bounded source pool.');
 need(Array.isArray(value.snapshots)&&value.snapshots.length>0&&value.snapshots.length<=256,'Retain complete draft snapshots.');
 need(Array.isArray(value.returns)&&value.returns.length<=128&&Array.isArray(value.adoptions)&&value.adoptions.length<=128,'Retain the complete bounded return and adoption history.');
 for(const b of value.blobs){fields(b,['sha256','mediaType','text'],'source body');need(digest(b.sha256),'Retain the full source-body digest.');text(b.mediaType,200,'Media type');need(typeof b.text==='string'&&b.text.length<=16*1024*1024,'Retain complete original source text.');}
 for(const s of value.snapshots){fields(s,['sha256','draft'],'source snapshot');need(digest(s.sha256)&&plain(s.draft)&&Array.isArray(s.draft.files),'Retain the complete source snapshot and digest.');for(const f of s.draft.files){fields(f,['path','sourceSha256'],'source reference');need(digest(f.sourceSha256),'Retain the complete referenced source body.');}}
 for(const r of value.returns){fields(r,['id','at','reviewer','note','localDraftId','issueSha256','snapshotSha256'],'returned proposal');meta({id:r.id,at:r.at,reviewer:r.reviewer,note:r.note},'return');need(id(r.localDraftId)&&digest(r.issueSha256)&&digest(r.snapshotSha256),'Retain the original return context.');}
 for(const a of value.adoptions){
  fields(a,['id','at','reviewer','note','issueSha256','returnId','returnRecordSha256','incomingPacket','basisSha256','currentSha256','returnedSha256','resultSha256','choices'],'source adoption');
  meta({id:a.id,at:a.at,reviewer:a.reviewer,note:a.note},'adoption');
  need(id(a.returnId)&&['issueSha256','returnRecordSha256','basisSha256','currentSha256','returnedSha256','resultSha256'].every(k=>digest(a[k])),'Retain every original adoption branch and basis.');
  fields(a.incomingPacket,['bytes','sha256'],'received packet identity');need(Number.isSafeInteger(a.incomingPacket.bytes)&&a.incomingPacket.bytes>=0&&a.incomingPacket.bytes<=PROGRAMME_SOURCE_REVIEW_LIMIT&&digest(a.incomingPacket.sha256),'Retain the full observed incoming packet identity.');
  choicesShape(a.choices);
 }
 need(value.selectedReturnId===null||id(value.selectedReturnId),'Select an actual retained return or null.');
 bounded(value,'The complete source exchange');return clone(value);
}
function index(rows,key,label){const out=new Map();for(const row of rows){need(!out.has(row[key]),'Duplicate '+label+' identity.');out.set(row[key],row);}return out;}
function inflate(exchange,sha256){
 const snapshots=index(exchange.snapshots,'sha256','snapshot'),blobs=index(exchange.blobs,'sha256','source body'),snapshot=snapshots.get(sha256);need(snapshot,'The selected full draft snapshot is absent.');
 const draft=clone(snapshot.draft);draft.files=draft.files.map(f=>{const b=blobs.get(f.sourceSha256);need(b,'A complete original source body is missing.');return{path:f.path,mediaType:b.mediaType,text:b.text};});
 return validateProgrammeDraft(draft);
}
async function retainDraft(exchange,draft,hash){
 const selected=validateProgrammeDraft(draft),existing=index(exchange.blobs,'sha256','source body'),snapshot=clone(selected);snapshot.files=[];
 for(const f of selected.files){
  const body={mediaType:f.mediaType,text:f.text},sha256=await hash(body),old=existing.get(sha256);
  if(old)need(same({mediaType:old.mediaType,text:old.text},body),'The same source digest has different complete content.');
  else{const item={sha256,...body};exchange.blobs.push(item);existing.set(sha256,item);}
  snapshot.files.push({path:f.path,sourceSha256:sha256});
 }
 const sha256=await hash(snapshot),old=exchange.snapshots.find(s=>s.sha256===sha256);
 if(old)need(same(old.draft,snapshot),'The same draft digest has different complete content.');
 else exchange.snapshots.push({sha256,draft:snapshot});
 return sha256;
}
function options(draft){const {schema,id,files,...value}=draft;return value;}
function change(base,current,returned){
 if(same(base,current)&&same(base,returned))return'UNCHANGED';
 if(same(current,returned))return'SAME_CHANGE';
 if(same(base,current))return'RETURNED_CHANGED';
 if(same(base,returned))return'CURRENT_CHANGED';
 return'CONFLICT';
}
function rowsFor(baseline,current,returned){
 const all=[baseline,current,returned].map(d=>new Map(d.files.map(f=>[f.path,{mediaType:f.mediaType,text:f.text}])));
 const paths=[...new Set(all.flatMap(m=>[...m.keys()]))].sort();
 const rows=paths.map(path=>{const [b,c,r]=all.map(m=>m.get(path)??null),status=change(b,c,r);return{key:JSON.stringify(['source',path]),kind:'source',path,label:path,baseline:b,current:c,returned:r,status,changed:status!=='UNCHANGED'};});
 const b=options(baseline),c=options(current),r=options(returned),status=change(b,c,r);
 rows.push({key:'options',kind:'options',label:'Programme title, family, catalogue, operation, roles and input selections',baseline:b,current:c,returned:r,status,changed:status!=='UNCHANGED'});
 return rows;
}
function resolve(baseline,current,returned,choices){
 const rows=rowsFor(baseline,current,returned),known=new Set(rows.map(r=>r.key));choicesShape(choices);
 for(const k of Object.keys(choices))need(known.has(k),'A saved choice names a row outside this exact comparison.');
 const selected=new Map();let selectedOptions;
 for(const row of rows){
  let choice=choices[row.key];if(!row.changed)choice=choice??'KEEP_CURRENT';else need(choice,'Choose every changed source and options row explicitly: '+row.label);
  const value=choice==='KEEP_CURRENT'?row.current:choice==='TAKE_RETURNED'?row.returned:row.baseline;
  if(row.kind==='options')selectedOptions=clone(value);else if(value!==null)selected.set(row.path,clone(value));
 }
 // File ordering follows the author's selected paths, then the returned/baseline
 // inventory for additions. Only explicit row choices select source contents.
 const ordered=[...new Set([...current.files,...returned.files,...baseline.files].map(f=>f.path))].filter(p=>selected.has(p));
 return validateProgrammeDraft({schema:current.schema,id:current.id,...selectedOptions,files:ordered.map(path=>({path,...selected.get(path)}))});
}
async function basisFor(issueSha256,currentSha256,returnRecordSha256,incomingPacket,adoptions,hash){
 return hash({issueSha256,currentSha256,returnRecordSha256,incomingPacket,historySha256:await hash(adoptions)});
}
async function validateExchange(value,opts={}){
 const e=shape(value),hash=hasher(opts),blobs=index(e.blobs,'sha256','source body'),snaps=index(e.snapshots,'sha256','snapshot'),returns=index(e.returns,'id','return'),adoptions=index(e.adoptions,'id','adoption');
 for(const b of blobs.values())need(await hash({mediaType:b.mediaType,text:b.text})===b.sha256,'A retained source body differs from its full digest.');
 for(const s of snaps.values()){need(await hash(s.draft)===s.sha256,'A retained draft snapshot differs from its full digest.');const draft=inflate(e,s.sha256);need(draft.id===e.issue.authorDraftId,'Keep the issuing draft identity in every exchange snapshot.');}
 const baseline=inflate(e,e.issue.baselineSha256),issueSha256=await hash(e.issue);need(baseline.id===e.issue.authorDraftId,'The complete baseline belongs to a different issuing draft.');
 if(e.selectedReturnId!==null)need(returns.has(e.selectedReturnId),'The selected returned proposal is missing.');
 for(const r of returns.values()){need(r.issueSha256===issueSha256&&snaps.has(r.snapshotSha256),'A returned proposal belongs to another issue or missing source.');}
 const preceding=[];
 for(const a of adoptions.values()){
  const r=returns.get(a.returnId);need(r&&a.issueSha256===issueSha256&&a.returnRecordSha256===await hash(r)&&a.returnedSha256===r.snapshotSha256,'The recorded adoption differs from its original returned proposal.');
  need(a.basisSha256===await basisFor(issueSha256,a.currentSha256,a.returnRecordSha256,a.incomingPacket,preceding,hash),'The recorded adoption basis or history is inconsistent.');
  const current=inflate(e,a.currentSha256),returned=inflate(e,a.returnedSha256),result=inflate(e,a.resultSha256);
  need(same(resolve(baseline,current,returned,a.choices),result),'The accepted result differs from its explicit original row choices.');
  preceding.push(a);
 }
 return e;
}
export function createProgrammeSourceReviewWork(){
 return{schema:PROGRAMME_SOURCE_REVIEW_WORK_SCHEMA,mode:'author',exchangeText:'',incomingText:'',
  issue:{label:'',issuer:'',recipient:'',note:''},review:{reviewer:'',note:''},adoption:{reviewer:'',note:''},basisSha256:'',choices:{},selectedRow:'',selectedReturnId:''};
}
export function validateProgrammeSourceReviewWork(value){
 fields(value,['schema','mode','exchangeText','incomingText','issue','review','adoption','basisSha256','choices','selectedRow','selectedReturnId'],'source-review working copy');
 need(value.schema===PROGRAMME_SOURCE_REVIEW_WORK_SCHEMA&&['author','reviewer'].includes(value.mode),'Use the existing source-review working schema.');
 for(const k of ['exchangeText','incomingText'])need(typeof value[k]==='string'&&value[k].length<=PROGRAMME_SOURCE_REVIEW_LIMIT,'Keep complete unfinished exchange text within its bound.');
 fields(value.issue,['label','issuer','recipient','note'],'working issue');
 for(const k of ['label','issuer','recipient'])text(value.issue[k],10000,'Unfinished issue '+k);text(value.issue.note,65536,'Unfinished issue note');
 for(const k of ['review','adoption']){fields(value[k],['reviewer','note'],'working '+k);text(value[k].reviewer,10000,'Unfinished reviewer');text(value[k].note,65536,'Unfinished note');}
 need(value.basisSha256===''||digest(value.basisSha256),'Keep the exact selected comparison basis or an empty unfinished value.');choicesShape(value.choices);text(value.selectedRow,2100,'Selected row');need(value.selectedReturnId===''||id(value.selectedReturnId),'Select a retained return identity or an empty unfinished value.');
 bounded(value,'The complete source-review working copy');return clone(value);
}
export async function parseProgrammeSourceExchange(textValue,opts={}){
 need(typeof textValue==='string'&&programmeUtf8(textValue).length<=PROGRAMME_SOURCE_REVIEW_LIMIT,'Receive the complete source exchange within 64 MiB.');
 return validateExchange(JSON.parse(textValue),opts);
}
export async function serializeProgrammeSourceExchange(exchange,opts={}){
 const value=await validateExchange(exchange,opts),out=JSON.stringify(value)+'\n';need(programmeUtf8(out).length<=PROGRAMME_SOURCE_REVIEW_LIMIT,'The complete exchange export exceeds its bound.');return out;
}
export async function createProgrammeSourceIssue(draft,selection,opts={}){
 const details=meta(selection,'issue'),selected=validateProgrammeDraft(draft),hash=hasher(opts);
 const exchange={schema:PROGRAMME_SOURCE_REVIEW_SCHEMA,issue:null,blobs:[],snapshots:[],returns:[],adoptions:[],selectedReturnId:null};
 const baselineSha256=await retainDraft(exchange,selected,hash);
 exchange.issue={...details,authorDraftId:selected.id,baselineSha256};bounded(exchange,'The complete issued source');
 return{exchange:await validateExchange(exchange,opts),issue:clone(exchange.issue)};
}
export async function programmeSourceReviewDraft(exchange,{returnId}={},opts={}){
 const e=await validateExchange(exchange,opts);
 if(returnId===undefined)return inflate(e,e.issue.baselineSha256);
 const r=e.returns.find(r=>r.id===returnId);need(r,'Select an actual full returned proposal.');return inflate(e,r.snapshotSha256);
}
export async function createProgrammeSourceReturn(exchange,reviewerDraft,selection,opts={}){
 const e=await validateExchange(exchange,opts),details=meta(selection,'return'),selected=validateProgrammeDraft(reviewerDraft),localDraftId=selected.id,hash=hasher(opts);
 selected.id=e.issue.authorDraftId;const snapshotSha256=await retainDraft(e,selected,hash);
 const record={...details,localDraftId,issueSha256:await hash(e.issue),snapshotSha256},existing=e.returns.find(r=>r.id===record.id);
 if(existing)need(same(existing,record),'This return identity already names different original source or attribution.');else e.returns.push(record);
 e.selectedReturnId=record.id;bounded(e,'The complete returned source');
 return{exchange:await validateExchange(e,opts),returnRecord:clone(record)};
}
function mergeRows(target,incoming,key,label){const map=index(target,key,label);for(const value of incoming){const old=map.get(value[key]);if(old)need(same(old,value),'A retained '+label+' identity has conflicting complete content.');else{target.push(clone(value));map.set(value[key],value);}}}
function mergeIncoming(local,incoming){
 need(same(local.issue,incoming.issue),'The returned source does not match the original locally issued baseline and attribution.');
 need(incoming.adoptions.length<=local.adoptions.length&&incoming.adoptions.every((a,i)=>same(a,local.adoptions[i])),'A returned colleague packet cannot replace the author adoption history.');
 const e=clone(local);mergeRows(e.blobs,incoming.blobs,'sha256','source');mergeRows(e.snapshots,incoming.snapshots,'sha256','snapshot');mergeRows(e.returns,incoming.returns,'id','return');return e;
}
export async function compareProgrammeSourceReturn(authorDraft,localExchange,returnedText,opts={}){
 const current=validateProgrammeDraft(authorDraft),local=await validateExchange(localExchange,opts),incoming=await parseProgrammeSourceExchange(returnedText,opts),hash=hasher(opts);
 current.id=local.issue.authorDraftId; // Browser copies have independent CAS identities; exchange branches retain issuing identity.
 const exchange=mergeIncoming(local,incoming),returnId=opts.returnId??incoming.selectedReturnId??(incoming.returns.length===1?incoming.returns[0].id:null);
 need(returnId,'Select the exact returned proposal from the complete exchange.');
 const record=incoming.returns.find(r=>r.id===returnId);need(record,'The selected proposal is not part of the received exchange.');
 const currentSha256=await retainDraft(exchange,current,hash),baseline=inflate(exchange,exchange.issue.baselineSha256),returned=inflate(exchange,record.snapshotSha256);
 const incomingPacket={bytes:programmeUtf8(returnedText).length,sha256:await hash(returnedText)},issueSha256=await hash(exchange.issue),returnRecordSha256=await hash(record);
 const basisSha256=await basisFor(issueSha256,currentSha256,returnRecordSha256,incomingPacket,local.adoptions,hash);
 bounded(exchange,'The complete compared source');
 return{issue:clone(exchange.issue),returnRecord:clone(record),returns:clone(incoming.returns),incomingPacket,basisSha256,currentSha256,returnedSha256:record.snapshotSha256,
  rows:rowsFor(baseline,current,returned),exchange};
}
export async function applyProgrammeSourceReturn(authorDraft,localExchange,returnedText,selection,opts={}){
 fields(selection,['id','at','reviewer','note','basisSha256','choices','returnId'],'adoption request');
 const details=meta({id:selection.id,at:selection.at,reviewer:selection.reviewer,note:selection.note},'adoption');need(digest(selection.basisSha256),'Review the exact current comparison before adoption.');choicesShape(selection.choices);
 const local=await validateExchange(localExchange,opts),prior=local.adoptions.find(a=>a.id===details.id),hash=hasher(opts);
 if(prior){
  need(prior.basisSha256===selection.basisSha256&&same(prior.choices,selection.choices)&&prior.reviewer===details.reviewer&&prior.note===details.note&&prior.at===details.at&&
   (selection.returnId===undefined||prior.returnId===selection.returnId),'This adoption identity already belongs to a different original intent.');
  need(prior.incomingPacket.sha256===await hash(returnedText)&&prior.incomingPacket.bytes===programmeUtf8(returnedText).length,'Keep the complete same returned packet on an original adoption retry.');
  const result=inflate(local,prior.resultSha256),retryDraft=validateProgrammeDraft(authorDraft),localDraftId=retryDraft.id;retryDraft.id=local.issue.authorDraftId;need(same(retryDraft,result),'This adoption already completed and the author draft has since changed. Reopen its retained result without replacing current work.');
  result.id=localDraftId;return{draft:validateProgrammeDraft(result),exchange:local,adoption:clone(prior),replayed:true};
 }
 const compared=await compareProgrammeSourceReturn(authorDraft,local,returnedText,{...opts,...(selection.returnId===undefined?{}:{returnId:selection.returnId})});
 need(compared.basisSha256===selection.basisSha256,'The current draft, received packet or author history changed. Compare again before choosing adoption.');
 const e=compared.exchange,baseline=inflate(e,e.issue.baselineSha256),current=inflate(e,compared.currentSha256),returned=inflate(e,compared.returnedSha256),draft=resolve(baseline,current,returned,selection.choices),resultSha256=await retainDraft(e,draft,hash);
 const adoption={...details,issueSha256:await hash(e.issue),returnId:compared.returnRecord.id,returnRecordSha256:await hash(compared.returnRecord),incomingPacket:compared.incomingPacket,
  basisSha256:compared.basisSha256,currentSha256:compared.currentSha256,returnedSha256:compared.returnedSha256,resultSha256,choices:clone(selection.choices)};
 e.adoptions.push(adoption);e.selectedReturnId=compared.returnRecord.id;bounded(e,'The complete accepted source history');
 const validatedExchange=await validateExchange(e,opts);draft.id=validateProgrammeDraft(authorDraft).id;return{draft:validateProgrammeDraft(draft),exchange:validatedExchange,adoption:clone(adoption),replayed:false};
}
export async function exportProgrammeSourceReviewBranch(exchange,{adoptionId,branch='baseline',returnId}={},opts={}){
 const e=await validateExchange(exchange,opts);
 if(returnId!==undefined){need(adoptionId===undefined,'Select either a returned proposal or an adoption branch.');return programmeSourceReviewDraft(e,{returnId},opts);}
 if(adoptionId===undefined){need(branch==='baseline','Select an adoption to inspect its current, returned or result source.');return inflate(e,e.issue.baselineSha256);}
 const a=e.adoptions.find(a=>a.id===adoptionId);need(a,'Select the original accepted source history.');
 need(['baseline','current','returned','result'].includes(branch),'Select a complete original source branch.');
 return inflate(e,branch==='baseline'?e.issue.baselineSha256:a[branch+'Sha256']);
}
