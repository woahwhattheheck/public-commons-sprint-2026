// MIT. ArcGIS onboarding and deployment over the original publisher and release engines.
import { constants } from 'node:fs';
import { open, lstat, readdir, unlink, link, rename } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { getArcgisCatalog, requestId, checkedText } from './catalog.mjs';
import { createArcgisCapture, importArcgisCapture, continueArcgisCapture, captureStatus,
  readArcgisCapture, readArcgisArtifact } from '../capture.mjs';
import { createArcgisSource, inspectArcgisPublicationSource } from '../publisher.mjs';
import { exportArcgisDeployment, inspectArcgisDeployment, stageArcgisDeployment,
  prepareArcgisReleaseReceiving } from '../deployment.mjs';
import { startReleaseConsole } from '../../../sf82-seller-pilot/release-console.mjs';
import { bytes, digest, identity, object, readJson, readPrivate, hashPrivate, privateDirectory,
  createFile, syncDirectory, fault, stamp } from '../../postgres/publisher/files.mjs';

const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const MAX_UPLOAD = 67108864, MAX_UPLOAD_TOTAL = 268435456;
const safeError = issue => /^[A-Z0-9_]{1,80}$/.test(issue?.code ?? '') ? issue.code : 'ARCGIS_OPERATION_FAILED';
function only(value, keys) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault('ARCGIS_INPUT_INVALID');
}
async function absent(path) {
  try { await lstat(path); return false; } catch (issue) { if (issue.code === 'ENOENT') return true; throw issue; }
}
async function retainBytes(path, content) {
  const directory = dirname(path);
  await privateDirectory(directory, true);
  if (!await absent(path)) {
    const previous = await readPrivate(path, Math.max(content.length, 262144));
    if (!previous.equals(content)) throw fault('ARCGIS_RETAINED_OUTPUT_CHANGED');
    return;
  }
  const temporary = join(directory, '.arcgis-output-' + randomUUID() + '.tmp');
  try {
    await createFile(temporary, content);
    try { await link(temporary,path); }
    catch (issue) {
      if (issue.code !== 'EEXIST') throw issue;
      if (!(await readPrivate(path, Math.max(content.length,262144))).equals(content)) throw fault('ARCGIS_RETAINED_OUTPUT_CHANGED');
    }
    await unlink(temporary); await syncDirectory(directory);
  } finally { try { await unlink(temporary); } catch (issue) { if (issue.code !== 'ENOENT') throw issue; } }
}
function pageBounds(options, name) {
  const limit = options.limit ?? 25, offset = options[name + 'Offset'] ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0)
    throw fault('ARCGIS_PAGE_INVALID');
  return {limit,offset};
}
function defaultColumns(capture) {
  const result = { object_id: { field: capture.metadata.oid } };
  const scalar = new Set(['esriFieldTypeOID','esriFieldTypeObjectID','esriFieldTypeSmallInteger','esriFieldTypeInteger',
    'esriFieldTypeBigInteger','esriFieldTypeBigInt','esriFieldTypeDate','esriFieldTypeSingle','esriFieldTypeDouble',
    'esriFieldTypeString','esriFieldTypeGUID','esriFieldTypeGlobalID','esriFieldTypeXML','esriFieldTypeDateOnly',
    'esriFieldTypeTimeOnly','esriFieldTypeTimestampOffset']);
  for (const field of capture.state.query.outFields) {
    if (field === capture.metadata.oid || !NAME.test(field) || ['constructor','prototype','__proto__','object_id',
      'attributes_json','geometry_json','spatial_reference_json'].includes(field) || Object.keys(result).length >= 60) continue;
    if (scalar.has(capture.metadata.fields.get(field).type)) result[field] = {field};
  }
  result.attributes_json = {source:'attributes'};
  if (capture.state.query.returnGeometry) {
    result.geometry_json = {source:'geometry'}; result.spatial_reference_json = {source:'spatialReference'};
  }
  return result;
}
export async function openArcgisWorkbench({publisher, releaseDirectory, environment = process.env} = {}) {
  const catalog = getArcgisCatalog(publisher), {db,root} = catalog;
  const releases = resolve(releaseDirectory ?? join(root,'release-store'));
  // The original exporter requires packages outside both publisher and dataset state.
  const packages = resolve(publisher.directory+'-arcgis-deployments');
  let consoleHandle = null, consoleOpening = null, closing = null;
  const row = (table,id,code) => {
    requestId(id);
    const found = catalog.unpack(db.prepare('SELECT data FROM ' + table + ' WHERE id=?').get(id));
    if (!found) throw fault(code, 'Choose a retained item in this workspace.',404);
    return found;
  };
  const capture = id => row('arcgis_captures',id,'ARCGIS_CAPTURE_NOT_FOUND');
  const uploadRecord = id => row('arcgis_uploads',id,'ARCGIS_UPLOAD_NOT_FOUND');
  const deployment = id => row('arcgis_deployments',id,'ARCGIS_DEPLOYMENT_NOT_FOUND');
  const saveCapture = value => {
    const now = stamp(), previous = db.prepare('SELECT created FROM arcgis_captures WHERE id=?').get(value.id);
    db.prepare('INSERT INTO arcgis_captures VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated,data=excluded.data')
      .run(value.id,previous?.created ?? now,now,JSON.stringify({...value,updatedAt:now}));
    return capture(value.id);
  };
  const saveDeployment = value => {
    const now = stamp(), previous = db.prepare('SELECT created FROM arcgis_deployments WHERE id=?').get(value.id);
    db.prepare('INSERT INTO arcgis_deployments VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated,data=excluded.data')
      .run(value.id,previous?.created ?? now,now,JSON.stringify({...value,updatedAt:now}));
    return deployment(value.id);
  };
  const visibleCapture = value => {
    const {directory,input,inputHash,owned,...visible}=value; return visible;
  };
  const visibleDeployment = value => {
    const {sellerUploadId,inputHash,...visible}=value; return visible;
  };
  async function updateCapture(value,error = null) {
    try {
      const native = await captureStatus(value.directory);
      return saveCapture({...value, nativeId:native.id, state:native.state, captureSha256:native.captureSha256,
        selectedRecords:native.selectedRecords,retainedPages:native.retainedPages,pendingPages:native.pendingPages,
        sourceBytes:native.sourceBytes,layerUrl:native.layerUrl,query:native.query,spatialReference:native.spatialReference,
        completedAt:native.completedAt,error});
    } catch (issue) { return saveCapture({...value,error:error ?? safeError(issue)}); }
  }
  // Only reserved staging names from this module are collected while the original workspace lease is held.
  async function collect(directory) {
    for (const entry of await readdir(directory,{withFileTypes:true})) {
      if (!/^\.arcgis-(upload|output|source)-[a-f0-9-]{36}\.tmp$/.test(entry.name)) continue;
      const path=join(directory,entry.name),stat=await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077) throw fault('ARCGIS_STAGING_FILE_INVALID');
      await unlink(path);
    }
  }
  await collect(join(root,'uploads'));
  for (const item of await readdir(join(root,'editions'),{withFileTypes:true}))
    if (item.isDirectory() && /^[a-f0-9-]{36}$/.test(item.name)) await collect(join(root,'editions',item.name));
  // Enroll the existing exact source capture, without rewriting its source file, selecting another edition,
  // or copying the original dataset/history. New workspaces have no source until an explicit selection.
  if (!db.prepare('SELECT 1 FROM arcgis_captures LIMIT 1').get() && publisher.settings.sourceFile !== join(root,'initial-source.json')) {
    const original=await readJson(publisher.settings.sourceFile), directory=resolve(dirname(publisher.settings.sourceFile),original.captureDirectory);
    const native=await captureStatus(directory);
    if (native.captureSha256 !== original.captureSha256) throw fault('ARCGIS_CONFIGURED_CAPTURE_CHANGED');
    if (!db.prepare('SELECT 1 FROM arcgis_captures WHERE id=?').get(native.id))
      await updateCapture({id:native.id,title:'Original configured source',mode:'existing',owned:false,directory,
        createdAt:stamp(),input:null,inputHash:null});
  }
  let originalSourceReady = !await absent(publisher.settings.sourceFile);
  async function status(options = {}) {
    const pages = {};
    function list(name,table,project) {
      const {limit,offset}=pageBounds(options,name),total=db.prepare('SELECT COUNT(*) AS total FROM '+table).get().total;
      const items=db.prepare('SELECT data FROM '+table+' ORDER BY created DESC,id DESC LIMIT ? OFFSET ?').all(limit,offset).map(catalog.unpack);
      pages[name]={limit,offset,total,next:offset+items.length<total?offset+items.length:null,previous:offset?Math.max(0,offset-limit):null};
      return items.map(project);
    }
    const current=catalog.meta(),active=catalog.active();
    const captures=list('captures','arcgis_captures',visibleCapture);
    if (active?.captureId) {
      const item=captures.find(value=>value.id===active.captureId);
      if (item) {
        try {
          const live=await captureStatus(capture(item.id).directory);
          Object.assign(item,{state:live.state,captureSha256:live.captureSha256,selectedRecords:live.selectedRecords,
            retainedPages:live.retainedPages,pendingPages:live.pendingPages,sourceBytes:live.sourceBytes});
        } catch {}
      }
    }
    return {schema:'stellar-forge.arcgis-workbench.v1',workbenchId:catalog.workbenchId,revision:current.revision,
      currentEditionId:current.current,sourceReady:Boolean(current.current)||originalSourceReady,active,
      captures,editions:list('editions','arcgis_editions',value=>({...value,selected:value.id===current.current})),
      deployments:list('deployments','arcgis_deployments',visibleDeployment),
      releaseReady:!await absent(join(releases,'state.json')),
      uploads:db.prepare('SELECT data FROM arcgis_uploads ORDER BY created DESC,id DESC').all().map(catalog.unpack)
        .map(({path,...value})=>value),pages,releaseDirectory:releases};
  }
  async function upload(stream,input) {
    only(input,['requestId','name','sha256']);
    const id=requestId(input.requestId), name=checkedText(input.name,'the source filename');
    if (/[\/\\]/.test(name) || !HASH.test(input.sha256 ?? '')) throw fault('ARCGIS_UPLOAD_DECLARATION_INVALID');
    const started=catalog.start('upload',input,async signal=>{
      const existing=db.prepare('SELECT data FROM arcgis_uploads WHERE id=?').get(id);
      const prior=existing?catalog.unpack(existing):null;
      const path=join(root,'uploads',id+'.json'),temporary=join(root,'uploads','.arcgis-upload-'+randomUUID()+'.tmp');
      let handle,size=0;
      const hash=createHash('sha256');
      try {
        handle=await open(temporary,'wx',0o600);
        const total=db.prepare('SELECT data FROM arcgis_uploads').all().map(catalog.unpack)
          .reduce((sum,value)=>sum+value.bytes,0)-(prior?.bytes??0);
        for await (const chunk of stream) {
          if (signal.aborted) throw fault('ARCGIS_UPLOAD_INTERRUPTED');
          size+=chunk.length;
          if (size>MAX_UPLOAD || total+size>MAX_UPLOAD_TOTAL) throw fault('ARCGIS_UPLOAD_TOO_LARGE','Uploads allow64MiB per file and256MiB retained ingress. Remove completed ingress copies before another import.',413);
          hash.update(chunk); await handle.writeFile(chunk);
        }
        const sha256=hash.digest('hex');
        if (!size || sha256!==input.sha256) throw fault('ARCGIS_UPLOAD_BYTES_CHANGED');
        await handle.sync(); await handle.close(); handle=null;
        // Source uploads must be JSON, but are not normalized or rewritten.
        await readArcgisArtifact(temporary,MAX_UPLOAD);
        if (prior && (prior.sha256!==sha256 || prior.bytes!==size || prior.name!==name)) throw fault('ARCGIS_UPLOAD_CHANGED',undefined,409);
        try {await link(temporary,path);} catch(issue) {
          if (issue.code!=='EEXIST') throw issue;
          const value=await hashPrivate(path,MAX_UPLOAD);
          if (value.hash!==sha256 || value.bytes!==size) throw fault('ARCGIS_UPLOAD_CHANGED');
        }
        await unlink(temporary);await syncDirectory(join(root,'uploads'));
        const result={id,name,bytes:size,sha256,path,createdAt:prior?.createdAt??stamp()};
        db.prepare('INSERT INTO arcgis_uploads VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
          .run(id,result.createdAt,JSON.stringify(result));
        const {path:privatePath,...visible}=result;return visible;
      } finally {
        await handle?.close();try{await unlink(temporary);}catch(issue){if(issue.code!=='ENOENT')throw issue;}
      }
    });
    if (started.started) return catalog.wait(id);
    // A duplicate request still verifies its actual body before reusing the retained result.
    let replayBytes=0;const replayHash=createHash('sha256');
    for await (const chunk of stream) {
      replayBytes+=chunk.length;if(replayBytes>MAX_UPLOAD)throw fault('ARCGIS_UPLOAD_TOO_LARGE',undefined,413);
      replayHash.update(chunk);
    }
    if(!replayBytes||replayHash.digest('hex')!==input.sha256)throw fault('ARCGIS_UPLOAD_BYTES_CHANGED');
    return catalog.wait(id);
  }
  function removeUpload(input) {
    only(input,['requestId','uploadId','expectedSha256']);
    return catalog.start('remove-upload',input,async()=>{
      requestId(input.uploadId);
      const previous=db.prepare('SELECT data FROM arcgis_uploads WHERE id=?').get(input.uploadId);
      if (!previous) return {removed:input.uploadId};
      const value=catalog.unpack(previous);
      if(value.sha256!==input.expectedSha256)throw fault('ARCGIS_UPLOAD_CHANGED',undefined,409);
      if(!await absent(value.path)){
        const found=await hashPrivate(value.path,MAX_UPLOAD);
        if(found.hash!==value.sha256||found.bytes!==value.bytes)throw fault('ARCGIS_UPLOAD_CHANGED');
        await unlink(value.path);await syncDirectory(join(root,'uploads'));
      }
      db.prepare('DELETE FROM arcgis_uploads WHERE id=?').run(value.id);
      return {removed:value.id};
    });
  }
  async function uploadPath(id) {
    const value=uploadRecord(id),actual=await hashPrivate(value.path,MAX_UPLOAD);
    if(actual.hash!==value.sha256||actual.bytes!==value.bytes)throw fault('ARCGIS_UPLOAD_CHANGED');
    return value.path;
  }
  function prepareCapture(input) {
    only(input,['requestId','title','mode','connection','files']);
    const id=requestId(input.requestId),title=checkedText(input.title,'a source capture name');
    if(!['live','files'].includes(input.mode)||!object(input.connection))throw fault('ARCGIS_CAPTURE_INPUT_INVALID');
    return catalog.start('prepare-capture',input,async()=>{
      const old=db.prepare('SELECT data FROM arcgis_captures WHERE id=?').get(id);
      const directory=join(root,'captures',id);
      let value=old?catalog.unpack(old):saveCapture({id,title,mode:input.mode,owned:true,directory,
        createdAt:stamp(),state:'PREPARING',input,inputHash:identity(input)});
      if(value.inputHash!==identity(input))throw fault('ARCGIS_CAPTURE_INPUT_CHANGED');
      if(!await absent(join(directory,'capture.json')))return {capture:visibleCapture(await updateCapture(value))};
      try {
        if(input.mode==='live') {
          if(input.files!==undefined)throw fault('ARCGIS_CAPTURE_INPUT_INVALID');
          await createArcgisCapture({...input.connection,directory});
        } else {
          only(input.files,['metadata','pages','geometryPages','geometryField','representation']);
          if(!Array.isArray(input.files.pages)||!input.files.pages.length)throw fault('ARCGIS_IMPORT_FILES_REQUIRED');
          const c=input.connection;
          only(c,['layerUrl','query','maxRows','maxSourceBytes']);
          await importArcgisCapture({directory,...c,metadataFile:await uploadPath(input.files.metadata),
            pageFiles:await Promise.all(input.files.pages.map(uploadPath)),
            representation:input.files.representation??'parsed-json',
            geometryJoin:input.files.geometryPages?.length?{field:input.files.geometryField,
              pageFiles:await Promise.all(input.files.geometryPages.map(uploadPath))}:null});
        }
        return {capture:visibleCapture(await updateCapture(value))};
      } catch(issue) { await updateCapture(value,safeError(issue));throw issue; }
    },{captureId:id});
  }
  function continueCapture(input) {
    only(input,['requestId','captureId','maxPages']);
    const original=capture(input.captureId);
    return catalog.start('continue-capture',input,async signal=>{
      try {
        await continueArcgisCapture(original.directory,{environment,signal,maxPages:input.maxPages??Infinity});
        return {capture:visibleCapture(await updateCapture(original))};
      } catch(issue) {await updateCapture(original,safeError(issue));throw issue;}
    },{captureId:original.id});
  }
  async function detail(id) {
    const original=capture(id),current=await captureStatus(original.directory);
    const view=visibleCapture({...original,...current,id:original.id,nativeId:current.id});
    if(current.state!=='COMPLETE')return {capture:view,fields:[],samples:[],sampleTotal:current.selectedRecords};
    const loaded=await readArcgisCapture(original.directory,current.captureSha256);
    try {
      const fields=loaded.state.query.outFields.map(name=>loaded.metadata.fields.get(name));
      let sampleBytes=0;
      const samples=[];
      for(const feature of loaded.records.values()){
        const value={attributes:structuredClone(feature.attributes)},size=Buffer.byteLength(JSON.stringify(value));
        if(samples.length>=5||sampleBytes+size>262144)break;
        samples.push(value);sampleBytes+=size;
      }
      return {capture:view,fields,objectIdField:loaded.metadata.oid,geometryType:loaded.metadata.geometryType,
        spatialReference:loaded.state.spatialReference,query:loaded.state.query,defaultColumns:defaultColumns(loaded),
        samples,sampleTotal:loaded.records.size};
    } finally {loaded.records.clear();}
  }
  function createEdition(input) {
    only(input,['requestId','title','captureId','expectedCaptureSha256','query','columns']);
    const id=requestId(input.requestId),title=checkedText(input.title,'a source edition name'),original=capture(input.captureId);
    return catalog.start('create-edition',input,async()=>{
      const previous=db.prepare('SELECT data FROM arcgis_editions WHERE id=?').get(id);
      if(previous)return {edition:catalog.unpack(previous)};
      const current=await captureStatus(original.directory);
      if(current.state!=='COMPLETE'||current.captureSha256!==input.expectedCaptureSha256)
        throw fault('ARCGIS_CAPTURE_REVIEW_CHANGED','Reload and review this complete capture before saving a mapping.',409);
      const directory=join(root,'editions',id),path=join(directory,'source.json');
      await privateDirectory(directory,true);await collect(directory);
      const temporary=join(directory,'.arcgis-source-'+randomUUID()+'.tmp');
      try {
        await createArcgisSource({captureDirectory:original.directory,output:temporary,query:input.query??'records',columns:input.columns});
        const content=await readPrivate(temporary);
        await retainBytes(path,content);
        const description=await inspectArcgisPublicationSource(path);
        const value={id,title,createdAt:stamp(),captureId:original.id,captureSha256:current.captureSha256,
          sourceHash:description.hash,sourceBytes:content.length,query:input.query??'records'};
        db.prepare('INSERT INTO arcgis_editions VALUES(?,?,?)').run(id,value.createdAt,JSON.stringify(value));
        return {edition:value,source:description};
      } finally {try{await unlink(temporary);}catch(issue){if(issue.code!=='ENOENT')throw issue;}}
    });
  }
  async function editionDetail(id) {
    const edition=catalog.edition(id),path=join(root,'editions',id,'source.json');
    if(digest(await readPrivate(path))!==edition.sourceHash)throw fault('ARCGIS_EDITION_SOURCE_CHANGED');
    return {edition,source:await inspectArcgisPublicationSource(path)};
  }
  function exportDeployment(input) {
    only(input,['requestId','run','sellerUploadId','label']);
    const id=requestId(input.requestId),label=checkedText(input.label,'a deployment label');
    return catalog.start('export-deployment',input,async()=>{
      const saved=publisher.run(input.run);
      if(saved.state!=='PUBLISHED')throw fault('ARCGIS_PUBLISHED_RUN_REQUIRED','Select an already published extraction.',409);
      const sellerFile=await uploadPath(input.sellerUploadId),directory=join(packages,id);
      await privateDirectory(packages,true);
      let value=db.prepare('SELECT data FROM arcgis_deployments WHERE id=?').get(id);
      value=value?catalog.unpack(value):saveDeployment({id,run:input.run,label,sellerUploadId:input.sellerUploadId,
        inputHash:identity(input),state:'PREPARING',packageDirectory:directory,releaseDirectory:releases,releaseId:null,release:null,createdAt:stamp()});
      if(value.inputHash!==identity(input))throw fault('ARCGIS_DEPLOYMENT_INPUT_CHANGED');
      const result=await exportArcgisDeployment({publisher,run:input.run,sellerFile,directory});
      value=saveDeployment({...value,state:'EXPORTED',inspection:result,error:null});
      return {deployment:visibleDeployment(value),inspection:result};
    });
  }
  function stage(input) {
    only(input,['requestId','deploymentId','releaseId','label','runtime']);
    const original=deployment(input.deploymentId);
    return catalog.start('stage-deployment',input,async()=>{
      const result=await stageArcgisDeployment({packageDirectory:original.packageDirectory,releaseDirectory:releases,
        id:input.releaseId,label:input.label??original.label,runtime:input.runtime??{port:0}});
      const output=join(root,'deployments',original.id+'-receiving.json');
      const receiving=await prepareArcgisReleaseReceiving({releaseDirectory:releases,releaseId:result.release.id,output});
      const value=saveDeployment({...original,state:'STAGED',releaseId:result.release.id,release:result.release,receiving,error:null});
      return {deployment:visibleDeployment(value),...result};
    });
  }
  const downloadNames=['dataset.csv','dataset.json','seller.json','source.json','binding.json','arcgis-receiving.json','release-receiving.json'];
  async function deploymentDetail(id) {
    const value=deployment(id),inspection=await inspectArcgisDeployment(value.packageDirectory),downloads=[];
    for(const name of downloadNames) {
      const path=name==='release-receiving.json'?join(root,'deployments',id+'-receiving.json'):join(value.packageDirectory,name);
      if(await absent(path))continue;
      const hash=await hashPrivate(path,name==='dataset.csv'?268435456:262144);
      downloads.push({name,label:name,bytes:hash.bytes,sha256:hash.hash,
        url:'/api/arcgis/download?deploymentId='+encodeURIComponent(id)+'&name='+encodeURIComponent(name)});
    }
    return {deployment:visibleDeployment(value),inspection,downloads};
  }
  async function download(id,name) {
    if(!downloadNames.includes(name))throw fault('ARCGIS_DOWNLOAD_NOT_FOUND',undefined,404);
    const value=deployment(id);
    await inspectArcgisDeployment(value.packageDirectory);
    const path=name==='release-receiving.json'?join(root,'deployments',id+'-receiving.json'):join(value.packageDirectory,name),expected=await hashPrivate(path,name==='dataset.csv'?268435456:262144);
    return {path,name,bytes:expected.bytes,sha256:expected.hash,type:name.endsWith('.csv')?'text/csv; charset=utf-8':'application/json; charset=utf-8'};
  }
  async function releaseConsole(input) {
    only(input,['requestId']);requestId(input.requestId);
    if(closing)throw fault('ARCGIS_WORKSPACE_CLOSED');
    if(await absent(releases))throw fault('ARCGIS_STAGE_RELEASE_FIRST','Stage a deployment before opening its original release controls.',409);
    const request=await catalog.control('release-console',input,async()=>{
      const reused=Boolean(consoleHandle);
      if(!consoleHandle) {
        consoleOpening??=startReleaseConsole(releases,{port:0,env:environment}).then(value=>{consoleHandle=value;return value;}).finally(()=>{consoleOpening=null;});
        await consoleOpening;
      }
      return {opened:true,origin:consoleHandle.url,reused};
    });
    // Only the live owner returns its private capability URL; credentials never enter the request journal.
    return {request,...request.result,...(consoleHandle?{url:consoleHandle.operatorUrl,origin:consoleHandle.url}:{closed:true})};
  }
  return {publisher,workbenchId:catalog.workbenchId,status,upload,removeUpload,prepareCapture,continueCapture,
    pause:async input=>{
      only(input,['requestId','captureId']);requestId(input.requestId);requestId(input.captureId);
      const request=await catalog.control('pause-capture',input,async()=>{
        const outcome=await catalog.pause(input.captureId);
        return {paused:outcome.paused,captureId:input.captureId,continuationRequestId:outcome.request?.id??null};
      });
      return {request,...request.result};
    },
    capture:detail,createEdition,edition:editionDetail,select:catalog.select,request:catalog.request,
    exportDeployment,stage,deployment:deploymentDetail,download,releaseConsole,
    close:()=>closing??=(async()=>{
      await catalog.drain();
      try {await consoleOpening;await consoleHandle?.close();} finally {consoleHandle=null;}
    })()};
}
