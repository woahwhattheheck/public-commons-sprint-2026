// MIT. Deterministic catalog projection shared by Node and the browser.
export const CATALOG_SCHEMA = 'stellar-forge.operator-discovery.v1';
export const SEARCH_SCHEMA = 'stellar-forge.operator-discovery-search.v1';
export const KINDS = Object.freeze(['command', 'source', 'feature', 'export', 'application', 'merchant']);
const sorted = values => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en'));
const clone = value => JSON.parse(JSON.stringify(value));
const normalized = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('en');
const flat = value => typeof value === 'string' ? value :
  Array.isArray(value) ? value.map(flat).join(' ') :
  value && typeof value === 'object' ? Object.entries(value).map(([key, item]) => key + ' ' + flat(item)).join(' ') : '';
const fail = message => { throw new TypeError(message); };

/** Project the effective maintained specification; provider modules are never evaluated. */
export function buildCommandCatalog(distribution, { featurePackages = {}, capturedAt = null } = {}) {
  const { spec, origins, sources } = distribution;
  if (!spec?.commands || !origins?.commands || !Array.isArray(sources))
    fail('Expected the maintained distribution specification and source ownership.');
  const byPath = new Map(sources.map(source => [source.path, source]));
  const owners = (field, name) => sorted((origins[field]?.[name] ?? []).map(path => byPath.get(path)?.id).filter(Boolean));
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const runtimeNames = sorted([...Object.keys(spec.featurePeers ?? {}), ...Object.keys(spec.runtimePackageManifests ?? {})]);
  const features = runtimeNames.map(name => {
    const packagePath = spec.runtimePackageManifests?.[name] ?? null;
    const packageData = featurePackages[name];
    const direct = spec.featurePeers?.[name] ?? {};
    const manifestOwners = owners('runtimePackageManifests', name);
    const directOwners = sorted(Object.values(origins.featurePeers?.[name] ?? {}).flat().map(path => byPath.get(path)?.id).filter(Boolean));
    const definitions = packageData?.dependencies
      ? Object.fromEntries(Object.entries(packageData.dependencies).map(([dependency, version]) =>
        [dependency, { version, probe: direct[dependency]?.probe ?? dependency }]))
      : direct;
    return {
      id: 'feature:' + name, kind: 'feature', name,
      description: 'Declared runtime group ' + name,
      sourceIds: sorted([...manifestOwners, ...directOwners]), featureIds: [name],
      packagePath, packageRead: packagePath ? packageData?.error ? 'unavailable' : packageData?.dependencies ? 'read' : 'not-read' : 'direct',
      dependencies: Object.entries(definitions).sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([dependency, definition]) => ({ name: dependency, ...clone(definition) })),
      ...(packageData?.error ? { error: packageData.error } : {}),
    };
  });
  if (Object.keys(spec.nativePeers ?? {}).length) features.unshift({
    id: 'feature:native', kind: 'feature', name: 'native',
    description: 'Declared native payment dependencies',
    sourceIds: sorted(Object.keys(spec.nativePeers).flatMap(name => owners('nativePeers', name))),
    featureIds: ['native'], packagePath: null, packageRead: 'direct',
    dependencies: Object.entries(spec.nativePeers).sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([name, definition]) => ({ name, ...clone(definition) })),
  });
  const relatedFeatures = ids => features.filter(feature =>
    feature.sourceIds.some(id => ids.includes(id))).map(feature => feature.name);
  const summary = (description, ids, fallback) => description || ids
    .filter(id => id !== 'base').map(id => sourceById.get(id)?.description).filter(Boolean).join('; ') || fallback;
  const entries = Object.entries(spec.commands).sort(([a], [b]) => a.localeCompare(b, 'en'));
  const aliases = new Map();
  for (const [name, entry] of entries) aliases.set(entry, [...(aliases.get(entry) ?? []), name]);
  const commands = entries.map(([name, entry]) => {
    const sourceIds = owners('commands', name);
    return { id: 'command:' + name, kind: 'command', name, entry,
      description: summary(spec.commandDescriptions?.[name], sourceIds, 'Maintained merchant toolkit command'),
      sourceIds, featureIds: relatedFeatures(sourceIds), aliases: aliases.get(entry).filter(alias => alias !== name),
      helpArgv: ['starforge', name, '--help'] };
  });
  const exported = Object.entries(spec.exports ?? {}).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, target]) => {
    const sourceIds = owners('exports', name);
    return { id: 'export:' + name, kind: 'export', name,
      description: summary(null, sourceIds, 'Declared application package export'),
      sourceIds, featureIds: relatedFeatures(sourceIds), target: clone(target) };
  });
  const providers = [['application', 'applicationProviders'], ['merchant', 'merchantProviders']].flatMap(([kind, field]) =>
    Object.entries(spec[field] ?? {}).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, entry]) => {
      const sourceIds = owners(field, name);
      return { id: kind + ':' + name, kind, name, entry,
        description: summary(null, sourceIds, kind === 'application' ? 'Applications provider' : 'Merchant MCP provider'),
        sourceIds, featureIds: relatedFeatures(sourceIds) };
    }));
  const sourceItems = sources.map(source => {
    const sourceIds = [source.id];
    return { id: 'source:' + source.id, kind: 'source', name: source.id, path: source.path,
      description: source.description, sourceIds, featureIds: relatedFeatures(sourceIds),
      commands: commands.filter(item => item.sourceIds.includes(source.id)).map(item => item.name),
      exports: exported.filter(item => item.sourceIds.includes(source.id)).map(item => item.name),
      applications: providers.filter(item => item.kind === 'application' && item.sourceIds.includes(source.id)).map(item => item.name),
      merchantProviders: providers.filter(item => item.kind === 'merchant' && item.sourceIds.includes(source.id)).map(item => item.name),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const items = [...commands, ...sourceItems, ...features, ...exported, ...providers];
  return {
    schema: CATALOG_SCHEMA,
    package: { name: spec.name, version: distribution.manifest?.packageVersion ?? 'source-checkout',
      sourceCommit: distribution.manifest?.sourceCommit ?? null,
      sourceSelection: distribution.selection ? { id: distribution.selection.id, title: distribution.selection.title } : null },
    capturedAt,
    counts: Object.fromEntries(KINDS.map(kind => [kind, items.filter(item => item.kind === kind).length])),
    sources: sourceItems.map(({ name, description, path }) => ({ id: name, description, path })),
    featureNames: features.map(item => item.name).sort(),
    items,
  };
}

export function tokenizeQuery(query = '') {
  if (typeof query !== 'string' || query.length > 512 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(query))
    fail('Search must be text of at most 512 characters.');
  const tokens = [];
  let current = '', quoted = false;
  for (const character of query.trim()) {
    if (character === '"') { quoted = !quoted; continue; }
    if (/\s/u.test(character) && !quoted) {
      if (current) { tokens.push(normalized(current)); current = ''; }
    } else current += character;
  }
  if (quoted) fail('Close the quoted search phrase.');
  if (current) tokens.push(normalized(current));
  return sorted(tokens);
}

function select(catalog, { query = '', kind = 'all', source = '', feature = '' } = {}) {
  if (catalog?.schema !== CATALOG_SCHEMA || !Array.isArray(catalog.items))
    fail('Expected an operator command catalog.');
  if (kind !== 'all' && !KINDS.includes(kind)) fail('Unknown catalog kind: ' + kind);
  if (source && !catalog.sources.some(item => item.id === source)) fail('Unknown registration source: ' + source);
  if (feature && !catalog.featureNames.includes(feature)) fail('Unknown runtime group: ' + feature);
  const tokens = tokenizeQuery(query);
  const filtered = catalog.items.flatMap(item => {
    if (kind !== 'all' && item.kind !== kind || source && !item.sourceIds.includes(source) ||
        feature && !item.featureIds.includes(feature)) return [];
    const name = normalized(item.name), description = normalized(item.description);
    const text = normalized(flat(item));
    if (!tokens.every(token => text.includes(token))) return [];
    const score = tokens.reduce((value, token) => value +
      (name === token ? 1000 : name.startsWith(token) ? 300 : name.includes(token) ? 100 : description.includes(token) ? 20 : 1), 0);
    return [{ item, score }];
  });
  return filtered.sort((a, b) => b.score - a.score ||
    KINDS.indexOf(a.item.kind) - KINDS.indexOf(b.item.kind) || a.item.name.localeCompare(b.item.name, 'en'))
    .map(({ item }) => item);
}

function positiveInteger(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    fail(name + ' must be an integer from 1 to ' + maximum + '.');
  return value;
}

/** Filters are ANDed; complete match counts and pagination always remain explicit. */
export function searchCommandCatalog(catalog, options = {}) {
  const { query = '', kind = 'all', source = '', feature = '', page = 1, pageSize = 50 } = options;
  positiveInteger(page, 'page', Number.MAX_SAFE_INTEGER);
  positiveInteger(pageSize, 'pageSize', 500);
  const matching = select(catalog, { query, kind, source, feature });
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * pageSize;
  return { schema: SEARCH_SCHEMA, package: catalog.package, capturedAt: catalog.capturedAt,
    query, filters: { kind, source, feature }, total: matching.length,
    counts: Object.fromEntries(KINDS.map(type => [type, matching.filter(item => item.kind === type).length])),
    page: currentPage, pageSize, pages, items: matching.slice(start, start + pageSize) };
}

/** Export every match, independently of the current browser or terminal page. */
export function exportCommandCatalog(catalog, options = {}) {
  const { query = '', kind = 'all', source = '', feature = '' } = options;
  const items = select(catalog, { query, kind, source, feature });
  return { schema: SEARCH_SCHEMA, package: catalog.package, capturedAt: catalog.capturedAt,
    query, filters: { kind, source, feature }, total: items.length, complete: true, items };
}

export function findCatalogItem(catalog, id) {
  const item = catalog?.items?.find(candidate => candidate.id === id);
  if (!item) fail('Unknown catalog item: ' + id);
  return item;
}

export function renderCatalogText(result) {
  const lines = [result.package.name + ' · ' + result.package.version,
    result.total + ' matches' + (result.page ? ' · page ' + result.page + '/' + result.pages : ''), ''];
  for (const item of result.items) {
    lines.push(item.kind.toUpperCase() + '  ' + item.name,
      '  ' + item.description,
      ...(item.helpArgv ? ['  ' + item.helpArgv.join(' ')] : []),
      '  Sources: ' + item.sourceIds.join(', '), '');
  }
  return lines.join('\n');
}
