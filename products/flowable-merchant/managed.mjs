// MIT. Exact installed source and retained native identity for the existing Applications launcher.
import { lstat, realpath } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSf61HostFile } from '../../stellar-forge/mcp-merchant-operator/sf61-connection.mjs';
import { readFlowableProduct } from './workspace.mjs';
import { LAUNCH_SCHEMA, WORKSPACE_SCHEMA, UUID, plain, need, canonical, sha256,
  privateBytes, privateDirectory, launchOptions, decode } from './common.mjs';

const FLOWABLE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/';
export const FLOWABLE_PRODUCT_SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const FLOWABLE_PRODUCT_SOURCE_FILES = Object.freeze([
  'products/flowable-merchant/common.mjs',
  'products/flowable-merchant/workspace.mjs',
  'products/flowable-merchant/managed.mjs',
  'products/flowable-merchant/client.mjs',
  'products/flowable-merchant/client.d.mts',
  'products/flowable-merchant/cli.mjs',
  'products/flowable-merchant/application-provider.mjs',
  FLOWABLE + 'native.mjs',
  FLOWABLE + 'workspace/store.mjs',
  FLOWABLE + 'workspace/model.mjs',
  FLOWABLE + 'workspace/delivery.mjs',
  FLOWABLE + 'workspace/review.mjs',
  FLOWABLE + 'workspace/actions.mjs',
  FLOWABLE + 'workspace/server.mjs',
  FLOWABLE + 'workspace/cli.mjs',
  FLOWABLE + 'workspace/http-client.mjs',
  FLOWABLE + 'workspace/browser-assets.json',
  FLOWABLE + 'workspace/index.html',
  FLOWABLE + 'workspace/browser.mjs',
  FLOWABLE + 'workspace/style.css',
  'stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs',
  'stellar-forge/mcp-merchant-operator/sf61-connection.mjs',
  'stellar-forge/mcp-merchant-operator/sf61-connection-contracts.mjs',
]);

export async function flowableProductSource(sourceRoot = FLOWABLE_PRODUCT_SOURCE_ROOT) {
  need(typeof sourceRoot === 'string' && sourceRoot === resolve(sourceRoot) &&
    await realpath(sourceRoot) === sourceRoot, 'Use the original installed source root.', 'SOURCE_CHANGED');
  const files = [];
  for (const name of FLOWABLE_PRODUCT_SOURCE_FILES) {
    const bytes = await readSf61HostFile(join(sourceRoot, name), 8 * 1024 * 1024);
    files.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return { root: sourceRoot, files, sha256: sha256(canonical(files)) };
}

/** First Open may create workspace.json; its original path is stable before that creation. */
export async function inspectFlowableWorkspaceDirectory(directory) {
  directory = await privateDirectory(directory);
  const bytes = await privateBytes(join(directory, 'workspace.json'), true, 65536);
  if (bytes === null) return { directory, workspaceId: null, identitySha256: null, createdAt: null };
  const value = decode(bytes);
  need(plain(value) && value.schema === WORKSPACE_SCHEMA && UUID.test(value.workspaceId ?? '') &&
    typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)),
  'Select the original Flowable workspace identity file.', 'WORKSPACE_CHANGED');
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
      await directory('Original Flowable workspace', profile.workspaceDirectory),
      await directory('Complete file receiving', profile.receivingDirectory),
    ],
    workspace: await inspectFlowableWorkspaceDirectory(profile.workspaceDirectory),
    source: await flowableProductSource(),
    initialConnections: connections.map(value => ({
      id: value.id, label: value.label, baseUrl: value.baseUrl, usernameEnv: value.usernameEnv, passwordEnv: value.passwordEnv,
      credentialAvailable: typeof environment[value.usernameEnv] === 'string' && environment[value.usernameEnv].length > 0 &&
        typeof environment[value.passwordEnv] === 'string' && environment[value.passwordEnv].length > 0,
    })),
  };
}
export async function inspectFlowableProductLaunch(input = {}, { environment = process.env } = {}) {
  const options = launchOptions(input), first = await readFlowableProduct(options.directory);
  const observed = await observation(first, environment);
  const confirmed = await readFlowableProduct(options.directory), again = await observation(confirmed, environment);
  need(canonical(first.profile) === canonical(confirmed.profile) && canonical(observed) === canonical(again),
    'The original Flowable workspace, source or product configuration changed during review.', 'BINDING_CHANGED');
  const resourceId = sha256(canonical({ schema: 'stellar-forge.flowable-product-resource.v1',
    directory: first.profile.workspaceDirectory }));
  const binding = { schema: LAUNCH_SCHEMA, resourceId, profile: first.profile, options, ...observed };
  return { ...binding, directory: options.directory, bindingSha256: sha256(canonical(binding)),
    review: { name: first.profile.name, workspaceId: observed.workspace.workspaceId,
      ownership: 'ORIGINAL_FLOWABLE_WORKSPACE',
      operation: 'Original deployments, process starts, human tasks, migration validation and saved engine history',
      receiving: 'Complete original BPMN resources, saved revisions, native requests, responses and journals',
      activation: 'Native deployment creates versioned definitions; migration applies the reviewed document to the selected running process' } };
}
