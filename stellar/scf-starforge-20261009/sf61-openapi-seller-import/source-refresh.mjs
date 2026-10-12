// MIT. Review source changes through the original API merchant compiler.
import { createHash } from 'node:crypto';
import { prepareMerchant, inspectOpenApi } from './workspace/model.mjs';
import { parseOpenApiSource } from './source-document.mjs';
import { createOpenApiResolver } from './importer.mjs';
import { merchantPlanForOperations } from './workspace/transport-plan.mjs';

export const REFRESH_SCHEMA = 'stellar-forge.api-source-refresh.v1';
export const DECISIONS_SCHEMA = 'stellar-forge.api-source-refresh-decisions.v1';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const copy = value => structuredClone(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new TypeError(message); };
const RESERVED = new Set(['id', 'amountAtomic', 'method', 'path']);
const BAD = new Set(['__proto__', 'constructor', 'prototype']);
const METHODS = new Set(['GET', 'HEAD', 'DELETE', 'POST', 'PUT', 'PATCH']);

function jsonTree(value, depth = 0, count = { n: 0 }) {
  if (++count.n > 100000 || depth > 48) fail('Refresh input exceeds supported JSON complexity');
  if (Array.isArray(value)) return value.forEach(item => jsonTree(item, depth + 1, count));
  if (plain(value)) {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Use plain JSON objects');
    for (const [key, item] of Object.entries(value)) {
      if (BAD.has(key)) fail('Unsupported dictionary key: ' + key);
      jsonTree(item, depth + 1, count);
    }
  } else if (value !== null && !['string', 'boolean', 'number'].includes(typeof value) ||
    typeof value === 'number' && !Number.isFinite(value)) fail('Use finite JSON values');
}
const canonical = value => JSON.stringify(value, (_, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const equal = (a, b) => canonical(a) === canonical(b);
const pointerKey = key => key.replaceAll('~', '~0').replaceAll('/', '~1');

/** Arrays are compared as ordered values: payment choices and schema order remain visible. */
export function sourceChanges(before, after, pointer = '') {
  const changes = [];
  const walk = (a, b, at) => {
    if (equal(a, b)) return;
    if (plain(a) && plain(b)) {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        const next = at + '/' + pointerKey(key);
        if (!own(a, key)) changes.push({pointer:next, kind:'added', after:copy(b[key])});
        else if (!own(b, key)) changes.push({pointer:next, kind:'removed', before:copy(a[key])});
        else walk(a[key], b[key], next);
      }
    } else changes.push({pointer:at, kind:'changed', before:copy(a), after:copy(b)});
  };
  walk(before, after, pointer);
  return changes;
}
function operationKey(row) {
  const method = typeof row?.method === 'string' ? row.method.toUpperCase() : '';
  if (!METHODS.has(method) || typeof row?.path !== 'string' || !row.path.startsWith('/') || /[\s\x00-\x1f\x7f]/.test(row.path))
    fail('An operation needs a supported method and an absolute OpenAPI path');
  return method + ' ' + row.path;
}
function parseKey(value) {
  if (typeof value !== 'string') fail('Operation identity must be METHOD /path');
  const space = value.indexOf(' '), row = {method:value.slice(0, space), path:value.slice(space + 1)};
  if (space < 1 || operationKey(row) !== value) fail('Use an uppercase operation identity: METHOD /path');
  return row;
}
function exact(value, keys, label) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) fail('Unexpected ' + label + ' fields');
}
function decisionsOf(value = {}) {
  jsonTree(value);
  exact(value, ['schema', 'mappings', 'additions'], 'refresh decision');
  if (value.schema !== undefined && value.schema !== DECISIONS_SCHEMA) fail('Unsupported refresh decisions schema');
  const mappings = value.mappings ?? [], additions = value.additions ?? [];
  if (!Array.isArray(mappings) || mappings.length > 64 || !Array.isArray(additions) || additions.length > 64)
    fail('Use up to 64 explicit mappings and additions');
  const seen = new Set();
  for (const entry of mappings) {
    exact(entry, ['from', 'to', 'settings', 'unset'], 'operation mapping');
    parseKey(entry.from);
    if (seen.has(entry.from)) fail('Duplicate source mapping: ' + entry.from);
    seen.add(entry.from);
    if (!own(entry, 'to')) fail('Every mapping needs an explicit to identity or null removal');
    if (entry.to !== null) parseKey(entry.to);
    if (entry.settings !== undefined && !plain(entry.settings)) fail('Mapping settings must be an object');
    if (entry.unset !== undefined && (!Array.isArray(entry.unset) || entry.unset.some(key => typeof key !== 'string')))
      fail('Mapping unset must be a list of operation setting names');
    for (const key of [...Object.keys(entry.settings ?? {}), ...(entry.unset ?? [])])
      if (RESERVED.has(key) || BAD.has(key)) fail('Refresh retains the existing ' + key + '; edit commercial identity separately');
    if (entry.to === null && (Object.keys(entry.settings ?? {}).length || entry.unset?.length))
      fail('A removed operation cannot also change settings');
    if ((entry.unset ?? []).some(key => own(entry.settings ?? {}, key))) fail('A setting cannot be both set and unset');
  }
  for (const row of additions) operationKey(row);
  return {schema:DECISIONS_SCHEMA, mappings:copy(mappings), additions:copy(additions)};
}
function declaration(spec, row) {
  const reference = createOpenApiResolver(spec).reference;
  const item = reference(spec.paths[row.path]);
  const operation = item[row.method.toLowerCase()];
  const security = operation.security ?? spec.security ?? [];
  const names = [...new Set(Array.isArray(security) ? security.flatMap(entry => Object.keys(entry)) : [])];
  return {
    operation:copy(operation),
    pathParameters:copy(item.parameters ?? []),
    servers:copy(operation.servers ?? item.servers ?? spec.servers ?? []),
    security:copy(security),
    securitySchemes:Object.fromEntries(names.filter(name => own(spec.components?.securitySchemes ?? {}, name))
      .map(name => [name, copy(spec.components.securitySchemes[name])])),
  };
}
function referencedComponents(spec, source) {
  const refs = createOpenApiResolver(spec), found = Object.create(null);
  const visit = node => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!plain(node)) return;
    if (typeof node.$ref === 'string' && !own(found, node.$ref)) {
      const ref = node.$ref;
      found[ref] = {state:'READING'};
      try {
        // The original resolver owns local pointer and reference semantics.
        // Examples/defaults are data, so their apparent $ref values are skipped.
        let value;
        try { value = refs.reference(node); } catch { value = refs.schema(node); }
        found[ref] = {state:'RESOLVED', value:copy(value)};
        visit(value);
      } catch (error) { found[ref] = {state:'UNRESOLVED', message:error.message}; }
    }
    for (const [key, value] of Object.entries(node))
      if (!['example', 'examples', 'default', 'const', 'enum'].includes(key)) visit(value);
  };
  visit(source);
  return found;
}
function snapshot(prepared, index, spec, row) {
  const binding = prepared.bindings[index];
  const declared = declaration(spec, row);
  return {
    selection:copy(prepared.selections[index]),
    binding:copy(binding),
    offer:copy(prepared.imported.offers[index].seller),
    upstream:copy(prepared.upstreams.bindings[binding.handler]),
    ...(prepared.preview.routes[index]?.transport?{transport:copy(prepared.preview.routes[index].transport)}:{}),
    declaration:declared,
    referencedComponents:referencedComponents(spec, declared),
  };
}
function catalog(spec, inspection) {
  const reference = createOpenApiResolver(spec).reference;
  return inspection.operations.filter(op => op.method).map(op => {
    let id = null;
    try { id = reference(spec.paths[op.path])[op.method.toLowerCase()]?.operationId ?? null; } catch {}
    return {key:op.method + ' ' + op.path, operationId:id, supported:op.supported, summary:op.summary};
  });
}

