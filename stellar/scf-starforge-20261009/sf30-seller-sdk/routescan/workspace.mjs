// MIT. Private operator workspace over the original Routescan project and SF30 service.
import { createServer } from 'node:http';
import { open, readFile, writeFile, realpath, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { openProject } from './project.mjs';
import { compileRoutescanMerchant, merchantReview, readRoutescanMerchant, requestFor, json, sha256, fail } from './config.mjs';
import { privateDirectory } from './quota.mjs';
import { startRoutescanMerchant } from './merchant.mjs';
import { createRoutescanBackup, restoreRoutescanBackup, createRoutescanCustomerArchive,
  workspaceTransferDirectory, newTransferId } from './backup.mjs';
import { sourceCsv } from './customer/customer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_JSON = 1024 * 1024, MAX_ARCHIVE = 260 * 1024 * 1024;
const STATIC = new Map([
  ['/', ['ui/index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['ui/app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['ui/style.css', 'text/css; charset=utf-8']],
]);
const CLIENT_FILES = ['seller-client.mjs','seller-client.d.mts','seller-openapi.json','package.json','README.md','client-export.json'];
const CUSTOMER_FILES = ['customer.mjs','customer.py','README.md','request.json'];
const EXPORT_FILES = ['merchant.json','review.json','seller-openapi.json','export.json','export-plan.json','customer-handoff.json'];
const ALL_EXPORT_FILES = [...EXPORT_FILES, ...CLIENT_FILES.map(x => 'client/' + x), ...CUSTOMER_FILES.map(x => 'customer/' + x)];

async function retainedFile(path, { limit = 64 * 1024 * 1024 } = {}) {
  if (await realpath(path) !== path) fail('Use the original retained file.', 409);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) || info.size > limit)
      fail('The retained file is unavailable.', 409);
    const bytes = await file.readFile();
    if (bytes.length > limit) fail('The retained file is too large.', 413);
    return bytes;
  } finally { await file.close(); }
}
async function readBody(request, maximum) {
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maximum)) fail('Request is too large.', 413);
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) fail('Request is too large.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}
function jsonBody(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('Send a complete UTF-8 JSON request.'); }
}
function originalSummary(row) {
  return { ...row, savedAt: row.savedAt ?? row.updatedAt ?? row.createdAt,
    preparedAt: row.preparedAt ?? row.exportedAt };
}
function sameToken(actual, expected) {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function exclusiveOrSame(path, bytes) {
  const temporary = join(dirname(path), '.customer-' + randomUUID());
  let file;
  try {
    file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!(await retainedFile(path)).equals(Buffer.from(bytes)))
        fail('The saved customer handoff differs from this release. Choose a new export name.', 409);
    }
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await file?.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}
function exportReadme(record, compiled, product = compiled.products[0]) {
  const fence = String.fromCharCode(96).repeat(3);
  return [
    '# Routescan customer handoff', '',
    'This package is retained from merchant revision ' + record.revision + '. Configuration SHA-256: ' + record.inputSha256 + '.',
    '',
    'Use a complete matching Stellar Forge source release with the original SF88 buyer.fromWorkspace API and installed Node dependencies. Keep the existing operator workspace and signing environment on the customer host.',
    'The provider API-key value is not included. Requests go to the merchant; provider credentials remain on its server.',
    '',
    '## Initialize and review one original request', '',
    'Choose Node or Python. Both use the SAME original native inbox and can reopen the same delivered response.',
    'Supply your actual absolute paths and explicit payment ceiling. The merchant origin and terms are in merchant.json and the original generated client.',
    '', fence + 'sh',
    'node customer/customer.mjs init --runtime /absolute/SF88 --state /private/routescan-buyer --inbox /private/routescan-inbox',
    'node customer/customer.mjs prepare --runtime /absolute/SF88 --state /private/routescan-buyer --inbox /private/routescan-inbox \\',
    '  --workspace /private/original-operator-workspace --client /absolute/export/client/seller-client.mjs \\',
    '  --operation ' + product.id + ' --inputs /absolute/export/customer/request.json --intent YOUR_STABLE_INTENT --max-atomic YOUR_CEILING --accept 0',
    'node customer/customer.mjs review --runtime /absolute/SF88 --state /private/routescan-buyer --inbox /private/routescan-inbox --intent YOUR_STABLE_INTENT',
    fence, '',
    'The request file preserves the selected example query. Edit it to the exact range and optional filters before preparing an intent. Operation names and alternatives are in seller-openapi.json.',
    '',
    '## Execute from the original operator terminal', '', fence + 'sh',
    'node customer/customer.mjs execute --runtime /absolute/SF88 --state /private/routescan-buyer --inbox /private/routescan-inbox \\',
    '  --intent YOUR_STABLE_INTENT --workspace /private/original-operator-workspace',
    fence, '',
    'Original SF88 approval, signer, budget and permanent attempt records remain authoritative. After interrupted execution, inspect and recover this exact intent.',
    'If preparation finished but inbox intake was interrupted, attach enqueues the same saved Node operation. It does not buy it.',
    '',
    '## Reopen and deliver from Python or Node', '', fence + 'sh',
    'python3 customer/customer.py recover --runtime /absolute/SF88 --state /private/routescan-buyer --inbox /private/routescan-inbox --intent YOUR_STABLE_INTENT',
    'python3 customer/customer.py download --runtime /absolute/SF88 --state /private/routescan-buyer --inbox /private/routescan-inbox \\',
    '  --intent YOUR_STABLE_INTENT --output /private/new-gas-result.json',
    'python3 customer/customer.py json --runtime /absolute/SF88 --state /private/routescan-buyer --inbox /private/routescan-inbox --intent YOUR_STABLE_INTENT',
    fence, '',
    'Python calls the original Node SDK adapter and keeps no separate purchase ledger. Its RoutescanCustomer class exposes the same workflow to Python applications.',
    'The original reader checks the saved file digest and byte length. Gas values remain strings; unit is the time aggregation interval. The operation schema does not declare a gas denomination.',
    'CSV is derived. Formula-like cells are escaped for spreadsheets; the original JSON download remains byte-exact.',
    '',
    '## Accounting and purchase history', '',
    'Use finalize with the SAME original operator workspace to continue its reservation and chain observation. It does not buy again.',
    'Use report --output /private/new-purchase-history.html for the original inbox report. Source delivery, native payment outcome and financial finalization keep their separate original fields.',
    '',
    'Powered by Routescan.io APIs — https://routescan.io', '',
  ].join('\n');
}

