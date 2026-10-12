// MIT. Reuse reviewed HAR contracts across retained capture editions.
import { canonical, newReview, buildDocument } from './model.mjs';

export const REFRESH_SCHEMA = 'stellar.har-refresh.v1';
const clone = value => JSON.parse(JSON.stringify(value));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const unique = values => [...new Set(values)].sort();
const sourceKey = group => canonical([group.method, group.origin, group.path]);
const credentialKey = value => value.in + ':' + value.name;
const own = (value, key) => Object.hasOwn(value || {}, key);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function mergeObserved(a, b) {
  if (!a) return b ? clone(b) : null;
  if (!b) return clone(a);
  if (!a.type || !b.type) return {};
  if (canonical(a) === canonical(b)) return clone(a);
  const types = unique([...[a.type].flat(), ...[b.type].flat()]);
  const out = { type: types.length === 1 ? types[0] : types };
  if (types.includes('object')) {
    out.properties = Object.fromEntries(unique([...Object.keys(a.properties || {}), ...Object.keys(b.properties || {})])
      .map(key => [key, mergeObserved(own(a.properties, key) ? a.properties[key] : null,
        own(b.properties, key) ? b.properties[key] : null)]));
    out.additionalProperties = true;
  }
  if (types.includes('array')) out.items = mergeObserved(a.items, b.items) || {};
  return out;
}

function checkInventory(inventory) {
  if (inventory?.schema !== 'stellar.har-inventory.v1' || !sha(inventory.sourceSha256) || !Array.isArray(inventory.groups))
    throw new TypeError('Expected the original source-bound HAR inventory');
  const ids = new Set(), keys = new Set();
  for (const group of inventory.groups) {
    if (!group || ids.has(group.id) || keys.has(sourceKey(group))) throw new TypeError('HAR inventory repeats a group identity');
    ids.add(group.id); keys.add(sourceKey(group));
  }
}

function pathPattern(path) {
  return new RegExp('^' + path.split(/(\{[A-Za-z_][A-Za-z0-9_]*\})/)
    .map(part => part.startsWith('{') ? '[^/]+' : part.replace(/[.*+?^{}()|[\]\\$]/g, '\\$&')).join('') + '$');
}

function observations(groups) {
  const total = groups.reduce((n, group) => n + group.entryIds.length, 0);
  const query = new Map(), credentials = new Map(), headers = new Set(), responses = new Map();
  for (const group of groups) {
    for (const q of group.query) {
      const row = query.get(q.name) || { name: q.name, observations: 0, repeated: false, sensitive: q.sensitive };
      row.observations += q.observations; row.repeated ||= q.repeated;
      query.set(q.name, row);
    }
    for (const credential of group.credentials) credentials.set(credentialKey(credential), credential);
    group.headers.forEach(header => headers.add(header));
    for (const response of group.responses) {
      const key = canonical([response.status, response.mimeType]);
      const row = responses.get(key) || { status: response.status, mimeType: response.mimeType,
        observations: 0, observedBodies: 0, schema: null, issues: [] };
      row.observations += response.observations; row.observedBodies += response.observedBodies;
      row.schema = mergeObserved(row.schema, response.schema);
      row.issues.push(...(response.issues || [])); responses.set(key, row);
    }
  }
  const recorded = groups.reduce((n, group) => n + group.requestBody.observations, 0);
  return {
    paths: unique(groups.map(group => group.path)),
    query: [...query.values()].sort((a, b) => compare(a.name, b.name)).map(row => ({
      name: row.name, repeated: row.repeated, sensitive: row.sensitive,
      presentInEveryRequest: row.observations === total,
    })),
    credentials: [...credentials.values()].sort((a, b) => compare(credentialKey(a), credentialKey(b))),
    headers: [...headers].sort(),
    request: {
      mimeTypes: unique(groups.flatMap(group => group.requestBody.mimeTypes)),
      schema: groups.reduce((schema, group) => mergeObserved(schema, group.requestBody.schema), null),
      someRecorded: recorded > 0, everyRecorded: total > 0 && recorded === total,
      issues: unique(groups.flatMap(group => group.requestBody.issues || [])),
    },
    responses: [...responses.values()].sort((a, b) => a.status - b.status || compare(a.mimeType, b.mimeType)).map(row => ({
      status: row.status, mimeType: row.mimeType, schema: row.schema,
      someRecorded: row.observedBodies > 0, everyRecorded: row.observedBodies === row.observations,
      issues: unique(row.issues),
    })),
  };
}

function decisionMaps(previous, groups) {
  const fresh = newReview({ sourceSha256: '', groups }).operations;
  const query = {}, credentials = {}, headers = {};
  for (const row of fresh) {
    for (const [key, value] of Object.entries(row.query)) query[key] = own(previous.query, key) ? clone(previous.query[key]) : value;
    for (const [key, value] of Object.entries(row.credentials)) credentials[key] = own(previous.credentials, key) ? clone(previous.credentials[key]) : value;
    for (const [key, value] of Object.entries(row.headers)) headers[key] = own(previous.headers, key) ? clone(previous.headers[key]) : value;
  }
  return { query, credentials, headers };
}

