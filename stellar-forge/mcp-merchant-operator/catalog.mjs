import { merchantProviderConfigured } from './providers.mjs';
import { stacWorkspaceTools } from './catalog/stac-workspace.mjs';
import { fredWorkspaceTools } from './catalog/fred-workspace.mjs';
import { apiPassWorkspaceTools } from './api-pass-protocol.mjs';
// MIT. Original tool metadata; provider runtimes load only when selected.
import { CLIENT_EXPORT_MANIFEST, CLIENT_EXPORT_FILES } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-export-contracts.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-contracts.mjs';
import { discoveryTools } from './catalog/discovery.mjs';
import { cacheControlTools } from './catalog/controls.mjs';
import { fleetControlTools } from './catalog/fleet.mjs';
import { accountingTools } from './catalog/accounting.mjs';
import { supportTools } from './catalog/support.mjs';
import { receivingTools } from './catalog/receiving.mjs';
import { pythonWorkspaceTools } from './catalog/python-workspace.mjs';
import { graphqlWorkspaceTools } from './catalog/graphql-workspace.mjs';
import { s3WorkspaceTools } from './catalog/s3-workspace.mjs';
import { openSearchWorkspaceTools } from './catalog/opensearch-workspace.mjs';
import { socrataWorkspaceTools } from './catalog/socrata-workspace.mjs';
import { opendatasoftWorkspaceTools } from './catalog/opendatasoft-workspace.mjs';
import { odataWorkspaceTools } from './catalog/odata-workspace.mjs';
import { worldbankWorkspaceTools } from './catalog/worldbank-workspace.mjs';
import { fiscalDataWorkspaceTools } from './catalog/fiscaldata-workspace.mjs';
import { geocodioWorkspaceTools } from './catalog/geocodio-workspace.mjs';
import { censusGeocoderWorkspaceTools } from './catalog/census-geocoder-workspace.mjs';
import { webDavWorkspaceTools } from './catalog/webdav-tools.mjs';
import { edgarWorkspaceTools } from './catalog/sec-edgar-tools.mjs';
import { sheetsWorkspaceTools } from './catalog/sheets-workspace.mjs';
import { nocodbWorkspaceTools } from './catalog/nocodb-workspace.mjs';
import { ckanWorkspaceTools } from './catalog/ckan-workspace.mjs';
import { tenderlyWorkspaceTools } from './catalog/tenderly-workspace.mjs';
import { opencageWorkspaceTools } from './catalog/opencage-workspace.mjs';
import { stellarExpertWorkspaceTools } from './catalog/stellar-expert-workspace.mjs';
import { coingeckoWorkspaceTools } from './catalog/coingecko-workspace.mjs';
import { redisWorkspaceTools } from './catalog/redis-workspace.mjs';
import { usaSpendingWorkspaceTools } from './catalog/usaspending-workspace.mjs';
import { researchWorkspaceTools } from './catalog/research-workspace.mjs';
import { grantsWorkspaceTools } from './catalog/grantsgov-workspace.mjs';
import { sourceWorkspaceTools } from './catalog/source-workspace.mjs';
import { clinicalTrialsWorkspaceTools } from './catalog/clinicaltrials-workspace.mjs';
import { baserowWorkspaceTools } from './catalog/baserow-workspace.mjs';
import { usgsWorkspaceTools } from './catalog/usgs-workspace.mjs';
import { feedsWorkspaceTools } from './catalog/feeds-workspace.mjs';
import { dspaceOperatorTools } from './catalog/dspace-operators.mjs';
import { grantWorkspaceTools } from './catalog/grant-workspace.mjs';
import { grpcWorkspaceTools } from './catalog/grpc-workspace.mjs';
import { datasetLifecycleTools } from './catalog/dataset-lifecycle.mjs';
import { openapiWorkspaceTools } from './catalog/openapi-workspace.mjs';
import { harWorkspaceTools } from './catalog/har-workspace.mjs';
import { n8nWorkspaceTools } from './catalog/n8n-workspace.mjs';
import { paidJobWorkspaceTools } from './catalog/paid-jobs.mjs';
import { publisherTools } from './catalog/publisher.mjs';
import { arcgisWorkspaceTools } from './catalog/arcgis-workspace.mjs';
import { pricingTools } from './catalog/pricing.mjs';
import { woocommerceTools } from './catalog/woocommerce.mjs';
import { cocartWorkspaceTools } from './catalog/cocart-workspace.mjs';
import { mppTools } from './catalog/mpp-console.mjs';
import { buyerExpenseTools } from './catalog/buyer-expenses.mjs';

const idSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const generationSchema = { type: 'integer', minimum: 0 };

const digestSchema = { type: 'string', pattern: '^[0-9a-f]{64}$' };

const textSchema = { type: 'string', minLength: 1, maxLength: 240 };

