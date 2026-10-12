// MIT. Complete customer access to the same original private Utility operator.
import { request as httpRequest } from 'node:http';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, link, unlink } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';

const APPLICATION = 'stellar-forge.utility-workspace.v1';
const LAUNCH = 'stellar-forge.utility-workspace-launch.v1';
const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_SOURCE = 256 * 1024 * 1024, MAX_FILE = 2 * 1024 * 1024 * 1024;
const MAX_JSON = 32 * 1024 * 1024, MAX_REQUEST = 16 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const stamp = info => [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
function expect(value, message) { if (!value) throw fail('UTILITY_INVALID_INPUT', message); }
function selection(value, label, pattern = SHA) {
  expect(typeof value === 'string' && pattern.test(value), 'Select the original ' + label + '.'); return value;
}
function queryString(query = {}) {
  expect(object(query), 'Use an object of original query parameters.');
  return new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null)).toString();
}
async function originalFile(path, maximum, privateOnly = false) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat({ bigint: true });
    expect(info.isFile() && info.size <= BigInt(maximum), 'Select an original regular file within its receiving capacity.');
    if (privateOnly) expect(info.nlink === 1n && (process.platform === 'win32' ||
      (info.uid === BigInt(process.getuid()) && (info.mode & 0o077n) === 0n)),
    'Select the private connection file written by the existing Utility console.');
    return { handle, info };
  } catch (error) { await handle.close(); throw error; }
}
async function privateConnection(path) {
  const { handle, info } = await originalFile(resolve(path), 4096, true);
  try {
    const bytes = await handle.readFile();
    expect(stamp(await handle.stat({ bigint: true })) === stamp(info) && bytes.length <= 4096,
      'The original connection file changed during attachment.');
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim(), url = new URL(raw);
    expect(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password &&
      url.pathname === '/' && !url.search && url.port && /^[A-Za-z0-9_-]{40,100}$/.test(url.hash.slice(1)),
    'Use the original loopback Utility connection.');
    return { origin: url.origin, token: url.hash.slice(1) };
  } finally { await handle.close(); }
}
async function responseBytes(response, maximum) {
  const declared = response.headers['content-length'];
  if (declared !== undefined) expect(/^\d+$/.test(declared) && Number(declared) <= maximum,
    'The original response exceeds its declared receiving capacity.');
  let length = 0; const chunks = [];
  for await (const block of response) {
    length += block.length;
    expect(length <= maximum, 'The original response exceeds its receiving capacity.');
    chunks.push(block);
  }
  expect(declared === undefined || length === Number(declared), 'The original response ended before its declared length.');
  return Buffer.concat(chunks, length);
}
function attachmentName(headers, fallback) {
  const value = headers['content-disposition'] || '';
  let name = /filename="([^"]+)"/i.exec(value)?.[1];
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) { try { name = decodeURIComponent(encoded); } catch {} }
  return typeof name === 'string' && name && !/[\\/\x00-\x1f\x7f]/.test(name) ? name : fallback;
}

