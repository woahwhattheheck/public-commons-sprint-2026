// MIT — evidence-only migration acceptance. No tenant or API connection.
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const HASH=/^[0-9a-f]{64}$/;
const text=v=>typeof v==='string'&&v.length>0&&v.length<=4096&&!/[\x00-\x1f\x7f]/.test(v);
const iso=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v)&&!Number.isNaN(Date.parse(v));
const roles=v=>Array.isArray(v)&&v.length>0&&v.length<=2048&&v.every(text)&&new Set(v).size===v.length;
const eq=(a,b)=>{if(a.length!==b.length)return false;const A=[...a].sort(),B=[...b].sort();return A.every((v,i)=>v===B[i]);};

export function parseManifest(raw,{kind='source',maxBytes=16*1024*1024}={}){
  if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>maxBytes)throw Error('MANIFEST_TOO_LARGE');
  const rows=new Map();
  raw.split(/\r?\n/).forEach((line,i)=>{
    if(!line.trim())return;
    let r;try{r=JSON.parse(line);}catch{throw Error('INVALID_JSON_LINE_'+(i+1));}
    if(!r||typeof r!=='object'||Array.isArray(r)||!text(r.sourceId)||!text(r.path)||
      typeof r.contentSha256!=='string'||!HASH.test(r.contentSha256)||
      !Number.isSafeInteger(r.sizeBytes)||r.sizeBytes<0||!roles(r.principals)||!text(r.label))
      throw Error('INVALID_'+kind.toUpperCase()+'_ROW_'+(i+1));
    if(kind==='source'&&(!text(r.expectedTargetPath)||!iso(r.classifiedAt)))
      throw Error('MISSING_SOURCE_POLICY_FIELDS_'+(i+1));
    if(kind==='target'&&!iso(r.migratedAt))throw Error('MISSING_TARGET_MIGRATION_TIME_'+(i+1));
    if(rows.has(r.sourceId))throw Error('DUPLICATE_SOURCE_ID_'+r.sourceId);
    rows.set(r.sourceId,r);
  });
  if(rows.size===0)throw Error('EMPTY_MANIFEST');
  return rows;
}

export function auditMigration(source,target){
  if(!(source instanceof Map)||!(target instanceof Map))throw TypeError('Two parsed manifests required');
  const failures=[];let matched=0,sourceBytes=0,targetBytes=0;
  const add=(id,code)=>failures.push({sourceId:id,code});
  for(const [id,s] of source){
    sourceBytes+=s.sizeBytes;
    const t=target.get(id);
    if(!t){add(id,'MISSING_TARGET_OBJECT');continue;}
    matched++;targetBytes+=t.sizeBytes;
    if(s.expectedTargetPath!==t.path)add(id,'UNEXPECTED_TARGET_PATH');
    if(s.contentSha256!==t.contentSha256)add(id,'CONTENT_HASH_MISMATCH');
    if(s.sizeBytes!==t.sizeBytes)add(id,'SIZE_MISMATCH');
    if(!eq(s.principals,t.principals))add(id,'ACL_PRINCIPAL_MISMATCH');
    if(s.label!==t.label)add(id,'PURVIEW_LABEL_MISMATCH');
    if(Date.parse(s.classifiedAt)>Date.parse(t.migratedAt))add(id,'CLASSIFIED_AFTER_MIGRATION');
  }
  for(const id of target.keys())if(!source.has(id))add(id,'UNEXPECTED_TARGET_OBJECT');
  failures.sort((a,b)=>a.sourceId.localeCompare(b.sourceId)||a.code.localeCompare(b.code));
  return {schema:'ma-m365-acceptance.v1',status:failures.length?'FAIL':'PASS',
    evidence:'USER_SUPPLIED_MANIFESTS_ONLY_NOT_TENANT_VERIFIED',
    sourceObjects:source.size,targetObjects:target.size,matchedObjects:matched,
    sourceBytes,targetMatchedBytes:targetBytes,failures};
}

export function auditJsonl(sourceText,targetText){
  return auditMigration(parseManifest(sourceText),parseManifest(targetText,{kind:'target'}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==4){
    console.error('Usage: node audit.mjs <source.jsonl> <target.jsonl>');process.exitCode=64;
  }else try{
    const [source,target]=process.argv.slice(2).map(f=>{
      if(statSync(f).size>16*1024*1024)throw Error('MANIFEST_TOO_LARGE');
      return readFileSync(f,'utf8');
    });
    const result=auditJsonl(source,target);
    console.log(JSON.stringify(result,null,2));
    if(result.status!=='PASS')process.exitCode=2;
  }catch(error){
    console.error(JSON.stringify({status:'ERROR',error:error.message}));process.exitCode=64;
  }
}
