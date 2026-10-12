// MIT. Select and inspect the original installed merchant runtime declarations.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ownRoot = fileURLToPath(new URL('../../../', import.meta.url));
const specPath = 'stellar/scf-starforge-20261009/distribution/distribution.json';
const profileSchema = 'stellar-forge.runtime-profile.v1';
const packageName = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const featureName = /^[a-z][a-z0-9-]{0,63}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(Array.isArray(value) ? value.map(sortObject) : sortObject(value));
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortObject(value[key])]));
}
const json = value => JSON.stringify(value, null, 2) + '\n';
function relativePath(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\') ||
      value.split('/').some(part => !part || part === '.' || part === '..'))
    throw new TypeError('Expected an original relative source path');
  return value;
}
function version(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
    throw new TypeError('Expected an exact stable dependency version: ' + String(value));
  const numbers = value.split('.').map(Number);
  if (!numbers.every(Number.isSafeInteger)) throw new TypeError('Dependency version is too large');
  return numbers;
}
function compare(a, b) {
  const left = version(a), right = version(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
}
function requirement(value) {
  if (typeof value !== 'string') throw new TypeError('Dependency requirement must be a string');
  const prefix = ['^', '~'].includes(value[0]) ? value[0] : '';
  const baseline = prefix ? value.slice(1) : value;
  version(baseline);
  return { prefix, baseline };
}
function satisfies(selected, requested) {
  const { prefix, baseline } = requirement(requested);
  const target = version(selected), base = version(baseline);
  if (compare(selected, baseline) < 0) return false;
  if (!prefix) return selected === baseline;
  if (prefix === '~') return target[0] === base[0] && target[1] === base[1];
  if (base[0]) return target[0] === base[0];
  if (base[1]) return target[0] === 0 && target[1] === base[1];
  return selected === baseline;
}
async function sourceFile(root, path) {
  relativePath(path);
  const filename = resolve(root, path);
  const size = (await stat(filename)).size;
  if (size > 1024 * 1024) throw new RangeError('Runtime declaration exceeds 1 MiB: ' + path);
  const bytes = await readFile(filename);
  return { data: JSON.parse(bytes.toString('utf8')), descriptor: { path, bytes: bytes.length, sha256: sha256(bytes) } };
}
function nativeKind(name, probe, value) {
  if (value === undefined) return null;
  if (value !== 'sqlite' || name !== 'better-sqlite3' || probe !== name)
    throw new TypeError('Unsupported native runtime preparation: ' + name);
  return value;
}
function dependencies(definitions, group, sourcePath) {
  if (!plain(definitions) || !Object.keys(definitions).length)
    throw new TypeError('Runtime dependencies missing for ' + group);
  return Object.entries(definitions).map(([name, definition]) => {
    if (!packageName.test(name)) throw new TypeError('Invalid dependency name: ' + name);
    const value = typeof definition === 'string' ? { version: definition, probe: name } : definition;
    if (!plain(value) || typeof value.probe !== 'string' ||
        !(value.probe === name || value.probe.startsWith(name + '/')) ||
        value.probe.split('/').some(part => part === '..' || part === '.'))
      throw new TypeError('Invalid original import probe: ' + name);
    requirement(value.version);
    const native = nativeKind(name, value.probe, value.native);
    return { name, requested: value.version, probe: value.probe, group, sourcePath,
      ...(native ? { native } : {}) };
  });
}

/** Read feature declarations from the selected archive's source directory. */
export async function runtimeCatalog({ sourceRoot = ownRoot } = {}) {
  const root = await realpath(sourceRoot);
  const original = await sourceFile(root, specPath), spec = original.data;
  if (spec.schema !== 'stellar-forge.merchant-distribution.v1' || !packageName.test(spec.name))
    throw new TypeError('Unsupported merchant distribution');
  const inputFiles = [original.descriptor];
  const groups = { native: dependencies(spec.nativePeers, 'native', specPath) };
  const featurePeers = { ...spec.featurePeers };
  const engines = {};
  for (const [group, path] of Object.entries(spec.runtimePackageManifests ?? {})) {
    if (!featureName.test(group) || group === 'native') throw new TypeError('Invalid runtime feature: ' + group);
    const file = await sourceFile(root, path);
    inputFiles.push(file.descriptor);
    if (!plain(file.data.dependencies)) throw new TypeError('Runtime dependencies missing: ' + path);
    featurePeers[group] = Object.fromEntries(Object.entries(file.data.dependencies).map(([name, requested]) =>
      [name, { version: requested, probe: spec.featurePeers?.[group]?.[name]?.probe ?? name,
        ...(spec.featurePeers?.[group]?.[name]?.native !== undefined ?
          { native: spec.featurePeers[group][name].native } : {}) }]));
    engines[group] = file.data.engines?.node ?? null;
  }
  for (const [group, definitions] of Object.entries(featurePeers)) {
    if (!featureName.test(group) || group === 'native') throw new TypeError('Invalid runtime feature: ' + group);
    groups[group] = dependencies(definitions, group, spec.runtimePackageManifests?.[group] ?? specPath);
  }
  let manifest = null;
  try {
    const candidate = JSON.parse(await readFile(resolve(root, '../manifest.json'), 'utf8'));
    if (candidate.schema === 'stellar-forge.merchant-distribution-manifest.v1' && candidate.packageName === spec.name)
      manifest = candidate;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (manifest) {
    if (!/^[0-9a-f]{40}$/.test(manifest.sourceCommit ?? '') || !Array.isArray(manifest.files))
      throw new TypeError('Installed distribution manifest is invalid');
    const records = new Map(manifest.files.map(entry => [entry.path, entry]));
    for (const input of inputFiles) {
      const expected = records.get(input.path);
      if (!expected || expected.sha256 !== input.sha256 || expected.bytes !== input.bytes)
        throw new TypeError('Installed runtime declaration changed: ' + input.path);
    }
  }
  return { schema: 'stellar-forge.runtime-catalog.v1', sourceRoot: root,
    source: { packageName: spec.name, packageVersion: manifest?.packageVersion ?? 'source-checkout',
      sourceCommit: manifest?.sourceCommit ?? null, inputFiles: inputFiles.sort((a, b) => a.path.localeCompare(b.path)) },
    groups, engines };
}
function runtimePackage(deps, node) {
  return { name: '@tokenjunkielabs/starforge-runtime', version: '0.0.0', private: true,
    type: 'module', engines: { node },
    dependencies: Object.fromEntries(deps.map(dep => [dep.name, dep.version])),
    ...(deps.some(dep => dep.native) ?
      { allowScripts: Object.fromEntries(deps.filter(dep => dep.native).map(dep => [dep.name, true])) } : {}) };
}
function profileBody(profile) {
  return Object.fromEntries(Object.entries(profile).filter(([key]) => key !== 'profileId'));
}

/** Resolve exact versions without a registry query, dependency install, or application run. */
export async function resolveRuntimeProfile({ sourceRoot = ownRoot, native = false, features = [], pins = {}, operator = false } = {}) {
  if (typeof native !== 'boolean' || typeof operator !== 'boolean' || !Array.isArray(features) ||
      features.some(name => typeof name !== 'string') || !plain(pins))
    throw new TypeError('Expected native/operator booleans, feature names and exact version pins');
  const catalog = await runtimeCatalog({ sourceRoot });
  const selectedFeatures = [...new Set(features)].sort();
  for (const name of selectedFeatures) if (name === 'native' || !Object.hasOwn(catalog.groups, name))
    throw new TypeError('Unknown runtime feature: ' + name + '. Available: ' + Object.keys(catalog.groups).filter(x => x !== 'native').sort().join(', '));
  const groups = [...(native ? ['native'] : []), ...selectedFeatures];
  const byName = new Map();
  for (const group of groups) for (const dependency of catalog.groups[group]) {
    if (!byName.has(dependency.name)) byName.set(dependency.name, []);
    byName.get(dependency.name).push(dependency);
  }
  for (const name of Object.keys(pins)) {
    if (!byName.has(name)) throw new TypeError('Version pin does not belong to a selected feature: ' + name);
    version(pins[name]);
  }
  const resolved = [...byName].sort(([a], [b]) => a.localeCompare(b)).map(([name, declarations]) => {
    const baselines = declarations.map(item => requirement(item.requested).baseline).sort(compare);
    const chosen = pins[name] ?? baselines.at(-1);
    if (!declarations.every(item => satisfies(chosen, item.requested)))
      throw new TypeError('No selected exact version satisfies the original declarations for ' + name);
    return { name, version: chosen, selection: Object.hasOwn(pins, name) ? 'EXPLICIT_PIN' :
      declarations.every(item => item.requested === chosen) ? 'SOURCE_PIN' : 'DECLARED_BASELINE',
      requested: [...new Set(declarations.map(item => item.requested))].sort(),
      groups: [...new Set(declarations.map(item => item.group))].sort(),
      probes: declarations.map(({ group, sourcePath, probe }) => ({ group, sourcePath, probe })),
      ...(declarations.some(item => item.native) ? { native: declarations.find(item => item.native).native } : {}) };
  });
  let nodeMinimum = '22.16.0';
  for (const group of groups) {
    const engine = catalog.engines[group];
    if (!engine) continue;
    const match = /^>=(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(engine);
    if (!match) throw new TypeError('Unsupported original Node engine requirement for ' + group + ': ' + engine);
    const minimum = match[1] + '.' + (match[2] ?? '0') + '.' + (match[3] ?? '0');
    if (compare(minimum, nodeMinimum) > 0) nodeMinimum = minimum;
  }
  const host = { node: '>=' + nodeMinimum, python: operator ? '>=3.11' : null,
    platform: operator ? 'linux' : null, commands: operator ? ['flock'] : [] };
  const body = { schema: profileSchema, source: catalog.source,
    selection: { native, features: selectedFeatures, operator, pins: Object.fromEntries(Object.entries(pins).sort(([a], [b]) => a.localeCompare(b))) },
    dependencies: resolved, host, packageJson: runtimePackage(resolved, host.node) };
  return { ...body, profileId: sha256(stable(body)) };
}

/** Verify the profile's complete content and generated package contract before use. */
export function verifyRuntimeProfile(profile) {
  if (!plain(profile) || profile.schema !== profileSchema || !/^[0-9a-f]{64}$/.test(profile.profileId ?? '') ||
      sha256(stable(profileBody(profile))) !== profile.profileId)
    throw new TypeError('Runtime profile identity does not match its content');
  if (!plain(profile.source) || !packageName.test(profile.source.packageName ?? '') || !Array.isArray(profile.source.inputFiles) ||
      !plain(profile.selection) || !Array.isArray(profile.selection.features) || !Array.isArray(profile.dependencies) || !plain(profile.host))
    throw new TypeError('Runtime profile structure is invalid');
  const selection = profile.selection;
  if (Object.keys(selection).some(key => !['native', 'features', 'operator', 'pins'].includes(key)) ||
      typeof selection.native !== 'boolean' || typeof selection.operator !== 'boolean' || !plain(selection.pins) ||
      selection.features.some(name => !featureName.test(name) || name === 'native') ||
      new Set(selection.features).size !== selection.features.length ||
      !/^>=\d+\.\d+\.\d+$/.test(profile.host.node ?? '') ||
      compare(profile.host.node.slice(2), '22.16.0') < 0 ||
      profile.host.python !== (selection.operator ? '>=3.11' : null) ||
      profile.host.platform !== (selection.operator ? 'linux' : null) ||
      stable(profile.host.commands) !== stable(selection.operator ? ['flock'] : []))
    throw new TypeError('Runtime selection or host requirements are invalid');
  const selectedGroups = new Set([...(selection.native ? ['native'] : []), ...selection.features]);
  const seen = new Set();
  for (const file of profile.source.inputFiles) {
    relativePath(file.path);
    if (seen.has(file.path) || !/^[0-9a-f]{64}$/.test(file.sha256 ?? '') || !Number.isSafeInteger(file.bytes) || file.bytes < 0)
      throw new TypeError('Invalid runtime source declaration record');
    seen.add(file.path);
  }
  if (!seen.has(specPath)) throw new TypeError('Runtime profile omits the original distribution declaration');
  const names = new Set();
  for (const dependency of profile.dependencies) {
    if (!packageName.test(dependency.name ?? '') || names.has(dependency.name) ||
        !Array.isArray(dependency.requested) || !dependency.requested.length ||
        !dependency.requested.every(value => satisfies(dependency.version, value)) ||
        !Array.isArray(dependency.probes) || !dependency.probes.length ||
        !Array.isArray(dependency.groups) || !dependency.groups.length ||
        dependency.groups.some(group => !selectedGroups.has(group)))
      throw new TypeError('Invalid runtime dependency record');
    version(dependency.version);
    if (dependency.native !== undefined) {
      for (const probe of dependency.probes) nativeKind(dependency.name, probe.probe, dependency.native);
    }
    names.add(dependency.name);
    for (const probe of dependency.probes) if (!seen.has(probe.sourcePath) || !dependency.groups.includes(probe.group) ||
        !(probe.probe === dependency.name || probe.probe.startsWith(dependency.name + '/')) ||
        probe.probe.split('/').some(part => part === '.' || part === '..'))
      throw new TypeError('Invalid runtime dependency resolution source');
  }
  for (const [name, pin] of Object.entries(selection.pins)) {
    version(pin);
    if (!names.has(name) || profile.dependencies.find(dep => dep.name === name).version !== pin)
      throw new TypeError('Runtime version pin differs from the selected dependency');
  }
  if (stable(profile.packageJson) !== stable(runtimePackage(profile.dependencies, profile.host.node)))
    throw new TypeError('Runtime package.json differs from its selected exact dependencies');
  return profile;
}

/** Match a saved profile to the actual source in the selected installed package. */
export async function verifyRuntimeSource(profile, { sourceRoot = ownRoot } = {}) {
  verifyRuntimeProfile(profile);
  const current = await resolveRuntimeProfile({ sourceRoot, ...profile.selection });
  if (current.profileId !== profile.profileId)
    throw new TypeError('Runtime profile belongs to different installed source or feature declarations');
  return { state: 'MATCHED', profileId: profile.profileId, sourceCommit: profile.source.sourceCommit,
    sourceRoot: await realpath(sourceRoot) };
}

/** Save an immutable profile in a new directory; an identical save reopens it. */
export async function createRuntimeProfile({ directory, profile, ...selection } = {}) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('A profile directory is required');
  const resolved = profile ? verifyRuntimeProfile(profile) : await resolveRuntimeProfile(selection);
  const destination = resolve(directory);
  const files = { 'profile.json': json(resolved), 'package.json': json(resolved.packageJson) };
  let created = false;
  try { await mkdir(destination, { mode: 0o700 }); created = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!created) {
    if (!(await stat(destination)).isDirectory()) throw new TypeError('Profile destination must be a directory');
    for (const [name, content] of Object.entries(files)) {
      try {
        if (await readFile(join(destination, name), 'utf8') !== content)
          throw new TypeError('Existing runtime profile file differs: ' + join(destination, name));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  for (const [name, content] of Object.entries(files)) {
    const filename = join(destination, name);
    try { await writeFile(filename, content, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await readFile(filename, 'utf8') !== content)
        throw new TypeError('Existing runtime profile file differs: ' + filename);
    }
  }
  return { state: created ? 'CREATED' : 'REOPENED', directory: destination,
    profileId: resolved.profileId, profile: resolved };
}

async function installedVersion(resolveModule, name, entry) {
  let direct;
  try { direct = resolveModule(name + '/package.json'); } catch {}
  if (direct) {
    const data = JSON.parse(await readFile(direct, 'utf8'));
    if (data.name === name && typeof data.version === 'string') return { version: data.version, packageFile: await realpath(direct) };
  }
  let parent = dirname(await realpath(entry));
  for (let depth = 0; depth < 32; depth++) {
    const filename = join(parent, 'package.json');
    try {
      const data = JSON.parse(await readFile(filename, 'utf8'));
      if (data.name === name && typeof data.version === 'string') return { version: data.version, packageFile: filename };
    } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
    const next = dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  throw new TypeError('Resolved dependency has no matching package identity: ' + name);
}
async function loadEntries(entries) {
  if (!entries.length) return new Map();
  const program = `const entries = JSON.parse(process.argv[1]);
const results = [];
for (const entry of entries) {
  let result;
  try {
    const loaded = await import(entry.url);
    result = { key: entry.key, state: 'LOADED' };
    if (entry.native === 'sqlite') {
      let database;
      try {
        database = new loaded.default(':memory:');
        database.exec('CREATE TABLE runtime_readiness (value TEXT NOT NULL)');
        const row = database.transaction(() => {
          database.prepare('INSERT INTO runtime_readiness (value) VALUES (?)').run('native-ready');
          return database.prepare('SELECT value FROM runtime_readiness').get();
        })();
        if (row?.value !== 'native-ready') throw new Error('SQLITE_NATIVE_RESULT_MISMATCH');
        const sqliteVersion = database.prepare('SELECT sqlite_version() AS version').get().version;
        database.close();
        database = null;
        result.native = { state: 'READY', kind: 'sqlite', sqliteVersion,
          node: process.versions.node, modules: process.versions.modules,
          platform: process.platform, arch: process.arch };
      } catch (error) {
        result.native = { state: 'NATIVE_FAILED', kind: 'sqlite', code: error.code ?? error.name };
      } finally {
        if (database) try { database.close(); } catch {}
      }
    }
  } catch (error) {
    result = { key: entry.key, state: 'LOAD_FAILED', code: error.code ?? error.name };
  }
  results.push(result);
}
process.stdout.write('\\nSTARFORGE_RUNTIME_LOAD=' + JSON.stringify(results) + '\\n');`;
  try {
    const result = await exec(process.execPath, ['--input-type=module', '--eval', program, JSON.stringify(entries)],
      { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true });
    const line = result.stdout.split('\n').findLast(value => value.startsWith('STARFORGE_RUNTIME_LOAD='));
    if (!line) throw new TypeError('Import child returned no runtime result');
    return new Map(JSON.parse(line.slice('STARFORGE_RUNTIME_LOAD='.length)).map(value => [value.key, value]));
  } catch (error) {
    return new Map(entries.map(entry => [entry.key, { state: 'LOAD_FAILED', code: error.code ?? error.name }]));
  }
}
function hostStatus(requirements, python) {
  const result = { node: { requested: requirements.node, actual: process.versions.node,
    ready: compare(process.versions.node, requirements.node.slice(2)) >= 0 },
    platform: { requested: requirements.platform, actual: process.platform,
      ready: requirements.platform === null || process.platform === requirements.platform }, python: null, commands: [] };
  if (requirements.python) {
    const response = spawnSync(python, ['--version'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    const actual = /Python (\d+)\.(\d+)\.(\d+)/.exec((response.stdout ?? '') + (response.stderr ?? ''));
    result.python = { executable: python, requested: requirements.python,
      actual: actual ? actual.slice(1).join('.') : null,
      ready: response.status === 0 && Boolean(actual) && (Number(actual[1]) > 3 || Number(actual[1]) === 3 && Number(actual[2]) >= 11) };
  }
  for (const command of requirements.commands) {
    if (command !== 'flock') throw new TypeError('Unsupported original host command: ' + command);
    const response = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    result.commands.push({ name: command, ready: response.status === 0 });
  }
  result.ready = result.node.ready && result.platform.ready && (!result.python || result.python.ready) && result.commands.every(command => command.ready);
  return result;
}

/** Resolve versions from the application's directory and original adapter locations. */
export async function inspectRuntimeProfile(profile, { directory, sourceRoot, load = false, python = 'python3' } = {}) {
  verifyRuntimeProfile(profile);
  if (typeof directory !== 'string' || !directory || typeof load !== 'boolean')
    throw new TypeError('Expected installation directory and optional load boolean');
  const installation = await realpath(directory);
  let root = sourceRoot ? await realpath(sourceRoot) : null;
  if (!root) {
    for (const candidate of [join(installation, 'source'), join(installation, 'node_modules', profile.source.packageName, 'source')]) {
      try { await stat(join(candidate, specPath)); root = await realpath(candidate); break; }
      catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
    }
  }
  const source = root ? await verifyRuntimeSource(profile, { sourceRoot: root }) : { state: 'DEPENDENCIES_ONLY', sourceRoot: null };
  const findings = [], entries = [];
  for (const dependency of profile.dependencies) {
    const checks = [];
    for (const probe of dependency.probes) {
      const base = root ? resolve(root, probe.sourcePath) : join(installation, 'package.json');
      const resolver = createRequire(base).resolve;
      const key = dependency.name + ':' + probe.group;
      try {
        const entry = resolver(probe.probe);
        const identity = await installedVersion(resolver, dependency.name, entry);
        const check = { group: probe.group, probe: probe.probe, resolutionBase: base, entry,
          ...identity, state: identity.version === dependency.version ? 'MATCHED' : 'VERSION_MISMATCH' };
        checks.push(check);
        if ((load || dependency.native) && check.state === 'MATCHED')
          entries.push({ key, url: pathToFileURL(entry).href, ...(dependency.native ? { native: dependency.native } : {}) });
      } catch (error) {
        checks.push({ group: probe.group, probe: probe.probe, resolutionBase: base,
          state: ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code) ? 'MISSING' : 'INSPECTION_FAILED',
          code: error.code ?? error.name });
      }
    }
    findings.push({ name: dependency.name, expectedVersion: dependency.version, requested: dependency.requested,
      ready: checks.every(check => check.state === 'MATCHED'), checks,
      ...(dependency.native ? { native: dependency.native } : {}) });
  }
  // Declared native readiness always operates the binding. Ordinary package
  // imports remain optional; importing better-sqlite3 alone cannot load its ABI.
  const imports = await loadEntries(entries);
  for (const finding of findings) for (const check of finding.checks) {
    if (check.state !== 'MATCHED') continue;
    const result = imports.get(finding.name + ':' + check.group);
    check.importState = load || finding.native ? result?.state ?? 'LOAD_FAILED' : 'NOT_REQUESTED';
    if (result?.code) check.importCode = result.code;
    if ((load || finding.native) && check.importState !== 'LOADED') finding.ready = false;
    if (finding.native) {
      check.native = result?.native ?? { state: 'UNAVAILABLE', kind: finding.native };
      if (check.native.state !== 'READY') finding.ready = false;
    }
  }
  const host = hostStatus(profile.host, python);
  const ready = host.ready && findings.every(finding => finding.ready);
  return { schema: 'stellar-forge.runtime-inspection.v1', profileId: profile.profileId,
    state: ready ? 'READY' : 'INCOMPLETE', directory: installation, source,
    loadRequested: load, nativeRequired: profile.dependencies.some(dependency => dependency.native),
    dependencies: findings, host, ready };
}
