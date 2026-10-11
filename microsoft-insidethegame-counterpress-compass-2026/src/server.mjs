import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';
import {makeSnapshot, TEAMS, validateFixture} from './engine.mjs';
import {foundryConfigured, suggestedNarrative} from './foundry.mjs';
import {createFoundryAdmission} from './foundry_quota.mjs';
import {createOpusCommentary} from './opus_commentary.mjs';
import {createEvidenceExport, evidenceCsv} from './evidence_export.mjs';
import {scenarioList, DEFAULT_SCENARIO} from './scenarios.mjs';
import {createSessionStore, parseView, parseSpeed, parseCount, resumeCursor, delayMs} from './live_sessions.mjs';
import {createMatchArchiveStore, MAX_PACKAGE_BYTES, MAX_REVIEW_BYTES} from './match_archive.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FIXTURE = JSON.parse(await readFile(join(ROOT, 'data', 'events.json'), 'utf8'));
validateFixture(FIXTURE);
const TYPES = {'/':'text/html; charset=utf-8', '/app.js':'text/javascript; charset=utf-8', '/archive.js':'text/javascript; charset=utf-8', '/style.css':'text/css; charset=utf-8'};
const ROUTES = {'/': 'index.html', '/app.js': 'app.js', '/archive.js': 'archive.js', '/style.css': 'style.css'};
const DEFAULT_PORT = 3167;
// Existing local replay remains free; admitted paid attempts count even on failure.
const foundryAdmission = createFoundryAdmission();
// Separate optional AI insight; paid work only via the operator's budget runner.
const opus = createOpusCommentary();
export const sessions = createSessionStore();
const sweeper = setInterval(() => sessions.sweep(), 60 * 1000);
sweeper.unref();
// A collection belongs to a random browser key; shared replay links carry only
// the unguessable read ID. The native match stays usable if storage is offline.
let archiveStore;
function archives() {
  if (!archiveStore) archiveStore = createMatchArchiveStore({
    directory: process.env.COUNTERPRESS_ARCHIVE_DIR || join(homedir(), '.local', 'share', 'counterpress-compass', 'matches'),
  }).catch(() => {
    archiveStore = null;
    throw Object.assign(new Error('Saved-match storage is unavailable; the match player is still usable'), {status: 503});
  });
  return archiveStore;
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(body);
}
async function getJSON(req, maxBytes = 8192) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('Expected application/json'), {status:415});
  let length = 0;
  const chunks = [];
  for await (const c of req) {
    length += c.length;
    if (length > maxBytes) throw Object.assign(new Error('Body exceeds ' + Math.floor(maxBytes / 1024) + 'KB'), {status:413});
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), {status:400}); }
}
function objectBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Object body required'), {status:400});
  return body;
}
function parseChoice(body) {
  objectBody(body);
  const count = body.count;
  if (!Number.isInteger(count) || count < 0 || count > FIXTURE.length) throw Object.assign(new Error('count must be 0..'+FIXTURE.length), {status:400});
  if (body.team !== undefined && !TEAMS.includes(body.team)) throw Object.assign(new Error('Unknown team'), {status:400});
  if (body.audience !== undefined && !['casual','analyst'].includes(body.audience)) throw Object.assign(new Error('Unknown audience'), {status:400});
  if (body.locale !== undefined && !['en','es'].includes(body.locale)) throw Object.assign(new Error('Unknown locale'), {status:400});
  return {count, team: body.team || TEAMS[0], audience: body.audience || 'casual', locale: body.locale || 'en'};
}
function runSnapshot(body) {
  const {count, ...choice} = parseChoice(body);
  return {count, selectedEvents: FIXTURE.slice(0, count),
    ...makeSnapshot(FIXTURE.slice(0,count), choice)};
}
function sessionSnapshot(body) {
  const s = sessions.get(body.sessionId);
  const count = parseCount(body.count, s.events.length);
  return makeSnapshot(s.events.slice(0, count), parseView({team: body.team, audience: body.audience, locale: body.locale}));
}

