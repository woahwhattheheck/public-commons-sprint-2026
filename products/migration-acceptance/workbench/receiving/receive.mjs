#!/usr/bin/env node
import { existsSync,readFileSync,mkdirSync,openSync,closeSync,readSync,writeSync,fsyncSync,renameSync,unlinkSync,readdirSync,lstatSync,realpathSync,createWriteStream } from 'node:fs';
import { join,resolve,dirname,basename,relative } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { createApplicationServer } from '../application/server.mjs';
import { acquireWorkspaceLease,privateDirectory } from '../vendor/dlt/vendor/sling/vendor/stellar-expert/store.mjs';
import { atomicBytes,atomicJson,identity,canonical,requireValue,sha,now,safeRelative,collectSourceFiles,fsyncDirectory } from '../vendor/dlt/vendor/sling/core/common.mjs';
import { hashFile } from '../vendor/dlt/vendor/sling/core/objects.mjs';
import { runBrowserJourney } from './browser.mjs';
import { runChinookProgramme } from './chinook.mjs';
import { retainReceivingSourceManifest,sourceAdoptionArtifacts } from './source-adoption.mjs';

const SOURCE=resolve(fileURLToPath(new URL('..',import.meta.url)));
const STREAM='["definian_fruitshop","purchases"]';
const portableSuffix=value=>value.portableSchema==='tjlabs.sling-portable.v2'?'.ndjson':'.ndjson.gz';
const portableMediaType=value=>value.portableSchema==='tjlabs.sling-portable.v2'?'application/x-ndjson':'application/gzip';
const EXPECTED_SOURCE='2360d229c77f7f64692acc31a4555f4cfcd50ed3';
const SCHEMA='definian.complete-receiving.v1';
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
function publishCustomerResult(root,state,proposed){
  const binding={sourceManifest:proposed.sourceManifest,sourceAdoptions:proposed.sourceAdoptions??[]};
  const bindingId=identity(binding),candidateName='customer-result-candidates/'+bindingId+'/candidate.json',candidatePath=join(root,candidateName);
  const names=['customer-result-candidate.json','CUSTOMER_RESULT.json'];
  const same=(a,b)=>canonical(a)===canonical(b);
  const semantic=value=>{const out=structuredClone(value);delete out.artifacts;delete out.resultPredecessors;return out;};
  const resultIdentity=value=>requireValue(value?.schema==='definian.customer-result.v1'&&value.operationId===state.id&&value.completedAt===state.completedAt,'FINAL_RESULT_CHANGED','Retain the original completion identity.',409);
  const artifactRows=value=>{
    requireValue(Array.isArray(value.artifacts),'FINAL_RESULT_CHANGED','Retain complete original result artifacts.',409);
    const rows=new Map();
    for(const item of value.artifacts){safeRelative(item.path);requireValue(!rows.has(item.path),'FINAL_RESULT_CHANGED','The completion repeats an artifact.',409);verify(join(root,item.path),item);rows.set(item.path,item);}
    return rows;
  };
  let result;
  if(existsSync(candidatePath)){
    result=read(candidatePath);resultIdentity(result);
    requireValue(same(semantic(result),semantic(proposed)),'FINAL_RESULT_CHANGED','The selected source completion differs from its saved candidate.',409);
    const rows=artifactRows(result);
    for(const item of proposed.artifacts)requireValue(same(rows.get(item.path),item),'FINAL_RESULT_CHANGED','The current complete artifact selection differs from its source-bound candidate.',409,{path:item.path});
  }else{
    result={...proposed,sourceAdoptions:binding.sourceAdoptions,resultPredecessors:[]};
    const artifacts=new Map(proposed.artifacts.map(item=>[item.path,item]));
    for(const name of names){
      const original=join(root,name);if(!existsSync(original))continue;
      const bytes=readFileSync(original),previous=JSON.parse(bytes);resultIdentity(previous);artifactRows(previous);
      const digest=sha(bytes),retained={path:'result-predecessors/'+digest+'.json',bytes:bytes.length,sha256:digest};
      atomicBytes(join(root,retained.path),bytes,{immutable:true});
      artifacts.set(retained.path,retained);result.resultPredecessors.push({role:name,...retained});
    }
    result.artifacts=[...artifacts.values()];artifactRows(result);
    atomicJson(candidatePath,result,{immutable:true});
  }
  requireValue(same({sourceManifest:result.sourceManifest,sourceAdoptions:result.sourceAdoptions??[]},binding),'FINAL_RESULT_CHANGED','The saved candidate belongs to another source edition.',409);
  requireValue(Array.isArray(result.resultPredecessors),'FINAL_RESULT_CHANGED','Retain the candidate predecessor identities.',409);
  const predecessors=new Map();
  for(const item of result.resultPredecessors){
    requireValue(names.includes(item.role)&&!predecessors.has(item.role)&&item.path==='result-predecessors/'+item.sha256+'.json','FINAL_RESULT_CHANGED','The original completion predecessor differs.',409);
    verify(join(root,item.path),item);predecessors.set(item.role,item);
  }
  const bytes=readFileSync(candidatePath),selected={bytes:bytes.length,sha256:sha(bytes)};
  for(const name of names){
    const path=join(root,name);if(!existsSync(path))continue;
    const actual=hashFile(path),previous=predecessors.get(name);
    requireValue(same(actual,selected)||(previous&&actual.bytes===previous.bytes&&actual.sha256===previous.sha256),'FINAL_RESULT_CHANGED','A completion file changed outside its retained source transition.',409,{path:name});
  }
  for(const item of artifactRows(result).values())state.artifacts[item.path]={path:item.path,bytes:item.bytes,sha256:item.sha256};
  for(const name of names)atomicBytes(join(root,name),bytes);
  state.resultCandidate={path:candidateName,...selected,sourceBinding:bindingId};
  return result;
}

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
  const required=["application/workspace.mjs","application/server.mjs","acceptance/index.mjs","pipeline/worker.py","reference/prepare.py","reference/programme.json","runtime/runtime.mjs","runtime/inspect.py","runtime/portable.py","cli.mjs","web/index.html","web/app.mjs","web/style.css","web/sha256.mjs","OPERATOR.md","WORKSHARE.md","receiving/receive.mjs","receiving/browser.mjs","receiving/chinook.mjs","receiving/chinook-source.py","CHINOOK.md","reference/CHINOOK_SOURCE_COHORT.json","reference/receive_reference.py","integration/chinook-native-input.mjs","integration/relational-acceptance.mjs","receiving/source-adoption.mjs","vendor/dlt/pipeline/workspace.mjs","vendor/dlt/pipeline/runtime.mjs","vendor/dlt/vendor/sling/core/archive.mjs","vendor/dlt/vendor/sling/core/store.mjs","vendor/dlt/vendor/sling/vendor/stellar-expert/store.mjs","vendor/dlt/upstream_contracts/upstream/dlt/_workspace/_templates/_single_file_templates/fruitshop_pipeline.py"];
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
    const selected={schema:SCHEMA,sourceManifest:source.identity,config:hashFile(resolve(options.config)),node:{executable:process.execPath,version:process.version},expectedRows:Object.values(config.tables).reduce((total,n)=>total+n,0),runtimeReady:hashFile(resolve(options['runtime-ready'])),receivingRuntimeReady:options['receiving-runtime-ready']?hashFile(resolve(options['receiving-runtime-ready'])):null};
    if(existsSync(this.statePath)){this.state=read(this.statePath);requireValue(canonical(this.state.selection)===canonical(selected),'RECEIVING_SELECTION_CHANGED','The original programme has another complete source/configuration.',409);requireValue(options.resume||this.state.status==='complete','RESUME_REQUIRED','Continue this original programme with --resume.',409);}
    else{this.state={schema:SCHEMA,id:'definian_receiving_'+randomUUID(),selection:selected,status:'prepared',createdAt:now(),phases:{},ports:{},projects:{},artifacts:{},attempts:[]};this.save();}
    retainReceivingSourceManifest(this.root,this.state,resolve(options['source-manifest']),source.identity);
    atomicBytes(join(this.root,'intake','reference-config.json'),readFileSync(resolve(options.config)),{immutable:true});
    this.authPath=join(this.root,'installation-auth.json');
    if(!existsSync(this.authPath))atomicJson(this.authPath,{schema:'tjlabs.sling-auth.v1',actors:[{id:'definian-reference-operator',name:'Reference acceptance operator',roles:['operator'],token:randomBytes(32).toString('hex')},{id:'definian-reference-viewer',name:'Receiving reviewer',roles:['viewer'],token:randomBytes(32).toString('hex')}]},{immutable:true});
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
    const host={name,directory,app};this.apps.set(name,host);
    try{
      const info=await app.listen({host:'127.0.0.1',port:this.state.ports[name]??0});
      if(this.state.ports[name]===undefined){this.state.ports[name]=info.port;this.save();}
      requireValue(info.port===this.state.ports[name],'ORIGIN_CHANGED','Preserve the original receiving browser origin.',409);
      Object.assign(host,info);return host;
    }catch(error){await this.closeHost(name);throw error;}
  }
  async closeHost(name){
    const host=this.apps.get(name);if(!host)return;
    for(;;){
      try{await host.app.close();this.apps.delete(name);return;}
      catch(error){
        // Keep this original server/workspace handle and programme lease until
        // its listener, retained store and workspace owner positively close.
        try{this.note({phase:'owner-close',host:name,state:'pending',code:error.code??'CLOSE_FAILED',message:error.message});}catch{}
        await new Promise(wait=>setTimeout(wait,5000));
      }
    }
  }
  async close(){
    if(this.closePromise)return this.closePromise;
    this.closePromise=(async()=>{for(const name of [...this.apps.keys()].reverse())await this.closeHost(name);})();
    try{await this.closePromise;this.closing=true;}finally{this.closePromise=null;}
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

  async reference(){
    const root=join(this.root,'reference');mkdirSync(root,{recursive:true,mode:0o700});
    const ready=read(resolve(this.options['runtime-ready'])),out=join(root,'DERIVATION.json');
    const validate=()=>{const value=read(out);requireValue(value.runtimeId===ready.runtimeId&&canonical(value.counts)===canonical(this.config.tables),'REFERENCE_SELECTION','The full original fruitshop derivation differs.',409);for(const [name,file]of Object.entries(value.files))verify(join(root,safeRelative(name)),file);return{directory:'reference',derivation:{path:'reference/DERIVATION.json',...hashFile(out)},files:value.files,counts:value.counts};};
    if(existsSync(out))return validate();
    const argv=[join(SOURCE,'runtime/runtime.mjs'),'run','--directory',dirname(resolve(this.options['runtime-ready'])),'--cwd',root,'--operation-lock',join(root,'lifetime.lock'),'--argv-json',JSON.stringify([ready.python.executable,'-P',join(SOURCE,'reference/prepare.py'),'--directory',root,'--source',SOURCE,'--runtime-ready',resolve(this.options['runtime-ready'])])];
    const attempt='reference-'+randomUUID(),stdout=join(root,attempt+'.stdout.json'),stderr=join(root,attempt+'.stderr.txt'),fds=[openSync(stdout,'wx',0o600),openSync(stderr,'wx',0o600)];
    let result;try{result=await new Promise((yes,no)=>{const child=spawn(process.execPath,argv,{cwd:SOURCE,stdio:['ignore',fds[0],fds[1]]});child.once('error',no);child.once('exit',(code,signal)=>yes({code,signal}));});for(const fd of fds)fsyncSync(fd);}finally{for(const fd of fds)closeSync(fd);}
    atomicJson(join(root,attempt+'.receipt.json'),{argv,node:process.execPath,...result,stdout:hashFile(stdout),stderr:hashFile(stderr)},{immutable:true});
    requireValue(result.code===0,'REFERENCE_REALIZATION','The unchanged original fruitshop resource invocation did not close; retain its exact receipt.',409,{attempt,result});
    return validate();
  }
  async plan(host,projectId,key,edition,inputs){
    const selected=read(join(this.root,'reference',edition+'-input.json'));
    for(const resource of selected.resources)resource.sourceId=inputs[edition+'-'+resource.tableName].sourceId;
    for(const table of selected.acceptance)table.expectedSourceId=inputs[edition+'-'+table.table+'-expected'].sourceId;
    const path=join(this.root,'reference',key+'-selected.json');atomicJson(path,selected,{immutable:true});
    const source=await this.localSource(host,projectId,key+'-input',path,{title:selected.title,role:'pipeline_config'});
    const compiled=await this.action(host,projectId,key+'-compile','plan.compile',{sourceId:source.sourceId,title:selected.title});
    requireValue(compiled.result.ready,'REFERENCE_PLAN','The complete original native declaration must be runnable.',409);
    await this.action(host,projectId,key+'-approve','plan.review',{planId:compiled.result.planId,decision:'approved',notes:'Reviewed all four original full resource populations, complete independent typed exports and explicit native replace strategy.'});
    return{planId:compiled.result.planId,source};
  }
  async stage(host,projectId,key,plan,parent,stage){
    const prepared=await this.action(host,projectId,key+'-prepare','run.prepare',{planId:plan.planId,parentJobId:parent?.jobId,stage,options:{},reason:'Continue this original complete native pipeline and retain every load package.'});
    return this.completeJob(host,projectId,key,prepared,{kind:'dlt_pipeline'});
  }
  async fullComparison(host,projectId,key,jobId){
    const response=await this.action(host,projectId,key,'comparison.create',{jobId}),view=await this.view(host,projectId),selected=row(view.comparisons,response.result.comparisonId,'comparison');
    requireValue(selected.equal&&selected.readyForCutover,'FULL_COMPARISON','All four complete native tables must have exact typed parity.',409);
    const report=await this.download(host,'/api/projects/'+projectId+'/outputs/comparison/'+selected.id,'delivery/'+key+'-comparison.json',selected.report);
    const observations=await this.download(host,'/api/projects/'+projectId+'/outputs/observations/'+selected.id,'delivery/'+key+'-observations.json',selected.observations);
    const value=read(join(this.root,observations.path));requireValue(value.streams.length===4&&value.pendingPackages===false&&value.failedJobs===false&&value.completeTables===true,'FULL_EXPORT','Retain exactly all four native business tables and closed package state.',409);
    for(const [table,count]of Object.entries(this.config.tables)){
      const stream=value.streams.find(x=>x.streamId===JSON.stringify(['definian_fruitshop',table]));requireValue(stream,'FULL_EXPORT','The complete original table is missing.',409);
      for(const side of ['left','right'])requireValue(stream[side].source.complete===true&&stream[side].source.rowCount===count&&stream[side].rows.length===count,'FULL_EXPORT','The complete original resource population differs.',409,{table,side,count});
    }
    return{comparisonId:selected.id,planId:selected.planId,jobId,report,observations,rows:this.config.tables};
  }
  async quality(host,projectId,key,plan,comparison,input){
    const compiled=await this.action(host,projectId,key+'-compile','acceptance.compile',{title:'Fruitshop '+key,sourceId:input.sourceId,planId:plan.planId});
    const measured=await this.action(host,projectId,key+'-measure','acceptance.evaluate',{acceptancePlanId:compiled.result.acceptancePlanId,comparisonId:comparison.comparisonId});
    const view=await this.view(host,projectId),report=row(view.acceptanceReports,measured.result.acceptanceReportId,'acceptance report');
    const file=await this.download(host,'/api/projects/'+projectId+'/sources/'+report.sourceId,'delivery/'+key+'-acceptance.json',report.report);
    return{acceptancePlanId:compiled.result.acceptancePlanId,reportId:report.id,semanticReportId:report.reportId,findings:report.findings,counts:report.counts,readyForCutover:report.readyForCutover,file};
  }
  async expectRejected(host,projectId,key,action,payload,codes){
    const file='delivery/'+key+'-rejection.json',path=join(this.root,file);
    if(existsSync(path)){const result=read(path);requireValue(codes.includes(result.code),'REJECTION_CHANGED','The retained original rejection differs.',409);return{path:file,...hashFile(path),code:result.code};}
    try{await this.action(host,projectId,key,action,payload);}catch(error){
      requireValue(codes.includes(error.code),'EXPECTED_REJECTION','The original action returned another failure.',409,{expected:codes,actual:error.code});
      atomicJson(path,{action,payload,code:error.code,message:error.message,status:error.status,observedAt:now()},{immutable:true});return{path:file,...hashFile(path),code:error.code};
    }
    throw Object.assign(new Error('The guarded action unexpectedly completed.'),{code:'REJECTION_NOT_OBSERVED'});
  }
  async browser(host,projectId,phase,{acceptanceReview}={}){
    const view=await this.view(host,projectId);
    return this.bindBrowserResult(await runBrowserJourney({directory:join(this.root,'browser',phase),origin:host.origin,operator:this.operator,viewer:this.viewer,projectId,sourceRoot:SOURCE,sourceManifestSha256:this.source.identity.sha256,playwright:resolve(this.options.playwright),chromium:resolve(this.options.chromium),phase,resume:this.options.resume===true,expectedRows:122,expectedRowsByStream:Object.fromEntries(Object.entries(this.config.tables).map(([name,count])=>[JSON.stringify(['definian_fruitshop',name]),count])),
      sourceIds:view.sources.map(x=>x.id),planIds:view.plans.map(x=>x.id),jobIds:view.jobs.map(x=>x.id),comparisonIds:view.comparisons.map(x=>x.id),handoffIds:view.handoffs.map(x=>x.id),
      acceptancePlanIds:view.acceptancePlans.map(x=>x.id),acceptanceReportIds:view.acceptanceReports.map(x=>x.id),acceptanceDecisionIds:view.acceptanceDecisions.map(x=>x.id),
      streamIds:Object.keys(this.config.tables).map(t=>JSON.stringify(['definian_fruitshop',t])),tableCounts:this.config.tables,acceptanceReview}));
  }
  async run(){
    if(this.state.status==='complete'){
      const path=join(this.root,'CUSTOMER_RESULT.json');verify(path,this.state.resultIdentity);const result=read(path);
      requireValue(canonical(result.sourceManifest)===canonical(this.source.identity)&&canonical(result.sourceAdoptions??[])===canonical(this.state.sourceAdoptions??[]),'FINAL_RESULT_SOURCE','The completed application source differs.',409);
      for(const artifact of result.artifacts)verify(join(this.root,artifact.path),artifact);return result;
    }
    const attempt={id:'attempt_'+randomUUID(),startedAt:now(),status:'running'};this.state.attempts.push(attempt);this.state.status='running';this.save();
    try{
      const reference=await this.phase('01-original-fruitshop-resources',()=>this.reference());
      const primary=await this.startHost('primary');
      const setup=await this.phase('02-complete-intake',async()=>{
        const projectId=await this.create(primary,'original-project','Definian — complete fruitshop migration acceptance','Original pinned dlt resource populations, whole native state, full acceptance and editable receiving.');
        this.state.projects.primary=projectId;this.save();const inputs={};
        for(const edition of ['original','orphan'])for(const table of Object.keys(this.config.tables)){
          inputs[edition+'-'+table]=await this.localSource(primary,projectId,edition+'-'+table,join(this.root,'reference',edition+'-'+table+'.csv'),{title:edition+' '+table,role:'data'});
          inputs[edition+'-'+table+'-expected']=await this.localSource(primary,projectId,edition+'-'+table+'-expected',join(this.root,'reference',edition+'-'+table+'.expected.json'),{title:'Independent expected '+edition+' '+table,role:'expected'});
        }
        for(const policy of ['required','reviewable'])inputs['quality-'+policy]=await this.localSource(primary,projectId,'quality-'+policy,join(this.root,'reference','acceptance-'+policy+'.json'),{title:'Acceptance rules '+policy,role:'acceptance_input'});
        inputs.derivation=await this.localSource(primary,projectId,'complete-derivation',join(this.root,'reference','DERIVATION.json'),{title:'Original full resource derivation',role:'source_derivation'});
        const original=join(SOURCE,'vendor/dlt/upstream_contracts/upstream/dlt/_workspace/_templates/_single_file_templates/fruitshop_pipeline.py');
        inputs.originalModule=await this.localSource(primary,projectId,'original-resource-module',original,{title:'Unchanged original executable fruitshop resources',role:'source',mediaType:'text/x-python'});
        await this.action(primary,projectId,'select-original-runtime','runtime.select',{});return{projectId,inputs};
      });
      const {projectId,inputs}=setup;
      const baseline=await this.phase('03-original-plan',()=>this.plan(primary,projectId,'original','original',inputs));
      const extracted=await this.phase('04-original-extract',()=>this.stage(primary,projectId,'extract',baseline,null,'extract'));
      const normalized=await this.phase('05-original-normalize',()=>this.stage(primary,projectId,'normalize',baseline,extracted,'normalize'));
      const loaded=await this.phase('06-original-load',()=>this.stage(primary,projectId,'load',baseline,normalized,'load'));
      const baselineReview=await this.phase('07-original-full-verification',async()=>{
        const job=await this.stage(primary,projectId,'original-verify',baseline,loaded,'verify'),comparison=await this.fullComparison(primary,projectId,'original-parity',job.jobId),quality=await this.quality(primary,projectId,'original-required',baseline,comparison,inputs['quality-required']);
        requireValue(quality.readyForCutover&&quality.findings.length===0,'ORIGINAL_ACCEPTANCE','The unchanged original fruitshop must satisfy complete required acceptance.',409);return{job,comparison,quality};
      });
      const orphan=await this.phase('08-explicit-orphan-native-edition',async()=>{
        const plan=await this.plan(primary,projectId,'orphan','orphan',inputs),job=await this.stage(primary,projectId,'orphan-run',plan,baselineReview.job,'run');return{plan,job};
      });
      const orphanReview=await this.phase('09-required-integrity-hold',async()=>{
        const job=await this.stage(primary,projectId,'orphan-verify',orphan.plan,orphan.job,'verify'),comparison=await this.fullComparison(primary,projectId,'orphan-parity',job.jobId),quality=await this.quality(primary,projectId,'orphan-required',orphan.plan,comparison,inputs['quality-required']);
        requireValue(!quality.readyForCutover&&quality.findings.some(x=>x.acceptance==='required'),'REQUIRED_HOLD','The explicitly retained orphan must remain a required finding despite complete row parity.',409);
        const finding=quality.findings.find(x=>x.acceptance==='required'),rejectDecision=await this.expectRejected(primary,projectId,'required-cannot-waive','acceptance.decide',{reportId:quality.reportId,decisions:[{findingId:finding.findingId,disposition:'accepted_exception',reason:'Receiving verifies that required findings cannot be cleared.'}]},['ACCEPTANCE_REQUIRED_HOLD']);
        const rejectCutover=await this.expectRejected(primary,projectId,'required-cutover-hold','cutover.apply',{comparisonId:comparison.comparisonId,acceptanceReportId:quality.reportId,reason:'Receiving verifies the required acceptance gate.'},['ACCEPTANCE_NOT_READY']);
        return{job,comparison,quality,rejectDecision,rejectCutover};
      });
      const reviewable=await this.phase('10-explicit-reviewable-policy',async()=>{
        const quality=await this.quality(primary,projectId,'orphan-reviewable',orphan.plan,orphanReview.comparison,inputs['quality-reviewable']);
        requireValue(quality.findings.length>0&&quality.findings.every(x=>x.acceptance==='reviewable'),'REVIEWABLE_SELECTION','Only the explicitly selected customer relation is reviewable.',409);
        const response=await this.action(primary,projectId,'acknowledge-orphan','acceptance.decide',{reportId:quality.reportId,decisions:quality.findings.map(x=>({findingId:x.findingId,disposition:'acknowledged',reason:'The full original orphan rows were reviewed; acknowledgement leaves them unresolved.'}))});
        requireValue(response.result.readyForCutover===false,'ACKNOWLEDGEMENT_HOLD','Acknowledgement must not clear a measured finding.',409);
        const rejection=await this.expectRejected(primary,projectId,'acknowledged-cutover-hold','cutover.apply',{comparisonId:orphanReview.comparison.comparisonId,acceptanceReportId:quality.reportId,acceptanceDecisionId:response.result.acceptanceDecisionId,reason:'Receiving verifies acknowledgement alone leaves the current switch blocked.'},['ACCEPTANCE_NOT_READY']);
        return{quality,decisionId:response.result.acceptanceDecisionId,rejection};
      });
      const h1=await this.phase('11-original-review-handoff',()=>this.handoff(primary,projectId,'H1','Complete original acceptance review and unresolved source edition'));
      const browserPrimary=await this.phase('12-primary-operator',()=>this.browser(primary,projectId,'primary',{acceptanceReview:{reportId:reviewable.quality.reportId,findingId:reviewable.quality.findings[0].findingId,disposition:'accepted_exception',reason:'Explicit receiving-only exception for the measured source orphan; final delivery reloads the corrected original population.'}}));
      const exception=await this.phase('13-complete-exception-review',async()=>{
        const response=await this.action(primary,projectId,'complete-reviewable-exceptions','acceptance.decide',{reportId:reviewable.quality.reportId,decisions:reviewable.quality.findings.map(x=>({findingId:x.findingId,disposition:'accepted_exception',reason:'Reviewed receiving-only exception, retained separately from unchanged measured facts; correct source before final production selection.'}))});
        requireValue(response.result.readyForCutover===true,'EXCEPTION_REVIEW','Every explicitly reviewable finding must have a complete separate decision.',409);
        const view=await this.view(primary,projectId),decision=row(view.acceptanceDecisions,response.result.acceptanceDecisionId,'decision');
        const file=await this.download(primary,'/api/projects/'+projectId+'/sources/'+decision.sourceId,'delivery/explicit-exceptions.json',decision.decision);
        return{decisionId:decision.id,file};
      });
      const corrected=await this.phase('14-corrected-original-native-edition',async()=>{
        const plan=await this.plan(primary,projectId,'corrected-original','original',inputs),job=await this.stage(primary,projectId,'corrected-run',plan,orphanReview.job,'run');return{plan,job};
      });
      const finalReview=await this.phase('15-final-full-native-acceptance',async()=>{
        const job=await this.stage(primary,projectId,'final-verify',corrected.plan,corrected.job,'verify'),comparison=await this.fullComparison(primary,projectId,'final-parity',job.jobId),quality=await this.quality(primary,projectId,'final-required',corrected.plan,comparison,inputs['quality-required']);
        requireValue(quality.readyForCutover&&quality.findings.length===0,'FINAL_ACCEPTANCE','The corrected original complete resource populations must pass all required integrity and control totals with no exceptions.',409);return{job,comparison,quality};
      });
      const cutover=await this.phase('16-accepted-cutover-rollback',async()=>{
        const payload={comparisonId:finalReview.comparison.comparisonId,acceptanceReportId:finalReview.quality.reportId,reason:'Select the complete current verified native database after exact required acceptance.'};
        const selected=await this.phase('16a-accepted-consumer',async()=>{
          const response=await this.action(primary,projectId,'final-cutover','cutover.apply',payload);
          return{selection:response.result,consumer:await this.consumer(primary,projectId,'selected',100,response.result.selection)};
        });
        const rolled=await this.phase('16b-original-consumer-rollback',async()=>{
          const response=await this.action(primary,projectId,'final-rollback','cutover.rollback',{cutoverId:selected.selection.cutoverId,reason:'Demonstrate reversible current retained consumer selection without deleting native state.'});
          return{selection:response.result,consumer:await this.consumer(primary,projectId,'rollback',100,response.result.selection)};
        });
        const current=await this.phase('16c-accepted-consumer-reselect',async()=>{
          const response=await this.action(primary,projectId,'final-reselect','cutover.apply',payload);
          return{selection:response.result,consumer:await this.consumer(primary,projectId,'final',100,response.result.selection)};
        });
        return{first:selected.selection,rollback:rolled.selection,final:current.selection,selected:selected.consumer,rolled:rolled.consumer,current:current.consumer};
      });
      const h2=await this.phase('17-complete-customer-handoff',()=>this.handoff(primary,projectId,'H2','Full corrected native migration, required acceptance and original complete review history'));
      const runtimeReceiving=await this.phase('19-runtime-offline-receiving',()=>this.receiveRuntime(primary,projectId));
      const receiving=await this.startHost('receiving');
      const fresh=await this.phase('20-fresh-complete-receiving',async()=>{
        const empty=await this.create(receiving,'receiving-project','Received complete Definian workspace','Original project/pipeline IDs and complete source preserved.'),answer=await this.receive(receiving,empty,'fresh-H2',h2,'imported');
        const view=await this.view(receiving,projectId);requireValue(view.currentAcceptanceReportId===finalReview.quality.reportId&&view.acceptanceReports.length>=4&&view.acceptanceDecisions.length>=3,'ACCEPTANCE_RECEIVING','All original rule, measured, acknowledgement and decision editions must survive.',409);
        return{result:answer.result,audit:await this.audit(receiving,projectId,'fresh',Object.values(inputs)),consumer:await this.consumer(receiving,projectId,'received',100,cutover.final.selection)};
      });
      const browserReceiving=await this.phase('20b-receiving-operator',()=>this.browser(receiving,projectId,'receiving'));
      const returned=await this.phase('21-forward-same-older-receiving',async()=>{
        await this.action(receiving,projectId,'received-edit','review.record',{subjectId:finalReview.quality.reportId,decision:'received',notes:'Complete native database, required acceptance, original exceptions and source history reopened on the independent installation.'});
        const h3=await this.handoff(receiving,projectId,'H3','Returned complete editable acceptance workspace'),forward=await this.receive(primary,projectId,'forward-H3',h3,'forward'),same=await this.receive(primary,projectId,'same-H3',h3,'same'),older=await this.receive(primary,projectId,'older-H1',h1,'older');
        requireValue([forward,same,older].every(r=>r.result.currentRevision===h3.revision),'PREFIX_HISTORY','Same and older packages cannot replace the returned current history.',409);
        return{h3,forward:forward.result,same:same.result,older:older.result,audit:await this.audit(primary,projectId,'returned',Object.values(inputs))};
      });
      await this.closeHost('receiving');await this.closeHost('primary');
      const reopened=await this.phase('22-cold-cli-reopen',async()=>{
        const result={};for(const host of ['primary','receiving']){
          const directory=join(this.root,'workspaces',host),show=await this.cli(host+'-show','show',['--directory',directory,'--project',projectId]);
          requireValue(show.value.view.revision===returned.h3.revision&&show.value.view.currentAcceptanceReportId===finalReview.quality.reportId,'CLI_REOPEN','Cold reopen changed the selected complete acceptance/history.',409);
          const path=join(this.root,'cli',host+'-original-H1.ndjson');await this.cli(host+'-original-handoff','download',['--directory',directory,'--project',projectId,'--kind','handoff','--id',h1.handoffId,'--output',path]);verify(path,h1.archive);
          result[host]={revision:show.value.view.revision,named:{path:localFile(path,this.root),...hashFile(path)}};
        }return result;
      });
      const chinook=await this.phase('23-complete-chinook-course',()=>runChinookProgramme({programme:this,sourceRoot:SOURCE,runtimeReadyFile:this.options['runtime-ready']}));
      const artifacts=[...chinook.artifacts,...sourceAdoptionArtifacts(this.root,this.state),reference.derivation,...Object.entries(reference.files).map(([name,file])=>({path:'reference/'+name,bytes:file.bytes,sha256:file.sha256})),
        runtimeReceiving.receipt,runtimeReceiving.observation,...runtimeReceiving.logs,...this.verifyBrowserResult(browserPrimary),...this.verifyBrowserResult(browserReceiving),
        ...[h1,h2,returned.h3].map(x=>x.archive),... [baselineReview,orphanReview,finalReview].flatMap(x=>[x.comparison.report,x.comparison.observations,x.quality.file]),reviewable.quality.file,orphanReview.rejectDecision,orphanReview.rejectCutover,reviewable.rejection,exception.file,cutover.selected,cutover.rolled,cutover.current,fresh.audit,fresh.consumer,returned.audit,...Object.values(reopened).map(x=>x.named)];
      for(const file of artifacts){verify(join(this.root,file.path),file);this.state.artifacts[file.path]={path:file.path,bytes:file.bytes,sha256:file.sha256};}
      this.state.completedAt??=now();attempt.status='complete';attempt.completedAt=this.state.completedAt;this.save();
      const proposed={schema:'definian.customer-result.v1',operationId:this.state.id,status:'complete',completedAt:this.state.completedAt,projectId,revision:returned.h3.revision,sourceManifest:this.source.identity,sourceAdoptions:this.state.sourceAdoptions??[],originalEngine:'dlt 1.31.0',originalResources:this.config.tables,chinook,
        native:{extracted,normalized,loaded,baselineReview,orphan,orphanReview,corrected,finalReview},acceptance:{reviewable,exception,final:finalReview.quality},consumer:cutover,browser:{primary:browserPrimary,receiving:browserReceiving},receiving:{runtime:runtimeReceiving,fresh:fresh.result,forward:returned.forward,same:returned.same,older:returned.older,reopened},namedPackages:[h1,h2,returned.h3],artifacts:Object.values(this.state.artifacts),commercial:'Reference implementation result; paid customer scope and production decisions remain separately agreed.'};
      const result=publishCustomerResult(this.root,this.state,proposed);this.state.resultIdentity=hashFile(join(this.root,'CUSTOMER_RESULT.json'));this.state.status='complete';this.save();return result;
    }catch(error){attempt.status='interrupted';attempt.completedAt=now();attempt.error={code:error.code??'RECEIVING_FAILED',message:error.message,details:error.details??{}};this.state.status='interrupted';this.save();throw error;}
    finally{await this.close();}
  }
}
export async function main(argv=process.argv.slice(2)){
  const options=flags(argv),source=verifySource(resolve(options.source),resolve(options['source-manifest'])),config=read(resolve(options.config));
  requireValue(Number(process.versions.node.split('.')[0])>=24,'NODE_RUNTIME','Use Node24+ for the installed original application.');
  requireValue(config.schema==='definian.reference-programme.v1','REFERENCE_INPUT','Select the complete Definian reference programme.');
  requireValue(existsSync(resolve(options.playwright))&&existsSync(resolve(options.chromium)),'BROWSER_RUNTIME','Select the actual existing browser runtime.');
  const ready=read(resolve(options['runtime-ready']));requireValue(ready.schema==='dlt-workshare.runtime-ready.v1'&&ready.state==='ready'&&ready.portable,'RUNTIME_READY','Select the complete original installed and portable runtime.');
  if(options['receiving-runtime-ready'])requireValue(read(resolve(options['receiving-runtime-ready'])).runtimeId===ready.runtimeId,'RUNTIME_RECEIVING','The received runtime differs.');
  const directory=await privateDirectory(resolve(options.directory),{create:true}),lease=await acquireWorkspaceLease(join(directory,'receiving.lock'));
  let programme;
  try{programme=new Programme(options,source,config,lease);return await programme.run();}
  finally{if(programme)await programme.close();if(!programme||programme.apps.size===0)await lease.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'RECEIVING_FAILED',message:error.message,details:error.details??{}})+'\n');process.exitCode=1;});
