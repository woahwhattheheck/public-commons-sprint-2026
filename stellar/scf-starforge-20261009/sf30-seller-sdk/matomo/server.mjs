// MIT. Private loopback operator UI; all effects use the same retained workspace.
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {identity,fault,hashPrivate} from '../postgres/publisher/files.mjs';
import {safeError,identifier} from './contract.mjs';
import {openMatomoWorkspace} from './model.mjs';
const STATIC=new Map([['/',['index.html','text/html; charset=utf-8']],['/index.html',['index.html','text/html; charset=utf-8']],['/app.mjs',['app.mjs','text/javascript; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']]]);
export async function startMatomoWorkspace({port=0,...options}={}) {
  if(!Number.isInteger(port)||port<0||port>65535)throw fault('MATOMO_PORT_INVALID');
  const model=await openMatomoWorkspace(options),token=randomBytes(32).toString('hex'),pending=new Map();let origin,hosts,closing,stopping=false;
  const secretsEqual=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value)&&timingSafeEqual(Buffer.from(value),Buffer.from(token));
  const operationStatus=id=>{
    const saved=model.store.action(id);if(saved)return saved;
    const active=pending.get(id);return active?{id,state:active.done?(active.error?'FAILED':'COMPLETE'):'VALIDATING',result:active.result??null,error:active.error??null}:null;
  };
  function submit(name,input) {
    const id=identifier(input.operationId),hash=identity({name,input}),old=pending.get(id);
    if(old){if(old.hash!==hash)throw fault('MATOMO_OPERATION_ID_CONFLICT',undefined,409);return old;}
    const record={id,hash,done:false};
    pending.set(id,record);
    record.promise=Promise.resolve().then(()=>model.perform(name,input)).then(result=>{record.result=result;record.done=true;return result;},error=>{record.error=safeError(error);record.done=true;throw error;});
    void record.promise.catch(()=>{});
    // Completed action results live in the native journal; retain only a short
    // process-local validation history when no action row was created.
    for(const [key,value]of pending)if(pending.size>200&&value.done&&model.store.action(key))pending.delete(key);
    return record;
  }
  const server=createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"};
    const send=(status,body)=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
    try{
      if(stopping)throw fault('MATOMO_WORKSPACE_CLOSING',undefined,503);
      if(!hosts?.has(req.headers.host))throw fault('MATOMO_HOST_INVALID',undefined,403);
      const url=new URL(req.url,origin);
      if(req.method==='GET'&&STATIC.has(url.pathname)){
        const [name,type]=STATIC.get(url.pathname),raw=await readFile(new URL('./public/'+name,import.meta.url));
        res.writeHead(200,{...headers,'Content-Type':type,'Content-Length':raw.length});res.end(raw);return;
      }
      if(!secretsEqual(req.headers.authorization?.replace(/^Bearer /,'')))throw fault('MATOMO_AUTH_REQUIRED',undefined,401);
      if(req.headers.origin&&req.headers.origin!==origin)throw fault('MATOMO_ORIGIN_INVALID',undefined,403);
      if(req.method==='GET'){
        const id=url.searchParams.get('id'),offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??25);
        if(url.pathname==='/api/state'){send(200,model.state());return;}
        if(url.pathname==='/api/action'){const value=operationStatus(identifier(id));if(!value)throw fault('MATOMO_ACTION_NOT_FOUND',undefined,404);send(200,{action:value,revision:model.store.revision()});return;}
        if(url.pathname==='/api/catalog'){send(200,{catalog:model.captures.catalog(id)});return;}
        if(url.pathname==='/api/capture'){send(200,{capture:model.captures.capture(id),tables:model.captures.tables(id)});return;}
        if(url.pathname==='/api/rows'){send(200,model.captures.rows(id,{offset,limit,tableId:url.searchParams.get('table')??undefined}));return;}
        if(url.pathname==='/api/edition'){const result=await model.editions.manifest(id);send(200,{edition:result.edition,manifest:result.value});return;}
        if(url.pathname==='/api/edition/rows'){send(200,await model.editions.sample(id,{offset,limit,tableId:url.searchParams.get('table')??undefined}));return;}
        if(url.pathname==='/api/comparison'){send(200,await model.comparisons.page(id,{offset,limit,kind:url.searchParams.get('kind')??undefined}));return;}
        if(url.pathname==='/api/merchant'){send(200,await model.merchant.state(id));return;}
        if(url.pathname==='/api/releases'){send(200,await model.merchant.releases());return;}
        if(url.pathname==='/api/release-diff'){send(200,await model.merchant.diff(url.searchParams.get('before'),url.searchParams.get('after')));return;}
        if(url.pathname==='/api/delivery'){send(200,await model.merchant.inspectDelivery(id,url.searchParams.get('query')??undefined));return;}
        if(url.pathname==='/api/source-read'){send(200,await model.sourceRead(id));return;}
        if(url.pathname.startsWith('/files/')){
          const value=await model.artifact(url.pathname.slice(7),id,{kind:url.searchParams.get('kind')});
          const disposition='attachment; filename="'+value.name.replace(/[^A-Za-z0-9_.-]/g,'_')+'"';
          if(value.content){res.writeHead(200,{...headers,'Content-Type':value.mediaType,'Content-Disposition':disposition,'Content-Length':value.content.length});res.end(value.content);return;}
          if(value.stream){res.writeHead(200,{...headers,'Content-Type':value.mediaType,'Content-Disposition':disposition});await pipeline(Readable.from(value.stream),res);return;}
          const pin=await hashPrivate(value.path,1073741824);
          if(value.sha256&&value.sha256!==pin.hash)throw fault('MATOMO_ARTIFACT_CHANGED');
          const handle=await open(value.path,constants.O_RDONLY|constants.O_NOFOLLOW);
          try{
            const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.mode&0o077||stat.size!==pin.bytes)throw fault('MATOMO_ARTIFACT_CHANGED');
            res.writeHead(200,{...headers,'Content-Type':value.mediaType,'Content-Disposition':disposition,'Content-Length':pin.bytes,'X-Content-Sha256':pin.hash});
            await pipeline(handle.createReadStream({autoClose:false}),res);
          }finally{await handle.close();}
          return;
        }
      }
      if(req.method!=='POST'||req.headers.origin!==origin)throw fault('MATOMO_MUTATION_ORIGIN_REQUIRED',undefined,403);
      if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw fault('MATOMO_JSON_REQUIRED',undefined,415);
      let length=0;const chunks=[];
      for await(const chunk of req){length+=chunk.length;if(length>1048576)throw fault('MATOMO_REQUEST_TOO_LARGE',undefined,413);chunks.push(chunk);}
      let input;try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw fault('MATOMO_JSON_INVALID');}
      if(url.pathname==='/api/cancel'){send(200,model.store.cancel(identifier(input.operationId)));return;}
      if(url.pathname==='/api/preview'){send(200,await model.merchant.preview(input));return;}
      if(!url.pathname.startsWith('/api/operation/'))throw fault('MATOMO_ROUTE_NOT_FOUND',undefined,404);
      const name=url.pathname.slice('/api/operation/'.length);
      if(!model.operationNames.includes(name))throw fault('MATOMO_OPERATION_NOT_FOUND',undefined,404);
      const task=submit(name,input);
      await Promise.race([task.promise.catch(()=>{}),new Promise(done=>setImmediate(done))]);
      if(task.done){if(task.error){send(task.error.status??400,{error:task.error,operationId:task.id});return;}send(200,{result:task.result,operationId:task.id,revision:model.store.revision()});}
      else send(202,{operationId:task.id,action:operationStatus(task.id),revision:model.store.revision()});
    }catch(error){if(res.headersSent){res.destroy();return;}const value=safeError(error);send(value.status??400,{error:value});}
  });
  server.requestTimeout=350000;server.headersTimeout=10000;server.keepAliveTimeout=2000;
  try{await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});}
  catch(error){await model.close();throw error;}
  origin='http://127.0.0.1:'+server.address().port;hosts=new Set([new URL(origin).host]);
  async function close(){
    if(closing)return closing;stopping=true;
    closing=(async()=>{try{await model.close();await Promise.allSettled([...pending.values()].map(x=>x.promise));}
      finally{await new Promise((done,fail)=>{server.close(e=>e?fail(e):done());server.closeIdleConnections?.();});}})();return closing;
  }
  return {server,model,origin,token,url:origin+'/#'+token,close};
}
