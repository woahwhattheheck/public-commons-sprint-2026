/** Focused, offline contract check for SF-04 source-lock handoff only. */
import {readFileSync} from 'node:fs';
const doc=JSON.parse(readFileSync(new URL('./inventory.json',import.meta.url), 'utf8'));
const sha=/^[0-9a-f]{40}$/;
const {foundation,stellar_reference,excluded_agpl_reference}=doc.source_lock;
for(const [key,s] of Object.entries(doc.source_lock)){
  if (!sha.test(s.commit)) throw Error(`missing pinned commit: ${key}`);
  for(const [name,value] of Object.entries(s)){
    if(name.endsWith('_blob') && !sha.test(value)) throw Error(`invalid git blob: ${key}.${name}`);
  }
}
if(foundation.license!=='Apache-2.0'||stellar_reference.license!=='Apache-2.0')throw Error('unreviewed base license');
if(excluded_agpl_reference.allowed_as_project_base!==false||!excluded_agpl_reference.license.startsWith('AGPL'))throw Error('relayer policy regression');
const keys=new Set();
for(const cap of doc.capabilities){
  if(keys.has(cap.id)||!cap.id||!cap.decision||!cap.status||!cap.source_path||!sha.test(cap.evidence_blob))throw Error('invalid/duplicate capability: '+cap.id);
  keys.add(cap.id);
}
for(const k of ['exact_stellar_core','reference_http_facilitator','bazaar_schema','upto_stellar','generic_mcp_sdk','agpl_relayer'])if(!keys.has(k))throw Error(`missing required decision: ${k}`);
if(doc.capabilities.find(x=>x.id==='upto_stellar').decision!=='build_and_contribute_spec_upstream')throw Error('upto mislabeled implemented');
console.log(`PASS SF-04 focused manifest check: ${doc.capabilities.length} distinct capabilities; 3 pinned repos; AGPL excluded, upto not falsely claimed implemented.`);
