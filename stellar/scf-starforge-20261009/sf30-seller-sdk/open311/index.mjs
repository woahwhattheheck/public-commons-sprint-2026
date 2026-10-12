// MIT. Protocol and domain entrypoint; workspace/server remain explicit.
export { createClient, describeRequests, sourceDateTime, Open311Error } from './client.mjs';
export { canonicalJson, requestKey, normalizeRequests, normalizeServices,
  compareCaptures, queryRequests } from './domain.mjs';

export { COLLECTION_SCHEMA, normalizeCollectionPlan, collectionNodeQuery,
  splitCollectionWindow, projectCollection, queryCollection, compareCollections } from './collection-domain.mjs';
