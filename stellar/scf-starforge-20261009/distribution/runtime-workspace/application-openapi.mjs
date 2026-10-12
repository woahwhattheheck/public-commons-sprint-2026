// MIT. Original OpenAPI authoring and outbound OAuth in managed Applications.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, need, plain } from './storage.mjs';

const ROOT = 'stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/';
const BINDING = 'stellar-forge.openapi-managed-binding.v1';
const STARTUP = 'stellar-forge.openapi-workspace-startup.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function openApiApplication(common) {
  return {
    id: 'openapi', command: 'openapi-workspace', title: 'API merchant authoring', terminal: false,
    requiredSource: ROOT + 'server.mjs',
    description: 'Import the original API source, review registered provider connections, configure paid routes, save merchant packages and reopen the same authoring and seller work.',
    fields: [
      field('outputParent', 'Private merchant projects directory', 'path', true,
        'An existing private folder, or a new folder in an existing private parent. Private OAuth stores stay separate.'),
      field('oauthConnectionsFile', 'Original OAuth host configuration', 'path', false,
        'Optional original host-connections JSON with trusted aliases and private directory environment references. Initialize each original connection before selecting it.'),
      field('allowLoopbackOAuth', 'Use a local development OAuth provider', 'boolean', false,
        'Only for an explicitly local provider. Normal registered providers retain public HTTPS.'),
      ...common.map(item => item.name === 'port' ? { ...item,
        description: 'Use 0 without OAuth, or the fixed nonzero listener registered for every selected OAuth callback.' } : item),
    ],
  };
}

