// MIT. One synchronous read of selected ORIGINAL native lifecycle revisions.
import { createHash } from 'node:crypto';

export const REVISION_SNAPSHOT_SCHEMA = 'stellar-forge.catalog-revision-snapshot/v1';
export const MAX_REVISION_TARGETS = 1000;
export const MAX_REVISION_PAGE_BYTES = 4 * 1024 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = code => { throw new Error(code); };
export const revisionTargetKey = target => JSON.stringify([target.catalogKey, target.sequence]);
export const revisionTargetsDigest = targets => createHash('sha256').update(JSON.stringify(targets)).digest('hex');

/** Keep the complete query with each page. Continuations bind its exact order and head. */
export function validateRevisionSelection(input) {
  if (!plain(input) || !Object.hasOwn(input, 'targets') ||
      Object.keys(input).some(key => !['targets', 'offset', 'expectedHead', 'expectedTargets', 'pageBytes'].includes(key)))
    fail('REVISION_SELECTION_FIELDS_INVALID');
  const { targets, offset = 0, expectedHead, expectedTargets, pageBytes = MAX_REVISION_PAGE_BYTES } = input;
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > MAX_REVISION_TARGETS)
    fail('REVISION_TARGET_LIMIT');
  for (const target of targets) {
    if (!plain(target) || Object.keys(target).length !== 2 ||
        typeof target.catalogKey !== 'string' || !target.catalogKey.length || target.catalogKey.length > 4096 ||
        !Number.isSafeInteger(target.sequence) || target.sequence < 1) fail('REVISION_TARGET_INVALID');
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= targets.length) fail('REVISION_OFFSET_INVALID');
  if (!Number.isSafeInteger(pageBytes) || pageBytes < 16384 || pageBytes > MAX_REVISION_PAGE_BYTES)
    fail('REVISION_PAGE_BYTES_INVALID');
  const targetsSha256 = revisionTargetsDigest(targets);
  if (expectedHead !== undefined && !hex(expectedHead)) fail('REVISION_HEAD_INVALID');
  if (expectedTargets !== undefined && (!hex(expectedTargets) || expectedTargets !== targetsSha256))
    fail('REVISION_TARGETS_CHANGED');
  if (offset && (expectedHead === undefined || expectedTargets === undefined)) fail('REVISION_CONTINUATION_BINDING_REQUIRED');
  return { targets, offset, expectedHead, targetsSha256, pageBytes };
}

/** lookup/revision are synchronous original in-memory projections under the writer's
 * serialized command. No snapshots are retained, no second index/store is created.
 * Only detached selected revisions leave the native lifecycle, never whole histories.
 */
export function buildRevisionSnapshot(input, { head, count, lookup, revision }) {
  const { targets, offset, expectedHead, targetsSha256, pageBytes } = validateRevisionSelection(input);
  if (expectedHead !== undefined && expectedHead !== head) fail('REVISION_SNAPSHOT_HEAD_CHANGED');
  const rows = [], currentByKey = new Map();
  let bytes = 1024, next = offset;
  for (; next < targets.length; next++) {
    const target = targets[next];
    if (!currentByKey.has(target.catalogKey)) currentByKey.set(target.catalogKey, lookup(target.catalogKey));
    const current = currentByKey.get(target.catalogKey);
    const selected = current ? revision(current.lifecycleId, target.sequence) : null;
    const row = { catalogKey: target.catalogKey, sequence: target.sequence, current,
      history: selected ? [selected] : [] };
    const rowBytes = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (bytes + rowBytes > pageBytes) {
      if (!rows.length) fail('REVISION_PAGE_LIMIT_TOO_SMALL');
      break;
    }
    bytes += rowBytes; rows.push(row);
  }
  return { schema: REVISION_SNAPSHOT_SCHEMA, journalHead: head, committedOperations: count,
    targetsSha256, total: targets.length, offset, nextOffset: next < targets.length ? next : null,
    rows, maxPageBytes: pageBytes };
}

/** Validate native paging before it is used as recovery evidence. Exported so a
 * caller already holding an authenticated operator response need not read it again.
 */
export function validateRevisionPage(page, { targets, offset, head, policySha256 } = {}) {
  if (!plain(page) || page.schema !== REVISION_SNAPSHOT_SCHEMA || !hex(page.journalHead) ||
      !hex(page.policySha256) || page.targetsSha256 !== revisionTargetsDigest(targets) ||
      page.total !== targets.length || page.offset !== offset || !Array.isArray(page.rows) ||
      !page.rows.length || page.rows.length > targets.length - offset) fail('NATIVE_REVISION_PAGE_INVALID');
  if (head !== undefined && page.journalHead !== head) fail('REVISION_SNAPSHOT_HEAD_CHANGED');
  if (policySha256 !== undefined && page.policySha256 !== policySha256) fail('REVISION_SNAPSHOT_POLICY_CHANGED');
  const end = offset + page.rows.length;
  if (page.nextOffset !== (end < targets.length ? end : null)) fail('NATIVE_REVISION_PAGE_PROGRESS_INVALID');
  for (const [index, row] of page.rows.entries()) {
    const target = targets[offset + index];
    if (!plain(row) || row.catalogKey !== target.catalogKey || row.sequence !== target.sequence ||
        !(row.current === null || plain(row.current)) || !Array.isArray(row.history) || row.history.length > 1 ||
        row.history.some(item => !plain(item) || item.sequence !== target.sequence) ||
        (row.current === null && row.history.length)) fail('NATIVE_REVISION_PAGE_ROW_INVALID');
  }
  return page;
}
