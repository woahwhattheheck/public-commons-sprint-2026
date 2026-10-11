// MIT. Native Tomorrow Timeline vintages for the original Austin weather intake.
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { readBytes, writeBytes, writeJson, jsonBytes, exists } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { readTimeline, digest } from './source.mjs';
import { fixedTime, id, text, need, ATTRIBUTION, CONTRACT } from './config.mjs';

export const AUSTIN_SCHEMA = 'stellar-forge.tomorrow-austin-forecast.v1';
const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
const metrics = { temperature_c: ['temperature', 'degC'], humidity_percent: ['humidity', 'percent'],
  ghi_w_m2: ['solarGHI', 'W/m2'], wind_m_s: ['windSpeed', 'm/s'] };
const columns = ['station_id', 'issued_at', 'valid_at', ...Object.keys(metrics), 'edition_id', 'response_sha256',
  'timeline_index', 'interval_index', 'timestep', 'acquired_at', 'provider_issued_at', 'availability_basis',
  'requested_latitude', 'requested_longitude', 'interval_json_pointer'];
const pointer = (value, path) => {
  need(typeof path === 'string' && path.startsWith('/'), 'WEATHER_SOURCE_POINTER_REQUIRED');
  for (const part of path.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    need(value !== null && typeof value === 'object' && Object.hasOwn(value, part), 'WEATHER_SOURCE_POINTER_MISSING');
    value = value[part];
  }
  return value;
};

/** Pure transformation; the caller retains exact source bytes and existing station identity. */
export function buildAustinForecast({ editions, stationId, timestep = '1h' } = {}) {
  stationId = text(stationId, 'WEATHER_EXISTING_STATION_ID_REQUIRED', 256);
  need(Array.isArray(editions) && editions.length > 0, 'WEATHER_FORECAST_EDITIONS_REQUIRED');
  const rows = [], sources = [], missing = [], keys = new Set(), editionIds = new Set(), files = new Map();
  for (const input of editions) {
    const { edition, responseBytes, providerIssuedAt } = input; id(edition.id);
    need(!editionIds.has(edition.id), 'WEATHER_DUPLICATE_FORECAST_EDITION'); editionIds.add(edition.id);
    need(edition.work.units === 'metric', 'WEATHER_AUSTIN_REQUIRES_NATIVE_METRIC');
    const source = edition.resources.timeline;
    need(responseBytes instanceof Uint8Array && source?.state === 'COMPLETE' && source.sha256 === digest(responseBytes) &&
      source.bytes === responseBytes.length, 'WEATHER_FORECAST_SOURCE_CHANGED');
    const request = edition.requests.find(r => r.kind === 'timeline').body, parsed = readTimeline(responseBytes, request);
    const availableAt = fixedTime(source.receivedAt), acquiredAt = availableAt;
    let issued = null, issuePointer = null;
    if (providerIssuedAt) {
      issuePointer = providerIssuedAt.jsonPointer;
      issued = fixedTime(pointer(parsed.value, issuePointer));
      need(providerIssuedAt.value === undefined || providerIssuedAt.value === issued, 'WEATHER_PROVIDER_ISSUE_TIME_CHANGED');
    }
    need(parsed.timelines.some(timeline => timeline.timestep === timestep), 'WEATHER_FORECAST_TIMESTEP_NOT_RETURNED');
    const excluded = [], before = rows.length;
    for (const [timelineIndex, timeline] of parsed.timelines.entries()) {
      if (timeline.timestep !== timestep) {
        excluded.push({ reason: 'UNSELECTED_TIMESTEP', timelineIndex, timestep: timeline.timestep, count: timeline.intervals.length });
        continue;
      }
      for (const [intervalIndex, interval] of timeline.intervals.entries()) {
        const intervalPointer = '/data/timelines/' + timelineIndex + '/intervals/' + intervalIndex;
        if (Date.parse(interval.startTime) < Date.parse(availableAt)) {
          excluded.push({ reason: 'VALID_BEFORE_AVAILABLE', timelineIndex, intervalIndex, validAt: interval.startTime,
            availableAt, jsonPointer: intervalPointer });
          continue;
        }
        const key = JSON.stringify([stationId, Date.parse(availableAt), Date.parse(interval.startTime)]);
        need(!keys.has(key), 'WEATHER_DUPLICATE_FORECAST_VINTAGE_INTERVAL'); keys.add(key);
        const row = { station_id: stationId, issued_at: availableAt, valid_at: interval.startTime,
          edition_id: edition.id, response_sha256: source.sha256, timeline_index: timelineIndex,
          interval_index: intervalIndex, timestep, acquired_at: acquiredAt, provider_issued_at: issued,
          availability_basis: 'RESPONSE_ACQUIRED_AT', requested_latitude: edition.work.location.latitude,
          requested_longitude: edition.work.location.longitude, interval_json_pointer: intervalPointer };
        for (const [column, [field]] of Object.entries(metrics)) {
          const present = Object.hasOwn(interval.values, field), value = interval.values[field];
          need(!present || value === null || typeof value === 'number' && Number.isFinite(value), 'WEATHER_FORECAST_MEASUREMENT_INVALID');
          row[column] = present && value !== null ? value : '';
          if (!present || value === null) missing.push({ outputRow: rows.length, column, field,
            state: present ? 'NULL' : 'ABSENT', jsonPointer: intervalPointer + '/values/' + field, editionId: edition.id });
        }
        rows.push(row);
      }
    }
    const responseFile = 'response-' + edition.id + '.json'; files.set(responseFile, Buffer.from(responseBytes));
    sources.push({ editionId: edition.id, stationId, responseFile, sha256: source.sha256, bytes: source.bytes,
      providerUrl: edition.requests.find(r => r.kind === 'timeline').url,
      requestedLocation: edition.work.location, request, startedAt: source.startedAt ?? null, receivedAt: source.receivedAt,
      acquiredAt, providerIssuedAt: issued, providerIssuedJsonPointer: issuePointer,
      availabilityBasis: 'Actual response acquisition time; provider issuance is a separate native value when supplied.',
      returnedExtent: parsed.returnedExtent, returnedIntervals: parsed.returnedIntervals,
      selectedTimestep: timestep, exportedRows: rows.length - before, excluded,
      nativeUnits: Object.fromEntries(Object.entries(metrics).map(([column, [field, unit]]) => [field, unit])) });
  }
  need(rows.length > 0, 'WEATHER_NO_FORECAST_ROWS_AVAILABLE');
  const csv = [columns.map(quote).join(','), ...rows.map(row => columns.map(column => quote(row[column])).join(','))].join('\r\n') + '\r\n';
  files.set('forecast-vintages.csv', Buffer.from(csv));
  const forecast = { file: 'forecast-vintages.csv', delimiter: ',',
    columns: { station_id: 'station_id', issued_at: 'issued_at', valid_at: 'valid_at',
      temperature_f: 'temperature_c', humidity_pct: 'humidity_percent', ghi_w_m2: 'ghi_w_m2', wind_mph: 'wind_m_s' },
    units: { temperature_f: 'degC', humidity_pct: 'percent', ghi_w_m2: 'W/m2', wind_mph: 'm/s' } };
  files.set('forecast-mapping.json', jsonBytes(forecast));
  const manifest = { schema: AUSTIN_SCHEMA, stationId, timestep, rows: rows.length, columns, sources, missing,
    mappingFile: 'forecast-mapping.json', mappingPurpose: 'Use as the forecast member of the original commons.austin-weather-intake.v1 mapping with its existing current and assets members.',
    semantics: { issued_at: 'Availability for analysis, as defined by the original Austin intake; actual response acquisition time.',
      provider_issued_at: 'Native provider field only; blank when the response supplies none.',
      valid_at: 'Exact native interval.startTime, preserving its offset.',
      cadence: 'Native forecast timestep and local acquisition cadence are distinct.',
      conversion: 'Original Austin intake performs its existing Decimal temperature/wind conversions.',
      missing: 'Blank CSV cells remain absent/null findings; source JSON and this manifest distinguish them.',
      station: 'Explicit existing station or accepted alias supplied by the operator.' },
    attribution: ATTRIBUTION, contracts: { timelines: CONTRACT.timelines, solar: CONTRACT.solar },
    files: [...files].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: digest(bytes) })) };
  return { files, manifest, forecast };
}

