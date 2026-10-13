// MIT. Managed launch selection for the original native MPP product.
import { lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { digest, regular, need, plain } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import { readMppProduct, readNativeIdentity, readProductCustomers, inspectNativeSelection,
  privateFile, decode, stable, fullPath, portNumber, environmentName, openMppProduct } from './workspace.mjs';

export const MPP_PRODUCT_LAUNCH_SCHEMA = 'stellar-forge.mpp-product-launch.v1';
export const MPP_PRODUCT_READY_SCHEMA = 'stellar-forge.mpp-product-ready.v1';
export function mppLaunchOptions({ directory, port = 0, mcpPort = 0, browserOnly = false,
  tokenEnv = 'MCP_ACCESS_TOKEN' } = {}) {
  need(typeof browserOnly === 'boolean', 'MPP_PRODUCT_OPTIONS_INVALID');
  return { directory: fullPath(directory), port: portNumber(port), mcpPort: portNumber(mcpPort),
    browserOnly, tokenEnv: environmentName(tokenEnv) };
}
async function directoryIdentity(role, path) {
  const original = await realpath(path), info = await lstat(original);
  need(original === path && info.isDirectory() && !info.isSymbolicLink(), 'MPP_PRODUCT_DIRECTORY_CHANGED');
  return { role, path, dev: String(info.dev), ino: String(info.ino) };
}
async function observedFile(role, path, { privateOnly = false, maximum = 16 * 1024 * 1024 } = {}) {
  const reference = fullPath(path), original = await realpath(reference);
  const bytes = privateOnly ? await privateFile(original, maximum) : await regular(original, maximum);
  return { role, path: original, ...(original !== reference ? { referencePath: reference } : {}),
    bytes: bytes.length, sha256: digest(bytes) };
}
async function observation(profile, options, environment) {
  const native = await readNativeIdentity(profile.workspaceDirectory);
  const customers = await readProductCustomers(profile);
  const runtime = await inspectNativeSelection(profile.dependencyRoot);
  const files = [];
  for (const [role, path] of Object.entries({
    product: join(profile.directory, 'product.json'), setup: join(profile.directory, 'product.setup.json'),
    customers: profile.customersFile, merchantOperator: profile.configuration,
    nativeMetadata: join(profile.workspaceDirectory, 'workspace.json')
  })) files.push(await observedFile(role, path, { privateOnly: true }));
  for (const [kind, selected] of Object.entries(native.profiles)) {
    if (!selected) continue;
    files.push({ role: 'nativeProfile:' + kind, path: selected.path, bytes: selected.bytes, sha256: selected.sha256 });
    const value = selected.profile, configuration = value.configuration ?? value;
    // Historical purchase/profile files keep their own original runtime paths. The launch binds active selections.
    if (configuration.dependencyRoot !== undefined)
      need(configuration.dependencyRoot === profile.dependencyRoot, 'MPP_PRODUCT_RUNTIME_SELECTION_CHANGED',
        'The active native profile must select this product’s exact dependency runtime.');
    if (value.handlersModule) files.push(await observedFile('merchantHandlers', value.handlersModule));
    for (const route of value.routes ?? [])
      if (route.resource?.kind === 'json-file')
        files.push(await observedFile('merchantResource:' + route.id, route.resource.path, { maximum: 2 * 1024 * 1024 }));
    if (configuration.operator?.policy)
      files.push(await observedFile('policy:' + kind, configuration.operator.policy));
  }
  for (const [key, value] of Object.entries(customers.customers)) {
    files.push({ role: 'customer:' + key, path: value.file,
      bytes: (await privateFile(value.file, 2 * 1024 * 1024)).length, sha256: value.sha256 });
    const configuration = decode(await privateFile(value.file, 2 * 1024 * 1024));
    if (configuration.operator?.policy)
      files.push(await observedFile('policy:customer:' + key, configuration.operator.policy));
  }
  files.push(...runtime.files);
  for (const item of runtime.installed) if (item.sha256)
    files.push({ role: 'installed:' + item.name, path: item.path, bytes: item.bytes, sha256: item.sha256 });
  const raw = decode(await privateFile(profile.configuration));
  // The native MPP connection contains the chosen live port, so its semantic selection is checked by
  // readMppProduct. Operator-added providers retain their original immutable connection inputs.
  for (const [role, value] of Object.entries(raw)) {
    if (role === 'mppConnection' || !role.endsWith('Connection') || typeof value !== 'string') continue;
    files.push(await observedFile('operator:' + role, resolve(dirname(profile.configuration), value),
      { maximum: 64 * 1024 * 1024 }));
  }
  const oauthPath = options.browserOnly ? null : environment.MCP_OAUTH_CONFIG ?? null;
  if (oauthPath !== null) files.push(await observedFile('agentOAuth', fullPath(oauthPath), { maximum: 262144 }));
  const directories = [];
  for (const [role, path] of Object.entries({
    product: profile.directory, nativeWorkspace: profile.workspaceDirectory,
    nativeRuntime: profile.dependencyRoot, customers: profile.customerFiles,
    receiving: profile.receivingDirectory, operator: profile.operatorDirectory,
    releases: resolve(dirname(profile.configuration), raw.releaseStore),
    exports: resolve(dirname(profile.configuration), raw.exportsDirectory)
  })) directories.push(await directoryIdentity(role, path));
  return {
    files, directories,
    native: { workspace: profile.workspaceDirectory, createdAt: native.metadata.createdAt,
      revision: native.metadata.revision, profiles: Object.fromEntries(Object.entries(native.profiles).map(([kind, item]) => [kind, item?.id ?? null])) },
    customers: { revision: customers.revision,
      selections: Object.fromEntries(Object.entries(customers.customers).map(([key, value]) => [key, {
        label: value.label, configurationSha256: value.sha256 }])) },
    runtime: { directory: runtime.directory, versions: runtime.versions, state: runtime.state },
    authorization: { mode: options.browserOnly ? 'browser-only' : oauthPath ? 'oauth' : 'fixed-bearer',
      tokenEnv: options.tokenEnv, oauthPath,
      clientOrigins: options.browserOnly ? [] : String(environment.MCP_CLIENT_ORIGINS ?? '').split(',')
        .map(value => value.trim()).filter(Boolean) }
  };
}
/** Reads original configuration; normal payment, response and job activity is not a configuration change. */
export async function inspectMppLaunch(input, { environment = process.env } = {}) {
  const options = mppLaunchOptions(input), profile = await readMppProduct(options.directory);
  need(options.browserOnly || options.port === 0 || options.mcpPort === 0 || options.port !== options.mcpPort,
    'MPP_PRODUCT_PORT_INVALID', 'Choose different browser and agent ports or use 0.');
  const observed = await observation(profile, options, environment);
  const confirmed = await readMppProduct(options.directory);
  const after = await observation(confirmed, options, environment);
  need(stable(profile) === stable(confirmed) && stable(observed) === stable(after),
    'MPP_PRODUCT_LAUNCH_CHANGED', 'The original configuration changed during launch review. Read the current selection.');
  const resourceId = digest(stable({ schema: 'stellar-forge.mpp-product-resource.v1',
    workspace: profile.workspaceDirectory, createdAt: profile.workspaceCreatedAt }));
  const binding = { schema: MPP_PRODUCT_LAUNCH_SCHEMA, resourceId, profile, options, ...observed };
  return { schema: MPP_PRODUCT_LAUNCH_SCHEMA, profile, options, resourceId, binding,
    bindingSha256: digest(stable(binding)), ...observed,
    review: { name: profile.name, directory: profile.directory, workspace: profile.workspaceDirectory,
      workspaceCreatedAt: profile.workspaceCreatedAt, workspaceOwnership: profile.workspaceOwnership,
      dependencyRoot: profile.dependencyRoot, runtimeState: observed.runtime.state, versions: observed.runtime.versions,
      revision: observed.native.revision, profiles: observed.native.profiles,
      customerRevision: observed.customers.revision, customers: observed.customers.selections,
      browserOnly: options.browserOnly, port: options.port, mcpPort: options.mcpPort,
      tokenEnv: options.tokenEnv, authorizationMode: observed.authorization.mode } };
}
export async function openMppProductManaged(input, { environment = process.env } = {}) {
  const options = mppLaunchOptions(input);
  need(typeof input.expectedBindingSha256 === 'string' && /^[a-f0-9]{64}$/.test(input.expectedBindingSha256),
    'MPP_PRODUCT_BINDING_REQUIRED', 'Supply the current inspected native product launch SHA-256.');
  const active = await openMppProduct({ ...options, environment, managedBindingSha256: input.expectedBindingSha256 });
  const selected = active.launch;
  const startup = { schema: MPP_PRODUCT_READY_SCHEMA, state: 'OPEN',
    bindingSha256: selected.bindingSha256, resourceId: selected.resourceId,
    name: active.name, directory: active.directory, workspace: active.workspace,
    workspaceCreatedAt: active.workspaceCreatedAt, revision: selected.native.revision,
    pid: active.pid, ppid: active.ppid, versions: active.versions, console: 'native',
    browserUrl: active.browserUrl, mcpUrl: active.mcpUrl,
    browserOnly: options.browserOnly, port: options.port, mcpPort: options.mcpPort,
    tokenEnv: options.tokenEnv };
  return { ...active, startup, bindingSha256: selected.bindingSha256, resourceId: selected.resourceId };
}
