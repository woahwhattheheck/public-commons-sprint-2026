// SPDX-License-Identifier: MIT
import {
  alias, canonical, copy, fieldPath, isObject, nonempty, objectDigest,
  requireValue, streamId, unique,
} from './common.mjs';

const COMBINED = {
  full_refresh_overwrite: ['full_refresh', 'overwrite'],
  full_refresh_overwrite_deduped: ['full_refresh', 'overwrite_dedup'],
  full_refresh_append: ['full_refresh', 'append'],
  full_refresh_update: ['full_refresh', 'update'],
  full_refresh_soft_delete: ['full_refresh', 'soft_delete'],
  incremental_append: ['incremental', 'append'],
  incremental_deduped_history: ['incremental', 'append_dedup'],
  incremental_update: ['incremental', 'update'],
  incremental_soft_delete: ['incremental', 'soft_delete'],
};

function terraformModules(module, output) {
  if (!isObject(module)) return;
  for (const resource of module.resources || []) {
    if (resource.type === 'airbyte_connection' && resource.mode !== 'data') {
      output.push({ selector: resource.address, format: 'terraform-show', document: resource.values });
    }
  }
  for (const child of module.child_modules || []) terraformModules(child, output);
}

/** Discover complete connection resources without copying credentials or unrelated state. */
export function listAirbyteConnections(document) {
  requireValue(isObject(document), 'invalid_document', 'Import one JSON document.');
  const found = [];
  if (isObject(document.values?.root_module)) terraformModules(document.values.root_module, found);
  if (Array.isArray(document.resources)) {
    for (const resource of document.resources) {
      if (resource.type !== 'airbyte_connection' || resource.mode === 'data') continue;
      const prefix = [resource.module, resource.type, resource.name].filter(Boolean).join('.');
      for (const instance of resource.instances || []) {
        if (instance.deposed != null) continue;
        const suffix = instance.index_key == null ? '' : '[' + JSON.stringify(instance.index_key) + ']';
        found.push({ selector: prefix + suffix, format: 'terraform-state', document: instance.attributes });
      }
    }
  }
  if (!found.length) {
    if (isObject(document.configurations) && Array.isArray(document.configurations.streams)) {
      const snake = Object.hasOwn(document, 'source_id') || Object.hasOwn(document, 'namespace_definition') ||
        document.configurations.streams.some(stream => Object.hasOwn(stream, 'sync_mode'));
      found.push({ selector: alias(document, 'connectionId', 'connection_id', 'connection'),
        format: snake ? 'terraform-resource' : 'public-api', document });
    } else if (isObject(alias(document, 'syncCatalog', 'sync_catalog'))) {
      found.push({ selector: alias(document, 'connectionId', 'connection_id', 'connection'),
        format: 'configuration-api', document });
    } else if (Array.isArray(document.streams)) {
      found.push({ selector: 'catalogue', format: 'protocol-catalogue', document });
    }
  }
  requireValue(found.length > 0, 'no_connection_resources',
    'The document contains no supported Airbyte connection or configured catalogue.');
  unique(found.map(item => item.selector), 'duplicate_connection_selector', 'Connection selectors must be unique.');
  return found.map(item => ({
    selector: item.selector,
    format: item.format,
    name: item.document?.name ?? item.selector,
    connectionId: alias(item.document, 'connectionId', 'connection_id'),
    sourceId: alias(item.document, 'sourceId', 'source_id'),
    destinationId: alias(item.document, 'destinationId', 'destination_id'),
    document: item.document,
  }));
}

