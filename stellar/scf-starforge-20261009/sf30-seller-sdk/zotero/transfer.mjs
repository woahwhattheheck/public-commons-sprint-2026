// MIT. Complete source/history receiving; original Research identities remain immutable.
import {join,isAbsolute,resolve} from 'node:path';
import {readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {openDossierStore} from '../../sf88-operator-buyer-cli/research-dossiers/dossier.mjs';
import {privateDirectory,writeBytes,readBytes,writeJson,readJson} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {SCHEMA,LIMIT,need,plain,json,parse,sha256,requestId,now} from './contracts.mjs';
import {openZoteroStore,validateSnapshot,snapshotObjectReferences} from './store.mjs';

const researchIdentity=directory=>'research_'+sha256(Buffer.from(directory));
const pair=(workspaceId,dossierId)=>workspaceId+'/'+dossierId;
const validResearchId=value=>typeof value==='string'&&/^research_[a-f0-9]{64}$/.test(value);
const historyHash=(original,revision)=>sha256(json(original.versions.filter(v=>v.state.revision<=revision)));
function handoffLinks(state){
  const links=new Map();
  for(const record of state.records.filter(r=>r.kind==='handoff')){
    const h=parse(Buffer.from(record.payload));
    if(h.status!=='RECEIVED')continue;
    need(plain(h.target)&&validResearchId(h.target.workspaceId)&&/^d_[a-f0-9-]{36}$/.test(h.target.dossierId)&&
      h.result?.sourceBundleSha256===h.object?.sha256,'ZOTERO_RESEARCH_HANDOFF_INVALID');
    links.set(record.id,{handoffId:record.id,workspaceId:h.target.workspaceId,dossierId:h.target.dossierId,
      questionId:h.target.questionId,bundleSha256:h.object.sha256,editionId:h.result.editionId,
      dossierRevision:h.result.dossierRevision});
  }
  return [...links.values()];
}
function verifyResearchLinks(original,origins,links){
  const selected=new Set(origins.map(o=>pair(o.workspaceId,o.dossierId)));
  const matching=links.filter(h=>selected.has(pair(h.workspaceId,h.dossierId)));
  need(matching.length>0&&origins.every(o=>matching.some(h=>pair(h.workspaceId,h.dossierId)===pair(o.workspaceId,o.dossierId))),
    'ZOTERO_RESEARCH_BINDING_NOT_IN_HISTORY');
  const last=original.versions.at(-1)?.state;
  for(const h of matching)need(original.id===h.dossierId&&last.revision>=h.dossierRevision&&
    last.editions.some(e=>e.id===h.editionId&&e.questionId===h.questionId&&e.raw?.sha256===h.bundleSha256),
    'ZOTERO_RESEARCH_RECEIPT_SOURCE_MISMATCH');
}
function parseTransfer(bytes) {
  const raw=Buffer.from(bytes);need(raw.length<=LIMIT.transfer,'ZOTERO_TRANSFER_LIMIT');
  const packet=parse(raw);need(plain(packet)&&packet.schema===SCHEMA.portable&&plain(packet.state)&&Array.isArray(packet.objects),
    'ZOTERO_TRANSFER_INVALID');
  requestId(packet.requestId);validateSnapshot(packet.state);
  need(sha256(json(packet.state))===packet.stateSha256,'ZOTERO_TRANSFER_STATE_HASH_MISMATCH');
  const expected=new Map(snapshotObjectReferences(packet.state).map(r=>[r.sha256,r])),objects=new Map();
  for(const object of packet.objects){
    need(plain(object)&&typeof object.contentBase64==='string'&&expected.has(object.sha256)&&!objects.has(object.sha256),
      'ZOTERO_TRANSFER_OBJECT_INVALID');
    const body=Buffer.from(object.contentBase64,'base64'),ref=expected.get(object.sha256);
    need(body.toString('base64')===object.contentBase64&&body.length===object.bytes&&body.length===ref.bytes&&
      sha256(body)===object.sha256,'ZOTERO_TRANSFER_OBJECT_HASH_MISMATCH');objects.set(object.sha256,body);
  }
  need(objects.size===expected.size,'ZOTERO_TRANSFER_OBJECTS_INCOMPLETE');
  const research=new Map(),links=handoffLinks(packet.state),covered=new Set();
  need(packet.research===undefined||Array.isArray(packet.research),'ZOTERO_TRANSFER_RESEARCH_INVALID');
  for(const row of packet.research??[]){
    need(plain(row)&&/^d_[a-f0-9-]{36}$/.test(row.id)&&!research.has(row.id)&&
      typeof row.contentBase64==='string'&&Number.isSafeInteger(row.revision)&&row.revision>=1&&
      validResearchId(row.sourceWorkspaceId),'ZOTERO_TRANSFER_RESEARCH_INVALID');
    const body=Buffer.from(row.contentBase64,'base64');
    need(body.toString('base64')===row.contentBase64&&body.length===row.bytes&&sha256(body)===row.sha256,
      'ZOTERO_TRANSFER_RESEARCH_HASH_MISMATCH');
    const original=parse(body);
    need(original.id===row.id&&Array.isArray(original.versions)&&original.versions.at(-1)?.state?.revision===row.revision,
      'ZOTERO_TRANSFER_RESEARCH_IDENTITY_MISMATCH');
    const origins=row.origins??[{workspaceId:row.sourceWorkspaceId,dossierId:row.id}];
    need(Array.isArray(origins)&&origins.length>0&&origins.every(o=>plain(o)&&validResearchId(o.workspaceId)&&o.dossierId===row.id)&&
      new Set(origins.map(o=>pair(o.workspaceId,o.dossierId))).size===origins.length,'ZOTERO_RESEARCH_BINDINGS_INVALID');
    verifyResearchLinks(original,origins,links);
    const selectedHistory=historyHash(original,row.revision);
    if(row.historySha256!==undefined)need(row.historySha256===selectedHistory,'ZOTERO_RESEARCH_HISTORY_HASH_MISMATCH');
    for(const origin of origins)covered.add(pair(origin.workspaceId,origin.dossierId));
    research.set(row.id,{body,row:{...row,origins,historySha256:selectedHistory}});
  }
  need(links.every(h=>covered.has(pair(h.workspaceId,h.dossierId))),'ZOTERO_TRANSFER_RESEARCH_INCOMPLETE');
  return {packet,objects,research,raw,sha256:sha256(raw)};
}
async function localResearchBindings(store){
  const binding=await readJson(join(store.directory,'research-bindings.json'),LIMIT.metadata)
    .catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
  if(!binding)return null;
  const receipt=await readJson(join(store.directory,'receiving.json'),LIMIT.metadata);
  need(binding.schema==='stellar-forge.zotero-research-bindings.v1'&&
    binding.workspaceId===store.identity.workspaceId&&binding.installationId===receipt.installationId&&
    binding.requestId===receipt.requestId&&binding.packetSha256===receipt.packetSha256&&
    receipt.status==='COMPLETE'&&binding.relativeDirectory==='research'&&Array.isArray(binding.entries)&&
    receipt.researchBindingSha256===sha256(json(binding)),'ZOTERO_RESEARCH_RECEIVING_BINDING_CHANGED');
  for(const entry of binding.entries)need(plain(entry)&&validResearchId(entry.workspaceId)&&
    /^d_[a-f0-9-]{36}$/.test(entry.dossierId)&&Number.isSafeInteger(entry.receivedRevision)&&entry.receivedRevision>=1&&
    /^[a-f0-9]{64}$/.test(entry.historySha256),'ZOTERO_RESEARCH_BINDINGS_INVALID');
  need(new Set(binding.entries.map(e=>pair(e.workspaceId,e.dossierId))).size===binding.entries.length,
    'ZOTERO_RESEARCH_BINDINGS_INVALID');
  return binding;
}
export async function receivedResearchDirectory(store){const binding=await localResearchBindings(store);return binding?.entries.length?join(store.directory,binding.relativeDirectory):null;}
export async function resolveResearchTarget(store,target,{dossiers=null}={}) {
  if(dossiers&&target.workspaceId===researchIdentity(dossiers.directory))return dossiers;
  const binding=await localResearchBindings(store),entry=binding?.entries.find(e=>
    e.workspaceId===target.workspaceId&&e.dossierId===target.dossierId);
  need(entry,'ZOTERO_RESEARCH_TARGET_CHANGED');
  const original=await openDossierStore(join(store.directory,binding.relativeDirectory));
  const selected=await original.exportDossier(target.dossierId,{format:'json',revision:entry.receivedRevision});
  need(historyHash(parse(selected.body),entry.receivedRevision)===entry.historySha256,'ZOTERO_RECEIVED_RESEARCH_HISTORY_CHANGED');
  return original;
}
export async function exportWorkspace(store,operation,{dossiers=null}={}) {
  const op=requestId(operation),directory=join(store.directory,'exports');
  await privateDirectory(directory);const path=join(directory,op+'.json');
  const existing=await readBytes(path,LIMIT.transfer).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
  if(existing){const read=parseTransfer(existing);
    need(read.packet.requestId===op&&read.packet.state.identity.workspaceId===store.identity.workspaceId,'ZOTERO_EXPORT_IDENTITY_CHANGED');
    return {bytes:existing,filename:'zotero-workspace-'+op+'.json',sha256:read.sha256,
      workspaceId:store.identity.workspaceId,exportedAt:read.packet.exportedAt,replayed:true};}
  const state=store.snapshot(),objects=[];
  for(const reference of snapshotObjectReferences(state)){
    const bytes=await store.objectBytes(reference);objects.push({...reference,contentBase64:bytes.toString('base64')});
  }
  const research=[],links=handoffLinks(state),binding=await localResearchBindings(store);
  let receivedStore=null;
  if(binding?.entries.length)receivedStore=await openDossierStore(join(store.directory,binding.relativeDirectory));
  const currentIdentity=dossiers?researchIdentity(dossiers.directory):null,resolved=new Map();
  for(const link of links){
    const local=binding?.entries.find(e=>pair(e.workspaceId,e.dossierId)===pair(link.workspaceId,link.dossierId));
    const owner=link.workspaceId===currentIdentity?dossiers:local?receivedStore:null;
    need(owner,'ZOTERO_RESEARCH_SOURCE_UNAVAILABLE',{workspaceId:link.workspaceId,dossierId:link.dossierId});
    const selected=resolved.get(link.dossierId);
    if(selected)need(selected.owner.directory===owner.directory,'ZOTERO_RESEARCH_DOSSIER_SOURCE_AMBIGUOUS');
    else resolved.set(link.dossierId,{owner,origins:[],bindings:[]});
    const target=resolved.get(link.dossierId);
    if(!target.origins.some(o=>o.workspaceId===link.workspaceId))target.origins.push({workspaceId:link.workspaceId,dossierId:link.dossierId});
    if(local&&!target.bindings.includes(local))target.bindings.push(local);
  }
  for(const [id,selection]of [...resolved].sort(([a],[b])=>a.localeCompare(b))){
    const selected=await selection.owner.getMetadata(id),exported=await selection.owner.exportDossier(id,{format:'json',revision:selected.revision});
    const body=Buffer.from(exported.body),original=parse(body);
    for(const binding of selection.bindings)need(selected.revision>=binding.receivedRevision&&
      historyHash(original,binding.receivedRevision)===binding.historySha256,'ZOTERO_RECEIVED_RESEARCH_HISTORY_CHANGED');
    verifyResearchLinks(original,selection.origins,links);
    research.push({id,revision:selected.revision,sourceWorkspaceId:researchIdentity(selection.owner.directory),
      origins:selection.origins.sort((a,b)=>a.workspaceId.localeCompare(b.workspaceId)),historySha256:historyHash(original,selected.revision),
      bytes:body.length,sha256:sha256(body),contentBase64:body.toString('base64')});
  }
  const bytes=json({schema:SCHEMA.portable,requestId:op,exportedAt:now(),stateSha256:sha256(json(state)),state,objects,research,
    credentialPolicy:'Environment reference names are retained. Credential values and native writer leases are absent.'});
  need(bytes.length<=LIMIT.transfer,'ZOTERO_TRANSFER_LIMIT');
  try{await writeBytes(path,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;return exportWorkspace(store,op,{dossiers});}
  return {bytes,filename:'zotero-workspace-'+op+'.json',sha256:sha256(bytes),workspaceId:store.identity.workspaceId,
    exportedAt:parse(bytes).exportedAt,replayed:false};
}
export async function receiveWorkspace(bytes,{directory,requestId:operation}={}) {
  const op=requestId(operation);need(isAbsolute(directory)&&resolve(directory)===directory,'ZOTERO_ABSOLUTE_DIRECTORY_REQUIRED');
  const prepared=parseTransfer(bytes);
  await privateDirectory(directory);
  const markerPath=join(directory,'receiving.json');
  let marker=await readJson(markerPath).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
  if(marker){
    need(marker.requestId===op&&marker.packetSha256===prepared.sha256,'ZOTERO_RECEIVING_INPUT_CHANGED');
  }else{
    need((await readdir(directory)).length===0,'ZOTERO_RECEIVING_DIRECTORY_NOT_EMPTY');
    const initial={schema:'stellar-forge.zotero-receiving.v1',requestId:op,packetSha256:prepared.sha256,
      workspaceId:prepared.packet.state.identity.workspaceId,installationId:randomUUID(),status:'RECEIVING',startedAt:now()};
    try{await writeJson(markerPath,initial,{exclusive:true});marker=initial;}
    catch(error){if(error.code!=='EEXIST')throw error;marker=await readJson(markerPath);
      need(marker.requestId===op&&marker.packetSha256===prepared.sha256,'ZOTERO_RECEIVING_INPUT_CHANGED');}
  }
  let store;
  try{
    store=await openZoteroStore(directory,{receiving:true});
    if(marker.status==='COMPLETE'){
      need(store.identity.workspaceId===prepared.packet.state.identity.workspaceId,'ZOTERO_RECEIVING_IDENTITY_CHANGED');
      return {...marker,replayed:true};
    }
    for(const [hash,body]of prepared.objects){const ref=await store.putObject(body);need(ref.sha256===hash,'ZOTERO_RECEIVING_OBJECT_CHANGED');}
    const current=store.snapshot();
    if(current.records.length||current.requests.length){
      need(sha256(json(current))===prepared.packet.stateSha256,'ZOTERO_RECEIVING_STATE_CONFLICT');
    }else store.adopt(prepared.packet.state);
    need(sha256(json(store.snapshot()))===prepared.packet.stateSha256,'ZOTERO_RECEIVING_STATE_MISMATCH');
    const researchReceipts=[],entries=[];
    if(prepared.research.size){
      const original=await openDossierStore(join(directory,'research'));
      for(const [id,{body,row}]of prepared.research){
        const received=await original.reopenStream(Readable.from([body]),{projection:'metadata'});
        need(received.id===id&&received.revision>=row.revision,'ZOTERO_RESEARCH_RECEIVING_MISMATCH');
        researchReceipts.push({id,revision:row.revision,sha256:row.sha256,historySha256:row.historySha256});
        for(const origin of row.origins)entries.push({...origin,receivedRevision:row.revision,historySha256:row.historySha256});
      }
    }
    const binding={schema:'stellar-forge.zotero-research-bindings.v1',workspaceId:store.identity.workspaceId,
      installationId:marker.installationId,requestId:op,packetSha256:prepared.sha256,relativeDirectory:'research',
      entries:entries.sort((a,b)=>pair(a.workspaceId,a.dossierId).localeCompare(pair(b.workspaceId,b.dossierId)))};
    await writeJson(join(directory,'research-bindings.json'),binding);
    const complete={...marker,status:'COMPLETE',completedAt:now(),research:researchReceipts,researchBindingSha256:sha256(json(binding)),
      sourceWorkspaceId:prepared.packet.state.identity.workspaceId,recordRevisions:prepared.packet.state.records.length,objects:prepared.objects.size};
    await writeJson(markerPath,complete);
    return {...complete,replayed:false};
  }finally{store?.close();}
}
export {parseTransfer};
