// Focused actual HTTP acceptance for SF69. Node 22+.
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createX402BrowserCors } from './cors.mjs';
const origin = 'https://buyer.example';
const middleware = createX402BrowserCors({ allowedOrigins: [origin], credentials: true });
let downstream = 0;
const server = createServer((req, res) => middleware(req, res, () => {
  downstream++;
  res.statusCode = 402;
  res.setHeader('PAYMENT-REQUIRED', 'local-sample-challenge');
  res.setHeader('Access-Control-Expose-Headers', 'X-Trace');
  res.end();
}));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/paid`;
try {
  const get = await fetch(url, { headers: { Origin: origin }});
  assert.equal(get.status, 402);
  assert.equal(get.headers.get('access-control-allow-origin'), origin);
  assert(get.headers.get('access-control-expose-headers').toLowerCase().includes('payment-required'));
  const options = await fetch(url, { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'payment-signature'
  }});
  assert.equal(options.status, 204);
  assert.equal(downstream, 1, 'payment middleware must not see preflight');
  const declined = await fetch(url, { method: 'OPTIONS', headers: {
    Origin: 'https://other.example', 'Access-Control-Request-Method': 'POST'
  }});
  assert.equal(declined.status, 403);
  console.log('SF69 native HTTP PASS: 402 exposure, preflight bypass, unapproved buyer refused');
} finally { server.close(); await once(server, 'close'); }
