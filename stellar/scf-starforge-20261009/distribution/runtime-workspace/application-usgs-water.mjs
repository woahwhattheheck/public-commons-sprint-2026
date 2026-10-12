// MIT. Original USGS Water and native DSS in the maintained Applications lifecycle.
import { join } from 'node:path';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, plain, need, digest, json, canonical, processIdentity } from './storage.mjs';
import { namespaceProcessIdentity } from './process-identity.mjs';
import { WATER_MANAGED_STARTUP, WATER_MANAGED_PROBE, WATER_MANAGED_FILE,
  reviewWaterManagedInputs, readWaterManagedRecord, waterManagedUrl } from '../../sf30-seller-sdk/usgs-water/managed.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/';
const same = (a, b) => digest(json(canonical(a))) === digest(json(canonical(b)));
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });
const identity = async pid => await processIdentity(pid) ?? await namespaceProcessIdentity(pid);

export function usgsWaterApplication(common) {
  return { id: 'usgs-water', command: 'usgs-water', title: 'USGS water and native DSS', terminal: false,
    requiredSource: SOURCE + 'managed.mjs',
    description: 'Review original source pages and scientific series, retain project editions, map native HEC-DSS handovers, and reopen complete received projects.',
    fields: [
      field('workspaceDirectory', 'Private Water project', 'path', true,
        'Use the existing original project, or one new directory below an existing private parent.'),
      field('buyerConfiguration', 'Original buyer configuration', 'path', false,
        'Optional existing SF88 buyer for original edition and source purchases.'),
      field('nativePython', 'HEC-DSS Python executable', 'path', false,
        'Choose the installed official HEC-DSS interpreter. The original host environment remains the fallback when omitted.'),
      field('merchantPort', 'Local edition seller port', 'port', false,
        'Used when you explicitly start a saved edition from the Water workspace.'),
      field('facilitator', 'Existing facilitator URL', 'text', false,
        'Optional original HTTPS facilitator, or an existing loopback native receiver.'),
      ...common,
    ] };
}

