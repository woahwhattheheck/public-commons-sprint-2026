// MIT. Native GeoNetwork catalogue plans over an original verified STAC delivery.
import { createHash } from 'node:crypto';
import { canonicalJson } from '../provider.mjs';
import { nativeRecordId } from './native.mjs';

export const CATALOGUE_SCHEMA = 'starforge.stac-geonetwork.v1';
export const SOURCE_SCHEMA = 'starforge.stac-geonetwork-source.v1';
export const PLAN_SCHEMA = 'starforge.stac-geonetwork-plan.v1';
export const TRANSFORM = 'schema:iso19115-3.2018:convert/stac-to-iso19115-3';
export const copy = value => JSON.parse(JSON.stringify(value));
export const hash = value => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : canonicalJson(value)).digest('hex');
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function requireValue(condition, code, detail) {
  if (!condition) { const error = new Error(detail || code); error.code = code; throw error; }
}
export function identifier(value, label = 'identifier') {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value), 'CATALOGUE_IDENTIFIER_INVALID', 'Use a stable ' + label + ' of 1–128 letters, digits, periods, underscores, colons or hyphens.');
  return value;
}
export function textValue(value, label, max = 1000) {
  requireValue(typeof value === 'string' && value.trim().length && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), 'CATALOGUE_TEXT_INVALID', label + ' is required.');
  return value;
}
export function nativeId(value, label) {
  const str = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  requireValue(typeof str === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(str), 'CATALOGUE_NATIVE_ID_REQUIRED', 'Select the actual native ' + label + '.');
  return str;
}
export function absoluteHttp(value, { allowHttp = false, label = 'URL' } = {}) {
  let url;
  try { url = new URL(value); } catch {}
  requireValue(url && !url.username && !url.password && !url.hash &&
    (url.protocol === 'https:' || url.protocol === 'http:' && (allowHttp || ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))),
    'CATALOGUE_URL_INVALID', label + ' must be an absolute HTTPS URL, or an explicitly selected HTTP catalogue network.');
  return url;
}
export function normalizeConnection(input) {
  requireValue(isObject(input), 'CATALOGUE_CONNECTION_REQUIRED');
  const allowed = new Set(['baseUrl', 'portal', 'language', 'auth', 'allowHttp', 'timeoutMs',
    'maxResponseBytes', 'maxMefBytes', 'expectedVersion']);
  requireValue(Object.keys(input).every(key => allowed.has(key)), 'CATALOGUE_CONNECTION_FIELD_UNKNOWN');
  const url = absoluteHttp(input.baseUrl, { allowHttp: input.allowHttp === true, label: 'GeoNetwork installation URL' });
  requireValue(!url.search && !/\/srv(?:\/|$)/.test(url.pathname), 'CATALOGUE_CONTEXT_URL_REQUIRED',
    'Use the installation context, for example https://catalogue.example/geonetwork, without /srv or an API path.');
  const auth = input.auth ?? { usernameEnv: 'GEONETWORK_USERNAME', passwordEnv: 'GEONETWORK_PASSWORD' };
  requireValue(isObject(auth) && Object.keys(auth).every(key =>
    ['usernameEnv', 'passwordEnv', 'cookieEnv', 'csrfEnv'].includes(key)), 'CATALOGUE_CREDENTIAL_VARIABLE_REQUIRED');
  for (const value of Object.values(auth))
    requireValue(typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value), 'CATALOGUE_CREDENTIAL_VARIABLE_REQUIRED');
  requireValue(Boolean(auth.usernameEnv) === Boolean(auth.passwordEnv) &&
    (auth.usernameEnv || auth.cookieEnv), 'CATALOGUE_CREDENTIAL_SELECTION_REQUIRED');
  const result = { baseUrl: url.href.replace(/\/+$/, ''), portal: input.portal ?? 'srv',
    language: input.language ?? 'eng', auth: copy(auth), allowHttp: input.allowHttp === true,
    timeoutMs: input.timeoutMs ?? 60000, maxResponseBytes: input.maxResponseBytes ?? 33554432,
    maxMefBytes: input.maxMefBytes ?? 268435456, expectedVersion: input.expectedVersion ?? null };
  for (const key of ['portal', 'language'])
    requireValue(typeof result[key] === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(result[key]), 'CATALOGUE_NATIVE_CONTEXT_INVALID');
  for (const [key, min, max] of [['timeoutMs', 1000, 600000], ['maxResponseBytes', 1024, 268435456], ['maxMefBytes', 1024, 2147483647]])
    requireValue(Number.isSafeInteger(result[key]) && result[key] >= min && result[key] <= max, 'CATALOGUE_LIMIT_INVALID', 'Configure a valid ' + key + '.');
  if (result.expectedVersion !== null) textValue(result.expectedVersion, 'Expected installed version', 128);
  return result;
}

