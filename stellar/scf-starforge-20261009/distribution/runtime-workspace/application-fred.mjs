// MIT. The original FRED economic-editions project in managed Applications.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, need, plain } from './storage.mjs';

const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/fred/';
const STARTUP = 'stellar-forge.fred-workspace-startup.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function fredApplication(common = []) {
  return {
    id: 'fred', command: 'fred', title: 'Economic data editions', terminal: true,
    requiredSource: ROOT + 'launch.mjs',
    description: 'Reopen original FRED or ALFRED captures, compare economic revisions, publish merchant editions and recover the same customer purchases.',
    fields: [
      field('workspaceDirectory', 'Original economic project', 'path', true,
        'Select the initialized private FRED project or its received project. Source captures, saved reviews, publications and customer requests remain in this directory.'),
      field('buyerConfig', 'Original buyer configuration', 'path', false,
        'Optional existing private SF88 JSON. Its runtime, payer and intent journal are reused for customer approval, delivery and recovery.'),
      field('facilitator', 'Configured facilitator URL', 'text', false,
        'Use the original HTTPS facilitator for native payment serving. An empty value opens challenge-only serving.'),
      field('allowLocalFacilitator', 'Allow the configured local facilitator', 'boolean', false,
        'Allows the original http://127.0.0.1 service explicitly.'),
      field('merchantPort', 'Original routed merchant port', 'port', false,
        'Use the loopback port already routed by the publication HTTPS origin. Zero selects an available local port.'),
      field('terminalPython', 'Terminal Python executable', 'path', false,
        'Defaults to /usr/bin/python3. The existing application terminal carries native buyer approval.'),
      ...common,
    ],
  };
}

export async function prepareFredApplication(settings, { inputPath, runtimeDirectory } = {}) {
  const workspace = await inputPath(settings.workspaceDirectory, 'directory', false, true);
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false, source: false });
  const launch = join(runtime.sourceRoot, ROOT + 'launch.mjs');
  const inputs = [workspace, await inputPath(launch, 'file'),
    await inputPath(join(runtime.sourceRoot, ROOT + 'workspace.mjs'), 'file'),
    await inputPath(join(runtime.sourceRoot, ROOT + 'cli.mjs'), 'file')];
  if (settings.buyerConfig) inputs.push(await inputPath(settings.buyerConfig, 'file', false, true));
  const original = await import(pathToFileURL(launch).href);
  need(typeof original.inspectFredWorkspaceBinding === 'function', 'APPLICATION_FRED_BINDING_UNAVAILABLE');
  const binding = await original.inspectFredWorkspaceBinding({
    directory: workspace.path, buyerConfig: settings.buyerConfig, facilitator: settings.facilitator,
    allowLocalFacilitator: settings.allowLocalFacilitator === true, merchantPort: settings.merchantPort ?? 0,
  });
  need(plain(binding) && binding.schema === 'stellar-forge.fred-workspace-binding.v1' &&
    binding.directory === workspace.path && /^[a-f0-9-]{36}$/.test(binding.projectId ?? '') &&
    /^[a-f0-9]{64}$/.test(binding.sha256 ?? ''), 'APPLICATION_FRED_BINDING_CHANGED');
  const args = ['serve', '--project', binding.directory, '--expected-binding-sha256', binding.sha256,
    '--merchant-port', String(binding.merchantPort)];
  if (binding.buyerConfig) args.push('--buyer-config', binding.buyerConfig.path);
  if (binding.facilitator) args.push('--facilitator', binding.facilitator);
  if (binding.allowLocalFacilitator) args.push('--allow-local-facilitator');
  return { args, inputs };
}

function selectedValue(request, name, required = true) {
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (!positions.length && !required) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_FRED_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
async function authenticatedLaunch(url, token) {
  const response = await fetch(new URL('/api/launch', url), {
    headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  need(response.status === 200 && /^application\/json\b/i.test(response.headers.get('content-type') ?? ''),
    'APPLICATION_FRED_STARTUP_CHANGED', 'Open the original authenticated economic workspace.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    need(size <= 16384, 'APPLICATION_FRED_STARTUP_CHANGED');
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}
export async function fredStartup(request, text) {
  if (request.command !== 'fred' || !Array.isArray(request.args) || request.args[0] !== 'serve' ||
    typeof text !== 'string' || text.length > 16384 || !text.startsWith('{')) return null;
  let ready;
  try { ready = JSON.parse(text); } catch { return null; }
  if (!plain(ready) || ready.schema !== STARTUP || ready.state !== 'LISTENING') return null;
  const directory = absolute(selectedValue(request, '--project'));
  const expected = selectedValue(request, '--expected-binding-sha256');
  const port = selectedValue(request, '--port') ?? '0';
  const merchantPort = selectedValue(request, '--merchant-port');
  need(/^[a-f0-9]{64}$/.test(expected) && /^(0|[1-9]\d*)$/.test(port) && Number(port) <= 65535 &&
    /^(0|[1-9]\d*)$/.test(merchantPort) && Number(merchantPort) <= 65535 &&
    ready.binding?.directory === directory && ready.binding?.sha256 === expected &&
    ready.binding?.merchantPort === Number(merchantPort) &&
    /^[a-f0-9-]{36}$/.test(ready.binding?.projectId ?? '') && /^[a-f0-9-]{36}$/.test(ready.instanceId ?? ''),
    'APPLICATION_FRED_STARTUP_CHANGED');
  let url;
  try { url = new URL(ready.url); } catch { need(false, 'APPLICATION_FRED_STARTUP_CHANGED'); }
  const actualPort = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password &&
    !url.search && url.pathname === '/' && /^[a-f0-9]{64}$/.test(url.hash.slice(1)) &&
    actualPort >= 1 && actualPort <= 65535 && (port === '0' || Number(port) === actualPort),
    'APPLICATION_FRED_STARTUP_CHANGED');
  const live = await authenticatedLaunch(url, url.hash.slice(1));
  need(live?.schema === STARTUP && live.state === 'LISTENING' &&
    live.instanceId === ready.instanceId && live.binding?.sha256 === expected &&
    live.binding?.directory === directory && live.binding?.projectId === ready.binding.projectId &&
    live.binding?.merchantPort === Number(merchantPort) &&
    live.buyerConfigured === Boolean(ready.binding.buyerConfig),
    'APPLICATION_FRED_STARTUP_CHANGED', 'The live project must match the original reviewed economic workspace.');
  return { url: url.href, original: { schema: STARTUP, directory,
    projectId: live.binding.projectId, bindingSha256: expected, instanceId: live.instanceId,
    buyerConfigured: live.buyerConfigured, merchantPort: live.binding.merchantPort, startedAt: live.startedAt } };
}
