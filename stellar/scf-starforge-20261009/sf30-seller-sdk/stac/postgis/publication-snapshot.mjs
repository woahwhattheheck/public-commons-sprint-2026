// An optional original-publication constraint for receiving and full backups.
// Existing unrestricted export requests keep their original request identity.
import {need,id,hash,integer,canonical,parseExactJSON} from './contract.mjs';
export const PUBLICATION_SNAPSHOT='starforge.postgis-publication-snapshot.v1';
export function publicationSnapshot(value){
  need(value&&value.schema===PUBLICATION_SNAPSHOT,'POSTGIS_PUBLICATION_SNAPSHOT_REQUIRED');
  id(value.editionId);integer(value.revision,'publication revision',1);
  need(Array.isArray(value.layers)&&value.layers.length,'POSTGIS_PUBLICATION_LAYERS_REQUIRED');
  const seen=new Set();
  for(const layer of value.layers){
    id(layer.id);hash(layer.rowSha256);
    need(!seen.has(layer.id)&&typeof layer.rowCount==='string'&&/^\d+$/.test(layer.rowCount)&&
      typeof layer.physicalRelation==='string'&&Array.isArray(layer.roles),'POSTGIS_PUBLICATION_LAYER_INVALID');
    seen.add(layer.id);
    const roles=new Set();
    for(const role of layer.roles){
      need(typeof role.name==='string'&&!roles.has(role.name)&&typeof role.visibleRows==='string'&&
        /^\d+$/.test(role.visibleRows),'POSTGIS_PUBLICATION_ROLE_INVALID');
      roles.add(role.name);hash(role.visibleRowSha256);
    }
  }
  return parseExactJSON(canonical({schema:PUBLICATION_SNAPSHOT,editionId:value.editionId,
    revision:value.revision,layers:value.layers}));
}
export function snapshotFromPublication(value){
  return publicationSnapshot({schema:PUBLICATION_SNAPSHOT,editionId:value.editionId,revision:value.revision,layers:value.layers});
}
export function requirePublicationSnapshot(observed,expected){
  if(expected===undefined)return;
  const wanted=publicationSnapshot(expected),actual=snapshotFromPublication(observed);
  need(canonical(actual)===canonical(wanted),'POSTGIS_EXPECTED_PUBLICATION_CHANGED',
    {expected:wanted,observed:actual});
}
