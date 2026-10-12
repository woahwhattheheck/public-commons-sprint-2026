// MIT. Original Redis setup and saved authoring through managed Applications.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolute, need, plain, regular, digest } from './storage.mjs';

const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/redis/workspace/';
const STARTUP = 'stellar-forge.redis-workspace-startup.v1';
export const REDIS_SETUP_STARTUP = 'stellar-forge.redis-setup-startup.v1';
const REVIEW = 'stellar-forge.redis-application-review.v1';
const operation = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value);
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function redisApplication(common) {
  return {
    id: 'redis', command: 'redis', title: 'Redis and Valkey merchant authoring', terminal: false,
    requiredSource: ROOT + 'cli.mjs',
    description: 'Set up a Redis, Cluster, Sentinel or Upstash connection, or reopen its saved products, merchant terms, customer packages and release controls.',
    fields: [
      field('workspaceDirectory', 'Redis workspace', 'path', true,
        'Choose the original private workspace, or a new directory in an existing private parent.'),
      field('create', 'Set up a new workspace', 'boolean', false,
        'Open connection setup when this directory is new. Later starts reopen the workspace created there.'),
      field('setupFile', 'Saved connection setup JSON', 'path', false,
        'Optional complete source, merchant plan and public CA bundles for new setup. Existing workspaces retain their original connection.'),
      ...common,
    ],
  };
}

function retainedBinding(value, directory) {
  need(plain(value) && value.schema === 'stellar-forge.redis-workspace-binding.v1' &&
    value.directory === absolute(directory) &&
    /^redis-workspace-[a-f0-9-]{36}$/.test(value.workspaceId ?? '') &&
    sha256(value.profileSha256) && Array.isArray(value.environmentNames) &&
    value.environmentNames.every(name => typeof name === 'string' && /^[A-Z_][A-Z0-9_]{0,127}$/.test(name)),
    'APPLICATION_REDIS_BINDING_CHANGED');
  // The command review follows immutable source identity. Product saves advance
  // head normally and do not invalidate a queued open or require credentials.
  return {schema:value.schema, workspaceId:value.workspaceId, profileSha256:value.profileSha256,
    directory:value.directory, label:value.label, environmentNames:[...value.environmentNames],
    ...(value.connection === undefined ? {} : {connection:structuredClone(value.connection)})};
}

