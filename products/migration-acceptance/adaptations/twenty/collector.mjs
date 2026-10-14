// SPDX-License-Identifier: MIT
// Read-only complete Twenty collection. Native file/network adapters are in capture-twenty.mjs.
import {digest,canonical,inspectCapture,requireValue as need} from './provider-input.mjs';
import {parseExactJSON} from '../../workbench/vendor/dlt/vendor/sling/vendor/stellar-expert/exact-json.mjs';
export const CONFIG_SCHEMA='twenty.capture-config.v1';
const clone=v=>JSON.parse(JSON.stringify(v));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v);
function origin(value){need(typeof value==='string'&&/^https:\/\/(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[a-f0-9:]+\])(?::[0-9]{1,5})?\/?$/i.test(value),'Select an HTTPS API origin without a path or credentials.');return value.replace(/\/$/,'');}
const query=entries=>Object.entries(entries).filter(([,v])=>v!==null&&v!==undefined).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(String(v))).join('&');
function rows(value,kind){const out=Array.isArray(value.data)?value.data:value.data?.[kind];need(Array.isArray(out),'Unexpected complete '+kind+' response envelope.');return out;}
export function validateCaptureConfiguration(c){
 need(c?.schema===CONFIG_SCHEMA&&id(c.operationId),'Select a named complete CRM capture configuration.');
 need(['observed-interval','quiesced'].includes(c.consistency?.mode),'Declare the actual source consistency interval.');
 if(c.consistency.mode==='quiesced')need(typeof c.consistency.evidence==='string'&&c.consistency.evidence.trim(),'Retain original quiescence evidence.');
 for(const side of ['source','target']){
  const x=c[side];need(x&&typeof x.workspaceReference==='string'&&x.workspaceReference.trim()&&Array.isArray(x.objects)&&x.objects.length>0&&x.objects.length<=50,'Select the original '+side+' workspace and objects.');
  if(x.kind==='twenty-rest'){
   origin(x.baseUrl);need(typeof x.tokenEnv==='string'&&/^TWENTY_[A-Z][A-Z0-9_]*$/.test(x.tokenEnv),'Use an explicit TWENTY_ API-key environment variable name.');
   for(const s of x.objects){need(/^[A-Za-z][A-Za-z0-9]*$/.test(s.namePlural)&&Array.isArray(s.fields)&&s.fields.includes('id')&&s.fields.every(f=>typeof f==='string'&&/^[A-Za-z][A-Za-z0-9]*$/.test(f))&&new Set(s.fields).size===s.fields.length,'Select exact object/field names from workspace metadata.');need(s.filter===null||s.filter===undefined||typeof s.filter==='string'&&s.filter.trim(),'Preserve the original optional REST filter expression.');need(s.scope&&s.scope.coverage===(s.filter?'filtered-live':'all-live')&&typeof s.scope.population==='string'&&s.scope.population.trim()&&s.scope.deleted==='not-observed-by-list','Declare complete selected live scope and deletion boundary.');}
  }else{
   need(side==='source'&&x.kind==='retained-json'&&typeof x.system==='string'&&x.system.trim(),'Only source may use an original retained JSON export.');
   for(const o of x.objects)need(typeof o.path==='string'&&o.path&&o.spec&&typeof o.spec.namePlural==='string','Select every complete original export file and its source specification.');
  }
 }
 return c;
}
/** Adapters preserve complete requests/responses. This function never issues a mutation.
 * io: now(), wait(ms), readPage(key), savePage(key,page), request({url,tokenEnv}),
 * readOriginal(path), saveResult(capture), readSession(), saveSession(session).
 */
