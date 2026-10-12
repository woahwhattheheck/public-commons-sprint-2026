// MIT. Complete native catalogue review, harvest, record decisions and receiving.
import { realpath, lstat, chmod } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path';
import { readBytes, writeBytes, privateDirectory, exists } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { createGeoNetworkClient } from './native.mjs';
import { openCatalogueWorkspace, receiveCatalogueHandover } from './workspace.mjs';
import { inspectMef } from './mef.mjs';
import { copy, hash, requireValue, identifier, validatePlan, absoluteHttp } from './model.mjs';
import { canonicalJson } from '../provider.mjs';
import { StacDelivery } from '../customer.mjs';
const stamp = () => new Date().toISOString();
const resultValue = response => {
  requireValue(response && Object.hasOwn(response, 'value'), 'CATALOGUE_NATIVE_RESULT_REQUIRED');
  return response.value;
};
const yes = value => value === true || ['true', 'y', '1'].includes(String(value).toLowerCase());
const wait = (ms, signal) => new Promise((resolve, reject) => {
  const finish = () => { signal?.removeEventListener('abort', cancel); resolve(); };
  const timer = setTimeout(finish, ms);
  const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel);
    reject(Object.assign(new Error('Catalogue observation cancelled.'), { code: 'CATALOGUE_ABORTED', uncertain: true })); };
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
});
const sorted = values => [...new Set(values)].sort();
const recordKey = uuid => hash(uuid).slice(0, 32);
// Known read/review failures occur before the following native mutation is invoked.
async function preflight(work) {
  try { return await work(); }
  catch (error) { error.uncertain = false; throw error; }
}
function effectivePlan(node) {
  return { name: node.name, type: node.type, ownerId: String(node.ownerId), ownerGroupId: String(node.ownerGroupId),
    sourceUrl: node.sourceUrl, loopElement: node.loopElement, recordIdPath: node.recordIdPath,
    transform: node.transform, validation: node.validation,
    privileges: (node.privileges ?? []).map(item => ({ groupId: String(item.groupId),
      operations: sorted(item.operations ?? []) })).sort((a, b) => a.groupId.localeCompare(b.groupId)),
    oneRunOnly: yes(node.oneRunOnly), overrideUuid: node.overrideUuid,
    icon: node.icon, numberOfRecordPath: node.numberOfRecordPath, pageFromParam: node.pageFromParam,
    pageSizeParam: node.pageSizeParam, scheduleEvery: node.scheduleEvery, batchEdits: node.batchEdits,
    translateContent: node.translateContent, translateContentLangs: node.translateContentLangs,
    translateContentFields: node.translateContentFields,
    ifRecordExistAppendPrivileges: node.ifRecordExistAppendPrivileges, categories: node.categories,
    searches: node.searches, sourceAuth: node.sourceAuth };
}
function expectedPlan(plan) {
  return { name: plan.nativeName, type: 'simpleurl', ownerId: plan.ownerId, ownerGroupId: plan.ownerGroupId,
    sourceUrl: plan.sourceUrl, loopElement: plan.loopElement, recordIdPath: plan.recordIdPath,
    transform: plan.transform, validation: plan.validation, privileges: plan.privileges,
    oneRunOnly: true, overrideUuid: 'SKIP', icon: 'blank.png', numberOfRecordPath: '',
    pageFromParam: '', pageSizeParam: '', scheduleEvery: '0 0 0 ? * *', batchEdits: '[]',
    translateContent: false, translateContentLangs: '', translateContentFields: '',
    ifRecordExistAppendPrivileges: false, categories: [], searches: [''],
    sourceAuth: { configured: false, header: 'Authorization' } };
}
const matchesPlan = (node, plan) => canonicalJson(effectivePlan(node)) === canonicalJson(expectedPlan(plan));
const nonempty = value => value !== null && value !== undefined && value !== '' &&
  (typeof value !== 'object' || Object.keys(value).length > 0);
function historyKey(entry) { return String(entry.id ?? entry.sha256 ?? hash(entry)); }

async function completeInventory(client, { harvesterUuid = undefined, uuids = [] } = {}) {
  let from = 0; const seenOffsets = new Set(), records = new Map(); let expectedTotal = null;
  while (true) {
    requireValue(!seenOffsets.has(from), 'CATALOGUE_INVENTORY_PAGE_REPEATED'); seenOffsets.add(from);
    const page = resultValue(await client.inventory({ ...(harvesterUuid ? { harvesterUuid } : {}), uuids, from, size: 200 }));
    requireValue(Array.isArray(page.records) && page.totalRelation === 'eq' &&
      Number.isSafeInteger(page.total) && page.total >= 0, 'CATALOGUE_EXACT_INVENTORY_REQUIRED');
    if (expectedTotal === null) expectedTotal = page.total;
    requireValue(expectedTotal === page.total, 'CATALOGUE_INVENTORY_CHANGED_DURING_READ');
    for (const record of page.records) {
      requireValue(typeof record.uuid === 'string' && !records.has(record.uuid), 'CATALOGUE_INVENTORY_UUID_REPEATED');
      records.set(record.uuid, copy(record));
    }
    if (page.complete) break;
    requireValue(Number.isSafeInteger(page.nextFrom) && page.nextFrom > from && page.records.length,
      'CATALOGUE_INVENTORY_NEXT_PAGE_REQUIRED');
    from = page.nextFrom;
  }
  requireValue(records.size === expectedTotal, 'CATALOGUE_INVENTORY_INCOMPLETE');
  return { records: [...records.values()].sort((a, b) => a.uuid.localeCompare(b.uuid)),
    total: expectedTotal, scope: 'caller-visible-index' };
}
async function stableInventory(client, query) {
  const first = await completeInventory(client, query), second = await completeInventory(client, query);
  requireValue(hash(first) === hash(second), 'CATALOGUE_INVENTORY_CHANGED_DURING_REVIEW');
  return second;
}
async function history(client, node) {
  const first = resultValue(await client.history({ id: node.id, uuid: node.uuid, page: 0, size: 100 }));
  const entries = [...first.entries];
  requireValue(Number.isSafeInteger(first.total) && first.total >= 0 && first.total <= 100000,
    'CATALOGUE_HISTORY_LIMIT');
  for (let page = 1; page < Math.ceil(first.total / 100); page++) {
    const next = resultValue(await client.history({ id: node.id, uuid: node.uuid, page, size: 100 }));
    requireValue(next.total === first.total, 'CATALOGUE_HISTORY_CHANGED_DURING_READ'); entries.push(...next.entries);
  }
  requireValue(entries.length === first.total && new Set(entries.map(historyKey)).size === entries.length,
    'CATALOGUE_HISTORY_INCOMPLETE');
  return { entries, total: entries.length, sha256: hash(entries) };
}
async function selectedNode(client, id) {
  const list = resultValue(await client.listHarvesters({ id }));
  requireValue(list.nodes.length === 1 && String(list.nodes[0].id) === String(id), 'CATALOGUE_HARVESTER_NOT_FOUND');
  return list.nodes[0];
}
async function sourceRead(url, expected, { fetchImpl, timeoutMs, maximum, signal }) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  const signals = [controller.signal, signal].filter(Boolean);
  try {
    const response = await fetchImpl(absoluteHttp(url, { allowHttp: true }).href,
      { method: 'GET', headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.any(signals) });
    requireValue(response.ok && response.body, 'CATALOGUE_SOURCE_URL_UNAVAILABLE');
    const parts = []; let size = 0;
    for await (const part of response.body) {
      size += part.length; requireValue(size <= maximum, 'CATALOGUE_SOURCE_DOCUMENT_LIMIT'); parts.push(part);
    }
    const bytes = Buffer.concat(parts), document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    requireValue(hash(document) === expected.documentSha256 &&
      canonicalJson(document) === canonicalJson(expected.document), 'CATALOGUE_SERVED_SOURCE_CHANGED');
    return { sourceUrl: url, bytes: bytes.length, sha256: hash(bytes), documentSha256: hash(document),
      collectionCount: document.collections.length, observedAt: stamp() };
  } finally { clearTimeout(timer); controller.abort(); }
}


