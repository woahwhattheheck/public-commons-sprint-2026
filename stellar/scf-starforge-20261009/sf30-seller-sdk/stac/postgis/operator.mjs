import {createServer} from 'node:http';
import {readFile, readdir} from 'node:fs/promises';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {resolve} from 'node:path';
import {need, canonical, parseExactJSON, normalizeProfile, digest} from './contract.mjs';
import {openPostgisIntake} from './index.mjs';
import {readBrowserAssets} from '../../../distribution/browser-assets.mjs';
import {openVectorExport} from '../vector/index.mjs';
import {claimDirectory, member, writeJSONOnce, readJSON, fileRecord} from './files.mjs';

const ACTIONS = Object.freeze({
  inspect: 'inspect', stage: 'stage', review: 'review', row: 'readRow', promote: 'promote', rollback: 'rollback',
  'export-receiving': 'exportReceiving', 'export-backup': 'exportBackup', 'restore-backup': 'restoreBackup'
});
const MUTATIONS = new Set(['stage', 'promote', 'rollback', 'export-receiving', 'export-backup', 'restore-backup']);
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;

export async function startOperator({connection, profile: inputProfile, directory, python, port = 0}) {
  const profile = normalizeProfile(inputProfile);
  const assets = await readBrowserAssets(new URL('./browser-assets.json', import.meta.url));
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'POSTGIS_OPERATOR_PORT_INVALID');
  const root = resolve(directory), cookie = randomBytes(32).toString('hex');
  const initial = await openPostgisIntake({connection, profile, directory: root, python});
  await initial.close();
  let origin, queue = Promise.resolve(), closing = false;
  const constants = {projectId: profile.projectId, profile, profileSha256: digest(profile)};
  async function withIntake(selectedProfile, fn) {
    const selected = normalizeProfile(selectedProfile || profile);
    need(selected.projectId === profile.projectId && canonical(selected.database) === canonical(profile.database),
      'POSTGIS_OPERATOR_SELECTED_DATABASE_CHANGED');
    const intake = await openPostgisIntake({connection, profile: selected, directory: root, python});
    let result, primaryError;
    try { result = await fn(intake); } catch (error) { primaryError = error; }
    try { await intake.close(); }
    catch (error) {
      if (!primaryError) primaryError = error;
      else if (Object.isExtensible(primaryError)) primaryError.cleanupError = error;
      else primaryError = new AggregateError([primaryError, error], 'Native operation and client cleanup failed');
    }
    if (primaryError) throw primaryError;
    return result;
  }
  async function execute(action, supplied) {
    need(ACTIONS[action] || action === 'source-inspect' || action === 'history', 'POSTGIS_OPERATOR_ACTION_NOT_FOUND');
    const selectedProfile = supplied.profile || profile, request = supplied.request || {};
    if (action === 'source-inspect') {
      const source = await openVectorExport(request.sourceDirectory,
        {python, expectedManifestSha256: request.expectedManifestSha256, native: true});
      const capture = await readJSON(member(source.directory, 'source/capture.json'));
      const inspection = await readJSON(member(source.directory, 'source/inspection.json'));
      return {schema: 'starforge.postgis-source-review.v1', manifest: source.manifest,
        manifestFile: source.manifestFile, selection: capture.selection, inspection, native: source.receiving};
    }
    if (action === 'history') {
      const result = await withIntake(selectedProfile, intake => intake.operationHistory(request));
      const unfinishedRequests = [], incompleteJournals = [], directory = member(root, 'operator-requests');
      let names = [];
      try { names = await readdir(directory, {withFileTypes: true}); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const acceptOriginal = (original, name) => {
        need(original.schema === 'starforge.postgis-operator-request.v1' &&
          original.profile?.projectId === profile.projectId && MUTATIONS.has(original.action) &&
          typeof original.request?.operationId === 'string' &&
          digest({operationId: original.request.operationId}) === name &&
          canonical(normalizeProfile(original.profile).database) === canonical(profile.database),
          'POSTGIS_OPERATOR_ORIGINAL_REQUEST_CHANGED');
        return {action: original.action, request: original.request, profile: original.profile};
      };
      for (const name of names) {
        if (!name.isDirectory() || !/^[a-f0-9]{64}$/.test(name.name)) continue;
        const path = member(directory, name.name);
        try {
          let completed;
          try { completed = await readJSON(member(path, 'original-result.json')); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (completed) continue;
          let original;
          try { original = await readJSON(member(path, 'request.json')); }
          catch (error) {
            if (error.code !== 'ENOENT') throw error;
            const files = await readdir(path), recovered = [];
            for (const file of files) {
              if (!/^request\.json\.receiving-(?:[a-f0-9]{64}-)?[a-f0-9-]{36}$/.test(file)) continue;
              try {
                const record = await fileRecord(member(path, file), file);
                if (record.bytes > MAX_REQUEST_BYTES) continue;
                const embeddedSha256 = /^request\.json\.receiving-([a-f0-9]{64})-/.exec(file)?.[1];
                if (embeddedSha256 && embeddedSha256 !== record.sha256) continue;
                const candidate = await readJSON(member(path, file));
                recovered.push(acceptOriginal(candidate, name.name));
              } catch {}
            }
            const unique = new Map(recovered.map(item => [canonical(item), item]));
            incompleteJournals.push({journal: name.name, state: 'request-publication-incomplete',
              files, originalRequestRecovered: unique.size === 1});
            if (unique.size === 1) unfinishedRequests.push([...unique.values()][0]);
            continue;
          }
          unfinishedRequests.push(acceptOriginal(original, name.name));
        } catch (error) {
          incompleteJournals.push({journal: name.name, state: 'retained-journal-needs-review',
            errorCode: error.code || error.name || 'POSTGIS_JOURNAL_READ_FAILED'});
        }
      }
      return {...result, unfinishedRequests, incompleteJournals};
    }
    let journal;
    if (MUTATIONS.has(action)) {
      need(typeof request.operationId === 'string', 'POSTGIS_ORIGINAL_OPERATION_ID_REQUIRED');
      journal = await claimDirectory(member(root, 'operator-requests/' + digest({operationId: request.operationId})), {
        schema: 'starforge.postgis-operator-request.v1', action, profile: normalizeProfile(selectedProfile), request});
    }
    const result = await withIntake(selectedProfile, intake => intake[ACTIONS[action]](request));
    if (journal) {
      let originalResult;
      try { originalResult = await readJSON(member(journal, 'original-result.json')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (originalResult) need(originalResult.operationId === result.operationId &&
        originalResult.requestSha256 === result.requestSha256, 'POSTGIS_OPERATOR_RESULT_IDENTITY_CHANGED');
      else await writeJSONOnce(member(journal, 'original-result.json'), result);
    }
    if (action === 'inspect') {
      const selected = normalizeProfile(selectedProfile);
      return {...result, selectedProfile: selected, selectedProfileSha256: digest(selected)};
    }
    return result;
  }
  function json(response, status, body) {
    response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer'});
    response.end(canonical(body) + '\n');
  }
  const server = createServer(async (request, response) => {
    try {
      need(!closing, 'POSTGIS_OPERATOR_CLOSING');
      need(request.headers.host === origin?.slice('http://'.length), 'POSTGIS_OPERATOR_HOST_REQUIRED');
      const url = new URL(request.url, origin);
      if (request.method === 'GET' && assets.has(url.pathname)) {
        need(!request.headers.origin || request.headers.origin === origin, 'POSTGIS_OPERATOR_ORIGIN_REQUIRED');
        need(request.headers['sec-fetch-site'] !== 'cross-site', 'POSTGIS_OPERATOR_LOCAL_NAVIGATION_REQUIRED');
        const asset = assets.get(url.pathname), type = asset.type;
        const body = await readFile(asset.url);
        response.writeHead(200, {'content-type': type, 'content-length': body.length, 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          ...(url.pathname === '/' ? {'set-cookie': 'postgis_operator=' + cookie + '; HttpOnly; SameSite=Strict; Path=/'} : {})});
        response.end(body); return;
      }
      const suppliedCookie = (request.headers.cookie || '').split(';').map(part => part.trim())
        .find(part => part.startsWith('postgis_operator='))?.slice('postgis_operator='.length);
      need(typeof suppliedCookie === 'string' && suppliedCookie.length === cookie.length &&
        timingSafeEqual(Buffer.from(suppliedCookie), Buffer.from(cookie)), 'POSTGIS_OPERATOR_SESSION_REQUIRED');
      if (request.method === 'GET' && url.pathname === '/api/config') { json(response, 200, constants); return; }
      need(request.method === 'POST' && url.pathname.startsWith('/api/'), 'POSTGIS_OPERATOR_ROUTE_NOT_FOUND');
      need(request.headers.origin === origin && /^application\/json(?:;|$)/i.test(request.headers['content-type'] || ''),
        'POSTGIS_OPERATOR_SAME_ORIGIN_JSON_REQUIRED');
      let bytes = 0;
      const parts = [];
      for await (const part of request) {
        bytes += part.length; need(bytes <= MAX_REQUEST_BYTES, 'POSTGIS_OPERATOR_REQUEST_TOO_LARGE');
        parts.push(part);
      }
      const body = parseExactJSON(Buffer.concat(parts).toString('utf8'));
      need(body && typeof body === 'object' && !Array.isArray(body), 'POSTGIS_OPERATOR_REQUEST_OBJECT_REQUIRED');
      const action = url.pathname.slice('/api/'.length);
      // One native operation is active in this operator; database project locks
      // and original request identities also coordinate independent CLI clients.
      const operation = queue.then(() => execute(action, body));
      queue = operation.catch(() => {});
      const result = await operation;
      json(response, 200, {ok: true, result});
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const code = error.code?.startsWith('POSTGIS_') ? error.code : 'POSTGIS_NATIVE_OPERATION_FAILED';
      const status = /SESSION|ORIGIN|HOST|NAVIGATION/.test(code) ? 403 : /TOO_LARGE/.test(code) ? 413 :
        /CHANGED|CONFLICT|REQUIRED|MISSING|INVALID/.test(code) ? 409 : 500;
      json(response, status, {ok: false, error: {code,
        message: error.code?.startsWith('POSTGIS_') ? error.message : 'The selected database operation did not complete.',
        detail: error.code?.startsWith('POSTGIS_') ? error.detail : undefined,
        operationId: error.operationId, commitOutcome: error.postgisCommitOutcome}});
    }
  });
  await new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', ready);
  });
  origin = 'http://127.0.0.1:' + server.address().port;
  server.requestTimeout = 0; server.headersTimeout = 30000;
  let closePromise;
  const close = () => closePromise ||= (async () => {
    closing = true; await queue;
    await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  })();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { close().finally(() => process.exit(0)); });
  return {url: origin, server, close};
}
