#!/usr/bin/env node
// MIT. Receive one retained MPP application through its original operator APIs.
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, rename, unlink, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

export const RECEPTION_SCHEMA = 'stellar-forge.mpp-managed-reception.v1';
const ROOT = 'stellar/scf-starforge-20261009';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const encoded = value => JSON.stringify(canonical(value)) + '\n';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function need(value, code, message = code) {
  if (!value) throw Object.assign(new Error(message), { code });
}
function fields(value, allowed, code) {
  need(plain(value) && Object.keys(value).every(key => allowed.includes(key)), code);
}
async function exactDirectory(value, create = false) {
  need(typeof value === 'string' && isAbsolute(value) && resolve(value) === value, 'MPP_RECEPTION_DIRECTORY_INVALID');
  if (create) await mkdir(value, { mode: 0o700, recursive: true });
  const stat = await lstat(value);
  need(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 &&
    stat.uid === process.getuid?.() && await realpath(value) === value, 'MPP_RECEPTION_DIRECTORY_PRIVATE');
  return { directory: value, dev: String(stat.dev), ino: String(stat.ino) };
}
async function privateJSON(path, optional = false) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    need(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid?.() &&
      (stat.mode & 0o077) === 0 && stat.size <= 4 * 1024 * 1024, 'MPP_RECEPTION_RECORD_PRIVATE');
    return JSON.parse(await handle.readFile('utf8'));
  } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  finally { await handle?.close(); }
}
async function writePrivate(path, bytes) {
  const temporary = path + '.partial-' + randomUUID();
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  finally { await handle.close(); }
  try {
    await rename(temporary, path);
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
function publicRun(run) {
  return { id: run.id, phase: run.phase, active: run.active === true, result: run.result ?? null };
}
function address(privateUrl) {
  const url = new URL(privateUrl);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/' &&
    !url.username && !url.password && !url.search && /^#[a-f0-9]{64}$/.test(url.hash), 'MPP_RECEPTION_PRIVATE_URL_INVALID');
  return { origin: url.origin, token: url.hash.slice(1) };
}
async function http(endpoint, path, value, { bytes = false, limit = 8 * 1024 * 1024 } = {}) {
  need(path.startsWith('/') && !path.startsWith('//'), 'MPP_RECEPTION_PATH_INVALID');
  const headers = { authorization: 'Bearer ' + endpoint.token };
  if (value !== undefined) Object.assign(headers, { origin: endpoint.origin, 'content-type': 'application/json' });
  const response = await fetch(endpoint.origin + path, { method: value === undefined ? 'GET' : 'POST',
    headers, ...(value !== undefined ? { body: JSON.stringify(value) } : {}),
    redirect: 'error', signal: AbortSignal.timeout(30000) });
  const pieces = []; let size = 0;
  for await (const piece of response.body) {
    size += piece.length; need(size <= limit, 'MPP_RECEPTION_RESPONSE_TOO_LARGE'); pieces.push(piece);
  }
  const body = Buffer.concat(pieces);
  if (!response.ok) {
    let detail; try { detail = JSON.parse(body.toString()); } catch { detail = { message: body.toString().slice(0, 1500) }; }
    throw Object.assign(new Error(detail.message ?? detail.error ?? ('HTTP ' + response.status)),
      { code: detail.error ?? 'MPP_RECEPTION_HTTP_ERROR', status: response.status, path });
  }
  return bytes ? { body, type: response.headers.get('content-type') } : JSON.parse(body.toString());
}
async function waitFor(read, accept, timeoutMs, title) {
  const deadline = Date.now() + timeoutMs; let latest;
  while (Date.now() < deadline) {
    latest = await read();
    if (await accept(latest)) return latest;
    await new Promise(done => setTimeout(done, 250));
  }
  throw Object.assign(new Error(title + ' did not finish within ' + timeoutMs + ' ms'),
    { code: 'MPP_RECEPTION_OPERATION_PENDING', lastState: latest });
}
function normalize(input) {
  fields(input, ['schema','applicationsDirectory','runtimeDirectory','expectedRuntime','mppDirectory',
    'mppCreatedAt','receptionDirectory','applicationId','label','settings','retainedPurchaseIds',
    'offer','configureCurrentCustomer','exerciseMerchant','role','timeoutMs'], 'MPP_RECEPTION_FIELDS_INVALID');
  need(input.schema === RECEPTION_SCHEMA, 'MPP_RECEPTION_SCHEMA_INVALID');
  fields(input.expectedRuntime, ['sourceCommit','sourceManifestSha256','installationId','profileId'],
    'MPP_RECEPTION_EXPECTED_RUNTIME_INVALID');
  need(/^[a-f0-9]{40}$/.test(input.expectedRuntime.sourceCommit) &&
    /^[a-f0-9]{64}$/.test(input.expectedRuntime.sourceManifestSha256) &&
    /^[a-f0-9]{64}$/.test(input.expectedRuntime.installationId) &&
    /^[a-f0-9]{64}$/.test(input.expectedRuntime.profileId), 'MPP_RECEPTION_EXPECTED_RUNTIME_REQUIRED');
  fields(input.settings, ['port','environmentFile','terminalPython','tokenEnv'], 'MPP_RECEPTION_SETTINGS_INVALID');
  need(Number.isInteger(input.settings.port) && input.settings.port >= 0 && input.settings.port <= 65535 &&
    typeof input.settings.terminalPython === 'string', 'MPP_RECEPTION_TERMINAL_REQUIRED');
  need(typeof input.label === 'string' && input.label.trim() && input.label.length <= 120, 'MPP_RECEPTION_LABEL_INVALID');
  need(typeof input.mppCreatedAt === 'string' && !Number.isNaN(Date.parse(input.mppCreatedAt)), 'MPP_RECEPTION_WORKSPACE_IDENTITY_REQUIRED');
  need(input.applicationId === undefined || /^[a-f0-9]{24}$/.test(input.applicationId), 'MPP_RECEPTION_APPLICATION_ID_INVALID');
  need(Array.isArray(input.retainedPurchaseIds) && input.retainedPurchaseIds.length <= 10000 &&
    input.retainedPurchaseIds.every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)) &&
    new Set(input.retainedPurchaseIds).size === input.retainedPurchaseIds.length, 'MPP_RECEPTION_PURCHASE_IDS_INVALID');
  if (input.offer) {
    fields(input.offer, ['id','inputs'], 'MPP_RECEPTION_OFFER_INVALID');
    need(typeof input.offer.id === 'string' && input.offer.id, 'MPP_RECEPTION_OFFER_REQUIRED');
    fields(input.offer.inputs ?? {}, ['query','json'], 'MPP_RECEPTION_OFFER_INPUTS_INVALID');
  }
  need(input.configureCurrentCustomer === undefined || typeof input.configureCurrentCustomer === 'boolean',
    'MPP_RECEPTION_CUSTOMER_SELECTION_INVALID');
  need(input.exerciseMerchant === undefined || typeof input.exerciseMerchant === 'boolean', 'MPP_RECEPTION_MERCHANT_SELECTION_INVALID');
  need(input.role === undefined || ['customer','merchant','both'].includes(input.role), 'MPP_RECEPTION_ROLE_INVALID');
  const timeoutMs = input.timeoutMs ?? 180000;
  need(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 600000, 'MPP_RECEPTION_TIMEOUT_INVALID');
  return { ...input, role: input.role ?? 'both', settings: { ...input.settings }, configureCurrentCustomer: input.configureCurrentCustomer ?? true,
    exerciseMerchant: input.exerciseMerchant ?? true, timeoutMs };
}

