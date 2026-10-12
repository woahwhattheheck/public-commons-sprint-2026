// MIT. Assigned Timescale work in the original workspace operation journal.
import { identity, fault, stamp } from '../publisher/files.mjs';
import { only, uuid, hash, checkText, nativeTarget, sameNativeTarget, catalog } from './contracts.mjs';

const SCHEMA='stellar-forge.timescale-remediation-item.v1';
const RECEIPT='stellar-forge.timescale-remediation-receipt.v1';
const STATES=['OPEN','IN_PROGRESS','DEFERRED','RESOLVED'];
const ACTIONS=['create','edit','rebase','bind-plan','observe','resolve','reopen'];
const MUTABLE_FIELDS=['title','owner','dueDate','priority','intent','acceptance','status'];
const PLAN_KINDS=['refresh','job','projection'];
const NATIVE_KINDS=['refresh','job-change','verification','extraction'];
const REF_LIMIT=1024;
const clone=value=>structuredClone(value);
function fail(code,message,status=409){throw fault('TIMESCALE_REMEDIATION_'+code,message,status);}
function integer(value,label,minimum=0){
  if(!Number.isSafeInteger(value)||value<minimum)fail('INTEGER_REQUIRED','Provide '+label+'.',400);
  return value;
}
function text(value,label,maximum=2000,empty=false){return checkText(value,label,maximum,empty);}
function date(value){
  if(value==='')return '';
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||
      !Number.isFinite(Date.parse(value+'T00:00:00Z'))||
      new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)
    fail('DATE_INVALID','Use an actual YYYY-MM-DD due date or leave it empty.',400);
  return value;
}
function fields(value){
  only(value,MUTABLE_FIELDS);
  if(!['OPEN','IN_PROGRESS','DEFERRED'].includes(value.status))
    fail('STATE_INVALID','Choose Open, In progress or Deferred; record a resolution separately.',400);
  if(!['NORMAL','HIGH','URGENT'].includes(value.priority))fail('PRIORITY_INVALID','Choose a work priority.',400);
  return {title:text(value.title,'a work title',128),owner:text(value.owner,'the assigned owner',128),
    dueDate:date(value.dueDate??''),priority:value.priority,intent:text(value.intent,'the intended work',8000),
    acceptance:text(value.acceptance,'the acceptance condition',8000),status:value.status};
}
function page(rows,{offset=0,limit=25}={}){
  integer(offset,'an offset');integer(limit,'a page size',1);
  if(limit>100)fail('PAGE_LIMIT','Choose a page size of at most 100.',400);
  return {total:rows.length,offset,limit,next:offset+limit<rows.length?offset+limit:null,rows:rows.slice(offset,offset+limit)};
}
function sourceKey(value){return value.reviewId+':'+value.changeKey;}
function inputShape(input){
  const common=['requestId','expectedVersion','action','actor','note'];
  const byAction={
    create:['source','fields'],
    edit:['workItemId','expectedRevision','fields'],
    rebase:['workItemId','expectedRevision','source'],
    'bind-plan':['workItemId','expectedRevision','planId','planDigest','relevance'],
    observe:['workItemId','expectedRevision','operationId','operationDigest','relevance'],
    resolve:['workItemId','expectedRevision','resolution'],
    reopen:['workItemId','expectedRevision','status']
  };
  if(!input||!ACTIONS.includes(input.action))fail('ACTION_INVALID','Choose a supported work action.',400);
  only(input,[...common,...byAction[input.action]]);
  uuid(input.requestId);
  if(input.expectedVersion!==undefined)integer(input.expectedVersion,'the workspace version');
  text(input.actor,'the operator name',128);text(input.note,'the reason for this change',8000);
  if(input.action!=='create'){uuid(input.workItemId);integer(input.expectedRevision,'the item revision',1);}
}
function operationSummary(row){
  return {id:row.id,kind:row.kind,state:row.state,created:row.created,updated:row.updated,
    input:clone(row.input),data:clone(row.data),digest:identity(row)};
}
function summary(item){
  return {id:item.id,revision:item.revision,digest:identity(item),title:item.title,status:item.status,
    owner:item.owner,dueDate:item.dueDate,priority:item.priority,createdAt:item.createdAt,updatedAt:item.updatedAt,
    source:{reviewId:item.source.reviewId,changeKey:item.source.changeKey,kind:item.source.kind,
      identity:item.source.identity,decision:item.source.decision,afterId:item.source.afterId},
    plans:item.plans.filter(value=>value.sourceDigest===item.source.digest).length,
    observations:item.observations.filter(value=>value.sourceDigest===item.source.digest).length};
}
function html(value){
  return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
function reportTable(names,rows){
  return '<table><thead><tr>'+names.map(name=>'<th>'+html(name)+'</th>').join('')+'</tr></thead><tbody>'+
    rows.map(row=>'<tr>'+row.map(value=>'<td>'+html(value===null?'NULL':value)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
}

/**
 * This facade has no connection, database, writer, scheduler or native side effects.
 * Its commands are original workspace.exclusive operations. Every completed item
 * revision is the immutable result of one original request in timescale.sqlite.
 */
function createTimescaleRemediation(workspace){
  for(const name of ['exclusive','status','operation','comparison','edition','getPlan','readRecord'])
    if(typeof workspace?.[name]!=='function')throw new TypeError('Use the open original Timescale workspace.');
  const workspaceId=uuid(workspace.settings.id);
  let cached=null;
  function scan(){
    const first=workspace.status({offset:0,limit:100});
    if(cached?.version===first.version)return cached;
    const operations=[...first.operations.rows],plans=[...first.plans.rows],editions=[...first.editions.rows];
    const total=Math.max(first.operations.total,first.plans.total,first.editions.total);
    for(let offset=100;offset<total;offset+=100){
      const next=workspace.status({offset,limit:100});
      if(next.version!==first.version)fail('WORKSPACE_CHANGED','Reload the current work history.');
      operations.push(...next.operations.rows);plans.push(...next.plans.rows);editions.push(...next.editions.rows);
    }
    const byId=new Map(),history=new Map();
    for(const row of operations){
      if(row.kind!=='remediation'||row.state!=='COMPLETE')continue;
      const receipt=row.data.result,item=receipt?.item;
      if(receipt?.schema!==RECEIPT||receipt.workspaceId!==workspaceId||receipt.requestId!==row.id||
          row.input.requestId!==row.id||receipt.action!==row.input.action||!ACTIONS.includes(receipt.action)||
          !item||item.schema!==SCHEMA||item.workspaceId!==workspaceId||receipt.workItemId!==item.id||
          receipt.itemRevision!==item.revision||receipt.itemDigest!==identity(item)||
          receipt.actor!==text(row.input.actor,'the retained operator',128)||receipt.note!==text(row.input.note,'the retained reason',8000)||
          item.updatedAt!==receipt.at||item.updatedBy!==receipt.actor)
        fail('JOURNAL_CHANGED','A retained work receipt no longer matches its original operation.');
      uuid(item.id);integer(item.revision,'the retained item revision',1);
      if(!STATES.includes(item.status)||!Array.isArray(item.plans)||!Array.isArray(item.observations))
        fail('JOURNAL_CHANGED','A retained item has an invalid state.');
      const rows=history.get(item.id)??[];
      rows.push({operation:row,receipt,item});history.set(item.id,rows);
    }
    for(const [id,rows]of history){
      rows.sort((a,b)=>a.item.revision-b.item.revision);
      let previous=null;
      for(const row of rows){
        if(row.item.revision!==(previous?.revision??0)+1||
            row.item.previousDigest!==(previous?identity(previous):null)||
            row.item.createdAt!==(previous?.createdAt??row.item.createdAt)||
            row.item.createdBy!==(previous?.createdBy??row.item.createdBy)||
            row.operation.input.workItemId!==(previous?id:undefined)||
            row.operation.input.expectedRevision!==(previous?previous.revision:undefined)||
            (!previous&&(row.receipt.action!=='create'||id!==row.operation.id)))
          fail('JOURNAL_CHAIN_CHANGED','The original work-item revision chain is incomplete or changed.');
        previous=row.item;
      }
      byId.set(id,previous);
    }
    cached={version:first.version,active:first.active,operations,plans,editions,byId,history};
    return cached;
  }
  function checkedVersion(version){
    if(workspace.status({limit:1}).version!==version)
      fail('WORKSPACE_CHANGED','The workspace changed while reading; refresh without discarding your saved request.');
  }
  function current(id,expectedRevision){
    uuid(id);const ledger=scan(),item=ledger.byId.get(id);
    if(!item)fail('ITEM_NOT_FOUND','Choose a retained work item.',404);
    if(expectedRevision!==undefined&&item.revision!==expectedRevision)
      fail('ITEM_CHANGED','Reload the current item before applying this change.');
    return {ledger,item};
  }
  async function loadSource(reference){
    only(reference,['reviewId','comparisonDigest','changeKey','digest']);
    uuid(reference.reviewId);hash(reference.comparisonDigest);hash(reference.changeKey);
    if(reference.digest!==undefined)hash(reference.digest);
    const original=workspace.operation(reference.reviewId),review=original.data.result;
    if(original.kind!=='review'||original.state!=='COMPLETE'||review?.reviewId!==reference.reviewId)
      fail('REVIEW_REQUIRED','Use a completed original comparison review.',400);
    const comparison=await workspace.comparison(review.beforeId,review.afterId);
    if(identity(comparison)!==review.comparisonDigest||review.comparisonDigest!==reference.comparisonDigest)
      fail('SOURCE_CHANGED','The original reviewed comparison no longer matches.');
    const decision=review.decisions.find(row=>row.changeKey===reference.changeKey);
    const change=comparison.changes.find(row=>row.key===reference.changeKey);
    if(!decision||!change||!['REMEDIATE','DEFER'].includes(decision.decision))
      fail('ASSIGNMENT_REQUIRED','Select an original Remediate or Defer decision.',400);
    const source={reviewId:reference.reviewId,comparisonDigest:review.comparisonDigest,
      beforeId:review.beforeId,afterId:review.afterId,beforeDigest:comparison.beforeDigest,afterDigest:comparison.afterDigest,
      changeKey:change.key,kind:change.kind,identity:change.identity,changeState:change.state,
      decision:decision.decision,assignedOwner:decision.owner,decisionNote:decision.note,
      reviewer:review.reviewer,reviewNote:review.note,reviewedAt:original.updated,
      target:comparison.target,before:clone(change.before),after:clone(change.after),fields:clone(change.fields)};
    source.digest=identity(source);
    if(reference.digest!==undefined&&source.digest!==reference.digest)fail('SOURCE_CHANGED','Refresh the exact reviewed assignment.');
    return source;
  }
  function sourceReference(source){
    return {reviewId:source.reviewId,comparisonDigest:source.comparisonDigest,changeKey:source.changeKey,digest:source.digest};
  }
  async function checkedItem(id,expectedRevision){
    const selected=current(id,expectedRevision);
    await loadSource(sourceReference(selected.item.source));
    return selected;
  }
  function list(options={}){
    only(options,['offset','limit','status','owner','q']);
    const ledger=scan();
    if(options.status&&!STATES.includes(options.status))fail('STATE_INVALID','Choose an actual work state.',400);
    const owner=typeof options.owner==='string'?options.owner.toLocaleLowerCase():'';
    const q=typeof options.q==='string'?options.q.toLocaleLowerCase():'';
    const rows=[...ledger.byId.values()].filter(item=>
      (!options.status||item.status===options.status)&&(!owner||item.owner.toLocaleLowerCase().includes(owner))&&
      (!q||[item.id,item.title,item.owner,item.intent,item.acceptance,item.source.kind,item.source.identity]
        .some(value=>String(value).toLocaleLowerCase().includes(q))))
      .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id)).map(summary);
    return {schema:'stellar-forge.timescale-remediation-list.v1',workspaceId,version:ledger.version,
      counts:Object.fromEntries(STATES.map(state=>[state,[...ledger.byId.values()].filter(item=>item.status===state).length])),
      items:page(rows,options)};
  }
  async function sources(options={}){
    only(options,['offset','limit']);
    const ledger=scan(),assigned=new Map([...ledger.byId.values()].map(item=>[sourceKey(item.source),item.id]));
    const candidates=[];
    for(const row of ledger.operations){
      if(row.kind!=='review'||row.state!=='COMPLETE')continue;
      const review=row.data.result;
      for(const decision of review?.decisions??[]){
        if(!['REMEDIATE','DEFER'].includes(decision.decision))continue;
        candidates.push({reviewId:row.id,comparisonDigest:review.comparisonDigest,changeKey:decision.changeKey});
      }
    }
    const selected=page(candidates,options),rows=[];
    for(const reference of selected.rows){
      const source=await loadSource(reference);
      rows.push({...source,workItemId:assigned.get(sourceKey(source))??null});
    }
    checkedVersion(ledger.version);
    return {schema:'stellar-forge.timescale-remediation-sources.v1',workspaceId,version:ledger.version,
      sources:{...selected,rows}};
  }
  async function item(id){
    const {ledger,item:retained}=await checkedItem(id),history=ledger.history.get(id);
    checkedVersion(ledger.version);
    return {schema:'stellar-forge.timescale-remediation-detail.v1',workspaceId,version:ledger.version,
      item:clone(retained),digest:identity(retained),
      history:history.map(({operation,receipt})=>({requestId:operation.id,action:receipt.action,
        actor:receipt.actor,note:receipt.note,at:receipt.at,revision:receipt.itemRevision,digest:receipt.itemDigest}))};
  }
  function planSummary(row){
    return {id:row.id,kind:row.kind,digest:row.digest,title:row.data.title,owner:row.data.owner,
      editionId:row.data.editionId,relation:row.data.relation??null,jobId:row.data.jobId??null,
      window:row.data.window??null,changes:row.data.changes??null};
  }
  async function context(id,{editionId,offset=0,limit=25}={}){
    const {ledger,item:retained}=await checkedItem(id);
    const plans=ledger.plans.filter(row=>PLAN_KINDS.includes(row.kind)&&sameNativeTarget(row.data.target,retained.source.target));
    const bound=new Set(retained.plans.filter(row=>row.sourceDigest===retained.source.digest).map(row=>row.planId));
    const operations=ledger.operations.filter(row=>NATIVE_KINDS.includes(row.kind)&&bound.has(row.input?.planId));
    let resolution=null;
    if(editionId){
      const selected=await workspace.edition(uuid(editionId));
      if(!sameNativeTarget(nativeTarget(selected.value),retained.source.target))
        fail('TARGET_CHANGED','Choose an edition from the original reviewed database.');
      const comparison=await workspace.comparison(retained.source.afterId,editionId);
      const changed=comparison.changes.find(row=>row.kind===retained.source.kind&&row.identity===retained.source.identity);
      resolution={editionId,editionDigest:selected.record.digest,completedAt:selected.value.completedAt,
        comparisonDigest:identity(comparison),comparison,sourceChange:changed??null,
        meaning:changed?'This is the exact later catalog change; the assigned operator decides its meaning.':
          'The selected catalog row has no later change. This is not proof of aggregate coverage.'};
    }
    checkedVersion(ledger.version);
    return {schema:'stellar-forge.timescale-remediation-context.v1',workspaceId,version:ledger.version,
      itemId:id,itemRevision:retained.revision,sourceDigest:retained.source.digest,
      plans:page(plans.map(planSummary),{offset,limit}),
      operations:page(operations.map(operationSummary),{offset,limit}),
      editions:page(ledger.editions.map(row=>({id:row.id,title:row.title,created:row.created,digest:row.digest,bytes:row.bytes})),{offset,limit}),
      resolution};
  }
  function assertOpen(item){
    if(item.status==='RESOLVED')fail('REOPEN_REQUIRED','Reopen this retained resolution before changing the work.');
  }
  function selectedPlan(item,id,digest){
    uuid(id);hash(digest);const selected=workspace.getPlan(id);
    if(!PLAN_KINDS.includes(selected.kind)||selected.digest!==digest)
      fail('PLAN_CHANGED','Use the exact retained original plan.');
    if(!sameNativeTarget(selected.data.target,item.source.target))
      fail('TARGET_CHANGED','The plan belongs to a different database.');
    return selected;
  }
  async function observeOperation(item,id,expectedDigest){
    const row=workspace.operation(uuid(id));hash(expectedDigest);
    if(identity(row)!==expectedDigest)fail('OPERATION_CHANGED','Reopen the actual operation before recording its current outcome.');
    if(!NATIVE_KINDS.includes(row.kind))fail('OPERATION_KIND','Choose an original refresh, job change, verification or extraction.',400);
    const binding=item.plans.find(plan=>plan.sourceDigest===item.source.digest&&plan.planId===row.input?.planId&&plan.planDigest===row.input?.planDigest);
    if(!binding)fail('PLAN_BINDING_REQUIRED','Link this operation’s exact original plan to the current assignment first.',400);
    selectedPlan(item,binding.planId,binding.planDigest);
    const refs=[row.data.result?.native,row.data.dispatch?.before].filter(Boolean);
    for(const reference of refs)await workspace.readRecord(reference);
    return {sourceDigest:item.source.digest,planId:binding.planId,planDigest:binding.planDigest,
      operation:operationSummary(row),nativeReferences:clone(refs)};
  }
  async function resolveItem(retained,input,actor,at){
    const value=input.resolution;
    only(value,['editionId','editionDigest','comparisonDigest','mode','verificationOperationId','verificationOperationDigest','outcome','statement']);
    if(!['CURRENT_STATE_REVIEW','COMPLETE_AGGREGATE_VERIFICATION'].includes(value.mode))
      fail('RESOLUTION_MODE','Choose current-state review or a complete aggregate verification.',400);
    if(!['REMEDIATED','ACCEPTED_CURRENT_STATE','SUPERSEDED'].includes(value.outcome))
      fail('RESOLUTION_OUTCOME','Choose the recorded assessment.',400);
    const selected=await workspace.edition(uuid(value.editionId));
    if(selected.record.digest!==hash(value.editionDigest)||!sameNativeTarget(nativeTarget(selected.value),retained.source.target))
      fail('RESOLUTION_EDITION_CHANGED','Use the exact later edition from this database.');
    const sourceEdition=await workspace.edition(retained.source.afterId);
    if(value.editionId===retained.source.afterId||!Number.isFinite(Date.parse(selected.value.completedAt))||
        Date.parse(selected.value.completedAt)<Date.parse(sourceEdition.value.completedAt))
      fail('LATER_EDITION_REQUIRED','Capture or select a later retained native edition for the assessment.',400);
    const comparison=await workspace.comparison(retained.source.afterId,value.editionId);
    if(identity(comparison)!==hash(value.comparisonDigest))fail('RESOLUTION_COMPARISON_CHANGED','Review the current complete comparison.');
    let verification=null;
    if(value.mode==='COMPLETE_AGGREGATE_VERIFICATION'){
      const observed=await observeOperation(retained,value.verificationOperationId,value.verificationOperationDigest);
      const operation=observed.operation;
      if(operation.kind!=='verification'||operation.state!=='COMPLETE'||operation.data.result?.matches!==true)
        fail('COMPLETE_VERIFICATION_REQUIRED','Select a completed original aggregate verification with matching rows.',400);
      const plan=selectedPlan(retained,observed.planId,observed.planDigest);
      const record=await workspace.readRecord(operation.data.result.native);
      if(record.data.schema!=='stellar-forge.timescale-aggregate-verification.v1'||record.data.matches!==true||
          record.data.definitionDigest!==plan.data.definitionDigest||
          !catalog(selected.value).some(row=>row.key===plan.data.aggregateKey&&row.definitionDigest===plan.data.definitionDigest)||
          !Number.isFinite(Date.parse(record.data.completedAt))||
          Date.parse(record.data.completedAt)<Date.parse(selected.value.completedAt))
        fail('VERIFICATION_COVERAGE_CHANGED','Use a matching verification completed after the selected edition; its exact window remains the measured scope.');
      verification={...observed,completedAt:record.data.completedAt,window:clone(record.data.window),
        definitionDigest:record.data.definitionDigest,counts:clone(record.data.counts),interpretation:record.data.interpretation};
    }else if(value.verificationOperationId!==undefined||value.verificationOperationDigest!==undefined)
      fail('RESOLUTION_INPUT_INVALID','A current-state review does not select an aggregate-verification claim.',400);
    return {mode:value.mode,outcome:value.outcome,statement:text(value.statement,'the explicit operator assessment',8000),
      actor,at,sourceDigest:retained.source.digest,editionId:value.editionId,editionDigest:value.editionDigest,
      comparisonDigest:value.comparisonDigest,change:clone(comparison.changes.find(row=>
        row.kind===retained.source.kind&&row.identity===retained.source.identity)??null),verification,
      interpretation:value.mode==='CURRENT_STATE_REVIEW'?
        'Assigned operator assessment of the retained later catalog state; no aggregate coverage is asserted.':
        'The original native verification measures its retained window and snapshot only.'};
  }
  function command(input){
    input=clone(input);
    inputShape(input);
    return workspace.exclusive('remediation',input,async({signal})=>{
      signal.throwIfAborted();
      const actor=text(input.actor,'the operator name',128),note=text(input.note,'the reason for this change',8000),at=stamp();
      const ledger=scan();let previous=null,next;
      if(input.action==='create'){
        const source=await loadSource(input.source);hash(input.source.digest);
        const duplicate=[...ledger.byId.values()].find(item=>sourceKey(item.source)===sourceKey(source));
        if(duplicate)fail('ASSIGNMENT_EXISTS','Open the existing work item '+duplicate.id+' instead of duplicating the assignment.');
        next={schema:SCHEMA,workspaceId,id:input.requestId,revision:1,previousDigest:null,
          createdAt:at,createdBy:actor,updatedAt:at,updatedBy:actor,
          ...fields(input.fields),source,sourceRevision:1,plans:[],observations:[],resolution:null};
      }else{
        previous=(await checkedItem(input.workItemId,input.expectedRevision)).item;
        next={...clone(previous),revision:previous.revision+1,previousDigest:identity(previous),updatedAt:at,updatedBy:actor};
        if(input.action!=='reopen')assertOpen(previous);
        if(input.action==='edit')Object.assign(next,fields(input.fields));
        else if(input.action==='rebase'){
          const source=await loadSource(input.source);hash(input.source.digest);
          if(!sameNativeTarget(source.target,previous.source.target)||source.kind!==previous.source.kind||source.identity!==previous.source.identity)
            fail('REBASE_IDENTITY_CHANGED','A new review must describe the same original catalog item and database.');
          if(source.digest===previous.source.digest)fail('REBASE_UNCHANGED','This is already the current source assignment.',400);
          const duplicate=[...ledger.byId.values()].find(item=>item.id!==previous.id&&sourceKey(item.source)===sourceKey(source));
          if(duplicate)fail('ASSIGNMENT_EXISTS','The selected review is already assigned to '+duplicate.id+'.');
          next.source=source;next.sourceRevision++;next.resolution=null;
        }else if(input.action==='bind-plan'){
          const plan=selectedPlan(previous,input.planId,input.planDigest);
          const binding={sourceDigest:previous.source.digest,planId:plan.id,planDigest:plan.digest,
            kind:plan.kind,title:plan.data.title,relation:clone(plan.data.relation??null),jobId:plan.data.jobId??null,
            window:clone(plan.data.window??null),changes:clone(plan.data.changes??null),
            actor,at,relevance:text(input.relevance,'how this plan addresses the assignment',8000)};
          const index=next.plans.findIndex(row=>row.sourceDigest===binding.sourceDigest&&row.planId===binding.planId);
          if(index<0){if(next.plans.length>=REF_LIMIT)fail('REFERENCE_LIMIT','Export this complete work history before starting another assignment.',400);next.plans.push(binding);}
          else next.plans[index]=binding;
        }else if(input.action==='observe'){
          const observed=await observeOperation(previous,input.operationId,input.operationDigest);
          if(next.observations.length>=REF_LIMIT)fail('REFERENCE_LIMIT','This item retains the maximum number of observations.',400);
          next.observations.push({...observed,actor,at,relevance:text(input.relevance,'what this actual outcome establishes',8000)});
        }else if(input.action==='resolve'){
          next.resolution=await resolveItem(previous,input,actor,at);next.status='RESOLVED';
        }else if(input.action==='reopen'){
          if(previous.status!=='RESOLVED')fail('RESOLUTION_REQUIRED','This work item is already open.',400);
          if(!['OPEN','IN_PROGRESS','DEFERRED'].includes(input.status))fail('STATE_INVALID','Choose the reopened work state.',400);
          next.status=input.status;next.resolution=null;
        }
      }
      signal.throwIfAborted();
      return {schema:RECEIPT,workspaceId,requestId:input.requestId,action:input.action,actor,note,at,
        workItemId:next.id,itemRevision:next.revision,itemDigest:identity(next),item:next};
    });
  }
  async function report(id){
    const result=await item(id),value=result.item;
    const rows=value.source.fields.map(row=>[row.name,row.before,row.after]);
    const bindingRows=value.plans.map(row=>[row.kind,row.title,row.planId,row.planDigest,
      row.sourceDigest===value.source.digest?'Current assignment':'Earlier assignment',row.relevance]);
    const observedRows=value.observations.map(row=>[row.at,row.operation.kind,row.operation.id,row.operation.state,
      row.operation.data.result?.matches===true?'Exact retained verification matched':
        row.operation.data.result?.matches===false?'Exact retained verification differed':
        row.operation.data.result?.state??'No aggregate coverage claim',row.relevance,row.operation.digest]);
    const historyRows=result.history.map(row=>[String(row.revision),row.at,row.actor,row.action,row.note,row.requestId]);
    const document='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<title>'+html(value.title)+' — Timescale assigned work</title><style>'+
      'body{font:15px/1.5 system-ui,sans-serif;color:#171717;background:#fff;margin:0 auto;padding:32px;max-width:1200px}'+
      'h1{font-size:28px}h2{margin-top:32px;font-size:20px}p,pre{overflow-wrap:anywhere}pre{white-space:pre-wrap;font:13px/1.5 monospace}'+
      'table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;vertical-align:top;padding:9px;border:1px solid #bbb;overflow-wrap:anywhere}'+
      'th{background:#eee}dl{display:grid;grid-template-columns:180px 1fr;gap:6px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}'+
      '@media print{body{padding:0;max-width:none}h2{break-after:avoid}tr{break-inside:avoid}}</style></head><body>'+
      '<h1>'+html(value.title)+'</h1><p>Assigned Timescale work · Revision '+value.revision+' · '+html(value.status)+'</p>'+
      '<dl>'+[['Owner',value.owner],['Priority',value.priority],['Due date',value.dueDate||'Unscheduled'],
        ['Workspace',workspaceId],['Work item',id],['Exact item digest',result.digest],
        ['Original review',value.source.reviewId],['Source comparison',value.source.comparisonDigest]]
        .map(([name,v])=>'<dt>'+html(name)+'</dt><dd>'+html(v)+'</dd>').join('')+'</dl>'+
      '<h2>Purpose and acceptance</h2><p>'+html(value.intent)+'</p><p>'+html(value.acceptance)+'</p>'+
      '<h2>Original assigned source</h2><p>'+html(value.source.kind)+' · '+html(value.source.identity)+' · '+
      html(value.source.decision)+'</p><p>'+html(value.source.decisionNote)+'</p>'+
      reportTable(['Field','Before','Reviewed after'],rows)+
      '<h2>Linked original plans</h2>'+reportTable(['Kind','Title','Plan','Digest','Source','Relevance'],bindingRows)+
      '<h2>Observed native outcomes</h2><p>Each row preserves the state observed at its recorded time. Unknown outcomes remain unknown; no native mutation is repeated by this desk.</p>'+
      reportTable(['Observed','Kind','Operation','State','Returned result','Assessment','Observed operation digest'],observedRows)+
      '<h2>Recorded resolution</h2>'+(value.resolution?'<p>'+html(value.resolution.interpretation)+'</p><pre>'+
        html(JSON.stringify(value.resolution,null,2))+'</pre>':'<p>This item has no current recorded resolution.</p>')+
      '<h2>Complete item history</h2>'+reportTable(['Revision','Time','Operator','Action','Reason','Original request'],historyRows)+
      '<p>The complete original workspace export contains these revisions, source editions, plans, native records and publisher history. This portable report is a readable view of the selected item revision.</p>'+
      '</body></html>';
    return {schema:'stellar-forge.timescale-remediation-report.v1',workspaceId,workItemId:id,
      itemRevision:value.revision,itemDigest:result.digest,json:result,html:document};
  }
  return Object.freeze({list,sources,item,context,command,report});
}

export { createTimescaleRemediation };
