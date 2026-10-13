// MIT. Complete native Tyk portfolio, migration review and original-request recovery.
import { createTykCommissioningMethods } from './commissioning-model.mjs';
import { randomUUID } from 'node:crypto';
import { normalizeTykConnection, planTykRequest, createTykTransport, inspectTykDefinition,
  reconcileTykRequest, responseTykApiIds, prepareTykDefinition, readTykMigrationDefinitions } from '../native.mjs';
import { buildTykDefinitionReview } from './review.mjs';
import { openTykStore, SCHEMA, KINDS, textHash, copy, field, recordId, requestId, idFor } from './store.mjs';
import { need, digest, now } from '../../../distribution/runtime-workspace/storage.mjs';
import { exportTykDelivery, inspectTykDelivery, adoptTykDelivery, stageTykDelivery, ensureTykDeliveryFile } from './delivery.mjs';

const TERMINAL_PHASES = new Set(['COMPLETED', 'PREPARE_FAILED', 'STALE', 'INTERRUPTED']);
const READABLE = new Set(['view', 'listRecords', 'getRecord', 'readDefinition', 'readSource', 'adaptDefinition', 'readReview', 'readCommissioning', 'deliveryFile', 'sourceFile']);
function errorInfo(error) {
  return {
    code: typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,120}$/.test(error.code) ? error.code : 'TYK_OPERATION_FAILED',
    message: String(error?.message ?? 'The operation could not finish.').slice(0,2000),
    outcomeUnknown: error?.outcomeUnknown === true, at: now(),
  };
}
function selectedInput(args) {
  const { signal, ...input } = args ?? {};
  return input;
}
function request(args, method) {
  need(args && typeof args === 'object' && !Array.isArray(args), 'TYK_INPUT_INVALID');
  requestId(args.requestId);
  return { id: args.requestId, sha256: textHash({ method, args: selectedInput(args) }) };
}
function page(input = {}) {
  const offset = input.offset ?? 0, limit = input.limit ?? 50;
  need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) &&
    limit > 0 && limit <= 500, 'TYK_PAGE_INVALID');
  return { offset, limit };
}
const uniqueIds = values => {
  need(Array.isArray(values) && values.length > 0, 'TYK_API_SELECTION_REQUIRED');
  const result = values.map(value => field(value, 1000, true));
  need(new Set(result).size === result.length, 'TYK_DUPLICATE_API_SELECTION');
  return result;
};
const recordRef = record => ({ kind: record.kind, id: record.id, revision: record.revision, sha256: record.sha256 });
const apiIdentity = item => ({ apiId: item.apiId, found: item.found !== false, kind: item.kind ?? null,
  sha256: item.sha256 ?? null });
const apiSummary = item => ({ apiId: item.apiId, kind: item.kind, found: item.found !== false,
  sha256: item.sha256, bytes: item.bytes, summary: item.summary, definitionRef: item.definitionRef });
const visible = record => {
  const value = record.value;
  return { schema: SCHEMA, kind: record.kind, id: record.id, revision: record.revision,
    sha256: record.sha256, createdAt: record.createdAt, updatedAt: record.updatedAt,
    label: value.label ?? value.connection?.label ?? record.id, state: value.state ?? value.phase ?? 'SAVED',
    phase: value.phase, summary: value.summary, connectionId: value.connectionId ?? value.connection?.id };
};

