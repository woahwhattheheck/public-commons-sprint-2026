// MIT. Bind merchant-owned report templates to an actual saved Cube /meta response.
// Cube API reference: https://docs.cube.dev/reference/core-data-apis/rest-api/reference
// Query format: https://docs.cube.dev/reference/core-data-apis/rest-api/query-format
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export const fail = message => { throw new TypeError(message); };
export function text(value, name, max = 1024) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value))
    fail(`${name} must be nonempty printable text (max ${max})`);
  return value;
}
export function keys(value, allowed, name) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(`Invalid ${name} fields`);
  return value;
}
const BASE_GRANULARITIES = new Set(['second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year']);
const BASIC = new Set(['equals', 'notEquals', 'set', 'notSet']);
const STRING = new Set(['contains', 'notContains', 'startsWith', 'notStartsWith', 'endsWith', 'notEndsWith']);
const NUMBER = new Set(['gt', 'gte', 'lt', 'lte']);
const DATE = new Set(['inDateRange', 'notInDateRange', 'beforeDate', 'beforeOrOnDate', 'afterDate', 'afterOrOnDate', 'onTheDate']);
const WITHOUT_VALUES = new Set(['set', 'notSet', 'measureFilter']);
const parameter = value => plain(value) && Object.keys(value).length === 1 && own(value, '$param');

/** Preserve exact member names; a cube's display name need not match their prefix. */
export function compileCubeMetadata(raw) {
  if (!plain(raw) || !Array.isArray(raw.cubes) || raw.cubes.length > 4096) fail('Expected Cube /meta JSON with cubes array');
  const members = new Map(), cubes = [], names = new Set();
  let excludedMembers = 0;
  for (const cube of raw.cubes) {
    if (!plain(cube)) fail('Invalid Cube metadata entry');
    const name = text(cube.name, 'Cube name', 512);
    if (names.has(name)) fail(`Repeated Cube metadata name: ${name}`);
    names.add(name);
    const hidden = cube.public === false || cube.isVisible === false;
    const row = { name, type: cube.type === 'view' ? 'view' : 'cube',
      title: typeof cube.title === 'string' ? text(cube.title, 'Cube title', 2048) : name,
      measures: [], dimensions: [], segments: [] };
    for (const kind of ['measures', 'dimensions', 'segments']) {
      const list = cube[kind] ?? [];
      if (!Array.isArray(list)) fail(`Cube ${name} ${kind} must be an array`);
      for (const member of list) {
        if (!plain(member)) fail('Invalid Cube member metadata');
        const memberName = text(member.name, 'Cube member name', 512);
        if (hidden || member.public === false || member.isVisible === false) { excludedMembers++; continue; }
        if (members.has(memberName)) fail(`Ambiguous Cube member metadata: ${memberName}`);
        if (members.size >= 100000) fail('Cube metadata exceeds 100000 public members');
        const granularities = new Set(BASE_GRANULARITIES);
        if (member.granularities !== undefined) {
          if (!Array.isArray(member.granularities)) fail(`Invalid granularities metadata: ${memberName}`);
          for (const item of member.granularities) granularities.add(text(typeof item === 'string' ? item : item?.name, 'Granularity name', 128));
        }
        const record = { name: memberName, cube: name, kind,
          type: member.type === undefined ? null : text(member.type, 'Member type', 64),
          title: typeof member.title === 'string' ? text(member.title, 'Member title', 2048) : memberName,
          ...(member.type === 'time' ? { granularities: [...granularities] } : {}) };
        members.set(memberName, record); row[kind].push(record);
      }
    }
    if (!hidden) cubes.push(row);
  }
  return { cubes, members, excludedMembers };
}

export function inspectCubeMetadata(raw) {
  const catalog = compileCubeMetadata(raw);
  return { schema: 'stellar-forge.cube-member-catalog.v1', cubeCount: catalog.cubes.length,
    memberCount: catalog.members.size, excludedMembers: catalog.excludedMembers, cubes: catalog.cubes };
}

