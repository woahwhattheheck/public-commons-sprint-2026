/** GridKind rate robustness. Original scheduler stays the sole optimizer. MIT. */
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inputs, plan} from '../engine.mjs';

const money = value => Number(value.toFixed(4));
const costAt = (tasks, fixed, prices) => {
  // Same order-stable monetary presentation as the original engine.
  const entries = tasks.map(t => {
    const start = fixed.get(t.id);
    if (!Number.isInteger(start) || start < t.earliest || start + t.hours > t.deadline)
      throw Error(`Original schedule does not fit task ${t.id}`);
    if (t.quiet && Array.from({length:t.hours}, (_,i)=>start+i).some(h=>h >= 22 || h < 7))
      throw Error(`Original schedule breaks quiet hours for ${t.id}`);
    let total=0;
    for (let h=start;h<start+t.hours;h++) total += t.kw*prices[h];
    return {id:t.id,total};
  }).sort((a,b)=>a.id.localeCompare(b.id,'en'));
  return money(entries.reduce((sum,x)=>sum+x.total,0));
};

export function analyze(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('One input object is required');
  const base = inputs(input.base);
  const alternatives = input.alternatives;
  if (!Array.isArray(alternatives) || alternatives.length < 1 || alternatives.length > 8)
    throw Error('Supply 1..8 alternative 24-hour tariffs');
  const original = plan(base);
  const fixed = new Map(original.optimized.items.map(({id,start})=>[id,start]));
  const names=new Set();
  const rows=alternatives.map((alternative,index)=>{
    if (!alternative || typeof alternative !== 'object' || Array.isArray(alternative) ||
        typeof alternative.name !== 'string' || !/^[\w .()/-]{1,60}$/.test(alternative.name))
      throw Error(`Alternative ${index+1} needs a short readable name`);
    if(names.has(alternative.name.toLowerCase()))throw Error('Duplicate alternative tariff name');
    names.add(alternative.name.toLowerCase());
    const scenario=inputs({...base,prices:alternative.prices});
    const replanned=plan(scenario);
    const originalStartCost=costAt(base.tasks,fixed,scenario.prices);
    const betterCost=replanned.optimized.cost;
    if (betterCost > originalStartCost + 0.00011) throw Error('Original scheduler cost exceeds fixed candidate');
    const moves=replanned.optimized.items.filter(t=>fixed.get(t.id)!==t.start)
      .map(t=>({id:t.id,label:t.label,fromHour:fixed.get(t.id),toHour:t.start}));
    return {
      name:alternative.name,
      ratesUsdPerKwh:scenario.prices,
      retainedScheduleCostUsd:originalStartCost,
      freshlyOptimizedCostUsd:betterCost,
      regretUsd:money(Math.max(0,originalStartCost-betterCost)),
      repricingVsOriginalUsd:money(originalStartCost-original.optimized.cost),
      moves,
      optimizedSchedule:replanned.optimized.items.map(t=>({id:t.id,startHour:t.start,endHour:t.end})),
    };
  });
  return {
    schema:'gridkind-rate-robustness-v1',
    basis:'Exact original GridKind engine.mjs plan() for initial and each reoptimized tariff; fixed-plan cost is repriced at each alternate tariff.',
    notice:'All tariffs and loads are hypothetical. No utility feed, smart-home device, or actual savings observed. Reoptimization is a separate recommendation, not automatic execution or reapproval.',
    inputSha256:createHash('sha256').update(JSON.stringify({base,alternatives})).digest('hex'),
    original:{optimizedCostUsd:original.optimized.cost,avoidedCostUsd:original.avoidedCost,
      hourlyRatesUsdPerKwh:base.prices,
      schedule:original.optimized.items.map(t=>({id:t.id,label:t.label,startHour:t.start,endHour:t.end,kwh:t.kwh}))},
    alternatives:rows,
  };
}

