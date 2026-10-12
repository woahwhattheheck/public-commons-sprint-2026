// MIT. World Bank source workspace over the original SF30/SF82/SF88 publisher.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { mkdir, realpath, open, readFile, link, unlink } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isAbsolute, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const MAX_JSON = 1024 * 1024;
const MAX_IMPORT = 256 * 1024 * 1024;
const MAX_OUTPUT = 64 * 1024 * 1024;
const MAX_DOWNLOAD = 256 * 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fault = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const publicError = error => ({
  ...(object(error?.sourceDetails) ? error.sourceDetails : {}),
  code: typeof error?.code === 'string' ? error.code : 'WORLDBANK_OPERATION_FAILED',
  message: error?.message || 'The World Bank workspace could not complete this action.',
  ...(error?.retryAt === undefined ? {} : { retryAt: error.retryAt })
});
const coreActions = new Set([
  'state', 'save-selection', 'catalog', 'capture', 'capture-detail', 'observations',
  'compare', 'review', 'review-read', 'export', 'export-read', 'import-pages', 'import-package'
]);
const publisherActions = new Set([
  'publisher.status', 'publisher.preview', 'publisher.reviewDraft', 'publisher.publish',
  'publisher.activateSnapshot', 'publisher.collect',
  'publisher.release.stage', 'publisher.release.inspect', 'publisher.release.activate',
  'publisher.release.rollback', 'publisher.release.start', 'publisher.release.stop',
  'publisher.buyer.review', 'publisher.buyer.prepare', 'publisher.buyer.session',
  'publisher.buyer.run', 'publisher.buyer.recover', 'publisher.buyer.account',
  'publisher.buyer.export'
]);
export const WORLDBANK_ACTIONS = Object.freeze([
  ...coreActions, 'capture-cancel', 'merchant-prepare', ...publisherActions
]);

function fields(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw fault('WORLDBANK_INPUT', 'Use an object containing the fields supported by this action.');
}
function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value) || value === '.' || value === '..')
    throw fault('WORLDBANK_ID', 'Choose a valid ' + label + ' identifier.');
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function same(left, right) { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }

