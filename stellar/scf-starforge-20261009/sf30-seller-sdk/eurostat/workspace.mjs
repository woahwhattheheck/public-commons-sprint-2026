// MIT. One saved Eurostat project and the original publisher lease.
import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { bytes, digest, identity, absolute, privateDirectory, readJson, readPrivate, createFile,
  atomicJson, syncDirectory, stamp } from '../postgres/publisher/files.mjs';
import { openEurostatPublisher } from './publisher.mjs';
import { EUROSTAT_SOURCE_SCHEMA, object, need, fault, normalizeQuery, pageCube, compareCubes } from './model.mjs';
import { createEurostatBriefing } from './report.mjs';
import { HASH, officialUrl, buildSourceUrl, retainCapture, readSource, readCapture, acquireResponse } from './source.mjs';
const PROJECT='stellar-forge.eurostat-project.v1',PACKET='stellar-forge.eurostat-source-handover.v1';
const operationId=value=>{need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value),'EUROSTAT_OPERATION_ID');return value;};
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
export async function openEurostatWorkspace({directory,create=false,targetDirectory,seller=null,resource=null,environment=process.env,
  fetchImpl=fetch}={}) {
  directory=absolute(directory,'Eurostat project directory');await privateDirectory(directory,create);
  const settingsFile=join(directory,'project.json'),sourceFile=join(directory,'source.json');
  if(!await exists(settingsFile)){
    need(create,'EUROSTAT_PROJECT_NOT_FOUND',undefined,404);
    targetDirectory=absolute(targetDirectory??join(directory,'dataset'),'dataset directory');
    const initial={schema:PROJECT,directory,sourceFile,publisherDirectory:join(directory,'publisher'),
      targetDirectory,createdAt:stamp()};
    await createFile(settingsFile,bytes(initial));
  }
  const settings=await readJson(settingsFile);
  need(settings.schema===PROJECT&&settings.directory===directory&&settings.sourceFile===sourceFile&&
    settings.publisherDirectory===join(directory,'publisher')&&(!targetDirectory||targetDirectory===settings.targetDirectory),
    'EUROSTAT_PROJECT_BINDING_CHANGED');
  absolute(settings.targetDirectory);
  if(!await exists(sourceFile)) {
    need(create,'EUROSTAT_SOURCE_MISSING');
    await createFile(sourceFile,bytes({schema:EUROSTAT_SOURCE_SCHEMA,captures:{},queries:{}}));
  }
  await privateDirectory(join(directory,'captures'),true);await privateDirectory(join(directory,'acquisitions'),true);
  const publisher=await openEurostatPublisher({directory:settings.publisherDirectory,create,sourceFile,
    targetDirectory:settings.targetDirectory,seller,resource,environment});
  let pending=Promise.resolve(),closed=false;
  const mutate=fn=>{need(!closed,'EUROSTAT_PROJECT_CLOSED');const op=pending.then(fn);pending=op.catch(()=>{});return op;};
  const saveSource=async config=>{need(bytes(config).length<=262144,'EUROSTAT_SOURCE_DECLARATION_LIMIT');await atomicJson(directory,'source.json',config);};
  const putCapture=async input=>{
    const kept=await retainCapture(join(directory,'captures'),input),s=await readSource(sourceFile);
    const ref={file:'captures/'+kept.capture.id+'/capture.json',sha256:kept.captureSha256};
    s.config.captures[kept.capture.id]=ref;await saveSource(s.config);
    return {capture:kept.capture,captureSha256:kept.captureSha256,reused:kept.reused,sourceHash:digest(bytes(s.config))};
  };
  const acquire=async({id,request,sourceUrl,continueExisting=false,timeoutMs=60000,maxBytes}={})=>mutate(async()=>{
    id=operationId(id);const url=sourceUrl?officialUrl(sourceUrl):buildSourceUrl(request);
    const folder=join(directory,'acquisitions',id),requestFile=join(folder,'request.json');
    await privateDirectory(folder,true);
    const desired={schema:'stellar-forge.eurostat-acquisition-request.v1',id,sourceUrl:url,timeoutMs,maxBytes:maxBytes??33554432};
    if(await exists(requestFile)){
      const prior=await readJson(requestFile);
      need(identity(prior)===identity(desired),'EUROSTAT_ACQUISITION_ID_CHANGED',undefined,409);
      if(!continueExisting)return await inspectAcquisition(id);
    }else await createFile(requestFile,bytes(desired));
    const names=(await readdir(folder)).filter(n=>/^attempt-[0-9]{6}$/.test(n)).sort();
    need(names.length<1000,'EUROSTAT_ACQUISITION_HISTORY_LIMIT');
    const previous=names.at(-1);
    if(previous&&await exists(join(folder,previous,'result.json'))){
      const last=await readJson(join(folder,previous,'result.json'),8*1024*1024);
      if(['DATA','EMPTY_SELECTION','METADATA_ONLY','NO_OBSERVATIONS'].includes(last.state))return await inspectAcquisition(id);
    }
    const number=names.length+1,attempt='attempt-'+String(number).padStart(6,'0'),dest=join(folder,attempt);
    await privateDirectory(dest,true);
    await createFile(join(dest,'intent.json'),bytes({...desired,attempt:number,startedAt:stamp(),state:'GET_STARTED'}));
    await syncDirectory(folder);
    const result=await acquireResponse(url,{fetchImpl,timeoutMs,maxBytes:desired.maxBytes});
    await createFile(join(dest,'body.bin'),result.body);
    let capture=null;
    if(result.bodyComplete&&result.httpStatus>=200&&result.httpStatus<300&&
      ['DATA','EMPTY_SELECTION','METADATA_ONLY','NO_OBSERVATIONS'].includes(result.state)){
      capture=await putCapture({body:result.body,sourceUrl:url,retrievedAt:result.finishedAt,
        transport:{kind:'native-fetch',httpStatus:result.httpStatus,headers:result.headers,operationId:id,attempt:number}});
    }
    const {body,...receipt}=result;
    await createFile(join(dest,'result.json'),bytes({...receipt,attempt:number,bodyFile:'body.bin',captureId:capture?.capture.id??null}));
    await syncDirectory(dest);await syncDirectory(folder);
    return await inspectAcquisition(id);
  });
  const inspectAcquisition=async id=>{
    operationId(id);const folder=join(directory,'acquisitions',id),request=await readJson(join(folder,'request.json'));
    const attempts=[];
    for(const name of (await readdir(folder)).filter(n=>/^attempt-[0-9]{6}$/.test(n)).sort()){
      const p=join(folder,name);
      if(await exists(join(p,'result.json')))attempts.push(await readJson(join(p,'result.json'),8*1024*1024));
      else attempts.push({...await readJson(join(p,'intent.json')),state:'RECEIVING_INTERRUPTED'});
    }
    return {request,attempts,state:attempts.at(-1)?.state??'PREPARED'};
  };
  const api={
    directory,settings,publisher,sourceFile,
    async status(){const s=await publisher.source(),names=(await readdir(join(directory,'acquisitions'))).filter(n=>/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(n));
      return {schema:'stellar-forge.eurostat-project-status.v1',project:settings,source:s,
        acquisitions:await Promise.all(names.sort().map(inspectAcquisition)),publisher:await publisher.status()};},
    importCapture:input=>mutate(()=>putCapture(input)),acquire,inspectAcquisition,
    async capture(id){need(HASH.test(id??''),'EUROSTAT_CAPTURE_ID');return readCapture(join(directory,'captures',id,'capture.json'));},
    async cells(id,options){return pageCube((await api.capture(id)).cube,options);},
    async compare(before,after,options){const a=await api.capture(before),b=await api.capture(after);return compareCubes(a.cube,b.cube,options);},
    saveQuery:({name,query,expectedHash})=>mutate(async()=>{
      need(typeof name==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(name),'EUROSTAT_QUERY_NAME');
      const current=await readSource(sourceFile);need(expectedHash===current.hash,'SOURCE_REVIEW_CHANGED','Reload the original source review.',409);
      const selected=current.captures[query?.captureId];need(selected,'EUROSTAT_CAPTURE_NOT_FOUND');
      current.config.queries[name]=normalizeQuery(query,selected.cube);await saveSource(current.config);
      return {name,query:current.config.queries[name],sourceHash:digest(bytes(current.config))};
    }),
    async planTemplate({query,title,name}={}){
      const s=await publisher.source(),q=s.queries[query];need(q,'QUERY_NOT_FOUND');
      const columns=Object.fromEntries(q.columnTypes.map(({name,type,nullable})=>[name,{type,nullable}]));
      return {title:title??'Eurostat '+query,query,input:{},sourceHash:s.hash,
        dataset:{name:name??'Eurostat '+query,columns,filters:q.dimensionColumns.filter(x=>x.kind==='code').map(x=>x.name),
          sorts:['cell_index'],maxCellChars:65536,defaultLimit:50,maxLimit:250,maxPageBytes:921600},
        extraction:{maxRows:250000,maxBytes:67108864,maxRowBytes:1048576,timeoutMs:30000,
          order:[{column:'cell_index',direction:'asc'}]}};
    },
    async briefing(id,{selection={},includeMissing=true,review=null}={}){const c=await api.capture(id);
      return createEurostatBriefing({cube:c.cube,sourceUrl:c.capture.sourceUrl,retrievedAt:c.capture.retrievedAt,responseSha256:c.capture.response.sha256,selection,includeMissing,review});},
    async exportSources(){
      const s=await readSource(sourceFile),files=[];
      for(const [id,c] of Object.entries(s.captures)){
        for(const [name,body] of [['capture.json',c.captureBytes],['response.json',c.body]])
          files.push({path:'captures/'+id+'/'+name,bytes:body.length,sha256:digest(body),base64:body.toString('base64')});
      }
      const content=bytes(s.config);files.push({path:'source.json',bytes:content.length,sha256:digest(content),base64:content.toString('base64')});
      const manifest={schema:PACKET,files};return {...manifest,sha256:identity(manifest)};
    },
    importSources:packet=>mutate(async()=>{
      need(packet?.schema===PACKET&&Array.isArray(packet.files)&&packet.files.length<=2001&&
        packet.sha256===identity({schema:PACKET,files:packet.files}),'EUROSTAT_HANDOVER_INVALID');
      const files=new Map();let total=0;
      for(const f of packet.files){
        need(f.path==='source.json'||/^captures\/[a-f0-9]{64}\/(capture|response)\.json$/.test(f.path),'EUROSTAT_HANDOVER_PATH');
        need(!files.has(f.path)&&typeof f.base64==='string'&&f.base64.length<=44739244,'EUROSTAT_HANDOVER_FILE');
        const b=Buffer.from(f.base64,'base64');total+=b.length;
        need(total<=256*1024*1024&&b.toString('base64')===f.base64&&b.length===f.bytes&&digest(b)===f.sha256,'EUROSTAT_HANDOVER_BYTES');
        files.set(f.path,b);
      }
      need(files.has('source.json'),'EUROSTAT_HANDOVER_SOURCE');
      const config=JSON.parse(files.get('source.json').toString('utf8'));
      need(config.schema===EUROSTAT_SOURCE_SCHEMA&&object(config.captures)&&object(config.queries),'EUROSTAT_HANDOVER_SOURCE');
      const current=await readSource(sourceFile);
      for(const [id,ref] of Object.entries(config.captures)){
        need(HASH.test(id)&&ref.file==='captures/'+id+'/capture.json','EUROSTAT_HANDOVER_CAPTURE');
        const manifest=files.get(ref.file),body=files.get('captures/'+id+'/response.json');
        need(manifest&&body&&digest(manifest)===ref.sha256,'EUROSTAT_HANDOVER_CAPTURE');
        const c=JSON.parse(manifest.toString('utf8'));
        const result=await retainCapture(join(directory,'captures'),{body,sourceUrl:c.sourceUrl,retrievedAt:c.retrievedAt,transport:c.transport});
        need(result.capture.id===id&&result.captureSha256===ref.sha256,'EUROSTAT_HANDOVER_CAPTURE_CHANGED');
        current.config.captures[id]=ref;
      }
      for(const [name,q] of Object.entries(config.queries)){
        need(/^[a-z][a-z0-9_-]{0,63}$/.test(name),'EUROSTAT_QUERY_NAME');
        need(HASH.test(q?.captureId??'')&&Object.hasOwn(config.captures,q.captureId),'EUROSTAT_QUERY_CAPTURE_MISSING');
        const c=await readCapture(join(directory,'captures',q.captureId,'capture.json'));
        const normalized=normalizeQuery(q,c.cube);
        if(current.config.queries[name])need(identity(current.config.queries[name])===identity(normalized),'EUROSTAT_QUERY_EXISTS_CHANGED',undefined,409);
        current.config.queries[name]=normalized;
      }
      need(files.size===1+Object.keys(config.captures).length*2,'EUROSTAT_HANDOVER_EXTRA_FILES');
      await saveSource(current.config);return await publisher.source();
    }),
    async close(){if(closed)return;closed=true;await pending;await publisher.close();}
  };
  return Object.freeze(api);
}
