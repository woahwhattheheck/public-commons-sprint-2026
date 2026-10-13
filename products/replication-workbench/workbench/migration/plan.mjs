// SPDX-License-Identifier: MIT
import {
  alias, canonical, copy, issue, nonempty, objectDigest, pointer, quotedIdentifier,
  relation, requireValue, unique, verifyDocumentDigest, yamlDocument,
} from './common.mjs';
import { normalizeAirbyte } from './intake.mjs';

const SIMPLE_MODES = {
  'full_refresh/overwrite': 'full-refresh',
  'full_refresh/append': 'snapshot',
  'incremental/append': 'incremental',
  'incremental/append_dedup': 'incremental',
};
const SUPPORTED_MODES = new Set(['full-refresh', 'snapshot', 'incremental', 'truncate', 'backfill', 'definition-only', 'change-capture']);
const META_COLUMNS = [
  '_airbyte_ab_id', '_airbyte_raw_id', '_airbyte_extracted_at', '_airbyte_loaded_at',
  '_airbyte_meta', '_airbyte_generation_id', '_airbyte_emitted_at', '_airbyte_normalized_at',
];
function stringList(value, field) {
  requireValue(Array.isArray(value), 'invalid_list', 'Supply an array of strings.', { field });
  value.forEach(item => nonempty(item, field));
  return unique(value.slice(), 'duplicate_list_entry', 'Repeated values are not allowed: ' + field);
}
function resolveField(path, stream, options, problems, role) {
  if (!path.length) return null;
  const map = options.fieldColumns?.[stream.id] ?? {};
  const specified = map[pointer(path)];
  if (specified != null) return nonempty(specified, 'fieldColumns.' + pointer(path));
  if (path.length === 1) return path[0];
  problems.push(issue('nested_field_needs_column', 'Expose this nested path as one source column and bind its exact name.',
    stream, { role, path, fieldPointer: pointer(path) }));
  return null;
}
function destinationSchema(intake, stream, options, problems) {
  if (intake.namespaceDefinition === 'source') {
    return stream.namespace || options.destinationNamespace || null;
  }
  if (intake.namespaceDefinition === 'destination') return options.destinationNamespace || null;
  if (intake.namespaceDefinition === 'custom_format') {
    let format = intake.namespaceFormat || '';
    if (!format) return options.destinationNamespace || null;
    const token = '$' + '{SOURCE_NAMESPACE}';
    format = format.replaceAll(token, stream.namespace || options.destinationNamespace || '');
    if (/\$\{[^}]*\}/.test(format)) problems.push(issue('namespace_format_variable',
      'Resolve the remaining namespace-format variable to the actual destination namespace.', stream));
    return format || null;
  }
  problems.push(issue('namespace_definition', 'Select the actual Airbyte destination namespace behavior.',
    stream, { namespaceDefinition: intake.namespaceDefinition }));
  return null;
}
function relationBinding(value, field) {
  requireValue(Array.isArray(value) && value.length > 0 && value.length <= 3,
    'invalid_relation_binding', 'Bind a relation as an array of exact identifier components.', { field });
  return value.map(part => nonempty(part, field));
}
function checkNativeOverride(value, stream) {
  requireValue(value && typeof value === 'object' && typeof value.reason === 'string' && value.reason.trim(),
    'native_override_reason', 'Document how the explicit native stream preserves the original semantics.', { streamId: stream.id });
  const native = value.config;
  requireValue(native && typeof native === 'object' && SUPPORTED_MODES.has(native.mode),
    'native_override_mode', 'Select one original Sling mode in the native override.', { streamId: stream.id });
  const allowed = new Set(['mode', 'select', 'where', 'primary_key', 'update_key', 'sql',
    'columns', 'transforms', 'source_options', 'target_options', 'change_capture_options']);
  requireValue(Object.keys(native).every(key => allowed.has(key)), 'native_override_field',
    'Keep object, connection, hooks and scheduler ownership in the migration workspace.', { streamId: stream.id });
  return copy(native);
}
function schemaColumns(stream) {
  if (stream.schema?.type && stream.schema.type !== 'object') return [];
  return Object.keys(stream.schema?.properties ?? {}).sort();
}
function comparisonSQL(stream, dialect) {
  const statements = {};
  for (const [side, label, parts] of [
    ['left', 'previous', stream.previousRelation], ['right', 'parallel', stream.parallelRelation],
  ]) {
    const table = relation(parts, dialect), map = stream.columnMaps?.[side] ?? {};
    const column = name => quotedIdentifier(map[name] ?? name, dialect);
    const selected = stream.businessColumns.length ? stream.businessColumns.map(column).join(', ') : '*';
    const queries = {
      rowCount: 'SELECT COUNT(*) AS row_count FROM ' + table + ';',
      rows: 'SELECT ' + selected + ' FROM ' + table + ';',
    };
    if (stream.updateKey) {
      const key = column(stream.updateKey);
      queries.watermark = 'SELECT MIN(' + key + ') AS lower_watermark, MAX(' + key + ') AS upper_watermark FROM ' + table + ';';
    }
    if (stream.primaryKey.length) {
      const keys = stream.primaryKey.map(column);
      queries.nullKeys = 'SELECT COUNT(*) AS null_key_rows FROM ' + table + ' WHERE ' + keys.map(key => key + ' IS NULL').join(' OR ') + ';';
      queries.duplicateKeys = 'SELECT ' + keys.join(', ') + ', COUNT(*) AS duplicate_count FROM ' +
        table + ' GROUP BY ' + keys.join(', ') + ' HAVING COUNT(*) > 1;';
    }
    statements[label] = queries;
  }
  return statements;
}
/** Compile an isolated native replication and its complete comparison/recovery specification. */
export function compileMigration(document, options = {}) {
  const intake = normalizeAirbyte(document, options);
  const problems = [], streams = [];
  const sourceConnection = nonempty(options.sourceConnection, 'sourceConnection');
  const targetConnection = nonempty(options.targetConnection, 'targetConnection');
  for (const [field, value] of [['sourceConnection', sourceConnection], ['targetConnection', targetConnection]]) {
    requireValue(/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value), 'connection_reference',
      'Use an existing named Sling connection, with credentials kept in that connection.', { field });
  }
  const sourceDialect = options.sourceDialect ?? 'postgres', targetDialect = options.targetDialect ?? 'postgres';
  quotedIdentifier('identifier_probe', sourceDialect); quotedIdentifier('identifier_probe', targetDialect);
  const requested = options.streamSelection == null ? null : stringList(options.streamSelection, 'streamSelection');
  if (requested) requireValue(requested.every(id => intake.streams.some(stream => stream.id === id)),
    'unknown_stream_selection', 'Every selected stream must occur in the original connection.');
  const included = intake.streams.filter(stream => stream.selected && (!requested || requested.includes(stream.id)));
  if (!included.length) problems.push(issue('no_selected_streams', 'Select at least one configured stream.'));
  const originalPrefix = typeof intake.prefix === 'string' ? intake.prefix : '';
  requireValue(typeof intake.prefix === 'string', 'invalid_prefix', 'The original destination prefix must be a string.');
  const out = Object.create(null), occupied = new Map();
  for (const stream of included) {
    const binding = options.streamBindings?.[stream.id] ?? {};
    const beforeProblems = problems.length;
    const sourceRelation = relationBinding(binding.sourceRelation ?? [stream.namespace, stream.name].filter(Boolean), 'sourceRelation');
    const namespace = destinationSchema(intake, stream, options, problems);
    const destinationName = stream.aliasName || stream.name;
    let previousRelation = binding.previousRelation;
    if (!previousRelation) {
      if (!namespace) problems.push(issue('destination_namespace_required',
        'Read and bind the current destination namespace for this connection.', stream));
      previousRelation = [namespace, originalPrefix + destinationName].filter(Boolean);
    }
    previousRelation = relationBinding(previousRelation, 'previousRelation');
    let parallelRelation = binding.parallelRelation;
    if (!parallelRelation) {
      const parallelNamespace = options.parallelNamespace;
      if (!parallelNamespace) problems.push(issue('parallel_namespace_required',
        'Select the separate schema or an explicit separate target relation.', stream));
      parallelRelation = [parallelNamespace, previousRelation.at(-1)].filter(Boolean);
    }
    parallelRelation = relationBinding(parallelRelation, 'parallelRelation');
    if (canonical(previousRelation) === canonical(parallelRelation) && options.targetDistinctFromPrevious !== true) {
      problems.push(issue('target_overlaps_previous', 'Bind a separate target connection or a different parallel relation.', stream));
    }
    const destinationIdentity = canonical(parallelRelation);
    if (occupied.has(destinationIdentity)) problems.push(issue('destination_collision',
      'Two streams resolve to the same target relation. Bind distinct objects.', stream, { otherStreamId: occupied.get(destinationIdentity) }));
    occupied.set(destinationIdentity, stream.id);
    const explicit = options.nativeStreamOverrides?.[stream.id];
    let native = explicit ? checkNativeOverride(explicit, stream) : { mode: SIMPLE_MODES[stream.sourceMode + '/' + stream.destinationMode] ?? null };
    const columns = options.businessColumns?.[stream.id] != null ?
      stringList(options.businessColumns[stream.id], 'businessColumns') : schemaColumns(stream);
    let key = null, primaryKey = [];
    if (!explicit && stream.sourceMode === 'incremental') {
      key = resolveField(stream.cursor, stream, options, problems, 'update_key');
      if (!key) problems.push(issue('incremental_cursor_required',
        'Bind the actual source cursor; a source-defined log position cannot be replaced by a guessed timestamp.', stream));
      else native.update_key = key;
      if (stream.destinationMode === 'append_dedup') {
        primaryKey = stream.primaryKey.map(path => resolveField(path, stream, options, problems, 'primary_key')).filter(Boolean);
        if (!primaryKey.length) problems.push(issue('dedup_primary_key_required',
          'Retain every original primary-key component for the incremental upsert.', stream));
        else native.primary_key = primaryKey;
      }
    } else if (explicit) {
      key = native.update_key ?? null;
      primaryKey = native.primary_key == null ? [] : typeof native.primary_key === 'string' ?
        [native.primary_key] : stringList(native.primary_key, 'native primary_key');
    }
    if (!native.mode) problems.push(issue('mode_requires_native_adaptation',
      'This original destination behavior needs an explicit native stream implementation.',
      stream, { sourceMode: stream.sourceMode, destinationMode: stream.destinationMode }));
    if (!explicit && stream.mapperInventory.length) problems.push(issue('stream_mappers_require_adaptation',
      'Implement the retained field mapping/filtering/encryption behavior in an explicit native stream.',
      stream, { mappers: stream.mapperInventory }));
    if (!explicit && (stream.includeFiles || stream.isFileBased || stream.destinationObjectName)) problems.push(issue(
      'non_table_behavior_requires_adaptation', 'Bind the original file movement or data-activation operation explicitly.', stream,
      { includeFiles: stream.includeFiles, isFileBased: stream.isFileBased, destinationObjectName: stream.destinationObjectName }));
    if (!explicit && options.sourceReadMethod === 'log-cdc') problems.push(issue('cdc_requires_native_adaptation',
      'Preserve insert, update and delete behavior using the original change-capture configuration.', stream));
    const selectionActive = stream.fieldSelectionEnabled !== false && stream.selectedFields?.length > 0;
    if (!explicit && selectionActive) {
      native.select = stream.selectedFields.map(path => resolveField(path, stream, options, problems, 'select')).filter(Boolean);
      for (const field of [...primaryKey, ...(key ? [key] : [])]) {
        if (!native.select.includes(field)) problems.push(issue('selected_columns_omit_key',
          'The selected business fields omit a required key. Reconcile the original field-selection behavior.', stream, { field }));
      }
    }
    if (options.sourceSQL?.[stream.id] != null) {
      requireValue(!explicit?.config?.sql, 'duplicate_source_sql', 'Select one source SQL body.', { streamId: stream.id });
      native.sql = nonemptySQL(options.sourceSQL[stream.id]);
      if (native.mode === 'incremental' && !/\{incremental_(?:where_cond|value)\}/.test(native.sql)) {
        problems.push(issue('custom_sql_watermark', 'The custom SQL must include the original Sling incremental placeholder.', stream));
      }
    }
    const businessColumns = native.select?.length ? native.select.slice() : columns;
    unique(businessColumns, 'duplicate_business_column', 'Business columns must be unique.');
    const ignoredLeft = options.metadataColumns?.[stream.id] == null ? META_COLUMNS.slice() :
      stringList(options.metadataColumns[stream.id], 'metadataColumns');
    const ignoredRight = native.mode === 'snapshot' ? ['_sling_loaded_at'] : [];
    const entry = {
      id: stream.id, name: stream.name, namespace: stream.namespace,
      sourceRelation, sourceStream: relation(sourceRelation, sourceDialect),
      previousRelation, parallelRelation, originalMode: stream.originalMode,
      sourceMode: stream.sourceMode, destinationMode: stream.destinationMode,
      mode: native.mode, updateKey: key, primaryKey,
      cursorSource: stream.cursorSource, originalPrimaryKey: copy(stream.primaryKey),
      businessColumns, ignoredLeftColumns: ignoredLeft, ignoredRightColumns: ignoredRight,
      columnMaps: copy(options.columnMaps?.[stream.id] ?? { left: {}, right: {} }),
      cellTypes: copy(options.cellTypes?.[stream.id] ?? {}),
      includeSchemaComparison: true,
      native: { ...native, object: relation(parallelRelation, targetDialect) },
      adaptations: explicit ? [{ reason: explicit.reason, configDigest: objectDigest(explicit.config) }] : [],
      differences: [],
    };
    if (native.mode === 'snapshot') entry.differences.push({
      code: 'snapshot_ingestion_column', column: '_sling_loaded_at',
      explanation: 'Each full append adds an ingestion timestamp column; business-row comparison excludes that declared metadata column.',
    });
    if (native.mode === 'incremental' && key) entry.differences.push({
      code: 'target_watermark', column: key,
      explanation: 'The database target maximum defines the next read. Rows at or below that value need the selected replay/lookback procedure.',
    });
    if (stream.generation.minimum != null && stream.generation.minimum !== 0) entry.differences.push({
      code: 'airbyte_generation_retirement', minimumGeneration: stream.generation.minimum,
      explanation: 'The original Airbyte generation-retirement behavior is retained for the downstream and history review.',
    });
    if (intake.schemaEvolution) entry.differences.push({
      code: 'schema_change_policy', originalBehavior: intake.schemaEvolution,
      explanation: 'Native schema exports are compared as a new source edition before the downstream switch.',
    });
    entry.sql = comparisonSQL(entry, targetDialect);
    entry.ready = problems.slice(beforeProblems).every(problem => problem.severity !== 'error');
    streams.push(entry);
    if (entry.ready) {
      requireValue(!Object.hasOwn(out, entry.sourceStream), 'source_stream_collision',
        'Bind distinct native source stream names or one intentional combined stream.');
      out[entry.sourceStream] = entry.native;
    }
  }
  const unused = intake.streams.filter(stream => !included.some(item => item.id === stream.id)).map(stream => ({
    id: stream.id, name: stream.name, namespace: stream.namespace, selectedInOriginal: stream.selected,
    reason: stream.selected ? 'explicit migration selection' : 'not selected in original connection',
  }));
  const ready = problems.every(problem => problem.severity !== 'error');
  const plan = {
    schema: 'slingdata.migration-plan.v1',
    source: {
      format: intake.format, selector: intake.selector, connectionId: intake.connectionId,
      name: intake.name, sourceId: intake.sourceId, destinationId: intake.destinationId,
      inputDigest: intake.inputDigest, namespaceDefinition: intake.namespaceDefinition,
      namespaceFormat: intake.namespaceFormat, prefix: intake.prefix,
      schedule: intake.schedule, originalStatus: intake.status,
      operationIds: intake.operationIds,
    },
    bindings: { sourceConnection, targetConnection, sourceDialect, targetDialect,
      targetDistinctFromPrevious: options.targetDistinctFromPrevious === true },
    selectedStreams: streams, preservedStreams: unused,
    issues: problems, ready,
    replication: ready ? { source: sourceConnection, target: targetConnection, streams: out } : null,
    nativeCommand: ready ? ['sling', 'run', '-r', 'replication.yaml'] : null,
    operationalSequence: [
      { id: 'baseline', title: 'Load separate target', action: 'Run the compiled replication into the declared parallel target and retain every native output.' },
      { id: 'incremental', title: 'Receive changes', action: 'Run the same selected native replication after the declared source change and export both complete targets.' },
      { id: 'compare', title: 'Compare complete data', action: 'Compare schemas, all business rows, key multiplicities and watermarks using one source observation boundary.' },
      { id: 'downstream', title: 'Update downstream consumers', action: 'Apply the reviewed current-file changes and run their existing application commands against the parallel target.' },
      { id: 'cutover', title: 'Switch the selected connection', action: 'Switch only the selected consumers and existing schedule; retain the previous Airbyte connection and its configuration.' },
      { id: 'rollback', title: 'Restore original routing', action: 'Restore the saved downstream files and original connection/schedule if the same edition still owns those paths.' },
    ],
  };
  plan.planId = objectDigest(plan);
  return plan;
}
function nonemptySQL(value) {
  requireValue(typeof value === 'string' && value.trim() && !value.includes('\u0000'), 'invalid_source_sql',
    'Supply the complete selected source SQL.');
  return value;
}
export function reviewMigration(plan) {
  verifyDocumentDigest(plan, 'planId');
  requireValue(plan?.schema === 'slingdata.migration-plan.v1', 'invalid_plan', 'Select a migration plan.');
  return {
    planId: plan.planId, ready: plan.ready, source: copy(plan.source),
    selected: plan.selectedStreams.length, preserved: plan.preservedStreams.length,
    issues: copy(plan.issues),
    streams: plan.selectedStreams.map(stream => ({
      id: stream.id, source: stream.sourceRelation, previous: stream.previousRelation,
      parallel: stream.parallelRelation, originalMode: stream.originalMode, mode: stream.mode,
      cursor: stream.updateKey, primaryKey: stream.primaryKey, businessColumns: stream.businessColumns,
      differences: stream.differences, ready: stream.ready,
    })),
    replicationYaml: plan.replication ? yamlDocument(plan.replication) : null,
  };
}
export function replicationDocument(plan) {
  verifyDocumentDigest(plan, 'planId');
  requireValue(plan?.ready && plan.replication, 'migration_needs_adaptation',
    'Resolve the listed stream adaptations before producing a runnable native replication.');
  return yamlDocument(plan.replication);
}
