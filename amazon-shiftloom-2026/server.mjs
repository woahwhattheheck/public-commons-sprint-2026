import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { seedEvent } from './seed.mjs';
import { proposeCoverage, applyProposal } from './planner.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const staticFiles = { '/': ['public/index.html', 'text/html; charset=utf-8'], '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'], '/style.css': ['public/style.css', 'text/css; charset=utf-8'] };

async function bodyJSON(req) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw Object.assign(new Error('Send application/json.'), { status: 415 });
  const chunks = [];
  let len = 0;
  for await (const chunk of req) {
    len += chunk.length;
    if (len > 16384) throw Object.assign(new Error('Maximum request size is 16 KiB.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}

export function createServer() {
  let state = seedEvent();
  let pending = null;
  const undo = [];
  function send(res, status, obj) {
    const data = JSON.stringify(obj);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(data);
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && staticFiles[url.pathname]) {
        const [path, type] = staticFiles[url.pathname];
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
        res.end(await readFile(join(root, path))); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        send(res, 200, { ...state, pending: pending && { id: pending.id, ...pending.proposal }, canUndo: undo.length > 0 }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/plan') {
        const b = await bodyJSON(req);
        pending = null;
        const proposal = proposeCoverage(state, b.command);
        if (proposal.ok) pending = { id: randomUUID(), proposal };
        send(res, 200, { ...proposal, ...(pending ? { proposalId: pending.id } : {}) }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/dismiss') {
        const b = await bodyJSON(req);
        if (!pending || b.proposalId !== pending.id) {
          send(res, 409, { error: 'That proposal is no longer pending.' }); return;
        }
        pending = null;
        send(res, 200, { message: 'Pending proposal discarded without modifying the schedule.' }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/approve') {
        const b = await bodyJSON(req);
        if (!pending || b.proposalId !== pending.id || !Number.isInteger(b.expectedRevision) || state.revision !== b.expectedRevision) {
          send(res, 409, { error: 'Pending proposal changed or is stale. Please plan again.' }); return;
        }
        const next = applyProposal(state, pending.proposal);
        undo.push(state);
        if (undo.length > 20) undo.shift();
        state = next;
        pending = null;
        send(res, 200, { message: 'Approved by the coordinator. The local sample schedule has been updated.', state }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/undo') {
        const b = await bodyJSON(req);
        if (b.expectedRevision !== state.revision || !undo.length) {
          send(res, 409, { error: 'No matching approval to undo. Refresh the schedule.' }); return;
        }
        const prior = undo.pop();
        prior.revision = state.revision + 1; // strictly increasing, including after undo
        state = prior;
        pending = null;
        send(res, 200, { message: 'The last local approval was undone.', state }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/reset') {
        await bodyJSON(req);
        state = seedEvent(); pending = null; undo.length = 0;
        send(res, 200, { message: 'Synthetic event reset to its initial state.', state }); return;
      }
      send(res, 404, { error: 'Unknown route.' });
    } catch (e) { send(res, e.status || 400, { error: e.message || 'Request rejected.' }); }
  });
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 8787);
  createServer().listen(port, '127.0.0.1', () => console.log(`ShiftLoom simulated Alexa+ experience at http://127.0.0.1:${port}`));
}
