// MIT. SF-50: a side-effect-free x402 v2 HTTP quote reconciliation boundary.
// This gate does NOT fetch, sign, reserve funds, verify signatures or settle.
import { createHash } from 'node:crypto';

const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const decimal = s => typeof s === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(s);
// SEP-41 Soroban token amounts use signed i128, not arbitrary JSON decimals.
const SOROBAN_I128_MAX = (1n << 127n) - 1n;
const boundedAtomic = s => decimal(s) && BigInt(s) <= SOROBAN_I128_MAX;
const error = reason => ({ decision: 'reject', reason });

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  throw new TypeError('Unsupported payment metadata');
}

function urlOf(raw, allowLocalHttp) {
  if (typeof raw !== 'string' || raw.length > 4096 || /[\u0000-\u001f\u007f]/.test(raw)) throw new TypeError('Invalid resource URL');
  const u = new URL(raw);
  const localHttp = u.protocol === 'http:' && allowLocalHttp && ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname);
  if (u.protocol !== 'https:' && !localHttp) throw new TypeError('Secure resource URL required');
  if (u.username || u.password || u.hash || !u.hostname || u.href !== raw) throw new TypeError('Noncanonical resource URL');
  // Avoid encoded delimiters and ambiguous normalization at the payment boundary.
  if (/%(?:2f|5c|2e|25)/i.test(u.pathname) || u.pathname.includes('\\')) throw new TypeError('Ambiguous encoded path');
  return u;
}

function routeMatches(catalog, requested) {
  if (catalog.origin !== requested.origin || catalog.search !== requested.search) return false;
  const t = catalog.pathname;
  if (t === requested.pathname) return true;
  return false;
}

function matchesTemplate(template, requested, catalog) {
  if (typeof template !== 'string' || !template.startsWith('/') || template.length > 2048) return false;
  if (catalog.origin !== requested.origin || catalog.search !== requested.search) return false;
  const parts = template.split('/');
  const matches = url => {
    const actual = url.pathname.split('/');
    if (parts.length !== actual.length) return false;
    return parts.every((part, i) => {
      if (part.startsWith(':')) return /^:[A-Za-z_][\w]*$/.test(part) && actual[i].length > 0;
      return part === actual[i];
    });
  };
  // Both the indexed record and the fresh origin URL must belong to the
  // same advertised template. A matching seller quote alone cannot bind a
  // different catalog route to this request.
  return matches(catalog) && matches(requested);
}

function normalized(t) {
  if (!plain(t) || !['exact', 'upto'].includes(t.scheme) ||
      !['stellar:testnet', 'stellar:pubnet'].includes(t.network) ||
      typeof t.asset !== 'string' || t.asset.length < 1 || t.asset.length > 256 ||
      typeof t.payTo !== 'string' || t.payTo.length < 1 || t.payTo.length > 256 ||
      !boundedAtomic(t.amount) || BigInt(t.amount) <= 0n ||
      !Number.isSafeInteger(t.maxTimeoutSeconds) || t.maxTimeoutSeconds <= 0 ||
      t.maxTimeoutSeconds > 86400 || (t.extra !== undefined && !plain(t.extra))) {
    throw new TypeError('Invalid canonical payment terms');
  }
  return {
    scheme: t.scheme, network: t.network, asset: t.asset, payTo: t.payTo,
    amount: t.amount, maxTimeoutSeconds: t.maxTimeoutSeconds,
    extra: t.extra === undefined ? null : structuredClone(t.extra)
  };
}

function readHeader(response) {
  if (response?.status !== 402 || !response.headers || typeof response.headers.get !== 'function') throw new TypeError('Expected fresh HTTP 402 response');
  const raw = response.headers.get('payment-required');
  if (typeof raw !== 'string' || raw.length > 65536 || raw.length < 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) throw new TypeError('Noncanonical PAYMENT-REQUIRED header');
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length > 49152 || bytes.toString('base64') !== raw) throw new TypeError('Noncanonical PAYMENT-REQUIRED bytes');
  return JSON.parse(bytes.toString('utf8'));
}

