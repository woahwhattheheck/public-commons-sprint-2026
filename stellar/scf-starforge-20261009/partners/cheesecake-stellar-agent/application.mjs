// MIT. Application adoption of the maintained merchant handoff and original Node buyer.
import { open, lstat, realpath, mkdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const SCHEMA = 'stellar-forge.application-adoption.v1';
const hash = raw => createHash('sha256').update(raw).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => Object.assign(new Error(code), { code });
const need = (ok, code) => { if (!ok) throw fail(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const id = value => { need(typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value), 'APPLICATION_ID_INVALID'); return value; };
const absolute = value => { need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value &&
  value !== '/' && !/[\\\x00-\x1f\x7f]/.test(value), 'APPLICATION_ABSOLUTE_PATH_REQUIRED'); return value; };
async function directory(value, { create = false, private: restricted = false } = {}) {
  absolute(value);
  if (create) await mkdir(value, { mode: 0o700 });
  const st = await lstat(value);
  need(st.isDirectory() && !st.isSymbolicLink() && await realpath(value) === value &&
    (!restricted || !(st.mode & 0o077)), 'APPLICATION_DIRECTORY_INVALID');
  return value;
}
export async function readBytes(file, maximum = 16 * 1024 * 1024) {
  const h = await open(absolute(file), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await h.stat({ bigint: true });
    need(before.isFile() && before.size <= BigInt(maximum), 'APPLICATION_SOURCE_FILE_INVALID');
    const raw = await h.readFile(), after = await h.stat({ bigint: true });
    need(raw.length <= maximum && BigInt(raw.length) === before.size && before.size === after.size &&
      before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs, 'APPLICATION_SOURCE_FILE_CHANGED');
    return raw;
  } finally { await h.close(); }
}
export async function readJSON(file) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(file)));
}
async function saveJSON(file, value) {
  const h = await open(absolute(file), 'wx', 0o600);
  try { await h.writeFile(encoded(value)); await h.sync(); } finally { await h.close(); }
  const d = await open(dirname(file), 'r'); try { await d.sync(); } finally { await d.close(); }
}
async function exists(file) { try { await lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
const publicBinding = binding => ({ intentId: binding.intentId, configSha256: binding.configSha256,
  bodySha256: binding.bodySha256, ticketSha256: binding.ticketSha256 ?? null });
function publicOutcome(outcome) {
  const state = outcome.operation, result = outcome.result;
  return { phase: outcome.phase, source: outcome.source, binding: publicBinding(outcome.binding),
    operation: { intentId: state.intentId, state: state.state, resultRecoverable: state.resultRecoverable,
      nativeStatus: state.nativeStatus, deliveryStatus: state.deliveryStatus, retry: state.retry },
    result: result ? { native: result.native, status: result.status, ok: result.ok,
      exitCode: result.record.exitCode, runtimeError: result.record.runtimeError,
      recordedAt: result.record.recordedAt, delivery: { status: result.delivery.status,
        bytes: result.delivery.bytes ?? null, sha256: result.delivery.sha256 ?? null,
        contentType: result.delivery.contentType ?? null } } : null };
}

export async function inspectHandoff(folder) {
  await directory(folder, { private: true });
  const raw = await readBytes(join(folder, 'handoff.json')), manifest = JSON.parse(raw);
  need(manifest.schema === 'stellar-forge.chainstack-handoff.v1' &&
    manifest.requestPathMode === 'RETAINED_BYTES_WITH_BUYER_BODY_OVERRIDE' &&
    Array.isArray(manifest.requests) && manifest.requests.length >= 1 && manifest.requests.length <= 12 &&
    Array.isArray(manifest.releases) && Array.isArray(manifest.files) &&
    manifest.files.length <= 200, 'APPLICATION_ORIGINAL_HANDOFF_REQUIRED');
  const { handoffId, ...content } = manifest;
  need(hash(encoded(content)) === handoffId, 'APPLICATION_HANDOFF_MANIFEST_CHANGED');
  const files = new Map(); let total = 0;
  for (const row of manifest.files) {
    need(object(row) && typeof row.path === 'string' && !row.path.startsWith('/') &&
      !row.path.split('/').some(x => !x || x === '.' || x === '..') && !/[\\\x00-\x1f\x7f]/.test(row.path) &&
      !files.has(row.path) && Number.isSafeInteger(row.bytes) && row.bytes >= 0 &&
      /^[a-f0-9]{64}$/.test(row.sha256), 'APPLICATION_HANDOFF_FILE_INVALID');
    const file = join(folder, row.path);
    need(await realpath(file) === file, 'APPLICATION_HANDOFF_SYMLINK');
    const bytes = await readBytes(file);
    need(bytes.length === row.bytes && hash(bytes) === row.sha256, 'APPLICATION_HANDOFF_FILE_CHANGED');
    files.set(row.path, bytes); total += bytes.length;
    need(total <= 128 * 1024 * 1024, 'APPLICATION_HANDOFF_SIZE_LIMIT');
  }
  need(total === manifest.totalBytes, 'APPLICATION_HANDOFF_TOTAL_CHANGED');
  const requests = new Map();
  for (const selected of manifest.requests) {
    id(selected.intentId);
    need(!requests.has(selected.intentId) && selected.directory === 'requests/' + selected.intentId,
      'APPLICATION_REQUEST_SELECTION_INVALID');
    const get = name => {
      const bytes = files.get(selected.directory + '/' + name);
      need(bytes, 'APPLICATION_REQUEST_FILE_MISSING'); return bytes;
    };
    const record = JSON.parse(get('request.json')), body = get('request.body.json'), configRaw = get('buyer-config.json');
    const config = JSON.parse(configRaw);
    need(record.schema === 'stellar-forge.chainstack-request.v1' && record.intentId === selected.intentId &&
      record.bodyFile === 'request.body.json' && record.configFile === 'buyer-config.json' &&
      ['getTransaction', 'getEvents', 'getLedgerEntries'].includes(record.method) &&
      record.method === selected.method && record.releaseId === selected.releaseId &&
      record.releaseDigest === selected.releaseDigest &&
      record.bodyBytes === body.length && record.bodySha256 === hash(body) &&
      record.configBytes === configRaw.length && record.configSha256 === hash(configRaw) &&
      selected.bodySha256 === record.bodySha256 && selected.configSha256 === record.configSha256,
      'APPLICATION_ORIGINAL_REQUEST_CHANGED');
    // Provider packets supply public request selection. The receiving operator supplies its own profile.
    need(object(config) && Object.keys(config).every(x => ['operation','captureBody','preparedFrom'].includes(x)) &&
      object(config.operation) && config.operation.intentId === record.intentId && config.operation.method === 'POST' &&
      !['operator','signerModule','trustedPayer','buyerTransport'].some(x => Object.hasOwn(config, x)),
      'APPLICATION_RECEIVING_PROFILE_REQUIRED');
    need(Object.keys(config.operation).every(x => ['intentId','url','method','expect','bodyFile',
      'headers','bodySha256','bodyBytes'].includes(x)), 'APPLICATION_REQUEST_FIELDS_INVALID');
    const release = manifest.releases.find(x => x.releaseId === record.releaseId);
    need(release && release.releaseDigest === record.releaseDigest &&
      release.dataNetwork === record.dataNetwork && release.paymentNetwork === record.paymentNetwork &&
      config.operation.url === release.publicOrigin + '/stellar/' + record.method &&
      config.operation.expect?.network === release.paymentNetwork, 'APPLICATION_RELEASE_BINDING_CHANGED');
    requests.set(record.intentId, { selected, record, config, body,
      view: { intentId: record.intentId, method: record.method, releaseId: record.releaseId,
        releaseDigest: record.releaseDigest, dataNetwork: record.dataNetwork, paymentNetwork: record.paymentNetwork,
        mode: release.mode, url: config.operation.url, acceptedTerms: config.operation.expect,
        bodyBytes: body.length, bodySha256: record.bodySha256, configSha256: record.configSha256,
        bodyText: new TextDecoder('utf-8', { fatal: true }).decode(body) } });
  }
  return { manifest, manifestSha256: hash(raw), requests };
}

/** One receiving application, its own state, and the host's current authorization callback. */
export async function openApplication({ applicationId, runtimeDirectory, handoffDirectory, stateDirectory,
  operatorProfile, authorize }) {
  id(applicationId); await directory(runtimeDirectory);
  await directory(stateDirectory, { private: true });
  need(typeof authorize === 'function', 'APPLICATION_HOST_AUTHORIZATION_REQUIRED');
  const original = await inspectHandoff(handoffDirectory);
  const [native, agents] = await Promise.all([
    import(pathToFileURL(join(runtimeDirectory, 'node/index.mjs')).href),
    import(pathToFileURL(join(runtimeDirectory, 'node/agents/operation.mjs')).href),
  ]);
  const schema = { schema: SCHEMA, applicationId, handoffId: original.manifest.handoffId,
    manifestSha256: original.manifestSha256, runtimeDirectory, handoffDirectory };
  const identityPath = join(stateDirectory, 'application.json');
  if (await exists(identityPath)) need(same(await readJSON(identityPath), schema), 'APPLICATION_SELECTION_CHANGED');
  else {
    const names = await (await import('node:fs/promises')).readdir(stateDirectory);
    need(names.length === 0, 'APPLICATION_NEW_EMPTY_STATE_REQUIRED');
    try { await saveJSON(identityPath, schema); } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      need(same(await readJSON(identityPath), schema), 'APPLICATION_SELECTION_CHANGED');
    }
  }
  const selections = original.requests, pending = new Map();
  async function current() {
    const fresh = await inspectHandoff(handoffDirectory);
    need(fresh.manifestSha256 === original.manifestSha256, 'APPLICATION_HANDOFF_CHANGED');
    need(same(await readJSON(identityPath), schema), 'APPLICATION_STATE_IDENTITY_CHANGED');
  }
  async function permitted(context, action, request) {
    need(object(context) && typeof context.subject === 'string' && context.subject.length > 0 &&
      context.subject.length <= 256, 'APPLICATION_AUTHENTICATED_SUBJECT_REQUIRED');
    const verdict = await authorize({ context: structuredClone(context), action, applicationId,
      request: request ? structuredClone(request.view) : null });
    need(verdict === true, 'APPLICATION_AUTHORIZATION_DENIED');
  }
  function selected(intentId) {
    id(intentId); const entry = selections.get(intentId);
    need(entry, 'APPLICATION_REQUEST_NOT_SELECTED'); return entry;
  }
  async function attached(entry, context, { prepare = false } = {}) {
    const root = join(stateDirectory, hash(entry.record.intentId));
    const selection = { schema: 'stellar-forge.application-request-binding.v1', applicationId,
      subject: context.subject, handoffId: original.manifest.handoffId, intentId: entry.record.intentId,
      sourceConfigSha256: entry.record.configSha256, bodySha256: entry.record.bodySha256 };
    if (!(await exists(root))) {
      need(prepare, 'APPLICATION_REQUEST_NOT_PREPARED');
      try { await mkdir(root, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    await directory(root, { private: true });
    const bindingFile = join(root, 'selection.json');
    if (await exists(bindingFile)) need(same(await readJSON(bindingFile), selection), 'APPLICATION_SUBJECT_BINDING_CHANGED');
    else {
      need(prepare, 'APPLICATION_REQUEST_NOT_PREPARED');
      try { await saveJSON(bindingFile, selection); } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        need(same(await readJSON(bindingFile), selection), 'APPLICATION_SUBJECT_BINDING_CHANGED');
      }
    }
    const buyerState = join(root, 'native');
    if (!(await exists(buyerState))) {
      need(prepare, 'APPLICATION_REQUEST_NOT_PREPARED');
      try { await mkdir(buyerState, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    const buyer = new native.Buyer({ runtimeDirectory, stateDirectory: buyerState,
      ...(operatorProfile ? { operatorProfile } : {}) });
    let operation = buyer.operation(entry.record.intentId);
    if (!(await exists(operation.directory))) {
      need(prepare, 'APPLICATION_REQUEST_NOT_PREPARED');
      try { operation = await buyer.fromConfig(entry.config, { body: entry.body, responseFile: { maxBytes: 1048576 } }); }
      catch (e) { if (e.code !== 'INTENT_ALREADY_EXISTS_USE_RECOVER') throw e; }
    }
    const agent = new agents.BuyerAgent(operation), binding = await agent.binding();
    need(binding.bodySha256 === entry.record.bodySha256, 'APPLICATION_NATIVE_BODY_CHANGED');
    const savedPath = join(root, 'native-binding.json');
    if (await exists(savedPath)) await agent.binding(await readJSON(savedPath));
    else {
      need(prepare, 'APPLICATION_NATIVE_BINDING_NOT_RECORDED');
      // Original review is required before adopting a finished preparation after a lost return.
      const review = await agent.savedReview();
      need(review.bodySha256 === entry.record.bodySha256 && review.native.intentId === entry.record.intentId &&
        review.native.bodySha256 === entry.record.bodySha256, 'APPLICATION_NATIVE_REVIEW_CHANGED');
      try { await saveJSON(savedPath, binding); } catch (e) {
        if (e.code !== 'EEXIST') throw e; await agent.binding(await readJSON(savedPath));
      }
    }
    return { root, operation, agent, binding };
  }
  const publicRequest = entry => structuredClone(entry.view);
  return {
    identity: structuredClone(schema),
    selectedIntentIds: Object.freeze([...selections.keys()]),
    async requests(context) {
      await current(); await permitted(context, 'list', null);
      const out = [];
      for (const entry of selections.values()) {
        try {
          await permitted(context, 'status', entry);
          let operation = null;
          try { operation = (await attached(entry, context)).operation; }
          catch (e) { if (!['APPLICATION_REQUEST_NOT_PREPARED','APPLICATION_NATIVE_BINDING_NOT_RECORDED'].includes(e.code)) throw e; }
          out.push({ ...publicRequest(entry), state: operation ? await operation.inspect() : { state: 'AVAILABLE' } });
        } catch (e) { if (e.code !== 'APPLICATION_AUTHORIZATION_DENIED' && e.code !== 'APPLICATION_SUBJECT_BINDING_CHANGED') throw e; }
      }
      return { applicationId, handoffId: original.manifest.handoffId, requests: out };
    },
    async call(context, action, intentId, options = {}) {
      need(['review','execute','status','recover','read','export'].includes(action), 'APPLICATION_ACTION_INVALID');
      const entry = selected(intentId); await current(); await permitted(context, action, entry);
      need(object(options) && Object.keys(options).every(x => ['signal','format','limitBytes','destination'].includes(x)),
        'APPLICATION_OPTIONS_INVALID');
      if (pending.has(intentId)) {
        if (action === 'status' || action === 'recover') return { intentId, state: 'APPLICATION_OPERATION_RUNNING' };
        throw fail('APPLICATION_OPERATION_RUNNING');
      }
      const operation = (async () => {
        const attachedOperation = await attached(entry, context, { prepare: action === 'review' });
        const { agent, binding } = attachedOperation;
        if (action === 'review') {
          const review = await agent.review({ binding });
          return { request: publicRequest(entry), binding: publicBinding(binding), review };
        }
        if (action === 'execute') {
          // Re-read current host authority immediately before the original execution.
          await permitted(context, action, entry);
          return publicOutcome(await agent.execute({ binding, signal: options.signal }));
        }
        if (action === 'status' || action === 'recover') return publicOutcome(await agent.recover({ binding }));
        if (action === 'export') {
          absolute(options.destination);
          return { intentId, exported: await agent.saveAs(options.destination, { binding, signal: options.signal }) };
        }
        const format = options.format ?? 'json', limitBytes = options.limitBytes ?? 1048576;
        need(['json','text','base64','file'].includes(format) && Number.isSafeInteger(limitBytes) &&
          limitBytes >= 1 && limitBytes <= 1048576, 'APPLICATION_READ_OPTIONS_INVALID');
        const artifact = await agent.read({ binding, format, limitBytes, signal: options.signal });
        return { ...artifact, binding: publicBinding(artifact.binding),
          result: { ...artifact.result, file: artifact.result.file ? {
            bytes: artifact.result.file.bytes, sha256: artifact.result.file.sha256,
            contentType: artifact.result.file.contentType } : null } };
      })();
      pending.set(intentId, operation);
      try { return await operation; } finally { pending.delete(intentId); }
    },
    async close() { await Promise.allSettled([...pending.values()]); },
  };
}

const selectedSchema = { type: 'object', properties: { intentId: { type: 'string' } },
  required: ['intentId'], additionalProperties: false };
export const TOOLS = Object.freeze([
  { name: 'stellar_requests', description: 'List the operator-selected original merchant requests and application state.',
    annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  ...['review','execute','status','recover'].map(action => ({
    name: 'stellar_request_' + action,
    description: action === 'review' ? 'Prepare or reopen the exact selected request and run original offline review.' :
      action === 'execute' ? 'Execute the original saved review through the receiving operator, or recover its existing native attempt.' :
      'Read the same selected native operation and saved result.',
    annotations: { readOnlyHint: action === 'status' || action === 'recover',
      destructiveHint: false, idempotentHint: action !== 'execute' }, inputSchema: selectedSchema })),
  { name: 'stellar_request_read', description: 'Verify and read the original retained response without another merchant call.',
    annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: {
      intentId: { type: 'string' }, format: { type: 'string', enum: ['json','text','base64','file'] },
      limitBytes: { type: 'integer', minimum: 1, maximum: 1048576 } }, required: ['intentId'], additionalProperties: false } },
]);
const REMOTE_TOOLS = Object.freeze([
  ...['cancel','spending'].map(action => ({
    name: 'stellar_request_' + action,
    description: action === 'cancel' ?
      'Cancel this selected remote MCP quote through the original broker and retain any spending reservation.' :
      'Read this selected remote MCP quote’s original aggregate budget preview or durable reservation.',
    annotations: { readOnlyHint: action === 'spending', destructiveHint: false, idempotentHint: true },
    inputSchema: selectedSchema,
  })),
  { name: 'stellar_request_reconcile',
    description: 'Reconcile this selected remote MCP quote’s original transaction and finalize its retained SF36 spending record.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: { intentId: { type: 'string' },
      transaction: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' } },
      required: ['intentId'], additionalProperties: false } },
]);
export function applicationTools(application, context, { signal } = {}) {
  const extras = REMOTE_TOOLS.filter(tool => application.supportsAction?.(tool.name.slice('stellar_request_'.length)));
  const tools = TOOLS.map(tool => {
    if (!extras.length || tool.name !== 'stellar_request_read') return tool;
    const copy = structuredClone(tool); copy.inputSchema.properties.limitBytes.maximum = 2097152;
    return copy;
  }).concat(extras);
  return { tools, async call(name, args = {}) {
    need(object(args), 'APPLICATION_TOOL_ARGUMENTS_INVALID');
    if (name === 'stellar_requests') {
      need(Object.keys(args).length === 0, 'APPLICATION_TOOL_ARGUMENTS_INVALID');
      return application.requests(context);
    }
    const action = name.startsWith('stellar_request_') ? name.slice('stellar_request_'.length) : '';
    need(tools.some(tool => tool.name === name), 'TOOL_NOT_FOUND');
    const allowed = action === 'read' ? ['intentId','format','limitBytes'] :
      action === 'reconcile' ? ['intentId','transaction'] : ['intentId'];
    need(Object.keys(args).every(x => allowed.includes(x)), 'APPLICATION_TOOL_ARGUMENTS_INVALID');
    return application.call(context, action, args.intentId,
      { signal, ...(args.format === undefined ? {} : { format: args.format }),
        ...(args.limitBytes === undefined ? {} : { limitBytes: args.limitBytes }),
        ...(args.transaction === undefined ? {} : { transaction: args.transaction }) });
  } };
}
