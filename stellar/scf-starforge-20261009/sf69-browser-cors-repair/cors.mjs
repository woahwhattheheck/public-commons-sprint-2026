// MIT. Opt-in, seller-side browser CORS repair for x402 v2 HTTP.
// Register before paymentMiddleware so browser OPTIONS never becomes a paid request.
// No payments, signing, wallet or seller catalog mutation.

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const DEFAULT_EXPOSE = ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'];
const DEFAULT_REQUEST = ['Content-Type', 'PAYMENT-SIGNATURE'];

function headerTokens(value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value ?? '');
  return raw.split(',').map(x => x.trim()).filter(Boolean);
}
function checkedTokens(values, name) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 32 ||
      !values.every(x => typeof x === 'string' && TOKEN.test(x))) {
    throw new TypeError(name + ' must be a nonempty list of valid HTTP tokens');
  }
  return values;
}
function union(values) {
  const byLower = new Map();
  for (const value of values) {
    if (!TOKEN.test(value)) continue;
    if (!byLower.has(value.toLowerCase())) byLower.set(value.toLowerCase(), value);
  }
  return [...byLower.values()].join(', ');
}
function vary(res, ...fields) {
  const existing = headerTokens(res.getHeader('Vary'));
  if (existing.includes('*')) return;
  res.setHeader('Vary', union([...existing, ...fields]));
}
function originExact(candidate) {
  if (typeof candidate !== 'string' || candidate.length > 2048) return null;
  try {
    const u = new URL(candidate);
    if (!['https:', 'http:'].includes(u.protocol) || !u.hostname ||
        u.username || u.password || u.hash || u.search || u.pathname !== '/' ||
        candidate !== u.origin) return null;
    return u.origin;
  } catch { return null; }
}

/**
 * Express/Connect-compatible browser CORS repair for an operator-authorized x402 seller.
 * Specific origins, payment methods and allowed request headers are required. Never
 * reflects an arbitrary Origin or uses credentialed wildcard CORS.
 */
export function createX402BrowserCors({
  allowedOrigins,
  allowedMethods = ['GET', 'POST'],
  allowedRequestHeaders = DEFAULT_REQUEST,
  exposedResponseHeaders = DEFAULT_EXPOSE,
  credentials = false,
  maxAgeSeconds = 600,
} = {}) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0 ||
      allowedOrigins.length > 64 || allowedOrigins.some(x => !originExact(x))) {
    throw new TypeError('allowedOrigins must contain specific absolute HTTP(S) origins (not *)');
  }
  const origins = new Set(allowedOrigins);
  const methods = checkedTokens(allowedMethods, 'allowedMethods').map(x => x.toUpperCase());
  if (methods.some(x => !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(x)))
    throw new TypeError('Only explicit HTTP application methods are supported');
  const allowMethods = new Set(methods);
  const reqHeaders = checkedTokens(allowedRequestHeaders, 'allowedRequestHeaders');
  const allowHeaders = new Set(reqHeaders.map(x => x.toLowerCase()));
  const expose = checkedTokens(exposedResponseHeaders, 'exposedResponseHeaders');
  const exposure = union([...DEFAULT_EXPOSE, ...expose]);
  if (typeof credentials !== 'boolean' || !Number.isSafeInteger(maxAgeSeconds) ||
      maxAgeSeconds < 0 || maxAgeSeconds > 86400) {
    throw new TypeError('Invalid credentials or preflight maxAgeSeconds');
  }

  return function x402BrowserCors(req, res, next) {
    if (typeof next !== 'function') throw new TypeError('Express next() required');
    const incomingOrigin = req.headers?.origin;
    if (incomingOrigin === undefined) return next(); // Non-browser clients unchanged.
    const preflight = req.method === 'OPTIONS' &&
      req.headers?.['access-control-request-method'] !== undefined;
    vary(res, 'Origin');
    if (preflight) vary(res, 'Access-Control-Request-Method', 'Access-Control-Request-Headers');

    if (typeof incomingOrigin !== 'string' || !origins.has(incomingOrigin)) {
      if (preflight) { res.statusCode = 403; res.end(); return; }
      // An app/router lower in the stack cannot accidentally re-enable a
      // rejected buyer origin via `Access-Control-Allow-Origin: *`.
      res.removeHeader('Access-Control-Allow-Origin');
      const originalSetHeader = res.setHeader;
      res.setHeader = function(name, value) {
        if (String(name).toLowerCase() === 'access-control-allow-origin') return this;
        return originalSetHeader.call(this, name, value);
      };
      return next();
    }

    res.setHeader('Access-Control-Allow-Origin', incomingOrigin);
    if (credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
    // Preserve application exposure and Vary even if handlers later set them.
    // Maintain one exact origin when another layer attempts wildcard overwrite.
    const originalSetHeader = res.setHeader;
    res.setHeader = function(name, value) {
      const key = String(name).toLowerCase();
      if (key === 'access-control-expose-headers') {
        const current = headerTokens(this.getHeader(name));
        value = union([...current, ...headerTokens(value), ...headerTokens(exposure)]);
      } else if (key === 'vary') {
        const current = headerTokens(this.getHeader(name));
        value = current.includes('*') ? '*' : union([...current, ...headerTokens(value), 'Origin',
          ...(preflight ? ['Access-Control-Request-Method', 'Access-Control-Request-Headers'] : [])]);
      } else if (key === 'access-control-allow-origin') {
        value = incomingOrigin;
      } else if (key === 'access-control-allow-credentials' && credentials) {
        value = 'true';
      }
      return originalSetHeader.call(this, name, value);
    };
    res.setHeader('Access-Control-Expose-Headers', exposure);

    if (!preflight) return next();
    const method = req.headers['access-control-request-method'];
    if (typeof method !== 'string' || !TOKEN.test(method) ||
        !allowMethods.has(method.toUpperCase())) {
      res.statusCode = 405; res.end(); return;
    }
    const requested = req.headers['access-control-request-headers'];
    if (requested !== undefined && (typeof requested !== 'string' ||
        requested.length > 2048 ||
        headerTokens(requested).some(x => !TOKEN.test(x) || !allowHeaders.has(x.toLowerCase())))) {
      res.statusCode = 403; res.end(); return;
    }
    res.setHeader('Access-Control-Allow-Methods', union(methods));
    res.setHeader('Access-Control-Allow-Headers', union(reqHeaders));
    res.setHeader('Access-Control-Max-Age', String(maxAgeSeconds));
    res.statusCode = 204;
    res.end(); // Never reaches x402 paid middleware.
  };
}
