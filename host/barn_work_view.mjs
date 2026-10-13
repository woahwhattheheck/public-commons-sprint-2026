import barn from './barn_work.cjs';
import zip from './connected_zip.cjs';
import hash from './connected_sha256.cjs';
/** Neutral, self-contained daily operating application. */
export function barnClient(record,sourceFiles,barn,zip,hash,css){
 const root=document.getElementById('barn-app');
 let current=barn.validate(record.version==='barn-work.application.v1'?record.record:record),ui={tab:'day',day:barn.localDay(current,new Date().toISOString()),drafts:{},filter:'all',...(record.version==='barn-work.application.v1'?record.ui:{})},message='',lastPlan=null,sequence=0,epoch=0,opening=0;
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={day:'Daily work',horses:'Horses',instructions:'Care instructions',routines:'Routines',team:'People & places',movements:'Horse movements',handover:'Shift handover',files:'Files & sources'};
 const choices={horse:()=>current.horses.map(x=>[x.id,x.name+(x.active?'':' (inactive)')]),staff:()=>current.staff.map(x=>[x.id,x.name+(x.active?'':' (inactive)')]),location:()=>current.locations.map(x=>[x.id,x.name+(x.active?'':' (closed)')]),instructionKind:()=>['feed','turnout','care','training','other'].map(x=>[x,x]),task:()=>current.tasks.filter(t=>t.day===ui.day).map(t=>[t.id,t.slot.time+' · '+t.horse_name+' · '+t.title+' · '+t.status]),handover:()=>current.handovers.map(x=>[x.id,x.day+' · '+staffName(x.outgoing_id)+' → '+staffName(x.incoming_id)]),routine:()=>current.routines.map(x=>[x.id,x.title])};
 const horseName=key=>current.horses.find(x=>x.id===key)?.name||key||'—',staffName=key=>current.staff.find(x=>x.id===key)?.name||key||'—',locationName=key=>current.locations.find(x=>x.id===key)?.name||key||'—';
 const fields={
 horse:[['id','Horse ID'],['name','Horse name'],['owner','Owner'],['owner_contact','Owner contact'],['home_location_id','Home location','select:location'],['active','Active','checkbox'],['notes','Horse notes','textarea']],
 staff:[['id','Worker ID'],['name','Worker name'],['role','Role'],['contact','Contact'],['active','Active','checkbox']],
 location:[['id','Location ID'],['name','Location name'],['kind','Location type','select:stall,paddock,pasture,arena,other'],['capacity','Capacity (0 = unspecified)','number'],['active','Open','checkbox'],['notes','Location notes','textarea']],
 instruction:[['id','Instruction ID'],['horse_id','Horse','select:horse'],['kind','Work type','select:instructionKind'],['text','Authorized instruction','textarea'],['authorized_by','Authorized by'],['effective_from','Effective from','date'],['effective_to','Effective through (optional)','date'],['active','Active','checkbox'],['source_note','Instruction source / reference','textarea']],
 routine:[['id','Routine ID'],['title','Routine title'],['kind','Work type','select:instructionKind'],['horse_ids','Horses','multi:horse'],['days','Weekdays','weekdays'],['slots','Time slots: one per line, ID | Label | HH:MM','textarea'],['active','Active','checkbox'],['source_url','Published source URL'],['notes','Routine notes','textarea']],
 assignment:[['id','Daily task','select:task'],['staff_id','Assign to','select:staff'],['note','Assignment note','textarea']],
 outcome:[['id','Daily task','select:task'],['staff_id','Actual worker','select:staff'],['status','Outcome','select:Completed,Exception,Skipped,Cancelled'],['occurred_at','Actual local time','datetime-local'],['actual_offset','UTC offset if this time repeats (for example -08:00)'],['note','Outcome / exception note','textarea']],
 refresh:[['id','Daily task','select:task'],['staff_id','Worker reviewing the change','select:staff'],['note','Reason for refreshing instructions','textarea']],
 move:[['id','Movement ID'],['horse_id','Horse','select:horse'],['location_id','Move to','select:location'],['staff_id','Worker','select:staff'],['occurred_at','Actual local time','datetime-local'],['actual_offset','UTC offset if this time repeats (for example -08:00)'],['note','Movement and compatibility note','textarea']],
 handover:[['id','Handover ID'],['outgoing_id','Outgoing worker','select:staff'],['incoming_id','Incoming worker','select:staff'],['note','Handover notes','textarea']],
 acknowledge:[['id','Prepared handover','select:handover'],['staff_id','Incoming worker','select:staff'],['note','Acknowledgement note','textarea']],
 close:[['id','Closeout ID'],['staff_id','Closing worker','select:staff'],['note','Daily closeout note','textarea']],
 reopen:[['staff_id','Worker','select:staff'],['note','Reason for reopening the day','textarea']],
 workspace:[['name','Barn name'],['timezone','Barn timezone']],
 source:[['id','Source-file ID'],['name','Original filename'],['type','Media type'],['content','Complete original source text','textarea'],['note','Source notes','textarea']]
 };
 const defaults={horse:{active:true},staff:{active:true},location:{active:true,capacity:0,kind:'stall'},instruction:{active:true,effective_from:ui.day,kind:'feed'},routine:{active:false,days:[],horse_ids:[],slots:''},outcome:{status:'Completed'},workspace:current.workspace,source:{type:'text/plain'}};
 const key=(form,name)=>'bw-'+form+'-'+name;
 function value(form,name){return ui.drafts[form]?.[name]??defaults[form]?.[name]??'';}
 function options(type){return choices[type]?choices[type]():type.split(',').map(v=>[v,v]);}
 function input(form,field){
  const [name,label,type='text']=field,v=value(form,name),element=key(form,name);
  let html;
  if(type==='checkbox')html='<input id="'+element+'" type="checkbox" '+(v?'checked':'')+'>';
  else if(type==='weekdays')html='<select id="'+element+'" multiple size="7">'+['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day,n)=>'<option value="'+n+'" '+(Array.isArray(v)&&v.includes(n)?'selected':'')+'>'+day+'</option>').join('')+'</select>';
  else if(type.startsWith('select:')||type.startsWith('multi:')){const multi=type.startsWith('multi:');html='<select id="'+element+'" '+(multi?'multiple size="5"':'')+'>'+(multi?'':'<option value="">Choose…</option>')+options(type.split(':')[1]).map(([id,label])=>'<option value="'+escape(id)+'" '+((multi?Array.isArray(v)&&v.includes(id):v===id)?'selected':'')+'>'+escape(label)+'</option>').join('')+'</select>';}
  else if(type==='textarea')html='<textarea id="'+element+'" rows="'+(name==='slots'?4:3)+'">'+escape(v)+'</textarea>';
  else html='<input id="'+element+'" type="'+type+'" '+(type==='number'?'min="0" step="1" ':'')+'value="'+escape(v)+'">';
  return '<label class="'+(type==='textarea'?'wide':'')+'" for="'+element+'">'+escape(label)+html+'</label>';
 }
 function form(name,title,button,kind,helper=''){return '<form data-form="'+name+'" data-kind="'+kind+'"><h3>'+escape(title)+'</h3>'+(helper?'<p class="hint">'+escape(helper)+'</p>':'')+'<div class="fields">'+fields[name].map(f=>input(name,f)).join('')+'</div><div class="actions"><button type="submit">'+escape(button)+'</button><button type="button" data-reset="'+name+'">Clear form</button></div></form>';}
 function capture(){
  for(const [formName,def]of Object.entries(fields)){
   const first=document.getElementById(key(formName,def[0][0]));if(!first)continue;const result={};
   for(const [name,_label,type='text']of def){const el=document.getElementById(key(formName,name));if(!el)continue;
    result[name]=type==='checkbox'?el.checked:type==='weekdays'?Array.from(el.selectedOptions).map(x=>Number(x.value)):type.startsWith('multi:')?Array.from(el.selectedOptions).map(x=>x.value):type==='number'?Number(el.value):el.value;
   }ui.drafts[formName]=result;
  }
 }
 function table(headers,rows,empty='No records yet.'){
  return rows.length?'<div class="table-wrap"><table><thead><tr>'+headers.map(h=>'<th>'+escape(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(cells=>'<tr>'+cells.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table>':'<p class="empty">'+escape(empty)+'</p>';
 }
 const edit=(type,id)=>'<button type="button" data-edit="'+type+'" data-id="'+escape(id)+'">Open</button>';
 const routineSlots=row=>row.slots.map(s=>s.id+' | '+s.label+' | '+s.time).join('\n');
 function download(name,text,type='application/json'){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 function snapshot(){capture();return {version:'barn-work.application.v1',record:current,ui:JSON.parse(JSON.stringify(ui))};}
 function save(){download('Barn_Working_Application.json',JSON.stringify(snapshot(),null,2)+'\n');message='Working application downloaded, including unfinished forms.';}
 function offlineHTML(){
  const safe=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const wrap=(name,source)=>'const '+name+'={exports:{}};(function(module,exports){'+source+'\n})('+name+','+name+'.exports);';
  const engine=sourceFiles['source/barn_work.cjs'],zipSource=sourceFiles['source/connected_zip.cjs'],hashSource=sourceFiles['source/connected_sha256.cjs'];
  if(!engine||!zipSource||!hashSource)throw Error('Keep the complete source files with the offline application.');
  const script=wrap('barnModule',engine)+wrap('zipModule',zipSource)+wrap('hashModule',hashSource)+'window.barnWork=('+barnClient.toString()+')('+safe(snapshot())+','+safe(sourceFiles)+',barnModule.exports,zipModule.exports,hashModule.exports,'+safe(css)+');';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Daily barn work</title><style>html,body{margin:0;background:#fff;color:#191919;color-scheme:light}'+css+'</style></head><body><div id="barn-app"></div><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
 }
 function exportFiles(){
  const all={...barn.files(current),'Barn_Working_Application.json':JSON.stringify(snapshot(),null,2)+'\n',...sourceFiles,'START_HERE.md':sourceFiles['source/DAILY_BARN_WORK.md']||'','Daily_Barn_Work.html':offlineHTML()};
  const manifest={version:'barn-work.files.v1',record_id:current.id,revision:current.revision,files:Object.entries(all).map(([name,content])=>({name,...hash.sha256Utf8(content)}))};all['Files.json']=JSON.stringify(manifest,null,2)+'\n';return all;
 }
 function zipDownload(){const all=exportFiles(),members=Object.entries(all).map(([name,text])=>({name,data:zip.utf8(text)}));const bytes=zip.packStoredZip(members);const blob=new Blob([bytes],{type:'application/zip'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Daily_Barn_Work.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);message='Complete operating files and source downloaded.';}
 function parseSlots(text){return text.split(/\r?\n/).filter(l=>l.trim()).map(line=>{const parts=line.split('|').map(x=>x.trim());if(parts.length!==3)throw Error('Use ID | Label | HH:MM on each slot line.');return {id:parts[0],label:parts[1],time:parts[2]};});}
 function localInstant(value,offset){
  if(!value)return undefined;
  const target=value.length===16?value+':00':value;let guess=Date.parse(target+'Z');
  if(offset&&!/^[+-](?:0\d|1\d|2[0-3]):[0-5]\d$/.test(offset))throw Error('Use an explicit UTC offset such as -08:00.');
  const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:current.workspace.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<4;i++){const shown=fmt.format(new Date(guess)).replace(' ','T'),diff=Date.parse(target+'Z')-Date.parse(shown+'Z');if(!diff)break;guess+=diff;}
  if(fmt.format(new Date(guess)).replace(' ','T')!==target)throw Error('This local time does not exist in the barn timezone. Choose the actual time.');
  if(offset){const selected=Date.parse(target+offset);if(!Number.isFinite(selected)||fmt.format(new Date(selected)).replace(' ','T')!==target)throw Error('This offset does not match the barn-local time.');guess=selected;}else if([-7200000,-3600000,3600000,7200000].some(delta=>fmt.format(new Date(guess+delta)).replace(' ','T')===target))throw Error('This clock time repeats during the timezone change. Enter its actual UTC offset.');
  return new Date(guess).toISOString();
 }
 function operate(kind,input){
  const result=barn.apply(current,{kind,input,operation_id:'browser-'+Date.now()+'-'+(++sequence),expected_revision:current.revision});
  current=result.record;epoch++;message=kind==='plan-day'?result.result.created+' tasks planned; '+result.result.existing+' already present.':'Saved '+kind.replaceAll('-',' ')+'.';
  if(kind==='plan-day')lastPlan=result.result;
  try{localStorage.setItem('barn-work:'+current.id,JSON.stringify({version:'barn-work.application.v1',record:current,ui}));}catch(_e){message+=' Use Save working file to retain this session.';}
 }
 function taskTable(tasks){return table(['Time','Horse / work','Authorized instruction','Assigned','Status','Open'],tasks.map(t=>[escape(t.slot.time),'<strong>'+escape(t.horse_name)+'</strong><br>'+escape(t.title),escape(t.instruction.text)+'<br><small>'+escape(t.instruction.authorized_by)+' · revision '+t.instruction.revision+'</small>',escape(staffName(t.assigned_to)),escape(t.status),edit('task',t.id)]),'Plan a day after entering horses, their authorized instructions and active routines.');}
 function content(){
  const dayTasks=current.tasks.filter(t=>t.day===ui.day),open=dayTasks.filter(t=>!['Completed','Skipped','Cancelled'].includes(t.status)),closed=current.day_closures.find(c=>c.day===ui.day);
  if(ui.tab==='day')return '<h2>Daily work</h2><p>'+escape(ui.day)+' · '+escape(current.workspace.timezone)+' · '+dayTasks.length+' tasks · '+open.length+' unfinished · '+(closed?'Closed':'Open')+'</p><div class="actions"><button id="plan-day">Plan this day</button><label class="inline">Show <select id="task-filter"><option value="all" '+(ui.filter==='all'?'selected':'')+'>All work</option><option value="unfinished" '+(ui.filter==='unfinished'?'selected':'')+'>Unfinished</option><option value="exceptions" '+(ui.filter==='exceptions'?'selected':'')+'>Exceptions</option></select></label></div>'+(lastPlan?.missing?.length?'<section class="notice"><h3>Instructions to enter before this work can be planned</h3><ul>'+lastPlan.missing.map(x=>'<li>'+escape(horseName(x.horse_id))+' · '+escape(x.reason)+'</li>').join('')+'</ul></section>':'')+taskTable(dayTasks.filter(t=>ui.filter==='all'||ui.filter==='unfinished'&&!['Completed','Skipped','Cancelled'].includes(t.status)||ui.filter==='exceptions'&&t.status==='Exception'))+form('assignment','Assign work','Save assignment','task-assign')+form('outcome','Record work or an exception','Save outcome','task-finish','Enter actual work in the barn timezone. Completion uses the currently authorized instruction. Skipped and cancelled work retain the reason.')+form('refresh','Review changed instructions','Refresh unfinished task','task-refresh-instruction','The earlier instruction remains in this task’s history.')+form('close','Close the day','Close day','day-close')+form('reopen','Reopen a closed day','Reopen day','day-reopen');
  if(ui.tab==='horses')return '<h2>Horse register</h2>'+table(['Horse','Owner','Home / current','Active','Open'],current.horses.map(h=>[escape(h.name),escape(h.owner),escape(locationName(h.home_location_id))+' / '+escape(locationName(h.current_location_id)),h.active?'Yes':'No',edit('horse',h.id)]))+form('horse','Add or update a horse','Save horse','horse-save','Create places first. Later changes of actual location are recorded in Horse movements.');
  if(ui.tab==='instructions')return '<h2>Authorized care instructions</h2><p>Enter the actual instruction supplied by the owner or authorized barn operator, its source and effective dates.</p>'+table(['Horse','Type','Instruction / authorization','Dates','Revision','Open'],current.instructions.map(i=>[escape(horseName(i.horse_id)),escape(i.kind),escape(i.text)+'<br><small>'+escape(i.authorized_by)+'</small>',escape(i.effective_from)+' — '+escape(i.effective_to||'ongoing'),String(i.revision),edit('instruction',i.id)]))+form('instruction','Add or revise instructions','Save instructions','instruction-save');
  if(ui.tab==='routines')return '<h2>Routine setup</h2><p>The published Prairie Sky starter contains feeding and turnout frequencies. Choose actual horses, weekdays and times before activating either routine.</p>'+table(['Routine','Horses','Slots','Active','Open'],current.routines.map(a=>[escape(a.title),a.horse_ids.map(h=>escape(horseName(h))).join('<br>'),a.slots.map(s=>escape(s.label)+' '+escape(s.time||'time to enter')).join('<br>'),a.active?'Yes':'No',edit('routine',a.id)]))+form('routine','Add or update a routine','Save routine','routine-save','Use the horse and weekday lists to select all applicable entries. Ctrl/Cmd-click selects multiple options. Slot IDs stay the same when a time is revised.');
  if(ui.tab==='team')return '<h2>People and places</h2>'+table(['Worker','Role','Active','Open'],current.staff.map(s=>[escape(s.name),escape(s.role),s.active?'Yes':'No',edit('staff',s.id)]))+form('staff','Add or update a worker','Save worker','staff-save')+table(['Location','Type','Horses / capacity','Open','Edit'],current.locations.map(p=>[escape(p.name),escape(p.kind),barn.occupancy(current,p.id).length+' / '+(p.capacity||'unspecified'),p.active?'Yes':'No',edit('location',p.id)]))+form('location','Add or update a place','Save location','location-save')+form('workspace','Workspace','Save workspace','workspace-save','Use an IANA timezone such as America/Los_Angeles.');
  if(ui.tab==='movements')return '<h2>Horse movements</h2><p>Record actual moves, the responsible worker and the handling or group-compatibility decision. Enter moves in time order.</p>'+table(['When','Horse','From','To','Worker','Note'],current.movements.map(m=>[escape(m.occurred_at),escape(m.horse_name),escape(locationName(m.from_location_id)),escape(locationName(m.to_location_id)),escape(staffName(m.staff_id)),escape(m.note)]))+form('move','Record an actual movement','Save movement','horse-move');
  if(ui.tab==='handover')return '<h2>Shift handover</h2><p>A prepared handover retains all unfinished work through the selected day. Incoming acknowledgement records who accepted it. Task completion is recorded separately.</p>'+current.handovers.map(h=>'<section class="saved"><h3>'+escape(h.day)+' · '+escape(staffName(h.outgoing_id))+' → '+escape(staffName(h.incoming_id))+'</h3><p>'+escape(h.note)+'</p><p>'+h.tasks.length+' unfinished tasks and '+(h.missing_work?.length||0)+' unplanned work items at handover · '+(h.acknowledged_at?'Acknowledged '+escape(h.acknowledged_at)+' by '+escape(staffName(h.acknowledged_by)):'Awaiting '+escape(staffName(h.incoming_id)))+'</p>'+(h.missing_work?.length?'<ul>'+h.missing_work.map(m=>'<li>'+escape(horseName(m.horse_id))+' · '+escape(m.reason||m.title||m.routine_id)+'</li>').join('')+'</ul>':'')+taskTable(h.tasks)+'</section>').join('')+form('handover','Prepare the next shift','Prepare handover','handover-prepare')+form('acknowledge','Accept the handover','Acknowledge handover','handover-acknowledge');
  return '<h2>Working files and sources</h2><p>Save the whole working application to preserve every record and unfinished form. The ZIP also contains operating tables and the full source. CSV files are exports; reopen with the working JSON.</p><div class="actions"><button id="download-working">Save working application</button><button id="download-zip">Download complete ZIP</button><button id="download-record">Download record JSON</button><button id="restore-browser">Restore last browser save</button><button id="print-work">Print current workspace</button></div><label>Reopen a working JSON file<input type="file" id="open-working" accept=".json,application/json"></label>'+current.sources.map(s=>'<section class="saved"><h3>'+escape(s.title)+'</h3><p><a href="'+escape(s.url)+'" target="_blank" rel="noreferrer">'+escape(s.url)+'</a> · checked '+escape(s.checked_at)+'</p><ul>'+s.facts.map(f=>'<li>'+escape(f)+'</li>').join('')+'</ul><p>'+escape(s.setup)+'</p></section>').join('')+'<h3>Original source files</h3><label>Attach an original text or CSV file<input type="file" id="source-upload" accept=".csv,.txt,.md,.json,.tsv,.html"></label>'+table(['File','Revision','Notes','Download'],current.source_files.map(f=>[escape(f.name),String(f.revision),escape(f.note),'<button data-source-download="'+escape(f.id)+'">Download original</button>']))+form('source','Retain a complete source text','Save source file','source-file-save','Pasted text is retained exactly, including quotes and line breaks. Use a new ID for a separate source.')+'<h3>Saved operations</h3>'+table(['Revision','When','Operation'],current.history.slice().reverse().map(h=>[String(h.revision),escape(h.at),escape(h.kind)]));
 }
 function render(){
  root.innerHTML='<header><div><p class="eyebrow">Daily barn work</p><h1>'+escape(current.workspace.name)+'</h1><p class="hint">Saved revision '+current.revision+' · '+escape(current.workspace.timezone)+'</p></div><div class="actions"><label>Working date<input id="working-day" type="date" value="'+escape(ui.day)+'"></label><button id="save-top">Save working file</button></div></header><nav aria-label="Barn work sections">'+Object.entries(labels).map(([id,label])=>'<button data-tab="'+id+'" aria-current="'+(ui.tab===id?'page':'false')+'">'+escape(label)+'</button>').join('')+'<div class="message" role="status">'+escape(message||'Start with People & places, then Horses, Care instructions and Routines.')+'</div><main>'+content()+'</main><footer>Working data stays in this browser and downloaded files. Keep the latest working file when moving between devices.</footer>';
  root.querySelectorAll('[data-tab]').forEach(el=>el.onclick=()=>{capture();ui.tab=el.dataset.tab;render();});
  document.getElementById('working-day').onchange=e=>{capture();ui.day=e.target.value;lastPlan=null;render();};
  document.getElementById('save-top').onclick=()=>{save();render();};
  root.querySelectorAll('[data-reset]').forEach(el=>el.onclick=()=>{capture();delete ui.drafts[el.dataset.reset];render();});
  root.querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>{
   capture();const type=el.dataset.edit,id=el.dataset.id;
   if(type==='task'){for(const formName of ['assignment','outcome','refresh'])ui.drafts[formName]={...(ui.drafts[formName]||{}),id};}
   else{const arrays={horse:'horses',staff:'staff',location:'locations',instruction:'instructions',routine:'routines'};const selected=current[arrays[type]].find(v=>v.id===id);ui.drafts[type]=JSON.parse(JSON.stringify(selected));if(type==='routine')ui.drafts[type].slots=routineSlots(selected);}
   render();const formName=type==='task'?'assignment':type;document.getElementById(key(formName,'id'))?.focus();
  });
  root.querySelectorAll('form[data-form]').forEach(el=>el.onsubmit=e=>{
   e.preventDefault();capture();try{
    const name=el.dataset.form,kind=el.dataset.kind,input=JSON.parse(JSON.stringify(ui.drafts[name]));
    if(name==='routine')input.slots=parseSlots(input.slots);
    if(['handover','close','reopen'].includes(name))input.day=ui.day;
    if(['outcome','move'].includes(name)){input.occurred_at=localInstant(input.occurred_at,input.actual_offset);delete input.actual_offset;}
    operate(kind,input);
   }catch(error){message=error.message;}render();
  });
  const bind=(id,fn)=>{const el=document.getElementById(id);if(el)el.onclick=()=>{capture();try{fn();}catch(error){message=error.message;}render();};};
  bind('restore-browser',()=>{const saved=JSON.parse(localStorage.getItem('barn-work:'+current.id)||'null');if(!saved)throw Error('No saved browser copy is available. Reopen the downloaded working file.');const restored=barn.validate(saved.record);current=restored;ui={...ui,...saved.ui};epoch++;message='Restored saved browser revision '+current.revision+'.';});bind('plan-day',()=>operate('plan-day',{day:ui.day}));bind('download-working',save);bind('download-record',()=>download('Barn_Working_Record.json',JSON.stringify(current,null,2)+'\n'));bind('download-zip',zipDownload);bind('print-work',()=>window.print());
  const filter=document.getElementById('task-filter');if(filter)filter.onchange=e=>{capture();ui.filter=e.target.value;render();};
  const open=document.getElementById('open-working');if(open)open.onchange=async e=>{
   try{const file=e.target.files[0];if(!file)return;if(file.size>32*1024*1024)throw Error('Choose a working file below32MiB.');const prior=epoch,token=++opening;const data=JSON.parse(await file.text());if(token!==opening)return;if(prior!==epoch)throw Error('The workspace changed while this file was opening. Select the file again.');const next=data.version==='barn-work.application.v1'?data.record:data;const validated=barn.validate(next);
    current=validated;epoch++;ui=data.version==='barn-work.application.v1'?{...ui,...data.ui}: {...ui,drafts:{}};message='Reopened '+file.name+' at revision '+current.revision+'.';lastPlan=null;
   }catch(error){message='Could not open this file: '+error.message;}render();
  };
  const sourceUpload=document.getElementById('source-upload');if(sourceUpload)sourceUpload.onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>1000000)throw Error('Choose a source file below one million bytes.');const before=epoch;const content=await file.text();if(before!==epoch)throw Error('The workspace changed while reading this source. Select it again.');operate('source-file-save',{id:'original-'+Date.now()+'-'+(++sequence),name:file.name,type:file.type||'text/plain',content,note:'Original file selected by the operator.'});}catch(error){message=error.message;}render();};
  root.querySelectorAll('[data-source-download]').forEach(el=>el.onclick=()=>{const f=current.source_files.find(x=>x.id===el.dataset.sourceDownload);download(f.name,f.content,f.type);});
 }
 render();
 return {snapshot,render,operate,exportFiles,getRecord:()=>JSON.parse(JSON.stringify(current))};
}
export const barnCSS=String.raw`
#barn-app{color:#191919;background:#fff;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;max-width:1280px;margin:0 auto;padding:24px;box-sizing:border-box;color-scheme:light}
#barn-app *,#barn-app *::before,#barn-app *::after{box-sizing:border-box}
#barn-app h1,#barn-app h2,#barn-app h3,#barn-app p,#barn-app label,#barn-app td,#barn-app th,#barn-app li,#barn-app small,#barn-app strong{color:#191919}
#barn-app h1{font-size:26px;line-height:1.25;margin:4px 0 8px}#barn-app h2{font-size:22px;margin:0 0 12px}#barn-app h3{font-size:17px;margin:0 0 12px}
#barn-app header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:1px solid #bbb;padding-bottom:20px}
#barn-app .eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:0}
#barn-app .hint,#barn-app small{font-size:13px;color:#494949}#barn-app p{margin:8px 0 14px}
#barn-app nav,#barn-app .actions{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}#barn-app nav{padding:16px 0}
#barn-app button,#barn-app input,#barn-app select,#barn-app textarea{font:inherit;color:#191919;background:#fff;border:1px solid #999;border-radius:2px;max-width:100%}
#barn-app button{padding:9px 13px;cursor:pointer;min-height:42px}#barn-app button:hover{background:#eee}#barn-app button[aria-current=page]{background:#222;color:#fff;border-color:#222}
#barn-app input:not([type=checkbox]),#barn-app select,#barn-app textarea{display:block;padding:8px;width:100%;min-height:40px}#barn-app input[type=checkbox]{display:block;width:20px;height:20px;margin-top:9px;accent-color:#333}
#barn-app textarea{resize:vertical}#barn-app label{display:block;font-size:13px;font-weight:600;min-width:0}
#barn-app input::placeholder,#barn-app textarea::placeholder{color:#666;opacity:1}#barn-app button:focus-visible,#barn-app input:focus,#barn-app select:focus,#barn-app textarea:focus{outline:2px solid #333;outline-offset:2px}
#barn-app .message,#barn-app .notice{padding:12px 16px;background:#f2f2f2;border:1px solid #c8c8c8;margin:0 0 18px;overflow-wrap:anywhere}
#barn-app main{min-width:0}#barn-app form,#barn-app .saved{padding:18px;border:1px solid #bbb;margin:20px 0;background:#fff}
#barn-app .fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:16px}#barn-app .wide{grid-column:1/-1}
#barn-app .table-wrap{width:100%;overflow:auto;margin:16px 0;border:1px solid #bbb}#barn-app table{width:100%;border-collapse:collapse;min-width:640px;background:#fff}
#barn-app th,#barn-app td{padding:10px 12px;border-bottom:1px solid #ccc;text-align:left;vertical-align:top;font-size:13px;background:#fff}
#barn-app th{background:#eee;font-weight:700}#barn-app td{overflow-wrap:anywhere;max-width:400px}#barn-app .empty{padding:16px;border:1px dashed #aaa}
#barn-app a{color:#222;text-decoration:underline;overflow-wrap:anywhere}#barn-app footer{border-top:1px solid #bbb;padding-top:16px;margin-top:24px;font-size:12px;color:#494949}
@media(max-width:640px){#barn-app{padding:14px;font-size:14px}#barn-app header{display:block}#barn-app h1{font-size:23px}#barn-app .fields{grid-template-columns:1fr}#barn-app .wide{grid-column:auto}#barn-app nav{gap:6px}#barn-app nav button{flex:1 1 140px;text-align:left}#barn-app form,#barn-app .saved{padding:13px}#barn-app header .actions{margin-top:14px}}
@media print{#barn-app nav,#barn-app .actions,#barn-app form,#barn-app footer{display:none}#barn-app{max-width:none;padding:0}#barn-app .table-wrap{overflow:visible}#barn-app table{min-width:0}#barn-app .saved{break-inside:avoid}}
`;
export function renderBarnHTML(record,{sourceFiles={},engineSource='',zipSource='',hashSource=''}={}){
 const safe=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 hashSource=hashSource||sourceFiles['source/connected_sha256.cjs'];
 if(!engineSource||!zipSource||!hashSource)throw Error('Supply the exact complete engine, hash and archive sources.');
 const boot="const barnModule={exports:{}};(function(module,exports){"+engineSource+"\n})(barnModule,barnModule.exports);const zipModule={exports:{}};(function(module,exports){"+zipSource+"\n})(zipModule,zipModule.exports);const hashModule={exports:{}};(function(module,exports){"+hashSource+"\n})(hashModule,hashModule.exports);window.barnWork=("+barnClient.toString()+")("+safe(barn.validate(record))+","+safe(sourceFiles)+",barnModule.exports,zipModule.exports,hashModule.exports,"+safe(barnCSS)+");";
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Daily barn work</title><style>html,body{margin:0;background:#fff;color:#191919;color-scheme:light}'+barnCSS+'</style></head><body><div id="barn-app"></div><script>'+boot.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
}
