/** ONLY targeted simulation contract. Run: node --test test.mjs */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {plan,DEMO} from './engine.mjs';
import {makeAgent} from './agent.mjs';
test('lower bill, joint kW cap and quiet-hour windows',()=>{
 const p=plan(DEMO);assert.ok(p.avoidedCost>0,'optimizer should have a genuine cheaper feasible choice');
 assert.ok(Math.max(...p.optimized.hourlyKw)<=DEMO.maxKw+1e-9);
 for(const e of p.optimized.items){const t=DEMO.tasks.find(x=>x.id===e.id);
  assert.ok(e.start>=t.earliest&&e.end<=t.deadline);
  if(t.quiet)for(let h=e.start;h<e.end;h++)assert.ok(h>=7&&h<22);
 }
});
test('no simulated dispatch without matching human approval; exact replay idempotent',()=>{
 const a=makeAgent();const original=a.offer().proposal.id;
 assert.throws(()=>a.execute(original),/approved/);
 a.approve(original);const done=a.execute(original);assert.equal(done.receipt.liveDeviceCalls,0);
 assert.equal(a.execute(original).receipt.id,done.receipt.id);
 const next=a.offer().proposal.id;assert.notEqual(next,original);assert.throws(()=>a.approve(original),/Stale/);
});
