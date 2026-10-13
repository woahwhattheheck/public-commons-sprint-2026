#!/usr/bin/env node
// MIT. Package one immutable Git snapshot without bundling or rewriting native source.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openGitSource, MAX_SOURCE_FILE_BYTES, MAX_SOURCE_BYTES } from './git-source.mjs';
import { browserAssetDeclarations, createBrowserAssetIndex } from './browser-assets.mjs';
import { productPackageMetadata } from './product-package.mjs';
import { distributionPath, contributionDirectory, contributionPaths, composeDistribution } from './specification.mjs';
import { sourceSelectionDirectory, sourceSelectionPath, validateSourceSelection,
  selectedContributionPaths, requireSourceSelectionMatch } from './source-selection.mjs';
import { readDistributionBuildPin, recoverCompletedDistribution, openDistributionBuild,
  inspectDistributionBuild } from './build-state.mjs';

export { inspectDistributionBuild };

const json = value => JSON.stringify(value, null, 2) + '\n';
const digest = data => createHash('sha256').update(data).digest('hex');
const supported = /\.(?:mjs|js|cjs|ts|mts|py|pyi|rb|rbs|erb|php|go|rs|java|dmn|dmn11|cmmn|json|jsonl|ndjson|toml|md|html|css|txt|sql|csv|tsv|xml|xsd|dtd|yaml|yml|svg|png|woff2|service|proto)$/i;
const excludedName = /(?:^test[_.-]|[.]test[.]|[.]spec[.]|(?:^|[-_])acceptance(?:[-_.]|$)|(?:^|[-_])focused[-_]?check[.]|_check[.])/i;
const excludedDirs = new Set(['test', 'tests', 'fixtures', 'snapshots', 'node_modules', '__pycache__']);

