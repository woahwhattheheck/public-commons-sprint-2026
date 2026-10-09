#!/usr/bin/env node
/**
 * Read-only local reviewer board for existing ClaimProof Commerce exports.
 * Payment operations remain entirely in the original user-approved sandbox app.
 */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const port = Number(process.env.CLAIMPROOF_BOARD_PORT || 3160);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('CLAIMPROOF_BOARD_PORT must be an integer from 1024 to 65535');
  process.exit(2);
}
const html = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'caseboard.html'));
const policy = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline'",
  "connect-src 'none'",
  "img-src 'none'",
  "media-src 'none'",
  "font-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'"
].join('; ');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1:' + port).pathname;
  const common = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': policy
  };
  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, {...common, 'Content-Type': 'text/html; charset=utf-8'});
    res.end(html);
  } else if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, {...common, 'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify({ready:true, service:'claimproof-review-board', mode:'local-review-only',
      upload_endpoint:false, paypal_mutations:false, server_retains_review_data:false}));
  } else {
    res.writeHead(404, {...common, 'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify({error:'route not found'}));
  }
});
server.listen(port, '127.0.0.1', () =>
  console.log('ClaimProof review board: http://127.0.0.1:' + port +
    ' (local files only; no PayPal calls)'));