export async function prepareRedisApplication(settings, inputPath, runtimeDirectory) {
  const workspace = await inputPath(settings.workspaceDirectory, 'directory', true, true);
  need(workspace.exists || settings.create === true, 'APPLICATION_REDIS_WORKSPACE_REQUIRED',
    'Choose a saved Redis workspace, or enable connection setup for a new directory.');
  const { inspectMerchantRuntime } = await import('../../sf46-release/runtime-package.mjs');
  const selected = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const model = join(selected.sourceRoot, ROOT + 'model.mjs');
  const inputs = [workspace, await inputPath(model, 'file'),
    await inputPath(join(selected.sourceRoot, ROOT + 'cli.mjs'), 'file')];
  const original = await import(pathToFileURL(model).href);
  need(typeof original.inspectRedisWorkspaceBinding === 'function',
    'APPLICATION_REDIS_BINDING_UNAVAILABLE',
    'Choose an installed runtime containing the original Redis workspace binding inspector.');
  if (workspace.exists) {
    const binding = await original.inspectRedisWorkspaceBinding(settings.workspaceDirectory, {includeConnection:true});
    const retained = retainedBinding(binding, settings.workspaceDirectory);
    return {
      args: ['workspace', 'open', '--directory', binding.directory,
        '--expected-workspace-id', binding.workspaceId,
        '--expected-profile-sha256', binding.profileSha256],
      inputs, binding, review:{schema:REVIEW, mode:'open', binding:retained},
    };
  }

  const setupModel = join(selected.sourceRoot, ROOT + 'setup-model.mjs');
  for (const name of ['setup-model.mjs', 'setup-server.mjs', 'public/setup.mjs', 'public/setup.html', 'public/setup.css'])
    inputs.push(await inputPath(join(selected.sourceRoot, ROOT + name), 'file'));
  const setup = await import(pathToFileURL(setupModel).href);
  need(typeof setup.normalizeRedisSetup === 'function' && typeof setup.redisSetupTemplates === 'function',
    'APPLICATION_REDIS_SETUP_UNAVAILABLE', 'Choose an installed runtime containing the original Redis connection setup.');
  const args = ['workspace', 'setup', '--directory', workspace.path];
  let draft, inputSha256 = null;
  if (settings.setupFile) {
    const input = await inputPath(settings.setupFile, 'file');
    const bytes = await regular(input.path, 3145728);
    inputSha256 = digest(bytes);
    need(input.sha256 === inputSha256, 'APPLICATION_REDIS_SETUP_CHANGED',
      'The complete setup file changed during review. Select its current saved bytes.');
    try { draft = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
    catch { need(false, 'APPLICATION_REDIS_SETUP_JSON_INVALID', 'Choose the original complete connection setup JSON.'); }
    inputs.push(input);
    args.push('--input', input.path, '--expected-input-sha256', inputSha256);
  } else {
    for (const name of ['example-source.json', 'example-merchant-plan.json'])
      inputs.push(await inputPath(join(selected.sourceRoot, ROOT + '../' + name), 'file'));
    draft = await setup.redisSetupTemplates();
  }
  // The setup browser resolves availability from its own process environment.
  // This offline review retains the names and public connection/certificate
  // identity, without turning host availability into a saved selection.
  const normalized = setup.normalizeRedisSetup(draft, {});
  const {environment, ...initial} = normalized.review;
  return {args, inputs, review:{schema:REVIEW, mode:'setup', directory:workspace.path,
    inputSha256, initial:{...initial, environmentNames:environment.map(item=>item.name)}}};
}

export function redisApplicationRunArguments(command, args, requestId) {
  if (command !== 'redis' || !Array.isArray(args) || args[0] !== 'workspace' || args[1] !== 'setup') return args;
  need(operation(requestId) && !args.includes('--setup-operation'), 'APPLICATION_REDIS_SETUP_OPERATION_INVALID');
  // This is the existing retained managed operation UUID. Continuing its run
  // reuses the exact argv and recovers only the workspace created by that setup.
  return [...args, '--setup-operation', requestId];
}

function selectedValue(request, name, optional = false) {
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && positions.length === 0) return null;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string',
    'APPLICATION_REDIS_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
function operatorUrl(value, port) {
  let url;
  try { url = new URL(value); } catch { need(false, 'APPLICATION_REDIS_STARTUP_CHANGED'); }
  const actualPort = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    actualPort >= 1 && actualPort <= 65535 && (port === '0' || actualPort === Number(port)) &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    /^[a-f0-9]{64}$/.test(url.hash.slice(1)), 'APPLICATION_REDIS_STARTUP_CHANGED');
  return url.href;
}
export function redisStartup(request, text) {
  if (request.command !== 'redis' || !Array.isArray(request.args) ||
      request.args[0] !== 'workspace' || !['open','setup'].includes(request.args[1]) ||
      typeof text !== 'string' || text.length > 16384 || !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  const setup = request.args[1] === 'setup', schema = setup ? REDIS_SETUP_STARTUP : STARTUP;
  if (!plain(value) || value.schema !== schema ||
      value.status !== (setup ? 'REDIS_SETUP_READY' : 'REDIS_WORKSPACE_READY')) return null;
  const directory = absolute(selectedValue(request, '--directory')),
    port = selectedValue(request, '--port');
  need(/^(0|[1-9]\d*)$/.test(port) && Number(port) <= 65535 && value.directory === directory,
    'APPLICATION_REDIS_STARTUP_CHANGED', 'The original startup must name the reviewed directory and local port.');
  const url = operatorUrl(value.operatorUrl, port);
  if (setup) {
    const operationId = selectedValue(request, '--setup-operation'),
      input = selectedValue(request, '--input', true),
      inputSha256 = selectedValue(request, '--expected-input-sha256', true);
    need(operation(operationId) && value.operationId === operationId &&
      /^redis-setup-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.setupId ?? '') &&
      (input === null ? inputSha256 === null : sha256(inputSha256)),
      'APPLICATION_REDIS_STARTUP_CHANGED', 'The setup must belong to the original queued application operation.');
    if (value.setupOrigin !== undefined && value.setupOrigin !== null) {
      const origin = value.setupOrigin;
      need(plain(origin) && origin.schema === 'stellar-forge.redis-setup-origin.v1' &&
        origin.setupId === value.setupId && origin.operationId === operationId &&
        origin.inputSha256 === inputSha256 && operation(origin.requestId) && sha256(origin.digest),
        'APPLICATION_REDIS_STARTUP_CHANGED', 'Continue must reopen the workspace created by this same setup operation.');
    }
    return {url, original:{schema, directory, setupId:value.setupId, operationId, inputSha256,
      ...(value.setupOrigin ? {setupOrigin:structuredClone(value.setupOrigin)} : {})}};
  }
  const workspaceId = selectedValue(request, '--expected-workspace-id'),
    profileSha256 = selectedValue(request, '--expected-profile-sha256');
  need(/^redis-workspace-[a-f0-9-]{36}$/.test(workspaceId) && sha256(profileSha256) &&
    value.workspaceId === workspaceId && value.profileSha256 === profileSha256 && sha256(value.head),
    'APPLICATION_REDIS_STARTUP_CHANGED', 'The original startup must name the reviewed workspace and source profile.');
  return {url, original:{schema, directory, workspaceId, profileSha256, head:value.head}};
}
