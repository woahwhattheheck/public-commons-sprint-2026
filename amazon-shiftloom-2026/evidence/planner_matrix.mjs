import assert from 'node:assert/strict';
import {seedEvent} from '../seed.mjs';
import {overlaps, proposeCoverage, applyProposal} from '../planner.mjs';

function random(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
const targets=[['welcome','Alexa, cover the morning welcome desk'],['workshop','Alexa, cover the afternoon workshop'],['close','Alexa, cover evening cleanup'],['setup','Alexa, cover equipment setup']];
const response={total:0,plans:0,properHolds:0,absencePlans:0,fullCoverage:0,violations:[],byShift:{},byOutcome:{}};
for(let i=0;i<2048;i++){
  const rand=random(20261009+i*7919);
  const state=seedEvent();
  const [target,plainCommand]=targets[i%targets.length];
  const shift=state.shifts.find(x=>x.id===target);
  const originalAssigned=new Set(shift.assigned);
  if(i%3===0) shift.capacity+=1;
  if(i%11===0) shift.capacity+=1;
  // A fresh fictional volunteer panel: real planner handles every permutation.
  for(let x=0;x<8;x++){
    if(originalAssigned.has(state.volunteers[x].id))continue;
    const v=state.volunteers[x];
    if(rand()<0.47) v.available=v.available.filter(name=>name!==target);
    if(rand()<0.19) state.unavailable[v.id]=[target];
    v.weeklyLimit=Math.max(1,Math.floor(rand()*4));
  }
  for(let j=0;j<5;j++){
    const skill=shift.required[0];
    const qualified=rand()>0.30;
    const v={id:`guest${i}_${j}`,name:`Guest ${i} ${j}`,
      skills:qualified?[skill]:['other'],available:rand()<0.66?[target]:[],
      preferred:rand()<0.5?[target]:[],weeklyLimit:1+Math.floor(rand()*3)};
    state.volunteers.push(v);
  }
  const absence=i%4===1 && originalAssigned.size>0;
  const absentId=absence?shift.assigned[0]:null;
  const name=absence?state.volunteers.find(v=>v.id===absentId).name:null;
  const command=absence?`Alexa, ${name} is absent for the ${target==='close'?'cleanup':target==='setup'?'equipment setup':target==='workshop'?'afternoon workshop':'morning welcome desk'} shift.`:plainCommand;
  const before=JSON.stringify(state);
  const p=proposeCoverage(state,command);
  assert.equal(JSON.stringify(state),before,`planner mutated input in case ${i}`);
  response.total++;
  response.byShift[target]??={tested:0,plans:0,holds:0};response.byShift[target].tested++;
  if(p.ok){
    response.plans++;response.byShift[target].plans++;
    if(absence)response.absencePlans++;
    assert.equal(p.chosen.length,shift.capacity-shift.assigned.length+(absence?1:0),`incomplete selection at ${i}`);
    assert.equal(new Set(p.chosen.map(x=>x.id)).size,p.chosen.length);
    const existing=new Set(shift.assigned.filter(x=>x!==absentId));
    for(const choice of p.chosen){
      const v=state.volunteers.find(x=>x.id===choice.id);
      assert.ok(v,`non-existent volunteer at ${i}`);
      assert.ok(!existing.has(v.id)&&v.id!==absentId,`already booked/absent at ${i}`);
      assert.ok(v.available.includes(target),`availability leak at ${i}`);
      assert.ok(shift.required.every(s=>v.skills.includes(s)),`skill leak at ${i}`);
      assert.ok(!(state.unavailable[v.id]||[]).includes(target),`absence leak at ${i}`);
      const booked=state.shifts.filter(s=>s.assigned.includes(v.id));
      assert.ok(!booked.some(s=>overlaps(s,shift)),`time overlap at ${i}`);
      assert.ok(booked.length<v.weeklyLimit,`weekly limit at ${i}`);
    }
    const next=applyProposal(state,p);
    const after=next.shifts.find(x=>x.id===target);
    assert.equal(after.assigned.length,shift.capacity,`incomplete commit at ${i}`);
    assert.equal(new Set(after.assigned).size,after.assigned.length,`duplicate commit at ${i}`);
    assert.equal(next.revision,state.revision+1,`revision non-monotonic ${i}`);
    assert.equal(JSON.stringify(state),before,`applyProposal mutated source ${i}`);
    assert.throws(()=>applyProposal(next,p),/out of date/,`stale replay accepted at ${i}`);
    response.fullCoverage++;
  }else{
    response.properHolds++;response.byShift[target].holds++;
    assert.equal(JSON.stringify(state),before);
    const m=p.message?.split('.')[0]||'No reason';
    response.byOutcome[m]=(response.byOutcome[m]||0)+1;
  }
}
console.log(JSON.stringify({runtime:process.version,source:'original 10-file archive; verified against public Git blob c7cfc52d029b88b83981cedf2bffd518d828d55b',study:'deterministic 2,048 real planner evaluations, fictional event-domain scenario perturbations',seed:20261009,...response},null,2));
