// MIT. Original Martin serving with explicit named-source refresh and drained stop.
import {spawn} from 'node:child_process';
import {createServer as createNetServer} from 'node:net';
import {request as httpRequest} from 'node:http';
import {open,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {gunzipSync,brotliDecompressSync,inflateSync} from 'node:zlib';
import {privateDirectory,readJson,readBytes} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {need,digest,hash,clone,timestamp} from './model.mjs';
import {retainJson,verifyFiles,MAX_METADATA_BYTES} from './files.mjs';
import {readRuntime,runNative,acquireNativeLease} from './native.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){
  const server=createNetServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return port;
}
export function martinRequest(origin,path,{signal,maxBytes=33554432,timeoutMs=30000}={}){
  const base=new URL(origin);
  need(base.protocol==='http:'&&base.hostname==='127.0.0.1'&&/^\d+$/.test(base.port)&&typeof path==='string'&&
    path.startsWith('/')&&!/[\r\n]/.test(path),'PMTILES_MARTIN_LOOPBACK_REQUIRED');
  return new Promise((resolve,reject)=>{
    let bytes=0,settled=false;const chunks=[];
    const request=httpRequest({hostname:'127.0.0.1',port:Number(base.port),method:'GET',path,
      headers:{accept:'*/*','accept-encoding':'identity'},signal},response=>{
      response.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)request.destroy(Object.assign(new Error('Native response exceeds its selected limit.'),{code:'PMTILES_NATIVE_RESPONSE_TOO_LARGE'}));else chunks.push(chunk);});
      response.once('error',reject);
      response.once('end',()=>{settled=true;resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)});});
    });
    request.setTimeout(timeoutMs,()=>request.destroy(Object.assign(new Error('Native Martin response timed out.'),{code:'PMTILES_MARTIN_RESPONSE_TIMEOUT'})));
    request.once('error',reject);request.end();
  });
}
export async function startMartin({workspace,runtime,releaseId,signal,onProgress}){
  runtime=await readRuntime(runtime);
  const release=workspace.getRelease(releaseId),releaseDirectory=workspace.releaseDirectory(releaseId);
  need(release.runtimeSha256===runtime.runtimeSha256,'PMTILES_RELEASE_RUNTIME_CHANGED');
  await verifyFiles(releaseDirectory,release.files,{signal});
  const prepared=await readJson(join(releaseDirectory,'prepared-style.json'),MAX_METADATA_BYTES);
  const review=await readJson(join(releaseDirectory,'review.json'),MAX_METADATA_BYTES);
  const scope=await acquireNativeLease(join(workspace.directory,'locks'),'workspace-files',{shared:true});
  let owner,child,stdout,stderr,ended,timeout,stopTimer,finished=false,writeQueue=Promise.resolve(),outputBytes=0,record;
  const session='martin-'+randomUUID().replaceAll('-','');
  const directory=join(workspace.directory,'native',session);
  let closed=null,childError=null;
  const stop=async reason=>{
    if(closed)return closed;
    closed=(async()=>{
      let outcome=null;
      try{
        if(child&&child.exitCode===null&&child.signalCode===null){
          child.kill('SIGTERM');stopTimer=setTimeout(()=>child.kill('SIGKILL'),5000);
        }
        outcome=ended?await ended:null;await writeQueue;
        if(stdout)await stdout.sync();if(stderr)await stderr.sync();
        if(record)await retainJson(join(directory,'ended.json'),{schema:'starforge.pmtiles-martin-ended.v1',
          selectionSha256:digest(record),reason,outcome,error:childError?{code:childError.code??'PMTILES_MARTIN_FAILED',message:String(childError.message)}:null,
          endedAt:timestamp()});
        return outcome;
      }finally{
        clearTimeout(stopTimer);clearTimeout(timeout);signal?.removeEventListener('abort',abort);
        await Promise.allSettled([stdout?.close(),stderr?.close()]);stdout=null;stderr=null;
        try{await owner?.close();}finally{await scope.close();finished=true;}
      }
    })();
    return closed;
  };
  const abort=()=>{stop('OWNER_ABORTED').catch(()=>{});};
  try{
    owner=await acquireNativeLease(join(workspace.directory,'locks'),'martin-server');
    await privateDirectory(directory);
    const version=await runNative(join(directory,'version'),[runtime.martinExecutable.path,'--version'],
      {signal,leaseFd:owner.fd,leaseFds:[scope.fd],timeoutMs:15000});
    const actualVersion=(await readBytes(join(directory,'version',version.stdout.path),1048576)).toString('utf8').trim();
    need(actualVersion===runtime.martinVersion,'PMTILES_MARTIN_VERSION_CHANGED');
    const pythonResult=await runNative(join(directory,'python-host'),[runtime.pythonExecutable.path,'-I','-c',
      'import ctypes,os,sys; assert sys.platform=="linux"; assert sys.version_info >= (3,11); print(sys.version)'],
      {signal,leaseFd:owner.fd,leaseFds:[scope.fd],timeoutMs:15000});
    const pythonVersion=(await readBytes(join(directory,'python-host',pythonResult.stdout.path),1048576)).toString('utf8').trim();
    const port=await freePort();
    const config={listen_addresses:'127.0.0.1:'+port,workers:1,convert_to_mlt:'disabled',convert_to_mvt:'disabled',pmtiles:{sources:Object.fromEntries(prepared.sources.map(row=>
      [row.nativeId,join(releaseDirectory,'files',row.sha256)]))}};
    const configBytes=await retainJson(join(directory,'martin.json'),config);
    const command=[runtime.pythonExecutable.path,'-I',runtime.processLauncher.path,String(process.pid),
      runtime.martinExecutable.path,'--config',join(directory,'martin.json')];
    record={schema:'starforge.pmtiles-martin-selection.v1',session,workspaceId:workspace.state().id,
      releaseId:release.id,manifestSha256:release.manifestSha256,runtimeSha256:runtime.runtimeSha256,port,
      config:configBytes,command,sourceMode:'NAMED_STARTUP_SNAPSHOT',parentPid:process.pid,
      pythonHost:{contract:runtime.pythonHostContract,executable:clone(runtime.pythonExecutable),version:pythonVersion,result:pythonResult},createdAt:timestamp()};
    await retainJson(join(directory,'selection.json'),record);
    stdout=await open(join(directory,'stdout.txt'),'wx',0o600);stderr=await open(join(directory,'stderr.txt'),'wx',0o600);
    signal?.throwIfAborted();
    child=spawn(command[0],command.slice(1),{cwd:directory,shell:false,
      stdio:['ignore','pipe','pipe',owner.fd,scope.fd],env:{...process.env}});
    ended=new Promise(resolve=>child.once('close',(exitCode,exitSignal)=>resolve({exitCode,exitSignal})));
    ended.then(()=>{if(!closed)stop('NATIVE_ENDED').catch(()=>{});});
    const append=(handle,data,stream)=>{
      outputBytes+=data.length;
      if(outputBytes>8388608){childError=Object.assign(new Error('Native Martin output exceeds eight MiB.'),{code:'PMTILES_NATIVE_OUTPUT_LIMIT'});stop('OUTPUT_LIMIT').catch(()=>{});return;}
      writeQueue=writeQueue.then(()=>handle.writeFile(data)).catch(error=>{childError=error;queueMicrotask(()=>stop('OUTPUT_WRITE_FAILED').catch(()=>{}));});
      onProgress?.({stream,bytes:data.length});
    };
    child.stdout.on('data',data=>append(stdout,data,'stdout'));child.stderr.on('data',data=>append(stderr,data,'stderr'));
    child.on('error',error=>{childError=error;});
    signal?.addEventListener('abort',abort,{once:true});
    await retainJson(join(directory,'process.json'),{pid:child.pid??null,parentPid:process.pid,
      bootId:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),startedAt:timestamp(),selectionSha256:digest(record)});
    const origin='http://127.0.0.1:'+port,deadline=Date.now()+20000;let catalog;
    while(Date.now()<deadline){
      signal?.throwIfAborted();
      need(child.exitCode===null&&child.signalCode===null&&!childError,'PMTILES_MARTIN_ENDED_BEFORE_READY');
      try{
        const response=await martinRequest(origin,'/catalog',{signal,maxBytes:4194304,timeoutMs:1500});
        if(response.status===200){
          const value=JSON.parse(response.body.toString('utf8'));
          if(prepared.sources.every(row=>value.tiles&&Object.hasOwn(value.tiles,row.nativeId))){
            catalog={status:response.status,headers:response.headers,bytes:response.body.length,
              sha256:hash(response.body),document:value};break;
          }
        }
      }catch(error){if(signal?.aborted)throw error;}
      await sleep(100);
    }
    need(catalog,'PMTILES_MARTIN_SOURCE_READINESS_FAILED','Open the original native Martin output for its selected named sources.');
    const health=await martinRequest(origin,'/health',{signal,maxBytes:65536,timeoutMs:5000});
    need(health.status===200,'PMTILES_MARTIN_HEALTH_FAILED');
    const sources=[];
    for(const row of prepared.sources){
      if(sources.some(saved=>saved.nativeId===row.nativeId))continue;
      const inspection=review.inspection.inspections.find(saved=>saved.resourceSha256===row.sha256);
      need(inspection?.sample?.available&&inspection.sample.sha256,'PMTILES_KNOWN_SOURCE_TILE_REQUIRED');
      const tilejson=await martinRequest(origin,'/'+row.nativeId,{signal,maxBytes:1048576,timeoutMs:10000});
      need(tilejson.status===200,'PMTILES_MARTIN_TILEJSON_UNAVAILABLE');
      const document=JSON.parse(tilejson.body.toString('utf8')),sample=inspection.sample;
      const target='/'+row.nativeId+'/'+sample.z+'/'+sample.x+'/'+sample.y;
      need(Array.isArray(document.tiles)&&document.tiles.length>0&&document.tiles.every(template=>{
        if(typeof template!=='string')return false;
        const u=new URL(template.replaceAll('{z}',String(sample.z)).replaceAll('{x}',String(sample.x)).replaceAll('{y}',String(sample.y)),origin);
        return u.origin===origin&&u.pathname===target&&!u.search&&!u.hash;
      }),'PMTILES_MARTIN_TILEJSON_SOURCE_CHANGED');
      need(document.minzoom===row.header.minZoom&&document.maxzoom===row.header.maxZoom,'PMTILES_MARTIN_ZOOM_CHANGED');
      const tile=await martinRequest(origin,target,{signal,maxBytes:33554432,timeoutMs:10000});
      need(tile.status===200&&tile.body.length>0,'PMTILES_MARTIN_SOURCE_TILE_UNAVAILABLE');
      const encoding=String(tile.headers['content-encoding']??'identity').toLowerCase();
      let decoded=tile.body;const options={maxOutputLength:33554432};
      if(encoding==='gzip')decoded=gunzipSync(tile.body,options);
      else if(encoding==='br')decoded=brotliDecompressSync(tile.body,options);
      else if(encoding==='deflate')decoded=inflateSync(tile.body,options);
      else need(encoding==='identity'||encoding==='','PMTILES_MARTIN_TILE_ENCODING_UNSUPPORTED');
      need(decoded.length===sample.bytes&&hash(decoded)===sample.sha256,'PMTILES_MARTIN_SOURCE_TILE_CHANGED');
      sources.push({nativeId:row.nativeId,resourceSha256:row.sha256,
        tilejson:{status:tilejson.status,headers:tilejson.headers,bytes:tilejson.body.length,sha256:hash(tilejson.body),document},
        tile:{path:target,status:tile.status,headers:tile.headers,bytes:tile.body.length,sha256:hash(tile.body),
          decodedBytes:decoded.length,decodedSha256:hash(decoded)}});
    }
    need(child.exitCode===null&&child.signalCode===null&&!childError,'PMTILES_MARTIN_ENDED_BEFORE_READY');
    await retainJson(join(directory,'ready.json'),{selectionSha256:digest(record),origin,catalog,
      health:{status:health.status,headers:health.headers,bytes:health.body.length,sha256:hash(health.body)},sources,readyAt:timestamp()});
    return Object.freeze({origin,session,releaseId:release.id,manifestSha256:release.manifestSha256,runtimeSha256:runtime.runtimeSha256,
      directory,catalog:clone(catalog),get alive(){return !closed&&!finished&&child.exitCode===null&&child.signalCode===null&&!childError;},
      request(path,options){need(!closed&&!finished,'PMTILES_MARTIN_STOPPED');return martinRequest(origin,path,options);},
      close:()=>stop('OPERATOR_STOPPED')});
  }catch(error){await stop('START_FAILED');throw error;}
}
