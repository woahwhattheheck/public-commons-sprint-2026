// SPDX-License-Identifier: MIT
// Reconcile original effects; never pretend the Python Controller implements request IDs.
import {need,hash,readJson,MAX_JSON} from './connection.mjs';
import {canonical,identity,plain} from './helpers.mjs';
import {hiveResponse} from './requests.mjs';
export const entity=(state,kind,id)=>state.entities.find(e=>e.kind===kind&&e.id===id);
const same=(a,b)=>canonical(a)===canonical(b);
const changed=(before,current)=>current&&(!before||current.revision!==before.revision);
export async function recoverEffect(record,client){
  const action=record.resolved.action,d=record.resolved.data,before=record.before,current=(await client.state()).value;
  need(current.id===record.workspaceId,'HIVE_WORKSPACE_CHANGED','Reconnect this original workspace before request recovery.',409);
  const found=(kind,id)=>entity(current,kind,id),old=(kind,id)=>entity(before,kind,id);
  const recovered=(item,reason)=>({response:hiveResponse({recovered:true,recovery:'EXISTING_ORIGINAL_EFFECT',reason,action,
    requestId:record.input.requestId,entity:item,currentWorkspaceRevision:current.revision})});
  if(action==='workspace.verify'||action==='native.status'||action==='delivery.inspect'||action==='delivery.compare')return{retry:true};
  if(action==='edition.import'){
    const row=current.entities.find(e=>e.kind==='edition'&&e.data.originalDirectory===d.directory&&
      e.data.files.length===record.resolved.files?.length&&e.data.files.every(f=>record.resolved.files.some(x=>x.path===f.path&&x.bytes===f.bytes&&x.sha256===f.sha256)));
    return row?recovered(row,'The original complete file-bound edition exists.'):{retry:true};
  }
  if(action==='edition.change'){
    const row=current.entities.find(e=>e.kind==='edition'&&e.data.originalDirectory===d.directory&&e.data.name===d.name&&e.data.manifest.parent_edition===d.edition);
    if(!row)return null;
    const original=entity(record.before,'edition',d.edition);
    if(!original)return null;
    for(const f of original.data.files){if(f.path==='edition.json'||Object.hasOwn(d.changes,f.path))continue;
      if(!row.data.files.some(x=>x.path===f.path&&x.bytes===f.bytes&&x.sha256===f.sha256))return null;}
    for(const[path,text]of Object.entries(d.changes)){const f=row.data.files.find(f=>f.path===path);if(path==='edition.json')return null;
      if(!f||f.bytes!==Buffer.byteLength(text)||f.sha256!==hash(Buffer.from(text)))return null;}
    return recovered(row,'The original changed edition was imported from this exact selected destination and source replacements.');
  }
  if(action==='native.prepare'){
    const names=[...new Set(d.environment_names??[])].sort();
    const row=current.entities.find(e=>e.kind==='deployment'&&e.data.edition===d.edition&&e.data.installation===record.access.directory&&
      e.data.binary.path===d.binary&&e.data.binary.sha256===record.resolved.binary.sha256&&same(e.data.environmentNames,names));
    return row?recovered(row,'The original binary/edition/installation binding exists.'):{retry:true};
  }
  if(action==='programme.compare'){
    const id=hash(Buffer.from(d.baseline+'\n'+d.candidate)),row=found('comparison',id);
    return row?recovered(row,'The original complete programme comparison exists.'):{retry:true};
  }
  if(action==='configuration.review'||action==='programme.review'){
    const kind=action==='configuration.review'?'configuration-review':'programme-review',id=d.edition??d.programme,row=found(kind,id);
    const owner=found(action==='configuration.review'?'edition':'programme',id);
    if(row&&changed(old(kind,id),row)&&row.data.note===d.note&&same(row.data.decisions,d.decisions)&&
      row.data[action==='configuration.review'?'editionRevision':'programmeRevision']===owner?.revision)
      return recovered(row,'The selected complete review and its exact original subject revision are saved.');
    if((row?.revision??null)===(d.expected??null))return{retry:true};
    return null;
  }
  if(action==='deployment.cutover'||action==='deployment.rollback'){
    const row=found('active-deployment','operator'),previous=old('active-deployment','operator'),history=row?.data.history??[],prior=previous?.data.history??[];
    const entry=history[prior.length];
    if(changed(previous,row)&&history.length===prior.length+1&&same(history.slice(0,prior.length),prior)&&entry&&
      entry.action===action.split('.')[1]&&entry.deployment===d.deployment&&entry.programme===d.programme&&entry.note===d.note)
      return recovered(row,'The exact endpoint selection was appended once to its retained original history.');
    if((row?.revision??null)===(d.expected??null))return{retry:true};
    return null;
  }
  if(action==='programme.run'){
    const row=found('programme',d.run_id);
    if(row&&row.data.deployment===d.deployment&&row.data.state==='complete')return recovered(row,'Every selected operation is retained in this same complete native programme.');
    // Only Hive itself decides whether its exact run can continue. Its inherited
    // run lock and started-row guard preserve ambiguous actual network effects.
    return{retry:true};
  }
  if(action==='native.start'){
    const row=found('deployment',d.deployment),previous=old('deployment',d.deployment);
    if(row?.data.currentAttempt&&row.data.currentAttempt.id!==previous?.data.currentAttempt?.id)
      return recovered(row,'The original deployment recorded its selected native attempt; a stopped attempt is not restarted.');
    if(row&&['queued','starting','running'].includes(row.data.state)){
      const observed=await client.action('native.status',{deployment:d.deployment});
      if(observed.ok&&(observed.value.observation?.nativeAlive||observed.value.observation?.supervisorAlive))return{response:observed};
      if(row.data.state==='queued')return{retry:true};
    }
    return null;
  }
  if(action==='native.stop'){
    const row=found('deployment',d.deployment),previous=old('deployment',d.deployment);
    const observed=await client.action('native.status',{deployment:d.deployment});
    if(observed.ok&&row?.data.currentAttempt?.id===previous?.data.currentAttempt?.id&&
      !observed.value.observation?.nativeAlive&&!observed.value.observation?.supervisorAlive)
      return recovered(observed.value,'The same original attempt is now observed closed; signal acknowledgement was not reconstructed.');
    return null;
  }
  if(action==='native.reconcile')return{retry:true};
  if(action==='delivery.export'){
    let file;try{file=await identity(d.destination);}catch(e){if(e.code==='ENOENT')return{retry:true};throw e;}
    const inspection=await client.action('delivery.inspect',{archive:d.destination});
    if(!inspection.ok)return null;
    const v=inspection.value;
    if(v.sha256!==file.sha256||v.bytes!==file.bytes||v.manifest.workspaceId!==record.workspaceId)return null;
    return{response:hiveResponse({path:d.destination,bytes:v.bytes,sha256:v.sha256,
      workspace:{id:v.manifest.workspaceId,revision:v.manifest.revision,verified:true},members:v.manifest.members.length,
      sourceFiles:v.manifest.members.filter(x=>x.path.startsWith('source/')).length,recovered:true})};
  }
  if(action==='delivery.receive'){
    let manifest;try{manifest=(await readJson(d.destination+'/manifest.json',MAX_JSON)).value;}catch(e){if(e.code==='ENOENT')return null;throw e;}
    const inspected=await client.action('delivery.inspect',{archive:d.archive});
    if(!inspected.ok||!same(manifest,inspected.value.manifest))return null;
    // The original receiver publishes only after complete extraction and original
    // database verification. Validate every selected member again before adopting.
    for(const f of manifest.members){const actual=await identity(d.destination+'/'+f.path);
      if(actual.bytes!==f.bytes||actual.sha256!==f.sha256)return null;}
    return{response:hiveResponse({path:d.destination,archive:{bytes:inspected.value.bytes,sha256:inspected.value.sha256},
      workspace:{id:manifest.workspaceId,revision:manifest.revision,verified:true},source:d.destination+'/source',recovered:true})};
  }
  return null;
}
