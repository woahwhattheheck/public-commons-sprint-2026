// MIT. Complete quotations use one admitted operation in the original Research transport.
import {QUOTES_SCHEMA,QUOTE_HOST_SCHEMA,QUOTE_OPERATION_SCHEMA,QUOTE_REQUEST_LIMIT,QUOTE_FILE_LIMIT,
 fields,id,hash,alias,need,same,fingerprint,page,briefSelection,responseSelection,
 normalizePublicationSelection,realizedSelection,caseSelection,applySelection} from './contracts.mjs';

const prefix='/api/customer-quotes';
const kinds=['CASE','BRIEF','RESPONSE','PUBLICATION','REALIZED'];
export const RESEARCH_QUOTES_CASE_ACTIONS=Object.freeze([
 'preview','save-draft','publish','receive','receive-pricing','compare','preview-implementation','adopt-implementation',
 'receiving-status','receiving-capture','receiving-inspect','receiving-attach','receiving-case','receiving-restore',
 'tariff-status','tariff-catalog','tariff-selection','tariff-capture','tariff-inspect','tariff-attach','tariff-case','tariff-restore',
]);
export const RESEARCH_QUOTES_PRICING_ACTIONS=Object.freeze([
 'state','preview','save','version','compare','planning-state','planning-preview','planning-save','planning-read',
 'economics-state','economics-preview','economics-save','economics-edition','economics-proposal','economics-apply',
 'repricing-source','repricing-preview','repricing-save','repricing-stage',
]);
/** Capture the actual JSON sent to the native host before admitting asynchronous work. */
export function captureResearchQuoteInput(value){
 need(value!==null&&typeof value==='object'&&!Array.isArray(value),'RESEARCH_QUOTE_FIELDS_INVALID');
 const body=JSON.stringify(value);
 need(typeof body==='string'&&Buffer.byteLength(body)<=QUOTE_REQUEST_LIMIT,'RESEARCH_QUOTE_REQUEST_TOO_LARGE',413);
 const result=JSON.parse(body);
 need(result!==null&&typeof result==='object'&&!Array.isArray(result),'RESEARCH_QUOTE_FIELDS_INVALID');
 return result;
}
function options(value={}){return {signal:value.signal};}
function query(value){const result=new URLSearchParams();
 for(const [key,item]of Object.entries(value))if(item!==undefined&&item!==null)result.set(key,String(item));
 return result.size?'?'+result.toString():'';}
function name(value){need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(value),
 'RESEARCH_QUOTE_FILE_NAME_INVALID');return value;}
function size(value){need(Number.isSafeInteger(value)&&value>=0&&value<=QUOTE_FILE_LIMIT,'RESEARCH_QUOTE_FILE_SIZE_INVALID');return value;}
function descriptor(value){
 need(value&&typeof value==='object','RESEARCH_QUOTE_FILE_CHANGED');name(value.name);hash(value.sha256);size(value.bytes);
 need(typeof value.contentType==='string'&&value.contentType.length>0&&!/[\r\n\0]/.test(value.contentType),
  'RESEARCH_QUOTE_FILE_CHANGED');return value;
}
export function validateResearchQuoteOperation(value,{requestId,kind,input,reviewSha256}={}){
 need(value?.schema===QUOTE_OPERATION_SCHEMA&&/^research_[a-f0-9]{64}$/.test(value.workspaceId??'')&&
  typeof value.casesWorkspaceId==='string'&&kinds.includes(value.kind)&&
  ['PREPARING','REVIEWED','COMPLETE'].includes(value.status),'RESEARCH_QUOTE_OPERATION_CHANGED');
 id(value.id);hash(value.requestSha256);
 need(value.request?.requestId===value.id&&fingerprint(value.request)===value.requestSha256&&
  (requestId===undefined||value.id===requestId)&&(kind===undefined||value.kind===kind)&&
  (input===undefined||same(value.request,input)),'RESEARCH_QUOTE_OPERATION_CHANGED');
 if(value.review!==null){
  need(value.review&&typeof value.review==='object','RESEARCH_QUOTE_REVIEW_CHANGED');
  const {reviewSha256:reviewed,...proof}=value.review;hash(reviewed);
  need(fingerprint(proof)===reviewed,'RESEARCH_QUOTE_REVIEW_CHANGED');
 }
 need(value.status==='COMPLETE'?value.result!==null:
  value.status==='REVIEWED'?value.review!==null&&value.result===null:value.review===null&&value.result===null,
  'RESEARCH_QUOTE_OPERATION_CHANGED');
 if(reviewSha256!==undefined)need(value.review?.reviewSha256===reviewSha256,'RESEARCH_QUOTE_REVIEW_CHANGED');
 return value;
}
/**
 * request/download are raw callbacks already admitted by run. The factory never
 * closes the original listener. Its first valid response pins the workspace.
 */
