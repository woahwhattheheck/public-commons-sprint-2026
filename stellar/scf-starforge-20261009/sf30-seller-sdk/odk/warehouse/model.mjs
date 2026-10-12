// MIT. Complete reviewed Central periods on the existing PostgreSQL operator.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fault, formatted, digest, now, stable } from '../../odata/state.mjs';
import { prepareCentralApproval, selection } from './contract.mjs';
import { createPostgresBridge } from './bridge.mjs';

export const WAREHOUSE_SCHEMA='stellar-forge.central-warehouse.v1';
const KIND='warehouse-operation',APPROVAL='warehouse-approval',PROFILE='warehouse-profile';
const ID=/^[a-f0-9]{32}$/,HASH=/^[a-f0-9]{64}$/;
const copy=value=>JSON.parse(JSON.stringify(value));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const same=(a,b)=>stable(a)===stable(b);
const need=(condition,code,message,status=409)=>{if(!condition)throw fault(code,message,status);};
function requestId(id) {need(typeof id==='string'&&ID.test(id),'CENTRAL_WAREHOUSE_REQUEST_ID','Retain a caller-generated 32-character hexadecimal request ID.',422);return id;}
function object(value,label,max=1024*1024) {
  need(plain(value),'CENTRAL_WAREHOUSE_INPUT','Use a complete '+label+' object.',422);
  let raw;try{raw=formatted(value);}catch{throw fault('CENTRAL_WAREHOUSE_INPUT','Use finite JSON values for '+label+'.',422);}
  need(raw.length<=max,'CENTRAL_WAREHOUSE_INPUT','The complete '+label+' exceeds its original input limit.',413);
  return copy(value);
}
function text(value,label,max=4000,required=false) {
  need(typeof value==='string'&&value.length<=max&&(!required||value.trim())&&!value.includes('\0'),
    'CENTRAL_WAREHOUSE_INPUT','Use '+label+'.',422);
  return value;
}
const describeError=error=>({code:error.code||'CENTRAL_WAREHOUSE_INTERRUPTED',
  message:error.message||'Reopen the same original warehouse operation.',status:error.status||500});
const outputReceipt=(value,name,type='application/json')=>({...value,name,type});
const contextFor=record=>({
  approvalId:record.id,approvalSha256:record.receipt.sha256,
  commissioningId:record.approval.commissioning.id,
  definitionSha256:record.approval.commissioning.definitionSha256,
  period:record.approval.period,table:record.approval.table,
  captureId:record.approval.capture.id,exportId:record.approval.export.id,
  keyColumns:record.approval.table.keyFields.map(path=>record.approval.projection.mapping.find(field=>field.path===path)?.name),
  parentColumn:record.approval.table.relationship?
    record.approval.projection.mapping.find(field=>field.path===record.approval.table.relationship.parentField)?.name:null,
  rowCount:record.approval.export.rowCount
});