function normalizeKeys(value, label) {
  requireValue(Array.isArray(value), 'invalid_primary_key', 'Primary keys must be an array of field paths.', { field: label });
  const keys = value.map((path, index) => fieldPath(path, label + '[' + index + ']', false));
  unique(keys.map(canonical), 'duplicate_primary_key', 'A primary-key path cannot be repeated.');
  return keys;
}
function catalogueMap(catalogue) {
  if (catalogue == null) return new Map();
  const entries = alias(catalogue, 'syncCatalog', 'sync_catalog')?.streams ?? catalogue.streams;
  requireValue(Array.isArray(entries), 'invalid_discovery_catalogue', 'The discovery catalogue must contain streams.');
  const out = new Map();
  for (const item of entries) {
    const source = item.stream ?? item;
    const id = streamId(source.namespace, source.name);
    requireValue(!out.has(id), 'duplicate_discovered_stream', 'The discovery catalogue repeats a stream identity.', { streamId: id });
    out.set(id, source);
  }
  return out;
}
function normalizeStream(item, format, discovered, index) {
  requireValue(isObject(item), 'invalid_stream', 'Every configured stream must be an object.', { index });
  const legacy = format === 'configuration-api';
  const protocol = format === 'protocol-catalogue';
  const source = legacy || protocol ? item.stream : item;
  const config = legacy ? item.config : item;
  requireValue(isObject(source) && isObject(config), 'incomplete_configured_stream',
    'Retain both the original stream and its selected configuration.', { index });
  const name = nonempty(source.name, 'stream.name');
  const namespace = source.namespace == null || source.namespace === '' ? '' : nonempty(source.namespace, 'stream.namespace');
  const id = streamId(namespace, name);
  const discovery = discovered.get(id) ?? {};
  const metadata = { ...discovery, ...source };
  const selected = config.selected !== false && config.disabled !== true;
  const mode = alias(config, 'syncMode', 'sync_mode');
  const destination = alias(config, 'destinationSyncMode', 'destination_sync_mode');
  let pair;
  if (Object.hasOwn(COMBINED, mode)) {
    pair = COMBINED[mode];
    requireValue(destination == null || destination === pair[1], 'conflicting_sync_modes',
      'The combined mode and destination mode disagree.', { streamId: id });
  } else if (['full_refresh', 'incremental'].includes(mode)) {
    requireValue(typeof destination === 'string' && destination.length > 0, 'missing_destination_mode',
      'A protocol source mode needs its original destination mode.', { streamId: id });
    pair = [mode, destination];
  } else {
    pair = [mode, destination];
  }
  const configuredCursor = fieldPath(alias(config, 'cursorField', 'cursor_field', []), 'cursorField');
  const defaultCursor = fieldPath(alias(metadata, 'defaultCursorField', 'default_cursor_field', []), 'defaultCursorField');
  const sourceDefinesCursor = alias(metadata, 'sourceDefinedCursor', 'source_defined_cursor', false) === true;
  const cursor = sourceDefinesCursor ? defaultCursor : configuredCursor.length ? configuredCursor : defaultCursor;
  const configuredKeys = normalizeKeys(alias(config, 'primaryKey', 'primary_key', []), 'primaryKey');
  const defaultKeys = normalizeKeys(alias(metadata, 'sourceDefinedPrimaryKey', 'source_defined_primary_key', []), 'sourceDefinedPrimaryKey');
  const keys = configuredKeys.length ? configuredKeys : defaultKeys;
  const selectedFieldsRaw = alias(config, 'selectedFields', 'selected_fields', null);
  requireValue(selectedFieldsRaw == null || Array.isArray(selectedFieldsRaw), 'invalid_selected_fields',
    'Selected fields must be an array of fieldPath objects.', { streamId: id });
  const selectedFields = selectedFieldsRaw == null ? null : selectedFieldsRaw.map((field, at) =>
    fieldPath(alias(field, 'fieldPath', 'field_path'), 'selectedFields[' + at + ']', false));
  const schema = alias(metadata, 'jsonSchema', 'json_schema', null);
  const mappers = config.mappers ?? [];
  requireValue(Array.isArray(mappers), 'invalid_mappers', 'Stream mappers must be an array.', { streamId: id });
  // Sensitive mapper parameters remain only in the original imported document.
  const mapperInventory = mappers.map(mapper => ({
    id: mapper.id ?? null, type: mapper.type ?? null, sha256: objectDigest(mapper),
    fields: isObject(alias(mapper, 'mapperConfiguration', 'mapper_configuration')) ?
      Object.keys(alias(mapper, 'mapperConfiguration', 'mapper_configuration')).sort() : [],
  }));
  return {
    id, name, namespace, selected, originalMode: mode, sourceMode: pair[0], destinationMode: pair[1],
    cursor, cursorSource: sourceDefinesCursor ? 'source-defined' :
      configuredCursor.length ? 'connection' : defaultCursor.length ? 'source-default' : 'absent',
    configuredCursor, sourceDefinesCursor, primaryKey: keys,
    primaryKeySource: configuredKeys.length ? 'connection' : defaultKeys.length ? 'source-default' : 'absent',
    selectedFields, fieldSelectionEnabled: alias(config, 'fieldSelectionEnabled', 'field_selection_enabled', null),
    destinationObjectName: alias(config, 'destinationObjectName', 'destination_object_name'),
    aliasName: alias(config, 'aliasName', 'alias_name'),
    includeFiles: alias(config, 'includeFiles', 'include_files', false) === true,
    isFileBased: alias(metadata, 'isFileBased', 'is_file_based', false) === true,
    mapperInventory,
    schema: isObject(schema) ? copy(schema) : null,
    sourceConfigurationDigest: objectDigest({ source, config }),
    generation: {
      current: alias(config, 'generationId', 'generation_id'),
      minimum: alias(config, 'minimumGenerationId', 'minimum_generation_id'),
    },
  };
}

