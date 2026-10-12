// SPDX-License-Identifier: MIT
// Compare the already-compiled, retained native contracts. No parser, network
// access, serializer replacement, or universal compatibility decision lives here.
// The pinned protobufjs 7.6.6 reflection supplies resolved features/defaults.
// Source: https://protobuf.dev/programming-guides/proto3/#updating
// Source: https://protobuf.dev/programming-guides/json/#json-wire-safety
// Native JSON names/values are defined by this SDK's original values.mjs.
import {createHash} from 'node:crypto';

export const GRPC_CONTRACT_COMPARISON = 'stellar-forge.grpc-contract-comparison.v1';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = values => [...values].sort(order);
const unique = values => sorted(new Set(values));
const nameOf = value => value.fullName.replace(/^\./, '');
const LONGS = new Set(['int64', 'uint64', 'sint64', 'fixed64', 'sfixed64']);
const INTEGERS = new Set([...LONGS, 'int32', 'uint32', 'sint32', 'fixed32', 'sfixed32']);
const PACKABLE = new Set([...INTEGERS, 'bool', 'float', 'double']);
const FIELD_OPTIONS = new Set(['default', 'json_name', 'packed', 'proto3_optional', 'features']);

function need(value, message) {
  if (!value) {
    const error = new Error(message);
    error.code = 'grpc_contract_comparison';
    throw error;
  }
}

function jsonValue(value, depth = 0) {
  need(depth <= 96, 'A retained contract option is nested too deeply.');
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return {decimal: value.toString()};
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return {number: '-0'};
    if (!Number.isFinite(value)) return {number: String(value)};
    return value;
  }
  if (value instanceof Uint8Array) return {base64: Buffer.from(value).toString('base64')};
  if (typeof value.low === 'number' && typeof value.high === 'number' &&
      typeof value.unsigned === 'boolean' && typeof value.toString === 'function') {
    return {decimal: value.toString(), unsigned: value.unsigned};
  }
  if (Array.isArray(value)) return value.map(item => jsonValue(item, depth + 1));
  need(typeof value === 'object', 'A retained contract option is not a JSON value.');
  return Object.fromEntries(Object.keys(value).sort(order)
    .map(key => [key, jsonValue(value[key], depth + 1)]));
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort(order)
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

const equal = (a, b) => canonical(a) === canonical(b);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');

function options(value, excluded = new Set()) {
  return Object.fromEntries(Object.keys(value || {}).filter(key => !excluded.has(key))
    .sort(order).map(key => [key, jsonValue(value[key])]));
}

function edition(value) {
  for (let node = value; node; node = node.parent) {
    if (node._edition) return String(node._edition);
  }
  return value._defaultEdition || null;
}

function ranges(value) {
  return (value || []).map(item => typeof item === 'string' ? item : [...item])
    .sort((a, b) => order(canonical(a), canonical(b)));
}

function reserved(value, id, name) {
  return {
    number: value.some(item => Array.isArray(item) && id >= item[0] && id <= item[1]),
    name: value.some(item => typeof item === 'string' && item === name)
  };
}

function kindOf(value) {
  return value && Array.isArray(value.fieldsArray) ? 'message' : 'enum';
}

function representation(field) {
  if (field.map) return 'object map';
  if (field.repeated) return 'array';
  if (field.kind === 'message') return 'object';
  if (field.kind === 'enum') return 'declared name or int32';
  if (LONGS.has(field.type)) return 'decimal string';
  if (field.type === 'bytes') return 'canonical base64 string';
  if (field.type === 'string') return 'UTF-8 string';
  if (field.type === 'bool') return 'boolean';
  if (field.type === 'float' || field.type === 'double') return 'number or float token';
  return 'integer number';
}

function wire(field) {
  if (field.map) return 'length-delimited map entries';
  if (field.messageEncoding === 'DELIMITED') return 'group';
  if (field.kind === 'message' || field.type === 'bytes' || field.type === 'string') return 'length-delimited';
  if (['double', 'fixed64', 'sfixed64'].includes(field.type)) return 'fixed64';
  if (['float', 'fixed32', 'sfixed32'].includes(field.type)) return 'fixed32';
  if (field.type === 'sint32' || field.type === 'sint64') return 'zigzag varint';
  return 'varint';
}

