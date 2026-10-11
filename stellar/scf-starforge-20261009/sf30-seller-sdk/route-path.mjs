// MIT. Path binding for the existing SF30 HTTP adapter; no payment implementation.
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const namesAllowed = /^[A-Za-z_][A-Za-z0-9_]*$/;
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const literal = /^[A-Za-z0-9_.~-]+$/;
const badTarget = () => Object.assign(new TypeError('INVALID_REQUEST_TARGET'), { status: 400 });
// Native route regex uses /i without /u. Fold ASCII path literals only;
// preserve the casing and contents of decoded dynamic path parameters.
const asciiFold = value => value.replace(/[A-Z]/g, c => c.toLowerCase());

function decodeSegment(segment) {
  let value;
  try { value = decodeURIComponent(segment); } catch { throw badTarget(); }
  // Match native decoding exactly once. Never allow an encoded path delimiter,
  // a second decoding layer, a control character or a URL-normalized dot segment.
  if (!value || value === '.' || value === '..' || /[/\\?#%\x00-\x1f\x7f]/u.test(value)) throw badTarget();
  return value;
}

function match(binding, rawPath) {
  const values = rawPath.split('/');
  if (values.length !== binding.segments.length) return null;
  const result = Object.create(null);
  for (let i = 0; i < values.length; i++) {
    const expected = binding.segments[i];
    if (expected.startsWith(':')) result[expected.slice(1)] = decodeSegment(values[i]);
    else if (asciiFold(expected) !== asciiFold(values[i])) return null;
  }
  return result;
}

/** Bind an imported Bazaar template to its concrete, schema-checked sample URL. */
export function compileServicePath(offer) {
  const samplePath = new URL(offer.resource.url).pathname;
  const bazaar = offer.extensions?.bazaar, template = bazaar?.routeTemplate;
  const path = template ?? samplePath;
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('//') ||
      path.length > 2048 || (path.length > 1 && path.endsWith('/') && template !== undefined)) {
    throw new TypeError('Canonical service path required; dynamic trailing slashes are unsupported');
  }
  const segments = path.split('/'), names = [];
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    if (template !== undefined && segment.startsWith(':')) {
      const name = segment.slice(1);
      if (!namesAllowed.test(name) || reserved.has(name) || names.includes(name))
        throw new TypeError('Unique, whole-segment named path parameters required');
      names.push(name);
    } else if ((segment && !literal.test(segment)) || segment === '.' || segment === '..' ||
               (!segment && i !== segments.length - 1)) {
      throw new TypeError('Service paths require canonical literal or whole-parameter segments');
    }
  }
  // Native 2.28.0 patterns use case-insensitive, dotAll matching. Keep a
  // matching view so a case variant cannot pick another endpoint's price.
  const nativePattern = new RegExp('^' + segments.map(segment => segment.startsWith(':')
    ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/') + '$', 'is');
  const binding = Object.freeze({ path, samplePath, dynamic: names.length > 0,
    names: Object.freeze(names), segments: Object.freeze(segments), nativePattern });
  if (template !== undefined && !names.length) throw new TypeError('routeTemplate must contain a named parameter');
  if (!binding.dynamic) {
    if (bazaar?.info?.input?.pathParams !== undefined) throw new TypeError('pathParams requires routeTemplate');
    return binding;
  }
  const examples = bazaar.info?.input?.pathParams;
  const schema = bazaar.schema?.properties?.input?.properties?.pathParams;
  if (!plain(examples) || !plain(schema) || schema.type !== 'object' || !plain(schema.properties) ||
      !Array.isArray(schema.required) || schema.additionalProperties !== false ||
      Object.keys(examples).length !== names.length || Object.keys(schema.properties).length !== names.length ||
      schema.required.length !== names.length || new Set(schema.required).size !== names.length ||
      names.some(name => !Object.hasOwn(examples, name) || !Object.hasOwn(schema.properties, name) ||
        !schema.required.includes(name) || typeof examples[name] !== 'string' || schema.properties[name]?.type !== 'string')) {
    // Native Bazaar 2.28.0 enriches pathParams as strings. Preserve the original
    // schema: numeric/boolean schemas need an explicit typed native integration,
    // not silent conversion or a challenge that disagrees with native checkout.
    throw new TypeError('Native dynamic service requires required string pathParams with unchanged schema');
  }
  let actual;
  try { actual = match(binding, samplePath); } catch { throw new TypeError('Invalid dynamic sample URL'); }
  if (!actual || names.some(name => actual[name] !== examples[name]))
    throw new TypeError('Dynamic sample URL must match the declared pathParams exactly');
  return binding;
}

/** One ordering shared by application dispatch and the native payment router. */
export function orderServiceRoutes(routes) {
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    const a = routes[i], b = routes[j];
    if (a.path === b.path) continue; // Distinct methods for the same path are valid.
    if (!a.binding.dynamic && !b.binding.dynamic && a.method === b.method &&
        a.path.replace(/(.+?)\/+$/, '$1').toLowerCase() === b.path.replace(/(.+?)\/+$/, '$1').toLowerCase())
      throw new TypeError('Case- or slash-ambiguous native service paths: ' + a.path + ' and ' + b.path);
    if (!a.binding.dynamic || !b.binding.dynamic) continue; // Concrete paths win.
    const left = a.binding.segments, right = b.binding.segments;
    if (left.length === right.length && left.every((s, k) => s.toLowerCase() === right[k].toLowerCase() ||
        s.startsWith(':') || right[k].startsWith(':'))) {
      throw new TypeError('Ambiguous dynamic service paths: ' + a.path + ' and ' + b.path);
    }
  }
  // Native router normalizes trailing slashes. Reject a static route that would
  // overlap a dynamic route only after this normalization.
  for (const a of routes.filter(r => !r.binding.dynamic && r.path.length > 1 && r.path.endsWith('/'))) {
    for (const b of routes.filter(r => r.binding.dynamic)) {
      if (b.binding.nativePattern.test(a.path.slice(0, -1))) throw new TypeError('Trailing-slash route overlaps a dynamic native path');
    }
  }
  return [...routes].sort((a, b) => Number(a.binding.dynamic) - Number(b.binding.dynamic));
}

/** Path precedence is independent of method: a concrete path returns its own 405. */
export function selectServiceRoute(routes, rawPath, method) {
  let selectedPath, params;
  for (const route of routes) {
    if (!route.binding.dynamic && asciiFold(route.path) !== asciiFold(rawPath)) continue;
    const found = route.binding.dynamic ? match(route.binding, rawPath) : Object.create(null);
    if (found === null) continue;
    selectedPath = route.path; params = found; break;
  }
  if (selectedPath === undefined) return null;
  // Keep fixed routes for distinct methods together when their native patterns
  // select the same case-insensitive path; otherwise a valid POST becomes 405.
  const matching = routes.filter(r => r.binding.dynamic
    ? r.path === selectedPath : asciiFold(r.path) === asciiFold(selectedPath));
  const route = matching.find(r => r.method === method);
  // Native static matching is case-insensitive, but a case-varied concrete
  // endpoint must not replace the price of a dynamic value with that spelling.
  // Preserve the original NATIVE_ROUTE_CASE_COLLISION rule before payment.
  if (route && !route.binding.dynamic && route.path !== rawPath &&
      routes.some(other => other.binding.dynamic && other.method === method &&
        match(other.binding, rawPath) !== null)) {
    throw Object.assign(new TypeError('NATIVE_ROUTE_CASE_COLLISION'), { status: 400 });
  }
  if (route?.binding.dynamic) {
    const decoded = decodeURIComponent(rawPath);
    const nativeRoute = routes.find(r => r.method === method && r.binding.nativePattern.test(decoded));
    if (nativeRoute !== route) throw Object.assign(new TypeError('NATIVE_ROUTE_CASE_COLLISION'), { status: 400 });
  }
  return { route, allow: matching.map(r => r.method), pathParams: params };
}