export function createResearchQuotesClient({request,download,run}={}){
 need(typeof request==='function'&&typeof download==='function'&&typeof run==='function',
  'RESEARCH_QUOTE_ORIGINAL_CLIENT_REQUIRED');
 let workspaceId;
 const bound=value=>{
  need(/^research_[a-f0-9]{64}$/.test(value?.workspaceId??'')&&
   (workspaceId===undefined||value.workspaceId===workspaceId),'RESEARCH_QUOTE_WORKSPACE_CHANGED');
  workspaceId??=value.workspaceId;return value;
 };
 const envelope=(value,action,selection={})=>{
  need(value?.schema===QUOTES_SCHEMA&&value.action===action&&Object.hasOwn(value,'result')&&
   Object.entries(selection).every(([key,item])=>value[key]===item),'RESEARCH_QUOTE_NATIVE_RESPONSE_CHANGED');
  return bound(value);
 };
 const operation=(value,selection)=>bound(validateResearchQuoteOperation(value,selection));
 const fileMetadata=(value,requestId,selectedName)=>{
  need(value?.schema===QUOTES_SCHEMA&&value.id===requestId,'RESEARCH_QUOTE_FILE_CHANGED');
  descriptor(value.descriptor);need(selectedName===undefined||value.descriptor.name===selectedName,'RESEARCH_QUOTE_FILE_CHANGED');
  return bound(value);
 };
 const caseMetadata=(value,caseId,input)=>{
  need(value?.schema===QUOTES_SCHEMA&&value.caseId===caseId&&value.case?.id===caseId,'RESEARCH_QUOTE_CASE_FILE_CHANGED');
  hash(value.case.revision);descriptor(value.descriptor);
  need(input.revision===undefined||input.revision===value.case.revision,'RESEARCH_QUOTE_CASE_REVISION_CHANGED');
  return bound(value);
 };
 const selectedFile=value=>{
  need(typeof value.file==='string'&&value.file.length>0,'RESEARCH_QUOTE_DESTINATION_REQUIRED');
  if(value.expectedSha256!==undefined)hash(value.expectedSha256);
  if(value.expectedBytes!==undefined)size(value.expectedBytes);
  return {file:value.file,expectedSha256:value.expectedSha256,expectedBytes:value.expectedBytes,signal:value.signal};
 };
 const pin=(metadata,selected)=>{
  need((selected.expectedSha256===undefined||metadata.descriptor.sha256===selected.expectedSha256)&&
   (selected.expectedBytes===undefined||metadata.descriptor.bytes===selected.expectedBytes),'RESEARCH_QUOTE_FILE_CHANGED');
 };
 const saved=(value,metadata)=>{
  if(value?.sha256!==metadata.descriptor.sha256||value?.bytes!==metadata.descriptor.bytes)
   throw Object.assign(new Error('RESEARCH_QUOTE_DOWNLOADED_FILE_CHANGED'),{
    code:'RESEARCH_QUOTE_DOWNLOADED_FILE_CHANGED',destinationPublished:true,file:{...value,metadata},metadata});
  return {...value,metadata};
 };
 const transfer=async(route,file,settings,metadata)=>{
  try{return saved(await download(route,file,settings),metadata);}
  catch(error){
   if(error?.destinationPublished&&error.file&&typeof error.file==='object')error.file={...error.file,metadata};
   throw error;
  }
 };
 const send=(route,validator,kind,value,callOptions)=>{
  const selected=validator(captureResearchQuoteInput(value)),o=options(callOptions);
  return run(async()=>operation(await request(prefix+route,selected,o),{requestId:selected.requestId,kind,input:selected}));
 };
 const caseInfo=(caseId,value,callOptions,tariff)=>{
  id(caseId);const selected=captureResearchQuoteInput(value),o=options(callOptions);
  need(selected.id===undefined||selected.id===caseId,'RESEARCH_QUOTE_CASE_CHANGED');
  if(selected.revision!==undefined)hash(selected.revision);
  return run(async()=>caseMetadata(await request(prefix+'/cases/'+caseId+'/'+(tariff?'tariff-download':'download')+
   '?metadata=true',selected,o),caseId,selected));
 };
 const caseDownload=(caseId,value,callOptions,tariff)=>{
  id(caseId);const selected=captureResearchQuoteInput(value),o=selectedFile(callOptions??{});
  need(selected.id===undefined||selected.id===caseId,'RESEARCH_QUOTE_CASE_CHANGED');
  if(selected.revision!==undefined)hash(selected.revision);
  const route=prefix+'/cases/'+caseId+'/'+(tariff?'tariff-download':'download');
  return run(async()=>{
   const metadata=caseMetadata(await request(route+'?metadata=true',selected,{signal:o.signal}),caseId,selected);
   pin(metadata,o);
   const input={...selected,revision:metadata.case.revision};
   return transfer(route,o.file,{signal:o.signal,expectedSha256:metadata.descriptor.sha256,request:input},metadata);
  });
 };
 return Object.freeze({
  configuration(callOptions={}){
   const o=options(callOptions);return run(async()=>{
    const value=await request(prefix+'/configuration',undefined,o);
    need(value?.schema===QUOTE_HOST_SCHEMA&&value.cases&&typeof value.cases.workspaceId==='string'&&
     Array.isArray(value.pricing)&&Array.isArray(value.merchants?.items)&&Array.isArray(value.merchants?.errors),
     'RESEARCH_QUOTE_CONFIGURATION_CHANGED');return bound(value);
   });
  },
  listCases(value={},callOptions={}){
   const selected=captureResearchQuoteInput(value);fields(selected,['q','status','dueOn','offset','limit'],[]);
   for(const key of ['q','status','dueOn'])if(selected[key]!==undefined)need(typeof selected[key]==='string','RESEARCH_QUOTE_QUERY_INVALID');
   for(const key of ['offset','limit'])if(selected[key]!==undefined)need(Number.isSafeInteger(selected[key])&&
    selected[key]>=(key==='limit'?1:0),'RESEARCH_QUOTE_QUERY_INVALID');
   const o=options(callOptions);return run(async()=>{
    const value=envelope(await request(prefix+'/cases'+query(selected),undefined,o),'cases'),page=value.result;
    need(Array.isArray(page?.cases)&&Number.isSafeInteger(page.total)&&page.total>=0&&
     Number.isSafeInteger(page.offset)&&page.offset>=0&&(selected.offset===undefined||page.offset===selected.offset),
     'RESEARCH_QUOTE_CASE_PAGE_CHANGED');return value;
   });
  },
  readCase(caseId,value={},callOptions={}){
   id(caseId);const selected=captureResearchQuoteInput(value);fields(selected,['revision'],[]);
   if(selected.revision!==undefined)hash(selected.revision);const o=options(callOptions);
   return run(async()=>{
    const value=envelope(await request(prefix+'/cases/'+caseId+query(selected),undefined,o),'case',{caseId});
    need(value.result?.case?.id===caseId&&(selected.revision===undefined||value.result.case.revision===selected.revision),
     'RESEARCH_QUOTE_CASE_CHANGED');hash(value.result.case.revision);return value;
   });
  },
  caseAction(caseId,action,value={},callOptions={}){
   id(caseId);need(RESEARCH_QUOTES_CASE_ACTIONS.includes(action),'RESEARCH_QUOTE_CASE_ACTION_REQUIRED');
   const selected=captureResearchQuoteInput(value),o=options(callOptions);
   need(selected.id===undefined||selected.id===caseId,'RESEARCH_QUOTE_CASE_CHANGED');
   return run(async()=>envelope(await request(prefix+'/cases/'+caseId+'/'+action,selected,o),action,{caseId}));
  },
  pricing(profile,action,value={},callOptions={}){
   alias(profile);need(RESEARCH_QUOTES_PRICING_ACTIONS.includes(action),'RESEARCH_QUOTE_PRICING_ACTION_REQUIRED');
   const selected=captureResearchQuoteInput(value),o=options(callOptions);
   return run(async()=>envelope(await request(prefix+'/pricing/'+profile+'/'+action,selected,o),action,{profile}));
  },
  createCase:(value,o)=>send('/cases/create',caseSelection,'CASE',value,o),
  prepare:(value,o)=>send('/prepare',briefSelection,'BRIEF',value,o),
  prepareResponse:(value,o)=>send('/responses/prepare',responseSelection,'RESPONSE',value,o),
  preparePublication:(value,o)=>send('/publications/prepare',normalizePublicationSelection,'PUBLICATION',value,o),
  prepareReport:(value,o)=>send('/reports/prepare',realizedSelection,'REALIZED',value,o),
  apply(value,callOptions={}){
   const selected=applySelection(captureResearchQuoteInput(value)),o=options(callOptions);
   return run(async()=>{
    const result=operation(await request(prefix+'/apply',selected,o),{requestId:selected.id,reviewSha256:selected.reviewSha256});
    need(['BRIEF','RESPONSE'].includes(result.kind)&&result.status==='COMPLETE','RESEARCH_QUOTE_APPLY_RESULT_CHANGED');return result;
   });
  },
  enrollPublication(value,callOptions={}){
   const selected=applySelection(captureResearchQuoteInput(value)),o=options(callOptions);
   return run(async()=>{
    const result=operation(await request(prefix+'/publications/enroll',selected,o),{
     requestId:selected.id,kind:'PUBLICATION',reviewSha256:selected.reviewSha256});
    need(result.status==='COMPLETE','RESEARCH_QUOTE_PUBLICATION_RESULT_CHANGED');return result;
   });
  },
  list(value={},callOptions={}){
   const selected=page(captureResearchQuoteInput(value)),o=options(callOptions);
   return run(async()=>{
    const result=await request(prefix+'/operations'+query(selected),undefined,o);
    need(result?.schema===QUOTE_OPERATION_SCHEMA&&Array.isArray(result.items)&&Array.isArray(result.errors)&&
     Number.isSafeInteger(result.total)&&Number.isSafeInteger(result.offset)&&result.offset===selected.offset&&
     result.total>=result.offset+result.items.length&&result.items.length<=selected.limit&&
     (result.nextOffset===null||result.nextOffset===result.offset+result.items.length&&result.nextOffset>result.offset)&&
     (selected.snapshot===undefined||result.snapshot===selected.snapshot),'RESEARCH_QUOTE_PAGE_CHANGED');
    hash(result.snapshot);for(const row of result.items){id(row.id);need(kinds.includes(row.kind),'RESEARCH_QUOTE_PAGE_CHANGED');}
    return bound(result);
   });
  },
  operation(requestId,callOptions={}){
   id(requestId);const o=options(callOptions);
   return run(async()=>operation(await request(prefix+'/operations/'+requestId,undefined,o),{requestId}));
  },
  files(requestId,callOptions={}){
   id(requestId);const o=options(callOptions);
   return run(async()=>{
    const value=await request(prefix+'/operations/'+requestId+'/files',undefined,o);
    need(value?.schema===QUOTES_SCHEMA&&value.id===requestId&&Array.isArray(value.files)&&value.files.length<=103,
     'RESEARCH_QUOTE_FILES_CHANGED');
    value.files.forEach(descriptor);need(new Set(value.files.map(row=>row.name)).size===value.files.length,'RESEARCH_QUOTE_FILES_CHANGED');
    return bound(value);
   });
  },
  fileInfo(requestId,selectedName,callOptions={}){
   id(requestId);name(selectedName);const o=options(callOptions);
   return run(async()=>fileMetadata(await request(prefix+'/operations/'+requestId+'/files/'+selectedName+
    '?metadata=true',undefined,o),requestId,selectedName));
  },
  caseFileInfo:(caseId,value,o)=>caseInfo(caseId,value,o,false),
  tariffFileInfo:(caseId,value,o)=>caseInfo(caseId,value,o,true),
  download(requestId,selectedName,callOptions={}){
   id(requestId);name(selectedName);const o=selectedFile(callOptions);hash(o.expectedSha256);size(o.expectedBytes);
   const route=prefix+'/operations/'+requestId+'/files/'+selectedName;
   return run(async()=>{
    const metadata=fileMetadata(await request(route+'?metadata=true',undefined,{signal:o.signal}),requestId,selectedName);
    pin(metadata,o);
    return transfer(route,o.file,{expectedSha256:metadata.descriptor.sha256,signal:o.signal},metadata);
   });
  },
  downloadCase:(caseId,value,o)=>caseDownload(caseId,value,o,false),
  downloadTariff:(caseId,value,o)=>caseDownload(caseId,value,o,true),
 });
}
