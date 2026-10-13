// SPDX-License-Identifier: MIT
// Resolve one complete original source edition through chronological maintenance.
import {createHash} from 'node:crypto';

const AUTHORITY='stellar-forge.clickhouse-acceptance-workbench-original-source.v1';
const MANIFEST='commons.editable-source-manifest.v1';
const MANIFEST_PATH='SOURCE_MANIFEST.json';
const SOURCE_FILES=54;
const need=(yes,message,details={})=>{
  if(!yes)throw Object.assign(new Error(message),{code:'MERCHANT_REFERENCE_SOURCE',details});
};
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function sourcePath(value){
  need(typeof value==='string'&&value.length>0&&!/[\\\u0000-\u001f\u007f]/.test(value)&&
    !value.startsWith('/')&&!/^[A-Za-z]:/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'),
    'Retain canonical relative original source paths.');
  return value;
}
function descriptor(value,path=null){
  need(object(value),'Retain a complete original source descriptor.');
  const actual=sourcePath(value.path);
  need(path===null||actual===path,'A maintenance descriptor selects a different source path.',{path});
  need(Number.isSafeInteger(value.bytes)&&value.bytes>=0&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256),
    'Retain the exact original source byte count and SHA-256.',{path:actual});
  return {path:actual,bytes:value.bytes,sha256:value.sha256};
}
function identity(value){
  need(object(value)&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256),
    'Retain the exact original manifest byte count and SHA-256.');
  return {bytes:value.bytes,sha256:value.sha256};
}
function same(left,right){return !!left&&!!right&&left.path===right.path&&left.bytes===right.bytes&&left.sha256===right.sha256;}
function sameIdentity(left,right){return left.bytes===right.bytes&&left.sha256===right.sha256;}
function inventory(rows,count){
  need(Array.isArray(rows)&&rows.length===count,'Retain the whole original source inventory.',{expectedFiles:count});
  const result=new Map();
  for(const value of rows){
    const row=descriptor(value);
    need(!result.has(row.path),'The original source inventory repeats a path.',{path:row.path});
    result.set(row.path,row);
  }
  return result;
}
function wholeMatches(left,right){
  return left.size===right.size&&[...left].every(([path,row])=>same(row,right.get(path)));
}

/**
 * Return every chronological candidate, newest first, without collapsing paths.
 * Candidates are not admitted editions until their complete manifest is checked.
 * Repeated maintenance of one file is reversed only from its exact postimage.
 */
export function sourceEditionCandidates(authority){
  need(object(authority)&&authority.schema===AUTHORITY,'Use the maintained original source authority.');
  const selected=inventory(authority.files,SOURCE_FILES);
  need(selected.has(MANIFEST_PATH),'The complete source inventory must include its own manifest.');
  const steps=authority.maintenance??[];
  need(Array.isArray(steps),'Retain chronological original source maintenance.');
  const edits=steps.map((entry,index)=>{
    need(object(entry),'Retain each complete original source maintenance step.',{index});
    const path=sourcePath(entry.path);
    need(selected.has(path),'Maintenance must preserve the original source path set.',{path,index});
    return {path,original:descriptor(entry.original,path),selected:descriptor(entry.selected,path)};
  });
  const current=new Map(selected),candidates=[];
  const retain=applied=>candidates.push({
    maintenanceApplied:applied,
    maintenanceTotal:edits.length,
    edition:applied===edits.length?'maintained':applied===0?'original':'historical-maintained',
    manifest:{...current.get(MANIFEST_PATH)},
    files:[...current.values()].map(row=>({...row}))
  });
  retain(edits.length);
  for(let index=edits.length-1;index>=0;index--){
    const step=edits[index];
    need(same(current.get(step.path),step.selected),
      'Chronological source maintenance does not continue its selected preimage.',{path:step.path,index});
    current.set(step.path,{...step.original});
    retain(index);
  }
  return candidates;
}

/**
 * Admit one coherent retained edition. manifestBytes are the complete original
 * JSON bytes, not a reserialization. actualFiles, when present, are all 54
 * measured source files. For a result-only read, the retained 53-row manifest
 * plus its actual hash admits the edition without requiring a relocated source.
 *
 * Admission does not authorize replacement of an operation's original selection.
 * Callers retain expectedManifest from that original selection. A deliberately
 * adopted observer has its own separately admitted binding and provenance.
 */
export function resolveSourceEdition({authority,manifestBytes,actualFiles,expectedManifest}={}){
  need(typeof manifestBytes==='string'||manifestBytes instanceof Uint8Array,
    'Read the complete original manifest bytes.');
  const bytes=typeof manifestBytes==='string'?new TextEncoder().encode(manifestBytes):Uint8Array.from(manifestBytes);
  const measured={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  let manifest;
  try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{need(false,'The complete original source manifest must be valid UTF-8 JSON.');}
  need(object(manifest)&&manifest.schema===MANIFEST&&typeof manifest.operation==='string'&&manifest.operation.length>0,
    'Use the complete original editable source manifest.');
  if(expectedManifest!==undefined){
    need(sameIdentity(measured,identity(expectedManifest)),
      'The retained source manifest differs from the original operation selection.');
  }
  const leaves=inventory(manifest.files,SOURCE_FILES-1);
  need(!leaves.has(MANIFEST_PATH),'The original manifest binds 53 leaves before its own identity.');
  const complete=new Map(leaves);
  complete.set(MANIFEST_PATH,{path:MANIFEST_PATH,...measured});
  let measuredFiles;
  if(actualFiles!==undefined){
    measuredFiles=inventory(actualFiles,SOURCE_FILES);
    need(wholeMatches(measuredFiles,complete),
      'Every measured source file must match the complete original manifest, including the manifest itself.');
  }
  // Validate the entire authority chain even when current source would match.
  const candidates=sourceEditionCandidates(authority);
  const matches=candidates.filter(candidate=>sameIdentity(candidate.manifest,measured)&&
    wholeMatches(inventory(candidate.files,SOURCE_FILES),complete));
  need(matches.length>0,
    'Retain one complete coherent original or maintained edition; mixed historical files are not an edition.');
  const selected=matches[0];
  return {
    schema:'stellar-forge.clickhouse-acceptance-source-edition.v1',
    edition:selected.edition,
    maintenanceApplied:selected.maintenanceApplied,
    maintenanceTotal:selected.maintenanceTotal,
    manifest:measured,
    operation:manifest.operation,
    files:(measuredFiles?[...measuredFiles.values()]:selected.files).map(row=>({...row})),
    origin:authority.origin===undefined?null:JSON.parse(JSON.stringify(authority.origin))
  };
}
