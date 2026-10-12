// MIT. Complete original version-store custody inside the existing Superset project.
import {lstat,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {openDatasetVersions} from '../dataset-refresh/versions.mjs';
import {privateDirectory,readPrivate,saveExact,syncDirectory,bytes,digest,identity,object,fault,MiB} from './files.mjs';

const SCHEMA='stellar-forge.superset-version-custody.v1';
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const json=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
function need(ok,message){if(!ok)throw fault('SUPERSET_NATIVE_CUSTODY_CHANGED',message,409);}
function groups(workspace){
  const result=new Map();
  for(const entry of workspace.list('merchants')){
    const merchant=workspace.get('merchants',entry.id),group=merchant.versionGroup??merchant.id;
    need(ID.test(group),'A merchant has an invalid original version group.');
    if(!result.has(group))result.set(group,[]);
    result.get(group).push(merchant);
  }
  return result;
}
function stateOf(raw){
  const state=json(raw);
  need(object(state)&&state.schema==='stellar-forge.dataset-versions.v2'&&HASH.test(state.current??'')&&
    HASH.test(state.contractHash??'')&&Number.isSafeInteger(state.revision)&&state.revision>=1&&
    object(state.settings)&&Array.isArray(state.versions)&&state.versions.length>=1&&state.versions.length<=16,
    'Choose a complete original Linux dataset version store.');
  const names=new Set();
  for(const item of state.versions){
    need(object(item)&&HASH.test(item.snapshot??'')&&!names.has(item.snapshot)&&
      HASH.test(item.csvHash??'')&&HASH.test(item.configHash??'')&&
      Number.isSafeInteger(item.sourceBytes)&&item.sourceBytes>=1&&item.sourceBytes<=256*MiB,
      'An original generation has an invalid source identity.');
    names.add(item.snapshot);
  }
  need(names.has(state.current),'The current original generation is absent.');
  return state;
}
function expectedNames(state){
  return ['state.json','superset-source-binding.json',...state.versions.flatMap(item=>
    ['data.csv','dataset.json','manifest.json'].map(name=>'versions/'+item.snapshot+'/'+name))].sort();
}
function boundSource(workspace,merchants,state,binding){
  need(object(binding)&&binding.schema==='stellar-forge.superset-version-source.v1'&&
    binding.workspaceId===workspace.meta('workspace_id')&&binding.contractSha256===state.contractHash&&
    HASH.test(binding.sellerSha256??'')&&object(binding.source),'The original version store belongs to another project or field contract.');
  for(const merchant of merchants){
    const edition=workspace.get('editions',merchant.editionId),capture=workspace.get('captures',edition.captureId);
    need(binding.source.baseUrl===capture.source.baseUrl&&binding.source.chartId===capture.source.chartId&&
      binding.source.chartUuid===capture.source.chartUuid&&binding.source.queryOrdinal===edition.selection.queryOrdinal,
      'A retained merchant version group contains a different chart or selected query.');
  }
}
function checkFiles(workspace,store,merchants){
  need(ID.test(store.group)&&typeof store.initialized==='boolean'&&Array.isArray(store.files),
    'The original version custody declaration is invalid.');
  if(!store.initialized){
    need(store.files.length===0&&store.current===null&&store.revision===null,'An uninitialized store cannot carry a native generation.');
    return null;
  }
  const members=new Map();
  for(const member of store.files){
    need(object(member)&&typeof member.path==='string'&&!members.has(member.path)&&HASH.test(member.sha256??'')&&
      Number.isSafeInteger(member.bytes)&&member.bytes>=0&&member.bytes<=256*MiB,
      'A retained version member has an invalid or duplicate identity.');
    const raw=workspace.bytes(member.sha256);
    need(raw.length===member.bytes,'An original version member changed.');
    members.set(member.path,member);
  }
  need(members.has('state.json')&&members.has('superset-source-binding.json'),'The native state and its source binding must travel together.');
  const read=name=>workspace.bytes(members.get(name).sha256);
  const state=stateOf(read('state.json'));
  need(identity([...members.keys()].sort())===identity(expectedNames(state))&&
    store.current===state.current&&store.revision===state.revision&&store.stateSha256===members.get('state.json').sha256,
    'The retained generation set differs from its original state.');
  boundSource(workspace,merchants,state,json(read('superset-source-binding.json')));
  for(const generation of state.versions){
    const root='versions/'+generation.snapshot+'/',csv=members.get(root+'data.csv'),config=members.get(root+'dataset.json'),
      manifest=json(read(root+'manifest.json')),definition=json(read(root+'dataset.json'));
    need(csv.sha256===generation.csvHash&&csv.bytes===generation.sourceBytes&&config.sha256===generation.configHash&&
      definition.schema==='stellar-forge.csv-dataset.v1'&&definition.file==='./data.csv'&&
      manifest.schema==='stellar-forge.dataset-generation.v1'&&manifest.snapshot===generation.snapshot&&
      manifest.csvHash===csv.sha256&&manifest.configHash===config.sha256&&manifest.sourceBytes===csv.bytes&&
      manifest.contractHash===state.contractHash,
      'An immutable native generation differs from its state, CSV, configuration or manifest.');
  }
  return {state,members};
}

/** The original writer publishes immutable generations before atomically replacing
 * state.json. Equal state bytes on both sides select one complete generation set
 * even while its HTTP service remains active. A concurrent refresh is retried. */
export async function captureSupersetVersionStores(workspace){
  const stores=[];
  for(const [group,merchants]of groups(workspace)){
    const root=join(workspace.directory,'versions',group),statePath=join(root,'state.json');
    if(!await exists(statePath)){stores.push({group,initialized:false,current:null,revision:null,files:[]});continue;}
    await privateDirectory(root);
    let complete=null,lastIssue;
    for(let attempt=0;attempt<3&&!complete;attempt++){
      const before=await readPrivate(statePath,256*1024),state=stateOf(before),files=[];
      try{
        for(const name of expectedNames(state)){
          const maximum=name.endsWith('/data.csv')?256*MiB:name.endsWith('/dataset.json')?4*MiB:256*1024;
          const raw=name==='state.json'?before:await readPrivate(join(root,name),maximum);
          files.push({path:name,...workspace.blob(raw)});
        }
        const after=await readPrivate(statePath,256*1024);
        if(!before.equals(after)){lastIssue=fault('SUPERSET_NATIVE_STATE_MOVED','The original dataset writer advanced during project capture.',409);continue;}
        const candidate={group,initialized:true,current:state.current,revision:state.revision,stateSha256:digest(before),files};
        checkFiles(workspace,candidate,merchants);complete=candidate;
      }catch(error){
        lastIssue=error;
        const after=await readPrivate(statePath,256*1024);
        if(before.equals(after))throw error;
      }
    }
    if(!complete)throw lastIssue??fault('SUPERSET_NATIVE_STATE_MOVED','Capture the project after its original writer completes the current change.',409);
    stores.push(complete);
  }
  const value={schema:SCHEMA,workspaceId:workspace.meta('workspace_id'),capturedAt:new Date().toISOString(),stores};
  value.sha256=identity(value);
  return value;
}
export function validateSupersetVersionStores(workspace,value){
  if(value===null||value===undefined)return null;
  const {sha256,...unsigned}=value;
  need(value.schema===SCHEMA&&value.workspaceId===workspace.meta('workspace_id')&&HASH.test(sha256??'')&&
    identity(unsigned)===sha256&&Array.isArray(value.stores),'The native project custody identity changed.');
  const selected=groups(workspace),seen=new Set();
  for(const store of value.stores){
    need(object(store)&&selected.has(store.group)&&!seen.has(store.group),'A native store has no original merchant or is duplicated.');
    seen.add(store.group);checkFiles(workspace,store,selected.get(store.group));
  }
  need(seen.size===selected.size,'The complete project is missing an original merchant version group.');
  return value;
}
/** Restore into a private staged store, let the ORIGINAL version engine validate
 * every generation without collecting it, then publish that complete directory.
 * Process locks and local control capabilities are created by the receiving host. */
export async function restoreSupersetVersionStores(workspace,value){
  if(!value)return [];
  validateSupersetVersionStores(workspace,value);
  const restored=[],parent=join(workspace.directory,'versions');
  await privateDirectory(parent,true);
  for(const store of value.stores){
    if(!store.initialized)continue;
    const destination=join(parent,store.group),stage=join(workspace.directory,'.receiving-version-'+store.group);
    const receipt={schema:'stellar-forge.superset-received-version-store.v1',workspaceId:value.workspaceId,
      group:store.group,sourceCustodySha256:value.sha256,stateSha256:store.stateSha256};
    const receiptName='superset-received-store.json';
    let root;
    if(await exists(destination)){
      await privateDirectory(destination);
      need(identity(json(await readPrivate(join(destination,receiptName),65536)))===identity(receipt),
        'The destination version store belongs to another received project.');
      root=destination;
    }else{
      await privateDirectory(stage,true);
      await saveExact(join(stage,receiptName),receipt);
      for(const member of store.files.filter(file=>file.path!=='state.json'))
        await saveExact(join(stage,member.path),workspace.bytes(member.sha256));
      await saveExact(join(stage,'state.json'),workspace.bytes(store.stateSha256));
      root=stage;
    }
    const original=await openDatasetVersions({directory:root,collectOnOpen:false});
    try{
      const status=original.status();
      need(status.current===store.current&&status.revision===store.revision,
        'The restored original writer differs from the captured selection or revision.');
      const originalState=await readPrivate(join(root,'state.json'),256*1024);
      need(digest(originalState)===store.stateSha256,'The restored native state differs from the captured state bytes.');
      restored.push({group:store.group,current:status.current,revision:status.revision,generations:status.versions.length,stateSha256:store.stateSha256});
    }finally{await original.close();}
    if(root===stage){await rename(stage,destination);await syncDirectory(parent);await syncDirectory(dirname(stage));}
  }
  return restored;
}
