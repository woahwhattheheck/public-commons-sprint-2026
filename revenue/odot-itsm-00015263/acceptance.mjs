#!/usr/bin/env node
// MIT. Read-only, noncustodial migration QA; no network or target-system access.
// This checks buyer-approved canonical export projections, NOT native Remedy/ITSM APIs.
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export const SCHEMA = 'tjl-itsm-acceptance-v1';
const TYPES = ['incident','request','problem','change','asset','knowledge'];
const TYPE_SET = new Set(TYPES);
const OWN = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonempty = s => typeof s === 'string' && s.length > 0 && s.length <= 256 && !/[\x00-\x1f\x7f]/.test(s);
const hex64 = s => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const sha = s => createHash('sha256').update(s).digest('hex');
const sorted = v => [...v].sort();
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = r => r.type+':'+r.legacyId;
const anon = id => sha(id).slice(0,20);

export class AcceptanceInputError extends Error {
  constructor(reason){super(reason); this.name='AcceptanceInputError';this.code=reason;}
}
function requireValid(x,reason){if(!x) throw new AcceptanceInputError(reason);}

function readProjection(manifest,system){
  requireValid(object(manifest) && manifest.schemaVersion===SCHEMA &&
    manifest.system===system && Array.isArray(manifest.records), 'INVALID_EXPORT_CONTRACT');
  const seen=new Set(), targetIds=new Set(), records=new Map(), counts=Object.fromEntries(TYPES.map(t=>[t,0]));
  for(const r of manifest.records){
    requireValid(object(r) && TYPE_SET.has(r.type) && nonempty(r.legacyId) &&
      nonempty(r.canonicalStatus) &&
      (r.ownerKey===undefined || nonempty(r.ownerKey)) &&
      (r.assigneeKey===undefined || nonempty(r.assigneeKey)) &&
      Array.isArray(r.assetRefs) && r.assetRefs.every(nonempty) &&
      Array.isArray(r.attachmentSha256) && r.attachmentSha256.every(hex64), 'INVALID_RECORD_CONTRACT');
    requireValid(r.assetRefs.length===new Set(r.assetRefs).size &&
      r.attachmentSha256.length===new Set(r.attachmentSha256).size, 'DUPLICATE_LINK_OR_ATTACHMENT');
    if(system==='target') {
      requireValid(nonempty(r.targetRecordId), 'MISSING_TARGET_RECORD_ID');
      requireValid(!targetIds.has(r.targetRecordId), 'DUPLICATE_TARGET_RECORD_ID');
      targetIds.add(r.targetRecordId);
    }
    const key=keyOf(r);
    requireValid(!seen.has(key), 'DUPLICATE_LEGACY_ID');
    seen.add(key);
    records.set(key,{
      type:r.type,legacyId:r.legacyId,canonicalStatus:r.canonicalStatus,
      ownerKey:r.ownerKey??null,assigneeKey:r.assigneeKey??null,
      assetRefs:sorted(r.assetRefs), attachmentSha256:sorted(r.attachmentSha256)
    });
    counts[r.type]++;
  }
  return {records,counts};
}
function checkAssetLinks(exportData,side,add){
  const assets=new Set([...exportData.records.values()].filter(r=>r.type==='asset').map(r=>r.legacyId));
  for(const r of exportData.records.values()) for(const id of r.assetRefs){
    if(!assets.has(id)) add('DANGLING_ASSET_REFERENCE',keyOf(r),side);
  }
}

/**
 * Reconcile ALL records from two original-system-approved canonical projections.
 * A success means these selected fields agree. It does not certify identity,
 * permissions, complete export coverage or platform procurement conformance.
 */
export function reconcile(sourceManifest,targetManifest,{sourceSha256=null,targetSha256=null}={}){
  const src=readProjection(sourceManifest,'remedy');
  const dest=readProjection(targetManifest,'target');
  const findings=[];
  const breakdown=Object.fromEntries(TYPES.map(t=>[t,{source:src.counts[t],target:dest.counts[t],findings:0}]));
  const add=(code,key,side)=>{
    const type=key.split(':',1)[0];
    findings.push({code,type,recordKeyHash:anon(key),side});
    breakdown[type].findings++;
  };
  checkAssetLinks(src,'source',add);
  checkAssetLinks(dest,'target',add);
  for(const [key,row] of src.records){
    const matched=dest.records.get(key);
    if(!matched){add('MISSING_TARGET_RECORD',key,'target');continue;}
    for(const [field,code] of [
      ['canonicalStatus','STATUS_DRIFT'],['ownerKey','OWNER_KEY_DRIFT'],
      ['assigneeKey','ASSIGNEE_KEY_DRIFT'],['assetRefs','ASSET_LINKS_DRIFT'],
      ['attachmentSha256','ATTACHMENT_DIGESTS_DRIFT']
    ]) if(!equal(row[field],matched[field])) add(code,key,'both');
  }
  for(const key of dest.records.keys()) if(!src.records.has(key))add('EXTRA_TARGET_RECORD',key,'target');
  const codes={};for(const f of findings)codes[f.code]=(codes[f.code]??0)+1;
  return {
    schemaVersion:'tjl-itsm-acceptance-report-v1',pass:findings.length===0,
    sourceSystem:'remedy',targetSystem:'target',
    provenance:{sourceSha256,targetSha256},
    totals:{source:src.records.size,target:dest.records.size,findings:findings.length},
    breakdown, findingCounts:Object.fromEntries(Object.entries(codes).sort()),findings
  };
}

async function main(args){
  if(args.length!==2 && args.length!==4) throw new AcceptanceInputError('USAGE: node acceptance.mjs REMEDY.json TARGET.json [--out REPORT.json]');
  if(args.length===4 && args[2]!=='--out')throw new AcceptanceInputError('REPORT_OUTPUT_FLAG_REQUIRED');
  const [sourcePath,targetPath,,outPath]=args;
  const [sourceBytes,targetBytes]=await Promise.all([readFile(sourcePath),readFile(targetPath)]);
  const result=reconcile(JSON.parse(sourceBytes),JSON.parse(targetBytes),{
    sourceSha256:sha(sourceBytes),targetSha256:sha(targetBytes)
  });
  const output=JSON.stringify(result,null,2)+'\n';
  if(outPath)await writeFile(outPath,output,{flag:'wx'});
  process.stdout.write(JSON.stringify({pass:result.pass,totals:result.totals,
    findingCounts:result.findingCounts,provenance:result.provenance,
    fullReport:outPath??'stdout-details-not-written'})+'\n');
  if(!outPath)process.stdout.write(output);
  if(!result.pass)process.exitCode=1;
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]){
  main(process.argv.slice(2)).catch(e=>{
    process.stderr.write((e instanceof AcceptanceInputError?e.code:e.message)+'\n');
    process.exitCode=2;
  });
}
