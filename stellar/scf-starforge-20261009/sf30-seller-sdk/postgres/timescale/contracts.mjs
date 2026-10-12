// MIT. TimescaleDB edition, projection and change contracts.
import { identity, fault, object } from '../publisher/files.mjs';
const IDENT = value => typeof value === 'string' && value.length > 0 && !value.includes('\0') && Buffer.byteLength(value) <= 63;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const TIME_TYPES = Object.freeze({
  'timestamp with time zone': 'timestamptz', timestamptz: 'timestamptz',
  'timestamp without time zone': 'timestamp', timestamp: 'timestamp', date: 'date',
  smallint: 'smallint', integer: 'integer', bigint: 'bigint',
});
function checkText(value, label, maximum = 2000, empty = false) {
  if (typeof value !== 'string' || value.includes('\0') || value.length > maximum || !empty && !value.trim())
    throw fault('TIMESCALE_TEXT_REQUIRED', 'Enter ' + label + '.');
  return empty ? value : value.trim();
}
function only(value, keys, code = 'TIMESCALE_INPUT_INVALID') {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault(code);
}
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fault('TIMESCALE_REQUEST_ID_REQUIRED');
  return value;
}
function hash(value) {
  if (typeof value !== 'string' || !HASH.test(value)) throw fault('TIMESCALE_DIGEST_REQUIRED');
  return value;
}
function identifier(value) {
  if (!IDENT(value)) throw fault('TIMESCALE_IDENTIFIER_INVALID');
  return '"' + value.replaceAll('"','""') + '"';
}
const relationName = value => identifier(value.schema) + '.' + identifier(value.name);
function tableRows(table) {
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) throw fault('TIMESCALE_TABLE_INVALID');
  const names = table.columns.map(column => column.name);
  if (new Set(names).size !== names.length || names.some(name => typeof name !== 'string' || !name))
    throw fault('TIMESCALE_TABLE_COLUMNS_INVALID');
  return table.rows.map(row => {
    if (!Array.isArray(row) || row.length !== names.length || row.some(value => value !== null && typeof value !== 'string'))
      throw fault('TIMESCALE_TEXT_ROWS_REQUIRED');
    return Object.fromEntries(names.map((name, index) => [name, row[index]]));
  });
}
function catalog(edition) {
  if (edition?.schema !== 'stellar-forge.timescale-edition.v1' || edition.complete !== true)
    throw fault('TIMESCALE_COMPLETE_EDITION_REQUIRED');
  const aggregates = tableRows(edition.tables.continuous_aggregates);
  const columns = tableRows(edition.tables.columns);
  const dimensions = tableRows(edition.tables.dimensions);
  return aggregates.map(row => {
    const value = { schema: row.view_schema, name: row.view_name, definition: row.view_definition,
      materializedOnly: row.materialized_only === 't', materializedOnlyText: row.materialized_only,
      compressionEnabled: row.compression_enabled, owner: row.view_owner,
      hypertable: { schema: row.hypertable_schema, name: row.hypertable_name },
      materialization: { schema: row.materialization_hypertable_schema, name: row.materialization_hypertable_name } };
    relationName(value);
    value.columns = columns.filter(column => column.schema_name === value.schema && column.relation_name === value.name)
      .map(column => ({ name: column.column_name, oid: column.type_oid, type: column.type_name,
        nullable: column.not_null !== 't', ordinal: column.ordinal }));
    value.timeDimensions = dimensions.filter(dimension =>
      dimension.hypertable_schema === value.hypertable.schema && dimension.hypertable_name === value.hypertable.name &&
      dimension.dimension_type === 'Time');
    value.key = identity([value.schema, value.name]);
    value.definitionDigest = identity({ schema: value.schema, name: value.name, definition: value.definition,
      materializedOnly: value.materializedOnlyText, columns: value.columns });
    return value;
  });
}
function selectedAggregate(edition, key) {
  const value = catalog(edition).find(item => item.key === key);
  if (!value) throw fault('TIMESCALE_AGGREGATE_NOT_FOUND', 'Select a continuous aggregate in this edition.', 404);
  if (!value.columns.length) throw fault('TIMESCALE_AGGREGATE_COLUMNS_MISSING');
  return value;
}
function nativeTarget(edition) {
  const rows = tableRows(edition.tables.identity);
  if (rows.length !== 1) throw fault('TIMESCALE_NATIVE_IDENTITY_INVALID');
  const value = rows[0];
  return { database: value.database_name, databaseOid: value.database_oid,
    serverAddress: value.server_address, serverPort: value.server_port,
    systemIdentifier: value.system_identifier ?? null };
}
function sameTarget(left, right) {
  return identity(nativeTarget(left)) === identity(nativeTarget(right));
}
function timeValue(value, type, label) {
  const text = checkText(value, label, 128);
  if (['smallint','integer','bigint'].includes(type)) {
    if (!/^-?(0|[1-9][0-9]*)$/.test(text)) throw fault('TIMESCALE_INTEGER_TIME_REQUIRED');
    const number = BigInt(text), bits = { smallint:16n, integer:32n, bigint:64n }[type];
    if (number < -(1n << (bits-1n)) || number >= 1n << (bits-1n)) throw fault('TIMESCALE_TIME_OUT_OF_RANGE');
  } else {
    const date = /^\d{4}-\d\d-\d\d$/;
    const timestamp = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d{1,6})?$/;
    const zoned = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
    if (!(type === 'date' ? date : type === 'timestamp' ? timestamp : zoned).test(text))
      throw fault('TIMESCALE_ABSOLUTE_TIME_REQUIRED', 'Use an explicit date or timestamp; timestamptz needs Z or a numeric offset.');
  }
  return text;
}
function windowContract(aggregate, input) {
  const type = TIME_TYPES[input.timeType];
  if (!type) throw fault('TIMESCALE_TIME_TYPE_INVALID');
  const column = aggregate.columns.find(item => item.name === input.timeColumn);
  if (!column || TIME_TYPES[column.type] !== type)
    throw fault('TIMESCALE_TIME_COLUMN_MISMATCH', 'Select the native aggregate time column and its exact PostgreSQL type.');
  const start = timeValue(input.start, type, 'window start'), end = timeValue(input.end, type, 'window end');
  if (['smallint','integer','bigint'].includes(type) && BigInt(start) >= BigInt(end))
    throw fault('TIMESCALE_WINDOW_ORDER_INVALID');
  const timezone = checkText(input.timezone ?? 'UTC', 'the operation timezone', 128);
  return { timeColumn: column.name, timeType: type, start, end, timezone };
}
function refreshContract(edition, input) {
  only(input, ['editionId','editionDigest','aggregateKey','timeColumn','timeType','start','end','timezone',
    'force','bucketsPerBatch','maxBatches','newestFirst','title','owner','note']);
  const aggregate = selectedAggregate(edition,input.aggregateKey), window = windowContract(aggregate,input);
  const force = input.force ?? false, newestFirst = input.newestFirst ?? true;
  if (typeof force !== 'boolean' || typeof newestFirst !== 'boolean') throw fault('TIMESCALE_BOOLEAN_REQUIRED');
  const limit = (value,label) => {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw fault('TIMESCALE_BATCH_OPTION_INVALID',label);
    return value;
  };
  const options = { buckets_per_batch: limit(input.bucketsPerBatch ?? 10, 'Buckets per batch'),
    max_batches_per_execution: limit(input.maxBatches ?? 0, 'Maximum batches'),
    refresh_newest_first: newestFirst };
  if (options.buckets_per_batch === 0 && options.max_batches_per_execution !== 0)
    throw fault('TIMESCALE_ATOMIC_REFRESH_BATCH_LIMIT_INVALID');
  return { schema:'stellar-forge.timescale-refresh-plan.v1',
    title:checkText(input.title,'a refresh title',128), owner:checkText(input.owner,'the operator name',128),
    note:checkText(input.note,'the refresh purpose'), editionId:input.editionId, editionDigest:hash(input.editionDigest),
    aggregateKey:aggregate.key, relation:{schema:aggregate.schema,name:aggregate.name},
    definitionDigest:aggregate.definitionDigest, window, force, options,
    target:nativeTarget(edition), atomic: options.buckets_per_batch === 0 };
}
function projectionContract(edition, input) {
  only(input,['editionId','editionDigest','aggregateKey','columns','timeColumn','timeType','start','end','timezone','title','owner','note']);
  const aggregate = selectedAggregate(edition,input.aggregateKey), window = windowContract(aggregate,input);
  if (!Array.isArray(input.columns) || !input.columns.length || input.columns.length > 64 ||
      new Set(input.columns).size !== input.columns.length || input.columns.some(name => !aggregate.columns.some(column=>column.name===name)))
    throw fault('TIMESCALE_PROJECTION_COLUMNS_INVALID');
  const columns = input.columns.map(name => aggregate.columns.find(column => column.name === name));
  const names = columns.map(column=>identifier(column.name)).join(', ');
  const predicate = identifier(window.timeColumn) + ' >= $1::' + window.timeType + ' AND ' +
    identifier(window.timeColumn) + ' < $2::' + window.timeType;
  // Sort exact native text for repeatable complete CSV ordering, including duplicate
  // time buckets with additional group dimensions. No lossy Number or Date coercion.
  const order = columns.map(column=>identifier(column.name)+'::text COLLATE "C" NULLS FIRST').join(', ');
  const query = { sql:'SELECT '+names+' FROM '+relationName(aggregate)+' WHERE '+predicate+' ORDER BY '+order,
    parameterOrder:['window_start','window_end'], parameters:{
      window_start:{type:'string',minLength:1,maxLength:128}, window_end:{type:'string',minLength:1,maxLength:128}},
    columns:columns.map(column=>column.name), maxRows:1000,maxBytes:917504,timeoutMs:30000 };
  return { schema:'stellar-forge.timescale-projection.v1', title:checkText(input.title,'a publication title',128),
    owner:checkText(input.owner,'the reviewer name',128), note:checkText(input.note,'the selection purpose'),
    editionId:input.editionId,editionDigest:hash(input.editionDigest),aggregateKey:aggregate.key,
    definitionDigest:aggregate.definitionDigest,relation:{schema:aggregate.schema,name:aggregate.name},
    columns,window,query,input:{window_start:window.start,window_end:window.end},target:nativeTarget(edition) };
}
function rowKey(kind, row) {
  const fields = {hypertables:['hypertable_schema','hypertable_name'],dimensions:['hypertable_schema','hypertable_name','dimension_number'],
    continuous_aggregates:['view_schema','view_name'],chunks:['chunk_schema','chunk_name'],jobs:['job_id'],job_schedules:['id'],
    job_stats:['job_id'],job_history:['id'],columns:['schema_name','relation_name','ordinal'],extensions:['extname'] }[kind];
  return fields ? JSON.stringify(fields.map(key=>row[key])) : identity(row);
}
function compareEditions(before, after) {
  if (!sameTarget(before,after)) throw fault('TIMESCALE_EDITION_TARGET_MISMATCH');
  const changes = [];
  for (const kind of ['extensions','hypertables','dimensions','continuous_aggregates','columns','jobs','job_schedules','job_stats','chunks']) {
    const left = new Map(tableRows(before.tables[kind]).map(row=>[rowKey(kind,row),row]));
    const right = new Map(tableRows(after.tables[kind]).map(row=>[rowKey(kind,row),row]));
    for (const key of new Set([...left.keys(),...right.keys()])) {
      const old = left.get(key), next = right.get(key);
      if (identity(old ?? null) === identity(next ?? null)) continue;
      const fields = [...new Set([...Object.keys(old ?? {}),...Object.keys(next ?? {})])].filter(name=>old?.[name]!==next?.[name])
        .map(name=>({name,before:old?.[name]??null,after:next?.[name]??null}));
      changes.push({key:identity([kind,key]),kind,identity:key,state:!old?'ADDED':!next?'REMOVED':'CHANGED',fields,before:old??null,after:next??null});
    }
  }
  return {schema:'stellar-forge.timescale-comparison.v1',before:before.id,after:after.id,
    beforeDigest:identity(before),afterDigest:identity(after),target:nativeTarget(after),changes};
}
function jobDefinition(row, schedule) {
  const ignored = new Set(['next_start']);
  return { ...Object.fromEntries(Object.entries(row).filter(([key])=>!ignored.has(key))),
    timezone:schedule?.timezone??null };
}

export { IDENT, UUID, HASH, TIME_TYPES, checkText, only, uuid, hash, identifier, relationName, tableRows, catalog, selectedAggregate, nativeTarget, sameTarget, timeValue, windowContract, refreshContract, projectionContract, compareEditions, jobDefinition };
