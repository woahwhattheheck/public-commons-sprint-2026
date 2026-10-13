import {createHash} from 'node:crypto';
import {parseTariffCSV,tariffDigest} from './tariff-source.mjs';
import {dateAt,inspectWeek} from './weekly.mjs';

export const ENERGY_SCHEMA='gridkind-energy-source/v1';
export const REVIEW_SCHEMA='gridkind-energy-review/v1';
export const energyDigest=tariffDigest;
const HOUR=3600000,DAY=24*HOUR;
const clone=v=>structuredClone(v);
function need(ok,message){if(!ok)throw Error(message);}
function object(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}
function exactKeys(v,keys,label){need(object(v)&&Object.keys(v).every(k=>keys.includes(k)),label+' has unsupported fields.');}
function text(v,label,max,blank=false){need(typeof v==='string'&&v.length<=max&&(blank||v.trim())&&!/[\u0000\uD800-\uDFFF]/u.test(v.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g,'')),label+' is invalid.');return v;}
function clean(v,label,max){const s=text(v,label,max).trim();need(!/[\x00-\x1f\x7f]/.test(s),label+' must be printable.');return s;}
function formatter(zone){return new Intl.DateTimeFormat('en-GB',{timeZone:zone,calendar:'iso8601',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});}
function wall(fmt,ms){const p=Object.fromEntries(fmt.formatToParts(new Date(ms)).filter(v=>v.type!=='literal').map(v=>[v.type,v.value]));return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute+':'+p.second;}
function epoch(token){
 const s=token.trim(),m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(s);
 need(m,'Use ISO timestamps with seconds and an explicit Z or numeric UTC offset.');
 dateAt(m[1]);need(+m[2]<24&&+m[3]<60&&+m[4]<60,'Invalid clock fields; leap seconds are not inferred.');
 const local=Date.parse(m[1]+'T'+m[2]+':'+m[3]+':'+m[4]+'.'+(m[5]||'').padEnd(3,'0')+'Z');
 let offset=0;if(m[6]!=='Z'){const h=+m[6].slice(1,3),min=+m[6].slice(4);need(h<=14&&min<60&&(h!==14||min===0),'Invalid UTC offset.');offset=(h*60+min)*60000*(m[6][0]==='-'?-1:1);}
 return local-offset;
}
function decimal(token,unit){
 const s=token.trim();need(s.length<=64&&/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s),'Use nonnegative interval energy, not cumulative readings, power or net export.');
 let [whole,fraction='']=s.split('.');whole=whole||'0';need(fraction.length<=12,'Energy supports at most 12 decimal places.');
 let digits=(whole+fraction).replace(/^0+(?=\d)/,''),places=fraction.length+(unit==='Wh'?3:0);
 while(digits.length<=places)digits='0'+digits;
 let exact=places?digits.slice(0,-places)+'.'+digits.slice(-places):digits;
 exact=exact.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
 const value=Number(exact);need(Number.isFinite(value)&&value>=0&&value<=1e9,'Energy is outside the supported finite range.');
 return {exact,value};
}
export function energySourceInput(raw){
 exactKeys(raw,['filename','title','sourceUrl','note','role','unit','timezone','meter','mapping','csv'],'Energy source');
 const filename=clean(raw.filename,'Filename',200),title=clean(raw.title,'Title',100),sourceUrl=text(raw.sourceUrl??'','Source URL',2000,true),note=text(raw.note??'','Note',4000,true);
 need(!sourceUrl||/^https?:\/\/[^\s]+$/i.test(sourceUrl),'Retain an HTTP(S) source URL or leave it empty.');
 need(['user_supplied','authored_example'].includes(raw.role),'Identify a user-supplied source or authored example.');
 need(['Wh','kWh'].includes(raw.unit),'Choose interval Wh or kWh. Cumulative meter readings and kW are unsupported.');
 const timezone=clean(raw.timezone,'IANA timezone',100);try{formatter(timezone).format(0);}catch{throw Error('Choose a supported IANA timezone, for example America/New_York or UTC.');}
 exactKeys(raw.meter,['kind','description','loadIds'],'Meter boundary');
 need(['household','submeter'].includes(raw.meter.kind),'Choose whole household or explicitly declared load submeter.');
 const description=clean(raw.meter.description,'Meter boundary description',1000);
 need(Array.isArray(raw.meter.loadIds)&&raw.meter.loadIds.length<=5&&raw.meter.loadIds.every(x=>typeof x==='string'&&x.length>0&&x.length<=100)&&new Set(raw.meter.loadIds).size===raw.meter.loadIds.length,'Select distinct original load IDs.');
 need(raw.meter.kind==='household'?raw.meter.loadIds.length===0:raw.meter.loadIds.length>0,'Whole-household records have no load attribution; a submeter requires its exact original load IDs.');
 exactKeys(raw.mapping,['start','end','energy'],'CSV mapping');
 need(['start','end','energy'].every(k=>typeof raw.mapping[k]==='string'&&raw.mapping[k])&&new Set(Object.values(raw.mapping)).size===3,'Map three distinct original start, end and interval-energy columns.');
 return {filename,title,sourceUrl,note,role:raw.role,unit:raw.unit,timezone,meter:{kind:raw.meter.kind,description,loadIds:[...raw.meter.loadIds]},mapping:{start:raw.mapping.start,end:raw.mapping.end,energy:raw.mapping.energy},csv:text(raw.csv,'Original CSV',1048576)};
}
export function previewEnergySource(raw){
 const input=energySourceInput(raw),parsed=parseTariffCSV(input.csv),indices=Object.fromEntries(Object.entries(input.mapping).map(([k,n])=>[k,parsed.headers.indexOf(n)]));
 need(Object.values(indices).every(x=>x>=0),'A mapped header is missing.');
 const rows=parsed.records.map((r,i)=>{
  const tokens=Object.fromEntries(Object.entries(indices).map(([k,n])=>[k,r.cells[n]??'']));
  const row={sourceRow:i+2,sourceLine:r.line,tokens,startMs:null,endMs:null,exactKwh:null,kwh:null,issues:[]};
  if(r.cells.length!==parsed.headers.length)row.issues.push('column_count');
  for(const k of ['start','end'])try{row[k+'Ms']=epoch(tokens[k]);}catch(e){row.issues.push(k+': '+e.message);}
  if(row.startMs!==null&&row.endMs!==null&&!(row.endMs>row.startMs&&row.endMs-row.startMs<=31*DAY))row.issues.push('duration_must_be_positive_and_at_most_31_days');
  try{const v=decimal(tokens.energy,input.unit);row.exactKwh=v.exact;row.kwh=v.value;}catch(e){row.issues.push(e.message);}
  return row;
 });
 // Overlap is established from valid timing even when an energy value is invalid.
 // Every member of an overlap group is excluded; no "first wins" or averaging.
 const timed=rows.filter(r=>r.startMs!==null&&r.endMs>r.startMs).sort((a,b)=>a.startMs-b.startMs||a.endMs-b.endMs);
 let group=[],end=-Infinity;function finish(){if(group.length>1)for(const r of group)r.issues.push('overlapping_interval');}
 for(const r of timed){if(r.startMs>=end){finish();group=[r];end=r.endMs;}else{group.push(r);end=Math.max(end,r.endMs);}}finish();
 const usable=rows.filter(r=>!r.issues.length),source={...input,bytes:Buffer.byteLength(input.csv,'utf8'),sha256:createHash('sha256').update(input.csv,'utf8').digest('hex')};
 const edition={schema:ENERGY_SCHEMA,source,headers:parsed.headers,rows,summary:{rows:rows.length,usableRows:usable.length,invalidRows:rows.length-usable.length,overlapRows:rows.filter(r=>r.issues.includes('overlapping_interval')).length,usableKwh:usable.reduce((s,r)=>s+r.kwh,0)},
  interpretation:'Original interval energy with explicit-offset instants. All records remain retained. Invalid and overlapping intervals are excluded from arithmetic. Meter boundary is an operator declaration, not independently verified. No device execution or savings is inferred.'};
 return {...edition,sha256:energyDigest(edition)};
}
export function inspectEnergySource(edition){
 need(edition?.schema===ENERGY_SCHEMA,'Unknown energy source format.');
 const fields=Object.fromEntries(['filename','title','sourceUrl','note','role','unit','timezone','meter','mapping','csv'].map(k=>[k,edition.source?.[k]]));
 const expected=previewEnergySource(fields);need(energyDigest(expected)===energyDigest(edition),'Energy source, mapping, rows or diagnostics changed.');return edition;
}
export function energySourceFields(edition){inspectEnergySource(edition);return Object.fromEntries(['filename','title','sourceUrl','note','role','unit','timezone','meter','mapping','csv'].map(k=>[k,clone(edition.source[k])]));}
/** Resolve actual wall-clock boundaries using the runtime's IANA data.
 * A nominal hour is comparable only when both boundaries are unique and exactly
 * one elapsed hour apart. DST gaps/repeats and fractional shifts remain gaps. */
