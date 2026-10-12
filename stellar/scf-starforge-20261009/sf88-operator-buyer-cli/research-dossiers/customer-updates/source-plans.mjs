// MIT. Bind a customer source plan to the original saved Europe PMC query edition.
import {canonical,sha256,searchSelection} from '../../../sf30-seller-sdk/europe-pmc/source.mjs';
import {customerFields,customerIdentifier,customerText,customerRevision,requireCustomerUpdate as need} from './contracts.mjs';
export function customerEuropePmcPlan({query,queryRevision,workspaceId,library,questionId,planId,name,constraints=''}){
  const revision=customerRevision(queryRevision),selected=query?.versions?.find(row=>row.revision===revision);
  need(selected&&selected.id===query.id&&/^epq_[a-f0-9]{64}$/.test(selected.id),'CUSTOMER_UPDATE_ORIGINAL_QUERY_REQUIRED');
  const {sha256:hash,requestId,...body}=selected;
  need(typeof requestId==='string'&&sha256(Buffer.from(canonical(body)))===hash&&
    canonical(searchSelection(selected.selection))===canonical(selected.selection),'CUSTOMER_UPDATE_ORIGINAL_QUERY_CHANGED');
  need(typeof workspaceId==='string'&&/^epw_[a-f0-9]{64}$/.test(workspaceId)&&
    typeof library==='string'&&/^(?:original|received-[a-f0-9]{64})$/.test(library),'CUSTOMER_UPDATE_SOURCE_WORKSPACE_REQUIRED');
  return {id:customerIdentifier(planId),name:customerText(name??selected.title,'CUSTOMER_UPDATE_PLAN_NAME_REQUIRED',240),
    questionId:customerIdentifier(questionId),provider:'europe-pmc',
    query:customerText(selected.selection.query,'CUSTOMER_UPDATE_QUERY_REQUIRED',20000),
    parameters:structuredClone(selected.selection),
    original:{kind:'EUROPE_PMC_QUERY',workspaceId,library,queryId:selected.id,queryRevision:revision,querySha256:hash,
      queryRequestId:requestId},terms:selected.sourceTerms,
    constraints:customerText(constraints,'CUSTOMER_UPDATE_CONSTRAINTS_INVALID',20000,true)};
}
export async function inspectCustomerEuropePmcPlan(controller,input){
  customerFields(input,['queryId','queryRevision','questionId','planId','name','constraints','library']);
  need(controller&&typeof controller.call==='function'&&typeof controller.selection==='function','CUSTOMER_UPDATE_EUROPE_PMC_REQUIRED');
  const before=controller.selection().library;
  need(input.library===undefined||input.library===before,'EUROPE_PMC_SELECTION_CHANGED');
  const library=await controller.call('list',{limit:1}),query=await controller.call('query',input.queryId);
  need(controller.selection().library===before,'EUROPE_PMC_SELECTION_CHANGED');
  return customerEuropePmcPlan({...input,query,workspaceId:library.id,library:before});
}
export function validateCustomerEuropePmcIntake(plan,edition,projected){
  if(plan.original?.kind!=='EUROPE_PMC_QUERY')return;
  need(edition.provider==='europe-pmc'&&edition.mode==='retained'&&edition.origin?.mode==='EUROPE_PMC_WORKSPACE',
    'CUSTOMER_UPDATE_ORIGINAL_EUROPE_PMC_INTAKE_REQUIRED');
  const raw=projected?.raw;
  need(raw?.metadata&&canonical(raw.metadata.selection)===canonical(plan.parameters)&&
    raw.sourceTerms===plan.terms,'CUSTOMER_UPDATE_SOURCE_QUERY_CHANGED');
}
