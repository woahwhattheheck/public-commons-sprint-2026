// MIT. Read-only history over original runtime operation descriptors.
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code) => { if (!value) throw Object.assign(new Error(code), { code, status: 400 }); };
function encode(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function decode(value) {
  const source = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(source + '='.repeat((4 - source.length % 4) % 4));
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
}

const FIELDS = [
  'id', 'operation', 'runtimeId', 'homeId', 'applicationId', 'terminal', 'commandActive',
  'candidateId', 'pythonInstallationId', 'targetId', 'imageId', 'transferId', 'archiveId',
  'archiveSha256', 'profileId', 'cacheTransferId', 'sourceBuildId', 'sourceBuildOutput',
  'targetDirectory', 'createdAt', 'contextDirectory', 'transferDirectory', 'containerDirectory',
  'reviewId', 'deploymentReviewId', 'phase', 'displayPhase', 'workerActive',
  'startedAt', 'updatedAt', 'completedAt', 'attempt', 'pythonStage', 'sourceBuildStage', 'resultSource',
  'originalPhase', 'receivedHistory', 'receivingId',
];
export const OPERATION_HISTORY_FILTERS = ['all', 'active', 'attention', 'completed'];
function originalError(value) {
  return { code: String(value.code ?? ''), message: String(value.message ?? ''),
    ...(plain(value.flock) ? { flock: JSON.parse(JSON.stringify(value.flock)) } : {}) };
}
export function operationSummary(job) {
  const value = {};
  for (const key of FIELDS) if (Object.hasOwn(job, key) &&
      (job[key] === null || ['string', 'number', 'boolean'].includes(typeof job[key]))) value[key] = job[key];
  if (job.error) value.error = originalError(job.error);
  if (job.observation) value.observation = { status: job.observation.status, source: job.observation.source,
    checkedAt: job.observation.checkedAt, ...(job.observation.error ? { error: originalError(job.observation.error) } : {}) };
  value.resultAvailable = typeof job.resultAvailable === 'boolean' ? job.resultAvailable : job.result !== undefined && job.result !== null;
  value.commandResultAvailable = typeof job.commandResultAvailable === 'boolean' ? job.commandResultAvailable : job.commandResult !== undefined && job.commandResult !== null;
  return value;
}
const compare = (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id.localeCompare(a.id);
export function operationGroup(job) {
  if (job.observation?.status === 'UNAVAILABLE' || job.workerActive === null || job.commandActive === null)
    return 'attention';
  if (job.workerActive || job.commandActive || ['QUEUED', 'INITIALIZING', 'PENDING'].includes(job.phase))
    return 'active';
  return ['SUCCEEDED', 'STOPPED', 'CANCELLED'].includes(job.displayPhase ?? job.phase) ? 'completed' : 'attention';
}
export function operationHistory(workspaceId, operations, input = {}) {
  need(plain(input) && Object.keys(input).every(key => ['query', 'filter', 'runtimeId', 'limit', 'cursor'].includes(key)),
    'RUNTIME_OPERATION_HISTORY_FIELDS_INVALID');
  const { query = '', filter = 'all', runtimeId = null, limit = 20, cursor = null } = input;
  need(typeof query === 'string' && query.length <= 500 && !/[\u0000-\u001f]/.test(query),
    'RUNTIME_OPERATION_HISTORY_QUERY_INVALID');
  need(OPERATION_HISTORY_FILTERS.includes(filter), 'RUNTIME_OPERATION_HISTORY_FILTER_INVALID');
  need(runtimeId === null || typeof runtimeId === 'string' && /^[a-f0-9]{24}$/.test(runtimeId),
    'RUNTIME_OPERATION_HISTORY_RUNTIME_INVALID');
  need(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'RUNTIME_OPERATION_HISTORY_LIMIT_INVALID');
  const selection = { query: query.trim().toLowerCase(), filter, runtimeId };
  const binding = JSON.stringify([workspaceId, selection.query, selection.filter, selection.runtimeId]);
  let before = null;
  if (cursor !== null) {
    need(typeof cursor === 'string' && cursor.length <= 8192 && /^[a-zA-Z0-9_-]+$/.test(cursor),
      'RUNTIME_OPERATION_HISTORY_CURSOR_INVALID');
    try {
      const value = decode(cursor);
      need(encode(value) === cursor && plain(value) && value.schema === 'runtime-operation-page.v1' &&
        value.binding === binding && typeof value.createdAt === 'string' && value.createdAt.length <= 100 &&
        typeof value.id === 'string' && /^[a-f0-9-]{36}$/.test(value.id) &&
        Object.keys(value).sort().join(',') === 'binding,createdAt,id,schema',
        'RUNTIME_OPERATION_HISTORY_CURSOR_INVALID');
      before = { createdAt: value.createdAt, id: value.id };
    } catch (error) {
      if (error.code === 'RUNTIME_OPERATION_HISTORY_CURSOR_INVALID') throw error;
      need(false, 'RUNTIME_OPERATION_HISTORY_CURSOR_INVALID');
    }
  }
  const counts = { all: operations.length, active: 0, attention: 0, completed: 0 };
  for (const job of operations) counts[operationGroup(job)]++;
  const words = selection.query.split(/\s+/).filter(Boolean);
  const matches = operations.filter(job => {
    if (filter !== 'all' && operationGroup(job) !== filter) return false;
    if (runtimeId && job.runtimeId !== runtimeId && job.targetId !== runtimeId) return false;
    const text = ['id', 'operation', 'phase', 'displayPhase', 'runtimeId', 'targetId', 'homeId',
      'applicationId', 'sourceBuildId', 'cacheTransferId', 'imageId', 'transferId', 'targetDirectory',
      'sourceBuildOutput'].map(key => String(job[key] ?? '')).join(' ').toLowerCase();
    return words.every(word => text.includes(word));
  }).sort(compare);
  const remaining = before ? matches.filter(job => compare(job, before) > 0) : matches;
  const items = remaining.slice(0, limit).map(operationSummary), hasMore = remaining.length > items.length;
  const last = items.at(-1);
  const nextCursor = hasMore && last ? encode({ schema: 'runtime-operation-page.v1',
    binding, createdAt: last.createdAt ?? '', id: last.id }) : null;
  return { schema: 'stellar-forge.runtime-operation-history.v1', workspaceId,
    query, filter, runtimeId, limit, cursor, items, total: operations.length, matched: matches.length,
    counts, hasMore, nextCursor };
}
