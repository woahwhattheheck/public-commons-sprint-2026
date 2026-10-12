// MIT. Saved Redis product configuration over the original source, preparer and release store.
import { DatabaseSync } from 'node:sqlite';
import { open, lstat, mkdir, realpath, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { acquirePrivateDirectoryWriter } from '../../operations/history.mjs';
import { validateRedisSourceConfig, readRedisSourceFile, openRedisSourceFile } from '../config.mjs';
import { compileRedisMerchantPlan, prepareRedisSeller, verifyPreparedRedisSeller } from '../prepare.mjs';
import { compileRedisQueries, describeRedisQueries } from '../declaration.mjs';

export const REDIS_WORKSPACE_SCHEMA = 'stellar-forge.redis-authoring-workspace.v1';
const TABLES = new Set(['revisions', 'operations']);
const json = value => JSON.stringify(value, null, 2) + '\n';
const clone = value => structuredClone(value);
const normalized = value => Array.isArray(value) ? value.map(normalized) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])])) : value;
const stable = value => JSON.stringify(normalized(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const problem = (code, message, status = 422) => Object.assign(new Error(message), { code, status });
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
function id(value, label = 'Request') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value))
    throw problem('REDIS_WORKSPACE_ID_INVALID', label + ' needs 1–80 letters, numbers, underscores or hyphens.');
  return value;
}
function revisionId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw problem('REDIS_WORKSPACE_REVISION_INVALID', 'Choose a saved source revision.');
  return value;
}
function text(value, maximum, fallback = '') {
  value ??= fallback;
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    throw problem('REDIS_WORKSPACE_TEXT_INVALID', 'Use ordinary text within the displayed length.');
  return value;
}
function fields(value, allowed) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw problem('REDIS_WORKSPACE_INPUT_INVALID', 'Use the fields supported by this workspace operation.');
}
async function privateDirectory(path) {
  const st = await lstat(path);
  if (!st.isDirectory() || st.isSymbolicLink() || process.platform !== 'win32' && ((st.mode & 0o077) || typeof process.getuid === 'function' && st.uid !== process.getuid()))
    throw problem('REDIS_WORKSPACE_PRIVATE_DIRECTORY_REQUIRED', 'Use the original private workspace directory.');
}
async function bytes(path, maximum = 1048576) {
  const file = await open(path, 'r');
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > maximum) throw problem('REDIS_WORKSPACE_FILE_INVALID', 'Expected a regular file within the size limit.');
    const output = Buffer.alloc(Math.min(before.size + 1, maximum + 1)); let length = 0;
    while (length < output.length) {
      const result = await file.read(output, length, output.length - length, null);
      if (!result.bytesRead) break; length += result.bytesRead;
    }
    const data = output.subarray(0, length), after = await file.stat();
    if (data.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw problem('REDIS_WORKSPACE_FILE_CHANGED', 'The selected file changed while it was being read.');
    return data;
  } finally { await file.close(); }
}
async function putNew(path, value) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
}
function decode(value) { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)); }
function database(path, create = false) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0;');
  if (create) db.exec(
    'CREATE TABLE IF NOT EXISTS metadata(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); ' +
    'CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, value TEXT NOT NULL); ' +
    'CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, value TEXT NOT NULL); ' +
    'CREATE TABLE IF NOT EXISTS blobs(sha TEXT PRIMARY KEY, bytes BLOB NOT NULL);');
  return db;
}
function safeError(error) {
  return { code: typeof error?.code === 'string' ? error.code : 'REDIS_WORKSPACE_OPERATION_FAILED',
    message: String(error?.message || 'The operation failed.').toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ').slice(0,600) };
}

export async function createRedisAuthoringWorkspace({ directory, sourceFile, planFile, label = 'Redis merchant', environment = process.env } = {}) {
  if (![directory, sourceFile, planFile].every(value => typeof value === 'string' && value))
    throw problem('REDIS_WORKSPACE_INPUT_FILES_REQUIRED', 'Choose a new directory and the original source and merchant-plan files.');
  const original = await readRedisSourceFile(sourceFile), plan = decode(await bytes(resolve(planFile),262144));
  compileRedisMerchantPlan(original.config.queries, plan);
  const { queries, bindings, ...profile } = clone(original.config);
  let ca;
  if (profile.connection.caFile) {
    ca = await bytes(resolve(dirname(original.path), profile.connection.caFile));
    profile.connection.caFile = 'database-ca.pem';
  }
  const root = resolve(directory); await mkdir(root,{mode:0o700});
  let workspace, lease, db;
  try {
    for (const name of ['materialized','packages','interrupted']) await mkdir(join(root,name),{mode:0o700});
    await putNew(join(root,'workspace.sqlite3'),Buffer.alloc(0));
    await privateDirectory(root);
    lease = await acquirePrivateDirectoryWriter(root); db = database(join(root,'workspace.sqlite3'),true);
    const meta = { schema:REDIS_WORKSPACE_SCHEMA,id:'redis-workspace-'+randomUUID(),label:text(label,200),
      createdAt:now(),head:null,profile,...(ca ? {caSha256:hash(ca)} : {}) };
    db.prepare('INSERT INTO metadata(id,value) VALUES(1,?)').run(JSON.stringify(meta));
    if (ca) db.prepare('INSERT INTO blobs(sha,bytes) VALUES(?,?)').run(hash(ca),ca);
    workspace = new RedisAuthoringWorkspace(root,db,lease,environment);
    const imported = await workspace.save({requestId:'import-'+randomUUID(),expectedHead:null,queries,plan,note:'Imported the selected Redis products and merchant terms'});
    if(imported.status!=='COMPLETED')throw problem(imported.error.code,imported.error.message);
    return workspace;
  } catch (error) {
    if(workspace) await workspace.close().catch(()=>{});
    else { try{db?.close();}finally{await lease?.release().catch(()=>{});} }
    await rm(root,{recursive:true,force:true}); throw error;
  }
}

export async function openRedisAuthoringWorkspace(directory,{environment=process.env}={}) {
  await privateDirectory(resolve(directory)); const root=await realpath(resolve(directory));
  for (const name of ['materialized','packages','interrupted']) await privateDirectory(join(root,name));
  const path=join(root,'workspace.sqlite3'),st=await lstat(path);
  if(!st.isFile() || st.isSymbolicLink() || st.nlink!==1 || process.platform!=='win32' && (st.mode & 0o077))
    throw problem('REDIS_WORKSPACE_DATABASE_INVALID','Choose the original private workspace database.');
  const lease=await acquirePrivateDirectoryWriter(root);
  let db;
  try {
    db=database(path);
    const workspace=new RedisAuthoringWorkspace(root,db,lease,environment);
    if(workspace.metadata().schema!==REDIS_WORKSPACE_SCHEMA) throw problem('REDIS_WORKSPACE_SCHEMA_INVALID','This is not a supported Redis authoring workspace.');
    workspace.recover();
    return workspace;
  } catch(error) { try{db?.close();}finally{await lease.release();} throw error; }
}

export class RedisAuthoringWorkspace {
  constructor(root,db,lease,environment=process.env) {
    this.root=root;this.db=db;this.lease=lease;this.environment={...environment};
    this.queue=Promise.resolve();this.active=new Set();this.releaseConsole=null;this.closing=null;this.closed=false;
  }
  writable() { if(this.closing||this.closed)throw problem('REDIS_WORKSPACE_CLOSING','The workspace is closing.',409); }
  metadata() {
    const row=this.db.prepare('SELECT value FROM metadata WHERE id=1').get();
    if(!row)throw problem('REDIS_WORKSPACE_DATABASE_INVALID','Workspace metadata is missing.');
    return JSON.parse(row.value);
  }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {const result=action();this.db.exec('COMMIT');return result;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  record(table,key,required=true) {
    if(!TABLES.has(table))throw new TypeError('Unknown workspace table.');
    const row=this.db.prepare('SELECT value FROM '+table+' WHERE id=?').get(key);
    if(!row&&required)throw problem('REDIS_WORKSPACE_RECORD_NOT_FOUND','The selected saved record does not exist.',404);
    return row?JSON.parse(row.value):null;
  }
  putOperation(record) {
    this.db.prepare('INSERT INTO operations(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
      .run(record.id,JSON.stringify(record));
  }
  revision(value=this.metadata().head) { return this.record('revisions',revisionId(value)); }
  operation(value) { return this.record('operations',id(value)); }
  page(table,{after='',limit=30}={}) {
    if(!TABLES.has(table)||!Number.isInteger(limit)||limit<1||limit>100)throw problem('REDIS_WORKSPACE_PAGE_INVALID','Use a page size from 1 to 100.');
    let before=Number.MAX_SAFE_INTEGER;
    if(after) {
      const cursor=this.db.prepare('SELECT rowid AS position FROM '+table+' WHERE id=?').get(after);
      if(!cursor)throw problem('REDIS_WORKSPACE_PAGE_INVALID','The selected page cursor is missing.');
      before=cursor.position;
    }
    const rows=this.db.prepare('SELECT value FROM '+table+' WHERE rowid<? ORDER BY rowid DESC LIMIT ?').all(before,limit+1).map(row=>JSON.parse(row.value));
    const more=rows.length>limit;if(more)rows.pop();
    return {items:rows,nextCursor:more?rows.at(-1).id:null};
  }
  state() {
    const meta=this.metadata(),revisions=this.page('revisions'),operations=this.page('operations');
    return {schema:REDIS_WORKSPACE_SCHEMA,workspace:{id:meta.id,label:meta.label,createdAt:meta.createdAt,head:meta.head},
      connection:clone(meta.profile.connection),limits:Object.fromEntries(Object.entries(meta.profile).filter(([key])=>!['schema','connection'].includes(key))),
      current:this.revision(),revisions:{...revisions,items:revisions.items.map(value=>this.summary(value))},
      operations:{...operations,items:operations.items.map(value=>this.operationSummary(value))},
      releaseConsole:this.releaseConsole?{url:this.releaseConsole.url}:null};
  }
  summary(value) {
    return {id:value.id,parent:value.parent,createdAt:value.createdAt,note:value.note,
      queryNames:Object.keys(value.source.queries),routes:value.plan.routes.length,publicOrigin:value.plan.publicOrigin,payment:value.plan.payment};
  }
  operationSummary(value) {
    return {id:value.id,kind:value.kind,status:value.status,revisionId:value.input.revisionId??value.result?.revisionId??null,
      createdAt:value.createdAt,finishedAt:value.finishedAt,attempts:value.attempts,error:value.error,
      ...(value.kind==='prepare'&&value.result?{package:value.result}:{}),
      ...(value.kind==='stage'&&value.result?{release:value.result}:{}),
      resumable:value.status==='INTERRUPTED'};
  }
  validate(queries,plan) {
    const meta=this.metadata(),source={...clone(meta.profile),queries:clone(queries)};
    validateRedisSourceConfig(source);
    const compiled=compileRedisMerchantPlan(source.queries,clone(plan));
    if(Buffer.byteLength(json(source))>262144||Buffer.byteLength(json(plan))>262144)
      throw problem('REDIS_WORKSPACE_CONFIGURATION_TOO_LARGE','Keep each source and merchant-plan file within 256 KiB.');
    return {source,plan:clone(plan),compiled,description:describeRedisQueries(compileRedisQueries(source.queries))};
  }
  review(input) {
    fields(input,['queries','plan']);
    const {source,plan,compiled,description}=this.validate(input.queries,input.plan);
    return {digest:hash(stable({source,plan})),queries:description,publicOrigin:plan.publicOrigin,
      routes:compiled.service.routes.map(route=>({id:route.id,url:route.offer.resource.url,payment:route.offer.accepts}))};
  }
  save(input) {
    fields(input,['requestId','expectedHead','queries','plan','note']);
    this.validate(input.queries,input.plan);text(input.note,2000);
    if(input.expectedHead!==null)revisionId(input.expectedHead);
    return this.execute('save',input);
  }
  restore(input) {
    fields(input,['requestId','expectedHead','revisionId','note']);
    const selected=this.revision(input.revisionId);
    return this.save({requestId:input.requestId,expectedHead:input.expectedHead,queries:selected.source.queries,plan:selected.plan,
      note:text(input.note,2000,'Restored saved configuration '+selected.id)});
  }
  preview(input) {
    fields(input,['requestId','revisionId','query','input']);
    const selected=this.revision(input.revisionId);
    if(!Object.hasOwn(selected.source.queries,input.query)||!plain(input.input))throw problem('REDIS_WORKSPACE_QUERY_INVALID','Choose a saved product and an input object.');
    return this.execute('preview',input);
  }
  prepare(input) {
    fields(input,['requestId','revisionId']);this.revision(input.revisionId);
    return this.execute('prepare',input);
  }
  stage(input) {
    fields(input,['requestId','packageId','releaseId','label','runtime']);
    const prepared=this.operation(input.packageId);
    if(prepared.kind!=='prepare'||prepared.status!=='COMPLETED')throw problem('REDIS_WORKSPACE_PACKAGE_REQUIRED','Choose a completed prepared merchant package.');
    if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.releaseId??''))throw problem('REDIS_WORKSPACE_RELEASE_ID_INVALID','Use a new release ID with 1–64 lowercase letters, numbers, underscores or hyphens.');
    text(input.label,240); if(input.runtime!==undefined) {
      fields(input.runtime,['port','facilitator','allowLocalFacilitator']);
      if(input.runtime.port!==undefined&&(!Number.isInteger(input.runtime.port)||input.runtime.port<0||input.runtime.port>65535))
        throw problem('REDIS_WORKSPACE_RUNTIME_INVALID','Use a seller port from 0 to 65535.');
    }
    return this.execute('stage',input);
  }
  resume(requestId) {
    const previous=this.operation(requestId);
    if(previous.status!=='INTERRUPTED')return Promise.resolve(previous);
    return this.execute(previous.kind,previous.input,true);
  }
  recover() {
    this.transaction(()=>{
      for(const row of this.db.prepare('SELECT value FROM operations').all()){
        const record=JSON.parse(row.value);
        if(record.status==='RUNNING'){
          record.status='INTERRUPTED';record.interruptedAt=now();
          record.error={code:'REDIS_WORKSPACE_OPERATION_INTERRUPTED',message:'The previous workspace process ended. Resume this exact request or inspect its retained outcome.'};
          this.putOperation(record);
        }
      }
    });
  }
  execute(kind,input,resume=false) {
    this.writable();id(input.requestId);
    if(Buffer.byteLength(JSON.stringify(input))>524288)throw problem('REDIS_WORKSPACE_INPUT_TOO_LARGE','Use a request below 512 KiB.');
    const captured=clone(input),digest=hash(stable({kind,input:captured}));
    const action=this.queue.catch(()=>{}).then(async()=>{
      this.writable();
      let record=this.record('operations',captured.requestId,false);
      if(record){
        if(record.digest!==digest||record.kind!==kind)throw problem('REDIS_WORKSPACE_REQUEST_CHANGED','This request ID already belongs to different input.',409);
        if(!resume||record.status!=='INTERRUPTED')return record;
        record={...record,status:'RUNNING',attempts:record.attempts+1,resumedAt:now()};
        delete record.error;delete record.finishedAt;
      }else record={id:captured.requestId,kind,input:captured,digest,status:'RUNNING',attempts:1,createdAt:now()};
      this.putOperation(record);
      try {record.result=await this.perform(record);record.status='COMPLETED';}
      catch(error){record.status='FAILED';record.error=safeError(error);}
      record.finishedAt=now();this.putOperation(record);return clone(record);
    });
    this.queue=action;return action;
  }
  async perform(record) {
    const input=record.input;
    if(record.kind==='save'){
      const prior=this.db.prepare('SELECT value FROM revisions WHERE request_id=?').get(record.id);
      if(prior)return {revisionId:JSON.parse(prior.value).id,recovered:true};
      const {source,plan}=this.validate(input.queries,input.plan);
      return this.transaction(()=>{
        const meta=this.metadata();
        if(meta.head!==input.expectedHead)throw problem('REDIS_WORKSPACE_HEAD_CHANGED','Another saved revision is current. Refresh before saving these edits.',409);
        const contents={parent:meta.head,source,plan,note:text(input.note,2000)},key=hash(stable(contents));
        const revision={...contents,id:key,createdAt:now(),requestId:record.id};
        this.db.prepare('INSERT INTO revisions(id,request_id,value) VALUES(?,?,?)').run(key,record.id,JSON.stringify(revision));
        meta.head=key;this.db.prepare('UPDATE metadata SET value=? WHERE id=1').run(JSON.stringify(meta));
        return {revisionId:key};
      });
    }
    if(record.kind==='preview'){
      const materialized=await this.materialize(input.revisionId),controller=new AbortController();
      this.active.add(controller);let source;
      try{
        ({source}=await openRedisSourceFile(join(materialized,'source.json'),{environment:this.environment}));
        if(this.closing)controller.abort();
        const result=await source.query(input.query,input.input,{signal:controller.signal});
        return {revisionId:input.revisionId,query:input.query,input:clone(input.input),observedAt:now(),data:result};
      }finally{await source?.close();this.active.delete(controller);}
    }
    if(record.kind==='prepare'){
      const directory=join(this.root,'packages',record.id),selected=this.revision(input.revisionId);
      const exists=await lstat(directory).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
      if(exists){
        if(record.attempts<2)throw problem('REDIS_WORKSPACE_PACKAGE_EXISTS','This package destination already exists.',409);
        try{
          const prepared=await verifyPreparedRedisSeller(directory);
          if(stable(decode(await bytes(join(directory,'merchant-plan.json'),262144)))!==stable(selected.plan))
            throw problem('REDIS_WORKSPACE_PACKAGE_CHANGED','The retained package belongs to a different plan.',409);
          const retained=decode(await bytes(join(directory,'source.json'),262144));
          const {bindings,...actual}=retained;
          if(stable(actual)!==stable(selected.source))throw problem('REDIS_WORKSPACE_PACKAGE_CHANGED','The retained source differs from the saved revision.',409);
          return {revisionId:input.revisionId,directory,...prepared,recovered:true};
        }catch(error){
          if(error.code==='REDIS_WORKSPACE_PACKAGE_CHANGED'||!['ENOENT',undefined].includes(error.code))throw error;
          await rename(directory,join(this.root,'interrupted',record.id+'-attempt-'+(record.attempts-1)));
        }
      }
      const materialized=await this.materialize(input.revisionId);
      const prepared=await prepareRedisSeller({sourceFile:join(materialized,'source.json'),planFile:join(materialized,'merchant-plan.json'),directory});
      return {revisionId:input.revisionId,...prepared};
    }
    if(record.kind==='stage'){
      const lifecycle=await import('../../../sf82-seller-pilot/releases.mjs');
      const {prepareRedisRelease}=await import('../../../sf82-seller-pilot/release-redis.mjs');
      const packageRecord=this.operation(input.packageId),directory=packageRecord.result.directory;
      const prepared=await prepareRedisRelease(directory);
      const root=await this.ensureReleaseStore();
      const runtime=lifecycle.normalizeReleaseRuntime(input.runtime??{port:0});
      if(record.attempts>1){
        const prior=await lifecycle.inspectRelease(root,input.releaseId).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(prior){
          if(prior.redis?.executionSha256!==prepared.redis.executionSha256||prior.label!==(input.label??input.releaseId)||stable(prior.runtime)!==stable(runtime))
            throw problem('REDIS_WORKSPACE_RELEASE_CHANGED','The existing release differs from this retained request.',409);
          return {releaseId:prior.id,digest:prior.digest,packageId:input.packageId,revisionId:packageRecord.input.revisionId,recovered:true};
        }
      }
      const release=await lifecycle.stageRelease(root,{id:input.releaseId,label:input.label,redisPackage:directory,runtime});
      return {releaseId:release.id,digest:release.digest,packageId:input.packageId,revisionId:packageRecord.input.revisionId};
    }
    throw problem('REDIS_WORKSPACE_OPERATION_INVALID','Unsupported workspace operation.');
  }
  async materialize(value) {
    const revision=this.revision(value),root=join(this.root,'materialized',revision.id),meta=this.metadata();
    const files={'source.json':Buffer.from(json(revision.source)),'merchant-plan.json':Buffer.from(json(revision.plan))};
    if(meta.caSha256){
      const row=this.db.prepare('SELECT bytes FROM blobs WHERE sha=?').get(meta.caSha256);
      if(!row||hash(row.bytes)!==meta.caSha256)throw problem('REDIS_WORKSPACE_CERTIFICATE_CHANGED','The retained database certificate is missing or changed.');
      files['database-ca.pem']=Buffer.from(row.bytes);
    }
    try{await mkdir(root,{mode:0o700});}
    catch(error){if(error.code!=='EEXIST')throw error;await privateDirectory(root);}
    for(const [name,value]of Object.entries(files)){
      const path=join(root,name);
      const exists=await lstat(path).then(stat=>stat,error=>{if(error.code==='ENOENT')return null;throw error;});
      if(exists&&(!exists.isFile()||exists.isSymbolicLink()||exists.nlink!==1))
        throw problem('REDIS_WORKSPACE_MATERIALIZATION_INVALID','A materialized file is not an ordinary workspace file.',409);
      if(exists&&(await bytes(path,1048576)).equals(value))continue;
      // The database owns this disposable materialization. Atomically finish a partial write after interruption.
      const temporary=join(root,'.'+name+'-'+randomUUID()+'.tmp');
      try {await putNew(temporary,value);await rename(temporary,path);}
      finally {await rm(temporary,{force:true});}
    }
    const directory=await open(root,'r');try{await directory.sync();}finally{await directory.close();}
    return root;
  }
  async file(packageId,name) {
    const operation=this.operation(packageId);
    if(operation.kind!=='prepare'||operation.status!=='COMPLETED')throw problem('REDIS_WORKSPACE_PACKAGE_REQUIRED','Choose a completed package.');
    const bundle=await verifyPreparedRedisSeller(operation.result.directory);
    if(typeof name!=='string'||!['openapi.json',...Object.keys(bundle.files??{}).filter(value=>value.startsWith('client/'))].includes(name))
      throw problem('REDIS_WORKSPACE_CUSTOMER_FILE_INVALID','Choose an original public customer file.',404);
    const data=await bytes(join(operation.result.directory,name),16777216);
    return {name:name.split('/').at(-1),bytes:data,type:name.endsWith('.json')?'application/json':name.endsWith('.mjs')?'text/javascript':'text/plain'};
  }
  async ensureReleaseStore() {
    const {initReleaseStore,readReleaseState}=await import('../../../sf82-seller-pilot/releases.mjs');
    const root=join(this.root,'releases');
    const exists=await lstat(root).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
    if(!exists){
      const temporary=join(this.root,'interrupted','release-store-'+randomUUID());
      await initReleaseStore(temporary);await rename(temporary,root);
      const directory=await open(this.root,'r');try{await directory.sync();}finally{await directory.close();}
    }
    await readReleaseState(root);return root;
  }
  openReleases() {
    this.writable();
    const action=this.queue.catch(()=>{}).then(async()=>{
      this.writable();
      if(!this.releaseConsole){
        const {startReleaseConsole}=await import('../../../sf82-seller-pilot/release-console.mjs');
        this.releaseConsole=await startReleaseConsole(await this.ensureReleaseStore(),{port:0,env:this.environment});
      }
      return {url:this.releaseConsole.url,operatorUrl:this.releaseConsole.operatorUrl};
    });
    this.queue=action;return action;
  }
  close() {
    if(this.closing)return this.closing;
    this.closing=(async()=>{
      for(const controller of this.active)controller.abort();
      await this.queue.catch(()=>{});
      try{await this.releaseConsole?.close();}finally{
        try{this.db.close();}finally{this.closed=true;await this.lease.release();}
      }
    })();
    return this.closing;
  }
}
