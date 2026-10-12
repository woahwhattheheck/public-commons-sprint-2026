// MIT. The original route worksheet through the shared SF61 merchant console.
import { routeKey, routeSheetSnapshot, importRouteSheet, changeRoutePrices, rebaseRouteSheet,
  routeSheetPlan, routeSheetChanges, routeSheetText, ROUTE_SHEET_BYTES } from
  '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/route-sheet-model.mjs';
import { SF61_SHA, SF61_MAX_SOURCE_BYTES, sf61Hash as hash,
  sf61Failure as fail, sf61Plain as plain, sf61Exact as exact, sf61Checked as checked } from './sf61-connection.mjs';

import { routeWorksheetTools } from './catalog/openapi-route-worksheet.mjs';
export { routeWorksheetTools } from './catalog/openapi-route-worksheet.mjs';

const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const REVIEW_SCHEMA = 'stellar-forge.api-route-sheet-review.v1';
const FILE_SCHEMA = 'stellar-forge.api-route-sheet-file.v1';
const canonical = value => JSON.stringify(value, (_, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const toolNames = new Set(routeWorksheetTools(name => name));
export const isRouteWorksheetTool = name => toolNames.has(name);

function bounded(value, maximum, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof text !== 'string' || Buffer.byteLength(text) > maximum)
    throw fail('INVALID_PARAMS', 'Supply a complete ' + label + ' within ' + maximum + ' bytes.');
  return text;
}
function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw fail('INVALID_PARAMS', 'Choose ' + label + ' from ' + minimum + ' to ' + maximum + '.');
  return value;
}
function equalPin(value, actual, label) {
  if (value !== undefined && checked(value, SF61_SHA, label) !== actual)
    throw fail('OPENAPI_ROUTE_CONTEXT_CHANGED', 'The current ' + label + ' differs from the reviewed worksheet. Reopen or reconcile its original source and plan.');
}
async function valueOrFile(client, input, valueName, fileName, kind = 'packet') {
  if (input[valueName] !== undefined && input[fileName] !== undefined)
    throw fail('INVALID_PARAMS', 'Choose one ' + valueName + ' value or declared file.');
  if (input[fileName] !== undefined) {
    const file = await client.source(input[fileName], kind, ROUTE_SHEET_BYTES);
    try { return JSON.parse(file.text); }
    catch { throw fail('INVALID_PARAMS', 'The declared ' + valueName + ' file must contain complete UTF-8 JSON.'); }
  }
  if (input[valueName] === undefined) return undefined;
  bounded(input[valueName], ROUTE_SHEET_BYTES, valueName);
  return structuredClone(input[valueName]);
}
function filter(value = {}) {
  exact(value, ['search', 'method', 'inclusion', 'prices', 'changed', 'supported']);
  if (value.search !== undefined && (typeof value.search !== 'string' || value.search.length > 500) ||
      value.method !== undefined && (typeof value.method !== 'string' || !/^[A-Za-z]{1,16}$/.test(value.method)) ||
      !['all','included','excluded'].includes(value.inclusion ?? 'all') ||
      !['all','priced','unpriced'].includes(value.prices ?? 'all') ||
      ['changed','supported'].some(key => value[key] !== undefined && typeof value[key] !== 'boolean'))
    throw fail('INVALID_PARAMS', 'Use the declared inventory search, method, inclusion, price and change filters.');
  return { ...value, search: value.search?.toLowerCase(), method: value.method?.toUpperCase() };
}
function matches(row, operation, original, selected) {
  return (!selected.search || [row.method,row.path,operation.summary ?? ''].join(' ').toLowerCase().includes(selected.search)) &&
    (!selected.method || row.method === selected.method) &&
    ((selected.inclusion ?? 'all') === 'all' || row.selected === (selected.inclusion === 'included')) &&
    ((selected.prices ?? 'all') === 'all' || Boolean(row.amountAtomic) === (selected.prices === 'priced')) &&
    (selected.changed === undefined || selected.changed ===
      (row.selected !== original.selected || row.amountAtomic !== original.amountAtomic)) &&
    (selected.supported === undefined || Boolean(operation.supported) === selected.supported);
}
function page(items, input) {
  const offset = integer(input.offset ?? 0, 0, items.length, 'the next item offset');
  const limit = integer(input.limit ?? 100, 1, 200, 'the page size');
  const rows = []; let bytes = 0;
  for (const item of items.slice(offset, offset + limit)) {
    const size = Buffer.byteLength(JSON.stringify(item));
    if (rows.length && bytes + size > 262144) break;
    if (size > 524288) throw fail('OPENAPI_ROUTE_ITEM_TOO_LARGE', 'Read this operation from the complete original source file; its individual inventory record exceeds 512 KiB.');
    rows.push(item); bytes += size;
  }
  const next = offset + rows.length;
  return { total: items.length, offset, limit, items: rows, nextOffset: next < items.length ? next : null, complete: next === items.length };
}
function worksheetFile(sheet) {
  const bytes = Buffer.from(bounded(routeSheetText(sheet), ROUTE_SHEET_BYTES, 'route worksheet'));
  const metadata = { schema: FILE_SCHEMA, filename: 'api-route-worksheet.json', bytes: bytes.length,
    sha256: hash(bytes), sourceSha256: sheet.sourceSha256, currency: sheet.currency, rows: sheet.rows.length };
  return { bytes, metadata };
}
function choices(value) {
  if (value === undefined) return {};
  if (!plain(value) || Object.keys(value).length > 4000 ||
      Object.values(value).some(choice => !['SHEET','CURRENT'].includes(choice)))
    throw fail('INVALID_PARAMS', 'Choose SHEET or CURRENT for each returned conflicting field ID.');
  return value;
}
async function stage({ client, input, readSource, readPlan }) {
  let source, plan, origin = null;
  if (input.baseName !== undefined) {
    checked(input.baseName, PACKAGE, 'original package name');
    if (['specText','specFile','plan','planFile'].some(key => input[key] !== undefined))
      throw fail('INVALID_PARAMS', 'Choose one original saved package or an explicit complete source and merchant plan.');
    const saved = await client.json('/api/load?' + new URLSearchParams({ name: input.baseName }));
    bounded(saved.specText, SF61_MAX_SOURCE_BYTES, 'saved API source');
    if (typeof saved.specText !== 'string' || !plain(saved.plan)) throw fail('OPENAPI_ROUTE_SOURCE_INVALID', 'Reopen a complete original API package.');
    source = { text: saved.specText, bytes: Buffer.byteLength(saved.specText), sha256: hash(saved.specText) };
    plan = saved.plan;
    origin = { name: input.baseName, id: saved.manifest?.id ?? null, sourceRevision: saved.sourceRevision ? { reviewSha256: saved.sourceRevision.reviewSha256,
      refreshReviewId: saved.sourceRevision.refreshReviewId, base: saved.sourceRevision.base, candidate: saved.sourceRevision.candidate } : null };
  } else {
    source = await readSource(input); plan = await readPlan(input);
  }
  if (!plain(plan) || plan.schema !== 'stellar-forge.api-merchant-plan.v1' || !Array.isArray(plan.operations))
    throw fail('INVALID_PARAMS', 'Use the complete original API merchant plan.');
  bounded(plan, SF61_MAX_SOURCE_BYTES, 'merchant plan');
  const planSha256 = hash(canonical(plan));
  equalPin(input.expectedSourceSha256, source.sha256, 'source SHA256');
  equalPin(input.expectedPlanSha256, planSha256, 'complete plan SHA256');
  const inspection = await client.json('/api/inspect', { specText: source.text });
  if (inspection.sourceSha256 !== source.sha256 || !Array.isArray(inspection.operations))
    throw fail('OPENAPI_ROUTE_SOURCE_INVALID', 'The original inspector returned another source identity.');
  let capturedSource = input.capturedSource;
  if (capturedSource !== undefined) {
    if (!plain(capturedSource)) throw fail('INVALID_PARAMS', 'Keep the original capturedSource object.');
    bounded(capturedSource, 65536, 'HAR source binding');
  } else capturedSource = (await client.json('/api/har/locate', { specText: source.text })).capturedSource ?? undefined;
  const current = routeSheetSnapshot({ sourceSha256: source.sha256, title: inspection.title,
    operations: inspection.operations, rows: plan.operations.map(row => ({ ...row, selected: true })), payment: plan.payment });
  const imported = await valueOrFile(client, input, 'worksheet', 'worksheetFile');
  const base = await valueOrFile(client, input, 'baseWorksheet', 'baseWorksheetFile');
  const resolved = choices(input.choices);
  let sheet = imported === undefined ? structuredClone(current) : importRouteSheet(imported, current, inspection.operations);
  let conflicts = [];
  if (base !== undefined) {
    if (imported === undefined) throw fail('INVALID_PARAMS', 'Supply the retained worksheet together with its original base.');
    const pending = rebaseRouteSheet(base, sheet, current, inspection.operations);
    const known = new Set(pending.conflicts.map(row => row.id));
    if (Object.keys(resolved).some(id => !known.has(id)))
      throw fail('INVALID_PARAMS', 'Use the exact field IDs from this original worksheet reconciliation.');
    const rebased = rebaseRouteSheet(base, sheet, current, inspection.operations, resolved);
    sheet = rebased.sheet; conflicts = rebased.conflicts;
  } else if (Object.keys(resolved).length) throw fail('INVALID_PARAMS', 'Field choices need the retained worksheet and its original base.');
  const available = new Map(inspection.operations.map(row => [routeKey(row), row]));
  const original = new Map(current.rows.map(row => [routeKey(row), row]));
  if (input.actions !== undefined && (!Array.isArray(input.actions) || input.actions.length > 32))
    throw fail('INVALID_PARAMS', 'Keep at most 32 explicit worksheet actions in one staged request.');
  if (conflicts.length && input.actions?.length)
    throw fail('OPENAPI_ROUTE_RECONCILIATION_REQUIRED', 'Resolve the returned worksheet fields before applying further bulk actions.');
  const applied = [];
  for (const action of input.actions ?? []) {
    exact(action, ['filter','selected','price'], ['filter']);
    if (action.selected === undefined && action.price === undefined ||
        action.selected !== undefined && typeof action.selected !== 'boolean')
      throw fail('INVALID_PARAMS', 'Each worksheet action needs an explicit inclusion choice or price change.');
    const selection = filter(action.filter);
    const targets = sheet.rows.filter(row => available.get(routeKey(row)).supported &&
      matches(row, available.get(routeKey(row)), original.get(routeKey(row)), selection));
    if (!targets.length) throw fail('OPENAPI_ROUTE_SELECTION_EMPTY', 'The worksheet action matches no supported original operations.');
    const keys = targets.map(routeKey), selected = new Set(keys);
    if (action.selected !== undefined) sheet = { ...sheet,
      rows: sheet.rows.map(row => selected.has(routeKey(row)) ? { ...row, selected: action.selected } : row) };
    if (action.price !== undefined) {
      exact(action.price, ['kind','value','rounding'], ['kind','value']);
      sheet = changeRoutePrices(sheet, keys, action.price);
    }
    applied.push({ filter: action.filter, matched: targets.length,
      ...(action.selected === undefined ? {} : { selected: action.selected }),
      ...(action.price === undefined ? {} : { price: action.price }) });
  }
  const file = worksheetFile(sheet), changes = routeSheetChanges(current, sheet);
  return { client, source, plan, planSha256, origin, inspection, capturedSource, current, sheet, file, changes, conflicts, applied, available, original };
}
function contextView(value) {
  return { sourceSha256: value.source.sha256, sourceBytes: value.source.bytes, planSha256: value.planSha256,
    origin: value.origin, title: value.inspection.title, currency: value.current.currency,
    ...(value.capturedSource === undefined ? {} : { capturedSource: value.capturedSource }) };
}
function stageView(value) {
  return { context: contextView(value), worksheet: value.file.metadata,
    ...(value.file.bytes.length <= 32768 ? { inlineWorksheet: value.sheet } : {}),
    counts: { inventory: value.sheet.rows.length, supported: value.inspection.operations.filter(row => row.supported).length,
      selected: value.sheet.rows.filter(row => row.selected).length,
      unpricedSelected: value.sheet.rows.filter(row => row.selected && !row.amountAtomic).length,
      changed: value.changes.length, conflicts: value.conflicts.length }, actions: value.applied };
}
function requireReconciled(value) {
  if (value.conflicts.length) throw fail('OPENAPI_ROUTE_RECONCILIATION_REQUIRED', 'Reopen the original worksheet reconciliation and choose each conflicting inclusion or price before review, export or save.');
}
async function review(value, input) {
  requireReconciled(value);
  const operationPlans = await valueOrFile(value.client, input, 'operationPlans', 'operationPlansFile', 'plan') ?? [];
  if (!Array.isArray(operationPlans) || operationPlans.length > 64)
    throw fail('INVALID_PARAMS', 'Provide at most 64 complete authored records for newly selected operations.');
  const prepared = routeSheetPlan({ plan: value.plan, sheet: value.sheet, current: value.current,
    operations: value.inspection.operations, operationPlans });
  const native = await value.client.json('/api/preview', { specText: value.source.text, plan: prepared.plan,
    ...(value.capturedSource === undefined ? {} : { capturedSource: value.capturedSource }) });
  const decision = { schema: REVIEW_SCHEMA, sourceSha256: value.source.sha256, currentPlanSha256: value.planSha256,
    candidatePlanSha256: hash(canonical(prepared.plan)), worksheetSha256: value.file.metadata.sha256,
    capturedSourceSha256: value.capturedSource === undefined ? null : hash(canonical(value.capturedSource)),
    nativePreviewSha256: hash(canonical(native)) };
  return { plan: prepared.plan, native, decision: { ...decision, sha256: hash(canonical(decision)) } };
}
async function execute(options) {
  const { name, input, workspace, save } = options, value = await stage(options), base = { workspace, ...stageView(value) };
  if (name === 'merchant_openapi_routes') {
    const selected = filter(input.filter), policies = new Map(value.plan.operations.map(row => [routeKey(row), row]));
    const items = value.sheet.rows.filter(row => matches(row, value.available.get(routeKey(row)), value.original.get(routeKey(row)), selected))
      .map(row => { const operation = value.available.get(routeKey(row));
        return { ...row, supported: Boolean(operation.supported), summary: String(operation.summary ?? '').slice(0,1000),
          ...(String(operation.summary ?? '').length > 1000 ? { summaryTruncated: true } : {}),
          ...(operation.error ? { error: operation.error } : {}),
          current: value.original.get(routeKey(row)), ...(policies.has(routeKey(row)) ? { operationPlan: policies.get(routeKey(row)) } : {}) }; });
    return { ...base, inventory: page(items, input), reconciliation: { conflicts: page(value.conflicts, {}) } };
  }
  if (name === 'merchant_openapi_route_sheet_reconcile') {
    if (input.baseWorksheet === undefined && input.baseWorksheetFile === undefined)
      throw fail('INVALID_PARAMS', 'Reconciliation needs the retained worksheet and its complete original base.');
    return { ...base, conflicts: page(value.conflicts, input), changes: page(value.changes, {}) };
  }
  if (name === 'merchant_openapi_route_sheet_file') {
    requireReconciled(value);
    equalPin(input.expectedWorksheetSha256, value.file.metadata.sha256, 'complete worksheet SHA256');
    const offset = integer(input.offset ?? 0, 0, value.file.bytes.length, 'the worksheet byte offset');
    const limit = integer(input.chunkBytes ?? 196608, 1, 196608, 'the worksheet chunk size');
    const bytes = value.file.bytes.subarray(offset, offset + limit), next = offset + bytes.length;
    return { workspace, file: value.file.metadata, offset, bytes: bytes.length, encoding: 'base64', data: bytes.toString('base64'),
      nextOffset: next < value.file.bytes.length ? next : null, complete: next === value.file.bytes.length };
  }
  const prepared = await review(value, input);
  if (name === 'merchant_openapi_route_sheet_review')
    return { ...base, review: prepared.decision, changes: page(value.changes, input), native: prepared.native };
  if (name === 'merchant_openapi_route_sheet_save') {
    equalPin(input.expectedReviewSha256, prepared.decision.sha256, 'worksheet review SHA256');
    const saved = await save({ name: checked(input.name, PACKAGE, 'new package name') },
      { source: value.source, plan: prepared.plan, capturedSource: value.capturedSource });
    return { ...base, review: prepared.decision, native: saved };
  }
  throw fail('TOOL_NOT_FOUND', 'Unknown original route worksheet operation.');
}
export async function executeRouteWorksheet(options) {
  try { return await execute(options); }
  catch (error) {
    if (!error.code && !error.status) error.code = 'OPENAPI_ROUTE_SHEET_INVALID';
    throw error;
  }
}
