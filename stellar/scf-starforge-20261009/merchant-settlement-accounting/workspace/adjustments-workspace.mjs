// MIT. Operator-selected adjustments owned by the original accounting workspace.
import {constants} from 'node:fs';
import {lstat,mkdir,open,rename,rm} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {indexOriginalVerifications} from '../reconcile.mjs';
import {reconcileMerchantRefund} from '../../sf86-rpc-transfer-reconcile/verify.mjs';
import {validStrKey,resolveRpcEndpoint} from '../../sf86-rpc-transfer-reconcile/terms.mjs';
import {createOfficialEventDecoder} from '../../sf43-agent-commerce/verify.mjs';
import {createPublicHttpsFetch} from '../../sf31-buyer-client/public-transport.mjs';
import {ADJUSTMENT_SCHEMA,adjustmentHash as hash,adjustmentJson as json,adjustmentNeed as need,
  adjustmentId,adjustmentText,adjustmentEventKey,adjustmentEventIdentity,adjustmentRequest,
  validateAdjustment,indexAdjustments,summarizeAdjustments,previewAdjustment,validateRefundProof,
  compileAdjustmentExport,renderAdjustmentCsv,renderAdjustmentHtml} from '../adjustments.mjs';

const now=()=>new Date().toISOString();
const copy=value=>structuredClone(value);
const SHA=/^[a-f0-9]{64}$/;
const ACTIVE=new Set(['QUEUED','RUNNING']);
const issue=error=>({code:error.code??'REFUND_VERIFICATION_FAILED',message:String(error.message??error).slice(0,2000)});
const records=workspace=>workspace.state.adjustments??[];
const jobs=workspace=>workspace.state.adjustmentJobs??[];
const page=query=>{const offset=Number(query.offset??0),limit=Number(query.limit??50);
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=200,'INVALID_PAGE','Choose a nonnegative offset and up to 200 events.');return {offset,limit};};
const summary=record=>Object.fromEntries(['id','runId','eventId','kind','amountAtomic','effectiveAt','reason','reference','actor','createdAt','status','verification'].map(key=>[key,copy(record[key])]));
async function readExact(path,expected,max=200_000){
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{const info=await file.stat();need(info.isFile()&&info.size<=max,'ADJUSTMENT_SOURCE_CHANGED','A retained adjustment source is not a regular file within its size limit.',409);
    const bytes=await file.readFile();need(bytes.length<=max&&(!expected||(hash(bytes)===expected.sha256&&(expected.bytes===undefined||bytes.length===expected.bytes))),
      'ADJUSTMENT_SOURCE_CHANGED','A retained adjustment source changed.',409);return bytes;
  }finally{await file.close();}
}
async function privateDirectory(path){
  try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const info=await lstat(path);need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077),
    'ADJUSTMENT_DIRECTORY_UNSAFE','Use the original private accounting adjustment directory.',409);
}
async function syncDirectory(path){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
async function writeExact(path,bytes){
  bytes=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);const expected={sha256:hash(bytes),bytes:bytes.length};
  try{await readExact(path,expected,Math.max(bytes.length,200_000));return expected;}catch(error){if(error.code!=='ENOENT')throw error;}
  const stage=path+'.'+randomUUID()+'.pending';
  try{const file=await open(stage,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    // The original workspace lease owns each UUID destination. Only complete
    // files become visible before the existing state writer records the result.
    await rename(stage,path);await syncDirectory(dirname(path));return expected;
  }finally{await rm(stage,{force:true});}
}
function safeRetainedPath(root,path){
  need(typeof path==='string'&&path.startsWith('sources/')&&!path.includes('..')&&!path.includes('\\')&&!path.includes('\0')&&
    resolve(root,path).startsWith(root+'/sources/'),'INVALID_ADJUSTMENT_SOURCE_PATH','Use a file from the original retained accounting input manifest.',409);
  return join(root,path);
}

export class AdjustmentWorkspace{
  constructor(workspace,options={}){
    if(workspace.adjustments instanceof AdjustmentWorkspace)return workspace.adjustments;
    this.workspace=workspace;this.options=options;this.controllers=new Map();this.promises=new Map();this.missingProofs=new Set();workspace.adjustments=this;
  }
  configureTransport({httpsProxyEnv}={}){
    need(httpsProxyEnv===undefined||/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(httpsProxyEnv),'INVALID_RPC_PROXY_ENV','Choose the existing proxy environment-variable name.');
    this.options.httpsProxyEnv=httpsProxyEnv;
  }
  async init(){
    const workspace=this.workspace;
    indexAdjustments(records(workspace));
    need(Array.isArray(jobs(workspace))&&jobs(workspace).length<=20_000,'ADJUSTMENT_JOB_LIMIT','The workspace supports 20,000 retained verification attempts.');
    const interrupted=jobs(workspace).filter(job=>ACTIVE.has(job.status));
    if(interrupted.length)await workspace.serial(async()=>{
      for(const job of interrupted){job.status='INTERRUPTED';job.completedAt=now();job.error={code:'REFUND_VERIFICATION_INTERRUPTED',
        message:'The prior process stopped during this native read. The retained request and transaction remain available for an explicit verification.'};
        const record=this.row(job.adjustmentId);if(record.status==='VERIFYING')record.status='REQUESTED';}
      await workspace.commit('refund_verifications_interrupted','workspace',{jobIds:interrupted.map(job=>job.id)});
    });
    await this.recoverSavedResults();return this;
  }
  accepting(){need(!this.workspace.closing&&!this.workspace.closed,'CLOSING','The accounting workspace is draining.',503);}
  row(id){adjustmentId(id);const record=records(this.workspace).find(item=>item.id===id);need(record,'ADJUSTMENT_NOT_FOUND','Choose a retained merchant adjustment.',404);return validateAdjustment(record);}
  job(id){adjustmentId(id);const job=jobs(this.workspace).find(item=>item.id===id);need(job,'ADJUSTMENT_JOB_NOT_FOUND','Choose a retained refund verification.',404);return job;}
  view(){return {revision:this.workspace.state.revision,adjustments:records(this.workspace).slice(0,100).map(summary),
    jobs:copy(jobs(this.workspace).slice(0,100)),adjustmentCount:records(this.workspace).length,jobCount:jobs(this.workspace).length};}
  async events(query={}){
    const {offset,limit}=page(query),report=await this.workspace.report(query.runId),indexed=indexAdjustments(records(this.workspace));let items=report.ledger;
    if(query.search){const term=adjustmentText(query.search,'search',500).toLowerCase();items=items.filter(row=>JSON.stringify(row).toLowerCase().includes(term));}
    return {items:items.slice(offset,offset+limit).map(row=>({...copy(row),adjustmentSummary:summarizeAdjustments(row,indexed.get(adjustmentEventKey(row))??[])})),
      total:items.length,offset,limit};
  }
  async event(runId,eventId){
    const workspace=this.workspace,run=workspace.runRow(runId),report=await workspace.report(runId);
    const event=report.ledger.find(row=>row.eventId===eventId);need(event,'ADJUSTMENT_EVENT_NOT_FOUND','Choose an original event in the selected reconciliation.',404);
    const source={runId,reportSha256:run.reportSha256,manifestSha256:run.manifestSha256,inputManifestSha256:run.inputManifestSha256},
      adjustments=indexAdjustments(records(workspace)).get(adjustmentEventKey(event))??[];
    let refundTerms=null,originalProof=null,originalProofFile=null;
    if(event.transfer==='OFFICIAL_TRANSFER_MATCHED'&&event.transferEvidenceDigest){
      const manifest=await workspace.inputManifest(runId),file=manifest.files.find(item=>item.sha256===event.transferEvidenceDigest&&item.path?.endsWith('.json'));
      need(file,'ORIGINAL_PAYMENT_PROOF_MISSING','The selected payment’s original transfer proof is absent from its retained input manifest.',409);
      const bytes=await readExact(safeRetainedPath(workspace.runPath(runId),file.path),file),proof=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      const eligible=indexOriginalVerifications([{data:proof,fileDigest:file.sha256}]);
      need(eligible.ignored.length===0&&proof.network===event.network&&hash(proof.transaction)===event.transactionFingerprint&&
        proof.atomicAmount===event.amountAtomic&&hash(proof.asset)===event.assetDigest&&
        hash(proof.recipient)===(event.recipientDigest??event.termsRecipientDigest),
        'ORIGINAL_PAYMENT_PROOF_CHANGED','The retained independent transfer differs from the selected original payment.',409);
      if(validStrKey(proof.payer,'G')&&(validStrKey(proof.recipient,'G')||validStrKey(proof.recipient,'C'))&&proof.payer!==proof.recipient){
        originalProof=proof;originalProofFile={path:file.path,sha256:file.sha256,bytes:bytes.length};
        refundTerms={network:proof.network,asset:proof.asset,from:proof.recipient,to:proof.payer,maxAmountAtomic:event.amountAtomic};
      }
    }
    // A prior retained run can contain a differently named row for this same
    // transfer. Its active refund already owns the original payment capacity.
    const conflict=refundTerms&&records(workspace).find(record=>record.kind==='REFUND'&&record.status!=='WITHDRAWN'&&
      record.original.network===event.network&&record.original.transactionFingerprint===event.transactionFingerprint&&record.eventId!==event.eventId);
    if(conflict)refundTerms=null;
    return {event:copy(event),source,totals:summarizeAdjustments(event,adjustments),refundTerms,originalProof,originalProofFile,
      refundConflict:conflict?.id??null,adjustments:copy(adjustments)};
  }
  async detail(id){const adjustment=copy(this.row(id));return {adjustment,detail:await this.event(adjustment.runId,adjustment.eventId)};}
  async preview(value){return this.workspace.serial(async()=>{
    this.accepting();const detail=await this.event(value.runId,value.eventId),result=previewAdjustment(detail,value);
    return {...result,workspaceRevision:this.workspace.state.revision};
  });}
  async record(value){return this.workspace.serial(async()=>{
    this.accepting();const {revision,previewSha256,...request}=value;
    adjustmentId(request.id);need(SHA.test(previewSha256??''),'ADJUSTMENT_PREVIEW_REQUIRED','Review this exact adjustment before retaining it.');
    const prior=records(this.workspace).find(item=>item.id===request.id);
    if(prior){need(prior.requestSha256===hash(json(adjustmentRequest(request)))&&prior.previewSha256===previewSha256,
      'ADJUSTMENT_REQUEST_CONFLICT','This UUID already belongs to another reviewed adjustment.',409);return {adjustment:copy(prior),duplicate:true,state:this.workspace.view()};}
    this.workspace.expected(revision);need(records(this.workspace).length<5000,'ADJUSTMENT_LIMIT','This workspace already retains 5,000 adjustments.');
    const detail=await this.event(request.runId,request.eventId),preview=previewAdjustment(detail,request);
    need(preview.previewSha256===previewSha256,'ADJUSTMENT_PREVIEW_CHANGED','Refresh the payment and preview the retained draft again.',409);
    const record={schema:ADJUSTMENT_SCHEMA,...preview.request,requestSha256:hash(json(preview.request)),previewSha256,
      source:detail.source,original:detail.event,originalProof:detail.originalProof,originalProofFile:detail.originalProofFile,refundTerms:detail.refundTerms,
      status:request.kind==='CANCELLATION'?'RECORDED':'REQUESTED',verification:null,
      history:[{at:now(),action:'RECORDED',actor:request.actor}]};
    const root=join(this.workspace.directory,'adjustments'),directory=join(root,record.id);await privateDirectory(root);await privateDirectory(directory);
    const frozen={schema:record.schema,...adjustmentRequest(record),source:record.source,original:record.original,
      originalProof:record.originalProof,originalProofFile:record.originalProofFile,refundTerms:record.refundTerms};
    record.requestFile={path:'adjustments/'+record.id+'/request.json',...await writeExact(join(directory,'request.json'),json(frozen))};
    this.workspace.state.adjustments.unshift(record);await this.workspace.commit('merchant_adjustment_recorded',record.actor,
      {adjustmentId:record.id,eventId:record.eventId,kind:record.kind,amountAtomic:record.amountAtomic,effectiveAt:record.effectiveAt});
    return {adjustment:copy(record),duplicate:false,state:this.workspace.view()};
  });}
  async verify(id,value){await this.recoverSavedResults(id);return this.workspace.serial(async()=>{
    this.accepting();const record=this.row(id),actor=adjustmentText(value.actor,'operator',1000),transaction=value.transaction;
    need(Object.keys(value).every(key=>['revision','actor','transaction','rpcEndpoint'].includes(key)),'INVALID_REFUND_VERIFICATION','Only the selected transaction, endpoint and operator fields are accepted.');
    need(record.kind==='REFUND'&&record.status!=='WITHDRAWN','REFUND_REQUEST_REQUIRED','Choose an active retained refund request.',409);
    need(SHA.test(transaction??''),'INVALID_REFUND_TRANSACTION','Supply the already submitted refund’s 64-character lowercase transaction hash.');
    const endpoint=resolveRpcEndpoint(record.refundTerms.network,value.rpcEndpoint,{allowLocal:this.options.allowLocalRpc===true});
    const previous=jobs(this.workspace).find(job=>job.adjustmentId===id&&job.transaction===transaction&&job.rpcEndpoint===endpoint&&
      (ACTIVE.has(job.status)||job.status==='COMPLETED'));
    if(previous)return {adjustment:copy(record),job:copy(previous),duplicate:true,state:this.workspace.view()};
    this.workspace.expected(value.revision);
    need(record.status!=='VERIFIED','REFUND_ALREADY_VERIFIED','The retained refund already has its independently verified transfer.',409);
    need(record.status!=='VERIFYING','REFUND_VERIFICATION_IN_PROGRESS','This refund’s native read is already running.',409);
    need(jobs(this.workspace).filter(job=>ACTIVE.has(job.status)).length<2,'REFUND_VERIFICATION_CAPACITY','Two native refund reads are running. Their saved jobs remain visible.',429);
    need(jobs(this.workspace).length<20_000,'ADJUSTMENT_JOB_LIMIT','This workspace already retains 20,000 verification attempts.');
    need(hash(transaction)!==record.original.transactionFingerprint,'REFUND_REUSES_ORIGINAL_PAYMENT','Use the separate reverse-transfer transaction.');
    const reused=records(this.workspace).find(item=>item.id!==id&&item.verification?.transaction===transaction&&item.original.network===record.original.network);
    need(!reused,'REFUND_TRANSACTION_ALREADY_ASSIGNED','This network transaction already belongs to another verified refund.',409);
    need(!jobs(this.workspace).some(job=>ACTIVE.has(job.status)&&job.transaction===transaction&&this.row(job.adjustmentId).original.network===record.original.network),
      'REFUND_TRANSACTION_IN_PROGRESS','This transaction is already being verified for a retained refund.',409);
    await this.assertRequestFile(record);
    const detail=await this.event(record.runId,record.eventId);
    need(JSON.stringify(detail.refundTerms)===JSON.stringify(record.refundTerms),'REFUND_TERMS_CHANGED','The original reverse-transfer terms changed.',409);
    const job={id:randomUUID(),adjustmentId:id,transaction,rpcEndpoint:endpoint,actor,status:'QUEUED',createdAt:now(),startedAt:null,completedAt:null,error:null};
    record.status='VERIFYING';record.history.push({at:now(),action:'VERIFICATION_REQUESTED',actor,jobId:job.id,transaction});
    this.workspace.state.adjustmentJobs.unshift(job);await this.workspace.commit('refund_verification_queued',actor,{adjustmentId:id,jobId:job.id,transaction});
    const task=new Promise(resolve=>setImmediate(resolve)).then(()=>this.execute(job.id));
    this.promises.set(job.id,task);this.workspace.tasks.add(task);
    task.finally(()=>{this.promises.delete(job.id);this.workspace.tasks.delete(task);}).catch(()=>{});
    return {adjustment:copy(record),job:copy(job),duplicate:false,state:this.workspace.view()};
  });}
  async execute(id){
    const controller=new AbortController();this.controllers.set(id,controller);
    try{
      await this.workspace.serial(async()=>{if(this.workspace.closing)controller.abort();controller.signal.throwIfAborted();
        const job=this.job(id);job.status='RUNNING';job.startedAt=now();await this.workspace.commit('refund_verification_started',job.actor,{jobId:id,adjustmentId:job.adjustmentId});});
      const job=copy(this.job(id)),record=copy(this.row(job.adjustmentId)),terms=record.refundTerms;
      let fetchImpl=this.options.fetchImpl;
      if(!fetchImpl){const request=createPublicHttpsFetch({trustedProxy:this.options.httpsProxyEnv===undefined?null:
        {mode:'explicit-connect',origin:new URL(job.rpcEndpoint).origin,proxyEnv:this.options.httpsProxyEnv}});
        fetchImpl=(url,options)=>request(url,{...options,redirect:'manual'});}
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(60_000)]);
      const proof=await reconcileMerchantRefund({refundId:record.id,network:terms.network,asset:terms.asset,payer:terms.from,recipient:terms.to,
        atomicAmount:record.amountAtomic,transaction:job.transaction,rpcEndpoint:job.rpcEndpoint,fetchImpl,
        decodeContractEvent:this.options.decodeContractEvent??await createOfficialEventDecoder(),signal});
      signal.throwIfAborted();const official=validateRefundProof(proof,record,{allowLocal:this.options.allowLocalRpc===true});
      const directory=join(this.workspace.directory,'adjustments',record.id),path='adjustments/'+record.id+'/'+id+'.proof.json';
      const file=await writeExact(join(directory,id+'.proof.json'),json(proof));
      await this.workspace.serial(async()=>{
        const current=this.row(record.id),currentJob=this.job(id);
        need(current.status==='VERIFYING','REFUND_STATE_CHANGED','The saved refund changed during its native verification.',409);
        this.applyVerification(currentJob,proof,{path,...file},{official});
        await this.workspace.commit(official?'merchant_refund_verified':'merchant_refund_local_read',currentJob.actor,
          {adjustmentId:record.id,jobId:id,transaction:proof.transaction,amountAtomic:record.amountAtomic,transferAt:proof.transferAt});
      });
    }catch(error){
      await this.workspace.serial(async()=>{const job=this.job(id),record=this.row(job.adjustmentId);
        job.status=controller.signal.aborted?'INTERRUPTED':'FAILED';job.completedAt=now();job.error=issue(error);
        if(record.status==='VERIFYING')record.status='REQUESTED';
        record.history.push({at:now(),action:'VERIFICATION_'+job.status,actor:job.actor,jobId:id,error:job.error});
        await this.workspace.commit('refund_verification_'+job.status.toLowerCase(),job.actor,{adjustmentId:record.id,jobId:id,error:job.error});
      });
    }finally{this.controllers.delete(id);}
  }
  applyVerification(job,proof,file,{official,recovered=false}){
    const record=this.row(job.adjustmentId);
    need(proof.transaction===job.transaction&&proof.rpcEndpoint===job.rpcEndpoint,
      'REFUND_JOB_PROOF_MISMATCH','The retained native result differs from its selected transaction and endpoint.',409);
    const reused=records(this.workspace).find(item=>item.id!==record.id&&item.verification?.transaction===proof.transaction&&item.original.network===proof.network);
    need(!reused,'REFUND_TRANSACTION_ALREADY_ASSIGNED','This network transaction already belongs to another verified refund.',409);
    need(record.status!=='VERIFIED'||record.verification?.transaction===proof.transaction,
      'REFUND_RESULT_CONFLICT','This request already retains another independently verified refund.',409);
    const verification={transaction:proof.transaction,ledger:proof.ledger,transferAt:proof.transferAt,verifiedAt:proof.observedAt,...file,proof};
    job.status='COMPLETED';job.completedAt=now();job.error=null;job.result={official,verification,...(recovered?{recovered:true}:{})};
    if(official){record.status='VERIFIED';record.verification=verification;}
    else if(record.status==='VERIFYING')record.status='REQUESTED';
    record.history.push({at:now(),action:recovered?'VERIFICATION_RESULT_RECOVERED':official?'REFUND_VERIFIED':'LOCAL_READ_COMPLETED',
      actor:job.actor,jobId:job.id,transaction:proof.transaction});
  }
  async recoverSavedResults(adjustmentId){
    const pending=jobs(this.workspace).filter(job=>(adjustmentId===undefined||job.adjustmentId===adjustmentId)&&
      ['FAILED','INTERRUPTED'].includes(job.status)&&!this.missingProofs.has(job.id));
    if(!pending.length)return;
    return this.workspace.serial(async()=>{
      const recovered=[];
      for(const prior of pending){const job=this.job(prior.id);if(!['FAILED','INTERRUPTED'].includes(job.status))continue;
        const record=this.row(job.adjustmentId),path='adjustments/'+record.id+'/'+job.id+'.proof.json';let bytes;
        try{bytes=await readExact(join(this.workspace.directory,path),null,200_000);}catch(error){
          if(error.code!=='ENOENT')throw error;this.missingProofs.add(job.id);continue;
        }
        await this.assertRequestFile(record);
        const proof=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),official=validateRefundProof(proof,record,{allowLocal:true});
        this.applyVerification(job,proof,{path,sha256:hash(bytes),bytes:bytes.length},{official,recovered:true});recovered.push(job.id);
      }
      if(recovered.length)await this.workspace.commit('refund_verification_results_recovered','workspace',{jobIds:recovered});
    });
  }
  async savedJob(id){const job=this.job(id);await this.recoverSavedResults(job.adjustmentId);return copy(this.job(id));}
  async waitForJob(id){this.job(id);await this.promises.get(id);return this.savedJob(id);}
  async withdraw(id,value){await this.recoverSavedResults(id);return this.workspace.serial(async()=>{
    this.accepting();const record=this.row(id),actor=adjustmentText(value.actor,'operator',1000),reason=adjustmentText(value.reason,'withdrawal reason',4000);
    need(Object.keys(value).every(key=>['revision','actor','reason'].includes(key)),'INVALID_ADJUSTMENT_WITHDRAWAL','Use the original request, operator and withdrawal reason.');
    if(record.status==='WITHDRAWN'){const previous=record.history.at(-1);need(previous.actor===actor&&previous.reason===reason,'ADJUSTMENT_WITHDRAWAL_CONFLICT','This request already has its retained withdrawal.',409);
      return {adjustment:copy(record),duplicate:true,state:this.workspace.view()};}
    this.workspace.expected(value.revision);need(record.kind==='REFUND'&&record.status==='REQUESTED','REFUND_REQUEST_REQUIRED','Choose an unverified refund request after its current read has finished.',409);
    await this.assertRequestFile(record);record.status='WITHDRAWN';record.history.push({at:now(),action:'WITHDRAWN',actor,reason});
    await this.workspace.commit('refund_request_withdrawn',actor,{adjustmentId:id,eventId:record.eventId,reason});
    return {adjustment:copy(record),duplicate:false,state:this.workspace.view()};
  });}
  async assertRequestFile(record){
    const expected=record.requestFile;need(expected?.path==='adjustments/'+record.id+'/request.json','ADJUSTMENT_SOURCE_CHANGED','The original adjustment source path changed.',409);
    const bytes=await readExact(join(this.workspace.directory,expected.path),expected,1_000_000),source=JSON.parse(bytes.toString('utf8'));
    const expectedSource={schema:record.schema,...adjustmentRequest(record),source:record.source,original:record.original,
      originalProof:record.originalProof,originalProofFile:record.originalProofFile,refundTerms:record.refundTerms};
    need(JSON.stringify(source)===JSON.stringify(expectedSource),'ADJUSTMENT_SOURCE_CHANGED','The retained adjustment no longer matches its original selected payment.',409);
    if(record.verification){const verification=record.verification;
      need(typeof verification.path==='string'&&verification.path.startsWith('adjustments/'+record.id+'/')&&
        /^[a-f0-9-]{36}\.proof\.json$/.test(verification.path.split('/').at(-1))&&verification.path.split('/').length===3,
        'ADJUSTMENT_SOURCE_CHANGED','The retained refund proof path changed.',409);
      const bytes=await readExact(join(this.workspace.directory,verification.path),verification,200_000),proof=JSON.parse(bytes.toString('utf8'));
      need(JSON.stringify(proof)===JSON.stringify(verification.proof)&&verification.transaction===proof.transaction&&verification.ledger===proof.ledger&&
        verification.transferAt===proof.transferAt&&verification.verifiedAt===proof.observedAt,
        'ADJUSTMENT_SOURCE_CHANGED','The refund result differs from its retained native source.',409);
    }
  }
  async snapshot(runId){
    const workspace=this.workspace,run=workspace.runRow(runId),report=await workspace.report(runId),selected=new Set(report.ledger.map(adjustmentEventKey));
    const revision=workspace.state.revision,current=copy(records(workspace).filter(record=>selected.has(adjustmentEventKey(record.original))));
    const ids=new Set(current.map(record=>record.id)),savedJobs=copy(jobs(workspace).filter(job=>ids.has(job.adjustmentId)));
    for(const record of current)await this.assertRequestFile(record);
    need(workspace.state.revision===revision,'STALE_WORKSPACE','The workspace changed while its adjustment snapshot was read. Refresh the selected original payment.',409);
    const exported=compileAdjustmentExport({report,source:{runId,reportSha256:run.reportSha256,manifestSha256:run.manifestSha256,
      inputManifestSha256:run.inputManifestSha256},records:current,workspaceRevision:revision});
    exported.jobs=savedJobs;
    return exported;
  }
  async export({runId,format='json'}={}){
    need(['json','csv','html'].includes(format),'INVALID_ADJUSTMENT_EXPORT','Choose JSON, CSV or HTML.');
    const value=await this.snapshot(runId),bytes=format==='json'?json(value):format==='csv'?renderAdjustmentCsv(value):renderAdjustmentHtml(value);
    const types={json:'application/json; charset=utf-8',csv:'text/csv; charset=utf-8',html:'text/html; charset=utf-8'};
    return {bytes,name:'merchant-adjustments-'+runId+'.'+format,type:types[format]};
  }
  close(){for(const controller of this.controllers.values())controller.abort();}
}

export async function handleAdjustmentRequest(controller,{method,path,query={},value}){
  const parts=path.split('/').filter(Boolean);if(parts[0]!=='api'||parts[1]!=='adjustments')return null;
  if(parts.length===2&&method==='GET')return {value:controller.view()};
  if(parts.length===4&&parts[2]==='jobs'&&method==='GET')return {value:await controller.savedJob(parts[3])};
  if(parts.length===3){
    if(parts[2]==='events'&&method==='GET')return {value:await controller.events(query)};
    if(parts[2]==='event'&&method==='GET')return {value:await controller.event(query.runId,query.eventId)};
    if(parts[2]==='preview'&&method==='POST')return {value:await controller.preview(value)};
    if(parts[2]==='record'&&method==='POST')return {value:await controller.record(value)};
    if(parts[2]==='export'&&method==='GET')return {file:await controller.export(query)};
    if(method==='GET')return {value:await controller.detail(parts[2])};
  }
  if(parts.length===4&&method==='POST'){
    if(parts[3]==='verify')return {value:await controller.verify(parts[2],value)};
    if(parts[3]==='withdraw')return {value:await controller.withdraw(parts[2],value)};
  }
  need(false,'NOT_FOUND','This merchant adjustment operation was not found.',404);
}
