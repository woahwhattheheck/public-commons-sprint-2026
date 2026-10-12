// MIT. Typed customer updates through an existing ResearchWorkspaceClient transport.
import {CUSTOMER_UPDATES_SCHEMA,CUSTOMER_UPDATE_OPERATION_SCHEMA,customerFields,customerIdentifier,customerRevision,
  customerJson,customerObject,customerUpdateInput,requireCustomerUpdate as need} from './contracts.mjs';
import {customerUpdateDigest} from './context.mjs';
const parameters=value=>{const query=new URLSearchParams();for(const [key,item]of Object.entries(value??{}))
  if(item!==undefined&&item!==null)query.set(key,String(item));return query.size?'?'+query.toString():'';};
const path=id=>{need(typeof id==='string'&&/^d_[a-f0-9-]{36}$/.test(id),'DOSSIER_ID_INVALID');
  return '/api/dossiers/'+id+'/customer-updates';};
const copy=value=>{need(customerObject(value??{}),'CUSTOMER_UPDATE_OPTIONS_INVALID');
  return customerJson(Object.fromEntries(Object.entries(value??{}).filter(([,item])=>item!==undefined)));};
function identity(value,id,{revision,schema}={}){
  need(value?.dossierId===id&&Number.isSafeInteger(value.revision)&&value.revision>=1&&
    (revision===undefined||value.revision===revision)&&(!schema||value.schema===schema),'CUSTOMER_UPDATE_RESPONSE_CHANGED');
  return value;
}
function page(value){
  if(value.items!==undefined){
    need(Array.isArray(value.items)&&Number.isSafeInteger(value.offset)&&value.offset>=0&&
      Number.isSafeInteger(value.total)&&value.total>=value.offset+value.items.length&&
      (value.nextOffset===null||value.nextOffset===value.offset+value.items.length)&&
      value.complete===(value.nextOffset===null),'CUSTOMER_UPDATE_PAGE_CHANGED');
  }
  return value;
}
export function createCustomerUpdatesClient({request,download}={}){
  need(typeof request==='function'&&typeof download==='function','CUSTOMER_UPDATE_ORIGINAL_CLIENT_REQUIRED');
  return Object.freeze({
    async list(id,options={},transport={}){
      const selected=copy(options);
      return page(identity(await request(path(id)+parameters(selected),undefined,transport),id,
        {revision:selected.revision,schema:CUSTOMER_UPDATES_SCHEMA}));
    },
    async record(id,input,transport={}){
      const selected=copy(input);
      const value=identity(await request(path(id)+'/record',selected,{...transport,readOnly:true}),id,
        {revision:selected.revision,schema:'sf88-research-customer-update-record/v1'});
      need(value.path===selected.path&&value.sha256===customerUpdateDigest(value.record)&&
        (selected.sha256===undefined||value.sha256===selected.sha256),'CUSTOMER_UPDATE_NATIVE_RECORD_CHANGED');return value;
    },
    async preview(id,input,transport={}){
      const selected=copy(input),value=identity(await request(path(id)+'/preview',selected,{...transport,readOnly:true}),id,
        {revision:selected.revision,schema:'sf88-research-customer-update-preview/v1'});
      need(selected.fingerprint===undefined||selected.fingerprint===value.fingerprint,'CUSTOMER_UPDATE_CONTEXT_CHANGED');
      return page(value);
    },
    async review(id,input,transport={}){
      const selected=customerUpdateInput(input);
      const value=await request(path(id)+'/reviews?projection=metadata',selected,transport);
      need(value?.dossier?.id===id&&Number.isSafeInteger(value.dossier.revision)&&
        value.operation?.schema===CUSTOMER_UPDATE_OPERATION_SCHEMA&&value.operation.dossierId===id&&
        value.operation.requestId===selected.requestId&&value.operation.requestSha256===customerUpdateDigest(selected)&&
        value.operation.action===selected.action&&typeof value.duplicate==='boolean','CUSTOMER_UPDATE_RESPONSE_CHANGED');
      return value;
    },
    async work(id,input,transport={}){
      const selected=copy(input),value=await request(path(id)+'/work'+parameters(selected),undefined,transport);
      need(value?.schema==='sf88-research-customer-update-saved-work/v1'&&value.dossierId===id&&
        value.workId===selected.workId&&Number.isSafeInteger(value.revision)&&Number.isSafeInteger(value.workspaceRevision)&&
        (selected.revision===undefined||value.workspaceRevision===selected.revision),'CUSTOMER_UPDATE_WORK_RESPONSE_CHANGED');
      return page(value);
    },
    export(id,{file,expectedSha256,signal,...input}={}){
      const selected=copy(input);return download(path(id)+'/export'+parameters(selected),file,{expectedSha256,signal});
    },
    async europePmcPlan(input,transport={}){
      const selected=copy(input),value=await request('/api/customer-updates/europe-pmc-plan',selected,{...transport,readOnly:true});
      need(value?.schema==='sf88-research-customer-source-plan/v1'&&value.plan?.id===selected.planId&&
        value.plan.questionId===selected.questionId&&value.plan.original?.queryId===selected.queryId&&
        value.plan.original.queryRevision===selected.queryRevision,'CUSTOMER_UPDATE_SOURCE_PLAN_CHANGED');
      return value;
    },
  });
}
