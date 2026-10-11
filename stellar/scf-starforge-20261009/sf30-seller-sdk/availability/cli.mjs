#!/usr/bin/env node
// MIT. Operator commands for the running seller's single-writer availability policy.
import { request } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_RESPONSE = 1024 * 1024;
const ROUTE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TOKEN = /^[a-f0-9]{64}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const OWN = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, exitCode = 2) => { throw Object.assign(new Error(message), { code, exitCode }); };
const safeText = value => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');

const HELP = `Seller availability

  node availability/cli.mjs status --url http://127.0.0.1:PORT [--json]
  node availability/cli.mjs pause --url-env SELLER_AVAILABILITY_URL \\
    --revision 0 --route ROUTE_ID [--route ANOTHER_ID] [--reason TEXT]
  node availability/cli.mjs resume --url http://127.0.0.1:PORT \\
    --token-env SELLER_AVAILABILITY_TOKEN --revision 1 --route ROUTE_ID

Commands: status, pause, resume
  --url VALUE       Operations base URL or the startup availabilityControlUrl.
  --url-env NAME    Read that URL from one environment variable.
  --token-env NAME  Read the control token when using an operations base URL.
  --revision N     Required for a change; use the revision already reviewed.
  --route ID       Select one route; repeat for up to 100 distinct route IDs.
  --reason TEXT    Optional change note, up to 160 characters.
  --timeout-ms N   Request deadline, 1–30000 ms; default 10000.
  --json           Print structured output.
  --help           Show this help.

Only the running loopback operations service is used. A stale revision returns
the current state and exits 3; the command never retries a change automatically.
`;

function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string')) fail('AVAILABILITY_CLI_ARGUMENTS', 'Arguments must be strings.');
  if (!argv.length || argv.includes('--help')) return { help: true };
  const [command, ...args] = argv;
  if (!['status', 'pause', 'resume'].includes(command)) fail('AVAILABILITY_CLI_COMMAND', 'Use status, pause or resume.');
  const result = { command, routeIds: [], json: false, timeoutMs: 10000 };
  const seen = new Set();
  const names = new Map([['--url', 'url'], ['--url-env', 'urlEnv'], ['--token-env', 'tokenEnv'],
    ['--revision', 'revision'], ['--reason', 'reason'], ['--timeout-ms', 'timeoutMs']]);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--json') { if (seen.has(flag)) fail('AVAILABILITY_CLI_ARGUMENTS', 'Duplicate --json.'); seen.add(flag); result.json = true; continue; }
    if (flag !== '--route' && !names.has(flag)) fail('AVAILABILITY_CLI_ARGUMENTS', 'Unknown option; use --help.');
    const value = args[++index];
    if (value === undefined || value.startsWith('--')) fail('AVAILABILITY_CLI_ARGUMENTS', 'An option value is missing.');
    if (flag === '--route') { result.routeIds.push(value); continue; }
    if (seen.has(flag)) fail('AVAILABILITY_CLI_ARGUMENTS', 'An option was supplied more than once.');
    seen.add(flag); result[names.get(flag)] = value;
  }
  if (Boolean(result.url) === Boolean(result.urlEnv)) fail('AVAILABILITY_CLI_URL', 'Supply exactly one of --url or --url-env.');
  for (const name of ['urlEnv', 'tokenEnv']) if (result[name] !== undefined && !ENV_NAME.test(result[name]))
    fail('AVAILABILITY_CLI_ENV', 'Environment variable names must be valid identifiers.');
  if (typeof result.timeoutMs === 'string') {
    if (!/^[1-9][0-9]*$/.test(result.timeoutMs)) fail('AVAILABILITY_CLI_TIMEOUT', 'Use --timeout-ms from 1 through 30000.');
    result.timeoutMs = Number(result.timeoutMs);
  }
  if (!Number.isSafeInteger(result.timeoutMs) || result.timeoutMs < 1 || result.timeoutMs > 30000)
    fail('AVAILABILITY_CLI_TIMEOUT', 'Use --timeout-ms from 1 through 30000.');
  if (result.command === 'status') {
    if (result.routeIds.length || result.revision !== undefined || result.reason !== undefined)
      fail('AVAILABILITY_CLI_ARGUMENTS', 'status accepts no route, revision or change reason.');
  } else {
    if (typeof result.revision !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(result.revision) || !Number.isSafeInteger(Number(result.revision)))
      fail('AVAILABILITY_CLI_REVISION', 'A change requires --revision from the state you reviewed.');
    result.revision = Number(result.revision);
    if (!result.routeIds.length || result.routeIds.length > 100 || new Set(result.routeIds).size !== result.routeIds.length || result.routeIds.some(id => !ROUTE_ID.test(id)))
      fail('AVAILABILITY_CLI_ROUTES', 'Select 1–100 distinct route IDs with repeated --route options.');
    if (result.reason !== undefined && (result.reason.length > 160 || /[\u0000-\u001f\u007f]/.test(result.reason)))
      fail('AVAILABILITY_CLI_REASON', 'Use a change reason up to 160 characters without control characters.');
  }
  return result;
}

