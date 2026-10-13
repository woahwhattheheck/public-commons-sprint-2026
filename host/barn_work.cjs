'use strict';
/** Daily barn work: explicit authorized instructions, frozen daily tasks and shift handover. */
const VERSION='barn-work.v1';
const clone=value=>JSON.parse(JSON.stringify(value));
const need=(test,message)=>{if(!test)throw Error(message);};
const str=(value,label,required=false)=>{need(value===undefined||typeof value==='string',label+' must be text.');const v=(value||'').trim();need(!required||v,label+' is required.');need(v.length<=12000,label+' is too long.');return v;};
const id=value=>{const v=str(value,'ID',true);need(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v),'Use a short ordinary ID.');return v;};
const date=value=>{const v=str(value,'Date',true);need(/^\d{4}-\d\d-\d\d$/.test(v)&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v,'Use an actual calendar date.');return v;};
const instant=value=>{const v=str(value,'Time',true);need(/Z$|[+-]\d\d:\d\d$/.test(v)&&Number.isFinite(Date.parse(v)),'Use a timestamp with a timezone.');return new Date(v).toISOString();};
const pick=(v,options,label)=>{need(options.includes(v),'Choose '+label+'.');return v;};
const num=(v,label,min=0)=>{need(Number.isSafeInteger(v)&&v>=min,label+' must be a whole number of at least '+min+'.');return v;};
const get=(rows,key,label)=>{const v=rows.find(x=>x.id===key);need(v,'Choose an existing '+label+'.');return v;};
const terminal=t=>['Completed','Skipped','Cancelled'].includes(t.status);
const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function create(input={}){
 const name=str(input.name||'Daily barn work','Barn name',true),timezone=input.timezone||'America/Los_Angeles';
 new Intl.DateTimeFormat('en',{timeZone:timezone});
 return {version:VERSION,id:id(input.id||'barn-work'),revision:0,workspace:{name,timezone},sources:clone(input.sources||[]),staff:[],locations:[],horses:[],instructions:[],routines:[],tasks:[],movements:[],handovers:[],day_closures:[],source_files:[],history:[]};
}
function validate(input){
 need(input&&input.version===VERSION,'Open a barn-work working record.');
 const r=clone(input);id(r.id);num(r.revision,'Record revision');str(r.workspace?.name,'Barn name',true);new Intl.DateTimeFormat('en',{timeZone:r.workspace?.timezone});
 for(const name of ['sources','staff','locations','horses','instructions','routines','tasks','movements','handovers','day_closures','source_files','history']){
  need(Array.isArray(r[name]),'Keep the complete '+name+' register.');
  if(name!=='history')need(new Set(r[name].map(x=>id(x.id))).size===r[name].length,'Duplicate '+name+' ID.');
 }
 for(const h of r.horses){if(h.home_location_id)get(r.locations,h.home_location_id,'home location');if(h.current_location_id)get(r.locations,h.current_location_id,'current location');}
 for(const a of r.instructions){get(r.horses,a.horse_id,'instruction horse');num(a.revision,'Instruction revision',1);date(a.effective_from);if(a.effective_to)need(date(a.effective_to)>=a.effective_from,'Instruction ends before it begins.');}
 for(const t of r.tasks){get(r.horses,t.horse_id,'task horse');date(t.day);pick(t.status,['Pending','Assigned','Completed','Exception','Skipped','Cancelled'],'task status');need(t.instruction?.text&&t.instruction?.authorized_by,'Keep the frozen authorized task instruction.');if(t.assigned_to)get(r.staff,t.assigned_to,'assigned worker');if(t.performed_by)get(r.staff,t.performed_by,'actual worker');need(Array.isArray(t.events),'Keep task events.');}
 for(const h of r.handovers){get(r.staff,h.outgoing_id,'outgoing worker');get(r.staff,h.incoming_id,'incoming worker');need(Array.isArray(h.tasks),'Keep the handover task snapshot.');}
 need(r.history.length===r.revision,'Keep the complete saved operation history.');
 return r;
}
function localDay(r,at){return new Intl.DateTimeFormat('en-CA',{timeZone:r.workspace.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));}
function instructionFor(r,horseId,kind,day){
 const selected=r.instructions.filter(x=>x.horse_id===horseId&&x.kind===kind&&x.active&&x.effective_from<=day&&(!x.effective_to||x.effective_to>=day));
 need(selected.length<=1,'More than one authorized '+kind+' instruction applies to this horse on '+day+'. Resolve the overlap.');
 return selected[0]||null;
}
function missingWork(r,day){
 date(day);const weekday=new Date(day+'T12:00:00Z').getUTCDay(),rows=[];
 for(const routine of r.routines.filter(a=>a.active&&a.days.includes(weekday)))for(const horseId of routine.horse_ids){
  const horse=get(r.horses,horseId,'horse');if(!horse.active)continue;
  const instruction=instructionFor(r,horseId,routine.kind,day);
  for(const slot of routine.slots)if(!r.tasks.some(t=>t.day===day&&t.routine_id===routine.id&&t.horse_id===horseId&&t.slot.id===slot.id))rows.push({day,routine_id:routine.id,routine_revision:routine.revision,routine_title:routine.title,kind:routine.kind,horse_id:horseId,horse_name:horse.name,slot:clone(slot),instruction_id:instruction?.id||'',reason:instruction?'This active routine slot has not been planned.':'Enter the authorized '+routine.kind+' instruction for this date, then plan this slot.'});
 }
 return rows;
}
function activeStaff(r,key){const row=get(r.staff,key,'worker');need(row.active,'Choose an active worker.');return row;}
function occupancy(r,locationId){return r.horses.filter(x=>x.active&&x.current_location_id===locationId);}
function locationAvailable(r,key,horseId){
 const row=get(r.locations,key,'location');need(row.active,'Choose an open location.');
 const current=occupancy(r,key).filter(h=>h.id!==horseId).length;
 need(row.capacity===0||current<row.capacity,'This location is at its entered capacity.');return row;
}
function revise(rows,row,at){
 const old=rows.find(x=>x.id===row.id);const out={...row,revision:(old?.revision||0)+1,updated_at:at,history:old?[...(old.history||[]),clone(Object.fromEntries(Object.entries(old).filter(([k])=>k!=='history')))]:[]};
 if(old)rows[rows.indexOf(old)]=out;else rows.push(out);return out;
}
function taskEvent(task,status,actor,note,at,extra={}){
 task.events.push({at,status,actor,note,...clone(extra)});task.status=status;
}
function apply(input,request,at=new Date().toISOString()){
 const r=validate(input);need(request&&typeof request.kind==='string'&&request.input,'Choose a saved barn-work operation.');
 const timestamp=instant(at),operationId=id(request.operation_id),signature=canonical({kind:request.kind,input:request.input,expected_revision:request.expected_revision});
 const prior=r.history.find(x=>x.id===operationId);
 if(prior){need(prior.request===signature,'This operation ID already belongs to a different request.');return {record:r,replayed:true,result:clone(prior.result)};}
 need(request.expected_revision===r.revision,'The working record changed. Reload its current version.');
 const x=request.input;let result={};
 const editableDay=day=>{need(!r.day_closures.some(c=>c.day===day),'This day is closed. Reopen the day with a reason before changing its work.');};
 if(request.kind==='workspace-save'){
  const timezone=str(x.timezone,'Timezone',true);new Intl.DateTimeFormat('en',{timeZone:timezone});
  need(!r.tasks.length||timezone===r.workspace.timezone,'Keep the established timezone after planning daily work.');
  r.workspace={name:str(x.name,'Barn name',true),timezone};
 }else if(request.kind==='staff-save'){
  const row={id:id(x.id),name:str(x.name,'Worker name',true),active:x.active!==false,role:str(x.role,'Role'),contact:str(x.contact,'Contact')};
  if(!row.active)need(!r.tasks.some(t=>t.assigned_to===row.id&&!terminal(t)),'Reassign this worker’s unfinished tasks before deactivation.');
  revise(r.staff,row,timestamp);result={id:row.id};
 }else if(request.kind==='location-save'){
  const row={id:id(x.id),name:str(x.name,'Location name',true),kind:pick(x.kind||'stall',['stall','paddock','pasture','arena','other'],'location kind'),capacity:num(x.capacity??0,'Capacity'),active:x.active!==false,notes:str(x.notes,'Location notes')};
  const present=occupancy(r,row.id).length;
  need(row.active||present===0,'Move resident horses before closing the location.');
  need(row.capacity===0||row.capacity>=present,'Capacity is below current occupancy.');
  revise(r.locations,row,timestamp);result={id:row.id};
 }else if(request.kind==='horse-save'){
  const old=r.horses.find(h=>h.id===x.id);
  const row={id:id(x.id),name:str(x.name,'Horse name',true),owner:str(x.owner,'Owner'),owner_contact:str(x.owner_contact,'Owner contact'),home_location_id:str(x.home_location_id,'Home location'),current_location_id:old?.current_location_id||str(x.home_location_id,'Home location'),active:x.active!==false,notes:str(x.notes,'Horse notes')};
  if(row.home_location_id)get(r.locations,row.home_location_id,'home location');
  if(row.active&&row.current_location_id)locationAvailable(r,row.current_location_id,row.id);
  if(!row.active)need(!r.tasks.some(t=>t.horse_id===row.id&&!terminal(t)),'Resolve this horse’s unfinished tasks before deactivation.');
  revise(r.horses,row,timestamp);result={id:row.id};
 }else if(request.kind==='instruction-save'){
  get(r.horses,x.horse_id,'horse');const row={id:id(x.id),horse_id:x.horse_id,kind:pick(x.kind,['feed','turnout','care','training','other'],'instruction kind'),text:str(x.text,'Authorized instruction',true),authorized_by:str(x.authorized_by,'Instruction authorized by',true),effective_from:date(x.effective_from),effective_to:x.effective_to?date(x.effective_to):'',active:x.active!==false,source_note:str(x.source_note,'Source or instruction reference')};
  need(!row.effective_to||row.effective_to>=row.effective_from,'Instruction ends before it begins.');
  if(row.active)for(const old of r.instructions.filter(a=>a.id!==row.id&&a.active&&a.horse_id===row.horse_id&&a.kind===row.kind))need((old.effective_to&&old.effective_to<row.effective_from)||(row.effective_to&&row.effective_to<old.effective_from),'Another instruction overlaps these dates. Edit the existing instruction or end it first.');
  revise(r.instructions,row,timestamp);result={id:row.id};
 }else if(request.kind==='routine-save'){
  need(Array.isArray(x.horse_ids)&&Array.isArray(x.days)&&Array.isArray(x.slots),'Enter horses, weekdays and time slots.');
  const horses=[...new Set(x.horse_ids)];horses.forEach(k=>get(r.horses,k,'routine horse'));
  const days=[...new Set(x.days)].sort();days.forEach(d=>num(d,'Weekday',0));need(days.every(d=>d<=6),'Use weekdays0Sunday through6Saturday.');
  const slots=x.slots.map(s=>({id:id(s.id),label:str(s.label,'Slot label',true),time:str(s.time,'Time')}));
  need(new Set(slots.map(s=>s.id)).size===slots.length,'Use distinct slot IDs.');
  slots.forEach(s=>need(!s.time||/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time),'Use24-hour HH:MM slot times.'));
  const active=x.active===true;
  if(active)need(horses.length&&days.length&&slots.length&&slots.every(s=>s.time),'Select horses, actual weekdays and actual times before activating this routine.');
  const row={id:id(x.id),title:str(x.title,'Routine title',true),kind:pick(x.kind,['feed','turnout','care','training','other'],'routine kind'),horse_ids:horses,days,slots,active,source_url:str(x.source_url,'Source URL'),notes:str(x.notes,'Routine notes')};
  revise(r.routines,row,timestamp);result={id:row.id};
 }else if(request.kind==='plan-day'){
  const day=date(x.day);editableDay(day);const weekday=new Date(day+'T12:00:00Z').getUTCDay();
  const requested=x.routine_ids||r.routines.filter(a=>a.active).map(a=>a.id);need(Array.isArray(requested),'Choose routines.');
  let created=0,existing=0;const missing=[];
  for(const key of requested){
   const routine=get(r.routines,key,'routine');if(!routine.active||!routine.days.includes(weekday))continue;
   for(const horseId of routine.horse_ids){const horse=get(r.horses,horseId,'horse');if(!horse.active)continue;
    const ins=instructionFor(r,horseId,routine.kind,day);if(!ins){missing.push({horse_id:horseId,routine_id:key,reason:'Enter the authorized '+routine.kind+' instruction for this date.'});continue;}
    for(const slot of routine.slots){
     if(r.tasks.some(t=>t.day===day&&t.routine_id===routine.id&&t.horse_id===horseId&&t.slot.id===slot.id)){existing++;continue;}
     const taskId='task:'+day+':'+r.tasks.length;
     r.tasks.push({id:taskId,day,routine_id:routine.id,routine_revision:routine.revision,title:routine.title,kind:routine.kind,horse_id:horseId,horse_name:horse.name,slot:clone(slot),instruction:clone(ins),location_at_plan:horse.current_location_id,status:'Pending',assigned_to:'',performed_by:'',completed_at:'',completion_note:'',events:[{at:timestamp,status:'Pending',actor:'',note:'Planned from the selected routine and authorized instruction.'}]});created++;
    }
   }
  }result={day,created,existing,missing};
 }else if(request.kind==='task-assign'){
  const task=get(r.tasks,x.id,'task');editableDay(task.day);need(!terminal(task),'This task is already finished.');
  activeStaff(r,x.staff_id);task.assigned_to=x.staff_id;taskEvent(task,task.status==='Exception'?'Exception':'Assigned',x.staff_id,str(x.note,'Assignment note'),timestamp);
  result={id:task.id};
 }else if(request.kind==='task-finish'){
  const task=get(r.tasks,x.id,'task');editableDay(task.day);need(!terminal(task),'This task is already finished.');
  const status=pick(x.status,['Completed','Exception','Skipped','Cancelled'],'task outcome'),worker=activeStaff(r,x.staff_id),note=str(x.note,'Outcome note',status!=='Completed');
  const actual=instant(x.occurred_at||timestamp);need(Date.parse(actual)<=Date.parse(timestamp),'Actual work cannot be in the future.');
  need(localDay(r,actual)===task.day,'The actual time must be on this task’s barn-local date. Correct the record or record the exception.');
  if(status==='Completed'){
   const current=instructionFor(r,task.horse_id,task.kind,task.day);
   need(current&&current.id===task.instruction.id&&current.revision===task.instruction.revision,'The authorized instruction changed. Refresh this unfinished task before completing it.');
   need(task.assigned_to===worker.id,'Assign this task to its actual worker before completion.');
  }
  taskEvent(task,status,worker.id,note,actual,{recorded_at:timestamp});
  if(status==='Completed'){task.performed_by=worker.id;task.completed_at=actual;task.completion_note=note;}
  result={id:task.id,status};
 }else if(request.kind==='task-refresh-instruction'){
  const task=get(r.tasks,x.id,'task');editableDay(task.day);need(!terminal(task),'Retain the instruction used for finished work.');
  const ins=instructionFor(r,task.horse_id,task.kind,task.day);need(ins,'Enter a current authorized instruction for this task.');
  const worker=activeStaff(r,x.staff_id),note=str(x.note,'Refresh reason',true);const previous=clone(task.instruction);task.instruction=clone(ins);
  taskEvent(task,task.status,worker.id,note,timestamp,{previous_instruction:previous,new_instruction:clone(ins)});result={id:task.id,instruction_revision:ins.revision};
 }else if(request.kind==='horse-move'){
  const horse=get(r.horses,x.horse_id,'horse');need(horse.active,'Choose an active horse.');const worker=activeStaff(r,x.staff_id),destination=locationAvailable(r,x.location_id,horse.id);
  need(destination.id!==horse.current_location_id,'The horse is already in that location.');
  const actual=instant(x.occurred_at||timestamp);need(Date.parse(actual)<=Date.parse(timestamp),'The movement cannot be in the future.');editableDay(localDay(r,actual));
  const previous=r.movements.filter(m=>m.horse_id===horse.id).at(-1);need(!previous||Date.parse(actual)>=Date.parse(previous.occurred_at),'Enter movements in actual time order.');
  const touched=new Set([horse.current_location_id,destination.id].filter(Boolean));
  const later=r.movements.find(m=>(touched.has(m.from_location_id)||touched.has(m.to_location_id))&&Date.parse(m.occurred_at)>Date.parse(actual));
  need(!later,'A later movement already affects the source or destination location. Reconcile the actual movement chronology before applying this older move to current occupancy.');
  const note=str(x.note,'Movement and compatibility note',true);
  const move={id:id(x.id),horse_id:horse.id,horse_name:horse.name,from_location_id:horse.current_location_id,to_location_id:destination.id,staff_id:worker.id,occurred_at:actual,recorded_at:timestamp,note};
  need(!r.movements.some(m=>m.id===move.id),'This movement ID already exists.');r.movements.push(move);horse.current_location_id=destination.id;result={id:move.id};
 }else if(request.kind==='handover-prepare'){
  const day=date(x.day);const outgoing=activeStaff(r,x.outgoing_id),incoming=activeStaff(r,x.incoming_id);need(outgoing.id!==incoming.id,'Choose the next worker.');
  const row={id:id(x.id),day,outgoing_id:outgoing.id,incoming_id:incoming.id,prepared_at:timestamp,note:str(x.note,'Handover notes',true),tasks:clone(r.tasks.filter(t=>t.day<=day&&!terminal(t))),missing_work:missingWork(r,day),movements:clone(r.movements.filter(m=>localDay(r,m.occurred_at)===day)),acknowledged_at:'',acknowledged_by:'',acknowledgement_note:''};
  need(!r.handovers.some(h=>h.id===row.id),'This handover ID already exists.');r.handovers.push(row);result={id:row.id,open_tasks:row.tasks.length,unplanned_slots:row.missing_work.length};
 }else if(request.kind==='handover-acknowledge'){
  const h=get(r.handovers,x.id,'handover');need(!h.acknowledged_at,'The handover is already acknowledged.');need(x.staff_id===h.incoming_id,'The named incoming worker must acknowledge the handover.');activeStaff(r,x.staff_id);
  h.acknowledged_at=timestamp;h.acknowledged_by=x.staff_id;h.acknowledgement_note=str(x.note,'Acknowledgement note',true);result={id:h.id};
 }else if(request.kind==='day-close'){
  const day=date(x.day);editableDay(day);need(day<=localDay(r,timestamp),'Close a current or past day.');
  activeStaff(r,x.staff_id);need(!missingWork(r,day).length,'Some active routine work has not been planned. Open the daily plan and resolve missing instructions.');
  const tasks=r.tasks.filter(t=>t.day===day);need(tasks.length,'Plan the day’s work before closing it.');need(tasks.every(terminal),'Resolve, explicitly skip or cancel every unfinished task before closing the day.');
  const row={id:id(x.id),day,staff_id:x.staff_id,closed_at:timestamp,note:str(x.note,'Day closeout note',true),task_ids:tasks.map(t=>t.id)};
  r.day_closures.push(row);result={id:row.id,task_count:tasks.length};
 }else if(request.kind==='day-reopen'){
  const day=date(x.day),old=r.day_closures.find(c=>c.day===day);need(old,'This day is already open.');activeStaff(r,x.staff_id);
  const reason=str(x.note,'Reopen reason',true);r.day_closures=r.day_closures.filter(c=>c!==old);result={day,reason,previous_closeout:clone(old)};
 }else if(request.kind==='source-file-save'){
  need(typeof x.content==='string'&&x.content.length>0,'Keep the complete original source text.');
  const row={id:id(x.id),name:str(x.name,'Original filename',true),type:str(x.type||'text/plain','File type'),content:x.content,note:str(x.note,'Source note')};
  need(row.content.length<=1000000,'Keep source files below one million characters.');revise(r.source_files,row,timestamp);result={id:row.id};
 }else throw Error('Unknown barn-work operation '+request.kind+'.');
 r.revision++;r.history.push({id:operationId,revision:r.revision,kind:request.kind,at:timestamp,request:signature,result:clone(result)});
 return {record:validate(r),replayed:false,result};
}
function csv(rows,headers){const cell=x=>'"'+String(x??'').replaceAll('"','""')+'"';return [headers,...rows.map(r=>headers.map(h=>r[h]))].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';}
function files(input){
 const r=validate(input),out={'Barn_Working_Record.json':JSON.stringify(r,null,2)+'\n','Sources.json':JSON.stringify(r.sources,null,2)+'\n'};
 for(const [name,rows,headers]of [
 ['Horses.csv',r.horses,['id','name','owner','owner_contact','home_location_id','current_location_id','active','notes']],
 ['Staff.csv',r.staff,['id','name','role','contact','active']],
 ['Locations.csv',r.locations,['id','name','kind','capacity','active','notes']],
 ['Instructions.csv',r.instructions,['id','horse_id','kind','text','authorized_by','effective_from','effective_to','active','revision','source_note']],
 ['Tasks.csv',r.tasks.map(t=>({...t,slot_label:t.slot.label,slot_time:t.slot.time,instruction:t.instruction.text,authorized_by:t.instruction.authorized_by,instruction_revision:t.instruction.revision})),['id','day','title','kind','horse_id','horse_name','slot_label','slot_time','instruction','authorized_by','instruction_revision','status','assigned_to','performed_by','completed_at','completion_note']],
 ['Movements.csv',r.movements,['id','horse_id','horse_name','from_location_id','to_location_id','staff_id','occurred_at','note']]
 ])out[name]=csv(rows,headers);
 out['Routines.json']=JSON.stringify(r.routines,null,2)+'\n';out['Handovers.json']=JSON.stringify(r.handovers,null,2)+'\n';out['Daily_Closeouts.json']=JSON.stringify(r.day_closures,null,2)+'\n';out['History.json']=JSON.stringify(r.history,null,2)+'\n';
 for(const f of r.source_files)out['Originals/'+f.id+'-'+f.name.replace(/[^A-Za-z0-9._-]/g,'_')]=f.content;
 return out;
}
module.exports={VERSION,create,validate,apply,files,csv,localDay,instructionFor,occupancy,missingWork};
