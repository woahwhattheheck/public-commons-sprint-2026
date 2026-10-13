// MIT. One static asset contract for the maintained HTTP server and source archive.
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';

const ORIGIN = 'https://starforge.invalid';
const SCHEMA = 'stellar-forge.browser-assets.v1';

function relativeFile(value, label) {
  if (typeof value !== 'string' || !value || value.startsWith('/') ||
      /[\u0000-\u0020\u007f\\?#%:]/.test(value))
    throw new TypeError('Invalid browser asset ' + label);
  return value;
}

function repositoryFile(value, label) {
  relativeFile(value, label);
  if (posix.normalize(value) !== value || value === '..' || value.startsWith('../'))
    throw new TypeError('Browser asset leaves its repository: ' + label);
  return value;
}

export function parseBrowserAssets(input) {
  const spec = JSON.parse(input);
  if (!spec || spec.schema !== SCHEMA || !Array.isArray(spec.routes) || !spec.routes.length)
    throw new TypeError('Unsupported browser asset manifest');
  relativeFile(spec.root, 'root');
  if (!spec.root.endsWith('/')) throw new TypeError('Browser asset root must be a directory');
  const paths = new Set();
  const routes = spec.routes.map(entry => {
    if (!Array.isArray(entry) || entry.length !== 2 || !Array.isArray(entry[1]) || entry[1].length !== 2)
      throw new TypeError('Browser asset route must contain a path, file and content type');
    const [path, [file, type]] = entry;
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') ||
        /[\u0000-\u0020\u007f\\?#%]/.test(path) ||
        new URL(path, ORIGIN).pathname !== path || paths.has(path))
      throw new TypeError('Invalid or duplicate browser asset route: ' + path);
    relativeFile(file, 'file');
    if (file.endsWith('/') || typeof type !== 'string' || !type || /[\r\n\u0000]/.test(type))
      throw new TypeError('Invalid browser asset file or content type: ' + path);
    paths.add(path);
    return [path, { file, type }];
  });
  return { root: spec.root, routes };
}

export async function readBrowserAssets(manifestUrl) {
  const url = new URL(manifestUrl);
  if (url.protocol !== 'file:' || url.search || url.hash)
    throw new TypeError('Browser assets require a local manifest URL');
  const spec = parseBrowserAssets(await readFile(url, 'utf8'));
  const root = new URL(spec.root, url);
  return new Map(spec.routes.map(([path, { file, type }]) =>
    [path, { url: new URL(file, root), type }]));
}

// Browser declarations can live in a contribution whose commands were not
// selected. Read only this declared dependency when its original server enters
// the source closure; never enable the donor's other product registrations.
export function browserAssetDeclarations({ base, contributions = [] }) {
  const candidates = new Map();
  const add = (source, entries, owner) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          typeof entry.server !== 'string') continue;
      const rows = candidates.get(entry.server) ?? [];
      rows.push({ source, entry, owner }); candidates.set(entry.server, rows);
    }
  };
  add('stellar/scf-starforge-20261009/distribution/distribution.json',
    base?.browserAssets, base);
  for (const { path, data } of contributions) add(path, data?.browserAssets, data);
  return {
    forServer(server) {
      const rows = candidates.get(server) ?? [];
      let manifest;
      for (const row of rows) {
        if (!row.owner || !['stellar-forge.merchant-distribution.v1',
          'stellar-forge.merchant-distribution-contribution.v1'].includes(row.owner.schema))
          throw new TypeError('Invalid browser declaration owner: ' + row.source);
        const entry = row.entry;
        if (Object.keys(entry).some(key => !['server', 'manifest'].includes(key)))
          throw new TypeError('Invalid browser asset registration: ' + row.source);
        repositoryFile(entry.server, 'server');
        repositoryFile(entry.manifest, 'manifest');
        if (manifest !== undefined && manifest !== entry.manifest)
          throw new TypeError('Conflicting browser asset declarations for ' + server);
        manifest = entry.manifest;
      }
      return rows.map(({ source, entry }) => ({ source, ...entry }));
    },
    servers: [...candidates.keys()],
  };
}

// readSource returns original bytes from one immutable source snapshot. Adding
// a registration may add a NEW served context to an already loaded file. The
// caller must revisit its requests when revision changes; file identity alone
// does not exhaust the browser graph.
export function createBrowserAssetIndex(registrations, readSource) {
  if (!Array.isArray(registrations) || typeof readSource !== 'function')
    throw new TypeError('Browser assets require registrations and a source reader');
  const servers = new Map(), files = new Set(), contexts = new Map();
  let revision = 0;
  function register(registration) {
    if (!registration || typeof registration !== 'object' || Array.isArray(registration))
      throw new TypeError('Invalid browser asset registration');
    const server = repositoryFile(registration.server, 'server');
    const manifest = repositoryFile(registration.manifest, 'manifest');
    if (servers.has(server)) {
      if (servers.get(server) !== manifest) throw new TypeError('Conflicting browser asset server: ' + server);
      return false;
    }
    readSource(server);
    const spec = parseBrowserAssets(readSource(manifest));
    const routes = new Map(spec.routes.map(([path, { file }]) =>
      [path, repositoryFile(posix.join(posix.dirname(manifest), spec.root, file), manifest + ' -> ' + file)]));
    for (const [route, file] of routes) {
      files.add(file);
      const entries = contexts.get(file) ?? [];
      entries.push({ server, manifest, route, routes });
      contexts.set(file, entries);
    }
    servers.set(server, manifest); revision++;
    return true;
  }
  for (const registration of registrations) {
    if (!register(registration)) throw new TypeError('Duplicate browser asset server: ' + registration.server);
  }
  return {
    register,
    get revision() { return revision; },
    get files() { return [...files]; },
    hasContext(path) { return contexts.has(path); },
    resolve(importer, request) {
      const entries = contexts.get(importer);
      if (!entries || !request.startsWith('.') && !request.startsWith('/')) return null;
      const targets = new Set();
      for (const { server, manifest, route, routes } of entries) {
        const url = new URL(request, new URL(route, ORIGIN));
        const target = url.origin === ORIGIN && !url.search ? routes.get(url.pathname) : undefined;
        if (!target)
          throw new TypeError('Unserved browser module: ' + importer + ' -> ' + request +
            ' at ' + route + ' (' + server + '; ' + manifest + ')');
        targets.add(target);
      }
      return [...targets];
    },
  };
}
