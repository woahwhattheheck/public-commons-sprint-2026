// MIT. Saved research queries and editions over original OpenAlex or SF88 received bytes.
import {readdir,open,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {privateDirectory,readBytes,readJson,writeBytes,writeJson,jsonBytes,digest,exists,parseJson,need} from '../node/store.mjs';
import {BuyerResult} from '../node/result.mjs';
import {analyzeResearch,compareResearch} from './analysis.mjs';
import {renderResearchReport,researchExportPlan} from './report.mjs';

export const MAX_PAGE_BYTES=67108864;
export const ENTITY_PREFIXES=Object.freeze({works:'W',authors:'A',sources:'S',institutions:'I',topics:'T',publishers:'P',funders:'F',awards:'G'});
const PARAMETERS=['filter','search','search.exact','search.title','search.title.exact','search.title_and_abstract','search.title_and_abstract.exact','search.title_abstract_keywords','search.title_abstract_keywords.exact','sort','select','per_page','corpus'];
const HEADER_NAMES=['content-type','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-credits-used','x-ratelimit-reset','x-openalex-source-url','x-openalex-source-sha256','retry-after'];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export class ResearchError extends Error{constructor(code,message=code,status=400){super(message);this.code=code;this.status=status;}}
const check=(condition,code,message,status)=>{if(!condition)throw new ResearchError(code,message,status);};
export const canonical=value=>JSON.stringify(value,function(_key,v){return plain(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v;});
export function safeId(value){check(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value),'ID_INVALID','Use a stable letters-and-digits identifier.');return value;}
const labelOf=(value,fallback)=>{check(typeof value==='string'&&value.trim().length>0&&value.length<=200,'LABEL_INVALID');return value.trim()||fallback;};
function parametersOf(entity,parameters){
  check(Object.hasOwn(ENTITY_PREFIXES,entity),'ENTITY_INVALID');
  check(plain(parameters)&&Object.keys(parameters).every(k=>PARAMETERS.includes(k)),'QUERY_FIELDS_INVALID');
  const out={};
  for(const [key,value] of Object.entries(parameters)){
    if(value===null||value===undefined||value==='')continue;
    const text=String(value);
    check(text.length<=3500&&!/[\x00-\x1f\x7f]/.test(text),'QUERY_VALUE_INVALID');
    out[key]=text;
  }
  out.per_page??='100';
  check(/^[1-9]\d*$/.test(out.per_page)&&Number(out.per_page)<=100,'PER_PAGE_INVALID');
  check(out.filter||Object.keys(out).some(k=>k==='search'||k.startsWith('search.')),'QUERY_SCOPE_REQUIRED','Save a search or filter to define the research cohort.');
  check(!out.corpus||['core','all'].includes(out.corpus),'CORPUS_INVALID');
  check(!out.select||out.select.split(',').includes('id'),'ID_FIELD_REQUIRED','Include id in selected fields to retain cohort membership.');
  check(!out.select||out.select.split(',').every(x=>/^[a-z][a-z0-9_]*$/.test(x)),'SELECT_INVALID');
  check(entity==='works'||!Object.keys(out).some(k=>k.startsWith('search.')),'WORKS_SEARCH_REQUIRED');
  return out;
}
export function requestUrl(request,base='https://api.openalex.org'){
  check(plain(request)&&Object.hasOwn(ENTITY_PREFIXES,request.entity)&&plain(request.parameters),'REQUEST_INVALID');
  const url=new URL('/'+request.entity,base);
  for(const [key,value] of Object.entries(request.parameters))url.searchParams.set(key,String(value));
  check(Buffer.byteLength(url.href)<=4094,'QUERY_URL_TOO_LONG','The query exceeds the OpenAlex URL limit.');
  return url.href;
}
async function exact(path,bytes){
  try{const prior=await readBytes(path,bytes.length);check(prior.equals(bytes),'RETAINED_FILE_CONFLICT','A retained file contains different bytes.',409);return;}
  catch(e){if(e.code!=='ENOENT')throw e;}
  try{await writeBytes(path,bytes,{exclusive:true});}
  catch(e){if(e.code!=='EEXIST')throw e;const prior=await readBytes(path,bytes.length);check(prior.equals(bytes),'RETAINED_FILE_CONFLICT',undefined,409);}
}
async function lock(directory,name,work){
  const path=join(directory,name),handle=await open(path,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
  try{
    const info=await handle.stat(),named=await lstat(path);
    check(info.isFile()&&info.nlink===1&&!(info.mode&0o077)&&info.dev===named.dev&&info.ino===named.ino&&!named.isSymbolicLink(),'WORKSPACE_LOCK_CHANGED',undefined,503);
    const result=spawnSync('flock',['--exclusive','--nonblock','--conflict-exit-code','73','3'],{stdio:['ignore','pipe','pipe',handle.fd],timeout:10000});
    check(!result.error&&result.status===0,result.status===73?'WORKSPACE_BUSY':'FLOCK_REQUIRED',
      result.status===73?'This edition is being updated in another process.':'Linux util-linux flock is required.',503);
    return await work();
  }finally{await handle.close();}
}
function pageValue(bytes,entity){
  check(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=MAX_PAGE_BYTES,'PAGE_SIZE_INVALID');
  const value=parseJson(bytes);
  check(plain(value)&&plain(value.meta)&&Array.isArray(value.results)&&Number.isSafeInteger(value.meta.count)&&value.meta.count>=0,'PAGE_CONTRACT_INVALID','Receive one complete OpenAlex list response.');
  check(Object.hasOwn(value.meta,'next_cursor')&&(value.meta.next_cursor===null||typeof value.meta.next_cursor==='string'&&value.meta.next_cursor.length>0),'CURSOR_REQUIRED','Cursor editions require meta.next_cursor in every response.');
  const prefix=ENTITY_PREFIXES[entity];
  check(value.results.every(v=>plain(v)&&typeof v.id==='string'&&new RegExp('^https://openalex[.]org/'+prefix+'[1-9][0-9]*$').test(v.id)),'PAGE_ENTITY_MISMATCH');
  check(!Array.isArray(value.group_by)||value.group_by.length===0,'GROUPED_RESULTS_REQUIRE_ENTITY_PAGES','Use entity pages for a retained research cohort; grouped summaries are a separate merchant query.');
  return value;
}
function sourceOf(input,request){
  const source=plain(input)?input:{},headers={};
  for(const key of HEADER_NAMES)if(typeof source.headers?.[key]==='string')headers[key]=source.headers[key].slice(0,8192);
  const url=source.url??requestUrl(request),parsed=new URL(url);
  check(['https:','http:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password&&!parsed.searchParams.has('api_key'),'SOURCE_URL_INVALID');
  const at=source.retrievedAt??new Date().toISOString();
  check(typeof at==='string'&&Number.isFinite(Date.parse(at)),'SOURCE_TIME_INVALID');
  return {kind:['OPENALEX_API','MERCHANT_RESPONSE','IMPORTED_RESPONSE','NATIVE_BUYER_RESPONSE'].includes(source.kind)?source.kind:'IMPORTED_RESPONSE',url,retrievedAt:at,headers};
}
function nativeOf(record,bytes){
  if(record===null||record===undefined)return null;
  const native=plain(record.native)?record.native:record,saved=native.responseFile;
  check(native.mode==='ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT'&&typeof native.intentId==='string'&&
    saved?.status==='SAVED'&&saved.bytes===bytes.length&&saved.sha256===digest(bytes),'NATIVE_RESPONSE_MISMATCH');
  return {record,native};
}
export async function openResearchWorkspace(directory){
  const root=await privateDirectory(resolve(directory));
  check(await realpath(root)===root,'WORKSPACE_SYMLINK_REFUSED');
  for(const name of ['queries','editions','exports'])await privateDirectory(join(root,name));
  let pending=Promise.resolve(),closed=false;
  function serial(work){const task=pending.then(()=>{check(!closed,'WORKSPACE_CLOSED',undefined,503);return lock(root,'workspace.lock',work);});pending=task.catch(()=>{});return task;}
  async function query(id,revision){
    safeId(id);check(revision===undefined||Number.isSafeInteger(revision)&&revision>0,'QUERY_REVISION_INVALID');const path=revision===undefined?join(root,'queries',id,'query.json'):join(root,'queries',id,'revisions',String(revision)+'.json');
    const q=await readJson(path,65536);
    check(q.schema==='stellar-forge.research-query.v1'&&q.id===id&&q.sha256===digest(canonical({label:q.label,entity:q.entity,parameters:q.parameters})),'QUERY_RECORD_CHANGED');
    parametersOf(q.entity,q.parameters);return q;
  }
  async function saveQuery({id=randomUUID(),label,entity='works',parameters,expectedRevision=0}){
    safeId(id);const selected={label:labelOf(label),entity,parameters:parametersOf(entity,parameters)};
    requestUrl({entity,parameters:{...selected.parameters,cursor:'*'}});
    return serial(async()=>{
      const folder=await privateDirectory(join(root,'queries',id)),versions=await privateDirectory(join(folder,'revisions'));
      let prior=null;try{prior=await query(id);}catch(e){if(e.code!=='ENOENT')throw e;}
      check(Number.isSafeInteger(expectedRevision)&&expectedRevision===(prior?.revision??0),'QUERY_REVISION_CHANGED','Reopen the current query revision.',409);
      const hash=digest(canonical(selected));if(prior?.sha256===hash)return prior;
      const revision=expectedRevision+1,at=new Date().toISOString(),version=join(versions,revision+'.json');
      let next={schema:'stellar-forge.research-query.v1',id,...selected,revision,sha256:hash,createdAt:prior?.createdAt??at,updatedAt:at};
      if(await exists(version)){
        const retained=await readJson(version,65536);
        check(retained.sha256===hash&&retained.id===id&&retained.revision===revision,'QUERY_REVISION_CONFLICT',undefined,409);next=retained;
      }else await writeJson(version,next,{exclusive:true});
      await writeJson(join(folder,'query.json'),next);return next;
    });
  }
  async function listQueries(){
    const rows=[];for(const p of await readdir(join(root,'queries'),{withFileTypes:true}))if(p.isDirectory()){
      try{rows.push(await query(p.name));}catch(e){if(e.code!=='ENOENT')throw e;}
    }return rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  }
  async function createEdition({id=randomUUID(),queryId,queryRevision,label}){
    safeId(id);const q=await query(queryId,queryRevision);
    return serial(async()=>{
      const folder=await privateDirectory(join(root,'editions',id)),file=join(folder,'edition.json');
      if(await exists(file)){
        const old=await readJson(file);
        check(old.querySha256===q.sha256&&old.label===labelOf(label??q.label),'EDITION_ID_CONFLICT',undefined,409);
        return edition(id);
      }
      const record={schema:'stellar-forge.research-edition.v1',id,queryId:q.id,queryRevision:q.revision,querySha256:q.sha256,
        label:labelOf(label??q.label),createdAt:new Date().toISOString()};
      await exact(join(folder,'query.json'),jsonBytes(q));await privateDirectory(join(folder,'pages'));
      await writeJson(file,record,{exclusive:true});return edition(id);
    });
  }


  async function edition(id,{records=true}={}){
    safeId(id);const folder=join(root,'editions',id),record=await readJson(join(folder,'edition.json'),65536),q=await readJson(join(folder,'query.json'),65536);
    check(record.schema==='stellar-forge.research-edition.v1'&&record.id===id&&q.sha256===record.querySha256&&
      q.sha256===digest(canonical({label:q.label,entity:q.entity,parameters:q.parameters})),'EDITION_RECORD_CHANGED');
    const names=(await readdir(join(folder,'pages'),{withFileTypes:true})).filter(v=>v.isDirectory()&&/^\d{8}$/.test(v.name)).map(v=>v.name).sort();
    const pages=[],received=[],seenCursors=new Set();let nextCursor='*',reason='NO_PAGES',broken=false;
    for(const name of names){
      const directory=join(folder,'pages',name);let p;
      try{p=await readJson(join(directory,'page.json'),262144);}catch(e){if(e.code==='ENOENT')continue;throw e;}
      check(p.schema==='stellar-forge.research-page.v1'&&p.index===pages.length+1&&name===String(p.index).padStart(8,'0')&&
        p.editionId===id&&p.querySha256===q.sha256&&p.requestSha256===digest(canonical(p.request))&&
        canonical(p.request)===canonical({entity:q.entity,parameters:{...q.parameters,cursor:nextCursor}}),'PAGE_CHAIN_CHANGED');
      check(typeof p.sha256==='string'&&/^[a-f0-9]{64}$/.test(p.sha256)&&Number.isSafeInteger(p.bytes)&&p.bytes>0&&
        Number.isSafeInteger(p.records)&&p.records>=0&&Number.isSafeInteger(p.totalReported)&&p.totalReported>=0,'PAGE_RECORD_CHANGED');
      if(records){
        const raw=await readBytes(join(directory,'response.json'),MAX_PAGE_BYTES);
        check(raw.length===p.bytes&&digest(raw)===p.sha256,'PAGE_BYTES_CHANGED');
        const value=pageValue(raw,q.entity);
        check(value.results.length===p.records&&value.meta.count===p.totalReported&&value.meta.next_cursor===p.nextCursor,'PAGE_METADATA_CHANGED');
        received.push(...value.results);
        if(p.nativeSha256){
          const nativeRaw=await readBytes(join(directory,'buyer-result.json'),4194304);
          check(digest(nativeRaw)===p.nativeSha256,'NATIVE_RECORD_CHANGED');nativeOf(parseJson(nativeRaw),raw);
        }
      }
      pages.push(p);seenCursors.add(nextCursor);nextCursor=p.nextCursor;
      if(nextCursor!==null&&seenCursors.has(nextCursor)){broken=true;reason='CURSOR_REPEATED';}
      else reason=nextCursor===null?(p.records===0?'TERMINAL_EMPTY_PAGE':'TERMINAL_CURSOR'):'MORE_PAGES';
      check(!broken||name===names.at(-1),'CURSOR_CHAIN_INVALID');
    }
    let annotations={revision:0,items:{}};
    try{annotations=await readJson(join(folder,'decisions.json'),8388608);}catch(e){if(e.code!=='ENOENT')throw e;}
    check(Number.isSafeInteger(annotations.revision)&&annotations.revision>=0&&plain(annotations.items),'DECISIONS_RECORD_CHANGED');
    let pendingRecord=null;
    try{pendingRecord=await readJson(join(folder,'pending.json'),262144);}catch(e){if(e.code!=='ENOENT')throw e;}
    const reportedCounts=[...new Set(pages.map(p=>p.totalReported))],warnings=[];
    if(reportedCounts.length>1)warnings.push('The provider matching count changed during retrieval.');
    const coverage={state:!pages.length?'EMPTY':broken?'INTERRUPTED':nextCursor===null?'COMPLETE':'PARTIAL',
      pages:pages.length,recordsReceived:pages.reduce((n,p)=>n+p.records,0),totalReported:pages.at(-1)?.totalReported??null,reportedCounts,nextCursor,reason,
      firstRetrievedAt:pages[0]?.source.retrievedAt??null,lastRetrievedAt:pages.at(-1)?.source.retrievedAt??null,warnings};
    const result={record,query:q,pages,coverage,decisions:annotations,pending:pendingRecord,directory:folder};
    if(records){
      result.records=received;result.analysis=analyzeResearch(received,{entity:q.entity,decisions:annotations.items});
      const count=result.analysis.counts?.uniqueRecords;
      if(coverage.state==='COMPLETE'&&Number.isSafeInteger(count)&&reportedCounts.some(n=>n!==count))
        warnings.push('The unique received membership differs from a provider-reported count; records were retrieved over the stated period.');
    }
    return result;
  }
  async function listEditions(){
    const rows=[];for(const p of await readdir(join(root,'editions'),{withFileTypes:true}))if(p.isDirectory()){
      try{const e=await edition(p.name,{records:false});rows.push({record:e.record,query:e.query,coverage:e.coverage,decisionsRevision:e.decisions.revision,pending:e.pending});}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }return rows.sort((a,b)=>b.record.createdAt.localeCompare(a.record.createdAt));
  }
  async function commitPage(e,request,responseBytes,source,nativeRecord){
    const responseSha=digest(responseBytes),value=pageValue(responseBytes,e.query.entity);
    const requestSha=digest(canonical(request)),native=nativeOf(nativeRecord,responseBytes);
    const repeated=e.pages.find(p=>p.requestSha256===requestSha&&p.sha256===responseSha);
    if(repeated){
      if(native&&repeated.nativeIntentId)check(repeated.nativeIntentId===native.native.intentId,'NATIVE_PAGE_INTENT_CHANGED',undefined,409);
      return {page:repeated,edition:e,reused:true};
    }
    check(['EMPTY','PARTIAL'].includes(e.coverage.state)&&e.coverage.nextCursor!==null,'EDITION_RETRIEVAL_FINISHED','Create a new edition to refresh this query.',409);
    const expected={entity:e.query.entity,parameters:{...e.query.parameters,cursor:e.coverage.nextCursor}};
    check(canonical(request)===canonical(expected),'PAGE_REQUEST_MISMATCH','Receive the next page for this exact saved query.',409);
    const index=e.pages.length+1,folder=await privateDirectory(join(e.directory,'pages',String(index).padStart(8,'0')));
    const info=sourceOf(source,request);if(native)info.kind='NATIVE_BUYER_RESPONSE';
    let nativeBytes=native?jsonBytes(native.record):null;
    let page={schema:'stellar-forge.research-page.v1',editionId:e.record.id,index,querySha256:e.query.sha256,request,requestSha256:requestSha,
      sha256:responseSha,bytes:responseBytes.length,records:value.results.length,totalReported:value.meta.count,nextCursor:value.meta.next_cursor,
      costMeta:{...(value.meta.cost===undefined?{}:{cost:value.meta.cost}),...(value.meta.cost_usd===undefined?{}:{costUsd:value.meta.cost_usd})},
      source:info,nativeSha256:nativeBytes?digest(nativeBytes):null,nativeIntentId:native?.native.intentId??null};
    const intentFile=join(folder,'receive-intent.json');let intent=null;
    try{intent=await readJson(intentFile,5242880);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(intent){
      check(intent.schema==='stellar-forge.research-page-commit.v1'&&plain(intent.page),'PAGE_COMMIT_INTENT_CHANGED');
      const p=intent.page;
      for(const key of ['schema','editionId','index','querySha256','requestSha256','sha256','bytes','records','totalReported','nextCursor'])
        check(p[key]===page[key],'PAGE_COMMIT_INTENT_CHANGED',undefined,409);
      check(canonical(p.request)===canonical(request)&&canonical(p.costMeta)===canonical(page.costMeta)&&p.nativeIntentId===page.nativeIntentId,'PAGE_COMMIT_INTENT_CHANGED',undefined,409);
      const retainedNative=nativeOf(intent.nativeRecord,responseBytes);
      check(Boolean(retainedNative)===Boolean(native),'NATIVE_RESPONSE_MISMATCH');
      if(native)check(canonical(retainedNative.native)===canonical(native.native),'NATIVE_PAGE_INTENT_CHANGED',undefined,409);
      nativeBytes=retainedNative?jsonBytes(retainedNative.record):null;
      check((nativeBytes?digest(nativeBytes):null)===p.nativeSha256,'NATIVE_RECORD_CHANGED');
      check(canonical(sourceOf(p.source,request))===canonical(p.source),'PAGE_SOURCE_CHANGED');
      page=p;
    }else{
      intent={schema:'stellar-forge.research-page-commit.v1',page,nativeRecord:native?.record??null};
      await writeJson(intentFile,intent,{exclusive:true});
    }
    const binding={schema:'stellar-forge.research-page-plan.v1',editionId:e.record.id,index,querySha256:e.query.sha256,
      requestSha256:requestSha,sha256:responseSha,nativeSha256:page.nativeSha256};
    await exact(join(folder,'plan.json'),jsonBytes(binding));
    await exact(join(folder,'request.json'),jsonBytes(request));
    // Keep complete source/commit intent and the original native record durable
    // before publishing the response bytes. A restart can finish this same page.
    if(nativeBytes)await exact(join(folder,'buyer-result.json'),nativeBytes);
    await exact(join(folder,'response.json'),responseBytes);
    const pageFile=join(folder,'page.json');
    if(await exists(pageFile)){
      const old=await readJson(pageFile,262144);
      check(canonical(old)===canonical(page),'PAGE_COMMIT_CONFLICT',undefined,409);
    }else await writeJson(pageFile,page,{exclusive:true});
    return {page,edition:await edition(e.record.id,{records:false}),reused:false};
  }
  async function receivePage({editionId,request,responseBytes,source,nativeRecord=null}){
    responseBytes=Buffer.from(responseBytes);
    return serial(async()=>commitPage(await edition(editionId,{records:false}),request,responseBytes,source,nativeRecord));
  }
  async function recoverPendingPage(editionId){
    safeId(editionId);
    return serial(async()=>{
      const e=await edition(editionId,{records:false});
      if(!['EMPTY','PARTIAL'].includes(e.coverage.state))return null;
      const index=e.pages.length+1,folder=join(e.directory,'pages',String(index).padStart(8,'0'));
      if(!(await exists(folder)))return null;
      let raw;
      try{raw=await readBytes(join(folder,'response.json'),MAX_PAGE_BYTES);}
      catch(error){if(error.code==='ENOENT')return null;throw error;}
      let intent;
      try{intent=await readJson(join(folder,'receive-intent.json'),5242880);}
      catch(error){if(error.code!=='ENOENT')throw error;}
      if(intent){
        check(intent.schema==='stellar-forge.research-page-commit.v1'&&plain(intent.page),'PAGE_COMMIT_INTENT_CHANGED');
        const received=await commitPage(e,intent.page.request,raw,intent.page.source,intent.nativeRecord);
        return {...received,recovered:true};
      }
      // Older incomplete receives still retain exact request/response/native
      // files. Record today's import observation without inventing a past time.
      const plan=await readJson(join(folder,'plan.json'),262144),request=await readJson(join(folder,'request.json'),65536);
      check(plan.schema==='stellar-forge.research-page-plan.v1'&&plan.editionId===editionId&&plan.index===index&&
        plan.querySha256===e.query.sha256&&plan.requestSha256===digest(canonical(request))&&plan.sha256===digest(raw),'PAGE_PLAN_CHANGED');
      let nativeRecord=null;
      if(plan.nativeSha256){
        let nativeBytes;
        try{nativeBytes=await readBytes(join(folder,'buyer-result.json'),4194304);}
        catch(error){if(error.code==='ENOENT')return null;throw error;}
        check(digest(nativeBytes)===plan.nativeSha256,'NATIVE_RECORD_CHANGED');nativeRecord=parseJson(nativeBytes);
      }
      const received=await commitPage(e,request,raw,{kind:'IMPORTED_RESPONSE',url:requestUrl(request),
        retrievedAt:new Date().toISOString()},nativeRecord);
      return {...received,recovered:true,legacyImport:true};
    });
  }
  async function receiveBuyerResult(result,options){
    check(plain(result)&&typeof result.bytes==='function'&&plain(result.record)&&plain(result.native),'BUYER_RESULT_REQUIRED');
    const bytes=await result.bytes({limit:MAX_PAGE_BYTES});
    return receivePage({...options,responseBytes:bytes,nativeRecord:result.record});
  }
  async function receiveResultFile(file,options){
    const record=await readJson(resolve(file),4194304),native=plain(record.native)?record.native:record,saved=native.responseFile;
    check(saved?.status==='SAVED'&&typeof saved.path==='string','SAVED_BUYER_RESULT_REQUIRED');
    const result=new BuyerResult(plain(record.native)?record:{native:record},{destination:saved.path,maxBytes:MAX_PAGE_BYTES});
    const bytes=await result.bytes({limit:MAX_PAGE_BYTES});
    return receivePage({...options,responseBytes:bytes,nativeRecord:record});
  }
  async function setDecision({editionId,id,decision,expectedRevision}){
    check(plain(decision)&&['include','exclude','undecided'].includes(decision.status),'DECISION_INVALID');
    check(typeof decision.notes==='string'&&decision.notes.length<=10000&&Array.isArray(decision.tags)&&decision.tags.length<=32&&
      decision.tags.every(t=>typeof t==='string'&&t.length>0&&t.length<=80&&!/[\x00-\x1f\x7f]/.test(t)),'DECISION_DETAILS_INVALID');
    return serial(async()=>{
      const e=await edition(editionId);
      check(e.decisions.revision===expectedRevision,'DECISIONS_REVISION_CHANGED','Reopen the current review decisions.',409);
      check(e.records.some(r=>r.id===id),'RECORD_NOT_IN_EDITION','Choose a record from this edition.');
      const next={revision:expectedRevision+1,items:{...e.decisions.items,[id]:{status:decision.status,notes:decision.notes,tags:[...new Set(decision.tags)],updatedAt:new Date().toISOString()}}};
      await writeJson(join(e.directory,'decisions.json'),next);return next;
    });
  }
  async function copyDecisions({fromEdition,toEdition,expectedRevision}){
    return serial(async()=>{
      const before=await edition(fromEdition),after=await edition(toEdition);
      check(after.decisions.revision===expectedRevision,'DECISIONS_REVISION_CHANGED',undefined,409);
      const ids=new Set(after.records.map(r=>r.id)),copied=Object.fromEntries(Object.entries(before.decisions.items).filter(([id])=>ids.has(id)));
      const next={revision:expectedRevision+1,items:{...copied,...after.decisions.items}};
      await writeJson(join(after.directory,'decisions.json'),next);return {decisions:next,copied:Object.keys(copied).length};
    });
  }


  async function gatherEdition({editionId,fetchPage,signal,onPage,shouldContinue,maxPages=Infinity}){
    safeId(editionId);check(typeof fetchPage==='function','PAGE_FETCHER_REQUIRED');
    check(maxPages===Infinity||Number.isSafeInteger(maxPages)&&maxPages>0,'PAGE_BATCH_INVALID');
    const folder=join(root,'editions',editionId);await edition(editionId,{records:false});
    return lock(folder,'gather.lock',async()=>{
      const binding=fetchPage.retrievalBinding;
      if(binding!==undefined){
        check(plain(binding)&&binding.schema==='stellar-forge.research-retrieval-binding.v1','RETRIEVAL_BINDING_INVALID');
        await serial(()=>exact(join(folder,'retrieval.json'),jsonBytes(binding)));
      }else if(await exists(join(folder,'retrieval.json')))
        throw new ResearchError('RETRIEVAL_CONTEXT_REQUIRED','Resume with the original configured retrieval adapter.',409);
      let fetched=0;
      try{
        while(fetched<maxPages){
          signal?.throwIfAborted();
          const recovered=await recoverPendingPage(editionId);
          if(recovered?.page){
            const previous=await edition(editionId,{records:false});
            await serial(()=>writeJson(join(folder,'pending.json'),{...(previous.pending??{}),editionId,index:recovered.page.index,
              request:recovered.page.request,requestSha256:recovered.page.requestSha256,
              state:recovered.edition.coverage.state==='COMPLETE'?'COMPLETE':'PAGE_RECEIVED',
              pageSha256:recovered.page.sha256,recoveredFromRetainedBytes:true,updatedAt:new Date().toISOString()}));
            fetched++;if(onPage)await onPage(recovered);continue;
          }
          const e=await edition(editionId,{records:false});
          if(e.coverage.state==='COMPLETE'||e.coverage.state==='INTERRUPTED'){
            const last=e.pages.at(-1),state=e.coverage.state==='COMPLETE'?'COMPLETE':'INTERRUPTED';
            if(last&&e.pending?.index===last.index&&e.pending.state!==state){
              await serial(()=>writeJson(join(folder,'pending.json'),{...e.pending,state,pageSha256:last.sha256,
                reconciledFromCommittedPage:true,updatedAt:new Date().toISOString()}));
              return edition(editionId,{records:false});
            }
            return e;
          }
          if(shouldContinue&&!(await shouldContinue(e)))return e;
          const request={entity:e.query.entity,parameters:{...e.query.parameters,cursor:e.coverage.nextCursor}};
          const index=e.pages.length+1,intentId='research-'+digest(canonical({editionId,query:e.query.sha256,index,request})).slice(0,56);
          const at=new Date().toISOString(),previous=e.pending;
          const attempt={schema:'stellar-forge.research-retrieval.v1',editionId,index,intentId,request,
            requestSha256:digest(canonical(request)),state:'FETCHING',attempts:previous?.index===index?(previous.attempts??0)+1:1,startedAt:previous?.index===index?previous.startedAt:at,updatedAt:at};
          await serial(()=>writeJson(join(folder,'pending.json'),attempt));
          const result=await fetchPage({request,intentId,index,signal,edition:e.record});
          check(plain(result)&&result.bytes instanceof Uint8Array,'FETCHED_PAGE_BYTES_REQUIRED');
          const received=await receivePage({editionId,request,responseBytes:Buffer.from(result.bytes),source:result.source,nativeRecord:result.nativeRecord??null});
          fetched++;
          await serial(()=>writeJson(join(folder,'pending.json'),{...attempt,state:received.edition.coverage.state==='COMPLETE'?'COMPLETE':'PAGE_RECEIVED',
            pageSha256:received.page.sha256,updatedAt:new Date().toISOString()}));
          if(onPage)await onPage(received);
        }
        return edition(editionId,{records:false});
      }catch(error){
        let previous={editionId};try{previous=await readJson(join(folder,'pending.json'),262144);}catch{}
        await serial(()=>writeJson(join(folder,'pending.json'),{...previous,state:'INTERRUPTED',updatedAt:new Date().toISOString(),
          error:{code:typeof error.code==='string'?error.code:'RETRIEVAL_FAILED',message:error.message??'The current page could not be received.'}})).catch(()=>{});
        throw error;
      }
    });
  }
  async function compare(beforeId,afterId){
    const [before,after]=await Promise.all([edition(beforeId),edition(afterId)]);
    check(before.query.entity===after.query.entity,'COMPARISON_ENTITY_MISMATCH');
    return {before:{record:before.record,query:before.query,coverage:before.coverage},after:{record:after.record,query:after.query,coverage:after.coverage},
      comparison:compareResearch(before.records,after.records,{entity:before.query.entity})};
  }
  async function report(id,{compareWith}={}){
    const e=await edition(id),comparison=compareWith?(await compare(compareWith,id)).comparison:null;
    return renderResearchReport({title:e.record.label,query:e.query,coverage:e.coverage,analysis:e.analysis,comparison});
  }
  async function frozenPageBytes(directory,p,name){
    check(['response.json','request.json','page.json','buyer-result.json'].includes(name),'PAGE_FILE_INVALID');
    if(name==='buyer-result.json')check(p.nativeSha256,'NATIVE_RECORD_NOT_INDEXED','This source page has no retained native buyer result.',404);
    const bytes=await readBytes(join(directory,name),name==='response.json'?MAX_PAGE_BYTES:name==='buyer-result.json'?4194304:name==='request.json'?65536:262144);
    if(name==='response.json')check(bytes.length===p.bytes&&digest(bytes)===p.sha256,'PAGE_BYTES_CHANGED');
    else if(name==='buyer-result.json')check(digest(bytes)===p.nativeSha256,'NATIVE_RECORD_CHANGED');
    else if(name==='request.json'){
      const request=parseJson(bytes);
      check(canonical(request)===canonical(p.request)&&digest(canonical(request))===p.requestSha256,'PAGE_REQUEST_CHANGED');
    }else check(canonical(parseJson(bytes))===canonical(p),'PAGE_RECORD_CHANGED');
    return bytes;
  }
  // Freeze one edition/review snapshot, then render only the files a caller consumes.
  async function prepareExport(id,{includePages=true,includeNative=true,includeAnalysis=true}={}){
    check(typeof includeAnalysis==='boolean','EXPORT_ANALYSIS_OPTION_INVALID');
    const e=await edition(id,{records:includeAnalysis});
    // Source consumers need the saved cohort, not its generated report set.
    // Validate one response at a time and preserve the full export's coverage semantics.
    if(!includeAnalysis){
      const membership=new Set();
      for(const p of e.pages){
        const directory=join(e.directory,'pages',String(p.index).padStart(8,'0'));
        const raw=await frozenPageBytes(directory,p,'response.json'),value=pageValue(raw,e.query.entity);
        check(value.results.length===p.records&&value.meta.count===p.totalReported&&value.meta.next_cursor===p.nextCursor,'PAGE_METADATA_CHANGED');
        for(const row of value.results)membership.add(row.id);
        if(p.nativeSha256){
          const nativeRaw=await frozenPageBytes(directory,p,'buyer-result.json');
          nativeOf(parseJson(nativeRaw),raw);
        }
      }
      if(e.coverage.state==='COMPLETE'&&e.coverage.reportedCounts.some(n=>n!==membership.size))
        e.coverage.warnings.push('The unique received membership differs from a provider-reported count; records were retrieved over the stated period.');
    }
    const generated=includeAnalysis?researchExportPlan(e.analysis,{title:e.record.label,query:e.query,coverage:e.coverage,decisions:e.decisions.items}):{};
    check(plain(generated),'RESEARCH_EXPORT_INVALID');
    const renderers=new Map(Object.entries(generated).map(([name,render])=>{
      check(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/.test(name)&&typeof render==='function','EXPORT_NAME_INVALID');
      return [name,()=>Buffer.from(render())];
    }));
    for(const [name,value] of Object.entries({'edition.json':e.record,'query.json':e.query,'coverage.json':e.coverage,'decisions.json':e.decisions,...(includeAnalysis?{'analysis.json':e.analysis}:{})}))
      renderers.set(name,()=>jsonBytes(value));
    if(includeAnalysis)renderers.set('report.html',()=>Buffer.from(renderResearchReport({title:e.record.label,query:e.query,coverage:e.coverage,analysis:e.analysis})));
    renderers.set('page-index.json',()=>jsonBytes({pages:e.pages}));
    if(includePages)for(const p of e.pages){
      const prefix='pages/'+String(p.index).padStart(8,'0'),directory=join(e.directory,prefix);
      renderers.set(prefix+'/response.json',()=>frozenPageBytes(directory,p,'response.json'));
      renderers.set(prefix+'/request.json',()=>frozenPageBytes(directory,p,'request.json'));
      renderers.set(prefix+'/page.json',()=>frozenPageBytes(directory,p,'page.json'));
      if(includeNative&&p.nativeSha256)renderers.set(prefix+'/buyer-result.json',()=>frozenPageBytes(directory,p,'buyer-result.json'));
    }
    const manifestBase={schema:'stellar-forge.research-export.v1',editionId:id,querySha256:e.query.sha256,decisionsRevision:e.decisions.revision};
    return {renderers,manifestBase};
  }
  async function* preparedEntries(prepared){
    const manifest={...prepared.manifestBase,files:{}};
    for(const [name,render] of prepared.renderers){
      const bytes=await render();
      manifest.files[name]={bytes:bytes.length,sha256:digest(bytes)};
      yield [name,bytes];
    }
    yield ['manifest.json',jsonBytes(manifest)];
  }
  async function* exportEntries(id,options){
    yield* preparedEntries(await prepareExport(id,options));
  }
  async function preparedManifest(prepared){
    let manifest;
    for await(const [name,bytes] of preparedEntries(prepared))
      if(name==='manifest.json')manifest=parseJson(bytes);
    return manifest;
  }
  async function exportManifest(id,options){
    return preparedManifest(await prepareExport(id,options));
  }
  async function exportFile(id,name,options){
    const prepared=await prepareExport(id,options);
    if(name==='manifest.json')return jsonBytes(await preparedManifest(prepared));
    const render=prepared.renderers.get(name);
    check(render,'EXPORT_FILE_NOT_FOUND','Choose a file from this edition export.',404);
    return render();
  }
  // Compatibility API: aggregate bytes only for callers that explicitly request them.
  async function exportFiles(id,options){
    const files={};
    for await(const [name,bytes] of exportEntries(id,options))files[name]=bytes;
    return {files,manifest:parseJson(files['manifest.json'])};
  }
  async function exportEdition(id,destination,options){
    const prepared=await prepareExport(id,options),manifest=await preparedManifest(prepared),manifestBytes=jsonBytes(manifest);
    const out=resolve(destination??join(root,'exports',id+'-'+digest(canonical(manifest)).slice(0,16)));
    check(out!==root&&!out.startsWith(join(root,'editions')+sep),'EXPORT_DESTINATION_INVALID');
    await privateDirectory(out);check(await realpath(out)===out,'EXPORT_SYMLINK_REFUSED');
    const plan={schema:'stellar-forge.research-export-plan.v1',editionId:id,manifestSha256:digest(manifestBytes)};
    await exact(join(out,'export-plan.json'),jsonBytes(plan));
    // A second bounded pass preserves the existing content-addressed path and resumable plan
    // without holding the complete export in RAM or requiring another temporary disk copy.
    for(const [name,render] of prepared.renderers){
      const bytes=await render(),expected=manifest.files[name];
      check(bytes.length===expected.bytes&&digest(bytes)===expected.sha256,'EXPORT_SOURCE_CHANGED');
      const target=join(out,name);await privateDirectory(resolve(target,'..'));await exact(target,bytes);
    }
    await exact(join(out,'manifest.json'),manifestBytes);
    return {directory:out,manifest};
  }
  async function pageBytes(id,index,name='response.json'){
    check(Number.isSafeInteger(index)&&index>0&&['response.json','request.json','page.json','buyer-result.json'].includes(name),'PAGE_FILE_INVALID');
    const e=await edition(id,{records:false}),p=e.pages[index-1];check(p,'PAGE_NOT_FOUND',undefined,404);
    const directory=join(e.directory,'pages',String(index).padStart(8,'0')),raw=await frozenPageBytes(directory,p,'response.json');
    const value=pageValue(raw,e.query.entity);
    check(value.results.length===p.records&&value.meta.count===p.totalReported&&value.meta.next_cursor===p.nextCursor,'PAGE_METADATA_CHANGED');
    let nativeRaw;
    if(p.nativeSha256){
      nativeRaw=await frozenPageBytes(directory,p,'buyer-result.json');
      nativeOf(parseJson(nativeRaw),raw);
    }
    if(name==='response.json')return raw;
    if(name==='buyer-result.json'&&nativeRaw)return nativeRaw;
    return frozenPageBytes(directory,p,name);
  }
  return {root,query,saveQuery,listQueries,createEdition,edition,listEditions,receivePage,receiveBuyerResult,receiveResultFile,
    setDecision,copyDecisions,recoverPendingPage,gatherEdition,compare,report,exportFiles,exportEntries,exportManifest,exportFile,export:exportEdition,pageBytes,
    async close(){await pending;closed=true;}};
}

/** The original SDK owns approval, signing, delivery and recovery for every purchased page. */
export function createBuyerPageFetcher({buyer,requestForPage,buyerOptions={}}){
  check(buyer&&typeof buyer.fromRequest==='function'&&typeof buyer.operation==='function'&&typeof requestForPage==='function','NATIVE_BUYER_CONFIGURATION_REQUIRED');
  return async({request,intentId,signal})=>{
    const proposed=await requestForPage(request,{intentId,signal});
    check(plain(proposed)&&proposed.method==='GET'&&typeof proposed.url==='string'&&proposed.intentId===intentId,'GENERATED_PAGE_REQUEST_INVALID');
    let operation=buyer.operation(intentId),result;
    if(await exists(operation.configPath)){
      const config=await readJson(operation.configPath);
      for(const key of ['url','method','expect'])check(canonical(config.operation[key]??null)===canonical(proposed[key]??null),'NATIVE_PAGE_REQUEST_CHANGED',undefined,409);
      // Follow only a successor explicitly prepared by the original SDK operator.
      // The logical page intent, request and edition cursor remain unchanged.
      if(typeof operation.followUnpaidContinuation==='function')operation=await operation.followUnpaidContinuation();
      result=await operation.recover();
      if(result===null){
        const state=await operation.inspect();
        check(state.state==='PREPARED','NATIVE_PAGE_RESULT_PENDING','Continue the existing buyer operation and receive its saved result.',409);
        result=await operation.execute({review:await operation.review({signal}),signal});
      }
    }else{
      operation=await buyer.fromRequest({...proposed,intentId,signal},buyerOptions);
      result=await operation.execute({review:await operation.review({signal}),signal});
    }
    const bytes=await result.bytes({limit:MAX_PAGE_BYTES,signal});
    return {bytes,nativeRecord:result.record,source:{kind:'NATIVE_BUYER_RESPONSE',url:proposed.url,
      retrievedAt:result.record.recordedAt??new Date().toISOString(),headers:result.native.responseHeaders??{}}};
  };
}
