// SPDX-License-Identifier: MIT
// Compare original ranking modules over the replay's validated provider records.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { cpus, loadavg } from 'node:os';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const percentile = (values, p) => values.length
  ? [...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)] : null;
function need(condition, message) { if (!condition) throw new Error(message); }
function materialize(result) {
  need(Array.isArray(result), 'Original ranking module must return its complete ranked array');
  return result.map(value => {
    need(typeof value.key === 'string' && Number.isFinite(value.score), 'Invalid original ranking result');
    return {key:value.key,score:value.score};
  });
}
function same(a, b) {
  return a.length === b.length && a.every((value,index) =>
    value.key === b[index].key && Object.is(value.score,b[index].score));
}
function diff(before, after) {
  const old = new Map(before.map((value,index)=>[value.key,{...value,rank:index+1}]));
  const current = new Map(after.map((value,index)=>[value.key,{...value,rank:index+1}]));
  return {
    added:after.filter(value=>!old.has(value.key)).map(value=>current.get(value.key)),
    removed:before.filter(value=>!current.has(value.key)).map(value=>old.get(value.key)),
    changed:after.flatMap(value=>{
      const prior=old.get(value.key), next=current.get(value.key);
      return prior && (prior.rank !== next.rank || !Object.is(prior.score,next.score))
        ? [{key:value.key,before:{rank:prior.rank,score:prior.score},after:{rank:next.rank,score:next.score}}] : [];
    }),
  };
}
async function loadRanking(path) {
  const absolute=resolve(path),raw=await readFile(absolute);
  const source={path:absolute,bytes:raw.length,sha256:sha(raw),
    gitBlob:createHash('sha1').update(Buffer.from('blob '+raw.length+'\0')).update(raw).digest('hex')};
  const module=await import(pathToFileURL(absolute).href);
  need(typeof module.rankBazaarEntries === 'function' && typeof module.BazaarRankingIndex === 'function',
    'Each selected source must export the original one-shot ranker and BazaarRankingIndex');
  return {source,module};
}
function nativeRows(catalog, filters) {
  const entries=[];
  let offset=0,total;
  for (;;) {
    const params=new URLSearchParams(filters);
    params.set('limit','100');params.set('offset',String(offset));
    const page=catalog.list(params);
    need(Array.isArray(page.resources) && Number.isSafeInteger(page.pagination?.total),
      'Original native catalog list metadata required');
    total ??= page.pagination.total;
    need(page.pagination.total === total && page.pagination.offset === offset,
      'Original native corpus changed during selection');
    entries.push(...page.resources);
    offset += page.resources.length;
    need(offset <= total && (page.resources.length > 0 || offset === total),
      'Original native list did not advance completely');
    if(offset === total) return entries;
  }
}
function timeBatch(index, cases) {
  const start=performance.now(),cpu=process.cpuUsage();
  let results=0;
  for(const test of cases) results+=index.rank(test.keys,test.query).length;
  const used=process.cpuUsage(cpu);
  return {elapsedMs:performance.now()-start,cpuUserMs:used.user/1000,cpuSystemMs:used.system/1000,results};
}
function summarize(samples) {
  return {batches:samples.length,
    elapsedMs:{p50:percentile(samples.map(value=>value.elapsedMs),.5),
      p95:percentile(samples.map(value=>value.elapsedMs),.95)},
    cpuMs:{user:samples.reduce((sum,value)=>sum+value.cpuUserMs,0),
      system:samples.reduce((sum,value)=>sum+value.cpuSystemMs,0)},
    samples};
}


