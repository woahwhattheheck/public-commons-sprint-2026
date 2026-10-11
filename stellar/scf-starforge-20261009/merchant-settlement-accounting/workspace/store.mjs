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

export async function openAccountingWorkspace({directory,outboxDir,proofDir,termsFile}){
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
    for(const part of ['inputs','runs','exports'])await privateDir(join(directory,part),{create:true});
    const interrupted=state.runs.filter(run=>['queued','running'].includes(run.status));
    for(const run of interrupted){run.status='interrupted';run.error='The process stopped before this reconciliation finished. Retained input and earlier completed runs remain available.';run.completedAt=now();}
    if(interrupted.length){state.revision++;state.history.push({at:now(),actor:'workspace',action:'runs_interrupted',runIds:interrupted.map(run=>run.id)});}
    if(!existing||interrupted.length)await durableJson(statePath,state);
    return new AccountingWorkspace(directory,state,lease);
  }catch(error){await lease.close();throw error;}
}

class AccountingWorkspace{
  constructor(directory,state,lease){this.directory=directory;this.state=state;this.lease=lease;this.tail=Promise.resolve();this.tasks=new Set();this.cache=new Map();this.closed=false;}
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
      reviewCounts:Object.values(this.state.notes).reduce((result,note)=>{result[note.status]++;return result;},{open:0,investigating:0,reviewed:0})});
  }
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
      proofIds:this.state.proofs.filter(proof=>proof.included).map(proof=>proof.id),totals:null,exceptionCount:0,error:null};
    this.state.runs.unshift(run);await this.commit('reconciliation_queued',actor,{runId:run.id});
    const task=new Promise(resolve=>setImmediate(resolve)).then(()=>this.execute(run.id));this.tasks.add(task);task.finally(()=>this.tasks.delete(task)).catch(()=>{});
    return {run:structuredClone(run),state:this.view()};
  });}
  async capture(run){
    const root=this.runPath(run.id),sources=join(root,'sources'),outbox=join(sources,'outbox'),proofs=join(sources,'proofs');
    await privateDir(root,{create:true});await privateDir(sources,{create:true});await privateDir(outbox,{create:true});await privateDir(proofs,{create:true});
    const manifest={schema:'stellar-forge.merchant-accounting-inputs.v1',capturedAt:now(),journalOrder:'delivery-prefix-before-event-prefix',files:[],proofs:[]};
    // Delivery records refer to already appended native events. Capturing their
    // completed prefix first prevents newer statuses from orphaning older events.
    for(const name of ['deliveries.ndjson','events.ndjson']){
      const raw=await readBytes(join(this.state.sources.outboxDir,name),16_000_000,{optional:true,empty:true});
      if(raw===null){manifest.files.push({source:'sf98/'+name,path:null,bytes:0,sha256:null});continue;}
      check(raw.length===0||raw.at(-1)===10,'INCOMPLETE_JOURNAL','A native journal ends with an incomplete append. Reconcile again after the producer finishes.',409);
      const path='sources/outbox/'+name;await writeNew(join(root,path),raw);manifest.files.push({source:'sf98/'+name,path,bytes:raw.length,sha256:hash(raw)});
    }
    const selected=this.state.termsImports.find(item=>item.id===run.termsSelection);
    const terms=await readBytes(selected?join(this.directory,'inputs',selected.id+'.terms.json'):this.state.sources.termsFile,200_000);
    if(selected)check(hash(terms)===selected.sha256,'TERMS_CHANGED','The retained merchant terms changed.',409);
    compileTerms(parse(terms,'merchant terms'));await writeNew(join(sources,'terms.json'),terms);
    manifest.files.push({source:selected?selected.name:basename(this.state.sources.termsFile),path:'sources/terms.json',bytes:terms.length,sha256:hash(terms)});
    const names=(await readdir(this.state.sources.proofDir)).sort();check(names.length+run.proofIds.length<=2000,'PROOF_LIMIT','The combined verification sources exceed 2,000 files.');
    const hashes=new Set();
    for(const [index,name] of names.entries()){
      check(/^[A-Za-z0-9._-]{1,150}\.json$/.test(name),'INVALID_PROOF_DIRECTORY','The original verification directory must contain only named JSON result files.');
      const raw=await readBytes(join(this.state.sources.proofDir,name),80_000),description=proofDescription(raw),path='sources/proofs/source-'+index+'.json';
      await writeNew(join(root,path),raw);hashes.add(description.sha256);manifest.files.push({source:name,path,...description});manifest.proofs.push({source:'original directory',name,path,...description});
    }
    for(const proofId of run.proofIds){
      const record=this.state.proofs.find(proof=>proof.id===proofId);check(record,'PROOF_NOT_FOUND','An included verification file was not retained.');
      const raw=await readBytes(join(this.directory,'inputs',proofId+'.proof.json'),80_000);check(hash(raw)===record.sha256,'PROOF_CHANGED','An imported verification file changed.',409);
      if(hashes.has(record.sha256)){manifest.proofs.push({source:'import',name:record.name,...record,path:null,duplicateOfOriginal:true});continue;}
      const path='sources/proofs/import-'+proofId+'.json';await writeNew(join(root,path),raw);hashes.add(record.sha256);
      manifest.files.push({source:record.name,path,bytes:record.bytes,sha256:record.sha256});manifest.proofs.push({source:'import',name:record.name,path,...proofDescription(raw)});
    }
    await writeNew(join(root,'input-manifest.json'),json(manifest));
    return {manifest,outboxDir:outbox,proofDir:proofs,termsFile:join(sources,'terms.json')};
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
    const report=await this.report(id);check(['ledger','options','exceptions','proofs'].includes(kind),'INVALID_VIEW','Choose a supported reconciliation view.');
    const offset=Number(query.offset??0),limit=Number(query.limit??50);check(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'INVALID_PAGE','Use a nonnegative offset and up to 200 rows.');
    let items;
    if(kind==='proofs'){const run=this.runRow(id),bytes=await readBytes(join(this.runPath(id),'input-manifest.json'),4_000_000);check(hash(bytes)===run.inputManifestSha256,'INPUT_MANIFEST_CHANGED','The retained source manifest changed.',409);items=parse(bytes,'input manifest').proofs;}
    else items=report[kind];
    if(kind==='exceptions')items=items.map(row=>({...row,id:exceptionId(row),review:noteFor(this.state,row)}));
    for(const field of ['routeId','method','network','transfer','delivery'])if(query[field])items=items.filter(row=>row[field]===query[field]);
    if(query.review&&kind==='exceptions')items=items.filter(row=>row.review.status===query.review);
    if(query.search){const term=String(query.search).toLowerCase().slice(0,300);items=items.filter(row=>[row.eventId,row.routeId,row.optionId,row.reason,row.name,row.sha256].some(value=>typeof value==='string'&&value.toLowerCase().includes(term)));}
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
    const inputManifest=await readBytes(join(root,'input-manifest.json'),4_000_000);check(hash(inputManifest)===run.inputManifestSha256,'INPUT_MANIFEST_CHANGED','The retained source manifest changed.',409);
    await writeNew(join(folder,'input-manifest.json'),inputManifest);
    if(includeSources){
      await privateDir(join(folder,'sources','outbox'),{create:true});
      await privateDir(join(folder,'sources','proofs'),{create:true});
      const manifest=parse(inputManifest,'input manifest');
      for(const file of manifest.files){if(!file.path)continue;check(file.path.startsWith('sources/')&&!file.path.includes('..'),'INVALID_RETAINED_PATH','A retained source path is invalid.');const raw=await readBytes(join(root,file.path),16_000_000,{empty:true});check(hash(raw)===file.sha256,'SOURCE_SNAPSHOT_CHANGED','A retained input changed.',409);await privateDir(resolve(join(folder,file.path),'..'),{create:true});await writeNew(join(folder,file.path),raw);}
    }
    await writeNew(join(folder,'START.txt'),'Merchant settlement reconciliation\n\nOriginal accounting report/CSV/HTML and a snapshot of named operator exception notes. Review notes do not change native transfer classifications.\n'+(includeSources?'Includes private original journal, terms and verification source files.\n':'Private original source bytes were not included.\n'));
    const handle=await open(archive,'wx',0o600);
    try{await new Promise((resolve,reject)=>{
      const child=spawn('tar',['-cf','-','-C',folder,'.'],{stdio:['ignore',handle.fd,'pipe']});let error='';child.stderr.on('data',chunk=>{if(error.length<4000)error+=chunk;});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Archive export failed: '+error)));});await handle.sync();}
    finally{await handle.close();}
    const raw=await readBytes(archive,256_000_000),record={id,runId,name:run.name,createdAt:now(),actor,includeSources,bytes:raw.length,sha256:hash(raw)};
    this.state.exports.unshift(record);await this.commit('review_exported',actor,{exportId:id,runId,includeSources,sha256:record.sha256});return {export:record,state:this.view()};
  });}
  async reportFile(runId,name){check(EXPORTED_FILES.includes(name),'INVALID_DOWNLOAD','Choose an original report file.');const run=this.runRow(runId);await this.report(runId);const root=join(this.runPath(runId),'report');const manifestBytes=await readBytes(join(root,'manifest.json'),1_000_000);check(hash(manifestBytes)===run.manifestSha256,'REPORT_MANIFEST_CHANGED','The original report manifest changed.',409);if(name==='manifest.json')return manifestBytes;const expected=parse(manifestBytes,'report manifest').outputs.find(file=>file.name===name),bytes=await readBytes(join(root,name),128_000_000);check(expected&&hash(bytes)===expected.sha256&&bytes.length===expected.bytes,'REPORT_FILE_CHANGED','The original report file changed.',409);return bytes;}
  async download(runId,name){return {bytes:await this.reportFile(runId,name),name};}
  async archive(id){check(typeof id==='string'&&idPattern.test(id),'INVALID_EXPORT','Choose an existing export.');const record=this.state.exports.find(item=>item.id===id);check(record,'EXPORT_NOT_FOUND','This review export was not found.',404);const bytes=await readBytes(join(this.directory,'exports',id+'.tar'),256_000_000);check(hash(bytes)===record.sha256,'EXPORT_CHANGED','The retained export changed.',409);return {bytes,name:'merchant-review-'+id+'.tar'};}
  async close(){await Promise.allSettled([...this.tasks]);await this.tail;this.closed=true;await this.lease.close();}
}
