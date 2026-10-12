import {inputs,plan} from './engine.mjs';

export const WEEK_SCHEMA='gridkind-week/v1';
const clone=value=>structuredClone(value);
const round=value=>Math.round((value+Number.EPSILON)*10000)/10000;
function requireValue(ok,message){if(!ok)throw Error(message);}
function name(value){
  requireValue(typeof value==='string'&&value.trim().length>0&&value.trim().length<=100&&!/[\x00-\x1f\x7f]/.test(value),'Name the week using 1–100 printable characters.');
  return value.trim();
}
export function dateAt(start,offset=0){
  requireValue(typeof start==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(start),'Choose a calendar start date.');
  const date=new Date(start+'T00:00:00.000Z');
  requireValue(Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===start&&Number(start.slice(0,4))>=2000&&Number(start.slice(0,4))<9999,'Choose a valid calendar date from year 2000 through 9998.');
  requireValue(Number.isInteger(offset)&&offset>=0&&offset<=7,'Invalid day offset.');
  date.setUTCDate(date.getUTCDate()+offset);
  return date.toISOString().slice(0,10);
}
export function weekInputs(raw){
  requireValue(raw&&typeof raw==='object'&&Array.isArray(raw.days)&&raw.days.length===7,'A week contains exactly seven daily scenarios.');
  const startDate=dateAt(raw.startDate);
  return {name:name(raw.name),startDate,days:raw.days.map((day,index)=>{
    requireValue(day&&typeof day.enabled==='boolean','Choose whether '+dateAt(startDate,index)+' contains flexible loads.');
    try{return {enabled:day.enabled,scenario:inputs(day.scenario)};}
    catch(error){throw Error(dateAt(startDate,index)+': '+error.message);}
  })};
}
function totals(days){
  const completed=days.filter(day=>day.status==='planned');
  const baseline=completed.reduce((sum,day)=>sum+day.plan.baseline.cost,0);
  const optimized=completed.reduce((sum,day)=>sum+day.plan.optimized.cost,0);
  return {
    plannedDays:completed.length,infeasibleDays:days.filter(day=>day.status==='infeasible').length,
    restDays:days.filter(day=>day.status==='rest').length,
    baselineCostUsd:round(baseline),optimizedCostUsd:round(optimized),
    differenceUsd:round(Math.max(0,baseline-optimized)),
    energyKwh:round(completed.reduce((sum,day)=>sum+day.plan.optimized.items.reduce((n,item)=>n+item.kwh,0),0))
  };
}
/** Seven independent calls to the maintained exact 24-hour household optimizer. */
export function planWeek(raw){
  const input=weekInputs(raw);
  const days=input.days.map((day,index)=>{
    const date=dateAt(input.startDate,index);
    if(!day.enabled)return {date,status:'rest',plan:null};
    try{return {date,status:'planned',plan:plan(day.scenario)};}
    catch(error){
      if(!['No eligible quiet-hour window for at least one load','No feasible shared-circuit schedule'].includes(error.message))throw error;
      return {date,status:'infeasible',plan:null,reason:error.message};
    }
  });
  return {schema:WEEK_SCHEMA,input,days,totals:totals(days),
    model:'Seven independent 24-hour household scenarios; each load finishes within its own calendar day.',
    disclaimer:'Hypothetical prices and flexible loads. Calendar entries describe a plan; device execution remains the separate daily simulation.'};
}
/** Admit saved data without rerunning or changing its retained optimizer results. */
export function inspectWeek(report){
  requireValue(report&&report.schema===WEEK_SCHEMA,'Invalid saved week format.');
  const input=weekInputs(report.input);
  requireValue(Array.isArray(report.days)&&report.days.length===7,'The saved week is missing daily results.');
  for(const [index,day]of report.days.entries()){
    requireValue(day&&day.date===dateAt(input.startDate,index),'A saved day has the wrong date.');
    requireValue(input.days[index].enabled?['planned','infeasible'].includes(day.status):day.status==='rest','A saved day has an invalid status.');
    if(day.status!=='planned'){
      requireValue(day.plan===null,'A rest day or infeasible day cannot contain a schedule.');
      if(day.status==='infeasible')requireValue(typeof day.reason==='string'&&day.reason.length<=300,'A saved day is missing its planning reason.');
      continue;
    }
    requireValue(day.plan?.schema==='gridkind-sim-v1','A saved day is missing its original plan.');
    const scenario=input.days[index].scenario;
    requireValue(JSON.stringify(day.plan.prices)===JSON.stringify(scenario.prices),'Saved daily prices do not match their inputs.');
    for(const schedule of [day.plan.baseline,day.plan.optimized]){
      requireValue(schedule&&Number.isFinite(schedule.cost)&&schedule.cost>=0&&Array.isArray(schedule.items)&&schedule.items.length===scenario.tasks.length,'Invalid saved daily schedule.');
      const seen=new Set(),occupancy=Array(24).fill(0);
      for(const item of schedule.items){
        const task=scenario.tasks.find(task=>task.id===item.id);
        requireValue(task&&!seen.has(item.id)&&item.label===task.label&&item.kw===task.kw&&item.kwh===task.kw*task.hours&&
          Number.isInteger(item.start)&&Number.isInteger(item.end)&&item.end-item.start===task.hours&&item.start>=task.earliest&&item.end<=task.deadline&&
          Number.isFinite(item.cost)&&item.cost>=0,'Invalid saved flexible-load schedule.');
        seen.add(item.id);
        let cost=0;
        for(let hour=item.start;hour<item.end;hour++){
          requireValue(!task.quiet||(hour>=7&&hour<22),'A saved schedule enters quiet hours.');
          occupancy[hour]+=task.kw;cost+=scenario.prices[hour]*task.kw;
        }
        requireValue(Math.abs(item.cost-round(cost))<0.00011,'Saved load cost does not match its hourly prices.');
      }
      requireValue(occupancy.every(kw=>kw<=scenario.maxKw+1e-9),'A saved schedule exceeds its shared circuit limit.');
      const cost=schedule.items.reduce((sum,item)=>sum+item.cost,0);
      requireValue(Math.abs(schedule.cost-round(cost))<0.0006,'Saved daily cost does not match its loads.');
    }
  }
  const expected=totals(report.days);
  requireValue(report.totals&&Object.keys(expected).every(key=>report.totals[key]===expected[key]),'Saved weekly totals do not match the retained days.');
  return report;
}
export function weekCsv(raw){
  const report=inspectWeek(raw),rows=[['Date','Day status','Load','Start','Finish','Power kW','Energy kWh','Optimized cost USD','Earliest feasible day USD','Optimized day USD','Planning note']];
  for(const day of report.days){
    if(day.status!=='planned'){rows.push([day.date,day.status,'','','','','','','','',day.reason||'No flexible loads scheduled']);continue;}
    for(const item of day.plan.optimized.items)rows.push([day.date,day.status,item.label,hour(item.start),hour(item.end),item.kw,item.kwh,item.cost,day.plan.baseline.cost,day.plan.optimized.cost,'Hypothetical schedule']);
  }
  function cell(value){
    let text=String(value);
    if(/^[=+\-@\t\r]/.test(text))text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  }
  return rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
function hour(value){return String(value).padStart(2,'0')+':00';}
function calendarText(value){return String(value).replaceAll('\\','\\\\').replaceAll('\r\n','\n').replaceAll('\r','\n').replaceAll('\n','\\n').replaceAll(';','\\;').replaceAll(',','\\,');}
function stamp(date,hour){
  const day=hour===24?dateAt(date,1):date;
  return day.replaceAll('-','')+'T'+String(hour===24?0:hour).padStart(2,'0')+'0000';
}
function fold(line){
  const encoder=new TextEncoder(),parts=[];let part='',length=0;
  for(const char of line){
    const bytes=encoder.encode(char).length;
    if(length+bytes>75){parts.push(part);part=' '+char;length=1+bytes;}
    else{part+=char;length+=bytes;}
  }
  parts.push(part);return parts.join('\r\n');
}
/** RFC 5545 floating local times: portable drafts, no timezone conversion. */
export function weekCalendar(raw,{recordId,createdAt}){
  const report=inspectWeek(raw),created=new Date(createdAt);
  requireValue(typeof recordId==='string'&&/^[a-f0-9-]{36}$/.test(recordId)&&Number.isFinite(created.valueOf()),'Save the week before exporting its calendar.');
  const timestamp=created.toISOString().replaceAll('-','').replaceAll(':','').replace(/\.\d{3}Z$/,'Z');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//GridKind//Household Week Planner//EN','CALSCALE:GREGORIAN'];
  for(const [index,day]of report.days.entries()){
    if(day.status!=='planned')continue;
    for(const item of day.plan.optimized.items){
      lines.push('BEGIN:VEVENT','UID:'+recordId+'-'+day.date+'-'+item.id+'@gridkind.local','DTSTAMP:'+timestamp,
        'DTSTART:'+stamp(day.date,item.start),'DTEND:'+stamp(day.date,item.end),
        'SUMMARY:'+calendarText(item.label+' · GridKind plan'),
        'DESCRIPTION:'+calendarText(report.input.name+'\nHypothetical flexible-load schedule at the entered local clock time.\n'+item.kw+' kW; '+item.kwh+' kWh; modeled cost $'+item.cost.toFixed(4)+'.\n'+report.input.days[index].scenario.maxKw+' kW shared circuit cap. Open GridKind to plan and approve the daily simulation.'),
        'STATUS:TENTATIVE','TRANSP:TRANSPARENT','END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');return lines.map(fold).join('\r\n')+'\r\n';
}
