// MIT. Compose source-owned merchant registrations for checkout and pinned builds.
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const distributionPath = 'stellar/scf-starforge-20261009/distribution/distribution.json';
export const contributionDirectory = 'stellar/scf-starforge-20261009/distribution/contributions';
export const contributionSchema = 'stellar-forge.merchant-distribution-contribution.v1';
const ownRoot = fileURLToPath(new URL('../../../', import.meta.url));
const baseSchema = 'stellar-forge.merchant-distribution.v1';
const fields = ['components', 'supportFiles', 'excludeFiles', 'commands', 'commandDescriptions',
  'exports', 'nativePeers', 'featurePeers', 'runtimePackageManifests', 'browserAssets'];
const lists = ['components', 'supportFiles', 'excludeFiles'];
const maps = ['commands', 'commandDescriptions', 'exports', 'nativePeers', 'runtimePackageManifests'];
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const packagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const reservedCommands = new Set(['init', 'run', 'doctor', 'source', 'help', 'registrations']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash('sha256').update(value).digest('hex');
const put = (object, key, value) => Object.defineProperty(object, key,
  { value, enumerable: true, writable: true, configurable: true });
const record = () => Object.create(null);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function filePath(value, label) {
  if (typeof value !== 'string' || !value || value.startsWith('/') ||
      /[\u0000-\u0020\u007f\\?#%:]/.test(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..'))
    throw new TypeError('Invalid original source path for ' + label);
  return value;
}
function text(value, label, maximum = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum ||
      /[\u0000-\u001f\u007f]/.test(value))
    throw new TypeError('Expected a single-line ' + label);
}
function commandName(value) {
  if (!idPattern.test(value) || reservedCommands.has(value))
    throw new TypeError('Invalid or reserved merchant command: ' + value);
}
function featureName(value) {
  if (!idPattern.test(value) || value === 'native')
    throw new TypeError('Invalid runtime feature: ' + value);
}
function exportTarget(value, label, depth = 0) {
  if (depth > 8) throw new TypeError('Export condition nesting exceeds eight levels: ' + label);
  if (typeof value === 'string') {
    if (['./package.json', './manifest.json'].includes(value)) return;
    if (!value.startsWith('./source/')) throw new TypeError('Export must select original packaged source: ' + label);
    filePath(value.slice(9), label);
    if (value.includes('*')) throw new TypeError('Exports require explicit original files: ' + label);
    return;
  }
  if (!plain(value) || !Object.keys(value).length)
    throw new TypeError('Expected a source export or conditional export: ' + label);
  for (const [condition, target] of Object.entries(value)) {
    if (!condition || condition.startsWith('.') || /^\d+$/.test(condition))
      throw new TypeError('Invalid export condition: ' + label);
    exportTarget(target, label, depth + 1);
  }
}
function peer(name, value) {
  if (!packagePattern.test(name) || !plain(value) ||
      Object.keys(value).some(key => !['version', 'probe', 'native'].includes(key)) ||
      typeof value.version !== 'string' || !/^[~^]?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value.version) ||
      typeof value.probe !== 'string' ||
      !(value.probe === name || value.probe.startsWith(name + '/')) ||
      value.probe.split('/').some(part => !part || part === '.' || part === '..'))
    throw new TypeError('Invalid runtime dependency declaration: ' + name);
  if (value.native !== undefined && !(name === 'better-sqlite3' && value.probe === name && value.native === 'sqlite'))
    throw new TypeError('Unsupported original native runtime preparation: ' + name);
}
function validateRegistrations(data, owner) {
  for (const field of lists) {
    if (data[field] === undefined) continue;
    if (!Array.isArray(data[field])) throw new TypeError(owner + ': ' + field + ' must be a source path array');
    for (const value of data[field]) filePath(value, field);
  }
  for (const field of maps) {
    if (data[field] === undefined) continue;
    if (!plain(data[field])) throw new TypeError(owner + ': ' + field + ' must be an object');
    for (const [key, value] of Object.entries(data[field])) {
      if (field === 'commands') {
        commandName(key); filePath(value, key);
        if (!value.endsWith('.mjs')) throw new TypeError('Commands must select an original Node .mjs entry: ' + key);
      } else if (field === 'commandDescriptions') {
        commandName(key); text(value, 'command description', 256);
        if (!Object.hasOwn(data.commands ?? {}, key))
          throw new TypeError('A command description must accompany its command: ' + key);
      } else if (field === 'exports') {
        if (key !== '.' && (!key.startsWith('./') || !key.slice(2))) throw new TypeError('Invalid package export: ' + key);
        if (key !== '.') filePath(key.slice(2), key);
        exportTarget(value, key);
      } else if (field === 'nativePeers') peer(key, value);
      else {
        featureName(key); filePath(value, key);
        if (!value.endsWith('.json')) throw new TypeError('Runtime feature must select its original JSON package manifest: ' + key);
      }
    }
  }
  if (data.featurePeers !== undefined) {
    if (!plain(data.featurePeers)) throw new TypeError(owner + ': featurePeers must be an object');
    for (const [group, peers] of Object.entries(data.featurePeers)) {
      featureName(group);
      if (!plain(peers) || !Object.keys(peers).length) throw new TypeError('Runtime feature has no dependencies: ' + group);
      for (const [name, value] of Object.entries(peers)) peer(name, value);
    }
  }
  if (data.browserAssets !== undefined) {
    if (!Array.isArray(data.browserAssets)) throw new TypeError(owner + ': browserAssets must be an array');
    const servers = new Set();
    for (const value of data.browserAssets) {
      if (!plain(value) || Object.keys(value).some(key => !['server', 'manifest'].includes(key)))
        throw new TypeError('Browser registration requires its original server and manifest');
      filePath(value.server, 'browser server'); filePath(value.manifest, 'browser manifest');
      if (servers.has(value.server)) throw new TypeError('Duplicate browser server in ' + owner + ': ' + value.server);
      servers.add(value.server);
    }
  }
}

/** Both Git tree and filesystem discovery use the same flat, ordered inventory. */
export function contributionPaths(paths) {
  const prefix = contributionDirectory + '/', result = [];
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length);
    if (name.includes('/')) continue;
    if (!/\.json$/i.test(name)) continue;
    if (!/^[a-z][a-z0-9-]{0,63}\.json$/.test(name))
      throw new TypeError('Invalid distribution contribution filename: ' + name);
    result.push(path);
  }
  if (new Set(result).size !== result.length) throw new TypeError('Duplicate distribution contribution source');
  return result.sort();
}
function count(data) {
  return Object.fromEntries(fields.map(field => [field, field === 'featurePeers' ?
    Object.values(data[field] ?? {}).reduce((n, entries) => n + Object.keys(entries).length, 0) :
    Array.isArray(data[field]) ? data[field].length : Object.keys(data[field] ?? {}).length]));
}

