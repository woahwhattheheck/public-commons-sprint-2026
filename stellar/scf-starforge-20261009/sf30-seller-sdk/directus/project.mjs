// MIT. Complete Directus publishing and customer artifacts in the original project.
import {join,resolve,dirname} from 'node:path';
import {rename} from 'node:fs/promises';
import {openDatasetVersions} from '../dataset-refresh/versions.mjs';
import {prepareDirectusMerchant,readDirectusMerchant} from './merchant.mjs';
import {inspectDirectusDelivery} from './customer.mjs';
import {readPrivate,readJson,privateDirectory,saveExact,syncDirectory,exists,MiB} from '../dspace/merchant-files.mjs';
import {canonical,hash,object,fault,MAX_SOURCE_BYTES} from './source.mjs';

const HASH=/^[a-f0-9]{64}$/;
const KINDS=['merchant-packages','buyer-configurations','customer-deliveries'];
const SCHEMAS={
  'merchant-packages':'stellar-forge.directus-project-merchant.v1',
  'buyer-configurations':'stellar-forge.directus-project-buyer.v1',
  'customer-deliveries':'stellar-forge.directus-project-delivery.v1'
};
const RUNTIME_SCHEMA='stellar-forge.directus-project-runtime.v1';
const identity=value=>hash(canonical(value));
const parse=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
const need=(ok,message)=>{if(!ok)throw fault('DIRECTUS_PROJECT_CHANGED',message,409);};
const pathName=name=>{
  need(typeof name==='string'&&!name.includes('\\')&&!name.startsWith('/')&&
    name.split('/').every(part=>part&&part!=='.'&&part!=='..'),'An original project file has an invalid relative path.');
  return name;
};
function recordOf(workspace,kind,id){
  try{return workspace.get(kind,id);}catch(error){if(error.code==='DIRECTUS_RECORD_MISSING')return null;throw error;}
}
function editionOf(workspace,edition){
  const selected=workspace.get('editions',edition.id);
  need(selected.sha256===edition.sha256&&selected.snapshot===edition.snapshot,
    'The retained customer artifact belongs to another original collection edition.');
  return selected;
}
async function retainedFiles(root,names){
  const result=[];
  for(const name of [...new Set(names)].sort()){
    pathName(name);
    const raw=await readPrivate(join(root,name),MAX_SOURCE_BYTES);
    result.push({path:name,bytes:raw.length,sha256:hash(raw),source:join(root,name)});
  }
  return result;
}
function fileMap(workspace,doc){
  const members=new Map();
  need(Array.isArray(doc.files)&&doc.files.length<=25008,'The original project file set is invalid.');
  for(const entry of doc.files){
    pathName(entry.path);
    need(!members.has(entry.path)&&HASH.test(entry.sha256??'')&&Number.isSafeInteger(entry.bytes)&&
      entry.bytes>=0&&entry.bytes<=MAX_SOURCE_BYTES,'An original project file identity is invalid or duplicated.');
    const raw=workspace.bytes(entry.sha256);
    need(raw.length===entry.bytes,'An original retained project file changed.');
    members.set(entry.path,{...entry,get raw(){return workspace.bytes(entry.sha256);}});
  }
  return members;
}
async function commitRecord(workspace,kind,doc,files,location){
  const existing=recordOf(workspace,kind,doc.id);
  if(existing){
    const a={...existing},b={...doc};
    for(const item of [a,b]){delete item.sha256;delete item.created_at;delete item.original_directory;}
    need(identity(a)===identity(b),'The original artifact identity already names different project content.');
    return existing;
  }
  workspace.db.exec('BEGIN IMMEDIATE');
  try{
    for(const file of files){const raw=file.raw??await readPrivate(file.source,MAX_SOURCE_BYTES);
      need(raw.length===file.bytes&&hash(raw)===file.sha256&&workspace.blob(raw)===file.sha256,'An original file changed while being retained.');}
    doc.created_at=new Date().toISOString();doc.sha256=identity(doc);
    workspace.put(kind,doc);
    const locations=workspace.meta('runtime_locations')??{};
    locations[kind]={...(locations[kind]??{}),[doc.id]:location};
    workspace.setMeta('runtime_locations',locations);
    workspace.setMeta('revision',workspace.revision()+1);
    workspace.db.exec('COMMIT');
  }catch(error){workspace.db.exec('ROLLBACK');throw error;}
  return doc;
}
function descriptors(files){return files.map(({path,bytes,sha256})=>({path,bytes,sha256}));}
function versionBinding(workspace,record){
  const files=fileMap(workspace,record),binding=parse(files.get('binding.json').raw),source=parse(files.get('source.json').raw);
  return {schema:'stellar-forge.directus-version-binding.v1',workspace_id:source.workspace_id,
    mode:source.mode,contract_sha256:binding.contractSha256,seller_sha256:files.get('seller.json').sha256};
}

