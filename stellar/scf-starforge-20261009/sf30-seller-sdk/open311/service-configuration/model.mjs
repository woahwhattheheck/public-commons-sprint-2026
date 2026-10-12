// MIT. Replayable agency profile, source, preview and handover transitions.
import { canonical,copy,digest,equal,fail,object,text,instant,parseJson,entityId,seal,verifySeal,MAX_PACKAGE_BYTES } from '../gis/shared.mjs';
import { PROFILE_SCHEMA,createProfile,profileSummary } from './profile.mjs';
import { SOURCE_SCHEMA,createSource,sourceSummary,sourceDetail,sourceRows,paginated } from './source.mjs';
import { PREVIEW_SCHEMA,RELEASE_SCHEMA,createPreview,previewSummary,createRelease,releaseSummary } from './routing.mjs';
export const WORKSPACE_SCHEMA='commons.open311.service-configuration-workspace.v1';
export const DATABASE_SCHEMA='commons.open311.service-configuration-database.v1';
export const KINDS=['profile','source','preview','release'];
export const SCHEMAS={profile:PROFILE_SCHEMA,source:SOURCE_SCHEMA,preview:PREVIEW_SCHEMA,release:RELEASE_SCHEMA};
export const recordId=(kind,value)=>kind==='profile'?value.versionId:value.id;
export function recordSummary(kind,value){return kind==='profile'?profileSummary(value):kind==='source'?sourceSummary(value):kind==='preview'?previewSummary(value):releaseSummary(value);}
export function control(input){
  object(input,'Service-configuration action');text(input.requestId,'Stable request ID',200);
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('EXPECTED_REVISION_REQUIRED','Supply the observed service workspace revision.');
  return copy(input);
}
export function fingerprint(kind,input){const {expectedRevision,...intent}=input;return digest({kind,intent});}
export function validateHostInput(input,kind,raw){
  if(input.hostInput===undefined)return;
  const host=object(input.hostInput,'Original named host input');text(host.alias,'Original input alias',200);
  if(host.kind!==kind||host.format!=='json'||!/^[a-f0-9]{64}$/.test(host.sha256??''))fail('HOST_INPUT_IDENTITY','Keep the original named JSON input alias, kind and SHA-256.');
  if(typeof raw!=='string'||digest(raw)!==host.sha256)fail('HOST_INPUT_CHANGED','The original named input differs from its complete selected bytes.',409,{alias:host.alias});
}
export function memoryRecords(initial=[]){
  const records=[],maps=Object.fromEntries(KINDS.map(kind=>[kind,new Map()])),ordered=Object.fromEntries(KINDS.map(kind=>[kind,[]]));
  const adapter={
    all:kind=>ordered[kind].map(copy),
    find:(kind,id)=>maps[kind].has(id)?copy(maps[kind].get(id)):null,
    save:(kind,value)=>{const id=recordId(kind,value);if(!maps[kind]||maps[kind].has(id))fail('DUPLICATE_RECORD','A saved service record identity is repeated.',409,{kind,id});const saved=copy(value);maps[kind].set(id,saved);ordered[kind].push(saved);records.push({kind,id,value:saved});},
    records:()=>copy(records)
  };
  for(const record of initial){if(!KINDS.includes(record.kind)||record.id!==recordId(record.kind,record.value))fail('INVALID_RECORD','The original service record kind or identity differs.');adapter.save(record.kind,record.value);}
  return adapter;
}
export class ServiceConfigurationModel{
  constructor(adapter,metadata){this.adapter=adapter;this.metadata=metadata;this.cache=new Map();}
  all(kind){if(!this.cache.has(kind))this.cache.set(kind,this.adapter.all(kind));return this.cache.get(kind);}
  get(kind,id){text(id,'Saved '+kind+' identity',500);const value=this.adapter.find(kind,id);if(!value)fail('RECORD_NOT_FOUND','The saved '+kind+' was not found.',404,{id});return value;}
  save(kind,value){this.adapter.save(kind,value);this.cache.delete(kind);return value;}
  latestProfiles(){const values=new Map();for(const profile of this.all('profile'))values.set(profile.id,profile);return [...values.values()];}
  currentProfile(id){text(id,'Saved profile ID',200);const values=this.all('profile');for(let i=values.length-1;i>=0;i--)if(values[i].id===id)return values[i];fail('PROFILE_NOT_FOUND','The saved service profile was not found.',404,{id});}
  profile(id){const profile=this.currentProfile(id);return {profile:copy(profile),history:this.all('profile').filter(p=>p.id===id&&p.versionId!==profile.versionId).map(copy)};}
  source(id){return sourceDetail(this.get('source',id));}
  sourceRows(selection){return paginated(sourceRows(this.get('source',selection.sourceId)),selection);}
  preview(selection){const query=typeof selection==='string'?{id:selection}:selection,p=this.get('preview',query.id),{items,...record}=p;return {preview:copy(record),...paginated(items,query)};}
  release(id){return {release:copy(this.get('release',id))};}
  state(operations=[]){return {schema:DATABASE_SCHEMA,...copy(this.metadata),profiles:this.latestProfiles().map(profileSummary),sources:this.all('source').map(sourceSummary),previews:this.all('preview').map(previewSummary),releases:this.all('release').map(releaseSummary),counts:{profiles:this.latestProfiles().length,profileVersions:this.all('profile').length,sources:this.all('source').length,sourceRows:this.all('source').reduce((n,s)=>n+s.rowCount,0),previews:this.all('preview').length,releases:this.all('release').length},operations:copy(operations)};}
  baseline(selection){
    if(selection===undefined||selection===null)return null;
    object(selection,'Explicit deployed baseline');const profile=this.get('profile',text(selection.profileVersionId,'Deployed profile version',200));
    if(profile.id!==selection.profileId)fail('BASELINE_PROFILE_MISMATCH','The deployed baseline version must belong to the selected saved configuration.');
    return {profile:copy(profile),declaredBy:text(selection.declaredBy,'Deployed baseline declared by',300),note:text(selection.note,'Deployed baseline note',100000)};
  }
  requireProfile(input){
    const profile=this.currentProfile(input.profileId);
    if(input.expectedProfileVersionId!==profile.versionId)fail('PROFILE_VERSION_CHANGED','Use the observed current configuration version.',409,{profileId:profile.id,currentVersionId:profile.versionId});
    return profile;
  }
  apply(kind,input,createdAt){
    const identity={workspaceId:this.metadata.workspaceId,requestId:input.requestId},id=prefix=>entityId(prefix,identity);
    if(kind==='profile-save'){
      object(input.profile,'Selected service profile');
      if(input.originalText!==undefined){
        if(typeof input.originalText!=='string'||Buffer.byteLength(input.originalText)>MAX_PACKAGE_BYTES)fail('PROFILE_FILE_SIZE','The complete original profile file must fit within 256 MiB.',413);
        const original=parseJson(input.originalText,'Original selected configuration'),definition=original.definition??original;
        if(!equal(definition,input.profile.definition))fail('PROFILE_FILE_MISMATCH','Keep the complete original selected profile definition.',409);
      }
      validateHostInput(input,'profile',input.originalText);
      const profileId=input.profile.id??id('service-profile'),previous=this.all('profile').filter(p=>p.id===profileId).at(-1)??null;
      text(profileId,'Profile ID',200);
      if(input.expectedProfileVersionId!==undefined&&input.expectedProfileVersionId!==(previous?.versionId??null))fail('PROFILE_VERSION_CHANGED','The selected profile version changed.',409,{currentVersionId:previous?.versionId??null});
      const profile=createProfile(input.profile,{id:profileId,versionId:id('profile-version'),createdAt},previous);this.save('profile',profile);return {profile:profileSummary(profile)};
    }
    if(kind==='source-import'){
      validateHostInput(input,'source',input.originalText);const source=createSource(input,{id:id('service-source'),createdAt});this.save('source',source);return {source:sourceSummary(source)};
    }
    if(kind==='preview-create'){
      const profile=this.requireProfile(input),source=this.get('source',input.sourceId),baseline=this.baseline(input.baseline);
      const preview=createPreview(input,{id:id('service-preview'),createdAt},{profile,source,baseline});this.save('preview',preview);return {preview:previewSummary(preview)};
    }
    if(kind==='release-create'){
      const profile=this.requireProfile(input),preview=this.get('preview',input.previewId);
      if(preview.profileId!==profile.id||preview.profileVersionId!==profile.versionId||preview.profileSha256!==profile.sha256)fail('PREVIEW_PROFILE_CHANGED','Choose a preview of this exact current profile version before issuing its handover.',409);
      const source=this.get('source',preview.sourceId);if(source.sha256!==preview.sourceSha256)fail('PREVIEW_SOURCE_CHANGED','The original source of this preview differs.',409);
      const baseline=this.baseline(preview.baseline),release=createRelease(input,{id:id('service-release'),createdAt},{profile,preview,source,baseline});this.save('release',release);return {release:releaseSummary(release)};
    }
    fail('UNKNOWN_ACTION','This service-configuration action is unsupported.',400,{kind});
  }
}
export function validateWorkspacePackage(originalText){
  if(typeof originalText!=='string'||Buffer.byteLength(originalText)>MAX_PACKAGE_BYTES)fail('PACKAGE_SIZE','Receive one complete service workspace of at most 256 MiB.',413);
  const bundle=verifySeal(parseJson(originalText,'Complete service-configuration workspace'),WORKSPACE_SCHEMA);
  text(bundle.workspaceId,'Original service workspace ID',200);for(const key of ['createdAt','updatedAt','exportedAt'])instant(bundle[key],key);
  if(!Number.isSafeInteger(bundle.revision)||bundle.revision<0||!Array.isArray(bundle.records)||!Array.isArray(bundle.operations)||bundle.operations.length!==bundle.revision||!Array.isArray(bundle.receivedFrom))fail('INCOMPLETE_WORKSPACE','Keep every original configuration, source, preview, release and operation.');
  const adapter=memoryRecords(),metadata={schema:DATABASE_SCHEMA,workspaceId:bundle.workspaceId,revision:0,createdAt:bundle.createdAt,updatedAt:bundle.createdAt,receivedFrom:[]},seen=new Set(),receipts=[];
  for(let index=0;index<bundle.operations.length;index++){
    const op=bundle.operations[index];object(op,'Original operation');control(op.input);instant(op.createdAt,'Original operation time');
    if(seen.has(op.requestId)||op.requestId!==op.input.requestId||op.state!=='SUCCEEDED'||op.inputSha256!==fingerprint(op.kind,op.input)||op.result?.requestId!==op.requestId||op.result?.workspaceId!==bundle.workspaceId||op.result?.revision!==index+1)fail('OPERATION_HISTORY_MISMATCH','An original service operation identity, fingerprint or revision is inconsistent.');
    seen.add(op.requestId);let expected;
    if(op.kind==='workspace-receive'){
      if(op.input.expectedRevision!==0)fail('RECEIVE_REVISION_MISMATCH','A complete receiving action starts from an empty destination.');
      const file=op.input.originalFile,receipt=object(op.result.receivedFrom,'Original receiving receipt');
      if(!file||!/^[a-f0-9]{64}$/.test(file.sha256??'')||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>MAX_PACKAGE_BYTES||!/^[a-f0-9]{64}$/.test(op.input.incomingPackageSha256??''))fail('RECEIVE_FILE_MISMATCH','The original receiving file descriptor is incomplete.');
      const prefix=seal({schema:WORKSPACE_SCHEMA,workspaceId:bundle.workspaceId,revision:index,createdAt:bundle.createdAt,updatedAt:metadata.updatedAt,exportedAt:metadata.updatedAt,records:adapter.records(),operations:copy(bundle.operations.slice(0,index)),receivedFrom:copy(receipts)});
      if(prefix.sha256!==op.input.incomingPackageSha256)fail('RECEIVE_HISTORY_MISMATCH','The received package differs from its complete preceding history.');
      text(receipt.destinationWorkspaceId,'Original receiving destination ID',200);
      const expectedReceipt={requestId:op.requestId,receivedAt:op.createdAt,destinationWorkspaceId:receipt.destinationWorkspaceId,originWorkspaceId:bundle.workspaceId,originRevision:index,originalFile:copy(file),packageSha256:op.input.incomingPackageSha256};
      if(!equal(receipt,expectedReceipt))fail('RECEIVE_HISTORY_MISMATCH','The original receiving receipt differs from its retained package.');
      receipts.push(copy(receipt));expected={workspaceId:bundle.workspaceId,revision:index+1,requestId:op.requestId,packageSha256:op.input.incomingPackageSha256,receivedFrom:expectedReceipt};
    }else{
      if(op.input.expectedRevision!==index)fail('OPERATION_REVISION_MISMATCH','An original service action did not continue its observed revision.');
      const result=new ServiceConfigurationModel(adapter,metadata).apply(op.kind,op.input,op.createdAt);
      expected={workspaceId:bundle.workspaceId,revision:index+1,requestId:op.requestId,...result};
    }
    if(!equal(expected,op.result))fail('OPERATION_RESULT_MISMATCH','A saved result differs from replaying the complete original action.',400,{requestId:op.requestId,kind:op.kind});
    metadata.revision=index+1;metadata.updatedAt=op.createdAt;
  }
  if(!equal(adapter.records(),bundle.records))fail('RECORD_HISTORY_MISMATCH','The complete service records differ from their original action history.');
  if(!equal(receipts,bundle.receivedFrom)||bundle.updatedAt!==metadata.updatedAt||bundle.exportedAt!==bundle.updatedAt)fail('WORKSPACE_HISTORY_MISMATCH','The workspace metadata differs from its saved operation history.');
  return bundle;
}
