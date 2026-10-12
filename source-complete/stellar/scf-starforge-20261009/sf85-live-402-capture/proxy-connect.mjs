/**
 * SF85 opt-in HTTPS over an explicitly approved HTTP CONNECT proxy.
 * No request path, merchant challenge headers or credentials reach the proxy in
 * plaintext. A single tunnel carries one original TLS-verified HTTP request.
 * SPDX-License-Identifier: MIT
 */
import { Agent as HttpsAgent } from 'node:https';
import { request as httpRequest } from 'node:http';
import { connect as tlsConnect, checkServerIdentity } from 'node:tls';

function proxyError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function parseExplicitProxy(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) throw proxyError('INVALID_EXPLICIT_PROXY');
  let url;
  try { url = new URL(raw); } catch { throw proxyError('INVALID_EXPLICIT_PROXY'); }
  if (url.protocol !== 'http:' || !url.hostname || url.username || url.password ||
      url.search || url.hash || (url.pathname && url.pathname !== '/') ||
      (url.port && (!Number.isInteger(Number(url.port)) || Number(url.port) < 1 || Number(url.port) > 65535))) {
    throw proxyError('PROXY_MUST_BE_HTTP_HOST_PORT_WITHOUT_CREDENTIALS');
  }
  // Explicit local/VM proxies are legitimate; never trust implicit env proxies.
  // HTTP CONNECT only; target URL/approval and TLS verification stay upstream.
  return { hostname: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || '80') };
}

/**
 * Obtain a single-use https.Agent that constructs an HTTP CONNECT tunnel and
 * performs TLS with the ORIGINAL seller hostname, not the proxy hostname.
 *
 * Proxy CONNECT authority uses a validated pinned PUBLIC IPv4:443 by default.
 * Trusted VM overlay DNS (explicit 198.18/15 option upstream) requires the
 * original hostname:443, since the gateway's 198.18 address speaks plain HTTP
 * outside its forward-proxy CONNECT routing path.
 * An explicitly trusted resolving proxy may also receive the original hostname
 * without local DNS, via resolveAtProxy:true. Its caller must pin the origin.
 */
export function oneShotConnectAgent({ target, proxy, pinnedIP, sandboxOverlay, resolveAtProxy = false, signal },
                                    { openConnect = httpRequest, openTls = tlsConnect } = {}) {
  if (!target || !proxy || (!resolveAtProxy && !pinnedIP) || !signal ||
      typeof resolveAtProxy !== 'boolean') throw proxyError('PROXY_CONFIG_INCOMPLETE');
  const authority = (sandboxOverlay || resolveAtProxy ? target.hostname : pinnedIP) + ':443';
  const agent = new HttpsAgent({ keepAlive: false, maxSockets: 1 });
  let pendingConnect;
  let tunnelSocket;
  let tlsSocket;
  let finished = false;
  const onAbort = () => {
    pendingConnect?.destroy(proxyError('PROXY_CAPTURE_TIMEOUT'));
    tlsSocket?.destroy(proxyError('PROXY_CAPTURE_TIMEOUT'));
    tunnelSocket?.destroy();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  const stop = () => {
    if (!finished) {
      finished = true;
      signal.removeEventListener('abort', onAbort);
      pendingConnect?.destroy();
      tlsSocket?.destroy();
      tunnelSocket?.destroy();
      agent.destroy();
    }
  };
  agent.createConnection = (_connectionOptions, done) => {
    let settled = false;
    const complete = (error, socket) => {
      if (settled) return;
      settled = true;
      if (error) {
        tlsSocket?.destroy();
        tunnelSocket?.destroy();
      }
      done(error, socket);
    };
    try {
      pendingConnect = openConnect({
        hostname: proxy.hostname, port: proxy.port,
        method: 'CONNECT', path: authority, agent: false,
        headers: { Host: authority },
        // HTTP proxy is named explicitly by the operator; auth is forbidden.
      });
      pendingConnect.once('connect', (response, socket, head) => {
        tunnelSocket = socket;
        if (response.statusCode !== 200 || head.length !== 0) {
          complete(proxyError('PROXY_CONNECT_NOT_ESTABLISHED'));
          return;
        }
        tlsSocket = openTls({
          socket,
          servername: target.hostname,
          rejectUnauthorized: true,
          checkServerIdentity,
          minVersion: 'TLSv1.2',
          ALPNProtocols: ['http/1.1'],
        });
        tlsSocket.once('secureConnect', () => {
          if (!tlsSocket.authorized) {
            complete(proxyError('MERCHANT_TLS_NOT_AUTHORIZED'));
            return;
          }
          complete(null, tlsSocket);
        });
        tlsSocket.once('error', (error) => complete(error));
      });
      pendingConnect.once('response', (response) => {
        response.resume();
        complete(proxyError('PROXY_CONNECT_NOT_ESTABLISHED'));
      });
      pendingConnect.once('error', (error) => complete(error));
      pendingConnect.end();
      if (signal.aborted) onAbort();
    } catch (error) { complete(error); }
  };
  return { agent, stop };
}
