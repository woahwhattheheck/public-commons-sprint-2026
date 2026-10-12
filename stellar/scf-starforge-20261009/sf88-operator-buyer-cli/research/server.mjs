// MIT. Private local research application over the retained edition store.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {openResearchWorkspace,requestUrl,MAX_PAGE_BYTES,ResearchError,safeId} from './workspace.mjs';
import {parseJson} from '../node/store.mjs';
import {openFeedWorkspace} from './feed/workspace.mjs';
import {handleFeedRequest} from './feed/routes.mjs';

const PUBLIC=fileURLToPath(new URL('./public/',import.meta.url));
const ASSETS={'index.html':'text/html; charset=utf-8','app.mjs':'text/javascript; charset=utf-8','feed.mjs':'text/javascript; charset=utf-8','style.css':'text/css; charset=utf-8'};
const utf8=value=>Buffer.from(JSON.stringify(value)+'\n');
const check=(condition,code,message=code,status=400)=>{if(!condition)throw new ResearchError(code,message,status);};
function number(value,fallback,min=0,max=10000000){
  if(value===null||value===undefined)return fallback;
  check(/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value))&&Number(value)>=min&&Number(value)<=max,'PAGE_RANGE_INVALID');
  return Number(value);
}
function publicError(error){
  const code=typeof error.code==='string'&&/^[A-Z0-9_]{1,120}$/.test(error.code)?error.code:'RESEARCH_OPERATION_FAILED';
  return {error:code,message:error instanceof ResearchError?error.message:code};
}
function tablePage(rows,query){
  const offset=number(query.get('offset'),0),limit=number(query.get('limit'),50,1,200),q=query.get('q')??'',sort=query.get('sort'),direction=query.get('direction')==='desc'?-1:1;
  check(q.length<=500,'SEARCH_TOO_LONG');
  const decision=query.get('decision');
  check(!decision||['include','exclude','undecided'].includes(decision),'DECISION_FILTER_INVALID');
  const reviewed=decision?rows.filter(row=>row.decision?.status===decision):rows;
  let selected=q?reviewed.filter(row=>JSON.stringify(row).toLowerCase().includes(q.toLowerCase())):reviewed;
  if(sort){
    check(/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(sort),'SORT_FIELD_INVALID');
    selected=[...selected].sort((a,b)=>{
      const av=a[sort],bv=b[sort];if(av===bv)return 0;
      if(av===null||av===undefined)return 1;if(bv===null||bv===undefined)return -1;
      return direction*(typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv)));
    });
  }
  return {offset,limit,total:selected.length,rows:selected.slice(offset,offset+limit),hasMore:offset+limit<selected.length};
}
async function body(req,max){
  const chunks=[];let length=0;
  for await(const chunk of req){length+=chunk.length;check(length<=max,'UPLOAD_SIZE_LIMIT','The uploaded data exceeds this operation limit.',413);chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function jsonBody(req,max=65536){
  check((req.headers['content-type']??'').split(';')[0]==='application/json','JSON_BODY_REQUIRED');
  const value=parseJson(await body(req,max));
  check(value&&typeof value==='object'&&!Array.isArray(value),'JSON_OBJECT_REQUIRED');return value;
}
function editionSummary(edition){
  const {tables,...analysis}=edition.analysis;
  return {record:edition.record,query:edition.query,coverage:edition.coverage,analysis,
    tables:Object.fromEntries(Object.entries(tables).map(([name,rows])=>[name,rows.length])),decisions:edition.decisions,
    pages:edition.pages,pending:edition.pending};
}
function contentType(name){
  return name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.csv')?'text/csv; charset=utf-8':
    name.endsWith('.json')?'application/json; charset=utf-8':name.endsWith('.bib')?'application/x-bibtex; charset=utf-8':
    name.endsWith('.ris')?'application/x-research-info-systems; charset=utf-8':'text/plain; charset=utf-8';
}
const CRC_TABLE=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let n=0xffffffff;for(const b of bytes)n=CRC_TABLE[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;}
/** Yield exact ZIP members with backpressure; retain only the small central directory. */
async function* zipArchive(entries){
  const central=[];let offset=0,members=0;
  for await(const [path,bytes] of entries){
    check(++members<=65535,'EXPORT_ZIP_MEMBER_LIMIT');
    check(/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(path)&&!path.includes('..')&&Buffer.isBuffer(bytes),'EXPORT_MEMBER_INVALID');
    const name=Buffer.from(path),crc=crc32(bytes),local=Buffer.alloc(30),header=Buffer.alloc(46);
    check(name.length<=65535&&bytes.length<=0xffffffff&&offset<=0xffffffff,'EXPORT_ZIP_SIZE_LIMIT');
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);local.writeUInt16LE(33,12);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
    header.writeUInt32LE(0x02014b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(20,6);header.writeUInt16LE(0x0800,8);header.writeUInt16LE(33,14);
    header.writeUInt32LE(crc,16);header.writeUInt32LE(bytes.length,20);header.writeUInt32LE(bytes.length,24);header.writeUInt16LE(name.length,28);header.writeUInt32LE(offset,42);
    central.push(header,name);offset+=local.length+name.length+bytes.length;
    yield local;yield name;
    for(let start=0;start<bytes.length;start+=65536)yield bytes.subarray(start,start+65536);
  }
  const centralBytes=central.reduce((n,b)=>n+b.length,0),end=Buffer.alloc(22);
  check(offset+centralBytes+22<=0xffffffff,'EXPORT_ZIP_SIZE_LIMIT');
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(members,8);end.writeUInt16LE(members,10);
  end.writeUInt32LE(centralBytes,12);end.writeUInt32LE(offset,16);
  yield* central;yield end;
}
async function* prependEntry(first,entries){
  try{if(!first.done)yield first.value;yield* entries;}
  finally{await entries.return?.();}
}
export async function startResearchWorkspace({workspace,port=0,retrieval=null}={}){
  check(typeof workspace==='string'&&Number.isInteger(port)&&port>=0&&port<=65535,'WORKSPACE_OPTIONS_INVALID');
  const store=await openResearchWorkspace(workspace),token=randomBytes(32).toString('hex'),cache=new Map(),jobs=new Map(),gatherStarts=new Map();
  const feed=await openFeedWorkspace(store);
  let origin,closing=false,closePromise;
  function jobState(job){return {editionId:job.editionId,state:job.state,startedAt:job.startedAt,updatedAt:job.updatedAt,pagesReceived:job.pagesReceived,
    stopRequested:job.stopRequested,coverage:job.coverage,error:job.error};}
  async function load(id){
    safeId(id);const current=await store.edition(id,{records:false}),signature=JSON.stringify([current.pages.map(p=>p.sha256),current.decisions.revision,current.pending]);
    const cached=cache.get(id);if(cached?.signature===signature)return cached.edition;
    const edition=await store.edition(id);cache.delete(id);cache.set(id,{signature,edition});
    if(cache.size>3)cache.delete(cache.keys().next().value);return edition;
  }
  async function beginGather(id,maxPages){
    if(gatherStarts.has(id))return gatherStarts.get(id);
    const starting=startGather(id,maxPages);gatherStarts.set(id,starting);
    try{return await starting;}finally{if(gatherStarts.get(id)===starting)gatherStarts.delete(id);}
  }
  async function startGather(id,maxPages){
    check(!closing,'WORKSPACE_CLOSING',undefined,503);
    check(retrieval&&typeof retrieval.fetchPage==='function','RETRIEVAL_NOT_CONFIGURED','Start this workspace with a configured merchant or original buyer profile.');
    const active=jobs.get(id);if(active?.promise&&['RUNNING','STOPPING'].includes(active.state))return jobState(active);
    const edition=await store.edition(id,{records:false});
    check(retrieval.acceptsEntity(edition.query.entity),'RETRIEVAL_ENTITY_MISMATCH','Choose an edition matching the configured research product.');
    const now=new Date().toISOString(),job={editionId:id,state:'RUNNING',startedAt:now,updatedAt:now,pagesReceived:0,stopRequested:false,coverage:edition.coverage,error:null};
    jobs.set(id,job);
    job.promise=store.gatherEdition({editionId:id,fetchPage:retrieval.fetchPage,maxPages,
      shouldContinue:()=>!job.stopRequested&&!closing,onPage:({edition:e})=>{
        job.pagesReceived++;job.updatedAt=new Date().toISOString();job.coverage=e.coverage;cache.delete(id);
      }}).then(result=>{
        job.coverage=result.coverage;job.state=result.coverage.state==='COMPLETE'?'COMPLETE':result.coverage.state==='INTERRUPTED'?'INTERRUPTED':'PAUSED';
      },error=>{job.error=publicError(error);job.state='ERROR';})
      .finally(()=>{job.updatedAt=new Date().toISOString();cache.delete(id);});
    return jobState(job);
  }
  const server=createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
    const send=(status,data,type='application/json; charset=utf-8',name=null)=>{
      const bytes=Buffer.isBuffer(data)?data:utf8(data);
      res.writeHead(status,{...headers,'Content-Type':type,'Content-Length':bytes.length,...(name?{'Content-Disposition':'attachment; filename="'+name+'"'}:{})});res.end(bytes);
    };
    try{
      check(req.headers.host===new URL(origin).host,'HOST_REFUSED','Use the workspace local address.',403);
      check(!req.headers.origin||req.headers.origin===origin,'ORIGIN_REFUSED','Use the workspace local page.',403);
      const url=new URL(req.url,origin),path=url.pathname;
      if(req.method==='GET'&&(path==='/'||Object.hasOwn(ASSETS,path.slice(1)))){
        const name=path==='/'?'index.html':path.slice(1);send(200,await readFile(join(PUBLIC,name)),ASSETS[name]);return;
      }
      const auth=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+token);
      check(auth.length===expected.length&&timingSafeEqual(auth,expected),'AUTH_REQUIRED','Open the workspace URL printed by the server.',401);
      if(req.method!=='GET')check(!closing,'WORKSPACE_CLOSING',undefined,503);
      if(await handleFeedRequest({req,res,url,send,jsonBody,tablePage,zipArchive,headers,feed}))return;
      if(req.method==='GET'&&path==='/api/state'){
        send(200,{queries:await store.listQueries(),editions:await store.listEditions(),jobs:[...jobs.values()].map(jobState),
          retrieval:retrieval?{mode:retrieval.mode,description:retrieval.description,status:await retrieval.snapshot()}:null});return;
      }
      if(req.method==='POST'&&path==='/api/queries'){send(201,await store.saveQuery(await jsonBody(req)));return;}
      let match=path.match(/^\/api\/queries\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/);
      if(req.method==='GET'&&match){send(200,await store.query(match[1]));return;}
      if(req.method==='POST'&&path==='/api/editions'){const edition=await store.createEdition(await jsonBody(req));send(201,editionSummary(edition));return;}
      match=path.match(/^\/api\/editions\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/);
      if(req.method==='GET'&&match){send(200,editionSummary(await load(match[1])));return;}
      match=path.match(/^\/api\/editions\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/tables\/([A-Za-z][A-Za-z0-9]{0,79})$/);
      if(req.method==='GET'&&match){
        const edition=await load(match[1]),rows=edition.analysis.tables[match[2]];check(Array.isArray(rows),'TABLE_NOT_FOUND',undefined,404);
        send(200,tablePage(rows,url.searchParams));return;
      }
      match=path.match(/^\/api\/editions\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/record$/);
      if(req.method==='GET'&&match){
        const edition=await load(match[1]),id=url.searchParams.get('id'),record=edition.analysis.tables.records.find(row=>row.id===id);
        check(record,'RECORD_NOT_FOUND',undefined,404);
        send(200,{record,provider:edition.records.find(row=>row.id===id),decisionsRevision:edition.decisions.revision});return;
      }
      match=path.match(/^\/api\/editions\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/decisions$/);
      if(req.method==='POST'&&match){const input=await jsonBody(req);send(200,await store.setDecision({editionId:match[1],id:input.id,decision:input.decision,expectedRevision:input.expectedRevision}));cache.delete(match[1]);return;}
      match=path.match(/^\/api\/editions\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/copy-decisions$/);
      if(req.method==='POST'&&match){const input=await jsonBody(req);send(200,await store.copyDecisions({fromEdition:input.fromEdition,toEdition:match[1],expectedRevision:input.expectedRevision}));cache.delete(match[1]);return;}
      match=path.match(/^\/api\/editions\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/gather$/);
      if(req.method==='POST'&&match){const input=await jsonBody(req);send(202,await beginGather(match[1],number(input.maxPages,Infinity,1)));return;}
      match=path.match(/^\/api\/editions\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/stop$/);
      if(req.method==='POST'&&match){
        const job=jobs.get(match[1]);check(job&&['RUNNING','STOPPING'].includes(job.state),'GATHER_NOT_RUNNING');
        job.stopRequested=true;job.state='STOPPING';send(202,jobState(job));return;
      }
      match=path.match(/^\/api\/editions\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/receive$/);
      if(req.method==='POST'&&match){
        check(!['RUNNING','STOPPING'].includes(jobs.get(match[1])?.state),'GATHER_IN_PROGRESS','Let the current retrieval finish its page before importing.',409);
        check((req.headers['content-type']??'').startsWith('multipart/form-data;'),'UPLOAD_FORM_REQUIRED');
        const form=await new Response(await body(req,MAX_PAGE_BYTES+5*1024*1024),{headers:{'content-type':req.headers['content-type']}}).formData();
        async function file(name,required=false){
          const entry=form.get(name);if(!entry||entry.size===0){check(!required,'RESPONSE_FILE_REQUIRED');return null;}
          check(typeof entry.arrayBuffer==='function','UPLOAD_FILE_INVALID');return Buffer.from(await entry.arrayBuffer());
        }
        const edition=await store.edition(match[1],{records:false}),requestFile=await file('request'),nativeFile=await file('buyerResult');
        const request=requestFile?parseJson(requestFile):{entity:edition.query.entity,parameters:{...edition.query.parameters,cursor:edition.coverage.nextCursor}};
        const sourceUrl=form.get('sourceUrl');
        const result=await store.receivePage({editionId:match[1],request,responseBytes:await file('response',true),nativeRecord:nativeFile?parseJson(nativeFile):null,
          source:{kind:'IMPORTED_RESPONSE',url:typeof sourceUrl==='string'&&sourceUrl?sourceUrl:requestUrl(request)}});
        cache.delete(match[1]);send(201,{page:result.page,coverage:result.edition.coverage,reused:result.reused});return;
      }
      if(req.method==='GET'&&path==='/api/compare'){
        const compared=await store.compare(url.searchParams.get('before'),url.searchParams.get('after')),table=url.searchParams.get('table');
        if(table){check(['added','removed','changed'].includes(table),'COMPARISON_TABLE_INVALID');send(200,tablePage(compared.comparison[table],url.searchParams));}
        else{const {added,removed,changed,...comparison}=compared.comparison;send(200,{before:compared.before,after:compared.after,comparison});}
        return;
      }
      match=path.match(/^\/api\/editions\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/pages\/([0-9]{1,8})\/(response\.json|request\.json|page\.json|buyer-result\.json)$/);
      if(req.method==='GET'&&match){send(200,await store.pageBytes(match[1],Number(match[2]),match[3]),contentType(match[3]),match[1]+'-page-'+match[2]+'-'+match[3]);return;}
      match=path.match(/^\/api\/editions\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/export-index$/);
      if(req.method==='GET'&&match){
        const manifest=await store.exportManifest(match[1],{includePages:false});
        send(200,{editionId:match[1],files:Object.entries(manifest.files).map(([name,info])=>({name,...info})),manifest});return;
      }
      match=path.match(/^\/api\/editions\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/download\/([A-Za-z0-9][A-Za-z0-9_.-]{0,120})$/);
      if(req.method==='GET'&&match){
        let data;
        if(match[2]==='report.html'&&url.searchParams.get('before'))data=Buffer.from(await store.report(match[1],{compareWith:url.searchParams.get('before')}));
        else data=await store.exportFile(match[1],match[2],{includePages:false});
        check(data,'EXPORT_FILE_NOT_FOUND',undefined,404);send(200,data,contentType(match[2]),match[2]);return;
      }
      match=path.match(/^\/api\/editions\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/bundle\.zip$/);
      if(req.method==='GET'&&match){
        const entries=store.exportEntries(match[1],{includeNative:url.searchParams.get('native')!=='0'}),first=await entries.next();
        res.writeHead(200,{...headers,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="'+match[1]+'.zip"'});
        await pipeline(Readable.from(zipArchive(prependEntry(first,entries)),{objectMode:false,highWaterMark:65536}),res);return;
      }
      match=path.match(/^\/api\/editions\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/export$/);
      if(req.method==='POST'&&match){await jsonBody(req);send(201,await store.export(match[1]));return;}
      send(404,{error:'ROUTE_NOT_FOUND',message:'This research route was not found.'});
    }catch(error){
      if(res.headersSent){res.destroy();return;}
      const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:error.code==='ENOENT'?404:400;
      send(status,publicError(error));
    }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
  try{await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',accept);});}
  catch(error){await store.close();throw error;}
  origin='http://127.0.0.1:'+server.address().port;
  return {server,store,origin,url:origin+'/#token='+token,token,
    close(){
      if(closePromise)return closePromise;closing=true;for(const job of jobs.values())job.stopRequested=true;
      closePromise=(async()=>{
        const stopped=new Promise((accept,reject)=>{server.close(error=>error?reject(error):accept());server.closeIdleConnections();});
        await Promise.allSettled([...jobs.values()].map(job=>job.promise));await stopped;await retrieval?.close();await store.close();
      })();return closePromise;
    }};
}
