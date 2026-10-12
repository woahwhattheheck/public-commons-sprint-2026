// MIT. Enrich the original product catalog through its original Git snapshot.
import { createHash } from 'node:crypto';
import { composeDistribution, contributionPaths, distributionPath } from '../specification.mjs';
import { selectedContributionPaths, validateSourceSelection } from '../source-selection.mjs';
import { describeProductRequirements, productRequirementIndex } from './product-requirements.mjs';
import { inspectRuntimeDependencyLock } from './runtime-dependencies.mjs';

const errorView = error => ({ code: error.code ?? 'PRODUCT_CAPABILITY_SOURCE_ERROR', message: String(error.message ?? error).slice(0, 2000) });
const clone = value => JSON.parse(JSON.stringify(value));

/** A missing original object is associated with the products that use it. */
function readJson(source, paths) {
  const byPath = new Map(source.tree.map(item => [item.path, item])), records = new Map(), entries = [];
  for (const path of [...new Set(paths)].sort()) {
    const entry = byPath.get(path);
    if (!entry || !['100644', '100755'].includes(entry.mode) || entry.type !== 'blob')
      records.set(path, { error: { code: 'PRODUCT_SOURCE_MISSING', message: 'Missing regular committed source: ' + path } });
    else entries.push(entry);
  }
  let bytes;
  try { bytes = source.readFiles(entries); }
  catch (error) {
    if (error.code !== 'MISSING_SOURCE_OBJECTS' || !Array.isArray(error.missingObjects)) throw error;
    const missing = new Set(error.missingObjects);
    for (const entry of entries.filter(entry => missing.has(entry.blob)))
      records.set(entry.path, { error: { code: error.code, message: 'Original Git object is absent for ' + entry.path } });
    bytes = source.readFiles(entries.filter(entry => !missing.has(entry.blob)));
  }
  for (const entry of entries) {
    if (!bytes.has(entry.path)) continue;
    const value = bytes.get(entry.path);
    try {
      records.set(entry.path, { data: JSON.parse(value.toString('utf8')),
        descriptor: { path: entry.path, gitBlob: entry.blob, bytes: value.length,
          sha256: createHash('sha256').update(value).digest('hex') } });
    } catch (error) { records.set(entry.path, { error: errorView(error) }); }
  }
  return records;
}
function required(records, path) {
  const value = records.get(path);
  if (!value || value.error) throw Object.assign(new Error(value?.error?.message ?? 'Missing original source: ' + path),
    { code: value?.error?.code ?? 'PRODUCT_SOURCE_MISSING' });
  return value;
}

/** Keep the native descriptor shape and resolve versions from the exact original package manifests. */
export function resolveProductRuntimeRequirements(source, spec) {
  const featurePeers = clone(spec.featurePeers ?? {}), runtimePackageManifests = clone(spec.runtimePackageManifests ?? {});
  const treePaths = new Set(source.tree.map(item => item.path));
  const lockPaths = path => {
    const directory = path.slice(0, path.lastIndexOf('/') + 1);
    return ['npm-shrinkwrap.json', 'package-lock.json'].map(name => directory + name).filter(path => treePaths.has(path));
  };
  const records = readJson(source, [...Object.values(runtimePackageManifests),
    ...Object.values(runtimePackageManifests).flatMap(lockPaths)]);
  const manifests = {}, resolvedManifestPeers = {}, dependencyLocks = {}, errors = [];
  for (const group of ['native', ...Object.keys(featurePeers)]) {
    const peers = group === 'native' ? spec.nativePeers ?? {} : featurePeers[group];
    dependencyLocks[group] = { status: 'declared', declared: Object.fromEntries(
      Object.entries(peers).map(([name, definition]) => [name, definition.version])) };
  }
  for (const [group, path] of Object.entries(runtimePackageManifests)) {
    try {
      const record = required(records, path), dependencies = record.data?.dependencies;
      if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies) ||
        !Object.keys(dependencies).length || Object.entries(dependencies).some(([name, version]) => !name || typeof version !== 'string'))
        throw new TypeError('Original runtime package manifest has no valid dependencies: ' + path);
      resolvedManifestPeers[group] = Object.fromEntries(Object.entries(dependencies).map(([name, version]) =>
        [name, { ...(spec.featurePeers?.[group]?.[name] ?? {}), version, probe: spec.featurePeers?.[group]?.[name]?.probe ?? name }]));
      manifests[group] = record.descriptor;
      const lockPath = lockPaths(path)[0];
      if (lockPath) {
        try {
          const originalLock = required(records, lockPath);
          dependencyLocks[group] = { ...inspectRuntimeDependencyLock(record.data, originalLock.data),
            declared: dependencies, source: originalLock.descriptor };
        } catch (error) {
          dependencyLocks[group] = { status: 'unavailable', declared: dependencies, path: lockPath, error: errorView(error) };
        }
      } else dependencyLocks[group] = { status: 'declared', declared: dependencies };
    } catch (error) { errors.push({ feature: group, path, ...errorView(error) }); }
  }
  return { nativePeers: clone(spec.nativePeers ?? {}), featurePeers, runtimePackageManifests,
    featureNames: [...new Set([...Object.keys(featurePeers), ...Object.keys(runtimePackageManifests)])].sort(),
    resolvedManifestPeers, manifests, dependencyLocks, errors };
}

/** Enrich existing records; the original recipe availability and presentation fields are preserved. */
export function enrichProductRequirements(source, catalog) {
  const paths = source.tree.map(item => item.path), contributions = contributionPaths(paths);
  const records = readJson(source, [distributionPath, ...contributions,
    ...catalog.products.map(product => product.path).filter(Boolean)]);
  const products = catalog.products.map(product => {
    if (!product.available) return product;
    try {
      const recipe = product.path ? validateSourceSelection(required(records, product.path).data, product.path) : undefined;
      const selected = recipe ? selectedContributionPaths(contributions, recipe) : contributions;
      const distribution = composeDistribution({ base: required(records, distributionPath).data,
        contributions: selected.map(path => ({ path, data: required(records, path).data })), selection: recipe });
      return { ...product, ...describeProductRequirements(distribution) };
    } catch (error) { return { ...product, capabilityError: errorView(error) }; }
  });
  return { ...catalog, products, capabilities: productRequirementIndex(products) };
}

/** Use the same original catalog implementation as the Runtime workspace. */
export async function loadProductRequirements({ repository, ref = 'HEAD', offline = true } = {}) {
  const { sourceBuildCatalog } = await import('../runtime-workspace/source-build-workspace.mjs');
  return sourceBuildCatalog({ repository, ref, offline });
}
