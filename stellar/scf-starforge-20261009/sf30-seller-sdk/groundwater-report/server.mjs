// SPDX-License-Identifier: MIT
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {GroundwaterReportDesk} from './desk.mjs';
import {startPublication} from './publication.mjs';
import {SCHEMA,json,need,fail,fields,identity,checkFile,put,absolute,MAX_FILE} from './common.mjs';

export const ACTIONS=Object.freeze(['publish','buyer.prepare','buyer.prepare-catalog','buyer.capture','buyer.inspect','receiving.preview','receiving.commit','continue','desk.export','desk.restore','service.start','service.stop']);
export const BODY_LIMIT=36*1024*1024;
const assets=new Map([['/',['ui/index.html','text/html']],['/app.js',['ui/app.js','text/javascript']],
  ['/style.css',['ui/style.css','text/css']],['/guide',['OPERATOR.md','text/plain']]]);
export function decodeFiles(value){
  fields(value,['catalog','handoff','response'],'complete receiving files');
  const result={};
  for(const [name,limit]of [['catalog',1024*1024],['handoff',8*1024*1024],['response',MAX_FILE]]){
    const row=value[name];fields(row,['base64','bytes','sha256'],'original file bytes');
    need(typeof row.base64==='string'&&row.base64.length<=Math.ceil(limit/3)*4,'UPLOAD_LIMIT','Select the complete original file within its declared bound.',413);
    const raw=Buffer.from(row.base64,'base64'),actual=identity(raw);
    need(raw.toString('base64')===row.base64&&actual.bytes===row.bytes&&actual.sha256===row.sha256&&actual.bytes<=limit,
      'UPLOAD_IDENTITY','The selected file differs from its declared bytes and hash.',422);result[name]=raw;
  }
  return result;
}
export async function dispatchDesk(desk,action,value){
  need(ACTIONS.includes(action),'ACTION_UNKNOWN','Select an original report desk action.',404);
  if(action==='publish')return desk.publish(value);
  if(action==='buyer.prepare')return desk.prepareBuyer(value);
  if(action==='buyer.prepare-catalog'){
    const {catalog,...selected}=value;
    fields(catalog,['base64','bytes','sha256'],'original catalog');
    need(typeof catalog.base64==='string'&&catalog.base64.length<=1398104,'CATALOG_BOUND','Select the original catalog within 1 MiB.',413);
    const raw=Buffer.from(catalog.base64,'base64'),d=identity(raw);
    need(raw.toString('base64')===catalog.base64&&d.bytes===catalog.bytes&&d.sha256===catalog.sha256,'CATALOG_IDENTITY','The public catalog differs.');
    return desk.prepareCatalog({...selected,catalog:raw});
  }
  if(action==='buyer.capture')return desk.capture(value);
  if(action==='buyer.inspect'){
    fields(value,['handoff'],'original buyer handoff');const row=value.handoff;
    fields(row,['base64','bytes','sha256'],'original handoff file');
    need(typeof row.base64==='string'&&row.base64.length<=11184812,'UPLOAD_LIMIT','Select the bounded original handoff.',413);
    const raw=Buffer.from(row.base64,'base64'),info=identity(raw);
    need(raw.toString('base64')===row.base64&&info.bytes===row.bytes&&info.sha256===row.sha256&&raw.length<=8*1024*1024,'UPLOAD_IDENTITY','The original handoff differs from its selected identity.');
    return desk.handoffInfo(raw);
  }
  if(action==='receiving.preview'||action==='receiving.commit'){
    fields(value,['operationId','actor','input','files'],'report receiving');
    const {files,...rest}=value,selected={...rest,...decodeFiles(files)};
    return action==='receiving.preview'?desk.previewReceiving(selected):desk.receive(selected);
  }
  if(action==='continue'){fields(value,['operationId'],'original continuation');return desk.resume(value.operationId);}
  if(action==='desk.export')return desk.export(value);
  if(action==='desk.restore')return desk.restore(value);
  need(false,'SERVICE_ACTION','The configured original server owns the live file service.',422);
}
async function body(request){
  let count=0;const chunks=[];
  for await(const chunk of request){count+=chunk.length;need(count<=BODY_LIMIT,'UPLOAD_LIMIT','The request exceeds the complete file envelope.',413);chunks.push(chunk);}
  let value;try{value=JSON.parse(Buffer.concat(chunks));}catch{throw fail('JSON_REQUIRED','Send a complete JSON request.',422);}
  return value;
}
export async function startReportDesk({desk,port=0,launchFile=null,nativeFactory=null,handleSignals=true}={}){
  need(desk instanceof GroundwaterReportDesk,'DESK_REQUIRED','Open the original report desk.');
  const state=await desk.state(),token=randomBytes(32).toString('hex'),pending=new Set(),services=new Map(),starting=new Map();
  let closing=false,closePromise,origin;
  const prefix='/api/'+state.desk.id;
  function send(response,status,value,mime='application/json',extra={}){
    const raw=Buffer.isBuffer(value)?value:json(value);
    response.writeHead(status,{'content-type':mime,'content-length':raw.length,'cache-control':'no-store',
      'x-content-type-options':'nosniff','referrer-policy':'no-referrer',...extra});response.end(raw);
  }
  function authorized(request){
    const supplied=Buffer.from((request.headers.authorization??'').replace(/^Bearer /,''));
    const expected=Buffer.from(token);
    need(supplied.length===expected.length&&timingSafeEqual(supplied,expected),'ACCESS_REQUIRED','Open the original private launch link.',401);
  }
  async function action(name,value){
    if(name==='service.start'){
      fields(value,['publicationId','port'],'original file service');
      need(Number.isSafeInteger(value.port??0)&&(value.port??0)>=0&&(value.port??0)<=65535,'PORT_REQUIRED','Use a valid local port.',422);
      if(services.has(value.publicationId))return describe(services.get(value.publicationId));
      if(starting.has(value.publicationId))return describe(await starting.get(value.publicationId));
      const promise=(async()=>{const service=await startPublication({desk:await desk.open(),publicationId:value.publicationId,runtime:desk.runtime,
        nativeFactory,port:value.port??0,handleSignals:false});
        services.set(value.publicationId,service);return service;})();
      starting.set(value.publicationId,promise);
      try{return describe(await promise);}finally{starting.delete(value.publicationId);}
    }
    if(name==='service.stop'){
      fields(value,['publicationId'],'original file service');
      if(starting.has(value.publicationId))await starting.get(value.publicationId);
      const service=services.get(value.publicationId);
      if(service){await service.close();services.delete(value.publicationId);}
      return {state:'STOPPED',publicationId:value.publicationId};
    }
    return dispatchDesk(desk,name,value);
  }
  const describe=s=>({publicationId:s.publicationId,publicationSha256:s.publicationSha256,url:s.url,mode:s.mode,
    health:s.url+'/_seller/health',offers:s.url+'/_seller/offers',
    interpretation:s.mode==='CHALLENGE_ONLY'?'This local server returns native offers and challenges. It has no configured settlement facilitator.':'The original configured native facilitator owns verification and settlement.'});
  async function route(request,response){
    need(request.headers.host===new URL(origin).host,'HOST_REQUIRED','Use this original local host.',403);
    const url=new URL(request.url,origin);
    if(request.method==='GET'&&assets.has(url.pathname)){
      const [file,mime]=assets.get(url.pathname),raw=await readFile(new URL(file,import.meta.url));
      send(response,200,raw,mime,{'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});return;
    }
    if(request.method==='GET'&&url.pathname==='/bootstrap.js'){
      send(response,200,Buffer.from('globalThis.REPORT_DESK='+JSON.stringify({schema:SCHEMA,deskId:state.desk.id,apiBase:prefix})+';\n'),'text/javascript');return;
    }
    need(url.pathname.startsWith(prefix+'/'),'WORKSPACE_REQUIRED','Reopen this exact report desk launch link.',404);
    authorized(request);const path=url.pathname.slice(prefix.length);
    if(request.method==='POST'){
      need(!closing,'SERVER_CLOSING','The original server is closing.',503);
      need(request.headers.origin===origin,'ORIGIN_REQUIRED','Use the original same-origin operator.',403);
      need((request.headers['content-type']??'').split(';')[0]==='application/json','JSON_REQUIRED','Send application/json.',415);
      need(path==='/action','ROUTE_UNKNOWN','Use the original action route.',404);
      const value=await body(request);fields(value,['action','input'],'action envelope');
      send(response,200,await action(value.action,value.input));return;
    }
    need(request.method==='GET','METHOD_REQUIRED','Use the declared method.',405);
    if(path==='/state'){send(response,200,{...(await desk.state()),services:[...services.values()].map(describe)});return;}
    if(path==='/reports'){send(response,200,await desk.reports());return;}
    if(path==='/cases'){send(response,200,await desk.cases());return;}
    const id=url.searchParams.get('id');
    if(path==='/report'){send(response,200,await desk.report(id));return;}
    if(path==='/case'){send(response,200,await desk.case(id));return;}
    if(path==='/operation'){send(response,200,await desk.original(id));return;}
    if(path==='/publication'){send(response,200,await desk.publication(id));return;}
    if(path==='/receiving'){send(response,200,await desk.receiving(id));return;}
    if(path==='/download'){
      const d=await desk.download(id,url.searchParams.get('kind'),url.searchParams.get('format'));
      const raw=await checkFile(d.path,d,512*1024*1024);
      send(response,200,raw,d.mime,{'content-disposition':'attachment; filename="'+d.name.replace(/[^A-Za-z0-9._-]/g,'_')+'"',
        'content-security-policy':"default-src 'none'; sandbox",'x-content-sha256':d.sha256});return;
    }
    need(false,'ROUTE_UNKNOWN','Select an original report desk page.',404);
  }
  const server=createServer((req,res)=>{
    const p=route(req,res).catch(e=>{if(!res.headersSent)send(res,e.status??409,{error:{code:e.code??'REPORT_DESK_ERROR',message:e.message,detail:e.detail??null}});else res.destroy();});
    pending.add(p);p.finally(()=>pending.delete(p));
  });
  server.requestTimeout=120000;server.headersTimeout=10000;
  await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>{server.off('error',no);yes();});});
  origin='http://127.0.0.1:'+server.address().port;
  const url=origin+'/#access='+token,launch={schema:SCHEMA+'.server',deskId:state.desk.id,origin,url,apiBase:prefix,
    mode:nativeFactory?'CONFIGURED_NATIVE_FACILITATOR':'CHALLENGE_ONLY'};
  try{if(launchFile)await put(absolute(launchFile,'new private launch file'),launch);}catch(error){await new Promise(resolve=>server.close(resolve));throw error;}
  const onSignal=()=>{void close().catch(()=>{process.exitCode=1;});};
  function close(){
    if(closePromise)return closePromise;
    closing=true;
    closePromise=(async()=>{
      const errors=[];const stopped=new Promise(resolve=>server.close(resolve));server.closeIdleConnections();
      await Promise.allSettled([...starting.values()]);
      for(const service of services.values())try{await service.close();}catch(e){errors.push(e);}
      await Promise.allSettled([...pending]);server.closeIdleConnections();await stopped;
      for(const sig of ['SIGINT','SIGTERM'])process.off(sig,onSignal);
      if(errors.length)throw new AggregateError(errors,'The original file services did not all drain.');
    })();return closePromise;
  }
  if(handleSignals)for(const sig of ['SIGINT','SIGTERM'])process.on(sig,onSignal);
  return {server,desk,url,origin,apiBase:prefix,launch,close};
}
