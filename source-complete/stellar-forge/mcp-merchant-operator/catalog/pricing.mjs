// MIT. Original tool metadata; provider runtimes load only when selected.
import { costToolDefinitions } from './pricing-costs.mjs';
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const alias = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const uuid = { type: 'string', pattern: '^[0-9a-f-]{36}$' };

const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };

const revision = { anyOf: [digest, { type: 'null' }] };

const nullableText = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const usd = { type: 'string', pattern: '^(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$' };

const optionalUsd = { anyOf: [usd, { type: 'null' }] };

const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });

const commercial = object({ merchantName: { type: 'string', minLength: 1, maxLength: 160 },
  sharedMonthlyFixedUsd: optionalUsd,
  routes: { type: 'object', properties: {}, additionalProperties: object({ unitPriceUsd: usd,
    priceBasis: { type: 'string', minLength: 4, maxLength: 300 }, perFulfilledUsd: optionalUsd,
    perChallengeUsd: optionalUsd, monthlyPaidTarget: { type: 'integer', minimum: 0 } }) } });

const selection = object({ kind: { type: 'string', enum: ['SESSION', 'DURABLE_HISTORY'] },
  from: nullableText, to: nullableText, routeId: nullableText }, ['kind']);

const edits = { type: 'array', minItems: 1, items: object({
  routeId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' }, paymentIndex: { type: 'integer', minimum: 0 },
  expectedAmount: { type: 'string', pattern: '^[1-9][0-9]*$' }, amount: { type: 'string', pattern: '^[1-9][0-9]*$' } }) };

const base = { workspace: alias };

const priceInput = { ...base, sellerSha256: digest, snapshotSha256: digest, commercial };

const quoteValuations = { type: 'array', minItems: 1, items: object({
  routeId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' },
  paymentIndex: { type: 'integer', minimum: 0 },
  expectedAmount: { type: 'string', pattern: '^[1-9][0-9]{0,38}$' },
  atomicUnits: { type: 'string', pattern: '^[1-9][0-9]{0,38}$' },
  usd: { ...usd, maxLength: 64 },
  basis: { type: 'string', minLength: 4, maxLength: 300 }
}) };

const repriceInput = { ...base, version: uuid, sellerSha256: digest, edits, quoteValuations };

const saveInput = { requestId: uuid, expectedRevision: revision, label: { type: 'string', minLength: 1, maxLength: 100 } };

const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } };

const fileSelection = { ...base, kind: { type: 'string', enum: ['review', 'decision', 'scenario'] }, id: uuid };

const read = { readOnly: true, idempotent: true };

const sourceViews = ['routes', 'reviews', 'decisions', 'days', 'sessions', 'observations'];

const reportViews = ['routes', 'issues', 'historyDays', 'historySessions', 'historyRoutes', 'periodDays', 'periodVariants'];

const scenarioId = { type: 'string', pattern: '^(?!baseline$)[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' };

const scenarioChoice = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' };

const scenarioGoal = object({ monthlyContributionUsd: usd,
  marginPct: { type: 'string', pattern: '^(0|[1-9][0-9]?)(\\.[0-9]{1,4})?$' } }, []);

const scenario = object({ id: scenarioId, label: { type: 'string', minLength: 1, maxLength: 120 },
  sharedMonthlyFixedUsd: optionalUsd,
  routes: { type: 'object', properties: {}, additionalProperties: object({
    unitPriceUsd: usd, priceBasis: { type: 'string', minLength: 4, maxLength: 300 },
    perFulfilledUsd: optionalUsd, perChallengeUsd: optionalUsd,
    monthlyPaidTarget: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } }, []) },
  goal: scenarioGoal }, ['id','label']);

const scenarioInput = { ...base, version: uuid, scenarios: { type: 'array', maxItems: 12, items: scenario } };

const scenarioViews = ['scenarios','routes','goals','suggestionRoutes'];

const suggestionKind = { type: 'string', enum: ['BREAK_EVEN_PRICE','BREAK_EVEN_VOLUME','TARGET_PRICE','TARGET_VOLUME'] };

