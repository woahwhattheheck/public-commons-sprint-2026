// SPDX-License-Identifier: MIT
// Whole original Runtime workspace archives, retained transfers and cold receiving.
import {constants, createReadStream, fstatSync, closeSync, lstatSync} from 'node:fs';
import {open, mkdir, readdir, readFile, lstat, realpath, rename} from 'node:fs/promises';
import {join, dirname, resolve, sep, basename} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Transform} from 'node:stream';
import {absolute, privateDirectory, readJSON, saveJSON, operationId, operationLease,
  operationRunning, withWorkspaceBackup, workspaceLeaseDescriptor, workspaceReceivingState,
  need, fail, now, canonical, json, processIdentity} from './storage.mjs';

const HERE=fileURLToPath(import.meta.url), PYTHON=fileURLToPath(new URL('./workspace-backup.py',import.meta.url));
const SCHEMA='stellar-forge.runtime-workspace-backup-operation.v1';
const MAX_BYTES=64*1024*1024*1024, MAX_RECORD=64*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>json(canonical(a))===json(canonical(b));
const hashId=value=>{need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'WORKSPACE_BACKUP_DIGEST');return value;};
const inside=(child,parent)=>child===parent||child.startsWith(parent+sep);
const failure=error=>({code:error.code??'WORKSPACE_BACKUP_FAILED',message:String(error.message??error).slice(0,4000)});
async function directory(path){
  try{
    await mkdir(path,{mode:0o700});
    const parent=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await parent.sync();}finally{await parent.close();}
  }catch(error){if(error.code!=='EEXIST')throw error;}
  return privateDirectory(path);
}
async function boundedJSON(path,optional=false){
  let handle;try{
    handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    const before=await handle.stat();need(before.isFile()&&before.size<=MAX_RECORD,'WORKSPACE_BACKUP_RECORD');
    const bytes=await handle.readFile(),after=await handle.stat();
    need(before.ino===after.ino&&before.dev===after.dev&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&bytes.length===before.size,'WORKSPACE_BACKUP_RECORD_CHANGED');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}finally{await handle?.close();}
}
async function fileDigest(path){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await handle.stat();need(before.isFile()&&before.size<=MAX_BYTES,'WORKSPACE_BACKUP_ARCHIVE');
    const digest=createHash('sha256');let bytes=0;
    for await(const chunk of handle.createReadStream({autoClose:false})){bytes+=chunk.length;digest.update(chunk);}
    const after=await handle.stat();need(bytes===before.size&&before.ino===after.ino&&before.dev===after.dev&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'WORKSPACE_BACKUP_ARCHIVE_CHANGED');
    return {bytes,sha256:digest.digest('hex'),identity:{dev:after.dev,ino:after.ino,size:after.size,mtimeMs:after.mtimeMs,ctimeMs:after.ctimeMs}};
  }finally{await handle.close();}
}
async function storeFor(root,options={}){
  const receiving=options.storageDirectory===undefined?await workspaceReceivingState(root):null;
  const selected=absolute(options.storageDirectory??receiving?.storageDirectory??root+'.backups');
  need(!inside(selected,root)&&!inside(root,selected),'WORKSPACE_BACKUP_STORAGE_OVERLAP','Select a private backup directory outside this workspace.');
  need(await realpath(dirname(selected))===dirname(selected),'WORKSPACE_BACKUP_STORAGE_PARENT');
  for(let ancestor=selected;;ancestor=dirname(ancestor)){
    const config=await boundedJSON(join(ancestor,'workspace.json'),true);
    need(config?.schema!=='stellar-forge.runtime-workspace.v1','WORKSPACE_BACKUP_STORAGE_IN_WORKSPACE','Keep backup storage outside every Runtime workspace.');
    if(dirname(ancestor)===ancestor)break;
  }
  await directory(selected);
  for(const name of ['reviews','operations','incoming','inspections','binding-reviews'])await directory(join(selected,name));
  const file=join(selected,'store.json');
  const current=await boundedJSON(file,true);
  if(current)need(current.schema==='stellar-forge.runtime-workspace-backup-store.v1'&&current.directory===selected,'WORKSPACE_BACKUP_STORAGE_IDENTITY');
  else try{await saveJSON(file,{schema:'stellar-forge.runtime-workspace-backup-store.v1',directory:selected,createdAt:now()});}
    catch(error){if(error.code!=='EEXIST')throw error;const actual=await boundedJSON(file);need(actual.directory===selected&&actual.schema==='stellar-forge.runtime-workspace-backup-store.v1','WORKSPACE_BACKUP_STORAGE_IDENTITY');}
  return selected;
}
async function listRecords(parent,filename){
  const out=[];for(const name of (await readdir(parent)).sort()){
    if(!/^(?:[a-f0-9]{64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(name))continue;
    await privateDirectory(join(parent,name));
    const value=await boundedJSON(join(parent,name,filename),true);if(value)out.push(value);
  }return out;
}
function python(action,params,{gateFd=null,operationFd=null}={}){
  return new Promise((resolvePromise,reject)=>{
    let output='',errors='',settled=false;const env={...process.env};
    delete env.STARFORGE_BACKUP_GATE_FD;delete env.STARFORGE_BACKUP_OPERATION_FD;
    const stdio=['pipe','pipe','pipe',gateFd??'ignore',operationFd??'ignore'];
    if(gateFd!==null)env.STARFORGE_BACKUP_GATE_FD='3';
    if(operationFd!==null)env.STARFORGE_BACKUP_OPERATION_FD='4';
    const child=spawn(process.env.STARFORGE_PYTHON||'python3',['-B',PYTHON,action],{stdio,env,shell:false});
    const finish=(error,value)=>{if(settled)return;settled=true;error?reject(error):resolvePromise(value);};
    child.once('error',error=>finish(error));
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output+=chunk;if(Buffer.byteLength(output)>MAX_RECORD){child.kill('SIGTERM');finish(Object.assign(new Error('Backup response exceeds its bounded complete record.'),{code:'WORKSPACE_BACKUP_RESPONSE_LIMIT'}));}});
    child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-65536);});
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')finish(error);});
    child.once('close',(status,signal)=>{
      let result;try{result=JSON.parse(output);}catch{
        finish(Object.assign(new Error('Original backup worker did not return a complete record: '+errors),{code:'WORKSPACE_BACKUP_WORKER_RETURN',exitCode:status,signal}));return;
      }
      if(status!==0||result.ok!==true)finish(Object.assign(new Error(result.error?.message||errors||'Original backup worker failed.'),{code:result.error?.code??'WORKSPACE_BACKUP_WORKER_FAILED',exitCode:status,signal}));
      else finish(null,result.result);
    });
    const input=json(params);if(Buffer.byteLength(input)>1024*1024){child.kill('SIGTERM');finish(Object.assign(new Error('Backup request exceeds its bounded controller input.'),{code:'WORKSPACE_BACKUP_REQUEST_LIMIT'}));return;}
    child.stdin.end(input);
  });
}
async function operationView(store,id){
  operationId(id);const path=join(store,'operations',id);await privateDirectory(path);
  const value=await boundedJSON(join(path,'operation.json'));
  need(value.schema===SCHEMA&&value.operationId===id,'WORKSPACE_BACKUP_OPERATION_IDENTITY');
  if(value.phase==='COMPLETE'){
    if(value.kind!=='RESTORE')return value;
    try{
      const directory=absolute(value.input.directory);await privateDirectory(directory);
      const marker=await workspaceReceivingState(directory);
      need(marker?.receivingId===id&&marker.directory===value.result.directory&&marker.workspaceId===value.result.workspaceId&&
        marker.archiveId===value.input.archiveId&&marker.manifestSha256===value.input.manifestSha256,'WORKSPACE_BACKUP_RECEIVING_CHANGED');
      return {...value,receiving:{available:true,...marker}};
    }catch(error){return {...value,receiving:{available:false,status:error.code==='ENOENT'?'MISSING':'UNAVAILABLE',error:failure(error)}};}
  }
  try{
    const active=await operationRunning(join(path,'worker.lock'));
    return {...value,workerActive:active,recordedPhase:value.phase,
      phase:active?value.phase:['QUEUED','RUNNING'].includes(value.phase)?'INTERRUPTED':value.phase};
  }catch(error){return {...value,workerActive:null,observation:{status:'UNAVAILABLE',error:failure(error)}};}
}
async function uploadView(store,id){
  operationId(id);const folder=join(store,'incoming',id),record=await boundedJSON(join(folder,'upload.json'));
  need(record.uploadId===id&&record.requestId===id,'WORKSPACE_BACKUP_UPLOAD_IDENTITY');
  const completePath=join(folder,'archive.tar.gz'),pending=join(folder,'archive.pending');
  let info,path;
  try{info=await lstat(completePath);path=completePath;}
  catch(error){if(error.code!=='ENOENT')throw error;try{info=await lstat(pending);path=pending;}catch(next){if(next.code!=='ENOENT')throw next;}}
  if(info)need(info.isFile()&&!info.isSymbolicLink()&&info.size<=record.bytes,'WORKSPACE_BACKUP_UPLOAD_CHANGED');
  const complete=path===completePath;
  need(!complete||info.size===record.bytes,'WORKSPACE_BACKUP_UPLOAD_CHANGED');
  return {...record,receivedBytes:info?.size??0,complete,archivePath:complete?completePath:null};
}
async function startOperation(root,store,kind,input,{continueOriginal=false}={}){
  const id=operationId(input.requestId),folder=await directory(join(store,'operations',id));
  const original={kind,root,store,input},requestHash=hash(json(canonical(original))),requestFile=join(folder,'request.json');
  const previous=await boundedJSON(requestFile,true);
  if(previous)need(previous.requestHash===requestHash&&same(previous.original,original),'WORKSPACE_BACKUP_REQUEST_REUSED','This request ID belongs to a different complete operation.');
  else try{await saveJSON(requestFile,{schema:SCHEMA,operationId:id,requestHash,original,createdAt:now()});}
  catch(error){if(error.code!=='EEXIST')throw error;const other=await boundedJSON(requestFile);need(other.requestHash===requestHash&&same(other.original,original),'WORKSPACE_BACKUP_REQUEST_REUSED');}
  let lease;
  try{lease=await operationLease(join(folder,'worker.lock'));}
  catch(error){if(error.code==='RUNTIME_WORKSPACE_OPERATION_RUNNING')return operationView(store,id);throw error;}
  try{
    const record=await boundedJSON(join(folder,'operation.json'),true);
    if(record&&(!continueOriginal||record.phase==='COMPLETE')){
      // The observer must not mistake this request-reconciliation lease for a worker.
      const held=lease;lease=null;await held.close();
      return operationView(store,id);
    }
    const current={...(record??{}),schema:SCHEMA,operationId:id,kind,input,root,storageDirectory:store,
      createdAt:record?.createdAt??now(),updatedAt:now(),phase:'QUEUED',error:null,
      attempt:(record?.attempt??0)+1};
    await saveJSON(join(folder,'operation.json'),current,Boolean(record));
    const log=await open(join(folder,'worker.log'),constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW,0o600);
    try{
      const child=spawn(process.execPath,[HERE,'--worker',root,store,id],{cwd:store,shell:false,detached:true,
        stdio:['ignore',log.fd,log.fd,lease.fd]});
      await new Promise((done,reject)=>{child.once('spawn',done);child.once('error',reject);});child.unref();
    }catch(error){
      const actual=await boundedJSON(join(folder,'operation.json'));
      await saveJSON(join(folder,'operation.json'),{...actual,phase:'FAILED',updatedAt:now(),error:failure(error)},true);throw error;
    }finally{await log.close();}
    return current;
  }finally{await lease?.close();}
}
async function runWorker(root,store,id){
  absolute(root);await privateDirectory(store);operationId(id);const folder=await privateDirectory(join(store,'operations',id));
  const inherited=fstatSync(3),named=lstatSync(join(folder,'worker.lock'));
  need(inherited.isFile()&&inherited.dev===named.dev&&inherited.ino===named.ino&&named.nlink===1&&!(named.mode&0o077),'WORKSPACE_BACKUP_WORKER_LEASE');
  const request=await boundedJSON(join(folder,'request.json')),original=request.original;
  need(request.operationId===id&&original.root===root&&original.store===store&&request.requestHash===hash(json(canonical(original))),'WORKSPACE_BACKUP_REQUEST_CHANGED');
  let current=await boundedJSON(join(folder,'operation.json'));
  try{
    const worker={pid:process.pid,processStart:await processIdentity(),startedAt:now()};
    current={...current,phase:'RUNNING',updatedAt:now(),worker,error:null};
    await saveJSON(join(folder,'operation.json'),current,true);
    const params={...original.input,root,store,operationId:id,operationDirectory:folder,createdAt:current.createdAt};
    if(original.kind==='EXPORT'){
      await withWorkspaceBackup(root,()=>python('export',params,{gateFd:workspaceLeaseDescriptor(root),operationFd:3}));
    }else if(original.kind==='RESTORE'){
      // The Python receiver creates/adopts only the original vacant destination,
      // then takes the exact same kernel gate before any original member write.
      await python('restore',params,{operationFd:3});
    }else fail('WORKSPACE_BACKUP_OPERATION_KIND');
  }catch(error){
    const actual=await boundedJSON(join(folder,'operation.json'));
    if(actual.phase!=='COMPLETE')await saveJSON(join(folder,'operation.json'),{...actual,phase:'FAILED',updatedAt:now(),error:failure(error)},true);
    process.stderr.write(json(failure(error)));process.exitCode=1;
  }finally{closeSync(3);}
}
export function createWorkspaceBackupAPI(directory_){
  const root=absolute(directory_);
  return {
    async workspaceBackupState(options={}){
      const store=await storeFor(root,options),receiving=await workspaceReceivingState(root),config=await readJSON(join(root,'workspace.json'),true);
      need(config||receiving?.phase==='RESTORING','WORKSPACE_BACKUP_WORKSPACE_IDENTITY');
      const operations=[];for(const row of await listRecords(join(store,'operations'),'operation.json'))operations.push(await operationView(store,row.operationId));
      const uploads=[];for(const row of await listRecords(join(store,'incoming'),'upload.json'))uploads.push(await uploadView(store,row.uploadId));
      return {workspaceId:config?.workspaceId??receiving.workspaceId,directory:root,storageDirectory:store,
        receiving,reviews:await listRecords(join(store,'reviews'),'review.json'),operations,uploads,
        inspections:await listRecords(join(store,'inspections'),'inspection.json')};
    },
    async workspaceBackupReview(options={}){
      operationId(options.requestId);need(typeof options.label==='string'&&options.label.trim()&&options.label.length<=120,'WORKSPACE_BACKUP_LABEL');
      const store=await storeFor(root,options);await directory(join(store,'reviews',options.requestId));
      return withWorkspaceBackup(root,()=>python('review',{root,store,requestId:options.requestId,label:options.label.trim()},{gateFd:workspaceLeaseDescriptor(root)}));
    },
    async workspaceBackupCreate(options={}){
      const store=await storeFor(root,options);
      return startOperation(root,store,'EXPORT',{requestId:operationId(options.requestId),reviewId:operationId(options.reviewId),reviewSha256:hashId(options.reviewSha256)});
    },
    async workspaceBackupInspect(options={}){
      const store=await storeFor(root,options);hashId(options.sha256);
      need(Boolean(options.archivePath)!==Boolean(options.uploadId),'WORKSPACE_BACKUP_ARCHIVE_SELECTION');
      let archivePath;
      if(options.uploadId){const value=await uploadView(store,options.uploadId);need(value.complete&&value.sha256===options.sha256,'WORKSPACE_BACKUP_UPLOAD_INCOMPLETE');archivePath=value.archivePath;}
      else archivePath=absolute(options.archivePath);
      return python('inspect',{store,archivePath,sha256:options.sha256});
    },
    async workspaceBackupUpload(options={}){
      const store=await storeFor(root,options),id=operationId(options.requestId),sha256=hashId(options.sha256);
      need(Number.isSafeInteger(options.bytes)&&options.bytes>0&&options.bytes<=MAX_BYTES&&Number.isSafeInteger(options.offset)&&options.offset>=0&&options.offset<=options.bytes,'WORKSPACE_BACKUP_UPLOAD_SIZE');
      need(options.body&&typeof options.body[Symbol.asyncIterator]==='function','WORKSPACE_BACKUP_UPLOAD_BODY');
      const folder=await directory(join(store,'incoming',id)),lease=await operationLease(join(folder,'upload.lock'));
      try{
        const file=join(folder,'upload.json'),previous=await boundedJSON(file,true);
        if(previous)need(previous.bytes===options.bytes&&previous.sha256===sha256&&previous.requestId===id,'WORKSPACE_BACKUP_UPLOAD_REQUEST_CHANGED');
        else await saveJSON(file,{schema:'stellar-forge.runtime-workspace-backup-upload.v1',uploadId:id,requestId:id,bytes:options.bytes,sha256,createdAt:now(),receivedBytes:0,complete:false});
        let current=await uploadView(store,id);
        if(current.complete){for await(const _ of options.body){}return current;}
        need(current.receivedBytes===options.offset,'WORKSPACE_BACKUP_UPLOAD_OFFSET','Reopen the retained upload offset before sending this original archive.');
        const pending=join(folder,'archive.pending'),handle=await open(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
        try{
          const initial=await handle.stat();need(initial.isFile()&&initial.size===options.offset,'WORKSPACE_BACKUP_UPLOAD_OFFSET');
          let position=options.offset;
          for await(const raw of options.body){
            const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
            need(position+chunk.length<=options.bytes,'WORKSPACE_BACKUP_UPLOAD_OVERRUN');
            let used=0;while(used<chunk.length){const result=await handle.write(chunk,used,chunk.length-used,position);need(result.bytesWritten>0,'WORKSPACE_BACKUP_UPLOAD_WRITE');used+=result.bytesWritten;position+=result.bytesWritten;}
          }
          await handle.sync();
        }finally{await handle.close();}
        current=await uploadView(store,id);
        if(current.receivedBytes===options.bytes){
          const checked=await fileDigest(pending);need(checked.sha256===sha256,'WORKSPACE_BACKUP_UPLOAD_DIGEST','The complete original upload hash differs; retain this input and use the correct original archive.');
          await rename(pending,join(folder,'archive.tar.gz'));
          const parent=await open(folder,'r');try{await parent.sync();}finally{await parent.close();}
          current={...current,complete:true,archivePath:join(folder,'archive.tar.gz'),completedAt:now()};
        }
        await saveJSON(file,current,true);return current;
      }finally{await lease.close();}
    },
    async workspaceBackupRestore(options={}){
      const store=await storeFor(root,options),archiveId=hashId(options.archiveId),manifestSha256=hashId(options.manifestSha256);
      const receipt=await boundedJSON(join(store,'inspections',archiveId,'inspection.json'));
      need(receipt.manifestSha256===manifestSha256,'WORKSPACE_BACKUP_REVIEW_CHANGED');
      const mode=options.mode??'original';need(['original','new-host'].includes(mode),'WORKSPACE_BACKUP_MODE');
      absolute(options.directory);
      need(mode==='new-host'||receipt.review.directory===options.directory,'WORKSPACE_BACKUP_ORIGINAL_PATH_REQUIRED',
        'Choose explicit new-host receiving to preserve the original workspace at a different destination.');
      return startOperation(root,store,'RESTORE',{requestId:operationId(options.requestId),archiveId,manifestSha256,directory:options.directory,
        ...(mode==='new-host'?{mode}:{})});
    },
    async workspaceBackupContinue(options={}){
      const store=await storeFor(root,options),id=operationId(options.operationId),request=await boundedJSON(join(store,'operations',id,'request.json'));
      need(request.original.root===root&&request.original.store===store,'WORKSPACE_BACKUP_OPERATION_IDENTITY');
      return startOperation(root,store,request.original.kind,request.original.input,{continueOriginal:true});
    },
    async workspaceBackupDownload(options={}){
      const store=await storeFor(root,options),archiveId=hashId(options.archiveId);
      const receipt=await boundedJSON(join(store,'inspections',archiveId,'inspection.json'));
      const handle=await open(receipt.archivePath,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{
        const info=await handle.stat({bigint:true});
        need(info.isFile()&&Number(info.size)===receipt.bytes,'WORKSPACE_BACKUP_ARCHIVE_CHANGED');
        const identity={dev:String(info.dev),ino:String(info.ino),size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)};
        if(!same(identity,receipt.archiveIdentity)){
          const checked=await fileDigest(receipt.archivePath);
          need(checked.sha256===archiveId&&checked.bytes===receipt.bytes,'WORKSPACE_BACKUP_ARCHIVE_CHANGED');
          const after=await handle.stat({bigint:true});
          need(same(identity,{dev:String(after.dev),ino:String(after.ino),size:String(after.size),mtimeNs:String(after.mtimeNs),ctimeNs:String(after.ctimeNs)}),'WORKSPACE_BACKUP_ARCHIVE_CHANGED');
        }
        let bytes=0;const checksum=createHash('sha256');
        const stream=new Transform({
          transform(chunk,_encoding,callback){bytes+=chunk.length;checksum.update(chunk);callback(null,chunk);},
          flush(callback){
            try{need(bytes===receipt.bytes&&checksum.digest('hex')===archiveId,'WORKSPACE_BACKUP_ARCHIVE_CHANGED');callback();}
            catch(error){callback(error);}
          },
        });
        const source=handle.createReadStream();
        source.on('error',error=>stream.destroy(error));stream.on('close',()=>source.destroy());
        source.pipe(stream);
        return {stream,bytes:receipt.bytes,sha256:archiveId,type:'application/gzip',
          filename:'Runtime_Workspace_'+receipt.review.workspaceId+'.tar.gz'};
      }catch(error){await handle.close();throw error;}
    },
    async workspaceBackupBindings(options={}){
      const store=await storeFor(root,options);
      return python('bindings',{store,receivingId:operationId(options.receivingId),...(options.hostBindings===undefined?{}:{hostBindings:options.hostBindings})});
    },
    async workspaceBackupOpen(options={}){
      const store=await storeFor(root,options),receivingId=operationId(options.receivingId),record=await boundedJSON(join(store,'operations',receivingId,'operation.json'));
      need(record.kind==='RESTORE'&&record.phase==='COMPLETE','WORKSPACE_BACKUP_RECEIVING_INCOMPLETE');
      const target=absolute(record.result.directory);
      return withWorkspaceBackup(target,()=>python('accept',{directory:target,store,receivingId,reviewId:operationId(options.reviewId),
        reviewSha256:hashId(options.reviewSha256)},{gateFd:workspaceLeaseDescriptor(target)}));
    },
  };
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  need(process.argv[2]==='--worker'&&process.argv.length===6,'WORKSPACE_BACKUP_WORKER_ARGUMENTS');
  await runWorker(process.argv[3],process.argv[4],process.argv[5]);
}
