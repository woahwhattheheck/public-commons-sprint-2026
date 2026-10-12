// MIT. Read declared package metadata without importing provider or runtime modules.
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { readDistributionSpecification } from '../specification.mjs';
import { buildCommandCatalog } from './catalog.mjs';

async function featurePackage(distribution, path) {
  const root = distribution.sourceRoot;
  const filename = await realpath(resolve(root, path));
  const local = relative(root, filename);
  if (!local || isAbsolute(local) || local === '..' || local.startsWith('../') || local.startsWith('..\\'))
    throw new TypeError('Runtime package manifest leaves its selected source: ' + path);
  const info = await stat(filename);
  if (!info.isFile() || info.size > 1024 * 1024)
    throw new TypeError('Runtime package manifest must be a regular file up to 1 MiB: ' + path);
  const bytes = await readFile(filename);
  if (bytes.length > 1024 * 1024) throw new TypeError('Runtime package manifest exceeds 1 MiB: ' + path);
  if (distribution.manifest) {
    const retained = distribution.manifest.files.find(file => file.path === path);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (!retained || retained.bytes !== bytes.length || retained.sha256 !== digest)
      throw new TypeError('Runtime package manifest differs from the installed source: ' + path);
  }
  const value = JSON.parse(bytes.toString('utf8'));
  if (!value.dependencies || typeof value.dependencies !== 'object' || Array.isArray(value.dependencies) ||
      !Object.keys(value.dependencies).length ||
      Object.entries(value.dependencies).some(([name, version]) => !name || typeof version !== 'string'))
    throw new TypeError('Runtime package manifest has no valid declared dependencies: ' + path);
  return { dependencies: value.dependencies };
}

/** Accept a pre-read specification so caller and catalog use exactly the same selection. */
export async function loadCommandCatalog({ sourceRoot, selection, distribution } = {}) {
  const selected = distribution ?? await readDistributionSpecification({ sourceRoot, selection });
  const featurePackages = {};
  await Promise.all(Object.entries(selected.spec.runtimePackageManifests ?? {}).map(async ([name, path]) => {
    try { featurePackages[name] = await featurePackage(selected, path); }
    catch (error) { featurePackages[name] = { error: error.message }; }
  }));
  return buildCommandCatalog(selected, { featurePackages, capturedAt: new Date().toISOString() });
}
