// MIT. Loopback HTTP Host-authority gate for the SF12 /supported listener.
// Binding to loopback does not prevent a browser's DNS-rebinding Host request.
export function isLoopbackHostAuthority(req) {
  const rawHeaders = req?.rawHeaders;
  if (!Array.isArray(rawHeaders) || rawHeaders.length % 2 || !req?.socket) return false;
  let authority;
  let count = 0;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (typeof rawHeaders[i] === 'string' && rawHeaders[i].toLowerCase() === 'host') {
      ++count;
      authority = rawHeaders[i + 1];
    }
  }
  if (count !== 1 || typeof authority !== 'string') return false;
  // ASCII local authorities only: no DNS suffix, encoded IP, userinfo, trailing
  // dot, unbracketed IPv6, malformed port, or duplicate Host fields.
  const match = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::([1-9][0-9]{0,4}))?$/i.exec(authority);
  if (!match) return false;
  const port = req.socket.localPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  // An explicit Host port must match this actual listener (canonical decimal).
  if (match[1] !== undefined && match[1] !== String(port)) return false;
  return true;
}