/** Normalize the declared source formats; configuration values retain their original semantics. */
export function normalizeAirbyte(document, options = {}) {
  const candidates = listAirbyteConnections(document);
  let chosen;
  if (options.connectionSelector != null) chosen = candidates.find(item => item.selector === options.connectionSelector ||
    item.connectionId === options.connectionSelector);
  else if (candidates.length === 1) chosen = candidates[0];
  requireValue(chosen, 'select_connection', 'Select one exact imported connection.', {
    connections: candidates.map(({ document: omitted, ...item }) => item),
  });
  const value = chosen.document;
  const catalog = alias(value, 'syncCatalog', 'sync_catalog');
  const streams = chosen.format === 'protocol-catalogue' ? value.streams :
    chosen.format === 'configuration-api' ? catalog?.streams : value.configurations?.streams;
  requireValue(Array.isArray(streams), 'missing_streams', 'The selected connection must contain configured streams.');
  const discovered = catalogueMap(options.discoveryCatalogue);
  const normalized = streams.map((item, index) => normalizeStream(item, chosen.format, discovered, index));
  unique(normalized.map(stream => stream.id), 'duplicate_stream_identity',
    'The selected connection repeats a namespace and stream-name pair.');
  let namespaceDefinition = alias(value, 'namespaceDefinition', 'namespace_definition', 'destination');
  if (namespaceDefinition === 'customformat') namespaceDefinition = 'custom_format';
  const schedule = value.schedule ?? {};
  const scheduleData = alias(value, 'scheduleData', 'schedule_data', {});
  const operationIds = alias(value, 'operationIds', 'operation_ids', []);
  requireValue(Array.isArray(operationIds) && operationIds.every(id => typeof id === 'string'),
    'invalid_operation_ids', 'Retain operation IDs as an array of strings.');
  return {
    schema: 'slingdata.airbyte-intake.v1',
    selector: chosen.selector, format: chosen.format, connectionId: chosen.connectionId,
    name: chosen.name, sourceId: chosen.sourceId, destinationId: chosen.destinationId,
    status: value.status ?? null,
    namespaceDefinition,
    namespaceFormat: alias(value, 'namespaceFormat', 'namespace_format', ''),
    prefix: value.prefix ?? '',
    schemaEvolution: alias(value, 'nonBreakingSchemaUpdatesBehavior', 'non_breaking_schema_updates_behavior',
      alias(value, 'nonBreakingChangesPreference', 'non_breaking_changes_preference')),
    schedule: {
      type: alias(schedule, 'scheduleType', 'schedule_type', alias(value, 'scheduleType', 'schedule_type')),
      cron: alias(schedule, 'cronExpression', 'cron_expression',
        alias(scheduleData.cron, 'cronExpression', 'cron_expression')),
      timezone: alias(schedule, 'cronTimeZone', 'cron_time_zone',
        alias(scheduleData.cron, 'cronTimeZone', 'cron_time_zone')),
      basic: schedule.units != null || scheduleData.basicSchedule != null ?
        copy(scheduleData.basicSchedule ?? schedule) : schedule.basicTiming ?? null,
    },
    operationIds: operationIds.slice(),
    inputDigest: objectDigest(value),
    streams: normalized,
  };
}
