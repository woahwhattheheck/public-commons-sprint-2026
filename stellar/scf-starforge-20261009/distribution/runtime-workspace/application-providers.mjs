// MIT. Discover original Applications adapters from the maintained source contributions.
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readDistributionSpecification } from '../specification.mjs';
import { APPLICATION_PROVIDER_SCHEMA, applicationCommonFields, applicationField } from './application-provider.mjs';

const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
function fail(code, message) { throw Object.assign(new TypeError(message), { code, status: 400 }); }
function ensure(value, code, message) { if (!value) fail(code, message); }
const hookNames = ['catalog', 'prepare', 'matchRequest', 'createObserver',
  'validateSettings', 'checkRuntime', 'resourceKey', 'verifyLaunch', 'prepareChild'];

function validateProvider(value, id, path) {
  ensure(plain(value) && value.schema === APPLICATION_PROVIDER_SCHEMA && value.id === id,
    'APPLICATION_PROVIDER_INVALID', 'Expected the ' + id + ' Applications provider from ' + path);
  ensure(Object.keys(value).every(key =>
    ['schema', 'id', 'order', 'appendPort', 'completeCommand', ...hookNames].includes(key)),
  'APPLICATION_PROVIDER_FIELD_UNKNOWN', 'Unknown Applications provider field in ' + path);
  for (const key of hookNames) {
    const required = ['catalog', 'prepare', 'matchRequest', 'createObserver'].includes(key);
    ensure(typeof value[key] === 'function' || !required && value[key] === undefined,
      'APPLICATION_PROVIDER_HOOK_INVALID', 'Expected ' + id + '.' + key + ' to be a function.');
  }
  ensure(value.order === undefined || Number.isSafeInteger(value.order) && value.order >= 0 && value.order <= 1000000,
    'APPLICATION_PROVIDER_ORDER_INVALID', 'Invalid catalog order in ' + path);
  for (const key of ['appendPort', 'completeCommand'])
    ensure(value[key] === undefined || typeof value[key] === 'boolean',
      'APPLICATION_PROVIDER_FIELD_INVALID', 'Expected a boolean ' + id + '.' + key);
  return value;
}
function validateCatalog(entries, provider, kinds) {
  ensure(Array.isArray(entries) && entries.length > 0 && entries.length <= 256,
    'APPLICATION_PROVIDER_CATALOG_INVALID', 'Provider ' + provider.id + ' must return its original catalog entries.');
  return entries.map(entry => {
    ensure(plain(entry) && idPattern.test(entry.id ?? '') && typeof entry.command === 'string' && entry.command &&
      typeof entry.title === 'string' && entry.title && typeof entry.description === 'string' &&
      typeof entry.terminal === 'boolean' && Array.isArray(entry.fields),
    'APPLICATION_PROVIDER_CATALOG_INVALID', 'Invalid original application in ' + provider.id);
    ensure(!kinds.has(entry.id), 'APPLICATION_PROVIDER_KIND_DUPLICATE',
      'Application ' + entry.id + ' is declared by both ' + (kinds.get(entry.id)?.id ?? 'unknown') + ' and ' + provider.id);
    const names = new Set();
    for (const field of entry.fields) {
      ensure(plain(field) && typeof field.name === 'string' && field.name &&
        typeof field.label === 'string' && ['path', 'text', 'json', 'boolean', 'port'].includes(field.type) &&
        typeof field.required === 'boolean' && !names.has(field.name),
      'APPLICATION_PROVIDER_FIELD_INVALID', 'Invalid or duplicate field in ' + provider.id + '/' + entry.id);
      names.add(field.name);
    }
    const retained = Object.freeze(copy(entry)); kinds.set(entry.id, provider);
    return retained;
  });
}
async function originalProvider(distribution, id, path) {
  const root = distribution.sourceRoot, filename = await realpath(resolve(root, path));
  const inside = relative(root, filename);
  ensure(inside && !isAbsolute(inside) && inside !== '..' && !inside.startsWith('../') && !inside.startsWith('..\\'),
    'APPLICATION_PROVIDER_SOURCE_OUTSIDE', 'Applications provider leaves the selected source: ' + path);
  const first = await stat(filename);
  ensure(first.isFile() && first.size <= 4 * 1024 * 1024,
    'APPLICATION_PROVIDER_SOURCE_INVALID', 'Applications provider must be an original file up to 4 MiB: ' + path);
  const bytes = await readFile(filename), after = await stat(filename);
  ensure(bytes.length === first.size && bytes.length <= 4 * 1024 * 1024 &&
    first.dev === after.dev && first.ino === after.ino && first.size === after.size &&
    first.mtimeMs === after.mtimeMs && first.ctimeMs === after.ctimeMs,
  'APPLICATION_PROVIDER_SOURCE_CHANGED', 'Applications provider changed during source reading: ' + path);
  const sha256 = digest(bytes);
  if (distribution.manifest) {
    const expected = distribution.manifest.files.find(entry => entry.path === path);
    ensure(expected && expected.bytes === bytes.length && expected.sha256 === sha256,
      'APPLICATION_PROVIDER_SOURCE_CHANGED', 'Installed Applications provider differs from its original manifest: ' + path);
  }
  const url = pathToFileURL(filename);
  url.searchParams.set('applicationSource', sha256);
  let module;
  try { module = await import(url.href); }
  catch (error) {
    throw Object.assign(new Error('Cannot load Applications provider ' + id + ' from ' + path + ': ' + error.message,
      { cause: error }), { code: 'APPLICATION_PROVIDER_LOAD_FAILED' });
  }
  return { provider: validateProvider(module.default, id, path), source: {
    id, path, bytes: bytes.length, sha256,
    contributions: [...(distribution.origins.applicationProviders?.[id] ?? [])],
  } };
}

