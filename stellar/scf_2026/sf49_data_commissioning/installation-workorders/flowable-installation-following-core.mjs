// SPDX-License-Identifier: MIT
// Explicit reconciliation of complete Flowable customer source editions.
import {hash,same,validateFlowableInstallationSource} from './flowable-installation-core.mjs';
export const FLOWABLE_FOLLOWING_SCHEMA='stellar-forge.flowable-customer-installation.v1.following';
const SCHEMA=FLOWABLE_FOLLOWING_SCHEMA;
const clone=x=>JSON.parse(JSON.stringify(x));
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const ordered=x=>Array.isArray(x)?x.map(ordered):plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;
export const followingCanonical=x=>JSON.stringify(ordered(x));
export const followingDigest=x=>hash(followingCanonical(x));
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'FLOWABLE_SOURCE_DESK_INPUT',status:422});};
const reference=row=>({id:row.id,revision:row.revision,sha256:row.sha256});
const identity=p=>({preparationSha256:p.preparationSha256,workspaceId:p.source.workspaceId,archive:clone(p.source.archive),
 programme:{record:clone(p.source.programme.record),programmeSha256:p.source.programme.programmeSha256,basisSha256:p.source.programme.basisSha256}});
const FIELDS={
 name:'Installation name',merchantDeploymentId:'Merchant deployment',buyerDeploymentIds:'Buyer deployments',
 task:['name','purpose','request','completeOutput','repeatTrigger','pricedUnit'],
 source:['sourceIds','reference','mode','population','meaning','authority','changePolicy'],
 payment:['network','asset','recipient','priceAtomic','taskBudgetAtomic','taskUnits','authority','termsSourceIds','facilitators'],
 receiving:['application','host','operator','acceptanceRule','changeAndWithdraw','recovery','maintenance','sourceIds']
};
export const FLOWABLE_FOLLOWING_CHOICES=Object.freeze(['KEEP_CURRENT','TAKE_LATER','USE_BASELINE']);
const PROTECTED=['stage','workorder','assignments','checks','workshare','workflowPeriods','coordination','commercial','useCalendar','commissioning','effort'];
function at(value,path){
 let row=value;for(const key of path){if(!plain(row)||!Object.hasOwn(row,key))return{present:false};row=row[key];}
 return{present:true,value:clone(row)};
}
function put(value,path,cell){
 let row=value;for(const key of path.slice(0,-1)){if(!plain(row[key]))row[key]={};row=row[key];}
 if(cell.present)row[path.at(-1)]=clone(cell.value);else delete row[path.at(-1)];
}
function preparation(value,label){
 need(plain(value)&&hex(value.preparationSha256)&&plain(value.document)&&plain(value.installationSource)&&
  value.installationSource.caseId&&value.workshareCaseId,'Retain the full '+label+' preparation and its native selection.');
 validateFlowableInstallationSource(value.source);
 need(value.document.workshare?.caseId===value.workshareCaseId,'Keep the original Workshare in the '+label+' preparation.');
 return value;
}
function saved(row,label){
 need(plain(row)&&/^installation-[a-f0-9]{32}$/.test(row.id??'')&&Number.isSafeInteger(row.revision)&&row.revision>0&&
  hex(row.sha256)&&plain(row.preview?.document)&&plain(row.preview.source)&&plain(row.preview.snapshot),
  'Retain the complete original '+label+' saved Installation row.');
 return row;
}
function deltas(before,after,key){
 const a=new Map(before.map(x=>[x[key],x])),b=new Map(after.map(x=>[x[key],x]));
 need(a.size===before.length&&b.size===after.length,'Keep each original source identity once.');
 return [...new Set([...a.keys(),...b.keys()])].sort().map(id=>{
  const x=a.get(id)??null,y=b.get(id)??null;
  return{key:id,status:x===null?'ADDED':y===null?'REMOVED':same(x,y)?'UNCHANGED':'CHANGED',before:x,after:y};
 });
}
export function compareFlowableInstallationFollowing({prior,later,native,selection,lineage}={}){
 preparation(prior,'prior');preparation(later,'later');
 need(plain(native)&&plain(native.source)&&plain(selection),'Use the original private native Installation snapshot.');
 const base=saved(native.baseline,'baseline'),current=saved(native.current,'current');
 need(base.id===current.id&&base.revision<=current.revision&&selection.installationId===base.id&&
  selection.baseRevision===base.revision&&selection.expectedBaseSha256===base.sha256&&
  selection.expectedRevision===current.revision&&selection.expectedInstallationSha256===current.sha256&&
  selection.expectedVersion===native.source.version,'The reviewed native Installation or case edition changed.');
 need(prior.installationSource.caseId===native.source.caseId&&later.installationSource.caseId===native.source.caseId&&
  base.preview.source.caseId===native.source.caseId&&current.preview.source.caseId===native.source.caseId&&
  same(later.installationSource,native.source),'Select the later preparation from this exact current case and plan.');
 need(prior.workshareCaseId===later.workshareCaseId&&base.preview.document.workshare?.caseId===prior.workshareCaseId&&
  current.preview.document.workshare?.caseId===prior.workshareCaseId,'Preserve this Installation and its original Workshare.');
 const proof=native.baselinePreparation;
 need(plain(proof)&&proof.requestId===selection.priorPreparationId&&proof.preparationSha256===prior.preparationSha256&&
  same(proof.document,base.preview.document),'Bind the prior full preparation to the exact saved baseline through the original normalizer.');
 need(prior.source.programme.record.id===later.source.programme.record.id&&
  later.source.programme.record.revision>=prior.source.programme.record.revision,
  'Select a following edition of the same original programme, without reversing its saved revision.');
 need(plain(lineage)&&lineage.workspaceId===later.source.workspaceId&&same(lineage.previousProgrammeRecord,prior.source.programme.record),
  'The later complete archive must retain the exact original programme record.');
 const documents={baseline:clone(base.preview.document),current:clone(current.preview.document),later:clone(later.document)};
 const rows=[];
 for(const [key,fields]of Object.entries(FIELDS)){
  const paths=Array.isArray(fields)?fields.map(field=>[key,field]):[[key]];
  for(const path of paths){
   const baseline=at(documents.baseline,path),current=at(documents.current,path),later=at(documents.later,path);
   const currentChanged=!same(baseline,current),laterChanged=!same(baseline,later),changed=currentChanged||laterChanged;
   rows.push({key:'document:'+path.join('.'),path,label:Array.isArray(fields)?path.join(' · '):fields,
    baseline,current,later,currentChanged,laterChanged,changed,
    conflict:currentChanged&&laterChanged&&!same(current,later),choices:clone(FLOWABLE_FOLLOWING_CHOICES)});
  }
 }
 const protectedFields=[...new Set([...PROTECTED,...Object.keys(documents.baseline),...Object.keys(documents.current),...Object.keys(documents.later)].filter(x=>!Object.hasOwn(FIELDS,x)))].sort().map(key=>{
  const baseline=at(documents.baseline,[key]),current=at(documents.current,[key]),later=at(documents.later,[key]);
  return{key,path:[key],baseline,current,later,changed:!same(baseline,current)||!same(baseline,later),policy:'KEEP_CURRENT'};
 });
 for(const [section,fields]of Object.entries(FIELDS))if(Array.isArray(fields)){
  const keys=[...new Set(Object.values(documents).flatMap(doc=>Object.keys(doc[section]??{})))].filter(key=>!fields.includes(key)).sort();
  for(const key of keys){const path=[section,key],baseline=at(documents.baseline,path),current=at(documents.current,path),later=at(documents.later,path);
   protectedFields.push({key:section+'.'+key,path,baseline,current,later,changed:!same(baseline,current)||!same(baseline,later),policy:'KEEP_CURRENT'});
  }
 }
 const value={schema:SCHEMA+'.comparison',selection:clone(selection),lineage:clone(lineage),native:clone(native),workshareCaseId:prior.workshareCaseId,
  prior:identity(prior),later:identity(later),documents,rows,protectedFields,
  sourceReview:{key:'source-edition',requiredChoice:'ACCEPT_LATER_SOURCE',
   priorWorkspaceId:prior.source.workspaceId,laterWorkspaceId:later.source.workspaceId,
   programmeChanged:!same(prior.source.programme,later.source.programme),
   files:deltas(prior.source.files,later.source.files,'name'),
   operations:deltas(prior.source.operations,later.source.operations,'key'),
   priorProgramme:clone(prior.source.programme),laterProgramme:clone(later.source.programme)},
  summary:{changed:rows.filter(x=>x.changed).length,conflicts:rows.filter(x=>x.conflict).length,
   protectedChanges:protectedFields.filter(x=>x.changed).length}};
 return{...value,basisSha256:followingDigest(value)};
}
export function applyFlowableInstallationFollowing(comparison,{basisSha256,choices,reviewer,note}={}){
 need(plain(comparison)&&comparison.schema===SCHEMA+'.comparison','Open the complete original following-edition comparison.');
 const {basisSha256:original,...body}=comparison;
 need(hex(original)&&followingDigest(body)===original&&basisSha256===original,'Reopen and compare the changed source or native edition before choosing again.');
 need(plain(choices)&&choices['source-edition']==='ACCEPT_LATER_SOURCE','Explicitly review and accept the complete later source edition.');
 need(typeof reviewer==='string'&&reviewer.trim()&&reviewer.length<=500&&typeof note==='string'&&note.trim()&&note.length<=16000,
  'Record the reviewer identity and the actual source/binding decision.');
 const changed=comparison.rows.filter(x=>x.changed),keys=new Set(['source-edition',...changed.map(x=>x.key)]);
 need(Object.keys(choices).every(k=>keys.has(k))&&changed.every(row=>FLOWABLE_FOLLOWING_CHOICES.includes(choices[row.key])),
  'Choose current, later or baseline explicitly for every changed document field.');
 const document=clone(comparison.documents.current),decisions=[];
 for(const row of changed){
  const choice=choices[row.key],branch={KEEP_CURRENT:'current',TAKE_LATER:'later',USE_BASELINE:'baseline'}[choice];
  put(document,row.path,row[branch]);decisions.push({key:row.key,choice,selected:clone(row[branch])});
 }
 // Protected native work, acceptance and commercial state always remains current.
 for(const row of comparison.protectedFields)need(same(at(document,row.path),row.current),'Preserve original current native authority.');
 need(Buffer.byteLength(JSON.stringify(document))<=128*1024,'The full chosen native document exceeds its original 128 KiB capacity.');
 const review={schema:SCHEMA+'.review',basisSha256,reviewer,note,choices:clone(choices),decisions,
  sourceDecision:'ACCEPT_LATER_SOURCE',baselineInstallation:reference(comparison.native.baseline),
  currentInstallation:reference(comparison.native.current),prior:clone(comparison.prior),later:clone(comparison.later),
  documentSha256:followingDigest(document)};
 const preview={expectedVersion:comparison.native.source.version,installationId:comparison.native.current.id,
  expectedRevision:comparison.native.current.revision,document};
 return{document,preview,review,reviewSha256:followingDigest(review),installationSource:clone(comparison.native.source),
  workshareCaseId:comparison.workshareCaseId};
}