async function stableBytes(path, maximum = MAX_DOWNLOAD) {
  if (await realpath(path) !== resolve(path))
    throw fault('WORLDBANK_EXPORT_PATH', 'Use the original retained export files.', 409);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum))
      throw fault('WORLDBANK_FILE_SIZE', 'The selected file exceeds its supported download size.', 413);
    const bytes = await file.readFile(), after = await file.stat({ bigint: true });
    if (BigInt(bytes.length) !== before.size || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ino !== after.ino || before.dev !== after.dev)
      throw fault('WORLDBANK_FILE_CHANGED', 'The retained export changed during this read.', 409);
    return bytes;
  } finally { await file.close(); }
}
async function writeImmutable(path, bytes) {
  // Publish only complete bytes. The existing destination is never overwritten.
  const temporary = path + '.stage-' + randomUUID();
  let created = false;
  try {
    const file = await open(temporary, 'wx', 0o600);
    created = true;
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!(await stableBytes(path, Math.max(MAX_JSON, bytes.length))).equals(bytes))
        throw fault('WORLDBANK_MERCHANT_CHANGED',
          'This export already has different merchant terms. Create a new export for changed terms.', 409);
    }
    const parent = await open(resolve(path, '..'), 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  } finally { if (created) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

/** The Python child owns source capture and retained pages; no source values are rewritten here. */
export async function openWorldBankOperator({ directory, python = process.env.PYTHON || 'python3' } = {}) {
  if (typeof directory !== 'string' || !directory.trim())
    throw fault('WORLDBANK_DIRECTORY', 'Choose a World Bank workspace directory.');
  if (typeof python !== 'string' || !python.trim())
    throw fault('WORLDBANK_PYTHON', 'Choose the existing Python 3 executable.');
  directory = resolve(directory);
  if (!isAbsolute(directory) || directory === '/')
    throw fault('WORLDBANK_DIRECTORY', 'Choose a dedicated workspace directory.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (await realpath(directory) !== directory)
    throw fault('WORLDBANK_DIRECTORY', 'Use a canonical workspace directory.');
  let publisher, openingPublisher, closing = false, closePromise;
  let prepareTail = Promise.resolve();
  const jobs = new Map(), children = new Set(), operations = new Set();
  const now = () => new Date().toISOString();
  const track = operation => {
    if (closing) return Promise.reject(fault('WORLDBANK_CLOSING', 'The workspace is closing.', 409));
    const pending = Promise.resolve().then(operation);
    operations.add(pending);
    pending.then(() => operations.delete(pending), () => operations.delete(pending));
    return pending;
  };

  function launchCore(action, payload = {}) {
    if (!coreActions.has(action) || !object(payload))
      throw fault('WORLDBANK_ACTION', 'Choose a supported World Bank action and object payload.');
    const input = json(payload);
    const inputLimit = ['import-pages', 'import-package'].includes(action) ? MAX_IMPORT : MAX_JSON;
    if (input.length > inputLimit) throw fault('WORLDBANK_INPUT_SIZE',
      'The action exceeds its input capacity of ' + inputLimit + ' bytes.', 413);
    const child = spawn(python, ['-B', join(ROOT, 'core.py'), '--workspace', directory, '--action', action],
      { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    children.add(child);
    let stdout = [], stdoutSize = 0, stderr = [], stderrSize = 0, failure;
    const completion = new Promise((accept, reject) => {
      child.once('error', error => {
        failure = fault('WORLDBANK_PYTHON_UNAVAILABLE', 'Python could not start: ' + error.message, 503);
      });
      child.stdin.on('error', error => { if (error.code !== 'EPIPE') failure = error; });
      child.stdout.on('data', bytes => {
        stdoutSize += bytes.length;
        if (stdoutSize > MAX_OUTPUT) {
          failure ??= fault('WORLDBANK_OUTPUT_SIZE', 'Use a smaller observation page for this response.', 413);
          child.kill('SIGTERM');
        } else stdout.push(bytes);
      });
      child.stderr.on('data', bytes => {
        if (stderrSize < 32768) { stderr.push(bytes.subarray(0, 32768 - stderrSize)); stderrSize += bytes.length; }
      });
      child.once('close', (code, signal) => {
        children.delete(child);
        if (failure) { reject(failure); return; }
        let value;
        const raw = Buffer.concat(stdout);
        try { value = raw.length ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) : null; }
        catch { reject(fault('WORLDBANK_CORE_RESPONSE', 'The source engine returned an unreadable response.', 502)); return; }
        if (code !== 0 || value?.error) {
          const detail = object(value?.error) ? value.error : {};
          const error = fault(typeof detail.code === 'string' ? detail.code :
            signal === 'SIGTERM' ? 'WORLDBANK_CAPTURE_CANCELLED' : 'WORLDBANK_CORE_FAILED',
          detail.message || (signal === 'SIGTERM' ? 'Capture stopped; retained pages are available to resume.' :
            Buffer.concat(stderr).toString('utf8').trim() || 'The source engine did not complete this action.'),
          Number.isInteger(detail.status) ? detail.status : signal === 'SIGTERM' ? 409 : 400);
          Object.assign(error, detail);
          error.sourceDetails = structuredClone(detail);
          error.exitCode = code; error.signal = signal;
          reject(error); return;
        }
        if (!object(value) && !Array.isArray(value)) {
          reject(fault('WORLDBANK_CORE_RESPONSE', 'The source engine returned no result.', 502)); return;
        }
        accept(value);
      });
      child.stdin.end(input);
    });
    return { child, completion };
  }
  const core = (action, payload) => launchCore(action, payload).completion;
  const jobView = job => ({
    id: job.id, action: 'capture', selectionId: job.payload.selectionId,
    attempt: job.attempt, status: job.status, startedAt: job.startedAt,
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    ...(job.result === undefined ? {} : { result: object(job.result)
      ? Object.fromEntries(Object.entries(job.result).filter(([key]) => key !== 'pages')) : job.result }),
    ...(job.error ? { error: job.error } : {})
  });
  const view = async () => ({
    ...await core('state', {}),
    publisher: publisher ? await publisher.state() : null,
    jobs: [...jobs.values()].map(jobView)
  });
  const refresh = async result => {
    try { return { result, state: await view() }; }
    catch (error) {
      // Preserve the completed operation if its independent state read fails.
      return { result, state: null, stateError: publicError(error) };
    }
  };
  const getPublisher = async () => {
    if (publisher) return publisher;
    if (!openingPublisher) openingPublisher = import('../socrata/publisher.mjs')
      .then(({ openSocrataPublisher }) => openSocrataPublisher({ directory: join(directory, 'publisher') }))
      .then(value => { publisher = value; return value; })
      .catch(error => { openingPublisher = undefined; throw error; });
    return openingPublisher;
  };

  function capture(payload) {
    fields(payload, ['id', 'selectionId']);
    const id = identifier(payload.id, 'capture');
    identifier(payload.selectionId, 'selection');
    const previous = jobs.get(id);
    if (previous && !same(previous.payload, payload))
      throw fault('WORLDBANK_CAPTURE_ID_USED', 'This capture identifier belongs to another selection.', 409);
    if (previous && ['RUNNING', 'CANCELLING', 'COMPLETE'].includes(previous.status)) return jobView(previous);
    const launched = launchCore('capture', payload);
    const job = { id, payload: structuredClone(payload), child: launched.child, completion: launched.completion,
      attempt: (previous?.attempt ?? 0) + 1, status: 'RUNNING', startedAt: now() };
    jobs.set(id, job);
    job.settled = launched.completion.then(result => {
      job.result = result;
      job.status = result?.status === 'CANCELLED' ? 'CANCELLED' : 'COMPLETE';
      job.finishedAt = now(); job.child = null; return jobView(job);
    }, error => {
      job.error = publicError(error); job.finishedAt = now();
      job.status = job.status === 'CANCELLING' || error.code === 'WORLDBANK_CAPTURE_CANCELLED' ? 'CANCELLED' : 'FAILED';
      job.child = null; return jobView(job);
    });
    return jobView(job);
  }
  function cancel(payload) {
    fields(payload, ['id']);
    const id = identifier(payload.id, 'capture'), job = jobs.get(id);
    if (!job) throw fault('WORLDBANK_CAPTURE_NOT_OWNED', 'This process has no running capture with that identifier. Reopen its retained capture to resume it.', 409);
    if (job.child && job.status === 'RUNNING') {
      job.status = 'CANCELLING';
      if (!job.child.kill('SIGTERM')) throw fault('WORLDBANK_CANCEL_FAILED', 'The capture process could not receive its stop signal. Refresh its current state.', 409);
    }
    return jobView(job);
  }
  async function prepareMerchant(payload) {
    fields(payload, ['exportId', 'origin', 'path', 'payment']);
    identifier(payload.exportId, 'export');
    if (typeof payload.origin !== 'string' || typeof payload.path !== 'string' || !object(payload.payment))
      throw fault('WORLDBANK_MERCHANT_TERMS', 'Supply the public origin, route path and exact payment terms.');
    const retained = await core('export-read', { id: payload.exportId });
    const exportDirectory = resolve(retained.directory ?? '');
    if (exportDirectory !== join(directory, 'exports', payload.exportId))
      throw fault('WORLDBANK_EXPORT_DIRECTORY', 'The source engine returned an unexpected export directory.', 409);
    if (await realpath(exportDirectory) !== exportDirectory)
      throw fault('WORLDBANK_EXPORT_DIRECTORY', 'Use the original canonical export directory.', 409);
    const { loadDatasetConfig } = await import('../dataset-handler.mjs');
    const { buildDatasetSellerConfig } = await import('../dataset-cli.mjs');
    const dataset = await loadDatasetConfig(join(exportDirectory, 'dataset.json'));
    const config = await buildDatasetSellerConfig(dataset,
      { origin: payload.origin, path: payload.path, payment: payload.payment });
    const sellerBytes = json(config);
    await writeImmutable(join(exportDirectory, 'seller.json'), sellerBytes);
    // Re-read the core's immutable closure after preparing its adjacent merchant file.
    const checked = await core('export-read', { id: payload.exportId });
    if (!same(retained.manifest, checked.manifest))
      throw fault('WORLDBANK_EXPORT_CHANGED', 'The reviewed source export changed during merchant preparation.', 409);
    const model = await getPublisher();
    const prepared = await model.act('publisher.prepare', { exportDirectory });
    const binding = {
      schema: 'stellar-forge.worldbank-merchant-binding.v1', exportId: payload.exportId,
      exportDirectory, manifest: checked.manifest,
      seller: { path: 'seller.json', bytes: sellerBytes.length, sha256: sha(sellerBytes) },
      publisherDirectory: model.directory, packageDirectory: prepared.result.packageDirectory
    };
    const bindingDirectory = join(directory, 'merchant-bindings');
    await mkdir(bindingDirectory, { recursive: true, mode: 0o700 });
    if (await realpath(bindingDirectory) !== bindingDirectory)
      throw fault('WORLDBANK_BINDING_DIRECTORY', 'Use the canonical merchant binding directory.', 409);
    const bindingFile = join(bindingDirectory, sha(Buffer.from(payload.exportId)) + '.json');
    await writeImmutable(bindingFile, json(binding));
    return { ...prepared.result, exportId: payload.exportId, bindingFile, binding };
  }
  async function dispatch(action, payload) {
    if (action === 'capture') return capture(payload);
    if (action === 'capture-cancel') return cancel(payload);
    if (action === 'merchant-prepare') {
      const pending = prepareTail.catch(() => {}).then(() => prepareMerchant(payload));
      prepareTail = pending; return pending;
    }
    if (publisherActions.has(action)) return (await (await getPublisher()).act(action, payload)).result;
    if (coreActions.has(action)) return core(action, payload);
    throw fault('WORLDBANK_ACTION', 'Choose a supported World Bank or publisher action.');
  }

  async function exportFile(exportId, filename) {
    identifier(exportId, 'export');
    if (typeof filename !== 'string' || filename.includes('\\') || filename.includes('\0') ||
        filename.split('/').some(part => !part || part === '.' || part === '..'))
      throw fault('WORLDBANK_EXPORT_FILE', 'Choose an original file listed by this export.');
    const retained = await core('export-read', { id: exportId });
    const entry = retained.manifest?.files?.find(file => file.path === filename);
    if (!entry || !Number.isSafeInteger(entry.bytes) || !/^[a-f0-9]{64}$/.test(entry.sha256))
      throw fault('WORLDBANK_EXPORT_FILE', 'This file is not in the reviewed export manifest.', 404);
    const exportDirectory = resolve(retained.directory ?? '');
    if (exportDirectory !== join(directory, 'exports', exportId))
      throw fault('WORLDBANK_EXPORT_DIRECTORY', 'The source engine returned an unexpected export directory.', 409);
    const bytes = await stableBytes(join(exportDirectory, filename));
    if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256)
      throw fault('WORLDBANK_EXPORT_CHANGED', 'This file differs from its retained export manifest.', 409);
    const contentType = filename.endsWith('.csv') ? 'text/csv; charset=utf-8' :
      filename.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream';
    return { bytes, filename: filename.split('/').at(-1), contentType };
  }
  return {
    directory,
    state: () => track(view),
    act: (action, payload = {}) => track(async () => {
      if (!WORLDBANK_ACTIONS.includes(action) || !object(payload))
        throw fault('WORLDBANK_ACTION', 'Choose a supported action and an object payload.');
      return refresh(await dispatch(action, payload));
    }),
    waitCapture: id => track(async () => {
      const job = jobs.get(identifier(id, 'capture'));
      if (!job) throw fault('WORLDBANK_CAPTURE_NOT_OWNED', 'This capture has no execution in this process.', 409);
      return job.settled;
    }),
    readExport: (id, filename) => track(() => exportFile(id, filename)),
    readPublisherExport: (kind, id) => track(async () => (await getPublisher()).readExport(kind, id)),
    close() {
      if (!closePromise) {
        closing = true;
        closePromise = (async () => {
          // Let already accepted action callbacks register their owned capture.
          await Promise.resolve();
          for (const job of jobs.values()) if (job.child && job.status === 'RUNNING') {
            job.status = 'CANCELLING'; job.child.kill('SIGTERM');
          }
          await Promise.allSettled([...operations, ...jobs.values()].map(value => value?.settled ?? value));
          if (openingPublisher) await openingPublisher.catch(() => {});
          if (publisher) await publisher.close();
        })();
      }
      return closePromise;
    }
  };
}

const headers = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
};
async function requestJson(request) {
  if ((request.headers['content-type'] ?? '').split(';', 1)[0].trim() !== 'application/json')
    throw fault('WORLDBANK_JSON_REQUIRED', 'Send Content-Type application/json.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_IMPORT) throw fault('WORLDBANK_INPUT_SIZE', 'The request exceeds 256 MiB.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw fault('WORLDBANK_INVALID_JSON', 'Send a valid UTF-8 JSON object.'); }
}

/** The private loopback session owns its capture children and original release process. */
export async function startWorldBankWorkspace({ directory, python, port = 0, operator: supplied } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw fault('WORLDBANK_PORT', 'Choose a port from 0 to 65535.');
  const ownsOperator = supplied === undefined;
  const operator = supplied ?? await openWorldBankOperator({ directory, python });
  if (!operator || ['state', 'act', 'readExport', 'readPublisherExport', 'close'].some(name => typeof operator[name] !== 'function'))
    throw fault('WORLDBANK_OPERATOR', 'Supply an original World Bank operator.');
  let assets;
  try {
    assets = new Map(await Promise.all([
      ['/', 'index.html', 'text/html; charset=utf-8'],
      ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
      ['/style.css', 'style.css', 'text/css; charset=utf-8']
    ].map(async ([route, name, type]) => [route, { bytes: await readFile(join(ROOT, 'ui', name)), type }])));
  } catch (error) { if (ownsOperator) await operator.close().catch(() => {}); throw error; }
  const token = randomBytes(32).toString('base64url'), expected = Buffer.from('Bearer ' + token);
  let origin, closing;
  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 30000, headersTimeout: 15000, keepAliveTimeout: 1000 },
    async (request, response) => {
      const reply = (status, value, type = 'application/json; charset=utf-8') => {
        if (response.destroyed) return;
        response.writeHead(status, { ...headers, 'content-type': type });
        response.end(type.startsWith('application/json') && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);
      };
      try {
        if (request.headers.host !== new URL(origin).host ||
            request.headers.origin && request.headers.origin !== origin ||
            request.headers['sec-fetch-site'] === 'cross-site')
          throw fault('WORLDBANK_LOCAL_ORIGIN', 'Open the printed local workspace URL.', 403);
        if (request.method === 'GET' && assets.has(request.url)) {
          const asset = assets.get(request.url); reply(200, asset.bytes, asset.type); return;
        }
        if (request.method === 'GET' && request.url === '/favicon.ico') { reply(204, ''); return; }
        const suppliedToken = Buffer.from(request.headers.authorization ?? '');
        if (suppliedToken.length !== expected.length || !timingSafeEqual(suppliedToken, expected))
          throw fault('WORLDBANK_SESSION_REQUIRED', 'Reopen the session URL printed by the workspace command.', 401);
        if (request.method === 'GET' && request.url === '/api/state') { reply(200, await operator.state()); return; }
        const download = /^\/api\/exports\/([^/?]+)\/([^?]+)$/.exec(request.url ?? '');
        const publisherDownload = /^\/api\/publisher\/exports\/([^/?]+)\/([^/?]+)$/.exec(request.url ?? '');
        if (request.method === 'GET' && (download || publisherDownload)) {
          const match = download || publisherDownload;
          let first, second;
          try { first = decodeURIComponent(match[1]); second = decodeURIComponent(match[2]); }
          catch { throw fault('WORLDBANK_DOWNLOAD', 'Choose a valid download identifier.'); }
          const file = download ? await operator.readExport(first, second) : await operator.readPublisherExport(first, second);
          response.writeHead(200, { ...headers, 'content-type': file.contentType || 'application/octet-stream',
            'content-length': file.bytes.length,
            'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(file.filename).replaceAll("'", '%27') });
          response.end(file.bytes); return;
        }
        if (request.url !== '/api/action') throw fault('WORLDBANK_NOT_FOUND', 'This workspace route is unavailable.', 404);
        if (request.method !== 'POST') throw fault('WORLDBANK_POST_REQUIRED', 'Use POST for a workspace action.', 405);
        const input = await requestJson(request);
        fields(input, ['action', 'payload']);
        if (!WORLDBANK_ACTIONS.includes(input.action) || !object(input.payload ?? {}))
          throw fault('WORLDBANK_ACTION', 'Choose a supported action and object payload.');
        // An accepted operation survives browser navigation or a closed request.
        reply(200, await operator.act(input.action, input.payload ?? {}));
      } catch (error) {
        if (response.headersSent || response.destroyed) { if (!response.writableEnded) response.end(); return; }
        const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status :
          error instanceof TypeError || error instanceof SyntaxError ? 400 : 500;
        reply(status, { error: publicError(error) });
      }
    });
  server.maxRequestsPerSocket = 100;
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  try {
    await new Promise((accept, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.off('error', reject); accept(); });
    });
    origin = 'http://127.0.0.1:' + server.address().port;
  } catch (error) { if (ownsOperator) await operator.close().catch(() => {}); throw error; }
  return {
    origin, url: origin + '/#' + token, token, operator,
    close() {
      if (!closing) closing = (async () => {
        const stopped = new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
        server.closeIdleConnections?.();
        let failure;
        if (ownsOperator) try { await operator.close(); } catch (error) { failure = error; }
        try { await stopped; } catch (error) { failure ??= error; }
        if (failure) throw failure;
      })();
      return closing;
    }
  };
}

