// MIT. Allium saved-query acquisition and projection into the ORIGINAL SF30 dataset.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createUpstreamHandlers } from '../../sf30-seller-sdk/upstream.mjs';
import { loadDatasetConfig } from '../../sf30-seller-sdk/dataset-handler.mjs';

const SCHEMA = 'stellar-forge.allium-explorer.v1';
const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(v));
const hash = v => createHash('sha256').update(v).digest('hex');
const fail = message => { throw new TypeError(message); };
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
function keys(v, allowed, name) {
  if (!plain(v) || Object.keys(v).some(k => !allowed.includes(k))) fail('Invalid '+name);
}
function integer(v,low,high,name) {
  if (!Number.isSafeInteger(v) || v < low || v > high) fail('Invalid '+name);
  return v;
}
function identifier(value,name) {
  if (typeof value !== 'string' || !ID.test(value)) fail('Invalid '+name);
  return value;
}
export function compileProduct(value) {
  keys(value,['schema','queryId','parameters','computeProfile','apiKeyEnv','origin','name',
    'sourceTable','columns','filters','ranges','sorts','defaultLimit','maxLimit','maxRows',
    'maxResponseBytes','timeoutMs'],'Allium product');
  if (value.schema !== SCHEMA) fail('Expected '+SCHEMA);
  identifier(value.queryId,'saved query ID');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 128 ||
      /[\x00-\x1f\x7f]/.test(value.name)) fail('Invalid product name');
  if (typeof value.sourceTable !== 'string' || !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(value.sourceTable))
    fail('Declare the approved source table');
  const parameters=value.parameters ?? {};
  if (!plain(parameters) || Object.keys(parameters).length > 16 ||
      Object.entries(parameters).some(([k,v]) => !NAME.test(k) || typeof v !== 'string' ||
        v.length > 1024 || /[\x00-\x1f\x7f]/.test(v))) fail('Saved-query parameters must be bounded strings');
  if (value.computeProfile !== undefined) identifier(value.computeProfile,'compute profile');
  const apiKeyEnv=value.apiKeyEnv ?? 'ALLIUM_API_KEY';
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(apiKeyEnv)) fail('Invalid API-key environment name');
  if (!plain(value.columns) || !Object.keys(value.columns).length || Object.keys(value.columns).length > 32)
    fail('Declare 1–32 projected columns');
  const columns=Object.fromEntries(Object.entries(value.columns).map(([name,spec]) => {
    keys(spec,['source','type','nullable'],'projected column');
    if (!NAME.test(name) || ['constructor','prototype','__proto__'].includes(name) ||
        typeof spec.source !== 'string' || !NAME.test(spec.source) ||
        !['string','integer','number','boolean'].includes(spec.type) ||
        spec.nullable !== undefined && typeof spec.nullable !== 'boolean') fail('Invalid projected column');
    return [name,{...spec,nullable:spec.nullable ?? false}];
  }));
  const capabilities={};
  for (const key of ['filters','ranges','sorts']) {
    const list=value[key] ?? [];
    if (!Array.isArray(list) || list.length > 8 || new Set(list).size !== list.length || list.some(k=>!own(columns,k)))
      fail('Invalid '+key);
    capabilities[key]=[...list];
  }
  if (capabilities.ranges.some(k=>columns[k].type==='boolean') ||
      3+capabilities.filters.length+4*capabilities.ranges.length+(capabilities.sorts.length?1:0)>32)
    fail('Capabilities exceed the original dataset offer contract');
  const maxLimit=integer(value.maxLimit ?? 100,1,1000,'page maximum');
  const result={...value,parameters:{...parameters},apiKeyEnv,columns,...capabilities,
    origin:value.origin ?? 'https://api.allium.so',
    maxRows:integer(value.maxRows ?? 10000,1,250000,'row maximum'),
    maxResponseBytes:integer(value.maxResponseBytes ?? 1048576,1024,1048576,'response-byte maximum'),
    timeoutMs:integer(value.timeoutMs ?? 15000,100,120000,'HTTP timeout'),
    defaultLimit:integer(value.defaultLimit ?? 25,1,maxLimit,'default page limit'),maxLimit};
  return structuredClone(result);
}
export async function readProduct(path) {
  return compileProduct(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await limitedRead(path,65536))));
}
async function limitedRead(path,max) {
  const info=await stat(path);
  if (!info.isFile() || info.size>max) fail('Input exceeds the configured file limit');
  const data=await readFile(path);
  if (data.length>max) fail('Input exceeds the configured file limit');
  return data;
}
function configHash(config) { return hash(JSON.stringify(config)); }
async function saveState(directory,state) {
  const temporary=join(directory,'.state-'+randomUUID());
  await writeFile(temporary,JSON.stringify(state,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(temporary,join(directory,'run.json'));
}
export async function readRun(directory) {
  const state=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await limitedRead(join(directory,'run.json'),131072)));
  if (state.schema!=='stellar-forge.allium-query-run.v1' || state.configSha256!==configHash(compileProduct(state.config)))
    fail('Run configuration changed or is invalid');
  return state;
}
export function createExplorerClient(product,{env=process.env,allowLoopback=false}={}) {
  const c=compileProduct(product), local=allowLoopback && /^http:\/\/127\.0\.0\.1:\d+$/.test(c.origin);
  if (c.origin!=='https://api.allium.so' && !local) fail('Use the documented Allium API origin');
  const common={origin:c.origin,query:[],headerEnv:{'X-API-KEY':c.apiKeyEnv},
    responseMode:'json',timeoutMs:c.timeoutMs,maxResponseBytes:c.maxResponseBytes,maxInFlight:1};
  const handlers=createUpstreamHandlers({schema:'stellar-forge.seller-upstreams.v1',bindings:{
    run:{...common,method:'POST',path:'/api/v1/explorer/queries/'+c.queryId+'/run-async'},
    status:{...common,method:'GET',path:'/api/v1/explorer/query-runs/:runId/status'},
    results:{...common,method:'GET',path:'/api/v1/explorer/query-runs/:runId/results'},
  }},{env,allowLoopback});
  const invoke=async (name,runId) => {
    if (runId!==undefined) identifier(runId,'query run ID');
    const response=await handlers[name]({method:name==='run'?'POST':'GET',url:new URL('https://operator.invalid/'),
      headers:{},pathParams:runId===undefined?{}:{runId},
      ...(name==='run'?{body:{parameters:c.parameters,run_config:{limit:c.maxRows,
        ...(c.computeProfile?{compute_profile:c.computeProfile}:{})}}}:{})});
    if (response.status!==200) {
      const error=new Error('ALLIUM_'+name.toUpperCase()+'_HTTP_'+response.status);
      error.code=typeof response.body?.error==='string'?response.body.error:'ALLIUM_REQUEST_FAILED';
      error.status=response.status;
      throw error;
    }
    if (!Buffer.isBuffer(response.body)) fail('Invalid original transport response');
    return {bytes:response.body,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.body))};
  };
  return {
    run:()=>invoke('run'),status:id=>invoke('status',id),results:id=>invoke('results',id),
  };
}
/** One explicit run submission. Existing directories can never resubmit a query. */
export async function beginRun(config,directory,options={}) {
  const c=compileProduct(config),client=createExplorerClient(c,options);
  if (c.queryId.startsWith('REPLACE_')) fail('Set the actual approved saved-query ID');
  directory=resolve(directory);
  await mkdir(directory,{mode:0o700});
  const state={schema:'stellar-forge.allium-query-run.v1',config:c,configSha256:configHash(c),
    createdAt:new Date().toISOString(),status:'submitting',runId:null};
  await saveState(directory,state);
  try {
    const result=await client.run();
    if (!plain(result.value)) fail('Invalid Allium run response');
    state.runId=identifier(result.value.run_id,'returned query run ID');
    state.status='submitted';
    await saveState(directory,state);
    return {status:state.status,runId:state.runId,stateDirectory:directory};
  } catch(error) {
    state.status='submission_unknown';state.error=error.code ?? 'ALLIUM_RUN_RESPONSE_UNAVAILABLE';
    await saveState(directory,state);
    throw error;
  }
}
/** Attach a known run from the same approved query after an interrupted POST; no POST replay. */
export async function recoverRun(directory,runId) {
  const state=await readRun(directory);
  if (!['submission_unknown','submitting'].includes(state.status) || state.runId) fail('This run already has an identity');
  state.runId=identifier(runId,'operator-recovered query run ID');state.status='submitted';
  state.recoveredAt=new Date().toISOString();await saveState(directory,state);
  return {status:state.status,runId:state.runId};
}
function cell(value,spec) {
  if (value===null) { if(spec.nullable)return '';fail('Nonnullable source value is null'); }
  if (spec.type==='string') {
    if (typeof value!=='string' || value.length>65536 || value.includes('\0')) fail('Expected an exact source string');
    if (value==='' && spec.nullable) fail('Nullable CSV cannot distinguish an empty string from null');
  } else if (spec.type==='integer') {
    if (!Number.isSafeInteger(value)) fail('Large integers must be cast to strings in the saved query');
  } else if (spec.type==='number') {
    if (typeof value!=='number' || !Number.isFinite(value)) fail('Expected a finite source number');
  } else if (typeof value!=='boolean') fail('Expected a source boolean');
  const text=String(value);
  return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;
}
/** Convert only explicit typed fields, then validate with the original dataset loader. */
export async function stageResults(config,bytes,directory,{runId=null,acquisition='operator-import'}={}) {
  const c=compileProduct(config);
  if (!Buffer.isBuffer(bytes) || bytes.length>c.maxResponseBytes) fail('Result exceeds the product byte limit');
  if (runId!==null) identifier(runId,'query run ID');
  const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if (!plain(result) || typeof result.sql!=='string' || !plain(result.meta) ||
      !Array.isArray(result.meta.columns) || !Array.isArray(result.data) || result.data.length>c.maxRows)
    fail('Expected the documented Allium JSON result envelope within its row limit');
  const metadata=new Map();
  for (const column of result.meta.columns) {
    if (!plain(column) || typeof column.name!=='string' || typeof column.data_type!=='string' || metadata.has(column.name))
      fail('Invalid or duplicate result column metadata');
    metadata.set(column.name,column.data_type);
  }
  const projected=Object.entries(c.columns);
  if (projected.some(([,s])=>!metadata.has(s.source))) fail('A declared source column is absent');
  if (result.queried_at!==undefined && (typeof result.queried_at!=='string' || !Number.isFinite(Date.parse(result.queried_at))))
    fail('Invalid source query timestamp');
  const rows=[projected.map(([name])=>name).join(',')];
  for (const row of result.data) {
    if (!plain(row) || projected.some(([,s])=>!own(row,s.source))) fail('A result row is missing a projected column');
    rows.push(projected.map(([,s])=>cell(row[s.source],s)).join(','));
  }
  const csv=Buffer.from(rows.join('\n')+'\n');
  const dataset={schema:'stellar-forge.csv-dataset.v1',file:'dataset.csv',name:c.name,
    columns:Object.fromEntries(projected.map(([k,s])=>[k,{type:s.type,nullable:s.nullable}])),
    filters:c.filters,ranges:c.ranges,sorts:c.sorts,defaultLimit:c.defaultLimit,maxLimit:c.maxLimit,
    maxRows:c.maxRows,maxBytes:Math.max(1024,csv.length),maxCellChars:65536};
  directory=resolve(directory);await mkdir(dirname(directory),{recursive:true,mode:0o700});
  const temporary=directory+'.staging-'+randomUUID();
  await mkdir(temporary,{mode:0o700});
  try {
    await writeFile(join(temporary,'dataset.csv'),csv,{flag:'wx',mode:0o600});
    await writeFile(join(temporary,'dataset.json'),JSON.stringify(dataset,null,2)+'\n',{flag:'wx',mode:0o600});
    const native=await loadDatasetConfig(join(temporary,'dataset.json'));
    const manifest={schema:'stellar-forge.allium-dataset-source.v1',provider:'Allium',acquisition,
      queryId:c.queryId,runId,sourceTable:c.sourceTable,queriedAt:result.queried_at ?? null,
      importedAt:new Date().toISOString(),configSha256:configHash(c),resultSha256:hash(bytes),
      sqlSha256:hash(result.sql),csvSha256:hash(csv),rowCount:native.describe().rowCount,
      snapshot:native.describe().snapshot,rowLimit:c.maxRows,rowLimitReached:result.data.length===c.maxRows,
      columns:projected.map(([name,s])=>({name,source:s.source,
        type:s.type,sourceType:metadata.get(s.source)}))};
    await writeFile(join(temporary,'source.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
    await rename(temporary,directory);
    return {status:'STAGED',dataset:join(directory,'dataset.json'),source:join(directory,'source.json'),
      rowCount:manifest.rowCount,snapshot:manifest.snapshot,resultSha256:manifest.resultSha256,
      rowLimitReached:manifest.rowLimitReached};
  } finally { await rm(temporary,{recursive:true,force:true}); }
}
/** One status read; a successful status permits one result fetch. No busy polling or run replay. */
export async function collectRun(directory,options={}) {
  const state=await readRun(directory);
  if (state.status==='staged') {
    const native=await loadDatasetConfig(join(directory,'dataset/dataset.json'));
    if (native.describe().snapshot!==state.snapshot) fail('Staged dataset identity changed');
    return {status:'STAGED',runId:state.runId,dataset:join(resolve(directory),'dataset/dataset.json'),
      snapshot:state.snapshot,unchanged:true};
  }
  if (!state.runId) fail('Recover the actual run ID before collecting; do not resubmit');
  const client=createExplorerClient(state.config,options);
  const status=(await client.status(state.runId)).value;
  if (!['created','queued','running','success','failed','canceled'].includes(status)) fail('Unknown Allium query status');
  state.status=status;state.lastCheckedAt=new Date().toISOString();await saveState(directory,state);
  if (status!=='success') return {status,runId:state.runId};
  const cached=join(directory,'result.json');
  let bytes;
  try { bytes=await limitedRead(cached,state.config.maxResponseBytes); }
  catch(error) {
    if (error.code!=='ENOENT') throw error;
    bytes=(await client.results(state.runId)).bytes;
    await writeFile(cached,bytes,{flag:'wx',mode:0o600});
  }
  let output;
  try { output=await stageResults(state.config,bytes,join(directory,'dataset'),{runId:state.runId,acquisition:'allium-api'}); }
  catch(error) {
    if (!['EEXIST','ENOTEMPTY'].includes(error.code)) throw error;
    const manifest=JSON.parse(await readFile(join(directory,'dataset/source.json'),'utf8'));
    const native=await loadDatasetConfig(join(directory,'dataset/dataset.json'));
    if (manifest.resultSha256!==hash(bytes) || manifest.configSha256!==state.configSha256 ||
        manifest.snapshot!==native.describe().snapshot) fail('Interrupted staging identity does not match');
    output={status:'STAGED',dataset:join(resolve(directory),'dataset/dataset.json'),snapshot:manifest.snapshot,unchanged:true};
  }
  state.status='staged';state.snapshot=output.snapshot;await saveState(directory,state);
  return {...output,runId:state.runId};
}
export async function importResult(configPath,resultPath,directory) {
  const config=await readProduct(configPath);
  return stageResults(config,await limitedRead(resultPath,config.maxResponseBytes),directory);
}
