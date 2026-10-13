import {mountGraviteeSourceDesk} from './operations_gravitee.mjs';
// Complete customer installations in the original SF47 operating case.
import {mountCommercialInstallations} from './operations_commercial_installations.mjs';
import {mountInstallationSources} from './operations_installation_sources.mjs';
import { workflowBoundCheck, workflowReportView, workflowIntakePanel } from './operations_installation_workflows.mjs';
import { installationEffortFields, captureInstallationEffort, changeInstallationEffort, applyInstallationEffortReviews,
  installationEffortReport, installationEffortPlanningPanel, captureInstallationEffortPlanning, hasUnappliedEffortReviews } from './operations_installation_effort.mjs';
import {captureUseCalendar,useCalendarFields,useCalendarAction,useCalendarReport} from './operations_use_calendar.mjs';
import {captureCommissioning,commissioningFields,commissioningAction,commissioningReport} from './operations_commissioning.mjs';
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
const definite=error=>[400,409,413,415,422].includes(error?.status)&&typeof error?.code==='string';
function saveDownload(blob,name){
  const url=URL.createObjectURL(blob instanceof Blob?blob:new Blob([blob],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function field(label,path,value='',options={}){
  const attrs=' data-installation-field="'+esc(path)+'"'+(options.required?' required':'')+
    (options.locked?' disabled data-installation-fixed="true"':'');
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

export function mountInstallations({container,current,api,saveApi,session,mutationId,recordingActor,onCase,onSources,onForecastInputs}){
  const root=document.createElement('section');root.className='installation-desk';
  const commercialRoot=document.createElement('section');commercialRoot.hidden=true;
  const sourceRoot=document.createElement('section');sourceRoot.hidden=true;
  const graviteeRoot=document.createElement('section');graviteeRoot.hidden=true;
  root.setAttribute('aria-label','Customer installations');container.replaceChildren(commercialRoot,sourceRoot,graviteeRoot,root);
  if(!document.querySelector('link[data-installation-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_installations.css';
    link.dataset.installationStyle='true';document.head.append(link);
  }
  if(!document.querySelector('link[data-commercial-installation-style]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_commercial_installations.css';
    link.dataset.commercialInstallationStyle='true';document.head.append(link);
  }
  const caseId=current.program.id,prefix='/api/operations/'+caseId,storageKey='sf47.installations.'+caseId;
  if(!session.initialized){
    let stored;
    try{stored=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
    if(stored?.schema==='sf47.installation-editor.v1'&&stored.caseId===caseId){
      for(const key of ['drafts','draftKey','selected','mode','pending','accepted','notice','workshareIntake','workflowIntake','commercialOpen','effortPlanning'])if(Object.hasOwn(stored,key))session[key]=stored[key];
      if(!session.requestOpen&&stored.requestOpen)session.requestOpen=stored.requestOpen;
    }
    if(stored?.schema==='sf47.installation-editor.v1'&&stored.caseId===caseId&&stored.commercialIntake)session.commercialIntake=stored.commercialIntake;
    session.initialized=true;
  }
  for(const [key,value] of Object.entries({drafts:{},draftKey:null,selected:null,mode:'saved',pending:null,accepted:null,
    inflight:null,notice:'',error:'',filter:'',workshareIntake:{open:false,sourceId:'',packetSourceId:'',caseId:'',target:'new'},
    workflowIntake:{open:false,sourceId:'',target:'new',cycleIds:[]},
    effortPlanning:{open:false,forecastId:'',name:'',note:'',taskInstallations:{},forecast:null,installationChoices:[],lastSelection:null},commercialOpen:false,commercialIntake:{}}))if(!Object.hasOwn(session,key))session[key]=value;
  let active=true,hostBusy=false,busy=false,generation=0,caseValue=current,selectedRow=null,historyRows=[],nextBefore=null;
  let preview=null,previewDraft=null,loading=false,workshareInventory=null,workflowInventory=null,commercialView=null,sourceView=null,graviteeView=null;
  const $=selector=>root.querySelector(selector),available=()=>active&&root.isConnected;
  const draft=()=>session.draftKey?session.drafts[session.draftKey]:null;
  const editable=()=>caseValue.program.state==='OPEN'&&!hostBusy;
  const own=epoch=>available()&&epoch===generation;
  const list=()=>caseValue.installations||[];
  const sourceOptions=()=>caseValue.sources.map(row=>[row.id,row.filename+' · '+row.sha256.slice(0,10)]);
  const recordOptions=kind=>(caseValue.records[kind]||[]).map(row=>[row.id,(row.name||row.description||row.number||row.operationId||row.id)+' · '+title(row.state)]);
  const deployments=roles=>caseValue.records.deployments.filter(row=>roles.includes(row.role)).map(row=>[row.id,row.name+' · '+row.operator]);
  function persist(){
    const body={schema:'sf47.installation-editor.v1',caseId,requestOpen:session.requestOpen??null};
    for(const key of ['drafts','draftKey','selected','mode','pending','accepted','notice','workshareIntake','workflowIntake','commercialOpen','effortPlanning'])body[key]=session[key];
    body.commercialIntake=Object.fromEntries(['sourceId','quoteKey','acceptanceKey','installationId'].filter(key=>Object.hasOwn(session.commercialIntake,key)).map(key=>[key,session.commercialIntake[key]]));
    try{sessionStorage.setItem(storageKey,JSON.stringify(body));}
    catch{session.storageNotice='The browser could not retain another local draft copy. Download the complete draft before closing this browser.';}
  }
  function failure(error){session.error=error?.message||String(error);if(available())render();}
  function controls(){
    if(!available())return;
    root.setAttribute('aria-busy',String(hostBusy||busy||!!session.inflight));
    for(const el of root.querySelectorAll('button,input,select,textarea')){
      const isInput=el.matches('[data-installation-field],[data-installation-coordination],[data-installation-note],[data-use-field],[data-use-pattern],[data-installation-effort-field],[data-commissioning-field],[data-commissioning-ui],[data-commissioning-decision],[data-commissioning-review-select],[data-commissioning-output],[data-commissioning-call]');
      const save=el.dataset.installationAction==='save';
      el.disabled=el.dataset.installationFixed==='true'||hostBusy||
        (save&&(hasUnappliedEffortReviews(draft())||!preview||!same(previewDraft?.document,draft()?.document)||previewDraft?.expectedRevision!==draft()?.expectedRevision))||
        (isInput?!editable():(busy||!!session.inflight));
    }
  }
  async function run(fn){
    if(!available()||hostBusy||busy||session.inflight)return;
    busy=true;session.error='';controls();
    try{return await fn();}catch(error){failure(error);}finally{busy=false;if(available())render();}
  }
  function capture(){
    captureInstallationEffortPlanning(root,session.effortPlanning);
    const value=draft();if(!value||session.mode!=='edit'||!$('[data-installation-editor]'))return;
    for(const input of root.querySelectorAll('[data-installation-field]')){
      const path=input.dataset.installationField;
      let selected=input.multiple?[...input.selectedOptions].map(row=>row.value):input.type==='checkbox'?input.checked:input.value;
      if(path==='payment.taskUnits'||/^checks\.\d+\.tranche$/.test(path))selected=selected===''?null:Number(selected);
      else if(path==='merchantDeploymentId'||path==='workorder.sourceId'||/\.observedAt$/.test(path)||path==='payment.priceAtomic'||path==='payment.taskBudgetAtomic')selected=selected===''?null:selected;
      assign(value.document,path,selected);
    }
    captureCoordination(value);
    captureInstallationEffort(root,value);
    captureUseCalendar(root,value.document,value.calendarUI??={});
    captureCommissioning(root,value.document,value.commissioningUI??={});
    value.note=$('[data-installation-note]')?.value??value.note;
    value.dirty=true;
    if(previewDraft&&!same(previewDraft.document,value.document))preview=null;
    persist();
  }
  function heading(label,description,actions=''){
    return '<div class="installation-heading"><div><h3>'+esc(label)+'</h3><p>'+esc(description)+'</p></div><div class="installation-actions">'+actions+'</div></div>';
  }
  function group(title,content){return '<fieldset><legend>'+esc(title)+'</legend><div class="installation-fields">'+content+'</div></fieldset>';}
  function coordinationFields(document){
    const assigned=document.coordination||{},overrides=new Map((assigned.steps||[]).map(row=>[row.checkId,row]));
    const cf=(label,path,value,options={})=>field(label,path,value,options).replace('data-installation-field=','data-installation-coordination=');
    return '<fieldset class="installation-coordination" data-installation-coordination-panel><legend>Delivery assignment and sequencing</legend>'+
      '<p>Set responsibility and target dates for setup and acceptance work. Blank step fields use the installation assignment below.</p>'+
      '<div class="installation-fields">'+
      cf('Installation delivery assignee','owner',assigned.owner||'',{max:500,help:'The person responsible for coordinating this delivery.'})+
      cf('Target delivery date','dueDate',assigned.dueDate||'',{type:'date'})+
      cf('Delivery priority','priority',assigned.priority||'NORMAL',{choices:choices('URGENT','HIGH','NORMAL','LOW')})+
      cf('Delivery instructions','note',assigned.note||'',{area:true,wide:true,max:8000})+'</div>'+
      document.checks.map((check,index)=>{
        const step=overrides.get(check.id)||{},path='steps.'+index+'.';
        const dependencies=document.checks.filter(row=>row.id!==check.id).map(row=>[row.id,row.title||row.id]);
        return '<details class="installation-entry" data-coordination-step="'+esc(check.id)+'" data-coordination-index="'+index+'"><summary>'+
          esc(check.title||'Acceptance step '+(index+1))+' · '+esc(step.owner||assigned.owner||'Unassigned')+'</summary><div class="installation-fields">'+
          cf('Step delivery assignee',path+'owner',step.owner||'',{max:500,help:'Leave blank to use the installation assignee.'})+
          cf('Step target date',path+'dueDate',step.dueDate||'',{type:'date',help:'Leave blank to use the installation target date.'})+
          cf('Step priority',path+'priority',step.priority||'INHERIT',{choices:[['INHERIT','Use installation priority'],...choices('URGENT','HIGH','NORMAL','LOW')]})+
          cf('Finish these steps first',path+'dependsOn',step.dependsOn||[],{choices:dependencies,multiple:true,wide:true,help:'Select the other acceptance steps that must finish before this one is ready.'})+
          cf('Step delivery instructions',path+'note',step.note||'',{area:true,wide:true,max:4000,help:'Leave blank to use the installation instructions.'})+
          '</div></details>';
      }).join('')+'</fieldset>';
  }
  function captureCoordination(value){
    const panel=$('[data-installation-coordination-panel]');if(!panel)return;
    const previous=value.document.coordination;
    const next={owner:'',dueDate:null,priority:'NORMAL',note:'',steps:[]},renamed=new Map();
    for(const details of panel.querySelectorAll('[data-coordination-step]')){
      const index=Number(details.dataset.coordinationIndex),check=value.document.checks[index];
      if(check)renamed.set(details.dataset.coordinationStep,check.id);
    }
    for(const input of panel.querySelectorAll('[data-installation-coordination]')){
      const path=input.dataset.installationCoordination,bits=path.split('.');
      let selected=input.multiple?[...input.selectedOptions].map(row=>renamed.get(row.value)||row.value):input.value;
      if(bits.at(-1)==='dueDate')selected=selected||null;
      if(bits[0]==='steps'){
        const index=Number(bits[1]),check=value.document.checks[index];if(!check)continue;
        next.steps[index]??={checkId:check.id,owner:'',dueDate:null,priority:'INHERIT',dependsOn:[],note:''};
        next.steps[index][bits[2]]=selected;
      }else next[path]=selected;
    }
    const previousIds=new Set((previous?.steps||[]).map(row=>renamed.get(row.checkId)||row.checkId));
    next.steps=next.steps.filter(row=>row&&(previousIds.has(row.checkId)||row.owner||row.dueDate||
      row.priority!=='INHERIT'||row.dependsOn.length||row.note));
    for(const row of next.steps)row.dependsOn.sort();
    next.steps.sort((a,b)=>a.checkId<b.checkId?-1:a.checkId>b.checkId?1:0);
    if(previous||next.owner||next.dueDate||next.priority!=='NORMAL'||next.note||next.steps.length)
      value.document.coordination=next;
  }
  function coordinationView(document){
    const coordination=document.coordination;
    if(!coordination)return note('Delivery assignments have not been set for this edition.');
    const byId=new Map((coordination.steps||[]).map(row=>[row.checkId,row])),names=new Map(document.checks.map(row=>[row.id,row.title]));
    return '<h4>Delivery assignment and sequencing</h4>'+
      table(['Installation assignee','Target date','Priority'],[[esc(coordination.owner||'Unassigned'),esc(coordination.dueDate||'Undated'),esc(title(coordination.priority))]])+
      (coordination.note?note(coordination.note):'')+
      table(['Acceptance step','Delivery assignee / target','Priority / prerequisites'],document.checks.map(check=>{
        const step=byId.get(check.id)||{};
        return [esc(check.title)+(step.note?'<p>'+esc(step.note)+'</p>':''),
          esc(step.owner||coordination.owner||'Unassigned')+'<br>'+esc(step.dueDate||coordination.dueDate||'Undated'),
          esc(title(step.priority&&step.priority!=='INHERIT'?step.priority:coordination.priority))+'<p>'+
          esc(step.dependsOn?.length?step.dependsOn.map(id=>names.get(id)||id).join(', '):'No prerequisite steps selected')+'</p>'];
      }));
  }
  function focusCoordination(taskId){
    const panel=$('[data-installation-coordination-panel]');if(!panel)return;
    let target=panel;
    for(const details of panel.querySelectorAll('[data-coordination-step]')){
      if(details.dataset.coordinationStep===taskId){details.open=true;target=details;break;}
    }
    target.scrollIntoView({block:'start'});
    target.querySelector('[data-installation-coordination]')?.focus({preventScroll:true});
  }
  function draftFields(value){
    const d=value.document;
    const boundCheck=check=>!!d.workshare?.phaseChecks.some(row=>row.checkId===check.id)||!!d.commercial?.taskChecks.some(row=>row.checkId===check.id)||workflowBoundCheck(d,check);
    const f=(label,path,options={})=>{
      const match=/^checks\.(\d+)\.(id|title|criterion|required)$/.exec(path);
      const locked=(path.startsWith('workorder.')&&!!(d.workshare||d.commercial))||(match&&boundCheck(d.checks[Number(match[1])]));
      return field(label,path,path.split('.').reduce((v,key)=>v[key],d),{...options,locked:!!locked});
    };
    const sources=(label,path)=>f(label,path,{choices:sourceOptions(),multiple:true,wide:true});
    let html=group('Installation and original commissioning',
      f('Installation name','name',{required:true,wide:true,max:300})+
      f('Operating stage','stage',{choices:choices('PLANNED','COMMISSIONING','OPERATING','HANDED_OVER','RETIRED')})+
      f('Merchant deployment','merchantDeploymentId',{choices:optional(deployments(['MERCHANT','BOTH']))})+
      f('Receiving buyer deployments','buyerDeploymentIds',{choices:deployments(['BUYER','BOTH']),multiple:true,wide:true})+
      f('Complete original workorder file','workorder.sourceId',{choices:optional(sourceOptions()),wide:true})+
      f('Workorder reference','workorder.reference')+f('Commissioning payer','workorder.payer')+
      f('Whole implementation assignment','workorder.scope',{area:true,wide:true})+
      f('Original commercial terms','workorder.terms',{area:true,wide:true}));
    html+=coordinationFields(d);
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
    html+=installationEffortFields({draft:value,caseValue,editable:editable(),actor:recordingActor(),button});
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
    html+=useCalendarFields(d,caseValue,value.calendarUI??={});
    html+=commissioningFields(d,caseValue,value.commissioningUI??={});
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
      workflowReportView(value)+useCalendarReport(report.useCalendar)+installationEffortReport(report.effort)+commissioningReport(report.commissioning)+
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
      reportView(row.preview)+coordinationView(d)+
      (d.workshare?'<h4>Original commercial Workshare</h4>'+
        pairs(d.workshare,[['caseId','Commercial case'],['planSha256','Complete original plan SHA-256'],
          ['sourceId','Original commissioning file'],['packetSourceId','Original receiving packet']])+
        note(d.workshare.phaseChecks.length+' original commercial phases are linked to their stable installation acceptance steps.'):'')+
      (d.commercial?'<h4>Original accepted Merchant quotation</h4>'+
        pairs(d.commercial,[['caseKey','Quotation family'],['quoteId','Selected quote'],
          ['quoteSha256','Sealed quote SHA-256'],['acceptanceId','Accepted response'],
          ['acceptanceSha256','Response SHA-256'],['scopeSha256','Accepted scope SHA-256'],
          ['sourceId','Original handoff file'],['sourceSha256','Complete source SHA-256']])+
        table(['Accepted task','Original acceptance step'],d.commercial.taskChecks.map(row=>[
          '<code>'+esc(row.taskId)+'</code>','<code>'+esc(row.checkId)+'</code>'])):'')+
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
      button('Receive accepted quotation','commercial-open','',!editable()||!!session.pending||!!session.accepted)+
      button('Receive commercial Workshare','workshare-open','',!editable()||!!session.pending||!!session.accepted)+
      button('Prepare original source workshares','source-open','',!editable()||!!session.pending||!!session.accepted)+
      button('Gravitee API source','gravitee-open','',!editable()||!!session.pending||!!session.accepted)+
      button('Receive customer periods','workflow-open','',!editable()||!!session.pending||!!session.accepted)+
       button('Remaining work forecast','effort-planning-show'))+
      '<p class="installation-message" role="'+(session.error?'alert':'status')+'" aria-live="polite">'+esc(session.error||session.notice)+'</p>'+
      (session.storageNotice?note(session.storageNotice):'')+worksharePanel()+workflowPanel()+
       installationEffortPlanningPanel({state:session.effortPlanning,caseValue,button,canOpenForecast:!!onForecastInputs})+
      (session.pending?'<div class="installation-recovery"><h4>Original save request retained</h4><p>Recover this exact request before saving another edition. Your later form edits stay in their draft.</p>'+button('Recover original save','recover')+'<code>'+esc(session.pending.body.requestId)+'</code></div>':'')+
      (session.accepted?'<div class="installation-recovery"><h4>Edition saved; readback is pending</h4>'+button('Open saved result','readback')+'</div>':'')+
      (session.requestOpen&&!session.pending&&!session.accepted?'<div class="installation-recovery"><h4>Selected Installation handoff retained</h4><p>'+esc(session.requestOpen.id)+' · source edition '+esc(session.requestOpen.revision)+'</p>'+button('Open selected edition','queued-open')+'</div>':'')+
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
    sourceView?.setHostBusy(hostBusy||busy||!!session.inflight);sourceView?.refresh();
    graviteeView?.setHostBusy(hostBusy||busy||!!session.inflight);graviteeView?.refresh();
    commercialRoot.hidden=!session.commercialOpen;
    if(session.commercialOpen){ensureCommercial();commercialView.refresh();}
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

  function commercialDraft(id){
    capture();
    const value=session.mode==='edit'?draft():null;
    if(!value||value.installationId!==id)return null;
    return {document:copy(value.document),expectedRevision:value.expectedRevision,
      draftKey:value.key,token:value.token,note:value.note};
  }
  function commercialReadOnly(){
    if(!editable())return 'Reopen the original operating case to receive accepted scope.';
    if(session.pending||session.accepted)return 'Recover the original Installation save before receiving another accepted scope.';
    if(busy||session.inflight)return 'The original Installation operation is in progress.';
    return '';
  }
  function closeCommercial(){
    session.commercialOpen=false;commercialRoot.hidden=true;persist();
    root.scrollIntoView({block:'start'});
  }
  function ensureCommercial(){
    if(commercialView)return;
    commercialView=mountCommercialInstallations(commercialRoot,{
      context:()=>({workspaceId:caseValue.workspaceId??null,caseId,version:caseValue.program.version,
        sources:caseValue.sources,installations:list()}),
      inventory:body=>api(prefix+'/installation-commercial',body),
      seed:body=>api(prefix+'/installation-commercial-seed',body),
      getInstallation:id=>api(prefix+'/installations/'+id),
      currentDraft:commercialDraft,
      readOnlyReason:commercialReadOnly,
      persist,close:closeCommercial,
      openSources:()=>{capture();persist();onSources?.();},
      downloadSource:async id=>{
        const selected=caseValue.sources.find(row=>row.id===id),epoch=generation;
        if(!selected)throw new Error('Reopen the original source selection.');
        const response=await api(prefix+'/sources/'+id,undefined,{download:true}),blob=await response.blob();
        if(own(epoch))saveDownload(blob,selected.filename);
      },
      receiveDraft:async input=>{
        const reason=commercialReadOnly();if(reason)return {applied:false,message:reason};
        if(input.scope.caseId!==caseId||input.scope.version!==caseValue.program.version)
          return {applied:false,message:'The original case changed. Review its accepted source again.'};
        const original=input.originalDraft,live=commercialDraft(input.installationId);
        if(original?.draftKey){
          if(!live||!same(live,original))
            return {applied:false,message:'The current Installation draft changed. Review its complete accepted scope again.'};
        }else if(live){
          return {applied:false,message:'A later Installation draft is now open. Review it before receiving this source.'};
        }
        if(input.installationId&&list().find(row=>row.id===input.installationId)?.revision!==input.expectedRevision)
          return {applied:false,message:'The selected saved Installation changed edition.'};
        const selectedKey=original?.draftKey||'commercial-'+crypto.randomUUID();
        session.drafts[selectedKey]={key:selectedKey,token:crypto.randomUUID(),
          label:input.document.name+' · accepted quotation',installationId:input.installationId,
          expectedRevision:input.expectedRevision,document:copy(input.document),
          note:original?.note||'Receive accepted quotation '+input.review.source.selected.quoteId,
          dirty:true};
        session.draftKey=selectedKey;session.mode='edit';session.selected=null;selectedRow=null;
        preview=null;previewDraft=null;
        session.notice='Prepared the complete accepted customer scope. Review the Installation and save its next edition.';
        persist();render();return {applied:true,draftKey:selectedKey};
      },
      openInstallation:async id=>{
        if(session.mode==='edit'&&draft()?.installationId===id){closeCommercial();return;}
        if(id){await openEdition(id);if(available())closeCommercial();}
        else {closeCommercial();render();}
      }
    },session.commercialIntake);
  }

  function ensureSourceDesk(){
    if(sourceView)return sourceView;
    sourceView=mountInstallationSources(sourceRoot,{
      context:()=>({caseId,planId:caseValue.program.planId,createdAt:caseValue.program.createdAt,version:caseValue.program.version}),
      caseData:()=>caseValue,api,saveApi,recordingActor,
      readOnlyReason:commercialReadOnly,
      refreshCase:reloadCase,
      close:()=>root.scrollIntoView({block:'start'}),
      receiveDraft:async input=>{
        const reason=commercialReadOnly();if(reason)return {applied:false,message:reason};
        capture();
        if(input.scope.caseId!==caseId||input.scope.version!==caseValue.program.version||
           input.preview?.source.caseId!==caseId||input.preview.source.version!==caseValue.program.version||
           !same(input.preview.document,input.document))
          return {applied:false,message:'The original complete case or reviewed source changed. Review the current preparation again.'};
        const key='source-'+crypto.randomUUID();
        session.drafts[key]={key,token:crypto.randomUUID(),label:input.document.name+' · source preparation',
          installationId:null,expectedRevision:0,document:copy(input.document),
          note:'Receive complete source preparation '+input.sourcePreparationId+' for original Workshare '+input.workshareCaseId,dirty:true};
        session.draftKey=key;session.mode='edit';session.selected=null;selectedRow=null;
        preview=null;previewDraft=null;loading=false;
        session.notice='Prepared the complete original source Workshare as a separate Installation draft. Review and save its native edition.';
        persist();render();
        let retained;try{retained=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
        if(retained?.drafts?.[key]?.token!==session.drafts[key].token)
          return {applied:false,message:'The complete draft is open, but browser persistence failed. Download it or recover browser storage before leaving; the source preparation remains retained.'};
        return {applied:true,draftKey:key};
      }
    });
    sourceView.ready.catch(error=>{if(available())failure(error);});
    return sourceView;
  }

  function ensureGraviteeDesk(){
    if(graviteeView)return graviteeView;
    graviteeView=mountGraviteeSourceDesk(graviteeRoot,{
      context:()=>({caseId,planId:caseValue.program.planId,createdAt:caseValue.program.createdAt,version:caseValue.program.version}),
      caseData:()=>caseValue,api,saveApi,recordingActor,readOnlyReason:commercialReadOnly,
      refreshCase:reloadCase,close:()=>root.scrollIntoView({block:'start'}),
      currentDraft:()=>{capture();persist();const d=session.mode==='edit'?draft():null;return d?copy(d):null;},
      receiveDraft:async input=>{
        const reason=commercialReadOnly();if(reason)return {applied:false,message:reason};
        capture();persist();
        const prepared=input.result?.prepared,reviewed=input.result?.nativePreview;
        if(input.scope?.caseId!==caseId||input.scope.version!==caseValue.program.version||
           reviewed?.source.caseId!==caseId||reviewed.source.version!==caseValue.program.version||
           !same(reviewed.document,prepared?.document))
          return {applied:false,message:'Reopen the current complete case and review this exact source preparation.'};
        const key='gravitee-'+crypto.randomUUID(),doc=prepared.document;
        session.drafts[key]={key,token:crypto.randomUUID(),label:doc.name+' · Gravitee source',
          installationId:null,expectedRevision:0,document:copy(doc),
          note:'Receive complete Gravitee cohort '+input.result.snapshot.selectedCohortSource.sha256,dirty:true};
        session.draftKey=key;session.mode='edit';session.selected=null;selectedRow=null;
        preview=null;previewDraft=null;loading=false;
        session.notice='Received the complete selected API source as a separate Installation draft. Review and save its original native edition.';
        persist();render();
        let saved;try{saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
        if(saved?.drafts?.[key]?.token!==session.drafts[key].token)return {applied:false,message:'The complete draft is open. Download it or recover browser persistence before leaving.'};
        root.scrollIntoView({block:'start'});return {applied:true,draftKey:key};
      }
    });
    graviteeView.ready.catch(error=>{if(available())failure(error);});return graviteeView;
  }

  const sameWorkshareSource=(a,b)=>['sourceId','expectedSourceSha256','packetSourceId','expectedPacketSha256'].every(key=>a?.[key]===b?.[key]);
  function workshareSelection(value=session.workshareIntake){
    const source=caseValue.sources.find(row=>row.id===value.sourceId);
    const packet=value.packetSourceId?caseValue.sources.find(row=>row.id===value.packetSourceId):null;
    if(!source)throw new Error('Select the complete original commissioning file from this case’s Sources.');
    if(value.packetSourceId&&!packet)throw new Error('Reopen the selected original receiving packet.');
    return {sourceId:source.id,expectedSourceSha256:source.sha256,
      packetSourceId:packet?.id??null,expectedPacketSha256:packet?.sha256??null};
  }
  function worksharePanel(){
    const value=session.workshareIntake;if(!value.open)return '';
    const choices=[['new','Create a new installation']];
    if(session.mode==='edit'&&draft())choices.push(['draft','Update the complete open draft']);
    if(session.mode==='saved'&&selectedRow)choices.push(['saved','Prepare a new edition of the selected installation']);
    if(!choices.some(([id])=>id===value.target))value.target='new';
    const select=(label,key,options)=>'<label><span>'+esc(label)+'</span><select data-workshare-field="'+key+'">'+
      options.map(([id,name])=>'<option value="'+esc(id)+'"'+(String(value[key])===String(id)?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select></label>';
    const selected=workshareInventory?.cases.find(row=>row.caseId===value.caseId);
    const commercial=selected?.commercial;
    const ready=!!selected&&editable()&&!session.pending&&!session.accepted;
    return '<section class="installation-preview" aria-label="Original commercial Workshare">'+
      heading('Receive original commercial Workshare','Attach the complete commissioning JSON and optional receiving packet in Sources. Select the original commercial case to prepare its whole installation.',
        (onSources?button('Open Sources','workshare-sources'):'')+button('Close','workshare-close'))+
      '<div class="installation-fields">'+
      select('Complete original commissioning file','sourceId',[['','Select original source'],...sourceOptions()])+
      select('Complete matching receiving packet','packetSourceId',[['','No receiving packet selected'],...sourceOptions()])+
      select('Installation destination','target',choices)+'</div>'+
      '<div class="installation-actions">'+button('Read original Workshares','workshare-read','',!value.sourceId||!editable())+'</div>'+
      (workshareInventory?'<div class="installation-fields">'+select('Original commercial case','caseId',
        [['','Select original Workshare'],...workshareInventory.cases.map(row=>[row.caseId,row.title+' · '+row.customer+' · '+row.caseId])])+'</div>':'')+
      (selected?table(['Original commercial selection','Value'],[
        ['Customer',esc(selected.customer)],['Supplier',esc(selected.supplier)],
        ['Fee and original status',esc(commercial.currency+' '+commercial.amount+' · '+commercial.price_status)],
        ['Complete planned delivery',esc(selected.hours+' hours · '+selected.phaseCount+' phases')],
        ['Original plan SHA-256','<code>'+esc(selected.planSha256)+'</code>'],
        ['Matching receiving packet',selected.packetPresent?'Selected':'Unentered']])+
        (commercial.milestones?.length?table(['Commercial milestone','Original amount','Payment trigger'],
          commercial.milestones.map(row=>[esc(row.label),esc(commercial.currency+' '+row.amount),esc(row.trigger)])):'')+
        note('The prepared document retains each original phase and acceptance criterion. Continue in the installation editor to select deployments, native payment terms and the receiving application.'):
        workshareInventory?empty('Select the complete Workshare to receive.'):'')+
      '<div class="installation-actions">'+button('Prepare complete installation','workshare-prepare','',!ready)+'</div></section>';
  }
  function openWorkshare(){
    capture();
    const binding=(session.mode==='edit'?draft()?.document:selectedRow?.preview.document)?.workshare;
    const value=session.workshareIntake;
    if(binding){
      value.sourceId=binding.sourceId;value.packetSourceId=binding.packetSourceId??'';
      value.caseId=binding.caseId;value.target=session.mode==='edit'?'draft':'saved';
    }
    value.open=true;workshareInventory=null;persist();
  }
  async function readWorkshares(){
    capture();const epoch=++generation,selected=copy(session.workshareIntake);
    await reloadCase();if(!own(epoch))return;
    const selection=workshareSelection(selected);
    const result=await api(prefix+'/installation-workshares',{expectedVersion:caseValue.program.version,...selection});
    if(!own(epoch)||session.workshareIntake.sourceId!==selected.sourceId||
      session.workshareIntake.packetSourceId!==selected.packetSourceId)return;
    if(result.source?.caseId!==caseId||!sameWorkshareSource(result.selection,selection)||!Array.isArray(result.cases))
      throw new Error('Reopen the complete original Workshare source selection.');
    workshareInventory=result;
    if(!result.cases.some(row=>row.caseId===session.workshareIntake.caseId))
      session.workshareIntake.caseId=result.cases.length===1?result.cases[0].caseId:'';
    session.notice='Read '+result.cases.length+' complete original Workshare'+(result.cases.length===1?'':'s')+' from the attached source.';
    persist();
  }
  async function prepareWorkshare(){
    capture();
    const value=copy(session.workshareIntake),selected=workshareInventory?.cases.find(row=>row.caseId===value.caseId);
    if(!selected)throw new Error('Read and select the complete original Workshare first.');
    const originalDraft=value.target==='draft'?copy(draft()):null;
    const originalSaved=value.target==='saved'?selectedRow:null;
    if(value.target==='draft'&&!originalDraft)throw new Error('Reopen the complete draft to receive this Workshare.');
    if(value.target==='saved'&&!originalSaved)throw new Error('Reopen the selected installation edition.');
    const epoch=++generation,selection=copy(workshareInventory.selection);
    await reloadCase();if(!own(epoch))return;
    if(!sameWorkshareSource(workshareSelection(value),selection))throw new Error('Read the selected original source again.');
    const installationId=originalDraft?.installationId??originalSaved?.id??null;
    const expectedRevision=originalDraft?.expectedRevision??
      (originalSaved?list().find(row=>row.id===originalSaved.id)?.revision:0);
    if(expectedRevision===undefined)throw new Error('The selected installation’s current edition is unavailable.');
    const originalDocument=originalDraft?.document??originalSaved?.preview.document;
    const result=await api(prefix+'/installation-workshare-seed',{expectedVersion:caseValue.program.version,
      ...selection,workshareCaseId:selected.caseId,installationId,expectedRevision,
      ...(originalDocument?{document:originalDocument}:{})});
    if(!own(epoch))return;
    const binding=result.document?.workshare;
    if(result.source?.caseId!==caseId||result.installationId!==installationId||result.expectedRevision!==expectedRevision||
      binding?.caseId!==selected.caseId||binding?.planSha256!==selected.planSha256||
      binding?.sourceId!==selection.sourceId||binding?.sourceSha256!==selection.expectedSourceSha256||
      binding?.packetSourceId!==selection.packetSourceId||binding?.packetSha256!==selection.expectedPacketSha256)
      throw new Error('Reopen the exact original Workshare and installation selection.');
    capture();
    const live=originalDraft?session.drafts[originalDraft.key]:null;
    const laterEdits=originalDraft&&(!live||live.token!==originalDraft.token||
      !same(live.document,originalDraft.document)||live.note!==originalDraft.note);
    const key=originalDraft&&!laterEdits?originalDraft.key:'workshare-'+crypto.randomUUID();
    session.drafts[key]={key,token:crypto.randomUUID(),label:selected.title+' · Workshare',
      installationId,expectedRevision,document:result.document,
      note:originalDraft?.note||'Receive original Workshare '+selected.caseId,dirty:true};
    const changed=result.workshare.resetPhaseIds;
    session.notice='Prepared the complete '+selected.phaseCount+'-phase Workshare installation.'+
      (changed.length?' Reopened changed phases: '+changed.join(', ')+'.':'')+
      (laterEdits?' Your later form edits remain in the open draft; the received Workshare is a separate retained draft.':'');
    if(!laterEdits){
      session.draftKey=key;session.mode='edit';session.selected=null;selectedRow=null;
      preview=null;previewDraft=null;session.workshareIntake.open=false;
    }
    persist();
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
  async function readCurrentEffort(){
    capture();const value=draft();
    if(!value?.installationId||!(value.document.workshare||value.document.commercial))throw new Error('Open a saved accepted-quotation or Workshare installation to read its original delivery scope and work.');
    const original=copy(value),epoch=++generation;
    await reloadCase();if(!own(epoch))return false;
    const asOfDate=original.document.effort?.asOfDate||original.effortAsOfDate||new Date().toISOString().slice(0,10);
    const result=await api(prefix+'/installation-effort-seed',{expectedVersion:caseValue.program.version,
      installationId:original.installationId,expectedRevision:original.expectedRevision,asOfDate,document:original.document});
    if(!own(epoch))return false;
    if(result.schema!=='stellar-forge.sf47-installation-effort.v1'||result.source?.caseId!==caseId||
      result.installationId!==original.installationId||result.expectedRevision!==original.expectedRevision||
      !result.document?.effort||!Array.isArray(result.phaseSource?.phases)||!Array.isArray(result.workInventory))
      throw new Error('Reopen the complete original Installation effort source.');
    if(original.document.commercial){
      const binding=result.phaseSource.commercial,expected=original.document.commercial;
      if(result.phaseSource.sourceKind!=='COMMERCIAL'||!binding||
        !['caseKey','quoteId','quoteSha256','acceptanceId','acceptanceSha256','scopeSha256','sourceId','sourceSha256'].every(key=>binding[key]===expected[key]))
        throw new Error('Reopen the complete accepted quotation and its original task effort source.');
    }
    capture();const live=draft();
    if(live?.token!==original.token||!same(live.document,original.document)){
      session.notice='Read the original work source. Your later edits remain in their draft; read current work again to apply the refreshed inventory.';
      persist();return false;
    }
    live.document=copy(result.document);live.effortContext=copy(result);live.dirty=true;
    preview=null;previewDraft=null;
    session.notice='Read '+result.phaseSource.phases.length+' original '+(original.document.commercial?'accepted tasks':'phases')+' and '+result.workInventory.length+' work records through '+asOfDate+'.';
    persist();return true;
  }
  async function applyRemainingReviews(){
    capture();const value=draft();
    if(!value?.document.effort)throw new Error('Read current work and the original delivery scope before reviewing remaining hours.');
    const original=copy(value),epoch=++generation;
    await reloadCase();if(!own(epoch))return;
    const result=await api(prefix+'/installation-preview',{expectedVersion:caseValue.program.version,
      installationId:original.installationId,expectedRevision:original.expectedRevision,document:original.document});
    if(!own(epoch))return;
    capture();const live=draft();
    if(live?.token!==original.token||!same(live.document,original.document)||
      !same(live.effortReviewDrafts,original.effortReviewDrafts)||!same(live.effortReviewMeta,original.effortReviewMeta))
      throw new Error('Your later edits are retained. Apply the remaining-hour review again with those current values.');
    const count=applyInstallationEffortReviews(live,result.report,recordingActor());
    if(live.effortContext)live.effortContext.report=copy(result.report);
    preview=null;previewDraft=null;persist();
    session.notice='Applied reviewed remaining hours for '+count+' original '+(live.document.commercial?'task':'phase')+(count===1?'':'s')+'. Review and save the complete installation edition.';
  }
  async function rebindEffort(action,target){
    capture();const original=draft(),index=Number(target.dataset.index);
    const selected=copy(action==='effort-rebind'?original?.document.effort?.allocations[index]:original?.document.effort?.supportWindows[index]);
    if(!selected)throw new Error('Reopen the selected effort allocation or support allowance.');
    if(!await readCurrentEffort())return;
    const value=draft(),live=action==='effort-rebind'?value.document.effort.allocations[index]:value.document.effort.supportWindows[index];
    if(!live||(action==='effort-rebind'?(live.workId!==selected.workId||live.phaseId!==selected.phaseId):live.id!==selected.id))
      throw new Error('Reopen the exact original allocation or allowance before adopting its current source.');
    changeInstallationEffort(value,action,target,recordingActor());
    preview=null;previewDraft=null;persist();
    session.notice=action==='effort-rebind'?'Selected the corrected original work for this allocation. Review the complete updated effort.':
      'Adopted the current original commercial terms for this support allowance. Review the complete updated effort.';
  }
  function showEffortPlanning(){
    capture();session.effortPlanning.open=true;persist();
  }
  async function readEffortForecast(){
    capture();const state=session.effortPlanning,forecastId=state.forecastId,epoch=++generation;
    if(!forecastId)throw new Error('Select the complete original saved forecast.');
    await reloadCase();if(!own(epoch))return;
    const forecast=await api(prefix+'/forecasts/'+forecastId);
    if(!own(epoch)||state.forecastId!==forecastId)return;
    if(forecast.id!==forecastId||!Array.isArray(forecast.inputs?.commercial))throw new Error('Reopen the complete original saved forecast.');
    state.forecast=forecast;state.installationChoices=list().map(row=>({id:row.id,name:row.name,revision:row.revision,sha256:row.sha256}));
    state.name=state.name||'Reviewed delivery effort — '+forecast.inputs.name;
    const tasks=new Set(forecast.inputs.commercial.map(row=>row.id)),ids=new Set(state.installationChoices.map(row=>row.id));
    state.taskInstallations=Object.fromEntries(Object.entries(state.taskInstallations||{}).filter(([id,installation])=>tasks.has(id)&&ids.has(installation)));
    const selected=selectedRow?.preview.document.workshare;
    if(selected&&selectedRow.preview.report.effort?.readyForPlanning){
      const task=forecast.inputs.commercial.find(row=>row.caseRef===selected.caseId&&
        (row.sourceIds||[]).some(id=>id===selected.sourceId||caseValue.sources.find(source=>source.id===id)?.sha256===selected.sourceSha256));
      if(task&&!state.taskInstallations[task.id])state.taskInstallations[task.id]=selectedRow.id;
    }
    session.notice='Opened the complete original forecast and current installation edition choices.';
    persist();
  }
  async function openEffortForecast(){
    capture();const state=session.effortPlanning;
    if(!state.forecast||state.forecast.id!==state.forecastId)throw new Error('Read the selected saved forecast first.');
    const original=copy(state),chosen=Object.entries(original.taskInstallations||{}).filter(([,id])=>id);
    if(!chosen.length)throw new Error('Select at least one original customer task and reviewed installation.');
    if(new Set(chosen.map(([,id])=>id)).size!==chosen.length)throw new Error('Select each installation for one original customer task.');
    const epoch=++generation;await reloadCase();if(!own(epoch))return;
    const selected=chosen.map(([id,installationId])=>{
      const picked=original.installationChoices.find(row=>row.id===installationId),head=list().find(row=>row.id===installationId);
      if(!picked||!head||head.revision!==picked.revision||(picked.sha256&&head.sha256!==picked.sha256))
        throw new Error('An installation changed after the forecast was read. Read saved forecast again to review the current editions.');
      return {taskId:'commercial/'+id,picked};
    });
    const editions=await Promise.all(selected.map(item=>api(prefix+'/installations/'+item.picked.id+'?revision='+item.picked.revision)));
    if(!own(epoch))return;
    const installationSelections=editions.map((row,index)=>{
      const item=selected[index];
      if(row.id!==item.picked.id||row.revision!==item.picked.revision||(item.picked.sha256&&row.sha256!==item.picked.sha256))
        throw new Error('Reopen the exact selected Installation edition.');
      return {taskId:item.taskId,installationId:row.id,installationRevision:row.revision,installationSha256:row.sha256};
    });
    const result=await api(prefix+'/installation-effort-selection',{expectedVersion:caseValue.program.version,
      forecastId:original.forecastId,installationSelections,name:original.name,note:original.note});
    if(!own(epoch))return;
    capture();
    if(state.forecastId!==original.forecastId||!same(state.taskInstallations,original.taskInstallations)||
      state.name!==original.name||state.note!==original.note)
      throw new Error('Your later forecast choices are retained. Open the remaining-work forecast again with those current choices.');
    const received=result.selection?.installationSelections;
    if(result.source?.caseId!==caseId||result.selection?.forecastId!==original.forecastId||
      result.selection.forecastSha256!==original.forecast.sha256||!Array.isArray(received)||received.length!==installationSelections.length||
      !installationSelections.every(item=>received.some(row=>['taskId','installationId','installationRevision','installationSha256'].every(key=>row[key]===item[key])))||
      !Array.isArray(result.inputs?.commercial))throw new Error('Reopen the complete reviewed phase-effort handover.');
    state.lastSelection=copy(result.selection);persist();
    if(onForecastInputs)await onForecastInputs(copy(result.inputs),copy(result.selection));
    else saveDownload(JSON.stringify(result,null,2)+'\n','installation-remaining-work-forecast.json');
    session.notice='Prepared the complete forecast with the selected reviewed phase estimates.';
  }
  async function newDraft(){
    capture();const epoch=++generation,seeded=await api(prefix+'/installation-seed',{expectedVersion:caseValue.program.version});
    if(!own(epoch))return;
    const key='new';
    if(!session.drafts[key])session.drafts[key]={key,token:crypto.randomUUID(),installationId:null,expectedRevision:0,
      document:seeded.document,note:'',dirty:false};
    session.draftKey=key;session.mode='edit';session.selected=null;selectedRow=null;preview=null;previewDraft=null;persist();
  }
  async function editSaved({exactEdition=false}={}){
    if(session.pending||session.accepted||session.inflight)
      throw new Error('Recover the original saved request before opening another installation draft.');
    if(!editable())throw new Error('Reopen the operating case to change its installation.');
    const row=selectedRow;if(!row)return;
    const epoch=++generation,existing=session.drafts[row.id];
    await reloadCase();if(!own(epoch))return;
    const latest=list().find(item=>item.id===row.id);
    if(!latest)throw new Error('The current saved installation is unavailable.');
    if(exactEdition){
      const retained=Object.entries(session.drafts).find(([,value])=>value.installationId===row.id&&
        value.sourceEdition?.id===row.id&&value.sourceEdition.revision===row.revision&&value.sourceEdition.sha256===row.sha256);
      if(retained){
        session.draftKey=retained[0];session.mode='edit';preview=null;previewDraft=null;
        session.notice='Reopened your retained draft from Installation edition '+row.revision+'. Its later edits remain available.'+
          (retained[1].expectedRevision!==latest.revision?' The current saved head is edition '+latest.revision+'; review its history before saving the next edition.':'');
        persist();return;
      }
    }else if(existing){session.draftKey=row.id;session.mode='edit';preview=null;previewDraft=null;persist();return;}
    const key=existing?'calendar-'+crypto.randomUUID():row.id;
    session.drafts[key]={key,token:crypto.randomUUID(),installationId:row.id,expectedRevision:latest.revision,
      sourceEdition:{id:row.id,revision:row.revision,sha256:row.sha256},
      document:copy(row.preview.document),note:'',dirty:false,
      ...(exactEdition?{label:row.preview.document.name+' · source edition '+row.revision}:{})};
    session.draftKey=key;session.mode='edit';preview=null;previewDraft=null;
    session.notice=(row.revision===latest.revision?'Opened the saved installation as an editable draft.':
      'Opened historical edition '+row.revision+' as a draft for the current installation. Its next save appends edition '+(latest.revision+1)+'.')+
      (existing?' Your other edited Installation draft remains in Retained drafts.':'');
    persist();
  }
  async function previewDraftInput(){
    capture();const value=draft();if(!value)return;
    if(hasUnappliedEffortReviews(value))throw new Error('Apply your entered remaining-hour reviews before reviewing the complete installation.');
    const epoch=generation,original=copy(value);
    const result=await api(prefix+'/installation-preview',{expectedVersion:caseValue.program.version,
      installationId:original.installationId,expectedRevision:original.expectedRevision,document:original.document});
    if(!own(epoch)||draft()?.token!==original.token||draft().installationId!==original.installationId||
      draft().expectedRevision!==original.expectedRevision||!same(draft().document,original.document))return;
    if(value.effortContext&&result.report?.effort)value.effortContext.report=copy(result.report);
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
      const laterEdits=!same(matching.document,original.document)||matching.note!==original.note||hasUnappliedEffortReviews(matching);
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
    if(!value||!preview||hasUnappliedEffortReviews(value)||session.pending||session.accepted||previewDraft?.installationId!==value.installationId||
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
    if(event.target.matches('[data-effort-planning-field]')){captureInstallationEffortPlanning(root,session.effortPlanning);persist();controls();}
    if(event.target.matches('[data-installation-field],[data-installation-coordination],[data-installation-note],[data-use-field],[data-use-pattern],[data-installation-effort-field],[data-commissioning-field],[data-commissioning-ui],[data-commissioning-decision],[data-commissioning-review-select],[data-commissioning-output],[data-commissioning-call]')){capture();controls();}
    if(event.target.matches('[data-installation-filter]')){session.filter=event.target.value;const start=event.target.selectionStart;render();const input=$('[data-installation-filter]');input.focus();try{input.setSelectionRange(start,start);}catch{}}
  });
  root.addEventListener('change',event=>{
    if(event.target.matches('[data-effort-planning-field]')){
      const key=event.target.dataset.effortPlanningField;
      captureInstallationEffortPlanning(root,session.effortPlanning);
      if(key==='forecastId'){session.effortPlanning.forecast=null;session.effortPlanning.taskInstallations={};}
      persist();render();return;
    }
    if(event.target.matches('[data-installation-effort-field]')){
      capture();if(event.target.tagName==='SELECT')render();else controls();return;
    }
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
    if(event.target.matches('[data-workshare-field]')){
      capture();
      const key=event.target.dataset.workshareField;
      session.workshareIntake[key]=event.target.value;
      if(key==='sourceId'||key==='packetSourceId'){workshareInventory=null;session.workshareIntake.caseId='';}
      persist();render();return;
    }
    if(event.target.matches('[data-installation-field],[data-installation-coordination],[data-use-field],[data-use-pattern],[data-commissioning-field],[data-commissioning-ui],[data-commissioning-decision],[data-commissioning-review-select],[data-commissioning-output],[data-commissioning-call]')){
      capture();
      if(event.target.dataset.usePattern==='buyerDeploymentIds'||event.target.dataset.usePattern==='mode')render();
      else controls();
    }
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
      if(action==='effort-planning-show')return showEffortPlanning();
      if(action==='effort-planning-close'){capture();session.effortPlanning.open=false;persist();return;}
      if(action==='effort-planning-read')return readEffortForecast();
      if(action==='effort-planning-open')return openEffortForecast();
      if(action==='effort-read')return readCurrentEffort();
      if(action==='effort-apply-reviews')return applyRemainingReviews();
      if(action==='effort-rebind'||action==='effort-rebind-support')return rebindEffort(action,target);
      if(action.startsWith('effort-')){
        capture();const value=draft();if(!value||!editable())return;
        changeInstallationEffort(value,action,target,recordingActor());preview=null;previewDraft=null;persist();return;
      }
      if(action==='queued-open'&&session.requestOpen)return openQueueRequest(session.requestOpen);
      if(action==='new')return newDraft();
      if(action==='source-open'){capture();persist();const view=ensureSourceDesk();await view.open();return;}
      if(action==='gravitee-open'){capture();persist();const view=ensureGraviteeDesk();await view.open();return;}
      if(action==='workflow-open')return openWorkflow();
      if(action==='workflow-close'){capture();session.workflowIntake.open=false;persist();return;}
      if(action==='workflow-sources'){capture();persist();onSources?.();return;}
      if(action==='workflow-read')return readWorkflows();
      if(action==='workflow-prepare')return prepareWorkflow();

      if(action==='commercial-open'){capture();session.commercialOpen=true;ensureCommercial();persist();commercialView.refresh();commercialRoot.hidden=false;commercialRoot.scrollIntoView({block:'start'});return;}
      if(action==='workshare-open')return openWorkshare();
      if(action==='workshare-close'){capture();session.workshareIntake.open=false;persist();return;}
      if(action==='workshare-sources'){capture();persist();onSources?.();return;}
      if(action==='workshare-read')return readWorkshares();
      if(action==='workshare-prepare')return prepareWorkshare();
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
      if(action.startsWith('commissioning-')){
        const originalDocument=copy(value.document),originalUI=copy(value.commissioningUI??{}),workingUI=copy(originalUI);
        const identity={key:value.key,token:value.token,installationId:value.installationId,expectedRevision:value.expectedRevision};
        const workingDocument=copy(originalDocument);
        const result=await commissioningAction(action,target,{document:workingDocument,context:caseValue,ui:workingUI,api,prefix,
          expectedVersion:caseValue.program.version,installationId:value.installationId,expectedRevision:value.expectedRevision,actor:recordingActor()});
        const next=result.document||workingDocument;
        if(value.token!==identity.token||!same(value.document,originalDocument)){
          if(!same(next,originalDocument)){
            const key='commissioning-'+crypto.randomUUID();
            session.drafts[key]={key,token:crypto.randomUUID(),installationId:identity.installationId,expectedRevision:identity.expectedRevision,
              document:copy(next),commissioningUI:workingUI,note:'',dirty:true,label:'Customer commissioning preparation'};
            session.notice='Kept the complete commissioning result as a separate retained draft. Your later form edits remain open.';
          }
        }else{
          value.document=copy(next);value.dirty=true;
          if(same(value.commissioningUI??{},originalUI))value.commissioningUI=workingUI;
          if(result.message)session.notice=result.message;
        }
        preview=null;previewDraft=null;persist();return;
      }
      if(action==='use-calendar-disable'&&value.document.commissioning)
        throw new Error('Remove or retain the commissioning correspondence explicitly before removing its customer-use calendar.');
      if(action.startsWith('use-calendar-')){
        const originalDocument=copy(value.document),originalUI=copy(value.calendarUI??{}),workingUI=copy(originalUI);
        const workingDocument=copy(originalDocument),identity={key:value.key,token:value.token,installationId:value.installationId,expectedRevision:value.expectedRevision};
        const result=await useCalendarAction(action,target,{document:workingDocument,context:caseValue,ui:workingUI,api,prefix,expectedVersion:caseValue.program.version});
        const next=result.document||workingDocument;
        if(value.token!==identity.token||!same(value.document,originalDocument)){
          if(!same(next,originalDocument)){
            const key='calendar-'+crypto.randomUUID();
            session.drafts[key]={key,token:crypto.randomUUID(),installationId:identity.installationId,expectedRevision:identity.expectedRevision,
              document:copy(next),calendarUI:workingUI,note:'',dirty:true,label:'Customer-use expansion'};
            session.notice='Kept the complete calendar result as a separate retained draft. Your later form edits remain open.';
          }
        }else{
          value.document=copy(next);value.dirty=true;
          if(same(value.calendarUI??{},originalUI))value.calendarUI=workingUI;
          if(result.message)session.notice=result.message;
        }
        preview=null;previewDraft=null;persist();return;
      }
      if(action==='add-facilitator')value.document.payment.facilitators.push({operatorId:'',endpoint:'',sourceIds:[],note:''});
      if(action==='remove-facilitator')value.document.payment.facilitators.splice(Number(target.dataset.index),1);
      if(action==='add-check')value.document.checks.push({id:'step-'+crypto.randomUUID().slice(0,8),title:'New acceptance step',criterion:'',
        tranche:null,required:true,state:'OPEN',operator:'',observedAt:null,note:'',sourceIds:[],workIds:[],purchaseIds:[],outcomeIds:[]});
      if(action==='remove-check'){
        const index=Number(target.dataset.index),check=value.document.checks[index];
        if(value.document.commercial?.taskChecks.some(row=>row.checkId===check?.id))
          throw new Error('Receive the accepted later quotation to change its original task checks.');
        if(workflowBoundCheck(value.document,check))
          throw new Error('Receive the complete original customer periods to update their acceptance steps.');
        if(value.document.workshare?.phaseChecks.some(row=>row.checkId===check?.id))
          throw new Error('Receive the revised original Workshare to change its commercial phases.');
        value.document.checks.splice(index,1);
        if(value.document.coordination){
          value.document.coordination.steps=value.document.coordination.steps.filter(row=>row.checkId!==check.id)
            .map(row=>({...row,dependsOn:row.dependsOn.filter(id=>id!==check.id)}));
        }
      }
      value.dirty=true;preview=null;previewDraft=null;persist();
    });
  });
  async function openQueueRequest(request){
    if(!request.id){delete session.requestOpen;persist();render();return;}
    if(!Number.isSafeInteger(request.revision)||request.revision<1)
      throw new Error('Refresh the delivery queue and select the original saved edition.');
    persist();
    await reloadCase();if(!available())return;
    const head=list().find(row=>row.id===request.id);
    if(!head)throw new Error('Refresh the delivery queue to reopen the current installation.');
    const exactCalendar=request.focusUseCalendar===true,revision=request.edit&&!exactCalendar?head.revision:request.revision;
    await openEdition(request.id,revision);
    if(!available()||session.requestOpen!==request||selectedRow?.id!==request.id||selectedRow.revision!==revision)return;
    if(request.edit&&caseValue.program.state==='OPEN'){
      // Calendar requests carry an explicit source edition; the delivery queue retains its current-head workflow.
      await editSaved({exactEdition:exactCalendar});if(!available())return;
      if(!exactCalendar)session.notice=draft()?.expectedRevision!==head.revision?
        'Reopened your retained draft. The installation has a newer saved edition; keep your edits and review the current edition before saving.':
        request.revision!==head.revision?'The installation changed after the queue was read. Opened current edition '+head.revision+' for delivery planning.':
        'Opened the installation delivery assignment. Review and save the complete edition when ready.';
    }else if(request.edit)session.notice='This operating case is closed. Opened the selected saved edition for review.';
    delete session.requestOpen;persist();render();
    if(request.focusUseCalendar){
      const target=$('[data-use-editor]')||$('[data-installation-editor]')||root;
      target.scrollIntoView({block:'start'});target.querySelector('[data-use-field],button')?.focus({preventScroll:true});
    }else if(session.mode==='edit')focusCoordination(request.taskId);
  }
  async function initialize(){
    if(session.inflight)await session.inflight.catch(()=>{});
    if(session.accepted){await acceptReadback();return;}
    if(session.requestOpen){
      if(session.pending){session.notice='Recover the retained installation save to continue the selected delivery assignment.';persist();render();return;}
      await openQueueRequest(session.requestOpen);return;
    }
    if(session.mode==='edit'&&draft()){render();return;}
    const selected=session.selected;
    if(selected?.id){await openEdition(selected.id,selected.revision??undefined);return;}
    if(list().length)await openEdition(list()[0].id,list()[0].revision);
    else render();
  }
  render();
  const ready=initialize().catch(error=>{failure(error);});
  return {ready,setHostBusy(value){hostBusy=!!value;controls();commercialView?.refresh();sourceView?.setHostBusy(hostBusy||busy||!!session.inflight);graviteeView?.setHostBusy(hostBusy||busy||!!session.inflight);},
    dispose(){capture();active=false;++generation;commercialView?.destroy();sourceView?.dispose();graviteeView?.dispose();persist();}};
}
