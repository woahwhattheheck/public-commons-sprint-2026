// MIT. Original RPC collections inside the retained merchant accounting workspace.
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {WorkspaceError} from './store.mjs';
import {PLAN_SCHEMA,prepareBatch,inspectBatch,collectBatch,exportBatch,inspectBatchExport} from '../../sf86-rpc-transfer-reconcile/batch.mjs';
import {originalRecordFromEvidence} from '../../sf86-rpc-transfer-reconcile/cli.mjs';
import {checkOriginalTerms,rpcNetwork} from '../../sf86-rpc-transfer-reconcile/terms.mjs';
import {exclusiveFile} from '../../sf86-rpc-transfer-reconcile/private-files.mjs';
import {createPublicHttpsFetch} from '../../sf31-buyer-client/public-transport.mjs';

const ID=/^[a-f0-9-]{36}$/;
const ACTIVE=new Set(['queued','running','cancelling']);
const now=()=>new Date().toISOString();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const check=(ok,code,message,status=400)=>{if(!ok)throw new WorkspaceError(code,message,status);};
function text(value,label,max=160){check(typeof value==='string'&&value.trim().length>0&&value.trim().length<=max,'INVALID_FIELD','Check '+label+'.');return value.trim();}
async function directory(path){
  await mkdir(path,{recursive:true,mode:0o700});
  const info=await lstat(path);
  check(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&await realpath(path)===path,'PRIVATE_COLLECTION_DIRECTORY_REQUIRED','Open the workspace through its absolute private directory.');
}
async function read(path,max=4_000_000){
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const info=await file.stat();
    check(info.isFile()&&info.size>0&&info.size<=max,'INVALID_COLLECTION_FILE','Choose a regular original JSON file within its supported size.');
    const bytes=await file.readFile();
    check(bytes.length===info.size,'COLLECTION_SOURCE_CHANGED','The retained file changed while it was being read.',409);
    return bytes;
  }finally{await file.close();}
}
function parse(content){try{return JSON.parse(content);}catch{throw new WorkspaceError('INVALID_JSON','Choose valid original payment JSON.');}}
function totals(jobs){return {jobs:jobs.length,unattempted:jobs.filter(x=>x.verdict==='UNATTEMPTED').length,
  reconciled:jobs.filter(x=>x.verdict.startsWith('CHAIN_TRANSFER_MATCHED_RPC_')).length,
  localReplays:jobs.filter(x=>x.verdict==='LOCAL_RPC_REPLAY_MATCHED').length,
  unresolved:jobs.filter(x=>x.verdict==='NOT_RECONCILED').length};}

/** Uses the original workspace lease, revision, history and state file. */
export async function openCollectionWorkspace(workspace,{httpsProxyEnv}={}){
  check(httpsProxyEnv===undefined||typeof httpsProxyEnv==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(httpsProxyEnv),'INVALID_PROXY_ENVIRONMENT','Choose the environment variable containing the configured HTTPS proxy.');
  const controller=new CollectionWorkspace(workspace,httpsProxyEnv);
  await controller.initialize();
  return controller;
}

