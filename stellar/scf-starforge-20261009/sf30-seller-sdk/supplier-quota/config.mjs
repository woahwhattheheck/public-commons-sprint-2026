// MIT. Shared supplier-account declarations for the original SF30 upstreams.
import { isAbsolute, resolve } from 'node:path';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const name = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value) &&
  !['__proto__', 'prototype', 'constructor'].includes(value);
const fields = new Set(['directory', 'account', 'apiKeyEnv', 'requestsPerSecond', 'callsPerDay']);
const fail = message => { throw new TypeError(message); };

/** Pure configuration. No file, credential, provider or quota operation. */
export function compileSupplierAccounts(value, bindings) {
  if (!plain(bindings)) fail('Supplier accounts require the original upstream binding map');
  if (value === undefined) value = {};
  if (!plain(value) || Object.keys(value).length > 64) fail('supplierAccounts must be an account map with at most 64 entries');
  const accounts = Object.create(null), directories = new Set(), identities = new Set();
  for (const [id, raw] of Object.entries(value)) {
    if (!name(id) || !plain(raw) || Object.keys(raw).some(key => !fields.has(key))) fail('Invalid supplier account declaration');
    if (typeof raw.directory !== 'string' || !isAbsolute(raw.directory) || resolve(raw.directory) !== raw.directory ||
        raw.directory === '/' || raw.directory.includes('\0')) fail('Supplier quota directory must be a canonical absolute private path');
    if (typeof raw.account !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(raw.account)) fail('Supplier account requires a stable account label');
    if (raw.apiKeyEnv !== undefined && (typeof raw.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(raw.apiKeyEnv)))
      fail('Supplier apiKeyEnv must name an environment variable');
    if (!Number.isSafeInteger(raw.requestsPerSecond) || raw.requestsPerSecond < 1 || raw.requestsPerSecond > 1000 ||
        !Number.isSafeInteger(raw.callsPerDay) || raw.callsPerDay < 1 || raw.callsPerDay > 100000000)
      fail('Supplier limits require requestsPerSecond 1..1000 and callsPerDay 1..100000000');
    const identity = JSON.stringify([raw.account, raw.apiKeyEnv ?? null]);
    if (directories.has(raw.directory) || identities.has(identity)) fail('Each supplier account and quota directory must have one alias');
    directories.add(raw.directory); identities.add(identity);
    accounts[id] = { name: id, directory: raw.directory,
      provider: Object.freeze({ account: raw.account, ...(raw.apiKeyEnv === undefined ? {} : { apiKeyEnv: raw.apiKeyEnv }) }),
      policy: Object.freeze({ requestsPerSecond: raw.requestsPerSecond, callsPerDay: raw.callsPerDay }), bindings: [] };
  }
  for (const [bindingName, binding] of Object.entries(bindings)) {
    if (!plain(binding)) fail('Invalid upstream binding');
    if (!Object.hasOwn(binding, 'supplierAccount')) continue;
    if (!name(binding.supplierAccount) || !Object.hasOwn(accounts, binding.supplierAccount))
      fail('Upstream supplierAccount must select a declared supplier account');
    accounts[binding.supplierAccount].bindings.push(bindingName);
  }
  for (const account of Object.values(accounts)) {
    if (!account.bindings.length) fail('Unused supplier account; assign its original upstream binding');
    Object.freeze(account.bindings); Object.freeze(account);
  }
  return Object.freeze(accounts);
}
