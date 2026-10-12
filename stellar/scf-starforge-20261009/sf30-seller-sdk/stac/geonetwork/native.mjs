import { createHash } from 'node:crypto';

// Native GeoNetwork 4.4.12 contract; no model, process, or package dependency.
export const GEONETWORK_SOURCE = Object.freeze({
  repository: 'geonetwork/core-geonetwork',
  commit: '45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4',
  version: '4.4.12',
});
export const VALIDATION_OPTIONS = Object.freeze([
  'NOVALIDATION', 'XSDVALIDATION', 'SCHEMATRONVALIDATION',
]);
export const RESERVED_OPERATIONS = Object.freeze([
  Object.freeze({ id: 0, name: 'view', harvesterAllowed: true }),
  Object.freeze({ id: 1, name: 'download', harvesterAllowed: true }),
  Object.freeze({ id: 2, name: 'editing', harvesterAllowed: false }),
  Object.freeze({ id: 3, name: 'notify', harvesterAllowed: true }),
  Object.freeze({ id: 5, name: 'dynamic', harvesterAllowed: true }),
  Object.freeze({ id: 6, name: 'featured', harvesterAllowed: true }),
]);
export const STAC_TRANSFORM = 'schema:iso19115-3.2018:convert/stac-to-iso19115-3';
const GEONET_NS = 'http://www.fao.org/geonetwork';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const MiB = 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const stable = value => JSON.stringify(canonical(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

export class GeoNetworkError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GeoNetworkError';
    Object.assign(this, { code, status: null, mutation: false, uncertain: false, exchange: null }, details);
  }
}
function fail(code, message, details) { throw new GeoNetworkError(code, message, details); }
function text(value, label, max = 4096, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.length) || value.length > max)
    fail('GN_INPUT', label + ' must be a bounded string.');
  for (const character of value) {
    const n = character.codePointAt(0);
    if (!(n === 9 || n === 10 || n === 13 || (n >= 32 && n <= 0xD7FF) ||
      (n >= 0xE000 && n <= 0xFFFD) || (n >= 0x10000 && n <= 0x10FFFF)))
      fail('GN_INPUT', label + ' contains a character XML 1.0 cannot represent.');
  }
  return value;
}
function integer(value, label, min = 0, max = 2147483647) {
  const n = typeof value === 'string' && (min < 0 ? /^-?\d+$/ : /^\d+$/).test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < min || n > max) fail('GN_INPUT', label + ' is out of range.');
  return n;
}
function id(value, label = 'Identifier') { return String(integer(value, label)); }
function flag(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail('GN_INPUT', label + ' must be boolean.');
  return value;
}
function token(value, label) {
  text(value, label, 128);
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)) fail('GN_INPUT', label + ' is not a native name.');
  return value;
}
function uuid(value) {
  text(value, 'Record UUID', 1024);
  if (value !== value.trim() || /[\u0000-\u0020\u007F]/u.test(value))
    fail('GN_INPUT', 'Record UUID must not contain whitespace or control characters.');
  return value;
}
function uuidList(value) {
  if (!Array.isArray(value) || !value.length || value.length > 500)
    fail('GN_INPUT', 'Select between 1 and 500 explicit record UUIDs.');
  const result = value.map(uuid);
  if (new Set(result).size !== result.length) fail('GN_INPUT', 'Record UUIDs must be distinct.');
  return result;
}
function secret(environment, reference, label, optional = false) {
  if (reference === undefined && optional) return null;
  if (typeof reference !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference))
    fail('GN_CREDENTIAL_REFERENCE', label + ' requires an environment variable name.');
  const value = environment?.[reference];
  if (typeof value !== 'string' || !value.length || value.length > 32768 || /[\r\n\0]/.test(value))
    fail('GN_CREDENTIAL_UNAVAILABLE', label + ' is unavailable or invalid.');
  return value;
}
function nativeUrl(value, label, allowHttp) {
  text(value, label, 16384);
  let url;
  try { url = new URL(value); } catch { fail('GN_INPUT', label + ' must be an absolute URL.'); }
  if (url.username || url.password || url.hash ||
    !(url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')))
    fail('GN_INPUT', label + ' must use the selected HTTP(S) transport without userinfo or fragment.');
  return url;
}

/**
 * GeoNetwork uses Java URL validation, then this regex on the ORIGINAL ID.
 * Conventional http/https/ftp URLs and ordinary IDs are supported. Ambiguous
 * standard-JVM URL forms/custom schemes are rejected instead of guessed.
 */
export function nativeRecordId(identifier) {
  uuid(identifier);
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(identifier)?.[1]?.toLowerCase();
  if (!scheme) return identifier;
  if (scheme === 'urn') return identifier;
  if (!['http', 'https', 'ftp'].includes(scheme))
    fail('GN_RECORD_ID_SCHEME', 'Review this collection ID against the installed Java URL handlers.');
  if (!/^(?:https?|ftp):\/\/[^/]/i.test(identifier) || /[\s\\]/u.test(identifier))
    fail('GN_RECORD_ID_URL', 'Use an unambiguous absolute collection URL.');
  let parsed;
  try { parsed = new URL(identifier); } catch { fail('GN_RECORD_ID_URL', 'Invalid collection URL.'); }
  if (!parsed.hostname || parsed.username || parsed.password)
    fail('GN_RECORD_ID_URL', 'Collection URL requires a host and no userinfo.');
  return identifier.replace(/.*\/([^/?]+).*/, '$1');
}

export function escapeXml(value) {
  return text(String(value), 'XML value', 16 * MiB, true)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
function decodeEntities(value) {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);)/.test(value))
    fail('GN_XML_ENTITY', 'DTD and general/external XML entities are not supported.');
  return value.replace(/&([^;]+);/g, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (own(named, entity)) return named[entity];
    const n = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(n) || n > 0x10FFFF || n < 0)
      fail('GN_XML_ENTITY', 'Invalid XML character reference.');
    return text(String.fromCodePoint(n), 'XML character reference');
  });
}
const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;
function qname(name) {
  if (!XML_NAME.test(name)) fail('GN_XML_NAME', 'Unsupported XML qualified name.');
  const pieces = name.split(':');
  return pieces.length === 2 ? { prefix: pieces[0], localName: pieces[1] } :
    { prefix: '', localName: name };
}

/**
 * Bounded XML 1.0 reader for native GeoNetwork/ISO documents. Preserves exact
 * source spans and namespace identity; never loads a DTD or resolves a URI.
 * Only the predefined XML entities and numeric character references are accepted.
 */
