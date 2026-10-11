// MIT. The official Census address-batch contract, using the original CSV parser.
import { createCsvRecordParser } from '../dataset-handler.mjs';
import { csvLine } from '../postgres/publisher/plan.mjs';
import { digest, fault, object } from '../postgres/publisher/files.mjs';

export const CENSUS_API = 'https://geocoding.geo.census.gov/geocoder';
export const API_GUIDE = 'https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html';
export const MAX_INPUT_BYTES = 5_000_000;
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
export const COORDINATE_MEANING = 'Census MAF/TIGER address-range interpolation: approximate longitude/latitude, not a verified building location.';
export const COLUMNS = Object.freeze({
  record_id: { type: 'string', nullable: false },
  input_address: { type: 'string', nullable: false },
  match_status: { type: 'string', nullable: false },
  match_type: { type: 'string', nullable: true },
  matched_address: { type: 'string', nullable: true },
  longitude: { type: 'number', nullable: true },
  latitude: { type: 'number', nullable: true },
  coordinate_text: { type: 'string', nullable: true },
  tigerline_id: { type: 'string', nullable: true },
  tigerline_side: { type: 'string', nullable: true },
  state_fips: { type: 'string', nullable: true },
  county_fips: { type: 'string', nullable: true },
  tract_code: { type: 'string', nullable: true },
  block_code: { type: 'string', nullable: true },
  tract_geoid: { type: 'string', nullable: true },
  block_geoid: { type: 'string', nullable: true }
});
export function only(value, keys, message = 'Unsupported action fields.') {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key)))
    throw fault('GEOCODER_INPUT_INVALID', message);
}
export function csvRecords(bytes, { maximum = MAX_RESPONSE_BYTES, maxRecords = 10000 } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > maximum)
    throw fault('GEOCODER_FILE_SIZE', 'Choose a CSV within its displayed byte limit.');
  const result = [], parser = createCsvRecordParser(row => {
    if (result.length >= maxRecords) throw fault('GEOCODER_RECORD_LIMIT', 'Census accepts at most 10,000 addresses in one batch.');
    result.push(row);
  }, 65536);
  parser.feed(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  parser.end();
  return result;
}
export function inputAddresses(original, { header = false } = {}) {
  if (typeof header !== 'boolean') throw fault('GEOCODER_HEADER_CHOICE', 'Choose whether the CSV has a header.');
  const records = csvRecords(original, { maximum: MAX_INPUT_BYTES, maxRecords: 10001 });
  if (header) {
    const names = records.shift()?.map(value => value.toLowerCase().trim()) ?? [];
    const required = ['id', 'street', 'city', 'state', 'zip'];
    if (names.length < 5 || names.length > 6 || required.some((name, i) => names[i] !== name) ||
        names.length === 6 && names[5] !== 'urbanization')
      throw fault('GEOCODER_HEADER_INVALID', 'Use id,street,city,state,zip and optional urbanization, in that order.');
  }
  if (!records.length || records.length > 10000)
    throw fault('GEOCODER_RECORD_LIMIT', 'Choose 1–10,000 address records.');
  const seen = new Set();
  for (const [index, row] of records.entries()) {
    if (![5, 6].includes(row.length) || !row[0]?.trim() || !row[1]?.trim() ||
        row.some(value => /[\x00-\x1f\x7f]/.test(value)))
      throw fault('GEOCODER_ADDRESS_INVALID', 'Record ' + (index + 1) + ' needs an ID, street and five or six fields without control characters.');
    if (row[0].length > 256 || seen.has(row[0]))
      throw fault('GEOCODER_ID_INVALID', 'Retain distinct address IDs of at most 256 characters.');
    if ((!row[2].trim() || !row[3].trim()) && !row[4].trim())
      throw fault('GEOCODER_LOCALITY_REQUIRED', 'Record ' + row[0] + ' needs city and state, or ZIP.');
    if (row[5]?.trim() && row[3].toUpperCase() !== 'PR')
      throw fault('GEOCODER_URBANIZATION_INVALID', 'Urbanization is the sixth field for Puerto Rico addresses.');
    seen.add(row[0]);
  }
  const submitted = Buffer.from(records.map(csvLine).join(''));
  if (submitted.length > MAX_INPUT_BYTES)
    throw fault('GEOCODER_BATCH_SIZE', 'The submitted Census batch exceeds the 5,000,000-byte local limit.');
  return { records, submitted, count: records.length, originalSha256: digest(original),
    submittedSha256: digest(submitted), originalBytes: original.length, submittedBytes: submitted.length };
}
export function metadata(bytes, kind, selectedBenchmark) {
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const key = kind === 'benchmarks' ? 'benchmarks' : 'vintages', names = new Set();
  if (!object(value) || !Array.isArray(value[key]) || !value[key].length || value[key].length > 256 ||
      kind === 'vintages' && String(value.selectedBenchmark) !== String(selectedBenchmark))
    throw fault('GEOCODER_DISCOVERY_INVALID', 'The official metadata does not match this selection.');
  const options = value[key].map(item => {
    const name = item[kind === 'benchmarks' ? 'benchmarkName' : 'vintageName'];
    if (!object(item) || !/^[0-9]{1,12}$/.test(String(item.id)) || typeof name !== 'string' ||
        !name || name.length > 128 || names.has(String(item.id)))
      throw fault('GEOCODER_DISCOVERY_INVALID', 'The official selection list contains an invalid or repeated ID.');
    names.add(String(item.id));
    return { ...item, id: String(item.id) };
  });
  return { value, options };
}
export function parseBatchResponse(bytes, input, returnType = 'geographies') {
  if (!['locations', 'geographies'].includes(returnType)) throw fault('GEOCODER_RETURN_TYPE');
  const original = new Map(input.map(row => [row[0], row])), parsed = csvRecords(bytes), byId = new Map();
  const counts = { Match: 0, No_Match: 0, Tie: 0, Exact: 0, Non_Exact: 0 };
  for (const cells of parsed) {
    if (cells.length < 3 || cells.length > (returnType === 'geographies' ? 12 : 8) ||
        !original.has(cells[0]) || byId.has(cells[0]) ||
        !['Match', 'No_Match', 'Tie'].includes(cells[2]))
      throw fault('GEOCODER_RESPONSE_RECORD', 'The response must contain one recognized result for every submitted address ID.');
    const padded = [...cells]; while (padded.length < 12) padded.push('');
    const [id, inputAddress, status, type, matched, coordinates, tiger, side, state, county, tract, block] = padded;
    let longitude = null, latitude = null;
    if (status === 'Match') {
      const pair = coordinates.split(',');
      if (!['Exact', 'Non_Exact'].includes(type) || !matched || !tiger || !['L', 'R'].includes(side) ||
          pair.length !== 2 || pair.some(value => !/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())))
        throw fault('GEOCODER_MATCH_INVALID', 'A matched result is missing its original match or coordinate fields.');
      [longitude, latitude] = pair.map(Number);
      if (!Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(latitude) || Math.abs(latitude) > 90)
        throw fault('GEOCODER_COORDINATE_INVALID', 'The returned longitude/latitude is outside its native range.');
      if (returnType === 'geographies' && [state, county, tract, block].some((value, i) => value && !new RegExp('^\\d{' + [2,3,6,4][i] + '}$').test(value)))
        throw fault('GEOCODER_GEOGRAPHY_INVALID', 'Geography codes must retain their original zero-padded Census widths.');
      counts[type]++;
    } else if (padded.slice(3).some(value => value !== '')) {
      throw fault('GEOCODER_UNMATCHED_FIELDS', 'An unmatched or tied result unexpectedly contains match fields; retain and inspect the original response.');
    }
    const tractGeoid = state && county && tract ? state + county + tract : null;
    const row = { record_id: id, input_address: inputAddress, match_status: status,
      match_type: type || null, matched_address: matched || null, longitude, latitude,
      coordinate_text: coordinates || null, tigerline_id: tiger || null, tigerline_side: side || null,
      state_fips: state || null, county_fips: county || null, tract_code: tract || null, block_code: block || null,
      tract_geoid: tractGeoid, block_geoid: tractGeoid && block ? tractGeoid + block : null };
    counts[status]++; byId.set(id, row);
  }
  if (byId.size !== input.length)
    throw fault('GEOCODER_RESPONSE_INCOMPLETE', 'The original batch response omitted submitted address IDs.');
  return { rows: input.map(row => byId.get(row[0])), counts,
    responseSha256: digest(bytes), responseBytes: bytes.length, coordinateMeaning: COORDINATE_MEANING };
}
/** Fetch only the official endpoint; callers retain the response before interpretation. */
export async function censusRequest(path, { method = 'GET', submitted, benchmark, vintage,
  signal, timeoutMs = 300000, fetch: fetcher = globalThis.fetch } = {}) {
  if (!['/benchmarks', '/vintages', '/locations/addressbatch', '/geographies/addressbatch'].includes(path))
    throw fault('GEOCODER_ENDPOINT_INVALID');
  const url = new URL(CENSUS_API + path);
  let body;
  if (path === '/vintages') url.searchParams.set('benchmark', String(benchmark));
  if (method === 'POST') {
    if (!path.endsWith('/addressbatch') || !Buffer.isBuffer(submitted)) throw fault('GEOCODER_BATCH_REQUEST_INVALID');
    body = new FormData();
    body.set('addressFile', new Blob([submitted], { type: 'text/csv' }), 'addresses.csv');
    body.set('benchmark', String(benchmark));
    if (path.startsWith('/geographies/')) body.set('vintage', String(vintage));
  } else if (method !== 'GET' || path.endsWith('/addressbatch')) throw fault('GEOCODER_METHOD_INVALID');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 900000) throw fault('GEOCODER_TIMEOUT_INVALID');
  const timeout = AbortSignal.timeout(timeoutMs), joined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const startedAt = new Date().toISOString();
  const response = await fetcher(url.href, { method, body, signal: joined, redirect: 'error',
    headers: { accept: method === 'POST' ? 'text/csv,text/plain;q=0.9' : 'application/json',
      'user-agent': 'Starforge-Census-Geocoder/1.0 (+https://github.com/woahwhattheheck/public-commons-sprint-2026)' } });
  const maximum = method === 'POST' ? MAX_RESPONSE_BYTES : 1024 * 1024;
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maximum) {
    await response.body?.cancel();
    throw fault('GEOCODER_RESPONSE_SIZE', 'The official response exceeds its retained size limit.');
  }
  const chunks = []; let length = 0;
  try {
    for await (const chunk of response.body ?? []) {
      length += chunk.length;
      if (length > maximum) throw fault('GEOCODER_RESPONSE_SIZE');
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
  const output = Buffer.concat(chunks);
  return { bytes: output, exchange: { schema: 'stellar-forge.census-geocoder-http.v1',
    requestedUrl: url.href, url: response.url || url.href, method, status: response.status,
    contentType: response.headers.get('content-type'), etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'), retryAfter: response.headers.get('retry-after'),
    startedAt, receivedAt: new Date().toISOString(), bytes: output.length, sha256: digest(output),
    submittedSha256: submitted ? digest(submitted) : null,
    benchmark: benchmark === undefined ? null : String(benchmark), vintage: vintage === undefined ? null : String(vintage) } };
}