function pointer(root, reference) {
  if(typeof reference !== 'string' || !reference.startsWith('#')) return null;
  let parts;
  try {
    const value=decodeURIComponent(reference.slice(1));
    if(value === '') return root;
    if(!value.startsWith('/')) return null;
    parts=value.slice(1).split('/');
  } catch { return null; }
  if(parts.length > 32) return null;
  let value=root;
  for(const part of parts) {
    if(/~(?![01])/.test(part)) return null;
    const key=part.replace(/~1/g,'/').replace(/~0/g,'~');
    if(value === null || typeof value !== 'object' || !Object.hasOwn(value,key)) return null;
    value=value[key];
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
const object=value=>value !== null && typeof value === 'object' && !Array.isArray(value);
const escapePointer=value=>value.replace(/~/g,'~0').replace(/\//g,'~1');
function alternatives(schema, root) {
  const result=[];
  const target=pointer(root,schema.$ref);
  if(target) result.push({schema:target,path:decodeURIComponent(schema.$ref.slice(1)),reference:true});
  for(const name of ['allOf','anyOf','oneOf'])
    if(Array.isArray(schema[name]))schema[name].slice(0,32).forEach((value,index)=>{
      if(object(value))result.push({schema:value,path:'/'+name+'/'+index});
    });
  return result;
}
function sourceRoots(row) {
  const input=row.extensions?.bazaar?.info?.input;
  if(input?.type === 'mcp')
    return object(input.inputSchema) ? [{schema:input.inputSchema,root:input.inputSchema,
      path:'#/extensions/bazaar/info/input/inputSchema',
      documentPath:'#/extensions/bazaar/info/input/inputSchema'}] : [];
  const root=row.extensions?.bazaar?.schema;
  if(input?.type !== 'http' || !object(root)) return [];
  const queue=[{schema:root,step:0,path:'#/extensions/bazaar/schema',depth:0}],result=[],seen=new WeakMap();
  const add=(schema,step,path,depth)=>{
    if(object(schema) && depth <= 16 && queue.length < 128)queue.push({schema,step,path,depth});
  };
  for(let i=0;i<queue.length;i++){
    const node=queue[i],visits=seen.get(node.schema)??new Set();
    if(visits.has(node.step))continue;
    visits.add(node.step);seen.set(node.schema,visits);
    if(node.step===2){result.push({...node,root,documentPath:'#/extensions/bazaar/schema'});continue;}
    const names=node.step===0?['input']:['queryParams','body','pathParams','headers'];
    for(const name of names)
      if(object(node.schema.properties) && Object.hasOwn(node.schema.properties,name))
        add(node.schema.properties[name],node.step+1,node.path+'/properties/'+name,node.depth+1);
    for(const other of alternatives(node.schema,root))
      add(other.schema,node.step,other.reference ? '#/extensions/bazaar/schema'+other.path : node.path+other.path,node.depth+1);
  }
  return result;
}

/** Request queries use only names and annotations actually present in the capture. */
function schemaQueries(entries) {
  const probes=new Map(),coverage={httpResources:0,mcpResources:0,resourcesWithQueries:0,
    visitedNodes:0,traversalLimits:{nodesPerResource:128,depth:16,childrenPerMap:32}};
  for(const [key,row] of entries) {
    const type=row.extensions?.bazaar?.info?.input?.type;
    if(type !== 'http' && type !== 'mcp')continue;
    coverage[type+'Resources']++;
    const queue=[],seen=new WeakSet(),documents=new WeakMap();let added=false;
    const add=(schema,root,path,depth,name='')=>{
      if(depth <= 16 && queue.length < 128 && (object(schema)||name))
        queue.push({schema,root,path,depth,name});
    };
    for(const root of sourceRoots(row)){
      documents.set(root.root,root.documentPath);
      add(root.schema,root.root,root.path,0);
    }
    for(let at=0;at<queue.length;at++){
      const node=queue[at],schema=object(node.schema)?node.schema:{};
      const title=typeof schema.title==='string'?schema.title:'';
      const description=typeof schema.description==='string'?schema.description:'';
      const raw=[node.name,title,description].filter(Boolean).join(' ').trim();
      if(raw && /[\p{L}\p{N}]/u.test(raw)) {
        const query=raw.slice(0,1024),id='schema-'+sha(type+'\0'+query).slice(0,24);
        const probe=probes.get(id)??{id,query,filters:{type},sources:[]};
        probe.sources.push({key,path:node.path,name:node.name,title,description,
          queryTruncated:raw.length>1024});
        probes.set(id,probe);added=true;
      }
      if(!object(node.schema)||seen.has(node.schema))continue;
      seen.add(node.schema);coverage.visitedNodes++;
      for(const keyword of ['properties','patternProperties'])
        if(object(schema[keyword]))for(const name of Object.keys(schema[keyword]).slice(0,32))
          add(schema[keyword][name],node.root,node.path+'/'+keyword+'/'+escapePointer(name),node.depth+1,name);
      if(object(schema.items))add(schema.items,node.root,node.path+'/items',node.depth+1);
      for(const keyword of ['items','prefixItems'])
        if(Array.isArray(schema[keyword]))schema[keyword].slice(0,32).forEach((value,index)=>
          add(value,node.root,node.path+'/'+keyword+'/'+index,node.depth+1));
      if(object(schema.additionalProperties))
        add(schema.additionalProperties,node.root,node.path+'/additionalProperties',node.depth+1);
      for(const other of alternatives(schema,node.root))
        add(other.schema,node.root,other.reference ? documents.get(node.root)+other.path : node.path+other.path,node.depth+1,node.name);
    }
    if(added)coverage.resourcesWithQueries++;
  }
  return {probes:[...probes.values()],coverage};
}
function sourceRanks(result,sources) {
  const ranks=new Map(result.map((value,index)=>[value.key,index+1]));
  return [...new Set(sources.map(source=>source.key))].map(key=>({key,rank:ranks.get(key)??null}));
}

/**
 * catalog and keyOf come from the original SF41 runner after its existing shape,
 * validation and duplicate handling. No replacement records or relevance labels
 * are produced here. Corpus selection uses the original catalog's filter logic.
 */
export async function compareRankingSources({catalog,keyOf,cases,baselinePath,candidatePath,
  repeat=60,warmup=3}) {
  need(Number.isSafeInteger(repeat) && repeat > 0 &&
    Number.isSafeInteger(warmup) && warmup >= 0,'Ranking repeat/warmup must be safe nonnegative integers with a positive repeat');
  need(typeof keyOf === 'function' && Array.isArray(cases) && cases.length,
    'Use the original validated corpus and original replay cases');
  const [baseline,candidate]=await Promise.all([loadRanking(baselinePath),loadRanking(candidatePath)]);
  const rows=nativeRows(catalog,{}),entries=new Map(rows.map(row=>[keyOf(row),row]));
  need(entries.size === rows.length,'Original normalized corpus has repeated canonical keys');
  const selected=cases.map(test=>{
    const params=new URLSearchParams(test.params);
    for(const key of ['query','limit','cursor','offset'])params.delete(key);
    const keys=nativeRows(catalog,params).map(keyOf);
    return {id:test.id,query:test.query,filters:Object.fromEntries(params),keys};
  });
  const runtime={node:process.version,logicalCPUs:cpus().length,loadAverage:loadavg(),
    memoryScope:'BOTH_INDEX_INSTANCES_IN_THE_ORIGINAL_REPLAY_PROCESS',
    memoryBefore:process.memoryUsage()};
  const baseIndex=new baseline.module.BazaarRankingIndex(entries);
  const nextIndex=new candidate.module.BazaarRankingIndex(entries);
  // Measure first preparation separately; later samples reuse lexical state.
  const coldBaseline=timeBatch(baseIndex,selected),coldCandidate=timeBatch(nextIndex,selected);
  const comparisons=selected.map(test=>{
    const subset=test.keys.map(key=>[key,entries.get(key)]);
    const before=materialize(baseline.module.rankBazaarEntries(subset,test.query));
    const after=materialize(candidate.module.rankBazaarEntries(subset,test.query));
    const baseIndexed=materialize(baseIndex.rank(test.keys,test.query));
    const nextIndexed=materialize(nextIndex.rank(test.keys,test.query));
    need(same(before,baseIndexed),'Baseline one-shot/indexed mismatch for '+test.id);
    need(same(after,nextIndexed),'Candidate one-shot/indexed mismatch for '+test.id);
    return {id:test.id,query:test.query,filters:test.filters,selectedRows:test.keys.length,
      baseline:before,candidate:after,identical:same(before,after),changes:diff(before,after)};
  });
  for(let pass=0;pass<warmup;pass++) {
    if(pass%2){timeBatch(nextIndex,selected);timeBatch(baseIndex,selected);}
    else {timeBatch(baseIndex,selected);timeBatch(nextIndex,selected);}
  }
  const samples={baseline:[],candidate:[]},memoryBeforeTimed=process.memoryUsage();
  for(let pass=0;pass<repeat;pass++) {
    if(pass%2){samples.candidate.push(timeBatch(nextIndex,selected));samples.baseline.push(timeBatch(baseIndex,selected));}
    else {samples.baseline.push(timeBatch(baseIndex,selected));samples.candidate.push(timeBatch(nextIndex,selected));}
  }
  const originalIndexStats={baseline:baseIndex.stats,candidate:nextIndex.stats};
  const declared=schemaQueries(entries);
  const metadataComparisons=declared.probes.map(test=>{
    const keys=nativeRows(catalog,new URLSearchParams(test.filters)).map(keyOf);
    const before=materialize(baseIndex.rank(keys,test.query));
    const after=materialize(nextIndex.rank(keys,test.query));
    const subset=keys.map(key=>[key,entries.get(key)]);
    need(same(before,materialize(baseline.module.rankBazaarEntries(subset,test.query))),
      'Baseline schema-query one-shot/indexed mismatch for '+test.id);
    need(same(after,materialize(candidate.module.rankBazaarEntries(subset,test.query))),
      'Candidate schema-query one-shot/indexed mismatch for '+test.id);
    return {...test,selectedRows:keys.length,baseline:before,candidate:after,
      sourceRowRanks:{baseline:sourceRanks(before,test.sources),candidate:sourceRanks(after,test.sources)},
      changes:diff(before,after)};
  });
  return {schema:'SCF-SF41/original-ranking-comparison-v1',
    sources:{baseline:baseline.source,candidate:candidate.source},corpusRows:entries.size,
    queryCount:selected.length,method:{repeat,warmup,order:'ALTERNATING_BASELINE_CANDIDATE',
      measuredUnit:'ONE_COMPLETE_BATCH_OF_ORIGINAL_QUERIES',resultCache:'BYPASSED',
      coldPreparation:'REPORTED_SEPARATELY',quality:'ORIGINAL_ENGINEERING_PROBES_AND_OBSERVED_RESULT_DIFFERENCES'},
    runtime:{...runtime,memoryBeforeTimed,memoryAfterTimed:process.memoryUsage(),resourceUsage:process.resourceUsage()},
    cold:{baseline:coldBaseline,candidate:coldCandidate},
    timings:{baseline:summarize(samples.baseline),candidate:summarize(samples.candidate)},
    index:originalIndexStats,
    schemaQueries:{method:'EXACT_PUBLISHED_REQUEST_NAMES_TITLES_AND_DESCRIPTIONS',
      coverage:declared.coverage,queryCount:metadataComparisons.length,
      comparisons:metadataComparisons,indexAfterQueries:{baseline:baseIndex.stats,candidate:nextIndex.stats}},
    sameSourceOneShotIndexParity:true,comparisons};
}
