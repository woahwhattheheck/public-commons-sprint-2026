// MIT. Import original captured HTTP bytes without issuing another provider request.
import { join, resolve } from 'node:path';
import { digest, identity, readPrivate, privateDirectory, fault, object } from '../postgres/publisher/files.mjs';
import { CENSUS_API, MAX_INPUT_BYTES, MAX_RESPONSE_BYTES, inputAddresses, metadata, parseBatchResponse, only } from './source.mjs';

export const RECORDING_SCHEMA = 'stellar-forge.census-geocoder-capture.v1';
function exchange(value, body, { path, method = 'GET', benchmark = null, vintage = null, submittedSha256 = null }) {
  if (!object(value) || value.schema !== 'stellar-forge.census-geocoder-http.v1') throw fault('GEOCODER_CAPTURE_HTTP_SCHEMA');
  const expected = new URL(CENSUS_API + path);
  if (path === '/vintages') expected.searchParams.set('benchmark', String(benchmark));
  if (value.requestedUrl !== expected.href || value.url !== expected.href || value.method !== method ||
      value.status !== 200 || value.sha256 !== digest(body) || value.bytes !== body.length ||
      (value.benchmark ?? null) !== benchmark || (value.vintage ?? null) !== vintage ||
      (value.submittedSha256 ?? null) !== submittedSha256 ||
      typeof value.contentType !== 'string' ||
      !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.receivedAt)) ||
      Date.parse(value.receivedAt) < Date.parse(value.startedAt))
    throw fault('GEOCODER_CAPTURE_HTTP_BINDING', 'Retain the exact successful Census request, response and submitted CSV binding.');
  return value;
}
/** Fixed filenames are deliberate: a capture is data, never a path/URL program. */
export async function readGeocoderRecording(directory) {
  if (typeof directory !== 'string' || !directory) throw fault('GEOCODER_CAPTURE_DIRECTORY');
  directory = resolve(directory); await privateDirectory(directory);
  const manifestBytes = await readPrivate(join(directory, 'capture.json'), 65536);
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  only(manifest, ['schema', 'label', 'header', 'returnType', 'benchmark', 'vintage', 'inputSha256', 'submittedSha256']);
  if (manifest.schema !== RECORDING_SCHEMA || typeof manifest.label !== 'string' ||
      !manifest.label.trim() || manifest.label.length > 128 ||
      !['locations', 'geographies'].includes(manifest.returnType) ||
      typeof manifest.header !== 'boolean' || !/^\d{1,12}$/.test(manifest.benchmark) ||
      manifest.returnType === 'geographies' && !/^\d{1,12}$/.test(manifest.vintage) ||
      manifest.returnType === 'locations' && manifest.vintage !== null)
    throw fault('GEOCODER_CAPTURE_MANIFEST');
  const originals = { 'capture.json': manifestBytes };
  for (const name of ['input.csv', 'submitted.csv'])
    originals[name] = await readPrivate(join(directory, name), MAX_INPUT_BYTES);
  const input = inputAddresses(originals['input.csv'], { header: manifest.header });
  const submitted = inputAddresses(originals['submitted.csv'], { header: false });
  if (manifest.inputSha256 !== digest(originals['input.csv']) ||
      manifest.submittedSha256 !== digest(originals['submitted.csv']) ||
      identity(input.records) !== identity(submitted.records))
    throw fault('GEOCODER_CAPTURE_INPUT_CHANGED', 'The captured submission must contain the same reviewed address records.');
  const options = {};
  for (const kind of ['benchmarks', ...(manifest.returnType === 'geographies' ? ['vintages'] : [])]) {
    originals[kind + '.json'] = await readPrivate(join(directory, kind + '.json'), 1024 * 1024);
    originals[kind + '-http.json'] = await readPrivate(join(directory, kind + '-http.json'), 65536);
    const http = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(originals[kind + '-http.json']));
    exchange(http, originals[kind + '.json'], { path: '/' + kind, benchmark: kind === 'vintages' ? manifest.benchmark : null });
    options[kind] = { raw: originals[kind + '.json'], httpBytes: originals[kind + '-http.json'], http,
      parsed: metadata(originals[kind + '.json'], kind, manifest.benchmark) };
  }
  const benchmark = options.benchmarks.parsed.options.find(value => value.id === manifest.benchmark);
  const vintage = manifest.returnType === 'geographies' ?
    options.vintages.parsed.options.find(value => value.id === manifest.vintage) : null;
  if (!benchmark || manifest.returnType === 'geographies' && !vintage)
    throw fault('GEOCODER_CAPTURE_SELECTION', 'The original metadata must contain the exact benchmark and vintage used.');
  originals['response.csv'] = await readPrivate(join(directory, 'response.csv'), MAX_RESPONSE_BYTES);
  originals['http.json'] = await readPrivate(join(directory, 'http.json'), 65536);
  const http = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(originals['http.json']));
  exchange(http, originals['response.csv'], { path: '/' + manifest.returnType + '/addressbatch', method: 'POST',
    benchmark: manifest.benchmark, vintage: manifest.vintage, submittedSha256: manifest.submittedSha256 });
  const parsed = parseBatchResponse(originals['response.csv'], input.records, manifest.returnType);
  const files = Object.fromEntries(Object.entries(originals).map(([name, value]) => [name, { bytes: value.length, sha256: digest(value) }]));
  return { directory, manifest, originals, input, submitted, benchmark, vintage, options, http, parsed,
    recordingSha256: identity(files), files };
}