export async function registerDirectusMerchant(workspace,{directory}={}){
  const prepared=await readDirectusMerchant(directory),intent=await readJson(join(prepared.directory,'directus-merchant-intent.json'),MiB);
  need(prepared.source.workspace_id===workspace.state().id&&intent.workspace_id===workspace.state().id,
    'Retain a prepared publisher from this original collection project.');
  editionOf(workspace,prepared.source.edition);
  need(intent.editionId===prepared.source.edition.id&&intent.editionSha256===prepared.source.edition.sha256&&
    intent.reviewId===prepared.source.review.id&&intent.versionDirectory===prepared.binding.datasetDirectory,
    'The original preparation intent differs from its selected publisher.');
  const names=['dataset.csv','dataset.json','seller.json','source.json','binding.json','directus-merchant-intent.json',
    ...prepared.sourceFiles.map(file=>file.path)];
  const files=await retainedFiles(prepared.directory,names);
  const versionGroup='version-'+identity({workspace:workspace.state().id,directory:prepared.binding.datasetDirectory,
    contract:prepared.binding.contractSha256,seller:hash(prepared.retained['seller.json'])});
  const id='merchant-'+identity({directory:prepared.directory,execution:prepared.dataset.executionSha256});
  const doc={schema:SCHEMAS['merchant-packages'],id,workspace_id:workspace.state().id,edition:prepared.source.edition,
    review_id:prepared.source.review.id,original_directory:prepared.directory,original_version_directory:prepared.binding.datasetDirectory,
    version_group:versionGroup,execution_sha256:prepared.dataset.executionSha256,files:descriptors(files)};
  return commitRecord(workspace,'merchant-packages',doc,files,{directory:prepared.directory,
    versionDirectory:prepared.binding.datasetDirectory,stageDirectory:join(dirname(prepared.directory),'stage-'+id)});
}
export async function registerDirectusBuyer(workspace,{configuration}={}){
  const file=resolve(configuration),selection=await readJson(file+'.directus.json',MiB);
  need(selection.schema==='stellar-forge.directus-buyer-selection.v1'&&selection.edition?.workspace_id===workspace.state().id,
    'Retain the original buyer configuration for this collection project.');
  editionOf(workspace,selection.edition);
  const raw=await readPrivate(file,MiB),selectionRaw=await readPrivate(file+'.directus.json',MiB);
  need(hash(raw)===selection.configuration_sha256,'The original buyer configuration changed.');
  const files=[{path:'buyer.json',bytes:raw.length,sha256:hash(raw),raw},
    {path:'selection.json',bytes:selectionRaw.length,sha256:hash(selectionRaw),raw:selectionRaw}];
  const doc={schema:SCHEMAS['buyer-configurations'],id:'buyer-'+identity({configuration:hash(raw),selection:hash(selectionRaw)}),
    workspace_id:workspace.state().id,edition:selection.edition,configuration_sha256:hash(raw),original_directory:dirname(file),files:descriptors(files)};
  return commitRecord(workspace,'buyer-configurations',doc,files,{configuration:file,selection:file+'.directus.json'});
}
export async function registerDirectusDelivery(workspace,{directory}={}){
  const result=await inspectDirectusDelivery(directory),manifest=result.manifest;
  need(manifest.edition.workspace_id===workspace.state().id,'Retain the original customer delivery for this collection project.');
  editionOf(workspace,manifest.edition);
  const names=['delivery.json',...manifest.files.map(file=>file.path)];
  const files=await retainedFiles(result.directory,names);
  const doc={schema:SCHEMAS['customer-deliveries'],id:'delivery-'+manifest.sha256,workspace_id:workspace.state().id,
    edition:manifest.edition,delivery_sha256:manifest.sha256,source_binding_sha256:manifest.source_binding_sha256,
    acquisition:manifest.acquisition,original_directory:result.directory,files:descriptors(files)};
  return commitRecord(workspace,'customer-deliveries',doc,files,{directory:result.directory});
}
export function validateDirectusProjectRecords(workspace){
  for(const kind of KINDS)for(const entry of workspace.list(kind)){
    const doc=workspace.get(kind,entry.id),unsigned={...doc};delete unsigned.sha256;
    need(doc.schema===SCHEMAS[kind]&&doc.workspace_id===workspace.meta('workspace_id')&&
      HASH.test(doc.sha256??'')&&identity(unsigned)===doc.sha256,'An original project artifact changed.');
    editionOf(workspace,doc.edition);
    const members=fileMap(workspace,doc),read=name=>{need(members.has(name),'An original project member is absent.');return members.get(name).raw;};
    if(kind==='merchant-packages'){
      const intent=parse(read('directus-merchant-intent.json')),binding=parse(read('binding.json')),source=parse(read('source.json'));
      need(doc.id==='merchant-'+identity({directory:doc.original_directory,execution:doc.execution_sha256})&&
        HASH.test(doc.execution_sha256??'')&&/^version-[a-f0-9]{64}$/.test(doc.version_group??'')&&
        intent.workspace_id===doc.workspace_id&&intent.editionId===doc.edition.id&&intent.editionSha256===doc.edition.sha256&&
        intent.reviewId===doc.review_id&&binding.datasetDirectory===doc.original_version_directory&&
        binding.baselineSnapshot===doc.edition.snapshot&&source.workspace_id===doc.workspace_id&&
        source.edition.id===doc.edition.id&&source.edition.sha256===doc.edition.sha256&&source.review.id===doc.review_id&&
        binding.sourceSha256===hash(read('source.json')),'The retained publisher differs from its original edition and source binding.');
      const review=workspace.get('reviews',doc.review_id);
      need(review.decision==='approved'&&review.edition_sha256===doc.edition.sha256,'The publisher approval belongs to another original edition.');
      for(const entry of source.sourceFiles??[]){
        const member=members.get(entry.path);
        need(member&&member.bytes===entry.bytes&&member.sha256===entry.sha256,'An original publisher source member changed.');
      }
      read('dataset.csv');read('dataset.json');read('seller.json');
      need(identity(versionBinding(workspace,doc))===identity({schema:'stellar-forge.directus-version-binding.v1',
        workspace_id:doc.workspace_id,mode:source.mode,contract_sha256:binding.contractSha256,seller_sha256:hash(read('seller.json'))}),
        'The original native publisher identity changed.');
    }else if(kind==='buyer-configurations'){
      const selection=parse(read('selection.json'));
      need(hash(read('buyer.json'))===doc.configuration_sha256&&selection.configuration_sha256===doc.configuration_sha256&&
        selection.edition.id===doc.edition.id&&selection.edition.sha256===doc.edition.sha256,
        'The original buyer configuration differs from its selected edition.');
    }else{
      const manifest=parse(read('delivery.json')),unsigned={...manifest};delete unsigned.sha256;
      need(identity(unsigned)===doc.delivery_sha256&&manifest.sha256===doc.delivery_sha256&&
        manifest.edition.id===doc.edition.id&&manifest.edition.sha256===doc.edition.sha256&&
        manifest.source_binding_sha256===doc.source_binding_sha256&&identity(manifest.acquisition)===identity(doc.acquisition),
        'The customer delivery changed from its original manifest.');
      for(const file of manifest.files){const member=members.get(file.path);
        need(member&&member.bytes===file.bytes&&member.sha256===file.sha256,'An original customer data-room file is absent or changed.');}
    }
  }
}
export function directusProjectLocations(workspace){
  const saved=workspace.meta('runtime_locations')??{},out={merchants:[],buyers:[],deliveries:[]};
  for(const [kind,key]of [['merchant-packages','merchants'],['buyer-configurations','buyers'],['customer-deliveries','deliveries']])
    for(const entry of workspace.list(kind)){const doc=workspace.get(kind,entry.id),location=saved[kind]?.[doc.id];
      if(location)out[key].push({id:doc.id,edition:doc.edition,...location,
        ...(kind==='customer-deliveries'?{deliverySha256:doc.delivery_sha256,rows:doc.acquisition.rows}:{})});}
  return out;
}

