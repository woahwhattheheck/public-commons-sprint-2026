// SPDX-License-Identifier: MIT
// Fixed source routes within the original publisher's origin-checked browser.
import {constants} from 'node:fs';
import {readFile,open} from 'node:fs/promises';
import {basename} from 'node:path';
import {createHash} from 'node:crypto';
import {startPostgresPublisherServer} from '../../postgres/publisher/server.mjs';
import {fault} from '../../postgres/publisher/files.mjs';
import {MAX_JSON,need,count} from './contracts.mjs';
const PREFIX='/api/frictionless-source';
async function body(req){
 need(/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''),'FRICTIONLESS_JSON_REQUIRED',undefined,415);
 const parts=[];let size=0;for await(const part of req){size+=part.length;need(size<=MAX_JSON,'FRICTIONLESS_REQUEST_TOO_LARGE',undefined,413);parts.push(part);}
 try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
  need(value&&typeof value==='object'&&!Array.isArray(value),'FRICTIONLESS_JSON_OBJECT_REQUIRED');return value;}
 catch(e){if(e.code)throw e;throw fault('FRICTIONLESS_JSON_INVALID');}
}
function headers(res,file){
 const name=basename(file.name).replace(/[^A-Za-z0-9._-]/g,'_');
 const type=name.endsWith('.zip')?'application/zip':name.endsWith('.json')?'application/json; charset=utf-8':(name.endsWith('.tgz')||name.endsWith('.tar.gz'))?'application/gzip':'application/octet-stream';
 res.writeHead(200,{'content-type':type,'content-length':file.bytes,'content-disposition':'attachment; filename="'+name+'"',
  'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','etag':'"sha256-'+file.sha256+'"',
  'content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
}
async function write(res,chunk){
 if(res.destroyed)throw fault('FRICTIONLESS_DOWNLOAD_CLOSED');
 if(res.write(chunk))return;
 await new Promise((resolve,reject)=>{
  const done=()=>{clean();resolve();},closed=()=>{clean();reject(fault('FRICTIONLESS_DOWNLOAD_CLOSED'));},clean=()=>{res.off('drain',done);res.off('close',closed);res.off('error',closed);};
  res.once('drain',done);res.once('close',closed);res.once('error',closed);
 });
}
async function retainedFile(res,file){
 const fd=await open(file.path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await fd.stat();need(before.isFile()&&before.nlink===1&&!(before.mode&0o077)&&before.size===file.bytes,'FRICTIONLESS_FILE_CHANGED',undefined,409);
  headers(res,file);let offset=0;const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);
  for(;;){const {bytesRead}=await fd.read(buffer,0,buffer.length,offset);if(!bytesRead)break;const chunk=buffer.subarray(0,bytesRead);hash.update(chunk);offset+=bytesRead;need(offset<=file.bytes,'FRICTIONLESS_FILE_CHANGED',undefined,409);await write(res,chunk);}
  const after=await fd.stat();need(offset===file.bytes&&hash.digest('hex')===file.sha256&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'FRICTIONLESS_FILE_CHANGED',undefined,409);res.end();
 }catch(e){if(res.headersSent)res.destroy(e);throw e;}finally{await fd.close();}
}

const numeric=(q,key,defaultValue)=>count(q.has(key)?Number(q.get(key)):defaultValue);
export async function startFrictionlessSourceServer({workspace,port=8488,schedule=null,ownsWorkspace=true}={}){
 need(workspace&&typeof workspace.start==='function'&&workspace.publisher,'FRICTIONLESS_WORKSPACE_REQUIRED');
 need(typeof ownsWorkspace==='boolean'&&(ownsWorkspace?!schedule:!!schedule),'FRICTIONLESS_BROWSER_OWNER_REQUIRED');
 const assets=await Promise.all([['/frictionless-source/app.mjs','app.mjs','text/javascript; charset=utf-8'],
  ['/frictionless-source/style.css','style.css','text/css; charset=utf-8']].map(async([path,file,type])=>({path,type,bytes:await readFile(new URL('./public/'+file,import.meta.url))})));
 const extension={assets,head:'<link rel="stylesheet" href="/frictionless-source/style.css"><script type="module" src="/frictionless-source/app.mjs"></script>',
  close:ownsWorkspace?()=>workspace.close():undefined,
  async handle({req,res,url,send}){
   if(!url.pathname.startsWith(PREFIX+'/'))return false;
   const route=url.pathname.slice(PREFIX.length),q=url.searchParams;
   if(req.method==='GET'){
    if(route==='/status')send(200,await workspace.status({limit:numeric(q,'limit',25),capturesOffset:numeric(q,'capturesOffset',0),editionsOffset:numeric(q,'editionsOffset',0),operationsOffset:numeric(q,'operationsOffset',0)}));
    else if(route==='/current')send(200,await workspace.current());
    else if(route==='/input')send(200,await workspace.input(q.get('input')));
    else if(route==='/capture')send(200,await workspace.capture(q.get('id'),{section:q.get('section')??'overview',resource:q.get('resource'),offset:numeric(q,'offset',0),limit:numeric(q,'limit',25)}));
    else if(route==='/edition')send(200,await workspace.edition(q.get('id')));
    else if(route==='/review')send(200,await workspace.review(q.get('id')));
    else if(route==='/plan-input')send(200,await workspace.planInput(q.get('editionId'),q.get('query')));
    else if(route==='/comparison')send(200,await workspace.comparison(q.get('id')));
    else if(route==='/request')send(200,await workspace.operation(q.get('id')));
    else if(route==='/file')await retainedFile(res,await workspace.file(q.get('kind'),q.get('id'),q.get('name')));
    else throw fault('FRICTIONLESS_ROUTE_NOT_FOUND','Choose an original source route.',404);
    return true;
   }
   need(req.method==='POST','FRICTIONLESS_ROUTE_NOT_FOUND',undefined,404);
   const input=await body(req);
   need(req.headers['x-frictionless-source-workspace']===workspace.workspaceId&&input.workspaceId===workspace.workspaceId,
    'FRICTIONLESS_WORKSPACE_CHANGED','Use the original workbench identity.',409);
   let result;
   if(['/intake','/edition','/review','/select','/plan','/compare','/export'].includes(route))result=await workspace.start(route.slice(1),input);
   else if(route==='/resume')result=await workspace.resume(input);
   else if(route==='/cancel')result=await workspace.cancel(input);
   else throw fault('FRICTIONLESS_ROUTE_NOT_FOUND','Choose an original source action.',404);
   send(result.operation?.state==='RUNNING'?202:200,result);return true;
  }};
 return startPostgresPublisherServer({publisher:workspace.publisher,port,extension,schedule,ownsPublisher:ownsWorkspace});
}