function connection(options, env) {
  const readEnv = name => {
    const value = OWN(env, name) ? env[name] : undefined;
    if (typeof value !== 'string' || !value) fail('AVAILABILITY_CLI_ENV', 'A selected environment variable is missing or empty.');
    return value;
  };
  const value = options.urlEnv ? readEnv(options.urlEnv) : options.url;
  let url;
  try { url = new URL(value); } catch { fail('AVAILABILITY_CLI_URL', 'Use the local operations base URL or startup availabilityControlUrl.'); }
  if (typeof value !== 'string' || value.length > 512 || url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.username || url.password ||
      url.search || value.includes('?') || !['/', '/availability'].includes(url.pathname) ||
      ![url.origin, url.href].includes(value) || (value.includes('#') && (!url.hash || url.pathname !== '/availability')))
    fail('AVAILABILITY_CLI_URL', 'Use a canonical HTTP loopback URL with an explicit port and optional /availability control fragment.');
  if (url.hash && !TOKEN.test(url.hash.slice(1))) fail('AVAILABILITY_CLI_TOKEN', 'The availability control fragment must contain the exact startup token.');
  if (url.hash && options.tokenEnv) fail('AVAILABILITY_CLI_TOKEN', 'Use either the startup URL fragment or --token-env.');
  const token = url.hash ? url.hash.slice(1) : options.tokenEnv ? readEnv(options.tokenEnv) : null;
  if (token !== null && !TOKEN.test(token)) fail('AVAILABILITY_CLI_TOKEN', 'The control token must contain exactly 64 lowercase hexadecimal characters.');
  if (options.command !== 'status' && token === null) fail('AVAILABILITY_CLI_TOKEN', 'A change requires the startup control URL or --token-env.');
  return { origin: url.origin, token };
}

