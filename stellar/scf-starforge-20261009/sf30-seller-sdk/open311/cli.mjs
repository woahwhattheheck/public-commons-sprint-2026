#!/usr/bin/env node
// MIT. CLI for the same Open311 durable workspace and local operator server.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HELP = [
  'Open311 municipal service operations',
  'node open311/cli.mjs COMMAND --workspace /private/municipal-desk [OPTIONS]',
  '',
  'serve          [--port 0] [--host 127.0.0.1]',
  '               [--expected-workspace-id UUID] [--expected-binding-sha256 SHA256]',
  'state',
  'services       --connection ID',
  'capture-info   --id CAPTURE_ID',
  'operation      --id REQUEST_ID',
  'connection-put --file connection.json [--request-id ID] [--expected-revision N]',
  'capture        --connection ID [--kind requests] [--query query.json]',
  '               [--resource-id ID] [--ids ID,ID] [--service CODE] [--status STATUS]',
  '               [--start ISO_DATETIME] [--end ISO_DATETIME]',
  '               [--page N] [--page-size N] [--extensions true|false]',
  '               [--request-id ID] [--expected-revision N]',
  'collection-plan   --file collection.json',
  'collection-create --file collection.json [--request-id ID] [--expected-revision N]',
  'collection-run    --id COLLECTION_ID [--request-id ID] [--expected-revision N]',
  'collection-pause  --id COLLECTION_ID [--request-id ID] [--expected-revision N]',
  'collection-info   --id COLLECTION_ID [--offset N] [--limit N]',
  'requests       [--capture CAPTURE_ID | --collection COLLECTION_ID]',
  '               [--status STATUS] [--service CODE] [--q TEXT] [--offset N] [--limit N]',
  '               [--sort requested|updated|expected|id|service|status] [--order asc|desc]',
  '               [--changed-only true|false] [--review-status STATUS] [--assignee TEXT]',
  'request        --id SERVICE_REQUEST_ID [--capture CAPTURE_ID | --connection ID | --collection ID]',
  'diff           --before ID --after ID [--kind capture|collection]',
  'review-put     --connection ID --id SERVICE_REQUEST_ID --file review.json',
  '               [--capture CAPTURE_ID --source-sha256 SHA256]',
  '               [--request-id ID] [--expected-revision N]',
  'export         [--kind workspace|source|json|csv|report]',
  '               [--capture CAPTURE_ID | --collection COLLECTION_ID] [--out FILE]',
  'receive        --file workspace.json [--request-id ID] [--expected-revision N]',
  '',
  'All non-server commands accept --out FILE for their complete output.',
  'Output files are created exclusively; choose a new path for an existing file.',
  'Mutations print their request ID and original revision before submission.',
  'Repeat those exact values and inputs when resuming the same operation.',
  'Capture and collection-run read the chosen civic endpoint. Reviews change this workspace.',
  'Collection files contain connectionId, name, query with fixed start/end dates, and optional policy.',
  'Collection-plan prints the exact initial queries and redacted source URLs without contacting the source.',
  'Collection-run retains every capped parent and refines its children until complete, limited or interrupted.',
  'Pause from a second process after reading the latest revision; resume the saved run intent on uncertain delivery.',
].join('\n');
const MUTATIONS = new Set(['connection-put', 'capture', 'review-put', 'receive', 'collection-create', 'collection-run', 'collection-pause']);
const OPTIONS = {
  serve: ['host', 'port', 'expected-workspace-id', 'expected-binding-sha256'], state: [], services: ['connection'],
  'capture-info': ['id'], operation: ['id'], 'connection-put': ['file'],
  capture: ['connection', 'kind', 'query', 'resource-id', 'ids', 'service', 'status',
    'start', 'end', 'page', 'page-size', 'extensions'],
  'collection-plan': ['file'], 'collection-create': ['file'],
  'collection-run': ['id'], 'collection-pause': ['id'], 'collection-info': ['id', 'offset', 'limit'],
  requests: ['capture', 'collection', 'status', 'service', 'q', 'offset', 'limit', 'sort', 'order', 'changed-only', 'review-status', 'assignee'],
  request: ['capture', 'connection', 'collection', 'id'], diff: ['kind', 'before', 'after'],
  'review-put': ['connection', 'id', 'file', 'capture', 'source-sha256'],
  export: ['kind', 'capture', 'collection'], receive: ['file'],
};
function parse(args) {
  if (!args.length || args.includes('--help')) return null;
  const [command, ...rest] = args;
  if (!Object.prototype.hasOwnProperty.call(OPTIONS, command)) throw new TypeError('Unknown command: ' + command);
  const permitted = new Set(['workspace', ...OPTIONS[command],
    ...(command === 'serve' ? [] : ['out']),
    ...(MUTATIONS.has(command) ? ['request-id', 'expected-revision'] : [])]);
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    if (!flag.startsWith('--') || !permitted.has(flag.slice(2)) ||
        !rest[index + 1] || rest[index + 1].startsWith('--'))
      throw new TypeError('Invalid or incomplete option: ' + flag);
    const key = flag.slice(2);
    if (Object.prototype.hasOwnProperty.call(options, key)) throw new TypeError('Duplicate option: ' + flag);
    options[key] = rest[index + 1];
  }
  if (!options.workspace) throw new TypeError('--workspace is required');
  return { command, options };
}
function required(options, key) {
  if (!options[key]) throw new TypeError('--' + key + ' is required');
  return options[key];
}
function integer(value, fallback, name) {
  if (value == null) return fallback;
  if (!/^(?:0|[1-9]\d*)$/u.test(String(value))) throw new TypeError(name + ' must be a nonnegative integer');
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new TypeError(name + ' must be a safe integer');
  return number;
}
function selected(options, keys, needed = true) {
  const supplied = keys.filter(key => options[key] !== undefined);
  if (supplied.length > 1 || needed && supplied.length !== 1)
    throw new TypeError('Select exactly one of ' + keys.map(key => '--' + key).join(', '));
  return supplied.length ? { [supplied[0]]: options[supplied[0]] } : {};
}
function boolean(value, name) {
  if (!['true', 'false'].includes(value)) throw new TypeError(name + ' must be true or false');
  return value === 'true';
}
async function jsonFile(path) {
  const value = JSON.parse(await readFile(resolve(path), 'utf8'));
  if (value == null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('JSON input must be an object: ' + path);
  return value;
}
async function output(value, options, raw = false) {
  const body = raw ? value : JSON.stringify(value, null, 2) + '\n';
  if (typeof body !== 'string' && !Buffer.isBuffer(body)) throw new TypeError('The workspace export body must be text or original bytes');
  if (options.out && options.out !== '-') {
    const path = resolve(options.out);
    await writeFile(path, body, { flag: 'wx', mode: 0o600 });
    process.stderr.write(JSON.stringify({ saved: path, bytes: Buffer.byteLength(body) }) + '\n');
  } else process.stdout.write(body);
}
function sourceQuery(options, initial) {
  const result = { ...initial };
  for (const [flag, field] of Object.entries({
    ids: 'service_request_id', service: 'service_code', status: 'status',
    start: 'start_date', end: 'end_date', page: 'page', 'page-size': 'page_size',
  })) if (options[flag] != null) result[field] = options[flag];
  if (options.extensions != null) {
    if (!['true', 'false'].includes(options.extensions)) throw new TypeError('--extensions must be true or false');
    result.extensions = options.extensions === 'true';
  }
  return result;
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parse(args);
  if (!parsed) { process.stdout.write(HELP + '\n'); return null; }
  const { command, options } = parsed;
  if (command === 'serve') {
    const port = integer(options.port, 0, '--port');
    if (port > 65535) throw new TypeError('--port must be at most 65535');
    const { startOpen311Server } = await import('./server.mjs');
    const session = await startOpen311Server({ workspace: resolve(options.workspace),
      host: options.host ?? '127.0.0.1', port,
      expectedWorkspaceId: options['expected-workspace-id'],
      expectedBindingSha256: options['expected-binding-sha256'] });
    process.stdout.write(JSON.stringify(session.startup) + '\n');
    let closing;
    const close = () => closing ??= Promise.resolve().then(() => session.close());
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      close().catch(error => {
        process.stderr.write(JSON.stringify({ code: error.code ?? 'CLOSE_FAILED', message: error.message }) + '\n');
        process.exitCode = 1;
      });
    });
    return session;
  }
  const { openWorkspace } = await import('./workspace.mjs');
  const workspace = await openWorkspace(resolve(options.workspace));
  let intent = null;
  try {
    if (MUTATIONS.has(command)) {
      const state = workspace.state();
      intent = { requestId: options['request-id'] ?? randomUUID(),
        expectedRevision: integer(options['expected-revision'], state.revision, '--expected-revision') };
      process.stderr.write(JSON.stringify({ operation: command, ...intent }) + '\n');
    }
    let result;
    if (command === 'state') result = workspace.state();
    else if (command === 'services') result = await workspace.services({ connection: required(options, 'connection') });
    else if (command === 'capture-info') result = await workspace.captureInfo({ id: required(options, 'id') });
    else if (command === 'operation') result = await workspace.operation(required(options, 'id'));
    else if (command === 'connection-put') result = await workspace.putConnection({
      ...intent, connection: await jsonFile(required(options, 'file')),
    });
    else if (command === 'capture') {
      const kind = options.kind ?? 'requests';
      if (!['services', 'service', 'requests', 'request', 'token', 'discovery'].includes(kind))
        throw new TypeError('Unsupported capture kind');
      const query = sourceQuery(options, options.query ? await jsonFile(options.query) : {});
      result = await workspace.capture({ ...intent, connectionId: required(options, 'connection'),
        kind, query, ...(options['resource-id'] != null ? { resourceId: options['resource-id'] } : {}) });
    } else if (command === 'collection-plan' || command === 'collection-create') {
      const collection = await jsonFile(required(options, 'file'));
      if (Object.keys(collection).some(key => !['connectionId', 'name', 'query', 'policy'].includes(key)))
        throw new TypeError('The collection file accepts connectionId, name, query and policy.');
      if (command === 'collection-create') result = workspace.createCollection({ ...collection, ...intent });
      else {
        const connection = workspace.state().connections.find(item => item.id === collection.connectionId);
        if (!connection) throw new TypeError('The collection connection is not saved in this workspace.');
        const { normalizeCollectionPlan, collectionNodeQuery } = await import('./collection-domain.mjs');
        const { describeRequests } = await import('./client.mjs');
        const plan = normalizeCollectionPlan(connection, collection);
        result = { schema: 'commons.open311.collection-plan.v1', connectionId: connection.id,
          name: plan.name, query: plan.query, requestedQuery: plan.requestedQuery, policy: plan.policy,
          windows: plan.nodes.map(window => ({ ...window,
            ...describeRequests(connection, collectionNodeQuery({ ...plan, connection }, window)) })) };
      }
    } else if (command === 'collection-run') result = await workspace.runCollection({ ...intent, collectionId: required(options, 'id') });
    else if (command === 'collection-pause') result = workspace.pauseCollection({ ...intent, collectionId: required(options, 'id') });
    else if (command === 'collection-info') result = workspace.collectionInfo({ id: required(options, 'id'),
      offset: integer(options.offset, 0, '--offset'), limit: integer(options.limit, 100, '--limit') });
    else if (command === 'requests') result = await workspace.requests({
      ...selected(options, ['capture', 'collection']),
      ...(options.status ? { status: options.status } : {}),
      ...(options.service ? { service: options.service } : {}),
      ...(options.q ? { q: options.q } : {}),
      ...(options.sort ? { sort: options.sort } : {}), ...(options.order ? { order: options.order } : {}),
      ...(options['changed-only'] !== undefined ? { changedOnly: boolean(options['changed-only'], '--changed-only') } : {}),
      ...(options['review-status'] ? { reviewStatus: options['review-status'] } : {}),
      ...(options.assignee ? { assignee: options.assignee } : {}),
      offset: integer(options.offset, 0, '--offset'), limit: integer(options.limit, 100, '--limit'),
    });
    else if (command === 'request') result = await workspace.request({
      ...selected(options, ['capture', 'connection', 'collection']),
      id: required(options, 'id'),
    });
    else if (command === 'diff') result = await workspace.diff({
      kind: options.kind ?? 'capture', before: required(options, 'before'), after: required(options, 'after'),
    });
    else if (command === 'review-put') result = await workspace.putReview({
      ...intent, connectionId: required(options, 'connection'), serviceRequestId: required(options, 'id'),
      review: await jsonFile(required(options, 'file')),
      ...(options.capture ? { captureId: options.capture } : {}),
      ...(options['source-sha256'] ? { expectedSourceSha256: options['source-sha256'] } : {}),
    });
    else if (command === 'receive') result = await workspace.receive({
      ...intent, bundle: await jsonFile(required(options, 'file')),
    });
    else if (command === 'export') {
      const exported = await workspace.export({ kind: options.kind ?? 'workspace',
        ...selected(options, ['capture', 'collection'], false) });
      await output(exported.body, options, true);
      return exported;
    }
    const delivered = intent ? { ...intent, result } : result;
    await output(delivered, options);
    return delivered;
  } catch (error) {
    if (intent) error.operationIntent = intent;
    throw error;
  } finally { await workspace.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ ok: false, code: error.code ?? 'OPEN311_COMMAND_FAILED',
      message: error.message, ...(error.operationIntent ?? {}),
      ...(error.result ? { result: error.result } : {}) }) + '\n');
    process.exitCode = 1;
  });
}