export async function collectCrmCapture(configuration,io){
 const config=clone(validateCaptureConfiguration(configuration)),configurationSha256=digest(canonical(config)).sha256;
 let session=await io.readSession();
 if(session)need(session.configurationSha256===configurationSha256&&canonical(session.configuration)===canonical(config),'This output belongs to a different original selection. Use its original configuration or a new directory.');
 else{session={schema:'twenty.capture-session.v1',operationId:config.operationId,configuration:config,configurationSha256,startedAt:io.now(),state:'collecting'};await io.saveSession(session);}
 if(session.state==='complete'){
  need(session.capture&&digest(canonical(session.capture)).sha256===session.captureSha256,'The original complete capture changed.');
  inspectCapture(session.capture);await io.saveResult(session.capture);return clone(session.capture);
 }
 let lastRequestAt=0;
 async function get(key,url,tokenEnv,request){
  const intent={url,request,tokenEnv},intentSha256=digest(canonical(intent)).sha256,old=await io.readPage(key);
  if(old){need(old.intentSha256===intentSha256&&canonical(old.intent)===canonical(intent),'Saved original request differs: '+key);const d=digest(old.page.body);need(d.bytes===old.page.bytes&&d.sha256===old.page.sha256,'Saved response bytes differ.');if(old.page.status===200)return clone(old.page);
   if(old.retryAt&&Date.parse(old.retryAt)>Date.parse(io.now()))throw Error('Original provider requested a later retry: '+old.retryAt);
  }
  const now=Date.parse(io.now());need(Number.isFinite(now),'Use the actual collector clock.');if(lastRequestAt&&now-lastRequestAt<700)await io.wait(700-(now-lastRequestAt));
  lastRequestAt=Date.parse(io.now());
  const response=await io.request({url,tokenEnv});need(Number.isInteger(response.status)&&typeof response.body==='string','Retain the complete original HTTP response.');
  const page={status:response.status,body:response.body,...digest(response.body),receivedAt:io.now(),request:clone(request)};
  const retry=typeof response.retryAfter==='string'&&response.retryAfter.trim()!==''?Number(response.retryAfter):NaN,retryAt=response.status===429?(Number.isFinite(retry)&&retry>=0?new Date(Date.parse(io.now())+retry*1000).toISOString():Number.isFinite(Date.parse(response.retryAfter))?new Date(response.retryAfter).toISOString():new Date(Date.parse(io.now())+60000).toISOString()):null;
  const saved={schema:'twenty.original-http-response.v1',intent,intentSha256,page,retryAt};await io.savePage(key,saved);
  need(response.status===200,'Original Twenty GET returned HTTP '+response.status+'. Complete response retained at '+key+(retryAt?'; resume after '+retryAt:'.'));
  return page;
 }
 async function metadata(base,tokenEnv,label){
  const out={};
  for(const kind of ['objects','fields']){
   const pages=[],seen=new Set();let cursor=null;
   for(let i=0;i<100000;i++){
    const request={startingAfter:cursor,limit:60},url=base+'/rest/metadata/'+kind+'?'+query({limit:60,starting_after:cursor});
    const p=await get(label+'/'+kind+'/'+String(i).padStart(6,'0'),url,tokenEnv,request),value=parseExactJSON(p.body),data=rows(value,kind);pages.push(p);
    need(value.pageInfo&&typeof value.pageInfo.hasNextPage==='boolean','Metadata response lacks its actual cursor.');
    if(!value.pageInfo.hasNextPage)break;
    const next=value.pageInfo.endCursor;need(typeof next==='string'&&next&&next!==cursor&&!seen.has(next)&&data.length>0,'Metadata cursor failed to advance.');seen.add(next);cursor=next;
    need(i<99999,'Metadata exceeds supported complete page capacity.');
   }
   out[kind]=pages;
  }
  return out;
 }
 async function rest(spec,label){
  const base=origin(spec.baseUrl),api={};
  for(const kind of ['core','metadata'])api[kind]=await get(label+'/openapi/'+kind,base+'/rest/open-api/'+kind,spec.tokenEnv,{kind});
  const before=await metadata(base,spec.tokenEnv,label+'/before');
  const objects=before.objects.flatMap(p=>rows(parseExactJSON(p.body),'objects'));
  const captured={kind:'twenty-rest',baseUrl:base,workspaceReference:spec.workspaceReference,deployedVersion:spec.deployedVersion??null,openapi:api,metadata:{before,after:null},objects:[]};
  for(const selection of spec.objects){
   const matches=objects.filter(o=>o.namePlural===selection.namePlural);need(matches.length===1,'Object plural is absent or ambiguous in authenticated metadata.');
   if(selection.objectMetadataId)need(matches[0].id===selection.objectMetadataId,'Selected original object metadata identity changed.');
   const selected={...clone(selection),objectMetadataId:matches[0].id,filter:selection.filter??null};
   const selectionSha256=digest(canonical({baseUrl:base,workspaceReference:spec.workspaceReference,spec:selected})).sha256;
   const pages=[],seen=new Set();let cursor=null;
   for(let i=0;i<100000;i++){
    const request={selectionSha256,startingAfter:cursor,limit:60,depth:0};
    const url=base+'/rest/'+encodeURIComponent(selected.namePlural)+'?'+query({limit:60,depth:0,fields:selected.fields.join(','),filter:selected.filter,starting_after:cursor});
    const p=await get(label+'/records/'+selected.namePlural+'/'+String(i).padStart(6,'0'),url,spec.tokenEnv,request),value=parseExactJSON(p.body),data=value.data?.[selected.namePlural];pages.push(p);
    need(Array.isArray(data)&&value.pageInfo&&typeof value.pageInfo.hasNextPage==='boolean','Original record page has no complete cursor/data envelope.');
    if(!value.pageInfo.hasNextPage)break;
    const next=value.pageInfo.endCursor;need(typeof next==='string'&&next&&next!==cursor&&!seen.has(next)&&data.length>0,'Record cursor failed to advance.');seen.add(next);cursor=next;
    need(i<99999,'Selected records exceed supported complete page capacity.');
   }
   captured.objects.push({spec:selected,pages});
  }
  captured.metadata.after=await metadata(base,spec.tokenEnv,label+'/after');
  return captured;
 }
 try{
  let source;
  if(config.source.kind==='twenty-rest')source=await rest(config.source,'source');
  else{
   source={kind:'retained-json',system:config.source.system,workspaceReference:config.source.workspaceReference,objects:[]};
   for(let i=0;i<config.source.objects.length;i++){
    const item=config.source.objects[i],key='source/original/'+String(i).padStart(6,'0'),old=await io.readPage(key);
    let original;
    if(old){need(old.sourcePath===item.path&&canonical(old.spec)===canonical(item.spec),'Retained original export selection changed.');original=old.original;const d=digest(original.body);need(d.bytes===original.bytes&&d.sha256===original.sha256,'Retained original export bytes differ.');}
    else{const read=await io.readOriginal(item.path);need(typeof read.body==='string'&&typeof read.filename==='string','Read the complete original UTF-8 JSON export.');original={body:read.body,...digest(read.body),filename:read.filename,receivedAt:io.now()};await io.savePage(key,{schema:'twenty.original-export.v1',sourcePath:item.path,spec:item.spec,original});}
    source.objects.push({spec:clone(item.spec),original:clone(original)});
   }
  }
  const target=await rest(config.target,'target');
  const capture={schema:'twenty.capture.v1',evidenceKind:'provider-response',state:'complete',operationId:config.operationId,startedAt:session.startedAt,completedAt:io.now(),consistency:clone(config.consistency),source,target};
  inspectCapture(capture);
  session={...session,state:'complete',completedAt:capture.completedAt,capture,captureSha256:digest(canonical(capture)).sha256};await io.saveSession(session);await io.saveResult(capture);return capture;
 }catch(error){session={...session,state:'interrupted',lastError:{at:io.now(),message:String(error.message||error)}};await io.saveSession(session);throw error;}
}
