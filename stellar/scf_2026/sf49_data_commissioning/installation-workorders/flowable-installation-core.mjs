// MIT. Original Flowable programme and commercial Workshare joined to Customer Installation.
import {createHash} from 'node:crypto';
import {prepareInstallation,renderWorkorder} from './prepare-core.mjs';
import {commercialWorkshare,commercialMarkdown,commercialHtml} from './commercial-workshare-core.mjs';
export const FLOWABLE_INSTALLATION_SCHEMA='stellar-forge.flowable-customer-installation.v1';
export const FLOWABLE_INSTALLATION_PROFILE='flowable-customer';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'FLOWABLE_INSTALLATION_REVIEW_REQUIRED'});};
export const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
const clone=x=>JSON.parse(JSON.stringify(x));
const ordered=x=>Array.isArray(x)?x.map(ordered):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;
export const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
export const identity=(name,bytes,mediaType='application/octet-stream')=>({name,bytes:bytes.length,sha256:hash(bytes),mediaType});
export const ordinary=name=>typeof name==='string'&&name.length>0&&name.length<=1024&&!/^[\\/]|[\\:\x00-\x1f]/.test(name)&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function fileList(rows,label){
 need(Array.isArray(rows)&&rows.length<=10000&&new Set(rows.map(x=>x?.name)).size===rows.length,'Retain complete distinct '+label+' files.');
 for(const x of rows)need(ordinary(x.name)&&Number.isSafeInteger(x.bytes)&&x.bytes>=0&&hex(x.sha256),'Retain exact '+label+' member identities.');
}
export function validateFlowableInstallationSource(source){
 need(source?.schema===FLOWABLE_INSTALLATION_SCHEMA+'.source'&&typeof source.workspaceId==='string'&&source.workspaceId.length>0,'Use the original complete Flowable source inspection.');
 need(source.archive?.name==='flowable-workspace.ndjson'&&Number.isSafeInteger(source.archive.bytes)&&source.archive.bytes>0&&hex(source.archive.sha256)&&hex(source.archive.bodySha256),'Select the complete original Flowable archive.');
 const p=source.programme;
 need(p?.schema==='stellar-forge.flowable-programme-view.v1'&&p.record?.kind==='programme'&&typeof p.record.id==='string'&&Number.isSafeInteger(p.record.revision)&&p.record.revision>0&&hex(p.record.sha256)&&hex(p.programmeSha256)&&hex(p.basisSha256),'Preserve distinct selected programme record, source and native outcome identities.');
 need(Array.isArray(p.progress?.rows)&&p.progress.rows.length===p.programme?.steps?.length&&Array.isArray(source.operations),'Retain the whole original programme and every current step.');
 fileList(source.files,'selected Flowable');need(['programme-source.json','programme-view.json','programme-record.json'].every(n=>source.files.some(f=>f.name===n)),'Keep the original programme source and complete saved views.');
 need(source.files.find(f=>f.name==='programme-source.json').sha256===p.programmeSha256,'The original programme source differs from its selected identity.');
 const expected=p.progress.rows.filter(x=>x.record),byKey=new Map(source.operations.map(x=>[x.key,x]));
 need(byKey.size===source.operations.length&&source.operations.length===expected.length,'Retain each selected original operation once.');
 for(const row of expected){
  const x=byKey.get(row.key);
  need(x&&x.kind===row.kind&&x.id===row.record.id&&x.revision===row.record.revision&&x.sha256===row.record.sha256&&x.state===row.state&&source.files.some(f=>f.name===x.recordFile),'The selected operation differs from the original programme progress.');
  if(x.reviewFile)need(source.files.some(f=>f.name===x.reviewFile),'Retain the complete original operation review.');
 }
 return source;
}
export function flowableSourceSelection(source,reportIdentity){
 validateFlowableInstallationSource(source);
 need(reportIdentity&&Number.isSafeInteger(reportIdentity.bytes)&&reportIdentity.bytes>0&&hex(reportIdentity.sha256),'Retain the complete source-report identity.');
 return {schema:FLOWABLE_INSTALLATION_SCHEMA+'.selection',workspaceId:source.workspaceId,
  archive:clone(source.archive),sourceReport:{name:'FLOWABLE_CUSTOMER_SOURCE.json',bytes:reportIdentity.bytes,sha256:reportIdentity.sha256},
  programme:{record:clone(source.programme.record),programmeSha256:source.programme.programmeSha256,basisSha256:source.programme.basisSha256,
   key:source.programme.programmeKey,state:source.programme.progress.state,steps:source.programme.progress.total},
  files:clone(source.files)};
}
export function composeFlowableInstallation(seed,profile,bindings,source,commissioning,{attachments=[]}={}){
 validateFlowableInstallationSource(source);
 need(profile?.id===FLOWABLE_INSTALLATION_PROFILE&&bindings?.profile===profile.id,'Select the maintained complete Flowable customer profile.');
 fileList(attachments,'additional working');
 const chosen=clone(bindings);chosen.source??={};chosen.receiving??={};
 const p=source.programme,reference='Flowable workspace '+source.workspaceId+'; programme '+p.record.id+' revision '+p.record.revision+
  '; saved record SHA-256 '+p.record.sha256+'; programme source SHA-256 '+p.programmeSha256+'; selected native basis SHA-256 '+p.basisSha256+
  '; complete archive SHA-256 '+source.archive.sha256+'.';
 if(!chosen.source.reference)chosen.source.reference=reference;
 if(!chosen.receiving.application)chosen.receiving.application=profile.receiving.application+
  ' Whole Flowable archive: source/flowable-workspace.ndjson. Selected source and native result files: delivery/files/.';
 const prepared=prepareInstallation(seed,profile,chosen);
 need(typeof bindings.workshareCaseId==='string'&&bindings.workshareCaseId.length>0&&prepared.document.workshare?.caseId===bindings.workshareCaseId,'Receive the full original customer Workshare seed first.');
 const commercial=commercialWorkshare({seed,commissioning,profile});
 need(commercial.caseId===prepared.workshareCaseId,'Keep the full original commercial case.');
 need(Buffer.byteLength(JSON.stringify(prepared.document))<=128*1024,'The complete native Installation document exceeds its original 128 KiB limit.');
 const annex={...clone(source),installationSelection:clone(prepared.source),workshareCaseId:prepared.workshareCaseId,
  originalInputs:{seed:'source/seed.json',bindings:'source/bindings.json',profile:'source/profile.json',commissioning:'source/commissioning.json'},
  attachments:clone(attachments)};
 const cell=x=>String(x??'').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
 const rows=source.operations.map(x=>'| '+cell(x.key)+' | '+x.kind+' | '+cell(x.state)+' | '+x.id+' | '+x.revision+' |');
 const markdown='# Complete Flowable customer Installation\n\n'+reference+'\n\n'+
  'Original commercial Workshare: '+cell(prepared.workshareCaseId)+'\n\n'+
  'Open the original programme, each selected operation and complete review under delivery/files/. The full NDJSON archive preserves every original source, record edition, native request/result, pending operation and journal. Restore it through the original Flowable receiver in a distinct private workspace.\n\n'+
  '| Programme step | Native kind | Observed state | Original record | Revision |\n| --- | --- | --- | --- | ---: |\n'+rows.join('\n')+'\n\n'+
  'The full selected programme has '+p.progress.total+' steps, '+p.progress.confirmed+' confirmed, and state '+cell(p.progress.state)+
  '. Unstarted steps and existing unresolved requests retain their saved state. The original Workshare owns implementation fees, effort and commercial stages; the original Installation owns prospective acceptance, funding and actual purchases.\n\n'+
  'Load installation-input.json in Customer installations, preview against the original case and save through its existing writer. Carry source/flowable-workspace.ndjson, FLOWABLE_CUSTOMER_SOURCE.json and every selected file with the complete native case handover. FLOWABLE_SOURCE_SELECTION.json identifies that complete sidecar without substituting a digest for its bytes.\n\n'+
  'For a later edition use the existing Installation editor and same Installation ID. Reconcile the saved native operation after an uncertain process/case/decision response. An archive import does not start another engine operation.\n\n';
 return {prepared,derivedBindings:chosen,source:annex,sourceMarkdown:markdown,workorder:renderWorkorder(prepared),
  commercial,commercialMarkdown:commercialMarkdown(commercial),commercialHtml:commercialHtml(commercial)};
}
