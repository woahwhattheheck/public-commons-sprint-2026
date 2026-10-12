// MIT. Service operations over the original SF74 case writer and immutable history.
import {parseWorkspace,serializeWorkspace,workspaceDraft} from './workspace-file.mjs';
import {createServiceRecord,validateServiceRecord,serviceSha256,saveServiceTerms,retainServiceSnapshot,
  saveServiceExclusion,previewServiceReport,retainServiceReport,retainServiceOperation,
  renderServiceReport,serviceReportCsv} from './service-commitments.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const fail=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
function fields(value,allowed,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))
    throw fail('SERVICE_INPUT_INVALID','Invalid '+label+'.');
  return value;
}
function id(value){if(typeof value!=='string'||!uuid.test(value))throw fail('INVALID_CASE_ID','Use the original case or request UUID.');return value;}
function hash(value){if(typeof value!=='string'||!digest.test(value))throw fail('INVALID_REVISION','Use the exact original revision.');return value;}
function caseSummary(value){return {id:value.id,revision:value.revision,currentRevision:value.currentRevision,name:value.name,
  metadata:value.metadata,updatedAt:value.updatedAt};}
function resultFrom(record,operation){
  const names={terms:'terms',capture:'captures',exclusion:'exclusions',report:'reports'};
  return structuredClone(record[names[operation.result.kind]].find(value=>value.sha256===operation.result.sha256));
}
async function original(store,args){
  id(args.id);if(args.revision!==undefined)hash(args.revision);
  const value=await store.read(args.id,args.revision??null),workspace=await parseWorkspace(value.workspaceText);
  return {value,workspace,record:await validateServiceRecord(workspace.service)};
}
function selection(record){return {schema:record.schema,terms:record.terms.length,captures:record.captures.length,
  exclusions:record.exclusions.length,reports:record.reports.length,operations:(record.operations??[]).length,
  termsHeads:record.terms.filter(row=>!record.terms.some(next=>next.id===row.id&&next.revision>row.revision)).map(row=>({
    id:row.id,revision:row.revision,sha256:row.sha256,title:row.title,customer:row.customer,owner:row.owner,status:row.status,
    effectiveFrom:row.effectiveFrom,effectiveUntil:row.effectiveUntil,incidentSourceId:row.incidentSourceId,merchantId:row.merchantId})),
  hasUnfinishedDraft:Object.keys(record.draft).length>0};}