export function weekClock(startDate,timezone){
 const fmt=formatter(timezone),nominal=Date.parse(dateAt(startDate)+'T00:00:00Z'),offsets=new Set();
 for(let t=nominal-2*DAY;t<=nominal+9*DAY;t+=HOUR){const w=wall(fmt,t);offsets.add(Date.parse(w+'Z')-t);}
 function candidates(n){const wanted=new Date(n).toISOString().slice(0,19);return [...offsets].map(o=>n-o).filter(t=>wall(fmt,t)===wanted).sort((a,b)=>a-b);}
 const bounds=Array.from({length:169},(_,i)=>candidates(nominal+i*HOUR));
 const slots=Array.from({length:168},(_,i)=>{const a=bounds[i],b=bounds[i+1],valid=a.length===1&&b.length===1&&b[0]-a[0]===HOUR;
  return {date:dateAt(startDate,Math.floor(i/24)),hour:i%24,startMs:valid?a[0]:null,endMs:valid?b[0]:null,startCandidates:a,endCandidates:b,status:valid?'unique_one_hour':a.length===0||b.length===0?'nonexistent_boundary':a.length>1||b.length>1?'ambiguous_boundary':'non_hour_clock_change'};
 });
 return {timezone,slots,tzdata:process.versions.tz??'unknown',icu:process.versions.icu??'unknown',policy:'Unique local boundaries and exactly one elapsed hour; no DST shifting, repeated-hour merge or inferred interval allocation.'};
}
function selectedPower(day,ids,hour,schedule){
 if(day.status==='infeasible')return null;if(day.status==='rest')return 0;
 return day.plan[schedule].items.filter(x=>ids.has(x.id)&&hour>=x.start&&hour<x.end).reduce((s,x)=>s+x.kw,0);
}
export function reviewEnergy(sourceRecord,weekRecord,{title,note=''}={}){
 need(sourceRecord?.kind==='energy-source'&&weekRecord?.kind==='week','Choose a saved energy source and saved weekly plan.');
 const e=inspectEnergySource(sourceRecord.detail?.edition),week=inspectWeek(weekRecord.detail?.report),meter=e.source.meter;
 title=clean(title??(e.source.title+' review').slice(0,100),'Review title',100);note=text(note,'Review note',4000,true);
 const ids=new Set(meter.loadIds),allIds=new Set(week.input.days.flatMap(d=>d.scenario.tasks.map(t=>t.id)));
 need([...ids].every(id=>allIds.has(id)),'A declared submeter load ID is absent from the selected week.');
 const clock=weekClock(week.input.startDate,e.source.timezone),usable=e.rows.filter(r=>!r.issues.length),rowUse=new Map();
 const rows=clock.slots.map((slot,i)=>{
  const day=week.days[Math.floor(i/24)],price=week.input.days[Math.floor(i/24)].scenario.prices[slot.hour];
  const base={...slot,dayStatus:day.status,sourceRows:[],coverageMs:0,observedKwh:null,observedCostUsd:null,priceUsdPerKwh:price,modeledBaselineKwh:null,modeledOptimizedKwh:null,modeledBaselineCostUsd:null,modeledOptimizedCostUsd:null,differenceFromOptimizedKwh:null,differenceFromOptimizedUsd:null};
  if(slot.status!=='unique_one_hour')return base;
  const intersect=usable.filter(r=>r.startMs<slot.endMs&&r.endMs>slot.startMs),cross=intersect.filter(r=>r.startMs<slot.startMs||r.endMs>slot.endMs);
  for(const r of intersect)rowUse.set(r.sourceRow,[...(rowUse.get(r.sourceRow)||[]),{date:slot.date,hour:slot.hour,status:cross.includes(r)?'crosses_hour_boundary':'contained'}]);
  base.sourceRows=intersect.map(r=>r.sourceRow);
  const exact=intersect.filter(r=>!cross.includes(r)).sort((a,b)=>a.startMs-b.startMs);
  base.coverageMs=exact.reduce((s,r)=>s+r.endMs-r.startMs,0);
  let cursor=slot.startMs,continuous=true;for(const r of exact){if(r.startMs!==cursor)continuous=false;cursor=r.endMs;}
  if(cross.length){base.status='crosses_hour_boundary';return base;}
  if(!continuous||cursor!==slot.endMs){base.status=exact.length?'partial_coverage':'missing';return base;}
  base.status='complete';base.observedKwh=exact.reduce((s,r)=>s+r.kwh,0);base.observedCostUsd=base.observedKwh*price;
  if(meter.kind==='submeter'){
   base.modeledBaselineKwh=selectedPower(day,ids,slot.hour,'baseline');base.modeledOptimizedKwh=selectedPower(day,ids,slot.hour,'optimized');
   if(base.modeledOptimizedKwh!==null){base.modeledBaselineCostUsd=base.modeledBaselineKwh*price;base.modeledOptimizedCostUsd=base.modeledOptimizedKwh*price;base.differenceFromOptimizedKwh=base.observedKwh-base.modeledOptimizedKwh;base.differenceFromOptimizedUsd=base.observedCostUsd-base.modeledOptimizedCostUsd;}
  }
  return base;
 });
 const complete=rows.filter(r=>r.status==='complete'),comparable=complete.filter(r=>r.modeledOptimizedKwh!==null),sum=(a,k)=>a.reduce((s,r)=>s+r[k],0);
 const result={schema:REVIEW_SCHEMA,title,note,binding:{sourceId:sourceRecord.id,sourceSha256:sourceRecord.sha256,sourceEditionSha256:e.sha256,sourceFileSha256:e.source.sha256,weekId:weekRecord.id,weekSha256:weekRecord.sha256},meter:clone(meter),sourceRole:e.source.role,clock,rows,
  sourceDisposition:e.rows.map(r=>({sourceRow:r.sourceRow,sourceLine:r.sourceLine,issues:r.issues,selectedHours:rowUse.get(r.sourceRow)||[],status:r.issues.length?'invalid':rowUse.has(r.sourceRow)?'intersects_selected_hour':'outside_or_unresolvable_selected_clock'})),
  totals:{nominalHours:168,completeHours:complete.length,clockExcludedHours:rows.filter(r=>r.startMs===null).length,incompleteHours:168-complete.length,comparableHours:comparable.length,observedKwh:complete.length?sum(complete,'observedKwh'):null,observedCostUsd:complete.length?sum(complete,'observedCostUsd'):null,modeledBaselineKwh:comparable.length?sum(comparable,'modeledBaselineKwh'):null,modeledOptimizedKwh:comparable.length?sum(comparable,'modeledOptimizedKwh'):null,differenceFromOptimizedKwh:comparable.length?sum(comparable,'differenceFromOptimizedKwh'):null,differenceFromOptimizedUsd:comparable.length?sum(comparable,'differenceFromOptimizedUsd'):null},
  interpretation:{energy:'Only exact, continuous and non-overlapping measurements wholly contained in one selected hour are aggregated. Cross-hour energy is not prorated. Missing, invalid, partial and DST-affected hours contribute no totals, not zero.',
   cost:'Observed interval energy is priced using the exact saved weekly hourly input, in USD/kWh. This is a variable-energy calculation, not a utility bill; taxes, fixed charges, demand charges, exports and net metering are not inferred.',
   comparison:meter.kind==='household'?'Whole-household measurements are retained and priced separately. No measured flexible-load comparison or savings attribution is made.':'Differences compare the operator-declared submeter boundary with the selected modeled loads on the same complete hours. They are signed differences from a hypothetical plan, not causal or verified savings.',
   source:e.source.role==='authored_example'?'This source is explicitly an authored example, not a measured household result.':'The source is user supplied; its physical meter provenance has not been independently verified.'}};
 return {...result,sha256:energyDigest(result)};
}
export function inspectEnergyReview(review,sourceRecord,weekRecord){
 need(review?.schema===REVIEW_SCHEMA,'Unknown saved energy review.');
 const expected=reviewEnergy(sourceRecord,weekRecord,{title:review.title,note:review.note});
 // Retained tzdata metadata is informational. Exact resolved instants must match.
 expected.clock.tzdata=review.clock?.tzdata;expected.clock.icu=review.clock?.icu;
 const {sha256,...body}=expected;expected.sha256=energyDigest(body);
 need(energyDigest(expected)===energyDigest(review),'Saved review or resolved timezone rules differ from its exact sources. Retain this original file and review it with its original runtime.');return review;
}
export function energyCSV(edition){
 inspectEnergySource(edition);
 return csv([['Source record','Source line','Original start','Original end','Original energy','Unit','Start UTC','End UTC','Exact kWh','Issues'],...edition.rows.map(r=>[r.sourceRow,r.sourceLine,r.tokens.start,r.tokens.end,r.tokens.energy,edition.source.unit,r.startMs===null?'':new Date(r.startMs).toISOString(),r.endMs===null?'':new Date(r.endMs).toISOString(),r.exactKwh,r.issues.join('; ')])]);
}
export function reviewCSV(review){return csv([['Local date','Hour','Status','Original source rows','Complete observed kWh','Energy-only cost USD','Saved USD/kWh','Modeled baseline kWh','Modeled optimized kWh','Observed minus optimized kWh','Observed minus optimized USD'],...review.rows.map(r=>[r.date,r.hour,r.status,r.sourceRows.join(';'),r.observedKwh,r.observedCostUsd,r.priceUsdPerKwh,r.modeledBaselineKwh,r.modeledOptimizedKwh,r.differenceFromOptimizedKwh,r.differenceFromOptimizedUsd])]);}
export function csv(rows){return rows.map(row=>row.map(v=>{let s=v===null||v===undefined?'':String(v);if(typeof v!=='number'&&/^[=+\-@\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n')+'\r\n';}
export const htmlEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function energyHTML(record,sourceRecord=null,weekRecord=null){
 const source=record.kind==='energy-source',e=source?inspectEnergySource(record.detail.edition):inspectEnergySource(sourceRecord?.detail.edition),r=source?null:inspectEnergyReview(record.detail.review,sourceRecord,weekRecord);
 const h=htmlEscape,table=(heads,rows)=>'<div class="scroll"><table><thead><tr>'+heads.map(x=>'<th scope="col">'+h(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(a=>'<tr>'+a.map(x=>'<td>'+h(x===null?'Not available':x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 const title=source?e.source.title:r.title;
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+h(title)+' — GridKind</title><style>body{font:16px/1.5 Arial,sans-serif;background:#fff;color:#20252a;margin:0}main{max-width:1150px;margin:auto;padding:24px}h1{font-size:30px}h2{margin-top:32px}.note{padding:16px;border-left:4px solid #52606c;background:#eef1f3}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #ccd2d7;padding:8px;text-align:left;vertical-align:top}th{background:#e9edef}p,td,dd{overflow-wrap:anywhere}dt{font-weight:700}dd{margin:0 0 10px}@media print{main{padding:0}thead{display:table-header-group}tr{break-inside:avoid}.scroll{overflow:visible}table{font-size:8pt}}</style><main><p>TJ Labs · GridKind · '+(source?'Interval-energy source':'Saved energy review')+'</p><h1>'+h(title)+'</h1><p class="note">'+h(e.interpretation)+'</p><dl>'+
 [['Record',record.id],['Record SHA-256',record.sha256],['Saved',record.createdAt],['Original filename',e.source.filename],['Original bytes',e.source.bytes],['Original SHA-256',e.source.sha256],['Source role',e.source.role],['Source URL',e.source.sourceUrl||'Not supplied'],['Source note',e.source.note],['Unit',e.source.unit],['IANA timezone',e.source.timezone],['Meter boundary',e.source.meter.kind+' · '+e.source.meter.description],['Declared load IDs',e.source.meter.loadIds.join(', ')||'None']].map(([k,v])=>'<dt>'+h(k)+'</dt><dd>'+h(v)+'</dd>').join('')+'</dl>'+
 (r?'<h2>Exact saved comparison</h2><p>'+h(r.note)+'</p><dl>'+Object.entries(r.binding).map(([k,v])=>'<dt>'+h(k)+'</dt><dd>'+h(v)+'</dd>').join('')+'</dl>'+Object.values(r.interpretation).map(t=>'<p class="note">'+h(t)+'</p>').join('')+table(['Measure','Value'],Object.entries(r.totals))+'<h2>All 168 nominal hours</h2>'+table(['Local date / hour','Coverage','Original rows','Observed kWh','Energy-only USD','Modeled optimized kWh','Difference kWh'],r.rows.map(x=>[x.date+' '+String(x.hour).padStart(2,'0')+':00',x.status,x.sourceRows.join(', '),x.observedKwh,x.observedCostUsd,x.modeledOptimizedKwh,x.differenceFromOptimizedKwh])):'')+
 '<h2>Complete original row references</h2><p>All '+e.rows.length+' records are retained. Download the original CSV and complete source JSON from GridKind. Original number and timestamp strings remain unchanged.</p>'+table(['Row / line','Original start','Original end','Original energy','Exact kWh','Issues'],e.rows.map(x=>[x.sourceRow+' / '+x.sourceLine,x.tokens.start,x.tokens.end,x.tokens.energy,x.exactKwh,x.issues.join('; ')||'Valid']))+'<p>GridKind preserves modeled plans and supplied observations separately. No device command, utility contract or realized savings is certified by this report.</p></main></html>';
}
