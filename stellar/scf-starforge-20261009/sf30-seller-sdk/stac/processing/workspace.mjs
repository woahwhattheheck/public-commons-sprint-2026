// MIT. Additive processing history in the original STAC analyst/receiving product.
import { randomUUID } from 'node:crypto';
import { withPrivateLock } from '../../routescan/quota.mjs';
import { hostname } from 'node:os';
import { readFile, readlink, readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { privateDirectory, readBytes, readJson, writeBytes, writeJson, exists, need, intent }
  from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { sha256, canonicalJson } from '../provider.mjs';
import { normalizeDeployment, readProcessingContract, routeRequest, nextProcessingRequest,
  processingUrl, createProcessingProvider, readProcessingCapture } from './provider.mjs';
import { proposeProcessingAssociations, validateProcessingAssociation } from './associations.mjs';
import { exportProcessingHandover, importProcessingHandover, packProcessingHandover, unpackProcessingHandover } from './portable.mjs';

const SCHEMA = 'scf-stac-processing-workspace/v1';
const active = new Map();
const stamp = () => new Date().toISOString();
const identity = prefix => prefix + '-' + randomUUID().replaceAll('-', '').slice(0, 24);
const digest = value => sha256(canonicalJson(value));
const nativeEdition = value => { const { receivedFrom, ...edition } = value; return edition; };
const clone = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const relative = value => { need(typeof value === 'string' && value.split('/').every(p => /^[A-Za-z0-9._-]+$/.test(p) && !['.', '..'].includes(p)), 'PROCESSING_PATH_INVALID'); return value; };
const errorCode = error => /^[A-Z0-9_]{1,120}$/.test(error.code ?? '') ? error.code : 'PROCESSING_OPERATION_FAILED';
export const processingRunKey = run => {
  need(object(run) && ['source_id', 'workflow_definition_id', 'run_id', 'payload_id'].every(k => typeof run[k] === 'string'), 'PROCESSING_RUN_IDENTITY_INVALID');
  return sha256(canonicalJson([run.source_id, run.workflow_definition_id, run.run_id, run.payload_id]));
};

async function legacyOwnerIdentity() {
  const base = { host: hostname(), pid: process.pid, platform: process.platform, token: identity('owner') };
  if (process.platform !== 'linux') return base;
  const pid = await readlink('/proc/self'), text = await readFile('/proc/self/stat', 'utf8');
  return { ...base, procPid: Number(pid), startTicks: text.slice(text.lastIndexOf(')') + 2).split(' ')[19],
    bootId: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(),
    procfsNamespace: await readlink('/proc/1/ns/pid') };
}
async function ownerAlive(owner, current) {
  if (!owner) return false;
  need(owner.host === current.host, 'PROCESSING_OWNER_ON_ANOTHER_HOST');
  if (owner.platform === 'linux' && current.platform === 'linux') {
    if (owner.bootId !== current.bootId) return false;
    need(owner.procfsNamespace === current.procfsNamespace, 'PROCESSING_OWNER_PROCFS_VIEW_CHANGED');
    try {
      const text = await readFile('/proc/' + owner.procPid + '/stat', 'utf8');
      const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
      return fields[19] === owner.startTicks && !['Z', 'X'].includes(fields[0]);
    } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return false; throw error; }
  }
  try { process.kill(owner.pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

async function ownerIdentity() {
  return { host: hostname(), pid: process.pid, platform: process.platform,
    token: identity('owner'), mechanism: 'native-file-lock' };
}
async function legacyOwnerActive(owner) {
  return owner && owner.mechanism !== 'native-file-lock'
    ? ownerAlive(owner, await legacyOwnerIdentity()) : false;
}

export async function openProcessingWorkspace({ directory, stacWorkspace, transport, create = true, environment = process.env } = {}) {
  directory = await privateDirectory(directory, { create });
  const versions = await privateDirectory(join(directory, 'versions'), { create });
  for (const name of ['sources', 'captures', 'exports', 'locks']) await privateDirectory(join(directory, name), { create });
  let queue = Promise.resolve(), closing = false;
  async function withEditionLease(id, work) {
    try { return await withPrivateLock(join(directory, 'locks'), sha256(id) + '.lock', work); }
    catch (error) {
      if (error.code === 'ROUTESCAN_RECORD_BUSY') need(false, 'PROCESSING_OPERATION_ALREADY_RUNNING');
      throw error;
    }
  }
  async function getState() {
    for (let attempt = 0; attempt < 8; attempt++) {
      const names = (await readdir(versions)).filter(v => /^\d{12}\.json$/.test(v)).sort();
      need(names.length, 'PROCESSING_WORKSPACE_NOT_INITIALIZED');
      try { const s = await readJson(join(versions, names.at(-1)), 128 * 1024 * 1024); need(s.schema === SCHEMA, 'PROCESSING_WORKSPACE_SCHEMA'); return s; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    need(false, 'PROCESSING_CONCURRENT_STATE_CHANGE');
  }
  const versionPath = number => join(versions, String(number).padStart(12, '0') + '.json');
  if (!(await readdir(versions)).some(v => /^\d{12}\.json$/.test(v))) {
    need(create, 'PROCESSING_WORKSPACE_NOT_FOUND');
    try { await writeJson(versionPath(0), { schema: SCHEMA, id: identity('processing'), revision: 0,
      createdAt: stamp(), updatedAt: stamp(), deployments: [], configuredLocally: [], reviews: [], editions: [], associations: [], imports: [], operations: {} }, { exclusive: true }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  async function mutate(change, expectedRevision) {
    const action = queue.then(async () => {
      for (let attempt = 0; attempt < 16; attempt++) {
        const state = await getState();
        if (expectedRevision !== undefined) need(state.revision === expectedRevision, 'PROCESSING_REVISION_CHANGED');
        const result = change(state); state.revision++; state.updatedAt = stamp();
        try {
          await writeJson(versionPath(state.revision), state, { exclusive: true });
          const names = (await readdir(versions)).filter(v => /^\d{12}\.json$/.test(v)).sort();
          for (const name of names.slice(0, -8)) await unlink(join(versions, name)).catch(e => { if (e.code !== 'ENOENT') throw e; });
          return clone(result);
        } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      need(false, 'PROCESSING_CONCURRENT_STATE_CHANGE');
    });
    queue = action.catch(() => {}); return action;
  }
  async function sourceFor(deploymentKey) {
    const state = await getState(), entry = state.deployments.find(v => v.key === deploymentKey); need(entry, 'PROCESSING_DEPLOYMENT_NOT_CONFIGURED');
    const raw = await readBytes(join(directory, relative(entry.source.path)), 64 * 1024 * 1024);
    need(raw.length === entry.source.bytes && sha256(raw) === entry.source.sha256, 'PROCESSING_RETAINED_SOURCE_CHANGED');
    const contract = readProcessingContract(raw, entry.deployment, entry.source);
    need(digest({ deployment: entry.deployment, contract }) === entry.fingerprint, 'PROCESSING_DEPLOYMENT_BINDING_CHANGED');
    return { entry, contract, provider: createProcessingProvider({ deployment: entry.deployment, transport, environment,
      credentialsAuthorized: (state.configuredLocally ?? []).includes(deploymentKey) }) };
  }
  async function configure({ deployment: input, source, expectedRevision } = {}) {
    const deployment = normalizeDeployment(input); need(source && Buffer.isBuffer(source.body), 'PROCESSING_SOURCE_BYTES_REQUIRED');
    const metadata = source.metadata ?? {}, contract = readProcessingContract(source.body, deployment, metadata);
    const path = 'sources/' + contract.sourceSha256 + '.json';
    if (await exists(join(directory, path))) need((await readBytes(join(directory, path), source.body.length)).equals(source.body), 'PROCESSING_SOURCE_FILE_CONFLICT');
    else await writeBytes(join(directory, path), source.body, { exclusive: true });
    const fingerprint = digest({ deployment, contract }), entry = { key: deployment.id + ':' + fingerprint, fingerprint, deployment,
      source: { path, bytes: source.body.length, sha256: contract.sourceSha256, url: contract.sourceUrl,
        status: contract.sourceStatus, capturedAt: contract.sourceCapturedAt }, contract, configuredAt: stamp() };
    return mutate(s => {
      s.configuredLocally ??= [];
      if (!s.configuredLocally.includes(entry.key)) s.configuredLocally.push(entry.key);
      const old = s.deployments.find(v => v.key === entry.key); if (old) return old; s.deployments.push(entry); return entry;
    }, expectedRevision);
  }
  async function configureRetained({ deploymentKey, deployment, expectedRevision } = {}) {
    const source = await sourceFor(deploymentKey);
    try {
      const body = await readBytes(join(directory, relative(source.entry.source.path)), source.entry.source.bytes);
      return configure({ deployment: deployment ?? source.entry.deployment, source: { body, metadata: source.entry.source }, expectedRevision });
    } finally { source.provider.close(); }
  }
  const makeTask = ({ id, kind, request, rowsKey = null, immutableQuery = {}, scope = {} }) => ({ id, kind, request,
    initialRequest: request, requestHash: digest(request), rowsKey, immutableQuery, scope, state: 'PENDING', pages: [], attempts: [],
    pending: null, next: request, error: null, terminal: null });
  async function prepareInventory({ deploymentKey, operationId, kinds = ['instances', 'sources', 'definitions'] } = {}) {
    operationId = intent(operationId); const { entry, contract } = await sourceFor(deploymentKey);
    need(Array.isArray(kinds) && kinds.includes('instances') && kinds.every(v => ['instances', 'sources', 'definitions'].includes(v)), 'PROCESSING_INVENTORY_KINDS_INVALID');
    const selected = [...new Set(kinds)].filter(v => contract.routes[v]);
    const selection = { kind: 'INVENTORY', deploymentKey, kinds: selected }, fingerprint = digest(selection);
    const tasks = selected.map(kind => makeTask({ id: 'inventory-' + kind, kind, request: routeRequest(contract, kind, { limit: entry.deployment.pageSize }),
      rowsKey: { instances: 'workflows', sources: 'sources', definitions: 'workflows_definitions' }[kind], immutableQuery: { limit: entry.deployment.pageSize } }));
    return createEdition({ operationId, fingerprint, selection, tasks });
  }
  async function createEdition({ operationId, fingerprint, selection, tasks }) {
    const id = identity('processing-edition');
    return mutate(s => {
      const old = s.operations[operationId];
      if (old) { need(old.fingerprint === fingerprint, 'PROCESSING_OPERATION_INPUT_CHANGED'); return s.editions.find(v => v.id === old.editionId); }
      const entry = s.deployments.find(v => v.key === selection.deploymentKey); need(entry, 'PROCESSING_DEPLOYMENT_NOT_CONFIGURED');
      const edition = { id, operationId, fingerprint, selection, deploymentKey: selection.deploymentKey,
        sourceSha256: entry.source.sha256, state: 'PREPARED', createdAt: stamp(), updatedAt: stamp(), tasks,
        lease: null, history: [], cancelled: false, retryAt: null };
      s.editions.push(edition); s.operations[operationId] = { fingerprint, editionId: id }; return edition;
    });
  }
  async function getEdition(id) {
    const state = await getState(), edition = state.editions.find(v => v.id === id); need(edition, 'PROCESSING_EDITION_NOT_FOUND');
    const deployment = state.deployments.find(v => v.key === edition.deploymentKey);
    return { edition, deployment, associations: state.associations.filter(v => v.editionId === id) };
  }
  async function readTaskRows(task) {
    const rows = [];
    for (const page of task.pages) {
      const captured = await readProcessingCapture(join(directory, relative(page.directory)), page.requestHash);
      need(captured && captured.record.sha256 === page.sha256 && captured.record.status === 200, 'PROCESSING_CAPTURE_CHANGED');
      const values = captured.document?.[task.rowsKey]; need(Array.isArray(values), 'PROCESSING_PAGE_RECORDS_INVALID');
      for (const value of values) rows.push({ value, capture: { directory: page.directory, sha256: page.sha256,
        capturedAt: captured.record.capturedAt, retainedAt: captured.record.retainedAt ?? captured.record.importedAt ?? null } });
    }
    return rows;
  }
  async function reviewCapture({ inventoryId, workflowIds, since, stacEditionId = null,
    details = ['events', 'input_payload', 'output_payload'], logs = true, actor, note = '', operationId } = {}) {
    const { edition: inventory } = await getEdition(inventoryId);
    const instances = inventory.tasks.find(v => v.kind === 'instances');
    need(instances?.state === 'COMPLETE', 'PROCESSING_COMPLETE_INSTANCE_CHAIN_REQUIRED');
    const workflows = (await readTaskRows(instances)).map(v => v.value);
    need(Array.isArray(workflowIds) && workflowIds.length && workflowIds.every(v => typeof v === 'string' && workflows.some(w => w.id === v)), 'PROCESSING_NATIVE_WORKFLOW_SELECTION_REQUIRED');
    need((typeof since === 'string' && /^P(?=\d|T\d).{1,120}$/.test(since)) || Number.isFinite(since) && since >= 0, 'PROCESSING_NATIVE_SINCE_REQUIRED');
    need(Array.isArray(details) && details.every(v => ['events', 'input_payload', 'output_payload', 'definition'].includes(v)), 'PROCESSING_DETAIL_SELECTION_INVALID');
    need(typeof actor === 'string' && actor.trim().length > 0, 'PROCESSING_REVIEW_ACTOR_REQUIRED');
    const { contract } = await sourceFor(inventory.deploymentKey);
    need(contract.routes.runs.query.some(p => p.name === 'since'), 'PROCESSING_SINCE_NOT_DOCUMENTED');
    let stacBinding = null;
    if (stacEditionId !== null) {
      need(stacWorkspace, 'PROCESSING_ORIGINAL_STAC_WORKSPACE_REQUIRED');
      const native = await stacWorkspace.getEdition(stacEditionId), stacState = await stacWorkspace.getState();
      need(native.edition.state === 'COMPLETE' || native.edition.status === 'COMPLETE', 'PROCESSING_STAC_EDITION_INCOMPLETE');
      stacBinding = { workspaceId: stacState.id, endpoint: stacState.endpoint, editionId: stacEditionId,
        editionHash: digest(nativeEdition(native.edition)), itemCount: native.items.length };
    }
    const selection = { kind: 'RUN_HISTORY', deploymentKey: inventory.deploymentKey, inventoryId,
      workflowIds: [...new Set(workflowIds)], since, details: [...new Set(details)], logs: Boolean(logs), stac: stacBinding };
    const review = { id: identity('processing-review'), fingerprint: digest(selection), selection,
      actor: actor.trim().slice(0, 160), note: String(note).slice(0, 4000), reviewedAt: stamp() };
    if (operationId !== undefined) operationId = intent(operationId);
    return mutate(s => {
      const key = operationId ? 'review:' + operationId : null, old = key ? s.operations[key] : null;
      const fingerprint = digest({ selection, actor: review.actor, note: review.note });
      if (old) { need(old.fingerprint === fingerprint, 'PROCESSING_REVIEW_OPERATION_CHANGED'); return s.reviews.find(v => v.id === old.reviewId); }
      s.reviews.push(review);
      if (key) s.operations[key] = { fingerprint, reviewId: review.id };
      return review;
    });
  }
  async function prepareCapture({ reviewId, operationId } = {}) {
    operationId = intent(operationId); const review = (await getState()).reviews.find(v => v.id === reviewId);
    need(review && review.fingerprint === digest(review.selection), 'PROCESSING_REVIEW_NOT_FOUND');
    const { entry, contract } = await sourceFor(review.selection.deploymentKey);
    const tasks = review.selection.workflowIds.map(workflowId => {
      const query = { [contract.workflowFilter]: [workflowId], since: review.selection.since, limit: entry.deployment.pageSize };
      return makeTask({ id: 'runs-' + sha256(workflowId), kind: 'runs', request: routeRequest(contract, 'runs', query),
        rowsKey: 'runs', immutableQuery: query, scope: { workflowId } });
    });
    return createEdition({ operationId, fingerprint: digest({ reviewId, fingerprint: review.fingerprint }),
      selection: { ...review.selection, reviewId }, tasks });
  }
  async function claim(id) {
    const { edition } = await getEdition(id), owner = await ownerIdentity();
    if (edition.state === 'COMPLETE' || edition.state === 'COMPLETE_WITH_ERRORS' || edition.state === 'CANCELLED') return null;
    if (edition.retryAt) need(Date.parse(edition.retryAt) <= Date.now(), 'PROCESSING_RETRY_AFTER_PENDING');
    need(!await legacyOwnerActive(edition.lease), 'PROCESSING_OPERATION_ALREADY_RUNNING');
    const prior = edition.lease?.token ?? null;
    return mutate(s => {
      const e = s.editions.find(v => v.id === id); need((e.lease?.token ?? null) === prior, 'PROCESSING_OPERATION_CLAIM_CHANGED');
      e.lease = owner; e.state = 'RUNNING'; e.updatedAt = stamp();
      e.history.push({ at: stamp(), kind: 'CLAIMED', ownerToken: owner.token, recoveredOwner: prior }); return owner;
    });
  }
  async function owned(id, token, change) {
    return mutate(s => { const e = s.editions.find(v => v.id === id); need(e?.lease?.token === token, 'PROCESSING_OPERATION_OWNERSHIP_CHANGED');
      const result = change(e); e.updatedAt = stamp(); return result; });
  }
  function detailTasks(document, task, edition, contract) {
    const tasks = [];
    if (task.kind === 'runs') for (const run of document.runs) {
      const runKey = processingRunKey(run);
      need(run.workflow_id === task.scope.workflowId, 'PROCESSING_RUN_FILTER_NOT_APPLIED');
      for (const rel of edition.selection.details) {
        const links = (run.links ?? []).filter(v => v.rel === rel); need(links.length <= 1, 'PROCESSING_RUN_LINK_AMBIGUOUS');
        if (!links.length) continue;
        const url = processingUrl(links[0].href, contract.baseUrl);
        tasks.push(makeTask({ id: 'detail-' + digest({ runKey, rel, url, updated: run.updated ?? null, executions: run.executions ?? [] }),
          kind: rel, request: { method: 'GET', url, headers: { accept: 'application/json' } },
          scope: { runKey, workflowId: run.workflow_id, runId: run.run_id, payloadId: run.payload_id,
            executions: run.executions ?? [], runUpdated: run.updated ?? null, endpointScope: 'latest-execution-at-request' } }));
      }
    }
    if (edition.selection.logs && task.kind === 'events') {
      const allowed = ['lambdaLogs', 'batchLogs'].filter(v => contract.routes[v]).map(v => new URL(routeRequest(contract, v,
        Object.fromEntries(contract.routes[v].query.filter(p => p.required).map(p => [p.name, 'placeholder']))).url).pathname);
      const seen = new Set(); let visited = 0;
      const walk = value => {
        need(++visited <= 1000000, 'PROCESSING_EVENT_DOCUMENT_TOO_COMPLEX');
        if (!value || typeof value !== 'object') return;
        if (typeof value.href === 'string' && typeof value.rel === 'string') {
          let url;
          try { url = new URL(value.href, contract.baseUrl + '/'); } catch { return; }
          if (url.origin === new URL(contract.baseUrl).origin && allowed.includes(url.pathname) && !seen.has(url.href)) {
            processingUrl(url.href, contract.baseUrl);
            seen.add(url.href); tasks.push(makeTask({ id: 'logs-' + digest({ runKey: task.scope.runKey, url: url.href }), kind: 'logs',
              rowsKey: 'logs', request: { method: 'GET', url: url.href, headers: { accept: 'application/json' } }, scope: task.scope,
              immutableQuery: Object.fromEntries([...new Set(url.searchParams.keys())].filter(k => k !== 'pagination_token').map(k => [k, url.searchParams.getAll(k)])) }));
          }
        }
        for (const child of Object.values(value)) if (child && typeof child === 'object') {
          if (Array.isArray(child)) child.forEach(walk); else walk(child);
        }
      }; walk(document);
    }
    return tasks;
  }
  async function applyCaptured(id, token, taskId, captured, contract) {
    return owned(id, token, e => {
      const task = e.tasks.find(v => v.id === taskId), pending = task.pending;
      need(pending && pending.requestHash === captured.requestHash, 'PROCESSING_PENDING_PAGE_CHANGED');
      const ledger = { ...pending, status: captured.record.status, bytes: captured.record.bytes, sha256: captured.record.sha256,
        capturedAt: captured.record.capturedAt, retainedAt: captured.record.retainedAt ?? captured.record.importedAt ?? null,
        imported: captured.record.imported, retryAt: captured.record.retryAt ?? null };
      task.attempts[task.attempts.length - 1] = { ...ledger, state: 'RECEIVED' }; task.pending = null;
      if (captured.record.status !== 200 || captured.parseError || !object(captured.document)) {
        task.error = captured.parseError ?? ('PROCESSING_HTTP_' + String(captured.record.status));
        task.state = [401, 429, 503].includes(captured.record.status) ? 'PAUSED' : 'FAILED';
        if (task.state === 'PAUSED') { e.state = 'PAUSED'; e.retryAt = captured.record.retryAt ?? null; }
        e.history.push({ at: stamp(), kind: 'RESPONSE_REJECTED', taskId, status: captured.record.status, capture: ledger.directory, code: task.error }); return;
      }
      const doc = captured.document;
      if (task.rowsKey) {
        need(Array.isArray(doc[task.rowsKey]), 'PROCESSING_PAGE_RECORDS_INVALID');
        if (doc.record_count !== undefined) need(doc.record_count === doc[task.rowsKey].length, 'PROCESSING_RECORD_COUNT_MISMATCH');
      }
      const next = nextProcessingRequest(doc, captured.request, contract, { immutableQuery: task.immutableQuery, rowsKey: task.rowsKey });
      const repeated = next && [task.initialRequest, ...task.pages.map(v => v.request)].some(v => digest(v) === digest(next));
      const settledLogTail = repeated && task.kind === 'logs' && doc.logs.length === 0 && digest(next) === captured.requestHash;
      need(!repeated || settledLogTail, 'PROCESSING_PAGINATION_CYCLE');
      const additions = detailTasks(doc, task, e, contract);
      task.pages.push({ ...ledger, request: captured.request, recordCount: task.rowsKey ? doc[task.rowsKey].length : null });
      task.next = settledLogTail ? null : next; task.error = null;
      task.state = task.next ? 'PENDING' : 'COMPLETE';
      task.terminal = settledLogTail ? 'unchanged-empty-native-log-cursor' : next ? null : 'no-next-link';
      for (const addition of additions) if (!e.tasks.some(v => v.id === addition.id)) e.tasks.push(addition);
      e.history.push({ at: stamp(), kind: 'PAGE_RETAINED', taskId, capture: ledger.directory, status: captured.record.status,
        recordCount: task.rowsKey ? doc[task.rowsKey].length : null, terminal: task.terminal });
    });
  }
  async function pendingAttempt(id, token, taskId) {
    return owned(id, token, e => {
      const task = e.tasks.find(v => v.id === taskId); need(task?.next, 'PROCESSING_NEXT_PAGE_MISSING');
      const attempt = { directory: 'captures/' + identity('page'), request: task.next, requestHash: digest(task.next),
        startedAt: stamp(), state: 'PENDING' };
      task.attempts.push(attempt); task.pending = attempt; task.state = 'RUNNING'; return attempt;
    });
  }
  async function runEdition(id) {
    need(!closing, 'PROCESSING_WORKSPACE_CLOSED'); const key = directory + ':' + id;
    if (active.has(key)) return active.get(key).promise;
    const controller = new AbortController();
    const promise = withEditionLease(id, async () => {
      const owner = await claim(id); if (!owner) return getEdition(id);
      let provider;
      try {
        const { edition: original } = await getEdition(id), source = await sourceFor(original.deploymentKey);
        const { entry, contract } = source; provider = source.provider;
        need(original.sourceSha256 === entry.source.sha256, 'PROCESSING_EDITION_SOURCE_CHANGED');
        while (true) {
          const { edition } = await getEdition(id);
          if (edition.cancelled || controller.signal.aborted) {
            await owned(id, owner.token, e => { e.state = 'CANCELLED'; e.lease = null; e.history.push({ at: stamp(), kind: 'CANCELLED' }); }); break;
          }
          if (edition.state === 'PAUSED') { await owned(id, owner.token, e => { e.lease = null; }); break; }
          const task = edition.tasks.find(v => ['PENDING', 'RUNNING', 'PAUSED'].includes(v.state));
          if (!task) {
            await owned(id, owner.token, e => { e.state = e.tasks.some(t => t.state === 'FAILED') ? 'COMPLETE_WITH_ERRORS' : 'COMPLETE';
              e.completedAt = stamp(); e.lease = null; e.history.push({ at: stamp(), kind: 'CAPTURE_FINISHED', state: e.state }); }); break;
          }
          need(task.pages.length < entry.deployment.maxPages, 'PROCESSING_PAGE_LIMIT_REACHED');
          let attempt = task.pending, captured = null;
          if (attempt) {
            const path = join(directory, relative(attempt.directory));
            if (await exists(join(path, 'request.json'))) captured = await readProcessingCapture(path, attempt.requestHash);
            if (!captured) await owned(id, owner.token, e => {
              const t = e.tasks.find(v => v.id === task.id); t.attempts[t.attempts.length - 1].state = 'INTERRUPTED_WITHOUT_COMPLETE_BODY'; t.pending = null;
            });
          }
          if (!captured) {
            attempt = await pendingAttempt(id, owner.token, task.id);
            captured = await provider.capture(attempt.request, { directory: join(directory, attempt.directory), signal: controller.signal });
          }
          await applyCaptured(id, owner.token, task.id, captured, contract);
        }
      } catch (error) {
        await owned(id, owner.token, e => { e.state = e.cancelled || controller.signal.aborted ? 'CANCELLED' : 'PAUSED';
          e.error = errorCode(error); e.lease = null; e.history.push({ at: stamp(), kind: 'INTERRUPTED', code: e.error }); }).catch(() => {});
        throw error;
      } finally { provider?.close(); }
      return getEdition(id);
    }).finally(() => active.delete(key));
    active.set(key, { controller, promise }); return promise;
  }
  async function resume({ editionId, retryFailed = false } = {}) {
    const prepared = await withEditionLease(editionId, async () => {
      const { edition } = await getEdition(editionId);
      need(!await legacyOwnerActive(edition.lease), 'PROCESSING_OPERATION_ALREADY_RUNNING');
      if (edition.state === 'CANCELLED') return false;
      if (edition.retryAt) need(Date.parse(edition.retryAt) <= Date.now(), 'PROCESSING_RETRY_AFTER_PENDING');
      await mutate(s => {
        const e = s.editions.find(v => v.id === editionId);
        need((e.lease?.token ?? null) === (edition.lease?.token ?? null), 'PROCESSING_OPERATION_CLAIM_CHANGED');
        for (const t of e.tasks) if (t.state === 'PAUSED' || retryFailed && t.state === 'FAILED') t.state = 'PENDING';
        if (e.tasks.some(t => ['PENDING', 'RUNNING'].includes(t.state))) { e.state = 'PREPARED'; e.retryAt = null; }
      });
      return true;
    });
    return prepared ? runEdition(editionId) : getEdition(editionId);
  }
  async function cancel({ editionId } = {}) {
    await mutate(s => { const e = s.editions.find(v => v.id === editionId); need(e, 'PROCESSING_EDITION_NOT_FOUND');
      if (!['COMPLETE', 'COMPLETE_WITH_ERRORS'].includes(e.state)) { e.cancelled = true; if (!e.lease) e.state = 'CANCELLED'; } });
    const running = active.get(directory + ':' + editionId); running?.controller.abort();
    if (running) await running.promise.catch(() => {}); return getEdition(editionId);
  }
  async function importPage({ editionId, taskId, body, metadata } = {}) {
    return withEditionLease(editionId, async () => {
    const owner = await claim(editionId); need(owner, 'PROCESSING_EDITION_ALREADY_FINISHED');
    let provider;
    try {
      const { edition } = await getEdition(editionId), task = edition.tasks.find(v => v.id === taskId);
      need(task && ['PENDING', 'RUNNING', 'PAUSED'].includes(task.state), 'PROCESSING_IMPORT_TASK_NOT_PENDING');
      const source = await sourceFor(edition.deploymentKey), { contract } = source; provider = source.provider;
      let attempt = task.pending;
      if (!attempt) attempt = await pendingAttempt(editionId, owner.token, taskId);
      const captured = await provider.importResponse(attempt.request, { directory: join(directory, attempt.directory), body, metadata });
      await applyCaptured(editionId, owner.token, taskId, captured, contract);
      await owned(editionId, owner.token, e => {
        if (e.state !== 'PAUSED') e.state = e.tasks.every(t => t.state === 'COMPLETE' || t.state === 'FAILED')
          ? e.tasks.some(t => t.state === 'FAILED') ? 'COMPLETE_WITH_ERRORS' : 'COMPLETE' : 'PREPARED';
        e.lease = null;
      }); return getEdition(editionId);
    } catch (error) {
      await owned(editionId, owner.token, e => { e.state = 'PAUSED'; e.error = errorCode(error); e.lease = null; }).catch(() => {}); throw error;
    } finally { provider?.close(); }
    });
  }
  async function runs(editionId) {
    const { edition } = await getEdition(editionId), byKey = new Map();
    for (const task of edition.tasks.filter(v => v.kind === 'runs')) for (const row of await readTaskRows(task)) {
      const key = processingRunKey(row.value), existing = byKey.get(key) ?? { key, observations: [] };
      existing.observations.push(row); existing.latest = row.value; byKey.set(key, existing);
    }
    return [...byKey.values()];
  }
  async function getRun({ editionId, runKey } = {}) {
    const { edition } = await getEdition(editionId), run = (await runs(editionId)).find(v => v.key === runKey);
    need(run, 'PROCESSING_RUN_NOT_FOUND'); const details = [];
    for (const task of edition.tasks.filter(v => v.scope.runKey === runKey)) for (const page of task.pages) {
      const captured = await readProcessingCapture(join(directory, relative(page.directory)), page.requestHash);
      need(captured && captured.record.sha256 === page.sha256, 'PROCESSING_CAPTURE_CHANGED');
      details.push({ kind: task.kind, scope: task.scope, terminal: task.terminal, request: captured.request,
        metadata: captured.record, document: captured.document, captureDirectory: page.directory });
    }
    return { ...run, details, tasks: edition.tasks.filter(v => v.scope.runKey === runKey) };
  }
  async function associations({ editionId } = {}) {
    const { edition, associations: accepted } = await getEdition(editionId);
    need(edition.selection.stac && stacWorkspace, 'PROCESSING_STAC_BINDING_REQUIRED');
    const native = await stacWorkspace.getEdition(edition.selection.stac.editionId), current = await stacWorkspace.getState();
    need(current.endpoint === edition.selection.stac.endpoint && digest(nativeEdition(native.edition)) === edition.selection.stac.editionHash,
      'PROCESSING_STAC_EDITION_CHANGED');
    const processingRuns = await Promise.all((await runs(editionId)).map(v => getRun({ editionId, runKey: v.key })));
    return { binding: edition.selection.stac, proposals: proposeProcessingAssociations({ processingRuns, stacEdition: native }), accepted };
  }
  async function recordAssociation({ editionId, runKey, itemId, assetKey = null, actor, note, expectedRevision, operationId } = {}) {
    const model = await associations({ editionId });
    const selected = validateProcessingAssociation({ model, runKey, itemId, assetKey, actor, note });
    if (operationId !== undefined) operationId = intent(operationId);
    return mutate(s => {
      const key = operationId ? 'association:' + operationId : null, fingerprint = digest({ editionId, ...selected });
      const old = key ? s.operations[key] : null;
      if (old) { need(old.fingerprint === fingerprint, 'PROCESSING_ASSOCIATION_OPERATION_CHANGED'); return s.associations.find(v => v.id === old.associationId); }
      const record = { id: identity('association'), editionId, ...selected, at: stamp() };
      s.associations.push(record);
      if (key) s.operations[key] = { fingerprint, associationId: record.id };
      return record;
    }, expectedRevision);
  }
  const workspace = { directory, stacWorkspace, getState, configure, configureRetained, sourceFor, getEdition, runs, getRun, prepareInventory, prepareCapture,
    inventory: async editionId => {
      const { edition, deployment } = await getEdition(editionId);
      need(edition.selection.kind === 'INVENTORY', 'PROCESSING_INVENTORY_EDITION_REQUIRED');
      const chains = [];
      for (const task of edition.tasks) chains.push({ kind: task.kind, state: task.state, error: task.error,
        terminal: task.terminal, pages: task.pages.length, records: await readTaskRows(task) });
      return { editionId, state: edition.state, deploymentKey: deployment.key, chains };
    },
    discover: async input => { const e = await prepareInventory(input); return runEdition(e.id); },
    reviewCapture, capture: async input => { const e = await prepareCapture(input); return runEdition(e.id); },
    resume, cancel, importPage, associations, recordAssociation,
    readCapture: async path => readProcessingCapture(join(directory, relative(path))),
    exportHandover: input => exportProcessingHandover(workspace, input),
    importHandover: input => importProcessingHandover(workspace, input),
    _mergePortable: (payload, receipt) => mutate(s => {
      const prior = s.imports.find(v => v.digest === receipt.digest); if (prior) return prior;
      for (const field of ['deployments', 'reviews', 'editions', 'associations']) for (const value of payload[field]) {
        const key = field === 'deployments' ? 'key' : 'id', found = s[field].find(v => v[key] === value[key]);
        if (found) need(digest(found) === digest(value), 'PROCESSING_PORTABLE_IDENTITY_CONFLICT'); else s[field].push(value);
      }
      for (const [key, value] of Object.entries(payload.operations)) {
        if (s.operations[key]) need(digest(s.operations[key]) === digest(value), 'PROCESSING_PORTABLE_OPERATION_CONFLICT'); else s.operations[key] = value;
      }
      s.imports.push(receipt); return receipt;
    }),
    close: async () => { closing = true; const ownedRuns = [...active].filter(([key]) => key.startsWith(directory + ':')).map(([, value]) => value);
      for (const value of ownedRuns) value.controller.abort(); await Promise.allSettled(ownedRuns.map(v => v.promise)); await queue; }
  };
  return Object.freeze(workspace);
}


// The original STAC server owns sessions, Host/Origin/CSRF and its local job list.
// This explicit adapter adds processing actions to that server; it opens no port.
export async function createProcessingController({ stacWorkspace, directory, config = {} } = {}) {
  need(stacWorkspace && typeof stacWorkspace.getEdition === 'function', 'PROCESSING_ORIGINAL_STAC_WORKSPACE_REQUIRED');
  need(object(config), 'PROCESSING_CONFIG_INVALID');
  const workspace = await openProcessingWorkspace({ directory, stacWorkspace,
    transport: config.transport, environment: config.environment ?? process.env });
  const handovers = resolve(config.handoverDirectory ?? (directory + '-handover'));
  const receiving = resolve(config.receivingDirectory ?? (directory + '-receiving'));
  const body = (value, limit = 64 * 1024 * 1024) => {
    need(typeof value === 'string' && value.length <= Math.ceil(limit / 3) * 4, 'PROCESSING_SOURCE_BYTES_REQUIRED');
    const bytes = Buffer.from(value, 'base64');
    need(bytes.length <= limit && bytes.toString('base64') === value, 'PROCESSING_SOURCE_BASE64_INVALID');
    return bytes;
  };
  if (config.deployment) {
    const source = config.source ?? {};
    need(typeof source.path === 'string' || typeof source.bodyBase64 === 'string', 'PROCESSING_SOURCE_REQUIRED');
    const bytes = source.path ? await readBytes(resolve(source.path), 64 * 1024 * 1024) : body(source.bodyBase64);
    await workspace.configure({ deployment: config.deployment, source: { body: bytes, metadata: source.metadata ?? {} } });
  }
  const summarize = edition => ({ id: edition.id, operationId: edition.operationId, state: edition.state,
    deploymentKey: edition.deploymentKey, sourceSha256: edition.sourceSha256, selection: edition.selection,
    createdAt: edition.createdAt, updatedAt: edition.updatedAt, retryAt: edition.retryAt,
    error: edition.error ?? null, cancelled: edition.cancelled, history: edition.history,
    tasks: edition.tasks.map(task => ({ id: task.id, kind: task.kind, state: task.state, scope: task.scope,
      pages: task.pages.length, attempts: task.attempts.length, error: task.error, terminal: task.terminal,
      next: task.next, pending: task.pending ? { directory: task.pending.directory, requestHash: task.pending.requestHash } : null })) });
  const getState = async () => {
    const state = await workspace.getState();
    return { schema: state.schema, id: state.id, revision: state.revision, updatedAt: state.updatedAt,
      deployments: state.deployments.map(entry => ({ key: entry.key, fingerprint: entry.fingerprint,
        deployment: entry.deployment, source: entry.source, routes: Object.keys(entry.contract.routes),
        workflowFilter: entry.contract.workflowFilter, configuredAt: entry.configuredAt,
        credentialsConfiguredHere: (state.configuredLocally ?? []).includes(entry.key) })),
      editions: state.editions.map(summarize), reviews: state.reviews, associations: state.associations,
      imports: state.imports, operations: state.operations, exports: await (async () => {
        if (!await exists(handovers)) return [];
        const values = [];
        for (const id of (await readdir(handovers)).filter(v => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v))) {
          const path = join(handovers, id, 'manifest.json');
          if (!await exists(path)) continue;
          const manifest = await readJson(path, 128 * 1024 * 1024);
          if (manifest.schema === 'scf-stac-processing-handover/v1') values.push({ id, digest: manifest.digest,
            editionIds: manifest.editionIds, bytes: manifest.bytes, createdAt: manifest.createdAt });
        }
        return values;
      })() };
  };
  const selected = value => { need(typeof value === 'string' && value.length > 0 && value.length <= 2048,
    'PROCESSING_SAVED_IDENTIFIER_REQUIRED'); return value; };
  const reads = {
    source: async ({ query = {} } = {}) => {
      const source = await workspace.sourceFor(selected(query.deploymentKey));
      try {
        const bytes = await readBytes(join(workspace.directory, relative(source.entry.source.path)), source.entry.source.bytes);
        return { deploymentKey: source.entry.key, source: source.entry.source, bytes: bytes.length,
          sha256: source.entry.source.sha256, contentBase64: bytes.toString('base64') };
      } finally { source.provider.close(); }
    },
    inventory: async ({ query = {} } = {}) => workspace.inventory(selected(query.editionId)),
    edition: async ({ query = {} } = {}) => workspace.getEdition(selected(query.editionId)),
    runs: async ({ query = {} } = {}) => ({ editionId: selected(query.editionId), runs: await workspace.runs(query.editionId) }),
    run: async ({ query = {} } = {}) => workspace.getRun({ editionId: selected(query.editionId), runKey: selected(query.runKey) }),
    associations: async ({ query = {} } = {}) => workspace.associations({ editionId: selected(query.editionId) }),
    handover: async ({ query = {} } = {}) => {
      const id = intent(query.exportId), packed = await packProcessingHandover({ directory: join(handovers, id),
        maxBytes: config.browserExportMaxBytes ?? 64 * 1024 * 1024 });
      return { filename: packed.filename, mime: packed.mime, bytes: packed.bytes.length, sha256: packed.sha256,
        contentBase64: packed.bytes.toString('base64'), manifest: packed.manifest };
    }
  };
  const actions = {
    configure: async ({ input = {} } = {}) => workspace.configure({ deployment: input.deployment,
      source: { body: body(input.sourceBase64), metadata: input.sourceMetadata ?? {} }, expectedRevision: input.expectedRevision }),
    'configure-retained': async ({ input = {} } = {}) => workspace.configureRetained({
      deploymentKey: selected(input.deploymentKey), deployment: input.deployment, expectedRevision: input.expectedRevision }),
    discover: async ({ input = {}, operationId } = {}) => workspace.discover({ deploymentKey: selected(input.deploymentKey),
      operationId: intent(operationId), ...(input.kinds ? { kinds: input.kinds } : {}) }),
    'prepare-inventory': async ({ input = {}, operationId } = {}) => workspace.prepareInventory({
      deploymentKey: selected(input.deploymentKey), operationId: intent(operationId), ...(input.kinds ? { kinds: input.kinds } : {}) }),
    review: async ({ input = {}, operationId } = {}) => workspace.reviewCapture({ ...input, operationId: intent(operationId) }),
    capture: async ({ input = {}, operationId } = {}) => workspace.capture({ reviewId: selected(input.reviewId), operationId: intent(operationId) }),
    'prepare-capture': async ({ input = {}, operationId } = {}) => workspace.prepareCapture({ reviewId: selected(input.reviewId), operationId: intent(operationId) }),
    resume: async ({ input = {} } = {}) => workspace.resume({ editionId: selected(input.editionId), retryFailed: input.retryFailed === true }),
    cancel: async ({ input = {} } = {}) => workspace.cancel({ editionId: selected(input.editionId) }),
    'import-page': async ({ input = {} } = {}) => workspace.importPage({ editionId: selected(input.editionId),
      taskId: selected(input.taskId), body: body(input.bodyBase64), metadata: input.metadata }),
    'associate': async ({ input = {}, operationId } = {}) => workspace.recordAssociation({ ...input, operationId: intent(operationId) }),
    'export-handover': async ({ input = {}, operationId } = {}) => {
      const exportId = intent(operationId), result = await workspace.exportHandover({ editionIds: input.editionIds,
        includeStacAssets: input.includeStacAssets === true, operationId: exportId, directory: join(handovers, exportId) });
      return { exportId, manifest: result.manifest, completeDirectory: result.directory };
    },
    'import-handover': async ({ input = {}, operationId } = {}) => {
      const id = intent(operationId), opened = await unpackProcessingHandover({ body: body(input.bodyBase64, 128 * 1024 * 1024),
        directory: join(receiving, id) });
      return workspace.importHandover({ directory: opened.directory, operationId: id });
    }
  };
  return Object.freeze({ getState, reads: Object.freeze(reads), actions: Object.freeze(actions), close: workspace.close });
}