/** Read the original installed inspector; never load or serialize a private grant file here. */
export async function prepareOpenApiApplication(settings, {
  inputPath, applicationEnvironment, runtimeDirectory,
} = {}) {
  need(typeof inputPath === 'function' && typeof applicationEnvironment === 'function',
    'APPLICATION_OPENAPI_INTEGRATION', 'Use the original Applications path and environment readers.');
  const runtime = await inspectMerchantRuntime(runtimeDirectory, { load: false });
  const module = join(runtime.sourceRoot, ROOT + 'managed-launch.mjs');
  const server = await inputPath(join(runtime.sourceRoot, ROOT + 'server.mjs'), 'file');
  let managed;
  try { managed = await inputPath(module, 'file'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!managed) {
    need(!settings.oauthConnectionsFile && !settings.allowLoopbackOAuth,
      'APPLICATION_OPENAPI_NOT_IN_RUNTIME',
      'Choose a READY runtime containing the managed OpenAPI host before selecting OAuth connections.');
    // Previously saved plain applications keep their original command and
    // startup announcement. No managed registration is synthesized for them.
    const output = await inputPath(settings.outputParent, 'directory', true, true);
    return {
      args: ['--out-parent', settings.outputParent], inputs: [server, output],
      createDirectories: output.exists ? [] : [output.path],
    };
  }
  const inputs = [managed, server];
  const original = await import(pathToFileURL(module).href);
  need(typeof original.inspectOpenApiLaunch === 'function', 'APPLICATION_OPENAPI_NOT_IN_RUNTIME',
    'Choose an installed runtime containing the original managed OpenAPI host.');
  const { environment } = await applicationEnvironment(settings.environmentFile);
  const selected = await original.inspectOpenApiLaunch({
    outputParent: settings.outputParent, port: settings.port,
    oauthConnectionsFile: settings.oauthConnectionsFile ?? null,
    allowLoopbackOAuth: settings.allowLoopbackOAuth === true,
  }, { env: environment, allowMissingOutput: true });
  need(plain(selected) && selected.binding?.schema === BINDING && HASH.test(selected.bindingSha256) &&
    selected.binding.output?.directory === absolute(settings.outputParent) &&
    plain(selected.review) && Array.isArray(selected.binding.profiles),
  'APPLICATION_OPENAPI_BINDING_CHANGED');
  const output = await inputPath(settings.outputParent, 'directory', true, true);
  need(output.exists === selected.binding.output.exists &&
    (!output.exists || String(output.dev) === selected.binding.output.device &&
      String(output.ino) === selected.binding.output.inode), 'APPLICATION_OPENAPI_INPUT_CHANGED');
  inputs.push(output);
  if (settings.oauthConnectionsFile) {
    const registry = await inputPath(settings.oauthConnectionsFile, 'file');
    need(registry.sha256 === selected.binding.registry.sha256 &&
      String(registry.dev) === selected.binding.registry.device &&
      String(registry.ino) === selected.binding.registry.inode, 'APPLICATION_OPENAPI_INPUT_CHANGED');
    inputs.push(registry);
  }
  for (const profile of selected.binding.profiles) {
    const directory = await inputPath(profile.directory.directory, 'directory', false, true);
    need(String(directory.dev) === profile.directory.device && String(directory.ino) === profile.directory.inode,
      'APPLICATION_OPENAPI_INPUT_CHANGED');
    inputs.push({ ...directory, oauth: {
      alias: profile.alias, directoryEnv: profile.directoryEnv,
      profileSha256: profile.profileSha256, source: profile.source,
      callbackUri: profile.callbackUri,
    } });
  }
  const args = ['--out-parent', settings.outputParent, '--managed-launch-sha256', selected.bindingSha256];
  if (settings.oauthConnectionsFile) args.push('--oauth-connections', settings.oauthConnectionsFile);
  if (settings.allowLoopbackOAuth) args.push('--allow-loopback-oauth');
  // The common Applications command appends its exact reviewed --port once.
  return {
    args, inputs, createDirectories: output.exists ? [] : [output.path],
    openapi: selected.review,
  };
}

function selectedValue(request, name, optional = false) {
  need(Array.isArray(request.args), 'APPLICATION_OPENAPI_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && positions.length === 0) return null;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string' &&
    !request.args[positions[0] + 1].startsWith('--'), 'APPLICATION_OPENAPI_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}

/** Accept only the selected original command's bounded, exact startup announcement. */
export function openApiStartup(request, operationDirectory, text, context = {}) {
  if (request.command !== 'openapi-workspace' || typeof text !== 'string' ||
    text.length > 16384 || !text.startsWith('{')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'OPENAPI_WORKSPACE_READY') return null;
  const outputParent = absolute(selectedValue(request, '--out-parent'));
  const bindingSha256 = selectedValue(request, '--managed-launch-sha256');
  const connectionsFile = selectedValue(request, '--oauth-connections', true);
  const portText = selectedValue(request, '--port', true) ?? '0';
  const allowLoopbackOAuth = request.args.filter(value => value === '--allow-loopback-oauth').length;
  need(HASH.test(bindingSha256) && /^(0|[1-9]\d*)$/.test(portText) && Number(portText) <= 65535 &&
    allowLoopbackOAuth <= 1 && (!connectionsFile || absolute(connectionsFile)) &&
    value.outputParent === outputParent && value.bindingSha256 === bindingSha256 &&
    value.connectionsFile === connectionsFile && value.requestedPort === Number(portText) &&
    value.allowLoopbackOAuth === (allowLoopbackOAuth === 1) &&
    (connectionsFile ? HASH.test(value.connectionsSha256 ?? '') : value.connectionsSha256 === null) &&
    Number.isSafeInteger(value.profileCount) && value.profileCount >= 0 && value.profileCount <= 64 &&
    (connectionsFile || value.profileCount === 0) && UUID.test(value.instanceId ?? '') &&
    Number.isSafeInteger(value.pid) && value.pid > 0 &&
    typeof value.startedAt === 'string' && Number.isFinite(Date.parse(value.startedAt)),
  'APPLICATION_OPENAPI_STARTUP_CHANGED', 'The original startup must match the reviewed OpenAPI host and registrations.');
  let url;
  try { url = new URL(value.url); } catch { need(false, 'APPLICATION_OPENAPI_STARTUP_CHANGED'); }
  const port = Number(url.port || 80);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && port >= 1 && port <= 65535 &&
    value.port === port && (Number(portText) === 0 || Number(portText) === port) &&
    !url.username && !url.password && !url.search && url.pathname === '/' &&
    /^[a-f0-9]{64}$/.test(url.hash.slice(1)), 'APPLICATION_OPENAPI_STARTUP_CHANGED');
  return {
    url: url.href,
    original: {
      schema: STARTUP, instanceId: value.instanceId, pid: value.pid, startedAt: value.startedAt,
      outputParent, bindingSha256, connectionsFile, connectionsSha256: value.connectionsSha256,
      profileCount: value.profileCount, requestedPort: Number(portText), port,
      allowLoopbackOAuth: value.allowLoopbackOAuth,
    },
  };
}
