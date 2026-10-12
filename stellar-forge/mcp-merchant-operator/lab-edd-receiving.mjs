// MIT. One complete Lab operation through original merchant MCP, SF88 and native results.
import assert from 'node:assert/strict';
import { mkdir, open, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { acquireStateLease } from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { atomicJson } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/routescan/quota.mjs';
import { createNativeProcessHost } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/processes-host.mjs';
import { sourceMembers, readLabDecisions } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/application.mjs';
import { inspectDelivery, canonicalJson, sha256 } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/model.mjs';
import { labProfile } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/profiles.mjs';
import { readReconciliationDecisions } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/reconciliation-application.mjs';
import { reconcileDeliveries } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/reconciliation.mjs';
import { reviewTable } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/decisions.mjs';
import { reconciliationTable } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/reconciliation-table.mjs';
import { readLabResult } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/result.mjs';
import { laboratoryParameters, laboratoryBinding, previewLaboratoryReview, laboratoryRows, laboratoryIssues,
  laboratoryGroups, laboratoryJson } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/operator-model.mjs';
import { startMerchantMcp } from './serve.mjs';
import { wqxReadPrivate, wqxPrivateDirectory } from './wqx-workspace-connection.mjs';
import { openLaboratoryWorkspaceClient, uploadLaboratoryInput, downloadLaboratoryFile, reopenLaboratoryDownload,
  receiveLaboratoryReply, downloadLaboratoryReview } from './lab-edd-client.mjs';

export const LABORATORY_OPERATOR_RECEIVING_SCHEMA = 'stellar-forge.lab-edd-operator-receiving.v1';
const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,70}$/;
const busy = row => ['RUNNING', 'CANCELLING'].includes(row?.task?.state);
const exact = (a, b, label) => assert.equal(canonicalJson(a), canonicalJson(b), label);
const bytes = value => Buffer.from(laboratoryJson(value));
const digest = value => createHash('sha256').update(value).digest('hex');
const collect = () => globalThis.gc?.();
function absolute(value, base, label) {
  assert(typeof value === 'string' && value && !value.includes('\0'), 'Select the original ' + label + '.');
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}
function pinnedFile(value, base, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Select the complete ' + label + '.');
  for (const key of Object.keys(value)) assert(['path', 'sha256', 'bytes', 'name', 'contentType'].includes(key), 'Unknown file option: ' + key);
  assert(HASH.test(value.sha256 ?? ''), 'Pin the exact original ' + label + ' bytes.');
  if (value.bytes !== undefined) assert(Number.isSafeInteger(value.bytes) && value.bytes >= 0);
  const path = absolute(value.path, base, label), name = value.name ?? basename(path);
  assert(name && name === basename(name) && !/[\\/\x00-\x1f\x7f]/.test(name), 'Use the original single filename.');
  return { path, sha256: value.sha256, ...(value.bytes === undefined ? {} : { bytes: value.bytes }),
    name, contentType: value.contentType ?? 'application/octet-stream' };
}
function normalize(input, base) {
  assert(input && typeof input === 'object' && !Array.isArray(input));
  const allowed = ['schema', 'operationId', 'merchantConfiguration', 'workspace', 'receiverWorkspace', 'tokenEnv',
    'expectedPayment', 'expectedCatalogSha256', 'expectedFunctionSha256', 'manageDedicatedWorker', 'deadlineMs', 'families'];
  for (const key of Object.keys(input)) assert(allowed.includes(key), 'Unknown receiving option: ' + key);
  assert.equal(input.schema, LABORATORY_OPERATOR_RECEIVING_SCHEMA);
  assert(ID.test(input.operationId ?? ''), 'Keep the same complete native operation ID.');
  for (const key of ['workspace', 'receiverWorkspace']) assert(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input[key] ?? ''));
  assert.notEqual(input.workspace, input.receiverWorkspace, 'Use two separately retained original customer desks.');
  assert(input.expectedPayment && typeof input.expectedPayment === 'object' &&
    ['scheme', 'network', 'asset', 'payTo', 'amount'].every(key => typeof input.expectedPayment[key] === 'string'),
  'Select the complete exact original payment terms for this explicitly requested receiving operation.');
  for (const key of ['expectedCatalogSha256', 'expectedFunctionSha256']) if (input[key] !== undefined) assert(HASH.test(input[key]));
  assert(input.manageDedicatedWorker === undefined || typeof input.manageDedicatedWorker === 'boolean');
  const deadlineMs = input.deadlineMs ?? 900000;
  assert(Number.isSafeInteger(deadlineMs) && deadlineMs >= 1000 && deadlineMs <= 3600000);
  const tokenEnv = input.tokenEnv ?? 'MCP_ACCESS_TOKEN';
  assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv));
  assert(Array.isArray(input.families) && input.families.length >= 1 && input.families.length <= 8);
  const ids = new Set();
  const families = input.families.map(family => {
    for (const key of Object.keys(family)) assert(['id', 'reference', 'reviewId', 'applyId', 'parameters',
      'source', 'baseline', 'documents', 'expected'].includes(key), 'Unknown native family option: ' + key);
    for (const key of ['id', 'reviewId', 'applyId']) assert(ID.test(family[key] ?? ''), 'Use a stable ' + key + '.');
    assert(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(family.reference ?? ''));
    for (const key of ['id', 'reference', 'reviewId', 'applyId']) {
      const identity = key + ':' + family[key]; assert(!ids.has(identity), 'Keep separate family identities.'); ids.add(identity);
    }
    const parameters = laboratoryParameters(family.parameters);
    assert(HASH.test(parameters.expectedSourceSha256 ?? ''), 'Bind this complete receiving to the original scientific source.');
    if (family.baseline) assert(HASH.test(parameters.expectedBaselineSha256 ?? ''));
    const documents = {};
    for (const [name, file] of Object.entries(family.documents ?? {})) {
      assert(['current', 'baseline', 'correspondence'].includes(name));
      documents[name] = pinnedFile(file, base, name + ' decisions');
    }
    const expected = family.expected ?? {};
    for (const key of Object.keys(expected)) assert(['currentRows', 'baselineRows', 'groups',
      'currentDocumentSha256', 'baselineDocumentSha256', 'comparisonSha256', 'correspondenceDocumentSha256',
      'correspondenceReviewSha256', 'outputComparisonSha256'].includes(key), 'Unknown original expected identity: ' + key);
    for (const [key, value] of Object.entries(expected)) assert(key.endsWith('Sha256') ? HASH.test(value) :
      Number.isSafeInteger(value) && value >= 0);
    return { ...family, parameters, source: pinnedFile(family.source, base, 'source'),
      ...(family.baseline ? { baseline: pinnedFile(family.baseline, base, 'baseline') } : {}), documents, expected };
  });
  return { ...input, deadlineMs, tokenEnv, families, merchantConfiguration:
    absolute(input.merchantConfiguration, base, 'configured original merchant MCP host') };
}
async function folder(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  return wqxPrivateDirectory(path);
}
async function immutable(path, raw) {
  let handle;
  try { handle = await open(path, 'wx', 0o600); await handle.writeFile(raw); await handle.sync(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    assert((await wqxReadPrivate(path, Math.max(raw.length, 1048576))).equals(raw), 'The original retained operation changed: ' + path);
  } finally { await handle?.close(); }
}
async function jsonAt(path, maximum = 2097152) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await wqxReadPrivate(path, maximum))); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function originalFile(file, maximum) {
  const raw = await readFile(file.path);
  assert(raw.length <= maximum && digest(raw) === file.sha256, 'The full original input changed: ' + file.name);
  if (file.bytes !== undefined) assert.equal(raw.length, file.bytes);
  return raw;
}

