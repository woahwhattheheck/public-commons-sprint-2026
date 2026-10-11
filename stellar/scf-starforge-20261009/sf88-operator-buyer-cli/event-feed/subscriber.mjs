// MIT — Durable event delivery on the original SF88 buyer and payment journal.
import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { open, lstat, link, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { absolute, privateDirectory, readJson, readBytes, writeBytes, jsonBytes,
  parseJson, exists, digest, need, safeCode, syncDirectory } from '../node/store.mjs';

export const SUBSCRIPTION_SCHEMA = 'stellar-forge.event-feed-subscription.v1';
export const PAGE_SCHEMA = 'stellar-forge.webhook-feed-page.v1';
const HEX = /^[a-f0-9]{64}$/;
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const clone = value => parseJson(jsonBytes(value));
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const issue = error => safeCode(error?.code, 'EVENT_FEED_OPERATION_FAILED');

function inputDefinition(options) {
  const {directory, config, runtimeDirectory, buyerStateDirectory,
    id = 'events', feedId, pageSize = 100, startCursor = null, afterSequence = 0} = options;
  need(identity(id) && identity(feedId), 'FEED_ID_REQUIRED');
  need(integer(pageSize) && pageSize >= 1 && pageSize <= 1000, 'FEED_PAGE_SIZE_INVALID');
  need(integer(afterSequence) && (startCursor === null ? afterSequence === 0 :
    typeof startCursor === 'string' && startCursor.length > 0 && startCursor.length <= 8192),
  'FEED_START_CURSOR_INVALID');
  const selected = clone(config);
  need(selected.operation && (selected.operation.method ?? 'GET') === 'GET', 'FEED_GET_CONFIGURATION_REQUIRED');
  const endpoint = new URL(selected.operation.url);
  need(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.hash,
    'FEED_HTTPS_ENDPOINT_REQUIRED');
  need(!endpoint.searchParams.has('cursor') && !endpoint.searchParams.has('limit'), 'FEED_BASE_ENDPOINT_REQUIRED');
  need(selected.operation.bodyFile === undefined && selected.operation.bodyBytes === undefined &&
    selected.operation.bodySha256 === undefined && selected.operation.ticketFile === undefined &&
    selected.operation.ticketHeader === undefined && selected.operation.orderReference === undefined,
  'FEED_PAGE_CONFIGURATION_REQUIRED');
  need(selected.responseFile === undefined || selected.responseFile !== null &&
    typeof selected.responseFile === 'object' && !Array.isArray(selected.responseFile), 'FEED_RESPONSE_OPTIONS_INVALID');
  for (const key of ['expectedSha256', 'expectedBytes', 'stream'])
    need(selected.responseFile?.[key] === undefined, 'FEED_STATIC_RESPONSE_PIN_UNSUPPORTED');
  const maxBytes = selected.responseFile?.maxBytes ?? 4194304;
  need(integer(maxBytes) && maxBytes >= 1 && maxBytes <= 268435456, 'FEED_RESPONSE_LIMIT_INVALID');
  if (selected.responseFile?.expectedContentType !== undefined)
    need(selected.responseFile.expectedContentType === 'application/json', 'FEED_JSON_RESPONSE_REQUIRED');
  return {schema:SUBSCRIPTION_SCHEMA, id, subscriptionKey:randomUUID(), feedId,
    directory:absolute(directory), runtimeDirectory:absolute(runtimeDirectory),
    buyerStateDirectory:absolute(buyerStateDirectory), endpoint:endpoint.href,
    pageSize, startCursor, afterSequence, startOrigin:startCursor===null ? 'retained' : 'cursor',
    maxBytes, configuration:selected,
    createdAt:new Date().toISOString()};
}

function database(directory) {
  const db = new DatabaseSync(join(directory, 'subscription.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  return db;
}
function install(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS definition (singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL, sha256 TEXT NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS checkpoint (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL, cursor TEXT, last_sequence INTEGER NOT NULL, store_id TEXT, feed_revision TEXT, through_sequence INTEGER, completed INTEGER NOT NULL, cycle INTEGER NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS pages (ordinal INTEGER PRIMARY KEY, cycle INTEGER NOT NULL, checkpoint_revision INTEGER NOT NULL, after_sequence INTEGER NOT NULL, through_sequence INTEGER, request_cursor TEXT, request_url TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, response BLOB, response_sha256 TEXT, accepted_at TEXT, item_count INTEGER, native_status TEXT, http_status INTEGER, recovered INTEGER, error_code TEXT);' +
    'CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY, source_id TEXT NOT NULL, event_id TEXT NOT NULL, page_ordinal INTEGER NOT NULL REFERENCES pages(ordinal), body TEXT NOT NULL, UNIQUE(source_id,event_id));' +
    'CREATE TABLE IF NOT EXISTS exports (destination TEXT PRIMARY KEY, body TEXT NOT NULL);'
  );
}
function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = action(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export async function createSubscription(options) {
  const config = typeof options.config === 'string'
    ? await readJson(absolute(options.config), 65536) : options.config;
  const definition = inputDefinition({...options, config});
  await privateDirectory(definition.directory);
  need(!await exists(join(definition.directory, 'subscription.sqlite')), 'FEED_SUBSCRIPTION_ALREADY_EXISTS');
  const db = database(definition.directory);
  try {
    install(db);
    transaction(db, () => {
      need(!db.prepare('SELECT singleton FROM definition').get(), 'FEED_SUBSCRIPTION_ALREADY_EXISTS');
      const raw = jsonBytes(definition).toString('utf8');
      db.prepare('INSERT INTO definition VALUES(1,?,?)').run(raw, digest(raw));
      db.prepare('INSERT INTO checkpoint VALUES(1,0,?,?,NULL,NULL,NULL,0,1)')
        .run(definition.startCursor, definition.afterSequence);
    });
  } finally { db.close(); }
  await syncDirectory(definition.directory);
  return openSubscription(definition.directory);
}

export async function openSubscription(directory) {
  directory = await privateDirectory(absolute(directory), {create:false});
  need(await exists(join(directory, 'subscription.sqlite')), 'FEED_SUBSCRIPTION_REQUIRED');
  const info = await lstat(join(directory, 'subscription.sqlite'));
  need(info.isFile() && !info.isSymbolicLink(), 'FEED_DATABASE_FILE_REQUIRED');
  const db = database(directory);
  try {
    const row = db.prepare('SELECT body,sha256 FROM definition WHERE singleton=1').get();
    need(row && digest(row.body) === row.sha256, 'FEED_DEFINITION_CHANGED');
    const definition = JSON.parse(row.body);
    need(definition.schema === SUBSCRIPTION_SCHEMA && definition.directory === directory,
      'FEED_SUBSCRIPTION_BINDING_CHANGED');
    return new EventFeedSubscription(db, definition);
  } catch (error) { db.close(); throw error; }
}

export function validatePage(value, plan, definition, checkpoint) {
  need(value && typeof value === 'object' && value.schema === PAGE_SCHEMA &&
    identity(value.storeId) && value.feedId === definition.feedId && HEX.test(value.feedRevision),
  'FEED_PAGE_IDENTITY_INVALID');
  if (checkpoint.store_id !== null)
    need(value.storeId === checkpoint.store_id && value.feedRevision === checkpoint.feed_revision,
      'FEED_IDENTITY_CHANGED');
  const page = value.page;
  const retainedOrigin = checkpoint.revision === 0 && checkpoint.store_id === null &&
    plan.ordinal === 1 && plan.request_cursor === null && plan.after_sequence === 0 &&
    definition.startCursor === null;
  need(page && integer(page.afterSequence) &&
    (retainedOrigin ? page.afterSequence >= plan.after_sequence : page.afterSequence === plan.after_sequence) &&
    integer(page.throughSequence) && page.throughSequence >= page.afterSequence &&
    (plan.through_sequence === null || page.throughSequence === plan.through_sequence) &&
    Array.isArray(value.items) && value.items.length <= definition.pageSize &&
    page.returned === value.items.length && typeof page.hasMore === 'boolean' &&
    typeof page.resumeCursor === 'string' && page.resumeCursor.length > 0 && page.resumeCursor.length <= 8192 &&
    (page.hasMore ? typeof page.nextCursor === 'string' && page.nextCursor.length > 0 &&
      page.nextCursor.length <= 8192 && page.nextCursor !== plan.request_cursor : page.nextCursor === null),
  'FEED_PAGE_CONTINUITY_INVALID');
  let previous = page.afterSequence;
  const ids = new Set();
  for (const event of value.items) {
    need(event && integer(event.sequence) && event.sequence > previous &&
      event.sequence <= page.throughSequence && identity(event.sourceId) && identity(event.eventId) &&
      typeof event.type === 'string' && event.type.length <= 256 &&
      instant(event.receivedAt) && (event.occurredAt === null || instant(event.occurredAt)) &&
      event.payload !== null && typeof event.payload === 'object' && !Array.isArray(event.payload) &&
      HEX.test(event.sourceBodySha256) && HEX.test(event.payloadSha256) &&
      digest(JSON.stringify(event.payload)) === event.payloadSha256, 'FEED_EVENT_INVALID');
    const key = JSON.stringify([event.sourceId,event.eventId]);
    need(!ids.has(key), 'FEED_EVENT_ID_REUSED');
    ids.add(key); previous = event.sequence;
  }
  need(!page.hasMore || value.items.length > 0 && previous < page.throughSequence,
    'FEED_PAGE_DID_NOT_ADVANCE');
  return {lastSequence:page.hasMore ? previous : page.throughSequence,
    nextCursor:page.hasMore ? page.nextCursor : page.resumeCursor, complete:!page.hasMore};
}

export class EventFeedSubscription {
  constructor(db, definition) {
    this.db = db;
    Object.defineProperty(this, 'definition', {value:freeze(definition), enumerable:true});
    this._buyer = null;
  }
  close() { this.db.close(); }
  checkpoint() { return this.db.prepare('SELECT * FROM checkpoint WHERE singleton=1').get(); }
  async buyer() {
    if (!this._buyer) {
      const {Buyer} = await import('../node/client.mjs');
      this._buyer = new Buyer({runtimeDirectory:this.definition.runtimeDirectory,
        stateDirectory:this.definition.buyerStateDirectory});
    }
    return this._buyer;
  }
  plan({cycle} = {}) {
    need(cycle === undefined || Number.isSafeInteger(cycle) && cycle >= 1, 'FEED_CYCLE_INVALID');
    return transaction(this.db, () => {
      const cp = this.checkpoint();
      if (cycle !== undefined && (cp.cycle > cycle || cp.cycle === cycle && cp.completed))
        return null;
      const existing = this.db.prepare('SELECT * FROM pages WHERE response IS NULL ORDER BY ordinal LIMIT 1').get();
      if (existing) {
        need(cycle === undefined || existing.cycle === cycle, 'FEED_COLLECTION_CYCLE_CHANGED');
        return existing;
      }
      need(cycle === undefined || (cp.completed ? cp.cycle+1 : cp.cycle) === cycle,
        'FEED_COLLECTION_CYCLE_CHANGED');
      const ordinal = Number(this.db.prepare('SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM pages').get().ordinal);
      const url = new URL(this.definition.endpoint);
      url.searchParams.set('limit', String(this.definition.pageSize));
      if (cp.cursor !== null) url.searchParams.set('cursor',cp.cursor);
      const operationId = 'feed-' + digest(this.definition.subscriptionKey).slice(0,24) + '-' + ordinal;
      this.db.prepare('INSERT INTO pages(ordinal,cycle,checkpoint_revision,after_sequence,through_sequence,request_cursor,request_url,operation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(ordinal, cp.completed ? cp.cycle+1 : cp.cycle, cp.revision, cp.last_sequence,
          cp.completed ? null : cp.through_sequence, cp.cursor, url.href, operationId, new Date().toISOString());
      return this.db.prepare('SELECT * FROM pages WHERE ordinal=?').get(ordinal);
    });
  }
  pending() {
    return this.db.prepare('SELECT * FROM pages WHERE response IS NULL ORDER BY ordinal LIMIT 1').get() ?? null;
  }
  configuration(plan) {
    const config = clone(this.definition.configuration);
    config.operation = {...config.operation, intentId:plan.operation_id, url:plan.request_url, method:'GET'};
    config.responseFile = {...config.responseFile, maxBytes:this.definition.maxBytes,
      expectedContentType:'application/json'};
    return config;
  }
  async originalResult(plan, {execute, signal} = {}) {
    const buyer = await this.buyer();
    let operation = buyer.operation(plan.operation_id);
    if (!await exists(join(operation.directory,'operation.json'))) {
      if (!execute) return {state:'PREPARATION_PENDING', operationId:plan.operation_id};
      try { operation = await buyer.fromConfig(this.configuration(plan)); }
      catch (error) {
        if (error.code !== 'INTENT_ALREADY_EXISTS_USE_RECOVER') throw error;
        operation = buyer.operation(plan.operation_id);
      }
    }
    const inspected = await operation.inspect();
    let result = await operation.recover();
    if (!result && inspected.state === 'PREPARED' && execute) {
      try { result = await operation.execute({review:await operation.review(), signal}); }
      catch (error) {
        if (error.code !== 'ATTEMPT_ALREADY_RECORDED_USE_RECOVER') throw error;
        result = await operation.recover();
      }
    }
    if (!result) return {state:inspected.state === 'PREPARED' ? 'PREPARED' : 'RECOVERY_PENDING',
      operationId:plan.operation_id, originalState:inspected.state};
    // A recovered complete response is usable even when the parent process lost
    // its exit record. The original native status remains attached to every page.
    const native = result.native;
    const received = Number.isInteger(native.httpStatus) && native.httpStatus >= 200 && native.httpStatus < 300 &&
      !native.error && !native.evidenceError && !native.responseCleanupError &&
      result.delivery.status === 'SAVED' &&
      (result.ok || result.record.recovered && result.record.runtimeError === 'PROCESS_EXIT_NOT_RECORDED');
    if (!received) {
      let errorCode = 'FEED_ORIGINAL_ATTEMPT_INCOMPLETE';
      if (result.delivery.status === 'SAVED') {
        try {
          const body = await result.json({limit:this.definition.maxBytes,signal});
          errorCode = safeCode(typeof body.error === 'string' ? body.error : body.error?.code, errorCode);
        } catch {}
      }
      return {state:'ORIGINAL_ATTEMPT_RECORDED', operationId:plan.operation_id,
        nativeStatus:result.status, httpStatus:native.httpStatus ?? null, errorCode};
    }
    const bytes = await result.bytes({limit:this.definition.maxBytes,signal});
    return {state:'RESPONSE_RECEIVED', bytes, nativeStatus:result.status,
      httpStatus:native.httpStatus, recovered:result.record.recovered === true};
  }
  accept(plan, response) {
    const raw = Buffer.from(response.bytes);
    const hash = digest(raw);
    const value = parseJson(raw);
    return transaction(this.db, () => {
      const current = this.db.prepare('SELECT * FROM pages WHERE ordinal=?').get(plan.ordinal);
      need(current && current.operation_id === plan.operation_id, 'FEED_PAGE_PLAN_CHANGED');
      if (current.response !== null) {
        need(current.response_sha256 === hash, 'FEED_PAGE_RESPONSE_CHANGED');
        return {complete:JSON.parse(Buffer.from(current.response).toString('utf8')).page.hasMore === false,
          checkpoint:this.checkpoint(), page:current.ordinal, replay:true};
      }
      const cp = this.checkpoint();
      need(cp.revision === current.checkpoint_revision, 'FEED_CHECKPOINT_CHANGED');
      const advancement = validatePage(value,current,this.definition,cp);
      const insert = this.db.prepare('INSERT INTO events(sequence,source_id,event_id,page_ordinal,body) VALUES(?,?,?,?,?)');
      for (const event of value.items) {
        need(!this.db.prepare('SELECT sequence FROM events WHERE sequence=? OR (source_id=? AND event_id=?)')
          .get(event.sequence,event.sourceId,event.eventId), 'FEED_EVENT_ID_REUSED');
        insert.run(event.sequence,event.sourceId,event.eventId,current.ordinal,JSON.stringify(event));
      }
      this.db.prepare('UPDATE pages SET response=?,response_sha256=?,accepted_at=?,item_count=?,native_status=?,http_status=?,recovered=?,error_code=NULL,after_sequence=? WHERE ordinal=?')
        .run(raw,hash,new Date().toISOString(),value.items.length,response.nativeStatus ?? null,
          response.httpStatus ?? null,response.recovered ? 1:0,value.page.afterSequence,current.ordinal);
      this.db.prepare('UPDATE checkpoint SET revision=revision+1,cursor=?,last_sequence=?,store_id=?,feed_revision=?,through_sequence=?,completed=?,cycle=? WHERE singleton=1')
        .run(advancement.nextCursor,advancement.lastSequence,value.storeId,value.feedRevision,
          value.page.throughSequence,advancement.complete ? 1:0,current.cycle);
      return {complete:advancement.complete,checkpoint:this.checkpoint(),page:current.ordinal,
        events:value.items.length,responseSha256:hash,replay:false};
    });
  }
  async _receive(plan, options) {
    try {
      const received = await this.originalResult(plan,options);
      if (received.state !== 'RESPONSE_RECEIVED') {
        if (received.errorCode) this.db.prepare('UPDATE pages SET error_code=? WHERE ordinal=? AND response IS NULL')
          .run(received.errorCode,plan.ordinal);
        return received;
      }
      return {state:'PAGE_RECEIVED',...this.accept(plan,received)};
    } catch (error) {
      this.db.prepare('UPDATE pages SET error_code=? WHERE ordinal=? AND response IS NULL').run(issue(error),plan.ordinal);
      throw error;
    }
  }
  async collect({signal, maxPages = Number.MAX_SAFE_INTEGER, onPage} = {}) {
    need(Number.isSafeInteger(maxPages) && maxPages >= 1, 'FEED_PAGE_LIMIT_INVALID');
    let pages = 0, cycle;
    while (pages < maxPages) {
      need(!signal?.aborted, 'FEED_COLLECTION_ABORTED');
      const plan = this.plan({cycle});
      if (!plan) return {state:'CAUGHT_UP',pages,cycle,subscription:this.inspect()};
      cycle ??= plan.cycle;
      const result = await this._receive(plan, {execute:true,signal});
      if (result.state !== 'PAGE_RECEIVED') return {...result,pages,cycle,subscription:this.inspect()};
      pages += 1;
      if (onPage) await onPage(result);
      if (result.complete) return {state:'CAUGHT_UP',pages,cycle,subscription:this.inspect()};
    }
    return {state:'PAGE_LIMIT_REACHED',pages,cycle,subscription:this.inspect()};
  }
  async recover({signal} = {}) {
    const plan = this.pending();
    if (!plan) return {state:'NO_PENDING_PAGE',subscription:this.inspect()};
    const result = await this._receive(plan,{execute:false,signal});
    return {...result,subscription:this.inspect()};
  }
  inspect({limit=20} = {}) {
    need(integer(limit) && limit >= 1 && limit <= 1000, 'FEED_INSPECTION_LIMIT_INVALID');
    const checkpoint = this.checkpoint();
    const totals = this.db.prepare('SELECT COUNT(*) AS events FROM events').get();
    const accepted = this.db.prepare('SELECT COUNT(*) AS pages FROM pages WHERE response IS NOT NULL').get();
    const pending = this.pending();
    const endpoint = new URL(this.definition.endpoint);
    return {schema:'stellar-forge.event-feed-status.v1',id:this.definition.id,feedId:this.definition.feedId,
      source:endpoint.origin+endpoint.pathname,createdAt:this.definition.createdAt,
      storeId:checkpoint.store_id,feedRevision:checkpoint.feed_revision,
      state:pending ? 'PAGE_PENDING' : checkpoint.completed ? 'CAUGHT_UP' : 'READY',
      cycle:checkpoint.cycle,checkpointRevision:checkpoint.revision,lastSequence:checkpoint.last_sequence,
      throughSequence:checkpoint.through_sequence,
      startOrigin:this.definition.startCursor===null ? 'retained' : 'cursor',
      originSequence:this.db.prepare('SELECT after_sequence AS origin FROM pages WHERE response IS NOT NULL ORDER BY ordinal LIMIT 1').get()?.origin ?? null,
      events:Number(totals.events),pages:Number(accepted.pages),
      pending:pending ? {ordinal:pending.ordinal,operationId:pending.operation_id,cycle:pending.cycle,
        errorCode:pending.error_code,createdAt:pending.created_at}:null,
      recentPages:this.db.prepare('SELECT ordinal,cycle,operation_id AS operationId,item_count AS events,response_sha256 AS responseSha256,native_status AS nativeStatus,http_status AS httpStatus,recovered,accepted_at AS acceptedAt,error_code AS errorCode FROM pages ORDER BY ordinal DESC LIMIT ?').all(limit),
      recentEvents:this.db.prepare('SELECT body FROM events ORDER BY sequence DESC LIMIT ?').all(limit).map(row=>JSON.parse(row.body))};
  }
  async exportEvents(destination) {
    destination = absolute(destination);
    const snapshot = transaction(this.db, () => {
      const previous = this.db.prepare('SELECT body FROM exports WHERE destination=?').get(destination);
      if (previous) return JSON.parse(previous.body);
      const cp = this.checkpoint();
      const pages = this.db.prepare('SELECT ordinal,operation_id AS operationId,response_sha256 AS responseSha256,item_count AS events,native_status AS nativeStatus,http_status AS httpStatus FROM pages WHERE response IS NOT NULL ORDER BY ordinal').all();
      const plan = {schema:'stellar-forge.event-feed-export.v1',id:this.definition.id,feedId:this.definition.feedId,
        source:new URL(this.definition.endpoint).origin+new URL(this.definition.endpoint).pathname,
        storeId:cp.store_id,feedRevision:cp.feed_revision,checkpointRevision:cp.revision,
        throughSequence:cp.last_sequence,cycleComplete:cp.completed===1,createdAt:new Date().toISOString(),
        events:Number(this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE sequence<=?').get(cp.last_sequence).n),pages};
      this.db.prepare('INSERT INTO exports VALUES(?,?)').run(destination,JSON.stringify(plan));
      return plan;
    });
    const temporary = join(dirname(destination),'.feed-export-'+randomUUID());
    const file = await open(temporary,'wx',0o600);
    const hash = createHash('sha256'); let size = 0; let closed = false;
    try {
      for (const row of this.db.prepare('SELECT body FROM events WHERE sequence<=? ORDER BY sequence').iterate(snapshot.throughSequence)) {
        const bytes = Buffer.from(row.body+'\n');
        hash.update(bytes); size += bytes.length; await file.writeFile(bytes);
      }
      await file.sync(); await file.close(); closed=true;
      const sha256 = hash.digest('hex');
      try { await link(temporary,destination); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await fileDigest(destination);
        need(existing.bytes === size && existing.sha256 === sha256, 'FEED_EXPORT_DESTINATION_CHANGED');
      }
      await syncDirectory(dirname(destination));
      const manifest = {...snapshot,data:{format:'ndjson',bytes:size,sha256}};
      const manifestPath = destination+'.manifest.json';
      const manifestBytes = jsonBytes(manifest);
      try { await writeBytes(manifestPath,manifestBytes,{exclusive:true}); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const savedManifest = await fileDigest(manifestPath);
        need(savedManifest.bytes === manifestBytes.length && savedManifest.sha256 === digest(manifestBytes),
          'FEED_EXPORT_MANIFEST_CHANGED');
      }
      return {state:'EXPORTED',destination,manifestPath,...manifest};
    } finally {
      if (!closed) await file.close();
      await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
  }
}

async function fileDigest(path) {
  const handle = await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const before = await handle.stat();
    need(before.isFile(),'FEED_EXPORT_FILE_REQUIRED');
    const hash=createHash('sha256'); let position=0;
    const buffer=Buffer.alloc(65536);
    while (position<before.size) {
      const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,before.size-position),position);
      need(bytesRead>0,'FEED_EXPORT_DESTINATION_CHANGED');
      hash.update(buffer.subarray(0,bytesRead)); position+=bytesRead;
    }
    const after=await handle.stat();
    need(before.size===after.size && before.mtimeMs===after.mtimeMs && before.ctimeMs===after.ctimeMs,
      'FEED_EXPORT_DESTINATION_CHANGED');
    return {bytes:position,sha256:hash.digest('hex')};
  } finally {await handle.close();}
}
