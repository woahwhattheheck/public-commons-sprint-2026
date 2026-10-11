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
  const sessions = new Map();
  const maxSessions = 100;
  const idleLifetimeMs = 60 * 60 * 1000;
  function sessionFor(req, res, create) {
    const now = Date.now();
    for (const [id, value] of sessions) {
      if (now - value.lastUsed >= idleLifetimeMs) sessions.delete(id);
    }
    const id = (req.headers.cookie || '').match(/(?:^|;\s*)shiftloom_sid=([a-f0-9-]{36})(?:;|$)/)?.[1];
    const current = id && sessions.get(id);
    if (current) { current.lastUsed = now; return current; }
    // A stale or missing cookie cannot mutate a newly created replacement event.
    if (!create) throw Object.assign(new Error('This local session is missing or expired. Refresh the event before changing it.'), { status: 409, code: 'session_expired' });
    if (sessions.size >= maxSessions) throw Object.assign(new Error('All local demo sessions are in use. Try again after an idle session expires or restart the local server.'), { status: 503 });
    const nextId = randomUUID();
    const next = { state: seedEvent(), pending: null, undo: [], lastUsed: now };
    sessions.set(nextId, next);
    res.setHeader('set-cookie', `shiftloom_sid=${nextId}; HttpOnly; SameSite=Strict; Path=/`);
    return next;
  }
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
      const readState = req.method === 'GET' && url.pathname === '/api/state';
      const mutation = req.method === 'POST' && ['/api/plan', '/api/dismiss', '/api/approve', '/api/undo', '/api/reset'].includes(url.pathname);
      if (!readState && !mutation) { send(res, 404, { error: 'Unknown route.' }); return; }
      // Read the bounded body before resolving its session. No asynchronous work
      // occurs between lookup and mutation, so expiry cannot detach active state.
      const b = mutation ? await bodyJSON(req) : null;
      const session = sessionFor(req, res, readState);
      if (readState) {
        send(res, 200, { ...session.state, pending: session.pending && { id: session.pending.id, ...session.pending.proposal }, canUndo: session.undo.length > 0, sessionStarted: res.hasHeader('set-cookie') }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/plan') {
        session.pending = null;
        const proposal = proposeCoverage(session.state, b.command);
        if (proposal.ok) session.pending = { id: randomUUID(), proposal };
        send(res, 200, { ...proposal, ...(session.pending ? { proposalId: session.pending.id } : {}) }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/dismiss') {
        if (!session.pending || b.proposalId !== session.pending.id) {
          send(res, 409, { error: 'That proposal is no longer pending.' }); return;
        }
        session.pending = null;
        send(res, 200, { message: 'Pending proposal discarded without modifying the schedule.' }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/approve') {
        if (!session.pending || b.proposalId !== session.pending.id || !Number.isInteger(b.expectedRevision) || session.state.revision !== b.expectedRevision) {
          send(res, 409, { error: 'Pending proposal changed or is stale. Please plan again.' }); return;
        }
        const next = applyProposal(session.state, session.pending.proposal);
        session.undo.push(session.state);
        if (session.undo.length > 20) session.undo.shift();
        session.state = next;
        session.pending = null;
        send(res, 200, { message: 'Approved by the coordinator. The local sample schedule has been updated.', state: session.state }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/undo') {
        if (b.expectedRevision !== session.state.revision || !session.undo.length) {
          send(res, 409, { error: 'No matching approval to undo. Refresh the schedule.' }); return;
        }
        const prior = session.undo.pop();
        prior.revision = session.state.revision + 1; // strictly increasing, including after undo
        session.state = prior;
        session.pending = null;
        send(res, 200, { message: 'The last local approval was undone.', state: session.state }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/reset') {
        if (!Number.isInteger(b.expectedRevision) || b.expectedRevision !== session.state.revision) {
          send(res, 409, { error: 'The event changed. Refresh before resetting it.' }); return;
        }
        const revision = session.state.revision + 1;
        session.state = seedEvent(); session.state.revision = revision;
        session.pending = null; session.undo.length = 0;
        send(res, 200, { message: 'Synthetic event reset to its initial state.', state: session.state }); return;
      }
      send(res, 404, { error: 'Unknown route.' });
    } catch (e) { send(res, e.status || 400, { error: e.message || 'Request rejected.', ...(e.code === 'session_expired' ? { code: e.code } : {}) }); }
  });
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 8787);
  createServer().listen(port, '127.0.0.1', () => console.log(`ShiftLoom simulated Alexa+ experience at http://127.0.0.1:${port}`));
}

