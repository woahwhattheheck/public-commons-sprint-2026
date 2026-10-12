#!/usr/bin/env node
// MIT. Package one immutable Git snapshot without bundling or rewriting native source.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openGitSource } from './git-source.mjs';
import { createBrowserAssetIndex } from './browser-assets.mjs';
import { readDistributionBuildPin, recoverCompletedDistribution, openDistributionBuild,
  inspectDistributionBuild } from './build-state.mjs';

export { inspectDistributionBuild };

const ownPath = 'stellar/scf-starforge-20261009/distribution';
const json = value => JSON.stringify(value, null, 2) + '\n';
const digest = data => createHash('sha256').update(data).digest('hex');
const supported = /\.(?:mjs|js|cjs|ts|mts|py|php|go|rs|json|toml|md|html|css|txt|sql|csv|xml|svg|png|woff2|service)$/i;
const excludedName = /(?:^test[_.-]|[.]test[.]|[.]spec[.]|(?:^|[-_])acceptance(?:[-_.]|$)|(?:^|[-_])focused[-_]?check[.]|_check[.])/i;
const excludedDirs = new Set(['test', 'tests', 'fixtures', 'snapshots', 'node_modules', '__pycache__']);

function isRuntimeFile(path, explicitRuntime = false) {
  const parts = path.split('/');
  return !parts.some(part => excludedDirs.has(part) || part.startsWith('.')) &&
    (explicitRuntime || !excludedName.test(parts.at(-1))) &&
    (supported.test(path) || ['LICENSE', 'go.mod', 'Cargo.lock'].includes(parts.at(-1)));
}
function valuesDeep(value) {
  return typeof value === 'string' ? [value] : Object.values(value).flatMap(valuesDeep);
}

function staticModuleRequests(sources) {
  // Parse without linking or evaluating any application. Code examples inside
  // template strings are data, not imports. The old regex treated generated SDK
  // snippets as files in this checkout and prevented the product from packaging.
  const parse = String.raw`
const { readFileSync } = require('node:fs');
const { SourceTextModule, createContext } = require('node:vm');
const sources = JSON.parse(readFileSync(0, 'utf8'));
const context = createContext();
const result = sources.map(([path, source]) => {
  const module = new SourceTextModule(source, { identifier: path, context });
  return [path, [...module.dependencySpecifiers]];
});
process.stdout.write(JSON.stringify(result));
`;
  // Keep each parser child small as the cumulative source grows. Preserve the
  // input order and allow shared hosts time to schedule a batch under load.
  const requests = [];
  let batch = [], batchBytes = 0;
  const flush = () => {
    if (!batch.length) return;
    requests.push(...JSON.parse(execFileSync(process.execPath,
      ['--no-warnings', '--experimental-vm-modules', '--input-type=commonjs', '--eval', parse],
      { input: JSON.stringify(batch), encoding: 'utf8', timeout: 60000,
        maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })));
    batch = [];
    batchBytes = 0;
  };
  for (const [path, bytes] of sources) {
    if (!/\.(?:mjs|js)$/.test(path)) continue;
    if (batch.length && (batch.length >= 64 || batchBytes + bytes.length > 1024 * 1024)) flush();
    batch.push([path, bytes.toString('utf8')]);
    batchBytes += bytes.length;
  }
  flush();
  return requests;
}

