// MIT. One retained Opendatasoft project around the original publisher and merchant lifecycle.
import { dirname, join, resolve } from 'node:path';
import { initReleaseStore } from '../../sf82-seller-pilot/releases.mjs';
import { mkdir, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { object, bytes, digest, identity, readJson, createFile, atomicJson, privateDirectory,
  acquireWorkspace, fault, stamp } from '../postgres/publisher/files.mjs';
import { catalogOrigin, captureSelection, captureOpendatasoftDataset, ExactOpendatasoftNumber, readOpendatasoftCapture, requestOpendatasoft, searchOpendatasoft, describeOpendatasoftDataset, previewOpendatasoftRecords } from './capture.mjs';
import { compileQueries, readOpendatasoftSourceFile } from './declaration.mjs';
import { bindOpendatasoftCapture, projectOpendatasoftValue } from './source.mjs';
import { openOpendatasoftPublisher } from './publisher/model.mjs';
import { exportOpendatasoftMerchantPackage, stageOpendatasoftMerchantRelease, readOpendatasoftMerchantBuyerOffer,
  prepareOpendatasoftMerchantBuyer } from './publisher/release.mjs';

const ID = /^[a-f0-9-]{36}$/;
const id = value => { if (typeof value !== 'string' || !ID.test(value)) throw fault('ODS_ITEM_NOT_FOUND', 'Choose an existing project item.', 404); return value; };
const text = (value, label, max = 256) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fault('ODS_TEXT_REQUIRED', 'Enter ' + label + '.');
  return value.trim();
};
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
function captureSummary(capture) {
  const m = capture.manifest;
  return { manifestSha256: capture.manifestSha256, rowCount: m.rowCount, pageCount: m.pages.length,
    datasetId: m.datasetId, datasetUid: m.datasetUid, datasetTitle: m.datasetTitle,
    license: m.license, rights: m.rights, identityCandidates: m.identityCandidates, countMatched: m.countMatched, consistency: m.consistency, startedAt: m.startedAt, completedAt: m.completedAt };
}
// Presentation values cross a browser JSON parser; stringify structured values
// and exact numeric tokens here so the displayed source value cannot be rounded.
function sampleValue(value) {
  if (value instanceof ExactOpendatasoftNumber) return value.source;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}
const sampleRow = row => Object.fromEntries(Object.entries(row).map(([name, value]) => [name, sampleValue(value)]));
function columnSuggestions(capture) {
  const used = new Set();
  return capture.fields.map(field => {
    let alias = field.id === '_id' ? 'record_id' : field.id.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 42);
    if (!/^[A-Za-z]/.test(alias)) alias = 'field_' + alias;
    if (['constructor', 'prototype', '__proto__'].includes(alias)) alias = 'field_' + alias;
    const base = alias; let suffix = 1;
    while (used.has(alias)) {
      const ending = '_' + suffix++;
      alias = base.slice(0, 48 - ending.length) + ending;
    }
    used.add(alias);
    const values = capture.rows.map(row => row[field.id]), nonnull = values.filter(value => value !== null && value !== undefined);
    const missing = values.filter(value => value === undefined).length, nulls = values.filter(value => value === null).length;
    const kinds = [...new Set(nonnull.map(value => typeof value))], empty = values.filter(value => value === '').length;
    let type = kinds.length === 1 ? ({ string: 'string', boolean: 'boolean', number: 'number' }[kinds[0]] ?? 'string') : 'string';
    if (type === 'number' && nonnull.every(Number.isSafeInteger)) type = 'integer';
    let encoding = kinds.length > 1 || kinds.includes('object') || nulls && empty ? 'json' : 'native';
    if (!nonnull.length) { type = 'string'; encoding = 'json'; }
    if (encoding === 'json') type = 'string';
    return { field: field.id, alias, providerType: field.type ?? null, providerInfo: { label: field.label ?? field.id, description: field.description ?? null, annotations: field.annotations ?? {} },
      type, encoding, nullable: encoding === 'json' ? false : nulls > 0, nulls, empty, missing,
      sample: nonnull.slice(0, 3).map(sampleValue) };
  });
}

