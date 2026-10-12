// MIT. Authenticated local operator surface for the retained Grants.gov workspace.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openGrantsWorkspace } from './workspace.mjs';

const STATIC = Object.freeze({
  '/':['index.html','text/html; charset=utf-8'],
  '/app.mjs':['app.mjs','text/javascript; charset=utf-8'],
  '/app.css':['app.css','text/css; charset=utf-8']
});
const own = Object.prototype.hasOwnProperty;
const error = (code,message,status=400) => Object.assign(new Error(message),{code,status});
const object = value => value!==null && typeof value==='object' && !Array.isArray(value);
const iso = () => new Date().toISOString();
const jsonBytes = value => Buffer.from(JSON.stringify(value)+'\n');

export async function grantsAction(workspace,action,input={}) {
  if(!object(input))throw error('ACTION_INPUT_REQUIRED','Send an action input object.');
  switch(action) {
    case 'workspace.status':return workspace.snapshot();
    case 'query.save':return workspace.querySave(input);
    case 'capture.start':return workspace.startCapture(input);
    case 'capture.status':return workspace.captureStatus(input.captureId);
    case 'capture.pause':return workspace.pauseCapture(input.captureId);
    case 'capture.wait':return workspace.waitCapture(input.captureId);
    case 'capture.import':return workspace.importOriginal(input);
    case 'edition.create':return workspace.createEdition(input);
    case 'edition.receive':return workspace.receiveEdition(input);
    case 'edition.read':return workspace.edition(input.editionId);
    case 'opportunity.list':return workspace.rows(input.editionId,input);
    case 'opportunity.read':return workspace.opportunity(input.editionId,input.opportunityId);
    case 'review.save':return workspace.reviewSave(input);
    case 'edition.compare':return workspace.compare(input.before,input.after,input);
    case 'workshare.read':return workspace.workshare(input.editionId,input.opportunityId,input);
    case 'merchant.create':return workspace.merchant(input);
    case 'merchant.preview':return workspace.merchantPreview(input.merchantId,input.query??{});
    case 'merchant.read':return workspace.merchantFiles(input.merchantId);
    case 'export.create':return workspace.exportFile(input);
    case 'export.read':return workspace.readExport(input.id,input);
    case 'workspace.restore':return workspace.restore(input);
    case 'publisher.status':return workspace.publisherState();
    case 'publisher.export':return workspace.publisherExport(input.kind,input.id);
    default:
      if(typeof action==='string'&&action.startsWith('publisher.'))return workspace.publisherAction(action,input);
      throw error('ACTION_UNKNOWN','Choose an available Grants.gov workspace action.',404);
  }
}

async function readJSON(request,maximum) {
  if(!/^application\/json(?:;|$)/i.test(request.headers['content-type']??''))
    throw error('JSON_REQUIRED','Use an application/json request.',415);
  const claimed=request.headers['content-length'];
  if(claimed!==undefined&&(!/^\d+$/.test(claimed)||Number(claimed)>maximum))
    throw error('REQUEST_TOO_LARGE','The request exceeds this host’s configured size.',413);
  const parts=[];let length=0;
  for await(const part of request) {
    length+=part.length;
    if(length>maximum)throw error('REQUEST_TOO_LARGE','The request exceeds this host’s configured size.',413);
    parts.push(part);
  }
  try {
    const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
    if(!object(input))throw Error('object');
    return input;
  } catch {throw error('JSON_INVALID','Send one complete JSON object.');}
}

/** Binds only 127.0.0.1. A random token is delivered once in the URL fragment,
 * removed from the address bar by the page, and sent in Authorization headers.
 * All source and receiving files enter as complete packets or host CLI paths. */
