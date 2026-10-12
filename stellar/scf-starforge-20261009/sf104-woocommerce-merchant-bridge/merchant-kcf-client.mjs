// MIT. Connector-source methods use the existing authenticated merchant transport.
import {createHash} from 'node:crypto';
import {canonicalErpJson} from './merchant-erp-client.mjs';

export const CONNECTOR_PROJECT_SCHEMA='stellar-forge.sf104.connector-project.v1';
export const CONNECTOR_MAX_BYTES=32*1024*1024;
const HASH=/^[a-f0-9]{64}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function need(x,message){if(!x)throw Error(message);}
function id(x){need(typeof x==='string'&&HASH.test(x),'Select the exact retained connector reference.');return x;}
function operation(x){need(typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(x),'Supply the stable original operation ID.');return x;}
function pageQuery({page=1,limit=50,...rest}={}){
  need(Number.isSafeInteger(page)&&page>=1&&page<=1000000&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'Select a supported complete inventory page.');
  return new URLSearchParams({...rest,page:String(page),limit:String(limit)}).toString();
}
function page(value){need(object(value)&&Array.isArray(value.items)&&Number.isSafeInteger(value.total)&&value.total>=0&&Number.isSafeInteger(value.page)&&Number.isSafeInteger(value.limit)&&value.items.length<=value.limit,'The retained inventory response is incomplete.');return value;}
export function verifyConnectorProject(project){
  need(object(project)&&project.schema===CONNECTOR_PROJECT_SCHEMA&&HASH.test(project.sha256)&&HASH.test(project.installationId)&&Array.isArray(project.objects)&&Array.isArray(project.erpProjects),'Select a complete private connector project.');
  const{sha256,...content}=project;
  need(createHash('sha256').update(canonicalErpJson(content)).digest('hex')===sha256,'The complete connector project digest differs from its bytes.');
  need(Buffer.byteLength(JSON.stringify(project))<=CONNECTOR_MAX_BYTES,'The private connector project exceeds 32 MiB.');
  for(const item of project.objects){
    need(object(item)&&object(item.record)&&HASH.test(item.sha256)&&createHash('sha256').update(canonicalErpJson(item.record)).digest('hex')===item.sha256,'A retained source object differs from its complete digest.');
    if(item.record.kind==='blob'){
      const b=Buffer.from(item.record.contentBase64,'base64');
      need(b.toString('base64')===item.record.contentBase64&&b.length===item.record.bytes&&createHash('sha256').update(b).digest('hex')===item.record.sha256,'An original source file failed its byte check.');
    }
  }
  return project;
}
export function connectorSourceFile(bytes,{name,format,delimiter=','}={}){
  need(Buffer.isBuffer(bytes)||bytes instanceof Uint8Array,'Supply the original source bytes.');
  const b=Buffer.from(bytes);
  need(b.length<=4*1024*1024&&typeof name==='string'&&name.length>=1&&name.length<=200&&!/[\/\\\r\n\0]/.test(name)&&['json','csv'].includes(format),'Select a JSON or CSV original within the 4 MiB source limit.');
  return{name,format,delimiter,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex'),contentBase64:b.toString('base64')};
}
export function createConnectorMethods({requestUrl,siteUrl}){
  const base=siteUrl+'/wp-json/stellar-forge/v1/merchant-kcf';
  const call=(path,body)=>requestUrl(base+path,body,{maxBytes:CONNECTOR_MAX_BYTES+4096,timeoutMs:120000});
  const at=iid=>'/installations/'+id(iid);
  const post=async(path,body,check=x=>x)=>{
    need(object(body)&&Buffer.byteLength(JSON.stringify(body))<=CONNECTOR_MAX_BYTES+4096,'The selected connector request exceeds its supported size.');
    if(path.endsWith('/preview')){}else operation(body.operationId);
    const r=await call(path,body);
    need(object(r)&&Number.isInteger(r.httpStatus)&&object(r.response),'The original connector operation response is incomplete.');
    if(r.httpStatus===200)check(r.response);return r;
  };
  const record=(r,kind,expected)=>{need(object(r)&&r.kind===kind&&HASH.test(r.id)&&(!expected||r.id===expected),'The retained '+kind+' identity is incomplete.');return r;};
  return Object.freeze({
    kcfStatus:async(options={})=>{const r=page(await call('?'+pageQuery(options)));need(r.schema==='stellar-forge.sf104.connector-status.v1','The connector workspace schema differs.');return r;},
    kcfCreateInstallation:body=>post('/installations',body,r=>record(r.installation,'installation')),
    kcfInstallation:async iid=>{const r=await call(at(iid));record(r.installation,'installation',iid);need(object(r.head)&&Number.isSafeInteger(r.head.revision),'The installation revision is missing.');return r;},
    kcfList:async(iid,collection,options={})=>{need(['receipts','editions','recipes','reviews','links','imports'].includes(collection),'Select a supported source collection.');return page(await call(at(iid)+'/'+collection+'?'+pageQuery(options)));},
    kcfRetainSource:(iid,body)=>post(at(iid)+'/receipts',body,r=>record(r.receipt,'receipt')),
    kcfReceipt:async(iid,rid)=>record(await call(at(iid)+'/receipts/'+id(rid)),'receipt',rid),
    kcfBrowse:async(iid,rid,{pointer='',page=1,limit=50}={})=>page(await call(at(iid)+'/receipts/'+id(rid)+'/browse?'+pageQuery({pointer,page,limit}))),
    kcfOriginal:async(iid,rid)=>{
      const r=await call(at(iid)+'/receipts/'+id(rid)+'/original');
      need(object(r)&&r.receiptId===rid&&HASH.test(r.sha256)&&typeof r.contentBase64==='string','The original source carrier is incomplete.');
      const b=Buffer.from(r.contentBase64,'base64');need(b.toString('base64')===r.contentBase64&&b.length===r.bytes&&createHash('sha256').update(b).digest('hex')===r.sha256,'The original source bytes differ.');return r;
    },
    kcfSaveEdition:(iid,body)=>post(at(iid)+'/editions',body,r=>record(r.edition,'edition')),
    kcfEdition:async(iid,eid)=>record(await call(at(iid)+'/editions/'+id(eid)),'edition',eid),
    kcfSelect:(iid,body)=>post(at(iid)+'/select',body),
    kcfSaveRecipe:(iid,body)=>post(at(iid)+'/recipes',body,r=>record(r.recipe,'recipe')),
    kcfRecipe:async(iid,rid)=>record(await call(at(iid)+'/recipes/'+id(rid)),'recipe',rid),
    kcfPreview:async(iid,rid)=>{const r=await call(at(iid)+'/recipes/'+id(rid)+'/preview');need(object(r)&&r.recipeId===rid&&HASH.test(r.sha256)&&typeof r.ready==='boolean','The complete mapping preview is missing.');return r;},
    kcfPreviewDraft:(iid,recipe)=>post(at(iid)+'/preview',{recipe}),
    kcfApply:(iid,rid,body)=>post(at(iid)+'/recipes/'+id(rid)+'/apply',body,r=>{need(HASH.test(r.map?.id)&&r.ordersChanged===false,'The original map application response differs.');}),
    kcfImpacts:async(iid,rid,options={})=>page(await call(at(iid)+'/recipes/'+id(rid)+'/impacts?'+pageQuery(options))),
    kcfCompare:async(iid,{before,after,change='all',q='',page=1,limit=50})=>{id(before);id(after);const r=page(await call(at(iid)+'/compare?'+pageQuery({before,after,change,q,page,limit})));need(HASH.test(r.selectionSha256),'The exact comparison selection is missing.');return r;},
    kcfReview:(iid,body)=>post(at(iid)+'/reviews',body,r=>record(r.review,'review')),
    kcfReviewRecord:async(iid,rid)=>record(await call(at(iid)+'/reviews/'+id(rid)),'review',rid),
    kcfOperation:async(iid,op)=>call(at(iid)+'/operations/'+encodeURIComponent(operation(op))),
    kcfExport:async(iid,{includeOrders=true}={})=>{need(typeof includeOrders==='boolean','Select the complete order inclusion explicitly.');const r=verifyConnectorProject(await call(at(iid)+'/export?includeOrders='+String(includeOrders)));need(r.installationId===iid,'The export refers to another installation.');return r;},
    kcfImport:(project,operationId)=>post('/import',{project:verifyConnectorProject(project),operationId:operation(operationId)}),
  });
}