/** Compose declarations without reading a working tree or evaluating source code. */
export function composeDistribution({ base, contributions = [] }) {
  if (!plain(base) || base.schema !== baseSchema || !packagePattern.test(base.name ?? '') ||
      !Array.isArray(base.components) || !Array.isArray(base.supportFiles) ||
      !plain(base.commands) || !plain(base.exports) || !plain(base.nativePeers) || !Array.isArray(contributions))
    throw new TypeError('Unsupported merchant distribution specification');
  validateRegistrations(base, distributionPath);
  const spec = copy(base), origins = Object.fromEntries(fields.map(field => [field, record()]));
  const sources = [{ id: 'base', path: distributionPath, description: 'Maintained base registrations',
    registrations: Object.fromEntries(fields.filter(field => base[field] !== undefined).map(field => [field, copy(base[field])])),
    counts: count(base) }];
  function own(field, key, owner, name) {
    let target = origins[field];
    if (name !== undefined) {
      if (!Object.hasOwn(target, key)) put(target, key, record());
      target = target[key]; key = name;
    }
    if (!Object.hasOwn(target, key)) put(target, key, []);
    if (!target[key].includes(owner)) target[key].push(owner);
  }
  function mergeMap(field, entries, owner, group) {
    let target = spec[field] ?? (spec[field] = record());
    if (group !== undefined) {
      if (!Object.hasOwn(target, group)) put(target, group, record());
      target = target[group];
    }
    for (const [key, value] of Object.entries(entries ?? {})) {
      if (Object.hasOwn(target, key) && !same(target[key], value)) {
        const previous = group === undefined ? origins[field][key] : origins[field][group]?.[key];
        const error = new TypeError('Conflicting ' + field + ' registration ' + (group === undefined ? key : group + '/' + key) +
          ' in ' + (previous ?? [distributionPath]).join(', ') + ' and ' + owner);
        error.code = 'DISTRIBUTION_REGISTRATION_CONFLICT'; throw error;
      }
      if (!Object.hasOwn(target, key)) put(target, key, copy(value));
      own(field, group ?? key, owner, group === undefined ? undefined : key);
    }
  }
  for (const field of lists) for (const value of spec[field] ?? []) own(field, value, distributionPath);
  for (const field of maps) for (const key of Object.keys(spec[field] ?? {})) own(field, key, distributionPath);
  for (const [group, peers] of Object.entries(spec.featurePeers ?? {}))
    for (const name of Object.keys(peers)) own('featurePeers', group, distributionPath, name);
  for (const entry of spec.browserAssets ?? []) own('browserAssets', entry.server, distributionPath);
  const paths = contributionPaths(contributions.map(entry => entry.path));
  if (paths.length !== contributions.length) throw new TypeError('Expected original contribution JSON paths');
  const byPath = new Map(contributions.map(entry => [entry.path, entry.data]));
  for (const path of paths) {
    const data = byPath.get(path), id = path.slice(contributionDirectory.length + 1, -5);
    if (!plain(data) || data.schema !== contributionSchema || data.id !== id || id === 'base' ||
        Object.keys(data).some(key => !['schema', 'id', 'description', ...fields].includes(key)))
      throw new TypeError('Unsupported distribution contribution: ' + path);
    text(data.description, 'contribution description');
    validateRegistrations(data, path);
    if (!Object.values(count(data)).some(Boolean)) throw new TypeError('Empty distribution contribution: ' + path);
    for (const field of lists) {
      if (data[field] === undefined) continue;
      const target = spec[field] ?? (spec[field] = []);
      for (const value of data[field]) {
        if (!target.includes(value)) target.push(value);
        own(field, value, path);
      }
    }
    for (const field of maps) if (data[field] !== undefined) mergeMap(field, data[field], path);
    for (const [group, peers] of Object.entries(data.featurePeers ?? {})) mergeMap('featurePeers', peers, path, group);
    if (data.browserAssets !== undefined) {
      const target = spec.browserAssets ?? (spec.browserAssets = []);
      for (const entry of data.browserAssets) {
        const previous = target.find(value => value.server === entry.server);
        if (previous && !same(previous, entry)) {
          const error = new TypeError('Conflicting browserAssets registration ' + entry.server + ' in ' +
            origins.browserAssets[entry.server].join(', ') + ' and ' + path);
          error.code = 'DISTRIBUTION_REGISTRATION_CONFLICT'; throw error;
        }
        if (!previous) target.push(copy(entry));
        own('browserAssets', entry.server, path);
      }
    }
    sources.push({ id, path, description: data.description, counts: count(data),
      registrations: Object.fromEntries(fields.filter(field => data[field] !== undefined).map(field => [field, copy(data[field])])) });
  }
  return { spec, origins, sources, contributions: sources.slice(1).map(({ registrations, ...entry }) => entry) };
}

