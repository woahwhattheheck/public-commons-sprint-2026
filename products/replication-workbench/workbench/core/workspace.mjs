import { readFileSync,existsSync,mkdirSync,copyFileSync,readdirSync,chmodSync,openSync,closeSync,fsyncSync,renameSync,unlinkSync } from 'node:fs';
import { join,dirname,resolve } from 'node:path';
import { acquireWorkspaceLease,privateDirectory as originalPrivateDirectory } from '../vendor/stellar-expert/store.mjs';
import { Store } from './store.mjs';
import { Uploads } from './uploads.mjs';
import { NativeRuntime } from '../native/runtime.mjs';
import { Archives } from './archive.mjs';
import { requireOperator,permissions } from './auth.mjs';
import { compileMigration,reviewMigration,compareObservations,replicationDocument,inventoryDownstream,planDownstreamChanges,applyDownstreamChanges,restoreDownstreamChanges } from '../migration/index.mjs';
import { clone,canonical,identity,sha,now,id,uuid,text,object,array,oneOf,integer,requireValue,atomicJson,atomicBytes,safeFilename,safeRelative,collectSourceFiles,fsyncDirectory } from './common.mjs';
import { hashFile } from './objects.mjs';

const ACTIVE=new Set(['queued','running','cancelling']);
const ACTIONS=['source.retain','source.load','plan.compile','plan.review','runtime.select','run.prepare','job.start','job.resume','job.cancel','job.resolve','comparison.create','downstream.plan','downstream.apply','downstream.restore','downstream.resume','review.record','cutover.apply','cutover.rollback','handoff.prepare','handoff.receive','project.update'];
function field(rows,value,label){const row=rows.find(r=>r.id===value);requireValue(row,label+'_NOT_FOUND','The selected '+label.toLowerCase()+' is not retained.',404);return row;}
function relation(parts){array(parts,'native relation',{max:2});requireValue(parts.length===1||parts.length===2,'SQLITE_RELATION','This installed reference accepts one- or two-part SQLite relations.',409);return {namespace:parts.length===2?parts[0]:'main',name:parts.at(-1)};}
export class Workspace {
  static async open({directory,sourceRoot,runtimeReadyFile,python='python3',sourceFiles,consumerRoot}){
    const canonicalDirectory=await originalPrivateDirectory(resolve(directory),{create:true}),lease=await acquireWorkspaceLease(join(canonicalDirectory,'workspace.lock'));
    try{return new Workspace(canonicalDirectory,{sourceRoot:resolve(sourceRoot),runtimeReadyFile,python,sourceFiles,consumerRoot,lease});}catch(e){await lease.close();throw e;}
  }
  constructor(directory,options){
    this.directory=directory;this.sourceRoot=options.sourceRoot;this.lease=options.lease;this.store=new Store(directory,{lease:this.lease});
    this.sourceFiles=options.sourceFiles??collectSourceFiles(this.sourceRoot);this.uploads=new Uploads(this.store);this.receiving=new Set();this.queues=new Map();
    this.consumerRoot=options.consumerRoot?resolve(options.consumerRoot):null;this.downstreamRunning=new Map();
    this.runtime=new NativeRuntime(this,options);this.archives=new Archives(this);
  }
  async serial(projectId,fn){
    const previous=this.queues.get(projectId)??Promise.resolve(),current=previous.catch(()=>{}).then(fn);this.queues.set(projectId,current);
    try{return await current;}finally{if(this.queues.get(projectId)===current)this.queues.delete(projectId);}
  }
  list(actor){requireValue(permissions(actor).read,'READ_REQUIRED','This actor cannot read the migration workspace.',403);return {instanceId:this.store.instanceId,runtime:this.runtime.publicSelection(),projects:this.store.list().map(p=>({id:p.id,title:p.title,revision:p.revision,updatedAt:p.updatedAt,currentPlanId:p.currentPlanId,jobs:p.jobs.map(j=>({id:j.id,status:j.status,phase:j.phase}))}))};}
  result(result){
    const downstreamCustody=Object.fromEntries(this.store.downstreamBindings(result.view.id).map(b=>[b.operationId,{suspended:b.suspended,kind:b.kind}]));
    const currentRevision=this.store.head(result.view.id),handoffCustody=Object.fromEntries(this.store.handoffs(result.view.id,result.view.revision).map(h=>[h.id,h]));
    return{...result,currentRevision,view:{...result.view,instanceId:this.store.instanceId,historical:result.view.revision!==currentRevision,handoffCustody,downstreamCustody,availableRuntime:this.runtime.publicSelection(),consumer:this.consumerView(this.store.get(result.view.id))}};
  }
  create(actor,input){requireOperator(actor);text(input.title,'title',{min:1,max:300});text(input.notes??'','notes',{max:20000});return this.result(this.store.create(actor,input));}
  noActive(state){requireValue(!state.jobs.some(j=>ACTIVE.has(j.status))&&!(state.downstreamOperations??[]).some(j=>ACTIVE.has(j.status)),'NATIVE_JOB_ACTIVE','Reconcile and close the original native job before receiving or switching the consumer.',423);}
  async assertIdle(projectId){
    if(this.store.exists(projectId))this.noActive(this.store.get(projectId));
    requireValue(!await this.runtime.owned(projectId),'NATIVE_OWNER_ACTIVE','The original native lifetime is still owned on this host.',423);
  }
  recordNative(job,observed){
    return this.store.transaction(()=>{
      if(this.receiving.has(job.projectId)||this.store.binding(job.id)?.id!==observed.bindingId)return null;
      const current=this.store.get(job.projectId),actual=field(current.jobs,job.id,'JOB');
      if(observed.received||!observed.state)return null;
      const status=observed.busy?'running':observed.state.status==='running'?'interrupted':observed.state.status;
      const key='native:'+job.id+':'+identity({binding:observed.bindingId,status,state:observed.state,files:observed.files??null});
      return this.store.internal(job.projectId,key,'native.observe',state=>{
        const selected=field(state.jobs,job.id,'JOB');selected.status=status;selected.nativeState=clone(observed.state);selected.updatedAt=now();
        if(observed.files){selected.files=observed.files;selected.nativeSnapshotSha256=observed.nativeSnapshotSha256;}
        return{jobId:job.id,status,nativeSnapshotSha256:observed.nativeSnapshotSha256??null};
      });
    });
  }
  async reconcile(projectId){
    if(this.receiving.has(projectId))return;
    let state=this.store.get(projectId);
    for(let job of state.jobs){
      if(this.receiving.has(projectId))return;
      const binding=this.store.binding(job.id);
      if(binding?.suspended)continue;
      if((job.status==='queued'||job.status==='cancelling')&&this.runtime.ready){
        try{await this.runtime.launch(job,{resume:job.resumeRequested===true});}
        catch(error){if(!['RUNTIME_REQUIRED','RESUME_REQUIRED','RECEIVING_BUSY','NATIVE_INSPECTION_FAILED'].includes(error.code))throw error;}
      }
      if(this.receiving.has(projectId))return;
      job=field(this.store.get(projectId).jobs,job.id,'JOB');
      const local=this.store.binding(job.id);if(!local||local.suspended)continue;
      this.runtime.writeControls(job,local);
      const observed=await this.runtime.inspect(job);
      if(this.receiving.has(projectId))return;
      this.recordNative(job,observed);
    }
    for(const operation of this.store.get(projectId).downstreamOperations??[]){
      if(this.receiving.has(projectId))return;
      if(operation.status==='queued'&&!this.store.downstreamBinding(operation.id)?.suspended)await this.executeDownstream(projectId,operation.id);
    }
    this.materializeConsumer(this.store.get(projectId));
    await this.archives.sealPending(projectId);
  }
  async get(actor,projectId,revision){
    requireValue(permissions(actor).read,'READ_REQUIRED','This actor cannot read this workspace.',403);
    return this.serial(projectId,async()=>{if(revision===undefined)await this.reconcile(projectId);const head=this.store.head(projectId),view=this.store.get(projectId,revision);return this.result({view,result:null,replayed:false,currentRevision:head});});
  }
  planObject(state,planId){const selected=field(state.plans,planId,'PLAN');return {selected,plan:JSON.parse(this.store.objects.read(selected.compiled.sha256,selected.compiled.bytes))};}
  sourceDescriptor(actor,projectId,sourceId,revision){
    requireValue(permissions(actor).read,'READ_REQUIRED','Read permission is required.',403);return field(this.store.get(projectId,revision).sources,sourceId,'SOURCE');
  }
  downstreamSelection(state,changePlanId){
    const selected=field(state.downstreamPlans??[],changePlanId,'DOWNSTREAM_PLAN');
    const plan=JSON.parse(this.store.objects.read(selected.plan.sha256,selected.plan.bytes));
    const original=JSON.parse(this.store.objects.read(selected.originalFiles.sha256,selected.originalFiles.bytes));
    return{selected,plan,original};
  }
  downstreamSeed(state,selected,original){
    const previous=(state.downstreamOperations??[]).filter(r=>r.status==='complete'&&r.sourceId===selected.sourceId).at(-1);
    const initialFiles=previous?clone(previous.files):Object.entries(original).map(([path,content])=>({path:safeRelative(path),...this.store.objects.put(Buffer.from(content))}));
    return{kind:this.consumerRoot?'configured-consumer':'workspace-copy',generation:identity({sourceId:selected.sourceId,files:initialFiles}),parentOperationId:previous?.id??null,initialFiles,missingPaths:clone(previous?.missingPaths??[])};
  }
  bindDownstream(state,operation,{received=false}={}){
    const current=this.store.downstreamBinding(operation.id);if(current&&!current.suspended)return current;
    const seed=operation.consumerBinding;requireValue(seed?.generation&&Array.isArray(seed.initialFiles),'DOWNSTREAM_BINDING','The original operation must retain its initial consumer generation.',409);
    const bindingId='consumer_'+identity({instanceId:this.store.instanceId,projectId:state.id,sourceId:operation.sourceId,generation:seed.generation,received:received?identity({files:operation.files,missingPaths:operation.missingPaths??[]}):null}).slice(0,32);
    const external=!received&&this.consumerRoot;
    const binding={id:bindingId,projectId:state.id,operationId:operation.id,generation:seed.generation,kind:external?'configured-consumer':'workspace-copy',directory:external?this.consumerRoot:join(this.directory,'downstream',state.id,operation.sourceId,seed.generation,bindingId),restored:false,suspended:false,createdAt:now()};
    this.store.setDownstreamBinding(state.id,operation.id,binding);return binding;
  }
  downstreamDirectory(state,operation){
    const binding=this.store.downstreamBinding(operation.id)??this.bindDownstream(state,operation);
    requireValue(!binding.suspended,'DOWNSTREAM_RECEIVED_CLOSED','Continue this received original operation explicitly before opening its working files.',409);
    requireValue(binding.generation===operation.consumerBinding.generation,'DOWNSTREAM_BINDING_CHANGED','The retained operation selected another consumer generation.',409);
    if(binding.kind==='configured-consumer'&&this.consumerRoot)requireValue(resolve(binding.directory)===this.consumerRoot,'DOWNSTREAM_ROOT_CHANGED','This original operation belongs to its previously selected consumer root.',409);
    if(binding.restored)return binding.directory;
    if(binding.kind==='configured-consumer'){
      requireValue(existsSync(binding.directory),'CONSUMER_ROOT_MISSING','The configured original consumer directory is unavailable.',409);
    }else{
      mkdirSync(binding.directory,{recursive:true,mode:0o700});
      const seed=operation.files?.length?operation.files:operation.consumerBinding.initialFiles,missing=new Set(operation.missingPaths??operation.consumerBinding.missingPaths??[]);
      for(const file of seed){if(missing.has(file.path))continue;const path=join(binding.directory,safeRelative(file.path));atomicBytes(path,this.store.objects.read(file.sha256,file.bytes),{immutable:true});}
    }
    binding.restored=true;this.store.setDownstreamBinding(state.id,operation.id,binding);return binding.directory;
  }
  captureDownstream(root,original,plan,direction){
    const paths=new Set(Object.keys(original).map(safeRelative)),journalRoot=join(root,'.sling-migration');
    const journals=(directory,prefix)=>{if(!existsSync(directory))return;for(const entry of readdirSync(directory,{withFileTypes:true})){
      if(entry.name==='consumer.lock'||entry.name.includes('.pending-'))continue;
      const path=prefix+'/'+entry.name;requireValue(!entry.isSymbolicLink(),'CONSUMER_SYMLINK','Retain original consumer files without symbolic links.',409);
      if(entry.isDirectory())journals(join(directory,entry.name),path);else if(entry.isFile())paths.add(path);
    }};journals(journalRoot,'.sling-migration');
    const files=[],missingPaths=[],errors=[];
    for(const path of [...paths].sort()){
      try{files.push({path,...this.store.objects.putFile(join(root,path))});}
      catch(error){if(error.code==='ENOENT')missingPaths.push(path);else errors.push({path,code:error.code??'CONSUMER_CAPTURE_FAILED',message:error.message});}
    }
    const selectedEdition=direction==='restore'?'before':'after';
    const selected=plan.changes.map(change=>{const file=files.find(file=>file.path===change.path);return{path:change.path,expectedSha256:change[selectedEdition].sha256,actualSha256:file?.sha256??null,bytes:file?.bytes??null,state:file?.sha256===change[selectedEdition].sha256?'selected':file?'changed':'unavailable'};});
    return{files,missingPaths,current:{observedAt:now(),selectedEdition,matchesSelected:errors.length===0&&selected.every(file=>file.state==='selected'),files:selected,errors}};
  }
  async executeDownstream(projectId,operationId){
    const key=projectId+':'+operationId;if(this.downstreamRunning.has(key))return this.downstreamRunning.get(key);
    const task=(async()=>{
      requireValue(!this.receiving.has(projectId),'RECEIVING_BUSY','The original project is receiving another edition.',423);
      const state=this.store.get(projectId),operation=field(state.downstreamOperations??[],operationId,'DOWNSTREAM_OPERATION');
      if(operation.status==='complete')return operation;
      const {selected,plan,original}=this.downstreamSelection(state,operation.changePlanId);let root=null;
      try{
        root=this.downstreamDirectory(state,operation);
        const actual=operation.direction==='restore'?await restoreDownstreamChanges(root,plan,{operationId:operation.id}):await applyDownstreamChanges(root,plan,{operationId:operation.id});
        requireValue(!this.receiving.has(projectId),'RECEIVING_BUSY','The original project began receiving before this observation.',423);
        const captured=this.captureDownstream(root,original,plan,operation.direction);
        const result={...actual,journalPath:'.sling-migration/'+plan.changePlanId+'/'+actual.journalPath.split('/').at(-1),capturedCurrent:captured.current};
        const status=actual.current?.matchesSelected===true&&captured.current.matchesSelected?'complete':'drifted';
        this.store.internal(projectId,'downstream-complete:'+operation.id+':'+identity({attempt:operation.activeRequestId,result,files:captured.files}),'downstream.observe',state=>{
          const row=field(state.downstreamOperations,operation.id,'DOWNSTREAM_OPERATION');row.status=status;row.nativeResult=result;row.files=captured.files;row.missingPaths=captured.missingPaths;row.currentObservation=captured.current;row.completedAt=actual.completedAt;delete row.error;return{operationId:row.id,status,direction:row.direction};
        });
      }catch(error){
        const detail={code:error.code??'DOWNSTREAM_FAILED',message:error.message,details:error.details??{}};
        let captured;try{requireValue(root,'CONSUMER_UNPREPARED','The original consumer generation was not fully materialized.',409);captured=this.captureDownstream(root,original,plan,operation.direction);}catch(captureError){captured={files:[],missingPaths:[],current:{observedAt:now(),matchesSelected:false,files:[],errors:[{code:captureError.code??'CONSUMER_CAPTURE_FAILED',message:captureError.message}]}};}
        this.store.internal(projectId,'downstream-failed:'+operation.id+':'+identity({attempt:operation.activeRequestId,detail,files:captured.files}),'downstream.observe',state=>{
          const row=field(state.downstreamOperations,operation.id,'DOWNSTREAM_OPERATION');row.status='failed';row.error=detail;row.files=captured.files;row.missingPaths=captured.missingPaths;row.currentObservation=captured.current;return{operationId:row.id,status:'failed',error:detail};
        });
      }
      return field(this.store.get(projectId).downstreamOperations,operation.id,'DOWNSTREAM_OPERATION');
    })();this.downstreamRunning.set(key,task);
    try{return await task;}finally{if(this.downstreamRunning.get(key)===task)this.downstreamRunning.delete(key);}
  }
  readSource(actor,projectId,sourceId,revision){
    requireValue(permissions(actor).read,'READ_REQUIRED','Read permission is required.',403);const s=field(this.store.get(projectId,revision).sources,sourceId,'SOURCE');return{...s,body:this.store.objects.read(s.sha256,s.bytes)};
  }
  async readObject(actor,projectId,kind,itemId,revision){
    requireValue(permissions(actor).read,'READ_REQUIRED','Read permission is required.',403);const state=this.store.get(projectId,revision);let descriptor,filename,mediaType='application/json';
    if(kind==='plan'){const p=field(state.plans,itemId,'PLAN');descriptor=p.compiled;filename=p.id+'.json';}
    else if(kind==='replication'){const p=field(state.plans,itemId,'PLAN');descriptor=p.replication;requireValue(descriptor,'PLAN_ADAPTATION_REQUIRED','The selected plan needs its retained adaptations before it has a runnable replication.',409);filename=p.id+'-replication.json';}
    else if(kind==='comparison'){const c=field(state.comparisons,itemId,'COMPARISON');descriptor=c.report;filename=c.id+'.json';}
    else if(kind==='observations'){const c=field(state.comparisons,itemId,'COMPARISON');descriptor=c.observations;filename=c.id+'-observations.json';}
    else if(kind==='downstream'){const d=field(state.downstreamPlans??[],itemId,'DOWNSTREAM_PLAN');descriptor=d.plan;filename=d.id+'.json';}
    else if(kind==='handoff'){
      const h=this.store.handoff(itemId);requireValue(h&&h.projectId===projectId&&h.revision<=state.revision,'HANDOFF_NOT_SEALED','The selected named handoff is not yet sealed in this project revision.',409);
      await this.archives.ensureFile(h);descriptor=h;filename=h.filename;mediaType=h.portableSchema==='tjlabs.sling-portable.v2'?'application/x-ndjson':'application/gzip';
    }
    else requireValue(false,'DOWNLOAD_KIND','Unknown retained output kind.',404);
    return {descriptor,filename,mediaType,path:this.store.objects.path(descriptor.sha256)};
  }
  readDownstream(actor,projectId,operationId,path,revision){
    requireValue(permissions(actor).read,'READ_REQUIRED','Read permission is required.',403);
    const operation=field(this.store.get(projectId,revision).downstreamOperations??[],operationId,'DOWNSTREAM_OPERATION'),file=(operation.files??[]).find(f=>f.path===path);
    requireValue(file,'DOWNSTREAM_FILE_NOT_FOUND','The original downstream file is not retained in this revision.',404);return{descriptor:file,path:this.store.objects.path(file.sha256),filename:file.path.split('/').at(-1),mediaType:file.path.endsWith('.json')?'application/json':'application/octet-stream'};
  }
  readNative(actor,projectId,jobId,path,revision){
    requireValue(permissions(actor).read,'READ_REQUIRED','Read permission is required.',403);const job=field(this.store.get(projectId,revision).jobs,jobId,'JOB'),file=job.files.find(f=>f.path===path);
    requireValue(file,'NATIVE_FILE_NOT_FOUND','That original native file is not retained in the selected revision.',404);return {descriptor:file,path:this.store.objects.path(file.sha256),filename:file.path.split('/').at(-1),mediaType:file.path.endsWith('.json')?'application/json':'application/octet-stream'};
  }
  consumerSelection(state){
    const selected=state.cutovers.find(c=>c.id===state.currentCutoverId);return selected?.selection??null;
  }
  consumerView(state){
    const selected=this.consumerSelection(state);if(!selected)return{state:'unbound',selection:null};
    const path=join(this.directory,'consumer',state.id,'current.json');let actual=null;
    try{actual=JSON.parse(readFileSync(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    return {state:actual&&identity(actual)===identity(selected)?'selected':'receiving',selection:selected};
  }
  materializeConsumer(state){
    const selected=this.consumerSelection(state);if(!selected)return;
    const root=join(this.directory,'consumer',state.id);mkdirSync(root,{recursive:true,mode:0o700});
    const target=join(root,selected.snapshot.sha256+'.sqlite');this.store.objects.verify(selected.snapshot.sha256,selected.snapshot.bytes);
    if(existsSync(target)){const v=hashFile(target);requireValue(v.sha256===selected.snapshot.sha256&&v.bytes===selected.snapshot.bytes,'CONSUMER_SNAPSHOT_CHANGED','The selected downstream database changed.',409);}
    else{
      const temp=target+'.pending-'+uuid('copy');
      try{
        copyFileSync(this.store.objects.path(selected.snapshot.sha256),temp);
        const v=hashFile(temp);requireValue(v.sha256===selected.snapshot.sha256&&v.bytes===selected.snapshot.bytes,'CONSUMER_COPY','The downstream database copy differs.',409);
        const fd=openSync(temp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}chmodSync(temp,0o400);renameSync(temp,target);fsyncDirectory(root);
      }finally{try{unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
    }
    const fd=openSync(target,'r');try{fsyncSync(fd);}finally{closeSync(fd);}fsyncDirectory(root);
    atomicJson(join(root,'current.json'),selected);
  }
  async dispatch(actor,input){
    requireOperator(actor);object(input,'request');id(input.projectId,'projectId');id(input.requestId,'requestId');oneOf(input.action,ACTIONS,'action');object(input.payload??{},'payload');input={...input,payload:input.payload??{}};
    const previous=this.store.request(actor.id,input.requestId,input);
    if(previous){await this.serial(previous.view.id,()=>this.reconcile(previous.view.id));return this.result(previous);}
    if(input.action==='handoff.receive')return this.result(await this.archives.receive(actor,input));
    return this.serial(input.projectId,async()=>{
      await this.reconcile(input.projectId);
      const replay=this.store.request(actor.id,input.requestId,input);if(replay)return this.result(replay);
      const p=input.payload,current=this.store.get(input.projectId);requireValue(input.expectedRevision===current.revision,'REVISION_CONFLICT','The project changed before this reviewed action.',409,{currentRevision:current.revision});
      let output;
      if(input.action==='handoff.prepare'){await this.assertIdle(current.id);output=await this.archives.prepare(actor,input);return this.result(output);}
      if(input.action==='project.update'){
        text(p.title,'title',{min:1,max:300});text(p.notes??'','notes',{max:20000});output=this.store.commit(actor,input,s=>{s.title=p.title;s.notes=p.notes??'';return{projectId:s.id};});
      }else if(input.action==='source.retain'){
        const upload=this.uploads.completed(actor,p.uploadId);text(p.title,'title',{min:1,max:300});text(p.role,'role',{min:1,max:80});text(p.url??'','source URL',{max:4000});text(p.notes??'','notes',{max:20000});
        output=this.store.commit(actor,input,s=>{const source={id:'source_'+identity({sha256:upload.sha256,role:p.role,url:p.url??''}).slice(0,32),sha256:upload.sha256,bytes:upload.bytes,filename:upload.filename,mediaType:upload.mediaType,title:p.title,role:p.role,url:p.url??'',notes:p.notes??'',capturedAt:p.capturedAt??upload.completedAt,retainedAt:now()};
          const existing=s.sources.find(r=>r.id===source.id);if(!existing)s.sources.push(source);return{sourceId:source.id};});
      }else if(input.action==='source.load'){
        this.noActive(current);requireValue(!await this.runtime.owned(current.id),'NATIVE_OWNER_ACTIVE','The original project still has a native writer.',423);
        const source=field(current.sources,p.sourceId,'SOURCE');oneOf(p.mode,['full-refresh','incremental'],'mode');text(p.table,'table',{min:1,max:200});array(p.primaryKey??[],'primaryKey',{max:20});for(const key of p.primaryKey??[])text(key,'primary key',{min:1,max:200});
        requireValue(p.mode!=='incremental'||(typeof p.updateKey==='string'&&p.updateKey.length&&p.primaryKey?.length),'SOURCE_INCREMENTAL_KEYS','The original incremental source import needs its reviewed update key and complete primary key.',409);
        let target=null;if(p.previousJobId){const previous=field(current.jobs,p.previousJobId,'JOB');requireValue(previous.status==='complete','PREVIOUS_SOURCE_OPEN','Close the prior original source import.',409);target=previous.files.find(r=>r.path==='artifacts/target.sqlite');requireValue(target,'SOURCE_SNAPSHOT_MISSING','The original prior source snapshot is missing.',409);}
        const runtime=this.runtime.retainSelection(),jobId='job_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32),quoted='"main"."'+p.table.replaceAll('"','""')+'"';
        const config={source:'LOCAL',target:'SOURCE_IMPORT_DB',streams:{'file://inputs/source.csv':{object:quoted,mode:p.mode,source_options:{format:'csv',header:true},target_options:{add_new_columns:true},...(p.primaryKey?.length?{primary_key:p.primaryKey}:{}),...(p.updateKey?{update_key:p.updateKey}:{})}}};
        const replication=this.store.objects.put(Buffer.from(canonical(config)+'\n')),inputs=[{path:'inputs/source.csv',sha256:source.sha256,bytes:source.bytes},...(target?[{path:'inputs/target.sqlite',sha256:target.sha256,bytes:target.bytes}]:[])];
        const selection={schema:'tjlabs.sling-native-selection.v1',kind:'source_import',projectId:current.id,jobId,planId:null,sourceId:source.id,phase:p.mode==='full-refresh'?'baseline':'incremental',runtime:{version:runtime.version,sourceCommit:runtime.sourceCommit,executable:runtime.executable,archive:runtime.archive},inputs,connections:{source:'LOCAL',target:'SOURCE_IMPORT_DB'},tables:[{streamId:JSON.stringify(['main',p.table]),target:{namespace:'main',name:p.table}}],replicationSha256:replication.sha256};
        const selected=this.store.objects.put(Buffer.from(canonical(selection)+'\n'));
        output=this.store.commit(actor,input,s=>{s.runtime=runtime;s.jobs.push({id:jobId,projectId:s.id,kind:'source_import',phase:selection.phase,sourceId:source.id,previousJobId:p.previousJobId??null,runtime,selection:selected,replication,status:'prepared',controls:[],files:[],createdAt:now()});return{jobId,status:'prepared'};});
      }else if(input.action==='plan.compile'){
        const source=field(current.sources,p.sourceId,'SOURCE');object(p.options??{},'options');text(p.title,'title',{min:1,max:300});
        const body=this.store.objects.read(source.sha256,source.bytes);requireValue(body.length<=32*1024*1024,'PLAN_SOURCE_SIZE','The structured source document exceeds the selected plan limit.',413);
        const document=JSON.parse(body),plan=compileMigration(document,p.options??{}),review=reviewMigration(plan);
        requireValue(plan.schema==='slingdata.migration-plan.v1'&&plan.planId,'PLAN_CONTRACT','The maintained semantic engine returned another plan contract.',500);
        const compiled=this.store.objects.put(Buffer.from(canonical(plan))),replication=plan.ready?this.store.objects.put(Buffer.from(replicationDocument(plan))):null;
        output=this.store.commit(actor,input,s=>{const edition={id:'plan_'+identity({sourceId:source.id,planId:plan.planId,title:p.title,requestId:input.requestId}).slice(0,32),semanticPlanId:plan.planId,title:p.title,sourceId:source.id,sourceSha256:source.sha256,options:clone(p.options??{}),compiled,replication,ready:plan.ready,issues:plan.issues,review:clone(review),status:'draft',createdAt:now(),selectedStreams:plan.selectedStreams.map(r=>({id:r.id,name:r.name,namespace:r.namespace,sourceRelation:r.sourceRelation,parallelRelation:r.parallelRelation,mode:r.mode,updateKey:r.updateKey,primaryKey:r.primaryKey,businessColumns:r.businessColumns,ready:r.ready}))};
          s.plans.push(edition);s.currentPlanId=edition.id;return{planId:edition.id,semanticPlanId:plan.planId,ready:plan.ready};});
      }else if(input.action==='plan.review'){
        const {selected,plan}=this.planObject(current,p.planId);oneOf(p.decision,['approved','changes_required'],'decision');text(p.notes,'notes',{min:1,max:20000});
        requireValue(p.decision!=='approved'||plan.ready,'PLAN_ADAPTATION_REQUIRED','Resolve the original semantic adaptation requirements before approving a native plan.',409,{issues:plan.issues});
        output=this.store.commit(actor,input,s=>{const row=field(s.plans,selected.id,'PLAN');row.status=p.decision;row.operatorReview={actorId:actor.id,notes:p.notes,at:now(),semanticPlanId:plan.planId,sourceSha256:row.sourceSha256};s.currentPlanId=row.id;return{planId:row.id,status:row.status};});
      }else if(input.action==='runtime.select'){
        const selected=this.runtime.retainSelection();output=this.store.commit(actor,input,s=>{s.runtime=selected;return{runtimeSha256:selected.executable.sha256,archiveSha256:selected.archive.sha256};});
      }else if(input.action==='run.prepare'){
        this.noActive(current);requireValue(!await this.runtime.owned(current.id),'NATIVE_OWNER_ACTIVE','The original project still has a live native writer.',423);
        const {selected,plan}=this.planObject(current,p.planId);requireValue(selected.status==='approved'&&plan.ready,'PLAN_REVIEW_REQUIRED','Approve the exact complete semantic plan before native replication.',409);
        requireValue(plan.bindings.sourceDialect==='sqlite'&&plan.bindings.targetDialect==='sqlite','REFERENCE_BINDING_REQUIRED','This installed native snapshot receiver requires explicit SQLite source/target bindings. Preserve other native connector plans for their agreed host adapter.',409);
        let source;
        if(p.sourceJobId){const original=field(current.jobs,p.sourceJobId,'JOB');requireValue(original.status==='complete','SOURCE_IMPORT_OPEN','Close the original native source import before selecting its snapshot.',409);const file=original.files.find(r=>r.path==='artifacts/target.sqlite');requireValue(file,'SOURCE_SNAPSHOT_MISSING','The actual native source snapshot is missing.',409);source={id:'native:'+original.id,...file};}
        else source=field(current.sources,p.sourceSnapshotId,'SOURCE');
        let target=null;
        if(p.previousJobId){const previous=field(current.jobs,p.previousJobId,'JOB');requireValue(previous.status==='complete','PREVIOUS_TARGET_OPEN','Close the original prior target run before selecting its snapshot.',409);target=previous.files.find(f=>f.path==='artifacts/target.sqlite');requireValue(target,'TARGET_SNAPSHOT_MISSING','The original completed target snapshot is missing.',409);}
        else if(p.targetSnapshotId)target=field(current.sources,p.targetSnapshotId,'SOURCE');
        const runtime=this.runtime.retainSelection(),jobId='job_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32);
        const inputs=[{path:'inputs/source.sqlite',sha256:source.sha256,bytes:source.bytes},...(target?[{path:'inputs/target.sqlite',sha256:target.sha256,bytes:target.bytes}]:[])];
        oneOf(p.phase,['baseline','incremental','rollback'],'phase');
        const selection={schema:'tjlabs.sling-native-selection.v1',projectId:current.id,jobId,planId:plan.planId,planEditionId:selected.id,sourceId:source.id,phase:p.phase,runtime:{version:runtime.version,sourceCommit:runtime.sourceCommit,executable:runtime.executable,archive:runtime.archive},inputs,connections:{source:plan.bindings.sourceConnection,target:plan.bindings.targetConnection},tables:plan.selectedStreams.map(r=>({streamId:r.id,source:relation(r.sourceRelation),target:relation(r.parallelRelation)})),replicationSha256:selected.replication.sha256};
        const selectionObject=this.store.objects.put(Buffer.from(canonical(selection)+'\n'));
        output=this.store.commit(actor,input,s=>{s.runtime=runtime;s.jobs.push({id:jobId,projectId:s.id,kind:'replication',phase:p.phase,planId:selected.id,semanticPlanId:plan.planId,sourceSnapshotId:source.id,previousJobId:p.previousJobId??null,runtime,selection:selectionObject,replication:selected.replication,status:'prepared',controls:[],files:[],createdAt:now()});return{jobId,status:'prepared'};});
      }else if(['job.start','job.resume','job.cancel','job.resolve'].includes(input.action)){
        const job=field(current.jobs,p.jobId,'JOB');requireValue(!this.receiving.has(current.id),'RECEIVING_BUSY','The project is receiving a retained edition.',423);
        if(input.action==='job.start')requireValue(job.status==='prepared'||job.status==='queued','JOB_STATE','Start the selected prepared original job.',409);
        if(input.action==='job.resume'){text(p.reason,'reason',{min:1,max:5000});requireValue(['failed','interrupted','awaiting_reconciliation','cancelled'].includes(job.status)||(this.store.binding(job.id)?.suspended&&ACTIVE.has(job.status)),'JOB_STATE','Resume only the retained ended original operation.',409);}
        if(input.action==='job.resolve'){
          oneOf(p.decision,['retry','adopt','abandon'],'decision');text(p.reason,'reason',{min:1,max:5000});id(p.stepId,'stepId');id(p.attemptId,'attemptId');
          requireValue(job.status==='awaiting_reconciliation'||job.status==='interrupted'||job.status==='failed','JOB_STATE','Resolve the actual ended target-write operation.',409);
          const step=Object.values(job.nativeState?.steps??{}).find(s=>s.id===p.stepId&&s.attemptId===p.attemptId);requireValue(step?.writesTarget&&step.status!=='complete','ORIGINAL_STEP_REQUIRED','Select the actual unresolved original target-write step.',409);
        }
        output=this.store.commit(actor,input,s=>{const j=field(s.jobs,job.id,'JOB');
          if(input.action==='job.cancel'){requireValue(ACTIVE.has(j.status)||j.status==='prepared','JOB_STATE','Cancel the actual pending or live native operation.',409);j.controls.push({id:'control_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32),kind:'cancel',jobId:j.id,attemptId:j.nativeState?.attempts?.at(-1)?.id??null,reason:p.reason??'Operator requested cancellation',createdAt:now()});j.status='cancelling';}
          else if(input.action==='job.resolve'){j.controls.push({id:'decision_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32),kind:'decision',jobId:j.id,stepId:p.stepId,attemptId:p.attemptId,decision:p.decision,reason:p.reason,createdAt:now()});j.status='queued';j.resumeRequested=true;}
          else{j.status='queued';j.resumeRequested=input.action==='job.resume';if(p.reason)j.resumeReason=p.reason;}
          return{jobId:j.id,status:j.status};});
        const latest=field(output.view.jobs,job.id,'JOB'),binding=this.store.binding(job.id);
        if(binding&&!binding.suspended)this.runtime.writeControls(latest,binding);
        if(latest.status==='queued'||latest.status==='cancelling')await this.runtime.launch(latest,{resume:latest.resumeRequested===true});
      }else if(input.action==='comparison.create'){
        const job=field(current.jobs,p.jobId,'JOB');requireValue(job.status==='complete','NATIVE_RESULT_REQUIRED','Close the actual original native run before comparing its full outputs.',409);
        const {selected,plan}=this.planObject(current,job.planId),observation=job.files.find(f=>f.path==='artifacts/observations.json');requireValue(observation,'OBSERVATIONS_MISSING','The complete native typed export is missing.',409);
        const observations=JSON.parse(this.store.objects.read(observation.sha256,observation.bytes));
        requireValue(observations.planId===plan.planId,'OBSERVATION_PLAN','The original observations identify another semantic plan.',409);
        const report=compareObservations(plan,observations),reportObject=this.store.objects.put(Buffer.from(canonical(report)+'\n'));
        requireValue(report.schema==='slingdata.migration-comparison.v1'&&report.planId===plan.planId,'COMPARISON_CONTRACT','The maintained comparison identifies another plan.',500);
        output=this.store.commit(actor,input,s=>{const row={id:'comparison_'+identity({jobId:job.id,reportSha256:reportObject.sha256}).slice(0,32),planId:selected.id,semanticPlanId:plan.planId,jobId:job.id,observations:observation,report:reportObject,equal:report.equal,readyForCutover:report.readyForCutover,comparisonId:report.comparisonId,errors:report.errors,createdAt:now()};if(!s.comparisons.some(r=>r.id===row.id))s.comparisons.push(row);return{comparisonId:row.id,semanticComparisonId:report.comparisonId,equal:report.equal,readyForCutover:report.readyForCutover};});
      }else if(input.action==='downstream.plan'){
        const {selected,plan}=this.planObject(current,p.planId),source=field(current.sources,p.sourceId,'SOURCE');
        text(p.title,'title',{min:1,max:300});text(p.reason??'','reason',{max:20000});array(p.edits,'edits',{max:10000});
        requireValue(source.bytes<=32*1024*1024,'CONSUMER_SOURCE_SIZE','The complete consumer text map exceeds the selected limit.',413);
        const originals=JSON.parse(this.store.objects.read(source.sha256,source.bytes));object(originals,'complete consumer files');
        for(const [path,value] of Object.entries(originals)){safeRelative(path);text(value,'consumer content',{max:16*1024*1024});}
        let report=null;if(p.comparisonId){const c=field(current.comparisons,p.comparisonId,'COMPARISON');requireValue(c.planId===selected.id,'COMPARISON_PLAN','The comparison belongs to another plan edition.',409);report=JSON.parse(this.store.objects.read(c.report.sha256,c.report.bytes));}
        const prepared=planDownstreamChanges(plan,report,originals,p.edits,{reason:p.reason??''}),inventory=inventoryDownstream(plan,originals),preparedObject=this.store.objects.put(Buffer.from(canonical(prepared)+'\n')),edits=this.store.objects.put(Buffer.from(canonical(p.edits)+'\n'));
        output=this.store.commit(actor,input,s=>{
          s.downstreamPlans??=[];const row={id:'files_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32),title:p.title,sourceId:source.id,planId:selected.id,semanticPlanId:plan.planId,comparisonId:p.comparisonId??null,originalFiles:{sha256:source.sha256,bytes:source.bytes},edits,plan:preparedObject,changePlanId:prepared.changePlanId,readyForApply:prepared.readyForApply,inventory,createdAt:now()};s.downstreamPlans.push(row);return{changePlanId:row.id,semanticChangePlanId:row.changePlanId,readyForApply:row.readyForApply};
        });
      }else if(input.action==='downstream.apply'||input.action==='downstream.restore'){
        this.noActive(current);const {selected,plan}=this.downstreamSelection(current,p.changePlanId);text(p.reason,'reason',{min:1,max:20000});
        requireValue(input.action==='downstream.restore'||(selected.readyForApply&&selected.planId===current.currentPlanId),'DOWNSTREAM_NOT_READY','Apply a ready file plan for the current migration edition.',409);
        const operationId='downstream_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32);
        const original=JSON.parse(this.store.objects.read(selected.originalFiles.sha256,selected.originalFiles.bytes)),consumerBinding=this.downstreamSeed(current,selected,original);
        output=this.store.commit(actor,input,s=>{
          s.downstreamOperations??=[];const operation={id:operationId,changePlanId:selected.id,sourceId:selected.sourceId,direction:input.action==='downstream.restore'?'restore':'apply',status:'queued',reason:p.reason,actorId:actor.id,activeRequestId:input.requestId,consumerBinding,files:[],createdAt:now()};
          s.downstreamOperations.push(operation);this.bindDownstream(s,operation);return{operationId,status:'queued'};
        });
        await this.executeDownstream(current.id,operationId);
      }else if(input.action==='downstream.resume'){
        text(p.reason,'reason',{min:1,max:20000});const selected=field(current.downstreamOperations??[],p.operationId,'DOWNSTREAM_OPERATION');requireValue(selected.status==='failed'||this.store.downstreamBinding(selected.id)?.suspended,'DOWNSTREAM_STATE','Continue the actual ended or explicitly received downstream operation.',409);
        output=this.store.commit(actor,input,s=>{const row=field(s.downstreamOperations,p.operationId,'DOWNSTREAM_OPERATION');row.status='queued';row.resumeReason=p.reason;row.activeRequestId=input.requestId;if(this.store.downstreamBinding(row.id)?.suspended)this.bindDownstream(s,row,{received:true});return{operationId:row.id,status:'queued'};});await this.executeDownstream(current.id,p.operationId);
      }else if(input.action==='review.record'){
        text(p.subjectId,'subjectId',{min:1,max:160});text(p.decision,'decision',{min:1,max:200});text(p.notes,'notes',{min:1,max:20000});
        output=this.store.commit(actor,input,s=>{const review={id:uuid('review'),subjectId:p.subjectId,decision:p.decision,notes:p.notes,actorId:actor.id,createdAt:now()};s.reviews.push(review);return{reviewId:review.id};});
      }else if(input.action==='cutover.apply'){
        await this.assertIdle(current.id);text(p.reason,'reason',{min:1,max:20000});
        const comparison=field(current.comparisons,p.comparisonId,'COMPARISON'),{selected,plan}=this.planObject(current,comparison.planId),report=JSON.parse(this.store.objects.read(comparison.report.sha256,comparison.report.bytes));
        requireValue(selected.id===current.currentPlanId&&selected.status==='approved'&&report.readyForCutover&&report.planId===plan.planId,'CUTOVER_NOT_READY','Select the current reviewed plan and its complete equal, schema-compatible, key-valid native comparison.',409,{errors:report.errors});
        const job=field(current.jobs,comparison.jobId,'JOB'),target=job.files.find(f=>f.path==='artifacts/target.sqlite'),source=job.files.find(f=>f.path==='artifacts/source.sqlite');requireValue(target&&source,'SNAPSHOT_MISSING','Both original database snapshots are required.',409);
        output=this.store.commit(actor,input,s=>{const previous=this.consumerSelection(s)??{id:'source_'+job.id,kind:'source',jobId:job.id,planId:selected.id,snapshot:{sha256:source.sha256,bytes:source.bytes},tables:plan.selectedStreams.map(r=>({streamId:r.id,relation:r.sourceRelation}))};
          const selection={id:'selection_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32),kind:'target',jobId:job.id,planId:selected.id,comparisonId:comparison.id,snapshot:{sha256:target.sha256,bytes:target.bytes},tables:plan.selectedStreams.map(r=>({streamId:r.id,relation:r.parallelRelation}))};
          const cutover={id:'cutover_'+identity(selection).slice(0,32),kind:'cutover',selection,previous:clone(previous),reason:p.reason,actorId:actor.id,createdAt:now()};s.cutovers.push(cutover);s.currentCutoverId=cutover.id;return{cutoverId:cutover.id,selection};});
        this.materializeConsumer(this.store.get(current.id));
      }else if(input.action==='cutover.rollback'){
        await this.assertIdle(current.id);text(p.reason,'reason',{min:1,max:20000});const selected=field(current.cutovers,p.cutoverId,'CUTOVER');requireValue(current.currentCutoverId===selected.id,'CUTOVER_CHANGED','Rollback the current original consumer selection.',409);
        output=this.store.commit(actor,input,s=>{const row={id:'cutover_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32),kind:'rollback',selection:clone(selected.previous),previous:clone(selected.selection),rollbackOf:selected.id,reason:p.reason,actorId:actor.id,createdAt:now()};s.cutovers.push(row);s.currentCutoverId=row.id;return{cutoverId:row.id,selection:row.selection};});this.materializeConsumer(this.store.get(current.id));
      }
      requireValue(output,'ACTION_NOT_IMPLEMENTED','The selected action is unavailable.',500);return this.result(output);
    });
  }
  async close(){
    this.closeState??={queues:false,uploads:false,native:false,archives:false,store:false,lease:false};
    const state=this.closeState;
    if(state.lease)return;
    if(this.closePromise)return this.closePromise;
    this.closePromise=(async()=>{
      if(!state.queues){await Promise.allSettled([...this.queues.values()]);state.queues=true;}
      if(!state.uploads){await this.uploads.drain();state.uploads=true;}
      if(!state.native){await Promise.allSettled([...this.runtime.launches.values(),...this.runtime.reading.values(),...this.downstreamRunning.values()].map(v=>v.promise??v));state.native=true;}
      // Closing this observer never kills an accepted detached Sling process.
      // Reopen continues that process through its original kernel lifetime.
      if(!state.archives){await this.archives.close();state.archives=true;}
      if(!state.store){this.store.close();state.store=true;}
      if(!state.lease){await this.lease.close();state.lease=true;}
    })();
    try{return await this.closePromise;}finally{this.closePromise=null;}
  }
}
export const openWorkspace=options=>Workspace.open(options);
