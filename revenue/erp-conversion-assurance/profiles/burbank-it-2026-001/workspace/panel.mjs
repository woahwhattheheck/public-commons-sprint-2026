// MIT. Industrial project workspace, mounted by the original conversion operator.
import {newPlan,RESPONSE_CODES,REQUIREMENT_PHASES,DELIVERY_STATES,INTERFACE_OPTIONS,RESOURCE_TYPES,TRIAL_KINDS} from './profile.mjs';
import {responseIssues} from './schema.mjs';
export const panelTitle='Burbank project';
export const applyPlan=(draft,plan)=>({...draft,burbank:plan?structuredClone(plan):null});
export const decorateSpec=(spec,draft)=>({...spec,workspace:{...spec.workspace,burbank:draft.burbank??null}});
export function changeCohort(fresh,prior) {return {...fresh,burbank:prior.burbank?{...prior.burbank,trialId:fresh.cohortId+'-conversion',trialNumber:1,requirementIds:[],interfaceIds:[]}:null};}
const el=(tag,text,attrs={})=>{const e=document.createElement(tag);if(text!==null&&text!==undefined)e.textContent=String(text);for(const[k,v]of Object.entries(attrs)){if(k==='class')e.className=v;else if(k in e)e[k]=v;else e.setAttribute(k,v);}return e;};
const append=(parent,...children)=>{for(const child of children.flat())if(child)parent.append(child);return parent;};
const button=(text,action,attrs={})=>{const b=el('button',text,{type:'button',...attrs});b.addEventListener('click',action);return b;};
const input=(value='',attrs={})=>el('input',null,{value,...attrs});
function select(options,value='') {const e=el('select');for(const option of options){const x=typeof option==='string'?{value:option,label:option||'—'}:option;e.append(el('option',x.label,{value:x.value}));}e.value=value;return e;}
let controlSequence=0;
function field(label,control,help='') {
  const wrap=el('div',null,{class:'bp-field'});let caption=el('span',label);
  if(['INPUT','SELECT','TEXTAREA'].includes(control.tagName)){control.id||='burbank-control-'+(++controlSequence);caption=el('label',label,{htmlFor:control.id});}
  append(wrap,caption,control);
  if(help){const description=el('small',help,{id:control.id+'-help'});control.setAttribute('aria-describedby',description.id);wrap.append(description);}return wrap;
}
const note=text=>el('p',text,{class:'bp-note'});
const short=(text,n=140)=>String(text??'').length>n?String(text).slice(0,n)+'…':String(text??'');
function table(headers,rows) {
  const wrap=el('div',null,{class:'bp-table-wrap'}),t=el('table',null,{class:'bp-table'}),head=el('tr');
  headers.forEach(x=>head.append(el('th',x,{scope:'col'})));t.append(append(el('thead'),head));const body=el('tbody');
  rows.forEach(values=>{const row=el('tr');values.forEach(v=>row.append(append(el('td'),v instanceof Node?v:el('span',v??''))));body.append(row);});t.append(body);wrap.append(t);return wrap;
}
const dollars=x=>{const [whole,fraction='00']=String(x).split('.');return '$'+whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+fraction;};
export function mountProfilePanel({element,api,draft,onDraftChange,onOpenJob,onOpenBundle,download}) {
  if(!document.querySelector('link[data-burbank-style]')){const link=el('link',null,{rel:'stylesheet',href:'/burbank/panel.css'});link.dataset.burbankStyle='1';document.head.append(link);}
  const root=el('div',null,{class:'bp'});element.replaceChildren(root);
  const state={catalog:null,projects:[],project:null,summary:null,tab:'Overview',sheet:'',query:'',response:'',ownerFilter:'',onlyIssues:false,
    page:0,selected:new Set(),detail:null,section:'phases',runs:null,history:null,plan:draft.burbank??null,cohortId:draft.cohortId,
    actor:'',snapshot:null,epoch:0,error:'',message:''};
  const status=el('p','Loading the original Burbank catalog…',{class:'bp-message',role:'status'}),header=el('div'),navigation=el('nav',null,{'aria-label':'Burbank project sections',class:'bp-tabs'}),content=el('div');append(root,header,status,navigation,content);
  function report(message,error=false){status.textContent=message;status.dataset.error=String(error);}
  async function work(task) {root.inert=true;try{await task();}catch(error){report(error.message,true);}finally{root.inert=false;}}
  const actor=()=>{const value=state.actor.trim();if(!value)throw new Error('Enter the operator or reviewer name above.');return value;};
  function currentPlan() {return state.plan?structuredClone(state.plan):null;}
  function publishPlan(){onDraftChange(currentPlan());}
  async function refreshList(){state.projects=(await api('/api/burbank/projects')).projects;}
  async function loadProject(id,snapshot=null) {
    const epoch=++state.epoch;
    const value=await api('/api/burbank/project?projectId='+encodeURIComponent(id)+(snapshot?'&snapshot='+snapshot:''));
    if(epoch!==state.epoch)return;
    state.project=value.project;state.summary=value.summary;state.snapshot=snapshot;state.runs=null;state.history=null;state.detail=null;state.selected.clear();
    if(!state.plan||state.plan.projectId!==id){state.plan=newPlan(value.project,state.cohortId);publishPlan();}
    await refreshList();render();report(snapshot?'Viewing original trial plan revision '+value.project.revision+'. Load current project to edit.':'Project '+value.project.metadata.name+' · revision '+value.project.revision);
  }
  async function save(operations,message='Project saved.') {
    if(state.snapshot)throw new Error('Load the current project before editing. The original trial snapshot remains unchanged.');
    const result=await api('/api/burbank/change',{projectId:state.project.id,revision:state.project.revision,actor:actor(),operations});
    state.project=result.project;state.summary=result.summary;state.runs=null;state.history=null;
    if(state.plan&&!state.plan.snapshotSha256){state.plan.projectRevision=state.project.revision;publishPlan();}
    await refreshList();render();report(message+' Revision '+state.project.revision+'.');return result;
  }
  function renderHeader() {
    header.replaceChildren();append(header,el('p','CITY OF BURBANK · IT-2026-001',{class:'bp-kicker'}),el('h2','ERP delivery workspace'));
    const bar=el('div',null,{class:'bp-toolbar'}),projects=select([{value:'',label:'Choose a project'},...state.projects.map(p=>({value:p.id,label:p.name+' · r'+p.revision}))],state.project?.id??'');
    projects.setAttribute('aria-label','Choose project');projects.addEventListener('change',()=>{if(projects.value)work(()=>loadProject(projects.value));});
    const who=input(state.actor,{placeholder:'Operator / reviewer name','aria-label':'Operator or reviewer name'});who.addEventListener('input',()=>state.actor=who.value);
    append(bar,projects,who,button('New project',()=>{state.detail='create';render();}),state.project?button('Load current project',()=>work(()=>loadProject(state.project.id))):null);
    append(header,bar,state.project?note(state.project.metadata.mode+' · '+state.project.metadata.organization+' · '+(state.project.metadata.owner||'Owner not assigned')+(state.snapshot?' · Original trial snapshot':'')):null);
  }
  function render() {
    renderHeader();navigation.replaceChildren();
    for(const tab of ['Overview','Requirements','Interfaces','Delivery','Staffing & fees','Trials & reviews','Files & export'])navigation.append(button(tab,()=>{state.tab=tab;state.detail=null;render();},{'aria-current':state.tab===tab?'page':'false'}));
    content.replaceChildren();
    if(state.detail==='create'||!state.project){renderCreate();return;}
    if(state.tab==='Overview')renderOverview();
    else if(state.tab==='Requirements')renderRequirements();
    else if(state.tab==='Interfaces')renderInterfaces();
    else if(state.tab==='Delivery')renderDelivery();
    else if(state.tab==='Staffing & fees')renderPlanning();
    else if(state.tab==='Trials & reviews')renderTrials();
    else renderFiles();
  }
  function renderCreate() {
    const form=el('form',null,{class:'bp-editor'}),name=input('',{required:true}),id=input('',{required:true,pattern:'[A-Za-z0-9][A-Za-z0-9_-]{0,79}'}),organization=input(''),owner=input(''),mode=select(['Project','Practice'],'Project'),description=el('textarea');
    append(form,el('h3','Create a private project'),note('The original 977 requirements and 23 interfaces stay in the source catalog. Your response, delivery and reviewer records are saved separately.'),
      field('Project name',name),field('Stable project ID',id,'Letters, numbers, hyphens and underscores.'),field('Respondent organization',organization),field('Project owner',owner),field('Mode',mode),field('Scope and description',description),el('button','Create project',{type:'submit'}));
    name.addEventListener('input',()=>{if(!id.dataset.edited)id.value=name.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);});id.addEventListener('input',()=>id.dataset.edited='1');
    form.addEventListener('submit',e=>{e.preventDefault();work(async()=>{const result=await api('/api/burbank/create',{id:id.value,actor:actor(),metadata:{name:name.value,organization:organization.value,owner:owner.value,mode:mode.value,description:description.value}});state.detail=null;state.plan=null;await loadProject(result.project.id);});});content.append(form);
  }
  function renderOverview() {
    const p=state.project,s=state.summary,metrics=el('div',null,{class:'bp-metrics'});
    for(const [value,label]of [[s.answered+'/'+s.requirements,'Responses entered'],[s.completeResponses,'Response fields complete'],[s.plannedInterfaces+'/'+s.interfaces,'Interface plans'],[s.reviews,'Recorded reviews']])metrics.append(append(el('div'),el('strong',value),el('span',label)));
    append(content,metrics,note(state.catalog.procurement.proposalDeadline+' · PlanetBids · original RFP page '+state.catalog.procurement.deadlinePage),
      note('The response codes describe the proposed ERP solution. A successful conversion run records only the declared comparison and does not fill proposal responses automatically.'),
      el('h3','Project scope'),el('p',p.metadata.description||'Add the delivery scope below.'));
    const form=el('form',null,{class:'bp-editor'}),name=input(p.metadata.name),organization=input(p.metadata.organization),owner=input(p.metadata.owner),description=el('textarea',null,{value:p.metadata.description}),notes=el('textarea',null,{value:p.metadata.notes});
    append(form,field('Project name',name),field('Respondent organization',organization),field('Owner',owner),field('Scope',description),field('Working notes',notes),el('button','Save project details',{type:'submit'}));
    form.addEventListener('submit',e=>{e.preventDefault();work(()=>save([{type:'metadata',values:{name:name.value,organization:organization.value,owner:owner.value,description:description.value,notes:notes.value}}]));});content.append(form);
    append(content,el('h3','Source-specific instructions'),table(['Source topic','Handling'],[
      ['Acceptance response','Y, Y-WC, N and I. Y and Y-WC are fixed-fee commitments. Y-WC and I need written explanations.'],
      ['Requirement phases','1, 2 and X all remain part of the fixed-fee proposal. Delivery staffing has a separate 1–10 phase list.'],
      ['Interface response','Use the actual E–L response headers, including Keep, Replace, Temporary, Go-Away or Not Accommodated.'],
      ['Price schedule','Use actual Cost in Other Fees column C; preserve original formulas in the uploaded workbook.'],
      ['Support','Plan at least 12 months of hypercare, quarterly update regression and UAT at least 30 days before go-live, per pages 69–70.'],
    ]));
  }
  function filteredRequirements() {
    return state.catalog.requirements.filter(item=>{
      const row=state.project.requirements[item.id]??{};
      return (!state.sheet||item.sheet===state.sheet)&&(!state.response||(state.response==='blank'?!row.response:row.response===state.response))&&
        (!state.ownerFilter||(row.owner??'').toLowerCase().includes(state.ownerFilter.toLowerCase()))&&
        (!state.onlyIssues||responseIssues(row).length>0)&&(!state.query||[item.id,item.text,item.area,item.process,row.comment,row.module].join(' ').toLowerCase().includes(state.query.toLowerCase()));
    });
  }
  function renderRequirements() {
    const filters=el('div',null,{class:'bp-toolbar'}),search=input(state.query,{placeholder:'Search requirements','aria-label':'Search requirements'}),sheet=select(['',...new Set(state.catalog.requirements.map(x=>x.sheet))],state.sheet),response=select([{value:'',label:'Every response'},{value:'blank',label:'Blank'},...RESPONSE_CODES.filter(Boolean).map(x=>({value:x,label:x}))],state.response),owner=input(state.ownerFilter,{placeholder:'Filter owner','aria-label':'Filter owner'}),issues=input('',{type:'checkbox',checked:state.onlyIssues});
    sheet.setAttribute('aria-label','Worksheet');response.setAttribute('aria-label','Response filter');
    append(filters,search,sheet,response,owner,field('Incomplete response fields',issues),button('Apply filters',()=>{state.query=search.value;state.sheet=sheet.value;state.response=response.value;state.ownerFilter=owner.value;state.onlyIssues=issues.checked;state.page=0;render();}));
    const items=filteredRequirements(),page=items.slice(state.page*30,(state.page+1)*30);
    append(content,filters,note(items.length+' matching requirements · '+state.selected.size+' selected'),
      table(['Select','Requirement','Original requirement','Response','Owner','Delivery',''],page.map(item=>{
        const row=state.project.requirements[item.id]??{},check=input('',{type:'checkbox',checked:state.selected.has(item.id),'aria-label':'Select '+item.id});
        check.addEventListener('change',()=>{if(check.checked)state.selected.add(item.id);else state.selected.delete(item.id);});
        return [check,item.sheet+' '+item.number,short(item.text,170),row.response||'—',row.owner||'—',row.status||'Unassigned',button('Edit',()=>{state.detail=item.id;render();})];
      })));
    const pages=el('div',null,{class:'bp-toolbar'});append(pages,button('Previous',()=>{state.page--;render();},{disabled:state.page===0}),el('span','Page '+(state.page+1)+' of '+Math.max(1,Math.ceil(items.length/30))),button('Next',()=>{state.page++;render();},{disabled:(state.page+1)*30>=items.length}),
      button('Select all matching',()=>{items.forEach(x=>state.selected.add(x.id));render();}),button('Clear selection',()=>{state.selected.clear();render();}));content.append(pages);
    const bulkOwner=input('',{placeholder:'Assign owner','aria-label':'Bulk owner'}),bulkStatus=select(['',...DELIVERY_STATES]);
    content.append(append(el('div',null,{class:'bp-toolbar'}),bulkOwner,bulkStatus,button('Apply ownership / delivery status',()=>work(async()=>{
      if(!state.selected.size)throw new Error('Select the requirements to assign.');if(!bulkOwner.value.trim()&&!bulkStatus.value)throw new Error('Enter an owner or choose a delivery status.');
      const operations=[...state.selected].map(id=>({type:'upsert',section:'requirements',record:{...state.project.requirements[id],id,...(bulkOwner.value.trim()?{owner:bulkOwner.value}:{}),...(bulkStatus.value?{status:bulkStatus.value}:{})}}));await save(operations,'Updated '+operations.length+' requirements.');
    }))));
    if(state.detail){const item=state.catalog.requirements.find(x=>x.id===state.detail);if(item)renderRequirementEditor(item);}
  }
  function attachmentChoices(selected=[]) {
    const box=el('div',null,{class:'bp-attachments'}),checks=[];
    for(const asset of Object.values(state.project.assets)) {const c=input('',{type:'checkbox',checked:selected.includes(asset.sha256)});checks.push([asset.sha256,c]);box.append(field(asset.name,c));}
    return {box,value:()=>checks.filter(([,c])=>c.checked).map(([id])=>id)};
  }
  function renderRequirementEditor(item) {
    const row=state.project.requirements[item.id]??{},form=el('form',null,{class:'bp-editor'}),controls={response:select(RESPONSE_CODES,row.response??''),module:input(row.module??''),phase:select(REQUIREMENT_PHASES,row.phase??''),comment:el('textarea',null,{value:row.comment??''}),owner:input(row.owner??''),status:select(DELIVERY_STATES,row.status??'Unassigned'),implementation:el('textarea',null,{value:row.implementation??''})},assets=attachmentChoices(row.assetIds);
    append(form,el('h3',item.id+' · '+item.area+' / '+item.process),el('p',item.text),
      item.continuations?.length?note('Original continuation rows are retained in the source catalog and handoff.'):null,
      append(el('p'),el('a','Original worksheet row '+item.row,{href:item.sourceUrl,target:'_blank',rel:'noopener noreferrer'})));
    for(const[key,label]of [['response','Response'],['module','Licensed module / system'],['phase','Requirement delivery phase'],['comment','Proposal comment / conditions'],['owner','Delivery owner'],['status','Delivery status'],['implementation','Implementation and correction notes']])form.append(field(label,controls[key]));
    append(form,note('Y and Y-WC commit the proposed functionality within the fixed fee. Responses stay separate from the delivery status and reviewer decision.'),field('Original supporting files',assets.box),el('button','Save requirement',{type:'submit'}));
    form.addEventListener('submit',e=>{e.preventDefault();work(()=>save([{type:'upsert',section:'requirements',record:{...row,id:item.id,...Object.fromEntries(Object.entries(controls).map(([k,c])=>[k,c.value])),assetIds:assets.value()}}]));});content.append(form);
    renderReviewsFor('requirements',item.id);
  }
  function renderInterfaces() {
    append(content,note('The 23 original interface rows preserve the City’s application descriptions and comments. Record the native response fields and the engineering work for each connection.'),
      table(['Application','Original interface','Plan','Owner','Delivery',''],state.catalog.interfaces.map(item=>{const r=state.project.interfaces[item.id]??{};return [item.application,short(item.interface,180),r.plan||'—',r.owner||'—',r.status||'Unassigned',button('Open',()=>{state.detail=item.id;render();})];})));
    const item=state.catalog.interfaces.find(x=>x.id===state.detail);if(!item)return;
    const row=state.project.interfaces[item.id]??{},form=el('form',null,{class:'bp-editor'}),controls={};
    append(form,el('h3',item.id+' · '+item.application),el('p',item.description),el('p',item.interface),note(item.comments));
    for(const[key,choices]of Object.entries(INTERFACE_OPTIONS))controls[key]=select(choices,row[key]??'');
    for(const key of ['frequency','owner'])controls[key]=input(row[key]??'');
    controls.status=select(DELIVERY_STATES,row.status??'Unassigned');
    for(const key of ['comments','mapping','recovery','result'])controls[key]=el('textarea',null,{value:row[key]??''});
    const names={plan:'Respondent interface plan',direction:'Direction',frequency:'Frequency',method:'Method',experience:'Existing experience',solution:'Type of solution',support:'Type of support',comments:'Native proposal comments',owner:'Delivery owner',status:'Delivery status',mapping:'Extraction, field mapping and destination contract',recovery:'Retry, duplicate handling and recovery',result:'Actual execution results and corrections'};
    for(const key of ['plan','direction','frequency','method','experience','solution','support','comments','owner','status','mapping','recovery','result'])form.append(field(names[key],controls[key]));
    const assets=attachmentChoices(row.assetIds);append(form,field('Retained native responses and supporting files',assets.box),el('button','Save interface',{type:'submit'}));
    form.addEventListener('submit',e=>{e.preventDefault();work(()=>save([{type:'upsert',section:'interfaces',record:{...row,id:item.id,...Object.fromEntries(Object.entries(controls).map(([k,c])=>[k,c.value])),assetIds:assets.value()}}]));});content.append(form);renderReviewsFor('interfaces',item.id);
  }
  function phaseOptions(){return [{value:'',label:'Choose delivery phase'},...Object.values(state.project.phases).sort((a,b)=>a.number-b.number).map(x=>({value:x.id,label:'Phase '+x.number+' · '+x.name}))];}
  function renderDelivery() {
    const p=state.project;
    append(content,el('h3','Delivery phases'),note('The staffing workbook allows up to 10 phases. Link each explicitly to the requirement delivery code 1, 2 or X.'),
      table(['Phase','Name','Requirement phase','Owner','Dates',''],Object.values(p.phases).sort((a,b)=>a.number-b.number).map(x=>[x.number,x.name,x.requirementPhase||'—',x.owner,x.start+' — '+x.end,button('Edit',()=>{state.detail={section:'phases',id:x.id};render();})])),button('Add phase',()=>{state.detail={section:'phases',id:null};render();}),
      el('h3','Readiness, cutover and support'),table(['Milestone','Phase','Owner','Date','Status',''],Object.values(p.milestones).map(x=>[x.name,p.phases[x.phaseId]?.name||'—',x.owner,x.date,x.status,button('Edit',()=>{state.detail={section:'milestones',id:x.id};render();})])),button('Add milestone',()=>{state.detail={section:'milestones',id:null};render();}));
    if(state.detail?.section)renderRecordEditor(state.detail.section,state.detail.id);
  }
  function renderPlanning() {
    const totals=state.summary.totals;
    append(content,el('h3','Five-year price plan'),table(['Scope','Initial software','Five annual fees','Services','Other','Five-year known total','Blank values'],['Included','Optional'].map(k=>{const t=totals.prices[k];return [k,dollars(t.initial.known),dollars(t.annual.known),dollars(t.services.known),dollars(t.other.known),dollars(t.fiveYear.known),t.fiveYear.blank];})),note('Known totals show entered values. A blank price remains incomplete; enter 0 for an explicit no-charge item. Initial software fees and the five annual fee values are each counted once.'));
    const summary=el('details'),notesForm=el('form',null,{class:'bp-editor'}),noteControls=[];summary.append(el('summary','Native price summary comments'));
    for(const [row,label]of [[9,'Initial costs'],[10,'SaaS / hosting project fees'],[11,'Professional services'],[12,'Other fees'],[13,'Total project costs'],[15,'Five-year maintenance / support'],[16,'Five-year hosting / SaaS'],[17,'Five-year total']]){
      const control=el('textarea',null,{value:state.project.priceSummary?.['summary-'+row]?.notes??''});noteControls.push([row,control]);notesForm.append(field(label+' · D'+row,control));
    }
    notesForm.append(el('button','Save price summary comments',{type:'submit'}));notesForm.addEventListener('submit',event=>{event.preventDefault();work(()=>save(noteControls.map(([row,control])=>({type:'upsert',section:'priceSummary',record:{id:'summary-'+row,row,notes:control.value}}))));});summary.append(notesForm);content.append(summary);
    const bar=el('div',null,{class:'bp-toolbar'});for(const section of ['staffing','software','services','other'])bar.append(button(section==='other'?'Other fees':section[0].toUpperCase()+section.slice(1),()=>{state.section=section;state.detail=null;render();}));content.append(bar);
    if(!['staffing','software','services','other'].includes(state.section))state.section='staffing';
    const section=state.section,rows=Object.values(state.project[section]);
    if(section==='staffing')append(content,note('Enter the original 24 monthly hour values for both Offeror and City staff. The template describes 160 hours as one full-time person-month.'),table(['Side','Phase','Resource','Role','Known hours',''],rows.map(x=>[x.side,state.project.phases[x.phaseId]?.name||'—',x.resource,x.role,x.months.filter(Boolean).length+' months entered',button('Edit',()=>{state.detail={section,id:x.id};render();})])),
      table(['Side','Total entered hours','Blank monthly cells'],['Offeror','City'].map(k=>[k,totals.staffing[k].total,totals.staffing[k].blank])));
    else append(content,table(['Item','Included / optional','Entered fee',''],rows.map(x=>[x.name||x.milestone||short(x.description),x.classification,section==='software'?'Initial '+(x.initial||'blank'):x.amount||'blank',button('Edit',()=>{state.detail={section,id:x.id};render();})])));
    content.append(button('Add '+(section==='other'?'fee':section==='staffing'?'staffing row':section==='software'?'software product':'service milestone'),()=>{state.detail={section,id:null};render();}));
    if(state.detail?.section)renderRecordEditor(state.detail.section,state.detail.id);
  }
  function renderRecordEditor(section,id) {
    const row=id?state.project[section][id]:{},form=el('form',null,{class:'bp-editor'}),controls={},arrays={};
    const add=(key,label,type='input',options={})=>{let c;if(type==='select')c=select(options.choices,row?.[key]??options.default??'');else if(type==='textarea')c=el('textarea',null,{value:row?.[key]??''});else c=input(row?.[key]??options.default??'',options);controls[key]=c;form.append(field(label,c));};
    append(form,el('h3',(id?'Edit ':'Add ')+section));
    if(section==='phases') {add('number','Staffing phase number','input',{type:'number',min:1,max:10,default:Object.values(state.project.phases).length+1});add('name','Phase name');add('description','Phase description','textarea');add('requirementPhase','Requirement phase','select',{choices:REQUIREMENT_PHASES});add('owner','Owner');add('start','Start','input',{type:'date'});add('end','End','input',{type:'date'});}
    if(section==='milestones') {add('name','Milestone');add('phaseId','Delivery phase','select',{choices:phaseOptions()});add('owner','Owner');add('date','Date','input',{type:'date'});add('status','Status','select',{choices:DELIVERY_STATES,default:'Planned'});add('criteria','Acceptance and readiness criteria','textarea');add('notes','Results / corrections','textarea');}
    if(section==='staffing') {add('side','Staffing side','select',{choices:['Offeror','City'],default:'Offeror'});add('phaseId','Delivery phase','select',{choices:phaseOptions()});add('resource','Resource type','select',{choices:RESOURCE_TYPES,default:'Other'});add('role','Resource role');const months=el('div',null,{class:'bp-months'});arrays.months=Array.from({length:24},(_,i)=>{const c=input(row?.months?.[i]??'',{inputMode:'decimal',placeholder:'Blank'});months.append(field('Month '+(i+1),c));return c;});form.append(months);}
    if(['software','services','other'].includes(section))add('classification','Included or optional','select',{choices:['Included','Optional'],default:'Included'});
    if(section==='software') {add('name','Product / module name');add('function','ERP functionality');add('metric','License metric');add('limitation','License limitation');add('initial','Initial cost','input',{inputMode:'decimal',placeholder:'Blank'});const years=el('div',null,{class:'bp-months'});arrays.years=Array.from({length:5},(_,i)=>{const c=input(row?.years?.[i]??'',{inputMode:'decimal',placeholder:'Blank'});years.append(field('Year '+(i+1),c));return c;});form.append(years);add('comments','Comments','textarea');}
    if(section==='services') {add('payment','Payment number');add('milestone','Milestone');add('phaseId','Delivery phase','select',{choices:phaseOptions()});add('description','Included deliverables / activities','textarea');add('amount','Amount','input',{inputMode:'decimal',placeholder:'Blank'});add('comments','Comments','textarea');}
    if(section==='other') {add('description','Fee description','textarea');add('amount','Cost','input',{inputMode:'decimal',placeholder:'Blank'});}
    form.append(el('button','Save '+section,{type:'submit'}));
    form.addEventListener('submit',e=>{e.preventDefault();work(async()=>{const record={id:id??section+'-'+crypto.randomUUID(),...Object.fromEntries(Object.entries(controls).map(([k,c])=>[k,c.value])),...Object.fromEntries(Object.entries(arrays).map(([k,a])=>[k,a.map(c=>c.value)]))};await save([{type:'upsert',section,record}]);});});
    if(id)form.append(button('Remove this planning row',()=>work(async()=>{state.detail=null;await save([{type:'remove',section,id}]);})));
    content.append(form);
  }
  function renderTrials() {
    const p=state.project,plan=state.plan??newPlan(p,state.cohortId),form=el('div',null,{class:'bp-editor'}),family=input(plan.trialId),number=input(plan.trialNumber,{type:'number',min:1}),kind=select(TRIAL_KINDS,plan.kind),requirements=el('textarea',null,{value:plan.requirementIds.join('\n')}),interfaces=select([{value:'',label:'No interface selected'},...state.catalog.interfaces.map(x=>({value:x.id,label:x.id+' · '+x.application}))],plan.interfaceIds[0]??''),notes=el('textarea',null,{value:plan.notes});
    append(form,el('h3','Link the next conversion run'),note('Use the existing Inputs & mapping, Run and Results tabs to execute the declared comparison. This plan travels with the original bundle and report.'),note('Selected project revision '+plan.projectRevision+(plan.snapshotSha256?' · pinned original snapshot':' · current project')),
      field('Stable trial family',family),field('Trial number',number),field('Trial kind',kind),field('Original requirement IDs',requirements,'One ID per line; use the requirement editor IDs.'),field('Original interface',interfaces),field('Trial scope and review notes',notes),
      button('Use this plan for the next run',()=>{state.plan={...plan,trialId:family.value,trialNumber:Number(number.value),kind:kind.value,requirementIds:requirements.value.split(/[\s,]+/).filter(Boolean),interfaceIds:interfaces.value?[interfaces.value]:[],notes:notes.value};publishPlan();report('Trial plan applied. Open Inputs & mapping to stage the original exports.');}),
      button('Use current project revision',()=>work(async()=>{const current=await api('/api/burbank/project?projectId='+p.id);state.plan={...plan,projectRevision:current.project.revision,snapshotSha256:undefined};publishPlan();await loadProject(p.id);})));
    content.append(form);content.append(button('Refresh original runs',()=>work(async()=>{state.runs=await api('/api/burbank/runs?projectId='+p.id);render();})));
    if(state.runs) {
      append(content,el('h3','Original comparison runs'),table(['Trial','Plan revision','State / comparison','Original review',''],state.runs.jobs.map(job=>{
        const last=job.reviews.at(-1);return [job.plan.trialId+' #'+job.plan.trialNumber,job.plan.projectRevision,job.state+(job.result?.status?' · '+job.result.status:''),last?.decision||'—',append(el('div',null,{class:'bp-actions'}),button('Open result',()=>onOpenJob(job.jobId)),button('Open original inputs',()=>onOpenBundle(job.bundleId,job.jobId)))];
      })),el('h3','Retained bundles'),table(['Trial','Plan revision','Bundle',''],state.runs.bundles.map(x=>[x.plan.trialId+' #'+x.plan.trialNumber,x.plan.projectRevision,short(x.bundle.bundleId,20),button('Open',()=>onOpenBundle(x.bundle.bundleId))])));
    }
    renderReviewForm();append(content,el('h3','Project review history'),table(['When','Reviewer','Target','Decision','Rationale'],p.reviews.slice().reverse().map(x=>[x.at,x.reviewer,x.section+' '+x.ids.join(', '),x.decision,x.comment])));
  }
  function renderReviewForm(section='project',id=null) {
    const form=el('form',null,{class:'bp-editor'}),decision=select(['Reviewed','Accepted','Needs correction'],'Reviewed'),comment=el('textarea',null,{required:true}),run=select([{value:'',label:'Written review without a comparison reference'},...(state.runs?.jobs??[]).filter(x=>x.state==='COMPLETED').map(x=>({value:x.jobId,label:x.plan.trialId+' #'+x.plan.trialNumber+' · '+x.jobId}))]);
    append(form,el('h3','Record '+(section==='project'?'project':section.slice(0,-1))+' review'),field('Decision',decision),field('Rationale and disposition',comment),field('Original completed comparison',run),el('button','Record review',{type:'submit'}));
    form.addEventListener('submit',e=>{e.preventDefault();work(async()=>{const job=state.runs?.jobs.find(x=>x.jobId===run.value);await save([{type:'review',record:{section,ids:id?[id]:[],decision:decision.value,comment:comment.value,reference:job?{jobId:job.jobId,reportSha256:job.result.report.sha256}:null}}],'Review recorded.');});});content.append(form);
  }
  function renderReviewsFor(section,id) {
    content.append(button('Load original reports for review',()=>work(async()=>{state.runs=await api('/api/burbank/runs?projectId='+state.project.id);render();})));
    renderReviewForm(section,id);const reviews=state.project.reviews.filter(x=>x.section===section&&x.ids.includes(id));
    if(reviews.length)content.append(table(['Reviewer','Decision','Rationale'],reviews.map(x=>[x.reviewer,x.decision,x.comment])));
  }
  function renderFiles() {
    const p=state.project,kind=select([{value:'supporting',label:'Supporting file'},{value:'native-interface',label:'Original interface response / capture'},{value:'requirements-template',label:'Original Acceptance Requirements.xlsx'},{value:'interfaces-template',label:'Original Interfaces.xlsx'},{value:'staffing-template',label:'Original Staffing Level of Effort.xlsx'},{value:'price-template',label:'Original Price Proposal.xlsx'}]),file=input('',{type:'file'}),form=el('form',null,{class:'bp-editor'});
    append(form,el('h3','Retain original files'),field('File kind',kind),field('Original file',file),el('button','Retain file',{type:'submit'}));
    form.addEventListener('submit',e=>{e.preventDefault();work(async()=>{
      const selected=file.files[0];if(!selected)throw new Error('Choose the original file.');if(selected.size>25*1024*1024)throw new Error('Choose a file no larger than 25 MiB.');
      const data=await new Promise((yes,no)=>{const reader=new FileReader();reader.onload=()=>yes(String(reader.result).split(',')[1]);reader.onerror=()=>no(new Error('The selected file could not be read.'));reader.readAsDataURL(selected);});
      const result=await api('/api/burbank/upload',{projectId:p.id,revision:p.revision,actor:actor(),name:selected.name,kind:kind.value,data});
      state.project=result.project;state.summary=result.summary;if(state.plan&&!state.plan.snapshotSha256){state.plan.projectRevision=result.project.revision;publishPlan();}render();report('Original '+selected.name+' retained with its SHA-256 identity.');
    });});content.append(form);
    content.append(table(['Original file','Kind','Bytes','Actions'],Object.values(p.assets).map(asset=>{
      const buttons=el('div',null,{class:'bp-actions'}),k=asset.kind.replace('-template','');
      buttons.append(button('Download original',()=>work(()=>download('/api/burbank/asset?projectId='+p.id+'&sha256='+asset.sha256))));
      if(asset.kind.endsWith('-template'))buttons.append(button('Export native response',()=>work(()=>download('/api/burbank/workbook?projectId='+p.id+'&sha256='+asset.sha256+'&kind='+k))));
      if(['requirements-template','interfaces-template'].includes(asset.kind))buttons.append(button('Import response fields',()=>work(async()=>{const result=await api('/api/burbank/import-workbook',{projectId:p.id,revision:p.revision,actor:actor(),assetSha256:asset.sha256,kind:k});state.project=result.project;state.summary=result.summary;if(state.plan&&!state.plan.snapshotSha256){state.plan.projectRevision=result.project.revision;publishPlan();}render();report('Imported '+result.imported+' native response records.');})));
      return [asset.name,asset.kind,asset.bytes,buttons];
    })));
    append(content,el('h3','Project transfer'),note('The full handoff includes this project, original sources and attachments, response exports, every completed conversion replay and its original trial plan. Use the encrypted CLI backup for a full restart including pending work.'),
      button('Download complete project handoff',()=>work(()=>download('/api/burbank/handoff?projectId='+p.id))),button('Download native response cell map',()=>work(()=>download('/api/burbank/transfers?projectId='+p.id))));
    const exports=el('div',null,{class:'bp-actions'});for(const name of ['acceptance-responses.csv','interface-responses.csv','delivery-phases.csv','offeror-staffing.csv','city-staffing.csv','software-fees.csv','service-fees.csv','other-fees.csv','price-summary-notes.csv'])exports.append(button(name,()=>work(()=>download('/api/burbank/csv?projectId='+p.id+'&file='+name))));content.append(exports);
    append(content,el('h3','Retained changes'),button('Load project history',()=>work(async()=>{state.history=(await api('/api/burbank/history?projectId='+p.id)).history;render();})));
    if(state.history)content.append(table(['Revision','When','Operator','Changes'],state.history.slice().reverse().map(x=>[x.revision,x.at,x.actor,x.operations.length?x.operations.map(op=>op.type+' '+(op.section??'')).join(', '):'Project created'])));
    const issueGroups=Object.entries(state.summary.issues.reduce((a,x)=>{a[x.section]=(a[x.section]??0)+1;return a;},{}));
    append(content,el('h3','Response work remaining'),table(['Section','Incomplete fields / references'],issueGroups));
  }
  async function updateDraft(next) {
    state.cohortId=next.cohortId;
    if(next.burbank) {
      const plan=structuredClone(next.burbank),different=state.plan?.projectId!==plan.projectId||state.plan?.snapshotSha256!==plan.snapshotSha256;
      state.plan=plan;
      if(different&&state.catalog)await work(()=>loadProject(plan.projectId,plan.snapshotSha256??null));else if(state.project)render();
    }
  }
  work(async()=>{state.catalog=await api('/api/burbank/catalog');await refreshList();if(state.plan?.projectId)await loadProject(state.plan.projectId,state.plan.snapshotSha256??null);else if(state.projects.length)await loadProject(state.projects[0].id);else{render();report('Create a project and enter the operator name to begin.');}});
  return {currentPlan,updateDraft};
}
