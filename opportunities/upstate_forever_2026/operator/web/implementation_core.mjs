export const SCHEMA = 'upstate.implementation-plan/v1';
export const COLLECTIONS = ['source_links','candidates','tasks','budget_lines','sites','monitoring_plans','visits','activities','observations'];
export const clone = value => JSON.parse(JSON.stringify(value));
export const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const today = () => { const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
export const uid = prefix => prefix+'-'+(globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12));
export function civil(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Use a complete date in YYYY-MM-DD format.');
  const [y,m,d]=value.split('-').map(Number);
  if(y<1||y>9999) throw Error('Year must be from 0001 to 9999.');
  const dt=new Date(0);dt.setUTCFullYear(y,m-1,d);dt.setUTCHours(0,0,0,0);
  if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d) throw Error('Invalid calendar date: '+value);
  return Math.floor(dt.getTime()/86400000);
}
export function dateText(day){
  const d=new Date(day*86400000),y=d.getUTCFullYear();
  if(y<1||y>9999)throw Error('Schedule extends outside supported calendar years.');
  return String(y).padStart(4,'0')+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
}
function weekday(day){return ((day+3)%7+7)%7+1;}
export function makePlan(title='Implementation and field monitoring'){
  const time=new Date().toISOString();
  return {schema:SCHEMA,id:uid('implementation'),revision:0,title,description:'',start_date:today(),currency:'USD',working_days:[1,2,3,4,5],holidays:[],created_at:time,updated_at:time,...Object.fromEntries(COLLECTIONS.map(k=>[k,[]]))};
}
export function parseMoney(text){
  const s=String(text).trim();
  if(!/^\d+(?:\.\d{1,2})?$/.test(s))throw Error('Enter a nonnegative dollar amount with at most two decimal places.');
  const [whole,frac='']=s.split('.'),minor=Number(whole)*100+Number(frac.padEnd(2,'0'));
  if(!Number.isSafeInteger(minor))throw Error('Amount is too large to preserve exact cents.');
  return minor;
}
export const money = minor => '$'+(minor/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export function validatePlan(plan){
  const issues=[],add=(path,message)=>issues.push({path,message});
  const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
  const idOk=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v);
  const integer=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
  const number=v=>typeof v==='number'&&Number.isFinite(v);
  if(!plain(plan))return [{path:'document',message:'Choose an implementation-plan JSON object.'}];
  const ancestors=new Set();
  function jsonValue(v,path='$',depth=0){
    if(depth>64){add(path,'JSON nesting exceeds 64 levels.');return;}
    if(v===null||typeof v==='boolean')return;
    if(typeof v==='string'){for(const c of v){const n=c.codePointAt(0);if(n>=0xD800&&n<=0xDFFF){add(path,'Invalid Unicode surrogate.');break;}}return;}
    if(typeof v==='number'){if(!Number.isFinite(v))add(path,'Number must be finite.');else if(Number.isInteger(v)&&!Number.isSafeInteger(v))add(path,'Integer is outside the interoperable safe range.');return;}
    if(!Array.isArray(v)&&!plain(v)){add(path,'Value is not JSON compatible.');return;}
    if(ancestors.has(v)){add(path,'JSON must not contain cyclic object references.');return;}
    ancestors.add(v);
    if(Array.isArray(v))v.forEach((item,i)=>jsonValue(item,path+'['+i+']',depth+1));
    else for(const [key,item] of Object.entries(v)){jsonValue(key,path,depth+1);jsonValue(item,path+'.'+key,depth+1);}
    ancestors.delete(v);
  }
  jsonValue(plan);if(issues.length)return issues;
  function string(row,key,path,required=true,nonempty=false){
    if(!(key in row)){if(required)add(path+'.'+key,'Is required.');return;}
    if(!required&&row[key]===null)return;
    if(typeof row[key]!=='string'||(nonempty&&!row[key].trim()))add(path+'.'+key,nonempty?'Expected a nonempty string.':'Expected a string.');
  }
  function ident(row,key,path,required=true){
    if(!(key in row)||row[key]===null){if(required)add(path+'.'+key,'Is required.');return;}
    if(!idOk(row[key]))add(path+'.'+key,'Use 1–96 letters, digits, underscores or hyphens, beginning with a letter or digit.');
  }
  function timestamp(value){
    if(typeof value!=='string')throw Error('Expected an ISO timestamp with timezone.');
    const match=value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(Z|[+-]\d{2}:\d{2})$/);
    if(!match)throw Error('Use an ISO date and time including Z or a timezone offset.');
    civil(match[1]);
    const [,date,hour,minute,second='0',fraction='',zone]=match;
    if(Number(hour)>23||Number(minute)>59||Number(second)>59)throw Error('Invalid timestamp clock time.');
    let offset=0;
    if(zone!=='Z'){const hours=Number(zone.slice(1,3)),minutes=Number(zone.slice(4,6));if(hours>23||minutes>59)throw Error('Invalid timestamp timezone offset.');offset=(hours*60+minutes)*(zone[0]==='-'?-1:1);}
    return civil(date)*86400000+Number(hour)*3600000+Number(minute)*60000+Number(second)*1000+Number('0.'+fraction||0)*1000-offset*60000;
  }
  function dateField(row,key,path,required=false,isTimestamp=false){
    if(!(key in row)||row[key]===null){if(required)add(path+'.'+key,'Is required.');return null;}
    try{return (isTimestamp?timestamp:civil)(row[key]);}catch(error){add(path+'.'+key,error.message);return null;}
  }
  function numeric(row,key,path,required=false,min=-Infinity,max=Infinity){
    if(!(key in row)||row[key]===null){if(required)add(path+'.'+key,'Is required.');return;}
    if(!number(row[key])||row[key]<min||row[key]>max)add(path+'.'+key,'Expected a finite number within the allowed range.');
  }
  function stringList(row,key,path,required=true,unique=false,ids=false){
    if(!(key in row)){if(required)add(path+'.'+key,'Is required.');return [];}
    if(!Array.isArray(row[key])){add(path+'.'+key,'Expected an array.');return [];}
    const values=[];
    row[key].forEach((item,i)=>{if(typeof item!=='string'||!item.trim())add(path+'.'+key+'['+i+']','Expected a nonempty string.');else{if(ids&&!idOk(item))add(path+'.'+key+'['+i+']','Invalid ID.');values.push(item);}});
    if(unique&&new Set(values).size!==values.length)add(path+'.'+key,'Contains duplicate values.');
    return values;
  }
  if(plan.schema!==SCHEMA)add('schema','Expected '+SCHEMA+'.');
  ident(plan,'id','plan');if(!integer(plan.revision))add('revision','Expected a nonnegative safe integer.');
  string(plan,'title','plan',true,true);string(plan,'description','plan');
  if(plan.currency!=='USD')add('currency','This edition records costs in USD cents.');
  const start=dateField(plan,'start_date','plan',true),target=dateField(plan,'target_date','plan');
  if(start!==null&&target!==null&&target<start)add('target_date','Cannot precede start_date.');
  const created=dateField(plan,'created_at','plan',true,true),updated=dateField(plan,'updated_at','plan',true,true);
  if(created!==null&&updated!==null&&updated<created)add('updated_at','Cannot precede created_at.');
  if(!Array.isArray(plan.working_days)||!plan.working_days.length||plan.working_days.some(d=>!integer(d,1,7))||new Set(plan.working_days).size!==plan.working_days.length)add('working_days','Select unique ISO weekdays from 1 to 7.');
  for(const holiday of stringList(plan,'holidays','plan',true,true))try{civil(holiday);}catch(error){add('holidays',error.message);}
  const rows={},indexes={};
  for(const name of COLLECTIONS){
    rows[name]=[];indexes[name]=new Map();
    if(!Array.isArray(plan[name])){add(name,'Expected an array.');continue;}
    plan[name].forEach((row,i)=>{
      const path=name+'['+i+']';if(!plain(row)){add(path,'Expected a record object.');return;}
      rows[name].push(row);ident(row,'id',path);
      if(typeof row.id==='string'){if(indexes[name].has(row.id))add(path+'.id','Duplicate ID '+row.id+'.');indexes[name].set(row.id,row);}
    });
  }
  function reference(row,key,collection,path,required=false){
    ident(row,key,path,required);
    if(typeof row[key]==='string'&&!indexes[collection].has(row[key]))add(path+'.'+key,'Unknown '+collection+' ID '+row[key]+'.');
  }
  for(const row of rows.source_links){
    const p='source_links.'+(row.id||'?');string(row,'kind',p,true,true);string(row,'label',p,true,true);string(row,'reference',p,false,true);
  }
  for(const row of rows.candidates){
    const p='candidates.'+(row.id||'?');string(row,'label',p,true,true);numeric(row,'area_ha',p,false,0);
    if(!(typeof row.source==='string'&&row.source.length||plain(row.source)&&Object.keys(row.source).length))add(p+'.source','Retain the original source reference or frozen snapshot object.');
    if(!Array.isArray(row.modeled_benefits))add(p+'.modeled_benefits','Expected the retained array of modeled results.');
    if(plain(row.source)&&'source_link_id' in row.source){
      reference(row.source,'source_link_id','source_links',p+'.source',true);
      const link=indexes.source_links.get(row.source.source_link_id);
      if(link)for(const [sourceKey,linkKey] of [['source_digest','source_digest'],['source_id','source_id'],['source_kind','kind']])if(sourceKey in row.source&&linkKey in link&&row.source[sourceKey]!==link[linkKey])add(p+'.source.'+sourceKey,'Does not match the retained original source link.');
    }
  }
  for(const row of rows.tasks){
    const p='tasks.'+(row.id||'?');for(const key of ['title','phase','assignee','notes'])string(row,key,p,true,key==='title');
    reference(row,'candidate_id','candidates',p);
    if(!['planned','in_progress','complete','cancelled'].includes(row.status))add(p+'.status','Choose a supported task status.');
    if(!('duration_days' in row)||(row.duration_days!==null&&!integer(row.duration_days)))add(p+'.duration_days','Use whole working days, zero for a milestone, or null while being estimated.');
    numeric(row,'progress_pct',p,true,0,100);dateField(row,'start_not_before',p);
    for(const dependency of stringList(row,'depends_on',p,true,true,true))if(!indexes.tasks.has(dependency))add(p+'.depends_on','Unknown task ID '+dependency+'.');
    stringList(row,'evidence_refs',p,true,true);
  }
  const totals={budget:0,commitment:0,actual:0};
  for(const row of rows.budget_lines){
    const p='budget_lines.'+(row.id||'?');reference(row,'task_id','tasks',p);string(row,'label',p,true,true);
    const validKind=['budget','commitment','actual'].includes(row.kind);
    if(!validKind)add(p+'.kind','Choose budget, commitment or actual.');
    if(!integer(row.amount_minor))add(p+'.amount_minor','Record a nonnegative exact amount in USD cents.');
    else if(validKind)totals[row.kind]+=row.amount_minor;
    dateField(row,'date',p);string(row,'reference',p,false,true);
  }
  if(Object.values(totals).some(value=>!Number.isSafeInteger(value)))add('budget_lines','A kind total exceeds the interoperable safe integer range.');
  for(const row of rows.sites){
    const p='sites.'+(row.id||'?');string(row,'label',p,true,true);reference(row,'candidate_id','candidates',p);reference(row,'source_ref','source_links',p);
    numeric(row,'latitude',p,false,-90,90);numeric(row,'longitude',p,false,-180,180);
    if((row.latitude===undefined||row.latitude===null)!==(row.longitude===undefined||row.longitude===null))add(p,'Supply latitude and longitude together.');
  }
  for(const row of rows.monitoring_plans){
    const p='monitoring_plans.'+(row.id||'?');for(const key of ['title','objective','notes'])string(row,key,p,true,key==='title');
    for(const id of stringList(row,'site_ids',p,true,true,true))if(!indexes.sites.has(id))add(p+'.site_ids','Unknown site ID '+id+'.');
    stringList(row,'parameters',p,true,true);for(const key of ['method_ref','frequency'])string(row,key,p,false);
  }
  for(const row of rows.visits){
    const p='visits.'+(row.id||'?');reference(row,'site_id','sites',p,true);reference(row,'monitoring_plan_id','monitoring_plans',p);
    dateField(row,'planned_date',p);dateField(row,'visited_at',p,false,true);
    string(row,'observer',p);string(row,'notes',p);stringList(row,'evidence_refs',p,true,true);
    if(!['planned','complete','cancelled'].includes(row.status))add(p+'.status','Choose a supported visit status.');
    if(row.status==='complete'&&!row.visited_at)add(p+'.visited_at','A completed visit requires its actual timestamp.');
    const monitoring=indexes.monitoring_plans.get(row.monitoring_plan_id);
    if(monitoring&&Array.isArray(monitoring.site_ids)&&!monitoring.site_ids.includes(row.site_id))add(p+'.site_id','Site is not in the referenced monitoring plan.');
  }
  for(const row of rows.activities){
    const p='activities.'+(row.id||'?');reference(row,'visit_id','visits',p,true);reference(row,'site_id','sites',p,true);
    if(!['sample','measurement','inspection','photo'].includes(row.kind))add(p+'.kind','Choose sample, measurement, inspection or photo.');
    string(row,'notes',p);for(const key of ['sample_id','method','custody_ref'])string(row,key,p,false,true);
    dateField(row,'collected_at',p,false,true);
    if(row.kind==='sample'&&!row.sample_id)add(p+'.sample_id','A sample activity requires its original sample ID.');
    const visit=indexes.visits.get(row.visit_id);if(visit&&visit.site_id!==row.site_id)add(p+'.site_id','Activity site must match its visit.');
  }
  for(const row of rows.observations){
    const p='observations.'+(row.id||'?');reference(row,'activity_id','activities',p,true);
    for(const key of ['parameter','original_text','unit','notes'])string(row,key,p,true,key==='parameter');
    for(const key of ['basis','fraction','qualifier','method','qa_status'])string(row,key,p,false);
    if(!['numeric','censored','text','missing'].includes(row.result_type))add(p+'.result_type','Choose a supported result type.');
    if(!('value' in row))add(p+'.value','Preserve an explicit value, using null when absent.');
    if(row.result_type==='numeric'&&!number(row.value))add(p+'.value','Numeric results require a finite measured value.');
    if(['censored','text','missing'].includes(row.result_type)&&row.value!==null)add(p+'.value','Censored, text and missing results keep a null numeric value.');
    if(['numeric','censored','text'].includes(row.result_type)&&(typeof row.original_text!=='string'||!row.original_text.trim()))add(p+'.original_text','Retain the original reported result text.');
    if(row.result_type==='censored'&&(typeof row.qualifier!=='string'||!row.qualifier.trim()))add(p+'.qualifier','Censored results require the original qualifier.');
    if(['numeric','censored'].includes(row.result_type)&&(typeof row.unit!=='string'||!row.unit.trim()))add(p+'.unit','Numeric and censored results need their original unit; use 1 for dimensionless.');
    for(const key of ['detection_limit','quantitation_limit'])numeric(row,key,p,false,0);
  }
  const children=new Map([...indexes.tasks.keys()].map(id=>[id,[]])),incoming=new Map();
  for(const [id,row] of indexes.tasks){
    const dependencies=new Set((Array.isArray(row.depends_on)?row.depends_on:[]).filter(dep=>typeof dep==='string'&&indexes.tasks.has(dep)));
    incoming.set(id,dependencies.size);for(const dep of dependencies)children.get(dep).push(id);
  }
  const ready=[...incoming].filter(([,count])=>count===0).map(([id])=>id);
  for(let i=0;i<ready.length;i++)for(const child of children.get(ready[i])){incoming.set(child,incoming.get(child)-1);if(incoming.get(child)===0)ready.push(child);}
  if(ready.length!==indexes.tasks.size)add('tasks.depends_on','Dependency cycle involving '+[...incoming].filter(([,count])=>count>0).map(([id])=>id).sort().join(', ')+'.');
  if(!issues.length&&unescape(encodeURIComponent(JSON.stringify(plan))).length>=16*1024*1024)add('document','Document exceeds 16777216 bytes.');
  return issues;
}

