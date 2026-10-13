// MIT. Complete Source Desk tools over the existing Grant owner and retained files.
import {
  INSTALLATION_SOURCE_MAX_FILE_BYTES, INSTALLATION_SOURCE_SCHEMA,
  prepareInstallationSourceCommand, prepareInstallationSourceUpload, prepareInstallationSourceReview,
  prepareInstallationSourceMapping, prepareInstallationSourceMappingWire,
  validateInstallationSourceOperation,
} from '../../stellar/scf_2026/sf47_budget_model/workspace/installation-source-desk-agent.mjs';
import {createHash} from 'node:crypto';

const prefix='source_desk_';
const reads={
  profiles:'profiles',list:'list',detail:'detail',request:'request',file_inspect:'file-inspect',
  file:'file',preparation:'preparation',archive_describe:'archive-describe',archive:'archive',
  output:'output',commissioning_inspect:'commissioning-inspect',commissioning_preview:'commissioning-preview',
  archive_inspect:'archive-inspect',mapping_compare:'mapping-compare-wire',mapping_preview:'mapping-preview-wire',
};
export const grantInstallationSourceVerbs=new Set([
  ...Object.keys(reads).map(key=>prefix+key),
  prefix+'command_prepare',prefix+'upload_prepare',prefix+'review_prepare',prefix+'mapping_prepare',prefix+'execute',prefix+'reconcile',
]);
const need=(test,message)=>{if(!test)throw Object.assign(new Error(message),{code:'GRANT_INSTALLATION_SOURCE_INPUT'});};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const decode=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
const clone=value=>JSON.parse(JSON.stringify(value));
const without=(value,...keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
async function originalJSON(args,ctx,inlineKey,maximum=32*1024*1024){
  need((args[inlineKey]!==undefined)!==(args.input!==undefined),
    'Select one complete inline original or a SHA-bound retained input.');
  if(args[inlineKey]!==undefined){
    need(args.expectedInputSha256===undefined,'An inline original has no separate input-file digest.');
    need(plain(args[inlineKey]),'Keep the complete original object.');
    return clone(args[inlineKey]);
  }
  need(typeof args.expectedInputSha256==='string','Keep the complete original input SHA256.');
  const selected=await ctx.load(args.input,args.expectedInputSha256);
  need(selected.bytes.length<=maximum,'The original prepared operation fits its complete native request bound.');
  const value=decode(selected.bytes);need(plain(value),'Select the complete original JSON object.');return value;
}
function frozenResponse(value,ctx){
  const bytes=Buffer.from(JSON.stringify(value)+'\n');
  return {value,bytes,mediaType:'application/json',status:200,sha256:sha(bytes),
    filename:value.request.requestId+'.source-desk-operation.json',
    source:{schema:'stellar-forge.sf47-source-desk-prepared.v1',
      workspace:ctx.alias,selectionSha256:ctx.binding.selectionSha256}};
}
function bindOperation(operation,ctx){
  return prepareInstallationSourceCommand(operation.caseId,operation.draftId,operation.request,{
    workspaceDirectory:ctx.binding.directory,...(operation.review===undefined?{}:{review:operation.review})});
}
export async function executeGrantInstallationSourceTool(verb,args,ctx){
  // Preserve the selected caller values before reading a host alias or original service.
  args=clone(args);
  need(grantInstallationSourceVerbs.has(verb),'Choose a declared complete Source Desk tool.');
  const suffix=verb.slice(prefix.length);
  const selected=without(args,'workspace');
  if(reads[suffix]){
    const response=await ctx.client.installationSources(reads[suffix],selected);
    return ctx.retain(response,{tool:'merchant_grant_'+verb,...without(selected,'body','phaseIdAmendment')});
  }
  let operation;
  if(suffix==='command_prepare'){
    const body=await originalJSON(args,ctx,'body');
    operation=prepareInstallationSourceCommand(args.caseId,args.draftId,body,{workspaceDirectory:ctx.binding.directory});
  }else if(suffix==='upload_prepare'){
    const loaded=await ctx.load(args.input,args.expectedInputSha256);
    need(loaded.bytes.length>0&&loaded.bytes.length<=INSTALLATION_SOURCE_MAX_FILE_BYTES,
      'Retain one complete original Source Desk file within 8 MiB.');
    const metadata={filename:args.filename,mediaType:args.mediaType,sourceUrl:args.sourceUrl,
      observedAt:args.observedAt,expectedSha256:args.expectedInputSha256};
    const context={expectedRevision:args.expectedRevision,requestId:args.requestId,actor:args.actor,
      ...(args.note===undefined?{}:{note:args.note})};
    operation=bindOperation(prepareInstallationSourceUpload(args.caseId,args.draftId,loaded.bytes,metadata,context),ctx);
  }else if(suffix==='mapping_prepare'){
    const plan=await originalJSON(args,ctx,'plan',96*1024*1024);
    const isWire=plan.schema==='stellar-forge.installation-mapping-wire.v1';
    const prepare=isWire?prepareInstallationSourceMappingWire:prepareInstallationSourceMapping;
    const prepared=prepare(plan,{
      requestId:args.requestId,actor:args.actor,...(args.note===undefined?{}:{note:args.note})});
    need(prepared.caseId===args.caseId&&prepared.draftId===args.draftId,
      'Keep the full mapping review bound to its original case and target draft.');
    operation=bindOperation(prepared,ctx);
  }else if(suffix==='review_prepare'){
    const review=await originalJSON(args,ctx,'review');
    need(review.caseId===args.caseId&&review.draftId===args.draftId,
      'Keep the saved review bound to its original case and draft.');
    operation=bindOperation(prepareInstallationSourceReview(review,{
      requestId:args.requestId,actor:args.actor,...(args.note===undefined?{}:{note:args.note})}),ctx);
  }else{
    const saved=await originalJSON(args,ctx,'operation');
    operation=validateInstallationSourceOperation(saved,{caseId:args.caseId,draftId:args.draftId,
      workspaceDirectory:ctx.binding.directory});
    need(operation.workspaceDirectory===ctx.binding.directory,
      'Receive an operation prepared for this exact original workspace directory.');
    const result=await ctx.client.installationSources(suffix,{operation});
    const original=await ctx.retain(result.response,{tool:'merchant_grant_'+verb,
      caseId:operation.caseId,draftId:operation.draftId,requestId:operation.request.requestId,
      action:operation.request.action,requestSha256:operation.requestSha256,
      operationSha256:operation.operationSha256});
    return {schema:INSTALLATION_SOURCE_SCHEMA,workspace:args.workspace,state:result.state,replayed:result.replayed,
      requestId:operation.request.requestId,requestSha256:operation.requestSha256,
      operationSha256:operation.operationSha256,original};
  }
  const retained=await ctx.retain(frozenResponse(operation,ctx),{
    tool:'merchant_grant_'+verb,caseId:operation.caseId,draftId:operation.draftId,
    requestId:operation.request.requestId,action:operation.request.action,
    requestSha256:operation.requestSha256,operationSha256:operation.operationSha256});
  return {schema:INSTALLATION_SOURCE_SCHEMA,workspace:args.workspace,state:'PREPARED',
    caseId:operation.caseId,draftId:operation.draftId,requestId:operation.request.requestId,
    action:operation.request.action,requestSha256:operation.requestSha256,operationSha256:operation.operationSha256,
    operation:retained,execute:retained.retention?.state==='COMPLETE'?{
      tool:'merchant_grant_source_desk_execute',workspace:args.workspace,caseId:operation.caseId,draftId:operation.draftId,
      input:{snapshotId:retained.id},expectedInputSha256:retained.file.sha256}:null};
}
