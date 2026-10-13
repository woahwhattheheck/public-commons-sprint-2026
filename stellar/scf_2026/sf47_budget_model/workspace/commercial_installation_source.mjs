// MIT. Read a complete original SF74 accepted quotation into Customer Installation.
// The original commercial/implementation engines supply every accepted task ID.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {WORKSPACE_SCHEMA,parseWorkspace}
  from '../../../scf-starforge-20261009/sf74-merchant-support-console/workspace-file.mjs';
import {HANDOFF_SCHEMA,importRuntimeHandoff}
  from '../../../scf-starforge-20261009/sf74-merchant-support-console/runtime-support.mjs';
import {commercialContext,readCommercialDocuments}
  from '../../../scf-starforge-20261009/sf74-merchant-support-console/commercial-quote.mjs';
import {inspectAcceptedCommercialImplementation}
  from '../../../scf-starforge-20261009/sf74-merchant-support-console/case-commercial-implementation.mjs';
import {readCommercialEconomics} from '../../../scf-starforge-20261009/sf74-merchant-support-console/commercial/economics.mjs';
import {commissioningOriginalFiles}
  from '../../../scf-starforge-20261009/sf74-merchant-support-console/commissioning.mjs';

export const COMMERCIAL_INSTALLATION_SOURCE_SCHEMA='stellar-forge.sf47-commercial-installation-source.v1';
const MAX_INPUT=8*1024*1024,MAX_OUTPUT=16*1024*1024;
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const ordered=value=>Array.isArray(value)?value.map(ordered):plain(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const canonical=value=>JSON.stringify(ordered(value));
const clone=value=>JSON.parse(JSON.stringify(value));
const error=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
const responseOrder=(a,b)=>String(b.observedAt).localeCompare(String(a.observedAt))||
  String(b.recordedAt).localeCompare(String(a.recordedAt))||b.id.localeCompare(a.id);
function boundedText(value,limit,label,reference) {
  if(typeof value!=='string')throw error('COMMERCIAL_ACCEPTED_DEFINITION','The original '+label+' is not complete text.');
  return value.length<=limit?value:label+' is retained in full in '+reference+'. Open the complete original quotation and source alongside this Installation.';
}
function ancestors(context,quote) {
  const result=[],seen=new Set([quote.id]);let current=quote;
  while(current.parentId) {
    if(seen.has(current.parentId))throw error('COMMERCIAL_QUOTE_PARENT_CYCLE','Retained quotation ancestry contains a cycle.');
    const prior=context.quotes.find(row=>row.id===current.parentId);
    if(!prior)throw error('COMMERCIAL_QUOTE_PARENT_MISSING','Keep every original parent quotation in this source.');
    seen.add(prior.id);result.push(prior);current=prior;
  }
  return result;
}
function selection(value) {
  if(!plain(value)||Object.keys(value).sort().join(',')!=='acceptanceId,acceptanceSha256,quoteId,quoteSha256'||
    !UUID.test(value.quoteId??'')||!UUID.test(value.acceptanceId??'')||
    !HASH.test(value.quoteSha256??'')||!HASH.test(value.acceptanceSha256??''))
    throw error('COMMERCIAL_SELECTION_REQUIRED','Select the original quotation and current recorded customer response by their exact IDs and SHA-256 values.');
  return clone(value);
}
function originalResponse(context,quote,response) {
  const document=context.documents.find(row=>row.kind==='RESPONSE'&&row.id===response.id);
  if(!document||document.payload.quoteId!==quote.id||document.payload.quoteSha256!==quote.sha256)
    throw error('COMMERCIAL_RESPONSE_CHANGED','Keep this original customer response with its quotation.');
  return document;
}
function quoteSummary(context,quote) {
  const latest=quote.receiving.slice().sort(responseOrder)[0]??null;
  const accepted=latest?.status==='ACCEPTED'?[{
    id:latest.id,sha256:originalResponse(context,quote,latest).material.sha256,
    observedAt:latest.observedAt,recordedAt:latest.recordedAt,actor:latest.actor,
    reference:latest.source,note:latest.note
  }]:[];
  return {id:quote.id,sha256:quote.sha256,parentId:quote.parentId,title:quote.title,
    reference:'urn:stellar-forge:commercial:quote:'+quote.id,
    summary:quote.draft.terms.scope,customer:quote.draft.customer.name,
    totals:clone(quote.totals),acceptances:accepted,
    latestResponse:latest?clone(latest):null,
    unavailableReason:accepted.length?null:'The current original customer response is '+
      (latest?latest.status:'not recorded')+'. Record its actual acceptance in Merchant Support before receiving this scope.'};
}
async function readerIdentity() {
  // These are the original entry points. The complete maintained application
  // source bundle also retains their native imported dependencies.
  const entries=[
    ['./commercial_installation_source.mjs','sf47/commercial_installation_source.mjs'],
    ['./cohort_planning.mjs','sf47/cohort_planning.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/commercial/economics.mjs','sf74/commercial/economics.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/case-commercial-implementation.mjs','sf74/case-commercial-implementation.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/commercial-quote.mjs','sf74/commercial-quote.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/commercial-pricing.mjs','sf74/commercial-pricing.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/workspace-file.mjs','sf74/workspace-file.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/runtime-support.mjs','sf74/runtime-support.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/commissioning.mjs','sf74/commissioning.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/service-commitments.mjs','sf74/service-commitments.mjs']
  ];
  const result={};for(const [path,label]of entries)result[label]=hash(await readFile(new URL(path,import.meta.url)));
  return result;
}
export async function inspectCommercialInstallationSource(raw,selected=null) {
  if(!Buffer.isBuffer(raw))raw=Buffer.from(raw);
  if(!raw.length||raw.length>MAX_INPUT)
    throw error('COMMERCIAL_SOURCE_SIZE','Select a complete original merchant workspace or Support handoff up to 8 MiB.',413);
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
  let file;try{file=JSON.parse(text);}catch{throw error('COMMERCIAL_SOURCE_INVALID','The original commercial source is not complete UTF-8 JSON.');}
  if(!plain(file))throw error('COMMERCIAL_SOURCE_KIND','Select the complete original workspace or Support handoff.');
  let workspace,workspaceText,metadata=null,supportSha256=null;
  if(file.schema===WORKSPACE_SCHEMA){workspaceText=text;workspace=await parseWorkspace(text);}
  else if(file.schema===HANDOFF_SCHEMA){
    const imported=await importRuntimeHandoff(text);workspaceText=imported.workspaceText;
    workspace=await parseWorkspace(workspaceText);metadata=imported.metadata??null;
    supportSha256=hash(imported.supportText);
  }else throw error('COMMERCIAL_SOURCE_KIND','Use the complete saved Merchant Support workspace or Support handoff, including original quotation and customer-response materials.');
  if(!workspace.commissioning)throw error('COMMERCIAL_SOURCE_EMPTY','This workspace has no retained implementation or commercial materials.');
  const documents=readCommercialDocuments(workspace.commissioning,null);
  const first=documents.find(row=>row.kind==='QUOTE');
  if(!first)throw error('COMMERCIAL_QUOTE_NOT_FOUND','This complete workspace contains no original published quotation.');
  const sourceHash=hash(raw);
  // A portable workspace intentionally has no mutable case-store directory/HEAD.
  // Original document case UUIDs remain provenance; this read's revision is the
  // selected file hash and is never submitted to a case writer.
  const context=await commercialContext(workspace,{
    caseId:first.caseId,workspaceId:'portable-source:'+sourceHash,revision:hash(workspaceText)});
  const originalFiles=commissioningOriginalFiles(context.state);
  const externalFiles=originalFiles.filter(row=>!Object.hasOwn(context.state.blobs,row.sha256));
  const result={schema:COMMERCIAL_INSTALLATION_SOURCE_SCHEMA,
    source:{sha256:sourceHash,bytes:raw.length,schema:file.schema},
    case:{name:workspace.name,savedAt:workspace.savedAt,workspaceSha256:hash(workspaceText),
      supportSha256,metadata:clone(metadata),
      originalCaseIds:[...new Set(documents.map(row=>row.caseId))].sort()},
    quotes:context.quotes.map(quote=>quoteSummary(context,quote)),externalFiles:clone(externalFiles),
    reader:await readerIdentity(),economics:readCommercialEconomics(context)};
  if(selected!==null){
    selected=selection(selected);
    const quote=context.quotes.find(row=>row.id===selected.quoteId);
    if(!quote||quote.sha256!==selected.quoteSha256)
      throw error('COMMERCIAL_QUOTE_CHANGED','The selected original quotation differs from this source.',409);
    const latest=quote.receiving.slice().sort(responseOrder)[0]??null;
    if(!latest||latest.status!=='ACCEPTED'||latest.id!==selected.acceptanceId)
      throw error('COMMERCIAL_ACCEPTANCE_CHANGED','Use the current recorded accepted response for the selected quotation.',409);
    const response=originalResponse(context,quote,latest);
    if(response.material.sha256!==selected.acceptanceSha256)
      throw error('COMMERCIAL_RESPONSE_CHANGED','The selected original response bytes differ.',409);
    const ancestry=ancestors(context,quote),family=ancestry.at(-1)||quote;
    const read=await inspectAcceptedCommercialImplementation(context,{
      quoteId:quote.id,quoteSha256:quote.sha256,acceptanceId:latest.id,resolutions:{}});
    const invalid=read.review.issues.filter(row=>row.severity==='error'&&row.code!=='COMMERCIAL_ALREADY_ADOPTED');
    if(invalid.length)throw error(invalid[0].code,invalid.map(row=>row.message).join(' '));
    const acceptedTasks=read.tasks.filter(row=>!row.accepted.retired);
    if(!acceptedTasks.length)throw error('COMMERCIAL_IMPLEMENTATION_EMPTY','The selected quotation has no accepted implementation tasks. Keep recurring service and route-only terms in their original commercial workflow.');
    const reference='urn:stellar-forge:commercial:quote:'+quote.id;
    const tasks=acceptedTasks.map(row=>({
      id:row.taskId,lineIds:clone(row.lineIds),definition:clone(row.accepted),
      title:boundedText(row.accepted.title,500,'Accepted task '+row.taskId,reference),
      acceptance:boundedText(row.accepted.acceptance,8000,'Acceptance criterion for task '+row.taskId,reference),
      dependencies:clone(row.accepted.dependencies),
      definitionSha256:hash(canonical(row.accepted))
    }));
    const scope={
      title:boundedText(quote.title,300,'Quotation title',reference),reference,payer:quote.draft.customer.name,
      summary:boundedText(quote.draft.terms.scope,8000,'Accepted scope',reference),
      terms:boundedText(quote.customerDocument,8000,'Complete agreed quotation and terms',reference),
      tasks,fields:{
        name:boundedText(quote.title,300,'Quotation title',reference),
        'task.name':quote.title,
        'task.purpose':boundedText(quote.draft.terms.scope,4000,'Customer purpose',reference),
        'task.request':boundedText(quote.draft.terms.scope,8000,'Complete customer request',reference),
        'task.completeOutput':boundedText(quote.draft.terms.deliverables,4000,'Accepted deliverables',reference),
        'source.reference':reference,
        'source.authority':'Recorded customer response '+latest.id+' at '+latest.observedAt+
          ', retained in the original source; reference: '+latest.source,
        'source.changePolicy':'Receive a later accepted edition in the same quotation lineage; retain previous saved Installation editions.',
        'receiving.acceptanceRule':boundedText(quote.draft.terms.acceptance,4000,'Agreed acceptance rule',reference),
        'assignments.commercialRef':reference
      }
    };
    scope.fields['source.authority']=boundedText(scope.fields['source.authority'],4000,'Customer response authority',reference);
    result.caseKey=family.originCaseId+':'+family.id;
    result.selected={...selected,ancestorQuoteIds:ancestry.map(row=>row.id),
      scopeSha256:hash(canonical({schema:COMMERCIAL_INSTALLATION_SOURCE_SCHEMA,
        quoteId:quote.id,quoteSha256:quote.sha256,acceptanceId:response.id,
        acceptanceSha256:response.material.sha256,plan:read.plan,tasks:acceptedTasks,terms:quote.draft.terms})),
      scope,acceptedPlan:clone(read.plan),acceptedTasks:clone(acceptedTasks),
      originalReview:clone(read.review),quote:clone(quote),acceptance:clone(response),
      quoteText:quote.customerDocument,
      economics:result.economics.assessments.filter(row=>row.quoteId===quote.id&&row.quoteSha256===quote.sha256)};
  }
  if(Buffer.byteLength(JSON.stringify(result))>MAX_OUTPUT)
    throw error('COMMERCIAL_REVIEW_SIZE','The complete original commercial read exceeds 16 MiB.',413);
  return result;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  try{
    const args=process.argv.slice(2);
    if(args.length!==0&&(args.length!==2||args[0]!=='--selection'))
      throw error('COMMERCIAL_SELECTION_REQUIRED','Supply --selection with the exact original quotation and customer-response identities.');
    const selected=args.length?JSON.parse(args[1]):null;
    const chunks=[];let size=0;
    for await(const chunk of process.stdin){size+=chunk.length;if(size>MAX_INPUT)throw error('COMMERCIAL_SOURCE_SIZE','The original source exceeds 8 MiB.',413);chunks.push(chunk);}
    const result=await inspectCommercialInstallationSource(Buffer.concat(chunks),selected);
    process.stdout.write(JSON.stringify({ok:true,result})+'\n');
  }catch(cause){
    const code=typeof cause.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(cause.code)?cause.code:'COMMERCIAL_SOURCE_INVALID';
    process.stdout.write(JSON.stringify({ok:false,error:{code,message:String(cause.message||'The original commercial source could not be read.').slice(0,1200),
      status:[409,413].includes(cause.status)?cause.status:422}})+'\n');process.exitCode=2;
  }
}
