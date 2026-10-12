// MIT. Original upstream PMTiles inspection and owned Martin process.
import {constants} from 'node:fs';
import {open,lstat,readFile,mkdir,unlink} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {privateDirectory,readJson,readBytes,writeJson,exists} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {need,plain,text,HASH,identifier,digest,hash,clone,timestamp} from './model.mjs';
import {ResourceFile,fileDescriptor,retainJson,MAX_METADATA_BYTES} from './files.mjs';

export const PYTHON_HOST_CONTRACT='linux-python-3.11-stdlib-prctl-parent-death-v1';
export async function readRuntime(profile){
  if(typeof profile==='string')profile=await readJson(resolve(profile),MAX_METADATA_BYTES);
  need(plain(profile)&&profile.schema==='starforge.pmtiles-runtime.v1','PMTILES_RUNTIME_PROFILE_REQUIRED');
  const out=clone(profile);
  for(const name of ['pmtilesExecutable','martinExecutable','pythonExecutable','processLauncher','nativeBundle','previewScript','previewCss','previewWorker']){
    const row=out[name];need(plain(row)&&isAbsolute(row.path)&&HASH.test(row.sha256??'')&&Number.isSafeInteger(row.bytes)&&row.bytes>0,
      'PMTILES_RUNTIME_FILE_REQUIRED',name);
    const observed=await fileDescriptor(row.path,{limit:268435456});
    need(observed.bytes===row.bytes&&observed.sha256===row.sha256,'PMTILES_RUNTIME_FILE_CHANGED',name);
  }
  need(typeof out.pmtilesVersion==='string'&&typeof out.martinVersion==='string'&&plain(out.packages),
    'PMTILES_ORIGINAL_RUNTIME_VERSIONS_REQUIRED');
  need(out.pythonHostContract===PYTHON_HOST_CONTRACT,'PMTILES_PYTHON_HOST_CONTRACT_CHANGED');
  const identity={schema:out.schema,pmtilesVersion:out.pmtilesVersion,martinVersion:out.martinVersion,packages:out.packages,pythonHostContract:out.pythonHostContract};
  for(const name of ['pmtilesExecutable','martinExecutable','pythonExecutable','processLauncher','nativeBundle','previewScript','previewCss','previewWorker'])
    if(name!=='pythonExecutable')identity[name]={bytes:out[name].bytes,sha256:out[name].sha256};
  out.runtimeSha256=digest(identity);return out;
}
export async function loadNativeLibrary(runtime){
  const raw=await readBytes(runtime.nativeBundle.path,268435456);
  need(raw.length===runtime.nativeBundle.bytes&&hash(raw)===runtime.nativeBundle.sha256,'PMTILES_RUNTIME_FILE_CHANGED');
  const native={exports:{}},require=createRequire(pathToFileURL(runtime.nativeBundle.path));
  new Function('module','exports','require','__filename','__dirname',raw.toString('utf8'))(
    native,native.exports,require,runtime.nativeBundle.path,dirname(runtime.nativeBundle.path));
  need(typeof native.exports.PMTiles==='function'&&typeof native.exports.validateStyle==='function'&&
    plain(native.exports.versions)&&digest(native.exports.versions)===digest(runtime.packages),'PMTILES_NATIVE_BUNDLE_ABI_CHANGED');
  return native.exports;
}
export async function acquireNativeLease(directory,operationId,{shared=false}={}){
  identifier(operationId);await privateDirectory(directory);
  const path=join(directory,operationId+'.lock');
  const file=await open(path,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
  try{
    const [info,named]=await Promise.all([file.stat(),lstat(path)]);
    need(info.isFile()&&info.nlink===1&&(info.mode&0o077)===0&&!named.isSymbolicLink()&&
      info.dev===named.dev&&info.ino===named.ino,'PMTILES_NATIVE_LEASE_CHANGED');
    const lock=spawnSync('flock',[shared?'--shared':'--exclusive','--nonblock','--conflict-exit-code','73','3'],
      {stdio:['ignore','pipe','pipe',file.fd],timeout:10000});
    need(!lock.error&&lock.status===0,lock.status===73?'PMTILES_OPERATION_ACTIVE':'PMTILES_LINUX_FLOCK_REQUIRED');
    let closed=false;
    return {fd:file.fd,async close(){if(!closed){closed=true;await file.close();}}};
  }catch(error){await file.close();throw error;}
}
export async function withNativeLease(directory,operationId,work,options={}){
  const lease=await acquireNativeLease(directory,operationId,options);
  try{return await work(lease.fd);}finally{await lease.close();}
}
export async function runNative(directory,command,{signal,leaseFd,leaseFds=[],timeoutMs=300000,onProgress}={}){
  need(Array.isArray(command)&&command.length>0&&command.every(x=>typeof x==='string'&&!x.includes('\0'))&&isAbsolute(command[0]),
    'PMTILES_NATIVE_COMMAND_INVALID');
  await privateDirectory(directory);
  const request={schema:'starforge.pmtiles-native-request.v1',command:[...command],timeoutMs};
  await retainJson(join(directory,'request.json'),request);
  if(await exists(join(directory,'result.json'))){
    const result=await readJson(join(directory,'result.json'),MAX_METADATA_BYTES);
    need(result.requestSha256===digest(request),'PMTILES_NATIVE_REQUEST_CHANGED');
    if(result.exitCode===0&&!result.cancelled&&!result.timedOut&&!result.error)return result;
    need(false,'PMTILES_ORIGINAL_NATIVE_FAILED','The original command ended with exit '+result.exitCode+'; open its retained output and use a new inspection request after correcting the source.');
  }
  const attempt='attempt-'+(await import('node:crypto')).randomUUID();
  const attemptRoot=join(directory,attempt);await privateDirectory(attemptRoot);
  const stdout=await open(join(attemptRoot,'stdout.txt'),'wx',0o600);
  let stderr;
  try{stderr=await open(join(attemptRoot,'stderr.txt'),'wx',0o600);}catch(error){await stdout.close();throw error;}
  let child,stopTimer,timeout,writeQueue=Promise.resolve(),bytesOut=0,bytesErr=0,processError=null,timedOut=false;
  const startedAt=timestamp();
  try{
    signal?.throwIfAborted();
    child=spawn(command[0],command.slice(1),{cwd:directory,stdio:['ignore','pipe','pipe',...[...new Set([...(leaseFd===undefined?[]:[leaseFd]),...leaseFds])]],
      shell:false,windowsHide:true,env:{...process.env}});
    const stop=()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');stopTimer??=setTimeout(()=>child.kill('SIGKILL'),5000);}};
    signal?.addEventListener('abort',stop,{once:true});timeout=setTimeout(()=>{timedOut=true;stop();},timeoutMs);
    const append=(handle,data,which)=>{writeQueue=writeQueue.then(async()=>{
      if(which==='stdout')bytesOut+=data.length;else bytesErr+=data.length;
      if(bytesOut+bytesErr>8388608){processError=Object.assign(new Error('Native output exceeds eight MiB.'),{code:'PMTILES_NATIVE_OUTPUT_LIMIT'});stop();return;}
      await handle.writeFile(data);onProgress?.({stream:which,bytes:data.length});
    }).catch(error=>{processError=error;stop();});};
    child.stdout.on('data',data=>append(stdout,data,'stdout'));child.stderr.on('data',data=>append(stderr,data,'stderr'));
    child.on('error',error=>{processError=error;});
    const completed=new Promise(resolve=>child.once('close',(exitCode,exitSignal)=>resolve({exitCode,exitSignal})));
    try{await retainJson(join(attemptRoot,'process.json'),{pid:child.pid??null,startedAt,requestSha256:digest(request)});}
    catch(error){processError=error;stop();}
    const ended=await completed;await writeQueue;clearTimeout(timeout);clearTimeout(stopTimer);signal?.removeEventListener('abort',stop);
    await stdout.sync();await stderr.sync();
    const result={schema:'starforge.pmtiles-native-result.v1',requestSha256:digest(request),command:[...command],
      startedAt,endedAt:timestamp(),attempt,...ended,stdout:{path:attempt+'/stdout.txt',bytes:bytesOut},stderr:{path:attempt+'/stderr.txt',bytes:bytesErr},
      cancelled:Boolean(signal?.aborted),timedOut,error:processError?{code:processError.code??'PMTILES_NATIVE_ERROR',message:String(processError.message)}:null};
    if(processError&&result.exitCode===0)result.exitCode=null;
    await retainJson(join(directory,'result.json'),result);
    need(result.exitCode===0&&!result.cancelled&&!result.timedOut&&!result.error,'PMTILES_NATIVE_FAILED','Open the retained native command result: '+directory);
    return result;
  }finally{
    clearTimeout(timeout);clearTimeout(stopTimer);
    await stdout.close();await stderr.close();
  }
}
class OriginalFileSource{
  constructor(file,record){this.file=file;this.record=record;}
  getKey(){return 'sha256:'+this.record.sha256;}
  async getBytes(offset,length,signal){
    signal?.throwIfAborted();
    need(Number.isSafeInteger(offset)&&Number.isSafeInteger(length)&&offset>=0&&length>0&&
      offset<this.record.bytes&&length<=67108864,'PMTILES_NATIVE_RANGE_INVALID');
    length=Math.min(length,this.record.bytes-offset);
    const buffer=Buffer.alloc(length);let position=0;
    while(position<length){const r=await this.file.read(buffer,position,length-position,offset+position);
      need(r.bytesRead>0,'PMTILES_ARCHIVE_READ_CHANGED');position+=r.bytesRead;}
    return {data:buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),etag:this.record.sha256};
  }
}
export async function inspectResource({directory,resource,runtime,operationId,signal,onProgress,parentLeaseFd}){
  runtime=await readRuntime(runtime);identifier(operationId);
  const root=join(resolve(directory),'native',operationId);
  return withNativeLease(join(resolve(directory),'locks'),'inspect-'+digest(operationId).slice(0,32),async leaseFd=>{
    await privateDirectory(root);
    const selected={schema:'starforge.pmtiles-inspection-input.v1',operationId,resourceId:resource.id,
      bytes:resource.bytes,sha256:resource.sha256,runtimeSha256:runtime.runtimeSha256};
    await retainJson(join(root,'selection.json'),selected);
    const original=new ResourceFile(directory,resource);await original.verify({signal});
    if(await exists(join(root,'inspection.json'))){
      const result=await readJson(join(root,'inspection.json'),MAX_METADATA_BYTES);
      need(result.selectionSha256===digest(selected),'PMTILES_INSPECTION_INPUT_CHANGED');return result;
    }
    const version=await runNative(join(root,'pmtiles-version'),[runtime.pmtilesExecutable.path,'version'],{signal,leaseFd,leaseFds:parentLeaseFd===undefined?[]:[parentLeaseFd],timeoutMs:15000});
    const actualVersion=(await readBytes(join(root,'pmtiles-version',version.stdout.path),1048576)).toString('utf8').trim();
    need(actualVersion===runtime.pmtilesVersion,'PMTILES_EXECUTABLE_VERSION_CHANGED');
    const nativeVerify=await runNative(join(root,'verify'),[runtime.pmtilesExecutable.path,'verify',original.path],{signal,leaseFd,leaseFds:parentLeaseFd===undefined?[]:[parentLeaseFd],onProgress});
    const verifyStdout=await readBytes(join(root,'verify',nativeVerify.stdout.path),8388608);
    const verifyStderr=await readBytes(join(root,'verify',nativeVerify.stderr.path),8388608);
    need(!/\binvalid\b/i.test(verifyStdout.toString('utf8')+'\n'+verifyStderr.toString('utf8')),
      'PMTILES_NATIVE_VERIFIER_REJECTED','The original verifier reported an invalid archive; open its complete retained diagnostics.');
    const verifierDiagnostics={stdout:{...nativeVerify.stdout,sha256:hash(verifyStdout)},
      stderr:{...nativeVerify.stderr,sha256:hash(verifyStderr)},invalidDiagnostic:false};
    const library=await loadNativeLibrary(runtime),file=await open(original.path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const before=await file.stat({bigint:true});
      const archive=new library.PMTiles(new OriginalFileSource(file,resource));
      const header=await archive.getHeader();
      need(header.specVersion===3,'PMTILES_VERSION_THREE_REQUIRED');
      const ranges=[];
      for(const [offsetKey,lengthKey] of [['rootDirectoryOffset','rootDirectoryLength'],['jsonMetadataOffset','jsonMetadataLength'],
        ['leafDirectoryOffset','leafDirectoryLength'],['tileDataOffset','tileDataLength']]){
        const offset=header[offsetKey],length=header[lengthKey];
        need(Number.isSafeInteger(offset)&&Number.isSafeInteger(length)&&offset>=0&&length>=0&&
          offset+length<=resource.bytes,'PMTILES_ARCHIVE_SECTION_OUTSIDE_FILE',offsetKey);
        if(length>0){need(offset>=127,'PMTILES_ARCHIVE_SECTION_OVERLAPS_HEADER',offsetKey);ranges.push({offset,length,field:offsetKey});}
      }
      need(header.rootDirectoryLength>0&&header.rootDirectoryOffset+header.rootDirectoryLength<=16384,
        'PMTILES_ROOT_DIRECTORY_OUTSIDE_HEADER_RANGE');
      ranges.sort((a,b)=>a.offset-b.offset);
      for(let i=1;i<ranges.length;i++)need(ranges[i-1].offset+ranges[i-1].length<=ranges[i].offset,
        'PMTILES_ARCHIVE_SECTIONS_OVERLAP');
      need([header.minLon,header.maxLon,header.centerLon,header.minLat,header.maxLat,header.centerLat].every(Number.isFinite)&&
        header.minLon>=-180&&header.maxLon<=180&&header.minLon<=header.maxLon&&header.minLat>=-90&&header.maxLat<=90&&
        header.minLat<=header.maxLat,'PMTILES_ARCHIVE_BOUNDS_INVALID');
      need([header.minZoom,header.maxZoom,header.centerZoom].every(Number.isSafeInteger)&&header.minZoom>=0&&header.maxZoom<=26&&header.minZoom<=header.maxZoom&&header.centerZoom>=0&&header.centerZoom<=26&&header.centerLon>=-180&&header.centerLon<=180&&header.centerLat>=-90&&header.centerLat<=90,'PMTILES_ARCHIVE_ZOOM_OR_CENTER_INVALID');
      const metadata=await archive.getMetadata();
      const z=Math.min(header.maxZoom,Math.max(header.minZoom,header.centerZoom));
      const n=2**z,lon=header.centerLon,lat=Math.max(-85.05112878,Math.min(85.05112878,header.centerLat));
      const x=Math.min(n-1,Math.max(0,Math.floor((lon+180)/360*n)));
      const y=Math.min(n-1,Math.max(0,Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n)));
      let coordinate={z,x,y},tile=await archive.getZxy(z,x,y,signal);
      if(!tile?.data?.byteLength){
        need(typeof library.tileIdToZxy==='function','PMTILES_NATIVE_DIRECTORY_ABI_CHANGED');
        const visited=new Set();let directories=0;
        async function firstPresent(offset,length,depth){
          signal?.throwIfAborted();
          need(depth<=3&&++directories<=100000,'PMTILES_DIRECTORY_DEPTH_OR_COUNT_LIMIT');
          const key=offset+':'+length;need(!visited.has(key),'PMTILES_DIRECTORY_CYCLE');visited.add(key);
          need(Number.isSafeInteger(offset)&&Number.isSafeInteger(length)&&offset>=127&&length>0&&offset+length<=resource.bytes,'PMTILES_DIRECTORY_OUTSIDE_ARCHIVE');
          const entries=await archive.cache.getDirectory(archive.source,offset,length,header,signal);
          for(const entry of entries){
            need(Number.isSafeInteger(entry.tileId)&&entry.tileId>=0&&Number.isSafeInteger(entry.offset)&&entry.offset>=0&&
              Number.isSafeInteger(entry.length)&&entry.length>0&&Number.isSafeInteger(entry.runLength)&&entry.runLength>=0,'PMTILES_DIRECTORY_ENTRY_INVALID');
            if(entry.runLength>0){
              need(entry.offset+entry.length<=header.tileDataLength,'PMTILES_TILE_ENTRY_OUTSIDE_DATA');
              const [az,ax,ay]=library.tileIdToZxy(entry.tileId),found=await archive.getZxy(az,ax,ay,signal);
              need(found?.data?.byteLength>0,'PMTILES_DIRECTORY_TILE_UNAVAILABLE');return {coordinate:{z:az,x:ax,y:ay},tile:found};
            }
            need(entry.offset+entry.length<=header.leafDirectoryLength,'PMTILES_LEAF_ENTRY_OUTSIDE_DATA');
            const found=await firstPresent(header.leafDirectoryOffset+entry.offset,entry.length,depth+1);
            if(found)return found;
          }
          return null;
        }
        const found=await firstPresent(header.rootDirectoryOffset,header.rootDirectoryLength,0);
        if(found){coordinate=found.coordinate;tile=found.tile;}
      }
      need(tile?.data?.byteLength>0,'PMTILES_ARCHIVE_HAS_NO_RENDERABLE_TILE');
      const after=await file.stat({bigint:true});
      need(before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs,'PMTILES_ARCHIVE_READ_CHANGED');
      const result={schema:'starforge.pmtiles-inspection.v1',status:'COMPLETE',selectionSha256:digest(selected),
        operationId,resourceSha256:resource.sha256,bytes:resource.bytes,runtimeSha256:runtime.runtimeSha256,
        upstream:clone(runtime.packages),nativeVersion:actualVersion,nativeVerify,verifierDiagnostics,sectionRanges:ranges,
        header:clone(header),metadata:clone(metadata),sample:{...coordinate,available:Boolean(tile),
          bytes:tile?.data?.byteLength??0,sha256:tile?.data?hash(Buffer.from(tile.data)):null},
        completedAt:timestamp()};
      need(header.specVersion===3,'PMTILES_VERSION_THREE_REQUIRED');
      await retainJson(join(root,'inspection.json'),result);return result;
    }finally{await file.close();}
  });
}
export async function validateNativeStyle(runtime,style){
  runtime=await readRuntime(runtime);const library=await loadNativeLibrary(runtime);
  const errors=library.validateStyle(style);
  need(Array.isArray(errors),'PMTILES_STYLE_VALIDATOR_ABI_CHANGED');
  return {runtimeSha256:runtime.runtimeSha256,errors:errors.map(e=>({message:String(e.message??e),line:e.line??null})),
    valid:errors.length===0};
}
