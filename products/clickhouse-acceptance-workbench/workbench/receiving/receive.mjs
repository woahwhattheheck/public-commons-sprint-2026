#!/usr/bin/env node
import { existsSync,readFileSync,mkdirSync,openSync,closeSync,readSync,writeSync,fsyncSync,renameSync,unlinkSync,readdirSync,lstatSync,realpathSync,createWriteStream } from 'node:fs';
import { join,resolve,dirname,basename,relative } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { createApplicationServer } from '../commissioning/server.mjs';
import { acquireWorkspaceLease,privateDirectory } from '../vendor/sling/vendor/stellar-expert/store.mjs';
import { atomicBytes,atomicJson,identity,canonical,requireValue,sha,now,safeRelative,collectSourceFiles,fsyncDirectory } from '../vendor/sling/core/common.mjs';
import { hashFile } from '../vendor/sling/core/objects.mjs';
import { runBrowserJourney } from './browser.mjs';

const SOURCE=resolve(fileURLToPath(new URL('..',import.meta.url)));
const STREAM='["starforge_example","transfers"]';
const portableSuffix=value=>value.portableSchema==='tjlabs.sling-portable.v2'?'.ndjson':'.ndjson.gz';
const portableMediaType=value=>value.portableSchema==='tjlabs.sling-portable.v2'?'application/x-ndjson':'application/gzip';
const EXPECTED_SOURCE='ce4fd5b79c7d098305a00567cf2c3cb983d4065d';
const SCHEMA='altinity.complete-receiving.v1';
function flags(argv){
  const out={};for(let i=0;i<argv.length;i++){const key=argv[i];requireValue(key.startsWith('--')&&!Object.hasOwn(out,key.slice(2)),'ARGUMENT','Use each documented option once.');
    if(key==='--resume')out.resume=true;else{requireValue(argv[i+1]&&!argv[i+1].startsWith('--'),'ARGUMENT','Supply a value after '+key+'.');out[key.slice(2)]=argv[++i];}}
  for(const key of ['source','directory','config','source-manifest','playwright','chromium'])requireValue(out[key],'ARGUMENT','Supply --'+key+'.');
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
  const required=["commissioning/merchant.mjs","reference/fixture.py","reference/fixture-input.json","reference/seed.sql","reference/merchant-source.json","WORKSHARE.md","SOURCE_REFERENCES.json","commissioning/plan.mjs","commissioning/worker.py","commissioning/runtime.mjs","commissioning/workspace.mjs","commissioning/server.mjs","cli.mjs","web/index.html","web/app.mjs","web/style.css","web/sha256.mjs","OPERATOR.md","receiving/receive.mjs","receiving/browser.mjs","vendor/sling/core/common.mjs","vendor/sling/core/objects.mjs","vendor/sling/core/uploads.mjs","vendor/sling/vendor/stellar-expert/LICENSE","vendor/sling/vendor/stellar-expert/store.mjs","vendor/sling/vendor/stellar-expert/provider.mjs","vendor/sling/vendor/stellar-expert/exact-json.mjs","vendor/sling/vendor/stellar-expert/schema.mjs","vendor/sling/vendor/stellar-expert/SOURCE.json","vendor/sling/core/REUSE.json","vendor/sling/core/store.mjs","vendor/sling/core/auth.mjs","vendor/sling/core/workspace.mjs","vendor/sling/migration/common.mjs","vendor/sling/migration/intake.mjs","vendor/sling/migration/plan.mjs","vendor/sling/migration/compare.mjs","vendor/sling/migration/downstream.mjs","vendor/sling/migration/index.mjs","vendor/sling/migration/cli.mjs","vendor/sling/core/archive.mjs","vendor/sling/migration/SOURCE_REFERENCES.json","vendor/sling/migration/OPERATING.md","vendor/sling/native/runtime.mjs"];
  for(const name of required)requireValue(names.has(name),'SOURCE_MANIFEST','The complete application/native/reference closure is missing '+name+'.',409);
  files.push({path:localFile(selectedManifest,root),...hashFile(selectedManifest),body:readFileSync(selectedManifest)});return{manifest,files,identity:hashFile(selectedManifest)};
}
function summary(view){
  return{projectId:view.id,revision:view.revision,sourceCount:view.sources.length,planCount:view.plans.length,jobCount:view.jobs.length,comparisonCount:view.comparisons.length,
    cutoverCount:view.cutovers.length,reviewCount:view.reviews.length,handoffIds:view.handoffs.map(x=>x.id),historyCount:view.history.length};
}
class Programme{
  constructor(options,source,config,lease){
    this.options=options;this.source=source;this.config=config;this.lease=lease;this.root=resolve(options.directory);this.apps=new Map();this.closing=null;
    this.statePath=join(this.root,'operation.json');
    const selected={schema:SCHEMA,sourceManifest:source.identity,config:hashFile(resolve(options.config)),node:{executable:process.execPath,version:process.version},expectedRows:3};
    if(existsSync(this.statePath)){this.state=read(this.statePath);requireValue(canonical(this.state.selection)===canonical(selected),'RECEIVING_SELECTION_CHANGED','The original programme has another complete source/configuration.',409);requireValue(options.resume||this.state.status==='complete','RESUME_REQUIRED','Continue this original programme with --resume.',409);}
    else{this.state={schema:SCHEMA,id:'altinity_receiving_'+randomUUID(),selection:selected,status:'prepared',createdAt:now(),phases:{},ports:{},projects:{},artifacts:{},attempts:[]};this.save();}
    atomicBytes(join(this.root,'source-manifest.json'),readFileSync(resolve(options['source-manifest'])),{immutable:true});
    atomicBytes(join(this.root,'intake','reference-config.json'),readFileSync(resolve(options.config)),{immutable:true});
    this.authPath=join(this.root,'installation-auth.json');
    if(!existsSync(this.authPath))atomicJson(this.authPath,{schema:'tjlabs.sling-auth.v1',actors:[{id:'altinity-reference-operator',name:'Reference acceptance operator',roles:['operator'],token:randomBytes(32).toString('hex')},{id:'altinity-reference-viewer',name:'Receiving reviewer',roles:['viewer'],token:randomBytes(32).toString('hex')}]},{immutable:true});
    const actors=read(this.authPath).actors;this.operator=actors.find(x=>x.roles.includes('operator'));this.viewer=actors.find(x=>x.roles.includes('viewer'));
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
    const app=await createApplicationServer({directory,authFile:this.authPath,python:this.options.python??'python3',sourceRoot:SOURCE,sourceFiles:this.source.files});
    const host={name,directory,app};this.apps.set(name,host);
    try{
      const info=await app.listen({host:'127.0.0.1',port:this.state.ports[name]??0});
      if(this.state.ports[name]===undefined){this.state.ports[name]=info.port;this.save();}
      requireValue(info.port===this.state.ports[name],'ORIGIN_CHANGED','Preserve the original receiving browser origin.',409);
      Object.assign(host,info);return host;
    }catch(error){try{await this.closeHost(name);}catch(closeError){this.note({state:'OWNER_CLOSE_PENDING',host:name,error:{code:closeError.code??'CLOSE_FAILED',message:closeError.message}});}throw error;}
  }
  async closeHost(name){const host=this.apps.get(name);if(!host)return;await host.app.close();this.apps.delete(name);}
  async close(){
    if(this.closing)return this.closing;
    this.closing=(async()=>{
      for(const name of [...this.apps.keys()].reverse())while(this.apps.has(name)){
        try{await this.closeHost(name);}
        catch(error){this.note({state:'OWNER_CLOSE_PENDING',host:name,error:{code:error.code??'CLOSE_FAILED',message:error.message}});await new Promise(resolve=>setTimeout(resolve,1000));}
      }
    })();
    try{await this.closing;}finally{this.closing=null;}
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
    else{selected={schema:'altinity.receiving-request.v1',intentSha256:intentHash,intent,method:'POST',...(await make()),createdAt:now()};atomicJson(paths.request,selected,{immutable:true});}
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
      if(this.options.resume&&job.status==='interrupted'){
        const originalAttempt=job.nativeState?.attempts?.at(-1)?.id??job.nativeSnapshotSha256??'before-first-attempt';
        const unresolved=Object.values(job.nativeState?.steps??{}).some(s=>s.writesTarget&&s.status!=='complete'&&!s.response?.usableSuccess);
        requireValue(!unresolved,'ORIGINAL_WRITE_DECISION','The interrupted native write needs its retained operator decision before programme continuation.',409,{jobId});
        await this.action(host,projectId,'resume-'+jobId+'-'+originalAttempt,'job.resume',{jobId,reason:'Explicit --resume continues this original ended native owner and preserves all original requests, data and observations.'});continue;
      }
      requireValue(['prepared','queued','running','cancelling'].includes(job.status),'NATIVE_CONTINUATION_REQUIRED','The original native job ended. Review its retained attempt before an explicit job.resume or target-write decision.',409,{jobId,status:job.status,error:job.nativeState?.error??null});
      await new Promise(done=>setTimeout(done,1000));
    }
  }
  async completeJob(host,projectId,key,prepared,{expectedRows,kind,cancelFirst=false}={}){
    const jobId=prepared.result.jobId;
    if(cancelFirst){
      await this.phase(key+'-cancel-before-command',async()=>{
        await this.action(host,projectId,key+'-cancel','job.cancel',{jobId,reason:'Retain an explicit pre-command cancellation, then continue this same original native transfer job.'});
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
  async consumer(host,projectId,key,expectedRows,expectedSelection){
    const result=await this.api(host,'/api/projects/'+projectId+'/consumer?streamId='+encodeURIComponent(STREAM)+'&offset=0&limit=1000');
    requireValue(result.mode==='retained-native-export'&&result.liveQuery===false&&result.rowCount===expectedRows&&result.rows.length===expectedRows,'CONSUMER_RECEIVING','Retain the exact complete selected native reference rows.',409);
    if(expectedSelection)requireValue(result.selection.snapshot.sha256===expectedSelection.snapshot.sha256,'CONSUMER_SELECTION','The original consumer declaration differs.',409);
    const path='delivery/'+key+'-consumer.json';atomicJson(join(this.root,path),result,{immutable:true});return{path,...hashFile(join(this.root,path)),selection:result.selection,rowCount:result.rowCount};
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
    if(this.state.status==='complete'){
      const resultPath=join(this.root,'CUSTOMER_RESULT.json');if(this.state.resultIdentity)verify(resultPath,this.state.resultIdentity);const result=read(resultPath);requireValue(result.operationId===this.state.id,'FINAL_RESULT_CHANGED','Retain this original result.',409);
      for(const f of result.artifacts)verify(join(this.root,f.path),f);return result;
    }
    const attempt={id:'attempt_'+randomUUID(),startedAt:now(),status:'running'};this.state.attempts.push(attempt);this.state.status='running';this.save();
    try{
      const primary=await this.startHost('primary');
      const projectId=await this.phase('00-original-project',()=>this.create(primary,'create','Original ClickHouse migration acceptance','Original 26.8.24.9 three-row reference. F8256 read-product offer and native merchant outcome remain separate.'));
      const retained=await this.phase('01-original-input',async()=>{
        const file=join(this.root,'intake','reference-config.json'),uploaded=await this.upload(primary,'config',file,'application/json');
        const answer=await this.action(primary,projectId,'retain-config','source.retain',{uploadId:uploaded.uploadId,title:'Original native reference configuration',role:'acceptance_config',url:'https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/'+EXPECTED_SOURCE,notes:'Full unchanged selected source/target configuration and original seed provenance.'});
        return{sourceId:answer.result.sourceId,...hashFile(file)};
      });
      const plan=await this.phase('02-compile-review',async()=>{
        const compiled=await this.action(primary,projectId,'compile','plan.compile',{sourceId:retained.sourceId,title:'Original complete typed transfer'});
        requireValue(compiled.result.ready,'REFERENCE_PLAN','The exact original reference must be runnable.',409);
        await this.action(primary,projectId,'approve','plan.review',{planId:compiled.result.planId,decision:'approved',notes:'Reviewed exact native columns, composite key, separate candidate, source quiescence and engine selection.'});
        return{planId:compiled.result.planId};
      });
      const transfer=await this.phase('03-original-transfer',async()=>{
        const prepared=await this.action(primary,projectId,'transfer-prepare','run.prepare',{planId:plan.planId,mode:'transfer'});
        return this.completeJob(primary,projectId,'transfer',prepared,{expectedRows:3,kind:'clickhouse_acceptance',cancelFirst:true});
      });
      const comparison=await this.phase('04-transfer-comparison',()=>this.compare(primary,projectId,'transfer-comparison',transfer.jobId,3));
      const verification=await this.phase('05-independent-current-verification',async()=>{
        const prepared=await this.action(primary,projectId,'verify-prepare','run.prepare',{planId:plan.planId,mode:'verify'});
        const job=await this.completeJob(primary,projectId,'verify',prepared,{expectedRows:3,kind:'clickhouse_acceptance'});
        const compared=await this.compare(primary,projectId,'verification-comparison',job.jobId,3);return{job,...compared};
      });
      const cutover=await this.phase('06-consumer-cutover-rollback',async()=>{
        const applied=await this.phase('06a-consumer-candidate',async()=>{
          const action=await this.action(primary,projectId,'cutover','cutover.apply',{comparisonId:verification.comparisonId,reason:'Select the fresh full verification of the same native pair; external consumer adoption remains through its original configuration.'});
          const consumer=await this.consumer(primary,projectId,'candidate',3,action.result.selection);
          return{action,consumer};
        });
        const rolled=await this.phase('06b-consumer-rollback',async()=>{
          const action=await this.action(primary,projectId,'rollback','cutover.rollback',{cutoverId:applied.action.result.cutoverId,reason:'Reopen the retained original source declaration without dropping tables or downgrading the engine.'});
          const consumer=await this.consumer(primary,projectId,'rollback',3,action.result.selection);
          return{action,consumer};
        });
        const selected=await this.phase('06c-consumer-final',async()=>{
          const action=await this.action(primary,projectId,'cutover-again','cutover.apply',{comparisonId:verification.comparisonId,reason:'Restore the same fully verified candidate declaration after original-binding rollback.'});
          const consumer=await this.consumer(primary,projectId,'final',3,action.result.selection);
          return{action,consumer};
        });
        return{first:applied.consumer,rollback:rolled.consumer,final:selected.consumer,cutoverIds:[applied.action.result.cutoverId,rolled.action.result.cutoverId,selected.action.result.cutoverId]};
      });
      const merchant=await this.phase('06b-original-read-source',async()=>{
        const file=join(SOURCE,'reference','merchant-source.json'),original=read(file),upload=await this.upload(primary,'merchant-source',file,'application/json');
        const retainedMerchant=await this.action(primary,projectId,'merchant-retain','source.retain',{uploadId:upload.uploadId,title:'Original native named-query source',role:'merchant_original',url:'https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/'+EXPECTED_SOURCE+'/stellar/scf-starforge-20261009/sf30-seller-sdk/clickhouse/examples/source.json',notes:'Unchanged complete original source, queries, parameters and typed limits.'});
        const target=this.config.tables[0].target[1],edits=[{queryId:'transfers',find:'FROM transfers WHERE',replace:'FROM '+target+' WHERE',expectedOccurrences:1,reason:'Review the same original named query against the exact fully compared candidate.'}];
        const derived=await this.action(primary,projectId,'merchant-derive','merchant.derive',{sourceId:retainedMerchant.result.sourceId,title:'Accepted candidate original read source',edits});
        const view=await this.view(primary,projectId),source=row(view.sources,derived.result.derivedSourceId,'derived source'),change=row(view.sources,derived.result.changeSourceId,'complete source change');
        const output=await this.download(primary,'/api/projects/'+projectId+'/sources/'+source.id,'delivery/clickhouse-derived-source.json',source),record=await this.download(primary,'/api/projects/'+projectId+'/sources/'+change.id,'delivery/clickhouse-source-change.json',change);
        const value=read(join(this.root,output.path)),proof=read(join(this.root,record.path));
        requireValue(value.database===this.config.tables[0].target[0]&&canonical(proof.originalSource)===canonical(original)&&canonical(proof.derivedSource)===canonical(value)&&proof.changes.length===1&&proof.nativeReviewRequired===true,'ORIGINAL_MERCHANT_SOURCE','Retain exact original/derived source and its separate native-review handoff.',409);
        requireValue(canonical(value.queries.transfers.parameters)===canonical(original.queries.transfers.parameters)&&value.queries.transfers.sql===original.queries.transfers.sql.replace('FROM transfers WHERE','FROM '+target+' WHERE'),'ORIGINAL_MERCHANT_QUERY','Native parameters and every unselected query byte remain unchanged.',409);
        return{sourceIds:[retainedMerchant.result.sourceId,source.id,change.id],output,record,nativeReviewRequired:true};
      });
      const h1=await this.phase('07-first-complete-handoff',()=>this.handoff(primary,projectId,'H1','Complete original acceptance and rollback edition'));
      const browserArgs={sourceRoot:SOURCE,sourceManifestSha256:this.source.identity.sha256,operator:this.operator,viewer:this.viewer,projectId,sourceIds:[retained.sourceId,...merchant.sourceIds],planIds:[plan.planId],jobIds:[transfer.jobId,verification.job.jobId],comparisonIds:[comparison.comparisonId,verification.comparisonId],handoffIds:[h1.handoffId],expectedRows:3,playwright:this.options.playwright,chromium:this.options.chromium,resume:this.options.resume===true};
      const browserPrimary=await this.phase('08-primary-operator',async()=>this.bindBrowserResult(await runBrowserJourney({...browserArgs,directory:join(this.root,'browser','primary'),origin:primary.origin,phase:'primary'})));
      const h2=await this.phase('09-reviewed-handoff',()=>this.handoff(primary,projectId,'H2','Complete operator-reviewed acceptance edition'));
      const receiving=await this.startHost('receiving');
      const fresh=await this.phase('10-fresh-receiving',async()=>{
        const placeholder=await this.create(receiving,'placeholder','Receiving original acceptance','Fresh private receiving host.');
        const imported=await this.receive(receiving,placeholder,'receive-H2',h2,'imported');
        const audit=await this.audit(receiving,projectId,'fresh',[retained]);
        const consumer=await this.consumer(receiving,projectId,'fresh',3,cutover.final.selection);
        return{result:imported.result,audit,consumer};
      });
      const browserReceiving=await this.phase('11-received-operator',async()=>this.bindBrowserResult(await runBrowserJourney({...browserArgs,directory:join(this.root,'browser','receiving'),origin:receiving.origin,phase:'receiving'})));
      const returned=await this.phase('12-returned-prefixes',async()=>{
        await this.action(receiving,projectId,'receiving-review','review.record',{subjectId:verification.comparisonId,decision:'received',notes:'Reviewed original complete typed data, native response files, consumer declarations and immutable history on the fresh receiving host.'});
        const h3=await this.handoff(receiving,projectId,'H3','Returned original customer review');
        const forward=await this.receive(primary,projectId,'forward-H3',h3,'forward');
        const same=await this.receive(primary,projectId,'same-H3',h3,'same');
        const older=await this.receive(primary,projectId,'older-H1',h1,'older');
        requireValue(forward.result.currentRevision===h3.revision&&same.result.currentRevision===h3.revision&&older.result.currentRevision===h3.revision,'PREFIX_HISTORY','Older/same input must preserve the returned current head.',409);
        const audit=await this.audit(primary,projectId,'returned',[retained]);return{h3,forward:forward.result,same:same.result,older:older.result,audit};
      });
      await this.closeHost('receiving');await this.closeHost('primary');
      const reopened=await this.phase('13-cli-reopen',async()=>{
        const result={};
        for(const name of ['primary','receiving']){
          const directory=join(this.root,'workspaces',name),shown=await this.cli(name+'-show','show',['--directory',directory,'--project',projectId,'--python',this.options.python??'python3']);
          requireValue(shown.value.view.revision===returned.h3.revision,'CLI_REOPEN','CLI reopened another original revision.',409);
          const consumed=await this.cli(name+'-consumer','consumer',['--directory',directory,'--project',projectId,'--stream',STREAM,'--limit','1000']);
          requireValue(consumed.value.rowCount===3&&consumed.value.selection.snapshot.sha256===cutover.final.selection.snapshot.sha256,'CLI_CONSUMER','The received original binding differs.',409);
          const out=join(this.root,'cli',name+'-H1.ndjson');await this.cli(name+'-named','download',['--directory',directory,'--project',projectId,'--kind','handoff','--id',h1.handoffId,'--output',out]);
          verify(out,h1.archive);result[name]={revision:shown.value.view.revision,named:{path:localFile(out,this.root),...hashFile(out)}};
        }return result;
      });
      const artifacts=[merchant.output,merchant.record,...this.verifyBrowserResult(browserPrimary),...this.verifyBrowserResult(browserReceiving),...[h1,h2,returned.h3].map(h=>h.archive),comparison.report,comparison.observations,verification.report,verification.observations,cutover.first,cutover.rollback,cutover.final,fresh.audit,fresh.consumer,returned.audit,...Object.values(reopened).map(x=>x.named)];
      for(const item of artifacts){verify(join(this.root,item.path),item);this.state.artifacts[item.path]={path:item.path,bytes:item.bytes,sha256:item.sha256};}
      this.state.completedAt??=now();attempt.status='complete';attempt.completedAt=this.state.completedAt;this.save();
      const candidatePath=join(this.root,'customer-result-candidate.json');
      const result=existsSync(candidatePath)?read(candidatePath):{schema:'altinity.customer-result.v1',operationId:this.state.id,status:'complete',completedAt:this.state.completedAt,projectId,revision:returned.h3.revision,sourceManifest:this.source.identity,originalEngine:'26.8.24.9',originalExampleRows:3,nativeJobs:[transfer,verification.job],comparison:[comparison,verification],consumer:cutover,merchant,browser:{primary:browserPrimary,receiving:browserReceiving},receiving:{fresh:fresh.result,forward:returned.forward,same:returned.same,older:returned.older,reopened},namedPackages:[h1,h2,returned.h3],artifacts:Object.values(this.state.artifacts),commercial:'Reference engineering evidence only; original sent offer and customer acceptance remain separate.'};
      requireValue(result.operationId===this.state.id&&result.completedAt===this.state.completedAt&&result.revision===returned.h3.revision,'FINAL_RESULT_CHANGED','The final original candidate has another identity.',409);
      for(const f of result.artifacts)verify(join(this.root,f.path),f);
      atomicJson(candidatePath,result,{immutable:true});atomicJson(join(this.root,'CUSTOMER_RESULT.json'),result,{immutable:true});this.state.resultIdentity=hashFile(join(this.root,'CUSTOMER_RESULT.json'));this.state.status='complete';this.save();return result;
    }catch(error){attempt.status='interrupted';attempt.completedAt=now();attempt.error={code:error.code??'RECEIVING_FAILED',message:error.message,details:error.details??{}};this.state.status='interrupted';this.save();throw error;}
    finally{await this.close();}
  }
}
export async function main(argv=process.argv.slice(2)){
  const options=flags(argv),source=verifySource(resolve(options.source),resolve(options['source-manifest'])),config=read(resolve(options.config));
  requireValue(Number(process.versions.node.split('.')[0])>=24,'NODE_RUNTIME','Select the original Node24+ interpreter.');
  requireValue(config.schema==='altinity.acceptance-input.v1'&&config.tables.length===1&&canonical(config.tables[0].source)===canonical(['starforge_example','transfers']),'REFERENCE_INPUT','Select the complete original three-row source reference.');
  requireValue(existsSync(resolve(options.playwright))&&existsSync(resolve(options.chromium)),'BROWSER_RUNTIME','Select actual existing browser runtime paths.');
  const directory=await privateDirectory(resolve(options.directory),{create:true}),lease=await acquireWorkspaceLease(join(directory,'receiving.lock'));
  let programme;try{programme=new Programme(options,source,config,lease);return await programme.run();}finally{if(programme)await programme.close();if(!programme||programme.apps.size===0)await lease.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'RECEIVING_FAILED',message:error.message,details:error.details??{}})+'\n');process.exitCode=1;});
