// MIT. Reusable explicit policies around the original source-bound route planner.
import { MERCHANT_OPERATION_FIELDS } from './operation-contract.mjs';
import { routeKey, routeSheetPlan, routeSheetSnapshot, normalizeRouteSheet } from './route-sheet-model.mjs';

export const OPERATION_POLICY_SCHEMA = 'stellar-forge.api-operation-policy.v1';
export const OPERATION_POLICY_BYTES = 256 * 1024;
export const OPERATION_POLICY_APPLICATION_BYTES = 4 * 1024 * 1024;
export const POLICY_METHODS = Object.freeze(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const protectedFields = new Set(['method', 'path', 'id', 'amountAtomic']);
export const POLICY_FIELDS = Object.freeze(MERCHANT_OPERATION_FIELDS.filter(field => !protectedFields.has(field)));
// Every non-protected native field is optional; the original compiler owns defaults.
export const POLICY_UNSET_FIELDS = POLICY_FIELDS;
export const POLICY_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const utf8 = new TextEncoder();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const copy = value => structuredClone(value);
const fail = message => { throw Object.assign(new TypeError(message), {code:'OPENAPI_OPERATION_POLICY_INVALID'}); };
function exact(value, allowed, required, label) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key))) fail('Use the complete declared ' + label + ' fields.');
}
export function operationPolicyCanonical(value) {
  return JSON.stringify(value, (_key, item) => plain(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
export function operationPolicyJSON(value, maximum = OPERATION_POLICY_BYTES, label = 'operation policy') {
  const visit = (item, depth) => {
    if (depth > 64) fail('The ' + label + ' exceeds 64 JSON levels.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (Array.isArray(item)) {
      if (item.length > 100000) fail('The ' + label + ' contains an oversized JSON array.');
      for (const child of item) visit(child, depth + 1);
      return;
    }
    if (!plain(item)) fail('Keep the ' + label + ' as complete finite JSON data.');
    for (const child of Object.values(item)) visit(child, depth + 1);
  };
  visit(value, 0);
  const text = operationPolicyCanonical(value);
  if (utf8.encode(text).length > maximum) fail('The complete ' + label + ' exceeds ' + maximum + ' bytes.');
  return JSON.parse(text);
}
function settings(value, label = 'policy settings') {
  exact(value, POLICY_FIELDS, [], label);
  return operationPolicyJSON(value, OPERATION_POLICY_BYTES, label);
}
function text(value, maximum, label, empty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim()) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('Enter a valid ' + label + '.');
  return value;
}
export function normalizeOperationPolicy(document) {
  exact(document, ['schema','id','title','description','methods','settings'],
    ['schema','id','title','methods','settings'], 'operation policy');
  if (document.schema !== OPERATION_POLICY_SCHEMA || !POLICY_ID.test(document.id ?? ''))
    fail('Choose a policy ID beginning with a letter, with at most 64 letters, digits, underscores or hyphens.');
  if (!Array.isArray(document.methods) || !document.methods.length ||
      document.methods.length > POLICY_METHODS.length || new Set(document.methods).size !== document.methods.length ||
      document.methods.some(method => !POLICY_METHODS.includes(method))) fail('Choose the original supported HTTP methods once each.');
  const selected = settings(document.settings);
  if (!Object.keys(selected).length) fail('Choose at least one explicit native operating setting for this policy.');
  const value = {
    schema:OPERATION_POLICY_SCHEMA, id:document.id, title:text(document.title, 240, 'policy title'),
    description:text(document.description ?? '', 4000, 'policy description', true),
    methods:POLICY_METHODS.filter(method => document.methods.includes(method)), settings:selected
  };
  operationPolicyJSON(value);
  return value;
}
export function operationPolicyText(document) {
  const result = JSON.stringify(normalizeOperationPolicy(document), null, 2) + '\n';
  if (utf8.encode(result).length > OPERATION_POLICY_BYTES) fail('The complete policy edition exceeds 256 KiB.');
  return result;
}
function route(value, label) {
  exact(value, ['method','path'], ['method','path'], label);
  if (typeof value.method !== 'string' || !POLICY_METHODS.includes(value.method.toUpperCase()) ||
      typeof value.path !== 'string' || !value.path.startsWith('/') || value.path.length > 4096 ||
      /[\u0000-\u001f\u007f]/.test(value.path)) fail('Choose an original supported method and path for ' + label + '.');
  return {method:value.method.toUpperCase(), path:value.path};
}
export function normalizeOperationPolicyTargets(targets) {
  if (!Array.isArray(targets) || !targets.length || targets.length > 64)
    fail('Choose 1–64 explicitly selected and priced routes for this policy.');
  const seen = new Set();
  return targets.map(value => {
    const selected = route(value, 'policy target'), key = routeKey(selected);
    if (seen.has(key)) fail('Choose each policy target once.');
    seen.add(key); return selected;
  });
}
export function normalizeOperationPolicyOverrides(overrides = [], targets) {
  if (!Array.isArray(overrides) || overrides.length > 64) fail('Keep at most 64 explicit route overrides.');
  const selected = new Set(targets.map(routeKey)), seen = new Set();
  return overrides.map(value => {
    exact(value, ['method','path','set','unset'], ['method','path'], 'route override');
    const chosen = route({method:value.method,path:value.path}, 'route override'), key = routeKey(chosen);
    if (!selected.has(key) || seen.has(key)) fail('Overrides must name distinct routes in this explicit policy selection.');
    seen.add(key);
    const set = settings(value.set ?? {}, 'route override settings'), unset = value.unset ?? [];
    if (!Array.isArray(unset) || new Set(unset).size !== unset.length ||
        unset.some(field => !POLICY_UNSET_FIELDS.includes(field) || Object.hasOwn(set, field)))
      fail('Unset distinct optional native fields, without setting the same field in that route override.');
    if (!Object.keys(set).length && !unset.length) fail('Each route override needs an explicit setting or optional-field removal.');
    return {...chosen, set, unset:[...unset].sort()};
  });
}
export function operationPolicyPlanChanges(before, after) {
  const previous = new Map(before.operations.map(row => [routeKey(row), row]));
  const next = new Map(after.operations.map(row => [routeKey(row), row]));
  const keys = [...previous.keys(), ...[...next.keys()].filter(key => !previous.has(key))], changes = [];
  for (const key of keys) {
    const a = previous.get(key) ?? null, b = next.get(key) ?? null;
    if (operationPolicyCanonical(a) === operationPolicyCanonical(b)) continue;
    const row = b ?? a, fields = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]
      .filter(field => operationPolicyCanonical(a?.[field]) !== operationPolicyCanonical(b?.[field])).sort();
    changes.push({method:String(row.method).toUpperCase(), path:row.path,
      kind:a === null ? 'added' : b === null ? 'removed' : 'changed',
      fields, before:copy(a), after:copy(b)});
  }
  return changes;
}
/** Policy fields replace their complete native value; per-route unset is explicit. */
export function applyOperationPolicy({plan, sheet, current, operations, policy, targets, overrides = [], operationPlans = []}) {
  if (!plain(plan) || plan.schema !== 'stellar-forge.api-merchant-plan.v1' || !Array.isArray(plan.operations) ||
      !Array.isArray(operations)) fail('Open the complete original source inventory and merchant plan.');
  operationPolicyJSON(plan, OPERATION_POLICY_APPLICATION_BYTES, 'base merchant plan');
  const document = normalizeOperationPolicy(policy), chosen = normalizeOperationPolicyTargets(targets);
  const changes = normalizeOperationPolicyOverrides(overrides, chosen), overrideMap = new Map(changes.map(row => [routeKey(row), row]));
  const basis = normalizeRouteSheet(current), worksheet = normalizeRouteSheet(sheet ?? current);
  const inventory = new Map(operations.map(row => [routeKey(row), row]));
  const included = new Map(worksheet.rows.filter(row => row.selected).map(row => [routeKey(row), row]));
  const targetMap = new Map(chosen.map(row => [routeKey(row), row]));
  for (const row of chosen) {
    const key = routeKey(row), original = inventory.get(key);
    if (!original?.supported || !included.has(key)) fail(row.method + ' ' + row.path + ': select this supported route and its price in the original worksheet first.');
    if (!document.methods.includes(row.method)) fail(row.method + ' ' + row.path + ': this policy edition does not include that HTTP method.');
  }
  if (!Array.isArray(operationPlans) || operationPlans.length > 64)
    fail('Keep at most 64 complete original additional operation records.');
  const authored = new Map();
  for (const row of operationPlans) {
    if (!plain(row) || typeof row.method !== 'string' || typeof row.path !== 'string')
      fail('Keep each additional operation as its complete original authored record.');
    const key = routeKey(row);
    if (authored.has(key)) fail('Use each original additional operation record once.');
    authored.set(key, copy(row));
  }
  const existing = new Map(plan.operations.map(row => [routeKey(row), row]));
  // A newly chosen route has an explicit template and price. Its optional ID
  // stays absent so the original compiler derives the same native route ID.
  for (const row of chosen) {
    const key = routeKey(row);
    if (!existing.has(key) && !authored.has(key))
      authored.set(key, {method:row.method, path:row.path, amountAtomic:included.get(key).amountAtomic});
  }
  const prepared = routeSheetPlan({plan, sheet:worksheet, current:basis, operations, operationPlans:[...authored.values()]});
  const candidate = {...prepared.plan, operations:prepared.plan.operations.map(row => {
    const key = routeKey(row);
    if (!targetMap.has(key)) return copy(row);
    const extra = overrideMap.get(key);
    const value = {...copy(row), ...copy(document.settings), ...copy(extra?.set ?? {})};
    for (const field of extra?.unset ?? []) delete value[field];
    return value;
  })};
  operationPolicyJSON(candidate, OPERATION_POLICY_APPLICATION_BYTES, 'candidate merchant plan');
  return {policy:document, targets:chosen, overrides:changes, worksheet, plan:candidate,
    changes:operationPolicyPlanChanges(plan,candidate), operationPlans:copy(operationPlans),
    counts:{targets:chosen.length,selected:candidate.operations.length,
      added:candidate.operations.filter(row => !existing.has(routeKey(row))).length}};
}
/** Rebuild the full original worksheet basis from one retained source/plan. */
export function operationPolicyCurrent({sourceSha256, title, operations, plan}) {
  return routeSheetSnapshot({sourceSha256,title,operations,
    rows:plan.operations.map(row => ({...row,selected:true})),payment:plan.payment});
}
