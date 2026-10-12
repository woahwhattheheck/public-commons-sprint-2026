// MIT. Complete implementation and receiving desk in the original SF74 case.
import {
  PLAN_FIELDS, TASK_STATUSES, RECEIVING_OUTCOMES, MAX_MATERIAL_BYTES,
  newCommissioning, validateCommissioning, applyCommissioningCommand,
  previewCommissioningWorkorder, commissioningWorkorder, commissioningSummary,
  commissioningComparisons, commissioningOriginalFiles, commissioningFileBytes,
  commissioningReport, commissioningTasksCsv, encodeCommissioningBytes, commissioningReceivingMatches,
} from './commissioning.mjs';

const copy=value=>JSON.parse(JSON.stringify(value));
const labels={title:'Implementation name',customerTask:'Customer task',payer:'Implementation payer',
  merchant:'Merchant',buyer:'Buyer / consuming team',implementationOwner:'Implementation owner',
  receivingOwner:'Receiving operator',sourceLocation:'Original source / account / file location',
  merchantHost:'Merchant host / resource',buyerApplication:'Buyer application',outputDefinition:'Complete useful output',
  repeatTrigger:'Reason and trigger to repeat',supportOwner:'Support owner',supportBoundary:'Support and correction scope',
  commercialReference:'Original commercial record',notes:'Implementation notes'};
