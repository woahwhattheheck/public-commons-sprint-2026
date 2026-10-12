// MIT. Original route worksheet metadata; loaded without the provider runtime.
import { SF61_ALIAS, SF61_SHA } from '../sf61-connection-contracts.mjs';
const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const digest = { type: 'string', pattern: SF61_SHA.source };
const alias = { type: 'string', pattern: SF61_ALIAS.source };
const filterSchema = { type: 'object', properties: {
  search: { type: 'string', maxLength: 500 }, method: { type: 'string', maxLength: 16 },
  inclusion: { type: 'string', enum: ['all', 'included', 'excluded'] },
  prices: { type: 'string', enum: ['all', 'priced', 'unpriced'] },
  changed: { type: 'boolean' }, supported: { type: 'boolean' }
}, additionalProperties: false };
const priceSchema = { type: 'object', properties: {
  kind: { type: 'string', enum: ['fixed', 'percent'] }, value: { type: 'string', maxLength: 128 },
  rounding: { type: 'string', enum: ['up', 'down', 'nearest'] }
}, required: ['kind', 'value'], additionalProperties: false };
const actionsSchema = { type: 'array', maxItems: 32, items: { type: 'object', properties: {
  filter: filterSchema, selected: { type: 'boolean' }, price: priceSchema
}, required: ['filter'], additionalProperties: false } };
const contextSchema = {
  workspace: alias, baseName: { type: 'string', pattern: PACKAGE.source },
  specFile: alias, specText: { type: 'string', minLength: 1, maxLength: 131072 },
  plan: { type: 'object' }, planFile: alias, capturedSource: { type: 'object' },
  expectedSourceSha256: digest, expectedPlanSha256: digest,
  worksheet: { type: 'object' }, worksheetFile: alias,
  baseWorksheet: { type: 'object' }, baseWorksheetFile: alias,
  choices: { type: 'object', additionalProperties: { type: 'string', enum: ['SHEET', 'CURRENT'] } },
  actions: actionsSchema
};
const paging = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 200 } };
const authoring = { operationPlans: { type: 'array', maxItems: 64, items: { type: 'object' } }, operationPlansFile: alias };
const read = { readOnly: true, idempotent: true };

export function routeWorksheetTools(tool) {
  return [
    tool('merchant_openapi_routes',
      'Search and page the complete original API inventory. Stage explicit filtered inclusion and exact fixed/percentage prices; counts cover every matching page. Import a browser worksheet through a declared packet file. Returns current source/plan pins, complete worksheet identity and original policy records for selected routes.',
      { ...contextSchema, filter: filterSchema, ...paging }, ['workspace'], read),
    tool('merchant_openapi_route_sheet_reconcile',
      'Reconcile a retained worksheet and its original base against the current complete merchant plan. Each conflicting inclusion or price returns its exact field ID; choose SHEET or CURRENT and continue the same request.',
      { ...contextSchema, ...paging }, ['workspace'], read),
    tool('merchant_openapi_route_sheet_review',
      'Compile the complete staged worksheet through the original authenticated SF61 preview. Preserves all existing operation records; new selections require complete authored operationPlans. Returns a review SHA covering the current source, complete current/candidate plans, HAR binding, worksheet and native preview.',
      { ...contextSchema, ...authoring, ...paging }, ['workspace'], read),
    tool('merchant_openapi_route_sheet_save',
      'Recheck and save the exact reviewed worksheet through the original atomic package writer. Repeating the same destination and reviewed content reopens its completed package. Continue with the existing load, export, receiving and SF82 release tools.',
      { ...contextSchema, ...authoring, name: { type: 'string', pattern: PACKAGE.source }, expectedReviewSha256: digest },
      ['workspace', 'name', 'expectedReviewSha256'], { idempotent: true }),
    tool('merchant_openapi_route_sheet_file',
      'Read the complete portable browser-compatible worksheet as exact base64 chunks. Repeat the same source and staged edits with expectedWorksheetSha256 and nextOffset until complete; no new worksheet server or package store is created.',
      { ...contextSchema, expectedWorksheetSha256: digest, offset: { type: 'integer', minimum: 0 },
        chunkBytes: { type: 'integer', minimum: 1, maximum: 196608 } }, ['workspace'], read)
  ];
}
