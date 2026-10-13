// MIT. Exact installed source and retained native identity for the existing Applications launcher.
import { lstat, realpath } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSf61HostFile } from '../../stellar-forge/mcp-merchant-operator/sf61-connection.mjs';
import { readTykProduct } from './workspace.mjs';
import { LAUNCH_SCHEMA, WORKSPACE_SCHEMA, UUID, plain, need, canonical, sha256,
  privateBytes, privateDirectory, launchOptions, decode } from './common.mjs';

const TYK = 'stellar/scf-starforge-20261009/sf30-seller-sdk/tyk/';
export const TYK_PRODUCT_SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const TYK_PRODUCT_SOURCE_FILES = Object.freeze([
  'products/tyk-merchant/common.mjs',
  'products/tyk-merchant/workspace.mjs',
  'products/tyk-merchant/managed.mjs',
  'products/tyk-merchant/client.mjs',
  'products/tyk-merchant/client.d.mts',
  'products/tyk-merchant/cli.mjs',
  'products/tyk-merchant/application-provider.mjs',
  TYK + 'native.mjs',
  TYK + 'workspace/store.mjs',
  TYK + 'workspace/model.mjs',
  TYK + 'workspace/commissioning.mjs',
  TYK + 'workspace/commissioning-model.mjs',
  TYK + 'workspace/commissioning-browser.mjs',
  TYK + 'workspace/gateway-commissioning.mjs',
  TYK + 'workspace/gateway-commissioning-model.mjs',
  TYK + 'workspace/gateway-commissioning-browser.mjs',
  TYK + 'workspace/gateway-commissioning-drafts.mjs',
  TYK + 'workspace/browser-request-store.mjs',
  'stellar/scf-starforge-20261009/distribution/discovery/operating-plan.mjs',
  'stellar/scf-starforge-20261009/distribution/discovery/catalog.mjs',
  TYK + 'workspace/delivery.mjs',
  TYK + 'workspace/review.mjs',
  TYK + 'workspace/actions.mjs',
  TYK + 'workspace/server.mjs',
  TYK + 'workspace/cli.mjs',
  TYK + 'workspace/http-client.mjs',
  TYK + 'workspace/browser-assets.json',
  TYK + 'workspace/index.html',
  TYK + 'workspace/browser.mjs',
  TYK + 'workspace/style.css',
  'stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs',
  'stellar-forge/mcp-merchant-operator/sf61-connection.mjs',
  'stellar-forge/mcp-merchant-operator/sf61-connection-contracts.mjs',
]);

export async function tykProductSource(sourceRoot = TYK_PRODUCT_SOURCE_ROOT) {
  need(typeof sourceRoot === 'string' && sourceRoot === resolve(sourceRoot) &&
    await realpath(sourceRoot) === sourceRoot, 'Use the original installed source root.', 'SOURCE_CHANGED');
  const files = [];
  for (const name of TYK_PRODUCT_SOURCE_FILES) {
    const bytes = await readSf61HostFile(join(sourceRoot, name), 8 * 1024 * 1024);
    files.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return { root: sourceRoot, files, sha256: sha256(canonical(files)) };
}

/** First Open may create workspace.json; its original path is stable before that creation. */
export async function inspectTykWorkspaceDirectory(directory) {
  directory = await privateDirectory(directory);
  const bytes = await privateBytes(join(directory, 'workspace.json'), true, 65536);
  if (bytes === null) return { directory, workspaceId: null, identitySha256: null, createdAt: null };
  const value = decode(bytes);
  need(plain(value) && value.schema === WORKSPACE_SCHEMA && UUID.test(value.workspaceId ?? '') &&
    typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)),
  'Select the original Tyk workspace identity file.', 'WORKSPACE_CHANGED');
  return { directory, workspaceId: value.workspaceId, identitySha256: sha256(bytes), createdAt: value.createdAt };
}
async function file(role, path, maximum = 1024 * 1024) {
  const bytes = await privateBytes(path, false, maximum);
  return { role, path, bytes: bytes.length, sha256: sha256(bytes), maximum };
}
async function directory(role, path) {
  await privateDirectory(path);
  const info = await lstat(path, { bigint: true });
  return { role, path, dev: info.dev.toString(), ino: info.ino.toString() };
}
async function observation(value, environment) {
  const { profile, connections } = value;
  return {
    files: [
      await file('Product', join(profile.directory, 'product.json')),
      await file('Original setup', join(profile.directory, 'product.setup.json')),
      await file('Initial native connections', profile.seedsFile),
    ],
    directories: [
      await directory('Product', profile.directory),
      await directory('Original Tyk workspace', profile.workspaceDirectory),
      await directory('Complete file receiving', profile.receivingDirectory),
    ],
    workspace: await inspectTykWorkspaceDirectory(profile.workspaceDirectory),
    source: await tykProductSource(),
    initialConnections: connections.map(value => ({
      id: value.id, label: value.label, kind: value.kind, baseUrl: value.baseUrl, authEnv: value.authEnv,
      credentialAvailable: typeof environment[value.authEnv] === 'string' && environment[value.authEnv].length > 0,
    })),
  };
}
export async function inspectTykProductLaunch(input = {}, { environment = process.env } = {}) {
  const options = launchOptions(input), first = await readTykProduct(options.directory);
  const observed = await observation(first, environment);
  const confirmed = await readTykProduct(options.directory), again = await observation(confirmed, environment);
  need(canonical(first.profile) === canonical(confirmed.profile) && canonical(observed) === canonical(again),
    'The original Tyk workspace, source or product configuration changed during review.', 'BINDING_CHANGED');
  const resourceId = sha256(canonical({ schema: 'stellar-forge.tyk-product-resource.v1',
    directory: first.profile.workspaceDirectory }));
  const binding = { schema: LAUNCH_SCHEMA, resourceId, profile: first.profile, options, ...observed };
  return { ...binding, directory: options.directory, bindingSha256: sha256(canonical(binding)),
    review: { name: first.profile.name, workspaceId: observed.workspace.workspaceId,
      ownership: 'ORIGINAL_TYK_WORKSPACE',
      operation: 'Saved portfolio, reviewed cohort and original Gateway or Dashboard rollout',
      receiving: 'Complete original definitions, records and source blobs in the native streamed delivery',
      activation: 'Gateway saved definitions require the explicit native reload before active-state confirmation' } };
}