function isRuntimeFile(path, explicitRuntime = false) {
  const parts = path.split('/');
  // Retained source data can have an original fixtures path. Only explicitly
  // declared data and native XML/DMN/CMMN models get this exception; executable fixtures stay excluded.
  const declaredData = explicitRuntime && /\.(?:csv|json|txt|parquet|xml|dmn|dmn11|cmmn)$/i.test(path);
  // An explicit original file is an exact source selection, not a directory
  // expansion hint. Its extension cannot override that declaration. Keep the
  // heuristic format list for automatic component/import discovery; all paths
  // still pass the same directory, exclusion, Git type/hash and byte limits.
  return !parts.some(part => part.startsWith('.') ||
    (excludedDirs.has(part) && !(part === 'fixtures' && declaredData))) &&
    (explicitRuntime || !excludedName.test(parts.at(-1))) &&
    (explicitRuntime || supported.test(path) ||
      ['LICENSE', 'go.mod', 'Cargo.lock'].includes(parts.at(-1)));
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
  try {
    const module = new SourceTextModule(source, { identifier: path, context });
    return [path, [...module.dependencySpecifiers], null];
  } catch (error) {
    return [path, [], String(error?.message ?? error)];
  }
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

// Read-only closure check for a retained immutable source inventory. This uses
// the builder's parser and browser/physical resolution without running a build.
export function inspectDistributionSourceImports({ sources, browserAssets, nodeEntrypoints = [] } = {}) {
  if (!(sources instanceof Map) || !sources.size || typeof browserAssets?.resolve !== 'function' ||
      !Array.isArray(nodeEntrypoints) || nodeEntrypoints.some(path => typeof path !== 'string' || !path) ||
      [...sources].some(([path, bytes]) => typeof path !== 'string' || !Buffer.isBuffer(bytes)))
    throw new TypeError('Source import inspection requires original source bytes and the maintained browser asset index');
  const parsed = staticModuleRequests(sources), requestsByPath = new Map(parsed), missing = [], external = new Set();
  const invalid = parsed.filter(([, , error]) => error);
  if (invalid.length) {
    const error = new TypeError('Invalid original source modules:\n' +
      invalid.map(([path, , message]) => path + ': ' + message).join('\n'));
    error.code = 'DISTRIBUTION_SOURCE_IMPORTS_INVALID';
    error.modules = invalid.map(([path, , message]) => ({ path, message }));
    throw error;
  }
  let staticSpecifiers = 0, physicalRelativeImports = 0, browserImports = 0;
  const required = (importer, specifier, target, kind) => {
    if (!sources.has(target)) missing.push({ importer, specifier, target, kind });
  };
  const nodeReachable = new Set(), queue = [];
  for (const path of new Set(nodeEntrypoints)) {
    required('declared Node entrypoint', path, path, 'node-entrypoint');
    if (sources.has(path)) { nodeReachable.add(path); queue.push(path); }
  }
  // A module can serve both Node and browser callers. A browser route must not
  // hide its physical dependency from an original Node/provider import chain.
  for (let index = 0; index < queue.length; index++) {
    const importer = queue[index];
    for (const request of requestsByPath.get(importer) ?? []) {
      if (!request.startsWith('.')) continue;
      const target = posix.normalize(posix.join(posix.dirname(importer), request));
      if (sources.has(target) && !nodeReachable.has(target)) { nodeReachable.add(target); queue.push(target); }
    }
  }
  for (const [path, requests] of parsed) {
    for (const request of requests) {
      staticSpecifiers++;
      if (/^file:/i.test(request)) {
        missing.push({ importer: path, specifier: request, target: request, kind: 'absolute-local-import' });
        continue;
      }
      let served;
      try { served = browserAssets.resolve(path, request); }
      catch (cause) {
        const error = new TypeError('Unresolved original browser import: ' + path + ' -> ' + request + ': ' + cause.message);
        error.code = 'DISTRIBUTION_SOURCE_IMPORTS_MISSING';
        error.imports = [{ importer: path, specifier: request, target: request, kind: 'unserved-browser-import' }];
        throw error;
      }
      if (request.startsWith('.')) {
        const target = posix.normalize(posix.join(posix.dirname(path), request));
        // A file's presence does not create a Node execution context for a
        // browser-only module. Preserve physical edges only for actual native
        // reachability or modules without a serving context.
        if (served === null || nodeReachable.has(path)) {
          physicalRelativeImports++;
          required(path, request, target, 'physical-relative-import');
        }
      } else if (request.startsWith('/') && (served === null || nodeReachable.has(path))) {
        missing.push({ importer: path, specifier: request, target: request, kind: 'absolute-local-import' });
      } else if (served === null) external.add(request);
      for (const target of served ?? []) {
        browserImports++;
        required(path, request, target, 'served-browser-import');
      }
    }
  }
  if (missing.length) {
    const error = new TypeError('Original source imports are missing from the retained inventory:\n' +
      missing.map(row => row.importer + ' -> ' + row.specifier + ' => ' + row.target).join('\n'));
    error.code = 'DISTRIBUTION_SOURCE_IMPORTS_MISSING';
    error.imports = missing;
    throw error;
  }
  return { schema: 'stellar-forge.distribution-source-imports.v1',
    status: 'STATIC_ESM_AND_BROWSER_IMPORTS_CHECKED', sourceFiles: sources.size,
    parsedModules: parsed.length, staticSpecifiers, physicalRelativeImports, browserImports,
    nodeEntrypoints: new Set(nodeEntrypoints).size, nodeReachableFiles: nodeReachable.size,
    nodeReachableModules: [...nodeReachable].filter(path => requestsByPath.has(path)).length,
    externalSpecifiers: [...external].sort(),
    unscannedModuleKinds: ['dynamic-import', 'commonjs-require'],
    runtimeStatus: 'PARSED_WITHOUT_APPLICATION_EVALUATION_OR_DEPENDENCY_INSTALLATION' };
}

export async function buildDistribution({ repository = fileURLToPath(new URL('../../../', import.meta.url)), ref, output,
  offline = false, resume = false, selection, python = 'python3', onProgress = () => {} }) {
  if (typeof output !== 'string' || !output) throw new TypeError('An output directory is required');
  if (typeof resume !== 'boolean' || typeof onProgress !== 'function') throw new TypeError('Expected a resume boolean and progress callback');
  sourceSelectionPath(selection);
  const repo = resolve(repository), out = resolve(output);
  let pin;
  if (resume) {
    const receipt = await recoverCompletedDistribution(out, ref, selection);
    if (receipt) {
      onProgress({ phase: 'reused', sourceCommit: receipt.sourceCommit, archive: receipt.archive, sha256: receipt.sha256 });
      return { ...receipt, reused: true };
    }
    pin = await readDistributionBuildPin(out);
    if (pin) selection = requireSourceSelectionMatch(pin.sourceSelection, selection);
    if (ref === undefined && !pin) throw Object.assign(new Error('Resume this partial legacy output with its original --ref COMMIT.'),
      { code: 'DISTRIBUTION_ORIGINAL_REF_REQUIRED' });
  }
  const source = openGitSource({ repository: repo, ref: ref ?? pin?.sourceCommit ?? 'HEAD', offline, onProgress });
  const { commit, tree } = source;
  if (pin && pin.sourceCommit !== commit) throw Object.assign(new Error('The selected ref differs from the retained distribution source.'),
    { code: 'DISTRIBUTION_SOURCE_COMMIT_CONFLICT' });
  const byPath = new Map(tree.map(item => [item.path, item]));
  const recipePath = sourceSelectionPath(selection);
  const recipeEntry = recipePath ? byPath.get(recipePath) : null;
  if (recipePath && !recipeEntry) throw new TypeError('Missing original source selection: ' + recipePath);
  const recipeBytes = recipeEntry ? source.readFiles([recipeEntry]).get(recipePath) : null;
  const recipe = recipeBytes ? validateSourceSelection(JSON.parse(recipeBytes), recipePath) : undefined;
  const allContributionPaths = contributionPaths(tree.map(item => item.path));
  const selectedPaths = recipe ? selectedContributionPaths(allContributionPaths, recipe) : allContributionPaths;
  const specificationPaths = [distributionPath, ...selectedPaths, ...(recipePath ? [recipePath] : [])];
  for (const path of [...specificationPaths, 'LICENSE'])
    if (!byPath.has(path)) throw new TypeError('Missing original distribution input: ' + path);
  const initial = source.readFiles([...specificationPaths.map(path => byPath.get(path)), byPath.get('LICENSE')]);
  const base = JSON.parse(initial.get(distributionPath));
  const distribution = composeDistribution({ base,
    contributions: selectedPaths.map(path => ({ path, data: JSON.parse(initial.get(path)) })), selection: recipe });
  const spec = distribution.spec;
  const product = productPackageMetadata(spec.product);
  if (spec.schema !== 'stellar-forge.merchant-distribution.v1') throw new TypeError('Unsupported distribution specification');
  const excluded = new Set(spec.excludeFiles ?? []);
  const required = [...Object.values(spec.commands), ...Object.values(product.bin), product.readme,
    ...valuesDeep(spec.exports).filter(path => path.startsWith('./source/')).map(path => path.slice(9)),
    ...Object.values(spec.applicationProviders ?? {}), ...Object.values(spec.merchantProviders ?? {})];
  const explicitRuntime = new Set([...spec.supportFiles, ...specificationPaths,
    ...Object.values(spec.applicationProviders ?? {}), ...Object.values(spec.merchantProviders ?? {}),
    ...(recipe ? [...required, ...Object.values(spec.runtimePackageManifests ?? {}),
      ...(spec.browserAssets ?? []).flatMap(entry => [entry.server, entry.manifest])] : [])]);
  // A selected static import may need a production helper declared in the
  // original base support inventory. Keep that declaration with its importer.
  const declaredRuntime = new Set(base.supportFiles ?? []);
  const originalInputs = new Set([...specificationPaths, product.readme]);
  const browserInputs = new Set();
  const selectionIncludes = path => !recipe || !(
    path.startsWith(contributionDirectory + '/') || path.startsWith(sourceSelectionDirectory + '/')) ||
    originalInputs.has(path) || browserInputs.has(path);
  // A selected archive carries only its original declarations, even when its
  // complete distribution component contains other product contribution files.
  // Explicit support files retain their original format and can override a
  // test-like filename. Automatic component expansion keeps its format filter;
  // directory, explicit exclusion and regular-file checks still apply.
  const selected = tree.filter(item => selectionIncludes(item.path) &&
    isRuntimeFile(item.path, explicitRuntime.has(item.path)) && !excluded.has(item.path) &&
    (spec.components.some(root => item.path.startsWith(root + '/')) || explicitRuntime.has(item.path)));
  for (const root of spec.components)
    if (!selected.some(item => item.path.startsWith(root + '/'))) throw new TypeError('Missing component: ' + root);
  const names = new Set(selected.map(item => item.path));
  for (const path of [...required, ...spec.supportFiles, ...specificationPaths, ...Object.values(spec.runtimePackageManifests ?? {})])
    if (!names.has(path)) throw new TypeError('Missing packaged entry: ' + path);
  const sources = new Map();
  const readSource = path => sources.get(path) ?? source.readFiles([byPath.get(path)]).get(path);
  let totalBytes = 0;
  const loadSources = items => {
    const loaded = source.readFiles(items);
    for (const [path, bytes] of loaded) {
      totalBytes += bytes.length;
      if (bytes.length > MAX_SOURCE_FILE_BYTES)
        throw new RangeError(`Distribution source file exceeds ${MAX_SOURCE_FILE_BYTES} bytes (${bytes.length}): ${path}`);
      if (totalBytes > MAX_SOURCE_BYTES)
        throw new RangeError(`Distribution source exceeds ${MAX_SOURCE_BYTES} bytes: ${totalBytes}`);
      sources.set(path, bytes);
    }
    return loaded;
  };
  source.progress('selected', { files: selected.length, components: spec.components.length, contributions: distribution.contributions.length,
    ...(recipe ? { sourceSelection: recipe.id } : {}) });
  loadSources(selected);
  // Keep a dependency-only index of source-owned browser declarations. An
  // unselected contribution does not enable commands, providers, components or
  // dependencies merely because one of its servers is included elsewhere.
  const browserDonors = [];
  const selectedContributionSet = new Set(selectedPaths);
  for (const [path, bytes] of source.readFiles(allContributionPaths.map(path => byPath.get(path)))) {
    let data;
    try { data = JSON.parse(bytes); }
    catch (error) {
      // Selected contributions were already validated above. An unrelated
      // malformed document cannot become a borrowed dependency declaration.
      if (selectedContributionSet.has(path)) throw error;
      continue;
    }
    if (data?.browserAssets !== undefined) browserDonors.push({ path, data });
  }
  const declarations = browserAssetDeclarations({ base, contributions: browserDonors });
  const initialSelected = [...selected], initialNames = new Set(names);
  const initialModules = selected.filter(item => /\.(?:mjs|js)$/.test(item.path)).map(item => item.path);
  const originalExplicitRuntime = new Set(explicitRuntime);
  const requestsByPath = new Map(), parseErrors = new Map(), borrowedDeclarations = new Map();
  let browserAssets, problems = [], previousNames = new Set(names);
  const seenSelections = new Set([JSON.stringify([...names].sort())]);
  const enqueue = (target, importer) => {
    if (names.has(target)) return true;
    const item = byPath.get(target);
    if (!item || excluded.has(target) || !selectionIncludes(target) ||
        !isRuntimeFile(target, explicitRuntime.has(target) || declaredRuntime.has(target))) {
      problems.push('Unpackaged source: ' + importer + ' -> ' + target);
      return false;
    }
    names.add(target);
    return true;
  };
  const selectedBrowser = new Map((spec.browserAssets ?? []).map(entry => [entry.server, entry]));
  const browserServers = [...new Set([...selectedBrowser.keys(), ...declarations.servers])];
  while (true) {
    // A newly reached server can give an initial module a browser-only context.
    // Recompute discoveries from the immutable selection instead of preserving
    // earlier provisional Node edges, their servers or their donor declarations.
    names.clear(); for (const path of initialNames) names.add(path);
    browserInputs.clear(); borrowedDeclarations.clear(); problems = [];
    explicitRuntime.clear(); for (const path of originalExplicitRuntime) explicitRuntime.add(path);
    browserAssets = createBrowserAssetIndex([], readSource);
    for (const server of browserServers) {
      if (!previousNames.has(server)) continue;
      try {
        const rows = declarations.forServer(server);
        const selectedRegistration = selectedBrowser.get(server);
        if (selectedRegistration && rows.some(row => row.manifest !== selectedRegistration.manifest))
          throw new TypeError('Conflicting browser asset declarations for ' + server);
        const registration = selectedRegistration ?? rows[0];
        if (!registration) continue;
        let ready = true;
        for (const row of rows) {
          browserInputs.add(row.source); explicitRuntime.add(row.source);
          if (!enqueue(row.source, server + ' browser declaration')) ready = false;
        }
        explicitRuntime.add(registration.manifest);
        if (!enqueue(registration.manifest, server + ' browser manifest')) ready = false;
        if (!ready) continue;
        browserAssets.register(registration);
        for (const row of rows) {
          const uses = borrowedDeclarations.get(row.source) ?? [];
          uses.push({ server: row.server, manifest: row.manifest });
          borrowedDeclarations.set(row.source, uses);
        }
      } catch (error) { problems.push(error.message); }
    }
    for (const target of browserAssets.files) enqueue(target, 'browser asset manifest');
    while (true) {
      const beforeFiles = names.size;
      const unparsed = [...names].filter(path => !requestsByPath.has(path) &&
        /\.(?:mjs|js)$/.test(path));
      for (const [path, requests, error] of staticModuleRequests(
        source.readFiles(unparsed.map(path => byPath.get(path))))) {
        requestsByPath.set(path, requests);
        if (error) parseErrors.set(path, error);
      }
      // Revisit every original request in every currently active serving
      // context, including modules parsed before this server was discovered.
      for (const path of names) {
        if (!browserAssets.hasContext(path)) continue;
        for (const request of requestsByPath.get(path) ?? []) {
          try {
            for (const target of browserAssets.resolve(path, request) ?? [])
              enqueue(target, path + ' -> ' + request);
          } catch (error) { problems.push(error.message); }
        }
      }
      // Native entrypoints and unmapped initial modules retain filesystem
      // semantics. A module genuinely reached through native imports keeps
      // those edges even if the same physical bytes are also browser assets.
      const nativeQueue = [...new Set([...required,
        ...initialModules.filter(path => !browserAssets.hasContext(path))])];
      const nativeSeen = new Set();
      for (let index = 0; index < nativeQueue.length; index++) {
        const path = nativeQueue[index];
        if (nativeSeen.has(path)) continue;
        nativeSeen.add(path);
        for (const request of requestsByPath.get(path) ?? []) {
          if (!request.startsWith('.')) continue;
          const target = posix.normalize(posix.join(posix.dirname(path), request));
          if (enqueue(target, path)) nativeQueue.push(target);
        }
      }
      if (names.size === beforeFiles) break;
    }
    const selectionKey = JSON.stringify([...names].sort());
    if (names.size === previousNames.size && [...names].every(path => previousNames.has(path))) break;
    if (seenSelections.has(selectionKey)) throw Object.assign(
      new TypeError('Browser and native source reachability does not converge; give the conflicting entrypoint an explicit source/browser declaration.'),
      { code: 'DISTRIBUTION_SOURCE_CONTEXT_CYCLE' });
    seenSelections.add(selectionKey); previousNames = new Set(names);
  }
  // Syntax errors from a provisional filesystem interpretation must not poison
  // a later browser-only selection. Report only the converged original files.
  for (const path of names) if (parseErrors.has(path))
    problems.push('Invalid packaged module: ' + path + ': ' + parseErrors.get(path));
  if (problems.length) {
    const error = new TypeError('Incomplete original source/browser closure:\n' + [...new Set(problems)].join('\n'));
    error.code = 'DISTRIBUTION_SOURCE_CLOSURE_INCOMPLETE';
    throw error;
  }
  const discovered = [...names].filter(path => !initialNames.has(path)).map(path => byPath.get(path));
  selected.splice(0, selected.length, ...initialSelected, ...discovered);
  loadSources(discovered);
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
  const version = spec.version + '-source.g' + commit.slice(0, 12) + (recipe ? '.selection.' + recipe.id : '');
  const metadata = {
    name: spec.name, version, private: true, type: 'module', license: 'MIT',
    description: product.description,
    engines: { node: '>=22.16.0' },
    bin: Object.fromEntries(Object.entries(product.bin).map(([name, path]) => [name, './source/' + path])),
    exports: spec.exports, files: ['source/', 'manifest.json', 'README.md', 'LICENSE'],
    peerDependencies: Object.fromEntries(Object.entries(optionalPeers).map(([name, value]) => [name, value.version])),
    peerDependenciesMeta: Object.fromEntries(Object.keys(optionalPeers).map(name => [name, { optional: true }])),
    optionalDependencies: runtimeDependencies,
    repository: product.repository,
  };
  const metadataBytes = Buffer.from(json(metadata));
  const readme = sources.get(product.readme);
  const license = initial.get('LICENSE');
  if (!readme || !byPath.get('LICENSE')) throw new TypeError('Distribution README and license required');
  const manifest = {
    schema: 'stellar-forge.merchant-distribution-manifest.v1',
    packageName: spec.name, packageVersion: version, sourceCommit: commit,
    sourceRepository: product.sourceRepository,
    ...(recipe ? { sourceSelection: { id: recipe.id, title: recipe.title, path: recipePath,
      gitBlob: recipeEntry.blob, sha256: digest(recipeBytes), bytes: recipeBytes.length } } : {}),
    components: spec.components, sourceBytes: totalBytes,
    distributionInputs: specificationPaths.map(path => ({ path, gitBlob: byPath.get(path).blob,
      sha256: digest(sources.get(path)), bytes: sources.get(path).length })),
    distributionContributions: distribution.contributions.map(({ id, path }) => ({ id, path })),
    browserAssetDeclarations: [...borrowedDeclarations].map(([path, registrations]) => ({ path,
      gitBlob: byPath.get(path).blob, sha256: digest(sources.get(path)),
      bytes: sources.get(path).length, registrations })),
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
  // Match the original runtime-unpack.py limits before publishing an archive.
  // Source, generated manifest, package metadata, README and license all count.
  const packageBytes = files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (packageBytes > MAX_SOURCE_BYTES)
    throw new RangeError(`Distribution package exceeds ${MAX_SOURCE_BYTES} unpacked bytes: ${packageBytes}`);
  for (const file of files)
    if (file.bytes.length > MAX_SOURCE_FILE_BYTES)
      throw new RangeError(`Distribution package member exceeds ${MAX_SOURCE_FILE_BYTES} bytes (${file.bytes.length}): ${file.path}`);

  const operation = await openDistributionBuild({ output: out, resume, manifest, files,
    onProgress: (phase, details) => source.progress(phase, details) });
  try {
    const previous = await operation.completed();
    if (previous) return { ...previous, reused: true };
    source.progress('materializing', { files: selected.length, bytes: totalBytes, resume });
    const materialization = await operation.materialize();
    const packed = await operation.pack({ python });
    const receipt = { status: 'PACKAGED', packageName: spec.name, packageVersion: version,
      sourceCommit: commit, ...(manifest.sourceSelection ? { sourceSelection: manifest.sourceSelection } : {}),
      ...packed, sourceFiles: selected.length, sourceBytes: totalBytes,
      sourceAcquisition: source.metrics(), materialization };
    await operation.complete(receipt);
    source.progress('packaged', { files: selected.length, archiveBytes: receipt.archiveBytes, sha256: receipt.sha256 });
    return receipt;
  } finally { await operation.close(); }
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('node build.mjs --out DIRECTORY [--repo CHECKOUT] [--ref COMMIT_OR_BRANCH] [--selection ID|all] [--offline] [--resume] [--python EXECUTABLE]\n' +
      'node build.mjs --out DIRECTORY --status'); return;
  }
  const options = {};
  let offline = false, resume = false, status = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--offline' && !offline) { offline = true; continue; }
    if (args[i] === '--resume' && !resume) { resume = true; continue; }
    if (args[i] === '--status' && !status) { status = true; continue; }
    if (!['--out', '--repo', '--ref', '--selection', '--python'].includes(args[i]) || Object.hasOwn(options, args[i]) || !args[i + 1])
      throw new TypeError('Expected --out DIRECTORY [--repo CHECKOUT] [--ref COMMIT] [--selection ID|all] [--offline] [--resume] [--python EXECUTABLE]');
    options[args[i]] = args[i + 1];
    i++;
  }
  if (status) {
    if (offline || resume || Object.keys(options).some(key => key !== '--out')) throw new TypeError('--status accepts only --out DIRECTORY');
    console.log(json(await inspectDistributionBuild({ output: options['--out'] })).trimEnd()); return;
  }
  console.log(json(await buildDistribution({ output: options['--out'], repository: options['--repo'], ref: options['--ref'], offline, resume,
    selection: options['--selection'], python: options['--python'],
    onProgress: event => process.stderr.write('[starforge build] ' + JSON.stringify(event) + '\n') })).trimEnd());
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main(process.argv.slice(2)).catch(error => { console.error(error.code ? error.code + ': ' + error.message : error.message); process.exitCode = 1; });

