#!/usr/bin/env node
// MIT. SF-41 source-exact research runner. No paid x402 calls, no fabricated resource records.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { BazaarCatalog, createDiscoveryServer, validateCatalogEntry } from '../../../scf46-stellar-bazaar/src/catalog.mjs';

const EXPECTED_BLOB = '66beed7c3a4b617ab90680ec5fe8318e934e74f7';
const catalogPath = fileURLToPath(new URL('../../../scf46-stellar-bazaar/src/catalog.mjs', import.meta.url));
const args = process.argv.slice(2);
const option = (name) => { const p = args.indexOf(name); return p >= 0 ? args[p + 1] : null; };
const required = (name) => { const val = option(name); if (!val) throw Error('Missing ' + name); return val; };
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const percentile = (xs, p) => xs.length ? [...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.ceil(xs.length*p)-1)] : null;
const stringify = (v) => JSON.stringify(v, null, 2) + '\n';
const sorted = (v) => [...v].sort((a,b)=>a.localeCompare(b));
const errorText = (e) => String(e && e.message || e);
const pathOf = (base, file) => resolve(dirname(base), file);

function shape(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('Non-object provider item');
  let resource = row.resource;
  if (typeof resource === 'string') resource = {url:resource};
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
    if (typeof row.url === 'string') resource = {url:row.url};
    else throw Error('Missing resource.url');
  }
  resource = structuredClone(resource);
  // These are strictly documented provider metadata locations, not invented service facts.
  for (const k of ['description','serviceName','tags','iconUrl']) {
    if (resource[k] === undefined && row[k] !== undefined) resource[k] = row[k];
  }
  // Do not synthesize payment terms, bazaar schemas or MCP tool names.
  if (!row.extensions?.bazaar?.info || !row.extensions?.bazaar?.schema) {
    throw Error('Missing original Bazaar extension info/schema');
  }
  return {resource,accepts:row.accepts,extensions:row.extensions};
}
function rowsFrom(payload) {
  const rows = Array.isArray(payload) ? payload : (payload?.items ?? payload?.resources ?? payload?.data?.items ?? payload?.data?.resources);
  if (!Array.isArray(rows)) throw Error('Expected original provider items/resources array, not a fixture');
  return rows;
}
function paramsFor(test) {
  if (!test || typeof test.query !== 'string' || !test.query.trim()) throw Error('Missing query');
  const p = new URLSearchParams({query:test.query,limit:String(test.limit || 20)});
  for (const k of ['type','network','payTo','scheme','extensions']) {
    if (test.filters && test.filters[k] !== undefined) p.set(k,String(test.filters[k]));
  }
  return p;
}
function keysOf(rows) { return rows.map((row) => validateCatalogEntry(row).id); }
function precision(ids,relevant) {
  if (!relevant) return null;
  const good = new Set(relevant);
  return ids.length ? ids.filter(id=>good.has(id)).length/ids.length : 0;
}
function topDiagnostic(rawLimit, entries) {
  const errors = Object.entries(entries).sort((a,b)=>b[1]-a[1]).slice(0,rawLimit);
  return Object.fromEntries(errors);
}
async function execute() {
  if (args.includes('--help')) {
    process.stdout.write('node run.mjs --manifest sources.json --queries queries.json --out ./run [--repeat 5] [--candidate ./candidate.mjs]\n');
    return;
  }
  const manifestPath=resolve(required('--manifest')),queryPath=resolve(required('--queries'));
  const outputDir=resolve(required('--out'));
  const repeat = Number(option('--repeat') || '1');
  if (!Number.isSafeInteger(repeat) || repeat <= 0) throw Error('--repeat must be positive safe integer');
  const sourceText=await readFile(catalogPath);
  const blob=createHash('sha1').update(Buffer.concat([Buffer.from('blob '+sourceText.length+'\0'),sourceText])).digest('hex');
  if (blob !== EXPECTED_BLOB) throw Error('Unmodified original source changed: expected git blob '+EXPECTED_BLOB+' got '+blob);
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  const queryDoc=JSON.parse(await readFile(queryPath,'utf8'));
  if (!Array.isArray(manifest.sources)||!manifest.sources.length) throw Error('sources must be nonempty actual-provider captures');
  if (!Array.isArray(queryDoc.cases)||!queryDoc.cases.length) throw Error('queries.cases must be nonempty');
  const catalog=new BazaarCatalog();
  const seen=new Map(),anomalies=[],corpus=[];
  const counts={raw:0,valid:0,inserted:0,identicalDuplicates:0,conflictingDuplicates:0,rejected:0};
  const errorHistogram={};
  for (const src of manifest.sources) {
    if (!src || !src.id || !src.file || !src.sha256 || !src.url || !src.captured_at ||
        src.method !== 'GET' || src.status !== 200 ||
        !['public-read','authorized-operator'].includes(src.permission)) {
      throw Error('Missing actual capture provenance/id/hash/GET status/permission');
    }
    const raw=await readFile(pathOf(manifestPath,src.file));
    const hash=sha256(raw);
    if (hash.toLowerCase() !== src.sha256.toLowerCase()) throw Error('Capture checksum mismatch for '+src.id);
    const payload=JSON.parse(raw.toString('utf8')), rows=rowsFrom(payload);
    const record={id:src.id,source_url:src.url,captured_at:src.captured_at,status:200,
      permission:src.permission,sha256:hash,rows:rows.length,inserted:0,rejected:0,duplicate:0};
    for (let i=0;i<rows.length;i++) {
      counts.raw++;
      try {
        const candidate=shape(rows[i]);
        const normalized=validateCatalogEntry(candidate);
        counts.valid++;
        const key=normalized.id, signature=sha256(Buffer.from(JSON.stringify(normalized.entry)));
        if(seen.has(key)){
          record.duplicate++;
          if(seen.get(key).signature===signature) counts.identicalDuplicates++;
          else {
            counts.conflictingDuplicates++;
            anomalies.push({type:'different-terms-same-canonical-key',source:src.id,row:i,key,
              previous_source:seen.get(key).source,prior_hash:seen.get(key).signature,new_hash:signature});
          }
          continue;
        }
        // Validated original source entry, unchanged native Bazaar semantics.
        catalog.insertValidated(candidate);
        seen.set(key,{source:src.id,signature});
        counts.inserted++;record.inserted++;
      }catch(e) {
        counts.rejected++;record.rejected++;
        const message=errorText(e);
        errorHistogram[message]=(errorHistogram[message]||0)+1;
        anomalies.push({type:'provider-entry-rejected',source:src.id,row:i,reason:message});
      }
    }
    corpus.push(record);
  }
  if (!catalog.size) throw Error('No source-native Bazaar rows accepted. See capture schema/metadata, not fake records.');
  const testCases=queryDoc.cases;
  const tests=testCases.map(t=>({
    id:String(t.id||t.query),query:t.query,params:paramsFor(t),
    judgments:Array.isArray(t.relevant)&&t.label_source? t.relevant : null,
    label_source:t.label_source||null
  }));
  let candidate=null;
  if(option('--candidate')) {
    const candidateModule=await import(pathToFileURL(resolve(option('--candidate'))).href);
    if(typeof candidateModule.search !== 'function') throw Error('Candidate module must export search(catalog, URLSearchParams)');
    candidate=candidateModule.search;
  }
  const runs=[],latencyBaseline=[],latencyCandidate=[];
  for(let pass=0;pass<repeat;pass++) for(const t of tests){
    const q1=performance.now(),baseline=catalog.search(t.params),duration=performance.now()-q1;
    latencyBaseline.push(duration);
    const primary=keysOf(baseline.resources);
    let challenger=null,challengerTime=null,challengerIds=null,challengerError=null;
    if(candidate){
      try {
        const q2=performance.now();
        challenger=await candidate(catalog,new URLSearchParams(t.params));
        challengerTime=performance.now()-q2;
        challengerIds=keysOf(challenger.resources);
        latencyCandidate.push(challengerTime);
      }catch(e){challengerError=errorText(e);}
    }
    runs.push({pass:pass+1,id:t.id,query:t.query,filters:Object.fromEntries(t.params),
      source_rows:counts.inserted,baseline:{duration_ms:duration,first_page_keys:primary,
        first_page_total:primary.length,has_next:!!baseline.pagination?.cursor,
        labeled_precision:precision(primary,t.judgments)},
      candidate:candidate?{duration_ms:challengerTime,first_page_keys:challengerIds,error:challengerError,
        labeled_precision:precision(challengerIds||[],t.judgments)}:null,
      label_source:t.judgments?t.label_source:null});
  }
  // Query the actual source handler via ephemeral loopback HTTP, not a substitute server.
  const server=createServer(createDiscoveryServer(catalog));
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  const origin='http://127.0.0.1:'+server.address().port;
  const network=[],networkLatencies=[];
  async function fetchExact(url) {
    const started=performance.now(),res=await fetch(url,{method:'GET',signal:AbortSignal.timeout(30000)});
    const elapsed=performance.now()-started; networkLatencies.push(elapsed);
    const body=await res.json();if(!res.ok)throw Error('Original GET failed '+res.status+': '+JSON.stringify(body));
    return body;
  }
  try {
    const size=catalog.size,listKeys=new Set();let offset=0;
    do {
      const page=await fetchExact(origin+'/discovery/resources?limit=100&offset='+offset);
      if(!Array.isArray(page.resources))throw Error('Native /discovery/resources failed schema');
      for(const key of keysOf(page.resources))listKeys.add(key);
      if(!page.resources.length || offset>=size)break;
      offset+=page.resources.length;
    }while(offset<size);
    if(listKeys.size!==size)throw Error('Native list coverage mismatch '+listKeys.size+'/'+size);
    for(const t of tests) {
      const ids=[],cursors=new Set();let cursor=null,pages=0;
      do{
        const p=new URLSearchParams(t.params);
        if(cursor)p.set('cursor',cursor);
        const body=await fetchExact(origin+'/discovery/search?'+p.toString());
        const slice=keysOf(body.resources);
        ids.push(...slice);
        pages++;
        cursor=body.pagination?.cursor || null;
        if(cursor && cursors.has(cursor))throw Error('Original cursor cycle for '+t.id);
        if(cursor)cursors.add(cursor);
      }while(cursor);
      const direct=catalog.search(new URLSearchParams(t.params));
      if(JSON.stringify(ids.slice(0,direct.resources.length))!==JSON.stringify(keysOf(direct.resources))) {
        throw Error('Native GET/direct parity mismatch '+t.id);
      }
      network.push({id:t.id,query:t.query,pages,full_result_count:ids.length,all_keys:ids});
    }
  }finally{await new Promise(ok=>server.close(ok));}
  await mkdir(outputDir,{recursive:true});
  const report={
    schema:'SCF-SF41/source-exact-research-v1',kind:'original-native-source-with-actual-provider-captures',
    generated_at:new Date().toISOString(),
    baseline:{repo:'woahwhattheheck/public-commons-sprint-2026',path:'scf46-stellar-bazaar/src/catalog.mjs',
      github_blob_sha1:blob,byte_sha256:sha256(sourceText)},
    inputs:{manifest_sha256:sha256(await readFile(manifestPath)),
      queries_sha256:sha256(await readFile(queryPath)),
      sources:corpus,query_count:tests.length,repeat},
    corpus_stats:{...counts,distinct:catalog.size,top_rejection_reasons:topDiagnostic(20,errorHistogram),
      anomalies_count:anomalies.length},
    timings:{baseline_ms:{p50:percentile(latencyBaseline,.5),p95:percentile(latencyBaseline,.95),n:latencyBaseline.length},
      candidate_ms:candidate?{p50:percentile(latencyCandidate,.5),p95:percentile(latencyCandidate,.95),n:latencyCandidate.length}:null,
      native_loopback_get_ms:{p50:percentile(networkLatencies,.5),p95:percentile(networkLatencies,.95),n:networkLatencies.length}},
    run_count:runs.length,provider_label_status:'Collector-supplied actual captures; no independent paid settlement asserted',
    comparisons:!!candidate,
    note:'No on-chain payment, paid origin request, settlement, or provider health probe performed by this code.'
  };
  await Promise.all([
    writeFile(resolve(outputDir,'run.json'),stringify(report)),
    writeFile(resolve(outputDir,'cases.json'),stringify(runs)),
    writeFile(resolve(outputDir,'original-http-pages.json'),stringify(network)),
    writeFile(resolve(outputDir,'ingest-anomalies.json'),stringify(anomalies))
  ]);
  process.stdout.write(JSON.stringify({out:outputDir,corpus_stats:report.corpus_stats,
    timings:report.timings,query_count:tests.length,case_runs:runs.length},null,2)+'\n');
}
execute().catch(e=>{process.stderr.write('SF41 research failed: '+errorText(e)+'\n');process.exitCode=1;});
