// MIT. Award transaction lifecycle within the original AwardWorkspace database.
import { randomUUID } from 'node:crypto';
import { ORIGIN, canonical, sha, now, plain, integer, id, string, date } from '../core.mjs';
import { TRANSACTION_VERSION, TRANSACTION_PATH, transactionRequest, parseTransactionPage, analyzeTransactions, compareTransactions, transactionCsv, demand } from './core.mjs';

export const TRANSACTION_TABLES=Object.freeze(['award_tx_captures','award_tx_pages','award_tx_rows','award_tx_reviews','award_tx_review_history']);
const schema=[
'CREATE TABLE IF NOT EXISTS award_tx_captures(id TEXT PRIMARY KEY, award_key TEXT NOT NULL, award_edition_id TEXT NOT NULL REFERENCES editions(id), award_row TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, request TEXT NOT NULL, next_page INTEGER NOT NULL, page_count INTEGER NOT NULL, row_count INTEGER NOT NULL, max_rows INTEGER NOT NULL, owner TEXT, error TEXT, fingerprint TEXT);',
'CREATE TABLE IF NOT EXISTS award_tx_pages(capture_id TEXT NOT NULL REFERENCES award_tx_captures(id), page INTEGER NOT NULL, request TEXT NOT NULL, receipt TEXT NOT NULL, response BLOB NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(capture_id,page));',
'CREATE TABLE IF NOT EXISTS award_tx_rows(capture_id TEXT NOT NULL REFERENCES award_tx_captures(id), position INTEGER NOT NULL, transaction_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(capture_id,position));',
'CREATE INDEX IF NOT EXISTS award_tx_identity ON award_tx_rows(capture_id,transaction_id);',
'CREATE TABLE IF NOT EXISTS award_tx_reviews(capture_id TEXT PRIMARY KEY REFERENCES award_tx_captures(id), revision INTEGER NOT NULL, updated_at TEXT NOT NULL, operator TEXT NOT NULL, data TEXT NOT NULL);',
'CREATE TABLE IF NOT EXISTS award_tx_review_history(id INTEGER PRIMARY KEY AUTOINCREMENT, capture_id TEXT NOT NULL REFERENCES award_tx_captures(id), revision INTEGER NOT NULL, at TEXT NOT NULL, operator TEXT NOT NULL, data TEXT NOT NULL);'
].join('\n');
const decoded=row=>row?Object.fromEntries(Object.entries(row).map(([key,value])=>[key,['award_row','request','owner','error','data'].includes(key)&&value!==null?JSON.parse(value):value])):null;
const reviewFields=['status','fit','fundingChange','proposedWorkshare','deliverables','acceptance','owner','caseUrl','nextAction','notes'];
export class AwardTransactions {
  constructor(workspace,{processIdentity}) { this.w=workspace;this.db=workspace.db;this.processIdentity=processIdentity;this.db.exec(schema); }
  state() { return {captures:this.db.prepare('SELECT * FROM award_tx_captures ORDER BY created_at DESC').all().map(decoded).map(({award_row,error,...c})=>({...c,recipient:award_row.recipient_name,error:error?{code:error.code,message:error.message,retryAt:error.retryAt??null}:null})),reviews:this.db.prepare('SELECT * FROM award_tx_reviews ORDER BY updated_at DESC').all().map(decoded)}; }
  capture(captureId) { const c=decoded(this.db.prepare('SELECT * FROM award_tx_captures WHERE id=?').get(id(captureId)));demand(c,'TRANSACTION_CAPTURE_NOT_FOUND',undefined,404);return c; }
  idle(c) {
    demand(!this.w.active.has(c.id),'TRANSACTION_CAPTURE_ACTIVE',undefined,409);
    if(c.owner&&!(c.owner.instance===this.w.instance&&c.owner.processIdentity===this.w.identity&&c.owner.pid===process.pid))demand(this.processIdentity(c.owner.pid)!==c.owner.processIdentity,'TRANSACTION_CAPTURE_ACTIVE','The original capture process is still running.',409);
  }
  create({editionId,awardKey,pageSize=250,maxRows=250000,captureId,sort='action_date',order='asc'}) {
    const row=this.w.row(editionId,awardKey),request=transactionRequest(awardKey,{limit:pageSize,sort,order});
    integer(maxRows,'Transaction row capacity',1,250000);
    return this.w.tx(()=>{
      const key=captureId?id(captureId):'TC-'+randomUUID();
      const existing=this.db.prepare('SELECT id FROM award_tx_captures WHERE id=?').get(key);
      if(existing) {
        const c=this.capture(key);
        demand(c.award_key===awardKey&&c.award_edition_id===editionId&&canonical(c.request)===canonical(request)&&c.award_row.row_sha256===row.row_sha256,'TRANSACTION_CAPTURE_ID_CONFLICT',undefined,409);
        return c;
      }
      const at=now();
      this.db.prepare('INSERT INTO award_tx_captures VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(key,awardKey,editionId,canonical(row),at,at,'paused',canonical(request),1,0,0,maxRows,null,null,null);
      this.w.operation('award_transactions_prepared',key,{awardKey,editionId,pageSize,maxRows});return this.capture(key);
    });
  }
  begin(options) {
    const selected=options.captureId?this.capture(options.captureId):this.create(options);
    if(selected.status==='complete')return {capture:selected,complete:true};
    return this.w.tx(()=>{
      const c=this.capture(selected.id);if(c.status==='complete')return {capture:c,complete:true};this.idle(c);
      demand(!c.error?.retryAt||Date.parse(c.error.retryAt)<=Date.now(),'TRANSACTION_PROVIDER_RETRY_PENDING','Resume after '+c.error?.retryAt,429);
      this.db.prepare('UPDATE award_tx_captures SET status=?,updated_at=?,owner=? WHERE id=?').run('capturing',now(),canonical({pid:process.pid,processIdentity:this.w.identity,instance:this.w.instance}),c.id);
      this.w.operation('award_transactions_started',c.id,{nextPage:c.next_page});return {capture:this.capture(c.id),complete:false};
    });
  }
  async run(options,{signal}={}) {
    const started=this.begin(options),c=started.capture;
    if(started.complete)return {captureId:c.id,complete:true,replayed:true,rows:c.row_count};
    const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    this.w.active.set(c.id,controller);
    let retained=c.error?.receipt?.status===200&&c.error?.responseBase64?{receipt:c.error.receipt,bytes:Buffer.from(c.error.responseBase64,'base64')}:null;
    try {
      while(true) {
        controller.signal.throwIfAborted();
        const current=this.capture(c.id),request={...current.request,page:current.next_page};
        const response=retained??await this.w.client.transactions(request,{signal:controller.signal});retained=null;
        let result;
        try { result=this.acceptPage(c.id,{request,response:response.bytes,receipt:response.receipt}); }
        catch(error) { throw Object.assign(error,{receipt:response.receipt,responseBase64:response.bytes.toString('base64')}); }
        if(result.complete)return result;
      }
    } catch(cause) {
      const error=cause instanceof Error?cause:new Error(typeof cause==='string'?cause:'Transaction capture interrupted.');
      this.w.tx(()=>{
        const errorData={code:error.code??'TRANSACTION_CAPTURE_FAILED',message:error.message,providerStatus:error.providerStatus??null,retryAt:error.retryAt??null,receipt:error.receipt??null,responseBase64:error.responseBase64??null};
        this.db.prepare('UPDATE award_tx_captures SET status=?,updated_at=?,owner=NULL,error=? WHERE id=?').run(controller.signal.aborted?'paused':'error',now(),canonical(errorData),c.id);
        this.w.operation('award_transactions_interrupted',c.id,{code:errorData.code,message:errorData.message});
      });
      throw Object.assign(error,{captureId:c.id});
    } finally { this.w.active.delete(c.id);signal?.removeEventListener('abort',abort); }
  }
  validateSource(request,bytes,receipt) {
    demand(plain(receipt)&&receipt.status===200&&receipt.bytes===bytes.length&&receipt.sha256===sha(bytes),'TRANSACTION_SOURCE_RECEIPT_MISMATCH');
    demand(receipt.request?.method==='POST'&&receipt.request.url===ORIGIN+TRANSACTION_PATH,'TRANSACTION_SOURCE_URL_MISMATCH');
    demand(!receipt.url||receipt.url===ORIGIN+TRANSACTION_PATH,'TRANSACTION_RESPONSE_URL_MISMATCH');
    const rawRequest=Buffer.from(receipt.request.bodyBase64??'','base64');
    demand(rawRequest.length>0&&sha(rawRequest)===receipt.request.bodySha256&&canonical(JSON.parse(rawRequest.toString('utf8')))===canonical(request)&&canonical(receipt.request.body)===canonical(request),'TRANSACTION_REQUEST_RECEIPT_MISMATCH');
    demand(typeof receipt.finishedAt==='string'&&Number.isFinite(Date.parse(receipt.finishedAt)),'TRANSACTION_OBSERVATION_TIME_REQUIRED');
    return parseTransactionPage(bytes,request,{sourceId:sha(bytes)});
  }
  acceptPage(captureId,{request,response,receipt}) {
    const bytes=Buffer.from(response),parsed=this.validateSource(request,bytes,receipt);
    return this.w.tx(()=>{
      const c=this.capture(captureId),old=this.db.prepare('SELECT sha256,request,receipt FROM award_tx_pages WHERE capture_id=? AND page=?').get(c.id,request.page);
      if(old) {
        demand(old.sha256===sha(bytes)&&old.request===canonical(request)&&old.receipt===canonical(receipt),'TRANSACTION_SOURCE_PAGE_CONFLICT',undefined,409);
        return {captureId:c.id,replayed:true,complete:c.status==='complete',rows:c.row_count};
      }
      demand(c.status!=='complete'&&request.page===c.next_page&&canonical({...request,page:1})===canonical(c.request),'TRANSACTION_PAGE_SEQUENCE_CONFLICT',undefined,409);
      demand(!c.owner||c.owner.instance===this.w.instance,'TRANSACTION_CAPTURE_OTHER_PROCESS',undefined,409);
      demand(c.row_count+parsed.rows.length<=c.max_rows,'TRANSACTION_CAPACITY_REACHED','Increase the saved row capacity and resume this capture.',413);
      this.db.prepare('INSERT INTO award_tx_pages VALUES(?,?,?,?,?,?)').run(c.id,request.page,canonical(request),canonical(receipt),bytes,sha(bytes));
      const insert=this.db.prepare('INSERT INTO award_tx_rows VALUES(?,?,?,?)');
      parsed.rows.forEach((row,index)=>insert.run(c.id,c.row_count+index,row.transaction_id,canonical(row)));
      const complete=parsed.nextRequest===null;
      const pageBindings=this.db.prepare('SELECT page,sha256,request,receipt FROM award_tx_pages WHERE capture_id=? ORDER BY page').all(c.id);
      const fingerprint=complete?sha({awardKey:c.award_key,awardEdition:c.award_edition_id,awardRowSha256:c.award_row.row_sha256,pages:pageBindings}):null;
      this.db.prepare('UPDATE award_tx_captures SET next_page=?,page_count=page_count+1,row_count=row_count+?,status=?,updated_at=?,error=NULL,owner=?,fingerprint=? WHERE id=?').run(parsed.nextRequest?.page??request.page,parsed.rows.length,complete?'complete':c.status,now(),complete?null:c.owner?canonical(c.owner):null,fingerprint,c.id);
      if(complete)this.w.operation('award_transactions_completed',c.id,{pages:c.page_count+1,rows:c.row_count+parsed.rows.length,fingerprint});
      return {captureId:c.id,complete,pages:c.page_count+1,rows:c.row_count+parsed.rows.length,fingerprint};
    });
  }
  capacity({captureId,maxRows,expectedUpdatedAt}) {
    integer(maxRows,'Transaction row capacity',1,250000);
    return this.w.tx(()=>{const c=this.capture(captureId);this.idle(c);demand(c.status!=='complete'&&c.updated_at===expectedUpdatedAt,'TRANSACTION_REVISION_CONFLICT',undefined,409);demand(maxRows>=c.row_count,'TRANSACTION_CAPACITY_BELOW_ROWS');this.db.prepare('UPDATE award_tx_captures SET max_rows=?,updated_at=?,status=?,owner=NULL WHERE id=?').run(maxRows,now(),'paused',c.id);this.w.operation('award_transactions_capacity',c.id,{before:c.max_rows,after:maxRows});return this.capture(c.id);});
  }
  rows(captureId) { this.capture(captureId);return this.db.prepare('SELECT data FROM award_tx_rows WHERE capture_id=? ORDER BY position').all(captureId).map(r=>JSON.parse(r.data)); }
  coverage(c) { return {award_key:c.award_key,award_edition_id:c.award_edition_id,award_row_sha256:c.award_row.row_sha256,status:c.status,complete:c.status==='complete',completion:c.status==='complete'?'hasNext:false':null,first_page:1,pages:c.page_count,occurrences:c.row_count,started_at:c.created_at,finished_at:c.status==='complete'?c.updated_at:null,fingerprint:c.fingerprint}; }
  summary(captureId) { const c=this.capture(captureId),{timeline,...analysis}=analyzeTransactions(this.rows(c.id),{award:c.award_row,coverage:this.coverage(c)});return {capture:c,analysis,review:decoded(this.db.prepare('SELECT * FROM award_tx_reviews WHERE capture_id=?').get(c.id))}; }
  browse(captureId,{page=1,limit=100,search='',startDate='',endDate=''}={}) {
    integer(page,'Page',1,1000000);integer(limit,'Limit',1,500);string(search,'Transaction search',1000,true);
    if(startDate)date(startDate,'Start date');if(endDate)date(endDate,'End date');demand(!startDate||!endDate||startDate<=endDate,'TRANSACTION_DATE_RANGE_INVALID');
    const c=this.capture(captureId),analysis=analyzeTransactions(this.rows(c.id),{award:c.award_row,coverage:this.coverage(c)});
    const selected=analysis.timeline.filter(r=>(!startDate||r.action_date>=startDate)&&(!endDate||r.action_date<=endDate)&&(!search||[r.transaction_id,r.modification_number,r.description,r.action_type_description].some(v=>(v??'').toLowerCase().includes(search.toLowerCase()))));
    return {captureId:c.id,total:selected.length,page,limit,hasNext:page*limit<selected.length,rows:selected.slice((page-1)*limit,page*limit)};
  }
  source(captureId,page) { this.capture(captureId);integer(page,'Source page',1,10000000);const p=this.db.prepare('SELECT * FROM award_tx_pages WHERE capture_id=? AND page=?').get(captureId,page);demand(p,'TRANSACTION_SOURCE_NOT_FOUND',undefined,404);return {...p,request:JSON.parse(p.request),receipt:JSON.parse(p.receipt),response:Buffer.from(p.response)}; }
  compare(before,after) { const a=this.capture(before),b=this.capture(after);return compareTransactions({id:a.id,award_key:a.award_key,coverage:this.coverage(a),rows:this.rows(a.id)},{id:b.id,award_key:b.award_key,coverage:this.coverage(b),rows:this.rows(b.id)}); }
  normalizeReview(review) {
    demand(plain(review)&&Object.keys(review).every(k=>reviewFields.includes(k)),'TRANSACTION_REVIEW_FIELDS_INVALID');
    demand(['researching','scope_match','review_with_owner','passed'].includes(review.status),'TRANSACTION_REVIEW_STATUS_INVALID');
    const data={status:review.status};
    for(const key of reviewFields.filter(k=>k!=='status'))data[key]=string(review[key]??'',key,key==='notes'?12000:4000,true);
    if(data.status==='scope_match'||data.status==='review_with_owner')demand(data.fit.trim()&&data.proposedWorkshare.trim()&&data.deliverables.trim()&&data.acceptance.trim(),'TRANSACTION_WORKSHARE_REQUIRED','Describe the fit, complete workshare, deliverables and acceptance.');
    return data;
  }
  saveReview({captureId,expectedRevision=0,review}) {
    integer(expectedRevision,'Review revision',0,1000000000);
    const c=this.capture(captureId);demand(c.status==='complete','TRANSACTION_CAPTURE_INCOMPLETE','Finish the source capture before saving a workshare assessment.',409);
    const data=this.normalizeReview(review);
    return this.w.tx(()=>{
      const previous=this.db.prepare('SELECT revision FROM award_tx_reviews WHERE capture_id=?').get(c.id);
      demand((previous?.revision??0)===expectedRevision,'TRANSACTION_REVIEW_REVISION_CONFLICT',undefined,409);
      const at=now(),revision=expectedRevision+1,bound={...data,captureId:c.id,sourceFingerprint:c.fingerprint,awardEditionId:c.award_edition_id,awardKey:c.award_key};
      this.db.prepare('INSERT INTO award_tx_reviews VALUES(?,?,?,?,?) ON CONFLICT(capture_id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at,operator=excluded.operator,data=excluded.data').run(c.id,revision,at,this.w.operator,canonical(bound));
      this.db.prepare('INSERT INTO award_tx_review_history(capture_id,revision,at,operator,data) VALUES(?,?,?,?,?)').run(c.id,revision,at,this.w.operator,canonical(bound));
      this.w.operation('award_transaction_review_saved',c.id,{revision,status:data.status});return decoded(this.db.prepare('SELECT * FROM award_tx_reviews WHERE capture_id=?').get(c.id));
    });
  }
  export(captureId,{includeReview=false}={}) {
    return this.w.tx(()=>{
    const c=this.capture(captureId);this.idle(c);
    const pages=this.db.prepare('SELECT page FROM award_tx_pages WHERE capture_id=? ORDER BY page').all(c.id).map(({page})=>{const source=this.source(c.id,page);return {request:source.request,receipt:source.receipt,responseBase64:source.response.toString('base64')};});
    const value={schema:TRANSACTION_VERSION+'.capture',captureId:c.id,awardKey:c.award_key,awardEditionId:c.award_edition_id,awardRowSha256:c.award_row.row_sha256,request:c.request,maxRows:c.max_rows,coverage:this.coverage(c),pages,rows:this.rows(c.id),...(includeReview?{review:decoded(this.db.prepare('SELECT * FROM award_tx_reviews WHERE capture_id=?').get(c.id))}:{})};
    return {...value,sha256:sha(value)};
    });
  }
  validatePages(pages,awardKey,{maxRows=250000,allowEmpty=false}={}) {
    integer(maxRows,'Transaction row capacity',1,250000);
    demand(Array.isArray(pages)&&(allowEmpty||pages.length>0)&&pages.length<=10000,'TRANSACTION_SOURCE_PAGES_REQUIRED');
    const rows=[];let next=1,first=null;
    for(const page of pages) {
      demand(plain(page)&&typeof page.responseBase64==='string','TRANSACTION_SOURCE_BYTES_REQUIRED');
      const request=page.request,parsed=this.validateSource(request,Buffer.from(page.responseBase64,'base64'),page.receipt);
      demand(request.award_id===awardKey,'TRANSACTION_SOURCE_AWARD_MISMATCH');
      first??={...request,page:1};
      demand(request.page===next&&canonical({...request,page:1})===canonical(first),'TRANSACTION_PAGE_SEQUENCE_CONFLICT');
      demand(rows.length+parsed.rows.length<=maxRows,'TRANSACTION_CAPACITY_REACHED');
      rows.push(...parsed.rows);next=parsed.nextRequest?.page??null;
    }
    return {rows,request:first,complete:pages.length>0&&next===null,nextPage:next};
  }
  import({editionId,awardKey,pages,maxRows=250000}) {
    const checked=this.validatePages(pages,awardKey,{maxRows});
    const captureId='TC-import-'+sha({editionId,awardKey,pages}).slice(0,40);
    const c=this.create({editionId,awardKey,pageSize:checked.request.limit,sort:checked.request.sort,order:checked.request.order,maxRows,captureId});this.idle(c);
    let result={captureId,complete:c.status==='complete'};
    for(const page of pages)result=this.acceptPage(captureId,{request:page.request,response:Buffer.from(page.responseBase64,'base64'),receipt:page.receipt});
    return result;
  }
  receive(packet,{editionId,includeReview=false}={}) {
    demand(plain(packet)&&packet.schema===TRANSACTION_VERSION+'.capture','TRANSACTION_EXPORT_SCHEMA_INVALID');
    const {sha256:expected,...value}=packet;demand(sha(value)===expected,'TRANSACTION_EXPORT_DIGEST_MISMATCH');
    const chosen=editionId??packet.awardEditionId,row=this.w.row(chosen,packet.awardKey);
    demand(row.row_sha256===packet.awardRowSha256,'TRANSACTION_RECEIVING_AWARD_MISMATCH','Receive the original award source edition before its transactions.');
    const checked=this.validatePages(packet.pages,packet.awardKey,{allowEmpty:true,maxRows:packet.maxRows});
    const originalRequest=transactionRequest(packet.awardKey,packet.request);
    demand(canonical(originalRequest)===canonical(packet.request)&&originalRequest.page===1&&(!checked.request||canonical(checked.request)===canonical(originalRequest)),'TRANSACTION_RECEIVING_REQUEST_MISMATCH');
    demand(canonical(checked.rows)===canonical(packet.rows),'TRANSACTION_RECEIVING_ROWS_MISMATCH');
    demand(plain(packet.coverage)&&typeof packet.coverage.complete==='boolean'&&checked.complete===packet.coverage.complete&&packet.coverage.pages===packet.pages.length&&packet.coverage.occurrences===checked.rows.length&&packet.coverage.award_key===packet.awardKey&&packet.coverage.award_edition_id===packet.awardEditionId&&packet.coverage.award_row_sha256===packet.awardRowSha256,'TRANSACTION_RECEIVING_COVERAGE_MISMATCH');
    const bindings=packet.pages.map(p=>({page:p.request.page,sha256:sha(Buffer.from(p.responseBase64,'base64')),request:canonical(p.request),receipt:canonical(p.receipt)}));
    const sourceFingerprint=checked.complete?sha({awardKey:packet.awardKey,awardEdition:packet.awardEditionId,awardRowSha256:packet.awardRowSha256,pages:bindings}):null;
    demand(packet.coverage.fingerprint===sourceFingerprint,'TRANSACTION_RECEIVING_FINGERPRINT_MISMATCH');
    const targetId='TC-import-'+sha({editionId:chosen,awardKey:packet.awardKey,pages:packet.pages,...(packet.pages.length?{}:{request:originalRequest})}).slice(0,40);
    const incoming=includeReview?packet.review:null,previous=decoded(this.db.prepare('SELECT * FROM award_tx_reviews WHERE capture_id=?').get(targetId));
    if(incoming) {
      demand(plain(incoming)&&plain(incoming.data)&&checked.complete&&incoming.capture_id===packet.captureId&&incoming.data.captureId===packet.captureId&&incoming.data.sourceFingerprint===sourceFingerprint&&incoming.data.awardKey===packet.awardKey&&incoming.data.awardEditionId===packet.awardEditionId,'TRANSACTION_RECEIVING_REVIEW_BINDING_INVALID');
      integer(incoming.revision,'Source review revision',1,1000000000);string(incoming.operator,'Source review operator',200);
      demand(typeof incoming.updated_at==='string'&&Number.isFinite(Date.parse(incoming.updated_at)),'TRANSACTION_RECEIVING_REVIEW_TIME_INVALID');
      demand(reviewFields.every(k=>typeof incoming.data[k]==='string'),'TRANSACTION_RECEIVING_REVIEW_FIELDS_INVALID');
      this.normalizeReview(Object.fromEntries(reviewFields.map(k=>[k,incoming.data[k]])));
      demand(!previous||previous.data.receivedFrom?.packetSha256===expected,'TRANSACTION_RECEIVING_REVIEW_CONFLICT','This capture already has a local assessment. Receive the source without replacing it.',409);
    }
    let result;
    if(packet.pages.length)result=this.import({editionId:chosen,awardKey:packet.awardKey,pages:packet.pages,maxRows:packet.maxRows});
    else {const c=this.create({editionId:chosen,awardKey:packet.awardKey,pageSize:originalRequest.limit,sort:originalRequest.sort,order:originalRequest.order,maxRows:packet.maxRows,captureId:targetId});result={captureId:c.id,complete:false,rows:0,pages:0};}
    if(incoming)this.w.tx(()=>{
      const current=decoded(this.db.prepare('SELECT * FROM award_tx_reviews WHERE capture_id=?').get(result.captureId));
      demand(!current||current.data.receivedFrom?.packetSha256===expected,'TRANSACTION_RECEIVING_REVIEW_CONFLICT','This capture already has a local assessment. Receive the source without replacing it.',409);
      if(current)return;
      const c=this.capture(result.captureId),at=now(),data={...Object.fromEntries(reviewFields.map(k=>[k,incoming.data[k]])),captureId:c.id,sourceFingerprint:c.fingerprint,awardEditionId:c.award_edition_id,awardKey:c.award_key,receivedFrom:{packetSha256:expected,captureId:incoming.capture_id,revision:incoming.revision,operator:incoming.operator,updatedAt:incoming.updated_at,sourceFingerprint,...(incoming.data.receivedFrom?{prior:incoming.data.receivedFrom}:{})}};
      this.db.prepare('INSERT INTO award_tx_reviews VALUES(?,?,?,?,?)').run(c.id,1,at,this.w.operator,canonical(data));
      this.db.prepare('INSERT INTO award_tx_review_history(capture_id,revision,at,operator,data) VALUES(?,?,?,?,?)').run(c.id,1,at,this.w.operator,canonical(data));
      this.w.operation('award_transaction_review_received',c.id,{sourceCaptureId:packet.captureId,sourceRevision:incoming.revision,sourceSha256:expected});
    });
    return {...result,sourceCaptureId:packet.captureId,sourceSha256:expected,reviewReceived:Boolean(incoming),reviewAvailable:Boolean(packet.review)};
  }
  csv(captureId,options={}) { return transactionCsv(this.rows(captureId),options); }
  brief(captureId,{awardBrief=''}={}) {
    const {capture:c,analysis:a,review}=this.summary(captureId),show=v=>v===null?'Unknown':v;
    const lines=[awardBrief,'','## Award transaction history','',c.award_key,'','Source capture: '+c.id+' · '+c.status+' · '+c.page_count+' original pages.','Retained award edition: '+c.award_edition_id,'','| Measure | USD / count |','| --- | --- |','| Unique transactions | '+a.unique_transactions+' |','| Captured net obligation | '+show(a.net_obligation_usd)+' |','| Positive obligation | '+show(a.positive_obligation_usd)+' |','| Deobligation | '+show(a.deobligation_usd)+' |','| Award obligation at its source observation | '+show(a.award_obligation_usd)+' |','| Difference between the retained observations | '+show(a.award_obligation_difference_usd)+' |','','Action types and descriptions retain the agency source. Funding direction is calculated independently from the transaction amount. The captured history and the award detail retain their own observation times.',''];
    if(review){lines.push('## Transaction workshare assessment','');for(const key of reviewFields)if(review.data[key])lines.push('### '+key,'',review.data[key],'');}
    lines.push('## Original sources','');
    for(const {page}of this.db.prepare('SELECT page FROM award_tx_pages WHERE capture_id=? ORDER BY page').all(c.id)){const s=this.source(c.id,page);lines.push('- '+s.receipt.request.url+' · page '+page+' · '+s.receipt.finishedAt+' · SHA-256 '+s.sha256);}
    return lines.join('\n')+'\n';
  }
  verifyRestored() {
    for(const c of this.db.prepare('SELECT * FROM award_tx_captures').all().map(decoded)) {
      const originalAward=this.w.row(c.award_edition_id,c.award_key);
      demand(originalAward.row_sha256===c.award_row.row_sha256&&canonical(originalAward)===canonical(c.award_row),'TRANSACTION_BACKUP_AWARD_MISMATCH');
      integer(c.max_rows,'Transaction row capacity',1,250000);
      const pages=this.db.prepare('SELECT * FROM award_tx_pages WHERE capture_id=? ORDER BY page').all(c.id),rows=[];let next=1;
      for(const p of pages) {
        const request=JSON.parse(p.request),receipt=JSON.parse(p.receipt),bytes=Buffer.from(p.response);
        demand(p.page===request.page&&request.page===next&&request.award_id===c.award_key&&canonical({...request,page:1})===canonical(c.request)&&sha(bytes)===p.sha256,'TRANSACTION_BACKUP_PAGE_MISMATCH');
        const parsed=this.validateSource(request,bytes,receipt);rows.push(...parsed.rows);next=parsed.nextRequest?.page??null;
      }
      demand(this.db.prepare('SELECT position FROM award_tx_rows WHERE capture_id=? ORDER BY position').all(c.id).every((r,i)=>r.position===i)&&canonical(rows)===canonical(this.rows(c.id))&&c.row_count===rows.length&&c.page_count===pages.length,'TRANSACTION_BACKUP_ROWS_MISMATCH');
      demand(['paused','capturing','error','complete'].includes(c.status)&&((c.status==='complete')===(pages.length>0&&next===null)),'TRANSACTION_BACKUP_COMPLETION_MISMATCH');
      demand(c.next_page===(next??pages.at(-1)?.page??1)&&c.row_count<=c.max_rows,'TRANSACTION_BACKUP_CONTINUATION_MISMATCH');
      demand((c.status==='complete')===Boolean(c.fingerprint),'TRANSACTION_BACKUP_FINGERPRINT_MISSING');
      if(c.fingerprint){const bindings=pages.map(p=>({page:p.page,sha256:p.sha256,request:p.request,receipt:p.receipt}));demand(c.fingerprint===sha({awardKey:c.award_key,awardEdition:c.award_edition_id,awardRowSha256:c.award_row.row_sha256,pages:bindings}),'TRANSACTION_BACKUP_FINGERPRINT_MISMATCH');}
    }
    for(const table of ['award_tx_reviews','award_tx_review_history'])for(const review of this.db.prepare('SELECT * FROM '+table).all().map(decoded)) {
      this.normalizeReview(Object.fromEntries(reviewFields.map(k=>[k,review.data[k]])));
      const c=this.capture(review.capture_id);demand(c.status==='complete'&&review.data.captureId===c.id&&review.data.sourceFingerprint===c.fingerprint&&review.data.awardKey===c.award_key&&review.data.awardEditionId===c.award_edition_id,'TRANSACTION_BACKUP_REVIEW_BINDING_MISMATCH');
    }
    this.db.prepare("UPDATE award_tx_captures SET owner=NULL,status=CASE WHEN status='capturing' THEN 'paused' ELSE status END").run();
  }
}
