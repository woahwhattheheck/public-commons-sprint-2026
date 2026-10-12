// SPDX-License-Identifier: MIT
// Analysis of retained NOAA CO-OPS responses. This module performs no requests.
export const ANALYSIS_VERSION = '1.0.0';
export const INPUT_SCHEMA = 'stellar-forge.coops-analysis-input.v1';
export const WORKBOOK_SCHEMA = 'stellar-forge.coops-analysis-workbook.v1';
const SIX_MINUTES = 360000;
const MAX_ROWS = 1000000;
const HEX = /^[a-f0-9]{64}$/;
const json = value => JSON.parse(JSON.stringify(value));
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export class AnalysisError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'AnalysisError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new AnalysisError(code, message, details); }
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('COOPS_ANALYSIS_OBJECT', name + ' must be an object.');
  return value;
}
function text(value, name, maximum = 8192) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail('COOPS_ANALYSIS_TEXT', name + ' must be nonempty text of up to ' + maximum + ' characters.');
  return value;
}
function finite(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
function iso(ms) { return new Date(ms).toISOString().replace('.000Z', 'Z'); }
export function parseGmtTime(value) {
  if (typeof value !== 'string') return null;
  let match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.000)?)?(Z)?$/.exec(value);
  if (!match) {
    const compact = /^(\d{4})(\d{2})(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(value);
    if (compact) match = [compact[0], compact[1], compact[2], compact[3], compact[4] || '00', compact[5] || '00', '00'];
  }
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1, 7).map((x, i) => Number(x || (i === 5 ? 0 : NaN)));
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, s), date = new Date(ms);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return ms;
}
function requiredTime(value, label) {
  const ms = parseGmtTime(value);
  if (ms === null) fail('COOPS_ANALYSIS_TIME', label + ' must be an exact GMT timestamp, for example 2025-01-01T00:00:00Z.');
  return ms;
}
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}
export async function sha256Text(value, digest) {
  if (digest) return digest(value);
  if (!globalThis.crypto?.subtle || typeof TextEncoder !== 'function') fail('COOPS_ANALYSIS_CRYPTO', 'Use a current browser or provide a SHA-256 UTF-8 digest implementation.');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, '0')).join('');
}
function selection(value, role) {
  object(value, role + ' selection');
  const result = {
    station: text(String(value.station || ''), 'Station', 32),
    product: text(value.product, 'Product', 64),
    datum: text(value.datum, 'Datum', 64).toUpperCase(),
    units: text(value.units, 'Units', 16).toLowerCase(),
    time_zone: text(value.time_zone, 'Time zone', 16).toLowerCase(),
    begin_date: iso(requiredTime(value.begin_date, 'Source begin date')),
    end_date: iso(requiredTime(value.end_date, 'Source end date') + (/^\d{8}$/.test(value.end_date) ? 86400000 - SIX_MINUTES : 0)),
    interval: value.interval === undefined || value.interval === null ? null : String(value.interval),
  };
  if (!/^\d{7}$/.test(result.station)) fail('COOPS_ANALYSIS_STATION', 'Use the original seven-digit water-level station identifier.');
  if (result.product !== (role === 'observations' ? 'water_level' : 'predictions')) fail('COOPS_ANALYSIS_PRODUCT', role + ' must contain the original ' + (role === 'observations' ? 'water_level' : 'predictions') + ' product.');
  if (!['metric', 'english'].includes(result.units)) fail('COOPS_ANALYSIS_UNITS', 'Use original metric or english source units.');
  if (result.time_zone !== 'gmt') fail('COOPS_ANALYSIS_TIME_ZONE', 'This workbook joins explicit GMT captures. Select original GMT observations and predictions in the source workspace.');
  if (role === 'predictions' && result.interval !== '6') fail('COOPS_ANALYSIS_INTERVAL', 'Select the original predictions product with interval 6 minutes.');
  if (role === 'observations' && result.interval !== null && result.interval !== '') fail('COOPS_ANALYSIS_INTERVAL', 'The water_level product supplies six-minute observations without an interval parameter.');
  if (requiredTime(result.end_date) < requiredTime(result.begin_date)) fail('COOPS_ANALYSIS_WINDOW', 'The source end date precedes its begin date.');
  return result;
}
function parsePage(body, name) {
  try { return object(JSON.parse(body.replace(/^\uFEFF/, '')), name); }
  catch (error) { if (error instanceof AnalysisError) throw error; fail('COOPS_ANALYSIS_SOURCE_JSON', name + ' is not a JSON object.'); }
}
export function decodeWaterLevelQuality(raw) {
  const q = typeof raw.q === 'string' ? raw.q.trim().toLowerCase() : '';
  const tokens = typeof raw.f === 'string' ? raw.f.split(',').map(v => v.trim()) : Array.isArray(raw.f) ? raw.f.map(String) : [];
  const ints = tokens.map(v => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : null);
  const flagsKnown = ints.length === 4 && ints.every(v => v !== null) && ints.slice(1).every(v => v === 0 || v === 1) && (q !== 'v' || ints[0] <= 1);
  return {
    code: q || 'unknown',
    label: q === 'v' ? 'verified' : q === 'p' ? 'preliminary' : 'unreported',
    flagsKnown,
    excludedOneSecondSamples: q === 'p' && flagsKnown ? ints[0] : null,
    inferred: q === 'v' && flagsKnown ? ints[0] === 1 : null,
    flatToleranceExceeded: flagsKnown ? ints[1] === 1 : null,
    rateToleranceExceeded: flagsKnown ? ints[2] === 1 : null,
    heightToleranceExceeded: flagsKnown ? ints[3] === 1 : null,
    sigma: finite(raw.s) !== null && finite(raw.s) >= 0 ? finite(raw.s) : null,
    rawQuality: has(raw, 'q') ? raw.q : null,
    rawFlags: has(raw, 'f') ? raw.f : null,
    rawSigma: has(raw, 's') ? raw.s : null,
  };
}
async function sourceSeries(input, role, digest) {
  object(input, role);
  const selected = selection(input.selection, role);
  const editionId = text(input.editionId, role + ' edition identity', 512);
  if (!Array.isArray(input.pages) || !input.pages.length) fail('COOPS_ANALYSIS_PAGES', 'Retain at least one original response page for ' + role + '.');
  const pages = [], metadata = [], rows = [];
  let total = 0;
  for (let pageIndex = 0; pageIndex < input.pages.length; pageIndex++) {
    const page = object(input.pages[pageIndex], 'Response page');
    const name = typeof page.name === 'string' && page.name ? page.name : role + '-' + (pageIndex + 1) + '.json';
    text(page.body, name + ' original UTF-8 response', 256 * 1024 * 1024);
    if (!HEX.test(page.sha256 || '')) fail('COOPS_ANALYSIS_SOURCE_IDENTITY', name + ' requires the retained original SHA-256.');
    const actual = await sha256Text(page.body, digest);
    if (actual !== page.sha256) fail('COOPS_ANALYSIS_SOURCE_CHANGED', name + ' does not match its retained original SHA-256.', {expected: page.sha256, actual});
    if (page.receipt?.url) {
      let capturedUrl;
      try { capturedUrl = new URL(page.receipt.url); } catch { fail('COOPS_ANALYSIS_REQUEST_URL', name + ' retains an invalid request URL.'); }
      for (const key of ['station','product','datum','units','time_zone']) {
        const actualValue = capturedUrl.searchParams.get(key);
        if (actualValue !== null && actualValue.toLowerCase() !== String(selected[key]).toLowerCase())
          fail('COOPS_ANALYSIS_REQUEST_SELECTION', name + ' request URL disagrees with the retained ' + key + ' selection.');
      }
      const actualInterval = capturedUrl.searchParams.get('interval');
      if (actualInterval !== null && actualInterval !== selected.interval) fail('COOPS_ANALYSIS_REQUEST_SELECTION', name + ' request interval disagrees with its retained selection.');
    }
    const payload = parsePage(page.body, name);
    if (payload.error) fail('COOPS_ANALYSIS_PROVIDER_ERROR', name + ' retains a NOAA error response.', {error: payload.error});
    if (payload.metadata?.id && String(payload.metadata.id) !== selected.station) fail('COOPS_ANALYSIS_STATION_MISMATCH', name + ' reports a different station from its source selection.');
    const arrayName = role === 'observations' ? 'data' : 'predictions';
    if (!Array.isArray(payload[arrayName])) fail('COOPS_ANALYSIS_ROWS', name + ' is missing its original ' + arrayName + ' array.');
    total += payload[arrayName].length;
    if (total > MAX_ROWS) fail('COOPS_ANALYSIS_SIZE', 'This interactive workbook supports up to one million source rows per series. Select a shorter retained source window.');
    pages.push({name, sha256: actual, rows: payload[arrayName].length, receipt: json(page.receipt || {}), metadata: json(payload.metadata || {})});
    for (let index = 0; index < payload[arrayName].length; index++) {
      const original = payload[arrayName][index];
      const raw = original && typeof original === 'object' && !Array.isArray(original) ? original : {unrecognisedSourceRow: original};
      const ms = parseGmtTime(raw.t), value = finite(raw.v);
      rows.push({timeMs: ms, value, quality: role === 'observations' ? decodeWaterLevelQuality(raw) : null,
        source: {page: pageIndex + 1, name, sha256: actual, array: arrayName, index, row: index + 1}, raw});
    }
  }
  if (input.metadata !== undefined && !Array.isArray(input.metadata)) fail('COOPS_ANALYSIS_METADATA', 'Retained metadata must be an array of original JSON response files.');
  const epochs = new Set();
  for (const entry of input.metadata || []) {
    object(entry, 'Metadata response');
    text(entry.body, 'Original metadata response', 256 * 1024 * 1024);
    if (!HEX.test(entry.sha256 || '') || await sha256Text(entry.body, digest) !== entry.sha256) fail('COOPS_ANALYSIS_METADATA_CHANGED', 'The original station metadata does not match its retained SHA-256.');
    const payload = parsePage(entry.body, 'Metadata response');
    const stationIds = new Set();
    for (const candidate of [payload.stationId,payload.id,payload.station?.id,...(Array.isArray(payload.stations)?payload.stations.map(v=>v?.id):[])]) {
      if (/^\d{7}$/.test(String(candidate || ''))) stationIds.add(String(candidate));
    }
    if (entry.receipt?.url) {
      let metadataUrl;
      try { metadataUrl = new URL(entry.receipt.url); } catch { fail('COOPS_ANALYSIS_METADATA_URL', 'Retain the original metadata request URL.'); }
      const match = /\/stations\/(\d{7})(?:\/|\.|$)/.exec(metadataUrl.pathname);
      if (match) stationIds.add(match[1]);
    }
    if ([...stationIds].some(id=>id!==selected.station)) fail('COOPS_ANALYSIS_METADATA_STATION', 'The retained metadata identifies a different station from the selected source.');
    if (entry.role === 'datums' && typeof payload.epoch === 'string' && payload.epoch.trim()) {
      if (!stationIds.has(selected.station)) fail('COOPS_ANALYSIS_METADATA_STATION', 'Retain the original station-specific MDAPI URL or reported station identity with datum metadata.');
      epochs.add(payload.epoch.trim());
    }
    metadata.push({role: entry.role || 'metadata', name: entry.name || null, sha256: entry.sha256, receipt: json(entry.receipt || {}), payload});
  }
  if (epochs.size > 1) fail('COOPS_ANALYSIS_DATUM_EPOCH', 'One selected edition contains conflicting reported datum epochs.');
  return {editionId, selection: selected, pages, metadata, datumEpoch: [...epochs][0] || null, rows};
}
export async function prepareInput(document, {digest} = {}) {
  object(document, 'Analysis input');
  if (document.schema !== INPUT_SCHEMA) fail('COOPS_ANALYSIS_SCHEMA', 'Open a CO-OPS analysis input exported from the retained source workspace.');
  const [observations, predictions] = await Promise.all([
    sourceSeries(document.observations, 'observations', digest),
    sourceSeries(document.predictions, 'predictions', digest),
  ]);
  for (const key of ['station', 'datum', 'units', 'time_zone']) {
    if (observations.selection[key] !== predictions.selection[key]) fail('COOPS_ANALYSIS_INCOMPATIBLE', 'The selected observations and predictions have different ' + key + '.', {field: key, observations: observations.selection[key], predictions: predictions.selection[key]});
  }
  if (observations.datumEpoch && predictions.datumEpoch && observations.datumEpoch !== predictions.datumEpoch) fail('COOPS_ANALYSIS_DATUM_EPOCH', 'The selected observations and predictions report different datum epochs.');
  const requestBegin = Math.max(requiredTime(observations.selection.begin_date), requiredTime(predictions.selection.begin_date));
  const requestEnd = Math.min(requiredTime(observations.selection.end_date), requiredTime(predictions.selection.end_date));
  if (requestBegin > requestEnd) fail('COOPS_ANALYSIS_WINDOW', 'The retained source request windows do not overlap.');
  // NOAA water_level slots follow the UTC clock (:00, :06, ...). A request may
  // start or end between slots; its request boundary does not shift that clock.
  const begin = Math.ceil(requestBegin / SIX_MINUTES) * SIX_MINUTES;
  const end = Math.floor(requestEnd / SIX_MINUTES) * SIX_MINUTES;
  if (begin > end) fail('COOPS_ANALYSIS_GRID', 'The overlapping request window contains no six-minute UTC observation slot.');
  const binding = {
    version: ANALYSIS_VERSION,
    observations: {editionId: observations.editionId, selection: observations.selection, pages: observations.pages.map(p => ({name:p.name, sha256:p.sha256})), metadata: observations.metadata.map(p => ({role:p.role, sha256:p.sha256}))},
    predictions: {editionId: predictions.editionId, selection: predictions.selection, pages: predictions.pages.map(p => ({name:p.name, sha256:p.sha256})), metadata: predictions.metadata.map(p => ({role:p.role, sha256:p.sha256}))},
  };
  return {schema: INPUT_SCHEMA, version: ANALYSIS_VERSION, sourceId: await sha256Text(canonicalJson(binding), digest), binding,
    observations, predictions, common: {station: observations.selection.station, datum: observations.selection.datum, units: observations.selection.units, unitLabel: observations.selection.units === 'metric' ? 'm' : 'ft', timeZone: 'GMT', cadenceMinutes: 6, gridAnchor: '1970-01-01T00:00:00Z', requestOverlap: {begin:iso(requestBegin),end:iso(requestEnd)}, begin: iso(begin), end: iso(end), datumEpoch: observations.datumEpoch || predictions.datumEpoch,
      datumEpochStatus: observations.datumEpoch && predictions.datumEpoch ? 'matching original metadata' : observations.datumEpoch || predictions.datumEpoch ? 'reported by one retained metadata selection' : 'not reported in retained metadata'},
  };
}
export function normaliseOptions(prepared, input = {}) {
  object(input, 'Analyst selection');
  const allowed = new Set(['begin', 'end', 'quality', 'excludeInferred', 'excludeToleranceFlags', 'maxSigma', 'upperThreshold', 'lowerThreshold']);
  if (Object.keys(input).some(key => !allowed.has(key))) fail('COOPS_ANALYSIS_OPTIONS', 'The analyst selection contains an unsupported field.');
  const begin = input.begin === undefined ? requiredTime(prepared.common.begin) : requiredTime(input.begin, 'Analysis begin date');
  const end = input.end === undefined ? requiredTime(prepared.common.end) : requiredTime(input.end, 'Analysis end date');
  if (begin < requiredTime(prepared.common.begin) || end > requiredTime(prepared.common.end) || begin > end) fail('COOPS_ANALYSIS_WINDOW', 'Choose an inclusive analysis window within the overlapping retained source requests.');
  if (begin % SIX_MINUTES || end % SIX_MINUTES) fail('COOPS_ANALYSIS_GRID', 'Choose analysis endpoints on the six-minute UTC clock grid (:00, :06, and subsequent six-minute marks).');
  if ((end - begin) / SIX_MINUTES + 1 > MAX_ROWS) fail('COOPS_ANALYSIS_SIZE', 'Choose up to one million expected six-minute slots.');
  const quality = input.quality === undefined ? 'all' : input.quality;
  if (!['all', 'verified', 'preliminary'].includes(quality)) fail('COOPS_ANALYSIS_QUALITY', 'Choose all, verified or preliminary observations.');
  const result = {begin:iso(begin), end:iso(end), quality};
  for (const key of ['excludeInferred', 'excludeToleranceFlags']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') fail('COOPS_ANALYSIS_OPTIONS', key + ' must be a boolean.');
    result[key] = input[key] === true;
  }
  for (const key of ['maxSigma', 'upperThreshold', 'lowerThreshold']) {
    const value = input[key];
    result[key] = value === undefined || value === null || value === '' ? null : finite(value);
    if (value !== undefined && value !== null && value !== '' && result[key] === null) fail('COOPS_ANALYSIS_THRESHOLD', key + ' must be a finite value in ' + prepared.common.unitLabel + '.');
  }
  if (result.maxSigma !== null && result.maxSigma < 0) fail('COOPS_ANALYSIS_THRESHOLD', 'Maximum sigma must be nonnegative.');
  if (result.upperThreshold !== null && result.lowerThreshold !== null && result.upperThreshold <= result.lowerThreshold) fail('COOPS_ANALYSIS_THRESHOLD', 'The upper residual threshold must exceed the lower threshold.');
  return result;
}
function qualityExclusion(q, options) {
  if (options.quality === 'verified' && q.code !== 'v') return 'quality-filter';
  if (options.quality === 'preliminary' && q.code !== 'p') return 'quality-filter';
  if (options.excludeInferred && q.code !== 'p' && q.inferred !== false) return q.inferred === true ? 'inferred-filter' : 'unknown-inference-filter';
  if (options.excludeToleranceFlags && !q.flagsKnown) return 'unknown-flags-filter';
  if (options.excludeToleranceFlags && (q.flatToleranceExceeded || q.rateToleranceExceeded || q.heightToleranceExceeded)) return 'tolerance-filter';
  if (options.maxSigma !== null && q.sigma === null) return 'unknown-sigma-filter';
  if (options.maxSigma !== null && q.sigma > options.maxSigma) return 'sigma-filter';
  return null;
}
function quantile(values, p) {
  if (!values.length) return null;
  const at = (values.length - 1) * p, left = Math.floor(at), fraction = at - left;
  return values[left] + (values[Math.ceil(at)] - values[left]) * fraction;
}
function summaryStatistics(rows) {
  if (!rows.length) return {count:0,mean:null,median:null,p05:null,p95:null,sampleStandardDeviation:null,rmsResidual:null,meanAbsoluteResidual:null,minimum:null,maximum:null};
  let mean = 0, m2 = 0, squares = 0, absolute = 0;
  const values = [];
  let minimum = rows[0], maximum = rows[0];
  rows.forEach((row, index) => { const value = row.residual, delta = value - mean; mean += delta / (index + 1); m2 += delta * (value - mean); squares += value * value; absolute += Math.abs(value); values.push(value); if (value < minimum.residual) minimum = row; if (value > maximum.residual) maximum = row; });
  values.sort((a,b) => a-b);
  const point = row => ({time:row.time,value:row.residual,observation:row.observations[0].source,prediction:row.predictions[0].source});
  return {count:rows.length,mean,median:quantile(values,.5),p05:quantile(values,.05),p95:quantile(values,.95),sampleStandardDeviation:rows.length > 1 ? Math.sqrt(Math.max(0,m2/(rows.length-1))) : null,rmsResidual:Math.sqrt(squares/rows.length),meanAbsoluteResidual:absolute/rows.length,minimum:point(minimum),maximum:point(maximum)};
}
function groups(rows, pick) {
  const result = []; let current = null;
  for (const row of rows) {
    const category = pick(row);
    if (!category) { current = null; continue; }
    if (!current || current.reason !== category || row.timeMs - current.lastMs !== SIX_MINUTES) {
      current = {reason:category,first:row.time,last:row.time,count:1,lastMs:row.timeMs}; result.push(current);
    } else { current.last=row.time; current.count++; current.lastMs=row.timeMs; }
  }
  return result.map(({lastMs,...group}) => ({...group,sampleSpanMinutes:(requiredTime(group.last)-requiredTime(group.first))/60000}));
}
function thresholdEpisodes(rows, options) {
  const episodes = [];
  for (const [direction, threshold] of [['upper',options.upperThreshold],['lower',options.lowerThreshold]]) {
    if (threshold === null) continue;
    let current = null, previous = null;
    const close = reason => { if (current) { current.endReason=reason; episodes.push(current); current=null; } };
    for (const row of rows) {
      if (!row.onGrid) continue;
      const usable = row.status === 'included';
      const qualifies = usable && (direction === 'upper' ? row.residual >= threshold : row.residual <= threshold);
      if (current && previous && row.timeMs-previous.timeMs !== SIX_MINUTES) close('time-gap');
      if (!qualifies) { close(usable ? 'threshold-recovery' : row.status); previous=row; continue; }
      if (!current) current={id:direction+'-'+row.time,direction,threshold,first:row.time,last:row.time,samples:0,sampleSpanMinutes:0,peak:{time:row.time,value:row.residual,observation:row.observations[0].source,prediction:row.predictions[0].source},startReason:previous ? previous.status === 'included' ? 'threshold-crossing-between-samples' : previous.status : 'selection-start'};
      current.samples++; current.last=row.time; current.sampleSpanMinutes=(row.timeMs-requiredTime(current.first))/60000;
      if (direction === 'upper' ? row.residual>current.peak.value : row.residual<current.peak.value) current.peak={time:row.time,value:row.residual,observation:row.observations[0].source,prediction:row.predictions[0].source};
      previous=row;
    }
    close('selection-end');
  }
  return episodes.sort((a,b) => a.first.localeCompare(b.first) || a.direction.localeCompare(b.direction));
}
export function analyse(prepared, inputOptions = {}) {
  const options = normaliseOptions(prepared, inputOptions);
  const begin=requiredTime(options.begin), end=requiredTime(options.end), expected=Math.floor((end-begin)/SIX_MINUTES)+1;
  const maps={observations:new Map(),predictions:new Map()}, unplaced=[], outOfWindow={observations:0,predictions:0};
  for (const role of ['observations','predictions']) for (const row of prepared[role].rows) {
    if (row.timeMs===null) { unplaced.push({role,reason:'invalid-timestamp',source:row.source,raw:row.raw}); continue; }
    if (row.timeMs<begin||row.timeMs>end) { outOfWindow[role]++; continue; }
    const selected=maps[role].get(row.timeMs)||[]; selected.push(row); maps[role].set(row.timeMs,selected);
  }
  const times=new Set([...maps.observations.keys(),...maps.predictions.keys()]);
  for (let ms=begin;ms<=end;ms+=SIX_MINUTES) times.add(ms);
  const rows=[],statuses={},qualityCounts={verified:0,preliminary:0,unreported:0},flagCounts={inferred:0,preliminarySamplesOutsideBand:0,flat:0,rate:0,height:0,unknown:0};
  let pairedFinite=0;
  for (const ms of [...times].sort((a,b)=>a-b)) {
    const observationRows=maps.observations.get(ms)||[], predictionRows=maps.predictions.get(ms)||[];
    for (const row of observationRows) { const q=row.quality; qualityCounts[q.label]++; if(q.inferred)flagCounts.inferred++; if(q.excludedOneSecondSamples!==null)flagCounts.preliminarySamplesOutsideBand+=q.excludedOneSecondSamples; if(q.flatToleranceExceeded)flagCounts.flat++; if(q.rateToleranceExceeded)flagCounts.rate++; if(q.heightToleranceExceeded)flagCounts.height++; if(!q.flagsKnown)flagCounts.unknown++; }
    const onGrid=(ms-begin)%SIX_MINUTES===0;
    let status='included';
    if(!onGrid)status='off-grid';
    else if(observationRows.length>1)status='ambiguous-observation';
    else if(predictionRows.length>1)status='ambiguous-prediction';
    else if(!observationRows.length)status='missing-observation';
    else if(!predictionRows.length)status='missing-prediction';
    else if(observationRows[0].value===null)status='invalid-observation-value';
    else if(predictionRows[0].value===null)status='invalid-prediction-value';
    else { pairedFinite++;status=qualityExclusion(observationRows[0].quality,options)||'included'; }
    const observed=observationRows.length===1?observationRows[0].value:null, predicted=predictionRows.length===1?predictionRows[0].value:null;
    // Keep the mathematical pair even when an operator quality choice excludes it.
    const rawResidual=onGrid&&observationRows.length===1&&predictionRows.length===1&&observed!==null&&predicted!==null?observed-predicted:null;
    const record={time:iso(ms),timeMs:ms,onGrid,status,observed,predicted,rawResidual,residual:status==='included'?rawResidual:null,
      observations:observationRows.map(row=>({source:row.source,raw:row.raw,quality:row.quality})),
      predictions:predictionRows.map(row=>({source:row.source,raw:row.raw})),
      missingObservation:!observationRows.length,missingPrediction:!predictionRows.length};
    rows.push(record); statuses[status]=(statuses[status]||0)+1;
  }
  const included=rows.filter(row=>row.status==='included'), grid=rows.filter(row=>row.onGrid);
  return {schema:'stellar-forge.coops-residual-analysis.v1',version:ANALYSIS_VERSION,sourceId:prepared.sourceId,sourceBinding:prepared.binding,
    context:prepared.common,options,method:{residual:'observed water level minus tidal prediction at the identical GMT timestamp',join:'exact timestamp on the six-minute UTC clock grid; ambiguous duplicate timestamps excluded',numeric:'finite source decimal values; no interpolation, datum or unit conversion',statistics:'unweighted included six-minute pairs; sample standard deviation uses n-1; quantiles interpolate order statistics at (n-1)p',episodes:'inclusive operator thresholds; consecutive included six-minute samples only; span is first-to-last sample, not an inferred continuous duration',quality:'row q determines f[0]: preliminary outside-band sample count; verified inferred-value flag'},
    coverage:{expectedSlots:expected,gridSlots:grid.length,pairedFinite,included:included.length,includedPercent:100*included.length/expected,pairedFinitePercent:100*pairedFinite/expected,
      missingObservationSlots:grid.filter(row=>row.missingObservation).length,missingPredictionSlots:grid.filter(row=>row.missingPrediction).length,
      ambiguousObservationSlots:grid.filter(row=>row.observations.length>1).length,ambiguousPredictionSlots:grid.filter(row=>row.predictions.length>1).length,
      offGridTimestamps:rows.length-grid.length,unplacedSourceRows:unplaced.length,sourceRows:{observations:prepared.observations.rows.length,predictions:prepared.predictions.rows.length},outOfWindow,statuses,qualityCounts,flagCounts},
    statistics:summaryStatistics(included),episodes:thresholdEpisodes(rows,options),gaps:groups(grid,row=>row.status==='included'?null:row.status),rows,unplaced};
}
export function csvCell(value) {
  if(value===null||value===undefined)return '';
  if(typeof value==='number')return Number.isFinite(value)?String(value):'';
  let raw=typeof value==='string'?value:JSON.stringify(value);
  // Spreadsheet viewers must not execute untrusted original text. JSON exports retain exact text.
  if(/^[\t\r\n ]*[=+\-@]/.test(raw))raw="'"+raw;
  return /[",\r\n]/.test(raw)?'"'+raw.replaceAll('"','""')+'"':raw;
}
function csv(headers, rows) { return [headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n'; }
export function residualCsv(result) {
  return csv(['time_gmt','status','observed','predicted','raw_residual','included_residual','unit','datum','quality','raw_flags','raw_sigma','observation_source_refs','prediction_source_refs','original_observation_rows','original_prediction_rows'],
    result.rows.map(row=>[row.time,row.status,row.observed,row.predicted,row.rawResidual,row.residual,result.context.unitLabel,result.context.datum,row.observations.length===1?row.observations[0].quality.rawQuality:null,
      row.observations.length===1?row.observations[0].quality.rawFlags:null,row.observations.length===1?row.observations[0].quality.rawSigma:null,
      row.observations.map(v=>v.source),row.predictions.map(v=>v.source),row.observations.map(v=>v.raw),row.predictions.map(v=>v.raw)]));
}
export function episodesCsv(result) {
  return csv(['direction','threshold','first_sample_gmt','last_sample_gmt','qualifying_samples','first_to_last_minutes','peak_time_gmt','peak_residual','unit','start_reason','end_reason','peak_observation_source','peak_prediction_source'],
    result.episodes.map(v=>[v.direction,v.threshold,v.first,v.last,v.samples,v.sampleSpanMinutes,v.peak.time,v.peak.value,result.context.unitLabel,v.startReason,v.endReason,v.peak.observation,v.peak.prediction]));
}
export function unplacedCsv(result) {
  return csv(['role','reason','source_ref','original_row'],result.unplaced.map(v=>[v.role,v.reason,v.source,v.raw]));
}
function analyst(value={}) {
  object(value,'Analyst notes'); const result={};
  for(const key of ['name','project','question','interpretation','followUp']) {
    if(value[key]!==undefined&&typeof value[key]!=='string')fail('COOPS_ANALYSIS_NOTES','Analyst '+key+' must be text.');
    if((value[key]||'').length>32768)fail('COOPS_ANALYSIS_NOTES','Keep each analyst field within 32768 characters.');
    result[key]=value[key]||'';
  }
  return result;
}
export async function saveWorkbook(input, options={}, notes={}, {digest,createdAt=new Date().toISOString()}={}) {
  const prepared=await prepareInput(input,{digest}), result=analyse(prepared,options);
  if(parseGmtTime(createdAt)===null && !Number.isFinite(Date.parse(createdAt)))fail('COOPS_ANALYSIS_CREATED','Use an ISO creation timestamp.');
  return {schema:WORKBOOK_SCHEMA,version:ANALYSIS_VERSION,createdAt,sourceId:prepared.sourceId,input:json(input),options:result.options,analyst:analyst(notes),analysisSha256:await sha256Text(canonicalJson(result),digest)};
}
export async function openWorkbook(value,{digest}={}) {
  const document=typeof value==='string'?JSON.parse(value):value;
  object(document,'Saved workbook');
  if(document.schema!==WORKBOOK_SCHEMA||document.version!==ANALYSIS_VERSION)fail('COOPS_ANALYSIS_WORKBOOK_VERSION','Open this workbook in its original analysis version '+(document.version||'unknown')+'.');
  const prepared=await prepareInput(document.input,{digest});
  if(prepared.sourceId!==document.sourceId)fail('COOPS_ANALYSIS_WORKBOOK_SOURCE','The saved workbook source selection has changed.');
  const result=analyse(prepared,document.options), actual=await sha256Text(canonicalJson(result),digest);
  if(actual!==document.analysisSha256)fail('COOPS_ANALYSIS_WORKBOOK_RESULT','The saved workbook no longer recomputes to its original analysis.',{expected:document.analysisSha256,actual});
  return {document:{...document,analyst:analyst(document.analyst)},prepared,result};
}
