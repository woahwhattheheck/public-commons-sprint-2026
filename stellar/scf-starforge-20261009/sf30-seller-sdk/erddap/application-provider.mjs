// MIT. Source-owned ERDDAP registration in the original managed Applications host.
import { APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup } from '../../distribution/runtime-workspace/application-provider.mjs';
import { need } from '../../distribution/runtime-workspace/storage.mjs';

const STARTUP = 'stellar-forge.erddap-workspace-startup.v1';
const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/erddap/';
function argument(request, name, required = true) {
  const found = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (!found.length && !required) return undefined;
  need(found.length === 1 && typeof request.args[found[0] + 1] === 'string', 'APPLICATION_ERDDAP_ARGUMENT_CHANGED');
  return request.args[found[0] + 1];
}
export async function erddapStartup(request, line) {
  if (request.command !== 'erddap' || !Array.isArray(request.args) || typeof line !== 'string' ||
    line.length > 16384 || !line.startsWith('{')) return null;
  let ready; try { ready = JSON.parse(line); } catch { return null; }
  if (ready?.schema !== STARTUP || ready.state !== 'LISTENING') return null;
  const workspace = argument(request, '--workspace'), port = argument(request, '--port', false) ?? '0';
  need(ready.workspace === workspace && /^[a-f0-9-]{36}$/.test(ready.instanceId ?? '') &&
    /^(0|[1-9]\d*)$/.test(port) && Number(port) <= 65535, 'APPLICATION_ERDDAP_STARTUP_CHANGED');
  let url; try { url = new URL(ready.url); } catch { need(false, 'APPLICATION_ERDDAP_STARTUP_CHANGED'); }
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/' &&
    !url.username && !url.password && !url.search && /^#[A-Za-z0-9_-]{43}$/.test(url.hash) &&
    Number(url.port) >= 1 && Number(url.port) <= 65535 && (port === '0' || Number(port) === Number(url.port)),
  'APPLICATION_ERDDAP_STARTUP_CHANGED');
  const response = await fetch(new URL('/api/launch', url), { headers: { authorization: 'Bearer ' + url.hash.slice(1),
    origin: url.origin, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000) });
  need(response.status === 200 && /^application\/json\b/i.test(response.headers.get('content-type') ?? ''),
    'APPLICATION_ERDDAP_STARTUP_CHANGED', 'Read the original authenticated ERDDAP listener.');
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; need(bytes <= 16384, 'APPLICATION_ERDDAP_STARTUP_CHANGED'); chunks.push(chunk); }
  const live = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  need(live?.schema === STARTUP && live.state === 'LISTENING' && live.instanceId === ready.instanceId &&
    live.workspace === workspace && live.startedAt === ready.startedAt, 'APPLICATION_ERDDAP_STARTUP_CHANGED',
  'The actual listener must retain the selected original workspace and owner instance.');
  return { url: url.href, original: { schema: STARTUP, state: 'LISTENING', workspace,
    instanceId: live.instanceId, startedAt: live.startedAt },
    ...(argument(request, '--connection-file', false) ? { connectionFile: argument(request, '--connection-file') } : {}) };
}
export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'erddap', order: 410,
  catalog({ common, field }) {
    return [{ id: 'erddap', command: 'erddap', requiredSource: ROOT + 'cli.mjs',
      title: 'Ocean and environmental data', terminal: false,
      description: 'Review original ERDDAP grids and station tables, acquire exact selections, compare retained editions and receive complete native datasets.',
      fields: [field('workspaceDirectory', 'Original ERDDAP workspace', 'path', true,
        'Select an initialized private workspace or its received customer workspace.'),
        field('connectionFile', 'Private operator connection file', 'path', false,
          'Optional private startup file for the existing MCP operator. Restart refreshes only a record belonging to this same workspace.'), ...common] }];
  },
  async prepare(type, settings, context) {
    const { args, inputs, createDirectories, path } = applicationPreparation(settings, context.inputPath);
    const workspace = await path('workspaceDirectory', 'directory', false, true);
    need(workspace?.path, 'APPLICATION_ERDDAP_WORKSPACE_REQUIRED');
    args.push('--workspace', workspace.path, 'serve');
    if (settings.connectionFile) { const selected = await path('connectionFile', 'file', true, true); args.push('--connection-file', selected.path); }
    return { args, inputs, createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === 'erddap' && request.args?.includes('serve'); },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, line => {
      if (!line.startsWith('{') || !line.includes(STARTUP)) return null;
      return () => erddapStartup(request, line);
    });
  },
};
