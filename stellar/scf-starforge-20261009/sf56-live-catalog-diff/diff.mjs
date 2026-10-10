#!/usr/bin/env node
// MIT. Read-only SF56: cross-snapshot DELTA of authenticated original SF41 GET captures.
// No network calls, wallets, settlement, payment or origin probing.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectCaptureCoverage } from '../sf41-real-source-replay/capture_coverage.mjs';
import { stableResourceIdentity } from '../sf45-discovery-recovery/recovery.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bad = (code, detail='') => { throw new Error(code + (detail ? ': '+detail : '')); };
const sortedJson = value => JSON.stringify(sortObject(value));
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined)
    .map(k => [k,sortObject(value[k])]));
}
const fingerprint = value => hash(Buffer.from(sortedJson(value)));
const requireInstant = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value)))
    bad('INVALID_CAPTURE_TIMESTAMP');
  return new Date(value).toISOString();
};
const paymentScope = url => {
  const u = new URL(url);
  // Offset and page size are transport only. Other GET filters define the corpus.
  u.searchParams.delete('offset'); u.searchParams.delete('limit');
  return u.origin + u.pathname + '?' + [...u.searchParams.entries()]
    .sort(([a,b],[c,d])=>a.localeCompare(c)||b.localeCompare(d))
    .map(([key,value])=>encodeURIComponent(key)+'='+encodeURIComponent(value)).join('&');
};
const rowsFrom = payload => Array.isArray(payload) ? payload :
  payload?.items ?? payload?.resources ?? payload?.data?.items ?? payload?.data?.resources;

// Match SF41's original provider adapter: move ONLY documented metadata fields.
// Do not invent offers, Bazaar schemas, MCP tool names or successful settlements.
function nativeEntry(row) {
  if (!object(row)) bad('INVALID_PROVIDER_ROW');
  let resource = typeof row.resource === 'string' ? {url:row.resource} : row.resource;
  if (!object(resource) && typeof row.url === 'string') resource = {url:row.url};
  if (!object(resource) || typeof resource.url !== 'string') bad('MISSING_RESOURCE_URL');
  resource = structuredClone(resource);
  for (const key of ['description','serviceName','tags','iconUrl'])
    if (resource[key] === undefined && row[key] !== undefined) resource[key] = row[key];
  if (!Array.isArray(row.accepts) || row.accepts.length === 0 ||
      !object(row.extensions?.bazaar?.info?.input) || !object(row.extensions?.bazaar?.schema))
    bad('MISSING_NATIVE_BAZAAR_ENVELOPE');
  return {...row,resource};
}
function identity(row) {
  const u = new URL(row.resource.url);
  if (!['https:','http:'].includes(u.protocol) || u.username || u.password || u.hash)
    bad('INVALID_RESOURCE_URL',row.resource.url);
  return stableResourceIdentity(row);
}
function buckets(row) {
  const bazaar=row.extensions.bazaar;
  const accepts=row.accepts.map(sortedJson).sort();
  const contract={input:bazaar.info.input,schema:bazaar.schema,routeTemplate:bazaar.routeTemplate??null};
  const remaining={...row}; delete remaining.resource; delete remaining.accepts; delete remaining.extensions;
  const ext={...row.extensions}; delete ext.bazaar;
  const b={...bazaar}; delete b.info; delete b.schema; delete b.routeTemplate;
  const info={...bazaar.info}; delete info.input;
  return {
    payment:fingerprint(accepts),
    contract:fingerprint(contract),
    metadata:fingerprint({resource:row.resource,other:remaining,extensions:ext,bazaar:b,info}),
    networks:[...new Set(row.accepts.map(a=>a?.network).filter(x=>typeof x==='string'))].sort(),
    offer_count:row.accepts.length,
  };
}

/** Full original native capture evidence is verified BEFORE any delta is emitted. */
export function snapshotFromNative({manifest, pages, manifestSha256}) {
  if (!object(manifest) || !Array.isArray(manifest.sources) || !manifest.sources.length ||
      manifest.schema !== 'SCF-SF41/capture-v1') bad('SF41_MANIFEST_REQUIRED');
  if (!Array.isArray(pages) || pages.length !== manifest.sources.length) bad('MISSING_ORIGINAL_PAGES');
  const entries = new Map(), nativePages=[], scopes=new Set();
  for (let i=0;i<pages.length;i++) {
    const source=manifest.sources[i],raw=Buffer.from(pages[i]);
    if (!object(source) || source.method!=='GET' || source.status!==200 ||
        !['public-read','authorized-operator'].includes(source.permission) ||
        !/^[a-f\d]{64}$/i.test(source.sha256) ||
        !source.file || !source.id || !source.url || !source.captured_at)
      bad('INCOMPLETE_ORIGINAL_SOURCE',String(i));
    requireInstant(source.captured_at);
    if (hash(raw).toLowerCase()!==source.sha256.toLowerCase()) bad('ORIGINAL_PAGE_HASH_MISMATCH',source.id);
    let body;
    try {body=JSON.parse(raw.toString('utf8'));} catch {bad('ORIGINAL_PAGE_INVALID_JSON',source.id);}
    const rows=rowsFrom(body);
    if (!Array.isArray(rows)) bad('ORIGINAL_PAGE_NO_RESOURCE_ROWS',source.id);
    nativePages.push({source,rows:rows.length,sha256:hash(raw),
      pagination:body?.pagination??null,version:body?.x402Version??null});
    scopes.add(paymentScope(source.url));
    for(let k=0;k<rows.length;k++) {
      let row,key;
      try {row=nativeEntry(rows[k]);key=identity(row);}
      catch(e) {bad('ORIGINAL_ROW_INVALID',source.id+'/'+k+' '+String(e.message||e));}
      if (entries.has(key)) bad('NONUNIQUE_CANONICAL_ROUTE',key);
      entries.set(key,buckets(row));
    }
  }
  if (scopes.size!==1) bad('MIXED_PROVIDER_FILTER_SCOPE');
  const coverage=inspectCaptureCoverage(manifest,nativePages);
  if (!coverage.verified) bad('NOT_SINGLE_COMPLETE_PROVIDER',coverage.status);
  const timestamp=requireInstant(manifest.generated_at);
  return {schema:'SCF-SF56/snapshot-v1',timestamp,scope:[...scopes][0],
    manifest_sha256:manifestSha256??fingerprint(manifest),
    count:entries.size,capture_rows:coverage.rows,coverage:coverage.status,
    entries};
}