/** The client borrows the listener. close() drains this client's requests only. */
export async function openUtilityWorkspace({ connectionFile, expectedBindingSha256, expectedWorkspace } = {}) {
  expect(typeof connectionFile === 'string', 'Choose the original private Utility connection file.');
  if (expectedBindingSha256 !== undefined) selection(expectedBindingSha256, 'managed binding SHA256');
  if (expectedWorkspace !== undefined) expect(typeof expectedWorkspace === 'string' && resolve(expectedWorkspace) === expectedWorkspace,
    'Choose the original absolute workspace directory.');
  const connection = await privateConnection(connectionFile);
  let closing = false, closingPromise, bound = null;
  const pending = new Set();
  const own = work => {
    if (closing) return Promise.reject(fail('UTILITY_CLIENT_CLOSING', 'This Utility client is closing.'));
    const task = Promise.resolve().then(work); pending.add(task);
    return task.finally(() => pending.delete(task));
  };
  const send = (route, { method = 'GET', body, headers = {}, timeout = 180000, requestId } = {}, consume) => {
    expect(typeof route === 'string' && route.startsWith('/api/') && !/[\r\n#]/.test(route),
      'Select an original Utility API route.');
    return new Promise((yes, no) => {
      let response;
      const request = httpRequest(connection.origin + route, { method, agent: false,
        headers: { Authorization: 'Bearer ' + connection.token, Origin: connection.origin, ...headers },
        signal: AbortSignal.timeout(timeout) }, incoming => {
        response = incoming;
        Promise.resolve().then(async () => {
          if (incoming.statusCode < 200 || incoming.statusCode > 299) {
            const raw = await responseBytes(incoming, 65536);
            let detail = raw.toString('utf8'); try { detail = JSON.parse(detail).error || detail; } catch {}
            throw fail('UTILITY_OPERATOR_REJECTED', 'Utility operator ' + incoming.statusCode + ': ' +
              String(detail).split(connection.token).join('[private capability]').slice(0, 4000),
            { status: incoming.statusCode, ...(requestId ? { requestId } : {}) });
          }
          return consume(incoming);
        }).then(yes, error => {
          if (requestId && error.code !== 'UTILITY_OPERATOR_REJECTED')
            no(fail('UTILITY_OPERATION_INTERRUPTED',
              'The original Utility action response was incomplete. Read its saved operation using the same requestId.',
              { requestId, uncertain: true, cause: error }));
          else no(error);
        }).finally(() => incoming.destroy());
      });
      request.on('error', error => {
        response?.destroy(); body?.destroy?.();
        no(fail(requestId ? 'UTILITY_OPERATION_INTERRUPTED' : 'UTILITY_READ_INTERRUPTED',
          'The original Utility request ended before a complete response. ' +
          (requestId ? 'Read its saved operation using the same requestId.' : 'Reopen the same retained selection.'),
          { ...(requestId ? { requestId, uncertain: true } : {}), cause: error }));
      });
      if (body && typeof body.pipe === 'function') {
        body.once('error', error => request.destroy(error)); body.pipe(request);
      } else request.end(body);
    });
  };
  const read = async (route, query = {}) => {
    const suffix = queryString(query);
    return send(route + (suffix ? '?' + suffix : ''), {}, async response =>
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await responseBytes(response, MAX_JSON))));
  };
  const launch = async () => {
    const value = await read('/api/launch');
    expect(value.schema === LAUNCH && value.status === 'UTILITY_WORKSPACE_READY' &&
      value.applicationSchema === APPLICATION && SHA.test(value.bindingSha256 || '') &&
      object(value.workspaceIdentity) && typeof value.workspace === 'string',
    'The selected console is not the original managed Utility workspace.');
    expect(expectedBindingSha256 === undefined || value.bindingSha256 === expectedBindingSha256,
      'The running Utility binding differs from the reviewed original binding.');
    expect(expectedWorkspace === undefined || value.workspace === expectedWorkspace,
      'The running Utility workspace differs from the selected directory.');
    const identity = JSON.stringify({ workspace: value.workspace, identity: value.workspaceIdentity,
      binding: value.bindingSha256 });
    expect(bound === null || bound === identity, 'The original Utility workspace identity changed during this client.');
    bound = identity; return value;
  };
  const state = async () => {
    await launch(); const value = await read('/api/state');
    expect(value.schema === 'stellar-forge.ndjson-workspace.v1' && value.applicationSchema === APPLICATION &&
      Number.isSafeInteger(value.revision) && value.revision >= 0, 'The original Utility state changed format.');
    return value;
  };
  const action = async (name, payload = {}, options = {}) => {
    expect(typeof name === 'string' && object(payload) && object(options), 'Supply an original named action and complete object payload.');
    const expectedRevision = options.expectedRevision ?? (await state()).revision;
    expect(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'Use the current original Utility revision.');
    const requestId = selection(options.requestId ?? randomUUID(), 'operation UUID', UUID);
    await launch();
    const body = Buffer.from(JSON.stringify({ action: name, payload, expected_revision: expectedRevision, request_id: requestId }));
    expect(body.length <= MAX_REQUEST, 'The original Utility action exceeds 16 MiB.');
    return send('/api/action', { method: 'POST', body, requestId,
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length) } },
    async response => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await responseBytes(response, MAX_JSON))));
  };
  const upload = async ({ file, provider = 'auto', kind = 'auto', name, context = {}, restore = false,
    expectedRevision, requestId = randomUUID(), expectedSha256 } = {}) => {
    expect(typeof file === 'string' && object(context), 'Choose the original file and source context.');
    selection(requestId, 'operation UUID', UUID);
    if (expectedSha256 !== undefined) selection(expectedSha256, 'reviewed input SHA256');
    expect(['auto','utilityapi','greenbutton'].includes(provider), 'Choose the original source provider.');
    const filename = resolve(file), { handle, info } = await originalFile(filename, restore ? MAX_FILE : MAX_SOURCE);
    let stream;
    try {
      if (expectedSha256) {
        const h = createHash('sha256');
        for await (const block of handle.createReadStream({ start: 0, autoClose: false })) h.update(block);
        expect(h.digest('hex') === expectedSha256 && stamp(await handle.stat({ bigint: true })) === stamp(info),
          'The reviewed original input changed before receiving.');
      }
      const revision = expectedRevision ?? (await state()).revision;
      expect(Number.isSafeInteger(revision) && revision >= 0, 'Use the current original Utility revision.');
      await launch();
      const headers = { 'Content-Length': String(info.size), 'X-Utility-Revision': String(revision),
        'X-Utility-Request-Id': requestId };
      if (!restore) Object.assign(headers, { 'X-Utility-Name': encodeURIComponent(name ?? basename(filename)),
        'X-Utility-Provider': provider, 'X-Utility-Kind': kind, 'X-Utility-Context': encodeURIComponent(JSON.stringify(context)) });
      stream = handle.createReadStream({ start: 0, autoClose: false });
      const result = await send(restore ? '/api/restore' : '/api/upload',
        { method: 'POST', body: stream, headers, timeout: 300000, requestId },
        async response => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await responseBytes(response, MAX_JSON))));
      if (stamp(await handle.stat({ bigint: true })) !== stamp(info))
        throw fail('UTILITY_INPUT_CHANGED', 'The original input changed during receiving. Inspect this saved request before continuing.',
          { requestId, uncertain: true });
      return result;
    } finally { stream?.destroy(); await handle.close(); }
  };
  const download = async ({ route, query = {}, out, expected, fallback } = {}) => {
    expect(typeof out === 'string', 'Choose a new local receiving filename.');
    if (expected) expect(object(expected) && Number.isSafeInteger(expected.bytes) && expected.bytes >= 0 &&
      expected.bytes <= MAX_FILE && SHA.test(expected.sha256 || ''), 'Use the exact original declared file identity.');
    const destination = resolve(out), staging = join(dirname(destination), '.' + basename(destination) + '-' + randomUUID() + '.part');
    try { await lstat(destination); throw fail('UTILITY_RECEIVING_FILE_EXISTS', 'Choose a new local receiving filename.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await launch();
    const suffix = queryString(query);
    return send(route + (suffix ? '?' + suffix : ''), { timeout: 300000 }, async response => {
      const declared = response.headers['content-length'];
      expect(typeof declared === 'string' && /^\d+$/.test(declared) && Number(declared) <= MAX_FILE,
        'The original file must declare its complete byte length up to 2 GiB.');
      const file = await open(staging, 'wx', 0o600), h = createHash('sha256'); let bytes = 0, finished = false;
      try {
        for await (const block of response) {
          bytes += block.length;
          expect(bytes <= MAX_FILE && bytes <= Number(declared), 'The original file exceeded its declared length.');
          h.update(block); await file.writeFile(block);
        }
        const sha256 = h.digest('hex');
        expect(bytes === Number(declared) && (!expected || expected.bytes === bytes && expected.sha256 === sha256),
          'The downloaded file differs from its original retained identity.');
        await file.sync(); await file.close(); finished = true;
        await link(staging, destination); await unlink(staging);
        return { path: destination, bytes, sha256,
          filename: attachmentName(response.headers, fallback || basename(destination)),
          contentType: String(response.headers['content-type'] || 'application/octet-stream') };
      } finally {
        if (!finished) await file.close().catch(() => {});
        await unlink(staging).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    });
  };
  const api = {
    origin: connection.origin,
    state: () => own(state), launch: () => own(launch),
    act: (name, payload, options) => own(() => action(name, payload, options)),
    read: (route, query) => own(async () => { await launch(); return read(route, query); }),
    upload: options => own(() => upload(options)),
    restore: (file, options = {}) => own(() => upload({ file, ...options, restore: true })),
    imports: () => own(async () => (await state()).imports),
    source: id => own(async () => { await launch(); return read('/api/import', { id }); }),
    record: id => own(async () => { await launch(); return read('/api/record', { id }); }),
    records: query => own(async () => { await launch(); return read('/api/records', query); }),
    series: imports => own(async () => { await launch(); return read('/api/series', { imports: imports?.join(',') }); }),
    preview: (selection, options) => own(() => action('analysis.preview', selection, options)),
    review: (decision, options) => own(() => action('review.save', decision, options)),
    build: (reviewId, options) => own(() => action('edition.build', { review_id: reviewId }, options)),
    query: (buildId, query, options) => own(() => action('dataset.query', { build_id: buildId, query }, options)),
    compare: (before, after, options) => own(() => action('edition.compare', { before_id: before, after_id: after }, options)),
    changes: (id, offset = 0, limit = 100) => own(async () => { await launch(); return read('/api/changes', { id, offset, limit }); }),
    reconcile: (reviewId, billSeries = {}, options) => own(() => action('bills.reconcile', { review_id: reviewId, bill_series: billSeries }, options)),
    export: (reviewId, options) => own(() => action('package.export', { review_id: reviewId }, options)),
    exportManifest: id => own(async () => { await launch(); return read('/api/export', { id }); }),
    downloadDelivery: (id, out) => own(() => download({ route: '/api/export-zip', query: { id }, out, fallback: 'utility-customer-delivery.zip' })),
    downloadWorkspace: out => own(() => download({ route: '/api/portable', out, fallback: 'utility-workspace.zip' })),
    downloadFile: (id, name, out) => own(async () => {
      await launch(); const manifest = await read('/api/export', { id });
      const selected = manifest.files.find(item => item.name === name);
      expect(selected || name === 'delivery.json', 'Choose a file declared in the original customer delivery.');
      return download({ route: '/api/export-file', query: { id, name }, out,
        expected: selected, fallback: name.split('/').at(-1) });
    }),
    downloadOriginal: (id, out) => own(async () => {
      await launch(); const source = await read('/api/import', { id });
      return download({ route: '/api/original', query: { id }, out,
        expected: { bytes: source.bytes, sha256: source.source_sha256 }, fallback: source.original_name });
    }),
    downloadChanges: (id, out) => own(() => download({ route: '/api/changes/download', query: { id }, out, fallback: 'utility-edition-changes.ndjson' })),
    downloadNativeProject: (id, out) => own(() => download({ route: '/api/native-project', query: { id }, out, fallback: 'native-project.zip' })),
    downloadPublisher: (kind, id, out) => own(() => download({ route: '/api/publisher-export', query: { kind, id }, out, fallback: kind })),
    publisherState: () => own(async () => { await launch(); return read('/api/publisher-state'); }),
    operation: id => own(async () => { await launch(); return read('/api/operation', { id }); }),
    close() {
      closing = true;
      if (!closingPromise) closingPromise = Promise.allSettled([...pending]).then(() => undefined);
      return closingPromise;
    }
  };
  await state();
  return Object.freeze(api);
}
