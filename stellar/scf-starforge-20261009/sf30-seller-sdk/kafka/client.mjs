// MIT. Complete Node consumer of the original Kafka workspace HTTP API.
import http from 'node:http';
import { constants } from 'node:fs';
import { open, lstat, link, unlink } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  KAFKA_CLIENT_SCHEMA, KAFKA_LIMITS, KAFKA_CAPTURE_STATUSES, KafkaWorkspaceError,
  failure, plain, exact, identifier, operationName, integer, hostPath, hash, utf8,
  parseKafkaJson, stringifyKafkaJson, readKafkaWorkspaceConnection, validateKafkaLaunch,
  requestPath, page, captureRevision, prepareCaptureRequest, projectRequest, sameFile
} from './client-protocol.mjs';
export {
  KAFKA_CLIENT_SCHEMA, KAFKA_CONNECTION_SCHEMA, KAFKA_LAUNCH_SCHEMA, KAFKA_LIMITS,
  KAFKA_CAPTURE_STATUSES, KafkaWorkspaceError, KafkaJsonNumber, parseKafkaJson,
  stringifyKafkaJson, readKafkaWorkspaceConnection, readKafkaHostFile, kafkaOffset
} from './client-protocol.mjs';

function aborted(signal) {
  if (signal?.aborted) throw failure('KAFKA_ABORTED','The client operation was cancelled.');
}
function timeoutValue(value) { return integer(value,1,3600000,'Request timeout in milliseconds'); }
function jsonPayload(value, maximum) {
  const raw=Buffer.from(stringifyKafkaJson(value));
  if (raw.length>maximum) throw failure('KAFKA_INVALID_PARAMS','The JSON request exceeds the original route limit of '+maximum+' bytes.');
  return raw;
}
function responseLength(response,maximum) {
  const lengths=[];
  for (let i=0;i<response.rawHeaders.length;i+=2)
    if (response.rawHeaders[i].toLowerCase()==='content-length') lengths.push(response.rawHeaders[i+1]);
  if (lengths.length!==1 || !/^(0|[1-9][0-9]*)$/.test(lengths[0]) || response.headers['transfer-encoding'] ||
      response.headers['content-encoding'] && response.headers['content-encoding']!=='identity')
    throw failure('KAFKA_RESPONSE_INVALID','The original server must return one exact, unencoded Content-Length.');
  const length=Number(lengths[0]);
  if (!Number.isSafeInteger(length) || length>maximum)
    throw failure('KAFKA_RESPONSE_TOO_LARGE','Use the original streamed file operation for this complete response.');
  return length;
}
function mediaType(response,expected) {
  const value=String(response.headers['content-type']??'');
  if (value.split(';',1)[0].trim().toLowerCase()!==expected)
    throw failure('KAFKA_RESPONSE_INVALID','The original server returned an unexpected response media type.');
  return value;
}
async function responseBytes(response,maximum) {
  const expected=responseLength(response,maximum), chunks=[]; let count=0;
  for await (const chunk of response) {
    count+=chunk.length;
    if (count>expected || count>maximum) throw failure('KAFKA_RESPONSE_TOO_LARGE','The original response exceeded its declared byte length.');
    chunks.push(chunk);
  }
  if (count!==expected || !response.complete)
    throw failure('KAFKA_RESPONSE_INCOMPLETE','The original response ended before its complete declared bytes.');
  return Buffer.concat(chunks,count);
}
async function sourceHandle(filename,maximum,expectedSha256,signal) {
  aborted(signal);
  const path=hostPath(filename);
  const handle=await open(path,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before=await handle.stat({bigint:true});
    if (!before.isFile() || before.size>BigInt(maximum))
      throw failure('KAFKA_HOST_FILE_INVALID','Select an original regular file within the native upload limit.');
    aborted(signal);
    if (expectedSha256!==undefined) {
      identifier(expectedSha256,'Original input SHA-256');
      const checksum=createHash('sha256');
      if (before.size) for await (const bytes of handle.createReadStream({autoClose:false,start:0,end:Number(before.size)-1,signal})) {aborted(signal);checksum.update(bytes);}
      if (checksum.digest('hex')!==expectedSha256)
        throw failure('KAFKA_HOST_FILE_CHANGED','The complete upload differs from its declared original SHA-256.');
    }
    const selected={path,handle,before,size:Number(before.size)};
    await stableSource(selected);
    aborted(signal);
    return selected;
  } catch (error) { await handle.close().catch(()=>{}); throw error; }
}
async function stableSource(source) {
  const after=await source.handle.stat({bigint:true}), current=await lstat(source.path,{bigint:true});
  if (!sameFile(source.before,after) || !sameFile(after,current))
    throw failure('KAFKA_HOST_FILE_CHANGED','The original upload changed while it was selected or transferred.');
}
async function privateDirectory(path) {
  const handle=await open(path,constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const info=await handle.stat({bigint:true});
    if (!info.isDirectory() || process.platform!=='win32' &&
        ((info.mode&0o077n)!==0n || typeof process.getuid==='function' && info.uid!==BigInt(process.getuid())))
      throw failure('KAFKA_DESTINATION_INVALID','Choose an existing private, operator-owned receiving directory.');
    return {handle,info,path};
  } catch (error) {await handle.close().catch(()=>{});throw error;}
}
async function removeOwned(path,identity) {
  if (!identity) return;
  try {
    const current=await lstat(path,{bigint:true});
    if (current.dev===identity.dev && current.ino===identity.ino) await unlink(path);
  } catch (error) {if(error.code!=='ENOENT')throw error;}
}
/** Inspect a retained completed file without opening a workspace or making a request. */
export async function inspectKafkaDownload(filename,{maximumBytes=KAFKA_LIMITS.downloadBytes,sha256,signal}={}) {
  integer(maximumBytes,1,4*1024*1024*1024,'Maximum file bytes');
  if(signal!==undefined&&!(signal instanceof AbortSignal))throw failure('KAFKA_INVALID_PARAMS','Select an AbortSignal for file inspection.');
  const input=await sourceHandle(filename,maximumBytes,sha256,signal);
  try {
    const info=input.before;
    if (process.platform!=='win32' && ((info.mode&0o077n)!==0n ||
        typeof process.getuid==='function' && info.uid!==BigInt(process.getuid())))
      throw failure('KAFKA_HOST_FILE_INVALID','The retained download must remain private and operator-owned.');
    const checksum=createHash('sha256');
    if (input.size) for await (const data of input.handle.createReadStream({autoClose:false,start:0,end:input.size-1,signal})) {aborted(signal);checksum.update(data);}
    await stableSource(input);
    aborted(signal);
    return {schema:'stellar-forge.kafka-client-file.v1',path:input.path,bytes:input.size,sha256:checksum.digest('hex')};
  } finally {await input.handle.close();}
}

