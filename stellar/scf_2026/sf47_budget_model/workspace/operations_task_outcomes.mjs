// Complete customer task comparison editor over the original Grant Operations case.
import {createOutcomeWorkbookDesk} from './task-outcomes-workbook-desk.mjs';
const SCHEMA = 'stellar-forge.sf47-customer-task-outcomes.v1';
const STORAGE = 'sf47.customer-task-outcomes.';
const CATEGORIES = ['ACQUISITION','PROCESSING','CORRECTION','RECEIVING','OTHER'];
const BASIS = ['UNRECORDED','OBSERVED','ESTIMATED','MIXED'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => structuredClone(value);
const label = value => String(value ?? '').toLowerCase().replaceAll('_',' ').replace(/^./, c => c.toUpperCase());
const shown = value => value === null || value === undefined ? 'Unknown' : String(value);
const uuid = prefix => prefix + crypto.randomUUID().replaceAll('-','');
const table = (headers, rows) => '<div class="task-outcomes-table"><table><thead><tr>'+headers.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
function download(raw, filename, type='application/json') {
  const url=URL.createObjectURL(raw instanceof Blob?raw:new Blob([raw],{type}));
  const link=document.createElement('a');link.href=url;link.download=filename;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function pathValue(object, path) {
  let current=object;for(const part of path.split('.'))current=current?.[part];return current;
}
function setPath(object, path, value) {
  const parts=path.split('.');let current=object;for(const part of parts.slice(0,-1))current=current[part];
  current[parts.at(-1)]=value;
}
function choice(values) {return values.map(v=>[v,label(v)]);}
function same(a,b) {return JSON.stringify(a)===JSON.stringify(b);}
function receiveDraftRows(current, incoming) {
  for(const [id,row] of incoming){
    const retained=current[id];
    if(retained&&(!same(retained.inputs,row.inputs)||String(retained.note||'')!==row.note||
       retained.workbook&&row.workbook&&!same(retained.workbook,row.workbook)))
      throw Error('The retained draft or save note differs. Download the current editor recovery before reconciling the complete writing.');
  }
  for(const [id,row] of incoming){
    if(!Object.hasOwn(current,id))current[id]=row;
    else if(!current[id].workbook&&row.workbook)current[id].workbook=clone(row.workbook);
  }
}
function terminalRejection(error) {
  const status=Number(error.status ?? error.details?.status ?? error.statusCode);
  return status>=400&&status<500&&![408,429].includes(status)&&error.code!=='REQUEST_CONFLICT';
}

export function mountTaskOutcomes({container,current,api,saveApi=api,session={},mutationId,recordingActor,onCase,onSources}) {
  const root=document.createElement('section');root.className='task-outcomes-desk';
  root.setAttribute('aria-label','Customer task outcomes');container.replaceChildren(root);
  let active=true,busy=false,hostBusy=false,ready=false,selected=null,heads=[],currentCase=current,storageError='';
  const caseId=current.program.id,storageKey=STORAGE+caseId;
  const available=()=>active&&root.isConnected;
  if(!session.initialized){
    let saved;try{saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
    if(saved?.schema===SCHEMA+'.editor'&&saved.caseId===caseId){
      for(const key of ['drafts','selection','pending','pendingWorkbook','receipt','notice'])
        if(!Object.hasOwn(session,key)&&Object.hasOwn(saved,key))session[key]=saved[key];
    }
    session.initialized=true;
  }
  session.drafts ||= {};
  const $=selector=>root.querySelector(selector);
  const draft=()=>session.selection?.mode==='draft'?session.drafts[session.selection.id]:null;
  const editable=()=>currentCase.program.state==='OPEN';
  const workbookDesk=createOutcomeWorkbookDesk({root,session,getDraft:draft,getCurrent:()=>currentCase,
    getInputs:()=>draft()?.inputs||(selected?{id:selected.edition.id,expectedRevision:selected.edition.revision,document:selected.edition.document}:null),
    editable,available,persist,render,controls,run,notify,api,saveApi,mutationId,recordingActor,reload,onCase,validateInput,terminalRejection});
  function persist(){
    try{
      sessionStorage.setItem(storageKey,JSON.stringify({schema:SCHEMA+'.editor',caseId,
        planContentSha256:currentCase.plan.contentSha256,drafts:session.drafts,selection:session.selection,
        pending:session.pending??null,pendingWorkbook:session.pendingWorkbook??null,receipt:session.receipt??null,notice:session.notice??''}));
      storageError='';
    }catch{storageError='Browser storage is full. Download the complete editor recovery or save a case edition to retain this work.';}
  }
  function notify(text,error=false){session.notice=text;persist();if(available()){const n=$('[data-task-notice]');if(n){n.textContent=text;n.setAttribute('role',error?'alert':'status');}}}
  function controls(){
    if(!available())return;
    const locked=busy||hostBusy||!ready;
    root.setAttribute('aria-busy',String(locked));
    root.querySelectorAll('button,input,select,textarea').forEach(el=>{
      const pendingEdit=Boolean(session.pendingWorkbook)&&(el.dataset.editor==='true'||
        ['new','sources','import-input','preview','save','reconcile','use-current','edit','clone','add-row','remove-row','add-followup','remove-followup'].includes(el.dataset.taskAction)||
        ['choose','apply','refresh-review'].includes(el.dataset.taskWb));
      el.disabled=locked||pendingEdit||el.dataset.fixed==='true'||(el.dataset.editor==='true'&&(!draft()||!editable()));
    });
    const save=$('[data-task-action="save"]');
    if(save)save.disabled=locked||!editable()||!draft()?.preview||Boolean(session.pending||session.pendingWorkbook);
    const recover=$('[data-task-action="recover-save"]');
    if(recover)recover.disabled=locked||!session.pending;
    const warning=$('[data-task-storage]');if(warning)warning.textContent=storageError;
  }
  function setHostBusy(value){hostBusy=Boolean(value);controls();}
  async function run(action){
    if(busy||hostBusy||!ready||!available())return;
    busy=true;controls();try{await action();}catch(error){notify(error.message||String(error),true);}
    finally{busy=false;if(available())controls();}
  }
  function field(text,path,value,options={}){
    const attrs=' data-task-path="'+esc(path)+'" data-editor="true"'+(options.required?' required':'');
    let input;
    if(options.select)input='<select'+attrs+(options.multiple?' multiple size="4"':'')+'>'+options.select.map(([key,name])=>'<option value="'+esc(key)+'"'+((options.multiple?(value||[]).includes(key):String(value??'')===String(key))?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select>';
    else if(options.area)input='<textarea'+attrs+' rows="'+(options.rows||3)+'">'+esc(value)+'</textarea>';
    else input='<input'+attrs+' value="'+esc(value)+'"'+(options.decimal?' inputmode="decimal"':'')+'>';
    return '<label class="'+(options.wide?'task-wide':'')+'">'+esc(text)+input+(options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
  }
  function action(text,name,attrs='',fixed=false){
    return '<button type="button" data-task-action="'+name+'" '+attrs+(fixed?' data-fixed="true" disabled':'')+'>'+esc(text)+'</button>';
  }
  function methods(document,side,title){
    const m=pathValue(document,side),prefix='document.'+side+'.';
    const sources=currentCase.sources.map(row=>[row.id,row.filename+' · '+row.sha256.slice(0,12)]);
    let content='<section class="task-method"><h4>'+esc(title)+'</h4><div class="task-fields">';
    content+=field('Method name',prefix+'name',m.name,{required:true});
    content+=field('Measurement basis',prefix+'basis',m.basis,{select:choice(BASIS)});
    content+=field('Original observation time',prefix+'observedAt',m.observedAt,{help:'ISO date/time with its timezone; leave blank while unknown.'});
    content+=field('Complete source edition or query',prefix+'sourceReference',m.sourceReference,{wide:true,area:true});
    content+=field('Whole population and selected scope',prefix+'population',m.population,{wide:true,area:true});
    content+=field('Period and duration',prefix+'period',m.period,{wide:true});
    content+=field('Complete useful output received',prefix+'output',m.output,{wide:true,area:true});
    content+=field('Quality, acceptance and exceptions',prefix+'quality',m.quality,{wide:true,area:true});
    content+=field('Attempted complete tasks',prefix+'attemptedTasks',m.attemptedTasks,{decimal:true});
    content+=field('Completed and accepted tasks',prefix+'completedTasks',m.completedTasks,{decimal:true});
    content+=field('Whole-operation elapsed minutes',prefix+'elapsedMinutes',m.elapsedMinutes,{decimal:true,help:'Record the operation once; overlapping step times are not added.'});
    content+=field('Original case attachments',prefix+'sourceIds',m.sourceIds,{select:sources,multiple:true,wide:true});
    content+=field('Measurement source and method',prefix+'notes',m.notes,{wide:true,area:true});
    content+='</div><h5>Active effort</h5><p>Enter person-minutes: two people working for 30 minutes is 60 person-minutes. Include manual corrections and receiving work. Browser session length, agent runtime and elapsed turnaround do not establish human effort. A blank value remains unknown.</p>';
    content+=m.effort.map((r,i)=>'<fieldset class="task-work-row"><legend>'+esc(r.label||'Work '+(i+1))+'</legend><div class="task-fields">'
      +field('Stable row ID',prefix+'effort.'+i+'.id',r.id)
      +field('Work description',prefix+'effort.'+i+'.label',r.label,{wide:true,required:true})
      +field('Category',prefix+'effort.'+i+'.category',r.category,{select:choice(CATEGORIES)})
      +field('Active person-minutes',prefix+'effort.'+i+'.personMinutes',r.personMinutes,{decimal:true})
      +field('Hourly labour rate ('+document.currency+')',prefix+'effort.'+i+'.hourlyRate',r.hourlyRate,{decimal:true,help:'Use an explicit valuation and record its source; leave blank for an unvalued effort comparison.'})
      +field('Original measurement and rate basis',prefix+'effort.'+i+'.notes',r.notes,{area:true,wide:true})
      +'</div>'+action('Remove work row','remove-row','data-side="'+side+'" data-list="effort" data-index="'+i+'"',!draft())+'</fieldset>').join('');
    content+=action('Add work row','add-row','data-side="'+side+'" data-list="effort"',!draft())+'<h5>Other costs</h5><p>Use '+esc(document.currency)+' throughout. These lines contain costs outside the labour calculation.</p>';
    content+=m.costs.map((r,i)=>'<fieldset class="task-cost-row"><legend>'+esc(r.label||'Cost '+(i+1))+'</legend><div class="task-fields">'
      +field('Stable row ID',prefix+'costs.'+i+'.id',r.id)+field('Cost description',prefix+'costs.'+i+'.label',r.label,{wide:true,required:true})
      +field('Amount ('+document.currency+')',prefix+'costs.'+i+'.amount',r.amount,{decimal:true})
      +field('Original cost basis',prefix+'costs.'+i+'.notes',r.notes,{area:true,wide:true})
      +'</div>'+action('Remove cost row','remove-row','data-side="'+side+'" data-list="costs" data-index="'+i+'"',!draft())+'</fieldset>').join('');
    return content+action('Add cost row','add-row','data-side="'+side+'" data-list="costs"',!draft())+'</section>';
  }
  function reportView(report,afterLabel='Installed'){
    if(!report)return '<p class="task-empty">Review the complete comparison to calculate effort and cost.</p>';
    const metrics=[['Attempted tasks','attemptedTasks'],['Completed tasks','completedTasks'],['Incomplete tasks','incompleteTasks'],
      ['Elapsed minutes','elapsedMinutes'],['Active person-minutes','personMinutes'],['Labour cost','labourCost'],
      ['Other cost','otherCost'],['Total cost','totalCost'],['Person-minutes per completed task','personMinutesPerCompletedTask'],
      ['Cost per completed task','costPerCompletedTask']];
    return '<section class="task-report"><h4>Customer comparison</h4><p>'+esc(report.measurementBasis)+' · '+esc(report.currency)+' · '+esc(report.unit)+'</p>'
      +table(['Measurement','Prior',afterLabel],metrics.map(([name,key])=>[esc(name),esc(shown(report.baseline[key])),esc(shown(report.installed[key]))]))
      +'<p>'+esc(report.basis)+'</p><h5>Differences after scope review</h5>'
      +table(['Measurement','Prior minus '+afterLabel.toLowerCase(),'Percent'],Object.entries(report.savings).map(([key,value])=>[esc(label(key.replace(/([A-Z])/g,' $1'))),esc(shown(value?.difference)),value?.percent==null?'Unknown':esc(value.percent)+'%']))
      +'<h5>Scope changes</h5>'+table(['Field','Prior',afterLabel],report.scopeDifferences.map(row=>[esc(row.field),esc(row.prior),esc(row.installed)]))
      +'<h5>Review items</h5>'+table(['Field','Complete review item'],report.findings.map(row=>[esc(row.path),esc(row.message)]))+'</section>';
  }
  function recurringEditor(document){
    const rows=document.followups||[];
    const editing=draft();
    const unsavedIds=new Set(editing?.unsavedFollowupIds||[]);
    const savedIds=new Set((selected?.edition?.document?.followups||rows.filter(row=>!unsavedIds.has(row.id))).map(row=>row.id));
    let content='<section class="task-recurring"><h4>Recurring customer observations</h4><p>Keep each later complete task against the same original baseline. Record its own source edition, population, period, output and customer response. Earlier observations remain in this case.</p>';
    content+=action('Add recurring observation','add-followup','',!editing||!editable());
    if(!rows.length)return content+'<p>No recurring observations recorded.</p></section>';
    const selectedId=rows.some(row=>row.id===session.selection?.followupId)?session.selection.followupId:rows[0].id;
    content+=table(['Observation','Original observation time','Operator review','Customer response',''],rows.map((r,i)=>[
      esc(r.label),esc(r.method.observedAt||'Unknown'),esc(label(r.status)),esc(label(r.acceptance.status)),
      action(r.id===selectedId?'Selected observation':'Open observation','select-followup','data-id="'+esc(r.id)+'"')
        +(editing&&!savedIds.has(r.id)?action('Remove unsaved observation','remove-followup','data-index="'+i+'"'):'')]));
    rows.forEach((row,i)=>{
      if(row.id!==selectedId)return;
      const path='document.followups.'+i+'.';
      content+='<details open class="task-followup" id="task-followup-'+esc(row.id)+'"><summary>'+esc(row.label)+' · '+esc(label(row.acceptance.status))+'</summary><p>Original observation '+esc(row.id)+'.</p><div class="task-fields">'
        +field('Observation name',path+'label',row.label,{required:true,wide:true})
        +field('Original deployments',path+'deploymentIds',row.deploymentIds,{multiple:true,wide:true,select:currentCase.records.deployments.map(r=>[r.id,r.name||r.id])})
        +field('Original purchase observations',path+'purchaseIds',row.purchaseIds,{multiple:true,wide:true,select:currentCase.records.purchases.map(r=>[r.id,(r.externalRef||r.id)+' · '+r.state])})+'</div>'
        +methods(document,'followups.'+i+'.method','Complete recurring method')
        +'<fieldset class="task-review"><legend>Recurring scope and outcome review</legend><div class="task-fields">'
        +field('Comparability with original baseline',path+'comparison.decision',row.comparison.decision,{select:choice(['UNREVIEWED','COMPARABLE','NOT_COMPARABLE'])})
        +field('Operator review state',path+'status',row.status,{select:choice(['DRAFT','REVIEWED'])})
        +field('Complete scope decision and explanation',path+'comparison.reason',row.comparison.reason,{wide:true,area:true})
        +field('Customer outcome and next work',path+'conclusion',row.conclusion,{wide:true,area:true})
        +'</div></fieldset><fieldset class="task-review"><legend>Actual customer response</legend><div class="task-fields">'
        +field('Response',path+'acceptance.status',row.acceptance.status,{select:choice(['PENDING','ACCEPTED','DECLINED'])})
        +field('Actual receiving reviewer',path+'acceptance.by',row.acceptance.by)
        +field('Original response time',path+'acceptance.at',row.acceptance.at,{help:'Enter the original ISO timestamp with its timezone; keep any original fractional seconds.'})
        +field('Original response and source',path+'acceptance.note',row.acceptance.note,{wide:true,area:true,help:'Reference the actual customer response and attach its source to this observation. An operator review alone is not customer acceptance.'})
        +'</div></fieldset></details>';
    });
    return content+'</section>';
  }
  function recurringReport(report){
    if(!report?.series)return '';
    const series=report.series;
    return '<section class="task-recurring-report"><h4>Recurring outcome overview</h4><p>'+esc(series.basis)+'</p>'
      +table(['Observations','Reviewed','Accepted','Declined','Pending','Accepted comparable observed'],[[
        series.observations,series.reviewed,series.accepted,series.declined,series.pending,series.acceptedComparableObserved].map(esc)])
      +'<p>Observed UTC dates of accepted comparable observations: '+esc(series.observedUtcDates.join(', ')||'None recorded')+'.</p>'
      +table(['Observation','Completed tasks','Active person-minutes','Elapsed minutes','Total cost','Customer response'],report.followups.map(row=>[
        esc(row.label),esc(shown(row.report.installed.completedTasks)),esc(shown(row.report.installed.personMinutes)),
        esc(shown(row.report.installed.elapsedMinutes)),esc(shown(row.report.installed.totalCost)),esc(label(row.acceptance.status))]))
      +report.followups.filter((row,i)=>row.id===session.selection?.followupId||(!report.followups.some(item=>item.id===session.selection?.followupId)&&i===0)).map(row=>'<details open><summary>'+esc(row.label)+' — complete baseline comparison</summary>'
        +'<p>Whole-operation elapsed difference: '+esc(shown(row.elapsedMinutesDifference?.difference))+' minutes. Active effort remains separate.</p>'
        +reportView(row.report,'Recurring')+'</details>').join('')+'</section>';
  }
  function render(){
    if(!available())return;
    const expanded=[...root.querySelectorAll('.task-followup[open]')].map(node=>node.id);
    const editing=draft(),input=editing?.inputs,value=editing?.inputs?.document||selected?.edition?.document;
    const heading='<header class="task-heading"><div><h3>Customer task outcomes</h3><p>Compare the complete prior method and installed task, then retain the customer review with this grant case.</p></div><div class="task-actions">'
      +action('New comparison','new','',!editable())+action('Refresh saved work','refresh')+action('Attach original sources','sources')
      +action('Import draft input','import-input','',!editable())+action('Download editor recovery','recovery')+'</div></header>';
    const savedRows=heads.map(row=>[esc(row.customer)+'<small>'+esc(row.title)+'</small>',esc(row.status),esc(row.revision),esc(row.measurementBasis),
      esc(row.recurring?.observations??0)+' / '+esc(row.recurring?.acceptedComparableObserved??0),
      action('Open','open','data-id="'+esc(row.id)+'" data-revision="'+row.revision+'"')]);
    const drafts=Object.entries(session.drafts).map(([id,row])=>[esc(row.inputs.document.customer||'Customer not entered'),esc(row.inputs.document.title),esc(row.inputs.expectedRevision),
      action('Continue draft','draft','data-id="'+esc(id)+'"')+action('Download draft','draft-download','data-id="'+esc(id)+'"')]);
    let body='<p data-task-notice role="status" aria-live="polite">'+esc(session.notice||'')+'</p><p data-task-storage role="alert">'+esc(storageError)+'</p>';
    if(session.pending)body+='<div class="task-pending"><strong>Original save retained</strong><p>'+esc(session.pending.request.requestId)+' · '+esc(session.pending.request.data.inputs.document.title)+'</p>'+action('Recover original save','recover-save')+'</div>';
    body+='<details'+(!value?' open':'')+'><summary>Saved comparisons and retained drafts</summary><h4>Saved comparisons</h4>'+table(['Customer / task','State','Revision','Measurement basis','Recurring / accepted comparable observed',''],savedRows)
      +'<h4>Unfinished inputs</h4>'+table(['Customer','Task','Based on revision',''],drafts)+'</details>';
    if(value){
      const edition=selected?.edition;
      const history=selected?.history||[];
      body+='<div class="task-selected"><h4>'+esc(editing?'Editable comparison':value.title+' · saved revision '+edition.revision)+'</h4><div class="task-actions">';
      if(editing)body+=action('Review complete comparison','preview','',!editable())+action('Save reviewed edition','save','',!editable())
        +action('Download complete input','draft-download','data-id="'+esc(input.id)+'"')
        +action('Reconcile current case / revision','reconcile','',!editable());
      else body+=action(session.drafts[edition.id]?'Continue retained draft':'Edit this edition','edit','',!editable())
        +action('New comparison from this edition','clone','',!editable())+action('Export complete case and report','export')
        +action('Download original edition JSON','edition-json');
      body+='</div></div>';
      if(!editing&&history.length)body+='<label class="task-history">Original revision<select data-task-history>'+history.map(row=>'<option value="'+row.revision+'"'+(row.revision===edition.revision?' selected':'')+'>Revision '+row.revision+' · '+esc(row.status)+' · '+esc(row.savedAt)+' · '+esc(row.actor)+'</option>').join('')+'</select></label>';
      if(editing&&editing.basedOn!==undefined)body+='<p>Working from saved revision '+esc(editing.basedOn)+'. Next save follows current revision '+esc(input.expectedRevision)+'.</p>';
      const installs=[['','No installation selected'],...(currentCase.installations||[]).map(row=>[row.id+'@'+row.revision,row.name+' · r'+row.revision])];
      const retained=value.installation?value.installation.id+'@'+value.installation.revision:'';
      if(retained&&!installs.some(row=>row[0]===retained))installs.push([retained,'Retained installation '+value.installation.id+' · r'+value.installation.revision]);
      body+='<div class="task-fields">'+field('Comparison name','document.title',value.title,{wide:true,required:true})
        +field('Customer or receiving team','document.customer',value.customer,{wide:true,required:true})
        +field('Complete useful task and acceptance','document.task',value.task,{wide:true,area:true,required:true})
        +field('Completed task unit','document.unit',value.unit,{required:true})
        +field('Currency / asset for every cost','document.currency',value.currency,{required:true})
        +field('Original installation edition','installationSelection',retained,{select:installs,wide:true})
        +field('Original deployments','document.deploymentIds',value.deploymentIds,{multiple:true,select:currentCase.records.deployments.map(r=>[r.id,r.name||r.id]),wide:true})
        +field('Original purchase observations','document.purchaseIds',value.purchaseIds,{multiple:true,select:currentCase.records.purchases.map(r=>[r.id,(r.externalRef||r.id)+' · '+r.state]),wide:true})+'</div>';
      body+=methods(value,'baseline','Prior method')+methods(value,'installed','Installed method');
      body+='<fieldset class="task-review"><legend>Customer review</legend><div class="task-fields">'
        +field('Comparability decision','document.comparison.decision',value.comparison.decision,{select:choice(['UNREVIEWED','COMPARABLE','NOT_COMPARABLE'])})
        +field('Edition state','document.status',value.status,{select:choice(['DRAFT','REVIEWED'])})
        +field('Whole-scope comparison and explanation','document.comparison.reason',value.comparison.reason,{area:true,wide:true,help:'Explain population, period, output, quality and any material differences before using the calculated savings.'})
        +field('Customer outcome and next work','document.conclusion',value.conclusion,{area:true,wide:true})+'</div>';
      if(editing)body+='<label>Save note<textarea data-task-note data-editor="true" rows="3">'+esc(editing.note||'')+'</textarea></label>';
      const calculation=editing?.preview?.report||(!editing?edition.report:null);
      body+='</fieldset>'+recurringEditor(value)+workbookDesk.render()+reportView(calculation)+recurringReport(calculation);
      if(!editing)body+='<details><summary>Complete original case, source and installation selection</summary><pre>'+esc(JSON.stringify(edition.source,null,2))+'</pre></details>';
    }
    if(!value&&session.pendingWorkbook)body+=workbookDesk.render();
    root.innerHTML=heading+body+'<input hidden type="file" data-task-file accept=".json,application/json">';
    root.querySelectorAll('.task-followup').forEach(node=>{if(expanded.includes(node.id))node.open=true;});
    controls();
  }
  async function reload(){
    const next=await api('/api/operations/'+caseId);
    const result=await api('/api/operations/'+caseId+'/task-outcomes');
    if(!available())return;
    currentCase=next;heads=result.comparisons;
    for(const item of Object.values(session.drafts))if(item.preview?.source?.case?.version!==currentCase.program.version)delete item.preview;
    persist();
  }
  async function openSaved(id,revision){
    const found=await api('/api/operations/'+caseId+'/task-outcomes/'+encodeURIComponent(id)+(revision===undefined?'':'?revision='+revision));
    if(!available())return;
    selected=found;session.selection={id,revision:found.edition.revision,mode:'saved'};persist();render();
  }
  async function newDraft(document){
    const seeded=await api('/api/operations/'+caseId+'/task-outcomes-seed',{expectedVersion:currentCase.program.version});
    if(!available())return;
    if(document){seeded.inputs.document=clone(document);seeded.inputs.document.title+=' — new comparison';seeded.inputs.document.status='DRAFT';
      seeded.inputs.document.comparison={decision:'UNREVIEWED',reason:''};
      for(const row of seeded.inputs.document.followups||[]){row.status='DRAFT';row.comparison={decision:'UNREVIEWED',reason:''};row.acceptance={status:'PENDING',by:'',at:null,note:''};row.conclusion='';}}
    session.drafts[seeded.inputs.id]={inputs:seeded.inputs,note:'',unsavedFollowupIds:(seeded.inputs.document.followups||[]).map(row=>row.id)};
    session.selection={id:seeded.inputs.id,mode:'draft'};selected=null;persist();render();
  }
  function editingSelected(){
    const id=selected.edition.id;
    if(!session.drafts[id])session.drafts[id]={inputs:{id,expectedRevision:selected.history[0].revision,
      document:clone(selected.edition.document)},basedOn:selected.edition.revision,note:''};
    session.selection={id,mode:'draft'};persist();render();
  }
  async function preview(){
    if(session.pendingWorkbook)throw Error('Recover the original workbook source request before reviewing or saving.');
    const d=draft();if(!d)throw Error('Open a retained draft first.');
    const original=clone(d.inputs),signature=JSON.stringify(original);
    const value=await api('/api/operations/'+caseId+'/task-outcomes-preview',{expectedVersion:currentCase.program.version,inputs:original});
    if(!available())return;
    if(JSON.stringify(d.inputs)!==signature)throw Error('The draft changed during review. Review the complete current input.');
    d.preview=value;d.previewSignature=signature;persist();render();notify('Complete comparison reviewed. '+value.report.findings.length+' review items remain visible.');
  }
  async function receiveSave(pending){
    try{
      const result=await saveApi('/api/operations/'+caseId+'/command',pending.request);
      const receipt=result.taskOutcomes;if(!receipt)throw Error('The save response has no original comparison receipt; recover this same request.');
      const original=session.drafts[receipt.id];
      if(original&&same(original.inputs,pending.submittedInputs))delete session.drafts[receipt.id];
      session.pending=null;session.receipt=clone(receipt);
      session.selection={id:receipt.id,revision:receipt.revision,mode:'saved'};
      session.notice='Saved customer task comparison revision '+receipt.revision+'.';persist();
      if(!available())return;
      await reload();if(!available())return;
      await openSaved(receipt.id,receipt.revision);
      if(available()&&onCase)await onCase(currentCase,result);
    }catch(error){
      if(terminalRejection(error)&&session.pending===pending){
        session.pending=null;
        const retained=session.drafts[pending.request.data.inputs.id];if(retained){delete retained.preview;delete retained.previewSignature;}
        persist();
      }
      throw error;
    }
  }
  async function save(){
    const d=draft();if(!d?.preview)throw Error('Review the complete input before saving.');
    if(session.pending||session.pendingWorkbook)throw Error('Recover the retained original request before issuing another save.');
    if(d.previewSignature!==JSON.stringify(d.inputs)||d.preview.source.case.version!==currentCase.program.version)throw Error('Review the current draft and case before saving.');
    const payload={expectedVersion:currentCase.program.version,actor:recordingActor(),note:d.note||'',
      action:'task-outcomes.save',data:{inputs:clone(d.preview.inputs),expectedPreviewSha256:d.preview.previewSha256}};
    payload.requestId=await mutationId('task-outcomes:'+caseId,payload);
    const pending={request:payload,submittedInputs:clone(d.inputs)};
    session.pending=pending;persist();render();await receiveSave(pending);
  }
  async function reconcile(){
    const d=draft();if(!d)return;
    await reload();if(!available())return;
    const head=heads.find(row=>row.id===d.inputs.id);
    if(head&&head.revision!==d.inputs.expectedRevision){
      const latest=await api('/api/operations/'+caseId+'/task-outcomes/'+d.inputs.id);
      if(!available())return;
      d.reconciliation={priorRevision:d.inputs.expectedRevision,currentRevision:head.revision,currentDocument:latest.edition.document};
      session.notice='A newer saved revision exists. The complete current edition is shown below your retained input. Choose its explicit revision basis when ready.';
      persist();render();
      const section=document.createElement('section');section.className='task-reconciliation';
      section.innerHTML='<h4>Current saved edition '+head.revision+'</h4><pre>'+esc(JSON.stringify(latest.edition.document,null,2))+'</pre>'
        +action('Use current revision as the save base','use-current','data-id="'+esc(d.inputs.id)+'" data-revision="'+head.revision+'"');
      root.append(section);controls();
    }else{delete d.preview;delete d.previewSignature;persist();render();notify('Current case and comparison revision loaded; your entire draft is retained.');}
  }
  root.addEventListener('input',event=>{
    const d=draft();if(!d||busy||hostBusy||!ready||!editable()||session.pendingWorkbook)return;
    if(event.target.matches('[data-task-note]')){d.note=event.target.value;persist();return;}
    const path=event.target.dataset.taskPath;if(!path)return;
    let value=event.target.multiple?[...event.target.selectedOptions].map(row=>row.value):event.target.value;
    if(path==='installationSelection'){
      if(!value)d.inputs.document.installation=null;
      else{const cut=value.lastIndexOf('@');d.inputs.document.installation={id:value.slice(0,cut),revision:Number(value.slice(cut+1))};}
    }else{
      if(path.endsWith('observedAt')||path.endsWith('acceptance.at')||/(?:personMinutes|hourlyRate|elapsedMinutes|attemptedTasks|completedTasks|amount)$/.test(path))value=value===''?null:value;
      setPath(d.inputs,path,value);
    }
    delete d.preview;delete d.previewSignature;persist();controls();
  });
  root.addEventListener('change',event=>{
    if(event.target.matches('[data-task-history]'))void run(()=>openSaved(selected.edition.id,Number(event.target.value)));
    if(event.target.matches('[data-task-file]')){
      const file=event.target.files?.[0];if(!file)return;
      void run(async()=>{
        if(session.pending||session.pendingWorkbook)throw Error('Recover the original pending request before importing another editor.');
        if(file.size>32*1024*1024)throw Error('Use a complete JSON input or editor recovery up to 32 MiB.');
        let value;try{value=JSON.parse(await file.text());}catch{throw Error('The complete JSON input cannot be read.');}
        if(value.schema===SCHEMA+'.editor'){
          if(value.caseId!==caseId&&value.caseId!==currentCase.program.origin?.programId)throw Error('This recovery belongs to another case.');
          if(value.planContentSha256!==currentCase.plan.contentSha256)throw Error('This recovery belongs to another pinned plan.');
          if(value.pending)throw Error('Recover the original pending save in its original case before transferring this editor recovery.');
          if(value.pendingWorkbook&&value.caseId!==caseId)throw Error('Recover the workbook source request in its original case before transferring this editor.');
          const incoming=await Promise.all(Object.entries(value.drafts||{}).map(async([id,row])=>{
            if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Use the complete retained draft and save note.');
            validateInput(row.inputs);if(id!==row.inputs.id)throw Error('The recovery draft identity differs.');
            if(row.note!==undefined&&typeof row.note!=='string')throw Error('Keep the complete original save note as text.');
            const received={inputs:clone(row.inputs),note:row.note??''};
            if(row.unsavedFollowupIds!==undefined){
              const known=new Set((row.inputs.document.followups||[]).map(item=>item.id));
              if(!Array.isArray(row.unsavedFollowupIds)||row.unsavedFollowupIds.some(id=>typeof id!=='string'||!known.has(id))
                 ||new Set(row.unsavedFollowupIds).size!==row.unsavedFollowupIds.length)
                throw Error('Retain the original unique unsaved observation identities from this complete draft.');
              received.unsavedFollowupIds=[...row.unsavedFollowupIds];
            }else if(row.inputs.expectedRevision===0){
              received.unsavedFollowupIds=(row.inputs.document.followups||[]).map(item=>item.id);
            }
            if(row.basedOn!==undefined){
              if(!Number.isSafeInteger(row.basedOn)||row.basedOn<0||row.basedOn>row.inputs.expectedRevision)
                throw Error('Keep the original saved revision used to begin this draft.');
              received.basedOn=row.basedOn;
            }
            if(row.workbook)received.workbook=await workbookDesk.recoverDraftWorkbook(row.workbook,row.inputs);
            return [id,received];
          }));
          const nextDrafts=clone(session.drafts);receiveDraftRows(nextDrafts,incoming);
          const pendingWorkbook=workbookDesk.recoverPending(value.pendingWorkbook,nextDrafts);
          session.drafts=nextDrafts;session.pendingWorkbook=pendingWorkbook;
          const id=value.selection?.mode==='draft'&&Object.hasOwn(session.drafts,value.selection.id)
            ?value.selection.id:incoming[0]?.[0];
          if(id){
            session.selection={id,mode:'draft'};
            if((session.drafts[id].inputs.document.followups||[]).some(row=>row.id===value.selection?.followupId))
              session.selection.followupId=value.selection.followupId;
          }
        }else{
          const inputs=value.inputs||value;validateInput(inputs);
          if(session.drafts[inputs.id]&&!same(session.drafts[inputs.id].inputs,inputs))throw Error('A different retained draft already uses this identity.');
          if(!Object.hasOwn(session.drafts,inputs.id))session.drafts[inputs.id]={inputs:clone(inputs),note:'',
            ...(inputs.expectedRevision===0?{unsavedFollowupIds:(inputs.document.followups||[]).map(row=>row.id)}:{})};
          session.selection={id:inputs.id,mode:'draft'};
        }
        selected=null;persist();render();notify('Complete draft input received. Review it against the current original case before saving.');
      });
    }
  });
  function validateInput(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||!/^task-outcomes-[a-f0-9]{32}$/.test(value.id)
       ||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0||!value.document||typeof value.document!=='object'
       ||!value.document.baseline||!value.document.installed||!value.document.comparison
       ||!Array.isArray(value.document.baseline.effort)||!Array.isArray(value.document.installed.effort)
       ||!Array.isArray(value.document.baseline.costs)||!Array.isArray(value.document.installed.costs)
       ||!Array.isArray(value.document.deploymentIds)||!Array.isArray(value.document.purchaseIds)
       ||!Array.isArray(value.document.baseline.sourceIds)||!Array.isArray(value.document.installed.sourceIds))
      throw Error('Use the complete original task comparison input object.');
    const doc=value.document;
    if(['title','customer','task','unit','currency','status','conclusion'].some(key=>typeof doc[key]!=='string')
       ||typeof doc.comparison.decision!=='string'||typeof doc.comparison.reason!=='string')
      throw Error('The complete comparison and review fields are required.');
    if(doc.followups!==undefined&&(!Array.isArray(doc.followups)||doc.followups.length>100))
      throw Error('Use the complete recurring observation list, up to 100 observations.');
    const observations=doc.followups||[],ids=new Set();
    for(const row of observations){
      if(!row||typeof row!=='object'||typeof row.id!=='string'||!row.id||ids.has(row.id)
         ||['label','status','conclusion'].some(key=>typeof row[key]!=='string')
         ||!row.comparison||typeof row.comparison.decision!=='string'||typeof row.comparison.reason!=='string'
         ||!row.acceptance||['status','by','note'].some(key=>typeof row.acceptance[key]!=='string')
         ||!(row.acceptance.at===null||typeof row.acceptance.at==='string')
         ||!Array.isArray(row.deploymentIds)||!Array.isArray(row.purchaseIds))
        throw Error('Retain every complete recurring method, stable identity, customer response and original selection.');
      ids.add(row.id);
    }
    for(const method of [doc.baseline,doc.installed,...observations.map(row=>row.method)]){
      if(!method||typeof method!=='object'||!Array.isArray(method.effort)||!Array.isArray(method.costs)||!Array.isArray(method.sourceIds))
        throw Error('Retain the complete original method and its source/work/cost rows.');
      if(['name','basis','sourceReference','population','period','output','quality','notes'].some(key=>typeof method[key]!=='string')
         ||method.effort.length>100||method.costs.length>100
         ||method.effort.some(row=>!row||typeof row!=='object'||['id','label','category','notes'].some(key=>typeof row[key]!=='string'))
         ||method.costs.some(row=>!row||typeof row!=='object'||['id','label','notes'].some(key=>typeof row[key]!=='string')))
        throw Error('The complete method, work rows and cost rows are required.');
    }
  }
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-task-action]');if(!target||target.disabled)return;
    const actionName=target.dataset.taskAction;
    if(actionName==='import-input'){if(!busy&&!hostBusy&&ready)$('[data-task-file]').click();return;}
    void run(async()=>{
      if(actionName==='new'){await newDraft();return;}
      if(actionName==='refresh'){await reload();if(session.selection?.mode==='saved')await openSaved(session.selection.id,session.selection.revision);else render();return;}
      if(actionName==='sources'){persist();onSources?.();return;}
      if(actionName==='open'){await openSaved(target.dataset.id,Number(target.dataset.revision));return;}
      if(actionName==='draft'){session.selection={id:target.dataset.id,mode:'draft'};persist();render();return;}
      if(actionName==='edit'){editingSelected();return;}
      if(actionName==='clone'){await newDraft(selected.edition.document);return;}
      if(actionName==='preview'){await preview();return;}
      if(actionName==='save'){await save();return;}
      if(actionName==='recover-save'){if(session.pending)await receiveSave(session.pending);return;}
      if(actionName==='reconcile'){await reconcile();return;}
      if(actionName==='use-current'){
        const d=session.drafts[target.dataset.id];if(!d||!d.reconciliation||d.reconciliation.currentRevision!==Number(target.dataset.revision))throw Error('Reopen the current saved edition first.');
        const savedObservations=new Set((d.reconciliation.currentDocument.followups||[]).map(row=>row.id));
        d.unsavedFollowupIds=(d.unsavedFollowupIds||[]).filter(id=>!savedObservations.has(id));
        d.inputs.expectedRevision=d.reconciliation.currentRevision;delete d.reconciliation;delete d.preview;delete d.previewSignature;
        persist();render();notify('Your complete draft now follows the reviewed current revision. Review the comparison again before saving.');return;
      }
      if(actionName==='recovery'){
        download(JSON.stringify({schema:SCHEMA+'.editor',caseId,planContentSha256:currentCase.plan.contentSha256,drafts:session.drafts,
          selection:session.selection,pending:session.pending??null,pendingWorkbook:session.pendingWorkbook??null,receipt:session.receipt??null,notice:session.notice??''},null,2)+'\n',caseId+'-task-outcomes-editor.json');return;
      }
      if(actionName==='draft-download'){
        const d=session.drafts[target.dataset.id];if(!d)throw Error('The complete draft is unavailable.');
        download(JSON.stringify(d.inputs,null,2)+'\n',d.inputs.id+'-inputs.json');return;
      }
      if(actionName==='edition-json'){
        download(JSON.stringify(selected.edition,null,2)+'\n',selected.edition.id+'-r'+selected.edition.revision+'.json');return;
      }
      if(actionName==='export'){
        const edition=selected.edition;
        const response=await api('/api/operations/'+caseId+'/task-outcomes/'+edition.id+'/export.zip?revision='+edition.revision+'&expectedVersion='+currentCase.program.version,undefined,{download:true});
        if(!available())return;
        download(await response.blob(),edition.id+'-r'+edition.revision+'.zip','application/zip');return;
      }
      if(actionName==='select-followup'){
        const value=draft()?.inputs.document||selected?.edition?.document;
        if(!value?.followups?.some(row=>row.id===target.dataset.id))throw Error('Select a retained recurring observation.');
        session.selection.followupId=target.dataset.id;persist();render();return;
      }
      if(actionName==='add-followup'||actionName==='remove-followup'){
        const d=draft();if(!d||!editable())return;
        if(actionName==='add-followup'){
          d.inputs.document.followups ||= [];
          if(d.inputs.document.followups.length>=100)throw Error('This comparison already retains 100 recurring observations.');
          const id=uuid('observation-');
          d.inputs.document.followups.push({id,label:'Recurring observation '+(d.inputs.document.followups.length+1),
            method:{name:d.inputs.document.installed.name,basis:'UNRECORDED',observedAt:null,sourceReference:'',
              population:'',period:'',output:'',quality:'',attemptedTasks:null,completedTasks:null,elapsedMinutes:null,
              sourceIds:[],notes:'',effort:[],costs:[]},comparison:{decision:'UNREVIEWED',reason:''},
            status:'DRAFT',conclusion:'',acceptance:{status:'PENDING',by:'',at:null,note:''},deploymentIds:[],purchaseIds:[]});
          d.unsavedFollowupIds ||= [];d.unsavedFollowupIds.push(id);session.selection.followupId=id;
        }else{
          const index=Number(target.dataset.index),row=d.inputs.document.followups?.[index];
          if(!row||!d.unsavedFollowupIds?.includes(row.id))throw Error('Retain saved observations and correct them in the next complete edition.');
          d.inputs.document.followups.splice(index,1);d.unsavedFollowupIds=d.unsavedFollowupIds.filter(id=>id!==row.id);
        }
        delete d.preview;delete d.previewSignature;persist();render();
        if(actionName==='add-followup'){
          const last=root.querySelector('.task-followup:last-of-type');if(last){last.open=true;last.scrollIntoView?.({block:'start'});}
        }
        return;
      }
      if(actionName==='add-row'||actionName==='remove-row'){
        const d=draft();if(!d||!editable())return;
        const list=pathValue(d.inputs.document,target.dataset.side)?.[target.dataset.list];if(!Array.isArray(list))return;
        if(actionName==='remove-row')list.splice(Number(target.dataset.index),1);
        else{
          if(list.length>=100)throw Error('The complete method already contains 100 rows in this section.');
          list.push(target.dataset.list==='effort'?{id:uuid('work-'),label:'Work',category:'OTHER',personMinutes:null,hourlyRate:null,notes:''}:
            {id:uuid('cost-'),label:'Other cost',amount:null,notes:''});
        }
        delete d.preview;delete d.previewSignature;persist();render();return;
      }
    });
  });
  const pagehide=()=>persist();window.addEventListener('pagehide',pagehide);
  render();
  const initial=(async()=>{
    try{
      await reload();if(!available())return;
      if(session.requestOpen){session.selection={id:session.requestOpen.id,revision:session.requestOpen.revision,mode:'saved'};delete session.requestOpen;}
      if(session.selection?.mode==='saved')await openSaved(session.selection.id,session.selection.revision);
      else render();
    }catch(error){notify(error.message||String(error),true);}
    finally{ready=true;if(available())controls();}
  })();
  return {ready:initial,setHostBusy,dispose(){persist();workbookDesk.dispose();active=false;window.removeEventListener('pagehide',pagehide);}};
}