function readSnapshot(value) {
  if (!plain(value)) fail('AVAILABILITY_CLI_RESPONSE', 'The operations service returned an invalid availability response.', 1);
  if (value.available === false) return { available: false, controlsEnabled: value.controlsEnabled === true };
  if (value.schema !== 'stellar-forge.seller-availability.v1' || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !['ready', 'unavailable'].includes(value.storageState) || !Array.isArray(value.routes) || value.routes.length > 256 ||
      !Array.isArray(value.retiredPauses) || value.retiredPauses.length > 256 || !Array.isArray(value.recentChanges) || value.recentChanges.length > 32)
    fail('AVAILABILITY_CLI_RESPONSE', 'The operations service returned an invalid availability snapshot.', 1);
  return { schema: value.schema, available: true, controlsEnabled: value.controlsEnabled === true,
    revision: value.revision, savedAt: safeText(value.savedAt), storageState: value.storageState,
    serviceOrigin: safeText(value.serviceOrigin), routes: value.routes.map(row => {
      if (!plain(row) || !ROUTE_ID.test(row.id ?? '') || !['selling', 'pausing', 'paused', 'storage_unavailable'].includes(row.state) ||
          ['inFlight', 'admitted', 'rejected'].some(key => !Number.isSafeInteger(row[key]) || row[key] < 0))
        fail('AVAILABILITY_CLI_RESPONSE', 'The operations service returned an invalid route state.', 1);
      return { id: row.id, method: safeText(row.method), path: safeText(row.path), description: safeText(row.description),
        state: row.state, paused: row.paused === true, reason: safeText(row.reason), changedAt: row.changedAt ?? null,
        inFlight: row.inFlight, admitted: row.admitted, rejected: row.rejected };
    }),
    retiredPauses: value.retiredPauses.map(row => {
      if (!plain(row) || !ROUTE_ID.test(row.id ?? '')) fail('AVAILABILITY_CLI_RESPONSE', 'The operations service returned an invalid retired pause.', 1);
      return { id: row.id, reason: safeText(row.reason), changedAt: safeText(row.changedAt) };
    }),
    recentChanges: value.recentChanges.map(row => {
      if (!plain(row) || !Number.isSafeInteger(row.revision) || !['pause', 'resume'].includes(row.action) ||
          !Array.isArray(row.routeIds) || row.routeIds.length > 100 || row.routeIds.some(id => !ROUTE_ID.test(id)))
        fail('AVAILABILITY_CLI_RESPONSE', 'The operations service returned an invalid change record.', 1);
      return { revision: row.revision, at: safeText(row.at), action: row.action, routeIds: [...row.routeIds], reason: safeText(row.reason) };
    }) };
}

function callService(target, path, { method = 'GET', payload, timeoutMs, signal } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false, outgoing, incoming, timer;
    const chunks = []; let bytes = 0;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) { incoming?.destroy(); outgoing?.destroy(); reject(error); } else resolve(result);
    };
    const problem = (code, message, exitCode = 1) => finish(Object.assign(new Error(message), { code, exitCode }));
    const abort = () => problem('AVAILABILITY_CLI_ABORTED', 'Availability request interrupted.', 130);
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => problem('AVAILABILITY_CLI_TIMEOUT', 'The operations request exceeded its deadline; inspect status before another change.'), timeoutMs);
    const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    try {
      outgoing = request(new URL(path, target.origin), { method, agent: false, maxHeaderSize: 16384,
        headers: { accept: 'application/json', 'accept-encoding': 'identity', origin: target.origin,
          ...(target.token ? { 'x-merchant-availability-token': target.token } : {}),
          ...(body ? { 'content-type': 'application/json', 'content-length': String(body.length) } : {}) },
        // A localhost URL still connects directly to IPv4 loopback.
        lookup: (_host, options, callback) => options?.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4),
      }, response => {
        incoming = response;
        if (response.statusCode >= 300 && response.statusCode < 400) return problem('AVAILABILITY_CLI_REDIRECT', 'The operations service returned a redirect; use its original local URL.');
        if (String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json' ||
            !['', 'identity'].includes(String(response.headers['content-encoding'] ?? '').toLowerCase()))
          return problem('AVAILABILITY_CLI_RESPONSE', 'The operations service must return uncompressed JSON.');
        response.on('data', chunk => {
          if (settled) return; bytes += chunk.length;
          if (bytes > MAX_RESPONSE) return problem('AVAILABILITY_CLI_RESPONSE_SIZE', 'The operations response exceeded 1 MiB.');
          chunks.push(chunk);
        });
        response.once('aborted', () => problem('AVAILABILITY_CLI_RESPONSE', 'The operations response ended early; inspect status before another change.'));
        response.once('error', () => problem('AVAILABILITY_CLI_RESPONSE', 'The operations response failed; inspect status before another change.'));
        response.once('end', () => {
          if (settled) return;
          if (!response.complete) return problem('AVAILABILITY_CLI_RESPONSE', 'The operations response is incomplete.');
          try { finish(null, { status: response.statusCode, data: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }); }
          catch { problem('AVAILABILITY_CLI_RESPONSE', 'The operations service returned invalid JSON.'); }
        });
      });
      outgoing.once('error', () => problem('AVAILABILITY_CLI_CONNECTION', 'The local operations service could not be reached; inspect status before another change.'));
      outgoing.end(body ?? undefined);
    } catch { problem('AVAILABILITY_CLI_CONNECTION', 'The local operations request could not be sent.'); }
  });
}

