// MIT. Resolution coordinates existing jobs and adjustments; those original owners execute work.
import {join} from 'node:path';
import {ADJUSTMENT_EXPORT_SCHEMA,validateAdjustment,adjustmentRequest,adjustmentInstant,adjustmentJson,adjustmentHash,summarizeAdjustments} from '../../../merchant-settlement-accounting/adjustments.mjs';
import {CASE_SCHEMA,EXPORT_SCHEMA,RESOLUTION_DOCUMENT_BYTES,RESOLUTION_RECEIVING_BYTES,SHA,UUID,need,id,text,revision,copy,now,object,hash,json,requestHash,same,
  jobBinding,bindAccounting,newCase,validateCase,publicReceipt} from './contract.mjs';
import {privateDirectory,readDocument,writeDocument,casePath} from './storage.mjs';
import {createJobAccounting,accountingOrigin} from './accounting.mjs';

const owners=new WeakMap();
const failure=e=>({code:/^[A-Z][A-Z0-9_]{0,100}$/.test(e?.code??'')?e.code:'JOB_RESOLUTION_OPERATION_FAILED'});
const terminal=new Set(['FAILED','INTERRUPTED','CANCELLED']);
const summary=row=>({id:row.id,state:row.state,revision:row.revision,nativeSettlement:row.nativeSettlement,
  error:row.error?{code:row.error.code}:null,result:row.result?{bytes:row.result.bytes,sha256:row.result.sha256}:null});

