// MIT. Private research dossier operator over the maintained dossier engine.
import { createServer } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { openDossierStore } from './dossier.mjs';
import { openClinicalTrialsWorkspace } from './clinical-trials-workspace.mjs';
import { handleClinicalTrialsRoute } from './clinical-trials-routes.mjs';
import { receiveOpenAlexEdition } from './openalex.mjs';
import { openSavedOpenAlexWorkspace } from './openalex-workspace.mjs';
import { openUnstructuredWorkspace, openSavedDocumentBuyerSource } from './unstructured-workspace.mjs';
import { openUnstructuredPipelineWorkspace, openSavedPipelineSource, PIPELINE_UPLOAD_BODY_BYTES } from './unstructured-pipelines-workspace.mjs';

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const TYPES = Object.freeze({
  'index.html': 'text/html; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'style.css': 'text/css; charset=utf-8',
  'crossref.js': 'text/javascript; charset=utf-8',
  'unstructured.js': 'text/javascript; charset=utf-8',
  'unstructured.css': 'text/css; charset=utf-8',
  'unstructured-pipelines.js': 'text/javascript; charset=utf-8',
  'unstructured-pipelines.css': 'text/css; charset=utf-8',
  'clinical-trials.js': 'text/javascript; charset=utf-8',
  'clinical-trials.css': 'text/css; charset=utf-8',
});
const MAX_RESEARCH_BODY = 96 * 1024 * 1024 + 65536; // 16 MiB raw UTF-8, worst-case JSON escaping plus envelope.
const MAX_PORTABLE_BODY = 256 * 1024 * 1024 + 65536; // Engine caps the serialized portable record at 256 MiB.
const MAX_CONTROL_BODY = 1024 * 1024;
const jsonBytes = value => Buffer.from(JSON.stringify(value) + '\n');
const fail = code => { throw Object.assign(new Error(code), {code}); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeCode = error => typeof error?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(error.code) ? error.code : 'DOSSIER_OPERATION_FAILED';

async function readJson(req, limit) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  requireValue(type === 'application/json', 'JSON_BODY_REQUIRED');
  const declared = req.headers['content-length'];
  if (declared !== undefined) {
    requireValue(/^[0-9]+$/.test(declared), 'CONTENT_LENGTH_INVALID');
    requireValue(Number(declared) <= limit, 'UPLOAD_SIZE_LIMIT');
  }
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    requireValue(length <= limit, 'UPLOAD_SIZE_LIMIT');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); }
  catch { fail('JSON_INVALID'); }
  requireValue(plain(value), 'JSON_OBJECT_REQUIRED');
  return value;
}
function revision(value) {
  requireValue(Number.isSafeInteger(value) && value >= 0, 'EXPECTED_REVISION_REQUIRED');
  return value;
}
function selectedFields(value, keys) {
  const result = {};
  for (const key of keys) if (Object.hasOwn(value, key)) result[key] = value[key];
  return result;
}
function pathId(value) {
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { fail('DOSSIER_ID_INVALID'); }
  requireValue(typeof decoded === 'string' && decoded.length > 0 && decoded.length <= 160 &&
    !/[\u0000-\u001f\u007f/\\]/.test(decoded), 'DOSSIER_ID_INVALID');
  return decoded;
}
function revisionQuery(value) {
  requireValue(typeof value === 'string' && /^[0-9]{1,12}$/.test(value), 'REVISION_INVALID');
  const result = Number(value);
  requireValue(Number.isSafeInteger(result), 'REVISION_INVALID');
  return result;
}
function safeFilename(value) {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(value),
    'EXPORT_FILENAME_INVALID');
  return value;
}
function providerRegistry(value) {
  requireValue(plain(value), 'EDITION_ADAPTER_PROVIDERS_INVALID');
  for (const [name, provider] of Object.entries(value)) {
    requireValue(/^[a-z][a-z0-9_-]{0,79}$/.test(name) && plain(provider) && typeof provider.read === 'function',
      'EDITION_ADAPTER_PROVIDER_INVALID');
  }
  return value;
}

