// MIT. Authenticated local Principal operator HTTP adapter.
import http from 'node:http';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openWorkspace,MAX_PACKET} from './lib/workspace.mjs';
import {need,bytes,secretEqual,jsonInput} from './lib/value.mjs';
import {confined,fileDescriptor} from './lib/files.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const staticFiles=new Map([['/',['web/index.html','text/html; charset=utf-8']],['/index.html',['web/index.html','text/html; charset=utf-8']],['/app.mjs',['web/app.mjs','text/javascript; charset=utf-8']],['/journal.mjs',['web/journal.mjs','text/javascript; charset=utf-8']],['/market.mjs',['web/market.mjs','text/javascript; charset=utf-8']],['/sha256.mjs',['web/sha256.mjs','text/javascript; charset=utf-8']],['/styles.css',['web/styles.css','text/css; charset=utf-8']]]);
const statusFor=error=>error.code==='UNAUTHORIZED'?401:error.code==='FORBIDDEN_ORIGIN'?403:['FILE_NOT_FOUND','REQUEST_NOT_FOUND','ROUTE_NOT_FOUND'].includes(error.code)?404:/CONFLICT|UNRESOLVED|BUSY|OWNER_REQUIRED|INCOMPLETE|FAILED_REQUEST/.test(error.code??'')?409:422;
function headerName(value){return String(value).replace(/[\r\n"\\]/g,'_');}
async function body(request){const max=MAX_PACKET+64*1024*1024,chunks=[];let length=0;for await(const b of request){length+=b.length;need(length<=max,'COMMAND_TOO_LARGE');chunks.push(b);}return jsonInput(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
export async function startServer({directory,token,host='127.0.0.1',port=0,sourceDirectory=HERE}){
 need(['127.0.0.1','::1','localhost'].includes(host),'LOCAL_OPERATOR_HOST_REQUIRED');
 need(typeof token==='string'&&token.length>=24,'OPERATOR_TOKEN_REQUIRED');
 const workspace=await openWorkspace({directory,sourceDirectory});let closing=false,server,closedPromise;
 try{
 server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');need(!url.search,'ROUTE_QUERY_NOT_SUPPORTED');
   const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
   const send=(status,data,type='application/json; charset=utf-8',extra={})=>{const b=Buffer.isBuffer(data)?data:bytes(data);res.writeHead(status,{...headers,'Content-Type':type,'Content-Length':b.length,...extra});res.end(b);};
   if(url.pathname.startsWith('/api/')){
    need(secretEqual(req.headers.authorization??'','Bearer '+token),'UNAUTHORIZED');
    if(req.headers.origin)need(req.headers.origin==='http://'+req.headers.host,'FORBIDDEN_ORIGIN');
    if(req.method==='POST')need(req.headers['x-principal-workspace-id']===workspace.read().workspace.id,'WORKSPACE_ID_CONFLICT');
    if(req.method==='GET'&&url.pathname==='/api/bootstrap')return send(200,workspace.bootstrap());
    if(req.method==='GET'&&url.pathname==='/api/state')return send(200,workspace.state());
    if(req.method==='GET'&&url.pathname.startsWith('/api/request/')){
     const row=workspace.request(decodeURIComponent(url.pathname.slice(13)));
     if(row.status==='COMPLETE')return send(200,row.response);
     return send(409,{error:{code:'ORIGINAL_REQUEST_'+row.status,message:'Inspect the retained original request; this lookup does not dispatch it.',details:{request:row}}});
    }
    if(req.method==='GET'&&url.pathname==='/api/export')return send(200,await workspace.portable(),'application/json; charset=utf-8',{'Content-Disposition':'attachment; filename="principal-workspace.json"'});
    if(req.method==='GET'&&url.pathname.startsWith('/api/files/')){const {descriptor,data}=workspace.object(decodeURIComponent(url.pathname.slice(11)));return send(200,data,'application/octet-stream',{'Content-Disposition':'attachment; filename="'+headerName(descriptor.name)+'"','X-Content-SHA256':descriptor.sha256});}
    if(req.method==='POST'&&url.pathname==='/api/command'){need((req.headers['content-type']??'').split(';')[0]==='application/json','JSON_CONTENT_TYPE_REQUIRED');return send(200,await workspace.command(await body(req)));}
    throw Object.assign(new Error('ROUTE_NOT_FOUND'),{code:'ROUTE_NOT_FOUND'});
   }
   need(req.method==='GET'&&staticFiles.has(url.pathname),'ROUTE_NOT_FOUND');
   const [relative,type]=staticFiles.get(url.pathname),file=await confined(sourceDirectory,relative);await fileDescriptor(file);
   return send(200,await fs.readFile(file),type,{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
  }catch(error){if(!res.headersSent){const data=bytes({error:{code:error.code??'OPERATION_FAILED',message:String(error.message??error),details:error.details??{}}});res.writeHead(statusFor(error),{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':data.length});res.end(data);}else res.destroy(error);}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 const address=server.address();
 return{workspace,address,url:'http://'+(address.family==='IPv6'?'['+address.address+']':address.address)+':'+address.port,
  async close(){if(closing)return;closing=true;closedPromise??=new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));server.closeAllConnections();try{await workspace.close();await closedPromise;}catch(error){closing=false;throw error;}}};
 }catch(error){if(server?.listening)await new Promise(resolve=>server.close(resolve));await workspace.close();throw error;}
}
