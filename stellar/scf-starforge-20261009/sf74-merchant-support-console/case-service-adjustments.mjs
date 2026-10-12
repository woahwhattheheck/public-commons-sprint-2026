// MIT. Complete service-to-accounting work through the original saved Support case.
import {createHash} from 'node:crypto';
import {join,resolve,isAbsolute} from 'node:path';
import {parseWorkspace,serializeWorkspace,workspaceDraft} from './workspace-file.mjs';
import {newCommissioning} from './commissioning.mjs';
import {serviceCanonical,renderServiceReport,validateServiceRecord} from './service-commitments.mjs';
import {
  SERVICE_ADJUSTMENT_PROPOSAL_SCHEMA,SERVICE_ADJUSTMENT_INTENT_SCHEMA,
  SERVICE_ADJUSTMENT_OUTCOME_SCHEMA,readServiceAdjustments,prepareServiceAdjustment,
  retainServiceAdjustment,validateServiceAdjustmentMaterial,serviceAdjustmentError
} from './service-adjustments.mjs';
import {
  previewNativeServiceAdjustment,prepareNativeServiceAdjustmentIntent,
  executeNativeServiceAdjustment,validateNativeServiceAdjustmentOutcome
} from './service-adjustments-native.mjs';

import {
  SERVICE_BUYER_INTENT_SCHEMA,SERVICE_BUYER_OUTCOME_SCHEMA,readServiceBuyerHandovers,serviceBuyerSummary,
  inspectServiceBuyerWorkspace,previewServiceBuyerAccountantReturn,prepareServiceBuyerIntent,executeServiceBuyerIntent,
  retainServiceBuyerMaterial,serviceBuyerFile
} from './service-buyer-handover.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const copy=value=>structuredClone(value),same=(a,b)=>serviceCanonical(a)===serviceCanonical(b);
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fields(value,allowed,required=[]){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key))||
      required.some(key=>!Object.hasOwn(value,key)))
    throw serviceAdjustmentError('INVALID_SERVICE_ADJUSTMENT_REQUEST','Supply the complete original service adjustment request.');
}
function id(value){if(typeof value!=='string'||!UUID.test(value))throw serviceAdjustmentError('INVALID_CASE_ID','Use the original case or request UUID.');return value;}
function digest(value){if(typeof value!=='string'||!SHA.test(value))throw serviceAdjustmentError('INVALID_CASE_REVISION','Use the original saved case revision.');return value;}
function conflict(record){return Object.assign(serviceAdjustmentError('CASE_CONFLICT','The saved case changed. Reopen it before retaining this reviewed adjustment.',409),{currentRevision:record.revision});}
function reference(record){return {id:record.id,revision:record.revision,currentRevision:record.currentRevision??record.revision,
  workspaceSha256:sha(record.workspaceText),name:record.name,updatedAt:record.updatedAt,metadata:record.metadata};}
function briefProposal(value){
  const request=value.nativePreview.request,detail=value.nativePreview.detail;
  return {id:value.id,sha256:value.sha256,createdAt:value.createdAt,actor:value.actor,accountingId:value.accountingId,
    report:{id:value.report.id,sha256:value.report.sha256,period:value.report.preview.period,
      title:value.report.preview.terms.title,customer:value.report.preview.terms.customer},
    incidentIds:copy(value.incidentIds),basis:copy(value.basis),
    native:{kind:request.kind,amountAtomic:request.amountAtomic,effectiveAt:request.effectiveAt,
      reference:request.reference,runId:request.runId,eventId:request.eventId,
      network:detail.event.network,asset:detail.refundTerms?.asset??detail.originalProof?.asset??null}};
}
function briefIntent(value){return {id:value.id,sha256:value.sha256,proposalId:value.proposalId,action:value.action,
  createdAt:value.createdAt,actor:value.actor,request:copy(value.request)};}
function briefOutcome(value){return {id:value.id,sha256:value.sha256,intentId:value.intentId,proposalId:value.proposalId,
  action:value.action,createdAt:value.createdAt,actor:value.actor,
  native:{adjustmentId:value.result.adjustment.id,status:value.result.adjustment.status,
    ...(value.result.job?{jobId:value.result.job.id,jobStatus:value.result.job.status,transaction:value.result.job.transaction}:{}),
    ...(value.result.export?{export:copy(value.result.export),buyerSource:copy(value.result.buyer.source_identity)}:{})}};
}
function reportChoice(report){return {id:report.id,sha256:report.sha256,createdAt:report.createdAt,
  title:report.preview.terms.title,customer:report.preview.terms.customer,period:copy(report.preview.period),
  summary:copy(report.preview.summary),incidents:report.preview.incidents.length};}
