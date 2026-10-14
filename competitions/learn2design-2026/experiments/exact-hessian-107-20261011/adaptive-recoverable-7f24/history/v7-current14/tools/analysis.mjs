// MIT — Original native logged-history analysis; no Objective execution or score substitution.
export function createHistoryAnalysis({sha256Utf8}) {
 const copy=x=>JSON.parse(JSON.stringify(x)), finite=x=>typeof x==="number"&&Number.isFinite(x);
 const canonical=x=>x===null||typeof x!=="object"?JSON.stringify(x):Array.isArray(x)?"["+x.map(canonical).join(",")+"]":"{"+Object.keys(x).sort().map(k=>JSON.stringify(k)+":"+canonical(x[k])).join(",")+"}";
 const require=(ok,message)=>{if(!ok)throw Error(message);};
 const quantile=(a,q)=>{if(!a.length)return null;const b=a.slice().sort((x,y)=>x-y),p=(b.length-1)*q,i=Math.floor(p);return b[i]+(b[Math.ceil(p)]-b[i])*(p-i);};
 function analyzeCell(cell,origin={}) {
  require(cell?.schema==="tjlabs.l2d.candidate084.public-uifo-cell/v1","Unknown native cell schema");
  const raw=cell.raw, n=raw?.loss?.length;
  require(Number.isInteger(n)&&n>0,"Original complete loss history is required");
  for(const name of ["loss","time_s","is_feasible","feasibility_known"])require(Array.isArray(raw[name])&&raw[name].length===n,"Misaligned original "+name);
  require(Array.isArray(raw.call_widths)&&raw.call_widths.every(x=>Number.isInteger(x)&&x>0)&&raw.call_widths.reduce((a,b)=>a+b,0)===n,"Original call widths do not cover the logged points");
  require(raw.time_s.every((x,i)=>finite(x)&&x>=0&&(!i||x>=raw.time_s[i-1])),"Invalid original elapsed history");
  require(raw.is_feasible.every(x=>typeof x==="boolean")&&raw.feasibility_known.every(x=>typeof x==="boolean"),"Original feasibility flags must be explicit booleans");
  require(cell.candidate_unchanged===true&&cell.candidate_before?.sha256===cell.candidate_after?.sha256,"Candidate source changed or is unbound");
  require(cell.metrics?.eval_count_matches_points===true&&cell.metrics.eval_count===n,"Original Objective count does not match logged points");
  const budget=cell.cell?.max_time_s;require(finite(budget)&&budget>0,"Original finite physical budget is required");
  const source=cell.candidate_before.sha256,runner=cell.runner?.sha256;
  require(/^[a-f0-9]{64}$/.test(source)&&/^[a-f0-9]{64}$/.test(runner||""),"Full candidate and runner source identities are required");
  const diagnostics=copy(cell.algorithm_diagnostics||{}), trace=diagnostics.trace||[];
  let best=null,first=null,lastImprovement=null,previousTime=0,offset=0;
  const points=[],calls=[],improvements=[];
  for(let call=0;call<raw.call_widths.length;call++){
   const width=raw.call_widths[call], end=offset+width, t=raw.time_s[end-1];
   require(raw.time_s.slice(offset,end).every(x=>x===t),"Batched points do not share their original call timestamp");
   const dt=t-previousTime, callPoints=[];
   for(let i=offset;i<end;i++){
    const loss=raw.loss[i], feasible=raw.feasibility_known[i]&&raw.is_feasible[i]&&finite(loss), improved=feasible&&(best===null||loss<best);
    if(feasible&&first===null)first={point:i+1,call:call+1,time_s:t,loss};
    if(improved){best=loss;lastImprovement={point:i+1,call:call+1,time_s:t,loss};improvements.push(copy(lastImprovement));}
    const row={point:i+1,call:call+1,call_width:width,time_s:t,budget_fraction:t/budget,interval_s:dt,loss:finite(loss)?loss:null,known:raw.feasibility_known[i],feasible,improved,best_feasible:best};
    points.push(row);callPoints.push(row);
   }
   const tr=trace.find(x=>x?.call===call+1), aligned=width===1&&tr&&tr.loss===callPoints[0].loss&&tr.feasible===callPoints[0].feasible;
   calls.push({call:call+1,time_s:t,interval_s:dt,points:width,feasible_points:callPoints.filter(p=>p.feasible).length,improved:callPoints.some(p=>p.improved),mode:aligned&&typeof tr.mode==="string"?tr.mode:null,trace:aligned?copy(tr):null});
   previousTime=t;offset=end;
  }
  function runs(predicate){const result=[];let start=null;
   for(let i=0;i<=calls.length;i++){if(i<calls.length&&predicate(calls[i],i)){if(start===null)start=i;}else if(start!==null){result.push({from_call:start+1,to_call:i,calls:i-start,start_s:start?calls[start-1].time_s:0,end_s:calls[i-1].time_s,seconds:calls[i-1].time_s-(start?calls[start-1].time_s:0)});start=null;}}
   return result;
  }
  const infeasibleRuns=runs(c=>c.feasible_points===0), plateauRuns=runs((c,i)=>first!==null&&c.call>first.call&&!c.improved);
  const checkpoints=[.05,.1,.2,.25,.4,.5,.6,.75,.8,.9,1].map(fraction=>{const p=points.filter(p=>p.time_s<=fraction*budget),f=p.filter(p=>p.feasible);return{fraction,seconds:fraction*budget,logged_points:p.length,feasible_points:f.length,best_feasible:f.length?f.reduce((best,x)=>Math.min(best,x.loss),Infinity):null};});
  const windows=Array.from({length:5},(_,i)=>{const from=i*.2*budget,to=(i+1)*.2*budget,p=points.filter(x=>x.time_s>from&&x.time_s<=to),cc=calls.filter(x=>x.time_s>from&&x.time_s<=to);return{from_s:from,to_s:to,points:p.length,calls:cc.length,feasible_points:p.filter(x=>x.feasible).length,improvements:p.filter(x=>x.improved).length,best_feasible_at_end:[...points].reverse().find(x=>x.time_s<=to)?.best_feasible??null,median_interval_s:quantile(cc.map(x=>x.interval_s),.5)};});
  const environment=copy(cell.environment||{}), problem=copy(cell.problem_spec), timing=copy(cell.budget);
  const elapsed=timing.objective_time_elapsed_s, optimize=timing.optimize_wall_s_incl_warmup;
  const last=points.at(-1), intervals=calls.map(c=>c.interval_s);
  const checks={best_matches_report:best===cell.metrics.best_feasible_loss,feasible_count_matches_report:points.filter(p=>p.feasible).length===cell.metrics.feasible_points,logged_count_matches_report:n===cell.metrics.logged_points,calls_match_report:calls.length===cell.metrics.logged_calls};
  require(Object.values(checks).every(x=>x),"Computed logged-history metrics disagree with original report");
  return {schema:"tjlabs.l2d.history-analysis-cell/v1",origin:copy(origin),arm:cell.arm||cell.algorithm_str,topology_seed:cell.cell.topology_seed,algorithm_seed:cell.cell.algorithm_seed,seconds:budget,status:cell.status,error:cell.error,source_sha256:source,runner_sha256:runner,requirements:copy(cell.requirements??null),problem_spec:problem,environment,runtime_group:sha256Utf8(canonical(environment)),source_invocation:copy(cell.invocation??null),first_feasible:first,best_feasible:lastImprovement,logged_points:n,logged_calls:calls.length,feasible_points:points.filter(p=>p.feasible).length,unknown_points:points.filter(p=>!p.known).length,interval_summary:{first_s:intervals[0],median_s:quantile(intervals,.5),p10_s:quantile(intervals,.1),p90_s:quantile(intervals,.9),last_s:intervals.at(-1)},timing:{...timing,last_logged_s:last.time_s,unlogged_tail_s:finite(elapsed)?elapsed-last.time_s:null,unused_budget_s:finite(elapsed)?budget-elapsed:null,warmup_and_nonlogging_s:finite(optimize)&&finite(elapsed)?optimize-elapsed:null},infeasible_runs:infeasibleRuns,post_feasible_plateaus:plateauRuns,checkpoints,windows,diagnostics,points,calls,checks,comparison_policy:"Use original compare_native.py with explicit current or verified historical SOURCES for paired claims. This explorer displays the complete native histories and retains missing bindings as missing."};
 }
 function analyzePanel(value,origin={}) {
  const cells=Array.isArray(value?.cells)?value.cells:[value],accepted=[],unavailable=[];
  for(let i=0;i<cells.length;i++)try{accepted.push(analyzeCell(cells[i],{...origin,cell_index:i}));}catch(e){unavailable.push({cell_index:i,arm:cells[i]?.arm??cells[i]?.algorithm_str??null,topology_seed:cells[i]?.cell?.topology_seed??null,reason:e.message});}
  return{schema:"tjlabs.l2d.history-analysis/v1",origin:copy(origin),cells:accepted,unavailable,retained_panel_context:{hardware:value?.hardware??null,environment:value?.environment??null,baseline_reused_from:copy(value?.baseline_reused_from??null),fara_v12_reused_from:copy(value?.fara_v12_reused_from??null)},definitions:{interval_s:"Difference between consecutive original logged call timestamps. Includes elapsed algorithm/Objective work; not an isolated physics-kernel timing.",feasible:"Original known feasibility true and finite logged loss.",plateau:"Consecutive logged calls after first feasibility without a strictly lower logged feasible loss.",mode:"Joined only when an actual per-call diagnostic record agrees on call, loss and feasibility; otherwise unknown.",control_receipts:"Saved aggregate control outcomes remain context; absent control trajectories are never interpolated."}};
 }
 function csv(analysis){const cols=["arm","topology_seed","algorithm_seed","seconds","source_sha256","runner_sha256","point","call","call_width","time_s","interval_s","loss","known","feasible","improved","best_feasible"];const q=v=>'"'+String(v??"").replaceAll('"','""')+'"';return cols.map(q).join(",")+"\r\n"+analysis.cells.flatMap(c=>c.points.map(p=>cols.map(k=>q(Object.hasOwn(p,k)?p[k]:c[k])).join(","))).join("\r\n")+"\r\n";}
 return {analyzeCell,analyzePanel,csv,canonical};
}
