// Complete original Source Collection operation over one retained Source Desk working copy.
// The original browser collection remains the sole receive/review algorithm.
import {createHash, randomUUID} from 'node:crypto';
import {COLLECTION_SCHEMA, collectionData, validateCollection, reviewCollection,
  createSourceCollectionDesk} from './operations_installation_source_collection.mjs';
import {INSTALLATION_SOURCE_SCHEMA, installationSourceCanonical,
  installationSourceRequestSha256, prepareInstallationSourceCommand} from './installation-source-desk-agent.mjs';

export const INSTALLATION_SOURCE_COLLECTION_AGENT_SCHEMA = 'stellar-forge.installation-source-collection-agent.v1';
export const INSTALLATION_SOURCE_WORKING_COPY_SCHEMA = 'stellar-forge.installation-source-working-copy.v1';
export const INSTALLATION_SOURCE_WORKING_COPY_MAX_BYTES = 512 * 1024 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = (message, code = 'SOURCE_COLLECTION_INPUT') => Object.assign(new Error(message), {code});
const need = (ok, message, code) => { if (!ok) throw fail(message, code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
const same = (a, b) => installationSourceCanonical(a) === installationSourceCanonical(b);
const now = () => new Date().toISOString();
const pretty = value => JSON.stringify(value, null, 2) + '\n';
const identity = file => ({id:file.id, filename:file.filename, bytes:file.bytes, sha256:file.sha256,
  mediaType:file.mediaType, sourceUrl:file.sourceUrl, observedAt:file.observedAt});
const exact = (value, keys, required = keys) => {
  need(plain(value) && Object.keys(value).every(key => keys.includes(key)) &&
    required.every(key => Object.hasOwn(value, key)), 'Use the complete declared collection fields: ' + required.join(', ') + '.');
  return value;
};
const validateWholeCopySize = value => {
  const text = installationSourceCanonical(value);
  need(Buffer.byteLength(text) <= INSTALLATION_SOURCE_WORKING_COPY_MAX_BYTES,
    'Keep the complete original working copy within its 512 MiB receiving limit.');
};
function checkedFile(value) {
  need(plain(value) && typeof value.name === 'string' && typeof value.type === 'string' &&
    Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= MAX_FILE &&
    typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.contentBase64 === 'string' && value.contentBase64.length <= Math.ceil(MAX_FILE / 3) * 4 &&
    (value.lastModified === undefined || Number.isSafeInteger(value.lastModified)),
    'Keep every complete original file, receiving name, media type, size and SHA256.');
  const bytes = Buffer.from(value.contentBase64, 'base64');
  need(bytes.toString('base64') === value.contentBase64 && bytes.length === value.bytes && hash(bytes) === value.sha256,
    'The retained original file differs from its complete bytes.', 'SOURCE_COLLECTION_CHANGED');
  return {name:value.name, type:value.type, size:value.bytes, lastModified:value.lastModified || 0,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }};
}
function validateDraft(value, caseId, draftId) {
  need(plain(value) && value.schema === INSTALLATION_SOURCE_SCHEMA && value.caseId === caseId &&
    value.id === draftId && Number.isSafeInteger(value.revision) && value.revision >= 1 && value.revision <= 10000 &&
    Array.isArray(value.files) && Array.isArray(value.preparations) && Array.isArray(value.attachments),
    'Keep the complete original source draft and its selected edition.', 'SOURCE_COLLECTION_CHANGED');
  const ids = new Set(), names = new Set();
  for (const file of value.files) {
    need(plain(file) && typeof file.id === 'string' && /^input-[a-f0-9]{64}$/.test(file.id) &&
      !ids.has(file.id) && typeof file.filename === 'string' && !names.has(file.filename) &&
      Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= MAX_FILE &&
      typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256) &&
      ['mediaType','sourceUrl','observedAt'].every(key => typeof file[key] === 'string'),
      'Keep every original source file identity in the complete draft.', 'SOURCE_COLLECTION_CHANGED');
    ids.add(file.id); names.add(file.filename);
  }
  return value;
}
function validateRequest(value, caseId) {
  need(plain(value) && value.schema === INSTALLATION_SOURCE_SCHEMA && value.caseId === caseId &&
    plain(value.body) && installationSourceRequestSha256(caseId, value.draftId, value.body) === value.requestSha256,
    'Keep the complete original native request and its exact digest.', 'SOURCE_REQUEST_CONFLICT');
  if (value.receipt) {
    const receipt = value.receipt;
    need(receipt.schema === INSTALLATION_SOURCE_SCHEMA && receipt.requestId === value.body.requestId &&
      receipt.requestSha256 === value.requestSha256 && receipt.draft?.caseId === caseId &&
      receipt.draft?.id === value.draftId, 'The retained receipt differs from its original request.', 'SOURCE_REQUEST_CONFLICT');
  }
  return value;
}
function requestMap(value) {
  const result = new Map();
  for (const original of [...value.requests, ...(value.pendingRequest ? [value.pendingRequest] : [])]) {
    validateRequest(original, value.scope.caseId);
    const id = original.body.requestId, prior = result.get(id);
    if (prior) need(prior.draftId === original.draftId && prior.requestSha256 === original.requestSha256 &&
      same(prior.body, original.body) && (!prior.receipt || !original.receipt || same(prior.receipt, original.receipt)),
      'Keep conflicting original request copies separately.', 'SOURCE_REQUEST_CONFLICT');
    result.set(id, prior?.receipt ? {...copy(original), ...prior} : {...prior, ...copy(original)});
  }
  return result;
}
function validateWorkingCopy(input) {
  validateWholeCopySize(input);
  const value = copy(input), state = value.state;
  need(value.schema === INSTALLATION_SOURCE_SCHEMA && value.workingCopySchema === INSTALLATION_SOURCE_WORKING_COPY_SCHEMA &&
    plain(value.scope) && /^operation-[a-f0-9]{32}$/.test(value.scope.caseId) &&
    typeof value.copyId === 'string' && value.copyId.length > 0 &&
    Number.isSafeInteger(value.sequence) && value.sequence >= 0 && plain(state) &&
    state.schema === INSTALLATION_SOURCE_SCHEMA && same(state.scope, value.scope) &&
    /^source-desk-[a-f0-9]{32}$/.test(state.draftId) && value.sourceDraftId === state.draftId &&
    (state.revision === null || Number.isSafeInteger(state.revision) && state.revision > 0) &&
    (state.pendingId === null || typeof state.pendingId === 'string') &&
    typeof state.note === 'string' && plain(state.upload) &&
    ['filename','mediaType','sourceUrl','observedAt'].every(key => typeof state.upload[key] === 'string') &&
    Array.isArray(value.requests) && Array.isArray(value.earlierCopies),
    'Open the complete original browser working copy in its existing case and source draft.');
  for (const key of ['work','caseForm','profileWork','commissioningWork'])
    need(state[key] === null || plain(state[key]), 'Keep the complete original ' + key + ' editor.');
  if (state.work) need(state.work.draftId === state.draftId && Number.isSafeInteger(state.work.baseRevision) &&
    typeof state.work.selectionText === 'string', 'Keep the original source selection text and its draft revision.');
  validateDraft(value.current, value.scope.caseId, state.draftId);
  if (value.selected !== null && value.selected !== undefined) validateDraft(value.selected, value.scope.caseId, state.draftId);
  if (value.saved !== null && value.saved !== undefined) validateDraft(value.saved, value.scope.caseId, state.draftId);
  if (value.staffContext !== null && value.staffContext !== undefined) need(plain(value.staffContext),
    'Keep the original staff context attached to this working copy.');
  const requests = requestMap(value);
  if (state.pendingId !== null) {
    const original = requests.get(state.pendingId);
    need(original && original.draftId === state.draftId && original.state !== 'REJECTED',
      'Keep the selected pending request in its original source draft.', 'SOURCE_REQUEST_CONFLICT');
  } else need(!value.pendingRequest, 'Retain the original pending-request selection.', 'SOURCE_REQUEST_CONFLICT');
  if (value.selectedFile) checkedFile(value.selectedFile);
  validateCollection(state.collectionWork, {hash, checkedFile, draftId:state.draftId, requests});
  return {value, requests};
}

