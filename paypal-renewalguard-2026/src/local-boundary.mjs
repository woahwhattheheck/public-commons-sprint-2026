// Loopback-only request boundary for the demo's read-only sandbox endpoint.
// Host blocks DNS rebinding; Origin and Fetch Metadata block cross-site browser hits.
// This is not authentication: do not expose this local app beyond loopback.
export function isLocalBrowserRequest(headers) {
  if (!headers || typeof headers !== 'object') return false;
  const host = headers.host;
  if (typeof host !== 'string' || !/^(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/.test(host))
    return false;
  const port = Number(host.slice(host.lastIndexOf(':') + 1));
  if (!Number.isInteger(port) || port > 65535) return false;
  if (headers.origin !== undefined && headers.origin !== `http://${host}`)
    return false;
  const site = headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none')
    return false;
  return true;
}
