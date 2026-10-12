// MIT. Real Proteus transports; this module contains no substitute evaluator.
import { readFile, mkdir, realpath, open } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const sha=value=>createHash('sha256').update(value).digest('hex');
const json=body=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fault=(code,message,details={})=>Object.assign(new Error(message),{code,details});
const MAX=256*1024*1024;

async function retainSpecification(path,body) {
  let handle;
  try {
    handle=await open(path,fsConstants.O_WRONLY|fsConstants.O_CREAT|fsConstants.O_EXCL|fsConstants.O_NOFOLLOW,0o600);
  } catch(error) {
    if(error.code!=='EEXIST')throw error;
    let existing;
    try {
      existing=await open(path,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);
      const stat=await existing.stat();
      if(!stat.isFile()||stat.nlink!==1||stat.mode&0o077||stat.size!==body.length)
        throw fault('PROTEUS_SPEC_CHANGED','The retained native specification member changed',{path});
      const retained=await existing.readFile();
      if(!retained.equals(body))
        throw fault('PROTEUS_SPEC_CHANGED','The retained native specification bytes changed',{path});
    } catch(error) {
      if(error.code==='ELOOP')throw fault('PROTEUS_SPEC_CHANGED','The retained native specification is a symbolic link',{path});
      throw error;
    } finally {if(existing)await existing.close();}
    return;
  }
  try {await handle.writeFile(body);await handle.sync();} finally {await handle.close();}
}

async function boundedBody(response,maxBytes) {
  const chunks=[];let bytes=0;
  for await(const chunk of response.body??[]){
    bytes+=chunk.length;
    if(bytes>maxBytes)throw fault('PROTEUS_RESPONSE_LIMIT','Native response exceeded the selected byte limit');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// For an existing, explicitly selected Rosetta environment. The runtime file
// records that environment's installed plugin/version evidence; this function
// never infers a CIIM Core route or probes a deployment.
export function createEndpointTransform({endpoint,runtime,headers={},timeoutMs=120000,maxBytes=MAX}) {
  const url=new URL(endpoint);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash||
     !url.pathname.endsWith('/proteus/transform'))
    throw fault('PROTEUS_ENDPOINT','Supply the documented /proteus/transform endpoint');
  if(!object(runtime)||runtime.kind!=='rosetta-proteus-endpoint'||runtime.endpoint!==url.href||
     typeof runtime.reference!=='string'||!runtime.reference.trim())
    throw fault('PROTEUS_RUNTIME_REFERENCE','Bind the selected installed runtime to its original deployment reference');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX||
     !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)
    throw fault('PROTEUS_TRANSPORT_LIMIT','Invalid native transport limit');
  const transform=async(spec,input,{config})=>{
    const requestBody=Buffer.from(JSON.stringify({spec,input,config}),'utf8');
    const response=await fetch(url,{method:'POST',redirect:'error',
      headers:{'content-type':'application/json','accept':'application/json',...headers},
      body:requestBody,signal:AbortSignal.timeout(timeoutMs)});
    const body=await boundedBody(response,maxBytes);
    if(!response.ok){
      const error=fault('PROTEUS_HTTP','The selected native Proteus endpoint returned HTTP '+response.status,
        {status:response.status,bodySha256:sha(body),bodyBytes:body.length,requestSha256:sha(requestBody)});
      error.nativeBody=body;throw error;
    }
    try { json(body); } catch {
      const error=fault('PROTEUS_RESPONSE_JSON','The selected native endpoint returned an invalid JSON result',{
        status:response.status,bodySha256:sha(body),bodyBytes:body.length,requestSha256:sha(requestBody)
      });
      error.nativeBody=body;throw error;
    }
    return {body,runtime:transform.runtime,transport:{
      status:response.status,requestSha256:sha(requestBody),responseSha256:sha(body),
      contentType:response.headers.get('content-type')
    }};
  };
  transform.runtime=structuredClone(runtime);
  transform.close=async()=>{};
  return transform;
}

