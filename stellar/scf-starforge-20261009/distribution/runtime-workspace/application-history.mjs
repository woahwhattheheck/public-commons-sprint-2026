// MIT. Read-only pagination over the original immutable application run records.
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { recordId, operationId, readJSON, need } from './storage.mjs';

const indexes = new Map();
const MAX_INDEXES = 64;
const MAX_INDEX_ROWS = 100000;
const MAX_INDEX_AGE = 60000;
const runName = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/;
const order = (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
const signature = value => [value.dev, value.ino, value.mtimeNs, value.ctimeNs].join(':');
const directoryFor = (root, id) => join(root, 'applications', recordId(id), 'runs');

export function applicationHistoryLimit(value, fallback = 30) {
  if (value === undefined) return fallback;
  need(typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 100,
    'APPLICATION_HISTORY_LIMIT_INVALID', 'Choose between 1 and 100 operations per page');
  return value;
}
async function index(root, id) {
  const directory = directoryFor(root, id), observed = signature(await lstat(directory, { bigint: true }));
  const cached = indexes.get(directory);
  if (cached && cached.signature === observed && Date.now() - cached.created < MAX_INDEX_AGE) {
    indexes.delete(directory); indexes.set(directory, cached);
    return cached.rows;
  }
  const names = (await readdir(directory)).filter(name => runName.test(name));
  const rows = [];
  // Only the chronology is cached. Requests, outcomes, leases and URLs are read
  // from their original records on every page; action decisions never use this index.
  for (let offset = 0; offset < names.length; offset += 16) {
    const batch = await Promise.all(names.slice(offset, offset + 16).map(async name => {
      const value = await readJSON(join(directory, name));
      need(value.applicationId === id && value.id + '.json' === name &&
        typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)),
      'APPLICATION_OPERATION_CHANGED');
      return { id: value.id, createdAt: value.createdAt };
    }));
    rows.push(...batch);
  }
  rows.sort(order);
  // Atomic saves change the directory signature. An append during this read is
  // visible on the next request instead of making a partial index reusable.
  const after = signature(await lstat(directory, { bigint: true }));
  indexes.delete(directory);
  if (after === observed && rows.length <= MAX_INDEX_ROWS) {
    let retainedRows = [...indexes.values()].reduce((total, entry) => total + entry.rows.length, 0);
    while (indexes.size >= MAX_INDEXES || retainedRows + rows.length > MAX_INDEX_ROWS) {
      const key = indexes.keys().next().value;
      retainedRows -= indexes.get(key).rows.length; indexes.delete(key);
    }
    indexes.set(directory, { signature: observed, created: Date.now(), rows });
  }
  return rows;
}
function decodeCursor(value, applicationId) {
  if (value === undefined || value === null) return null;
  need(typeof value === 'string' && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value),
    'APPLICATION_HISTORY_CURSOR_INVALID');
  let cursor;
  try { cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { need(false, 'APPLICATION_HISTORY_CURSOR_INVALID'); }
  need(cursor?.version === 1 && cursor.applicationId === applicationId &&
    typeof cursor.createdAt === 'string' && Number.isFinite(Date.parse(cursor.createdAt)),
  'APPLICATION_HISTORY_CURSOR_INVALID', 'Use a history cursor returned for this application');
  operationId(cursor.id);
  return cursor;
}
const encodeCursor = (applicationId, value) => Buffer.from(JSON.stringify({
  version: 1, applicationId, createdAt: value.createdAt, id: value.id,
})).toString('base64url');

export async function applicationRunPage(root, { applicationId, limit, cursor } = {}) {
  recordId(applicationId);
  limit = applicationHistoryLimit(limit);
  const anchor = decodeCursor(cursor, applicationId), rows = await index(root, applicationId);
  const eligible = anchor ? rows.filter(row => order(row, anchor) > 0) : rows;
  const selected = eligible.slice(0, limit);
  const runs = await Promise.all(selected.map(async row => {
    const saved = await readJSON(join(directoryFor(root, applicationId), row.id + '.json'));
    need(saved.applicationId === applicationId && saved.id === row.id && saved.createdAt === row.createdAt,
      'APPLICATION_OPERATION_CHANGED', 'Refresh this application history');
    return saved;
  }));
  return { applicationId, runs, totalRuns: rows.length, limit,
    cursor: cursor ?? null, nextCursor: eligible.length > selected.length ?
      encodeCursor(applicationId, selected[selected.length - 1]) : null };
}
