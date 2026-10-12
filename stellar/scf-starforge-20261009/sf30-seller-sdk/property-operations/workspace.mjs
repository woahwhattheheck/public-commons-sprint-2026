// MIT. Property operations INSIDE the original Socrata writer, state and package.
import {resolve,dirname,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {canonical,sha256,preparePropplyRequest,fetchPropplyReport,inspectPropplyResponse} from './propply.mjs';
import {inspectHpdIdentity,candidateHpdRows,reviewPropertyLinks,comparePropertyEditions,PROPERTY_IDENTITY_MEANING} from './identity.mjs';
import {bindRentCheckContract,prepareRentCheckRead,prepareRentCheckInspection,fetchRentCheck,
  inspectRentCheckResponse,verifyRentCheckInspection,bindRentCheckReportFile} from './rentcheck.mjs';
import {preparePropertyResource} from './resource.mjs';
import {loadDatasetConfig} from '../dataset-handler.mjs';
import {buildDatasetSellerConfig,datasetQueryParameters} from '../dataset-cli.mjs';
import {parseRows,isSourceNumber} from '../socrata/source.mjs';

export const PROPERTY_SCHEMA='tjlabs.property-workspace/v1';
const COLLECTIONS=['baselines','selections','contracts','requests','editions','reviews','comparisons','bindings','documents','resources'];
export const PROPERTY_ACTIONS=Object.freeze([
  'property.get','property.operation','property.candidates','property.resource.publisher',
  'property.file.import','property.baseline.save','property.selection.save',
  'property.propply.prepare','property.rentcheck.contract','property.rentcheck.prepare','property.inspection.prepare',
  'property.request.run','property.request.recover','property.request.import',
  'property.identity.save','property.comparison.save','property.inspection.bind','property.report.save','property.resource.export'
]);
const READS=new Set(['property.get','property.operation','property.candidates','property.resource.publisher']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const has=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const clone=v=>JSON.parse(canonical(v));
const digest=v=>sha256(Buffer.from(canonical(v)));
const json=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const now=()=>new Date().toISOString();
const HASH=/^[a-f0-9]{64}$/;
const KEY=/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const need=(ok,code,message,status=409)=>{if(!ok)throw Object.assign(new Error(message),{code,status});};
function safe(path){need(typeof path==='string'&&path.startsWith('property/')&&path.length<=500&&!/[\u0000-\u001f\\]/.test(path)&&path.split('/').every(p=>p&&p!=='.'&&p!=='..'),'PROPERTY_PATH','A property file must remain in the original workspace property directory.');return path;}
const empty=()=>({schema:PROPERTY_SCHEMA,id:'property-'+randomUUID(),revision:0,files:{},operations:{},...Object.fromEntries(COLLECTIONS.map(k=>[k,[]]))});
export function propertyRetainedFiles(snapshot) {
  const state=snapshot.property;if(!state)return [];
  need(state.schema===PROPERTY_SCHEMA&&KEY.test(state.id||'')&&Number.isSafeInteger(state.revision)&&state.revision>=0&&object(state.files)&&object(state.operations),'PROPERTY_STATE','The retained property state is invalid.');
  for(const key of COLLECTIONS)need(Array.isArray(state[key]),'PROPERTY_STATE','A retained property collection is missing.');
  const entries=Object.entries(state.files);
  for(const [file,d] of entries)need(safe(file)===d.file&&Number.isSafeInteger(d.bytes)&&d.bytes>=0&&d.bytes<=64*1024*1024&&HASH.test(d.sha256||''),'PROPERTY_FILE','A property source descriptor is invalid.');
  for(const name of COLLECTIONS){const seen=new Set();for(const row of state[name]){
    need(object(row)&&KEY.test(row.id||'')&&!seen.has(row.id)&&state.files[row.file]?.sha256===row.sha256,'PROPERTY_RECORD','A property record is not bound to its retained original file.');seen.add(row.id);
  }}
  for(const [key,operation]of Object.entries(state.operations))need(KEY.test(key)&&operation.key===key&&PROPERTY_ACTIONS.includes(operation.action)&&HASH.test(operation.input_sha256||'')&&['ISSUED','DONE'].includes(operation.state),'PROPERTY_OPERATION','A retained property operation is invalid.');
  return entries.map(([,d])=>clone(d));
}
export async function validatePropertyPackage(snapshot,stored) {
  const descriptors=propertyRetainedFiles(snapshot),p=snapshot.property;if(!p)return;
  for(const d of descriptors){const raw=stored.get(d.file);need(Buffer.isBuffer(raw)&&raw.length===d.bytes&&sha256(raw)===d.sha256,'PROPERTY_PACKAGE_SOURCE','A complete property source differs from its saved descriptor.');}
  for(const group of COLLECTIONS)for(const row of p[group]){
    let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(stored.get(row.file)));}catch{}
    need(object(data)&&data.id===row.id&&data.kind===group,'PROPERTY_PACKAGE_RECORD','A property record has different identity or kind.');
    if(group==='requests')need(data.plan?.request_sha256&&HASH.test(data.plan.request_sha256)&&['propply','rentcheck'].includes(data.vendor)&&['PREPARED','ISSUED','RETURNED','BOUND'].includes(row.phase),'PROPERTY_PACKAGE_REQUEST','A retained request is invalid.');
  }
}
// Host options contain credential ENVIRONMENT NAMES, never values in actions,
// source records, browser state, exports or logs.
export function createPropertyOperations({directory,getState,save,immutable,bytesAt,host={}}) {
  need(object(host)&&(!has(host,'timeoutMs')||Number.isInteger(host.timeoutMs)&&host.timeoutMs>=1000&&host.timeoutMs<=120000),'PROPERTY_HOST','Select a host timeout between 1000 and 120000 milliseconds.');
  const current=()=>getState().property??null;
  const selected=()=>{const p=current();need(p,'PROPERTY_EMPTY','Save the first property source or selection.');return p;};
  async function commit(p) {
    propertyRetainedFiles({property:p});
    const original=getState().property;
    getState().property=clone(p);
    try{await save();}catch(error){if(original===undefined)delete getState().property;else getState().property=original;throw error;}
  }
  const fileDescriptor=(p,id)=>{const d=p.files[id];need(d,'PROPERTY_FILE','Select an original retained property file.',404);return d;};
  async function readFile(p,file){const d=fileDescriptor(p,file),raw=await bytesAt(directory,d.file,64*1024*1024);need(raw.length===d.bytes&&sha256(raw)===d.sha256,'PROPERTY_FILE_CHANGED','A retained property file changed.');return raw;}
  async function retain(p,path,raw){need(Buffer.isBuffer(raw)&&raw.length<=64*1024*1024,'PROPERTY_FILE_LIMIT','A property file exceeds 64 MiB.');safe(path);const d=await immutable(directory,path,raw);p.files[path]=d;return d;}
  async function retainJSON(p,path,value){return retain(p,path,json(value));}
  function row(p,group,id){need(COLLECTIONS.includes(group),'PROPERTY_COLLECTION','Select an original property record group.');const found=p[group].find(item=>item.id===id);need(found,'PROPERTY_RECORD','Select an existing '+group+' record.',404);return found;}
  async function data(p,group,id){const r=row(p,group,id);const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(p,r.file)));need(v.id===r.id&&v.kind===group,'PROPERTY_RECORD_CHANGED','A retained property record changed.');return v;}
  async function record(p,group,id,value,summary={}) {
    const body={...clone(value),id,kind:group},path='property/'+group+'/'+id+'.json',d=await retainJSON(p,path,body);
    const found=p[group].find(r=>r.id===id);
    if(found){need(found.sha256===d.sha256,'PROPERTY_RECORD_CONFLICT','This property record ID already names a different edition.');return found;}
    const r={id,kind:group,created_at:now(),...clone(summary),...d};p[group].push(r);return r;
  }
  function note(input){need(typeof input.actor==='string'&&input.actor.trim()&&typeof input.note==='string'&&input.note.trim(),'PROPERTY_REVIEWER','Retain the operator and selection note.');return {actor:input.actor,note:input.note};}
  function actionId(input,label){return label+'-'+sha256(Buffer.from(input.key)).slice(0,32);}
  function checkEnvelope(input){need(object(input)&&KEY.test(input.key||'')&&Number.isSafeInteger(input.expected_revision)&&input.expected_revision>=0,'PROPERTY_REQUEST','Use one retained request key and the displayed property revision.');}
  async function loadBaseline(p,input){
    const state=getState(),e=state.editions.find(e=>e.id===input.edition_id),c=state.captures.find(c=>c.id===e?.captureId);
    need(e&&c&&c.status==='completed'&&c.source?.domain==='data.cityofnewyork.us'&&c.source?.datasetId==='hg8x-zxpr','PROPERTY_HPD_SOURCE','Select the actual complete HPD Affordable Housing Production by Building edition.');
    const rows=[];
    const exact=v=>isSourceNumber(v)?v.text:Array.isArray(v)?v.map(exact):object(v)?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,exact(x)])):v;
    for(const page of c.pages){const raw=await bytesAt(directory,page.file);need(sha256(raw)===page.sha256&&raw.length===page.bytes,'PROPERTY_HPD_CHANGED','An original HPD page changed.');rows.push(...parseRows(raw).map(exact));}
    need(rows.length===c.rowCount,'PROPERTY_HPD_COUNT','The selected HPD page count changed.');
    const source={edition_id:e.id,snapshot:e.snapshot,capture_id:c.id,source:clone(c.source),revision:c.revision,consistency:c.consistency,pages:c.pages.map(d=>({file:d.file,bytes:d.bytes,sha256:d.sha256})),row_count:rows.length,numeric_policy:'Original numeric tokens retained as strings; no identifier rounding.'};
    return {...inspectHpdIdentity({source_sha256:digest(source),rows,columns:input.columns}),source,...note(input)};
  }
  function hostCredentials(request,contract){
    const env=(name)=>{need(typeof name==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(name),'PROPERTY_HOST_CREDENTIAL','Declare the credential environment name at host startup.');const value=process.env[name];need(typeof value==='string'&&value,'PROPERTY_HOST_CREDENTIAL','A configured credential environment variable is empty.');return value;};
    if(request.vendor==='propply'){need(host.propply?.enabled===true,'PROPERTY_HOST_DISABLED','This host has not enabled Propply report acquisition.');return {apiKey:env(host.propply.apiKeyEnv)};}
    const configured=host.rentcheck?.[contract.contract_sha256];
    need(configured?.enabled===true&&object(configured.headersEnv),'PROPERTY_HOST_DISABLED','Enable this exact reviewed RentCheck contract on the original host.');
    return {credentialHeaders:Object.fromEntries(Object.entries(configured.headersEnv).map(([key,value])=>[key,env(value)]))};
  }
  async function evidence(p,request){
    const path='property/requests/'+request.id+'-response.json';
    let raw;
    try{raw=await bytesAt(directory,path,32*1024*1024);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    let captured;try{captured=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{}
    need(captured?.schema==='tjlabs.property-response-capture/v1'&&captured.request_id===request.id&&captured.request_sha256===request.plan.request_sha256&&typeof captured.raw_base64==='string','PROPERTY_RESPONSE_BINDING','The retained original response belongs to another request.');
    const bytes=Buffer.from(captured.raw_base64,'base64');need(bytes.toString('base64')===captured.raw_base64&&bytes.length===captured.response_bytes&&sha256(bytes)===captured.response_sha256,'PROPERTY_RESPONSE_CHANGED','The complete captured response bytes changed.');
    p.files[path]={file:path,bytes:raw.length,sha256:sha256(raw)};
    return {captured,raw:bytes,capture_file:path};
  }
  async function acceptEvidence(p,r,capture) {
    const origin=capture.captured.origin;
    let interpreted;
    try {
      if(r.vendor==='propply')interpreted=inspectPropplyResponse(r.plan,capture.raw,capture.captured.response);
      else {const contract=(await data(p,'contracts',r.contract_id)).contract;interpreted=inspectRentCheckResponse({plan:r.plan,contract,raw:capture.raw,response:capture.captured.response});}
    }catch(error){interpreted={parse_error:error.code||'INVALID_RESPONSE',message:error.message,receipt:{request_sha256:r.plan.request_sha256,response_sha256:sha256(capture.raw),response_bytes:capture.raw.length,status:capture.captured.response.status},reports:[]};}
    const id=r.id+'-edition';
    const value={request_id:r.id,vendor:r.vendor,origin,capture_file:capture.capture_file,
      ...interpreted,original_response:capture.captured.response,actor:capture.captured.actor??null,note:capture.captured.note??null};
    const edition=await record(p,'editions',id,value,{vendor:r.vendor,request_id:r.id,successful:interpreted.receipt?.successful??interpreted.state==='READ_RETURNED',parse_error:interpreted.parse_error??null,report_count:interpreted.reports?.length??0});
    const summary=row(p,'requests',r.id);summary.phase='RETURNED';summary.edition_id=edition.id;summary.response_sha256=sha256(capture.raw);
    return {request:clone(summary),edition:clone(edition),automatic_retry:false};
  }
  async function recover(p,r){const selected=row(p,'requests',r.id);if(selected.phase==='BOUND')return {request:clone(selected),binding:clone(row(p,'bindings',selected.binding_id)),reused:true};const captured=await evidence(p,r);return captured?acceptEvidence(p,r,captured):{request:clone(row(p,'requests',r.id)),state:'RECONCILIATION_REQUIRED',automatic_retry:false,message:'No complete original response is retained. Keep this request. Inspect actual native records before any replacement create or report acquisition.'};}
  async function runRequest(p,input,operation){
    const r=await data(p,'requests',input.request_id),summary=row(p,'requests',r.id);
    need(input.request_sha256===r.plan.request_sha256,'PROPERTY_REQUEST_CHANGED','The displayed request has changed.');
    if(summary.phase==='BOUND')return {request:clone(summary),binding:clone(row(p,'bindings',summary.binding_id)),reused:true};
    if(summary.phase==='RETURNED')return {request:clone(summary),edition:clone(row(p,'editions',summary.edition_id)),reused:true};
    if(summary.phase==='ISSUED')return recover(p,r);
    need(summary.phase==='PREPARED','PROPERTY_REQUEST_PHASE','Keep the original issued operation.');
    const contract=r.vendor==='rentcheck'?(await data(p,'contracts',r.contract_id)).contract:null;
    const credentials=hostCredentials(r,contract);
    summary.phase='ISSUED';summary.issued_at=now();summary.run_key=input.key;
    p.operations[input.key]={...operation,state:'ISSUED',request_id:r.id};p.revision++;await commit(p);
    let acquired;
    try {acquired=r.vendor==='propply'?await fetchPropplyReport(r.plan,{...credentials,fetch:host.fetch,signal:AbortSignal.timeout(host.timeoutMs??60000)}):
      await fetchRentCheck(r.plan,{contract,...credentials,fetch:host.fetch,signal:AbortSignal.timeout(host.timeoutMs??60000)});}
    catch(error){return {request:clone(summary),state:'RECONCILIATION_REQUIRED',automatic_retry:false,error:error.code||'PROPERTY_RESPONSE_UNCERTAIN'};}
    const capture={schema:'tjlabs.property-response-capture/v1',request_id:r.id,request_sha256:r.plan.request_sha256,
      origin:'ORIGINAL_HOST_RESPONSE',response:acquired.response,response_bytes:acquired.raw.length,response_sha256:sha256(acquired.raw),raw_base64:acquired.raw.toString('base64')};
    await retainJSON(p,'property/requests/'+r.id+'-response.json',capture);
    return acceptEvidence(p,r,{captured:capture,raw:acquired.raw,capture_file:'property/requests/'+r.id+'-response.json'});
  }
  async function execute(p,action,input,operation) {
    const id=label=>actionId(input,label);
    switch(action){
      case 'property.file.import':{
        note(input);need(typeof input.path==='string'&&input.path,'PROPERTY_IMPORT','Choose the complete original file on this host.');
        const full=resolve(input.path),raw=await bytesAt(dirname(full),basename(full),64*1024*1024);
        need(HASH.test(input.sha256||'')&&sha256(raw)===input.sha256,'PROPERTY_IMPORT_CHANGED','The selected original file changed.');
        const path='property/originals/'+sha256(raw)+'/'+basename(full).replace(/[^A-Za-z0-9._-]/g,'_');
        const d=await retain(p,path,raw);
        return {file:{...d,actor:input.actor,note:input.note}};
      }
      case 'property.baseline.save':{
        const value=await loadBaseline(p,input);return {baseline:await record(p,'baselines',id('hpd'),value,{name:input.name||'HPD building-in-project baseline',edition_id:input.edition_id,row_count:value.rows.length})};
      }
      case 'property.selection.save':{
        note(input);need(typeof input.name==='string'&&input.name.trim()&&Array.isArray(input.properties)&&input.properties.length>0&&input.properties.length<=50,'PROPERTY_SELECTION','Name a complete selection of one to fifty properties.');
        const seen=new Set();for(const item of input.properties){need(object(item)&&Object.keys(item).every(k=>['id','propply_address','rentcheck_property_id','bbl','bin'].includes(k))&&KEY.test(item.id||'')&&!seen.has(item.id),'PROPERTY_SELECTION_ID','Each property needs a unique stable local ID.');seen.add(item.id);preparePropplyRequest({action:'compliance_report',properties:[item.propply_address]});if(item.rentcheck_property_id!==undefined&&item.rentcheck_property_id!==null)need(typeof item.rentcheck_property_id==='string'&&item.rentcheck_property_id.trim(),'PROPERTY_SELECTION_ID','Keep the native receiving property ID as text.');}
        return {selection:await record(p,'selections',id('selection'),{name:input.name,properties:input.properties,...note(input)},{name:input.name,property_count:input.properties.length})};
      }
      case 'property.propply.prepare':{
        const s=await data(p,'selections',input.selection_id),plan=preparePropplyRequest({action:input.report_action,properties:s.properties.map(x=>x.propply_address),options:input.options||{}});
        return {request:await record(p,'requests',id('request'),{vendor:'propply',selection_id:s.id,plan,...note(input)},{vendor:'propply',operation:plan.action,phase:'PREPARED',request_sha256:plan.request_sha256,selection_id:s.id})};
      }
      case 'property.rentcheck.contract':{
        const raw=await readFile(p,input.source_file),source=fileDescriptor(p,input.source_file);
        note(input);
        const contract=bindRentCheckContract({...input.contract,source:{path:source.file,bytes:raw.length,sha256:sha256(raw)}});
        return {contract:await record(p,'contracts',id('contract'),{contract},{name:contract.account_id,environment:contract.environment,contract_sha256:contract.contract_sha256})};
      }
      case 'property.rentcheck.prepare':{
        const c=await data(p,'contracts',input.contract_id),plan=prepareRentCheckRead({contract:c.contract,operation:input.operation,resource_id:input.resource_id??null,query:input.query||{}});
        return {request:await record(p,'requests',id('request'),{vendor:'rentcheck',contract_id:c.id,plan,...note(input)},{vendor:'rentcheck',operation:plan.operation,phase:'PREPARED',request_sha256:plan.request_sha256,contract_id:c.id})};
      }
      case 'property.inspection.prepare':{
        const c=await data(p,'contracts',input.contract_id),review=(await data(p,'reviews',input.review_id)).review;
        const property=review.links.find(r=>r.property_id===input.property_id)?.property;
        const template=await data(p,'requests',input.template_request_id),summary=row(p,'requests',template.id);
        need(template.vendor==='rentcheck'&&template.contract_id===c.id&&['templates','template'].includes(template.plan.operation)&&summary.phase==='RETURNED','RENTCHECK_TEMPLATE_SOURCE','Select a completed template read from this same account contract.');
        const response=await evidence(p,template);need(response&&response.captured.response.status>=200&&response.captured.response.status<300,'RENTCHECK_TEMPLATE_SOURCE','The selected template request did not return successfully.');
        const plan=prepareRentCheckInspection({contract:c.contract,property,template:{source_raw:response.raw,source_sha256:sha256(response.raw),record_pointer:input.record_pointer??''},identityReview:review,body:input.body});
        return {request:await record(p,'requests',id('request'),{vendor:'rentcheck',contract_id:c.id,review_id:input.review_id,template_request_id:template.id,plan,...note(input)},{vendor:'rentcheck',operation:plan.operation,phase:'PREPARED',property_id:property.id,request_sha256:plan.request_sha256,contract_id:c.id})};
      }
      case 'property.request.run':return runRequest(p,input,operation);
      case 'property.request.recover':return recover(p,await data(p,'requests',input.request_id));
      case 'property.request.import':{
        const r=await data(p,'requests',input.request_id),summary=row(p,'requests',r.id);note(input);
        need(!['RETURNED','BOUND'].includes(summary.phase),'PROPERTY_RETURNED','This request already has its retained original response.');
        need(input.request_sha256===r.plan.request_sha256,'PROPERTY_REQUEST_CHANGED','Select the exact original request hash.');
        const raw=await readFile(p,input.response_file);
        need(raw.length<=16*1024*1024&&object(input.response)&&Number.isInteger(input.response.status)&&input.response.status>=100&&input.response.status<=599&&(input.response.received_at===undefined||typeof input.response.received_at==='string'&&Number.isFinite(Date.parse(input.response.received_at))),'PROPERTY_RESPONSE_IMPORT','Retain the actual original HTTP metadata.');
        const capture={schema:'tjlabs.property-response-capture/v1',request_id:r.id,request_sha256:r.plan.request_sha256,
          origin:'OPERATOR_IMPORTED_ORIGINAL_RESPONSE',...note(input),response:clone(input.response),response_bytes:raw.length,response_sha256:sha256(raw),raw_base64:raw.toString('base64')};
        await retainJSON(p,'property/requests/'+r.id+'-response.json',capture);
        return acceptEvidence(p,r,{captured:capture,raw,capture_file:'property/requests/'+r.id+'-response.json'});
      }
      case 'property.identity.save':{
        const b=await data(p,'baselines',input.baseline_id),e=await data(p,'editions',input.edition_id),s=await data(p,'selections',input.selection_id);
        need(e.vendor==='propply'&&e.receipt.successful,'PROPERTY_REPORT_EDITION','Select a successful complete Propply report edition.');
        const request=await data(p,'requests',e.request_id);need(request.selection_id===s.id,'PROPERTY_SELECTION_CHANGED','Use the exact property selection that produced this report.');
        const review=reviewPropertyLinks({baseline:b,reportEdition:e,properties:s.properties,links:input.links,...note(input)});
        return {review:await record(p,'reviews',id('review'),{baseline_id:b.id,edition_id:e.id,selection_id:s.id,review},{baseline_id:b.id,edition_id:e.id,selection_id:s.id,link_count:review.links.length,identity_sha256:review.identity_sha256})};
      }
      case 'property.comparison.save':{
        const left=await data(p,'reviews',input.previous_review_id),right=await data(p,'reviews',input.current_review_id);
        const comparison=comparePropertyEditions({previous:await data(p,'editions',left.edition_id),current:await data(p,'editions',right.edition_id),previousReview:left.review,currentReview:right.review,fields:input.fields});
        return {comparison:await record(p,'comparisons',id('comparison'),{previous_review_id:left.id,current_review_id:right.id,comparison,...note(input)},{previous_review_id:left.id,current_review_id:right.id,row_count:comparison.rows.length})};
      }
      case 'property.inspection.bind':{
        const r=await data(p,'requests',input.prepared_request_id),detail=await data(p,'requests',input.detail_request_id);
        need(r.contract_id===detail.contract_id,'RENTCHECK_ACCOUNT_CHANGED','The original create and detail requests select different contracts.');
        need(row(p,'requests',r.id).phase!=='BOUND','RENTCHECK_ALREADY_BOUND','This original create request already has its retained inspection binding.');
        const contract=(await data(p,'contracts',r.contract_id)).contract,found=await evidence(p,detail),created=await evidence(p,r);
        need(found,'RENTCHECK_DETAIL','Retain the complete actual native detail response.');
        const binding=verifyRentCheckInspection({prepared:r.plan,contract,detailPlan:detail.plan,detailRaw:found.raw,detailResponse:found.captured.response,inspection_id:input.inspection_id,mode:input.mode,...note(input),
          createEvidence:created?{raw:created.raw,response:created.captured.response}:null});
        const saved=await record(p,'bindings',id('binding'),{binding,prepared_request_id:r.id,detail_request_id:detail.id,review_id:r.review_id,contract_id:r.contract_id},{property_id:binding.property_id,inspection_id:binding.inspection_id,mode:binding.mode,review_id:r.review_id});
        const selected=row(p,'requests',r.id);selected.phase='BOUND';selected.binding_id=saved.id;
        return {binding:saved};
      }
      case 'property.report.save':{
        const b=await data(p,'bindings',input.binding_id),c=await data(p,'contracts',b.contract_id),detail=await evidence(p,await data(p,'requests',b.detail_request_id));
        const raw=await readFile(p,input.report_file);
        const report=bindRentCheckReportFile({binding:b.binding,contract:c.contract,detailRaw:detail?.raw,raw,filename:input.filename,mime_type:input.mime_type,source:input.source});
        return {report:await record(p,'documents',id('report'),{binding_id:b.id,report_file:input.report_file,report},{binding_id:b.id,inspection_id:report.inspection_id,filename:report.filename,bytes:report.bytes})};
      }
      case 'property.resource.export':{
        const review=await data(p,'reviews',input.review_id),edition=await data(p,'editions',review.edition_id);
        const comparison=input.comparison_id?await data(p,'comparisons',input.comparison_id):null;
        need(!comparison||comparison.current_review_id===review.id,'PROPERTY_RESOURCE_COMPARISON','The selected comparison must end in this exact review.');
        const bindings=[];for(const item of input.binding_ids||[]){const b=await data(p,'bindings',item);need(b.review_id===review.id,'PROPERTY_RESOURCE_INSPECTION','A selected inspection belongs to another saved review.');bindings.push(b.binding);}
        const reports=[];for(const item of input.report_ids||[]){const d=await data(p,'documents',item);need((input.binding_ids||[]).includes(d.binding_id),'PROPERTY_RESOURCE_REPORT','Select the source binding for each included report.');reports.push(d.report);}
        const prepared=preparePropertyResource({review:review.review,edition,fields:input.fields,resource_key:input.resource_key,name:input.name,rights:input.rights,comparison:comparison?.comparison,inspections:bindings,reports});
        const resourceId=id('resource'),path='property/resources/'+resourceId;
        const descriptors=[];
        for(const [name,raw]of [['dataset.csv',prepared.csv],['dataset.json',json(prepared.config)],['source/property-selection.json',json(prepared.source)]])descriptors.push({...await retain(p,path+'/'+name,raw),name});
        const sourceFiles=[{path:'source/property-selection.json',bytes:descriptors[2].bytes,sha256:descriptors[2].sha256}];
        if(input.rights.include_complete_vendor_response){
          const original=await evidence(p,await data(p,'requests',edition.request_id));
          need(original,'PROPERTY_RESOURCE_ORIGINAL','The complete vendor original is required by this selected export.');
          const d=await retain(p,path+'/source/propply-response.json',original.raw);
          descriptors.push({...d,name:'source/propply-response.json'});sourceFiles.push({path:'source/propply-response.json',bytes:d.bytes,sha256:d.sha256});
        }
        if((input.report_ids||[]).length){
          need(input.rights.include_inspection_report_files===true,'PROPERTY_RESOURCE_REPORT_RIGHTS','Explicitly approve these selected original inspection files in the customer resource.');
          for(const item of input.report_ids){const d=await data(p,'documents',item),raw=await readFile(p,d.report_file);
            const name='source/inspection-'+d.id+'-'+d.report.filename.replace(/[^A-Za-z0-9._-]/g,'_'),out=await retain(p,path+'/'+name,raw);
            descriptors.push({...out,name});sourceFiles.push({path:name,bytes:out.bytes,sha256:out.sha256});
          }
        }
        const sourceIndex={schema:'tjlabs.property-resource-index/v1',resource_key:prepared.resource_key,name:input.name,
          rights:clone(input.rights),identity_sha256:review.review.identity_sha256,hpd_source_sha256:review.review.hpd_source_sha256,
          propply_response_sha256:edition.receipt.response_sha256,exact_csv:prepared.source.exact_csv,
          meaning:PROPERTY_IDENTITY_MEANING,sourceFiles};
        descriptors.push({...await retainJSON(p,path+'/source.json',sourceIndex),name:'source.json'});
        const native=await loadDatasetConfig(resolve(directory,path,'dataset.json'));
        const seller=await buildDatasetSellerConfig(native,{payment:input.payment,origin:input.origin,path:input.path??'/data'});
        descriptors.push({...await retainJSON(p,path+'/seller.json',seller),name:'seller.json'});
        const query={schema:'stellar-forge.dataset-query.v1',snapshot:native.describe().snapshot,query:{limit:'25'},queryParameters:datasetQueryParameters(native.describe())};
        descriptors.push({...await retainJSON(p,path+'/query.json',query),name:'query.json'});
        const guide=Buffer.from('# '+input.name+'\n\nThis is a separately selected property resource. The original HPD workspace and its publisher are preserved.\n\nResource rows contain explicit JSON present/value cells. HPD project participation, Propply report aggregates and native RentCheck inspections are distinct source boundaries. Exact selected source and party-approved rights are in source.json. No API credentials are included.\n\nUse the original Socrata publisher/buyer with this complete export directory. Keep its existing expected snapshot/revision review, payment choices, native buyer request/session recovery and customer export. Do not charge again after a lost paid reply. The complete private operator state is exported separately with the original package.export action.\n');
        descriptors.push({...await retain(p,path+'/README.md',guide),name:'README.md'});
        const result={resource_key:prepared.resource_key,review_id:review.id,contract_selection_sha256:prepared.contract_selection_sha256,
          directory:resolve(directory,path),files:descriptors,snapshot:native.describe().snapshot,dataset:native.describe(),query,rights:clone(input.rights)};
        return {resource:await record(p,'resources',resourceId,result,{name:input.name,resource_key:prepared.resource_key,review_id:review.id,snapshot:result.snapshot,contract_selection_sha256:prepared.contract_selection_sha256,directory:result.directory,files:descriptors}),preview:native.handle({query:{limit:'5'}}).body};
      }
      default:throw Object.assign(new Error('Unknown property action.'),{code:'PROPERTY_ACTION',status:404});
    }
  }
  async function act(action,input={}) {
    if(READS.has(action)){
      if(action==='property.operation'&&!current())return {operation:null,workspace_id:null,revision:0};
      const p=selected();
      if(action==='property.operation'){const operation=has(p.operations,input.key)?p.operations[input.key]:null;return {operation:operation?clone(operation):null,workspace_id:p.id,revision:p.revision};}
      if(action==='property.get')return {record:await data(p,input.group,input.id),workspace_id:p.id,revision:p.revision};
      if(action==='property.candidates')return candidateHpdRows(await data(p,'baselines',input.baseline_id),input);
      const r=await data(p,'resources',input.resource_id);
      // Derive current host paths after restore; the retained old path remains provenance only.
      const folder='property/resources/'+r.id;
      for(const d of r.files)await readFile(p,d.file);
      return {resource_id:r.id,resource_key:r.resource_key,contract_selection_sha256:r.contract_selection_sha256,
        exportDirectory:resolve(directory,folder),publisherDirectory:resolve(directory,'property-publishers',r.resource_key+'-'+r.contract_selection_sha256.slice(0,24)),resource:r};
    }
    checkEnvelope(input);
    let p=clone(current()||empty()),old=has(p.operations,input.key)?p.operations[input.key]:null,input_sha256=digest(input);
    if(old){need(old.action===action&&old.input_sha256===input_sha256,'PROPERTY_REQUEST_CONFLICT','This request key already belongs to different exact inputs.');
      if(old.state==='DONE')return clone(old.result);
      need(action==='property.request.run','PROPERTY_REQUEST_UNCERTAIN','Recover this original operation before another mutation.');
    }else {need(input.workspace_id===(current()?.id??null),'PROPERTY_WORKSPACE_CHANGED','This prepared action belongs to another original property workspace.');need(p.revision===input.expected_revision,'PROPERTY_REVISION','The property workspace changed. Refresh before preparing a new action.');}
    const operation=old??{key:input.key,action,input_sha256,state:'ISSUED',created_at:now()};
    const result=await execute(p,action,input,operation);
    p.operations[input.key]={...operation,state:'DONE',completed_at:now(),result:clone(result)};
    p.revision++;await commit(p);return result;
  }
  async function beforeExport(){
    if(!current())return;
    const p=clone(current());let changed=false;
    for(const r of p.requests.filter(r=>r.phase==='ISSUED')){const captured=await evidence(p,await data(p,'requests',r.id));if(captured){await acceptEvidence(p,await data(p,'requests',r.id),captured);changed=true;}}
    if(changed){p.revision++;await commit(p);}
  }
  function view(){
    const p=current();if(!p)return {schema:PROPERTY_SCHEMA,id:null,revision:0,...Object.fromEntries(COLLECTIONS.map(k=>[k,[]])),files:[],operations:[],meaning:PROPERTY_IDENTITY_MEANING};
    return {schema:p.schema,id:p.id,revision:p.revision,...Object.fromEntries(COLLECTIONS.map(k=>[k,k==='resources'?p[k].map(r=>({...clone(r),directory:resolve(directory,'property/resources/'+r.id)})):clone(p[k])])),
      files:Object.values(p.files).map(d=>clone(d)),operations:Object.values(p.operations).map(o=>({key:o.key,action:o.action,state:o.state,input_sha256:o.input_sha256,created_at:o.created_at,completed_at:o.completed_at??null})),meaning:PROPERTY_IDENTITY_MEANING};
  }
  return {act,view,beforeExport,readFile:async file=>{const p=selected(),d=fileDescriptor(p,file);await readFile(p,file);return {path:resolve(directory,file),contentType:file.endsWith('.json')?'application/json; charset=utf-8':'application/octet-stream',filename:basename(file),bytes:d.bytes,sha256:d.sha256};}};
}