export async function readServiceCase({store,args}){
  fields(args,['id','revision','section','recordId','offset','limit'],'service case read');
  const {value,record}=await original(store,args),section=args.section??'summary';
  if(!['summary','terms','captures','exclusions','reports','operations'].includes(section))
    throw fail('SERVICE_INPUT_INVALID','Choose an original service case section.');
  const common={case:caseSummary(value),summary:selection(record)};
  if(section==='summary'){
    if(args.recordId!==undefined)throw fail('SERVICE_INPUT_INVALID','Choose a section for the original record.');
    return common;
  }
  const all=record[section]??[];
  if(args.recordId!==undefined){
    const found=all.filter(row=>row.id===args.recordId||row.sha256===args.recordId);
    if(!found.length)throw fail('SERVICE_RECORD_NOT_FOUND','The original service record was not found.',404);
    return {...common,section,records:structuredClone(found)};
  }
  const offset=args.offset??0,limit=args.limit??25;
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)
    throw fail('SERVICE_INPUT_INVALID','Use a complete page from 1 to 100 rows.');
  const rows=all.slice(offset,offset+limit).map(row=>{
    if(section==='captures')return {sha256:row.sha256,capturedAt:row.snapshot.capturedAt,source:row.snapshot.source,
      merchant:row.snapshot.merchant,revision:row.snapshot.revision,configRevision:row.snapshot.configRevision,incidents:row.snapshot.incidents.length};
    if(section==='reports')return {id:row.id,sha256:row.sha256,createdAt:row.createdAt,reviewedBy:row.reviewedBy,note:row.note,
      terms:{id:row.preview.terms.id,revision:row.preview.terms.revision,title:row.preview.terms.title},
      period:row.preview.period,summary:row.preview.summary};
    if(section==='operations')return {id:row.id,createdAt:row.createdAt,requestSha256:row.requestSha256,result:row.result,sha256:row.sha256};
    return structuredClone(row);
  });
  return {...common,section,records:rows,total:all.length,offset,limit,nextOffset:offset+limit<all.length?offset+limit:null};
}
export async function changeServiceCase({store,args,readSnapshot}){
  fields(args,['id','expectedRevision','requestId','action','input'],'service case change');
  id(args.id);id(args.requestId);hash(args.expectedRevision);
  if(!['terms','capture','exclusion','report'].includes(args.action))
    throw fail('SERVICE_INPUT_INVALID','Choose terms, capture, exclusion or report.');
  if(!args.input||typeof args.input!=='object'||Array.isArray(args.input))throw fail('SERVICE_INPUT_INVALID','Provide the original change inputs.');
  const request=structuredClone(args),requestSha256=await serviceSha256(request);
  const reopened=async()=>{
    const current=await original(store,{id:args.id});
    const retained=(current.record.operations??[]).find(value=>value.id===args.requestId);
    if(retained&&retained.requestSha256!==requestSha256)
      throw fail('SERVICE_OPERATION_CONFLICT','This original request ID belongs to different changes.',409);
    return {current,retained};
  };
  const replay=({current,retained})=>({case:caseSummary(current.value),operation:structuredClone(retained),
    result:resultFrom(current.record,retained),reused:true});
  const before=await reopened();
  if(before.retained)return replay(before);
  const {value,workspace,record}=before.current;
  if(value.currentRevision!==args.expectedRevision)
    throw fail('CASE_CONFLICT','A newer original case revision exists. Reopen it before changing service terms or reports.',409);
  let changed,result;
  if(args.action==='terms'){changed=await saveServiceTerms(record,args.input);result=changed.terms;}
  else if(args.action==='exclusion'){changed=await saveServiceExclusion(record,args.input);result=changed.exclusion;}
  else if(args.action==='report'){changed=await retainServiceReport(record,args.input);result=changed.report;}
  else {
    fields(args.input,['incidentSource','merchantId','expectedSourceRevision','expectedConfigHash','expectedMerchantBinding'],'original service capture');
    if(typeof readSnapshot!=='function')throw fail('SERVICE_SOURCE_REQUIRED','Configure the original incident source on this host.');
    if(!Number.isSafeInteger(args.input.expectedSourceRevision)||args.input.expectedSourceRevision<1)
      throw fail('SERVICE_INPUT_INVALID','Inspect the original incident source revision before retaining it.');
    hash(args.input.expectedConfigHash);hash(args.input.expectedMerchantBinding);
    const snapshot=await readSnapshot({incidentSource:args.input.incidentSource,merchantId:args.input.merchantId});
    if(snapshot.revision!==args.input.expectedSourceRevision||snapshot.configHash!==args.input.expectedConfigHash||
      snapshot.merchant.binding!==args.input.expectedMerchantBinding)
      throw fail('SERVICE_SOURCE_CHANGED','The original source or merchant registration changed. Inspect the current source before retaining it.',409);
    changed=await retainServiceSnapshot(record,snapshot);result=changed.capture;
  }
  const completed=await retainServiceOperation(changed.record,{id:args.requestId,request,result:{kind:args.action,sha256:result.sha256}});
  const workspaceText=await serializeWorkspace({...workspaceDraft(workspace),service:completed.record},{now:workspace.savedAt});
  try {
    const saved=await store.save({id:args.id,expectedRevision:args.expectedRevision,workspaceText,
      supportText:value.supportText,metadata:value.metadata});
    return {case:{...saved.case,currentRevision:saved.case.revision},operation:completed.operation,result:completed.result,reused:false};
  } catch(error){
    if(error.code==='CASE_CONFLICT'){
      const latest=await reopened();if(latest.retained)return replay(latest);
    }
    throw error;
  }
}
export async function previewServiceCase({store,args}){
  fields(args,['id','expectedRevision','selection'],'service report preview');id(args.id);hash(args.expectedRevision);
  const {value,record}=await original(store,{id:args.id});
  if(value.currentRevision!==args.expectedRevision)throw fail('CASE_CONFLICT','The original case changed. Reopen the current case before reviewing this report.',409);
  return {case:caseSummary(value),preview:await previewServiceReport(record,args.selection)};
}
export async function readServiceCaseReport({store,args}){
  fields(args,['id','revision','reportId','format'],'saved service report');id(args.reportId);
  const {value,record}=await original(store,args),report=record.reports.find(row=>row.id===args.reportId);
  if(!report)throw fail('SERVICE_REPORT_NOT_FOUND','The original report was not found in this saved case.',404);
  const format=args.format??'json';if(!['json','csv','html'].includes(format))throw fail('SERVICE_INPUT_INVALID','Choose JSON, CSV or HTML.');
  const text=format==='json'?JSON.stringify(report,null,2)+'\n':format==='csv'?serviceReportCsv(report):renderServiceReport(report);
  return {case:caseSummary(value),reportId:report.id,reportSha256:report.sha256,format,
    filename:'service-report-'+report.preview.selection.from.slice(0,7)+'-'+report.id+'.'+format,
    contentType:format==='json'?'application/json':format==='csv'?'text/csv;charset=utf-8':'text/html;charset=utf-8',
    text,bytes:new TextEncoder().encode(text).length,sha256:await serviceSha256(text)};
}
