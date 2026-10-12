// MIT. Borrow the original Research owner, native customer engine and file ledger.
import {exact,failure} from './host-files.mjs';
export {RESEARCH_CUSTOMER_UPDATE_PREFIX} from './catalog/research-customer-updates.mjs';
const selected=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
export async function callResearchCustomerUpdates(client,name,args){
  const api=client.customerUpdates();
  if(name==='merchant_research_customer_updates'){
    const fields=['revision','projectId','cycleId','section','offset','limit','query'];
    exact(args,['workspace','dossierId',...fields],['workspace','dossierId']);
    return api.list(args.dossierId,selected(args,fields));
  }
  if(name==='merchant_research_customer_update_record'){
    const fields=['revision','path','sha256','label'];
    exact(args,['workspace','dossierId',...fields],['workspace','dossierId','path','sha256']);
    return api.record(args.dossierId,selected(args,fields));
  }
  if(name==='merchant_research_customer_update_preview'){
    const fields=['revision','projectId','cycleId','requestEditionId','selection','fingerprint','section','offset','limit'];
    exact(args,['workspace','dossierId',...fields],['workspace','dossierId','projectId','cycleId','requestEditionId','selection']);
    return api.preview(args.dossierId,selected(args,fields));
  }
  if(name==='merchant_research_customer_update_save'){
    const fields=['requestId','expectedRevision','actor','action','data'];
    exact(args,['workspace','dossierId',...fields],['workspace','dossierId',...fields]);
    return api.review(args.dossierId,selected(args,fields));
  }
  if(name==='merchant_research_customer_update_work'){
    const fields=['revision','workId','section','offset','limit'];
    exact(args,['workspace','dossierId',...fields],['workspace','dossierId','workId']);
    return api.work(args.dossierId,selected(args,fields));
  }
  if(name==='merchant_research_customer_update_source_plan'){
    const fields=['queryId','queryRevision','questionId','planId','name','constraints','library'];
    exact(args,['workspace',...fields],['workspace','queryId','queryRevision','questionId','planId']);
    return api.europePmcPlan(selected(args,fields));
  }
  throw failure('TOOL_NOT_FOUND','Unknown customer update operation.');
}
export async function exportResearchCustomerUpdates(client,args,{file,download}){
  const fields=['workspace','dossierId','kind','revision','deliveryId','workId','expectedSha256'];
  exact(args,fields,['workspace','dossierId','kind']);
  const formats={'customer-update-json':'json','customer-update-md':'md','customer-update-html':'html',
    'customer-update-csv':'csv','customer-update-portable':'portable','customer-update-portable-gzip':'portable.gz',
    'customer-update-work-json':'json'};
  const format=formats[args.kind];
  const workExport=args.kind==='customer-update-work-json';
  if(!format||(workExport?(typeof args.workId!=='string'||args.deliveryId!==undefined):
    (typeof args.deliveryId!=='string'||args.workId!==undefined)))
    throw failure('INVALID_PARAMS','Select the original delivery ID, or the original work ID for a work snapshot.');
  const options={...selected(args,['revision','deliveryId','workId','expectedSha256']),format,file};
  const result=await download(()=>client.customerUpdates().export(args.dossierId,options));
  return {result,selection:{dossierId:args.dossierId,revision:result.revision??args.revision??null,
    deliveryId:args.deliveryId??null,workId:args.workId??null,format}};
}
