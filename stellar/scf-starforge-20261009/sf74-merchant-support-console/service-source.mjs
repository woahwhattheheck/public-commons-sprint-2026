// MIT. Complete original incident snapshot for the existing SF74 service case.
import {openIncidentStore} from '../sf93-seller-support-bundle/incident-store.mjs';
import {SERVICE_SOURCE_SCHEMA,validateServiceSnapshot} from './service-commitments.mjs';
const invalid=message=>Object.assign(new Error(message),{code:'SERVICE_SOURCE_INVALID',status:422});
export async function readServiceIncidentSnapshot({store,directory,source,merchantId}={}){
  if(typeof merchantId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(merchantId))
    throw invalid('Choose the original registered merchant ID.');
  if(!source||typeof source.id!=='string'||typeof source.label!=='string')
    throw invalid('Choose the original host-declared incident source.');
  const original=store??await openIncidentStore(directory);
  return original.transaction(state=>{
    const registered=state.config.merchants.find(value=>value.id===merchantId);
    const incidents=state.incidents.filter(value=>value.merchantId===merchantId);
    const retained=[...incidents].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.openedAt.localeCompare(a.openedAt))[0];
    if(!registered&&!retained)throw invalid('This original source has no current registration or retained incident for that merchant.');
    const binding=registered?state.merchants[merchantId]?.binding:retained.binding;
    return validateServiceSnapshot({schema:SERVICE_SOURCE_SCHEMA,capturedAt:new Date().toISOString(),
      source:{id:source.id,label:source.label},
      merchant:{id:merchantId,label:registered?.label??retained.merchantLabel??merchantId,binding,registered:Boolean(registered)},
      revision:state.revision,configRevision:state.configRevision,configHash:state.configHash,
      retention:structuredClone(state.config.retention),incidents:structuredClone(incidents)});
  },{readonly:true});
}
