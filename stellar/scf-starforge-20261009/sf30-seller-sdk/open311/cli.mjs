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
  'requests       --capture CAPTURE_ID [--status STATUS] [--service CODE]',
  '               [--q TEXT] [--offset N] [--limit N]',
  'request        --id SERVICE_REQUEST_ID [--capture CAPTURE_ID | --connection ID]',
  'diff           --before CAPTURE_ID --after CAPTURE_ID',
  'review-put     --connection ID --id SERVICE_REQUEST_ID --file review.json',
  '               [--request-id ID] [--expected-revision N]',
  'export         [--kind workspace|source|json|csv|report] [--capture CAPTURE_ID] [--out FILE]',
  'receive        --file workspace.json [--request-id ID] [--expected-revision N]',
  '',
  'All non-server commands accept --out FILE for their complete output.',
  'Output files are created exclusively; choose a new path for an existing file.',
  'Mutations print their request ID and original revision before submission.',
  'Repeat those exact values and inputs when resuming the same operation.',
  'Capture reads the chosen civic endpoint. Reviews change this workspace.',
].join('\n');
const MUTATIONS = new Set(['connection-put', 'capture', 'review-put', 'receive']);
const OPTIONS = {
  serve: ['host', 'port', 'expected-workspace-id', 'expected-binding-sha256'], state: [], services: ['connection'],
  'capture-info': ['id'], operation: ['id'], 'connection-put': ['file'],
  capture: ['connection', 'kind', 'query', 'resource-id', 'ids', 'service', 'status',
    'start', 'end', 'page', 'page-size', 'extensions'],
  requests: ['capture', 'status', 'service', 'q', 'offset', 'limit'],
  request: ['capture', 'connection', 'id'], diff: ['before', 'after'],
  'review-put': ['connection', 'id', 'file'], export: ['kind', 'capture'], receive: ['file'],
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
    } else if (command === 'requests') result = await workspace.requests({
      capture: required(options, 'capture'),
      ...(options.status ? { status: options.status } : {}),
      ...(options.service ? { service: options.service } : {}),
      ...(options.q ? { q: options.q } : {}),
      offset: integer(options.offset, 0, '--offset'), limit: integer(options.limit, 100, '--limit'),
    });
    else if (command === 'request') result = await workspace.request({
      ...(options.capture ? { capture: options.capture } : { connection: required(options, 'connection') }),
      id: required(options, 'id'),
    });
    else if (command === 'diff') result = await workspace.diff({
      before: required(options, 'before'), after: required(options, 'after'),
    });
    else if (command === 'review-put') result = await workspace.putReview({
      ...intent, connectionId: required(options, 'connection'), serviceRequestId: required(options, 'id'),
      review: await jsonFile(required(options, 'file')),
    });
    else if (command === 'receive') result = await workspace.receive({
      ...intent, bundle: await jsonFile(required(options, 'file')),
    });
    else if (command === 'export') {
      const exported = await workspace.export({ kind: options.kind ?? 'workspace',
        ...(options.capture ? { capture: options.capture } : {}) });
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