/** Validate the supported single-result query profile before original compilation. */
export function bindCubeReport(catalog, report, reportId) {
  const used = new Map(), inputs = report.inputs;
  const error = message => fail(`${reportId}: ${message}`);
  const member = (name, kinds, where, allowGranularity = false) => {
    if (typeof name !== 'string') error(`${where} needs a fixed member name`);
    let entry = catalog.members.get(name), granularity;
    if (!entry && allowGranularity) {
      const dot = name.lastIndexOf('.');
      entry = catalog.members.get(name.slice(0, dot)); granularity = name.slice(dot + 1);
      if (entry?.type !== 'time' || !entry.granularities.includes(granularity)) entry = undefined;
    }
    if (!entry || !kinds.includes(entry.kind)) error(`${where} member absent or wrong kind in saved /meta: ${name}`);
    used.set(entry.name, entry);
    return entry;
  };
  const scalar = (value, types, where) => {
    if (parameter(value)) {
      if (!types.includes(inputs[value.$param]?.type)) error(`${where} requires ${types.join('/')} input`);
      return;
    }
    if (typeof value !== 'string' && value !== null) error(`${where} requires string values`);
    if (typeof value === 'string') text(value, where);
  };
  const dateRange = (value, where) => {
    if (typeof value === 'string') { text(value, where); return; }
    if (!Array.isArray(value) || value.length < 1 || value.length > 2) error(`${where} requires one or two dates, or a fixed relative range`);
    for (const item of value) {
      scalar(item, ['date'], where);
      if (item === null) error(`${where} dates cannot be null`);
    }
    const params = value.filter(parameter).map(item => item.$param);
    if (params.length && !(value.length === 1 || params.length === 2 && params[0] === params[1])) {
      if (params.length !== 2 || report.range?.start !== params[0] || report.range?.end !== params[1])
        error(`${where} public start/end dates require the matching original range guard`);
    }
  };
  const list = (value, kinds, where, allowGranularity = false) => {
    if (!Array.isArray(value) || value.length > 256 || new Set(value).size !== value.length) error(`Invalid ${where} list`);
    for (const name of value) member(name, kinds, where, allowGranularity);
  };
  const filter = (value, depth = 0) => {
    if (!plain(value) || depth > 16) error('Invalid filter object');
    if (own(value, 'and') || own(value, 'or')) {
      const op = own(value, 'and') ? 'and' : 'or';
      if (Object.keys(value).length !== 1 || !Array.isArray(value[op]) || !value[op].length || value[op].length > 256) error('Invalid logical filter');
      const kinds = new Set(value[op].map(child => filter(child, depth + 1)));
      if (kinds.size !== 1) error('Cube logical filters cannot mix measures and dimensions');
      return [...kinds][0];
    }
    keys(value, ['member', 'operator', 'values'], 'Cube filter');
    const entry = member(value.member, ['measures', 'dimensions'], 'filter');
    const op = value.operator;
    const permitted = BASIC.has(op) || STRING.has(op) && entry.kind === 'dimensions' && entry.type === 'string' ||
      NUMBER.has(op) && (entry.kind === 'measures' || entry.type === 'number') ||
      DATE.has(op) && entry.kind === 'dimensions' && entry.type === 'time' || op === 'measureFilter' && entry.kind === 'measures';
    if (!permitted) error(`Unsupported operator/member type: ${value.member} ${String(op)}`);
    if (WITHOUT_VALUES.has(op)) {
      if (own(value, 'values')) error(`${op} does not take values`);
    } else {
      if (!Array.isArray(value.values) || !value.values.length || value.values.length > 256) error('Filter values must be a nonempty array');
      if (DATE.has(op)) {
        if (['inDateRange', 'notInDateRange'].includes(op)) dateRange(value.values, 'filter date range');
        else {
          if (value.values.length !== 1) error(`${op} requires one date`);
          scalar(value.values[0], ['date'], 'filter date');
          if (value.values[0] === null) error('Filter date cannot be null');
        }
      } else for (const item of value.values) scalar(item, ['enum'], 'filter value');
    }
    return entry.kind;
  };
  const query = report.query;
  list(query.measures, ['measures'], 'measures');
  if (own(query, 'dimensions')) list(query.dimensions, ['dimensions'], 'dimensions', true);
  if (own(query, 'segments')) list(query.segments, ['segments'], 'segments');
  if (own(query, 'filters')) {
    if (!Array.isArray(query.filters) || query.filters.length > 256) error('Invalid filters');
    query.filters.forEach(value => filter(value));
  }
  if (own(query, 'timeDimensions')) {
    if (!Array.isArray(query.timeDimensions) || query.timeDimensions.length > 32) error('Invalid timeDimensions');
    for (const time of query.timeDimensions) {
      keys(time, ['dimension', 'granularity', 'dateRange'], 'single-result time dimension');
      const entry = member(time.dimension, ['dimensions'], 'timeDimensions');
      if (entry.type !== 'time') error(`${time.dimension} must be a time dimension in saved /meta`);
      if (own(time, 'granularity')) {
        const values = parameter(time.granularity) ? inputs[time.granularity.$param]?.values : [time.granularity];
        if (!Array.isArray(values) || !values.length || values.some(value => !entry.granularities.includes(value)))
          error(`Granularity absent from supported time member: ${time.dimension}`);
      }
      if (own(time, 'dateRange')) dateRange(time.dateRange, 'timeDimensions.dateRange');
    }
  }
  if (own(query, 'order')) {
    if (!plain(query.order) && !Array.isArray(query.order)) error('Order must be an object or tuple array');
    const order = Array.isArray(query.order) ? query.order : Object.entries(query.order), seen = new Set();
    if (order.length > 64) error('Too many ordering members');
    for (const pair of order) {
      if (!Array.isArray(pair) || pair.length !== 2 || seen.has(pair[0])) error('Invalid ordering entry');
      member(pair[0], ['measures', 'dimensions'], 'order', true); seen.add(pair[0]);
      const choices = parameter(pair[1]) ? inputs[pair[1].$param]?.values : [pair[1]];
      if (!Array.isArray(choices) || !choices.length || choices.some(value => !['asc', 'desc'].includes(value))) error('Ordering must be asc/desc');
    }
  }
  if (own(query, 'offset')) {
    const bounds = parameter(query.offset) ? inputs[query.offset.$param] : { type: 'integer', min: query.offset, max: query.offset };
    if (bounds?.type !== 'integer' || !Number.isSafeInteger(bounds.min) || !Number.isSafeInteger(bounds.max) || bounds.min < 0) error('Offset requires a nonnegative bounded integer');
  }
  if (own(query, 'timezone')) {
    const zones = parameter(query.timezone) ? inputs[query.timezone.$param]?.values : [query.timezone];
    if (!Array.isArray(zones) || !zones.length) error('Timezone requires a fixed name or enum');
    for (const zone of zones) {
      if (typeof zone !== 'string') error('Timezone names must be strings');
      try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { error(`Invalid timezone: ${zone}`); }
    }
  }
  for (const flag of ['total', 'ungrouped', 'renewQuery']) if (own(query, flag) && typeof query[flag] !== 'boolean') error(`${flag} must be a fixed boolean`);
  return [...used.values()].map(value => structuredClone(value));
}
