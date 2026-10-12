// MIT. GDELT 2.0 Event/Mentions source meanings and lossless projections.
import { createHash } from 'node:crypto';

export const CAPTURE = 'stellar-forge.gdelt-capture.v1';
export const SCHEMA = 'stellar-forge.gdelt-schema.v1';
export const PROJECT = 'stellar-forge.gdelt-project.v1';
export const BUNDLE = 'stellar-forge.gdelt-project-bundle.v1';
export const MANIFEST_URL = 'https://data.gdeltproject.org/gdeltv2/lastupdate.txt';
export const PROJECT_URL = 'https://www.gdeltproject.org/';
export const TERMS_URL = 'https://www.gdeltproject.org/about.html';
export const CODEBOOK_URL = 'https://data.gdeltproject.org/documentation/GDELT-Event_Codebook-V2.0.pdf';
export const ATTRIBUTION = 'Source: The GDELT Project — https://www.gdeltproject.org/';
export const NOTICE = 'GDELT 2.0 records automated extraction from monitored reporting. Events are newly recorded in their update; Mentions can refer to older events. A selected batch or collection is a coverage window, not a complete account of world events.';
export const LIMITS = Object.freeze({ zipBytes: 24 * 1024 * 1024, tableBytes: 64 * 1024 * 1024,
  captureBytes: 192 * 1024 * 1024, projectBytes: 256 * 1024 * 1024, rows: 1000000,
  captures: 32, cellChars: 262144, pageBytes: 900 * 1024, manifestBytes: 1024 * 1024 });
export const need = (condition, message, code = 'GDELT_INVALID', status = 400) => {
  if (!condition) throw Object.assign(new Error(message), { code, status });
};
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  need(value === null || typeof value === 'string' || typeof value === 'boolean' ||
    typeof value === 'number' && Number.isFinite(value), 'Use complete finite JSON values.');
  return JSON.stringify(value);
}
export const clone = value => structuredClone(value);
export const hash = value => createHash('sha256').update(value).digest('hex');
export const digest = value => hash(canonical(value));
export const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function operationId(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value), 'Use a stable operation ID containing letters, digits, underscore or hyphen.');
  return value;
}
export function batchId(value) {
  need(typeof value === 'string' && /^\d{14}$/.test(value), 'Use a GDELT UTC update timestamp YYYYMMDDHHMMSS.');
  const date = new Date(value.slice(0,4) + '-' + value.slice(4,6) + '-' + value.slice(6,8) +
    'T' + value.slice(8,10) + ':' + value.slice(10,12) + ':' + value.slice(12,14) + 'Z');
  need(Number.isFinite(date.valueOf()) && date.toISOString().slice(0,19).replaceAll(/[-T:]/g,'') === value &&
    Number(value.slice(10,12)) % 15 === 0 && value.endsWith('00'), 'Select an actual 15-minute UTC GDELT batch.');
  return value;
}
const actors = actor => ['Code','Name','CountryCode','KnownGroupCode','EthnicCode','Religion1Code','Religion2Code','Type1Code','Type2Code','Type3Code'].map(field => actor + field);
const geo = prefix => ['Type','FullName','CountryCode','ADM1Code','ADM2Code','Lat','Long','FeatureID'].map(field => prefix + '_' + field);
export const EVENT_FIELDS = Object.freeze(['GlobalEventID','SQLDATE','MonthYear','Year','FractionDate',
  ...actors('Actor1'), ...actors('Actor2'), 'IsRootEvent','EventCode','EventBaseCode','EventRootCode','QuadClass',
  'GoldsteinScale','NumMentions','NumSources','NumArticles','AvgTone', ...geo('Actor1Geo'), ...geo('Actor2Geo'),
  ...geo('ActionGeo'), 'DATEADDED','SOURCEURL']);
export const MENTION_FIELDS = Object.freeze(['GlobalEventID','EventTimeDate','MentionTimeDate','MentionType',
  'MentionSourceName','MentionIdentifier','SentenceID','Actor1CharOffset','Actor2CharOffset','ActionCharOffset',
  'InRawText','Confidence','MentionDocLen','MentionDocTone','MentionDocTranslationInfo','Extras']);
