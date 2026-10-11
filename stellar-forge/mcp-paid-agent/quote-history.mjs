/** MIT. Detached, cursor-paginated views of the broker's original quote records. */
export function historyPage(records, { status, limit = 25, cursor } = {}, project = value => structuredClone(value)) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      (status !== undefined && (typeof status !== 'string' || status.length > 64)))
    throw Object.assign(new TypeError('Invalid quote history filter'), { code: 'INVALID_PARAMS' });
  let boundary;
  if (cursor !== undefined) {
    try {
      if (typeof cursor !== 'string' || cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw Error();
      boundary = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (!Number.isSafeInteger(boundary.createdAt) || typeof boundary.quoteId !== 'string' || boundary.quoteId.length !== 36)
        throw Error();
    } catch { throw Object.assign(new TypeError('Invalid quote history cursor'), { code: 'INVALID_PARAMS' }); }
  }
  const all = [...records].filter(row => status === undefined || row.status === status)
    .sort((a, b) => b.createdAt - a.createdAt || b.quoteId.localeCompare(a.quoteId));
  const remaining = all.filter(row => !boundary || row.createdAt < boundary.createdAt ||
    (row.createdAt === boundary.createdAt && row.quoteId < boundary.quoteId));
  const page = remaining.slice(0, limit), last = page.at(-1);
  return { quotes: page.map(project), total: all.length,
    nextCursor: remaining.length > page.length ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, quoteId: last.quoteId })).toString('base64url') : null };
}