export function createCentralWarehouse({workspace,store,profiles=[]}={}) {
  need(workspace?.directory&&store?.transaction&&store.directory===workspace.directory,
    'CENTRAL_WAREHOUSE_STORE','Compose with the original workspace and its already-held Store.');
  const bridge=createPostgresBridge({store,profiles});
  let closed=false,closing=false,faulted=false,queue=Promise.resolve(),active=null;
  const checked=()=>need(!closed&&!closing,'CENTRAL_WAREHOUSE_CLOSED','Reopen the original warehouse operator.');
  const transaction=fn=>{
    need(!faulted,'CENTRAL_WAREHOUSE_REOPEN','A storage result was uncertain. Close and reopen this same native workspace.');
    try{return store.transaction(fn);}
    catch(error){if(!String(error.code??'').startsWith('CENTRAL_'))faulted=true;throw error;}
  };
  const write=(kind,id,value,revision)=>transaction(()=>store.writeRecord(kind,id,value,revision));
  const exclusive=fn=>{
    checked();
    const operation=queue.then(async()=>{need(!closed,'CENTRAL_WAREHOUSE_CLOSED','Reopen the same original workspace.');return fn();});
    queue=operation.catch(()=>{});return operation;
  };
  const matching=(kind,id,intent)=>{
    requestId(id);const old=store.get(kind,id,false);
    need(!old||same(old.intent,intent),'CENTRAL_WAREHOUSE_REQUEST_CHANGED','This request ID already belongs to another complete selection.');
    return old;
  };
  async function retainJson(owner,key,value,name) {
    const raw=formatted(value),existing=store.resource(owner,key);
    if(existing) {
      need(existing.sha256===digest(raw)&&existing.bytes===raw.length,
        'CENTRAL_WAREHOUSE_RESOURCE_CHANGED','The retained original request input changed.');
      await store.sourceFile(existing.sha256);return existing;
    }
    const receipt=outputReceipt(await store.retain(raw),name);
    transaction(()=>store.saveResource(owner,key,'warehouse-document',receipt));
    return receipt;
  }
  const originalApproval=id=>{
    requestId(id);const record=store.get(APPROVAL,id);
    need(record.status==='COMPLETE'&&record.receipt&&record.approval,
      'CENTRAL_WAREHOUSE_APPROVAL','Finish the same native export approval first.');
    return record;
  };
  async function approvalFile(id) {
    const record=originalApproval(id),expected=formatted(record.approval);
    need(digest(expected)===record.receipt.sha256,'CENTRAL_WAREHOUSE_APPROVAL_CHANGED','The retained approval content changed.');
    const file=await store.sourceFile(record.receipt.sha256);
    need(file.bytes===record.receipt.bytes,'CENTRAL_WAREHOUSE_APPROVAL_CHANGED','The retained approval byte count changed.');
    return {record,file};
  }
  const completedOperation=(id,action)=>{
    requestId(id);const record=store.get(KIND,id);
    need(record.action===action&&record.status==='COMPLETE'&&plain(record.result),
      'CENTRAL_WAREHOUSE_DEPENDENCY','Complete and reopen the original '+action+' operation.');
    return record;
  };
  const binding=profileId=>{
    const configured=bridge.get(profileId),record=store.get(PROFILE,profileId,false);
    need(record?.warehouseId&&record.warehouseSchema===configured.schema,
      'CENTRAL_WAREHOUSE_IDENTITY','Open the selected existing warehouse once to retain its original identity.');
    need(!configured.expectedWarehouse||configured.expectedWarehouse===record.warehouseId,
      'CENTRAL_WAREHOUSE_IDENTITY_CHANGED','The host profile identifies another warehouse.');
    return {id:configured.id,warehouseId:record.warehouseId,warehouseSchema:record.warehouseSchema};
  };
  function state() {
    checked();const identity=store.identity();
    return {schema:WAREHOUSE_SCHEMA,workspaceId:identity.workspaceId,revision:Number(identity.revision),
      activeRequestId:active,storageReopenRequired:faulted,
      profiles:bridge.profiles().map(profile=>({...profile,binding:store.get(PROFILE,profile.id,false)})),
      deliveries:store.list('commissioning-delivery').filter(x=>x.datasets?.length).map(delivery=>{
        const commission=store.get('commissioning',delivery.request.commissionId);
        return {id:delivery.id,status:delivery.status,commissioningId:commission.id,
          name:commission.definition.agreement.name??commission.definition.agreement.opportunity_id,
          agreementSha256:commission.definition.agreementSha256,
          datasets:delivery.datasets.map(dataset=>({id:dataset.id,name:dataset.name,period:dataset.period,
            periodLabel:commission.definition.periods[dataset.period].label,captureId:dataset.captureId,tableId:dataset.tableId}))};
      }),
      approvals:store.list(APPROVAL).map(record=>({id:record.id,status:record.status,intent:record.intent,
        receipt:record.receipt??null,context:record.approval?contextFor(record):null,error:record.error??null})),
      operations:store.list(KIND).map(record=>({
        id:record.id,action:record.action,status:record.status,profile:record.profile??null,
        context:record.context??null,createdAt:record.createdAt,updatedAt:record.updatedAt,
        attempts:record.attempts?.length??0,error:record.error??null,
        versionId:record.result?.version_id??record.result?.result?.version_id??null,
        rowCount:record.result?.row_count??record.result?.result?.row_count??null,
        report:record.report??null,resultReceipt:record.resultReceipt??null
      }))
    };
  }
  async function prepare({requestId:id,...input}={}) {
    requestId(id);const intent=selection(input),old=matching(APPROVAL,id,intent);
    if(old?.status==='COMPLETE'){await approvalFile(id);return old;}
    let record=old??write(APPROVAL,id,{schema:WAREHOUSE_SCHEMA,id,intent,status:'PREPARING',createdAt:now(),error:null},0);
    try{
      const approval=await prepareCentralApproval({workspace,store,input:intent}),
        receipt=await retainJson('warehouse-approval:'+id,'approval',approval,'central-approved-export.json');
      record=store.get(APPROVAL,id);
      return write(APPROVAL,id,{...record,status:'COMPLETE',approval,receipt,completedAt:now(),error:null},record.revision);
    }catch(error){
      if(!faulted){record=store.get(APPROVAL,id);write(APPROVAL,id,{...record,status:'INTERRUPTED',error:describeError(error)},record.revision);}
      throw error;
    }
  }
  function intentFor(action,input) {
    if(action==='connect') {
      bridge.get(input.profileId);return {profileId:input.profileId};
    }
    if(action==='inspect') {
      const approved=originalApproval(input.approvalId);
      return {approvalId:approved.id,approvalSha256:approved.receipt.sha256,profileId:bridge.get(input.profileId).id};
    }
    if(action==='review') {
      const inspection=completedOperation(input.inspectionId,'inspect');
      const mapping=object(input.mapping,'complete native SQL mapping');
      need(Array.isArray(mapping.keys)&&same(mapping.keys,inspection.context.keyColumns),
        'CENTRAL_WAREHOUSE_NATIVE_KEYS','Retain the explicitly mapped original Central row keys in their native order.');
      return {inspectionId:inspection.id,mapping,reviewer:text(input.reviewer,'a reviewer name',160,true),
        note:text(input.note??'','the review note')};
    }
    if(action==='import')return {reviewId:completedOperation(input.reviewId,'review').id};
    if(action==='periodReport') {
      const previous=completedOperation(input.previousImportId,'import'),current=completedOperation(input.currentImportId,'import');
      need(previous.profile.warehouseId===current.profile.warehouseId&&
        previous.profile.warehouseSchema===current.profile.warehouseSchema&&previous.profile.id===current.profile.id,
        'CENTRAL_WAREHOUSE_PERIOD_WAREHOUSE','Select both original periods from the same retained warehouse profile.');
      const a=previous.context,b=current.context;
      need(a.period.index===0&&b.period.index===1&&a.commissioningId===b.commissioningId&&
        a.definitionSha256===b.definitionSha256&&
        same([a.table.projectId,a.table.formId,a.table.name],[b.table.projectId,b.table.formId,b.table.name]),
        'CENTRAL_WAREHOUSE_PERIOD_TABLE','Select period 0 and period 1 of the same approved commissioning table.');
      return {previousImportId:previous.id,currentImportId:current.id,
        title:text(input.title,'a readable period report title',240,true)};
    }
    throw fault('CENTRAL_WAREHOUSE_ACTION','Choose an original warehouse action.',404);
  }
  function operationContext(action,intent) {
    if(action==='connect')return {profile:null,context:null};
    if(action==='inspect')return {profile:binding(intent.profileId),context:contextFor(originalApproval(intent.approvalId))};
    if(action==='review') {const original=completedOperation(intent.inspectionId,'inspect');return {profile:original.profile,context:original.context};}
    if(action==='import') {const original=completedOperation(intent.reviewId,'review');return {profile:original.profile,context:original.context};}
    const previous=completedOperation(intent.previousImportId,'import'),current=completedOperation(intent.currentImportId,'import');
    return {profile:current.profile,context:{...current.context,previousApprovalId:previous.context.approvalId,
      previousImportId:previous.id,currentImportId:current.id,previousPeriod:previous.context.period}};
  }
  async function command(record) {
    const input=record.intent,profile=bridge.get(record.profile?.id??input.profileId);
    if(record.action==='connect')return {profile,args:['status']};
    const args=['--workspace',profile.workspace];
    if(record.action==='inspect'||record.action==='review') {
      const source=await approvalFile(record.context.approvalId);
      // Revalidate the original immutable export against its native Store before
      // any new/replayed source review, including after workspace relocation.
      const fresh=await prepareCentralApproval({workspace,store,input:source.record.intent});
      need(same(fresh,source.record.approval),'CENTRAL_WAREHOUSE_APPROVAL_CHANGED','The original approved native export changed.');
      args.push('--approval',source.file.path,'--expected-approval-sha256',source.record.receipt.sha256,
        '--source-workspace',workspace.directory);
      if(record.action==='review') {
        const mapping=await retainJson('warehouse-operation:'+record.id,'mapping',input.mapping,'postgres-mapping.json'),
          file=await store.sourceFile(mapping.sha256);
        args.push('--mapping',file.path,'--reviewer',input.reviewer,'--note',input.note,'--review-id',record.id);
      }
      return {profile,args:[record.action==='inspect'?'central-inspect':'central-review',...args]};
    }
    if(record.action==='import') {
      const review=completedOperation(input.reviewId,'review');
      need(review.result.record_id===review.id,'CENTRAL_WAREHOUSE_REVIEW_ID','Use the original retained Python review ID.');
      return {profile,args:['central-import',...args,'--review-id',review.result.record_id,'--request-id',record.id]};
    }
    const previous=completedOperation(input.previousImportId,'import'),current=completedOperation(input.currentImportId,'import');
    const selected={schema:'stellar-forge.postgres-period-selection.v1',
      previous_version:previous.result.result.version_id,current_version:current.result.result.version_id,
      previous_label:previous.context.period.label,current_label:current.context.period.label,title:input.title};
    const receipt=await retainJson('warehouse-operation:'+record.id,'selection',selected,'postgres-period-selection.json'),
      file=await store.sourceFile(receipt.sha256);
    return {profile,args:['period-report',...args,'--request-id',record.id,'--selection',file.path]};
  }
  async function retainReport(record,output,profile) {
    const artifact=output.result?.artifact;
    const retained=store.resource('warehouse-operation:'+record.id,'period-report');
    if(retained) {
      need(artifact&&retained.sha256===artifact.sha256&&retained.bytes===artifact.bytes&&retained.name===artifact.filename,
        'CENTRAL_WAREHOUSE_REPORT_CHANGED','The retained original period report differs from its native result.');
      await store.sourceFile(retained.sha256);return retained;
    }
    need(output.state==='COMPLETE'&&plain(artifact)&&typeof artifact.path==='string'&&isAbsolute(artifact.path)&&
      typeof artifact.filename==='string'&&artifact.filename.endsWith('.zip')&&HASH.test(artifact.sha256)&&
      Number.isSafeInteger(artifact.bytes)&&artifact.bytes>=0,
      'CENTRAL_WAREHOUSE_REPORT_RECEIPT','Retain the complete original PostgreSQL report artifact.');
    const root=resolve(profile.workspace),path=resolve(artifact.path),member=relative(root,path);
    need(member&&!member.startsWith('..'+String.fromCharCode(47))&&member!=='..'&&!isAbsolute(member),
      'CENTRAL_WAREHOUSE_REPORT_PATH','The fixed native report must be inside the selected original PostgreSQL operator workspace.');
    const info=await stat(path);
    need(info.isFile()&&info.size===artifact.bytes,'CENTRAL_WAREHOUSE_REPORT_CHANGED','The original complete report file changed.');
    const held=await store.retainStream(createReadStream(path));
    need(held.bytes===artifact.bytes&&held.sha256===artifact.sha256,
      'CENTRAL_WAREHOUSE_REPORT_CHANGED','The original complete report bytes differ from its committed result.');
    const receipt=outputReceipt(held,artifact.filename,'application/zip');
    transaction(()=>store.saveResource('warehouse-operation:'+record.id,'period-report','warehouse-period-report',receipt));
    return receipt;
  }

  async function finish(record,result,profile) {
      const action=record.action;const owner='warehouse-operation:'+record.id;
      if(action==='connect') {
        need(typeof result.warehouse_id==='string'&&result.warehouse_id&&result.warehouse_schema===profile.schema,
          'CENTRAL_WAREHOUSE_IDENTITY','The original status must return its warehouse identity and selected schema.');
        need(!profile.expectedWarehouse||profile.expectedWarehouse===result.warehouse_id,
          'CENTRAL_WAREHOUSE_IDENTITY_CHANGED','The configured original warehouse identity differs from this returned status.');
        const prior=store.get(PROFILE,profile.id,false);
        need(!prior||prior.warehouseId===result.warehouse_id&&prior.warehouseSchema===result.warehouse_schema,
          'CENTRAL_WAREHOUSE_IDENTITY_CHANGED','This configured profile now points to another warehouse.');
        const bound={id:profile.id,warehouseId:result.warehouse_id,warehouseSchema:result.warehouse_schema};
        write(PROFILE,profile.id,{schema:WAREHOUSE_SCHEMA,...bound,
          observedAt:now(),postgresqlVersion:result.postgresql_version},prior?.revision??0);
        record={...record,profile:bound};
      }
      if(action==='inspect')need(plain(result.mapping)&&result.row_count===record.context.rowCount,
        'CENTRAL_WAREHOUSE_INSPECTION','Retain the complete native inspection of this approved projection.');
      if(action==='review')need(result.record_id===record.id&&result.state==='REVIEWED',
        'CENTRAL_WAREHOUSE_REVIEW_ID','The original Python review did not return the retained review identity.');
      if(action==='import'||action==='periodReport')need(result.record_id===record.id&&result.state==='COMPLETE',
        'CENTRAL_WAREHOUSE_NATIVE_REQUEST','Resume the same original incomplete PostgreSQL request.');
      if(action==='import')need(typeof result.result?.version_id==='string'&&HASH.test(result.result.version_id),
        'CENTRAL_WAREHOUSE_EDITION','Retain the original committed warehouse edition identity.');
      const report=action==='periodReport'?await retainReport(record,result,profile):null;
      const resultReceipt=await retainJson(owner,'result',result,'postgres-'+action+'-result.json');
      const current=store.get(KIND,record.id);
      return write(KIND,record.id,{...current,profile:record.profile,status:'COMPLETE',result,resultReceipt,
        ...(report?{report}:{}),completedAt:now(),error:null},current.revision);
  }
  async function execute(action,input) {
    requestId(input.requestId);
    const intent=intentFor(action,input),old=matching(KIND,input.requestId,intent);
    need(!old||old.action===action,'CENTRAL_WAREHOUSE_REQUEST_CHANGED','This request ID already identifies another original action.');
    if(old?.status==='COMPLETE')return old;
    const inherited=old??operationContext(action,intent);
    let record=old??write(KIND,input.requestId,{schema:WAREHOUSE_SCHEMA,id:input.requestId,action,intent,
      profile:inherited.profile,context:inherited.context,status:'PREPARED',createdAt:now(),attempts:[],error:null},0);
    const recovered=store.resource('warehouse-operation:'+record.id,'result');
    if(recovered) {
      const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await store.raw(recovered.sha256)));
      return finish(record,result,bridge.get(record.profile?.id??record.intent.profileId));
    }
    const attempt={number:record.attempts.length+1,startedAt:now()};
    record=write(KIND,record.id,{...record,status:'RUNNING',attempts:[...record.attempts,attempt],error:null},record.revision);
    active=record.id;
    try{
      const selected=await command(record),observed=await bridge.invoke({
        profileId:selected.profile.id,warehouseId:record.profile?.warehouseId,arguments:selected.args});
      const owner='warehouse-operation:'+record.id;
      transaction(()=>{
        store.saveResource(owner,'stdout:'+attempt.number,'warehouse-command-output',
          outputReceipt(observed.stdout,'command-'+attempt.number+'-stdout.json'));
        store.saveResource(owner,'stderr:'+attempt.number,'warehouse-command-output',
          outputReceipt(observed.stderr,'command-'+attempt.number+'-stderr.txt','text/plain; charset=utf-8'));
      });
      const completed={...attempt,finishedAt:now(),code:observed.code,signal:observed.signal,
        stdout:observed.stdout,stderr:observed.stderr};
      record=store.get(KIND,record.id);
      record=write(KIND,record.id,{...record,attempts:[...record.attempts.slice(0,-1),completed]},record.revision);
      if(observed.error)throw Object.assign(fault(observed.error.code,observed.error.message,409),{details:observed.error.native});
      return finish(record,observed.output,selected.profile);
    }catch(error){
      if(!faulted){const current=store.get(KIND,record.id);write(KIND,record.id,{...current,status:'INTERRUPTED',error:describeError(error)},current.revision);}
      throw error;
    }finally{active=null;}
  }
  function operation({requestId:id}={}) {checked();requestId(id);return store.get(KIND,id);}
  function approval({requestId:id}={}) {checked();requestId(id);return store.get(APPROVAL,id);}
  const api={state,operation,approval,
    prepare:input=>exclusive(()=>prepare(input)),
    connect:input=>exclusive(()=>execute('connect',input)),
    inspect:input=>exclusive(()=>execute('inspect',input)),
    review:input=>exclusive(()=>execute('review',input)),
    import:input=>exclusive(()=>execute('import',input)),
    periodReport:input=>exclusive(()=>execute('periodReport',input)),
    resume:input=>exclusive(()=>{
      const saved=store.get(KIND,requestId(input?.requestId));
      return execute(saved.action,{requestId:saved.id,...saved.intent});
    }),
    async close(){if(closed)return;closing=true;await queue;closed=true;}
  };
  return Object.freeze(api);
}
