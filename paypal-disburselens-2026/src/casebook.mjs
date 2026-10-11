// MIT. Portable human review states, bound to the current reconciliation evidence.
// This file neither restores provider data nor authenticates a reviewer's identity.
const SCHEMA='disburselens-casebook/v1';
const MAX_CASES=1000;
const MAX_BYTES=262144;
const STATES=new Set(['open','acknowledged','escalated']);
const CASE_ID=/^[0-9a-f]{16}$/;
const EVIDENCE_HASH=/^[0-9a-f]{64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

function fail(message,status=400){
  const error=new Error(message);
  error.status=status;
  throw error;
}

function exactFields(value,fields,label){
  if(!plain(value)||Object.keys(value).length!==fields.length||
      fields.some(field=>!Object.hasOwn(value,field))){
    fail(`Invalid ${label} fields`);
  }
}

function validVersion(value){return Number.isSafeInteger(value)&&value>=1;}

function timestamp(value,label){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||
      !Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value){
    fail(`Invalid ${label}`);
  }
  return value;
}

function sourceName(value){
  return typeof value==='string'&&value.length>=1&&value.length<=128&&
    !/[\x00-\x1f\x7f]/.test(value);
}

function currentSnapshot({result,cases,version}){
  if(!plain(result)||!sourceName(result.source)||!EVIDENCE_HASH.test(result.evidenceHash??'')||
      !Array.isArray(result.items)||result.items.length>MAX_CASES||
      !(cases instanceof Map)||!validVersion(version)){
    fail('Invalid current casebook');
  }
  const ids=new Set();
  for(const item of result.items){
    if(typeof item?.caseId!=='string'||!CASE_ID.test(item.caseId)||ids.has(item.caseId)){
      fail('Invalid current case identifiers');
    }
    ids.add(item.caseId);
  }
  for(const [id,record] of cases){
    if(!ids.has(id)||!plain(record)||!STATES.has(record.state)||
        record.evidenceHash!==result.evidenceHash){
      fail('Current review state does not match current evidence');
    }
    timestamp(record.changedAt,'current review timestamp');
  }
  return ids;
}

function bounded(value){
  let serialized;
  try{serialized=JSON.stringify(value);}catch{fail('Casebook must be JSON data');}
  if(typeof serialized!=='string'||Buffer.byteLength(serialized,'utf8')>MAX_BYTES){
    fail('Casebook exceeds 262144 bytes');
  }
}

/** Export only opaque case identifiers and review states, never payout fields. */
export function exportCasebook({result,cases,version,now=new Date().toISOString()}){
  const ids=currentSnapshot({result,cases,version});
  const casebook={
    schema:SCHEMA,source:result.source,evidenceHash:result.evidenceHash,
    exportVersion:version,exportedAt:timestamp(now,'export timestamp'),
    cases:[...ids].sort().map(caseId=>({caseId,state:cases.get(caseId)?.state??'open'})),
  };
  bounded(casebook);
  return casebook;
}

/**
 * Validate the complete backup and calculate a replacement without mutation.
 * expectedVersion is the report version reviewed NOW, not exportVersion from a
 * previous process. The server must apply nextCases synchronously after this call.
 */
export function planCasebookRestore(casebook,{result,cases,version,expectedVersion,
    now=new Date().toISOString()}){
  const ids=currentSnapshot({result,cases,version});
  if(!validVersion(expectedVersion)||expectedVersion!==version){
    fail('Stale report version; refresh before restoring the casebook',409);
  }
  bounded(casebook);
  exactFields(casebook,['schema','source','evidenceHash','exportVersion','exportedAt','cases'],'casebook');
  if(casebook.schema!==SCHEMA||!sourceName(casebook.source)||
      typeof casebook.evidenceHash!=='string'||!EVIDENCE_HASH.test(casebook.evidenceHash)||
      !validVersion(casebook.exportVersion)||!Array.isArray(casebook.cases)||
      casebook.cases.length>MAX_CASES){
    fail('Invalid casebook schema or metadata');
  }
  timestamp(casebook.exportedAt,'casebook export timestamp');
  timestamp(now,'restore timestamp');
  if(casebook.source!==result.source||casebook.evidenceHash!==result.evidenceHash){
    fail('Casebook source or evidence does not match the current batch',409);
  }
  if(casebook.cases.length!==ids.size){
    fail('Casebook must contain the complete current case set');
  }
  const states=new Map();
  for(const record of casebook.cases){
    exactFields(record,['caseId','state'],'case record');
    if(typeof record.caseId!=='string'||!CASE_ID.test(record.caseId)||
        !ids.has(record.caseId)||states.has(record.caseId)||!STATES.has(record.state)){
      fail('Invalid, duplicated or unknown case identifier or review state');
    }
    states.set(record.caseId,record.state);
  }

  // No caller-owned Map, report, record or backup is modified, including on error.
  const nextCases=new Map();
  const counts={open:0,acknowledged:0,escalated:0};
  const changes=[];
  for(const caseId of [...ids].sort()){
    const to=states.get(caseId);
    const current=cases.get(caseId);
    const from=current?.state??'open';
    counts[to]++;
    if(from!==to){
      changes.push({caseId,from,to});
      nextCases.set(caseId,{state:to,changedAt:now,evidenceHash:result.evidenceHash});
    }else if(current){
      nextCases.set(caseId,structuredClone(current));
    }
  }
  return {nextCases,summary:{currentVersion:version,evidenceHash:result.evidenceHash,
    source:result.source,exportVersion:casebook.exportVersion,exportedAt:casebook.exportedAt,
    counts,changes}};
}