function resolvedLink(href, base, issues, collectionId, location) {
  if (typeof href !== 'string' || !href.length) {
    issues.push({ severity: 'error', collectionId, location, code: 'MISSING_LINK', message: 'The source link has no href.' });
    return href;
  }
  try {
    const url = base ? new URL(href, base) : new URL(href);
    requireValue(['https:', 'http:', 'ftp:', 's3:', 'doi:', 'urn:'].includes(url.protocol), 'CATALOGUE_LINK_SCHEME');
    return url.href;
  } catch {
    issues.push({ severity: 'error', collectionId, location, code: 'SOURCE_BASE_REQUIRED', message: 'Retain an absolute original self link or supply the actual source document URL before publication.' });
    return href;
  }
}
function collectionMetadata(original, suppliedBase, issues) {
  const result = copy(original);
  const self = (original.links || []).find(link => isObject(link) && link.rel === 'self' && typeof link.href === 'string');
  let base = suppliedBase || null;
  if (base) base = absoluteHttp(base, { allowHttp: true, label: 'Original collection document URL' }).href;
  if (self) {
    try { base = base ? new URL(self.href, base).href : new URL(self.href).href; } catch {}
  }
  if (Array.isArray(result.links))
    result.links = result.links.map((link, i) => {
      requireValue(isObject(link), 'CATALOGUE_COLLECTION_LINK_INVALID');
      return { ...link, href: resolvedLink(link.href, base, issues, result.id, 'links/' + i + '/href') };
    });
  if (isObject(result.assets))
    for (const [key, asset] of Object.entries(result.assets)) {
      requireValue(isObject(asset), 'CATALOGUE_COLLECTION_ASSET_INVALID');
      asset.href = resolvedLink(asset.href, base, issues, result.id, 'assets/' + key + '/href');
    }
  if (!result.title) issues.push({ severity: 'review', collectionId: result.id, code: 'TITLE_ABSENT', message: 'The source has no title; review the native metadata title.' });
  if (!result.description) issues.push({ severity: 'review', collectionId: result.id, code: 'DESCRIPTION_ABSENT', message: 'The source has no description.' });
  if (!result.license) issues.push({ severity: 'error', collectionId: result.id, code: 'LICENSE_ABSENT', message: 'The original collection must state its license or license identifier.' });
  if (!isObject(result.extent) || !isObject(result.extent.spatial) || !Array.isArray(result.extent.spatial.bbox) ||
      !isObject(result.extent.temporal) || !Array.isArray(result.extent.temporal.interval))
    issues.push({ severity: 'error', collectionId: result.id, code: 'EXTENT_ABSENT', message: 'Complete original spatial and temporal collection extents are required.' });
  if (Array.isArray(result.extent?.spatial?.bbox)) {
    for (const box of result.extent.spatial.bbox) {
      const valid = Array.isArray(box) && [4, 6].includes(box.length) &&
        box.every(Number.isFinite) && Math.abs(box[0]) <= 180 && Math.abs(box[box.length / 2]) <= 180 &&
        Math.abs(box[1]) <= 90 && Math.abs(box[box.length / 2 + 1]) <= 90 &&
        box[1] <= box[box.length / 2 + 1] && (box.length !== 6 || box[2] <= box[5]);
      if (!valid) issues.push({ severity: 'error', collectionId: result.id, code: 'SPATIAL_EXTENT_INVALID',
        message: 'Review the complete original collection bounding box; geographic longitudes, latitudes and height bounds must be valid.' });
    }
    if (!result.extent.spatial.bbox.length) issues.push({ severity: 'error', collectionId: result.id,
      code: 'SPATIAL_EXTENT_EMPTY', message: 'The original collection needs its complete spatial extent.' });
  }
  if (Array.isArray(result.extent?.temporal?.interval)) {
    for (const range of result.extent.temporal.interval) {
      const valid = Array.isArray(range) && range.length === 2 && range.every(value =>
        value === null || typeof value === 'string' && Number.isFinite(Date.parse(value))) &&
        (range[0] === null || range[1] === null || Date.parse(range[0]) <= Date.parse(range[1]));
      if (!valid) issues.push({ severity: 'error', collectionId: result.id, code: 'TEMPORAL_EXTENT_INVALID',
        message: 'The original collection interval must preserve valid ordered dates or explicit open endpoints.' });
    }
    if (!result.extent.temporal.interval.length) issues.push({ severity: 'error', collectionId: result.id,
      code: 'TEMPORAL_EXTENT_EMPTY', message: 'The original collection needs its complete temporal extent.' });
  }
  return { original: copy(original), metadata: result, originalSha256: hash(original), metadataSha256: hash(result), sourceDocumentUrl: base };
}
/** Collections remain original collection-level descriptions, not a claim about selected scenes. */
export function buildCollectionSource({ delivery, collectionIds, sourceUrls = {}, title = 'STAC catalogue receiving' } = {}) {
  requireValue(delivery && isObject(delivery.manifest) && isObject(delivery.edition) && Array.isArray(delivery.edition.collections), 'CATALOGUE_VERIFIED_DELIVERY_REQUIRED');
  requireValue(Array.isArray(collectionIds) && collectionIds.length > 0 && collectionIds.length <= 10000 &&
    collectionIds.every(id => typeof id === 'string' && id.length && id.length <= 512) && new Set(collectionIds).size === collectionIds.length, 'CATALOGUE_COLLECTION_SELECTION_REQUIRED');
  requireValue(isObject(sourceUrls) && Object.keys(sourceUrls).every(id => collectionIds.includes(id)), 'CATALOGUE_SOURCE_URL_SELECTION_INVALID');
  const originals = new Map();
  for (const collection of delivery.edition.collections) {
    requireValue(isObject(collection) && collection.type === 'Collection' && typeof collection.id === 'string' && collection.id.length, 'CATALOGUE_ORIGINAL_COLLECTION_INVALID');
    requireValue(!originals.has(collection.id), 'CATALOGUE_COLLECTION_ID_COLLISION');
    originals.set(collection.id, collection);
  }
  const issues = [], collections = collectionIds.map(id => {
    requireValue(originals.has(id), 'CATALOGUE_COLLECTION_NOT_IN_DELIVERY', 'Collection ' + id + ' is not in this received edition.');
    return collectionMetadata(originals.get(id), sourceUrls[id], issues);
  });
  const sourceIdentity = Object.fromEntries(['schema', 'bundleSha256', 'selectionSha256', 'editionId', 'editionDigest', 'snapshot', 'nativeBindingSha256']
    .map(key => [key, delivery.manifest[key] ?? null]));
  requireValue(['bundleSha256', 'selectionSha256', 'editionDigest', 'nativeBindingSha256'].every(key => /^[a-f0-9]{64}$/.test(sourceIdentity[key] || '')), 'CATALOGUE_SOURCE_IDENTITY_INVALID');
  const document = { collections: collections.map(item => item.metadata) };
  const nativeRecords = collections.map(item => ({ collectionId: item.original.id, uuid: nativeRecordId(item.original.id) }));
  requireValue(nativeRecords.every(item => typeof item.uuid === 'string' && item.uuid.length &&
    !/[\/\\\u0000-\u001f]/.test(item.uuid) && !['.', '..'].includes(item.uuid)),
    'CATALOGUE_NATIVE_UUID_PATH_INVALID', 'The native UUID must be a single stable record identifier.');
  requireValue(new Set(nativeRecords.map(item => item.uuid)).size === nativeRecords.length,
    'CATALOGUE_NATIVE_UUID_COLLISION', 'Two original collection IDs resolve to the same native GeoNetwork UUID. Review the complete selected source before harvest.');
  const source = { nativeRecords, schema: SOURCE_SCHEMA, title: textValue(title, 'Catalogue title', 240), sourceIdentity,
    collectionIds: copy(collectionIds), collections, document, documentSha256: hash(document),
    completeSelectedSet: true, selectedCollectionCount: collections.length, issues };
  source.id = 'catalogue-source-' + hash(source).slice(0, 24);
  source.sha256 = hash(source);
  return source;
}
export function validateSource(source) {
  requireValue(source?.schema === SOURCE_SCHEMA && Array.isArray(source.collections) &&
    source.completeSelectedSet === true && source.selectedCollectionCount === source.collections.length &&
    source.document?.collections?.length === source.collections.length &&
    hash(source.document) === source.documentSha256, 'CATALOGUE_SOURCE_CHANGED');
  const core = { ...source }; delete core.sha256;
  requireValue(hash(core) === source.sha256, 'CATALOGUE_SOURCE_CHANGED');
  requireValue(source.collections.every((c, i) => hash(c.original) === c.originalSha256 && hash(c.metadata) === c.metadataSha256 &&
    canonicalJson(c.metadata) === canonicalJson(source.document.collections[i]) && c.original.id === c.metadata.id &&
    c.metadata.id === source.collectionIds[i]), 'CATALOGUE_SOURCE_CHANGED');
  return source;
}
export function compareCollectionSources(before, after) {
  validateSource(after);
  if (before) validateSource(before);
  const left = new Map((before?.collections || []).map(x => [x.original.id, x]));
  const right = new Map(after.collections.map(x => [x.original.id, x]));
  return { sourceBefore: before?.sha256 ?? null, sourceAfter: after.sha256,
    added: [...right.keys()].filter(id => !left.has(id)),
    removed: [...left.keys()].filter(id => !right.has(id)),
    changed: [...right.keys()].filter(id => left.has(id) && (left.get(id).originalSha256 !== right.get(id).originalSha256 || left.get(id).metadataSha256 !== right.get(id).metadataSha256)),
    unchanged: [...right.keys()].filter(id => left.has(id) && left.get(id).originalSha256 === right.get(id).originalSha256 && left.get(id).metadataSha256 === right.get(id).metadataSha256) };
}
export function normalizePlan(input, { workspaceId, source, previousSource = null } = {}) {
  validateSource(source); identifier(workspaceId, 'workspace ID');
  requireValue(isObject(input), 'CATALOGUE_PLAN_REQUIRED');
  const allowed = new Set(['title', 'ownerId', 'ownerGroupId', 'sourceUrl', 'privileges', 'validation', 'acknowledgedRemovals', 'postHarvestValidation', 'reviewNote']);
  requireValue(Object.keys(input).every(key => allowed.has(key)), 'CATALOGUE_PLAN_FIELD_UNKNOWN');
  requireValue(!source.issues.some(issue => issue.severity === 'error'), 'CATALOGUE_SOURCE_INPUTS_REQUIRED', source.issues.filter(x => x.severity === 'error').map(x => x.message).join(' '));
  const sourceUrl = absoluteHttp(input.sourceUrl, { allowHttp: true, label: 'Complete immutable collection document URL reachable from GeoNetwork' });
  requireValue(sourceUrl.pathname.includes(source.documentSha256), 'CATALOGUE_IMMUTABLE_SOURCE_URL_REQUIRED', 'Serve the complete document at a URL containing its document SHA-256.');
  const comparison = compareCollectionSources(previousSource, source);
  const removals = input.acknowledgedRemovals ?? [];
  requireValue(Array.isArray(removals) && new Set(removals).size === removals.length &&
    canonicalJson([...removals].sort()) === canonicalJson([...comparison.removed].sort()), 'CATALOGUE_REMOVAL_REVIEW_REQUIRED', 'Review every collection removed from this harvester before refresh.');
  const privileges = input.privileges ?? [];
  requireValue(Array.isArray(privileges) && privileges.length <= 1000, 'CATALOGUE_PRIVILEGES_INVALID');
  const seen = new Set();
  const groups = privileges.map(item => {
    requireValue(isObject(item) && Array.isArray(item.operations) && item.operations.length <= 6, 'CATALOGUE_PRIVILEGES_INVALID');
    const groupId = nativeId(item.groupId, 'privilege group ID');
    requireValue(!seen.has(groupId), 'CATALOGUE_PRIVILEGE_GROUP_REPEATED'); seen.add(groupId);
    requireValue(new Set(item.operations).size === item.operations.length &&
      item.operations.every(op => ['view', 'download', 'notify', 'dynamic', 'featured'].includes(op)), 'CATALOGUE_PRIVILEGE_OPERATION_INVALID');
    return { groupId, operations: [...item.operations].sort() };
  }).sort((a, b) => a.groupId.localeCompare(b.groupId));
  const validation = input.validation ?? 'NOVALIDATION';
  requireValue(['NOVALIDATION', 'XSDVALIDATION', 'SCHEMATRONVALIDATION'].includes(validation), 'CATALOGUE_VALIDATION_SELECTION_INVALID');
  const marker = '[sf-catalogue:' + hash(workspaceId).slice(0, 24) + ']';
  const plan = { schema: PLAN_SCHEMA, workspaceId, sourceId: source.id, sourceSha256: source.sha256,
    sourceDocumentSha256: source.documentSha256, sourceUrl: sourceUrl.href,
    title: textValue(input.title, 'Harvester title', 180), marker,
    ownerId: nativeId(input.ownerId, 'record owner ID'), ownerGroupId: nativeId(input.ownerGroupId, 'owner group ID'),
    privileges: groups, validation, postHarvestValidation: input.postHarvestValidation !== false, transform: TRANSFORM, loopElement: '/collections', recordIdPath: '/id',
    completeSelectedSet: true, expectedCollectionIds: copy(source.collectionIds), expectedRecordIds: source.nativeRecords.map(item => item.uuid),
    nativeRecords: copy(source.nativeRecords),
    acknowledgedRemovals: [...removals].sort(), comparison, reviewNote: textValue(input.reviewNote, 'Review note', 4000) };
  plan.nativeName = plan.title + ' ' + marker;
  plan.sha256 = hash(plan);
  return plan;
}
export function validatePlan(plan) {
  requireValue(plan?.schema === PLAN_SCHEMA && /^[a-f0-9]{64}$/.test(plan.sha256 || ''), 'CATALOGUE_PLAN_INVALID');
  const core = { ...plan }; delete core.sha256;
  requireValue(hash(core) === plan.sha256 && plan.transform === TRANSFORM && plan.completeSelectedSet === true, 'CATALOGUE_PLAN_CHANGED');
  return plan;
}