export function schedulePlan(plan,asOf=today()){
  const validation=validatePlan(plan);if(validation.length)throw Error(validation.map(x=>x.path+': '+x.message).join('\n'));
  const selected=civil(asOf),maximum=civil('9999-12-31'),days=new Set(plan.working_days),holidays=new Set(plan.holidays.map(civil));
  const holidayDays=[...holidays].filter(day=>days.has(weekday(day))).sort((a,b)=>a-b);
  const valid=day=>days.has(weekday(day))&&!holidays.has(day);
  const next=day=>{while(!valid(day)){if(day>=maximum)throw RangeError('Calendar extends beyond 9999-12-31.');day++;}if(day>maximum)throw RangeError('Calendar extends beyond 9999-12-31.');return day;};
  const bound=(value,right)=>{let low=0,high=holidayDays.length;while(low<high){const middle=Math.floor((low+high)/2);if(holidayDays[middle]<value||(right&&holidayDays[middle]===value))low=middle+1;else high=middle;}return low;};
  function count(first,last){
    if(last<first)return 0;
    const length=last-first+1,weeks=Math.floor(length/7),remainder=length%7;
    let total=weeks*days.size;
    for(let offset=0;offset<remainder;offset++)if(days.has((weekday(first)-1+offset)%7+1))total++;
    return total-bound(last,true)+bound(first,false);
  }
  function advance(start,duration){
    start=next(start);if(duration===0)return [start,null];
    if(count(start,maximum)<duration)throw RangeError('Duration extends beyond 9999-12-31.');
    let low=start,high=maximum;
    while(low<high){const middle=Math.floor((low+high)/2);if(count(start,middle)>=duration)high=middle;else low=middle+1;}
    if(low===maximum)throw RangeError('Exclusive finish extends beyond 9999-12-31.');
    return [next(low+1),low];
  }
  const tasks=new Map(plan.tasks.map(row=>[row.id,row])),results=new Map(),issues=[];
  const children=new Map([...tasks.keys()].map(id=>[id,[]])),incoming=new Map();
  for(const [id,row] of tasks){incoming.set(id,row.depends_on.length);for(const dep of row.depends_on)children.get(dep).push(id);}
  const ready=[...incoming].filter(([,degree])=>degree===0).map(([id])=>id);
  for(let position=0;position<ready.length;position++){
    const id=ready[position],task=tasks.get(id);
    const row={id,title:task.title,status:task.status,start:null,finish_exclusive:null,last_work_date:null,duration_days:task.duration_days,schedule_state:'scheduled',issue_codes:[],overdue:false};
    const issue=(code,message)=>{row.issue_codes.push(code);issues.push({task_id:id,code,message});};
    const unknown=task.depends_on.filter(dep=>results.get(dep).finish_exclusive===null);
    const cancelled=task.depends_on.filter(dep=>tasks.get(dep).status==='cancelled');
    if(cancelled.length&&task.status!=='cancelled')issue('cancelled_dependency','Predecessor(s) cancelled: '+cancelled.join(', ')+'. Review whether this dependency still belongs in the plan.');
    if(unknown.length){
      row.schedule_state='blocked_unknown';
      issue('dependency_finish_unknown','Enter predecessor duration or resolve its calendar range for: '+unknown.join(', '));
    }else{
      let earliest=civil(plan.start_date);
      if(task.start_not_before)earliest=Math.max(earliest,civil(task.start_not_before));
      for(const dep of task.depends_on)earliest=Math.max(earliest,civil(results.get(dep).finish_exclusive));
      try{
        const start=next(earliest);row.start=dateText(start);
        if(task.duration_days===null){row.schedule_state='unknown_duration';issue('duration_unknown','Enter a duration to calculate the finish boundary.');}
        else{
          const [finish,last]=advance(start,task.duration_days);row.finish_exclusive=dateText(finish);row.last_work_date=last===null?null:dateText(last);
          if(!['complete','cancelled'].includes(task.status))row.overdue=task.duration_days===0?start<selected:finish<=selected;
          if(plan.target_date&&(last===null?start:last)>civil(plan.target_date))issue('after_project_target',"Task's last planned work date is after target "+plan.target_date+'.');
        }
      }catch(error){
        if(!(error instanceof RangeError))throw error;
        row.schedule_state='calendar_overflow';issue('calendar_overflow',error.message);
      }
    }
    if((task.status==='complete'&&task.progress_pct!==100)||(task.status==='planned'&&task.progress_pct!==0))issue('status_progress_mismatch','Status and progress differ; both original values have been retained.');
    results.set(id,row);
    for(const child of children.get(id)){incoming.set(child,incoming.get(child)-1);if(incoming.get(child)===0)ready.push(child);}
  }
  const active=plan.tasks.filter(task=>task.status!=='cancelled').map(task=>results.get(task.id));
  const finishes=active.map(row=>row.finish_exclusive).filter(value=>value!==null).sort(),latest=finishes.length?finishes[finishes.length-1]:null;
  return {as_of:asOf,calendar:{working_days:[...plan.working_days],holidays:[...plan.holidays]},tasks:plan.tasks.map(task=>results.get(task.id)),issues,critical_finish_exclusive:finishes.length&&active.every(row=>row.finish_exclusive!==null)?latest:null,latest_known_finish_exclusive:latest,unknown_task_count:active.filter(row=>row.finish_exclusive===null).length};
}

