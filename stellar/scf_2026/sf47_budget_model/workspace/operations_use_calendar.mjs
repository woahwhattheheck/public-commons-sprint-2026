const SCHEMA='stellar-forge.sf47-customer-use-calendar.v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>JSON.parse(JSON.stringify(value));
const title=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const today=()=>new Date().toISOString().slice(0,10);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const modes=['PURCHASE','ALLOWANCE_USE','REOPEN','FREE_USE'];
function options(values,selected){
  return values.map(([value,label])=>'<option value="'+esc(value)+'"'+
    ((Array.isArray(selected)?selected.includes(String(value)):String(selected??'')===String(value))?' selected':'')+'>'+esc(label)+'</option>').join('');
}
function field(label,path,value,{choices,multiple=false,type='text',area=false,wide=false,max=4000,pattern=false,help=''}={}){
  const attribute=pattern?'data-use-pattern':'data-use-field';
  const input=choices?'<select '+attribute+'="'+esc(path)+'"'+(multiple?' multiple size="4"':'')+'>'+options(choices,value)+'</select>':
    area?'<textarea '+attribute+'="'+esc(path)+'" rows="3" maxlength="'+max+'">'+esc(value)+'</textarea>':
    '<input '+attribute+'="'+esc(path)+'" type="'+type+'" value="'+esc(value)+'"'+(type==='text'?' maxlength="'+max+'"':'')+'>';
  return '<label'+(wide?' class="use-wide"':'')+'><span>'+esc(label)+'</span>'+input+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
}
function action(label,name,extra='',disabled=false){
  return '<button type="button" data-installation-action="use-calendar-'+name+'" '+extra+(disabled?' disabled data-installation-fixed="true"':'')+'>'+esc(label)+'</button>';
}
function table(headings,values){
  return '<div class="use-table"><table><thead><tr>'+headings.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+
    (values.length?values.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join(''):
      '<tr><td colspan="'+headings.length+'">No rows in this selection.</td></tr>')+'</tbody></table></div>';
}
function assign(value,path,selected){
  const parts=path.split('.');let parent=value;
  for(const part of parts.slice(0,-1))parent=parent[part];
  parent[parts.at(-1)]=selected;
}
function stylesheet(){
  if(document.querySelector('link[data-customer-use-style]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='/operations_use_calendar.css';
  link.dataset.customerUseStyle='true';document.head.append(link);
}
function download(body,name,type='application/json'){
  const blob=body instanceof Blob?body:new Blob([body],{type}),url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function pager(group,values,ui,size){
  const pages=Math.max(1,Math.ceil(values.length/size)),page=Math.min(Math.max(0,ui[group+'Page']||0),pages-1);
  ui[group+'Page']=page;
  return {rows:values.slice(page*size,(page+1)*size).map((row,i)=>({row,index:page*size+i})),
    html:'<div class="use-pager"><span>'+values.length+' complete rows · page '+(page+1)+' of '+pages+'</span>'+
      action('Previous','page','data-use-group="'+group+'" data-use-page="'+(page-1)+'"',page===0)+
      action('Next','page','data-use-group="'+group+'" data-use-page="'+(page+1)+'"',page+1===pages)+'</div>'};
}

export function captureUseCalendar(root,documentValue,ui={}){
  const value=documentValue.useCalendar;
  if(value)for(const input of root.querySelectorAll('[data-use-field]')){
    let selected=input.multiple?[...input.selectedOptions].map(row=>row.value):input.value;
    if(input.dataset.useField==='tranche')selected=selected===''?null:Number(selected);
    assign(value,input.dataset.useField,selected);
  }
  const generator=root.querySelector('.use-generator');if(generator)ui.patternOpen=generator.open;
  const pattern=ui.pattern??={};
  for(const input of root.querySelectorAll('[data-use-pattern]')){
    const name=input.dataset.usePattern;
    let selected=input.multiple?[...input.selectedOptions].map(row=>row.value):input.type==='checkbox'?input.checked:input.value;
    if(name==='weekdays')selected=selected.map(Number);
    if(name==='includeDates'||name==='excludeDates')selected=selected.split(/[\s,]+/).filter(Boolean);
    if(name.startsWith('fundingByBuyer.')){
      pattern.fundingByBuyer??={};pattern.fundingByBuyer[name.slice(15)]=selected;
    }else pattern[name]=selected;
  }
  const selectedBuyers=new Set(pattern.buyerDeploymentIds||[]);
  pattern.fundingByBuyer=Object.fromEntries(Object.entries(pattern.fundingByBuyer||{}).filter(([id])=>selectedBuyers.has(id)));
}
export function useCalendarFields(documentValue,context,ui={}){
  stylesheet();
  const value=documentValue.useCalendar;
  if(!value)return '<fieldset class="use-editor" data-use-editor><legend>Customer-use calendar</legend>'+
    '<p>Save the ordinary dates on which each buyer needs a useful result. Keep prepaid funding separate from allowance use and reopening.</p>'+
    action('Add customer-use calendar','enable')+'</fieldset>';
  const sources=context.sources.map(row=>[row.id,row.filename+' · '+row.sha256.slice(0,10)]);
  const buyers=documentValue.buyerDeploymentIds.map(id=>{
    const row=context.records.deployments.find(item=>item.id===id);return [id,(row?.name||id)+' · '+(row?.operatorId||'operator identity unentered')];
  });
  const tasks=value.tasks.map(row=>[row.id,row.name||row.id]);
  const funds=value.settlements.map(row=>[row.id,row.date+' · '+title(row.kind)+' · '+(tasks.find(([id])=>id===row.taskId)?.[1]||row.taskId)+' · '+(buyers.find(([id])=>id===row.buyerDeploymentId)?.[1]||row.buyerDeploymentId)]);
  const receipts=context.records.purchases.map(row=>[row.id,(row.operationId||row.intentId||row.id)+' · '+row.settlementStatus+'/'+row.outputStatus+' · '+row.amountStroops+' '+row.asset]);
  const f=(label,path,settings={})=>field(label,path,path.split('.').reduce((out,key)=>out[key],value),settings);
  let html='<fieldset class="use-editor" data-use-editor><legend>Customer-use calendar</legend>'+
    '<p>These are editable planned uses. The original receipt and Cohort review determine actual payment and completion. Saving appends an Installation edition.</p><div class="use-fields">'+
    f('Calendar name','name',{wide:true,max:500})+
    f('First UTC calendar date','startDate',{type:'date'})+f('Last UTC calendar date','endDate',{type:'date'})+
    f('Original proposed tranche','tranche',{choices:[['','No tranche comparison'],['2','Tranche 2'],['3','Tranche 3']]})+
    f('Original business-use source files','sourceIds',{choices:sources,multiple:true,wide:true})+
    f('Ordinary use, working days and exceptions','note',{area:true,wide:true,max:8000})+'</div>';
  const taskPage=pager('tasks',value.tasks,ui,5);
  html+='<h4>Complete useful tasks</h4><p>Different requests need a real difference in source, purpose or whole output. A page or retry does not by itself define another customer task.</p>'+taskPage.html;
  for(const {row,index} of taskPage.rows){
    const prefix='tasks.'+index+'.';
    html+='<details class="use-row" open><summary>'+esc(row.name||'Useful task')+'<small>'+esc(row.id)+'</small></summary><div class="use-fields">'+
      f('Task name',prefix+'name',{max:500})+f('Customer purpose',prefix+'purpose',{area:true})+
      f('Complete original request',prefix+'request',{area:true,wide:true})+
      f('What completes the whole useful output',prefix+'completeOutput',{area:true,wide:true})+
      f('What makes another result useful',prefix+'repeatTrigger',{area:true})+
      f('Original priced unit',prefix+'pricedUnit')+
      f('Task source files',prefix+'sourceIds',{choices:sources,multiple:true,wide:true})+'</div>'+
      action('Remove task','remove-task','data-use-index="'+index+'"')+'</details>';
  }
  html+=action('Add useful task','add-task','',value.tasks.length>=80);
  const fundingPage=pager('settlements',value.settlements,ui,10);
  html+='<h4>Planned settlements and original buyer receipts</h4><p>One group represents one intended payment identity. A prepaid group can fund many allowance uses. Link actual native purchase observations after receiving their original source.</p>'+fundingPage.html;
  for(const {row,index} of fundingPage.rows){
    const prefix='settlements.'+index+'.';
    html+='<details class="use-row"><summary>'+esc(row.date)+' · '+esc(title(row.kind))+' · '+esc(tasks.find(([id])=>id===row.taskId)?.[1]||row.taskId)+
      '<small>'+esc(row.id)+' · '+row.purchaseIds.length+' original receipt links</small></summary><div class="use-fields">'+
      f('Buyer deployment',prefix+'buyerDeploymentId',{choices:buyers})+f('Useful task',prefix+'taskId',{choices:tasks})+
      f('Planned settlement date',prefix+'date',{type:'date'})+f('Funding kind',prefix+'kind',{choices:[['DIRECT','Direct purchase'],['PREPAID','Prepaid pass or allowance']]})+
      f('Original buyer receipt observations',prefix+'purchaseIds',{choices:receipts,multiple:true,wide:true})+
      f('Original funding and receipt source files',prefix+'sourceIds',{choices:sources,multiple:true,wide:true})+
      f('Association and commercial source',prefix+'note',{area:true,wide:true})+'</div>';
    for(const id of row.purchaseIds){
      const receipt=context.records.purchases.find(item=>item.id===id);
      html+='<details><summary>Original receipt '+esc(id)+'</summary><pre>'+esc(JSON.stringify(receipt??{id,unavailable:true},null,2))+'</pre></details>';
    }
    html+=action('Remove funding group','remove-settlement','data-use-index="'+index+'"')+'</details>';
  }
  html+=action('Add funding group','add-settlement','',value.settlements.length>=500);
  const pattern=ui.pattern??={};
  for(const [key,initial] of Object.entries({id:'ordinary-use',taskIds:tasks.slice(0,1).map(([id])=>id),buyerDeploymentIds:buyers.map(([id])=>id),
    weekdays:[0,1,2,3,4],includeDates:[],excludeDates:[],mode:'PURCHASE',fundingByBuyer:{},replacePattern:false}))
    if(!Object.hasOwn(pattern,key))pattern[key]=initial;
  const pf=(label,path,value,settings={})=>field(label,path,value,{...settings,pattern:true});
  html+='<details class="use-generator"'+(ui.patternOpen?' open':'')+'><summary>Expand ordinary working dates</summary><p>The expansion creates explicit editable rows. It executes no request or payment. Reusing the same pattern preserves existing rows unless you explicitly select replacement.</p><div class="use-fields">'+
    pf('Retained pattern ID','id',pattern.id,{max:120})+
    pf('Useful tasks','taskIds',pattern.taskIds,{choices:tasks,multiple:true})+
    pf('Original buyers','buyerDeploymentIds',pattern.buyerDeploymentIds,{choices:buyers,multiple:true})+
    pf('Working weekdays','weekdays',pattern.weekdays?.map(String),{choices:['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((name,index)=>[String(index),name]),multiple:true})+
    pf('Use mode','mode',pattern.mode,{choices:modes.map(mode=>[mode,title(mode)])})+
    pf('Include these extra dates','includeDates',(pattern.includeDates||[]).join('\n'),{area:true,help:'YYYY-MM-DD; one date per line.'})+
    pf('Exclude these holidays or unavailable dates','excludeDates',(pattern.excludeDates||[]).join('\n'),{area:true,help:'Explicit selected dates; the application does not assume a jurisdiction’s holidays.'});
  for(const [buyerId,label] of buyers.filter(([id])=>(pattern.buyerDeploymentIds||[]).includes(id))){
    html+=pf('Prepaid funding for '+label,'fundingByBuyer.'+buyerId,pattern.fundingByBuyer?.[buyerId]||[],
      {choices:value.settlements.filter(row=>row.kind==='PREPAID'&&row.buyerDeploymentId===buyerId).map(row=>[row.id,row.date+' · '+row.id]),multiple:true,wide:true});
  }
  html+='</div><label class="use-check"><input type="checkbox" data-use-pattern="replacePattern"'+(pattern.replacePattern?' checked':'')+'>Replace this pattern’s dated rows; other patterns and saved editions remain.</label>'+
    action('Prepare dated uses','expand')+'</details>';
  const usePage=pager('entries',value.entries,ui,20);
  html+='<h4>Dated useful results</h4>'+usePage.html;
  for(const {row,index} of usePage.rows){
    const prefix='entries.'+index+'.';
    html+='<details class="use-row"><summary>'+esc(row.date)+' · '+esc(title(row.mode))+' · '+esc(tasks.find(([id])=>id===row.taskId)?.[1]||row.taskId)+
      '<small>'+esc(row.state)+' · '+esc(row.id)+'</small></summary><div class="use-fields">'+
      f('Date of useful result',prefix+'date',{type:'date'})+f('Buyer deployment',prefix+'buyerDeploymentId',{choices:buyers})+
      f('Complete useful task',prefix+'taskId',{choices:tasks})+
      f('Use mode',prefix+'mode',{choices:modes.map(mode=>[mode,title(mode)])})+
      f('Plan state',prefix+'state',{choices:[['PLANNED','Planned'],['CANCELLED','Cancelled']]})+
      f('Selected funding groups',prefix+'fundingIds',{choices:funds,multiple:true,wide:true})+
      f('Actual selected source period or edition',prefix+'sourcePeriod',{wide:true,max:2000})+
      f('Original use and output sources',prefix+'sourceIds',{choices:sources,multiple:true,wide:true})+
      f('Useful result and correction note',prefix+'note',{area:true,wide:true})+'</div>'+
      action('Remove dated row from this draft','remove-entry','data-use-index="'+index+'"')+'</details>';
  }
  html+=action('Add dated useful result','add-entry','',value.entries.length>=500)+
    '<div class="use-danger">'+action('Remove calendar from this draft','disable')+'</div></fieldset>';
  return html;
}
export async function useCalendarAction(name,target,{document:documentValue,context,ui,api,prefix,expectedVersion}){
  const actionName=name.replace(/^use-calendar-/,'');
  if(actionName==='enable'){
    const targetRule=context.plan.scenario.deployment_acceptance_plan?.targets?.find(row=>row.tranche===2);
    const days=targetRule?.proposed_window?.consecutive_calendar_days||14,start=today(),end=new Date(start+'T00:00:00Z');
    end.setUTCDate(end.getUTCDate()+days-1);
    documentValue.useCalendar={schema:SCHEMA,name:documentValue.name+' customer use',tranche:targetRule?2:null,
      startDate:start,endDate:end.toISOString().slice(0,10),sourceIds:[...documentValue.source.sourceIds],note:'',
      tasks:[{id:'task-'+crypto.randomUUID(),name:documentValue.task.name||'Useful customer task',
        purpose:documentValue.task.purpose,request:documentValue.task.request,completeOutput:documentValue.task.completeOutput,
        repeatTrigger:documentValue.task.repeatTrigger,pricedUnit:documentValue.task.pricedUnit,sourceIds:[...documentValue.source.sourceIds]}],
      settlements:[],entries:[]};return {message:'Customer-use calendar added to the editable Installation.'};
  }
  if(actionName==='disable'){delete documentValue.useCalendar;return {message:'Calendar removed from this draft. Original saved editions retain it.'};}
  const value=documentValue.useCalendar;if(!value)throw new Error('Open the customer-use calendar first.');
  if(actionName==='page'){ui[target.dataset.useGroup+'Page']=Number(target.dataset.usePage);return {};}
  if(actionName==='add-task'){value.tasks.push({id:'task-'+crypto.randomUUID(),name:'Useful task',purpose:'',request:'',completeOutput:'',repeatTrigger:'',pricedUnit:'',sourceIds:[]});ui.tasksPage=Math.floor((value.tasks.length-1)/5);return {};}
  if(actionName==='remove-task'){
    const row=value.tasks[Number(target.dataset.useIndex)];
    if(value.entries.some(item=>item.taskId===row.id)||value.settlements.some(item=>item.taskId===row.id))throw new Error('Reassign this task’s dated uses and funding groups before removing its definition.');
    value.tasks.splice(Number(target.dataset.useIndex),1);return {};
  }
  if(actionName==='add-settlement'){
    value.settlements.push({id:'fund-'+crypto.randomUUID(),buyerDeploymentId:documentValue.buyerDeploymentIds[0]||'',
      taskId:value.tasks[0]?.id||'',date:value.startDate,kind:'DIRECT',purchaseIds:[],sourceIds:[],note:'',patternId:null});
    ui.settlementsPage=Math.floor((value.settlements.length-1)/10);return {};
  }
  if(actionName==='remove-settlement'){
    const row=value.settlements[Number(target.dataset.useIndex)];
    if(value.entries.some(item=>item.fundingIds.includes(row.id)))throw new Error('Reassign this funding group’s dated uses before removing the group.');
    value.settlements.splice(Number(target.dataset.useIndex),1);return {};
  }
  if(actionName==='add-entry'){
    const buyer=documentValue.buyerDeploymentIds[0]||'',fund=value.settlements.find(row=>row.buyerDeploymentId===buyer&&row.kind==='DIRECT'&&row.date<=value.startDate);
    value.entries.push({id:'use-'+crypto.randomUUID(),buyerDeploymentId:buyer,taskId:value.tasks[0]?.id||'',
      date:value.startDate,state:'PLANNED',mode:'PURCHASE',fundingIds:fund?[fund.id]:[],sourcePeriod:'',sourceIds:[],note:'',patternId:null});
    ui.entriesPage=Math.floor((value.entries.length-1)/20);return {};
  }
  if(actionName==='remove-entry'){value.entries.splice(Number(target.dataset.useIndex),1);return {};}
  if(actionName==='expand'){
    const original=copy(documentValue),pattern=copy(ui.pattern);
    const selectedBuyers=new Set(pattern.buyerDeploymentIds||[]);
    pattern.fundingByBuyer=Object.fromEntries(Object.entries(pattern.fundingByBuyer||{}).filter(([id])=>selectedBuyers.has(id)));
    const result=await api(prefix+'/customer-use-calendar-expand',{expectedVersion,document:original,pattern});
    if(result.schema!==SCHEMA+'.expansion'||!result.document?.useCalendar)throw new Error('The native date expansion did not return the complete Installation document.');
    return {document:result.document,originalDocument:original,message:'Prepared '+result.generatedIds.length+' explicit dated uses across '+result.dates.length+' selected days. Review and save the whole Installation edition.'};
  }
  throw new Error('Unknown customer-use calendar action.');
}
export function useCalendarReport(value){
  if(!value)return '';
  stylesheet();const counts=value.planned;
  return '<section class="use-report"><h4>'+esc(value.name)+'</h4><div class="use-stats">'+
    [['Planned useful results',counts.datedUses],['Planned settlement groups',counts.plannedSettlementGroups],
     ['Allowance uses',counts.allowanceUses],['Reopened / free results',counts.reopens+' / '+counts.freeUses]].map(([label,count])=>
       '<div><span>'+esc(label)+'</span><strong>'+esc(count)+'</strong></div>').join('')+'</div><p>'+esc(counts.basis)+'</p>'+
    (value.window?'<p>Entered window: '+value.window.calendarDays+' calendar days; original proposal: '+value.window.requiredCalendarDays+'.</p>':'')+
    table(['Original target','Required','Planned potential','Count comparison'],value.targets.map(row=>[
      esc(row.key),esc(row.expected),esc(row.plannedPotential??'Not established by a use calendar'),
      esc(row.countSufficient===null?'Requires its original source review':row.countSufficient?'Planned count sufficient; qualification unreviewed':'Planned count below target')]))+
    (value.findings.length?table(['Source or task','Current decision'],value.findings.map(row=>[esc(row.id||row.field||row.code),esc(row.message)])):'')+
    '<p>'+esc(value.actualPurchaseBasis)+'</p>'+
    table(['Funding group','Planned kind / date','Use rows','Original receipt observations'],value.settlements.map(row=>[
      esc(row.id),esc(title(row.kind)+' · '+row.date),esc(row.uses.length),
      row.receipts.map(item=>esc((item.intentId||item.id)+' · '+item.settlementStatus+'/'+item.outputStatus)).join('<br>')||'No receipt linked']))+'</section>';
}

export function mountCustomerUseCalendar({container,current,api,session,onOpenInstallation,onOpenCohort,onOpenPlanning}){
  stylesheet();const root=document.createElement('section');root.className='customer-use-calendar';root.setAttribute('aria-label','Customer-use calendar');container.replaceChildren(root);
  const caseId=current.program.id,prefix='/api/operations/'+caseId,storageKey='sf47.customer-use.'+caseId;
  let active=true,busy=false,hostBusy=false,generation=0,view=null,error='',notice='';
  const $=selector=>root.querySelector(selector),available=()=>active&&root.isConnected;
  if(!session.initialized){try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved?.caseId===caseId)Object.assign(session,saved);}catch{}session.initialized=true;}
  session.selection??=current.installations.filter(row=>row.useCalendar).map(row=>({id:row.id,revision:row.revision,sha256:row.sha256}));
  session.asOfDate??=today();session.page??=0;session.mode??='';session.search??='';session.date??='';session.groupId??='';
  session.editionChoices??={};
  for(const row of current.installations)if(!Object.hasOwn(session.editionChoices,row.id)){
    const selected=session.selection.find(item=>item.id===row.id);
    session.editionChoices[row.id]={selected:!!selected,revision:String(selected?.revision??row.revision)};
  }
  function persist(){try{sessionStorage.setItem(storageKey,JSON.stringify({caseId,selection:session.selection,editionChoices:session.editionChoices,asOfDate:session.asOfDate,
    page:session.page,mode:session.mode,search:session.search,date:session.date,groupId:session.groupId}));}catch{notice='The browser could not retain this view selection. Download its complete JSON before closing.';}}
  function controls(){root.setAttribute('aria-busy',String(busy||hostBusy));for(const input of root.querySelectorAll('button,input,select'))input.disabled=hostBusy||busy||input.dataset.useFixed==='true';}
  async function run(fn){if(!available()||busy||hostBusy)return;captureSelection();persist();busy=true;error='';controls();try{await fn();}catch(reason){error=reason?.message||String(reason);}finally{busy=false;if(available())render();}}
  function captureSelection(){
    for(const element of root.querySelectorAll('[data-use-select]')){
      const id=element.dataset.useSelect,input=root.querySelector('[data-use-revision="'+CSS.escape(id)+'"]');
      if(input)session.editionChoices[id]={selected:element.checked,revision:input.value};
    }
    const asOf=$('[data-use-asof]');if(asOf)session.asOfDate=asOf.value;
  }
  function selectedRevision(id){
    const head=current.installations.find(row=>row.id===id),raw=session.editionChoices[id]?.revision??'';
    const revision=Number(raw);
    if(!head||!/^\d+$/.test(String(raw))||!Number.isSafeInteger(revision)||revision<1||revision>head.revision)
      throw new Error('Select a saved Installation edition from 1 through '+(head?.revision??'the current edition')+'.');
    return revision;
  }
  function selections(){
    const values=[];for(const head of current.installations)if(session.editionChoices[head.id]?.selected){
      const id=head.id,revision=selectedRevision(id),old=session.selection.find(row=>row.id===id&&row.revision===revision);
      values.push({id,revision,...(old?.sha256?{sha256:old.sha256}:head.revision===revision?{sha256:head.sha256}:{})});
    }return values;
  }
  function selectionChanged(){
    if(!view)return false;
    const selected=current.installations.filter(row=>session.editionChoices[row.id]?.selected)
      .map(row=>({id:row.id,revision:String(session.editionChoices[row.id].revision)})).sort((a,b)=>a.id.localeCompare(b.id));
    return session.asOfDate!==view.asOfDate||!same(selected,view.selection.map(row=>({id:row.id,revision:String(row.revision)})).sort((a,b)=>a.id.localeCompare(b.id)));
  }
  async function read(){
    const epoch=++generation,selection=selections(),asOfDate=session.asOfDate;
    const response=await api(prefix+'/customer-use-calendar',{expectedVersion:current.program.version,installationRefs:selection,asOfDate});
    if(!available()||epoch!==generation)return;
    if(response.schema!==SCHEMA+'.selection'||response.source.caseId!==caseId||response.source.caseVersion!==current.program.version)
      throw new Error('Reopen the original case and selected Installation editions.');
    view=response;session.selection=copy(response.selection);session.asOfDate=asOfDate;
    for(const row of response.selection)session.editionChoices[row.id]={selected:true,revision:String(row.revision)};
    if(!view.groups.some(row=>row.id===session.groupId))session.groupId=view.groups[0]?.id||'';
    persist();
  }
  const choice=()=>view?.groups.find(row=>row.id===session.groupId);
  function viewButton(label,name,extra='',disabled=false){return '<button type="button" data-use-view-action="'+name+'" '+extra+(disabled?' disabled data-use-fixed="true"':'')+'>'+esc(label)+'</button>';}
  function monthGrid(group){
    if(!group)return '';
    const chosen=view.calendars.filter(row=>row.groupId===group.id),byDate=new Map();
    for(const original of chosen){
      const activeUses=original.document.entries.filter(row=>row.state!=='CANCELLED');
      const fundIds=new Set(activeUses.flatMap(row=>row.fundingIds));
      for(const row of activeUses){const cell=byDate.get(row.date)||{uses:0,funding:0};cell.uses++;byDate.set(row.date,cell);}
      for(const row of original.document.settlements)if(fundIds.has(row.id)){const cell=byDate.get(row.date)||{uses:0,funding:0};cell.funding++;byDate.set(row.date,cell);}
    }
    const first=new Date(group.startDate+'T00:00:00Z'),last=new Date(group.endDate+'T00:00:00Z'),before=(first.getUTCDay()+6)%7;
    let cells=Array(before).fill('<div class="use-day use-empty" aria-hidden="true"></div>').join('');
    for(let date=new Date(first);date<=last;date.setUTCDate(date.getUTCDate()+1)){
      const day=date.toISOString().slice(0,10),counts=byDate.get(day)||{uses:0,funding:0};
      cells+='<button type="button" class="use-day'+(session.date===day?' is-selected':'')+'" data-use-view-action="date" data-date="'+day+'"><span>'+esc(day)+'</span><strong>'+counts.uses+' uses</strong><small>'+counts.funding+' planned settlements</small></button>';
    }
    return '<div class="use-weekdays">'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>'<span>'+day+'</span>').join('')+'</div><div class="use-grid">'+cells+'</div>';
  }
  function render(){
    if(!available())return;
    let html='<header class="use-heading"><div><h3>Customer-use calendar</h3><p>Select the saved buyer, useful task and source schedule. Working dates, planned settlements and actual native receipts remain separate.</p></div>'+
      viewButton('Read selected calendars','read')+'</header>'+
      (error?'<p class="use-error" role="alert">'+esc(error)+'</p>':'')+(notice?'<p role="status">'+esc(notice)+'</p>':'')+
      '<details class="use-selection"'+(!view?' open':'')+'><summary>Exact Installation editions</summary><p>Changing the edition selects its complete saved source and schedule. Open the original Installation to edit or inspect history.</p>'+
      table(['Select','Original Installation','Saved edition','Open'],current.installations.map(row=>{
        const item=session.editionChoices[row.id];
        return ['<input type="checkbox" data-use-select="'+esc(row.id)+'"'+(item.selected?' checked':'')+' aria-label="Select '+esc(row.name)+'">',
          esc(row.name)+'<small>'+esc(row.id)+' · current edition '+row.revision+'</small>',
          '<input type="number" min="1" max="'+row.revision+'" data-use-revision="'+esc(row.id)+'" value="'+esc(item.revision)+'" aria-label="Saved edition for '+esc(row.name)+'">',
          viewButton('Edit customer use','edit','data-id="'+esc(row.id)+'"')];
      }))+'<label>Observation date <input type="date" data-use-asof value="'+esc(session.asOfDate)+'"></label></details>'+
      (selectionChanged()?'<p class="use-selection-note" role="status">The edition or observation-date selection has changed. Read selected calendars to update the displayed report, Cohort input and report downloads.</p>':'');
    if(!view){html+='<p>Save a customer-use calendar in an Installation, then read that exact edition here.</p>';root.innerHTML=html;controls();return;}
    const group=choice();
    html+='<div class="use-toolbar"><label>Saved window <select data-use-view-field="groupId">'+options(view.groups.map(row=>[row.id,row.startDate+' through '+row.endDate+' · '+(row.tranche?'tranche '+row.tranche:'ordinary use')]),session.groupId)+'</select></label>'+
      viewButton('Open original Cohort draft','cohort','',!group||group.tranche===null||group.planChanged)+
      viewButton('Plan staffing and pricing','adoption','',!group||group.tranche===null||group.planChanged||!onOpenPlanning)+
      viewButton('JSON','export','data-format="json"')+viewButton('CSV','export','data-format="csv"')+viewButton('Calendar ICS','export','data-format="ics"')+
      viewButton('Complete editable case ZIP','case-export')+'</div>';
    if(group){
      html+='<p>Case version '+view.source.caseVersion+' · '+esc(view.source.mode)+' · selected plan '+esc(group.planContentSha256)+
        (group.planChanged?' · Historical plan: preserve this source; review the current Installation before seeding a current-plan Cohort.':'')+'</p>'+
        useCalendarReport({name:'Planned use in the selected window',planned:group.planned,targets:group.targets,window:group.window,findings:[],settlements:[],actualPurchaseBasis:view.qualification})+
        monthGrid(group);
    }
    html+='<div class="use-toolbar"><label>Use mode <select data-use-view-field="mode">'+options([['','All modes'],...modes.map(mode=>[mode,title(mode)])],session.mode)+'</select></label>'+
      '<label>Task, buyer or original source <input data-use-view-field="search" value="'+esc(session.search)+'"></label>'+
      '<label>Exact date <input type="date" data-use-view-field="date" value="'+esc(session.date)+'"></label>'+
      viewButton('Clear date','clear-date')+'</div>';
    const all=view.calendars.filter(row=>!group||row.groupId===group.id).flatMap(owner=>owner.report.entries.map(entry=>({owner,entry})));
    const search=session.search.toLowerCase(),filtered=all.filter(({owner,entry})=>(!session.mode||entry.mode===session.mode)&&(!session.date||entry.date===session.date)&&
      (!search||[owner.name,entry.task.name,entry.buyer.name,entry.buyer.operatorId,entry.sourcePeriod,entry.note].join(' ').toLowerCase().includes(search))).sort((a,b)=>a.entry.date.localeCompare(b.entry.date)||a.entry.id.localeCompare(b.entry.id));
    const pages=Math.max(1,Math.ceil(filtered.length/25));session.page=Math.min(Math.max(0,session.page),pages-1);
    html+='<h4>Complete dated use rows</h4><p>'+filtered.length+' selected rows. Page '+(session.page+1)+' of '+pages+'.</p>'+
      table(['Date / state','Buyer','Whole useful task','Mode / funding','Source period / edit'],filtered.slice(session.page*25,(session.page+1)*25).map(({owner,entry})=>[
        esc(entry.date)+'<small>'+esc(title(entry.state))+'</small>',
        esc(entry.buyer.name)+'<small>'+esc(entry.buyer.operatorId||'Identity unentered')+'</small>',
        '<details><summary>'+esc(entry.task.name)+'</summary><p>'+esc(entry.task.purpose)+'</p><h5>Complete request</h5><pre>'+esc(entry.task.request)+'</pre><h5>Whole output</h5><p>'+esc(entry.task.completeOutput)+'</p><p>Repeat: '+esc(entry.task.repeatTrigger)+'</p></details>',
        esc(title(entry.mode))+'<small>'+esc(entry.fundingIds.join(', ')||'No new settlement')+'</small>',
        esc(entry.sourcePeriod)+viewButton('Open original edition','open','data-id="'+esc(owner.id)+'" data-revision="'+owner.revision+'"')
      ]))+'<div class="use-pager">'+viewButton('Previous','page','data-page="'+(session.page-1)+'"',session.page===0)+
      viewButton('Next','page','data-page="'+(session.page+1)+'"',session.page+1===pages)+'</div>';
    const changed=view.calendars.filter(row=>row.currentChanges&&Object.values(row.currentChanges).some(items=>items.length));
    if(changed.length)html+='<details><summary>Changes since the selected saved editions</summary>'+
      changed.map(row=>'<h5>'+esc(row.name)+' · edition '+row.revision+'</h5><pre>'+esc(JSON.stringify(row.currentChanges,null,2))+'</pre>').join('')+'</details>';
    html+='<h4>Matched original buyer receipts</h4><p>No date row or allowance call creates a receipt. Read the retained native settlement, output and order separately.</p>'+
      (view.receiptConflicts.length?'<p class="use-error">Some receipts are selected in more than one funding group. Resolve their original association before seeding Cohort.</p>':'')+
      table(['Original identity','Settlement / output / order','Amount','Calendar association / full record'],view.receipts.map(({purchase,bindings,currentAvailable,savedObservations})=>[
        esc(purchase.intentId||purchase.id)+'<small>'+esc(purchase.id)+(currentAvailable?'':' · unavailable in current case; saved observation shown')+'</small>',
        esc(purchase.settlementStatus+'/'+purchase.outputStatus+'/'+purchase.orderStatus),
        esc(purchase.amountStroops)+'<small>'+esc(purchase.asset+' · '+purchase.network)+'</small>',
        bindings.map(row=>esc(row.installationId+' @'+row.revision+' / '+row.fundingId)).join('<br>')+
          '<details><summary>Complete original receipt</summary><pre>'+esc(JSON.stringify(purchase,null,2))+'</pre></details>'+ '<details><summary>Saved edition observations</summary><pre>'+esc(JSON.stringify(savedObservations,null,2))+'</pre></details>'
      ]))+'<details><summary>'+view.unlinkedPurchases.length+' original purchase observations not linked to selected calendar groups</summary>'+
      table(['Receipt','Native states','Original operation'],view.unlinkedPurchases.map(row=>[esc(row.id),esc(row.settlementStatus+'/'+row.outputStatus),esc(row.operationId)]))+'</details>'+
      '<h4>Complete receiving</h4><p>The complete case ZIP retains original records, all Installation editions, source files and saved reviews. Each selected-edition ZIP opens that original Installation after receiving.</p>'+
      view.calendars.map(row=>'<div class="use-receiving"><span>'+esc(row.name)+' · edition '+row.revision+'</span>'+
        viewButton('Complete selected-edition ZIP','installation-export','data-id="'+esc(row.id)+'" data-revision="'+row.revision+'"')+'</div>').join('');
    root.innerHTML=html;controls();
  }
  root.addEventListener('change',event=>{
    captureSelection();
    if(event.target.matches('[data-use-select],[data-use-revision],[data-use-asof]')){persist();render();return;}
    const fieldName=event.target.dataset.useViewField;
    if(fieldName){session[fieldName]=event.target.value;session.page=0;persist();render();}
  });
  root.addEventListener('input',event=>{
    if(event.target.matches('[data-use-select],[data-use-revision],[data-use-asof]')){captureSelection();persist();return;}
    if(event.target.dataset.useViewField==='search'){session.search=event.target.value;session.page=0;persist();}
  });
  root.addEventListener('click',event=>{
    const target=event.target.closest('[data-use-view-action]');if(!target||target.disabled)return;
    const actionName=target.dataset.useViewAction;
    run(async()=>{
      if(actionName==='read'){session.page=0;return read();}
      if(actionName==='edit'||actionName==='open'){
        const id=target.dataset.id,revision=actionName==='edit'?selectedRevision(id):Number(target.dataset.revision);
        persist();onOpenInstallation?.({id,revision,edit:actionName==='edit',focusUseCalendar:true});return;
      }
      if(actionName==='page'){session.page=Number(target.dataset.page);persist();return;}
      if(actionName==='date'){session.date=target.dataset.date;session.page=0;persist();return;}
      if(actionName==='clear-date'){session.date='';session.page=0;persist();return;}
      if(!view)throw new Error('Read the complete selected calendars first.');
      if(actionName==='cohort'||actionName==='adoption'){
        const group=choice();if(!group)throw new Error('Select the original window.');
        const response=await api(prefix+'/customer-use-calendar-cohort',{expectedVersion:current.program.version,
          installationRefs:copy(view.selection),groupId:group.id,asOfAt:new Date().toISOString()});
        if(!available())return;
        if(response.source?.programId!==caseId||response.source.version!==current.program.version||response.customerUse?.groupId!==group.id)
          throw new Error('The returned Cohort draft belongs to a different source selection.');
        if(actionName==='adoption'){onOpenPlanning({calendarSelection:copy(view),nativeSeed:copy(response)});return;}
        if(onOpenCohort)onOpenCohort(response);else download(JSON.stringify(response.inputs,null,2)+'\n',caseId+'-customer-use-cohort-input.json');
        return;
      }
      let url,filename;
      if(actionName==='export'){
        const format=target.dataset.format;url=prefix+'/customer-use-calendar/export.'+format+'?expectedVersion='+current.program.version+
          '&asOfDate='+encodeURIComponent(view.asOfDate)+'&installationRefs='+encodeURIComponent(JSON.stringify(view.selection));
        filename=caseId+'-customer-use.'+format;
      }else if(actionName==='case-export'){url=prefix+'/export.zip';filename=caseId+'-complete-case.zip';}
      else if(actionName==='installation-export'){url=prefix+'/installations/'+encodeURIComponent(target.dataset.id)+'/export.zip?revision='+Number(target.dataset.revision);filename=target.dataset.id+'-edition-'+target.dataset.revision+'.zip';}
      else return;
      const response=await api(url,undefined,{download:true}),blob=await response.blob();if(available())download(blob,filename);
    });
  });
  render();
  const ready=run(read);
  return {ready,setHostBusy(value){hostBusy=!!value;if(available())controls();},
    dispose(){captureSelection();active=false;++generation;persist();}};
}