function declaredDefault(field) {
  const metadata = field.descriptorMetadata || {};
  const descriptorDefault = own(metadata, 'declaredDefault');
  const present = descriptorDefault || own(field.options || {}, 'default');
  if (!present) return {present: false, value: null};
  let value = descriptorDefault ? metadata.declaredDefault : field.options.default;
  if (LONGS.has(field.type)) {
    // Original descriptors retain their decimal spelling even where a native
    // floating-point default cannot represent it. Never infer missing digits.
    if (typeof value === 'string' && /^[+-]?\d+$/.test(value)) {
      value = {decimal: BigInt(value).toString()};
    } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
      value = {decimal: BigInt(value).toString()};
    } else if (value && typeof value.low === 'number') {
      value = {decimal: value.toString()};
    } else value = {retained: jsonValue(value), exactDecimalUnavailable: true};
  } else if (descriptorDefault && INTEGERS.has(field.type) && /^[+-]?\d+$/.test(value)) {
    value = Number(value);
  } else if (descriptorDefault && field.type === 'bool') {
    value = value === 'true' ? true : value === 'false' ? false : value;
  } else if (descriptorDefault && ['float', 'double'].includes(field.type)) {
    const tokens = {inf: Infinity, '-inf': -Infinity, nan: NaN};
    value = own(tokens, value) ? tokens[value] : Number(value);
  }
  return {present: true, value: jsonValue(value)};
}

function fieldView(field) {
  const resolved = field.resolvedType;
  const kind = resolved ? kindOf(resolved) : 'scalar';
  const synthetic = !!field.partOf?.isProto3Optional;
  const presence = field.map || field.repeated ? 'none' :
    field.required ? 'required' :
    kind === 'message' || field.hasPresence ? 'explicit' : 'implicit';
  const packable = kind === 'enum' || PACKABLE.has(field.type);
  const features = jsonValue(field._features || {});
  return {
    name: field.name,
    id: field.id,
    type: resolved ? nameOf(resolved) : field.type,
    kind,
    cardinality: field.map ? 'map' : field.repeated ? 'repeated' : 'singular',
    repeated: !!field.repeated,
    map: !!field.map,
    keyType: field.keyType || null,
    required: !!field.required,
    presence,
    oneof: field.partOf?.name || null,
    syntheticOptional: synthetic,
    proto3Optional: !!(field.descriptorMetadata?.proto3Optional || field.getOption('proto3_optional')),
    jsonName: field.getOption('json_name') || field.name,
    packed: field.repeated && !field.map && packable ? !!field.packed : null,
    messageEncoding: kind === 'message' ? field.delimited ? 'DELIMITED' : 'LENGTH_PREFIXED' : null,
    features,
    declaredDefault: declaredDefault(field),
    nativeDefault: jsonValue(field.defaultValue),
    options: options(field.options, FIELD_OPTIONS),
    extension: field.extend || field.declaringField?.extend || null
  };
}

function messageView(node) {
  const fields = new Map(node.fieldsArray.map(field => [field.id, fieldView(field)]));
  return {
    name: nameOf(node), kind: 'message', edition: edition(node),
    features: jsonValue(node._features || {}),
    options: options(node.options, new Set(['features'])),
    reserved: ranges(node.reserved), extensions: ranges(node.extensions),
    group: !!node.group,
    fields,
    fieldsByName: new Map([...fields.values()].map(field => [field.name, field])),
    oneofs: (node.oneofsArray || []).map(oneof => ({
      name: oneof.name, synthetic: !!oneof.isProto3Optional,
      fields: oneof.oneof.map(name => ({name, id: node.fields[name].id}))
        .sort((a, b) => a.id - b.id || order(a.name, b.name))
    })).sort((a, b) => order(a.name, b.name))
  };
}

function enumView(node) {
  const values = Object.keys(node.values).map(name => ({name, number: node.values[name]}));
  return {
    name: nameOf(node), kind: 'enum', edition: edition(node),
    features: jsonValue(node._features || {}),
    options: options(node.options, new Set(['features', 'allow_alias'])),
    valueOptions: jsonValue(node.valuesOptions || {}),
    reserved: ranges(node.reserved), allowAlias: node.getOption('allow_alias') === true,
    values: values.sort((a, b) => order(a.name, b.name)),
    defaultNumber: Object.keys(node.values).length ? node.values[Object.keys(node.values)[0]] : null,
    outputNames: Object.fromEntries(Object.keys(node.valuesById).sort((a, b) => Number(a) - Number(b))
      .map(number => [number, node.valuesById[number]]))
  };
}

