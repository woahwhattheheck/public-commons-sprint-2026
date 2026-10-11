import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

async function start(t) {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const url = 'http://127.0.0.1:' + server.address().port;
  return (initialCookie = '') => {
    let cookie = initialCookie;
    return {
      get cookie() { return cookie; },
      async call(path, body) {
        const response = await fetch(url + '/api/' + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        return { status: response.status, data: await response.json(), setCookie };
      }
    };
  };
}

test('reviewers retain independent proposal, approval, undo and monotonic reset state', async t => {
  const visitor = await start(t), a = visitor(), b = visitor();
  const initialA = await a.call('state'), initialB = await b.call('state');
  assert.equal(initialA.status, 200);
  assert.equal(initialA.data.sessionStarted, true);
  assert.equal(initialB.status, 200);
  assert.notEqual(a.cookie, b.cookie);
  assert.ok(initialA.setCookie.endsWith('; HttpOnly; SameSite=Strict; Path=/'));
  const aPlan = await a.call('plan', { command: 'Cover the welcome desk' });
  const bPlan = await b.call('plan', { command: 'Cover the afternoon workshop' });
  assert.equal(aPlan.data.ok, true);
  assert.equal(bPlan.data.ok, true);
  assert.equal((await a.call('state')).data.pending.id, aPlan.data.proposalId);
  assert.equal((await b.call('approve', { proposalId: aPlan.data.proposalId, expectedRevision: 0 })).status, 409);
  assert.equal((await b.call('dismiss', { proposalId: aPlan.data.proposalId })).status, 409);
  const aApproved = await a.call('approve', { proposalId: aPlan.data.proposalId, expectedRevision: 0 });
  assert.equal(aApproved.status, 200);
  assert.equal(aApproved.data.state.revision, 1);
  const bStillPending = await b.call('state');
  assert.equal(bStillPending.data.revision, 0);
  assert.equal(bStillPending.data.pending.id, bPlan.data.proposalId);
  const bApproved = await b.call('approve', { proposalId: bPlan.data.proposalId, expectedRevision: 0 });
  assert.equal(bApproved.status, 200);
  const bCommitted = (await b.call('state')).data;
  assert.equal((await a.call('undo', { expectedRevision: 1 })).data.state.revision, 2);
  assert.deepEqual((await b.call('state')).data, bCommitted);
  const aReplanned = await a.call('plan', { command: 'Cover the welcome desk' });
  assert.equal((await a.call('reset', { expectedRevision: 1 })).status, 409);
  assert.equal((await a.call('reset', {})).status, 409);
  assert.equal((await a.call('reset', { expectedRevision: '2' })).status, 409);
  assert.equal((await a.call('state')).data.pending.id, aReplanned.data.proposalId);
  const aReset = await a.call('reset', { expectedRevision: 2 });
  assert.equal(aReset.status, 200);
  assert.equal(aReset.data.state.revision, 3);
  assert.deepEqual(aReset.data.state.shifts, initialA.data.shifts);
  const aState = (await visitor('unrelated=value; ' + a.cookie).call('state')).data;
  assert.equal(aState.revision, 3);
  assert.equal(aState.pending, null);
  assert.equal(aState.canUndo, false);
  assert.equal((await a.call('approve', { proposalId: aReplanned.data.proposalId, expectedRevision: 2 })).status, 409);
  assert.equal((await a.call('undo', { expectedRevision: 3 })).status, 409);
  assert.deepEqual((await b.call('state')).data, bCommitted);
});

test('unknown and expired cookies cannot mutate or silently reuse another event', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const visitor = await start(t), a = visitor(), b = visitor();
  for (const missing of [visitor(), visitor('shiftloom_sid=00000000-0000-0000-0000-000000000000')]) {
    const denied = await missing.call('reset', { expectedRevision: 0 });
    assert.equal(denied.status, 409);
    assert.equal(denied.data.code, 'session_expired');
    assert.equal(denied.setCookie, null);
  }
  await a.call('state');
  await b.call('state');
  const staleCookie = a.cookie;
  const oldPlan = await a.call('plan', { command: 'Cover the welcome desk' });
  now += 30 * 60 * 1000;
  await b.call('state');
  now += 30 * 60 * 1000;
  const expired = await a.call('approve', { proposalId: oldPlan.data.proposalId, expectedRevision: 0 });
  assert.equal(expired.status, 409);
  assert.equal(expired.data.code, 'session_expired');
  assert.equal(expired.setCookie, null);
  assert.equal(a.cookie, staleCookie);
  const renewed = await a.call('state');
  assert.equal(renewed.status, 200);
  assert.notEqual(a.cookie, staleCookie);
  assert.equal(renewed.data.revision, 0);
  assert.equal(renewed.data.sessionStarted, true);
  assert.equal(renewed.data.pending, null);
  assert.equal((await a.call('approve', { proposalId: oldPlan.data.proposalId, expectedRevision: 0 })).status, 409);
  const bCookie = b.cookie;
  const bRetained = await b.call('state');
  assert.equal(bRetained.status, 200);
  assert.equal(bRetained.data.sessionStarted, false);
  assert.equal(b.cookie, bCookie);
});

test('session capacity rejects only new visitors and idle expiry makes room', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const visitor = await start(t), sessions = [];
  for (let index = 0; index < 100; index++) {
    const client = visitor();
    assert.equal((await client.call('state')).status, 200);
    sessions.push(client);
  }
  const newcomer = visitor(), full = await newcomer.call('state');
  assert.equal(full.status, 503);
  assert.equal(full.setCookie, null);
  const survivor = sessions[0], cookie = survivor.cookie;
  now += 30 * 60 * 1000;
  const plan = await survivor.call('plan', { command: 'Cover the welcome desk' });
  assert.equal(plan.data.ok, true);
  assert.equal((await survivor.call('approve', { proposalId: plan.data.proposalId, expectedRevision: 0 })).status, 200);
  now += 30 * 60 * 1000;
  assert.equal((await newcomer.call('state')).status, 200);
  const surviving = await survivor.call('state');
  assert.equal(surviving.data.revision, 1);
  assert.equal(survivor.cookie, cookie);
  assert.equal((await sessions[1].call('reset', { expectedRevision: 0 })).status, 409);
});