const instanceSchema = { type: 'string', minLength: 1, maxLength: 64 };

function tool(name, description, properties = {}, required = [], { readOnly = false, destructive = false, idempotent = false, openWorld = false } = {}) {
  return { name, description, annotations: { readOnlyHint: readOnly, destructiveHint: destructive,
    idempotentHint: idempotent, openWorldHint: openWorld },
    inputSchema: { type: 'object', properties, required, additionalProperties: false } };
}

const familyTools = {
  fredWorkspaces: fredWorkspaceTools(tool),
  stacWorkspaces: stacWorkspaceTools(tool),
  apiPassWorkspaces: apiPassWorkspaceTools(tool),
  discovery: discoveryTools(tool),
  cache: cacheControlTools(tool),
  fleet: fleetControlTools(tool),
  accounting: accountingTools(tool),
  support: supportTools(tool),
  receiving: receivingTools(tool),
  pythonWorkspaces: pythonWorkspaceTools(tool),
  graphqlWorkspaces: graphqlWorkspaceTools(tool),
  s3Workspaces: s3WorkspaceTools(tool),
  opensearchWorkspaces: openSearchWorkspaceTools(tool),
  socrataWorkspaces: socrataWorkspaceTools(tool),
  opendatasoftWorkspaces: opendatasoftWorkspaceTools(tool),
  odataWorkspaces: odataWorkspaceTools(tool),
  worldbankWorkspaces: worldbankWorkspaceTools(tool),
  fiscalDataWorkspaces: fiscalDataWorkspaceTools(tool),
  geocodioWorkspaces: geocodioWorkspaceTools(tool),
  censusGeocoderWorkspaces: censusGeocoderWorkspaceTools(tool),
  webdavWorkspaces: webDavWorkspaceTools(tool),
  edgarWorkspaces: edgarWorkspaceTools(tool),
  sheetsWorkspaces: sheetsWorkspaceTools(tool),
  nocodbWorkspaces: nocodbWorkspaceTools(tool),
  ckanWorkspaces: ckanWorkspaceTools(tool),
  tenderlyWorkspaces: tenderlyWorkspaceTools(tool),
  opencageWorkspaces: opencageWorkspaceTools(tool),
  stellarExpertWorkspaces: stellarExpertWorkspaceTools(tool),
  coingeckoWorkspaces: coingeckoWorkspaceTools(tool),
  redisWorkspaces: redisWorkspaceTools(tool),
  usaSpendingWorkspaces: usaSpendingWorkspaceTools(tool),
  researchWorkspaces: researchWorkspaceTools(tool),
  grantsWorkspaces: grantsWorkspaceTools(tool),
  sourceWorkspaces: sourceWorkspaceTools(tool),
  clinicalTrialsWorkspaces: clinicalTrialsWorkspaceTools(tool),
  baserowWorkspaces: baserowWorkspaceTools(tool),
  usgsWorkspaces: usgsWorkspaceTools(tool),
  feedsWorkspaces: feedsWorkspaceTools(tool),
  dspaceOperators: dspaceOperatorTools(tool),
  grantWorkspaces: grantWorkspaceTools,
  grpcWorkspaces: grpcWorkspaceTools(tool),
  dataset: datasetLifecycleTools(tool),
  openapiWorkspaces: openapiWorkspaceTools(tool),
  harWorkspaces: harWorkspaceTools(tool),
  n8nWorkspaces: n8nWorkspaceTools(tool),
  paidJobWorkspaces: paidJobWorkspaceTools(tool),
  publishers: publisherTools(tool),
  arcgisWorkspaces: arcgisWorkspaceTools(tool),
  pricing: pricingTools(tool),
  woocommerce: woocommerceTools(tool),
  cocartWorkspaces: cocartWorkspaceTools(tool),
  mpp: mppTools(tool),
  buyerExpenses: buyerExpenseTools(tool)
};

