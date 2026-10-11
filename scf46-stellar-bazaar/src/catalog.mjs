// MIT. x402 v2 Bazaar discovery-core prototype: no settlement or external registrations.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { inspectResourceURL, inspectRouteTemplate } from '../../stellar-forge/route-identity/identity.mjs';
import { CatalogQueryIndex } from './query-index.mjs';
import { sanitizeBazaarPricing, parseAtomicBudget, describeCatalogPricing } from './pricing.mjs';

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const printable = (v) => typeof v === 'string' && v.length > 0 && v.length <= 32 && /^[\x20-\x7E]+$/.test(v);
const ALLOWED = new Set(['type','payTo','network','scheme','asset','extensions']);
// SF28 identity grammar also prevents pipe-delimited MCP catalog key aliasing.
const MCP_TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

export function isValidRouteTemplate(template) {
  // Reuse SF28 multi-decode path validation at the actual catalog boundary.
  return inspectRouteTemplate(template).ok;
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
      // Discovery consumers may fetch icons. Do not advertise explicitly local
      // DNS names as otherwise public-looking icon URLs; syntax-only protection,
      // not a substitute for a consumer's DNS/IP checks at fetch time.
      const localName = ['localhost','local','localdomain','internal','home.arpa',
        'ip6-localhost','ip6-loopback'].includes(h) ||
        ['.localhost','.local','.localdomain','.internal','.home.arpa'].some(s => h.endsWith(s));
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || isIP(h) ||
          localName || /^\d+$/.test(h) || /^0x[0-9a-f]+$/.test(h)) throw Error('invalid');
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
function keyOf(entry) {
  const info = entry.extensions?.bazaar?.info?.input;
  if (!plain(info) || !['http','mcp'].includes(info.type)) throw new TypeError('Valid HTTP or MCP Bazaar info required');
  // Reject raw encoded traversal before WHATWG URL normalization.
  const checked = inspectResourceURL(entry.resource?.url);
  if (!checked.ok) throw new TypeError(`Invalid resource URL: ${checked.reason}`);
  const url = checked.url;
  if (info.type === 'mcp') {
    if (typeof info.toolName !== 'string' || !MCP_TOOL_NAME.test(info.toolName) || !plain(info.inputSchema)) throw new TypeError('Invalid MCP tool');
    return ['mcp',url.href,info.toolName].join('|');
  }
  if (!['GET','HEAD','DELETE','POST','PUT','PATCH'].includes(info.method)) throw new TypeError('Invalid HTTP method');
  // Different concrete path parameter values collapse to the same canonical entry.
  const template = inspectRouteTemplate(entry.extensions.bazaar.routeTemplate);
  const path = template.ok ? template.canonicalPath : url.pathname;
  return ['http',url.origin,path,url.search,info.method].join('|');
}

/**
 * Parse and sanitize a trusted-caller candidate without mutating a catalog.
 * Trust/sequence/ownership checks belong to the caller; this only applies the
 * same structural rules as insertValidated and returns the exact eventual key.
 */
export function validateCatalogEntry(entry) {
  if (!plain(entry?.resource) || !Array.isArray(entry.accepts) || entry.accepts.length === 0 ||
      !plain(entry.extensions?.bazaar) || !plain(entry.extensions.bazaar.info) ||
      !plain(entry.extensions.bazaar.schema)) throw new TypeError('Missing validated Bazaar envelope');
  if (entry.accepts.some(a => !plain(a) || typeof a.network !== 'string' || typeof a.scheme !== 'string' || typeof a.payTo !== 'string')) throw new TypeError('Invalid payment terms');
  const id = keyOf(entry);
  const sanitized = structuredClone(entry);
  sanitized.resource = sanitizeResourceServiceMetadata(sanitized.resource);
  // Proposed upstream optional pricing is catalog-only. Bad seller metadata
  // cannot invalidate an otherwise usable offer or leak unbounded hints.
  const pricing = sanitizeBazaarPricing(sanitized.extensions.bazaar.pricing);
  if (pricing === null) delete sanitized.extensions.bazaar.pricing;
  else sanitized.extensions.bazaar.pricing = pricing;
  const template = inspectRouteTemplate(sanitized.extensions.bazaar.routeTemplate);
  if (template.ok) sanitized.extensions.bazaar.routeTemplate = template.canonicalPath;
  else delete sanitized.extensions.bazaar.routeTemplate;
  return { id, entry: sanitized };
}
const signature = (query, filters) => createHash('sha256').update(JSON.stringify([query, filters])).digest('hex').slice(0,20);
const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const decode = (str) => {
  // Valid cursors are tiny canonical base64url JSON payloads. Validate length
  // and alphabet before decoding attacker-controlled input.
  if (typeof str !== 'string' || !str.length || str.length > 512 || !/^[A-Za-z0-9_-]+$/.test(str)) throw new RangeError('Invalid cursor');
  try {
    const raw = Buffer.from(str, 'base64url');
    if (raw.toString('base64url') !== str) throw new RangeError('Invalid cursor');
    return JSON.parse(raw.toString('utf8'));
  } catch {throw new RangeError('Invalid cursor');}
};
const asInteger = (v, fallback, max, min = 0) => {
  if (v === null) return fallback;
  if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) < min || Number(v) > max) throw new RangeError('Invalid pagination parameter');
  return Number(v);
};

