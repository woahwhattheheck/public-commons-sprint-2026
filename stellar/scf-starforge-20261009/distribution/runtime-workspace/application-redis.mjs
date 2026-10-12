// MIT. Retained Redis authoring binding for the existing managed Applications launcher.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolute, need, plain } from './storage.mjs';

const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/redis/workspace/';
const STARTUP = 'stellar-forge.redis-workspace-startup.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function redisApplication(common) {
  return {
    id: 'redis', command: 'redis', title: 'Redis and Valkey merchant authoring', terminal: false,
    requiredSource: ROOT + 'cli.mjs',
    description: 'Reopen saved Redis products, merchant terms, live previews, customer packages and the original release controls.',
    fields: [
      field('workspaceDirectory', 'Original Redis workspace', 'path', true,
        'Select the initialized private directory. Its source connection, environment references, revisions and release history remain in use.'),
      ...common,
    ],
  };
}

export async function prepareRedisApplication(settings, inputPath, runtimeDirectory) {
  const workspace = await inputPath(settings.workspaceDirectory, 'directory', false, true);
  const { inspectMerchantRuntime } = await import('../../sf46-release/runtime-package.mjs');
  const selected = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const model = join(selected.sourceRoot, ROOT + 'model.mjs');
  const inputs = [workspace, await inputPath(model, 'file'),
    await inputPath(join(selected.sourceRoot, ROOT + 'cli.mjs'), 'file')];
  const original = await import(pathToFileURL(model).href);
  need(typeof original.inspectRedisWorkspaceBinding === 'function',
    'APPLICATION_REDIS_BINDING_UNAVAILABLE',
    'Choose an installed runtime containing the original Redis workspace binding inspector.');
  const binding = await original.inspectRedisWorkspaceBinding(settings.workspaceDirectory);
  need(plain(binding) && binding.schema === 'stellar-forge.redis-workspace-binding.v1' &&
    binding.directory === absolute(settings.workspaceDirectory) &&
    /^redis-workspace-[a-f0-9-]{36}$/.test(binding.workspaceId ?? '') &&
    /^[a-f0-9]{64}$/.test(binding.profileSha256 ?? ''), 'APPLICATION_REDIS_BINDING_CHANGED');
  // Saved revisions mutate the database between review and start. The original
  // writer validates the immutable identity and profile before recovery instead.
  return {
    args: ['workspace', 'open', '--directory', binding.directory,
      '--expected-workspace-id', binding.workspaceId,
      '--expected-profile-sha256', binding.profileSha256],
    inputs, binding,
  };
}

function selectedValue(request, name) {
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_REDIS_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
export function redisStartup(request, text) {
  if (request.command !== 'redis' || !Array.isArray(request.args) ||
      request.args[0] !== 'workspace' || request.args[1] !== 'open' ||
      typeof text !== 'string' || text.length > 16384 || !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'REDIS_WORKSPACE_READY') return null;
  const directory = absolute(selectedValue(request, '--directory')),
    workspaceId = selectedValue(request, '--expected-workspace-id'),
    profileSha256 = selectedValue(request, '--expected-profile-sha256'),
    port = selectedValue(request, '--port');
  need(/^redis-workspace-[a-f0-9-]{36}$/.test(workspaceId) && /^[a-f0-9]{64}$/.test(profileSha256) &&
    /^(0|[1-9]\d*)$/.test(port) && Number(port) <= 65535 &&
    value.directory === directory && value.workspaceId === workspaceId &&
    value.profileSha256 === profileSha256 && /^[a-f0-9]{64}$/.test(value.head ?? ''),
    'APPLICATION_REDIS_STARTUP_CHANGED', 'The original startup must name the reviewed workspace and source profile.');
  let url;
  try { url = new URL(value.operatorUrl); } catch { need(false, 'APPLICATION_REDIS_STARTUP_CHANGED'); }
  const actualPort = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    actualPort >= 1 && actualPort <= 65535 && (port === '0' || actualPort === Number(port)) &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    /^[a-f0-9]{64}$/.test(url.hash.slice(1)), 'APPLICATION_REDIS_STARTUP_CHANGED');
  return { url: url.href, original: { schema: STARTUP, directory, workspaceId, profileSha256, head: value.head } };
}
