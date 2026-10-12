// MIT. Exact legacy selection and the original SF88 receiving application.
import {lstat} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {AcquisitionWorkspace} from '../../sf88-operator-buyer-cli/node/acquisitions.mjs';
import {canonical, sha256} from './provider.mjs';
import {decodeLegacyCapture} from './mapping.mjs';

export const LEGACY_SOURCE_SCHEMA = 'starforge.blockworks-legacy-source/v1';
export const LEGACY_PROJECTION_SCHEMA = 'blockworks-legacy-projection/v1';
const HASH = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, name) => Object.hasOwn(value, name);
const text = value => typeof value === 'string' && value.trim().length > 0;
const date = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
const scalar = value => value === null || ['string','boolean'].includes(typeof value) ||
  typeof value === 'number' && Number.isFinite(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
function need(value, code, message = code) {
  if (!value) throw Object.assign(new Error(message), {code});
}
function jsonCopy(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    need(!['undefined','function','symbol','bigint'].includes(typeof item) &&
      (typeof item !== 'number' || Number.isFinite(item)), 'LEGACY_JSON_VALUES_REQUIRED');
    return item;
  }));
}
function fields(value, allowed, code) {
  need(object(value) && Object.keys(value).every(name => allowed.includes(name)), code);
}
function issue(code, message, details = {}) {return {code,message,...details};}

