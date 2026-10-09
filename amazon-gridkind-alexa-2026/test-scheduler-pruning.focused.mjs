/** Focused deterministic first-party scheduler equivalence/termination controls.
 * No external devices, tariffs, APIs, or hosted services. Run: node test-scheduler-pruning.focused.mjs
 */
import assert from 'node:assert/strict';
import {plan,inputs,DEMO} from './engine.mjs';

// Separate exhaustive reference used only in small 1..3-task fixtures.
// It does not share the candidate pruning or memoization implementation.
function exhaustive(v){
  const {prices,tasks,maxKw}=inputs(v);
  const startsByTask=tasks.map(t=>Array.from({length:t.deadline-t.hours-t.earliest+1},(_,i)=>i+t.earliest)
    .filter(s=>!t.quiet||Array.from({length:t.hours},(_,k)=>s+k).every(h=>h>=7&&h<22)));
  if(startsByTask.some(x=>!x.length))throw Error('No eligible quiet-hour window for at least one load');
  const occupied=Array(24).fill(0),starts=[];
  let baseline=null,bestStarts=null,best=Infinity;
  function scan(i,total){
    if(i===tasks.length){
      if(!baseline)baseline=starts.slice();
      if(total<best-1e-10){best=total;bestStarts=starts.slice();}
      return;
    }
    const t=tasks[i];
    for(const s of startsByTask[i]){
      if(Array.from({length:t.hours},(_,k)=>s+k).some(h=>occupied[h]+t.kw>maxKw+1e-9))continue;
      for(let h=s;h<s+t.hours;h++)occupied[h]+=t.kw;
      starts.push(s);
      const price=t.kw*prices.slice(s,s+t.hours).reduce((a,b)=>a+b,0);
      scan(i+1,total+price);
      starts.pop();
      for(let h=s;h<s+t.hours;h++)occupied[h]-=t.kw;
    }
  }
  scan(0,0);
  if(!baseline)throw Error('No feasible shared-circuit schedule');
  return {baseline,optimized:bestStarts};
}

let seed=20261009;
function rnd(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;}
const randint=(a,b)=>a+Math.floor(rnd()*(b-a+1));
let successful=0,infeasible=0;
assert.deepEqual(plan(DEMO),plan(DEMO),'demo is deterministic');
for(let k=0;k<400;k++){
  const n=randint(1,3), maxKw=[0.5,1,2,3,10][randint(0,4)];
  const prices=Array.from({length:24},(_,h)=>k%13===0?0:k%13===1?0.25:k%13===2?(h%3)*1e-11:Math.round(rnd()*10000)/1000);
  const tasks=Array.from({length:n},(_,i)=>{
    const earliest=randint(0,20),hours=randint(1,Math.min(6,24-earliest));
    return {id:`task-${i}`,label:`Load ${i}`,kw:Math.max(0.001,Math.min(maxKw,Math.round((rnd()*maxKw+0.001)*1000)/1000)),hours,earliest,deadline:randint(earliest+hours,24),quiet:rnd()<0.5};
  });
  const v={prices,tasks,maxKw};
  let expected;
  try{expected=exhaustive(v);}catch(error){
    assert.throws(()=>plan(v),{message:error.message}); infeasible++; continue;
  }
  const result=plan(v);
  assert.deepEqual(result.baseline.items.map(x=>x.start),expected.baseline,`baseline on randomized ${k}`);
  assert.deepEqual(result.optimized.items.map(x=>x.start),expected.optimized,`optimum on randomized ${k}`);
  assert.ok(result.avoidedCost>=0);
  successful++;
}
// The full 24^5 finite choice space is always valid here, but the first
// all-zero schedule already achieves the global nonnegative lower bound.
const zero={prices:Array(24).fill(0),maxKw:50,tasks:Array.from({length:5},(_,i)=>({id:`zero-${i}`,label:`Zero ${i}`,kw:1,hours:1,earliest:0,deadline:24,quiet:false}))};
const z=plan(zero);
assert.deepEqual(z.baseline.items.map(x=>x.start),[0,0,0,0,0]);
assert.deepEqual(z.optimized.items.map(x=>x.start),[0,0,0,0,0]);
assert.equal(z.avoidedCost,0);
assert.equal(z.optimized.cost,0);
console.log(`GridKind focused scheduler: ${successful} randomized feasible, ${infeasible} randomized rejected, all-zero five-load exhaustive-space case PASS`);