class CollectionWorkspace{
  constructor(workspace,httpsProxyEnv){
    this.workspace=workspace;this.root=join(workspace.directory,'collections');
    this.httpsProxyEnv=httpsProxyEnv;
    this.summaries=new Map();this.progress=new Map();this.controllers=new Map();this.tasks=new Set();this.closing=false;
    this.pending=[];this.running=0;
  }
  async initialize(){
    for(const path of [this.root,...['sources','plans','batches','exports'].map(name=>join(this.root,name))])await directory(path);
    await this.workspace.serial(async()=>{
      let changed=false;
      for(const key of ['collectionSources','rpcCollections','collectionJobs']){
        if(this.workspace.state[key]===undefined){this.workspace.state[key]=[];changed=true;}
        check(Array.isArray(this.workspace.state[key]),'INVALID_COLLECTION_STATE','The retained collection state is invalid.');
      }
      for(const job of this.workspace.state.collectionJobs.filter(item=>ACTIVE.has(item.status))){
        const collected=job.kind==='collect'&&job.status!=='queued';
        job.status='interrupted';job.completedAt=now();job.error='The process stopped. Resume the retained collection or publish its current original results again.';
        if(collected){
          const collection=this.collection(job.collectionId);
          const summary=await inspectBatch({directory:this.batchPath(collection.id)});
          const completed=summary.jobs.filter(item=>Object.hasOwn(job.baselineAttempts??{},item.id)&&item.attempts>job.baselineAttempts[item.id]);
          job.processed=job.baselineAttempts?completed.length:Math.max(0,job.total-summary.totals.unattempted);
          job.lastJobId=completed.at(-1)?.id??job.lastJobId;
          this.rememberSummary(collection.id,summary);collection.totals=summary.totals;
        }
        changed=true;
      }
      if(changed)await this.workspace.commit('rpc_collections_opened','workspace startup');
    });
  }
  collection(id){
    check(typeof id==='string'&&ID.test(id),'INVALID_COLLECTION','Choose a retained collection.');
    const value=this.workspace.state.rpcCollections.find(item=>item.id===id);
    check(value,'COLLECTION_NOT_FOUND','This retained collection was not found.',404);return value;
  }
  job(id){const value=this.workspace.state.collectionJobs.find(item=>item.id===id);check(value,'COLLECTION_JOB_NOT_FOUND','This collection operation was not found.',404);return value;}
  batchPath(id){this.collection(id);return join(this.root,'batches',id);}
  sourcePath(id){check(ID.test(id),'INVALID_SOURCE','Choose a retained original source.');return join(this.root,'sources',id+'.json');}
  available(id){check(!this.closing,'CLOSING','The workspace is closing.',503);check(!this.workspace.state.collectionJobs.some(job=>job.collectionId===id&&ACTIVE.has(job.status)),'COLLECTION_IN_PROGRESS','Wait for this collection operation or stop it before starting another.',409);}
  rememberSummary(id,summary){
    this.summaries.delete(id);this.summaries.set(id,summary);
    while(this.summaries.size>8){
      const candidate=[...this.summaries.keys()].find(key=>key!==id&&!this.workspace.state.collectionJobs.some(job=>job.collectionId===key&&this.controllers.has(job.id)));
      if(!candidate)break;this.summaries.delete(candidate);
    }
  }
  schedule(jobId){
    let finish;const task=new Promise(resolve=>{finish=resolve;});
    this.tasks.add(task);this.pending.push({jobId,finish});
    task.finally(()=>this.tasks.delete(task));this.pump();
  }
  pump(){
    // Two original operations can progress while the shared state remains serial.
    while(this.running<2&&this.pending.length){
      const {jobId,finish}=this.pending.shift();this.running++;
      new Promise(resolve=>setImmediate(resolve)).then(()=>this.execute(jobId)).catch(()=>{}).finally(()=>{
        this.running--;finish();this.pump();
      });
    }
  }
  view(){
    return {state:this.workspace.view(),sources:structuredClone(this.workspace.state.collectionSources),
      collections:structuredClone(this.workspace.state.rpcCollections),
      jobs:this.workspace.state.collectionJobs.map(job=>structuredClone({...job,...this.progress.get(job.id)}))};
  }
  async detail(id,{refresh=false}={}){
    const collection=this.collection(id);
    if(refresh||!this.summaries.has(id))this.rememberSummary(id,await inspectBatch({directory:this.batchPath(id)}));
    const summary=this.summaries.get(id);
    const publishedProofs=summary.jobs.filter(job=>job.resultSha256).map(job=>{
      const proof=this.workspace.state.proofs.find(item=>item.sha256===job.resultSha256);
      return {jobId:job.id,sourceId:job.id,sha256:job.resultSha256,verdict:job.verdict,proofId:proof?.id??null,included:proof?.included??false};
    });
    return {...this.view(),collection:structuredClone(collection),summary:structuredClone(summary),publishedProofs};
  }
  async source({revision,name,kind,payer,rpcEndpoint,maxEventPages=24,content,actor}){
    return this.workspace.serial(async()=>{
      this.workspace.expected(revision);check(!this.closing,'CLOSING','The workspace is closing.',503);
      actor=text(actor,'operator',1000);name=text(name,'filename');
      check(kind==='sf81-record'||kind==='sf82-evidence','COLLECTION_SOURCE_KIND_INVALID','Choose a payment record or verification evidence file.');
      check(rpcEndpoint===undefined||typeof rpcEndpoint==='string','INVALID_RPC_ENDPOINT','Choose a supported RPC endpoint.');
      check(typeof content==='string'&&Buffer.byteLength(content)>0&&Buffer.byteLength(content)<=4_000_000,'COLLECTION_SOURCE_TOO_LARGE','Choose original payment JSON up to 4 MB.');
      check(Number.isSafeInteger(maxEventPages)&&maxEventPages>=1&&maxEventPages<=100,'INVALID_EVENT_PAGE_LIMIT','Choose 1 to 100 event pages.');
      const input=parse(content),record=kind==='sf82-evidence'?originalRecordFromEvidence(input):input;
      const terms=checkOriginalTerms(record,payer),profile=rpcNetwork(terms.requirement.network,rpcEndpoint||undefined);
      const bytes=Buffer.from(content),sha256=hash(bytes);
      const prior=this.workspace.state.collectionSources.find(item=>item.sha256===sha256&&item.kind===kind&&item.payer===payer&&item.rpcEndpoint===profile.endpoint&&item.maxEventPages===maxEventPages);
      if(prior)return {...this.view(),source:structuredClone(prior),duplicate:true};
      check(this.workspace.state.collectionSources.length<2000,'COLLECTION_SOURCE_LIMIT','This workspace retains 2,000 selected original sources.');
      const source={id:randomUUID(),name,kind,payer,network:terms.requirement.network,transaction:terms.receipt.transaction,
        intentId:terms.intentId,rpcEndpoint:profile.endpoint,maxEventPages,sha256,bytes:bytes.length,createdAt:now(),actor};
      const path=this.sourcePath(source.id);await exclusiveFile(path,bytes);
      try{
        this.workspace.state.collectionSources.push(source);
        await this.workspace.commit('rpc_source_reviewed',actor,{sourceId:source.id,name,sha256,network:source.network});
      }catch(error){await rm(path,{force:true});throw error;}
      return {...this.view(),source:structuredClone(source),duplicate:false};
    });
  }
  async prepare({revision,name,sourceIds,actor}){
    return this.workspace.serial(async()=>{
      this.workspace.expected(revision);check(!this.closing,'CLOSING','The workspace is closing.',503);
      actor=text(actor,'operator',1000);name=text(name,'collection name');
      check(Array.isArray(sourceIds)&&sourceIds.length>0&&sourceIds.length<=2000&&new Set(sourceIds).size===sourceIds.length,'COLLECTION_SELECTION_REQUIRED','Select distinct reviewed original payment sources.');
      check(this.workspace.state.rpcCollections.length<1000,'COLLECTION_LIMIT','This workspace retains 1,000 collections.');
      const jobs=[];
      for(const sourceId of sourceIds){
        const source=this.workspace.state.collectionSources.find(item=>item.id===sourceId);
        check(source,'COLLECTION_SOURCE_NOT_FOUND','Review the original payment source before selecting it.');
        check(hash(await read(this.sourcePath(source.id)))===source.sha256,'COLLECTION_SOURCE_CHANGED','The retained original source changed.',409);
        jobs.push({id:source.id,kind:source.kind,sourceFile:this.sourcePath(source.id),payer:source.payer,rpcEndpoint:source.rpcEndpoint,maxEventPages:source.maxEventPages});
      }
      const id=randomUUID(),planFile=join(this.root,'plans',id+'.json'),target=join(this.root,'batches',id);
      await exclusiveFile(planFile,json({schema:PLAN_SCHEMA,jobs}));
      try{
        const summary=await prepareBatch({planFile,directory:target});
        const collection={id,name,createdAt:now(),actor,sourceIds:[...sourceIds],batchId:summary.batchId,planSha256:summary.planSha256,totals:summary.totals};
        this.workspace.state.rpcCollections.unshift(collection);
        await this.workspace.commit('rpc_collection_prepared',actor,{collectionId:id,name,sourceIds,planSha256:summary.planSha256});
        this.rememberSummary(id,summary);
        return {...this.view(),collection:structuredClone(collection),summary};
      }catch(error){await rm(planFile,{force:true});await rm(target,{recursive:true,force:true});throw error;}
    });
  }
  async refresh(id,{revision,actor}){
    return this.workspace.serial(async()=>{
      this.workspace.expected(revision);this.available(id);actor=text(actor,'operator',1000);
      const summary=await inspectBatch({directory:this.batchPath(id)});
      this.collection(id).totals=summary.totals;this.rememberSummary(id,summary);
      await this.workspace.commit('rpc_collection_refreshed',actor,{collectionId:id,totals:summary.totals});
      return this.detail(id);
    });
  }
  async start(id,kind,{revision,actor,retryIds=[]}){
    return this.workspace.serial(async()=>{
      this.workspace.expected(revision);this.available(id);actor=text(actor,'operator',1000);
      const summary=await inspectBatch({directory:this.batchPath(id)});
      check(Array.isArray(retryIds)&&new Set(retryIds).size===retryIds.length,'INVALID_RETRY_SELECTION','Choose distinct unsuccessful records to retry.');
      check(retryIds.every(sourceId=>summary.jobs.some(item=>item.id===sourceId&&item.verdict==='NOT_RECONCILED')),'INVALID_RETRY_SELECTION','Only unsuccessful verification records can be explicitly retried.');
      check(this.workspace.state.collectionJobs.length<5000,'COLLECTION_OPERATION_LIMIT','This workspace retains 5,000 collection operations.');
      const selected=kind==='publish'?summary.jobs.filter(item=>item.resultSha256):summary.jobs.filter(item=>retryIds.length?retryIds.includes(item.id):item.verdict==='UNATTEMPTED');
      check(kind!=='publish'||selected.length,'COLLECTION_RESULTS_REQUIRED','Collect original verification results before publishing them.');
      const job={id:randomUUID(),collectionId:id,kind,status:'queued',retryIds:[...retryIds],processed:0,total:selected.length,
        baselineAttempts:Object.fromEntries(selected.map(item=>[item.id,item.attempts])),
        actor,createdAt:now(),completedAt:null,error:null,lastJobId:null};
      this.workspace.state.collectionJobs.unshift(job);this.rememberSummary(id,summary);
      await this.workspace.commit('rpc_collection_operation_queued',actor,{jobId:job.id,collectionId:id,kind,retryIds:job.retryIds});
      this.schedule(job.id);
      return {...await this.detail(id),job:structuredClone(job)};
    });
  }
  async execute(jobId){
    if(!ACTIVE.has(this.job(jobId).status))return;
    const controller=new AbortController();this.controllers.set(jobId,controller);
    try{
      await this.workspace.serial(async()=>{
        const job=this.job(jobId);
        if(!ACTIVE.has(job.status)){controller.abort();return;}
        if(job.status==='cancelling'||this.closing)controller.abort();
        else job.status='running';
        await this.workspace.commit('rpc_collection_operation_started',job.actor,{jobId});
      });
      if(controller.signal.aborted){
        await this.workspace.serial(async()=>{
          const job=this.job(jobId);
          if(ACTIVE.has(job.status)){job.status='cancelled';job.completedAt=now();await this.workspace.commit('rpc_collection_operation_finished',job.actor,{jobId,status:job.status,processed:0});}
        });
        return;
      }
      const job=structuredClone(this.job(jobId));
      this.progress.set(jobId,{processed:0,total:job.total,lastJobId:null});
      let summary;
      if(job.kind==='collect'){
        if(!this.summaries.has(job.collectionId))this.rememberSummary(job.collectionId,await inspectBatch({directory:this.batchPath(job.collectionId)}));
        const endpoints=new Set(this.summaries.get(job.collectionId).jobs.map(item=>item.rpcEndpoint));
        const transports=new Map();
        const fetchImpl=(url,options)=>{
          check(endpoints.has(String(url)),'COLLECTION_ENDPOINT_CHANGED','Use the RPC endpoint retained in the original collection.');
          if(this.httpsProxyEnv===undefined||new URL(url).protocol==='http:')return fetch(url,options);
          const origin=new URL(url).origin;
          if(!transports.has(origin))transports.set(origin,createPublicHttpsFetch({trustedProxy:{mode:'explicit-connect',origin,proxyEnv:this.httpsProxyEnv}}));
          return transports.get(origin)(url,{...options,redirect:'manual'});
        };
        summary=await collectBatch({directory:this.batchPath(job.collectionId),retryIds:job.retryIds,signal:controller.signal,fetchImpl,
          onResult:result=>{
            const live=this.summaries.get(job.collectionId),index=live.jobs.findIndex(item=>item.id===result.id);
            live.jobs[index]=result;live.totals=totals(live.jobs);
            const progress=this.progress.get(jobId);progress.processed++;progress.lastJobId=result.id;
          }});
      }else{
        await this.publish(job,controller.signal);
        summary=await inspectBatch({directory:this.batchPath(job.collectionId)});
      }
      await this.workspace.serial(async()=>{
        const current=this.job(jobId);Object.assign(current,this.progress.get(jobId));
        current.status=controller.signal.aborted||summary.cancelled?'cancelled':'complete';current.completedAt=now();
        this.collection(job.collectionId).totals=summary.totals;this.rememberSummary(job.collectionId,summary);
        await this.workspace.commit('rpc_collection_operation_finished',current.actor,{jobId,status:current.status,processed:current.processed,total:current.total});
      });
    }catch(error){
      await this.workspace.serial(async()=>{
        const job=this.job(jobId);Object.assign(job,this.progress.get(jobId));
        job.status=controller.signal.aborted?'cancelled':'failed';job.completedAt=now();
        job.error=String(error.message??error).slice(0,2000);job.errorCode=error.code??'COLLECTION_OPERATION_FAILED';
        await this.workspace.commit('rpc_collection_operation_finished',job.actor,{jobId,status:job.status,processed:job.processed,errorCode:job.errorCode});
      });
    }finally{this.controllers.delete(jobId);this.progress.delete(jobId);}
  }
  async publish(job,signal){
    const output=join(this.root,'exports',job.id),directory=this.batchPath(job.collectionId);
    if(signal.aborted)return;
    await exportBatch({directory,output});
    const snapshot=await inspectBatchExport({directory,output});
    await this.workspace.serial(async()=>{
      const current=this.job(job.id);current.exportId=job.id;current.exportManifestSha256=snapshot.manifestSha256;
      await this.workspace.commit('rpc_collection_results_exported',job.actor,{jobId:job.id,collectionId:job.collectionId,files:snapshot.files.length,manifestSha256:snapshot.manifestSha256});
    });
    for(const file of snapshot.files){
      if(signal.aborted)break;
      const bytes=await read(join(output,file.path),80_000);
      check(hash(bytes)===file.sha256,'COLLECTION_EXPORT_PROOF_CHANGED','The retained original result changed.',409);
      const source=this.workspace.state.collectionSources.find(item=>item.id===file.jobId);
      // Immutable original imports are additive and preserve duplicate selection.
      // Another operator may commit between our read and the original CAS call.
      let imported;
      while(!imported&&!signal.aborted){
        try{imported=await this.workspace.importProof({revision:this.workspace.view().revision,
          name:(source?.name??file.jobId).slice(0,105)+' · attempt '+file.attempt,content:bytes.toString('utf8'),actor:job.actor});}
        catch(error){if(error.code!=='STALE_WORKSPACE')throw error;}
      }
      if(imported){const progress=this.progress.get(job.id);progress.processed++;progress.lastJobId=file.jobId;}
    }
  }
  async cancel(jobId,{actor}){
    return this.workspace.serial(async()=>{
      actor=text(actor,'operator',1000);const job=this.job(jobId);
      if(ACTIVE.has(job.status)){
        if(job.status==='queued'){job.status='cancelled';job.completedAt=now();}
        else job.status='cancelling';
        this.controllers.get(jobId)?.abort();
        await this.workspace.commit('rpc_collection_stop_requested',actor,{jobId});
      }
      return {...this.view(),job:structuredClone({...job,...this.progress.get(jobId)})};
    });
  }
  async result(id,sourceId){
    const summary=await inspectBatch({directory:this.batchPath(id)}),job=summary.jobs.find(item=>item.id===sourceId);
    check(job&&job.attempts>0,'COLLECTION_RESULT_NOT_FOUND','Collect an original verification result first.',404);
    const bytes=await read(join(this.batchPath(id),'attempts',hash(sourceId),String(job.attempts).padStart(6,'0')+'.json'),80_000);
    check(hash(bytes)===job.resultSha256,'COLLECTION_RESULT_CHANGED','The original verification result changed.',409);
    return {bytes,name:'verification-'+sourceId+'-attempt-'+job.attempts+'.json',type:'application/json; charset=utf-8'};
  }
  async route(method,parts,value){
    if(parts[0]!=='api'||parts[1]!=='collection')return;
    if(parts.length===2&&method==='GET')return this.view();
    if(parts.length===3&&method==='POST'&&parts[2]==='sources')return this.source(value);
    if(parts.length===3&&method==='POST'&&parts[2]==='prepare')return this.prepare(value);
    if(parts.length===3&&method==='GET')return this.detail(parts[2]);
    if(parts.length===4&&method==='POST'){
      if(parts[3]==='refresh')return this.refresh(parts[2],value);
      if(parts[3]==='collect'||parts[3]==='publish')return this.start(parts[2],parts[3],value);
    }
    if(parts.length===5&&parts[2]==='jobs'&&parts[4]==='cancel'&&method==='POST')return this.cancel(parts[3],value);
    if(parts.length===5&&parts[3]==='results'&&method==='GET')return {download:await this.result(parts[2],parts[4])};
  }
  async close(){
    this.closing=true;for(const controller of this.controllers.values())controller.abort();
    const waiting=this.pending.splice(0);
    try{
      await this.workspace.serial(async()=>{
        const queued=this.workspace.state.collectionJobs.filter(job=>job.status==='queued');
        for(const job of queued){job.status='interrupted';job.completedAt=now();job.error='The workspace stopped before this queued operation began. Resume its retained collection when ready.';}
        if(queued.length)await this.workspace.commit('rpc_collection_queue_stopped','workspace shutdown',{jobIds:queued.map(job=>job.id)});
      });
    }finally{for(const item of waiting)item.finish();}
    await Promise.allSettled([...this.tasks]);
  }
}
