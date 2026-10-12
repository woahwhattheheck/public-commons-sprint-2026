// MIT. One original publication writer, private loopback operator and streamed handover.
import { createServer } from 'node:http';
import { open, readFile, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { openGeoServerOperator } from './adapter.mjs';
import { atomicJson } from '../../../postgres/publisher/files.mjs';
import { readReceiving, verifyFile } from './journal.mjs';
import { need, keys, absolute, operationId, hash, nativeBytes, MiB } from './contract.mjs';

const errorView=error=>({code:error.code??error.name??'GEOSERVER_ERROR',message:String(error.message??error).slice(0,4096)});
const ASSETS=new Map(JSON.parse(await readFile(new URL('./browser-assets.json',import.meta.url),'utf8')).routes);
function summary(row){
  return {id:row.id,state:row.state,kind:row.kind,createdAt:row.createdAt,preparedAt:row.preparedAt,
    appliedAt:row.appliedAt,receivedAt:row.receivedAt,reviewSha256:row.reviewSha256,error:row.error,
    progress:row.receivingProgress,steps:row.steps?.length??0,
    appliedSteps:row.steps?.filter(step=>['APPLIED','UNCHANGED','SKIPPED'].includes(step.state)).length??0};
}
export async function startGeoServerConsole({directory,profileFile,readerFile,port=0,environment=process.env,
  expectedProfileSha256,expectedReaderSha256,fetchImpl,signal}={}){
  need(Number.isInteger(port)&&port>=0&&port<=65535,'GEOSERVER_CONSOLE_PORT');
  const publisher=await openGeoServerOperator({directory,profileFile,readerFile,environment,
    expectedProfileSha256,expectedReaderSha256,fetchImpl,signal});
  const token=randomBytes(32).toString('hex'),instanceId=randomUUID(),requests=new Set(),connections=new Set(),jobs=new Map();
  const lifetime=new AbortController();let origin,draining=false,closing=null,listenerClose=null,active=null,lastJob=null,started=false,listenerFault=null;
  let resolveFinished,rejectFinished;const finished=new Promise((resolve,reject)=>{resolveFinished=resolve;rejectFinished=reject;});
  void finished.catch(()=>{});
  const native=createServer((request,response)=>{
    const controller=new AbortController(),signal=AbortSignal.any([controller.signal,lifetime.signal]);
    const socketClose=()=>controller.abort(new Error('The operator request closed.'));
    request.once('aborted',socketClose);response.once('close',socketClose);
    const task=route(request,response,signal).catch(error=>{
      if(!response.headersSent&&!response.destroyed)json(response,{error:errorView(error)},error.status>=400&&error.status<=599?error.status:400);
      else if(!response.destroyed)response.destroy(error);
    }).finally(()=>{request.removeListener('aborted',socketClose);response.removeListener('close',socketClose);requests.delete(task);});
    requests.add(task);
  });
  native.on('connection',socket=>{connections.add(socket);socket.once('close',()=>connections.delete(socket));});
  native.on('error',error=>{if(!started)return;
    listenerFault??=error;lifetime.abort(error);void close().then(()=>rejectFinished(error),cleanup=>{
      error.cleanupError=errorView(cleanup);error.close=close;rejectFinished(error);});});
  function json(response,value,status=200){
    const data=nativeBytes(value);
    response.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':String(data.length),
      'cache-control':'no-store','x-content-type-options':'nosniff'});response.end(data);
  }
  function authorized(request,authorization=request.headers.authorization){
    need(!draining,'GEOSERVER_CONSOLE_DRAINING',undefined,503);
    need(request.headers.host===new URL(origin).host,'GEOSERVER_CONSOLE_HOST',undefined,403);
    need(!request.headers.origin||request.headers.origin===origin,'GEOSERVER_CONSOLE_ORIGIN',undefined,403);
    need(!request.headers['sec-fetch-site']||['same-origin','none'].includes(request.headers['sec-fetch-site']),
      'GEOSERVER_CONSOLE_SITE',undefined,403);
    const supplied=Buffer.from(String(authorization??'')),expected=Buffer.from('Bearer '+token);
    need(supplied.length===expected.length&&timingSafeEqual(supplied,expected),'GEOSERVER_CONSOLE_AUTHENTICATION',undefined,401);
  }
  async function body(request,signal){
    need(/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''),'GEOSERVER_JSON_REQUEST');
    const chunks=[];let size=0;
    for await(const chunk of request){signal.throwIfAborted();size+=chunk.length;
      need(size<=2*MiB,'GEOSERVER_REQUEST_LIMIT',undefined,413);chunks.push(chunk);}
    signal.throwIfAborted();const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    need(value&&typeof value==='object'&&!Array.isArray(value),'GEOSERVER_REQUEST_OBJECT');return value;
  }
  function start(action,input){
    need(!active,'GEOSERVER_OPERATION_RUNNING','The current original operation is still running.',409);
    const job={id:randomUUID(),action,operationId:input.operationId,state:'RUNNING',startedAt:new Date().toISOString()};
    const work=Promise.resolve().then(()=>publisher[action](input,{signal:lifetime.signal}));
    active={job,work};jobs.set(job.id,job);
    if(jobs.size>256)for(const [id,row]of jobs){if(row.state!=='RUNNING'){jobs.delete(id);break;}}
    void work.then(result=>{job.state='COMPLETED';job.result=action==='exportReceiving'?
      {directory:result.directory,manifestSha256:result.manifestSha256,archive:result.archive}:
      {state:result.state?.state,reviewSha256:result.reviewSha256??result.state?.reviewSha256};},
      error=>{job.state='INTERRUPTED';job.error=errorView(error);}).finally(()=>{
        job.finishedAt=new Date().toISOString();lastJob=job;if(active?.job===job)active=null;});
    return {job};
  }
  async function archive(response,input,signal){
    const retained=await publisher.exportDescriptor(input),file=retained.archive;
    const before=await lstat(file.path,{bigint:true}),checked=await verifyFile(file.path,{maximum:file.bytes,signal});
    need(checked.bytes===file.bytes&&checked.sha256===file.sha256,'GEOSERVER_ARCHIVE_CHANGED');
    const handle=await open(file.path,constants.O_RDONLY|constants.O_NOFOLLOW);let stream;
    try{
      const observed=await handle.stat({bigint:true});
      need(observed.dev===before.dev&&observed.ino===before.ino&&observed.size===before.size&&
        observed.mtimeNs===before.mtimeNs&&observed.ctimeNs===before.ctimeNs,'GEOSERVER_ARCHIVE_CHANGED');
      const checksum=createHash('sha256');
      const check=new Transform({transform(chunk,encoding,callback){checksum.update(chunk);callback(null,chunk);}});
      response.writeHead(200,{'content-type':'application/zip','content-length':String(file.bytes),
        'content-disposition':'attachment; filename="geoserver-operator.zip"','cache-control':'no-store',
        'x-content-type-options':'nosniff','x-content-sha256':file.sha256});
      stream=handle.createReadStream({autoClose:false,signal});
      await pipeline(stream,check,response,{signal,end:false});
      need(checksum.digest('hex')===file.sha256,'GEOSERVER_ARCHIVE_CHANGED');response.end();
    }finally{stream?.destroy();await handle.close();}
  }
  async function route(request,response,signal){
    const url=new URL(request.url,origin??'http://127.0.0.1');
    need(url.origin===origin,'GEOSERVER_CONSOLE_TARGET',undefined,403);
    if(request.method==='GET'&&ASSETS.has(url.pathname)&&!url.search){
      need(request.headers.host===new URL(origin).host,'GEOSERVER_CONSOLE_HOST',undefined,403);
      const [name,type]=ASSETS.get(url.pathname),data=await readFile(new URL('./'+name,import.meta.url),{signal});
      response.writeHead(200,{'content-type':type,'content-length':String(data.length),'cache-control':'no-store',
        'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; frame-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        'referrer-policy':'no-referrer'});response.end(data);return;
    }
    if(request.method==='POST'&&url.pathname==='/download'&&!url.search){
      need(/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers['content-type']??''),'GEOSERVER_DOWNLOAD_FORM');
      const chunks=[];let length=0;
      for await(const chunk of request){signal.throwIfAborted();length+=chunk.length;need(length<=4096,'GEOSERVER_DOWNLOAD_FORM_LIMIT');chunks.push(chunk);}
      const fields=new URLSearchParams(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
      need([...fields.keys()].length===3&&['token','operationId','manifestSha256'].every(name=>fields.has(name)),'GEOSERVER_DOWNLOAD_FIELDS');
      authorized(request,'Bearer '+fields.get('token'));
      await archive(response,{operationId:operationId(fields.get('operationId')),manifestSha256:hash(fields.get('manifestSha256'))},signal);return;
    }
    authorized(request);
    if(request.method==='GET'){
      if(url.pathname==='/api/launch'){json(response,{schema:'starforge.geoserver-console-launch.v1',
        instanceId,workspace:publisher.directory,profile:publisher.profile});return;}
      if(url.pathname==='/api/job'){const job=jobs.get(url.searchParams.get('id'));need(job,'GEOSERVER_JOB_NOT_FOUND',undefined,404);json(response,{job});return;}
      if(url.pathname==='/api/state'){
        const selected=await publisher.inspect();
        json(response,{...selected,operations:selected.operations.map(summary),active:active?.job??null,lastJob});return;
      }
      if(url.pathname==='/api/operation'){json(response,await publisher.inspect(operationId(url.searchParams.get('id'))));return;}
      if(url.pathname==='/api/target'){json(response,await publisher.describe());return;}
      if(url.pathname==='/api/map'){
        const map=await publisher.readMap({operationId:operationId(url.searchParams.get('operationId')),
          readerId:url.searchParams.get('readerId'),layerId:url.searchParams.get('layerId')});
        response.writeHead(200,{'content-type':map.contentType,'content-length':String(map.bytes.length),
          'cache-control':'no-store','x-content-type-options':'nosniff','x-content-sha256':map.sha256});response.end(map.bytes);return;
      }
      if(url.pathname==='/api/archive'){await archive(response,{operationId:operationId(url.searchParams.get('operationId')),
        manifestSha256:hash(url.searchParams.get('manifestSha256'))},signal);return;}
      need(false,'GEOSERVER_ROUTE_NOT_FOUND',undefined,404);
    }
    need(request.method==='POST','GEOSERVER_METHOD_NOT_ALLOWED',undefined,405);
    const input=await body(request,signal);
    if(url.pathname==='/api/source'){
      keys(input,['directory','manifestSha256'],'original receiving selection');absolute(input.directory);
      const observed=await verifyFile(join(input.directory,'postgis-receiving.json'),{maximum:64*MiB,signal});
      if(input.manifestSha256)need(observed.sha256===hash(input.manifestSha256),'POSTGIS_RECEIVING_MANIFEST_CHANGED');
      const received=await readReceiving(input.directory,observed.sha256,{signal});
      const {files,...manifest}=received.receipt;
      json(response,{directory:input.directory,manifestSha256:observed.sha256,manifest,
        files:{count:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0)}});return;
    }
    if(url.pathname==='/api/cancel'){keys(input,['operationId'],'cancel');json(response,publisher.cancel(input));return;}
    if(url.pathname==='/api/action'){
      keys(input,['action','input'],'operation');
      const allowed={prepare:['operationId','receivingDirectory','manifestSha256','layers','expectedPublication','kind'],
        apply:['operationId','reviewSha256'],reconcile:['operationId'],
        prepareRollback:['operationId','publicationId','receivingDirectory','manifestSha256','expectedPublication'],
        receive:['operationId'],exportReceiving:['operationId','directory','archiveFile']};
      need(Object.hasOwn(allowed,input.action),'GEOSERVER_ACTION_UNKNOWN');
      keys(input.input,allowed[input.action],'selected action');operationId(input.input.operationId);
      json(response,start(input.action,input.input),202);return;
    }
    need(false,'GEOSERVER_ROUTE_NOT_FOUND',undefined,404);
  }
  const close=()=>{
    if(closing)return closing;
    draining=true;lifetime.abort(new Error('The original GeoServer console is closing.'));
    const task=(async()=>{
      if(!listenerClose){
        listenerClose=new Promise((resolve,reject)=>native.close(error=>
          error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
        void listenerClose.catch(()=>{listenerClose=null;});
      }
      native.closeIdleConnections();
      for(const socket of connections)socket.destroy();
      await Promise.allSettled([...requests]);await listenerClose;
      await publisher.close();if(active)await active.work.catch(()=>{});if(listenerFault)rejectFinished(listenerFault);else resolveFinished({state:'CLOSED'});
    })();
    closing=task;void task.catch(()=>{if(closing===task)closing=null;});return task;
  };
  try{
    signal?.throwIfAborted();
    await new Promise((resolve,reject)=>{
      const failure=error=>{native.removeListener('listening',ready);reject(error);};
      const ready=()=>{native.removeListener('error',failure);resolve();};
      native.once('error',failure);native.once('listening',ready);native.listen({host:'127.0.0.1',port});
    });
    origin='http://127.0.0.1:'+native.address().port;
    signal?.throwIfAborted();
    const connectionFile=join(publisher.directory,'console-connection.json');
    await atomicJson(publisher.directory,'console-connection.json',{schema:'starforge.geoserver-console-connection.v1',
      workspace:publisher.directory,instanceId,url:origin+'/#'+token,origin,profile:publisher.profile});started=true;
    return {schema:'starforge.geoserver-console-launch.v1',workspace:publisher.directory,instanceId,
      url:origin+'/#'+token,origin,connectionFile,profile:publisher.profile,finished,close};
  }catch(error){
    try{await close();}catch(cleanup){error.cleanupError=errorView(cleanup);error.close=close;}
    throw error;
  }
}
