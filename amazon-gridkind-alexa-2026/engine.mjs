/** GridKind — deterministic joint load scheduler. All prices/devices are user-owned DEMO inputs. */
export const DEMO = Object.freeze({
  prices: Array.from({length:24},(_,h)=>h>=17&&h<21?0.43:(h>=21||h<7)?0.12:0.25),
  maxKw:3,
  tasks:[
    {id:'laundry',label:'Laundry',kw:1.2,hours:2,earliest:8,deadline:21,quiet:true},
    {id:'dishwasher',label:'Dishwasher',kw:1,hours:2,earliest:12,deadline:24,quiet:true},
    {id:'ev-topup',label:'EV top-up',kw:2.6,hours:3,earliest:17,deadline:24,quiet:false},
  ],
});
export function inputs(value=DEMO) {
  if (!value || typeof value!=='object') throw Error('Input object required');
  const {prices,tasks,maxKw}=value;
  if (!Array.isArray(prices)||prices.length!==24||prices.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0||x>10)) throw Error('Expected 24 hourly $/kWh quotes');
  if (typeof maxKw!=='number'||!Number.isFinite(maxKw)||maxKw<0.5||maxKw>50) throw Error('Max kW must be in range 0.5..50');
  if (!Array.isArray(tasks)||tasks.length<1||tasks.length>5) throw Error('Supply 1..5 flexible loads');
  const ids=new Set();
  for(const t of tasks){
    if(typeof t.id!=='string'||!/^[a-z0-9-]{1,32}$/.test(t.id)||ids.has(t.id))throw Error('Each task must have unique safe ID');ids.add(t.id);
    if(typeof t.label!=='string'||t.label.length>80)throw Error('Invalid task label');
    if(!Number.isInteger(t.hours)||t.hours<1||t.hours>6||!Number.isInteger(t.earliest)||!Number.isInteger(t.deadline)||t.earliest<0||t.earliest<0||t.deadline>24||t.earliest+t.hours>t.deadline)throw Error('Invalid task window');
    if(typeof t.kw!=='number'||!Number.isFinite(t.kw)||t.kw<=0||t.kw>maxKw)throw Error('Task exceeds max circuit power');
    if(typeof t.quiet!=='boolean')throw Error('Task quiet flag required');
  }
  return {prices:prices.slice(),maxKw,tasks:tasks.map(t=>({...t}))};
}
function quiet(h){return h>=22||h<7}
function candidates(t){
  const times=[];
  for(let start=t.earliest;start<=t.deadline-t.hours;start++) {
    if(!t.quiet||Array.from({length:t.hours},(_,k)=>start+k).every(h=>!quiet(h)))times.push(start);
  }
  return times;
}
function fits(t,start,occupied,maxKw){
  for(let h=start;h<start+t.hours;h++)if(occupied[h]+t.kw>maxKw+1e-9)return false;
  return true;
}
function placement(t,start,occupied,dir){for(let h=start;h<start+t.hours;h++)occupied[h]+=dir*t.kw}
function costOf(t,start,prices){return t.kw*prices.slice(start,start+t.hours).reduce((a,b)=>a+b,0)}
function snapshot(tasks,starts,prices,maxKw){
  const profile=Array(24).fill(0);
  return {items:tasks.map((task,i)=>{
    const start=starts[i];placement(task,start,profile,1);
    return {id:task.id,label:task.label,start,end:start+task.hours,kw:task.kw,kwh:task.kw*task.hours,cost:Number(costOf(task,start,prices).toFixed(4))};
  }),cost:Number(tasks.reduce((s,t,i)=>s+costOf(t,starts[i],prices),0).toFixed(4)),hourlyKw:profile.map(v=>Number(v.toFixed(4))),maxKw};
}
export function plan(raw=DEMO){
  const {prices,tasks,maxKw}=inputs(raw);
  const choices=tasks.map(candidates);
  if(choices.some(x=>x.length===0))throw Error('No eligible quiet-hour window for at least one load');
  const occupied=Array(24).fill(0);
  const starts=[];
  let baselineStarts=null,winning=null,best=Infinity;
  function visit(i,total){
    if(i===tasks.length){
      // First complete placement is the earliest jointly feasible baseline.
      // A greedy prefix can block a later fixed load despite a valid schedule.
      if(!baselineStarts)baselineStarts=starts.slice();
      if(total<best-1e-10){best=total;winning=starts.slice();}
      return;
    }
    const task=tasks[i];
    for(const start of choices[i]){
      if(!fits(task,start,occupied,maxKw))continue;
      const next=total+costOf(task,start,prices);
      if(next>best+1e-10)continue;
      placement(task,start,occupied,1);starts.push(start);visit(i+1,next);starts.pop();placement(task,start,occupied,-1);
    }
  }
  visit(0,0);
  if(!baselineStarts)throw Error('No feasible shared-circuit schedule');
  const baseline=snapshot(tasks,baselineStarts,prices,maxKw);
  const optimized=snapshot(tasks,winning,prices,maxKw);
  return {schema:'gridkind-sim-v1',disclaimer:'Hypothetical quoted prices and devices; no actual grid, meter or device has been read or controlled.',
    baseline,optimized,avoidedCost:Math.max(0,(Math.round(baseline.cost*100)-Math.round(optimized.cost*100))/100),prices,decisionTrace:{search:'enumerate joint finite task windows',constraints:['task deadlines','quiet hours','max simultaneous kW'],optionsEvaluated:choices.map(a=>a.length)},
  };
}