/** Inspect the combined command or its source-owned registration file. */
export function inspectDistributionRegistrations(distribution, { source, command } = {}) {
  if (source !== undefined && command !== undefined) throw new TypeError('Select one --source ID or --command NAME');
  const { spec, sources, origins } = distribution;
  const header = { schema: 'stellar-forge.merchant-registrations.v1', packageName: spec.name,
    sourceCommit: distribution.manifest?.sourceCommit ?? null };
  if (command !== undefined) {
    if (!Object.hasOwn(spec.commands, command)) throw new TypeError('Unknown merchant command: ' + command);
    return { ...header, command, entry: spec.commands[command], description: spec.commandDescriptions?.[command] ?? null,
      sources: sources.filter(entry => origins.commands[command].includes(entry.path)).map(({ id, path }) => ({ id, path })) };
  }
  if (source !== undefined) {
    const selected = sources.find(entry => entry.id === source);
    if (!selected) throw new TypeError('Unknown registration source: ' + source);
    return { ...header, ...copy(selected) };
  }
  return { ...header, counts: count(spec), sources: sources.map(({ registrations, ...entry }) => entry) };
}
export function contributedCommandHelp(distribution) {
  return distribution.contributions.flatMap(source => {
    const commands = Object.keys(distribution.spec.commands).filter(name =>
      distribution.origins.commands[name][0] === source.path);
    return commands.length ? ['\n' + source.description + ' [' + source.id + ']:',
      ...commands.map(name => '  ' + name.padEnd(42) +
        (distribution.spec.commandDescriptions?.[name] ?? 'Run the original ' + name + ' command'))] : [];
  }).join('\n');
}

