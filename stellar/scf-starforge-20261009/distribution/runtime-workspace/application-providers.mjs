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
  'validateSettings', 'checkRuntime', 'resourceKey', 'verifyLaunch', 'prepareChild', 'runArguments'];

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
async function originalProvider(distribution, id, path, expected = null) {
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
  if (expected) ensure(expected.id === id && expected.path === path &&
    expected.bytes === bytes.length && expected.sha256 === sha256,
    'APPLICATION_PROVIDER_SOURCE_CHANGED', 'The reviewed Applications provider source changed: ' + id);
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

export const APPLICATION_PROVIDER_BINDING_SCHEMA = 'stellar-forge.runtime-application-provider-binding.v1';

/** A retained request binds the selected adapter before any provider module executes. */
export function validateApplicationProviderBinding(value) {
  ensure(plain(value) && value.schema === APPLICATION_PROVIDER_BINDING_SCHEMA &&
    Object.keys(value).length === 7 &&
    ['schema', 'id', 'kind', 'path', 'bytes', 'sha256', 'command'].every(key => Object.hasOwn(value, key)) &&
    idPattern.test(value.id ?? '') && idPattern.test(value.kind ?? '') &&
    typeof value.path === 'string' && value.path.endsWith('.mjs') &&
    !value.path.includes('\\') && !isAbsolute(value.path) &&
    value.path.split('/').every(part => part && part !== '.' && part !== '..') &&
    Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= 4 * 1024 * 1024 &&
    /^[a-f0-9]{64}$/.test(value.sha256 ?? '') &&
    typeof value.command === 'string' && value.command.length > 0 && value.command.length <= 200,
  'APPLICATION_PROVIDER_BINDING_INVALID', 'Expected the retained application kind, command and original provider source.');
  return value;
}
function bindingFor(source, entry) {
  return Object.freeze({ schema: APPLICATION_PROVIDER_BINDING_SCHEMA,
    id: source.id, kind: entry.id, command: entry.command,
    path: source.path, bytes: source.bytes, sha256: source.sha256 });
}
async function declarationsFor(options) {
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
  return { distribution, declarations };
}
function missingSource(error) {
  const seen = new Set();
  while (error && !seen.has(error)) {
    seen.add(error);
    if (['ENOENT', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) return true;
    error = error.cause;
  }
  return false;
}
const unavailableView = (id, path, distribution, error) => Object.freeze({
  id, path, contributions: [...(distribution.origins.applicationProviders?.[id] ?? [])],
  available: false, error: { code: error.code ?? 'APPLICATION_PROVIDER_LOAD_FAILED',
    message: String(error.message ?? error).slice(0, 2000) },
});

/** Load the one source-bound adapter selected by the original application review. */
export async function readApplicationProvider({ id, kind, expected = null, ...options } = {}) {
  ensure(idPattern.test(id ?? '') && idPattern.test(kind ?? ''),
    'APPLICATION_PROVIDER_SELECTION_INVALID', 'Expected the selected provider and application kind.');
  if (expected) {
    validateApplicationProviderBinding(expected);
    ensure(expected.id === id && expected.kind === kind, 'APPLICATION_PROVIDER_SELECTION_CHANGED',
      'The retained application kind belongs to a different provider.');
  }
  const { distribution, declarations } = await declarationsFor(options);
  const declaration = declarations.find(entry => entry[0] === id);
  ensure(declaration, 'APPLICATION_PROVIDER_ID_UNKNOWN', 'Provider ' + id + ' is not declared in this source.');
  const { provider, source } = await originalProvider(distribution, id, declaration[1], expected);
  const kinds = new Map();
  const catalog = validateCatalog(await provider.catalog({
    common: copy(applicationCommonFields), field: applicationField,
  }), provider, kinds);
  const entry = catalog.find(value => value.id === kind);
  ensure(entry, 'APPLICATION_PROVIDER_KIND_UNKNOWN', 'Provider ' + id + ' does not declare application ' + kind);
  const binding = bindingFor(source, entry);
  if (expected) ensure(JSON.stringify(binding) === JSON.stringify({
    schema: expected.schema, id: expected.id, kind: expected.kind, command: expected.command,
    path: expected.path, bytes: expected.bytes, sha256: expected.sha256,
  }), 'APPLICATION_PROVIDER_BINDING_CHANGED', 'The retained provider command or source changed.');
  return Object.freeze({ provider, entry, binding,
    source: Object.freeze({ ...source, order: provider.order ?? 1000, kinds: catalog.map(value => value.id) }),
    sourceRoot: distribution.sourceRoot, sourceCommit: distribution.manifest?.sourceCommit ?? null });
}

/**
 * Complete catalog discovery remains available for callers that ask for it.
 * The operator overview can retain usable providers alongside an unavailable source.
 */
export async function readApplicationProviders({ allowUnavailable = false, ...options } = {}) {
  ensure(typeof allowUnavailable === 'boolean', 'APPLICATION_PROVIDER_OPTION_INVALID',
    'allowUnavailable must be a boolean.');
  const { distribution, declarations } = await declarationsFor(options);
  const loaded = [], unavailable = [];
  for (const [id, path] of declarations) {
    try { loaded.push(await originalProvider(distribution, id, path)); }
    catch (error) {
      if (!allowUnavailable || !missingSource(error)) throw error;
      unavailable.push(unavailableView(id, path, distribution, error));
    }
  }
  loaded.sort((a, b) => (a.provider.order ?? 1000) - (b.provider.order ?? 1000) ||
    a.provider.id.localeCompare(b.provider.id));
  let kinds = new Map();
  const catalog = [], available = [];
  for (const selected of loaded) {
    const { provider, source } = selected, nextKinds = new Map(kinds);
    try {
      const entries = validateCatalog(await provider.catalog({
        common: copy(applicationCommonFields), field: applicationField,
      }), provider, nextKinds);
      catalog.push(...entries); kinds = nextKinds; available.push(selected);
    } catch (error) {
      if (!allowUnavailable || !missingSource(error)) throw error;
      unavailable.push(unavailableView(provider.id, source.path, distribution, error));
    }
  }
  const sources = Object.freeze(available.map(({ source, provider }) => Object.freeze({
    ...source, order: provider.order ?? 1000,
    kinds: catalog.filter(entry => kinds.get(entry.id) === provider).map(entry => entry.id),
  })));
  return Object.freeze({
    schema: 'stellar-forge.runtime-application-providers.v1',
    sourceRoot: distribution.sourceRoot,
    sourceCommit: distribution.manifest?.sourceCommit ?? null,
    catalog: Object.freeze(catalog), sources, unavailable: Object.freeze(unavailable),
    forKind(kind) {
      const provider = kinds.get(kind);
      ensure(provider, 'APPLICATION_PROVIDER_KIND_UNKNOWN', 'Unknown original application kind: ' + kind);
      return provider;
    },
    bindingForKind(kind) {
      const provider = this.forKind(kind);
      return bindingFor(sources.find(value => value.id === provider.id), catalog.find(value => value.id === kind));
    },
    forRequest(request) {
      ensure(plain(request), 'APPLICATION_PROVIDER_REQUEST_INVALID', 'Expected the original managed application request.');
      if (!request.applicationId) return null;
      const matches = available.map(entry => entry.provider).filter(provider => provider.matchRequest(request) === true);
      ensure(matches.length > 0, 'APPLICATION_PROVIDER_COMMAND_UNKNOWN',
        'No original Applications provider accepts managed command ' + request.command);
      ensure(matches.length === 1, 'APPLICATION_PROVIDER_COMMAND_AMBIGUOUS',
        'Managed command ' + request.command + ' matches Applications providers: ' + matches.map(value => value.id).join(', '));
      return matches[0];
    },
  });
}
let installed, availableInstalled;
export function defaultApplicationProviders({ allowUnavailable = false } = {}) {
  if (allowUnavailable) return availableInstalled ??= readApplicationProviders({ allowUnavailable: true }).catch(error => {
    availableInstalled = undefined; throw error;
  });
  return installed ??= readApplicationProviders().catch(error => { installed = undefined; throw error; });
}

/** Older saved applications retain their kind; their original revision selects the adapter. */
export async function applicationProviderForKind(kind, { id = null, expected = null } = {}) {
  if (expected) {
    validateApplicationProviderBinding(expected);
    ensure(expected.kind === kind && (!id || expected.id === id), 'APPLICATION_PROVIDER_SELECTION_CHANGED',
      'The retained provider selection differs from the original application.');
    return readApplicationProvider({ id: expected.id, kind, expected });
  }
  if (id) return readApplicationProvider({ id, kind });
  const catalog = await defaultApplicationProviders({ allowUnavailable: true });
  const provider = catalog.forKind(kind);
  return readApplicationProvider({ id: provider.id, kind });
}