/** Start from an existing native draft and its exact existing case scope. */
export function createInstallationSourceCollectionWorkingCopy({draft, scope, staffContext, name = 'Source working copy'}) {
  exact(scope, ['caseId','planId','createdAt']);
  need(typeof scope.caseId === 'string' && typeof scope.planId === 'string' &&
    typeof scope.createdAt === 'string' && scope.createdAt.length > 0,
    'Keep the original case, plan and case-creation identity.');
  need(staffContext === null || plain(staffContext), 'Supply the original staff context or explicit null for the existing owner.');
  need(typeof name === 'string' && name.trim() && name.length <= 1000, 'Name the complete original working copy.');
  validateDraft(draft, scope.caseId, draft.id);
  const retainedScope = copy(scope), current = copy(draft);
  const work = {draftId:draft.id, baseRevision:draft.revision,
    selectionText:draft.selection ? pretty(draft.selection) : '', dirty:false};
  const state = {schema:INSTALLATION_SOURCE_SCHEMA, scope:retainedScope, open:false, tab:'files',
    draftId:draft.id, revision:null, work, note:'', newTitle:'',
    upload:{filename:'', mediaType:'application/json', sourceUrl:'', observedAt:''},
    caseForm:null, pendingId:null, preparationId:null, profileWork:null, commissioningWork:null, collectionWork:null,
    inspectionFileId:null, notice:'', error:'', rejected:[], copyName:name,
    rawFields:{}, fieldErrors:{}, historyRevisionText:null};
  const value = {schema:INSTALLATION_SOURCE_SCHEMA, workingCopySchema:INSTALLATION_SOURCE_WORKING_COPY_SCHEMA,
    scope:copy(scope), staffContext:copy(staffContext), copyId:randomUUID(), sequence:0, name,
    sourceDraftId:draft.id, selectedRevision:draft.revision, saved:copy(current), working:copy(work),
    caseForm:null, profileWork:null, pendingRequest:null, state, current, selected:copy(current),
    prepared:null, inspection:null, catalogue:null, selectedFile:null, requests:[], earlierCopies:[]};
  return validateWorkingCopy(value).value;
}

