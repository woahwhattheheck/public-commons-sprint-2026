#!/usr/bin/env node
import { existsSync,readFileSync,mkdirSync,openSync,closeSync,readSync,writeSync,fsyncSync,renameSync,unlinkSync,readdirSync,lstatSync,realpathSync,createWriteStream } from 'node:fs';
import { join,resolve,dirname,basename,relative } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { createApplicationServer } from '../server.mjs';
import { readRuntime } from '../native/runtime.mjs';
import { acquireWorkspaceLease,privateDirectory } from '../vendor/stellar-expert/store.mjs';
import { atomicBytes,atomicJson,identity,canonical,requireValue,sha,now,safeRelative,collectSourceFiles,fsyncDirectory } from '../core/common.mjs';
import { hashFile } from '../core/objects.mjs';
import { runBrowserJourney } from './browser.mjs';

const SOURCE=resolve(fileURLToPath(new URL('..',import.meta.url)));
const STREAM='["main","test1"]';
const portableSuffix=value=>value.portableSchema==='tjlabs.sling-portable.v2'?'.ndjson':'.ndjson.gz';
const portableMediaType=value=>value.portableSchema==='tjlabs.sling-portable.v2'?'application/x-ndjson':'application/gzip';
const EXPECTED_SOURCE='7641892e24a7023c8012069596698970c7b3e041';
const SCHEMA='tjlabs.sling-complete-receiving.v1';
function flags(argv){
  const out={};for(let i=0;i<argv.length;i++){const key=argv[i];requireValue(key.startsWith('--')&&!Object.hasOwn(out,key.slice(2)),'ARGUMENT','Use each documented option once.');
    if(key==='--resume')out.resume=true;else{requireValue(argv[i+1]&&!argv[i+1].startsWith('--'),'ARGUMENT','Supply a value after '+key+'.');out[key.slice(2)]=argv[++i];}}
  for(const key of ['source','directory','runtime-ready','source-manifest','playwright','chromium'])requireValue(out[key],'ARGUMENT','Supply --'+key+'.');
  return out;
}
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const row=(rows,id,label)=>{const found=rows.find(x=>x.id===id);requireValue(found,'RECEIVING_SELECTION','The original '+label+' is not in the selected project.',409);return found;};
function fileInfo(path){return{path,...hashFile(path)};}
function localFile(path,root){const rel=relative(root,path).split('\\').join('/');safeRelative(rel);return rel;}
function verify(path,expected){const actual=hashFile(path);requireValue(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'RECEIVING_FILE_CHANGED','The selected complete file differs from its retained identity.',409,{file:basename(path)});return actual;}
function verifySource(root,manifestPath){
  requireValue(resolve(root)===SOURCE&&realpathSync(root)===SOURCE,'SOURCE_MODULE_BINDING','Invoke the receiver from the same complete source tree being verified.',409);
  const selectedManifest=resolve(manifestPath),manifest=read(selectedManifest);
  requireValue(Array.isArray(manifest.files)&&manifest.files.length>0,'SOURCE_MANIFEST','Supply the complete original source manifest.');
  const names=new Set(),declared=new Map();
  for(const item of manifest.files){safeRelative(item.path);requireValue(!names.has(item.path),'SOURCE_MANIFEST','Duplicate source path.');names.add(item.path);declared.set(item.path,item);}
  // Use the maintained complete editable-source inventory. Only the manifest's
  // own file is outside its self-hash; generated runtime directories are already
  // excluded by this same source collector used by the native archive.
  const actual=collectSourceFiles(root).filter(item=>resolve(root,item.path)!==selectedManifest),files=[];
  requireValue(actual.length===names.size,'SOURCE_MANIFEST','The manifest must cover every original editable-source leaf.',409,{actualFiles:actual.length,selectedFiles:names.size});
  for(const item of actual){
    const selected=declared.get(item.path);requireValue(selected,'SOURCE_MANIFEST','The full source manifest omits '+item.path+'.',409);
    const path=join(root,item.path);requireValue(lstatSync(path).isFile()&&realpathSync(path)===path,'SOURCE_MANIFEST','Source files must be regular original leaves.',409);
    requireValue(item.bytes===selected.bytes&&item.sha256===selected.sha256,'SOURCE_MANIFEST','The selected source bytes differ for '+item.path+'.',409);
    files.push({...selected,body:item.body});
  }
  const required=["LICENSE","OPERATOR.md","cli.mjs","core/REUSE.json","core/archive.mjs","core/auth.mjs","core/common.mjs","core/objects.mjs","core/store.mjs","core/uploads.mjs","core/workspace.mjs","migration/OPERATING.md","migration/SOURCE_REFERENCES.json","migration/cli.mjs","migration/common.mjs","migration/compare.mjs","migration/downstream.mjs","migration/index.mjs","migration/intake.mjs","migration/plan.mjs","native/consumer.py","native/install.py","native/runtime.mjs","native/sqlite_exports.py","native/worker.py","package.json","receiving/browser.mjs","receiving/receive.mjs","reference/DERIVATION.json","reference/baseline-airbyte-catalogue.json","reference/baseline-bindings.json","reference/consumer-edits.json","reference/consumer-files.json","reference/evolved-airbyte-catalogue.json","reference/evolved-bindings.json","reference/original/test1.csv","reference/original/test1.upsert.csv","server.mjs","upstream/sling/LICENSE","upstream/sling/README.md","upstream/sling/SOURCE.json","upstream/sling/cmd/sling/resource/llm_REPLICATION.md","upstream/sling/cmd/sling/sling_cli.go","upstream/sling/cmd/sling/sling_conns.go","upstream/sling/cmd/sling/sling_run.go","upstream/sling/cmd/sling/sling_validate.go","upstream/sling/core/env/env.go","upstream/sling/core/sling/config.go","upstream/sling/core/sling/replication.go","upstream/sling/core/sling/task_func.go","upstream/sling/core/sling/types.go","upstream/sling/core/sling/validate/dto.go","upstream/sling/go.mod","upstream/sling/tests/files/test1.csv","upstream/sling/tests/files/test1.upsert.csv","vendor/stellar-expert/LICENSE","vendor/stellar-expert/SOURCE.json","vendor/stellar-expert/exact-json.mjs","vendor/stellar-expert/provider.mjs","vendor/stellar-expert/schema.mjs","vendor/stellar-expert/store.mjs","web/app.mjs","web/index.html","web/sha256.mjs","web/style.css"];
  for(const name of required)requireValue(names.has(name),'SOURCE_MANIFEST','The complete application/native/reference closure is missing '+name+'.',409);
  return{manifest,files,identity:hashFile(selectedManifest)};
}
function verifyReference(root){
  const d=read(join(root,'reference/DERIVATION.json'));
  requireValue(d.upstream?.commit===EXPECTED_SOURCE&&d.originalFiles?.length===2,'REFERENCE_SELECTION','Select the retained original Sling source reference.',409);
  for(const item of [...d.originalFiles,...d.authoredFiles])verify(join(root,item.path),item);
  requireValue(d.originalFiles[0].rows===1000&&d.originalFiles[1].rows===14&&d.expectedSourceChange.expectedFinalRows===1002,'REFERENCE_SELECTION','The complete reference selection differs.');
  return d;
}
function summary(view){
  return{projectId:view.id,revision:view.revision,sourceCount:view.sources.length,planCount:view.plans.length,jobCount:view.jobs.length,comparisonCount:view.comparisons.length,
    cutoverCount:view.cutovers.length,reviewCount:view.reviews.length,handoffIds:view.handoffs.map(x=>x.id),historyCount:view.history.length};
}
class Programme{
  constructor(options,source,ready,reference,lease){
    this.options=options;this.source=source;this.ready=ready;this.reference=reference;this.lease=lease;this.root=resolve(options.directory);this.apps=new Map();this.closing=false;
    this.statePath=join(this.root,'operation.json');
    const selected={schema:SCHEMA,sourceManifest:source.identity,runtimeReady:hashFile(resolve(options['runtime-ready'])),runtime:{version:ready.version,sourceCommit:ready.sourceCommit,archive:{bytes:ready.archive.bytes,sha256:ready.archive.sha256},executable:{bytes:ready.executable.bytes,sha256:ready.executable.sha256}},reference:hashFile(join(SOURCE,'reference/DERIVATION.json')),node:{executable:process.execPath,version:process.version}};
    if(existsSync(this.statePath)){this.state=read(this.statePath);requireValue(canonical(this.state.selection)===canonical(selected),'RECEIVING_SELECTION_CHANGED','The original operation has another source/runtime/reference selection.',409);requireValue(options.resume||this.state.status==='complete','RESUME_REQUIRED','Use --resume for this retained original programme.',409);}
    else{this.state={schema:SCHEMA,id:'sling_receiving_'+randomUUID(),selection:selected,status:'prepared',createdAt:now(),phases:{},ports:{},projects:{},artifacts:{},attempts:[]};this.save();}
    atomicBytes(join(this.root,'source-manifest.json'),readFileSync(resolve(options['source-manifest'])),{immutable:true});
    atomicBytes(join(this.root,'runtime-ready.json'),readFileSync(resolve(options['runtime-ready'])),{immutable:true});
    atomicBytes(join(this.root,'DERIVATION.json'),readFileSync(join(SOURCE,'reference/DERIVATION.json')),{immutable:true});
    this.authPath=join(this.root,'installation-auth.json');
    if(!existsSync(this.authPath))atomicJson(this.authPath,{schema:'tjlabs.sling-auth.v1',actors:[{id:'sling-reference-operator',name:'Reference migration operator',roles:['operator'],token:randomBytes(32).toString('hex')},{id:'sling-reference-viewer',name:'Receiving reviewer',roles:['viewer'],token:randomBytes(32).toString('hex')}]},{immutable:true});
    const actors=read(this.authPath).actors;this.operator=actors.find(x=>x.roles.includes('operator'));this.viewer=actors.find(x=>x.roles.includes('viewer'));
    requireValue(this.operator&&this.viewer,'REFERENCE_AUTH','The original private reference actors are required.');
  }
  save(){this.lease.assert();atomicJson(this.statePath,this.state);}
  note(event){process.stdout.write(JSON.stringify({at:now(),operationId:this.state.id,...event})+'\n');}
  async phase(name,work){
    const old=this.state.phases[name];if(old?.status==='complete'){this.note({phase:name,state:'retained'});return old.result;}
    if(!old)this.state.phases[name]={status:'running',startedAt:now()};else{old.status='running';old.continuedAt=now();}
    this.state.currentPhase=name;this.save();this.note({phase:name,state:'running'});
    const result=await work();this.state.phases[name]={...this.state.phases[name],status:'complete',completedAt:now(),result};this.save();this.note({phase:name,state:'complete'});return result;
  }
  async startHost(name,{native=false}={}){
    if(this.apps.has(name))return this.apps.get(name);
    const directory=join(this.root,'workspaces',name);
    const app=await createApplicationServer({directory,authFile:this.authPath,runtimeReadyFile:native?resolve(this.options['runtime-ready']):undefined,python:this.options.python??'python3',sourceRoot:SOURCE,sourceFiles:this.source.files});
    const host={name,directory,app};this.apps.set(name,host);
    try{
      const info=await app.listen({host:'127.0.0.1',port:this.state.ports[name]??0});
      if(this.state.ports[name]===undefined){this.state.ports[name]=info.port;this.save();}
      requireValue(info.port===this.state.ports[name],'ORIGIN_CHANGED','Preserve the original receiving browser origin.',409);
      Object.assign(host,info);return host;
    }catch(error){try{await this.closeHost(name);}catch(closeError){error.closeError={code:closeError.code??'OWNER_CLOSE_PENDING',message:closeError.message};}throw error;}
  }
  async closeHost(name){const host=this.apps.get(name);if(!host)return;await host.app.close();this.apps.delete(name);}
  async close(){
    if(this.closePromise)return this.closePromise;
    this.closePromise=(async()=>{for(const name of [...this.apps.keys()].reverse())await this.closeHost(name);})();
    try{return await this.closePromise;}finally{this.closePromise=null;}
  }
  async api(host,path,{method='GET',body,actor=this.operator,headers={}}={}){
    this.lease.assert();const response=await fetch(host.origin+path,{method,headers:{Authorization:'Bearer '+actor.token,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();let value;try{value=JSON.parse(text);}catch{throw Object.assign(new Error('The original HTTP response was not complete JSON.'),{code:'HTTP_RESPONSE',status:response.status});}
    if(!response.ok)throw Object.assign(new Error(value.error?.message??'Original HTTP operation failed.'),{code:value.error?.code??'HTTP_ERROR',status:response.status,details:value.error?.details??{},response:value});
    return value;
  }
  requestPaths(host,key){safeRelative(key);const base=join(this.root,'requests',host.name,key);return{request:base+'.request.json',response:base+'.response.json',errors:base+'.errors.json'};}
  async sendOnce(host,key,intent,make){
    const paths=this.requestPaths(host,key),intentHash=identity(intent);let selected;
    if(existsSync(paths.request)){selected=read(paths.request);requireValue(selected.intentSha256===intentHash,'RECEIVING_REQUEST_CHANGED','Preserve the exact original request and reviewed intent.',409,{key});}
    else{selected={schema:'tjlabs.sling-receiving-request.v1',intentSha256:intentHash,intent,method:'POST',...(await make()),createdAt:now()};atomicJson(paths.request,selected,{immutable:true});}
    if(existsSync(paths.response))return read(paths.response).value;
    try{const value=await this.api(host,selected.path,{method:selected.method,body:selected.body});atomicJson(paths.response,{requestSha256:hashFile(paths.request).sha256,receivedAt:now(),value},{immutable:true});return value;}
    catch(error){const attempts=existsSync(paths.errors)?read(paths.errors):[];attempts.push({observedAt:now(),code:error.code??'HTTP_UNOBSERVED',message:error.message,status:error.status??null,response:error.response??null});atomicJson(paths.errors,attempts);throw error;}
  }
  requestId(host,key){return'receive_'+identity({operationId:this.state.id,host:host.name,key}).slice(0,48);}
  async create(host,key,title,notes){
    const value=await this.sendOnce(host,key,{action:'project.create',title,notes},async()=>({path:'/api/projects',body:{requestId:this.requestId(host,key),title,notes}}));
    return value.result.projectId;
  }
  async view(host,projectId,revision){return (await this.api(host,'/api/projects/'+projectId+(revision===undefined?'':'?revision='+revision))).view;}
  async action(host,projectId,key,action,payload){
    return this.sendOnce(host,key,{projectId,action,payload},async()=>{const view=await this.view(host,projectId);return{path:'/api/projects/'+projectId+'/actions',body:{requestId:this.requestId(host,key),expectedRevision:view.revision,action,payload}};});
  }
  async upload(host,key,file,mediaType){
    const path=resolve(file),info=hashFile(path),uploadId='upload_'+identity({operationId:this.state.id,host:host.name,key,sha256:info.sha256}).slice(0,40),selected={uploadId,filename:basename(path),mediaType,...info};
    const intentPath=join(this.root,'uploads',host.name,key+'.json');safeRelative(key);
    atomicJson(intentPath,{source:localFile(path,this.root),input:selected},{immutable:true});
    let value=await this.api(host,'/api/uploads',{method:'POST',body:selected});
    const fd=openSync(path,'r');try{
      const buffer=Buffer.alloc(8*1024*1024);
      while(value.offset<info.bytes){const start=value.offset,n=readSync(fd,buffer,0,Math.min(buffer.length,info.bytes-start),start);requireValue(n>0,'UPLOAD_SOURCE','Original file ended before its complete byte count.',409);
        const body=buffer.subarray(0,n),response=await fetch(host.origin+'/api/uploads/'+uploadId,{method:'PUT',headers:{Authorization:'Bearer '+this.operator.token,'Content-Range':'bytes '+start+'-'+(start+n-1)+'/'+info.bytes,'X-Chunk-SHA256':sha(body)},body});
        const answer=await response.json();requireValue(response.ok,'UPLOAD_FAILED',answer.error?.message??'Original source chunk was not accepted.',response.status,{error:answer.error});value=answer;}
    }finally{closeSync(fd);}
    const completed=await this.api(host,'/api/uploads/'+uploadId+'/finish',{method:'POST',body:{}});
    requireValue(completed.complete&&completed.bytes===info.bytes&&completed.sha256===info.sha256,'UPLOAD_IDENTITY','Original completed upload differs.',409);return{uploadId,...info};
  }
  async retain(host,projectId,key,referencePath,{title,role,url='',notes=''}){
    const local=join(this.root,'intake',referencePath);atomicBytes(local,readFileSync(join(SOURCE,referencePath)),{immutable:true});
    const uploaded=await this.upload(host,'source-'+key,local,referencePath.endsWith('.csv')?'text/csv':'application/json');
    const value=await this.action(host,projectId,'retain-'+key,'source.retain',{uploadId:uploaded.uploadId,title,role,url,notes});
    return{sourceId:value.result.sourceId,referencePath,...hashFile(local)};
  }
  async download(host,url,output,expected){
    const target=join(this.root,safeRelative(output));mkdirSync(dirname(target),{recursive:true,mode:0o700});
    if(existsSync(target)){const actual=verify(target,expected);return{path:output,...actual};}
    const response=await fetch(host.origin+url,{headers:{Authorization:'Bearer '+this.operator.token}});requireValue(response.ok,'DOWNLOAD_FAILED','The actual selected download did not complete.',response.status,{url});
    const headerHash=response.headers.get('x-content-sha256'),headerBytes=Number(response.headers.get('content-length'));
    requireValue(headerHash===expected.sha256&&headerBytes===expected.bytes,'DOWNLOAD_SELECTION','The original HTTP download selected another complete file.',409);
    const temp=target+'.pending-'+randomUUID();try{
      await pipeline(Readable.fromWeb(response.body),createWriteStream(temp,{flags:'wx',mode:0o600}));
      verify(temp,expected);const fd=openSync(temp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,target);const d=openSync(dirname(target),'r');try{fsyncSync(d);}finally{closeSync(d);}
    }finally{try{unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
    return{path:output,bytes:expected.bytes,sha256:expected.sha256,mediaType:response.headers.get('content-type'),filename:response.headers.get('content-disposition')};
  }
  async waitJob(host,projectId,jobId,{expectedRows,kind,cancelled=false}={}){
    for(;;){
      const view=await this.view(host,projectId),job=row(view.jobs,jobId,'native job');
      if(job.status==='complete'){
        requireValue(!cancelled,'CANCEL_NOT_OBSERVED','The selected cancellation did not close its original pre-command attempt.',409);
        requireValue(job.nativeState?.status==='complete'&&job.nativeState.result,'NATIVE_RESULT','The complete original native result is required.',409);
        if(expectedRows!==undefined)for(const count of job.nativeState.result.rows)requireValue(count.left===expectedRows&&count.right===expectedRows,'NATIVE_ROW_POPULATION','Actual full native rows do not match the selected original source change.',409,{jobId,expectedRows,actual:count});
        requireValue(kind===undefined||job.kind===kind,'NATIVE_KIND','The original job type differs.');
        for(const entry of job.files){host.app.workspace.store.objects.verify(entry.sha256,entry.bytes);}
        const result={jobId,kind:job.kind,phase:job.phase,status:job.status,nativeSnapshotSha256:job.nativeSnapshotSha256,attempts:job.nativeState.attempts.map(a=>({id:a.id,status:a.status,startedAt:a.startedAt,completedAt:a.completedAt})),rows:job.nativeState.result.rows,native:job.nativeState.result.native,files:job.files};
        atomicJson(join(this.root,'native-results',jobId+'.json'),result,{immutable:true});return result;
      }
      if(cancelled&&job.status==='cancelled'){
        requireValue(job.nativeState?.attempts?.length===1&&Object.keys(job.nativeState.steps??{}).length===0,'CANCEL_TARGET_UNEXPECTED','The pre-command cancellation must preserve one ended attempt without a replication effect.',409);
        return{jobId,status:'cancelled',attemptId:job.nativeState.attempts[0].id,controls:job.controls,nativeSnapshotSha256:job.nativeSnapshotSha256};
      }
      requireValue(['prepared','queued','running','cancelling'].includes(job.status),'NATIVE_CONTINUATION_REQUIRED','The original native job ended. Review its retained attempt before an explicit job.resume or target-write decision.',409,{jobId,status:job.status,error:job.nativeState?.error??null});
      await new Promise(done=>setTimeout(done,1000));
    }
  }
  async completeJob(host,projectId,key,prepared,{expectedRows,kind,cancelFirst=false}={}){
    const jobId=prepared.result.jobId;
    if(cancelFirst){
      await this.phase(key+'-cancel-before-command',async()=>{
        await this.action(host,projectId,key+'-cancel','job.cancel',{jobId,reason:'Retain an explicit pre-command cancellation, then continue this same original source-import job.'});
        return this.waitJob(host,projectId,jobId,{cancelled:true});
      });
      await this.action(host,projectId,key+'-resume','job.resume',{jobId,reason:'Continue the same original source-import job after its recorded pre-command cancellation; retain the cancelled attempt.'});
    }else await this.action(host,projectId,key+'-start','job.start',{jobId});
    return this.waitJob(host,projectId,jobId,{expectedRows,kind});
  }
  async compare(host,projectId,key,jobId,expectedRows){
    const response=await this.action(host,projectId,key,'comparison.create',{jobId}),view=await this.view(host,projectId),selected=row(view.comparisons,response.result.comparisonId,'comparison');
    requireValue(selected.equal&&selected.readyForCutover,'FULL_COMPARISON','Every selected typed business row, schema and primary key must match before cutover.',409);
    const report=await this.download(host,'/api/projects/'+projectId+'/outputs/comparison/'+selected.id,'delivery/'+key+'-comparison.json',selected.report);
    const observations=await this.download(host,'/api/projects/'+projectId+'/outputs/observations/'+selected.id,'delivery/'+key+'-observations.json',selected.observations);
    const values=read(join(this.root,observations.path));requireValue(values.streams.length===1,'REFERENCE_STREAMS','The full original reference selects one stream.');
    for(const s of values.streams)for(const side of ['left','right'])requireValue(s[side].source.complete===true&&s[side].rows.length===expectedRows&&s[side].source.rowCount===expectedRows,'FULL_EXPORT','Every actual source and target row must be retained.',409);
    return{comparisonId:selected.id,semanticComparisonId:selected.comparisonId,planId:selected.planId,equal:true,readyForCutover:true,report,observations,rows:expectedRows};
  }
  async consumer(host,projectId,key,expectedRows,expectedSnapshot){
    let offset=0,selected=null,rows=[],columns=null;
    for(;;){
      const result=await this.api(host,'/api/projects/'+projectId+'/consumer?streamId='+encodeURIComponent(STREAM)+'&offset='+offset+'&limit=1000');
      requireValue(result.rowCount===expectedRows,'CONSUMER_POPULATION','The actual consumer has another row population.',409,{expectedRows,actual:result.rowCount});
      if(expectedSnapshot)requireValue(result.snapshot.sha256===expectedSnapshot.sha256&&result.snapshot.bytes===expectedSnapshot.bytes,'CONSUMER_SELECTION','The actual consumer has another immutable database selection.',409);
      if(selected)requireValue(canonical(result.selection)===canonical(selected)&&canonical(columns)===canonical(result.columns),'CONSUMER_CHANGED','The consumer selection changed during its complete read.',409);
      else{selected=result.selection;columns=result.columns;}
      rows.push(...result.rows);if(result.nextOffset===null)break;requireValue(result.nextOffset>offset,'CONSUMER_CURSOR','The actual consumer did not advance its returned cursor.');offset=result.nextOffset;
    }
    requireValue(rows.length===expectedRows,'CONSUMER_FULL_READ','The complete consumer population was not read.');
    const value={schema:'tjlabs.sling-complete-consumer-read.v1',projectId,selection:selected,streamId:STREAM,columns,rowCount:rows.length,rows};
    const path='delivery/'+key+'-consumer.json';atomicJson(join(this.root,path),value,{immutable:true});return{path,...hashFile(join(this.root,path)),rowCount:rows.length,selection:selected};
  }
  async downstream(host,projectId,key,changePlanId,direction){
    const value=await this.action(host,projectId,key,'downstream.'+direction,{changePlanId,reason:direction==='restore'?'Restore every exact original consumer preimage using its retained original change plan.':'Apply the reviewed full consumer change after the complete native comparison.'});
    const view=await this.view(host,projectId),operation=row(view.downstreamOperations,value.result.operationId,'downstream operation');
    requireValue(operation.status==='complete'&&operation.currentObservation?.matchesSelected===true,'DOWNSTREAM_RESULT','The actual consumer files must match the selected reviewed edition.',409,{status:operation.status,error:operation.error??null});
    for(const item of operation.files)host.app.workspace.store.objects.verify(item.sha256,item.bytes);
    const report=operation.files.find(x=>x.path==='report.sql');requireValue(report,'CONSUMER_REPORT','The complete selected report is missing.');
    const output=await this.download(host,'/api/projects/'+projectId+'/downstream/'+operation.id+'?path=report.sql','delivery/'+key+'-report.sql',report);
    return{operationId:operation.id,status:operation.status,direction:operation.direction,changePlanId,current:operation.currentObservation,nativeResult:operation.nativeResult,report:output,files:operation.files};
  }
  async handoff(host,projectId,key,title){
    const response=await this.action(host,projectId,key,'handoff.prepare',{title,notes:'Complete original source, runtime, native attempts, comparisons, decisions and consumer history. Private installation auth and writable host bindings are excluded.'});
    const view=await this.view(host,projectId),id=response.result.handoffId,record=view.handoffCustody[id];requireValue(record?.status==='complete','HANDOFF_SEAL','The original named complete package is not sealed.',409);
    const file=await this.download(host,'/api/projects/'+projectId+'/outputs/handoff/'+id,'delivery/'+key+portableSuffix(record),record);
    const inspected=await host.app.workspace.archives.inspect(join(this.root,file.path),{retainObjects:false});
    requireValue(inspected.header.handoff.id===id&&inspected.header.revision===record.revision&&inspected.versions.length===record.revision+1,'HANDOFF_HISTORY','The named archive must retain its complete immutable project prefix.');
    return{handoffId:id,revision:record.revision,portableSchema:record.portableSchema??'tjlabs.sling-portable.v1',filename:record.filename,mediaType:portableMediaType(record),archive:{path:file.path,bytes:file.bytes,sha256:file.sha256},headerSha256:record.headerSha256,sourceFiles:inspected.header.sourceManifest.length,objectCount:inspected.header.objectManifest.length,versionCount:inspected.versions.length};
  }
  async receive(host,receivingProject,key,packageRecord,expectedDisposition){
    const file=join(this.root,packageRecord.archive.path);verify(file,packageRecord.archive);const up=await this.upload(host,'package-'+key,file,portableMediaType(packageRecord));
    const answer=await this.action(host,receivingProject,key,'handoff.receive',{uploadId:up.uploadId});
    requireValue(answer.result.packageSha256===packageRecord.archive.sha256&&answer.result.receivedRevision===packageRecord.revision,'RECEIVING_PACKAGE','The original package receipt selected another edition.',409);
    if(expectedDisposition)requireValue(answer.result.disposition===expectedDisposition,'RECEIVING_DISPOSITION','The complete original prefix did not produce its expected receiving disposition.',409,{expectedDisposition,actual:answer.result.disposition});
    return answer;
  }
  async audit(host,projectId,key,expectedSources){
    const view=await this.view(host,projectId);
    for(const source of view.sources){host.app.workspace.store.objects.verify(source.sha256,source.bytes);}
    for(const expected of expectedSources){const selected=row(view.sources,expected.sourceId,'received source');requireValue(selected.sha256===expected.sha256&&selected.bytes===expected.bytes,'SOURCE_RECEIVING','Original received source bytes differ.',409);}
    for(const job of view.jobs){requireValue(job.status==='complete','NATIVE_RECEIVING','Every original native job must remain complete.');for(const file of job.files)host.app.workspace.store.objects.verify(file.sha256,file.bytes);}
    const rows=host.app.workspace.store.versions(projectId,view.revision);requireValue(rows.length===view.revision+1,'FULL_HISTORY','The original immutable history has a missing revision.');
    const objects=new Map();for(const version of rows){requireValue(sha(Buffer.from(version.state_json))===version.sha256,'FULL_HISTORY','A retained version differs.');const object=JSON.parse(version.state_json);requireValue(object.revision===Number(version.revision),'FULL_HISTORY','A retained revision label differs.');}
    for(const h of Object.values(view.handoffCustody))host.app.workspace.archives.verifyRecord(h);
    const result={...summary(view),sourceHashes:view.sources.map(x=>({id:x.id,bytes:x.bytes,sha256:x.sha256})),nativeJobs:view.jobs.map(j=>({id:j.id,status:j.status,nativeSnapshotSha256:j.nativeSnapshotSha256,files:j.files.length,attempts:j.nativeState.attempts.map(a=>({id:a.id,status:a.status}))})),versionManifest:rows.map(v=>({revision:Number(v.revision),sha256:v.sha256,parentSha256:v.parent_sha256})),namedPackages:Object.values(view.handoffCustody).map(h=>({id:h.id,revision:h.revision,bytes:h.bytes,sha256:h.sha256})),availableRuntime:view.availableRuntime};
    const path='delivery/'+key+'-audit.json';atomicJson(join(this.root,path),result,{immutable:true});return{path,...hashFile(join(this.root,path)),...summary(view)};
  }
  bindBrowserResult(result){
    requireValue(result?.status==='complete'&&['primary','receiving'].includes(result.phase)&&Array.isArray(result.files),'BROWSER_RESULT','Retain the complete original browser result.',409);
    safeRelative(result.resultPath);
    requireValue(result.resultPath.startsWith('browser/'+result.phase+'/'),'BROWSER_RESULT','The original browser result must remain in its selected operation phase.',409);
    const path=join(this.root,result.resultPath);
    requireValue(canonical(read(path))===canonical(result),'BROWSER_RESULT_CHANGED','The published original browser result differs from its returned complete value.',409);
    for(const file of result.files){safeRelative(file.path);requireValue(file.path.startsWith('browser/'+result.phase+'/'),'BROWSER_RESULT','A browser artifact must belong to the original phase.',409);verify(join(this.root,file.path),file);}
    return{...result,resultFile:{path:result.resultPath,...hashFile(path)}};
  }
  verifyBrowserResult(result){
    requireValue(result?.resultFile?.path===result.resultPath,'BROWSER_RESULT','The original browser result file identity is required.',409);
    const {resultFile,...original}=result;
    verify(join(this.root,resultFile.path),resultFile);
    requireValue(canonical(read(join(this.root,resultFile.path)))===canonical(original),'BROWSER_RESULT_CHANGED','The retained original browser result changed.',409);
    for(const file of [...result.files,resultFile])verify(join(this.root,file.path),file);
    return[...result.files,resultFile];
  }
  async cli(name,command,extra=[]){
    const out=join(this.root,'cli',name+'.stdout.json'),err=join(this.root,'cli',name+'.stderr.txt'),receipt=join(this.root,'cli',name+'.receipt.json');
    const argv=[join(SOURCE,'cli.mjs'),command,...extra],retirementPath=join(this.root,'cli',name+'.retirement-pending.json');
    const finishRetirement=()=>{
      const selected=read(retirementPath),r=selected.receipt;
      requireValue(selected.schema==='tjlabs.sling-cli-observation-retirement.v1'&&canonical(r.argv)===canonical(argv)&&r.exitCode!==0,'CLI_RECEIVING','Retire only this exact original failed read-only observation.',409);
      const archive=join(this.root,'cli','prior-observations',name,identity(r));
      const expected=[{source:out,name:'stdout.json',identity:r.stdout},{source:err,name:'stderr.txt',identity:r.stderr},{source:receipt,name:'receipt.json',identity:selected.receiptIdentity}];
      requireValue(canonical(selected.files)===canonical(expected.map(item=>({source:localFile(item.source,this.root),archive:localFile(join(archive,item.name),this.root),identity:item.identity}))),
        'CLI_RECEIVING','Preserve the original failed observation retirement selection.',409);
      mkdirSync(archive,{recursive:true,mode:0o700});
      for(const item of expected){
        const target=join(archive,item.name),hasSource=existsSync(item.source),hasTarget=existsSync(target);
        requireValue(hasSource||hasTarget,'CLI_RECEIVING','The original failed CLI observation is missing from both retained locations.',409,{file:item.name});
        if(hasSource)verify(item.source,item.identity);if(hasTarget)verify(target,item.identity);
        if(!hasTarget)renameSync(item.source,target);else if(hasSource)unlinkSync(item.source);
        verify(target,item.identity);fsyncDirectory(archive);fsyncDirectory(dirname(item.source));
      }
      atomicJson(join(archive,'retirement.json'),selected,{immutable:true});
      unlinkSync(retirementPath);fsyncDirectory(dirname(retirementPath));
    };
    if(existsSync(retirementPath)){
      requireValue(this.options.resume,'RESUME_REQUIRED','Continue the original failed CLI observation retirement with --resume.',409);finishRetirement();
    }
    if(existsSync(receipt)){
      const r=read(receipt);requireValue(canonical(r.argv)===canonical(argv),'CLI_RECEIVING','The retained original CLI command selected other arguments.',409);
      if(r.exitCode===0){verify(out,r.stdout);verify(err,r.stderr);return{...r,value:read(out)};}
      requireValue(this.options.resume,'RESUME_REQUIRED','Continue the retained failed read-only CLI observation with --resume.',409);
      const archive=join(this.root,'cli','prior-observations',name,identity(r)),receiptIdentity=hashFile(receipt);
      const selected={schema:'tjlabs.sling-cli-observation-retirement.v1',receipt:r,receiptIdentity,
        files:[{source:out,name:'stdout.json',identity:r.stdout},{source:err,name:'stderr.txt',identity:r.stderr},{source:receipt,name:'receipt.json',identity:receiptIdentity}]
          .map(item=>({source:localFile(item.source,this.root),archive:localFile(join(archive,item.name),this.root),identity:item.identity}))};
      atomicJson(retirementPath,selected,{immutable:true});finishRetirement();
    }
    mkdirSync(dirname(out),{recursive:true,mode:0o700});
    // Earlier output without a terminal receipt belongs to this same read-only
    // command. Retain it before its bounded original observation continuation.
    if(existsSync(out)||existsSync(err)){
      const archive=join(this.root,'cli','unobserved',name+'-'+randomUUID());mkdirSync(archive,{recursive:true,mode:0o700});
      for(const [source,file] of [[out,'stdout.json'],[err,'stderr.txt']])if(existsSync(source))renameSync(source,join(archive,file));
    }
    atomicJson(join(this.root,'cli',name+'.request.json'),{executable:process.execPath,argv},{immutable:true});
    const startedAt=now(),tempOut=out+'.pending-'+randomUUID(),tempErr=err+'.pending-'+randomUUID(),fds=[openSync(tempOut,'wx',0o600),openSync(tempErr,'wx',0o600)];
    let exitCode,signal;try{({exitCode,signal}=await new Promise((yes,no)=>{const child=spawn(process.execPath,argv,{cwd:SOURCE,stdio:['ignore',fds[0],fds[1]]});child.once('error',no);child.once('exit',(exitCode,signal)=>yes({exitCode,signal}));}));for(const fd of fds)fsyncSync(fd);}finally{for(const fd of fds)closeSync(fd);}
    renameSync(tempOut,out);renameSync(tempErr,err);const result={executable:process.execPath,argv,startedAt,completedAt:now(),exitCode,signal,stdout:hashFile(out),stderr:hashFile(err)};atomicJson(receipt,result,{immutable:true});
    requireValue(exitCode===0,'CLI_RECEIVING','The original CLI reopen did not complete.',409,{command,name,exitCode});return{...result,value:read(out)};
  }
  async run(){
    if(this.state.status==='complete'){for(const item of Object.values(this.state.artifacts))verify(join(this.root,item.path),item);const result=read(join(this.root,'CUSTOMER_RESULT.json'));this.note({state:'complete',reopened:true,projectId:result.project.projectId,revision:result.project.revision});return result;}
    const attempt={id:'receiving_attempt_'+randomUUID(),startedAt:now(),status:'running'};this.state.attempts.push(attempt);this.state.status='running';this.save();
    try{
      const primary=await this.startHost('primary',{native:true});
      const created=await this.phase('01-project-and-sources',async()=>{
        const projectId=await this.create(primary,'create-original-project','SlingData original source-to-parallel migration','Original Sling 1.6.5 reference: full baseline, native upsert, exact typed comparison and reversible consumer delivery.');
        const base='https://github.com/slingdata-io/sling-cli/blob/'+EXPECTED_SOURCE+'/';
        const entries=[
          ['baseline','reference/original/test1.csv',{title:'Original complete baseline CSV',role:'baseline-csv',url:base+'tests/files/test1.csv'}],
          ['increment','reference/original/test1.upsert.csv',{title:'Original complete 14-row incremental CSV',role:'incremental-csv',url:base+'tests/files/test1.upsert.csv'}],
          ['baseline-catalogue','reference/baseline-airbyte-catalogue.json',{title:'Authored baseline Airbyte configured catalogue',role:'airbyte-config',notes:'Explicit reference configuration; this is not a customer or Airbyte API capture.'}],
          ['evolved-catalogue','reference/evolved-airbyte-catalogue.json',{title:'Reviewed evolved catalogue retaining update_dt and adding json_data',role:'airbyte-config',notes:'Explicit derived configuration bound to the retained original changed CSV.'}],
          ['baseline-bindings','reference/baseline-bindings.json',{title:'Original baseline native relation and column bindings',role:'native-bindings'}],
          ['evolved-bindings','reference/evolved-bindings.json',{title:'Reviewed evolved native relation and column bindings',role:'native-bindings'}],
          ['consumer','reference/consumer-files.json',{title:'Complete original local consumer files',role:'consumer-files'}],
          ['consumer-edits','reference/consumer-edits.json',{title:'Explicit reversible literal consumer changes',role:'consumer-edits'}],
          ['derivation','reference/DERIVATION.json',{title:'Original source and declared reference derivation',role:'reference-derivation'}]
        ];const sources={};for(const [key,path,options] of entries)sources[key]=await this.retain(primary,projectId,key,path,options);
        await this.action(primary,projectId,'select-original-runtime','runtime.select',{});
        this.state.projects.primary=projectId;this.save();return{projectId,sources};
      });
      const projectId=created.projectId;this.state.projects.primary=projectId;this.save();
      const sources=Object.values(created.sources);
      const baselineSource=await this.phase('02-native-baseline-source',async()=>{
        const prepared=await this.action(primary,projectId,'prepare-baseline-source','source.load',{sourceId:created.sources.baseline.sourceId,mode:'full-refresh',table:'test1',primaryKey:['id']});
        return this.completeJob(primary,projectId,'baseline-source',prepared,{expectedRows:1000,kind:'source_import',cancelFirst:true});
      });
      const baseline=await this.phase('03-baseline-plan-native-comparison',async()=>{
        const compiled=await this.action(primary,projectId,'compile-baseline','plan.compile',{sourceId:created.sources['baseline-catalogue'].sourceId,title:'Baseline separate SQLite replication',options:read(join(SOURCE,'reference/baseline-bindings.json'))});
        requireValue(compiled.result.ready,'PLAN_ADAPTATION','The full selected reference requires a ready semantic plan.',409);
        const planId=compiled.result.planId;await this.action(primary,projectId,'review-baseline','plan.review',{planId,decision:'approved',notes:'Reviewed source/parallel relations, complete ten business columns, id key and original create_dt incremental cursor.'});
        const prepared=await this.action(primary,projectId,'prepare-baseline-replication','run.prepare',{planId,phase:'baseline',sourceJobId:baselineSource.jobId});
        const job=await this.completeJob(primary,projectId,'baseline-replication',prepared,{expectedRows:1000,kind:'replication'});
        const comparison=await this.compare(primary,projectId,'baseline',job.jobId,1000);
        return{planId,job,...comparison};
      });
      const baselineDelivery=await this.phase('04-baseline-consumer-and-handoff',async()=>{
        const switched=await this.action(primary,projectId,'baseline-cutover','cutover.apply',{comparisonId:baseline.comparisonId,reason:'Select the independently compared complete 1,000-row parallel target.'});
        const consumer=await this.consumer(primary,projectId,'baseline',1000,switched.result.selection.snapshot);
        const change=await this.action(primary,projectId,'baseline-consumer-plan','downstream.plan',{planId:baseline.planId,sourceId:created.sources.consumer.sourceId,comparisonId:baseline.comparisonId,title:'Select the compared parallel relation in the original report',reason:'Exact one-occurrence source relation replacement with retained preimage.',edits:read(join(SOURCE,'reference/consumer-edits.json'))});
        requireValue(change.result.readyForApply,'DOWNSTREAM_PLAN','The selected consumer change must be ready.');
        const downstream=await this.downstream(primary,projectId,'baseline-consumer-apply',change.result.changePlanId,'apply');
        const handoff=await this.handoff(primary,projectId,'baseline-handoff','Original baseline native replication and reversible consumer');
        return{cutoverId:switched.result.cutoverId,consumer,downstream,changePlanId:change.result.changePlanId,handoff};
      });
      const changedSource=await this.phase('05-native-original-upsert',async()=>{
        const prepared=await this.action(primary,projectId,'prepare-increment-source','source.load',{sourceId:created.sources.increment.sourceId,mode:'incremental',table:'test1',primaryKey:['id'],updateKey:'create_dt',previousJobId:baselineSource.jobId});
        return this.completeJob(primary,projectId,'increment-source',prepared,{expectedRows:1002,kind:'source_import'});
      });
      const changed=await this.phase('06-evolved-plan-native-comparison',async()=>{
        const compiled=await this.action(primary,projectId,'compile-evolved','plan.compile',{sourceId:created.sources['evolved-catalogue'].sourceId,title:'Evolved source with retained update_dt and added json_data',options:read(join(SOURCE,'reference/evolved-bindings.json'))});
        requireValue(compiled.result.ready,'PLAN_ADAPTATION','The evolved full-source plan needs an explicit native adaptation.',409);
        const planId=compiled.result.planId;await this.action(primary,projectId,'review-evolved','plan.review',{planId,decision:'approved',notes:'Retain all original business columns and source identities; add json_data, preserve update_dt, select original id/create_dt upsert semantics.'});
        const prepared=await this.action(primary,projectId,'prepare-increment-replication','run.prepare',{planId,phase:'incremental',sourceJobId:changedSource.jobId,previousJobId:baseline.job.jobId});
        const job=await this.completeJob(primary,projectId,'increment-replication',prepared,{expectedRows:1002,kind:'replication'});
        const comparison=await this.compare(primary,projectId,'incremental',job.jobId,1002);return{planId,job,...comparison};
      });
      const cutovers=await this.phase('07-consumer-cutover-rollback-and-review',async()=>{
        const evolved=await this.phase('07a-evolved-consumer-selection',async()=>{
          const selected=await this.action(primary,projectId,'changed-cutover','cutover.apply',{comparisonId:changed.comparisonId,reason:'Select the complete 1,002-row evolved parallel target after every typed business row compared equal.'});
          const consumer=await this.consumer(primary,projectId,'changed',1002,selected.result.selection.snapshot);
          return{selected,consumer};
        });
        const rolled=await this.phase('07b-original-consumer-rollback',async()=>{
          const rollback=await this.action(primary,projectId,'rollback-to-baseline','cutover.rollback',{cutoverId:evolved.selected.result.cutoverId,reason:'Reopen the exact original 1,000-row baseline consumer snapshot without reverting source or native history.'});
          const consumer=await this.consumer(primary,projectId,'rollback',1000,baselineDelivery.consumer.selection.snapshot);
          const restoredFiles=await this.downstream(primary,projectId,'restore-original-consumer',baselineDelivery.changePlanId,'restore');
          return{rollback,consumer,restoredFiles};
        });
        const final=await this.phase('07c-final-consumer-selection',async()=>{
          const selected=await this.action(primary,projectId,'final-cutover','cutover.apply',{comparisonId:changed.comparisonId,reason:'Re-select the reviewed evolved parallel target after the exact original consumer rollback was observed.'});
          const consumer=await this.consumer(primary,projectId,'final',1002,evolved.selected.result.selection.snapshot);
          const newPlan=await this.action(primary,projectId,'evolved-consumer-plan','downstream.plan',{planId:changed.planId,sourceId:created.sources.consumer.sourceId,comparisonId:changed.comparisonId,title:'Reviewed evolved consumer relation selection',reason:'Apply the same literal relation mapping against the separately compared evolved plan.',edits:read(join(SOURCE,'reference/consumer-edits.json'))});
          const finalFiles=await this.downstream(primary,projectId,'evolved-consumer-apply',newPlan.result.changePlanId,'apply');
          const review=await this.action(primary,projectId,'record-full-native-review','review.record',{subjectId:changed.comparisonId,decision:'accepted_reference',notes:'Observed full original CSV import and upsert, 1,000 to 1,002 rows, all typed business values, actual immutable consumer cutover/rollback and full retained downstream pre/post files. This is reference engineering evidence, not a customer acceptance.'});
          return{selected,consumer,finalFiles,review};
        });
        return{changed:evolved.consumer,rollback:rolled.consumer,final:final.consumer,cutoverIds:[evolved.selected.result.cutoverId,rolled.rollback.result.cutoverId,final.selected.result.cutoverId],restoredFiles:rolled.restoredFiles,finalFiles:final.finalFiles,reviewId:final.review.result.reviewId};
      });
      const browserPrimary=await this.phase('08-primary-operator-browser',async()=>this.bindBrowserResult(await runBrowserJourney({directory:join(this.root,'browser','primary'),origin:primary.origin,operator:this.operator,viewer:this.viewer,projectId,phase:'primary',sourceIds:sources.map(s=>s.sourceId),planIds:[baseline.planId,changed.planId],jobIds:[baselineSource.jobId,baseline.job.jobId,changedSource.jobId,changed.job.jobId],comparisonIds:[baseline.comparisonId,changed.comparisonId],handoffIds:[baselineDelivery.handoff.handoffId],expectedRows:1002,sourceManifestSha256:this.source.identity.sha256,playwright:resolve(this.options.playwright),chromium:resolve(this.options.chromium),resume:this.options.resume===true})));
      const finalHandoff=await this.phase('09-current-complete-handoff',async()=>this.handoff(primary,projectId,'current-handoff','Complete evolved source, native comparison, consumer rollback and operator review'));
      const receiving=await this.startHost('receiving');
      const fresh=await this.phase('10-fresh-complete-receiving',async()=>{
        const placeholder=await this.create(receiving,'create-receiving-placeholder','Receive original Sling project','The original project identity and history will be adopted from its complete named package.');
        const response=await this.receive(receiving,placeholder,'receive-current',finalHandoff,'imported');
        requireValue(response.result.projectId===projectId&&response.result.currentRevision===finalHandoff.revision,'PROJECT_RECEIVING','The original project ID and exact full history must be preserved.');
        this.state.projects.receiving=projectId;this.save();
        const audit=await this.audit(receiving,projectId,'fresh-receiving',sources);
        const consumer=await this.consumer(receiving,projectId,'fresh-receiving',1002,cutovers.final.selection.snapshot);
        for(const pkg of [baselineDelivery.handoff,finalHandoff]){
          const r=await this.download(receiving,'/api/projects/'+projectId+'/outputs/handoff/'+pkg.handoffId,'receiving-downloads/'+pkg.handoffId+portableSuffix(pkg),pkg.archive);
          requireValue(r.sha256===pkg.archive.sha256,'NAMED_RECEIVING','A received named package changed bytes.');}
        return{projectId,placeholder,result:response.result,audit,consumer};
      });
      const browserReceiving=await this.phase('11-receiving-operator-browser',async()=>this.bindBrowserResult(await runBrowserJourney({directory:join(this.root,'browser','receiving'),origin:receiving.origin,operator:this.operator,viewer:this.viewer,projectId,phase:'receiving',sourceIds:sources.map(s=>s.sourceId),planIds:[baseline.planId,changed.planId],jobIds:[baselineSource.jobId,baseline.job.jobId,changedSource.jobId,changed.job.jobId],comparisonIds:[baseline.comparisonId,changed.comparisonId],handoffIds:[baselineDelivery.handoff.handoffId,finalHandoff.handoffId],expectedRows:1002,sourceManifestSha256:this.source.identity.sha256,playwright:resolve(this.options.playwright),chromium:resolve(this.options.chromium),resume:this.options.resume===true})));
      const returned=await this.phase('12-returned-descendant-and-prefix-receiving',async()=>{
        await this.action(receiving,projectId,'record-receiving-review','review.record',{subjectId:finalHandoff.handoffId,decision:'received_reference',notes:'The fresh installation opened the same original project/history, every source/native object, full actual consumer and unchanged named packages without configuring the native evaluator.'});
        const packageRecord=await this.handoff(receiving,projectId,'returned-handoff','Receiving review returned with complete original native and source history');
        const forward=await this.receive(primary,projectId,'receive-returned-descendant',packageRecord,'forward');
        const same=await this.receive(primary,projectId,'receive-same-descendant',packageRecord,'same');
        const older=await this.receive(primary,projectId,'receive-original-baseline',baselineDelivery.handoff,'older');
        requireValue(forward.result.currentRevision===packageRecord.revision&&same.result.currentRevision===packageRecord.revision&&older.result.currentRevision===packageRecord.revision,'PREFIX_HISTORY','Same/older receiving must preserve the returned current project head.');
        const audit=await this.audit(primary,projectId,'returned-receiving',sources),receivedAudit=await this.audit(receiving,projectId,'receiving-final',sources);
        const finalConsumer=await this.consumer(primary,projectId,'returned-final',1002,cutovers.final.selection.snapshot);
        return{packageRecord,forward:forward.result,same:same.result,older:older.result,audit,receivedAudit,consumer:finalConsumer};
      });
      await this.closeHost('receiving');await this.closeHost('primary');
      const reopened=await this.phase('13-cli-reopen-and-named-export',async()=>{
        const result={};for(const name of ['primary','receiving']){
          const directory=join(this.root,'workspaces',name);
          const shown=await this.cli(name+'-show','show',['--directory',directory,'--project',projectId,'--python',this.options.python??'python3']);
          requireValue(shown.value.view.id===projectId&&shown.value.view.revision===returned.packageRecord.revision,'CLI_PROJECT','CLI must reopen the same completed current project.');
          const consumer=await this.cli(name+'-consumer','consumer',['--directory',directory,'--project',projectId,'--stream',STREAM,'--limit','1000','--python',this.options.python??'python3']);
          requireValue(consumer.value.rowCount===1002&&consumer.value.snapshot.sha256===cutovers.final.selection.snapshot.sha256,'CLI_CONSUMER','CLI actual consumer selection differs.');
          const output=join(this.root,'cli',name+'-original-baseline'+portableSuffix(baselineDelivery.handoff));
          const downloaded=await this.cli(name+'-named-export','download',['--directory',directory,'--project',projectId,'--kind','handoff','--id',baselineDelivery.handoff.handoffId,'--output',output,'--python',this.options.python??'python3']);
          verify(output,baselineDelivery.handoff.archive);
          result[name]={projectId,revision:shown.value.view.revision,sourceCount:shown.value.view.sources.length,nativeJobCount:shown.value.view.jobs.length,rowCount:consumer.value.rowCount,baselineArchive:{path:localFile(output,this.root),...hashFile(output)},showReceipt:localFile(join(this.root,'cli',name+'-show.receipt.json'),this.root),consumerReceipt:localFile(join(this.root,'cli',name+'-consumer.receipt.json'),this.root)};
        }return result;
      });
      const browserArtifacts=[...this.verifyBrowserResult(browserPrimary),...this.verifyBrowserResult(browserReceiving)];
      for(const item of browserArtifacts)this.state.artifacts[item.path]={path:item.path,bytes:item.bytes,sha256:item.sha256};
      const packages=[baselineDelivery.handoff,finalHandoff,returned.packageRecord];
      for(const pkg of packages){verify(join(this.root,pkg.archive.path),pkg.archive);this.state.artifacts[pkg.handoffId]=pkg.archive;}
      for(const item of [baseline.report,baseline.observations,changed.report,changed.observations,cutovers.final,cutovers.rollback,returned.audit,returned.receivedAudit]){verify(join(this.root,item.path),item);this.state.artifacts[item.path]={path:item.path,bytes:item.bytes,sha256:item.sha256};}
      this.state.completedAt??=now();attempt.status='complete';attempt.completedAt=this.state.completedAt;this.save();
      const candidatePath=join(this.root,'customer-result-candidate.json');let result;
      if(existsSync(candidatePath))result=read(candidatePath);
      else{
        result={schema:'tjlabs.sling-customer-result.v1',status:'complete',operationId:this.state.id,completedAt:this.state.completedAt,source:{manifestSha256:this.source.identity.sha256,files:this.source.files.length,originalSlingCommit:EXPECTED_SOURCE,originalArchiveSha256:this.ready.archive.sha256},project:{projectId,revision:returned.packageRecord.revision,sourceCount:sources.length,planCount:2,nativeJobCount:4,comparisonCount:2},
          native:{baselineSource:baselineSource.rows,baselineReplication:baseline.job.rows,changedSource:changedSource.rows,changedReplication:changed.job.rows,preCommandCancellation:this.state.phases['baseline-source-cancel-before-command'].result,nativeJobIds:[baselineSource.jobId,baseline.job.jobId,changedSource.jobId,changed.job.jobId],allCommandsRetained:true},
          comparison:{baseline:{rows:1000,equal:true,readyForCutover:true,report:baseline.report,observations:baseline.observations},evolved:{rows:1002,equal:true,readyForCutover:true,report:changed.report,observations:changed.observations}},
          consumer:{baselineRows:1000,evolvedRows:1002,rollbackRows:1000,finalRows:1002,snapshot:cutovers.final.selection.snapshot,cutoverIds:cutovers.cutoverIds,downstreamApply:cutovers.finalFiles.operationId,downstreamRestore:cutovers.restoredFiles.operationId},
          browser:{primary:browserPrimary,receiving:browserReceiving},receiving:{fresh:fresh.result,forward:returned.forward,same:returned.same,older:returned.older,original:reopened.primary,received:reopened.receiving},
          namedPackages:packages.map(p=>({id:p.handoffId,revision:p.revision,...p.archive,versionCount:p.versionCount,sourceFiles:p.sourceFiles,objectCount:p.objectCount})),artifacts:Object.values(this.state.artifacts)};
        atomicJson(candidatePath,result,{immutable:true});
      }
      requireValue(result.operationId===this.state.id&&result.completedAt===this.state.completedAt&&result.project.projectId===projectId&&result.project.revision===returned.packageRecord.revision,'FINAL_RESULT_CHANGED','The retained final candidate names another original operation.',409);
      for(const file of result.artifacts)verify(join(this.root,file.path),file);
      atomicJson(join(this.root,'CUSTOMER_RESULT.json'),result,{immutable:true});this.state.artifacts.customerResult={path:'CUSTOMER_RESULT.json',...hashFile(join(this.root,'CUSTOMER_RESULT.json'))};this.state.status='complete';this.save();this.note({state:'complete',projectId,revision:result.project.revision,namedPackages:packages.length});return result;
    }catch(error){attempt.status='interrupted';attempt.completedAt=now();attempt.error={code:error.code??'RECEIVING_FAILED',message:error.message,details:error.details??{}};this.state.status='interrupted';this.save();this.note({state:'interrupted',phase:this.state.currentPhase,error:attempt.error});throw error;}
    finally{await this.close();}
  }
}
export async function main(argv=process.argv.slice(2)){
  const options=flags(argv),root=resolve(options.source),source=verifySource(root,resolve(options['source-manifest'])),ready=readRuntime(resolve(options['runtime-ready'])),reference=verifyReference(root);
  requireValue(Number(process.versions.node.split('.')[0])>=24,'NODE_RUNTIME','Use the actual selected Node 24+ interpreter.');
  requireValue(existsSync(resolve(options.playwright))&&existsSync(resolve(options.chromium)),'BROWSER_RUNTIME','Select the existing actual Playwright and Chromium files before opening the programme.');
  const directory=await privateDirectory(resolve(options.directory),{create:true}),lease=await acquireWorkspaceLease(join(directory,'receiving.lock'));
  let programme;
  try{programme=new Programme(options,source,ready,reference,lease);return await programme.run();}
  finally{
    // Preserve partially initialized hosts and the programme lease until the
    // original listener/workspace owners have actually closed. Retry only close.
    while(programme?.apps.size){
      try{await programme.close();}catch(error){process.stderr.write(JSON.stringify({operationId:programme.state.id,state:'OWNER_CLOSE_PENDING',error:{code:error.code??'OWNER_CLOSE_FAILED',message:error.message}})+'\n');await new Promise(done=>setTimeout(done,1000));}
    }
    await lease.close();
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'RECEIVING_FAILED',message:error.message,details:error.details??{}})+'\n');process.exitCode=1;});
