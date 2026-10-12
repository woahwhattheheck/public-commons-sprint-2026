// MIT. Match exact required capabilities against original source product recipes.
export const PRODUCT_REQUIREMENTS_SCHEMA = 'stellar-forge.product-requirements.v1';
export const REQUIREMENT_KINDS = Object.freeze(['command', 'application', 'merchant', 'export', 'feature', 'source']);
export const REQUIREMENT_SORTS = Object.freeze(['source', 'coverage', 'runtime-groups', 'commands']);
const sorted = values => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en'));
const keys = value => Object.keys(value ?? {});
const need = (condition, message) => { if (!condition) throw new TypeError(message); };

export function normalizeProductRequirements(requirements = []) {
  need(Array.isArray(requirements) && requirements.length <= 128, 'Select at most 128 capability requirements.');
  for (const id of requirements) {
    need(typeof id === 'string' && id.length <= 1100 && !/[\u0000-\u001f\u007f]/.test(id),
      'Expected a capability such as command:buyer-runbook.');
    const at = id.indexOf(':');
    need(at > 0 && REQUIREMENT_KINDS.includes(id.slice(0, at)) && id.slice(at + 1).length > 0,
      'Unknown capability requirement: ' + id);
  }
  return sorted(requirements);
}

/** The original composer supplies every selected registration and its source owner. */
export function describeProductRequirements(distribution) {
  const { spec, sources, origins } = distribution;
  need(spec?.commands && Array.isArray(sources), 'Expected original composed product declarations.');
  const features = sorted([...keys(spec.featurePeers), ...keys(spec.runtimePackageManifests),
    ...(keys(spec.nativePeers).length ? ['native'] : [])]);
  const requirements = sorted([
    ...keys(spec.commands).map(name => 'command:' + name),
    ...keys(spec.applicationProviders).map(name => 'application:' + name),
    ...keys(spec.merchantProviders).map(name => 'merchant:' + name),
    ...keys(spec.exports).map(name => 'export:' + name),
    ...features.map(name => 'feature:' + name),
    ...sources.map(source => 'source:' + source.id),
  ]);
  const byPath = new Map(sources.map(source => [source.path, source]));
  const owner = paths => sorted(paths).map(path => byPath.get(path))
    .filter(Boolean).map(({ id, path }) => ({ id, path, kind: id === 'base' ? 'base' : 'contribution' }));
  const fieldFor = { command: 'commands', application: 'applicationProviders', merchant: 'merchantProviders', export: 'exports' };
  const capabilityDeclarations = requirements.map(id => {
    const at = id.indexOf(':'), kind = id.slice(0, at), name = id.slice(at + 1);
    const paths = kind === 'source' ? sources.filter(source => source.id === name).map(source => source.path) :
      kind === 'feature' ? name === 'native' ? Object.values(origins?.nativePeers ?? {}).flat() :
        [...(origins?.runtimePackageManifests?.[name] ?? []), ...Object.values(origins?.featurePeers?.[name] ?? {}).flat()] :
        origins?.[fieldFor[kind]]?.[name] ?? [];
    return { id, kind, name, provision: 'registration', sources: owner(paths) };
  });
  return { requirements, capabilityDeclarations, capabilityCounts: { commands: keys(spec.commands).length,
    applications: keys(spec.applicationProviders).length, merchantProviders: keys(spec.merchantProviders).length,
    exports: keys(spec.exports).length, runtimeGroups: features.filter(name => name !== 'native').length,
    components: new Set(spec.components ?? []).size, sources: sources.length } };
}
export function productRequirementIndex(products) {
  const found = new Map();
  for (const product of products) {
    if (!product.available || product.capabilityError) continue;
    for (const id of product.requirements ?? []) {
      const at = id.indexOf(':'), current = found.get(id) ?? { id, kind: id.slice(0, at), name: id.slice(at + 1), products: 0 };
      current.products++; found.set(id, current);
    }
  }
  return [...found.values()].sort((a, b) => a.kind.localeCompare(b.kind, 'en') || a.name.localeCompare(b.name, 'en'));
}