function recordsIdentity(records) {
  return records.map(({ uuid, status, approved, metadataSha256, info, sharing, attachments }) =>
    ({ uuid, status, approved, metadataSha256: metadataSha256 ?? null,
      info: info ? { source: info.source, isHarvested: info.isHarvested, ownerId: info.ownerId,
        changeDate: info.changeDate, schema: info.schema } : null, sharing: sharing ?? null,
      attachments: attachments ?? [] })).sort((a, b) => a.uuid.localeCompare(b.uuid));
}
function nativeCounters(entry, selectedCount, removedCount) {
  const result = entry?.result;
  const integer = name => {
    const value = result?.[name];
    return /^(0|[1-9][0-9]*)$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  };
  const fields = ['total', 'added', 'updated', 'unchanged', 'removed', 'badFormat',
    'unknownSchema', 'unretrievable', 'doesNotValidate', 'datasetUuidExist'];
  const counts = Object.fromEntries(fields.map(name => [name, integer(name)]));
  const issues = [];
  if (entry?.error || result?.error || result?.errors?.error) issues.push('Native harvest reports record or fatal errors.');
  if (fields.some(name => counts[name] === null)) issues.push('Native harvest result does not contain the complete SimpleURL counters.');
  if (counts.total !== selectedCount) issues.push('Native processed count differs from the complete selected collection source.');
  if (counts.added === null || counts.updated === null || counts.unchanged === null ||
    counts.added + counts.updated + counts.unchanged !== selectedCount)
    issues.push('Native added, updated and unchanged counts do not cover the complete selection.');
  if (counts.removed !== removedCount) issues.push('Native removed count differs from the reviewed prior-owned removal set.');
  for (const name of ['badFormat', 'unknownSchema', 'unretrievable', 'doesNotValidate', 'datasetUuidExist'])
    if (counts[name] !== 0) issues.push('Native ' + name + ' is not zero.');
  return { counts, issues, complete: issues.length === 0 };
}

function sharingRows(value) {
  requireValue(value && Array.isArray(value.privileges), 'CATALOGUE_NATIVE_SHARING_REQUIRED');
  return value.privileges.map(row => {
    requireValue(Number.isSafeInteger(Number(row.group)) && Number(row.group) >= -1 && row.operations &&
      typeof row.operations === 'object' && !Array.isArray(row.operations), 'CATALOGUE_NATIVE_SHARING_INVALID');
    return { group: String(row.group), operations: Object.keys(row.operations).filter(name => row.operations[name] === true).sort() };
  }).filter(row => row.operations.length).sort((a, b) => a.group.localeCompare(b.group));
}
function sharingAfter(before, payload, operations) {
  requireValue(typeof payload.clear === 'boolean' && Array.isArray(payload.privileges),
    'CATALOGUE_SHARING_REVIEW_REQUIRED');
  const map = new Map((payload.clear ? [] : sharingRows(before)).map(row => [row.group, new Set(row.operations)]));
  const groups = new Set();
  for (const row of payload.privileges) {
    const id = String(row.group);
    requireValue(/^(?:-1|0|[1-9][0-9]*)$/.test(id) && !groups.has(id) && row.operations &&
      typeof row.operations === 'object' && !Array.isArray(row.operations), 'CATALOGUE_SHARING_GROUP_INVALID');
    groups.add(id);
    const saved = map.get(id) ?? new Set();
    for (const [name, enabled] of Object.entries(row.operations)) {
      requireValue(typeof enabled === 'boolean' && operations.some(item => item.name === name),
        'CATALOGUE_SHARING_OPERATION_INVALID');
      requireValue(!(enabled && name === 'editing' && ['-1', '0', '1'].includes(id)),
        'CATALOGUE_RESERVED_GROUP_EDITING_INVALID');
      if (enabled) saved.add(name); else saved.delete(name);
    }
    map.set(id, saved);
  }
  return [...map].map(([group, names]) => ({ group, operations: [...names].sort() }))
    .filter(row => row.operations.length).sort((a, b) => a.group.localeCompare(b.group));
}
function publicationSharing(option) {
  const ids = { guest: -1, intranet: 0, all: 1 }, rows = new Map();
  const add = (group, operations) => {
    requireValue(Object.hasOwn(ids, group) && Array.isArray(operations) &&
      operations.every(name => typeof name === 'string'), 'CATALOGUE_NATIVE_PUBLICATION_OPTION_INVALID');
    const value = rows.get(ids[group]) ?? {};
    for (const name of operations) value[name] = true;
    rows.set(ids[group], value);
  };
  add(option.publicationGroup, option.publicationOperations);
  for (const [group, operations] of Object.entries(option.additionalPublications ?? {})) add(group, operations);
  return { clear: false, privileges: [...rows].map(([group, operations]) => ({ group, operations })) };
}
function processingIssues(report) {
  if (!report || typeof report !== 'object') return [];
  const fields = ['errors', 'metadataErrors', 'recordErrors', 'unprocessedRecords'];
  return fields.filter(name => nonempty(report[name]) && report[name] !== 0 && report[name] !== '0')
    .map(name => 'The native processing report retains ' + name + '.');
}
const workflowId = value => value?.currentStatus?.statusValue?.id === undefined ? null :
  String(value.currentStatus.statusValue.id);