const checkedCount = (value, minimum, maximum, code) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw fault(code);
  return value;
};
function editionNote(value) {
  return structuredClone(value ?? { revision: 0, text: '', rowNotes: [], updatedAt: null });
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, character =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const csvCell = value => { const raw = String(value); return /[",\r\n]/.test(raw) ? '"' + raw.replaceAll('"','""') + '"' : raw; };
function geographicValue(value, providerType) {
  if (value === null || value === undefined) return null;
  if (providerType === 'geo_point_2d') {
    if (!object(value) || !Number.isFinite(value.lon) || !Number.isFinite(value.lat) ||
        value.lon < -180 || value.lon > 180 || value.lat < -90 || value.lat > 90) return null;
    return { type: 'Point', coordinates: [value.lon, value.lat] };
  }
  const candidate = value?.type === 'Feature' ? value.geometry : value;
  if (!object(candidate) || !['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon','GeometryCollection'].includes(candidate.type))
    return null;
  const numbers = coordinates => Array.isArray(coordinates) && coordinates.every(part =>
    Array.isArray(part) ? numbers(part) : typeof part === 'number' && Number.isFinite(part));
  if (candidate.type === 'GeometryCollection') {
    if (!Array.isArray(candidate.geometries) || candidate.geometries.some(item => !geographicValue(item,'geo_shape'))) return null;
  } else if (!numbers(candidate.coordinates)) return null;
  return candidate;
}
function editionExport(capture, notes, format, input = {}) {
  if (!object(input) || Object.keys(input).some(key => key !== 'geometryField')) throw fault('ODS_EXPORT_OPTIONS_INVALID');
  const source = { manifestSha256: capture.manifestSha256, manifest: capture.manifest, metadata: capture.metadata };
  const name = capture.manifest.datasetId.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,96) + '-' + capture.manifestSha256.slice(0,12);
  if (format === 'json') return { filename: name + '.json', contentType: 'application/json; charset=utf-8',
    content: bytes({ schema:'stellar-forge.opendatasoft-edition-export.v1', source, notes, records:capture.rows }) };
  const rowNotes = new Map(notes.rowNotes.map(note => [note.rowIndex,note.text]));
  if (format === 'csv') {
    const fields = capture.fields.map(field => field.id);
    const headers = [...fields]; let noteField = '_analyst_note', editionField = '_edition_note';
    while (headers.includes(noteField)) noteField = '_' + noteField;
    if (rowNotes.size) headers.push(noteField);
    while (headers.includes(editionField)) editionField = '_' + editionField;
    if (notes.text) headers.push(editionField);
    // Each original field is a JSON value inside its CSV cell, preserving null,
    // empty text, exact numeric tokens and nested data without guessed coercion.
    const lines = [headers.map(csvCell).join(',')];
    for (let index = 0; index < capture.rows.length; index++) {
      const row = capture.rows[index], cells = fields.map(field =>
        Object.hasOwn(row,field) ? JSON.stringify(row[field]) : '');
      if (rowNotes.size) cells.push(rowNotes.get(index) ?? '');
      if (notes.text) cells.push(notes.text);
      lines.push(cells.map(csvCell).join(','));
    }
    return { filename:name+'.csv',contentType:'text/csv; charset=utf-8',content:Buffer.from(lines.join('\r\n')+'\r\n') };
  }
  if (format === 'geojson') {
    const candidates = capture.fields.filter(field => ['geo_point_2d','geo_shape'].includes(field.type));
    const field = input.geometryField ? candidates.find(field => field.id === input.geometryField) :
      candidates.length === 1 ? candidates[0] : null;
    if (input.geometryField && !field) throw fault('ODS_GEOMETRY_FIELD_INVALID');
    if (!input.geometryField && candidates.length > 1) throw fault('ODS_GEOMETRY_SELECTION_REQUIRED', 'Choose the original geographic field for this export.');
    const key = capture.manifest.identityCandidates.find(candidate => candidate.missing === 0 && candidate.duplicates === 0)?.field;
    const warnings = [], features = capture.rows.map((row,rowIndex) => {
      const geometry = field ? geographicValue(row[field.id],field.type) : null;
      if (field && row[field.id] != null && !geometry) warnings.push({rowIndex,field:field.id,code:'GEOMETRY_VALUE_UNAVAILABLE'});
      const originalId = key ? row[key] : undefined;
      return {type:'Feature', ...(typeof originalId === 'string' || typeof originalId === 'number' && Number.isSafeInteger(originalId) ? {id:originalId} : {}),
        geometry, properties:row, sourceRowIndex:rowIndex, ...(rowNotes.has(rowIndex) ? {analystNote:rowNotes.get(rowIndex)} : {})};
    });
    return {filename:name+'.geojson',contentType:'application/geo+json; charset=utf-8',content:bytes({
      type:'FeatureCollection',source,notes,geometryField:field?.id??null,geometryCrs:'EPSG:4326',warnings,features})};
  }
  if (format === 'html') {
    const fields = capture.fields.map(field => field.id);
    const rows = capture.rows.map((row,index) => '<tr><th scope="row">'+index+'</th>'+
      fields.map(field => '<td>'+escapeHtml(Object.hasOwn(row,field) ? typeof row[field] === 'string' ? row[field] : JSON.stringify(row[field]) : '[absent]')+'</td>').join('')+
      '<td>'+escapeHtml(rowNotes.get(index)??'')+'</td></tr>').join('\n');
    const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<title>'+escapeHtml(capture.manifest.datasetTitle)+'</title><style>body{font:14px system-ui;margin:28px;color:#171717;background:#fff}h1{font-size:26px}p{max-width:100ch;white-space:pre-wrap}.table{overflow:auto}table{border-collapse:collapse;font-size:12px}th,td{border:1px solid #b8b8b8;padding:7px;vertical-align:top;text-align:left;min-width:120px}thead th{background:#ededed}th{font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:20px 0}</style>'+
      '<h1>'+escapeHtml(capture.manifest.datasetTitle)+'</h1><p>'+capture.rows.length+' retained records · '+escapeHtml(capture.manifest.datasetId)+
      '\nPublisher: '+escapeHtml(capture.manifest.rights.publisher??'')+'\nLicense: '+escapeHtml(capture.manifest.rights.license??'')+
      '\nAttribution: '+escapeHtml(JSON.stringify(capture.manifest.rights.attributions))+'</p><h2>Analyst notes</h2><p>'+
      escapeHtml(notes.text)+'</p><details><summary>Original source and field metadata</summary><pre>'+escapeHtml(JSON.stringify(source,null,2))+
      '</pre></details><div class="table"><table><thead><tr><th>Source row</th>'+fields.map(field=>'<th>'+escapeHtml(field)+'</th>').join('')+
      '<th>Analyst note</th></tr></thead><tbody>'+rows+'</tbody></table></div></html>';
    return {filename:name+'.html',contentType:'text/html; charset=utf-8',content:Buffer.from(html)};
  }
  throw fault('ODS_EXPORT_FORMAT_INVALID');
}

export async function openOpendatasoftWorkbench({ directory, create = false, origin, authTokenEnv, environment = process.env } = {}) {
  directory = resolve(directory);
  if (create && await exists(join(directory, 'workbench.json'))) throw fault('ODS_PROJECT_EXISTS');
  await privateDirectory(dirname(directory));
  await privateDirectory(directory, create);
  const release = await acquireWorkspace(directory);
  let state, active = null, closed = false;
  const persist = () => atomicJson(directory, 'workbench.json', state);
  try {
    if (create) {
      const checked = captureSelection({ catalogOrigin: origin, datasetId: 'initial', authTokenEnv });
      state = { schema: 'stellar-forge.opendatasoft-workbench.v1', catalogOrigin: checked.catalogOrigin,
        ...(authTokenEnv ? { authTokenEnv } : {}), createdAt: stamp(), updatedAt: stamp(),
        editions: [], sources: [], publications: [], exports: [], buyerRequests: [], operation: null };
      for (const name of ['editions', 'sources', 'publications', 'datasets', 'merchant-packages', 'buyer-requests'])
        await privateDirectory(join(directory, name), true);
      await createFile(join(directory, 'workbench.json'), bytes(state));
    } else state = await readJson(join(directory, 'workbench.json'), 16777216);
    if (state.schema !== 'stellar-forge.opendatasoft-workbench.v1' || !Array.isArray(state.editions) ||
        !Array.isArray(state.sources) || !Array.isArray(state.publications) || !Array.isArray(state.exports))
      throw fault('ODS_PROJECT_INVALID');
    catalogOrigin(state.catalogOrigin);
    if (origin && catalogOrigin(origin) !== state.catalogOrigin || authTokenEnv && authTokenEnv !== state.authTokenEnv)
      throw fault('ODS_PROJECT_BINDING_CHANGED');
    if (state.operation?.state === 'RUNNING') {
      state.operation.state = 'INTERRUPTED'; state.operation.error = 'PROCESS_INTERRUPTED';
      for (const edition of state.editions) if (edition.state === 'CAPTURING') edition.state = 'INTERRUPTED';
      await persist();
    }
    const find = (collection, value) => {
      id(value); const item = state[collection].find(item => item.id === value);
      if (!item) throw fault('ODS_ITEM_NOT_FOUND', 'Choose an existing project item.', 404);
      return item;
    };
    const captureFile = value => join(directory, 'editions', id(value), 'capture.json');
    const selectedCapture = value => { const entry = find('editions', value); return readOpendatasoftCapture(captureFile(value), entry.manifestSha256); };
    function launch(kind, action) {
      if (closed) throw fault('ODS_PROJECT_CLOSED');
      if (active) throw fault('ODS_PROJECT_BUSY', 'Wait for the current project operation to finish.', 409);
      const operation = { id: randomUUID(), kind, state: 'RUNNING', startedAt: stamp(), progress: null, result: null, error: null };
      state.operation = operation;
      const controller = new AbortController();
      const running = { operation, controller, completion: null };
      active = running;
      running.completion = (async () => {
        try {
          await persist();
          operation.result = await action(controller.signal, progress => { operation.progress = progress; });
          operation.state = 'COMPLETE';
        } catch (error) {
          operation.state = controller.signal.aborted ? 'CANCELLED' : 'FAILED';
          operation.error = { code: error.code ?? 'ODS_OPERATION_FAILED',
            message: error.code ? error.message : 'The operation did not complete. Read the retained item before continuing.' };
        } finally {
          operation.completedAt = stamp(); state.updatedAt = stamp();
          try { await persist(); } finally { if (active === running) active = null; }
        }
        return structuredClone(operation);
      })();
      running.completion.catch(() => {});
      return { id: operation.id, completion: running.completion };
    }
    async function withPublisher(value, action, options = {}) {
      const entry = find('publications', value);
      const publisher = await openOpendatasoftPublisher({ directory: join(directory, 'publications', value), ...options });
      try { return await action(publisher, entry); } finally { await publisher.close(); }
    }
    async function edition(value) {
      const entry = find('editions', value);
      if (entry.state !== 'COMPLETE') {
        const progress = await readJson(join(directory, 'editions', value, 'progress.json'), 16777216).catch(() => null);
        return { ...entry, progress };
      }
      const capture = await selectedCapture(value);
      return { ...entry, fields: capture.fields, suggestions: columnSuggestions(capture),
        sample: capture.rows.slice(0, 20).map(sampleRow), source: capture.manifest,
        notes: structuredClone(entry.notes ?? { revision: 0, text: '', rowNotes: [], updatedAt: null }) };
    }
    async function capture(entry, signal, progress) {
      entry.state = 'CAPTURING'; entry.error = null; await persist();
      try {
        const current = await captureOpendatasoftDataset(entry.selection, join(directory, 'editions', entry.id),
          { ...entry.limits, env: environment, signal, onProgress: progress });
        Object.assign(entry, captureSummary(current), { state: 'COMPLETE' }); await persist(); return structuredClone(entry);
      } catch (error) {
        entry.state = signal.aborted ? 'INTERRUPTED' : 'FAILED'; entry.error = error.code ?? 'ODS_CAPTURE_INTERRUPTED';
        await persist(); throw error;
      }
    }
    const api = {
      directory,
      status: () => structuredClone({ ...state, directory, active: active ? active.operation.id : null }),
      async search(input = {}) {
        const received = await searchOpendatasoft(state.catalogOrigin, input, { authTokenEnv: state.authTokenEnv, env: environment });
        return { page: received.page, receipt: received.receipt, datasets: received.datasets };
      },
      async dataset(datasetId) {
        const received = await requestOpendatasoft(state.catalogOrigin, 'dataset', datasetId, {},
          { authTokenEnv: state.authTokenEnv, env: environment });
        return { dataset: received.value, summary: describeOpendatasoftDataset(received.value), receipt: received.receipt };
      },
      async previewRecords(datasetId, input = {}) {
        const received = await previewOpendatasoftRecords(state.catalogOrigin, datasetId, input,
          { authTokenEnv: state.authTokenEnv, env: environment });
        return { records: received.records.map(sampleRow), totalCount: received.totalCount, page: received.page, receipt: received.receipt };
      },
      startCapture(input) {
        const selection = captureSelection({ ...input, catalogOrigin: state.catalogOrigin, authTokenEnv: state.authTokenEnv });
        const entry = { id: randomUUID(), state: 'CAPTURING', selection, limits: {
          maxRows: input.maxRows ?? 250000, maxBytes: input.maxBytes ?? 268435456 }, createdAt: stamp() };
        const started = launch('capture edition', (signal, progress) => { state.editions.push(entry); return capture(entry, signal, progress); });
        return { ...started, editionId: entry.id };
      },
      resumeCapture(value, limits = {}) {
        const entry = find('editions', value);
        if (entry.state === 'COMPLETE') throw fault('ODS_EDITION_ALREADY_COMPLETE', 'This retained edition is complete; start a new capture to refresh it.');
        return launch('resume edition', (signal, progress) => { entry.limits = { ...entry.limits, ...limits }; return capture(entry, signal, progress); });
      },
      importCapture(filename) {
        return launch('receive retained edition', async () => {
          const original = await readOpendatasoftCapture(resolve(filename));
          if (original.manifest.catalogOrigin !== state.catalogOrigin) throw fault('ODS_CATALOGUE_MISMATCH');
          const prior = state.editions.find(item => item.manifestSha256 === original.manifestSha256);
          if (prior) return structuredClone(prior);
          const value = randomUUID(), target = join(directory, 'editions', value);
          await privateDirectory(target, true);
          for (const [file, raw] of original.rawFiles) await createFile(join(target, file), raw);
          await createFile(join(target, 'capture.json'), original.manifestBytes);
          const entry = { id: value, state: 'COMPLETE', selection: original.manifest.selection,
            limits: { maxRows: 250000, maxBytes: 268435456 }, createdAt: stamp(), ...captureSummary(original) };
          state.editions.push(entry); await persist(); return structuredClone(entry);
        });
      },
      edition,

      async editionRows(value, input = {}) {
        if (!object(input) || Object.keys(input).some(key => !['offset','limit'].includes(key))) throw fault('ODS_EDITION_PAGE_INVALID');
        const capture = await selectedCapture(value);
        const offset = checkedCount(input.offset??0,0,capture.rows.length,'ODS_EDITION_OFFSET_INVALID');
        const limit = checkedCount(input.limit??100,1,1000,'ODS_EDITION_PAGE_INVALID');
        const records = capture.rows.slice(offset,offset+limit).map(sampleRow);
        return {records,page:{offset,limit,returned:records.length,total:capture.rows.length,
          next:offset+records.length<capture.rows.length ? offset+records.length : null}};
      },
      async editionFacets(value, input = {}) {
        if (!object(input) || Object.keys(input).some(key => !['field','limit','mode'].includes(key))) throw fault('ODS_EDITION_FACET_INVALID');
        const capture = await selectedCapture(value);
        if (!capture.fields.some(field => field.id === input.field)) throw fault('ODS_SOURCE_FIELD_INVALID');
        const limit = checkedCount(input.limit??50,1,1000,'ODS_FACET_LIMIT_INVALID'), mode=input.mode??'value';
        if (!['value','members'].includes(mode)) throw fault('ODS_FACET_MODE_INVALID');
        const values = new Map(); let missing=0,nulls=0;
        for (const row of capture.rows) {
          if (!Object.hasOwn(row,input.field)) {missing++;continue;}
          const original=row[input.field]; if (original===null) nulls++;
          const items=mode==='members' && Array.isArray(original) ? original : [original], seen=new Set();
          for (const item of items) {
            const key=identity(item); if (seen.has(key)) continue; seen.add(key);
            const entry=values.get(key);
            if (entry) entry.count++; else values.set(key,{value:sampleValue(item),count:1});
          }
        }
        const ordered=[...values.values()].sort((a,b)=>b.count-a.count || String(a.value).localeCompare(String(b.value)));
        return {field:input.field,mode,totalRows:capture.rows.length,distinct:values.size,missing,nulls,
          values:ordered.slice(0,limit),shown:Math.min(limit,values.size),complete:values.size<=limit};
      },
      saveEditionNotes(value,input={}) {
        return launch('save edition notes',async()=>{
          if (!object(input) || Object.keys(input).some(key => !['expectedCaptureSha256','expectedRevision','text','rowNotes'].includes(key)))
            throw fault('ODS_EDITION_NOTES_INVALID');
          const entry=find('editions',value),capture=await selectedCapture(value), prior=editionNote(entry.notes);
          if (input.expectedCaptureSha256!==capture.manifestSha256) throw fault('ODS_REVIEWED_EDITION_CHANGED');
          checkedCount(input.expectedRevision,0,Number.MAX_SAFE_INTEGER-1,'ODS_NOTES_REVISION_REQUIRED');
          if (typeof input.text!=='string' || input.text.length>262144 || !Array.isArray(input.rowNotes) || input.rowNotes.length>10000)
            throw fault('ODS_EDITION_NOTES_INVALID');
          const seen=new Set(),rowNotes=input.rowNotes.map(note=>{
            if (!object(note) || Object.keys(note).some(key=>!['rowIndex','text'].includes(key)) ||
                typeof note.text!=='string' || note.text.length>16384) throw fault('ODS_ROW_NOTE_INVALID');
            checkedCount(note.rowIndex,0,capture.rows.length-1,'ODS_NOTE_ROW_NOT_FOUND');
            if (seen.has(note.rowIndex)) throw fault('ODS_DUPLICATE_ROW_NOTE');
            seen.add(note.rowIndex);return {rowIndex:note.rowIndex,text:note.text};
          }).sort((a,b)=>a.rowIndex-b.rowIndex);
          if (Buffer.byteLength(JSON.stringify(rowNotes))>2097152) throw fault('ODS_EDITION_NOTES_TOO_LARGE');
          const contentHash=identity({text:input.text,rowNotes});
          if (prior.revision!==input.expectedRevision) {
            if (prior.revision===input.expectedRevision+1 && prior.contentHash===contentHash) return prior;
            throw fault('ODS_NOTES_REVISION_CHANGED','Reload the saved notes before editing this edition.',409);
          }
          entry.notes={revision:prior.revision+1,text:input.text,rowNotes,contentHash,updatedAt:stamp()};
          await persist();return editionNote(entry.notes);
        });
      },
      async exportEdition(value,format,input={}) {
        const entry=find('editions',value),capture=await selectedCapture(value);
        return editionExport(capture,editionNote(entry.notes),format,input);
      },
      async compare(beforeId, afterId, key = 'url') {
        const before = await selectedCapture(beforeId), after = await selectedCapture(afterId);
        if (before.manifest.catalogOrigin !== after.manifest.catalogOrigin || before.manifest.datasetUid !== after.manifest.datasetUid)
          throw fault('ODS_COMPARE_RESOURCE_MISMATCH');
        const index = rows => {
          const map = new Map();
          for (const row of rows) {
            if (!Object.hasOwn(row, key) || row[key] === null) throw fault('ODS_COMPARE_KEY_MISSING');
            const value = JSON.stringify(row[key]);
            if (map.has(value)) throw fault('ODS_COMPARE_KEY_NOT_UNIQUE');
            map.set(value, row);
          }
          return map;
        };
        const left = index(before.rows), right = index(after.rows), changes = [];
        let added = 0, removed = 0, changed = 0, unchanged = 0;
        for (const [value, row] of left) {
          if (!right.has(value)) { removed++; changes.push({ key: row[key], kind: 'removed', before: row }); }
          else if (identity(row) !== identity(right.get(value))) { changed++; changes.push({ key: row[key], kind: 'changed', before: row, after: right.get(value) }); }
          else unchanged++;
        }
        for (const [value, row] of right) if (!left.has(value)) { added++; changes.push({ key: row[key], kind: 'added', after: row }); }
        return { before: captureSummary(before), after: captureSummary(after), key, added, removed, changed, unchanged,
          fieldsChanged: identity(before.fields) !== identity(after.fields), changes: changes.map(change => ({ ...change, ...(change.before ? { before: sampleRow(change.before) } : {}), ...(change.after ? { after: sampleRow(change.after) } : {}) })), shown: changes.length };
      },
      saveSource(editionId, input) {
        return launch('save field selection', async () => {
          const capture = await selectedCapture(editionId);
          if (input.expectedCaptureSha256 !== capture.manifestSha256) throw fault('ODS_REVIEWED_EDITION_CHANGED');
          const query = input.query ?? 'dataset', queries = compileQueries({ [query]: { projection: input.projection } });
          const config = { schema: 'stellar-forge.opendatasoft-source.v1', catalogOrigin: state.catalogOrigin,
            datasetId: capture.manifest.datasetId, datasetUid: capture.manifest.datasetUid,
            connection: { kind: 'capture', file: captureFile(editionId), sha256: capture.manifestSha256 },
            queries: { [query]: { projection: input.projection } } };
          bindOpendatasoftCapture(capture, config, queries[query]);
          const preview = capture.rows.slice(0, 20).map(row => Object.fromEntries(Object.entries(queries[query].projection)
            .map(([alias, spec]) => [alias, projectOpendatasoftValue(row[spec.field], spec)])));
          const value = randomUUID(), file = join(directory, 'sources', value + '.json'), raw = bytes(config);
          await createFile(file, raw);
          const entry = { id: value, title: text(input.title ?? capture.manifest.datasetTitle, 'a data product title', 128),
            editionId, query, file, sha256: digest(raw), createdAt: stamp(), projection: queries[query].projection };
          state.sources.push(entry); await persist(); return { ...entry, preview };
        });
      },
      createPublication(sourceId, input = {}) {
        return launch('prepare dataset candidate', async (signal, progress) => {
          const source = find('sources', sourceId), selected = await readOpendatasoftSourceFile(source.file), query = selected.queries[source.query];
          const value = randomUUID(), targetDirectory = join(directory, 'datasets', value);
          const publisher = await openOpendatasoftPublisher({ directory: join(directory, 'publications', value), create: true,
            sourceFile: source.file, targetDirectory });
          const entry = { id: value, sourceId, title: source.title, targetDirectory, createdAt: stamp(), state: 'PREPARING' };
          state.publications.push(entry); await persist();
          try {
            const plan = await publisher.savePlan({ title: source.title, query: source.query, input: {}, sourceHash: selected.hash,
              dataset: { name: source.title, columns: Object.fromEntries(Object.entries(query.projection)
                .map(([name, spec]) => [name, { type: spec.type, nullable: spec.nullable }])),
                filters: input.filters ?? [], ranges: input.ranges ?? [], sorts: input.sorts ?? [],
                defaultLimit: input.defaultLimit ?? 50, maxLimit: input.maxLimit ?? 250 },
              extraction: { order: input.order ?? [{ column: query.columns[0], direction: 'asc' }],
                maxRows: input.maxRows ?? 250000, maxBytes: input.maxBytes ?? 67108864,
                maxRowBytes: 1048576, timeoutMs: input.timeoutMs ?? 120000 } });
            entry.planId = plan.id;
            const started = publisher.startExtraction(plan.id); entry.runId = started.id; await persist();
            const cancel = () => { try { publisher.cancel(started.id); } catch {} };
            signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
            let run;
            try { run = await started.completion; } finally { signal.removeEventListener('abort', cancel); }
            entry.state = run.state; entry.run = run; progress({ state: run.state });
            await persist();
            if (run.state !== 'READY') throw fault(run.data.error ?? 'ODS_CANDIDATE_FAILED');
            return structuredClone(entry);
          } finally { await publisher.close(); }
        });
      },
      async publication(value, query = '') {
        return withPublisher(value, async (publisher, entry) => ({ ...entry,
          run: publisher.run(entry.runId), detail: await publisher.inspect(entry.runId, query || undefined) }));
      },
      reviewPublication(value, input) {
        return launch('review dataset candidate', () => withPublisher(value, async (publisher, entry) => {
          const current = await publisher.candidate(entry.runId);
          if (current.manifest.candidateDigest !== input.expectedCandidateDigest) throw fault('ODS_CANDIDATE_REVIEW_CHANGED');
          const run = await publisher.review(entry.runId, { reviewer: input.reviewer, note: input.note, initialize: true });
          entry.run = run; entry.state = run.state; await persist(); return structuredClone(entry);
        }));
      },
      recoverPublication(value) {
        return launch('recover retained publication', () => withPublisher(value, async (publisher, entry) => {
          const run = await publisher.recover(entry.runId);
          entry.run = run; entry.state = run.state; await persist(); return structuredClone(entry);
        }));
      },
      publishDataset(value, reviewId) {
        return launch('publish dataset version', () => withPublisher(value, async (publisher, entry) => {
          const current = publisher.run(entry.runId);
          const run = current.state === 'PUBLISHED' ? current : await publisher.publish(entry.runId, reviewId);
          entry.run = run; entry.state = run.state; await persist();
          if (run.state !== 'PUBLISHED') throw fault(run.data.error ?? 'ODS_PUBLICATION_INCOMPLETE');
          return structuredClone(entry);
        }));
      },
      exportMerchant(value, input) {
        return launch('export merchant package', () => withPublisher(value, async (publisher, entry) => {
          const datasetId = randomUUID(), output = join(directory, 'merchant-packages', datasetId);
          const result = await exportOpendatasoftMerchantPackage({ publisher, runId: entry.runId, directory: output,
            expectedCandidateDigest: input.expectedCandidateDigest, payment: input.payment, origin: input.origin, path: input.path ?? '/data' });
          const exported = { id: datasetId, publicationId: value, createdAt: stamp(), ...result };
          state.exports.push(exported); await persist(); return structuredClone(exported);
        }));
      },
      stageMerchant(value, input) {
        return launch('stage seller release', async () => {
          const entry = find('exports', value), root = join(directory, 'seller-releases');
          if (!await exists(root)) await initReleaseStore(root);
          const result = await stageOpendatasoftMerchantRelease(root, { packageDirectory: entry.directory,
            expectedManifestSha256: input.expectedManifestSha256, id: input.releaseId,
            label: input.label, runtime: input.runtime });
          entry.staged = { root, ...result }; await persist(); return structuredClone(entry);
        });
      },
      async buyerOffer(value, input) {
        const entry = find('exports', value);
        return readOpendatasoftMerchantBuyerOffer({ packageDirectory: entry.directory,
          expectedManifestSha256: entry.manifestSha256, seller: input.seller, query: input.query ?? '' });
      },
      prepareBuyer(value, input) {
        return launch('prepare buyer request', async () => {
          const entry = find('exports', value), requestId = randomUUID(), out = join(directory, 'buyer-requests', requestId + '.json');
          const result = await prepareOpendatasoftMerchantBuyer({ packageDirectory: entry.directory,
            expectedManifestSha256: entry.manifestSha256, seller: input.seller, query: input.query ?? '',
            intentId: input.intentId, acceptIndex: input.acceptIndex, offerSha256: input.offerSha256, out });
          const saved = { id: requestId, exportId: value, createdAt: stamp(), out, ...result };
          state.buyerRequests.push(saved); await persist(); return structuredClone(saved);
        });
      },
      cancel() { if (!active) throw fault('ODS_NO_ACTIVE_OPERATION'); active.controller.abort(); return { cancelling: active.operation.id }; },
      async close() {
        if (closed) return; closed = true; active?.controller.abort();
        try { await active?.completion; } finally { await release(); }
      },
    };
    return api;
  } catch (error) { await release(); throw error; }
}