function streamSession(req, res, id, url) {
  const q = url.searchParams;
  const s = sessions.get(id);
  const view = parseView({team: q.get('team') ?? undefined, audience: q.get('audience') ?? undefined, locale: q.get('locale') ?? undefined});
  const speed = parseSpeed(q.get('speed'));
  let cursor = resumeCursor(req.headers['last-event-id'], q.get('from'), s.events.length);
  let timer = null;
  const handle = sessions.attachStream(id, () => { clearTimeout(timer); res.end(); });
  res.writeHead(200, {'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.write('retry: 2000\n\n');
  const finish = () => { clearTimeout(timer); handle.release(); };
  req.on('close', finish);
  res.on('error', finish);
  const emit = () => {
    if (!handle.isCurrent()) return;
    if (cursor >= s.events.length) {
      res.write('event: end\ndata: ' + JSON.stringify({sessionId: id, count: cursor}) + '\n\n');
      finish();
      res.end();
      return;
    }
    cursor += 1;
    handle.touch();
    const frame = sessions.frame(id, cursor, view);
    res.write('id: ' + cursor + '\nevent: frame\ndata: ' + JSON.stringify(frame) + '\n\n');
    const gap = cursor < s.events.length ? s.events[cursor].second - s.events[cursor - 1].second : 0;
    timer = setTimeout(emit, delayMs(gap, speed));
  };
  timer = setTimeout(emit, 40);
}

export const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    if (req.method === 'GET' && path === '/health') return send(res, 200, {ok: true, fixture: 'synthetic', foundryConfigured: foundryConfigured(), opusConfigured: opus.configured(), liveSessions: sessions.size()});
    if (req.method === 'GET' && path === '/api/bootstrap') return send(res, 200, {
      fixture: 'SYNTHETIC ONLY', teams: TEAMS, events: FIXTURE,
      scenarios: scenarioList(), defaultScenario: DEFAULT_SCENARIO,
      rules: {counterpressWindowSeconds:8, success:'same-team loss, pressure action and regain within window'},
      foundryConfigured: foundryConfigured(), opusConfigured: opus.configured(), providerCallsOnReplay:0,
    });
    // Historical route kept for source compatibility; not linked from the product UI.
    if (req.method === 'GET' && path === '/api/evidence-export') {
      const query = url.searchParams;
      const allowed = new Set(['count', 'team', 'audience', 'locale', 'format']);
      if ([...query.keys()].some(key => !allowed.has(key)) ||
          [...allowed].some(key => query.getAll(key).length > 1)) {
        return send(res, 400, {error: 'Unknown or repeated export parameter'});
      }
      const countString = query.get('count');
      if (countString === null || !/^(?:0|[1-9][0-9]{0,3})$/.test(countString)) {
        return send(res, 400, {error: 'Select a valid event-prefix count'});
      }
      const format = query.get('format') || 'json';
      if (format !== 'json' && format !== 'csv') {
        return send(res, 400, {error: 'Export format must be json or csv'});
      }
      const snapshot = runSnapshot({
        count: Number(countString), team: query.get('team') || TEAMS[0],
        audience: query.get('audience') || 'casual', locale: query.get('locale') || 'en'
      });
      const report = createEvidenceExport(snapshot);
      const body = format === 'csv' ? evidenceCsv(report) : JSON.stringify(report, null, 2) + '\n';
      res.writeHead(200, {
        'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="counterpress-frame-' +
          snapshot.count + '.' + format + '"',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
      });
      return res.end(body);
    }
    if (req.method === 'POST' && path === '/api/analyze') return send(res, 200, runSnapshot(await getJSON(req)));
    if (req.method === 'POST' && path === '/api/sessions') {
      const body = objectBody(await getJSON(req));
      return send(res, 201, sessions.create(body.scenario ?? DEFAULT_SCENARIO, body.seed));
    }
    const parts = path.split('/');
    if (path === '/api/archives' || path.startsWith('/api/archives/')) {
      const store = await archives();
      const libraryKey = req.headers['x-counterpress-library'];
      if (path === '/api/archives' && req.method === 'GET')
        return send(res, 200, {archives: await store.list(libraryKey), limits: store.limits});
      if (path === '/api/archives' && req.method === 'POST') {
        const body = objectBody(await getJSON(req, MAX_REVIEW_BYTES));
        return send(res, 201, await store.saveSession(sessions.get(body.sessionId), body.review, libraryKey));
      }
      if (path === '/api/archives/import' && req.method === 'POST')
        return send(res, 201, await store.importPackage(objectBody(await getJSON(req, MAX_PACKAGE_BYTES)), libraryKey));
      if (parts.length >= 4 && parts.length <= 5 && parts[1] === 'api' && parts[2] === 'archives') {
        const id = parts[3], action = parts[4];
        if (action === undefined && req.method === 'GET') return send(res, 200, await store.get(id, libraryKey));
        if (action === undefined && req.method === 'PUT') {
          const body = objectBody(await getJSON(req, MAX_REVIEW_BYTES));
          return send(res, 200, await store.update(id, body.revision, body.review, libraryKey));
        }
        if (action === undefined && req.method === 'DELETE') {
          const body = objectBody(await getJSON(req));
          await store.remove(id, body.revision, libraryKey);
          res.writeHead(204, {'Cache-Control': 'no-store'}); return res.end();
        }
        if (action === 'open' && req.method === 'POST') {
          objectBody(await getJSON(req));
          const {archive, match} = await store.open(id, libraryKey);
          return send(res, 201, {archive, session: sessions.restore(match)});
        }
        if (action === 'export' && req.method === 'GET') {
          const body = JSON.stringify(await store.exportPackage(id), null, 2) + '\n';
          res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
            'Content-Disposition': 'attachment; filename="counterpress-match-' + id + '.json"'});
          return res.end(body);
        }
      }
      return send(res, 404, {error: 'Not found'});
    }
    if (parts.length >= 4 && parts.length <= 5 && parts[1] === 'api' && parts[2] === 'sessions') {
      const id = parts[3];
      const action = parts[4];
      if (action === undefined && req.method === 'DELETE') { sessions.drop(id); res.writeHead(204, {'Cache-Control':'no-store'}); return res.end(); }
      if (action === undefined && req.method === 'GET') return send(res, 200, sessions.describe(id));
      if (action === 'frame' && req.method === 'POST') {
        const body = objectBody(await getJSON(req));
        return send(res, 200, sessions.frame(id, body.count, {team: body.team, audience: body.audience, locale: body.locale}, {includePrefix: true}));
      }
      if (action === 'stream' && req.method === 'GET') return streamSession(req, res, id, url);
      return send(res, 404, {error:'Not found'});
    }
    if (req.method === 'POST' && path === '/api/opus-commentary') {
      if (!opus.configured()) return send(res, 503, {error:'Optional AI insight not configured'});
      const body = objectBody(await getJSON(req));
      if (typeof body.sessionId !== 'string') return send(res, 400, {error:'Match session required'});
      const s = sessions.get(body.sessionId);
      const count = parseCount(body.count, s.events.length);
      const events = s.events.slice(0, count);
      const snapshot = makeSnapshot(events, parseView({team: body.team, audience: body.audience, locale: body.locale}));
      if (!snapshot.overlays.length) return send(res, 422, {error:'No counterpress moment yet in this match'});
      const out = await opus.request({sessionId: body.sessionId, count, snapshot, events});
      if (out.state === 'busy') { res.setHeader('Retry-After', String(out.retryAfterSeconds)); return send(res, 429, {state:'busy', retryAfterSeconds: out.retryAfterSeconds}); }
      return send(res, out.state === 'pending' ? 202 : 200, out);
    }
    if (req.method === 'POST' && path === '/api/foundry-draft') {
      if (!foundryConfigured()) return send(res, 503, {error:'Optional Foundry not configured'});
      const body = objectBody(await getJSON(req));
      const snapshot = body.sessionId !== undefined ? sessionSnapshot(body) : runSnapshot(body);
      const latest = snapshot.overlays.at(-1);
      if (!latest) return send(res, 422, {error:'No counterpress moment yet in this match'});
      const ticket = foundryAdmission.reserve();
      if (!ticket.ok) {
        res.setHeader('Retry-After', String(ticket.retryAfterSeconds));
        return send(res, 429, {
          error:'Optional Foundry call capacity reached', retryAfterSeconds:ticket.retryAfterSeconds
        });
      }
      try { return send(res, 200, await suggestedNarrative(latest)); }
      catch { return send(res, 502, {error:'Foundry draft unavailable; deterministic overlay retained'}); }
      finally { ticket.release(); }
    }
    if (req.method === 'GET' && Object.hasOwn(ROUTES,path)) {
      const filename = join(ROOT,'web',ROUTES[path]);
      const buf = await readFile(filename);
      res.writeHead(200, {'Content-Type':TYPES[path], 'Cache-Control':'no-store'});
      return res.end(buf);
    }
    return send(res, 404, {error:'Not found'});
  } catch (e) {
    if (res.headersSent) { res.end(); return; }
    return send(res, e.status || 400, {error: e.status ? e.message : 'Invalid request'});
  }
});

const directRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (directRun && process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('Invalid PORT');
  server.listen(port, host, () => {
    process.stdout.write(`Counterpress Compass synthetic match http://${host}:${port}\n`);
  });
}