function publicRequest(op) {
  const id = { operationId: op.id }, input = op.input ?? {};
  switch (op.kind) {
    case 'CONFIGURE': return { action: 'configure', input: { ...id, connection: copy(input.connection),
      ...(input.expectedRevision === null || input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }) } };
    case 'CONNECT': return { action: 'connect', input: id };
    case 'RECEIVE_SOURCE': return { action: 'receive', input: { ...id, deliveryDirectory: input.deliveryDirectory,
      collectionIds: copy(input.collectionIds), sourceUrls: copy(input.sourceUrls ?? {}),
      ...(input.sourceTitle === null || input.sourceTitle === undefined ? {} : { sourceTitle: input.sourceTitle }) } };
    case 'REVIEW_PLAN': return { action: 'review', input: { ...id, sourceSha256: input.sourceSha256, plan: copy(input.plan) } };
    case 'HARVEST': return { action: 'harvest', input: { ...id, planSha256: input.planSha256 } };
    case 'INSPECT_RECORDS': return { action: 'inspectRecords', input: { ...id, uuids: copy(input.uuids) } };
    case 'RECORD_ACTION': return { action: 'recordAction', input: { ...copy(input), ...id } };
    case 'PUBLISH_SOURCE': return { action: 'publishSource', input: { ...id, sourceSha256: input.sourceSha256 } };
    case 'EXPORT_HANDOVER': return { action: 'exportHandover', input: { ...id, outputDirectory: input.outputDirectory } };
    default: return null;
  }
}