/** RFC6901 document pointers; absence remains distinct from a present null. */
export function readLegacyPointer(value, pointer) {
  need(typeof pointer === 'string' && (pointer === '' || pointer.startsWith('/')) &&
    !/~(?![01])/u.test(pointer), 'LEGACY_JSON_POINTER_INVALID');
  if (pointer === '') return {present:true,value};
  for (const encoded of pointer.slice(1).split('/')) {
    const key = encoded.replace(/~1/g,'/').replace(/~0/g,'~');
    if (Array.isArray(value)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(key)) return {present:false};
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index >= value.length || !own(value,index)) return {present:false};
      value = value[index];
    } else if (object(value) && own(value,key)) value = value[key];
    else return {present:false};
  }
  return {present:true,value};
}
function pick(document, pointer, code) {
  const selected = readLegacyPointer(document,pointer);
  need(selected.present,code);
  return selected.value;
}
function reviewedSelection(input) {
  fields(input, ['schemaVersion','format','kind','rowsPointer','pointsPointer','pointSchemaPointer',
    'descriptorKey','seriesPointer','seriesKey','seriesKeyPointer','entityPointer','entity',
    'metadataPointer','totalRowsPointer','totalPagesPointer','csv',
    'wholeExport','by','at','reference','note'], 'LEGACY_SELECTION_FIELDS_INVALID');
  const selected = jsonCopy(input);
  need(selected.schemaVersion === LEGACY_PROJECTION_SCHEMA, 'LEGACY_PROJECTION_SCHEMA_REQUIRED');
  need(['json','csv'].includes(selected.format), 'LEGACY_FORMAT_REQUIRED');
  need(['tabular','timeseries'].includes(selected.kind), 'LEGACY_FAMILY_REQUIRED');
  for (const name of ['rowsPointer','pointsPointer','pointSchemaPointer','seriesPointer',
    'seriesKeyPointer','entityPointer','metadataPointer','totalRowsPointer','totalPagesPointer'])
    if (own(selected,name)) readLegacyPointer(null,selected[name]);
  need(!(own(selected,'entityPointer') && own(selected,'entity')), 'LEGACY_ENTITY_SELECTION_CONFLICT');
  if (selected.format === 'csv') {
    need(selected.kind === 'tabular' && (!own(selected,'rowsPointer') || selected.rowsPointer === ''),
      'LEGACY_CSV_ROWS_REQUIRED', 'CSV retains its original row objects. Select time and measures from those rows in the mapping.');
    fields(selected.csv, ['delimiter','header','columns'], 'LEGACY_CSV_FIELDS_INVALID');
    need(typeof selected.csv.header === 'boolean' && typeof selected.csv.delimiter === 'string' &&
      selected.csv.delimiter.length === 1 && !/["\r\n]/.test(selected.csv.delimiter),
      'LEGACY_CSV_DIALECT_REQUIRED');
    if (selected.csv.header) need(!own(selected.csv,'columns'), 'LEGACY_CSV_HEADER_COLUMNS_CONFLICT');
    else need(Array.isArray(selected.csv.columns) && selected.csv.columns.length > 0 &&
      selected.csv.columns.every(text) && new Set(selected.csv.columns).size === selected.csv.columns.length,
      'LEGACY_CSV_COLUMNS_REQUIRED');
  } else {
    need(!own(selected,'csv'), 'LEGACY_CSV_OPTIONS_FOR_JSON');
    if (selected.kind === 'tabular') need(own(selected,'rowsPointer'), 'LEGACY_ROWS_POINTER_REQUIRED');
  }
  if (selected.kind === 'tabular') {
    need(!['pointsPointer','pointSchemaPointer','seriesPointer','seriesKey','seriesKeyPointer','descriptorKey']
      .some(name => own(selected,name)), 'LEGACY_TABULAR_SERIES_SELECTION');
  } else {
    need(!own(selected,'rowsPointer') && own(selected,'pointsPointer') &&
      own(selected,'pointSchemaPointer') && ['slug','field'].includes(selected.descriptorKey),
      'LEGACY_POINT_SELECTION_REQUIRED');
    if (own(selected,'seriesPointer')) {
      need(own(selected,'seriesKeyPointer') && !own(selected,'seriesKey'), 'LEGACY_PER_SERIES_KEY_REQUIRED');
    } else need(own(selected,'seriesKey') && scalar(selected.seriesKey) &&
      !own(selected,'seriesKeyPointer'), 'LEGACY_SINGLE_SERIES_KEY_REQUIRED');
  }
  need(!own(selected,'wholeExport') || typeof selected.wholeExport === 'boolean',
    'LEGACY_EXPORT_DECLARATION_INVALID');
  let declaration = null;
  if (selected.wholeExport === true) {
    need(text(selected.by) && date(selected.at) && text(selected.reference) && text(selected.note),
      'LEGACY_COMPLETE_EXPORT_DECLARATION_REQUIRED');
    declaration = {kind:'declared-export',declaredBy:selected.by,declaredAt:selected.at,
      reference:selected.reference,note:selected.note};
  } else need(!['by','at','reference','note'].some(name => own(selected,name)),
    'LEGACY_EXPORT_DECLARATION_WITHOUT_COMPLETE_SELECTION');
  const projection = Object.fromEntries(Object.entries(selected)
    .filter(([name]) => !['wholeExport','by','at','reference','note'].includes(name)));
  return {projection,declaration};
}
function project(document, projection) {
  let rows = [], series = [], pointSchema = null;
  if (projection.kind === 'tabular') {
    rows = projection.format === 'csv' ? document : pick(document,projection.rowsPointer,'LEGACY_ROWS_ABSENT');
    need(Array.isArray(rows) && rows.every(object), 'LEGACY_ROWS_MUST_BE_OBJECTS');
  } else {
    // The point schema always belongs to the original document root.
    pointSchema = pick(document,projection.pointSchemaPointer,'LEGACY_POINT_SCHEMA_ABSENT');
    need(Array.isArray(pointSchema) && pointSchema.length > 0 &&
      pointSchema.every(item => object(item) && text(item[projection.descriptorKey])) &&
      new Set(pointSchema.map(item => item[projection.descriptorKey])).size === pointSchema.length,
      'LEGACY_POINT_DESCRIPTORS_INVALID');
    const origins = own(projection,'seriesPointer') ?
      pick(document,projection.seriesPointer,'LEGACY_SERIES_ABSENT') : [document];
    need(Array.isArray(origins), 'LEGACY_SERIES_MUST_BE_ARRAY');
    const keys = new Set();
    series = origins.map(entry => {
      const key = own(projection,'seriesPointer') ?
        pick(entry,projection.seriesKeyPointer,'LEGACY_SERIES_KEY_ABSENT') : projection.seriesKey;
      need(scalar(key), 'LEGACY_SERIES_KEY_MUST_BE_SCALAR');
      const identity = canonical(key);
      need(!keys.has(identity), 'LEGACY_DUPLICATE_SERIES_KEY'); keys.add(identity);
      const points = pick(entry,projection.pointsPointer,'LEGACY_POINTS_ABSENT');
      need(Array.isArray(points) && points.every(point => Array.isArray(point) &&
        point.length === pointSchema.length), 'LEGACY_POINT_WIDTH_MISMATCH');
      const entity = own(projection,'entityPointer') ? readLegacyPointer(entry,projection.entityPointer) :
        own(projection,'entity') ? {present:true,value:projection.entity} : {present:false};
      return {key,points,...(entity.present ? {entity:entity.value} : {})};
    });
  }
  const metadata = own(projection,'metadataPointer') ?
    readLegacyPointer(document,projection.metadataPointer) : {present:false};
  const totals = {};
  for (const [name,pointer] of [['totalRows','totalRowsPointer'],['totalPages','totalPagesPointer']])
    if (own(projection,pointer)) totals[name] = pick(document,projection[pointer],'LEGACY_' + name.toUpperCase() + '_ABSENT');
  return {kind:projection.kind,rows,series,pointSchema,
    ...(metadata.present ? {metadata:metadata.value} : {}),
    rowCount:projection.kind === 'tabular' ? rows.length : series.reduce((sum,entry)=>sum+entry.points.length,0),
    totals};
}
function sourceCoverage(value, metadata, declaration, accepted, problems) {
  const paging = metadata.paging === undefined ? {} : jsonCopy(metadata.paging);
  fields(paging, ['page','firstPage','totalRows','totalPages','pageSize'], 'LEGACY_PAGING_FIELDS_INVALID');
  const totals = {...paging};
  for (const [name,total] of Object.entries(value.totals)) {
    need(!own(totals,name) || canonical(totals[name]) === canonical(total), 'LEGACY_PAGING_TOTAL_CONFLICT');
    totals[name] = total;
  }
  let coherent = true;
  for (const name of ['totalRows','totalPages']) if (own(totals,name) && !count(totals[name])) {
    coherent = false;
    problems.push(issue('legacy_total_not_integer','The declared native total must remain an integer count.',{field:name,value:totals[name]}));
  }
  if (own(totals,'page') && !count(totals.page)) {
    coherent = false; problems.push(issue('legacy_page_invalid','Retain the original integer page.'));
  }
  if (own(totals,'firstPage') && ![0,1].includes(totals.firstPage)) {
    coherent = false; problems.push(issue('legacy_first_page_invalid','Declare whether the original page index starts at zero or one.'));
  }
  if (own(totals,'totalRows') && count(totals.totalRows) && totals.totalRows !== value.rowCount) {
    coherent = false;
    problems.push(issue('legacy_population_partial','The retained rows do not equal the declared original total.',
      {receivedRows:value.rowCount,totalRows:totals.totalRows}));
  }
  if (totals.totalPages === 0 && value.rowCount > 0) {
    coherent = false; problems.push(issue('legacy_page_total_conflict','A nonempty population cannot have zero native pages.'));
  }
  const onePage = !own(totals,'totalPages') || count(totals.totalPages) && totals.totalPages <= 1;
  const firstPage = !own(totals,'page') || totals.page === (totals.firstPage ?? 1);
  const nativeComplete = own(totals,'totalRows') && coherent && onePage && firstPage;
  if (!declaration && !nativeComplete)
    problems.push(issue('legacy_coverage_unresolved','Retain complete native totals or the reviewed whole-export declaration; this capture remains available.'));
  const complete = accepted && coherent && Boolean(declaration || nativeComplete) && problems.length === 0;
  return {...(declaration ?? {kind:'native-response'}),complete,receivedRows:value.rowCount,
    ...totals,...(metadata.paging === undefined && Object.keys(value.totals).length === 0 ? {totalsKnown:false} : {})};
}

/**
 * A pure view of one complete retained response. This method performs no I/O.
 * Unknown HTTP status stays null. Byte identity and selection are deterministic.
 */
export async function legacyCaptureSource({body,metadata={},selection} = {}) {
  need(Buffer.isBuffer(body), 'LEGACY_ORIGINAL_BUFFER_REQUIRED');
  need(object(metadata), 'LEGACY_CAPTURE_METADATA_REQUIRED');
  const bytes = Buffer.from(body), digest = sha256(bytes), original = jsonCopy(metadata);
  if (own(original,'sha256')) need(HASH.test(original.sha256) && original.sha256 === digest, 'LEGACY_SOURCE_DIGEST_MISMATCH');
  if (own(original,'bytes')) need(original.bytes === bytes.length, 'LEGACY_SOURCE_SIZE_MISMATCH');
  const {projection,declaration} = reviewedSelection(selection);
  const status = own(original,'status') ? original.status : null;
  need(status === null || Number.isInteger(status) && status >= 100 && status <= 599, 'LEGACY_HTTP_STATUS_INVALID');
  if (own(original,'accepted')) need(typeof original.accepted === 'boolean', 'LEGACY_ACCEPTANCE_INVALID');
  const problems = [];
  const provenance = original.provenance ? jsonCopy(original.provenance) : {};
  if (status === null) {
    provenance.kind ??= 'file';
    provenance.name ??= original.name ?? original.filename;
    provenance.importedAt ??= original.importedAt;
    need(provenance.kind === 'file' && text(provenance.name) && date(provenance.importedAt),
      'LEGACY_FILE_PROVENANCE_REQUIRED', 'Retain the actual file name and original importedAt on first intake and reuse them on reopen.');
  } else {
    if (!object(original.request) || !text(original.request.method) || !text(original.request.url) || !date(original.capturedAt))
      problems.push(issue('legacy_http_provenance_incomplete','The actual HTTP response needs its original method, URL and capture time.'));
  }
  const accepted = original.accepted !== false && (status === null || status >= 200 && status < 300);
  let value = {kind:projection.kind,rows:[],series:[],pointSchema:null,rowCount:0,totals:{}};
  if (accepted) {
    // The mapper owns the exact JSON/CSV decoder used for its source readback.
    const document = decodeLegacyCapture(bytes,{format:projection.format,csv:projection.csv});
    value = project(document,projection);
  } else problems.push(issue(status === 401 || status === 403 ? 'legacy_access_required' : 'legacy_response_rejected',
    'The complete unsuccessful response is retained and does not become successful source rows.',{status}));
  const coverage = sourceCoverage(value,original,declaration,accepted,problems);
  const request = {format:projection.format,projection,paged:false,
    ...(original.request === undefined ? {} : {native:original.request})};
  const requestHash = sha256(canonical(request));
  const identity = {sha256:digest,requestHash,status,
    request:original.request ?? null,capturedAt:original.capturedAt ?? null,
    provenance:status === null ? provenance : original.provenance ?? null,
    native:original.native ?? null};
  const captureId = text(original.id) ? original.id : 'legacy-capture-' + sha256(canonical(identity)).slice(0,32);
  const capture = {...original,id:captureId,sha256:digest,bytes:bytes.length,status,accepted,
    ...(status === null ? {provenance} : {}),
    assessment:{accepted,complete:coverage.complete,problems}};
  const id = 'legacy-source-' + sha256(canonical({identity,projection,coverage})).slice(0,32);
  const {totals:_totals,...decoded} = value;
  const result = {...decoded,complete:coverage.complete,coverage};
  const manifest = {schema:LEGACY_SOURCE_SCHEMA,id,request,requestHash,
    sourceSha256:digest,selectionSha256:sha256(canonical(projection)),
    state:coverage.complete ? 'completed' : accepted ? 'incomplete' : 'rejected',
    complete:coverage.complete,coverage,problem:problems[0] ?? null,
    captures:[capture],source:{sha256:digest,bytes:bytes.length,format:projection.format},
    ...(original.native === undefined ? {} : {native:original.native})};
  return {manifest,result,captures:[{body:bytes,metadata:capture}]};
}

/** All mutations and recovery remain the original AcquisitionWorkspace methods. */
export class CustomerReceiver extends AcquisitionWorkspace {
  constructor({maxReadBytes=128*1024*1024,...options} = {}) {
    super({...options,runtimeDirectory:options.runtimeDirectory ??
      fileURLToPath(new URL('../../sf88-operator-buyer-cli/',import.meta.url))});
    need(Number.isSafeInteger(maxReadBytes) && maxReadBytes > 0 && maxReadBytes <= 256*1024*1024,
      'LEGACY_READ_LIMIT_INVALID');
    this.maxReadBytes = maxReadBytes;
    for (const name of Object.getOwnPropertyNames(AcquisitionWorkspace.prototype))
      if (name !== 'constructor' && !name.startsWith('_') && typeof this[name] === 'function')
        this[name] = this[name].bind(this);
    this.readSource = this.readSource.bind(this);
    this.exportRun = this.exportRun.bind(this);
  }
  async readSource(runId,operationId,selection,metadata={}, {signal}={}) {
    need(this.directory !== null, 'ACQUISITION_WORKSPACE_REQUIRED');
    need(object(metadata), 'LEGACY_CAPTURE_METADATA_REQUIRED');
    need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
    need(!signal?.aborted, 'LEGACY_READ_ABORTED');
    // Reopening cannot fabricate a missing original workspace.
    const marker = await lstat(join(this.directory,'workspace.json'));
    need(marker.isFile() && !marker.isSymbolicLink(), 'ORIGINAL_ACQUISITION_WORKSPACE_REQUIRED');
    const base = join(dirname(this.runtime.directory),'buyer-runbook');
    const [{openRunbookWorkspace},{runbookPlanDigest}] = await Promise.all([
      import(pathToFileURL(join(base,'workspace-model.mjs')).href),
      import(pathToFileURL(join(base,'runbook.mjs')).href),
    ]);
    const model = await openRunbookWorkspace({directory:this.directory});
    let resource;
    try {
      const current = await model.run(runId), row = current.state.operations.find(item=>item.id===operationId);
      need(row, 'UNKNOWN_JOB_ID');
      resource = await model.download(runId,operationId);
      need(resource.bytes <= this.maxReadBytes, 'LEGACY_SAVED_RESPONSE_LIMIT');
      const saved = row.result?.summary?.responseFile;
      need(saved?.status === 'SAVED' && saved.sha256 === resource.sha256 && saved.bytes === resource.bytes,
        'LEGACY_NATIVE_RESOURCE_SELECTION_CHANGED');
      if (own(metadata,'sha256')) need(metadata.sha256 === resource.sha256, 'LEGACY_SOURCE_DIGEST_MISMATCH');
      if (own(metadata,'bytes')) need(metadata.bytes === resource.bytes, 'LEGACY_SOURCE_SIZE_MISMATCH');
      const before = await resource.file.stat(), identity = resource.identity;
      need(identity && Object.entries(identity).every(([key,value])=>before[key]===value), 'RESOURCE_BYTES_CHANGED');
      const body = Buffer.alloc(resource.bytes); let offset = 0;
      while (offset < body.length) {
        need(!signal?.aborted, 'LEGACY_READ_ABORTED');
        const {bytesRead} = await resource.file.read(body,offset,Math.min(65536,body.length-offset),offset);
        need(bytesRead > 0, 'RESOURCE_BYTES_CHANGED'); offset += bytesRead;
      }
      const after = await resource.file.stat();
      need(Object.entries(identity).every(([key,value])=>after[key]===value) &&
        sha256(body) === resource.sha256, 'RESOURCE_BYTES_CHANGED');
      const status = Number.isInteger(row.result?.summary?.httpStatus) ? row.result.summary.httpStatus : null;
      if (own(metadata,'status')) need(metadata.status === status, 'LEGACY_NATIVE_STATUS_CONFLICT');
      const nativeRequest = {method:row.method,url:row.url};
      if (metadata.request !== undefined)
        need(metadata.request.method === nativeRequest.method && metadata.request.url === nativeRequest.url,
          'LEGACY_NATIVE_REQUEST_CONFLICT');
      const capturedAt = row.result?.finishedAt ?? null;
      const importedAt = metadata.provenance?.importedAt ?? metadata.importedAt ??
        new Date(identity.mtimeMs).toISOString();
      const native = {runId,operationId,intentId:row.intentId,
        planSha256:runbookPlanDigest(current.state.plan),configSha256:row.config.sha256,
        inputIntegrity:row.integrity,attemptState:row.result?.state ?? row.state,
        resource:{name:resource.name,bytes:resource.bytes,sha256:resource.sha256,contentType:resource.contentType}};
      if (own(metadata,'native')) need(canonical(metadata.native) === canonical(native), 'LEGACY_NATIVE_BINDING_CONFLICT');
      return await legacyCaptureSource({body,selection,metadata:{...metadata,
        name:resource.name,sha256:resource.sha256,bytes:resource.bytes,status,
        request:{...metadata.request,...nativeRequest},
        capturedAt:metadata.capturedAt ?? capturedAt,
        ...(status === null ? {provenance:{kind:'file',name:resource.name,importedAt}} : {}),
        native}});
    } finally {
      try {await resource?.file.close();} finally {await model.close();}
    }
  }
  exportRun(id,options) {return this.export(id,options);}
}
export async function openCustomerReceiver(options = {}) {return new CustomerReceiver(options);}