export function parseXml(input, { maxBytes = 8 * MiB, maxDepth = 96, maxNodes = 100000 } = {}) {
  integer(maxBytes, 'XML byte limit', 1, 64 * MiB);
  integer(maxDepth, 'XML depth limit', 1, 256);
  integer(maxNodes, 'XML node limit', 1, 1000000);
  let xml;
  if (typeof input === 'string') xml = input;
  else if (input instanceof Uint8Array) {
    try { xml = new TextDecoder('utf-8', { fatal: true }).decode(input); }
    catch { fail('GN_XML_ENCODING', 'Native XML is not valid UTF-8.'); }
  } else fail('GN_XML', 'Expected native XML bytes or text.');
  if (Buffer.byteLength(xml, 'utf8') > maxBytes) fail('GN_XML_LIMIT', 'Native XML exceeds its byte limit.');
  text(xml, 'Native XML', maxBytes, false);
  let offset = xml.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let root = null, count = 0, declaration = false;
  const stack = [];
  function append(value) {
    if (!stack.length) {
      if (value.trim()) fail('GN_XML', 'Text outside the XML document element.');
    } else {
      if (++count > maxNodes) fail('GN_XML_LIMIT', 'Native XML exceeds its node limit.');
      stack.at(-1).children.push(value);
    }
  }
  while (offset < xml.length) {
    if (xml[offset] !== '<') {
      const end = xml.indexOf('<', offset);
      const stop = end < 0 ? xml.length : end;
      const raw = xml.slice(offset, stop);
      if (raw.includes(']]>')) fail('GN_XML', 'CDATA terminator in XML text.');
      append(decodeEntities(raw.replace(/\r\n?/g, '\n')));
      offset = stop;
      continue;
    }
    if (xml.startsWith('<!--', offset)) {
      const end = xml.indexOf('-->', offset + 4);
      if (end < 0 || xml.slice(offset + 4, end).includes('--'))
        fail('GN_XML', 'Invalid XML comment.');
      offset = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', offset)) {
      if (!stack.length) fail('GN_XML', 'CDATA outside the document element.');
      const end = xml.indexOf(']]>', offset + 9);
      if (end < 0) fail('GN_XML', 'Unclosed CDATA section.');
      append(xml.slice(offset + 9, end).replace(/\r\n?/g, '\n'));
      offset = end + 3;
      continue;
    }
    if (xml.startsWith('<?', offset)) {
      const end = xml.indexOf('?>', offset + 2);
      const body = end < 0 ? '' : xml.slice(offset + 2, end);
      if (end < 0 || !/^xml\s/.test(body) || root || declaration || stack.length)
        fail('GN_XML', 'Only an initial XML declaration is supported.');
      const encoding = /\bencoding\s*=\s*(['"])(.*?)\1/.exec(body)?.[2];
      if (encoding && !/^utf-?8$/i.test(encoding)) fail('GN_XML_ENCODING', 'Native XML must use UTF-8.');
      declaration = true;
      offset = end + 2;
      continue;
    }
    if (xml.startsWith('<!', offset)) fail('GN_XML_ENTITY', 'DTD/entity declarations are prohibited.');
    if (xml.startsWith('</', offset)) {
      const end = xml.indexOf('>', offset + 2);
      if (end < 0) fail('GN_XML', 'Unclosed XML end tag.');
      const name = xml.slice(offset + 2, end).trim();
      qname(name);
      const node = stack.pop();
      if (!node || node.name !== name) fail('GN_XML', 'Mismatched XML end tag.');
      node.end = end + 1;
      offset = end + 1;
      continue;
    }
    const start = offset++;
    const nm = /^[^\s/>]+/.exec(xml.slice(offset));
    if (!nm) fail('GN_XML', 'Missing XML element name.');
    const name = nm[0], named = qname(name);
    if (named.prefix === 'xmlns') fail('GN_XML_NAMESPACE', 'Invalid XML namespace prefix.');
    offset += name.length;
    const rawAttributes = [];
    let selfClosing = false, closed = false;
    while (offset < xml.length) {
      const ws = /^\s*/.exec(xml.slice(offset))[0];
      offset += ws.length;
      if (xml.startsWith('/>', offset)) { selfClosing = true; offset += 2; closed = true; break; }
      if (xml[offset] === '>') { offset++; closed = true; break; }
      if (!ws.length) fail('GN_XML', 'XML attributes require whitespace.');
      const am = /^[^\s=/>]+/.exec(xml.slice(offset));
      if (!am) fail('GN_XML', 'Invalid XML attribute.');
      const attributeName = am[0], aq = qname(attributeName);
      if (rawAttributes.some(a => a.name === attributeName)) fail('GN_XML', 'Duplicate XML attribute.');
      offset += attributeName.length;
      offset += /^\s*/.exec(xml.slice(offset))[0].length;
      if (xml[offset++] !== '=') fail('GN_XML', 'Missing XML attribute equals sign.');
      offset += /^\s*/.exec(xml.slice(offset))[0].length;
      const quote = xml[offset++];
      if (quote !== "'" && quote !== '"') fail('GN_XML', 'XML attributes must be quoted.');
      const end = xml.indexOf(quote, offset);
      if (end < 0 || xml.slice(offset, end).includes('<')) fail('GN_XML', 'Invalid XML attribute value.');
      const value = decodeEntities(xml.slice(offset, end).replace(/\r\n?/g, '\n').replace(/[\n\t]/g, ' '));
      rawAttributes.push({ name: attributeName, ...aq, value });
      offset = end + 1;
    }
    if (!closed) fail('GN_XML', 'Unclosed XML start tag.');
    const namespaces = Object.assign(Object.create(null), stack.at(-1)?.namespaces ?? { xml: XML_NS });
    for (const a of rawAttributes) {
      if (a.name !== 'xmlns' && a.prefix !== 'xmlns') continue;
      const prefix = a.name === 'xmlns' ? '' : a.localName;
      if (prefix === 'xmlns' || (prefix === 'xml' && a.value !== XML_NS) ||
        (prefix !== 'xml' && a.value === XML_NS) || a.value === XMLNS_NS || (prefix && !a.value))
        fail('GN_XML_NAMESPACE', 'Invalid namespace declaration.');
      namespaces[prefix] = a.value;
    }
    if (named.prefix && !namespaces[named.prefix]) fail('GN_XML_NAMESPACE', 'Undeclared element prefix.');
    const attributes = rawAttributes.map(a => {
      if (a.prefix && a.prefix !== 'xmlns' && !namespaces[a.prefix])
        fail('GN_XML_NAMESPACE', 'Undeclared attribute prefix.');
      return { ...a, namespaceURI: a.name === 'xmlns' || a.prefix === 'xmlns' ? XMLNS_NS :
        a.prefix ? namespaces[a.prefix] : '' };
    });
    const expanded = attributes.filter(a => a.namespaceURI !== XMLNS_NS).map(a => a.namespaceURI + '\0' + a.localName);
    if (new Set(expanded).size !== expanded.length) fail('GN_XML', 'Duplicate expanded XML attribute.');
    const node = { name, ...named, namespaceURI: namespaces[named.prefix] ?? '',
      attributes, namespaces, children: [], start, end: selfClosing ? offset : null };
    if (++count > maxNodes || stack.length + 1 > maxDepth) fail('GN_XML_LIMIT', 'Native XML exceeds structural limits.');
    if (stack.length) stack.at(-1).children.push(node);
    else if (root) fail('GN_XML', 'Multiple XML document elements.');
    else root = node;
    if (!selfClosing) stack.push(node);
  }
  if (!root || stack.length) fail('GN_XML', 'Incomplete XML document.');
  return { root, xml };
}
const children = (node, name) => (node?.children ?? []).filter(v => typeof v !== 'string' && (!name || v.localName === name));
const child = (node, name) => children(node, name)[0] ?? null;
const valueOf = node => node ? node.children.map(v => typeof v === 'string' ? v : valueOf(v)).join('') : '';
/** Direct element children, selected by local name; strings are excluded. */
export const xmlChildren = (node, localName) => children(node, localName);
/** First direct child with this local name, or null. */
export const xmlChild = (node, localName) => child(node, localName);
/** Concatenated descendant text, already decoded exactly once by parseXml. */
export const xmlText = node => valueOf(node);
const field = (node, name) => valueOf(child(node, name));
const attribute = (node, name) => node?.attributes.find(a => a.name === name)?.value ?? null;
const xmlBoolean = value => value === 'true' || value === 'y';
function safeXmlObject(node) {
  if (!node) return null;
  if (/^(?:account|password|apikey|authorization|cookie|token|stack|stacktrace)$/i.test(node.localName))
    return { redacted: true };
  if (/^(?:message|exceptionmessage)$/i.test(node.localName)) return { sha256: hash(valueOf(node)) };
  const items = children(node);
  if (!items.length && !node.attributes.some(a => a.namespaceURI !== XMLNS_NS)) return valueOf(node);
  const result = Object.create(null);
  for (const a of node.attributes) if (a.namespaceURI !== XMLNS_NS)
    result['@' + a.name] = /password|token|apikey|authorization|cookie/i.test(a.localName) ? '[redacted]' : a.value;
  for (const item of items) {
    const parsed = safeXmlObject(item), key = item.name;
    if (!own(result, key)) result[key] = parsed;
    else result[key] = Array.isArray(result[key]) ? [...result[key], parsed] : [result[key], parsed];
  }
  const direct = node.children.filter(v => typeof v === 'string').join('');
  if (direct.trim()) result['#text'] = direct;
  return result;
}
function nativeError(node, xml = '') {
  if (!node) return null;
  const safeToken = v => /^[A-Za-z0-9_.:-]{1,200}$/.test(v ?? '') ? v : null;
  return { present: true, element: node.localName,
    id: safeToken(attribute(node, 'id') ?? field(node, 'id')),
    code: safeToken(attribute(node, 'code') ?? field(node, 'code')),
    class: safeToken(attribute(node, 'class') ?? field(node, 'class')),
    messageSha256: hash(field(node, 'message') || valueOf(node)),
    xmlSha256: hash(xml ? xml.slice(node.start, node.end) : stable(safeXmlObject(node))) };
}
function nativeDocument(input, expected, options) {
  const parsed = parseXml(input, options);
  if (parsed.root.localName === 'error')
    fail('GN_NATIVE_ERROR', 'GeoNetwork returned a native error document.', { nativeError: nativeError(parsed.root, parsed.xml) });
  if (!expected.includes(parsed.root.localName)) fail('GN_NATIVE_SHAPE', 'Unexpected native XML document element.');
  return parsed;
}

export function parseHarvesterResponseXml(input, options) {
  const { root } = nativeDocument(input, ['response'], options);
  const ids = children(root, 'id');
  if (ids.length !== 1) fail('GN_NATIVE_SHAPE', 'Expected one native harvester result.');
  const nativeStatus = attribute(ids[0], 'status');
  if (nativeStatus !== null && !['ok', 'not-found', 'already-active', 'already-inactive', 'already-running', 'error'].includes(nativeStatus))
    fail('GN_NATIVE_SHAPE', 'Unknown native harvester status.');
  return { id: id(valueOf(ids[0]), 'Harvester ID'), nativeStatus };
}
// Canonicalize the whole native configuration, retaining private values only inside
// the digest. Only direct runtime info/error nodes are excluded from its identity.
function harvesterConfigurationTree(node, { root = false } = {}) {
  const elements = children(node);
  const attributes = node.attributes.filter(value => value.namespaceURI !== XMLNS_NS)
    .map(value => [value.namespaceURI ?? '', value.localName, value.value])
    .sort((left, right) => stable(left).localeCompare(stable(right)));
  const content = node.children.filter(value => {
    if (typeof value === 'string') return !elements.length || value.trim().length > 0;
    return !(root && value.namespaceURI === node.namespaceURI && ['info', 'error'].includes(value.localName));
  }).map(value => typeof value === 'string' ? value : harvesterConfigurationTree(value));
  return [node.namespaceURI ?? '', node.localName, attributes, content];
}
function parsedHarvester(node, xml) {
  const site = child(node, 'site'), options = child(node, 'options'), info = child(node, 'info');
  const content = child(node, 'content');
  const privileges = children(child(node, 'privileges'), 'group').map(group => ({
    groupId: String(integer(attribute(group, 'id'), 'Privilege group', -1)), operations: children(group, 'operation')
      .map(operation => token(attribute(operation, 'name'), 'Privilege operation')).sort(),
  })).sort((a, b) => Number(a.groupId) - Number(b.groupId));
  const config = {
    id: id(attribute(node, 'id'), 'Harvester ID'), type: attribute(node, 'type'),
    name: field(site, 'name'), uuid: field(site, 'uuid'),
    ownerId: field(child(node, 'ownerUser'), 'id') || field(child(node, 'owner'), 'id') || null,
    ownerGroupId: field(child(node, 'ownerGroup'), 'id') || null,
    sourceUrl: field(site, 'url'), loopElement: field(site, 'loopElement'),
    recordIdPath: field(site, 'recordIdPath'), transform: field(site, 'toISOConversion'),
    icon: field(site, 'icon'), numberOfRecordPath: field(site, 'numberOfRecordPath'),
    pageFromParam: field(site, 'pageFromParam'), pageSizeParam: field(site, 'pageSizeParam'),
    validation: field(content, 'validate'), privileges,
    status: field(options, 'status'), oneRunOnly: xmlBoolean(field(options, 'oneRunOnly')),
    scheduleEvery: field(options, 'every'), batchEdits: field(content, 'batchEdits'),
    translateContent: xmlBoolean(field(content, 'translateContent')),
    translateContentLangs: field(content, 'translateContentLangs'), translateContentFields: field(content, 'translateContentFields'),
    ifRecordExistAppendPrivileges: xmlBoolean(field(node, 'ifRecordExistAppendPrivileges')),
    categories: children(child(node, 'categories'), 'category').map(category => attribute(category, 'id') ?? valueOf(category)),
    searches: children(child(node, 'searches'), 'search').map(safeXmlObject),
    overrideUuid: field(options, 'overrideUuid') || field(options, 'overrideUUID'),
    sourceAuth: { configured: Boolean(field(site, 'apiKey') || xmlBoolean(field(child(site, 'account'), 'use'))),
      header: field(site, 'apiKeyHeader') || null },
  };
  return { ...config, configurationSha256: hash(stable(harvesterConfigurationTree(node, { root: true }))),
    configurationDigestVersion: 'native-node-v2',
    lastRun: field(info, 'lastRun') || null, running: xmlBoolean(field(info, 'running')),
    reindexing: xmlBoolean(field(info, 'reindexing')),
    result: safeXmlObject(child(info, 'result')), error: nativeError(child(node, 'error') ?? child(info, 'error'), xml) };
}
export function parseHarvestersXml(input, options) {
  const { root, xml } = nativeDocument(input, ['nodes', 'node'], options);
  const nodes = root.localName === 'node' ? [root] : children(root, 'node');
  return { nodes: nodes.map(node => parsedHarvester(node, xml)), visibility: 'caller' };
}
export function parseHistoryXml(input, options) {
  const { root, xml } = nativeDocument(input, ['response'], options);
  const history = child(root, 'harvesthistory');
  if (!history) fail('GN_NATIVE_SHAPE', 'Native history response lacks its harvesthistory collection.');
  const entries = children(history, 'record').map(record => {
    const info = child(record, 'info');
    const resultNode = child(info, 'result') ?? child(child(info, 'info'), 'result') ?? info;
    const error = child(info, 'error') ?? child(child(info, 'info'), 'error');
    return {
      id: id(field(record, 'id'), 'History ID'), date: field(record, 'harvestdate'),
      harvesterUuid: field(record, 'harvesteruuid'), name: field(record, 'harvestername'),
      type: field(record, 'harvestertype'), elapsedTime: field(record, 'elapsedtime'),
      deleted: xmlBoolean(field(record, 'deleted')),
      result: safeXmlObject(resultNode), error: nativeError(error, xml),
      raw: safeXmlObject(record), sha256: hash(xml.slice(record.start, record.end)),
    };
  });
  const page = integer(field(root, 'page'), 'History page');
  const size = integer(field(root, 'size'), 'History size', 1);
  const total = integer(field(root, 'total'), 'History total', 0, Number.MAX_SAFE_INTEGER);
  return { entries, page, size, total, pages: Math.ceil(total / size),
    reportedPages: integer(field(root, 'pages'), 'Native history pages') };
}
export function parseRecordXml(input, options) {
  const { root, xml } = parseXml(input, options);
  if (root.localName === 'error')
    fail('GN_NATIVE_ERROR', 'GeoNetwork returned a native error document.', { nativeError: nativeError(root, xml) });
  const infoNodes = children(root).filter(node => node.localName === 'info' && node.namespaceURI === GEONET_NS);
  if (infoNodes.length !== 1) fail('GN_NATIVE_SHAPE', 'Expected one database-backed geonet:info element.');
  const nativeInfo = infoNodes[0];
  const info = { id: field(nativeInfo, 'id'), uuid: field(nativeInfo, 'uuid'),
    schema: field(nativeInfo, 'schema'), source: field(nativeInfo, 'source'),
    isHarvested: xmlBoolean(field(nativeInfo, 'isHarvested')), ownerId: field(nativeInfo, 'ownerId') || null,
    ownerName: field(nativeInfo, 'ownername') || field(nativeInfo, 'ownerName') || null,
    groupOwnerName: field(nativeInfo, 'groupOwnerName') || null,
    changeDate: field(nativeInfo, 'changeDate'), createDate: field(nativeInfo, 'createDate'),
    edit: child(nativeInfo, 'edit') ? xmlBoolean(field(nativeInfo, 'edit')) : null,
    download: child(nativeInfo, 'download') ? xmlBoolean(field(nativeInfo, 'download')) : null,
    valid: field(nativeInfo, 'valid') || null,
    validationDetails: children(nativeInfo, 'valid_details').map(detail => ({
      type: field(detail, 'type'), status: child(detail, 'status')?.children.filter(v => typeof v === 'string').join('').trim() || null,
      ratio: field(child(detail, 'status'), 'ratio') || field(detail, 'ratio') || null,
      raw: safeXmlObject(detail),
    })),
    harvestInfo: safeXmlObject(child(nativeInfo, 'harvestInfo')), raw: safeXmlObject(nativeInfo) };
  if (!info.id || !info.uuid) fail('GN_NATIVE_SHAPE', 'Native record identity is missing.');
  const metadataXml = xml.slice(root.start, nativeInfo.start) + xml.slice(nativeInfo.end, root.end);
  return { uuid: info.uuid, rawXml: xml, metadataXml, metadataSha256: hash(metadataXml), info, ownerId: info.ownerId };
}

export function buildSimpleUrlXml(plan, { environment = process.env, operations = RESERVED_OPERATIONS, id: nodeId } = {}) {
  if (!plain(plan)) fail('GN_INPUT', 'A reviewed SimpleURL plan is required.');
  const nativeName = text(plan.nativeName, 'Harvester name', 1000);
  if (plan.marker !== undefined && !nativeName.includes(text(plan.marker, 'Operation marker', 200)))
    fail('GN_INPUT', 'The stable operation marker must be present in nativeName.');
  const sourceUrl = nativeUrl(plan.sourceUrl, 'Immutable source URL', true);
  const validation = plan.validation ?? 'NOVALIDATION';
  if (!VALIDATION_OPTIONS.includes(validation)) fail('GN_INPUT', 'Unknown native validation option.');
  const transform = plan.transform ?? STAC_TRANSFORM;
  if (transform !== STAC_TRANSFORM) fail('GN_INPUT', 'This operator selects the native STAC transform.');
  if ((plan.loopElement ?? '/collections') !== '/collections' || (plan.recordIdPath ?? '/id') !== '/id')
    fail('GN_INPUT', 'This operator requires one complete collections document and native /id selection.');
  const operationMap = new Map(operations.map(operation => [operation.name, integer(operation.id, 'Operation ID')]));
  const privilegeRows = plan.privileges ?? [];
  if (!Array.isArray(privilegeRows) || privilegeRows.length > 500) fail('GN_INPUT', 'Invalid harvester privileges.');
  const seenGroups = new Set();
  const privileges = privilegeRows.map(row => {
    if (!plain(row) || !Array.isArray(row.operations)) fail('GN_INPUT', 'Invalid harvester privilege row.');
    const groupId = String(integer(row.groupId, 'Privilege group', -1));
    if (seenGroups.has(groupId)) fail('GN_INPUT', 'Duplicate privilege group.');
    seenGroups.add(groupId);
    const names = [...new Set(row.operations.map(name => token(name, 'Privilege operation')))].sort();
    for (const name of names) {
      const operationId = operationMap.get(name);
      if (operationId === undefined || operationId === 2 || operationId === 4)
        fail('GN_INPUT', 'This operation is not allowed by the native harvester serializer.');
    }
    return '<group id="' + groupId + '">' + names.map(name => '<operation name="' + escapeXml(name) + '"/>').join('') + '</group>';
  }).join('');
  const sourceAuth = plan.sourceAuth;
  let apiKey = '', apiKeyHeader = '';
  if (sourceAuth !== undefined) {
    if (!plain(sourceAuth)) fail('GN_INPUT', 'Invalid source authentication references.');
    apiKeyHeader = text(sourceAuth.header, 'Source API key header', 128);
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(apiKeyHeader) ||
      /^(?:host|cookie|set-cookie|content-length|transfer-encoding|connection)$/i.test(apiKeyHeader))
      fail('GN_INPUT', 'Unsupported source authentication header.');
    apiKey = secret(environment, sourceAuth.apiKeyEnv, 'Source API key');
  }
  const element = (name, value = '') => '<' + name + '>' + escapeXml(value) + '</' + name + '>';
  return '<?xml version="1.0" encoding="UTF-8"?>\n<node' +
    (nodeId === undefined ? '' : ' id="' + id(nodeId, 'Harvester ID') + '"') + ' type="simpleurl">' +
    '<ownerGroup>' + element('id', id(plan.ownerGroupId, 'Owner group')) + '</ownerGroup>' +
    '<ownerUser>' + element('id', id(plan.ownerId, 'Owner user')) + '</ownerUser><site>' +
    element('name', nativeName) + element('url', sourceUrl.href) + element('icon', 'blank.png') +
    '<account><use>false</use><username/><password/></account>' +
    element('apiKeyHeader', apiKeyHeader) + element('apiKey', apiKey) +
    element('loopElement', '/collections') + '<numberOfRecordPath/>' + element('recordIdPath', '/id') +
    '<pageFromParam/><pageSizeParam/>' + element('toISOConversion', transform) +
    '</site><searches><search/></searches><options><oneRunOnly>true</oneRunOnly>' +
    '<overrideUuid>SKIP</overrideUuid><every>0 0 0 ? * *</every><status>inactive</status></options>' +
    '<content>' + element('validate', validation) + '<batchEdits>[]</batchEdits>' +
    '<translateContent>false</translateContent><translateContentLangs/><translateContentFields/></content>' +
    '<privileges>' + privileges + '</privileges><ifRecordExistAppendPrivileges>false</ifRecordExistAppendPrivileges>' +
    '<categories/></node>';
}

function normaliseConnection(connection) {
  if (!plain(connection)) fail('GN_INPUT', 'A native catalogue connection is required.');
  const base = nativeUrl(connection.baseUrl, 'Catalogue base URL', connection.allowHttp === true);
  if (base.search || /%(?:2f|5c|2e)/i.test(base.pathname) || /\/(?:\.{1,2})(?:\/|$)/.test(base.pathname))
    fail('GN_INPUT', 'Catalogue base URL must be a context path without query or encoded path separators.');
  base.pathname = base.pathname.replace(/\/+$/, '');
  const portal = token(connection.portal ?? 'srv', 'Portal');
  const language = token(connection.language ?? 'eng', 'Language');
  const auth = connection.auth ?? {};
  if (!plain(auth) || Object.keys(auth).some(key => !['usernameEnv', 'passwordEnv', 'cookieEnv', 'csrfEnv'].includes(key)))
    fail('GN_INPUT', 'Authentication accepts environment references only.');
  if (Boolean(auth.usernameEnv) !== Boolean(auth.passwordEnv))
    fail('GN_INPUT', 'Both Basic authentication environment references are required.');
  const expectedVersion = connection.expectedVersion === undefined || connection.expectedVersion === null ? null :
    text(connection.expectedVersion, 'Expected installed version', 160);
  return { baseUrl: base.href.replace(/\/$/, ''), contextPath: base.pathname.replace(/\/+$/, ''), base, portal, language, auth, expectedVersion,
    timeoutMs: integer(connection.timeoutMs ?? 30000, 'Request timeout', 100, 300000),
    maxResponseBytes: integer(connection.maxResponseBytes ?? 8 * MiB, 'Response limit', 1024, 64 * MiB),
    maxMefBytes: integer(connection.maxMefBytes ?? 64 * MiB, 'MEF limit', 1024, 512 * MiB) };
}
function makeCookies(base, initial) {
  const cookies = new Map();
  function put(name, value, path, secure, expires = null) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
      !/^[\x21-\x3A\x3C-\x7E]*$/.test(value) || name.length + value.length > 16384)
      fail('GN_COOKIE', 'Native cookie is malformed or too large.');
    if (!path.startsWith('/') || /[\r\n\0;]/.test(path)) fail('GN_COOKIE', 'Invalid native cookie path.');
    const key = name + '\0' + path;
    if (expires !== null && expires <= Date.now()) cookies.delete(key);
    else cookies.set(key, { name, value, path, secure, expires });
    if (cookies.size > 64) fail('GN_COOKIE', 'Too many native cookies.');
  }
  if (initial) for (const piece of initial.split(';')) {
    const at = piece.indexOf('=');
    if (at < 1) fail('GN_COOKIE', 'Cookie environment value must be a Cookie request header.');
    put(piece.slice(0, at).trim(), piece.slice(at + 1).trim(), base.pathname || '/', base.protocol === 'https:');
  }
  function eligible(url) {
    const now = Date.now();
    for (const [key, cookie] of cookies) if (cookie.expires !== null && cookie.expires <= now) cookies.delete(key);
    return [...cookies.values()].filter(cookie =>
      url.origin === base.origin && (!cookie.secure || url.protocol === 'https:') &&
      (url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : cookie.path + '/')))
      .sort((a, b) => b.path.length - a.path.length);
  }
  return {
    accept(headers, url) {
      const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() :
        (headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,\s]+=)/).filter(Boolean);
      for (const header of values) {
        const pieces = header.split(';'), first = pieces.shift(), at = first.indexOf('=');
        if (at < 1) fail('GN_COOKIE', 'Malformed native Set-Cookie.');
        const attrs = Object.create(null);
        for (const piece of pieces) {
          const cut = piece.indexOf('=');
          attrs[(cut < 0 ? piece : piece.slice(0, cut)).trim().toLowerCase()] =
            cut < 0 ? true : piece.slice(cut + 1).trim();
        }
        if (attrs.domain && String(attrs.domain).replace(/^\./, '').toLowerCase() !== base.hostname.toLowerCase())
          continue; // This client never expands a catalogue credential to a parent/other host.
        const path = typeof attrs.path === 'string' ? attrs.path : url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1) || '/';
        let expires = typeof attrs.expires === 'string' ? Date.parse(attrs.expires) : null;
        if (!Number.isFinite(expires)) expires = null;
        if (typeof attrs['max-age'] === 'string' && /^-?\d+$/.test(attrs['max-age']))
          expires = Date.now() + Number(attrs['max-age']) * 1000;
        put(first.slice(0, at).trim(), first.slice(at + 1).trim(), path, attrs.secure === true, expires);
      }
    },
    header(url) { return eligible(url).map(cookie => cookie.name + '=' + cookie.value).join('; '); },
    csrf(url) {
      const value = eligible(url).find(cookie => cookie.name === 'XSRF-TOKEN')?.value;
      if (!value) return null;
      try { return decodeURIComponent(value); } catch { fail('GN_COOKIE', 'Malformed CSRF cookie encoding.'); }
    },
    clear() { cookies.clear(); },
  };
}
function decodeUtf8(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('GN_RESPONSE_ENCODING', 'Native response is not valid UTF-8.'); }
}
function parseJson(bytes) {
  let value;
  try { value = JSON.parse(decodeUtf8(bytes).replace(/^\uFEFF/, '')); }
  catch (error) {
    if (error instanceof GeoNetworkError) throw error;
    fail('GN_NATIVE_SHAPE', 'Expected a native JSON response.');
  }
  const pending = [[value, 0]];
  let count = 0;
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (++count > 200000 || depth > 100) fail('GN_RESPONSE_LIMIT', 'Native JSON exceeds structural limits.');
    if (node !== null && typeof node === 'object')
      for (const item of Object.values(node)) pending.push([item, depth + 1]);
  }
  return value;
}
function retryAfter(headers) {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return { seconds: Math.min(Number(raw), 86400) };
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? { at: new Date(parsed).toISOString() } : null;
}
function statusError(status) {
  return ({ 401: 'GN_AUTHENTICATION', 403: 'GN_PERMISSION_OR_CSRF', 404: 'GN_NOT_FOUND',
    409: 'GN_NATIVE_CONFLICT', 429: 'GN_RATE_LIMIT' })[status] ?? 'GN_HTTP';
}
function nativeFailure(bytes) {
  if (!bytes.length) return null;
  try {
    const raw = decodeUtf8(bytes);
    if (raw.trimStart().startsWith('<')) {
      const { root } = parseXml(raw);
      return nativeError(root, raw);
    }
    const body = parseJson(bytes);
    if (plain(body)) {
      const safeToken = v => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(v) ? v : null;
      return { present: true, code: safeToken(body.code ?? body.error), type: safeToken(body.exception ?? body.type),
        messageSha256: hash(String(body.message ?? body.error ?? '')), bodySha256: hash(bytes) };
    }
  } catch {}
  return { present: true, bodySha256: hash(bytes) };
}
function sharingValue(value) {
  if (!plain(value) || !Array.isArray(value.privileges)) fail('GN_NATIVE_SHAPE', 'Invalid native sharing response.');
  const { owner, ...rest } = value;
  return { ...rest, callerUserId: owner === undefined ? null : String(owner) };
}
function sharingBody(value) {
  if (!plain(value) || typeof value.clear !== 'boolean' || !Array.isArray(value.privileges) || value.privileges.length > 500)
    fail('GN_INPUT', 'Sharing requires explicit clear and native privilege rows.');
  const groups = new Set();
  return { clear: value.clear, privileges: value.privileges.map(row => {
    if (!plain(row) || !plain(row.operations)) fail('GN_INPUT', 'Invalid native sharing row.');
    const group = integer(row.group, 'Sharing group', -1);
    if (groups.has(group)) fail('GN_INPUT', 'Duplicate sharing group.');
    groups.add(group);
    const operations = Object.fromEntries(Object.entries(row.operations).map(([name, enabled]) => {
      token(name, 'Sharing operation');
      if (typeof enabled !== 'boolean') fail('GN_INPUT', 'Sharing operation values must be boolean.');
      return [name, enabled];
    }));
    return { group, operations };
  }) };
}

