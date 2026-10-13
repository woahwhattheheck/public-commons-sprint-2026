// MIT. Private SQLite configuration workspace, exact intents and editable receiving.
import { DatabaseSync } from 'node:sqlite';
import { existsSync,mkdirSync,lstatSync,realpathSync,chmodSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical,copy,digest,fail,text,parseJson,now,seal,MAX_PACKAGE_BYTES } from '../gis/shared.mjs';
import { inspectSource } from './source.mjs';
import { ServiceConfigurationModel,WORKSPACE_SCHEMA,DATABASE_SCHEMA,recordId,recordSummary,control,fingerprint,validateHostInput,validateWorkspacePackage } from './model.mjs';
import { fileResult,jsonFile,previewCsv,releaseReport } from './formats.mjs';
export { WORKSPACE_SCHEMA,DATABASE_SCHEMA,validateWorkspacePackage };
const actions={putProfile:'profile-save',importSource:'source-import',createPreview:'preview-create',createRelease:'release-create'};
export function openWorkspace(suppliedDirectory,{create=true}={}){
  let directory=resolve(text(suppliedDirectory,'Service workspace directory',4096));
  if(!existsSync(directory)){if(!create)fail('WORKSPACE_NOT_FOUND','Initialize or receive the service workspace first.',404);mkdirSync(directory,{recursive:true,mode:0o700});}
  if(!lstatSync(directory).isDirectory())fail('INVALID_WORKSPACE_DIRECTORY','Select a real private directory.');
  directory=realpathSync(directory);const filename=join(directory,'open311-service-configuration.sqlite');
  if(existsSync(filename)){const stat=lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink())fail('INVALID_WORKSPACE_FILE','The service database must be a regular file.');}
  else if(!create)fail('WORKSPACE_NOT_FOUND','Initialize or receive the service workspace first.',404);
  const db=new DatabaseSync(filename);chmodSync(filename,0o600);db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');let closed=false;
  function transaction(action,write=false){
    if(closed)fail('WORKSPACE_CLOSED','The service configuration workspace is closed.',409);
    db.exec(write?'BEGIN IMMEDIATE':'BEGIN');try{const result=action();db.exec('COMMIT');return result;}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  }
  const metadata=()=>JSON.parse(db.prepare('SELECT value FROM service_meta WHERE id=1').get().value);
  const saveMeta=value=>db.prepare('UPDATE service_meta SET value=? WHERE id=1').run(canonical(value));
  try{transaction(()=>{
    const table=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='service_meta'").get();
    if(!table){
      if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length)fail('WRONG_WORKSPACE_DATABASE','The selected database belongs to another application.');
      db.exec('CREATE TABLE service_meta(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL); CREATE TABLE service_records(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,id TEXT NOT NULL,entity_id TEXT NOT NULL,value TEXT NOT NULL,summary TEXT NOT NULL,UNIQUE(kind,id)); CREATE INDEX service_entity ON service_records(kind,entity_id,seq); CREATE TABLE service_operations(seq INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,input_sha TEXT NOT NULL,input TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL);');
      const stamp=now();db.prepare('INSERT INTO service_meta VALUES(1,?)').run(canonical({schema:DATABASE_SCHEMA,workspaceId:randomUUID(),revision:0,createdAt:stamp,updatedAt:stamp,receivedFrom:[]}));
    }
    if(metadata().schema!==DATABASE_SCHEMA)fail('UNSUPPORTED_WORKSPACE','This service workspace database edition is unsupported.');
  },true);}catch(error){db.close();throw error;}
  const adapter={
    all:kind=>db.prepare('SELECT value FROM service_records WHERE kind=? ORDER BY seq').all(kind).map(row=>JSON.parse(row.value)),
    find:(kind,id)=>{const row=db.prepare('SELECT value FROM service_records WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(row.value):null;},
    save:(kind,value)=>db.prepare('INSERT INTO service_records(kind,id,entity_id,value,summary) VALUES(?,?,?,?,?)').run(kind,recordId(kind,value),value.id,canonical(value),canonical(recordSummary(kind,value))),
    records:()=>db.prepare('SELECT kind,id,value FROM service_records ORDER BY seq').all().map(row=>({kind:row.kind,id:row.id,value:JSON.parse(row.value)}))
  };
  const model=()=>new ServiceConfigurationModel(adapter,metadata());
  function operationInside(requestId){
    text(requestId,'Stable request ID',200);const row=db.prepare('SELECT * FROM service_operations WHERE request_id=?').get(requestId);
    return row?{requestId,kind:row.kind,state:'SUCCEEDED',inputSha256:row.input_sha,input:JSON.parse(row.input),result:JSON.parse(row.result),createdAt:row.created_at}:null;
  }
  function operation(requestId){return transaction(()=>operationInside(requestId));}
  const operations=()=>db.prepare('SELECT * FROM service_operations ORDER BY seq').all().map(row=>({requestId:row.request_id,kind:row.kind,state:'SUCCEEDED',inputSha256:row.input_sha,input:JSON.parse(row.input),result:JSON.parse(row.result),createdAt:row.created_at}));
  const saveOperation=(kind,input,result,createdAt)=>db.prepare('INSERT INTO service_operations(request_id,kind,input_sha,input,result,created_at) VALUES(?,?,?,?,?,?)').run(input.requestId,kind,fingerprint(kind,input),canonical(input),canonical(result),createdAt);
  function state(){return transaction(()=>{
    const recent=db.prepare('SELECT request_id,kind,created_at FROM service_operations ORDER BY seq DESC LIMIT 30').all().map(row=>({requestId:row.request_id,kind:row.kind,state:'SUCCEEDED',createdAt:row.created_at}));
    return {...model().state(recent),directory};
  });}
  function mutate(kind,supplied){
    const input=control(supplied);
    return transaction(()=>{
      const prior=operationInside(input.requestId);if(prior){if(prior.kind!==kind||prior.inputSha256!==fingerprint(kind,input))fail('REQUEST_ID_CONFLICT','This request ID already names a different retained service action.',409);return prior.result;}
      const meta=metadata();if(meta.revision!==input.expectedRevision)fail('REVISION_CONFLICT','The service workspace changed after the observed revision.',409,{expectedRevision:input.expectedRevision,currentRevision:meta.revision});
      const createdAt=now(),value=new ServiceConfigurationModel(adapter,meta).apply(kind,input,createdAt),result={workspaceId:meta.workspaceId,revision:meta.revision+1,requestId:input.requestId,...value};
      saveMeta({...meta,revision:result.revision,updatedAt:createdAt});saveOperation(kind,input,result,createdAt);return result;
    },true);
  }
  function workspaceExportInside(){
    const meta=metadata(),bundle=seal({schema:WORKSPACE_SCHEMA,workspaceId:meta.workspaceId,revision:meta.revision,createdAt:meta.createdAt,updatedAt:meta.updatedAt,exportedAt:meta.updatedAt,records:adapter.records(),operations:operations(),receivedFrom:copy(meta.receivedFrom)});
    if(Buffer.byteLength(canonical(bundle))>MAX_PACKAGE_BYTES)fail('PACKAGE_SIZE','The complete editable service workspace exceeds 256 MiB.',413);
    return bundle;
  }
  function workspaceExport(){return transaction(workspaceExportInside);}
  function receive(supplied){
    const original=control(supplied);
    if(typeof original.originalText!=='string'||Buffer.byteLength(original.originalText)>MAX_PACKAGE_BYTES)fail('PACKAGE_SIZE','Receive one complete service workspace of at most 256 MiB.',413);
    validateHostInput(original,'workspace',original.originalText);
    const candidate=parseJson(original.originalText,'Complete service workspace'),input={requestId:original.requestId,expectedRevision:original.expectedRevision,originalFile:{bytes:Buffer.byteLength(original.originalText),sha256:digest(original.originalText)},incomingPackageSha256:candidate.sha256,...(original.hostInput?{hostInput:copy(original.hostInput)}:{})};
    return transaction(()=>{
      const prior=operationInside(input.requestId);if(prior){if(prior.kind!=='workspace-receive'||prior.inputSha256!==fingerprint('workspace-receive',input))fail('REQUEST_ID_CONFLICT','This request ID names a different retained receiving action.',409);return prior.result;}
      const meta=metadata();
      if(meta.revision!==input.expectedRevision)fail('REVISION_CONFLICT','The receiving destination changed after it was observed.',409,{expectedRevision:input.expectedRevision,currentRevision:meta.revision});
      if(meta.revision!==0||db.prepare('SELECT 1 FROM service_records LIMIT 1').get()||db.prepare('SELECT 1 FROM service_operations LIMIT 1').get())fail('RECEIVE_EMPTY_REQUIRED','Open a new empty service workspace directory to receive the complete editable handover.',409);
      const bundle=validateWorkspacePackage(original.originalText);
      if(bundle.operations.some(op=>op.requestId===input.requestId))fail('REQUEST_ID_CONFLICT','Choose a receiving request ID distinct from the original operation history.',409);
      for(const record of bundle.records)adapter.save(record.kind,record.value);
      for(const op of bundle.operations)saveOperation(op.kind,op.input,op.result,op.createdAt);
      const createdAt=now(),receivedFrom={requestId:input.requestId,receivedAt:createdAt,destinationWorkspaceId:meta.workspaceId,originWorkspaceId:bundle.workspaceId,originRevision:bundle.revision,originalFile:copy(input.originalFile),packageSha256:bundle.sha256};
      const result={workspaceId:bundle.workspaceId,revision:bundle.revision+1,requestId:input.requestId,packageSha256:bundle.sha256,receivedFrom};
      saveMeta({schema:DATABASE_SCHEMA,workspaceId:bundle.workspaceId,revision:result.revision,createdAt:bundle.createdAt,updatedAt:createdAt,receivedFrom:[...copy(bundle.receivedFrom),receivedFrom]});saveOperation('workspace-receive',input,result,createdAt);return result;
    },true);
  }
  function exportFile(selection={}){
    return transaction(()=>{
      const current=model(),meta=metadata();if(selection.expectedRevision!==undefined&&selection.expectedRevision!==meta.revision)fail('REVISION_CONFLICT','The service workspace changed before its selected export.',409,{currentRevision:meta.revision});
      const kind=selection.kind??'workspace',allowed={workspace:[],profile:['profileId','profileVersionId'],source:['sourceId'],'preview-json':['previewId'],'preview-csv':['previewId'],'release-json':['releaseId'],'release-report':['releaseId']}[kind];
      if(!allowed)fail('UNKNOWN_EXPORT','This service export kind is unsupported.',400,{kind});
      for(const key of ['profileId','profileVersionId','sourceId','previewId','releaseId'])if(selection[key]!==undefined&&selection[key]!==null&&selection[key]!==''&&!allowed.includes(key))fail('AMBIGUOUS_EXPORT','Use only selectors belonging to the selected export kind.',400,{kind,key});
      if(kind==='workspace')return jsonFile('service-workspace-'+meta.workspaceId+'.json',workspaceExportInside());
      if(kind==='profile'){
        const profile=selection.profileVersionId?current.get('profile',selection.profileVersionId):current.currentProfile(selection.profileId);
        if(selection.profileId&&profile.id!==selection.profileId)fail('PROFILE_SELECTION_MISMATCH','The saved version does not belong to the selected profile.');
        return jsonFile('service-profile-'+profile.versionId+'.json',profile);
      }
      if(kind==='source'){const source=current.get('source',selection.sourceId);return fileResult(source.originalFile.filename,source.originalFile.contentType,source.originalText);}
      if(kind==='preview-json'||kind==='preview-csv'){
        const preview=current.get('preview',selection.previewId);
        if(kind==='preview-csv')return fileResult('service-preview-'+preview.id+'.csv','text/csv; charset=utf-8',previewCsv(preview));
        const profile=current.get('profile',preview.profileVersionId),source=current.get('source',preview.sourceId),baseline=preview.baseline?current.baseline(preview.baseline):null;
        return jsonFile('service-preview-'+preview.id+'.json',seal({schema:'commons.open311.service-preview-export.v1',preview,profile,source,baseline}));
      }
      const release=current.get('release',selection.releaseId);
      return kind==='release-json'?jsonFile('service-handover-'+release.id+'.json',release):fileResult('service-handover-'+release.id+'.html','text/html; charset=utf-8',releaseReport(release));
    });
  }
  const api={directory,filename,state,operation,inspectSource,workspaceExport,receive,exportFile,close(){if(!closed){db.close();closed=true;}}};
  for(const [name,kind] of Object.entries(actions))api[name]=input=>mutate(kind,input);
  for(const name of ['profile','source','sourceRows','preview','release'])api[name]=selection=>transaction(()=>model()[name](selection));
  return api;
}
