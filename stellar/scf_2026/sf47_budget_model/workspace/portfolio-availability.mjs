// MIT. Exact resource calendar authoring over original SF47 Portfolio inputs.
export const AVAILABILITY_SCHEMA='stellar-forge.portfolio-availability-desk.v1';
export const AVAILABILITY_PROPOSAL='stellar-forge.portfolio-availability-proposal.v1';
export const AVAILABILITY_LIMITS=Object.freeze({days:1096,resources:100,decimals:8,maximumHours:'1000000000'});
const SCALE=100000000n,DAY=86400000;
const clone=v=>JSON.parse(JSON.stringify(v));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=m=>{throw new Error(m);};
const check=(v,m)=>{if(!v)fail(m);};
export function availabilitySignature(v){return Array.isArray(v)?'['+v.map(availabilitySignature).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+availabilitySignature(v[k])).join(',')+'}':JSON.stringify(v);}
const same=(a,b)=>availabilitySignature(a)===availabilitySignature(b);
function keys(v,allowed,label){check(object(v),'Retain the complete '+label+'.');for(const k of Object.keys(v))check(allowed.includes(k),'Unexpected '+label+' field: '+k);}
function text(v,label,max=12000){check(typeof v==='string'&&v.length<=max,'Enter '+label+' within '+max+' characters.');return v;}
function ordinary(v,depth=0){check(depth<=64,'Keep a complete ordinary availability document.');if(Array.isArray(v)){check(v.length<=20000,'Retain the supported complete row collection.');v.forEach(x=>ordinary(x,depth+1));}else if(object(v)){for(const[k,x]of Object.entries(v)){check(!['__proto__','constructor','prototype'].includes(k),'Use ordinary availability fields.');ordinary(x,depth+1);}}else check(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v),'Retain ordinary JSON values.');}
function date(v,label='date'){check(typeof v==='string'&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v),'Enter '+label+' as YYYY-MM-DD.');const n=Date.parse(v+'T00:00:00Z');check(Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===v&&v>='0001-01-01','Enter a valid '+label+'.');return n;}
const dayString=n=>new Date(n).toISOString().slice(0,10);
const weekday=n=>(new Date(n).getUTCDay()+6)%7;
function units(v,nullable=false){
 if(v===null||v===''||v===undefined){check(nullable,'Enter the exact hours; blank is not zero.');return null;}
 check((typeof v==='string'||typeof v==='number')&&typeof v!=='boolean','Enter exact nonnegative hours.');
 let s=String(v);if(typeof v==='number'&&/[eE]/.test(s)){const e=s.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);check(e,'Enter a finite exact numeric quantity.');const digits=e[2]+(e[3]||''),point=e[2].length+Number(e[4]);s=e[1]+(point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point));}
 const m=s.match(/^\+?(\d+)(?:\.(\d{0,8}))?$/);
 check(m,'Use hours with at most eight decimal places.');
 const n=BigInt(m[1])*SCALE+BigInt((m[2]||'').padEnd(8,'0'));
 check(n<=1000000000n*SCALE,'Hours must follow the original 0 to 1,000,000,000 range.');return n;
}
const decimal=n=>n===null?null:(n/SCALE).toString()+((n%SCALE)?'.'+(n%SCALE).toString().padStart(8,'0').replace(/0+$/,''):'');
export function availabilityHours(v,{nullable=false}={}){return decimal(units(v,nullable));}
function calendar(c){
 check(object(c),'Retain the selected original program calendar.');
 const start=date(c.startDate,'calendar start');check(Number.isSafeInteger(c.horizonDays)&&c.horizonDays>=1&&c.horizonDays<=AVAILABILITY_LIMITS.days,'Retain the original supported calendar horizon.');
 const end=start+(c.horizonDays-1)*DAY;check(end<=date('9999-12-31'),'Keep the original calendar within supported dates.');
 check(Array.isArray(c.weekdays)&&new Set(c.weekdays).size===c.weekdays.length&&c.weekdays.every(n=>Number.isInteger(n)&&n>=0&&n<=6),'Retain original Monday-to-Sunday weekday selections.');
 for(const k of ['holidays','extraWorkingDates']){check(Array.isArray(c[k])&&c[k].length<=AVAILABILITY_LIMITS.days&&new Set(c[k]).size===c[k].length,'Retain complete original '+k+'.');c[k].forEach(x=>date(x,k));}
 check(!c.holidays.some(x=>c.extraWorkingDates.includes(x)),'An original date cannot be both closed and additional working.');
 return {start,end};
}
function resource(r){
 check(object(r)&&typeof r.id==='string'&&r.id.length>0&&r.id.length<=100,'Retain the original resource ID.');
 check(typeof r.name==='string'&&r.name.length<=300&&typeof r.note==='string'&&r.note.length<=12000,'Retain the complete resource name and basis.');
 check(Array.isArray(r.hoursByWeekday)&&r.hoursByWeekday.length===7,'Retain all seven original weekday values.');
 r.hoursByWeekday.forEach(v=>units(v,true));check(object(r.hoursByDate)&&Object.keys(r.hoursByDate).length<=AVAILABILITY_LIMITS.days,'Retain the complete original dated-capacity map.');
 for(const[d,v]of Object.entries(r.hoursByDate)){date(d);units(v);}
 return r;
}
export function availabilitySelection(inputs,profile='base'){
 check(object(inputs)&&typeof inputs.forecastId==='string'&&Array.isArray(inputs.resources)&&Array.isArray(inputs.alternatives),'Open the complete original Portfolio inputs.');
 const alt=profile==='base'?null:inputs.alternatives.find(x=>x.id===profile);check(profile==='base'||alt,'Select an existing original alternative.');
 const effective={...inputs,...(alt||{}),resources:alt?.resources??inputs.resources,calendar:alt?.calendar??inputs.calendar};
 calendar(effective.calendar);check(Array.isArray(effective.resources)&&effective.resources.length<=AVAILABILITY_LIMITS.resources,'Retain original resources.');
 const ids=new Set;for(const r of effective.resources){check(object(r)&&typeof r.id==='string'&&r.id.length>0,'Retain original resource identities.');check(!ids.has(r.id),'Retain unique original resource IDs.');ids.add(r.id);}
 return {profile,name:alt?.name||inputs.name||'Base plan',inherited:!!alt&&!Object.hasOwn(alt,'resources'),calendar:clone(effective.calendar),resources:clone(effective.resources),forecastId:inputs.forecastId};
}
function interval(c,from,to){const bounds=calendar(c),first=date(from,'first date'),last=date(to,'last date');check(first<=last&&first>=bounds.start&&last<=bounds.end,'Select dates within the original program horizon, in order.');return {first,last};}
function open(c,d,n){return !c.holidays.includes(d)&&(c.weekdays.includes(weekday(n))||c.extraWorkingDates.includes(d));}
function cell(r,c,d,n){
 const override=Object.hasOwn(r.hoursByDate,d),value=override?r.hoursByDate[d]:r.hoursByWeekday[weekday(n)],hours=decimal(units(value,!override)),isOpen=open(c,d,n);
 return {date:d,weekday:weekday(n),calendarOpen:isOpen,calendarReason:c.holidays.includes(d)?'HOLIDAY':c.extraWorkingDates.includes(d)?'EXTRA_WORKING_DATE':c.weekdays.includes(weekday(n))?'WORKING_WEEKDAY':'CLOSED_WEEKDAY',source:override?'DATE_OVERRIDE':'WEEKDAY_PATTERN',hours,schedulableHours:isOpen?hours:'0',enteredValue:clone(value),overridePresent:override};
}
export function availabilityView(inputs,{profile='base',resourceId,from,to}={}){
 const sel=availabilitySelection(inputs,profile),bounds=calendar(sel.calendar),r=sel.resources.find(x=>x.id===resourceId);check(r,'Choose an original resource.');
 resource(r);from=from||dayString(bounds.start);to=to||dayString(bounds.end);const range=interval(sel.calendar,from,to),rows=[];let known=0n,schedulable=0n,unknown=0,unknownOpen=0,closed=0;
 for(let n=range.first;n<=range.last;n+=DAY){const row=cell(r,sel.calendar,dayString(n),n);rows.push(row);if(row.hours===null){unknown++;if(row.calendarOpen)unknownOpen++;}else known+=units(row.hours);if(!row.calendarOpen)closed++;else if(row.hours!==null)schedulable+=units(row.hours);}
 return {schema:'stellar-forge.portfolio-availability-view.v1',forecastId:sel.forecastId,profile,name:sel.name,inherited:sel.inherited,resource:clone(r),calendar:sel.calendar,from,to,rows,summary:{dates:rows.length,closedDates:closed,openDates:rows.length-closed,unenteredDates:unknown,unenteredOpenDates:unknownOpen,knownEnteredHours:decimal(known),knownSchedulableHours:decimal(schedulable),completeSchedulableHours:unknownOpen?null:decimal(schedulable)}};
}
function readCell(r,key){if(key==='note')return {present:true,value:r.note};if(key.startsWith('weekday:'))return {present:true,value:r.hoursByWeekday[Number(key.slice(8))]};const d=key.slice(5);return Object.hasOwn(r.hoursByDate,d)?{present:true,value:r.hoursByDate[d]}:{present:false};}
function writeCell(r,key,v){if(key==='note')r.note=v.value;else if(key.startsWith('weekday:'))r.hoursByWeekday[Number(key.slice(8))]=v.value;else if(v.present)r.hoursByDate[key.slice(5)]=v.value;else delete r.hoursByDate[key.slice(5)];}
function weekdaySet(v){check(Array.isArray(v)&&v.length>0&&new Set(v).size===v.length&&v.every(x=>Number.isInteger(x)&&x>=0&&x<=6),'Select at least one distinct weekday.');return v;}
function proposalFromBasis(basis,command,createdAt){
 keys(basis,['forecastId','profile','resource','calendar','sourcePattern'],'availability basis');text(basis.forecastId,'original forecast ID',150);text(basis.profile,'original alternative ID',150);resource(basis.resource);calendar(basis.calendar);
 keys(command,['kind','from','to','weekdays','operation','hours','values','includeClosed','sourceProfile','sourceResourceId','note'],'availability command');
 check(['RANGE','WEEKLY','COPY_PATTERN'].includes(command.kind),'Choose a supported original availability edit.');
 text(command.note??'','availability review note');check(typeof createdAt==='string'&&Number.isFinite(Date.parse(createdAt)),'Retain the proposal time.');
 const from=command.from,to=command.to,range=interval(basis.calendar,from,to),days=weekdaySet(command.weekdays),next=clone(basis.resource),changedKeys=[];
 if(command.kind!=='RANGE'){const bounds=calendar(basis.calendar);check(range.first===bounds.start&&range.last===bounds.end,'Review the full program horizon when changing a repeating weekday pattern.');}
 if(command.kind==='RANGE'){
  check(['SET','CLEAR_OVERRIDE'].includes(command.operation),'Choose set hours or restore the weekday pattern.');check(typeof command.includeClosed==='boolean','Choose explicitly whether to include program-closed dates.');
  const hours=command.operation==='SET'?availabilityHours(command.hours):null;
  for(let n=range.first;n<=range.last;n+=DAY){const d=dayString(n);if(!days.includes(weekday(n))||!command.includeClosed&&!open(basis.calendar,d,n))continue;if(command.operation==='SET')next.hoursByDate[d]=hours;else delete next.hoursByDate[d];changedKeys.push('date:'+d);}
 }else{
  let values;
  if(command.kind==='WEEKLY'){check(Array.isArray(command.values)&&command.values.length===7,'Retain the complete seven-day proposed pattern.');values=command.values.map(v=>availabilityHours(v,{nullable:true}));}
  else{check(basis.sourcePattern&&basis.sourcePattern.profile===command.sourceProfile&&basis.sourcePattern.resource.id===command.sourceResourceId,'Retain the exact selected source pattern.');resource(basis.sourcePattern.resource);values=basis.sourcePattern.resource.hoursByWeekday.map(v=>availabilityHours(v,{nullable:true}));}
  for(const n of days){next.hoursByWeekday[n]=values[n];changedKeys.push('weekday:'+n);}
 }
 if(command.note){next.note=[basis.resource.note,command.note].filter(Boolean).join('\n');check(next.note.length<=12000,'The complete resource basis must stay within the original12,000-character limit.');changedKeys.push('note');}
 resource(next);
 const patches=changedKeys.map(key=>({key,before:readCell(basis.resource,key),after:readCell(next,key)})).filter(p=>!same(p.before,p.after));
 const rows=[];
 for(let n=range.first;n<=range.last;n+=DAY){const d=dayString(n),before=cell(basis.resource,basis.calendar,d,n),after=cell(next,basis.calendar,d,n);rows.push({date:d,before,after,affected:!same(before,after),selected:days.includes(weekday(n))&&(command.kind!=='RANGE'||command.includeClosed||before.calendarOpen)});}
 return {schema:AVAILABILITY_PROPOSAL,createdAt,basis:clone(basis),command:clone(command),resourceId:basis.resource.id,profile:basis.profile,patches,rows,nextResource:next};
}
export function prepareAvailability(inputs,command,{profile='base',resourceId,at=new Date().toISOString()}={}){
 const sel=availabilitySelection(inputs,profile);check(!sel.inherited,'Enable the existing whole resource override before editing this alternative.');
 const r=sel.resources.find(x=>x.id===resourceId);check(r,'Select the original resource.');resource(r);
 const basis={forecastId:sel.forecastId,profile,resource:r,calendar:sel.calendar,sourcePattern:null};
 if(command.kind==='COPY_PATTERN'){const source=availabilitySelection(inputs,command.sourceProfile),row=source.resources.find(x=>x.id===command.sourceResourceId);check(row,'Select an existing source resource pattern.');basis.sourcePattern={profile:source.profile,resource:row};}
 return proposalFromBasis(basis,command,at);
}
export function validateAvailabilityProposal(value){
 ordinary(value);keys(value,['schema','createdAt','basis','command','resourceId','profile','patches','rows','nextResource'],'availability proposal');check(value.schema===AVAILABILITY_PROPOSAL,'Choose the original complete availability proposal.');
 const rebuilt=proposalFromBasis(value.basis,value.command,value.createdAt);check(same(value,rebuilt),'The proposal no longer matches its retained original values and command.');return clone(value);
}
export function reviewAvailability(inputs,proposal,{choices={}}={}){
 const p=validateAvailabilityProposal(proposal),sel=availabilitySelection(inputs,p.profile);check(sel.forecastId===p.basis.forecastId,'Keep this review on its original saved Forecast.');check(!sel.inherited,'Restore the original whole resource override before applying this review.');
 const r=sel.resources.find(x=>x.id===p.resourceId);check(r,'The selected original resource was removed; retain this review and choose its actual successor explicitly.');resource(r);
 check(object(choices),'Retain complete per-field conflict choices.');
 const calendarChanged=!same(sel.calendar,p.basis.calendar);let sourceChanged=false;
 if(p.basis.sourcePattern){const s=availabilitySelection(inputs,p.basis.sourcePattern.profile),original=s.resources.find(x=>x.id===p.basis.sourcePattern.resource.id);sourceChanged=!original||!same(original.hoursByWeekday,p.basis.sourcePattern.resource.hoursByWeekday);}
 const next=clone(r),decisions=[],conflicts=[];
 for(const patch of p.patches){
  const current=readCell(r,patch.key),conflict=!same(current,patch.before)&&!same(current,patch.after),proof=availabilitySignature({key:patch.key,before:patch.before,proposed:patch.after,current});
  const choice=choices[patch.key];
  if(choice!==undefined){keys(choice,['take','basis'],'availability choice');check(conflict&&choice.basis===proof&&['current','proposed'].includes(choice.take),'A retained conflict choice no longer matches these exact original/current/proposed values.');}
  const take=conflict?(choice?.take||null):'proposed';
  if(take==='proposed')writeCell(next,patch.key,patch.after);
  const decision={...clone(patch),current,conflict,basis:proof,take};decisions.push(decision);if(conflict&&!choice)conflicts.push(decision);
 }
 check(Object.keys(choices).every(key=>p.patches.some(x=>x.key===key)),'A choice refers to another availability review.');resource(next);
 const rows=p.rows.map(row=>{const n=date(row.date);return {date:row.date,original:row.before,proposed:row.after,current:cell(r,sel.calendar,row.date,n),result:cell(next,sel.calendar,row.date,n),selected:row.selected};});
 return {schema:'stellar-forge.portfolio-availability-review.v1',proposal:p,calendarChanged,sourceChanged,decisions,conflicts,rows,canApply:!calendarChanged&&!sourceChanged&&!conflicts.length,nextResource:next};
}
export function applyAvailability(inputs,proposal,{choices={}}={}){
 const review=reviewAvailability(inputs,proposal,{choices});check(review.canApply,review.calendarChanged?'The original program calendar changed; prepare a fresh complete review.':review.sourceChanged?'The selected source pattern changed; prepare a fresh complete review.':'Resolve every changed field before applying.');
 const next=clone(inputs),target=proposal.profile==='base'?next:next.alternatives.find(x=>x.id===proposal.profile),index=target.resources.findIndex(x=>x.id===proposal.resourceId);
 target.resources[index]=clone(review.nextResource);
 return {inputs:next,review};
}
export function availabilityCsv(view){
 const rows=[['Forecast','Alternative','Resource ID','Resource','Date','Weekday (Monday=0)','Program open','Calendar basis','Capacity source','Entered hours','Schedulable hours','Resource basis'],...view.rows.map(r=>[view.forecastId,view.profile,view.resource.id,view.resource.name,r.date,r.weekday,r.calendarOpen?'YES':'NO',r.calendarReason,r.source,r.hours??'',r.schedulableHours??'',view.resource.note])];
 const value=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return '\uFEFF'+rows.map(row=>row.map(value).join(',')).join('\r\n')+'\r\n';
}
export function availabilityDeskKey(profile,resourceId,forecastId){return JSON.stringify([forecastId,profile,resourceId]);}
export function emptyAvailabilityDesk(){return {schema:AVAILABILITY_SCHEMA,selected:null,drafts:{},history:[]};}
export function validateAvailabilityDesk(value,{inputs=null}={}){
 if(value===null||value===undefined)return emptyAvailabilityDesk();
 ordinary(value);keys(value,['schema','selected','drafts','history'],'availability desk');check(value.schema===AVAILABILITY_SCHEMA,'Retain the complete original availability desk.');
 check(value.selected===null||typeof value.selected==='string','Retain the selected availability resource key.');check(object(value.drafts)&&Array.isArray(value.history),'Retain availability drafts and applied reviews.');
 const ids=new Set;
 for(const[k,d]of Object.entries(value.drafts)){
  let pair;try{pair=JSON.parse(k);}catch{fail('Retain original resource draft keys.');}check(Array.isArray(pair)&&pair.length===3&&pair.every(x=>typeof x==='string')&&availabilityDeskKey(pair[1],pair[2],pair[0])===k,'Retain original resource draft identities.');
  keys(d,['forecastId','profile','resourceId','month','from','to','kind','operation','hours','values','weekdays','includeClosed','sourceProfile','sourceResourceId','note','proposal','choices','page'],'availability resource draft');
  check(d.forecastId===pair[0]&&d.profile===pair[1]&&d.resourceId===pair[2],'Keep each resource form with its original identity.');for(const key of ['month','from','to','kind','operation','hours','sourceProfile','sourceResourceId','note'])text(d[key],key,key==='note'?12000:300);
  check(['RANGE','WEEKLY','COPY_PATTERN'].includes(d.kind)&&['SET','CLEAR_OVERRIDE'].includes(d.operation),'Retain original availability form choices.');
  check(Array.isArray(d.values)&&d.values.length===7&&d.values.every(x=>typeof x==='string'&&x.length<=300),'Retain all seven raw weekday controls.');
  check(Array.isArray(d.weekdays)&&d.weekdays.every(x=>Number.isInteger(x)&&x>=0&&x<=6)&&new Set(d.weekdays).size===d.weekdays.length&&typeof d.includeClosed==='boolean','Retain the original selected dates and calendar policy.');
  check(Number.isSafeInteger(d.page)&&d.page>=0&&object(d.choices),'Retain original review position and decisions.');
  if(d.proposal!==null){const p=validateAvailabilityProposal(d.proposal);check(p.basis.forecastId===d.forecastId&&p.profile===d.profile&&p.resourceId===d.resourceId,'Keep the complete proposal on its original resource.');}
  for(const c of Object.values(d.choices)){keys(c,['take','basis'],'retained availability choice');check(['current','proposed'].includes(c.take)&&typeof c.basis==='string','Retain exact original conflict choices.');}
  ids.add(k);
 }
 check(value.selected===null||ids.has(value.selected),'Keep the selected original availability form.');
 for(const row of value.history){keys(row,['at','proposal','choices','decisions'],'applied availability review');check(typeof row.at==='string'&&Number.isFinite(Date.parse(row.at)),'Retain the application time.');validateAvailabilityProposal(row.proposal);check(object(row.choices)&&Array.isArray(row.decisions),'Retain complete applied decisions.');}
 return clone(value);
}