function descriptor(filename,mediaType,body){return {filename,mediaType,bytes:body.length,sha256:sha(body)};}
function fileResult(filename,mediaType,body){body=Buffer.isBuffer(body)?body:Buffer.from(body);return {descriptor:descriptor(filename,mediaType,body),body};}
function verifiedFile(file){
  const body=Buffer.from(file.base64,'base64');
  if(body.toString('base64')!==file.base64||body.length!==file.bytes||sha(body)!==file.sha256)
    throw serviceAdjustmentError('SERVICE_ADJUSTMENT_FILE_CHANGED','The original retained adjustment file changed.',409);
  return body;
}
function customerDocument(record,proposal,intents,outcomes){
  const p=briefProposal(proposal),rows=proposal.report.preview.incidents.filter(row=>proposal.incidentIds.includes(row.id));
  const observations=outcomes.map(value=>'<tr><td>'+html(value.createdAt)+'</td><td>'+html(value.action)+'</td><td>'+
    html(value.result.adjustment.status)+'</td><td>'+html(value.result.job?.transaction??value.result.adjustment.reference)+'</td></tr>').join('');
  return '<!doctype html>\n<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Service adjustment · '+html(record.name)+'</title><style>'+
    'body{font:15px/1.55 system-ui,sans-serif;color:#202020;background:#fff;margin:0}main{max-width:1050px;margin:48px auto;padding:0 24px}'+
    'h1{font-size:29px;margin:0 0 8px}h2{font-size:20px;margin-top:32px}p{max-width:86ch}dl{display:grid;grid-template-columns:190px 1fr;gap:8px 18px}dt{font-weight:650}dd{margin:0;overflow-wrap:anywhere}'+
    'table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ccc;padding:10px 8px;overflow-wrap:anywhere}'+
    '.muted{color:#5b5b5b}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;border:1px solid #ddd;padding:16px;font-size:12px}'+
    '@media print{main{margin:0}h2{break-after:avoid}tr{break-inside:avoid}}@media(max-width:640px){main{margin:24px auto;padding:0 16px}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:12px}table{font-size:11px}}</style>'+
    '<main><p class="muted">Merchant service operations</p><h1>Service adjustment</h1><p>'+html(p.report.customer)+' · '+html(p.report.title)+'</p>'+
    '<dl><dt>Original case</dt><dd>'+html(record.name)+' · '+html(record.id)+'</dd><dt>Reviewed by</dt><dd>'+html(proposal.actor)+'</dd>'+
    '<dt>Monetary basis</dt><dd>'+html(proposal.basis.amountAtomic)+' atomic units · '+html(proposal.basis.reference)+'</dd>'+
    '<dt>Basis description</dt><dd>'+html(proposal.basis.description)+'</dd><dt>Requested adjustment</dt><dd>'+html(p.native.kind)+' · '+html(p.native.amountAtomic)+' atomic units</dd>'+
    '<dt>Original payment</dt><dd>'+html(p.native.network)+' · '+html(p.native.asset??'Asset selected by the original ledger')+'<br>'+html(p.native.eventId)+'</dd>'+
    '<dt>Native reference</dt><dd>'+html(proposal.nativePreview.request.reference)+'</dd><dt>Reason</dt><dd>'+html(proposal.nativePreview.request.reason)+'</dd>'+
    '<dt>Reviewed incidents</dt><dd>'+rows.length+'</dd></dl>'+
    '<h2>Native adjustment history</h2><table><thead><tr><th>Observed</th><th>Operation</th><th>State</th><th>Original reference</th></tr></thead><tbody>'+
    (observations||'<tr><td colspan="4">Reviewed proposal retained.</td></tr>')+'</tbody></table>'+
    '<h2>Service and accounting references</h2><p>The original service report, selected incidents, original payment and retained accounting results travel together in the complete handover.</p>'+
    '<dl><dt>Service report</dt><dd>'+html(proposal.report.id)+'</dd><dt>Proposal</dt><dd>'+html(proposal.id)+'</dd>'+
    '<dt>Reconciliation</dt><dd>'+html(p.native.runId)+'</dd><dt>Saved case revision</dt><dd>'+html(record.revision)+'</dd></dl>'+
    '<h2>Selected service observations</h2><table><thead><tr><th>Condition</th><th>Opened</th><th>Response / target</th><th>Recovery / target</th><th>Owner and follow-up</th></tr></thead><tbody>'+rows.map(row=>'<tr><td>'+html(row.kind)+'<br>'+html(row.status)+'</td><td>'+html(row.openedAt)+'</td><td>'+html(row.response.serviceMinutes)+' / '+html(row.response.targetMinutes)+' min<br>'+html(row.response.state)+'</td><td>'+html(row.recovery.serviceMinutes)+' / '+html(row.recovery.targetMinutes)+' min<br>'+html(row.recovery.state)+'</td><td>'+html(row.owner)+'<br>'+html(row.followUp)+'</td></tr>').join('')+'</tbody></table></main></html>\n';
}

