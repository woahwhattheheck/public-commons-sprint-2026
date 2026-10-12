#!/usr/bin/env node
// MIT. Complete original Applications start / SDK receiving / Stop / reopen / cold lifecycle.
import {open,readFile,lstat,mkdir,readdir,rename,link,unlink,realpath} from 'node:fs/promises';
import {constants,createReadStream,createWriteStream} from 'node:fs';
import {join,dirname,basename,resolve,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {GRIDFABRIC_HASH,GRIDFABRIC_UUID,GRIDFABRIC_SOURCE_PREFIX,GRIDFABRIC_MANAGED_OPERATION,
  gridFabricNeed as need,gridFabricHash as hash,gridFabricSame as same,gridFabricCanonical as canonical,
  gridFabricAbsolute as absolute,gridFabricOriginalFile as identity,gridFabricPrivateDirectory,
  requireGridFabricNode} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/managed-binding.mjs';
import {inspectMerchantRuntime} from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';

const SCHEMA='commons.gridfabric-managed-receiving-input.v1';
const JOURNAL='commons.gridfabric-managed-receiving-journal.v1';
const RESULT='commons.gridfabric-managed-receiving.v1';
const MAX_ARTIFACT=8*1024*1024*1024;
const ROOT=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const RUNNER='operations/scf-gridfabric-plaid-managed-receiving-20261012/run-receiving.mjs';
const now=()=>new Date().toISOString();
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const failure=error=>({code:error?.code??error?.name??'GRIDFABRIC_MANAGED_RECEIVING_ERROR',
  message:String(error?.message??error),...(error?.details?{details:error.details}:{})});
function memberName(path) {
  need(typeof path==='string'&&path&&path.length<=2000&&!path.startsWith('/')&&!/[\\\x00-\x1f\x7f]/.test(path)&&
    !path.split('/').some(part=>!part||part==='.'||part==='..'),'GRIDFABRIC_MANAGED_MEMBER');
  return path;
}
function beneath(root,path) {
  const full=resolve(root,memberName(path)),part=relative(root,full);
  need(part&&!part.startsWith('..'+sep)&&part!=='..'&&!part.startsWith(sep),'GRIDFABRIC_MANAGED_MEMBER');
  return full;
}
async function directory(path,{create=false}={}) {
  absolute(path);
  if(create)try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  return gridFabricPrivateDirectory(path);
}
async function syncDirectory(path) {
  const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);
  try{await handle.sync();}finally{await handle.close();}
}
async function optional(path,maximum=64*1024*1024) {
  try{return await identity(path,maximum,{privateOnly:true,bytes:true});}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function readJSON(path,maximum=64*1024*1024) {
  const raw=await identity(path,maximum,{privateOnly:true,bytes:true});
  return {value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw.raw)),...raw};
}
async function finishStage(path,raw) {
  const pending=path+'.pending-'+hash(raw);let handle;
  try{handle=await open(pending,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    const prior=await optional(pending,raw.length);
    need(prior&&raw.subarray(0,prior.bytes).equals(prior.raw),'GRIDFABRIC_MANAGED_STAGE_CHANGED');
    handle=await open(pending,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  }
  try {
    const stat=await handle.stat();need(stat.isFile()&&stat.size<=raw.length,'GRIDFABRIC_MANAGED_STAGE_CHANGED');
    let offset=stat.size;
    while(offset<raw.length){const count=(await handle.write(raw,offset,raw.length-offset,offset)).bytesWritten;
      need(count>0,'GRIDFABRIC_MANAGED_WRITE_INCOMPLETE');offset+=count;}
    await handle.sync();
  }finally{await handle.close();}
  const actual=await identity(pending,raw.length,{privateOnly:true});
  need(actual.bytes===raw.length&&actual.sha256===hash(raw),'GRIDFABRIC_MANAGED_STAGE_CHANGED');
  return pending;
}
async function clearStage(path,raw) {
  const stage=path+'.pending-'+hash(raw),saved=await optional(stage,raw.length);
  if(!saved)return;
  need(saved.bytes===raw.length&&saved.sha256===hash(raw)&&saved.raw.equals(raw),'GRIDFABRIC_MANAGED_STAGE_CHANGED');
  await unlink(stage);await syncDirectory(dirname(path));
}
async function writeExact(path,raw) {
  const saved=await optional(path,Math.max(raw.length,1));
  if(saved){need(saved.raw.equals(raw),'GRIDFABRIC_MANAGED_OUTPUT_CHANGED','Keep the exact original output.',{path});
    await clearStage(path,raw);return {path,bytes:raw.length,sha256:hash(raw)};}
  const stage=await finishStage(path,raw);
  try{await link(stage,path);}catch(error){if(error.code!=='EEXIST')throw error;
    const existing=await optional(path,raw.length);need(existing?.raw.equals(raw),'GRIDFABRIC_MANAGED_OUTPUT_CHANGED');}
  await syncDirectory(dirname(path));await clearStage(path,raw);
  return {path,bytes:raw.length,sha256:hash(raw)};
}
async function writeMutable(path,raw,prior) {
  const before=await optional(path);
  need(prior?before&&before.sha256===prior.sha256&&before.bytes===prior.bytes:before===null,
    'GRIDFABRIC_MANAGED_JOURNAL_CHANGED');
  if(!prior)return writeExact(path,raw);
  const stage=await finishStage(path,raw),again=await optional(path);
  need(again&&again.sha256===prior.sha256&&again.bytes===prior.bytes,'GRIDFABRIC_MANAGED_JOURNAL_CHANGED');
  await rename(stage,path);await syncDirectory(dirname(path));
  return {path,bytes:raw.length,sha256:hash(raw)};
}
async function allFiles(root) {
  const files=[];
  async function visit(path,prefix) {
    for(const name of (await readdir(path)).sort()) {
      const full=join(path,name),relativePath=prefix?prefix+'/'+name:name,stat=await lstat(full);
      memberName(relativePath);
      need(!stat.isSymbolicLink(),'GRIDFABRIC_MANAGED_CUSTOMER_FILE');
      if(stat.isDirectory())await visit(full,relativePath);
      else {need(stat.isFile(),'GRIDFABRIC_MANAGED_CUSTOMER_FILE');files.push({path:relativePath,...await identity(full,MAX_ARTIFACT)});}
    }
  }
  await visit(root,'');return files;
}
async function runProcess(executable,args,{cwd,maximum=32*1024*1024,timeout=300000,onStarted}={}) {
  let child,timer,killTimer,primary=null,startedRecord=Promise.resolve();
  const stdout=[],stderr=[];let outBytes=0,errBytes=0;
  const stop=error=>{
    primary=primary??error;
    if(child&&!child.killed)child.kill('SIGTERM');
    if(!killTimer){killTimer=setTimeout(()=>{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},30000);killTimer.unref?.();}
  };
  try {
    const result=await new Promise(resolveResult=>{
      child=spawn(executable,args,{cwd,shell:false,stdio:['ignore','pipe','pipe']});
      child.once('spawn',()=>{
        startedRecord=Promise.resolve().then(()=>onStarted?.(child.pid));
        startedRecord.catch(stop);
      });
      child.once('error',stop);
      for(const [stream,buffers,name]of [[child.stdout,stdout,'stdout'],[child.stderr,stderr,'stderr']])
        stream?.on('data',chunk=>{
          if(name==='stdout')outBytes+=chunk.length;else errBytes+=chunk.length;
          if(outBytes+errBytes>maximum){stop(Object.assign(new Error('Retain the complete original child output within its selected allowance.'),
            {code:'GRIDFABRIC_MANAGED_CHILD_OUTPUT'}));return;}
          buffers.push(Buffer.from(chunk));
        });
      child.once('close',(code,signal)=>resolveResult({code,signal,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr)}));
      timer=setTimeout(()=>stop(Object.assign(new Error('The original native child exceeded this receiving invocation’s allowance.'),
        {code:'GRIDFABRIC_MANAGED_CHILD_TIMEOUT'})),timeout);timer.unref?.();
    });
    await startedRecord.catch(error=>{primary=primary??error;});
    if(primary){primary.nativeChild={code:result.code,signal:result.signal,stdout:result.stdout.toString('utf8'),stderr:result.stderr.toString('utf8')};throw primary;}
    need(result.code===0,'GRIDFABRIC_MANAGED_CHILD_FAILED','The complete original child returned an error.',
      {executable,args,code:result.code,signal:result.signal,stdout:result.stdout.toString('utf8'),stderr:result.stderr.toString('utf8')});
    return result;
  }finally {if(timer)clearTimeout(timer);if(killTimer)clearTimeout(killTimer);}
}

function configuration(value) {
  need(plain(value)&&value.schema===SCHEMA,'GRIDFABRIC_MANAGED_CONFIGURATION');
  const allowed=['schema','operation_id','runtimeDirectory','runtimeWorkspaceDirectory','workspaceDirectory','workspaceId',
    'connectionFile','readyFile','outputDirectory','exportRequestId','restoreRequestId','restoredName',
    'environmentFile','minimumCollections','classification','label'];
  need(Object.keys(value).every(key=>allowed.includes(key)),'GRIDFABRIC_MANAGED_CONFIGURATION');
  for(const name of ['runtimeDirectory','runtimeWorkspaceDirectory','workspaceDirectory','outputDirectory'])absolute(value[name],name);
  for(const name of ['connectionFile','readyFile','environmentFile'])if(value[name]!==undefined)absolute(value[name],name);
  for(const name of ['workspaceId','exportRequestId','restoreRequestId'])need(GRIDFABRIC_UUID.test(value[name]??''),'GRIDFABRIC_MANAGED_CONFIGURATION',name+' must retain its original UUID.');
  need(value.exportRequestId!==value.restoreRequestId,'GRIDFABRIC_MANAGED_CONFIGURATION','Retain distinct original export and restore request UUIDs.');
  need(typeof value.operation_id==='string'&&value.operation_id&&value.operation_id.length<=160,'GRIDFABRIC_MANAGED_CONFIGURATION');
  need(typeof value.restoredName==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(value.restoredName)&&
    !['.','..'].includes(value.restoredName)&&join(dirname(value.workspaceDirectory),value.restoredName)!==value.workspaceDirectory,
    'GRIDFABRIC_MANAGED_CONFIGURATION');
  if(value.label!==undefined)need(typeof value.label==='string'&&value.label.trim()&&value.label.length<=90,'GRIDFABRIC_MANAGED_CONFIGURATION');
  if(value.classification!==undefined)need(typeof value.classification==='string'&&value.classification.length<=4000,'GRIDFABRIC_MANAGED_CONFIGURATION');
  if(value.minimumCollections!==undefined)need(plain(value.minimumCollections)&&Object.values(value.minimumCollections)
    .every(count=>Number.isSafeInteger(count)&&count>=0),'GRIDFABRIC_MANAGED_CONFIGURATION');
  return value;
}


async function copyOriginal(source,destination,expected=null) {
  const original=await identity(source,MAX_ARTIFACT);
  if(expected)need(original.bytes===expected.bytes&&original.sha256===expected.sha256,
    'GRIDFABRIC_MANAGED_ORIGINAL_CHANGED','The complete original file differs from its retained identity.',{source});
  const present=await optionalIdentity(destination);
  const stage=destination+'.pending-'+original.sha256;
  if(present) {
    need(same(present,original),'GRIDFABRIC_MANAGED_OUTPUT_CHANGED');
    const previous=await optionalIdentity(stage);
    if(previous){need(same(previous,original),'GRIDFABRIC_MANAGED_STAGE_CHANGED');await unlink(stage);await syncDirectory(dirname(stage));}
    return {path:destination,...original};
  }
  const previous=await optionalIdentity(stage);
  if(previous) {
    // An interrupted copied prefix is verified against the same original bytes before continuation.
    need(previous.bytes<=original.bytes,'GRIDFABRIC_MANAGED_STAGE_CHANGED');
    let left,right,primary;const closeErrors=[];
    try {
      left=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW);
      right=await open(stage,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      const block=Buffer.alloc(256*1024),other=Buffer.alloc(256*1024);let offset=0;
      while(offset<previous.bytes) {
        const length=Math.min(block.length,previous.bytes-offset);
        need((await left.read(block,0,length,offset)).bytesRead===length&&
          (await right.read(other,0,length,offset)).bytesRead===length&&block.subarray(0,length).equals(other.subarray(0,length)),
          'GRIDFABRIC_MANAGED_STAGE_CHANGED');offset+=length;
      }
    }catch(error){primary=error;throw error;}
    finally {
      try{if(left)await left.close();}catch(error){closeErrors.push({owner:'original_file',error});}
      try{if(right)await right.close();}catch(error){closeErrors.push({owner:'pending_file',error});}
      if(closeErrors.length) {
        if(primary)primary.cleanup_errors=closeErrors.map(item=>({owner:item.owner,...failure(item.error)}));
        else throw new AggregateError(closeErrors.map(item=>item.error),'Close both original prefix verification files.');
      }
    }
  }
  const handle=await open(stage,constants.O_WRONLY|constants.O_NOFOLLOW|
    (previous?constants.O_APPEND:constants.O_CREAT|constants.O_EXCL),0o600);
  try {
    if((previous?.bytes??0)<original.bytes)await pipeline(
      createReadStream(source,{start:previous?.bytes??0,flags:constants.O_RDONLY|constants.O_NOFOLLOW}),
      createWriteStream(stage,{fd:handle.fd,autoClose:false,flags:'a'}));
    await handle.sync();
  }finally{await handle.close();}
  need(same(await identity(source,MAX_ARTIFACT),original)&&same(await identity(stage,MAX_ARTIFACT),original),
    'GRIDFABRIC_MANAGED_ORIGINAL_CHANGED');
  try{await link(stage,destination);}catch(error){if(error.code!=='EEXIST')throw error;
    need(same(await identity(destination,MAX_ARTIFACT),original),'GRIDFABRIC_MANAGED_OUTPUT_CHANGED');}
  await syncDirectory(dirname(destination));await unlink(stage);await syncDirectory(dirname(destination));
  return {path:destination,...original};
}
async function optionalIdentity(path) {
  try{return await identity(path,MAX_ARTIFACT,{privateOnly:true});}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function makeTree(root,path) {
  let target=root;
  for(const part of memberName(path).split('/')){target=join(target,part);await directory(target,{create:true});}
  return target;
}
function originalResult(value) {
  return JSON.parse(JSON.stringify(value));
}
function runView(application,id) {
  return application.runs?.find(item=>item.id===id)??(application.current?.id===id?application.current:null);
}
const terminal=phase=>['SUCCEEDED','FAILED','CANCELLED','STOPPED'].includes(phase);
class Receiving {
  constructor({config,output,customer,journal,journalIdentity,lease,invocationId}) {
    Object.assign(this,{config,output,customer,journal,journalIdentity,lease,invocationId});
    this.model=null;this.clients=new Set();this.saved=Promise.resolve();
  }
  async save() {
    // Continue only our exact prior write after an interrupted rename, under this same original lease.
    this.saved=this.saved.catch(()=>{}).then(async()=>{
      this.lease.assertHeld();
      if(this.pendingJournal) {
        const actual=await optional(join(this.output,'receiving.json')),pending=this.pendingJournal;
        if(actual&&actual.bytes===pending.bytes&&actual.sha256===pending.sha256)
          this.journalIdentity={bytes:actual.bytes,sha256:actual.sha256};
        else need(pending.previous?actual&&actual.bytes===pending.previous.bytes&&actual.sha256===pending.previous.sha256:actual===null,
          'GRIDFABRIC_MANAGED_JOURNAL_CHANGED');
      }
      this.journal.updated_at=now();const raw=json(this.journal);
      this.pendingJournal={bytes:raw.length,sha256:hash(raw),previous:this.journalIdentity};
      this.journalIdentity=await writeMutable(join(this.output,'receiving.json'),raw,this.journalIdentity);
      this.pendingJournal=null;
    });
    return this.saved;
  }

  async event(name,value={}) {
    this.journal.history.push({at:now(),name,...originalResult(value)});await this.save();
    process.stdout.write(JSON.stringify({operation_id:this.config.operation_id,phase:name})+'\n');
  }
  async customerTarget(path,expected) {
    memberName(path);
    need(Number.isSafeInteger(expected.bytes)&&expected.bytes>=0&&GRIDFABRIC_HASH.test(expected.sha256),
      'GRIDFABRIC_MANAGED_CUSTOMER_DECLARATION');
    const members=this.journal.customer_members??={};
    if(members[path])need(same(members[path],expected),'GRIDFABRIC_MANAGED_OUTPUT_CHANGED',path);
    else{members[path]=originalResult(expected);await this.save();}
    const target=beneath(this.customer,path),parent=relative(this.customer,dirname(target)).split(sep).join('/');
    if(parent)await makeTree(this.customer,parent);
    return target;
  }
  async customerBytes(path,raw) {
    const expected={bytes:raw.length,sha256:hash(raw)},target=await this.customerTarget(path,expected);
    const pending=this.journal.customer_pending??={};
    const intent={kind:'bytes',...expected,data:raw.toString('base64')};
    if(pending[path])need(same(pending[path],intent),'GRIDFABRIC_MANAGED_OUTPUT_CHANGED',path);
    else{pending[path]=intent;await this.save();}
    const result=await writeExact(target,raw);
    delete pending[path];await this.save();return result;
  }
  async customerJSON(path,value) {return this.customerBytes(path,json(value));}
  async customerFile(path,source,expected) {
    const observed=await identity(source,MAX_ARTIFACT);
    need(observed.bytes===expected.bytes&&observed.sha256===expected.sha256,'GRIDFABRIC_MANAGED_ORIGINAL_CHANGED',source);
    const target=await this.customerTarget(path,{bytes:expected.bytes,sha256:expected.sha256}),
      pending=this.journal.customer_pending??={},intent={kind:'original',source,...observed};
    if(pending[path])need(same(pending[path],intent),'GRIDFABRIC_MANAGED_OUTPUT_CHANGED',path);
    else{pending[path]=intent;await this.save();}
    const result=await copyOriginal(source,target,observed);
    delete pending[path];await this.save();return result;
  }
  async resumeCustomer() {
    for(const [path,intent]of Object.entries(this.journal.customer_pending??{})) {
      const declared=this.journal.customer_members?.[path];
      need(declared&&declared.bytes===intent.bytes&&declared.sha256===intent.sha256,
        'GRIDFABRIC_MANAGED_CUSTOMER_DECLARATION',path);
      if(intent.kind==='bytes') {
        const raw=Buffer.from(intent.data,'base64');
        need(raw.length===intent.bytes&&hash(raw)===intent.sha256,'GRIDFABRIC_MANAGED_OUTPUT_CHANGED',path);
        await this.customerBytes(path,raw);
      } else {
        need(intent.kind==='original'&&typeof intent.source==='string','GRIDFABRIC_MANAGED_CUSTOMER_DECLARATION',path);
        await this.customerFile(path,intent.source,declared);
      }
    }
  }
  async customerDownload(prefix,original,fileId,expectedManifestSha256=null) {
    const name=this.sdk.GRIDFABRIC_FILE_MANIFEST;
    need(typeof name==='string'&&memberName(name)===name&&!name.includes('/'),'GRIDFABRIC_MANAGED_SDK_MANIFEST');
    const manifest=await readJSON(join(dirname(original.path),name),65000),
      parsed=this.sdk.parseGridFabricFileManifest(manifest.raw,fileId);
    need((expectedManifestSha256===null||manifest.sha256===expectedManifestSha256)&&
      parsed.workspace.workspace_id===this.config.workspaceId&&parsed.native_file.bytes===original.bytes&&
      parsed.native_file.sha256===original.sha256&&parsed.files.length===1&&
      parsed.files[0].name===basename(original.path),'GRIDFABRIC_MANAGED_SDK_MANIFEST');
    const files=[await this.customerFile(prefix+'/'+parsed.files[0].name,original.path,original),
      await this.customerBytes(prefix+'/'+name,manifest.raw)];
    return files.map(file=>({path:relative(this.customer,file.path).split(sep).join('/'),bytes:file.bytes,sha256:file.sha256}));
  }
  async source() {
    requireGridFabricNode();
    const runtime=await inspectMerchantRuntime(this.config.runtimeDirectory,{load:false});
    need(runtime.status===undefined||runtime.status==='READY','GRIDFABRIC_MANAGED_RUNTIME_REQUIRED');
    const helper=await import(pathToFileURL(join(runtime.sourceRoot,GRIDFABRIC_SOURCE_PREFIX+'managed-binding.mjs')).href);
    const selected=await helper.readGridFabricApplicationSource(runtime.sourceRoot);
    const self=selected.files.find(item=>item.path===RUNNER),actual=await identity(fileURLToPath(import.meta.url));
    need(self&&self.bytes===actual.bytes&&self.sha256===actual.sha256,
      'GRIDFABRIC_MANAGED_RECEIVER_SOURCE','Run this complete receiving entry from its actual selected package.');
    const sdk=await import(pathToFileURL(join(runtime.sourceRoot,GRIDFABRIC_SOURCE_PREFIX+'sdk/index.mjs')).href),
      contract=await import(pathToFileURL(join(runtime.sourceRoot,GRIDFABRIC_SOURCE_PREFIX+'sdk/contract.mjs')).href);
    need(typeof sdk.runGridFabricSdkReceiving==='function'&&typeof sdk.connectGridFabricOperator==='function'&&
      typeof sdk.downloadGridFabricFile==='function','GRIDFABRIC_MANAGED_SDK_REQUIRED');
    const observed={...selected.source,node:{executable:await realpath(process.execPath),version:process.versions.node},
      receiver:{path:RUNNER,...actual}};
    if(this.journal.source)need(same(this.journal.source,observed),'GRIDFABRIC_MANAGED_SOURCE_CHANGED');
    else{this.journal.source=observed;await this.save();}
    this.runtime=runtime;this.helper=helper;this.sdk=sdk;
    this.tables=[...contract.GRIDFABRIC_TABLES,...contract.GRIDFABRIC_HOST_TABLES];
    this.hostTables=new Set(contract.GRIDFABRIC_HOST_TABLES);
    for(const name of Object.keys(this.config.minimumCollections??{}))
      need(contract.GRIDFABRIC_TABLES.includes(name),'GRIDFABRIC_MANAGED_CONFIGURATION','Use an original native collection name.');
    const modelModule=await import(pathToFileURL(join(runtime.sourceRoot,
      'stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs')).href);
    this.model=await modelModule.openRuntimeWorkspace({directory:this.config.runtimeWorkspaceDirectory});
    for(const name of ['state','attach','applicationsState','applicationsReview','applicationsSave','applicationsConnect',
      'applicationsStartReview','applicationsStart','applicationsOutput','applicationsStop','applicationsRecover','close'])
      need(typeof this.model[name]==='function','GRIDFABRIC_MANAGED_APPLICATIONS_ABI','Use the complete original Applications lifecycle: '+name);
    const current=await this.model.state();
    need(current.directory===this.config.runtimeWorkspaceDirectory&&typeof current.workspaceId==='string',
      'GRIDFABRIC_MANAGED_CONTROL_WORKSPACE');
    if(this.journal.controlWorkspaceId)need(this.journal.controlWorkspaceId===current.workspaceId,'GRIDFABRIC_MANAGED_CONTROL_WORKSPACE');
    else{this.journal.controlWorkspaceId=current.workspaceId;await this.save();}
    const retained=current.runtimes.find(item=>item.directory===runtime.directory);
    if(!this.journal.runtime) {
      const attached=retained?{runtimeId:retained.id,status:retained.status,reopened:true}:
        await this.model.attach({directory:runtime.directory,label:this.config.label??'GridFabric populated workspace receiving'});
      need(attached.runtimeId&&(!attached.status||attached.status==='READY'),'GRIDFABRIC_MANAGED_RUNTIME_REQUIRED');
      this.journal.runtime={runtimeId:attached.runtimeId,directory:runtime.directory,source:observed};await this.save();
    } else need(this.journal.runtime.directory===runtime.directory&&retained?.id===this.journal.runtime.runtimeId,
      'GRIDFABRIC_MANAGED_RUNTIME_CHANGED');
    await this.customerJSON('Source_Identity.json',{schema:'commons.gridfabric-managed-source-receiving.v1',
      source:this.journal.source,control_workspace_id:this.journal.controlWorkspaceId,runtime:this.journal.runtime,
      manifest:selected.files.map(({path,bytes,sha256})=>({path,bytes,sha256}))});
  }
  async application(key) {
    const id=this.journal.applications[key]?.applicationId;
    if(!id)return null;
    const current=await this.model.applicationsState({historyLimit:30});
    const selected=current.applications.find(item=>item.id===id);
    need(selected&&selected.phase!=='UNAVAILABLE','GRIDFABRIC_MANAGED_APPLICATION_CHANGED',
      'Reopen this exact saved application.',{applicationId:id,error:selected?.error??null});
    need(selected.revision===this.journal.applications[key].revision&&
      selected.runtimeId===this.journal.runtime.runtimeId&&selected.kind==='gridfabric-plaid'&&
      same(selected.settings,this.journal.applications[key].settings),'GRIDFABRIC_MANAGED_APPLICATION_CHANGED');
    return selected;
  }
  async ensureApplication(key,settings) {
    let saved=this.journal.applications[key];
    if(!saved) {
      saved={key,saveRequestId:randomUUID(),settings,created_at:now(),
        label:(this.config.label??'GridFabric receiving')+' '+key};
      this.journal.applications[key]=saved;await this.save();
    } else need(same(saved.settings,settings),'GRIDFABRIC_MANAGED_APPLICATION_CHANGED');
    if(!saved.review) {
      saved.review=await this.model.applicationsReview({runtimeId:this.journal.runtime.runtimeId,kind:'gridfabric-plaid',
        label:saved.label,settings:saved.settings});await this.save();
    }
    if(!saved.applicationId) {
      const result=await this.model.applicationsSave({requestId:saved.saveRequestId,reviewId:saved.review.id});
      need(result.saved===true&&typeof result.applicationId==='string','GRIDFABRIC_MANAGED_APPLICATION_SAVE');
      saved.save_result=result;saved.applicationId=result.applicationId;saved.revision=result.revision;await this.save();
    }
    let app=await this.application(key);
    if(!app.release) {
      saved.connection_attempts??=[];saved.connection_attempts.push({at:now(),invocation_id:this.invocationId,state:'PREPARED'});await this.save();
      const attempt=saved.connection_attempts.at(-1);
      attempt.result=await this.model.applicationsConnect({applicationId:saved.applicationId});attempt.state='RETURNED';await this.save();
      const deadline=Date.now()+300000;let observed=null;
      for(;;) {
        app=await this.application(key);
        if(app.release)break;
        const changed={phase:app.phase,adoption:app.adoption};
        if(!same(changed,observed)){attempt.observed=changed;observed=changed;await this.save();}
        need(!['FAILED','INTERRUPTED','CANCELLED'].includes(app.adoption?.phase),
          'GRIDFABRIC_MANAGED_ADOPTION_RETAINED','Receive the original adopted package outcome before starting.',{adoption:app.adoption});
        need(Date.now()<deadline,'GRIDFABRIC_MANAGED_ADOPTION_PENDING','The original package adoption remains pending.');
        await pause(750);
      }
    }
    if(!saved.release){saved.release=originalResult(app.release);await this.save();}
    else need(same(saved.release,app.release),'GRIDFABRIC_MANAGED_RELEASE_CHANGED');
    return app;
  }
  async observedRun(key,attempt) {
    const app=await this.application(key),run=runView(app,attempt.requestId);
    if(run)return {app,run};
    // A receiving-specific application has only this programme's retained runs.
    need(!app.current||this.journal.roles&&Object.values(this.journal.roles).some(role=>
      role.attempts.some(item=>item.requestId===app.current.id)),'GRIDFABRIC_MANAGED_UNRELATED_RUN');
    return {app,run:null};
  }
  async captureOperation(key,attempt) {
    const root=await makeTree(this.customer,'lifecycle/'+key+'/'+attempt.requestId);
    const origin=join(this.config.runtimeWorkspaceDirectory,'operations',attempt.requestId);
    const names=['request.json','state.json','command-result.json','command-launch.json','command-process.json',
      'application-url.json','application-provider.json','stop.json','worker.log'];
    const files=[];
    for(const name of names) {
      const path=join(origin,name);
      try {
        const found=await identity(path,name==='worker.log'?32*1024*1024:8*1024*1024);
        const copy=await this.customerFile('lifecycle/'+key+'/'+attempt.requestId+'/'+name,path,found);files.push({name,...copy});
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    attempt.original_operation_files=files;
    await this.customerJSON('lifecycle/'+key+'/'+attempt.requestId+'/Receiving_Disposition.json',{
      request_id:attempt.requestId,application_id:this.journal.applications[key].applicationId,
      terminal:attempt.terminal,closure:attempt.closure,original_operation_files:files});
    attempt.operation_capture_complete=true;await this.save();
  }
  async leaseProof(key,attempt) {
    const saved=this.journal.applications[key],settings=saved.settings;
    if(attempt.lease_proof) {
      for(const file of attempt.lease_proof.files)need(same(await identity(file.path),{bytes:file.bytes,sha256:file.sha256}),
        'GRIDFABRIC_MANAGED_OUTPUT_CHANGED');
      return attempt.lease_proof;
    }
    const folder=await makeTree(this.customer,'lifecycle/'+key+'/'+attempt.requestId+'/native-lease');
    const executable=await realpath(process.execPath),
      args=[join(this.runtime.sourceRoot,GRIDFABRIC_SOURCE_PREFIX+'cli.mjs'),'--workspace',settings.workspaceDirectory,'status'];
    attempt.lease_attempts??=[];let receipt=attempt.lease_attempts.at(-1),result;
    if(receipt?.state==='CLOSED'&&receipt.output) {
      need(receipt.executable===executable&&same(receipt.args,args),'GRIDFABRIC_MANAGED_NATIVE_LEASE');
      result={code:receipt.exit_code,stdout:Buffer.from(receipt.output.stdout,'base64'),stderr:Buffer.from(receipt.output.stderr,'base64')};
    } else {
      receipt={at:now(),executable,args,state:'PREPARED'};
      attempt.lease_attempts.push(receipt);await this.save();
      result=await runProcess(executable,args,{cwd:this.output,onStarted:async pid=>{
        receipt.pid=pid;receipt.state='STARTED';await this.save();}});
      // Freeze the complete actual transcript before either customer copy can be interrupted.
      receipt.state='CLOSED';receipt.exit_code=result.code;receipt.completed_at=now();
      receipt.output={stdout:result.stdout.toString('base64'),stderr:result.stderr.toString('base64')};await this.save();
    }
    const state=JSON.parse(result.stdout.toString('utf8'));
    need(state.workspace_id===this.config.workspaceId&&Number.isSafeInteger(state.revision),
      'GRIDFABRIC_MANAGED_NATIVE_LEASE','The original CLI must open and close the exact native workspace.');
    if(this.journal.sdk?.result)need(state.revision===this.journal.sdk.result.revision,
      'GRIDFABRIC_MANAGED_WORKSPACE_CHANGED');
    const files=[await this.customerBytes('lifecycle/'+key+'/'+attempt.requestId+'/native-lease/stdout.json',result.stdout),
      await this.customerBytes('lifecycle/'+key+'/'+attempt.requestId+'/native-lease/stderr.txt',result.stderr)];
    attempt.lease_proof={schema:'commons.gridfabric-original-native-lease-receiving.v1',workspace_id:state.workspace_id,
      directory:settings.workspaceDirectory,revision:state.revision,collections:state.collections,
      original_command:receipt,files,observed:'Original CLI status exited after its original workspace finally closed.'};
    await this.save();return attempt.lease_proof;
  }
  async closeRun(key,attempt) {
    if(attempt.closed){if(!attempt.operation_capture_complete&&attempt.terminal)await this.captureOperation(key,attempt);return;}
    let observed=await this.observedRun(key,attempt);
    if(!observed.run) {
      attempt.closed=true;attempt.closure={at:now(),kind:'ORIGINAL_APPLICATION_RUN_NOT_ACCEPTED'};
      await this.save();return;
    }
    const id=this.journal.applications[key].applicationId;
    if(!terminal(observed.run.phase)||observed.run.active) {
      if(!attempt.stop){attempt.stop={at:now(),input:{applicationId:id,operationId:attempt.requestId},state:'PREPARED'};await this.save();}
      attempt.stop.result=await this.model.applicationsStop(attempt.stop.input);attempt.stop.state='RETURNED';await this.save();
    }
    const deadline=Date.now()+180000;let recovered=false;
    for(;;) {
      observed=await this.observedRun(key,attempt);
      need(observed.run,'GRIDFABRIC_MANAGED_ORIGINAL_RUN_LOST');
      if(!observed.run.active&&terminal(observed.run.phase))break;
      if(!observed.run.active&&observed.run.phase==='INTERRUPTED'&&!recovered) {
        recovered=true;attempt.stop_recovery={at:now(),input:{applicationId:id,operationId:attempt.requestId},state:'PREPARED'};await this.save();
        attempt.stop_recovery.result=await this.model.applicationsRecover(attempt.stop_recovery.input);
        attempt.stop_recovery.state='RETURNED';await this.save();continue;
      }
      need(Date.now()<deadline,'GRIDFABRIC_MANAGED_STOP_PENDING',
        'The original managed worker still owns its request. Continue this receiving after its retained stop resolves.',
        {applicationId:id,operationId:attempt.requestId,phase:observed.run.phase,active:observed.run.active});
      await pause(500);
    }
    attempt.terminal=originalResult(observed.run);
    const proof=await this.leaseProof(key,attempt);
    // The framework outcome remains exact; native lease proof never manufactures a normal process exit.
    attempt.closure={at:now(),kind:['RECONCILED','OUTCOME_UNAVAILABLE'].includes(observed.run.result?.state)?
      'ORIGINAL_FRAMEWORK_RECOVERY_AND_NATIVE_LEASE':'ORIGINAL_TERMINAL_AND_NATIVE_LEASE',
      framework_phase:observed.run.phase,framework_result:observed.run.result??null,
      native_workspace_id:proof.workspace_id,native_revision:proof.revision};
    attempt.closed=true;await this.save();await this.captureOperation(key,attempt);
  }
  async running(roleName,key) {
    const role=this.journal.roles[roleName]??={name:roleName,application_key:key,attempts:[]};
    need(role.application_key===key,'GRIDFABRIC_MANAGED_ROLE_CHANGED');await this.save();
    let attempt=role.attempts.at(-1),observed=attempt?await this.observedRun(key,attempt):null;
    if(attempt&&(attempt.closed||observed?.run&&!observed.run.active&&terminal(observed.run.phase))) {
      await this.closeRun(key,attempt);
      need(attempt.invocation_id!==this.invocationId,'GRIDFABRIC_MANAGED_START_FAILED',
        'The actual original startup ended. Its complete outcome is retained.',{terminal:attempt.terminal??null});
      attempt=null;
    }
    if(!attempt) {
      const review=await this.model.applicationsStartReview({applicationId:this.journal.applications[key].applicationId});
      attempt={requestId:randomUUID(),review,invocation_id:this.invocationId,created_at:now(),state:'PREPARED',closed:false};
      role.attempts.push(attempt);await this.save();
      observed={run:null};
    }
    const input={applicationId:this.journal.applications[key].applicationId,requestId:attempt.requestId,reviewId:attempt.review.id};
    if(!observed?.run) {
      attempt.start_input=input;await this.save();
      attempt.start_result=await this.model.applicationsStart(input);attempt.state='ACCEPTED';await this.save();
    } else if(!observed.run.active&&['PENDING','QUEUED','INTERRUPTED'].includes(observed.run.phase)) {
      attempt.start_recoveries??=[];
      const recovery={at:now(),input:{applicationId:input.applicationId,operationId:attempt.requestId},state:'PREPARED'};
      attempt.start_recoveries.push(recovery);await this.save();
      recovery.result=await this.model.applicationsRecover(recovery.input);recovery.state='RETURNED';await this.save();
    }
    const deadline=Date.now()+300000;
    for(;;) {
      observed=await this.observedRun(key,attempt);
      need(observed.run,'GRIDFABRIC_MANAGED_ORIGINAL_RUN_LOST');
      if(observed.run.active&&observed.run.url)break;
      if(!observed.run.active&&terminal(observed.run.phase)) {
        await this.closeRun(key,attempt);
        if(attempt.invocation_id!==this.invocationId)return this.running(roleName,key);
        need(false,'GRIDFABRIC_MANAGED_START_FAILED','The original managed startup returned its retained outcome.',{terminal:attempt.terminal});
      }
      need(Date.now()<deadline,'GRIDFABRIC_MANAGED_START_PENDING',
        'The same original managed startup has not produced a verified ready record.',
        {operationId:attempt.requestId,phase:observed.run.phase,active:observed.run.active});
      await pause(750);
    }
    const settings=this.journal.applications[key].settings;
    const expected=(await readJSON(settings.readyFile,32768)).value;
    const verified=await this.helper.verifyGridFabricApplicationAnnouncement(settings.readyFile,expected);
    const actual=verified.announcement;
    need(actual.status==='READY'&&actual.applicationRequestId===attempt.requestId&&
      actual.workspaceId===this.config.workspaceId&&actual.directory===settings.workspaceDirectory&&
      actual.source?.nativeSourceSha256===this.journal.source.nativeSourceSha256,
      'GRIDFABRIC_MANAGED_ANNOUNCEMENT_CHANGED');
    if(attempt.announcement)need(attempt.announcement.instanceId===actual.instanceId&&
      attempt.announcement.bindingSha256===actual.bindingSha256,'GRIDFABRIC_MANAGED_ANNOUNCEMENT_CHANGED');
    else{attempt.announcement=actual;attempt.ready_at=now();attempt.state='READY';await this.save();}
    return {role,attempt,key,settings,announcement:actual};
  }
  async stopRole(name) {
    const role=this.journal.roles[name];if(!role)return;
    for(const attempt of role.attempts)await this.closeRun(role.application_key,attempt);
  }
  async borrower(live) {
    const client=await this.sdk.connectGridFabricOperator({connectionFile:live.settings.connectionFile,
      expectedWorkspaceId:this.config.workspaceId,expectedWorkspace:live.settings.workspaceDirectory,
      expectedSourceSha256:this.journal.source.nativeSourceSha256});
    this.clients.add(client);return client;
  }
  async closeBorrower(client) {try{await client.close();}finally{this.clients.delete(client);}}
  async drainAfterRecordingFailure(key,attempt) {
    // Original Stop must still be attempted if our own evidence disk is unavailable.
    const applicationId=this.journal.applications[key]?.applicationId;
    if(!applicationId||attempt.closed)return null;
    let observed=await this.observedRun(key,attempt);
    if(!observed.run)return {request_id:attempt.requestId,status:'ORIGINAL_RUN_NOT_ACCEPTED'};
    const receipt={request_id:attempt.requestId,application_id:applicationId,at:now(),recording_failure:true};
    if(observed.run.active||!terminal(observed.run.phase))
      receipt.stop=await this.model.applicationsStop({applicationId,operationId:attempt.requestId});
    const deadline=Date.now()+180000;let recovered=false;
    for(;;) {
      observed=await this.observedRun(key,attempt);need(observed.run,'GRIDFABRIC_MANAGED_ORIGINAL_RUN_LOST');
      if(!observed.run.active&&terminal(observed.run.phase))break;
      if(!observed.run.active&&observed.run.phase==='INTERRUPTED'&&!recovered) {
        recovered=true;receipt.recovery=await this.model.applicationsRecover({applicationId,operationId:attempt.requestId});
      }
      need(Date.now()<deadline,'GRIDFABRIC_MANAGED_STOP_PENDING','The original Stop remains pending after recording failed.',
        {application_id:applicationId,request_id:attempt.requestId,phase:observed.run.phase,active:observed.run.active});
      await pause(500);
    }
    const workspace=this.journal.applications[key].settings.workspaceDirectory,
      args=[join(this.runtime.sourceRoot,GRIDFABRIC_SOURCE_PREFIX+'cli.mjs'),'--workspace',workspace,'status'],
      native=await runProcess(await realpath(process.execPath),args,{cwd:this.output});
    const state=JSON.parse(native.stdout.toString('utf8'));
    need(state.workspace_id===this.config.workspaceId,'GRIDFABRIC_MANAGED_NATIVE_LEASE');
    receipt.framework={phase:observed.run.phase,result:observed.run.result??null};
    receipt.native_cli={args,exit_code:native.code,stdout:native.stdout.toString('utf8'),stderr:native.stderr.toString('utf8')};
    receipt.status='ORIGINAL_OWNER_DRAINED';attempt.emergency_closure=receipt;
    // Leave normal closed/capture fields unchanged until the complete ordinary record can be written.
    return receipt;
  }
  async close() {
    const errors=[],emergency=[];
    for(const client of [...this.clients])try{await this.closeBorrower(client);}catch(error){errors.push(error);}
    if(this.model)for(const role of Object.values(this.journal.roles))for(const attempt of role.attempts) {
      try{await this.closeRun(role.application_key,attempt);}catch(error){
        errors.push(error);
        try{const receipt=await this.drainAfterRecordingFailure(role.application_key,attempt);if(receipt)emergency.push(receipt);}
        catch(drainError){errors.push(drainError);}
      }
    }
    if(this.model)try{await this.model.close();}catch(error){errors.push(error);}
    if(errors.length){
      const primary=errors[0];primary.gridFabricReceivingCloseErrors=errors.map(failure);
      primary.details={...(plain(primary.details)?primary.details:{}),
        original_receiving_close_errors:errors.map(failure),original_emergency_closures:emergency};
      throw primary;
    }
  }

}


Receiving.prototype.receiveSdkOutputs=async function(result) {
  const record=await identity(result.receiving_record,MAX_ARTIFACT);
  if(this.journal.sdk.record_identity)need(same(record,this.journal.sdk.record_identity),'GRIDFABRIC_MANAGED_SDK_RECORD_CHANGED');
  else{this.journal.sdk.record_identity=record;await this.save();}
  const members=[];
  const selected=await this.customerFile('sdk-receiving/SDK_Receiving_Record.json',result.receiving_record,record);
  members.push({path:'sdk-receiving/SDK_Receiving_Record.json',bytes:selected.bytes,sha256:selected.sha256});
  members.push(...await this.customerDownload('sdk-receiving/portable',result.portable,
    'export_'+this.config.exportRequestId,result.portable.manifest_sha256));
  members.push(...await this.customerDownload('sdk-receiving/mcp-source',result.mcp.source_download,
    'file_'+result.mcp.source_download.sha256));
  const file=await this.customerJSON('SDK_Receiving_Result.json',result);
  members.push({path:'SDK_Receiving_Result.json',bytes:file.bytes,sha256:file.sha256});
  if(this.journal.sdk.customer_members)need(same(members,this.journal.sdk.customer_members),'GRIDFABRIC_MANAGED_SDK_RECORD_CHANGED');
  else{this.journal.sdk.customer_members=members;await this.save();}
};
Receiving.prototype.receiveSdk=async function(live) {
  if(this.journal.sdk?.result) {
    const saved=await readJSON(this.journal.sdk.result.receiving_record);
    need(saved.value.state==='COMPLETE'&&saved.value.cold_operator_closed===true&&
      saved.value.operation_id===this.config.operation_id&&
      saved.value.portable?.sha256===this.journal.sdk.result.portable.sha256,
      'GRIDFABRIC_MANAGED_SDK_RECORD_CHANGED');
    need(same(await identity(saved.value.portable.path,MAX_ARTIFACT),
      {bytes:saved.value.portable.bytes,sha256:saved.value.portable.sha256}),
      'GRIDFABRIC_MANAGED_SDK_ARCHIVE_CHANGED');
    // Publish the same frozen customer result even if the preceding save outlived this copy.
    await this.receiveSdkOutputs(this.journal.sdk.result);
    return this.journal.sdk.result;
  }
  const sdkDirectory=join(this.output,'sdk-receiving-state');
  const value={schema:'commons.gridfabric-sdk-receiving-input.v1',operation_id:this.config.operation_id,
    connectionFile:live.settings.connectionFile,workspace:live.settings.workspaceDirectory,
    workspaceId:this.config.workspaceId,sourceSha256:this.journal.source.nativeSourceSha256,
    outputDirectory:sdkDirectory,exportRequestId:this.config.exportRequestId,restoreRequestId:this.config.restoreRequestId,
    restoredName:this.config.restoredName,...(this.config.minimumCollections?{minimumCollections:this.config.minimumCollections}:{})};
  const file=join(this.output,'sdk-receiving-input.json'),raw=json(value);
  if(!this.journal.sdk){this.journal.sdk={configuration:value,configuration_file:file,configuration_sha256:hash(raw),state:'PREPARED'};await this.save();}
  else need(same(this.journal.sdk.configuration,value)&&this.journal.sdk.configuration_sha256===hash(raw),
    'GRIDFABRIC_MANAGED_SDK_INPUT_CHANGED');
  await writeExact(file,raw);
  const result=await this.sdk.runGridFabricSdkReceiving({configuration:file});
  need(result.schema==='commons.gridfabric-sdk-receiving.v1'&&result.state==='COMPLETE'&&
    result.operation_id===this.config.operation_id&&result.cold_operator_closed===true&&
    result.workspace?.workspace_id===this.config.workspaceId&&result.workspace.directory===this.config.workspaceDirectory&&
    result.workspace.source_sha256===this.journal.source.nativeSourceSha256&&
    result.restored?.directory===join(dirname(this.config.workspaceDirectory),this.config.restoredName)&&
    result.restored.workspace_id===this.config.workspaceId&&result.restored.revision===result.revision&&
    result.portable?.export_id===this.config.exportRequestId&&GRIDFABRIC_HASH.test(result.portable.sha256??'')&&
    Array.isArray(result.original_files)&&result.original_files.length>0&&result.mcp?.tool_count===38,
    'GRIDFABRIC_MANAGED_SDK_RECEIVING','Receive the complete original SDK, MCP and closed cold-owner outcome.');
  this.journal.sdk.result=originalResult(result);this.journal.sdk.state='COMPLETE';await this.save();
  await this.receiveSdkOutputs(result);
  await this.event('original_sdk_mcp_portable_and_cold_receiving_complete',{revision:result.revision,
    files:result.original_files.length,portable_bytes:result.portable.bytes});
  return result;
};
Receiving.prototype.capture=async function(name,live,{baseline=false}={}) {
  const phases=this.journal.captures,previous=phases[name];
  if(previous?.complete) {
    for(const file of previous.members) {
      const actual=await identity(beneath(this.customer,file.path),MAX_ARTIFACT);
      need(actual.bytes===file.bytes&&actual.sha256===file.sha256,'GRIDFABRIC_MANAGED_OUTPUT_CHANGED');
    }
    return previous.summary;
  }
  const client=await this.borrower(live),relativeRoot='snapshots/'+name,
    root=await makeTree(this.customer,relativeRoot),members=[];
  const write=async(path,value)=>{
    const target=beneath(root,path),parent=relative(root,dirname(target)).split(sep).join('/');
    if(parent)await makeTree(root,parent);
    const file=await this.customerJSON(relative(this.customer,target).split(sep).join('/'),value);
    members.push({path:relative(this.customer,target).split(sep).join('/'),
      bytes:file.bytes,sha256:file.sha256});return file;
  };
  try {
    const first=await client.state(),launch=await client.launch();
    need(first.workspace_id===this.config.workspaceId&&first.revision===this.journal.sdk.result.revision,
      'GRIDFABRIC_MANAGED_WORKSPACE_CHANGED');
    for(const [table,count]of Object.entries(this.config.minimumCollections??{}))
      need((first.collections?.[table]??-1)>=count,'GRIDFABRIC_MANAGED_PORTFOLIO_INCOMPLETE',table);
    await write('State.json',first);await write('connections/'+live.attempt.requestId+'.json',launch);
    const tables={};
    for(const table of this.tables) {
      const rowsHash=createHash('sha256');let rows=0,pages=0,total=null;
      for await(const page of client.pages(table,{host:this.hostTables.has(table),limit:1000})) {
        need(page.collection===table&&Number.isSafeInteger(page.total)&&page.total>=0&&
          page.offset===rows&&Array.isArray(page.rows)&&page.rows.length<=page.limit,
          'GRIDFABRIC_MANAGED_PAGE_CHANGED','Receive every complete original page.',{table});
        if(total===null)total=page.total;else need(total===page.total,'GRIDFABRIC_MANAGED_PAGE_CHANGED');
        await write('tables/'+table+'/'+String(page.offset).padStart(12,'0')+'.json',page);pages++;
        for(const row of page.rows){rowsHash.update(canonical(row)+'\n');rows++;}
        need(rows<=total&&page.next_offset===(rows<total?rows:null),'GRIDFABRIC_MANAGED_PAGE_CHANGED');
      }
      need(total!==null&&rows===total,'GRIDFABRIC_MANAGED_PAGE_INCOMPLETE',table);
      tables[table]={rows,pages,sha256:rowsHash.digest('hex')};
    }
    const files=[],originals=[...this.journal.sdk.result.original_files].sort((a,b)=>a.file_id.localeCompare(b.file_id)),
      seen=new Set();
    for(const expected of originals) {
      need(!seen.has(expected.file_id)&&/^file_[a-f0-9]{64}$/.test(expected.file_id),'GRIDFABRIC_MANAGED_FILE_ROSTER');seen.add(expected.file_id);
      const info=await client.fileInfo(expected.file_id);
      need(info.workspace_id===this.config.workspaceId&&info.bytes===expected.bytes&&info.sha256===expected.sha256,
        'GRIDFABRIC_MANAGED_FILE_CHANGED');
      const value={file_id:expected.file_id,bytes:info.bytes,sha256:info.sha256};
      if(baseline) {
        const target=await makeTree(this.output,'native-downloads/'+expected.sha256);
        const received=await this.sdk.downloadGridFabricFile({client,fileId:expected.file_id,directory:target,
          expectedSha256:expected.sha256,chunkSize:196608});
        need(received.originalFile.bytes===expected.bytes&&received.originalFile.sha256===expected.sha256,
          'GRIDFABRIC_MANAGED_FILE_CHANGED');
        const complete=await this.customerDownload(relativeRoot+'/files/'+expected.sha256,
          received.originalFile,expected.file_id,received.manifestSha256);
        members.push(...complete);
        value.download={path:beneath(this.customer,complete[0].path),manifest_sha256:received.manifestSha256};
      } else {
        const digest=createHash('sha256');let offset=0,ranges=0;
        do {
          const bytes=await client.readFile(expected.file_id,{offset,limit:196608,expectedSha256:expected.sha256});
          need(bytes.length>0||offset===expected.bytes,'GRIDFABRIC_MANAGED_FILE_INCOMPLETE');
          digest.update(bytes);offset+=bytes.length;ranges++;
          need(offset<=expected.bytes,'GRIDFABRIC_MANAGED_FILE_CHANGED');
        }while(offset<expected.bytes);
        need(offset===expected.bytes&&digest.digest('hex')===expected.sha256&&
          (await client.readFile(expected.file_id,{offset,limit:196608,expectedSha256:expected.sha256})).length===0,
          'GRIDFABRIC_MANAGED_FILE_CHANGED');
        value.ranges=ranges;
      }
      files.push(value);await write('file-identities/'+expected.sha256+'.json',{...value,native_file_info:info});
    }
    const last=await client.state();
    need(same(first,last),'GRIDFABRIC_MANAGED_WORKSPACE_CHANGED',
      'Retain a stable original workspace across complete table and file receiving.');
    const summary={workspace_id:first.workspace_id,revision:first.revision,collections:first.collections,tables,
      original_files:files.map(({file_id,bytes,sha256})=>({file_id,bytes,sha256}))};
    if(baseline) {
      if(this.journal.baseline)need(same(this.journal.baseline,summary),'GRIDFABRIC_MANAGED_BASELINE_CHANGED');
      else{this.journal.baseline=summary;await this.save();}
    } else need(same(this.journal.baseline,summary),'GRIDFABRIC_MANAGED_REOPEN_CHANGED',
      'The complete reopened native rows and original file bytes differ from the received workspace.');
    await write('Complete_Comparison.json',{schema:'commons.gridfabric-managed-comparison.v1',
      name,baseline,summary,complete:true,source_sha256:this.journal.source.nativeSourceSha256,
      original_directory:live.settings.workspaceDirectory});
    phases[name]={complete:true,completed_at:now(),summary,members};await this.save();
    await this.event('complete_'+name+'_tables_and_files_received',{tables:Object.keys(tables).length,
      rows:Object.values(tables).reduce((sum,item)=>sum+item.rows,0),files:files.length});
    return summary;
  }finally{await this.closeBorrower(client);}
};
Receiving.prototype.workflow=async function() {
  const primaryDirectory=this.config.workspaceDirectory,
    connectionFile=this.config.connectionFile??join(primaryDirectory,'gridfabric-connection.txt'),
    readyFile=this.config.readyFile??join(dirname(connectionFile),'gridfabric-application-ready.json');
  const settings={workspaceDirectory:primaryDirectory,connectionFile,readyFile,port:0,
    ...(this.config.environmentFile?{environmentFile:this.config.environmentFile}:{})};
  await this.ensureApplication('original',settings);
  if(!this.journal.captures.original?.complete) {
    const live=await this.running('original_receiving','original');
    await this.receiveSdk(live);await this.capture('original',live,{baseline:true});
  } else await this.capture('original',null,{baseline:true});
  await this.stopRole('original_receiving');
  if(!this.journal.captures.restarted?.complete) {
    const live=await this.running('original_restart','original');
    await this.capture('restarted',live);
  } else await this.capture('restarted',null);
  await this.stopRole('original_restart');
  const sdk=this.journal.sdk?.result;
  need(sdk?.cold_operator_closed===true,'GRIDFABRIC_MANAGED_COLD_OWNER_NOT_CLOSED');
  const coldDirectory=sdk.restored.directory;
  await this.ensureApplication('restored',{workspaceDirectory:coldDirectory,
    connectionFile:join(coldDirectory,'gridfabric-connection.txt'),
    readyFile:join(coldDirectory,'gridfabric-application-ready.json'),port:0,
    ...(this.config.environmentFile?{environmentFile:this.config.environmentFile}:{})});
  if(!this.journal.captures.restored?.complete) {
    const live=await this.running('restored_receiving','restored');
    await this.capture('restored',live);
  } else await this.capture('restored',null);
  await this.stopRole('restored_receiving');
  for(const role of Object.values(this.journal.roles))for(const attempt of role.attempts)
    need(attempt.closed,'GRIDFABRIC_MANAGED_OWNER_RETAINED');
  this.journal.product_result={schema:RESULT,status:'COMPLETE',operation_id:this.config.operation_id,
    classification:this.config.classification??'Complete native GridFabric SQLite/HTTP/CLI, SDK/MCP and managed Applications receiving from the supplied populated workspace.',
    original_workspace:{directory:primaryDirectory,workspace_id:this.config.workspaceId,revision:this.journal.baseline.revision},
    restored_workspace:sdk.restored,source:this.journal.source,
    runtime:{directory:this.journal.runtime.directory,runtime_id:this.journal.runtime.runtimeId,
      control_workspace_id:this.journal.controlWorkspaceId},
    applications:Object.fromEntries(Object.entries(this.journal.applications).map(([name,value])=>[name,
      {application_id:value.applicationId,revision:value.revision,save_request_id:value.saveRequestId,release:value.release}])),
    lifecycle:Object.fromEntries(Object.entries(this.journal.roles).map(([name,role])=>[name,
      role.attempts.map(attempt=>({request_id:attempt.requestId,closed:attempt.closed,closure:attempt.closure,
        terminal:attempt.terminal?{phase:attempt.terminal.phase,result:attempt.terminal.result}:null}))])),
    complete_comparison:this.journal.baseline,portable:sdk.portable,
    mcp:sdk.mcp,cold_operator_closed:sdk.cold_operator_closed,
    all_managed_owners_closed:true,receiver_management_dispatches:0,receiver_device_dispatches:0,
    browser:{status:'NOT_REQUESTED',reason:'This receiving entry operates the original Applications model, HTTP SDK/MCP and native CLI.'},
    completed_at:now()};
  this.journal.status='PRODUCT_COMPLETE';await this.save();
};

function customerManifest(journal,members) {
  return {schema:'commons.gridfabric-managed-customer-manifest.v1',operation_id:journal.operation_id,
    completed_at:journal.product_result.completed_at,product:journal.product_result.schema,
    source:journal.source,workspace:journal.product_result.original_workspace,
    files:members,file_count:members.length,file_bytes:members.reduce((sum,item)=>sum+item.bytes,0)};
}
async function verifyCustomerAuthority(receiving,{manifestIdentity=null}={}) {
  const {journal,customer}=receiving;
  await receiving.resumeCustomer();
  need(plain(journal.customer_members)&&Object.keys(journal.customer_members).length>0,
    'GRIDFABRIC_MANAGED_CUSTOMER_DECLARATION','Use the original retained customer member authority.');
  const entries=Object.entries(journal.customer_members).map(([path,value])=>({path,...value}))
    .sort((a,b)=>a.path.localeCompare(b.path)),byPath=new Map(entries.map(file=>[file.path,file]));
  const requireMember=file=>{
    const path=file.path.startsWith('/')?relative(customer,file.path).split(sep).join('/'):file.path;
    memberName(path);const declared=byPath.get(path);
    need(declared&&declared.bytes===file.bytes&&declared.sha256===file.sha256,
      'GRIDFABRIC_MANAGED_CUSTOMER_DECLARATION',path);
  };
  for(const path of ['Source_Identity.json','SDK_Receiving_Result.json','Operation.json','Original_Requests.json'])
    need(byPath.has(path),'GRIDFABRIC_MANAGED_CUSTOMER_DECLARATION',path);
  need(Array.isArray(journal.sdk?.customer_members)&&journal.sdk.customer_members.length===6,
    'GRIDFABRIC_MANAGED_SDK_OUTPUT_INCOMPLETE');
  journal.sdk.customer_members.forEach(requireMember);
  for(const name of ['original','restarted','restored']) {
    const phase=journal.captures[name];
    need(phase?.complete&&Array.isArray(phase.members)&&phase.members.length>0&&same(phase.summary,journal.baseline),
      'GRIDFABRIC_MANAGED_PHASE_INCOMPLETE',name);
    phase.members.forEach(requireMember);
  }
  for(const role of Object.values(journal.roles))for(const attempt of role.attempts) {
    need(attempt.closed,'GRIDFABRIC_MANAGED_OWNER_RETAINED');
    if(!attempt.terminal)continue;
    need(attempt.operation_capture_complete&&attempt.lease_proof&&Array.isArray(attempt.original_operation_files),
      'GRIDFABRIC_MANAGED_LIFECYCLE_OUTPUT_INCOMPLETE',attempt.requestId);
    for(const file of [...attempt.original_operation_files,...attempt.lease_proof.files])requireMember(file);
    need(byPath.has('lifecycle/'+role.application_key+'/'+attempt.requestId+'/Receiving_Disposition.json'),
      'GRIDFABRIC_MANAGED_LIFECYCLE_OUTPUT_INCOMPLETE',attempt.requestId);
  }
  for(const file of entries) {
    memberName(file.path);need(file.path!=='manifest.json'&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&
      GRIDFABRIC_HASH.test(file.sha256),'GRIDFABRIC_MANAGED_CUSTOMER_DECLARATION',file.path);
    const path=beneath(customer,file.path),actual=await identity(path,MAX_ARTIFACT);
    need(actual.bytes===file.bytes&&actual.sha256===file.sha256,'GRIDFABRIC_MANAGED_CUSTOMER_CHANGED',file.path);
    // An exact recorded final can outlive unlink of its own deterministic stage.
    const stage=path+'.pending-'+file.sha256,pending=await optionalIdentity(stage);
    if(pending) {
      need(pending.bytes===file.bytes&&pending.sha256===file.sha256,'GRIDFABRIC_MANAGED_STAGE_CHANGED',file.path);
      await unlink(stage);await syncDirectory(dirname(stage));
    }
  }
  await validateMembers(customer,entries,{manifestIdentity});
  return entries;
}
async function validateMembers(customer,manifest,{manifestIdentity=null}={}) {
  const actual=await allFiles(customer),expected=new Map(manifest.map(file=>[file.path,file]));
  if(manifestIdentity)expected.set('manifest.json',{path:'manifest.json',...manifestIdentity});
  need(actual.length===expected.size,'GRIDFABRIC_MANAGED_CUSTOMER_ROSTER',
    'Preserve and resolve any undeclared customer files before continuing the exact frozen package.');
  for(const file of actual) {
    const selected=expected.get(file.path);
    need(selected&&file.bytes===selected.bytes&&file.sha256===selected.sha256,'GRIDFABRIC_MANAGED_CUSTOMER_CHANGED',file.path);
  }
  return actual;
}
async function validateTar(path,expectedFiles,cwd) {
  const before=await identity(path,MAX_ARTIFACT,{privateOnly:true});
  const listing=await runProcess('tar',['-tzf',path],{cwd,maximum:16*1024*1024,timeout:300000});
  const lines=listing.stdout.toString('utf8').split('\n').filter(Boolean),members=[];
  for(const line of lines) {
    need(line==='.'||line==='./'||line.startsWith('./'),'GRIDFABRIC_MANAGED_ARCHIVE_MEMBER');
    const name=line.replace(/^\.\//,'');
    if(!name||name==='.'||name.endsWith('/'))continue;
    memberName(name);members.push(name);
  }
  need(members.length===expectedFiles.length&&new Set(members).size===members.length&&
    same(members.sort(),expectedFiles.map(file=>file.path).sort()),'GRIDFABRIC_MANAGED_ARCHIVE_ROSTER');
  need(same(await identity(path,MAX_ARTIFACT),before),'GRIDFABRIC_MANAGED_ARCHIVE_CHANGED');
  return {...before,verification:{native_tar_exit_code:listing.code,complete_member_count:members.length,
    complete_gzip_and_tar_read:true}};
}
async function publishArtifact(stage,path,expected) {
  const existing=await optionalIdentity(path);
  if(existing)need(existing.bytes===expected.bytes&&existing.sha256===expected.sha256,'GRIDFABRIC_MANAGED_ARCHIVE_CHANGED');
  else {
    need(same(await identity(stage,MAX_ARTIFACT,{privateOnly:true}),{bytes:expected.bytes,sha256:expected.sha256}),'GRIDFABRIC_MANAGED_ARCHIVE_CHANGED');
    try{await link(stage,path);}catch(error){if(error.code!=='EEXIST')throw error;
      need(same(await identity(path,MAX_ARTIFACT),{bytes:expected.bytes,sha256:expected.sha256}),'GRIDFABRIC_MANAGED_ARCHIVE_CHANGED');}
    await syncDirectory(dirname(path));
  }
  const prior=await optionalIdentity(stage);
  if(prior){need(prior.bytes===expected.bytes&&prior.sha256===expected.sha256,'GRIDFABRIC_MANAGED_ARCHIVE_CHANGED');
    await unlink(stage);await syncDirectory(dirname(stage));}
  return {path,bytes:expected.bytes,sha256:expected.sha256};
}
async function finalize(receiving) {
  const {journal,customer,output}=receiving;
  need(journal.product_result?.status==='COMPLETE','GRIDFABRIC_MANAGED_PRODUCT_REQUIRED');
  journal.freeze??={created_at:now(),operation_document:journal.product_result,
    request_document:{schema:'commons.gridfabric-managed-original-requests.v1',operation_id:journal.operation_id,
      input:journal.input,applications:originalResult(journal.applications),roles:originalResult(journal.roles),
      sdk_configuration:journal.sdk.configuration,history:originalResult(journal.history)}};
  await receiving.save();
  await receiving.customerJSON('Operation.json',journal.freeze.operation_document);
  await receiving.customerJSON('Original_Requests.json',journal.freeze.request_document);
  let previousManifest=null;
  if(journal.freeze.members) {
    const raw=json(customerManifest(journal,journal.freeze.members));
    previousManifest={bytes:raw.length,sha256:hash(raw)};
    if(journal.freeze.manifest)need(same(journal.freeze.manifest,previousManifest),'GRIDFABRIC_MANAGED_MANIFEST_CONFLICT');
    await writeExact(join(customer,'manifest.json'),raw);
  }
  const declared=await verifyCustomerAuthority(receiving,{manifestIdentity:previousManifest});
  if(journal.freeze.members)need(same(declared,journal.freeze.members),'GRIDFABRIC_MANAGED_CUSTOMER_DECLARATION');
  else{journal.freeze.members=declared;await receiving.save();}
  const manifest=customerManifest(journal,journal.freeze.members);
  const raw=json(manifest),manifestIdentity={bytes:raw.length,sha256:hash(raw)};
  await writeExact(join(customer,'manifest.json'),raw);
  const files=await validateMembers(customer,journal.freeze.members,{manifestIdentity});
  journal.freeze.manifest=manifestIdentity;await receiving.save();
  const final=join(output,'GridFabric_Managed_Customer_Result.tar.gz');
  if(journal.package?.state==='COMPLETE') {
    need(same(await identity(final,MAX_ARTIFACT),{bytes:journal.package.bytes,sha256:journal.package.sha256}),
      'GRIDFABRIC_MANAGED_ARCHIVE_CHANGED');
    return {schema:RESULT,status:'COMPLETE',operation_id:journal.operation_id,productPassed:true,
      report:join(customer,'Operation.json'),manifest:join(customer,'manifest.json'),archive:journal.package,
      all_managed_owners_closed:true,reused:true};
  }
  journal.archive_attempts??=[];let attempt=journal.archive_attempts.at(-1),verified=null;
  if(attempt) {
    const published=await optionalIdentity(final);
    if(published&&attempt.verified) {
      need(published.bytes===attempt.verified.bytes&&published.sha256===attempt.verified.sha256,
        'GRIDFABRIC_MANAGED_ARCHIVE_CHANGED');
      verified=attempt.verified;
    } else if(await optionalIdentity(attempt.path)) {
      try {verified=await validateTar(attempt.path,files,output);}
      catch(error) {
        // Retain an uncertain or partial packaging attempt; a new packaging file never overwrites it.
        attempt.recovery_error=failure(error);attempt.state='RETAINED_INCOMPLETE';await receiving.save();attempt=null;
      }
    } else if(attempt.verified)need(false,'GRIDFABRIC_MANAGED_ARCHIVE_MISSING');
    else attempt=null;
  }
  if(!attempt) {
    attempt={id:randomUUID(),state:'PREPARED',created_at:now()};
    attempt.path=join(output,'gridfabric-customer-'+attempt.id+'.tar.gz.pending');
    journal.archive_attempts.push(attempt);await receiving.save();
    // Tar truncates this exact private recorded file; it never inherits a permissive host umask.
    const archiveHandle=await open(attempt.path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await archiveHandle.sync();}finally{await archiveHandle.close();}
    await syncDirectory(output);
    const args=['--format=posix','--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner',
      '--pax-option=delete=atime,delete=ctime,exthdr.name=%d/PaxHeaders/%f','-czf',attempt.path,'-C',customer,'.'];
    const command=await runProcess('tar',args,{cwd:output,timeout:600000,onStarted:async pid=>{
      attempt.pid=pid;attempt.state='STARTED';attempt.args=args;await receiving.save();}});
    attempt.command={exit_code:command.code,stdout:command.stdout.toString('utf8'),stderr:command.stderr.toString('utf8')};
    verified=await validateTar(attempt.path,files,output);
  }
  await validateMembers(customer,journal.freeze.members,{manifestIdentity});
  attempt.verified=verified;attempt.state='VERIFIED';await receiving.save();
  const archive=await publishArtifact(attempt.path,final,verified);
  journal.package={...archive,state:'COMPLETE',verification:verified.verification,completed_at:now()};
  journal.status='COMPLETE';await receiving.save();
  return {schema:RESULT,status:'COMPLETE',operation_id:journal.operation_id,productPassed:true,
    report:join(customer,'Operation.json'),manifest:join(customer,'manifest.json'),archive:journal.package,
    all_managed_owners_closed:true};
}

export async function runGridFabricManagedReceiving({configuration:configurationFile}={}) {
  configurationFile=absolute(configurationFile,'Receiving configuration');
  const originalInput=await readJSON(configurationFile,1024*1024),config=configuration(originalInput.value);
  const normalized=originalResult(config),inputHash=hash(json(normalized));
  for(const path of [config.workspaceDirectory,config.runtimeDirectory,config.runtimeWorkspaceDirectory])
    await directory(path);
  await directory(config.outputDirectory,{create:true});
  for(const root of [config.workspaceDirectory,join(dirname(config.workspaceDirectory),config.restoredName),
    config.runtimeDirectory,config.runtimeWorkspaceDirectory]) {
    const part=relative(root,config.outputDirectory);
    need(part!==''&&part!=='..'&&(part.startsWith('..'+sep)||part.startsWith(sep)),
      'GRIDFABRIC_MANAGED_OUTPUT_DIRECTORY','Keep receiving output outside all native/runtime/control workspaces.');
  }
  const output=config.outputDirectory,customer=join(output,'customer'),lease=await acquireStateLease(output);
  let receiving=null,primary=null,result=null;
  try {
    const path=join(output,'receiving.json'),saved=await optional(path);
    let journal;
    if(saved) {
      const candidate=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(saved.raw));
      need(candidate.schema===JOURNAL&&candidate.operation_id===config.operation_id&&candidate.input_sha256===inputHash&&
        same(candidate.input,normalized),'GRIDFABRIC_MANAGED_RECEIVING_CONFLICT',
        'Continue this output directory with its exact original operation and full input.');
      journal=candidate;
    } else journal={schema:JOURNAL,operation_id:config.operation_id,input:normalized,input_sha256:inputHash,
      original_input:{path:configurationFile,bytes:originalInput.bytes,sha256:originalInput.sha256},
      status:'PREPARED',created_at:now(),history:[],applications:{},roles:{},captures:{}};
    await directory(customer,{create:true});
    const invocationId=randomUUID();
    receiving=new Receiving({config,output,customer,journal,journalIdentity:saved?{bytes:saved.bytes,sha256:saved.sha256}:null,
      lease,invocationId});
    await receiving.save();
    await receiving.resumeCustomer();
    // Completed product/package recovery precedes any Applications, SDK or native owner dispatch.
    if(journal.product_result)result=await finalize(receiving);
    else {
      journal.invocations??=[];journal.invocations.push({id:invocationId,started_at:now(),pid:process.pid});await receiving.save();
      await receiving.source();await receiving.workflow();await receiving.close();
      result=await finalize(receiving);
    }
  } catch(error) {
    primary=error;
    if(receiving) {
      receiving.journal.last_error={at:now(),...failure(error)};
      receiving.journal.status=receiving.journal.product_result?'PRODUCT_COMPLETE_DELIVERY_PENDING':'INTERRUPTED';
      try{await receiving.save();}catch(saveError){error.receivingJournalError=failure(saveError);}
    }
  } finally {
    if(receiving)try{await receiving.close();}catch(error){
      if(primary)primary.receivingCloseError=failure(error);else primary=error;
    }
    try{await lease.close();}catch(error){if(primary)primary.receivingLeaseError=failure(error);else primary=error;}
  }
  if(primary)throw primary;
  return result;
}
export async function main(argv=process.argv.slice(2)) {
  if(argv.length===1&&['--help','help'].includes(argv[0])) {
    process.stdout.write('GridFabric managed receiving\n\nnode run-receiving.mjs --configuration PRIVATE_INPUT.json\n'+
      'Use the existing populated GridFabric workspace, READY selected runtime and original Applications workspace.\n');
    return;
  }
  need(argv.length===2&&argv[0]==='--configuration','GRIDFABRIC_MANAGED_ARGUMENTS');
  const result=await runGridFabricManagedReceiving({configuration:resolve(argv[1])});
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:failure(error),
    ...(error.receivingCloseError?{receiving_close_error:error.receivingCloseError}:{})})+'\n');process.exitCode=1;});
