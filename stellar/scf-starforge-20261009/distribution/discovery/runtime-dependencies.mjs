// MIT. Inspect committed npm production locks without installing or resolving packages.
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sortedEntries = value => Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b, 'en'));
const sameMap = (left, right) => JSON.stringify(sortedEntries(left)) === JSON.stringify(sortedEntries(right));
const names = value => Object.keys(value ?? {});
const packageName = path => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);

/**
 * A committed lock describes source dependency closure. The installer remains responsible
 * for platform selection, downloads, integrity, native builds and the resulting installation.
 */
export function inspectRuntimeDependencyLock(manifest, lock) {
  if (![2, 3].includes(lock?.lockfileVersion) || !plain(lock.packages) || !plain(lock.packages['']))
    return { status: 'unsupported', reason: 'A committed npm lockfileVersion 2 or 3 with package records is required.' };
  if (!sameMap(manifest.dependencies, lock.packages[''].dependencies) ||
      !sameMap(manifest.optionalDependencies, lock.packages[''].optionalDependencies))
    return { status: 'mismatched', reason: 'The committed lock root differs from the original runtime manifest.' };
  const packages = lock.packages, pending = [], visited = new Set(), instances = [], unresolved = [], optionalOmissions = [];
  const safeName = name => typeof name === 'string' && /^(?:@[^/\s]+\/)?[^/\s]+$/.test(name) && !/[\\\u0000-\u001f\u007f]/.test(name);
  function resolve(from, name) {
    if (!safeName(name)) return null;
    const parts = from ? from.split('/') : [];
    for (let length = parts.length; length >= 0; length--) {
      if (parts[length - 1] === 'node_modules') continue;
      const candidate = [...parts.slice(0, length), 'node_modules', name].join('/');
      if (Object.hasOwn(packages, candidate)) return candidate;
    }
    return null;
  }
  function enqueue(from, dependencies, kind, optionalNames = new Set()) {
    for (const [name, requested] of sortedEntries(dependencies)) {
      const location = resolve(from, name), edge = { from: from || '.', name, requested, kind };
      if (!location) (kind === 'optional' || optionalNames.has(name) ? optionalOmissions : unresolved).push(edge);
      else pending.push({ location, edge });
    }
  }
  const rootOptional = new Set(names(manifest.optionalDependencies));
  enqueue('', Object.fromEntries(sortedEntries(manifest.dependencies).filter(([name]) => !rootOptional.has(name))), 'direct');
  enqueue('', manifest.optionalDependencies, 'optional');
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const { location, edge } = pending[cursor];
    if (visited.has(location)) continue;
    visited.add(location);
    let record = packages[location], linkTarget = null;
    if (!plain(record)) { unresolved.push({ ...edge, location, reason: 'Invalid committed package record' }); continue; }
    if (record.link) {
      linkTarget = record.resolved;
      if (typeof linkTarget !== 'string' || !Object.hasOwn(packages, linkTarget) || !plain(packages[linkTarget])) {
        unresolved.push({ ...edge, location, reason: 'Committed workspace link target is missing' }); continue;
      }
      record = packages[linkTarget];
    }
    if (typeof record.version !== 'string' || !record.version) {
      unresolved.push({ ...edge, location, reason: 'Committed package version is missing' }); continue;
    }
    const name = typeof record.name === 'string' ? record.name : packageName(location);
    instances.push({ location, name, version: record.version, direct: edge.from === '.',
      ...(linkTarget ? { linkTarget } : {}),
      ...(typeof record.integrity === 'string' ? { integrity: record.integrity } : {}),
      ...(record.optional ? { optional: true } : {}),
      ...(record.os ? { os: record.os } : {}), ...(record.cpu ? { cpu: record.cpu } : {}),
    });
    const at = linkTarget ?? location, optional = new Set(names(record.optionalDependencies));
    enqueue(at, Object.fromEntries(sortedEntries(record.dependencies).filter(([dependency]) => !optional.has(dependency))), 'dependency');
    enqueue(at, record.optionalDependencies, 'optional');
    const peerOptional = new Set(sortedEntries(record.peerDependenciesMeta).filter(([, meta]) => meta?.optional).map(([dependency]) => dependency));
    enqueue(at, record.peerDependencies, 'peer', peerOptional);
  }
  instances.sort((a, b) => a.location.localeCompare(b.location, 'en'));
  const resolved = new Map();
  for (const item of instances) {
    const id = item.name + '@' + item.version, value = resolved.get(id) ?? { name: item.name, version: item.version, locations: [] };
    value.locations.push(item.location); resolved.set(id, value);
  }
  return { status: unresolved.length ? 'incomplete' : 'resolved', scope: 'committed-production-lock',
    lockfileVersion: lock.lockfileVersion, instances, packages: [...resolved.values()],
    counts: { instances: instances.length, packages: resolved.size,
      directInstances: instances.filter(item => item.direct).length,
      transitiveInstances: instances.filter(item => !item.direct).length },
    unresolved, optionalOmissions };
}
