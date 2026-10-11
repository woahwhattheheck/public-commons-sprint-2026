// MIT. Exact rational consumption and explicit billing policy; source rates remain pinned.
import {need,sha,json,decimal,format,rounded,date,day,zone,midnight,localDay} from './util.mjs';
const index=(rows,key)=>new Map(rows.map(r=>[r[key],r]));
const groups=(rows,key)=>{const m=new Map();for(const r of rows){const k=r[key];if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;};
const add=(a,b)=>({n:a.n*b.d+b.n*a.d,d:a.d*b.d});
const usage=(value,meter)=>{const multiplier=decimal(meter.multiplier,6,'Meter multiplier');need(multiplier>0n,'Meter multiplier must be positive.');need(['ccf','gallons'].includes(meter.unit),'The meter unit must be explicitly mapped to ccf or gallons.');return {n:value*multiplier,d:1000000000000n*(meter.unit==='gallons'?748n:1n)};};
function registerAt(reads,boundary,options,final=false){
  const target=midnight(boundary,options.timezone);let candidates=reads.filter(r=>['register','final'].includes(r.kind)&&(options.readBoundary==='local_midnight'?Date.parse(r.read_at)===target:localDay(r.read_at,options.timezone)===boundary));
  candidates=candidates.filter(r=>!r.quality||r.quality==='actual'||(r.quality==='estimated'&&options.allowEstimated===true));
  if(final){const finalReads=candidates.filter(r=>r.kind==='final');need(finalReads.length,'The scheduled stop needs an accepted final reading on its boundary.');candidates=finalReads;}
  need(candidates.length,`No accepted register is available for ${boundary}.`);
  candidates.sort((a,b)=>Date.parse(b.read_at)-Date.parse(a.read_at));const chosen=candidates[0],same=candidates.filter(r=>r.read_at===chosen.read_at);need(new Set(same.map(r=>r.register)).size===1,'Conflicting register values share the selected reading timestamp.');
  const value=decimal(chosen.register,6,'Register');need(value>=0n,'Register readings must be nonnegative.');return {value,readingId:chosen.reading_id,readAt:chosen.read_at};
}
function consumption(reads,meter,start,end,options,final){
  if(options.readMethod==='interval'){
    const a=midnight(start,options.timezone),b=midnight(end,options.timezone),items=reads.filter(r=>r.kind==='interval'&&Date.parse(r.read_at)>a&&Date.parse(r.interval_start)<b).sort((x,y)=>Date.parse(x.interval_start)-Date.parse(y.interval_start));
    let cursor=a,total=0n;need(items.length,'No interval consumption covers this meter segment.');for(const r of items){need(r.quality===''||r.quality==='actual'||!r.quality||options.allowEstimated===true,'An interval is not an actual accepted reading.');const from=Date.parse(r.interval_start),to=Date.parse(r.read_at);need(Number.isFinite(from)&&Number.isFinite(to)&&from===cursor&&to>from&&to<=b,'Interval coverage has a gap, overlap or boundary-crossing interval.');const amount=decimal(r.consumption,6,'Interval consumption');need(amount>=0n,'Interval consumption cannot be negative.');total+=amount;cursor=to;}need(cursor===b,'The interval coverage ends before the billing boundary.');
    if(final)registerAt(reads,end,options,true);return {...usage(total,meter),readings:items.map(r=>r.reading_id),method:'interval'};
  }
  const a=registerAt(reads,start,options),b=registerAt(reads,end,options,final);let delta=b.value-a.value,rollover=false;
  if(delta<0n){need(options.allowSingleRollover===true&&/^\d{1,2}$/.test(meter.dial_count)&&+meter.dial_count>0&&+meter.dial_count<=12,'A falling register needs an explicit single-rollover declaration or corrected meter history.');const limit=10n**BigInt(+meter.dial_count)*1000000n;need(a.value<limit&&b.value<limit,'A register exceeds the declared dial capacity.');delta+=limit;rollover=true;}
  return {...usage(delta,meter),readings:[a.readingId,b.readingId],method:'register',startRead:a.readAt,endRead:b.readAt,rollover};
}
function charge(volume,service,rules,options){
  const override=options.tariffOverrides?.[service.customer_class];
  if(override){need(typeof override.source==='string'&&override.source.trim()&&typeof override.reason==='string'&&override.reason.trim(),'A tariff override needs its contract/source reference and review reason.');return {cents:rounded(volume.n*decimal(override.amountPerCcf,2,'Override rate'),volume.d,options.rounding),rate:override.amountPerCcf,interpretation:'source override',source:override.source};}
  const flat=rules.water.flat_consumption_rates.find(r=>r.customer_class===service.customer_class);
  if(flat)return {cents:rounded(volume.n*decimal(flat.amount_per_ccf,2,'Volume rate'),volume.d,options.rounding),rate:flat.amount_per_ccf,interpretation:'published flat rate'};
  need(['commercial','manufacturer'].includes(service.customer_class),'This customer class needs its explicit contract tariff override.');need(['progressive','whole_volume'].includes(options.thresholdInterpretation),'Commercial/manufacturer thresholds need a reviewed progressive or whole-volume interpretation.');
  const threshold=BigInt(service.cycle==='monthly'?1000:2000),lower=572n,upper=451n;let over=volume.n>threshold*volume.d;
  if(service.customer_class==='manufacturer'&&service.cycle==='bimonthly'&&volume.n===threshold*volume.d){need(['lower','upper'].includes(options.manufacturerBoundary),'The published manufacturer rows overlap at exactly 2,000 ccf. Select the reviewed boundary.');over=options.manufacturerBoundary==='upper';}
  if(options.thresholdInterpretation==='whole_volume')return {cents:rounded(volume.n*(over?upper:lower),volume.d,options.rounding),rate:format(over?upper:lower),interpretation:'reviewed whole-volume threshold'};
  const first=volume.n<threshold*volume.d?volume.n:threshold*volume.d,second=volume.n-first;
  return {cents:rounded(first*lower+second*upper,volume.d,options.rounding),rate:'5.72 / 4.51',interpretation:'reviewed progressive threshold'};
}
export function buildBills({tables,request,rules,adjustments=[]}){
  const options=structuredClone(request);zone(options.timezone);date(options.issueDate,'Bill issue date');need(['half_up','half_even'].includes(options.rounding),'Select a rounding convention.');need(['full_base','actual_days'].includes(options.proration),'Declare full-base or actual-days base-fee proration.');need(['register','interval'].includes(options.readMethod),'Select register-difference or interval consumption.');need(['local_midnight','last_read_on_date'].includes(options.readBoundary),'Declare the register reading boundary.');
  need(options.issueDate>=rules.water.consumption_effective_bill_issue_date||options.tariffOverrides,'The retained published rates do not cover this earlier bill issue date. Supply a source-referenced tariff override.');
  const accounts=index(tables.accounts??[],'account_id'),meters=index(tables.meters??[],'meter_id'),readings=groups(tables.readings??[],'meter_id'),history=groups(tables.meter_history??[],'service_id');
  let services=(tables.services??[]).filter(s=>(!options.route||s.route===options.route)&&(!options.accountIds?.length||options.accountIds.includes(s.account_id)));
  const accountCount=new Set(services.map(s=>s.account_id)).size;need(accountCount>0,'The billing selection has no service accounts.');need(accountCount<=5000,'A billing batch supports at most 5,000 distinct accounts; choose a route or explicit account selection.');
  const rows=[],findings=[],excluded=[],details=[];
  for(const service of services){try{
    need(accounts.has(service.account_id),'The service refers to an unmapped account.');need(service.address_id===accounts.get(service.account_id).address_id||service.address_id,'The service needs an address identity.');need(['monthly','bimonthly'].includes(service.cycle),'Select a mapped monthly or bimonthly service cycle.');
    const period=options.periods?.[service.cycle];need(period,'Declare the selected service cycle’s billing period.');const fullStart=date(period.start),fullEnd=date(period.end);need(fullStart<fullEnd,'Billing periods use an inclusive start and exclusive end.');const start=service.start_date&&service.start_date>fullStart?date(service.start_date):fullStart,end=service.stop_date&&service.stop_date<fullEnd?date(service.stop_date):fullEnd;
    if(start>=end){excluded.push({service_id:service.service_id,reason:'Service was inactive throughout the selected billing period.'});continue;}
    let assignments=(history.get(service.service_id)??[]).filter(h=>h.start_date<end&&(!h.end_date||h.end_date>start)).sort((a,b)=>a.start_date.localeCompare(b.start_date));
    if(!assignments.length)assignments=[{meter_id:service.meter_id,start_date:start,end_date:end}];
    let cursor=start,volume={n:0n,d:1n};const segments=[];
    for(const assignment of assignments){const from=assignment.start_date>start?date(assignment.start_date):start,to=assignment.end_date&&assignment.end_date<end?date(assignment.end_date):end;need(from===cursor&&to>from,'Meter assignment history has a gap or overlap in the billing period.');const meter=meters.get(assignment.meter_id);need(meter,'An assigned meter is not in the retained meter inventory.');const value=consumption(readings.get(meter.meter_id)??[],meter,from,to,options,!!service.stop_date&&to===service.stop_date);volume=add(volume,value);segments.push({meter_id:meter.meter_id,start:from,end:to,unit:meter.unit,multiplier:meter.multiplier,numerator:value.n.toString(),denominator:value.d.toString(),...Object.fromEntries(Object.entries(value).filter(([k])=>!['n','d'].includes(k)))});cursor=to;}
    need(cursor===end,'Meter history does not cover the complete active billing period.');const override=options.tariffOverrides?.[service.customer_class],base=override?.baseFee??rules.water.meter_base_fees.find(r=>r.meter_size_inches===service.meter_size)?.[service.cycle];need(base!==undefined,'The meter size has no source-selected base charge.');let baseCents=decimal(base,2,'Base fee');need(baseCents>=0n,'Base fee must be nonnegative.');
    if(options.proration==='actual_days')baseCents=rounded(baseCents*BigInt(day(end)-day(start)),BigInt(day(fullEnd)-day(fullStart)),options.rounding);
    const volumeCharge=charge(volume,service,rules,options),other=decimal(service.other_charge||'0',2,'Explicit other charge');let adjustmentsCents=0n;const selectedAdjustments=adjustments.filter(a=>a.service_id===service.service_id&&a.period_start===start&&a.period_end===end&&a.status==='approved');for(const a of selectedAdjustments)adjustmentsCents+=decimal(a.amount,2,'Approved bill adjustment');
    const bill={bill_id:sha(Buffer.from(json([service.account_id,service.service_id,start,end]))).slice(0,24),account_id:service.account_id,service_id:service.service_id,period_start:start,period_end:end,issue_date:options.issueDate,cycle:service.cycle,base_charge:format(baseCents),usage_charge:format(volumeCharge.cents),other_charge:format(other),adjustments:format(adjustmentsCents),total:format(baseCents+volumeCharge.cents+other+adjustmentsCents),usage_ccf:format(rounded(volume.n*1000000n,volume.d,options.rounding),6)};
    rows.push(bill);details.push({...bill,full_cycle_start:fullStart,full_cycle_end:fullEnd,base_proration:options.proration,active_days:day(end)-day(start),cycle_days:day(fullEnd)-day(fullStart),usage_numerator:volume.n.toString(),usage_denominator:volume.d.toString(),tariff:volumeCharge,segments,adjustmentIds:selectedAdjustments.map(a=>a.id)});
  }catch(error){findings.push({service_id:service.service_id,account_id:service.account_id,message:error.message});}}
  const totals=Object.fromEntries(['base_charge','usage_charge','other_charge','adjustments','total'].map(k=>[k,format(rows.reduce((sum,row)=>sum+decimal(row[k],2),0n))]));
  return {schema:'asheville.parallel-billing.v1',status:findings.length?'INCOMPLETE':'READY',options,rateSource:rules.water.source_url,rateSnapshotSha256:sha(Buffer.from(json(rules))),selectedAccounts:accountCount,selectedServices:services.length,billedServices:rows.length,totals,rows,details,findings,excluded};
}
