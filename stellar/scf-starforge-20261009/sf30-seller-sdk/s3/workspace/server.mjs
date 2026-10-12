// MIT. Local browser transport for the original S3 merchant authoring controller.
import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { readFile, open } from 'node:fs/promises';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openS3MerchantWorkspace } from './controller.mjs';
import { S3WorkspaceError } from './store.mjs';

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
async function jsonBody(req) {
  if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json') throw new S3WorkspaceError('JSON_REQUIRED', 415);
  const chunks = []; let count = 0;
  for await (const chunk of req) { count += chunk.length; if (count > 2 * 1024 * 1024) throw new S3WorkspaceError('REQUEST_TOO_LARGE', 413); chunks.push(chunk); }
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new S3WorkspaceError('INVALID_JSON', 400); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new S3WorkspaceError('JSON_OBJECT_REQUIRED', 400);
  return value;
}
const POST = {
  '/api/save': ['save', ['expectedRevision', 'operationId', 'source', 'payment', 'origin']],
  '/api/review': ['review', ['revision', 'operationId']],
  '/api/prepare': ['prepare', ['revision', 'reviewId', 'operationId']],
  '/api/stage': ['stage', ['packageId', 'releaseId', 'operationId', 'runtime']],
  '/api/console': ['openReleaseConsole', []],
};
export async function startS3MerchantWorkspace({ port = 0, releaseConsolePort, ...options } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 ||
      releaseConsolePort !== undefined && (!Number.isInteger(releaseConsolePort) || releaseConsolePort < 0 || releaseConsolePort > 65535))
    throw new S3WorkspaceError('INVALID_PORT');
  if (port && port === releaseConsolePort) throw new S3WorkspaceError('WORKSPACE_PORT_CONFLICT');
  const controller = await openS3MerchantWorkspace(options);
  const token = randomBytes(32).toString('hex'), tokenBytes = Buffer.from(token);
  const assets = new Map();
  try {
    for (const [path, filename, type] of [['/', 'index.html', 'text/html; charset=utf-8'],
      ['/browser.mjs', 'browser.mjs', 'text/javascript; charset=utf-8'], ['/style.css', 'style.css', 'text/css; charset=utf-8']])
      assets.set(path, { bytes: await readFile(new URL(filename, import.meta.url)), type });
  } catch (error) { await controller.close(); throw error; }
  let origin, host, closing, shuttingDown = false;
  const server = createServer(async (req, res) => {
    const reply = (code, value, type = 'application/json; charset=utf-8') => {
      if (res.destroyed) return;
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
      res.writeHead(code, { 'content-type': type, 'content-length': String(bytes.length),
        'cache-control': 'no-store', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    try {
      if (req.headers.host !== host || req.headers.origin && req.headers.origin !== origin ||
          ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) throw new S3WorkspaceError('LOCAL_ORIGIN_REQUIRED', 403);
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw new S3WorkspaceError('INVALID_TARGET', 400);
      const target = new URL(req.url, origin);
      if (['GET', 'HEAD'].includes(req.method) && !target.search && assets.has(target.pathname)) {
        const asset = assets.get(target.pathname); reply(200, asset.bytes, asset.type); return;
      }
      const supplied = Buffer.from(req.headers['x-s3-workspace-token'] ?? '');
      if (supplied.length !== tokenBytes.length || !timingSafeEqual(supplied, tokenBytes)) throw new S3WorkspaceError('WORKSPACE_TOKEN_REQUIRED', 401);
      if (shuttingDown) throw new S3WorkspaceError('WORKSPACE_CLOSING', 409);
      if (req.method === 'POST' && POST[target.pathname] && !target.search) {
        if (req.headers.origin !== origin) throw new S3WorkspaceError('SAME_ORIGIN_ACTION_REQUIRED', 403);
        const [method, keys] = POST[target.pathname], body = await jsonBody(req);
        if (Object.keys(body).some(key => !keys.includes(key))) throw new S3WorkspaceError('UNKNOWN_ACTION_FIELD', 400);
        reply(200, await controller[method](body)); return;
      }
      if (req.method !== 'GET') throw new S3WorkspaceError('ACTION_NOT_FOUND', 404);
      const query = Object.fromEntries(target.searchParams);
      if (Object.keys(query).length !== [...target.searchParams].length) throw new S3WorkspaceError('DUPLICATE_PARAMETER', 400);
      const routes = {
        '/api/status': ['status', []], '/api/history': ['history', ['beforeRevision', 'limit']],
        '/api/revision': ['revision', ['revision']], '/api/review': ['getReview', ['reviewId']],
        '/api/package': ['getPackage', ['packageId']], '/api/customer': ['exportCustomer', ['releaseId']],
        '/api/customer/file': ['readCustomerFile', ['releaseId', 'file', 'offset', 'limit', 'expectedSha256']],
      };
      const route = routes[target.pathname];
      if (!route || Object.keys(query).some(key => !route[1].includes(key))) throw new S3WorkspaceError('ACTION_NOT_FOUND', 404);
      for (const key of ['revision', 'beforeRevision', 'limit', 'offset']) if (query[key] !== undefined) {
        if (!/^(0|[1-9][0-9]*)$/.test(query[key]) || !Number.isSafeInteger(Number(query[key]))) throw new S3WorkspaceError('INVALID_NUMBER', 400);
        query[key] = Number(query[key]);
      }
      reply(200, await controller[route[0]](query));
    } catch (error) {
      reply(error.status ?? (['RELEASE_CONFLICT', 'RELEASE_BUSY', 'EEXIST'].includes(error.code) ? 409 : 422),
        { error: error.code ?? 'S3_WORKSPACE_ERROR', message: error.message });
    }
  });
  server.requestTimeout = 150000; server.headersTimeout = 10000; server.keepAliveTimeout = 2000;
  try { await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); }); }
  catch (error) { await controller.close(); throw error; }
  origin = new URL('http://127.0.0.1:' + server.address().port).origin; host = new URL(origin).host;
  const close = () => closing ??= (async () => {
    shuttingDown = true;
    try { await controller.close(); }
    finally { await new Promise((done, fail) => { server.close(error => error ? fail(error) : done()); server.closeIdleConnections?.(); }); }
  })();
  let releaseConsole = null;
  try {
    if (releaseConsolePort !== undefined)
      releaseConsole = await controller.openReleaseConsole({ port: releaseConsolePort });
  } catch (error) { await close(); throw error; }
  return { controller, server, origin, url: origin + '/#' + token, token, releaseConsole, close };
}

