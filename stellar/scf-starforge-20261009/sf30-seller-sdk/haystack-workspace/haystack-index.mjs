import {
  HaystackError, diagnosticId, isTagName, validateGrid, valueKind
} from './haystack-types.mjs';

const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const ROLE_TAGS = ['site', 'equip', 'point', 'space', 'system', 'device', 'weatherStation', 'weather'];
const FUNCTION_TAGS = ['sensor', 'cmd', 'sp', 'synthetic'];
const REFERENCE_ROLES = {
  siteRef: 'site', equipRef: 'equip', spaceRef: 'space',
  systemRef: 'system', deviceRef: 'device', weatherStationRef: 'weatherStation'
};
const POINT_KINDS = new Set(['Bool', 'Number', 'Str']);
const MARKER = value => valueKind(value) === 'marker';
const PRESENT = (row, name) => OWN(row, name) && row[name] !== null;
const REF = value => valueKind(value) === 'ref' ? value.val : null;
const TEXT = value => typeof value === 'string' ? value : null;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const pointer = (path, name) => path + '/' + String(name).replace(/~/g, '~0').replace(/\//g, '~1');

function diagnostic(code, severity, message, context = {}, details = {}) {
  const { sourceId, rowIndex, recordKey, tag, path } = context;
  const result = {
    id: diagnosticId(code, sourceId ?? null, recordKey ?? null, tag ?? null, path ?? null),
    code, severity, message,
    ...(sourceId !== undefined ? { sourceId } : {}),
    ...(rowIndex !== undefined ? { rowIndex } : {}),
    ...(recordKey !== undefined ? { recordKey } : {}),
    ...(tag !== undefined ? { tag } : {}),
    details: { ...(path !== undefined ? { path } : {}), ...details }
  };
  return result;
}

function numeric(value) {
  if (typeof value === 'number') return { value, unit: null };
  if (valueKind(value) !== 'number') return null;
  const number = typeof value.val === 'number' ? value.val
    : value.val === 'INF' ? Infinity : value.val === '-INF' ? -Infinity : NaN;
  return { value: number, unit: OWN(value, 'unit') ? value.unit : null };
}

/**
 * Analyze top-level entity records from complete, explicitly selected source grids.
 * Reference scope is exactly sourceId; other sources provide candidates, never joins.
 */
export function analyzeGrids(inputs = []) {
  if (!Array.isArray(inputs))
    throw new HaystackError('ANALYSIS_SOURCES', 'Analysis sources must be an array of {sourceId, grid}.');

  const records = [], relations = [], nestedGrids = [], sources = [];
  const diagnosticMap = new Map();
  const bySource = new Map(), byKey = new Map(), globalIds = new Map();

  const add = item => {
    if (!diagnosticMap.has(item.id)) diagnosticMap.set(item.id, item);
    return item.id;
  };

  for (const input of inputs) {
    if (!input || typeof input !== 'object' || typeof input.sourceId !== 'string' || !input.sourceId.length)
      throw new HaystackError('ANALYSIS_SOURCE_ID', 'Each analysis source requires its nonempty original sourceId.');
    const sourceId = input.sourceId;
    if (bySource.has(sourceId))
      throw new HaystackError('DUPLICATE_ANALYSIS_SOURCE', 'Select each original sourceId once.', { sourceId });
    const validation = validateGrid(input.grid);
    const source = { sourceId, records: [], ids: new Map(), grid: input.grid };
    bySource.set(sourceId, source);
    sources.push({
      sourceId,
      rowCount: input.grid.rows.length,
      columnCount: input.grid.cols.length,
      meta: input.grid.meta
    });

    for (const item of validation.diagnostics) {
      const path = item.details?.path ?? '';
      const match = /^\/rows\/(\d+)(?:\/([^/]+))?/.exec(path);
      const rowIndex = match ? Number(match[1]) : undefined;
      const tag = match?.[2] ? match[2].replace(/~1/g, '/').replace(/~0/g, '~') : undefined;
      add(diagnostic(item.code, item.severity, item.message, {
        sourceId, rowIndex,
        ...(rowIndex !== undefined ? { recordKey: sourceId + ':' + rowIndex } : {}),
        ...(tag !== undefined ? { tag } : {}), path
      }, item.details));
    }
    if (MARKER(input.grid.meta.err))
      add(diagnostic('SOURCE_ERROR_GRID', 'error', 'The original grid is marked as a Haystack error response.', { sourceId, path: '/meta/err' }, {
        display: TEXT(input.grid.meta.dis),
        errorTrace: TEXT(input.grid.meta.errTrace)
      }));

    input.grid.rows.forEach((tags, rowIndex) => {
      const id = REF(tags.id);
      const roles = ROLE_TAGS.filter(tag => MARKER(tags[tag]));
      const markers = Object.keys(tags).filter(tag => isTagName(tag) && MARKER(tags[tag])).sort(compare);
      const display = typeof tags.dis === 'string' && tags.dis.length ? tags.dis
        : valueKind(tags.id) === 'ref' && typeof tags.id.dis === 'string' && tags.id.dis.length ? tags.id.dis
        : id ?? 'Row ' + (rowIndex + 1);
      const record = {
        key: sourceId + ':' + rowIndex,
        sourceId, rowIndex, tags, id, display, roles,
        siteRef: REF(tags.siteRef), equipRef: REF(tags.equipRef),
        kind: TEXT(tags.kind), unit: TEXT(tags.unit),
        markers, outgoingRelationIds: [], diagnosticIds: []
      };
      records.push(record);
      source.records.push(record);
      byKey.set(record.key, record);
      if (id !== null) {
        if (!source.ids.has(id)) source.ids.set(id, []);
        source.ids.get(id).push(record.key);
        if (!globalIds.has(id)) globalIds.set(id, []);
        globalIds.get(id).push(record.key);
      }
    });
  }

  const context = (record, tag, path) => ({
    sourceId: record.sourceId, rowIndex: record.rowIndex, recordKey: record.key,
    ...(tag !== undefined ? { tag } : {}),
    path: path ?? (tag !== undefined ? '/rows/' + record.rowIndex + '/' + tag : '/rows/' + record.rowIndex)
  });
  const issue = (record, code, severity, message, tag, details = {}, path) =>
    add(diagnostic(code, severity, message, context(record, tag, path), details));

  const requireRef = (record, tag) => {
    if (!PRESENT(record.tags, tag)) {
      issue(record, 'REQUIRED_REFERENCE_MISSING', 'error', 'Entity is missing the required typed reference ' + tag + '.', tag);
      return;
    }
    if (REF(record.tags[tag]) === null)
      issue(record, 'REFERENCE_TAG_KIND', 'error', 'Reference tag must contain a Haystack ref value.', tag, { actualKind: valueKind(record.tags[tag]) });
  };

  const requireText = (record, tag, code, severity = 'warning') => {
    if (!PRESENT(record.tags, tag) || typeof record.tags[tag] !== 'string' || !record.tags[tag].length)
      issue(record, code, severity, 'Entity requires a nonempty ' + tag + ' string.', tag,
        { actualKind: PRESENT(record.tags, tag) ? valueKind(record.tags[tag]) : 'absent' });
  };

  for (const source of bySource.values()) {
    for (const [id, keys] of source.ids) {
      if (keys.length > 1) {
        const targetKeys = [...keys];
        for (const key of keys)
          issue(byKey.get(key), 'DUPLICATE_ENTITY_ID', 'error', 'Identifier occurs in more than one row of this original source.', 'id', { id, targetKeys });
      }
    }
  }

  function collectRefs(value, record, tag, path) {
    const kind = valueKind(value);
    if (kind === 'ref') {
      const targetId = value.val;
      const targetKeys = [...(bySource.get(record.sourceId).ids.get(targetId) ?? [])];
      const crossSourceCandidateKeys = (globalIds.get(targetId) ?? [])
        .filter(key => byKey.get(key).sourceId !== record.sourceId).sort(compare);
      const state = targetKeys.length === 0 ? 'unresolved' : targetKeys.length === 1 ? 'resolved' : 'ambiguous';
      const relation = {
        id: diagnosticId('relation', record.sourceId, record.key, tag, path, targetId),
        sourceId: record.sourceId, fromKey: record.key, tag, path,
        targetId, targetKeys, state, crossSourceCandidateKeys,
        ...(OWN(value, 'dis') ? { suppliedDisplay: value.dis } : {})
      };
      relations.push(relation);
      record.outgoingRelationIds.push(relation.id);
      if (state === 'unresolved') {
        issue(record, crossSourceCandidateKeys.length ? 'REFERENCE_OTHER_SOURCE_ONLY' : 'REFERENCE_UNRESOLVED',
          'warning', crossSourceCandidateKeys.length
            ? 'No row in this source resolves the reference. Matching identifiers in other sources are candidates only.'
            : 'No row in this original source resolves the reference.',
          tag, { relationId: relation.id, targetId, targetKeys, crossSourceCandidateKeys }, path);
      } else if (state === 'ambiguous') {
        issue(record, 'REFERENCE_AMBIGUOUS', 'error', 'Reference has multiple matching rows in its original source.',
          tag, { relationId: relation.id, targetId, targetKeys, crossSourceCandidateKeys }, path);
      }
      if (path === '/rows/' + record.rowIndex + '/' + tag && OWN(REFERENCE_ROLES, tag)) {
        const expectedRole = REFERENCE_ROLES[tag];
        const mismatchedTargetKeys = targetKeys.filter(key => !byKey.get(key).roles.includes(expectedRole));
        if (mismatchedTargetKeys.length)
          issue(record, 'REFERENCE_TARGET_ROLE', 'error', 'A matching reference target lacks the expected ' + expectedRole + ' marker.',
            tag, { relationId: relation.id, targetId, expectedRole, targetKeys, mismatchedTargetKeys }, path);
      }
      if (targetKeys.length === 1 && OWN(value, 'dis')) {
        const target = byKey.get(targetKeys[0]);
        if (typeof target.tags.dis === 'string' && value.dis !== target.tags.dis)
          issue(record, 'REFERENCE_DISPLAY_DIFFERENCE', 'info', 'The reference display string differs from the target row display string.',
            tag, { relationId: relation.id, targetId, suppliedDisplay: value.dis, targetDisplay: target.tags.dis }, path);
      }
      return;
    }
    if (kind === 'list') {
      value.forEach((child, index) => collectRefs(child, record, tag, pointer(path, index)));
      return;
    }
    if (kind === 'dict') {
      for (const name of Object.keys(value).filter(isTagName).sort(compare))
        collectRefs(value[name], record, tag, pointer(path, name));
      return;
    }
    if (kind === 'grid') {
      nestedGrids.push({
        sourceId: record.sourceId, fromKey: record.key, tag, path,
        rowCount: value.rows.length, columnCount: value.cols.length
      });
      // Nested grids remain complete values; their internal IDs define another
      // contextual dataset, so they do not enter the outer entity namespace.
    }
  }

  for (const record of records) {
    const row = record.tags, roles = record.roles;
    const entity = roles.some(role => role !== 'weather');
    if (PRESENT(row, 'id') && record.id === null)
      issue(record, 'ENTITY_ID_KIND', 'error', 'Entity id must be a typed Haystack ref.', 'id', { actualKind: valueKind(row.id) });
    else if (entity && record.id === null)
      issue(record, 'ENTITY_ID_MISSING', 'error', 'Tagged entity has no original ref identifier.', 'id');
    if (PRESENT(row, 'dis') && typeof row.dis !== 'string')
      issue(record, 'DISPLAY_TAG_KIND', 'warning', 'Display tag is not a string.', 'dis', { actualKind: valueKind(row.dis) });

    for (const tag of [...ROLE_TAGS, ...FUNCTION_TAGS, 'his', 'cur', 'writable']) {
      if (PRESENT(row, tag) && !MARKER(row[tag]))
        issue(record, 'MARKER_TAG_KIND', 'warning', 'Tag is conventionally a marker but has a different supplied kind.',
          tag, { actualKind: valueKind(row[tag]) });
    }
    for (const tag of Object.keys(REFERENCE_ROLES)) {
      if (PRESENT(row, tag) && REF(row[tag]) === null)
        issue(record, 'REFERENCE_TAG_KIND', 'error', 'Reference tag must contain a Haystack ref value.',
          tag, { actualKind: valueKind(row[tag]) });
    }
    if (roles.includes('equip')) requireRef(record, 'siteRef');
    if (roles.includes('site')) requireText(record, 'tz', 'SITE_TIMEZONE_MISSING');
    if (roles.includes('weatherStation')) requireText(record, 'tz', 'STATION_TIMEZONE_MISSING', 'error');

    if (roles.includes('weather')) {
      if (!roles.includes('point'))
        issue(record, 'WEATHER_POINT_MARKER', 'warning', 'Weather observation should carry the point marker.', 'point');
      if (!MARKER(row.sensor))
        issue(record, 'WEATHER_SENSOR_MARKER', 'error', 'Weather observations require the sensor marker.', 'sensor');
      requireRef(record, 'weatherStationRef');
    }

    if (roles.includes('point')) {
      if (!roles.includes('weather')) {
        requireRef(record, 'siteRef');
        requireRef(record, 'equipRef');
      }
      const functions = FUNCTION_TAGS.filter(tag => MARKER(row[tag]));
      if (functions.length !== 1)
        issue(record, 'POINT_FUNCTION_COUNT', 'error', 'Point must carry exactly one documented point-function marker.',
          'point', { functions, expected: [...FUNCTION_TAGS] });
      if (typeof row.kind !== 'string' || !row.kind.length)
        issue(record, 'POINT_KIND_MISSING', 'error', 'Point requires a nonempty kind string.', 'kind',
          { actualKind: PRESENT(row, 'kind') ? valueKind(row.kind) : 'absent' });
      else if (!POINT_KINDS.has(row.kind))
        issue(record, 'POINT_KIND_OUTSIDE_COMMON_CLASSES', 'warning', 'Point kind is outside the standard analog, digital and enumerated classes.',
          'kind', { suppliedKind: row.kind, commonKinds: [...POINT_KINDS] });
      if (row.kind === 'Number' && (typeof row.unit !== 'string' || !row.unit.length))
        issue(record, 'NUMERIC_POINT_UNIT_MISSING', 'warning', 'Analog point has no nonempty unit string.', 'unit');
      if (PRESENT(row, 'unit') && (typeof row.unit !== 'string' || !row.unit.length))
        issue(record, 'POINT_UNIT_KIND', 'warning', 'Point unit must be a nonempty string.', 'unit', { actualKind: valueKind(row.unit) });
      if (PRESENT(row, 'enum') && typeof row.enum !== 'string')
        issue(record, 'POINT_ENUM_KIND', 'warning', 'Enumeration metadata should be a string.', 'enum', { actualKind: valueKind(row.enum) });
      if (row.kind === 'Str' && (!PRESENT(row, 'enum') || typeof row.enum !== 'string' || !row.enum.length))
        issue(record, 'POINT_ENUM_MISSING', 'warning', 'Enumerated point has no nonempty enum string.', 'enum');

      for (const tag of ['curVal', 'writeVal']) {
        if (!PRESENT(row, tag) || valueKind(row[tag]) === 'na') continue;
        const actualKind = valueKind(row[tag]);
        const expected = { Bool: 'bool', Number: 'number', Str: 'str' }[row.kind];
        if (expected && actualKind !== expected)
          issue(record, 'POINT_VALUE_KIND', 'warning', 'Supplied point value differs from its declared point kind.',
            tag, { declaredKind: row.kind, actualKind });
        const n = numeric(row[tag]);
        if (n?.unit !== null && n?.unit !== undefined && record.unit !== null && n.unit !== record.unit)
          issue(record, 'POINT_VALUE_UNIT', 'warning', 'Supplied value unit differs from the point unit string.',
            tag, { pointUnit: record.unit, valueUnit: n.unit });
      }

      const bounds = {};
      for (const tag of ['minVal', 'maxVal']) {
        if (!PRESENT(row, tag)) continue;
        bounds[tag] = numeric(row[tag]);
        if (!bounds[tag])
          issue(record, 'POINT_RANGE_KIND', 'warning', 'Point range endpoint should be a number.', tag, { actualKind: valueKind(row[tag]) });
        else if (Number.isNaN(bounds[tag].value))
          issue(record, 'POINT_RANGE_UNAVAILABLE', 'warning', 'Point range endpoint is NaN.', tag);
        else if (bounds[tag].unit !== null && record.unit !== null && bounds[tag].unit !== record.unit)
          issue(record, 'POINT_RANGE_UNIT', 'warning', 'Range endpoint unit differs from the point unit string.',
            tag, { pointUnit: record.unit, endpointUnit: bounds[tag].unit });
      }
      if (bounds.minVal && bounds.maxVal &&
          !Number.isNaN(bounds.minVal.value) && !Number.isNaN(bounds.maxVal.value)) {
        if (bounds.minVal.unit !== bounds.maxVal.unit)
          issue(record, 'POINT_RANGE_UNIT_DIFFERENCE', 'warning', 'Range endpoints have different supplied units and are left unconverted.',
            'minVal', { minimumUnit: bounds.minVal.unit, maximumUnit: bounds.maxVal.unit });
        else if (bounds.minVal.value > bounds.maxVal.value)
          issue(record, 'POINT_RANGE_REVERSED', 'error', 'Minimum is greater than maximum in the same supplied unit.',
            'minVal', { minimum: row.minVal, maximum: row.maxVal });
      }

      if (MARKER(row.his)) {
        requireText(record, 'tz', 'HISTORY_TIMEZONE_MISSING', 'error');
        requireText(record, 'hisMode', 'HISTORY_MODE_MISSING');
      }
      if (PRESENT(row, 'writeLevel')) {
        const level = numeric(row.writeLevel);
        if (!level || level.unit !== null || !Number.isInteger(level.value) || level.value < 1 || level.value > 17)
          issue(record, 'WRITE_LEVEL_RANGE', 'warning', 'Supplied write level must be a unitless integer from 1 through 17.', 'writeLevel');
      }
      const statuses = {
        curStatus: ['ok', 'down', 'fault', 'disabled', 'unknown'],
        hisStatus: ['ok', 'down', 'fault', 'disabled', 'pending', 'syncing', 'unknown'],
        writeStatus: ['ok', 'disabled', 'down', 'fault']
      };
      for (const [tag, allowed] of Object.entries(statuses)) {
        if (PRESENT(row, tag) && !allowed.includes(row[tag]))
          issue(record, 'POINT_STATUS_VALUE', 'warning', 'Supplied status differs from the documented status values.',
            tag, { allowed, supplied: row[tag] });
      }
    }

    for (const tag of Object.keys(row).filter(isTagName).sort(compare)) {
      if (tag === 'id') continue;
      collectRefs(row[tag], record, tag, '/rows/' + record.rowIndex + '/' + tag);
    }
  }

  const direct = new Map();
  for (const relation of relations) {
    const record = byKey.get(relation.fromKey);
    if (relation.path === '/rows/' + record.rowIndex + '/' + relation.tag)
      direct.set(record.key + '\u0000' + relation.tag, relation);
  }
  const resolvedTarget = (record, tag) => {
    const relation = direct.get(record.key + '\u0000' + tag);
    return relation?.state === 'resolved' ? byKey.get(relation.targetKeys[0]) : null;
  };

  for (const record of records) {
    if (record.roles.includes('point') || record.roles.includes('equip')) {
      const equip = resolvedTarget(record, 'equipRef');
      if (equip?.roles.includes('equip') && record.siteRef !== null && equip.siteRef !== null && record.siteRef !== equip.siteRef)
        issue(record, 'EQUIPMENT_SITE_DIFFERENCE', 'error', 'Entity and its containing equipment name different sites in the same source.',
          'equipRef', { equipmentKey: equip.key, entitySiteRef: record.siteRef, equipmentSiteRef: equip.siteRef });
    }
    if (record.roles.includes('point') && MARKER(record.tags.his) && typeof record.tags.tz === 'string') {
      const parentTag = record.roles.includes('weather') ? 'weatherStationRef' : 'siteRef';
      const parent = resolvedTarget(record, parentTag);
      if (parent && typeof parent.tags.tz === 'string' && record.tags.tz !== parent.tags.tz)
        issue(record, 'HISTORY_TIMEZONE_DIFFERENCE', 'warning', 'Historized point and its source-local site or weather station carry different literal timezone names.',
          'tz', { parentKey: parent.key, pointTimezone: record.tags.tz, parentTimezone: parent.tags.tz });
    }
  }

  // Containment is a functional graph for each parent-ref tag. Find each cycle
  // once in linear time and keep its complete member set in one diagnostic.
  for (const [role, parentTag] of [['equip', 'equipRef'], ['space', 'spaceRef']]) {
    const parents = new Map();
    for (const record of records) {
      if (!record.roles.includes(role)) continue;
      const parent = resolvedTarget(record, parentTag);
      if (parent?.roles.includes(role)) parents.set(record.key, parent.key);
    }
    const done = new Set();
    for (const start of parents.keys()) {
      if (done.has(start)) continue;
      const path = [], positions = new Map();
      let current = start;
      while (parents.has(current) && !done.has(current) && !positions.has(current)) {
        positions.set(current, path.length);
        path.push(current);
        current = parents.get(current);
      }
      if (positions.has(current)) {
        const members = path.slice(positions.get(current)).sort(compare);
        const first = byKey.get(members[0]);
        const id = issue(first, 'CONTAINMENT_CYCLE', 'error', 'Containment references form a cycle within one source.',
          parentTag, { role, memberKeys: members });
        for (const key of members) byKey.get(key).diagnosticIds.push(id);
      }
      for (const key of path) done.add(key);
    }
  }

  const diagnostics = [...diagnosticMap.values()].sort((a, b) =>
    compare(a.sourceId ?? '', b.sourceId ?? '') ||
    ((a.rowIndex ?? -1) - (b.rowIndex ?? -1)) ||
    compare(a.tag ?? '', b.tag ?? '') ||
    compare(a.details?.path ?? '', b.details?.path ?? '') ||
    compare(a.code, b.code) || compare(a.id, b.id));
  for (const item of diagnostics) {
    if (item.recordKey && byKey.has(item.recordKey)) byKey.get(item.recordKey).diagnosticIds.push(item.id);
  }
  for (const record of records) {
    record.diagnosticIds = [...new Set(record.diagnosticIds)].sort(compare);
    record.refCount = record.outgoingRelationIds.length;
  }
  const byRole = Object.fromEntries(ROLE_TAGS.map(role => [role, 0]));
  for (const record of records) for (const role of record.roles) byRole[role]++;
  const counts = {
    sources: sources.length,
    records: records.length,
    identifiedRecords: records.filter(record => record.id !== null).length,
    anonymousRecords: records.filter(record => record.id === null).length,
    sites: byRole.site, equips: byRole.equip, points: byRole.point,
    spaces: byRole.space, systems: byRole.system, devices: byRole.device,
    weatherStations: byRole.weatherStation, weatherPoints: byRole.weather,
    relations: relations.length,
    resolvedRelations: relations.filter(relation => relation.state === 'resolved').length,
    unresolvedRelations: relations.filter(relation => relation.state === 'unresolved').length,
    ambiguousRelations: relations.filter(relation => relation.state === 'ambiguous').length,
    crossSourceCandidateRelations: relations.filter(relation => relation.crossSourceCandidateKeys.length).length,
    nestedGrids: nestedGrids.length,
    diagnostics: diagnostics.length,
    errors: diagnostics.filter(item => item.severity === 'error').length,
    warnings: diagnostics.filter(item => item.severity === 'warning').length,
    info: diagnostics.filter(item => item.severity === 'info').length,
    byRole
  };
  return { records, relations, diagnostics, counts, sources, nestedGrids };
}
