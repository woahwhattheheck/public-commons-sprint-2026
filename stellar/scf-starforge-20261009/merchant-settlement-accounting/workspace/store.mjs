// MIT. Retained operator work over the original merchant accounting engine.
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,readdir,rename,rm} from 'node:fs/promises';
import {basename,isAbsolute,join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {compileTerms,indexOriginalVerifications,runOriginalAccounting} from '../reconcile.mjs';
import {writeOriginalAccountingPack} from '../cli.mjs';
import {acquireStateLease} from '../../merchant-fleet-gateway/state-lease.mjs';

const SCHEMA='stellar-forge.merchant-accounting-workspace.v1';
const now=()=>new Date().toISOString();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const identity=()=>randomUUID();
const idPattern=/^[0-9a-f-]{36}$/;
const EXPORTED_FILES=['report.json','ledger.csv','options.csv','exceptions.csv','review.html','manifest.json'];
const STATES=new Set(['open','investigating','reviewed']);
const RECOVERY_RESPONSE_LIMIT=64*1024*1024;
const INPUT_MANIFEST_LIMIT=16_000_000;
const recoveryApi=()=>import('../recovery.mjs');
const recoverySummary=entry=>({...entry.data,entrySha256:entry.fileDigest,verification:{
  verdict:entry.proof.data.verdict,source:entry.proof.data.source,network:entry.proof.data.network,
  rpcEndpoint:entry.proof.data.rpcEndpoint,ledger:entry.proof.data.ledger,matchingEventId:entry.proof.data.matchingEventId}});

export class WorkspaceError extends Error {
  constructor(code,message,status=400){super(message);this.code=code;this.status=status;}
}
const check=(ok,code,message,status=400)=>{if(!ok)throw new WorkspaceError(code,message,status);};
function text(value,label,max=1000,empty=false){check(typeof value==='string','INVALID_FIELD',label+' must be text.');value=value.trim();check((empty||value.length)&&value.length<=max,'INVALID_FIELD','Check '+label+'.');return value;}
function object(value){return value&&typeof value==='object'&&!Array.isArray(value);}
function absolute(path){check(typeof path==='string'&&isAbsolute(path)&&path===resolve(path)&&path!=='/','ABSOLUTE_PATH_REQUIRED','Use an absolute normalized private path.');return path;}
async function privateDir(path,{create=false}={}){
  absolute(path);
  if(create)await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);
  check(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077),'PRIVATE_DIRECTORY_REQUIRED','Use a private directory with mode 0700: '+path);
}
async function recoveredDirectory(directory,sources,path){
  absolute(path);
  for(const other of [directory,sources.outboxDir,sources.proofDir])
    check(path!==other&&!path.startsWith(other+'/')&&!other.startsWith(path+'/'),'OVERLAPPING_DIRECTORIES','Keep the recovered collection separate from the workspace and original native input directories.');
  await privateDir(path,{create:true});
}