/** Authorized raw export follows the workspace's configured customer license. */
export async function exportAustinForecast({ workspace, editionIds, stationId, timestep = '1h', directory, providerIssuedByEdition = {} } = {}) {
  need(Array.isArray(editionIds) && editionIds.length, 'WEATHER_FORECAST_EDITIONS_REQUIRED');
  const handover = await workspace.handover({ editionIds, includeRaw: true });
  const editions = handover.payload.editions.map(edition => {
    const source = handover.payload.raw.find(entry => entry.editionId === edition.id && entry.kind === 'timeline');
    need(source, 'WEATHER_TIMELINE_REQUIRED');
    return { edition, responseBytes: Buffer.from(source.data, 'base64'), providerIssuedAt: providerIssuedByEdition[edition.id] };
  });
  const output = buildAustinForecast({ editions, stationId, timestep });
  directory = resolve(directory);
  await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  for (const [name, bytes] of output.files) {
    const path = join(directory, name);
    if (await exists(path)) need(digest(await readBytes(path, 16777216)) === digest(bytes), 'WEATHER_EXPORT_DESTINATION_DIFFERENT');
    else await writeBytes(path, bytes, { exclusive: true });
  }
  const manifestPath = join(directory, 'forecast-source.json'), manifestBytes = jsonBytes(output.manifest);
  if (await exists(manifestPath)) need(digest(await readBytes(manifestPath, 16777216)) === digest(manifestBytes), 'WEATHER_EXPORT_DESTINATION_DIFFERENT');
  else await writeJson(manifestPath, output.manifest, { exclusive: true });
  return { directory, manifestPath, rows: output.manifest.rows, editions: editions.length,
    csvSha256: digest(output.files.get('forecast-vintages.csv')), mapping: output.forecast };
}
