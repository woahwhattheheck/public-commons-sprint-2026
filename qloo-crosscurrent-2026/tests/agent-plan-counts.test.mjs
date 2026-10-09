// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCulturalPlan, makeSyntheticDemo} from '../src/agent.mjs';

// An HTTP fetcher, in-flight cache and unrelated visitors may share the server's
// QlooClient. Its process-lifetime `calls` must never become a plan usage number.
test('concurrent and subsequent plans each report only their own logical Qloo lookups', async () => {
  const client = {
    calls: 110,
    search: async () => [{id:'seed123',name:'Jazz'}],
    insights: async (type, ids) => {
      await Promise.resolve();
      if (type === 'artist') return [{id:'artist456',name:'Music partner'}];
      if (type === 'place') return [{id: ids.length===2 ? 'venue2' : 'venue1', name:'Local venue'}];
      return [];
    }
  };
  const plans = await Promise.all([
    makeCulturalPlan({seed:'Jazz',goal:'community-night'},client),
    makeCulturalPlan({seed:'Jazz',goal:'pop-up-market'},client)
  ]);
  for (const plan of plans) {
    assert.equal(plan.status,'LIVE_QLOO_EVIDENCE');
    assert.equal(plan.qloo_requests,7); // search, 5 domains, one two-signal place hop
    assert.equal(plan.qloo_request_metric,'logical_plan_lookups');
  }
  const third = await makeCulturalPlan({seed:'Jazz'},client);
  assert.equal(third.qloo_requests,7);
  assert.equal(client.calls,110); // The display must not read this global number.
});

test('abstentions and fictional demo report precise, local operation counts', async () => {
  const empty = await makeCulturalPlan({seed:'Unknown'}, {calls:90,search:async()=>[]});
  assert.equal(empty.status,'NO_ENTITY_MATCH');
  assert.equal(empty.qloo_requests,1);
  const unavailable = await makeCulturalPlan({seed:'Jazz'}, {
    calls:70,search:async()=>[{id:'seed123',name:'Jazz'}],
    insights:async()=>{throw Object.assign(new Error('Qloo failed'),{code:'QLOO_RATE_LIMIT'});}
  });
  assert.equal(unavailable.status,'UPSTREAM_INSIGHTS_UNAVAILABLE');
  assert.equal(unavailable.qloo_requests,6); // No second inference hop after total failure.
  assert.equal(makeSyntheticDemo({seed:'Jazz'}).qloo_requests,0);
});
