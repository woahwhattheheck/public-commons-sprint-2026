#!/usr/bin/env node
// MIT. Installed WFS operator: original source, project, merchant and customer engines.
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { withPrivateLock } from '../routescan/quota.mjs';
import { need, jsonBytes, hash, operationId, LIMITS } from './model.mjs';
import { durableDirectory, exactFile } from './source.mjs';
import { initializeWfsProject, readWfsProject } from './project.mjs';
import {
  exportWfsProject, inspectWfsProjectBundle, receiveWfsProject,
  WFS_PROJECT_BUNDLE_DEFAULT_BYTES
} from './portable.mjs';
import { openWfsApplication } from './application.mjs';
import { startWfsWorkspace } from './workspace.mjs';
import { inspectWfsWorkspaceBinding } from './launch.mjs';
import {
  receiveWfsSourceDelivery, reopenWfsSources, exportWfsReceivedFile
} from './customer.mjs';
import { initializeWfsMerchantWorkspace } from './mcp-setup.mjs';

export const USAGE = String.raw`WFS feature desk — complete source, orders, publications and customer receiving

starforge wfs init --project ABS --name TEXT
starforge wfs show|queries --project ABS
starforge wfs serve --project ABS [--port N] [--connection-file PRIVATE_JSON]
  [--source-auth PRIVATE_JSON] [--buyer-config PRIVATE_JSON] [--python PYTHON]
  [--facilitator URL] [--allow-local-facilitator] [--merchant-port N]
  [--expected-binding-sha256 SHA]
starforge wfs binding --project ABS [the same operator configuration options]

starforge wfs discover --project ABS --id ID --revision N --endpoint HTTPS --name TEXT
  [--terms-file TEXTFILE] [--source-auth PRIVATE_JSON] [--allow-loopback]
starforge wfs catalog --project ABS --source SHA [--offset N] [--limit N]
starforge wfs describe --project ABS --id ID --revision N --source SHA --type-name PREFIX:NAME
  [--source-auth PRIVATE_JSON]
starforge wfs schema --project ABS --schema SHA
starforge wfs query --project ABS --id ID --revision N --source SHA --schema SHA
  --name TEXT --selection JSON
starforge wfs order --project ABS --id ID --revision N --query SHA --name TEXT
  [--limits JSON] [--source-auth PRIVATE_JSON]
starforge wfs resume --project ABS --id ORIGINAL_ID [--revision ORIGINAL_N]
  [--limits JSON] [--source-auth PRIVATE_JSON]
starforge wfs order-show|features|inspect|plan --project ABS --order SHA
  [features: --offset N --limit N]
starforge wfs compare --project ABS --id ID --revision N --before SHA --after SHA
  [--key-pointer /id]
starforge wfs comparison --project ABS --comparison SHA
  [--group added|removed|changed|ambiguous|missingBefore|missingAfter] [--offset N] [--limit N]
starforge wfs publish --project ABS --id ID --revision N --order SHA
  [--plan JSON] [--payment JSON --origin HTTPS] [--path /features]
starforge wfs publication|publication-open --project ABS --publication SHA
starforge wfs abandon --project ABS --id ID --revision N --pending ORIGINAL_ID --note TEXTFILE

starforge wfs merchant --project ABS --publication SHA [--merchant-port N]
  [--facilitator URL] [--allow-local-facilitator]
starforge wfs preview --project ABS --publication SHA [--kind rows|sources] [--query QUERY]
starforge wfs prepare --project ABS --publication SHA --intent ID
  [--kind rows|sources] [--query QUERY] [--file MEMBER] [--previous JSON] [--accept N]
starforge wfs buy|recover --project ABS --publication SHA --intent ID --buyer-config PRIVATE_JSON
starforge wfs customer-file --project ABS --publication SHA --intent ID
  --buyer-config PRIVATE_JSON --out FILE
starforge wfs dataset-prepare --project ABS --publication SHA --id ID --kind rows|sources
  --max-pages N --max-total-atomic INTEGER_TEXT [--max-rows N] [--query QUERY] [--accept N]
starforge wfs dataset-create|dataset-run|dataset-recover|dataset-inspect|dataset-deliver
  --project ABS --publication SHA --id ID --buyer-config PRIVATE_JSON
starforge wfs dataset-accounting|dataset-finalize|dataset-receive
  --project ABS --publication SHA --id ID --buyer-config PRIVATE_JSON
starforge wfs customer-reopen|customer-open --project ABS --publication SHA --id ID
starforge wfs dataset-file --project ABS --publication SHA --id ID
  --file dataset.csv|dataset.jsonl|review.html|manifest.json|semantics.json --out FILE

starforge wfs capabilities-file --project ABS --source SHA --out FILE
starforge wfs schema-file --project ABS --schema SHA --out FILE
starforge wfs raw-page --project ABS --order SHA --index N --out FILE
starforge wfs features-file --project ABS --order SHA --out FILE
starforge wfs comparison-file --project ABS --comparison SHA --out FILE
starforge wfs export --project ABS --out PROJECT_JSON [--max-bytes N]
starforge wfs inspect-bundle --source PROJECT_JSON [--max-bytes N]
starforge wfs receive --project EMPTY_OR_ORIGINAL_ABS --source PROJECT_JSON
  [--id ORIGINAL_ID] [--max-bytes N]
starforge wfs source-receive --project SOURCES_ABS
  (--source ORIGINAL_DELIVERY_JSON | --native-scan ORIGINAL_SCAN_JSON)
  [--capture-manifest SHA] [--source-set SHA]
starforge wfs sources-open --project RECEIVING_PROJECT_ABS --source SOURCES_ABS [--id ORIGINAL_ID]
starforge wfs source-file --source SOURCES_ABS --file ORIGINAL_MEMBER --out FILE
starforge wfs project-import --project ABS --source PROJECT_JSON
starforge wfs project-open --project ABS --bundle-sha SHA


starforge wfs vector-capture --project ABS --id ID --order SHA --source-crs CRS
  --coordinate-order x,y [--source-id ID] [--selection-id ID] [--identity JSON]
starforge wfs vector-list --project ABS [--offset N] [--limit N]
starforge wfs vector-show --project ABS --id ID
starforge wfs vector-export --project ABS --id ID --capture ORIGINAL_CAPTURE_ID --profile JSON
starforge wfs vector-compare --project ABS --id ID --before CAPTURE_ID --after CAPTURE_ID
starforge wfs vector-changes --project ABS --id ID [--offset N] [--limit N] [--layer ID] [--status TEXT]
starforge wfs vector-file --project ABS --id ID --out NATIVE_ZIP
starforge wfs vector-document --project ABS --id ID --document manifest|inspection|profile|receiving --out JSON
starforge wfs vector-receive --project ABS --id ID --source NATIVE_ZIP [--manifest-sha SHA]
starforge wfs vector-resume --project ABS --id ORIGINAL_ID

starforge wfs mcp-init --directory EMPTY_NATIVE_HOST_ABS --connection PRIVATE_JSON
  [--name TEXT] [--release-store EXISTING_ABS]

Finite commands print complete JSON, or retain --out and print its path, bytes and SHA256.
All output files preserve a different existing destination. --python selects an existing
Python3.11+ executable for XML and source receiving. --out is available on finite reads/actions.
serve, merchant and the *-open browser commands remain in the foreground until interrupted.
resume uses the retained operation's exact inputs and revision. It never creates a new order.
Dataset acquisition uses the original saved budget; recover/deliver/reopen preserve that identity.
`;

