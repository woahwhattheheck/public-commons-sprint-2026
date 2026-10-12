#!/usr/bin/env node
// MIT. Standard health observations through the original private gRPC workspace.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readBytes, fail, canonical, sha256 } from './common.mjs';
import { normalizeGrpcHealthRequest } from './health.mjs';
import { GRPC_HEALTH_MAX_BYTES } from './health-record.mjs';
import { readGrpcHealthSnapshotFile, writeGrpcHealthSnapshotFile } from './health-receiving.mjs';

const HELP = [
  'grpc health check CONNECTION --revision SHA --id UUID [--service NAME --timeout-ms 30000]',
  'grpc health list-services CONNECTION --revision SHA --id UUID [--timeout-ms 30000]',
  'grpc health watch CONNECTION --revision SHA --id UUID [--service NAME --timeout-ms 30000 --duration-ms 60000 --max-events 1000 --follow true --detach false]',
  'grpc health observations CONNECTION [--revision SHA --offset 0 --limit 50 --snapshot SHA]',
  'grpc health open CONNECTION --id UUID [--section events|summary|services --after 0 --through VERSION --snapshot SHA --limit 50 --filter TEXT]',
  'grpc health stop CONNECTION --id UUID',
  'grpc health resume CONNECTION --id UUID --version INTEGER [--follow true --detach false]',
  'grpc health export CONNECTION --id UUID --out PRIVATE_JSON [--through VERSION --snapshot SHA]',
  'grpc health inspect --file PRIVATE_JSON [--snapshot-sha SHA --section summary|events|services|full --after 0 --limit 50 --filter TEXT]',
  'CONNECTION is exactly one --console-url-file PRIVATE_FILE or --state ORIGINAL_PRIVATE_WORKSPACE.',
  'A Watch on a running console can detach; a local --state operation keeps its original writer lease until the observation closes.',
  'Repeat receiving reuses the existing file’s original frozen event prefix. Use another file to retain a newer observation.',
].join('\n');
const connectionOptions = ['--state', '--console-url-file'];
const requestOptions = ['--revision', '--id', '--service', '--timeout-ms'];
const options = {
  check: [...connectionOptions, ...requestOptions],
  'list-services': [...connectionOptions, '--revision', '--id', '--timeout-ms'],
  watch: [...connectionOptions, ...requestOptions, '--duration-ms', '--max-events', '--follow', '--detach'],
  observations: [...connectionOptions, '--revision', '--offset', '--limit', '--snapshot'],
  open: [...connectionOptions, '--id', '--section', '--after', '--through', '--snapshot', '--limit', '--filter'],
  stop: [...connectionOptions, '--id'],
  resume: [...connectionOptions, '--id', '--version', '--follow', '--detach'],
  export: [...connectionOptions, '--id', '--out', '--through', '--snapshot'],
  inspect: ['--file', '--snapshot-sha', '--section', '--after', '--limit', '--filter'],
};
const need = (flags, key) => { if (!flags.has(key)) fail('GRPC_HEALTH_REQUIRED_OPTION_' + key.slice(2).replaceAll('-', '_').toUpperCase()); return flags.get(key); };
const bool = (flags, key, fallback = false) => {
  const value = flags.get(key);
  if (value === undefined) return fallback;
  if (!['true', 'false'].includes(value)) fail('GRPC_HEALTH_BOOLEAN_OPTION_INVALID');
  return value === 'true';
};
function number(flags, key, fallback) {
  if (!flags.has(key)) return fallback;
  const value = Number(flags.get(key));
  if (!Number.isSafeInteger(value) || !/^(0|[1-9][0-9]*)$/.test(flags.get(key))) fail('GRPC_HEALTH_INTEGER_OPTION_INVALID');
  return value;
}
async function connect(flags) {
  if (flags.has('--state') === flags.has('--console-url-file')) fail('GRPC_HEALTH_ONE_CONNECTION_REQUIRED');
  if (flags.has('--state')) {
    const { createGrpcWorkspace } = await import('./workspace/model.mjs');
    return createGrpcWorkspace({ stateDirectory: resolve(flags.get('--state')) });
  }
  const file = resolve(flags.get('--console-url-file'));
  const { lstat } = await import('node:fs/promises'), stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || process.platform !== 'win32' && stat.mode & 0o077)
    fail('GRPC_HEALTH_PRIVATE_CONNECTION_REQUIRED');
  let url;
  try { url = new URL(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(file, 4096)).trim()); }
  catch { fail('GRPC_CONNECTION_INVALID'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || Number(url.port || 80) < 1 || url.username ||
      url.password || url.pathname !== '/' || url.search || !/^#[a-f0-9]{64}$/.test(url.hash)) fail('GRPC_CONNECTION_INVALID');
  const token = url.hash.slice(1), origin = url.origin;
  async function request(route, body) {
    try {
      const response = await fetch(origin + '/api/' + route, { method: 'POST', redirect: 'error',
        signal: AbortSignal.timeout(420000), headers: { origin, 'x-workspace-token': token, 'content-type': 'application/json' },
        body: JSON.stringify(body) });
      const parts = []; let total = 0;
      for await (const chunk of response.body ?? []) {
        total += chunk.length;
        if (total > (response.ok ? GRPC_HEALTH_MAX_BYTES : 65536)) fail('GRPC_HEALTH_RESPONSE_TOO_LARGE', 413);
        parts.push(chunk);
      }
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, total)));
      if (!response.ok) {
        const code = /^[A-Z][A-Z0-9_]+$/.test(value.error ?? '') ? value.error : 'GRPC_ORIGINAL_OPERATOR_REJECTED';
        throw Object.assign(new Error(code), { code, status: response.status });
      }
      return value;
    } catch (issue) {
      if (issue.status || issue.code?.startsWith('GRPC_')) throw issue;
      throw Object.assign(new Error('GRPC_HEALTH_REPLY_INTERRUPTED'), { code: 'GRPC_HEALTH_REPLY_INTERRUPTED',
        recovery: 'Open the same original health UUID before starting another observation.' });
    }
  }
  return {
    healthStart: body => request('health-start', body), healthRead: body => request('health-read', body),
    healthList: body => request('health-list', body), healthCancel: body => request('health-cancel', body),
    healthResume: body => request('health-resume', body), healthExport: body => request('health-export', body),
    close: async () => {},
  };
}
function page(rows, flags) {
  const after = number(flags, '--after', 0), limit = number(flags, '--limit', 50);
  if (after < 0 || after > rows.length || limit < 1 || limit > 250) fail('GRPC_HEALTH_PAGE_INVALID');
  return { total: rows.length, after, items: rows.slice(after, after + limit),
    nextAfter: after + limit < rows.length ? after + limit : null };
}
function inspect(value, flags) {
  const section = flags.get('--section') ?? 'summary';
  if (section === 'full') return value;
  if (section === 'summary') return { snapshotSha256: value.snapshotSha256, operation: value.summary,
    request: value.operation.request, protocolSha256: value.operation.protocolSha256 };
  if (section === 'events') return { snapshotSha256: value.snapshotSha256, ...page(value.events, flags) };
  if (section === 'services') {
    const event = [...value.events].reverse().find(row => row.kind === 'native' && row.data.type === 'status');
    const rows = (event?.data.statuses ?? []).filter(row => row.service.toLowerCase().includes((flags.get('--filter') ?? '').toLowerCase()));
    return { snapshotSha256: value.snapshotSha256, atomic: false, ...page(rows, flags) };
  }
  fail('GRPC_HEALTH_SECTION_INVALID');
}
export async function healthMain(args = process.argv.slice(2), { stdout = process.stdout } = {}) {
  if (!args.length || args[0] === '--help') { stdout.write(HELP + '\n'); return; }
  const [command, ...rest] = args, flags = new Map();
  if (!options[command]) throw new TypeError(HELP);
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index], value = rest[index + 1];
    if (!options[command].includes(key) || value === undefined || value.startsWith('--') || flags.has(key))
      fail('GRPC_HEALTH_OPTIONS_INVALID');
    flags.set(key, value);
  }
  let workspace, result, operationId, interrupted = false, cancellation;
  const stop = () => {
    interrupted = true;
    if (workspace && operationId) cancellation ??= workspace.healthCancel({ id: operationId });
    cancellation?.catch(() => {});
  };
  try {
    if (command === 'inspect') {
      const retained = await readGrpcHealthSnapshotFile(resolve(need(flags, '--file')), flags.get('--snapshot-sha'));
      result = inspect(retained.value, flags);
    } else {
      if (bool(flags, '--detach') && !flags.has('--console-url-file')) fail('GRPC_HEALTH_DETACH_REQUIRES_RUNNING_CONSOLE');
      workspace = await connect(flags);
      if (['check', 'list-services', 'watch', 'resume'].includes(command)) {
        operationId = need(flags, '--id');
        process.once('SIGINT', stop); process.once('SIGTERM', stop);
      }
      if (['check', 'list-services', 'watch'].includes(command)) {
        const kind = command === 'list-services' ? 'list' : command;
        const request = normalizeGrpcHealthRequest({ kind,
          ...(kind === 'list' ? {} : { service: flags.get('--service') ?? '' }),
          ...(flags.has('--timeout-ms') ? { timeoutMs: number(flags, '--timeout-ms') } : {}),
          ...(flags.has('--duration-ms') ? { durationMs: number(flags, '--duration-ms') } : {}),
          ...(flags.has('--max-events') ? { maxEvents: number(flags, '--max-events') } : {}) });
        result = await workspace.healthStart({ id: operationId, revision: need(flags, '--revision'), request });
      } else if (command === 'resume') result = await workspace.healthResume({ id: operationId,
        expectedVersion: number(flags, '--version', -1) });
      else if (command === 'observations') result = await workspace.healthList({
        ...(flags.has('--revision') ? { revision: flags.get('--revision') } : {}),
        offset: number(flags, '--offset', 0), limit: number(flags, '--limit', 50),
        ...(flags.has('--snapshot') ? { expectedSnapshot: flags.get('--snapshot') } : {}) });
      else if (command === 'open') result = await workspace.healthRead({
        id: need(flags, '--id'), section: flags.get('--section') ?? 'events',
        afterSequence: number(flags, '--after', 0), limit: number(flags, '--limit', 50),
        ...(flags.has('--through') ? { throughSequence: number(flags, '--through') } : {}),
        ...(flags.has('--snapshot') ? { expectedSnapshot: flags.get('--snapshot') } : {}),
        ...(flags.has('--filter') ? { serviceFilter: flags.get('--filter') } : {}) });
      else if (command === 'stop') result = await workspace.healthCancel({ id: need(flags, '--id') });
      else if (command === 'export') {
        const id = need(flags, '--id'), output = resolve(need(flags, '--out'));
        let old;
        try { old = (await readGrpcHealthSnapshotFile(output)).value; } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
        if (old && (old.operation.id !== id ||
            flags.has('--through') && number(flags, '--through') !== old.summary.version ||
            flags.has('--snapshot') && flags.get('--snapshot') !== old.summary.snapshot))
          fail('GRPC_HEALTH_RECEIVING_CONFLICT', 409);
        const request = { id, ...(old ? { throughSequence: old.summary.version, expectedSnapshot: old.summary.snapshot } : {
          ...(flags.has('--through') ? { throughSequence: number(flags, '--through') } : {}),
          ...(flags.has('--snapshot') ? { expectedSnapshot: flags.get('--snapshot') } : {}) }) };
        const snapshot = await workspace.healthExport(request);
        if (old && old.snapshotSha256 !== snapshot.snapshotSha256) fail('GRPC_HEALTH_RECEIVING_CONFLICT', 409);
        result = await writeGrpcHealthSnapshotFile(output, snapshot);
      }
      if (operationId && !bool(flags, '--detach')) {
        let after = 0;
        while (result.operation.runningHere) {
          if (interrupted) {
            try { await cancellation; } catch { cancellation = workspace.healthCancel({ id: operationId }); await cancellation; }
            if (!cancellation) { cancellation = workspace.healthCancel({ id: operationId }); await cancellation; }
            result = await workspace.healthRead({ id: operationId, section: 'summary' }); break;
          }
          if (bool(flags, '--follow')) {
            const events = await workspace.healthRead({ id: operationId, afterSequence: after, limit: 250 });
            for (const event of events.events) { stdout.write(JSON.stringify(event) + '\n'); after = event.sequence; }
          }
          await delay(200);
          result = await workspace.healthRead({ id: operationId, section: 'summary' });
        }
        if (bool(flags, '--follow')) {
          for (;;) {
            const events = await workspace.healthRead({ id: operationId, afterSequence: after, limit: 250 });
            for (const event of events.events) { stdout.write(JSON.stringify(event) + '\n'); after = event.sequence; }
            if (events.page.nextAfterSequence === null) break;
          }
        }
      }
    }
    stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    await cancellation?.catch(() => {});
    await workspace?.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  healthMain().then(result => { if (['FAILED', 'UNSUPPORTED', 'INTERRUPTED'].includes(result?.operation?.phase)) process.exitCode = 2; })
    .catch(issue => { console.error(JSON.stringify({ error: issue.code ?? 'GRPC_HEALTH_CLI_FAILED',
      ...(issue.field_path ? { field: issue.field_path } : {}) })); process.exitCode = 1; });