const readable=value=>String(value??'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ');
const el=(parent,tag,text,cls='')=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;parent.append(n);return n;};
const button=(parent,text,run)=>{const n=el(parent,'button',text,'secondary');n.type='button';n.addEventListener('click',run);return n;};
const field=(parent,label,{type='text',value='',rows=3,required=false,options=null}={})=>{
  const wrap=el(parent,'label',undefined,'commissioning-field');el(wrap,'span',label);
  const n=el(wrap,options?'select':type==='textarea'?'textarea':'input');
  if(options)for(const [value,text] of options){const option=el(n,'option',text);option.value=value;}
  else if(type==='textarea')n.rows=rows;else n.type=type;
  n.value=value;n.required=required;return n;
};
const table=(parent,heads,rows)=>{
  const wrap=el(parent,'div',undefined,'commissioning-table');const t=el(wrap,'table');
  const tr=el(el(t,'thead'),'tr');for(const heading of heads)el(tr,'th',heading);
  const body=el(t,'tbody');for(const cells of rows){const row=el(body,'tr');for(const cell of cells)el(row,'td',cell);}
  return body;
};
const localTime=value=>{
  if(!value)return '';const d=new Date(value);
  if(!Number.isFinite(d.valueOf()))return '';
  return new Date(d.valueOf()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
};
const utcTime=value=>{if(!value)throw Error('Enter the actual observation time.');return new Date(value).toISOString();};
function download(name,body,type='application/json') {
  const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function selectMany(parent,label,rows) {
  const n=field(parent,label,{options:rows.map(row=>[row.id,row.title??row.name??row.id])});
  n.multiple=true;n.size=Math.min(8,Math.max(3,rows.length));return n;
}
const selections=node=>[...node.selectedOptions].map(option=>option.value);
const setSelections=(node,values)=>{for(const option of node.options)option.selected=values.includes(option.value);};
const numberValue=node=>node.value===''?null:Number(node.value);
function formDraft(root) {
  const values={};
  for(const label of root.querySelectorAll('form label.commissioning-field')) {
    const name=label.querySelector('span')?.textContent,node=label.querySelector('input,select,textarea');
    if(!name||!node||node.type==='file')continue;
    values[name]=node.multiple?selections(node):node.type==='checkbox'?node.checked:node.value;
  }
  return values;
}
function restoreFormDraft(form,values) {
  if(!values)return;
  for(const label of form.querySelectorAll('label.commissioning-field')) {
    const name=label.querySelector('span')?.textContent,node=label.querySelector('input,select,textarea');
    if(!name||!node||!Object.hasOwn(values,name)||node.type==='file')continue;
    if(node.multiple)setSelections(node,values[name]);
    else if(node.type==='checkbox')node.checked=values[name];
    else if(node.tagName!=='SELECT'||[...node.options].some(option=>option.value===values[name]))node.value=values[name];
  }
}

export function mountCommissioningDesk({root,onChange=()=>{}}) {
  let state=null,candidate=null,preview=null,epoch=0,busy=false,destroyed=false,page=0;
  let receivedEpoch=0;
  root.replaceChildren();root.id='implementation';root.classList.add('commissioning-desk');
  const card=el(root,'section',undefined,'card'),header=el(card,'div',undefined,'section-heading');
  const h=el(header,'div');el(h,'p','Merchant delivery','eyebrow');el(h,'h2','Implementation and receiving');
  el(h,'p','Assign the agreed work, deliver it to the receiving application and keep the original case together.');
  const revision=el(header,'span','No workorder selected','stage-hint');
  const notice=el(card,'p','Generate a workorder above, then use it here.','commissioning-notice');notice.setAttribute('role','status');
  const controls=el(card,'div',undefined,'commissioning-toolbar');
  const actor=field(controls,'Recorded by',{value:'',required:true});
  actor.autocomplete='name';actor.placeholder='Actual operator name';
  const summary=el(card,'div',undefined,'commissioning-summary');
  const pending=el(card,'div',undefined,'commissioning-pending');
  const body=el(card,'div',undefined,'commissioning-body');
  function section(title,open=false) {
    const d=el(body,'details');d.open=open;el(d,'summary',title);
    return el(d,'div',undefined,'commissioning-section');
  }
  const planRoot=section('Implementation plan',true),workRoot=section('Assigned work',true),
    materialsRoot=section('Deliverables and original files'),receivingRoot=section('Technical and customer receiving'),
    measurementsRoot=section('Before, installed and recurring effort'),historyRoot=section('Workorders, history and handover');
  const say=(text,error=false)=>{notice.textContent=text;notice.classList.toggle('error',error);};
  function ensureState() {if(!state)state=newCommissioning();return state;}
  function edited() {
    ensureState().revision++;epoch++;onChange();renderSummary();
    say('Implementation changes are in this case draft. Save case to retain them.');
  }
  function lock(value) {
    busy=value;root.setAttribute('aria-busy',String(value));
    for(const n of root.querySelectorAll('button,input,textarea,select')) {
      if(value){n.dataset.commissioningWasDisabled=String(n.disabled);n.disabled=true;}
      else if(Object.hasOwn(n.dataset,'commissioningWasDisabled')) {n.disabled=n.dataset.commissioningWasDisabled==='true';delete n.dataset.commissioningWasDisabled;}
    }
  }
  async function command(type,payload) {
    if(busy)return null;
    const operation={type,requestId:crypto.randomUUID(),expectedRevision:ensureState().revision,
      actor:actor.value.trim(),payload};
    if(!operation.actor){say('Enter the actual operator in Recorded by.',true);actor.focus();return null;}
    const stamp=epoch;lock(true);say('Applying the implementation change…');
    try {
      const next=await applyCommissioningCommand(state,operation);
      if(destroyed||stamp!==epoch)throw Error('The case changed while this operation was prepared. Apply it to the current case.');
      state=next.state;epoch++;onChange();renderSummary();
      say('Implementation change added to the case draft. Save case to retain it.');
      return next;
    } catch(error){if(!destroyed)say(error.message,true);return null;}
    finally{if(!destroyed)lock(false);}
  }
  function renderSummary() {
    summary.replaceChildren();
    if(!state){revision.textContent='No workorder selected';return;}
    const s=commissioningSummary(state);revision.textContent='Implementation revision '+s.revision;
    for(const [value,label] of [[s.tasks,'active tasks'],[s.done,'done'],[s.technicalAccepted,'technical accepted'],
      [s.accepted,'customer accepted'],[s.changesRequired,'need correction'],[s.receivingNeedsUpdate,'receiving needs updating']]) {
      const box=el(summary,'div');el(box,'strong',value);el(box,'span',label);
    }
  }
  function renderPending() {
    pending.replaceChildren();
    if(!candidate||!preview)return;
    el(pending,'h3','Use generated workorder: '+preview.workOrderRef);
    el(pending,'p',preview.newTasks.length+' new tasks · '+preview.changedTasks.length+
      ' changed source tasks · '+preview.removedTasks.length+' no longer in this source.');
    if(preview.scopeChanges.length)table(pending,['Scope field','Previous value','New value'],
      preview.scopeChanges.map(row=>[readable(row.field),String(row.from??''),String(row.to??'')]));
    if(preview.changedTasks.some(row=>row.operatorEditsPreserved.length))
      el(pending,'p','Your edited titles and acceptance text stay in place. Changed source text appears beside the assigned task for selective adoption.');
    button(pending,preview.recordedEdition?'Use retained edition':'Use this workorder',async()=>{
      const selected=candidate;
      const next=await command('record_workorder',selected);
      if(next){candidate=null;preview=null;renderAll();body.querySelector('details').open=true;}
    });
  }
  function renderPlan() {
    planRoot.replaceChildren();const grid=el(planRoot,'div',undefined,'commissioning-grid');
    for(const key of PLAN_FIELDS) {
      const multiline=['customerTask','outputDefinition','supportBoundary','notes'].includes(key);
      const node=field(grid,labels[key],{type:multiline?'textarea':'text',value:state?.plan[key]??'',rows:3});
      node.maxLength=multiline?16000:4096;
      if(multiline)node.parentElement.classList.add('wide');
      node.addEventListener('input',()=>{ensureState().plan[key]=node.value;edited();});
    }
  }
  function renderWork() {
    workRoot.replaceChildren();
    if(!state?.editions.length){el(workRoot,'p','Use a generated workorder to create its implementation tasks.');return;}
    const toolbar=el(workRoot,'div',undefined,'commissioning-toolbar');
    const search=field(toolbar,'Find tasks',{value:renderWork.search??''});
    const archived=field(toolbar,'Show retired tasks',{type:'checkbox'});archived.checked=renderWork.retired??false;
    search.addEventListener('change',()=>{renderWork.search=search.value;page=0;renderWork();});
    archived.addEventListener('change',()=>{renderWork.retired=archived.checked;page=0;renderWork();});
    button(toolbar,'Add implementation task',async()=>{
      const next=await command('save_tasks',{tasks:[{id:'task-'+crypto.randomUUID(),title:'New implementation task',owner:actor.value.trim()}]});
      if(next){renderWork.search='';renderWork.retired=false;page=Math.floor((state.tasks.filter(row=>!row.retired).length-1)/25);renderWork();renderReceiving();renderMaterials();}
    });
    const needle=(renderWork.search??'').toLocaleLowerCase();
    const filtered=state.tasks.filter(row=>(renderWork.retired||!row.retired&&row.status!=='retired')&&
      (!needle||[row.title,row.owner,row.notes,row.acceptance].join(' ').toLocaleLowerCase().includes(needle)));
    page=Math.min(page,Math.max(0,Math.ceil(filtered.length/25)-1));
    const list=el(workRoot,'div',undefined,'commissioning-tasks');
    for(const task of filtered.slice(page*25,page*25+25)) {
      const item=el(list,'article',undefined,'commissioning-task'),grid=el(item,'div',undefined,'commissioning-task-grid');
      const title=field(grid,'Task',{value:task.title});title.maxLength=2400;title.parentElement.classList.add('wide');
      const owner=field(grid,'Owner',{value:task.owner});owner.maxLength=200;
      const due=field(grid,'Due',{type:'date',value:task.dueOn});
      const status=field(grid,'Status',{value:task.status,options:TASK_STATUSES.map(value=>[value,readable(value)])});
      const retired=field(grid,'Retired',{type:'checkbox'});retired.checked=task.retired;
      const details=el(item,'details');el(details,'summary','Acceptance, dependencies and work notes');
      const acceptance=field(details,'Acceptance / complete result',{type:'textarea',value:task.acceptance,rows:4});
      const dependencies=selectMany(details,'Requires these tasks',state.tasks.filter(row=>row.id!==task.id));
      setSelections(dependencies,task.dependencies);
      const notes=field(details,'Work and implementation notes',{type:'textarea',value:task.notes,rows:4});
      acceptance.maxLength=notes.maxLength=64000;
      for(const [key,node] of Object.entries({title,owner,dueOn:due,status,retired,acceptance,notes,dependencies}))
        node.addEventListener(['SELECT'].includes(node.tagName)||node.type==='checkbox'?'change':'input',()=>{
          const currentTask=ensureState().tasks.find(row=>row.id===task.id);
          if(!currentTask)return;
          currentTask[key]=key==='retired'?node.checked:key==='dependencies'?selections(node):node.value;
          edited();
        });
      const unresolved=task.dependencies.filter(id=>{const other=state.tasks.find(row=>row.id===id);return other&&!other.retired&&other.status!=='done';});
      if(unresolved.length)el(item,'p',unresolved.length+' prerequisite task'+(unresolved.length===1?' remains':'s remain')+' unfinished.','muted');
      if(Object.keys(task.proposed).length) {
        const changes=el(item,'div',undefined,'commissioning-source-change');el(changes,'h4','Changed workorder source');
        for(const [key,value] of Object.entries(task.proposed)) {
          el(changes,'p',readable(key)+': '+String(value));
          button(changes,'Use source '+readable(key),async()=>{
            const result=await command('accept_source_changes',{changes:[{taskId:task.id,field:key}]});
            if(result)renderWork();
          });
        }
      }
      el(item,'small',(task.sourceKey?'Original milestone '+task.sourceKey:'Operator-created task')+' · '+task.id);
    }
    const paging=el(workRoot,'div',undefined,'commissioning-toolbar');
    el(paging,'span',filtered.length?Math.min(page*25+1,filtered.length)+'–'+Math.min((page+1)*25,filtered.length)+' of '+filtered.length+' tasks':'No tasks match');
    const prev=button(paging,'Previous tasks',()=>{page--;renderWork();});prev.disabled=page===0;
    const next=button(paging,'Next tasks',()=>{page++;renderWork();});next.disabled=(page+1)*25>=filtered.length;
  }
  function renderMaterials(reset=false) {
    const draft=reset?null:formDraft(materialsRoot);
    materialsRoot.replaceChildren();
    if(!state?.editions.length){el(materialsRoot,'p','Choose the workorder before attaching its deliverables.');return;}
    const form=el(materialsRoot,'form',undefined,'commissioning-form');
    const grid=el(form,'div',undefined,'commissioning-grid');
    const file=field(grid,'Original deliverable files',{type:'file',required:true});file.multiple=true;
    const kind=field(grid,'Deliverable kind',{value:'deliverable',options:[['deliverable','Customer deliverable'],['source','Original source'],
      ['installation','Installation / configuration'],['observation','Receiving observation'],['guide','Operating guide']]});
    const description=field(grid,'What these files deliver',{type:'textarea'});
    const reference=field(grid,'Original record or location');
    const tasks=selectMany(grid,'Related tasks',state.tasks);
    const submit=el(form,'button','Attach original files');submit.type='submit';
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;
      const selected=[...file.files],context={kind:kind.value,description:description.value,reference:reference.value,taskIds:selections(tasks)};
      for(const original of selected) {
        if(original.size>MAX_MATERIAL_BYTES){say(original.name+' exceeds the per-file limit of '+Math.floor(MAX_MATERIAL_BYTES/1048576)+' MiB.',true);return;}
        const stamp=epoch;let data;
        try{data=encodeCommissioningBytes(new Uint8Array(await original.arrayBuffer()));}
        catch(error){say(error.message,true);return;}
        if(stamp!==epoch){say('The case changed while reading the file. Select it again.',true);return;}
        const result=await command('add_material',{id:'material-'+crypto.randomUUID(),name:original.name,
          mediaType:original.type||'application/octet-stream',data,editionId:state.activeEditionId,...context});
        if(!result)return;
      }
      renderMaterials(true);renderReceiving();renderMeasurements();renderHistory();
    });
    restoreFormDraft(form,draft);
    const rows=table(materialsRoot,['File','Purpose / reference','Recorded','Download'],state.materials.map(row=>[
      row.name,row.description+(row.reference?'\n'+row.reference:''),row.recordedAt+'\n'+row.actor,'']));
    [...rows.rows].forEach((tr,i)=>{const material=state.materials[i];
      button(tr.cells[3],'Download original',()=>download(material.name,commissioningFileBytes(state,material.sha256),material.mediaType));
    });
  }
  function renderReceiving(reset=false) {
    const draft=reset?null:formDraft(receivingRoot);
    receivingRoot.replaceChildren();
    if(!state?.editions.length){el(receivingRoot,'p','Choose the workorder before recording receiving.');return;}
    const form=el(receivingRoot,'form',undefined,'commissioning-form'),grid=el(form,'div',undefined,'commissioning-grid');
    const editions=state.editions.map(row=>[row.id,commissioningWorkorder(state,row.id).packet.workOrderRef+' · '+row.recordedAt]);
    const edition=field(grid,'Workorder edition',{value:state.activeEditionId,options:editions});
    const kind=field(grid,'Receiving kind',{value:'technical',options:[['technical','Technical receiving'],['customer','Customer receiving']]});
    const outcome=field(grid,'Observed result',{value:'not_run',options:RECEIVING_OUTCOMES.map(x=>[x,readable(x)])});
    const observed=field(grid,'Observed time (your local time)',{type:'datetime-local',required:true});
    const taskIds=selectMany(grid,'Received tasks',state.tasks),materialIds=selectMany(grid,'Original deliverables',state.materials);
    const reference=field(grid,'Receiving record / application / source reference');
    const notes=field(grid,'What the receiving operator observed',{type:'textarea',rows:4});notes.parentElement.classList.add('wide');
    const current=state.receiving.filter(row=>!state.receiving.some(other=>other.supersedesId===row.id));
    const correction=field(grid,'Correct an earlier observation',{value:'',options:[['','New observation'],...current.map(row=>[row.id,row.observedAt+' · '+row.kind+' · '+readable(row.outcome)])]});
    correction.addEventListener('change',()=>{
      const prior=state.receiving.find(row=>row.id===correction.value);if(!prior)return;
      edition.value=prior.editionId;kind.value=prior.kind;outcome.value=prior.outcome;
      observed.value=localTime(prior.observedAt);reference.value=prior.reference;notes.value=prior.notes;
      setSelections(taskIds,prior.taskIds);setSelections(materialIds,prior.materialIds);
    });
    const submit=el(form,'button','Record receiving');submit.type='submit';
    form.addEventListener('submit',async event=>{
      event.preventDefault();let observedAt;try{observedAt=utcTime(observed.value);}catch(error){say(error.message,true);return;}
      const result=await command('record_receiving',{id:'receiving-'+crypto.randomUUID(),editionId:edition.value,
        kind:kind.value,outcome:outcome.value,observedAt,taskIds:selections(taskIds),materialIds:selections(materialIds),
        reference:reference.value,notes:notes.value,supersedesId:correction.value||null});
      if(result){renderReceiving(true);renderHistory();}
    });
    restoreFormDraft(form,draft);
    table(receivingRoot,['Observed','Kind / outcome','Operator','Tasks','Observation / reference','Correction'],
      state.receiving.slice().reverse().map(row=>[row.observedAt,row.kind+' / '+readable(row.outcome),row.actor,
        row.taskIds.map(id=>state.tasks.find(task=>task.id===id)?.title??id).join('\n'),
        row.notes+(row.reference?'\n'+row.reference:'')+(!commissioningReceivingMatches(state,row)?'\nCurrent definition or delivery files changed':''),row.supersedesId?'Corrects '+row.supersedesId:
          state.receiving.some(other=>other.supersedesId===row.id)?'Corrected later':'']));
  }
  function renderMeasurements(reset=false) {
    const draft=reset?null:formDraft(measurementsRoot);
    measurementsRoot.replaceChildren();
    if(!state?.editions.length){el(measurementsRoot,'p','Choose the workorder before measuring its customer task.');return;}
    el(measurementsRoot,'p','Describe the same complete task, output and unit in each measurement. Retain the actual inputs, operator and observation; blank numeric fields remain unmeasured.');
    const form=el(measurementsRoot,'form',undefined,'commissioning-form'),grid=el(form,'div',undefined,'commissioning-grid');
    const edition=field(grid,'Workorder edition',{value:state.activeEditionId,options:state.editions.map(row=>[row.id,
      commissioningWorkorder(state,row.id).packet.workOrderRef+' · '+row.recordedAt])});
    const phase=field(grid,'Measurement phase',{value:'baseline',options:[['baseline','Before installation'],['installed','Installed workflow'],['recurring','Later recurring use']]});
    const task=field(grid,'Exact complete task',{type:'textarea',value:state.plan.customerTask,required:true});
    const key=field(grid,'Comparison identifier',{required:true});key.placeholder='Use the same identifier for comparable observations';
    const input=field(grid,'Actual input population / period',{type:'textarea'}),output=field(grid,'Complete output definition',{type:'textarea',value:state.plan.outputDefinition});
    const unit=field(grid,'Quantity unit');unit.placeholder='For example: complete reports';
    const quantity=field(grid,'Completed quantity',{type:'number'}),active=field(grid,'Active operator minutes',{type:'number'}),
      elapsed=field(grid,'Elapsed minutes',{type:'number'}),corrections=field(grid,'Manual corrections',{type:'number'});
    for(const node of [quantity,active,elapsed,corrections]){node.min='0';node.step=node===corrections?'1':'any';}
    const observed=field(grid,'Observed time (your local time)',{type:'datetime-local',required:true});
    const materials=selectMany(grid,'Original measurement files',state.materials),reference=field(grid,'Original measurement reference');
    const notes=field(grid,'Measurement notes',{type:'textarea'});
    const current=state.measurements.filter(row=>!state.measurements.some(other=>other.supersedesId===row.id));
    const correction=field(grid,'Correct an earlier measurement',{options:[['','New measurement'],...current.map(row=>[row.id,row.observedAt+' · '+row.phase+' · '+row.comparisonKey])]});
    correction.addEventListener('change',()=>{
      const prior=state.measurements.find(row=>row.id===correction.value);if(!prior)return;
      for(const [node,value] of [[edition,prior.editionId],[phase,prior.phase],[task,prior.taskDefinition],[key,prior.comparisonKey],
        [input,prior.inputDescription],[output,prior.outputDescription],[unit,prior.unit],[quantity,prior.units],
        [active,prior.activeMinutes],[elapsed,prior.elapsedMinutes],[corrections,prior.manualCorrections],
        [observed,localTime(prior.observedAt)],[reference,prior.reference],[notes,prior.notes]])node.value=value??'';
      setSelections(materials,prior.materialIds);
    });
    const submit=el(form,'button','Record measurement');submit.type='submit';
    form.addEventListener('submit',async event=>{
      event.preventDefault();let observedAt;try{observedAt=utcTime(observed.value);}catch(error){say(error.message,true);return;}
      const result=await command('record_measurement',{id:'measurement-'+crypto.randomUUID(),editionId:edition.value,
        phase:phase.value,taskDefinition:task.value,comparisonKey:key.value,inputDescription:input.value,outputDescription:output.value,
        unit:unit.value,units:numberValue(quantity),activeMinutes:numberValue(active),elapsedMinutes:numberValue(elapsed),
        manualCorrections:numberValue(corrections),observedAt,materialIds:selections(materials),
        reference:reference.value,notes:notes.value,supersedesId:correction.value||null});
      if(result){renderMeasurements(true);renderHistory();}
    });
    restoreFormDraft(form,draft);
    table(measurementsRoot,['Observed / operator','Phase / task','Quantity','Active minutes','Elapsed minutes','Corrections','Source'],
      state.measurements.slice().reverse().map(row=>[row.observedAt+'\n'+row.actor,row.phase+'\n'+row.taskDefinition,
        row.units===null?'':row.units+' '+row.unit,row.activeMinutes,row.elapsedMinutes,row.manualCorrections,
        row.inputDescription+'\n'+row.reference]));
    el(measurementsRoot,'h3','Measured change');
    const comparisons=commissioningComparisons(state);
    if(!comparisons.length)el(measurementsRoot,'p','Record a baseline and an installed or recurring measurement to compare them.');
    for(const comparison of comparisons) {
      const item=el(measurementsRoot,'details');el(item,'summary',comparison.measurementId);
      if(!comparison.comparable){el(item,'p',comparison.reason);continue;}
      el(item,'p','Baseline '+comparison.baselineId+' · '+(comparison.sameVolume?'same recorded quantity':'different recorded quantity'));
      table(item,['Measure','Baseline','Observed','Change','Change %'],Object.entries(comparison.values).filter(([,v])=>v)
        .map(([key,v])=>[readable(key),v.baseline,v.observed,v.delta,v.percent===null?'':Number(v.percent.toFixed(2))]));
      if(Object.keys(comparison.perUnit).length){el(item,'h4','Per completed unit');
        table(item,['Measure','Baseline','Observed','Change'],Object.entries(comparison.perUnit).map(([key,v])=>[
          readable(key),v.baseline,v.observed,v.delta]));}
    }
  }
  function renderHistory() {
    historyRoot.replaceChildren();
    if(!state){el(historyRoot,'p','The workplan and its source history will be retained in this case.');return;}
    const toolbar=el(historyRoot,'div',undefined,'commissioning-toolbar');
    button(toolbar,'Download implementation report',()=>download('merchant-implementation.html',commissioningReport(state),'text/html'));
    button(toolbar,'Download task table',()=>download('merchant-implementation-tasks.csv',commissioningTasksCsv(state),'text/csv'));
    button(toolbar,'Download complete implementation',()=>download('merchant-commissioning.json',JSON.stringify(state,null,2)+'\n'));
    el(historyRoot,'p','Save case and use the existing complete case handoff to carry source captures, workorders, implementation, receiving and original deliverable bytes together.');
    const rows=table(historyRoot,['Workorder','Generated / recorded by','Exact packet','Selection'],
      state.editions.map(row=>{const packet=commissioningWorkorder(state,row.id).packet;return [
        packet.workOrderRef+'\n'+row.id,packet.generatedAt+'\n'+row.actor,row.packet,''];}));
    [...rows.rows].forEach((tr,i)=>{const edition=state.editions[i];
      if(edition.id===state.activeEditionId)el(tr.cells[3],'span','Selected');
      else button(tr.cells[3],'Review and use this edition',async()=>{
        const retained=commissioningWorkorder(state,edition.id),inputs={};
        for(const [key,sha] of Object.entries(edition.inputs)) {
          const bytes=commissioningFileBytes(state,sha);
          inputs[key]=key==='supportText'?new TextDecoder('utf-8',{fatal:true}).decode(bytes):encodeCommissioningBytes(bytes);
        }
        if(edition.runtimeMapping)inputs.inputs=copy(edition.runtimeMapping);
        await receiveWorkorder({packet:retained.packet,
          html:new TextDecoder('utf-8',{fatal:true}).decode(commissioningFileBytes(state,edition.html)),
          checklist:new TextDecoder('utf-8',{fatal:true}).decode(commissioningFileBytes(state,edition.checklist))},
          inputs,edition.sourceCase);
        pending.scrollIntoView({block:'center'});
      });
    });
    const originals=commissioningOriginalFiles(state);
    const files=table(historyRoot,['Original file','Bytes','Download'],originals.map(row=>[row.name,row.bytes,'']));
    [...files.rows].forEach((tr,i)=>{const file=originals[i];button(tr.cells[2],'Download',()=>download(file.name.split('/').at(-1),
      commissioningFileBytes(state,file.sha256),'application/octet-stream'));});
    const events=el(historyRoot,'details');el(events,'summary',state.events.length+' retained implementation operations');
    table(events,['Recorded','Operator','Operation','Request'],state.events.slice().reverse().map(row=>[row.recordedAt,row.actor,readable(row.type),row.id]));
  }
  function renderAll(resetForms=false) {
    renderSummary();renderPending();renderPlan();renderWork();renderMaterials(resetForms);renderReceiving(resetForms);renderMeasurements(resetForms);renderHistory();
  }
  async function receiveWorkorder(result,inputs,sourceCase=null) {
    const stamp=++receivedEpoch,caseEpoch=epoch;
    const received={result:copy(result),inputs:copy(inputs),sourceCase:copy(sourceCase)};
    try {
      const reviewed=await previewCommissioningWorkorder(state,received.result);
      if(destroyed||stamp!==receivedEpoch||caseEpoch!==epoch)return false;
      candidate=received;preview=reviewed;renderPending();
      say('Generated workorder is ready to review below. Use it to start or update the implementation.');
      return true;
    } catch(error){if(!destroyed&&stamp===receivedEpoch)say('Workorder could not be prepared for implementation: '+error.message,true);return false;}
  }
  renderAll();
  return {
    read(){return copy(state);},
    async prepare(value){return validateCommissioning(value);},
    apply(value){epoch++;receivedEpoch++;state=copy(value);candidate=null;preview=null;page=0;renderWork.search='';renderWork.retired=false;
      if(!actor.value&&state?.plan.implementationOwner)actor.value=state.plan.implementationOwner;
      renderAll(true);say(state?'Retained implementation and receiving reopened.':'Generate a workorder above, then use it here.');},
    receiveWorkorder,
    invalidateWorkorder(){receivedEpoch++;candidate=null;preview=null;renderPending();},
    async mergeSaved(value,{canReplace=()=>true}={}) {
      // The original case writer may add later immutable history during restore.
      const stamp=epoch,ready=await validateCommissioning(value);
      if(stamp!==epoch||!canReplace())return false;
      epoch++;state=ready;renderAll();return true;
    },
    destroy(){destroyed=true;epoch++;receivedEpoch++;root.replaceChildren();},
  };
}
