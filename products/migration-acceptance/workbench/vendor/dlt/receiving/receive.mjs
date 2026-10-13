#!/usr/bin/env node
import { existsSync,readFileSync,mkdirSync,openSync,closeSync,readSync,writeSync,fsyncSync,renameSync,unlinkSync,readdirSync,lstatSync,realpathSync,createWriteStream } from 'node:fs';
import { join,resolve,dirname,basename,relative } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { createApplicationServer } from '../pipeline/server.mjs';
import { acquireWorkspaceLease,privateDirectory } from '../vendor/sling/vendor/stellar-expert/store.mjs';
import { atomicBytes,atomicJson,identity,canonical,requireValue,sha,now,safeRelative,collectSourceFiles,fsyncDirectory } from '../vendor/sling/core/common.mjs';
import { hashFile } from '../vendor/sling/core/objects.mjs';
import { runBrowserJourney } from './browser.mjs';
import { retainReceivingSourceManifest,sourceAdoptionArtifacts } from './source-adoption.mjs';

const SOURCE=resolve(fileURLToPath(new URL('..',import.meta.url)));
const STREAM='["migration_reference","records"]';
const portableSuffix=value=>value.portableSchema==='tjlabs.sling-portable.v2'?'.ndjson':'.ndjson.gz';
const portableMediaType=value=>value.portableSchema==='tjlabs.sling-portable.v2'?'application/x-ndjson':'application/gzip';
const EXPECTED_SOURCE='2360d229c77f7f64692acc31a4555f4cfcd50ed3';
const SCHEMA='dlthub.complete-receiving.v1';
function flags(argv){
  const out={};for(let i=0;i<argv.length;i++){const key=argv[i];requireValue(key.startsWith('--')&&!Object.hasOwn(out,key.slice(2)),'ARGUMENT','Use each documented option once.');
    if(key==='--resume')out.resume=true;else{requireValue(argv[i+1]&&!argv[i+1].startsWith('--'),'ARGUMENT','Supply a value after '+key+'.');out[key.slice(2)]=argv[++i];}}
  for(const key of ['source','directory','config','runtime-ready','source-manifest','playwright','chromium'])requireValue(out[key],'ARGUMENT','Supply --'+key+'.');
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
  const required=["pipeline/plan.mjs","pipeline/worker.py","pipeline/runtime.mjs","pipeline/workspace.mjs","pipeline/server.mjs","reference/prepare.py","reference/programme.json","reference/original/test1.csv","reference/original/test1.upsert.csv","upstream/dlt/tests/normalize/cases/github.events.load_page_1_duck.json","runtime/runtime.mjs","runtime/inspect.py","runtime/portable.py","cli.mjs","web/index.html","web/app.mjs","web/style.css","web/sha256.mjs","OPERATOR.md","WORKSHARE.md","receiving/receive.mjs","receiving/browser.mjs","receiving/upstream_reference.py","upstream_contracts/run_original_staged_reference.py","upstream_contracts/source_manifest.json","vendor/sling/core/archive.mjs","vendor/sling/core/store.mjs","vendor/sling/core/common.mjs","vendor/sling/core/workspace.mjs","vendor/sling/core/objects.mjs","vendor/sling/native/runtime.mjs","vendor/sling/migration/compare.mjs","vendor/sling/vendor/stellar-expert/store.mjs"];
  for(const name of required)requireValue(names.has(name),'SOURCE_MANIFEST','The complete application/native/reference closure is missing '+name+'.',409);
  files.push({path:localFile(selectedManifest,root),...hashFile(selectedManifest),body:readFileSync(selectedManifest)});return{manifest,files,identity:hashFile(selectedManifest)};
}
function summary(view){
  return{projectId:view.id,revision:view.revision,sourceCount:view.sources.length,planCount:view.plans.length,jobCount:view.jobs.length,comparisonCount:view.comparisons.length,
    cutoverCount:view.cutovers.length,reviewCount:view.reviews.length,handoffIds:view.handoffs.map(x=>x.id),historyCount:view.history.length};
}
class Programme{
  constructor(options,source,config,lease){
    this.options=options;this.source=source;this.config=config;this.lease=lease;this.root=resolve(options.directory);this.apps=new Map();this.closing=false;
    this.statePath=join(this.root,'operation.json');
    const selected={schema:SCHEMA,sourceManifest:source.identity,config:hashFile(resolve(options.config)),node:{executable:process.execPath,version:process.version},expectedRows:1002,runtimeReady:hashFile(resolve(options['runtime-ready'])),receivingRuntimeReady:options['receiving-runtime-ready']?hashFile(resolve(options['receiving-runtime-ready'])):null};
    if(existsSync(this.statePath)){this.state=read(this.statePath);requireValue(canonical(this.state.selection)===canonical(selected),'RECEIVING_SELECTION_CHANGED','The original programme has another complete source/configuration.',409);requireValue(options.resume||this.state.status==='complete','RESUME_REQUIRED','Continue this original programme with --resume.',409);}
    else{this.state={schema:SCHEMA,id:'dlthub_receiving_'+randomUUID(),selection:selected,status:'prepared',createdAt:now(),phases:{},ports:{},projects:{},artifacts:{},attempts:[]};this.save();}
    retainReceivingSourceManifest(this.root,this.state,resolve(options['source-manifest']),source.identity);
    atomicBytes(join(this.root,'intake','reference-config.json'),readFileSync(resolve(options.config)),{immutable:true});
    this.authPath=join(this.root,'installation-auth.json');
    if(!existsSync(this.authPath))atomicJson(this.authPath,{schema:'tjlabs.sling-auth.v1',actors:[{id:'dlt-reference-operator',name:'Reference acceptance operator',roles:['operator'],token:randomBytes(32).toString('hex')},{id:'dlt-reference-viewer',name:'Receiving reviewer',roles:['viewer'],token:randomBytes(32).toString('hex')}]},{immutable:true});
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
    const app=await createApplicationServer({directory,authFile:this.authPath,python:this.options.python??'python3',runtimeReadyFile:name==='receiving'?(this.state.phases['19-runtime-offline-receiving']?.result?.readyPath??this.options['receiving-runtime-ready']??this.options['runtime-ready']):this.options['runtime-ready'],sourceRoot:SOURCE,sourceFiles:this.source.files});
    try{
      const info=await app.listen({host:'127.0.0.1',port:this.state.ports[name]??0});
      if(this.state.ports[name]===undefined){this.state.ports[name]=info.port;this.save();}
      requireValue(info.port===this.state.ports[name],'ORIGIN_CHANGED','Preserve the original receiving browser origin.',409);
      const host={name,directory,app,...info};this.apps.set(name,host);return host;
    }catch(error){await app.close();throw error;}
  }
  async closeHost(name){const host=this.apps.get(name);if(!host)return;await host.app.close();this.apps.delete(name);}
  async close(){if(this.closing)return;this.closing=true;for(const name of [...this.apps.keys()].reverse())await this.closeHost(name);}
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
    else{selected={schema:'dlthub.receiving-request.v1',intentSha256:intentHash,intent,method:'POST',...(await make()),createdAt:now()};atomicJson(paths.request,selected,{immutable:true});}
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
        const unresolved=Object.values(job.nativeState?.steps??{}).some(s=>s.writesTarget&&s.status!=='complete'&&!s.result&&!['normalize','load','abort'].includes(s.id));
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
    let first=null,rows=[];
    for(let offset=0;;offset+=1000){
      const result=await this.api(host,'/api/projects/'+projectId+'/consumer?streamId='+encodeURIComponent(STREAM)+'&offset='+offset+'&limit=1000');
      requireValue(result.mode==='retained-complete-native-export'&&result.liveQuery===false&&result.rowCount===expectedRows,'CONSUMER_RECEIVING','Retain the original complete typed result.',409);
      if(expectedSelection)requireValue(result.selection.snapshot.sha256===expectedSelection.snapshot.sha256,'CONSUMER_SELECTION','Original binding differs.',409);
      if(first)requireValue(result.selection.snapshot.sha256===first.selection.snapshot.sha256&&canonical(result.columns)===canonical(first.columns),'CONSUMER_CHANGED','Consumer changed across original retained pages.',409);else first=result;
      rows.push(...result.rows);if(rows.length>=result.rowCount)break;
      requireValue(result.rows.length===1000,'CONSUMER_PAGE','The complete population ended before its original count.',409);
    }
    requireValue(rows.length===expectedRows,'CONSUMER_POPULATION','Every original typed row is required.',409);
    const result={...first,rows,offset:0,limit:expectedRows},path='delivery/'+key+'-consumer.json';atomicJson(join(this.root,path),result,{immutable:true});return{path,...hashFile(join(this.root,path)),selection:result.selection,rowCount:result.rowCount};
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
    for(const job of view.jobs){requireValue(!['running','queued','cancelling'].includes(job.status),'NATIVE_RECEIVING','Every original native job must be closed; retained failed package history remains explicit.');for(const file of job.files)host.app.workspace.store.objects.verify(file.sha256,file.bytes);}
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
  async localSource(host,projectId,key,path,{title,role='data',notes='Complete original source retained.',mediaType}={}){
    const original=hashFile(path),intake=join(this.root,'intake');mkdirSync(intake,{recursive:true,mode:0o700});
    const staged=join(intake,original.sha256+'-'+basename(path));atomicBytes(staged,readFileSync(path),{immutable:true});verify(staged,original);
    const upload=await this.upload(host,'local-'+key,staged,mediaType??(path.endsWith('.csv')?'text/csv':'application/json'));
    const answer=await this.action(host,projectId,'retain-'+key,'source.retain',{uploadId:upload.uploadId,title:title??key,role,url:'',notes});
    return{sourceId:answer.result.sourceId,...hashFile(path)};
  }
  async receiveRuntime(primary,projectId){
    const selected=this.state.phases['19-runtime-offline-receiving']?.result;
    if(selected){verify(join(this.root,selected.receipt.path),selected.receipt);return selected;}
    const original=read(resolve(this.options['runtime-ready'])),view=await this.view(primary,projectId),archive=view.runtime?.archive;
    requireValue(original.portable&&archive&&archive.sha256===original.portable.sha256&&archive.bytes===original.portable.bytes,'RUNTIME_PORTABLE','The complete original runtime must belong to the retained application handoff.',409);
    const bundle=primary.app.workspace.store.objects.path(archive.sha256);verify(bundle,archive);
    const readyPath=this.options['receiving-runtime-ready']?resolve(this.options['receiving-runtime-ready']):join(this.root,'runtime-received','runtime-ready.json'),directory=dirname(readyPath);
    const validReady=value=>value?.schema==='dlt-workshare.runtime-ready.v1'&&value.state==='ready'&&value.runtimeId===original.runtimeId&&value.origin?.kind==='offline-receiving'&&value.origin.archiveSha256===archive.sha256;
    const completeReady=value=>validReady(value)&&value.portable?.sha256===archive.sha256&&value.portable.bytes===archive.bytes;
    const existing=existsSync(readyPath)?read(readyPath):null;
    if(existing)requireValue(validReady(existing),'RUNTIME_RECEIVING','The existing receiving runtime belongs to another original selection.',409);
    if(this.options['receiving-runtime-ready'])requireValue(completeReady(existing),'RUNTIME_RECEIVING','Explicit receiving runtime must already carry the complete original portable descriptor.',409);
    const argv=completeReady(existing)
      ?[join(SOURCE,'runtime/runtime.mjs'),'verify','--directory',dirname(readyPath)]
      :[join(SOURCE,'runtime/runtime.mjs'),'receive','--bundle',bundle,'--sha256',archive.sha256,'--directory',directory,'--python',this.options['receiving-python']??original.python.executable];
    const logs=join(this.root,'runtime-observations');mkdirSync(logs,{recursive:true,mode:0o700});
    const intentPath=join(this.root,'runtime-receiving-intent.json'),intent={schema:'dlthub.runtime-receiving-intent.v1',runtimeId:original.runtimeId,archive,readyPath,directory,originalRuntimeReady:this.state.selection.runtimeReady};
    atomicJson(intentPath,intent,{immutable:true});
    const observationId='offline-'+randomUUID(),out=join(logs,observationId+'.stdout.json'),err=join(logs,observationId+'.stderr.txt'),receipt=join(logs,observationId+'.receipt.json');
    atomicJson(join(logs,observationId+'.intent.json'),{intent:hashFile(intentPath),argv,node:process.execPath,stdout:localFile(out,this.root),stderr:localFile(err,this.root)},{immutable:true});
    const output=openSync(out,'wx',0o600),error=openSync(err,'wx',0o600);let child;
    const completion=new Promise((yes,no)=>{try{child=spawn(process.execPath,argv,{cwd:SOURCE,stdio:['ignore',output,error]});child.once('error',no);child.once('exit',(code,signal)=>yes({code,signal}));}catch(e){no(e);}});
    closeSync(output);closeSync(error);
    const observed=await completion;
    atomicJson(receipt,{argv,node:process.execPath,...observed,stdout:hashFile(out),stderr:hashFile(err)},{immutable:true});
    requireValue(observed.code===0,'RUNTIME_RECEIVING','Continue the original runtime receive/verification; complete native logs are retained.',409,{receipt:localFile(receipt,this.root)});
    const actual=read(readyPath);requireValue(completeReady(actual),
      'RUNTIME_RECEIVING','The rebuilt offline runtime must preserve the complete original installed identity and archive.',409);
    const saved=join(this.root,'runtime-received-ready.json');
    if(existsSync(saved)){const retained=read(saved);requireValue(completeReady(retained)&&retained.identitySha256===actual.identitySha256&&retained.installedManifestSha256===actual.installedManifestSha256&&retained.python.executable===actual.python.executable,'RUNTIME_RECEIVING','The original received ready snapshot differs from the verified current installation.',409);}
    else atomicBytes(saved,readFileSync(readyPath),{immutable:true});
    return{runtimeId:actual.runtimeId,readyPath,archive,receipt:{path:localFile(saved,this.root),...hashFile(saved)},observation:{path:localFile(receipt,this.root),...hashFile(receipt)},logs:[{path:localFile(intentPath,this.root),...hashFile(intentPath)},...readdirSync(logs).sort().map(name=>({path:localFile(join(logs,name),this.root),...hashFile(join(logs,name))}))]};
  }
  async originalStagedReference(){
    const readyPath=resolve(this.options['runtime-ready']),ready=read(readyPath);
    const job=await privateDirectory(join(this.root,'upstream-original'),{create:true});
    const resultPath=join(job,'original-reference-result.json');
    const bridge=join(SOURCE,'receiving/upstream_reference.py');
    const worker=[ready.python.executable,'-B',bridge,'--directory',job,'--runtime-ready',readyPath,
      '--companion',join(SOURCE,'upstream_contracts')];
    const argv=[join(SOURCE,'runtime/runtime.mjs'),'run','--directory',dirname(readyPath),
      '--cwd',SOURCE,'--argv-json',JSON.stringify(worker),'--operation-lock',join(job,'lifetime.lock')];
    const logs=join(job,'receiver-observations');mkdirSync(logs,{recursive:true,mode:0o700});
    const intent={schema:'dlthub.original-reference-intent.v1',runtimeId:ready.runtimeId,
      ready:this.state.selection.runtimeReady,source:this.source.identity,bridge:hashFile(bridge),worker,argv};
    atomicJson(join(job,'receiving-intent.json'),intent,{immutable:true});
    {
      const previousPath=join(job,'runtime-run.json');
      requireValue(this.options.resume||!existsSync(previousPath),
        'RESUME_REQUIRED','Continue this same original reference runtime operation with --resume.',409);
      if(existsSync(previousPath)){
        const previous=read(previousPath),owner=previous.process;
        requireValue(previous.operationLock===join(job,'lifetime.lock')&&previous.runtimeDirectory===dirname(readyPath)&&
          canonical(previous.argv)===canonical(worker),'ORIGINAL_REFERENCE','Retain the original selected runtime invocation.',409);
        let alive=false;
        if(owner){
          requireValue(Number.isSafeInteger(owner.pid)&&owner.pid>0&&typeof owner.start==='string'&&typeof owner.boot==='string',
            'ORIGINAL_REFERENCE','Retain the original complete runtime process identity.',409);
          try{
            const source=readFileSync('/proc/'+owner.pid+'/stat','utf8'),parts=source.slice(source.lastIndexOf(')')+2).split(' ');
            const boot=readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
            alive=parts[19]===owner.start&&boot===owner.boot&&!['Z','X'].includes(parts[0]);
          }catch(error){if(error.code!=='ENOENT')throw error;}
        }
        requireValue(!alive,'ORIGINAL_REFERENCE_ACTIVE',
          'The original reference runtime is still completing; resume this same programme after its exit.',409);
      }
      const id='reference-'+randomUUID(),out=join(logs,id+'.stdout.json'),err=join(logs,id+'.stderr.txt');
      const output=openSync(out,'wx',0o600),error=openSync(err,'wx',0o600);
      let child;
      const completion=new Promise((yes,no)=>{try{
        child=spawn(process.execPath,argv,{cwd:SOURCE,stdio:['ignore',output,error]});
        child.once('error',no);child.once('exit',(code,signal)=>yes({code,signal}));
      }catch(e){no(e);}});
      closeSync(output);closeSync(error);
      const observed=await completion;
      const receipt=join(logs,id+'.receipt.json');
      atomicJson(receipt,{argv,node:process.execPath,...observed,stdout:hashFile(out),stderr:hashFile(err)},{immutable:true});
      requireValue(observed.code===0,'ORIGINAL_REFERENCE',
        'Continue the retained original staged reference; complete runtime and native logs are preserved.',409,
        {receipt:localFile(receipt,this.root)});
    }
    const result=read(resultPath);
    requireValue(result.schema==='dlthub.original-staged-reference-result.v1'&&result.runtimeId===ready.runtimeId&&
      result.sourceCommit===EXPECTED_SOURCE&&result.sourceIssues===100&&result.destinationIssues===100&&
      Array.isArray(result.loadIds)&&result.loadIds.length>0&&Array.isArray(result.files),
      'ORIGINAL_REFERENCE','Receive the complete unchanged 100-issue native reference.',409);
    const nativeFiles=result.files.map(item=>{
      const path=join(job,safeRelative(item.path));verify(path,item);
      return{...item,path:localFile(path,this.root)};
    });
    const archive=nativeFiles.find(file=>file.kind==='complete_original_archive');
    requireValue(archive&&nativeFiles.some(file=>file.kind==='report')&&nativeFiles.some(file=>file.kind==='archive_manifest'),
      'ORIGINAL_REFERENCE','Retain the original reference archive, report and member manifest.',409);
    const resultFile={path:localFile(resultPath,this.root),...hashFile(resultPath)};
    const logFiles=readdirSync(logs).sort().map(name=>({path:localFile(join(logs,name),this.root),...hashFile(join(logs,name))}));
    return{runtimeId:result.runtimeId,sourceCommit:result.sourceCommit,sourceIssues:100,destinationIssues:100,
      loadIds:result.loadIds,pipelineName:result.pipelineName,datasetName:result.datasetName,archive,result:resultFile,
      artifacts:[resultFile,...nativeFiles,...logFiles,{path:localFile(join(job,'receiving-intent.json'),this.root),...hashFile(join(job,'receiving-intent.json'))}]};
  }
  async reference(){
    const out=join(this.root,'reference'),script=join(SOURCE,'reference','prepare.py'),python=this.options.python??'python3';
    // Deterministic immutable source realization: re-entry only verifies or
    // publishes identical complete outputs. It never opens dlt or a destination.
    const logs=join(this.root,'reference-preparation');mkdirSync(logs,{recursive:true,mode:0o700});
    const code=await new Promise((yes,no)=>{const child=spawn(python,[script,'--source',SOURCE,'--output',out],{cwd:SOURCE,stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);child.once('error',no);child.once('exit',code=>{atomicBytes(join(logs,'stdout.json'),Buffer.from(output),{immutable:code===0});atomicBytes(join(logs,'stderr.txt'),Buffer.from(error));yes(code);});});
    requireValue(code===0,'REFERENCE_REALIZATION','The original complete reference source did not realize.',409);
    const derivation=read(join(out,'DERIVATION.json'));for(const file of derivation.outputs)verify(join(out,file.path),file);
    return{directory:'reference',derivation:{path:'reference/DERIVATION.json',...hashFile(join(out,'DERIVATION.json'))},baselineRows:derivation.baselineRows,finalRows:derivation.finalRows};
  }
  async plan(host,projectId,key,input,data,expected){
    const selected=structuredClone(input);for(const resource of selected.resources)resource.sourceId=data.sourceId;
    for(const table of selected.acceptance)table.expectedSourceId=expected.sourceId;
    const path=join(this.root,'reference',key+'-selected.json');atomicJson(path,selected,{immutable:true});
    const source=await this.localSource(host,projectId,key+'-input',path,{title:selected.title,role:'pipeline_config'});
    const compiled=await this.action(host,projectId,key+'-compile','plan.compile',{sourceId:source.sourceId,title:selected.title});
    requireValue(compiled.result.ready,'REFERENCE_PLAN','The exact reference declaration must be runnable.',409);
    await this.action(host,projectId,key+'-approve','plan.review',{planId:compiled.result.planId,decision:'approved',notes:'Reviewed complete original data, independent typed population, native cursor, primary key and schema contract.'});
    return{planId:compiled.result.planId,source};
  }
  async stage(host,projectId,key,plan,parent,stage,options={}){
    const prepared=await this.action(host,projectId,key+'-prepare','run.prepare',{planId:plan.planId,parentJobId:parent?.jobId,stage,options:options.native??{},reason:options.reason??'Continue the original complete native pipeline.',forkReason:options.forkReason});
    return this.completeJob(host,projectId,key,prepared,{expectedRows:options.rows,kind:'dlt_pipeline',cancelFirst:options.cancelFirst===true});
  }
  async run(){
    if(this.state.status==='complete'){
      const path=join(this.root,'CUSTOMER_RESULT.json');verify(path,this.state.resultIdentity);const result=read(path);
      requireValue(result.operationId===this.state.id,'FINAL_RESULT_CHANGED','Retain the original completed result.',409);
      for(const item of result.artifacts)verify(join(this.root,item.path),item);return result;
    }
    const attempt={id:'attempt_'+randomUUID(),startedAt:now(),status:'running'};this.state.attempts.push(attempt);this.state.status='running';this.save();
    try{
      const primary=await this.startHost('primary');
      const projectId=await this.phase('00-project',()=>this.create(primary,'create','Original dlt pipeline migration','Complete original data, native pipeline state and independent typed parity.'));
      const reference=await this.phase('01-original-realization',()=>this.reference());
      const originalReference=await this.phase('01b-original-upstream-stages',()=>this.originalStagedReference());
      const inputs=await this.phase('02-retained-source-editions',async()=>{
        const baseline=await this.localSource(primary,projectId,'baseline',join(SOURCE,'reference/original/test1.csv'),{title:'Original complete 1,000-row baseline'});
        const partial=await this.localSource(primary,projectId,'original-partial-change',join(SOURCE,'reference/original/test1.upsert.csv'),{title:'Original unchanged 14-row partial change'});
        const change=await this.localSource(primary,projectId,'complete-change',join(this.root,'reference/change-complete.csv'),{title:'Explicit complete changed rows'});
        const left=await this.localSource(primary,projectId,'expected-baseline',join(this.root,'reference/baseline-expected.json'),{title:'Independent 1,000-row expected population',role:'expected'});
        const right=await this.localSource(primary,projectId,'expected-evolved',join(this.root,'reference/evolved-expected.json'),{title:'Independent 1,002-row expected population',role:'expected'});
        const events=await this.localSource(primary,projectId,'upstream-events',join(SOURCE,'upstream/dlt/tests/normalize/cases/github.events.load_page_1_duck.json'),{title:'Full original 100-event nested upstream fixture'});
        const derivation=await this.localSource(primary,projectId,'source-derivation',join(this.root,reference.derivation.path),{title:'Exact source derivation and unchanged original identities',role:'documentation'});
        const upstreamArchive=await this.localSource(primary,projectId,'original-upstream-archive',join(this.root,originalReference.archive.path),
          {title:'Complete unchanged upstream 100-issue reference and native HTML report',role:'documentation',mediaType:'application/gzip',
           notes:'Complete original staged source, native pipeline, database, every export and full linked HTML report. Extract the retained archive to open its index.html with all source links.'});
        const upstreamResult=await this.localSource(primary,projectId,'original-upstream-result',join(this.root,originalReference.result.path),
          {title:'Original upstream staged-reference receiving result',role:'documentation'});
        return{baseline,partial,change,left,right,events,derivation,upstreamArchive,upstreamResult};
      });
      const initial=await this.phase('03-baseline-plan',()=>this.plan(primary,projectId,'baseline',read(join(this.root,'reference/baseline-input.json')),inputs.baseline,inputs.left));
      const extracted=await this.phase('04-original-extract',()=>this.stage(primary,projectId,'baseline-extract',initial,null,'extract',{cancelFirst:true}));
      const normalized=await this.phase('05-original-normalize',()=>this.stage(primary,projectId,'baseline-normalize',initial,extracted,'normalize'));
      const loaded=await this.phase('06-original-load',async()=>{const job=await this.stage(primary,projectId,'baseline-load',initial,normalized,'load',{rows:1000});const comparison=await this.compare(primary,projectId,'baseline-parity',job.jobId,1000);return{job,comparison};});
      const blocked=await this.phase('07-native-schema-contract-hold',async()=>{
        const plan=await this.plan(primary,projectId,'blocked',read(join(this.root,'reference/blocked-input.json')),inputs.change,inputs.right);
        const prepared=await this.action(primary,projectId,'blocked-prepare','run.prepare',{planId:plan.planId,parentJobId:loaded.job.jobId,stage:'run',reason:'Observe the original frozen-column contract against the explicit new json_data field.'});
        await this.action(primary,projectId,'blocked-start','job.start',{jobId:prepared.result.jobId});
        for(;;){const view=await this.view(primary,projectId),job=row(view.jobs,prepared.result.jobId,'contract job');if(['failed','interrupted','awaiting_reconciliation','cancelled'].includes(job.status)){
          requireValue(job.status==='failed'&&job.nativeState?.error&&job.files.length,'NATIVE_CONTRACT_RESULT','Retain the actual original schema-contract failure before continuing.',409);
          return{plan,jobId:job.id,status:job.status,error:job.nativeState.error,snapshot:job.nativeSnapshotSha256};}
          requireValue(job.status!=='complete','NATIVE_CONTRACT_RESULT','The original frozen schema unexpectedly accepted a new field.',409);await new Promise(done=>setTimeout(done,1000));}
      });
      const aborted=await this.phase('08-original-package-abort',()=>this.stage(primary,projectId,'contract-abort',blocked.plan,blocked,'abort',{reason:'Explicitly abort the retained failed original package after reviewing its full native error and pre-abort custody.'}));
      const evolved=await this.phase('09-reviewed-schema-evolution',()=>this.plan(primary,projectId,'evolved',read(join(this.root,'reference/evolved-input.json')),inputs.change,inputs.right));
      const incremental=await this.phase('10-native-incremental',async()=>{const job=await this.stage(primary,projectId,'incremental',evolved,aborted,'run',{rows:1002});return{job,comparison:await this.compare(primary,projectId,'incremental-parity',job.jobId,1002)};});
      const replayed=await this.phase('11-native-boundary-replay',async()=>{const job=await this.stage(primary,projectId,'incremental-replay',evolved,incremental.job,'run',{rows:1002});return{job,comparison:await this.compare(primary,projectId,'replay-parity',job.jobId,1002)};});
      const backfill=await this.phase('12-native-bounded-backfill',async()=>{const plan=await this.plan(primary,projectId,'backfill',read(join(this.root,'reference/backfill-input.json')),inputs.change,inputs.right);const job=await this.stage(primary,projectId,'backfill',plan,replayed.job,'run',{rows:1002});return{plan,job,comparison:await this.compare(primary,projectId,'backfill-parity',job.jobId,1002)};});
      const nested=await this.phase('13-complete-original-nested-source',async()=>{
        const input=read(join(this.root,'reference/evolved-input.json'));input.title='Full original upstream nested normalization';input.resources=[{name:'events',sourceId:'DATA_SOURCE_ID',format:'json',columns:[],primaryKey:[],writeDisposition:'append',schemaContract:{tables:'evolve',columns:'evolve',data_type:'evolve'},maxTableNesting:10}];
        const plan=await this.plan(primary,projectId,'nested',input,inputs.events,inputs.right),job=await this.stage(primary,projectId,'nested',plan,backfill.job,'run',{rows:1002});
        const compared=await this.action(primary,projectId,'nested-compare','comparison.create',{jobId:job.jobId});requireValue(!compared.result.readyForCutover,'NORMALIZED_TABLE_COVERAGE','Unmapped original nested tables must hold consumer selection.',409);
        return{plan,job,comparisonId:compared.result.comparisonId,readyForCutover:false};
      });
      const verification=await this.phase('14-explicit-retained-pipeline-restore',async()=>{
        const plan=await this.plan(primary,projectId,'restored',read(join(this.root,'reference/evolved-input.json')),inputs.change,inputs.right);
        const job=await this.stage(primary,projectId,'verify-restored',plan,backfill.job,'verify',{rows:1002,forkReason:'Explicitly receive the earlier complete accepted pipeline/database snapshot. Preserve the subsequent full nested-source experiment and its unmapped-table hold as separate immutable history.'});
        return{plan,job,comparison:await this.compare(primary,projectId,'verified-parity',job.jobId,1002)};
      });
      const cutover=await this.phase('15-consumer-selection-rollback',async()=>{
        const applied=await this.action(primary,projectId,'cutover','cutover.apply',{comparisonId:verification.comparison.comparisonId,reason:'Select the fresh native verification of the complete accepted retained pipeline.'});
        const first=await this.consumer(primary,projectId,'candidate',1002,applied.result.selection);
        const rollback=await this.action(primary,projectId,'rollback','cutover.rollback',{cutoverId:applied.result.cutoverId,reason:'Restore the exact prior independent-source declaration while retaining every native database and pipeline state.'});
        const prior=await this.consumer(primary,projectId,'rollback',1002,rollback.result.selection);
        const again=await this.action(primary,projectId,'cutover-again','cutover.apply',{comparisonId:verification.comparison.comparisonId,reason:'Return to the same fully compared native destination.'});
        const final=await this.consumer(primary,projectId,'final',1002,again.result.selection);return{first,rollback:prior,final};
      });
      const h1=await this.phase('16-complete-handoff',()=>this.handoff(primary,projectId,'H1','Complete original dlt pipeline and load-state edition'));
      const args={sourceRoot:SOURCE,sourceManifestSha256:this.source.identity.sha256,operator:this.operator,viewer:this.viewer,projectId,
        sourceIds:[...Object.values(inputs).map(s=>s.sourceId),initial.source.sourceId,evolved.source.sourceId,verification.plan.source.sourceId],
        planIds:[initial.planId,evolved.planId,verification.plan.planId],jobIds:[loaded.job.jobId,incremental.job.jobId,verification.job.jobId],
        comparisonIds:[loaded.comparison.comparisonId,incremental.comparison.comparisonId,verification.comparison.comparisonId],handoffIds:[h1.handoffId],expectedRows:1002,
        playwright:this.options.playwright,chromium:this.options.chromium,resume:this.options.resume===true};
      const browserPrimary=await this.phase('17-primary-operator',async()=>this.bindBrowserResult(await runBrowserJourney({...args,directory:join(this.root,'browser','primary'),origin:primary.origin,phase:'primary'})));
      const h2=await this.phase('18-reviewed-handoff',()=>this.handoff(primary,projectId,'H2','Complete operator-reviewed dlt migration'));
      const runtimeReceiving=await this.phase('19-runtime-offline-receiving',()=>this.receiveRuntime(primary,projectId));
      verify(join(this.root,runtimeReceiving.receipt.path),runtimeReceiving.receipt);
      const receiving=await this.startHost('receiving');
      const fresh=await this.phase('19-fresh-receiving',async()=>{const placeholder=await this.create(receiving,'placeholder','Received dlt application','Original complete receiving.');
        const imported=await this.receive(receiving,placeholder,'receive-H2',h2,'imported'),audit=await this.audit(receiving,projectId,'fresh',Object.values(inputs)),consumer=await this.consumer(receiving,projectId,'fresh',1002,cutover.final.selection);
        return{result:imported.result,audit,consumer};});
      const browserReceiving=await this.phase('20-received-operator',async()=>this.bindBrowserResult(await runBrowserJourney({...args,directory:join(this.root,'browser','receiving'),origin:receiving.origin,phase:'receiving'})));
      const returned=await this.phase('21-returned-prefixes',async()=>{
        await this.action(receiving,projectId,'received-review','review.record',{subjectId:verification.comparison.comparisonId,decision:'received',notes:'Reviewed full original pipeline/load state, typed data and editable application on the fresh receiving installation.'});
        const h3=await this.handoff(receiving,projectId,'H3','Returned original dlt customer review');
        const forward=await this.receive(primary,projectId,'forward-H3',h3,'forward'),same=await this.receive(primary,projectId,'same-H3',h3,'same'),older=await this.receive(primary,projectId,'older-H1',h1,'older');
        requireValue([forward,same,older].every(r=>r.result.currentRevision===h3.revision),'PREFIX_HISTORY','Same and older receiving must preserve the returned current head.',409);
        return{h3,forward:forward.result,same:same.result,older:older.result,audit:await this.audit(primary,projectId,'returned',Object.values(inputs))};
      });
      await this.closeHost('receiving');await this.closeHost('primary');
      const reopened=await this.phase('22-original-cli-reopen',async()=>{
        const result={};for(const host of ['primary','receiving']){
          const directory=join(this.root,'workspaces',host),show=await this.cli(host+'-show','show',['--directory',directory,'--project',projectId,'--python',this.options.python??'python3']);
          requireValue(show.value.view.revision===returned.h3.revision,'CLI_REOPEN','CLI reopened another original revision.',409);
          const file=join(this.root,'cli',host+'-H1.ndjson');await this.cli(host+'-named','download',['--directory',directory,'--project',projectId,'--kind','handoff','--id',h1.handoffId,'--output',file]);verify(file,h1.archive);
          result[host]={revision:show.value.view.revision,named:{path:localFile(file,this.root),...hashFile(file)}};
        }return result;});
      const parity=[loaded.comparison,incremental.comparison,replayed.comparison,backfill.comparison,verification.comparison];
      const artifacts=[...sourceAdoptionArtifacts(this.root,this.state),reference.derivation,...originalReference.artifacts,runtimeReceiving.receipt,runtimeReceiving.observation,...runtimeReceiving.logs,...this.verifyBrowserResult(browserPrimary),...this.verifyBrowserResult(browserReceiving),...[h1,h2,returned.h3].map(h=>h.archive),...parity.flatMap(c=>[c.report,c.observations]),cutover.first,cutover.rollback,cutover.final,fresh.audit,fresh.consumer,returned.audit,...Object.values(reopened).map(x=>x.named)];
      for(const item of artifacts){verify(join(this.root,item.path),item);this.state.artifacts[item.path]={path:item.path,bytes:item.bytes,sha256:item.sha256};}
      this.state.completedAt??=now();attempt.status='complete';attempt.completedAt=this.state.completedAt;this.save();
      const candidate=join(this.root,'customer-result-candidate.json'),result=existsSync(candidate)?read(candidate):{schema:'dlthub.customer-result.v1',operationId:this.state.id,status:'complete',completedAt:this.state.completedAt,projectId,revision:returned.h3.revision,sourceManifest:this.source.identity,originalEngine:'dlt 1.31.0',baselineRows:1000,finalRows:1002,
        sourceAdoptions:this.state.sourceAdoptions??[],originalReference,stages:{extracted,normalized,loaded,blocked,aborted,incremental,replayed,backfill,nested,verification},consumer:cutover,browser:{primary:browserPrimary,receiving:browserReceiving},receiving:{runtime:runtimeReceiving,fresh:fresh.result,forward:returned.forward,same:returned.same,older:returned.older,reopened},namedPackages:[h1,h2,returned.h3],artifacts:Object.values(this.state.artifacts),commercial:'Reference engineering outcome; a proposal or customer agreement is separate.'};
      requireValue(result.operationId===this.state.id&&result.completedAt===this.state.completedAt,'FINAL_RESULT_CHANGED','Retain the exact original completion candidate.',409);
      for(const file of result.artifacts)verify(join(this.root,file.path),file);
      atomicJson(candidate,result,{immutable:true});atomicJson(join(this.root,'CUSTOMER_RESULT.json'),result,{immutable:true});
      this.state.resultIdentity=hashFile(join(this.root,'CUSTOMER_RESULT.json'));this.state.status='complete';this.save();return result;
    }catch(error){attempt.status='interrupted';attempt.completedAt=now();attempt.error={code:error.code??'RECEIVING_FAILED',message:error.message,details:error.details??{}};this.state.status='interrupted';this.save();throw error;}
    finally{await this.close();}
  }
}
export async function main(argv=process.argv.slice(2)){
  const options=flags(argv),source=verifySource(resolve(options.source),resolve(options['source-manifest'])),config=read(resolve(options.config));
  requireValue(Number(process.versions.node.split('.')[0])>=24,'NODE_RUNTIME','Select Node24+ for the original installed application.');
  requireValue(config.schema==='dlthub.reference-programme.v1','REFERENCE_INPUT','Select the complete original dlt reference programme input.');
  requireValue(existsSync(resolve(options.playwright))&&existsSync(resolve(options.chromium)),'BROWSER_RUNTIME','Select the actual existing browser runtime paths.');
  const ready=read(resolve(options['runtime-ready']));requireValue(ready.schema==='dlt-workshare.runtime-ready.v1'&&ready.state==='ready','RUNTIME_READY','Select the exact original ready receipt.');
  if(options['receiving-runtime-ready'])requireValue(read(resolve(options['receiving-runtime-ready'])).runtimeId===ready.runtimeId,'RUNTIME_RECEIVING','The received original runtime differs.');
  const directory=await privateDirectory(resolve(options.directory),{create:true}),lease=await acquireWorkspaceLease(join(directory,'receiving.lock'));
  try{return await new Programme(options,source,config,lease).run();}finally{await lease.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'RECEIVING_FAILED',message:error.message,details:error.details??{}})+'\n');process.exitCode=1;});