export async function openTykWorkspace({
  directory, connections = [], environment = process.env, fetch = globalThis.fetch, signal,
  timeoutMs = 120000, maximumResponseBytes = 64 * 1024 * 1024,
} = {}) {
  need(Array.isArray(connections), 'TYK_CONNECTIONS_INVALID');
  const store = await openTykStore(directory), controller = new AbortController(), active = new Set();
  let closing = false, closed = false, closePromise, serial = Promise.resolve();
  const workspaceId = store.identity.workspaceId;
  const combineSignal = extra => {
    const sources = [controller.signal, signal, extra].filter(Boolean);
    return sources.length === 1 ? sources[0] : AbortSignal.any(sources);
  };
  function run(fn, { write = false, signal: incoming } = {}) {
    need(!closing && !closed, 'TYK_WORKSPACE_CLOSING', 'The workspace is closing.', 409);
    const operation = write ? serial.then(() => {
      need(!closing, 'TYK_WORKSPACE_CLOSING', undefined, 409);
      return fn(combineSignal(incoming));
    }) : Promise.resolve().then(() => fn(combineSignal(incoming)));
    if (write) serial = operation.catch(() => {});
    active.add(operation);
    operation.then(() => active.delete(operation), () => active.delete(operation));
    return operation;
  }
  async function lookupConnection(id) {
    recordId(id);
    const record = await store.get('connection', id);
    const normalized = normalizeTykConnection(record.value.connection);
    need(textHash(normalized) === record.value.configurationSha256, 'TYK_CONNECTION_RECORD_CHANGED');
    return { record, connection: normalized };
  }
  function transport(connection, operationSignal) {
    return createTykTransport(connection, { environment, fetch, signal: operationSignal, timeoutMs, maximumResponseBytes });
  }
  async function sinks(id) {
    return {
      retainBodies: false,
      async onExchange(exchange) {
        const reference = await store.putJSON(exchange);
        await store.appendJournal(id, { type: 'exchange', reference, exchangeId: exchange.id,
          connectionId: exchange.connectionId, status: exchange.status, bodySha256: exchange.bodySha256 });
        return reference;
      },
      async onDefinition(definition) {
        const reference = await store.putJSON(definition);
        await store.appendJournal(id, { type: 'definition', reference, apiId: definition.apiId,
          definitionSha256: definition.sha256 });
        return reference;
      },
    };
  }
  async function hydrate(item) {
    const definition = item.definitionRef ? await store.getJSON(item.definitionRef) : item;
    const exchanges = [];
    for (const exchange of item.exchanges ?? []) {
      exchanges.push(exchange.bodyRef ? await store.getJSON(exchange.bodyRef) : exchange);
    }
    return { ...item, ...definition, exchanges };
  }
  async function hydrateAll(items) {
    const output = [];
    for (const item of items) output.push(await hydrate(item));
    return output;
  }
  async function readApis(client, ids, journalId, operationSignal) {
    const output = [], callbacks = await sinks(journalId);
    for (const apiId of [...new Set(ids)]) {
      operationSignal.throwIfAborted();
      output.push(await client.captureApi(apiId, { ...callbacks, signal: operationSignal, allowMissing: true }));
    }
    return output;
  }
  async function sameConfiguration(record) {
    const selected = await lookupConnection(record.value.connectionId);
    need(selected.record.value.configurationSha256 === record.value.configurationSha256,
      'TYK_TARGET_CHANGED', 'This target configuration changed. Prepare a new review for its current target.', 409);
    return selected.connection;
  }
  async function replay(input, method, latest = false) {
    const selected = request(input, method), prior = await store.findRequest(selected.id, selected.sha256);
    return { selected, prior: prior && (latest ? await store.get(prior.kind, prior.id) : prior) };
  }
  async function initial(kind, input, method, value, { id, expectedRevision = 0 } = {}) {
    const selected = request(input, method);
    return store.commit(kind, id ?? idFor(selected.id), { expectedRevision, requestId: selected.id,
      requestSha256: selected.sha256, value });
  }
  async function retainFailure(record, error, phase) {
    let journal, partialExchange;
    if (error?.exchange) {
      partialExchange = error.exchange.bodyRef ?? await store.putJSON(error.exchange);
      await store.appendJournal(record.id, { type: 'interrupted-exchange', reference: partialExchange,
        planSha256: error.exchange.request?.planSha256 ?? null, status: error.exchange.status ?? null });
    }
    try { journal = await store.journal(record.id); } catch {}
    return store.revise(record, { ...record.value, phase, state: phase, failure: { ...errorInfo(error), ...(partialExchange ? { exchange: partialExchange } : {}) },
      ...(journal ? { journal: journal.original, retainedEvents: journal.events.length } : {}) });
  }
  async function view() {
    const heads = await store.heads(), records = [];
    for (const reference of heads.filter(item => item.kind === 'connection')) {
      const record = await store.get('connection', reference.id);
      const configured = record.value.connection;
      records.push({ ...visible(record), connection: configured, configurationSha256: record.value.configurationSha256,
        credentialAvailable: typeof environment[configured.authEnv] === 'string' && environment[configured.authEnv].length > 0 });
    }
    return { schema: SCHEMA, workspaceId, directory: store.directory, createdAt: store.identity.createdAt,
      connections: records, counts: Object.fromEntries(KINDS.map(kind => [kind, heads.filter(item => item.kind === kind).length])),
      closing, capabilities: { migrations: 'native-dashboard', gatewayImport: true, hotReload: 'explicit',
        delivery: 'complete-source-and-history', automaticMutationRetry: false } };
  }
  async function listRecords(input = {}) {
    const result = await store.list(input);
    return { ...result, items: result.items.map(visible) };
  }
  async function getRecord(input) {
    const record = await store.get(input.kind, input.id, input.revision);
    const output = { ...record };
    if (record.kind === 'capture' && record.value.inventory) {
      const inventory = await store.getJSON(record.value.inventory), selected = page(input);
      const items = inventory.items.slice(selected.offset, selected.offset + selected.limit).map(apiSummary);
      output.portfolio = { ...selected, total: inventory.items.length, items,
        nextOffset: selected.offset + items.length < inventory.items.length ? selected.offset + items.length : null,
        pages: inventory.pages, consistency: inventory.consistency, startedAt: inventory.startedAt, completedAt: inventory.completedAt };
    }
    if (record.kind === 'rollout') {
      if (record.value.plan) output.plan = await store.getJSON(record.value.plan);
      if (record.value.reconciliation) output.reconciliation = await store.getJSON(record.value.reconciliation);
      if (record.value.response) {
        const original = await store.getJSON(record.value.response);
        output.response = { id: original.id, status: original.status, statusText: original.statusText, ok: original.ok, ok: original.ok,
          bodyBytes: original.bodyBytes, bodySha256: original.bodySha256, reference: record.value.response,
          json: original.bodyBytes <= 1024 * 1024 ? original.json : undefined,
          bodyText: original.bodyBytes <= 1024 * 1024 && original.json == null ? original.bodyText : undefined };
      }
    }
    return output;
  }
  async function readDefinition(input) {
    const record = await store.get('capture', input.captureId, input.revision);
    need(record.value.inventory, 'TYK_CAPTURE_INCOMPLETE', 'This capture has no complete portfolio.', 409);
    const inventory = await store.getJSON(record.value.inventory);
    const item = inventory.items.find(candidate => candidate.apiId === input.apiId);
    need(item, 'TYK_API_NOT_IN_CAPTURE', undefined, 404);
    return { capture: recordRef(record), definition: await hydrate(item) };
  }
  async function adaptDefinition(input) {
    const original = await readDefinition(input), { connection, record: target } = await lookupConnection(input.connectionId);
    need(original.definition.found !== false, 'TYK_CAPTURE_API_ABSENT', undefined, 409);
    const adapted = prepareTykDefinition(original.definition, connection);
    return { ...adapted, capture: original.capture, sourceDefinition: { captureId: original.capture.id,
      revision: original.capture.revision, apiId: original.definition.apiId, sha256: original.definition.sha256 },
      target: recordRef(target), connectionId: target.id, nativeConnectionId: connection.id };
  }
  async function readSource(input) { return { reference: input.reference, value: await store.getJSON(input.reference) }; }
  async function saveConnection(input) {
    const { prior } = await replay(input, 'saveConnection');
    if (prior) return prior;
    const connection = normalizeTykConnection(input.connection);
    const id = input.id ? recordId(input.id) : idFor('connection:' + connection.id);
    if (input.id) {
      const priorRecord = await store.get('connection', id);
      need(priorRecord.value.connection.id === connection.id, 'TYK_CONNECTION_ALIAS_CHANGED',
        'Create another target to use a different alias.', 409);
    }
    const all = await store.heads('connection');
    for (const ref of all) {
      if (ref.id !== id) need((await store.get('connection', ref.id)).value.connection.id !== connection.id,
        'TYK_CONNECTION_ALIAS_EXISTS', undefined, 409);
    }
    return initial('connection', input, 'saveConnection',
      { label: connection.label, connection, configurationSha256: textHash(connection), state: 'SAVED' },
      { id, expectedRevision: input.expectedRevision ?? 0 });
  }
  async function capture(input, operationSignal) {
    const { prior } = await replay(input, 'capture', true);
    if (prior) return prior;
    const { connection, record: target } = await lookupConnection(input.connectionId);
    let record = await initial('capture', input, 'capture', {
      label: field(input.label ?? 'Portfolio capture', 300, true), connectionId: target.id,
      configurationSha256: target.value.configurationSha256, connection,
      phase: 'CAPTURING', state: 'CAPTURING', source: 'native', startedAt: now(),
    });
    try {
      const client = transport(connection, operationSignal);
      const inventory = await client.captureInventory({ ...(await sinks(record.id)), signal: operationSignal });
      const reference = await store.putJSON(inventory), journal = await store.journal(record.id);
      const classic = inventory.items.filter(item => item.kind === 'classic').length;
      record = await store.revise(record, { ...record.value, inventory: reference, journal: journal.original,
        phase: 'COMPLETED', state: 'CAPTURED', completedAt: inventory.completedAt ?? now(),
        summary: { apis: inventory.items.length, classic, oas: inventory.items.filter(item => item.kind === 'oas').length,
          absent: inventory.items.filter(item => item.found === false).length, pages: inventory.pages?.length ?? inventory.pages } });
      return record;
    } catch (error) {
      record = await retainFailure(record, error, 'INTERRUPTED');
      return record;
    }
  }
  async function importCapture(input) {
    const { prior } = await replay(input, 'importCapture', true);
    if (prior) return prior;
    const { record: target, connection } = await lookupConnection(input.connectionId);
    const supplied = input.capture;
    need(supplied?.schema === 'stellar-forge.tyk-inventory-capture.v1' && Array.isArray(supplied.items),
      'TYK_CAPTURE_IMPORT_INVALID', 'Import a complete Tyk inventory capture JSON.');
    const items = [], ids = new Set(), exchanges = [];
    const retainExchange = async exchange => {
      need(exchange?.schema === 'stellar-forge.tyk-http-exchange.v1' && typeof exchange.bodyBase64 === 'string',
        'TYK_CAPTURE_EXCHANGE_REQUIRED');
      const bytes = Buffer.from(exchange.bodyBase64, 'base64');
      need(bytes.toString('base64') === exchange.bodyBase64 && bytes.length === exchange.bodyBytes &&
        digest(bytes) === exchange.bodySha256, 'TYK_CAPTURE_EXCHANGE_HASH_MISMATCH');
      const bodyRef = await store.putJSON(exchange);
      const { bodyText, bodyBase64, json, ...metadata } = exchange;
      return { ...metadata, bodyRef };
    };
    for (const item of supplied.items) {
      need(item && typeof item.apiId === 'string' && !ids.has(item.apiId), 'TYK_CAPTURE_API_INVALID');
      const absent = item.found === false;
      need(!absent || item.definitionText === null && item.sha256 === null && item.kind === null &&
        Array.isArray(item.exchanges) && item.exchanges.some(exchange => exchange.status === 404), 'TYK_CAPTURE_ABSENCE_INVALID');
      need(absent || typeof item.definitionText === 'string', 'TYK_CAPTURE_API_INVALID');
      const inspected = absent ? { summary: item.summary } : inspectTykDefinition(item.definitionText, { kind: item.kind, apiId: item.apiId });
      need(absent || digest(item.definitionText) === item.sha256, 'TYK_CAPTURE_DEFINITION_HASH_MISMATCH');
      ids.add(item.apiId);
      const original = { ...item, summary: inspected.summary ?? item.summary }, itemExchanges = [];
      for (const exchange of item.exchanges ?? []) itemExchanges.push(await retainExchange(exchange));
      const definitionRef = await store.putJSON(original);
      const { definitionText, ...metadata } = original;
      items.push({ ...metadata, definitionRef, exchanges: itemExchanges });
    }
    for (const exchange of supplied.exchanges ?? []) exchanges.push(await retainExchange(exchange));
    const inventory = { ...supplied, items, exchanges }, reference = await store.putJSON(inventory);
    return initial('capture', input, 'importCapture', {
      label: field(input.label ?? 'Imported portfolio', 300, true), connectionId: target.id,
      configurationSha256: target.value.configurationSha256, connection, phase: 'COMPLETED', state: 'CAPTURED',
      source: 'uploaded', inventory: reference, completedAt: now(),
      original: await store.putJSON(supplied), summary: { apis: items.length,
        classic: items.filter(item => item.kind === 'classic').length, oas: items.filter(item => item.kind === 'oas').length,
        absent: items.filter(item => item.found === false).length },
    });
  }
  async function createCohort(input) {
    const { prior } = await replay(input, 'createCohort');
    if (prior) return prior;
    const captureRecord = await store.get('capture', input.captureId, input.captureRevision);
    need(captureRecord.value.inventory && captureRecord.value.phase === 'COMPLETED', 'TYK_COMPLETE_CAPTURE_REQUIRED');
    const inventory = await store.getJSON(captureRecord.value.inventory), ids = uniqueIds(input.apiIds);
    const selected = ids.map(id => inventory.items.find(item => item.apiId === id));
    need(selected.every(item => item && item.found !== false), 'TYK_API_NOT_IN_CAPTURE',
      'Select API definitions that are present in this capture.');
    return initial('cohort', input, 'createCohort', {
      label: field(input.label, 300, true), note: field(input.note ?? '', 20000), state: 'SAVED',
      capture: recordRef(captureRecord), connectionId: captureRecord.value.connectionId,
      apiIds: ids, apis: selected.map(apiSummary), summary: { apis: ids.length,
        classic: selected.filter(item => item.kind === 'classic').length, oas: selected.filter(item => item.kind === 'oas').length },
    }, { id: input.id, expectedRevision: input.expectedRevision ?? 0 });
  }
  async function reviewSource(item, role, mediaType = 'application/json') {
    if (!item) return { state: 'PENDING', role };
    if (item.state === 'PENDING') return { state: 'PENDING', role };
    if (item.found === false) return { state: 'ABSENT', role };
    const original = await hydrate(item);
    need(typeof original.definitionText === 'string', 'TYK_REVIEW_SOURCE_REQUIRED');
    return { state: 'PRESENT', definitionText: original.definitionText, kind: original.kind, role,
      reference: await store.putBlob(original.definitionText, mediaType) };
  }
  async function retainReview(plan, before, { response = null, after = null } = {}) {
    const pairs = [], prepared = after === null, dryRun = plan.operation === 'migrate' && plan.mode === 'dryRun';
    const stage = prepared ? 'REQUEST_PREPARED' : dryRun ? 'NATIVE_CONVERSION' : 'CURRENT_READBACK';
    if (prepared && ['create','update','import'].includes(plan.operation)) {
      const apiId = plan.expectedApiId ?? plan.apiIds[0] ?? '(assigned by Tyk)';
      pairs.push({ apiId,
        before: await reviewSource(before.find(item => item.apiId === apiId), 'NATIVE_PREIMAGE'),
        after: await reviewSource({ definitionText: plan.bodyText, kind: plan.kind }, 'SUBMITTED_NATIVE_BODY', plan.contentType) });
    } else if (prepared && plan.operation === 'migrate') {
      for (const apiId of plan.apiIds) pairs.push({ apiId,
        before: await reviewSource(before.find(item => item.apiId === apiId), 'NATIVE_PREIMAGE'),
        after: { state: 'PENDING', role: 'NATIVE_CONVERSION' } });
    } else if (!prepared && dryRun) {
      const definitions = readTykMigrationDefinitions(response);
      for (const apiId of [...new Set([...plan.apiIds, ...definitions.keys()])]) {
        const converted = definitions.get(apiId);
        pairs.push({ apiId,
          before: await reviewSource(before.find(item => item.apiId === apiId), 'NATIVE_PREIMAGE'),
          after: converted === undefined ? { state: 'PENDING', role: 'NATIVE_CONVERSION' }
            : await reviewSource({ definitionText: converted, kind: 'oas' }, 'NATIVE_CONVERSION') });
      }
    } else if (!prepared) {
      for (const item of after) {
        let previous = before.find(value => value.apiId === item.apiId);
        let beforeApiId = item.apiId, relationship = 'SAME_NATIVE_API';
        if (plan.operation === 'migrate' && plan.mode === 'stage' && item.apiId.startsWith('staging-') &&
          (!previous || previous.found === false) && plan.apiIds.includes(item.apiId.slice('staging-'.length))) {
          beforeApiId = item.apiId.slice('staging-'.length);
          previous = before.find(value => value.apiId === beforeApiId);
          relationship = 'CLASSIC_TO_NATIVE_STAGED_COPY';
        }
        pairs.push({ apiId: item.apiId, beforeApiId, relationship,
          before: await reviewSource(previous, 'NATIVE_PREIMAGE'),
          after: await reviewSource(item, 'CURRENT_NATIVE_READBACK') });
      }
    }
    return store.putJSON(buildTykDefinitionReview({ stage, planSha256: plan.sha256, pairs }));
  }
  async function readReview(input) {
    const record = await store.get('rollout', input.id, input.revision);
    need(record.value.review, 'TYK_REVIEW_NOT_AVAILABLE', 'This saved rollout has no completed definition review.', 409);
    const report = await store.getJSON(record.value.review), selected = page(input);
    need(report.planSha256 === record.value.planSha256, 'TYK_REVIEW_PLAN_CHANGED');
    const { changes, ...metadata } = report, items = changes.slice(selected.offset, selected.offset + selected.limit);
    return { ...metadata, rollout: recordRef(record), reportSha256: record.value.review.sha256, report: record.value.review,
      ...(record.value.preparedReview ? { preparedReview: record.value.preparedReview } : {}),
      changes: { ...selected, total: changes.length, items,
        nextOffset: selected.offset + items.length < changes.length ? selected.offset + items.length : null } };
  }
  async function prepareRollout(input, operationSignal) {
    const { prior } = await replay(input, 'prepareRollout', true);
    if (prior) return prior;
    const { record: target, connection } = await lookupConnection(input.connectionId);
    const selection = copy(input.selection), plan = planTykRequest(connection, selection);
    let sourceDefinition = null;
    if (input.sourceDefinition) {
      need(['create','update'].includes(selection.operation), 'TYK_SOURCE_OPERATION_INVALID');
      const selected = input.sourceDefinition;
      const adapted = await adaptDefinition({ captureId: selected.captureId, revision: selected.revision,
        apiId: selected.apiId, connectionId: target.id });
      need(adapted.sourceDefinition.sha256 === selected.sha256 && adapted.kind === selection.kind,
        'TYK_SOURCE_DEFINITION_CHANGED', 'The selected source must match its exact saved capture.', 409);
      sourceDefinition = { ...selected, capture: adapted.capture, transformation: adapted.transformation,
        adaptedSha256: adapted.sha256, adaptedBytes: adapted.bytes };
    }
    let cohort = null;
    if (input.cohortId) {
      cohort = await store.get('cohort', input.cohortId, input.cohortRevision);
      if (selection.operation === 'migrate') {
        need(cohort.value.connectionId === target.id, 'TYK_COHORT_TARGET_MISMATCH');
        need(textHash([...cohort.value.apiIds].sort()) === textHash([...selection.apiIds].sort()),
          'TYK_COHORT_SELECTION_CHANGED', 'The native migration must use the saved cohort selection.');
        need(cohort.value.apis.every(item => item.kind === 'classic'), 'TYK_CLASSIC_COHORT_REQUIRED');
      }
    }
    need(selection.operation !== 'migrate' || cohort, 'TYK_MIGRATION_COHORT_REQUIRED');
    const planRef = await store.putJSON(plan), selectionRef = await store.putJSON(selection);
    let record = await initial('rollout', input, 'prepareRollout', {
      label: field(input.label ?? 'Tyk rollout', 300, true), note: field(input.note ?? '', 20000),
      phase: 'PREPARING', state: 'PREPARING', connectionId: target.id, connection,
      configurationSha256: target.value.configurationSha256, cohort: cohort ? recordRef(cohort) : null, sourceDefinition,
      selection: selectionRef, plan: planRef, planSha256: plan.sha256,
      summary: { operation: selection.operation, mode: selection.mode ?? null, apis: plan.apiIds.length,
        method: plan.method, path: plan.path, mutation: plan.mutation },
    });
    try {
      const initialEvidence = reconcileTykRequest(plan, [], [], null);
      const ids = [...new Set([...plan.apiIds, ...(initialEvidence.evidence?.readbackApiIds ?? [])])];
      const before = await readApis(transport(connection, operationSignal), ids, record.id, operationSignal);
      if (cohort && selection.operation === 'migrate') {
        for (const item of cohort.value.apis) {
          const current = before.find(api => api.apiId === item.apiId);
          need(current?.found && current.kind === item.kind && current.sha256 === item.sha256,
            'TYK_CAPTURE_CHANGED', 'A selected API changed since the portfolio capture. Capture and review its current definition.', 409);
        }
      }
      const beforeRef = await store.putJSON(before), review = await retainReview(plan, before), journal = await store.journal(record.id);
      record = await store.revise(record, { ...record.value, before: beforeRef, review, preparedReview: review, journal: journal.original,
        phase: 'PREPARED', state: 'PREPARED', preparedAt: now(),
        summary: { ...record.value.summary, existing: before.filter(item => item.found).length,
          absent: before.filter(item => !item.found).length } });
      return record;
    } catch (error) {
      return retainFailure(record, error, 'PREPARE_FAILED');
    }
  }
  async function finishReadback(record, client, operationSignal) {
    const plan = await store.getJSON(record.value.plan);
    const before = await hydrateAll(await store.getJSON(record.value.before));
    const response = record.value.response ? await store.getJSON(record.value.response) : null;
    const initialEvidence = reconcileTykRequest(plan, before, [], response);
    const ids = [...new Set([...plan.apiIds, ...(initialEvidence.evidence?.readbackApiIds ?? []),
      ...(response ? responseTykApiIds(plan, response) : [])])];
    const after = await readApis(client, ids, record.id, operationSignal);
    const result = reconcileTykRequest(plan, before, await hydrateAll(after), response);
    const review = await retainReview(plan, before, { response, after });
    const journal = await store.journal(record.id);
    let completed = await store.revise(record, { ...record.value, after: await store.putJSON(after), review,
      reconciliation: await store.putJSON(result), journal: journal.original, phase: 'COMPLETED',
      state: result.state, completedAt: now(), failure: null,
      summary: { ...record.value.summary, result: result.state, responseStatus: response?.status ?? null,
        readbackApis: after.length } });
    const selection = await store.getJSON(record.value.selection);
    if (selection.operation === 'hotReload' && response?.ok) {
      const activationReviews = [];
      for (const head of await store.heads('rollout')) {
        if (head.id === record.id) continue;
        const original = await store.get('rollout', head.id);
        if (original.value.connectionId !== record.value.connectionId || original.value.state !== 'ACCEPTED' ||
          original.value.configurationSha256 !== record.value.configurationSha256) continue;
        const originalSelection = await store.getJSON(original.value.selection);
        if (originalSelection.operation === 'hotReload') continue;
        try {
          const refreshed = await finishReadback(original, client, operationSignal);
          activationReviews.push({ id: refreshed.id, revision: refreshed.revision, state: refreshed.value.state });
        } catch (error) {
          activationReviews.push({ id: original.id, revision: original.revision, state: original.value.state, error: errorInfo(error) });
        }
      }
      completed = await store.revise(completed, { ...completed.value, activationReviews });
    }
    return completed;
  }
  async function dispatchRollout(input, operationSignal) {
    request(input, 'dispatchRollout');
    let record = await store.get('rollout', recordId(input.id));
    need(input.planSha256 === record.value.planSha256, 'TYK_REVIEW_HASH_CHANGED',
      'Execute the exact request shown in this saved review.', 409);
    if (record.value.phase !== 'PREPARED') return record;
    need(record.revision === input.expectedRevision, 'TYK_RECORD_CONFLICT', 'Refresh the saved review.', 409);
    await commissioning.validateCommissioningDispatch(record);
    const connection = await sameConfiguration(record), plan = await store.getJSON(record.value.plan);
    const selection = await store.getJSON(record.value.selection);
    need(planTykRequest(connection, selection).sha256 === plan.sha256, 'TYK_NATIVE_PLAN_CHANGED');
    const client = transport(connection, operationSignal);
    try {
      const before = await store.getJSON(record.value.before);
      const current = await readApis(client, before.map(item => item.apiId), record.id, operationSignal);
      if (textHash(before.map(apiIdentity)) !== textHash(current.map(apiIdentity))) {
        return store.revise(record, { ...record.value, phase: 'STALE', state: 'STALE',
          preflight: await store.putJSON(current), failure: { code: 'TYK_PREIMAGE_CHANGED',
            message: 'A target definition changed after preparation. Prepare a new review from current definitions.', at: now() } });
      }
      operationSignal.throwIfAborted();
      const original = request(input, 'dispatchRollout');
      record = await store.commit('rollout', record.id, { expectedRevision: record.revision,
        requestId: original.id, requestSha256: original.sha256,
        value: { ...record.value, phase: 'DISPATCHED', state: 'DISPATCHED', dispatchedAt: now(),
          dispatchRequestId: input.requestId, preflight: await store.putJSON(current) } });
      // This exact native request is issued once. A persisted dispatch is recovered through readback.
      const response = await client.execute(plan, { signal: operationSignal });
      const responseRef = await store.putJSON(response);
      await store.appendJournal(record.id, { type: 'dispatch-response', reference: responseRef,
        planSha256: plan.sha256, status: response.status, bodySha256: response.bodySha256 });
      record = await store.revise(record, { ...record.value, response: responseRef,
        phase: 'READBACK', state: 'READBACK', responseAt: now() });
      return await finishReadback(record, client, operationSignal);
    } catch (error) {
      if (record.value.phase === 'DISPATCHED' || record.value.phase === 'READBACK') {
        const latest = await store.get('rollout', record.id);
        return retainFailure(latest, error, 'UNKNOWN');
      }
      return retainFailure(record, error, 'PREPARE_FAILED');
    }
  }
  async function reconcileRollout(input, operationSignal) {
    const resumed = await replay(input, 'reconcileRollout', true);
    if (resumed.prior) return resumed.prior;
    let record = await store.get('rollout', recordId(input.id));
    need(record.value.dispatchedAt && record.value.before, 'TYK_DISPATCH_REQUIRED',
      'This saved request has not been dispatched.', 409);
    if (input.expectedRevision != null) need(record.revision === input.expectedRevision, 'TYK_RECORD_CONFLICT', undefined, 409);
    const connection = await sameConfiguration(record);
    record = await store.commit('rollout', record.id, { expectedRevision: record.revision,
      requestId: resumed.selected.id, requestSha256: resumed.selected.sha256,
      value: { ...record.value, phase: 'READBACK', state: 'READBACK', reconcileRequestId: input.requestId } });
    try {
      if (!record.value.response) {
        const retained = await store.journal(record.id);
        const responseEvent = [...retained.events].reverse().find(item => item.type === 'dispatch-response' &&
          item.planSha256 === record.value.planSha256);
        if (responseEvent) record = await store.revise(record, { ...record.value,
          response: responseEvent.reference, phase: 'READBACK', state: 'READBACK' });
      }
      return await finishReadback(record, transport(connection, operationSignal), operationSignal);
    } catch (error) { return retainFailure(record, error, 'UNKNOWN'); }
  }
  async function exportWorkspace(input) {
    request(input, 'exportWorkspace');
    return exportTykDelivery(store, input);
  }
  async function inspectDelivery(input) {
    request(input, 'inspectDelivery');
    return inspectTykDelivery(store, input);
  }
  async function adoptDelivery(input) {
    request(input, 'adoptDelivery');
    return adoptTykDelivery(store, input);
  }
  async function deliveryFile(input) {
    const record = await store.get('delivery', recordId(input.id));
    need(record.value.state === 'EXPORTED', 'TYK_DELIVERY_INCOMPLETE', undefined, 409);
    return { ...(await ensureTykDeliveryFile(store, record)), record: recordRef(record) };
  }
  async function sourceFile(input) {
    const path = store.blobPath(input.reference);
    return { path, bytes: input.reference.bytes, sha256: input.reference.sha256,
      mediaType: input.reference.mediaType ?? 'application/octet-stream',
      filename: 'tyk-source-' + input.reference.sha256 + '.source' };
  }
  const commissioning = createTykCommissioningMethods({store,lookupConnection,replay,initial,getRecord,prepareRollout,capture});
  const {validateCommissioningDispatch,...commissioningActions}=commissioning;
  const methods = { ...commissioningActions, view, listRecords, getRecord, readDefinition, readSource, adaptDefinition, readReview, saveConnection, capture,
    importCapture, createCohort, prepareRollout, dispatchRollout, reconcileRollout, exportWorkspace,
    inspectDelivery, adoptDelivery, deliveryFile, sourceFile };
  async function close() {
    if (closed) return;
    if (closePromise) return closePromise;
    closing = true; controller.abort(Object.assign(new Error('Workspace close requested.'), { code: 'TYK_WORKSPACE_CLOSING' }));
    closePromise = (async () => {
      await Promise.allSettled([...active]);
      await store.close(); closed = true;
    })().catch(error => { closePromise = undefined; throw error; });
    return closePromise;
  }
  try {
    // Supplied target declarations seed new aliases. Saved customer revisions remain authoritative on reopen.
    for (const declaration of connections) {
      const connection = normalizeTykConnection(declaration), id = idFor('connection:' + connection.id);
      if (!(await store.head('connection', id))) {
        const input = { requestId: randomUUID(), connection };
        await saveConnection(input);
      }
    }
    // Finish an already requested local receiving transaction under the same original record.
    for (const head of await store.heads('receiving')) {
      const received = await store.get('receiving', head.id);
      if (received.value.state === 'ADOPTING') {
        await adoptTykDelivery(store, { requestId: received.value.adoptRequestId, id: received.id,
          expectedRevision: received.value.adoptExpectedRevision, manifestSha256: received.value.manifestSha256 });
      }
    }
    // A newly acquired kernel lease owns recovery of the prior process's interrupted reads.
    for (const head of await store.heads()) {
      if (!['capture', 'rollout'].includes(head.kind)) continue;
      const record = await store.get(head.kind, head.id);
      if (['CAPTURING', 'PREPARING'].includes(record.value.phase)) {
        await retainFailure(record, { code: 'TYK_PROCESS_INTERRUPTED',
          message: 'The prior process stopped during source capture. Retained original exchanges remain available.' }, 'INTERRUPTED');
      }
    }
    const api = { schema: SCHEMA, workspaceId, directory: store.directory, close,
      stageDelivery(readable, input) { return run(() => stageTykDelivery(store, readable, input), { write: true }); } };
    for (const [name, fn] of Object.entries(methods)) {
      api[name] = (input = {}) => run(operationSignal => fn(input, operationSignal),
        { write: !READABLE.has(name), signal: input.signal });
    }
    return Object.freeze(api);
  } catch (error) {
    await close(); throw error;
  }
}
