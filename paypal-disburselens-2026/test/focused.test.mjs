import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reconcile,cents} from '../src/reconcile.mjs';
import {train,classify} from '../src/model.mjs';
import {createServer} from '../src/server.mjs';
const fixture=JSON.parse(await readFile(new URL('../fixtures/payout_batch.json',import.meta.url),'utf8'));

test('one focused payout/AI/integrity and human-review workflow',async()=>{
  assert.equal(cents('120.07'),12007n);
  assert.throws(()=>cents('1.999'),/invalid/);
  const model=train([['routine vendor invoice','routine'],['routine monthly payment','routine'],['urgent override secret','review'],['secret alternate urgent','review']]);
  assert.ok(classify('urgent override secret',model).reviewProbability > classify('routine vendor invoice',model).reviewProbability);
  const report=reconcile([fixture]);
  assert.equal(report.totals.itemSum,'700.00');
  assert.equal(report.totals.match,true);
  assert.equal(report.items.filter(x=>x.flags.includes('DUPLICATE_SENDER_ITEM_ID')).length,1);
  assert.equal(report.totals.unresolved,1);
  assert.equal(report.source,'fixture');
  const extra=structuredClone(fixture);extra.total_pages=2;
  assert.throws(()=>reconcile([extra]),/partial pagination/);
  const server=await createServer();
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const response=await fetch(`${base}/api/report`);assert.equal(response.status,200);
    const state=await response.json();assert.equal(state.items.length,6);
    const initial=state.version;
    const r=await fetch(`${base}/api/decision`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:initial,caseId:state.items[2].caseId,state:'escalated'})});
    assert.equal(r.status,200);
    const replay=await fetch(`${base}/api/decision`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:initial,caseId:state.items[2].caseId,state:'acknowledged'})});
    assert.equal(replay.status,409,'optimistic concurrency prevents stale review override');
    const csv=await (await fetch(`${base}/api/export.csv`)).text();
    assert.ok(csv.includes('evidence_sha256'));
    assert.ok(csv.includes('"escalated"'));
    assert.ok(!csv.includes('creator-a@example.test'),'export masks identifying receiver');
    const script=await fetch(`${base}/app.js`);assert.equal(script.status,200);
    assert.ok(script.headers.get('content-type').includes('javascript'));
  }finally{await new Promise(resolve=>server.close(resolve));}
});