export class BazaarCatalog {
  #entries = new Map(); #version = 0;
  #queries = new CatalogQueryIndex(this.#entries);
  // Call only from a trusted post-verification facilitator hook AFTER checking the
  // settlement, seller/recipient binding, and JSON Schema Draft 2020-12. NEVER
  // route this method directly to an unauthenticated HTTP client or payment payload.
  insertValidated(entry) {
    const { id, entry: sanitized } = validateCatalogEntry(entry);
    const previous = this.#entries.get(id);
    this.#entries.set(id, sanitized); this.#version++;
    this.#queries.changed(id, previous, sanitized);
    return id;
  }
  /** Internal integration primitive: remove an already-authorized key. */
  removeValidated(id) {
    if (typeof id !== 'string') throw new TypeError('Catalog key required');
    const previous = this.#entries.get(id);
    const removed = this.#entries.delete(id);
    if (removed) { this.#version++; this.#queries.changed(id, previous, undefined); }
    return removed;
  }
  /** Stage an isolated transaction while preserving the cursor generation. */
  clone() {
    const copy = new BazaarCatalog();
    copy.#entries = new Map([...this.#entries].map(([key, value]) => [key, structuredClone(value)]));
    copy.#version = this.#version;
    copy.#queries = new CatalogQueryIndex(copy.#entries);
    return copy;
  }
  list(params = new URLSearchParams()) {
    const filters = filtersFrom(params);
    const offset = asInteger(params.get('offset'),0,1_000_000);
    const limit = asInteger(params.get('limit'),20,100,1);
    // The original ordering/filtering contract now reuses the private query index.
    const all = this.#queries.list(filters);
    // Public read results must not expose the authoritative mutable entry objects.
    // Clone only the returned page, not the whole filtered catalog.
    return { resources: all.slice(offset,offset+limit).map(row => structuredClone(row)),pagination:{offset,limit,total:all.length} };
  }
  search(params = new URLSearchParams()) {
    const q = params.get('query');
    if (typeof q !== 'string' || !q.trim() || q.length > 1024) throw new RangeError('query is required (max 1024 chars)');
    const filters = filtersFrom(params);
    const limit = asInteger(params.get('limit'),20,100,1);
    const digest = signature(q, filters);
    let at = 0;
    if (params.has('cursor')) {
      const c = decode(params.get('cursor'));
      if (c?.v !== this.#version || c?.h !== digest || !Number.isSafeInteger(c.at) || c.at < 0) throw new RangeError('Stale or invalid cursor');
      at = c.at;
    }
    const ranked = this.#queries.search(filters, q);
    const page = ranked.slice(at,at+limit).map(row => structuredClone(row));
    const next = at+limit < ranked.length ? encode({v:this.#version,h:digest,at:at+limit}) : null;
    return { resources:page,partialResults:next !== null,pagination:{limit:page.length,cursor:next} };
  }
  /**
   * Opt-in buyer-facing discovery. Never silently drop metered routes whose
   * authorization ceiling exceeds a buyer's expected per-call spend.
   * Comparisons are per-network, per-asset atomic units, and are not
   * authorizations or observations of settled amounts.
   */
  pricing(params = new URLSearchParams()) {
    const rawBudget = params.get('budgetAtomic');
    if (rawBudget !== null && (!params.get('network') || !params.get('asset')))
      throw new RangeError('budgetAtomic requires network and asset filters');
    const budget = rawBudget === null ? null : parseAtomicBudget(rawBudget);
    const filters = filtersFrom(params);
    const page = this.list(params);
    return {
      resources: page.resources.map(row => ({
        ...row,
        pricingView: {
          offers: describeCatalogPricing(row, filters, budget),
          budgetAtomic: rawBudget,
          note: 'Seller-declared snapshot only. Fetch live 402 and obtain buyer approval before authorization.'
        }
      })),
      pagination: page.pagination,
      pricingViewVersion: 'stellar-bazaar-pricing-v1'
    };
  }
  get size() {return this.#entries.size;}
  get version() {return this.#version;}
  /** Detached process-local diagnostics; no rows, queries or payment data. */
  get queryStats() {return this.#queries.stats;}
}

export function createDiscoveryServer(catalog) {
  // Read-only HTTP API. No endpoint permits client-injected catalog records.
  return async function handler(req,res) {
    try {
      const u = new URL(req.url,'http://localhost');
      if (req.method !== 'GET') {res.writeHead(405,{'content-type':'application/json'});res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED',reason:'GET only'}));return;}
      const data = u.pathname === '/discovery/resources' ? catalog.list(u.searchParams)
        : u.pathname === '/discovery/search' ? catalog.search(u.searchParams)
        : u.pathname === '/discovery/pricing' ? catalog.pricing(u.searchParams) : null;
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
