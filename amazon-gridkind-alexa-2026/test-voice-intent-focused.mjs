// One focused agent-intent safety check against source-exact agent.mjs + synthetic scheduler stub.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeAgent} from './agent.mjs';

test('cancel plan does not generate a replacement and invalidates old approval',()=>{
  const agent=makeAgent();
  const first=agent.say('Find a cheaper schedule').proposal.id;
  const approved=agent.approve(first);assert.equal(approved.approved,true);
  const done=agent.say('Cancel the plan');
  assert.equal(done.status,'empty');
  assert.equal(done.proposal,null);assert.equal(done.approved,false);
  assert.equal(done.history.at(-1).kind,'cancel');
  assert.throws(()=>agent.execute(first),/approved|Exact plan/);
  assert.equal(done.history.filter(h=>h.kind==='plan').length,1);
});

test('negated instructions fail closed without mutation',()=>{
  const agent=makeAgent();const created=agent.offer();
  const source=JSON.stringify(created);
  for(const utterance of ["don't schedule anything",'Do not plan a schedule','never optimize',"don't want to cancel the plan",'not reset']){
    assert.throws(()=>agent.say(utterance),/Negated action/,utterance);
    assert.equal(JSON.stringify(agent.view()),source,utterance);
  }
});

test('read-only intent precedence and ambiguous compound commands',()=>{
  const agent=makeAgent();const p=agent.offer().proposal.id;
  const original=JSON.stringify(agent.view());
  for(const utterance of ['Explain the plan','Show cheaper schedule','Why plan this?','Status']){
    assert.equal(JSON.stringify(agent.say(utterance)),original,utterance);
  }
  assert.throws(()=>agent.say('Explain why I should cancel the plan'),/Ambiguous/);
  assert.equal(agent.view().proposal.id,p);
  assert.equal(agent.say('Reset').status,'empty');
  assert.equal(agent.say('Discard old plan').status,'empty');
  assert.equal(agent.say('plan').status,'proposed');
});

test('approval/execute remains explicit; malformed and unrelated utterances reject',()=>{
  const agent=makeAgent();
  assert.throws(()=>agent.say('approve and execute'),/Try/);
  assert.throws(()=>agent.say('x'.repeat(241)),/240/);
  const proposal=agent.say('schedule').proposal;
  assert.throws(()=>agent.execute(proposal.id),/approved/);
  assert.equal(agent.approve(proposal.id).approved,true);
  const view=agent.execute(proposal.id);
  assert.equal(view.receipt.liveDeviceCalls,0);assert.equal(view.receipt.simulated,true);
  assert.equal(agent.execute(proposal.id).receipt.id,view.receipt.id);
});