function render(snapshot) {
  if (!snapshot.available) return 'Seller availability is not configured. Start the seller with --availability-dir and its operations service.\n';
  const lines = [`Availability revision ${snapshot.revision} | storage ${snapshot.storageState} | controls ${snapshot.controlsEnabled ? 'enabled' : 'disabled'}`,
    `Saved ${snapshot.savedAt}`, '', 'ROUTE  METHOD  PATH  STATE  IN FLIGHT'];
  for (const route of snapshot.routes) {
    lines.push(`${route.id}  ${route.method}  ${route.path}  ${route.state}  ${route.inFlight}`);
    if (route.reason) lines.push(`  Reason: ${route.reason}`);
  }
  if (snapshot.retiredPauses.length) {
    lines.push('', 'Retained pauses for routes absent from this service:');
    for (const route of snapshot.retiredPauses) lines.push(`${route.id}${route.reason ? '  ' + route.reason : ''}`);
  }
  lines.push('', `Use --revision ${snapshot.revision} only after reviewing these routes.`, '');
  return lines.join('\n');
}

/** Run against the real operations API. Returns an exit code; importing sends nothing. */
export async function runAvailabilityCLI(argv, { env = process.env, stdout = process.stdout, stderr = process.stderr, signal } = {}) {
  let options, target;
  const redact = text => target?.token ? text.split(target.token).join('[redacted]') : text;
  const print = value => stdout.write(redact(value));
  try {
    options = parseArguments(argv);
    if (options.help) { print(HELP); return 0; }
    target = connection(options, env);
    const payload = options.command === 'status' ? undefined : { expectedRevision: options.revision,
      action: options.command, routeIds: options.routeIds, ...(options.reason === undefined ? {} : { reason: options.reason }) };
    const response = await callService(target, payload ? '/api/availability/change' : '/api/availability',
      { method: payload ? 'POST' : 'GET', payload, timeoutMs: options.timeoutMs, signal });
    if (response.status === 409 && response.data?.error === 'AVAILABILITY_REVISION_CHANGED') {
      let current = null;
      try {
        const fresh = await callService(target, '/api/availability', { timeoutMs: options.timeoutMs, signal });
        if (fresh.status === 200) current = readSnapshot(fresh.data);
      } catch { /* A conflict remains a conflict when the explanatory read fails. */ }
      const error = { code: 'AVAILABILITY_REVISION_CHANGED', message: 'The reviewed revision changed. Inspect current status and issue a new explicit change with that revision.' };
      if (options.json) print(JSON.stringify({ error, current }, null, 2) + '\n');
      else { stderr.write(error.message + '\n'); if (current) print(render(current)); }
      return 3;
    }
    if (response.status !== 200) {
      const code = plain(response.data) && typeof response.data.error === 'string' && CODE.test(response.data.error) ? response.data.error : 'AVAILABILITY_CLI_PROVIDER_ERROR';
      fail(code, `The operations service rejected the request (HTTP ${response.status}); inspect status before another change.`,
        code === 'AVAILABILITY_NOT_CONFIGURED' ? 4 : 1);
    }
    const snapshot = readSnapshot(response.data);
    if (options.json) print(JSON.stringify(snapshot, null, 2) + '\n'); else print(render(snapshot));
    return snapshot.available ? 0 : 4;
  } catch (error) {
    const code = CODE.test(error?.code ?? '') ? error.code : 'AVAILABILITY_CLI_FAILURE';
    const message = error?.exitCode ? error.message : 'The availability command could not complete.';
    if (options?.json || argv?.includes('--json')) print(JSON.stringify({ error: { code, message } }) + '\n');
    else stderr.write(redact(`${code}: ${message}\n`));
    return Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  try { process.exitCode = await runAvailabilityCLI(process.argv.slice(2), { signal: controller.signal }); }
  finally { process.removeListener('SIGINT', interrupt); }
}
