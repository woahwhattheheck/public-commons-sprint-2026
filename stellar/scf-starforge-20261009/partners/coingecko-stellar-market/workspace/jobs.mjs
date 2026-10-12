// MIT. Async unsigned observations and the original SF88 single-attempt inbox.
import {mkdir,readFile,open,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fork} from 'node:child_process';
import {need,plain,text,id,uuid,now,jsonBytes,sha,LIMITS,errorView,clone} from '../common.mjs';
import {normalizeRequest} from '../contracts.mjs';
import {readResponseBytes} from '../provider.mjs';
import {retainCapture} from './capture.mjs';

const attempted=item=>item.originalQueue?.attempt!=null;
const terminalItem=item=>['completed','failed','cancelled','interrupted'].includes(item.status);
const nativeError=q=>q?.lastError??q?.outcome?.error??q?.outcome?.evidenceError??null;
function nativeBinding(item,original){
  need(plain(original)&&original.operation?.intentId===item.intentId,'NATIVE_INTENT_MISMATCH',
    'The original inbox record must belong to this exact retained intent');
  need(original.sourceConfigSha256===sha(jsonBytes(item.nativeConfiguration)),'NATIVE_CONFIG_CHANGED',
    'The original inbox source configuration differs from this retained operation');
  need(original.responseDestination===(item.nativeConfiguration.responseFile?.destination??null),
    'NATIVE_RESPONSE_DESTINATION_CHANGED');
  const previous=item.originalQueue;
  if(previous){
    need(['configSha256','sourceConfigSha256','bodySha256','bodyBytes','responseDestination','evidencePath']
      .every(key=>previous[key]===original[key])&&
      (previous.operationTicket?.sha256??null)===(original.operationTicket?.sha256??null)&&
      JSON.stringify(previous.dependencies)===JSON.stringify(original.dependencies),
      'NATIVE_INTAKE_BINDING_CHANGED','The original configuration, request body, ticket or dependencies changed');
    if(previous.attempt)need(previous.attempt.id===original.attempt?.id&&
      previous.attempt.kind===original.attempt?.kind,'NATIVE_ATTEMPT_CHANGED');
    if(previous.outcome)need(JSON.stringify(previous.outcome)===JSON.stringify(original.outcome),
      'NATIVE_OUTCOME_CHANGED','The original completed outcome is immutable');
  }
  return original;
}
async function exactPrivateFile(path,bytes){
  let handle;
  try{handle=await open(path,'wx',0o600);await handle.writeFile(bytes);await handle.sync()}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const original=await readFile(path);need(sha(original)===sha(bytes),'NATIVE_CONFIG_CHANGED','The retained native configuration differs from this exact prepared operation');
  }finally{await handle?.close()}
}
async function trustedBytes(path,maximum){
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{const info=await handle.stat();need(info.isFile()&&info.size<=maximum,'INVALID_NATIVE_FILE');const bytes=await handle.readFile();need(bytes.length<=maximum,'INVALID_NATIVE_FILE');return bytes}
  finally{await handle.close()}
}
export class MarketJobs {
  constructor(model,{fetchImpl,probeTimeoutMs=30000}={}){
    this.model=model;this.store=model.store;this.fetchImpl=fetchImpl;this.probeTimeoutMs=probeTimeoutMs;
    this.active=new Map();this.pending=new Map();this.closing=false;
    this.queueRoot=join(this.store.directory,'native-inbox');
  }
  start(){
    // A reopened job never starts another paid attempt automatically.
    this.store.transaction(()=>{
      for(const project of this.store.projects())for(const job of this.store.all('jobs',project.id)){
        if(!['running','queued'].includes(job.status))continue;
        const items=job.items.map(item=>item.status==='running'?{...item,status:'interrupted'}:item);
        this.store.put('jobs',{...job,items,status:'interrupted',interruptedAt:now(),
          errors:[...(job.errors??[]),{code:'WORKSPACE_REOPENED',message:'The retained operation was interrupted; inspect or resume its remaining work explicitly'}]});
      }
    });
    return this;
  }
  view(job){
    const native=job.kind==='checkout',historical=job.status==='archived'||job.restored===true;
    const running=this.active.has(job.id),remaining=job.items.some(item=>!item.resultCaptureId&&!attempted(item)&&
      (!native||item.status!=='completed'));
    const canRecover=native&&!historical&&!running&&job.items.some(item=>
      item.originalQueue?.attempt?.kind==='EXECUTE'&&!item.resultCaptureId&&
      (!item.originalQueue.recovery||item.originalQueue.outcome?.responseFile?.status==='SAVED'));
    const visible=clone(job);
    visible.items=visible.items.map(({nativeConfiguration,...item})=>item);
    return{...visible,canExecute:native&&!historical&&!running&&job.status==='prepared',
      canCancel:!historical&&(running||['prepared','queued'].includes(job.status)||remaining&&job.status==='partial'),
      canResume:!historical&&!running&&['partial','failed','cancelled','interrupted'].includes(job.status)&&remaining,
      canRecover};
  }
  validateAction(job,action){
    const flag={execute:'canExecute',cancel:'canCancel',resume:'canResume',recover:'canRecover'}[action];
    need(flag&&this.view(job)[flag],'JOB_ACTION_UNAVAILABLE','This original job does not currently permit '+action,409);
  }
  async profile(profileId){
    const selected=this.model.profiles.find(p=>p.id===profileId);need(selected,'BUYER_PROFILE_NOT_FOUND','Select a configured native buyer profile');
    need(typeof selected.configPath==='string'||typeof selected.workspacePath==='string','BUYER_PROFILE_UNCONFIGURED');
    const [{config},{workspaceConfiguration}]=await Promise.all([
      import('../../../sf88-operator-buyer-cli/config.mjs'),import('../../../sf88-operator-buyer-cli/queue.mjs')
    ]);
    const cfg=selected.configPath?await config(resolve(selected.configPath)):
      (await workspaceConfiguration(resolve(selected.workspacePath))).configuration;
    return{selected,cfg};
  }
  async prepareCheckout(collection,body){
    const selectedId=body.buyerProfileId??this.store.project(collection.projectId).config.buyerProfileId;
    const{selected,cfg}=await this.profile(selectedId);
    need(Array.isArray(body.selections)&&body.selections.length>=1&&body.selections.length<=256,'INVALID_CHECKOUT_SELECTION');
    const byId=new Map();for(const s of body.selections){need(plain(s)&&!byId.has(s.requestId),'DUPLICATE_CHECKOUT_REQUEST');byId.set(s.requestId,s)}
    need([...byId.keys()].every(requestId=>collection.requestIds.includes(requestId)),'REQUEST_OUTSIDE_COLLECTION');
    const {prepareReview}=await import('../../../sf88-operator-buyer-cli/prepare.mjs');
    const {workspaceConfiguration}=await import('../../../sf88-operator-buyer-cli/queue.mjs');
    const jobId=uuid(),items=[];
    for(const requestId of collection.requestIds){
      if(!byId.has(requestId))continue;
      const selection=byId.get(requestId),saved=this.store.owned('requests',requestId,collection.projectId);
      const request={...saved,...normalizeRequest(saved,this.model.requestConfig(collection.projectId))};
      const capture=this.store.owned('captures',selection.captureId,collection.projectId);
      need(request.enabled&&request.urls.merchant,'MERCHANT_REQUEST_REQUIRED');
      need(capture.kind==='challenge'&&capture.challengeFileId&&capture.requestId===requestId&&
        capture.requestVersion===saved.version&&capture.requestUrl===request.urls.merchant,
        'CURRENT_MERCHANT_CHALLENGE_REQUIRED','Select the unchanged request’s exact merchant challenge');
      const raw=this.store.fileBytes(capture.challengeFileId),original=JSON.parse(raw.toString('utf8'));
      // SF31 binds the exact advertised URL. Do not relax it to the provider’s
      // query-less public vendor challenge during this independent integration.
      const advertised=typeof original.resource==='string'?original.resource:original.resource?.url;
      need(advertised===capture.requestUrl,'NATIVE_EXACT_RESOURCE_REQUIRED',
        'The original Stellar buyer requires the challenge’s complete resource URL to match this exact request');
      const itemId=uuid(),intentId='gecko-'+jobId+'-'+itemId.slice(0,8);
      const responseOut=join(this.store.directory,'native-jobs',jobId,itemId,'response.bin');
      const catalog=Buffer.concat([Buffer.from('{"resources":['),raw,Buffer.from(']}')]);
      const prepared=prepareReview(catalog,{rowIndex:0,acceptIndex:selection.acceptIndex,intentId,
        url:capture.requestUrl,method:'GET',responseOut});
      let nativeConfiguration={...clone(cfg),...prepared.draft,
        responseFile:{...prepared.draft.responseFile,maxBytes:LIMITS.responseBytes},
        requestTimeoutMs:cfg.requestTimeoutMs??30000};
      if(selected.workspacePath)nativeConfiguration=(await workspaceConfiguration(resolve(selected.workspacePath),
        {configuration:nativeConfiguration})).configuration;
      need(selected.network===undefined||selected.network===nativeConfiguration.operation.expect.network,'BUYER_PROFILE_NETWORK_MISMATCH');
      items.push({id:itemId,requestId,requestVersion:saved.version,request,requestUrl:capture.requestUrl,
        captureId:capture.id,acceptIndex:selection.acceptIndex,terms:clone(original.accepts[selection.acceptIndex]),intentId,
        preparedReview:{operation:prepared.draft.operation,configSha256:prepared.configSha256,
          discoveryFileSha256:prepared.draft.preparedFrom.discoveryFileSha256,responseFile:prepared.draft.responseFile},
        nativeConfiguration,workspacePath:selected.workspacePath?resolve(selected.workspacePath):null,
        status:'queued',attempts:[],originalQueue:null});
    }
    return{id:jobId,buyerProfileId:selectedId,items};
  }
  schedule(jobId,action){
    if(this.closing)return;
    if(action==='cancel'&&this.active.has(jobId)){this.active.get(jobId).controller.abort(new Error('OPERATOR_CANCELLED'));return}
    if(this.active.has(jobId)||this.pending.has(jobId))return;
    const timer=setTimeout(()=>{
      this.pending.delete(jobId);
      const job=this.store.get('jobs',jobId);
      if(action!=='cancel'&&job.status!=='queued')return;
      if(action==='cancel'&&job.status==='cancelled')return;
      const controller=new AbortController();
      const promise=this.run(jobId,action,controller).catch(error=>{
        try{this.failJob(jobId,error)}catch(retentionError){
          process.stderr.write(JSON.stringify({event:'JOB_STATUS_WRITE_FAILED',jobId,error:retentionError.code??'STATE_UNAVAILABLE'})+'\n');
        }
      }).finally(()=>this.active.delete(jobId));
      this.active.set(jobId,{controller,promise});
    },0);
    this.pending.set(jobId,timer);
  }
  update(jobId,fn,{history=false}={}){
    return this.store.transaction(()=>{
      const current=this.store.get('jobs',jobId),next=fn(current);
      next.completed=next.items.filter(terminalItem).length;
      return this.store.put('jobs',next,{history});
    });
  }
  updateItem(jobId,itemId,fn){
    return this.update(jobId,job=>({...job,items:job.items.map(item=>item.id===itemId?fn(item):item)}));
  }
  async unsignedFetch(url,signal){
    if(this.fetchImpl)return this.fetchImpl(url,{method:'GET',headers:{Accept:'application/json'},redirect:'manual',signal});
    const{createPublicHttpsFetch}=await import('../../../sf31-buyer-client/public-transport.mjs');
    return createPublicHttpsFetch({timeoutMs:this.probeTimeoutMs})(url,
      {method:'GET',headers:{Accept:'application/json'},redirect:'manual',signal});
  }
  async probeItem(jobId,item,signal){
    const attempt={id:uuid(),startedAt:now(),status:'running'};
    this.updateItem(jobId,item.id,current=>({...current,status:'running',startedAt:attempt.startedAt,
      attempts:[...(current.attempts??[]),attempt],error:null}));
    let response=null,headers=null;
    try{
      response=await this.unsignedFetch(item.requestUrl,signal);
      headers=Object.fromEntries(response.headers.entries());
      const bytes=await readResponseBytes(response,{signal});
      const observedAt=now();
      this.store.transaction(()=>{
        const job=this.store.get('jobs',jobId),current=job.items.find(i=>i.id===item.id);
        const capture=retainCapture(this.store,{projectId:job.projectId,request:item.request,name:job.name+' — '+item.request.name,
          basis:'native_unsigned',httpStatus:response.status,requestUrl:item.requestUrl,observedAt,body:bytes,headers});
        const replacement={...current,status:'completed',resultCaptureId:capture.id,completedAt:observedAt,error:null,
          attempts:current.attempts.map(a=>a.id===attempt.id?{...a,status:'completed',httpStatus:response.status,completedAt:observedAt,captureId:capture.id}:a)};
        const items=job.items.map(i=>i.id===item.id?replacement:i);
        this.store.put('jobs',{...job,items,completed:items.filter(terminalItem).length},{history:false});
        this.store.event(job.projectId,'native-probe','source.observed',capture.id,{jobId,requestId:item.requestId,httpStatus:response.status});
      });
    }catch(error){
      const status=signal.aborted?'cancelled':'failed',detail=errorView(error);
      let responseCaptureId=null;
      if(response&&headers)this.store.transaction(()=>{
        const job=this.store.get('jobs',jobId);
        responseCaptureId=retainCapture(this.store,{projectId:job.projectId,request:item.request,
          name:job.name+' — '+item.request.name,basis:'native_unsigned',httpStatus:response.status,
          requestUrl:item.requestUrl,headers,body:null,transportError:detail}).id;
      });
      this.updateItem(jobId,item.id,current=>({...current,status,error:detail,completedAt:now(),
        ...(responseCaptureId?{resultCaptureId:responseCaptureId}:{}),
        attempts:current.attempts.map(a=>a.id===attempt.id?{...a,status,error:detail,completedAt:now()}:a)}));
    }
  }
  async inspectNativeItem(item,{allowMissing=false}={}){
    try{
      const{openQueue}=await import('../../../sf88-operator-buyer-cli/queue.mjs');
      const queue=await openQueue(this.queueRoot);
      return nativeBinding(item,await queue.show(item.intentId));
    }catch(error){
      // A known published record may never be replaced after storage loss.
      if(error.code==='ENOENT'&&allowMissing&&!item.originalQueue)return null;
      throw error;
    }
  }
  async nativeWorker(jobId,item,mode,signal){
    const directory=join(this.store.directory,'native-jobs',jobId,item.id);
    await mkdir(directory,{recursive:true,mode:0o700});
    const configPath=join(directory,'configuration.json');
    await exactPrivateFile(configPath,jsonBytes(item.nativeConfiguration));
    const existing=await this.inspectNativeItem(item,{allowMissing:true});
    // Reopening an attempted intent receives its original outcome. It never
    // re-enqueues current body/ticket files or starts another paid attempt.
    if(existing?.attempt&&(mode!=='recover'||existing.attempt.kind!=='EXECUTE'||
      existing.recovery||existing.outcome?.responseFile?.status==='SAVED')){
      return{value:existing,error:null,mode,process:null,reception:{
        basis:'original_inbox_read',observedAt:now(),workerResultReceived:false}};
    }
    const args=[mode,this.queueRoot,item.intentId,configPath,item.workspacePath??'-'];
    return new Promise((resolvePromise,reject)=>{
      const child=fork(fileURLToPath(new URL('./native-worker.mjs',import.meta.url)),args,
        {stdio:['ignore','pipe','pipe','ipc'],serialization:'json'});
      let result=null,stderr='',stdout='',sentAbort=false;
      const cancel=()=>{if(!sentAbort&&child.connected){sentAbort=true;child.send({type:'cancel'})}};
      const cleanup=()=>signal?.removeEventListener('abort',cancel);
      signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
      child.stdout.on('data',data=>{if(stdout.length<65536)stdout+=String(data).slice(0,65536-stdout.length)});
      child.stderr.on('data',data=>{if(stderr.length<65536)stderr+=String(data).slice(0,65536-stderr.length)});
      child.on('message',message=>{
        if(message?.type==='queue')this.updateItem(jobId,item.id,current=>({...current,originalQueue:message.value}));
        if(message?.type==='result')result=message;
      });
      child.once('error',error=>{
        cleanup();error.nativeExit={exitCode:null,signal:null,stderr,stdout,spawnError:errorView(error)};reject(error);
      });
      child.once('exit',async(code,exitSignal)=>{
        cleanup();
        const processResult={exitCode:code,signal:exitSignal,stderr,stdout};
        if(result){
          resolvePromise({...result,mode,process:processResult,reception:{
            basis:'worker_result',observedAt:now(),workerResultReceived:true}});
          return;
        }
        const interruption={code:'NATIVE_WORKER_INTERRUPTED',
          message:'Native worker exited before returning its original queue state'};
        try{
          // The child has ended. Read the original durable inbox, without any
          // new native operation, before deciding that its result was lost.
          const original=await this.inspectNativeItem(item);
          const observedTerminal=original.state==='CANCELLED'||original.outcome||
            original.lastError||original.recovery;
          resolvePromise({value:original,mode,process:processResult,
            error:observedTerminal||mode==='prepare'&&original.state==='QUEUED'?null:interruption,
            reception:{basis:'original_inbox_after_worker_exit',observedAt:now(),
              workerResultReceived:false,interruption}});
        }catch(observationError){
          const error=new Error(interruption.message);error.code=interruption.code;
          error.nativeExit=processResult;error.observationError=errorView(observationError);reject(error);
        }
      });
    });
  }
  async nativeFiles(queue){
    const files=[],directory=join(this.queueRoot,'jobs',sha(Buffer.from(queue.operation.intentId)));
    for(const name of ['request.json','source-config.json','execution.json','operation-ticket.json',
      'attempt.json','terminal.json','recovery.json','finalization.json']){
      try{files.push({name,mimeType:'application/json',bytes:await trustedBytes(join(directory,name),2*1024*1024)})}
      catch(error){if(error.code!=='ENOENT')throw error}
    }
    if(queue.bodySha256!==null&&queue.bodySha256!==undefined){
      const{MAX_REQUEST_BODY_BYTES}=await import('../../../sf88-operator-buyer-cli/request-body.mjs');
      const bytes=await trustedBytes(join(directory,'request-body.bin'),MAX_REQUEST_BODY_BYTES);
      need(bytes.length===queue.bodyBytes&&sha(bytes)===queue.bodySha256,'ORIGINAL_REQUEST_BODY_HASH_MISMATCH');
      files.push({name:'request-body.bin',mimeType:'application/octet-stream',bytes});
    }
    if(queue.evidencePath)try{files.push({name:'original-checkout-evidence.json',mimeType:'application/json',
      bytes:await trustedBytes(queue.evidencePath,2*1024*1024)})}
      catch(error){if(error.code!=='ENOENT')throw error}
    return files;
  }
  async acceptNativeResult(jobId,itemId,result){
    const before=this.store.get('jobs',jobId),selected=before.items.find(item=>item.id===itemId);
    need(selected,'NATIVE_ITEM_NOT_FOUND');
    const original=result.value==null?null:nativeBinding(selected,result.value);
    const retained=original?await this.nativeFiles(original):[];
    let responseBytes=null,delivery=original?.outcome?.responseFile;
    if(delivery?.status==='SAVED'){
      need(typeof delivery.destination==='string'&&typeof delivery.sha256==='string'&&Number.isSafeInteger(delivery.bytes),'ORIGINAL_DOWNLOAD_SUMMARY_REQUIRED');
      need(delivery.destination===original.responseDestination,'NATIVE_RESPONSE_DESTINATION_CHANGED');
      responseBytes=await trustedBytes(delivery.destination,LIMITS.responseBytes);
      need(sha(responseBytes)===delivery.sha256&&responseBytes.length===delivery.bytes,'ORIGINAL_DOWNLOAD_HASH_MISMATCH');
    }
    return this.store.transaction(()=>{
      const job=this.store.get('jobs',jobId),item=job.items.find(i=>i.id===itemId);
      const nativeSourceFiles=retained.map(source=>this.store.file(job.projectId,
        item.intentId+' — '+source.name,source.mimeType,source.bytes));
      let captureId=item.resultCaptureId;
      if(responseBytes&&captureId){
        const saved=this.store.owned('captures',captureId,job.projectId);
        need(saved.originalQueue?.operation?.intentId===item.intentId&&
          saved.rawBodyReference?.sha256===delivery.sha256&&saved.rawBodyReference?.bytes===delivery.bytes,
          'ORIGINAL_CAPTURE_CHANGED','The saved response capture differs from its original delivery');
      }
      if(responseBytes&&!captureId){
        const capture=retainCapture(this.store,{projectId:job.projectId,request:item.request,name:job.name+' — '+item.request.name,
          basis:'native_buyer',httpStatus:original.outcome.httpStatus,requestUrl:item.requestUrl,
          observedAt:original.recovery?.observedAt??original.attempt?.startedAt??now(),
          body:responseBytes,headers:{'content-type':delivery.contentType??'application/json'},
          originalOutcome:original.outcome,originalQueue:original});
        captureId=capture.id;
      }
      const error=result.error??nativeError(original);
      const status=original?.state==='CANCELLED'?'cancelled':captureId?'completed':
        original?.outcome||original?.lastError?'failed':original?.attempt?'interrupted':error?'failed':'queued';
      const reception={id:uuid(),mode:result.mode??null,
        basis:result.reception?.basis??'worker_result',observedAt:result.reception?.observedAt??now(),
        workerResultReceived:result.reception?.workerResultReceived??true,
        process:result.process??null,interruption:result.reception?.interruption??null,
        state:original?.state??null,configSha256:original?.configSha256??null,
        sourceConfigSha256:original?.sourceConfigSha256??null,error};
      const replacement={...item,originalQueue:original??item.originalQueue,status,
        ...(captureId?{resultCaptureId:captureId}:{}),nativeSourceFileIds:[...(item.nativeSourceFileIds??[]),...nativeSourceFiles.map(f=>f.id)],
        nativeReceptions:[...(item.nativeReceptions??[]),reception],nativeReceptionId:reception.id,
        error,workerProcess:result.process??item.workerProcess??null,completedAt:terminalItem({status})?now():null};
      const items=job.items.map(i=>i.id===itemId?replacement:i);
      const updated=this.store.put('jobs',{...job,items,completed:items.filter(terminalItem).length},{history:false});
      this.store.event(job.projectId,'original-sf88','native.queue.observed',job.id,{intentId:item.intentId,
        state:original?.state??null,responseCaptureId:captureId??null,workerExit:result.process?.exitCode??null,
        receptionId:reception.id,receptionBasis:reception.basis});
      return updated;
    });
  }
  async run(jobId,action,controller){
    const job=this.store.get('jobs',jobId);
    const preparing=job.kind==='checkout'&&(action==='prepare'||action==='resume'&&!job.purchaseStarted);
    const nativeMode=action==='recover'?'recover':preparing?'prepare':'execute';
    this.update(jobId,current=>({...current,status:'running',phase:preparing?'intake':action,
      purchaseStarted:current.purchaseStarted||(job.kind==='checkout'&&nativeMode==='execute'&&action!=='cancel'),
      startedAt:current.startedAt??now(),lastStartedAt:now()}));
    for(const originalItem of job.items){
      if(action==='cancel'||controller.signal.aborted||this.store.get('jobs',jobId).cancelRequested){
        if(action!=='cancel')controller.abort(new Error('OPERATOR_CANCELLED'));break;
      }
      const item=this.store.get('jobs',jobId).items.find(i=>i.id===originalItem.id);
      if(job.kind==='probe'){
        if(!item.resultCaptureId)await this.probeItem(jobId,item,controller.signal);
        continue;
      }
      if(nativeMode==='recover'){
        if(item.originalQueue?.attempt?.kind!=='EXECUTE')continue;
      }else if(nativeMode==='prepare'){
        if(item.resultCaptureId||item.originalQueue?.state==='QUEUED'&&item.status==='queued'&&!item.error)continue;
      }else if(item.resultCaptureId)continue;
      this.updateItem(jobId,item.id,current=>({...current,status:'running',startedAt:current.startedAt??now(),error:null}));
      try{
        const result=await this.nativeWorker(jobId,item,nativeMode,controller.signal);
        await this.acceptNativeResult(jobId,item.id,result);
      }catch(error){
        this.updateItem(jobId,item.id,current=>({...current,status:controller.signal.aborted?'interrupted':'failed',
          error:errorView(error),workerProcess:error.nativeExit??current.workerProcess,completedAt:now()}));
      }
    }
    const cancelled=controller.signal.aborted||this.store.get('jobs',jobId).cancelRequested||action==='cancel';
    if(cancelled&&job.kind==='checkout'){
      for(const item of this.store.get('jobs',jobId).items){
        if(attempted(item)||item.resultCaptureId)continue;
        try{await this.acceptNativeResult(jobId,item.id,await this.nativeWorker(jobId,item,'cancel',controller.signal))}
        catch(error){this.updateItem(jobId,item.id,current=>({...current,status:'cancelled',error:errorView(error),completedAt:now()}))}
      }
    }
    this.update(jobId,current=>{
      const items=current.items.map(item=>cancelled&&!attempted(item)&&!item.resultCaptureId&&item.status==='queued'?
        {...item,status:'cancelled',completedAt:now()}:item);
      const errors=items.filter(item=>item.error).map(item=>({itemId:item.id,intentId:item.intentId??null,...item.error}));
      const successes=items.filter(item=>item.status==='completed').length;
      const prepared=preparing&&!cancelled&&!errors.length&&items.every(item=>item.originalQueue?.state==='QUEUED');
      const unfinished=items.some(item=>!['completed','cancelled'].includes(item.status));
      return{...current,items,errors,status:prepared?'prepared':cancelled?'cancelled':errors.length||unfinished?
        (successes?'partial':'failed'):'completed',completedAt:prepared?null:now(),phase:prepared?'review':preparing?'intake_failed':'retained'};
    },{history:true});
  }
  failJob(jobId,error){
    if(this.closing)return;
    this.update(jobId,current=>({...current,status:'failed',completedAt:now(),
      errors:[...(current.errors??[]),errorView(error)]}),{history:true});
  }
  async close(){
    this.closing=true;for(const timer of this.pending.values())clearTimeout(timer);this.pending.clear();
    for(const active of this.active.values())active.controller.abort(new Error('WORKSPACE_CLOSING'));
    await Promise.allSettled([...this.active.values()].map(active=>active.promise));
  }
}