function contractView(contract) {
  need(contract && /^[a-f0-9]{64}$/.test(contract.source?.sha256 || '') &&
    contract.inventory?.source_sha256 === contract.source.sha256 &&
    typeof contract.root?.lookup === 'function' && contract.methods &&
    Array.isArray(contract.inventory.messages) && Array.isArray(contract.inventory.enums),
  'Compare the original complete results of compileProtoSource.');
  const types = new Map();
  for (const item of contract.inventory.messages) {
    const node = contract.root.lookup(item.name);
    need(node && Array.isArray(node.fieldsArray), 'The compiled message is missing: ' + item.name);
    types.set(item.name, messageView(node));
  }
  for (const item of contract.inventory.enums) {
    const node = contract.root.lookup(item.name);
    need(node?.values && !Array.isArray(node.fieldsArray), 'The compiled enum is missing: ' + item.name);
    types.set(item.name, enumView(node));
  }
  const methods = new Map();
  for (const path of Object.keys(contract.methods).sort(order)) {
    const value = contract.methods[path];
    need(types.get(value.requestType)?.kind === 'message' &&
      types.get(value.responseType)?.kind === 'message', 'A compiled method type is missing: ' + path);
    const service = contract.root.lookup(value.service);
    const reflected = service?.methods?.[value.name];
    methods.set(path, {
      shape: {
        requestType: value.requestType, responseType: value.responseType,
        requestStream: !!value.requestStream, responseStream: !!value.responseStream
      },
      options: options(reflected?.options),
      serviceOptions: options(service?.options),
      service: value.service
    });
  }
  const files = new Map([...(contract.inventory.files || []), ...(contract.inventory.builtins || [])]
    .map(file => [file.path, {path: file.path, kind: file.kind, bytes: file.bytes, sha256: file.sha256}]));
  const descriptorFiles = new Map((contract.inventory.descriptor_files || [])
    .map(file => [file.path, jsonValue(file)]));
  return {sha256: contract.source.sha256, schema: contract.source.schema, types, methods, files, descriptorFiles};
}

function typeHeader(type) {
  return {
    name: type.name, kind: type.kind, edition: type.edition,
    ...(type.kind === 'message' ? {fieldCount: type.fields.size, oneofs: type.oneofs} :
      {valueCount: type.values.length})
  };
}

function constraints(message) {
  return message.oneofs.filter(group => !group.synthetic && group.fields.length > 1)
    .map(group => group.fields.map(field => field.name).sort(order))
    .sort((a, b) => order(canonical(a), canonical(b)));
}

function typeChange(field) {
  return {type: field.type, kind: field.kind, wire: wire(field),
    json: representation({...field, map: false, repeated: false})};
}

function reachability(view) {
  const cache = new Map();
  return name => {
    if (cache.has(name)) return cache.get(name);
    const reached = new Set(), pending = [name];
    while (pending.length) {
      const current = pending.pop();
      if (reached.has(current)) continue;
      const type = view.types.get(current);
      if (!type) continue;
      reached.add(current);
      if (type.kind === 'message') {
        for (const field of type.fields.values()) {
          if (field.kind !== 'scalar') pending.push(field.type);
        }
      }
    }
    cache.set(name, reached);
    return reached;
  };
}

/**
 * Produces an exact review of two original compiled contracts. "action" denotes
 * an observed route, encoding, validation or representation change needing an
 * integration edit; "review" denotes a semantic/rollout choice. Neither is an
 * authorization gate. No result claims general binary or application compatibility.
 */