const operators = [
  'source-auth', 'buyer-config', 'facilitator', 'allow-local-facilitator',
  'merchant-port', 'expected-binding-sha256'
];
const recorded = ['id', 'revision'];
const publication = ['publication'];
const sourceAccess = ['source-auth'];
const datasetActions = [
  'dataset-create', 'dataset-run', 'dataset-recover', 'dataset-inspect',
  'dataset-deliver', 'dataset-accounting', 'dataset-finalize', 'dataset-receive'
];
const aliases = {
  source: 'catalog', 'save-query': 'query', 'run-order': 'order', 'export-order': 'publish'
};
const allowed = {
  init: ['name'], show: [], queries: [], binding: operators,
  serve: [...operators, 'port', 'connection-file'],
  discover: [...recorded, ...sourceAccess, 'endpoint', 'name', 'terms-file', 'allow-loopback'],
  catalog: ['source', 'offset', 'limit'],
  describe: [...recorded, ...sourceAccess, 'source', 'type-name'],
  schema: ['schema'],
  query: [...recorded, 'source', 'schema', 'name', 'selection'],
  order: [...recorded, ...sourceAccess, 'query', 'name', 'limits'],
  resume: [...recorded, ...sourceAccess, 'limits'],
  'order-show': ['order'], features: ['order', 'offset', 'limit'], inspect: ['order'], plan: ['order'],
  compare: [...recorded, 'before', 'after', 'key-pointer'],
  comparison: ['comparison', 'group', 'offset', 'limit'],
  publish: [...recorded, 'order', 'plan', 'payment', 'origin', 'path'],
  publication, 'publication-open': publication,
  abandon: [...recorded, 'pending', 'note'],
  merchant: [...publication, ...operators],
  preview: [...publication, 'kind', 'query'],
  prepare: [...publication, 'intent', 'kind', 'query', 'file', 'previous', 'accept'],
  buy: [...publication, 'intent', 'buyer-config'],
  recover: [...publication, 'intent', 'buyer-config'],
  'customer-file': [...publication, 'intent', 'buyer-config'],
  'dataset-prepare': [...publication, 'id', 'kind', 'query', 'max-pages', 'max-total-atomic', 'max-rows', 'accept'],
  ...Object.fromEntries(datasetActions.map(command => [command, [...publication, 'id', 'buyer-config']])),
  'customer-reopen': [...publication, 'id'], 'customer-open': [...publication, 'id'],
  'dataset-file': [...publication, 'id', 'file'],
  'capabilities-file': ['source'], 'schema-file': ['schema'], 'raw-page': ['order', 'index'],
  'features-file': ['order'], 'comparison-file': ['comparison'],
  export: ['max-bytes'], 'inspect-bundle': ['source', 'max-bytes'],
  receive: ['source', 'id', 'max-bytes'],
  'source-receive': ['source', 'native-scan', 'capture-manifest', 'source-set'],
  'sources-open': ['source', 'id'], 'source-file': ['source', 'file'],
  'project-import': ['source'], 'project-open': ['bundle-sha'],
  'vector-capture': ['id','order','source-crs','coordinate-order','source-id','selection-id','identity'],
  'vector-list':['offset','limit'],'vector-show':['id'],
  'vector-export':['id','capture','profile'],'vector-compare':['id','before','after'],
  'vector-changes':['id','offset','limit','layer','status'],
  'vector-file':['id'],'vector-document':['id','document'],
  'vector-receive':['id','source','manifest-sha'],'vector-resume':['id'],
  'mcp-init': ['directory', 'connection', 'name', 'release-store']
};
const foregroundCommands = new Set(['serve', 'merchant', 'publication-open', 'customer-open', 'project-open']);
const independentCommands = new Set(['inspect-bundle', 'source-file', 'mcp-init']);
const outputCommands = new Set([
  'export', 'customer-file', 'dataset-file', 'capabilities-file', 'schema-file',
  'raw-page', 'features-file', 'comparison-file', 'source-file', 'vector-file', 'vector-document'
]);
function flags(command, args) {
  need(Object.hasOwn(allowed, command), 'Unknown command; use wfs --help.');
  const result = {}, keys = new Set(['project', 'python', 'out', ...allowed[command]]);
  for (let i = 0; i < args.length; i++) {
    const item = args[i], key = item.slice(2);
    need(item.startsWith('--') && keys.has(key) && !Object.hasOwn(result, key),
      'Unknown or duplicate option: ' + item);
    if (['allow-loopback', 'allow-local-facilitator'].includes(key)) result[key] = true;
    else {
      need(typeof args[i + 1] === 'string' && args[i + 1].length && !args[i + 1].startsWith('--'),
        'Option requires a value: ' + item);
      result[key] = args[++i];
    }
  }
  if (!independentCommands.has(command)) need(result.project, '--project selects the original private directory.');
  else need(!result.project, 'This command uses its explicit --source or --directory; omit --project.');
  need(!foregroundCommands.has(command) || !result.out, 'Keep foreground startup on stdout; retain its --connection-file when supported.');
  if (outputCommands.has(command)) need(result.out, '--out selects the complete retained file.');
  return result;
}
function integer(value, label, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  need(typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)),
    label + ' requires an exact nonnegative integer.');
  return Number(value);
}
function text(value, label) {
  need(typeof value === 'string' && value.length > 0, label + ' is required.');
  return value;
}
function bundleLimit(flags) {
  return integer(flags['max-bytes'], 'Complete portable bundle bytes', WFS_PROJECT_BUNDLE_DEFAULT_BYTES);
}
async function readJson(path, maximum = LIMITS.projectBytes) {
  const bytes = await readBytes(resolve(text(path, 'The original JSON file')), maximum);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
async function readText(path, maximum, required = false) {
  if (!path && !required) return '';
  return new TextDecoder('utf-8', { fatal: true }).decode(
    await readBytes(resolve(text(path, 'The original text file')), maximum));
}
async function readBundle(path) {
  // Inspection separately enforces the selected compact-JSON capacity.
  return readJson(path, 512 * 1024 * 1024);
}
async function artifact(value, path, compact = false) {
  if (!path) {
    need(!Buffer.isBuffer(value), 'Retain complete file bytes with --out.');
    return value;
  }
  path = resolve(path);
  const bytes = Buffer.isBuffer(value) ? value :
    compact ? Buffer.from(JSON.stringify(value) + '\n', 'utf8') : jsonBytes(value);
  const parent = await durableDirectory(dirname(path));
  await withPrivateLock(parent, basename(path) + '.lock', () => exactFile(path, bytes));
  return { path, bytes: bytes.length, sha256: hash(bytes) };
}
async function foreground(value, signal) {
  signal.throwIfAborted();
  console.log(JSON.stringify(value));
  await new Promise(done => {
    if (signal.aborted) return done();
    signal.addEventListener('abort', done, { once: true });
  });
  return { state: 'CLOSED' };
}
async function resumedRequest(directory, f) {
  operationId(f.id);
  const project = await readWfsProject(directory);
  const done = project.operations.find(item => item.id === f.id);
  if (done) {
    if (f.revision !== undefined) need(integer(f.revision, 'Original revision') === done.expectedRevision,
      'Use the completed operation original revision.', 'WFS_OPERATION_REVISION_CHANGED', 409);
    return { result: { ...done.result, reused: true, revision: project.revision } };
  }
  const pending = project.pending;
  need(pending?.id === f.id, 'Select the exact retained pending operation from show.',
    'WFS_ORIGINAL_OPERATION_PENDING', 409);
  if (f.revision !== undefined) need(integer(f.revision, 'Original revision') === pending.expectedRevision,
    'Use the pending operation original revision.', 'WFS_OPERATION_REVISION_CHANGED', 409);
  need(['discover', 'describe', 'save-query', 'run-order', 'compare', 'export-order'].includes(pending.kind),
    'The retained operation has no acquisition replay through this command.');
  need(f.limits === undefined || pending.kind === 'run-order',
    '--limits applies only to the original pending order.');
  const request = { ...pending.payload, action: pending.kind, id: pending.id, expectedRevision: pending.expectedRevision };
  if (f.limits !== undefined) request.limits = await readJson(f.limits, 65536);
  return { request };
}

/** One owned invocation. Every foreground child and source request drains before return. */
export async function main(args = process.argv.slice(2), { signal } = {}) {
  if (!args.length || ['--help', '-h', 'help'].includes(args[0])) {
    console.log(USAGE); return;
  }
  const command = aliases[args[0]] ?? args[0], f = flags(command, args.slice(1));
  const directory = f.project ? resolve(f.project) : undefined;
  const abort = new AbortController();
  let application, session, closePromise, result, failure, applicationAbort;
  const stop = () => abort.abort(signal?.reason);
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const close = () => closePromise ??= (async () => {
    const outcomes = await Promise.allSettled([
      Promise.resolve().then(() => session?.close()),
      Promise.resolve().then(() => application?.close())
    ]);
    const errors = outcomes.filter(item => item.status === 'rejected').map(item => item.reason);
    if (errors.length) throw errors[0];
  })();
  const options = {
    directory, sourceAuthConfig: f['source-auth'], buyerConfig: f['buyer-config'],
    facilitator: f.facilitator, allowLocalFacilitator: f['allow-local-facilitator'] === true,
    merchantPort: integer(f['merchant-port'], 'Merchant port', 0),
    expectedBindingSha256: f['expected-binding-sha256'], python: f.python
  };
  const recordedInput = () => ({
    id: operationId(f.id), expectedRevision: integer(f.revision, 'Project revision')
  });
  try {
    abort.signal.throwIfAborted();
    if (command === 'init') result = await initializeWfsProject({ directory, name: text(f.name, '--name') });
    else if (command === 'show') result = await readWfsProject(directory);
    else if (command === 'queries') {
      const project = await readWfsProject(directory);
      result = { projectId: project.id, revision: project.revision, queries: project.queries };
    } else if (command === 'binding') result = await inspectWfsWorkspaceBinding(options);
    else if (command === 'inspect-bundle') result = inspectWfsProjectBundle(await readBundle(f.source), { maxBytes: bundleLimit(f) });
    else if (command === 'receive') result = await receiveWfsProject({
      directory, bundle: await readBundle(f.source), id: f.id,
      maxBytes: bundleLimit(f), signal: abort.signal, python: f.python
    });
    else if (command === 'source-receive') {
      need(Boolean(f.source) !== Boolean(f['native-scan']), 'Select one original delivery report or native source scan.');
      result = await receiveWfsSourceDelivery({
        directory, ...(f.source ? { report: await readJson(f.source, 4 * 1024 * 1024) } :
          { nativeScan: await readJson(f['native-scan'], 4 * 1024 * 1024) }),
        expectedCaptureId: f['capture-manifest'], expectedSourceSetId: f['source-set'],
        python: f.python, signal: abort.signal
      });
    } else if (command === 'sources-open') result = await reopenWfsSources({
      sourceDirectory: resolve(text(f.source, '--source')), projectDirectory: directory,
      id: f.id, python: f.python, signal: abort.signal
    });
    else if (command === 'source-file') result = (await exportWfsReceivedFile({
      sourceDirectory: resolve(text(f.source, '--source')), file: text(f.file, '--file'),
      python: f.python, signal: abort.signal
    })).bytes;
    else if (command === 'export') result = await exportWfsProject({ directory, maxBytes: bundleLimit(f),python:f.python,signal:abort.signal });
    else if (command === 'mcp-init') result = await initializeWfsMerchantWorkspace({
      directory: text(f.directory, '--directory'), connection: text(f.connection, '--connection'),
      ...(f.name ? { name: f.name } : {}), ...(f['release-store'] ? { releaseStore: f['release-store'] } : {})
    });
    else if (command === 'serve') {
      session = await startWfsWorkspace({
        ...options, port: integer(f.port, 'Browser port', 0), connectionFile: f['connection-file']
      });
      result = await foreground(session.startup, abort.signal);
    } else {
      const resumed = command === 'resume' ? await resumedRequest(directory, f) : null;
      if (resumed?.result) result = resumed.result;
      else {
        application = await openWfsApplication({
          ...options, onProgress: value => console.error(JSON.stringify(value))
        });
        applicationAbort = () => { void application.close().catch(() => {}); };
        abort.signal.addEventListener('abort', applicationAbort, { once: true });
        abort.signal.throwIfAborted();
        if (resumed?.request) result = await application.action(resumed.request);
        else switch (command) {
          case 'vector-capture':
            result=await application.action({action:'vector-capture',id:operationId(f.id),orderId:f.order,
              sourceCrs:text(f['source-crs'],'--source-crs'),coordinateOrder:text(f['coordinate-order'],'--coordinate-order'),
              ...(f['source-id']?{sourceId:f['source-id']}:{}),...(f['selection-id']?{selectionId:f['selection-id']}:{}),
              ...(f.identity?{identityJson:await readText(f.identity,131072,true)}:{})});break;
          case 'vector-list':result=await application.query('vectors',{offset:integer(f.offset,'Offset',0),limit:integer(f.limit,'Limit',100)});break;
          case 'vector-show':result=await application.query('vector',{id:operationId(f.id)});break;
          case 'vector-export':
            result=await application.action({action:'vector-export',id:operationId(f.id),captureId:operationId(f.capture),
              profileJson:await readText(f.profile,4*1024*1024,true)});break;
          case 'vector-compare':
            result=await application.action({action:'vector-compare',id:operationId(f.id),
              before:operationId(f.before),after:operationId(f.after)});break;
          case 'vector-changes':
            result=await application.query('vector-changes',{id:operationId(f.id),offset:integer(f.offset,'Offset',0),
              limit:integer(f.limit,'Limit',100),...(f.layer?{layerId:f.layer}:{}),...(f.status?{status:f.status}:{})});break;
          case 'vector-file':result=(await application.download('vector',{id:operationId(f.id)})).bytes;break;
          case 'vector-document':result=(await application.download('vector-document',{
            id:operationId(f.id),document:text(f.document,'--document')})).bytes;break;
          case 'vector-receive':{
            const bytes=await readBytes(resolve(text(f.source,'--source')),256*1024*1024);
            result=await application.action({action:'vector-receive',id:operationId(f.id),
              archiveBase64:bytes.toString('base64'),archiveSha256:hash(bytes),
              ...(f['manifest-sha']?{manifestSha256:f['manifest-sha']}:{})});break;
          }
          case 'vector-resume':result=await application.action({action:'vector-resume',id:operationId(f.id)});break;
          case 'discover':
            result = await application.action({
              action: 'discover', ...recordedInput(), endpoint: text(f.endpoint, '--endpoint'),
              name: text(f.name, '--name'), terms: await readText(f['terms-file'], 65536),
              allowLoopback: f['allow-loopback'] === true
            }); break;
          case 'catalog':
            result = await application.query('catalog', {
              sourceId: f.source, offset: integer(f.offset, 'Offset', 0), limit: integer(f.limit, 'Limit', 100)
            }); break;
          case 'describe':
            result = await application.action({
              action: 'describe', ...recordedInput(), sourceId: f.source, typeName: text(f['type-name'], '--type-name')
            }); break;
          case 'schema': result = await application.query('schema', { schemaId: f.schema }); break;
          case 'query':
            result = await application.action({
              action: 'save-query', ...recordedInput(), sourceId: f.source, schemaId: f.schema,
              name: text(f.name, '--name'), selection: await readJson(f.selection, 65536)
            }); break;
          case 'order':
            result = await application.action({
              action: 'run-order', ...recordedInput(), queryId: f.query, name: text(f.name, '--name'),
              limits: f.limits ? await readJson(f.limits, 65536) : {}
            }); break;
          case 'order-show': result = await application.query('order', { orderId: f.order }); break;
          case 'features':
            result = await application.query('features', {
              orderId: f.order, offset: integer(f.offset, 'Offset', 0), limit: integer(f.limit, 'Limit', 100)
            }); break;
          case 'inspect': result = await application.query('inspection', { orderId: f.order }); break;
          case 'plan': result = await application.query('plan', { orderId: f.order }); break;
          case 'compare':
            result = await application.action({
              action: 'compare', ...recordedInput(), before: f.before, after: f.after,
              keyPointer: f['key-pointer'] ?? '/id'
            }); break;
          case 'comparison':
            result = await application.query('comparison', {
              comparisonId: f.comparison, kind: f.group ?? 'changed',
              offset: integer(f.offset, 'Offset', 0), limit: integer(f.limit, 'Limit', 100)
            }); break;
          case 'publish':
            result = await application.action({
              action: 'export-order', ...recordedInput(), orderId: f.order,
              ...(f.plan ? { plan: await readJson(f.plan, 2 * 1024 * 1024) } : {}),
              ...(f.payment ? { payment: await readJson(f.payment, 16384) } : {}),
              ...(f.origin ? { origin: f.origin } : {}), path: f.path ?? '/features'
            }); break;
          case 'publication': result = await application.query('publication', { publicationId: f.publication }); break;
          case 'merchant': case 'publication-open': case 'customer-open': case 'project-open': {
            const request = command === 'project-open'
              ? { action: command, bundleSha256: f['bundle-sha'] }
              : { action: command === 'merchant' ? 'merchant-start' : command, publicationId: f.publication,
                ...(command === 'customer-open' ? { id: f.id } : {}) };
            const started = await application.action(request);
            result = await foreground(started, abort.signal); break;
          }
          case 'preview':
            result = await application.query('preview', {
              publicationId: f.publication, kind: f.kind ?? 'rows', query: f.query ?? ''
            }); break;
          case 'prepare':
            result = await application.action({
              action: 'prepare', publicationId: f.publication, intentId: f.intent,
              kind: f.kind ?? 'rows', query: f.query ?? '', file: f.file ?? null,
              previous: f.previous ? await readJson(f.previous, 131072) : null,
              acceptIndex: integer(f.accept, 'Payment alternative', 0)
            }); break;
          case 'buy': case 'recover':
            result = await application.action({ action: command, publicationId: f.publication, intentId: f.intent }); break;
          case 'dataset-prepare':
            result = await application.action({
              action: command, publicationId: f.publication, id: f.id, kind: text(f.kind, '--kind'),
              query: f.query ?? '', maxPages: integer(f['max-pages'], 'Maximum pages'),
              maxTotalAtomic: text(f['max-total-atomic'], '--max-total-atomic'),
              maxRows: integer(f['max-rows'], 'Maximum rows', LIMITS.rows),
              acceptIndex: integer(f.accept, 'Payment alternative', 0)
            }); break;
          case 'dataset-create': case 'dataset-run': case 'dataset-recover': case 'dataset-inspect':
          case 'dataset-deliver': case 'dataset-accounting': case 'dataset-finalize': case 'dataset-receive':
          case 'customer-reopen':
            result = await application.action({ action: command, publicationId: f.publication, id: f.id }); break;
          case 'customer-file': case 'dataset-file': case 'capabilities-file': case 'schema-file':
          case 'raw-page': case 'features-file': case 'comparison-file': {
            const choices = {
              'customer-file': ['customer', { publicationId: f.publication, intentId: f.intent }],
              'dataset-file': ['dataset', { publicationId: f.publication, id: f.id, file: f.file }],
              'capabilities-file': ['capabilities', { sourceId: f.source }],
              'schema-file': ['schema', { schemaId: f.schema }],
              'features-file': ['features', { orderId: f.order }],
              'comparison-file': ['comparison', { comparisonId: f.comparison }]
            };
            const [kind, input] = command === 'raw-page'
              ? ['raw-page', { orderId: f.order, index: integer(f.index, 'Original page index') }] : choices[command];
            result = (await application.download(kind, input)).bytes; break;
          }
          case 'project-import':
            result = await application.action({ action: 'project-receive', bundle: await readBundle(f.source) }); break;
          case 'abandon':
            result = await application.action({
              action: 'abandon', ...recordedInput(), pendingId: f.pending, note: await readText(f.note, 512, true)
            }); break;
          default: throw Object.assign(new Error('Unknown original WFS command.'), { code: 'WFS_COMMAND_UNKNOWN' });
        }
      }
    }
    result = await artifact(result, f.out, command === 'export');
  } catch (error) { failure = error; }
  finally {
    try { await close(); } catch (error) { if (!failure) failure = error; }
    if (applicationAbort) abort.signal.removeEventListener('abort', applicationAbort);
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    signal?.removeEventListener('abort', stop);
  }
  if (failure) throw failure;
  console.log(JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(JSON.stringify({
      code: error.code ?? 'WFS_COMMAND_FAILED', message: String(error.message ?? error),
      ...(error.retryAt ? { retryAt: error.retryAt } : {}),
      ...(error.retentionCode ? { retentionCode: error.retentionCode } : {})
    }));
    process.exitCode = error.name === 'AbortError' ? 130 : 2;
  });
}
