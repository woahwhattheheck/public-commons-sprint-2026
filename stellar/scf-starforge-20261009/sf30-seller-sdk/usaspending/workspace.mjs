// MIT. Persistent award-research workspace. Node 22.13+ with node:sqlite.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { VERSION, SEARCH_PATH, ORIGIN, COLUMNS, requireThat, plain, canonical, sha, copy, now, id, string, integer, queryDefinition, sourceFilters, searchRequest, sourceJSON, normalizeAward, publicRow, compareRows, addDecimals, decimal, awardKey } from './core.mjs';
import { USAspendingClient } from './transport.mjs';

function processIdentity(pid=process.pid) {
  try { const s=readFileSync('/proc/'+pid+'/stat','utf8'); return String(pid)+':'+s.slice(s.lastIndexOf(')')+2).split(' ')[19]; }
  catch { try{process.kill(pid,0);return String(pid)+':alive';}catch{return null;} }
}
const JSON_KEYS=['data','definition','continuation','error','owner','meta','row'];
const decode = r => !r ? null : Object.fromEntries(Object.entries(r).map(([k,v])=>[k,JSON_KEYS.includes(k)&&v!==null?JSON.parse(v):v]));
const SCHEMA = [
 'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;',
 'CREATE TABLE IF NOT EXISTS workspace_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);',
 'CREATE TABLE IF NOT EXISTS queries(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, definition TEXT NOT NULL);',
 'CREATE TABLE IF NOT EXISTS captures(id TEXT PRIMARY KEY, query_id TEXT, query_revision INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, definition TEXT NOT NULL, request_sha256 TEXT NOT NULL, next_page INTEGER NOT NULL DEFAULT 1, continuation TEXT NOT NULL DEFAULT "{}", page_count INTEGER NOT NULL DEFAULT 0, row_count INTEGER NOT NULL DEFAULT 0, duplicate_count INTEGER NOT NULL DEFAULT 0, owner TEXT, error TEXT, edition_id TEXT);',
 'CREATE TABLE IF NOT EXISTS source_pages(capture_id TEXT NOT NULL REFERENCES captures(id), page INTEGER NOT NULL, request TEXT NOT NULL, receipt TEXT NOT NULL, response BLOB NOT NULL, response_sha256 TEXT NOT NULL, PRIMARY KEY(capture_id,page));',
 'CREATE TABLE IF NOT EXISTS capture_rows(capture_id TEXT NOT NULL REFERENCES captures(id), award_key TEXT NOT NULL, position INTEGER NOT NULL, data TEXT NOT NULL, record_sha256 TEXT NOT NULL, PRIMARY KEY(capture_id,award_key));',
 'CREATE TABLE IF NOT EXISTS editions(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, kind TEXT NOT NULL, parent_id TEXT, capture_id TEXT, row_count INTEGER NOT NULL, sha256 TEXT NOT NULL, meta TEXT NOT NULL);',
 'CREATE TABLE IF NOT EXISTS edition_rows(edition_id TEXT NOT NULL REFERENCES editions(id), award_key TEXT NOT NULL, position INTEGER NOT NULL, recipient TEXT, agency TEXT, naics TEXT, psc TEXT, date_end TEXT, data TEXT NOT NULL, PRIMARY KEY(edition_id,award_key));',
 'CREATE INDEX IF NOT EXISTS edition_order ON edition_rows(edition_id,position);',
 'CREATE INDEX IF NOT EXISTS edition_recipient ON edition_rows(edition_id,recipient);',
 'CREATE TABLE IF NOT EXISTS details(id TEXT PRIMARY KEY, award_key TEXT NOT NULL, observed_at TEXT NOT NULL, receipt TEXT NOT NULL, response BLOB NOT NULL, sha256 TEXT NOT NULL);',
 'CREATE TABLE IF NOT EXISTS reviews(award_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, edition_id TEXT NOT NULL, row_sha256 TEXT NOT NULL, updated_at TEXT NOT NULL, operator TEXT NOT NULL, data TEXT NOT NULL);',
 'CREATE TABLE IF NOT EXISTS review_history(id INTEGER PRIMARY KEY AUTOINCREMENT, award_key TEXT NOT NULL, revision INTEGER NOT NULL, at TEXT NOT NULL, operator TEXT NOT NULL, data TEXT NOT NULL);',
 'CREATE TABLE IF NOT EXISTS operations(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, operator TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL, data TEXT NOT NULL);',
 'CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY, edition_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);',
 'CREATE TABLE IF NOT EXISTS native_deliveries(edition_id TEXT PRIMARY KEY REFERENCES editions(id), data TEXT NOT NULL);',
 'CREATE TABLE IF NOT EXISTS imports(digest TEXT PRIMARY KEY, imported_at TEXT NOT NULL, data TEXT NOT NULL);'
].join('\n');
const PUBLIC_REVIEW_FIELDS=['status','fit','workshare','deliverables','acceptance','constraints','feeUsd','durationDays','primeContact','businessFitUrls','owner','caseUrl','notes','nextAction','nextActionDate'];
const REVIEW_STATUSES=['researching','shortlisted','workshare_prepared','owner_contact','passed','archived'];


function nativeArchiveBinding(sourceArchive,manifest,rows){
  requireThat(plain(sourceArchive)&&typeof sourceArchive.manifestBase64==='string'&&Array.isArray(sourceArchive.archives),'NATIVE_ARCHIVE_REQUIRED');
  const manifestBytes=Buffer.from(sourceArchive.manifestBase64,'base64');
  requireThat(manifestBytes.length===sourceArchive.manifestBytes&&sha(manifestBytes)===sourceArchive.manifestSha256&&canonical(JSON.parse(manifestBytes.toString('utf8')))===canonical(manifest),'NATIVE_MANIFEST_BINDING_MISMATCH');
  requireThat(sourceArchive.chainDigest===manifest.chainDigest&&sourceArchive.archives.length===manifest.sourcePages.length,'NATIVE_CHAIN_BINDING_MISMATCH');
  let previous=null;const receivedRows=[];
  for(let i=0;i<sourceArchive.archives.length;i++){
    const archive=sourceArchive.archives[i],expected=manifest.sourcePages[i],bytes=Buffer.from(archive.bytesBase64,'base64');
    requireThat(bytes.length===archive.bytes&&sha(bytes)===archive.sha256&&archive.index===expected.index&&archive.intent===expected.intent&&archive.sourceSha256===expected.sourceSha256&&archive.evidenceSha256===expected.evidenceSha256&&archive.recordDigest===expected.recordDigest,'NATIVE_ARCHIVE_BINDING_MISMATCH');
    const parsed=JSON.parse(bytes.toString('utf8')),{chain,...record}=parsed;
    requireThat(parsed.schema==='stellar-forge.buyer-page-archive.v1'&&chain===sha(JSON.stringify(record))&&parsed.previous===previous&&parsed.index===expected.index&&parsed.intent===expected.intent&&parsed.sourceSha256===expected.sourceSha256&&parsed.evidenceSha256===expected.evidenceSha256&&chain===expected.recordDigest,'NATIVE_ARCHIVE_CHAIN_MISMATCH');
    requireThat(plain(parsed.payload)&&Array.isArray(parsed.payload.rows)&&parsed.payload.rows.length===expected.rows&&parsed.requestCursor===expected.requestedCursor,'NATIVE_ARCHIVE_PAGE_MISMATCH');
    receivedRows.push(...parsed.payload.rows);previous=chain;
  }
  requireThat(previous===manifest.chainDigest&&canonical(receivedRows)===canonical(rows),'NATIVE_ARCHIVE_ROWS_MISMATCH');return sourceArchive;
}

