import {promises as fs} from 'node:fs';
import {join,resolve,isAbsolute,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {
  files,now,clone,digest,canonical,jsonBytes,plain,own,need,integer,text,identifier,selected,hash,
  privateDirectory,exists,withLock,descriptor,copyDescriptor,collectFiles,decodeValue,publicConnection,StellarIndexerError,
} from './common.mjs';
import {verifyIndexerRuntime,restoreIndexerRuntime,bindIndexerRuntime} from './runtime.mjs';

export const INDEXER_SOURCE_SCHEMA='stellar-forge.stellar-indexer.source-export.v1';
export const INDEXER_DELIVERY_SCHEMA='stellar-forge.stellar-indexer.delivery-export.v1';
const APPLICATION_SOURCE_SCHEMA='stellar-forge.stellar-indexer.application-source.v1';
const APPLICATION_SCHEMA='stellar-forge.stellar-indexer.application-capture.v1';
const SNAPSHOT_SCHEMA='stellar-forge.stellar-indexer.workspace-source.v1';
const SOURCE_INDEXER='stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-indexer';
const BUSINESS_ACTIONS=new Set(['query-save','query-configure','capture-start','capture-pause','capture-resume']);
const manifestBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const byPath=(a,b)=>a.path.localeCompare(b.path);
const ids=(value,label)=>{
  need(Array.isArray(value),'INVALID_ARGUMENT','Supply '+label+' as an array.');
  const result=value.map(identifier);need(new Set(result).size===result.length,'INVALID_ARGUMENT','Select each '+label+' once.');
  return result.sort();
};
function sourceDirectory(value) {
  need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value,'INVALID_DIRECTORY',
    'Select an absolute original source folder.');return value;
}
function checkedFile(item) {
  need(plain(item),'SOURCE_MANIFEST_INVALID','The original file descriptor is missing.');
  files.relativeFile(item.path);hash(item.sha256);integer(item.bytes,'original source bytes');
  if(item.mode!==undefined)integer(item.mode,'original source mode',0,0o777);
  return item;
}
async function readPacket(directory,expectedManifestSha256,schemas) {
  sourceDirectory(directory);
  const stat=await fs.lstat(directory);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&await fs.realpath(directory)===directory,
    'INVALID_DIRECTORY','Select the original real source folder.');
  const body=await files.readFile(directory,'manifest.json'),manifestSha256=digest(body);
  if(expectedManifestSha256!==undefined&&expectedManifestSha256!==null)
    need(hash(expectedManifestSha256)===manifestSha256,'SOURCE_MANIFEST_CHANGED','The selected source manifest differs from its original digest.');
  let manifest;
  try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}
  catch{throw new StellarIndexerError('SOURCE_MANIFEST_INVALID','The original manifest must contain complete UTF-8 JSON.');}
  need(schemas.includes(manifest?.schema)&&Array.isArray(manifest.files),'SOURCE_MANIFEST_INVALID',
    'Select a complete original source export.');
  const seen=new Set();let bytes=0;
  for(const item of manifest.files) {
    checkedFile(item);
    need(item.path!=='manifest.json'&&!seen.has(item.path),'SOURCE_MANIFEST_INVALID','The original file list contains a duplicate path.');
    seen.add(item.path);bytes+=item.bytes;integer(bytes,'complete source bytes');
    await files.sourceFileRange(directory,item,0,1);
  }
  need(manifest.fileCount===manifest.files.length&&manifest.totalBytes===bytes,'SOURCE_MANIFEST_INVALID',
    'The original complete file count or byte count differs from its manifest.');
  return {directory,manifest,manifestBytes:body,manifestSha256,
    descriptors:new Map(manifest.files.map(item=>[item.path,item]))};
}
async function copyFile(origin,item,destination,path=item.path,{preserveMode=true}={}) {
  const copied=await copyDescriptor(origin,item,destination,path);
  if(preserveMode&&item.mode!==undefined)await fs.chmod(await files.filePath(destination,path),item.mode);
  return copied;
}
async function copyPacket(packet,destination,prefix='') {
  await privateDirectory(destination);
  const output=[];
  for(const item of packet.manifest.files)
    output.push(await copyFile(packet.directory,item,destination,prefix?prefix+'/'+item.path:item.path));
  const path=prefix?prefix+'/manifest.json':'manifest.json';
  output.push(await files.writeNew(destination,path,packet.manifestBytes));
  return output;
}
function samePage(left,right) {
  return left.page===right.page&&left.attemptId===right.attemptId&&left.result.sha256===right.result.sha256&&
    left.rowCount===right.rowCount&&left.sourceCount===right.sourceCount;
}
function prefixOf(left,right,equal) {
  return left.length<=right.length&&left.every((value,index)=>equal(value,right[index]));
}
function sameAttempt(left,right) {
  return left.id===right.id&&left.page===right.page&&
    (!left.result||!right.result||left.result.sha256===right.result.sha256)&&
    (!left.runtimeId||!right.runtimeId||left.runtimeId===right.runtimeId);
}
function nativeVersion(version) {
  return version.receivedSourceVersion?.sha256??version.sha256;
}
function sameCaptureOrigin(existing,incoming) {
  return existing.sourceWorkspaceId===incoming.sourceWorkspaceId&&
    (existing.originalCaptureId??existing.id)===(incoming.originalCaptureId??incoming.id);
}
function historyRelation(existing,incoming) {
  if(existing.network!==incoming.network||nativeVersion(existing.query)!==nativeVersion(incoming.query)||
    existing.sourceWorkspaceId!==incoming.sourceWorkspaceId||existing.createdAt!==incoming.createdAt||
    canonical(existing.frozenArgs)!==canonical(incoming.frozenArgs))return 'DIVERGED';
  const incomingPrefix=prefixOf(incoming.pages,existing.pages,samePage)&&
    prefixOf(incoming.attempts,existing.attempts,sameAttempt);
  const existingPrefix=prefixOf(existing.pages,incoming.pages,samePage)&&
    prefixOf(existing.attempts,incoming.attempts,sameAttempt);
  if(incomingPrefix&&existingPrefix) {
    const rank=c=>c.pages.length*4+(c.status==='COMPLETE'?2:0)+(c.activeAttemptId?0:1);
    return rank(existing)>=rank(incoming)?'EXISTING':'INCOMING';
  }
  if(incomingPrefix)return 'EXISTING';
  if(existingPrefix)return 'INCOMING';
  return 'DIVERGED';
}
function remapVersion(version,queryId) {
  if(version.queryId===queryId)return clone(version);
  const original=clone(version),mapped={...original,queryId,
    receivedSourceVersion:clone(original.receivedSourceVersion??
      {queryId:original.queryId,version:original.version,sha256:original.sha256})};
  delete mapped.sha256;mapped.sha256=digest(jsonBytes(mapped));return mapped;
}
function ordinaryRuntime(runtime) {
  return {id:runtime.id,directory:runtime.directory,manifestSha256:runtime.manifestSha256,
    entrypoint:runtime.entrypoint,entrypoints:runtime.entrypoints};
}
async function captureLocks(directory,captureIds,work) {
  const release=[];
  try {
    for(const id of [...new Set(captureIds)].sort()) {
      identifier(id);
      try{release.push(await files.acquireLock(directory,'capture-'+id+'.lock'));}
      catch(error){
        if(error.code==='WORKSPACE_BUSY')throw new StellarIndexerError('CAPTURE_BUSY',
          'The native capture is running. Pause or let it finish, then retry this original source operation.',{captureId:id});
        throw error;
      }
    }
    return await work();
  }finally{for(const done of release.reverse())await done();}
}
export class IndexerReceiving {
  #context;
  constructor(context){this.#context=context;}
  async #requestContext(id,change) {
    return this.#context.edit(state=>{
      need(own(state.requests,id),'REQUEST_MISSING','The original source request is missing.');
      change(state.requests[id].context,state);return clone(state.requests[id].context);
    });
  }
  async retainApplicationSource() {
    const context=this.#context,root=resolve(context.sourceDirectory,'../../../..');
    const declaredBytes=await files.readFile(context.sourceDirectory,'source-files.json');
    const declared=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(declaredBytes));
    need(declared.schema===APPLICATION_SOURCE_SCHEMA&&declared.rootFromIndexer==='../../../..'&&Array.isArray(declared.files),
      'APPLICATION_SOURCE_INVALID','Install the complete original application source selection.');
    const originals=[],seen=new Set(),self=SOURCE_INDEXER+'/source-files.json';
    for(const expected of declared.files) {
      checkedFile(expected);need(!seen.has(expected.path)&&expected.path!==self,'APPLICATION_SOURCE_INVALID',
        'The original application source selection contains repeated files.');
      seen.add(expected.path);
      const actual=await descriptor(root,expected.path,expected.path.endsWith('.json')?'application/json':'application/octet-stream');
      need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'APPLICATION_SOURCE_CHANGED',
        'Installed application source differs from its selected original file.',{path:expected.path});
      originals.push(actual);
    }
    need(seen.has(SOURCE_INDEXER+'/engine.mjs')&&seen.has(SOURCE_INDEXER+'/receiving.mjs')&&
      seen.has(SOURCE_INDEXER+'/runtime.mjs')&&seen.has(SOURCE_INDEXER+'/server.mjs')&&
      seen.has(SOURCE_INDEXER+'/source/stellar-indexer-sdk-0.0.13.json'),'APPLICATION_SOURCE_INVALID',
      'The application source selection must include its complete engine, operator and original publisher source.');
    const selfDescriptor=await descriptor(root,self,'application/json');
    need(selfDescriptor.sha256===digest(declaredBytes),'APPLICATION_SOURCE_CHANGED','The original source selection changed during capture.');
    originals.push(selfDescriptor);originals.sort(byPath);
    const retainedFiles=originals.map(item=>({...item,path:'source/'+item.path}));
    const identity={sourceManifestSha256:digest(declaredBytes),files:retainedFiles};
    const id=digest(canonical(identity)),directory=join(context.directory,'applications',id);
    return withLock(context.directory,'application-'+id+'.lock',async()=>{
      const manifest={schema:APPLICATION_SCHEMA,id,sourceManifestSha256:identity.sourceManifestSha256,
        sourceManifest:'source/'+self,entrypoint:'source/'+SOURCE_INDEXER+'/server.mjs',
        cli:'source/'+SOURCE_INDEXER+'/cli.mjs',files:retainedFiles,
        fileCount:retainedFiles.length,totalBytes:retainedFiles.reduce((sum,item)=>sum+item.bytes,0)};
      const bytes=manifestBytes(manifest);
      await privateDirectory(directory);
      for(const item of originals)await copyFile(root,item,directory,'source/'+item.path);
      await files.writeNew(directory,'manifest.json',bytes);
      const result={id,directory,manifest,manifestSha256:digest(bytes)};
      await context.edit(state=>{
        state.applications??={};const previous=state.applications[id];
        need(!previous||previous.manifestSha256===result.manifestSha256,'APPLICATION_SOURCE_CONFLICT',
          'An existing captured application has different original source.');
        state.applications[id]={id,directory,manifestSha256:result.manifestSha256};return null;
      });
      return result;
    });
  }
  async sourceExport(input) {return this.#export(input,false);}
  async deliveryExport(input) {return this.#export(input,true);}
  async #export(input,delivery) {
    const context=this.#context;
    const request=await context.intent(delivery?'delivery-export':'source-export',input,(state,args)=>{
      let captureIds,editionIds,watchIds;
      if(delivery) {
        captureIds=ids(args.captureIds??[],'capture IDs');editionIds=ids(args.editionIds??[],'edition IDs');
        watchIds=ids(args.watchIds??[],'watch IDs');
      }else{
        need(Boolean(args.captureId)!==Boolean(args.editionId),'INVALID_ARGUMENT','Select one original capture or edition.');
        captureIds=args.captureId?[identifier(args.captureId)]:[];editionIds=args.editionId?[identifier(args.editionId)]:[];watchIds=[];
      }
      for(const id of editionIds)captureIds.push(selected(state.editions,id,'Edition').captureId);
      captureIds=[...new Set(captureIds)].sort();for(const id of captureIds)selected(state.captures,id,'Capture');
      need(captureIds.length+watchIds.length>0,'INVALID_ARGUMENT','Select original captures, editions or recurring watches.');
      if(watchIds.length)need(context.eventWatches,'EVENT_WORKSPACE_REQUIRED','Open the original Soroban watch workspace for this client delivery.');
      const stageId=randomUUID();
      return {captureIds,editionIds,watchIds,stageId,exportId:digest(state.id+'.'+stageId),snapshot:null,
        applicationIds:[],watchExports:{},runtimeExports:{},applicationExports:{},exported:null};
    });
    if(request.result)return request.result;
    return withLock(context.directory,'source-operation-'+request.id+'.lock',async()=>{
      let current=(await context.state()).requests[request.id].context;
      const destination=join(context.directory,'exports',current.exportId);
      const retainedStage=join(context.directory,'staging','source-'+current.stageId);
      if(await exists(destination,'manifest.json'))return this.#finalizeExport(request,current,destination);
      if(await exists(retainedStage,'manifest.json'))return this.#finalizeExport(request,current,retainedStage);
      need(!current.exported,'SOURCE_MISSING','The published original source folder is missing.');
      if(current.snapshot) {
        // An unfinished private copy can be refreshed from the retained native workspace.
        // A complete manifest is always recovered above without selecting a new snapshot.
        await fs.rm(retainedStage,{recursive:true,force:true});
        current=await this.#requestContext(request.id,saved=>{
          saved.stageId=randomUUID();saved.snapshot=null;saved.applicationIds=[];saved.runtimeIds=[];
        });
      }
      return captureLocks(context.directory,current.captureIds,async()=>{
        const application=await this.retainApplicationSource();
        for(const id of current.captureIds)await context.ensureEdition(id);
        if(!current.snapshot) {
          current=await this.#requestContext(request.id,(saved,state)=>{
            const captures=saved.captureIds.map(id=>clone(selected(state.captures,id,'Capture')));
            const editionIds=[...new Set([...saved.editionIds,...captures.filter(c=>c.editionId&&own(state.editions,c.editionId)).map(c=>c.editionId)])];
            const queryIds=[...new Set(captures.map(c=>c.queryId))];
            const queries=queryIds.map(id=>clone(selected(state.queries,id,'Query')));
            const requests=Object.values(state.requests).filter(item=>BUSINESS_ACTIONS.has(item.action)&&(
              saved.captureIds.includes(item.args.captureId)||queryIds.includes(item.args.queryId)||
              saved.captureIds.includes(item.context?.capture?.id)||queryIds.includes(item.context?.query?.id))).map(clone);
            saved.snapshot={schema:SNAPSHOT_SCHEMA,origin:{workspaceId:state.id,revision:state.revision,capturedAt:now()},
              queries,captures,editions:editionIds.map(id=>clone(selected(state.editions,id,'Edition'))),requests,
              sourceHistory:Object.fromEntries(Object.entries(state.sourceHistory??{}).filter(([,history])=>
                Object.values(history.captureMap??{}).some(id=>saved.captureIds.includes(id))).map(([id,value])=>[id,clone(value)]))};
            saved.operatorApplicationId=application.id;
            saved.applicationIds=[...new Set([application.id,...captures.flatMap(c=>c.attempts.map(a=>a.applicationId).filter(Boolean))])].sort();
            saved.runtimeIds=[...new Set(captures.flatMap(c=>[c.runtimeId,...c.attempts.map(a=>a.runtimeId)]).filter(Boolean))].sort();
          });
        }
        const stage=join(context.directory,'staging','source-'+current.stageId);await privateDirectory(stage);
        const snapshot=clone(current.snapshot),descriptors=[],runtimeSources=[],applicationSources=[],watchSources=[];
        for(const capture of snapshot.captures) {
          for(const attempt of capture.attempts) {
            const original=attempt.directory,normalized='captures/'+capture.id+'/attempts/'+attempt.id;
            let sourceFiles;
            try{sourceFiles=await collectFiles(join(context.directory,original));}
            catch(error){
              if(error.code!=='ENOENT'||attempt.result||(attempt.files?.length??0)>0||
                !['PREPARED','INTERRUPTED'].includes(attempt.phase))throw error;
              sourceFiles=[];
            }
            for(const item of sourceFiles)descriptors.push(await copyFile(join(context.directory,original),item,stage,'workspace/'+normalized+'/'+item.path));
            attempt.directory=normalized;attempt.files=sourceFiles;
            if(attempt.result)attempt.result={...attempt.result,path:normalized+'/result.json'};
            for(const page of capture.pages.filter(item=>item.attemptId===attempt.id))
              page.result={...page.result,path:normalized+'/result.json'};
          }
        }
        for(const edition of snapshot.editions) {
          const selectedCapture=snapshot.captures.find(c=>c.id===edition.captureId);
          need(selectedCapture,'SOURCE_SELECTION_CHANGED','The selected original edition is missing its capture.');
          const target='editions/'+edition.id+'/edition.json';
          descriptors.push(await copyFile(context.directory,edition.file,stage,'workspace/'+target));
          edition.file={...edition.file,path:target};edition.pages=clone(selectedCapture.pages);
        }
        const state=await context.state();
        for(const id of current.runtimeIds) {
          hash(id);const selectedRuntime=state.runtimes[id];
          need(selectedRuntime,'SDK_RUNTIME_MISSING','An original native attempt is missing its retained SDK runtime.',{id});
          const runtime=await verifyIndexerRuntime({directory:selectedRuntime.directory,expectedManifestSha256:selectedRuntime.manifestSha256});
          const path='runtimes/'+id,body=await files.readFile(runtime.directory,'manifest.json');
          need(digest(body)===runtime.manifestSha256,'SDK_RUNTIME_CHANGED','The captured runtime manifest changed.');
          for(const file of runtime.manifest.files)descriptors.push(await copyFile(runtime.directory,file,stage,path+'/'+file.path));
          descriptors.push(await files.writeNew(stage,path+'/manifest.json',body));
          runtimeSources.push({id,path,manifestSha256:runtime.manifestSha256});
        }
        for(const id of current.applicationIds) {
          const original=state.applications?.[id];
          need(original,'APPLICATION_SOURCE_MISSING','An original attempt is missing its complete application source.',{id});
          const packet=await readPacket(original.directory,original.manifestSha256,[APPLICATION_SCHEMA]),path='applications/'+id;
          need(packet.manifest.id===id,'APPLICATION_SOURCE_CHANGED','The original application identity changed.');
          descriptors.push(...await copyPacket(packet,stage,path));
          applicationSources.push({id,path,manifestSha256:packet.manifestSha256,entrypoint:packet.manifest.entrypoint,cli:packet.manifest.cli});
        }
        for(const watchId of current.watchIds) {
          let exported=current.watchExports[watchId];
          if(!exported) {
            const original=await context.eventWatches.describe();
            const result=await context.eventWatches.watchExport({watchId,expectedRevision:original.revision,
              requestId:'stellar-indexer.'+request.id+'.watch-export.'+watchId});
            exported=result.export;
            current=await this.#requestContext(request.id,saved=>{saved.watchExports[watchId]=clone(exported);});
          }
          need(exported?.manifest&&exported.id&&exported.manifestSha256,'EVENT_SOURCE_MISSING',
            'The original Soroban watch did not return its complete source export.');
          const body=await files.readFile(exported.directory,'manifest.json');
          need(digest(body)===exported.manifestSha256,'EVENT_SOURCE_CHANGED','The original Soroban manifest changed.');
          const packet={directory:exported.directory,manifest:exported.manifest,manifestBytes:body};
          const path='watches/'+watchId;descriptors.push(...await copyPacket(packet,stage,path));
          watchSources.push({watchId,exportId:exported.id,path,manifestSha256:exported.manifestSha256});
        }
        const historyFiles=new Map();
        for(const history of Object.values(snapshot.sourceHistory)) {
          const retain=async(origin,item)=>{
            const path='history/'+item.sha256+'.json';
            if(!historyFiles.has(path))historyFiles.set(path,await copyFile(origin,item,stage,path));
            return clone(historyFiles.get(path));
          };
          const previousSource=history.source;
          history.source=await retain(context.directory,previousSource);
          const previousManifestBytes=await files.readFile(history.directory,'manifest.json');
          need(digest(previousManifestBytes)===history.manifestSha256,'SOURCE_MANIFEST_CHANGED','An original received history manifest changed.');
          const previousManifest=JSON.parse(previousManifestBytes.toString('utf8'));
          for(const item of previousManifest.files.filter(file=>file.path.startsWith('history/')))await retain(history.directory,item);
          history.directory=null;
        }
        snapshot.historyFiles=[...historyFiles.values()].sort(byPath);descriptors.push(...snapshot.historyFiles);
        snapshot.operatorApplicationId=current.operatorApplicationId;
        snapshot.runtimes=runtimeSources;snapshot.applications=applicationSources;snapshot.watches=watchSources;
        descriptors.push(await files.writeNew(stage,'workspace-source.json',jsonBytes(snapshot)));
        descriptors.sort(byPath);
        need(new Set(descriptors.map(file=>file.path)).size===descriptors.length,'SOURCE_MANIFEST_INVALID',
          'The complete original source has conflicting file paths.');
        const manifest={schema:delivery?INDEXER_DELIVERY_SCHEMA:INDEXER_SOURCE_SCHEMA,exportId:current.exportId,requestId:request.id,
          origin:clone(snapshot.origin),snapshot:'workspace-source.json',
          captures:snapshot.captures.map(c=>({id:c.id,queryId:c.queryId,queryVersion:c.queryVersion,status:c.status,
            network:c.network,rowCount:c.rowCount,pageCount:c.pages.length,attemptCount:c.attempts.length,editionId:c.editionId})),
          editions:snapshot.editions.map(e=>({id:e.id,captureId:e.captureId,sha256:e.sha256,rowCount:e.rowCount})),
          runtimes:runtimeSources,applications:applicationSources,watches:watchSources,
          files:descriptors,fileCount:descriptors.length,totalBytes:descriptors.reduce((sum,item)=>sum+item.bytes,0)};
        const body=manifestBytes(manifest);await files.writeNew(stage,'manifest.json',body);
        return this.#finalizeExport(request,current,stage);
      });
    });
  }
  async #finalizeExport(request,current,source) {
    const context=this.#context,schemas=request.action==='delivery-export'?[INDEXER_DELIVERY_SCHEMA]:[INDEXER_SOURCE_SCHEMA];
    const packet=await readPacket(source,current.exported?.manifestSha256,schemas);
    need(packet.manifest.exportId===current.exportId&&packet.manifest.requestId===request.id,
      'SOURCE_MANIFEST_CHANGED','The complete source folder belongs to a different original operation.');
    const destination=join(context.directory,'exports',current.exportId);
    if(source!==destination) {
      await privateDirectory(join(context.directory,'exports'));
      await fs.rename(source,destination);
      const parent=await fs.open(dirname(destination),'r');try{await parent.sync();}finally{await parent.close();}
    }
    const exported={id:current.exportId,directory:destination,manifest:packet.manifest,manifestSha256:packet.manifestSha256};
    await this.#requestContext(request.id,(saved,state)=>{saved.exported=clone(exported);state.exports[exported.id]=clone(exported);});
    return context.finish(request.id,{export:exported});
  }
  async sourceFile({exportId,path,offset=0,length=null}={}) {
    hash(exportId,'export identifier');files.relativeFile(path);
    const state=await this.#context.state(),exported=state.exports[exportId];
    need(exported,'NOT_FOUND','Select an original source export in this workspace.');
    const item=path==='manifest.json'?{path,sha256:exported.manifestSha256,contentType:'application/json'}:
      exported.manifest.files.find(file=>file.path===path);
    need(item,'NOT_FOUND','The selected file is not in this original export.');
    return files.sourceFileRange(exported.directory,item,offset,length);
  }
  async #restoreInstallations(snapshot,applications,runtimes) {
    const context=this.#context,pairs=new Map();
    const pair=(applicationId,runtimeId)=>{
      if(applicationId&&runtimeId)pairs.set(applicationId+'.'+runtimeId,{applicationId,runtimeId});
    };
    for(const capture of snapshot.captures)for(const attempt of capture.attempts)pair(attempt.applicationId,attempt.runtimeId);
    for(const runtimeId of Object.keys(runtimes))pair(snapshot.operatorApplicationId,runtimeId);
    const installations=[];
    for(const {applicationId,runtimeId}of pairs.values()) {
      const application=applications[applicationId],runtime=runtimes[runtimeId];
      need(application&&runtime,'APPLICATION_SOURCE_MISSING','The runnable application is missing its original source or native runtime.');
      const id=digest(applicationId+'.'+runtimeId);
      const value=await withLock(context.directory,'installation-'+id+'.lock',async()=>{
        const packet=await readPacket(application.directory,application.manifestSha256,[APPLICATION_SCHEMA]);
        const directory=join(context.directory,'installations',applicationId,runtimeId);
        await copyPacket(packet,directory);
        const sourceRoot=join(directory,'source');
        const binding=await bindIndexerRuntime({directory:runtime.directory,applicationDirectory:sourceRoot,
          expectedManifestSha256:runtime.manifestSha256});
        need(binding.runtimeId===runtimeId,'SDK_RUNTIME_CHANGED','The restored application selected a different original native runtime.');
        const selected={id,applicationId,runtimeId,directory,sourceDirectory:sourceRoot,
          manifestSha256:application.manifestSha256,runtimeManifestSha256:runtime.manifestSha256,
          entrypoint:join(directory,files.relativeFile(packet.manifest.entrypoint)),
          cli:join(directory,files.relativeFile(packet.manifest.cli)),indexerDirectory:context.directory};
        await files.writeNew(directory,'installation.json',jsonBytes(selected));
        return selected;
      });
      installations.push(value);
    }
    return installations;
  }
  async #validateSnapshot(packet) {
    const manifest=packet.manifest;
    hash(manifest.exportId,'export identifier');
    need(manifest.snapshot==='workspace-source.json'&&packet.descriptors.has(manifest.snapshot),
      'SOURCE_MANIFEST_INVALID','The complete original workspace source is missing.');
    const snapshot=await files.readJSON(packet.directory,manifest.snapshot);
    need(snapshot.schema===SNAPSHOT_SCHEMA&&plain(snapshot.origin),'SOURCE_MANIFEST_INVALID','The original workspace source schema differs.');
    identifier(snapshot.origin.workspaceId);integer(snapshot.origin.revision,'original workspace revision');
    need(canonical(snapshot.origin)===canonical(manifest.origin),'SOURCE_MANIFEST_INVALID','The original source origin differs from its manifest.');
    for(const key of ['queries','captures','editions','requests','runtimes','applications','watches'])
      need(Array.isArray(snapshot[key]),'SOURCE_MANIFEST_INVALID','The original '+key+' collection is missing.');
    const namedFile=(path,expected)=>{
      const actual=packet.descriptors.get(path);
      need(actual&&(!expected||(actual.sha256===expected.sha256&&actual.bytes===expected.bytes)),
        'SOURCE_MANIFEST_INVALID','A declared original source file is missing or changed.',{path});
      return actual;
    };
    need(Array.isArray(snapshot.historyFiles??[]),'SOURCE_MANIFEST_INVALID','The original received history list is invalid.');
    for(const item of snapshot.historyFiles??[]) {
      checkedFile(item);need(item.path==='history/'+item.sha256+'.json','SOURCE_MANIFEST_INVALID','The original history file has a different identity.');
      namedFile(item.path,item);
    }
    for(const history of Object.values(snapshot.sourceHistory??{})) {
      need(plain(history)&&history.source,'SOURCE_MANIFEST_INVALID','An original received history is missing its source.');
      namedFile(history.source.path,history.source);
    }
    const queries=new Map();
    for(const query of snapshot.queries) {
      identifier(query.id);integer(query.currentVersion,'current query version',1);
      if(query.sourceWorkspaceId!==undefined)identifier(query.sourceWorkspaceId);
      if(query.originalQueryId!==undefined)identifier(query.originalQueryId);
      need(!queries.has(query.id)&&Array.isArray(query.versions)&&query.versions.length>0,
        'SOURCE_MANIFEST_INVALID','The source contains a missing or repeated query.');
      const versions=new Set();
      for(const version of query.versions) {
        this.#context.validateQueryVersion(version);
        need(version.queryId===query.id&&!versions.has(version.version),'SOURCE_MANIFEST_INVALID','The original query versions conflict.');
        decodeValue(version.nativeArgs);versions.add(version.version);
      }
      need(versions.has(query.currentVersion),'SOURCE_MANIFEST_INVALID','The current original query version is missing.');
      queries.set(query.id,query);
    }
    const runtimes=new Map(),applications=new Map(),watches=new Set();
    for(const runtime of snapshot.runtimes) {
      hash(runtime.id);hash(runtime.manifestSha256);files.relativeFile(runtime.path);
      need(!runtimes.has(runtime.id)&&runtime.path==='runtimes/'+runtime.id,'SOURCE_MANIFEST_INVALID','The original runtime source selection conflicts.');
      const item=namedFile(runtime.path+'/manifest.json');
      need(item.sha256===runtime.manifestSha256,'SOURCE_MANIFEST_INVALID','The original runtime manifest digest differs.');
      runtimes.set(runtime.id,runtime);
    }
    for(const application of snapshot.applications) {
      hash(application.id);hash(application.manifestSha256);files.relativeFile(application.path);
      need(!applications.has(application.id)&&application.path==='applications/'+application.id,
        'SOURCE_MANIFEST_INVALID','The original application source selection conflicts.');
      const item=namedFile(application.path+'/manifest.json');
      need(item.sha256===application.manifestSha256,'SOURCE_MANIFEST_INVALID','The original application manifest digest differs.');
      applications.set(application.id,application);
    }
    hash(snapshot.operatorApplicationId,'operator application identity');
    need(applications.has(snapshot.operatorApplicationId),'SOURCE_MANIFEST_INVALID','The current complete operator source is missing.');
    for(const watch of snapshot.watches) {
      identifier(watch.watchId);hash(watch.manifestSha256);files.relativeFile(watch.path);
      need(!watches.has(watch.watchId)&&watch.path==='watches/'+watch.watchId,'SOURCE_MANIFEST_INVALID','The original watch source selection conflicts.');
      need(namedFile(watch.path+'/manifest.json').sha256===watch.manifestSha256,
        'SOURCE_MANIFEST_INVALID','The original watch manifest digest differs.');
      watches.add(watch.watchId);
    }
    for(const name of ['runtimes','applications','watches'])
      need(canonical(snapshot[name])===canonical(manifest[name]),'SOURCE_MANIFEST_INVALID','The original '+name+' selection differs from its manifest.');
    const captures=new Map(),allAttempts=new Set();
    for(const capture of snapshot.captures) {
      identifier(capture.id);identifier(capture.sourceWorkspaceId);identifier(capture.queryId);
      need(!captures.has(capture.id)&&Array.isArray(capture.pages)&&Array.isArray(capture.attempts),
        'SOURCE_MANIFEST_INVALID','The original capture is missing or repeated.');
      need(['READY','RUNNING','PAUSED','FAILED','COMPLETE'].includes(capture.status)&&
        ['RUNNING','PAUSED'].includes(capture.desiredState),'SOURCE_MANIFEST_INVALID','The original capture state is invalid.');
      this.#context.validateQueryVersion(capture.query);
      const query=queries.get(capture.queryId),version=query?.versions.find(v=>v.version===capture.queryVersion);
      need(version&&version.sha256===capture.query.sha256&&version.queryId===capture.queryId&&
        version.network===capture.network,'SOURCE_MANIFEST_INVALID','The native capture differs from its saved query version.');
      decodeValue(capture.frozenArgs);
      const attempts=new Map();let rowCount=0,sourceCount=0;
      for(const [index,attempt] of capture.attempts.entries()) {
        identifier(attempt.id);
        need(!allAttempts.has(attempt.id)&&attempt.number===index+1&&Array.isArray(attempt.files??[]),
          'SOURCE_MANIFEST_INVALID','The original native attempt sequence conflicts.');
        allAttempts.add(attempt.id);attempts.set(attempt.id,attempt);integer(attempt.page,'native attempt page');
        need(attempt.directory==='captures/'+capture.id+'/attempts/'+attempt.id,'SOURCE_MANIFEST_INVALID',
          'The native attempt is outside its original capture source.');
        const prefix='workspace/'+attempt.directory+'/';
        const declared=new Set();
        for(const item of attempt.files??[]) {
          checkedFile(item);need(!declared.has(item.path),'SOURCE_MANIFEST_INVALID','The native attempt repeats an original source file.');
          declared.add(item.path);namedFile(prefix+item.path,item);
        }
        const retained=manifest.files.filter(item=>item.path.startsWith(prefix));
        need(retained.length===declared.size,'SOURCE_MANIFEST_INVALID','The original native attempt source list is incomplete.');
        if(attempt.runtimeId)need(runtimes.has(attempt.runtimeId),'SOURCE_MANIFEST_INVALID','A native attempt is missing its original SDK runtime.');
        if(attempt.applicationId)need(applications.has(attempt.applicationId),'SOURCE_MANIFEST_INVALID','A native attempt is missing its original application.');
        if(attempt.result)namedFile('workspace/'+attempt.result.path,attempt.result);
      }
      if(capture.activeAttemptId!==null)need(attempts.has(capture.activeAttemptId),'SOURCE_MANIFEST_INVALID','The original pending native attempt is missing.');
      for(const [index,page] of capture.pages.entries()) {
        const attempt=attempts.get(page.attemptId);
        need(attempt&&page.number===index+1&&page.page===(version.pagination.startPage??0)+index&&
          page.rowOffset===rowCount&&page.result?.path===attempt.directory+'/result.json'&&
          attempt.result?.sha256===page.result.sha256,'SOURCE_MANIFEST_INVALID','The original native page sequence conflicts.');
        namedFile('workspace/'+page.result.path,page.result);
        const result=await files.readJSON(packet.directory,'workspace/'+page.result.path);
        need(result.schema==='stellar-forge.stellar-indexer.native-page.v1'&&result.method===version.method&&
          result.page===page.page&&result.runtimeId===attempt.runtimeId&&result.runtimeId===capture.runtimeId&&
          result.rowCount===page.rowCount&&result.sourceCount===page.sourceCount&&
          Array.isArray(result.rows)&&result.rows.length===result.rowCount,
          'SOURCE_MANIFEST_INVALID','A native SDK result differs from its original capture page.');
        need(attempt.applicationId&&applications.has(attempt.applicationId),'SOURCE_MANIFEST_INVALID',
          'The completed native page is missing the application source used to create it.');
        namedFile('workspace/'+attempt.directory+'/invocation.json');
        const invocation=await files.readJSON(packet.directory,'workspace/'+attempt.directory+'/invocation.json');
        need(invocation.schema==='stellar-forge.stellar-indexer.invocation.v1'&&invocation.method===result.method&&
          invocation.page===result.page&&invocation.runtimeId===result.runtimeId&&
          invocation.network===capture.network&&canonical(invocation.args)===canonical(result.args),
          'SOURCE_MANIFEST_INVALID','The retained SDK invocation differs from its native result.');
        need(Array.isArray(result.exchanges),'SOURCE_MANIFEST_INVALID','The original native exchanges are missing.');
        for(const exchange of result.exchanges) {
          need(plain(exchange?.request)&&exchange.request.body,'SOURCE_MANIFEST_INVALID','An original native request body is missing.');
          namedFile('workspace/'+attempt.directory+'/'+exchange.request.body.path,exchange.request.body);
          if(exchange.response?.body)namedFile('workspace/'+attempt.directory+'/'+exchange.response.body.path,exchange.response.body);
        }
        decodeValue(result.value);decodeValue(result.args);
        for(const row of result.rows) {
          need(plain(row)&&typeof row.key==='string'&&digest(canonical(row.value))===row.sha256,
            'SOURCE_MANIFEST_INVALID','An original SDK row differs from its native value.');
          decodeValue(row.value);
        }
        integer(page.rowCount,'native row count');integer(page.sourceCount,'native source count');
        rowCount+=page.rowCount;sourceCount+=page.sourceCount;
      }
      need(rowCount===capture.rowCount&&sourceCount===capture.sourceCount&&
        capture.nextPage===(version.pagination.startPage??0)+capture.pages.length,
        'SOURCE_MANIFEST_INVALID','The original capture totals differ from its native pages.');
      if(capture.runtimeId)need(runtimes.has(capture.runtimeId),'SOURCE_MANIFEST_INVALID','The original capture runtime is missing.');
      captures.set(capture.id,capture);
    }
    const editions=new Map();
    for(const edition of snapshot.editions) {
      identifier(edition.id);identifier(edition.captureId);
      const capture=captures.get(edition.captureId);
      need(!editions.has(edition.id)&&capture&&capture.status==='COMPLETE'&&capture.editionId===edition.id&&
        edition.rowCount===capture.rowCount&&edition.sourceCount===capture.sourceCount&&edition.pageCount===capture.pages.length&&
        edition.queryId===capture.queryId&&edition.queryVersion===capture.queryVersion&&
        prefixOf(edition.pages,capture.pages,samePage)&&edition.pages.length===capture.pages.length,
        'SOURCE_MANIFEST_INVALID','The completed original edition differs from its capture.');
      namedFile('workspace/'+edition.file.path,edition.file);
      need(edition.file.sha256===edition.sha256,'SOURCE_MANIFEST_INVALID','The original edition digest differs.');
      const original=await files.readJSON(packet.directory,'workspace/'+edition.file.path);
      need(original.schema==='stellar-forge.stellar-indexer.edition.v1'&&
        original.id===(edition.originalEditionId??edition.id)&&
        original.captureId===(edition.originalCaptureId??edition.captureId)&&
        original.rowCount===edition.rowCount&&original.sourceCount===edition.sourceCount&&
        original.pageCount===edition.pageCount&&prefixOf(original.pages,edition.pages,samePage),
        'SOURCE_MANIFEST_INVALID','The retained original edition body differs from its complete pages.');
      editions.set(edition.id,edition);
    }
    for(const capture of captures.values())if(capture.status==='COMPLETE')
      need(editions.has(capture.editionId),'SOURCE_MANIFEST_INVALID','The completed native capture is missing its original edition.');
    need(manifest.captures.length===captures.size&&manifest.editions.length===editions.size&&
      manifest.captures.every(item=>captures.has(item.id))&&manifest.editions.every(item=>editions.has(item.id)),
      'SOURCE_MANIFEST_INVALID','The selected capture or edition list differs from its original source.');
    return snapshot;
  }
  async sourceReceive(input){return this.#receive(input,false);}
  async deliveryReceive(input){return this.#receive(input,true);}
  async #receive(input,delivery) {
    const context=this.#context;
    const request=await context.intent(delivery?'delivery-receive':'source-receive',input,()=>({
      operationId:randomUUID(),manifestSha256:null,retainedDirectory:null,watchResults:{},result:null,
    }));
    if(request.result)return request.result;
    return withLock(context.directory,'source-operation-'+request.id+'.lock',async()=>{
      let current=(await context.state()).requests[request.id].context;
      if(current.result)return context.finish(request.id,current.result);
      const expected=current.manifestSha256??input.expectedManifestSha256;
      const packet=await readPacket(input.sourceDirectory,expected,
        delivery?[INDEXER_DELIVERY_SCHEMA,INDEXER_SOURCE_SCHEMA]:[INDEXER_SOURCE_SCHEMA]);
      const snapshot=await this.#validateSnapshot(packet);
      if(snapshot.watches.length)need(context.eventWatches,'EVENT_WORKSPACE_REQUIRED',
        'Open the original Soroban watch workspace to receive this complete client delivery.');
      if(input.watchConnections!==undefined) {
        need(plain(input.watchConnections),'INVALID_ARGUMENT','Supply host connection selections keyed by original watch ID.');
        for(const [id,choice]of Object.entries(input.watchConnections)) {
          identifier(id);need(snapshot.watches.some(item=>item.watchId===id)&&plain(choice),'INVALID_ARGUMENT',
            'Select host connections for a watch in this delivery.');
          need(Object.keys(choice).every(key=>['connectionAlias','recoveryConnectionAlias','publicationDirectory'].includes(key)),
            'INVALID_ARGUMENT','Use the original watch receiving connection and publication fields.');
        }
      }
      const retainedDirectory=join(context.directory,'received',packet.manifestSha256);
      if(current.manifestSha256===null)current=await this.#requestContext(request.id,saved=>{
        saved.manifestSha256=packet.manifestSha256;saved.retainedDirectory=retainedDirectory;
      });
      await copyPacket(packet,retainedDirectory);
      const runtimes={},applications={};
      for(const item of snapshot.runtimes) {
        const state=await context.state(),previous=state.runtimes[item.id];
        const runtime=previous?
          await verifyIndexerRuntime({directory:previous.directory,expectedManifestSha256:item.manifestSha256}):
          await restoreIndexerRuntime({sourceDirectory:join(retainedDirectory,item.path),
            destination:join(context.directory,'runtimes',item.id),expectedManifestSha256:item.manifestSha256});
        need(runtime.id===item.id&&runtime.manifestSha256===item.manifestSha256,'SDK_RUNTIME_CHANGED',
          'The restored SDK runtime differs from the original selected source.');
        runtimes[item.id]=ordinaryRuntime(runtime);
      }
      for(const item of snapshot.applications) {
        const directory=join(retainedDirectory,item.path),original=await readPacket(directory,item.manifestSha256,[APPLICATION_SCHEMA]);
        need(original.manifest.id===item.id,'APPLICATION_SOURCE_CHANGED','The received original application identity differs.');
        applications[item.id]={id:item.id,directory,manifestSha256:item.manifestSha256};
      }
      const installations=await this.#restoreInstallations(snapshot,applications,runtimes);
      for(const item of snapshot.watches) {
        if(!current.watchResults[item.watchId]) {
          const original=await context.eventWatches.describe();
          const result=await context.eventWatches.watchReceive({
            sourceDirectory:join(retainedDirectory,item.path),expectedManifestSha256:item.manifestSha256,
            ...(input.watchConnections?.[item.watchId]??{}),expectedRevision:original.revision,
            requestId:'stellar-indexer.'+request.id+'.watch-receive.'+item.watchId,
          });
          current=await this.#requestContext(request.id,saved=>{saved.watchResults[item.watchId]=clone(result);});
        }
      }
      return withLock(context.directory,'receiving.lock',async()=>{
        const state=await context.state(),lockIds=new Set(snapshot.captures.map(item=>item.id));
        for(const capture of Object.values(state.captures)) {
          if(snapshot.captures.some(incoming=>sameCaptureOrigin(capture,incoming))||
            capture.receivedSources?.some(source=>source.workspaceId===snapshot.origin.workspaceId&&
              snapshot.captures.some(item=>item.id===source.captureId)))lockIds.add(capture.id);
        }
        return captureLocks(context.directory,[...lockIds],async()=>{
          const result=await context.edit(async state=>{
            state.applications??={};state.sourceHistory??={};
            const prior=state.sourceHistory[packet.manifestSha256];
            const queryMap={},captureMap={},editionMap={},receivedCaptures=[],receivedEditions=[];
            for(const incoming of snapshot.queries) {
              const sourceWorkspaceId=incoming.sourceWorkspaceId??snapshot.origin.workspaceId;
              const originalQueryId=incoming.originalQueryId??incoming.id;
              const compatible=query=>incoming.versions.every(version=>{
                const existing=query.versions.find(item=>item.version===version.version);
                return !existing||existing.sha256===version.sha256||nativeVersion(existing)===nativeVersion(version);
              });
              const candidateIds=[prior?.queryMap?.[incoming.id],incoming.id,
                sourceWorkspaceId===state.id?originalQueryId:null,
                ...Object.values(state.queries).filter(query=>query.sourceWorkspaceId===sourceWorkspaceId&&
                  (query.originalQueryId??query.id)===originalQueryId).map(query=>query.id),
                ...Object.values(state.sourceHistory)
                  .sort((a,b)=>String(b.receivedAt).localeCompare(String(a.receivedAt)))
                  .flatMap(history=>[
                    history.origin?.workspaceId===snapshot.origin.workspaceId?history.queryMap?.[incoming.id]:null,
                    history.origin?.workspaceId===sourceWorkspaceId?history.queryMap?.[originalQueryId]:null])].filter(Boolean);
              let id=candidateIds.find(candidate=>state.queries[candidate]&&compatible(state.queries[candidate]))??
                (state.queries[incoming.id]?randomUUID():incoming.id);
              let previous=state.queries[id];
              if(previous&&!compatible(previous)){id=randomUUID();previous=null;}
              queryMap[incoming.id]=id;
              const versions=incoming.versions.map(version=>remapVersion(version,id));
              if(previous) {
                for(const version of versions)if(!previous.versions.some(item=>item.version===version.version))previous.versions.push(version);
                previous.versions.sort((a,b)=>a.version-b.version);
                previous.currentVersion=Math.max(previous.currentVersion,incoming.currentVersion);
                previous.name=previous.versions.find(item=>item.version===previous.currentVersion).name;
              }else state.queries[id]={...clone(incoming),id,versions,sourceWorkspaceId,originalQueryId};
            }
            for(const incoming of snapshot.captures) {
              const selectedQueryId=queryMap[incoming.queryId],candidate=clone(incoming);
              candidate.queryId=selectedQueryId;
              const selectedVersion=state.queries[selectedQueryId].versions.find(version=>version.version===incoming.queryVersion);
              need(selectedVersion&&nativeVersion(selectedVersion)===nativeVersion(incoming.query),'QUERY_SOURCE_CHANGED',
                'The received capture must remain attached to its original native query version.');
              candidate.query=clone(selectedVersion);
              let id=prior?.captureMap?.[incoming.id]??incoming.id,previous=state.captures[id];
              if(!prior?.captureMap?.[incoming.id]) {
                const options=Object.values(state.captures).filter(capture=>capture.id===incoming.id||sameCaptureOrigin(capture,incoming)||
                  capture.receivedSources?.some(source=>source.workspaceId===snapshot.origin.workspaceId&&source.captureId===incoming.id));
                const matching=options.filter(capture=>historyRelation(capture,candidate)!=='DIVERGED')
                  .sort((a,b)=>b.pages.length-a.pages.length||b.attempts.length-a.attempts.length);
                if(matching.length){previous=matching[0];id=previous.id;}
              }
              let relation=previous?historyRelation(previous,candidate):'INCOMING';
              if(relation==='DIVERGED'){id=randomUUID();previous=null;relation='INCOMING';}
              captureMap[incoming.id]=id;
              if(relation==='EXISTING') {
                previous.desiredState='PAUSED';if(previous.status!=='COMPLETE')previous.status='PAUSED';
                previous.updatedAt=now();
                previous.receivedSources??=[];
                if(!previous.receivedSources.some(source=>source.manifestSha256===packet.manifestSha256&&source.captureId===incoming.id))
                  previous.receivedSources.push({workspaceId:snapshot.origin.workspaceId,captureId:incoming.id,
                    exportId:packet.manifest.exportId,manifestSha256:packet.manifestSha256,at:now()});
                receivedCaptures.push({...context.captureSummary(previous),received:true,retainedNewer:true,sourceCaptureId:incoming.id});
                if(incoming.editionId&&previous.editionId)editionMap[incoming.editionId]=previous.editionId;
                continue;
              }
              candidate.id=id;
              if(id!==incoming.id)candidate.originalCaptureId=incoming.originalCaptureId??incoming.id;
              const prefix='received/'+packet.manifestSha256+'/workspace';
              // Packet file paths retain the sender's capture identifier even when its branch receives a new local ID.
              for(const attempt of candidate.attempts) {
                const originalDirectory=attempt.directory;
                attempt.directory=prefix+'/'+originalDirectory;
                if(attempt.result)attempt.result={...attempt.result,path:prefix+'/'+attempt.result.path};
                if(['RUNNING','PREPARED'].includes(attempt.phase)) {
                  attempt.phase='INTERRUPTED';attempt.interruptedAt=now();
                }
              }
              for(const page of candidate.pages)page.result={...page.result,path:prefix+'/'+page.result.path};
              candidate.desiredState='PAUSED';
              if(candidate.status!=='COMPLETE')candidate.status='PAUSED';
              candidate.updatedAt=now();
              const alias=input.connectionAlias??candidate.connectionAlias;
              text(alias,'receiving connection alias',80);
              let chosen=null;
              try{chosen=context.connection(alias);}catch(error){if(error.code!=='CONNECTION_REQUIRED')throw error;}
              if(chosen) {
                need(chosen.network===candidate.network,'CONNECTION_NETWORK_CHANGED',
                  'The receiving SDK connection must use the original capture network.');
                candidate.connectionAlias=chosen.alias;candidate.connection=publicConnection(chosen);
                candidate.bindings.push({connection:publicConnection(chosen),at:now(),reason:'received'});
              }else{
                candidate.connectionAlias=alias;candidate.connection={...candidate.connection,alias};
              }
              candidate.receivedSources=[...(previous?.receivedSources??[]),...(candidate.receivedSources??[]),
                {workspaceId:snapshot.origin.workspaceId,captureId:incoming.id,exportId:packet.manifest.exportId,
                  manifestSha256:packet.manifestSha256,at:now()}];
              if(candidate.editionId) {
                const original=snapshot.editions.find(edition=>edition.id===incoming.editionId);
                need(original,'SOURCE_MANIFEST_INVALID','The received completed capture is missing its original edition.');
                const originalEditionId=original.originalEditionId??original.id;
                const editionCandidates=[prior?.editionMap?.[original.id],original.id,originalEditionId,previous?.editionId,
                  ...Object.values(state.editions).filter(edition=>edition.captureId===id&&edition.sha256===original.sha256)
                    .map(edition=>edition.id)].filter(Boolean);
                let editionId=editionCandidates.find(candidate=>state.editions[candidate]?.sha256===original.sha256&&
                  state.editions[candidate].captureId===id)??(state.editions[original.id]?randomUUID():original.id);
                editionMap[original.id]=editionId;candidate.editionId=editionId;
                const edition={...clone(original),id:editionId,captureId:id,queryId:selectedQueryId,
                  query:clone(candidate.query),pages:clone(candidate.pages),
                  file:{...original.file,path:prefix+'/'+original.file.path},
                  originalEditionId:original.originalEditionId??original.id,
                  originalCaptureId:original.originalCaptureId??original.captureId,
                  receivedFrom:{workspaceId:snapshot.origin.workspaceId,editionId:original.id,
                    manifestSha256:packet.manifestSha256}};
                state.editions[editionId]=edition;receivedEditions.push(clone(edition));
              }
              state.captures[id]=candidate;
              receivedCaptures.push({...context.captureSummary(candidate),received:true,retainedNewer:false,sourceCaptureId:incoming.id});
            }
            for(const [id,runtime]of Object.entries(runtimes)) {
              need(!state.runtimes[id]||state.runtimes[id].manifestSha256===runtime.manifestSha256,'SDK_RUNTIME_CHANGED',
                'An existing native runtime has different original bytes.');
              state.runtimes[id]??=runtime;
            }
            for(const [id,application]of Object.entries(applications)) {
              need(!state.applications[id]||state.applications[id].manifestSha256===application.manifestSha256,
                'APPLICATION_SOURCE_CHANGED','An existing original application has different source bytes.');
              state.applications[id]??=application;
            }
            const identityMapping=Object.entries(queryMap).every(([from,to])=>from===to)&&
              Object.entries(captureMap).every(([from,to])=>from===to);
            if(identityMapping)for(const original of snapshot.requests) {
              if(!plain(original)||!BUSINESS_ACTIONS.has(original.action)||!original.result)continue;
              hash(original.id);text(original.requestId,'original request ID',250);
              need(original.id===digest(original.requestId)&&original.inputSha256===digest(canonical(original.nativeArgs)),
                'SOURCE_MANIFEST_INVALID','An original saved request differs from its native arguments.');
              if(!own(state.requests,original.id))state.requests[original.id]={...clone(original),
                receivedFrom:{workspaceId:snapshot.origin.workspaceId,manifestSha256:packet.manifestSha256}};
            }
            state.installations??={};
            for(const installation of installations)state.installations[installation.id]=clone(installation);
            const snapshotFile={...packet.descriptors.get(packet.manifest.snapshot),
              path:'received/'+packet.manifestSha256+'/'+packet.manifest.snapshot};
            state.sourceHistory[packet.manifestSha256]={exportId:packet.manifest.exportId,
              manifestSha256:packet.manifestSha256,origin:clone(snapshot.origin),directory:retainedDirectory,
              source:snapshotFile,queryMap,captureMap,editionMap,receivedAt:now()};
            for(const editionId of Object.values(editionMap))
              if(state.editions[editionId]&&!receivedEditions.some(item=>item.id===editionId))receivedEditions.push(clone(state.editions[editionId]));
            const watches=Object.values(current.watchResults).map(item=>clone(item.watch));
            const result=delivery?{captures:receivedCaptures,editions:receivedEditions,watches,received:true,
              manifestSha256:packet.manifestSha256,sourceDirectory:retainedDirectory,installations}:
              {capture:receivedCaptures[0],edition:receivedEditions.find(item=>item.captureId===receivedCaptures[0]?.id)??null,
                received:true,manifestSha256:packet.manifestSha256,sourceDirectory:retainedDirectory,installations};
            state.requests[request.id].context.result=clone(result);
            return result;
          });
          return context.finish(request.id,result);
        });
      });
    });
  }
}
