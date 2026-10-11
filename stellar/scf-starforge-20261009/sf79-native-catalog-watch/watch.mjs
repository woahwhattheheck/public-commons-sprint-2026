#!/usr/bin/env node
// MIT. SF79: durable observation of the actual SF70 federated native Bazaar reader.
// Reuses original SF70/SF71 source and comparison semantics without paid requests.
import { createHash } from 'node:crypto';
import { open, readFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const WATCH_SCHEMA = 'SCF-SF79/native-watch-v1';
const SOURCE_SCHEMA = 'SCF-SF70/federated-native-bazaar-v1';
const HASH_0 = '0'.repeat(64);
const MAX_CAPTURE_BYTES = 24 * 1024 * 1024;
const MAX_SAMPLES = 100000;
const NETWORKS = new Set(['stellar:testnet', 'stellar:pubnet']);
const PROVIDERS = new Set(['vellar', 'periplo']);
const SHA = value => createHash('sha256').update(value).digest('hex');
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const canonical = value => JSON.stringify(value);
const captureName = sequence => `capture-${String(sequence).padStart(8, '0')}.json`;

export function checkNativeSnapshot(snapshot, network) {
  assert(object(snapshot), 'NATIVE_SNAPSHOT_NOT_OBJECT');
  assert(snapshot.schema === SOURCE_SCHEMA, 'WRONG_NATIVE_SF70_SCHEMA');
  assert(snapshot.network === network && NETWORKS.has(network), 'NETWORK_SCOPE_MISMATCH');
  assert(typeof snapshot.observedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(snapshot.observedAt)
    && Number.isFinite(Date.parse(snapshot.observedAt)), 'MISSING_NATIVE_OBSERVATION_TIME');
  assert(Array.isArray(snapshot.sources) && snapshot.sources.length === 2, 'INVALID_NATIVE_SOURCES');
  assert(Array.isArray(snapshot.listings), 'INVALID_NATIVE_LISTINGS');
  assert(Number.isSafeInteger(snapshot.observedListingRows) && snapshot.observedListingRows === snapshot.listings.length, 'NATIVE_ROW_COUNT_MISMATCH');
  const names = new Set();
  let successes = 0;
  for (const source of snapshot.sources) {
    assert(object(source) && PROVIDERS.has(source.provider) && !names.has(source.provider), 'INVALID_NATIVE_PROVIDER_ID');
    names.add(source.provider);
    assert(source.network === network, 'PROVIDER_NETWORK_MISMATCH');
    assert(typeof source.endpoint === 'string' && source.endpoint.startsWith('https://'), 'INVALID_NATIVE_SOURCE_ENDPOINT');
    assert(source.status === 'COMPLETE_GET_CAPTURE' || source.status === 'SOURCE_ERROR', 'INVALID_NATIVE_SOURCE_STATUS');
    if (source.status === 'COMPLETE_GET_CAPTURE') {
      successes++;
      assert(Number.isSafeInteger(source.rows) && source.rows >= 0, 'INVALID_NATIVE_SOURCE_ROWS');
      assert(Number.isSafeInteger(source.pages) && source.pages > 0, 'INVALID_NATIVE_SOURCE_PAGES');
    }
  }
  assert(names.size === 2, 'NATIVE_PROVIDER_SET_INCOMPLETE');
  const expected = successes === 2 ? 'BOTH_SOURCES_COMPLETE' : successes === 1 ? 'PARTIAL_SOURCE_FAILURE' : 'NO_SOURCES_AVAILABLE';
  assert(snapshot.state === expected, 'SOURCE_STATE_INCONSISTENT');
  const counted = Object.fromEntries([...names].map(name => [name, 0]));
  for (const row of snapshot.listings) {
    assert(object(row) && names.has(row.source) && Array.isArray(row.paymentOptions), 'INVALID_NATIVE_LISTING');
    counted[row.source]++;
  }
  for (const source of snapshot.sources) {
    assert(counted[source.provider] === (source.status === 'COMPLETE_GET_CAPTURE' ? source.rows : 0), 'SOURCE_LISTING_COUNT_MISMATCH');
  }
  assert(snapshot.merchantRequests === 0 && snapshot.payments === 0 && snapshot.signatures === 0,
    'PAID_OR_SIGNED_SOURCE_NOT_SUPPORTED');
  const serialized = canonical(snapshot);
  assert(Buffer.byteLength(serialized, 'utf8') <= MAX_CAPTURE_BYTES, 'NATIVE_CAPTURE_EXCEEDS_24MIB');
  return serialized;
}

function formatDelta(comparison) {
  if (!comparison) return { status:'BASELINE_CAPTURE', comparedSources:0, skippedSources:[], changes:[], counts:{added:0,removed:0,changed:0} };
  if (comparison.comparable !== true) return { status:'NOT_COMPARABLE', reason:String(comparison.reason ?? 'unknown').slice(0,180),
    comparedSources:0, skippedSources:[], changes:[], counts:{added:0,removed:0,changed:0} };
  const counts = comparison.counts ?? {};
  assert(Number.isSafeInteger(comparison.comparedSources) && comparison.comparedSources >= 0 && comparison.comparedSources <= 2,
    'INVALID_ORIGINAL_COMPARISON');
  const skips = comparison.skippedSources ?? [];
  assert(Array.isArray(skips) && skips.every(p => PROVIDERS.has(p)), 'INVALID_ORIGINAL_SKIPPED_SOURCES');
  const changes = (comparison.changes ?? []).map(change => ({
    type:change.type, provider:change.provider, url:change.url,
    method:change.method ?? '', toolName:change.toolName ?? '',
    fields:change.fields ?? [], addedOptions:change.addedOptions ?? [], removedOptions:change.removedOptions ?? [],
  }));
  assert(changes.every(item => ['ADDED','REMOVED','CHANGED'].includes(item.type) && PROVIDERS.has(item.provider)),
    'INVALID_ORIGINAL_CHANGE_RECORD');
  assert(['added','removed','changed'].every(k => Number.isSafeInteger(counts[k]) && counts[k] >= 0 && counts[k] <= changes.length),
    'INVALID_ORIGINAL_CHANGE_COUNTS');
  return {status:'COMPARED', comparedSources:comparison.comparedSources, skippedSources:skips,
    ambiguousIdentities:comparison.ambiguousIdentities ?? 0, unkeyedListings:comparison.unkeyedListings ?? 0,
    truncatedOptionComparisons:comparison.truncatedOptionComparisons ?? 0,
    changes, counts:{added:counts.added,removed:counts.removed,changed:counts.changed}};
}

export function classifyAlert(delta, state) {
  // The first observation cannot establish that listings stayed unchanged.
  if (delta.status === 'BASELINE_CAPTURE') {
    return state === 'BOTH_SOURCES_COMPLETE' ? 'FIRST_OBSERVATION' : 'FIRST_OBSERVATION_PARTIAL';
  }
  if (delta.status === 'NOT_COMPARABLE') return 'COMPARISON_UNAVAILABLE';
  if (delta.counts.added + delta.counts.removed + delta.counts.changed > 0) return 'OBSERVED_ADVERTISEMENT_CHANGED';
  return state !== 'BOTH_SOURCES_COMPLETE' ? 'SOURCE_COVERAGE_INCOMPLETE' : 'NO_OBSERVED_CHANGE';
}

function makeRecord(snapshot, sequence, previousRecordHash, basisSequence, payloadHash, delta) {
  const current = {
    schema:WATCH_SCHEMA, sequence, captureFile:captureName(sequence), captureSha256:payloadHash,
    observedAt:snapshot.observedAt, network:snapshot.network, state:snapshot.state,
    rows:snapshot.observedListingRows, baselineSequence:basisSequence,
    providers:snapshot.sources.map(s=>({id:s.provider,status:s.status,observedAt:s.observedAt ?? null,
      endpoint:s.endpoint,rows:s.rows,coverage:s.coverage ?? null})),
    delta, priorRecordSha256:previousRecordHash,
    interpretation:'Native provider advertisement changes only. Not a seller-owned price, approved purchase, delivery, ledger or revenue receipt.',
  };
  return { ...current, recordSha256:SHA(canonical(current)) };
}

export async function loadWatch(directory, network) {
  assert(NETWORKS.has(network), 'UNSUPPORTED_STELLAR_NETWORK');
  const root=resolve(directory);
  const captures=join(root,'captures');
  await mkdir(captures,{recursive:true,mode:0o700});
  let raw='';
  try {raw=await readFile(join(root,'history.jsonl'),'utf8');}
  catch(error) {if(error.code!=='ENOENT') throw error;}
  assert(!raw || raw.endsWith('\n'), 'INCOMPLETE_HISTORY_TAIL');
  const lines=raw.trim() ? raw.trimEnd().split('\n'):[];
  assert(lines.length <= MAX_SAMPLES, 'WATCH_HISTORY_TOO_LONG');
  let latest=null, lastComplete=null, lastRecordHash=HASH_0;
  for (let i=0;i<lines.length;i++) {
    let record;
    try {record=JSON.parse(lines[i]);} catch {throw new Error('INVALID_HISTORY_JSON_AT_'+(i+1));}
    assert(object(record) && record.schema===WATCH_SCHEMA && record.sequence===i+1, 'NONCONTIGUOUS_HISTORY_AT_'+(i+1));
    assert(record.captureFile===captureName(i+1) && sha64(record.captureSha256) && record.priorRecordSha256===lastRecordHash,
      'HISTORY_CHAIN_MISMATCH_AT_'+(i+1));
    const {recordSha256,...body}=record;
    assert(sha64(recordSha256) && SHA(canonical(body))===recordSha256, 'HISTORY_ENTRY_SHA_MISMATCH_AT_'+(i+1));
    const bytes=await readFile(join(captures,record.captureFile));
    assert(bytes.length<=MAX_CAPTURE_BYTES && SHA(bytes)===record.captureSha256, 'CAPTURE_BYTES_SHA_MISMATCH_AT_'+(i+1));
    let snapshot;
    try {snapshot=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('INVALID_CAPTURE_JSON_AT_'+(i+1));}
    checkNativeSnapshot(snapshot,network);
    assert(snapshot.observedAt===record.observedAt && snapshot.state===record.state && snapshot.observedListingRows===record.rows,
      'CAPTURE_METADATA_MISMATCH_AT_'+(i+1));
    lastRecordHash=recordSha256;
    latest={sequence:i+1,snapshot};
    if(snapshot.state==='BOTH_SOURCES_COMPLETE') lastComplete=latest;
  }
  const files=await readdir(captures);
  const expected=new Set(lines.map((_,i)=>captureName(i+1)));
  assert(files.every(name=>expected.has(name)),'ORPHAN_OR_UNEXPECTED_CAPTURE_FILE');
  return {root,captures,network,sequence:lines.length,latest,lastComplete,lastRecordHash};
}

async function atomicCapture(path, data) {
  const file=await open(path,'wx',0o600);
  try {await file.writeFile(data,'utf8');await file.sync();}
  finally {await file.close();}
}

export async function appendNativeObservation(watch, snapshot, originalCompare) {
  assert(typeof originalCompare==='function', 'MISSING_ORIGINAL_SF71_COMPARATOR');
  assert(watch.sequence<MAX_SAMPLES, 'WATCH_MAX_SAMPLES_REACHED');
  const payload=checkNativeSnapshot(snapshot,watch.network);
  const base=watch.lastComplete ?? watch.latest;
  const comparison=base ? originalCompare(base.snapshot,snapshot):null;
  const delta=formatDelta(comparison);
  const next=watch.sequence+1;
  const record=makeRecord(snapshot,next,watch.lastRecordHash,base?.sequence??null,SHA(payload),delta);
  // A pre-existing file is never overwritten. A crash between these two durable
  // writes leaves an explicit orphan that must be examined, not silently ignored.
  await atomicCapture(join(watch.captures,record.captureFile),payload);
  const stream=await open(join(watch.root,'history.jsonl'),'a',0o600);
  try {await stream.writeFile(canonical(record)+'\n','utf8');await stream.sync();}
  finally {await stream.close();}
  watch.sequence=next;
  watch.lastRecordHash=record.recordSha256;
  watch.latest={sequence:next,snapshot};
  if(snapshot.state==='BOTH_SOURCES_COMPLETE') watch.lastComplete=watch.latest;
  return record;
}

export function parseArgs(argv) {
  const o={network:'stellar:testnet',samples:1,intervalSeconds:60,origin:null,verify:false,dir:null};
  const seen=new Set();
  for(const arg of argv){
    if(arg==='--verify'){assert(!seen.has('verify'),'DUPLICATE_OPTION');o.verify=true;seen.add('verify');continue;}
    const m=/^--(dir|network|samples|interval-seconds|origin)=(.+)$/.exec(arg);
    assert(m,'USAGE: --dir=DIR [--network=stellar:testnet|stellar:pubnet] [--samples=N (0=continuous)] [--interval-seconds=10..86400] [--origin=http://127.0.0.1:PORT] [--verify]');
    assert(!seen.has(m[1]),'DUPLICATE_OPTION');seen.add(m[1]);
    if(m[1]==='dir')o.dir=m[2];
    else if(m[1]==='network')o.network=m[2];
    else if(m[1]==='samples'){assert(/^(0|[1-9][0-9]{0,5})$/.test(m[2]),'INVALID_SAMPLES');o.samples=Number(m[2]);}
    else if(m[1]==='interval-seconds'){assert(/^\d{1,5}$/.test(m[2]),'INVALID_INTERVAL');o.intervalSeconds=Number(m[2]);}
    else o.origin=m[2];
  }
  assert(o.dir && NETWORKS.has(o.network),'DIR_OR_NETWORK_INVALID');
  assert(o.samples>=0 && o.samples<=MAX_SAMPLES,'INVALID_SAMPLES');
  assert(o.intervalSeconds>=10 && o.intervalSeconds<=86400,'INVALID_INTERVAL');
  if(o.origin){
    const u=new URL(o.origin);
    assert(u.protocol==='http:' && u.hostname==='127.0.0.1' && /^\d+$/.test(u.port) && u.port!=='0'
      && u.username==='' && u.password==='' && u.pathname==='/' && !u.search && !u.hash,
      'ORIGIN_MUST_BE_LITERAL_IPV4_LOOPBACK_WITH_PORT');
    o.origin=`http://127.0.0.1:${u.port}`;
  }
  return o;
}

async function captureLocalSf70(origin) {
  const response=await fetch(origin+'/api/federated?refresh=1',{
    method:'GET',redirect:'error',signal:AbortSignal.timeout(45_000),headers:{accept:'application/json'},
    cache:'no-store',credentials:'omit',
  });
  assert(response.status===200 || response.status===502,'ORIGINAL_SF70_HTTP_'+response.status);
  assert(response.body,'EMPTY_ORIGINAL_SF70_RESPONSE');
  const contentLength=Number(response.headers.get('content-length'));
  assert(!Number.isFinite(contentLength)||contentLength<=MAX_CAPTURE_BYTES,'ORIGINAL_SF70_RESPONSE_TOO_LARGE');
  const reader=response.body.getReader();
  const chunks=[];let size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    assert(size<=MAX_CAPTURE_BYTES,'ORIGINAL_SF70_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(value));}}
  finally{reader.releaseLock();}
  let obj;
  try{obj=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('ORIGINAL_SF70_RESPONSE_NOT_JSON');}
  return obj;
}

async function acquireExclusive(root){
  const path=join(root,'.writer.lock');
  let file;
  try{file=await open(path,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error('WATCH_ALREADY_LOCKED_CHECK_EXISTING_OWNER');throw e;}
  await file.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()})+'\n');
  await file.sync();
  await file.close();
  return async()=>unlink(path);
}