// One original JVM receives sequential {specFile,input,config} requests. It
// returns its actual ObjectMapper bytes as base64, avoiding another JSON
// serialization of the native transformed result in the controller.
export async function openJavaTransform({runtimeFile,workDirectory,java='/usr/bin/java',
  runner=new URL('./ProteusBatch.java',import.meta.url),timeoutMs=120000,maxBytes=MAX,heapMiB=128}) {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX||
     !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)
    throw fault('PROTEUS_TRANSPORT_LIMIT','Invalid native transport limit');
  const manifestPath=await realpath(resolve(runtimeFile));
  const manifestBytes=await readFile(manifestPath),manifest=json(manifestBytes);
  if(manifest.schema!=='tjl.proteus.runtime.v1'||manifest.engine?.groupId!=='com.k-int.proteus'||
     manifest.engine?.artifactId!=='proteus-core'||manifest.engine?.version!=='3.0.0'||
     !Array.isArray(manifest.classpath)||manifest.classpath.length<1||!object(manifest.classes))
    throw fault('PROTEUS_RUNTIME_MANIFEST','Use the original Proteus 3.0.0 artifact manifest');
  const paths=[],artifacts=[];
  for(const item of manifest.classpath){
    if(typeof item.file!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256??'')||
       !Number.isSafeInteger(item.bytes)||item.bytes<1)throw fault('PROTEUS_ARTIFACT_MANIFEST','Every runtime member needs its original hash and length');
    const path=await realpath(resolve(dirname(manifestPath),item.file));
    const body=await readFile(path);
    if(body.length!==item.bytes||sha(body)!==item.sha256)throw fault('PROTEUS_ARTIFACT_CHANGED',item.file);
    paths.push(path);artifacts.push({file:item.file,bytes:item.bytes,sha256:item.sha256,coordinate:item.coordinate??null});
  }
  for(const key of ['componentSpec','context','input','config']){
    if(typeof manifest.classes[key]!=='string'||!/^([A-Za-z_$][A-Za-z0-9_$]*\.)+[A-Za-z_$][A-Za-z0-9_$]*$/.test(manifest.classes[key]))
      throw fault('PROTEUS_CLASS_BINDING','Use class names read from the original Proteus artifact',{key});
  }
  if(!isAbsolute(java)||!Number.isInteger(heapMiB)||heapMiB<64||heapMiB>1024)
    throw fault('JAVA_RUNTIME_OPTIONS','Use an absolute existing Java executable and an explicit heap');
  workDirectory=resolve(workDirectory);await mkdir(workDirectory,{recursive:true,mode:0o700});
  workDirectory=await realpath(workDirectory);
  const runnerFile=await realpath(runner instanceof URL?fileURLToPath(runner):resolve(runner));
  const runnerBytes=await readFile(runnerFile);
  const runtime={
    kind:'proteus-core-jvm',engine:manifest.engine,
    artifactManifestSha256:sha(manifestBytes),artifacts,
    classes:manifest.classes,runnerSha256:sha(runnerBytes),
    source:manifest.source,configuration:manifest.configuration
  };
  if(!object(runtime.configuration))throw fault('PROTEUS_CONFIG_BINDING','Retain the original Config implementation and selected settings');
  const options=Buffer.from(JSON.stringify({classes:manifest.classes,runtime,configuration:manifest.configuration,workDirectory})).toString('base64');
  const args=['-Xms16m','-Xmx'+heapMiB+'m','-Djava.io.tmpdir='+workDirectory,
    '--class-path',paths.join(':'),'--source','17',runnerFile,options];
  const child=spawn(java,args,{stdio:['pipe','pipe','pipe'],env:process.env});
  let buffer=Buffer.alloc(0),errorText='',closed=false,closing=false,closePromise=null,processExited=false,readyResolve,readyReject,active=null;
  const childExit=new Promise(resolveExit=>child.once('close',(code,signal)=>{processExited=true;resolveExit({code,signal});}));
  const ready=new Promise((yes,no)=>{readyResolve=yes;readyReject=no;});
  let readyDone=false;
  function rejectAll(error){
    if(closed)return;
    closed=true;
    if(!readyDone)readyReject(error);
    if(active){clearTimeout(active.timer);active.reject(error);active=null;}
  }
  child.stderr.on('data',chunk=>{if(errorText.length<32768)errorText+=chunk.toString('utf8').slice(0,32768-errorText.length);});
  child.on('error',rejectAll);
  child.stdin.on('error',rejectAll);
  child.on('close',(code,signal)=>rejectAll(fault('PROTEUS_JVM_EXIT','Original JVM closed',{code,signal,stderr:errorText})));
  child.stdout.on('data',chunk=>{
    if(closed)return;
    buffer=Buffer.concat([buffer,chunk]);
    if(buffer.length>Math.ceil(maxBytes*4/3)+1024*1024){
      child.kill();rejectAll(fault('PROTEUS_RESPONSE_LIMIT','Native result exceeded the receiving limit'));return;
    }
    let end;
    while((end=buffer.indexOf(10))>=0){
      const line=buffer.subarray(0,end);buffer=buffer.subarray(end+1);
      let message;
      try{message=json(line);}catch{child.kill();rejectAll(fault('PROTEUS_JVM_PROTOCOL','The original runner returned invalid JSON'));return;}
      if(message.type==='ready'){
        if(readyDone||!isDeepStrictEqual(message.runtime,runtime)){
          child.kill();rejectAll(fault('PROTEUS_RUNTIME_CHANGED','Native runner did not bind the selected runtime'));return;
        }
        if(!object(message.execution)||!Number.isInteger(message.execution.javaFeature)||
           message.execution.javaFeature<17||typeof message.execution.javaVersion!=='string'||
           message.execution.objectMapperClass!=='com.k_int.proteus.serialization.ProteusMapper'||
           !isDeepStrictEqual(message.execution.configuration,runtime.configuration)){
          child.kill();rejectAll(fault('PROTEUS_EXECUTION_BINDING','Native Java settings did not match the selected runtime'));return;
        }
        runtime.execution=message.execution;
        readyDone=true;readyResolve();continue;
      }
      if(!active||message.id!==active.id){child.kill();rejectAll(fault('PROTEUS_JVM_PROTOCOL','Native result does not match the active request'));return;}
      const request=active;active=null;clearTimeout(request.timer);
      if(message.type==='error'){
        request.reject(fault('PROTEUS_NATIVE_TRANSFORM',message.message??'Native Proteus transform failed',
          {nativeClass:message.errorClass,stderr:errorText}));continue;
      }
      try{
        if(message.type!=='result'||typeof message.bodyBase64!=='string')throw fault('PROTEUS_JVM_PROTOCOL','Missing native result bytes');
        const body=Buffer.from(message.bodyBase64,'base64');
        if(body.length>maxBytes||body.length!==message.bytes||sha(body)!==message.sha256||
           body.toString('base64')!==message.bodyBase64)throw fault('PROTEUS_NATIVE_BYTES','The native result bytes changed in transport');
        json(body);request.resolve({body,runtime,transport:{nativeSha256:message.sha256,bytes:message.bytes}});
      }catch(error){request.reject(error);}
    }
  });
  async function finishOwnedChild() {
    if(processExited)return;
    const terminate=setTimeout(()=>{if(!processExited)child.kill('SIGTERM');},3000);
    const force=setTimeout(()=>{if(!processExited)child.kill('SIGKILL');},6000);
    try {await childExit;} finally {clearTimeout(terminate);clearTimeout(force);}
  }
  const startTimer=setTimeout(()=>{child.kill();rejectAll(fault('PROTEUS_JVM_START_TIMEOUT','The original JVM did not start within the selected interval',{stderr:errorText}));},timeoutMs);
  try{await ready;}catch(error){child.kill('SIGTERM');await finishOwnedChild();throw error;}finally{clearTimeout(startTimer);}
  const specs=new Map();let serial=Promise.resolve();
  const transform=(spec,input,{config})=>{
    if(closing)return Promise.reject(fault('PROTEUS_JVM_CLOSING','The native runtime is closing; accepted requests are being drained'));
    const run=async()=>{
      if(closed)throw fault('PROTEUS_JVM_CLOSED','Reopen the same native operation to continue');
      const content=Buffer.from(JSON.stringify(spec)+'\n'),identity=sha(content);
      let path=specs.get(identity);
      if(!path){
        path=join(workDirectory,identity+'.spec.json');
        await retainSpecification(path,content);
        specs.set(identity,path);
      }
      return new Promise((resolveResult,reject)=>{
        const id=randomUUID();
        const timer=setTimeout(()=>{child.kill();rejectAll(fault('PROTEUS_NATIVE_TIMEOUT','The original native transform exceeded the selected interval',{id}));},timeoutMs);
        active={id,timer,resolve:resolveResult,reject};
        const body=JSON.stringify({id,specFile:path,specSha256:identity,input,config})+'\n';
        child.stdin.write(body,error=>{if(error){child.kill();rejectAll(error);}});
      });
    };
    const result=serial.then(run);serial=result.catch(()=>{});
    return result;
  };
  transform.runtime=runtime;
  transform.close=()=>{
    if(closePromise)return closePromise;
    closing=true;
    closePromise=(async()=>{
      await serial;
      if(!processExited){
        child.stdin.end();
        await finishOwnedChild();
      }
      closed=true;
    })();
    return closePromise;
  };
  return transform;
}
