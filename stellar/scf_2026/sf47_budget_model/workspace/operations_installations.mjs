// Complete customer installations in the original SF47 operating case.
import { workflowBoundCheck, workflowReportView, workflowIntakePanel } from './operations_installation_workflows.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>structuredClone(value);
const title=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const optional=list=>[['','Unentered'],...list];
const choices=(...values)=>values.map(value=>[value,title(value)]);
const button=(text,action,attrs='',disabled=false)=>'<button type="button" data-installation-action="'+action+'" '+attrs+(disabled?' disabled data-installation-fixed="true"':'')+'>'+esc(text)+'</button>';
const table=(heads,rows)=>'<div class="installation-table"><table><thead><tr>'+heads.map(value=>'<th scope="col">'+esc(value)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const empty=text=>'<p class="installation-empty">'+esc(text)+'</p>';
const note=text=>'<p class="installation-note">'+esc(text)+'</p>';
const format=value=>Array.isArray(value)?value.join(', '):value===null||value===undefined||value===''?'Unentered':String(value);
const definite=error=>[400,401,403,404,409,413,422].includes(error?.status)&&typeof error?.code==='string';
function saveDownload(blob,name){
  const url=URL.createObjectURL(blob instanceof Blob?blob:new Blob([blob],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function field(label,path,value='',options={}){
  const attrs=' data-installation-field="'+esc(path)+'"'+(options.required?' required':'');
  let input;
  if(options.choices)input='<select'+attrs+(options.multiple?' multiple size="4"':'')+'>'+options.choices.map(([id,name])=>'<option value="'+esc(id)+'"'+((options.multiple?(value||[]).includes(id):String(value??'')===String(id))?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select>';
  else if(options.boolean)input='<input type="checkbox"'+attrs+(value?' checked':'')+'>';
  else if(options.area)input='<textarea'+attrs+' rows="'+(options.rows||3)+'" maxlength="'+(options.max||8000)+'">'+esc(value)+'</textarea>';
  else input='<input'+attrs+' type="'+(options.type||'text')+'" value="'+esc(value)+'" maxlength="'+(options.max||4000)+'"'+(options.type==='number'?' min="0" step="1"':'')+'>';
  return '<label class="'+(options.wide?'installation-wide':'')+(options.boolean?' installation-checkbox':'')+'"><span>'+esc(label)+'</span>'+input+(options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
}
function assign(object,path,value){
  const bits=path.split('.');let current=object;
  for(const bit of bits.slice(0,-1))current=current[bit];
  current[bits.at(-1)]=value;
}

export function mountInstallations({container,current,api,saveApi,session,mutationId,recordingActor,onCase,onSources}){
  const root=document.createElement('section');root.className='installation-desk';
  root.setAttribute('aria-label','Customer installations');container.replaceChildren(root);
  if(!document.querySelector('link[data-installation-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_installations.css';
    link.dataset.installationStyle='true';document.head.append(link);
  }
  const caseId=current.program.id,prefix='/api/operations/'+caseId,storageKey='sf47.installations.'+caseId;
  if(!session.initialized){
    let stored;
    try{stored=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
    if(stored?.schema==='sf47.installation-editor.v1'&&stored.caseId===caseId){
      for(const key of ['drafts','draftKey','selected','mode','pending','accepted','notice','workflowIntake'])if(Object.hasOwn(stored,key))session[key]=stored[key];
    }
    session.initialized=true;
  }
  for(const [key,value] of Object.entries({drafts:{},draftKey:null,selected:null,mode:'saved',pending:null,accepted:null,
    inflight:null,notice:'',error:'',filter:'',workflowIntake:{open:false,sourceId:'',target:'new',cycleIds:[]}}))if(!Object.hasOwn(session,key))session[key]=value;
  let active=true,hostBusy=false,busy=false,generation=0,caseValue=current,selectedRow=null,historyRows=[],nextBefore=null;
  let preview=null,previewDraft=null,loading=false,workflowInventory=null;
  const $=selector=>root.querySelector(selector),available=()=>active&&root.isConnected;
  const draft=()=>session.draftKey?session.drafts[session.draftKey]:null;
  const editable=()=>caseValue.program.state==='OPEN'&&!hostBusy;
  const own=epoch=>available()&&epoch===generation;
  const list=()=>caseValue.installations||[];
  const sourceOptions=()=>caseValue.sources.map(row=>[row.id,row.filename+' · '+row.sha256.slice(0,10)]);
  const recordOptions=kind=>(caseValue.records[kind]||[]).map(row=>[row.id,(row.name||row.description||row.number||row.operationId||row.id)+' · '+title(row.state)]);
  const deployments=roles=>caseValue.records.deployments.filter(row=>roles.includes(row.role)).map(row=>[row.id,row.name+' · '+row.operator]);
  function persist(){
    const body={schema:'sf47.installation-editor.v1',caseId};
    for(const key of ['drafts','draftKey','selected','mode','pending','accepted','notice','workflowIntake'])body[key]=session[key];
    try{sessionStorage.setItem(storageKey,JSON.stringify(body));}
    catch{session.storageNotice='The browser could not retain another local draft copy. Download the complete draft before closing this browser.';}
  }
  function failure(error){session.error=error?.message||String(error);if(available())render();}
  function controls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(hostBusy||busy||!!session.inflight));
    for(const el of root.querySelectorAll('button,input,select,textarea')){
      const isInput=el.matches('[data-installation-field],[data-installation-note]');
      const save=el.dataset.installationAction==='save';
      el.disabled=el.dataset.installationFixed==='true'||hostBusy||
        (save&&(!preview||!same(previewDraft?.document,draft()?.document)||previewDraft?.expectedRevision!==draft()?.expectedRevision))||
        (isInput?!editable():(busy||!!session.inflight));
    }
  }
  async function run(fn){
    if(!available()||hostBusy||busy||session.inflight)return;
    busy=true;session.error='';controls();
    try{return await fn();}catch(error){failure(error);}finally{busy=false;if(available())render();}
  }
  function capture(){
    const value=draft();if(!value||session.mode!=='edit'||!$('[data-installation-editor]'))return;
    for(const input of root.querySelectorAll('[data-installation-field]')){
      const path=input.dataset.installationField;
      let selected=input.multiple?[...input.selectedOptions].map(row=>row.value):input.type==='checkbox'?input.checked:input.value;
      if(path==='payment.taskUnits'||/^checks\.\d+\.tranche$/.test(path))selected=selected===''?null:Number(selected);
      else if(path==='merchantDeploymentId'||path==='workorder.sourceId'||/\.observedAt$/.test(path)||path==='payment.priceAtomic'||path==='payment.taskBudgetAtomic')selected=selected===''?null:selected;
      assign(value.document,path,selected);
    }
    value.note=$('[data-installation-note]')?.value??value.note;
    value.dirty=true;
    if(previewDraft&&!same(previewDraft.document,value.document))preview=null;
    persist();
  }
  function heading(label,description,actions=''){
    return '<div class="installation-heading"><div><h3>'+esc(label)+'</h3><p>'+esc(description)+'</p></div><div class="installation-actions">'+actions+'</div></div>';
  }
  function group(title,content){return '<fieldset><legend>'+esc(title)+'</legend><div class="installation-fields">'+content+'</div></fieldset>';}
  function draftFields(value){
    const d=value.document,f=(label,path,options={})=>field(label,path,path.split('.').reduce((v,key)=>v[key],d),options);
    const sources=(label,path)=>f(label,path,{choices:sourceOptions(),multiple:true,wide:true});
    const boundCheck=check=>workflowBoundCheck(d,check);
    let html=group('Installation and original commissioning',
      f('Installation name','name',{required:true,wide:true,max:300})+
      f('Operating stage','stage',{choices:choices('PLANNED','COMMISSIONING','OPERATING','HANDED_OVER','RETIRED')})+
      f('Merchant deployment','merchantDeploymentId',{choices:optional(deployments(['MERCHANT','BOTH']))})+
      f('Receiving buyer deployments','buyerDeploymentIds',{choices:deployments(['BUYER','BOTH']),multiple:true,wide:true})+
      f('Complete original workorder file','workorder.sourceId',{choices:optional(sourceOptions()),wide:true})+
      f('Workorder reference','workorder.reference')+f('Commissioning payer','workorder.payer')+
      f('Whole implementation assignment','workorder.scope',{area:true,wide:true})+
      f('Original commercial terms','workorder.terms',{area:true,wide:true}));
    html+=group('Useful customer task',
      f('Task name','task.name')+f('Customer purpose','task.purpose',{area:true})+
      f('Complete original request','task.request',{area:true,wide:true,rows:4})+
      f('What finishes the whole task','task.completeOutput',{area:true,wide:true})+
      f('What makes a later result useful','task.repeatTrigger',{area:true})+
      f('Merchant priced unit','task.pricedUnit',{area:true}));
    html+=group('Source meaning and operating authority',
      f('Source behavior','source.mode',{choices:choices('UNSELECTED','SNAPSHOT','LIVE','MIXED')})+
      f('Original edition or live-operation reference','source.reference')+
      sources('Selected original source files','source.sourceIds')+
      f('Complete source population','source.population',{area:true,wide:true})+
      f('Keys, types, units and time meaning','source.meaning',{area:true,wide:true})+
      f('Source rights and authority','source.authority',{area:true,wide:true})+
      f('Source change and withdrawal','source.changePolicy',{area:true,wide:true}));
    html+=group('Original payment selection and whole-task budget',
      f('Network','payment.network')+f('Asset','payment.asset')+
      f('Recipient','payment.recipient',{wide:true})+
      f('Unit price in original atomic units','payment.priceAtomic',{help:'Exact decimal whole number. Keep the original payment asset.'})+
      f('Expected number of priced units','payment.taskUnits',{type:'number'})+
      f('Aggregate task budget in original atomic units','payment.taskBudgetAtomic',{wide:true})+
      f('Buyer approval and spending authority','payment.authority',{area:true,wide:true})+
      sources('Original payment terms files','payment.termsSourceIds'));
    html+='<fieldset><legend>Selected facilitator operators</legend><p>Each selection keeps the operator identity, endpoint and original selection source.</p>'+
      d.payment.facilitators.map((provider,index)=>'<div class="installation-entry"><h4>Facilitator '+(index+1)+'</h4><div class="installation-fields">'+
        f('Operator identity','payment.facilitators.'+index+'.operatorId',{required:true})+
        f('Original endpoint','payment.facilitators.'+index+'.endpoint',{type:'url',required:true})+
        sources('Facilitator source files','payment.facilitators.'+index+'.sourceIds')+
        f('Selection basis','payment.facilitators.'+index+'.note',{area:true,wide:true})+
        '</div>'+button('Remove facilitator selection','remove-facilitator','data-index="'+index+'"',!editable())+'</div>').join('')+
      button('Add facilitator selection','add-facilitator','',!editable()||d.payment.facilitators.length>=10)+'</fieldset>';
    html+=group('Receiving, independent operation and maintenance',
      f('Receiving application and version','receiving.application')+
      f('Authorized receiving host','receiving.host')+
      f('Receiving operator','receiving.operator',{wide:true})+
      f('Useful output acceptance','receiving.acceptanceRule',{area:true,wide:true})+
      f('Second operator: change or withdraw source and terms','receiving.changeAndWithdraw',{area:true,wide:true})+
      f('Original recovery procedure','receiving.recovery',{area:true,wide:true})+
      f('Maintainer, support destination and ownership','receiving.maintenance',{area:true,wide:true})+
      sources('Receiving and maintenance source files','receiving.sourceIds'));
    html+=group('Original funded and commercial work assignment',
      f('Original funded work packages','assignments.costIds',{choices:caseValue.plan.scenario.future_costs.map(row=>[row.id,row.id+' · tranche '+row.tranche]),multiple:true,wide:true})+
      f('Separate commercial workorder reference','assignments.commercialRef',{wide:true})+
      f('Actual effort and funding allocation','assignments.note',{area:true,wide:true,help:'Select original work once. Its recorded hours and funding basis stay attached to their original records.'}));
    html+='<fieldset><legend>Installation acceptance and corrections</legend><p>The initial criteria come from the selected funding plan. Record the actual observation and select its original work, purchase, result or file.</p>'+
      d.checks.map((check,index)=>'<details class="installation-entry"'+(index===0?' open':'')+'><summary>'+esc(check.title||'Acceptance step '+(index+1))+' · '+esc(title(check.state))+'</summary><div class="installation-fields">'+
        f('Retained step identity','checks.'+index+'.id',{required:true,max:80})+
        f('Step title','checks.'+index+'.title',{required:true,max:500})+
        f('Original acceptance criterion','checks.'+index+'.criterion',{area:true,wide:true})+
        f('Tranche','checks.'+index+'.tranche',{choices:[['','Unassigned'],['1','1'],['2','2'],['3','3']]})+
        f('Required for this installation','checks.'+index+'.required',{boolean:true})+
        f('Current acceptance state','checks.'+index+'.state',{choices:choices('OPEN','IN_PROGRESS','ACCEPTED','CHANGES_REQUIRED','NOT_APPLICABLE')})+
        f('Accountable observing operator','checks.'+index+'.operator')+
        f('Actual observed time','checks.'+index+'.observedAt',{help:'Original ISO timestamp with timezone, for example 2026-10-12T10:00:00Z.'})+
        f('Observed result and correction','checks.'+index+'.note',{area:true,wide:true})+
        sources('Original observation files','checks.'+index+'.sourceIds')+
        f('Original work records','checks.'+index+'.workIds',{choices:recordOptions('work'),multiple:true,wide:true})+
        f('Original purchase observations','checks.'+index+'.purchaseIds',{choices:recordOptions('purchases'),multiple:true,wide:true})+
        f('Original delivery outcomes','checks.'+index+'.outcomeIds',{choices:recordOptions('outcomes'),multiple:true,wide:true})+
        '</div>'+button('Remove acceptance step','remove-check','data-index="'+index+'"',!editable()||boundCheck(check))+'</details>').join('')+
      button('Add acceptance step','add-check','',!editable()||d.checks.length>=100)+'</fieldset>';
    return html;
  }
  function reportView(value){
    const report=value.report;
    return '<div class="installation-stats"><div><span>Configuration decisions</span><strong>'+
      (report.configurationComplete?'Complete':report.findings.filter(row=>row.kind!=='ACCEPTANCE').length+' open')+
      '</strong></div><div><span>Accepted steps</span><strong>'+report.acceptedChecks+' / '+report.totalChecks+
      '</strong></div><div><span>Selected source files</span><strong>'+report.sourceFiles+
      '</strong></div><div><span>Entered task amount</span><strong>'+esc(report.pricedTaskAtomic??'Unentered')+'</strong><small>Original atomic units</small></div></div>'+
      (report.findings.length?table(['Field or step','Current decision or observation'],report.findings.map(row=>[esc(row.field),esc(row.message)])):note('All entered configuration decisions and required acceptance steps are complete.'))+
      workflowReportView(value)+
      '<h4>Original work and funded packages</h4>'+
      table(['Funding basis','Work package','Recorded hours','Accepted hours'],report.work.map(row=>[esc(row.fundingBasis),esc(row.costId||'Unassigned'),esc(row.recordedHours),esc(row.acceptedHours)]))+
      table(['Package','Tranche','Original planned hours','Original planned USD'],report.packages.map(row=>[esc(row.id),esc(row.tranche),esc(row.estimated_hours),esc(row.amount_usd)]))+
      '<h4>Selected original purchase amounts</h4>'+
      (report.purchaseAmounts.length?table(['Network / asset','Original purchases','Settled atomic amount','Reported fees / unknown fees'],
        report.purchaseAmounts.map(row=>[esc(row.network)+'<br>'+esc(row.asset),esc(row.purchases),esc(row.settledAtomic),esc(row.reportedFeesAtomic)+' / '+row.unknownFees])):empty('Select the original purchase observations in an acceptance step.'))+
      (value.changes?.length?'<h4>Changes from the preceding edition</h4>'+table(['Field','Before','This edition'],value.changes.map(row=>[esc(row.field),'<pre>'+esc(typeof row.before==='object'?JSON.stringify(row.before,null,2):row.before)+'</pre>','<pre>'+esc(typeof row.after==='object'?JSON.stringify(row.after,null,2):row.after)+'</pre>'])):'');
  }
  function savedView(row){
    const d=row.preview.document;
    const pairs=(value,labels)=>table(['Field','Saved selection'],labels.map(([key,label])=>[esc(label),esc(format(value[key]))]));
    return heading(d.name,'Saved edition '+row.revision+' · '+title(d.stage)+' · '+row.createdAt+' · '+row.actor,
      button('Use this edition as a draft','edit','',!editable()||!!session.pending||!!session.accepted)+
      button('Export complete handover','export','')+button('Download saved input','saved-input'))+
      note(row.note)+(row.current?.selectedRecordsChanged?note('The operating case has later selected-record changes. This edition keeps the original observations; use it as a draft to review the current records.'):'')+
      reportView(row.preview)+
      '<h4>Original commissioning and useful task</h4>'+
      pairs(d.workorder,[['sourceId','Complete original file'],['reference','Workorder reference'],['payer','Commissioning payer'],['scope','Implementation assignment'],['terms','Original commercial terms']])+
      pairs(d.task,[['name','Task name'],['purpose','Customer purpose'],['request','Complete request'],['completeOutput','Whole task completion'],['repeatTrigger','Reason to repeat'],['pricedUnit','Priced unit']])+
      '<h4>Source meaning and authority</h4>'+
      pairs(d.source,[['reference','Original edition or operation'],['mode','Source behavior'],['population','Complete population'],['meaning','Keys / types / units / time'],['authority','Source rights and authority'],['changePolicy','Change and withdrawal'],['sourceIds','Selected files']])+
      '<h4>Payment and receiving selection</h4>'+
      pairs(d.payment,[['network','Network'],['asset','Asset'],['recipient','Recipient'],['priceAtomic','Unit price in atomic units'],['taskUnits','Priced units'],['taskBudgetAtomic','Whole task budget in atomic units'],['authority','Buyer spending authority'],['termsSourceIds','Original terms files']])+
      (d.payment.facilitators.length?table(['Facilitator operator','Endpoint','Original selection basis'],d.payment.facilitators.map(row=>[esc(row.operatorId),esc(row.endpoint),esc(row.note)])):'')+
      pairs(d.receiving,[['application','Receiving application'],['host','Authorized host'],['operator','Receiving operator'],['acceptanceRule','Useful output acceptance'],['changeAndWithdraw','Second operator change or withdrawal'],['recovery','Recovery'],['maintenance','Maintainer and support']])+
      '<h4>Acceptance and corrections</h4>'+
      table(['Step and original criterion','State','Actual operator / time','Observed result'],
        d.checks.map(row=>[esc(row.title)+'<p>'+esc(row.criterion)+'</p>',esc(title(row.state)),esc(row.operator)+'<br>'+esc(row.observedAt),esc(row.note)]))+
      '<h4>Complete selected original files</h4>'+
      table(['Filename','Bytes','Original SHA-256',''],Object.values(row.preview.snapshot.sources).map(source=>[
        esc(source.filename),esc(source.bytes),'<code>'+esc(source.sha256)+'</code>',
        button('Download original file','source','data-source="'+source.id+'"')]))+
      '<details><summary>Complete saved input and original selected records</summary><pre>'+
      esc(JSON.stringify({document:d,records:row.preview.snapshot.records},null,2))+'</pre></details>'+
      '<h4>Saved edition history</h4>'+
      table(['Edition','Saved by / time','Stage / accepted steps',''],historyRows.map(item=>[
        esc(item.revision),esc(item.actor)+'<br>'+esc(item.createdAt),esc(title(item.stage))+' · '+item.acceptedChecks+' / '+item.totalChecks,
        button(item.revision===row.revision?'Selected':'Open edition','edition','data-revision="'+item.revision+'"',item.revision===row.revision)]))+
      (nextBefore!==null?button('Earlier editions','more-history'):'');
  }
  function render(){
    if(!available())return;
    const currentDraft=draft();
    const visible=list().filter(row=>(row.name+' '+row.stage+' '+row.id).toLowerCase().includes(session.filter.toLowerCase()));
    const draftKeys=Object.keys(session.drafts);
    root.innerHTML=heading('Customer installations','Keep the whole task, source, terms, receiving application and original funded work together.',
      button('New installation','new','',!editable()||!!session.pending||!!session.accepted)+
      button('Receive customer periods','workflow-open','',!editable()||!!session.pending||!!session.accepted))+
      '<p class="installation-message" role="'+(session.error?'alert':'status')+'" aria-live="polite">'+esc(session.error||session.notice)+'</p>'+
      (session.storageNotice?note(session.storageNotice):'')+workflowPanel()+
      (session.pending?'<div class="installation-recovery"><h4>Original save request retained</h4><p>Recover this exact request before saving another edition. Your later form edits stay in their draft.</p>'+button('Recover original save','recover')+'<code>'+esc(session.pending.body.requestId)+'</code></div>':'')+
      (session.accepted?'<div class="installation-recovery"><h4>Edition saved; readback is pending</h4>'+button('Open saved result','readback')+'</div>':'')+
      '<div class="installation-layout"><aside><label>Find installation<input type="search" data-installation-filter value="'+esc(session.filter)+'"></label>'+
      '<div class="installation-list">'+visible.map(row=>'<button type="button" data-installation-action="open" data-id="'+row.id+'"'+
        (session.selected?.id===row.id&&session.mode==='saved'?' aria-current="page"':'')+'><strong>'+esc(row.name)+'</strong><span>Edition '+row.revision+' · '+esc(title(row.stage))+
        '</span><small>'+row.acceptedChecks+' / '+row.totalChecks+' acceptance steps</small></button>').join('')+'</div>'+
      (visible.length?'':empty('No saved installation matches.'))+
      (draftKeys.length?'<h4>Retained drafts</h4>'+draftKeys.map(key=>button(session.drafts[key].label||session.drafts[key].document.name||'Untitled draft','draft','data-key="'+esc(key)+'"')).join(''):'')+
      '</aside><div class="installation-content">'+
      (loading?empty('Opening the selected saved edition…'):session.mode==='edit'&&currentDraft?
        heading(currentDraft.installationId?'Edit installation':'Prepare installation','The next save creates a new immutable edition. Current case version '+caseValue.program.version+'.',
          button('Download full draft','draft-download')+button('Load input file','draft-import','',!editable()))+
        '<form data-installation-editor>'+draftFields(currentDraft)+
        '<label class="installation-reason">Reason for this saved edition<textarea data-installation-note required rows="3" maxlength="12000">'+esc(currentDraft.note)+'</textarea></label>'+
        '<div class="installation-actions installation-save">'+button('Review complete installation','preview','',!editable()||!!session.pending||!!session.accepted)+
        button('Save reviewed edition','save','',!editable()||!!session.pending||!!session.accepted||!preview||!same(previewDraft?.document,currentDraft.document))+
        (currentDraft.installationId?button('Open current saved edition','current','data-id="'+currentDraft.installationId+'"'):'')+'</div></form>'+
        (preview?'<section class="installation-preview"><h3>Reviewed installation</h3>'+reportView(preview)+'</section>':note('Review the complete entered installation to calculate original work and task amounts before saving.')):
        selectedRow?savedView(selectedRow):empty('Open a saved installation or prepare a new one from this case.'))+
      '</div></div><input type="file" data-installation-file hidden accept=".json,application/json">';
    controls();
  }
  async function reloadCase(){
    const next=await saveApi(prefix);
    if(next.program.id!==caseId)throw new Error('The original installation case changed identity.');
    caseValue=next;
    return next;
  }
  async function openEdition(id,revision){
    capture();const epoch=++generation;
    session.selected={id,revision:revision??null};session.mode='saved';session.draftKey=null;
    selectedRow=null;historyRows=[];nextBefore=null;preview=null;previewDraft=null;loading=true;persist();render();
    try{
      const row=await api(prefix+'/installations/'+id+(revision===undefined?'':'?revision='+revision));
      if(!own(epoch))return;
      if(row.id!==id||(revision!==undefined&&row.revision!==revision))throw new Error('The returned installation edition changed selection.');
      selectedRow=row;session.selected={id,revision:row.revision};persist();loading=false;render();
      const history=await api(prefix+'/installations/'+id+'/history');
      if(!own(epoch))return;
      historyRows=history.editions;nextBefore=history.nextBefore;
    }finally{if(own(epoch)){loading=false;render();}}
  }
  function workflowSelection(value=session.workflowIntake){
    const source=caseValue.sources.find(row=>row.id===value.sourceId);
    if(!source)throw new Error('Select the complete original recurring-work source from this case’s Sources.');
    return {sourceId:source.id,expectedSourceSha256:source.sha256};
  }
  function workflowPanel(){
    const targets=[['new','Create a new installation']];
    if(session.mode==='edit'&&draft())targets.push(['draft','Update the complete open draft']);
    if(session.mode==='saved'&&selectedRow)targets.push(['saved','Prepare the selected installation’s next edition']);
    if(!targets.some(([key])=>key===session.workflowIntake.target))session.workflowIntake.target='new';
    return workflowIntakePanel({state:session.workflowIntake,inventory:workflowInventory,sources:sourceOptions(),
      targets,button,editable:editable(),pending:!!session.pending||!!session.accepted,onSources:!!onSources});
  }
  function openWorkflow(){
    capture();const binding=(session.mode==='edit'?draft()?.document:selectedRow?.preview.document)?.workflowPeriods;
    const value=session.workflowIntake;
    if(binding){
      value.sourceId=binding.sourceId;value.cycleIds=binding.periods.map(row=>row.cycleId);
      value.target=session.mode==='edit'?'draft':'saved';
    }
    value.open=true;workflowInventory=null;persist();
  }
  async function readWorkflows(){
    capture();const epoch=++generation,value=copy(session.workflowIntake);
    await reloadCase();if(!own(epoch))return;
    const selection=workflowSelection(value);
    const result=await api(prefix+'/installation-workflows',{expectedVersion:caseValue.program.version,...selection});
    if(!own(epoch)||session.workflowIntake.sourceId!==value.sourceId)return;
    if(result.source?.caseId!==caseId||!same(result.selection,selection)||!Array.isArray(result.periods))
      throw new Error('Reopen the exact complete recurring-work source.');
    workflowInventory=result;
    session.workflowIntake.cycleIds=session.workflowIntake.cycleIds.filter(id=>result.periods.some(row=>row.cycleId===id));
    if(!session.workflowIntake.cycleIds.length&&result.periods.length===1)
      session.workflowIntake.cycleIds=[result.periods[0].cycleId];
    session.notice='Read '+result.periods.length+' complete original customer periods from '+result.profile.name+'.';
    persist();
  }
  async function prepareWorkflow(){
    capture();
    const value=copy(session.workflowIntake),inventory=workflowInventory;
    const cycleIds=(inventory?.periods??[]).filter(row=>value.cycleIds.includes(row.cycleId)).map(row=>row.cycleId);
    if(!inventory||!cycleIds.length)throw new Error('Read and select the original customer periods first.');
    const originalDraft=value.target==='draft'?copy(draft()):null;
    const originalSaved=value.target==='saved'?selectedRow:null;
    if(value.target==='draft'&&!originalDraft||value.target==='saved'&&!originalSaved)
      throw new Error('Reopen the complete Installation destination.');
    const epoch=++generation,selection=copy(inventory.selection);
    await reloadCase();if(!own(epoch))return;
    if(!same(workflowSelection(value),selection))throw new Error('Read the selected original recurring source again.');
    const installationId=originalDraft?.installationId??originalSaved?.id??null;
    const expectedRevision=originalDraft?.expectedRevision??
      (originalSaved?list().find(row=>row.id===originalSaved.id)?.revision:0);
    if(expectedRevision===undefined)throw new Error('Reopen the current saved Installation edition.');
    const document=originalDraft?.document??originalSaved?.preview.document;
    const result=await api(prefix+'/installation-workflow-seed',{expectedVersion:caseValue.program.version,
      ...selection,cycleIds,installationId,expectedRevision,...(document?{document}:{})});
    if(!own(epoch))return;
    const binding=result.document?.workflowPeriods;
    if(result.source?.caseId!==caseId||result.installationId!==installationId||result.expectedRevision!==expectedRevision||
      binding?.sourceId!==selection.sourceId||binding?.sourceSha256!==selection.expectedSourceSha256||
      binding?.profileId!==inventory.profile.id||!cycleIds.every(id=>binding.periods.some(row=>row.cycleId===id)))
      throw new Error('Reopen the original customer source and selected Installation.');
    capture();
    const live=originalDraft?session.drafts[originalDraft.key]:null;
    const laterEdits=originalDraft&&(!live||live.token!==originalDraft.token||
      !same(live.document,originalDraft.document)||live.note!==originalDraft.note);
    const key=originalDraft&&!laterEdits?originalDraft.key:'workflow-'+crypto.randomUUID();
    session.drafts[key]={key,token:crypto.randomUUID(),label:inventory.profile.name+' · operating periods',
      installationId,expectedRevision,document:result.document,
      note:originalDraft?.note||'Receive original customer operating periods from '+inventory.profile.name,dirty:true};
    session.notice='Prepared '+binding.periods.length+' complete original periods for the Installation’s next edition.'+
      (result.workflow.resetCycleIds.length?' Changed original periods now have open acceptance steps.':'')+
      (laterEdits?' Your later form edits remain in the open draft; the received periods are in a separate retained draft.':'');
    if(!laterEdits){
      session.draftKey=key;session.mode='edit';session.selected=null;selectedRow=null;
      preview=null;previewDraft=null;session.workflowIntake.open=false;
    }
    persist();
  }
  async function newDraft(){
    capture();const epoch=++generation,seeded=await api(prefix+'/installation-seed',{expectedVersion:caseValue.program.version});
    if(!own(epoch))return;
    const key='new';
    if(!session.drafts[key])session.drafts[key]={key,token:crypto.randomUUID(),installationId:null,expectedRevision:0,
      document:seeded.document,note:'',dirty:false};
    session.draftKey=key;session.mode='edit';session.selected=null;selectedRow=null;preview=null;previewDraft=null;persist();
  }
  async function editSaved(){
    const row=selectedRow;if(!row)return;
    const epoch=++generation,existing=session.drafts[row.id];
    await reloadCase();if(!own(epoch))return;
    if(existing){session.draftKey=row.id;session.mode='edit';preview=null;previewDraft=null;persist();return;}
    const latest=list().find(item=>item.id===row.id);
    if(!latest)throw new Error('The current saved installation is unavailable.');
    session.drafts[row.id]={key:row.id,token:crypto.randomUUID(),installationId:row.id,expectedRevision:latest.revision,
      document:copy(row.preview.document),note:'',dirty:false};
    session.draftKey=row.id;session.mode='edit';preview=null;previewDraft=null;
    session.notice=row.revision===latest.revision?'Opened the saved installation as an editable draft.':
      'Opened historical edition '+row.revision+' as a draft for the current installation. Its next save appends edition '+(latest.revision+1)+'.';
    persist();
  }
  async function previewDraftInput(){
    capture();const value=draft();if(!value)return;
    const epoch=generation,original=copy(value);
    const result=await api(prefix+'/installation-preview',{expectedVersion:caseValue.program.version,
      installationId:original.installationId,expectedRevision:original.expectedRevision,document:original.document});
    if(!own(epoch)||draft()?.token!==original.token||draft().installationId!==original.installationId||
      draft().expectedRevision!==original.expectedRevision||!same(draft().document,original.document))return;
    preview=result;previewDraft=original;session.notice='Reviewed the complete installation against case version '+result.source.version+'.';
  }
  async function acceptReadback(){
    const retained=session.accepted;if(!retained)return;
    const next=await reloadCase();
    const receipt=retained.result,original=retained.pending;
    const row=await saveApi(prefix+'/installations/'+receipt.recordId+'?revision='+receipt.revision);
    if(receipt.id!==caseId||row.id!==receipt.recordId||row.revision!==receipt.revision||row.sha256!==receipt.sha256)
      throw new Error('Reopen the exact original installation save result.');
    const matching=session.drafts[original.draftKey];
    if(matching?.token===original.draftToken){
      const laterEdits=!same(matching.document,original.document)||matching.note!==original.note;
      if(laterEdits){
        const occupying=session.drafts[row.id];
        const retainedKey=occupying&&occupying.token!==matching.token?original.draftKey:row.id;
        if(retainedKey!==original.draftKey)delete session.drafts[original.draftKey];
        matching.key=retainedKey;matching.installationId=row.id;matching.expectedRevision=row.revision;matching.dirty=true;
        session.drafts[retainedKey]=matching;
        if(session.draftKey===original.draftKey){session.draftKey=retainedKey;session.mode='edit';}
        session.notice='Saved edition '+row.revision+'. Your later edits remain in the draft for its next edition.';
      }else{
        delete session.drafts[original.draftKey];
        if(session.draftKey===original.draftKey){session.draftKey=null;session.mode='saved';session.selected={id:row.id,revision:row.revision};selectedRow=row;}
        session.notice='Saved complete installation edition '+row.revision+' with its original selected records and files.';
      }
    }
    session.accepted=null;preview=null;previewDraft=null;persist();
    if(available())await onCase(next,receipt);
    return receipt;
  }
  async function sendPending(){
    const retained=session.pending;if(!retained)return;
    if(session.inflight){await session.inflight;return;}
    const work=(async()=>{
      try{
        const result=await saveApi(prefix+'/command',retained.body);
        session.accepted={pending:retained,result};session.pending=null;session.error='';persist();return result;
      }catch(error){
        if(definite(error)){
          session.pending=null;session.notice='The original request was rejected. The complete edited installation remains in its draft.';
          session.rejected={body:retained.body,code:error.code};
        }
        session.error=error.message||String(error);persist();throw error;
      }
    })();
    session.inflight=work;controls();
    try{await work;}finally{if(session.inflight===work)session.inflight=null;}
    return acceptReadback();
  }
  async function saveDraft(){
    capture();const value=draft();
    if(!value||!preview||session.pending||session.accepted||previewDraft?.installationId!==value.installationId||
      previewDraft?.expectedRevision!==value.expectedRevision||!same(previewDraft?.document,value.document))
      throw new Error('Review this complete draft before saving.');
    if(!value.note.trim())throw new Error('Enter the reason for this saved edition.');
    const original=copy(value),body={expectedVersion:preview.source.version,actor:recordingActor(),note:original.note,
      action:'installation.save',data:{installationId:original.installationId,expectedRevision:original.expectedRevision,
        document:original.document,expectedPreviewSha256:preview.previewSha256}};
    body.requestId=await mutationId('operations:installation.save:'+caseId,body);
    session.pending={caseId,draftKey:session.draftKey,draftToken:original.token,document:original.document,note:original.note,body};
    persist();return sendPending();
  }
  async function downloadSelected(){
    const selected=copy(session.selected),epoch=generation;
    if(!selected?.id||!Number.isSafeInteger(selected.revision))return;
    const response=await api(prefix+'/installations/'+selected.id+'/export.zip?revision='+selected.revision,undefined,{download:true});
    const bytes=await response.blob();
    if(own(epoch)&&same(session.selected,selected))saveDownload(bytes,selected.id+'-edition-'+selected.revision+'.zip');
  }
  async function importDraft(file){
    if(file.size>128*1024)throw new Error('Choose one complete installation input up to 128 KiB.');
    const original=draft();if(!original)return;
    const token=original.token,epoch=generation,priorDocument=copy(original.document),document=JSON.parse(await file.text());
    const result=await api(prefix+'/installation-preview',{expectedVersion:caseValue.program.version,
      installationId:original.installationId,expectedRevision:original.expectedRevision,document});
    if(!own(epoch)||draft()?.token!==token)return;
    if(!same(draft().document,priorDocument)){
      const key='import-'+crypto.randomUUID();
      session.drafts[key]={key,token:crypto.randomUUID(),installationId:original.installationId,
        expectedRevision:original.expectedRevision,document:copy(result.document),note:'',dirty:true,label:file.name};
      session.notice='The complete loaded input is retained as draft '+file.name+'. Your later form edits remain open.';
    }else{
      draft().document=copy(result.document);draft().dirty=true;preview=result;previewDraft=copy(draft());
      session.notice='Loaded and reviewed the complete installation input against this operating case.';
    }
    persist();
  }
  root.addEventListener('submit',event=>{if(event.target.matches('[data-installation-editor]')){event.preventDefault();run(previewDraftInput);}});
  root.addEventListener('input',event=>{
    if(event.target.matches('[data-installation-field],[data-installation-note]')){capture();controls();}
    if(event.target.matches('[data-installation-filter]')){session.filter=event.target.value;const start=event.target.selectionStart;render();const input=$('[data-installation-filter]');input.focus();try{input.setSelectionRange(start,start);}catch{}}
  });
  root.addEventListener('change',event=>{
    if(event.target.matches('[data-workflow-period-field],[data-workflow-period-cycle]')){
      capture();
      if(event.target.matches('[data-workflow-period-field]')){
        const key=event.target.dataset.workflowPeriodField;session.workflowIntake[key]=event.target.value;
        if(key==='sourceId'){workflowInventory=null;session.workflowIntake.cycleIds=[];}
      }else{
        const id=event.target.dataset.workflowPeriodCycle;
        session.workflowIntake.cycleIds=event.target.checked?[...new Set([...session.workflowIntake.cycleIds,id])]:
          session.workflowIntake.cycleIds.filter(value=>value!==id);
      }
      persist();render();return;
    }
    if(event.target.matches('[data-installation-field]')){capture();controls();}
    if(event.target.matches('[data-installation-file]')&&event.target.files[0])run(()=>importDraft(event.target.files[0]));
  });
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-installation-action]');if(!target||target.disabled)return;
    const action=target.dataset.installationAction;
    if(action==='draft-import'){
      if(hostBusy||busy||session.inflight)return;
      const input=$('[data-installation-file]');input.value='';input.click();return;
    }
    run(async()=>{
      if(action==='workflow-open')return openWorkflow();
      if(action==='workflow-close'){capture();session.workflowIntake.open=false;persist();return;}
      if(action==='workflow-sources'){capture();persist();onSources?.();return;}
      if(action==='workflow-read')return readWorkflows();
      if(action==='workflow-prepare')return prepareWorkflow();
      if(action==='new')return newDraft();
      if(action==='open'||action==='current')return openEdition(target.dataset.id);
      if(action==='edition')return openEdition(session.selected.id,Number(target.dataset.revision));
      if(action==='edit')return editSaved();
      if(action==='draft'){capture();++generation;session.draftKey=target.dataset.key;session.mode='edit';preview=null;previewDraft=null;loading=false;persist();return;}
      if(action==='preview')return previewDraftInput();
      if(action==='save')return saveDraft();
      if(action==='recover')return sendPending();
      if(action==='readback')return acceptReadback();
      if(action==='export')return downloadSelected();
      if(action==='saved-input'){if(selectedRow)saveDownload(JSON.stringify(selectedRow.preview.document,null,2)+'\n',selectedRow.id+'-edition-'+selectedRow.revision+'-input.json');return;}
      if(action==='draft-download'){capture();if(draft())saveDownload(JSON.stringify(draft().document,null,2)+'\n',(draft().installationId||'new-installation')+'-input.json');return;}
      if(action==='source'){
        const source=selectedRow?.preview.snapshot.sources[target.dataset.source],epoch=generation;
        if(!source)return;
        const response=await api(prefix+'/sources/'+source.id,undefined,{download:true});
        const blob=await response.blob();if(own(epoch))saveDownload(blob,source.filename);return;
      }
      if(action==='more-history'){
        const selected=copy(session.selected),before=nextBefore,epoch=generation;
        const page=await api(prefix+'/installations/'+selected.id+'/history?before='+before);
        if(own(epoch)&&same(session.selected,selected)){historyRows.push(...page.editions);nextBefore=page.nextBefore;}return;
      }
      capture();const value=draft();if(!value||!editable())return;
      if(action==='add-facilitator')value.document.payment.facilitators.push({operatorId:'',endpoint:'',sourceIds:[],note:''});
      if(action==='remove-facilitator')value.document.payment.facilitators.splice(Number(target.dataset.index),1);
      if(action==='add-check')value.document.checks.push({id:'step-'+crypto.randomUUID().slice(0,8),title:'New acceptance step',criterion:'',
        tranche:null,required:true,state:'OPEN',operator:'',observedAt:null,note:'',sourceIds:[],workIds:[],purchaseIds:[],outcomeIds:[]});
      if(action==='remove-check'){
        const index=Number(target.dataset.index),check=value.document.checks[index];
        if(workflowBoundCheck(value.document,check))
          throw new Error('Receive the complete original customer periods to update their acceptance steps.');
        value.document.checks.splice(index,1);
      }
      value.dirty=true;preview=null;previewDraft=null;persist();
    });
  });
  async function initialize(){
    if(session.inflight)await session.inflight.catch(()=>{});
    if(session.accepted){await acceptReadback();return;}
    if(session.mode==='edit'&&draft()){render();return;}
    const selected=session.selected;
    if(selected?.id){await openEdition(selected.id,selected.revision??undefined);return;}
    if(list().length)await openEdition(list()[0].id,list()[0].revision);
    else render();
  }
  render();
  const ready=initialize().catch(error=>{failure(error);});
  return {ready,setHostBusy(value){hostBusy=!!value;controls();},
    dispose(){capture();active=false;++generation;persist();}};
}