export async function openJobResolution({model:owner,drainingModel,accounting,fetchImpl=globalThis.fetch}={}){
  need(owner&&typeof owner.get==='function'&&typeof owner.snapshot==='function','JOB_RESOLUTION_MODEL_REQUIRED');
  if(owners.has(owner))return owners.get(owner);
  if(drainingModel)need(drainingModel.directory===owner.directory&&
    ['get','snapshot','customerStatus','retry','cancel'].every(key=>typeof drainingModel[key]==='function'),
    'JOB_RESOLUTION_ORIGINAL_MODEL_BORROW_REQUIRED');
  const opening=(async()=>{
    // Only the original owner creates this private facade. Its same-store
    // calls remain valid while this child drains; public admission is closed.
    const model=drainingModel??owner;
    await model.snapshot();
    const directory=await privateDirectory(join(model.directory,'resolutions'));
    const configFile=join(directory,'connection.json'),retained=await readDocument(configFile,{optional:true});
    if(retained)need(retained.schema==='stellar-forge.job-resolution-connection.v1'&&
      accountingOrigin(retained.url)===retained.url,'JOB_RESOLUTION_CONNECTION_CHANGED',409);
    let adapter=accounting?createJobAccounting({...accounting,fetchImpl}):
      retained?createJobAccounting({url:retained.url,fetchImpl}):null;
    const borrowed=Boolean(accounting?.controller),cache=new Map();
    let tail=Promise.resolve(),closing=false,closePromise;
    const serial=fn=>{
      need(!closing,'JOB_RESOLUTION_CLOSING',503);
      const task=tail.then(fn);tail=task.catch(()=>{});return task;
    };
    const requireAccounting=()=>{need(adapter,'JOB_RESOLUTION_ACCOUNTING_NOT_CONNECTED',409);return adapter;};
    async function context(jobId){
      const row=await model.get(jobId),binding=jobBinding(row);
      let value=cache.get(jobId);
      if(!value){value=await readDocument(casePath(directory,jobId),{optional:true});if(value)cache.set(jobId,value);}
      return {row,binding,value:copy(value?validateCase(value,binding):newCase(binding))};
    }
    async function save(value,action,detail={}){
      const current=await model.get(value.job.jobId);
      validateCase(value,jobBinding(current));
      value.revision++;value.updatedAt=now();
      value.history.push({at:value.updatedAt,action,...detail});
      need(value.history.length<=10000,'JOB_RESOLUTION_HISTORY_FULL',409);
      await writeDocument(casePath(directory,value.job.jobId),value);
      cache.set(value.job.jobId,copy(value));return value;
    }
    const expected=(value,number)=>need(value.revision===revision(number),'JOB_RESOLUTION_REVISION_CHANGED',409);
    function operatorView(value,row){
      return {schema:'stellar-forge.job-resolution-workspace.v1',job:summary(row),case:copy(value),
        customer:publicReceipt(value,row),connection:{connected:Boolean(adapter),origin:adapter?.origin??null,borrowed}};
    }
    const activeRecord=(value,adjustmentId)=>{
      id(adjustmentId);const record=value.accounting?.detail.adjustments.find(r=>r.id===adjustmentId);
      need(record,'JOB_RESOLUTION_ADJUSTMENT_NOT_SELECTED',404);return record;
    };
    function updateAdjustment(value,record,base){
      validateAdjustment(record);
      const previous=copy(base??value.accounting.detail);
      previous.adjustments=previous.adjustments.filter(r=>r.id!==record.id).concat(copy(record));
      previous.totals=summarizeAdjustments(previous.event,previous.adjustments);
      const checked=bindAccounting(value.job,previous,value.accounting.source);
      value.accounting={...checked,observedAt:now()};
    }
    async function refreshValue(value){
      const selected=value.accounting;need(selected,'JOB_RESOLUTION_ACCOUNTING_RUN_REQUIRED',409);
      const detail=await requireAccounting().event(selected.source.runId,selected.source.eventId);
      value.accounting={...bindAccounting(value.job,detail,selected.source),observedAt:now()};
    }
    function originalResult(value,op,result){
      if(op.kind==='RECORD_ADJUSTMENT'){
        const record=result.adjustment;
        need(record?.id===op.request.preview.request.id&&
          record.requestSha256===adjustmentHash(adjustmentJson(op.request.preview.request))&&
          record.previewSha256===op.request.preview.previewSha256,'JOB_RESOLUTION_ADJUSTMENT_RECEIPT_CHANGED',409);
        updateAdjustment(value,record,op.request.preview.detail);op.adjustmentId=record.id;
        op.result={adjustmentId:record.id,status:record.status,requestSha256:record.requestSha256};
      }else if(['VERIFY_REFUND','WITHDRAW_REFUND'].includes(op.kind)){
        const record=result.adjustment;need(record?.id===op.request.adjustmentId,'JOB_RESOLUTION_ADJUSTMENT_RECEIPT_CHANGED',409);
        updateAdjustment(value,record);
        if(op.kind==='VERIFY_REFUND'){
          need(result.job?.adjustmentId===record.id&&result.job?.transaction===op.request.transaction&&
            result.job?.rpcEndpoint===op.request.rpcEndpoint,'JOB_RESOLUTION_VERIFICATION_RECEIPT_CHANGED',409);
          op.nativeJobId=result.job.id;op.nativeJob=copy(result.job);
        }
        op.result={adjustmentId:record.id,status:record.status,...(op.nativeJobId?{nativeJobId:op.nativeJobId}:{})};
      }else{
        need(result?.id===value.job.jobId,'JOB_RESOLUTION_JOB_RECEIPT_CHANGED',409);
        op.result=summary(result);
      }
      op.state='RECORDED';op.completedAt=now();op.error=null;
      const decision=value.decisions.find(d=>d.id===op.id);if(decision)decision.state='RECORDED';
    }
    async function invoke(value,op){
      if(op.kind==='RECORD_ADJUSTMENT'){
        const p=op.request.preview;
        return requireAccounting().record({...p.request,revision:p.workspaceRevision,previewSha256:p.previewSha256});
      }
      if(op.kind==='VERIFY_REFUND'||op.kind==='WITHDRAW_REFUND'){
        const a=requireAccounting(),state=await a.view();need(Number.isSafeInteger(state.revision),'JOB_RESOLUTION_ACCOUNTING_REVISION_INVALID',502);
        if(op.kind==='VERIFY_REFUND')return a.verify(op.request.adjustmentId,{revision:state.revision,actor:op.request.actor,
          transaction:op.request.transaction,...(op.request.rpcEndpoint?{rpcEndpoint:op.request.rpcEndpoint}:{})});
        return a.withdraw(op.request.adjustmentId,{revision:state.revision,actor:op.request.actor,reason:op.request.reason});
      }
      return model[op.kind==='RETRY_JOB'?'retry':'cancel']({id:value.job.jobId,
        expectedRevision:op.request.expectedJobRevision,reason:op.request.marker});
    }
    async function dispatch(value,op){
      op.state='DISPATCHING';op.dispatchedAt=now();op.error=null;
      await save(value,'operation-dispatched',{operationId:op.id,kind:op.kind});
      try{originalResult(value,op,await invoke(value,op));}
      catch(error){
        op.state=Number.isInteger(error.status)&&error.status>=400&&error.status<500?'FAILED':'UNKNOWN';
        op.error=failure(error);op.completedAt=now();
        const decision=value.decisions.find(d=>d.id===op.id);if(decision)decision.state=op.state;
      }
      await save(value,'operation-returned',{operationId:op.id,state:op.state});
      return operatorView(value,await model.get(value.job.jobId));
    }
    function operation(value,operationId,kind,request,expectedRevision){
      id(operationId);
      const old=value.operations.find(op=>op.id===operationId);
      if(old){need(old.kind===kind&&old.requestSha256===requestHash(request),'JOB_RESOLUTION_REQUEST_CONFLICT',409);return {op:old,duplicate:true};}
      expected(value,expectedRevision);need(value.operations.length<1000,'JOB_RESOLUTION_OPERATION_LIMIT',409);
      const op={id:operationId,kind,request:copy(request),requestSha256:requestHash(request),state:'PREPARED',
        createdAt:now(),dispatchedAt:null,completedAt:null,result:null,error:null};
      value.operations.push(op);return {op,duplicate:false};
    }
    async function simpleMessage(jobId,input,author){
      return serial(async()=>{
        const {value,row}=await context(jobId);
        const request={id:id(input.requestId),author,text:text(input.message),issueId:input.issueId??null};
        if(request.issueId)id(request.issueId);
        const old=value.messages.find(m=>m.id===request.id);
        if(old){need(same({...old,at:undefined},{...request,at:undefined}),'JOB_RESOLUTION_REQUEST_CONFLICT',409);return author==='MERCHANT'?operatorView(value,row):publicReceipt(value,row);}
        expected(value,input.expectedRevision);
        if(request.issueId)need(value.issues.some(i=>i.id===request.issueId),'JOB_RESOLUTION_ISSUE_NOT_FOUND',404);
        need(value.messages.length<1000,'JOB_RESOLUTION_MESSAGE_LIMIT',409);
        value.messages.push({...request,at:now()});value.state='OPEN';
        await save(value,'message',{requestId:request.id,author});const current=await model.get(jobId);
        return author==='MERCHANT'?operatorView(value,current):publicReceipt(value,current);
      });
    }
    const service={
      directory,
      async status(){return serial(async()=>{await model.snapshot();return {schema:'stellar-forge.job-resolution-status.v1',
        connection:{connected:Boolean(adapter),origin:adapter?.origin??null,borrowed},closing};});},
      async connect({url}={}){
        return serial(async()=>{need(!borrowed,'JOB_RESOLUTION_BORROWED_ACCOUNTING_FIXED',409);url=accountingOrigin(url);
          const next=createJobAccounting({url,fetchImpl});await model.snapshot();
          await writeDocument(configFile,{schema:'stellar-forge.job-resolution-connection.v1',url,selectedAt:now()});
          adapter?.close();adapter=next;return {connected:true,origin:url};});
      },
      async accountingState(){return serial(async()=>{const state=await requireAccounting().state();
        return {revision:state.revision,runs:copy(state.runs??[])};});},
      async list(){
        return serial(async()=>{const snapshot=await model.snapshot(),items=[];
          for(const job of snapshot.jobs){
            if(!job.nativeSettlement)continue;
            const {value,row}=await context(job.id);
            items.push({job:summary(row),label:row.label,revision:value.revision,state:value.state,
              issueCount:value.issues.length,updatedAt:value.updatedAt,
              totals:copy(value.accounting?.detail.totals??null),needsRecovery:value.operations.filter(o=>['DISPATCHING','UNKNOWN'].includes(o.state)).map(o=>o.id)});
          }
          return {items,connection:{connected:Boolean(adapter),origin:adapter?.origin??null,borrowed}};
        });
      },
      async get(jobId){return serial(async()=>{const {value,row}=await context(jobId);return operatorView(value,row);});},
      async customer(jobId,token){
        await model.customerStatus({id:jobId,token});
        return serial(async()=>{await model.customerStatus({id:jobId,token});const {value,row}=await context(jobId);
          if(value.accounting&&adapter){const prior=copy(value.accounting);await refreshValue(value);
            if(!same(prior.detail,value.accounting.detail))await save(value,'customer-accounting-reconciled');
            else value.accounting=prior;
          }
          return publicReceipt(value,row);
        });
      },
      async issue(jobId,token,input={}){
        await model.customerStatus({id:jobId,token});
        return serial(async()=>{
          await model.customerStatus({id:jobId,token});const {value,row}=await context(jobId);
          const issue={id:id(input.requestId),message:text(input.message),requestedRemedy:input.requestedRemedy??'CONTACT'};
          need(['RETRY','REFUND','CONTACT'].includes(issue.requestedRemedy),'JOB_RESOLUTION_REMEDY_INVALID');
          const old=value.issues.find(i=>i.id===issue.id);
          if(old){need(old.message===issue.message&&old.requestedRemedy===issue.requestedRemedy,'JOB_RESOLUTION_REQUEST_CONFLICT',409);return publicReceipt(value,row);}
          expected(value,input.expectedRevision);need(value.issues.length<256,'JOB_RESOLUTION_ISSUE_LIMIT',409);
          value.issues.push({...issue,createdAt:now()});value.state='OPEN';
          await save(value,'customer-issue',{requestId:issue.id});return publicReceipt(value,await model.get(jobId));
        });
      },
      async customerMessage(jobId,token,input={}){
        await model.customerStatus({id:jobId,token});return simpleMessage(jobId,input,'CUSTOMER');
      },
      async reply(jobId,input={}){return simpleMessage(jobId,input,'MERCHANT');},
      async setCase(jobId,input={}){
        return serial(async()=>{const {value,row}=await context(jobId);
          const request={state:input.state,message:text(input.message),actor:text(input.actor,200)};
          need(['OPEN','CLOSED'].includes(request.state),'JOB_RESOLUTION_CASE_STATE_INVALID');
          const key=id(input.requestId),old=value.decisions.find(d=>d.id===key);
          if(old){need(old.requestSha256===requestHash(request),'JOB_RESOLUTION_REQUEST_CONFLICT',409);return operatorView(value,row);}
          expected(value,input.expectedRevision);value.state=request.state;
          value.decisions.push({id:key,kind:request.state==='CLOSED'?'CLOSE_CASE':'REOPEN_CASE',at:now(),message:request.message,
            actor:request.actor,requestSha256:requestHash(request),state:'RECORDED'});
          await save(value,'case-state',{requestId:key,state:value.state});return operatorView(value,await model.get(jobId));
        });
      },
      async jobAction(jobId,input={}){
        return serial(async()=>{const {value,row}=await context(jobId);
          need(['RETRY_JOB','CANCEL_JOB'].includes(input.kind),'JOB_RESOLUTION_JOB_ACTION_INVALID');
          const key=id(input.requestId),message=text(input.message,400),actor=text(input.actor,200);
          const request={expectedJobRevision:revision(input.expectedJobRevision),actor,message,
            marker:message+' [resolution:'+key+']'};
          const selected=operation(value,key,input.kind,request,input.expectedRevision);
          if(selected.duplicate)return operatorView(value,row);
          if(input.kind==='RETRY_JOB')need(terminal.has(row.state),'JOB_RETRY_NOT_AVAILABLE',409);
          need(request.expectedJobRevision===row.revision,'JOB_REVISION_CHANGED',409);
          value.decisions.push({id:key,kind:input.kind,at:now(),message,actor,state:'PREPARED'});
          await save(value,'job-decision',{requestId:key,kind:input.kind});
          return dispatch(value,selected.op);
        });
      },
      async bind(jobId,{runId,expectedRevision}={}){
        return serial(async()=>{const {value,row}=await context(jobId);expected(value,expectedRevision);
          need(UUID.test(runId??''),'JOB_RESOLUTION_ACCOUNTING_RUN_REQUIRED');
          if(value.accounting)need(value.accounting.source.runId===runId,'JOB_RESOLUTION_ACCOUNTING_RUN_ALREADY_SELECTED',409);
          value.accounting={...bindAccounting(value.job,await requireAccounting().event(runId,value.job.settlement.id),
            value.accounting?.source),observedAt:now()};
          await save(value,'accounting-selected',{runId});return operatorView(value,row);
        });
      },
      async refresh(jobId){
        return serial(async()=>{const {value}=await context(jobId);await refreshValue(value);
          for(const op of value.operations)if(op.nativeJobId){
            op.nativeJob=copy(await requireAccounting().savedJob(op.nativeJobId));
            need(op.nativeJob.adjustmentId===op.request.adjustmentId&&op.nativeJob.transaction===op.request.transaction&&
              op.nativeJob.rpcEndpoint===op.request.rpcEndpoint,'JOB_RESOLUTION_VERIFICATION_RECEIPT_CHANGED',409);
          }
          await save(value,'accounting-refreshed');return operatorView(value,await model.get(jobId));
        });
      },
      async preview(jobId,input={}){
        return serial(async()=>{const {value,row}=await context(jobId),key=id(input.requestId);
          const a=value.accounting;need(a,'JOB_RESOLUTION_ACCOUNTING_RUN_REQUIRED',409);
          const provided={kind:input.kind,amountAtomic:input.amountAtomic,effectiveAt:adjustmentInstant(input.effectiveAt),
            reason:text(input.reason),actor:text(input.actor,200),reference:text(input.reference??'',1000,{empty:true})};
          const old=value.previews.find(p=>p.id===key);
          if(old){need(old.inputSha256===requestHash(provided),'JOB_RESOLUTION_REQUEST_CONFLICT',409);return operatorView(value,row);}
          expected(value,input.expectedRevision);
          const request=adjustmentRequest({id:key,runId:a.source.runId,eventId:a.source.eventId,...provided,createdAt:now()});
          const preview=await requireAccounting().preview(request);
          need(same(preview.request,request)&&SHA.test(preview.previewSha256??'')&&Number.isSafeInteger(preview.workspaceRevision),
            'JOB_RESOLUTION_ADJUSTMENT_PREVIEW_CHANGED',409);
          bindAccounting(value.job,preview.detail,a.source);
          value.previews.push({id:key,inputSha256:requestHash(provided),createdAt:now(),preview:copy(preview)});
          await save(value,'adjustment-preview',{requestId:key});return operatorView(value,row);
        });
      },
      async record(jobId,{requestId,expectedRevision}={}){
        return serial(async()=>{const {value,row}=await context(jobId);
          const saved=value.previews.find(p=>p.id===id(requestId));need(saved,'JOB_RESOLUTION_PREVIEW_REQUIRED',409);
          const selected=operation(value,requestId,'RECORD_ADJUSTMENT',{preview:saved.preview},expectedRevision);
          if(selected.duplicate)return operatorView(value,row);
          await save(value,'adjustment-record-prepared',{requestId});return dispatch(value,selected.op);
        });
      },
      async verify(jobId,input={}){
        return serial(async()=>{const {value,row}=await context(jobId),record=activeRecord(value,input.adjustmentId);
          need(record.kind==='REFUND','JOB_RESOLUTION_REFUND_REQUEST_REQUIRED',409);
          need(SHA.test(input.transaction??''),'JOB_RESOLUTION_RETURN_TRANSACTION_REQUIRED');
          need(record.refundTerms?.network,'JOB_RESOLUTION_ORIGINAL_RETURN_TERMS_REQUIRED',409);
          const request={adjustmentId:record.id,transaction:input.transaction,actor:text(input.actor,200),
            rpcEndpoint:requireAccounting().endpoint(record.refundTerms.network,input.rpcEndpoint)};
          const selected=operation(value,input.requestId,'VERIFY_REFUND',request,input.expectedRevision);
          if(selected.duplicate)return operatorView(value,row);
          selected.op.priorNativeJobs=(record.history??[]).filter(h=>h.action==='VERIFICATION_REQUESTED').map(h=>h.jobId);
          await save(value,'refund-verification-prepared',{requestId:selected.op.id});
          return dispatch(value,selected.op);
        });
      },
      async withdraw(jobId,input={}){
        return serial(async()=>{const {value,row}=await context(jobId),record=activeRecord(value,input.adjustmentId);
          need(record.kind==='REFUND','JOB_RESOLUTION_REFUND_REQUEST_REQUIRED',409);
          const request={adjustmentId:record.id,actor:text(input.actor,200),reason:text(input.reason)};
          const selected=operation(value,input.requestId,'WITHDRAW_REFUND',request,input.expectedRevision);
          if(selected.duplicate)return operatorView(value,row);
          await save(value,'refund-withdrawal-prepared',{requestId:selected.op.id});return dispatch(value,selected.op);
        });
      },
      async recover(jobId,{requestId}={}){
        return serial(async()=>{const {value,row}=await context(jobId);
          const op=value.operations.find(o=>o.id===id(requestId));need(op,'JOB_RESOLUTION_OPERATION_NOT_FOUND',404);
          if(op.state==='RECORDED')return operatorView(value,row);
          try{
            if(op.kind==='RECORD_ADJUSTMENT'){
              const result=await requireAccounting().detail(op.request.preview.request.id);originalResult(value,op,result);
            }else if(op.kind==='VERIFY_REFUND'){
              const original=requireAccounting(),result=await original.detail(op.request.adjustmentId),record=result.adjustment;
              const candidates=op.nativeJobId?[op.nativeJobId]:[...new Set([...(record.history??[])].reverse()
                .filter(h=>h.action==='VERIFICATION_REQUESTED'&&h.transaction===op.request.transaction).map(h=>h.jobId))];
              let selected;
              for(const nativeId of candidates){
                const job=await original.savedJob(nativeId);
                if(job.adjustmentId!==op.request.adjustmentId||job.transaction!==op.request.transaction||
                  job.rpcEndpoint!==op.request.rpcEndpoint)continue;
                // Original verify reuses matching ACTIVE/COMPLETED jobs before
                // revision checks. A lost duplicate reply still refers to that
                // original job, even when it predates this coordinator request.
                if(nativeId===op.nativeJobId||!op.priorNativeJobs?.includes(nativeId)||
                  ['QUEUED','RUNNING','COMPLETED'].includes(job.status)){selected=job;break;}
              }
              need(selected,'JOB_RESOLUTION_VERIFICATION_OUTCOME_PENDING',409);
              const current=await original.detail(op.request.adjustmentId);
              originalResult(value,op,{adjustment:current.adjustment,job:selected});
            }else if(op.kind==='WITHDRAW_REFUND'){
              const result=await requireAccounting().detail(op.request.adjustmentId);
              const last=result.adjustment.history?.at(-1);
              need(result.adjustment.status==='WITHDRAWN'&&last?.action==='WITHDRAWN'&&
                last.actor===op.request.actor&&last.reason===op.request.reason,'JOB_RESOLUTION_WITHDRAWAL_OUTCOME_PENDING',409);
              originalResult(value,op,result);
            }else{
              const current=await model.get(jobId);
              need(current.history.some(h=>h.reason===op.request.marker&&
                h.action===(op.kind==='RETRY_JOB'?'retry-requested':'cancel-requested')),
                'JOB_RESOLUTION_JOB_OUTCOME_PENDING',409);
              originalResult(value,op,current);
            }
          }catch(error){op.error=failure(error);if(op.state==='DISPATCHING')op.state='UNKNOWN';}
          await save(value,'operation-recovered',{requestId:op.id,state:op.state});
          return operatorView(value,await model.get(jobId));
        });
      },
      async resume(jobId,{requestId,expectedRevision}={}){
        return serial(async()=>{const {value,row}=await context(jobId);
          const op=value.operations.find(o=>o.id===id(requestId));need(op,'JOB_RESOLUTION_OPERATION_NOT_FOUND',404);
          if(op.state==='RECORDED')return operatorView(value,row);
          expected(value,expectedRevision);
          // An explicit operator resume reuses the original request UUID or
          // original adjustment/transaction. Job actions retain their original
          // compare-and-set revision and unique history reason.
          return dispatch(value,op);
        });
      },
      async accountingExport(jobId){
        return serial(async()=>{const {value}=await context(jobId),selected=value.accounting;
          need(selected,'JOB_RESOLUTION_ACCOUNTING_RUN_REQUIRED',409);
          const file=await requireAccounting().export(selected.source.runId),body=JSON.parse(file.bytes.toString('utf8'));
          need(body.schema===ADJUSTMENT_EXPORT_SCHEMA&&object(body.source)&&Array.isArray(body.events)&&
            body.source.runId===selected.source.runId&&body.source.reportSha256===selected.source.reportSha256&&
            body.source.inputManifestSha256===selected.source.inputManifestSha256,'JOB_RESOLUTION_ACCOUNTING_EXPORT_CHANGED',409);
          const matching=body.events.filter(e=>e.original?.eventId===value.job.settlement.id);
          need(matching.length===1,'JOB_RESOLUTION_ACCOUNTING_EXPORT_CHANGED',409);
          bindAccounting(value.job,{...selected.detail,event:matching[0].original,totals:matching[0].totals,
            adjustments:matching[0].adjustments,source:body.source},selected.source);
          return {...file,sha256:hash(file.bytes)};
        });
      },
      async export(jobId){
        return serial(async()=>{const {value,row}=await context(jobId);
          return {schema:EXPORT_SCHEMA,exportedAt:now(),caseSha256:hash(json(value)),case:copy(value),
            customerReceipt:publicReceipt(value,row)};
        });
      },
      async receive(exported){
        return serial(async()=>{need(json(exported).length<=RESOLUTION_RECEIVING_BYTES,'JOB_RESOLUTION_RECEIVING_TOO_LARGE',413);
          need(json(exported?.case).length<=RESOLUTION_DOCUMENT_BYTES,'JOB_RESOLUTION_FILE_TOO_LARGE',413);
          need(exported?.schema===EXPORT_SCHEMA&&exported.caseSha256===hash(json(exported.case)),
            'JOB_RESOLUTION_EXPORT_CHANGED',409);
          const {value,row,binding}=await context(exported.case?.job?.jobId);validateCase(exported.case,binding);
          need(same({...exported.customerReceipt,jobState:row.state},publicReceipt(exported.case,row)),'JOB_RESOLUTION_EXPORT_RECEIPT_CHANGED',409);
          if(value.revision){need(same(value,exported.case),'JOB_RESOLUTION_RECEIVING_CASE_EXISTS',409);return operatorView(value,row);}
          await writeDocument(casePath(directory,row.id),exported.case,{createOnly:true});cache.set(row.id,copy(exported.case));
          return operatorView(exported.case,row);
        });
      },
      close(){
        if(!closePromise){closing=true;adapter?.close();closePromise=tail.then(()=>({closed:true}));}
        return closePromise;
      }
    };
    return Object.freeze(service);
  })();
  owners.set(owner,opening);
  try{return await opening;}catch(error){owners.delete(owner);throw error;}
}
