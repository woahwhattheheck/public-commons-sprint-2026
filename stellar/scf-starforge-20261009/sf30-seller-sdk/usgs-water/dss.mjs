// MIT. Native HEC-DSS receiving for original immutable USGS water editions.
import { constants, createReadStream } from 'node:fs';
import { open, readFile, readdir, lstat, realpath, rename, rm, chmod, mkdir, copyFile, link, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { canonicalJson, readCapture, captureRows } from './provider.mjs';
import { readWaterEdition } from './merchant.mjs';
import { seriesIdentity, seriesKey, inWindow, windowOf, compareCaptures } from './analysis.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_FILE = 256 * 1024 * 1024, MAX_ROWS = 1000000;
const SCHEMA = 'starforge.usgs-dss-export.v1';
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonicalJson(value)).digest('hex');
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const INTERVALS = Object.freeze({ '1Minute':60, '2Minute':120, '3Minute':180, '4Minute':240, '5Minute':300, '6Minute':360,
  '10Minute':600, '12Minute':720, '15Minute':900, '20Minute':1200, '30Minute':1800,
  '1Hour':3600, '2Hour':7200, '3Hour':10800, '4Hour':14400, '6Hour':21600, '8Hour':28800, '12Hour':43200, '1Day':86400 });
const IRREGULAR = ['Ir-Day', 'Ir-Month', 'Ir-Year', 'Ir-Decade', 'Ir-Century'];
function fail(message, code = 'WATER_DSS_INVALID', status = 400, detail) { throw Object.assign(new Error(message), { code, status, ...(detail ? { detail } : {}) }); }
function need(condition, message, code, status) { if (!condition) fail(message, code, status); }
export function dssOperationId(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value), 'Use a stable name with letters, digits, hyphens or underscores.');
  return value;
}
function relativePath(value) {
  need(typeof value === 'string' && value.length <= 1024 && !value.includes('\\') && !value.includes('\0') &&
    value.split('/').every(part => part && part !== '.' && part !== '..'), 'A retained file has an invalid path.', 'WATER_DSS_CHANGED', 409);
  return value;
}
async function privateBytes(path, max = MAX_FILE) {
  need(await realpath(dirname(path)) === dirname(path), 'The retained file parent changed.', 'WATER_DSS_CHANGED', 409);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const a = await file.stat();
    need(a.isFile() && a.nlink === 1 && !(a.mode & 0o077) && a.size <= max, 'The retained file is not a private regular file.', 'WATER_DSS_CHANGED', 409);
    const bytes = await file.readFile(), b = await file.stat();
    need(bytes.length === a.size && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs,
      'The retained file changed while reading.', 'WATER_DSS_CHANGED', 409);
    return bytes;
  } finally { await file.close(); }
}
async function descriptor(root, relative, maximum = MAX_FILE) {
  const path = join(root, relativePath(relative));
  need(await realpath(dirname(path)) === dirname(path), 'The retained file parent changed.', 'WATER_DSS_CHANGED', 409);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    need(before.isFile() && before.nlink === 1 && !(before.mode & 0o077) && before.size <= maximum,
      'The retained file is not a private regular file.', 'WATER_DSS_CHANGED', 409);
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) { hash.update(chunk); bytes += chunk.length; }
    const after = await file.stat();
    need(bytes === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
      'The retained file changed while reading.', 'WATER_DSS_CHANGED', 409);
    return { path: relative, bytes, sha256: hash.digest('hex') };
  } finally { await file.close(); }
}
async function writePrivate(path, bytes) {
  const folder = await privateDirectory(dirname(path)), temporary = join(folder, '.write-' + randomUUID());
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(bytes); await file.sync(); await file.close();
    await link(temporary, path); await unlink(temporary);
    const directory = await open(folder, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}
async function ensurePrivate(path, bytes) {
  try { await writePrivate(path, bytes); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need(sha(await privateBytes(path)) === sha(bytes), 'The retained member differs from this operation: ' + path.split('/').at(-1), 'WATER_DSS_CHANGED', 409);
  }
}
async function readOrNull(path, max = MAX_FILE) {
  try { return await readPrivateJson(path, max); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const field = (row, key) => row[key] ?? row.properties?.[key] ?? null;
const rowId = row => sha({ collection: row.collection, featureId: row.feature_id, properties: row.properties, geometry: row.geometry });
async function sourceEdition(directory) {
  const edition = await readWaterEdition(resolve(directory)), capture = await readCapture(join(edition.directory, 'capture'));
  need(capture.status === 'COMPLETE' && capture.captureSha256 === edition.captureSha256, 'Use a complete, unchanged source edition.', 'WATER_DSS_SOURCE_CHANGED', 409);
  const rows = await captureRows(capture, { exactUnique: true });
  need(rows.length <= MAX_ROWS, 'The selected edition exceeds the original one-million-row edition limit.');
  const groups = new Map();
  for (const row of rows) {
    if (!['daily', 'continuous'].includes(row.collection) || field(row, 'time') === null) continue;
    const key = seriesKey(row);
    if (!groups.has(key)) groups.set(key, { key, ...seriesIdentity(row), rows: [] });
    groups.get(key).rows.push(row);
  }
  return { edition, capture, rows, groups };
}
function sourceView(source, workspaceEditionId) {
  return { workspaceEditionId: workspaceEditionId ?? null, editionId: source.edition.editionId,
    captureSha256: source.edition.captureSha256, selectionSha256: source.edition.selectionSha256,
    operationId: source.edition.operationId, capturedAt: source.edition.capturedAt,
    rowCount: source.edition.rowCount, selection: source.edition.selection };
}
function groupView(group) {
  const times = group.rows.map(row => String(field(row, 'time'))).sort();
  const approvals = {}, valueStates = {};
  for (const row of group.rows) {
    const approval = String(field(row, 'approval_status') ?? '(not supplied)');
    approvals[approval] = (approvals[approval] ?? 0) + 1;
    valueStates[row.value_state] = (valueStates[row.value_state] ?? 0) + 1;
  }
  const { rows, ...identity } = group;
  return { ...identity, observations: rows.length, from: times[0], through: times.at(-1), approvals, valueStates };
}
export async function inspectDssEdition({ editionDirectory, workspaceEditionId }) {
  const source = await sourceEdition(editionDirectory);
  return { source: sourceView(source, workspaceEditionId), series: [...source.groups.values()].map(groupView),
    intervals: Object.keys(INTERVALS), irregularBlocks: IRREGULAR,
    native: { package: 'hecdss', version: '0.1.33', format: 'HEC-DSS7', numberEncoding: 'IEEE-754 binary64' } };
}
function actualDate(text) {
  need(typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(text + 'T00:00:00Z')) &&
    new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) === text, 'The source includes an invalid calendar date.');
  return text;
}
function nativeClock(row, config) {
  const value = String(field(row, 'time'));
  if (row.collection === 'daily') {
    actualDate(value);
    need(config.time?.mode === 'calendar-day' && config.time?.label === 'end-of-day',
      'Map daily source dates explicitly to the end of their local calendar day.');
    return new Date(Date.parse(value + 'T00:00:00Z') + 86400000).toISOString().slice(0, 19);
  }
  need(config.time?.mode === 'utc-instant' && config.time?.zone === 'UTC',
    'Continuous records require UTC instants normalized from their supplied offsets.');
  const match = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  need(match && Number(match[1]) < 24 && Number(match[2]) < 60 && Number(match[3] ?? 0) < 60, 'A continuous timestamp needs an actual clock and explicit offset.');
  actualDate(value.slice(0, 10));
  need(!match[4] || /^0+$/.test(match[4]), 'A source timestamp has subsecond precision that this DSS binding cannot preserve.');
  const stamp = Date.parse(value);
  need(Number.isFinite(stamp), 'The source timestamp cannot be converted to UTC.');
  return new Date(stamp).toISOString().slice(0, 19);
}
function numeric(row) {
  if (row.value_state !== 'decimal') return { value: null, reason: row.value_state ?? 'missing' };
  const original = String(field(row, 'value')), value = Number(original);
  need(Number.isFinite(value), 'A source decimal is outside native double precision range.');
  need(value !== -3.4028234663852886e38, 'A numeric source value collides with the DSS missing-data sentinel.');
  need(value !== 0 || !/[1-9]/.test(original.split(/[eE]/)[0]), 'A nonzero source decimal would underflow to zero.');
  return { value, reason: null };
}
function normalizedConfig(config, group) {
  need(plain(config) && config.key === group.key && ['regular', 'irregular'].includes(config.kind), 'Choose an original series and its regular or irregular representation.');
  const path = config.path;
  need(plain(path), 'Supply the A, B, C and F pathname parts.');
  for (const part of ['a', 'b', 'c', 'f'])
    need(typeof path[part] === 'string' && /^[A-Z0-9][A-Z0-9 _.-]{0,63}$/.test(path[part]) && path[part] === path[part].trim(),
      'Use explicit uppercase DSS pathname parts containing letters, digits, spaces, underscores, periods or hyphens.');
  need(config.kind === 'regular' ? own(INTERVALS, config.interval) : IRREGULAR.includes(config.interval), 'Select a supported native interval or irregular block.');
  need(group.collection !== 'daily' || config.kind === 'regular' && config.interval === '1Day', 'Daily calendar statistics use a regular one-day DSS series.');
  need(typeof config.units === 'string' && /^[A-Z0-9][A-Z0-9 /().^_-]{0,38}$/.test(config.units), 'Specify the receiving units in at most 39 ASCII characters.');
  need(config.units === group.unit || typeof config.unitMeaning === 'string' && config.unitMeaning.trim().length >= 8,
    'Describe the exact unit spelling equivalence. This exporter does not convert measurement values.');
  need(['INST-VAL', 'INST-CUM', 'PER-AVER', 'PER-CUM'].includes(config.dataType), 'Select the DSS measurement type.');
  need(typeof config.measurementMeaning === 'string' && config.measurementMeaning.trim().length >= 8,
    'Record the measurement and period meaning for the analyst.');
  if (group.collection === 'daily' && group.statisticId === '00003')
    need(config.dataType === 'PER-AVER', 'USGS statistic 00003 is a period mean; map it to PER-AVER.');
  need(plain(config.time) && typeof config.time.zone === 'string' && config.time.zone.length <= 39 &&
    typeof config.time.basis === 'string' && config.time.basis.trim().length >= 8, 'Supply the source clock convention, zone and its basis.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: config.time.zone }).format(0); } catch { fail('Use an actual IANA time-zone name, such as America/New_York or UTC.'); }
  const quality = config.selection?.quality ?? 'all';
  need(['all', 'approved', 'provisional'].includes(quality), 'Choose all, approved or provisional source records.');
  need(['none', 'approval'].includes(config.nativeNotes ?? 'none'), 'Choose no native notes or exact source approval text.');
  if (config.qualityWords !== undefined) need(plain(config.qualityWords) && Object.values(config.qualityWords).every(v => Number.isInteger(v) && v >= -2147483648 && v <= 2147483647),
    'Your optional quality mapping must contain one signed 32-bit word for each selected source approval/qualifier key.');
  need(config.acceptBinary64 === true, 'Review and accept the native double representation; original decimal text remains in the source edition.');
  return { key: group.key, kind: config.kind, path: { a: path.a, b: path.b, c: path.c, f: path.f },
    interval: config.interval, units: config.units, unitMeaning: config.unitMeaning ?? '',
    dataType: config.dataType, measurementMeaning: config.measurementMeaning,
    time: { mode: config.time.mode, zone: config.time.zone, label: config.time.label ?? null, basis: config.time.basis },
    selection: { quality, window: windowOf(config.selection?.window) },
    choices: config.choices ?? {}, nativeNotes: config.nativeNotes ?? 'none',
    ...(config.qualityWords === undefined ? {} : { qualityWords: config.qualityWords }),
    acceptBinary64: true };
}
function mapSeries(group, supplied) {
  const config = normalizedConfig(supplied, group), candidates = new Map(), excluded = [];
  need(group.collection !== 'daily' || !Object.values(config.selection.window ?? {}).some(value => value.includes('T')), 'Use local calendar-date filters for daily observations.');
  for (const row of group.rows) {
    const accepted = inWindow(row, config.selection.window) &&
      (config.selection.quality === 'all' || String(field(row, 'approval_status') ?? '').toLowerCase() === config.selection.quality);
    if (!accepted) { excluded.push({ rowId: rowId(row), reason: 'operator source selection' }); continue; }
    const clock = nativeClock(row, config), rows = candidates.get(clock) ?? [];
    rows.push(row); candidates.set(clock, rows);
  }
  need(candidates.size > 0, 'The series has no observations under this source selection.');
  const chosen = [], conflicts = [];
  for (const [clock, rows] of [...candidates].sort(([a], [b]) => a.localeCompare(b))) {
    const choice = config.choices[clock], selected = rows.length === 1 && !choice ? rows[0] : rows.find(row => rowId(row) === choice);
    if (!selected) {
      conflicts.push({ clock, choices: rows.map(row => ({ rowId: rowId(row), featureId: row.feature_id, sourceTime: field(row, 'time'),
        value: field(row, 'value'), valueState: row.value_state, approval: field(row, 'approval_status'), qualifier: field(row, 'qualifier'),
        lastModified: field(row, 'last_modified'), sourceSha256: row.source_sha256 })) });
      continue;
    }
    for (const row of rows) if (row !== selected) excluded.push({ rowId: rowId(row), reason: 'operator duplicate-time choice' });
    chosen.push({ clock, row: selected });
  }
  if (conflicts.length) fail('Choose the original observation to use at each conflicting DSS timestamp.', 'WATER_DSS_TIME_CONFLICT', 409, { key: group.key, conflicts });
  for (const clock of Object.keys(config.choices)) need(candidates.has(clock), 'A retained duplicate-time choice no longer belongs to the selected source.');
  const points = [];
  if (config.kind === 'regular') {
    const step = INTERVALS[config.interval] * 1000, first = Date.parse(chosen[0].clock + 'Z'), last = Date.parse(chosen.at(-1).clock + 'Z');
    need(first % 60000 === 0 && (last - first) % step === 0, 'Regular records must align to the selected minute-or-longer native grid.');
    const count = (last - first) / step + 1;
    need(count <= MAX_ROWS, 'The resulting regular grid exceeds the original one-million-row limit.');
    const byClock = new Map(chosen.map(point => [point.clock, point]));
    for (const point of chosen) need((Date.parse(point.clock + 'Z') - first) % step === 0, 'A source timestamp falls between the selected regular grid positions.');
    for (let index = 0; index < count; index++) {
      const clock = new Date(first + index * step).toISOString().slice(0, 19);
      points.push(byClock.get(clock) ?? { clock, row: null });
    }
  } else points.push(...chosen);
  const native = { key: group.key, pathname: '/' + config.path.a + '/' + config.path.b + '/' + config.path.c + '//' + config.interval + '/' + config.path.f + '/',
    kind: config.kind, interval: config.interval, times: [], values: [], units: config.units, dataType: config.dataType, timeZone: config.time.zone };
  if (config.nativeNotes === 'approval') native.notes = [];
  if (config.qualityWords !== undefined) native.quality = [];
  const rowMap = [], missingStates = {};
  let gaps = 0, nonIntegerValues = 0;
  for (const [index, point] of points.entries()) {
    const row = point.row, number = row ? numeric(row) : { value: null, reason: 'absent grid position' };
    native.times.push(point.clock); native.values.push(number.value);
    if (number.reason) missingStates[number.reason] = (missingStates[number.reason] ?? 0) + 1;
    if (!row) gaps++;
    if (number.value !== null && !Number.isSafeInteger(number.value)) nonIntegerValues++;
    if (native.notes) {
      const note = row ? String(field(row, 'approval_status') ?? '') : '';
      need(Buffer.byteLength(note, 'utf8') <= 39 && !note.includes('\0'), 'An original approval note exceeds the native 39-byte receiving limit; select no native notes and retain it in source metadata.');
      native.notes.push(note);
    }
    if (native.quality) {
      const key = row ? canonicalJson([field(row, 'approval_status'), field(row, 'qualifier')]) : 'missing-grid-position';
      need(own(config.qualityWords, key), 'Supply your explicit quality word for ' + key + '. No USGS-to-HEC code is inferred.');
      native.quality.push(config.qualityWords[key]);
    }
    rowMap.push({ seriesKey: group.key, index, nativeClock: point.clock, rowId: row ? rowId(row) : null,
      sourceTime: row ? field(row, 'time') : null, originalValue: row ? field(row, 'value') : null,
      valueState: row?.value_state ?? 'absent-grid-position', nativeValue: number.value,
      featureId: row?.feature_id ?? null, approvalStatus: row ? field(row, 'approval_status') : null,
      qualifier: row ? field(row, 'qualifier') : null, sourceUrl: row?.source_url ?? null,
      sourceSha256: row?.source_sha256 ?? null, sourcePage: row?.source_page ?? null });
  }
  need(native.values.some(value => value !== null), 'This selection has only missing/non-numeric values; no native data record could be received.');
  return { config, native, rowMap, view: { ...groupView(group), pathname: native.pathname, nativeCount: points.length,
    selectedSourceRows: chosen.length, excludedRows: excluded.length, insertedMissingPositions: gaps, missingStates,
    binary64NonIntegerOrLargeValues: nonIntegerValues, firstClock: native.times[0], lastClock: native.times.at(-1),
    preview: rowMap.length <= 12 ? rowMap : [...rowMap.slice(0, 6), ...rowMap.slice(-6)], excluded } };
}
async function buildPlan({ editionDirectory, workspaceEditionId, mapping, previousExport, previousEditionDirectory }) {
  const source = await sourceEdition(editionDirectory);
  need(plain(mapping) && mapping.schema === 'starforge.usgs-dss-mapping.v1' && Array.isArray(mapping.series) && mapping.series.length,
    'Supply a complete DSS mapping with at least one selected original series.');
  need(typeof mapping.title === 'string' && mapping.title.trim() && mapping.title.length <= 200, 'Give this analyst handover a title.');
  const seen = new Set(), paths = new Set(), mapped = [];
  for (const config of mapping.series) {
    need(!seen.has(config.key) && source.groups.has(config.key), 'Each selected source series must occur exactly once.');
    seen.add(config.key);
    const result = mapSeries(source.groups.get(config.key), config);
    need(!paths.has(result.native.pathname.toUpperCase()), 'Two source series map to the same native DSS pathname.');
    paths.add(result.native.pathname.toUpperCase()); mapped.push(result);
  }
  const excluded = [...source.groups.keys()].filter(key => !seen.has(key)).sort();
  need(Array.isArray(mapping.excludedSeries) && canonicalJson([...mapping.excludedSeries].sort()) === canonicalJson(excluded),
    'Explicitly retain the list of unselected source series in this mapping.');
  let comparison = null;
  if (previousExport) {
    need(previousEditionDirectory, 'The preceding export needs its original source edition for comparison.');
    const previous = await sourceEdition(previousEditionDirectory);
    need(previous.edition.editionId === previousExport.source.editionId && previous.edition.captureSha256 === previousExport.source.captureSha256,
      'The preceding export no longer matches its source edition.', 'WATER_DSS_SOURCE_CHANGED', 409);
    comparison = compareCaptures(previous.capture, previous.rows, source.capture, source.rows);
  }
  const normalizedMapping = { schema: mapping.schema, title: mapping.title.trim(), excludedSeries: excluded, series: mapped.map(item => item.config) };
  const nativeRequest = { schema: 'starforge.usgs-dss-native.v1', series: mapped.map(item => item.native) };
  const rowMap = mapped.flatMap(item => item.rowMap);
  const content = { schema: 'starforge.usgs-dss-plan.v1', title: normalizedMapping.title, source: sourceView(source, workspaceEditionId),
    mapping: normalizedMapping, mappingSha256: sha(normalizedMapping), nativeRequestSha256: sha(json(nativeRequest)),
    rowMapSha256: sha(rowMap.map(row => JSON.stringify(row)).join('\n') + '\n'),
    previous: previousExport ? { exportId: previousExport.exportId, exportSha256: previousExport.exportSha256,
      source: previousExport.source, mappingChanged: previousExport.mappingSha256 !== sha(normalizedMapping) } : null,
    comparison: comparison ? { sameSelection: comparison.sameSelection, counts: comparison.counts } : null,
    series: mapped.map(item => item.view),
    totals: { selectedSeries: mapped.length, excludedSeries: excluded.length, nativeValues: mapped.reduce((n, item) => n + item.native.values.length, 0),
      sourceObservations: mapped.reduce((n, item) => n + item.view.selectedSourceRows, 0),
      insertedMissingPositions: mapped.reduce((n, item) => n + item.view.insertedMissingPositions, 0) } };
  return { source, plan: { ...content, planSha256: sha(content) }, nativeRequest, rowMap, comparison };
}
export async function previewDssExport(args) { return (await buildPlan(args)).plan; }

async function bridge(command, { directory, resultPath, args = [], env = process.env, signal, logPath, script = 'hecdss_bridge.py' }) {
  await privateDirectory(directory);
  const log = await open(logPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let child;
  try {
    const executable = env.USGS_HECDSS_PYTHON || 'python3';
    need(typeof executable === 'string' && !executable.includes('\0'), 'Configure one Python executable path in USGS_HECDSS_PYTHON.');
    const result = await new Promise((done, reject) => {
      let childError = null;
      child = spawn(executable, [join(HERE, script), command, ...args], {
        cwd: directory, shell: false, stdio: ['ignore', log.fd, log.fd], signal,
        env: { ...env, LC_ALL: 'C', LANG: 'C', PYTHONDONTWRITEBYTECODE: '1', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' },
      });
      // AbortError precedes process close. Keep its files and project ownership
      // until the original native process and inherited output descriptors close.
      child.on('error', error => { childError ??= error; });
      child.once('close', (code, terminationSignal) => childError ? reject(childError) : done({ code, terminationSignal }));
    });
    await log.sync();
    const native = await readOrNull(resultPath);
    if (result.code !== 0 || !native || !['READY', 'VERIFIED'].includes(native.status))
      fail(native?.error?.message ?? native?.message ?? 'The native DSS operation did not complete. Reopen its retained request and log.',
        'WATER_DSS_NATIVE_FAILED', 409, { process: result, native });
    return native;
  } catch (error) {
    if (error.code === 'ENOENT') fail('Install the official hecdss 0.1.33 binding in the selected Python environment. See HEC-DSS runtime setup.', 'WATER_DSS_RUNTIME_REQUIRED', 409);
    throw error;
  } finally { await log.close(); }
}
export async function probeDssRuntime({ directory, env = process.env, signal }) {
  const root = await privateDirectory(resolve(directory)), temporary = await privateDirectory(join(root, '.runtime-' + randomUUID()));
  try { return await bridge('probe', { directory: temporary, resultPath: join(temporary, 'result.json'),
    args: ['--result', join(temporary, 'result.json')], logPath: join(temporary, 'engine.log'), env, signal }); }
  finally { await rm(temporary, { recursive: true, force: true }); }
}
function guide(plan) {
  const lines = [
    '# ' + plan.title, '', '## Open the received data', '',
    'Open delivery/observations.dss in HEC-DSSVue or the DSS browser of the receiving HEC application. The file contains these datasets:', '',
    ...plan.series.map(series => '- ' + series.pathname + ' — ' + series.nativeCount + ' values; ' + series.firstClock + ' through ' + series.lastClock + '.'),
    '', 'Read delivery/report.html for the source and mapping. delivery/row-map.jsonl connects every native position to the original source observation. A position without a source row is an explicitly missing regular-grid position.',
    '', '## Meaning of the records', '',
    ...plan.mapping.series.map(series => series.path.b + ' / ' + series.path.c + ': ' + series.measurementMeaning + ' Units: ' + series.units +
      '. ' + series.unitMeaning + ' Time basis: ' + series.time.basis + ' Zone: ' + series.time.zone + '.'),
    '', 'The native file uses double-precision numbers. Complete original decimal text, dates, offsets, quality and retained USGS response bodies are in the unchanged source edition. No measurement unit conversion, interpolation, averaging or payment operation occurs during this handover.',
    '', 'Daily statistics are mapped to the end of their explicitly chosen local calendar day. Continuous instants are normalized from their supplied offset to UTC. The native time-zone label is retained; it is not an instruction to the library to convert clocks.',
    '', 'Native missing values use DSS_UNDEFINED_VALUE. They are not zero. Optional quality words are the analyst’s explicit coding; no numerical USGS/HEC quality mapping is inferred. Native approval notes, when selected, preserve the original text. Full qualifiers remain in the source.',
    '', '## Reopen or compare', '',
    'Reopening the same export verifies its closed files and does not reacquire USGS data or rewrite a completed DSS file. Acquire a later source capture through the existing Water operations application, save its review/edition, and select this export as the predecessor. Added, removed and changed original features are compared using the original source comparison.',
    '', '## Portable receiving', '',
    'The complete handover archive includes this export, the entire original immutable source edition, the official Python bridge and both MIT notices. Keep the two directories together. The edition includes observations, analysis/review and all retained USGS request/response pages.',
    '', 'With the same version of Stellar Forge installed, receive into a private workspace:',
    '', '    starforge usgs-water dss-receive --project /private/receiving-water --file HANDOVER.zip',
    '', 'The original edition and export IDs are preserved. Existing different work is never replaced. Open the workspace and use its HEC-DSS tab; the received native file is also usable directly in the HEC application.',
    '', 'To independently verify without the application, install Python 3.9+ with hecdss==0.1.33, numpy and tzdata. From the unpacked handover run:',
    '', '    python3 hecdss_bridge.py verify --request export/native-request.json --file export/delivery/observations.dss --result receiving-result.json',
    '', 'The verifier uses a private temporary copy because this binding exposes read/write opening. It compares every timestamp, value, missing mask, unit, type and supplied quality/note after native reopen; the supplied DSS bytes remain unchanged.',
    '', '## Source identity', '', 'USGS capture: ' + plan.source.operationId, 'Source capture SHA-256: ' + plan.source.captureSha256,
    'Source edition: ' + plan.source.editionId, 'Mapping SHA-256: ' + plan.mappingSha256,
    ...(plan.previous ? ['', 'Preceding export: ' + plan.previous.exportId, 'The source comparison is retained in delivery/comparison.json.'] : []), '',
  ];
  return lines.join('\n');
}
function report(plan, native) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const rows = plan.series.map((series, index) => {
    const config = plan.mapping.series[index];
    return '<tr><td>' + escape(series.locationId) + '<br>' + escape(series.parameterCode + ' / ' + series.statisticId) + '</td><td><code>' +
      escape(series.pathname) + '</code></td><td>' + series.selectedSourceRows + '</td><td>' + series.nativeCount + '</td><td>' +
      series.insertedMissingPositions + '</td><td>' + escape(config.units) + '<br>' + escape(config.dataType) + '</td><td>' +
      escape(config.time.zone) + '<br>' + escape(series.firstClock) + '<br>' + escape(series.lastClock) + '</td></tr>';
  }).join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escape(plan.title) + '</title><style>body{font:15px/1.55 system-ui,sans-serif;color:#202020;background:#fff;margin:0 auto;padding:32px;max-width:1120px}h1{font-size:26px}h2{font-size:19px;margin-top:28px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #c8c8c8;padding:10px;text-align:left;vertical-align:top}th{background:#f3f3f3}code{overflow-wrap:anywhere}p,li{max-width:90ch}.scroll{overflow:auto}small{color:#555}a{color:inherit}</style>' +
    '<h1>' + escape(plan.title) + '</h1><p>Native HEC-DSS7 receiving completed. ' + plan.totals.sourceObservations +
    ' selected original observations; ' + plan.totals.nativeValues + ' native positions.</p>' +
    '<p><a href="observations.dss">Open native DSS file</a> · <a href="row-map.jsonl">Complete observation mapping</a> · <a href="native-result.json">Native receiving result</a></p>' +
    '<div class="scroll"><table><thead><tr><th>Original series</th><th>DSS pathname</th><th>Source rows</th><th>Native positions</th><th>Missing grid positions</th><th>Units / type</th><th>Clock range</th></tr></thead><tbody>' + rows +
    '</tbody></table></div><h2>Analyst mapping</h2>' + plan.mapping.series.map(config => '<p><strong>' + escape(config.path.b + ' / ' + config.path.c) +
      '</strong><br>' + escape(config.measurementMeaning) + '<br>' + escape(config.unitMeaning) + '<br>' + escape(config.time.basis) + '</p>').join('') +
    '<h2>Original source</h2><p>USGS ' + escape(plan.source.operationId) + ', captured ' + escape(plan.source.capturedAt) + '.</p>' +
    '<p>Every original value string, time, quality field and source response remains in the accompanying unchanged edition. The export uses double precision and explicitly missing positions; it performs no unit conversion or interpolation.</p>' +
    (plan.comparison ? '<h2>Preceding source edition</h2><p>' + escape(JSON.stringify(plan.comparison.counts)) + '</p><p><a href="comparison.json">Complete original-feature comparison</a></p>' : '') +
    '<h2>Native receiving</h2><p>The official Python binding wrote the file, closed it, reopened it and compared every selected record. The detailed result names the actual loaded native library.</p><small>Export plan ' +
    escape(plan.planSha256) + ' · Native status ' + escape(native.status) + '</small></html>\n';
}
function exportSummary(value) {
  return { exportId: value.exportId, status: value.status, title: value.title, source: value.source,
    totals: value.totals, createdAt: value.createdAt, completedAt: value.completedAt, exportSha256: value.exportSha256,
    previous: value.previous, error: value.error ?? null };
}
async function checkedManifest(directory, verifyFiles = true) {
  const value = await readPrivateJson(join(directory, 'export.json'), MAX_FILE);
  const { exportSha256, ...content } = value;
  need(value.schema === SCHEMA && value.status === 'READY' && sha(content) === exportSha256 && Array.isArray(value.files),
    'The retained DSS export manifest changed.', 'WATER_DSS_CHANGED', 409);
  const seen = new Set();
  for (const file of value.files) {
    relativePath(file.path); need(!seen.has(file.path), 'The export contains a repeated member.', 'WATER_DSS_CHANGED', 409); seen.add(file.path);
    if (verifyFiles) {
      const actual = await descriptor(directory, file.path);
      need(actual.bytes === file.bytes && actual.sha256 === file.sha256, 'The retained DSS export member changed: ' + file.path, 'WATER_DSS_CHANGED', 409);
    }
  }
  need(['native-request.json', 'plan.json', 'delivery/observations.dss', 'delivery/native-result.json', 'delivery/row-map.jsonl'].every(path => seen.has(path)),
    'The DSS handover is incomplete.', 'WATER_DSS_CHANGED', 409);
  return value;
}
export async function readDssExport({ directory, exportId }) {
  const root = join(resolve(directory), dssOperationId(exportId));
  const value = await checkedManifest(root);
  need(value.exportId === exportId, 'The saved DSS operation identity changed.', 'WATER_DSS_CHANGED', 409);
  return { ...value, directory: root };
}
export async function listDssExports({ directory }) {
  const root = await privateDirectory(resolve(directory)), entries = await readdir(root, { withFileTypes: true }), result = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(entry.name)) continue;
    const dir = join(root, entry.name);
    const manifest = await readOrNull(join(dir, 'export.json'));
    if (manifest) { result.push(exportSummary(await checkedManifest(dir, false))); continue; }
    const saved = await readOrNull(join(dir, 'operation.json'));
    if (saved) result.push({ ...exportSummary(saved), status: saved.status === 'RUNNING' ? 'INTERRUPTED' : saved.status });
  }
  return result.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
export async function createDssExport({ directory, exportId, expectedPlanSha256, env = process.env, signal, onProgress, ...args }) {
  const root = await privateDirectory(resolve(directory));
  dssOperationId(exportId);
  return withPrivateLock(root, exportId + '.lock', async () => {
    const built = await buildPlan(args), { plan, nativeRequest, rowMap, comparison } = built;
    need(expectedPlanSha256 === plan.planSha256, 'The source or mapping changed since preview. Review this complete plan before creating the DSS file.', 'WATER_DSS_PLAN_CHANGED', 409);
    const target = await privateDirectory(join(root, exportId)), existing = await readOrNull(join(target, 'operation.json'));
    if (existing) need(existing.planSha256 === plan.planSha256, 'This export name already belongs to a different source or mapping. Reopen it or use another name.', 'WATER_DSS_OPERATION_CHANGED', 409);
    const completed = await readOrNull(join(target, 'export.json'));
    if (completed) return { ...(await readDssExport({ directory: root, exportId })), reopened: true };
    let operation = existing ?? { schema: SCHEMA, exportId, title: plan.title, source: plan.source, totals: plan.totals,
      planSha256: plan.planSha256, createdAt: new Date().toISOString(), status: 'PREPARED', attempts: [] };
    if (!existing) {
      await ensurePrivate(join(target, 'plan.json'), json(plan));
      await ensurePrivate(join(target, 'native-request.json'), json(nativeRequest));
      await ensurePrivate(join(target, 'row-map.pending.jsonl'), rowMap.map(row => JSON.stringify(row)).join('\n') + '\n');
      if (comparison) await ensurePrivate(join(target, 'comparison.pending.json'), json(comparison));
      await atomicJson(target, 'operation.json', operation);
    } else {
      need(sha(await privateBytes(join(target, 'plan.json'))) === sha(json(plan)) &&
        sha(await privateBytes(join(target, 'native-request.json'))) === plan.nativeRequestSha256,
        'An interrupted DSS request changed.', 'WATER_DSS_CHANGED', 409);
    }
    try {
      let delivery = join(target, 'delivery'), native = await readOrNull(join(delivery, 'result.json'));
      if (!native) {
        let attempt = operation.attempts.at(-1), attemptDir = attempt ? join(target, 'attempts', attempt) : null;
        native = attemptDir ? await readOrNull(join(attemptDir, 'native', 'result.json')) : null;
        if (!native || native.status !== 'VERIFIED') {
          attempt = randomUUID(); attemptDir = await privateDirectory(join(target, 'attempts', attempt));
          operation = { ...operation, status: 'RUNNING', error: null, attempts: [...operation.attempts, attempt], updatedAt: new Date().toISOString() };
          await atomicJson(target, 'operation.json', operation); await onProgress?.({ phase: 'NATIVE_WRITE_AND_REOPEN', exportId, attempt });
          native = await bridge('write', { directory: attemptDir, resultPath: join(attemptDir, 'native', 'result.json'),
            args: ['--request', join(target, 'native-request.json'), '--output-dir', join(attemptDir, 'native')],
            logPath: join(attemptDir, 'engine.log'), env, signal });
        }
        need(native.status === 'VERIFIED', 'The native file has not passed its complete receiving comparison.', 'WATER_DSS_NATIVE_FAILED', 409);
        await chmod(join(attemptDir, 'native'), 0o700);
        for (const name of ['observations.dss', 'result.json']) await chmod(join(attemptDir, 'native', name), 0o600);
        await rename(join(attemptDir, 'native'), delivery);
        await copyFile(join(attemptDir, 'engine.log'), join(delivery, 'engine.log'), constants.COPYFILE_EXCL);
        await chmod(join(delivery, 'engine.log'), 0o600);
      }
      need(native.status === 'VERIFIED', 'The interrupted native result is not complete.', 'WATER_DSS_NATIVE_FAILED', 409);
      const nativeFile = await descriptor(target, 'delivery/observations.dss');
      need(native.dss?.sha256 === nativeFile.sha256 && native.dss?.bytes === nativeFile.bytes && native.request?.sha256 === plan.nativeRequestSha256,
        'The closed native result does not match its original request and DSS bytes.', 'WATER_DSS_CHANGED', 409);
      for (const [name, bytes] of [
        ['native-result.json', json(native)], ['row-map.jsonl', await privateBytes(join(target, 'row-map.pending.jsonl'))],
        ['mapping.json', json(plan.mapping)], ['report.html', report(plan, native)], ['OPEN_HERE.md', guide(plan)],
        ...(comparison ? [['comparison.json', json(comparison)]] : []),
      ]) {
        await ensurePrivate(join(delivery, name), bytes);
      }
      const members = ['plan.json', 'native-request.json', 'delivery/observations.dss', 'delivery/native-result.json',
        'delivery/mapping.json', 'delivery/row-map.jsonl', 'delivery/report.html', 'delivery/OPEN_HERE.md',
        ...(comparison ? ['delivery/comparison.json'] : [])];
      if (await lstat(join(delivery, 'engine.log')).catch(() => null)) members.push('delivery/engine.log');
      const files = [];
      for (const path of members) files.push(await descriptor(target, path));
      const content = { schema: SCHEMA, exportId, status: 'READY', title: plan.title, source: plan.source,
        mapping: plan.mapping, mappingSha256: plan.mappingSha256, planSha256: plan.planSha256, nativeRequestSha256: plan.nativeRequestSha256,
        totals: plan.totals, series: plan.series, previous: plan.previous, comparison: plan.comparison,
        createdAt: operation.createdAt, completedAt: new Date().toISOString(), native: { status: native.status, engine: native.engine ?? native.runtime },
        files, downloads: { dss: 'delivery/observations.dss', report: 'delivery/report.html', mapping: 'delivery/mapping.json',
          rows: 'delivery/row-map.jsonl', native: 'delivery/native-result.json', ...(comparison ? { comparison: 'delivery/comparison.json' } : {}) } };
      await atomicJson(target, 'export.json', { ...content, exportSha256: sha(content) }, { exclusive: true });
      await atomicJson(target, 'operation.json', { ...operation, status: 'READY', completedAt: content.completedAt });
      await rm(join(target, 'row-map.pending.jsonl')); await rm(join(target, 'comparison.pending.json'), { force: true });
      await onProgress?.({ phase: 'READY', exportId, totals: plan.totals });
      return readDssExport({ directory: root, exportId });
    } catch (error) {
      await atomicJson(target, 'operation.json', { ...operation, status: signal?.aborted ? 'INTERRUPTED' : 'FAILED',
        error: { code: error.code ?? 'WATER_DSS_NATIVE_FAILED', message: error.message }, updatedAt: new Date().toISOString() }).catch(() => {});
      throw error;
    }
  });
}
export async function dssDownload({ directory, exportId, kind }) {
  const result = await readDssExport({ directory, exportId }), relative = result.downloads[kind];
  need(relative, 'Choose a file from the retained DSS export.');
  const file = result.files.find(item => item.path === relative);
  const mime = { dss: 'application/octet-stream', report: 'text/html; charset=utf-8', mapping: 'application/json', rows: 'application/x-ndjson', native: 'application/json', comparison: 'application/json' }[kind];
  return { path: join(result.directory, relative), bytes: file.bytes, sha256: file.sha256, mime,
    filename: exportId + '-' + relative.split('/').at(-1) };
}
export async function verifyDssExport({ directory, exportId, env = process.env, signal }) {
  const saved = await readDssExport({ directory, exportId }), temporary = await privateDirectory(join(saved.directory, '.receiving-' + randomUUID()));
  try { return await bridge('verify', { directory: temporary, resultPath: join(temporary, 'receiving.json'),
    args: ['--request', join(saved.directory, 'native-request.json'), '--file', join(saved.directory, 'delivery/observations.dss'), '--result', join(temporary, 'receiving.json')],
    logPath: join(temporary, 'engine.log'), env, signal }); }
  finally { await rm(temporary, { recursive: true, force: true }); }
}

export async function exportDssHandover({ directory, exportId, editionDirectory, env = process.env, signal }) {
  const root = await privateDirectory(resolve(directory));
  return withPrivateLock(root, dssOperationId(exportId) + '.lock', async () => {
    const saved = await readDssExport({ directory: root, exportId }), edition = await readWaterEdition(resolve(editionDirectory));
    need(edition.editionId === saved.source.editionId && edition.captureSha256 === saved.source.captureSha256,
      'The original edition differs from this DSS export.', 'WATER_DSS_SOURCE_CHANGED', 409);
    const output = join(saved.directory, 'handover.zip'), receiptPath = join(saved.directory, 'handover.receipt.json');
    const retained = await readOrNull(receiptPath);
    if (retained) {
      const actual = await descriptor(saved.directory, 'handover.zip', 8 * 1024 * 1024 * 1024);
      need(retained.exportSha256 === saved.exportSha256 && actual.sha256 === retained.sha256 && actual.bytes === retained.bytes,
        'The retained complete handover changed.', 'WATER_DSS_CHANGED', 409);
      return { ...retained, path: output, filename: exportId + '-HEC-DSS-handover.zip', mime: 'application/zip', reopened: true };
    }
    const working = await privateDirectory(join(saved.directory, '.handover-' + randomUUID())), files = [];
    for (const file of [await descriptor(saved.directory, 'export.json'), ...saved.files])
      files.push({ ...file, source: join(saved.directory, file.path), path: 'export/' + file.path });
    for (const file of [await descriptor(edition.directory, 'edition.json'), ...edition.files])
      files.push({ path: 'edition/' + file.path, source: join(edition.directory, file.path), bytes: file.bytes, sha256: file.sha256 });
    const first = '# ' + saved.title + '\n\nOpen export/delivery/observations.dss in your HEC application. Read export/delivery/report.html and export/delivery/OPEN_HERE.md for the exact source, mapping and receiving instructions.\n\nThe edition folder contains the complete unchanged USGS edition. The export folder contains the native request, mapped values, native DSS7 file and original receiving result.\n\n' +
      'Independent native verification:\n\n    python3 hecdss_bridge.py verify --request export/native-request.json --file export/delivery/observations.dss --result receiving-result.json\n\n' +
      'Requires Python 3.9+ and the official hecdss==0.1.33 binding with numpy and tzdata. Both original MIT notices are included.\n';
    await writePrivate(join(working, 'START_HERE.md'), first);
    files.push({ ...(await descriptor(working, 'START_HERE.md')), source: join(working, 'START_HERE.md') });
    for (const name of ['hecdss_bridge.py', 'LICENSE.hecdss-python.txt', 'LICENSE.hec-dss.txt']) {
      const bytes = await readFile(join(HERE, name));
      files.push({ path: name, source: join(HERE, name), bytes: bytes.length, sha256: sha(bytes) });
    }
    const spec = { schema: 'starforge.usgs-dss-handover.v1', exportId, exportSha256: saved.exportSha256,
      source: saved.source, completedAt: saved.completedAt, files };
    await writePrivate(join(working, 'spec.json'), json(spec));
    const result = await bridge('pack', { directory: working, resultPath: join(working, 'result.json'), script: 'dss_archive.py',
      args: ['--spec', join(working, 'spec.json'), '--output', output, '--result', join(working, 'result.json')],
      logPath: join(working, 'archive.log'), env, signal });
    const actual = await descriptor(saved.directory, 'handover.zip', 8 * 1024 * 1024 * 1024);
    need(actual.sha256 === result.sha256 && actual.bytes === result.bytes, 'The finished handover differs from its archive result.', 'WATER_DSS_CHANGED', 409);
    const receipt = { status: 'READY', exportId, exportSha256: saved.exportSha256, sha256: actual.sha256, bytes: actual.bytes,
      members: result.members, source: saved.source };
    await atomicJson(saved.directory, 'handover.receipt.json', receipt, { exclusive: true });
    await rm(working, { recursive: true, force: true });
    return { ...receipt, path: output, filename: exportId + '-HEC-DSS-handover.zip', mime: 'application/zip' };
  });
}
export async function receiveDssHandover({ directory, editionsDirectory, archive, env = process.env, signal }) {
  const root = await privateDirectory(resolve(directory)), editions = await privateDirectory(resolve(editionsDirectory));
  const temporary = await privateDirectory(join(root, '.receive-' + randomUUID())), unpacked = join(temporary, 'unpacked');
  try {
    const receipt = await bridge('receive', { directory: temporary, resultPath: join(temporary, 'result.json'), script: 'dss_archive.py',
      args: ['--file', resolve(archive), '--output-dir', unpacked, '--result', join(temporary, 'result.json')],
      logPath: join(temporary, 'archive.log'), env, signal });
    const edition = await readWaterEdition(join(unpacked, 'edition')), exported = await checkedManifest(join(unpacked, 'export'));
    const exportId = dssOperationId(exported.exportId), editionId = dssOperationId(exported.source.workspaceEditionId ?? edition.editionId);
    need(receipt.manifest.exportId === exportId && receipt.manifest.exportSha256 === exported.exportSha256 &&
      exported.source.editionId === edition.editionId && exported.source.captureSha256 === edition.captureSha256,
      'The portable handover does not join its original native export and USGS source edition.', 'WATER_DSS_SOURCE_CHANGED', 409);
    const editionTarget = join(editions, editionId), exportTarget = join(root, exportId);
    const existingEdition = await lstat(editionTarget).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    const existingExport = await lstat(exportTarget).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existingEdition) {
      const previous = await readWaterEdition(editionTarget);
      need(previous.editionId === edition.editionId && previous.captureSha256 === edition.captureSha256,
        'This receiving workspace already has different work under the original edition name. Use an empty workspace.', 'WATER_DSS_RECEIVE_CONFLICT', 409);
    }
    if (existingExport) {
      const previous = await checkedManifest(exportTarget);
      need(previous.exportSha256 === exported.exportSha256,
        'This receiving workspace already has different work under the original export name. Use an empty workspace.', 'WATER_DSS_RECEIVE_CONFLICT', 409);
    }
    if (!existingEdition) await rename(join(unpacked, 'edition'), editionTarget);
    if (!existingExport) await rename(join(unpacked, 'export'), exportTarget);
    return { status: 'READY', exportId, workspaceEditionId: editionId, exportSha256: exported.exportSha256,
      source: exported.source, receivedMembers: receipt.members, reopened: Boolean(existingEdition && existingExport) };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export async function receiveDssUpload({ directory, editionsDirectory, stream, env = process.env, signal }) {
  const root = await privateDirectory(resolve(directory)), temporary = await privateDirectory(join(root, '.upload-' + randomUUID()));
  const path = join(temporary, 'handover.zip'), file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const abort = () => stream.destroy(new Error('The workspace closed during the handover upload.'));
  signal?.addEventListener('abort', abort, { once: true });
  try {
    let bytes = 0;
    for await (const chunk of stream) {
      bytes += chunk.length; need(bytes <= 8 * 1024 * 1024 * 1024, 'The uploaded handover exceeds the receiving format limit.');
      await file.writeFile(chunk);
    }
    await file.sync(); await file.close();
    return await receiveDssHandover({ directory: root, editionsDirectory, archive: path, env, signal });
  } finally {
    signal?.removeEventListener('abort', abort); await file.close().catch(() => {});
    await rm(temporary, { recursive: true, force: true });
  }
}
export async function dssHandoverDownload({ directory, exportId }) {
  const saved = await readDssExport({ directory, exportId }), receipt = await readOrNull(join(saved.directory, 'handover.receipt.json'));
  need(receipt && receipt.exportSha256 === saved.exportSha256, 'Prepare the complete handover before downloading it.', 'WATER_DSS_HANDOVER_REQUIRED', 409);
  const actual = await descriptor(saved.directory, 'handover.zip', 8 * 1024 * 1024 * 1024);
  need(actual.sha256 === receipt.sha256 && actual.bytes === receipt.bytes, 'The complete handover changed.', 'WATER_DSS_CHANGED', 409);
  return { path: join(saved.directory, 'handover.zip'), bytes: actual.bytes, sha256: actual.sha256, mime: 'application/zip', filename: exportId + '-HEC-DSS-handover.zip' };
}

export async function readDssOperation({ directory, exportId }) {
  const root = join(resolve(directory), dssOperationId(exportId));
  const manifest = await readOrNull(join(root, 'export.json'));
  if (manifest) return checkedManifest(root);
  const operation = await readPrivateJson(join(root, 'operation.json'));
  const plan = await readPrivateJson(join(root, 'plan.json'), MAX_FILE);
  const { planSha256, ...content } = plan;
  need(operation.exportId === exportId && planSha256 === sha(content) && operation.planSha256 === planSha256,
    'The original interrupted DSS operation changed.', 'WATER_DSS_CHANGED', 409);
  return { ...operation, status: operation.status === 'RUNNING' ? 'INTERRUPTED' : operation.status, plan };
}
