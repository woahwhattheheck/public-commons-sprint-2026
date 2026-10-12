// MIT. Compatibility catalog entry point over the original Applications lifecycle.
// Managed workers import applications-core.mjs so a catalog read is explicit.
export * from './applications-core.mjs';
import { defaultApplicationProviders } from './application-providers.mjs';
const providers = await defaultApplicationProviders();
export const APPLICATION_CATALOG = providers.catalog;