/** Feed the existing catalog search result here; its text ranking and product records remain intact. */
export function matchProductRequirements(products, { requirements = [], match = 'all', sort = 'source' } = {}) {
  need(Array.isArray(products), 'Expected original product catalog entries.');
  requirements = normalizeProductRequirements(requirements);
  need(['all', 'any'].includes(match), 'Choose all or any requirements.');
  need(REQUIREMENT_SORTS.includes(sort), 'Unknown requirement order: ' + sort);
  const rows = products.flatMap((product, position) => {
    const available = new Set(product.requirements ?? []);
    const covered = requirements.filter(id => available.has(id)), missing = requirements.filter(id => !available.has(id));
    if (requirements.length && (!product.available || product.capabilityError || !Array.isArray(product.requirements) ||
      (match === 'all' ? missing.length > 0 : covered.length === 0))) return [];
    return [{ product, position, covered, missing }];
  });
  if (sort !== 'source') rows.sort((a, b) =>
    b.covered.length - a.covered.length ||
    (sort === 'runtime-groups' ? (a.product.capabilityCounts?.runtimeGroups ?? Infinity) - (b.product.capabilityCounts?.runtimeGroups ?? Infinity) :
      sort === 'commands' ? (a.product.capabilityCounts?.commands ?? Infinity) - (b.product.capabilityCounts?.commands ?? Infinity) : 0) ||
    a.position - b.position);
  return {
    schema: PRODUCT_REQUIREMENTS_SCHEMA, requirements, match, sort, total: rows.length,
    products: rows.map(({ product, covered, missing }) => ({ ...product,
      requirementMatch: { covered, missing, complete: missing.length === 0,
        declarations: (product.capabilityDeclarations ?? []).filter(value => covered.includes(value.id)) } })),
    unread: products.filter(product => product.capabilityError).map(product =>
      ({ id: product.id, title: product.title, error: product.capabilityError })),
  };
}

export function exportRequirementPlan(catalog, options = {}) {
  const result = matchProductRequirements(catalog.products, options);
  return { ...result, repository: catalog.repository, sourceCommit: catalog.sourceCommit,
    offline: catalog.offline, allMatchesExported: true,
    products: result.products.map(product => ({ ...product,
      ...(product.available && !product.capabilityError && product.requirementMatch.complete ? {
        reviewRequest: productReviewRequest(catalog, product.id, { requirements: result.requirements }),
      } : {}),
    })) };
}

/** This JSON is accepted directly by the original runtime-workspace source-build-review command. */
export function productReviewRequest(catalog, id, { python = 'python3', requirements = [] } = {}) {
  const product = catalog.products.find(value => value.id === id);
  need(product?.available && !product.capabilityError, 'Choose a product with readable original declarations.');
  requirements = normalizeProductRequirements(requirements);
  const available = new Set(product.requirements ?? []);
  const missing = requirements.filter(value => !available.has(value));
  need(missing.length === 0, 'This product is missing requested capabilities: ' + missing.join(', '));
  need(typeof catalog.offline === 'boolean', 'Preserve the original Git reader mode.');
  need(typeof catalog.repository === 'string' && catalog.repository.startsWith('/') &&
    /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(catalog.sourceCommit ?? ''),
  'Load products from an existing Git repository to prepare a committed build request.');
  need(typeof python === 'string' && python.length > 0 && python.length <= 1024 &&
    !/[\u0000-\u001f\u007f]/.test(python) &&
    (python.includes('/') ? python.startsWith('/') : /^[A-Za-z0-9_.+-]+$/.test(python)),
  'Select the original Python interpreter.');
  return { repository: catalog.repository, ref: catalog.sourceCommit, selection: product.id,
    offline: catalog.offline, python };
}