const HELP = `S3 merchant workspace
  node server.mjs --state PRIVATE_DIRECTORY [--port 0] [--release-store EXISTING_OR_NEW_STORE]
    [--source PRIVATE_SOURCE.json --payment PUBLIC_TERMS.json --origin HTTPS_ORIGIN]
    [--release-console-port 0] [--expected-workspace-id new|ORIGINAL_UUID]
    [--expected-source-sha256 SHA256 --expected-payment-sha256 SHA256]

Source/payment/origin import the first revision only. Reopen the same --state
without the original files. The original AWS provider stays in this process.
The printed private local URL opens source, product, price and release authoring.
--release-console-port also opens the original release console in this same
managed session; stopping the workspace drains that console and its owned seller.
`;
async function importFile(path, expectedSha256) {
  const filename = resolve(path);
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > 1048576n) throw new S3WorkspaceError('IMPORT_TOO_LARGE');
    bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (BigInt(bytes.length) !== before.size || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
      throw new S3WorkspaceError('IMPORT_CHANGED', 409);
  } finally { await handle.close(); }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expectedSha256 !== undefined && expectedSha256 !== sha256)
    throw new S3WorkspaceError('IMPORT_CHANGED', 409, 'The original import file changed after review.');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new S3WorkspaceError('IMPORT_JSON_REQUIRED'); }
  return { path: filename, sha256, value };
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['--help', '-h'].includes(args[0])) { process.stdout.write(HELP); return; }
  const flags = {}, known = ['--state', '--port', '--release-store', '--source', '--payment', '--origin',
    '--release-console-port', '--expected-workspace-id', '--expected-source-sha256', '--expected-payment-sha256'];
  for (let index = 0; index < args.length; index += 2) {
    const [key, value] = args.slice(index, index + 2);
    if (!known.includes(key) || !value || value.startsWith('--') || Object.hasOwn(flags, key)) throw new S3WorkspaceError('INVALID_OPTIONS', 400, HELP);
    flags[key] = value;
  }
  if (!flags['--state']) throw new S3WorkspaceError('STATE_REQUIRED', 400, HELP);
  const importCount = ['--source', '--payment', '--origin'].filter(key => flags[key]).length;
  if (importCount !== 0 && importCount !== 3) throw new S3WorkspaceError('COMPLETE_IMPORT_REQUIRED', 400, HELP);
  for (const key of ['--expected-source-sha256', '--expected-payment-sha256'])
    if (flags[key] !== undefined && (importCount !== 3 || !/^[a-f0-9]{64}$/.test(flags[key])))
      throw new S3WorkspaceError('EXPECTED_IMPORT_HASH_INVALID');
  const port = key => {
    if (flags[key] === undefined) return undefined;
    if (!/^(0|[1-9][0-9]*)$/.test(flags[key])) throw new S3WorkspaceError('INVALID_PORT');
    const value = Number(flags[key]);
    if (!Number.isSafeInteger(value) || value > 65535) throw new S3WorkspaceError('INVALID_PORT');
    return value;
  };
  let source, payment;
  if (importCount) [source, payment] = await Promise.all([
    importFile(flags['--source'], flags['--expected-source-sha256']),
    importFile(flags['--payment'], flags['--expected-payment-sha256']),
  ]);
  const session = await startS3MerchantWorkspace({ directory: resolve(flags['--state']),
    ...(flags['--release-store'] ? { releaseStore: resolve(flags['--release-store']) } : {}),
    port: port('--port') ?? 0, releaseConsolePort: port('--release-console-port'),
    expectedWorkspaceId: flags['--expected-workspace-id'],
    ...(importCount ? { initial: { source: source.value, payment: payment.value, origin: flags['--origin'] } } : {}) });
  const stop = () => { void session.close().then(() => { process.exitCode = 0; }, error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
  process.stdout.write(JSON.stringify({
    schema: 'stellar-forge.s3-workspace-startup.v1', status: 'S3_MERCHANT_WORKSPACE_READY',
    workspace: session.url, directory: session.controller.directory, workspaceId: session.controller.workspaceId,
    releaseStore: session.controller.releaseStore, releaseConsole: session.releaseConsole,
    initial: importCount ? { sourceFile: source.path, sourceSha256: source.sha256,
      paymentFile: payment.path, paymentSha256: payment.sha256, origin: flags['--origin'] } : null,
  }) + '\n');
  return session;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