export async function buildDistribution({ repository = fileURLToPath(new URL('../../../', import.meta.url)), ref, output,
  offline = false, resume = false, python = 'python3', onProgress = () => {} }) {
  if (typeof output !== 'string' || !output) throw new TypeError('An output directory is required');
  if (typeof resume !== 'boolean' || typeof onProgress !== 'function') throw new TypeError('Expected a resume boolean and progress callback');
  const repo = resolve(repository), out = resolve(output);
  let pin;
  if (resume) {
    const receipt = await recoverCompletedDistribution(out, ref);
    if (receipt) {
      onProgress({ phase: 'reused', sourceCommit: receipt.sourceCommit, archive: receipt.archive, sha256: receipt.sha256 });
      return { ...receipt, reused: true };
    }
    pin = await readDistributionBuildPin(out);
    if (ref === undefined && !pin) throw Object.assign(new Error('Resume this partial legacy output with its original --ref COMMIT.'),
      { code: 'DISTRIBUTION_ORIGINAL_REF_REQUIRED' });
  }
  const source = openGitSource({ repository: repo, ref: ref ?? pin?.sourceCommit ?? 'HEAD', offline, onProgress });
  const { commit, tree } = source;
  if (pin && pin.sourceCommit !== commit) throw Object.assign(new Error('The selected ref differs from the retained distribution source.'),
    { code: 'DISTRIBUTION_SOURCE_COMMIT_CONFLICT' });
  const byPath = new Map(tree.map(item => [item.path, item]));
  const initial = source.readFiles([byPath.get(ownPath + '/distribution.json'), byPath.get('LICENSE')]);
  const spec = JSON.parse(initial.get(ownPath + '/distribution.json'));
  if (spec.schema !== 'stellar-forge.merchant-distribution.v1') throw new TypeError('Unsupported distribution specification');
  const excluded = new Set(spec.excludeFiles ?? []);
  const explicitRuntime = new Set(spec.supportFiles);
  // Exact maintained runtime files can override a test-like filename, such as
  // the MCP buyer's imported acceptance descriptor. Directory, extension,
  // explicit exclusion and regular-file checks still apply.
  const selected = tree.filter(item => isRuntimeFile(item.path, explicitRuntime.has(item.path)) && !excluded.has(item.path) &&
    (spec.components.some(root => item.path.startsWith(root + '/')) || explicitRuntime.has(item.path)));
  for (const root of spec.components)
    if (!selected.some(item => item.path.startsWith(root + '/'))) throw new TypeError('Missing component: ' + root);
  const names = new Set(selected.map(item => item.path));
  const required = [...Object.values(spec.commands), ...valuesDeep(spec.exports).filter(path => path.startsWith('./source/')).map(path => path.slice(9))];
  for (const path of [...required, ...spec.supportFiles, ...Object.values(spec.runtimePackageManifests ?? {})])
    if (!names.has(path)) throw new TypeError('Missing packaged entry: ' + path);
  const sources = new Map();
  let totalBytes = 0;
  const loadSources = items => {
    const loaded = source.readFiles(items);
    for (const [path, bytes] of loaded) {
      totalBytes += bytes.length;
      if (bytes.length > 2 * 1024 * 1024 || totalBytes > 32 * 1024 * 1024)
        throw new RangeError('Distribution source size exceeded');
      sources.set(path, bytes);
    }
    return loaded;
  };
  source.progress('selected', { files: selected.length, components: spec.components.length });
  loadSources(selected);
  // The same manifests drive the actual servers. Retain every mapped source
  // and resolve browser imports in its served URL context, not by inventing a
  // missing file beside the importer. Ordinary Node imports keep filesystem
  // resolution, and physical files never lose precedence or exclusion checks.
  const browserAssets = createBrowserAssetIndex(spec.browserAssets ?? [], path => {
    if (!names.has(path)) throw new TypeError('Missing packaged browser entry: ' + path);
    return sources.get(path);
  });
  const missingModules = [];
  const enqueue = (target, importer, discovered) => {
    if (names.has(target)) return;
    const item = byPath.get(target);
    if (!item || excluded.has(target) || !isRuntimeFile(target, explicitRuntime.has(target))) {
      missingModules.push(importer + ' -> ' + target);
      return;
    }
    discovered.push(item);
    names.add(target);
    selected.push(item);
  };
  const mapped = [];
  for (const target of browserAssets.files) enqueue(target, 'browser asset manifest', mapped);
  if (mapped.length) loadSources(mapped);
  // Parse actual static ESM only, without executing application source. Shared
  // helpers discovered here travel with their importer. Dynamic application
  // inputs remain outside this maintained component/support inventory.
  let frontier = sources;
  while (frontier.size) {
    const discovered = [];
    for (const [path, requests] of staticModuleRequests(frontier)) {
      for (const request of requests) {
        const served = browserAssets.resolve(path, request);
        if (request.startsWith('.')) {
          const target = posix.normalize(posix.join(posix.dirname(path), request));
          if (byPath.has(target) || served === null) enqueue(target, path, discovered);
        }
        for (const target of served ?? []) enqueue(target, path + ' -> ' + request, discovered);
      }
    }
    frontier = discovered.length ? loadSources(discovered) : new Map();
  }
  if (missingModules.length) throw new TypeError('Unpackaged relative modules:\n' + missingModules.join('\n'));
  // Runtime drivers follow the exact source commit, including new production
  // dependencies such as the PostgreSQL cursor. Development fixtures stay out.
  const runtimeDependencies = Object.create(null), runtimePackageSources = {};
  const featurePeers = { ...spec.featurePeers };
  for (const [group, path] of Object.entries(spec.runtimePackageManifests ?? {})) {
    const original = JSON.parse(sources.get(path));
    if (!original.dependencies || typeof original.dependencies !== 'object' || Array.isArray(original.dependencies) ||
        !Object.keys(original.dependencies).length) throw new TypeError('Runtime dependencies missing: ' + path);
    featurePeers[group] = {};
    for (const [name, version] of Object.entries(original.dependencies)) {
      if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) ||
          !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ||
          Object.hasOwn(runtimeDependencies, name) && runtimeDependencies[name] !== version)
        throw new TypeError('Conflicting or unpinned runtime dependency in ' + path);
      runtimeDependencies[name] = version;
      // Preserve a real exported entry selected for this feature; dependency
      // versions still come from the original component's pinned manifest.
      const probe = spec.featurePeers?.[group]?.[name]?.probe ?? name;
      featurePeers[group][name] = { version, probe };
    }
    runtimePackageSources[group] = path;
  }
  const optionalPeers = { ...spec.nativePeers };
  for (const peers of Object.values(featurePeers)) {
    for (const [name, value] of Object.entries(peers)) {
      if (optionalPeers[name] && optionalPeers[name].version !== value.version)
        throw new TypeError('Conflicting optional dependency versions: ' + name);
      optionalPeers[name] = value;
    }
  }
  const version = spec.version + '-source.g' + commit.slice(0, 12);
  const metadata = {
    name: spec.name, version, private: true, type: 'module', license: 'MIT',
    description: 'Original Starforge Stellar x402 merchant, buyer and operations toolkit',
    engines: { node: '>=22.16.0' },
    bin: { starforge: './source/' + ownPath + '/cli.mjs' },
    exports: spec.exports, files: ['source/', 'manifest.json', 'README.md', 'LICENSE'],
    peerDependencies: Object.fromEntries(Object.entries(optionalPeers).map(([name, value]) => [name, value.version])),
    peerDependenciesMeta: Object.fromEntries(Object.keys(optionalPeers).map(name => [name, { optional: true }])),
    optionalDependencies: runtimeDependencies,
    repository: { type: 'git', url: 'https://github.com/woahwhattheheck/public-commons-sprint-2026.git', directory: ownPath },
  };
  const metadataBytes = Buffer.from(json(metadata));
  const readme = sources.get(ownPath + '/README.md');
  const license = initial.get('LICENSE');
  if (!readme || !byPath.get('LICENSE')) throw new TypeError('Distribution README and license required');
  const manifest = {
    schema: 'stellar-forge.merchant-distribution-manifest.v1',
    packageName: spec.name, packageVersion: version, sourceCommit: commit,
    sourceRepository: 'https://github.com/woahwhattheheck/public-commons-sprint-2026',
    components: spec.components, sourceBytes: totalBytes,
    files: selected.map(item => ({ path: item.path, packagePath: 'source/' + item.path,
      gitBlob: item.blob, sha256: digest(sources.get(item.path)), bytes: sources.get(item.path).length, mode: item.mode })),
    packageFiles: { 'package.json': digest(metadataBytes), 'README.md': digest(readme), 'LICENSE': digest(license) },
    optionalNativePeers: Object.fromEntries(Object.entries(spec.nativePeers).map(([name, value]) => [name, value.version])),
    optionalFeaturePeers: Object.fromEntries(Object.entries(featurePeers).map(([feature, peers]) =>
      [feature, Object.fromEntries(Object.entries(peers).map(([name, value]) => [name, value.version]))])),
    optionalRuntimeDependencies: runtimeDependencies, runtimePackageSources,
  };
  const files = selected.map(item => ({ path: 'source/' + item.path, bytes: sources.get(item.path),
    mode: item.mode === '100755' ? 0o755 : 0o644 }));
  for (const [path, bytes] of Object.entries({ 'package.json': metadataBytes, 'manifest.json': Buffer.from(json(manifest)),
    'README.md': readme, 'LICENSE': license })) files.push({ path, bytes, mode: 0o644 });
  const operation = await openDistributionBuild({ output: out, resume, manifest, files,
    onProgress: (phase, details) => source.progress(phase, details) });
  try {
    const previous = await operation.completed();
    if (previous) return { ...previous, reused: true };
    source.progress('materializing', { files: selected.length, bytes: totalBytes, resume });
    const materialization = await operation.materialize();
    const packed = await operation.pack({ python });
    const receipt = { status: 'PACKAGED', packageName: spec.name, packageVersion: version,
      sourceCommit: commit, ...packed, sourceFiles: selected.length, sourceBytes: totalBytes,
      sourceAcquisition: source.metrics(), materialization };
    await operation.complete(receipt);
    source.progress('packaged', { files: selected.length, archiveBytes: receipt.archiveBytes, sha256: receipt.sha256 });
    return receipt;
  } finally { await operation.close(); }
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('node build.mjs --out DIRECTORY [--repo CHECKOUT] [--ref COMMIT_OR_BRANCH] [--offline] [--resume] [--python EXECUTABLE]\n' +
      'node build.mjs --out DIRECTORY --status'); return;
  }
  const options = {};
  let offline = false, resume = false, status = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--offline' && !offline) { offline = true; continue; }
    if (args[i] === '--resume' && !resume) { resume = true; continue; }
    if (args[i] === '--status' && !status) { status = true; continue; }
    if (!['--out', '--repo', '--ref', '--python'].includes(args[i]) || Object.hasOwn(options, args[i]) || !args[i + 1])
      throw new TypeError('Expected --out DIRECTORY [--repo CHECKOUT] [--ref COMMIT] [--offline] [--resume] [--python EXECUTABLE]');
    options[args[i]] = args[i + 1];
    i++;
  }
  if (status) {
    if (offline || resume || Object.keys(options).some(key => key !== '--out')) throw new TypeError('--status accepts only --out DIRECTORY');
    console.log(json(await inspectDistributionBuild({ output: options['--out'] })).trimEnd()); return;
  }
  console.log(json(await buildDistribution({ output: options['--out'], repository: options['--repo'], ref: options['--ref'], offline, resume,
    python: options['--python'],
    onProgress: event => process.stderr.write('[starforge build] ' + JSON.stringify(event) + '\n') })).trimEnd());
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main(process.argv.slice(2)).catch(error => { console.error(error.code ? error.code + ': ' + error.message : error.message); process.exitCode = 1; });

