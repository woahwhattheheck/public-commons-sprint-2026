// Continue the original reviewed Crossref operation in the current retained Research history.
import {readFile,mkdir,open,link,unlink,readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
const input=JSON.parse(await readFile(process.argv[2],'utf8'));
const need=(v,m)=>{if(!v)throw new Error(m);};
const hash=b=>createHash('sha256').update(b).digest('hex');
need(input.schema==='sf88.research-client.original-receiving-input.v1','Use the original receiving input.');
for(const field of ['sourceRoot','directory','portableFile','companionDirectory','sourceState','outputDirectory'])
 need(typeof input[field]==='string'&&resolve(input[field])===input[field],'Use the selected absolute '+field+'.');
need(/^[a-f0-9]{64}$/.test(input.portableSha256)&&/^[a-f0-9]{64}$/.test(input.originalRevisionSha256),'Keep the verified original source identities.');
const base=join(input.sourceRoot,'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers');
const {openDossierStore}=await import(pathToFileURL(join(base,'dossier.mjs')));
const {validateCrossrefEdition}=await import(pathToFileURL(join(base,'crossref.mjs')));
const {jsonBytes}=await import(pathToFileURL(join(base,'../node/store.mjs')));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function fileHash(path){const h=createHash('sha256');let bytes=0;for await(const part of createReadStream(path)){bytes+=part.length;h.update(part);}return {bytes,sha256:h.digest('hex')};}
async function retain(path,bytes){
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 try{const current=await readFile(path);need(current.equals(bytes),'A different retained file owns '+path);return;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const tmp=path+'.receiving-'+randomUUID();let f;
 try{f=await open(tmp,'wx',0o600);await f.writeFile(bytes);await f.sync();await f.close();f=null;await link(tmp,path);}
 catch(error){if(error.code!=='EEXIST')throw error;need((await readFile(path)).equals(bytes),'A concurrent receiving file differs.');}
 finally{await f?.close();await unlink(tmp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
await mkdir(input.outputDirectory,{recursive:true,mode:0o700});
const portable=await fileHash(input.portableFile);
need(portable.sha256===input.portableSha256&&portable.bytes===input.portableBytes,'The original current-master portable bytes differ.');
const sourceRaw=await readFile(join(input.companionDirectory,'reviewed-edition.json'));
need(hash(sourceRaw)===input.reviewedEditionSha256&&sourceRaw.length===input.reviewedEditionBytes,'The original reviewed edition differs.');
const envelope=JSON.parse(sourceRaw.toString('utf8'));validateCrossrefEdition(envelope);
const operations=[];
for(const name of (await readdir(join(input.companionDirectory,'operations'))).sort()){
 need(/^cr_[a-f0-9]{64}$/.test(name),'The original operation folder differs.');
 const root=join(input.companionDirectory,'operations',name),planRaw=await readFile(join(root,'plan.json')),stateRaw=await readFile(join(root,'state.json'));
 const plan=JSON.parse(planRaw),state=JSON.parse(stateRaw);
 need(plan.id===name&&state.id===name&&state.phase==='IMPORTED'&&state.editionSha256===input.reviewedEditionSha256,'Select the completed original reviewed operation.');
 need(plan.request.dossierId===input.dossierId&&plan.request.questionId===input.questionId&&plan.payload.question===input.questionText,'Original case/question binding differs.');
 need(hash(jsonBytes(plan.payload))===plan.sha256&&same(plan.request,plan.payload.request),'The original plan identity differs.');
 const captures=[];
 for(const file of (await readdir(join(root,'captures'))).sort()){
  need(/^[a-f0-9]{64}\.json$/.test(file),'The original capture reference name differs.');
  const raw=await readFile(join(root,'captures',file)),ref=JSON.parse(raw);
  need(/^[a-f0-9]{64}$/.test(ref.captureId),'The original source capture identity differs.');
  const body=await readFile(join(input.companionDirectory,'source-captures',ref.captureId+'.json'));
  need(hash(body)===ref.captureId,'The original source capture bytes differ.');
  const capture=JSON.parse(body);
  need(capture.url===ref.url&&capture.status===ref.status&&capture.bodySha256===ref.bodySha256,'The original source/capture reference differs.');
  captures.push({file,raw,captureId:ref.captureId,body});
 }
 need(captures.length===state.responses,'The original capture set is incomplete.');
 operations.push({name,plan,planRaw,state,stateRaw,captures});
}
const selected=operations.find(x=>x.name===input.crossrefOperationId);
need(selected,'The selected original operation is absent.');
const store=await openDossierStore(input.directory);
let before;
try{before=await store.getMetadata(input.dossierId);}
catch(error){
 if(!['DOSSIER_NOT_FOUND','ENOENT'].includes(error.code))throw error;
 await store.reopenStream(createReadStream(input.portableFile),{projection:'metadata'});
 before=await store.getMetadata(input.dossierId);
}
need(before.revision>=input.originalRevision,'The receiving history predates the original current master.');
const original=await store.getMetadata(input.dossierId,{revision:input.originalRevision});
const originalHistory=await store.listRevisions(input.dossierId,{revision:input.originalRevision});
need(originalHistory.at(-1)?.revision===input.originalRevision&&originalHistory.at(-1).sha256===input.originalRevisionSha256,'The selected original revision differs.');
need(original.editions.length===input.originalEditionCount&&original.findings.length===input.originalFindingCount,'The original retained review is incomplete.');
need(before.questions.find(x=>x.id===input.questionId)?.text===input.questionText,'The original current question changed.');
for(const operation of operations){
 const destination=join(input.directory,'crossref/operations',operation.name);
 await retain(join(destination,'plan.json'),operation.planRaw);await retain(join(destination,'state.json'),operation.stateRaw);
 await retain(join(destination,'edition.json'),sourceRaw);
 for(const capture of operation.captures){
  await retain(join(destination,'captures',capture.file),capture.raw);
  await retain(join(input.sourceState,'captures',capture.captureId+'.json'),capture.body);
 }
}
let adopted=false,prior=before;
for(let attempt=0;attempt<3;attempt++){
 before=await store.getMetadata(input.dossierId);
 if(before.editions.some(x=>x.questionId===input.questionId&&x.raw?.sha256===input.reviewedEditionSha256))break;
 try{
  const received=await store.receive(input.dossierId,{
   questionId:input.questionId,label:selected.plan.request.label,provider:'crossref',rawBytes:sourceRaw,
   sourceReference:selected.plan.payload.sourceTerms,expectedRevision:before.revision,projection:'metadata',
   origin:{mode:'CROSSREF_RESEARCH_WORKSPACE',operationId:selected.name,planSha256:selected.plan.sha256}
  });
  need(received.editions.length===before.editions.length+1&&same(received.selections,before.selections)&&same(received.findings,before.findings),
   'The retained review decisions changed during source receiving.');
  prior=before;adopted=true;break;
 }catch(error){if(error.code!=='REVISION_CONFLICT')throw error;}
}
const after=await store.getMetadata(input.dossierId);
const edition=after.editions.find(x=>x.questionId===input.questionId&&x.raw?.sha256===input.reviewedEditionSha256);
need(edition,'The original reviewed edition was not received.');
const report={schema:'sf88.research-client.original-receiving-result.v1',operationId:input.operationId,
 sourceMerge:input.sourceMerge,dossierId:input.dossierId,questionId:input.questionId,
 originalRevision:input.originalRevision,originalRevisionSha256:input.originalRevisionSha256,
 adopted,receivingBeforeRevision:prior.revision,revision:after.revision,editions:after.editions.length,
 selections:after.selections.length,findings:after.findings.length,editionId:edition.id,
 sourceSha256:input.reviewedEditionSha256,sourceBytes:sourceRaw.length,
 originalCrossrefOperations:operations.map(x=>({id:x.name,planSha256:x.plan.sha256,phase:x.state.phase,
  captures:x.captures.length,originalReceipt:x.state.received})),completedAt:new Date().toISOString()};
const reportFile=join(input.outputDirectory,'original-receiving-result.json');
let previous=null;try{previous=JSON.parse(await readFile(reportFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(previous){need(previous.operationId===input.operationId&&previous.sourceSha256===report.sourceSha256,'The existing receiving result belongs to another operation.');}
else await retain(reportFile,Buffer.from(JSON.stringify(report,null,2)+'\n'));
process.stdout.write(JSON.stringify({...report,report:reportFile})+'\n');
