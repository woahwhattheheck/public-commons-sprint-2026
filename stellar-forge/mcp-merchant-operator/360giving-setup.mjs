// MIT. Reopenable host setup for existing saved publisher consoles and complete file handles.
import { mkdir, lstat, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { exact, line, privateSupportDirectory, writePrivate } from './host-files.mjs';
import { encode, failure } from './360giving-contract.mjs';
import { read360GivingWorkspaceConfiguration } from './360giving-workspace.mjs';
import { open } from 'node:fs/promises';

async function existing(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
}
async function privateBytes(path) {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 65536 || (stat.mode & 0o077)) throw failure('CONFIGURATION', 'Retain the original private setup record.');
    const bytes = await handle.readFile(); if (bytes.length > 65536) throw failure('CONFIGURATION', 'The original setup record grew.');
    return bytes;
  } finally { await handle.close(); }
}
async function retain(path, bytes) {
  if (await existing(path)) {
    if (!(await privateBytes(path)).equals(bytes)) throw failure('CONFIGURATION_CHANGED', 'This directory belongs to a different merchant setup.');
  } else await writePrivate(path, bytes);
}
export async function initialize360GivingPublisherMerchant(options = {}) {
  exact(options, ['directory','connection','name','releaseStore'], ['directory','connection']);
  for (const value of [options.directory, options.connection, ...(options.releaseStore === undefined ? [] : [options.releaseStore])])
    if (typeof value !== 'string' || !value || value.includes('\0')) throw failure('CONFIGURATION', 'Choose original host directory and connection references.');
  const root = resolve(options.directory), connection = resolve(options.connection);
  const name = line(options.name ?? 'Starforge 360Giving publisher', 'Merchant name');
  const configured = await read360GivingWorkspaceConfiguration(connection);
  const releases = options.releaseStore === undefined ? join(root, 'releases') : resolve(options.releaseStore);
  const intentPath = join(root, '360giving-setup.json'), configuration = join(root, 'merchant-mcp.json');
  const intent = encode({ schema: 'stellar-forge.360giving-merchant-setup.v1', directory: root, connection, name,
    releaseStore: releases, ownsReleaseStore: options.releaseStore === undefined });
  if (!await existing(root)) await mkdir(root, { mode: 0o700 });
  await privateSupportDirectory(root);
  if (!await existing(intentPath) && (await readdir(root)).length)
    throw failure('CONFIGURATION', 'Choose an empty directory or the original saved publisher merchant setup.');
  await retain(intentPath, intent);
  const native = await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs');
  if (await existing(releases) || options.releaseStore !== undefined) await native.readReleaseState(releases);
  else await native.initReleaseStore(releases);
  const exportsDirectory = join(root, 'customer-exports');
  if (!await existing(exportsDirectory)) await mkdir(exportsDirectory, { mode: 0o700 });
  await privateSupportDirectory(exportsDirectory);
  await retain(configuration, encode({ schema: 'stellar-forge.merchant-mcp.v1', name, releaseStore: releases,
    exportsDirectory: './customer-exports', sources: {}, publisher360GivingConnection: connection }));
  await (await import('./config.mjs')).readMerchantConfig(configuration);
  return { schema: 'stellar-forge.merchant-mcp.v1', state: 'INITIALIZED', configuration,
    publisher360GivingConfigured: true, ownership: 'EXISTING_SAVED_PUBLISHER_CONSOLES',
    workspaces: Object.entries(configured.workspaces).map(([workspace, value]) => ({ workspace, label: value.label })) };
}
