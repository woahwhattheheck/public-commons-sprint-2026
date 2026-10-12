import {canonical,sha256} from './propply.mjs';
import {pointer} from './identity.mjs';

export const RENTCHECK_DOCUMENTATION=Object.freeze({
  updates:'https://help.getrentcheck.com/en/articles/9045668-rentcheck-api-updates',
  developer:'https://developers.getrentcheck.com/',
  production_contract:'The public update establishes the paths and inspection_template_id below. Production origin, credentials, complete create body, returned identities, pagination and report locations must come from the selected account’s retained API contract; staging is not a production default.',
});
const PATHS=Object.freeze({
  templates:{method:'GET',path:'/v1/inspection-templates'},
  template:{method:'GET',path:'/v1/inspection-templates/:id'},
  inspections:{method:'GET',path:'/v2/inspections'},
  inspection:{method:'GET',path:'/v1/inspections/:id'},
  create_inspection:{method:'POST',path:'/v2/inspections'},
});
const MAX_RESPONSE=16*1024*1024;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const need=(ok,code,message)=>{if(!ok)throw Object.assign(new Error(message),{code});};
const clone=v=>JSON.parse(canonical(v));
const digest=v=>sha256(Buffer.from(canonical(v)));
function id(value,label) {
  need(typeof value==='string'&&value.trim()&&value.length<=500&&!/[\u0000-\u001f]/.test(value),'RENTCHECK_ID','Retain '+label+' as its original opaque text ID.');
  return value;
}
function hash(value,label) {need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'RENTCHECK_HASH','Retain the exact '+label+' SHA-256.');return value;}
function locator(value,label) {need(typeof value==='string'&&value.startsWith('/')&&!/~(?![01])/u.test(value),'RENTCHECK_LOCATOR','Select '+label+' as a source-bound JSON pointer.');return value;}
function scalarAt(value,path,label) {
  const found=pointer(value,path);
  need(found.present,'RENTCHECK_IDENTITY_MISSING','The retained response does not contain '+label+' at its selected contract locator.');
  return id(found.value,label);
}
export function bindRentCheckContract(contract) {
  need(object(contract)&&contract.schema==='tjlabs.rentcheck-account-contract/v1','RENTCHECK_CONTRACT','Select the receiving account’s retained API contract.');
  need(Object.keys(contract).every(k=>['schema','account_id','environment','api_base','source','reviewed_by','review_note','auth_header_names','fields'].includes(k)),'RENTCHECK_CONTRACT_FIELDS','Keep credentials and undocumented settings outside the account contract configuration.');
  id(contract.account_id,'the receiving account identity');
  need(['production','staging','sandbox'].includes(contract.environment),'RENTCHECK_ENVIRONMENT','Name the actual selected environment.');
  let base;
  try{base=new URL(contract.api_base);}catch{throw Object.assign(new Error('Select the actual account API base URL.'),{code:'RENTCHECK_ORIGIN'});}
  need(base.protocol==='https:'&&!base.username&&!base.password&&!base.search&&!base.hash &&
    (base.hostname==='getrentcheck.com'||base.hostname.endsWith('.getrentcheck.com')),
    'RENTCHECK_ORIGIN','Select the actual HTTPS RentCheck API origin from this account’s contract.');
  need(base.pathname.endsWith('/'),'RENTCHECK_ORIGIN','The selected API base must include its exact trailing slash.');
  need(object(contract.source)&&typeof contract.source.path==='string'&&contract.source.path&&Number.isSafeInteger(contract.source.bytes)&&contract.source.bytes>0,
    'RENTCHECK_CONTRACT_SOURCE','Retain the complete original account contract as a source file.');
  hash(contract.source.sha256,'account contract');
  id(contract.reviewed_by,'the account configuration reviewer');id(contract.review_note,'the account configuration note');
  need(Array.isArray(contract.auth_header_names)&&contract.auth_header_names.length>0,'RENTCHECK_AUTH','Configure the actual account credential header names.');
  const names=contract.auth_header_names.map(n=>String(n).toLowerCase());
  need(new Set(names).size===names.length && names.every(n=>/^[a-z0-9-]+$/.test(n)&&!['host','content-length','content-type','accept','cookie','connection','transfer-encoding'].includes(n)),
    'RENTCHECK_AUTH','Credential headers must be unique named headers from the retained API contract.');
  need(object(contract.fields)&&Object.keys(contract.fields).every(k=>['create_property','template_id','inspection_id','inspection_property','inspection_template','created_inspection_id','report_url'].includes(k)),'RENTCHECK_FIELDS','Retain this account’s actual request and response identity locators.');
  for(const key of ['create_property','template_id','inspection_id','inspection_property','inspection_template'])
    locator(contract.fields[key],key);
  need(contract.fields.create_property!=='/inspection_template_id','RENTCHECK_FIELDS','The selected property and template fields must remain distinct.');
  if(contract.fields.created_inspection_id!==null&&contract.fields.created_inspection_id!==undefined)locator(contract.fields.created_inspection_id,'created inspection ID');
  if(contract.fields.report_url!==null&&contract.fields.report_url!==undefined)locator(contract.fields.report_url,'returned report URL');
  const value=clone(contract);
  value.auth_header_names=names;
  return {...value,contract_sha256:digest(value)};
}
function unchanged(contract) {
  const {contract_sha256,...raw}=contract;
  const rebound=bindRentCheckContract(raw);
  need(rebound.contract_sha256===contract_sha256,'RENTCHECK_CONTRACT_CHANGED','The selected account API contract changed.');
  return rebound;
}
export function prepareRentCheckRead({contract,operation,resource_id=null,query={}}) {
  const selected=unchanged(contract),spec=PATHS[operation];
  need(spec&&spec.method==='GET','RENTCHECK_READ','Select a documented template or inspection read.');
  need(object(query)&&Object.keys(query).every(k=>k&&!/[\u0000-\u001f]/.test(k)&&['string','number','boolean'].includes(typeof query[k])),
    'RENTCHECK_QUERY','Pass the exact query parameters selected from the account contract.');
  let path=spec.path;
  if(path.includes(':id'))path=path.replace(':id',encodeURIComponent(id(resource_id,'the selected native resource')));
  else need(resource_id===null,'RENTCHECK_READ','A collection read does not select an individual resource.');
  const url=new URL(path.slice(1),selected.api_base);
  for(const [key,value] of Object.entries(query))url.searchParams.set(key,String(value));
  const value={schema:'tjlabs.rentcheck-request/v1',operation,contract_sha256:selected.contract_sha256,
    account_id:selected.account_id,environment:selected.environment,resource_id,
    request:{method:'GET',url:url.href,body:null},query:clone(query)};
  return {...value,request_sha256:digest(value)};
}
export function prepareRentCheckInspection({contract,property,template,identityReview,body}) {
  const selected=unchanged(contract);
  need(object(property)&&object(template)&&object(identityReview)&&object(body),'RENTCHECK_CREATE','Select the saved property, native template, identity review and complete account request body.');
  id(property.id,'the local property');id(property.rentcheck_property_id,'the receiving property');
  hash(template.source_sha256,'template source');
  need(Buffer.isBuffer(template.source_raw)&&sha256(template.source_raw)===template.source_sha256,'RENTCHECK_TEMPLATE_SOURCE','Use the exact retained template response bytes.');
  let templateDocument;
  try{templateDocument=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(template.source_raw));}
  catch{throw Object.assign(new Error('The retained template source is not complete UTF-8 JSON.'),{code:'RENTCHECK_TEMPLATE_SOURCE'});}
  const templateRecord=pointer(templateDocument,template.record_pointer??'');
  need(templateRecord.present,'RENTCHECK_TEMPLATE_SOURCE','The selected template row is absent from its original response.');
  hash(identityReview.identity_sha256,'identity review');
  const {identity_sha256,...reviewBody}=identityReview;
  need(digest(reviewBody)===identity_sha256,'RENTCHECK_REVIEW_CHANGED','The selected property identity review changed.');
  const link=identityReview.links?.find(item=>item.property_id===property.id);
  need(link&&canonical(link.property)===canonical(property),'RENTCHECK_REVIEW_CHANGED','The current selected property differs from its saved source identity review.');
  const templateId=scalarAt(templateRecord.value,selected.fields.template_id,'the native template');
  need(typeof body.inspection_template_id==='string'&&body.inspection_template_id===templateId,
    'RENTCHECK_TEMPLATE','Use the selected original inspection_template_id.');
  need(!Object.prototype.hasOwnProperty.call(body,'inspection_type'),'RENTCHECK_TEMPLATE','Use the current template identity; inspection_type is deprecated.');
  need(scalarAt(body,selected.fields.create_property,'the requested property')===property.rentcheck_property_id,
    'RENTCHECK_PROPERTY','The complete request body targets another receiving property.');
  const value={schema:'tjlabs.rentcheck-request/v1',operation:'create_inspection',
    contract_sha256:selected.contract_sha256,account_id:selected.account_id,environment:selected.environment,
    property_id:property.id,rentcheck_property_id:property.rentcheck_property_id,
    inspection_template_id:templateId,template_source_sha256:template.source_sha256,
    identity_review_sha256:identity_sha256,source_report_id:link.report_id,
    hpd_source_sha256:identityReview.hpd_source_sha256,propply_response_sha256:identityReview.propply_response_sha256,
    request:{method:'POST',url:new URL(PATHS.create_inspection.path.slice(1),selected.api_base).href,body:clone(body)},
    retry_policy:'NO_AUTOMATIC_CREATE_RETRY'};
  return {...value,request_sha256:digest(value)};
}
function verifyPlan(plan,contract) {
  const current=unchanged(contract),{request_sha256,...body}=plan;
  need(digest(body)===request_sha256 && plan.contract_sha256===current.contract_sha256 &&
    plan.account_id===current.account_id && plan.environment===current.environment,
    'RENTCHECK_REQUEST_CHANGED','The saved request or its receiving account changed.');
  const spec=PATHS[plan.operation];
  need(spec&&plan.request.method===spec.method,'RENTCHECK_REQUEST_CHANGED','The saved request is not a documented operation.');
  let path=spec.path;
  if(path.includes(':id'))path=path.replace(':id',encodeURIComponent(id(plan.resource_id,'the selected resource')));
  const url=new URL(path.slice(1),current.api_base);
  if(spec.method==='GET')for(const [key,value] of Object.entries(plan.query||{}))url.searchParams.set(key,String(value));
  need(plan.request.url===url.href,'RENTCHECK_REQUEST_CHANGED','The saved request URL changed.');
  if(spec.method==='POST'){
    need(plan.request.body.inspection_template_id===plan.inspection_template_id &&
      scalarAt(plan.request.body,current.fields.create_property,'the requested property')===plan.rentcheck_property_id,
      'RENTCHECK_REQUEST_CHANGED','The frozen create body no longer matches its selected native identities.');
  }
  return current;
}
async function bytes(response,maximum) {
  const length=response.headers.get('content-length'),encoding=(response.headers.get('content-encoding')||'identity').toLowerCase();
  need(length===null||/^\d+$/.test(length)&&Number(length)<=maximum,'RENTCHECK_RESPONSE_SIZE','The complete response exceeds its selected import limit.');
  const chunks=[];let total=0;
  if(response.body){const reader=response.body.getReader();try{while(true){const chunk=await reader.read();if(chunk.done)break;total+=chunk.value.byteLength;
    need(total<=maximum,'RENTCHECK_RESPONSE_SIZE','The complete response exceeds its selected import limit.');chunks.push(Buffer.from(chunk.value));}}
    catch(error){try{await reader.cancel();}catch{}throw error;}finally{reader.releaseLock();}}
  // Fetch may return decoded bytes while retaining the encoded length header.
  need(encoding!=='identity'||length===null||Number(length)===total,'RENTCHECK_RESPONSE_INCOMPLETE','The complete response did not match its declared length.');
  return Buffer.concat(chunks,total);
}
// One call only. The original workspace must retain PREPARED -> ISSUED before
// entry, and returned bytes before interpreting a response. In particular,
// this function provides no automatic retry or guessed idempotency header.
export async function fetchRentCheck(plan,{contract,credentialHeaders,fetch:transport=globalThis.fetch,signal}={}) {
  const selected=verifyPlan(plan,contract);
  need(object(credentialHeaders),'RENTCHECK_AUTH','The host must resolve this account’s selected credential references.');
  const supplied=Object.fromEntries(Object.entries(credentialHeaders).map(([k,v])=>[k.toLowerCase(),v]));
  need(canonical(Object.keys(supplied).sort())===canonical([...selected.auth_header_names].sort()),
    'RENTCHECK_AUTH','Supply exactly the credential headers in the retained account contract.');
  for(const value of Object.values(supplied))need(typeof value==='string'&&value&&!/[\r\n]/.test(value),'RENTCHECK_AUTH','A selected credential value is invalid.');
  need(typeof transport==='function','RENTCHECK_TRANSPORT','Use the original configured transport.');
  let response,raw;
  try {
    response=await transport(plan.request.url,{method:plan.request.method,redirect:'error',signal,
      headers:{...supplied,accept:'application/json','accept-encoding':'identity',...(plan.request.method==='POST'?{'content-type':'application/json'}:{})},
      ...(plan.request.method==='POST'?{body:canonical(plan.request.body)}:{})});
    raw=await bytes(response,MAX_RESPONSE);
  }catch(error){throw Object.assign(new Error(plan.operation==='create_inspection'?
      'Inspection creation did not return complete evidence. Keep the same pending request and reconcile an actual native inspection before any new create.':
      'The native read did not return a complete retained response.'),{
      code:plan.operation==='create_inspection'?'RENTCHECK_CREATE_UNCERTAIN':'RENTCHECK_READ_INCOMPLETE',
      request_sha256:plan.request_sha256,original_error_type:error?.name||'Error'});}
  return {raw,request_sha256:plan.request_sha256,response:{status:response.status,received_at:new Date().toISOString(),
    headers:Object.fromEntries([...response.headers].filter(([key])=>['content-type','content-length','content-encoding','date','etag','retry-after','x-request-id'].includes(key.toLowerCase())))}};
}
export function inspectRentCheckResponse({plan,contract,raw,response}) {
  verifyPlan(plan,contract);
  need(Buffer.isBuffer(raw)&&raw.length<=MAX_RESPONSE,'RENTCHECK_RESPONSE','Use the exact complete retained native bytes.');
  need(object(response)&&Number.isInteger(response.status)&&response.status>=100&&response.status<=599,'RENTCHECK_STATUS','Retain the actual native HTTP status.');
  const receipt={schema:'tjlabs.rentcheck-response/v1',request_sha256:plan.request_sha256,
    response_sha256:sha256(raw),response_bytes:raw.length,status:response.status,
    received_at:response.received_at??null,headers:clone(response.headers||{})};
  let document=null,parse_error=null;
  try{document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw),(_key,value)=>{if(typeof value==='number'&&(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value)))throw Error('Unrepresentable JSON number');return value;});}
  catch{parse_error='INVALID_UTF8_JSON';}
  const accepted=response.status>=200&&response.status<300;
  let native_inspection_id=null;
  if(accepted&&document!==null&&plan.operation==='create_inspection'&&contract.fields.created_inspection_id){
    const found=pointer(document,contract.fields.created_inspection_id);
    if(found.present&&typeof found.value==='string'&&found.value.trim())native_inspection_id=found.value;
  }
  return {receipt,document,parse_error,native_inspection_id,
    state:plan.operation==='create_inspection'?
      accepted&&native_inspection_id?'RETURNED_ID_REQUIRES_READBACK':'CREATE_REQUIRES_RECONCILIATION':
      accepted&&!parse_error?'READ_RETURNED':'READ_NOT_ACCEPTED',
    automatic_retry:false,
    meaning:plan.operation==='create_inspection'?'A create response is retained first. A native detail read verifies its actual property and template; a missing reply never licenses a second create.':'The original complete response is authoritative. No undocumented pagination or status meaning is inferred.'};
}
export function verifyRentCheckInspection({prepared,contract,detailPlan,detailRaw,detailResponse,inspection_id,mode,actor,note,createEvidence=null}) {
  const selected=verifyPlan(prepared,contract);
  need(prepared.operation==='create_inspection','RENTCHECK_CREATE','Select the original prepared inspection request.');
  id(inspection_id,'the actual native inspection');id(actor,'the receiving operator');id(note,'the reconciliation note');
  need(['RETURNED_CREATE','ADOPT_EXISTING'].includes(mode),'RENTCHECK_RECONCILIATION','Distinguish a returned create from explicit adoption of an existing inspection.');
  verifyPlan(detailPlan,selected);
  need(detailPlan.operation==='inspection'&&detailPlan.resource_id===inspection_id,'RENTCHECK_DETAIL_REQUEST','The retained detail request selects a different native inspection.');
  const detail=inspectRentCheckResponse({plan:detailPlan,contract:selected,raw:detailRaw,response:detailResponse});
  need(detail.receipt.status>=200&&detail.receipt.status<300&&detail.document!==null,'RENTCHECK_DETAIL','Retain a successful actual inspection detail response.');
  let create_response_sha256=null;
  if(mode==='RETURNED_CREATE'){
    need(createEvidence&&Buffer.isBuffer(createEvidence.raw),'RENTCHECK_CREATE_PROOF','Retain the actual original create response, or explicitly adopt the observed existing inspection.');
    const created=inspectRentCheckResponse({plan:prepared,contract:selected,raw:createEvidence.raw,response:createEvidence.response});
    need(created.state==='RETURNED_ID_REQUIRES_READBACK'&&created.native_inspection_id===inspection_id,'RENTCHECK_CREATE_PROOF','The retained original create response did not return this inspection identity.');
    create_response_sha256=created.receipt.response_sha256;
  }
  const found=detail.document;
  need(scalarAt(found,selected.fields.inspection_id,'inspection identity')===inspection_id &&
    scalarAt(found,selected.fields.inspection_property,'inspection property')===prepared.rentcheck_property_id &&
    scalarAt(found,selected.fields.inspection_template,'inspection template')===prepared.inspection_template_id,
    'RENTCHECK_DETAIL_MISMATCH','The actual native inspection differs from the selected property, template or inspection identity.');
  return {schema:'tjlabs.rentcheck-inspection-binding/v1',request_sha256:prepared.request_sha256,
    contract_sha256:selected.contract_sha256,property_id:prepared.property_id,
    rentcheck_property_id:prepared.rentcheck_property_id,inspection_template_id:prepared.inspection_template_id,
    inspection_id,detail_request_sha256:detailPlan.request_sha256,detail_response_sha256:detail.receipt.response_sha256,create_response_sha256,mode,actor,note,
    state:'BOUND_EXISTING_INSPECTION',automatic_retry:false,
    meaning:mode==='ADOPT_EXISTING'?'The operator adopted this observed native inspection. This does not assert that the uncertain original POST created it.':'The native returned inspection has been verified against its actual detail response.'};
}
export function bindRentCheckReportFile({binding,contract,detailRaw,raw,filename,mime_type,source}) {
  need(binding?.state==='BOUND_EXISTING_INSPECTION','RENTCHECK_REPORT','Bind the actual native inspection before its report.');
  need(Buffer.isBuffer(raw)&&raw.length>0,'RENTCHECK_REPORT','Retain the complete report file bytes.');
  id(filename,'the returned report filename');id(mime_type,'the returned report content type');
  need(object(source)&&['OPERATOR_NATIVE_EXPORT','RETURNED_NATIVE_URL'].includes(source.kind),'RENTCHECK_REPORT_SOURCE','Retain the actual native export or returned-URL source.');
  id(source.actor,'the importing operator');id(source.note,'the original-report source note');
  if(source.kind==='RETURNED_NATIVE_URL'){
    let url;try{url=new URL(source.url);}catch{}
    need(url&&url.protocol==='https:'&&!url.username&&!url.password,'RENTCHECK_REPORT_URL','Retain the actual HTTPS URL returned by the selected native inspection.');
    hash(source.detail_response_sha256,'report URL source');
    need(source.detail_response_sha256===binding.detail_response_sha256&&Buffer.isBuffer(detailRaw)&&sha256(detailRaw)===binding.detail_response_sha256,'RENTCHECK_REPORT_SOURCE','The report URL belongs to a different native detail response.');
    const selected=unchanged(contract);
    need(selected.contract_sha256===binding.contract_sha256&&selected.fields.report_url,'RENTCHECK_REPORT_SOURCE','Use the returned report locator from the same account contract.');
    let detail;try{detail=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(detailRaw));}catch{}
    const returned=pointer(detail,selected.fields.report_url);
    need(returned.present&&typeof returned.value==='string'&&new URL(returned.value).href===url.href,'RENTCHECK_REPORT_SOURCE','This URL was not returned at the selected original inspection report locator.');
  }
  return {schema:'tjlabs.rentcheck-report-file/v1',inspection_id:binding.inspection_id,
    property_id:binding.property_id,request_sha256:binding.request_sha256,
    detail_response_sha256:binding.detail_response_sha256,filename,mime_type,
    bytes:raw.length,sha256:sha256(raw),source:clone(source),
    meaning:'A complete original inspection report file associated by the receiving operator. Its findings remain separate from the Propply source aggregates and HPD project participation.'};
}