export function compareGrpcContracts(before, after) {
  const previous = contractView(before), next = contractView(after);
  const entries = [];
  function add(kind, level, area, path, oldValue, newValue, impacts, message, scope = {}) {
    const row = {
      kind, level, area, path, before: jsonValue(oldValue), after: jsonValue(newValue),
      impacts: unique(impacts), message
    };
    entries.push({row, scope});
  }
  function property(kind, level, area, path, a, b, impacts, message, scope) {
    if (!equal(a, b)) add(kind, level, area, path, a, b, impacts, message, scope);
  }

  for (const path of unique([...previous.methods.keys(), ...next.methods.keys()])) {
    const a = previous.methods.get(path), b = next.methods.get(path);
    const both = {method: path, directions: ['request', 'response']};
    if (!a || !b) {
      add(a ? 'method_removed' : 'method_added', a ? 'action' : 'review', 'method',
        path, a?.shape || null, b?.shape || null, [a ? 'route removed' : 'route added'],
        a ? 'The candidate no longer exposes this original RPC path.' :
          'A new RPC path needs its own selected request, response and published route.', both);
      continue;
    }
    for (const direction of ['request', 'response']) {
      property('method_' + direction + '_type_changed', 'review', 'method', path,
        a.shape[direction + 'Type'], b.shape[direction + 'Type'], [direction + ' type identity'],
        'The ' + direction + ' message type changed. Inspect its reachable fields and original examples.',
        {method: path, directions: [direction]});
      property('method_' + direction + '_stream_changed', 'action', 'method', path,
        a.shape[direction + 'Stream'], b.shape[direction + 'Stream'], [direction + ' stream lifecycle'],
        'The RPC changed its ' + direction + ' streaming direction; the original caller lifecycle must match.',
        {method: path, directions: [direction]});
    }
    property('method_options_changed', 'review', 'method', path, a.options, b.options,
      ['declared method options'], 'Review changed RPC options against the original operation semantics.', both);
    property('service_options_changed', 'review', 'method', path, a.serviceOptions, b.serviceOptions,
      ['declared service options'], 'Review changed service options for this selected RPC.', both);
  }

  function compareField(typeName, a, b, oldType, newType) {
    const scope = {type: typeName}, path = typeName + '#' + (a || b).id;
    if (!a) {
      const reuse = reserved(oldType?.reserved || [], b.id, b.name);
      const priorName = oldType?.fieldsByName.get(b.name);
      add('field_added', b.required || reuse.number || reuse.name || priorName ? 'action' : 'review',
        'field', path, null, {...b, previouslyReserved: reuse},
        ['new wire field number', ...(priorName ? ['field number migration'] : ['new JSON field']),
          ...(b.required ? ['required input'] : []),
          ...(reuse.number || reuse.name ? ['reserved identifier reuse'] : [])],
        priorName ? 'The existing captured name now uses this new wire number; reconcile retained messages and mixed-version peers.' :
          b.required ? 'The candidate field requires an explicit value under the original validation rules.' :
          reuse.number || reuse.name ? 'The candidate reuses a formerly reserved number or name; reconcile earlier data and callers.' :
            'Review how new field values reach older readers and the buyer application.', scope);
      return;
    }
    if (!b) {
      const retainedName = newType?.fieldsByName.get(a.name);
      add('field_removed', newType ? 'action' : 'review', 'field', path, a,
        {field: null, reservedInCandidate: reserved(newType?.reserved || [], a.id, a.name)},
        ['removed wire field number', retainedName ? 'field number migration' : 'declared field removed',
          'retained data rollout'],
        !newType ? 'The entire original type was removed; inspect its replacement method/type before deciding which JSON fields need migration.' :
          retainedName ? 'The original wire number is absent and this name now uses another number. Reconcile retained messages and mixed-version peers.' :
            'The captured field name is absent from this candidate message. Its original JSON inputs and response consumers need an integration edit.', scope);
      return;
    }
    if (a.name !== b.name) {
      add('field_name_changed', 'action', 'field', path, a.name, b.name,
        ['exact JSON-to-tag mapping'],
        'This wire number maps to a different captured field name. Review JSON keys and any same-name field at another number.', scope);
    }
    if (a.type !== b.type || a.kind !== b.kind) {
      const oldShape = typeChange(a), newShape = typeChange(b);
      const changesWire = oldShape.wire !== newShape.wire;
      const changesJson = oldShape.json !== newShape.json;
      add('field_type_changed', changesWire || changesJson ? 'action' : 'review', 'field',
        path, oldShape, newShape,
        [changesWire ? 'wire encoding' : 'value interpretation',
          ...(changesJson ? ['native JSON representation'] : []), 'range and consumer semantics'],
        changesWire || changesJson ?
          'The declared field type changes its wire encoding or native JSON representation.' :
          'The type changed while retaining this wire/JSON shape; review ranges, values and named-type semantics.', scope);
    }
    property('field_cardinality_changed', 'action', 'field', path, a.cardinality, b.cardinality,
      ['JSON container shape', 'value multiplicity'],
      'The original field changes between a singular value, array or map.', scope);
    property('field_map_key_changed', 'action', 'field', path, a.keyType, b.keyType,
      ['map key validation', 'wire key interpretation'],
      'The map key type changed; preserve exact original keys and review the candidate key domain.', scope);
    property('field_required_changed', b.required ? 'action' : 'review', 'field', path,
      a.required, b.required, ['missing-field validation'],
      b.required ? 'The candidate requires this field; a previously accepted omitted value is rejected.' :
        'The candidate no longer requires this field; older peers may still require it.', scope);
    property('field_presence_changed', 'review', 'field', path, a.presence, b.presence,
      ['absent versus explicit default'],
      'Review the meaning of an omitted field and an explicitly supplied default value.', scope);
    property('field_optional_declaration_changed', 'info', 'field', path,
      {proto3Optional: a.proto3Optional, synthetic: a.syntheticOptional},
      {proto3Optional: b.proto3Optional, synthetic: b.syntheticOptional},
      ['optional descriptor metadata'],
      'The explicit optional declaration or its synthetic oneof changed; presence is reported separately.', scope);
    property('field_oneof_changed', 'review', 'field', path, a.oneof, b.oneof,
      ['oneof membership'],
      'Review this field’s oneof identity. The message comparison reports changed mutual-exclusion sets separately.', scope);
    property('field_json_name_changed', 'review', 'field', path, a.jsonName, b.jsonName,
      ['declared ProtoJSON name'],
      'The declared ProtoJSON name changed. This workspace still uses the exact captured field name.', scope);
    property('field_default_changed', 'review', 'field', path,
      {declared: a.declaredDefault, native: a.nativeDefault},
      {declared: b.declaredDefault, native: b.nativeDefault},
      ['default value semantics'],
      'Review changed declared/native defaults. The original JSON adapter does not fill absent fields.', scope);
    property('field_packed_changed', 'review', 'field', path, a.packed, b.packed,
      ['repeated wire representation'],
      'Packed versus expanded repeated encoding changed; review actual readers and retained data.', scope);
    property('field_message_encoding_changed', 'action', 'field', path, a.messageEncoding, b.messageEncoding,
      ['message wire encoding'], 'The field changed its message/group wire encoding.', scope);
    property('field_features_changed', 'review', 'field', path, a.features, b.features,
      ['resolved edition features'], 'The pinned native runtime resolves different field features.', scope);
    property('field_options_changed', 'review', 'field', path, a.options, b.options,
      ['declared field options'], 'Review changed field options with the owning application.', scope);
    property('field_extension_changed', 'review', 'field', path, a.extension, b.extension,
      ['extension ownership'], 'The field’s native extension target changed.', scope);
  }

  for (const name of unique([...previous.types.keys(), ...next.types.keys()])) {
    const a = previous.types.get(name), b = next.types.get(name), scope = {type: name};
    if (!a || !b || a.kind !== b.kind) {
      if (a) add(a.kind + '_removed', 'review', a.kind, name, typeHeader(a), null,
        ['declared type removed'], 'The candidate no longer has this original ' + a.kind + ' definition.', scope);
      if (b) add(b.kind + '_added', 'info', b.kind, name, null, typeHeader(b),
        ['declared type added'], 'The candidate includes this ' + b.kind + ' definition.', scope);
    }
    if (a && b && a.kind === b.kind) {
      property('type_edition_changed', 'review', a.kind, name, a.edition, b.edition,
        ['source syntax or edition'], 'The original type’s protobuf syntax/edition changed.', scope);
      property('type_features_changed', 'review', a.kind, name, a.features, b.features,
        ['resolved type features'], 'The pinned native runtime resolves different type features.', scope);
      property('type_options_changed', 'review', a.kind, name, a.options, b.options,
        ['declared type options'], 'Review changed type options against application behavior.', scope);
      property('reserved_identifiers_changed', 'review', a.kind, name, a.reserved, b.reserved,
        ['future number and name reuse'],
        'Reserved numbers or names changed. Ranges here are inclusive native reflection ranges.', scope);
    }
    if (a?.kind === 'message' || b?.kind === 'message') {
      const left = a?.kind === 'message' ? a : null, right = b?.kind === 'message' ? b : null;
      const oldFields = left?.fields || new Map(), newFields = right?.fields || new Map();
      for (const id of [...new Set([...oldFields.keys(), ...newFields.keys()])].sort((x, y) => x - y)) {
        compareField(name, oldFields.get(id), newFields.get(id), left, right);
      }
      if (left && right) {
        const byName = new Map([...newFields.values()].map(field => [field.name, field]));
        for (const oldField of oldFields.values()) {
          const newField = byName.get(oldField.name);
          if (newField && newField.id !== oldField.id) add('field_number_changed', 'action', 'field',
            name + '.' + oldField.name, oldField.id, newField.id, ['wire field number'],
            'The same captured field name now uses a different wire number; retained messages and mixed-version peers require explicit migration.', scope);
        }
        property('oneof_declarations_changed', 'review', 'message', name,
          left.oneofs, right.oneofs, ['oneof declarations'],
          'Oneof names, members or synthetic optional metadata changed.', scope);
        property('oneof_constraints_changed', 'action', 'message', name,
          constraints(left), constraints(right), ['mutually exclusive JSON fields'],
          'The sets of mutually exclusive captured field names changed. Review combinations of fields in original and candidate requests.', scope);
        property('message_extensions_changed', 'review', 'message', name, left.extensions, right.extensions,
          ['extension ranges'], 'The message’s original extension ranges changed.', scope);
        property('message_group_changed', 'action', 'message', name, left.group, right.group,
          ['group wire encoding'], 'The message changed its legacy group representation.', scope);
      }
    }
    if (a?.kind === 'enum' || b?.kind === 'enum') {
      const left = a?.kind === 'enum' ? a : null, right = b?.kind === 'enum' ? b : null;
      const oldValues = new Map((left?.values || []).map(item => [item.name, item.number]));
      const newValues = new Map((right?.values || []).map(item => [item.name, item.number]));
      for (const valueName of unique([...oldValues.keys(), ...newValues.keys()])) {
        const had = oldValues.has(valueName), has = newValues.has(valueName);
        const path = name + '.' + valueName;
        if (!had || !has) {
          const number = had ? oldValues.get(valueName) : newValues.get(valueName);
          const reuse = reserved(left?.reserved || [], number, valueName);
          add(has ? 'enum_value_added' : 'enum_value_removed',
            has && !reuse.number && !reuse.name ? 'review' : 'action', 'enum', path,
            had ? {name: valueName, number} : null, has ? {name: valueName, number, previouslyReserved: reuse} :
              {value: null, reservedInCandidate: reserved(right?.reserved || [], number, valueName)},
            [has ? 'new enum name' : 'removed accepted enum name',
              ...(has && (reuse.number || reuse.name) ? ['reserved identifier reuse'] : [])],
            has ? 'Review the added enum name/value with readers and exhaustive application handling.' :
              'The original named enum input is no longer accepted by the candidate.', scope);
        } else property('enum_value_number_changed', 'action', 'enum', path,
          oldValues.get(valueName), newValues.get(valueName), ['enum wire value'],
          'The same enum name now denotes a different wire integer.', scope);
      }
      if (left && right) {
        property('enum_output_names_changed', 'action', 'enum', name, left.outputNames, right.outputNames,
          ['decoded enum names'],
          'The pinned runtime maps wire integers to different enum names or recognizes new integers; review saved results and consumers.', scope);
        property('enum_default_changed', 'review', 'enum', name, left.defaultNumber, right.defaultNumber,
          ['enum default value'], 'The first declared enum value changed its default integer.', scope);
        property('enum_alias_policy_changed', 'review', 'enum', name, left.allowAlias, right.allowAlias,
          ['enum aliases'], 'The declared enum alias policy changed.', scope);
        property('enum_value_options_changed', 'review', 'enum', name, left.valueOptions, right.valueOptions,
          ['declared enum value options'], 'Review changed enum-value options and edition features.', scope);
      }
    }
  }

  property('source_format_changed', 'info', 'source', '/', previous.schema, next.schema,
    ['retained source format'], 'The source format changed; both sides were compiled by the same original contract loader.', {});
  let fileChanged = false;
  for (const path of unique([...previous.files.keys(), ...next.files.keys()])) {
    const a = previous.files.get(path) || null, b = next.files.get(path) || null;
    if (!equal(a, b)) {
      fileChanged = true;
      add(!a ? 'source_file_added' : !b ? 'source_file_removed' : 'source_file_changed',
        'info', 'source', path, a, b, ['retained source bytes'],
        'The retained source file changed. The native field/method report and original source remain available for review.');
    }
    if (previous.descriptorFiles.has(path) && next.descriptorFiles.has(path)) {
      property('descriptor_file_context_changed', 'review', 'source', path,
        previous.descriptorFiles.get(path), next.descriptorFiles.get(path),
        ['descriptor syntax and imports'], 'The reflected file’s syntax, edition or dependency context changed.', {});
    }
  }
  if (previous.sha256 !== next.sha256 && !fileChanged && previous.schema === next.schema) {
    add('source_selection_changed', 'info', 'source', '/', previous.sha256, next.sha256,
      ['source selection or provenance'], 'The retained source selection/provenance changed with the same file-byte inventory.');
  }

  entries.sort((a, b) => order(a.row.area, b.row.area) || order(a.row.path, b.row.path) ||
    order(a.row.kind, b.row.kind) || order(canonical(a.row.before), canonical(b.row.before)) ||
    order(canonical(a.row.after), canonical(b.row.after)));
  const changes = [], typeChanges = new Map(), methodChanges = new Map(), scopes = new Map();
  for (const {row, scope = {}} of entries) {
    const id = 'grpc-change-' + digest({kind: row.kind, area: row.area, path: row.path,
      before: row.before, after: row.after}).slice(0, 32);
    if (scopes.has(id)) continue;
    const change = {id, ...row};
    changes.push(change); scopes.set(id, scope);
    if (scope.type) {
      if (!typeChanges.has(scope.type)) typeChanges.set(scope.type, []);
      typeChanges.get(scope.type).push(id);
    }
    if (scope.method) {
      if (!methodChanges.has(scope.method)) methodChanges.set(scope.method, []);
      methodChanges.get(scope.method).push({id, directions: scope.directions});
    }
  }

  const previousReach = reachability(previous), nextReach = reachability(next);
  const uses = new Map(), methods = [];
  for (const path of unique([...previous.methods.keys(), ...next.methods.keys()])) {
    const a = previous.methods.get(path)?.shape || null, b = next.methods.get(path)?.shape || null;
    const row = {path, before: a, after: b, requestChanges: [], responseChanges: []};
    for (const direction of ['request', 'response']) {
      const reached = new Set([
        ...(a ? previousReach(a[direction + 'Type']) : []),
        ...(b ? nextReach(b[direction + 'Type']) : [])
      ]);
      const ids = new Set();
      for (const name of reached) for (const id of typeChanges.get(name) || []) ids.add(id);
      for (const item of methodChanges.get(path) || []) {
        if (item.directions.includes(direction)) ids.add(item.id);
      }
      row[direction + 'Changes'] = sorted(ids);
      for (const id of ids) {
        if (!uses.has(id)) uses.set(id, new Set());
        uses.get(id).add(direction);
      }
    }
    methods.push(row);
  }
  for (const change of changes) {
    const directions = uses.get(change.id);
    change.impacts = unique([...change.impacts,
      ...(directions ? [...directions].map(direction => 'reachable from ' + direction) :
        scopes.get(change.id).type ? ['not reached by selected RPCs'] : [])]);
  }

  const counts = {total: changes.length, action: 0, review: 0, info: 0};
  for (const change of changes) counts[change.level]++;
  return {
    schema: GRPC_CONTRACT_COMPARISON,
    beforeProtoSha256: previous.sha256,
    afterProtoSha256: next.sha256,
    summary: {
      sourceChanged: previous.sha256 !== next.sha256,
      changes: counts,
      methodsBefore: previous.methods.size,
      methodsAfter: next.methods.size,
      methodsAdded: methods.filter(method => !method.before).length,
      methodsRemoved: methods.filter(method => !method.after).length,
      affectedMethods: methods.filter(method => method.requestChanges.length || method.responseChanges.length).length,
      requestMethods: methods.filter(method => method.requestChanges.length).length,
      responseMethods: methods.filter(method => method.responseChanges.length).length,
      unreachedTypeChanges: changes.filter(change => scopes.get(change.id).type && !uses.has(change.id)).length,
      scope: [
        'Original compiled reflection; exact captured names and native JSON values.',
        'Request and response reachability are calculated separately on each original contract.',
        'Field/enum ranges are inclusive; full source identities remain attached.',
        'Dynamic Any contents and application, pricing, authorization and server behavior require their original source and examples.',
        'Action/review labels describe changes and do not authorize or prohibit Save.'
      ]
    },
    methods,
    changes
  };
}