/**
 * Review the original saved plan against new source bytes. This is synchronous,
 * makes no request, and never changes a package. Matching operationId values are
 * suggestions only. Native prepareMerchant validates every resulting contract.
 */
export function reviewSourceRefresh({baseline, candidateSpecText, decisions = {}}) {
  if (!plain(baseline) || typeof baseline.specText !== 'string' || !plain(baseline.plan))
    fail('Supply the original saved specText and merchant plan');
  jsonTree(baseline.plan);
  const decisionsUsed = decisionsOf(decisions);
  const oldSpec = parseOpenApiSource(baseline.specText).document;
  const newSpec = parseOpenApiSource(candidateSpecText).document;
  const before = prepareMerchant(baseline.specText, baseline.plan);
  const candidates = catalog(newSpec, inspectOpenApi(candidateSpecText));
  const candidateMap = new Map(candidates.map(row => [row.key, row]));
  const oldKeys = new Set(baseline.plan.operations.map(operationKey));
  const originalIds = new Set(before.bindings.map(row => row.id));
  for (const mapping of decisionsUsed.mappings)
    if (!oldKeys.has(mapping.from)) fail('Mapping is not a selected source operation: ' + mapping.from);
  const mappings = new Map(decisionsUsed.mappings.map(row => [row.from, row]));
  const plan = copy(baseline.plan);
  plan.operations = [];
  const operations = [], issues = [], selected = new Set();
  const problem = (from, code, message) => issues.push({from, code, message});
  const add = (row, entry) => {
    const key = operationKey(row);
    if (selected.has(key)) problem(entry.from, 'DUPLICATE_TARGET', 'Two selections target ' + key);
    selected.add(key);
    plan.operations.push(row);
    try {
      const compiled = prepareMerchant(candidateSpecText, merchantPlanForOperations(plan,[row]));
      entry.after = snapshot(compiled, 0, newSpec, row);
      entry.id = compiled.bindings[0].id;
      entry.changes = sourceChanges(entry.before ?? {}, entry.after);
      entry.state = entry.before ? entry.changes.length ? 'CHANGED' : 'UNCHANGED' : 'ADDED';
    } catch (error) {
      entry.state = 'INVALID';
      problem(entry.from, 'COMPILATION_FAILED', error.message);
    }
    operations.push(entry);
  };
  baseline.plan.operations.forEach((original, index) => {
    const from = operationKey(original), mapping = mappings.get(from);
    const to = mapping ? mapping.to : from;
    const oldSnapshot = snapshot(before, index, oldSpec, {...original, method:original.method.toUpperCase()});
    const entry = {from, to, id:before.bindings[index].id, action:to === null ? 'remove' : to === from ? 'retain' : 'map',
      state:'UNRESOLVED', changes:[], before:oldSnapshot, after:null};
    if (to === null) {
      entry.state = 'REMOVED';
      entry.changes = [{pointer:'', kind:'removed', before:oldSnapshot}];
      operations.push(entry);
      return;
    }
    if (!candidateMap.has(to) || !candidateMap.get(to).supported) {
      const id = oldSnapshot.declaration.operation.operationId;
      entry.suggestions = id === undefined ? [] : candidates.filter(row => row.supported && row.operationId === id).map(row => row.key);
      problem(from, 'TARGET_UNAVAILABLE', 'Select an existing supported replacement or explicitly remove ' + from);
      operations.push(entry);
      return;
    }
    const row = {...copy(original), ...parseKey(to), id:entry.id};
    for (const key of mapping?.unset ?? []) delete row[key];
    Object.assign(row, copy(mapping?.settings ?? {}));
    add(row, entry);
  });
  for (const addition of decisionsUsed.additions) {
    const key = operationKey(addition);
    if (oldKeys.has(key) || addition.id !== undefined && originalIds.has(addition.id))
      problem(key, 'ORIGINAL_IDENTITY_REUSE', 'Use a mapping to retain an existing operation identity and its price');
    add({...copy(addition), method:addition.method.toUpperCase()},
      {from:null, to:key, id:addition.id ?? null, action:'add', state:'UNRESOLVED', changes:[], before:null, after:null});
  }
  // The original baseline was validated above. Dropped routes no longer retain unused profiles.
  const selectedPlan=merchantPlanForOperations(plan,plan.operations);
  if(own(selectedPlan,'transports'))plan.transports=selectedPlan.transports;else delete plan.transports;
  let prepared = null;
  if (!issues.length) {
    try { prepared = prepareMerchant(candidateSpecText, plan); }
    catch (error) { problem(null, 'PACKAGE_COMPILATION_FAILED', error.message); }
  }
  const summary = {retained:operations.filter(row => row.action === 'retain').length,
    mapped:operations.filter(row => row.action === 'map').length,
    removed:operations.filter(row => row.action === 'remove').length,
    added:operations.filter(row => row.action === 'add').length,
    changed:operations.filter(row => row.state === 'CHANGED').length,
    invalid:operations.filter(row => ['UNRESOLVED', 'INVALID'].includes(row.state)).length};
  const report = {
    schema:REFRESH_SCHEMA,
    baseline:{sourceSha256:sha(baseline.specText), planSha256:sha(canonical(baseline.plan))},
    candidate:{sourceSha256:sha(candidateSpecText)}, decisions:decisionsUsed,
    ready:issues.length === 0, plan, operations, issues,
    sourceChanges:sourceChanges(oldSpec, newSpec),
    ...(baseline.plan.transports===undefined?{}:{transportChanges:sourceChanges(baseline.plan.transports,plan.transports??{})}),
    unselected:candidates.filter(row => !selected.has(row.key)), summary,
    preview:prepared?.preview ?? null,
  };
  // Include effective compiler output as well as source identities. A toolchain
  // change that changes the generated offer/backend also invalidates old review.
  return {...report, reviewId:sha(canonical(report))};
}

/** Regenerate a reviewed result rather than trusting an edited report object. */
export function requireSourceRefresh(input, reviewId) {
  if (typeof reviewId !== 'string' || !/^[0-9a-f]{64}$/.test(reviewId)) fail('Supply the exact reviewed SHA-256 identity');
  const report = reviewSourceRefresh(input);
  if (report.reviewId !== reviewId) fail('Source, plan, decisions or compiler output changed; review the current source again');
  if (!report.ready) fail('Resolve every selected operation before saving: ' + report.issues.map(row => row.message).join('; '));
  return report;
}