export function summarize(plan,asOf=today()){
  const schedule=schedulePlan(plan,asOf),totals={budget:0,commitment:0,actual:0};
  for(const b of plan.budget_lines){totals[b.kind]+=b.amount_minor;if(!Number.isSafeInteger(totals[b.kind]))throw Error('Combined cost exceeds exact cent precision.');}
  const active=plan.tasks.filter(t=>t.status!=='cancelled'),done=active.filter(t=>t.status==='complete');
  return {as_of:asOf,tasks:{total:active.length,complete:done.length,overdue:schedule.tasks.filter(t=>t.overdue).length,needs_duration:schedule.tasks.filter(t=>t.finish_exclusive===null).length},budget:{...totals,remaining:totals.budget-totals.actual,unspent_commitments:totals.commitment-totals.actual},field:{sites:plan.sites.length,visits:plan.visits.length,complete_visits:plan.visits.filter(v=>v.status==='complete').length,overdue_visits:plan.visits.filter(v=>v.status==='planned'&&v.planned_date&&v.planned_date<asOf).length,activities:plan.activities.length,observations:plan.observations.length},schedule};
}
export function applyMethod(plan,catalog,methodId,candidateId=''){
  const method=catalog.method_templates.find(m=>m.id===methodId);if(!method)throw Error('Choose an installed implementation method.');
  if(candidateId&&!plan.candidates.some(c=>c.id===candidateId))throw Error('Select a candidate in this plan.');
  const p=clone(plan),prefix=uid(methodId),map=new Map(method.task_templates.map(t=>[t.id,prefix+'-'+t.id]));
  for(const original of method.task_templates)p.tasks.push({...clone(original),id:map.get(original.id),candidate_id:candidateId||null,depends_on:original.depends_on.map(d=>map.get(d)),method_id:method.id,method_version:method.version,method_task_id:original.id});
  for(const s of catalog.source_links||[])if(method.source_ids.includes(s.id)&&!p.source_links.some(x=>x.id===s.id))p.source_links.push(clone(s));
  p.method_catalog={schema:catalog.schema,id:catalog.id,version:catalog.version};return p;
}
export function updateRow(plan,collection,row){
  if(!COLLECTIONS.includes(collection))throw Error('Unknown collection.');
  const p=clone(plan),index=p[collection].findIndex(x=>x.id===row.id);if(index<0)p[collection].push(clone(row));else p[collection][index]=clone(row);
  const issues=validatePlan(p);if(issues.length)throw Error(issues.map(x=>x.path+': '+x.message).join('\n'));
  return p;
}
export function deleteRow(plan,collection,id){
  const p=clone(plan);p[collection]=p[collection].filter(x=>x.id!==id);
  const issues=validatePlan(p);if(issues.length)throw Error('This record is still referenced. Update its linked records first.\n'+issues.map(x=>x.path+': '+x.message).join('\n'));
  return p;
}
export function rowsCsv(rows,headers){
  const scalar=v=>v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):v;
  function cell(value){let v=scalar(value);if(typeof v==='string'&&/^[\s]*[=+\-@]/.test(v))v="'"+v;return '"'+String(v).replace(/"/g,'""')+'"';}
  return '\uFEFF'+[headers.map(cell).join(','),...rows.map(row=>headers.map(h=>cell(row[h])).join(','))].join('\r\n')+'\r\n';
}
export function csvPlan(plan,collection,asOf=today()){
  const fixed={tasks:['id','title','candidate_id','phase','assignee','status','duration_days','progress_pct','depends_on','start','last_work_date','finish_exclusive','schedule_state','notes'],budget_lines:['id','task_id','kind','label','amount_minor','date','reference'],sites:['id','label','candidate_id','latitude','longitude','source_ref'],visits:['id','site_id','monitoring_plan_id','planned_date','visited_at','observer','status','notes'],activities:['id','visit_id','site_id','kind','sample_id','collected_at','method','custody_ref','notes'],observations:['id','activity_id','parameter','result_type','value','original_text','unit','basis','fraction','qualifier','detection_limit','quantitation_limit','method','qa_status','notes'],candidates:['id','label','area_ha','source','modeled_benefits'],monitoring_plans:['id','title','objective','site_ids','parameters','method_ref','frequency','notes'],source_links:['id','kind','label','reference']};
  if(!fixed[collection])throw Error('Choose a supported export table.');
  const dates=collection==='tasks'?new Map(schedulePlan(plan,asOf).tasks.map(x=>[x.id,x])):null;
  const rows=plan[collection].map(r=>dates?{...r,...dates.get(r.id)}:r);
  const extras=[...new Set(rows.flatMap(Object.keys))].filter(k=>!fixed[collection].includes(k)).sort();
  return rowsCsv(rows,[...fixed[collection],...extras]);
}
export function safeLink(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
function economicSourceReports(plan, table) {
  const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const value = item => item === null || item === undefined ? '—' : item;
  const rowsTable = (headers, rows) => table(headers, rows.map(row => row.map(value)));
  const links = new Map(plan.source_links.map(row => [row.id,row]));
  const ids = new Set(), parts = [];
  for (const candidate of plan.candidates) {
    const source=record(candidate.source), link=record(links.get(source.source_link_id));
    const snapshot=record(link.snapshot), row=record(source.row_snapshot), binding=record(snapshot.binding);
    if (snapshot.schema!=='upstate.implementation-economic-source/v1' || !row.run_id || row.run_id!==binding.run_id) continue;
    ids.add(candidate.id);
    const zone=record(record(snapshot.native_source).zone);
    let html='<section><h3>'+esc(candidate.label)+'</h3><p>One complete modeled scenario, retained from its original economic edition. Positive avoided export means a reduction; negative values mean an increase. Each pollutant keeps its own units and spatial comparison support.</p>';
    html+=rowsTable(['Source field','Retained value'],[
      ['Economic edition',binding.edition_id],['Native report',binding.report_id],
      ['Native report SHA-256',binding.report_sha256],['Selected scenario run',row.run_id],
      ['Baseline run',row.baseline_run_id],['Reporting zone',zone.title||binding.zone_id],
      ['Reporting zone ID',binding.zone_id],['Reporting area (ha)',row.reporting_area_ha]
    ]);
    html+='<p>The reporting area describes the selected source zone. It does not assign an intervention footprint or allocate costs by area.</p>';
    const physical=[],supports=[];
    for(const benefit of candidate.modeled_benefits||[]){
      if(!benefit||typeof benefit!=='object'||benefit.quantity!=='avoided_export')continue;
      const output=record(benefit.output), support=record(output.support), label=benefit.label||benefit.metric;
      physical.push([label,benefit.units||output.units,output.baseline,output.alternative,output.reduction,output.reduction_percent]);
      supports.push([label,support.status,support.area_ha,support.valid_cells,support.detail]);
    }
    html+=rowsTable(['Quantity','Unit','Baseline export','Scenario export','Avoided export','Avoided export (%)'],physical);
    html+='<p>A dash means the original quantity is unavailable; percentages with a zero baseline remain undefined. Support marked paired uses the original common finite cells. Other support states retain their source qualification.</p>';
    html+=rowsTable(['Quantity','Support status','Shared area (ha)','Shared valid cells','Source qualification'],supports);
    html+='<h4>Retained source estimate</h4>';
    const original=row.original_cost, summary=record(row.source_cost_summary);
    if(!original||typeof original!=='object'||Array.isArray(original)){
      html+='<p>No implementation estimate is retained for this scenario.</p>';
    }else{
      const currency=summary.currency||original.currency, rate=original.discount_rate;
      html+=rowsTable(['Cost assumption','Retained value','Unit'],[
        ['Capital',original.capital,currency],['Annual operating',original.annual_operating,String(value(currency))+'/year'],
        ['Analysis horizon',original.horizon_years,'years'],['Real discount rate',typeof rate==='number'?rate*100:null,'%'],
        ['Present value',summary.present_value,currency],['Annualized cost',summary.annualized,String(value(currency))+'/year']
      ]);
      const scope=record(original.scope),origin=record(original.source);
      const scopeLabels={whole_scenario:'Whole scenario',reporting_zone:'Specified reporting zone',retained:'Retained source footprint; review original scope'};
      html+=rowsTable(['Estimate provenance','Retained value'],[
        ['Footprint',scopeLabels[scope.kind]||'Footprint not specified'],['Footprint zone',scope.zone_id],
        ['Footprint report',scope.producer_report_id],['Source',origin.title],['Reference',origin.uri],
        ['As of',origin.as_of],['Note',original.note],['Scope note',original.scope_note]
      ]);
      html+='<details><summary>Complete original estimate, footprint and review metadata</summary><pre>'+esc(JSON.stringify(original,null,2))+'</pre></details>';
    }
    html+='<p>This estimate is source context. The implementation budget, commitments and actual costs remain the separately entered ledger.</p>';
    html+='<details><summary>Complete original candidate and physical results</summary><pre>'+esc(JSON.stringify(candidate,null,2))+'</pre></details></section>';
    parts.push(html);
  }
  return {ids,html:parts.length?'<section><h2>Selected economic scenarios</h2>'+parts.join('')+'</section>':''};
}


export function briefingFollowupReport(plan,table){
 if(!plan.briefing_imports?.length)return '';
 const rows=plan.tasks.filter(t=>t.briefing_entry).map(t=>{
  const e=t.briefing_entry,c=e.source_context||{},b=c.report_binding||{},s=c.slide||{};
  return [t.id,t.title,t.assignee,t.status,t.source_due_date||'',e.kind,b.title,s.title,s.id,b.report_sha256,e.source_link_id];
 });
 return '<section><h2>Report review follow-up</h2><p>Source due dates are deadlines recorded in the original meeting notes. They do not set working durations or move scientific report dates. Current task owners and status include subsequent edits.</p>'+
 table(['Task ID','Work','Current owner','Current status','Source due date','Original entry kind','Original report','Report page','Page ID','Original report SHA256','Original notes source'],rows)+
 '<details><summary>Received meetings and preserved local differences</summary><pre>'+esc(JSON.stringify(plan.briefing_imports,null,2))+'</pre></details></section>';
}

export function reportHtml(plan,asOf=today()){
  const summary=summarize(plan,asOf);
  const text=value=>value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
  const table=(head,rows)=>'<div class="scroll"><table><thead><tr>'+head.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(text(v))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  const fieldRecords=plan.activities.filter(a=>a.form_response!==null&&a.form_response!==undefined).map(activity=>{
    const response=activity.form_response;
    if(!response||typeof response!=='object'||Array.isArray(response))return '<section class="field-record"><h3>'+esc(activity.id)+'</h3><pre>'+esc(JSON.stringify(response,null,2))+'</pre></section>';
    const template=response.template&&typeof response.template==='object'?response.template:{};
    const fields=Array.isArray(template.fields)?template.fields:[];
    const answers=response.answers&&typeof response.answers==='object'&&!Array.isArray(response.answers)?response.answers:{};
    const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
    const keys=[...fields.map(f=>f.key).filter(key=>own(answers,key)),...Object.keys(answers).filter(key=>!fields.some(f=>f.key===key))];
    const rows=keys.map(key=>{
      const field=fields.find(f=>f.key===key)||{},answer=answers[key],structured=answer!==null&&typeof answer==='object'&&!Array.isArray(answer);
      return [field.label||key,key,field.type||'',structured&&own(answer,'original_text')?answer.original_text:answer,structured?answer.value??'':'',structured?answer.unit??'':''];
    });
    return '<section class="field-record"><h3>'+esc(template.label||template.id||'Structured field record')+'</h3><p class="meta">Activity '+esc(activity.id)+' · visit '+esc(activity.visit_id)+' · site '+esc(activity.site_id)+'<br>Template '+esc(template.id||'')+' · version '+esc(template.version??'')+' · catalog '+esc(response.catalog_id||'')+' · version '+esc(response.catalog_version??'')+'<br>Recorded '+esc(response.recorded_at||'')+'</p>'+table(['Field','Field key','Type','Original response','Numeric value','Original unit'],rows)+'<details><summary>Complete retained form record and template</summary><pre>'+esc(JSON.stringify(response,null,2))+'</pre></details></section>';
  }).join('');
  const css='body{font:14px/1.5 system-ui,sans-serif;color:#202124;margin:32px;max-width:1200px}h1{font-size:28px}h2{font-size:19px;margin-top:32px}h3{font-size:16px;margin-top:24px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #c9cbce;text-align:left;padding:7px;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#f1f2f3}.scroll{overflow:auto}.meta{color:#575b60}.stats{display:flex;gap:24px;flex-wrap:wrap}.stats b{display:block;font-size:22px}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{margin:12px 0}.field-record{margin-bottom:24px}@media print{body{margin:10mm}thead{display:table-header-group}tr{break-inside:avoid}.scroll{overflow:visible}h2,h3{break-after:avoid}}';
  let html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(plan.title)+' — implementation report</title><style>'+css+'</style><body><h1>'+esc(plan.title)+'</h1><p class="meta">Implementation and field monitoring · '+esc(plan.id)+' · native revision '+esc(plan.revision)+' · as of '+esc(asOf)+'</p><p>'+esc(plan.description)+'</p><div class="stats"><span><b>'+summary.tasks.complete+' / '+summary.tasks.total+'</b>Tasks complete</span><span><b>'+money(summary.budget.budget)+'</b>Budget</span><span><b>'+money(summary.budget.commitment)+'</b>Commitments</span><span><b>'+money(summary.budget.actual)+'</b>Actual costs</span><span><b>'+summary.field.observations+'</b>Recorded results</span></div>';
  const economics=economicSourceReports(plan,table);
  html+=economics.html;
  html+=briefingFollowupReport(plan,table);
  const otherCandidates=plan.candidates.filter(c=>!economics.ids.has(c.id));
  if(otherCandidates.length||!economics.ids.size)html+='<h2>Selected conservation and intervention records</h2>'+table(['ID','Candidate','Original candidate area (ha)','Reporting footprint (ha)','Area basis','Original source snapshot','Modeled quantities'],otherCandidates.map(c=>[c.id,c.label,c.area_ha??'',c.reporting_area_ha??'',c.area_basis||'',c.source,c.modeled_benefits||[]]));
  html+='<h2>Assigned implementation work</h2>'+table(['Task','Candidate','Owner','Status','Start','Last working date','Progress','Notes','Evidence references'],summary.schedule.tasks.map(s=>{const t=plan.tasks.find(t=>t.id===s.id);return [t.title,t.candidate_id||'',t.assignee||'',t.status,s.start||'',s.last_work_date||'',t.progress_pct+'%',t.notes||'',t.evidence_refs||[]];}));
  if(summary.schedule.issues.length)html+='<h2>Dates to complete</h2><ul>'+summary.schedule.issues.map(i=>'<li>'+esc(i.task_id+': '+i.message)+'</li>').join('')+'</ul>';
  html+='<h2>Cost ledger (USD)</h2>'+table(['Kind','Item','Task','Amount','Date','Reference'],plan.budget_lines.map(b=>[b.kind,b.label,b.task_id||'',money(b.amount_minor),b.date||'',b.reference||'']));
  html+='<h2>Sites and monitoring questions</h2>'+table(['Site','Coordinates','Candidate','Source'],plan.sites.map(s=>[s.label,[s.latitude,s.longitude].filter(x=>x!==null&&x!==undefined).join(', '),s.candidate_id||'',s.source_ref||'']));
  html+=table(['Plan','Objective','Sites','Parameters','Method','Frequency','Notes'],plan.monitoring_plans.map(m=>[m.title,m.objective,(m.site_ids||[]).join('\n'),(m.parameters||[]).join('\n'),m.method_ref||'',m.frequency||'',m.notes||'']));
  html+='<h2>Visits</h2>'+table(['ID','Site','Planned','Actual','Observer','Status','Notes','Evidence references'],plan.visits.map(v=>[v.id,v.site_id,v.planned_date||'',v.visited_at||'',v.observer||'',v.status,v.notes||'',v.evidence_refs||[]]));
  html+='<h2>Sample and measurement activities</h2>'+table(['Activity','Visit','Site','Kind','Sample','Collected','Method','Custody','Related task','Notes'],plan.activities.map(a=>[a.id,a.visit_id,a.site_id,a.kind,a.sample_id||'',a.collected_at||'',a.method||'',a.custody_ref||'',a.implementation_task_id||'',a.notes||'']));
  if(fieldRecords)html+='<h2>Structured field form records</h2>'+fieldRecords;
  html+='<h2>Original field and laboratory results</h2><p>Each result retains its original text, unit, fraction, chemical basis and detection conditions. Modeled quantities remain with their original selected source record.</p>'+table(['Result ID','Activity','Parameter','Original result','Value','Unit','Basis','Fraction','Type / qualifier','Detection limit (original unit)','Quantitation limit (original unit)','Method','Quality','Notes'],plan.observations.map(o=>[o.id,o.activity_id,o.parameter,o.original_text,o.value??'',o.unit||'',o.basis||'',o.fraction||'',o.result_type+' / '+(o.qualifier||''),o.detection_limit??'',o.quantitation_limit??'',o.method||'',o.qa_status||'',o.notes||'']));
  html+='<h2>Retained source references</h2>'+table(['ID','Kind','Title','Reference'],plan.source_links.map(s=>[s.id,s.kind,s.label,s.reference||'']))+'<h2>Working calendar</h2><p>ISO weekdays: '+esc(plan.working_days.join(', '))+'. Holidays: '+esc(plan.holidays.join(', ')||'None recorded')+'. Task durations use working days; zero-day tasks are milestones.</p></body></html>';
  return html;
}

export function fieldSheetHtml(plan,visitId){
  const visit=plan.visits.find(v=>v.id===visitId);if(!visit)throw Error('Select a planned visit.');
  const site=plan.sites.find(s=>s.id===visit.site_id),monitor=plan.monitoring_plans.find(m=>m.id===visit.monitoring_plan_id);
  const empty=['Actual arrival / departure','Field operator','Weather and recent rainfall','Site access / changes','Installed work / maintenance','Sample IDs and collection times','Methods / equipment / calibration','Containers / preservation / custody','Photograph IDs and viewpoints','Follow-up work'];
  return '<!doctype html><html lang="en"><meta charset="utf-8"><title>'+esc(site?.label||visit.site_id)+' field sheet</title><style>body{font:14px/1.5 system-ui;margin:25px}h1{font-size:22px}dl{display:grid;grid-template-columns:150px 1fr}dt{font-weight:600}dd{margin:0}section{margin-top:20px;border-bottom:1px solid #777;min-height:55px}h2{font-size:14px;margin:0}@media print{section{break-inside:avoid}}</style><body><h1>Field visit · '+esc(site?.label||visit.site_id)+'</h1><dl><dt>Plan</dt><dd>'+esc(plan.title+' · '+plan.id+' · revision '+plan.revision)+'</dd><dt>Visit</dt><dd>'+esc(visit.id)+'</dd><dt>Planned date</dt><dd>'+esc(visit.planned_date||'')+'</dd><dt>Coordinates</dt><dd>'+esc([site?.latitude,site?.longitude].filter(x=>x!==null&&x!==undefined).join(', '))+'</dd><dt>Assigned observer</dt><dd>'+esc(visit.observer||'')+'</dd><dt>Question</dt><dd>'+esc(monitor?.objective||'')+'</dd><dt>Parameters</dt><dd>'+esc((monitor?.parameters||[]).join(', '))+'</dd><dt>Method reference</dt><dd>'+esc(monitor?.method_ref||'')+'</dd></dl><p>'+esc(visit.notes||'')+'</p>'+empty.map(t=>'<section><h2>'+esc(t)+'</h2></section>').join('')+'</body></html>';
}