// Read one fixed prefix through an open descriptor. Native journals may append
// while we read; those later bytes belong to a subsequent reconciliation.
async function readBytes(path,max,{optional=false,empty=false}={}){
  let handle;
  try{handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));}
  catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
  try{
    const info=await handle.stat();
    check(info.isFile()&&info.size<=max&&(empty||info.size>0),'INVALID_SOURCE_FILE','Source must be a regular file within its size limit.');
    const bytes=Buffer.alloc(info.size);let offset=0;
    while(offset<bytes.length){const result=await handle.read(bytes,offset,bytes.length-offset,offset);check(result.bytesRead>0,'SOURCE_CHANGED','The source was truncated while being captured.');offset+=result.bytesRead;}
    return bytes;
  }finally{await handle.close();}
}
async function writeNew(path,bytes){
  const file=await open(path,'wx',0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
}
async function durableJson(path,value){
  const stage=path+'.'+identity()+'.pending';
  try{await writeNew(stage,json(value));await rename(stage,path);const directory=await open(resolve(path,'..'),'r');try{await directory.sync();}finally{await directory.close();}}
  finally{await rm(stage,{force:true});}
}
function parse(bytes,label){try{return JSON.parse(bytes.toString('utf8'));}catch{throw new WorkspaceError('INVALID_JSON','The '+label+' is not valid JSON.');}}
function proofDescription(bytes){
  const data=parse(bytes,'verification file'),digest=hash(bytes);
  const result=indexOriginalVerifications([{data,fileDigest:digest}]);
  return {sha256:digest,bytes:bytes.length,schema:data?.schema??null,verdict:data?.verdict??null,
    eligibility:result.ignored[0]?.reason??'ORIGINAL_OFFICIAL_FIELDS_ACCEPTED'};
}
const exceptionId=row=>hash(row.eventId+'\n'+row.reason);
const noteFor=(state,row)=>state.notes[exceptionId(row)]??{status:'open',note:'',assignee:'',actor:'',version:0,updatedAt:null};

export async function openAccountingWorkspace({directory,outboxDir,proofDir,termsFile,recoveredDir}){
  await privateDir(directory,{create:true});
  const lease=await acquireStateLease(directory);
  try{
    const statePath=join(directory,'workspace.json');
    const existing=await readBytes(statePath,32_000_000,{optional:true});
    let state;
    if(existing){
      state=parse(existing,'workspace');
      check(state.schema===SCHEMA&&Number.isSafeInteger(state.revision)&&object(state.sources)&&Array.isArray(state.runs)&&Array.isArray(state.proofs)&&object(state.notes),'INVALID_WORKSPACE','This directory is not a supported accounting workspace.');
      for(const [name,value] of Object.entries({outboxDir,proofDir,termsFile}))if(value!==undefined)check(value===state.sources[name],'SOURCE_CONFIGURATION_CHANGED','Reopen this workspace with its original source paths, or use a new directory.');
    }else{
      for(const path of [outboxDir,proofDir,termsFile])absolute(path);
      for(const path of [outboxDir,proofDir])check(directory!==path&&!directory.startsWith(path+'/')&&!path.startsWith(directory+'/'),'OVERLAPPING_DIRECTORIES','Keep the workspace separate from its native input directories.');
      check(!termsFile.startsWith(directory+'/'),'OVERLAPPING_DIRECTORIES','Keep the original terms file outside the workspace.');
      await privateDir(outboxDir);await privateDir(proofDir);
      compileTerms(parse(await readBytes(termsFile,200_000),'merchant terms'));
      state={schema:SCHEMA,revision:1,createdAt:now(),sources:{outboxDir,proofDir,termsFile},termsSelection:'source',termsImports:[],proofs:[],runs:[],notes:{},exports:[],history:[]};
    }
    let upgraded=false;
    for(const name of ['recoveredEntries','recoveryPreviews','recoveryJobs'])if(!Array.isArray(state[name])){state[name]=[];upgraded=true;}
    if(state.recoveryCapturedAt===undefined){state.recoveryCapturedAt=null;upgraded=true;}
    if(recoveredDir!==undefined&&recoveredDir!==state.sources.recoveredDir){
      await recoveredDirectory(directory,state.sources,recoveredDir);
      const {readRecoveredSettlements}=await recoveryApi(),collection=await readRecoveredSettlements(recoveredDir);
      state.sources.recoveredDir=recoveredDir;state.recoveredEntries=collection.entries.map(recoverySummary);state.recoveryCapturedAt=now();
      state.revision++;state.history.push({at:now(),actor:'workspace startup',action:'recovered_source_connected',directory:recoveredDir,entries:collection.entries.length});upgraded=true;
    }
    for(const part of ['inputs','runs','exports'])await privateDir(join(directory,part),{create:true});
    const interrupted=state.runs.filter(run=>['queued','running'].includes(run.status));
    for(const run of interrupted){run.status='interrupted';run.error='The process stopped before this reconciliation finished. Retained input and earlier completed runs remain available.';run.completedAt=now();}
    if(interrupted.length){state.revision++;state.history.push({at:now(),actor:'workspace',action:'runs_interrupted',runIds:interrupted.map(run=>run.id)});}
    const interruptedJobs=state.recoveryJobs.filter(job=>['queued','running'].includes(job.status));
    for(const job of interruptedJobs){job.status='interrupted';job.completedAt=now();job.error='The process stopped during original transfer verification/import. Retry the retained review to recover an already imported entry or continue its original read-only verification.';}
    if(interruptedJobs.length){state.revision++;state.history.push({at:now(),actor:'workspace',action:'recovery_imports_interrupted',jobIds:interruptedJobs.map(job=>job.id)});}
    if(!existing||upgraded||interrupted.length||interruptedJobs.length)await durableJson(statePath,state);
    return new AccountingWorkspace(directory,state,lease);
  }catch(error){await lease.close();throw error;}
}

class AccountingWorkspace{
  constructor(directory,state,lease){this.directory=directory;this.state=state;this.lease=lease;this.tail=Promise.resolve();this.tasks=new Set();this.cache=new Map();this.recoveryControllers=new Map();this.closing=false;this.closed=false;}
  async serial(work){check(!this.closed,'CLOSING','The workspace is closing.',503);const result=this.tail.then(async()=>{this.lease.assertHeld();const previous=structuredClone(this.state);try{return await work();}catch(error){this.state=previous;throw error;}});this.tail=result.catch(()=>{});return result;}
  async commit(action,actor,details={}){this.state.revision++;this.state.history.push({at:now(),actor,action,...details});check(this.state.history.length<=100_000&&Buffer.byteLength(json(this.state))<=32_000_000,'HISTORY_LIMIT','Archive this workspace and start a new one before adding further operator history.');await durableJson(join(this.directory,'workspace.json'),this.state);}
  expected(revision){check(Number.isSafeInteger(revision)&&revision===this.state.revision,'STALE_WORKSPACE','Saved workspace state changed. Refresh it before reapplying your retained draft.',409);}
  runRow(id){check(typeof id==='string'&&idPattern.test(id),'INVALID_RUN','Choose an existing reconciliation.');const run=this.state.runs.find(item=>item.id===id);check(run,'RUN_NOT_FOUND','This reconciliation was not found.',404);return run;}
  runPath(id){this.runRow(id);return join(this.directory,'runs',id);}
  async report(id){const run=this.runRow(id);check(run.status==='complete','RUN_NOT_COMPLETE','Wait for a completed reconciliation.',409);if(this.cache.has(id))return this.cache.get(id);const bytes=await readBytes(join(this.runPath(id),'report','report.json'),128_000_000);check(hash(bytes)===run.reportSha256,'REPORT_CHANGED','The retained reconciliation report changed.',409);const report=parse(bytes,'retained report');if(this.cache.size>=3)this.cache.delete(this.cache.keys().next().value);this.cache.set(id,report);return report;}
  view(){
    this.lease.assertHeld();
    return structuredClone({schema:SCHEMA,revision:this.state.revision,sources:this.state.sources,termsSelection:this.state.termsSelection,termsImports:this.state.termsImports,
      proofs:this.state.proofs,runs:this.state.runs,exports:this.state.exports,history:this.state.history.slice(-100).reverse(),
      recovery:{directory:this.state.sources.recoveredDir??null,capturedAt:this.state.recoveryCapturedAt,entries:this.state.recoveredEntries},
      recoveryPreviews:this.state.recoveryPreviews,recoveryJobs:this.state.recoveryJobs,
      reviewCounts:Object.values(this.state.notes).reduce((result,note)=>{result[note.status]++;return result;},{open:0,investigating:0,reviewed:0})});
  }
  async connectRecovered({revision,directory,actor}){return this.serial(async()=>{
    this.expected(revision);actor=text(actor,'operator');
    if(directory===null){delete this.state.sources.recoveredDir;this.state.recoveredEntries=[];this.state.recoveryCapturedAt=null;await this.commit('recovered_source_disconnected',actor);return this.view();}
    await recoveredDirectory(this.directory,this.state.sources,directory);
    const {readRecoveredSettlements}=await recoveryApi(),collection=await readRecoveredSettlements(directory);
    this.state.sources.recoveredDir=directory;this.state.recoveredEntries=collection.entries.map(recoverySummary);this.state.recoveryCapturedAt=now();
    await this.commit('recovered_source_connected',actor,{directory,entries:collection.entries.length});return this.view();
  });}
  async refreshRecovered({revision,actor}){return this.serial(async()=>{
    this.expected(revision);actor=text(actor,'operator');const directory=this.state.sources.recoveredDir;
    check(directory,'RECOVERED_SOURCE_REQUIRED','Connect the original recovered collection first.');
    const {readRecoveredSettlements}=await recoveryApi(),collection=await readRecoveredSettlements(directory);
    this.state.recoveredEntries=collection.entries.map(recoverySummary);this.state.recoveryCapturedAt=now();
    await this.commit('recovered_source_refreshed',actor,{directory,entries:collection.entries.length});return this.view();
  });}
  async reviewRecovery({revision,name,content,actor}){return this.serial(async()=>{
    this.expected(revision);actor=text(actor,'operator');name=text(name,'review name',160);
    check(typeof content==='string'&&Buffer.byteLength(content)<=200_000,'RECOVERY_CONFIG_TOO_LARGE','Select an original merchant recovery request JSON up to 200 KB.');
    check(this.state.recoveryPreviews.length<2000,'RECOVERY_REVIEW_LIMIT','This workspace retains 2,000 original recovery reviews.');
    const bytes=Buffer.from(content),id=identity(),path=join(this.directory,'inputs',id+'.recovery.json');parse(bytes,'original recovery request');
    await writeNew(path,bytes);
    let review;try{const {reviewRecoveredSettlement}=await recoveryApi();review=await reviewRecoveredSettlement({configFile:path});}
    catch(error){await rm(path,{force:true});throw error;}
    const preview={id,name,createdAt:now(),actor,configSha256:hash(bytes),review};
    this.state.recoveryPreviews.unshift(preview);await this.commit('recovery_sources_reviewed',actor,{previewId:id,recoveryId:review.recoveryId,configSha256:preview.configSha256});
    return {preview,state:this.view()};
  });}
  async importRecovery({revision,previewId,actor}){return this.serial(async()=>{
    this.expected(revision);actor=text(actor,'operator');const preview=this.state.recoveryPreviews.find(item=>item.id===previewId);
    check(preview,'RECOVERY_REVIEW_NOT_FOUND','Review the original recovery request first.');
    const recoveredDir=this.state.sources.recoveredDir;check(recoveredDir,'RECOVERED_SOURCE_REQUIRED','Connect the original recovered collection first.');
    check(!this.state.recoveryJobs.some(job=>['queued','running'].includes(job.status)),'RECOVERY_IMPORT_IN_PROGRESS','The original verifier is processing an import. Its retained progress is shown below.',409);
    check(this.state.recoveryJobs.length<5000,'RECOVERY_JOB_LIMIT','This workspace retains 5,000 recovery import attempts.');
    const job={id:identity(),previewId,name:preview.name,actor,recoveredDir,status:'queued',createdAt:now(),sourceRevision:this.state.revision,error:null};
    this.state.recoveryJobs.unshift(job);await this.commit('recovery_import_queued',actor,{jobId:job.id,previewId,recoveryId:preview.review.recoveryId,recoveredDir});
    const task=new Promise(resolve=>setImmediate(resolve)).then(()=>this.executeRecovery(job.id));this.tasks.add(task);task.finally(()=>this.tasks.delete(task)).catch(()=>{});
    return {job:structuredClone(job),state:this.view()};
  });}
  recoveryJob(id){const job=this.state.recoveryJobs.find(item=>item.id===id);check(job,'RECOVERY_JOB_NOT_FOUND','This original recovery import attempt was not found.',404);return job;}
  async executeRecovery(id){
    const controller=new AbortController();this.recoveryControllers.set(id,controller);
    try{
      await this.serial(async()=>{const job=this.recoveryJob(id);if(job.cancelRequested||this.closing)controller.abort();controller.signal.throwIfAborted();job.status='running';job.startedAt=now();await this.commit('recovery_import_started',job.actor,{jobId:id});});
      const job=structuredClone(this.recoveryJob(id)),preview=this.state.recoveryPreviews.find(item=>item.id===job.previewId),path=join(this.directory,'inputs',preview.id+'.recovery.json');
      const bytes=await readBytes(path,200_000);check(hash(bytes)===preview.configSha256,'RECOVERY_CONFIG_CHANGED','The retained recovery request changed. Review the original file again.',409);
      const {reviewRecoveredSettlement,importRecoveredSettlement}=await recoveryApi(),review=await reviewRecoveredSettlement({configFile:path});
      check(hash(json(review))===hash(json(preview.review)),'RECOVERY_SOURCES_CHANGED','The original source files changed after review. Import the request again to review their current binding.',409);
      const result=await importRecoveredSettlement({configFile:path,recoveredDir:job.recoveredDir,signal:controller.signal});
      await this.serial(async()=>{const current=this.recoveryJob(id);current.status='complete';current.completedAt=now();current.result={status:result.status,recoveryId:result.data.recoveryId,entrySha256:result.fileDigest,verdict:result.proof.data.verdict};
        if(this.state.sources.recoveredDir===job.recoveredDir){const summary=recoverySummary(result),index=this.state.recoveredEntries.findIndex(item=>item.recoveryId===summary.recoveryId);if(index<0)this.state.recoveredEntries.push(summary);else this.state.recoveredEntries[index]=summary;this.state.recoveryCapturedAt=now();}
        await this.commit('recovery_import_completed',current.actor,{jobId:id,recoveredDir:job.recoveredDir,...current.result});});
    }catch(error){
      await this.serial(async()=>{const job=this.recoveryJob(id);job.status=controller.signal.aborted?(job.cancelRequested?'cancelled':'interrupted'):'failed';job.completedAt=now();job.error=controller.signal.aborted?'Original read-only verification stopped. Retry reuses any completed native import.':String(error.message||error).slice(0,2000);await this.commit('recovery_import_'+job.status,job.actor,{jobId:id,error:job.error});});
    }finally{this.recoveryControllers.delete(id);}
  }
  async cancelRecovery(id,{actor}){return this.serial(async()=>{
    actor=text(actor,'operator');const job=this.recoveryJob(id);
    if(['queued','running'].includes(job.status)){job.cancelRequested=true;this.recoveryControllers.get(id)?.abort();await this.commit('recovery_import_cancel_requested',actor,{jobId:id});}
    return this.view();
  });}
  async importProof({revision,name,content,actor}){return this.serial(async()=>{
    this.expected(revision);actor=text(actor,'operator');name=text(name,'filename',150);
    check(typeof content==='string'&&Buffer.byteLength(content)<=80_000,'PROOF_TOO_LARGE','Select an original SF86 JSON result up to 80 KB.');
    const bytes=Buffer.from(content),data=parse(bytes,'verification file');
    check(data?.schema==='stellar-forge.sf86.rpc-reconciliation.v1','ORIGINAL_VERIFICATION_REQUIRED','Select the original SF86 reconciliation JSON result.');
    const description=proofDescription(bytes),prior=this.state.proofs.find(item=>item.sha256===description.sha256);
    if(prior)return {proof:prior,duplicate:true,state:this.view()};
    check(this.state.proofs.length<2000,'PROOF_LIMIT','The workspace already retains 2,000 imported verification files.');
    const record={id:identity(),name,createdAt:now(),actor,included:true,...description};
    await writeNew(join(this.directory,'inputs',record.id+'.proof.json'),bytes);
    this.state.proofs.push(record);await this.commit('proof_imported',actor,{proofId:record.id,name,sha256:record.sha256});
    return {proof:record,duplicate:false,state:this.view()};
  });}
  async selectProof(id,{revision,included,actor}){return this.serial(async()=>{
    this.expected(revision);actor=text(actor,'operator');check(typeof included==='boolean','INVALID_SELECTION','Choose whether to include this verification file.');
    const proof=this.state.proofs.find(item=>item.id===id);check(proof,'PROOF_NOT_FOUND','This imported verification file was not found.',404);
    if(proof.included!==included){proof.included=included;await this.commit('proof_selection_changed',actor,{proofId:id,included});}
    return this.view();
  });}
  async importTerms({revision,name,content,actor}){return this.serial(async()=>{
    this.expected(revision);actor=text(actor,'operator');name=text(name,'filename',150);
    check(typeof content==='string'&&Buffer.byteLength(content)<=200_000,'TERMS_TOO_LARGE','Select merchant accounting terms up to 200 KB.');
    const bytes=Buffer.from(content),data=parse(bytes,'merchant terms'),compiled=compileTerms(data),sha256=hash(bytes);
    let record=this.state.termsImports.find(item=>item.sha256===sha256);
    if(!record){record={id:identity(),name,sha256,bytes:bytes.length,options:compiled.size,createdAt:now(),actor};await writeNew(join(this.directory,'inputs',record.id+'.terms.json'),bytes);this.state.termsImports.push(record);}
    this.state.termsSelection=record.id;await this.commit('terms_selected',actor,{termsId:record.id,sha256});return this.view();
  });}
  async selectTerms({revision,selection,actor}){return this.serial(async()=>{
    this.expected(revision);actor=text(actor,'operator');check(selection==='source'||this.state.termsImports.some(item=>item.id===selection),'TERMS_NOT_FOUND','Choose original source terms or a retained terms file.');
    this.state.termsSelection=selection;await this.commit('terms_selected',actor,{termsId:selection});return this.view();
  });}
  async begin({revision,name,actor}){return this.serial(async()=>{
    this.expected(revision);actor=text(actor,'operator');name=text(name,'run name',160);
    check(!this.state.runs.some(run=>['queued','running'].includes(run.status)),'RUN_IN_PROGRESS','A reconciliation is already queued or running.',409);
    check(this.state.runs.length<5000,'RUN_LIMIT','This workspace already retains 5,000 reconciliations.');
    const run={id:identity(),name,actor,status:'queued',createdAt:now(),sourceRevision:this.state.revision,termsSelection:this.state.termsSelection,
      sourcePaths:structuredClone(this.state.sources),proofIds:this.state.proofs.filter(proof=>proof.included).map(proof=>proof.id),totals:null,exceptionCount:0,error:null};
    this.state.runs.unshift(run);await this.commit('reconciliation_queued',actor,{runId:run.id});
    const task=new Promise(resolve=>setImmediate(resolve)).then(()=>this.execute(run.id));this.tasks.add(task);task.finally(()=>this.tasks.delete(task)).catch(()=>{});
    return {run:structuredClone(run),state:this.view()};
  });}
  async capture(run){
    const root=this.runPath(run.id),sources=join(root,'sources'),outbox=join(sources,'outbox'),proofs=join(sources,'proofs');
    const sourcePaths=run.sourcePaths??this.state.sources;
    await privateDir(root,{create:true});await privateDir(sources,{create:true});await privateDir(outbox,{create:true});await privateDir(proofs,{create:true});
    const manifest={schema:'stellar-forge.merchant-accounting-inputs.v1',capturedAt:now(),journalOrder:'delivery-prefix-before-event-prefix',files:[],proofs:[],recovered:[],recoveredSource:!!sourcePaths.recoveredDir};
    // Delivery records refer to already appended native events. Capturing their
    // completed prefix first prevents newer statuses from orphaning older events.
    for(const name of ['deliveries.ndjson','events.ndjson']){
      const raw=await readBytes(join(sourcePaths.outboxDir,name),16_000_000,{optional:true,empty:true});
      if(raw===null){manifest.files.push({source:'sf98/'+name,path:null,bytes:0,sha256:null});continue;}
      check(raw.length===0||raw.at(-1)===10,'INCOMPLETE_JOURNAL','A native journal ends with an incomplete append. Reconcile again after the producer finishes.',409);
      const path='sources/outbox/'+name;await writeNew(join(root,path),raw);manifest.files.push({source:'sf98/'+name,path,bytes:raw.length,sha256:hash(raw)});
    }
    const selected=this.state.termsImports.find(item=>item.id===run.termsSelection);
    const terms=await readBytes(selected?join(this.directory,'inputs',selected.id+'.terms.json'):sourcePaths.termsFile,200_000);
    if(selected)check(hash(terms)===selected.sha256,'TERMS_CHANGED','The retained merchant terms changed.',409);
    compileTerms(parse(terms,'merchant terms'));await writeNew(join(sources,'terms.json'),terms);
    manifest.files.push({source:selected?selected.name:basename(sourcePaths.termsFile),path:'sources/terms.json',bytes:terms.length,sha256:hash(terms)});
    const names=(await readdir(sourcePaths.proofDir)).sort();check(names.length+run.proofIds.length<=2000,'PROOF_LIMIT','The combined verification sources exceed 2,000 files.');
    const hashes=new Set();
    for(const [index,name] of names.entries()){
      check(/^[A-Za-z0-9._-]{1,150}\.json$/.test(name),'INVALID_PROOF_DIRECTORY','The original verification directory must contain only named JSON result files.');
      const raw=await readBytes(join(sourcePaths.proofDir,name),80_000),description=proofDescription(raw),path='sources/proofs/source-'+index+'.json';
      await writeNew(join(root,path),raw);hashes.add(description.sha256);manifest.files.push({source:name,path,...description});manifest.proofs.push({source:'original directory',name,path,...description});
    }
    for(const proofId of run.proofIds){
      const record=this.state.proofs.find(proof=>proof.id===proofId);check(record,'PROOF_NOT_FOUND','An included verification file was not retained.');
      const raw=await readBytes(join(this.directory,'inputs',proofId+'.proof.json'),80_000);check(hash(raw)===record.sha256,'PROOF_CHANGED','An imported verification file changed.',409);
      if(hashes.has(record.sha256)){manifest.proofs.push({source:'import',name:record.name,...record,path:null,duplicateOfOriginal:true});continue;}
      const path='sources/proofs/import-'+proofId+'.json';await writeNew(join(root,path),raw);hashes.add(record.sha256);
      manifest.files.push({source:record.name,path,bytes:record.bytes,sha256:record.sha256});manifest.proofs.push({source:'import',name:record.name,path,...proofDescription(raw)});
    }
    let recoveredDir;
    if(sourcePaths.recoveredDir){
      const {readRecoveredSettlements}=await recoveryApi(),collection=await readRecoveredSettlements(sourcePaths.recoveredDir);
      recoveredDir=join(sources,'recovered');await privateDir(recoveredDir,{create:true});
      for(const entry of collection.entries){
        const data=entry.data,proof=entry.proof.data,id=data.recoveryId;
        check(/^[a-f0-9]{64}$/.test(id),'INVALID_RECOVERY_ID','The original recovered source returned an invalid entry identity.');
        await privateDir(join(recoveredDir,id),{create:true});
        const descriptors={'entry.json':{sha256:entry.fileDigest},...data.sources};
        for(const [name,descriptor] of Object.entries(descriptors)){
          check(['entry.json','outcome.json','request.json','terms.json','proof.json','response.bin'].includes(name),'INVALID_RECOVERY_FILE','The original recovered source returned an unsupported retained file.');
          const raw=await readBytes(join(sourcePaths.recoveredDir,id,name),name==='response.bin'?RECOVERY_RESPONSE_LIMIT:200_000,{empty:name==='response.bin'});
          check(hash(raw)===descriptor.sha256&&(descriptor.bytes===undefined||raw.length===descriptor.bytes),'RECOVERY_SOURCE_CHANGED','An original recovered source changed while being captured. Reconcile current sources again.',409);
          const path='sources/recovered/'+id+'/'+name;await writeNew(join(root,path),raw);
          manifest.files.push({source:'recovered/'+id+'/'+name,path,bytes:raw.length,sha256:descriptor.sha256});
        }
        // The default report handoff retains source identities, not raw wallets,
        // resource URLs or response bytes. Source-inclusive archives keep originals.
        manifest.recovered.push({recoveryId:id,origin:data.origin,routeId:data.routeId,method:data.method,network:data.network,
          amountAtomic:data.amountAtomic,optionId:data.optionId,entrySha256:entry.fileDigest,receiptFingerprint:data.receiptFingerprint,
          transactionFingerprint:hash(data.transaction),assetDigest:hash(data.asset),recipientDigest:hash(data.recipient),payerDigest:hash(data.payer),
          reservation:data.reservation,outbox:data.outbox,sourceBinding:data.sourceBinding,response:data.response,
          verification:{verdict:proof.verdict,source:proof.source,network:proof.network,ledger:proof.ledger}});
      }
    }
    check(Buffer.byteLength(json(manifest))<=INPUT_MANIFEST_LIMIT,'INPUT_MANIFEST_LIMIT','The retained source manifest exceeds 16 MB. Select a smaller original recovered collection.');
    await writeNew(join(root,'input-manifest.json'),json(manifest));
    return {manifest,outboxDir:outbox,proofDir:proofs,termsFile:join(sources,'terms.json'),...(recoveredDir?{recoveredDir}:{})};
  }
  async execute(id){
    try{
      await this.serial(async()=>{const run=this.runRow(id);run.status='running';run.startedAt=now();await this.commit('reconciliation_started',run.actor,{runId:id});});
      const run=structuredClone(this.runRow(id)),capture=await this.capture(run);
      const report=await runOriginalAccounting(capture);
      const output=await writeOriginalAccountingPack(report,join(this.runPath(id),'report'));
      await this.serial(async()=>{const current=this.runRow(id);current.status='complete';current.completedAt=now();current.totals=report.totals;current.exceptionCount=report.exceptions.length;
        current.reportSha256=hash(json(report));current.manifestSha256=output.manifestSha256;current.inputManifestSha256=hash(json(capture.manifest));
        await this.commit('reconciliation_completed',current.actor,{runId:id,totals:current.totals,reportSha256:current.reportSha256});if(this.cache.size>=3)this.cache.delete(this.cache.keys().next().value);this.cache.set(id,report);});
    }catch(error){
      await this.serial(async()=>{const run=this.runRow(id);run.status='failed';run.completedAt=now();run.error=String(error.message||error).slice(0,2000);await this.commit('reconciliation_failed',run.actor,{runId:id,error:run.error});});
    }
  }
  async run(id){
    const run=this.runRow(id);if(run.status!=='complete')return {run};
    const report=await this.report(id),notes=report.exceptions.map(row=>noteFor(this.state,row));
    return {run,totals:report.totals,routes:report.routes,options:report.options,hashes:report.hashes,ignoredProofs:report.ignoredProofs,
      unmatchedOfficialProofCount:report.unmatchedOfficialProofCount,reviewCounts:notes.reduce((result,note)=>{result[note.status]++;return result;},{open:0,investigating:0,reviewed:0})};
  }
  async rows(id,kind,query={}){
    const report=await this.report(id);check(['ledger','options','exceptions','proofs','recovered'].includes(kind),'INVALID_VIEW','Choose a supported reconciliation view.');
    const offset=Number(query.offset??0),limit=Number(query.limit??50);check(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'INVALID_PAGE','Use a nonnegative offset and up to 200 rows.');
    let items;
    if(kind==='proofs'||kind==='recovered')items=(await this.inputManifest(id))[kind]??[];
    else items=report[kind];
    if(kind==='exceptions')items=items.map(row=>({...row,id:exceptionId(row),review:noteFor(this.state,row)}));
    for(const field of ['routeId','method','network','transfer','delivery'])if(query[field])items=items.filter(row=>row[field]===query[field]);
    if(query.review&&kind==='exceptions')items=items.filter(row=>row.review.status===query.review);
    if(query.search){const term=String(query.search).toLowerCase().slice(0,300);items=items.filter(row=>[row.eventId,row.recoveryId,row.origin,row.routeId,row.optionId,row.reason,row.name,row.sha256,row.entrySha256].some(value=>typeof value==='string'&&value.toLowerCase().includes(term)));}
    return {items:items.slice(offset,offset+limit),total:items.length,offset,limit};
  }
  async review(runId,exception,{version,status,note,assignee='',actor}){return this.serial(async()=>{
    actor=text(actor,'reviewer');note=text(note,'review note',4000);assignee=text(assignee,'assignee',160,true);check(STATES.has(status),'INVALID_REVIEW','Choose open, investigating, or reviewed.');
    const report=await this.report(runId),row=report.exceptions.find(row=>exceptionId(row)===exception);check(row,'EXCEPTION_NOT_FOUND','This exception was not found in the selected reconciliation.',404);
    const previous=noteFor(this.state,row);check(Number.isSafeInteger(version)&&version===previous.version,'STALE_REVIEW','This exception review changed. Refresh it before reapplying the retained note.',409);
    const review={status,note,assignee,actor,version:version+1,updatedAt:now(),eventId:row.eventId,reason:row.reason,runId};
    this.state.notes[exception]=review;await this.commit('exception_reviewed',actor,{runId,exceptionId:exception,previousStatus:previous.status,status,assignee,note});
    return {review,state:this.view()};
  });}
  async compare(id,baselineId,query={}){
    const current=await this.report(id),baseline=await this.report(baselineId),left=new Map(baseline.ledger.map(row=>[row.eventId,row])),right=new Map(current.ledger.map(row=>[row.eventId,row]));
    const changed=[],added=[],removed=[];
    for(const [eventId,row] of right){const previous=left.get(eventId);if(!previous){added.push(row);continue;}
      const fields=[...new Set([...Object.keys(previous),...Object.keys(row)])].filter(field=>field!=='eventId'&&JSON.stringify(row[field])!==JSON.stringify(previous[field]));
      if(fields.length)changed.push({eventId,routeId:row.routeId,fields,before:previous,after:row});}
    for(const [eventId,row] of left)if(!right.has(eventId))removed.push(row);
    const oldExceptions=new Set(baseline.exceptions.map(exceptionId)),newExceptions=new Set(current.exceptions.map(exceptionId));
    const oldOptions=new Map(baseline.options.map(option=>[option.optionId,option])),newOptions=new Map(current.options.map(option=>[option.optionId,option]));
    const options=[...new Set([...oldOptions.keys(),...newOptions.keys()])].map(optionId=>({optionId,before:oldOptions.get(optionId)??null,after:newOptions.get(optionId)??null}));
    const view=query.view??'changed',offset=Number(query.offset??0),limit=Number(query.limit??50),views={changed,added,removed,options};
    check(Object.hasOwn(views,view)&&Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'INVALID_COMPARISON_PAGE','Choose a comparison view and a valid page.');
    return {baseline:this.runRow(baselineId),current:this.runRow(id),summary:{addedEvents:added.length,removedEvents:removed.length,changedEvents:changed.length,
      resolvedExceptions:[...oldExceptions].filter(id=>!newExceptions.has(id)).length,newExceptions:[...newExceptions].filter(id=>!oldExceptions.has(id)).length},
      view,offset,limit,total:views[view].length,items:views[view].slice(offset,offset+limit)};
  }
  async exportRun(runId,{revision,actor,includeSources=false}){return this.serial(async()=>{
    this.expected(revision);actor=text(actor,'operator');check(typeof includeSources==='boolean','INVALID_EXPORT','Choose whether to include retained private source files.');
    const run=this.runRow(runId),report=await this.report(runId),id=identity(),folder=join(this.directory,'exports',id),archive=join(this.directory,'exports',id+'.tar');
    await privateDir(folder,{create:true});
    const root=this.runPath(runId);
    for(const name of EXPORTED_FILES){const raw=await this.reportFile(runId,name);await writeNew(join(folder,name),raw);}
    const notes=report.exceptions.map(row=>({...row,id:exceptionId(row),review:noteFor(this.state,row)}));
    await writeNew(join(folder,'review-notes.json'),json({schema:'stellar-forge.merchant-exception-review.v1',runId,workspaceRevision:this.state.revision,exportedAt:now(),actor,exceptions:notes}));
    const inputManifest=await readBytes(join(root,'input-manifest.json'),INPUT_MANIFEST_LIMIT);check(hash(inputManifest)===run.inputManifestSha256,'INPUT_MANIFEST_CHANGED','The retained source manifest changed.',409);
    await writeNew(join(folder,'input-manifest.json'),inputManifest);
    if(includeSources){
      await privateDir(join(folder,'sources','outbox'),{create:true});
      await privateDir(join(folder,'sources','proofs'),{create:true});
      const manifest=parse(inputManifest,'input manifest');
      if(manifest.recoveredSource)await privateDir(join(folder,'sources','recovered'),{create:true});
      for(const file of manifest.files){if(!file.path)continue;check(file.path.startsWith('sources/')&&!file.path.includes('..'),'INVALID_RETAINED_PATH','A retained source path is invalid.');const raw=await readBytes(join(root,file.path),file.path.endsWith('/response.bin')?RECOVERY_RESPONSE_LIMIT:16_000_000,{empty:true});check(hash(raw)===file.sha256&&raw.length===file.bytes,'SOURCE_SNAPSHOT_CHANGED','A retained input changed.',409);await privateDir(resolve(join(folder,file.path),'..'),{create:true});await writeNew(join(folder,file.path),raw);}
    }
    await writeNew(join(folder,'START.txt'),'Merchant settlement reconciliation\n\nOriginal accounting report/CSV/HTML and a snapshot of named operator exception notes. Review notes do not change native transfer classifications.\n'+(includeSources?'Includes private original journal, terms, verification files and any captured recovered entries with their retained response bytes. If sources/recovered is present, pass --recovered-dir /absolute/extracted/sources/recovered to the original accounting CLI when reproducing this report.\n':'Private original source bytes were not included.\n'));
    const handle=await open(archive,'wx',0o600);
    try{await new Promise((resolve,reject)=>{
      const child=spawn('tar',['-cf','-','-C',folder,'.'],{stdio:['ignore',handle.fd,'pipe']});let error='';child.stderr.on('data',chunk=>{if(error.length<4000)error+=chunk;});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Archive export failed: '+error)));});await handle.sync();}
    finally{await handle.close();}
    const raw=await readBytes(archive,256_000_000),record={id,runId,name:run.name,createdAt:now(),actor,includeSources,bytes:raw.length,sha256:hash(raw)};
    this.state.exports.unshift(record);await this.commit('review_exported',actor,{exportId:id,runId,includeSources,sha256:record.sha256});return {export:record,state:this.view()};
  });}
  async reportFile(runId,name){check(EXPORTED_FILES.includes(name),'INVALID_DOWNLOAD','Choose an original report file.');const run=this.runRow(runId);await this.report(runId);const root=join(this.runPath(runId),'report');const manifestBytes=await readBytes(join(root,'manifest.json'),1_000_000);check(hash(manifestBytes)===run.manifestSha256,'REPORT_MANIFEST_CHANGED','The original report manifest changed.',409);if(name==='manifest.json')return manifestBytes;const expected=parse(manifestBytes,'report manifest').outputs.find(file=>file.name===name),bytes=await readBytes(join(root,name),128_000_000);check(expected&&hash(bytes)===expected.sha256&&bytes.length===expected.bytes,'REPORT_FILE_CHANGED','The original report file changed.',409);return bytes;}
  async download(runId,name){return {bytes:await this.reportFile(runId,name),name};}
  async inputManifest(runId){const run=this.runRow(runId);await this.report(runId);const bytes=await readBytes(join(this.runPath(runId),'input-manifest.json'),INPUT_MANIFEST_LIMIT);check(hash(bytes)===run.inputManifestSha256,'INPUT_MANIFEST_CHANGED','The retained source manifest changed.',409);return parse(bytes,'input manifest');}
  async recoveredResponse(recoveryId,runId){
    check(typeof recoveryId==='string'&&/^[a-f0-9]{64}$/.test(recoveryId),'INVALID_RECOVERY_ID','Choose an original recovered entry.');
    const entries=runId?(await this.inputManifest(runId)).recovered??[]:this.state.recoveredEntries;
    const entry=entries.find(item=>item.recoveryId===recoveryId);
    check(entry,'RECOVERED_ENTRY_NOT_FOUND','This original recovered entry was not found in the selected source.',404);
    check(entry.response,'RECOVERED_RESPONSE_NOT_RETAINED','This original recovery has no retained response file.',404);
    const directory=runId?join(this.runPath(runId),'sources','recovered'):this.state.sources.recoveredDir;
    const bytes=await readBytes(join(directory,recoveryId,'entry.json'),200_000);
    check(hash(bytes)===entry.entrySha256,'RECOVERED_ENTRY_CHANGED','This original recovered entry changed. Refresh the source or select its retained reconciliation.',409);
    const {readRecoveredResponse}=await recoveryApi(),response=await readRecoveredResponse({recoveredDir:directory,recoveryId});
    check(hash(response.bytes)===entry.response.sha256&&response.bytes.length===entry.response.bytes,'RECOVERED_RESPONSE_CHANGED','The retained response changed.',409);
    const type=typeof response.contentType==='string'&&/^[\x20-\x7e]{1,200}$/.test(response.contentType)?response.contentType:'application/octet-stream';
    return {bytes:response.bytes,name:'recovered-response-'+recoveryId+'.bin',type};
  }
  async archive(id){check(typeof id==='string'&&idPattern.test(id),'INVALID_EXPORT','Choose an existing export.');const record=this.state.exports.find(item=>item.id===id);check(record,'EXPORT_NOT_FOUND','This review export was not found.',404);const bytes=await readBytes(join(this.directory,'exports',id+'.tar'),256_000_000);check(hash(bytes)===record.sha256,'EXPORT_CHANGED','The retained export changed.',409);return {bytes,name:'merchant-review-'+id+'.tar'};}
  async close(){this.closing=true;for(const controller of this.recoveryControllers.values())controller.abort();await Promise.allSettled([...this.tasks]);await this.tail;this.closed=true;await this.lease.close();}
}
