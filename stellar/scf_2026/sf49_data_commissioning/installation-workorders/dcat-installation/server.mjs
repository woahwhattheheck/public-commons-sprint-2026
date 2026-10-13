// SPDX-License-Identifier: MIT
/** Private loopback desk for the original retained Installation preparation service. */
import {createServer} from 'node:http';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {open,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createDcatInstallationService} from './service.mjs';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const need=(ok,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{code:'DCAT_INSTALLATION_HTTP',status});};
const bytes=async(req,maximum=8*1024*1024)=>{const rows=[];let size=0;for await(const row of req){size+=row.length;need(size<=maximum,'The complete request exceeds this control-input capacity.',413);rows.push(row);}return Buffer.concat(rows);};
const json=async req=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(req)));
const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/app.mjs',['app.mjs','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
const sameToken=(supplied,expected)=>{const a=Buffer.from(supplied??''),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);};
export async function createDcatInstallationServer({directory,host='127.0.0.1',port=0,token=randomBytes(32).toString('hex'),instanceId=randomUUID()}={}){
 need(host==='127.0.0.1'||host==='::1','Use the selected private loopback listener.');
 need(Number.isInteger(port)&&port>=0&&port<=65535,'Select a valid local port.');
 need(typeof token==='string'&&token.length>=32&&token.length<=256&&/^[A-Za-z0-9_-]+$/.test(token),'Use an original private listener credential.');
 need(UUID.test(instanceId),'Retain the original listener instance UUID.');
 const service=await createDcatInstallationService({directory}),pending=new Set();let origin=null,closing=false;
 const reply=(res,status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value));};
 async function attachment(res,path,name,mediaType='application/octet-stream',expected){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const before=await file.stat();need(before.isFile()&&before.nlink===1&&before.size===expected.bytes,'The complete retained file changed before download.',409);
   res.setHeader('Content-Type',mediaType);
   res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name));
   // Finish the chunked response only after hashing this same open descriptor.
   // A changed or interrupted source never becomes a complete browser download.
   const digest=createHash('sha256');let count=0;
   for await(const chunk of file.createReadStream({autoClose:false})){
    need(!res.destroyed,'The complete file download was interrupted.',409);
    count+=chunk.length;need(count<=expected.bytes,'The original retained file grew during download.',409);digest.update(chunk);
    if(!res.write(chunk))await new Promise((resolve,reject)=>{
     const clean=()=>{res.off('drain',drained);res.off('close',closed);res.off('error',failed);};
     const drained=()=>{clean();resolve();},closed=()=>{clean();reject(new Error('The complete file download was interrupted.'));},failed=error=>{clean();reject(error);};
     res.once('drain',drained);res.once('close',closed);res.once('error',failed);
     if(res.destroyed)closed();
    });
   }
   const after=await file.stat();
   need(count===expected.bytes&&digest.digest('hex')===expected.sha256&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'The original complete file changed during download.',409);
   res.end();
  }finally{await file.close();}
 }
 async function route(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  need(!closing,'This preparation listener is stopping.',503);
  need(origin&&req.headers.host===new URL(origin).host,'The listener host differs.',403);
  if(req.headers.origin)need(req.headers.origin===origin,'Use the original local desk origin.',403);
  const url=new URL(req.url,origin);
  if(req.method==='GET'&&assets.has(url.pathname)){
   const [name,type]=assets.get(url.pathname);res.setHeader('Content-Type',type);res.end(await readFile(new URL('./public/'+name,import.meta.url)));return;
  }
  need(url.pathname.startsWith('/api/'),'Unknown preparation route.',404);
  need(sameToken(req.headers.authorization?.replace(/^Bearer /,''),token),'Open the original private desk link to authenticate.',401);
  if(req.method==='GET'&&url.pathname==='/api/launch')return reply(res,200,{schema:'stellar-forge.dcat-installation-listener.v1',instanceId,pid:process.pid,directory:service.directory});
  if(req.method==='GET'&&url.pathname==='/api/requests')return reply(res,200,await service.list({offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??100)}));
  const item=/^\/api\/requests\/([a-f0-9-]{36})$/.exec(url.pathname);
  if(req.method==='GET'&&item)return reply(res,200,await service.get(item[1]));
  const download=/^\/api\/files\/([a-f0-9]{64})$/.exec(url.pathname);
  if(req.method==='GET'&&download){
   const file=await service.file(download[1]);return attachment(res,file.path,file.descriptor.name,'application/octet-stream',file.descriptor);
  }
  const member=/^\/api\/sources\/([a-f0-9-]{36})\/file$/.exec(url.pathname);
  if(req.method==='GET'&&member){
   const selected=await service.sourceFile({inspectionId:member[1],path:url.searchParams.get('path')});
   return attachment(res,selected.path,url.searchParams.get('path').split('/').at(-1),selected.mediaType??'application/octet-stream',selected);
  }
  if(req.method==='PUT'&&url.pathname==='/api/import'){
   const result=await service.importStream({requestId:url.searchParams.get('requestId'),kind:url.searchParams.get('kind'),name:url.searchParams.get('name'),bytes:Number(url.searchParams.get('bytes')),sha256:url.searchParams.get('sha256'),stream:req});
   return reply(res,200,result);
  }
  if(req.method==='POST'&&['/api/inspect','/api/template','/api/prepare'].includes(url.pathname)){
   need(req.headers['content-type']?.split(';')[0]==='application/json','Send the complete JSON control input.',415);
   const input=await json(req),action=url.pathname.slice(5);
   return reply(res,200,await service[action](input));
  }
  need(false,'Unknown preparation route.',404);
 }
 const server=createServer((req,res)=>{
  const task=route(req,res).catch(error=>{
   if(res.headersSent){res.destroy();return;}
   const status=error.status??(error.code==='ENOENT'?404:400);
   reply(res,status,{code:error.code??'DCAT_INSTALLATION_INPUT',message:String(error.message)});
  }).finally(()=>pending.delete(task));pending.add(task);
 });
 server.requestTimeout=300000;server.headersTimeout=30000;
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});
 }catch(error){await service.close();throw error;}
 const address=server.address();origin='http://'+(host==='::1'?'[::1]':host)+':'+address.port;
 const url=origin+'/#token='+encodeURIComponent(token);
 let stopped;
 return{server,service,url,origin,instanceId,pid:process.pid,directory:service.directory,
  close(){return stopped??=(async()=>{
   closing=true;
   const drained=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
   server.closeIdleConnections();await Promise.allSettled([...pending]);await drained;await service.close();
  })();}};
}
