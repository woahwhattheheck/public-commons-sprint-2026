import {createHash} from 'node:crypto';

export const PROPPLY_SOURCE = Object.freeze({
  vendor: 'Insparisk / Propply',
  documentation: 'https://insparisk.com/docs/api-docs',
  endpoint: 'https://propply.insparisk.com/.netlify/functions/api-propply',
  documented_version: '3.1',
  scope: 'Reported property aggregates and source coverage. A report is not an inspection, violation-level register, or finding of physical/legal compliance.',
  maximum_portfolio_properties: 50,
});
const MAX_BYTES = 16 * 1024 * 1024;
const ACTIONS = new Set(['compliance_report', 'portfolio_report']);
const ADDRESS_FIELDS = new Set(['address','state','zip','city','name']);
const OPTIONS = new Set(['include_equipment','include_violations','include_rules']);
const has = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (condition,code,message) => { if(!condition) throw Object.assign(new Error(message),{code}); };
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if(value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if(typeof value === 'number') {
    need(Number.isFinite(value), 'PROPERTY_NONFINITE', 'Nonfinite numbers are not a retained JSON value.');
    return JSON.stringify(value);
  }
  if(Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  need(object(value),'PROPERTY_JSON','Use a complete JSON value.');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key)+':'+canonical(value[key])).join(',') + '}';
}
const clone = value => JSON.parse(canonical(value));
function text(value,name,maximum=500) {
  need(typeof value === 'string' && value.trim() && value.length <= maximum && !/[\u0000-\u001f]/.test(value),
    'PROPERTY_FIELD', 'Provide ' + name + ' as a nonempty text value.');
  return value;
}
function property(value) {
  need(object(value),'PROPPLY_PROPERTY','Each property needs its selected address, state and ZIP.');
  need(Object.keys(value).every(key=>ADDRESS_FIELDS.has(key)),'PROPPLY_PROPERTY_FIELD','Only documented address fields belong in the Propply request.');
  for(const key of ['address','state','zip']) text(value[key],key,key==='address'?500:50);
  for(const key of ['city','name']) if(has(value,key)) text(value[key],key);
  return clone(value);
}
export function preparePropplyRequest({action,properties,options={}}) {
  need(ACTIONS.has(action),'PROPPLY_ACTION','Select the documented compliance_report or portfolio_report operation.');
  need(Array.isArray(properties) && properties.length >= 1 && properties.length <= 50,'PROPPLY_PORTFOLIO','Select between one and fifty properties.');
  need(action !== 'compliance_report' || properties.length === 1,'PROPPLY_SINGLE','A compliance report selects exactly one property.');
  const selected=properties.map(property);
  need(object(options) && Object.keys(options).every(key=>OPTIONS.has(key) && typeof options[key]==='boolean'),
    'PROPPLY_OPTIONS','Report options must be the documented boolean fields.');
  // The documented portfolio request is {properties:[...]}; single-report
  // options are deliberately not invented as portfolio-level parameters.
  need(action !== 'portfolio_report' || Object.keys(options).length === 0,
    'PROPPLY_PORTFOLIO_OPTIONS','The published portfolio contract does not define these report options.');
  const body=action==='compliance_report'?{...selected[0],...clone(options)}:{properties:selected};
  const request={method:'POST',url:PROPPLY_SOURCE.endpoint+'?action='+action,body};
  return Object.freeze({schema:'tjlabs.propply-request/v1',action,request,
    request_sha256:sha256(Buffer.from(canonical(request))),selected_properties:selected,
    source:PROPPLY_SOURCE,meaning:PROPPLY_SOURCE.scope});
}
function parseResponse(raw) {
  need(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= MAX_BYTES,'PROPPLY_RESPONSE_SIZE','Retain the complete report response within the 16 MiB import limit.');
  let value;
  try { value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw),(_key,value)=>{ if(typeof value==='number'&&(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value)))throw Error('Unsafe source number');return value; }); }
  catch { throw Object.assign(new Error('The retained Propply response is not valid UTF-8 JSON.'),{code:'PROPPLY_RESPONSE_JSON'}); }
  need(object(value),'PROPPLY_RESPONSE_JSON','The Propply response must be a JSON object.');
  return value;
}
export function inspectPropplyResponse(plan,raw,{status=200,received_at,headers={}}={}) {
  const selected=preparePropplyRequest({action:plan.action,properties:plan.selected_properties,
    options:plan.action==='compliance_report'?Object.fromEntries(Object.entries(plan.request?.body||{}).filter(([key])=>OPTIONS.has(key))):{}});
  need(canonical(selected)===canonical(plan),'PROPPLY_REQUEST_CHANGED','The selected original Propply request changed.');
  need(Number.isInteger(status) && status>=100 && status<=599,'PROPPLY_STATUS','Retain the actual HTTP status.');
  if(received_at !== undefined) need(typeof received_at==='string' && Number.isFinite(Date.parse(received_at)),'PROPPLY_TIME','Retain the actual response time.');
  const value=parseResponse(raw), successful=status>=200 && status<300 && value.success===true;
  const receipts={schema:'tjlabs.propply-response/v1',request_sha256:plan.request_sha256,
    response_sha256:sha256(raw),response_bytes:raw.length,status,received_at:received_at??null,
    headers:Object.fromEntries(Object.entries(headers).filter(([key])=>['content-type','content-length','content-encoding','date','etag','retry-after','x-request-id'].includes(key.toLowerCase())).map(([key,value])=>[key.toLowerCase(),String(value)])),
    successful,raw_file:'source/propply-response.json',meaning:PROPPLY_SOURCE.scope};
  if(!successful) return {receipt:receipts,document:value,reports:[],error:{
    error:typeof value.error==='string'?value.error:null,
    message:typeof value.message==='string'?value.message:null,
    statusCode:value.statusCode??null,details:value.details??null,
    retry_after:receipts.headers['retry-after']??null,
    next_action:'Keep this exact response and request. An operator chooses any later billable report request; no automatic report retry is implied.'}};
  let reports;
  if(plan.action==='compliance_report') {
    need(object(value.report),'PROPPLY_REPORT_MISSING','A successful compliance report did not contain the documented report object.');
    reports=[{locator:'/report',value:value.report}];
  } else {
    need(object(value.portfolio) && Array.isArray(value.portfolio.properties),'PROPPLY_REPORT_MISSING','A successful portfolio response did not contain the documented properties array.');
    need(value.portfolio.properties.length<=50,'PROPPLY_REPORT_LIMIT','The retained response exceeds the selected documented portfolio bound.');
    reports=value.portfolio.properties.map((report,index)=>{
      need(object(report),'PROPPLY_REPORT_SHAPE','Each returned portfolio property must be a report object.');
      return {locator:'/portfolio/properties/'+index,value:report};
    });
  }
  return {receipt:receipts,document:value,reports:reports.map(({locator,value:report})=>({
    report_id:'propply-'+sha256(Buffer.from(receipts.response_sha256+'\0'+locator)),
    locator,raw:report,
    selected_property_id:null,
    identity_state:'UNREVIEWED',
    property:has(report,'property')?clone(report.property):null,
    address:typeof report.address==='string'?report.address:null,
    reported_score:{field:plan.action==='portfolio_report'?'score':'risk_score',
      present:has(report,plan.action==='portfolio_report'?'score':'risk_score'),
      value:has(report,plan.action==='portfolio_report'?'score':'risk_score')?clone(report[plan.action==='portfolio_report'?'score':'risk_score']):null},
    reported_grade:has(report,'grade')?{present:true,value:clone(report.grade),meaning:'Vendor composite grade; not an HPD A/B/C violation class.'}:{present:false,value:null},
    risk_level:has(report,'risk_level')?clone(report.risk_level):null,
    open_violations:has(report,'open_violations')?{present:true,value:clone(report.open_violations)}:{present:false,value:null},
    overdue_inspections:has(report,'overdue_inspections')?{present:true,value:clone(report.overdue_inspections)}:{present:false,value:null},
    sources_checked:has(report,'sources_checked')?clone(report.sources_checked):null,
    data_coverage:has(report,'data_coverage')?clone(report.data_coverage):null,
    meaning:PROPPLY_SOURCE.scope,
  })),portfolio:plan.action==='portfolio_report'?{
    // Preserve vendor aggregates verbatim. Do not recompute from the HPD
    // building-in-project rows or silently replace absent coverage with zero.
    locator:'/portfolio',raw:clone(value.portfolio)}:null};
}
async function completeBytes(response,maximum=MAX_BYTES) {
  const declared=response.headers.get('content-length'),encoding=(response.headers.get('content-encoding')||'identity').toLowerCase();
  need(declared===null || /^\d+$/.test(declared) && Number(declared)<=maximum,
    'PROPPLY_RESPONSE_SIZE','The declared response exceeds the report import limit.');
  const chunks=[];let count=0;
  if(response.body) {
    const reader=response.body.getReader();
    try { while(true) { const {done,value}=await reader.read();if(done)break;count+=value.byteLength;
      need(count<=maximum,'PROPPLY_RESPONSE_SIZE','The response exceeds the report import limit.');chunks.push(Buffer.from(value)); } }
    catch(error) { try{await reader.cancel();}catch{} throw error; }
    finally{reader.releaseLock();}
  }
  // Fetch decodes content codings; encoded Content-Length is not the decoded body length.
  need(encoding!=='identity' || declared===null || Number(declared)===count,'PROPPLY_RESPONSE_INCOMPLETE','The returned byte count does not match the original Content-Length.');
  return Buffer.concat(chunks,count);
}
// This performs exactly one documented report request. The caller retains its
// prepared operation before entering this method and owns uncertain outcomes.
// No inspection, enrollment, automatic retry or payment call is made here.
export async function fetchPropplyReport(plan,{apiKey,fetch:transport=globalThis.fetch,signal}={}) {
  text(apiKey,'the selected Propply API key',8192);
  need(!/[\r\n]/.test(apiKey),'PROPPLY_CREDENTIAL','The selected API key is invalid.');
  need(typeof transport==='function','PROPPLY_TRANSPORT','A fetch-compatible original transport is required.');
  const expected=preparePropplyRequest({action:plan.action,properties:plan.selected_properties,
    options:plan.action==='compliance_report'?Object.fromEntries(Object.entries(plan.request?.body||{}).filter(([key])=>OPTIONS.has(key))):{}});
  need(canonical(expected)===canonical(plan),'PROPPLY_REQUEST_CHANGED','The reviewed report request has changed.');
  let response,raw;
  try {
    response=await transport(plan.request.url,{method:'POST',redirect:'error',signal,
      headers:{'content-type':'application/json','accept':'application/json','accept-encoding':'identity','x-api-key':apiKey},
      body:canonical(plan.request.body)});
    raw=await completeBytes(response);
  } catch(error) {
    const failure=Object.assign(new Error('The Propply report request did not return a complete retained response. Preserve the original request before choosing another billable acquisition.'),{
      code:'PROPPLY_RESPONSE_UNCERTAIN',request_sha256:plan.request_sha256,
      original_error_type:error?.name||'Error'});
    throw failure;
  }
  const received_at=new Date().toISOString();
  // Return bytes before interpretation so the original source operation can
  // retain even a malformed or unsuccessful complete vendor response first.
  // It then calls inspectPropplyResponse against that same retained file.
  return {raw,request_sha256:plan.request_sha256,response:{status:response.status,received_at,
    headers:Object.fromEntries([...response.headers].filter(([key])=>['content-type','content-length','content-encoding','date','etag','retry-after','x-request-id'].includes(key.toLowerCase())))}};
}