/**
 * Actual complete MCP operation. providerOptions/approve are trusted host-only native-fixture seams.
 * Normal operators use their original configured buyer/terminal; no payment result is substituted.
 */
export async function receiveLaboratoryOperator({ configuration, directory, signal, environment = process.env,
  providerOptions = {}, approve, onProgress } = {}) {
  const configurationPath = typeof configuration === 'string' ? resolve(configuration) : null;
  const supplied = configurationPath ? JSON.parse(await readFile(configurationPath, 'utf8')) : configuration;
  const selected = normalize(supplied, configurationPath ? dirname(configurationPath) : process.cwd());
  assert(typeof directory === 'string' && isAbsolute(directory) && resolve(directory) === directory && directory !== '/');
  const root = await folder(directory);
  assert.equal(await realpath(root), root);
  const configurationBytes = await wqxReadPrivate(selected.merchantConfiguration, 1048576);
  const lease = await acquireStateLease(root);
  const checkpointPath = join(root, 'checkpoint.json'), invocation = new Date().toISOString();
  const identity = { schema: LABORATORY_OPERATOR_RECEIVING_SCHEMA, configuration: selected,
    merchantConfigurationSha256: digest(configurationBytes) };
  let state, server, sourceClient, receiverClient, requestCount = 0, oracleHost, complete = false;
  const started = performance.now(), deadline = Date.now() + selected.deadlineMs;
  const transfers = [], phases = [], restarts = [];
  let listenerPort = 0;
  const options = { signal, timeoutMs: 120000 };
  const check = () => { signal?.throwIfAborted(); assert(Date.now() < deadline, 'Continue the same saved native operation after its configured deadline.'); };
  const checkpoint = async () => { state.updatedAt = new Date().toISOString(); await atomicJson(checkpointPath, state); };
  const progress = async (phase, detail = {}) => {
    phases.push({ phase, at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started), ...detail });
    await checkpoint(); await onProgress?.(phases.at(-1)); collect();
  };
  const openHost = async () => {
    check();
    server = await startMerchantMcp({ configPath: selected.merchantConfiguration, port: listenerPort,
      tokenEnv: selected.tokenEnv, environment, providerOptions });
    server.server.on('request', () => { requestCount++; });
    listenerPort = Number(new URL(server.url).port);
    if (state.listener) assert.equal(server.url, state.listener, 'Reopen the original endpoint for retained transfer continuity.');
    else { state.listener = server.url; await checkpoint(); }
    sourceClient = await openLaboratoryWorkspaceClient({ url: server.url, workspace: selected.workspace,
      tokenEnv: selected.tokenEnv, environment, signal });
    receiverClient = await openLaboratoryWorkspaceClient({ url: server.url, workspace: selected.receiverWorkspace,
      tokenEnv: selected.tokenEnv, environment, signal });
  };
  const closeHost = async () => {
    sourceClient?.close(); receiverClient?.close(); sourceClient = receiverClient = null;
    if (server) { const held = server; await held.close(); server = null; }
  };
  const restart = async label => {
    const before = server.url; await closeHost(); await openHost(); assert.equal(server.url, before);
    restarts.push({ label, endpoint: before, at: new Date().toISOString() });
  };
  const rpc = async (client, method, args = {}) => {
    check(); const reply = await client[method](args, options);
    if (reply.delivery !== 'COMPLETE_FILE') return reply;
    return (await receiveLaboratoryReply(client, reply, { ...options,
      directory: join(root, 'responses', reply.file.sha256) })).value;
  };
  const download = async (client, file, label, extra = {}) => {
    check(); const result = await downloadLaboratoryFile(client, { file,
      directory: join(root, 'downloads', label) }, { ...options, ...extra });
    assert.equal(result.bytes, file.bytes); assert.equal(result.sha256, file.sha256);
    const reopened = await reopenLaboratoryDownload({ directory: result.directory, expectedSha256: file.sha256 });
    assert.equal(reopened.sha256, file.sha256);
    transfers.push({ label, ...result }); return result;
  };
  const pageAll = async (method, args, expected, label) => {
    let offset = 0, total = null; const observed = [];
    do {
      const page = await rpc(sourceClient, method, { ...args, offset, limit: 200 });
      total ??= page.total; assert.equal(page.total, total); assert.equal(page.offset, offset);
      exact(page.items, expected.slice(offset, offset + 200), 'Every full original ' + label + ' survives pagination.');
      observed.push({ offset, rows: page.items.length });
      offset = page.nextOffset;
    } while (offset !== null);
    assert.equal(total, expected.length);
    return { total, pages: observed };
  };
  const waitOriginal = async (method, args, predicate, label, tick) => {
    for (;;) {
      check(); const row = await rpc(sourceClient, method, args);
      if (predicate(row)) return row;
      if (!busy(row)) throw Error(label + ': ' + (row.lastError ?? row.task?.error ?? row.phase ?? row.receipt?.latestStatus?.state ?? 'INCOMPLETE'));
      await tick?.(row);
      await pause(750, undefined, { signal });
    }
  };
  try {
    await immutable(join(root, 'operation.json'), bytes(identity));
    state = await jsonAt(checkpointPath) ?? { schema: LABORATORY_OPERATOR_RECEIVING_SCHEMA,
      operationId: selected.operationId, identitySha256: digest(bytes(identity)), startedAt: invocation, families: {} };
    assert.equal(state.identitySha256, digest(bytes(identity)));
    listenerPort = state.listener ? Number(new URL(state.listener).port) : 0;
    for (const name of ['responses', 'downloads', 'reviews']) await folder(join(root, name));
    await openHost();
    const status = await rpc(sourceClient, 'status');
    assert.equal(status.selected.workspace, selected.workspace);
    const receiverStatus = await rpc(receiverClient, 'status');
    assert.equal(receiverStatus.selected.functionId, status.selected.functionId);
    assert.equal(receiverStatus.selected.origin, status.selected.origin);
    await rpc(sourceClient, 'profiles'); await rpc(sourceClient, 'merchantStatus');
    if (selected.manageDedicatedWorker) await rpc(sourceClient, 'worker', { action: state.nativeWaitClose ? 'start' : 'stop' });
    let catalogue = state.catalogue;
    if (!catalogue) {
      catalogue = await rpc(sourceClient, 'discover');
      exact(catalogue.function.payment, selected.expectedPayment, 'Use the exact selected payment terms.');
      if (selected.expectedCatalogSha256) assert.equal(catalogue.catalogSha256, selected.expectedCatalogSha256);
      if (selected.expectedFunctionSha256) assert.equal(catalogue.function.functionSha256, selected.expectedFunctionSha256);
      state.catalogue = catalogue; await checkpoint();
    } else exact(catalogue.function.payment, selected.expectedPayment);
    await progress('original-configured-merchant-and-catalogue', { functionId: catalogue.function.id, catalogSha256: catalogue.catalogSha256 });
    for (const family of selected.families) {
      check(); const saved = state.families[family.id] ??= { reference: family.reference };
      const currentRaw = await originalFile(family.source, 16777216);
      const baselineRaw = family.baseline ? await originalFile(family.baseline, 16777216) : null;
      oracleHost = createNativeProcessHost({ env: environment, temporaryDirectory: root });
      let current, baseline, documents = {}, expected, binding, inspection, request;
      try {
        current = await inspectDelivery(sourceMembers(currentRaw, { filename: family.source.name,
          contentType: family.source.contentType }, { signal }), labProfile(family.parameters.profile),
        { encoding: family.parameters.encoding ?? 'utf-8', signal, processes: oracleHost });
        baseline = baselineRaw ? await inspectDelivery(sourceMembers(baselineRaw, { filename: family.baseline.name,
          contentType: family.baseline.contentType }, { signal }), labProfile(family.parameters.baselineProfile ?? family.parameters.profile),
        { encoding: family.parameters.baselineEncoding ?? family.parameters.encoding ?? 'utf-8', signal, processes: oracleHost }) : null;
      } finally { await oracleHost.close(); oracleHost = null; }
      assert.equal(current.source.sourceSha256, family.parameters.expectedSourceSha256);
      if (baseline) assert.equal(baseline.source.sourceSha256, family.parameters.expectedBaselineSha256);
      const comparison = baseline && current.source.profile.id !== baseline.source.profile.id ? reconcileDeliveries(current, baseline) : null;
      const documentRefs = {};
      for (const [kind, file] of Object.entries(family.documents)) {
        const raw = await originalFile(file, kind === 'correspondence' ? 16777216 : 134217728);
        documents[kind] = kind === 'correspondence' ? readReconciliationDecisions(comparison, raw,
          { filename: file.name, contentType: file.contentType }) : readLabDecisions(kind === 'current' ? current : baseline,
          raw, { filename: file.name, contentType: file.contentType });
        const transfer = await uploadLaboratoryInput(sourceClient, { path: file.path,
          inputId: 'lab-doc-' + digest(selected.operationId + ':' + family.id + ':' + kind).slice(0,40),
          name: file.name, contentType: file.contentType, expectedSha256: file.sha256 }, options);
        documentRefs[kind] = transfer.inputRef;
      }
      const draft = await rpc(sourceClient, 'requestCreate', { catalogRef: catalogue.catalogRef,
        expectedCatalogSha256: catalogue.catalogSha256, reference: family.reference,
        parameters: family.parameters, label: family.parameters.reviewName });
      request = await rpc(sourceClient, 'request', { requestId: draft.request.id });
      if (saved.requestId) assert.equal(request.id, saved.requestId); else { saved.requestId = request.id; await checkpoint(); }
      for (const [slot, file] of [['source', family.source], ...(family.baseline ? [['baseline', family.baseline]] : [])]) {
        const transfer = await uploadLaboratoryInput(sourceClient, { path: file.path,
          inputId: 'lab-source-' + digest(selected.operationId + ':' + family.id + ':' + slot).slice(0,40),
          name: file.name, contentType: file.contentType, expectedSha256: file.sha256 }, options);
        const staged = request.inputFiles.slots.find(value => value.slot === slot);
        if (staged?.file?.sha256 !== file.sha256 || staged?.upload?.state !== 'SEALED') {
          assert.equal(request.requestAttempts, 0, 'A dispatched request retains its original selected source.');
          request = await rpc(sourceClient, 'select', { requestId: request.id, slot, inputRef: transfer.inputRef,
            expectedSha256: file.sha256, expectedRevision: request.revision });
        }
      }
      inspection = await rpc(sourceClient, 'inspect', { requestId: request.id, expectedRevision: request.revision });
      binding = laboratoryBinding({ requestId: request.id, reference: request.reference, merchant: inspection.binding.merchant,
        input: request.input, files: Object.fromEntries(['source','baseline'].filter(slot => request.input.$files[slot])
          .map(slot => [slot, { descriptor: request.input.$files[slot] }])) }, current, baseline);
      exact(inspection.binding, binding, 'The native held source and original model bind the same originals.');
      const sourceArgs = { requestId: request.id, expectedBindingSha256: binding.bindingSha256 };
      const nativeRows = {};
      for (const side of ['current', ...(baseline ? ['baseline'] : [])]) {
        const allRows = laboratoryRows({ current, baseline }, { side });
        const key = side + 'Rows'; if (family.expected[key] !== undefined) assert.equal(allRows.length, family.expected[key]);
        nativeRows[side] = await pageAll('rows', { ...sourceArgs, side }, allRows, side + ' physical row');
        await pageAll('issues', { ...sourceArgs, side }, laboratoryIssues({ current, baseline }, { side }), side + ' source issue');
        if (allRows.length) {
          const one = await rpc(sourceClient, 'rows', { ...sourceArgs, side, recordId: allRows[0].recordId, limit: 200 });
          exact(one.items, laboratoryRows({ current, baseline }, { side, recordId: allRows[0].recordId }));
        }
      }
      if (comparison) {
        if (family.expected.groups !== undefined) assert.equal(comparison.groups.length, family.expected.groups);
        nativeRows.correspondence = await pageAll('groups', sourceArgs, laboratoryGroups(comparison), 'correspondence group');
        if (comparison.groups.length) {
          const groupId = comparison.groups[0].groupId;
          const one = await rpc(sourceClient, 'groups', { ...sourceArgs, groupId, limit: 200 });
          exact(one.items, laboratoryGroups(comparison, { groupId }));
        }
      }
      expected = previewLaboratoryReview({ binding, current, baseline }, documents);
      for (const [key, value] of Object.entries(family.expected)) if (key.endsWith('Sha256')) assert.equal(expected.identity[key], value, key);
      for (const kind of Object.keys(expected.documents)) for (const format of ['csv','tsv']) {
        const native = await rpc(sourceClient, 'table', { ...sourceArgs, documentRefs, family: kind, format, scope: 'all' });
        const table = kind === 'correspondence' ? reconciliationTable(expected.comparison, expected.documents[kind], { format }) :
          reviewTable(kind === 'current' ? current : baseline, expected.documents[kind], { format, scope: 'all' });
        const raw = Buffer.from(table.text);
        assert.equal(native.file.sha256, digest(raw)); assert.equal(native.file.bytes, raw.length);
        const retained = await download(sourceClient, native.file, family.id + '-' + kind + '-' + format);
        assert((await wqxReadPrivate(retained.filename, 134217728)).equals(raw));
        const incoming = await uploadLaboratoryInput(sourceClient, { path: retained.filename,
          inputId: 'lab-table-' + digest(selected.operationId + ':' + family.id + ':' + kind + ':' + format).slice(0,40),
          name: native.file.name, contentType: native.file.contentType, expectedSha256: native.file.sha256 }, options);
        const imported = await rpc(sourceClient, 'tableImport', { ...sourceArgs, family: kind, inputRef: incoming.inputRef });
        assert.equal(imported.documentSha256, sha256(canonicalJson(expected.documents[kind])));
        documentRefs[kind] = imported.documentRef;
      }
      const preview = await rpc(sourceClient, 'preview', { ...sourceArgs, documentRefs });
      assert.equal(preview.previewSha256, expected.previewSha256); exact(preview.identity, expected.identity);
      assert.equal(preview.file.sha256, digest(bytes(expected)));
      await download(sourceClient, preview.file, family.id + '-complete-preview');
      const review = await rpc(sourceClient, 'reviewSave', { ...sourceArgs, documentRefs,
        reviewId: family.reviewId, expectedPreviewSha256: expected.previewSha256 });
      if (saved.reviewSha256) assert.equal(review.reviewSha256, saved.reviewSha256);
      saved.reviewSha256 = review.reviewSha256; saved.previewSha256 = preview.previewSha256;
      await checkpoint();
      await downloadLaboratoryReview(sourceClient, { reviewId: family.reviewId,
        expectedReviewSha256: review.reviewSha256, directory: join(root, 'reviews', family.id) }, options);
      await restart(family.id + '-saved-review-cold-reopen');
      const opened = await rpc(sourceClient, 'review', { reviewId: family.reviewId });
      assert.equal(opened.reviewSha256, review.reviewSha256);
      request = await rpc(sourceClient, 'request', { requestId: request.id });
      if (!saved.apply) {
        saved.apply = { requestId: request.id, applyId: family.applyId, reviewId: family.reviewId,
          expectedReviewSha256: review.reviewSha256, expectedRevision: request.revision }; await checkpoint();
      }
      const application = await rpc(sourceClient, 'reviewApply', saved.apply);
      const again = await rpc(sourceClient, 'reviewApply', saved.apply);
      exact(application.files, again.files);
      request = await rpc(sourceClient, 'request', { requestId: request.id });
      for (const [slot, file] of Object.entries(review.jobInputs)) {
        const staged = request.inputFiles.slots.find(value => value.slot === slot);
        assert.equal(staged.file.sha256, file.sha256); assert.equal(staged.upload.state, 'SEALED');
      }
      const selectedPreview = await rpc(sourceClient, 'preview', sourceArgs);
      assert.equal(selectedPreview.previewSha256, expected.previewSha256, 'All actual native selected decisions retain the saved preview.');
      saved.bindingSha256 = binding.bindingSha256; saved.sourcePages = nativeRows;
      await progress(family.id + '-all-original-source-and-decisions-received', {
        requestId: request.id, reviewSha256: review.reviewSha256, ...nativeRows });
      if (request.phase !== 'IMPORTED') {
        if (!busy(request)) await rpc(sourceClient, 'intake', { requestId: request.id,
          action: request.hasTicket ? 'import' : 'prepare', expectedRevision: request.revision });
        request = await waitOriginal('request', { requestId: request.id }, value => value.phase === 'IMPORTED' && !busy(value), 'Original intake');
      }
      assert(request.checkoutId); saved.checkoutId = request.checkoutId; await checkpoint();
      let checkout = await rpc(sourceClient, 'checkout', { checkoutId: request.checkoutId });
      assert.equal(checkout.ticket.jobId, family.reference); assert.equal(checkout.ticket.functionId, catalogue.function.id);
      assert.equal(checkout.ticket.inputSha256, request.inputSha256);
      const approvals = new Set(), notified = new Set();
      const approvalTick = async currentCheckout => {
        if (currentCheckout.task?.kind !== 'execute') return;
        const approval = await rpc(sourceClient, 'approval', { checkoutId: currentCheckout.id });
        if (approval.snapshot?.state !== 'AWAITING_OPERATOR' || approvals.has(approval.snapshot.id)) return;
        assert.equal(approval.intentId, currentCheckout.intentId); assert.equal(approval.taskId, currentCheckout.task.id);
        exact(approval.snapshot.review.complete_original_accepted_terms, selected.expectedPayment);
        if (!notified.has(approval.snapshot.id)) {
          await onProgress?.({ phase: 'original-operator-approval', operationId: selected.operationId,
            checkoutId: currentCheckout.id, approval });
          notified.add(approval.snapshot.id);
        }
        if (!approve) return;
        const decision = await approve({ approval, checkout: currentCheckout, payment: selected.expectedPayment, signal });
        if (decision === undefined) return;
        assert(['approve', 'reject'].includes(decision), 'Use the explicit original operator decision.');
        await rpc(sourceClient, 'approvalDecide', { checkoutId: currentCheckout.id,
          intent: currentCheckout.intentId, approvalId: approval.snapshot.id,
          requestSha256: approval.snapshot.review.request_sha256, taskId: currentCheckout.task.id, decision });
        approvals.add(approval.snapshot.id);
      };
      if (busy(checkout)) checkout = await waitOriginal('checkout', { checkoutId: checkout.id }, row => !busy(row), 'Existing checkout', approvalTick);
      if (checkout.attempted && checkout.phase !== 'ACCEPTED') {
        await rpc(sourceClient, 'checkoutAction', { checkoutId: checkout.id, action: 'recover', expectedRevision: checkout.revision });
        checkout = await waitOriginal('checkout', { checkoutId: checkout.id }, row => !busy(row), 'Original checkout recovery');
        assert.equal(checkout.phase, 'ACCEPTED', 'Keep this original attempted operation until its native result is recoverable.');
      }
      if (checkout.phase !== 'ACCEPTED') {
        if (checkout.phase !== 'REVIEWED') {
          await rpc(sourceClient, 'checkoutAction', { checkoutId: checkout.id, action: 'review', expectedRevision: checkout.revision });
          checkout = await waitOriginal('checkout', { checkoutId: checkout.id }, row => !busy(row), 'Original checkout review');
          assert.equal(checkout.phase, 'REVIEWED', checkout.lastError ?? 'Original review is incomplete.');
        }
        saved.checkoutReview = checkout.review; await checkpoint();
        checkout = await rpc(sourceClient, 'checkoutAction', { checkoutId: checkout.id, action: 'execute', expectedRevision: checkout.revision });
        checkout = await waitOriginal('checkout', { checkoutId: checkout.id }, row => row.phase === 'ACCEPTED' && !busy(row),
          'Original paid checkout', approvalTick);
      }
      assert.equal(checkout.native.httpStatus, 202); assert.equal(checkout.native.status, 'DELIVERED_REPORTED_SETTLED');
      assert(checkout.jobEntryId); saved.entryId = checkout.jobEntryId; await checkpoint();
      let customer = await rpc(sourceClient, 'customer', { entryId: saved.entryId });
      if (selected.manageDedicatedWorker && !state.nativeWaitClose && customer.receipt.latestStatus?.state !== 'COMPLETED') {
        if (!busy(customer)) customer = await rpc(sourceClient, 'customerAction', {
          entryId: customer.id, action: 'watch', deadlineMs: 300000, pollMs: 1000 });
        const watchedTaskId = customer.task.id, entryId = customer.id;
        let waitOutcome;
        const waiting = sourceClient.customerAction({ entryId, action: 'wait', taskId: watchedTaskId }, options)
          .then(value => waitOutcome = { returned: true, value },
            error => waitOutcome = { returned: false, code: error.code ?? error.name });
        // Observe the real wait request in this owner before closing it.
        for (;;) {
          if (waitOutcome) throw Error('The selected native wait ended before owner Stop: ' +
            (waitOutcome.returned ? waitOutcome.value.task?.state ?? 'RETURNED' : waitOutcome.code));
          const active = await rpc(sourceClient, 'status');
          if (active.activeCalls >= 2) break;
          await pause(50, undefined, { signal }); check();
        }
        await restart(family.id + '-native-customer-wait-stop');
        await waiting;
        customer = await rpc(sourceClient, 'customer', { entryId });
        assert.equal(customer.task.id, watchedTaskId);
        assert(!busy(customer), 'The same native customer task must drain before its owner reopens.');
        state.nativeWaitClose = { entryId, taskId: watchedTaskId, state: customer.task.state, at: new Date().toISOString() };
        await checkpoint();
      }
      if (selected.manageDedicatedWorker) await rpc(sourceClient, 'worker', { action: 'start' });
      if (customer.receipt.latestStatus?.state !== 'COMPLETED') {
        if (!busy(customer)) await rpc(sourceClient, 'customerAction', { entryId: customer.id, action: 'watch',
          deadlineMs: Math.max(100, Math.min(3600000, deadline - Date.now())), pollMs: 1000 });
        customer = await waitOriginal('customer', { entryId: customer.id },
          row => row.receipt.latestStatus?.state === 'COMPLETED' && !busy(row), 'Original job worker');
      }
      if (!customer.resource) {
        if (!busy(customer)) await rpc(sourceClient, 'customerAction', { entryId: customer.id, action: 'fetch' });
        customer = await waitOriginal('customer', { entryId: customer.id }, row => Boolean(row.resource) && !busy(row), 'Complete native result');
      }
      const job = await rpc(sourceClient, 'merchantJob', { jobId: family.reference });
      assert.equal(job.state, 'COMPLETED'); assert.equal(job.inputSha256, request.inputSha256);
      const result = await rpc(sourceClient, 'resultOpen', { resourceId: customer.resourceId, expectedSha256: customer.resource.sha256 });
      assert.equal(result.manifest.jobId, family.reference); assert.equal(result.manifest.sourceSha256, current.source.sourceSha256);
      assert.equal(result.manifest.documentSha256, expected.identity.currentDocumentSha256);
      assert.equal(result.manifest.reviewSha256, expected.identity.currentReviewSha256);
      if (comparison) {
        assert.equal(result.manifest.reconciliation.comparisonSha256, expected.identity.comparisonSha256);
        assert.equal(result.manifest.reconciliation.documentSha256, expected.identity.correspondenceDocumentSha256);
        assert.equal(result.manifest.reconciliation.baseline.documentSha256, expected.identity.baselineDocumentSha256);
        assert.equal(result.manifest.reconciliation.outputComparisonSha256, expected.identity.outputComparisonSha256);
      }
      const resultLabel = family.id + '-complete-native-result';
      if (!saved.interruptedTransfer && result.file.bytes > 65536) {
        const abort = new AbortController();
        try {
          await downloadLaboratoryFile(sourceClient, { file: result.file, directory: join(root, 'downloads', resultLabel) },
            { ...options, signal: signal ? AbortSignal.any([signal, abort.signal]) : abort.signal, onProgress: value => {
              if (value.bytes >= 65536 && value.bytes < value.total) abort.abort(Error('Continue this exact retained transfer after native host Stop.'));
            } });
        } catch (error) { if (!abort.signal.aborted || signal?.aborted) throw error; }
        saved.interruptedTransfer = true; await checkpoint();
        await restart(family.id + '-native-result-transfer-resume');
      }
      const full = await download(sourceClient, result.file, resultLabel);
      let verified = readLabResult(await wqxReadPrivate(full.filename, 67108864), { signal });
      exact(verified.manifest, result.manifest);
      for (const member of verified.members) {
        const declared = result.members.find(value => value.path === member.filename);
        assert(declared); assert.equal(declared.sha256, member.sha256); assert.equal(declared.bytes, member.bytes.length);
      }
      // Each member API carries its original native bytes; no reconstruction from a summary.
      for (const member of result.members) {
        const response = await rpc(sourceClient, 'result', { resultId: result.resultId, member: member.path });
        assert.equal(response.file.sha256, member.sha256); assert.equal(response.file.bytes, member.bytes);
        await download(sourceClient, response.file, family.id + '-member-' + digest(member.path).slice(0,24));
      }
      const transported = await uploadLaboratoryInput(receiverClient, { path: full.filename,
        inputId: 'lab-result-' + digest(selected.operationId + ':' + family.id).slice(0,40),
        name: result.file.name, contentType: result.file.contentType, expectedSha256: result.resultId }, options);
      const received = await rpc(receiverClient, 'resultOpen', { inputRef: transported.inputRef, expectedSha256: result.resultId });
      exact(received.manifest, result.manifest); exact(received.members, result.members);
      saved.resultId = result.resultId; saved.result = { file: result.file, bytes: full.bytes, sha256: full.sha256,
        members: result.members.length, currentSourceSha256: current.source.sourceSha256,
        baselineSourceSha256: baseline?.source.sourceSha256 ?? null, entryId: customer.id, checkoutId: checkout.id };
      verified = null; current = baseline = expected = null; collect();
      await checkpoint();
      await restart(family.id + '-independent-result-cold-reopen');
      for (const client of [sourceClient, receiverClient]) {
        const reopened = await rpc(client, 'result', { resultId: result.resultId, limit: 200 });
        exact(reopened.manifest, result.manifest); assert.equal(reopened.members.total, result.members.length);
      }
      const returned = await rpc(receiverClient, 'resultOpen', { inputRef: transported.inputRef, expectedSha256: result.resultId });
      assert.equal(returned.reused, true);
      const after = await rpc(sourceClient, 'checkout', { checkoutId: checkout.id });
      assert.equal(after.jobEntryId, checkout.jobEntryId); assert.equal(after.intentId, checkout.intentId);
      assert.equal(after.phase, 'ACCEPTED');
      saved.completeAt = new Date().toISOString();
      await progress(family.id + '-native-job-full-result-and-independent-reopen', saved.result);
    }
    if (selected.manageDedicatedWorker) await rpc(sourceClient, 'worker', { action: 'stop' });
    const final = { schema: LABORATORY_OPERATOR_RECEIVING_SCHEMA, status: 'COMPLETE',
      operationId: selected.operationId, startedAt: state.startedAt, completedAt: new Date().toISOString(),
      merchantConfigurationSha256: identity.merchantConfigurationSha256, listener: state.listener,
      catalogue: { catalogSha256: state.catalogue.catalogSha256, functionSha256: state.catalogue.function.functionSha256 },
      families: state.families, transfers, phases, restarts, requests: requestCount };
    await atomicJson(join(root, 'result.json'), final);
    state.completedAt = final.completedAt; await checkpoint(); complete = true;
    return final;
  } finally {
    const failures = [];
    try { await oracleHost?.close(); } catch (error) { failures.push(error); }
    try { await closeHost(); } catch (error) { failures.push(error); }
    try { await lease.close(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'The original laboratory receiving owners have not completed close.');
    if (!complete) collect();
  }
}