const MERCHANT_TOOLS = [
  tool('merchant_status', 'Inspect original release selection, retained history, seller readiness and this MCP process ownership. Makes only original loopback health/offer reads.', {}, [], { readOnly: true, idempotent: true }),
  tool('merchant_sources', 'List configured aliases or inspect an original API package, OpenAPI files, Python merchant, SQLite workbench, prepared DuckDB, S3, Stellar RPC, PostgreSQL, MySQL or ClickHouse package: exact source identities, public routes, payment choices and worker configuration. Reads configured local files without credential values, application imports or HTTP calls.', { source: idSchema }, [], { readOnly: true, idempotent: true }),
  tool('merchant_stage', 'Retain a configured source alias as a new immutable original SF82 release: saved API workspace, upstream snapshot, Python application, original DuckDB datasets, S3 objects, Stellar RPC products, one native SQLite database snapshot, or original PostgreSQL/MySQL/ClickHouse named-query merchant. PostgreSQL and ClickHouse configuration is retained while database contents remain live. Does not activate, import application code, start a listener or make a payment.',
    { source: idSchema, id: idSchema, label: textSchema }, ['source', 'id']),
  tool('merchant_inspect', 'Inspect and verify one retained original release including complete terms, application hashes and native/challenge mode.', { id: idSchema }, ['id'], { readOnly: true, idempotent: true }),
  tool('merchant_facilitators', 'List host-configured facilitator aliases for the retained merchant release. Reads the current host configuration without network requests.',
    {}, [], { readOnly: true, idempotent: true }),
  tool('merchant_facilitator_review', 'Review a configured provider against one retained release through the original native SDK. Returns actual supported capabilities and generated payment requirements, including fee sponsorship changes. Retain the review ID before staging.',
    { provider: idSchema, releaseId: idSchema, id: idSchema, label: textSchema }, ['provider', 'releaseId', 'id'], { readOnly: true, openWorld: true }),
  tool('merchant_facilitator_stage', 'Stage the reviewed facilitator with the same original compiled merchant source. Rechecks current capabilities and selection generation. A repeated completed review returns its same retained release; use existing compare, activate and restart afterward.',
    { reviewId: digestSchema }, ['reviewId'], { idempotent: true, openWorld: true }),
  tool('merchant_compare', 'Compare a staged release against the active release or a named retained version. Returns exact payment, route and application changes with the selection generation.',
    { to: idSchema, from: { anyOf: [idSchema, { type: 'null' }] } }, ['to'], { readOnly: true, idempotent: true }),
  tool('merchant_activate', 'Select an inspected immutable release using its exact digest and current selection generation. A running seller keeps its existing version until explicitly restarted.',
    { id: idSchema, expectedDigest: digestSchema, expectedGeneration: generationSchema, reason: textSchema }, ['id', 'expectedDigest', 'expectedGeneration', 'reason']),
  tool('merchant_rollback', 'Select a specific retained release through the original rollback history. Requires its exact digest and current generation; does not restart the seller.',
    { to: idSchema, expectedDigest: digestSchema, expectedGeneration: generationSchema, reason: textSchema }, ['to', 'expectedDigest', 'expectedGeneration', 'reason']),
  tool('merchant_start', 'Start the original SF82/SF30 seller for the selected release on this host, with its host-configured trusted handlers and facilitator. No paid resource is requested.',
    { expectedGeneration: generationSchema, expectedDigest: digestSchema }, ['expectedGeneration', 'expectedDigest'], { openWorld: true }),
  tool('merchant_stop', 'Gracefully stop only the original seller instance owned by this MCP process. Pass the instanceId from merchant_status.',
    { instanceId: instanceSchema }, ['instanceId'], { destructive: true }),
  tool('merchant_restart', 'Gracefully stop this process-owned seller and start the currently selected original release. Checks instance, generation and digest before stopping.',
    { instanceId: instanceSchema, expectedGeneration: generationSchema, expectedDigest: digestSchema }, ['instanceId', 'expectedGeneration', 'expectedDigest'], { destructive: true, openWorld: true }),
  tool('merchant_catalog', 'Read the actual original seller health, complete offers and OpenAPI document for this process-owned instance. Does not request any paid endpoint.',
    { instanceId: instanceSchema }, ['instanceId'], { readOnly: true, idempotent: true }),
  tool('merchant_client_export', 'Export the original JavaScript client, TypeScript declarations and OpenAPI for this running seller into a new named directory under the host-configured customer export root.',
    { instanceId: instanceSchema, id: idSchema }, ['instanceId', 'id']),
  tool('merchant_client_export_list', 'List retained customer exports in the original host-selected directory. Reads completion receipts, with explicit legacy/incomplete entries; full payload inspection remains available through status.',
    { after: idSchema, limit: { type: 'integer', minimum: 1, maximum: 50 } }, [], { readOnly: true, idempotent: true }),
  tool('merchant_client_export_status', 'Inspect the complete original customer export after a lost response or seller shutdown. Verifies saved files and reports a completion receipt, retained legacy files or an incomplete export without running the seller or generated code.',
    { exportId: idSchema, includeOffers: { type: 'boolean' } }, ['exportId'], { readOnly: true, idempotent: true }),
  tool('merchant_client_export_adopt', 'Record the exact inspected five legacy customer files as retained today. Requires their complete files digest, preserves all payloads, and does not invent a historical export time or release identity.',
    { exportId: idSchema, expectedFilesSha256: digestSchema }, ['exportId', 'expectedFilesSha256'], { idempotent: true }),
  tool('merchant_client_export_manifest', 'Read the saved original customer completion receipt and its exact file identity without rereading all payloads. Available after seller or MCP process restart.',
    { exportId: idSchema }, ['exportId'], { readOnly: true, idempotent: true }),
  tool('merchant_client_export_file', 'Read bounded SHA-pinned bytes from one original customer file or its completion receipt. Continue with readId and expectedSha256; after expiry, reopen the same digest and byte offset. Never regenerates or executes the client.',
    { exportId: idSchema, file: { type: 'string', enum: [CLIENT_EXPORT_MANIFEST, ...CLIENT_EXPORT_FILES] }, expectedManifestSha256: digestSchema,
      expectedSha256: digestSchema, readId: { type: 'string' }, offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } },
    ['exportId', 'file', 'expectedManifestSha256'], { readOnly: true, idempotent: true }),
  tool('merchant_client_export_file_release', 'Release this original export’s temporary file snapshot. The retained customer payloads and completion receipt remain available.',
    { exportId: idSchema, readId: { type: 'string' } }, ['exportId', 'readId'], { readOnly: true, idempotent: true }),
  tool('merchant_operations', 'Open the original merchant operations, retained history and private availability controls for this process-owned running instance. The control link grants availability changes; keep it in the operator session.',
    { instanceId: instanceSchema }, ['instanceId'], { readOnly: true, idempotent: true }),
  ...familyTools.stacWorkspaces,
  ...familyTools.fredWorkspaces,
  ...familyTools.apiPassWorkspaces,
  ...familyTools.discovery,
  ...familyTools.cache,
  ...familyTools.fleet,
  ...familyTools.accounting,
  ...familyTools.support,
  ...familyTools.receiving,
  ...familyTools.pythonWorkspaces,
  ...familyTools.graphqlWorkspaces,
  ...familyTools.s3Workspaces,
  ...familyTools.opensearchWorkspaces,
  ...familyTools.socrataWorkspaces,
  ...familyTools.opendatasoftWorkspaces,
  ...familyTools.odataWorkspaces,
  ...familyTools.worldbankWorkspaces,
  ...familyTools.fiscalDataWorkspaces,
  ...familyTools.geocodioWorkspaces,
  ...familyTools.censusGeocoderWorkspaces,
  ...familyTools.webdavWorkspaces,
  ...familyTools.edgarWorkspaces,
  ...familyTools.sheetsWorkspaces,
  ...familyTools.nocodbWorkspaces,
  ...familyTools.ckanWorkspaces,
  ...familyTools.tenderlyWorkspaces,
  ...familyTools.opencageWorkspaces,
  ...familyTools.stellarExpertWorkspaces,
  ...familyTools.coingeckoWorkspaces,
  ...familyTools.redisWorkspaces,
  ...familyTools.usaSpendingWorkspaces,
  ...familyTools.researchWorkspaces,
  ...familyTools.grantsWorkspaces,
  ...familyTools.sourceWorkspaces,
  ...familyTools.clinicalTrialsWorkspaces,
  ...familyTools.baserowWorkspaces,
  ...familyTools.usgsWorkspaces,
  ...familyTools.feedsWorkspaces,
  ...familyTools.dspaceOperators,
  ...familyTools.grantWorkspaces,
  ...familyTools.grpcWorkspaces,
  ...familyTools.dataset,
  ...familyTools.openapiWorkspaces,
  ...familyTools.harWorkspaces,
  ...familyTools.n8nWorkspaces,
  ...familyTools.paidJobWorkspaces,
  ...familyTools.publishers,
  ...familyTools.arcgisWorkspaces,
  ...familyTools.pricing,
  ...familyTools.woocommerce,
  ...familyTools.cocartWorkspaces,
  ...familyTools.mpp,
  ...familyTools.buyerExpenses,
];

export { MERCHANT_TOOLS, tool, idSchema, textSchema, digestSchema, generationSchema, instanceSchema };

const families = new Map(Object.entries(familyTools));
families.set('facilitators', MERCHANT_TOOLS.filter(value => value.name === 'merchant_facilitators' || value.name.startsWith('merchant_facilitator_')));
const familyByTool = new Map([...families].flatMap(([family, values]) => values.map(value => [value.name, family])));

export function merchantToolFamily(name) { return familyByTool.get(name) ?? null; }

/** The complete export above is stable; each process advertises its configured capabilities. */
export function merchantToolCatalog(config) {
  return MERCHANT_TOOLS.filter(value => !familyByTool.has(value.name) || merchantProviderConfigured(familyByTool.get(value.name), config));
}
export function merchantToolFamilies(config) {
  return [
    { name: 'core', tools: MERCHANT_TOOLS.filter(value => !familyByTool.has(value.name)).length },
    ...[...families].filter(([name]) => merchantProviderConfigured(name, config)).map(([name, values]) => ({ name, tools: values.length })),
  ];
}