/**
 * Every explicit call dispatches each native mutation at most once. Read-only
 * identity/CSRF discovery may precede a mutation. onExchange receives only
 * transport metadata and hashes, never credentials or native response bodies.
 */
export function createGeoNetworkClient(connection, {
  fetchImpl = globalThis.fetch, environment = process.env, signal, onExchange,
} = {}) {
  const cfg = normaliseConnection(connection);
  if (typeof fetchImpl !== 'function') fail('GN_INPUT', 'A Fetch implementation is required.');
  if (onExchange !== undefined && typeof onExchange !== 'function') fail('GN_INPUT', 'Invalid exchange observer.');
  const username = secret(environment, cfg.auth.usernameEnv, 'Catalogue username', true);
  const password = secret(environment, cfg.auth.passwordEnv, 'Catalogue password', true);
  if (username?.includes(':')) fail('GN_CREDENTIAL_UNAVAILABLE', 'Basic username must not contain a colon.');
  const initialCookie = secret(environment, cfg.auth.cookieEnv, 'Catalogue cookie', true);
  const csrfOverride = secret(environment, cfg.auth.csrfEnv, 'Catalogue CSRF token', true);
  const basic = username === null ? null : 'Basic ' + Buffer.from(username + ':' + password, 'utf8').toString('base64');
  const cookies = makeCookies(cfg.base, initialCookie);
  const active = new Set();
  let closed = false, identity = null, identifying = null;
  const rest = suffix => cfg.baseUrl + '/' + cfg.portal + '/api/' + suffix;
  const legacy = name => cfg.baseUrl + '/' + cfg.portal + '/' + cfg.language + '/admin.harvester.' + name;
  function urlFor(base, parameters) {
    const url = new URL(base);
    for (const [key, item] of Object.entries(parameters ?? {})) {
      if (item === undefined || item === null) continue;
      for (const value of Array.isArray(item) ? item : [item]) url.searchParams.append(key, String(value));
    }
    if (url.origin !== cfg.base.origin || !url.pathname.startsWith(cfg.contextPath + '/'))
      fail('GN_INPUT', 'Request escaped the selected catalogue context.');
    return url;
  }
  async function request(endpoint, url, {
    method = 'GET', body, kind = 'json', expected = [200], mutation = false,
    limit = cfg.maxResponseBytes, signal: callSignal, parse,
  } = {}) {
    if (closed) fail('GN_CLOSED', 'Native client is closed.');
    if (signal?.aborted || callSignal?.aborted) fail('GN_ABORTED', 'Native request was cancelled before dispatch.');
    const headers = new Headers({ Accept: kind === 'xml' ? 'application/xml' :
      kind === 'mef' ? 'application/x-gn-mef-2-zip' : 'application/json' });
    if (basic) headers.set('Authorization', basic);
    const cookie = cookies.header(url);
    if (cookie) headers.set('Cookie', cookie);
    const csrf = csrfOverride ?? cookies.csrf(url);
    if (csrf) headers.set('X-XSRF-TOKEN', csrf);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !csrf)
      fail('GN_CSRF_REQUIRED', 'Identify the native session or provide its CSRF environment reference before this request.');
    let requestBody;
    if (body !== undefined) {
      requestBody = typeof body === 'string' ? body : JSON.stringify(body);
      if (Buffer.byteLength(requestBody) > cfg.maxResponseBytes)
        fail('GN_INPUT_LIMIT', 'Native request exceeds its configured body limit.');
      headers.set('Content-Type', typeof body === 'string' ? 'application/xml; charset=UTF-8' : 'application/json');
    }
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(new Error('caller'));
    for (const candidate of [signal, callSignal]) candidate?.addEventListener('abort', abortFromCaller, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('timeout')); }, cfg.timeoutMs);
    active.add(controller);
    if (signal?.aborted || callSignal?.aborted) abortFromCaller();
    const startedAt = new Date().toISOString(), started = Date.now();
    let response = null, reader = null, responseBytes = 0, responseHash = null, attempted = false;
    let observedValue, failure = null;
    async function wait(promise) {
      if (controller.signal.aborted) throw new Error('aborted');
      let listener;
      try {
        return await Promise.race([promise, new Promise((_, reject) => {
          listener = () => reject(new Error('aborted'));
          controller.signal.addEventListener('abort', listener, { once: true });
        })]);
      } finally { controller.signal.removeEventListener('abort', listener); }
    }
    try {
      if (controller.signal.aborted) fail('GN_ABORTED', 'Native request was cancelled before dispatch.');
      attempted = true;
      const pending = Promise.resolve(fetchImpl(url.href, {
        method, headers, body: requestBody, redirect: 'manual', signal: controller.signal, cache: 'no-store',
      }));
      pending.then(late => { if (controller.signal.aborted) Promise.resolve(late?.body?.cancel()).catch(() => {}); }, () => {});
      response = await wait(pending);
      if (!response || !Number.isInteger(response.status) || !response.headers)
        fail('GN_NATIVE_SHAPE', 'Invalid native transport response.');
      if (response.url && new URL(response.url).origin !== cfg.base.origin)
        fail('GN_REDIRECT', 'Native transport returned a different origin.');
      cookies.accept(response.headers, url);
      const length = response.headers.get('content-length');
      if (length && /^\d+$/.test(length) && Number(length) > limit)
        fail('GN_RESPONSE_LIMIT', 'Native response exceeds its configured byte limit.');
      const chunks = [];
      if (response.body) {
        if (typeof response.body.getReader !== 'function') fail('GN_TRANSPORT', 'Native response requires a bounded readable body.');
        reader = response.body.getReader();
        for (;;) {
          const part = await wait(reader.read());
          if (part.done) break;
          if (!(part.value instanceof Uint8Array)) fail('GN_TRANSPORT', 'Invalid native body chunk.');
          responseBytes += part.value.byteLength;
          if (responseBytes > limit) fail('GN_RESPONSE_LIMIT', 'Native response exceeds its configured byte limit.');
          chunks.push(Buffer.from(part.value));
        }
      }
      const bytes = Buffer.concat(chunks, responseBytes);
      responseHash = hash(bytes);
      if (response.status >= 300 && response.status < 400)
        fail('GN_REDIRECT', 'Native redirect requires explicit connection/session review.');
      if (!expected.includes(response.status))
        fail(statusError(response.status), 'GeoNetwork returned HTTP ' + response.status + '.', {
          nativeError: nativeFailure(bytes), retryAfter: retryAfter(response.headers),
        });
      if (kind === 'empty') {
        if (bytes.length) fail('GN_NATIVE_SHAPE', 'Expected an empty native acknowledgement.');
        observedValue = null;
      } else if (parse) observedValue = parse(bytes, response);
      else if (kind === 'json') observedValue = parseJson(bytes);
      else if (kind === 'xml') observedValue = parseXml(bytes, { maxBytes: limit });
      else observedValue = bytes;
    } catch (error) {
      const code = controller.signal.aborted ? (timedOut ? 'GN_TIMEOUT' : 'GN_ABORTED') :
        error instanceof GeoNetworkError ? error.code : 'GN_TRANSPORT';
      failure = error instanceof GeoNetworkError ? error :
        new GeoNetworkError(code, code === 'GN_TIMEOUT' ? 'Native request timed out.' :
          code === 'GN_ABORTED' ? 'Native request was cancelled.' : 'Native transport failed.');
      if (controller.signal.aborted) failure.code = code;
      const explicitRejection = response && [401, 403, 404, 405, 413, 415, 429].includes(response.status) &&
        failure.code !== 'GN_RESPONSE_LIMIT' && failure.code !== 'GN_TIMEOUT' && failure.code !== 'GN_ABORTED';
      failure.status = response?.status ?? null;
      failure.mutation = mutation;
      failure.uncertain = Boolean(mutation && attempted && !explicitRejection);
    } finally {
      clearTimeout(timer);
      for (const candidate of [signal, callSignal]) candidate?.removeEventListener('abort', abortFromCaller);
      active.delete(controller);
      if (failure) {
        controller.abort();
        if (reader) Promise.resolve(reader.cancel()).catch(() => {});
        else if (response?.body) Promise.resolve(response.body.cancel()).catch(() => {});
      }
      try { reader?.releaseLock(); } catch {}
      if (closed) cookies.clear();
    }
    const exchange = Object.freeze({
      endpoint, method, path: url.pathname, requestQuerySha256: hash(url.search),
      requestBytes: requestBody === undefined ? 0 : Buffer.byteLength(requestBody),
      requestSha256: requestBody === undefined ? null : hash(requestBody),
      mutation, attempted, startedAt, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
      status: response?.status ?? null, responseBytes, responseSha256: responseHash,
      contentType: response?.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? null,
      code: failure?.code ?? null, uncertain: failure?.uncertain ?? false,
      retryAfter: response ? retryAfter(response.headers) : null,
    });
    if (failure) failure.exchange = exchange;
    if (onExchange) {
      try { await onExchange(exchange); }
      catch {
        if (!failure) failure = new GeoNetworkError('GN_EXCHANGE_SAVE_FAILED',
          'Native response was received but the exchange observer did not save it.', {
            status: exchange.status, mutation, uncertain: mutation && attempted, exchange,
          });
        else failure.exchangeObserverFailed = true;
      }
    }
    if (failure) throw failure;
    return { status: response.status, exchange, value: observedValue };
  }
  async function ensureIdentity(options = {}) {
    if (!identity) await client.identify(options);
    if (!identity.authenticated) fail('GN_AUTHENTICATION', 'An authenticated native catalogue session is required.');
    if (cfg.expectedVersion !== null && identity.versionMatches !== true)
      fail('GN_VERSION_MISMATCH', 'The installed native version differs from the reviewed connection.');
    return identity;
  }
  async function mutate(endpoint, url, options = {}) {
    await ensureIdentity({ signal: options.signal });
    return request(endpoint, url, { ...options, mutation: true });
  }
  const xmlOptions = { maxBytes: cfg.maxResponseBytes };
  const recordPath = (recordUuid, suffix = '') => rest('records/' + encodeURIComponent(uuid(recordUuid)) + suffix);
  const client = {
    async identify(options = {}) {
      if (identifying) return identifying;
      identifying = (async () => {
        const me = await request('identity.me', urlFor(rest('me')), {
          expected: [200, 204], signal: options.signal,
          parse: (bytes, response) => response.status === 204 ? null : parseJson(bytes),
        });
        if (!me.value) {
          identity = { authenticated: false, actor: null, groups: [], version: null, versionMatches: null,
            options: { operations: [], validationOptions: [], harvesterTypes: [], harvesterDiscovery: 'unauthenticated' } };
          return { ...me, value: identity };
        }
        if (!plain(me.value) || me.value.id === undefined || me.value.id === null || !me.value.profile)
          fail('GN_NATIVE_SHAPE', 'Invalid native identity response.', { exchange: me.exchange });
        const actor = { id: id(me.value.id, 'Actor ID'), username: String(me.value.username ?? ''),
          profile: String(me.value.profile), admin: me.value.admin === true };
        const groupMap = new Map();
        for (const role of ['RegisteredUser', 'Editor', 'Reviewer', 'UserAdmin']) {
          const rows = me.value['groupsWith' + role] ?? [];
          if (!Array.isArray(rows)) fail('GN_NATIVE_SHAPE', 'Invalid native actor groups.');
          for (const rawId of rows) {
            const groupId = String(integer(rawId, 'Actor group', -1));
            if (!groupMap.has(groupId)) groupMap.set(groupId, { id: groupId, profiles: [] });
            groupMap.get(groupId).profiles.push(role);
          }
        }
        const site = await request('identity.site', urlFor(rest('site/info')), { signal: options.signal });
        const sourceVersion = site.value?.version;
        if (!plain(sourceVersion) || typeof sourceVersion['app.version'] !== 'string')
          fail('GN_NATIVE_SHAPE', 'Native site information lacks its version map.', { exchange: site.exchange });
        const version = { appVersion: sourceVersion['app.version'], appSubVersion: sourceVersion['app.subVersion'] ?? null,
          gitCommit: sourceVersion['git.commit.id'] ?? sourceVersion['git.commit.id.abbrev'] ?? null };
        const operations = await request('identity.operations', urlFor(rest('operations')), { signal: options.signal });
        if (!Array.isArray(operations.value)) fail('GN_NATIVE_SHAPE', 'Invalid native operation catalogue.');
        const operationValues = operations.value.map(operation => ({
          id: integer(operation.id, 'Operation ID'), name: token(operation.name, 'Operation name'),
          harvesterAllowed: ![2, 4].includes(integer(operation.id, 'Operation ID')),
        }));
        let harvest = null, discovery = 'available', discoveryError = null;
        try {
          harvest = await request('identity.harvesters', urlFor(legacy('info'), { type: ['harvesterTypes', 'validation'] }), {
            kind: 'xml', signal: options.signal, parse: bytes => {
              const { root } = nativeDocument(bytes, ['root'], xmlOptions);
              return { harvesterTypes: children(child(root, 'types'), 'type').map(valueOf),
                validationOptions: children(child(root, 'validationOptions'), 'validation').map(valueOf) };
            },
          });
        } catch (error) {
          if (!(error instanceof GeoNetworkError) || ![403, 404].includes(error.status)) throw error;
          discovery = 'unavailable';
          discoveryError = { code: error.code, status: error.status, exchange: error.exchange };
        }
        identity = { authenticated: true, actor,
          groups: [...groupMap.values()].sort((a, b) => Number(a.id) - Number(b.id)), version,
          versionMatches: cfg.expectedVersion === null ? null : version.appVersion === cfg.expectedVersion,
          options: { operations: operationValues, validationOptions: harvest?.value.validationOptions ?? [],
            harvesterTypes: harvest?.value.harvesterTypes ?? [], harvesterDiscovery: discovery, discoveryError } };
        return { status: me.status, exchange: me.exchange,
          exchanges: [me.exchange, site.exchange, operations.exchange, ...(harvest ? [harvest.exchange] : [])], value: identity };
      })();
      try { return await identifying; } finally { identifying = null; }
    },
    async listHarvesters({ id: nodeId, signal: callSignal } = {}) {
      return request('harvester.list', urlFor(legacy('list'), {
        id: nodeId === undefined ? undefined : id(nodeId, 'Harvester ID'),
      }), { kind: 'xml', signal: callSignal, parse: bytes => parseHarvestersXml(bytes, xmlOptions) });
    },
    async addHarvester(plan, options = {}) {
      const current = await ensureIdentity(options);
      if (!current.options.harvesterTypes.includes('simpleurl'))
        fail('GN_HARVESTER_UNAVAILABLE', 'The selected native session has not exposed an enabled SimpleURL harvester.');
      const body = buildSimpleUrlXml(plan, { environment, operations: current.options.operations });
      return mutate('harvester.add', urlFor(legacy('add')), {
        method: 'POST', body, kind: 'xml', signal: options.signal,
        parse: bytes => ({ ...parseHarvesterResponseXml(bytes, xmlOptions), outcome: 'acknowledged', requiresReadback: true }),
      });
    },
    async updateHarvester(nodeId, plan, options = {}) {
      const current = await ensureIdentity(options);
      const expectedId = id(nodeId, 'Harvester ID');
      const body = buildSimpleUrlXml(plan, { environment, operations: current.options.operations, id: expectedId });
      return mutate('harvester.update', urlFor(legacy('update')), {
        method: 'POST', body, kind: 'xml', signal: options.signal, parse: bytes => {
          const result = parseHarvesterResponseXml(bytes, xmlOptions);
          if (result.id !== expectedId) fail('GN_NATIVE_IDENTITY', 'Harvester update acknowledged a different identifier.');
          return { ...result, outcome: 'acknowledged', requiresReadback: true };
        },
      });
    },
    async runHarvester(nodeId, options = {}) {
      return controlHarvester('run', nodeId, options);
    },
    async stopHarvester(nodeId, options = {}) {
      return controlHarvester('stop', nodeId, options);
    },
    async history({ id: nodeId, uuid: harvesterUuid, page = 0, size = 20, signal: callSignal } = {}) {
      return request('harvester.history', urlFor(legacy('history'), {
        id: id(nodeId, 'Harvester ID'), uuid: uuid(harvesterUuid),
        page: integer(page, 'History page'), size: integer(size, 'History size', 1, 500),
      }), { kind: 'xml', signal: callSignal, parse: bytes => parseHistoryXml(bytes, xmlOptions) });
    },
    async inventory({ harvesterUuid, uuids, from = 0, size = 200, signal: callSignal } = {}) {
      const clauses = [];
      if (harvesterUuid !== undefined) clauses.push({ term: { harvesterUuid: uuid(harvesterUuid) } });
      if (uuids !== undefined) clauses.push({ terms: { uuid: uuidList(uuids) } });
      if (!clauses.length) fail('GN_INPUT', 'Inventory requires a harvester UUID or the explicit record ledger.');
      from = integer(from, 'Inventory offset', 0, 100000000);
      size = integer(size, 'Inventory page size', 1, 500);
      await ensureIdentity({ signal: callSignal });
      return request('records.inventory', urlFor(rest('search/records/_search')), {
        method: 'POST', signal: callSignal, body: {
          from, size, track_total_hits: true, sort: [{ uuid: 'asc' }, { id: 'asc' }],
          _source: ['uuid', 'id', 'harvesterUuid', 'isHarvested', 'owner', 'groupOwner',
            'documentStandard', 'changeDate', 'draft', 'mdStatus', 'isPublishedToAll'],
          query: clauses.length === 1 ? clauses[0] : { bool: { should: clauses, minimum_should_match: 1 } },
        }, parse: bytes => {
          const response = parseJson(bytes);
          if (!Array.isArray(response?.hits?.hits)) fail('GN_NATIVE_SHAPE', 'Invalid native inventory response.');
          const reported = response.hits.total;
          const total = integer(plain(reported) ? reported.value : reported, 'Inventory total', 0, Number.MAX_SAFE_INTEGER);
          const totalRelation = plain(reported) ? reported.relation : 'eq';
          if (!['eq', 'gte'].includes(totalRelation)) fail('GN_NATIVE_SHAPE', 'Invalid inventory total relation.');
          const records = response.hits.hits.map(hit => {
            if (!plain(hit._source) || typeof hit._source.uuid !== 'string') fail('GN_NATIVE_SHAPE', 'Inventory record lacks its native UUID.');
            return { ...hit._source, indexId: hit._id ?? null };
          });
          const failedShards = integer(response._shards?.failed ?? 0, 'Failed search shards');
          const searchTimedOut = response.timed_out === true;
          const complete = !searchTimedOut && failedShards === 0 && totalRelation === 'eq' && from + records.length >= total;
          return { records, total, totalRelation, from, size, complete, failedShards, searchTimedOut,
            nextFrom: complete || records.length === 0 ? null : from + records.length, scope: 'caller-visible-index',
            incompleteReason: searchTimedOut ? 'native-search-timeout' : failedShards ? 'native-search-shard-failure' :
              !complete && records.length === 0 ? 'empty-page-before-total' : null };
        },
      });
    },
    async readRecord(recordUuid, { approved = true, includeSharing = true, signal: callSignal } = {}) {
      const selectedUuid = uuid(recordUuid);
      const response = await request('record.xml', urlFor(recordPath(selectedUuid, '/formatters/xml'), {
        withInfo: true, increasePopularity: false, addSchemaLocation: false, approved: flag(approved, true, 'Approved version'),
      }), { kind: 'xml', signal: callSignal, parse: bytes => {
        const value = parseRecordXml(bytes, xmlOptions);
        if (value.uuid !== selectedUuid) fail('GN_NATIVE_IDENTITY', 'Native XML belongs to a different record UUID.');
        return { ...value, approved };
      } });
      if (!flag(includeSharing, true, 'Include sharing')) return { ...response, value: { ...response.value, sharing: null } };
      const sharing = await client.readSharing(selectedUuid, { signal: callSignal });
      return { ...response, exchanges: [response.exchange, sharing.exchange],
        value: { ...response.value, sharing: sharing.value } };
    },
    async exportMef(recordUuids, { approved = true, withXLinksResolved = false,
      withXLinkAttribute = true, signal: callSignal } = {}) {
      const selected = uuidList(recordUuids);
      return request('records.mef', urlFor(rest('records/zip'), {
        uuids: selected, format: 'FULL', withRelated: false, includeAttachments: true,
        withXLinksResolved: flag(withXLinksResolved, false, 'Resolve XLinks'),
        withXLinkAttribute: flag(withXLinkAttribute, true, 'Preserve XLink attributes'),
        addSchemaLocation: false, approved: flag(approved, true, 'Approved version'),
      }), { kind: 'mef', limit: cfg.maxMefBytes, signal: callSignal, parse: (bytes, response) => {
        const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        if (!['application/zip', 'application/x-gn-mef-2-zip', 'application/octet-stream'].includes(type) ||
          bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4B ||
          !((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6)))
          fail('GN_NATIVE_SHAPE', 'Native MEF response is not a ZIP stream.');
        return { bytes, byteLength: bytes.length, sha256: hash(bytes), contentType: type,
          requestedUuids: selected, approved, fullAttachmentsRequested: true,
          archiveInventoryVerified: false };
      } });
    },
    async listAttachments(recordUuid, { approved = true, signal: callSignal } = {}) {
      const selectedUuid = uuid(recordUuid);
      return request('record.attachments', urlFor(recordPath(selectedUuid, '/attachments'), {
        sort: 'name', filter: '*', approved: flag(approved, true, 'Approved version'),
      }), { signal: callSignal, parse: bytes => {
        const attachments = parseJson(bytes);
        if (!Array.isArray(attachments)) fail('GN_NATIVE_SHAPE', 'Invalid native attachment list.');
        for (const attachment of attachments) {
          if (!plain(attachment) || typeof attachment.filename !== 'string' ||
            attachment.metadataUuid !== selectedUuid || !Number.isSafeInteger(attachment.size) || attachment.size < 0)
            fail('GN_NATIVE_SHAPE', 'Invalid native attachment identity or size.');
        }
        return { attachments, approved, filter: '*', visibility: 'caller', completePrivateInventory: false,
          checksumSemantics: 'Native descriptors contain no content checksum.' };
      } });
    },
    async readSharing(recordUuid, options = {}) {
      return request('record.sharing', urlFor(recordPath(recordUuid, '/sharing')), {
        signal: options.signal, parse: bytes => sharingValue(parseJson(bytes)),
      });
    },
    async writeSharing(recordUuid, value, options = {}) {
      return mutate('record.sharing.write', urlFor(recordPath(recordUuid, '/sharing')), {
        method: 'PUT', body: sharingBody(value), kind: 'empty', expected: [204], signal: options.signal,
      });
    },
    async validateRecord(recordUuid, options = {}) {
      return client.validateRecords([uuid(recordUuid)], options);
    },
    async validateRecords(recordUuids, { approved = true, signal: callSignal } = {}) {
      return mutate('records.validate', urlFor(rest('records/validate'), {
        uuids: uuidList(recordUuids), approved: flag(approved, true, 'Approved version'),
      }), { method: 'PUT', expected: [201], signal: callSignal });
    },
    async readValidation(recordUuid, { approved = true, signal: callSignal } = {}) {
      const response = await client.readRecord(recordUuid, { approved, includeSharing: false, signal: callSignal });
      return { ...response, value: { uuid: response.value.uuid, approved,
        metadataSha256: response.value.metadataSha256, changeDate: response.value.info.changeDate,
        valid: response.value.info.valid, details: response.value.info.validationDetails,
        hasRunIdentity: false, source: 'persisted-geonet-info' } };
    },
    async readWorkflow(recordUuid, { approved = true, signal: callSignal } = {}) {
      return request('record.workflow', urlFor(recordPath(recordUuid, '/status/workflow/last'), {
        approved: flag(approved, true, 'Approved version'),
      }), { signal: callSignal });
    },
    async submitRecords(recordUuids, { message = '', signal: callSignal } = {}) {
      return mutate('records.submit', urlFor(rest('records/submit')), {
        method: 'PUT', body: { uuids: uuidList(recordUuids), message: text(message, 'Workflow message', 16384, true) },
        signal: callSignal,
      });
    },
    async approveRecords(recordUuids, { message = '', directApproval = false, signal: callSignal } = {}) {
      return mutate('records.approve', urlFor(rest('records/approve')), {
        method: 'PUT', body: { uuids: uuidList(recordUuids), message: text(message, 'Workflow message', 16384, true),
          directApproval: flag(directApproval, false, 'Direct approval') }, signal: callSignal,
      });
    },
    async publicationOptions(options = {}) {
      return request('publication.options', urlFor(rest('records/sharing/options')), { signal: options.signal });
    },
    async publishRecord(recordUuid, { publicationType, signal: callSignal } = {}) {
      return mutate('record.publish', urlFor(recordPath(recordUuid, '/publish'), {
        publicationType: text(publicationType, 'Reviewed native publication type', 200),
      }), { method: 'PUT', kind: 'empty', expected: [204], signal: callSignal });
    },
    close() {
      closed = true;
      for (const controller of active) controller.abort(new Error('closed'));
      cookies.clear();
      identity = null;
    },
  };
  async function controlHarvester(action, nodeId, options) {
    const expectedId = id(nodeId, 'Harvester ID');
    return mutate('harvester.' + action, urlFor(legacy(action), { id: expectedId }), {
      kind: 'xml', signal: options.signal, parse: bytes => {
        const result = parseHarvesterResponseXml(bytes, xmlOptions);
        if (result.id !== expectedId || result.nativeStatus === null)
          fail('GN_NATIVE_IDENTITY', 'Native control result does not match the selected harvester.');
        return { ...result, accepted: result.nativeStatus === 'ok',
          outcome: result.nativeStatus === 'ok' ? 'accepted' : 'rejected', terminal: false };
      },
    });
  }
  return Object.freeze(client);
}