/** Deterministic, one-to-one change review for SAME native provider/filter scope. */
export function compareSnapshots(before,after) {
  if (before?.scope !== after?.scope || !before?.scope) bad('INCOMPARABLE_PROVIDER_OR_FILTER');
  if (Date.parse(before.timestamp)>Date.parse(after.timestamp)) bad('CAPTURES_NOT_CHRONOLOGICAL');
  const changes=[],types={ADDED:0,REMOVED:0,PAYMENT_TERMS:0,INPUT_CONTRACT:0,METADATA:0};
  const ids=[...new Set([...before.entries.keys(),...after.entries.keys()])].sort();
  for (const id of ids) {
    const left=before.entries.get(id),right=after.entries.get(id);
    const observed=[];
    if (!left) observed.push('ADDED');
    else if (!right) observed.push('REMOVED');
    else {
      if (left.payment!==right.payment) observed.push('PAYMENT_TERMS');
      if (left.contract!==right.contract) observed.push('INPUT_CONTRACT');
      if (left.metadata!==right.metadata) observed.push('METADATA');
    }
    if (!observed.length) continue;
    for (const kind of observed) types[kind]++;
    changes.push({identity:id,change:observed,
      priority:observed.some(k=>['REMOVED','PAYMENT_TERMS','INPUT_CONTRACT'].includes(k))?'REVIEW':'INFO',
      before:left??null,after:right??null});
  }
  return {schema:'SCF-SF56/catalog-delta-v1',kind:'read-only-native-provider-observation',
    original_source:{before:{captured_at:before.timestamp,manifest_sha256:before.manifest_sha256,
      pages_complete:before.coverage,observed_routes:before.count,rows:before.capture_rows},
      after:{captured_at:after.timestamp,manifest_sha256:after.manifest_sha256,
        pages_complete:after.coverage,observed_routes:after.count,rows:after.capture_rows},
      provider_scope:before.scope},
    summary:{changed_routes:changes.length,review_routes:changes.filter(x=>x.priority==='REVIEW').length,
      ...types,unchanged_routes:ids.length-changes.length},
    changes,
    next_action:'Review changed observed payment/contract terms and seller identity before a separate authorized purchase. This is not payment authorization or evidence of paid settlement.'};
}

// Non-network CLI consumes preserved SF41 page bytes and SHA256 manifest sources.
async function loadSnapshot(manifestFile) {
  const file=resolve(manifestFile),raw=await readFile(file);
  const manifest=JSON.parse(raw.toString('utf8'));
  if (!Array.isArray(manifest.sources)) bad('MISSING_SOURCES');
  const pages=[];
  for(const source of manifest.sources) {
    if (typeof source?.file!=='string' || !/^[A-Za-z0-9_.-]+\.json$/.test(source.file) ||
        basename(source.file)!==source.file) bad('UNSAFE_SOURCE_FILENAME');
    pages.push(await readFile(join(dirname(file),source.file)));
  }
  return snapshotFromNative({manifest,pages,manifestSha256:hash(raw)});
}
export async function runCli(args=process.argv.slice(2)) {
  if(args.includes('--help')) {
    process.stdout.write('node diff.mjs --before /capture-old/sources.json --after /capture-new/sources.json --out /reports/native-delta.json\n');
    return;
  }
  const option=n=>{const i=args.indexOf(n);return i<0?null:args[i+1]};
  const before=option('--before'),after=option('--after'),output=option('--out');
  if(!before||!after||!output)bad('REQUIRE_BEFORE_AFTER_OUT');
  const report=compareSnapshots(await loadSnapshot(before),await loadSnapshot(after));
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({out:resolve(output),summary:report.summary,scope:report.original_source.provider_scope})+'\n');
}
if (process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  runCli().catch(e=>{process.stderr.write('SF56: '+String(e.message||e)+'\n');process.exitCode=1;});
