#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Node 24: read-only provider capture, complete original responses, bounded retries.
import {readFile,open,mkdir,rename,unlink,lstat,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {CAPTURE_SCHEMA,canonical,digest,json,inspectCapture,requireValue} from './provider-input.mjs';
import {parseExactJSON} from '../../workbench/vendor/dlt/vendor/sling/vendor/stellar-expert/exact-json.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const exists=async p=>{try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
async function syncDirectory(path){const h=await open(path,'r');try{await h.sync();}finally{await h.close();}}
async function unchanged(path,content){const state=await lstat(path);requireValue(state.isFile()&&!state.isSymbolicLink(),'Retained source must be a regular file.');requireValue(await readFile(path,'utf8')===content,'Original retained source changed: '+path);}
async function retain(path,value){
 const content=json(value);if(await exists(path)){await unchanged(path,content);return;}
 await mkdir(dirname(path),{recursive:true,mode:0o700});const tmp=path+'.pending-'+randomUUID(),h=await open(tmp,'wx',0o600);
 try{await h.writeFile(content,'utf8');await h.sync();await h.close();
  // Exclusive link publishes a complete file without replacing another writer.
  const {link}=await import('node:fs/promises');
  try{await link(tmp,path);}catch(e){if(e.code!=='EEXIST')throw e;await unchanged(path,content);}
  await syncDirectory(dirname(path));
 }finally{await h.close().catch(()=>{});await unlink(tmp).catch(()=>{});}
}
function validateConfiguration(config){
 requireValue(config?.schema==='airtable-netsuite.capture-config.v1'&&/^[A-Za-z0-9_-]{1,160}$/.test(config.operationId),'Original capture configuration/operation required.');
 requireValue(/^app[A-Za-z0-9]+$/.test(config.airtable?.baseId)&&Array.isArray(config.airtable.tables)&&config.airtable.tables.length>0,'Original Airtable base/tables required.');
 requireValue(/^[a-z0-9-]+\.suitetalk\.api\.netsuite\.com$/.test(config.netsuite?.accountHost)&&Array.isArray(config.netsuite.queries)&&config.netsuite.queries.length>0,'Original NetSuite REST host/query selection required.');
 requireValue(config.airtable.tables.length<=50&&config.netsuite.queries.length<=50,'At most fifty selections per provider.');
 for(const t of config.airtable.tables){
  requireValue(/^tbl[A-Za-z0-9]+$/.test(t.tableId),'Use retained Airtable table IDs.');
  for(const k of Object.keys(t.query??{}))requireValue(['view','filterByFormula','sort'].includes(k),'Unreviewed Airtable query option: '+k);
  if(t.query?.sort)requireValue(Array.isArray(t.query.sort)&&t.query.sort.every(x=>typeof x.field==='string'&&['asc','desc'].includes(x.direction)),'Retain explicit sort fields/directions.');
 }
 for(const q of config.netsuite.queries){
  requireValue(/^[A-Za-z0-9_-]{1,160}$/.test(q.id)&&typeof q.q==='string'&&/^\s*SELECT\b/i.test(q.q)&&/\bORDER\s+BY\b/i.test(q.q),'Retain reviewed SuiteQL SELECT/ORDER BY.');
  requireValue(q.order?.unique===true&&Array.isArray(q.order.aliases)&&q.order.aliases.length>0,'Retain the query unique-order review.');
  requireValue(Number.isInteger(q.limit??1000)&&(q.limit??1000)>0&&(q.limit??1000)<=1000,'SuiteQL page size is 1..1000.');
 }
 for(const x of [...config.airtable.tables,...config.netsuite.queries]){
  requireValue(typeof x.scope?.population==='string'&&x.scope.population.trim()&&['all-live','filtered-live'].includes(x.scope.coverage)&&typeof x.scope.inactive==='string'&&x.scope.inactive.trim()&&x.scope.deleted==='not-observed-by-list','Retain explicit population/inactive/deleted coverage.');
 }
 requireValue(['observed-interval','quiesced'].includes(config.consistency?.mode),'Retain capture consistency mode.');
 if(config.consistency.mode==='quiesced')requireValue(typeof config.consistency.evidence==='string'&&config.consistency.evidence.trim(),'Retain actual quiescence evidence.');
 requireValue(new Set(config.airtable.tables.map(x=>x.tableId)).size===config.airtable.tables.length&&new Set(config.netsuite.queries.map(x=>x.id)).size===config.netsuite.queries.length,'Provider selections must be unique.');
 return config;
}
async function completeText(response){
 const chunks=[];let total=0;
 for await(const chunk of response.body){total+=chunk.byteLength;requireValue(total<=33554432,'Original page exceeds the 32 MiB complete response limit.');chunks.push(chunk);}
 const bytes=new Uint8Array(total);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
 return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
}
function safeHeaders(response){const out={};for(const key of ['date','content-type','retry-after','x-airtable-request-id','x-n-operationid','x-n-requestid']){const v=response.headers.get(key);if(v!==null)out[key]=v;}return out;}
function delayFor(response,provider){
 const raw=response.headers.get('retry-after');let ms=1000;
 if(raw){ms=/^\d+(?:\.\d+)?$/.test(raw)?Math.ceil(Number(raw)*1000):Math.max(0,Date.parse(raw)-Date.now());}
 if(!Number.isFinite(ms))ms=1000;
 if(provider==='airtable'&&response.status===429)ms=Math.max(ms,30000);
 return ms;
}
/** Reuses retained complete response pages after interruption. Credentials are never retained. */
export async function captureProviders(config,directory,{fetchImpl=globalThis.fetch,env=process.env}={}){
 config=validateConfiguration(config);const root=resolve(directory);
 await mkdir(root,{recursive:true,mode:0o700});const state=await lstat(root);requireValue(state.isDirectory()&&!state.isSymbolicLink(),'Select a private real receiving directory.');
 const lockPath=join(root,'capture.lock'),lock=await open(lockPath,'wx',0o600);
 await lock.writeFile(json({pid:process.pid,startedAt:new Date().toISOString(),operationId:config.operationId}));await lock.sync();
 try{
  await retain(join(root,'configuration.json'),config);
  if(await exists(join(root,'capture.json'))){const prior=JSON.parse(await readFile(join(root,'capture.json'),'utf8'));requireValue(canonical(prior.configuration)===canonical(config),'Completed capture belongs to a different selection.');inspectCapture(prior);return prior;}
  const startPath=join(root,'started.json');
  if(!(await exists(startPath)))await retain(startPath,{operationId:config.operationId,startedAt:new Date().toISOString()});
  const start=JSON.parse(await readFile(startPath,'utf8'));
  const tokens={airtable:env.AIRTABLE_READ_TOKEN,netsuite:env.NETSUITE_READ_TOKEN};
  requireValue(typeof tokens.airtable==='string'&&tokens.airtable&&typeof tokens.netsuite==='string'&&tokens.netsuite,'Set AIRTABLE_READ_TOKEN and NETSUITE_READ_TOKEN in the executing process.');
  let lastAirtable=0;
  async function request(provider,key,url,requestInfo,bodyText=null){
   const path=join(root,'pages',provider,key+'.json');
   if(await exists(path)){
    const saved=JSON.parse(await readFile(path,'utf8'));requireValue(canonical(saved.request)===canonical(requestInfo)&&saved.url===url&&saved.method===(bodyText===null?'GET':'POST'),'Original retained request selection differs.');
    requireValue(digest(saved.body).sha256===saved.sha256&&digest(saved.body).bytes===saved.bytes&&saved.status===200,'Retained original response is incomplete.');return saved;
   }
   const u=new URL(url);requireValue(u.protocol==='https:'&&!u.username&&!u.password&&u.hostname===(provider==='airtable'?'api.airtable.com':config.netsuite.accountHost),'Provider request host differs.');
   for(let attempt=0;attempt<4;attempt++){
    if(provider==='airtable'){await pause(Math.max(0,250-(Date.now()-lastAirtable)));lastAirtable=Date.now();}
    const headers={Authorization:'Bearer '+tokens[provider],Accept:'application/json'};
    if(bodyText!==null){headers['Content-Type']='application/json';headers.Prefer='transient';}
    const response=await fetchImpl(url,{method:bodyText===null?'GET':'POST',headers,body:bodyText??undefined,redirect:'error',signal:AbortSignal.timeout(60000)});
    const text=await completeText(response);
    const saved={provider,url,method:bodyText===null?'GET':'POST',request:requestInfo,status:response.status,receivedAt:new Date().toISOString(),headers:safeHeaders(response),body:text,...digest(text)};
    if(response.status===200){parseExactJSON(text);await retain(path,saved);return saved;}
    await retain(join(root,'errors',provider+'-'+key+'-'+randomUUID()+'.json'),saved);
    const retry=response.status===429||[502,503,504].includes(response.status),delay=delayFor(response,provider);
    if(!retry||attempt===3||delay>120000)throw Error('Provider '+provider+' HTTP '+response.status+'; full response retained. Resume this same capture after the provider permits it.');
    await pause(Math.max(delay,1000*(attempt+1)));
   }
  }
  const schemaURL='https://api.airtable.com/v0/meta/bases/'+encodeURIComponent(config.airtable.baseId)+'/tables';
  const schemaBefore=await request('airtable','schema-before',schemaURL,{baseId:config.airtable.baseId,kind:'base-schema-before'});
  const airtableTables=[];
  for(const spec of config.airtable.tables){
   const selected=[];let offset=null;const seen=new Set();
   for(let i=0;i<10000;i++){
    const u=new URL('https://api.airtable.com/v0/'+encodeURIComponent(config.airtable.baseId)+'/'+encodeURIComponent(spec.tableId));
    u.searchParams.set('pageSize','100');u.searchParams.set('returnFieldsByFieldId','true');
    if(offset!==null){requireValue(!seen.has(offset),'Repeated Airtable page offset.');seen.add(offset);u.searchParams.set('offset',offset);}
    for(const k of ['view','filterByFormula'])if(spec.query?.[k]!==undefined)u.searchParams.set(k,spec.query[k]);
    (spec.query?.sort??[]).forEach((s,index)=>{u.searchParams.set('sort['+index+'][field]',s.field);u.searchParams.set('sort['+index+'][direction]',s.direction);});
    const info={offset,pageSize:100,returnFieldsByFieldId:true,selectionSha256:digest(canonical({baseId:config.airtable.baseId,selection:spec})).sha256};
    const p=await request('airtable',spec.tableId+'-'+String(i).padStart(5,'0'),u.href,info),b=parseExactJSON(p.body);selected.push(p);
    requireValue(Array.isArray(b.records),'Airtable returned no records array.');
    if(!Object.prototype.hasOwnProperty.call(b,'offset')){offset=null;break;}
    requireValue(typeof b.offset==='string'&&b.offset,'Airtable offset is not opaque text.');offset=b.offset;
   }
   requireValue(offset===null,'Airtable complete capture exceeds one million selected records.');
   airtableTables.push({tableId:spec.tableId,pages:selected});
  }
  const netsuiteQueries=[];
  for(const spec of config.netsuite.queries){
   const selected=[],limit=spec.limit??1000,query={q:spec.q,params:spec.params??[]};let more=true;
   async function countPopulation(when){
    if(!spec.countQuery)return null;
    const c=spec.countQuery;requireValue(c.samePopulationAsSelection===true&&typeof c.reviewEvidence==='string'&&c.reviewEvidence.trim()&&typeof c.q==='string'&&/^\s*SELECT\b/i.test(c.q)&&typeof c.alias==='string','Retain reviewed same-population count selection.');
    const q={q:c.q,params:c.params??[]},u=new URL('https://'+config.netsuite.accountHost+'/services/rest/query/v1/suiteql');u.searchParams.set('limit','1');u.searchParams.set('offset','0');
    return request('netsuite',spec.id+'-count-'+when,u.href,{offset:0,limit:1,querySha256:digest(canonical(q)).sha256},json(q));
   }
   const countBefore=await countPopulation('before');
   for(let i=0;i<1000&&more;i++){
    const offset=i*limit;requireValue(offset<100000,'SuiteQL REST result ceiling reached. Use separately reviewed SuiteAnalytics Connect for a larger source.');
    const u=new URL('https://'+config.netsuite.accountHost+'/services/rest/query/v1/suiteql');u.searchParams.set('limit',String(limit));u.searchParams.set('offset',String(offset));
    const p=await request('netsuite',spec.id+'-'+String(i).padStart(4,'0'),u.href,{offset,limit,querySha256:digest(canonical(query)).sha256},json(query)),b=parseExactJSON(p.body);
    selected.push(p);requireValue(typeof b.hasMore==='boolean','SuiteQL response must include hasMore.');more=b.hasMore;
   }
   requireValue(!more,'SuiteQL pagination ceiling reached before the complete result.');
   const countAfter=await countPopulation('after');
   netsuiteQueries.push({id:spec.id,pages:selected,...(spec.countQuery?{countBefore,countAfter}:{})});
  }
  const schemaAfter=await request('airtable','schema-after',schemaURL,{baseId:config.airtable.baseId,kind:'base-schema-after'});
  const capture={schema:CAPTURE_SCHEMA,operationId:config.operationId,state:'complete',configuration:config,startedAt:start.startedAt,completedAt:new Date().toISOString(),consistency:config.consistency,airtable:{baseId:config.airtable.baseId,schemaBefore,schemaAfter,tables:airtableTables},netsuite:{accountHost:config.netsuite.accountHost,queries:netsuiteQueries}};
  inspectCapture(capture);await retain(join(root,'capture.json'),capture);return capture;
 }finally{await lock.close();await unlink(lockPath);await syncDirectory(root);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [configPath,directory]=process.argv.slice(2);
 if(!configPath||!directory)throw Error('Usage: node capture-providers.mjs configuration.json private-capture-directory');
 const config=JSON.parse(await readFile(resolve(configPath),'utf8')),capture=await captureProviders(config,directory);
 console.log(json({operationId:capture.operationId,state:capture.state,path:join(resolve(directory),'capture.json'),...digest(json(capture))}));
}