/** Every operation borrows the original authenticated server. This class never opens SQLite. */
export class KafkaWorkspaceClient {
  #definition; #options; #controller=new AbortController(); #pending=new Set();
  #active=0; #queue=[]; #closed=false; #closing; #binding;
  constructor(definition,options={}) {
    exact(definition,['connectionFile'],['expectedWorkspaceId','expectedBindingSha256']);
    const selected={connectionFile:hostPath(definition.connectionFile)};
    if (definition.expectedWorkspaceId!==undefined) {
      if (typeof definition.expectedWorkspaceId!=='string' ||
          !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(definition.expectedWorkspaceId))
        throw failure('KAFKA_INVALID_PARAMS','Use the original Kafka workspace UUID.');
      selected.expectedWorkspaceId=definition.expectedWorkspaceId;
    }
    if (definition.expectedBindingSha256!==undefined)
      selected.expectedBindingSha256=identifier(definition.expectedBindingSha256,'Original source binding');
    exact(options,[],['signal','timeoutMs','maximumJsonBytes','concurrency']);
    if (options.signal!==undefined && !(options.signal instanceof AbortSignal))
      throw failure('KAFKA_INVALID_PARAMS','Select an AbortSignal for the client lifetime.');
    this.#definition=Object.freeze(selected);
    this.#options=Object.freeze({
      signal:options.signal,timeoutMs:timeoutValue(options.timeoutMs??240000),
      maximumJsonBytes:integer(options.maximumJsonBytes??KAFKA_LIMITS.jsonBytes,1024,128*1024*1024,'Maximum JSON response bytes'),
      concurrency:integer(options.concurrency??4,1,4,'Concurrent local requests')
    });
  }
  get definition() {return this.#definition;}
  get closed() {return this.#closed;}
  get binding() {return this.#binding ? {...this.#binding} : null;}
  #release() {
    this.#active--;
    while (this.#queue.length) {
      const waiter=this.#queue.shift();
      waiter.signal.removeEventListener('abort',waiter.abort);
      if (waiter.signal.aborted) {waiter.reject(failure('KAFKA_ABORTED','The queued client operation was cancelled.'));continue;}
      this.#active++;waiter.resolve(()=>this.#release());break;
    }
  }
  #slot(signal) {
    aborted(signal);
    if (this.#active<this.#options.concurrency) {this.#active++;return Promise.resolve(()=>this.#release());}
    return new Promise((resolve,reject)=>{
      const waiter={resolve,reject,signal,abort:null};
      waiter.abort=()=>{
        const at=this.#queue.indexOf(waiter);if(at>=0)this.#queue.splice(at,1);
        reject(failure('KAFKA_ABORTED','The queued client operation was cancelled.'));
      };
      signal.addEventListener('abort',waiter.abort,{once:true});
      this.#queue.push(waiter);
    });
  }
  #track(fn,options={},useSlot=true) {
    if (this.#closed) return Promise.reject(failure('KAFKA_CLIENT_CLOSED','This Kafka client has been closed.'));
    exact(options,[],['signal','timeoutMs','maximumJsonBytes','maximumBytes','sha256']);
    if (options.signal!==undefined && !(options.signal instanceof AbortSignal))
      throw failure('KAFKA_INVALID_PARAMS','Select an AbortSignal for this operation.');
    const timerController=new AbortController();
    const signals=[this.#controller.signal,timerController.signal];
    if(this.#options.signal)signals.push(this.#options.signal);
    if(options.signal)signals.push(options.signal);
    const signal=AbortSignal.any(signals), duration=timeoutValue(options.timeoutMs??this.#options.timeoutMs);
    let timer,release;
    const operation=(async()=>{
      try {
        aborted(signal);
        // Queue time and HTTP/stream time share the host-chosen deadline.
        timer=setTimeout(()=>timerController.abort(),duration);
        if(useSlot)release=await this.#slot(signal);
        aborted(signal);
        return await fn(signal);
      } catch(error) {
        if(timerController.signal.aborted && !(error instanceof KafkaWorkspaceError && error.status))
          throw failure('KAFKA_REQUEST_TIMEOUT','The original client deadline elapsed.',{
            ...(error?.outcomeUnknown?{outcomeUnknown:true}:{}),
            ...(error?.retainedFile?{retainedFile:error.retainedFile}:{})
          });
        throw error;
      } finally {clearTimeout(timer);if(release)release();}
    })();
    this.#pending.add(operation);
    operation.then(()=>this.#pending.delete(operation),()=>this.#pending.delete(operation));
    return operation;
  }
  async #exchange(connection,method,route,{body,source,headers={}}={},consume,signal) {
    aborted(signal);
    const payloadLength=source?.size ?? body?.length;
    const transferController=new AbortController();
    const transferSignal=AbortSignal.any([signal,transferController.signal]);
    let request,response,stream;
    let upload=Promise.resolve(), dispatched=false;
    try {
      const received=new Promise((resolve,reject)=>{
        request=http.request({
          protocol:'http:',hostname:'127.0.0.1',port:connection.port,path:route,method,
          agent:false,signal,
          headers:{...headers,Host:new URL(connection.origin).host,Origin:connection.origin,
            Authorization:'Bearer '+connection.token,'Accept-Encoding':'identity',
            ...(payloadLength===undefined?{}:{'Content-Length':String(payloadLength)})}
        },resolve);
        request.on('error',reject);
      });
      received.catch(()=>{}); // A pre-send source failure still drains the request's eventual error.
      if (source && source.size>0) {
        upload=(async()=>{
          stream=source.handle.createReadStream({autoClose:false,start:0,end:source.size-1,signal:transferSignal});
          let sent=0;
          for await (const chunk of stream) {
            aborted(transferSignal);sent+=chunk.length;
            dispatched=true;
            if (!request.write(chunk)) await once(request,'drain',{signal:transferSignal});
          }
          if(sent!==source.size)throw failure('KAFKA_HOST_FILE_CHANGED','The original upload ended before its declared bytes.');
          await stableSource(source);
          request.end();
        })();
        upload.catch(error=>request.destroy(error));
      } else {
        if(source)await stableSource(source);
        dispatched=true;request.end(body);
      }
      response=await received;
      if (response.statusCode<200 || response.statusCode>=300) {
        let details;
        try {details=parseKafkaJson(utf8(await responseBytes(response,65536)));}catch{}
        throw failure('KAFKA_HTTP_ERROR',typeof details?.error==='string' ? details.error.slice(0,2000) :
          'The original Kafka server returned HTTP '+response.statusCode+'.',
          {status:response.statusCode,method,route});
      }
      const result=await consume(response);
      await upload;
      return result;
    } catch(error) {
      transferController.abort();
      if(request)request.destroy();
      if(response)response.destroy();
      if(stream)stream.destroy();
      await upload.catch(()=>{});
      const issue=error instanceof KafkaWorkspaceError ? error :
        failure(signal.aborted?'KAFKA_ABORTED':'KAFKA_TRANSPORT_INTERRUPTED',
          signal.aborted?'The client operation was cancelled.':'The original local request was interrupted.',{method,route});
      if(method==='POST' && dispatched && !issue.status)issue.outcomeUnknown=true;
      throw issue;
    } finally {
      transferController.abort();
      if(stream && !stream.destroyed)stream.destroy();
      if(request && !request.destroyed)request.destroy();
    }
  }
  #operation(fn,options={}) {
    return this.#track(async signal=>{
      const connection=await readKafkaWorkspaceConnection(this.#definition.connectionFile);
      const launch=await this.#exchange(connection,'GET','/api/launch',{},async response=>{
        mediaType(response,'application/json');
        return parseKafkaJson(utf8(await responseBytes(response,65536)));
      },signal);
      this.#binding=validateKafkaLaunch(launch,connection,this.#definition,this.#binding);
      aborted(signal);
      return fn(connection,launch,signal);
    },options);
  }
  #json(route,body,options={},maximum=KAFKA_LIMITS.requestBytes) {
    const bytes=body===undefined?undefined:jsonPayload(body,maximum);
    const limit=integer(options.maximumJsonBytes??this.#options.maximumJsonBytes,1024,128*1024*1024,'Maximum JSON response bytes');
    return this.#operation((connection,_launch,signal)=>this.#exchange(connection,body===undefined?'GET':'POST',route,
      {body:bytes,headers:body===undefined?{}:{'Content-Type':'application/json; charset=utf-8'}},
      async response=>{
        mediaType(response,'application/json');
        return parseKafkaJson(utf8(await responseBytes(response,limit)));
      },signal),options);
  }
  inspect(options={}) {
    return this.#operation((connection,launch)=>({
      schema:KAFKA_CLIENT_SCHEMA,status:launch.status,workspace:launch.workspace,
      workspaceId:launch.workspaceId,bindingSha256:launch.bindingSha256,sourceRoot:launch.sourceRoot,
      python:launch.python,pid:launch.pid,origin:connection.origin,connectionFile:connection.connectionFile,
      connectionSha256:connection.fileSha256,
      ...(connection.application?{application:{
        applicationId:connection.application.applicationId,operationId:connection.application.operationId,
        observedAt:connection.application.observedAt}}:{})
    }),options);
  }
  state(options={}) {return this.#json('/api/state',undefined,options);}
  async configuredTopics(options={}) {
    const state=await this.state(options);
    if(!plain(state.kafka)||!Array.isArray(state.kafka.connections))
      throw failure('KAFKA_RESPONSE_INVALID','The original Kafka state is incomplete.');
    return state.kafka.connections.map(item=>({connection:item.id,revision:item.revision,
      configSha256:item.sha256,topic:item.config.topic,brokers:item.config.brokers}));
  }
  connection(id,options={}) {return this.#json(requestPath('/api/kafka/connection',{id:operationName(id,'Connection')}),undefined,options);}
  saveConnection(request,options={}) {
    exact(request,['connection','expectedRevision','operation','config']);
    operationName(request.connection,'Connection');operationName(request.operation);
    integer(request.expectedRevision,0,1000000,'Expected connection revision');
    if(!plain(request.config)||request.config.schema!=='stellar-forge.kafka-connection.v1')
      throw failure('KAFKA_INVALID_PARAMS','Use the original Kafka connection configuration with credential environment references.');
    return this.#json('/api/kafka/connection',request,options);
  }
  inspectConnection(request,options={}) {
    exact(request,['connection','revision','operation']);operationName(request.connection,'Connection');
    integer(request.revision,1,1000001,'Connection revision');operationName(request.operation);
    return this.#json('/api/kafka/inspect',request,options);
  }
  inspection(id,options={}) {return this.#json(requestPath('/api/kafka/inspection',{id:identifier(id,'Inspection')}),undefined,options);}
  prepareCapture(request,options={}) {return this.#json('/api/kafka/capture',prepareCaptureRequest(request),options);}
  capture(id,options={}) {return this.#json(requestPath('/api/kafka/capture',{id:identifier(id,'Capture')}),undefined,options);}
  runCapture(request,options={}) {return this.#json('/api/kafka/run',captureRevision(request),options);}
  resumeCapture(request,options={}) {return this.runCapture(request,options);}
  cancelCapture(id,options={}) {return this.#json('/api/kafka/cancel',{capture:identifier(id,'Capture')},options);}
  waitForCapture(id,{pollMs=500,signal,timeoutMs=240000}={}) {
    identifier(id,'Capture');integer(pollMs,100,10000,'Capture polling interval');
    return this.#track(async combined=>{
      for(;;) {
        const value=await this.capture(id,{signal:combined});
        if(!KAFKA_CAPTURE_STATUSES.includes(value.status))
          throw failure('KAFKA_RESPONSE_INVALID','The original capture returned an unknown state.');
        if(!['RUNNING','CANCELLING'].includes(value.status))return value;
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(done,pollMs);
          function done(){combined.removeEventListener('abort',cancel);resolve();}
          function cancel(){clearTimeout(timer);reject(failure('KAFKA_ABORTED','Capture waiting was cancelled.'));}
          combined.addEventListener('abort',cancel,{once:true});
          if(combined.aborted)cancel();
        });
      }
    },{signal,timeoutMs},false);
  }
  messages(id,pagination={},options={}) {return this.#json(requestPath('/api/kafka/messages',{capture:identifier(id,'Capture'),...page(pagination)}),undefined,options);}
  message(id,options={}) {return this.#json(requestPath('/api/kafka/message',{id:identifier(id,'Message')}),undefined,options);}
  project(request,options={}) {return this.#json('/api/kafka/project',projectRequest(request),options);}
  projection(id,options={}) {return this.#json(requestPath('/api/kafka/projection',{id:identifier(id,'Projection')}),undefined,options);}
  source(id,options={}) {return this.#json(requestPath('/api/source',{id:identifier(id,'Source')}),undefined,options);}
  plan(id,options={}) {return this.#json(requestPath('/api/plan',{id:identifier(id,'Plan')}),undefined,options);}
  savePlan(request,options={}) {
    if(!plain(request))throw failure('KAFKA_INVALID_PARAMS','Supply the original complete NDJSON mapping plan.');
    return this.#json('/api/plan',request,options,KAFKA_LIMITS.datasetRequestBytes);
  }
  build(request,options={}) {
    exact(request,['source','plan']);identifier(request.source,'Source');identifier(request.plan,'Plan');
    return this.#json('/api/build',request,options,KAFKA_LIMITS.datasetRequestBytes);
  }
  query(request,options={}) {
    exact(request,['build','query']);identifier(request.build,'Build');
    if(!plain(request.query)||Object.values(request.query).some(value=>typeof value!=='string'))
      throw failure('KAFKA_INVALID_PARAMS','Native dataset query parameters must remain scalar strings.');
    return this.#json('/api/query',request,options,KAFKA_LIMITS.datasetRequestBytes);
  }
  compare(request,options={}) {
    exact(request,['before','after']);identifier(request.before,'Before build');identifier(request.after,'After build');
    return this.#json('/api/compare',request,options,KAFKA_LIMITS.datasetRequestBytes);
  }
  changes(id,pagination={},options={}) {return this.#json(requestPath('/api/changes',{id:identifier(id,'Comparison'),...page(pagination,250)}),undefined,options);}
  #upload(route,filename,maximum,headers,options={}) {
    return this.#operation(async(connection,_launch,signal)=>{
      const source=await sourceHandle(filename,maximum,options.sha256,signal);
      try {
        aborted(signal);
        return await this.#exchange(connection,'POST',route,{source,headers},async response=>{
          mediaType(response,'application/json');
          return parseKafkaJson(utf8(await responseBytes(response,
            integer(options.maximumJsonBytes??this.#options.maximumJsonBytes,1024,128*1024*1024,'Maximum JSON response bytes'))));
        },signal);
      } finally {await source.handle.close();}
    },options);
  }
  importKafka(filename,options={}) {return this.#upload('/api/kafka/import',filename,KAFKA_LIMITS.kafkaPacketBytes,{'Content-Type':'application/zip'},options);}
  importNative(filename,options={}) {return this.#upload('/api/import',filename,KAFKA_LIMITS.nativePacketBytes,{'Content-Type':'application/zip'},options);}
  addSource(filename,{name='source.ndjson',label=name}={},options={}) {
    for(const value of [name,label])if(typeof value!=='string'||!value||value.length>160||/[\x00-\x1f\x7f]/.test(value))
      throw failure('KAFKA_INVALID_PARAMS','Use a printable original source name and label up to 160 characters.');
    return this.#upload('/api/source',filename,KAFKA_LIMITS.sourceBytes,
      {'Content-Type':'application/x-ndjson','X-NDJSON-Name':encodeURIComponent(name),'X-NDJSON-Label':encodeURIComponent(label)},options);
  }
  #download(route,body,filename,kind,expectedMedia,options={}) {
    const destination=hostPath(filename), parent=dirname(destination);
    const bytes=body===undefined?undefined:jsonPayload(body,KAFKA_LIMITS.datasetRequestBytes);
    const maximum=integer(options.maximumBytes??KAFKA_LIMITS.downloadBytes,1,4*1024*1024*1024,'Maximum download bytes');
    return this.#operation(async(connection,launch,signal)=>{
      const directory=await privateDirectory(parent);
      let temporary,handle,owned,published=false,retained,primary;
      try {
        try {await lstat(destination);throw failure('KAFKA_DESTINATION_EXISTS','Preserve the existing receiving file; inspect it or choose a new destination.');}
        catch(error){if(error.code!=='ENOENT')throw error;}
        temporary=parent+'/.kafka-download-'+randomUUID()+'.pending';
        handle=await open(temporary,'wx',0o600);
        owned=await handle.stat({bigint:true});
        const method=body===undefined?'GET':'POST';
        return await this.#exchange(connection,method,route,
          {body:bytes,headers:body===undefined?{}:{'Content-Type':'application/json; charset=utf-8'}},
          async response=>{
            const contentType=mediaType(response,expectedMedia), length=responseLength(response,maximum);
            const checksum=createHash('sha256');let size=0;
            for await(const chunk of response) {
              aborted(signal);size+=chunk.length;
              if(size>length||size>maximum)throw failure('KAFKA_RESPONSE_TOO_LARGE','The complete download exceeds its original declared length.');
              await handle.writeFile(chunk);checksum.update(chunk);
            }
            if(size!==length||!response.complete)
              throw failure('KAFKA_RESPONSE_INCOMPLETE','The retained download ended before its complete original bytes.');
            await handle.sync();
            const written=await handle.stat({bigint:true});
            if(written.dev!==owned.dev||written.ino!==owned.ino||written.size!==BigInt(size))
              throw failure('KAFKA_DOWNLOAD_CHANGED','The private download file changed while being written.');
            await handle.close();handle=null;
            const currentParent=await lstat(parent,{bigint:true});
            if(currentParent.dev!==directory.info.dev||currentParent.ino!==directory.info.ino)
              throw failure('KAFKA_DESTINATION_INVALID','The selected receiving directory changed.');
            retained={schema:'stellar-forge.kafka-client-download.v1',kind,path:destination,
              bytes:size,sha256:checksum.digest('hex'),contentType,
              workspaceId:launch.workspaceId,bindingSha256:launch.bindingSha256,
              request:{method,route,...(bytes?{bodySha256:hash(bytes)}:{})}};
            if(options.sha256!==undefined&&retained.sha256!==identifier(options.sha256,'Expected download SHA-256'))
              throw failure('KAFKA_DOWNLOAD_CHANGED','The original complete download differs from its selected SHA-256.');
            aborted(signal);
            await link(temporary,destination);published=true;
            await directory.handle.sync();
            return retained;
          },signal);
      } catch(error) {
        primary=error instanceof KafkaWorkspaceError?error:
          failure('KAFKA_DOWNLOAD_FAILED',error.code==='EEXIST'?'The receiving path now belongs to another completed file.':
            'The complete download could not be published in its selected private directory.');
        if(published&&retained)primary.retainedFile=retained;
        throw primary;
      } finally {
        let cleanup;
        if(handle)try{await handle.close();}catch(error){cleanup=error;}
        if(temporary)try{await removeOwned(temporary,owned);}catch(error){cleanup??=error;}
        try{await directory.handle.close();}catch(error){cleanup??=error;}
        if(cleanup&&!primary)throw failure('KAFKA_DOWNLOAD_CLEANUP','The transfer finished but its local file cleanup needs recovery.',
          published&&retained?{retainedFile:retained}:{});
      }
    },options);
  }
  exportKafka(request,destination,options={}) {
    exact(request,['build'],['projection']);identifier(request.build,'Build');
    if(request.projection!==undefined)identifier(request.projection,'Projection');
    return this.#download(requestPath('/api/kafka/export',request),undefined,destination,'kafka-project','application/zip',options);
  }
  exportNative(build,destination,options={}) {return this.#download(requestPath('/api/export',{build:identifier(build,'Build')}),undefined,destination,'ndjson-project','application/zip',options);}
  exportDataset(build,destination,options={}) {return this.#download(requestPath('/api/dataset-export',{build:identifier(build,'Build')}),undefined,destination,'dataset','application/zip',options);}
  exportChanges(id,destination,options={}) {return this.#download(requestPath('/api/changes/download',{id:identifier(id,'Comparison')}),undefined,destination,'comparison-changes','application/x-ndjson',options);}
  exportMerchant(request,destination,options={}) {
    exact(request,['build','payment','origin','path']);identifier(request.build,'Build');
    if(!plain(request.payment)||typeof request.origin!=='string'||typeof request.path!=='string')
      throw failure('KAFKA_INVALID_PARAMS','Supply the original merchant payment terms, public origin and route.');
    return this.#download('/api/merchant',request,destination,'merchant','application/zip',options);
  }
  downloadRecord(kind,id,destination,options={}) {
    const routes={connection:'/api/kafka/connection',inspection:'/api/kafka/inspection',
      capture:'/api/kafka/capture',source:'/api/source',plan:'/api/plan'};
    if(!Object.hasOwn(routes,kind))throw failure('KAFKA_INVALID_PARAMS','Select an original connection, inspection, capture, source or plan record.');
    if(kind==='connection')operationName(id,'Connection');else identifier(id,'Record');
    return this.#download(requestPath(routes[kind],{id}),undefined,destination,'record','application/json',options);
  }
  downloadQuery(request,destination,options={}) {
    exact(request,['build','query']);identifier(request.build,'Build');
    if(!plain(request.query)||Object.values(request.query).some(value=>typeof value!=='string'))
      throw failure('KAFKA_INVALID_PARAMS','Native dataset query parameters must remain scalar strings.');
    return this.#download('/api/query',request,destination,'query','application/json',options);
  }
  downloadMessage(id,destination,options={}) {return this.#download(requestPath('/api/kafka/message',{id:identifier(id,'Message')}),undefined,destination,'message','application/json',options);}
  downloadState(destination,options={}) {return this.#download('/api/state',undefined,destination,'state','application/json',options);}
  downloadProjection(id,destination,options={}) {return this.#download(requestPath('/api/kafka/projection',{id:identifier(id,'Projection')}),undefined,destination,'projection','application/json',options);}
  close() {
    if(this.#closing)return this.#closing;
    this.#closed=true;this.#controller.abort();
    this.#closing=(async()=>{
      while(this.#pending.size)await Promise.allSettled([...this.#pending]);
    })();
    return this.#closing;
  }
  async [Symbol.asyncDispose]() {await this.close();}
}
