// MIT. Neutral standalone host sharing exactly the same BIM request handlers as Next.
import http from 'node:http';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openWorkspace,MAX_PACKET} from './lib/workspace.mjs';
import {createRouteHandler} from './lib/routes.mjs';
import {need,bytes} from './lib/value.mjs';
import {confined,fileDescriptor} from './lib/files.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const defaults={'/settlement-operator.mjs':['web/settlement-operator.mjs','text/javascript; charset=utf-8'],'/settlement-controller.mjs':['web/settlement-controller.mjs','text/javascript; charset=utf-8'],'/':['web/index.html','text/html; charset=utf-8'],'/app.mjs':['web/app.mjs','text/javascript; charset=utf-8'],'/journal.mjs':['web/journal.mjs','text/javascript; charset=utf-8'],'/sha256.mjs':['web/sha256.mjs','text/javascript; charset=utf-8'],'/styles.css':['web/styles.css','text/css; charset=utf-8'],'/working.mjs':['web/working.mjs','text/javascript; charset=utf-8'],'/wallet-entry.bundle.mjs':['web/wallet-entry.bundle.mjs','text/javascript; charset=utf-8'],'/exchange-domain.mjs':['lib/exchange-domain.mjs','text/javascript; charset=utf-8'],'/wallet-entry.bundle.css':['web/wallet-entry.bundle.css','text/css; charset=utf-8']};
export async function startServer({directory,token,adapters,fetch,credentialResolver,host='127.0.0.1',port=0,sourceDirectory=HERE,staticFiles=defaults,browserPolicy=null,settlementReaders=null}){
 need(['127.0.0.1','::1','localhost'].includes(host),'LOCAL_OPERATOR_HOST_REQUIRED');need(typeof token==='string'&&token.length>=24,'OPERATOR_TOKEN_REQUIRED');
 const workspace=await openWorkspace({directory,sourceDirectory,adapters,fetch,credentialResolver}),handler=createRouteHandler({workspace,token,settlementReaders});let server,closing=false,closedPromise;
 try{
  server=http.createServer(async(req,res)=>{try{
   const authority=req.headers.host??'localhost',u=new URL(req.url,'http://'+authority);
   if(u.pathname.startsWith('/api/')){
    let body;if(req.method!=='GET'&&req.method!=='HEAD'){const chunks=[];let n=0;for await(const chunk of req){n+=chunk.length;need(n<=MAX_PACKET+64*1024*1024,'COMMAND_TOO_LARGE');chunks.push(chunk);}body=Buffer.concat(chunks);}
    const result=await handler(new Request(u,{method:req.method,headers:req.headers,body}));res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return;
   }
   need(req.method==='GET'&&!u.search&&Object.hasOwn(staticFiles,u.pathname),'ROUTE_NOT_FOUND');const [relative,type]=staticFiles[u.pathname],file=await confined(sourceDirectory,relative);await fileDescriptor(file);
   const data=await fs.readFile(file),headers={'Content-Type':type,'Content-Length':data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
   if(browserPolicy)headers['Content-Security-Policy']=browserPolicy;res.writeHead(200,headers);res.end(data);
  }catch(error){if(!res.headersSent){const data=bytes({error:{code:error.code??'OPERATION_FAILED',message:error.code??'Operation failed'}});res.writeHead(error.code==='ROUTE_NOT_FOUND'?404:422,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':data.length});res.end(data);}else res.destroy(error);}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});const address=server.address();
  return{workspace,address,url:'http://'+(address.family==='IPv6'?'['+address.address+']':address.address)+':'+address.port,async close(){if(closing)return closedPromise;closing=true;const listener=new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));closedPromise=(async()=>{try{await workspace.close();}finally{server.closeAllConnections();await listener;}})();try{await closedPromise;}catch(e){closing=false;throw e;}}};
 }catch(error){if(server?.listening)await new Promise(resolve=>server.close(resolve));await workspace.close();throw error;}
}
