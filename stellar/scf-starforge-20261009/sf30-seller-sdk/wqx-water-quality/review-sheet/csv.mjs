// MIT. Editable decision tables share one source header and retain exact string values.
import { REVIEW_SHEET_SCHEMA, REVIEW_SHEET_MAX_DECISIONS, normalizeReviewSheetDocument,
  reviewSheetSource, reviewSheetTargetId, iterateReviewSheetTargets, reviewSheetFail } from './model.mjs';

export const REVIEW_SHEET_TABLE_COLUMNS = Object.freeze([
  'targetId', 'kind', 'sourceKey', 'sourceId', 'field', 'matchValue', 'currentValue',
  'savedChoice', 'type', 'issueCodes', 'action', 'value', 'reason',
]);
const MAX_BYTES = 64 * 1024 * 1024, MAX_CELL = 4 * 1024 * 1024;
const quoted = (value, delimiter) => {
  const text = String(value);
  return text.includes(delimiter) || /["\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
};
function line(values, delimiter) { return values.map(x => quoted(x, delimiter)).join(delimiter) + '\r\n'; }
function table(plan, document, query, delimiter) {
  const source = reviewSheetSource(plan);
  const normalized = normalizeReviewSheetDocument(document ?? { schema: REVIEW_SHEET_SCHEMA,
    sourcePlanId: source.sourcePlanId, sourcePlanSha256: source.sourcePlanSha256, decisions: [] });
  if (normalized.sourcePlanId !== source.sourcePlanId || normalized.sourcePlanSha256 !== source.sourcePlanSha256)
    reviewSheetFail('The draft belongs to a different saved source plan.', 'WQX_REVIEW_SHEET_SOURCE_CHANGED', 409);
  const decisions = new Map(normalized.decisions.map(row => [row.targetId, row])), included = new Set();
  const lines = [line([REVIEW_SHEET_SCHEMA, source.sourcePlanId, source.sourcePlanSha256], delimiter),
    line(REVIEW_SHEET_TABLE_COLUMNS, delimiter)];
  let bytes = Buffer.byteLength(lines.join(''));
  const add = row => {
    if (included.has(row.targetId)) return;
    included.add(row.targetId);
    const decision = decisions.get(row.targetId) ?? { action: 'keep', reason: '' };
    const value = decision.action === 'set' ? decision.value : '';
    const text = line([row.targetId, row.kind, row.sourceKey, row.sourceId, row.field,
      JSON.stringify(row.matchValue), row.currentValue, JSON.stringify(row.savedChoice), row.type,
      JSON.stringify(row.issueCodes), decision.action, value, decision.reason ?? ''], delimiter);
    bytes += Buffer.byteLength(text);
    if (bytes > MAX_BYTES) reviewSheetFail('This editable table exceeds 64 MiB. Export a selected kind or field.', 'WQX_REVIEW_SHEET_TABLE_TOO_LARGE', 413);
    lines.push(text);
  };
  for (const row of iterateReviewSheetTargets(plan, { ...query, attentionOnly: query.attentionOnly ?? false })) add(row);
  // A filtered download still carries every marked decision in the draft.
  if ([...decisions.keys()].some(key => !included.has(key))) {
    const missing = new Set([...decisions.keys()].filter(key => !included.has(key)));
    for (const row of iterateReviewSheetTargets(plan, { attentionOnly: false })) if (missing.has(row.targetId)) add(row);
  }
  if ([...decisions.keys()].some(key => !included.has(key)))
    reviewSheetFail('A draft target is absent from this original source plan.', 'WQX_REVIEW_SHEET_TARGET_CHANGED', 409);
  return lines.join('');
}
export const reviewSheetCsv = (plan, document, query = {}) => table(plan, document, query, ',');
export const reviewSheetTsv = (plan, document, query = {}) => table(plan, document, query, '\t');

// The native SF30 CSV grammar, extended with a declared one-character delimiter.
// It preserves quoted tabs/newlines and rejects characters after a closing quote.
function records(text, delimiter, onRecord) {
  let row = [], cell = [], fragments = [], size = 0, mode = 0, started = false, skipLF = false, first = true;
  function append(character) {
    size += character.length; started = true;
    if (size > MAX_CELL) reviewSheetFail('An editable table cell exceeds 4 MiB.');
    cell.push(character);
    if (cell.length === 2048) { fragments.push(cell.join('')); cell = []; }
  }
  function field() {
    if (cell.length) fragments.push(cell.join(''));
    row.push(fragments.join('')); cell = []; fragments = []; size = 0; mode = 0; started = false;
    if (row.length > 32) reviewSheetFail('The decision table has too many columns.');
  }
  function record() { field(); onRecord(row); row = []; }
  for (const character of text) {
    if (first) { first = false; if (character === '\uFEFF') continue; }
    if (skipLF) { skipLF = false; if (character === '\n') continue; }
    if (mode === 1) { if (character === '"') mode = 2; else append(character); continue; }
    if (mode === 2 && character === '"') { append('"'); mode = 1; continue; }
    if (character === delimiter) { field(); continue; }
    if (character === '\n' || character === '\r') { record(); skipLF = character === '\r'; continue; }
    if (mode === 2) reviewSheetFail('The table contains text after a closing quote.');
    if (character === '"') {
      if (started) reviewSheetFail('A table quote must begin a field.');
      mode = 1; started = true;
    } else append(character);
  }
  if (mode === 1) reviewSheetFail('The table contains an unterminated quoted field.');
  if (started || size || row.length || mode === 2) record();
}
function parse(text, delimiter) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) reviewSheetFail('Choose a decision table of at most 64 MiB.');
  let source, header = false, count = 0;
  const decisions = [], seen = new Set();
  records(text, delimiter, cells => {
    if (cells.length === 1 && cells[0] === '') return;
    if (!source) {
      if (cells.length !== 3 || cells[0] !== REVIEW_SHEET_SCHEMA)
        reviewSheetFail('Retain the table’s first row: schema, original source plan name, original source plan SHA-256.');
      source = { schema: cells[0], sourcePlanId: cells[1], sourcePlanSha256: cells[2], decisions: [] };
      normalizeReviewSheetDocument(source); return;
    }
    if (!header) {
      if (JSON.stringify(cells) !== JSON.stringify(REVIEW_SHEET_TABLE_COLUMNS))
        reviewSheetFail('Retain the original decision table header and column order.');
      header = true; return;
    }
    if (cells.length !== REVIEW_SHEET_TABLE_COLUMNS.length) reviewSheetFail('A decision table row has a different column count.');
    if (++count > REVIEW_SHEET_MAX_DECISIONS) reviewSheetFail('The decision table has too many target rows.');
    const row = Object.fromEntries(REVIEW_SHEET_TABLE_COLUMNS.map((key, index) => [key, cells[index]]));
    try {
      row.matchValue = JSON.parse(row.matchValue); row.savedChoice = JSON.parse(row.savedChoice);
      const saved = row.savedChoice;
      if ((row.matchValue !== null && typeof row.matchValue !== 'string') || !saved || typeof saved !== 'object' ||
        Array.isArray(saved) || Object.keys(saved).sort().join(',') !== 'present,reason,value' ||
        typeof saved.present !== 'boolean' || (saved.value !== null && typeof saved.value !== 'string') ||
        (saved.reason !== null && typeof saved.reason !== 'string')) throw new Error();
    } catch { reviewSheetFail('The original match value or saved-choice metadata changed. Edit action, value and reason.'); }
    if (reviewSheetTargetId(source.sourcePlanSha256, row) !== row.targetId)
      reviewSheetFail('A read-only target identity or base value changed in the table. Edit action, value and reason.',
        'WQX_REVIEW_SHEET_TARGET_CHANGED', 409);
    if (seen.has(row.targetId)) reviewSheetFail('The table repeats an original decision target.');
    seen.add(row.targetId);
    const action = row.action.trim().toLowerCase();
    if (!['keep', 'set', 'clear'].includes(action)) reviewSheetFail('Use keep, set or clear in the action column.');
    if (action !== 'set' && row.value !== '') reviewSheetFail('Leave value empty for keep or clear. Set accepts an explicit empty string.');
    if (action !== 'keep' || row.reason !== '') decisions.push({ targetId: row.targetId, action,
      ...(action === 'set' ? { value: row.value } : {}), reason: row.reason });
  });
  if (!source || !header) reviewSheetFail('The complete decision table needs its source row and column header.');
  return normalizeReviewSheetDocument({ ...source, decisions });
}
export const parseReviewSheetCsv = text => parse(text, ',');
export const parseReviewSheetTsv = text => parse(text, '\t');