const esc = str => String(str).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd = number => `$${number.toFixed(4)}`;
export function renderHtml(result) {
  if (result?.schema!=='gridkind-rate-robustness-v1') throw Error('Expected rate robustness report');
  const max=Math.max(0.0001,...result.alternatives.map(x=>x.regretUsd));
  const cards=result.alternatives.map((r,i)=>{
    const pct=100*r.regretUsd/max;
    const changed=r.moves.length ? r.moves.map(m=>`${esc(m.label)} ${m.fromHour}:00 → ${m.toHour}:00`).join(' · ') : 'No schedule changes';
    return `<article class="panel"><div class="eyebrow">SCENARIO ${i+1}</div><h2>${esc(r.name)}</h2>
      <div class="values"><div><span>Keep approved schedule</span><strong>${usd(r.retainedScheduleCostUsd)}</strong></div>
      <div><span>Replan under new tariff</span><strong>${usd(r.freshlyOptimizedCostUsd)}</strong></div>
      <div><span>Replanning opportunity</span><strong>${usd(r.regretUsd)}</strong></div></div>
      <div class="bar" role="img" aria-label="Replanning cost difference ${usd(r.regretUsd)}"><div style="width:${pct.toFixed(1)}%"></div></div>
      <p class="muted">${changed}</p></article>`;
  }).join('\n');
  const originals=result.original.schedule.map(t=>`<tr><td>${esc(t.label)}</td><td>${t.startHour}:00–${t.endHour}:00</td><td>${t.kwh.toFixed(2)} kWh</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>GridKind · Tariff robustness</title><style>
:root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#eaf1ff;background:#0b1324;color-scheme:dark}
*{box-sizing:border-box}body{margin:0}main{width:min(1100px,calc(100% - 40px));margin:50px auto 90px}
.eyebrow{font-size:12px;letter-spacing:.17em;font-weight:800;color:#8bb4ff}h1{font-size:clamp(34px,6vw,68px);line-height:1.04;margin:12px 0 22px;letter-spacing:-.05em}
h2{font-size:21px;margin:9px 0 26px}.lead{font-size:18px;color:#c3d2e9;line-height:1.55;max-width:740px}
.summary{margin:30px 0 26px;padding:22px 26px;border:1px solid #304263;border-radius:17px;background:#142039;display:flex;gap:35px;flex-wrap:wrap}
.summary strong{font-size:25px;display:block}.muted,.summary span{color:#a6b9d7;font-size:13px}.layout{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}
.panel{background:#15223b;border:1px solid #304263;padding:23px;border-radius:18px}.values{display:grid;gap:18px}.values div{display:flex;justify-content:space-between;gap:16px;align-items:baseline}.values span{font-size:13px;color:#bdcce6}.values strong{font-size:19px;font-variant-numeric:tabular-nums}.bar{height:9px;background:#293754;border-radius:10px;margin:22px 0 14px;overflow:hidden}.bar div{height:100%;border-radius:10px;background:linear-gradient(90deg,#54c4bd,#a1a6ff)}
.tablebox{overflow-x:auto;margin:34px 0}table{width:100%;border-collapse:collapse}th{text-align:left;color:#9cb5db;text-transform:uppercase;letter-spacing:.12em;font-size:12px}td,th{padding:15px 12px;border-bottom:1px solid #304263}td{font-size:14px}footer{border-top:1px solid #304263;margin-top:42px;padding-top:20px;font-size:13px;color:#a6b9d7;line-height:1.6}code{font-size:11px;word-break:break-all}
</style></head><body><main><div class="eyebrow">GRIDKIND / DECISION QUALITY</div>
<h1>Will this schedule<br>still make sense?</h1><p class="lead">A tariff changes after planning. Keep the original schedule or recompute the best feasible schedule from the exact same GridKind optimizer.</p>
<div class="summary"><div><span>Original optimized cost</span><strong>${usd(result.original.optimizedCostUsd)}</strong></div>
<div><span>Alternative tariffs evaluated</span><strong>${result.alternatives.length}</strong></div><div><span>Automatic device actions</span><strong>0</strong></div></div>
<section class="layout">${cards}</section><section class="tablebox"><h2>Initially planned loads</h2><table><thead><tr><th>Flexible load</th><th>Hours</th><th>Energy</th></tr></thead><tbody>${originals}</tbody></table></section>
<footer>${esc(result.notice)}<p>Input SHA-256: <code>${esc(result.inputSha256)}</code></p></footer></main></body></html>`;
}

async function cli(argv) {
  if (!argv.length || argv.length > 5 || argv[0].startsWith('-')) {
    console.error('Usage: node robustness/compare.mjs input.json [--json report.json] [--html report.html]');
    return 2;
  }
  let jsonPath,htmlPath;
  for(let i=1;i<argv.length;i+=2){
    if(!argv[i+1] || !['--json','--html'].includes(argv[i]))throw Error('Expected --json or --html followed by filename');
    if(argv[i]==='--json'&&!jsonPath)jsonPath=argv[i+1];
    else if(argv[i]==='--html'&&!htmlPath)htmlPath=argv[i+1];
    else throw Error('Duplicate option');
  }
  const bytes=await readFile(argv[0]);
  if(bytes.length>120000)throw Error('Input too large');
  const result=analyze(JSON.parse(bytes.toString('utf8')));
  const output=JSON.stringify(result,null,2)+'\n';
  if(jsonPath)await writeFile(jsonPath,output,{flag:'wx'});
  if(htmlPath)await writeFile(htmlPath,renderHtml(result),{flag:'wx'});
  if(!jsonPath)process.stdout.write(output);
  return 0;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then(code=>{process.exitCode=code},error=>{console.error(error.message);process.exitCode=2});
}