export async function createCatalogueController({ directory, stacWorkspace = null, config = {} } = {}) {
  const aborter = new AbortController();
  const signal = config.signal ? AbortSignal.any([config.signal, aborter.signal]) : aborter.signal;
  const clients = new Set();
  const workspace = await openCatalogueWorkspace({ directory, stacWorkspace, title: config.title, signal });
  const environment = config.environment ?? process.env, fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const handoverDirectory = resolve(config.handoverDirectory ?? (directory + '-handovers'));
  function clientFor(context) {
    requireValue(context.state.connection, 'CATALOGUE_CONNECTION_REQUIRED');
    const client = createGeoNetworkClient(context.state.connection, { environment, fetchImpl, signal,
      async onExchange(exchange) {
        const record = await context.retain('exchanges/' + hash(exchange) + '.json', exchange);
        context.op.exchanges ??= [];
        if (!context.op.exchanges.some(value => value.sha256 === record.sha256)) context.op.exchanges.push(record);
        await context.checkpoint();
      } });
    clients.add(client); return client;
  }
  async function usingClient(context, work) {
    const client = clientFor(context);
    try { return await work(client); }
    finally { client.close(); clients.delete(client); }
  }
  async function identify(context, client) {
    const native = resultValue(await client.identify());
    requireValue(native.authenticated && native.actor?.id !== undefined, 'CATALOGUE_AUTHENTICATION_REQUIRED');
    context.state.capabilities = { ...copy(native), observedAt: stamp() }; await context.checkpoint();
    requireValue(native.versionMatches !== false, 'CATALOGUE_INSTALLED_VERSION_CHANGED');
    return native;
  }
  function checkPlan(plan, capability) {
    validatePlan(plan);
    requireValue(capability.options.harvesterTypes.includes('simpleurl'), 'CATALOGUE_SIMPLEURL_DISABLED');
    requireValue(capability.options.validationOptions.includes(plan.validation), 'CATALOGUE_NATIVE_VALIDATION_OPTION_MISSING');
    for (const group of plan.privileges)
      for (const operation of group.operations)
        requireValue(capability.options.operations.some(value => value.name === operation && value.harvesterAllowed),
          'CATALOGUE_HARVESTER_PRIVILEGE_UNAVAILABLE');
    requireValue(capability.groups.some(value => String(value.id) === plan.ownerGroupId) || capability.actor.admin,
      'CATALOGUE_OWNER_GROUP_NOT_AVAILABLE');
    requireValue(plan.ownerId === String(capability.actor.id) || capability.actor.admin,
      'CATALOGUE_OWNER_SELECTION_NOT_AVAILABLE');
  }
  async function captureRecords(context, client, uuids, capability, phase, { approved = true } = {}) {
    const records = [];
    for (const uuid of sorted(uuids)) {
      try {
        const record = resultValue(await client.readRecord(uuid, { approved, includeSharing: true }));
        requireValue(record.uuid === uuid && record.info?.uuid === uuid, 'CATALOGUE_NATIVE_RECORD_ID_CHANGED');
        const attachments = resultValue(await client.listAttachments(uuid, { approved }));
        const canEdit = capability.actor.admin || String(record.info.ownerId) === String(capability.actor.id) ||
          yes(record.info.edit) || yes(record.info.canEdit);
        const canDownload = capability.actor.admin || String(record.info.ownerId) === String(capability.actor.id) ||
          yes(record.info.download) || yes(record.info.canDownload);
        const xmlFile = await context.retain('records/' + recordKey(uuid) + '/' + hash(record.rawXml) + '.xml',
          Buffer.from(record.rawXml), { binary: true });
        const native = { uuid, status: 'PRESENT', approved, metadataSha256: record.metadataSha256,
          info: copy(record.info), sharing: copy(record.sharing), attachments: copy(attachments.attachments),
          attachmentInventoryComplete: Boolean(canEdit && canDownload), xmlFile };
        const snapshot = await context.retain('records/' + recordKey(uuid) + '/' + phase + '-' + hash(native) + '.json', native);
        records.push({ ...native, snapshot });
      } catch (error) {
        if (error.status !== 404) throw error;
        const missing = { uuid, status: 'NOT_VISIBLE_OR_ABSENT', approved,
          meaning: 'This caller received HTTP 404; no catalogue-wide absence is inferred.' };
        records.push({ ...missing, snapshot: await context.retain('records/' + recordKey(uuid) + '/' + phase + '-404.json', missing) });
      }
    }
    return records;
  }
  async function archive(context, client, records, phase) {
    const present = records.filter(record => record.status === 'PRESENT');
    if (!present.length) return { kind: 'EMPTY_NATIVE_SELECTION', phase, uuids: [], completeSelectedRecords: true };
    requireValue(present.every(record => record.attachmentInventoryComplete),
      'CATALOGUE_NATIVE_ARCHIVE_PERMISSIONS_REQUIRED', 'Use the record owner or an authorized catalogue administrator to retain the complete native attachments before refresh.');
    const native = resultValue(await client.exportMef(present.map(record => record.uuid), { approved: true,
      withXLinksResolved: false, withXLinkAttribute: true }));
    const inspection = inspectMef(native.bytes, { records: present,
      maxBytes: context.state.connection.maxMefBytes, maxFileBytes: context.state.connection.maxMefBytes });
    const file = await context.retain('archives/' + phase + '-' + inspection.sha256 + '.mef.zip', native.bytes, { binary: true });
    const value = { phase, operationId: context.op.id, createdAt: stamp(), file, ...inspection,
      recovery: 'Native metadata and attachment content. Import does not restore original harvester ownership or workflow state.' };
    const existing = context.state.archives.find(item => item.operationId === context.op.id && item.file.sha256 === file.sha256 && item.phase === phase);
    if (existing) return copy(existing);
    context.state.archives.push(value); await context.checkpoint();
    return value;
  }
  async function connect({ operationId }) {
    const state = await workspace.getState();
    requireValue(state.connection, 'CATALOGUE_CONNECTION_REQUIRED');
    return workspace.operation({ operationId, kind: 'CONNECT', input: { connectionSha256: hash(state.connection) } },
      async context => usingClient(context, client => identify(context, client)));
  }
  async function harvest({ planSha256, operationId, pollMs = 1000, maxPollMs = 60000 }) {
    requireValue(Number.isSafeInteger(pollMs) && pollMs >= 250 && pollMs <= 30000 &&
      Number.isSafeInteger(maxPollMs) && maxPollMs >= 0 && maxPollMs <= 300000, 'CATALOGUE_POLL_LIMIT_INVALID');
    return workspace.operation({ operationId, kind: 'HARVEST', input: { planSha256 } }, async context => {
      const client = clientFor(context);
      try {
      const capability = await identify(context, client), plan = context.plan(planSha256);
      requireValue(!Object.values(context.state.operations).some(item => item.id !== operationId &&
        ['HARVEST', 'RECORD_ACTION'].includes(item.kind) && ['RUNNING', 'RECONCILE'].includes(item.status)),
        'CATALOGUE_ORIGINAL_NATIVE_OPERATION_ACTIVE');
      checkPlan(plan, capability);
      const { source } = await context.source(plan.sourceSha256);
      const prior = context.state.harvester;
      const prepared = await context.step('prepare-native', async () => {
        const liveSource = await sourceRead(plan.sourceUrl, source, { fetchImpl, signal,
          timeoutMs: context.state.connection.timeoutMs, maximum: context.state.connection.maxResponseBytes });
        const all = resultValue(await client.listHarvesters());
        let node = null;
        if (prior) {
          node = all.nodes.find(value => String(value.id) === String(prior.id) && value.uuid === prior.uuid);
          requireValue(node, 'CATALOGUE_ORIGINAL_HARVESTER_NOT_FOUND');
          requireValue(node.configurationSha256 === prior.configurationSha256,
            'CATALOGUE_NATIVE_CONFIGURATION_CHANGED', 'Review the changed native harvester before updating it.');
          requireValue(!yes(node.running) && !yes(node.reindexing) && node.status === 'inactive',
            'CATALOGUE_NATIVE_HARVEST_ALREADY_RUNNING');
          requireValue(capability.actor.admin || String(node.ownerId) === String(capability.actor.id),
            'CATALOGUE_NATIVE_HARVESTER_OWNER_REQUIRED');
        } else requireValue(!all.nodes.some(value => value.name?.includes(plan.marker)),
          'CATALOGUE_EXISTING_OPERATION_MARKER', 'Open the workspace that owns this retained harvester marker.');
        const inventory = await stableInventory(client, { ...(node ? { harvesterUuid: node.uuid } : {}),
          uuids: sorted([...plan.expectedRecordIds, ...context.state.everOwnedUuids]) });
        const records = await captureRecords(context, client,
          sorted([...inventory.records.map(value => value.uuid), ...context.state.everOwnedUuids, ...plan.expectedRecordIds]),
          capability, 'before');
        const collisions = records.filter(value => value.status === 'PRESENT' && plan.expectedRecordIds.includes(value.uuid) &&
          (!node || value.info.source !== node.uuid || !yes(value.info.isHarvested)));
        requireValue(!collisions.length, 'CATALOGUE_FOREIGN_RECORD_COLLISION',
          'These native UUIDs already belong to other catalogue records: ' + collisions.map(value => value.uuid).join(', '));
        const owned = records.filter(value => value.status === 'PRESENT' && node &&
          (value.info.source === node.uuid || context.state.everOwnedUuids.includes(value.uuid)));
        const beforeArchive = await archive(context, client, owned, 'before');
        const beforeHistory = node ? await history(client, node) : { entries: [], total: 0, sha256: hash([]) };
        return { sourceRead: liveSource, node, inventory, records, beforeArchive, beforeHistory,
          preparedAt: stamp(), priorSourceSha256: context.state.lastVerifiedSourceSha256 };
      });
      async function confirmBeforeRun(node, { configurationBefore = false } = {}) {
        const live = await selectedNode(client, node.id);
        requireValue(live.uuid === node.uuid && !yes(live.running) && !yes(live.reindexing) &&
          live.status === 'inactive', 'CATALOGUE_NATIVE_HARVEST_ALREADY_RUNNING');
        if (configurationBefore)
          requireValue(live.configurationSha256 === prepared.node.configurationSha256,
            'CATALOGUE_NATIVE_CONFIGURATION_CHANGED');
        else requireValue(matchesPlan(live, plan), 'CATALOGUE_NATIVE_CONFIGURATION_CHANGED');
        const current = await stableInventory(client, { harvesterUuid: live.uuid,
          uuids: sorted([...plan.expectedRecordIds, ...context.state.everOwnedUuids]) });
        requireValue(hash(current) === hash(prepared.inventory), 'CATALOGUE_NATIVE_INVENTORY_CHANGED');
        const records = await captureRecords(context, client, prepared.records.map(record => record.uuid),
          capability, 'pre-dispatch');
        requireValue(hash(recordsIdentity(records)) === hash(recordsIdentity(prepared.records)),
          'CATALOGUE_NATIVE_RECORDS_CHANGED', 'Refresh the native review and archive after the current catalogue edits.');
        return live;
      }
      const configured = await context.step('configure-native', async () => {
        await preflight(async () => {
          await sourceRead(plan.sourceUrl, source, { fetchImpl, signal,
            timeoutMs: context.state.connection.timeoutMs, maximum: context.state.connection.maxResponseBytes });
          if (prepared.node) await confirmBeforeRun(prepared.node, { configurationBefore: true });
          else {
            const current = await stableInventory(client, { uuids: plan.expectedRecordIds });
            requireValue(hash(current) === hash(prepared.inventory), 'CATALOGUE_NATIVE_INVENTORY_CHANGED');
          }
        });
        return resultValue(prepared.node ? await client.updateHarvester(prepared.node.id, plan) :
          await client.addHarvester(plan));
      }, { mutation: true, reconcile: async () => {
        const candidates = resultValue(await client.listHarvesters()).nodes.filter(node =>
          prepared.node ? String(node.id) === String(prepared.node.id) && node.uuid === prepared.node.uuid :
            node.name?.includes(plan.marker));
        if (candidates.length !== 1 || !matchesPlan(candidates[0], plan))
          return { resolved: false, matchingMarkers: candidates.length };
        return { resolved: true, value: { id: candidates[0].id, outcome: 'CURRENT_CONFIGURATION_OBSERVED',
          dispatchAcknowledged: false, requiresReadback: true } };
      } });
      const node = await selectedNode(client, configured.id);
      requireValue(matchesPlan(node, plan) && typeof node.uuid === 'string' && node.uuid.length,
        'CATALOGUE_NATIVE_CONFIGURATION_CHANGED');
      if (prepared.node) requireValue(node.uuid === prepared.node.uuid, 'CATALOGUE_ORIGINAL_HARVESTER_CHANGED');
      context.state.harvester = { id: node.id, uuid: node.uuid, configurationSha256: node.configurationSha256,
        planSha256, sourceSha256: plan.sourceSha256, lastObservedAt: stamp() };
      await context.checkpoint();
      const baseline = await context.step('run-baseline', async () => {
        const current = await confirmBeforeRun(node);
        const historyBeforeRun = await history(client, current);
        requireValue(hash(historyBeforeRun) === hash(prepared.beforeHistory),
          'CATALOGUE_NATIVE_HISTORY_CHANGED');
        return { node: current, history: historyBeforeRun, observedAt: stamp() };
      });
      const baselineKeys = new Set(baseline.history.entries.map(historyKey));
      const originalRun = await context.step('run-native', async () => {
        await preflight(async () => {
          const current = await selectedNode(client, node.id);
          requireValue(current.uuid === node.uuid && matchesPlan(current, plan) &&
            !yes(current.running) && !yes(current.reindexing) && current.status === 'inactive' &&
            current.lastRun === baseline.node.lastRun, 'CATALOGUE_NATIVE_RUN_BASELINE_CHANGED');
        });
        const result = resultValue(await client.runHarvester(node.id));
        if (!result.accepted) throw Object.assign(new Error('The native harvester rejected this run: ' + result.nativeStatus),
          { code: 'CATALOGUE_NATIVE_RUN_REJECTED', uncertain: false });
        return { ...result, dispatchAcknowledged: true };
      }, { mutation: true, reconcile: async () => {
        const current = await selectedNode(client, node.id);
        requireValue(current.uuid === node.uuid && matchesPlan(current, plan), 'CATALOGUE_NATIVE_CONFIGURATION_CHANGED');
        const observed = await history(client, current);
        const newEntries = observed.entries.filter(entry => !baselineKeys.has(historyKey(entry)) && entry.harvesterUuid === node.uuid);
        if (!newEntries.length && !(yes(current.running) && current.lastRun !== baseline.node.lastRun))
          return { resolved: false, lastRun: current.lastRun, running: current.running,
            historySha256: observed.sha256 };
        return { resolved: true, value: { id: node.id, accepted: true,
          outcome: 'ORIGINAL_RUN_ACTIVITY_OBSERVED', dispatchAcknowledged: false,
          historyIds: newEntries.map(entry => entry.id), terminal: !yes(current.running) && newEntries.length > 0 } };
      } });
      const deadline = Date.now() + maxPollMs;
      let observation;
      while (true) {
        const current = await selectedNode(client, node.id);
        requireValue(current.uuid === node.uuid && matchesPlan(current, plan), 'CATALOGUE_NATIVE_CONFIGURATION_CHANGED');
        const currentHistory = await history(client, current);
        const newEntries = currentHistory.entries.filter(entry =>
          !baselineKeys.has(historyKey(entry)) && entry.harvesterUuid === node.uuid);
        observation = { node: current, history: currentHistory, newEntries, observedAt: stamp() };
        await context.checkpoint({ observation });
        if (!yes(current.running) && !yes(current.reindexing) && newEntries.length) break;
        if (!yes(current.running) && current.error && current.status !== 'inactive') {
          // A failed one-run harvest can remain scheduled; explicitly stop its same native node.
          await context.step('stop-after-error', async () => resultValue(await client.stopHarvester(node.id)),
            { mutation: true, reconcile: async () => {
              const read = await selectedNode(client, node.id);
              return { resolved: read.uuid === node.uuid && read.status === 'inactive' && !yes(read.running),
                value: { id: node.id, outcome: 'INACTIVE_OBSERVED', dispatchAcknowledged: false } };
            } });
        }
        if (Date.now() >= deadline) return context.pending('RUNNING', { operationId, planSha256,
          harvester: copy(context.state.harvester), originalRun, observation,
          message: 'This original native run is retained. Reconcile it to continue observing the same work.' });
        await wait(Math.min(pollMs, Math.max(1, deadline - Date.now())), signal);
      }
      if (observation.node.status !== 'inactive') {
        await context.step('stop-completed-run', async () => resultValue(await client.stopHarvester(node.id)),
          { mutation: true, reconcile: async () => {
            const read = await selectedNode(client, node.id);
            return { resolved: read.uuid === node.uuid && read.status === 'inactive' && !yes(read.running),
              value: { id: node.id, outcome: 'INACTIVE_OBSERVED', dispatchAcknowledged: false } };
          } });
      }
      const inactive = await selectedNode(client, node.id);
      requireValue(inactive.uuid === node.uuid && matchesPlan(inactive, plan) && inactive.status === 'inactive' &&
        !yes(inactive.running) && !yes(inactive.reindexing), 'CATALOGUE_NATIVE_HARVEST_NOT_QUIESCENT');
      context.state.harvester.configurationSha256 = inactive.configurationSha256;
      const afterInventory = await stableInventory(client, { harvesterUuid: node.uuid,
        uuids: sorted([...plan.expectedRecordIds, ...context.state.everOwnedUuids]) });
      let afterRecords = await captureRecords(context, client,
        sorted([...plan.expectedRecordIds, ...context.state.everOwnedUuids, ...afterInventory.records.map(record => record.uuid)]),
        capability, 'after');
      const owned = afterRecords.filter(record => record.status === 'PRESENT' &&
        record.info.source === node.uuid && yes(record.info.isHarvested));
      context.state.everOwnedUuids = sorted([...context.state.everOwnedUuids, ...owned.map(record => record.uuid),
        ...prepared.records.filter(record => record.status === 'PRESENT' && prepared.node &&
          record.info.source === prepared.node.uuid && yes(record.info.isHarvested)).map(record => record.uuid)]);
      const removed = prepared.records.filter(record => record.status === 'PRESENT' && prepared.node &&
        record.info.source === prepared.node.uuid && yes(record.info.isHarvested) && !plan.expectedRecordIds.includes(record.uuid));
      const counters = observation.newEntries.length === 1 ?
        nativeCounters(observation.newEntries[0], plan.expectedRecordIds.length, removed.length) :
        { complete: false, counts: null, issues: ['More than one new native run appeared since the saved baseline.'] };
      const issues = [...counters.issues];
      if (hash(sorted(owned.map(record => record.uuid))) !== hash(sorted(plan.expectedRecordIds)))
        issues.push('The actual native ownership and UUID set differs from the complete selected source.');
      if (owned.some(record => record.info.schema !== 'iso19115-3.2018'))
        issues.push('The actual native record schema differs from the selected installed STAC conversion.');
      let validation = null;
      if (!issues.length && plan.postHarvestValidation) {
        const expectedHashes = Object.fromEntries(owned.map(record => [record.uuid, record.metadataSha256]));
        validation = await context.step('validate-harvested-records',
          async () => ({ dispatchAcknowledged: true,
            report: resultValue(await client.validateRecords(plan.expectedRecordIds, { approved: true })) }),
          { mutation: true, reconcile: async () => {
            const records = [];
            for (const uuid of plan.expectedRecordIds) records.push(resultValue(await client.readValidation(uuid, { approved: true })));
            const observed = records.every(record => record.metadataSha256 === expectedHashes[record.uuid] &&
              ['0', '1'].includes(String(record.valid)));
            return { resolved: observed, value: { dispatchAcknowledged: false,
              outcome: 'CURRENT_VALIDATION_STATE_OBSERVED', report: null, records, runIdentity: null } };
          } });
        const statuses = [];
        for (const uuid of plan.expectedRecordIds) statuses.push(resultValue(await client.readValidation(uuid, { approved: true })));
        if (statuses.some(record => record.metadataSha256 !== expectedHashes[record.uuid]))
          issues.push('Native metadata changed while the validation results were being read.');
        if (statuses.some(record => String(record.valid) !== '1'))
          issues.push('One or more actual native records remain unvalidated or invalid.');
        issues.push(...processingIssues(validation.report));
        validation = { ...validation, persisted: statuses };
      }
      const afterArchive = await archive(context, client, owned, 'after');
      context.state.records = afterRecords;
      const result = { operationId, planSha256, sourceSha256: source.sha256,
        harvester: copy(context.state.harvester), originalRun, nativeHistory: observation.newEntries,
        beforeArchive: prepared.beforeArchive, afterArchive, inventory: afterInventory,
        records: afterRecords, validation, counters: counters.counts, issues,
        observedAt: stamp(), completeSelectedSet: issues.length === 0 };
      await context.retain('result-' + hash(result) + '.json', result);
      if (issues.length) return context.pending('PARTIAL', result);
      context.state.lastVerifiedSourceSha256 = source.sha256;
      return result;
      } catch (error) {
        if (context.op.steps['run-native']?.status === 'COMPLETE' &&
          !context.op.result?.completeSelectedSet) error.uncertain = true;
        throw error;
      } finally { client.close(); clients.delete(client); }
    });
  }
  async function optionalRead(invoke) {
    try { return resultValue(await invoke()); }
    catch (error) {
      if (![403, 404].includes(error.status)) throw error;
      return { available: false, status: error.status, code: error.code };
    }
  }
  async function inspectOne(context, client, uuid, capability, phase, { approved = true, includeDraft = true } = {}) {
    const [record] = await captureRecords(context, client, [uuid], capability, phase, { approved });
    if (record.status !== 'PRESENT') return record;
    record.sharingSha256 = hash(record.sharing);
    record.validation = { uuid, approved, metadataSha256: record.metadataSha256,
      changeDate: record.info.changeDate, valid: record.info.valid, details: copy(record.info.validationDetails ?? []),
      hasRunIdentity: false, source: 'persisted-geonet-info' };
    record.workflow = await optionalRead(() => client.readWorkflow(uuid, { approved }));
    record.draft = null;
    if (approved && includeDraft) {
      const draft = await optionalRead(() => client.readRecord(uuid, { approved: false, includeSharing: false }));
      if (draft.available !== false && draft.metadataSha256 !== record.metadataSha256) {
        record.draft = { metadataSha256: draft.metadataSha256, info: copy(draft.info),
          xmlFile: await context.retain('records/' + recordKey(uuid) + '/' + hash(draft.rawXml) + '.xml',
            Buffer.from(draft.rawXml), { binary: true }) };
      }
    }
    return record;
  }
  async function inspectRecords({ uuids, operationId } = {}) {
    const state = await workspace.getState();
    const original = state.operations[operationId];
    uuids ??= original?.kind === 'INSPECT_RECORDS' ? original.input.uuids :
      sorted([...state.everOwnedUuids, ...(state.harvester ? state.records.map(record => record.uuid) : [])]);
    requireValue(Array.isArray(uuids) && uuids.length <= 10000 && uuids.every(value =>
      typeof value === 'string' && value.length), 'CATALOGUE_RECORD_SELECTION_INVALID');
    uuids = sorted(uuids);
    return workspace.operation({ operationId, kind: 'INSPECT_RECORDS', input: { uuids } }, context =>
      usingClient(context, async client => {
        const capability = await identify(context, client), records = [];
        for (const uuid of uuids) records.push(await inspectOne(context, client, uuid, capability, 'review'));
        const harvester = context.state.harvester ? await selectedNode(client, context.state.harvester.id) : null;
        if (harvester) requireValue(harvester.uuid === context.state.harvester.uuid, 'CATALOGUE_ORIGINAL_HARVESTER_CHANGED');
        const nativeHistory = harvester ? await history(client, harvester) : null;
        const publicationOptions = resultValue(await client.publicationOptions());
        requireValue(Array.isArray(publicationOptions), 'CATALOGUE_NATIVE_PUBLICATION_OPTIONS_REQUIRED');
        for (const record of records) {
          const index = context.state.records.findIndex(item => item.uuid === record.uuid);
          if (index < 0) context.state.records.push(copy(record)); else context.state.records[index] = copy(record);
        }
        context.state.publicationOptions = copy(publicationOptions);
        return { records, history: nativeHistory, harvester, publicationOptions, observedAt: stamp() };
      }));
  }
  async function recordAction({ uuid, action, payload = {}, expectedMetadataSha256,
    expectedSharingSha256, operationId } = {}) {
    requireValue(typeof uuid === 'string' && uuid.length && ['validate', 'sharing', 'submit', 'approve', 'publish'].includes(action),
      'CATALOGUE_RECORD_ACTION_INVALID');
    requireValue(/^[a-f0-9]{64}$/.test(expectedMetadataSha256 ?? '') && payload &&
      typeof payload === 'object' && !Array.isArray(payload), 'CATALOGUE_REVIEWED_RECORD_REQUIRED');
    if (expectedSharingSha256 !== undefined)
      requireValue(/^[a-f0-9]{64}$/.test(expectedSharingSha256), 'CATALOGUE_REVIEWED_SHARING_REQUIRED');
    const allowed = { validate: ['approved'], sharing: ['clear', 'privileges'], submit: ['message'],
      approve: ['message', 'directApproval'], publish: ['publicationType'] }[action];
    requireValue(Object.keys(payload).every(key => allowed.includes(key)), 'CATALOGUE_RECORD_ACTION_FIELD_UNKNOWN');
    const input = { uuid, action, payload: copy(payload), expectedMetadataSha256,
      ...(expectedSharingSha256 === undefined ? {} : { expectedSharingSha256 }) };
    return workspace.operation({ operationId, kind: 'RECORD_ACTION', input }, context =>
      usingClient(context, async client => {
        requireValue(context.state.everOwnedUuids.includes(uuid) || context.state.records.some(record => record.uuid === uuid),
          'CATALOGUE_REVIEW_SELECTED_RECORD_FIRST');
        requireValue(!Object.values(context.state.operations).some(item => item.id !== operationId &&
          ['HARVEST', 'RECORD_ACTION'].includes(item.kind) && ['RUNNING', 'RECONCILE'].includes(item.status)),
          'CATALOGUE_ORIGINAL_NATIVE_OPERATION_ACTIVE');
        const capability = await identify(context, client);
        const approved = ['submit', 'approve'].includes(action) ? false : payload.approved !== false;
        const prepared = await context.step('review-record', async () => {
          const before = await inspectOne(context, client, uuid, capability, 'before-action', { approved, includeDraft: false });
          requireValue(before.status === 'PRESENT' && before.metadataSha256 === expectedMetadataSha256,
            'CATALOGUE_NATIVE_METADATA_CHANGED');
          let expectedSharing = null, publicationOption = null, targetStatus = null;
          if (['sharing', 'publish'].includes(action)) {
            requireValue(expectedSharingSha256 && before.sharingSha256 === expectedSharingSha256,
              'CATALOGUE_NATIVE_SHARING_CHANGED');
            if (action === 'publish') {
              const choices = resultValue(await client.publicationOptions());
              requireValue(Array.isArray(choices), 'CATALOGUE_NATIVE_PUBLICATION_OPTIONS_REQUIRED');
              publicationOption = choices.find(option => option.name === payload.publicationType);
              requireValue(publicationOption, 'CATALOGUE_NATIVE_PUBLICATION_OPTION_REQUIRED');
            }
            expectedSharing = sharingAfter(before.sharing,
              publicationOption ? publicationSharing(publicationOption) : payload, capability.options.operations);
          }
          if (['submit', 'approve'].includes(action)) {
            targetStatus = action === 'submit' ? '4' : '2';
            requireValue(Array.isArray(before.workflow.status) &&
              before.workflow.status.some(status => String(status.id) === targetStatus),
              'CATALOGUE_NATIVE_WORKFLOW_STATUS_REQUIRED');
            if (action === 'submit') requireValue(workflowId(before.workflow) === '1', 'CATALOGUE_NATIVE_DRAFT_REQUIRED');
            else if (payload.directApproval !== true)
              requireValue(workflowId(before.workflow) === '4', 'CATALOGUE_NATIVE_SUBMITTED_RECORD_REQUIRED');
          }
          return { before, expectedSharing, publicationOption, targetStatus, observedAt: stamp() };
        });
        async function afterState() {
          return inspectOne(context, client, uuid, capability, 'after-action',
            { approved: action === 'approve' ? true : approved, includeDraft: action === 'approve' });
        }
        function effectMatches(after) {
          if (after.status !== 'PRESENT') return false;
          if (action === 'validate') return after.metadataSha256 === expectedMetadataSha256 &&
            ['0', '1'].includes(String(after.validation.valid));
          if (['sharing', 'publish'].includes(action))
            return hash(sharingRows(after.sharing)) === hash(prepared.expectedSharing) &&
              (action === 'publish' || after.metadataSha256 === expectedMetadataSha256);
          return workflowId(after.workflow) === prepared.targetStatus;
        }
        const native = await context.step('native-record-action', async () => {
          await preflight(async () => {
            const current = resultValue(await client.readRecord(uuid, { approved, includeSharing: ['sharing', 'publish'].includes(action) }));
            requireValue(current.metadataSha256 === expectedMetadataSha256, 'CATALOGUE_NATIVE_METADATA_CHANGED');
            if (['sharing', 'publish'].includes(action))
              requireValue(hash(current.sharing) === expectedSharingSha256, 'CATALOGUE_NATIVE_SHARING_CHANGED');
            if (['submit', 'approve'].includes(action)) {
              const workflow = resultValue(await client.readWorkflow(uuid, { approved }));
              requireValue(hash(workflow.currentStatus) === hash(prepared.before.workflow.currentStatus),
                'CATALOGUE_NATIVE_WORKFLOW_CHANGED');
            }
          });
          let response;
          if (action === 'validate') response = await client.validateRecord(uuid, { approved });
          else if (action === 'sharing') response = await client.writeSharing(uuid, payload);
          else if (action === 'submit') response = await client.submitRecords([uuid], { message: payload.message ?? '' });
          else if (action === 'approve') response = await client.approveRecords([uuid],
            { message: payload.message ?? '', directApproval: payload.directApproval === true });
          else response = await client.publishRecord(uuid, { publicationType: payload.publicationType });
          return { dispatchAcknowledged: true, status: response.status, report: resultValue(response) };
        }, { mutation: true, reconcile: async () => {
          const after = await afterState();
          return { resolved: effectMatches(after), value: { dispatchAcknowledged: false,
            outcome: 'CURRENT_REVIEWED_EFFECT_OBSERVED', report: null, after,
            ...(action === 'publish' ? { processingCompletion: 'UNCONFIRMED' } : {}),
            ...(action === 'validate' ? { runIdentity: null } : {}) } };
        } });
        const after = await afterState(), issues = processingIssues(native.report);
        if (!effectMatches(after)) issues.push('The current native record does not have every reviewed effect.');
        if (action === 'validate' && String(after.validation?.valid) !== '1')
          issues.push('The native record remains invalid or unvalidated; review its native validation details.');
        if (action === 'approve' && !native.dispatchAcknowledged &&
          after.metadataSha256 !== prepared.before.metadataSha256)
          issues.push('The approved native content differs from the reviewed draft; inspect the retained versions.');
        if (action === 'publish' && !native.dispatchAcknowledged)
          issues.push('Publication privileges are observed. The lost acknowledgement does not confirm configured metadata processing.');
        const result = { operationId, uuid, action, before: prepared.before, after, native,
          publicationOption: prepared.publicationOption, complete: issues.length === 0, issues,
          futureRefreshPrivileges: ['sharing', 'publish'].includes(action) ?
            'The next harvester refresh applies its reviewed harvester privilege plan.' : null,
          observedAt: stamp() };
        const index = context.state.records.findIndex(record => record.uuid === uuid);
        if (index < 0) context.state.records.push(copy(after)); else context.state.records[index] = copy(after);
        await context.retain('record-action-' + hash(result) + '.json', result);
        if (issues.length) return context.pending('PARTIAL', result);
        return result;
      }));
  }

  async function inspectDelivery({ deliveryDirectory } = {}) {
    requireValue(typeof deliveryDirectory === 'string' && deliveryDirectory.length, 'CATALOGUE_DELIVERY_DIRECTORY_REQUIRED');
    const selected = resolve(deliveryDirectory);
    requireValue(await realpath(selected) === selected, 'CATALOGUE_CANONICAL_DIRECTORY_REQUIRED');
    const delivery = await StacDelivery.open(selected, { signal });
    return { directory: delivery.directory, manifest: copy(delivery.manifest),
      collections: copy(delivery.edition.collections) };
  }
  function publicationConfiguration() {
    const selected = config.sourcePublication;
    requireValue(selected && typeof selected.directory === 'string' && selected.directory.length &&
      typeof selected.baseUrl === 'string', 'CATALOGUE_SOURCE_PUBLICATION_NOT_CONFIGURED',
      'Select the complete JSON download, or configure an existing served source directory and its base URL.');
    const directory = resolve(selected.directory);
    const base = absoluteHttp(selected.baseUrl, { allowHttp: true, label: 'Existing collection source base URL' });
    requireValue(!base.search, 'CATALOGUE_PUBLICATION_BASE_QUERY_INVALID');
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    const contains = (parent, child) => {
      const path = relative(parent, child);
      return path === '' || path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
    };
    requireValue(!contains(workspace.directory, directory) && !contains(directory, workspace.directory),
      'CATALOGUE_SEPARATE_PUBLICATION_DIRECTORY_REQUIRED');
    return { directory, baseUrl: base.href };
  }
  async function publishSource({ sourceSha256, operationId } = {}) {
    const publication = publicationConfiguration();
    const result = await workspace.operation({ operationId, kind: 'PUBLISH_SOURCE',
      input: { sourceSha256, publication } }, async context => {
      const { source } = await context.source(sourceSha256);
      const filename = source.documentSha256 + '.collections.json';
      const file = await workspace.sourceDocument(source.documentSha256);
      const path = join(publication.directory, filename), sourceUrl = new URL(filename, publication.baseUrl).href;
      const verifyDirectory = async () => {
        const named = await lstat(publication.directory);
        requireValue(named.isDirectory() && !named.isSymbolicLink() &&
          await realpath(publication.directory) === publication.directory,
          'CATALOGUE_CANONICAL_PUBLICATION_DIRECTORY_REQUIRED');
        if (process.getuid) requireValue(named.uid === process.getuid(), 'CATALOGUE_PUBLICATION_DIRECTORY_OWNER_CHANGED');
      };
      await verifyDirectory();
      await context.step('save-complete-source', async () => {
        if (!await exists(path)) {
          try { await writeBytes(path, file.bytes, { exclusive: true, signal }); }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
        const bytes = await readBytes(path, file.bytes.length);
        requireValue(bytes.length === file.bytes.length && hash(bytes) === hash(file.bytes),
          'CATALOGUE_PUBLICATION_FILE_CHANGED');
        await verifyDirectory();
        // This explicit publication action makes only the selected immutable document readable.
        await chmod(path, 0o644);
        return { path, filename, bytes: bytes.length, sha256: hash(bytes) };
      });
      const bytes = await readBytes(path, file.bytes.length);
      requireValue(bytes.length === file.bytes.length && hash(bytes) === hash(file.bytes),
        'CATALOGUE_PUBLICATION_FILE_CHANGED');
      const servedDocument = await sourceRead(sourceUrl, source, { fetchImpl, signal,
        timeoutMs: context.state.connection?.timeoutMs ?? 30000,
        maximum: context.state.connection?.maxResponseBytes ?? 64 * 1024 * 1024 });
      requireValue(servedDocument.sha256 === hash(bytes) && servedDocument.bytes === bytes.length,
        'CATALOGUE_PUBLICATION_SERVING_BYTES_CHANGED');
      const published = { sourceSha256, documentSha256: source.documentSha256, sourceUrl,
        path, filename, bytes: bytes.length, sha256: hash(bytes), servedDocument };
      await context.retain('source-publication-' + hash(published) + '.json', published);
      return published;
    });
    return result;
  }
  async function getState() {
    const state = await workspace.getState();
    for (const op of Object.values(state.operations)) op.request = publicRequest(op);
    state.directory = workspace.directory;
    state.handoverDirectory = handoverDirectory;
    state.sourcePublication = config.sourcePublication ? {
      enabled: true, directory: config.sourcePublication.directory, baseUrl: config.sourcePublication.baseUrl
    } : { enabled: false };
    return state;
  }
  async function exportHandover({ outputDirectory, operationId } = {}) {
    identifier(operationId, 'handover operation ID');
    return workspace.exportHandover({ outputDirectory: outputDirectory ?? join(handoverDirectory, operationId), operationId });
  }
  async function receiveHandover({ sourceDirectory, directory, operationId } = {}) {
    const received = await receiveCatalogueHandover({ sourceDirectory, directory, operationId, signal });
    try { return { directory: received.workspace.directory, receipt: copy(received.receipt) }; }
    finally { await received.workspace.close(); }
  }
  return Object.freeze({
    directory: workspace.directory, getState, inspectDelivery,
    configure: input => workspace.configure(input), connect,
    receive: input => workspace.receive(input), review: input => workspace.review(input),
    publishSource, harvest, inspectRecords, recordAction, exportHandover, receiveHandover,
    getSource: sha256 => workspace.getSource(sha256),
    sourceDocument: sha256 => workspace.sourceDocument(sha256),
    getSavedFile: path => workspace.getSavedFile(path),
    async close() {
      aborter.abort();
      for (const client of clients) client.close();
      clients.clear();
      await workspace.close();
    }
  });
}
