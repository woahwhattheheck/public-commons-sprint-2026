// SPDX-License-Identifier: MIT
// Fixed local browser routes over the already-owned publisher/customer model.
import {constants} from 'node:fs';
import {readFile,open} from 'node:fs/promises';
import {basename} from 'node:path';
import {createHash} from 'node:crypto';
import {startPostgresPublisherServer} from '../postgres/publisher/server.mjs';
import {fault} from '../postgres/publisher/files.mjs';
const PREFIX='/api/local-customer',MAX_BODY=8*1024*1024;
const need=(value,code,status=400)=>{if(!value)throw fault(code,code,status);};
async function body(req){
 need(/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''),'LOCAL_JSON_REQUIRED',415);
 const parts=[];let size=0;for await(const part of req){size+=part.length;need(size<=MAX_BODY,'LOCAL_REQUEST_TOO_LARGE',413);parts.push(part);}
 try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));need(value&&typeof value==='object'&&!Array.isArray(value),'LOCAL_JSON_OBJECT_REQUIRED');return value;}
 catch(e){if(e.code)throw e;throw fault('LOCAL_JSON_INVALID');}
}
function argumentsOf(url){try{const value=JSON.parse(url.searchParams.get('arguments')??'{}');need(value&&typeof value==='object'&&!Array.isArray(value),'LOCAL_ARGUMENTS_INVALID');return value;}catch(e){if(e.code)throw e;throw fault('LOCAL_ARGUMENTS_INVALID');}}
function headers(res,file){
 const name=basename(file.name).replace(/[^A-Za-z0-9._-]/g,'_');
 const type=name.endsWith('.zip')?'application/zip':name.endsWith('.json')?'application/json; charset=utf-8':name.endsWith('.tgz')?'application/gzip':'application/octet-stream';
 res.writeHead(200,{'content-type':type,'content-length':file.bytes,'content-disposition':'attachment; filename="'+name+'"',
  'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','etag':'"sha256-'+file.sha256+'"',
  'content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
}
async function write(res,chunk){
 if(res.destroyed)throw fault('LOCAL_DOWNLOAD_CLOSED');
 if(res.write(chunk))return;
 await new Promise((resolve,reject)=>{
  const done=()=>{clean();resolve();},closed=()=>{clean();reject(fault('LOCAL_DOWNLOAD_CLOSED'));},clean=()=>{res.off('drain',done);res.off('close',closed);res.off('error',closed);};
  res.once('drain',done);res.once('close',closed);res.once('error',closed);
 });
}
async function localFile(res,file){
 const fd=await open(file.path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await fd.stat();need(before.isFile()&&before.nlink===1&&!(before.mode&0o077)&&before.size===file.bytes,'LOCAL_FILE_CHANGED',409);
  headers(res,file);let offset=0;const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);
  for(;;){const {bytesRead}=await fd.read(buffer,0,buffer.length,offset);if(!bytesRead)break;const chunk=buffer.subarray(0,bytesRead);hash.update(chunk);offset+=bytesRead;need(offset<=file.bytes,'LOCAL_FILE_CHANGED',409);await write(res,chunk);}
  const after=await fd.stat();need(offset===file.bytes&&hash.digest('hex')===file.sha256&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'LOCAL_FILE_CHANGED',409);res.end();
 }catch(e){if(res.headersSent)res.destroy(e);throw e;}finally{await fd.close();}
}
async function customerFile(workspace,req,res,url){
 const id=url.searchParams.get('deliveryId'),exportId=url.searchParams.get('exportId'),filename=url.searchParams.get('filename'),sha256=url.searchParams.get('sha256');
 const controller=new AbortController(),closed=()=>{if(!res.writableEnded)controller.abort();};res.once('close',closed);
 try{
  const first=await workspace.customerRead(id,'file',{export_id:exportId,filename,sha256,byteOffset:0,maxBytes:65536},controller.signal);
  let current=first.file,offset=0;const hash=createHash('sha256');
  need(current.verifiedSavedFile===true&&current.sha256===sha256,'LOCAL_CUSTOMER_FILE_CHANGED',409);
  headers(res,{name:filename,bytes:current.bytes,sha256});const size=current.bytes;
  for(;;){
   const chunk=Buffer.from(current.data,'base64');
   need(current.verifiedSavedFile===true&&current.encoding==='base64'&&current.sha256===sha256&&current.bytes===size&&current.byteOffset===offset&&current.returnedBytes===chunk.length&&chunk.length<=65536&&offset+chunk.length<=size,'LOCAL_CUSTOMER_RANGE_CHANGED',409);
   if(chunk.length){hash.update(chunk);await write(res,chunk);offset+=chunk.length;}
   if(offset===size){need(current.nextByteOffset===null&&hash.digest('hex')===sha256,'LOCAL_CUSTOMER_FILE_CHANGED',409);break;}
   need(chunk.length>0&&current.nextByteOffset===offset,'LOCAL_CUSTOMER_RANGE_CHANGED',409);
   current=(await workspace.customerRead(id,'file',{export_id:exportId,filename,sha256,byteOffset:offset,maxBytes:65536},controller.signal)).file;
  }
  res.end();
 }catch(e){if(res.headersSent)res.destroy(e);throw e;}finally{res.off('close',closed);}
}
/** A borrowed browser closes only this listener and its in-flight downloads. */
export async function startLocalDatasetReceivingServer({workspace,port=8448,schedule=null,ownsWorkspace=true}={}){
 need(workspace&&typeof workspace.start==='function'&&workspace.publisher,'LOCAL_WORKSPACE_REQUIRED');
 need(typeof ownsWorkspace==='boolean'&&(ownsWorkspace?!schedule:!!schedule),'LOCAL_BROWSER_OWNER_REQUIRED');
 const assets=await Promise.all([['/local-customer/app.mjs','app.mjs','text/javascript; charset=utf-8'],['/local-customer/style.css','style.css','text/css; charset=utf-8']]
  .map(async([path,file,type])=>({path,type,bytes:await readFile(new URL('./public/'+file,import.meta.url))})));
 const extension={assets,head:'<link rel="stylesheet" href="/local-customer/style.css"><script type="module" src="/local-customer/app.mjs"></script>',
  close:ownsWorkspace?()=>workspace.close():undefined,
  async handle({req,res,url,send}){
   if(!url.pathname.startsWith(PREFIX+'/'))return false;
   const route=url.pathname.slice(PREFIX.length),q=url.searchParams;
   if(req.method==='GET'){
    if(route==='/status')send(200,await workspace.status({offset:q.has('offset')?Number(q.get('offset')):0,limit:q.has('limit')?Number(q.get('limit')):25}));
    else if(route==='/record')send(200,await workspace.record(q.get('id')));
    else if(route==='/request')send(200,await workspace.operation(q.get('id')));
    else if(route==='/customer')send(200,{result:await workspace.customerRead(q.get('deliveryId'),q.get('operation'),argumentsOf(url))});
    else if(route==='/customer-browser')send(200,await workspace.customerBrowser());
    else if(route==='/file')await localFile(res,await workspace.file(q.get('deliveryId'),q.get('id')));
    else if(route==='/package-file')await localFile(res,await workspace.packageFile(q.get('requestId'),q.get('name')));
    else if(route==='/customer-file')await customerFile(workspace,req,res,url);
    else throw fault('LOCAL_ROUTE_NOT_FOUND','The requested local customer route does not exist.',404);
    return true;
   }
   need(req.method==='POST','LOCAL_ROUTE_NOT_FOUND',404);
   const input=await body(req);need(req.headers['x-local-dataset-workspace']===workspace.workspaceId&&input.workspaceId===workspace.workspaceId,'LOCAL_WORKSPACE_ID_CHANGED',409);
   let result;
   if(['/prepare','/continue','/customer','/package'].includes(route))result=await workspace.start(route.slice(1),input);
   else if(route==='/resume')result=await workspace.resume(input);
   else if(route==='/cancel')result=await workspace.cancel(input);
   else throw fault('LOCAL_ROUTE_NOT_FOUND','The requested local customer action does not exist.',404);
   send(result.operation?.state==='RUNNING'?202:200,result);return true;
  }};
 return startPostgresPublisherServer({publisher:workspace.publisher,port,extension,schedule,ownsPublisher:ownsWorkspace});
}
