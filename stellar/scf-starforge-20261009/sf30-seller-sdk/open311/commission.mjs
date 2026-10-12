#!/usr/bin/env node
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startOpen311Server } from './server.mjs';
import { createClient } from './client.mjs';
import { canonical, sha256 } from './workspace.mjs';
import { MerchantOpen311Workspaces } from './mcp.mjs';
import { Open311MerchantClient } from './mcp-client.mjs';

const usage = 'node open311/commission.mjs --connection /abs/connection.json --start 2026-10-08T08:00:00Z --end 2026-10-08T12:00:00Z --output /abs/new-journey [--retained /abs/originals.json]';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const json = value => JSON.stringify(value, null, 2) + '\n';
const equal = (a, b, message) => assert(canonical(a) === canonical(b), message);
const queryString = value => new URLSearchParams(value).toString();
function argumentsForRun() {
  const args = process.argv.slice(2), result = {};
  if (args.includes('--help')) { console.log(usage); return null; }
  while (args.length) {
    const key = args.shift(), value = args.shift();
    assert(['--connection', '--start', '--end', '--output', '--retained'].includes(key) && value && !value.startsWith('--'), usage);
    assert(!Object.hasOwn(result, key.slice(2)), 'Duplicate option: ' + key);
    result[key.slice(2)] = value;
  }
  for (const key of ['connection', 'start', 'end', 'output']) assert(result[key], 'Missing --' + key + '\n' + usage);
  for (const key of ['connection', 'output', ...(result.retained ? ['retained'] : [])]) assert(isAbsolute(result[key]), '--' + key + ' must be an absolute path.');
  for (const key of ['start', 'end']) {
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(result[key]), '--' + key + ' must be a fixed UTC timestamp.');
    assert(Number.isFinite(Date.parse(result[key])) && new Date(result[key]).toISOString() === result[key].replace(/(?<!\.\d{3})Z$/, '.000Z'), 'Invalid UTC date: ' + result[key]);
  }
  assert(Date.parse(result.start) < Date.parse(result.end), '--end must follow --start.');
  return result;
}

async function retainedFactory(path, config) {
  if (!path) return undefined;
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  assert(manifest.schema === 'commons.open311.retained-source.v1' && Array.isArray(manifest.captures) && manifest.captures.length, 'Use the documented retained-source manifest.');
  const sources = manifest.captures.map(entry => {
    const { raw, receipt } = entry;
    assert(raw?.encoding === 'base64' && typeof raw.body === 'string' && raw.complete !== false, 'A retained response needs its complete original base64 body.');
    const bytes = Buffer.from(raw.body, 'base64');
    assert(bytes.toString('base64') === raw.body && bytes.length === raw.bytes && sha256(bytes) === raw.sha256, 'A retained original response failed its byte count or SHA-256 check.');
    assert(receipt && (receipt.method == null || receipt.method === 'GET') && typeof receipt.url === 'string' && (receipt.status == null || (receipt.status >= 200 && receipt.status < 300)) && Number.isFinite(Date.parse(receipt.observedAt)), 'A retained response needs its original URL, observation time, and successful response or import provenance.');
    assert(receipt.status != null || receipt.provenance, 'An unknown origin HTTP status requires the actual source-import provenance.');
    const url = new URL(receipt.url), endpoint = new URL(config.baseUrl);
    assert(url.origin === endpoint.origin && url.pathname.startsWith(endpoint.pathname.replace(/\/+$/, '') + '/'), 'Retained response belongs to another endpoint.');
    return { raw, receipt, bytes };
  });
  const used = new Map();
  return connection => {
    let selected;
    const client = createClient(connection, { fetchImpl: async (url, init) => {
      assert(init.method === 'GET', 'The commissioning source is a GET resource.');
      const matches = sources.filter(entry => entry.receipt.url === String(url));
      assert(matches.length, 'No retained response matches the exact requested URL: ' + String(url).split('?')[0]);
      const index = used.get(String(url)) || 0;
      selected = matches[Math.min(index, matches.length - 1)]; used.set(String(url), index + 1);
      return new Response(selected.bytes, { status: selected.receipt.status ?? 200, statusText: selected.receipt.statusText || '', headers: selected.receipt.headers || { 'content-type': selected.raw.contentType || 'application/json' } });
    } });
    return Object.fromEntries(['services', 'requests', 'service', 'request', 'token', 'discovery'].map(method => [method, async (...args) => {
      selected = null;
      const result = await client[method](...args);
      assert(selected && result.raw.sha256 === selected.raw.sha256, 'The decoded response differs from its retained original.');
      const original = selected.receipt;
      return { ...result, receipt: { ...original, method: original.method ?? null, status: original.status ?? null, headers: original.headers ?? null,
        startedAt: original.startedAt ?? null, durationMs: original.durationMs ?? null,
        ...Object.fromEntries(['kind', 'query', 'coverage'].filter(key => result.receipt[key] !== undefined).map(key => [key, result.receipt[key]])),
        replayedAt: new Date().toISOString(), replaySource: resolve(path), replayTransportStatus: original.status ?? 200 } };
    }]));
  };
}