/** The same explicit declarations and original paths work in a checkout and a READY archive. */
export async function readApplicationProviders(options = {}) {
  const distribution = await readDistributionSpecification(options);
  const declarations = Object.entries(distribution.spec.applicationProviders ?? {});
  ensure(declarations.length > 0, 'APPLICATION_PROVIDERS_MISSING',
    'This source has no Applications provider declarations. Select its complete maintained distribution.');
  const paths = new Set();
  for (const [id, path] of declarations) {
    ensure(idPattern.test(id), 'APPLICATION_PROVIDER_ID_INVALID', 'Invalid Applications provider ID: ' + id);
    ensure(!paths.has(path), 'APPLICATION_PROVIDER_SOURCE_DUPLICATE',
      'One Applications module is registered with multiple provider IDs: ' + path);
    paths.add(path);
  }
  const loaded = [];
  // Keep original module loading ordered and observable; declarations do not execute at package-build time.
  for (const [id, path] of declarations) loaded.push(await originalProvider(distribution, id, path));
  loaded.sort((a, b) => (a.provider.order ?? 1000) - (b.provider.order ?? 1000) ||
    a.provider.id.localeCompare(b.provider.id));
  const kinds = new Map(), catalog = [];
  for (const { provider } of loaded) {
    const entries = await provider.catalog({ common: copy(applicationCommonFields), field: applicationField });
    catalog.push(...validateCatalog(entries, provider, kinds));
  }
  const sources = Object.freeze(loaded.map(({ source, provider }) => Object.freeze({
    ...source, order: provider.order ?? 1000,
    kinds: catalog.filter(entry => kinds.get(entry.id) === provider).map(entry => entry.id),
  })));
  return Object.freeze({
    schema: 'stellar-forge.runtime-application-providers.v1',
    sourceRoot: distribution.sourceRoot,
    sourceCommit: distribution.manifest?.sourceCommit ?? null,
    catalog: Object.freeze(catalog), sources,
    forKind(kind) {
      const provider = kinds.get(kind);
      ensure(provider, 'APPLICATION_PROVIDER_KIND_UNKNOWN', 'Unknown original application kind: ' + kind);
      return provider;
    },
    forRequest(request) {
      ensure(plain(request), 'APPLICATION_PROVIDER_REQUEST_INVALID', 'Expected the original managed application request.');
      if (!request.applicationId) return null;
      const matches = loaded.map(entry => entry.provider).filter(provider => provider.matchRequest(request) === true);
      ensure(matches.length > 0, 'APPLICATION_PROVIDER_COMMAND_UNKNOWN',
        'No original Applications provider accepts managed command ' + request.command);
      ensure(matches.length === 1, 'APPLICATION_PROVIDER_COMMAND_AMBIGUOUS',
        'Managed command ' + request.command + ' matches Applications providers: ' + matches.map(value => value.id).join(', '));
      return matches[0];
    },
  });
}
let installed;
export function defaultApplicationProviders() {
  return installed ??= readApplicationProviders();
}
