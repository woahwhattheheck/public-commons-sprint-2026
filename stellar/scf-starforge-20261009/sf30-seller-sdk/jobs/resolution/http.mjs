// MIT. Resolution extensions use the original customer capability and private operator host.
import {readFile} from 'node:fs/promises';
import {JOB_ID,need,object,json,hash,RESOLUTION_RECEIVING_BYTES} from './contract.mjs';

export const RESOLUTION_REQUEST_BYTES=RESOLUTION_RECEIVING_BYTES;
export function decodeJob(value){
  let id;try{id=decodeURIComponent(value);}catch{need(false,'JOB_NOT_FOUND',404);}
  need(JOB_ID.test(id)&&encodeURIComponent(id)===value,'JOB_NOT_FOUND',404);return id;
}
export async function readResolutionJson(request,{maxBytes=24000}={}){
  need(request.headers['content-type']?.split(';')[0].trim().toLowerCase()==='application/json',
    'JOB_RESOLUTION_JSON_REQUIRED',415);
  const declared=request.headers['content-length'];
  if(declared!==undefined)need(/^\d+$/.test(declared)&&Number(declared)<=maxBytes,'JOB_RESOLUTION_BODY_TOO_LARGE',413);
  let size=0;const parts=[];
  for await(const part of request){size+=part.length;need(size<=maxBytes,'JOB_RESOLUTION_BODY_TOO_LARGE',413);parts.push(part);}
  if(declared!==undefined)need(size===Number(declared),'JOB_RESOLUTION_BODY_TRUNCATED');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));}catch{need(false,'JOB_RESOLUTION_JSON_INVALID');}
  need(object(value),'JOB_RESOLUTION_JSON_INVALID');return value;
}
export async function readResolutionRequest(request,options){
  if(request.method==='POST')return readResolutionJson(request,options);
  need(['GET','HEAD'].includes(request.method),'METHOD_NOT_ALLOWED',405);
  need(request.headers['transfer-encoding']===undefined&&
    (request.headers['content-length']===undefined||request.headers['content-length']==='0'),
    'JOB_RESOLUTION_BODY_REJECTED');
  return undefined;
}
export function resolutionCustomerPath(path){return /^\/jobs\/[^/?#]+\/resolution(?:\/(?:issues|messages|receipt))?$/.test(path);}
export async function handleJobResolutionCustomer(service,{method,path,token,value}={}){
  if(!resolutionCustomerPath(path))return null;
  need(service,'JOB_RESOLUTION_NOT_AVAILABLE',404);
  const match=/^\/jobs\/([^/?#]+)\/resolution(?:\/(issues|messages|receipt))?$/.exec(path),jobId=decodeJob(match[1]),action=match[2];
  if((!action||action==='receipt')&&['GET','HEAD'].includes(method)){
    const result=await service.customer(jobId,token);
    if(action==='receipt'){const bytes=json(result);return {file:{bytes,type:'application/json; charset=utf-8',
      name:'job-resolution-'+hash(jobId).slice(0,16)+'.json',sha256:hash(bytes)}};}
    return {value:result};
  }
  if(action==='issues'&&method==='POST')return {value:await service.issue(jobId,token,value),status:201};
  if(action==='messages'&&method==='POST')return {value:await service.customerMessage(jobId,token,value),status:201};
  need(false,'METHOD_NOT_ALLOWED',405);
}
export function resolutionOperatorPath(path){
  return path==='/api/resolutions'||path.startsWith('/api/resolutions/')||/^\/api\/jobs\/[^/?#]+\/resolution(?:\/|$)/.test(path);
}
export async function handleJobResolutionOperator(service,{method,path,value}={}){
  if(!resolutionOperatorPath(path))return null;
  need(service,'JOB_RESOLUTION_NOT_AVAILABLE',404);
  if(path==='/api/resolutions'&&method==='GET')return {value:await service.list()};
  if(path==='/api/resolutions/accounting'&&method==='GET')return {value:await service.accountingState()};
  if(path==='/api/resolutions/connection'&&method==='POST')return {value:await service.connect(value)};
  if(path==='/api/resolutions/receive'&&method==='POST')return {value:await service.receive(value)};
  const match=/^\/api\/jobs\/([^/?#]+)\/resolution(?:\/([a-z]+))?$/.exec(path);
  need(match,'JOB_RESOLUTION_ROUTE_NOT_FOUND',404);const jobId=decodeJob(match[1]),action=match[2];
  if(!action&&method==='GET')return {value:await service.get(jobId)};
  if(action==='accountingexport'&&method==='GET')return {file:await service.accountingExport(jobId)};
  if(action==='export'&&method==='GET'){const bytes=json(await service.export(jobId));return {file:{bytes,
    type:'application/json; charset=utf-8',name:'job-resolution-private-'+hash(jobId).slice(0,16)+'.json',sha256:hash(bytes)}};}
  const methods={reply:'reply',case:'setCase',job:'jobAction',bind:'bind',refresh:'refresh',preview:'preview',
    record:'record',verify:'verify',withdraw:'withdraw',recover:'recover',resume:'resume'};
  need(method==='POST'&&Object.hasOwn(methods,action),'JOB_RESOLUTION_ROUTE_NOT_FOUND',404);
  return {value:await service[methods[action]](jobId,value)};
}
export async function jobResolutionAssets(){
  return Promise.all([
    ['/resolutions/','workspace/index.html','text/html; charset=utf-8'],
    ['/resolutions/app.mjs','workspace/app.mjs','text/javascript; charset=utf-8'],
    ['/resolutions/style.css','workspace/style.css','text/css; charset=utf-8']
  ].map(async([route,path,type])=>({route,type,bytes:await readFile(new URL(path,import.meta.url))})));
}