export class AwardWorkspace {
  constructor(directory,{operator='Local operator'}={}) {
    this.directory=resolve(directory);this.operator=string(operator,'Operator',200);
    mkdirSync(this.directory,{recursive:true,mode:0o700});chmodSync(this.directory,0o700);
    this.db=new DatabaseSync(join(this.directory,'awards.sqlite3'));this.db.exec(SCHEMA);chmodSync(join(this.directory,'awards.sqlite3'),0o600);
    this.active=new Map();this.client=new USAspendingClient();this.instance=randomUUID();this.identity=processIdentity();
    this.db.prepare('INSERT OR IGNORE INTO workspace_meta(key,value) VALUES(?,?)').run('id','WR-'+randomUUID());
    this.db.prepare('INSERT OR IGNORE INTO workspace_meta(key,value) VALUES(?,?)').run('schema',VERSION);
    requireThat(this.db.prepare('SELECT value FROM workspace_meta WHERE key=?').get('schema').value===VERSION,'WORKSPACE_SCHEMA_UNSUPPORTED');
  }
  close(){requireThat(this.active.size===0,'OPERATIONS_ACTIVE','Stop or finish active provider operations before closing',409);this.db.close();}
  tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  operation(action,subject,data={}){this.db.prepare('INSERT INTO operations(at,operator,action,subject,data) VALUES(?,?,?,?,?)').run(now(),this.operator,action,subject,canonical(data));}
  state(){
    return {schema:VERSION,id:this.db.prepare('SELECT value FROM workspace_meta WHERE key=?').get('id').value,
      queries:this.db.prepare('SELECT * FROM queries ORDER BY updated_at DESC').all().map(decode),
      captures:this.db.prepare('SELECT * FROM captures ORDER BY created_at DESC').all().map(decode),
      editions:this.db.prepare('SELECT * FROM editions ORDER BY created_at DESC').all().map(decode),
      reviews:this.db.prepare('SELECT * FROM reviews ORDER BY updated_at DESC').all().map(decode),
      publications:this.db.prepare('SELECT * FROM publications ORDER BY created_at DESC').all().map(decode),
      active:[...this.active.keys()],reviewStatuses:REVIEW_STATUSES,columns:COLUMNS,
      operationCount:this.db.prepare('SELECT count(*) AS count FROM operations').get().count};
  }
  saveQuery({queryId,expectedRevision=0,definition}){
    const q=queryDefinition(definition),qid=queryId?id(queryId):'Q-'+randomUUID();
    return this.tx(()=>{
      const old=this.db.prepare('SELECT * FROM queries WHERE id=?').get(qid);
      requireThat((old?.revision??0)===expectedRevision,'REVISION_CONFLICT','Query changed; reopen and review the current definition',409);
      const rev=expectedRevision+1,at=now();
      this.db.prepare('INSERT INTO queries VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at,definition=excluded.definition').run(qid,rev,old?.created_at??at,at,canonical(q));
      this.operation('query_saved',qid,{revision:rev,definition:q});return decode(this.db.prepare('SELECT * FROM queries WHERE id=?').get(qid));
    });
  }
  query(qid){const q=decode(this.db.prepare('SELECT * FROM queries WHERE id=?').get(id(qid)));requireThat(q,'QUERY_NOT_FOUND',undefined,404);return q;}
  captureRecord(cid){const c=decode(this.db.prepare('SELECT * FROM captures WHERE id=?').get(id(cid)));requireThat(c,'CAPTURE_NOT_FOUND',undefined,404);return c;}
  beginCapture({queryId,queryRevision,captureId}){
    return this.tx(()=>{
      if(captureId){
        const c=this.captureRecord(captureId);requireThat(!c.edition_id,'CAPTURE_COMPLETE','This capture is already a complete edition',409);
        if(c.owner){const same=processIdentity(c.owner.pid);requireThat(!same||same!==c.owner.processIdentity,'CAPTURE_ACTIVE','The original capture process is still running',409);}
        requireThat(!c.error?.retryAt||Date.parse(c.error.retryAt)<=Date.now(),'PROVIDER_RETRY_PENDING','Resume after '+c.error?.retryAt,429);
        this.db.prepare('UPDATE captures SET status=?,updated_at=?,owner=?,error=NULL WHERE id=?').run('capturing',now(),canonical({pid:process.pid,processIdentity:this.identity,instance:this.instance}),c.id);return this.captureRecord(c.id);
      }
      const q=this.query(queryId);requireThat(q.revision===queryRevision,'REVISION_CONFLICT','Review the current query revision before capture',409);
      const cid='C-'+randomUUID(),at=now(),sourceRequest=searchRequest(q.definition);delete sourceRequest.page;const requestHash=sha(sourceRequest);
      this.db.prepare('INSERT INTO captures(id,query_id,query_revision,created_at,updated_at,status,definition,request_sha256,owner) VALUES(?,?,?,?,?,?,?,?,?)').run(cid,q.id,q.revision,at,at,'capturing',canonical(q.definition),requestHash,canonical({pid:process.pid,processIdentity:this.identity,instance:this.instance}));
      this.operation('capture_started',cid,{queryId:q.id,queryRevision:q.revision});return this.captureRecord(cid);
    });
  }
  async runCapture(options,{signal}={}){
    const pending=options.captureId?this.captureRecord(options.captureId).error:null;
    const c=this.beginCapture(options),cid=c.id;let retained=pending?.receipt?.status===200&&pending?.responseBase64?pending:null;requireThat(!this.active.has(cid),'CAPTURE_ACTIVE',undefined,409);
    const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);signal?.addEventListener('abort',cancel,{once:true});this.active.set(cid,controller);
    try{
      while(true){
        controller.signal.throwIfAborted();
        const current=this.captureRecord(cid),first=this.db.prepare('SELECT request FROM source_pages WHERE capture_id=? ORDER BY page LIMIT 1').get(cid);
        const request=first?JSON.parse(first.request):searchRequest(current.definition);
        request.page=current.next_page;delete request.last_record_unique_id;delete request.last_record_sort_value;
        const continuing=searchRequest(current.definition,current.next_page,current.continuation);for(const k of ['last_record_unique_id','last_record_sort_value'])if(Object.hasOwn(continuing,k))request[k]=continuing[k];
        const response=retained?{bytes:Buffer.from(retained.responseBase64,'base64'),receipt:retained.receipt}:await this.client.search(request,{signal:controller.signal});
        const originalRequest=retained?response.receipt.request.body:request;retained=null;
        let result;try{result=this.acceptPage(cid,{request:originalRequest,response:response.bytes,receipt:response.receipt});}catch(error){throw Object.assign(error,{receipt:response.receipt,responseBase64:response.bytes.toString('base64')});}
        if(result.complete)return result;
      }
    }catch(error){
      this.tx(()=>{this.db.prepare('UPDATE captures SET status=?,updated_at=?,owner=NULL,error=? WHERE id=?').run(controller.signal.aborted?'paused':'error',now(),canonical({code:error.code??'CAPTURE_FAILED',message:error.message,providerStatus:error.providerStatus??null,retryAt:error.retryAt??null,receipt:error.receipt??null,responseBase64:error.responseBase64??null}),cid);this.operation('capture_interrupted',cid,{code:error.code??'CAPTURE_FAILED',message:error.message});});
      throw Object.assign(error,{captureId:cid});
    }finally{signal?.removeEventListener('abort',cancel);this.active.delete(cid);}
  }
  cancel(cid){id(cid);const controller=this.active.get(cid);requireThat(controller,'ACTIVE_CAPTURE_NOT_IN_THIS_PROCESS',undefined,409);controller.abort(new Error('Operator paused the original capture'));return {captureId:cid,status:'pausing'};}
  resizeCapture({captureId,maxRows,expectedUpdatedAt}){
    integer(maxRows,'Capture row capacity',1,250000);
    return this.tx(()=>{const c=this.captureRecord(captureId);requireThat(!c.edition_id&&!this.active.has(c.id),'CAPTURE_ACTIVE_OR_COMPLETE',undefined,409);
      if(c.owner)requireThat(processIdentity(c.owner.pid)!==c.owner.processIdentity,'CAPTURE_ACTIVE',undefined,409);
      requireThat(c.updated_at===expectedUpdatedAt,'REVISION_CONFLICT','Capture changed; review its current capacity',409);
      requireThat(maxRows>=c.row_count,'CAPACITY_BELOW_RETAINED_ROWS');const definition={...c.definition,maxRows};
      this.db.prepare('UPDATE captures SET definition=?,status=?,updated_at=?,owner=NULL WHERE id=?').run(canonical(definition),'paused',now(),c.id);
      this.operation('capture_capacity_changed',c.id,{before:c.definition.maxRows,after:maxRows});return this.captureRecord(c.id);});
  }
  acceptPage(cid,{request,response,receipt}){
    requireThat(Buffer.isBuffer(response)||response instanceof Uint8Array,'SOURCE_BYTES_REQUIRED');
    const bytes=Buffer.from(response),value=sourceJSON(bytes),meta=value.page_metadata;
    requireThat(plain(request)&&plain(request.filters)&&Array.isArray(request.fields)&&(request.spending_level===undefined||request.spending_level==='awards')&&request.subawards===false,'PRIME_REQUEST_REQUIRED');
    requireThat(plain(value)&&Array.isArray(value.results)&&plain(meta)&&typeof meta.hasNext==='boolean','SOURCE_PAGE_INVALID');
    const page=integer(Number(meta.page),'Provider page',1,1000000);
    requireThat(page===request.page,'PAGE_IDENTITY_CONFLICT');
    requireThat(value.results.length<=request.limit,'PAGE_LENGTH_INVALID');
    requireThat(meta.hasNext===false||value.results.length>0,'EMPTY_CONTINUATION_PAGE');
    requireThat(receipt.status===200&&receipt.sha256===sha(bytes)&&receipt.bytes===bytes.length&&receipt.request?.url===ORIGIN+SEARCH_PATH,'SOURCE_RECEIPT_MISMATCH');
    const requestBytes=receipt.request.bodyBase64?Buffer.from(receipt.request.bodyBase64,'base64'):Buffer.from(canonical(request));
    requireThat(receipt.request.bodySha256===sha(requestBytes)&&canonical(JSON.parse(requestBytes.toString('utf8')))===canonical(request),'REQUEST_RECEIPT_MISMATCH');
    requireThat(typeof receipt.finishedAt==='string'&&Number.isFinite(Date.parse(receipt.finishedAt)),'SOURCE_OBSERVATION_TIME_REQUIRED');
    const rawRequest={...request};delete rawRequest.page;delete rawRequest.last_record_unique_id;delete rawRequest.last_record_sort_value;
    return this.tx(()=>{
      const c=this.captureRecord(cid),prior=this.db.prepare('SELECT response_sha256 FROM source_pages WHERE capture_id=? AND page=?').get(cid,page);
      if(prior){requireThat(prior.response_sha256===sha(bytes),'SOURCE_PAGE_CONFLICT',undefined,409);return {captureId:cid,replayed:true,complete:!!c.edition_id,editionId:c.edition_id};}
      requireThat(!c.edition_id&&page===c.next_page,'PAGE_SEQUENCE_CONFLICT',undefined,409);
      for(const k of ['last_record_unique_id','last_record_sort_value']){const wanted=c.continuation[k],actual=request[k];requireThat(wanted===undefined?(actual===undefined||actual===null):String(actual)===String(wanted),'PAGE_CONTINUATION_CONFLICT','Continue from the actual preceding provider cursor',409);}
      const previous=this.db.prepare('SELECT request FROM source_pages WHERE capture_id=? ORDER BY page LIMIT 1').get(cid);
      if(previous){const first=JSON.parse(previous.request);delete first.page;delete first.last_record_unique_id;delete first.last_record_sort_value;requireThat(canonical(first)===canonical(rawRequest),'QUERY_CHANGED_WITHIN_CAPTURE');}
      requireThat(c.row_count+value.results.length<=c.definition.maxRows,'CAPTURE_CAPACITY_REACHED','Raise the saved capture capacity explicitly or narrow the source query; all accepted pages are retained',413);
      const insert=this.db.prepare('INSERT INTO capture_rows VALUES(?,?,?,?,?)');let duplicates=0,position=this.db.prepare('SELECT count(*) AS count FROM capture_rows WHERE capture_id=?').get(cid).count;
      for(const row of value.results){
        const normalized=normalizeAward(row,{captureId:cid,observedAt:receipt.finishedAt,querySha256:c.request_sha256});
        const existing=this.db.prepare('SELECT record_sha256 FROM capture_rows WHERE capture_id=? AND award_key=?').get(cid,normalized.award_key);
        if(existing){requireThat(existing.record_sha256===normalized.source_record_sha256,'PROVIDER_ROW_CHANGED_DURING_CAPTURE','The same award changed between source pages; preserve this capture and start a fresh edition',409);duplicates++;continue;}
        insert.run(cid,normalized.award_key,position++,canonical(normalized),normalized.source_record_sha256);
      }
      this.db.prepare('INSERT INTO source_pages VALUES(?,?,?,?,?,?)').run(cid,page,canonical(request),canonical(receipt),bytes,sha(bytes));
      const continuation={};
      if(meta.last_record_unique_id!==undefined&&meta.last_record_unique_id!==null&&meta.last_record_unique_id!=='None')continuation.last_record_unique_id=meta.last_record_unique_id;
      if(meta.last_record_sort_value!==undefined&&meta.last_record_sort_value!==null&&meta.last_record_sort_value!=='None')continuation.last_record_sort_value=meta.last_record_sort_value;
      this.db.prepare('UPDATE captures SET updated_at=?,next_page=?,continuation=?,page_count=page_count+1,row_count=row_count+?,duplicate_count=duplicate_count+? WHERE id=?').run(now(),page+1,canonical(continuation),value.results.length,duplicates,cid);
      if(meta.hasNext)return {captureId:cid,complete:false,page,uniqueRows:position};
      const accepted=this.db.prepare('SELECT data FROM capture_rows WHERE capture_id=? ORDER BY position').all(cid).map(r=>JSON.parse(r.data));
      const pages=this.db.prepare('SELECT page,response_sha256,receipt FROM source_pages WHERE capture_id=? ORDER BY page').all(cid).map(p=>({page:p.page,responseSha256:p.response_sha256,receipt:JSON.parse(p.receipt)}));
      const edition=this.makeEdition({name:c.definition.name,kind:'provider_capture',captureId:cid,rows:accepted,meta:{definition:c.definition,request:rawRequest,sourcePages:pages,captureStartedAt:c.created_at,captureFinishedAt:receipt.finishedAt,duplicates:c.duplicate_count+duplicates,providerMessages:value.messages??[],completion:'hasNext:false'}});
      this.db.prepare('UPDATE captures SET status=?,updated_at=?,owner=NULL,error=NULL,edition_id=? WHERE id=?').run('complete',now(),edition.id,cid);
      this.operation('capture_completed',cid,{editionId:edition.id,pages:page,rows:accepted.length});return {captureId:cid,complete:true,editionId:edition.id,rows:accepted.length,pages:page};
    });
  }
  makeEdition({name,kind,parentId=null,captureId=null,rows,meta}){
    string(name,'Edition name',200);requireThat(Array.isArray(rows)&&rows.length<=250000,'EDITION_ROW_LIMIT');
    const keys=new Set();for(const r of rows){awardKey(r.award_key);requireThat(!keys.has(r.award_key),'EDITION_DUPLICATE_AWARD');keys.add(r.award_key);}
    const eid='E-'+randomUUID(),at=now(),digest=sha({kind,meta,rows:rows.map(r=>r.row_sha256??sha(r))});
    this.db.prepare('INSERT INTO editions VALUES(?,?,?,?,?,?,?,?,?)').run(eid,name,at,kind,parentId,captureId,rows.length,digest,canonical(meta));
    const insert=this.db.prepare('INSERT INTO edition_rows VALUES(?,?,?,?,?,?,?,?,?)');
    for(let i=0;i<rows.length;i++){const r=rows[i];insert.run(eid,r.award_key,i,r.recipient_name,r.awarding_agency,r.naics,r.psc,r.performance_end,canonical(r));}
    return this.edition(eid);
  }
  edition(eid){const value=decode(this.db.prepare('SELECT * FROM editions WHERE id=?').get(id(eid)));requireThat(value,'EDITION_NOT_FOUND',undefined,404);return value;}
  selectEdition(editionId,{awardKeys,name}){
    const source=this.edition(editionId);requireThat(Array.isArray(awardKeys)&&awardKeys.length>0&&new Set(awardKeys).size===awardKeys.length,'SELECTED_AWARDS_REQUIRED');
    const selected=new Set(awardKeys.map(awardKey)),rows=this.rows(editionId).filter(r=>selected.has(r.award_key));requireThat(rows.length===selected.size,'AWARD_NOT_IN_EDITION');
    const detailIds=(source.meta.detailIds??[]).filter(did=>selected.has(this.db.prepare('SELECT award_key FROM details WHERE id=?').get(did)?.award_key));
    return this.tx(()=>{const edition=this.makeEdition({name:name??source.name+' · selected awards',kind:'selected_view',parentId:editionId,rows,meta:{...source.meta,detailIds,selection:{sourceEditionId:editionId,awardKeys:[...selected]}}});this.operation('edition_selected',edition.id,{sourceEditionId:editionId,rows:rows.length});return edition;});
  }
  rows(eid){this.edition(eid);return this.db.prepare('SELECT data FROM edition_rows WHERE edition_id=? ORDER BY position').all(eid).map(r=>JSON.parse(r.data));}
  row(eid,key){this.edition(eid);const row=this.db.prepare('SELECT data FROM edition_rows WHERE edition_id=? AND award_key=?').get(eid,awardKey(key));requireThat(row,'AWARD_NOT_IN_EDITION',undefined,404);return JSON.parse(row.data);}
  browse(eid,{search='',recipient='',recipientUei='',agency='',naics='',psc='',endAfter='',page=1,limit=50}={}){
    this.edition(eid);integer(page,'Page',1,1000000);integer(limit,'Limit',1,250);string(search,'Search',300,true);
    const parts=['edition_id=?'],args=[eid];
    if(search){parts.push("(award_key LIKE ? ESCAPE '\\' OR recipient LIKE ? ESCAPE '\\' OR json_extract(data,'$.description') LIKE ? ESCAPE '\\')");const pattern='%'+search.replace(/[\\%_]/g,c=>'\\'+c)+'%';args.push(pattern,pattern,pattern);}
    for(const [key,value]of Object.entries({recipient,agency,naics,psc}))if(value){parts.push(key+'=?');args.push(value);}
    if(recipientUei){parts.push("json_extract(data,'$.recipient_uei')=?");args.push(recipientUei);}
    if(endAfter){requireThat(/^\d{4}-\d{2}-\d{2}$/.test(endAfter),'DATE_INVALID');parts.push('date_end>=?');args.push(endAfter);}
    const where=parts.join(' AND '),total=this.db.prepare('SELECT count(*) AS count FROM edition_rows WHERE '+where).get(...args).count;
    const rows=this.db.prepare('SELECT data FROM edition_rows WHERE '+where+' ORDER BY position LIMIT ? OFFSET ?').all(...args,limit,(page-1)*limit).map(r=>JSON.parse(r.data));
    return {edition:this.edition(eid),rows,page,limit,total,hasNext:page*limit<total};
  }
  overview(eid){
    const rows=this.rows(eid),groups=new Map();let missingAmount=0;
    for(const r of rows){const key=r.recipient_uei?'uei:'+r.recipient_uei:r.recipient_id?'recipient:'+r.recipient_id:'award:'+r.award_key;
      if(!groups.has(key))groups.set(key,{key,name:r.recipient_name,uei:r.recipient_uei,awards:[],amounts:[],agencies:new Set()});
      const g=groups.get(key);g.awards.push(r.award_key);if(r.award_amount_usd!==null)g.amounts.push(r.award_amount_usd);else missingAmount++;if(r.awarding_agency)g.agencies.add(r.awarding_agency);
    }
    return {rows:rows.length,recipients:groups.size,knownAwardAmountUsd:addDecimals(rows.map(r=>r.award_amount_usd)),missingAmount,
      groups:[...groups.values()].map(g=>({key:g.key,name:g.name,uei:g.uei,awardCount:g.awards.length,awardKeys:g.awards,knownAwardAmountUsd:addDecimals(g.amounts),agencies:[...g.agencies]}))};
  }
  compare(before,after){const a=this.edition(before),b=this.edition(after);return {beforeEdition:a,afterEdition:b,queryMatches:canonical(a.meta.request?.filters??a.meta.definition??null)===canonical(b.meta.request?.filters??b.meta.definition??null),...compareRows(this.rows(before),this.rows(after))};}
  saveReview({editionId,award_key,expectedRevision=0,review}){
    const row=this.row(editionId,award_key);requireThat(plain(review)&&Object.keys(review).every(k=>PUBLIC_REVIEW_FIELDS.includes(k)),'REVIEW_FIELDS_INVALID');
    requireThat(REVIEW_STATUSES.includes(review.status),'REVIEW_STATUS_INVALID');const value={status:review.status};
    for(const key of PUBLIC_REVIEW_FIELDS.filter(k=>k!=='status'&&k!=='businessFitUrls'))value[key]=string(review[key]??'',key,key==='notes'?12000:4000,true);
    requireThat(Array.isArray(review.businessFitUrls??[])&&(review.businessFitUrls??[]).length<=30,'FIT_SOURCES_INVALID');
    value.businessFitUrls=(review.businessFitUrls??[]).map(source=>{requireThat(plain(source),'FIT_SOURCE_INVALID');const url=new URL(string(source.url,'Source URL',2000));requireThat(url.protocol==='https:'&&!url.username&&!url.password,'SOURCE_URL_INVALID');return {url:url.href,title:string(source.title??'','Source title',500,true),observedAt:string(source.observedAt??'','Source observation time',100,true),notes:string(source.notes??'','Source notes',3000,true)};});
    if(value.feeUsd){requireThat(/^\d+(?:\.\d{1,2})?$/.test(value.feeUsd),'FEE_INVALID');value.feeUsd=decimal(value.feeUsd);}
    if(value.durationDays)requireThat(/^\d{1,4}$/.test(value.durationDays)&&Number(value.durationDays)>0,'DURATION_INVALID');
    if(['shortlisted','workshare_prepared','owner_contact'].includes(value.status))requireThat(value.fit.trim().length>0,'FIT_REASON_REQUIRED');
    if(['workshare_prepared','owner_contact'].includes(value.status))requireThat(value.workshare.trim()&&value.deliverables.trim()&&value.acceptance.trim(),'COMPLETE_WORKSHARE_REQUIRED');
    return this.tx(()=>{
      const prior=this.db.prepare('SELECT * FROM reviews WHERE award_key=?').get(award_key);requireThat((prior?.revision??0)===expectedRevision,'REVISION_CONFLICT','Another operator updated this research record',409);
      const at=now(),rev=expectedRevision+1,stored={...value,sourceEditionId:editionId,sourceRowSha256:row.row_sha256};
      this.db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?,?,?) ON CONFLICT(award_key) DO UPDATE SET revision=excluded.revision,edition_id=excluded.edition_id,row_sha256=excluded.row_sha256,updated_at=excluded.updated_at,operator=excluded.operator,data=excluded.data').run(award_key,rev,editionId,row.row_sha256,at,this.operator,canonical(stored));
      this.db.prepare('INSERT INTO review_history(award_key,revision,at,operator,data) VALUES(?,?,?,?,?)').run(award_key,rev,at,this.operator,canonical(stored));
      this.operation('research_saved',award_key,{editionId,revision:rev,status:value.status});return decode(this.db.prepare('SELECT * FROM reviews WHERE award_key=?').get(award_key));
    });
  }
  importDetail({bytes,receipt,name='Retained award detail'}){
    bytes=Buffer.from(bytes);requireThat(bytes.length<=16*1024*1024&&receipt.status===200&&receipt.sha256===sha(bytes)&&receipt.bytes===bytes.length,'SOURCE_RECEIPT_MISMATCH');
    const value=sourceJSON(bytes),key=awardKey(value.generated_unique_award_id);
    requireThat(receipt.request?.url===ORIGIN+'/api/v2/awards/'+encodeURIComponent(key)+'/'||receipt.url===ORIGIN+'/api/v2/awards/'+encodeURIComponent(key)+'/','DETAIL_SOURCE_URL_MISMATCH');
    return this.tx(()=>{
      const sourceDigest=sha(bytes),digest=sha({kind:'award_detail',sourceDigest,receipt}),prior=this.db.prepare('SELECT data FROM imports WHERE digest=?').get(digest);if(prior)return {...JSON.parse(prior.data),replayed:true};
      const detailId='D-'+randomUUID(),observedAt=receipt.finishedAt;
      this.db.prepare('INSERT INTO details VALUES(?,?,?,?,?,?)').run(detailId,key,observedAt,canonical(receipt),bytes,sourceDigest);
      const row=normalizeAward(value,{captureId:detailId,observedAt,querySha256:sha({url:receipt.request?.url??receipt.url})});
      const edition=this.makeEdition({name,kind:'award_detail',rows:[row],meta:{detailIds:[detailId],receipt}});
      const result={editionId:edition.id,detailId,rows:1};this.db.prepare('INSERT INTO imports VALUES(?,?,?)').run(digest,now(),canonical(result));this.operation('award_detail_imported',edition.id,{detailId,awardKey:key});return result;
    });
  }
  attachDetails(editionId,detailIds,{failures=[],selected=null}={}){
    const source=this.edition(editionId);requireThat(Array.isArray(detailIds)&&detailIds.length>0&&detailIds.length<=1000&&new Set(detailIds).size===detailIds.length,'DETAIL_IDENTITIES_REQUIRED');
    const records=detailIds.map(detailId=>{const d=this.db.prepare('SELECT * FROM details WHERE id=?').get(id(detailId));requireThat(d,'DETAIL_NOT_FOUND',undefined,404);return d;});
    const sourceRows=this.rows(editionId),keys=new Set(sourceRows.map(r=>r.award_key));requireThat(records.every(r=>keys.has(r.award_key)),'DETAIL_OUTSIDE_EDITION');
    requireThat(new Set(records.map(r=>r.award_key)).size===records.length,'MULTIPLE_DETAILS_FOR_SAME_AWARD','Choose one observed detail per award');
    const newKeys=new Set(records.map(d=>d.award_key)),allDetailIds=[...(source.meta.detailIds??[]).filter(did=>!newKeys.has(this.db.prepare('SELECT award_key FROM details WHERE id=?').get(did)?.award_key)),...detailIds];
    const attachmentDigest=sha({kind:'attach_details',editionId,detailIds,failures}),prior=this.db.prepare('SELECT data FROM imports WHERE digest=?').get(attachmentDigest);if(prior)return {...JSON.parse(prior.data),replayed:true};
    const gathered=records.map(d=>normalizeAward(sourceJSON(d.response),{captureId:d.id,observedAt:d.observed_at,querySha256:sha({url:JSON.parse(d.receipt).request?.url??JSON.parse(d.receipt).url})}));
    return this.tx(()=>{
      const byKey=new Map(gathered.map(row=>[row.award_key,row]));
      const rows=sourceRows.map(row=>byKey.has(row.award_key)?{...byKey.get(row.award_key),search_source:{captureId:row.capture_id,rowSha256:row.row_sha256,recordSha256:row.source_record_sha256},row_sha256:sha({detail:byKey.get(row.award_key).row_sha256,search:row.row_sha256})}:row);
      const edition=this.makeEdition({name:source.name+' · selected details',kind:'enriched_capture',parentId:editionId,rows,meta:{...source.meta,detailIds:allDetailIds,detailFailures:failures,selected:selected??records.map(r=>r.award_key),completed:records.length}});
      const result={editionId:edition.id,completed:records.length,failures};this.db.prepare('INSERT INTO imports VALUES(?,?,?)').run(attachmentDigest,now(),canonical(result));this.operation('edition_enriched',edition.id,{sourceEditionId:editionId,completed:records.length,failed:failures.length});return result;
    });
  }
  async enrich(editionId,keys,{signal}={}){
    const jobId='DETAIL-'+randomUUID(),controller=new AbortController(),abort=()=>controller.abort(signal.reason);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();this.active.set(jobId,controller);
    try{return await this.enrichSelected(editionId,keys,{signal:controller.signal});}finally{this.active.delete(jobId);signal?.removeEventListener('abort',abort);}
  }
  async enrichSelected(editionId,keys,{signal}={}){
    this.edition(editionId);requireThat(Array.isArray(keys)&&keys.length>0&&keys.length<=100&&new Set(keys).size===keys.length,'SELECTED_AWARDS_REQUIRED');
    for(const key of keys)this.row(editionId,key);
    const gathered=[],failures=[];
    for(const key of keys){
      signal?.throwIfAborted();
      try {const result=await this.client.detail(key,{signal});const saved=this.importDetail({bytes:result.bytes,receipt:result.receipt,name:'Detail '+key});gathered.push({key,...saved});}
      catch(error){failures.push({key,code:error.code??'DETAIL_FAILED',message:error.message,providerStatus:error.providerStatus??null,retryAt:error.retryAt??null,receipt:error.receipt??null});if(signal?.aborted||[401,403,429].includes(error.providerStatus))break;}
    }
    requireThat(gathered.length>0,'NO_DETAIL_CAPTURED',failures[0]?.message??'No selected detail returned',502);
    return this.attachDetails(editionId,gathered.map(g=>g.detailId),{failures,selected:keys});
  }
  importCapturedPages({name,definition,pages}){
    const q=queryDefinition({...definition,name});requireThat(Array.isArray(pages)&&pages.length>0&&pages.length<=10000,'SOURCE_PAGES_REQUIRED');
    const digest=sha(pages.map(p=>({request:p.request,receipt:p.receipt,sha256:sha(Buffer.from(p.responseBase64,'base64'))})));
    const priorRecord=this.db.prepare('SELECT data FROM imports WHERE digest=?').get(digest),prior=priorRecord?JSON.parse(priorRecord.data):null;if(prior?.editionId)return {...prior,replayed:true};
    const cid=prior?.captureId??this.tx(()=>{
      const cid='C-'+randomUUID(),at=now(),base={...pages[0].request};delete base.page;delete base.last_record_unique_id;delete base.last_record_sort_value;
      requireThat(canonical(base.filters)===canonical(sourceFilters(q)),'QUERY_DEFINITION_MISMATCH','Retained source filters must equal the reviewed query definition');
      this.db.prepare('INSERT INTO captures(id,created_at,updated_at,status,definition,request_sha256) VALUES(?,?,?,?,?,?)').run(cid,at,at,'importing',canonical(q),sha(base));
      this.db.prepare('INSERT INTO imports VALUES(?,?,?)').run(digest,at,canonical({captureId:cid,importState:'importing'}));return cid;
    });
    let result;
    try{for(const page of pages)result=this.acceptPage(cid,{request:page.request,receipt:page.receipt,response:Buffer.from(page.responseBase64,'base64')});requireThat(result.complete,'CAPTURE_INCOMPLETE','Keep the remaining source pages with this capture',409);}
    catch(error){this.db.prepare('UPDATE captures SET status=?,error=?,owner=NULL WHERE id=?').run('error',canonical({code:error.code??'IMPORT_FAILED',message:error.message}),cid);throw Object.assign(error,{captureId:cid});}
    this.tx(()=>{this.db.prepare('UPDATE imports SET imported_at=?,data=? WHERE digest=?').run(now(),canonical(result),digest);this.operation('capture_imported',cid,{sourceDigest:digest,editionId:result.editionId});});return result;
  }
  adoptBuyerRows({rows,manifest,sourcePages,sourceArchive}){
    requireThat(plain(manifest)&&manifest.schema==='stellar-forge.buyer-delivery-manifest.v1','NATIVE_DELIVERY_REQUIRED');
    requireThat(Array.isArray(rows)&&rows.length===manifest.dataset.rows,'BUYER_ROW_COUNT_MISMATCH');
    const digest=sha(manifest),prior=this.db.prepare('SELECT data FROM imports WHERE digest=?').get(digest),boundArchive=sourceArchive?nativeArchiveBinding(sourceArchive,manifest,rows):null;
    if(prior)return this.tx(()=>{const result=JSON.parse(prior.data),stored=this.db.prepare('SELECT data FROM native_deliveries WHERE edition_id=?').get(result.editionId);
      if(boundArchive){if(stored)requireThat(canonical(JSON.parse(stored.data))===canonical(boundArchive),'NATIVE_ARCHIVE_REPLAY_CONFLICT',undefined,409);else{this.db.prepare('INSERT INTO native_deliveries VALUES(?,?)').run(result.editionId,canonical(boundArchive));this.operation('native_delivery_attached',result.editionId,{manifestSha256:boundArchive.manifestSha256});}}
      return {...result,replayed:true,sourceAttached:!!boundArchive};});
    const normalized=rows.map(row=>{
      requireThat(plain(row)&&COLUMNS.every(k=>Object.hasOwn(row,k)),'COMPLETE_AWARD_PROJECTION_REQUIRED','Select the complete award projection in the original buyer');
      const out=publicRow(row);requireThat(COLUMNS.every(k=>out[k]===null||typeof out[k]==='string'),'AWARD_VALUE_TYPE_INVALID');awardKey(out.award_key);requireThat(out.source_url==='https://www.usaspending.gov/award/'+encodeURIComponent(out.award_key),'AWARD_SOURCE_URL_MISMATCH');
      for(const name of COLUMNS.filter(k=>k.endsWith('_usd')))out[name]=decimal(out[name]);
      return {...out,row_sha256:sha(out),source_kind:'original_buyer_delivery'};
    });
    return this.tx(()=>{
      const edition=this.makeEdition({name:manifest.dataset.name,kind:'buyer_delivery',rows:normalized,meta:{deliveryManifest:manifest,sourcePages}});
      if(boundArchive)this.db.prepare('INSERT INTO native_deliveries VALUES(?,?)').run(edition.id,canonical(boundArchive));
      const result={editionId:edition.id,rows:rows.length,deliverySha256:digest};this.db.prepare('INSERT INTO imports VALUES(?,?,?)').run(digest,now(),canonical(result));this.operation('buyer_delivery_adopted',edition.id,{deliverySha256:digest,rows:rows.length});return result;
    });
  }
  exportEdition(editionId,{includeSourceBytes=true,includeReviews=false}={}){
    const edition=this.edition(editionId),rows=this.rows(editionId),captureId=edition.capture_id??edition.meta.captureId??this.findCapture(editionId);
    const capture=captureId?this.captureRecord(captureId):null;
    const sourcePages=captureId?this.db.prepare('SELECT page FROM source_pages WHERE capture_id=? ORDER BY page').all(captureId).map(p=>{const s=this.sourcePage(captureId,p.page);return {captureId,page:s.page,request:s.request,receipt:s.receipt,responseSha256:s.response_sha256,...(includeSourceBytes?{responseBase64:s.response.toString('base64')}:{})};}):[];
    const details=(edition.meta.detailIds??[]).map(detailId=>{const d=this.db.prepare('SELECT * FROM details WHERE id=?').get(detailId);requireThat(d,'DETAIL_NOT_FOUND',undefined,409);return {id:d.id,awardKey:d.award_key,observedAt:d.observed_at,receipt:JSON.parse(d.receipt),sha256:d.sha256,...(includeSourceBytes?{responseBase64:Buffer.from(d.response).toString('base64')}:{})};});
    const native=this.findNativeDelivery(editionId),retainedNative=native?.data??null,receivedSource=native?this.edition(native.editionId):null;
    const receivedRows=receivedSource?this.rows(receivedSource.id):[],isReceived=!!receivedSource||!!edition.meta.deliveryManifest;
    const buyerDelivery=retainedNative?(includeSourceBytes?retainedNative:{...retainedNative,archives:retainedNative.archives.map(({bytesBase64,...archive})=>archive)}):null;
    if(buyerDelivery&&!includeSourceBytes)delete buyerDelivery.manifestBase64;
    const sourceKeys=capture?this.db.prepare('SELECT award_key FROM capture_rows WHERE capture_id=?').all(captureId).map(r=>r.award_key):[];
    const selectedKeys=new Set(rows.map(r=>r.award_key)),originalKeys=new Set(sourceKeys);
    const currentEditionCompleteCohort=capture?sourceKeys.length===selectedKeys.size&&sourceKeys.every(k=>selectedKeys.has(k)):null;
    const captureRequest=sourcePages[0]?.request??null;
    const warnings=[];if(isReceived)warnings.push('This is the finalized received query view. Original provider cohort coverage follows the source references in its award rows.');
    if(edition.meta.detailFailures?.length)warnings.push('Some selected details were not acquired; inspect detailFailures and per-row source_kind.');
    if(rows.some(r=>r.outlays_usd===null))warnings.push('Missing outlays are preserved as null and excluded from totals.');
    if(capture&&!currentEditionCompleteCohort)warnings.push('This edition contains a selection of the original captured cohort; source capture completion and edition coverage are separate.');
    const coverage={rowCount:rows.length,completeCapture:capture?capture.status==='complete'&&!!capture.edition_id:false,currentEditionCompleteCohort,
      state:capture?(currentEditionCompleteCohort?'COMPLETE_COHORT':'PARTIAL'):isReceived?(receivedRows.length&&!(receivedRows.length===rows.length&&receivedRows.every(r=>selectedKeys.has(r.award_key)))?'PARTIAL':'RECEIVED_VIEW'):'DETAIL_VIEW',
      sourcePageCount:sourcePages.length,detailedRows:rows.filter(r=>r.source_kind==='award_detail').length,missingRecipientUei:rows.filter(r=>!r.recipient_uei).length,
      missingAwardAmount:rows.filter(r=>r.award_amount_usd===null).length,missingOutlays:rows.filter(r=>r.outlays_usd===null).length,
      filters:captureRequest?.filters??null,definition:capture?.definition??null,
      firstObservedAt:sourcePages[0]?.receipt?.finishedAt??null,lastObservedAt:sourcePages.at(-1)?.receipt?.finishedAt??null,
      sourceCapture:capture?{captureId,uniqueRows:sourceKeys.length,providerRows:capture.row_count,duplicateRows:capture.duplicate_count,completed:!!capture.edition_id,pages:capture.page_count}:null,
      selection:{rows:rows.length,sourceAwardsAbsent:sourceKeys.filter(k=>!selectedKeys.has(k)).length,awardsOutsideSource:capture?rows.filter(r=>!originalKeys.has(r.award_key)).length:null},
      receivedView:isReceived?{sourceEditionId:receivedSource?.id??null,rows:edition.meta.deliveryManifest?.dataset?.rows??rows.length,currentRows:rows.length,completeView:receivedRows.length?receivedRows.length===rows.length&&receivedRows.every(r=>selectedKeys.has(r.award_key)):null,filters:edition.meta.deliveryManifest?.dataset?.filters??[],originalQueryHash:edition.meta.deliveryManifest?.dataset?.originalQueryHash??null,archiveAvailable:!!retainedNative}:null};
    const reviewedKeys=new Set(rows.map(r=>r.award_key));
    const packet={schema:VERSION+'.edition',exportedAt:now(),edition,columns:[...COLUMNS],rows,sourcePages,details,coverage,warnings,buyerDelivery,...(includeReviews?{reviews:this.state().reviews.filter(r=>reviewedKeys.has(r.award_key))}:{})};
    return {...packet,sha256:sha(packet)};
  }
  findNativeDelivery(editionId){
    const seen=new Set();let e=this.edition(editionId);
    while(e){requireThat(!seen.has(e.id),'EDITION_PARENT_CYCLE');seen.add(e.id);const row=this.db.prepare('SELECT data FROM native_deliveries WHERE edition_id=?').get(e.id);if(row)return {editionId:e.id,data:JSON.parse(row.data)};e=e.parent_id?this.edition(e.parent_id):null;}return null;
  }
  findCapture(editionId){
    const seen=new Set();let e=this.edition(editionId);
    while(e){requireThat(!seen.has(e.id),'EDITION_PARENT_CYCLE');seen.add(e.id);if(e.capture_id)return e.capture_id;e=e.parent_id?this.edition(e.parent_id):null;}return null;
  }
  recordPublication(editionId,data){this.edition(editionId);return this.tx(()=>{const pid='P-'+randomUUID();this.db.prepare('INSERT INTO publications VALUES(?,?,?,?)').run(pid,editionId,now(),canonical(data));this.operation('merchant_package_prepared',pid,{editionId,...data});return {id:pid,editionId,...data};});}
  history({award_key,limit=100}={}){integer(limit,'History limit',1,1000);return award_key?this.db.prepare('SELECT * FROM review_history WHERE award_key=? ORDER BY id DESC LIMIT ?').all(awardKey(award_key),limit).map(decode):this.db.prepare('SELECT * FROM operations ORDER BY id DESC LIMIT ?').all(limit).map(decode);}
  sourcePage(cid,page){this.captureRecord(cid);integer(page,'Page',1,1000000);const r=this.db.prepare('SELECT * FROM source_pages WHERE capture_id=? AND page=?').get(cid,page);requireThat(r,'SOURCE_PAGE_NOT_FOUND',undefined,404);return {...r,request:JSON.parse(r.request),receipt:JSON.parse(r.receipt),response:Buffer.from(r.response)};}
  exportPacket(){
    requireThat(!this.active.size,'CAPTURE_ACTIVE','Finish or pause provider capture before portable export',409);
    const tables=['workspace_meta','queries','captures','source_pages','capture_rows','editions','edition_rows','details','reviews','review_history','operations','publications','native_deliveries','imports'];
    this.db.exec('BEGIN');try{
      const data={};for(const table of tables)data[table]=this.db.prepare('SELECT * FROM '+table).all().map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v instanceof Uint8Array?{encoding:'base64',bytes:Buffer.from(v).toString('base64')}:v])));
      const value={schema:VERSION+'.backup',createdAt:now(),tables:data};this.db.exec('COMMIT');return {...value,sha256:sha(value)};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  restorePacket(packet){
    requireThat(plain(packet)&&packet.schema===VERSION+'.backup'&&plain(packet.tables),'BACKUP_SCHEMA_INVALID');const {sha256:expected,...value}=packet;requireThat(expected===sha(value),'BACKUP_DIGEST_MISMATCH');
    requireThat(this.state().queries.length===0&&this.state().editions.length===0&&this.state().captures.length===0,'RESTORE_TARGET_NOT_EMPTY','Restore into a new workspace',409);
    const allowed=['workspace_meta','queries','captures','source_pages','capture_rows','editions','edition_rows','details','reviews','review_history','operations','publications','native_deliveries','imports'];
    requireThat(Object.keys(packet.tables).length===allowed.length&&allowed.every(t=>Array.isArray(packet.tables[t])),'BACKUP_TABLES_INVALID');
    return this.tx(()=>{
      this.db.exec('DELETE FROM workspace_meta');
      for(const table of allowed){
        const columns=this.db.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name);
        const insert=this.db.prepare('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');
        for(const row of packet.tables[table]){
          requireThat(plain(row)&&Object.keys(row).length===columns.length&&columns.every(c=>Object.hasOwn(row,c)),'BACKUP_ROW_INVALID');
          const vals=columns.map(c=>plain(row[c])&&row[c].encoding==='base64'?Buffer.from(row[c].bytes,'base64'):row[c]);insert.run(...vals);
        }
      }
      requireThat(this.db.prepare('SELECT value FROM workspace_meta WHERE key=?').get('schema')?.value===VERSION,'BACKUP_SCHEMA_INVALID');
      for(const table of ['source_pages','details'])for(const row of this.db.prepare('SELECT * FROM '+table).all())requireThat(sha(Buffer.from(row.response))===(row.response_sha256??row.sha256),'BACKUP_SOURCE_DIGEST_MISMATCH');
      for(const native of this.db.prepare('SELECT data FROM native_deliveries').all()){const delivery=JSON.parse(native.data);requireThat(sha(Buffer.from(delivery.manifestBase64,'base64'))===delivery.manifestSha256,'BACKUP_NATIVE_MANIFEST_DIGEST_MISMATCH');for(const archive of delivery.archives)requireThat(sha(Buffer.from(archive.bytesBase64,'base64'))===archive.sha256,'BACKUP_NATIVE_ARCHIVE_DIGEST_MISMATCH');}
      this.db.prepare('UPDATE captures SET owner=NULL,status=CASE WHEN status=? THEN ? ELSE status END').run('capturing','paused');
      this.operation('workspace_restored',expected,{originalCreatedAt:packet.createdAt});return {restored:true,sourceSha256:expected,editions:this.db.prepare('SELECT count(*) AS count FROM editions').get().count};
    });
  }
}
