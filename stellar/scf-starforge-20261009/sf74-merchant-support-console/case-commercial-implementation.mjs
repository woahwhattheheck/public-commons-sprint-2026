// MIT. Accepted quotation scope applied atomically to the original merchant case.
import {parseWorkspace,serializeWorkspace,workspaceDraft} from './workspace-file.mjs';
import {applyCommissioningCommand,commissioningFileBytes,commissioningSummary,
  encodeCommissioningBytes,MAX_MATERIAL_BYTES} from './commissioning.mjs';
import {canonical,sha256,jsonBytes,commercialError} from './commercial-pricing.mjs';

export const COMMERCIAL_IMPLEMENTATION_SCHEMA='stellar-forge.merchant-commercial-implementation.v1';
export const COMMERCIAL_IMPLEMENTATION_MATERIAL='commercial-implementation-transfer';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const copy=value=>JSON.parse(JSON.stringify(value));
const equal=(a,b)=>canonical(a)===canonical(b);
const TASK_FIELDS=['title','acceptance','dependencies','retired'];
const PLAN_FIELDS=['title','payer','customerTask','outputDefinition','commercialReference'];
const fail=(code,message,status=422)=>{throw commercialError(code,message,status);};
const issue=(code,message,severity='error')=>({code,message,severity});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function requireText(value,label,max,{empty=false}={}) {
  if(typeof value!=='string'||value.length>max||/\0/.test(value)||(!empty&&!value.trim()))
    fail('COMMERCIAL_IMPLEMENTATION_INPUT','Supply '+label+' as complete text.');
}
function responseOrder(a,b) {
  return String(b.observedAt).localeCompare(String(a.observedAt))||
    String(b.recordedAt).localeCompare(String(a.recordedAt))||b.id.localeCompare(a.id);
}
function originalResponse(context,quote,id) {
  const row=context.documents.find(d=>d.kind==='RESPONSE'&&d.id===id);
  if(!row||row.payload.quoteId!==quote.id||
      row.payload.quoteSha256!==quote.sha256||row.payload.status!=='ACCEPTED')
    fail('COMMERCIAL_ACCEPTANCE_SOURCE','Keep the accepted customer response with its exact original quotation.');
  return row;
}
function transferSummary(value) {
  return {id:value.id,mode:value.mode,caseId:value.caseId,createdAt:value.createdAt,
    recordedAt:value.createdAt,actor:value.request.actor,note:value.note,
    quoteId:value.quote.id,quoteSha256:value.quote.sha256,quoteTitle:value.quote.title,
    acceptanceId:value.acceptance.id,acceptanceSha256:value.acceptance.material.sha256,
    baseTransferId:value.baseTransferId,previousId:value.baseTransferId,
    totals:copy(value.totals),taskIds:value.bindings.filter(row=>!row.accepted.retired).map(row=>row.taskId),
    material:copy(value.material)};
}
/** References resolve to original quotation and response materials in portable cases. */
export function readCommercialImplementationTransfers(context) {
  const history=[];
  for(const material of context.state.materials) {
    if(material.kind!==COMMERCIAL_IMPLEMENTATION_MATERIAL)continue;
    const bytes=Buffer.from(commissioningFileBytes(context.state,material.sha256));
    let value;
    try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{fail('COMMERCIAL_TRANSFER_CHANGED','A retained implementation transfer is not complete JSON.');}
    if(!plain(value)||value.schema!==COMMERCIAL_IMPLEMENTATION_SCHEMA||
        !UUID.test(value.id??'')||!UUID.test(value.caseId??'')||
        !['INITIAL','CHANGE_ORDER'].includes(value.mode)||
        material.id!=='commercial-implementation:'+value.id||material.taskIds.length||
        value.createdAt!==material.recordedAt||value.request?.actor!==material.actor||
        value.request?.action!=='adoptImplementation'||!HASH.test(value.request.sha256??'')||
        !HASH.test(value.reviewSha256??'')||!Array.isArray(value.bindings)||
        !plain(value.plan)||!plain(value.plan.accepted)||!plain(value.plan.applied)||
        !(value.baseTransferId===null||UUID.test(value.baseTransferId??'')))
      fail('COMMERCIAL_TRANSFER_CHANGED','A retained implementation transfer differs from its original material.');
    const quote=context.quotes.find(q=>q.id===value.quote?.id);
    if(!quote||quote.sha256!==value.quote.sha256||quote.originCaseId!==value.quote.originCaseId||
        quote.material.id!==value.quote.material?.id||quote.material.sha256!==value.quote.material.sha256)
      fail('COMMERCIAL_TRANSFER_QUOTE_CHANGED','Keep the original quotation material with its implementation transfer.');
    const response=originalResponse(context,quote,value.acceptance?.id);
    if(response.caseId!==value.acceptance.originCaseId||response.material.id!==value.acceptance.material?.id||
        response.material.sha256!==value.acceptance.material.sha256)
      fail('COMMERCIAL_TRANSFER_RESPONSE_CHANGED','Keep the complete original customer response with its implementation transfer.');
    if(new Set(value.bindings.map(row=>row.taskId)).size!==value.bindings.length||
        value.bindings.some(row=>!plain(row)||typeof row.taskId!=='string'||
          !Array.isArray(row.lineIds)||!plain(row.accepted)||!plain(row.applied)||
          !TASK_FIELDS.every(key=>Object.hasOwn(row.accepted,key)&&Object.hasOwn(row.applied,key))))
      fail('COMMERCIAL_TRANSFER_BINDINGS_CHANGED','A retained quoted-task binding is incomplete.');
    history.push({...value,material:{id:material.id,sha256:material.sha256,bytes:bytes.length}});
  }
  const byId=new Map(history.map(row=>[row.id,row]));
  if(byId.size!==history.length)fail('COMMERCIAL_TRANSFER_DUPLICATE','Implementation transfer identities must be distinct.');
  for(const value of history) {
    if(value.baseTransferId!==null&&!byId.has(value.baseTransferId))
      fail('COMMERCIAL_TRANSFER_PARENT_MISSING','Keep the previous accepted scope in this portable case.');
    const seen=new Set([value.id]);let previous=value.baseTransferId;
    while(previous!==null) {
      if(seen.has(previous))fail('COMMERCIAL_TRANSFER_CYCLE','Implementation transfer history contains a cycle.');
      seen.add(previous);previous=byId.get(previous)?.baseTransferId??null;
    }
  }
  const parents=new Set(history.map(row=>row.baseTransferId).filter(Boolean));
  const tips=history.filter(row=>!parents.has(row.id));
  history.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  return {history,active:tips.length===1?tips[0]:null,branched:tips.length>1};
}
export function commercialImplementationView(context) {
  const value=readCommercialImplementationTransfers(context);
  return {revision:context.state.revision,active:value.active?transferSummary(value.active):null,
    history:value.history.map(transferSummary),summary:commissioningSummary(context.state),
    ...(value.branched?{issues:[issue('COMMERCIAL_TRANSFER_BRANCHES',
      'This case contains parallel accepted-scope histories. Open the intended current case before applying another change.')]}:{})};
}
function quoteFamily(context,quote) {
  const seen=new Set();let current=quote;
  while(current.parentId) {
    if(seen.has(current.id))fail('COMMERCIAL_QUOTE_PARENT_CYCLE','The retained quotation revision history contains a cycle.');
    seen.add(current.id);
    const parent=context.quotes.find(row=>row.id===current.parentId);
    if(!parent)fail('COMMERCIAL_QUOTE_PARENT_MISSING','Keep the original parent quotation in this case.');
    current=parent;
  }
  return current.id;
}
function follows(context,quote,baseId) {
  let current=quote;const seen=new Set();
  while(current&&!seen.has(current.id)) {
    if(current.id===baseId)return true;
    seen.add(current.id);current=context.quotes.find(row=>row.id===current.parentId);
  }
  return false;
}
function amount(value) {
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,30})(?:\.\d{1,6})?$/.test(value))
    fail('COMMERCIAL_TRANSFER_AMOUNT','Keep the exact original USD amounts.');
  const [whole,fraction='']=value.split('.');
  return BigInt(whole)*1000000n+BigInt((fraction+'000000').slice(0,6));
}
function decimal(value) {
  const negative=value<0n,n=negative?-value:value;
  const fraction=String(n%1000000n).padStart(6,'0').replace(/0+$/,'');
  return (negative?'-':'')+String(n/1000000n)+(fraction?'.'+fraction:'');
}
function totals(before,after) {
  const names=['implementationUsd','recurringServiceUsd','routeUsageUsd','recurringUsd'];
  const empty={currency:'USD',implementationUsd:'0',recurringServiceUsd:'0',routeUsageUsd:'0',
    recurringUsd:'0',recurringPeriod:'MONTH'};
  before=before??empty;
  return {before:copy(before),after:copy(after),delta:{currency:'USD',recurringPeriod:'MONTH',
    ...Object.fromEntries(names.map(key=>[key,decimal(amount(after[key])-amount(before[key]))]))}};
}
function taskValues(task) {
  return Object.fromEntries(TASK_FIELDS.map(key=>[key,copy(task[key]??(key==='dependencies'?[]:key==='retired'?false:''))]));
}
function planText(value,label,quote) {
  return value.length<=16000?value:'Accepted '+label+' for '+quote.title+
    '. The complete text is retained in quotation '+quote.id+'.';
}
function planValues(quote) {
  return {title:quote.title,payer:quote.draft.customer.name,
    customerTask:planText(quote.draft.terms.scope,'scope',quote),
    outputDefinition:planText(quote.draft.terms.deliverables,'deliverables',quote),
    commercialReference:'urn:stellar-forge:commercial:quote:'+quote.id};
}
function selections(value) {
  if(value===undefined)return {};
  if(!plain(value)||Object.keys(value).length>10000||
      Object.entries(value).some(([key,choice])=>key.length>500||!['accepted','current'].includes(choice)))
    fail('COMMERCIAL_SCOPE_RESOLUTIONS','Use accepted or current for each reviewed conflicting field.');
  return copy(value);
}
function prepare(context,args) {
  if(!UUID.test(args.quoteId??'')||!HASH.test(args.quoteSha256??''))
    fail('COMMERCIAL_QUOTE_REQUIRED','Select an exact retained quotation.');
  const quote=context.quotes.find(row=>row.id===args.quoteId);
  if(!quote)fail('COMMERCIAL_QUOTE_NOT_FOUND','Choose a retained original quotation.',404);
  if(quote.sha256!==args.quoteSha256)fail('COMMERCIAL_QUOTE_CHANGED','The selected quotation bytes changed.',409);
  const resolutions=selections(args.resolutions),used=new Set(),conflicts=[],issues=[];
  const {history,active,branched}=readCommercialImplementationTransfers(context);
  const latest=quote.receiving.slice().sort(responseOrder)[0]??null;
  const selectedId=args.acceptanceId??latest?.id??null;
  let acceptance=null;
  if(!latest||latest.status!=='ACCEPTED')
    issues.push(issue('COMMERCIAL_ACCEPTANCE_REQUIRED','Record the current accepted customer response for this quotation.'));
  else if(selectedId!==latest.id)
    issues.push(issue('COMMERCIAL_ACCEPTANCE_CHANGED','A newer customer response exists. Review the current response.'));
  else {
    const response=originalResponse(context,quote,latest.id);
    acceptance={...copy(latest),material:copy(response.material),originCaseId:response.caseId};
  }
  if(branched)issues.push(issue('COMMERCIAL_TRANSFER_BRANCHES',
    'This case contains parallel accepted-scope histories. Open the intended current case before applying another change.'));
  if(active&&!follows(context,quote,active.quote.id))
    issues.push(issue('COMMERCIAL_CHANGE_PARENT','Revise the currently adopted quotation to keep the complete change-order chain.'));
  if(active?.quote.id===quote.id&&active.acceptance.id===selectedId)
    issues.push(issue('COMMERCIAL_ALREADY_ADOPTED','This exact accepted quotation is already the active implementation scope.'));
  const family=quoteFamily(context,quote),state=context.state;
  const previous=new Map((active?.bindings??[]).map(row=>[row.taskId,row]));
  const currentTasks=new Map(state.tasks.map(row=>[row.id,row]));
  const sourceTasks=new Map((quote.sourceBindings.implementation?.snapshot?.tasks??[]).map(row=>[row.id,row]));
  const target=new Map(),planPatch={},taskPatches=[],bindings=[];
  const changes={added:[],updated:[],retired:[],unchanged:[],plan:[]};
  function merge(subject,id,field,current,base,accepted,{initial=false}={}) {
    if(equal(current,accepted))return copy(current);
    if(equal(current,base))return copy(accepted);
    if(!initial&&equal(accepted,base))return copy(current);
    const key=subject+':'+id+':'+field,resolution=resolutions[key]??null;
    if(resolution!==null)used.add(key);
    conflicts.push({key,subject,...(subject==='task'?{taskId:id}:{}),field,
      current:copy(current),base:copy(base),accepted:copy(accepted),resolution});
    return copy(resolution==='accepted'?accepted:current);
  }
  for(const line of quote.lines.filter(row=>row.kind==='IMPLEMENTATION')) {
    const taskId=line.sourceRowId||
      'commercial-'+sha256(canonical({family,lineId:line.id})).slice(0,32);
    if(target.has(taskId)) {
      const grouped=target.get(taskId);grouped.lineIds.push(line.id);
      if(!grouped.titles.includes(line.title))grouped.titles.push(line.title);
      grouped.accepted.title=grouped.titles.join(' / ');continue;
    }
    const sourceTask=line.sourceRowId?sourceTasks.get(line.sourceRowId):null;
    if(line.sourceRowId&&!sourceTask) {
      issues.push(issue('COMMERCIAL_TASK_SOURCE_MISSING','The quotation is missing the original definition for task '+taskId+'.'));
      continue;
    }
    if(line.sourceRowId&&!currentTasks.has(taskId)) {
      issues.push(issue('COMMERCIAL_TASK_NOT_RECEIVED','Receive the complete original implementation case for task '+taskId+'.'));
      continue;
    }
    if(!line.sourceRowId&&currentTasks.has(taskId)&&!previous.has(taskId)&&!history.some(row=>row.bindings.some(b=>b.taskId===taskId))) {
      issues.push(issue('COMMERCIAL_TASK_ID_CONFLICT','The quoted line conflicts with an existing independent task '+taskId+'.'));
      continue;
    }
    const accepted=sourceTask?{title:line.title,acceptance:sourceTask.acceptance,
      dependencies:copy(sourceTask.dependencies),retired:false}:
      {title:line.title,acceptance:quote.draft.terms.acceptance,dependencies:[],retired:false};
    target.set(taskId,{taskId,lineIds:[line.id],titles:[line.title],accepted,sourceTask});
  }
  for(const wanted of target.values())if(wanted.accepted.title.length>2400)
    issues.push(issue('COMMERCIAL_QUOTED_TASK_TITLE_LIMIT',
      'The combined accepted titles for task '+wanted.taskId+' exceed the original task title limit. Use a shared task title or separate task identities in the quotation.'));
  // A revision removes only tasks previously bound to this accepted quotation.
  for(const prior of previous.values())if(!target.has(prior.taskId))
    target.set(prior.taskId,{taskId:prior.taskId,lineIds:copy(prior.lineIds),
      accepted:{...copy(prior.accepted),retired:true},sourceTask:null});
  for(const wanted of target.values()) {
    const existing=currentTasks.get(wanted.taskId),prior=previous.get(wanted.taskId);
    if(!existing&&wanted.accepted.retired)continue;
    const before=existing?copy(existing):null;
    if(!existing) {
      const after={id:wanted.taskId,title:wanted.accepted.title,acceptance:wanted.accepted.acceptance,
        owner:wanted.sourceTask?.owner||state.plan.implementationOwner||'',dueOn:wanted.sourceTask?.dueOn||'',
        status:'planned',notes:'',dependencies:copy(wanted.accepted.dependencies),retired:false};
      taskPatches.push(copy(after));changes.added.push({id:wanted.taskId,title:after.title,before:null,after:copy(after)});
      bindings.push({taskId:wanted.taskId,lineIds:wanted.lineIds,accepted:copy(wanted.accepted),applied:taskValues(after)});
      continue;
    }
    const after=copy(existing),patch={id:wanted.taskId};
    for(const field of TASK_FIELDS) {
      const base=prior?.accepted[field]??wanted.sourceTask?.[field]??existing[field];
      const value=merge('task',wanted.taskId,field,existing[field],base,wanted.accepted[field],{initial:!prior});
      after[field]=value;
      if(!equal(value,existing[field]))patch[field]=copy(value);
    }
    const row={id:wanted.taskId,title:after.title,before,after:copy(after)};
    if(Object.keys(patch).length===1)changes.unchanged.push(row);
    else {
      taskPatches.push(patch);
      (after.retired&&!existing.retired?changes.retired:changes.updated).push(row);
    }
    bindings.push({taskId:wanted.taskId,lineIds:wanted.lineIds,accepted:copy(wanted.accepted),applied:taskValues(after)});
  }
  const acceptedPlan=planValues(quote),basePlan=active?.plan.accepted||
    quote.sourceBindings.implementation?.snapshot?.plan||{};
  const appliedPlan={};
  for(const field of PLAN_FIELDS) {
    const current=state.plan[field]??'',base=basePlan[field]??'';
    const value=merge('plan',field,field,current,base,acceptedPlan[field],{initial:!active});
    appliedPlan[field]=value;
    if(value!==current) {
      planPatch[field]=value;
      changes.plan.push({id:field,field,title:field,before:current,after:value});
    }
  }
  for(const key of Object.keys(resolutions))if(!used.has(key))
    fail('COMMERCIAL_SCOPE_RESOLUTION_CHANGED','A selected conflicting field changed. Review the current case again.',409);
  const unresolved=conflicts.filter(row=>row.resolution===null);
  if(unresolved.length)issues.push(issue('COMMERCIAL_SCOPE_CHOICES_REQUIRED',
    'Choose the accepted scope or the current edit for each conflicting field, then review again.'));
  const selectedSource=quote.sourceBindings.implementation?.id;
  if(selectedSource&&selectedSource!==state.activeEditionId)
    issues.push(issue('COMMERCIAL_SOURCE_SELECTION_RETAINED',
      'The quoted workorder is retained; the current implementation source selection remains '+(state.activeEditionId||'unselected')+'.','warning'));
  const mode=active?'CHANGE_ORDER':'INITIAL';
  const review={schema:'stellar-forge.merchant-commercial-implementation-review.v1',
    scope:copy(context.scope),revision:context.revision,mode,quoteId:quote.id,quoteSha256:quote.sha256,
    quoteTitle:quote.title,acceptanceId:selectedId,acceptance,implementationRevision:state.revision,
    baseTransferId:active?.id??null,changes,conflicts,resolutions,totals:totals(active?.totals,quote.totals),
    issues,canApply:issues.every(row=>row.severity!=='error')};
  review.reviewSha256=sha256(canonical({review,planPatch,taskPatches,bindings,acceptedPlan,appliedPlan,
    baseTransferSha256:active?.material.sha256??null}));
  return {review,quote,acceptance,active,planPatch,taskPatches,bindings,acceptedPlan,appliedPlan};
}
function reviewIdentity(prepared) {
  const {reviewSha256,...review}=prepared.review;
  const {planPatch,taskPatches,bindings,acceptedPlan,appliedPlan,active}=prepared;
  return sha256(canonical({review,planPatch,taskPatches,bindings,acceptedPlan,appliedPlan,
    baseTransferSha256:active?.material.sha256??null}));
}
async function checkedPrepare(context,args) {
  const prepared=prepare(context,args),review=prepared.review;
  if(review.canApply) {
    // Exercise the original pure operations on the complete composed graph. This
    // catches interactions with unquoted tasks before the operator chooses Apply.
    let state=context.state;
    try {
      for(const [type,payload,suffix]of [
        ['update_plan',prepared.planPatch,'plan'],
        ['save_tasks',{tasks:prepared.taskPatches},'tasks'],
      ]) {
        if(type==='update_plan'&&!Object.keys(prepared.planPatch).length||
            type==='save_tasks'&&!prepared.taskPatches.length)continue;
        const value=await applyCommissioningCommand(state,{type,payload,
          requestId:'commercial-review:'+review.reviewSha256+':'+suffix,
          expectedRevision:state.revision,actor:'Commercial scope review',
          recordedAt:prepared.quote.createdAt});
        state=value.state;
      }
    } catch(error) {
      review.issues.push(issue(error.code||'COMMERCIAL_IMPLEMENTATION_INVALID',error.message));
      review.canApply=false;
    }
  }
  review.reviewSha256=reviewIdentity(prepared);
  return prepared;
}
export async function previewCommercialImplementation(context,args) {
  return (await checkedPrepare(context,args)).review;
}
function requestIdentity(args) {
  const requestArgs=copy(args);delete requestArgs.scope;
  return {action:'adoptImplementation',actor:args.actor,
    sha256:sha256(canonical({action:'adoptImplementation',args:requestArgs}))};
}
function caseReference(record) {
  return {id:record.id,revision:record.revision,workspaceSha256:sha256(record.workspaceText),
    supportSha256:record.supportText===null?null:sha256(record.supportText)};
}
/** All pure implementation commands are composed before the single original CAS save. */
export async function adoptCommercialImplementation({store,record,workspace,context,args}) {
  if(!UUID.test(args.requestId??'')||!HASH.test(args.expectedRevision??'')||
      !UUID.test(args.acceptanceId??'')||!HASH.test(args.reviewSha256??''))
    fail('COMMERCIAL_IMPLEMENTATION_REQUEST','Keep the original request, case revision, acceptance and reviewed scope.');
  requireText(args.actor,'operator name',200);
  requireText(args.note??'','implementation transfer note',16000,{empty:true});
  const request=requestIdentity(args);
  const history=readCommercialImplementationTransfers(context);
  const prior=history.history.find(row=>row.id===args.requestId);
  if(prior) {
    if(prior.caseId!==args.id||prior.request.action!==request.action||
        prior.request.actor!==request.actor||prior.request.sha256!==request.sha256)
      fail('REQUEST_CONFLICT','This request UUID belongs to different accepted-scope inputs.',409);
    return {state:'COMPLETE',requestId:args.requestId,replayed:true,
      document:{id:prior.id,kind:prior.mode,sha256:prior.material.sha256},
      case:caseReference(record),implementation:commercialImplementationView(context)};
  }
  if(context.state.events.some(row=>row.id===args.requestId))
    fail('REQUEST_CONFLICT','This request UUID belongs to another case operation.',409);
  if(record.revision!==args.expectedRevision)
    throw Object.assign(commercialError('CASE_CONFLICT','The saved case changed. Review its current accepted scope.',409),
      {currentRevision:record.revision});
  const prepared=await checkedPrepare(context,args),{review,quote,acceptance,active}=prepared;
  if(review.reviewSha256!==args.reviewSha256)
    fail('COMMERCIAL_IMPLEMENTATION_REVIEW_CHANGED','The quotation, customer response, case or scope choices changed. Review again.',409);
  if(!review.canApply)fail('COMMERCIAL_IMPLEMENTATION_REVIEW_REQUIRED',
    review.issues.filter(row=>row.severity==='error').map(row=>row.message).join(' '));
  const createdAt=new Date().toISOString();
  let state=context.state;
  async function apply(type,payload,suffix) {
    const result=await applyCommissioningCommand(state,{type,payload,
      requestId:suffix?args.requestId+':'+suffix:args.requestId,
      expectedRevision:state.revision,actor:args.actor,recordedAt:createdAt});
    if(result.replayed)fail('REQUEST_CONFLICT','A derived transfer operation already exists without its complete original transfer.',409);
    state=result.state;
  }
  if(Object.keys(prepared.planPatch).length)await apply('update_plan',prepared.planPatch,'plan');
  if(prepared.taskPatches.length)await apply('save_tasks',{tasks:prepared.taskPatches},'tasks');
  const document={schema:COMMERCIAL_IMPLEMENTATION_SCHEMA,id:args.requestId,mode:review.mode,
    caseId:args.id,createdAt,request,note:args.note??'',baseTransferId:active?.id??null,
    quote:{id:quote.id,sha256:quote.sha256,title:quote.title,originCaseId:quote.originCaseId,
      material:copy(quote.material)},
    acceptance:{id:acceptance.id,observedAt:acceptance.observedAt,recordedAt:acceptance.recordedAt,
      source:acceptance.source,note:acceptance.note,originCaseId:acceptance.originCaseId,
      material:copy(acceptance.material)},
    reviewSha256:review.reviewSha256,resolutions:copy(review.resolutions),totals:copy(quote.totals),
    terms:copy(quote.draft.terms),sourceBindings:Object.fromEntries(Object.entries(quote.sourceBindings).map(([kind,value])=>
      [kind,value?{id:value.id,sha256:value.sha256}:null])),
    bindings:copy(prepared.bindings),plan:{accepted:copy(prepared.acceptedPlan),applied:copy(prepared.appliedPlan)},
    changes:copy(review.changes),previousCaseRevision:record.revision,
    beforeImplementationRevision:context.state.revision,afterImplementationRevision:state.revision+1};
  const bytes=jsonBytes(document);
  if(bytes.length>MAX_MATERIAL_BYTES)fail('COMMERCIAL_IMPLEMENTATION_LIMIT','This complete accepted scope exceeds the original case material limit.');
  await apply('add_material',{id:'commercial-implementation:'+args.requestId,
    name:'merchant-implementation-transfer-'+args.requestId+'.json',mediaType:'application/json',
    data:encodeCommissioningBytes(bytes),kind:COMMERCIAL_IMPLEMENTATION_MATERIAL,
    description:review.mode==='INITIAL'?'Accepted quotation applied to implementation.':'Accepted quotation change order applied to implementation.',
    taskIds:[],editionId:state.activeEditionId,
    reference:'urn:stellar-forge:commercial-implementation:'+args.requestId},null);
  const workspaceText=await serializeWorkspace(workspaceDraft(workspace,{commissioning:state}),{now:workspace.savedAt});
  await store.save({id:record.id,expectedRevision:record.revision,workspaceText,
    supportText:record.supportText,metadata:record.metadata});
  const saved=await store.read(record.id);
  const savedWorkspace=await parseWorkspace(saved.workspaceText);
  const retained=savedWorkspace.commissioning.materials.find(row=>row.id==='commercial-implementation:'+args.requestId);
  if(!retained||retained.sha256!==sha256(bytes))
    fail('COMMERCIAL_IMPLEMENTATION_SAVE_CHANGED','Read back the original case before recovering this transfer.',409);
  return {state:'COMPLETE',requestId:args.requestId,replayed:false,
    document:{id:document.id,kind:document.mode,sha256:retained.sha256},case:caseReference(saved)};
}