/**
 * Borrow a GrantWorkspaceClient. persist(copy,{expectedSequence}) must atomically
 * save the complete original browser copy and return that copy at sequence+1.
 * A storage failure blocks this instance; reload the durable copy to continue.
 */
export class InstallationSourceCollectionAgent {
  #copy; #requests; #client; #persistCallback; #context; #desk;
  #busy = false; #storageError = null; #dirty = false;
  constructor({workingCopy, client, persist, context}) {
    need(client && typeof client.installationSources === 'function' && typeof persist === 'function',
      'Borrow the original Grant workspace client and durable complete-copy persistence.');
    exact(context, ['actor','note','workspaceDirectory'], ['actor']);
    need(typeof context.actor === 'string' && context.actor.trim() && context.actor.length <= 300,
      'Name the original recording operator.');
    if (context.note !== undefined) need(typeof context.note === 'string' && context.note.length <= 12000 &&
      !context.note.includes('\0'), 'Keep the complete original recording note.');
    if (context.workspaceDirectory !== undefined) need(typeof context.workspaceDirectory === 'string' &&
      context.workspaceDirectory.startsWith('/') && context.workspaceDirectory.length <= 4096,
      'Keep the canonical original workspace directory.');
    const {value, requests} = validateWorkingCopy(workingCopy);
    this.#copy = value; this.#requests = requests; this.#client = client;
    this.#persistCallback = persist; this.#context = copy(context);
    this.#assertActor({actor:context.actor});
    this.#desk = createSourceCollectionDesk({
      state:() => this.#copy.state, draft:() => this.#copy.current,
      displayedDraft:() => this.#copy.selected || this.#copy.current,
      request:id => this.#requests.get(id), allRequests:() => [...this.#requests.values()],
      pending:() => this.#copy.state.pendingId, requireEdit:() => this.#requireEdit(),
      changed:() => { this.#dirty = true; }, persistNow:() => this.#persist(),
      parkWorking:label => this.#parkWorking(label), render:() => {}, available:() => !this.#storageError,
      hash, base64:bytes => Buffer.from(bytes).toString('base64'), checkedFile, clone:copy, pretty,
      issue:(action, data, revision, onPrepared) => this.#issue(action, data, revision, onPrepared),
      recoverRequest:original => this.#recover(original, true),
      refreshCurrent:() => this.#refreshCurrent(), readonly:() => this.#readonly(),
      editing:() => !this.#busy && !this.#readonly() && !this.#copy.state.pendingId,
      snapshot:() => this.snapshot(),
    });
  }
  #assertActor(body) {
    // Same retained-staff actor rule as original staff-session.assertStaffRequestActor.
    const context = this.#copy.staffContext;
    if (context && context.staffId !== 'owner') need(typeof body.actor === 'string' &&
      body.actor.trim() === context.actor, 'Receive this retained request with its original recording operator.',
      'STAFF_REQUEST_ACTOR_CHANGED');
  }
  #readonly() {
    const state = this.#copy.state;
    return !!this.#storageError || state.revision !== null && state.revision !== this.#copy.current.revision;
  }
  #requireEdit() {
    if (this.#storageError) throw this.#storageError;
    need(!this.#readonly(), 'Open the current source edition before editing its collection.');
    need(!this.#copy.state.pendingId, 'Reconcile the original pending request before another source mutation.');
    const state = this.#copy.state, dirty = !!state.work?.dirty || !!state.caseForm?.dirty ||
      !!state.profileWork?.dirty || !!state.commissioningWork?.dirty;
    need(!dirty || state.work?.baseRevision === this.#copy.current.revision,
      'The draft advanced. Reconcile the complete retained editor in the original Source Desk before receiving.');
  }
  snapshot() {
    const result = copy(this.#copy), state = result.state;
    result.sourceDraftId = state.draftId; result.selectedRevision = state.revision ?? result.current.revision;
    result.saved = copy(result.selected || result.current); result.working = copy(state.work);
    result.caseForm = copy(state.caseForm); result.profileWork = copy(state.profileWork);
    result.requests = [...this.#requests.values()].map(copy);
    result.pendingRequest = state.pendingId ? copy(this.#requests.get(state.pendingId)) : null;
    return result;
  }
  inspect() {
    const collection = this.#copy.state.collectionWork;
    const inventory = collection ? {...copy(collection), rows:collection.rows.map(row => {
      const original = {...row.original}; delete original.contentBase64;
      return {...copy(row), original};
    })} : null;
    const pending = this.#copy.state.pendingId ? this.#requests.get(this.#copy.state.pendingId) : null;
    // Complete request bytes remain in snapshot; inspection carries their identity.
    return {schema:INSTALLATION_SOURCE_COLLECTION_AGENT_SCHEMA, copyId:this.#copy.copyId,
      sequence:this.#copy.sequence, caseId:this.#copy.scope.caseId, draftId:this.#copy.state.draftId,
      collection:inventory, review:collection ? reviewCollection(collection, this.#copy.current,
        this.#requests, {hash}) : null,
      pendingRequest:pending ? {requestId:pending.body.requestId, requestSha256:pending.requestSha256,
        action:pending.body.action, state:pending.state, receipt:pending.receipt ? copy(pending.receipt) : null,
        lastError:pending.lastError ? copy(pending.lastError) : null} : null,
      running:this.#desk.running(), storageError:this.#storageError ?
        {code:this.#storageError.code || 'SOURCE_COPY_PERSISTENCE', message:this.#storageError.message} : null};
  }
  async #persist() {
    if (this.#storageError) throw this.#storageError;
    const value = this.snapshot(), expectedSequence = this.#copy.sequence;
    validateWholeCopySize(value);
    validateCollection(value.state.collectionWork, {hash, checkedFile, draftId:value.state.draftId, requests:this.#requests});
    need(expectedSequence < Number.MAX_SAFE_INTEGER, 'Retain an exact working-copy sequence.');
    try {
      const stored = await this.#persistCallback(copy(value), {expectedSequence});
      need(plain(stored) && stored.sequence === expectedSequence + 1 && stored.copyId === value.copyId,
        'Persistence must return the same complete working copy at the next sequence.', 'SOURCE_COPY_CONFLICT');
      const saved = copy(stored), expected = copy(value);
      delete saved.sequence; delete saved.updatedAt; delete expected.sequence; delete expected.updatedAt;
      need(same(saved, expected), 'The durably stored working copy changed its complete original content.', 'SOURCE_COPY_CONFLICT');
      // pause() can run while this awaited save completes; keep its in-memory flag.
      this.#copy.sequence = stored.sequence;
      if (stored.updatedAt !== undefined) this.#copy.updatedAt = stored.updatedAt;
      this.#dirty = false;
      return stored;
    } catch (error) {
      this.#storageError = error instanceof Error ? error : fail(String(error), 'SOURCE_COPY_PERSISTENCE');
      throw this.#storageError;
    }
  }
  async #parkWorking(label) {
    const prior = {...this.snapshot(), copyId:randomUUID(), sequence:0, name:label, earlierCopies:[]};
    this.#copy.earlierCopies.push(prior); this.#dirty = true;
  }
  async #exclusive(operation) {
    need(!this.#busy, 'Finish the current collection operation before starting another.', 'SOURCE_COLLECTION_BUSY');
    if (this.#storageError) throw this.#storageError;
    this.#busy = true;
    try { return await operation(); }
    finally { this.#busy = false; }
  }
  async #refreshCurrent() {
    const {caseId} = this.#copy.scope, draftId = this.#copy.state.draftId;
    const response = await this.#client.installationSources('detail', {caseId, draftId});
    const head = copy(validateDraft(response?.value, caseId, draftId)), state = this.#copy.state;
    this.#copy.current = head;
    if (state.revision !== null && state.revision !== head.revision) {
      const selected = await this.#client.installationSources('detail', {caseId, draftId, revision:state.revision});
      this.#copy.selected = copy(validateDraft(selected?.value, caseId, draftId));
      need(this.#copy.selected.revision === state.revision, 'The retained historical source edition changed.');
    } else this.#copy.selected = copy(head);
    if (!state.work) state.work = {draftId, baseRevision:this.#copy.selected.revision,
      selectionText:this.#copy.selected.selection ? pretty(this.#copy.selected.selection) : '', dirty:false};
    else if (state.work.baseRevision !== head.revision && state.revision === null) state.work.dirty = true;
    this.#dirty = true;
    return head;
  }
  #prepared(original) {
    validateRequest(original, this.#copy.scope.caseId); this.#assertActor(original.body);
    need(original.draftId === this.#copy.state.draftId, 'Reopen the original selected source draft.');
    return prepareInstallationSourceCommand(original.caseId, original.draftId, original.body,
      this.#context.workspaceDirectory === undefined ? {} : {workspaceDirectory:this.#context.workspaceDirectory});
  }
  async #issue(action, data, revision, onPrepared) {
    this.#requireEdit();
    need(action === 'file.add', 'Collection receiving uses the original file.add writer.');
    need(!Object.keys(this.#copy.state.fieldErrors || {}).length,
      'Correct the retained unfinished Source Desk fields before recording a native request.');
    const body = {requestId:'source-' + randomUUID(), expectedRevision:revision, actor:this.#context.actor,
      note:this.#context.note ?? this.#copy.state.note, action, data:copy(data)};
    this.#assertActor(body);
    const original = {schema:INSTALLATION_SOURCE_SCHEMA, caseId:this.#copy.scope.caseId,
      draftId:this.#copy.state.draftId, body, createdAt:now(),
      requestSha256:installationSourceRequestSha256(this.#copy.scope.caseId, this.#copy.state.draftId, body),
      editorText:this.#copy.state.work?.selectionText ?? null, state:'PREPARED'};
    if (onPrepared) onPrepared(original);
    this.#requests.set(body.requestId, original); this.#copy.state.pendingId = body.requestId;
    this.#dirty = true;
    // One durable complete-copy save contains original bytes, request and row link before transport.
    await this.#persist();
    return this.#recover(original, true);
  }
  async #adopt(receipt, original) {
    const operation = this.#prepared(original);
    need(receipt?.schema === INSTALLATION_SOURCE_SCHEMA && receipt.requestId === original.body.requestId &&
      receipt.requestSha256 === operation.requestSha256 && receipt.draft?.id === original.draftId &&
      receipt.draft?.caseId === original.caseId, 'The received original request changed identity.', 'SOURCE_REQUEST_CONFLICT');
    validateDraft(receipt.draft, original.caseId, original.draftId);
    if (original.receipt) need(same(original.receipt, receipt), 'The original receipt changed.', 'SOURCE_REQUEST_CONFLICT');
    need(this.#copy.state.pendingId === original.body.requestId, 'Keep the original pending request selected.');
    original.receipt = copy(receipt); original.state = 'RECORDED'; original.recordedAt ||= now();
    this.#requests.set(original.body.requestId, original);
    this.#copy.state.pendingId = null;
    this.#copy.current = copy(receipt.draft); this.#copy.selected = copy(receipt.draft);
    this.#copy.state.revision = null;
    const work = this.#copy.state.work;
    if (work) {
      work.baseRevision = receipt.draft.revision;
      if (!work.dirty) work.selectionText = receipt.draft.selection ? pretty(receipt.draft.selection) : '';
    }
    this.#copy.state.notice = 'Saved complete original source revision ' + receipt.draft.revision + '.';
    // Keep complete native receipt before any refresh or subsequent file.
    this.#dirty = true; await this.#persist();
    return {state:'RECORDED', receipt:copy(receipt), requestId:original.body.requestId};
  }
  async #recover(value, retry) {
    const original = this.#requests.get(value.body.requestId);
    need(original && original.state !== 'REJECTED' && same(original.body, value.body),
      'Recover the unchanged original request from this complete working copy.', 'SOURCE_REQUEST_CONFLICT');
    const operation = this.#prepared(original);
    need(!this.#copy.state.pendingId || this.#copy.state.pendingId === original.body.requestId,
      'Reconcile the selected original pending request before another collection file.');
    this.#copy.state.pendingId = original.body.requestId; this.#dirty = true;
    await this.#persist();
    if (original.receipt) return this.#adopt(original.receipt, original);
    let result;
    try {
      // execute itself reads the native request journal before any original POST.
      result = await this.#client.installationSources(retry ? 'execute' : 'reconcile', {operation});
    } catch (error) {
      original.lastError = {message:error?.message || String(error), code:error?.code ?? null, status:error?.status ?? null,
        definitive:[400,401,403,404,409,413,422].includes(error?.status) && typeof error?.code === 'string' &&
          error?.outcomeUnknown !== true && error?.reopenRequired !== true && error?.uncertain !== true,
        at:now()};
      for (const key of ['uncertain','requestId','originalCode','originalStatus','source','route',
        'outcomeUnknown','reopenRequired','commitUncertainty'])
        if (error?.[key] !== undefined) original.lastError[key] = copy(error[key]);
      original.state = 'UNRESOLVED'; this.#requests.set(original.body.requestId, original); this.#dirty = true;
      await this.#persist(); throw error;
    }
    need(result && ['RECORDED','NOT_RECORDED'].includes(result.state),
      'Read the complete original source request status.', 'SOURCE_REQUEST_CONFLICT');
    if (result.state === 'RECORDED') return this.#adopt(result.receipt, original);
    need(!retry, 'The original execute did not return its complete native receipt.', 'SOURCE_REQUEST_CONFLICT');
    original.statusRead = {state:'NOT_RECORDED', at:now()}; this.#dirty = true; await this.#persist();
    return {state:'NOT_RECORDED', receipt:null, requestId:original.body.requestId};
  }
  async refresh() {
    return this.#exclusive(async () => { await this.#refreshCurrent(); await this.#persist(); return this.inspect(); });
  }
  async start(input = {}) {
    exact(input, ['title','sourceUrl','observedAt'], []);
    const fields = copy(input);
    need(Object.values(fields).every(value => typeof value === 'string'), 'Keep original collection text fields.');
    return this.#exclusive(async () => {
      await this.#desk.action('collection-new', {dataset:{}});
      for (const [field,value] of Object.entries(fields))
        this.#desk.edit({dataset:{sourceCollectionField:field}, value});
      if (Object.keys(fields).length) await this.#persist();
      return this.inspect();
    });
  }
  async stage(files) {
    const originals = copy(files);
    need(Array.isArray(originals) && originals.length > 0, 'Stage complete original files.');
    const selections = originals.map(checkedFile);
    return this.#exclusive(async () => { await this.#desk.readFiles(selections); return this.inspect(); });
  }
  async edit(change) {
    exact(change, ['rowId','field','value'], ['field','value']);
    const input = copy(change);
    need(typeof input.field === 'string' && (input.rowId === undefined || typeof input.rowId === 'string') &&
      (input.field === 'included' ? typeof input.value === 'boolean' : typeof input.value === 'string'),
      'Keep the complete original receiving-field value.');
    return this.#exclusive(async () => {
      this.#desk.edit({dataset:{sourceCollectionField:input.field, ...(input.rowId ? {sourceCollectionRow:input.rowId} : {})},
        value:input.value, checked:input.value});
      await this.#persist(); return this.inspect();
    });
  }
  async useExisting(rowId, selection) {
    exact(selection, ['revision','fileId','sha256','bytes','filename']);
    const chosen = copy(selection);
    return this.#exclusive(async () => {
      this.#requireEdit(); await this.#refreshCurrent(); this.#requireEdit();
      const collection = this.#copy.state.collectionWork, row = collection?.rows.find(item => item.id === rowId);
      const current = collection ? reviewCollection(collection, this.#copy.current, this.#requests, {hash}) : null;
      const result = current?.rows.find(item => item.id === rowId), file = result?.sameName;
      need(row && result?.status === 'IDENTICAL' && current.revision === chosen.revision &&
        file?.id === chosen.fileId && file.filename === chosen.filename &&
        file.sha256 === chosen.sha256 && file.bytes === chosen.bytes,
        'Review the exact identical current source file and its native revision before linking.', 'SOURCE_COLLECTION_CHANGED');
      row.link = {file:copy(file), revision:current.revision, acceptedAt:now()};
      row.included = true; collection.review = null; this.#dirty = true;
      validateCollection(collection, {hash, checkedFile, draftId:this.#copy.state.draftId, requests:this.#requests});
      await this.#persist(); return this.inspect();
    });
  }
  async clearExisting(rowId) {
    return this.#exclusive(async () => {
      await this.#desk.action('collection-unlink', {dataset:{id:rowId}});
      return this.inspect();
    });
  }
  async review() {
    return this.#exclusive(async () => { await this.#desk.action('collection-review', {dataset:{}}); return this.inspect(); });
  }
  async receive(options = {}) {
    exact(options, ['expectedSignature'], []);
    const expected = options.expectedSignature;
    return this.#exclusive(async () => {
      if (expected !== undefined) {
        const collection = this.#copy.state.collectionWork;
        need(typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected) &&
          collection?.review?.signature === expected &&
          reviewCollection(collection, this.#copy.current, this.#requests, {hash}).signature === expected,
          'Receive the exact complete reviewed collection.', 'SOURCE_COLLECTION_CHANGED');
      }
      await this.#desk.action('collection-receive', {dataset:{}});
      return this.inspect();
    });
  }
  async reconcile(options = {}) {
    exact(options, ['retry'], []);
    need(options.retry === undefined || typeof options.retry === 'boolean', 'Choose explicit original-request retry.');
    return this.#exclusive(async () => {
      const pending = this.#copy.state.pendingId ? this.#requests.get(this.#copy.state.pendingId) : null;
      const collection = this.#copy.state.collectionWork;
      const ids = new Set(collection?.rows.flatMap(row => {
        const id = row.requests.at(-1), original = id && this.#requests.get(id);
        return original && !original.receipt && original.state !== 'REJECTED' ? [id] : [];
      }) || []);
      if (pending) {
        need(collection?.rows.some(row => row.requests.includes(pending.body.requestId)),
          'Recover the non-collection pending request in its original Source Desk before continuing this collection.');
        ids.add(pending.body.requestId);
      }
      const results = [];
      for (const id of ids) {
        const result = await this.#recover(this.#requests.get(id), options.retry === true);
        results.push(result);
        if (result.state === 'NOT_RECORDED') break;
        await this.#refreshCurrent(); await this.#persist();
      }
      return {...this.inspect(), results};
    });
  }
  async retireRejected() {
    return this.#exclusive(async () => {
      const original = this.#requests.get(this.#copy.state.pendingId);
      need(original?.lastError?.definitive && !original.receipt &&
        this.#copy.state.collectionWork?.rows.some(row => row.requests.includes(original.body.requestId)),
        'Keep uncertain requests selected; retire only a definite rejected original collection request.');
      const result = await this.#recover(original, false);
      if (result.state === 'RECORDED') return this.inspect();
      original.state = 'REJECTED'; this.#copy.state.pendingId = null;
      this.#copy.state.rejected ||= [];
      this.#copy.state.rejected.push({requestId:original.body.requestId, action:original.body.action, code:original.lastError.code});
      this.#dirty = true; await this.#persist();
      await this.#refreshCurrent(); await this.#persist(); return this.inspect();
    });
  }
  pause() {
    this.#desk.pause();
    // The unchanged receive loop durably retains this flag after its current request.
    return this.inspect();
  }
}
export const createInstallationSourceCollectionAgent = options => new InstallationSourceCollectionAgent(options);
