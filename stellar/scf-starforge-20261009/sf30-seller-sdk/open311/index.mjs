// MIT. Protocol and domain entrypoint; workspace/server remain explicit.
export { createClient, Open311Error } from './client.mjs';
export { canonicalJson, requestKey, normalizeRequests, normalizeServices,
  compareCaptures, queryRequests } from './domain.mjs';