export const EVENT_LOOKUP_FIELDS = Object.freeze(['SQLDATE','Actor1Name','Actor1CountryCode','Actor2Name','Actor2CountryCode',
  'EventCode','EventRootCode','QuadClass','GoldsteinScale','ActionGeo_CountryCode','ActionGeo_FullName','DATEADDED','SOURCEURL']);
const INTEGER_FIELDS = new Set(['Year','IsRootEvent','QuadClass','NumMentions','NumSources','NumArticles',
  'Actor1Geo_Type','Actor2Geo_Type','ActionGeo_Type','MentionType','SentenceID','Actor1CharOffset','Actor2CharOffset',
  'ActionCharOffset','InRawText','Confidence','MentionDocLen','source_row']);
const DECIMAL_FIELDS = new Set(['FractionDate','GoldsteinScale','AvgTone','Actor1Geo_Lat','Actor1Geo_Long',
  'Actor2Geo_Lat','Actor2Geo_Long','ActionGeo_Lat','ActionGeo_Long','MentionDocTone']);
export function columnMeaning(name) {
  const original = name.startsWith('Event_') ? name.slice(6) : name;
  let meaning = 'Original GDELT source text, preserved exactly.';
  if (original === 'GlobalEventID') meaning = 'Opaque event identifier retained as text; its numeric order is not chronology.';
  else if (original === 'SQLDATE') meaning = 'Event calendar day YYYYMMDD; distinct from the GDELT recording/update timestamp.';
  else if (original === 'DATEADDED' || original === 'EventTimeDate') meaning = 'UTC 15-minute timestamp when GDELT first recorded the event.';
  else if (original === 'MentionTimeDate' || original === 'source_batch') meaning = 'UTC 15-minute source update YYYYMMDDHHMMSS.';
  else if (original === 'source_row') meaning = 'One-based original physical TSV record ordinal, including repeated mentions.';
  else if (original === 'source_batch_event') meaning = 'Source update of the selected matching event record; empty when absent.';
  else if (original === 'event_match') meaning = 'MATCHED, NOT_IN_COLLECTION or AMBIGUOUS; no older event is invented.';
  else if (original === 'event_candidates') meaning = 'Number of distinct source event records for this identifier in the selected collection.';
  else if (original.includes('Geo_CountryCode')) meaning = 'FIPS10-4 two-character geographic country code; not ISO.';
  else if (/Actor[12]CountryCode/.test(original)) meaning = 'CAMEO actor affiliation country code; distinct from geographic location.';
  else if (original.endsWith('ADM2Code')) meaning = 'Original GAUL/US county administrative code, preserved as text.';
  else if (original.endsWith('FeatureID')) meaning = 'Original geographic feature identifier; may be negative or textual.';
  else if (/^(EventCode|EventBaseCode|EventRootCode|Actor[12].*Code)$/.test(original)) meaning = 'Original CAMEO code; leading zeros and code composition are preserved.';
  else if (['NumMentions','NumSources','NumArticles','AvgTone'].includes(original)) meaning = 'Metric from the event’s original observation update; not a cumulative count across later mention updates.';
  else if (original === 'FractionDate') meaning = 'Original approximate fractional year; it is not an exact calendar timestamp.';
  else if (original === 'GoldsteinScale') meaning = 'CAMEO event-type score, not a measurement of this event’s size or impact.';
  else if (original === 'Confidence') meaning = 'Automated extraction confidence, 10–100; not a probability that the event is true.';
  else if (original === 'MentionIdentifier') meaning = 'Source identifier interpreted using MentionType; it can be a URL, DOI or textual citation.';
  else if (original === 'MentionDocTranslationInfo') meaning = 'Original language/translation provenance; blank also covers sources supplied in English.';
  const integer = INTEGER_FIELDS.has(original) || original === 'event_candidates';
  return { name, sourceField: original, type: integer ? 'integer' : 'string', nullable: !['source_batch','source_row','event_match','event_candidates'].includes(original),
    encoding: DECIMAL_FIELDS.has(original) ? 'decimal-text' : integer ? 'exact-safe-integer' : 'source-text', meaning };
}
export function tableFields(table) {
  need(['events','mentions','related-mentions'].includes(table), 'Choose events, mentions or related-mentions.');
  return ['source_batch','source_row', ...(table === 'events' ? EVENT_FIELDS : MENTION_FIELDS),
    ...(table === 'related-mentions' ? ['event_match','event_candidates','source_batch_event', ...EVENT_LOOKUP_FIELDS.map(field => 'Event_' + field)] : [])];
}
export function parseManifest(body, { selectedBatch } = {}) {
  need(typeof body === 'string' && Buffer.byteLength(body) <= LIMITS.manifestBytes && !body.includes('\0'), 'Use a complete GDELT manifest response within 1 MiB.');
  const entries = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line) continue;
    const match = /^([0-9]+) ([a-fA-F0-9]{32}) (https?:\/\/data\.gdeltproject\.org\/gdeltv2\/(\d{14})\.(export\.CSV|mentions\.CSV|gkg\.csv)\.zip)$/.exec(line);
    need(match, 'GDELT manifest contains an unexpected line; retain and inspect the original response.');
    const bytes = Number(match[1]), batch = batchId(match[4]);
    need(Number.isSafeInteger(bytes) && bytes >= 0, 'Invalid advertised source size.');
    const kind = match[5] === 'export.CSV' ? 'events' : match[5] === 'mentions.CSV' ? 'mentions' : 'gkg';
    entries.push({ batch, kind, bytes, md5: match[2].toLowerCase(), advertisedUrl: match[3],
      url: match[3].replace(/^http:/, 'https:'), member: batch + '.' + match[5] });
  }
  need(entries.length > 0 && new Set(entries.map(item => item.advertisedUrl)).size === entries.length, 'Manifest entries must be nonempty and unique.');
  const batches = [...new Set(entries.filter(item => item.kind !== 'gkg').map(item => item.batch))].sort();
  const batch = selectedBatch === undefined ? batches.at(-1) : batchId(selectedBatch);
  const selected = ['events','mentions'].map(kind => {
    const choices = entries.filter(item => item.batch === batch && item.kind === kind);
    need(choices.length === 1, 'The selected batch requires exactly one Event and one Mentions file.');
    need(choices[0].bytes <= LIMITS.zipBytes, 'Selected ZIP exceeds the supported 24 MiB per-file capacity.', 'GDELT_SOURCE_TOO_LARGE', 413);
    return choices[0];
  });
  return { batch, selected, availableBatches: batches };
}
export function parseTable(text, kind, batch) {
  const fields = kind === 'events' ? EVENT_FIELDS : MENTION_FIELDS;
  need(['events','mentions'].includes(kind) && typeof text === 'string' && Buffer.byteLength(text) <= LIMITS.tableBytes &&
    !text.includes('\0') && !text.startsWith('\uFEFF'), 'Use an original UTF-8 GDELT TSV table.');
  batchId(batch);
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  need(lines.length <= LIMITS.rows, 'Source table exceeds one million rows.', 'GDELT_SOURCE_TOO_LARGE', 413);
  const rows = [], eventIds = new Set();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].endsWith('\r') ? lines[index].slice(0,-1) : lines[index];
    const values = line.split('\t');
    need(values.length === fields.length && values.every(value => value.length <= LIMITS.cellChars && !/[\r\0]/.test(value)),
      'Original ' + kind + ' TSV record ' + (index + 1) + ' must contain ' + fields.length + ' fields.', 'GDELT_TABLE_CONTRACT_CHANGED');
    const row = Object.fromEntries(fields.map((name, i) => [name, values[i]]));
    need(/^\d+$/.test(row.GlobalEventID), 'The source event identifier is missing or invalid.');
    const timestamp = kind === 'events' ? row.DATEADDED : row.MentionTimeDate;
    need(batchId(timestamp) === batch, 'Source row belongs to another update timestamp.', 'GDELT_BATCH_MISMATCH');
    if (kind === 'events') {
      need(!eventIds.has(row.GlobalEventID), 'An Event table repeats its event identifier.', 'GDELT_EVENT_KEY_DUPLICATE');
      eventIds.add(row.GlobalEventID);
    } else batchId(row.EventTimeDate);
    for (const field of fields) {
      const value = row[field];
      if (value === '') continue;
      if (INTEGER_FIELDS.has(field)) need(/^-?(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)), 'Invalid exact integer in ' + field + '.');
      if (DECIMAL_FIELDS.has(field)) need(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value), 'Invalid decimal text in ' + field + '.');
    }
    rows.push({ source_batch: batch, source_row: index + 1, ...row });
  }
  return rows;
}
export function projectionPolicy(value = {}) {
  need(plain(value), 'Use a projection object.');
  const allowed = new Set(['table','fields','filters','ranges','sorts','defaultLimit','maxLimit','selection']);
  need(Object.keys(value).every(key => allowed.has(key)), 'Unknown projection setting.');
  const table = value.table ?? 'events', available = tableFields(table);
  const fields = value.fields ?? available;
  need(Array.isArray(fields) && fields.length >= 1 && fields.length <= 64 && new Set(fields).size === fields.length &&
    fields.every(name => available.includes(name)), 'Select one to 64 distinct fields from the selected table.');
  need(fields.includes('source_batch') && fields.includes('source_row') && fields.includes('GlobalEventID'), 'Keep source_batch, source_row and GlobalEventID in every customer projection.');
  const filters = value.filters ?? ['GlobalEventID'], ranges = value.ranges ?? [], sorts = value.sorts ?? ['source_batch'];
  for (const [name, list] of [['filters',filters],['ranges',ranges],['sorts',sorts]])
    need(Array.isArray(list) && list.length <= 8 && new Set(list).size === list.length && list.every(item => fields.includes(item)), 'Choose up to eight projected ' + name + '.');
  need(3+filters.length+4*ranges.length+(sorts.length?1:0)+1<=32,
    'The published dataset supports at most32 original query parameters including its snapshot selector.');
  const selection = value.selection ?? {};
  need(plain(selection) && Object.keys(selection).length <= 8 && Object.entries(selection).every(([name, values]) =>
    available.includes(name) && Array.isArray(values) && values.length >= 1 && values.length <= 100 &&
    values.every(item => typeof item === 'string' && item.length <= 2048) && new Set(values).size === values.length),
    'Selection uses up to eight original fields, each with explicit accepted text values.');
  const defaultLimit = value.defaultLimit ?? 100, maxLimit = value.maxLimit ?? 500;
  need(Number.isInteger(defaultLimit) && defaultLimit >= 1 && Number.isInteger(maxLimit) &&
    maxLimit >= defaultLimit && maxLimit <= 1000, 'Use page limits between one and 1000.');
  return { table, fields: [...fields], filters: [...filters], ranges: [...ranges], sorts: [...sorts],
    defaultLimit, maxLimit, selection: clone(selection) };
}
export function collectionRows(models, table) {
  tableFields(table);
  const ordered = [...models].sort((a,b) => a.batch.localeCompare(b.batch));
  need(ordered.length >= 1 && ordered.length <= LIMITS.captures &&
    new Set(ordered.map(item => item.batch)).size === ordered.length, 'Select one original edition per batch, up to 32 batches.');
  const events = ordered.flatMap(model => model.events), mentions = ordered.flatMap(model => model.mentions);
  need(events.length <= LIMITS.rows && mentions.length <= LIMITS.rows, 'Collection exceeds the one-million-row table capacity.');
  if (table === 'events') return events;
  if (table === 'mentions') return mentions;
  const byId = new Map();
  for (const event of events) {
    const list = byId.get(event.GlobalEventID) ?? [];
    list.push(event); byId.set(event.GlobalEventID, list);
  }
  return mentions.map(mention => {
    const candidates = byId.get(mention.GlobalEventID) ?? [];
    // Match the original event time first. A repeated/corrected ID is not guessed.
    const timed = candidates.filter(row => row.DATEADDED === mention.EventTimeDate);
    const event = timed.length === 1 ? timed[0] : null;
    return { ...mention, event_match: event ? 'MATCHED' : candidates.length ? 'AMBIGUOUS' : 'NOT_IN_COLLECTION',
      event_candidates: candidates.length, source_batch_event: event?.source_batch ?? '',
      ...Object.fromEntries(EVENT_LOOKUP_FIELDS.map(name => ['Event_' + name, event?.[name] ?? ''])) };
  });
}
export function selectedRows(models, supplied) {
  const policy = projectionPolicy(supplied), all = collectionRows(models, policy.table);
  const rows = all.filter(row => Object.entries(policy.selection).every(([name, values]) => values.includes(String(row[name]))));
  return { policy, rows, sourceRows: all.length };
}
export function projectionCsv(models, supplied) {
  const result = selectedRows(models, supplied);
  const cell = value => '"' + String(value ?? '').replaceAll('"','""') + '"';
  return { ...result, csv: [result.policy.fields.map(cell).join(','),
    ...result.rows.map(row => result.policy.fields.map(name => cell(row[name])).join(','))].join('\r\n') + '\r\n' };
}
export function schemaDocument(policy, captureIds) {
  policy = projectionPolicy(policy);
  return { schema: SCHEMA, provider: 'GDELT Project', version: '2.0', attribution: ATTRIBUTION,
    projectUrl: PROJECT_URL, termsUrl: TERMS_URL, codebookUrl: CODEBOOK_URL, notice: NOTICE,
    captureIds: [...captureIds], table: policy.table, selection: policy.selection,
    physical: 'UTF-8 CSV; original blank fields become null when declared nullable; exact source TSV/ZIP remain in the capture.',
    decimals: 'Decimal values remain text, preserving all source digits. Numeric range/sort on these text columns is lexical.',
    order: 'Source batches ascending, then original one-based TSV record order. Duplicate mention records are retained.',
    comparison: 'Only-in-window membership does not imply that an event was created, deleted or ceased to occur.',
    fields: policy.fields.map(columnMeaning), sourceFieldOrder: { events: EVENT_FIELDS, mentions: MENTION_FIELDS } };
}
export function compareModels(before, after) {
  const comparison = { schema: 'stellar-forge.gdelt-comparison.v1', beforeBatch: before.batch, afterBatch: after.batch,
    notice: 'This compares source-window membership. Only-in-before/after entries are not real-world event deletions/creations.',
    attribution: ATTRIBUTION, events: [], mentions: {}, totals: {} };
  const left = new Map(before.events.map(row => [row.GlobalEventID,row])), right = new Map(after.events.map(row => [row.GlobalEventID,row]));
  for (const id of [...new Set([...left.keys(),...right.keys()])].sort()) {
    const a = left.get(id), b = right.get(id);
    const changes = a && b ? EVENT_FIELDS.filter(name => a[name] !== b[name]).map(name => ({ field:name,before:a[name],after:b[name] })) : [];
    comparison.events.push({ GlobalEventID:id, status: !a ? 'ONLY_IN_AFTER_BATCH' : !b ? 'ONLY_IN_BEFORE_BATCH' : changes.length ? 'SAME_ID_DIFFERENT_RECORD' : 'SAME_ID_IDENTICAL_RECORD',
      beforeRow:a?.source_row ?? null, afterRow:b?.source_row ?? null, changes });
  }
  const mentionKeys = rows => { const counts = new Map(); for (const row of rows) { const key=digest(MENTION_FIELDS.map(name=>row[name])); counts.set(key,(counts.get(key)??0)+1); } return counts; };
  const ma=mentionKeys(before.mentions), mb=mentionKeys(after.mentions);
  let common=0; for (const [key,count] of ma) common+=Math.min(count,mb.get(key)??0);
  comparison.mentions = { before:before.mentions.length, after:after.mentions.length, identicalRecords:common,
    onlyInBeforeBatch:before.mentions.length-common, onlyInAfterBatch:after.mentions.length-common,
    identity:'Full original 16-field record with occurrence multiplicity; repeated mentions are preserved.' };
  comparison.totals = Object.fromEntries(['ONLY_IN_AFTER_BATCH','ONLY_IN_BEFORE_BATCH','SAME_ID_DIFFERENT_RECORD','SAME_ID_IDENTICAL_RECORD']
    .map(status=>[status,comparison.events.filter(row=>row.status===status).length]));
  return comparison;
}
