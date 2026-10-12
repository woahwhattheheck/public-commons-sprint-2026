// MIT. The current distribution owns declarations; original runtimes remain lazy.
import { readMerchantProviders } from './provider-registry.mjs';
export { readMerchantProviders } from './provider-registry.mjs';

export const MERCHANT_PROVIDER_REGISTRY = await readMerchantProviders();
export const MERCHANT_PROVIDERS = MERCHANT_PROVIDER_REGISTRY.providers;

export function merchantProviderConfigured(key, config) {
  const provider = MERCHANT_PROVIDERS[key];
  if (!provider) throw new RangeError('Unknown merchant provider: ' + key);
  return provider.configKey === null || config[provider.configKey] !== null && config[provider.configKey] !== undefined;
}
export function merchantRequestBytes(config) {
  return Math.max(128 * 1024, ...Object.entries(MERCHANT_PROVIDERS)
    .filter(([key]) => merchantProviderConfigured(key, config)).map(([, provider]) => provider.maxRequestBytes));
}
export async function configureMerchantProviders(raw, config, { base, hostPath }) {
  for (const provider of MERCHANT_PROVIDER_REGISTRY.configurationOrder) {
    if (provider.configKey === null) continue;
    const definition = provider.configuration;
    const value = raw[definition.input];
    config[provider.configKey] = value === undefined ? null :
      await definition.read(value, Object.freeze({ base, config, hostPath }));
  }
  return config;
}
export function merchantPrivateExports(config) {
  return Object.entries(MERCHANT_PROVIDERS).some(([key, provider]) =>
    provider.configuration?.privateExports && merchantProviderConfigured(key, config));
}
export async function initializeMerchantProvider(id, options) {
  const provider = MERCHANT_PROVIDER_REGISTRY.forId(id);
  if (typeof provider.initialize !== 'function')
    throw Object.assign(new TypeError('This provider uses the common merchant configuration: ' + id),
      { code: 'MERCHANT_PROVIDER_SETUP_UNAVAILABLE' });
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw Object.assign(new TypeError('Expected original host setup options.'), { code: 'CONFIGURATION_ERROR' });
  return provider.initialize(options);
}
