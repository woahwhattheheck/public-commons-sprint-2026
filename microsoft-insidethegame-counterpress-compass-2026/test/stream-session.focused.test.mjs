import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {makeSnapshot, derive} from '../src/engine.mjs';
import {generateMatch, scenarioList} from '../src/scenarios.mjs';

process.env.NODE_ENV = 'test';
const {server} = await import('../src/server.mjs');
let base;
before(async () => { await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port; });
after(() => { server.closeAllConnections(); server.close(); });

const VIEW = {team: 'Harbor FC', audience: 'casual', locale: 'en'};
async function post(path, body) {
  const r = await fetch(base + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  return {status: r.status, body: await r.json()};
}
async function readFrames(path, n, headers = {}) {
  const ac = new AbortController();
  const out = [];
  try {
    const r = await fetch(base + path, {headers, signal: ac.signal});
    assert.equal(r.status, 200);
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, {stream: true});
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        if (/^event: frame$/m.test(block)) {
          const line = block.split('\n').find(l => l.startsWith('data: '));
          out.push(JSON.parse(line.slice(6)));
        }
      }
      if (out.length >= n) break;
    }
  } catch (e) { if (e.name !== 'AbortError') throw e; }
  finally { ac.abort(); }
  return out.slice(0, n);
}

test('generator is seed-reproducible, scenario-distinct and never produces interrupted windows', () => {
  for (const {id} of scenarioList()) {
    const a = generateMatch(id, 41), b = generateMatch(id, 41), c = generateMatch(id, 42);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
    assert.notDeepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(c)));
    assert.equal(a.at(-1).second, 5400);
    assert.ok(derive(a).every(x => x.status !== 'interrupted'));
  }
  const presses = s => generateMatch(s, 7).filter(e => e.type === 'pressure').length;
  assert.ok(presses('high-press') > presses('end-to-end'));
});

test('session summary hides events; SSE frames equal engine snapshots of the exact prefix', async () => {
  const s = await post('/api/sessions', {scenario: 'high-press', seed: 11});
  assert.equal(s.status, 201);
  assert.ok(!('events' in s.body));
  const gen = generateMatch('high-press', 11);
  const frames = await readFrames(`/api/sessions/${s.body.id}/stream?from=0&speed=8`, 4);
  assert.deepEqual(frames.map(f => f.count), [1, 2, 3, 4]);
  for (const f of frames) {
    assert.ok(!('events' in f));
    assert.deepEqual(f.event, gen[f.count - 1]);
    const snap = makeSnapshot(gen.slice(0, f.count), VIEW);
    assert.deepEqual(f.stats, snap.stats);
    assert.deepEqual(f.overlays, snap.overlays);
  }
});

test('Last-Event-ID resume beats ?from and continues without duplicates', async () => {
  const s = await post('/api/sessions', {scenario: 'low-block', seed: 5});
  const frames = await readFrames(`/api/sessions/${s.body.id}/stream?from=0&speed=8`, 2, {'Last-Event-ID': '3'});
  assert.deepEqual(frames.map(f => f.count), [4, 5]);
});

test('interleaved sessions stay isolated to their own seed and scenario', async () => {
  const [a, b] = await Promise.all([post('/api/sessions', {scenario: 'high-press', seed: 21}), post('/api/sessions', {scenario: 'end-to-end', seed: 22})]);
  const [fa, fb] = await Promise.all([
    readFrames(`/api/sessions/${a.body.id}/stream?speed=8`, 5),
    readFrames(`/api/sessions/${b.body.id}/stream?speed=8&team=Metro%20Rovers&locale=es`, 5)]);
  const ga = generateMatch('high-press', 21), gb = generateMatch('end-to-end', 22);
  fa.forEach(f => { assert.equal(f.sessionId, a.body.id); assert.deepEqual(f.event, ga[f.count - 1]); assert.equal(f.locale, 'en'); });
  fb.forEach(f => { assert.equal(f.sessionId, b.body.id); assert.deepEqual(f.event, gb[f.count - 1]); assert.equal(f.team, 'Metro Rovers'); assert.equal(f.locale, 'es'); });
});

test('frame seek returns only the prefix; bad input and expired sessions are rejected', async () => {
  const s = await post('/api/sessions', {scenario: 'late-siege', seed: 9});
  const f = await post(`/api/sessions/${s.body.id}/frame`, {count: 6, ...VIEW});
  assert.equal(f.status, 200);
  assert.equal(f.body.events.length, 6);
  assert.deepEqual(f.body.events, JSON.parse(JSON.stringify(generateMatch('late-siege', 9).slice(0, 6))));
  assert.equal((await post(`/api/sessions/${s.body.id}/frame`, {count: s.body.total + 1})).status, 400);
  assert.equal((await post('/api/sessions', {scenario: 'late-siege', seed: 0})).status, 400);
  const del = await fetch(base + '/api/sessions/' + s.body.id, {method: 'DELETE'});
  assert.equal(del.status, 204);
  assert.equal((await fetch(base + `/api/sessions/${s.body.id}/stream`)).status, 404);
});