async function originalJson(root, path) {
  filePath(path, 'distribution declaration');
  const filename = await realpath(resolve(root, path));
  const inside = relative(root, filename);
  if (!inside || isAbsolute(inside) || inside === '..' || inside.startsWith('../') || inside.startsWith('..\\'))
    throw new TypeError('Distribution declaration leaves the selected source: ' + path);
  const info = await stat(filename);
  if (!info.isFile() || info.size > 1024 * 1024) throw new TypeError('Distribution declaration must be a regular file up to 1 MiB: ' + path);
  const bytes = await readFile(filename);
  if (bytes.length > 1024 * 1024) throw new TypeError('Distribution declaration exceeds 1 MiB: ' + path);
  return { data: JSON.parse(bytes.toString('utf8')), descriptor: { path, bytes: bytes.length, sha256: digest(bytes) } };
}

/** Load the same declarations from a source checkout or original installed archive. */
export async function readDistributionSpecification({ sourceRoot = ownRoot } = {}) {
  const root = await realpath(sourceRoot), original = await originalJson(root, distributionPath);
  let names = [];
  try {
    names = (await readdir(resolve(root, contributionDirectory), { withFileTypes: true }))
      .map(entry => contributionDirectory + '/' + entry.name + (entry.isDirectory() ? '/' : ''));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const paths = contributionPaths(names), inputFiles = [original.descriptor], contributions = [];
  for (const path of paths) {
    const file = await originalJson(root, path);
    inputFiles.push(file.descriptor); contributions.push({ path, data: file.data });
  }
  const distribution = composeDistribution({ base: original.data, contributions });
  let manifest = null;
  try {
    const candidate = JSON.parse(await readFile(resolve(root, '../manifest.json'), 'utf8'));
    if (candidate.schema === 'stellar-forge.merchant-distribution-manifest.v1' && candidate.packageName === distribution.spec.name)
      manifest = candidate;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (manifest) {
    if (!/^[0-9a-f]{40}$/.test(manifest.sourceCommit ?? '') || !Array.isArray(manifest.files))
      throw new TypeError('Installed distribution manifest is invalid');
    const entries = new Map(manifest.files.map(entry => [entry.path, entry]));
    const expected = [distributionPath, ...contributionPaths([...entries.keys()])];
    if (!same(inputFiles.map(entry => entry.path), expected))
      throw new TypeError('Installed distribution contribution inventory changed');
    for (const input of inputFiles) {
      const retained = entries.get(input.path);
      if (!retained || retained.bytes !== input.bytes || retained.sha256 !== input.sha256)
        throw new TypeError('Installed distribution declaration changed: ' + input.path);
    }
  }
  return { ...distribution, sourceRoot: root, inputFiles, manifest };
}
