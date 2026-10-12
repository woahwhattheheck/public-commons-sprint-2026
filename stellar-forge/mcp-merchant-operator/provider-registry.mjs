// MIT. Compose source-owned MCP declarations; MerchantProviderOwners keeps runtime ownership.
import { readDistributionSpecification } from '../../stellar/scf-starforge-20261009/distribution/specification.mjs';
import { readRegisteredSourceModules } from '../../stellar/scf-starforge-20261009/distribution/source-providers.mjs';
import { defineMerchantProvider } from './provider-contract.mjs';

function fail(message) {
  throw Object.assign(new TypeError(message), { code: 'MERCHANT_PROVIDER_REGISTRATION_CONFLICT' });
}
function orderedDependencies(providers, field) {
  const complete = new Set(), active = [], ordered = [];
  function visit(name) {
    if (complete.has(name)) return;
    if (!Object.hasOwn(providers, name)) fail('Unknown ' + field + ' dependency: ' + name);
    if (active.includes(name)) fail('Cyclic ' + field + ' ownership: ' + [...active, name].join(' -> '));
    active.push(name);
    const provider = providers[name];
    const dependencies = field === 'configuration' ? provider.configuration?.dependencies ?? [] : provider.dependencies;
    for (const dependency of dependencies) visit(dependency);
    active.pop(); complete.add(name); ordered.push(provider);
  }
  for (const name of Object.keys(providers)) visit(name);
  return Object.freeze(ordered);
}
/** Load metadata only; tool listing never constructs a source service or driver. */
export async function readMerchantProviders(options = {}) {
  const distribution = await readDistributionSpecification(options);
  const loaded = await readRegisteredSourceModules(distribution, 'merchantProviders');
  if (!loaded.length) throw Object.assign(new TypeError('Select the complete source with its merchantProviders contributions.'),
    { code: 'MERCHANT_PROVIDERS_MISSING' });
  const entries = loaded.map(entry => {
    const provider = defineMerchantProvider(entry.module.default);
    if (provider.id !== entry.id) fail('Merchant provider ID differs from its original declaration: ' + entry.id);
    return { provider, source: entry.source };
  }).sort((a, b) => a.provider.order - b.provider.order || a.provider.id.localeCompare(b.provider.id));
  const providers = Object.create(null), inputs = new Map(), keys = new Map();
  for (const { provider } of entries) {
    if (Object.hasOwn(providers, provider.family)) fail('Duplicate merchant family: ' + provider.family);
    providers[provider.family] = provider;
    if (provider.configKey !== null) {
      if (keys.has(provider.configKey)) fail('Configuration key ' + provider.configKey + ' belongs to both ' +
        keys.get(provider.configKey) + ' and ' + provider.id);
      keys.set(provider.configKey, provider.id);
    }
    if (provider.configuration) {
      const input = provider.configuration.input;
      if (inputs.has(input)) fail('Host configuration input ' + input + ' belongs to both ' + inputs.get(input) + ' and ' + provider.id);
      inputs.set(input, provider.id);
    }
  }
  orderedDependencies(providers, 'runtime');
  const configurationOrder = orderedDependencies(providers, 'configuration');
  const catalogOrder = Object.freeze(entries.map(entry => entry.provider).sort((a, b) =>
    a.catalogOrder - b.catalogOrder || a.id.localeCompare(b.id)));
  const sources = Object.freeze(entries.map(({ provider, source }) => Object.freeze({ ...source,
    family: provider.family, title: provider.title, order: provider.order, catalogOrder: provider.catalogOrder,
    configKey: provider.configKey, configurationInput: provider.configuration?.input ?? null,
    maxRequestBytes: provider.maxRequestBytes, concurrency: provider.concurrency, shutdown: provider.shutdown,
    dependencies: provider.dependencies, concurrentTools: provider.concurrentTools,
    initialize: typeof provider.initialize === 'function' })));
  return Object.freeze({ schema: 'stellar-forge.merchant-provider-registry.v1',
    sourceRoot: distribution.sourceRoot, sourceCommit: distribution.manifest?.sourceCommit ?? null,
    providers: Object.freeze(providers), catalogOrder, configurationOrder,
    configurationInputs: Object.freeze([...inputs.keys()]), sources,
    forId(id) {
      const entry = entries.find(value => value.provider.id === id);
      if (!entry) throw Object.assign(new RangeError('Unknown merchant provider: ' + id), { code: 'MERCHANT_PROVIDER_NOT_FOUND' });
      return entry.provider;
    } });
}
