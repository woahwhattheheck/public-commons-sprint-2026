// MIT. Open the original Tyk product through the maintained Applications lifecycle.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { inspectMerchantRuntime } from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
import { APPLICATION_PROVIDER_SCHEMA, applicationPrivateUrl, observeApplicationStartup } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';
import { absolute, need, plain, digest } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import { readSf61HostFile } from '../../stellar-forge/mcp-merchant-operator/sf61-connection.mjs';
import { TYK_MAX_JSON_BYTES } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/tyk/workspace/actions.mjs';
import { tykProductSource, inspectTykWorkspaceDirectory, TYK_PRODUCT_SOURCE_FILES } from './managed.mjs';

const PRODUCT = 'products/tyk-merchant/', LAUNCH = 'stellar-forge.tyk-product-launch.v1', SESSION = 'stellar-forge.tyk-product-session.v1';
const WORKSPACE = 'stellar-forge.tyk-workspace.v1', HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function options(settings) {
  return { directory: absolute(settings.workspaceDirectory), port: settings.port ?? 0 };
}
export async function prepareTykProductApplication(settings, context) {
  const selectedOptions = options(settings), { runtimeDirectory, inputPath, applicationEnvironment } = context;
  const runtime = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const managed = await inputPath(join(runtime.sourceRoot, PRODUCT + 'managed.mjs'), 'file');
  need(HASH.test(managed?.sha256 ?? ''), 'APPLICATION_TYK_PRODUCT_SOURCE_CHANGED');
  const url = pathToFileURL(managed.path); url.searchParams.set('tykProductSource', managed.sha256);
  const module = await import(url.href), { environment } = await applicationEnvironment(settings.environmentFile);
  need(typeof module.inspectTykProductLaunch === 'function', 'APPLICATION_TYK_PRODUCT_NOT_INSTALLED');
  const selected = await module.inspectTykProductLaunch(selectedOptions, { environment });
  need(selected.schema === LAUNCH && HASH.test(selected.bindingSha256 ?? '') && HASH.test(selected.resourceId ?? '') &&
    selected.directory === selectedOptions.directory && isDeepStrictEqual(selected.options, selectedOptions) &&
    selected.source.root === runtime.sourceRoot && HASH.test(selected.source.sha256 ?? '') &&
    Array.isArray(selected.source.files) && selected.source.files.length === TYK_PRODUCT_SOURCE_FILES.length &&
    selected.source.files.every((item, index) => item.name === TYK_PRODUCT_SOURCE_FILES[index]),
  'APPLICATION_TYK_PRODUCT_BINDING_CHANGED');
  const inputs = [];
  for (const item of selected.source.files) {
    const observed = await inputPath(join(runtime.sourceRoot, item.name), 'file');
    need(observed.bytes === item.bytes && (!observed.sha256 || observed.sha256 === item.sha256),
      'APPLICATION_TYK_PRODUCT_SOURCE_CHANGED');
    inputs.push({ ...observed, sha256: item.sha256, role: 'Original Tyk source: ' + item.name });
  }
  for (const item of selected.files) {
    const observed = await inputPath(item.path, 'file');
    need(observed.bytes === item.bytes && (!observed.sha256 || observed.sha256 === item.sha256),
      'APPLICATION_TYK_PRODUCT_INPUT_CHANGED');
    inputs.push({ ...observed, sha256: item.sha256, role: item.role });
  }
  for (const item of selected.directories) {
    const observed = await inputPath(item.path, 'directory', false, true);
    need(String(observed.dev) === item.dev && String(observed.ino) === item.ino, 'APPLICATION_TYK_PRODUCT_INPUT_CHANGED');
    inputs.push({ ...observed, role: item.role });
  }
  // The shared Applications composer adds its selected port to the original command.
  return { args: ['open', '--dir', selected.directory, '--expected-binding', selected.bindingSha256],
    inputs, createDirectories: [], resourceKey: selected.resourceId,
    applicationReview: { schema: 'stellar-forge.application-review-content.v1', title: 'Tyk API operations',
      summary: 'Open one saved portfolio and rollout workspace with its original Gateway or Dashboard transport and complete customer handover.',
      sections: [
        { title: 'Original workspace', rows: [
          { label: 'Product', value: selected.profile.name },
          { label: 'Saved native state', value: selected.profile.workspaceDirectory },
          { label: 'Workspace identity', value: selected.workspace.workspaceId ?? 'Create in this directory on first Open' },
          { label: 'Ownership', value: 'One native workspace owner; Stop reaches that same original writer' },
          { label: 'Initial declarations', value: selected.initialConnections.map(item => item.label + ' (' + item.kind + ')') },
          { label: 'Saved target edits', value: 'Native workspace revisions remain authoritative after reopen' },
          { label: 'Source', value: [selected.source.sha256, selected.source.files.length + ' complete files'] },
        ] },
        { title: 'Native operation and receiving', rows: [
          { label: 'Migration', value: 'Original Dashboard dry run, stage, promote or direct migration of the selected saved cohort' },
          { label: 'Gateway activation', value: 'Saved definitions become active after an explicitly reviewed native reload' },
          { label: 'Recovery', value: 'Reopen the saved request and refresh its original response and active-state readback' },
          { label: 'Customer handover', value: 'Complete native NDJSON history, exact source blobs, full-file receiving and same-request adoption' },
        ] },
        { title: 'Private configuration', collapsed: true,
          rows: selected.files.map(file => ({ label: file.role, value: [file.path, file.bytes + ' bytes', file.sha256] })) },
      ] } };
}
function requested(request) {
  need(!request.pythonCommand && !request.terminal && request.command === 'tyk-product' &&
    Array.isArray(request.args) && request.args[0] === 'open', 'APPLICATION_TYK_PRODUCT_STARTUP_CHANGED');
  const values = new Map();
  for (let index = 1; index < request.args.length; index++) {
    const key = request.args[index], value = request.args[++index];
    need(['--dir','--port','--expected-binding'].includes(key) && !values.has(key) &&
      typeof value === 'string' && value && !value.startsWith('--'), 'APPLICATION_TYK_PRODUCT_STARTUP_CHANGED');
    values.set(key, value);
  }
  const port = values.get('--port') ?? '0';
  need(/^(0|[1-9][0-9]*)$/.test(port) && Number(port) <= 65535 &&
    HASH.test(values.get('--expected-binding') ?? ''), 'APPLICATION_TYK_PRODUCT_STARTUP_CHANGED');
  return { directory: absolute(values.get('--dir')), port: Number(port), bindingSha256: values.get('--expected-binding') };
}
async function completeResponse(response, maximum) {
  need(response.status === 200 && response.body, 'APPLICATION_TYK_PRODUCT_NOT_READY');
  const chunks = []; let bytes = 0;
  for await (const original of response.body) {
    const chunk = Buffer.from(original); bytes += chunk.length;
    need(bytes <= maximum, 'APPLICATION_TYK_PRODUCT_STARTUP_CHANGED'); chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}
export async function tykProductStartup(request, text) {
  if (typeof text !== 'string' || text.length > 65536 || !text.startsWith('{')) return null;
  let value; try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== SESSION || value.state !== 'OPEN') return null;
  const selected = requested(request), raw = applicationPrivateUrl(value.browserUrl);
  need(raw && value.directory === selected.directory && value.bindingSha256 === selected.bindingSha256 &&
    value.port === selected.port && value.connectionFile === join(selected.directory, 'connection.json') &&
    value.browserUrlFile === join(selected.directory, 'browser-url.txt') && HASH.test(value.resourceId ?? '') &&
    HASH.test(value.sourceSha256 ?? '') && UUID.test(value.productId ?? '') &&
    UUID.test(value.instanceId ?? '') && UUID.test(value.workspaceId ?? ''),
  'APPLICATION_TYK_PRODUCT_STARTUP_CHANGED');
  const browser = new URL(raw);
  need(browser.protocol === 'http:' && browser.hostname === '127.0.0.1' && browser.pathname === '/' &&
    !browser.search && HASH.test(browser.hash.slice(1)) &&
    (selected.port === 0 || Number(browser.port || 80) === selected.port), 'APPLICATION_TYK_PRODUCT_STARTUP_CHANGED');
  const retained = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
    await readSf61HostFile(value.connectionFile, 65536, { privateFile: true })));
  need(isDeepStrictEqual(retained, value), 'APPLICATION_TYK_PRODUCT_INSTANCE_CHANGED');
  const native = await inspectTykWorkspaceDirectory(value.workspaceDirectory), source = await tykProductSource();
  need(native.workspaceId === value.workspaceId && source.sha256 === value.sourceSha256,
    'APPLICATION_TYK_PRODUCT_SOURCE_CHANGED');
  const response = await fetch(new URL('/api/workspace', browser.origin), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Origin: browser.origin, 'x-workspace-token': browser.hash.slice(1), Accept: 'application/json' },
  });
  const live = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await completeResponse(response, TYK_MAX_JSON_BYTES)));
  need(live.schema === WORKSPACE && live.workspaceId === value.workspaceId &&
    live.directory === value.workspaceDirectory && !live.closing, 'APPLICATION_TYK_PRODUCT_INSTANCE_CHANGED');
  const html = source.files.find(item => item.name.endsWith('/tyk/workspace/index.html'));
  need(html, 'APPLICATION_TYK_PRODUCT_SOURCE_CHANGED');
  const page = await fetch(new URL('/', browser.origin), { redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Accept: 'text/html' } });
  const body = await completeResponse(page, html.bytes);
  need(body.length === html.bytes && digest(body) === html.sha256, 'APPLICATION_TYK_PRODUCT_SOURCE_CHANGED');
  const again = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
    await readSf61HostFile(value.connectionFile, 65536, { privateFile: true })));
  need(isDeepStrictEqual(again, value), 'APPLICATION_TYK_PRODUCT_INSTANCE_CHANGED');
  return { url: browser.href, links: [], connectionFile: value.connectionFile,
    original: { schema: SESSION, productId: value.productId, directory: value.directory,
      workspaceDirectory: value.workspaceDirectory, workspaceId: value.workspaceId,
      instanceId: value.instanceId, bindingSha256: value.bindingSha256,
      resourceId: value.resourceId, sourceSha256: value.sourceSha256 } };
}
export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'tyk-product', order: 440,
  catalog({ common, field }) { return [{
    id: 'tyk-product', command: 'tyk-product', title: 'Tyk API operations', terminal: false,
    requiredSource: PRODUCT + 'managed.mjs',
    description: 'Open the saved API portfolio, native migration and rollout reviews, retained request recovery and complete customer handover.',
    fields: [
      field('workspaceDirectory', 'Private product directory', 'path', true, 'Select the directory initialized by tyk-product init.'),
      ...common.map(item => item.name === 'port' ? { ...item, label: 'Workspace port',
        description: 'Use 0 for an available local browser port.' } : item),
    ],
  }]; },
  validateSettings(type, settings) {
    need(settings.port === undefined || Number.isInteger(settings.port) && settings.port >= 0 && settings.port <= 65535,
      'APPLICATION_TYK_PRODUCT_PORT');
  },
  prepare(type, settings, context) { return prepareTykProductApplication(settings, context); },
  matchRequest(request) { return !request.pythonCommand && request.command === 'tyk-product' && request.args?.[0] === 'open'; },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => text.startsWith('{') ? () => tykProductStartup(request, text) : null);
  },
};