async function main() {
  const args = argumentsForRun(); if (!args) return;
  const supplied = JSON.parse(await readFile(args.connection, 'utf8'));
  const connection = supplied.connection || supplied;
  assert(connection && typeof connection === 'object' && !Array.isArray(connection), 'Supply a connection JSON object.');
  assert(!Object.hasOwn(connection, 'apiKey'), 'Use apiKeyEnv with an environment variable name.');
  const extra = supplied.connection ? supplied.requestsQuery || {} : {};
  const servicesQuery = supplied.connection ? supplied.servicesQuery || {} : {};
  assert(!Object.hasOwn(extra, 'start_date') && !Object.hasOwn(extra, 'end_date'), 'Set the fixed dates with --start and --end.');
  const requestsQuery = { start_date: args.start, end_date: args.end, ...extra };
  if (connection.extendedAttributes && !Object.hasOwn(requestsQuery, 'extensions')) requestsQuery.extensions = true;
  const clientFactory = await retainedFactory(args.retained, connection);
  const output = resolve(args.output);
  await mkdir(output, { mode: 0o700 }); // Deliberately create-only; an existing directory is never reused.
  const journey = { schema: 'commons.open311.commissioning.v1', runId: randomUUID(), state: 'running', startedAt: new Date().toISOString(),
    sourceMode: args.retained ? 'retained-original-responses' : 'live-get', fixedQuery: requestsQuery, output, operations: [], checks: [], files: [] };
  const instances = [];
  async function save(name, body, type = 'application/json') {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    await writeFile(join(output, name), bytes, { flag: 'wx', mode: 0o600 });
    journey.files.push({ name, bytes: bytes.length, sha256: sha256(bytes), contentType: type });
    return bytes;
  }
  async function call(instance, path, { payload, workspaceId, bytes = false } = {}) {
    const response = await fetch(instance.url + path, { method: payload ? 'POST' : 'GET',
      headers: payload ? { 'Content-Type': 'application/json', 'X-Open311-Workspace': workspaceId, Origin: instance.url } : {},
      body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(Math.max(150000, (connection.timeoutMs || 30000) + 30000)) });
    const body = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      let error; try { error = JSON.parse(body.toString('utf8')).error; } catch {}
      throw Object.assign(new Error(error?.message || path + ' returned HTTP ' + response.status), { status: response.status, code: error?.code || 'HTTP_ERROR', details: error?.details });
    }
    return bytes ? { body, type: response.headers.get('content-type') || '' } : JSON.parse(body.toString('utf8'));
  }
  async function mutate(instance, path, input) {
    const state = await call(instance, '/api/state');
    const payload = { ...input, requestId: randomUUID(), expectedRevision: state.revision };
    const pendingPath = join(output, 'pending-operation.json');
    await writeFile(pendingPath, json({ url: instance.url, path, workspaceId: state.workspaceId, payload }), { flag: 'wx', mode: 0o600 });
    let result;
    try { result = await call(instance, path, { payload, workspaceId: state.workspaceId }); }
    catch (error) {
      if (error.status) throw error;
      const operation = await call(instance, '/api/operation?' + queryString({ requestId: payload.requestId })).catch(() => null);
      if (operation?.state !== 'SUCCEEDED') throw Object.assign(error, { requestId: payload.requestId });
      result = operation.result;
    }
    await unlink(pendingPath);
    journey.operations.push({ path, requestId: payload.requestId, revision: result.revision });
    return result;
  }
  async function start(directory) {
    const instance = await startOpen311Server({ workspace: directory, host: '127.0.0.1', port: 0, clientFactory });
    instances.push(instance);
    const state = await call(instance, '/api/state'), health = await call(instance, '/health'), launch = await call(instance, '/api/launch');
    assert(health.status === 'ok' && health.workspaceId === state.workspaceId && launch.workspaceId === state.workspaceId, 'Health or launch identity differs from the current workspace.');
    journey.checks.push({ name: 'health-and-launch', workspaceId: state.workspaceId, directory });
    return instance;
  }
  async function rows(instance, capture) {
    const result = []; let total;
    do {
      const page = await call(instance, '/api/requests?' + queryString({ capture, offset: result.length, limit: 200 }));
      assert(Number.isSafeInteger(page.total) && Array.isArray(page.items), 'Invalid captured request page.');
      total ??= page.total; assert(total === page.total && (page.items.length || result.length === total), 'Captured pagination changed or stopped early.');
      result.push(...page.items);
    } while (result.length < total);
    assert(result.length === total, 'Captured pagination exceeded its declared total.');
    return result;
  }
  try {
    const sourceDirectory = join(output, 'source-workspace'), source = await start(sourceDirectory);
    for (const [path, mime] of [['/', 'text/html'], ['/index.html', 'text/html'], ['/app.mjs', 'text/javascript'], ['/style.css', 'text/css']]) {
      const asset = await call(source, path, { bytes: true });
      assert(asset.body.length > 0 && asset.type.startsWith(mime), 'Missing or incorrect browser asset: ' + path);
      journey.checks.push({ name: 'browser-asset', path, bytes: asset.body.length, sha256: sha256(asset.body) });
    }
    const savedConnection = await mutate(source, '/api/connections', { connection });
    const connectionId = savedConnection.connection.id;
    journey.connection = savedConnection.connection;
    const catalog = await mutate(source, '/api/capture', { connectionId, kind: 'services', query: servicesQuery });
    const services = await call(source, '/api/services?' + queryString({ connection: connectionId }));
    assert(services.capture?.id === catalog.capture.id && Array.isArray(services.items), 'The saved catalogue is unavailable.');
    const first = await mutate(source, '/api/capture', { connectionId, kind: 'requests', query: requestsQuery });
    const initialRows = await rows(source, first.capture.id);
    journey.captures = [catalog.capture, first.capture]; journey.serviceCount = services.items.length;
    assert(initialRows.length, 'This exact source window contains no requests. Its original captures are preserved in source-workspace; choose a populated fixed window for the review journey.');
    const serviceRequestId = initialRows[0].serviceRequestId || initialRows[0].id;
    const detailPath = '/api/request?' + queryString({ capture: first.capture.id, id: serviceRequestId });
    const originalDetail = await call(source, detailPath);
    assert(originalDetail.item.serviceRequestId === serviceRequestId && originalDetail.history.length, 'Original request detail or source history is unavailable.');
    const review = { status: 'in_progress', assignee: 'Engineering commissioning', dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      note: 'Engineering commissioning review: exercise the municipal source capture, internal assignment, handover, and reopen workflow for ' + args.start + ' through ' + args.end + '.' };
    await mutate(source, '/api/reviews', { connectionId, serviceRequestId, review });
    const second = await mutate(source, '/api/capture', { connectionId, kind: 'requests', query: requestsQuery });
    journey.captures.push(second.capture);
    const difference = await call(source, '/api/diff?' + queryString({ before: first.capture.id, after: second.capture.id }));
    await save('differences.json', json(difference));
    journey.comparison = { scopeComparable: difference.scopeComparable, added: difference.added.length, changed: difference.changed.length,
      unchanged: difference.unchanged.length, missingFromCapture: difference.missingFromCapture.length };
    const expectedRows = await rows(source, first.capture.id), expectedDetail = await call(source, detailPath);
    for (const key of ['status', 'assignee', 'note', 'dueDate']) assert(expectedDetail.review?.[key] === review[key], 'The internal review was not saved: ' + key);
    await save('request-detail.json', json(expectedDetail));
    const exports = [['source', catalog.capture.id, 'catalogue.original.json'], ['source', first.capture.id, 'requests.before.original.json'],
      ['source', second.capture.id, 'requests.after.original.json'], ['csv', first.capture.id, 'requests.csv'],
      ['report', first.capture.id, 'requests.html'], ['json', first.capture.id, 'requests.capture.json'], ['workspace', '', 'workspace.json']];
    const originals = new Map(); let bundle;
    for (const [kind, capture, filename] of exports) {
      const exported = await call(source, '/api/export?' + queryString({ kind, ...(capture ? { capture } : {}) }), { bytes: true });
      await save(filename, exported.body, exported.type); originals.set(filename, exported.body);
      if (kind === 'source') assert(sha256(exported.body) === journey.captures.find(item => item.id === capture).sourceSha256, 'Source download differs from its captured original.');
      if (kind === 'workspace') bundle = JSON.parse(exported.body.toString('utf8'));
    }
    const merchantExports = join(output, 'merchant-exports'), hostPath = join(output, 'merchant-host.json');
    await mkdir(merchantExports, { mode: 0o700 });
    const host = { schema: 'stellar-forge.open311-workspace-host.v1', workspaces: { desk: { label: 'Commissioned desk', directory: sourceDirectory, inputs: {}, connectionProfiles: {} } } };
    await save('merchant-host.json', json(host));
    const provider = new MerchantOpen311Workspaces({ open311Workspaces: { ...host, path: hostPath }, exportsDirectory: merchantExports });
    try {
      const merchant = new Open311MerchantClient((name, input) => provider.call(name, input), 'desk'), status = await merchant.status();
      assert(status.workspaceId === bundle.payload.workspace.workspaceId, 'Merchant attachment opened a different workspace.');
      const worklist = await merchant.requests({ capture: first.capture.id, expectedRevision: status.revision, limit: 25 });
      assert(worklist.total === expectedRows.length && Array.isArray(worklist.items) && worklist.items.length, 'Merchant attachment cannot read the captured worklist.');
      const downloaded = await merchant.downloadFile({ kind: 'source', capture: first.capture.id }, { limit: 1024 });
      assert(downloaded.bytes.equals(originals.get('requests.before.original.json')), 'Merchant retained source differs from the original HTTP download.');
      journey.checks.push({ name: 'merchant-shared-workspace-and-retained-source', bytes: downloaded.bytesRead, sha256: downloaded.file.sha256, file: downloaded.file.name });
    } finally { await provider.close(); }
    assert((await call(source, '/health')).status === 'ok', 'Closing the merchant attachment interrupted the browser workspace.');
    const destinationPath = join(output, 'received-workspace'), destination = await start(destinationPath);
    const received = await mutate(destination, '/api/receive', { bundle });
    const receivedState = await call(destination, '/api/state');
    assert(receivedState.workspaceId === bundle.payload.workspace.workspaceId && receivedState.revision === bundle.payload.workspace.revision + 1, 'Received workspace identity or revision was not preserved.');
    const receivedLaunch = await call(destination, '/api/launch');
    assert(receivedLaunch.workspaceId === receivedState.workspaceId, 'Launch identity did not follow the received workspace.');
    await destination.close(); await source.close();
    const reopened = await start(destinationPath);
    equal(await rows(reopened, first.capture.id), expectedRows, 'Reopened original request rows or attached reviews differ.');
    equal(await call(reopened, detailPath), expectedDetail, 'Reopened request detail, history, or review differs.');
    equal((await call(reopened, '/api/services?' + queryString({ connection: connectionId }))).items, services.items, 'Reopened catalogue differs.');
    for (const [kind, capture, filename] of exports.filter(item => item[0] !== 'workspace')) {
      const recovered = await call(reopened, '/api/export?' + queryString({ kind, capture }), { bytes: true });
      assert(recovered.body.equals(originals.get(filename)), 'Reopened export differs: ' + filename);
    }
    const recovered = await call(reopened, '/api/export?kind=workspace', { bytes: true });
    await save('reopened-workspace.json', recovered.body, recovered.type);
    const recoveredBundle = JSON.parse(recovered.body.toString('utf8'));
    for (const key of ['connections', 'captures', 'reviews']) equal(recoveredBundle.payload[key], bundle.payload[key], 'Reopened workspace ' + key + ' differ.');
    for (const operation of bundle.payload.operations) equal(recoveredBundle.payload.operations.find(item => item.requestId === operation.requestId), operation, 'A retained original operation differs after reopen.');
    journey.checks.push({ name: 'receive-reopen-original-rows-reviews-and-exports', requestId: received.requestId, rowCount: expectedRows.length, serviceRequestId, sourceOperationCount: bundle.payload.operations.length });
    journey.state = 'passed'; journey.workspaceId = receivedState.workspaceId;
  } catch (error) {
    journey.state = 'failed'; journey.error = { message: error.message, code: error.code, status: error.status, requestId: error.requestId, details: error.details };
    process.exitCode = 1;
  } finally {
    for (const instance of instances.reverse()) await instance.close().catch(error => { journey.closeError = error.message; journey.state = 'failed'; process.exitCode = 1; });
    journey.completedAt = new Date().toISOString();
    await writeFile(join(output, 'journey.json'), JSON.stringify(journey) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ state: journey.state, output, workspaceId: journey.workspaceId, files: journey.files.length, error: journey.error }));
  }
}
await main().catch(error => { console.error(error.message); process.exitCode = 1; });
