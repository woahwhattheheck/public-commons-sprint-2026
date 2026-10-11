// MIT. Shared browser/Node HAR inventory and explicitly reviewed OpenAPI authoring.
export const HAR_SCHEMA = 'stellar.har-review.v1';
const own = (o, k) => Object.hasOwn(o, k);
const plain = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const denied = new Set(['__proto__', 'prototype', 'constructor']);
const METHODS = new Set(['GET', 'HEAD', 'DELETE', 'POST', 'PUT', 'PATCH']);
const wireHeaders = /^(accept(?:-.*)?|content-(?:type|length|encoding)|host|connection|user-agent|referer|origin|cache-control|pragma|if-.*|range|priority|upgrade-insecure-requests|sec-.*|te|trailer|transfer-encoding)$/i;
const sensitive = /authorization|cookie|token|secret|password|api[-_]?key|signature|credential|session/i;
const fail = m => { throw new TypeError(m); };
const clone = o => JSON.parse(JSON.stringify(o));
export function canonical(value) {
  return JSON.stringify(value, (_, v) => plain(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
}
function name(value, label = 'Name') {
  if (typeof value !== 'string' || !value || value.length > 512 || denied.has(value) || /[\x00-\x1f\x7f]/.test(value)) fail(`${label} is invalid`);
  return value;
}
function bounded(value, depth = 0, count = { n: 0 }) {
  if (++count.n > 100000 || depth > 32) fail('Document exceeds supported JSON complexity');
  if (typeof value === 'number' && !Number.isFinite(value)) fail('Non-finite number');
  if (Array.isArray(value)) value.forEach(v => bounded(v, depth + 1, count));
  else if (plain(value)) for (const [k, v] of Object.entries(value)) { name(k); bounded(v, depth + 1, count); }
}
function type(v) { return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isSafeInteger(v) ? 'integer' : 'number') : typeof v; }
// Samples are evidence of observed types only: never infer enums or required fields.
function shape(value, depth = 0) {
  if (depth > 20) fail('Observed JSON exceeds shape depth');
  const t = type(value), s = { type: t };
  if (t === 'object') {
    s.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [name(k), shape(v, depth + 1)]));
    s.additionalProperties = true;
  } else if (t === 'array') s.items = value.reduce((a, v) => mergeShape(a, shape(v, depth + 1)), null) || {};
  return s;
}
function mergeShape(a, b) {
  if (!a) return clone(b);
  if (!b) return clone(a);
  if (!a.type || !b.type) return {};
  if (canonical(a) === canonical(b)) return clone(a);
  const ts = [...new Set([...[a.type].flat(), ...[b.type].flat()])].sort();
  const out = { type: ts.length === 1 ? ts[0] : ts };
  if (ts.includes('object')) {
    out.properties = {};
    for (const k of new Set([...Object.keys(a.properties || {}), ...Object.keys(b.properties || {})])) {
      out.properties[k] = mergeShape(a.properties?.[k], b.properties?.[k]);
    }
    out.additionalProperties = true;
  }
  if (ts.includes('array')) out.items = mergeShape(a.items, b.items) || {};
  return out;
}
function mime(s) { return String(s || '').split(';')[0].trim().toLowerCase(); }
function jsonShape(text) {
  try { const v = JSON.parse(text); bounded(v); return { schema: shape(v), observed: true }; }
  catch { return { schema: null, observed: false, issue: 'Content is missing, incomplete, or not supported JSON' }; }
}
function bodyInfo(data, response = false) {
  if (!plain(data)) return { mimeType: '', schema: null, observed: false, issue: 'Body was not recorded' };
  const media = mime(data.mimeType);
  if (typeof data.text !== 'string') return { mimeType: media, schema: null, observed: false, issue: 'Body text was not recorded' };
  let text = data.text;
  if (response && data.encoding) {
    if (data.encoding !== 'base64') return { mimeType: media, schema: null, observed: false, issue: 'Unsupported HAR content encoding' };
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))
      return { mimeType: media, schema: null, observed: false, issue: 'Malformed base64 response content' };
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(text), c => c.charCodeAt(0))); }
    catch { return { mimeType: media, schema: null, observed: false, issue: 'Response is not UTF-8 text' }; }
  }
  if (/^application\/(?:[^;]+\+)?json$/.test(media)) return { mimeType: media, ...jsonShape(text) };
  return { mimeType: media, schema: null, observed: false, issue: 'Author the body contract explicitly for this media type' };
}
function names(list, label, lower = false) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) fail(`${label} must be an array`);
  return list.map(p => name(lower ? String(p?.name ?? '').toLowerCase() : p?.name, label));
}
export function inspectHar(har, sourceSha256) {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) fail('Original source SHA256 is required');
  if (!plain(har?.log) || har.log.version !== '1.2' || !Array.isArray(har.log.entries)) fail('Expected a HAR 1.2 log.entries array');
  if (har.log.entries.length > 100000) fail('HAR exceeds 100,000 entries; split at capture boundaries');
  const groups = new Map(), rejected = [];
  har.log.entries.forEach((entry, index) => {
    const id = `entry-${index + 1}`;
    try {
      const request = entry.request;
      if (!plain(request) || !plain(entry.response)) fail('Missing request or response');
      let u;
      try { u = new URL(request.url); } catch { fail('Invalid request URL'); }
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.hash) fail('Unsupported URL protocol, userinfo or fragment');
      const method = String(request.method || '').toUpperCase();
      if (!METHODS.has(method)) fail('Method is outside the original merchant compiler');
      const qs = [...u.searchParams.keys()]; qs.forEach(k => name(k, 'Query name'));
      const recorded = names(request.queryString, 'Recorded query name');
      if (recorded.length && canonical([...recorded].sort()) !== canonical([...qs].sort())) fail('URL and HAR query-name occurrences disagree');
      const hs = names(request.headers, 'Header name', true), cookies = names(request.cookies, 'Cookie name');
      const credentials = new Map();
      for (const k of hs) if (sensitive.test(k) && k !== 'cookie') credentials.set(`header:${k}`, { in: 'header', name: k });
      for (const k of cookies) credentials.set(`cookie:${k}`, { in: 'cookie', name: k });
      if (hs.includes('cookie') && !cookies.length) credentials.set('header:cookie', { in: 'header', name: 'cookie' });
      for (const k of qs) if (sensitive.test(k)) credentials.set(`query:${k}`, { in: 'query', name: k });
      const additionalHeaders = [...new Set(hs.filter(k => !wireHeaders.test(k) && !sensitive.test(k)))].sort();
      const status = entry.response.status;
      if (!Number.isInteger(status) || status < 0 || status > 599) fail('Invalid response status');
      const key = `${method} ${u.origin}${u.pathname}`;
      if (!groups.has(key)) groups.set(key, {
        id: `group-${groups.size + 1}`, method, origin: u.origin, path: u.pathname, entryIds: [],
        query: {}, credentials: {}, headers: [], requestBodies: [], responses: {},
      });
      const group = groups.get(key); group.entryIds.push(id);
      for (const k of new Set(qs)) {
        group.query[k] ??= { name: k, observations: 0, repeated: false, sensitive: sensitive.test(k) };
        group.query[k].observations++; group.query[k].repeated ||= qs.filter(x => x === k).length > 1;
      }
      for (const [k, v] of credentials) group.credentials[k] = v;
      group.headers = [...new Set([...group.headers, ...additionalHeaders])].sort();
      if (request.postData !== undefined) group.requestBodies.push(bodyInfo(request.postData));
      else group.requestBodies.push({ mimeType: '', observed: false, schema: null, issue: 'Body was not recorded' });
      const info = bodyInfo(entry.response.content, true), rk = `${status}:${info.mimeType}`;
      if (!own(group.responses, rk)) group.responses[rk] = { status, mimeType: info.mimeType, observations: 0, observedBodies: 0, schema: null, issues: [] };
      const result = group.responses[rk]; result.observations++;
      if (info.observed) { result.observedBodies++; result.schema = mergeShape(result.schema, info.schema); }
      if (info.issue && !result.issues.includes(info.issue)) result.issues.push(info.issue);
    } catch (error) { rejected.push({ entryId: id, issue: error.message }); }
  });
  return { schema: 'stellar.har-inventory.v1', sourceSha256, totalEntries: har.log.entries.length,
    groups: [...groups.values()].map(g => {
      const types = [...new Set(g.requestBodies.filter(b => b.mimeType).map(b => b.mimeType))];
      const observed = g.requestBodies.filter(b => b.observed);
      return { ...g, query: Object.values(g.query), credentials: Object.values(g.credentials),
        requestBodies: undefined, requestBody: { mimeTypes: types, observations: observed.length, total: g.entryIds.length,
          schema: observed.reduce((a, b) => mergeShape(a, b.schema), null),
          issues: [...new Set(g.requestBodies.map(b => b.issue).filter(Boolean))] }, responses: Object.values(g.responses) };
    }), rejected };
}
export function newReview(inventory) {
  return { schema: HAR_SCHEMA, sourceSha256: inventory.sourceSha256, sourceUrl: '', title: 'Reviewed captured API', version: '1.0.0',
    operations: inventory.groups.map(g => ({ id: `har_${g.id.replace('-', '_')}`, groups: [g.id], enabled: false, reviewed: false,
      path: '', pathExamples: {}, description: '', query: Object.fromEntries(g.query.map(q => [q.name,
        { mode: 'unresolved', required: false, example: 'example' }])),
      credentials: Object.fromEntries(g.credentials.map(c => [`${c.in}:${c.name}`, { mode: 'unresolved', reference: '', reason: '' }])),
      headers: Object.fromEntries(g.headers.map(h => [h, { mode: 'unresolved', reason: '', reference: '' }])),
      body: { mode: g.requestBody.schema ? 'observed' : 'unresolved', required: false },
      responses: { mode: 'observed' },
    })) };
}
function reason(d, label) { if (typeof d.reason !== 'string' || !d.reason.trim()) fail(`${label}: explain the omission`); }
function reference(d, label) { if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(d.reference || '')) fail(`${label}: a server-held credential/configuration reference is required`); }
function safeSchema(s, label) { if (!plain(s)) fail(`${label}: supply an object schema`); bounded(s); return clone(s); }
function example(schema, value, label) {
  const t = schema.type;
  if (!['string', 'integer', 'number', 'boolean'].includes(t)) fail(`${label}: original importer needs a scalar schema`);
  if (!(t === 'integer' ? Number.isSafeInteger(value) : t === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === t))
    fail(`${label}: safe example does not match its type`);
  return clone(value);
}
function combine(gs) {
  const first = gs[0];
  if (gs.some(g => g.method !== first.method || g.origin !== first.origin)) fail('One operation may combine only the same method and origin');
  const query = new Map(), credentials = new Map(), headers = new Set(), responses = new Map();
  let schema = null; const media = new Set();
  for (const g of gs) {
    for (const q of g.query) { const old = query.get(q.name); query.set(q.name, { ...q, repeated: q.repeated || old?.repeated }); }
    for (const c of g.credentials) credentials.set(`${c.in}:${c.name}`, c);
    g.headers.forEach(h => headers.add(h)); g.requestBody.mimeTypes.forEach(m => media.add(m));
    schema = mergeShape(schema, g.requestBody.schema);
    for (const r of g.responses) {
      const k = `${r.status}:${r.mimeType}`, old = responses.get(k);
      responses.set(k, { ...r, schema: mergeShape(old?.schema, r.schema), observations: (old?.observations || 0) + r.observations,
        observedBodies: (old?.observedBodies || 0) + r.observedBodies });
    }
  }
  return { ...first, query: [...query.values()], credentials: [...credentials.values()], headers: [...headers],
    requestBody: { schema, mimeTypes: [...media] }, responses: [...responses.values()] };
}
export function buildDocument(inventory, review) {
  bounded(review);
  if (review.schema !== HAR_SCHEMA || review.sourceSha256 !== inventory.sourceSha256) fail('Review belongs to another HAR source');
  let server;
  try { server = new URL(review.sourceUrl); } catch { fail('Supply the original API source server URL'); }
  if (!['https:', 'http:'].includes(server.protocol) || server.username || server.password || server.search || server.hash || server.href !== review.sourceUrl || server.pathname !== '/')
    fail('Source URL must be a canonical HTTP(S) origin ending in /, without credentials, query or fragment');
  name(review.title, 'Title'); name(review.version, 'Version');
  if (!Array.isArray(review.operations)) fail('Review operations must be an array');
  const selected = review.operations.filter(o => o.enabled);
  if (!selected.length || selected.length > 100) fail('Explicitly select 1–100 operations');
  const doc = { openapi: '3.1.0', info: { title: review.title, version: review.version,
    description: 'Operator-reviewed contract derived from captured observations. Observed shapes are not an authoritative provider specification.' },
    servers: [{ url: server.href }], paths: {}, components: { securitySchemes: {} },
    'x-starforge-har': { schema: 'stellar.har-source.v1', sourceSha256: inventory.sourceSha256, selectedEntryIds: [] } };
  const byId = new Map(inventory.groups.map(g => [g.id, g])), used = new Set(), ids = new Set();
  for (const op of selected) {
    if (op.reviewed !== true) fail(`${op.id}: explicitly acknowledge the route, examples and captured-header review`);
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(op.id) || ids.has(op.id)) fail('Operation IDs must be unique portable identifiers'); ids.add(op.id);
    if (!Array.isArray(op.groups) || !op.groups.length) fail(`${op.id}: select source groups`);
    const gs = op.groups.map(id => { if (used.has(id) || !byId.has(id)) fail(`Source group missing or reused: ${id}`); used.add(id); return byId.get(id); });
    const g = combine(gs), method = g.method.toLowerCase(), path = op.path;
    if (g.origin !== server.origin) fail(`${op.id}: selected capture origin does not match the reviewed source server`);
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[?#\\\s]/.test(path)) fail(`${op.id}: author a merchant route path`);
    const names = [...path.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(m => m[1]);
    if (/[{}]/.test(path.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '')) || new Set(names).size !== names.length) fail(`${op.id}: invalid path placeholders`);
    const pathPattern = new RegExp('^' + path.split(/(\{[A-Za-z_][A-Za-z0-9_]*\})/).map(p => p.startsWith('{') ? '[^/]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$');
    if (gs.some(x => !pathPattern.test(x.path))) fail(`${op.id}: path template must match every selected observed path`);
    doc.paths[path] ??= {};
    if (doc.paths[path][method]) fail(`${op.id}: duplicate method/path`);
    const out = { operationId: op.id, summary: String(op.description || op.id), parameters: [], responses: {},
      'x-har-observation': { sourceOrigin: g.origin, sourceGroups: gs.map(x => x.id), entryIds: gs.flatMap(x => x.entryIds),
        schemaAuthority: 'observed-shape', requestBodyObservations: gs.map(x => ({ group: x.id, observed: x.requestBody.observations, total: x.requestBody.total })),
        responseObservations: g.responses.map(r => ({ status: r.status, mimeType: r.mimeType, responses: r.observations, recordedJsonBodies: r.observedBodies })),
        backendBindings: [], omitted: [] } };
    for (const p of names) {
      const e = op.pathExamples?.[p];
      if (typeof e !== 'string' || !e || ['.', '..'].includes(e)) fail(`${op.id}: provide a safe string example for path ${p}`);
      out.parameters.push({ in: 'path', name: p, required: true, schema: { type: 'string' }, example: e });
    }
    const credentialQuery = new Set(g.credentials.filter(c => c.in === 'query').map(c => c.name));
    for (const q of g.query) {
      if (credentialQuery.has(q.name)) continue;
      const d = op.query?.[q.name];
      if (d?.mode === 'parameter') {
        if (q.repeated) fail(`${op.id}: repeated query ${q.name} requires explicit backend handling or another integration`);
        const s = d.schema ? safeSchema(d.schema, q.name) : { type: 'string' };
        out.parameters.push({ in: 'query', name: q.name, required: d.required === true, schema: s, example: example(s, d.example, q.name) });
      } else if (d?.mode === 'backend') fail(`${op.id}: fixed backend query values are not supported by the original merchant; preserve a public parameter or document an omission`);
      else if (d?.mode === 'omit') { reason(d, q.name); out['x-har-observation'].omitted.push({ in: 'query', name: q.name, reason: d.reason }); }
      else fail(`${op.id}: decide query parameter ${q.name}`);
    }
    const security = {};
    for (const c of g.credentials) {
      const key = `${c.in}:${c.name}`, d = op.credentials?.[key];
      if (d?.mode === 'preserve' || d?.mode === 'backend') {
        if (d.mode === 'backend') {
          if (c.in !== 'header') fail(`${op.id}: original backend credential binding supports headers; preserve the query/cookie security for manual integration or document an omission`);
          reference(d, key); out['x-har-observation'].backendBindings.push({ ...c, reference: d.reference, credential: true });
        }
        const id = `capture_auth_${Object.keys(doc.components.securitySchemes).length + 1}`;
        doc.components.securitySchemes[id] = { type: 'apiKey', in: c.in, name: c.name, description: 'Observed credential location; scheme and access must be confirmed against the provider contract.' }; security[id] = [];
      }
      else if (d?.mode === 'parameter' && c.in === 'query') {
        reason(d, key);
        if (g.query.find(q => q.name === c.name)?.repeated) fail(`${op.id}: repeated query ${c.name} requires another integration`);
        const schema = d.schema ? safeSchema(d.schema, key) : { type: 'string' };
        out.parameters.push({ in: 'query', name: c.name, required: d.required === true, schema, example: example(schema, d.example, key),
          'x-har-credential-name-reviewed': d.reason });
      }
      else if (d?.mode === 'omit') { reason(d, key); out['x-har-observation'].omitted.push({ ...c, reason: d.reason }); }
      else fail(`${op.id}: resolve captured credential ${key}`);
    }
    if (Object.keys(security).length) out.security = [security];
    for (const h of g.headers) {
      const d = op.headers?.[h];
      if (d?.mode === 'backend') { reference(d, h); out['x-har-observation'].backendBindings.push({ in: 'header', name: h, reference: d.reference }); }
      else if (d?.mode === 'omit') { reason(d, h); out['x-har-observation'].omitted.push({ in: 'header', name: h, reason: d.reason }); }
      else fail(`${op.id}: decide custom header ${h}`);
    }
    if (['POST', 'PUT', 'PATCH'].includes(g.method)) {
      const d = op.body || {};
      const s = d.mode === 'author' ? safeSchema(d.schema, 'Request body') : d.mode === 'observed' ? g.requestBody.schema : null;
      if (!s || (d.mode === 'observed' && (g.requestBody.mimeTypes.length !== 1 || !/^application\/(?:[^;]+\+)?json$/.test(g.requestBody.mimeTypes[0]))))
        fail(`${op.id}: author a request-body schema when complete JSON observations are unavailable or media types differ`);
      const media = d.mimeType || g.requestBody.mimeTypes[0] || 'application/json';
      if (!/^application\/(?:[^;]+\+)?json$/.test(media)) fail(`${op.id}: this intake supports JSON request bodies; use original manual importer for other media`);
      // No captured body examples are copied. Operator-authored examples are explicit.
      const content = { schema: s }; if (own(d, 'example')) { bounded(d.example); content.example = clone(d.example); }
      out.requestBody = { required: d.required === true, content: { [media]: content } };
    } else if (g.requestBody.mimeTypes.length) fail(`${op.id}: bodies on this query method require manual integration`);
    if (op.responses?.mode === 'author') {
      out.responses = safeSchema(op.responses.value, 'Responses');
      if (!Object.keys(out.responses).length) fail(`${op.id}: at least one response is required`);
    } else if (op.responses?.mode === 'observed') {
      for (const r of g.responses) {
        if (r.status < 100) continue;
        const status = String(r.status);
        out.responses[status] ??= { description: `Observed HTTP ${status}`, 'x-har-observed-count': 0 };
        const target = out.responses[status]; target['x-har-observed-count'] += r.observations;
        if (r.schema && r.mimeType && !['204', '205', '304'].includes(status) && method !== 'head') {
          target.content ??= {}; target.content[r.mimeType] = { schema: r.schema, 'x-har-observed-body-count': r.observedBodies };
        }
      }
      if (!Object.keys(out.responses).length) fail(`${op.id}: captured requests have no completed HTTP response; author the contract`);
    } else fail(`${op.id}: choose observed or authored responses`);
    doc.paths[path][method] = out;
    doc['x-starforge-har'].selectedEntryIds.push(...out['x-har-observation'].entryIds);
  }
  if (!Object.keys(doc.components.securitySchemes).length) delete doc.components;
  bounded(doc);
  return doc;
}
