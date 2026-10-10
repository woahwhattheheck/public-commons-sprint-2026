// MIT. x402 v2 Bazaar discovery-core prototype: no settlement or external registrations.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const printable = (v) => typeof v === 'string' && v.length > 0 && v.length <= 32 && /^[\x20-\x7E]+$/.test(v);
const terms = (s) => [...new Set(String(s ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [])];
const ALLOWED = new Set(['type','payTo','network','scheme','extensions']);

export function isValidRouteTemplate(template) {
  if (typeof template !== 'string' || !/^\/[a-zA-Z0-9_/:.\-~%]+$/.test(template)) return false;
  let decoded;
  try { decoded = decodeURIComponent(template); } catch { return false; }
  return !decoded.includes('..') && !decoded.includes('://');
}

export function sanitizeResourceServiceMetadata(resource) {
  const result = { ...resource };
  if (!printable(result.serviceName)) delete result.serviceName;
  if (!Array.isArray(result.tags)) delete result.tags;
  else {
    const seen = new Set();
    result.tags = result.tags.filter(t => {
      if (!printable(t) || seen.has(t.toLowerCase())) return false;
      seen.add(t.toLowerCase());
      return seen.size <= 5;
    }).slice(0, 5);
  }
  if (typeof result.iconUrl === 'string') {
    try {
      if (result.iconUrl.length > 2048 || /[\x00-\x1f\x7f]/.test(result.iconUrl)) throw Error('invalid');
      const u = new URL(result.iconUrl);
      const h = decodeURIComponent(u.hostname).toLowerCase().replace(/\.$/,'');
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || isIP(h) ||
          ['localhost','localhost.localdomain','ip6-localhost','ip6-loopback'].includes(h) ||
          /^\d+$/.test(h) || /^0x[0-9a-f]+$/.test(h)) throw Error('invalid');
    } catch { delete result.iconUrl; }
  } else delete result.iconUrl;
  return result;
}

function filtersFrom(params) {
  const f = {};
  for (const k of ALLOWED) {
    const v = params.get(k);
    if (v !== null) f[k] = v;
  }
  return f;
}
function matches(row, filters) {
  for (const [k,v] of Object.entries(filters)) {
    if (k === 'type' && row.extensions?.bazaar?.info?.input?.type !== v) return false;
    else if (k === 'extensions' && !Object.hasOwn(row.extensions, v)) return false;
    else if (['payTo','network','scheme'].includes(k) && !row.accepts.some(a => a[k] === v)) return false;
  }
  return true;
}
function keyOf(entry) {
  const info = entry.extensions?.bazaar?.info?.input;
  if (!plain(info) || !['http','mcp'].includes(info.type)) throw new TypeError('Valid HTTP or MCP Bazaar info required');
  const url = new URL(entry.resource?.url);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Invalid resource URL');
  if (info.type === 'mcp') {
    if (typeof info.toolName !== 'string' || !info.toolName.trim() || !plain(info.inputSchema)) throw new TypeError('Invalid MCP tool');
    return ['mcp',url.href,info.toolName].join('|');
  }
  if (!['GET','HEAD','DELETE','POST','PUT','PATCH'].includes(info.method)) throw new TypeError('Invalid HTTP method');
  // Different concrete path parameter values collapse to the same canonical entry.
  const template = entry.extensions.bazaar.routeTemplate;
  const path = isValidRouteTemplate(template) ? template : url.pathname;
  return ['http',url.origin,path,url.search,info.method].join('|');
}
function searchScore(row, q) {
  const t = terms(q); if (!t.length) return 0;
  const resource = row.resource;
  const input = row.extensions.bazaar.info.input;
  const weighted = [[resource.serviceName,8],[resource.tags?.join(' '),7],[resource.description,4],
    [input.description,5],[input.toolName,5],[resource.url,1]];
  let score = 0;
  for (const term of t) for (const [part,weight] of weighted) {
    if (terms(part).includes(term)) score += weight;
  }
  if (String(resource.description ?? '').toLowerCase().includes(q.toLowerCase())) score += 6;
  return score;
}
const signature = (query, filters) => createHash('sha256').update(JSON.stringify([query, filters])).digest('hex').slice(0,20);
const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const decode = (str) => { try {return JSON.parse(Buffer.from(str, 'base64url').toString());} catch {throw new RangeError('Invalid cursor');}};
const asInteger = (v, fallback, max) => {
  if (v === null) return fallback;
  if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) > max) throw new RangeError('Invalid pagination parameter');
  return Number(v);
};

