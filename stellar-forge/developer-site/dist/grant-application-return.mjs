// MIT. Issued editable application branches inside the original draft and custody.
import {validateDraft,validateDraftShape,retainVersion,ANSWERS,ENVELOPE,MAX_BYTES} from './grant-submission-core.mjs';
import {canonical} from './grant-handover-core.mjs';
import {contentHash,verifyHandoverContents,openDraftEnvelope,createDraftEnvelope} from './grant-handover-source.mjs';
import {SUBMISSION_WORKING_ENVELOPE,importSubmissionWorkingCopy} from './grant-submission-working-copy.mjs';

export const APPLICATION_RETURNS_SCHEMA='stellar-forge.grant-application-returns.v1';
export const APPLICATION_RETURN_CONTEXT_SCHEMA='stellar-forge.grant-application-return-context.v1';
const clone=x=>JSON.parse(JSON.stringify(x));
const need=(x,m)=>{if(!x)throw new Error(m);};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const same=(a,b)=>canonical(a)===canonical(b);
const text=(v,n,max=65536)=>need(typeof v==='string'&&v.length<=max,n+' must be complete text within its allowance.');
const date=v=>need(typeof v==='string'&&Number.isFinite(Date.parse(v)),'Retain a complete application-return date.');
const hash=v=>need(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),'Retain the complete SHA-256 identity.');
const id=v=>{text(v,'Return identity',200);need(v.length>0,'Retain a nonempty return identity.');};
const head=history=>history.records.at(-1)?.sha256??null;
const fresh=()=>({schema:APPLICATION_RETURNS_SCHEMA,snapshots:[],records:[]});
const historyOf=draft=>draft.applicationReturns??fresh();
const branches=record=>record.kind==='issue'?[record.baseline]:[record.baseline,record.current,record.returned,record.result];
const identity=draft=>({id:draft.id,createdAt:draft.createdAt});
function contextOf(issue){
  return {schema:APPLICATION_RETURN_CONTEXT_SCHEMA,issueId:issue.id,author:clone(issue.author),baselineSha256:issue.baseline,issuedAt:issue.at,recipient:issue.recipient};
}
function validateContext(context){
  need(object(context)&&context.schema===APPLICATION_RETURN_CONTEXT_SCHEMA,'Retain the issued editable application context.');
  id(context.issueId);need(object(context.author),'Retain the original issuing application identity.');
  id(context.author.id);date(context.author.createdAt);hash(context.baselineSha256);date(context.issuedAt);text(context.recipient,'Recipient',10000);
}
function prefix(history,length){
  need(Number.isSafeInteger(length)&&length>=0&&length<=history.records.length,'Retain the complete earlier return history.');
  const records=history.records.slice(0,length),refs=new Set(records.flatMap(branches));
  return {schema:APPLICATION_RETURNS_SCHEMA,snapshots:history.snapshots.filter(row=>refs.has(row.sha256)).map(clone),records:clone(records)};
}
function sourceValue(draft,ref){
  const rows=ref.kind==='application'?draft.sources:ref.kind==='planning'?draft.planSources:draft.handover?.objects;
  const row=(rows||[]).find(value=>value.sha256===ref.sha256);
  need(row,'Retain the original '+ref.kind+' source '+ref.sha256+' required by application-return history.');
  const key=ref.kind==='application'?'markdown':'base64';
  need(typeof row[key]==='string','Retain the complete original source bytes required by application-return history.');
  return row[key];
}
function hydrate(draft,snapshot,{history=true}={}){
  const result=clone(snapshot.body);
  for(const ref of snapshot.custody){
    const rows=ref.kind==='application'?result.sources:ref.kind==='planning'?result.planSources:result.handover?.objects;
    const row=rows?.[ref.index],key=ref.kind==='application'?'markdown':'base64';
    need(row&&row.sha256===ref.sha256&&!own(row,key),'Keep the exact compact branch source binding.');
    row[key]=sourceValue(draft,ref);
  }
  if(history&&snapshot.hadHistory)result.applicationReturns=prefix(historyOf(draft),snapshot.historyLength);
  return result;
}
function withoutHistory(draft){
  const next=clone(draft);delete next.applicationReturns;delete next.applicationReturnContext;return next;
}
async function snapshotOf(draft,authorityHistory){
  const body=clone(draft),existing=body.applicationReturns,custody=[];
  delete body.applicationReturns;
  const retained=existing??fresh(),length=retained.records.length;
  need(same(retained,prefix(authorityHistory,length)),'The branch contains different original application-return history.');
  for(const [kind,rows,key]of [['application',body.sources,'markdown'],['planning',body.planSources||[],'base64'],['handover',body.handover?.objects||[],'base64']]){
    rows.forEach((row,index)=>{need(typeof row[key]==='string','Retain every complete branch source.');custody.push({kind,index,sha256:row.sha256});delete row[key];});
  }
  const value={body,custody,historyLength:length,historyHead:head(retained),hadHistory:own(draft,'applicationReturns')};
  return {sha256:await contentHash(canonical(value)),...value};
}
function appendSnapshot(history,snapshot){
  const previous=history.snapshots.find(row=>row.sha256===snapshot.sha256);
  if(previous)need(same(previous,snapshot),'A branch hash has different retained content.');
  else history.snapshots.push(snapshot);
  return snapshot.sha256;
}
async function appendRecord(history,body){
  need(!history.records.some(row=>row.id===body.id),'Choose a new application issue or adoption identity.');
  const record={...body,previousSha256:head(history)};
  record.sha256=await contentHash(canonical(record));history.records.push(record);return record;
}
function getSnapshot(history,sha){const value=history.snapshots.find(row=>row.sha256===sha);need(value,'Retain every complete application branch.');return value;}
function getIssue(draft,issueId){
  const issue=historyOf(draft).records.find(row=>row.kind==='issue'&&row.id===issueId);
  need(issue,'Select an issue saved by this original application author.');return issue;
}
function validateChoices(value){
  need(object(value),'Retain explicit application-return choices.');
  for(const [key,choice]of Object.entries(value)){text(key,'Choice identity',1000);need(['current','returned'].includes(choice),'Choose the current or returned value explicitly.');}
}
export function validateApplicationReturns(draft){
  if(own(draft,'applicationReturnContext'))validateContext(draft.applicationReturnContext);
  if(!own(draft,'applicationReturns')){need(!own(draft,'applicationReturnContext'),'Keep the issuing history with the editable application copy.');return draft;}
  const history=draft.applicationReturns;
  need(object(history)&&history.schema===APPLICATION_RETURNS_SCHEMA&&Array.isArray(history.snapshots)&&Array.isArray(history.records),'Retain the complete application-return history.');
  const snaps=new Map(),ids=new Set();let previous=null;
  for(const snapshot of history.snapshots){
    need(object(snapshot)&&object(snapshot.body)&&Array.isArray(snapshot.custody),'Retain each complete compact application branch.');hash(snapshot.sha256);
    need(!snaps.has(snapshot.sha256),'Keep one exact copy of each branch.');snaps.set(snapshot.sha256,snapshot);
    need(!own(snapshot.body,'applicationReturns'),'Branch history must use its immutable earlier prefix, not recursive copies.');
    need(Number.isSafeInteger(snapshot.historyLength)&&snapshot.historyLength>=0&&snapshot.historyLength<=history.records.length&&typeof snapshot.hadHistory==='boolean','Keep the branch history boundary.');
    need(snapshot.historyHead===(snapshot.historyLength?history.records[snapshot.historyLength-1]?.sha256:null),'The branch history head differs.');
    need(snapshot.hadHistory||snapshot.historyLength===0,'A branch without prior history cannot refer to a later edition.');
    const seen=new Set();
    for(const ref of snapshot.custody){
      need(object(ref)&&['application','planning','handover'].includes(ref.kind)&&Number.isSafeInteger(ref.index)&&ref.index>=0,'Keep the explicit native source location.');hash(ref.sha256);
      const key=ref.kind+':'+ref.index;need(!seen.has(key),'Do not repeat a branch source location.');seen.add(key);sourceValue(draft,ref);
    }
    const expected=(snapshot.body.sources?.length||0)+(snapshot.body.planSources?.length||0)+(snapshot.body.handover?.objects?.length||0);
    need(snapshot.custody.length===expected,'Retain references for every complete original branch source.');
    hydrate(draft,snapshot,{history:false});
  }
  const issues=new Map(),used=new Set();
  history.records.forEach((record,index)=>{
    need(object(record)&&['issue','adoption'].includes(record.kind),'Retain the original issue or adoption record.');id(record.id);need(!ids.has(record.id),'Keep unique issue and adoption identities.');ids.add(record.id);date(record.at);hash(record.sha256);
    need(record.previousSha256===previous,'Retain the complete ordered application-return history.');previous=record.sha256;
    for(const ref of branches(record)){hash(ref);const snapshot=snaps.get(ref);need(snapshot&&snapshot.historyLength<=index,'Every branch must retain its existing earlier history.');used.add(ref);}
    if(record.kind==='issue'){
      text(record.label,'Issue label',10000);text(record.recipient,'Recipient',10000);text(record.note,'Issue note');
      need(object(record.author),'Retain the issuing application identity.');id(record.author.id);date(record.author.createdAt);
      const baseline=snaps.get(record.baseline);need(same(identity(baseline.body),record.author),'The issue author differs from the retained baseline.');
      issues.set(record.id,record);
    }else{
      need(issues.has(record.issueId),'Retain the original issue before its adoption.');need(record.baseline===issues.get(record.issueId).baseline,'The adoption baseline differs from the issued branch.');
      text(record.reviewer,'Applying author',10000);need(record.reviewer.trim(),'Record who chose the returned changes.');text(record.note,'Adoption note');validateChoices(record.choices);
      for(const key of ['basisSha256','rawSha256','currentFingerprint','returnedFingerprint'])hash(record[key]);
      need(Number.isSafeInteger(record.rawBytes)&&record.rawBytes>=0,'Retain the complete original return file length.');
      need(object(record.file)&&[ENVELOPE,SUBMISSION_WORKING_ENVELOPE].includes(record.file.schema),'Retain the original return envelope identity.');date(record.file.exportedAt);hash(record.file.sha256);
    }
  });
  need(used.size===snaps.size,'Do not retain detached application branches.');
  if(draft.applicationReturnContext){const issue=issues.get(draft.applicationReturnContext.issueId);need(issue&&same(contextOf(issue),draft.applicationReturnContext),'The editable copy differs from its original issue.');}
  return draft;
}
export async function verifyApplicationReturns(draft){
  validateApplicationReturns(draft);if(!draft.applicationReturns)return draft;
  const history=draft.applicationReturns;
  for(const snapshot of history.snapshots){
    const {sha256,...value}=snapshot;need(await contentHash(canonical(value))===sha256,'A complete application branch differs from its saved identity.');
    const branch=hydrate(draft,snapshot);validateDraftShape(withoutHistory(branch));await verifyHandoverContents(withoutHistory(branch));
    if(branch.applicationReturnContext){
      const issue=history.records.slice(0,snapshot.historyLength).find(row=>row.kind==='issue'&&row.id===branch.applicationReturnContext.issueId);
      need(issue&&same(contextOf(issue),branch.applicationReturnContext),'The retained branch context differs from its issued original.');
    }
  }
  for(const record of history.records){
    const {sha256,...body}=record;need(await contentHash(canonical(body))===sha256,'The original issue or adoption record differs from its saved identity.');
    if(record.kind==='adoption'){
      const current=hydrate(draft,getSnapshot(history,record.current)),returned=hydrate(draft,getSnapshot(history,record.returned));
      need(await fingerprint(current)===record.currentFingerprint&&await fingerprint(returned)===record.returnedFingerprint,'The retained adoption branches differ from their comparison.');
      const issue=getIssue(draft,record.issueId),issueIndex=history.records.findIndex(row=>row.id===issue.id);
      const issued=hydrate(draft,getSnapshot(history,issue.baseline));
      issued.applicationReturns=prefix(history,issueIndex+1);issued.applicationReturnContext=contextOf(issue);issued.updatedAt=issue.at;
      need(same(identity(current),issue.author)&&same(identity(returned),issue.author),'The adoption changed its original author identity.');
      need(same(returned.applicationReturnContext,contextOf(issue))&&same(returned.applicationReturns,issued.applicationReturns),'The adopted return differs from its issued authority.');
      const rows=comparisons(issued,current,returned),scope=outOfScope(issued,returned,null);
      need(scope.length===0,'An adopted branch contains changes outside the author-selected editable scope.');
      const basis=await contentHash(canonical({issue:issue.sha256,currentFingerprint:record.currentFingerprint,returnedFingerprint:record.returnedFingerprint,rawSha256:record.rawSha256,rawBytes:record.rawBytes,rows,outOfScope:scope}));
      need(basis===record.basisSha256,'The retained adoption does not match its original comparison basis.');
      let expected=retainVersion(current,'Before editable return: '+issue.label,record.at);
      expected=applyRows(expected,rows,record.choices);expected.updatedAt=record.at;
      const result=hydrate(draft,getSnapshot(history,record.result));
      need(same(expected,result),'The retained result differs from the explicit author choices.');
    }
  }
  return draft;
}
export function listApplicationReturns(draft){
  validateApplicationReturns(draft);
  const records=historyOf(draft).records;return {issues:clone(records.filter(row=>row.kind==='issue')),adoptions:clone(records.filter(row=>row.kind==='adoption'))};
}
async function fingerprint(draft){return contentHash(canonical(draft));}
export async function issuedDraftFor(draft,issueId){
  await verifyApplicationReturns(draft);
  const issue=getIssue(draft,issueId),history=historyOf(draft),index=history.records.findIndex(row=>row.id===issueId);
  const result=hydrate(draft,getSnapshot(history,issue.baseline));
  result.applicationReturns=prefix(history,index+1);result.applicationReturnContext=contextOf(issue);result.updatedAt=issue.at;
  return validateDraft(result);
}
export async function createIssue(draft,{id:issueId,label,recipient='',note='',at=new Date().toISOString()}={}){
  validateDraft(draft);await verifyHandoverContents(withoutHistory(draft));await verifyApplicationReturns(draft);
  id(issueId);text(label,'Issue label',10000);need(label.trim(),'Describe the issued editable copy.');text(recipient,'Recipient',10000);text(note,'Issue note');date(at);
  const next=clone(draft),history=clone(historyOf(draft)),baseline=appendSnapshot(history,await snapshotOf(draft,history));
  const issue=await appendRecord(history,{kind:'issue',id:issueId,label,recipient,note,at,author:identity(draft),baseline});
  next.applicationReturns=history;next.updatedAt=at;validateDraft(next);await verifyApplicationReturns(next);
  return {draft:next,issuedDraft:await issuedDraftFor(next,issueId),issue:clone(issue)};
}
async function parseReturned(raw){
  text(raw,'Complete returned native or working file',64*1024*1024+65536);
  const rawBytes=new TextEncoder().encode(raw).length;need(rawBytes<=64*1024*1024+65536,'Open a complete returned file within the working envelope allowance.');
  const packet=JSON.parse(raw.replace(/^\uFEFF/,''));let draft,working=null;
  if(packet?.schema===ENVELOPE)draft=await openDraftEnvelope(raw);
  else if(packet?.schema===SUBMISSION_WORKING_ENVELOPE){working=await importSubmissionWorkingCopy(raw);draft=working.draft;need(draft,'The returned working copy has no original application.');validateDraft(draft);}
  else throw new Error('Open the complete original native application export or working export.');
  date(packet.exportedAt);hash(packet.sha256);
  return {draft,working,rawSha256:await contentHash(raw),rawBytes,file:{schema:packet.schema,exportedAt:packet.exportedAt,sha256:packet.sha256}};
}
function outOfScope(baseline,returned,working){
  const editable=new Set(['title','folder','updatedAt','versions','answers','form','fields','applicationReturns','applicationReturnContext']);
  const rows=[],keys=new Set([...Object.keys(baseline),...Object.keys(returned)]);
  for(const key of keys)if(!editable.has(key)){
    const a=own(baseline,key)?baseline[key]:null,b=own(returned,key)?returned[key]:null;
    if(own(baseline,key)!==own(returned,key)||!same(a,b))rows.push({key,label:key,baseline:clone(a),returned:clone(b)});
  }
  if(!same(baseline.versions,returned.versions.slice(0,baseline.versions.length)))rows.push({key:'saved-version-history',label:'Previously saved author versions were changed or removed',baseline:clone(baseline.versions),returned:clone(returned.versions)});
  const answerMeta=draft=>draft.answers.map(answer=>{const next=clone(answer);delete next.text;delete next.note;return next;});
  if(!same(answerMeta(baseline),answerMeta(returned)))rows.push({key:'answer-source-context',label:'Original answer source and baseline bindings',baseline:answerMeta(baseline),returned:answerMeta(returned)});
  if(returned.folder!=='SCF submission — '+returned.title&&returned.folder!==baseline.folder)rows.push({key:'folder',label:'Application folder identity',baseline:baseline.folder,returned:returned.folder});
  if(working)for(const key of ['incoming','workbook'])if(working[key]!==null)rows.push({key:'working:'+key,label:'Unapplied '+key+' remains in the returned working file',baseline:null,returned:clone(working[key])});
  if(working?.applicationReturn?.raw)rows.push({key:'working:applicationReturn',label:'Another pending editable return remains unapplied',baseline:null,returned:clone(working.applicationReturn)});
  return rows;
}
function comparisons(baseline,current,returned){
  const rows=[];
  const add=(key,kind,label,a,b,c)=>{
    const bc=same(b,c),ab=same(a,b),ac=same(a,c);
    rows.push({key,kind,label,baseline:clone(a),current:clone(b),returned:clone(c),status:bc?(ab?'unchanged':'same-change'):ab?'returned-only':ac?'current-only':'conflict'});
  };
  add('title','title','Application title',baseline.title,current.title,returned.title);
  add('form','form','Complete issuer form',baseline.form,current.form,returned.form);
  for(const [answerId,label]of ANSWERS)for(const key of ['text','note']){
    const get=d=>d.answers.find(row=>row.id===answerId)[key];add('answer:'+answerId+':'+key,'answer',label+(key==='note'?' — author note':''),get(baseline),get(current),get(returned));
  }
  const fieldIds=new Set([...baseline.fields,...current.fields,...returned.fields].map(row=>row.id));
  for(const fieldId of fieldIds){
    const get=d=>d.fields.find(row=>row.id===fieldId)??null;
    add('field:'+fieldId,'field',(get(current)||get(returned)||get(baseline)).label||fieldId,get(baseline),get(current),get(returned));
  }
  add('field-order','field-order','Complete issuer field order',baseline.fields.map(row=>row.id),current.fields.map(row=>row.id),returned.fields.map(row=>row.id));
  return rows;
}
export async function compareReturned(draft,raw){
  validateDraft(draft);await verifyApplicationReturns(draft);
  const parsed=await parseReturned(raw),returned=parsed.draft,context=returned.applicationReturnContext;validateContext(context);
  const issue=getIssue(draft,context.issueId);
  need(same(issue.author,identity(draft)),'Return to the original author application. A separate saved copy cannot adopt changes for another application identity.');
  need(same(context,contextOf(issue)),'The returned file does not carry this original issued identity.');
  need(same(identity(returned),issue.author),'The returned editable copy changed its original application identity.');
  const issued=await issuedDraftFor(draft,issue.id);
  need(same(returned.applicationReturns,issued.applicationReturns),'The returned copy changed the author’s issued application-return history.');
  const rows=comparisons(issued,draft,returned),scope=outOfScope(issued,returned,parsed.working);
  const currentFingerprint=await fingerprint(draft),returnedFingerprint=await fingerprint(returned);
  const basisSha256=await contentHash(canonical({issue:issue.sha256,currentFingerprint,returnedFingerprint,rawSha256:parsed.rawSha256,rawBytes:parsed.rawBytes,rows,outOfScope:scope}));
  return {issue:clone(issue),rows,outOfScope:scope,currentFingerprint,basisSha256,returnedFingerprint,returnedDraft:clone(returned),rawSha256:parsed.rawSha256,rawBytes:parsed.rawBytes,file:parsed.file};
}
function applyRows(draft,rows,choices){
  validateChoices(choices);const changed=rows.filter(row=>!same(row.current,row.returned));
  need(Object.keys(choices).every(key=>rows.some(row=>row.key===key)),'A choice refers to a different comparison.');
  for(const row of changed)need(own(choices,row.key),'Choose explicitly for '+row.label+'.');
  const selected=new Map(rows.map(row=>[row.key,clone(same(row.current,row.returned)?row.current:choices[row.key]==='returned'?row.returned:row.current)]));
  const result=clone(draft);result.title=selected.get('title');result.folder='SCF submission — '+result.title;result.form=selected.get('form');
  for(const answer of result.answers)for(const key of ['text','note'])answer[key]=selected.get('answer:'+answer.id+':'+key);
  const fields=new Map(rows.filter(row=>row.kind==='field').map(row=>[row.key.slice(6),selected.get(row.key)]).filter(([,value])=>value!==null));
  const order=selected.get('field-order');
  need(order.length===fields.size&&new Set(order).size===fields.size&&order.every(key=>fields.has(key)),'Choose a field order containing exactly the selected fields. Keep or remove the corresponding whole field explicitly.');
  result.fields=order.map(key=>fields.get(key));return result;
}
export async function applyReturned(draft,raw,{issueId,basisSha256,choices,reviewer,note='',at=new Date().toISOString(),id:adoptionId}={}){
  id(adoptionId);id(issueId);hash(basisSha256);text(reviewer,'Applying author',10000);need(reviewer.trim(),'Record who chose the changes.');text(note,'Adoption note');date(at);
  const comparison=await compareReturned(draft,raw);
  need(comparison.issue.id===issueId&&comparison.basisSha256===basisSha256,'The original draft or returned file changed. Preview the current comparison and choose again.');
  need(comparison.outOfScope.length===0,'The return contains source, planning, review, authority or other changes outside this editable application comparison. Keep the complete return and resolve those changes through their original workflow before applying.');
  const history=clone(historyOf(draft));
  need(!history.records.some(row=>row.kind==='adoption'&&row.issueId===issueId&&row.rawSha256===comparison.rawSha256),'This exact returned file is already recorded. Reopen the retained adoption instead of applying it twice.');
  const current=appendSnapshot(history,await snapshotOf(draft,history));
  const returned=appendSnapshot(history,await snapshotOf(comparison.returnedDraft,history));
  // Original native version mechanism retains the author’s pre-application text.
  let result=retainVersion(draft,'Before editable return: '+comparison.issue.label,at);
  result=applyRows(result,comparison.rows,choices);result.updatedAt=at;
  const resultSha=appendSnapshot(history,await snapshotOf(result,history));
  await appendRecord(history,{kind:'adoption',id:adoptionId,issueId,at,reviewer,note,baseline:comparison.issue.baseline,current,returned,result:resultSha,
    choices:clone(choices),basisSha256,currentFingerprint:comparison.currentFingerprint,returnedFingerprint:comparison.returnedFingerprint,
    rawSha256:comparison.rawSha256,rawBytes:comparison.rawBytes,file:clone(comparison.file)});
  result.applicationReturns=history;validateDraft(result);await verifyApplicationReturns(result);return result;
}
export async function exportApplicationReturnBranch(draft,adoptionId,branch='returned'){
  await verifyApplicationReturns(draft);need(['baseline','current','returned','result'].includes(branch),'Select a complete retained application branch.');
  const history=historyOf(draft),index=history.records.findIndex(row=>row.kind==='adoption'&&row.id===adoptionId);need(index>=0,'Select a retained application adoption.');
  const record=history.records[index],result=hydrate(draft,getSnapshot(history,record[branch]));
  if(branch==='result')result.applicationReturns=prefix(history,index+1);
  return createDraftEnvelope(result,{exportedAt:record.at});
}
