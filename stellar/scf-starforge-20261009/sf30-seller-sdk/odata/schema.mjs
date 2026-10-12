// MIT. OData 4 CSDL normalization and exact source values. No provider writes.
export const fail = (code, message, status = 400, detail = {}) =>
  Object.assign(new Error(message), { code, status, ...detail });
export class SourceNumber {
  constructor(text) { this.text = text; Object.freeze(this); }
  toJSON() { return this.text; }
}
export const plain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && !(value instanceof SourceNumber);
export function parseLossless(input) {
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input);
  try {
    return JSON.parse(text, (_key, value, context) => {
      if (typeof value !== 'number') return value;
      if (!context?.source) throw fail('ODATA_NODE_VERSION', 'Use Node.js 24 or later to preserve original OData numeric values.');
      return new SourceNumber(context.source);
    });
  } catch (error) {
    if (error.code) throw error;
    throw fail('ODATA_JSON', 'The provider response is not a complete UTF-8 JSON document.', 502);
  }
}
export const numberText = value => value instanceof SourceNumber ? value.text : String(value);
const EDM = 'http://docs.oasis-open.org/odata/ns/edm';
const EDMX = 'http://docs.oasis-open.org/odata/ns/edmx';
const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const name = value => {
  if (typeof value !== 'string' || value.length > 512 || !IDENTIFIER.test(value))
    throw fail('ODATA_CSDL_NAME', 'CSDL contains an invalid identifier.', 502);
  return value;
};
const bool = (value, fallback) => {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw fail('ODATA_CSDL_BOOLEAN', 'CSDL contains an invalid Boolean facet.', 502);
};
function decodeEntities(text) {
  return text.replace(/&([^;]+);/g, (_whole, entity) => {
    const values = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (own(values, entity)) return values[entity];
    let cp;
    if (/^#x[0-9a-f]+$/i.test(entity)) cp = parseInt(entity.slice(2), 16);
    else if (/^#[0-9]+$/.test(entity)) cp = Number(entity.slice(1));
    if (!Number.isInteger(cp) || cp < 1 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))
      throw fail('ODATA_XML_ENTITY', 'CSDL uses an unsupported XML entity.', 502);
    return String.fromCodePoint(cp);
  });
}
/** Namespace-aware structural XML reader; external entities and DTDs are never loaded. */
function xmlTree(input) {
  const text = (typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input)).replace(/^\uFEFF/, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw fail('ODATA_XML_DTD', 'CSDL must not contain a DTD or external entity declarations.', 502);
  const document = { children: [], namespaces: Object.create(null) }, stack = [document];
  let index = 0, elements = 0;
  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open < 0) {
      if (stack.length === 1 && text.slice(index).trim()) throw fail('ODATA_XML', 'Text occurs outside the XML document.', 502);
      break;
    }
    if (stack.length === 1 && text.slice(index, open).trim()) throw fail('ODATA_XML', 'Text occurs outside the XML document.', 502);
    if (text.startsWith('<!--', open)) {
      const close = text.indexOf('-->', open + 4);
      if (close < 0) throw fail('ODATA_XML', 'CSDL has an unterminated comment.', 502);
      index = close + 3; continue;
    }
    if (text.startsWith('<?', open)) {
      const close = text.indexOf('?>', open + 2);
      if (close < 0) throw fail('ODATA_XML', 'CSDL has an unterminated processing instruction.', 502);
      index = close + 2; continue;
    }
    if (text.startsWith('<![CDATA[', open)) {
      const close = text.indexOf(']]>', open + 9);
      if (close < 0 || stack.length === 1) throw fail('ODATA_XML', 'Invalid CSDL character data.', 502);
      index = close + 3; continue;
    }
    let close = open + 1, quote = '';
    for (; close < text.length; close++) {
      const char = text[close];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (close >= text.length) throw fail('ODATA_XML', 'CSDL has an unterminated element.', 502);
    const tag = text.slice(open + 1, close).trim(); index = close + 1;
    if (tag.startsWith('/')) {
      if (stack.length === 1 || tag.slice(1).trim() !== stack.at(-1).qualified)
        throw fail('ODATA_XML', 'CSDL closing elements do not match.', 502);
      stack.pop(); continue;
    }
    if (tag.startsWith('!')) throw fail('ODATA_XML', 'Unsupported CSDL XML declaration.', 502);
    const selfClosing = tag.endsWith('/'), body = selfClosing ? tag.slice(0, -1).trim() : tag;
    const match = /^([^\s/>]+)([\s\S]*)$/.exec(body);
    if (!match || !/^[\p{L}_][\p{L}\p{N}_.:-]*$/u.test(match[1])) throw fail('ODATA_XML', 'Invalid CSDL element name.', 502);
    const attributes = Object.create(null), namespaces = { ...stack.at(-1).namespaces };
    let rest = match[2];
    while (rest.trim()) {
      const attribute = /^\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
      if (!attribute || own(attributes, attribute[1])) throw fail('ODATA_XML', 'Invalid or duplicate CSDL attribute.', 502);
      const value = decodeEntities(attribute[2] ?? attribute[3]);
      attributes[attribute[1]] = value;
      if (attribute[1] === 'xmlns') namespaces[''] = value;
      else if (attribute[1].startsWith('xmlns:')) namespaces[attribute[1].slice(6)] = value;
      rest = rest.slice(attribute[0].length);
    }
    const parts = match[1].split(':');
    if (parts.length > 2) throw fail('ODATA_XML', 'Invalid CSDL namespace prefix.', 502);
    const node = { qualified: match[1], name: parts.at(-1), ns: namespaces[parts.length === 2 ? parts[0] : ''] ?? '',
      attributes, namespaces, children: [] };
    stack.at(-1).children.push(node);
    if (++elements > 200000 || stack.length > 128) throw fail('ODATA_XML_LIMIT', 'The CSDL document exceeds the supported structural limit.', 502);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1 || document.children.length !== 1) throw fail('ODATA_XML', 'CSDL must contain one complete root element.', 502);
  return document.children[0];
}
const children = (node, local, ns = EDM) => node.children.filter(child => child.ns === ns && child.name === local);
const facetNames = ['MaxLength', 'Precision', 'Scale', 'Unicode', 'SRID', 'DefaultValue'];
function facets(value, prefix = '') {
  return Object.fromEntries(facetNames.flatMap(key => value[prefix + key] === undefined ? [] :
    [[key[0].toLowerCase() + key.slice(1), value[prefix + key] instanceof SourceNumber ? value[prefix + key].text : value[prefix + key]]]));
}
function blankModel(version) {
  return { version, aliases: Object.create(null), entityTypes: Object.create(null), complexTypes: Object.create(null),
    enumTypes: Object.create(null), typeDefinitions: Object.create(null), containers: Object.create(null), references: [], entityContainer: null };
}
function addUnique(map, key, value) {
  if (own(map, key)) throw fail('ODATA_CSDL_DUPLICATE', 'CSDL repeats ' + key + '.', 502);
  map[key] = value;
}
function property(raw, json = false) {
  const p = json ? '$' : '', type = raw[p + 'Type'] ?? (json ? 'Edm.String' : undefined);
  if (typeof type !== 'string') throw fail('ODATA_CSDL_TYPE', 'A property has no CSDL type.', 502);
  const collection = /^Collection\((.+)\)$/.exec(type);
  return { name: name(raw.Name), type: collection ? collection[1] : type,
    collection: collection !== null || bool(raw[p + 'Collection'], false),
    nullable: bool(raw[p + 'Nullable'], json ? false : true), ...facets(raw, p) };
}
function xmlModel(input) {
  const root = xmlTree(input);
  if (root.ns !== EDMX || root.name !== 'Edmx') throw fail('ODATA_CSDL_VERSION', 'Expected an OData 4 EDMX document.', 502);
  const model = blankModel(root.attributes.Version);
  for (const reference of children(root, 'Reference', EDMX)) {
    const includes = children(reference, 'Include', EDMX).map(node => ({ namespace: node.attributes.Namespace, alias: node.attributes.Alias ?? null }));
    model.references.push({ uri: reference.attributes.Uri, includes });
    for (const item of includes) if (item.alias) addUnique(model.aliases, item.alias, item.namespace);
  }
  const data = children(root, 'DataServices', EDMX);
  if (data.length !== 1) throw fail('ODATA_CSDL', 'Expected one EDMX DataServices element.', 502);
  for (const schema of children(data[0], 'Schema')) {
    const ns = schema.attributes.Namespace;
    if (typeof ns !== 'string' || !ns.split('.').every(part => IDENTIFIER.test(part))) throw fail('ODATA_CSDL_NAMESPACE', 'Invalid CSDL namespace.', 502);
    if (schema.attributes.Alias) addUnique(model.aliases, name(schema.attributes.Alias), ns);
    for (const node of schema.children.filter(node => node.ns === EDM)) {
      const attr = node.attributes;
      if (['EntityType', 'ComplexType'].includes(node.name)) {
        const key = ns + '.' + name(attr.Name), keys = children(node, 'Key');
        if (keys.length > 1) throw fail('ODATA_CSDL_KEY', 'An entity type declares multiple keys.', 502);
        const value = { name: attr.Name, qualifiedName: key, namespace: ns, baseType: attr.BaseType ?? null,
          abstract: bool(attr.Abstract, false), openType: bool(attr.OpenType, false), hasStream: bool(attr.HasStream, false),
          declaredKeys: keys.flatMap(keyNode => children(keyNode, 'PropertyRef').map(ref => ref.attributes.Name)),
          properties: children(node, 'Property').map(child => property(child.attributes)),
          navigationProperties: children(node, 'NavigationProperty').map(child => ({ ...property(child.attributes),
            partner: child.attributes.Partner ?? null, containsTarget: bool(child.attributes.ContainsTarget, false) })) };
        addUnique(model[node.name === 'EntityType' ? 'entityTypes' : 'complexTypes'], key, value);
      } else if (node.name === 'EnumType') {
        const key = ns + '.' + name(attr.Name); let previous = -1n;
        const members = Object.create(null);
        for (const member of children(node, 'Member')) {
          const value = member.attributes.Value === undefined ? previous + 1n : BigInt(member.attributes.Value);
          addUnique(members, name(member.attributes.Name), value.toString()); previous = value;
        }
        addUnique(model.enumTypes, key, { qualifiedName: key, underlyingType: attr.UnderlyingType ?? 'Edm.Int32', isFlags: bool(attr.IsFlags, false), members });
      } else if (node.name === 'TypeDefinition') {
        const key = ns + '.' + name(attr.Name);
        addUnique(model.typeDefinitions, key, { qualifiedName: key, underlyingType: attr.UnderlyingType, ...facets(attr) });
      } else if (node.name === 'EntityContainer') {
        const key = ns + '.' + name(attr.Name);
        addUnique(model.containers, key, { name: attr.Name, qualifiedName: key, extends: attr.Extends ?? null,
          entitySets: children(node, 'EntitySet').map(set => ({ name: name(set.attributes.Name), entityType: set.attributes.EntityType,
            includeInServiceDocument: bool(set.attributes.IncludeInServiceDocument, true) })),
          singletons: children(node, 'Singleton').map(singleton => ({ name: name(singleton.attributes.Name), entityType: singleton.attributes.Type })) });
      }
    }
  }
  return model;
}
function jsonModel(input) {
  const doc = typeof input === 'string' || input instanceof Uint8Array ? parseLossless(input) : input;
  if (!plain(doc)) throw fail('ODATA_CSDL_JSON', 'Expected a CSDL JSON object.', 502);
  const model = blankModel(doc.$Version); model.entityContainer = doc.$EntityContainer ?? null;
  for (const [uri, reference] of Object.entries(doc.$Reference ?? {})) {
    const includes = (reference.$Include ?? []).map(item => ({ namespace: item.$Namespace, alias: item.$Alias ?? null }));
    model.references.push({ uri, includes });
    for (const item of includes) if (item.alias) addUnique(model.aliases, item.alias, item.namespace);
  }
  for (const [ns, schema] of Object.entries(doc)) {
    if (ns.startsWith('$') || ns.startsWith('@')) continue;
    if (!plain(schema) || !ns.split('.').every(part => IDENTIFIER.test(part))) throw fail('ODATA_CSDL_NAMESPACE', 'Invalid CSDL JSON namespace.', 502);
    if (schema.$Alias) addUnique(model.aliases, name(schema.$Alias), ns);
    for (const [local, node] of Object.entries(schema)) {
      if (local.startsWith('$') || local.includes('@') || !plain(node)) continue;
      const key = ns + '.' + name(local);
      if (['EntityType', 'ComplexType'].includes(node.$Kind)) {
        const props = [], navigation = [];
        for (const [field, value] of Object.entries(node)) {
          if (field.startsWith('$') || field.includes('@') || !plain(value)) continue;
          const normalized = property({ ...value, Name: field }, true);
          if (value.$Kind === 'NavigationProperty') navigation.push({ ...normalized, partner: value.$Partner ?? null, containsTarget: bool(value.$ContainsTarget, false) });
          else if (value.$Kind === undefined || value.$Kind === 'Property') props.push(normalized);
        }
        const keys = (node.$Key ?? []).map(value => {
          if (typeof value === 'string') return value;
          if (!plain(value) || Object.keys(value).length !== 1 || typeof Object.values(value)[0] !== 'string')
            throw fail('ODATA_CSDL_KEY', 'Invalid CSDL JSON key alias.', 502);
          return Object.values(value)[0];
        });
        addUnique(model[node.$Kind === 'EntityType' ? 'entityTypes' : 'complexTypes'], key, {
          name: local, qualifiedName: key, namespace: ns, baseType: node.$BaseType ?? null, abstract: bool(node.$Abstract, false),
          openType: bool(node.$OpenType, false), hasStream: bool(node.$HasStream, false), declaredKeys: keys, properties: props, navigationProperties: navigation });
      } else if (node.$Kind === 'EnumType') {
        const members = Object.create(null);
        for (const [member, value] of Object.entries(node)) if (!member.startsWith('$') && !member.includes('@'))
          addUnique(members, name(member), numberText(value));
        addUnique(model.enumTypes, key, { qualifiedName: key, underlyingType: node.$UnderlyingType ?? 'Edm.Int32', isFlags: bool(node.$IsFlags, false), members });
      } else if (node.$Kind === 'TypeDefinition') {
        addUnique(model.typeDefinitions, key, { qualifiedName: key, underlyingType: node.$UnderlyingType, ...facets(node, '$') });
      } else if (node.$Kind === 'EntityContainer') {
        const sets = [], singletons = [];
        for (const [setName, value] of Object.entries(node)) {
          if (setName.startsWith('$') || setName.includes('@') || !plain(value) || !value.$Type) continue;
          const target = { name: name(setName), entityType: value.$Type, includeInServiceDocument: bool(value.$IncludeInServiceDocument, true) };
          if (bool(value.$Collection, false)) sets.push(target); else singletons.push(target);
        }
        addUnique(model.containers, key, { name: local, qualifiedName: key, extends: node.$Extends ?? null, entitySets: sets, singletons });
      }
    }
  }
  return model;
}
export function qualifyType(value, aliases) {
  if (typeof value !== 'string' || !value.includes('.')) throw fail('ODATA_CSDL_TYPE', 'CSDL type names must be namespace-qualified.', 502);
  const dot = value.indexOf('.'), prefix = value.slice(0, dot);
  return own(aliases, prefix) ? aliases[prefix] + value.slice(dot) : value;
}
/** Normalize inheritance once, before an operator selects a query. */
export function normalizeCatalog(model) {
  if (!['4.0', '4.01'].includes(model.version)) throw fail('ODATA_CSDL_VERSION', 'This source requires OData 4.0 or 4.01 CSDL.', 502);
  const states = new Map();
  for (const group of ['entityTypes', 'complexTypes']) {
    const resolve = key => {
      if (states.get(key) === 'resolved') return model[group][key];
      if (states.get(key) === 'resolving') throw fail('ODATA_CSDL_INHERITANCE', 'CSDL contains an inheritance cycle.', 502);
      const value = model[group][key];
      if (!value) throw fail('ODATA_CSDL_REFERENCE', 'The metadata does not include required type ' + key + '.', 502, { type: key });
      states.set(key, 'resolving');
      const base = value.baseType ? resolve(qualifyType(value.baseType, model.aliases)) : null;
      if (base && value.declaredKeys.length) throw fail('ODATA_CSDL_KEY', 'A derived entity type must inherit its key.', 502);
      value.baseType = base?.qualifiedName ?? null;
      value.openType = value.openType || !!base?.openType;
      value.hasStream = value.hasStream || !!base?.hasStream;
      for (const field of [...value.properties, ...value.navigationProperties]) field.type = qualifyType(field.type, model.aliases);
      const inherited = [...(base?.properties ?? []), ...(base?.navigationProperties ?? [])].map(field => field.name);
      const names = [...inherited, ...value.properties.map(field => field.name), ...value.navigationProperties.map(field => field.name)];
      if (new Set(names).size !== names.length) throw fail('ODATA_CSDL_DUPLICATE', 'CSDL properties collide across inheritance.', 502);
      value.properties = [...(base?.properties ?? []), ...value.properties];
      value.navigationProperties = [...(base?.navigationProperties ?? []), ...value.navigationProperties];
      value.keyFields = [...(base?.keyFields ?? value.declaredKeys)];
      states.set(key, 'resolved'); return value;
    };
    for (const key of Object.keys(model[group])) resolve(key);
  }
  for (const definition of Object.values(model.typeDefinitions)) definition.underlyingType = qualifyType(definition.underlyingType, model.aliases);
  const containerStates = new Map();
  const resolveContainer = key => {
    if (containerStates.get(key) === 'done') return model.containers[key];
    if (containerStates.get(key) === 'resolving') throw fail('ODATA_CSDL_CONTAINER', 'CSDL contains a container inheritance cycle.', 502);
    const container = model.containers[key];
    if (!container) throw fail('ODATA_CSDL_REFERENCE', 'The metadata omits required container ' + key + '.', 502);
    containerStates.set(key, 'resolving');
    const base = container.extends ? resolveContainer(qualifyType(container.extends, model.aliases)) : null;
    container.entitySets = [...(base?.entitySets ?? []), ...container.entitySets];
    container.singletons = [...(base?.singletons ?? []), ...container.singletons];
    const names = [...container.entitySets, ...container.singletons].map(item => item.name);
    if (names.length !== new Set(names).size) throw fail('ODATA_CSDL_DUPLICATE', 'CSDL container members collide.', 502);
    containerStates.set(key, 'done'); return container;
  };
  for (const key of Object.keys(model.containers)) resolveContainer(key);
  const selected = model.entityContainer ? [qualifyType(model.entityContainer, model.aliases)] : Object.keys(model.containers);
  model.entitySets = [];
  model.singletons = [];
  for (const key of selected) {
    const container = resolveContainer(key);
    for (const set of container.entitySets) {
      const entityType = qualifyType(set.entityType, model.aliases), entity = model.entityTypes[entityType];
      if (!entity) throw fail('ODATA_CSDL_REFERENCE', 'Entity set ' + set.name + ' requires missing type ' + entityType + '.', 502);
      if (!entity.keyFields.length) throw fail('ODATA_CSDL_KEY', 'Entity set ' + set.name + ' has no declared or inherited key.', 502);
      const fields = fieldsForType(model, entityType);
      for (const path of entity.keyFields) {
        const field = fields.find(field => field.path === path);
        if (!field || field.collection || !isScalar(model, field.type)) throw fail('ODATA_CSDL_KEY', 'An entity key does not identify a scalar structural property.', 502);
        field.key = true;
      }
      model.entitySets.push({ ...set, entityType, container: key, keyFields: entity.keyFields, fields });
    }
    model.singletons.push(...container.singletons.map(value => ({ ...value, entityType: qualifyType(value.entityType, model.aliases), container: key })));
  }
  return model;
}
export function parseMetadata(input, { contentType = '' } = {}) {
  const leading = typeof input === 'string' ? input.trimStart()[0] : input instanceof Uint8Array ?
    new TextDecoder().decode(input.subarray(0, 64)).replace(/^\uFEFF/, '').trimStart()[0] : '{';
  return normalizeCatalog(contentType.toLowerCase().includes('json') || leading === '{' ? jsonModel(input) : xmlModel(input));
}
export function underlyingType(catalog, type) {
  const seen = new Set();
  while (catalog.typeDefinitions[type]) {
    if (seen.has(type)) throw fail('ODATA_CSDL_TYPE', 'CSDL type definitions contain a cycle.', 502);
    seen.add(type); type = catalog.typeDefinitions[type].underlyingType;
  }
  return type;
}
export function isScalar(catalog, type) {
  const underlying = underlyingType(catalog, type);
  return underlying.startsWith('Edm.') && underlying !== 'Edm.Stream' || own(catalog.enumTypes, underlying);
}
export function fieldsForType(catalog, type, prefix = '', ancestry = [], parentNullable = false, parentCollection = false) {
  const value = catalog.entityTypes[type] ?? catalog.complexTypes[type];
  if (!value) throw fail('ODATA_CSDL_REFERENCE', 'Metadata omits structural type ' + type + '.', 502);
  if (ancestry.includes(type) || ancestry.length > 32) return [];
  return value.properties.flatMap(prop => {
    const path = prefix ? prefix + '/' + prop.name : prop.name;
    const field = { ...prop, path, nullable: parentNullable || prop.nullable, collection: parentCollection || prop.collection, key: false };
    return catalog.complexTypes[prop.type] ? [field, ...fieldsForType(catalog, prop.type, path, [...ancestry, type], field.nullable, field.collection)] : [field];
  });
}
export function getEntitySet(catalog, selected) {
  const matches = (catalog.entitySets ?? []).filter(set => set.name === selected || set.container + '/' + set.name === selected);
  if (matches.length !== 1) throw fail('ODATA_ENTITY_SET', matches.length ? 'Select an entity set with its container-qualified name.' : 'Choose an entity set advertised by this service.');
  return matches[0];
}
function exactGeneric(value) {
  if (value instanceof SourceNumber) {
    const numeric = Number(value.text);
    return Number.isSafeInteger(numeric) && /^-?\d+$/.test(value.text) ? numeric : value.text;
  }
  if (Array.isArray(value)) return value.map(exactGeneric);
  if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, exactGeneric(item)]));
  return value;
}
function normalizeValue(catalog, property, value) {
  if (value === null) return null;
  if (property.collection) {
    if (!Array.isArray(value)) throw fail('ODATA_ROW_TYPE', 'Provider collection ' + property.name + ' is not an array.', 502);
    return value.map(item => normalizeValue(catalog, { ...property, collection: false }, item));
  }
  const type = underlyingType(catalog, property.type);
  if (catalog.complexTypes[type] || catalog.entityTypes[type]) return normalizeEntity(catalog, type, value);
  if (['Edm.Decimal', 'Edm.Int64'].includes(type)) {
    const text = numberText(value);
    if (!(value instanceof SourceNumber || typeof value === 'string') ||
        !(type === 'Edm.Int64' ? /^-?\d+$/.test(text) : /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)))
      throw fail('ODATA_ROW_TYPE', 'Provider value for ' + property.name + ' is not an exact ' + type + '.', 502);
    return text;
  }
  if (value instanceof SourceNumber) {
    if (['Edm.Byte','Edm.SByte','Edm.Int16','Edm.Int32'].includes(type)) {
      const numeric = Number(value.text);
      if (!Number.isSafeInteger(numeric)) throw fail('ODATA_ROW_TYPE', 'Provider integer is outside its supported exact range.', 502);
      return numeric;
    }
    if (['Edm.Single','Edm.Double'].includes(type)) return Number(value.text);
    return exactGeneric(value);
  }
  return exactGeneric(value);
}
/** Decimal/Int64 stay strings; absent properties and null remain distinct. */
export function normalizeEntity(catalog, entityType, row) {
  if (!plain(row)) throw fail('ODATA_ROW_TYPE', 'An OData entity must be a JSON object.', 502);
  const advertisedType = row['@odata.type'] ?? row['@type'];
  let type = entityType;
  if (typeof advertisedType === 'string') {
    const selected = qualifyType(advertisedType.replace(/^#/, ''), catalog.aliases);
    let candidate = catalog.entityTypes[selected] ?? catalog.complexTypes[selected], compatible = false;
    while (candidate) {
      if (candidate.qualifiedName === entityType) { compatible = true; break; }
      candidate = candidate.baseType ? catalog.entityTypes[candidate.baseType] ?? catalog.complexTypes[candidate.baseType] : null;
    }
    if (!compatible) throw fail('ODATA_ROW_TYPE', 'The provider entity type does not derive from the selected type.', 502);
    type = selected;
  }
  const definition = catalog.entityTypes[type] ?? catalog.complexTypes[type];
  if (!definition) throw fail('ODATA_CSDL_REFERENCE', 'Missing structural type ' + type + '.', 502);
  const properties = new Map(definition.properties.map(prop => [prop.name, prop]));
  return Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, properties.has(key) ? normalizeValue(catalog, properties.get(key), value) : exactGeneric(value)]));
}
