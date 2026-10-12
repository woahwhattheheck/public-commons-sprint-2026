// MIT. Implementation commands through the existing SF74 case writer.
import {createHash} from 'node:crypto';
import {parseWorkspace,serializeWorkspace} from './workspace-file.mjs';
import {workorderFromSources} from './workorder-source.mjs';
import {termsDocumentFromDraft} from './terms-editor.mjs';
import {
  newCommissioning,validateCommissioning,applyCommissioningCommand,commissioningSummary,
  commissioningWorkorder,commissioningOriginalFiles,commissioningFileBytes,
  commissioningComparisons,encodeCommissioningBytes,commissioningError,
} from './commissioning.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const copy=value=>JSON.parse(JSON.stringify(value));
const fields=(value,allowed)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))
    throw commissioningError('INVALID_COMMISSIONING_REQUEST','Unexpected implementation request fields');
};
const caseRef=record=>({id:record.id,revision:record.revision,workspaceSha256:sha(record.workspaceText),
  supportSha256:record.supportText===null?null:sha(record.supportText)});
function requireRevision(value) {
  if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw commissioningError('INVALID_CASE_REVISION','Use the original case revision');
}
function conflict(record) {
  return Object.assign(commissioningError('CASE_CONFLICT','The saved case changed. Read its current revision before applying this operation.',409),
    {currentRevision:record.revision});
}
function workspaceDraft(workspace,commissioning) {
  return {name:workspace.name,inputs:workspace.inputs,sources:workspace.sources,termsText:workspace.termsText,
    baselineOnly:workspace.baselineOnly,...(workspace.workorderSource?{workorderSource:workspace.workorderSource}:{}),
    commissioning};
}
export function savedCaseWorkorderInputs(record,workspace) {
  if(!workspace.termsText)throw commissioningError('CASE_TERMS_REQUIRED','Record the workorder terms in this case');
  const draft=JSON.parse(workspace.termsText);
  fields(draft,['schema','values']);
  if(draft.schema!=='stellar-forge.merchant-terms-draft.v1')
    throw commissioningError('CASE_TERMS_INVALID','Open the original terms draft in the support console');
  const terms=termsDocumentFromDraft(draft.values);
  const inputs={terms:Buffer.from(JSON.stringify(terms,null,2)+'\n').toString('base64')};
  if(workspace.workorderSource==='runtime') {
    if(!record.supportText)throw commissioningError('CASE_RUNTIME_REQUIRED','Keep the original runtime capture attached to this case');
    inputs.supportText=record.supportText;inputs.inputs=workspace.inputs;
  } else {
    inputs.before=workspace.sources.before;
    if(!workspace.baselineOnly&&workspace.sources.after) {
      inputs.after=workspace.sources.after;
      if(Boolean(workspace.sources.postBefore)!==Boolean(workspace.sources.postAfter))
        throw commissioningError('CASE_SOURCE_PAIR_REQUIRED','Select both original browser checks or neither');
      if(workspace.sources.postBefore){inputs.postBefore=workspace.sources.postBefore;inputs.postAfter=workspace.sources.postAfter;}
    }
  }
  return inputs;
}
function originalEditionPayload(state,editionId) {
  const {edition,packet}=commissioningWorkorder(state,editionId),inputs={};
  for(const [key,digest] of Object.entries(edition.inputs)) {
    const bytes=commissioningFileBytes(state,digest);
    inputs[key]=key==='supportText'?new TextDecoder('utf-8',{fatal:true}).decode(bytes):encodeCommissioningBytes(bytes);
  }
  if(edition.runtimeMapping)inputs.inputs=copy(edition.runtimeMapping);
  const decode=ref=>new TextDecoder('utf-8',{fatal:true}).decode(commissioningFileBytes(state,ref));
  return {result:{packet,html:decode(edition.html),checklist:decode(edition.checklist)},inputs,sourceCase:edition.sourceCase};
}
async function saveResult(store,record,workspace,next) {
  if(next.replayed)return {case:caseRef(record),revision:next.revision,result:next.result,replayed:true,
    summary:commissioningSummary(next.state)};
  const workspaceText=await serializeWorkspace(workspaceDraft(workspace,next.state),{now:workspace.savedAt});
  const saved=await store.save({id:record.id,expectedRevision:record.revision,workspaceText,
    supportText:record.supportText,metadata:record.metadata});
  return {case:{id:record.id,revision:saved.case.revision,workspaceSha256:sha(workspaceText),
    supportSha256:record.supportText===null?null:sha(record.supportText)},revision:next.revision,
    result:next.result,replayed:false,summary:commissioningSummary(next.state)};
}
export async function operateCaseCommissioning(store,args) {
  fields(args,['id','expectedRevision','command']);requireRevision(args.expectedRevision);
  const record=await store.read(args.id),workspace=await parseWorkspace(record.workspaceText);
  const state=workspace.commissioning??newCommissioning();
  const replay=state.events.some(row=>row.id===args.command?.requestId);
  if(record.revision!==args.expectedRevision&&!replay)throw conflict(record);
  const next=await applyCommissioningCommand(state,args.command);
  return saveResult(store,record,workspace,next);
}
/** Prepare once from the selected saved case; recovery reuses that exact edition. */
export async function prepareCaseCommissioning(store,args) {
  fields(args,['id','expectedRevision','expectedImplementationRevision','requestId','actor','recordedAt']);
  requireRevision(args.expectedRevision);
  const record=await store.read(args.id),workspace=await parseWorkspace(record.workspaceText),
    state=workspace.commissioning??newCommissioning();
  const retained=state.events.find(row=>row.id===args.requestId);
  let payload;
  if(retained) {
    if(retained.type!=='record_workorder'||!retained.result.editionId)
      throw commissioningError('REQUEST_CONFLICT','This request belongs to another implementation operation',409);
    payload=originalEditionPayload(state,retained.result.editionId);
    if(payload.sourceCase?.revision!==args.expectedRevision||payload.sourceCase?.id!==args.id)
      throw commissioningError('REQUEST_CONFLICT','This request belongs to a different original case revision',409);
  } else {
    if(record.revision!==args.expectedRevision)throw conflict(record);
    const inputs=savedCaseWorkorderInputs(record,workspace);
    payload={result:workorderFromSources(inputs,args.recordedAt?{generatedAt:args.recordedAt}:{}),
      inputs,sourceCase:caseRef(record)};
  }
  const next=await applyCommissioningCommand(state,{type:'record_workorder',requestId:args.requestId,
    actor:args.actor,expectedRevision:args.expectedImplementationRevision,payload,
    ...(args.recordedAt?{recordedAt:args.recordedAt}:{})});
  return saveResult(store,record,workspace,next);
}
export async function inspectCaseCommissioning(store,args) {
  fields(args,['id','revision','section','offset','limit']);
  const record=await store.read(args.id,args.revision??null),workspace=await parseWorkspace(record.workspaceText);
  const state=workspace.commissioning??newCommissioning();
  const section=args.section??'overview',offset=args.offset??0,limit=args.limit??50;
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)
    throw commissioningError('INVALID_COMMISSIONING_QUERY','Use a nonnegative offset and a limit from 1 to 200');
  const base={case:caseRef(record),summary:commissioningSummary(state)};
  if(section==='overview')return {...base,plan:state.plan,comparisonCount:commissioningComparisons(state).length};
  let rows;
  if(['tasks','materials','receiving','measurements','events','editions'].includes(section))rows=state[section];
  else if(section==='files')rows=commissioningOriginalFiles(state);
  else if(section==='comparisons')rows=commissioningComparisons(state);
  else throw commissioningError('INVALID_COMMISSIONING_QUERY','Unknown implementation section');
  return {...base,section,rows:copy(rows.slice(offset,offset+limit)),total:rows.length,offset,limit,
    nextOffset:offset+limit<rows.length?offset+limit:null};
}