function nativeState(raw){
  const state=parse(raw);
  need(object(state)&&state.schema==='stellar-forge.dataset-versions.v2'&&HASH.test(state.current??'')&&
    HASH.test(state.contractHash??'')&&Number.isSafeInteger(state.revision)&&state.revision>=1&&
    Array.isArray(state.versions)&&state.versions.length>=1&&state.versions.length<=16,
    'Choose a complete original native dataset version store.');
  const ids=new Set();
  for(const version of state.versions){
    need(object(version)&&HASH.test(version.snapshot??'')&&!ids.has(version.snapshot)&&
      HASH.test(version.csvHash??'')&&HASH.test(version.configHash??'')&&Number.isSafeInteger(version.sourceBytes)&&
      version.sourceBytes>=1&&version.sourceBytes<=MAX_SOURCE_BYTES,'An original dataset generation has an invalid file identity.');
    ids.add(version.snapshot);
  }
  need(ids.has(state.current),'The original selected generation is absent.');
  return state;
}
function generationNames(state){
  return ['state.json','directus-source-binding.json',...state.versions.flatMap(version=>
    ['data.csv','dataset.json','manifest.json'].map(name=>'versions/'+version.snapshot+'/'+name))].sort();
}
function projectGroups(workspace,{locations=false}={}){
  const groups=new Map(),where=workspace.meta('runtime_locations')?.['merchant-packages']??{};
  for(const entry of workspace.list('merchant-packages')){
    const doc=workspace.get('merchant-packages',entry.id),expected=versionBinding(workspace,doc);
    if(!groups.has(doc.version_group))groups.set(doc.version_group,{id:doc.version_group,expected,merchants:[]});
    const group=groups.get(doc.version_group);need(identity(group.expected)===identity(expected),'A version group contains different original publishing terms.');
    group.merchants.push(doc);
    if(locations){
      const location=where[doc.id];
      need(location&&typeof location.versionDirectory==='string','The original publisher location is missing.');
      const directory=resolve(location.versionDirectory);
      if(group.directory)need(group.directory===directory,'The original shared version group has conflicting local locations.');
      group.directory=directory;
    }
  }
  return groups;
}
function validateStore(workspace,store,group){
  need(object(store)&&store.id===group.id&&typeof store.initialized==='boolean'&&Array.isArray(store.files),
    'The original publisher store identity is invalid.');
  if(!store.initialized){need(store.files.length===0&&store.current===null&&store.revision===null,
    'An uninitialized original store cannot declare published generations.');return null;}
  const members=fileMap(workspace,store),read=name=>{need(members.has(name),'The original version store is incomplete.');return members.get(name).raw;};
  const state=nativeState(read('state.json'));
  need(identity([...members.keys()].sort())===identity(generationNames(state))&&state.current===store.current&&
    state.revision===store.revision&&hash(read('state.json'))===store.state_sha256&&
    identity(parse(read('directus-source-binding.json')))===identity(group.expected),
    'The native state, selected source or retained generation set changed.');
  for(const version of state.versions){
    const prefix='versions/'+version.snapshot+'/',csv=members.get(prefix+'data.csv'),config=members.get(prefix+'dataset.json'),
      definition=parse(config.raw),manifest=parse(read(prefix+'manifest.json'));
    need(csv.sha256===version.csvHash&&csv.bytes===version.sourceBytes&&config.sha256===version.configHash&&
      definition.schema==='stellar-forge.csv-dataset.v1'&&definition.file==='./data.csv'&&
      manifest.schema==='stellar-forge.dataset-generation.v1'&&manifest.snapshot===version.snapshot&&
      manifest.csvHash===version.csvHash&&manifest.configHash===version.configHash&&
      manifest.sourceBytes===version.sourceBytes&&manifest.contractHash===state.contractHash&&
      state.contractHash===group.expected.contract_sha256,'A retained generation differs from its original publisher.');
  }
  return state;
}
export function validateDirectusProjectRuntime(workspace,value){
  validateDirectusProjectRecords(workspace);
  if(value===null||value===undefined){need(KINDS.every(kind=>workspace.list(kind).length===0),
    'Export the complete project so its original publisher and customer artifacts travel together.');return null;}
  const unsigned={...value};delete unsigned.sha256;
  need(value.schema===RUNTIME_SCHEMA&&value.workspace_id===workspace.meta('workspace_id')&&
    HASH.test(value.sha256??'')&&identity(unsigned)===value.sha256&&Array.isArray(value.stores),
    'The original publishing transfer identity changed.');
  const groups=projectGroups(workspace),seen=new Set();
  for(const store of value.stores){
    need(groups.has(store.id)&&!seen.has(store.id),'A captured publisher has no original merchant or is duplicated.');
    seen.add(store.id);validateStore(workspace,store,groups.get(store.id));
  }
  need(seen.size===groups.size,'The complete project is missing an original publishing store.');
  return value;
}