const labels = {
  paths: 'Captured request paths', query: 'Query names, repetition and observed presence',
  credentials: 'Credential locations', headers: 'Custom headers',
  request: 'Request media, observed shapes and recording coverage',
  responses: 'Response status, media, observed shapes and recording coverage',
};

/**
 * Match exact semantic source keys first, then a unique previously reviewed path
 * template with the same method and origin. Entry/group ordinals are never IDs
 * across captures. Ambiguous observations remain separate, unselected rows.
 */
export function createRefreshPlan(before, previousReview, after, previousRevision) {
  checkInventory(before); checkInventory(after);
  if (!sha(previousRevision)) throw new TypeError('A complete original review revision SHA256 is required');
  buildDocument(before, previousReview);
  const beforeById = new Map(before.groups.map(group => [group.id, group]));
  const oldKeys = new Set(before.groups.map(sourceKey));
  const selected = previousReview.operations.filter(operation => operation.enabled).map(operation => {
    const groups = operation.groups.map(id => beforeById.get(id));
    return { operation, groups, pattern: pathPattern(operation.path), method: groups[0].method,
      origin: groups[0].origin, next: [], exact: [], template: [] };
  });
  const exactOwners = new Map();
  for (const row of selected) for (const group of row.groups) exactOwners.set(sourceKey(group), row);
  const unassigned = [], ambiguous = [];
  for (const group of after.groups) {
    const exact = exactOwners.get(sourceKey(group));
    if (exact) { exact.next.push(group); exact.exact.push(group.id); continue; }
    const candidates = selected.filter(row => row.method === group.method && row.origin === group.origin && row.pattern.test(group.path));
    if (candidates.length === 1) {
      candidates[0].next.push(group); candidates[0].template.push(group.id);
    } else {
      const detail = { groupId: group.id, method: group.method, origin: group.origin, path: group.path,
        newlyObserved: !oldKeys.has(sourceKey(group)), matchingOperationIds: candidates.map(row => row.operation.id) };
      unassigned.push(detail);
      if (candidates.length > 1) ambiguous.push(detail);
    }
  }

  const review = clone(previousReview);
  review.sourceSha256 = after.sourceSha256;
  review.operations = [];
  review['x-har-refresh'] = {
    schema: REFRESH_SCHEMA, previousSourceSha256: before.sourceSha256,
    previousReviewSha256: previousRevision, candidateSourceSha256: after.sourceSha256,
  };
  const operations = [];
  for (const row of selected) {
    const previous = observations(row.groups), candidate = row.next.length ? observations(row.next) : null;
    const changes = candidate ? Object.keys(labels).filter(key => canonical(previous[key]) !== canonical(candidate[key]))
      .map(key => ({ section: key, label: labels[key], previous: previous[key], candidate: candidate[key] })) : [];
    const status = !candidate ? 'not-observed' : changes.length ? 'changed' : 'carried';
    const migrated = clone(row.operation);
    migrated.groups = row.next.map(group => group.id);
    migrated.enabled = row.next.length > 0;
    migrated.reviewed = status === 'carried' && row.operation.reviewed === true;
    // Preserve an unavailable route's authored values for explicit remapping.
    if (row.next.length) Object.assign(migrated, decisionMaps(row.operation, row.next));
    review.operations.push(migrated);
    operations.push({
      operationId: row.operation.id, method: row.method, origin: row.origin, path: row.operation.path, status,
      previousGroups: row.groups.map(group => group.id), candidateGroups: migrated.groups,
      previousEntries: row.groups.reduce((n, group) => n + group.entryIds.length, 0),
      candidateEntries: row.next.reduce((n, group) => n + group.entryIds.length, 0),
      exactMatches: row.exact, templateMatches: row.template, changes,
      previousDecisions: clone(row.operation),
    });
  }
  const usedIds = new Set(review.operations.map(operation => operation.id));
  const pendingIds = new Set(unassigned.map(group => group.groupId));
  for (const operation of newReview(after).operations.filter(operation => pendingIds.has(operation.groups[0]))) {
    let id = operation.id, n = 2;
    while (usedIds.has(id)) id = operation.id + '_new_' + n++;
    operation.id = id; usedIds.add(id); review.operations.push(operation);
  }
  const report = {
    schema: 'stellar.har-refresh-report.v1',
    previous: { sourceSha256: before.sourceSha256, reviewSha256: previousRevision,
      capturedEntries: before.totalEntries, groups: before.groups.length, rejectedEntries: before.rejected.length },
    candidate: { sourceSha256: after.sourceSha256, capturedEntries: after.totalEntries,
      groups: after.groups.length, rejectedEntries: clone(after.rejected) },
    summary: {
      previousSelected: selected.length,
      carried: operations.filter(operation => operation.status === 'carried').length,
      changed: operations.filter(operation => operation.status === 'changed').length,
      notObserved: operations.filter(operation => operation.status === 'not-observed').length,
      unselectedGroups: unassigned.length, ambiguousGroups: ambiguous.length,
    },
    operations, unassigned, ambiguous,
    interpretation: 'Differences describe the retained captures. A missing observation does not establish removal of a provider operation, and observed shapes do not define an authoritative API contract.',
  };
  return { report, review };
}
