// MIT. Complete supplier order workspace on the maintained native SQLite store.
import { createReadStream, constants } from 'node:fs';
import { mkdir, lstat, chmod, open, link, unlink, readFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { openWorkspaceStore, clone, identifier, now } from '../opensearch/workspace/store.mjs';
import { PROFILE_ID, DRAFT_SCHEMA, normalizedDocument, referencedOrders, businessKey, sourceDocumentId,
  reviewDocument, projectOrder, createDocumentDraft, text, data, fail, orderId, canonical, digest } from './core.mjs';
import { parseOpenTransDocument, renderOpenTransDocument } from './opentrans.mjs';
import { writeSupplierOrderPackage, readSupplierOrderPackage } from './portable.mjs';

export const TABLES=Object.freeze({
  supplier_order_sources:['id','sha256','record_json'],
  supplier_order_documents:['id','kind','business_key','revision','created_at','record_json'],
  supplier_order_heads:['order_id','revision','record_json'],
  supplier_order_history:['order_id','revision','record_json'],
  supplier_order_selections:['id','order_id','sequence','document_id','record_json'],
  supplier_order_drafts:['id','revision','updated_at','record_json'],
  supplier_order_draft_history:['draft_id','revision','record_json'],
  supplier_order_files:['id','kind','record_json'],
  supplier_order_transmissions:['id','document_id','state','record_json'],
  supplier_order_foreign_records:['id','source_workspace','source_table','record_json'],
  supplier_order_receivings:['id','created_at','record_json']
});
export const TABLE_KEYS=Object.freeze({
  supplier_order_sources:['id'],supplier_order_documents:['id'],supplier_order_heads:['order_id'],
  supplier_order_history:['order_id','revision'],supplier_order_selections:['id'],
  supplier_order_drafts:['id'],supplier_order_draft_history:['draft_id','revision'],
  supplier_order_files:['id'],supplier_order_transmissions:['id'],
  supplier_order_foreign_records:['id'],supplier_order_receivings:['id']
});
const parsed=row=>row?JSON.parse(row.record_json):null;
export const MAX_SOURCE_BYTES=64*1024*1024;
export const MAX_PACKAGE_BYTES=8*1024*1024*1024;
function page(offset=0,limit=50){
  offset=Number(offset);limit=Number(limit);
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)
    fail('ORDER_PAGE_INVALID','Use a nonnegative offset and page size from 1 to 200.');
  return{offset,limit};
}
function revision(value){
  if(!Number.isSafeInteger(value)||value<1)fail('ORDER_REVISION_REQUIRED','Reopen the current saved order or draft before changing it.',409);
  return value;
}
function provenance(value={}){
  data(value);if(!value||typeof value!=='object'||Array.isArray(value))fail('ORDER_PROVENANCE_INVALID','Source provenance must be a JSON object.');
  if(value.url){const url=new URL(value.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)
    fail('ORDER_SOURCE_URL_INVALID','Use the original HTTP or HTTPS source URL without credentials.');}
  return clone(value);
}
function writeRow(db,table,record,fields){
  const columns=TABLES[table];db.prepare('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')')
    .run(...fields,JSON.stringify(record));
}
function safeName(value){return text(basename(value||'document.xml'),'File name',240).replace(/[\r\n]/g,'_');}
async function privateDirectory(path){
  await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);
  if(!s.isDirectory()||s.isSymbolicLink())fail('ORDER_DIRECTORY_INVALID','Select an original private workspace directory.',409);
  await chmod(path,0o700);
}
export async function openSupplierOrderWorkspace({directory}={}){
  text(directory,'Workspace directory',4096);
  const store=await openWorkspaceStore(directory,digest({product:'supplier-orders',profileId:PROFILE_ID,schema:'v1'}));
  try{
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS supplier_order_sources(id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,record_json TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS supplier_order_documents(id TEXT PRIMARY KEY,kind TEXT NOT NULL,business_key TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,record_json TEXT NOT NULL);'+
      'CREATE INDEX IF NOT EXISTS supplier_order_document_business ON supplier_order_documents(business_key,revision);'+
      'CREATE TABLE IF NOT EXISTS supplier_order_heads(order_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,record_json TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS supplier_order_history(order_id TEXT NOT NULL,revision INTEGER NOT NULL,record_json TEXT NOT NULL,PRIMARY KEY(order_id,revision));'+
      'CREATE TABLE IF NOT EXISTS supplier_order_selections(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,sequence INTEGER NOT NULL,document_id TEXT NOT NULL,record_json TEXT NOT NULL);'+
      'CREATE INDEX IF NOT EXISTS supplier_order_selection_order ON supplier_order_selections(order_id,sequence);'+
      'CREATE TABLE IF NOT EXISTS supplier_order_drafts(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,record_json TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS supplier_order_draft_history(draft_id TEXT NOT NULL,revision INTEGER NOT NULL,record_json TEXT NOT NULL,PRIMARY KEY(draft_id,revision));'+
      'CREATE TABLE IF NOT EXISTS supplier_order_files(id TEXT PRIMARY KEY,kind TEXT NOT NULL,record_json TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS supplier_order_transmissions(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,state TEXT NOT NULL,record_json TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS supplier_order_foreign_records(id TEXT PRIMARY KEY,source_workspace TEXT NOT NULL,source_table TEXT NOT NULL,record_json TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS supplier_order_receivings(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,record_json TEXT NOT NULL);'+
      'CREATE TABLE IF NOT EXISTS supplier_order_order_index(order_id TEXT PRIMARY KEY,status TEXT NOT NULL,search_text TEXT NOT NULL,summary_json TEXT NOT NULL);'+
      'CREATE INDEX IF NOT EXISTS supplier_order_order_status ON supplier_order_order_index(status,order_id);'+
      'CREATE TABLE IF NOT EXISTS supplier_order_document_index(id TEXT PRIMARY KEY,kind TEXT NOT NULL,created_at TEXT NOT NULL,summary_json TEXT NOT NULL);'+
      'CREATE INDEX IF NOT EXISTS supplier_order_document_date ON supplier_order_document_index(created_at,id);'+
      'CREATE TABLE IF NOT EXISTS supplier_order_document_orders(document_id TEXT NOT NULL,order_id TEXT NOT NULL,PRIMARY KEY(document_id,order_id));'+
      'CREATE INDEX IF NOT EXISTS supplier_order_document_order ON supplier_order_document_orders(order_id,document_id);'
    );
    const workspace=new SupplierOrderWorkspace(store);await workspace.directories();workspace.repairIndexes();return workspace;
  }catch(error){store.close();throw error;}
}
export class SupplierOrderWorkspace {
  constructor(store){this.store=store;this.db=store.db;this.directory=store.directory;this.root=join(this.directory,'supplier-orders');this.active=new Map();this.inFlight=new Set();this.scope=new AsyncLocalStorage();this.closed=false;this.closing=false;this.closePromise=null;}
  async directories(){for(const dir of [this.root,join(this.root,'files'),join(this.root,'incoming'),join(this.root,'exports')])await privateDirectory(dir);}
  assertOpen(){if(this.closed||this.closing&&this.scope.getStore()!==this)fail('ORDER_WORKSPACE_CLOSED','This workspace is closing.',503);}
  owned(action){
    if(this.scope.getStore()===this)return action();this.assertOpen();
    const task=this.scope.run(this,()=>Promise.resolve().then(action));this.inFlight.add(task);
    task.then(()=>this.inFlight.delete(task),()=>this.inFlight.delete(task));return task;
  }
  operation({requestId}){return this.store.operation(identifier(requestId,'Request ID'));}
  failure(error){return{code:error.code??'ORDER_OPERATION_FAILED',message:error.message??String(error),...(error.details?{details:clone(error.details)}:{})};}
  reserve(kind,request){
    const requestContentSha256=digest(request);
    const saved=this.store.reserve('supplier-orders-'+kind,{requestId:request.requestId,requestContentSha256});
    if(!saved.existing){saved.operation.request=clone(request);saved.operation.requestContentSha256=requestContentSha256;this.store.writeOperation(saved.operation);}
    return saved;
  }
  sync(kind,request,action){
    this.assertOpen();data(request);
    return this.store.transaction(()=>{const saved=this.reserve(kind,request);
      if(saved.existing)return saved.operation;
      return this.store.writeOperation({...saved.operation,state:'COMPLETE',updatedAt:now(),result:clone(action(saved.operation))});});
  }
  async perform(kind,request,action,begin){
    this.assertOpen();data(request);
    const saved=this.store.transaction(()=>{
      const entry=this.reserve(kind,request);if(!entry.existing&&begin){entry.operation.context=clone(begin());this.store.writeOperation(entry.operation);}return entry;
    });
    if(saved.existing)return this.active.has(request.requestId)?this.active.get(request.requestId):saved.operation;
    const task=this.scope.run(this,()=>Promise.resolve().then(()=>action(saved.operation)))
      .then(result=>this.store.finish(request.requestId,result))
      .catch(error=>this.store.finish(request.requestId,null,this.failure(error)))
      .finally(()=>this.active.delete(request.requestId));
    this.active.set(request.requestId,task);return task;
  }
  async retain(...args){return this.owned(()=>this.#retain(...args));}
  async #retain(iterable,{name='document.xml',kind='source',mimeType='application/xml',maxBytes=MAX_SOURCE_BYTES}={}){
    this.assertOpen();await this.directories();
    const tmp=join(this.root,'incoming',randomUUID()+'.part'),handle=await open(tmp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
    const hash=createHash('sha256');let bytes=0,complete=false;
    try{for await(const chunk of iterable){if(!(chunk instanceof Uint8Array))fail('ORDER_BYTES_REQUIRED','Supply original file bytes.');bytes+=chunk.length;if(bytes>maxBytes)fail('ORDER_INPUT_TOO_LARGE','The source exceeds this workspace transfer limit.');hash.update(chunk);await handle.writeFile(chunk);}await handle.sync();complete=true;}
    finally{await handle.close();if(!complete)await unlink(tmp).catch(()=>{});}
    const sha256=hash.digest('hex'),path=join(this.root,'files',sha256+'.bin');
    try{try{await link(tmp,path);}catch(e){if(e.code!=='EEXIST')throw e;const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.size!==bytes)fail('ORDER_FILE_CONFLICT','The retained file differs from its content identity.',409);
        const h=createHash('sha256');for await(const part of createReadStream(path,{flags:constants.O_RDONLY|constants.O_NOFOLLOW}))h.update(part);if(h.digest('hex')!==sha256)fail('ORDER_FILE_CONFLICT','The retained file differs from its content identity.',409);}
      const parent=await open(join(this.root,'files'),'r');try{await parent.sync();}finally{await parent.close();}}
    finally{await unlink(tmp).catch(()=>{});}
    const file={id:sha256,name:safeName(name),bytes,sha256,mimeType,kind,createdAt:now()};
    this.store.transaction(()=>{if(!this.db.prepare('SELECT id FROM supplier_order_files WHERE id=?').get(file.id))writeRow(this.db,'supplier_order_files',file,[file.id,kind]);});
    return{...file,path};
  }
  async file({id}){
    const record=parsed(this.db.prepare('SELECT record_json FROM supplier_order_files WHERE id=?').get(identifier(id,'File ID')));
    if(!record)fail('ORDER_FILE_NOT_FOUND','File not found.',404);
    const path=join(this.root,'files',record.sha256+'.bin'),s=await lstat(path);
    if(!s.isFile()||s.isSymbolicLink()||s.size!==record.bytes)fail('ORDER_FILE_CHANGED','The complete retained file is unavailable.',409);
    return{...record,path};
  }
  supplierIdentity(){const row=this.db.prepare('SELECT value FROM meta WHERE key=?').get('supplier_order_issuer');return row?JSON.parse(row.value):null;}
  bindSupplier(document){
    const current=this.supplierIdentity(),explicit=document.header.supplierId??null;
    let selected=explicit;
    if(!selected&&document.kind==='ORDERRESPONSE'){
      const prior=parsed(this.db.prepare('SELECT record_json FROM supplier_order_heads WHERE order_id=?').get(document.orderId));
      if(prior)selected=this.document({id:prior.documentId}).document.header.supplierId??null;
    }
    if(!selected)fail('ORDER_SUPPLIER_IDENTITY_REQUIRED','Retain an unambiguous original Unite supplier number before adding this document to a supplier workspace.',422,{supplierIdentity:document.header.supplierIdentity??null});
    if(current&&current.value!==selected)fail('ORDER_SUPPLIER_WORKSPACE_DIFFERS','This original supplier has a different workspace identity. Receive its complete documents into that supplier’s workspace.',409,{workspaceSupplier:current.value,documentSupplier:selected});
    if(!current){if(document.kind!=='ORDER')fail('ORDER_ORIGINAL_REQUIRED','Import this supplier’s complete original ORDER before related documents.');const value={value:selected,identity:clone(document.header.supplierIdentity??null),originalOrderId:document.orderId,createdAt:now()};this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('supplier_order_issuer',JSON.stringify(value));}
    return selected;
  }
  state(){
    this.assertOpen();this.store.recoverInterrupted();
    const count=table=>Number(this.db.prepare('SELECT count(*) AS n FROM '+table).get().n);
    return{schema:'stellar-forge.supplier-orders-workspace.v1',workspaceId:this.store.id,profileId:PROFILE_ID,supplierIdentity:this.supplierIdentity(),
      counts:{orders:count('supplier_order_heads'),documents:count('supplier_order_documents'),drafts:count('supplier_order_drafts'),sources:count('supplier_order_sources'),transmissions:count('supplier_order_transmissions')},
      orderRevisions:Object.fromEntries(this.db.prepare('SELECT order_id,revision FROM supplier_order_heads').all().map(row=>[row.order_id,row.revision])),
      orderStateSha256:Object.fromEntries(this.db.prepare('SELECT order_id,record_json FROM supplier_order_heads').all().map(row=>[row.order_id,digest(parsed(row))])),
      drafts:this.drafts({limit:50}).items,
      operations:this.db.prepare("SELECT id,kind,state,created_at,updated_at,request_sha256,json_extract(record_json,'$.error.code') error_code,json_extract(record_json,'$.error.message') error_message,json_extract(record_json,'$.result.documentId') document_id,json_extract(record_json,'$.result.draftId') draft_id,json_extract(record_json,'$.result.file') file_json FROM operations WHERE kind LIKE 'supplier-orders-%' ORDER BY updated_at DESC LIMIT 30").all().map(row=>({id:row.id,kind:row.kind,state:row.state,createdAt:row.created_at,updatedAt:row.updated_at,requestSha256:row.request_sha256,error:row.error_code?{code:row.error_code,message:row.error_message}:null,result:{documentId:row.document_id,draftId:row.draft_id,file:row.file_json?JSON.parse(row.file_json):null}}))};
  }
  head(id,expected){
    const value=parsed(this.db.prepare('SELECT record_json FROM supplier_order_heads WHERE order_id=?').get(orderId(id)));
    if(!value)fail('ORDER_NOT_FOUND','Original order not found.',404);
    if(expected!==undefined&&value.revision!==revision(expected))fail('ORDER_CHANGED','The selected order changed. Reopen it before continuing.',409,{orderId:id,expectedRevision:expected,currentRevision:value.revision});
    return value;
  }
  document({id}){
    const record=parsed(this.db.prepare('SELECT record_json FROM supplier_order_documents WHERE id=?').get(identifier(id,'Document ID')));
    if(!record)fail('ORDER_DOCUMENT_NOT_FOUND','Document not found.',404);
    const {sha256,...value}=record;if(digest(value)!==sha256)fail('ORDER_DOCUMENT_CHANGED','The retained immutable document changed.',409);
    return record;
  }
  source({id}){
    const source=parsed(this.db.prepare('SELECT record_json FROM supplier_order_sources WHERE id=?').get(identifier(id,'Source ID')));
    if(!source)fail('ORDER_SOURCE_NOT_FOUND','Original source not found.',404);return source;
  }
  order({orderId:id}){
    const head=this.head(id),base=this.document({id:head.documentId});
    const history=this.db.prepare('SELECT record_json FROM supplier_order_history WHERE order_id=? ORDER BY revision').all(id).map(parsed);
    const selections=(head.selectionIds??[]).map(selectionId=>{
      const value=parsed(this.db.prepare('SELECT record_json FROM supplier_order_selections WHERE id=? AND order_id=?').get(selectionId,id));
      if(!value)fail('ORDER_SELECTION_MISSING','The current order refers to unavailable document selection history.',409,{orderId:id,selectionId});return value;});
    return{...projectOrder(base,selections.map(selection=>this.document({id:selection.documentId})),{revision:head.revision,history}),stateSha256:digest(head)};
  }
  orders({query='',status,offset=0,limit=50}={}){
    const p=page(offset,limit),q=String(query).normalize('NFKC').toLocaleLowerCase('en-US'),where=[],args=[];
    if(status){where.push('status=?');args.push(status);}
    if(q){where.push('instr(search_text,?)>0');args.push(q);}
    const clause=where.length?' WHERE '+where.join(' AND '):'';
    const total=Number(this.db.prepare('SELECT count(*) AS n FROM supplier_order_order_index'+clause).get(...args).n);
    const items=this.db.prepare('SELECT summary_json FROM supplier_order_order_index'+clause+' ORDER BY order_id LIMIT ? OFFSET ?').all(...args,p.limit,p.offset).map(row=>JSON.parse(row.summary_json));
    return{items,total,...p};
  }
  documents({orderId:id,kind,offset=0,limit=50}={}){
    const p=page(offset,limit),where=[],args=[];if(id){orderId(id);where.push('EXISTS(SELECT 1 FROM supplier_order_document_orders r WHERE r.document_id=d.id AND r.order_id=?)');args.push(id);}
    if(kind){where.push('d.kind=?');args.push(kind);}
    const clause=where.length?' WHERE '+where.join(' AND '):'';
    const total=Number(this.db.prepare('SELECT count(*) AS n FROM supplier_order_document_index d'+clause).get(...args).n);
    const items=this.db.prepare('SELECT d.summary_json FROM supplier_order_document_index d'+clause+' ORDER BY d.created_at DESC,d.id LIMIT ? OFFSET ?').all(...args,p.limit,p.offset).map(row=>JSON.parse(row.summary_json));
    return{items,total,...p};
  }
  indexOrder(id){
    const item=this.order({orderId:id}),summary={orderId:item.orderId,revision:item.revision,status:item.status,header:item.header,itemCount:item.items.length,findings:item.findings,totals:item.totals};
    const search=canonical({orderId:item.orderId,header:item.header,items:item.items.map(line=>({lineId:line.lineId,article:line.article}))}).normalize('NFKC').toLocaleLowerCase('en-US');
    this.db.prepare('INSERT INTO supplier_order_order_index VALUES(?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET status=excluded.status,search_text=excluded.search_text,summary_json=excluded.summary_json').run(id,item.status,search,JSON.stringify(summary));
  }
  indexDocument(record){
    const {document,...summary}=record;
    this.db.prepare('INSERT INTO supplier_order_document_index VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,created_at=excluded.created_at,summary_json=excluded.summary_json').run(record.id,record.kind,record.createdAt,JSON.stringify(summary));
    this.db.prepare('DELETE FROM supplier_order_document_orders WHERE document_id=?').run(record.id);
    for(const id of record.orderIds)this.db.prepare('INSERT INTO supplier_order_document_orders VALUES(?,?)').run(record.id,id);
  }
  repairIndexes({all=false}={}){
    this.store.transaction(()=>{
      const documents=this.db.prepare('SELECT d.id FROM supplier_order_documents d LEFT JOIN supplier_order_document_index i ON d.id=i.id'+(all?'':' WHERE i.id IS NULL')).all();
      for(const row of documents)this.indexDocument(this.document({id:row.id}));
      const orders=this.db.prepare('SELECT h.order_id FROM supplier_order_heads h LEFT JOIN supplier_order_order_index i ON h.order_id=i.order_id'+(all?'':' WHERE i.order_id IS NULL')).all();
      for(const row of orders)this.indexOrder(row.order_id);
    });
  }
  putHead(head){
    this.db.prepare('INSERT INTO supplier_order_heads VALUES(?,?,?) ON CONFLICT(order_id) DO UPDATE SET revision=excluded.revision,record_json=excluded.record_json').run(head.orderId,head.revision,JSON.stringify(head));
    writeRow(this.db,'supplier_order_history',head,[head.orderId,head.revision]);this.indexOrder(head.orderId);return head;
  }
  expectedFor(request,id,ids){
    const expected=request.expectedOrderRevisions?.[id]??(ids.length===1?request.expectedOrderRevision:undefined);
    return revision(expected);
  }
  select(record,ids,request,{initial=false}={}){
    const results={};
    for(const id of ids){
      orderId(id);const existing=parsed(this.db.prepare('SELECT record_json FROM supplier_order_heads WHERE order_id=?').get(id));
      if(record.kind==='ORDER'){
        if(record.document.orderId!==id)fail('ORDER_DOCUMENT_REFERENCE_INVALID','Select this original order by its own order number.');
        if(existing&&existing.documentId===record.id){results[id]=existing.revision;continue;}
        if(existing)this.head(id,this.expectedFor(request,id,ids));
        else if(!initial)fail('ORDER_NOT_FOUND','Import the complete original order first.',404);
      }else{
        if(!record.orderIds.includes(id))fail('ORDER_DOCUMENT_REFERENCE_INVALID','This document does not refer to the selected order.');
        this.head(id,this.expectedFor(request,id,ids));
        const lastId=existing.selectionIds?.at(-1),last=lastId?this.db.prepare('SELECT document_id FROM supplier_order_selections WHERE id=?').get(lastId):null;
        if(last?.document_id===record.id){results[id]=existing.revision;continue;}
      }
      const at=now(),next=(existing?.revision??0)+1;
      const head={schema:'stellar-forge.supplier-order-selection.v1',orderId:id,revision:next,
        documentId:record.kind==='ORDER'?record.id:existing.documentId,selectedDocumentId:record.id,kind:record.kind,
        selectionIds:[...(existing?.selectionIds??[])],reason:request.reason??'Received complete original source',requestId:request.requestId,updatedAt:at,createdAt:existing?.createdAt??at};
      if(record.kind!=='ORDER'){
        const seq=Number(this.db.prepare('SELECT coalesce(max(sequence),0)+1 AS n FROM supplier_order_selections WHERE order_id=?').get(id).n);
        const selection={id:digest([request.requestId,id,record.id]),orderId:id,sequence:seq,documentId:record.id,reason:head.reason,createdAt:at};
        writeRow(this.db,'supplier_order_selections',selection,[selection.id,id,seq,record.id]);head.selectionIds.push(selection.id);
      }
      this.putHead(head);results[id]=next;
    }
    return results;
  }
  recordDocument(document,source,{direction='incoming',draftId=null,draftRevision=null}={}){
    const value=normalizedDocument(document);this.bindSupplier(value);const key=businessKey(value),id=sourceDocumentId(value,source.sha256);
    const existing=this.db.prepare('SELECT id FROM supplier_order_documents WHERE id=?').get(id);if(existing)return this.document({id});
    const rev=Number(this.db.prepare('SELECT coalesce(max(revision),0)+1 AS n FROM supplier_order_documents WHERE business_key=?').get(key).n),referencedOrderIds=referencedOrders(value);
    const earlier=this.db.prepare('SELECT record_json FROM supplier_order_documents WHERE business_key=? ORDER BY revision').all(key).map(parsed);
    const ids=[...new Set([...referencedOrderIds,...earlier.flatMap(record=>record.orderIds)])].sort();
    const originalOrders=ids.filter(id=>this.db.prepare('SELECT order_id FROM supplier_order_heads WHERE order_id=?').get(id)).map(id=>this.order({orderId:id}));
    const nativeFindings=Array.isArray(value.findings)?value.findings:[],review=reviewDocument(value,{orders:originalOrders});
    const record={id,revision:rev,businessKey:key,kind:value.kind,documentId:value.documentId,orderIds:ids,referencedOrderIds,
      source:clone(source),document:value,review:{...review,findings:[...nativeFindings,...review.findings],
        errors:review.errors+nativeFindings.filter(f=>f.severity==='error').length,warnings:review.warnings+nativeFindings.filter(f=>f.severity==='warning').length},
      direction,draftId,draftRevision,createdAt:now()};
    record.sha256=digest(record);writeRow(this.db,'supplier_order_documents',record,[id,record.kind,key,rev,record.createdAt]);this.indexDocument(record);return record;
  }
  async importDocument(request){return this.owned(()=>this.#importDocument(request));}
  async #importDocument(request){
    const name=safeName(request.name??basename(request.sourcePath??'document.xml')),origin=provenance(request.provenance);
    const s=await lstat(request.sourcePath);if(!s.isFile()||s.isSymbolicLink()||s.size<1||s.size>MAX_SOURCE_BYTES)fail('ORDER_SOURCE_FILE_INVALID','Select a complete original XML file of up to 64 MiB.');
    const file=await this.retain(createReadStream(request.sourcePath,{flags:constants.O_RDONLY|constants.O_NOFOLLOW}),{name});
    this.verifyInput(file,request);
    const selected={requestId:identifier(request.requestId,'Request ID'),name,provenance:origin,source:{bytes:file.bytes,sha256:file.sha256},
      selection:request.selection??'history',...(request.expectedOrderRevision!==undefined?{expectedOrderRevision:request.expectedOrderRevision}:{}),
      ...(request.expectedOrderRevisions?{expectedOrderRevisions:clone(request.expectedOrderRevisions)}:{}),...(request.reason?{reason:text(request.reason,'Selection reason',4000)}:{})};
    if(!['current','history'].includes(selected.selection))fail('ORDER_SELECTION_INVALID','Choose current or history for the original document.');
    const source={id:digest([name,file.sha256,origin]),name,bytes:file.bytes,sha256:file.sha256,fileId:file.id,provenance:origin,capturedAt:now()};
    return this.perform('import',selected,async()=>{
      const raw=await readFile(file.path),document=await parseOpenTransDocument(raw,{name,provenance:origin});
      return this.store.transaction(()=>{
        const record=this.recordDocument(document,source),ids=record.orderIds;let revisions={};
        if(record.kind==='ORDER'&&!this.db.prepare('SELECT order_id FROM supplier_order_heads WHERE order_id=?').get(document.orderId))
          revisions=this.select(record,[document.orderId],selected,{initial:true});
        else if(selected.selection==='current')revisions=this.select(record,ids,selected);
        return{source,documentId:record.id,document:record,orderIds:ids,revisions,file:{id:file.id,name:file.name,bytes:file.bytes,sha256:file.sha256,mimeType:file.mimeType}};
      });
    },()=>{if(!this.db.prepare('SELECT id FROM supplier_order_sources WHERE id=?').get(source.id))writeRow(this.db,'supplier_order_sources',source,[source.id,source.sha256]);return{source};});
  }
  newDraft({kind,orderIds,documentId,roundingPolicy}={}){
    const orders=(orderIds??[]).map(id=>this.order({orderId:id}));return createDocumentDraft(kind,orders,{...(documentId?{documentId}:{}),roundingPolicy:roundingPolicy??null});
  }
  drafts({orderId:id,offset=0,limit=50}={}){
    const p=page(offset,limit),where=id?' WHERE EXISTS(SELECT 1 FROM json_each(d.record_json,\'$.orderIds\') refs WHERE refs.value=?)':'',args=id?[orderId(id)]:[];
    const total=Number(this.db.prepare('SELECT count(*) AS n FROM supplier_order_drafts d'+where).get(...args).n);
    const items=this.db.prepare('SELECT json_remove(d.record_json,\'$.document\',\'$.review.findings\') record_json FROM supplier_order_drafts d'+where+' ORDER BY d.updated_at DESC,d.id LIMIT ? OFFSET ?').all(...args,p.limit,p.offset).map(parsed).map(({document,...draft})=>draft);
    return{items,total,...p};
  }
  draft({draftId}){
    const value=parsed(this.db.prepare('SELECT record_json FROM supplier_order_drafts WHERE id=?').get(identifier(draftId,'Draft ID')));
    if(!value)fail('ORDER_DRAFT_NOT_FOUND','Draft not found.',404);
    return value;
  }
  saveDraft(request){
    return this.sync('save-draft',request,()=>{
      const prior=request.draftId?this.draft({draftId:request.draftId}):null;
      if(prior&&prior.revision!==revision(request.expectedRevision))fail('ORDER_DRAFT_CHANGED','The saved draft changed. Reopen it before saving.',409,{currentRevision:prior.revision});
      const kind=request.kind??prior?.kind;if(!['ORDERRESPONSE','DISPATCHNOTIFICATION','INVOICE'].includes(kind))fail('ORDER_DRAFT_KIND_INVALID','Choose a confirmation, dispatch notification or invoice.');
      if(prior&&kind!==prior.kind)fail('ORDER_DRAFT_KIND_CHANGED','Create another draft for a different document kind.');
      const ids=[...new Set(request.orderIds??prior?.orderIds??[])].map(orderId);
      if(!ids.length||kind==='ORDERRESPONSE'&&ids.length!==1)fail('ORDER_DRAFT_ORDERS_INVALID','Select the original order or compatible orders for this document.');
      const originals=ids.map(id=>this.order({orderId:id}));
      const expectedStates=request.expectedOrderStateSha256??request.orderStateSha256;
      for(const order of originals){this.head(order.orderId,revision(request.expectedOrderRevisions?.[order.orderId]??request.orderRevisions?.[order.orderId]));
        if(!expectedStates?.[order.orderId]||expectedStates[order.orderId]!==order.stateSha256)fail('ORDER_DRAFT_SOURCE_CHANGED','The selected original order branch differs from the draft input. Reopen its current order selection before saving.',409,{orderId:order.orderId,currentStateSha256:order.stateSha256});}
      const document=clone(data(request.document));if(document.kind!==kind||document.schema!=='stellar-forge.supplier-order-document.v1'||document.version!=='1.0'||document.profileId!==PROFILE_ID)
        fail('ORDER_DRAFT_DOCUMENT_INVALID','Keep the selected original document profile and kind.');
      if(referencedOrders(document).some(id=>!ids.includes(id)))fail('ORDER_DRAFT_REFERENCES_FOREIGN','Every document line must refer to one of the selected original orders.');
      const policy=request.roundingPolicy??prior?.roundingPolicy??null;if(policy)roundedPolicy(policy);
      const at=now(),result={schema:DRAFT_SCHEMA,id:prior?.id??randomUUID(),revision:(prior?.revision??0)+1,
        title:text(request.title??prior?.title??kind+' '+ids.join(', '),'Draft title',240),kind,orderIds:ids,
        sourceOrderDocuments:originals.map(order=>({orderId:order.orderId,id:order.document.id,sha256:order.document.sha256})),
        orderRevisions:Object.fromEntries(originals.map(order=>[order.orderId,order.revision])),
        orderStateSha256:Object.fromEntries(originals.map(order=>[order.orderId,digest(this.head(order.orderId))])),document,roundingPolicy:policy,
        reason:text(request.reason,'Reason for this saved revision',4000),review:reviewDocument(document,{orders:originals,roundingPolicy:policy,forOutput:true}),
        createdAt:prior?.createdAt??at,updatedAt:at};
      result.sha256=digest(result);
      this.db.prepare('INSERT INTO supplier_order_drafts VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at,record_json=excluded.record_json').run(result.id,result.revision,at,JSON.stringify(result));
      writeRow(this.db,'supplier_order_draft_history',result,[result.id,result.revision]);
      return{draftId:result.id,revision:result.revision,draft:result};
    });
  }
  async prepareDocument(request){
    return this.perform('prepare-document',request,async operation=>{
      const draft=operation.context.draft,rendered=await renderOpenTransDocument(draft.document);
      if(!(rendered.bytes instanceof Uint8Array))fail('ORDER_RENDER_BYTES_MISSING','The original document adapter returned no complete XML bytes.');
      const parsedDocument=rendered.document??await parseOpenTransDocument(rendered.bytes,{name:draft.kind+'.xml',provenance:{draftId:draft.id,draftRevision:draft.revision}});
      const check=reviewDocument(parsedDocument,{orders:draft.orderIds.map(id=>this.order({orderId:id})),roundingPolicy:draft.roundingPolicy,forOutput:true});
      const errors=[...(rendered.findings??parsedDocument.findings??[]),...check.findings].filter(f=>f.severity==='error');
      if(errors.length)fail('ORDER_OUTPUT_REVIEW_REQUIRED','Correct the document fields shown in the review before preparing this output.',422,{findings:errors});
      const filename=safeName(draft.kind+'-'+parsedDocument.documentId+'.xml'),file=await this.retain([rendered.bytes],{name:filename,kind:'document'});
      const source={id:digest(['prepared',draft.id,draft.revision,file.sha256]),name:filename,bytes:file.bytes,sha256:file.sha256,fileId:file.id,
        provenance:{kind:'supplier-authored',draftId:draft.id,draftRevision:draft.revision,orderRevisions:draft.orderRevisions},capturedAt:now()};
      return this.store.transaction(()=>{
        const current=this.draft({draftId:draft.id});if(current.revision!==draft.revision)fail('ORDER_DRAFT_CHANGED','The draft changed while its complete XML was prepared.',409);
        for(const [id,expected] of Object.entries(draft.orderRevisions)){const selected=this.head(id,expected);if(digest(selected)!==draft.orderStateSha256[id])fail('ORDER_DRAFT_SOURCE_CHANGED','The original selected order branch changed while its XML was prepared.',409,{orderId:id});}
        if(!this.db.prepare('SELECT id FROM supplier_order_sources WHERE id=?').get(source.id))writeRow(this.db,'supplier_order_sources',source,[source.id,source.sha256]);
        const record=this.recordDocument(parsedDocument,source,{direction:'outgoing',draftId:draft.id,draftRevision:draft.revision});
        return{draftId:draft.id,revision:draft.revision,documentId:record.id,document:record,orderIds:record.orderIds,file:{id:file.id,name:file.name,bytes:file.bytes,sha256:file.sha256,mimeType:file.mimeType}};
      });
    },()=>{
      const draft=this.draft({draftId:request.draftId});if(draft.revision!==revision(request.expectedRevision))fail('ORDER_DRAFT_CHANGED','Reopen the saved draft before preparing its XML.',409);
      for(const [id,expected] of Object.entries(draft.orderRevisions)){
        const current=this.head(id,expected);if(!draft.orderStateSha256?.[id]||draft.orderStateSha256[id]!==digest(current))fail('ORDER_DRAFT_SOURCE_CHANGED','The original selected order branch differs from this saved draft. Reopen and save the intended source selection before preparing it.',409,{orderId:id});}
      if(draft.review.errors)fail('ORDER_OUTPUT_REVIEW_REQUIRED','Correct the draft fields shown in the review.',422,{findings:draft.review.findings});
      return{draft};
    });
  }
  selectDocument(request){
    return this.sync('select-document',request,()=>{
      text(request.reason,'Reason for this selection',4000);
      const record=this.document({id:request.id}),ids=request.orderId?[orderId(request.orderId)]:record.orderIds;
      const revisions=this.select(record,ids,request);
      return{documentId:record.id,orderIds:ids,revisions};
    });
  }
  async exportFile({id}){const document=this.document({id});return this.file({id:document.source.fileId});}
  async exportWorkspace(request){
    const selected={requestId:request.requestId,path:resolve(request.path??join(this.root,'exports',request.requestId+'.zip'))};
    return this.perform('export-workspace',selected,async()=>{
      const result=await writeSupplierOrderPackage(this,selected.path),file=await this.retain(createReadStream(selected.path,{flags:constants.O_RDONLY|constants.O_NOFOLLOW}),{name:'Supplier_Orders_Workspace.zip',kind:'package',mimeType:'application/zip',maxBytes:MAX_PACKAGE_BYTES});
      return{package:result,file:{id:file.id,name:file.name,bytes:file.bytes,sha256:file.sha256,mimeType:file.mimeType}};
    });
  }
  verifyInput(file,request){
    const bytes=request.expectedBytes??request.bytes,sha=request.expectedSha256??request.sha256;
    if(bytes!==undefined&&(!Number.isSafeInteger(bytes)||bytes!==file.bytes))fail('ORDER_SOURCE_BYTES_DIFFER','The complete original source length differs from the selected input.',409,{expectedBytes:bytes,actualBytes:file.bytes});
    if(sha!==undefined&&(typeof sha!=='string'||sha.toLowerCase()!==file.sha256))fail('ORDER_SOURCE_SHA_DIFFERS','The complete original source SHA-256 differs from the selected input.',409,{expectedSha256:sha,actualSha256:file.sha256});
  }
  async importWorkspace(request){return this.owned(()=>this.#importWorkspace(request));}
  async #importWorkspace(request){
    const input=request.path??request.sourcePath,info=await lstat(input);
    if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>MAX_PACKAGE_BYTES)fail('ORDER_PACKAGE_FILE_INVALID','Select a complete package of up to 8 GiB.');
    const file=await this.retain(createReadStream(input,{flags:constants.O_RDONLY|constants.O_NOFOLLOW}),{name:request.name??basename(input),kind:'package',mimeType:'application/zip',maxBytes:MAX_PACKAGE_BYTES});
    this.verifyInput(file,request);
    const selected={requestId:identifier(request.requestId,'Request ID'),mode:request.mode??'merge',source:{bytes:file.bytes,sha256:file.sha256}};
    return this.perform('import-workspace',selected,()=>readSupplierOrderPackage(this,file.path,{mode:selected.mode,requestId:selected.requestId,packageSha256:file.sha256}));
  }
  close(){
    if(this.closed)return Promise.resolve();if(this.closePromise)return this.closePromise;this.closing=true;
    const task=(async()=>{await Promise.allSettled([...this.active.values(),...this.inFlight]);this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');this.store.close();this.closed=true;})();
    this.closePromise=task.then(value=>{this.closePromise=null;return value;},error=>{this.closePromise=null;throw error;});
    return this.closePromise;
  }
}
function roundedPolicy(policy){
  if(!policy||!Number.isSafeInteger(policy.scale)||policy.scale<0||policy.scale>100||!['half-up','half-even','toward-zero'].includes(policy.mode)||policy.taxBasis!==undefined&&!['line','document'].includes(policy.taxBasis))
    fail('ORDER_ROUNDING_POLICY_INVALID','Choose an explicit decimal scale and supported rounding mode.');
}
