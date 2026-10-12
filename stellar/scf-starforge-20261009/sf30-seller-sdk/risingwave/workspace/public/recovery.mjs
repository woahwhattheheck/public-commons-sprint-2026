// MIT. Complete browser drafts and original operation selections.
export const BROWSER_STATE_SCHEMA = 'stellar-forge.risingwave-browser-state.v1';
export const MAX_BROWSER_STATE_BYTES = 8 * 1024 * 1024;
export const RECOVERABLE_ROUTE = /^(?:save|subscription\/(?:prepare|create)|capture(?:\/(?:resume|recover|cancel))?|captures\/compare|publications|publications\/[a-z][a-z0-9-]{0,100}\/(?:buyer|seller\/(?:start|stop)))$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const item = /^[a-z][a-z0-9-]{0,100}$/;
export const canonical = value => Array.isArray(value) ? value.map(canonical) :
  plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
export function validateBrowserState(value, workspaceIdentity) {
  if (!plain(value) || value.schema !== BROWSER_STATE_SCHEMA || !/^[a-f0-9]{64}$/.test(value.workspaceIdentity ?? '') ||
      workspaceIdentity && value.workspaceIdentity !== workspaceIdentity)
    throw new Error('This browser workspace belongs to a different saved workbench.');
  if (!Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0 || !plain(value.form) ||
      !plain(value.parameterInputs) || !plain(value.requests) || !plain(value.view) || !Array.isArray(value.journal) ||
      !Array.isArray(value.columns) || !Array.isArray(value.parameters) || !Array.isArray(value.filters) ||
      !Array.isArray(value.payments) || !plain(value.source) || value.merchant !== null && !plain(value.merchant) ||
      typeof value.dirty !== 'boolean' || typeof value.reportDirty !== 'boolean' || typeof value.selectedReport !== 'string')
    throw new Error('Import a complete RisingWave browser workspace.');
  for (const field of Object.values(value.form)) {
    if (!plain(field) || !['value','checked'].includes(field.kind) ||
        field.kind === 'value' && typeof field.value !== 'string' || field.kind === 'checked' && typeof field.value !== 'boolean')
      throw new Error('A retained browser field is invalid.');
  }
  for (const entries of Object.values(value.requests)) {
    if (!Array.isArray(entries) || entries.some(entry => !Array.isArray(entry) || entry.length !== 2 ||
        typeof entry[0] !== 'string' || !plain(entry[1])))
      throw new Error('Retain the complete original operation map.');
  }
  for (const entry of value.journal) {
    if (!plain(entry) || !item.test(entry.id ?? '') || !RECOVERABLE_ROUTE.test(entry.path ?? '') ||
        !plain(entry.body) || !['PREPARED','IN_FLIGHT','RETURNED','ERROR'].includes(entry.state))
      throw new Error('Retain the original operation route, request and result state.');
  }
  if (new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n').byteLength > MAX_BROWSER_STATE_BYTES)
    throw new Error('This complete browser workspace exceeds 8 MiB. Export it before starting a fresh browser draft.');
  return structuredClone(value);
}
export function originalRequest(maps, name, input, idField, prefix) {
  maps[name] ??= new Map();
  const key = JSON.stringify(canonical(input));
  let request = maps[name].get(key);
  if (!request) {
    request = {...structuredClone(input), [idField]: prefix + '-' + Date.now() + '-' + crypto.randomUUID()};
    maps[name].set(key, request);
  }
  return request;
}
export function recordOperation(journal, path, body) {
  let entry = journal.find(value => value.path === path && same(value.body, body));
  if (!entry) {
    entry = {id: 'operation-' + Date.now() + '-' + crypto.randomUUID(), path, body: structuredClone(body),
      state: 'PREPARED', createdAt: new Date().toISOString(), attempts: 0};
    journal.push(entry);
  }
  return entry;
}
export function operationReceipt(value) {
  if (!plain(value)) return null;
  const result = {};
  for (const name of ['id','requestId','captureId','comparisonId','revision','state','savedAt','snapshot','configSha256','offerSha256','intentId','path'])
    if (value[name] !== undefined && (value[name] === null || ['string','number','boolean'].includes(typeof value[name])))
      result[name] = value[name];
  if (plain(value.result)) result.result = {status: value.result.status, requestId: value.result.requestId};
  if (plain(value.saveOperation)) result.saveOperation = structuredClone(value.saveOperation);
  return result;
}

export function mergeDraft(base, draft, saved, choose = () => undefined, path = []) {
  if (same(draft, base)) return {value: structuredClone(saved), conflicts: []};
  if (same(saved, base) || same(draft, saved)) return {value: structuredClone(draft), conflicts: []};
  if (plain(base) && plain(draft) && plain(saved)) {
    const value = {}, conflicts = [];
    for (const name of new Set([...Object.keys(base), ...Object.keys(draft), ...Object.keys(saved)])) {
      const result = mergeDraft(base[name], draft[name], saved[name], choose, [...path, name]);
      if (result.value !== undefined) value[name] = result.value;
      conflicts.push(...result.conflicts);
    }
    return {value, conflicts};
  }
  const conflict = {path, base: structuredClone(base), draft: structuredClone(draft), saved: structuredClone(saved)};
  const key = JSON.stringify(canonical(conflict)), decision = choose(key);
  if (decision === 'draft' || decision === 'saved') return {value: structuredClone(conflict[decision]), conflicts: []};
  return {value: structuredClone(draft), conflicts: [{...conflict, key}]};
}