/**
 * Caller MUST fetch the intended resource without redirects or payment credentials
 * and supply its HTTP 402 Response before invoking any wallet/signer callback.
 * This guard only proves agreement of catalog, observed origin quote and buyer
 * policy at this instant. It is NOT seller authentication or ledger settlement.
 */
export function reconcileHttpQuote({
  catalogEntry, requestUrl, method = 'GET', response, selection,
  allowedNetworks = ['stellar:testnet'], allowedSchemes = ['exact'],
  maxAtomicUnits, allowLocalHttp = false
}) {
  try {
    const target = urlOf(requestUrl, allowLocalHttp);
    const catalogUrl = urlOf(catalogEntry?.resource?.url, allowLocalHttp);
    const input = catalogEntry?.extensions?.bazaar?.info?.input;
    if (input?.type !== 'http' || input.method !== method || !['GET', 'HEAD', 'DELETE', 'POST', 'PUT', 'PATCH'].includes(method))
      return error('DISCOVERY_METHOD_MISMATCH');
    const template = catalogEntry.extensions.bazaar.routeTemplate;
    if (!(template ? matchesTemplate(template, target, catalogUrl) : routeMatches(catalogUrl, target)))
      return error('DISCOVERY_RESOURCE_MISMATCH');
    if (response?.redirected || response?.url !== target.href) return error('ORIGIN_REDIRECT_OR_MISMATCH');
    const quote = readHeader(response);
    if (quote?.x402Version !== 2 || !Array.isArray(quote.accepts) || quote.accepts.length === 0)
      return error('ORIGIN_QUOTE_NOT_V2');
    const quotedUrl = urlOf(quote?.resource?.url, allowLocalHttp);
    if (quotedUrl.href !== target.href) return error('ORIGIN_RESOURCE_MISMATCH');
    const liveInput = quote.extensions?.bazaar?.info?.input;
    if (liveInput?.type !== 'http' || liveInput.method !== method ||
        (quote.extensions.bazaar.routeTemplate ?? null) !== (template ?? null))
      return error('ORIGIN_DISCOVERY_IDENTITY_DRIFT');
    if (!plain(selection) || !['scheme','network','asset','payTo'].every(k => typeof selection[k] === 'string' && selection[k]))
      return error('EXPLICIT_SELECTION_REQUIRED');
    if (!Array.isArray(allowedNetworks) || !allowedNetworks.includes(selection.network) ||
        !Array.isArray(allowedSchemes) || !allowedSchemes.includes(selection.scheme))
      return error('BUYER_POLICY_SCHEME_OR_NETWORK');
    if (!boundedAtomic(maxAtomicUnits)) return error('BUYER_CAP_REQUIRED');
    if (!Array.isArray(catalogEntry.accepts)) return error('CATALOG_TERMS_MISSING');
    // Every quoted and cataloged option must parse safely; malformed alternatives
    // cannot be silently skipped by a convenience SDK's default selector.
    const catalogTerms = catalogEntry.accepts.map(normalized);
    const liveTerms = quote.accepts.map(normalized);
    const pick = t => ['scheme', 'network', 'asset', 'payTo'].every(k => t[k] === selection[k]);
    const fromCatalog = catalogTerms.filter(pick), fromOrigin = liveTerms.filter(pick);
    if (fromCatalog.length !== 1 || fromOrigin.length !== 1) return error('PAYMENT_OPTION_AMBIGUOUS_OR_MISSING');
    const a = fromCatalog[0], b = fromOrigin[0];
    if (canonical(a) !== canonical(b)) return error('PAYMENT_TERMS_DRIFT');
    if (BigInt(b.amount) > BigInt(maxAtomicUnits)) return error('BUYER_CAP_EXCEEDED');
    const receipt = createHash('sha256').update(canonical({
      requestUrl: target.href, method, selected: b,
      quoteHeader: response.headers.get('payment-required')
    })).digest('hex');
    return { decision: 'allow', reason: 'LIVE_QUOTE_MATCH', paymentRequirement: Object.freeze(b),
      receiptSha256: receipt, source: 'origin-http-402' };
  } catch (e) {
    return error(e instanceof SyntaxError || e instanceof TypeError || e instanceof RangeError ? 'MALFORMED_QUOTE_OR_RESOURCE' : 'RECONCILIATION_FAILED');
  }
}
