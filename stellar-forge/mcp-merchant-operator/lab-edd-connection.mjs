// MIT. Host-selected Lab desk over the original paid merchant and SF88 customer workspace.
import { lstat, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { exact, failure, identifier, line, plain } from './host-files.mjs';
import { wqxReadPrivate, wqxPrivateDirectory, wqxHostPath, wqxDecode } from './wqx-workspace-connection.mjs';
import { originOf } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/intake/protocol.mjs';
import { storageLimits } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/inputs/protocol.mjs';
import { normalizeBuyerTransport } from '../../stellar/scf-starforge-20261009/sf31-buyer-client/public-transport.mjs';

export const LAB_WORKSPACE_CONNECTION_SCHEMA = 'stellar-forge.lab-edd-workspace-connection.v1';
const fail = message => { throw failure('LAB_CONFIGURATION', message); };
function integer(value, fallback, min, max, label) {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('Use the original ' + label + ' within its declared range.');
  return value;
}
function variable(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)) fail('Select a named host ' + label + ' environment variable.');
  return value;
}
async function directory(value, base, privateState = false) {
  const path = wqxHostPath(value, base);
  if (privateState) return wqxPrivateDirectory(path);
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) fail('Use the canonical existing native source directory.');
  return path;
}
async function roots(value, base) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 30) fail('Keep the original customer root selection within thirty directories.');
  const selected = await Promise.all(value.map(path => directory(path, base)));
  if (new Set(selected).size !== selected.length) fail('List every original source root once.');
  return selected;
}
export async function readLabWorkspaceConfiguration(path, { paidJobWorkspaces } = {}) {
  path = resolve(path);
  const raw = wqxDecode(await wqxReadPrivate(path, 1024 * 1024)), base = dirname(path);
  exact(raw, ['schema', 'workspaces'], ['schema', 'workspaces']);
  if (raw.schema !== LAB_WORKSPACE_CONNECTION_SCHEMA || !plain(raw.workspaces) ||
      Object.keys(raw.workspaces).length < 1 || Object.keys(raw.workspaces).length > 32)
    fail('Select a complete Lab workspace connection with one to thirty-two named customer desks.');
  if (!paidJobWorkspaces?.workspaces) fail('Configure the original paidJobWorkspaceConnection before adding its laboratory customer desk.');
  const workspaces = Object.create(null), customerRoots = new Set();
  for (const [alias, value] of Object.entries(raw.workspaces)) {
    identifier(alias, 'Laboratory workspace alias');
    exact(value, ['label', 'directory', 'merchant', 'origin', 'functionId', 'runtimeDirectory',
      'operatorProfile', 'operatorWorkspace', 'transport', 'intakeTokenEnv', 'approvalMode',
      'buyerRoots', 'fileRoots', 'temporaryDirectory', 'requestTimeoutMs', 'transferTimeoutMs', 'checkoutTimeoutMs',
      'maxConcurrent', 'inputFileStorage'],
    ['directory', 'merchant', 'origin', 'runtimeDirectory']);
    const merchant = identifier(value.merchant, 'Original paid merchant alias');
    const originalMerchant = paidJobWorkspaces.workspaces[merchant];
    if (!originalMerchant) fail('Select an already configured original paid-job merchant.');
    const customerDirectory = await directory(value.directory, base, true);
    if (customerRoots.has(customerDirectory) || customerDirectory === originalMerchant.directory)
      fail('Give each customer workspace one alias and its own original buyer directory.');
    customerRoots.add(customerDirectory);
    const origin = originOf(value.origin);
    if (origin !== value.origin) fail('Select the exact original public merchant origin.');
    const functionId = value.functionId ?? 'laboratoryReview';
    if (!/^[A-Za-z][A-Za-z0-9_]{0,55}$/.test(functionId)) fail('Select the original laboratory function identifier.');
    if (value.operatorProfile !== undefined && value.operatorWorkspace !== undefined)
      fail('Select one original operator profile or operator workspace.');
    const checkout = { runtimeDirectory: await directory(value.runtimeDirectory, base),
      timeoutMs: integer(value.checkoutTimeoutMs, 360000, 1000, 3600000, 'checkout deadline') };
    if (value.operatorProfile !== undefined) {
      checkout.operatorProfile = wqxHostPath(value.operatorProfile, base);
      await wqxReadPrivate(checkout.operatorProfile, 1024 * 1024);
    }
    if (value.operatorWorkspace !== undefined) checkout.operatorWorkspace = await directory(value.operatorWorkspace, base, true);
    const transport = value.transport === undefined ? undefined : normalizeBuyerTransport(value.transport);
    if (transport && transport.origin !== origin) fail('Keep the configured original resolving proxy bound to this exact merchant origin.');
    const approvalMode = value.approvalMode ?? 'terminal';
    if (!['terminal', 'operator'].includes(approvalMode)) fail('Choose the original terminal or explicit operator approval mode.');
    const inputFileStorage = value.inputFileStorage === undefined ? undefined : storageLimits(value.inputFileStorage);
    workspaces[alias] = {
      label: line(value.label ?? alias, 'Laboratory desk name'), directory: customerDirectory, merchant, origin, functionId,
      checkout, approvalMode,
      requestTimeoutMs: integer(value.requestTimeoutMs, 60000, 1000, 300000, 'request deadline'),
      transferTimeoutMs: integer(value.transferTimeoutMs, 3600000, 1000, 3600000, 'input transfer deadline'),
      maxConcurrent: integer(value.maxConcurrent, 2, 1, 4, 'customer concurrency'),
      ...(transport ? { transport } : {}),
      ...(value.intakeTokenEnv === undefined ? {} : { intakeTokenEnv: variable(value.intakeTokenEnv, 'intake token') }),
      ...(value.buyerRoots === undefined ? {} : { buyerRoots: await roots(value.buyerRoots, base) }),
      ...(value.fileRoots === undefined ? {} : { fileRoots: await roots(value.fileRoots, base) }),
      ...(value.temporaryDirectory === undefined ? {} : { temporaryDirectory: await directory(value.temporaryDirectory, base, true) }),
      ...(inputFileStorage ? { inputFileStorage } : {}),
    };
  }
  return { schema: LAB_WORKSPACE_CONNECTION_SCHEMA, connectionFile: path, workspaces };
}
