// MIT. Customer updates on the original authenticated Research HTTP listener.
import {pipeline} from 'node:stream/promises';
import {CUSTOMER_UPDATE_LIMIT,customerFields,customerIdentifier,requireCustomerUpdate as need} from './contracts.mjs';
import {inspectCustomerEuropePmcPlan} from './source-plans.mjs';
const integer=(value,fallback)=>{
  if(value===null)return fallback;
  need(/^(0|[1-9][0-9]{0,8})$/.test(value),'RESEARCH_PAGE_INVALID');
  const number=Number(value);need(Number.isSafeInteger(number),'RESEARCH_PAGE_INVALID');return number;
};
function selection(url,fields){
  const value={};
  for(const key of url.searchParams.keys())need(fields.includes(key),'CUSTOMER_UPDATE_QUERY_FIELD_INVALID');
  for(const key of fields){
    const raw=url.searchParams.get(key);
    if(raw===null)continue;
    value[key]=['revision','offset','limit'].includes(key)?integer(raw):raw;
  }
  return value;
}
export async function handleCustomerUpdateRoute({req,res,url,send,readJson,store,europePmc}){
  if(url.pathname==='/api/customer-updates/europe-pmc-plan'){
    if(req.method!=='POST'){send(405,{error:'METHOD_NOT_ALLOWED'});return true;}
    send(200,{schema:'sf88-research-customer-source-plan/v1',
      plan:await inspectCustomerEuropePmcPlan(europePmc,await readJson(req,1024*1024))});return true;
  }
  const match=url.pathname.match(/^\/api\/dossiers\/(d_[a-f0-9-]{36})\/customer-updates(?:\/(record|preview|reviews|work|export))?$/);
  if(!match)return false;
  const dossierId=match[1],action=match[2]??'';
  if(req.method==='GET'&&!action){
    const result=await store.customerUpdates(dossierId,selection(url,['revision','projectId','cycleId','section','offset','limit','query']));
    res.setHeader('X-Research-Dossier-Revision',String(result.revision));send(200,result);return true;
  }
  if(req.method==='POST'&&action==='record'){
    need(url.searchParams.size===0,'CUSTOMER_UPDATE_QUERY_FIELD_INVALID');
    const input=await readJson(req,65536);customerFields(input,['revision','path','sha256','label']);
    const result=await store.customerUpdateRecord(dossierId,input);
    res.setHeader('X-Research-Dossier-Revision',String(result.revision));send(200,result);return true;
  }
  if(req.method==='POST'&&action==='preview'){
    need(url.searchParams.size===0,'CUSTOMER_UPDATE_QUERY_FIELD_INVALID');
    const result=await store.previewCustomerUpdate(dossierId,await readJson(req,CUSTOMER_UPDATE_LIMIT));
    res.setHeader('X-Research-Dossier-Revision',String(result.revision));send(200,result);return true;
  }
  if(req.method==='POST'&&action==='reviews'){
    const query=selection(url,['projection']);
    need(query.projection===undefined||query.projection==='metadata'||query.projection==='full','RESEARCH_PROJECTION_INVALID');
    const result=await store.reviewCustomerUpdate(dossierId,{...await readJson(req,CUSTOMER_UPDATE_LIMIT),projection:query.projection??'metadata'});
    res.setHeader('X-Research-Dossier-Revision',String(result.dossier.revision));send(result.duplicate?200:201,result);return true;
  }
  if(req.method==='GET'&&action==='work'){
    const result=await store.customerUpdateWork(dossierId,selection(url,['revision','workId','section','offset','limit']));
    res.setHeader('X-Research-Dossier-Revision',String(result.workspaceRevision));send(200,result);return true;
  }
  if(req.method==='GET'&&action==='export'){
    const result=await store.exportCustomerUpdate(dossierId,selection(url,['revision','workId','deliveryId','format']));
    need(typeof result.filename==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(result.filename),'EXPORT_FILENAME_INVALID');
    res.setHeader('X-Research-Dossier-Revision',String(result.revision));
    if(result.sha256)res.setHeader('X-Research-Customer-File-Sha256',result.sha256);
    if(result.body instanceof Uint8Array){send(200,Buffer.from(result.body),result.contentType,result.filename);return true;}
    need(typeof result.body?.[Symbol.asyncIterator]==='function','CUSTOMER_UPDATE_EXPORT_BODY_INVALID');
    res.writeHead(200,{'Content-Type':result.contentType,'Content-Disposition':'attachment; filename="'+result.filename+'"',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"});
    await pipeline(result.body,res);return true;
  }
  send(405,{error:'METHOD_NOT_ALLOWED'});return true;
}
