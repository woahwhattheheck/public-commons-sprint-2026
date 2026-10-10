import test from 'node:test';
import assert from 'node:assert/strict';
import {plan,DEMO} from './engine.mjs';

const prices=[.042,.02,.358,0,0,0,0,.182,.223,.571,.216,.328,.759,.618,.544,0,.874,.592,.83,.333,.556,.632,.494,.55];
const tasks=[
  ['load-0',0.5,5,2,23,false],
  ['load-1',1.15,5,0,18,false],
  ['load-2',0.5,2,15,24,false],
  ['load-3',1.6,2,13,22,true],
  ['load-4',0.75,6,7,21,false],
].map(([id,kw,hours,earliest,deadline,quiet])=>({id,label:id,kw,hours,earliest,deadline,quiet}));
const orders=[[0,1,2,3,4],[4,3,2,1,0],[1,3,4,0,2],[0,2,1,3,4],[2,4,1,3,0],[3,2,0,4,1]];
function byId(items){return Object.fromEntries(items.map(x=>[x.id,x.start]));}

test('issue 421: real legal five-load case has identical plans and cents despite order',()=>{
  const expected={...plan({prices,maxKw:10,tasks})};
  assert.equal(expected.optimized.cost,3.317);
  assert.equal(expected.baseline.cost,4.6674);
  assert.deepEqual(byId(expected.optimized.items),{'load-0':3,'load-1':3,'load-2':15,'load-3':14,'load-4':7});
  for (const order of orders){
    const actual=plan({prices,maxKw:10,tasks:order.map(i=>tasks[i])});
    assert.deepEqual(byId(actual.optimized.items),byId(expected.optimized.items));
    assert.equal(actual.optimized.cost,expected.optimized.cost);
    assert.equal(actual.baseline.cost,expected.baseline.cost);
    assert.equal(actual.avoidedCost,expected.avoidedCost);
    assert.deepEqual(Object.fromEntries(actual.optimized.items.map(x=>[x.id,x.cost])),
      Object.fromEntries(expected.optimized.items.map(x=>[x.id,x.cost])));
  }
});

test('ordinary demo still yields feasible deterministic costs',()=>{
  const a=plan(DEMO);
  const b=plan(DEMO);
  assert.deepEqual(a,b);
  assert.equal(a.schema,'gridkind-sim-v1');
  assert.ok(a.optimized.cost<=a.baseline.cost);
  assert.ok(a.optimized.hourlyKw.every(kw=>kw<=a.optimized.maxKw+1e-9));
});