const scenarioPage = { view: { type: 'string', enum: scenarioViews }, scenarioId: scenarioChoice, suggestionKind, ...page };

const definitions = [
  ...costToolDefinitions,
  ['merchant_pricing_status', 'List host-declared pricing workspaces and their process-local capture/file-read state. Does not capture operations or open a workspace.', { ...base }, [], read],
  ['merchant_pricing_open', 'Open the original SF97 workspace model and capture its configured native operations source. Reopening the same alias reuses its original captures. Original per-save compare-and-swap remains shared with the browser.', base, ['workspace'], { idempotent: true }],
  ['merchant_pricing_close', 'Release this MCP handle\'s source view and temporary file reads. Original saved reviews, price decisions and staged releases remain in their original stores.', base, ['workspace'], { idempotent: true }],
  ['merchant_pricing_source', 'Capture current seller terms and original session/history observations, or page the same capture with captureSha256. Route pages include every ordered payment option and its saved commercial inputs. Use the returned seller/snapshot hashes for preview and save.',
    { ...base, selection, captureSha256: digest, view: { type: 'string', enum: sourceViews }, ...page }, ['workspace'], read],
  ['merchant_pricing_preview', 'Evaluate merchant-entered USD prices, costs and targets against the original captured observations. Page original route economics, issues or retained history details. Atomic payment amounts remain the seller\'s declared values.',
    { ...priceInput, view: { type: 'string', enum: reportViews }, ...page }, Object.keys(priceInput), read],
  ['merchant_pricing_save', 'Save the original pricing report and exact captured source bytes. Retain requestId and repeat identical inputs after an interrupted reply; expectedRevision uses the pricing review head. Original native reconciliation is included when the host attached its outbox.',
    { ...priceInput, ...saveInput }, [...Object.keys(priceInput), ...Object.keys(saveInput)], { idempotent: true }],
  ['merchant_pricing_load', 'Load the original commercial inputs from a saved pricing version against the current seller configuration. Capture current observations before previewing or saving another version.',
    { ...base, version: uuid }, ['workspace', 'version'], read],
  ['merchant_pricing_compare', 'Compare two exact retained pricing reports with original seller, commercial, observation-kind and period compatibility. Page the same report view on each side.',
    { ...base, leftVersion: uuid, rightVersion: uuid, view: { type: 'string', enum: reportViews }, ...page }, ['workspace', 'leftVersion', 'rightVersion'], read],
  ['merchant_pricing_planning_source', 'Read one immutable saved review as a commercial planning source. Page its selected routes, complete ordered payment choices and original commercial assumptions. Original source hashes and unknown costs stay attached.',
    { ...base, version: uuid, ...page }, ['workspace','version'], read],
  ['merchant_pricing_planning_preview', 'Compare up to twelve explicit volume, USD quote and cost scenarios using the original saved review and analyzer. Page scenarios, route economics, goals, or a selected suggestion\'s complete route inputs. Suggested plans are applied only by an explicit subsequent operation.',
    { ...scenarioInput, ...scenarioPage }, Object.keys(scenarioInput), read],
  ['merchant_pricing_planning_save', 'Save the exact reviewed comparison in the original private scenario store. Preserve requestId, reviewSha256 and the complete inputs across retries. selectedScenarioId is optional and names one explicit scenario.',
    { ...scenarioInput, requestId: uuid, label: { type: 'string', minLength: 1, maxLength: 100 },
      reviewSha256: digest, selectedScenarioId: { anyOf: [scenarioId,{ type: 'null' }] } },
    [...Object.keys(scenarioInput),'requestId','label','reviewSha256'], { idempotent: true }],
  ['merchant_pricing_planning_list', 'List retained comparison summaries from the original workspace. The native listing retains its newest one hundred entries; every older plan remains loadable by its exact planId.',
    { ...base, ...page }, ['workspace'], read],
  ['merchant_pricing_planning_load', 'Reopen one exact saved comparison after restart. Page its scenarios, route inputs and goal suggestions; use kind:scenario with the original manifest/file tools for its complete JSON, CSV and terms.',
    { ...base, planId: uuid, ...scenarioPage }, ['workspace','planId'], read],
  ['merchant_pricing_planning_selection', 'Load one explicitly selected saved scenario as commercial draft inputs against the current seller. Capture current observations before saving that draft or using planning_apply.',
    { ...base, planId: uuid, scenarioId, ...page }, ['workspace','planId','scenarioId'], read],
  ['merchant_pricing_planning_apply', 'Apply an explicitly selected saved scenario by saving a new original pricing review. Supply the inspected plan review hash, current seller/snapshot hashes, pricing expectedRevision and stable requestId. Equal retries recover through the original pricing save.',
    { ...base, planId: uuid, scenarioId, reviewSha256: digest, sellerSha256: digest, snapshotSha256: digest, ...saveInput },
    ['workspace','planId','scenarioId','reviewSha256','sellerSha256','snapshotSha256',...Object.keys(saveInput)], { idempotent: true }],
  ['merchant_pricing_repricing_source', 'Read every complete ordered payment option from the selected original saved pricing review, its seller hash, current price-decision revision and source-release availability.',
    { ...base, version: uuid }, ['workspace', 'version'], read],
  ['merchant_pricing_repricing_preview', 'Review either explicit atomic edits or quoteValuations against the selected saved seller. A quote valuation identifies the original option, expected amount, atomicUnits, positive USD value and basis. It derives the smallest sufficient atomic price from the saved USD quote. The original compiler validates both configurations; the complete conversion is included in reviewSha256.',
    repriceInput, ['workspace','version','sellerSha256'], read],
  ['merchant_pricing_repricing_save', 'Retain the exact reviewed price changes, original source seller/report/terms and updated seller configuration. A configured original API package is regenerated by its original compiler. Retain requestId, reviewSha256 and the price-decision expectedRevision across retries.',
    { ...repriceInput, ...saveInput, reviewSha256: digest }, ['workspace','version','sellerSha256', ...Object.keys(saveInput), 'reviewSha256'], { idempotent: true }],
  ['merchant_pricing_repricing_stage', 'Stage this retained original API price decision through its configured SF82 release store. Use the saved decision and exact reviewSha256. The same stable release ID recovers an interrupted reply; inspect and activate it with the original merchant release controls.',
    { ...base, decision: uuid, reviewSha256: digest }, ['workspace', 'decision', 'reviewSha256'], { idempotent: true }],
  ['merchant_pricing_manifest', 'Read an original saved pricing-review, price-decision or scenario-plan manifest and its exact file hashes. kind:review uses a saved version ID; kind:decision uses a saved decision ID; kind:scenario uses a saved planId.',
    fileSelection, ['workspace', 'kind', 'id'], read],
  ['merchant_pricing_file', 'Read SHA-pinned chunks from a file named in the inspected original pricing manifest, including source-package files. Repeat all selectors with readId, expectedSha256 and nextOffset. Reopening a digest after expiry reads the same retained bytes.',
    { ...fileSelection, file: { type: 'string', minLength: 1, maxLength: 4096 }, expectedManifestSha256: digest,
      expectedSha256: digest, readId: uuid, offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: MAX_RETAINED_CHUNK_BYTES } },
    ['workspace', 'kind', 'id', 'file', 'expectedManifestSha256'], read],
  ['merchant_pricing_file_release', 'Release this pricing workspace\'s temporary immutable file snapshot.',
    { ...base, readId: uuid }, ['workspace', 'readId'], read],
];

const pricingTools = tool => definitions.map(parts => tool(...parts));

export { pricingTools, definitions, base, read, selection, digest, sourceViews, page, priceInput, reportViews, saveInput, uuid, scenarioInput, scenarioPage, scenarioId, repriceInput, fileSelection, alias, object, nullableText, commercial, revision, scenario, scenarioViews, scenarioChoice, suggestionKind, edits, optionalUsd, usd, scenarioGoal };