/** Adapter modules are selected by the local launch command, never by browser input. */
export async function loadEditionAdapters(modulePath) {
  requireValue(typeof modulePath === 'string' && isAbsolute(modulePath) && resolve(modulePath) === modulePath,
    'EDITION_ADAPTER_ABSOLUTE_PATH_REQUIRED');
  const loaded = await import(pathToFileURL(modulePath).href);
  return providerRegistry(loaded.providers);
}

/** Reuses the existing SF88 loopback / fragment-token operator convention. */
export async function startDossierWorkspace({directory, port = 0, providers = {}, openalexWorkspace = null,
  crossrefSource = null, crossrefIdentity = null, documentSource = null, pipelineSource = null, clinicalTrialsInputs = null, clinicalTrialsPython = 'python3'} = {}) {
  requireValue(typeof directory === 'string' && isAbsolute(directory) && resolve(directory) === directory,
    'WORKSPACE_ABSOLUTE_PATH_REQUIRED');
  requireValue(Number.isInteger(port) && port >= 0 && port <= 65535, 'WORKSPACE_PORT_INVALID');
  providers = {...providerRegistry(providers)};
  requireValue(documentSource === null || plain(documentSource) && Object.keys(documentSource).every(key =>
    ['buyer','workspaceId','inboxDirectory','runtimeDirectory'].includes(key)), 'DOCUMENT_SOURCE_INVALID');
  requireValue(openalexWorkspace === null || typeof openalexWorkspace?.listEditions === 'function' &&
    typeof openalexWorkspace?.exportFiles === 'function', 'OPENALEX_WORKSPACE_API_REQUIRED');
  const store = await openDossierStore(directory, {providers});
  await store.list();
  const unstructured = await openUnstructuredWorkspace({dossiers:store,...(documentSource ?? {})});
  if (unstructured.provider) {
    requireValue(!Object.hasOwn(providers, 'unstructured'), 'DOCUMENT_PROVIDER_ALREADY_CONFIGURED');
    providers.unstructured = unstructured.provider;
  }
  let crossref = null;
  if (crossrefSource !== null) {
    const {openCrossrefWorkspace} = await import('./crossref-workspace.mjs');
    crossref = await openCrossrefWorkspace({directory:join(directory,'crossref'),dossiers:store,
      source:crossrefSource,identity:crossrefIdentity});
  }
  const pipelines = await openUnstructuredPipelineWorkspace({dossiers:store,source:pipelineSource});
  let clinicalTrials;
  try {
    clinicalTrials = await openClinicalTrialsWorkspace({directory:join(directory,'clinical-trials'),
      dossiers:store,inputs:clinicalTrialsInputs,python:clinicalTrialsPython});
  } catch (error) {unstructured.clear(); await pipelines.close(); await crossref?.close(); throw error;}
  const token = randomBytes(32).toString('hex');
  const expectedAuthorization = Buffer.from('Bearer ' + token);
  let origin;
  const server = createServer(async (req, res) => {
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    };
    const send = (status, data, type = 'application/json; charset=utf-8', filename) => {
      const content = Buffer.isBuffer(data) ? data : jsonBytes(data);
      res.writeHead(status, {...headers, 'Content-Type': type, 'Content-Length': content.length,
        ...(filename ? {'Content-Disposition': 'attachment; filename="' + safeFilename(filename) + '"'} : {})});
      res.end(content);
    };
    try {
      requireValue(req.headers.host === new URL(origin).host, 'HOST_REFUSED');
      requireValue(!req.headers.origin || req.headers.origin === origin, 'ORIGIN_REFUSED');
      const url = new URL(req.url, origin);
      const path = url.pathname;
      if ((req.method === 'GET' || req.method === 'HEAD') && (path === '/' || Object.hasOwn(TYPES, path.slice(1)))) {
        const name = path === '/' ? 'index.html' : path.slice(1);
        const content = await readFile(join(PUBLIC, name));
        if (req.method === 'HEAD') {
          res.writeHead(200, {...headers, 'Content-Type': TYPES[name], 'Content-Length': content.length}); res.end();
        } else send(200, content, TYPES[name]);
        return;
      }
      const auth = Buffer.from(req.headers.authorization || '');
      requireValue(auth.length === expectedAuthorization.length && timingSafeEqual(auth, expectedAuthorization),
        'AUTH_REQUIRED');
      if (req.method === 'GET' && path === '/api/state') {
        send(200, {dossiers: await store.list(), providers: Object.keys(providers),
          openalex: {configured:openalexWorkspace !== null},
          crossref: {configured:crossref !== null,identity:crossrefIdentity},
          unstructured: {configured:unstructured.configured,workspaceId:unstructured.workspaceId},
          pipelines: await pipelines.configured(),
          clinicalTrials: {configured:true,inputFormat:'stellar-forge.clinicaltrials-packet.v1'}}); return;
      }
      if (req.method === 'GET' && path === '/api/openalex/editions') {
        requireValue(openalexWorkspace !== null, 'OPENALEX_WORKSPACE_NOT_CONFIGURED');
        const editions = await openalexWorkspace.listEditions();
        requireValue(Array.isArray(editions), 'OPENALEX_EDITION_LIST_INVALID');
        send(200, {editions:editions.filter(edition => edition?.query?.entity === 'works')}); return;
      }
      if (req.method === 'POST' && path === '/api/dossiers') {
        const data = await readJson(req, MAX_CONTROL_BODY);
        send(201, await store.create(selectedFields(data, ['title', 'description']))); return;
      }
      if (req.method === 'POST' && path === '/api/reopen-stream') {
        const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        requireValue(['application/json', 'application/gzip', 'application/x-gzip', 'application/octet-stream'].includes(type),
          'PORTABLE_BODY_REQUIRED');
        const declared = req.headers['content-length'];
        if (declared !== undefined) {
          requireValue(/^[0-9]+$/.test(declared), 'CONTENT_LENGTH_INVALID');
          requireValue(Number(declared) <= 256 * 1024 * 1024, 'UPLOAD_SIZE_LIMIT');
        }
        send(200, await store.reopenStream(req)); return;
      }
      if (req.method === 'POST' && path === '/api/reopen') {
        const data = await readJson(req, MAX_PORTABLE_BODY);
        requireValue(plain(data.portable), 'PORTABLE_DOSSIER_REQUIRED');
        send(200, await store.reopen(data.portable)); return;
      }
      const match = path.match(/^\/api\/dossiers\/([^/]+)(?:\/(.*))?$/);
      if (!match) {send(404, {error: 'ROUTE_NOT_FOUND'}); return;}
      const id = pathId(match[1]), action = match[2] || '';
      if (req.method === 'GET' && action === '') {
        const options = url.searchParams.has('revision') ? {revision: revisionQuery(url.searchParams.get('revision'))} : {};
        send(200, await store.get(id, options)); return;
      }
      if (await handleClinicalTrialsRoute({workspace:clinicalTrials,dossierId:id,action,req,url,
        readBody:()=>readJson(req,MAX_CONTROL_BODY),send})) return;
      if (req.method === 'GET' && action === 'unstructured') {
        send(200, await unstructured.list(id, {
          after:url.searchParams.get('after') ?? '',
          limit:url.searchParams.has('limit') ? revisionQuery(url.searchParams.get('limit')) : 20,
        })); return;
      }
      if (req.method === 'GET' && action === 'pipelines') {
        send(200, await pipelines.list(id, {after:url.searchParams.get('after')??'',
          limit:url.searchParams.has('limit')?revisionQuery(url.searchParams.get('limit')):30})); return;
      }
      const pipelineMatch = action.match(/^pipelines\/operations\/(up_[a-f0-9]{64})(?:\/(submit|refresh|cancel|reconcile|retain|provider-jobs|inputs|outputs)(?:\/((?:in_|out_)[a-f0-9]{64}))?)?$/);
      if (pipelineMatch && req.method === 'GET') {
        if (!pipelineMatch[2]) {send(200, await pipelines.inspect(id,pipelineMatch[1])); return;}
        if (['inputs','outputs'].includes(pipelineMatch[2]) && pipelineMatch[3]) {
          const original = await pipelines[pipelineMatch[2] === 'inputs' ? 'inputFile' : 'outputFile'](id,pipelineMatch[1],pipelineMatch[3]);
          send(200,original.bytes,original.contentType,original.filename); return;
        }
      }
      if (req.method === 'GET' && action === 'crossref/operations') {
        requireValue(crossref !== null, 'CROSSREF_WORKSPACE_NOT_CONFIGURED');
        send(200, await crossref.list(id, {after:url.searchParams.get('after')??'',
          limit:url.searchParams.has('limit')?revisionQuery(url.searchParams.get('limit')):30})); return;
      }
      const crossrefMatch = action.match(/^crossref\/operations\/(cr_[a-f0-9]{64})(?:\/(start|stop|receive|edition))?$/);
      if (crossrefMatch) {
        requireValue(crossref !== null, 'CROSSREF_WORKSPACE_NOT_CONFIGURED');
        const selected = await crossref.inspect(crossrefMatch[1], {probe:false});
        requireValue(selected.plan.request.dossierId === id, 'CROSSREF_OPERATION_DOSSIER_MISMATCH');
        if (req.method === 'GET' && !crossrefMatch[2]) {send(200, await crossref.review(crossrefMatch[1])); return;}
        if (req.method === 'GET' && crossrefMatch[2] === 'edition') {
          const retained = await crossref.edition(crossrefMatch[1]);
          send(200, retained.bytes, 'application/json; charset=utf-8', crossrefMatch[1]+'.crossref.json'); return;
        }
      }
      if (req.method === 'GET' && action === 'compare') {
        send(200, await store.compare(id, {before: revisionQuery(url.searchParams.get('before')),
          after: revisionQuery(url.searchParams.get('after'))})); return;
      }
      if (req.method === 'GET' && action === 'export') {
        const format = url.searchParams.get('format');
        requireValue(['json', 'json.gz', 'md', 'html'].includes(format), 'EXPORT_FORMAT_INVALID');
        if (format === 'json' || format === 'json.gz') {
          const result = await store.exportStream(id, {compression: format === 'json.gz' ? 'gzip' : 'none'});
          res.writeHead(200, {...headers, 'Content-Type': result.contentType,
            'Content-Disposition': 'attachment; filename="' + safeFilename(result.filename) + '"'});
          await pipeline(result.body, res); return;
        }
        const result = await store.exportDossier(id, {format});
        requireValue(typeof result.body === 'string' || result.body instanceof Uint8Array, 'EXPORT_BODY_INVALID');
        const type = {'json': 'application/json; charset=utf-8', md: 'text/markdown; charset=utf-8',
          html: 'text/html; charset=utf-8'}[format];
        send(200, Buffer.from(result.body), type, result.filename); return;
      }
      if (req.method !== 'POST') {send(405, {error: 'METHOD_NOT_ALLOWED'}); return;}
      const data = await readJson(req, action === 'pipelines/prepare' ? PIPELINE_UPLOAD_BODY_BYTES :
        ['receive', 'reference'].includes(action) ? MAX_RESEARCH_BODY : MAX_CONTROL_BODY);
      if (action === 'pipelines/prepare') {
        send(201,await pipelines.prepare(id,data)); return;
      }
      if (pipelineMatch && !pipelineMatch[3]) {
        if (pipelineMatch[2] === 'provider-jobs') {
          send(200,await pipelines.providerJobs(id,pipelineMatch[1],data)); return;
        }
        if (['submit','refresh','cancel','reconcile','retain'].includes(pipelineMatch[2])) {
          send(200,await pipelines.act(id,pipelineMatch[1],pipelineMatch[2],data)); return;
        }
      }
      if (action === 'pipelines/review') {
        send(200,await pipelines.review(id,data.selection)); return;
      }
      if (action === 'pipelines/elements') {
        send(200,await pipelines.elements(id,selectedFields(data,
          ['selection','expectedEditionSha256','offset','limit','page','type','query']))); return;
      }
      if (action === 'pipelines/download') {
        const original=await pipelines.download(id,selectedFields(data,
          ['selection','expectedEditionSha256','file']));
        send(200,original.bytes,original.contentType,original.filename); return;
      }
      if (action === 'pipelines/receive') {
        send(200,await pipelines.receive(id,data)); return;
      }
      if (action === 'unstructured/review') {
        send(200, await unstructured.review(id, data.selection)); return;
      }
      if (action === 'unstructured/elements') {
        send(200, await unstructured.elements(id, selectedFields(data,
          ['selection','expectedEditionSha256','offset','limit','page','type','query']))); return;
      }
      if (action === 'unstructured/download') {
        const result = await unstructured.download(id, selectedFields(data,
          ['selection','expectedEditionSha256','file']));
        send(200, result.bytes, result.contentType, result.filename); return;
      }
      if (action === 'unstructured/receive') {
        send(200, await unstructured.receive(id, selectedFields(data,
          ['selection','expectedEditionSha256','questionId','label','expectedRevision']))); return;
      }
      if (action === 'crossref/prepare') {
        requireValue(crossref !== null, 'CROSSREF_WORKSPACE_NOT_CONFIGURED');
        send(201, await crossref.prepare(id, data)); return;
      }
      if (crossrefMatch && ['start','stop','receive'].includes(crossrefMatch[2])) {
        const operationId = crossrefMatch[1], operation = crossrefMatch[2];
        if (operation === 'start') {send(202, await crossref.start(operationId, selectedFields(data, ['expectedPlanSha256']))); return;}
        if (operation === 'stop') {send(200, await crossref.stop(operationId)); return;}
        send(200, await crossref.receive(operationId, selectedFields(data,
          ['expectedRevision','expectedPlanSha256','expectedEditionSha256']))); return;
      }
      const expectedRevision = revision(data.expectedRevision);
      if (action === '') {
        send(200, await store.update(id, {...selectedFields(data, ['title', 'description']), expectedRevision})); return;
      }
      if (action === 'questions') {
        send(201, await store.addQuestion(id, {...selectedFields(data, ['text']), expectedRevision})); return;
      }
      const questionMatch = action.match(/^questions\/([^/]+)$/);
      if (questionMatch) {
        send(200, await store.updateQuestion(id, pathId(questionMatch[1]),
          {...selectedFields(data, ['text', 'notes', 'status']), expectedRevision})); return;
      }
      if (action === 'receive') {
        requireValue(typeof data.rawText === 'string' && data.rawText.length > 0, 'ORIGINAL_RESEARCH_TEXT_REQUIRED');
        send(201, await store.receive(id, {...selectedFields(data,
          ['questionId', 'label', 'provider', 'rawText', 'sourceReference']), expectedRevision})); return;
      }
      if (action === 'openalex') {
        requireValue(openalexWorkspace !== null, 'OPENALEX_WORKSPACE_NOT_CONFIGURED');
        const controller = new AbortController();
        const disconnected = () => {if (!res.writableEnded) controller.abort();};
        res.once('close', disconnected);
        try {
          const imported = await receiveOpenAlexEdition(store, id, {workspace:openalexWorkspace,
            ...selectedFields(data, ['questionId', 'editionId', 'label']), expectedRevision,
            signal:controller.signal});
          send(201, imported); return;
        } finally {res.removeListener('close', disconnected);}
      }
      if (action === 'reference') {
        requireValue(typeof data.provider === 'string' && /^[a-z][a-z0-9_-]{0,79}$/.test(data.provider),
          'PROVIDER_INVALID');
        requireValue(plain(data.reference), 'PROVIDER_EDITION_REFERENCE_REQUIRED');
        send(201, await store.receiveReference(id, {...selectedFields(data,
          ['questionId', 'label', 'provider', 'reference']), expectedRevision})); return;
      }
      if (action === 'evidence') {
        send(200, await store.selectEvidence(id, {...selectedFields(data,
          ['sourceId', 'selected', 'note', 'classification']), expectedRevision})); return;
      }
      if (action === 'selections') {
        send(200, await store.updateSelection(id, {...selectedFields(data,
          ['occurrenceId', 'selected', 'note', 'classification']), expectedRevision})); return;
      }
      const findingMatch = action.match(/^findings\/([^/]+)$/);
      if (findingMatch) {
        send(200, await store.updateFinding(id, pathId(findingMatch[1]), {...selectedFields(data,
          ['title', 'text', 'sourceIds']), expectedRevision})); return;
      }
      if (action === 'findings') {
        send(201, await store.addFinding(id, {...selectedFields(data,
          ['questionId', 'title', 'text', 'sourceIds']), expectedRevision})); return;
      }
      send(404, {error: 'ROUTE_NOT_FOUND'});
    } catch (error) {
      if (res.headersSent) {res.destroy(); return;}
      const code = safeCode(error);
      const status = code === 'AUTH_REQUIRED' ? 401 : ['HOST_REFUSED', 'ORIGIN_REFUSED'].includes(code) ? 403 :
        ['REVISION_CONFLICT','PORTABLE_HISTORY_CONFLICT','ROUTESCAN_RECORD_BUSY','CROSSREF_OPERATION_RUNNING_ELSEWHERE','UNSTRUCTURED_REVIEWED_EDITION_CHANGED','UNSTRUCTURED_RECEIVING_LABEL_CONFLICT','CLINICALTRIALS_REVIEW_CHANGED','CLINICALTRIALS_PLAN_CHANGED','CLINICALTRIALS_QUESTION_CHANGED','CLINICALTRIALS_SOURCE_CONFIGURATION_CHANGED','PIPELINE_REVISION_CHANGED','PIPELINE_REVIEWED_EDITION_CHANGED',
          'PIPELINE_PREPARATION_REQUEST_CHANGED','PIPELINE_RECEIVING_REQUEST_CHANGED','PIPELINE_REVIEWED_PLAN_CHANGED',
          'PIPELINE_ACTION_REQUEST_REUSED','PIPELINE_OPERATION_RUNNING_ELSEWHERE'].includes(code) ? 409 : code === 'ENOENT' || code === 'DOSSIER_NOT_FOUND' ? 404 :
          ['UPLOAD_SIZE_LIMIT','PORTABLE_SIZE_LIMIT','PORTABLE_RECORD_SIZE_LIMIT','PIPELINE_UPLOAD_TOO_LARGE'].includes(code) ? 413 : 400;
      send(status, {error: code, ...(error.openAlexImport ? {openAlexImport:error.openAlexImport} : {})});
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  try {
    await new Promise((accept, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', accept);
    });
  } catch (error) {unstructured.clear(); await clinicalTrials.close(); await pipelines.close(); await crossref?.close(); throw error;}
  origin = 'http://127.0.0.1:' + server.address().port;
  let closing;
  return {server, origin, url: origin + '/#token=' + token, token, crossref, unstructured, pipelines, clinicalTrials,
    close: () => closing ??= (async () => {
      unstructured.clear();
      await pipelines.close();
      await clinicalTrials.close();
      await crossref?.close();
      await new Promise((accept, reject) => {
        server.close(error => error ? reject(error) : accept()); server.closeIdleConnections();
      });
    })()};
}

function parseOptions(args) {
  requireValue(args.length % 2 === 0, 'ARGUMENT_VALUE_REQUIRED');
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    requireValue(['--dir', '--port', '--edition-adapter', '--openalex-workspace', '--openalex-module', '--crossref-config', '--crossref-state', '--document-source', '--pipeline-source', '--clinical-trials-python'].includes(key) && !Object.hasOwn(options, key) &&
      typeof args[index + 1] === 'string' && args[index + 1].length > 0, 'ARGUMENT_INVALID_OR_REPEATED');
    options[key] = args[index + 1];
  }
  const rawPort = options['--port'] ?? '0';
  requireValue(/^[0-9]{1,5}$/.test(rawPort), 'WORKSPACE_PORT_INVALID');
  requireValue(!options['--openalex-module'] || options['--openalex-workspace'], 'OPENALEX_WORKSPACE_REQUIRED');
  requireValue(!options['--crossref-config'] || options['--crossref-state'], 'CROSSREF_SOURCE_STATE_REQUIRED');
  return {directory: options['--dir'], port: Number(rawPort), adapter: options['--edition-adapter'],
    openalexDirectory:options['--openalex-workspace'], openalexModule:options['--openalex-module'],
    crossrefConfig:options['--crossref-config'],crossrefDirectory:options['--crossref-state'],
    documentSourceConfig:options['--document-source'],pipelineSourceConfig:options['--pipeline-source'],clinicalTrialsPython:options['--clinical-trials-python']??'python3'};
}
async function main(args) {
  if (args.length === 0 || args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write('Usage: node server.mjs --dir /absolute/private/workspace [--port 8846] [--edition-adapter /absolute/provider-adapters.mjs] [--openalex-workspace /absolute/original/workspace] [--openalex-module /absolute/original/research/workspace.mjs] [--crossref-state /absolute/private/crossref-source] [--crossref-config /absolute/crossref-merchant.json] [--document-source /absolute/private/document-source.json] [--pipeline-source /absolute/private/pipeline-source.json] [--clinical-trials-python /absolute/python3]\n');
    return;
  }
  const options = parseOptions(args);
  const providers = options.adapter ? await loadEditionAdapters(options.adapter) : {};
  const openalexWorkspace = options.openalexDirectory ? await openSavedOpenAlexWorkspace({
    directory:options.openalexDirectory, modulePath:options.openalexModule,
  }) : null;
  let app, crossrefSource = null, crossrefIdentity = null, documentSource = null, pipelineSource = null;
  try {
    if (options.crossrefDirectory) {
      requireValue(isAbsolute(options.crossrefDirectory) && (!options.crossrefConfig || isAbsolute(options.crossrefConfig)), 'CROSSREF_ABSOLUTE_PATHS_REQUIRED');
      const [{createCrossrefSource},{sha256,json}] = await Promise.all([
        import('../../sf30-seller-sdk/crossref/source.mjs'),import('../../sf30-seller-sdk/crossref/metadata.mjs')]);
      let sourceOptions = {directory:options.crossrefDirectory,account:'crossref-public',cacheSeconds:86400,
        timeoutMs:30000,maxResponseBytes:16*1024*1024};
      let configSha256 = sha256(json({account:sourceOptions.account,cacheSeconds:sourceOptions.cacheSeconds,
        timeoutMs:sourceOptions.timeoutMs,maxResponseBytes:sourceOptions.maxResponseBytes,mode:'public'}));
      if (options.crossrefConfig) {
        const [{readCrossrefConfig},{crossrefSourceOptions}] = await Promise.all([
          import('../../sf30-seller-sdk/crossref/config.mjs'),import('../../sf30-seller-sdk/crossref/merchant.mjs')]);
        const compiled = await readCrossrefConfig(options.crossrefConfig);
        sourceOptions = crossrefSourceOptions(compiled,{sourceDirectory:options.crossrefDirectory});
        configSha256 = compiled.inputSha256;
      }
      crossrefSource = await createCrossrefSource(sourceOptions);
      const snapshot = await crossrefSource.snapshot();
      crossrefIdentity = {configSha256,account:snapshot.account,mode:snapshot.mode};
    }
    if (options.documentSourceConfig) documentSource = await openSavedDocumentBuyerSource(options.documentSourceConfig);
    if (options.pipelineSourceConfig) pipelineSource = await openSavedPipelineSource(options.pipelineSourceConfig);
    app = await startDossierWorkspace({...options, providers, openalexWorkspace,crossrefSource,crossrefIdentity,documentSource,pipelineSource});
  } catch (error) {await pipelineSource?.operations.close();await crossrefSource?.close();await openalexWorkspace?.close();throw error;}
  process.stdout.write(JSON.stringify({mode: 'RESEARCH_DOSSIER_WORKSPACE', directory: options.directory,
    url: app.url, providers: Object.keys(providers), openalexConfigured:openalexWorkspace !== null,
    crossrefConfigured:crossrefSource !== null, documentSourceConfigured:documentSource !== null,
    documentWorkspaceId:documentSource?.workspaceId ?? null,clinicalTrialsConfigured:true,
    pipelineSourceConfigured:pipelineSource !== null,pipelineWorkspaceId:pipelineSource?.workspaceId ?? null}) + '\n');
  let closing;
  const stop = () => closing ??= (async () => {
    try {await app.close();} finally {
      try {await crossrefSource?.close();} finally {await openalexWorkspace?.close();process.exitCode = 0;}
    }
  })();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(JSON.stringify({error: safeCode(error)}) + '\n'); process.exitCode = 1;
  });
}
