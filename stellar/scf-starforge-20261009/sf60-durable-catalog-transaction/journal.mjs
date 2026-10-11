/**
 * SF60: crash-atomic, single-writer integration of existing native Bazaar,
 * trust, and lifecycle modules. Not a payment facilitator or authentication service.
 * Node 22+, built-in filesystem/crypto only.
 */
import { createHash, randomUUID } from 'node:crypto';
import { open, mkdir, readFile, rename, unlink, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BazaarCatalog, validateCatalogEntry } from '../../../scf46-stellar-bazaar/src/catalog.mjs';
import { CatalogTrustBoundary, verifyAuditTrail } from '../../../stellar-forge/catalog-trust/catalog-trust.mjs';
import { LifecycleCatalog } from '../../../stellar-forge/catalog-lifecycle/lifecycle.mjs';

export const JOURNAL_SCHEMA = 'stellar-forge.catalog-transactions/v1';
const ZERO = '0'.repeat(64);
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_OPERATION_BYTES = 128 * 1024;
const MAX_OPERATIONS = 10_000;
export const MAX_BATCH_OPERATIONS = 1_000;
export const MAX_BATCH_BYTES = 8 * 1024 * 1024;
export const BATCH_SCHEMA = 'stellar-forge.catalog-batch-review/v1';
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (plain(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
const stable = v => JSON.stringify(canonical(v));
const sha = v => createHash('sha256').update(stable(v)).digest('hex');
const fail = code => { throw new Error(code); };
const idText = v => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(v);
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const clone = v => structuredClone(v);
function encodeOperation(v) {
  let text;
  try { text = JSON.stringify(v); } catch { fail('OPERATION_UNSERIALIZABLE'); }
  if (!text || Buffer.byteLength(text) > MAX_OPERATION_BYTES) fail('OPERATION_SIZE_LIMIT');
  const obj = JSON.parse(text);
  if (!plain(obj) || !['upsert','retire'].includes(obj.kind)) fail('OPERATION_INVALID');
  return obj;
}
function policy(authority, sellerId) {
  if (!plain(authority) || authority.sellerId !== sellerId || !idText(sellerId) ||
      typeof authority.signer !== 'string' || authority.signer.length < 3 || authority.signer.length > 256) fail('OPERATOR_AUTHORITY_INVALID');
  const out = { sellerId, signer: authority.signer };
  for (const key of ['allowedOrigins','allowedRecipients','allowedNetworks','allowedSchemes']) {
    const set = authority[key];
    if (!(set instanceof Set) || set.size < 1 || set.size > 64 ||
        [...set].some(x => typeof x !== 'string' || x.length < 1 || x.length > 256)) fail('OPERATOR_POLICY_INVALID');
    out[key] = [...set].sort();
  }
  return out;
}
function hydratePolicy(o) {
  const p = {sellerId:o.sellerId, signer:o.signer};
  for (const key of ['allowedOrigins','allowedRecipients','allowedNetworks','allowedSchemes']) {
    if (!Array.isArray(o[key]) || o[key].length === 0 || o[key].length > 64 ||
        o[key].some(x => typeof x !== 'string' || x.length < 1 || x.length > 256)) fail('JOURNAL_POLICY_INVALID');
    p[key] = new Set(o[key]);
  }
  return p;
}
function normalizeUpsert(candidate, authority, provenance) {
  if (!plain(candidate) || !plain(candidate.entry) || !idText(candidate.sellerId) ||
      !Number.isSafeInteger(candidate.sequence) || candidate.sequence < 1 || !plain(provenance) ||
      provenance.sellerId !== candidate.sellerId || !['signed_export','settlement_hook'].includes(provenance.authority)) {
    fail('UPSTREAM_PROVENANCE_OR_SEQUENCE_INVALID');
  }
  // Caller, not this library, must have authenticated the authority and original source.
  return encodeOperation({kind:'upsert',candidate,authority:policy(authority,candidate.sellerId),provenance});
}
function normalizeRetire(input) {
  if (!plain(input) || !idText(input.sellerId) || typeof input.signer !== 'string' ||
      !Number.isSafeInteger(input.sequence) || input.sequence < 1 ||
      !plain(input.provenance) || input.provenance.sellerId !== input.sellerId ||
      !['signed_export','settlement_hook'].includes(input.provenance.authority) ||
      !idText(input.reason) && (typeof input.reason !== 'string' || input.reason.trim().length < 1 || input.reason.length > 512) ||
      typeof input.catalogKey !== 'string' || input.catalogKey.length > 4096 || !input.catalogKey.length) fail('RETIREMENT_INVALID');
  return encodeOperation({kind:'retire',catalogKey:input.catalogKey,sellerId:input.sellerId,signer:input.signer,sequence:input.sequence,provenance:input.provenance,reason:input.reason});
}
function verifyJournal(document) {
  if (!plain(document) || document.schema !== JOURNAL_SCHEMA || !Array.isArray(document.records) || document.records.length > MAX_OPERATIONS || !hex(document.head)) fail('JOURNAL_SCHEMA_INVALID');
  let head = ZERO;
  const operations = [];
  for (let i=0;i<document.records.length;i++) {
    const r = document.records[i];
    if (!plain(r) || r.index !== i+1 || r.prev !== head || !hex(r.hash)) fail('JOURNAL_CHAIN_INVALID');
    const operation = encodeOperation(r.operation);
    if (sha({index:r.index,prev:r.prev,operation}) !== r.hash) fail('JOURNAL_DIGEST_INVALID');
    head = r.hash; operations.push(operation);
  }
  if (document.head !== head) fail('JOURNAL_HEAD_MISMATCH');
  return operations;
}
function ledger(operations) {
  const records=[]; let head=ZERO;
  for(const operation of operations) {
    const index=records.length+1, prev=head;
    head=sha({index,prev,operation});records.push({index,prev,operation,hash:head});
  }
  return {schema:JOURNAL_SCHEMA,records,head};
}

// The single-operation, batch and restart paths apply the SAME projection logic.
function applyOperation(state, operation) {
  const {catalog,trust,lifecycle,byCatalog,byLifecycle,sellerSigner,latestOperations} = state;
  if (operation.kind === 'upsert') {
    const {candidate,authority,provenance} = operation;
    if (!plain(candidate) || !idText(candidate.sellerId) || !plain(provenance) ||
        provenance.sellerId !== candidate.sellerId || !['signed_export','settlement_hook'].includes(provenance.authority)) fail('JOURNAL_AUTHORITY_INVALID');
    const trustResult = trust.ingest(candidate,hydratePolicy(authority));
    if (trustResult.decision !== 'accepted') fail('TRUST_'+trustResult.reason);
    const life = lifecycle.upsert(candidate.entry,provenance,candidate.sequence);
    if (life.decision !== 'accepted') fail('LIFECYCLE_'+life.reason);
    const key = trustResult.catalogKey;
    const old = byCatalog.get(key), other = byLifecycle.get(life.id);
    if ((old && (old.lifecycleId !== life.id || old.sellerId !== candidate.sellerId || old.signer !== authority.signer || candidate.sequence <= old.sequence)) ||
        (other && other !== key) ||
        (sellerSigner.has(candidate.sellerId) && sellerSigner.get(candidate.sellerId) !== authority.signer)) fail('CROSS_PROJECTION_IDENTITY_CONFLICT');
    sellerSigner.set(candidate.sellerId, authority.signer);
    byCatalog.set(key,{lifecycleId:life.id,sellerId:candidate.sellerId,signer:authority.signer,sequence:candidate.sequence,retired:false});
    byLifecycle.set(life.id,key);
    latestOperations.set(key,sha(operation));
  } else if (operation.kind === 'retire') {
    const current = byCatalog.get(operation.catalogKey);
    if (!current || current.retired || current.sellerId !== operation.sellerId ||
        current.signer !== operation.signer || operation.sequence <= current.sequence ||
        operation.provenance?.sellerId !== operation.sellerId ||
        !['signed_export','settlement_hook'].includes(operation.provenance?.authority)) fail('RETIREMENT_OWNER_OR_SEQUENCE_INVALID');
    const result = lifecycle.retire(current.lifecycleId,{sellerId:operation.sellerId,sequence:operation.sequence,provenance:operation.provenance,reason:operation.reason});
    if (result.decision !== 'accepted' || !catalog.removeValidated(operation.catalogKey)) fail('RETIREMENT_PROJECTION_REJECTED');
    byCatalog.set(operation.catalogKey,{...current,sequence:operation.sequence,retired:true});
    latestOperations.set(operation.catalogKey,sha(operation));
  } else fail('JOURNAL_OPERATION_UNKNOWN');
}
function rebuild(operations) {
  const catalog = new BazaarCatalog();
  const state = {catalog,trust:new CatalogTrustBoundary(catalog),lifecycle:new LifecycleCatalog(),
    byCatalog:new Map(),byLifecycle:new Map(),sellerSigner:new Map(),latestOperations:new Map()};
  for (const operation of operations) applyOperation(state,operation);
  if (!verifyAuditTrail(state.trust.auditTrail())) fail('TRUST_AUDIT_INVALID');
  return state;
}

function batchFailure(index,error) {
  // Native errors only, never include the candidate or source document in logs.
  const code = /^[A-Z0-9_]{1,120}$/.test(error?.message ?? '') ? error.message : 'CATALOG_INPUT_INVALID';
  return Object.assign(new Error(`BATCH_ITEM_${index}_${code}`),{code,operationIndex:index});
}
function normalizeBatch(requests) {
  if (!Array.isArray(requests) || !requests.length || requests.length > MAX_BATCH_OPERATIONS) fail('BATCH_OPERATION_LIMIT');
  let bytes = 0;
  return Array.from(requests,(r,index)=>{
    try {
      if (!plain(r)) fail('OPERATION_INVALID');
      const operation = r.kind === 'upsert' ? normalizeUpsert(r.candidate,r.authority,r.provenance)
        : r.kind === 'retire' ? normalizeRetire(r) : fail('OPERATION_INVALID');
      bytes += Buffer.byteLength(stable(operation));
      if (bytes > MAX_BATCH_BYTES) fail('BATCH_SIZE_LIMIT');
      return operation;
    } catch(error) { throw batchFailure(index,error); }
  });
}
function brief(state,key) {
  const meta = state.byCatalog.get(key);
  if (!meta) return null;
  const last = state.lifecycle.history(meta.lifecycleId).at(-1);
  return {sellerId:meta.sellerId,sequence:meta.sequence,state:meta.retired?'retired':'active',
    resourceURL:last.record.resourceURL,accepts:clone(last.record.accepts),
    contentDigest:last.record.contentDigest};
}
function stageBatch(previous,operations,baseHead) {
  // One historical replay, then one pass over the proposed operations. Never
  // mutate the live state or reconstruct it for each new row.
  const state = rebuild(previous), accepted = [], changes = [];
  for (const [index,operation] of operations.entries()) {
    try {
      const key = operation.kind === 'upsert' ? validateCatalogEntry(operation.candidate.entry).id : operation.catalogKey;
      const before = brief(state,key);
      const replay = state.latestOperations.get(key) === sha(operation);
      if (!replay) {
        if (previous.length + accepted.length >= MAX_OPERATIONS) fail('JOURNAL_OPERATION_LIMIT');
        applyOperation(state,operation);
        accepted.push(operation);
      }
      changes.push({index,kind:operation.kind,catalogKey:key,decision:replay?'exact_replay':'apply',before,after:brief(state,key)});
    } catch(error) { throw batchFailure(index,error); }
  }
  if (!verifyAuditTrail(state.trust.auditTrail())) fail('TRUST_AUDIT_INVALID');
  const next = [...previous,...accepted], document = ledger(next);
  const journalBytes = Buffer.byteLength(stable(document)+'\n');
  if (journalBytes > MAX_FILE_BYTES) fail('JOURNAL_SIZE_LIMIT');
  const review = {schema:BATCH_SCHEMA,baseHead,nextHead:document.head,
    planId:sha({schema:BATCH_SCHEMA,baseHead,nextHead:document.head,operations}),
    requested:operations.length,applied:accepted.length,replayed:operations.length-accepted.length,
    operationsBefore:previous.length,operationsAfter:next.length,
    activeResources:state.catalog.size,journalBytes,changes};
  return {state,next,document,review};
}

async function atomicPersist(dir,filename,document) {
  const data = stable(document) + '\n';
  if (Buffer.byteLength(data) > MAX_FILE_BYTES) fail('JOURNAL_SIZE_LIMIT');
  const target = join(dir,filename),tmp=join(dir,`.pending-${randomUUID()}`);
  let file;
  try {
    file=await open(tmp,'wx',0o600);
    await file.writeFile(data,'utf8');
    await file.sync();
    await file.close();file=null;
    await rename(tmp,target);
    // Durable rename: flush containing directory on POSIX as well as file data.
    const directory = await open(dir,'r');
    try {await directory.sync();} finally {await directory.close();}
  } finally {
    if(file) await file.close().catch(()=>{});
    await unlink(tmp).catch(()=>{});
  }
}

export class DurableCatalogTransaction {
  #dir; #lock; #filename; #operations; #head; #state; #busy=Promise.resolve(); #poisoned=false; #closed=false; #closing=false;
  constructor(dir,lock,filename,operations,state) {
    this.#dir=dir;this.#lock=lock;this.#filename=filename;this.#operations=operations;this.#state=state;this.#head=ledger(operations).head;
  }
  static async open(directory,{filename='catalog-commits.json'}={}) {
    if(typeof directory !== 'string' || !directory.length || !/^[a-z0-9.-]+$/i.test(filename)) fail('JOURNAL_PATH_INVALID');
    const dir=resolve(directory);
    await mkdir(dir,{recursive:true,mode:0o700});
    const lockPath=join(dir,'.catalog-writer.lock');
    let lock;
    try {
      lock=await open(lockPath,'wx',0o600);
      await lock.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()})+'\n');
      const filenamePath=join(dir,filename);
      let document={schema:JOURNAL_SCHEMA,records:[],head:ZERO};
      try {
        const meta=await stat(filenamePath);
        if (meta.size > MAX_FILE_BYTES) fail('JOURNAL_SIZE_LIMIT');
        document=JSON.parse(await readFile(filenamePath,'utf8'));
      } catch(error) {if(error?.code !== 'ENOENT') throw error;}
      const ops=verifyJournal(document),state=rebuild(ops);
      return new DurableCatalogTransaction(dir,lock,filename,ops,state);
    } catch(error) {
      if(lock){await lock.close().catch(()=>{});await unlink(lockPath).catch(()=>{});}
      throw error;
    }
  }
  #assert() {if(this.#closed) fail('WRITER_CLOSED');if(this.#poisoned) fail('JOURNAL_COMMIT_UNCERTAIN_REOPEN_REQUIRED');}
  #enqueue(fn) {
    this.#assert();
    if (this.#closing) fail('WRITER_CLOSING');
    const job=this.#busy.then(fn);
    this.#busy=job.then(()=>{},()=>{});
    return job;
  }
  async #commit(operation) {
    this.#assert();
    if(this.#operations.length>=MAX_OPERATIONS) fail('JOURNAL_OPERATION_LIMIT');
    const next=[...this.#operations,operation];
    // Stage ALL three ORIGINAL projections before a single byte is published.
    const projected=rebuild(next);
    const document=ledger(next);
    return this.#publish(next,projected,document);
  }
  async #publish(next,projected,document) {
    try {
      await atomicPersist(this.#dir,this.#filename,document);
    } catch(error) {
      // Rename may have succeeded before fsync reported failure. Do not silently
      // continue with a stale in-memory projection. Reopen from disk.
      this.#poisoned=true;
      throw error;
    }
    this.#operations=next;
    this.#state=projected;
    this.#head=document.head;
    return {head:document.head,operations:next.length};
  }
  ingest(candidate,authority,provenance) {
    return this.#enqueue(async()=>{
      this.#assert();
      const operation=normalizeUpsert(candidate,authority,provenance);
      // Use the original Bazaar parser identity, not a guessed resource URL.
      // Interleaved unrelated sellers must not make a legitimate current
      // record non-idempotent, but older revisions MUST remain stale.
      const key = validateCatalogEntry(operation.candidate.entry).id;
      const current = this.#state.byCatalog.get(key);
      if (current && !current.retired && current.sellerId === operation.candidate.sellerId &&
          current.sequence === operation.candidate.sequence &&
          this.#operations.some(old => old.kind === 'upsert' && stable(old) === stable(operation))) {
        return {decision:'soft_drop',reason:'EXACT_REPLAY',head:this.head};
      }
      const output=await this.#commit(operation);
      return {decision:'accepted',reason:'COMMITTED',...output};
    });
  }
  retire(input,{expectedHead}={}) {
    return this.#enqueue(async()=>{
      // Check the lease INSIDE the serialized write queue, not before awaiting
      // earlier operations. Callers without expectedHead retain old behavior.
      if (expectedHead !== undefined &&
          (!hex(expectedHead) || this.#head !== expectedHead))
        fail('RETIREMENT_EXPECTED_HEAD_MISMATCH');
      const operation=normalizeRetire(input);
      const output=await this.#commit(operation);
      return {decision:'accepted',reason:'RETIRED',...output};
    });
  }
  /** Trusted caller only; preview is serialized but does not write the journal. */
  previewBatch(requests) {
    // Capture caller-owned objects BEFORE yielding to the pending write queue.
    const operations = normalizeBatch(requests);
    return this.#enqueue(()=>{
      this.#assert();
      return stageBatch(this.#operations,operations,this.#head).review;
    });
  }
  /** All requested changes or none; the reviewed head is mandatory. */
  commitBatch(requests,{expectedHead,expectedPlan}={}) {
    const operations = normalizeBatch(requests);
    return this.#enqueue(async()=>{
      this.#assert();
      if (!hex(expectedHead) || expectedHead !== this.#head) fail('BATCH_EXPECTED_HEAD_MISMATCH');
      const staged = stageBatch(this.#operations,operations,this.#head);
      if (expectedPlan !== undefined && (!hex(expectedPlan) || expectedPlan !== staged.review.planId)) fail('BATCH_EXPECTED_PLAN_MISMATCH');
      if (staged.review.applied) await this.#publish(staged.next,staged.state,staged.document);
      return {...staged.review,decision:staged.review.applied?'committed':'unchanged',head:this.#head};
    });
  }
  list(params) {this.#assert();return this.#state.catalog.list(params);}
  search(params) {this.#assert();return this.#state.catalog.search(params);}
  history(id) {this.#assert();return this.#state.lifecycle.history(id);}
  lookupCatalogKey(key) {this.#assert();return clone(this.#state.byCatalog.get(key)??null);}
  get head() {this.#assert();return this.#head;}
  get count() {this.#assert();return this.#operations.length;}
  async close() {
    if(this.#closed)return;
    this.#closing=true;
    await this.#busy;
    this.#closed=true;
    await this.#lock.close();
    await unlink(join(this.#dir,'.catalog-writer.lock'));
  }
}
