#!/usr/bin/env node
// MIT. Local customer statement API; embeddable in the original accounting runtime.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {openAccountingWorkspace} from '../workspace/store.mjs';
import {CustomerStatementWorkspace,STATEMENT_REQUEST_BYTES} from './store.mjs';
import {need} from './core.mjs';

const PUBLIC=fileURLToPath(new URL('./public/',import.meta.url));
const ASSETS={
  '/customer-statements':['index.html','text/html; charset=utf-8'],
  '/customer-statements/':['index.html','text/html; charset=utf-8'],
  '/customer-statements/index.html':['index.html','text/html; charset=utf-8'],
  '/customer-statements/app.mjs':['app.mjs','text/javascript; charset=utf-8'],
  '/customer-statements/style.css':['style.css','text/css; charset=utf-8']
};
export async function customerStatementAsset(path){
  if(!Object.hasOwn(ASSETS,path))return null;
  const [name,type]=ASSETS[path];return {bytes:await readFile(join(PUBLIC,name)),type};
}
export async function handleCustomerStatementRequest(statements,{method,path,query={},value}){
  const parts=path.split('/').filter(Boolean);
  if(parts[0]!=='api'||parts[1]!=='customer-statements')return null;
  if(parts.length===2&&method==='GET')return {value:await statements.state()};
  if(parts.length===3){
    const action=parts[2];
    if(method==='GET'&&action==='bindings')return {value:await statements.listBindings(query)};
    if(method==='GET'&&action==='statements')return {value:await statements.listStatements(query)};
    if(method==='POST'){
      need(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_STATEMENT_REQUEST','Send a JSON statement request.');
      if(action==='customers')return {value:await statements.saveCustomer(value)};
      if(action==='bindings')return {value:await statements.assign(value)};
      if(action==='usage')return {value:await statements.importUsage(value)};
      if(action==='preview')return {value:await statements.preview(value)};
      if(action==='retain')return {value:await statements.retain(value)};
    }
  }
  if(parts[2]==='statements'&&parts[3]){
    if(parts.length===4&&method==='GET')return {value:await statements.detail(parts[3])};
    if(parts.length===6&&parts[4]==='download'&&method==='GET'){
      const file=await statements.file(parts[3],parts[5]);return {file,type:file.type};
    }
    if(parts.length===5&&parts[4]==='withdraw'&&method==='POST'){
      need(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_STATEMENT_REQUEST','Send a JSON withdrawal request.');
      return {value:await statements.withdraw(parts[3],value)};
    }
  }
  need(false,'STATEMENT_ROUTE_NOT_FOUND','This customer statement operation was not found.',404);
}
async function body(request){
  need(request.headers['content-type']?.split(';')[0].trim()==='application/json','JSON_REQUIRED','Send a JSON operator request.');
  let length=0;const parts=[];
  for await(const part of request){length+=part.length;need(length<=STATEMENT_REQUEST_BYTES,'BODY_TOO_LARGE','The statement request exceeds the supported size.',413);parts.push(part);}
  let value;try{value=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{need(false,'INVALID_JSON','The statement request is not valid JSON.');}
  need(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_STATEMENT_REQUEST','Send a JSON object.');return value;
}
export async function startCustomerStatementWorkspace({host='127.0.0.1',port=8447,workspace:providedWorkspace,...options}){
  need(['127.0.0.1','localhost'].includes(host),'LOOPBACK_REQUIRED','This customer operator workspace binds to loopback.');
  need(Number.isInteger(port)&&port>=0&&port<=65535,'INVALID_PORT','Choose a valid local port.');
  const workspace=providedWorkspace??await openAccountingWorkspace(options),ownsWorkspace=!providedWorkspace;
  const statements=new CustomerStatementWorkspace(workspace);
  try{await statements.init();}catch(error){if(ownsWorkspace)await workspace.close();throw error;}
  const hosts=new Set();
  const send=(response,status,value,{type='application/json; charset=utf-8',name}={})=>{
    if(response.destroyed)return;
    const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
    response.writeHead(status,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      ...(name?{'Content-Disposition':'attachment; filename="'+name+'"'}:{})});response.end(bytes);
  };
  const server=createServer(async(request,response)=>{
    try{
      need(hosts.has(request.headers.host),'INVALID_HOST','Open the printed local customer statement address.',403);
      const url=new URL(request.url,'http://'+request.headers.host),path=url.pathname;
      const asset=request.method==='GET'?await customerStatementAsset(path==='/'?'/customer-statements/':path):null;
      if(asset){send(response,200,asset.bytes,{type:asset.type});return;}
      let value;
      if(request.method==='POST'){
        need(request.headers['x-workspace-request']==='1','WORKSPACE_REQUEST_REQUIRED','Use the local operator form.',403);
        need(!request.headers.origin||request.headers.origin==='http://'+request.headers.host,'INVALID_ORIGIN','Use this local workspace address.',403);
        value=await body(request);
      }
      const result=await handleCustomerStatementRequest(statements,{method:request.method,path,query:Object.fromEntries(url.searchParams),value});
      need(result,'NOT_FOUND','This customer statement route was not found.',404);
      if(result.file)send(response,200,result.file.bytes,{type:result.type??result.file.type,name:result.file.name});
      else send(response,200,result.value);
    }catch(error){
      send(response,error.status??500,{error:{code:error.code??'CUSTOMER_STATEMENT_ERROR',message:error.message??'The customer statement operation failed.'}});
    }
  });
  server.requestTimeout=60000;server.headersTimeout=15000;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});});
  }catch(error){if(ownsWorkspace)await workspace.close();throw error;}
  const actualPort=server.address().port;
  hosts.add('127.0.0.1:'+actualPort);hosts.add('localhost:'+actualPort);
  let closing;
  const close=()=>closing??=(async()=>{
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    if(ownsWorkspace)await workspace.close();
  })();
  return {server,workspace,statements,url:'http://'+host+':'+actualPort+'/customer-statements/',close};
}