/** Accounting is the already configured native owner; this case wrapper never opens its directory. */
export function openCaseServiceAdjustments({store,accounting=null,buyer=null,directory}){
  if(!store||typeof store.read!=='function'||typeof store.save!=='function')
    throw new TypeError('Select the original Support case store.');
  if(typeof directory!=='string'||!isAbsolute(directory))
    throw new TypeError('Select the original private service adjustment directory.');
  directory=resolve(directory);
  let closing=false;
  const calls=new Set();
  const owner=()=>{
    if(!accounting||typeof accounting.withServiceAdjustments!=='function')
      throw serviceAdjustmentError('SERVICE_ADJUSTMENT_ACCOUNTING_REQUIRED','Configure the original merchant accounting workspaces to prepare and execute adjustments.',503);
    return accounting;
  };
  const buyerOwner=()=>{
    if(!buyer||typeof buyer.withServiceBuyerWorkspace!=='function')
      throw serviceAdjustmentError('SERVICE_BUYER_REQUIRED','Configure and open the original buyer expense workspace.',503);
    return buyer;
  };
  const track=async operation=>{
    if(closing)throw serviceAdjustmentError('SERVICE_ADJUSTMENT_CLOSING','Service adjustments are closing.',503);
    const pending=Promise.resolve().then(operation);calls.add(pending);
    try{return await pending;}finally{calls.delete(pending);}
  };
  const original=async(caseId,revision=null)=>{
    id(caseId);if(revision!==null)digest(revision);
    const record=await store.read(caseId,revision),workspace=await parseWorkspace(record.workspaceText);
    const context={caseId:record.id,caseRevision:record.revision,workspaceSha256:sha(record.workspaceText),
      service:await validateServiceRecord(workspace.service),commissioning:workspace.commissioning??newCommissioning()};
    const view=await readServiceAdjustments(context);
    return {record,workspace,context,view};
  };
  const save=async(before,{requestId,expectedImplementationRevision,material},retainer=retainServiceAdjustment)=>{
    const next=await retainer(before.context,{requestId,expectedRevision:expectedImplementationRevision,material});
    if(next.replayed)return {case:reference(before.record),revision:next.revision,material:next.material,replayed:true};
    const workspaceText=await serializeWorkspace(workspaceDraft(before.workspace,{commissioning:next.commissioning}),{now:before.workspace.savedAt});
    const result=await store.save({id:before.record.id,expectedRevision:before.record.revision,workspaceText,
      supportText:before.record.supportText,metadata:before.record.metadata});
    return {case:{...reference(before.record),revision:result.case.revision,currentRevision:result.case.revision,
      workspaceSha256:sha(workspaceText),updatedAt:result.case.updatedAt},revision:next.revision,material:next.material,replayed:false};
  };
  const savedExecution=(before,args)=>{
    const event=before.context.commissioning.events.find(row=>row.id===args.requestId);
    if(!event)return null;
    const material=before.view.outcomes.find(row=>row.id===event.result?.materialId);
    if(event.type!=='add_material'||!material||material.intentId!==args.intentId)
      throw serviceAdjustmentError('SERVICE_ADJUSTMENT_REQUEST_CONFLICT','This case request belongs to a different original operation.',409);
    return {case:reference(before.record),revision:before.view.revision,material:copy(material),replayed:true};
  };
  const api={
    async read(args){return track(async()=>{
      fields(args,['id','revision','section','recordId','offset','limit'],['id']);
      const before=await original(args.id,args.revision??null),section=args.section??'overview';
      const common={case:reference(before.record),revision:before.view.revision,accountingConfigured:Boolean(accounting),
        counts:{proposals:before.view.proposals.length,intents:before.view.intents.length,outcomes:before.view.outcomes.length},
        reports:before.context.service.reports.map(reportChoice)};
      if(section==='overview'){
        if(args.recordId!==undefined)throw serviceAdjustmentError('INVALID_SERVICE_ADJUSTMENT_REQUEST','Select a section for its complete original record.');
        return {...common,proposals:before.view.proposals.map(briefProposal),intents:before.view.intents.map(briefIntent),
          outcomes:before.view.outcomes.map(briefOutcome)};
      }
      const all=section==='reports'?before.context.service.reports:before.view[section];
      if(!Array.isArray(all))throw serviceAdjustmentError('INVALID_SERVICE_ADJUSTMENT_SECTION','Select proposals, intents, outcomes or reports.');
      if(args.recordId!==undefined){
        const selected=all.filter(row=>row.id===args.recordId||row.sha256===args.recordId);
        if(!selected.length)throw serviceAdjustmentError('SERVICE_ADJUSTMENT_NOT_FOUND','The selected original adjustment record is absent.',404);
        return {...common,section,records:copy(selected)};
      }
      const offset=args.offset??0,limit=args.limit??25;
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)
        throw serviceAdjustmentError('INVALID_SERVICE_ADJUSTMENT_PAGE','Use a page of 1 to 100 original records.');
      const summarize=section==='proposals'?briefProposal:section==='intents'?briefIntent:section==='outcomes'?briefOutcome:reportChoice;
      return {...common,section,records:all.slice(offset,offset+limit).map(summarize),offset,limit,total:all.length,
        nextOffset:offset+limit<all.length?offset+limit:null};
    });},
    async sources(){return track(async()=>accounting?owner().call('merchant_accounting_sources',{}):{workspaces:[]});},
    async accountingOperation(method,args){return track(async()=>{
      fields(args,['accountingId','runId','eventId','offset','limit','search'],['accountingId']);
      if(method==='runs'){
        fields(args,['accountingId','offset','limit'],['accountingId']);
        const {accountingId,...page}=args;
        return owner().call('merchant_accounting_status',{workspace:accountingId,view:'runs',...page});
      }
      if(method==='open'||method==='close'||method==='status'){
        fields(args,['accountingId'],['accountingId']);
        return owner().call('merchant_accounting_'+method,{workspace:args.accountingId});
      }
      return owner().withServiceAdjustments(args.accountingId,async controller=>{
        if(method==='event'){
          fields(args,['accountingId','runId','eventId'],['accountingId','runId','eventId']);
          return controller.event(args.runId,args.eventId);
        }
        if(method==='events'){
          fields(args,['accountingId','runId','offset','limit','search'],['accountingId','runId']);
          const {accountingId,...query}=args;return controller.events(query);
        }
        throw serviceAdjustmentError('INVALID_SERVICE_ADJUSTMENT_ACTION','Select an original accounting read or workspace operation.');
      });
    });},
    async preview(args){return track(async()=>{
      fields(args,['id','expectedRevision','input'],['id','expectedRevision','input']);digest(args.expectedRevision);
      const before=await original(args.id);if(before.record.revision!==args.expectedRevision)throw conflict(before.record);
      fields(args.input,['id','reportId','reportSha256','incidentIds','basis','accountingId','request','actor'],
        ['id','reportId','reportSha256','incidentIds','basis','accountingId','request','actor']);
      id(args.input.id);
      fields(args.input.request,['runId','eventId','kind','amountAtomic','effectiveAt','reason','reference'],
        ['runId','eventId','kind','amountAtomic','effectiveAt','reason','reference']);
      const request={...copy(args.input.request),id:args.input.id,actor:args.input.actor};
      const nativePreview=await owner().withServiceAdjustments(args.input.accountingId,controller=>previewNativeServiceAdjustment(controller,request));
      const {request:unused,...input}=args.input;
      const proposal=await prepareServiceAdjustment(before.context,{...copy(input),nativePreview});
      return {case:reference(before.record),revision:before.view.revision,proposal};
    });},
    async prepareIntent(args){return track(async()=>{
      fields(args,['id','expectedRevision','input'],['id','expectedRevision','input']);digest(args.expectedRevision);
      const before=await original(args.id);if(before.record.revision!==args.expectedRevision)throw conflict(before.record);
      fields(args.input,['id','proposalId','action','actor','input'],['id','proposalId','action','actor','input']);
      const proposal=before.view.proposals.find(row=>row.id===args.input.proposalId);
      if(!proposal)throw serviceAdjustmentError('SERVICE_ADJUSTMENT_PROPOSAL_REQUIRED','Save the reviewed proposal before preparing its native action.',409);
      const intent=await owner().withServiceAdjustments(proposal.accountingId,
        controller=>prepareNativeServiceAdjustmentIntent(controller,before.context,args.input));
      return {case:reference(before.record),revision:before.view.revision,intent};
    });},
    async retain(args){return track(async()=>{
      fields(args,['id','expectedRevision','expectedImplementationRevision','requestId','material'],
        ['id','expectedRevision','expectedImplementationRevision','requestId','material']);
      id(args.requestId);digest(args.expectedRevision);
      if(![SERVICE_ADJUSTMENT_PROPOSAL_SCHEMA,SERVICE_ADJUSTMENT_INTENT_SCHEMA].includes(args.material?.schema))
        throw serviceAdjustmentError('INVALID_SERVICE_ADJUSTMENT_MATERIAL','Retain the reviewed proposal or prepared original native intent.');
      let before=await original(args.id);
      const replay=before.context.commissioning.events.some(row=>row.id===args.requestId);
      if(before.record.revision!==args.expectedRevision&&!replay)throw conflict(before.record);
      await validateServiceAdjustmentMaterial(before.context,args.material);
      try{return await save(before,args);}
      catch(error){
        if(error.code==='CASE_CONFLICT'){
          before=await original(args.id);
          if(before.context.commissioning.events.some(row=>row.id===args.requestId))return save(before,args);
        }
        throw error;
      }
    });},
    async execute(args){return track(async()=>{
      fields(args,['id','intentId','requestId'],['id','intentId','requestId']);id(args.intentId);id(args.requestId);
      let before=await original(args.id),replay=savedExecution(before,args);if(replay)return replay;
      const intent=before.view.intents.find(row=>row.id===args.intentId);
      if(!intent)throw serviceAdjustmentError('SERVICE_ADJUSTMENT_INTENT_REQUIRED','Save the exact native intent before execution.',409);
      const proposal=before.view.proposals.find(row=>row.id===intent.proposalId);
      const outcome=await owner().withServiceAdjustments(proposal.accountingId,controller=>
        executeNativeServiceAdjustment(controller,{context:before.context,intentId:intent.id,directory}));
      // The native request is already complete or its original job is retained.
      // Only append these returned bytes while preserving newer unrelated case work.
      for(let attempt=0;attempt<8;attempt++){
        before=await original(args.id);replay=savedExecution(before,args);if(replay)return replay;
        await validateNativeServiceAdjustmentOutcome(before.context,outcome,{directory:join(directory,'case-outcomes',args.id,outcome.id)});
        try{return await save(before,{requestId:args.requestId,expectedImplementationRevision:before.view.revision,material:outcome});}
        catch(error){if(error.code!=='CASE_CONFLICT'||attempt===7)throw error;}
      }
    });},
    async buyerSources(){return track(async()=>buyer?buyerOwner().call('merchant_buyer_expense_workspaces',{}):{workspaces:[]});},
    async buyerOperation(method,args){return track(async()=>{
      fields(args,['buyerWorkspace','instanceId','view','offset','limit'],['buyerWorkspace']);
      const action={open:'open',close:'close',status:'state'}[method];
      if(!action)throw serviceAdjustmentError('INVALID_SERVICE_BUYER_ACTION','Select an original buyer workspace operation.');
      const {buyerWorkspace,...input}=args;
      return buyerOwner().call('merchant_buyer_expense_'+action,{workspace:buyerWorkspace,...input});
    });},
    async buyerRead(args){return track(async()=>{
      fields(args,['id','revision','section','recordId','offset','limit'],['id']);
      const before=await original(args.id,args.revision??null),view=await readServiceBuyerHandovers(before.context);
      const summary=serviceBuyerSummary(view),common={case:reference(before.record),buyerConfigured:Boolean(buyer),revision:view.revision};
      const section=args.section??'overview';
      if(section==='overview'){
        if(args.recordId!==undefined)throw serviceAdjustmentError('INVALID_SERVICE_BUYER_SECTION','Select the original record section.');
        return {...common,...summary};
      }
      const all=view[section],brief=summary[section];
      if(!Array.isArray(all)||!Array.isArray(brief))throw serviceAdjustmentError('INVALID_SERVICE_BUYER_SECTION','Select captures, intents or outcomes.');
      if(args.recordId!==undefined){
        const selected=all.filter(row=>row.id===args.recordId);
        if(!selected.length)throw serviceAdjustmentError('SERVICE_BUYER_NOT_FOUND','The selected original buyer record is absent.',404);
        return {...common,section,records:copy(selected)};
      }
      const offset=args.offset??0,limit=args.limit??25;
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)
        throw serviceAdjustmentError('INVALID_SERVICE_BUYER_PAGE','Use a page of 1 to 100 original records.');
      return {...common,section,records:brief.slice(offset,offset+limit),offset,limit,total:all.length,
        nextOffset:offset+limit<all.length?offset+limit:null};
    });},
    async inspectBuyer(args){return track(async()=>{
      fields(args,['id','revision','input'],['id','input']);
      const before=await original(args.id,args.revision??null);
      const selection=await inspectServiceBuyerWorkspace(buyerOwner(),before.context,args.input);
      return {case:reference(before.record),revision:before.view.revision,...selection};
    });},
    async previewBuyerAccountantReturn(args){return track(async()=>{
      fields(args,['id','revision','input'],['id','input']);
      const before=await original(args.id,args.revision??null);
      const preview=await previewServiceBuyerAccountantReturn(buyerOwner(),before.context,args.input);
      return {case:reference(before.record),revision:before.view.revision,...preview};
    });},
    async prepareBuyerIntent(args){return track(async()=>{
      fields(args,['id','expectedRevision','input'],['id','expectedRevision','input']);digest(args.expectedRevision);
      const before=await original(args.id);if(before.record.revision!==args.expectedRevision)throw conflict(before.record);
      const intent=await prepareServiceBuyerIntent(buyerOwner(),before.context,args.input,{directory,accounting});
      return {case:reference(before.record),revision:before.view.revision,intent};
    });},
    async retainBuyer(args){return track(async()=>{
      fields(args,['id','expectedRevision','expectedImplementationRevision','requestId','material'],
        ['id','expectedRevision','expectedImplementationRevision','requestId','material']);
      id(args.requestId);digest(args.expectedRevision);
      if(args.material?.schema!==SERVICE_BUYER_INTENT_SCHEMA)
        throw serviceAdjustmentError('INVALID_SERVICE_BUYER_MATERIAL','Retain the complete prepared buyer intent.');
      let before=await original(args.id);
      const replay=before.context.commissioning.events.some(row=>row.id===args.requestId);
      if(before.record.revision!==args.expectedRevision&&!replay)throw conflict(before.record);
      try{return await save(before,args,retainServiceBuyerMaterial);}
      catch(error){
        if(error.code==='CASE_CONFLICT'){
          before=await original(args.id);
          if(before.context.commissioning.events.some(row=>row.id===args.requestId))return save(before,args,retainServiceBuyerMaterial);
        }
        throw error;
      }
    });},
    async executeBuyer(args){return track(async()=>{
      fields(args,['id','intentId','requestId'],['id','intentId','requestId']);id(args.intentId);id(args.requestId);
      const recover=async before=>{
        const event=before.context.commissioning.events.find(row=>row.id===args.requestId);
        if(!event)return null;
        const view=await readServiceBuyerHandovers(before.context),material=view.outcomes.find(row=>row.id===event.result?.materialId);
        if(event.type!=='add_material'||!material||material.intentId!==args.intentId)
          throw serviceAdjustmentError('SERVICE_BUYER_REQUEST_CONFLICT','This case request belongs to another original operation.',409);
        return {case:reference(before.record),revision:view.revision,material:copy(material),replayed:true};
      };
      let before=await original(args.id),replay=await recover(before);if(replay)return replay;
      const view=await readServiceBuyerHandovers(before.context),intent=view.intents.find(row=>row.id===args.intentId);
      if(!intent)throw serviceAdjustmentError('SERVICE_BUYER_INTENT_REQUIRED','Save the exact original buyer intent before executing it.',409);
      const outcome=await executeServiceBuyerIntent(buyerOwner(),{context:before.context,intentId:intent.id,directory,accounting});
      if(outcome.schema!==SERVICE_BUYER_OUTCOME_SCHEMA)throw serviceAdjustmentError('INVALID_SERVICE_BUYER_OUTCOME','The original buyer operation returned a different result.');
      for(let attempt=0;attempt<8;attempt++){
        before=await original(args.id);replay=await recover(before);if(replay)return replay;
        try{return await save(before,{requestId:args.requestId,expectedImplementationRevision:before.view.revision,material:outcome},retainServiceBuyerMaterial);}
        catch(error){if(error.code!=='CASE_CONFLICT'||attempt===7)throw error;}
      }
    });},
    async downloadBuyer(args){return track(async()=>{
      fields(args,['id','revision','outcomeId','name'],['id','revision','outcomeId','name']);digest(args.revision);id(args.outcomeId);
      const before=await original(args.id,args.revision),file=await serviceBuyerFile(before.context,{outcomeId:args.outcomeId,name:args.name});
      return fileResult(file.name,file.type,Buffer.from(file.bytes));
    });},
    async download(args){return track(async()=>{
      fields(args,['id','revision','proposalId','proposalSha256','outcomeId','kind'],
        ['id','revision','proposalId','proposalSha256','kind']);
      digest(args.revision);id(args.proposalId);digest(args.proposalSha256);
      const before=await original(args.id,args.revision),proposal=before.view.proposals.find(row=>row.id===args.proposalId&&row.sha256===args.proposalSha256);
      if(!proposal)throw serviceAdjustmentError('SERVICE_ADJUSTMENT_PROPOSAL_CHANGED','Choose the exact proposal in its original saved case.',409);
      const intents=before.view.intents.filter(row=>row.proposalId===proposal.id),outcomes=before.view.outcomes.filter(row=>row.proposalId===proposal.id);
      const name='service-adjustment-'+proposal.id;
      if(args.kind==='handover'){
        if(args.outcomeId!==undefined)throw serviceAdjustmentError('INVALID_SERVICE_ADJUSTMENT_FILE','The complete handover includes all original outcomes.');
        return fileResult(name+'.json','application/json',json({schema:'stellar-forge.merchant-service-adjustment-handover.v1',
          case:{...reference(before.record),currentRevision:before.record.revision},proposal,intents,outcomes,buyer:await readServiceBuyerHandovers(before.context)}));
      }
      if(args.kind==='customer-html')return fileResult(name+'.html','text/html; charset=utf-8',customerDocument(before.record,proposal,intents,outcomes));
      if(args.kind==='service-report')return fileResult('service-report-'+proposal.report.id+'.html','text/html; charset=utf-8',renderServiceReport(proposal.report));
      if(args.kind==='case')return fileResult('case.json','application/json',json({...before.record,currentRevision:before.record.revision}));
      if(args.kind==='workspace')return fileResult('merchant-workspace.json','application/json',before.record.workspaceText);
      if(!['native-json','native-csv','native-html','buyer-source'].includes(args.kind))
        throw serviceAdjustmentError('INVALID_SERVICE_ADJUSTMENT_FILE','Choose an original retained handover file.');
      id(args.outcomeId);
      const outcome=outcomes.find(row=>row.id===args.outcomeId&&row.action==='capture');
      if(!outcome)throw serviceAdjustmentError('SERVICE_ADJUSTMENT_CAPTURE_REQUIRED','Select the saved buyer capture for these exact native files.',404);
      if(args.kind==='buyer-source')return fileResult('buyer-adjustment-source-'+outcome.id+'.json','application/json',json(outcome.result.buyer));
      if(args.kind==='native-json'){
        const original=outcome.result.buyer.files[0];
        return fileResult(original.original_name,'application/json',verifiedFile(original));
      }
      const type=args.kind==='native-csv'?'text/csv':'text/html',file=outcome.result.files.find(value=>value.type===type);
      if(!file)throw serviceAdjustmentError('SERVICE_ADJUSTMENT_FILE_CHANGED','The original complete native file is absent.',409);
      return fileResult(file.name,file.type+'; charset=utf-8',verifiedFile(file));
    });},
    async close(){closing=true;await Promise.allSettled([...calls]);}
  };
  return api;
}
