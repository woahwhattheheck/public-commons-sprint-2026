import test from 'node:test';
import assert from 'node:assert/strict';
import { seedEvent } from '../seed.mjs';
import { proposeCoverage, applyProposal } from '../planner.mjs';
import { createServer } from '../server.mjs';

test('welcome coverage chooses a qualified fair candidate, not Leo overlapping setup', () => {
  const p = proposeCoverage(seedEvent(), 'Alexa, cover the welcome desk');
  assert.equal(p.ok, true);
  assert.equal(p.chosen.length, 1);
  assert.equal(p.chosen[0].id, 'iris');
  assert.equal(p.rejected.clash, 1);
  assert.match(p.trace.at(-1).result, /human approval/i);
});

test('reported absence removes original volunteer and fills all openings without rebooking absent person', () => {
  const state = seedEvent();
  const p = proposeCoverage(state, "Alexa, Maya can't make the morning welcome desk. Find a replacement.");
  assert.equal(p.ok, true);
  assert.equal(p.changes[0].action, 'remove');
  assert.equal(p.changes.length, 3); // Maya removed; both slots must be backfilled
  const next = applyProposal(state, p);
  const shift = next.shifts.find(s => s.id === 'welcome');
  assert.equal(shift.assigned.length, 2);
  assert.ok(!shift.assigned.includes('maya'));
  assert.deepEqual(next.unavailable.maya, ['welcome']);
  assert.deepEqual(state.shifts.find(s => s.id === 'welcome').assigned, ['maya']);
});

test('insufficient qualified candidates refuse partial publication', () => {
  const state = seedEvent();
  state.volunteers = state.volunteers.filter(x => x.id !== 'priya');
  const p = proposeCoverage(state, 'Alexa, cover the afternoon workshop');
  assert.equal(p.ok, true); // Zoe is a valid mentor and suffices for one opening
  state.volunteers = state.volunteers.filter(x => x.id !== 'zoe');
  const impossible = proposeCoverage(state, 'Alexa, cover the afternoon workshop');
  assert.equal(impossible.ok, false);
  assert.match(impossible.message, /not publish an understaffed schedule/i);
});

test('ambiguous or unknown absence cannot silently alter a schedule', () => {
  const state = seedEvent();
  assert.equal(proposeCoverage(state, 'Cover the shift').ok, false);
  assert.equal(proposeCoverage(state, "Alexa, Jamie can't make welcome").ok, false);
  assert.equal(proposeCoverage(state, 'Cover welcome and workshop').ok, false);
});

test('HTTP workflow enforces approval id, revision, stale replay, undo and reset', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  async function call(path, body) {
    const r = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  }
  const initial = await call('/api/state');
  assert.equal(initial.status, 200);
  const p = await call('/api/plan', { command: 'Alexa, cover the morning welcome desk' });
  assert.equal(p.status, 200);
  assert.equal(p.data.ok, true);
  const dismissed = await call('/api/dismiss', { proposalId: p.data.proposalId });
  assert.equal(dismissed.status, 200);
  assert.equal((await call('/api/approve', { proposalId: p.data.proposalId, expectedRevision: 0 })).status, 409);
  const replanned = await call('/api/plan', { command: 'Alexa, cover the morning welcome desk' });
  assert.equal(replanned.status, 200);
  const afterPlan = await call('/api/state');
  assert.equal(afterPlan.data.revision, 0);
  assert.equal(afterPlan.data.shifts.find(s => s.id === 'welcome').assigned.length, 1);
  assert.equal((await call('/api/approve', { proposalId: 'fake', expectedRevision: 0 })).status, 409);
  const commit = await call('/api/approve', { proposalId: replanned.data.proposalId, expectedRevision: 0 });
  assert.equal(commit.status, 200);
  assert.equal(commit.data.state.shifts.find(s => s.id === 'welcome').assigned.length, 2);
  assert.equal((await call('/api/approve', { proposalId: p.data.proposalId, expectedRevision: 0 })).status, 409);
  assert.equal((await call('/api/undo', { expectedRevision: 0 })).status, 409);
  const undo = await call('/api/undo', { expectedRevision: 1 });
  assert.equal(undo.status, 200);
  assert.equal(undo.data.state.revision, 2);
  assert.equal(undo.data.state.shifts.find(s => s.id === 'welcome').assigned.length, 1);
  const reset = await call('/api/reset', {});
  assert.equal(reset.status, 200);
  assert.equal(reset.data.state.revision, 0);
});
