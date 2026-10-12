// MIT. Sequential, retained, version-consistent Zotero Web API v3 capture.
import {SCHEMA,LIMIT,need,plain,json,sha256,clone,now,baseURL,safeCode,ZoteroError,profile as compileProfile,captureTransport} from './contracts.mjs';
import {parsePage,buildEdition} from './source.mjs';
function initialURL(profile,phase,start=0,version=null) {
  const url=new URL(baseURL(profile.library)+'/'+(phase==='collections'?'collections':'items'));
  url.searchParams.set('format',phase==='probe'?'versions':'json');
  if(phase==='probe')url.searchParams.set('since',String(version));
  else {url.searchParams.set('include','data');url.searchParams.set('limit','100');url.searchParams.set('start',String(start));}
  if(phase!=='collections'&&profile.includeTrashed)url.searchParams.set('includeTrashed','1');
  return url.href;
}
function validateURL(raw,profile,phase,version) {
  need(['collections','items','probe'].includes(phase),'ZOTERO_CAPTURE_PHASE_INVALID');
  const url=new URL(raw),expected=new URL(initialURL(profile,phase,0,version));
  need(url.origin===expected.origin&&url.pathname===expected.pathname&&!url.username&&!url.password&&!url.hash,
    'ZOTERO_REQUEST_SCOPE_CHANGED');
  const keys=[...expected.searchParams.keys()];
  need([...url.searchParams.keys()].every(k=>keys.includes(k))&&keys.every(k=>url.searchParams.getAll(k).length===1),
    'ZOTERO_REQUEST_QUERY_CHANGED');
  for(const k of keys){
    if(k==='start'){need(/^[0-9]+$/.test(url.searchParams.get(k))&&Number.isSafeInteger(Number(url.searchParams.get(k))),
      'ZOTERO_REQUEST_CURSOR_INVALID');}
    else need(url.searchParams.get(k)===expected.searchParams.get(k),'ZOTERO_REQUEST_QUERY_CHANGED');
  }
  return url.href;
}
function nextURL(link,current,profile,phase,previousStart) {
  if(!link)return null;
  const matches=[...link.matchAll(/<([^>]+)>\s*((?:;\s*[A-Za-z0-9_-]+\s*=\s*(?:"[^"]*"|[^,; ]+))*)/g)];
  const values=matches.filter(m=>/;\s*rel\s*=\s*(?:"[^"]*\bnext\b[^"]*"|next)(?:\s|;|$)/.test(m[2]));
  need(values.length<=1,'ZOTERO_NEXT_LINK_AMBIGUOUS');if(!values.length)return null;
  const next=new URL(values[0][1],current),expected=new URL(initialURL(profile,phase,0));
  need(next.origin===expected.origin&&next.pathname===expected.pathname&&!next.username&&!next.password&&!next.hash,
    'ZOTERO_NEXT_LINK_SCOPE_CHANGED');
  const allowed=new Set(['format','include','limit','start']);
  if(profile.includeTrashed&&phase==='items')allowed.add('includeTrashed');
  need([...next.searchParams.keys()].every(k=>allowed.has(k))&&
    [...allowed].every(k=>next.searchParams.getAll(k).length<=1)&&
    next.searchParams.get('format')==='json'&&next.searchParams.get('include')==='data'&&
    next.searchParams.get('limit')==='100'&&
    (phase!=='items'||!profile.includeTrashed||next.searchParams.get('includeTrashed')==='1'),
    'ZOTERO_NEXT_LINK_QUERY_CHANGED');
  const start=next.searchParams.get('start');need(/^[0-9]+$/.test(start??'')&&Number.isSafeInteger(Number(start))&&
    Number(start)>previousStart,'ZOTERO_NEXT_LINK_CURSOR_INVALID');
  return next.href;
}
function integerHeader(headers,name) {
  const v=headers.get(name);need(v!==null&&/^[0-9]+$/.test(v)&&Number.isSafeInteger(Number(v)),
    'ZOTERO_RESPONSE_HEADER_INVALID',{header:name});return Number(v);
}
function delayUntil(headers,failures) {
  let delay=0;
  const backoff=headers.get('backoff');
  if(backoff!==null){need(/^[0-9]+$/.test(backoff),'ZOTERO_BACKOFF_INVALID');delay=Math.max(delay,Number(backoff)*1000);}
  const retry=headers.get('retry-after');
  if(retry!==null){const v=/^[0-9]+$/.test(retry)?Number(retry)*1000:Date.parse(retry)-Date.now();
    need(Number.isFinite(v),'ZOTERO_RETRY_AFTER_INVALID');delay=Math.max(delay,v);}
  if(failures&&delay===0)delay=Math.min(3600000,1000*2**Math.min(failures,12));
  need(Number.isFinite(delay)&&delay<=7*86400000,'ZOTERO_BACKOFF_TOO_LONG');
  return delay>0?new Date(Date.now()+delay).toISOString():null;
}
async function responseBytes(response,limit,signal) {
  const declared=response.headers.get('content-length');
  if(declared!==null)need(/^[0-9]+$/.test(declared)&&Number(declared)<=limit,'ZOTERO_PAGE_LIMIT');
  const chunks=[];let size=0;
  try{for await(const chunk of response.body??[]){
    if(signal.aborted)throw signal.reason;
    size+=chunk.length;need(size<=limit,'ZOTERO_PAGE_LIMIT');chunks.push(Buffer.from(chunk));
  }}catch(error){await response.body?.cancel?.().catch(()=>{});throw error;}
  return Buffer.concat(chunks);
}
export function createZoteroCapturer(store,{fetchImpl=globalThis.fetch,environment=process.env,transport:declaredTransport=null}={}) {
  need(typeof fetchImpl==='function','ZOTERO_FETCH_REQUIRED');
  const transport=captureTransport(declaredTransport,{customFetch:fetchImpl!==globalThis.fetch});
  const active=new Map();let closing=false;
  function rate(){try{return store.get('rate','zotero-api').notBefore;}catch(e){if(e.code!=='ZOTERO_RECORD_NOT_FOUND')throw e;return null;}}
  function saveRate(notBefore){if(!notBefore)return;store.transaction(()=>{let old=null;try{old=store.get('rate','zotero-api');}catch(e){if(e.code!=='ZOTERO_RECORD_NOT_FOUND')throw e;}
    if(!old||Date.parse(notBefore)>Date.parse(old.notBefore))store.put('rate','zotero-api',old?.revision??0,{notBefore});});}
  const update=(id,patch)=>store.transaction(()=>{
    const current=store.get('capture',id);
    return store.put('capture',id,current.revision,{...current,...clone(typeof patch==='function'?patch(current):patch)});
  });
  async function drive(id,controller) {
    try{
      for(;;){
        let job=store.get('capture',id);
        need(sha256(json(job.transport))===sha256(json(transport)),'ZOTERO_CAPTURE_TRANSPORT_CHANGED');
        if(controller.signal.aborted||job.cancelRequested||closing){
          update(id,{status:'CANCELLED',stoppedAt:now(),lastError:null});return;
        }
        const globalWait=rate();
        const selectedWait=[job.notBefore,globalWait].filter(Boolean).sort().at(-1)??null;
        if(selectedWait&&Date.parse(selectedWait)>Date.now()){
          update(id,{status:'WAITING',notBefore:selectedWait});return;
        }
        if(job.status==='COMPLETE'||job.status==='SOURCE_CHANGED')return;
        const p=compileProfile(job.profile),url=validateURL(job.nextURL??initialURL(p,job.phase,0,job.libraryVersion),p,job.phase,job.libraryVersion);
        const headers={'Accept':'application/json','Zotero-API-Version':'3'};
        if(p.apiKeyEnv){
          const value=environment[p.apiKeyEnv];need(typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\r\n]/.test(value),
            'ZOTERO_API_KEY_ENV_MISSING',{environment:p.apiKeyEnv});
          headers['Zotero-API-Key']=value;
        }
        update(id,{status:'RUNNING',lastError:null,notBefore:null,currentURL:url});
        const timeout=AbortSignal.timeout(p.timeoutMs),signal=AbortSignal.any([controller.signal,timeout]);
        let response;
        try{response=await fetchImpl(url,{method:'GET',headers,redirect:'error',signal,cache:'no-store'});}
        catch(error){
          if(controller.signal.aborted||closing){update(id,{status:'CANCELLED',stoppedAt:now()});return;}
          const failures=job.failures+1;
          update(id,{status:'WAITING',failures,lastError:timeout.aborted?'ZOTERO_REQUEST_TIMEOUT':'ZOTERO_NETWORK_INTERRUPTED',
            notBefore:new Date(Date.now()+Math.min(3600000,1000*2**Math.min(failures,12))).toISOString()});return;
        }
        if(response.status!==200){
          await response.body?.cancel?.().catch(()=>{});
          const failures=job.failures+1,retry=[429,500,502,503,504].includes(response.status);
          const notBefore=retry?delayUntil(response.headers,failures):delayUntil(response.headers,0);saveRate(notBefore);
          update(id,{status:retry?'WAITING':'ERROR',httpStatus:response.status,failures,
            lastError:'ZOTERO_HTTP_'+response.status,notBefore});return;
        }
        const bytes=await responseBytes(response,p.maxPageBytes,signal);
        const object=await store.putObject(bytes);let rows,version;
        try{need(response.headers.get('zotero-api-version')==='3','ZOTERO_API_VERSION_MISMATCH');
          version=integerHeader(response.headers,'last-modified-version');
          saveRate(delayUntil(response.headers,0));rows=parsePage(bytes,{kind:job.phase,library:p.library});}catch(error){update(id,current=>({status:'ERROR',lastError:safeCode(error),
          rejectedDocuments:[...(current.rejectedDocuments??[]),{name:'rejected-'+Date.now()+'.json',kind:job.phase,object,sourceReference:url,receivedAt:now()}]}));return;}
        job=store.get('capture',id);
        const sequence=job.documents.length+1;
        need(sequence<=LIMIT.pages&&job.totalBytes+bytes.length<=p.maxCaptureBytes,'ZOTERO_CAPTURE_BYTES_LIMIT');
        const sourceHeaders={apiVersion:'3',lastModifiedVersion:version};
        if(response.headers.has('total-results'))sourceHeaders.totalResults=integerHeader(response.headers,'total-results');
        if(response.headers.has('link'))sourceHeaders.link=response.headers.get('link');
        if(response.headers.has('backoff'))sourceHeaders.backoff=response.headers.get('backoff');
        const document={name:String(job.attempt).padStart(3,'0')+'-'+String(sequence).padStart(5,'0')+'-'+job.phase+'.json',
          kind:job.phase,object,sourceReference:url,headers:sourceHeaders,receivedAt:now()};
        const documents=[...job.documents,document],totalBytes=job.totalBytes+bytes.length;
        const selectedVersion=job.libraryVersion??version;
        if(version!==selectedVersion){
          update(id,{status:'SOURCE_CHANGED',documents,totalBytes,observedVersion:version,
            lastError:'ZOTERO_LIBRARY_CHANGED_DURING_CAPTURE',finishedAt:now()});return;
        }
        if(job.phase==='probe'){
          if(Object.keys(rows).length){update(id,{status:'SOURCE_CHANGED',documents,totalBytes,observedVersion:version,
            lastError:'ZOTERO_LIBRARY_CHANGED_DURING_CAPTURE',finishedAt:now()});return;}
          const original=[];
          for(const d of documents)original.push({...d,bytes:await store.objectBytes(d.object)});
          const edition=buildEdition({profile:p,documents:original,
            coverage:{mode:transport.mode==='zotero-web-api-v3'?'CAPTURED_LIBRARY':'CAPTURED_PROTOCOL_EXERCISE',transport,
              complete:true,libraryVersion:selectedVersion,finalVersion:version,
              itemCount:job.counts.items,collectionCount:job.counts.collections,includeTrashed:p.includeTrashed,
              endpoint:baseURL(p.library),apiVersion:3},
            createdAt:now(),captureId:id,attempt:job.attempt});
          const editionBody=await store.putObject(json(edition));
          store.transaction(()=>{
            const current=store.get('capture',id);
            need(current.attempt===job.attempt,'ZOTERO_CAPTURE_ATTEMPT_CHANGED');
            if(controller.signal.aborted||closing||current.cancelRequested){
              store.put('capture',id,current.revision,{...current,status:'CANCELLED',documents,totalBytes,
                libraryVersion:selectedVersion,stoppedAt:now(),lastError:null});
              return;
            }
            let existing=null;try{existing=store.get('edition',edition.id);}catch(e){if(e.code!=='ZOTERO_RECORD_NOT_FOUND')throw e;}
            if(!existing)store.put('edition',edition.id,0,{schema:SCHEMA.edition,body:editionBody,counts:edition.counts,
              library:edition.library,coverage:edition.coverage,label:edition.label,documents:documents.map(d=>({name:d.name,object:d.object})),
              profileId:current.profileId,profileRevision:current.profileRevision,createdAt:edition.createdAt});
            store.put('capture',id,current.revision,{...current,status:'COMPLETE',documents,totalBytes,
              libraryVersion:selectedVersion,editionId:edition.id,phase:'complete',currentURL:null,nextURL:null,
              notBefore:null,finishedAt:now(),lastError:null});
          });return;
        }
        const count=rows.length,total=integerHeader(response.headers,'total-results');
        need(total<=p.maxItems,'ZOTERO_ITEM_LIMIT');
        const previous=job.counts[job.phase],expected=job.totals[job.phase];
        need(expected===null||expected===total,'ZOTERO_PAGE_TOTAL_CHANGED');
        const start=Number(new URL(url).searchParams.get('start')??0);
        need(start===previous,'ZOTERO_PAGE_OFFSET_MISMATCH');
        const next=nextURL(response.headers.get('link'),url,p,job.phase,start);
        need(previous+count<=total&&((next!==null&&count>0&&previous+count<total)||(!next&&previous+count===total)),
          'ZOTERO_PAGINATION_INCOMPLETE');
        if(next)need(Number(new URL(next).searchParams.get('start'))===previous+count,'ZOTERO_PAGE_OFFSET_MISMATCH');
        const counts={...job.counts,[job.phase]:previous+count},totals={...job.totals,[job.phase]:total};
        const phase=next?job.phase:(job.phase==='collections'?'items':'probe');
        const wait=delayUntil(response.headers,0);saveRate(wait);
        update(id,{documents,totalBytes,counts,totals,phase,libraryVersion:selectedVersion,
          nextURL:next??initialURL(p,phase,0,selectedVersion),currentURL:null,failures:0,
          status:wait?'WAITING':'RUNNING',notBefore:wait,httpStatus:200});
        if(wait)return;
      }
    }catch(error){
      if(controller.signal.aborted||closing)update(id,{status:'CANCELLED',stoppedAt:now(),lastError:null});
      else update(id,{status:error.code==='ZOTERO_LIBRARY_CHANGED_DURING_CAPTURE'?'SOURCE_CHANGED':'ERROR',
        lastError:safeCode(error),finishedAt:now()});
    }
  }
  function start(id,{attempt=null}={}) {
    need(!closing,'ZOTERO_WORKSPACE_CLOSING');
    if(active.has(id))return {active:true,reused:true};
    if(active.size)return {active:false,reused:false,status:'QUEUED',blockingCaptureId:active.keys().next().value};
    const job=store.get('capture',id);
    need(sha256(json(job.transport))===sha256(json(transport)),'ZOTERO_CAPTURE_TRANSPORT_CHANGED');
    if(attempt!==null&&job.attempt!==attempt)return {active:active.has(id),reused:true,effectReconciled:true};
    if(job.status==='COMPLETE'||job.status==='SOURCE_CHANGED')return {active:false,reused:true,status:job.status};
    const wait=[job.notBefore,rate()].filter(Boolean).sort().at(-1)??null;
    if(wait&&Date.parse(wait)>Date.now())return {active:false,reused:true,status:'WAITING',notBefore:wait};
    const controller=new AbortController();
    const entry={controller,promise:null,attempt:job.attempt};
    active.set(id,entry);
    entry.promise=Promise.resolve().then(()=>drive(id,controller)).finally(()=>active.delete(id));
    return {active:true,reused:false};
  }
  function cancel(id,{attempt=null}={}) {const entry=active.get(id);if(entry&&(attempt===null||entry.attempt===attempt))entry.controller.abort(new ZoteroError('ZOTERO_CAPTURE_CANCELLED'));}
  async function wait(id) {await active.get(id)?.promise;return store.get('capture',id);}
  function live(id) {return active.has(id);}
  async function close() {
    if(closing){await Promise.allSettled([...active.values()].map(v=>v.promise));return;}
    closing=true;for(const v of active.values())v.controller.abort(new ZoteroError('ZOTERO_WORKSPACE_CLOSING'));
    const results=await Promise.allSettled([...active.values()].map(v=>v.promise));
    const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);
    if(errors.length)throw new AggregateError(errors,'ZOTERO_CAPTURE_CLOSE_FAILED');
  }
  return {start,cancel,wait,live,close,transport};
}
export function newCapture(profileRecord,transport=captureTransport(null)) {
  return {schema:SCHEMA.capture,transport:clone(transport),profile:clone(profileRecord),profileId:profileRecord.id,
    profileRevision:profileRecord.revision,profileSha256:sha256(json(profileRecord)),
    attempt:1,attempts:[],status:'PREPARED',phase:'collections',nextURL:null,currentURL:null,
    libraryVersion:null,documents:[],totalBytes:0,counts:{items:0,collections:0},
    totals:{items:null,collections:null},failures:0,notBefore:null,cancelRequested:false,
    startedAt:now(),finishedAt:null,lastError:null,editionId:null};
}
export function restartCaptureState(job) {
  return {...newCapture(job.profile,job.transport),attempt:job.attempt+1,attempts:[...job.attempts,{
    attempt:job.attempt,status:job.status,documents:job.documents,totalBytes:job.totalBytes,
    libraryVersion:job.libraryVersion,counts:job.counts,lastError:job.lastError,startedAt:job.startedAt,
    finishedAt:job.finishedAt??now()}]};
}