export async function main(args=process.argv.slice(2)) {
  const o=parseArgs(args);
  await mkdir(resolve(o.dir),{recursive:true,mode:0o700});
  if(o.verify){const watch=await loadWatch(o.dir,o.network);
    process.stdout.write(canonical({schema:WATCH_SCHEMA,verified:true,snapshots:watch.sequence,lastDigest:watch.lastRecordHash,network:o.network})+'\n');return;}
  const release=await acquireExclusive(resolve(o.dir));
  const controller=new AbortController();
  let stopped=false;
  const stop=()=>{stopped=true;controller.abort();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const watch=await loadWatch(o.dir,o.network);
    const {compareSnapshots}=await import('../sf70-federated-bazaar-operator/offer-delta.mjs');
    const read=o.origin?()=>captureLocalSf70(o.origin):async()=>{
      const {readFederation}=await import('../sf70-federated-bazaar-operator/server.mjs');
      return readFederation(o.network);
    };
    let done=0;
    while(!stopped && (o.samples===0 || done<o.samples)){
      const captured=await read();
      const entry=await appendNativeObservation(watch,captured,compareSnapshots);
      done++;
      const d=entry.delta;
      process.stdout.write(canonical({schema:WATCH_SCHEMA,sequence:entry.sequence,observedAt:entry.observedAt,
        state:entry.state,rows:entry.rows,providers:entry.providers.map(s=>({id:s.id,status:s.status,rows:s.rows})),
        baselineSequence:entry.baselineSequence,comparedSources:d.comparedSources,skippedSources:d.skippedSources,
        changed:d.counts,alert:classifyAlert(d,entry.state),
        snapshotSha256:entry.captureSha256,recordSha256:entry.recordSha256})+'\n');
      if(stopped || (o.samples!==0 && done>=o.samples))break;
      try{await delay(o.intervalSeconds*1000,undefined,{signal:controller.signal});}
      catch(e){if(e.name!=='AbortError')throw e;}
    }
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await release();}
}

if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  main().catch(e=>{process.stderr.write('SF79 '+String(e?.message??e)+'\n');process.exitCode=1;});
}
