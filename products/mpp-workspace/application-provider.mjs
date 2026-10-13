// MIT. Source-owned native MPP product in the existing managed Applications registry.
import { join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../stellar/scf-starforge-20261009/sf46-release/runtime-package.mjs';
import { APPLICATION_PROVIDER_SCHEMA, applicationPrivateUrl, observeApplicationStartup } from
  '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/application-provider.mjs';
import { need, plain, readJSON, recordId, operationId } from
  '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import { fullPath, stable, portNumber, environmentName } from './workspace.mjs';
import { inspectMppLaunch, MPP_PRODUCT_LAUNCH_SCHEMA, MPP_PRODUCT_READY_SCHEMA } from './managed.mjs';

const PRODUCT = 'products/mpp-workspace/';
const HASH = /^[a-f0-9]{64}$/;
const sources = ['workspace.mjs', 'managed.mjs', 'client.mjs', 'cli.mjs', 'application-provider.mjs'];
function options(settings) {
  return { directory: fullPath(settings.workspaceDirectory), port: settings.port ?? 0,
    mcpPort: settings.mcpPort ?? 0, browserOnly: settings.browserOnly === true,
    tokenEnv: settings.tokenEnv ?? 'MCP_ACCESS_TOKEN' };
}
function reviewContent(selected) {
  const value = selected.review, port = value => value === 0 ? 'Choose an available local port' : String(value);
  const rows = [
    { label: 'Product', value: value.name },
    { label: 'Private product', value: value.directory },
    { label: 'Original native workspace', value: value.workspace },
    { label: 'Workspace created', value: value.workspaceCreatedAt },
    { label: 'Native configuration revision', value: String(value.revision) },
    { label: 'Browser port', value: port(value.port) },
    { label: 'Merchant profile', value: value.profiles.merchant ?? 'Configure in the original browser' },
    { label: 'Customer profile', value: value.profiles.customer ?? 'Receive and review a merchant contract' },
    { label: 'Dependency runtime', value: value.dependencyRoot },
    { label: 'Selected packages', value: Object.entries(value.versions).map(([name, version]) => name + ' ' + version) },
    { label: 'Runtime selection', value: value.runtimeState === 'PACKAGES_PRESENT'
      ? 'Original top-level package versions are present; the exact-lock receiver inspects the complete installation.'
      : 'Continue the original exact-lock runtime receiving before starting paid operations.' },
    { label: 'Spending authorization', value: 'Original SF36 policy, terminal consent and reservation in this retained process.' },
    { label: 'Merchant agent', value: value.browserOnly ? 'Browser only' : 'Original MPP tools; console alias native' },
  ];
  if (!value.browserOnly) rows.push(
    { label: 'Agent port', value: port(value.mcpPort) },
    { label: 'Agent authorization', value: value.authorizationMode === 'oauth' ? 'Original OAuth host' : 'Existing fixed bearer token' },
    { label: 'Agent token environment name', value: value.tokenEnv });
  return { schema: 'stellar-forge.application-review-content.v1',
    title: 'Native MPP merchant and customer',
    summary: 'Open the original merchant, customer workbench, purchase recovery and generated customer receiving in the retained native workspace.',
    sections: [
      { title: 'Original product and authorization', rows },
      { title: 'Customer selections', rows: Object.entries(value.customers).map(([name, item]) =>
        ({ label: name + ' — ' + item.label, value: 'SHA-256 ' + item.configurationSha256 })) },
      { title: 'Selected source and configuration', collapsed: true,
        rows: selected.files.map(item => ({ label: item.role,
          value: [item.path, String(item.bytes) + ' bytes', 'SHA-256 ' + item.sha256] })) },
    ] };
}
export async function prepareMppProductApplication(settings, context) {
  const { inputPath, applicationEnvironment, runtimeDirectory } = context;
  need(typeof inputPath === 'function' && typeof applicationEnvironment === 'function',
    'APPLICATION_MPP_PRODUCT_INTEGRATION');
  const selectedOptions = options(settings);
  const runtime = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const inputs = await Promise.all(sources.map(name => inputPath(join(runtime.sourceRoot, PRODUCT + name), 'file')));
  const managed = inputs[sources.indexOf('managed.mjs')], url = pathToFileURL(managed.path);
  need(HASH.test(managed.sha256 ?? ''), 'APPLICATION_MPP_PRODUCT_SOURCE_CHANGED');
  url.searchParams.set('mppProductSource', managed.sha256);
  const original = await import(url.href);
  need(typeof original.inspectMppLaunch === 'function', 'APPLICATION_MPP_PRODUCT_NOT_INSTALLED');
  const { environment } = await applicationEnvironment(settings.environmentFile);
  const selected = await original.inspectMppLaunch(selectedOptions, { environment });
  need(plain(selected) && selected.schema === MPP_PRODUCT_LAUNCH_SCHEMA &&
    HASH.test(selected.bindingSha256 ?? '') && HASH.test(selected.resourceId ?? '') &&
    selected.profile.directory === selectedOptions.directory &&
    selected.native.workspace === selected.profile.workspaceDirectory &&
    stable(selected.options) === stable(selectedOptions) &&
    Array.isArray(selected.files) && Array.isArray(selected.directories),
  'APPLICATION_MPP_PRODUCT_SELECTION_CHANGED');
  for (const item of selected.directories) {
    const checked = await inputPath(item.path, 'directory', false,
      ['product', 'nativeWorkspace', 'customers', 'receiving', 'operator', 'releases', 'exports'].includes(item.role));
    need(String(checked.dev) === item.dev && String(checked.ino) === item.ino,
      'APPLICATION_MPP_PRODUCT_DIRECTORY_CHANGED');
    inputs.push({ ...checked, role: item.role });
  }
  for (const item of selected.files) {
    const checked = await inputPath(item.path, 'file');
    need(checked.bytes === item.bytes && (!checked.sha256 || checked.sha256 === item.sha256),
      'APPLICATION_MPP_PRODUCT_SOURCE_CHANGED');
    inputs.push({ ...checked, sha256: item.sha256, role: item.role });
  }
  const args = ['open', '--dir', selected.profile.directory,
    '--managed-binding-sha256', selected.bindingSha256, '--mcp-port', String(selectedOptions.mcpPort),
    '--token-env', selectedOptions.tokenEnv];
  if (selectedOptions.browserOnly) args.push('--browser-only');
  return { args, inputs, createDirectories: [], resourceKey: selected.resourceId,
    applicationReview: reviewContent(selected) };
}
function requestOptions(request) {
  need(request.command === 'mpp-workspace' && request.terminal === true && !request.pythonCommand &&
    Array.isArray(request.args) && request.args[0] === 'open', 'APPLICATION_MPP_PRODUCT_REQUEST_CHANGED');
  const values = new Map();
  for (let index = 1; index < request.args.length; index++) {
    const key = request.args[index];
    need(['--dir', '--port', '--mcp-port', '--token-env', '--managed-binding-sha256', '--browser-only'].includes(key) &&
      !values.has(key), 'APPLICATION_MPP_PRODUCT_REQUEST_CHANGED');
    if (key === '--browser-only') { values.set(key, true); continue; }
    const value = request.args[++index];
    need(typeof value === 'string' && value && !value.startsWith('--'), 'APPLICATION_MPP_PRODUCT_REQUEST_CHANGED');
    values.set(key, value);
  }
  const bindingSha256 = values.get('--managed-binding-sha256');
  need(HASH.test(bindingSha256 ?? ''), 'APPLICATION_MPP_PRODUCT_REQUEST_CHANGED');
  return { directory: fullPath(values.get('--dir')), bindingSha256,
    port: portNumber(values.get('--port') ?? 0), mcpPort: portNumber(values.get('--mcp-port') ?? 0),
    tokenEnv: environmentName(values.get('--token-env') ?? 'MCP_ACCESS_TOKEN'),
    browserOnly: values.has('--browser-only') };
}
async function nativeIdentity(url) {
  const response = await fetch(new URL('/api/identity', url), { redirect: 'error',
    headers: { authorization: 'Bearer ' + url.hash.slice(1) }, signal: AbortSignal.timeout(10000) });
  need(response.status === 200 && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? ''),
    'APPLICATION_MPP_PRODUCT_IDENTITY_UNAVAILABLE');
  const chunks = []; let count = 0;
  const reader = response.body?.getReader();
  need(reader, 'APPLICATION_MPP_PRODUCT_IDENTITY_UNAVAILABLE');
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      count += part.value.byteLength; need(count <= 65536, 'APPLICATION_MPP_PRODUCT_IDENTITY_TOO_LARGE');
      chunks.push(Buffer.from(part.value));
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
/** Read only this product’s original announcement; inspect it once when the shared observer accepts it. */
export async function mppProductStartup(request, text, operationDirectory) {
  if (typeof text !== 'string' || text.length > 16384 ||
    !text.startsWith('{"schema":"' + MPP_PRODUCT_READY_SCHEMA + '",')) return null;
  let ready; try { ready = JSON.parse(text); } catch { return null; }
  if (!plain(ready) || ready.schema !== MPP_PRODUCT_READY_SCHEMA || ready.state !== 'OPEN') return null;
  const selected = requestOptions(request), browser = applicationPrivateUrl(ready.browserUrl);
  need(browser, 'APPLICATION_MPP_PRODUCT_URL_CHANGED');
  const url = new URL(browser);
  need(url.hostname === '127.0.0.1' && url.pathname === '/' && !url.search &&
    HASH.test(url.hash.slice(1)) && (selected.port === 0 || Number(url.port || 80) === selected.port) &&
    ready.bindingSha256 === selected.bindingSha256 && HASH.test(ready.resourceId ?? '') &&
    ready.directory === selected.directory && ready.console === 'native' &&
    ready.browserOnly === selected.browserOnly && ready.port === selected.port &&
    ready.mcpPort === selected.mcpPort && ready.tokenEnv === selected.tokenEnv &&
    Number.isInteger(ready.pid) && ready.pid > 0 && Number.isInteger(ready.ppid) &&
    ready.ppid > 0 && ready.pid !== ready.ppid, 'APPLICATION_MPP_PRODUCT_STARTUP_CHANGED');
  const links = [];
  if (selected.browserOnly) need(ready.mcpUrl === null, 'APPLICATION_MPP_PRODUCT_STARTUP_CHANGED');
  else {
    const mcp = applicationPrivateUrl(ready.mcpUrl);
    need(mcp, 'APPLICATION_MPP_PRODUCT_AGENT_CHANGED');
    const endpoint = new URL(mcp);
    need(endpoint.hostname === '127.0.0.1' && endpoint.pathname === '/' && !endpoint.search && !endpoint.hash &&
      endpoint.origin !== url.origin &&
      (selected.mcpPort === 0 || Number(endpoint.port || 80) === selected.mcpPort),
    'APPLICATION_MPP_PRODUCT_AGENT_CHANGED');
    links.push({ label: 'Native MPP merchant agent', url: endpoint.href });
  }
  const directory = fullPath(operationDirectory), operation = operationId(basename(directory));
  need(basename(dirname(directory)) === 'operations', 'APPLICATION_MPP_PRODUCT_OPERATION_CHANGED');
  const appId = recordId(request.applicationId), root = dirname(dirname(directory));
  const run = await readJSON(join(root, 'applications', appId, 'runs', operation + '.json'));
  need(run.schema === 'stellar-forge.application-run.v1' && run.id === operation &&
    run.applicationId === appId && run.request.command === request.command &&
    stable(run.request.args) === stable(request.args), 'APPLICATION_MPP_PRODUCT_RUN_CHANGED');
  const review = await readJSON(join(root, 'application-reviews', recordId(run.reviewId) + '.json'));
  need(review.schema === 'stellar-forge.application-start-review.v1' &&
    review.id === run.reviewId && review.applicationId === appId && review.applicationRevision === run.revision &&
    review.command.command === request.command && stable(review.command.args) === stable(request.args),
  'APPLICATION_MPP_PRODUCT_REVIEW_CHANGED');
  const terminal = await readJSON(join(directory, 'terminal-process.json'));
  need(terminal.schema === 'stellar-forge.application-terminal-process.v1' &&
    terminal.operationId === operation && terminal.original?.pid === ready.ppid &&
    typeof terminal.original.processStart === 'string' &&
    stable(terminal.original.args?.slice(-(request.args.length + 1))) === stable(['mpp-workspace', ...request.args]),
  'APPLICATION_MPP_PRODUCT_ORIGINAL_CHILD_CHANGED');
  if (await readJSON(join(directory, 'terminal-exit.json'), true) ||
    await readJSON(join(directory, 'stop.json'), true)) return null;
  // The original managed process already verified the complete selected configuration before and after opening.
  // Reconcile its retained session and original profile identities without supplying host secrets to this observer.
  const session = await readJSON(join(selected.directory, 'session.json'));
  const profile = await readJSON(join(selected.directory, 'product.json'));
  need(session?.schema === 'stellar-forge.mpp-product-session.v1' && session.state === 'OPEN' &&
    session.bindingSha256 === selected.bindingSha256 && session.resourceId === ready.resourceId &&
    session.directory === selected.directory && session.browserUrl === ready.browserUrl &&
    session.mcpUrl === ready.mcpUrl && session.workspace === ready.workspace &&
    session.workspaceCreatedAt === ready.workspaceCreatedAt && session.pid === ready.pid && session.ppid === ready.ppid &&
    profile?.schema === 'stellar-forge.mpp-product.v1' && profile.directory === selected.directory &&
    profile.workspaceDirectory === ready.workspace && profile.workspaceCreatedAt === ready.workspaceCreatedAt,
  'APPLICATION_MPP_PRODUCT_SESSION_CHANGED');
  const identity = await nativeIdentity(url);
  need(identity.schema === 'stellar-forge.mpp-console-identity.v1' && identity.pid === ready.pid &&
    identity.ppid === ready.ppid && identity.origin === url.origin && identity.workspace === ready.workspace &&
    identity.createdAt === ready.workspaceCreatedAt && stable(identity.versions) === stable(ready.versions),
  'APPLICATION_MPP_PRODUCT_IDENTITY_CHANGED');
  return { url: url.href, links, connectionFile: profile.connection,
    original: { schema: MPP_PRODUCT_READY_SCHEMA, bindingSha256: ready.bindingSha256,
      resourceId: ready.resourceId, directory: ready.directory, workspace: ready.workspace,
      workspaceCreatedAt: ready.workspaceCreatedAt, revision: ready.revision, versions: identity.versions,
      pid: ready.pid, ppid: ready.ppid, terminalProcessStart: terminal.original.processStart,
      console: 'native', tokenEnv: ready.tokenEnv, browserOnly: ready.browserOnly } };
}
export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'mpp-product', order: 410,
  catalog({ common, field }) {
    return [{ id: 'mpp-product', command: 'mpp-workspace', title: 'Native MPP merchant and customer', terminal: true,
      requiredSource: PRODUCT + 'managed.mjs',
      description: 'Operate the original native merchant, governed customer purchases, retained recovery, and complete Node/Python customer receiving.',
      fields: [
        field('workspaceDirectory', 'Private MPP product directory', 'path', true,
          'Select the retained directory created by starforge mpp-workspace init.'),
        field('browserOnly', 'Browser only', 'boolean', false,
          'Open the original private browser without the merchant MCP listener.'),
        field('mcpPort', 'Merchant agent port', 'port', false, 'Use 0 for an available local port.'),
        field('tokenEnv', 'Merchant agent token environment name', 'text', false,
          'Defaults to MCP_ACCESS_TOKEN; provide its original value in the environment or private environment JSON.'),
        field('terminalPython', 'Terminal Python executable', 'path', false,
          'Optional original Python executable for the managed terminal. The native governor retains its controlling terminal.'),
        ...common.map(value => value.name === 'port' ? { ...value, label: 'Native browser port' } : value)
      ] }];
  },
  validateSettings(type, settings) {
    if (settings.tokenEnv !== undefined) environmentName(settings.tokenEnv);
    if (settings.mcpPort !== undefined && settings.mcpPort !== '') portNumber(settings.mcpPort);
  },
  prepare(type, settings, context) { return prepareMppProductApplication(settings, context); },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'mpp-workspace' &&
      Array.isArray(request.args) && request.args[0] === 'open' && request.args.includes('--managed-binding-sha256');
  },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text =>
      text.startsWith('{"schema":"' + MPP_PRODUCT_READY_SCHEMA + '",') ?
        () => mppProductStartup(request, text, directory) : null);
  }
};
