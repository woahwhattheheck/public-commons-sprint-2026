#!/usr/bin/env node
// MIT. Package one immutable Git snapshot without bundling or rewriting native source.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ownPath = 'stellar/scf-starforge-20261009/distribution';
const json = value => JSON.stringify(value, null, 2) + '\n';
const digest = data => createHash('sha256').update(data).digest('hex');
const supported = /\.(?:mjs|js|cjs|ts|mts|py|json|toml|md|html|css|txt|sql|csv|svg|png|woff2)$/i;
const excludedName = /(?:^test[_.-]|[.]test[.]|[.]spec[.]|(?:^|[-_])acceptance(?:[-_.]|$)|(?:^|[-_])focused[-_]?check[.]|_check[.])/i;
const excludedDirs = new Set(['test', 'tests', 'fixtures', 'snapshots', 'node_modules', '__pycache__']);

function isRuntimeFile(path) {
  const parts = path.split('/');
  return !parts.some(part => excludedDirs.has(part) || part.startsWith('.')) &&
    !excludedName.test(parts.at(-1)) && (supported.test(path) || parts.at(-1) === 'LICENSE');
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
  const modules = [...sources].filter(([path]) => /\.(?:mjs|js)$/.test(path))
    .map(([path, bytes]) => [path, bytes.toString('utf8')]);
  return JSON.parse(execFileSync(process.execPath,
    ['--no-warnings', '--experimental-vm-modules', '--input-type=commonjs', '--eval', parse],
    { input: JSON.stringify(modules), encoding: 'utf8', timeout: 10000,
      maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }));
}

export async function buildDistribution({ repository = fileURLToPath(new URL('../../../', import.meta.url)), ref = 'HEAD', output }) {
  if (typeof output !== 'string' || !output) throw new TypeError('An output directory is required');
  const repo = resolve(repository), out = resolve(output);
  const git = args => execFileSync('git', args, { cwd: repo, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const commit = git(['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']).toString().trim();
  const readSource = path => git(['show', commit + ':' + path]);
  const spec = JSON.parse(readSource(ownPath + '/distribution.json'));
  if (spec.schema !== 'stellar-forge.merchant-distribution.v1') throw new TypeError('Unsupported distribution specification');
  const tree = git(['ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8').split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    const [mode, type, blob] = line.slice(0, tab).split(' ');
    return { mode, type, blob, path: line.slice(tab + 1) };
  });
  const byPath = new Map(tree.map(item => [item.path, item]));
  const excluded = new Set(spec.excludeFiles ?? []);
  const selected = tree.filter(item => isRuntimeFile(item.path) && !excluded.has(item.path) &&
    (spec.components.some(root => item.path.startsWith(root + '/')) || spec.supportFiles.includes(item.path)));
  for (const root of spec.components)
    if (!selected.some(item => item.path.startsWith(root + '/'))) throw new TypeError('Missing component: ' + root);
  const names = new Set(selected.map(item => item.path));
  const required = [...Object.values(spec.commands), ...valuesDeep(spec.exports).filter(path => path.startsWith('./source/')).map(path => path.slice(9))];
  for (const path of [...required, ...spec.supportFiles, ...Object.values(spec.runtimePackageManifests ?? {})])
    if (!names.has(path)) throw new TypeError('Missing packaged entry: ' + path);
  const sources = new Map();
  let totalBytes = 0;
  for (const item of selected) {
    if (!['100644', '100755'].includes(item.mode) || item.type !== 'blob')
      throw new TypeError('Only regular source files may be packaged: ' + item.path);
    const bytes = git(['cat-file', 'blob', item.blob]);
    totalBytes += bytes.length;
    if (bytes.length > 2 * 1024 * 1024 || totalBytes > 32 * 1024 * 1024)
      throw new RangeError('Distribution source size exceeded');
    sources.set(item.path, bytes);
  }
  // Native parsing checks real static ESM imports and re-exports. The explicit
  // component inventory retains dynamic runtime modules and browser assets.
  // Operator-selected handler/signing modules remain external application inputs.
  const missingModules = [];
  for (const [path, requests] of staticModuleRequests(sources)) {
    for (const request of requests.filter(value => value.startsWith('.'))) {
      const target = posix.normalize(posix.join(posix.dirname(path), request));
      if (!names.has(target)) missingModules.push(path + ' -> ' + target);
    }
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
      featurePeers[group][name] = { version, probe: name };
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
  const license = readSource('LICENSE');
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
  // The caller chooses a new output directory. No prior archive or workspace is replaced.
  await mkdir(out, { mode: 0o700 });
  const stage = join(out, 'package');
  await mkdir(stage, { mode: 0o700 });
  for (const item of selected) {
    const destination = join(stage, 'source', item.path);
    await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
    await writeFile(destination, sources.get(item.path), { flag: 'wx', mode: item.mode === '100755' ? 0o755 : 0o644 });
  }
  for (const [name, content] of Object.entries({ 'package.json': metadataBytes, 'manifest.json': json(manifest), 'README.md': readme, 'LICENSE': license }))
    await writeFile(join(stage, name), content, { flag: 'wx', mode: 0o644 });
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const packed = JSON.parse(execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', out],
    { cwd: stage, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  if (!Array.isArray(packed) || packed.length !== 1 || !/^[A-Za-z0-9_.-]+\.tgz$/.test(packed[0]?.filename ?? ''))
    throw new TypeError('npm did not return one package archive');
  const archive = join(out, packed[0].filename);
  const receipt = { status: 'PACKAGED', packageName: spec.name, packageVersion: version,
    sourceCommit: commit, archive, sha256: digest(await readFile(archive)),
    integrity: packed[0].integrity, sourceFiles: selected.length, sourceBytes: totalBytes,
    archiveBytes: packed[0].size, installedBytes: packed[0].unpackedSize };
  await writeFile(join(out, 'distribution.json'), json(receipt), { flag: 'wx', mode: 0o600 });
  return receipt;
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('node build.mjs --out NEW_DIRECTORY [--repo CHECKOUT] [--ref COMMIT_OR_BRANCH]'); return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--out', '--repo', '--ref'].includes(args[i]) || Object.hasOwn(options, args[i]) || !args[i + 1])
      throw new TypeError('Expected --out NEW_DIRECTORY [--repo CHECKOUT] [--ref COMMIT_OR_BRANCH]');
    options[args[i]] = args[i + 1];
  }
  console.log(json(await buildDistribution({ output: options['--out'], repository: options['--repo'], ref: options['--ref'] })).trimEnd());
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