export async function startRoutescanWorkspace({
  directory, configFile, port = 0, merchantPort = 0, operationsPort = 0,
  nativeFactory = null, customer = {}, python = 'python3', env = process.env,
} = {}) {
  let project = await openProject(resolve(directory), { env });
  let activeMerchant = null, activeRevision = null, closing = null, origin = null;
  const token = randomBytes(32).toString('hex'), transfers = new Map();
  let sequence = Promise.resolve(), stopping = false;
  function serial(work) {
    const run = sequence.then(() => { if (stopping) fail('The workspace is closing.', 503); return work(); });
    sequence = run.catch(() => {}); return run;
  }
  if (configFile) {
    const compiled = await readRoutescanMerchant(configFile), saved = await project.read();
    if (!saved) await project.save({ input: compiled.config, expectedRevision: 0 });
    else if (saved.inputSha256 !== compiled.inputSha256)
      fail('This project already has a different configuration. Reopen it without --config and save the intended revision from the workspace.', 409);
  }
  if (!await project.read()) fail('Initialize this project with --config and a reviewed Routescan merchant configuration.');
  const send = (response, status, bytes, type = 'application/json; charset=utf-8', filename) => {
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(typeof bytes === 'string' ? bytes : json(bytes));
    response.writeHead(status, {
      'content-type': type, 'content-length': body.length, 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      ...(filename ? { 'content-disposition': 'attachment; filename="' + filename.replace(/[^A-Za-z0-9_.-]/g, '_') + '"' } : {}),
    });
    response.end(body);
  };
  async function current(expectedRevision) {
    const saved = await project.read();
    if (!saved || saved.revision !== expectedRevision) fail('The saved configuration changed. Refresh the workspace.', 409, 'ROUTESCAN_REVISION_CHANGED');
    return saved;
  }
  async function runtimeView() {
    const snapshot = activeMerchant ? await activeMerchant.snapshot() : null;
    return { running: Boolean(activeMerchant), nativeConfigured: Boolean(nativeFactory),
      revision: activeRevision, mode: snapshot?.mode ?? null, origin: snapshot?.merchantUrl ?? null,
      operationsOrigin: snapshot?.operationsUrl ?? null, snapshot };
  }
  async function view() {
    const saved = await project.read();
    const [previews, exports, revisions, runtime] = await Promise.all([
      project.listPreviews(), project.listExports(), project.history(), runtimeView(),
    ]);
    return { ...saved, directory: project.root, token, review: merchantReview(compileRoutescanMerchant(saved.input)),
      previews, exports: exports.map(originalSummary), revisions: revisions.map(originalSummary), runtime,
      customer: { runtimeDirectory: customer.runtimeDirectory ?? null, stateDirectory: customer.stateDirectory ?? null,
        profileConfigured: Boolean(customer.operatorProfile) } };
  }
  async function customerExport(id, { previewId } = {}) {
    const record = await project.readExport(id), saved = await project.readRevision(record.revision);
    const compiled = compileRoutescanMerchant(saved.input);
    try {
      const handoff = JSON.parse(await retainedFile(join(record.directory, 'customer-handoff.json')));
      if (handoff.schema !== 'stellar-forge.routescan-customer-handoff.v1' || handoff.exportId !== id ||
          handoff.inputSha256 !== record.inputSha256 || handoff.revision !== record.revision ||
          !Array.isArray(handoff.files) || handoff.files.length !== 4 ||
          (previewId !== undefined && previewId !== handoff.sourcePreviewId))
        fail('This customer export belongs to a different retained request.', 409);
      for (const row of handoff.files) {
        if (!CUSTOMER_FILES.map(x => 'customer/' + x).includes(row.path)) fail('Invalid saved customer file.', 409);
        const bytes = await retainedFile(join(record.directory, row.path));
        if (sha256(bytes) !== row.sha256 || bytes.length !== row.bytes) fail('The saved customer file changed.', 409);
      }
      return { ...record, handoff };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let product = compiled.products[0], query = product.example;
    if (previewId) {
      const preview = await project.readPreview(previewId);
      if (preview.state !== 'COMPLETE' || preview.request.inputSha256 !== record.inputSha256 ||
          preview.request.revision !== record.revision) fail('Choose a completed source request from this exact configuration revision.', 409);
      const selected = requestFor(compiled, preview.request.product, preview.request.request);
      product = selected.product; query = selected.request;
    }
    const customerDir = await privateDirectory(join(record.directory, 'customer'));
    const additions = [
      ['customer.mjs', await readFile(join(HERE, 'customer/customer.mjs'))],
      ['customer.py', await readFile(join(HERE, 'customer/customer.py'))],
      ['README.md', Buffer.from(exportReadme(record, compiled, product))],
      ['request.json', Buffer.from(json({ query }))],
    ];
    for (const [name, bytes] of additions) await exclusiveOrSame(join(customerDir, name), bytes);
    const handoff = { schema: 'stellar-forge.routescan-customer-handoff.v1', exportId: record.id,
      revision: record.revision, inputSha256: record.inputSha256, sourcePreviewId: previewId || null,
      selectedRequest: { operation: product.id, query },
      operations: compiled.products.map(item => ({ id: item.id, path: item.path, operation: item.operation, example: item.example })),
      originalClient: 'client/seller-client.mjs', node: 'customer/customer.mjs', python: 'customer/customer.py',
      nativeState: 'One original SF88 inbox shared by both language entry points.',
      files: additions.map(([path, bytes]) => ({ path: 'customer/' + path, bytes: bytes.length, sha256: sha256(bytes) })) };
    await exclusiveOrSame(join(record.directory, 'customer-handoff.json'), Buffer.from(json(handoff)));
    return { ...record, handoff };
  }
  async function describeExport(id) {
    const record = await project.readExport(id), files = [];
    for (const path of ALL_EXPORT_FILES) {
      try { const bytes = await retainedFile(join(record.directory, path));
        files.push({ path, bytes: bytes.length, sha256: sha256(bytes) }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    let handoff = null;
    try { handoff = JSON.parse(await retainedFile(join(record.directory, 'customer-handoff.json'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { ...originalSummary(record), files, handoff };
  }
  async function transferPath(extension) {
    const folder = await workspaceTransferDirectory(project.root);
    return join(folder, newTransferId() + extension);
  }
  function retainDownload(result) {
    const id = basename(result.path, '.zip'); transfers.set(id, result.path);
    return { ...result, filename: basename(result.path), url: '/api/downloads/' + encodeURIComponent(id) };
  }
  const server = createServer(async (request, response) => {
    try {
      if (!origin || request.headers.host !== new URL(origin).host || !['127.0.0.1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress))
        fail('Open this private workspace through its printed loopback URL.', 403);
      if ((request.headers.origin && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site')
        fail('Use this workspace page for the request.', 403);
      const url = new URL(request.url, origin), path = url.pathname;
      if (request.method === 'GET' && STATIC.has(path)) {
        const [file, type] = STATIC.get(path); return send(response, 200, await readFile(join(HERE, file)), type);
      }
      if (request.method === 'GET' && path === '/api/workspace') return send(response, 200, await view());
      let match;
      if (request.method === 'GET' && (match = /^\/api\/revisions\/([1-9][0-9]*)$/.exec(path)))
        return send(response, 200, originalSummary(await project.readRevision(Number(match[1]))));
      if (request.method === 'GET' && (match = /^\/api\/previews\/([A-Za-z0-9_-]+)(?:\/(body|record|csv))?$/.exec(path))) {
        const record = await project.readPreview(match[1]);
        if (!match[2]) return send(response, 200, record);
        if (match[2] === 'record') return send(response, 200, { ...record, bodyBase64: undefined }, 'application/json', record.id + '-source.json');
        if (record.bodyBase64 === undefined) fail('The original request has no retained response body.', 409);
        const bytes = Buffer.from(record.bodyBase64, 'base64');
        if (match[2] === 'csv' && record.state !== 'COMPLETE') fail('CSV requires a completed provider result.', 409);
        return match[2] === 'csv'
          ? send(response, 200, sourceCsv(JSON.parse(bytes.toString('utf8'))), 'text/csv; charset=utf-8', record.id + '.csv')
          : send(response, 200, bytes, 'application/json', record.id + '.json');
      }
      if (request.method === 'GET' && (match = /^\/api\/exports\/([A-Za-z0-9_-]+)$/.exec(path)))
        return send(response, 200, await describeExport(match[1]));
      if (request.method === 'GET' && (match = /^\/api\/exports\/([A-Za-z0-9_-]+)\/files\/(.+)$/.exec(path))) {
        const name = decodeURIComponent(match[2]);
        if (!ALL_EXPORT_FILES.includes(name)) fail('Choose a retained customer export file.', 404);
        const record = await project.readExport(match[1]);
        return send(response, 200, await retainedFile(join(record.directory, name)), 'application/octet-stream', basename(name));
      }
      if (request.method === 'GET' && (match = /^\/api\/downloads\/([A-Za-z0-9_-]+)$/.exec(path))) {
        const file = transfers.get(match[1]); if (!file) fail('Recreate this download from the saved workspace.', 404);
        return send(response, 200, await retainedFile(file, { limit: MAX_ARCHIVE }), 'application/zip', basename(file));
      }
      if (request.method !== 'POST') fail('Workspace route not found.', 404);
      if (!sameToken(request.headers['x-workspace-token'], token)) fail('Refresh this private workspace before making a change.', 403);
      if (path === '/api/restore') {
        if (request.headers['content-type'] !== 'application/zip') fail('Send the complete ZIP backup.');
        const bytes = await readBody(request, MAX_ARCHIVE);
        return send(response, 200, await serial(async () => {
          if (activeMerchant) fail('Drain and stop the current merchant before restoring a workspace.', 409);
          const archive = await transferPath('.zip'); await writeFile(archive, bytes, { flag: 'wx', mode: 0o600 });
          const destination = join(dirname(project.root), 'restored-' + newTransferId());
          const restored = await restoreRoutescanBackup(archive, { directory: destination, python, env });
          const next = await openProject(restored.directory, { env });
          await project.close(); project = next; return restored;
        }));
      }
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) fail('Send a JSON request.');
      const body = jsonBody(await readBody(request, MAX_JSON));
      const result = await serial(async () => {
        if (path === '/api/config') return project.save({ input: body.input, expectedRevision: body.expectedRevision });
        if (path === '/api/previews') return project.preview({ product: body.product, request: body.request, expectedRevision: body.expectedRevision, id: body.id });
        if (path === '/api/exports') {
          const exported = await project.export({ id: body.id, expectedRevision: body.expectedRevision });
          return customerExport(exported.id, { previewId: body.previewId });
        }
        if ((match = /^\/api\/exports\/([A-Za-z0-9_-]+)\/package$/.exec(path))) {
          const record = await customerExport(match[1]);
          return retainDownload(await createRoutescanCustomerArchive(record, { output: await transferPath('.zip'), python }));
        }
        if (path === '/api/merchant/start') {
          if (activeMerchant) fail('The merchant is already running. Refresh its current state.', 409);
          const saved = await current(body.expectedRevision);
          activeMerchant = await startRoutescanMerchant(compileRoutescanMerchant(saved.input), {
            quotaDirectory: project.quotaDirectory, nativeFactory, port: merchantPort, operationsPort, navigationOrigin: origin, env,
          });
          activeRevision = saved.revision; return runtimeView();
        }
        if (path === '/api/merchant/stop') {
          const result = activeMerchant ? await activeMerchant.close() : { alreadyStopped: true };
          activeMerchant = null; activeRevision = null; return result;
        }
        if (path === '/api/backup') {
          if (activeMerchant) fail('Drain and stop the merchant before creating its portable project backup.', 409);
          return retainDownload(await createRoutescanBackup(project, { output: await transferPath('.zip'), python }));
        }
        fail('Workspace route not found.', 404);
      });
      return send(response, 200, result);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const status = Number.isInteger(error.status) ? error.status : error.code === 'ENOENT' ? 404 : 500;
      send(response, status, { error: { code: error.code || 'ROUTESCAN_WORKSPACE_FAILED',
        message: error.status ? error.message : error.code === 'ENOENT' ? 'This retained record was not found.' : 'The workspace could not complete the operation. Its original state is retained.' } });
    }
  });
  server.requestTimeout = 180000; server.headersTimeout = 15000;
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  origin = 'http://127.0.0.1:' + server.address().port;
  async function close() {
    return closing ??= (async () => {
      stopping = true;
      const stopHttp = new Promise(done => { server.close(done); server.closeIdleConnections?.(); });
      await sequence; await activeMerchant?.close(); activeMerchant = null;
      await project.close(); await stopHttp; return { closed: true };
    })();
  }
  return { url: origin, server, close, view, get project() { return project; } };
}
