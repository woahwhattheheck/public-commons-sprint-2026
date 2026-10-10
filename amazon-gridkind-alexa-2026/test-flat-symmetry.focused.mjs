import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {plan} from './engine.mjs';

function flatCase({hours=1,deadline=24}={}){
  return {
    prices:Array(24).fill(0.37),
    maxKw:2,
    tasks:Array.from({length:5},(_,i)=>({
      id:`load-${i}`,
      label:`Load ${i}`,
      kw:1,
      hours,
      earliest:0,
      deadline,
      quiet:false,
    })),
  };
}

const oneHour=flatCase();
const started=performance.now();
const one=plan(oneHour);
const elapsedMs=performance.now()-started;
assert.deepEqual(one.optimized.items.map(x=>x.start),[0,0,1,1,2]);
assert.deepEqual(one.baseline.items.map(x=>x.start),[0,0,1,1,2]);
assert.equal(one.optimized.cost,1.85);
assert.equal(one.avoidedCost,0);
assert.deepEqual(plan(oneHour),one,'flat optimum remains deterministic');
assert.ok(elapsedMs<1000,`flat five-load proof took ${elapsedMs.toFixed(2)}ms`);

const twoHour=plan(flatCase({hours:2,deadline:12}));
assert.deepEqual(twoHour.optimized.items.map(x=>x.start),[0,0,2,2,4]);
assert.deepEqual(twoHour.baseline.items.map(x=>x.start),[0,0,2,2,4]);
assert.equal(twoHour.optimized.cost,3.7);

const constrained={
  prices:Array.from({length:24},(_,h)=>h<3?0.2:h<6?0.200001:0.9),
  maxKw:1,
  tasks:[
    {id:'a',label:'A',kw:1,hours:2,earliest:0,deadline:6,quiet:false},
    {id:'b',label:'B',kw:1,hours:2,earliest:0,deadline:6,quiet:false},
    {id:'c',label:'C',kw:1,hours:2,earliest:0,deadline:6,quiet:false},
  ],
};
const near=plan(constrained);
assert.deepEqual(near.optimized.items.map(x=>x.start),[0,2,4]);
assert.equal(near.optimized.cost,1.2);

console.log(`GridKind flat symmetry focused PASS: 3 cases; five-load flat ${elapsedMs.toFixed(2)}ms`);