/** Capture immutable native generations around the original atomic state file.
 * No control socket, process lock or authorization material enters the project. */
export async function captureDirectusProjectRuntime(workspace){
  validateDirectusProjectRecords(workspace);
  const stores=[];
  workspace.db.exec('BEGIN IMMEDIATE');
  try{
    for(const group of projectGroups(workspace,{locations:true}).values()){
      const statePath=join(group.directory,'state.json');
      if(!await exists(statePath)){stores.push({id:group.id,initialized:false,current:null,revision:null,files:[]});continue;}
      await privateDirectory(group.directory);
      let complete,last;
      for(let attempt=0;attempt<3&&!complete;attempt++){
        const before=await readPrivate(statePath,256*1024),state=nativeState(before),files=[];
        try{
          for(const name of generationNames(state)){
            const raw=name==='state.json'?before:await readPrivate(join(group.directory,name),MAX_SOURCE_BYTES);
            files.push({path:name,bytes:raw.length,sha256:workspace.blob(raw)});
          }
          const after=await readPrivate(statePath,256*1024);
          if(!before.equals(after)){last=fault('DIRECTUS_NATIVE_STATE_MOVED','The original publisher advanced during project export.',409);continue;}
          const candidate={id:group.id,initialized:true,current:state.current,revision:state.revision,
            state_sha256:hash(before),files};
          validateStore(workspace,candidate,group);complete=candidate;
        }catch(error){
          last=error;
          const after=await readPrivate(statePath,256*1024);if(before.equals(after))throw error;
        }
      }
      if(!complete)throw last??fault('DIRECTUS_NATIVE_STATE_MOVED','The original publisher changed during project export.',409);
      stores.push(complete);
    }
    stores.sort((a,b)=>a.id.localeCompare(b.id));
    const result={schema:RUNTIME_SCHEMA,workspace_id:workspace.meta('workspace_id'),stores};
    result.sha256=identity(result);
    workspace.setMeta('runtime_custody',result);workspace.db.exec('COMMIT');return result;
  }catch(error){workspace.db.exec('ROLLBACK');throw error;}
}
async function writeMembers(workspace,doc,directory){
  await privateDirectory(directory,true);
  for(const member of doc.files)await saveExact(join(directory,pathName(member.path)),workspace.bytes(member.sha256));
}
async function restoreNativeStore(workspace,store,root){
  if(!store.initialized)return;
  const destination=join(root,'versions',store.id),stage=join(root,'.receiving-version-'+store.id);
  const receipt={schema:'stellar-forge.directus-received-store.v1',workspace_id:workspace.meta('workspace_id'),
    store:store.id,state_sha256:store.state_sha256};
  let selected;
  if(await exists(destination)){
    await privateDirectory(destination);
    need(identity(await readJson(join(destination,'directus-received-store.json'),MiB))===identity(receipt),
      'The receiving publisher directory belongs to another original project.');
    selected=destination;
  }else{
    await privateDirectory(stage,true);await saveExact(join(stage,'directus-received-store.json'),receipt);
    for(const member of store.files.filter(file=>file.path!=='state.json'))
      await saveExact(join(stage,member.path),workspace.bytes(member.sha256));
    await saveExact(join(stage,'state.json'),workspace.bytes(store.state_sha256));selected=stage;
  }
  const original=await openDatasetVersions({directory:selected,collectOnOpen:false});
  try{
    const status=original.status();
    need(status.current===store.current&&status.revision===store.revision&&
      hash(await readPrivate(join(selected,'state.json'),256*1024))===store.state_sha256,
      'The restored original publisher differs from its captured state.');
  }finally{await original.close();}
  if(selected===stage){await privateDirectory(dirname(destination),true);await rename(stage,destination);
    await syncDirectory(dirname(destination));await syncDirectory(root);}
}

