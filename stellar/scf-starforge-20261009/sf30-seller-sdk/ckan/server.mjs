// MIT. Loopback UI for one locked CKAN project.
import http from 'node:http';
import { readFile, open, unlink, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { ExactCkanNumber, parseCkanJson } from './capture.mjs';
import { stringifyRemote } from './remote-json.mjs';
import { DCAT_MAX_CATALOG_BYTES } from './dcat-workspace.mjs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readPrivate, hashPrivate, privateDirectory, syncDirectory, fault } from '../postgres/publisher/files.mjs';

const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/dcat-json.mjs', ['dcat-json.mjs', 'text/javascript; charset=utf-8']],
  ['/remote-publication.mjs', ['remote-publication.mjs', 'text/javascript; charset=utf-8']],
  ['/capture-plans.mjs', ['capture-plans.mjs', 'text/javascript; charset=utf-8']],
  ['/dcat-sources.mjs', ['dcat-sources.mjs', 'text/javascript; charset=utf-8']],
  ['/dcat-semantic.mjs', ['dcat-semantic.mjs', 'text/javascript; charset=utf-8']],
  ['/dcat-semantic-view.mjs', ['dcat-semantic-view.mjs', 'text/javascript; charset=utf-8']],
  ['/dcat-semantic-comparison.mjs', ['dcat-semantic-comparison.mjs', 'text/javascript; charset=utf-8']],
  ['/migration.mjs', ['migration.mjs', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const root = fileURLToPath(new URL('./public/', import.meta.url));
function exactPresentation(value) {
  if (value instanceof ExactCkanNumber) return value.source;
  if (Array.isArray(value)) return value.map(exactPresentation);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, exactPresentation(item)]));
  return value;
}
const json = (response, value, status = 200, exact = false) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(exact ? stringifyRemote(value, 0) : JSON.stringify(value));
};
async function body(request, exact = false, limit = 131072) {
  if (!String(request.headers['content-type'] ?? '').startsWith('application/json'))
    throw fault('CKAN_JSON_REQUIRED', 'Send a JSON request.', 415);
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw fault('CKAN_REQUEST_TOO_LARGE', 'The request exceeds ' + (limit / 1024) + ' KiB.', 413);
    chunks.push(chunk);
  }
  let value;
  try { const raw = Buffer.concat(chunks); value = exact ? parseCkanJson(raw) : JSON.parse(raw.toString('utf8')); }
  catch { throw fault('CKAN_INVALID_JSON', 'Enter valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fault('CKAN_JSON_OBJECT_REQUIRED');
  return value;
}
async function receiveArchiveUpload(request, workbench, expectedSha256) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? '') ||
      request.headers['content-type'] !== 'application/octet-stream')
    throw fault('CKAN_ARCHIVE_UPLOAD_INVALID', 'Choose a workspace archive and its complete SHA-256.', 415);
  const root = join(workbench.directory, 'workspace-incoming');
  await privateDirectory(root, true);
  const temporary = join(root, '.upload-' + randomUUID()), file = join(root, expectedSha256 + '.ckanw');
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const hash = createHash('sha256'); let count = 0, closed = false;
  try {
    for await (const chunk of request) {
      count += chunk.length;
      if (count > 8657043456) throw fault('CKAN_ARCHIVE_UPLOAD_TOO_LARGE', 'This listener accepts workspace transfers up to 8 GiB.', 413);
      hash.update(chunk); let offset = 0;
      while (offset < chunk.length) {
        const written = await handle.write(chunk, offset, chunk.length - offset);
        if (!written.bytesWritten) throw fault('CKAN_ARCHIVE_UPLOAD_FAILED');
        offset += written.bytesWritten;
      }
    }
    if (hash.digest('hex') !== expectedSha256) throw fault('CKAN_WORKSPACE_ARCHIVE_HASH_MISMATCH');
    await handle.sync(); await handle.close(); closed = true;
    let previous;
    try { previous = await hashPrivate(file, count); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous) {
      if (previous.hash !== expectedSha256 || previous.bytes !== count) throw fault('CKAN_ARCHIVE_UPLOAD_CHANGED');
    } else await rename(temporary, file);
    await syncDirectory(root); return file;
  } finally {
    if (!closed) await handle.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
async function receiveDcatUpload(request, workbench) {
  if (!['application/json', 'application/octet-stream'].includes(String(request.headers['content-type'] ?? '').split(';')[0].trim()))
    throw fault('DCAT_UPLOAD_TYPE', 'Upload the complete JSON catalog.', 415);
  const root = join(workbench.directory, 'workspace-incoming');
  await privateDirectory(root, true);
  const file = join(root, 'dcat-' + randomUUID() + '.json');
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let count = 0, completed = false;
  try {
    for await (const chunk of request) {
      count += chunk.length;
      if (count > DCAT_MAX_CATALOG_BYTES) throw fault('DCAT_CATALOG_SIZE', 'Choose a JSON catalog no larger than 128 MiB.', 413);
      let offset = 0;
      while (offset < chunk.length) {
        const written = await handle.write(chunk, offset, chunk.length - offset);
        if (!written.bytesWritten) throw fault('DCAT_UPLOAD_FAILED');
        offset += written.bytesWritten;
      }
    }
    if (count < 2) throw fault('DCAT_CATALOG_REQUIRED', 'Choose a complete JSON catalog.');
    await handle.sync(); completed = true;
    return file;
  } finally {
    await handle.close();
    if (!completed) await unlink(file).catch(() => {});
  }
}

async function downloadWorkspaceArchive(response, selected) {
  const { handle, stat } = await (async () => {
    const handle = await open(selected.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || stat.size !== selected.bytes)
        throw fault('CKAN_WORKSPACE_ARCHIVE_CHANGED');
      return { handle, stat };
    } catch (error) { await handle.close(); throw error; }
  })();
  const hash = createHash('sha256'); let count = 0;
  try {
    response.writeHead(200, { 'content-type': selected.mediaType ?? 'application/vnd.stellar-forge.ckan-workspace',
      'content-length': selected.bytes, [selected.hashHeader ?? 'x-archive-sha256']: selected.sha256,
      'content-disposition': 'attachment; filename="' + (selected.downloadName ?? ('ckan-workspace-' + selected.id + '.ckanw')) + '"' });
    const meter = new Transform({ transform(chunk, encoding, done) {
      hash.update(chunk); count += chunk.length; done(null, chunk);
    } });
    await pipeline(handle.createReadStream({ autoClose: false, start: 0 }), meter, response);
    const after = await handle.stat();
    if (count !== selected.bytes || hash.digest('hex') !== selected.sha256 ||
        after.ino !== stat.ino || after.dev !== stat.dev || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs)
      throw fault('CKAN_WORKSPACE_ARCHIVE_CHANGED');
  } finally { await handle.close(); }
}
function bearer(request, token) {
  const received = Buffer.from(String(request.headers.authorization ?? ''));
  const expected = Buffer.from('Bearer ' + token);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
function lookup(workbench, collection, id) {
  const item = workbench.status()[collection].find(item => item.id === id);
  if (!item) throw fault('CKAN_ITEM_NOT_FOUND', 'Choose an existing project item.', 404);
  return item;
}
export async function startCkanServer({ workbench, port = 0, token = randomBytes(32).toString('base64url'), instanceId = randomUUID() } = {}) {
  if (!workbench || !Number.isInteger(port) || port < 0 || port > 65535 || typeof token !== 'string' || token.length < 32 ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(instanceId))
    throw fault('CKAN_SERVER_OPTIONS');
  let origin, closing, uploading = false;
  const server = http.createServer(async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      if (request.headers.host !== new URL(origin).host) throw fault('CKAN_HOST_REJECTED', 'Use the project loopback address.', 403);
      const incomingOrigin = request.headers.origin;
      if (incomingOrigin && incomingOrigin !== origin) throw fault('CKAN_ORIGIN_REJECTED', 'Open this project directly.', 403);
      if (request.headers['sec-fetch-site'] === 'cross-site') throw fault('CKAN_ORIGIN_REJECTED', 'Open this project directly.', 403);
      const url = new URL(request.url, origin), pathname = url.pathname;
      const asset = assets.get(pathname);
      if (asset && request.method === 'GET') {
        response.writeHead(200, { 'content-type': asset[1] });
        response.end(await readFile(join(root, asset[0]))); return;
      }
      if (!pathname.startsWith('/api/') || !bearer(request, token))
        throw fault('CKAN_PROJECT_ACCESS_REQUIRED', 'Open the project link printed by the command.', 401);
      const parts = pathname.slice(5).split('/').map(decodeURIComponent);
      if (request.method === 'GET') {
        if (parts[0] === 'launch' && parts.length === 1) {
          const state = workbench.status();
          return json(response, { schema: 'stellar-forge.ckan-workbench-listener.v1', instanceId,
            pid: process.pid, directory: workbench.directory,
            ...(state.sourceKind === 'dcat-us' ? { dcatRuntime: workbench.dcatRuntime() } : {}), project: {
              schema: state.schema, createdAt: state.createdAt, catalogOrigin: state.catalogOrigin, sourceKind: state.sourceKind ?? 'ckan',
              ...(state.authTokenEnv ? { authTokenEnv: state.authTokenEnv } : {}),
            } });
        }
        if (parts[0] === 'dcat' && parts[1] === 'semantic') {
          if (parts[2] === 'comparisons') {
            if (parts[3] === 'guide' && parts.length === 4) {
              response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8',
                'content-disposition': 'attachment; filename="SEMANTIC_COMPARISONS.md"' });
              response.end(await readFile(fileURLToPath(new URL('./SEMANTIC_COMPARISONS.md', import.meta.url)))); return;
            }
            if (parts[3] === 'files' && parts.length === 6)
              return await downloadWorkspaceArchive(response, await workbench.dcatSemanticComparisonDownload({
                kind: parts[4], id: parts[5], ...(url.searchParams.has('key') ? { key: url.searchParams.get('key') } : {}),
              }));
            if (parts.length === 4) return json(response, await workbench.dcatSemanticComparison(parts[3]));
            if (parts[4] === 'rows' && parts.length === 5)
              return json(response, await workbench.dcatSemanticComparisonRows({
                comparisonId: parts[3], section: url.searchParams.get('section'),
                offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 50),
                ...(url.searchParams.has('search') ? { search: url.searchParams.get('search') } : {}),
                ...(url.searchParams.has('change') ? { change: url.searchParams.get('change') } : {}),
                ...(url.searchParams.has('snapshot') ? { snapshot: url.searchParams.get('snapshot') } : {}),
              }));
          }
          if (parts[2] === 'profiles' && parts.length === 4)
            return json(response, await workbench.dcatSemanticProfile(parts[3]));
          if (parts[2] === 'runs' && parts.length === 4)
            return json(response, await workbench.dcatSemanticRun(parts[3]));
          if (parts[2] === 'runs' && parts[4] === 'findings' && parts.length === 5)
            return json(response, await workbench.dcatSemanticFindings({
              runId: parts[3], offset: Number(url.searchParams.get('offset') ?? 0),
              limit: Number(url.searchParams.get('limit') ?? 50),
              ...(url.searchParams.has('severity') ? { severity: url.searchParams.get('severity') } : {}),
              ...(url.searchParams.has('search') ? { search: url.searchParams.get('search') } : {}),
            }));
          if (parts[2] === 'files' && parts.length === 5)
            return await downloadWorkspaceArchive(response, await workbench.dcatSemanticDownload({
              kind: parts[3], id: parts[4], ...(url.searchParams.has('key') ? { key: url.searchParams.get('key') } : {}),
            }));
          if (parts[2] === 'guide' && parts.length === 3) {
            response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8',
              'content-disposition': 'attachment; filename="SEMANTIC_CATALOGS.md"' });
            response.end(await readFile(fileURLToPath(new URL('./SEMANTIC_CATALOGS.md', import.meta.url)))); return;
          }
        }
        if (parts[0] === 'capture-plans') {
          if (parts.length === 2 && parts[1] === 'due')
            return json(response, await workbench.dueCapturePlans(), 200, true);
          if (parts.length === 2 && parts[1] === 'guide') {
            response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8',
              'content-disposition': 'attachment; filename="CAPTURE_PLANS.md"' });
            response.end(await readFile(fileURLToPath(new URL('./CAPTURE_PLANS.md', import.meta.url)))); return;
          }
          if (parts.length === 2)
            return json(response, await workbench.capturePlan(parts[1], {
              offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 50),
            }), 200, true);
          if (parts.length === 3 && parts[2] === 'file')
            return await downloadWorkspaceArchive(response, await workbench.capturePlanFile(parts[1], 'plan',
              url.searchParams.get('sha256') ?? undefined));
        }
        if (parts[0] === 'capture-plan-runs') {
          if (parts.length === 2)
            return json(response, await workbench.capturePlanRun(parts[1]), 200, true);
          if (parts.length === 3 && parts[2] === 'file')
            return await downloadWorkspaceArchive(response, await workbench.capturePlanFile(parts[1], 'run'));
        }
        if (parts[0] === 'dcat') {
          if (parts[1] === 'sources' && parts.length === 3)
            return json(response, await workbench.dcatSource(parts[2]));
          if (parts[1] === 'acquisitions' && parts.length === 4 && ['receipt', 'response'].includes(parts[3]))
            return await downloadWorkspaceArchive(response, await workbench.dcatAcquisitionDownload(parts[2], parts[3]));
          if (parts[1] === 'sources-guide' && parts.length === 2) {
            response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8',
              'content-disposition': 'attachment; filename="RECURRING_CATALOGS.md"' });
            response.end(await readFile(fileURLToPath(new URL('./RECURRING_CATALOGS.md', import.meta.url)))); return;
          }
          if (parts[1] === 'guide' && parts.length === 2) {
            response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8',
              'content-disposition': 'attachment; filename="MIGRATION_OPERATING.md"' });
            response.end(await readFile(fileURLToPath(new URL('./MIGRATION_OPERATING.md', import.meta.url)))); return;
          }
          if (parts[1] === 'current' && parts[2] === 'download' && parts.length === 3)
            return await downloadWorkspaceArchive(response, await workbench.dcatCurrentDownload());
          if (parts[1] === 'catalogs' && parts[3] === 'download' && parts.length === 4)
            return await downloadWorkspaceArchive(response, await workbench.dcatCatalogDownload(parts[2]));
          if (parts[1] === 'reviews' && parts.length === 3)
            return await downloadWorkspaceArchive(response, await workbench.dcatReviewDownload(parts[2], 'report'));
          if (parts[1] === 'reviews' && ['candidate', 'download'].includes(parts[3]) && parts.length === 4)
            return await downloadWorkspaceArchive(response, await workbench.dcatReviewDownload(parts[2],
              parts[3] === 'candidate' ? 'candidate' : 'report'));
        }
        if (parts[0] === 'remote') {
          if (parts[1] === 'targets' && parts.length === 3)
            return json(response, await workbench.remoteTarget(parts[2]), 200, true);
          if (parts[1] === 'publications' && parts.length === 3)
            return json(response, await workbench.remotePublication(parts[2]), 200, true);
          if (parts[1] === 'publications' && parts[3] === 'files' && parts.length === 5 &&
              ['plan', 'record', 'receipt'].includes(parts[4]))
            return await downloadWorkspaceArchive(response, await workbench.remotePublicationFile(
              parts[2], parts[4], url.searchParams.get('receiptId') ?? undefined));
          if (parts[1] === 'guide' && parts.length === 2) {
            response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8',
              'content-disposition': 'attachment; filename="REMOTE_PUBLICATION.md"' });
            response.end(await readFile(fileURLToPath(new URL('./REMOTE_PUBLICATION.md', import.meta.url)))); return;
          }
        }
        if (parts[0] === 'workspace' && parts[1] === 'archives' && parts.length === 2)
          return json(response, await workbench.workspaceArchives());
        if (parts[0] === 'workspace' && parts[1] === 'archives' && parts.length === 3)
          return await downloadWorkspaceArchive(response, await workbench.workspaceArchive(parts[2]));
        if (parts[0] === 'status' && parts.length === 1) return json(response, workbench.status());
        if (parts[0] === 'search' && parts.length === 1)
          return json(response, await workbench.search({ q: url.searchParams.get('q') ?? '',
            start: Number(url.searchParams.get('start') ?? 0), rows: Number(url.searchParams.get('rows') ?? 20) }));
        if (parts[0] === 'packages' && parts.length === 2) return json(response, await workbench.package(parts[1]));
        if (parts[0] === 'editions' && parts.length === 2) return json(response, await workbench.edition(parts[1]));
        if (parts[0] === 'compare' && parts.length === 1)
          return json(response, await workbench.compare(url.searchParams.get('before'), url.searchParams.get('after'), url.searchParams.get('key') ?? '_id'));
        if (parts[0] === 'refreshes' && parts.length === 2)
          return json(response, exactPresentation(await workbench.refresh(parts[1])));
        if (parts[0] === 'refreshes' && parts[2] === 'changes' && parts.length === 3)
          return json(response, exactPresentation(await workbench.refreshChanges(parts[1], {
            expectedComparisonSha256: url.searchParams.get('sha256'),
            offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 50) })));
        if (parts[0] === 'refreshes' && parts[2] === 'changes' && parts[3] === 'download' && parts.length === 4) {
          const selected = await workbench.refreshChangesFile(parts[1], url.searchParams.get('sha256'));
          return await downloadWorkspaceArchive(response, { ...selected, id: parts[1],
            mediaType: 'application/x-ndjson; charset=utf-8', hashHeader: 'x-content-sha256',
            downloadName: 'ckan-refresh-' + parts[1] + '-changes.jsonl' });
        }
        if (parts[0] === 'publications' && parts.length === 2)
          return json(response, await workbench.publication(parts[1], url.searchParams.get('query') ?? ''));
        if (parts[0] === 'sources' && parts[2] === 'semantics' && parts.length === 3) {
          const semantics = await workbench.sourceSemantics(parts[1]);
          if (!semantics) throw fault('CKAN_SEMANTICS_NOT_REVIEWED', 'This saved source has no reviewed semantic schema.', 404);
          response.setHeader('content-disposition', 'attachment; filename="ckan-semantics.json"');
          return json(response, semantics);
        }
        if (parts[0] === 'sources' && parts[2] === 'download' && parts.length === 3) {
          const entry = lookup(workbench, 'sources', parts[1]);
          response.setHeader('content-disposition', 'attachment; filename="ckan-source-' + entry.id + '.json"');
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(await readPrivate(entry.file, 1048576)); return;
        }
        if (parts[0] === 'buyer-requests' && parts[2] === 'download' && parts.length === 3) {
          const entry = lookup(workbench, 'buyerRequests', parts[1]);
          response.setHeader('content-disposition', 'attachment; filename="ckan-buyer-' + entry.id + '.json"');
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(await readPrivate(entry.out, 1048576)); return;
        }
        if (parts[0] === 'exports' && parts[2] === 'download' && parts.length === 3) {
          const entry = lookup(workbench, 'exports', parts[1]);
          const child = spawn('tar', ['-czf', '-', '-C', entry.directory, '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
          let started = false, stderr = '';
          child.stderr.on('data', data => { if (stderr.length < 4096) stderr += data.toString(); });
          child.once('error', error => { if (!response.headersSent) json(response, { error: 'CKAN_ARCHIVE_UNAVAILABLE', message: 'Install tar to download a package archive. The complete package remains in the project.' }, 503); else response.destroy(error); });
          child.stdout.on('data', data => {
            if (!started) {
              started = true;
              response.writeHead(200, { 'content-type': 'application/gzip',
                'content-disposition': 'attachment; filename="ckan-merchant-' + entry.id + '.tar.gz"' });
            }
            if (!response.write(data)) child.stdout.pause();
          });
          response.on('drain', () => child.stdout.resume());
          response.on('close', () => { if (!child.killed) child.kill(); });
          child.once('close', code => {
            if (code !== 0) { if (!response.headersSent) json(response, { error: 'CKAN_ARCHIVE_FAILED', message: 'The archive could not be created. Read the saved package in the project.' }, 500); else response.destroy(); }
            else response.end();
          });
          return;
        }
      }
      if (request.method === 'POST' && parts[0] === 'dcat' && parts[1] === 'catalogs' &&
          parts[2] === 'upload' && parts.length === 3) {
        if (uploading || workbench.status().active) throw fault('CKAN_PROJECT_BUSY', 'Finish the current project operation before importing another catalog.', 409);
        uploading = true; let file, retained = false;
        try {
          file = await receiveDcatUpload(request, workbench);
          const result = workbench.importDcatCatalog({ file, label: url.searchParams.get('label') || 'Catalog edition',
            profile: url.searchParams.get('profile') || 'auto', origin: url.searchParams.get('origin') || null });
          retained = true;
          result.completion.finally(() => unlink(file).catch(() => {})).catch(() => {});
          return json(response, { operationId: result.id, catalogId: result.catalogId }, 202);
        } finally {
          uploading = false;
          if (file && !retained) await unlink(file).catch(() => {});
        }
      }
      if (request.method === 'POST' && parts[0] === 'workspace' && parts[1] === 'receive' && parts.length === 2) {
        if (uploading || workbench.status().active) throw fault('CKAN_PROJECT_BUSY', 'Finish the current project operation before receiving another workspace.', 409);
        uploading = true;
        try {
          const expectedSha256 = request.headers['x-archive-sha256'];
          const file = await receiveArchiveUpload(request, workbench, expectedSha256);
          const result = workbench.receiveWorkspace({ file, expectedSha256, name: url.searchParams.get('name') });
          return json(response, { operationId: result.id }, 202);
        } finally { uploading = false; }
      }
      if (request.method === 'POST') {
        if (uploading) throw fault('CKAN_PROJECT_BUSY', 'Finish the current upload before starting another project operation.', 409);
        const input = await body(request, ['remote', 'capture-plans', 'capture-plan-runs'].includes(parts[0]) || parts[0] === 'dcat' && parts[1] !== 'semantic', ['remote', 'capture-plans', 'capture-plan-runs'].includes(parts[0]) ? 4194304 : parts[0] === 'dcat' && parts[1] === 'semantic' ? 50331648 : 131072);
        if (parts[0] === 'capture-plans' && parts[1] === 'preview' && parts.length === 2)
          return json(response, await workbench.previewCapturePlan(input), 200, true);
        if (parts[0] === 'editions' && parts[2] === 'semantics' && parts.length === 3)
          return json(response, await workbench.previewSemantics(parts[1], input.projection));
        if (parts[0] === 'refreshes' && parts[2] === 'preview' && parts.length === 3)
          return json(response, exactPresentation(await workbench.previewRefresh(parts[1], input)));
        let result;
        if (parts[0] === 'capture-plans' && parts[1] === 'save' && parts.length === 2)
          result = workbench.saveCapturePlan(input);
        else if (parts[0] === 'capture-plans' && parts[1] === 'run' && parts.length === 2)
          result = workbench.runCapturePlan(input);
        else if (parts[0] === 'capture-plan-runs' && parts[2] === 'resume' && parts.length === 3)
          result = workbench.resumeCapturePlanRun(parts[1], input);
        else if (parts[0] === 'capture-plan-runs' && parts[2] === 'refresh' && parts.length === 3)
          result = await workbench.prepareCapturePlanRefresh(parts[1], input);
        else if (parts[0] === 'remote' && parts[1] === 'targets' && parts.length === 2)
          result = workbench.saveRemoteTarget(input);
        else if (parts[0] === 'remote' && parts[1] === 'publications' && parts.length === 2)
          result = workbench.prepareRemotePublication(input);
        else if (parts[0] === 'remote' && parts[1] === 'publications' && parts[3] === 'review' && parts.length === 4)
          result = workbench.reviewRemotePublication(parts[2], input);
        else if (parts[0] === 'remote' && parts[1] === 'publications' && parts[3] === 'publish' && parts.length === 4)
          result = workbench.publishRemotePublication(parts[2], input);
        else if (parts[0] === 'remote' && parts[1] === 'publications' && parts[3] === 'reconcile' && parts.length === 4)
          result = workbench.reconcileRemotePublication(parts[2]);
        else if (parts[0] === 'dcat' && parts[1] === 'semantic' && parts[2] === 'comparisons' && parts.length === 3)
          result = workbench.startDcatSemanticComparison(input);
        else if (parts[0] === 'dcat' && parts[1] === 'semantic' && parts[2] === 'comparisons' && parts[3] === 'reviews' && parts.length === 4)
          result = workbench.reviewDcatSemanticComparison(input);
        else if (parts[0] === 'dcat' && parts[1] === 'semantic' && parts[2] === 'profiles' && parts.length === 3)
          result = workbench.importDcatSemanticProfile(input);
        else if (parts[0] === 'dcat' && parts[1] === 'semantic' && parts[2] === 'runs' && parts.length === 3)
          result = workbench.startDcatSemanticRun(input);
        else if (parts[0] === 'dcat' && parts[1] === 'semantic' && parts[2] === 'reviews' && parts.length === 3)
          result = workbench.reviewDcatSemanticRun(input);
        else if (parts[0] === 'dcat' && parts[1] === 'sources' && parts[2] === 'save' && parts.length === 3)
          result = workbench.saveDcatSource(input);
        else if (parts[0] === 'dcat' && parts[1] === 'sources' && parts[2] === 'acquire' && parts.length === 3)
          result = workbench.acquireDcatSource(input);
        else if (parts[0] === 'dcat' && parts[1] === 'sources' && parts[2] === 'review' && parts.length === 3)
          result = workbench.prepareDcatSourceReview(input);
        else if (parts[0] === 'dcat' && parts[1] === 'review' && parts.length === 2) result = workbench.prepareDcatReview(input);
        else if (parts[0] === 'dcat' && parts[1] === 'cutover' && parts.length === 2) result = workbench.cutoverDcat(input);
        else if (parts[0] === 'dcat' && parts[1] === 'rollback' && parts.length === 2) result = workbench.rollbackDcat(input);
        else if (parts[0] === 'sources' && parts[2] === 'refreshes' && parts.length === 3) result = workbench.prepareRefresh(parts[1], input);
        else if (parts[0] === 'refreshes' && parts[2] === 'resume' && parts.length === 3) result = workbench.resumeRefresh(parts[1]);
        else if (parts[0] === 'refreshes' && parts[2] === 'review' && parts.length === 3) result = workbench.reviewRefresh(parts[1], input);
        else if (parts[0] === 'workspace' && parts[1] === 'archives' && parts.length === 2) result = workbench.archiveWorkspace({});
        else if (parts[0] === 'capture' && parts.length === 1) result = workbench.startCapture(input);
        else if (parts[0] === 'editions' && parts[2] === 'resume' && parts.length === 3) result = workbench.resumeCapture(parts[1], input);
        else if (parts[0] === 'editions' && parts[2] === 'sources' && parts.length === 3) result = workbench.saveSource(parts[1], input);
        else if (parts[0] === 'sources' && parts[2] === 'publications' && parts.length === 3) result = workbench.createPublication(parts[1], input);
        else if (parts[0] === 'publications' && parts[2] === 'review' && parts.length === 3) result = workbench.reviewPublication(parts[1], input);
        else if (parts[0] === 'publications' && parts[2] === 'recover' && parts.length === 3) result = workbench.recoverPublication(parts[1]);
        else if (parts[0] === 'publications' && parts[2] === 'publish' && parts.length === 3) result = workbench.publishDataset(parts[1], input.reviewId);
        else if (parts[0] === 'publications' && parts[2] === 'exports' && parts.length === 3) result = workbench.exportMerchant(parts[1], input);
        else if (parts[0] === 'exports' && parts[2] === 'stage' && parts.length === 3) result = workbench.stageMerchant(parts[1], input);
        else if (parts[0] === 'exports' && parts[2] === 'offer' && parts.length === 3) return json(response, await workbench.buyerOffer(parts[1], input));
        else if (parts[0] === 'exports' && parts[2] === 'buyer' && parts.length === 3) result = workbench.prepareBuyer(parts[1], input);
        else if (parts[0] === 'cancel' && parts.length === 1) return json(response, workbench.cancel());
        else throw fault('CKAN_ROUTE_NOT_FOUND', 'The requested project action does not exist.', 404);
        return json(response, { operationId: result.id,
          ...(result.profileId ? { profileId: result.profileId } : {}),
          ...(result.runId ? { runId: result.runId } : {}),
          ...(result.semanticReviewId ? { semanticReviewId: result.semanticReviewId } : {}),
          ...(result.comparisonId ? { comparisonId: result.comparisonId } : {}),
          ...(result.semanticComparisonReviewId ? { semanticComparisonReviewId: result.semanticComparisonReviewId } : {}),
          ...(result.planId ? { planId: result.planId } : {}),
          ...(result.refreshId ? { refreshId: result.refreshId } : {}),
          ...(result.targetId ? { targetId: result.targetId } : {}),
          ...(result.releaseId ? { releaseId: result.releaseId } : {}),
          ...(result.editionId ? { editionId: result.editionId } : {}),
          ...(result.reviewId ? { reviewId: result.reviewId } : {}),
          ...(result.sourceId ? { sourceId: result.sourceId } : {}),
          ...(result.acquisitionId ? { acquisitionId: result.acquisitionId } : {}) }, 202);
      }
      throw fault('CKAN_ROUTE_NOT_FOUND', 'The requested project action does not exist.', 404);
    } catch (error) {
      if (response.headersSent) response.destroy(error);
      else json(response, { error: error.code ?? 'CKAN_REQUEST_FAILED',
        message: error.code ? error.message : 'The request did not complete. Read the project status and retry the action.' },
        Number.isInteger(error.status) ? error.status : 400);
    }
  });
  server.requestTimeout = 300000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = new URL('http://127.0.0.1:' + server.address().port).origin;
  return { server, origin, token, instanceId, url: origin + '/#' + token,
    close() { return closing ??= new Promise(resolve => { server.close(resolve); server.closeIdleConnections?.(); }); } };
}

