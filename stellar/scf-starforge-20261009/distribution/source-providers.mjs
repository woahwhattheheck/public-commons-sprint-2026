// MIT. Read registered provider modules from the same original distribution source.
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
function ensure(value, code, message) {
  if (!value) throw Object.assign(new TypeError(message), { code });
}
function safePath(value) {
  return typeof value === 'string' && value.endsWith('.mjs') && !value.startsWith('/') &&
    !/[\u0000-\u0020\u007f\\?#%:]/.test(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..');
}
function unchanged(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}
/** No source is evaluated by the package builder; this is a runtime metadata read. */
export async function readRegisteredSourceModules(distribution, field) {
  ensure(['merchantProviders', 'applicationProviders'].includes(field), 'SOURCE_PROVIDER_FIELD_INVALID',
    'Select an original distribution provider registration field.');
  const declarations = Object.entries(distribution.spec[field] ?? {}), paths = new Set();
  const root = await realpath(distribution.sourceRoot), loaded = [];
  for (const [id, path] of declarations) {
    ensure(idPattern.test(id) && safePath(path), 'SOURCE_PROVIDER_DECLARATION_INVALID',
      'Invalid ' + field + ' source declaration: ' + id);
    ensure(!paths.has(path), 'SOURCE_PROVIDER_DUPLICATE', 'One original module has multiple ' + field + ' IDs: ' + path);
    paths.add(path);
  }
  const retained = distribution.manifest ? new Map(distribution.manifest.files.map(entry => [entry.path, entry])) : null;
  for (const [id, path] of declarations) {
    const filename = await realpath(resolve(root, path)), inside = relative(root, filename);
    ensure(inside && !isAbsolute(inside) && inside !== '..' && !inside.startsWith('../') && !inside.startsWith('..\\'),
      'SOURCE_PROVIDER_OUTSIDE', 'Provider leaves the selected original source: ' + path);
    const before = await stat(filename);
    ensure(before.isFile() && before.size <= 4 * 1024 * 1024, 'SOURCE_PROVIDER_INVALID',
      'Provider must be an original regular module up to 4 MiB: ' + path);
    const bytes = await readFile(filename), after = await stat(filename);
    ensure(bytes.length === before.size && bytes.length <= 4 * 1024 * 1024 && unchanged(before, after),
      'SOURCE_PROVIDER_CHANGED', 'Provider changed during original source reading: ' + path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (retained) {
      const expected = retained.get(path);
      ensure(expected && expected.bytes === bytes.length && expected.sha256 === sha256, 'SOURCE_PROVIDER_CHANGED',
        'Installed provider differs from its original distribution manifest: ' + path);
    }
    const url = pathToFileURL(filename);
    url.searchParams.set('providerSource', sha256);
    let module;
    try { module = await import(url.href); }
    catch (cause) {
      throw Object.assign(new Error('Cannot load original provider ' + id + ' from ' + path + ': ' + cause.message,
        { cause }), { code: 'SOURCE_PROVIDER_LOAD_FAILED' });
    }
    ensure(unchanged(after, await stat(filename)), 'SOURCE_PROVIDER_CHANGED',
      'Provider changed while loading original metadata: ' + path);
    loaded.push({ id, module, source: Object.freeze({ id, path, bytes: bytes.length, sha256,
      contributions: Object.freeze([...(distribution.origins[field]?.[id] ?? [])]) }) });
  }
  return loaded;
}