export class BazaarCatalog {
  #entries = new Map(); #version = 0;
  // Call only from a trusted post-verification facilitator hook AFTER checking the
  // settlement, seller/recipient binding, and JSON Schema Draft 2020-12. NEVER
  // route this method directly to an unauthenticated HTTP client or payment payload.
  insertValidated(entry) {
    if (!plain(entry?.resource) || !Array.isArray(entry.accepts) || entry.accepts.length === 0 ||
        !plain(entry.extensions?.bazaar) || !plain(entry.extensions.bazaar.info) ||
        !plain(entry.extensions.bazaar.schema)) throw new TypeError('Missing validated Bazaar envelope');
    if (entry.accepts.some(a => !plain(a) || typeof a.network !== 'string' || typeof a.scheme !== 'string' || typeof a.payTo !== 'string')) throw new TypeError('Invalid payment terms');
    const id = keyOf(entry);
    const sanitized = structuredClone(entry);
    sanitized.resource = sanitizeResourceServiceMetadata(sanitized.resource);
    if (!isValidRouteTemplate(sanitized.extensions.bazaar.routeTemplate)) delete sanitized.extensions.bazaar.routeTemplate;
    this.#entries.set(id, sanitized); this.#version++;
    return id;
  }
  list(params = new URLSearchParams()) {
    const filters = filtersFrom(params);
    const offset = asInteger(params.get('offset'),0,1_000_000);
    const limit = asInteger(params.get('limit'),20,100);
    const all = [...this.#entries.values()].filter(row => matches(row, filters));
    return { resources: all.slice(offset,offset+limit),pagination:{offset,limit,total:all.length} };
  }
  search(params = new URLSearchParams()) {
    const q = params.get('query');
    if (typeof q !== 'string' || !q.trim() || q.length > 1024) throw new RangeError('query is required (max 1024 chars)');
    const filters = filtersFrom(params);
    const limit = asInteger(params.get('limit'),20,100);
    const digest = signature(q, filters);
    let at = 0;
    if (params.has('cursor')) {
      const c = decode(params.get('cursor'));
      if (c?.v !== this.#version || c?.h !== digest || !Number.isSafeInteger(c.at) || c.at < 0) throw new RangeError('Stale or invalid cursor');
      at = c.at;
    }
    const ranked = [...this.#entries.entries()].map(([key,row]) => ({key,row,score:searchScore(row,q)}))
      .filter(e => e.score > 0 && matches(e.row,filters))
      .sort((a,b) => b.score - a.score || a.key.localeCompare(b.key));
    const page = ranked.slice(at,at+limit).map(e => e.row);
    const next = at+limit < ranked.length ? encode({v:this.#version,h:digest,at:at+limit}) : null;
    return { resources:page,partialResults:next !== null,pagination:{limit:page.length,cursor:next} };
  }
  get size() {return this.#entries.size;}
}

export function createDiscoveryServer(catalog) {
  // Read-only HTTP API. No endpoint permits client-injected catalog records.
  return async function handler(req,res) {
    try {
      const u = new URL(req.url,'http://localhost');
      if (req.method !== 'GET') {res.writeHead(405,{'content-type':'application/json'});res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED',reason:'GET only'}));return;}
      const data = u.pathname === '/discovery/resources' ? catalog.list(u.searchParams)
        : u.pathname === '/discovery/search' ? catalog.search(u.searchParams) : null;
      if (!data) {res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:'NOT_FOUND',reason:'Unknown endpoint'}));return;}
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify(data));
    } catch(e) {
      const code = e instanceof RangeError ? 400 : 500;
      res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({error:code===400?'INVALID_REQUEST':'INTERNAL_ERROR',reason:code===400?e.message:'Internal error'}));
    }
  };
}
