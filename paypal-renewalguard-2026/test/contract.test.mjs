import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO, summarize, validId } from '../src/logic.mjs';

test('synthetic cases distinguish active, suspended, and cancelled without private data', () => {
  const statuses = DEMO.map(summarize);
  assert.deepEqual(statuses.map(x=>x.tier),['LOW','HIGH','CLOSED']);
  assert.ok(statuses.every(x=>!x.outreach_permitted && !x.money_action_permitted));
  assert.ok(statuses.every(x=>!/email|payer|amount/i.test(JSON.stringify(x))));
  assert.notEqual(statuses[0].fingerprint,statuses[1].fingerprint);
  assert.ok(validId('I-DEMOSUSPEND1'));
  assert.equal(validId('../oops'),false);
});
test('stale status change invalidates human review fingerprint',()=>{
  const a=summarize(DEMO[0]), b=summarize({...DEMO[0],status:'SUSPENDED'});
  assert.notEqual(a.fingerprint,b.fingerprint);
  assert.equal(b.tier,'HIGH');
});