export async function prepareUsgsWaterApplication(settings, { inputPath, selectedExecutable, runtimeDirectory } = {}) {
  const directory = absolute(settings.workspaceDirectory);
  const folder = await inputPath(directory, 'directory', true, true), inputs = [folder];
  const selected = await reviewWaterManagedInputs({ directory, buyerConfiguration: settings.buyerConfiguration,
    nativePython: settings.nativePython, optional: true });
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false, source: false });
  for (const name of ['cli.mjs', 'managed.mjs', 'workspace.mjs', 'project.mjs', 'provider.mjs',
    'analysis.mjs', 'merchant.mjs', 'dss.mjs', 'dss_archive.py', 'hecdss_bridge.py',
    'ui/index.html', 'ui/app.mjs', 'ui/dss.mjs', 'ui/style.css'])
    inputs.push(await inputPath(join(runtime.sourceRoot, SOURCE, name), 'file'));
  if (selected.project) inputs.push(await inputPath(selected.project.path, 'file'));
  if (selected.buyer) inputs.push(await inputPath(selected.buyer.path, 'file'));
  if (settings.nativePython) {
    const executable = await selectedExecutable(settings.nativePython);
    need(executable.executable === settings.nativePython, 'APPLICATION_USGS_PYTHON_CHANGED');
    inputs.push(...executable.inputs);
  }
  if (settings.facilitator) {
    let url; try { url = new URL(settings.facilitator); } catch { need(false, 'APPLICATION_USGS_FACILITATOR_INVALID'); }
    need(!url.username && !url.password && !url.search && !url.hash &&
      (url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)),
    'APPLICATION_USGS_FACILITATOR_INVALID');
  }
  const args = ['managed', '--project', directory, '--expected-inputs-sha', selected.sha256,
    '--expected-project-sha', selected.project?.sha256 ?? 'empty'];
  for (const [name, flag] of [['buyerConfiguration', '--buyer-config'], ['nativePython', '--hec-dss-python'],
    ['merchantPort', '--merchant-port'], ['facilitator', '--facilitator']])
    if (settings[name] !== undefined) args.push(flag, String(settings[name]));
  // The original Water model creates its private directories on Start.
  return { args, inputs, createDirectories: [],
    resourceKey: digest(json(canonical({ family: 'usgs-water', directory }))) };
}
function option(request, name, optional = false) {
  need(request.args?.[0] === 'managed', 'APPLICATION_USGS_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && !positions.length) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_USGS_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
async function readListener(url) {
  const response = await fetch(new URL('/api/application', url), {
    headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  need(response.ok && response.headers.get('content-type')?.startsWith('application/json'),
    'APPLICATION_USGS_LISTENER_CHANGED');
  const chunks = []; let count = 0;
  try {
    for await (const chunk of response.body) {
      count += chunk.length; need(count <= 16384, 'APPLICATION_USGS_LISTENER_CHANGED'); chunks.push(chunk);
    }
  } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

/** Admit only the actual original child, its reviewed private project and live listener. */
export async function usgsWaterStartup(request, operationDirectory, text, context = {}) {
  if (request.command !== 'usgs-water' || request.args?.[0] !== 'managed' || !request.applicationId ||
    typeof text !== 'string' || text.length > 16384 || !text.startsWith('{"schema":"' + WATER_MANAGED_STARTUP + '",')) return null;
  let ready; try { ready = JSON.parse(text); } catch { return null; }
  if (!plain(ready) || ready.schema !== WATER_MANAGED_STARTUP || ready.status !== 'USGS_WATER_WORKSPACE_READY') return null;
  absolute(operationDirectory);
  const directory = absolute(option(request, '--project'));
  const buyerConfiguration = option(request, '--buyer-config', true), nativePython = option(request, '--hec-dss-python', true);
  const current = await reviewWaterManagedInputs({ directory, buyerConfiguration, nativePython });
  const retained = (await readWaterManagedRecord(join(directory, WATER_MANAGED_FILE), 16384)).value;
  need(same(retained, ready) && same(current, ready.inputs) &&
    ready.reviewedInputsSha256 === option(request, '--expected-inputs-sha') &&
    (current.project?.sha256 ?? 'empty') === option(request, '--expected-project-sha'),
  'APPLICATION_USGS_STARTUP_CHANGED', 'Reopen this original project with its current saved selection.');
  need(Number.isSafeInteger(context.pid) && context.pid > 0 && plain(ready.process) &&
    Number.isSafeInteger(ready.process.pid) && Number.isSafeInteger(ready.process.ppid) &&
    (ready.process.pid === context.pid || ready.process.ppid === context.pid) &&
    ready.process.start === await identity(ready.process.pid) && await identity(context.pid),
  'APPLICATION_USGS_CHILD_CHANGED');
  const port = Number(option(request, '--port', true) ?? 0);
  const merchantPort = Number(option(request, '--merchant-port', true) ?? 0);
  need(Number.isInteger(port) && port >= 0 && port <= 65535 &&
    Number.isInteger(merchantPort) && merchantPort >= 0 && merchantPort <= 65535 &&
    same(ready.requested, { port, merchantPort, facilitator: option(request, '--facilitator', true) ?? null }),
  'APPLICATION_USGS_PORT_CHANGED');
  const url = waterManagedUrl(ready.url, port), observed = await readListener(url);
  need(plain(observed) && observed.schema === WATER_MANAGED_PROBE && observed.launchId === ready.launchId &&
    observed.directory === directory && observed.reviewedInputsSha256 === ready.reviewedInputsSha256 &&
    observed.inputsSha256 === current.sha256 && same(observed.process, ready.process),
  'APPLICATION_USGS_LISTENER_CHANGED');
  return { url, original: { schema: WATER_MANAGED_STARTUP, launchId: ready.launchId, directory,
    project: current.project, buyer: current.buyer, nativePython: current.nativePython,
    reviewedInputsSha256: ready.reviewedInputsSha256, inputsSha256: current.sha256,
    process: ready.process, requested: ready.requested } };
}