/** Restore complete received operational files without resetting later edits.
 * Original preparation bytes remain beside local packages rebuilt with the same
 * approved source, seller and native version binding at their new host paths. */
export async function restoreDirectusProjectRuntime(workspace){
  const completed=workspace.meta('receiving_runtime'),incoming=workspace.meta('receiving_source');
  if(incoming&&completed?.receiving_source_sha256===incoming.sha256){validateDirectusProjectRecords(workspace);return directusProjectLocations(workspace);}
  const value=validateDirectusProjectRuntime(workspace,workspace.meta('runtime_custody'));
  if(!value)return directusProjectLocations(workspace);
  const root=join(workspace.directory,'project-runtime'),locations={},origins=[];
  await privateDirectory(root,true);
  for(const store of value.stores)await restoreNativeStore(workspace,store,root);
  for(const entry of workspace.list('merchant-packages')){
    const doc=workspace.get('merchant-packages',entry.id),members=fileMap(workspace,doc);
    const originalDirectory=join(root,'original-merchants',doc.id),directory=join(root,'merchants',doc.id),
      versionDirectory=join(root,'versions',doc.version_group),stageDirectory=join(root,'stages',doc.id);
    await writeMembers(workspace,doc,originalDirectory);
    const originalPackage=await readDirectusMerchant(originalDirectory);
    need(originalPackage.dataset.executionSha256===doc.execution_sha256,'The retained original merchant execution identity changed.');
    const intent=parse(members.get('directus-merchant-intent.json').raw);
    const local=await prepareDirectusMerchant({workspace,editionId:intent.editionId,editionSha256:intent.editionSha256,
      reviewId:intent.reviewId,directory,versionDirectory,payment:intent.payment,origin:intent.origin,path:intent.path,retain:false});
    const current=await readDirectusMerchant(local.directory);
    for(const name of ['dataset.csv','dataset.json','seller.json','source.json']){
      const raw=await readPrivate(join(directory,name),MAX_SOURCE_BYTES);
      need(hash(raw)===members.get(name).sha256,'The rebuilt publisher differs from the original source or seller terms.');
    }
    const originalBinding=parse(members.get('binding.json').raw);
    need(identity(current.binding)===identity({...originalBinding,datasetDirectory:versionDirectory}),
      'The received publisher changed more than its local version-store location.');
    for(const member of current.sourceFiles){const original=members.get(member.path);
      need(original&&original.bytes===member.bytes&&original.sha256===member.sha256,'The rebuilt publisher changed an original source member.');}
    const origin={schema:'stellar-forge.directus-project-publisher-origin.v1',merchant_id:doc.id,
      original_execution_sha256:doc.execution_sha256,local_execution_sha256:current.dataset.executionSha256,
      original_binding_sha256:members.get('binding.json').sha256,local_binding_sha256:hash(current.retained['binding.json']),
      snapshot:doc.edition.snapshot,source_sha256:current.binding.sourceSha256};
    await saveExact(join(directory,'directus-project-origin.json'),origin);origins.push(origin);
    (locations['merchant-packages']??={})[doc.id]={directory,versionDirectory,stageDirectory,originalDirectory};
  }
  for(const entry of workspace.list('buyer-configurations')){
    const doc=workspace.get('buyer-configurations',entry.id),directory=join(root,'buyers',doc.id);
    await writeMembers(workspace,doc,directory);
    (locations['buyer-configurations']??={})[doc.id]={configuration:join(directory,'buyer.json'),selection:join(directory,'selection.json')};
  }
  for(const entry of workspace.list('customer-deliveries')){
    const doc=workspace.get('customer-deliveries',entry.id),directory=join(root,'deliveries',doc.id);
    await writeMembers(workspace,doc,directory);
    const checked=await inspectDirectusDelivery(directory);
    need(checked.manifest.sha256===doc.delivery_sha256,'The received original customer data room changed.');
    (locations['customer-deliveries']??={})[doc.id]={directory};
  }
  workspace.db.exec('BEGIN IMMEDIATE');
  try{
    workspace.setMeta('runtime_locations',locations);
    workspace.setMeta('receiving_runtime',{schema:'stellar-forge.directus-project-receiving-runtime.v1',
      receiving_source_sha256:incoming?.sha256,source_sha256:value.sha256,received_at:new Date().toISOString(),publishers:origins});
    workspace.db.exec('COMMIT');
  }catch(error){workspace.db.exec('ROLLBACK');throw error;}
  return directusProjectLocations(workspace);
}