/** Request IDs are retained before dispatch; restart resumes the original managed operations. */
export async function receiveMppApplication(input, { progress = () => {} } = {}) {
  const config = normalize(input);
  const [applications, runtimeDirectory, mpp, reception] = await Promise.all([
    exactDirectory(config.applicationsDirectory), exactDirectory(config.runtimeDirectory),
    exactDirectory(config.mppDirectory), exactDirectory(config.receptionDirectory, true),
  ]);
  need(new Set([applications.directory, runtimeDirectory.directory, mpp.directory, reception.directory]).size === 4,
    'MPP_RECEPTION_DIRECTORIES_MUST_DIFFER');
  const metadata = await privateJSON(join(mpp.directory, 'workspace.json'));
  need(metadata.schema === 'stellar-forge.mpp-workspace.v1' && metadata.createdAt === config.mppCreatedAt,
    'MPP_RECEPTION_WORKSPACE_CHANGED');
  const sourceRoot = await realpath(join(runtimeDirectory.directory, 'package/source'));
  need(sourceRoot === join(runtimeDirectory.directory, 'package/source'), 'MPP_RECEPTION_RUNTIME_SOURCE_CHANGED');
  const module = relative => import(pathToFileURL(join(sourceRoot, relative)).href);
  const [{ inspectMerchantRuntime }, { startRuntimeWorkspace }, { operationLease }, customerApi] = await Promise.all([
    module(ROOT + '/sf46-release/runtime-package.mjs'),
    module(ROOT + '/distribution/runtime-workspace/server.mjs'),
    module(ROOT + '/distribution/runtime-workspace/storage.mjs'),
    module(ROOT + '/mpp-charge/customer/index.mjs'),
  ]);
  const installed = await inspectMerchantRuntime(runtimeDirectory.directory, {
    expectedManifest: config.expectedRuntime.sourceManifestSha256, load: false });
  for (const [key, value] of Object.entries(config.expectedRuntime))
    need(installed[key] === value, 'MPP_RECEPTION_RUNTIME_CHANGED', 'The selected original runtime changed: ' + key);
  need(installed.sourceRoot === sourceRoot && installed.state === 'READY', 'MPP_RECEPTION_RUNTIME_NOT_READY');
  const lease = await operationLease(join(reception.directory, 'reception.lock'));
  const journalPath = join(reception.directory, 'reception.json');
  let host, endpoint, journal;
  const save = async () => { journal.updatedAt = new Date().toISOString(); await writePrivate(journalPath, encoded(journal)); };
  const checkpoint = async (phase, facts = {}) => {
    journal.phase = phase; await save(); progress({ phase, ...facts });
  };
  const connectHost = async () => {
    host = await startRuntimeWorkspace({ directory: applications.directory, port: 0 });
    endpoint = address(host.url); return http(endpoint, '/api/state');
  };
  const application = async () => {
    const state = await http(endpoint, '/api/applications/state');
    need(state.schema === 'stellar-forge.runtime-applications.v1', 'MPP_RECEPTION_APPLICATION_STATE_INVALID');
    return state.applications.find(item => item.id === journal.applicationId) ?? null;
  };
  const originalRun = async id => {
    const app = await application(); need(app, 'MPP_RECEPTION_APPLICATION_MISSING');
    const run = app.runs.find(row => row.id === id);
    if (run) return { app, run };
    const output = await http(endpoint, '/api/applications/output?applicationId=' +
      encodeURIComponent(app.id) + '&operationId=' + encodeURIComponent(id));
    return { app, run: { id, ...output } };
  };
  const saveExport = async (name, bytes, type) => {
    need(/^[a-z0-9][a-z0-9.-]{0,100}$/.test(name), 'MPP_RECEPTION_EXPORT_NAME_INVALID');
    const facts = { file: name, bytes: bytes.length, sha256: hash(bytes), type };
    const previous = journal.exports[name];
    if (previous) {
      need(previous.sha256 === facts.sha256 && previous.bytes === facts.bytes, 'MPP_RECEPTION_EXPORT_CHANGED');
      const existing = await readFile(join(reception.directory, name));
      need(hash(existing) === facts.sha256, 'MPP_RECEPTION_SAVED_EXPORT_CHANGED');
    } else {
      await writePrivate(join(reception.directory, name), bytes);
      journal.exports[name] = facts; await save();
    }
    return facts;
  };
  const inspectConsole = async privateUrl => {
    const consoleEndpoint = address(privateUrl);
    const identity = await http(consoleEndpoint, '/api/identity');
    need(identity.schema === 'stellar-forge.mpp-console-identity.v1' && identity.origin === consoleEndpoint.origin &&
      identity.workspace === mpp.directory && identity.createdAt === config.mppCreatedAt &&
      Number.isInteger(identity.pid) && Number.isInteger(identity.ppid), 'MPP_RECEPTION_CONSOLE_IDENTITY_CHANGED');
    return { endpoint: consoleEndpoint, identity };
  };
  const purchases = async consoleEndpoint => {
    const result = []; let offset = 0; let identity = null;
    while (true) {
      const page = await http(consoleEndpoint, '/api/customer-workbench?offset=' + offset + '&limit=100');
      need(page.schema === 'stellar-forge.mpp-customer-workbench.v1' && page.workspace === mpp.directory &&
        Array.isArray(page.purchases?.items), 'MPP_RECEPTION_CUSTOMER_STATE_INVALID');
      const selected = { profileId: page.profileId, revision: page.revision };
      if (identity) need(encoded(identity) === encoded(selected), 'MPP_RECEPTION_CUSTOMER_CHANGED_DURING_READ');
      else identity = selected;
      result.push(...page.purchases.items);
      if (page.purchases.nextOffset === null || page.purchases.nextOffset === undefined) {
        need(result.length === page.purchases.total, 'MPP_RECEPTION_PURCHASE_PAGINATION_CHANGED');
        return { state: page, items: result };
      }
      need(Number.isInteger(page.purchases.nextOffset) && page.purchases.nextOffset > offset,
        'MPP_RECEPTION_PURCHASE_CURSOR_INVALID');
      offset = page.purchases.nextOffset;
    }
  };
  const customerSnapshot = async consoleEndpoint => {
    const history = await purchases(consoleEndpoint); const selected = [];
    for (const id of config.retainedPurchaseIds) {
      need(history.items.some(row => row.id === id), 'MPP_RECEPTION_RETAINED_PURCHASE_MISSING', id);
      const row = await http(consoleEndpoint, '/api/customer-workbench/purchases/' + encodeURIComponent(id));
      selected.push({ id, sha256: hash(encoded(row)), phase: row.phase, challengeId: row.challenge?.id ?? null });
    }
    return { profileId: history.state.profileId, total: history.items.length, selected };
  };
  try {
    journal = await privateJSON(journalPath, true);
    const binding = { configuration: config, directories: { applications, runtime: runtimeDirectory, mpp, reception },
      runtime: Object.fromEntries(Object.keys(config.expectedRuntime).map(key => [key, installed[key]])) };
    const bindingSha256 = hash(encoded(binding));
    if (journal) need(journal.schema === RECEPTION_SCHEMA && journal.bindingSha256 === bindingSha256,
      'MPP_RECEPTION_INPUTS_CHANGED', 'Reopen this receiver with the same original inputs and directories');
    else {
      journal = { schema: RECEPTION_SCHEMA, id: randomUUID(), createdAt: new Date().toISOString(), bindingSha256, binding,
        phase: 'OPENED', saveRequestId: randomUUID(), applicationId: config.applicationId ?? null, runs: [], exports: {} };
      await save();
    }
    if (journal.phase === 'COMPLETE') return journal.result;
    const state = await connectHost();
    if (journal.workspaceId) need(journal.workspaceId === state.workspaceId, 'MPP_RECEPTION_OPERATOR_WORKSPACE_CHANGED');
    else { journal.workspaceId = state.workspaceId; await save(); }
    if (!journal.runtimeId) {
      const attached = await http(endpoint, '/api/attach', { directory: installed.directory, label: config.label + ' runtime' });
      journal.runtimeId = attached.runtimeId; await checkpoint('RUNTIME_ATTACHED');
    }
    if (!journal.saved) {
      const all = (await http(endpoint, '/api/applications/state')).applications;
      const matches = all.filter(app => app.kind === 'mpp' && app.settings?.workspaceDirectory === mpp.directory);
      if (journal.applicationId) need(matches.some(app => app.id === journal.applicationId), 'MPP_RECEPTION_APPLICATION_CHANGED');
      else {
        need(matches.length <= 1, 'MPP_RECEPTION_SELECT_ORIGINAL_APPLICATION');
        if (matches.length) { journal.applicationId = matches[0].id; await save(); }
      }
      const previous = all.find(app => app.id === journal.applicationId);
      need(!previous?.current?.active, 'MPP_RECEPTION_ORIGINAL_APPLICATION_ACTIVE',
        'Reopen the original active application operation before receiving its configuration');
      const settings = { ...config.settings, workspaceDirectory: mpp.directory };
      if (!journal.review) {
        journal.review = await http(endpoint, '/api/applications/review', { runtimeId: journal.runtimeId,
          kind: 'mpp', settings, label: config.label, ...(previous ? { applicationId: previous.id, expectedRevision: previous.revision } : {}) });
        need(journal.review.command.command === 'mpp' && journal.review.command.args[0] === 'serve' &&
          journal.review.command.args[1] === mpp.directory && !journal.review.command.args.includes('--port'),
          'MPP_RECEPTION_ORIGINAL_COMMAND_CHANGED');
        await checkpoint('APPLICATION_REVIEWED');
      }
      const result = await http(endpoint, '/api/applications/save', { requestId: journal.saveRequestId,
        reviewId: journal.review.id, ...(journal.review.applicationId ? { applicationId: journal.review.applicationId } : {}) });
      journal.applicationId = result.applicationId; journal.saved = result; await checkpoint('APPLICATION_SAVED');
      if (result.connectionError) throw Object.assign(new Error(result.connectionError.message), result.connectionError);
    }
    await http(endpoint, '/api/applications/connect', { applicationId: journal.applicationId });
    await waitFor(application, app => {
      if (app?.release && app.runtime?.sourceCommit === installed.sourceCommit) return true;
      if (app?.adoption?.result?.error) throw Object.assign(new Error('Original runtime adoption failed'),
        { code: 'MPP_RECEPTION_ADOPTION_FAILED', original: app.adoption.result });
      return false;
    }, config.timeoutMs, 'Original managed runtime adoption');
    await checkpoint('APPLICATION_CONNECTED', { applicationId: journal.applicationId });
    for (let index = 0; index < 2; index++) {
      let run = journal.runs[index];
      if (run?.stopped) continue;
      if (!run) {
        const review = await http(endpoint, '/api/applications/start-review', { applicationId: journal.applicationId });
        run = { id: randomUUID(), reviewId: review.id, review, started: false, stopped: false };
        journal.runs.push(run); await checkpoint('START_REVIEWED', { run: index + 1, operationId: run.id });
      }
      if (!run.started) {
        const response = await http(endpoint, '/api/applications/start', { applicationId: journal.applicationId,
          requestId: run.id, reviewId: run.reviewId });
        run.start = response; run.started = true; await checkpoint('START_DISPATCHED', { operationId: run.id });
      }
      if (run.stopRequested) {
        await http(endpoint, '/api/applications/stop', { applicationId: journal.applicationId, operationId: run.id });
        const stopped = await waitFor(() => originalRun(run.id), value => !value.run.active &&
          ['SUCCEEDED','FAILED','CANCELLED'].includes(value.run.phase), config.timeoutMs, 'Original MPP shutdown');
        need(stopped.run.phase !== 'FAILED', 'MPP_RECEPTION_STOP_FAILED');
        run.stopped = true; run.final = publicRun(stopped.run); await save(); continue;
      }
      const observed = await waitFor(() => originalRun(run.id), value => {
        if (value.run.active && value.run.privateUrl) return true;
        if (!value.run.active && ['FAILED','SUCCEEDED','CANCELLED'].includes(value.run.phase))
          throw Object.assign(new Error('Original MPP process exited before receiving'),
            { code: 'MPP_RECEPTION_START_FAILED', original: publicRun(value.run) });
        return false;
      }, config.timeoutMs, 'Original MPP private console');
      let console = await inspectConsole(observed.run.privateUrl);
      if (run.identity) need(run.identity.pid === console.identity.pid && run.identity.ppid === console.identity.ppid,
        'MPP_RECEPTION_ORIGINAL_PROCESS_CHANGED');
      else { run.identity = console.identity; await save(); }
      await host.close(); host = null;
      const reopenedState = await connectHost();
      need(reopenedState.workspaceId === journal.workspaceId, 'MPP_RECEPTION_OPERATOR_WORKSPACE_CHANGED');
      const reopened = await originalRun(run.id);
      need(reopened.run.active && reopened.run.privateUrl, 'MPP_RECEPTION_OPERATOR_REOPEN_LOST_OPERATION');
      const afterReopen = await inspectConsole(reopened.run.privateUrl);
      need(afterReopen.identity.pid === console.identity.pid && afterReopen.identity.ppid === console.identity.ppid,
        'MPP_RECEPTION_OPERATOR_REOPEN_RESTARTED_PROCESS');
      console = afterReopen; run.operatorReopened = true; await checkpoint('OPERATOR_REOPENED', { operationId: run.id });
      if (index === 0 && !run.useFinished) {
        if (config.role !== 'merchant') {
          const initial = await customerSnapshot(console.endpoint);
          if (journal.customerBefore) need(encoded(journal.customerBefore) === encoded(initial), 'MPP_RECEPTION_RETAINED_PURCHASE_CHANGED');
          else { journal.customerBefore = initial; await save(); }
          const customer = await http(console.endpoint, '/api/customer-workbench?offset=0&limit=100');
          need(customer.profile && customer.profileId, 'MPP_RECEPTION_CUSTOMER_PROFILE_REQUIRED');
          if (config.configureCurrentCustomer && !journal.configuration) {
            journal.configuration = { profile: customer.profile, profileId: customer.profileId, revision: customer.revision };
            await save();
          }
          if (config.configureCurrentCustomer && !journal.configuration.finished) {
            const requested = journal.configuration;
            const current = await http(console.endpoint, '/api/customer-workbench?offset=0&limit=100');
            need(current.profileId === requested.profileId && encoded(current.profile) === encoded(requested.profile),
              'MPP_RECEPTION_CUSTOMER_PROFILE_CHANGED');
            if (current.revision === requested.revision) {
              const review = await http(console.endpoint, '/api/customer-workbench/review', {
                profile: requested.profile, revision: requested.revision });
              need(review.profileId === requested.profileId, 'MPP_RECEPTION_CUSTOMER_REVIEW_CHANGED');
              journal.configuration.review = review; await save();
              journal.configuration.result = await http(console.endpoint, '/api/customer-workbench/configure', {
                profile: review.profile, revision: review.revision });
            } else {
              need(current.revision === requested.revision + 1, 'MPP_RECEPTION_CUSTOMER_REVISION_CHANGED');
              journal.configuration.result = { recovered: true, revision: current.revision, profileId: current.profileId };
            }
            journal.configuration.finished = true; await checkpoint('CUSTOMER_CONFIGURED');
          }
          if (config.offer) {
            const current = await http(console.endpoint, '/api/customer-workbench?offset=0&limit=100');
            const preview = await http(console.endpoint, '/api/customer-workbench/preview', {
              profileId: current.profileId, offerId: config.offer.id, inputs: config.offer.inputs ?? {} });
            await saveExport('customer-request-preview.json', Buffer.from(encoded(preview)), 'application/json');
          }
          const selected = await http(console.endpoint, '/api/customer-workbench?offset=0&limit=100');
          const selectedContract = selected.profile.contract;
          const selectedFiles = {
            contract: selectedContract,
            openapi: customerApi.contractOpenAPI(selectedContract),
            package: await customerApi.createCustomerBundle({ contract: selectedContract }),
          };
          for (const [kind, document] of Object.entries(selectedFiles)) {
            await saveExport('customer-' + kind + '.json', Buffer.from(JSON.stringify(document, null, 2) + '\n'), 'application/json');
            if (kind === 'package') {
              const received = await customerApi.receiveCustomerBundle({ bundle: document,
                directory: join(reception.directory, 'customer-files'), resume: true });
              need(received.state === 'COMPLETE', 'MPP_RECEPTION_CUSTOMER_FILES_INCOMPLETE');
              journal.customerFiles = received; await save();
            }
          }
        }
        const status = await http(console.endpoint, '/api/state');
        if (config.role !== 'customer') {
          need(status.metadata.createdAt === config.mppCreatedAt, 'MPP_RECEPTION_ORIGINAL_METADATA_CHANGED');
          const merchantProfileId = status.metadata.merchant;
          need(merchantProfileId, 'MPP_RECEPTION_MERCHANT_PROFILE_REQUIRED');
          let receivedContract;
          for (const kind of ['contract','openapi','package']) {
            const file = await http(console.endpoint, '/api/customer/' + kind + '?profileId=' + encodeURIComponent(merchantProfileId),
              undefined, { bytes: true });
            const document = JSON.parse(file.body.toString());
            if (kind === 'contract') receivedContract = customerApi.parseContract(document);
            await saveExport('merchant-customer-' + kind + '.json', file.body, file.type);
            if (kind === 'package') {
              const received = await customerApi.receiveCustomerBundle({ bundle: document,
                directory: join(reception.directory, 'merchant-customer-files'), resume: true });
              need(received.state === 'COMPLETE', 'MPP_RECEPTION_MERCHANT_CUSTOMER_FILES_INCOMPLETE');
              journal.merchantCustomerFiles = received; await save();
            }
          }
          if (journal.merchantContractSha256) need(journal.merchantContractSha256 === receivedContract.sha256,
            'MPP_RECEPTION_MERCHANT_CONTRACT_CHANGED');
          else { journal.merchantContractSha256 = receivedContract.sha256; journal.merchantProfileId = merchantProfileId; await save(); }
          if (config.exerciseMerchant) {
            if (!run.merchantStartRequested) {
              need(status.merchant === null, 'MPP_RECEPTION_EXISTING_MERCHANT_ACTIVE');
              run.merchantStartRequested = true; await save();
            }
            let current = await http(console.endpoint, '/api/state');
            if (current.merchant === null) {
              run.merchant = await http(console.endpoint, '/api/merchant/start', { port: 0 }); await save();
              current = await http(console.endpoint, '/api/state');
            }
            need(current.merchant !== null && current.merchant.profileId === merchantProfileId &&
              Number.isInteger(current.merchant.port), 'MPP_RECEPTION_MERCHANT_IDENTITY_CHANGED');
            const merchantOrigin = 'http://127.0.0.1:' + current.merchant.port;
            const health = await fetch(merchantOrigin + '/_mpp/health', { redirect: 'error', signal: AbortSignal.timeout(10000) });
            const healthBytes = Buffer.from(await health.arrayBuffer());
            need(health.ok, 'MPP_RECEPTION_MERCHANT_HEALTH_FAILED');
            run.merchantHealth = { status: health.status, sha256: hash(healthBytes), bytes: healthBytes.length };
            if (config.offer) {
              const originalRequest = customerApi.buildCustomerRequest(receivedContract, config.offer.id, config.offer.inputs ?? {});
              const originalUrl = new URL(originalRequest.url);
              const requestBody = Object.hasOwn(originalRequest, 'json') ? JSON.stringify(originalRequest.json) : undefined;
              const response = await fetch(merchantOrigin + originalUrl.pathname + originalUrl.search, {
                method: originalRequest.method, headers: requestBody === undefined ? {} : { 'content-type': 'application/json' },
                ...(requestBody !== undefined ? { body: requestBody } : {}), redirect: 'error', signal: AbortSignal.timeout(30000) });
              const body = Buffer.from(await response.arrayBuffer());
              need(response.status === 402, 'MPP_RECEPTION_NATIVE_CHALLENGE_EXPECTED', 'Original native merchant returned HTTP ' + response.status);
              const challenge = response.headers.get('www-authenticate');
              need(challenge, 'MPP_RECEPTION_NATIVE_CHALLENGE_HEADER_MISSING');
              run.nativeChallenge = { status: response.status, bytes: body.length, bodySha256: hash(body),
                challengeSha256: hash(challenge), method: originalRequest.method,
                requestPath: originalUrl.pathname + originalUrl.search };
            }
            await http(console.endpoint, '/api/merchant/stop', {});
            run.merchantStopped = true; await save();
          }
        }
        if (config.role !== 'merchant') {
          journal.customerAfterUse = await customerSnapshot(console.endpoint);
          need(encoded(journal.customerAfterUse) === encoded(journal.customerBefore), 'MPP_RECEPTION_PURCHASES_CHANGED_AFTER_USE');
        }
        run.useFinished = true; await checkpoint('CUSTOMER_MERCHANT_RECEIVED');
      }
      if (index === 1) {
        if (config.role !== 'merchant') {
          const after = await customerSnapshot(console.endpoint);
          need(encoded(after) === encoded(journal.customerBefore), 'MPP_RECEPTION_PURCHASES_CHANGED_AFTER_RESTART');
          journal.customerAfterRestart = after;
        }
        if (config.role !== 'customer') {
          const status = await http(console.endpoint, '/api/state');
          need(status.metadata.merchant === journal.merchantProfileId && status.merchant === null,
            'MPP_RECEPTION_MERCHANT_CHANGED_AFTER_RESTART');
          const contract = await http(console.endpoint, '/api/customer/contract?profileId=' + encodeURIComponent(journal.merchantProfileId));
          need(customerApi.parseContract(contract).sha256 === journal.merchantContractSha256,
            'MPP_RECEPTION_MERCHANT_CONTRACT_CHANGED_AFTER_RESTART');
        }
        run.restartVerified = true; await save();
      }
      run.stopRequested = true; await save();
      await http(endpoint, '/api/applications/stop', { applicationId: journal.applicationId, operationId: run.id });
      const stopped = await waitFor(() => originalRun(run.id), value => !value.run.active &&
        ['SUCCEEDED','FAILED','CANCELLED'].includes(value.run.phase), config.timeoutMs, 'Original MPP shutdown');
      need(stopped.run.phase !== 'FAILED' && !stopped.run.privateUrl, 'MPP_RECEPTION_STOP_FAILED');
      run.stopped = true; run.final = publicRun(stopped.run); await checkpoint('APPLICATION_STOPPED', { operationId: run.id });
    }
    const final = await application();
    const runtimeAfter = await inspectMerchantRuntime(installed.directory, {
      expectedManifest: installed.sourceManifestSha256, load: false });
    for (const key of Object.keys(config.expectedRuntime)) need(runtimeAfter[key] === installed[key], 'MPP_RECEPTION_RUNTIME_CHANGED_AFTER_USE');
    journal.result = { schema: RECEPTION_SCHEMA, state: 'RECEIVED', applicationId: journal.applicationId,
      workspaceId: journal.workspaceId, runtime: config.expectedRuntime, mpp: { directory: mpp.directory, createdAt: config.mppCreatedAt },
      applicationRevision: final.revision, role: config.role, retainedPurchases: journal.customerAfterRestart ?? null,
      merchantContractSha256: journal.merchantContractSha256 ?? null,
      runs: journal.runs.map(({ id, identity, operatorReopened, merchantHealth, nativeChallenge, restartVerified, final }) =>
        ({ id, identity, operatorReopened, ...(merchantHealth ? { merchantHealth } : {}),
          ...(nativeChallenge ? { nativeChallenge } : {}), ...(restartVerified ? { restartVerified } : {}), final })),
      exports: Object.values(journal.exports), receivedFiles: {
        customer: journal.customerFiles ?? null, merchant: journal.merchantCustomerFiles ?? null }, completedAt: new Date().toISOString() };
    await writePrivate(join(reception.directory, 'result.json'), encoded(journal.result));
    await checkpoint('COMPLETE', { applicationId: journal.applicationId });
    return journal.result;
  } catch (error) {
    if (journal) {
      journal.lastError = { at: new Date().toISOString(), code: error.code ?? 'MPP_RECEPTION_FAILED',
        message: String(error.message).slice(0, 2000) };
      await save().catch(() => {});
    }
    throw error;
  } finally {
    await host?.close().catch(() => {});
    await lease.close();
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    need(process.argv.length === 3, 'MPP_RECEPTION_USAGE', 'Usage: node mpp-managed-reception.mjs /private/reception-input.json');
    const input = await privateJSON(resolve(process.argv[2]));
    const result = await receiveMppApplication(input, { progress: value => process.stderr.write(JSON.stringify(value) + '\n') });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'MPP_RECEPTION_FAILED',
      message: String(error.message).slice(0, 2000) }) + '\n'); process.exitCode = 1;
  }
}