export async function startGrantsServer({directory,workspace,port=0,token,
  buyerWorkspaces=[],transport,maxRequestBytes=256*1024*1024}={}) {
  if(!Number.isInteger(port)||port<0||port>65535)throw error('PORT_INVALID','Use a port from 0 to 65535.');
  if(!Number.isSafeInteger(maxRequestBytes)||maxRequestBytes<1024||maxRequestBytes>1024*1024*1024)
    throw error('REQUEST_LIMIT_INVALID','Configure a request limit from 1 KiB to 1 GiB.');
  token??=randomBytes(32).toString('base64url');
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(token))
    throw error('SESSION_TOKEN_INVALID','Configure a random local session token.');
  const expected=Buffer.from('Bearer '+token);
  const ownsWorkspace=!workspace;
  workspace??=await openGrantsWorkspace({directory,transport,buyerWorkspaces});
  const assets=new Map();
  try{for(const [path,[file,type]]of Object.entries(STATIC))
    assets.set(path,{data:await readFile(new URL(file,import.meta.url)),type});}
  catch(failure){if(ownsWorkspace)await workspace.close();throw failure;}
  let origin,closePromise,closing=false;
  const respond=(response,status,value,type='application/json; charset=utf-8',headers={})=>{
    const content=Buffer.isBuffer(value)?value:jsonBytes(value);
    response.writeHead(status,{
      'Content-Type':type,'Content-Length':String(content.length),
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
      'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      ...headers
    });response.end(content);
  };
  const authorize=request=>{
    const actual=Buffer.from(request.headers.authorization??'');
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))
      throw error('SESSION_REQUIRED','Open the current local workspace link.',401);
    if(request.headers.origin!==undefined&&request.headers.origin!==origin)
      throw error('ORIGIN_MISMATCH','Use the original local workspace page.',403);
    if(request.headers['sec-fetch-site']==='cross-site')
      throw error('ORIGIN_MISMATCH','Use the original local workspace page.',403);
  };
  const server=createServer(async(request,response)=>{
    try{
      if(closing)throw error('WORKSPACE_CLOSING','The local workspace is closing.',503);
      if(request.headers.host!==new URL(origin).host)
        throw error('HOST_MISMATCH','Use the original local workspace address.',403);
      const target=new URL(request.url,origin),method=request.method;
      if(target.origin!==origin||target.username||target.password)throw error('TARGET_INVALID','Use a local workspace path.');
      if(method==='GET'&&assets.has(target.pathname)) {
        const asset=assets.get(target.pathname);return respond(response,200,asset.data,asset.type);
      }
      authorize(request);
      if(method==='GET'&&target.pathname==='/api/state')
        return respond(response,200,{ok:true,result:await workspace.snapshot()});
      if(method==='POST'&&target.pathname==='/api/action') {
        const payload=await readJSON(request,maxRequestBytes);
        if(typeof payload.action!=='string'||Object.keys(payload).some(key=>!['action','input'].includes(key)))
          throw error('ACTION_REQUIRED','Send action and input.');
        const result=await grantsAction(workspace,payload.action,payload.input??{});
        return respond(response,200,{ok:true,result});
      }
      if(method==='GET'&&/^\/api\/exports\/[a-f0-9]{64}$/.test(target.pathname)) {
        const id=target.pathname.split('/').at(-1);
        const first=await workspace.readExport(id,{offset:0,limit:8*1024*1024}),parts=[Buffer.from(first.data,'base64')];
        let next=first.nextOffset;
        while(next!==null){const part=await workspace.readExport(id,{offset:next,limit:8*1024*1024});
          parts.push(Buffer.from(part.data,'base64'));next=part.nextOffset;}
        const data=Buffer.concat(parts);
        return respond(response,200,data,'application/octet-stream',{
          'Content-Disposition':'attachment; filename="'+first.file.name+'"',
          'X-Content-SHA256':first.file.sha256
        });
      }
      throw error('ROUTE_MISSING','This local workspace route is unavailable.',404);
    }catch(failure){
      const status=Number.isInteger(failure.status)&&failure.status>=400&&failure.status<=599?failure.status:500;
      if(!response.headersSent)respond(response,status,{ok:false,error:{code:failure.code??'WORKSPACE_ACTION_FAILED',
        message:failure.message??'The workspace action failed.',at:iso()}});
      else response.destroy();
    }
  });
  server.requestTimeout=10*60*1000;server.headersTimeout=30*1000;
  server.keepAliveTimeout=5000;server.maxHeadersCount=80;
  await new Promise((accept,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>{server.off('error',reject);accept();});
  }).catch(async failure=>{if(ownsWorkspace)await workspace.close();throw failure;});
  origin='http://127.0.0.1:'+server.address().port;
  const close=()=>closePromise??=(async()=>{
    closing=true;
    if(ownsWorkspace)await workspace.close();
    await new Promise((accept,reject)=>{server.close(failure=>failure?reject(failure):accept());server.closeIdleConnections?.();});
  })();
  return {server,workspace,origin,url:origin+'/#session='+token,token,close};
}
