// MIT. Install the complete municipal service configuration workbench in merchant Applications.
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { inspectMerchantRuntime } from '../../../sf46-release/runtime-package.mjs';
import { APPLICATION_PROVIDER_SCHEMA, applicationField as field, applicationPreparation,
  applicationPrivateUrl, observeApplicationStartup } from '../../../distribution/runtime-workspace/application-provider.mjs';

const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/';
const STARTUP = 'stellar-forge.open311-service-configuration-startup.v1';
const BINDING = 'stellar-forge.open311-service-configuration-binding.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
function need(value, message) { if (!value) throw new Error(message); }
function plain(value) { return value != null && typeof value === 'object' && !Array.isArray(value); }
function bindingSha(directory, workspaceId) {
  return createHash('sha256').update(JSON.stringify({ directory, schema: BINDING, workspaceId })).digest('hex');
}
export function open311ServiceConfigurationApplication(common = []) {
  return { id: 'open311-service-configuration', command: 'open311-service-configuration', title: 'Municipal service configuration',
    terminal: false, requiredSource: ROOT + 'cli.mjs',
    description: 'Configure agency categories, departments, staff and routing; preview the complete original request register and exact resident messages; review implementation handovers and receive the complete editable workspace.',
    fields: [field('workspaceDirectory', 'Open311 service configuration workspace', 'path', true,
      'Choose an initialized service configuration desk or a complete service configuration received from another operator.'), ...common] };
}
export async function prepareOpen311ServiceConfigurationApplication(settings, { inputPath, runtimeDirectory } = {}) {
  const workspace = await inputPath(settings.workspaceDirectory, 'directory', false, true);
  await inputPath(join(workspace.path, 'open311-service-configuration.sqlite'), 'file', false, true);
  const runtime = await inspectMerchantRuntime(resolve(runtimeDirectory), { load: false, source: false });
  const inputs = [workspace];
  for (const file of ['cli.mjs', 'server.mjs', 'workspace.mjs'])
    inputs.push(await inputPath(join(runtime.sourceRoot, ROOT + file), 'file'));
  const module = await import(pathToFileURL(join(runtime.sourceRoot, ROOT + 'workspace.mjs')).href);
  const original = module.openWorkspace(workspace.path, { create: false });
  let identity;
  try { identity = original.state(); } finally { original.close(); }
  need(UUID.test(identity.workspaceId || ''), 'The selected Open311 service configuration workspace has an invalid identity.');
  const sha = bindingSha(workspace.path, identity.workspaceId);
  return { args: ['serve', '--workspace', workspace.path, '--expected-workspace-id', identity.workspaceId,
    '--expected-binding-sha256', sha], inputs };
}
function argument(request, name, required = true) {
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (!positions.length && !required) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'The selected Open311 service configuration application arguments changed.');
  return request.args[positions[0] + 1];
}
async function liveStartup(url) {
  const response = await fetch(new URL('/api/launch', url), {
    redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' }
  });
  need(response.ok, 'The selected Open311 service configuration application did not answer its startup request.');
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    need(length <= 16384, 'The Open311 service configuration startup response exceeds its documented limit.');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
  need(plain(value), 'The Open311 service configuration startup response is not an object.');
  return value;
}
export async function open311ServiceConfigurationStartup(request, text) {
  if (request.command !== 'open311-service-configuration' || !Array.isArray(request.args) || request.args[0] !== 'serve' ||
      typeof text !== 'string' || text.length > 16384 || !text.startsWith('{')) return null;
  let ready; try { ready = JSON.parse(text); } catch { return null; }
  if (!plain(ready) || ready.schema !== STARTUP || ready.state !== 'LISTENING') return null;
  const directory = resolve(argument(request, '--workspace'));
  const workspaceId = argument(request, '--expected-workspace-id');
  const sha = argument(request, '--expected-binding-sha256');
  const port = argument(request, '--port', false) ?? '0';
  need(UUID.test(workspaceId) && HASH.test(sha) && sha === bindingSha(directory, workspaceId) &&
    /^(0|[1-9]\d*)$/.test(port) && Number(port) <= 65535,
    'The selected Open311 service configuration workspace binding changed.');
  const check = value => plain(value) && value.schema === STARTUP && value.state === 'LISTENING' &&
    value.workspaceId === workspaceId && value.directory === directory && value.bindingSha256 === sha &&
    value.binding?.schema === BINDING &&
    value.binding?.directory === directory && value.binding?.workspaceId === workspaceId &&
    value.binding?.sha256 === sha && UUID.test(value.instanceId || '');
  need(check(ready), 'The original Open311 service configuration startup belongs to a different workspace.');
  const address = applicationPrivateUrl(ready.url);
  need(address, 'The Open311 service configuration browser address must be a private loopback URL.');
  const url = new URL(address);
  need(url.pathname === '/' && !url.search && !url.hash &&
    (port === '0' || Number(port) === Number(url.port || 80)),
    'The Open311 service configuration browser address differs from the selected application.');
  const live = await liveStartup(url);
  need(check(live) && live.instanceId === ready.instanceId && live.url === ready.url,
    'The live Municipal service configuration server differs from the original selected workspace.');
  return { url: url.href, workspaceId,
    original: { schema: STARTUP, directory, workspaceId, bindingSha256: sha,
      instanceId: live.instanceId, startedAt: live.startedAt } };
}
export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'open311-service-configuration', order: 375,
  catalog({ common }) { return [open311ServiceConfigurationApplication(common)]; },
  async prepare(type, settings, context) {
    const prepared = applicationPreparation(settings, context.inputPath);
    const original = await prepareOpen311ServiceConfigurationApplication(settings, context);
    prepared.args.push(...original.args); prepared.inputs.push(...original.inputs);
    return { args: prepared.args, inputs: prepared.inputs, createDirectories: prepared.createDirectories };
  },
  matchRequest(request) { return !request.pythonCommand && request.command === 'open311-service-configuration'; },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{') || !text.includes('"schema":"' + STARTUP + '"')) return null;
      return () => open311ServiceConfigurationStartup(request, text);
    });
  }
};
