// MIT. Original POST policy and private local state for an API merchant package.
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { operationTicketReference } from '../../sf88-operator-buyer-cli/operation-ticket.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const variable = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The original upstream compiler remains the validator for every policy limit. */
export function merchantOperationPolicy(value, { method, id }) {
  if (value === undefined) return undefined;
  if (!plain(value) || method !== 'POST') throw new TypeError('Durable operations require a POST route and an explicit operation policy');
  if (!variable.test(value.keyEnv ?? '')) throw new TypeError('Operation key must name an environment variable');
  // The paired original buyer validates its header contract without reading a
  // file or accepting a bearer during merchant configuration.
  operationTicketReference({method:'POST',ticketFile:resolve('/merchant-ticket-shape-only.json'),
    ticketHeader:value.requestHeader ?? 'x-merchant-operation'});
  return { ...structuredClone(value), admission: value.admission ?? '__sf30Operation_' + id };
}

/** Validate references during packaging without reading or generating merchant keys. */
export function merchantValidationEnvironment(upstreams, environmentNames) {
  const environment = Object.fromEntries([...environmentNames].map(name => [name, 'SET_IN_LAUNCH_ENVIRONMENT']));
  for (const binding of Object.values(upstreams.bindings)) {
    const name = binding.idempotency?.keyEnv;
    if (name === undefined) continue;
    if (!variable.test(name)) throw new TypeError('Operation key must name an environment variable');
    environmentNames.add(name);
    environment[name] = '0'.repeat(64); // Shape-only compiler input, never saved or launched.
  }
  return environment;
}

/** Public operator metadata contains references and limits, never the HMAC key. */
export function merchantOperationSummary(raw, compiled) {
  if (!compiled.idempotency) return null;
  const { scope, stateDir, admission, requestHeader, backendHeader, maxEntries,
    maxStoredBytes, maxTicketSeconds, waitMs } = compiled.idempotency;
  return { scope, stateDir, admission, keyEnv: raw.idempotency.keyEnv, requestHeader,
    backendHeader, maxEntries, maxStoredBytes, maxTicketSeconds, waitMs };
}

async function privateDirectory(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory)
    throw new TypeError('Operation state directory must be an absolute canonical path');
  // Walk explicitly: recursive mkdir could traverse an existing symlink before
  // the original ledger later rejects it. Existing directory modes stay intact.
  let current = parse(directory).root;
  for (const part of directory.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    try { await mkdir(current, { mode: 0o700 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(current) !== current)
      throw new TypeError('Operation state requires directories without symbolic links');
  }
  const info = await lstat(directory);
  if ((info.mode & 0o077) !== 0) throw new TypeError('Existing operation state directory must be private (mode 0700)');
  return directory;
}

/** Create declared local state before the original seller accepts work. */
export async function prepareMerchantOperationDirectories(upstreams) {
  const directories = new Set(Object.values(upstreams.bindings).flatMap(binding =>
    binding.idempotency ? [binding.idempotency.stateDir] : []));
  const ready = [];
  for (const directory of directories) ready.push(await privateDirectory(directory));
  return ready;
}

export async function merchantTicketDirectory(project) {
  // A verified original package owns this private, create-only output directory.
  const directory = join(project.folder, 'operation-tickets');
  if (dirname(directory) !== project.folder) throw new TypeError('Original package directory required');
  return privateDirectory(directory);
}
