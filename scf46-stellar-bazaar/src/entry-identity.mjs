// SPDX-License-Identifier: MIT
// Shared catalog structure and search metadata. Payment admission remains with the catalog owner.
import { inspectResourceURL, inspectRouteTemplate } from '../../stellar-forge/route-identity/identity.mjs';

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const printable = (v) => typeof v === 'string' && v.length > 0 && v.length <= 32 && /^[\x20-\x7E]+$/.test(v);
const MCP_TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

export function sanitizeResourceSearchMetadata(resource) {
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
  return result;
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


/** The exact existing envelope checks and canonical catalog key. */
export function validateCatalogEntryIdentity(entry) {
  if (!plain(entry?.resource) || !Array.isArray(entry.accepts) || entry.accepts.length === 0 ||
      !plain(entry.extensions?.bazaar) || !plain(entry.extensions.bazaar.info) ||
      !plain(entry.extensions.bazaar.schema)) throw new TypeError('Missing validated Bazaar envelope');
  if (entry.accepts.some(a => !plain(a) || typeof a.network !== 'string' || typeof a.scheme !== 'string' || typeof a.payTo !== 'string')) throw new TypeError('Invalid payment terms');
  return keyOf(entry);
}

/** Detached fields for search. Icons and pricing remain with their original
 * consumers; this read projection never fetches an icon or authorizes payment. */
export function projectCatalogSearchEntry(entry) {
  const id = validateCatalogEntryIdentity(entry), projected = structuredClone(entry);
  projected.resource = sanitizeResourceSearchMetadata(projected.resource);
  return { id, entry: projected };
}
