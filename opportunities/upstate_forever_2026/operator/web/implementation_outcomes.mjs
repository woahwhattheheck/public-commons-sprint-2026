/* Outcome evaluation inside the existing Implementation workbench. */
const SCHEMA='upstate.implementation-outcome-selection/v1';
const copy=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valueText=value=>value===null||value===undefined?'Unavailable':typeof value==='object'?JSON.stringify(value):String(value);
const button=(action,label,attrs='')=>'<button type="button" data-impl="outcomes-'+action+'" '+attrs+'>'+esc(label)+'</button>';
const field=(label,html,help='')=>'<label class="iw-field"><span>'+esc(label)+'</span>'+html+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
const input=(name,value='',type='text',attrs='')=>'<input data-outcome-control name="'+esc(name)+'" type="'+type+'" value="'+esc(value)+'" '+attrs+'>';
const textarea=(name,value='')=>'<textarea data-outcome-control name="'+esc(name)+'">'+esc(value)+'</textarea>';
const checks=(name,rows,selected)=>rows.map(row=>'<label><input data-outcome-control type="checkbox" name="'+name+'" value="'+esc(row.id)+'" '+(selected.includes(row.id)?'checked':'')+'> '+esc(row.label)+'</label>').join('');
const table=(headers,rows,empty='No retained rows.')=>rows.length?'<div class="iw-table-wrap"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+esc(valueText(x))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p class="iw-empty">'+esc(empty)+'</p>';
const date=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;};
const unique=values=>[...new Set(values)];
const digestPattern=/^[0-9a-f]{64}$/;

export function outcomeIntervalText(interval){
  if(interval===null||interval===undefined)return 'Unavailable';
  const lower=interval.lower,upper=interval.upper;
  if(lower!==null&&lower!==undefined&&upper!==null&&upper!==undefined&&lower===upper&&!interval.lower_open&&!interval.upper_open)return String(lower);
  return (lower===null||lower===undefined||interval.lower_open?'(':'[')+(lower===null||lower===undefined?'−∞':String(lower))+', '+
    (upper===null||upper===undefined?'+∞':String(upper))+(upper===null||upper===undefined||interval.upper_open?')':']');
}
function comparisonTables(result){
  const phases=[],changes=[],months=[],unpaired=[];
  for(const effect of result.effects||[]){
    const originalGroup=(Array.isArray(result.groups)?result.groups:[]).find(row=>row.id===effect.group_id);
    const support=Object.entries(effect.support||{}).map(([key,value])=>key.replaceAll('_',' ')+': '+valueText(value)).join(' · ');
    const name=originalGroup?.label||effect.label||[effect.parameter,effect.basis,effect.fraction,effect.method,support].filter(Boolean).join(' · ');
    const site=effect.site_label||effect.site_id;
    for(const [label,value] of [['Impact sites',effect.direct],['Impact minus fixed controls',effect.controls?.paired]]){
      if(!value)continue;
      for(const period of ['before','after']){
        const p=value[period]||{};
        phases.push([site,name,effect.unit,label,period,outcomeIntervalText(p.interval),
          outcomeIntervalText(p.supported_dates_interval),outcomeIntervalText(p.quantified_subset_interval),
          p.days,p.supported_days,p.incomplete_days,p.quantified_subset_days,p.records,p.quantified_records,p.censored_records,p.unresolved_records,
          p.first_date,p.last_date]);
      }
      changes.push([site,name,effect.unit,label,outcomeIntervalText(value.change),outcomeIntervalText(value.supported_date_change),
        (value.month_balanced?.months||[]).join(', ')||'None',
        outcomeIntervalText(value.month_balanced?.change),outcomeIntervalText(value.month_balanced?.supported_date_change),
        (value.month_balanced?.omitted_months||[]).join(', ')||'None']);
      for(const month of value.monthly||[])months.push([site,name,effect.unit,label,month.month,
        outcomeIntervalText(month.before?.interval),outcomeIntervalText(month.after?.interval),
        outcomeIntervalText(month.change),outcomeIntervalText(month.supported_date_change)]);
    }
    for(const row of effect.controls?.unpaired_impact_dates||[])unpaired.push([site,name,row.date,row.period,
      row.impact_incomplete?'Yes':'No',(row.missing_or_incomplete_control_site_ids||[]).join(', ')]);
  }
  return '<h4>Before and after observation support</h4><p>Full intervals use every selected sample day. Supported-date and quantified-only subsets are shown separately; their coverage is retained beside each quantity. Unbounded limits remain unbounded.</p>'+
    table(['Site','Measurement group','Unit','Comparison','Period','Full mean interval','Supported-date interval','Quantified-only interval','Sample days','Supported days','Incomplete days','Quantified-only days','Records','Quantified','Censored','Unresolved','First date','Last date'],phases)+
    '<h4>Descriptive period change</h4><p>Change is after minus before in the original unit. A negative change indicates a decrease in that quantity. These selected-period contrasts do not establish that an intervention caused the change. Control contrasts retain the same fixed set on each paired date.</p>'+
    table(['Site','Measurement group','Unit','Comparison','Full change interval','Supported-date change','Common months','Common-month balanced change','Supported common-month change','Omitted months'],changes)+
    '<details><summary>Original monthly contrasts</summary>'+table(['Site','Measurement group','Unit','Comparison','Month','Before mean','After mean','Full change','Supported-date change'],months)+'</details>'+
    (unpaired.length?'<details><summary>Dates without a complete control pairing</summary>'+table(['Site','Measurement group','Date','Period','Impact incomplete','Missing or incomplete controls'],unpaired)+'</details>':'');
}

export function initialOutcomeDraft(catalog){
  return {title:(catalog.plan_binding?.title||'Implementation')+' — observed outcomes',
    before_start:'',before_end:'',after_start:'',after_end:'',
    impact_site_ids:[],control_site_ids:[],
    group_ids:catalog.groups?.length===1?[catalog.groups[0].id]:[],
    qa_all:true,qa_statuses:[],calendar_months:Array.from({length:12},(_,i)=>i+1),
    time_zone:'UTC',lower_bound:'',event_enabled:false,event_date:'',
    event_label:'',event_source_link_ids:[],event_notes:''};
}

export function outcomeSelectionFromDraft(catalog,draft){
  const binding=catalog?.plan_binding;
  if(!binding?.plan_id||!Number.isSafeInteger(binding.revision)||binding.revision<1||!digestPattern.test(binding.document_digest||''))throw Error('Reopen the original saved revision catalogue.');
  const title=String(draft.title||'').trim();if(!title)throw Error('Name this outcome evaluation.');
  const before={start:draft.before_start,end:draft.before_end},after={start:draft.after_start,end:draft.after_end};
  if(![before.start,before.end,after.start,after.end].every(date))throw Error('Enter complete before and after dates as YYYY-MM-DD.');
  if(before.start>before.end||after.start>after.end||before.end>=after.start)throw Error('Use ordered, nonoverlapping before and after periods.');
  const selected=(name,available,required=false)=>{
    const ids=unique(draft[name]||[]);if(required&&!ids.length)throw Error('Choose '+name.replaceAll('_',' ')+'.');
    if(ids.some(id=>!available.has(id)))throw Error('A selected '+name.replaceAll('_',' ')+' changed; reopen the original catalogue.');
    return ids;
  };
  const sites=new Set((catalog.sites||[]).map(x=>x.id));
  const impact=selected('impact_site_ids',sites,true),control=selected('control_site_ids',sites);
  if(impact.some(id=>control.includes(id)))throw Error('Impact and control sites must be distinct.');
  const groups=selected('group_ids',new Set((catalog.groups||[]).map(x=>x.id)),true);
  const months=unique((draft.calendar_months||[]).map(Number)).sort((a,b)=>a-b);
  if(!months.length||months.some(x=>!Number.isInteger(x)||x<1||x>12))throw Error('Choose one or more calendar months.');
  const qa=draft.qa_all?null:selected('qa_statuses',new Set(catalog.qa_statuses||[]));
  if(qa!==null&&!qa.length)throw Error('Choose at least one original QA label or include all labels.');
  const zone=String(draft.time_zone||'').trim();if(!zone)throw Error('Choose the collection-date time zone.');
  const lower=String(draft.lower_bound??'').trim();
  if(lower!==''&&!Number.isFinite(Number(lower)))throw Error('The explicit physical lower bound must be finite.');
  if(lower!==''&&new Set(catalog.groups.filter(row=>groups.includes(row.id)).map(row=>row.unit)).size>1)throw Error('An explicit physical lower bound requires selected groups with the same original unit. Evaluate different units separately or leave the bound blank.');
  let event=null;
  if(draft.event_enabled){
    if(!date(draft.event_date))throw Error('Enter the actual intervention event date.');
    if(!String(draft.event_label||'').trim())throw Error('Describe the intervention event.');
    const links=new Set((catalog.source_links||catalog.evidence?.source_links||[]).map(x=>x.id));
    const refs=unique(draft.event_source_link_ids||[]);
    if(refs.some(id=>!links.has(id)))throw Error('Choose original source references from this revision.');
    event={date:draft.event_date,label:draft.event_label.trim(),source_link_ids:refs,notes:String(draft.event_notes||'').trim()};
  }
  return {schema:SCHEMA,plan_id:binding.plan_id,revision:binding.revision,document_digest:binding.document_digest,title,
    before,after,impact_site_ids:impact,control_site_ids:control,group_ids:groups,qa_statuses:qa,
    calendar_months:months,time_zone:zone,lower_bound:lower===''?null:Number(lower),event};
}

export function draftFromOutcomeSelection(selection){
  return {title:selection.title,before_start:selection.before.start,before_end:selection.before.end,
    after_start:selection.after.start,after_end:selection.after.end,impact_site_ids:copy(selection.impact_site_ids),
    control_site_ids:copy(selection.control_site_ids||[]),group_ids:copy(selection.group_ids),
    qa_all:selection.qa_statuses===null,qa_statuses:copy(selection.qa_statuses||[]),
    calendar_months:copy(selection.calendar_months||Array.from({length:12},(_,i)=>i+1)),
    time_zone:selection.time_zone||'UTC',lower_bound:selection.lower_bound??'',
    event_enabled:!!selection.event,event_date:selection.event?.date||'',event_label:selection.event?.label||'',
    event_source_link_ids:copy(selection.event?.source_link_ids||[]),event_notes:selection.event?.notes||''};
}

export class ImplementationOutcomeController {
  constructor(workbench){
    this.workbench=workbench;this.key=null;this.catalog=null;this.draft=null;this.pending=null;
    this.outcomes=[];this.result=null;this.resultId=null;this.page=0;this.turn=0;this.busy=false;
    this.message='';this.error='';this.memory=new Map();this.updating=false;this.resultSequence=0;this.editSequence=0;
  }
  keyForPlan(){const w=this.workbench;return w.plan?.id?w.workspace+'/'+w.plan.id:null;}
  sync(){
    const next=this.keyForPlan();if(next===this.key)return;
    this.persist();this.key=next;this.turn++;this.catalog=null;this.result=null;this.outcomes=[];this.page=0;this.busy=false;this.message='';this.error='';
    let saved=null;try{saved=JSON.parse(localStorage.getItem('upstate.implementation-outcomes/v1/'+next)||'null');}catch{saved=this.memory.get(next)||null;}
    this.draft=saved?.draft||null;this.pending=saved?.pending||null;this.resultId=saved?.result_id||null;this.catalogBinding=saved?.catalog_binding||null;this.resultSequence=saved?.result_sequence||0;this.editSequence=0;
  }
  persist(){
    if(!this.key)return;const saved={draft:this.draft,pending:this.pending,result_id:this.resultId,result_sequence:this.resultSequence,catalog_binding:this.catalog?.plan_binding||this.catalogBinding||null};
    this.memory.set(this.key,copy(saved));try{localStorage.setItem('upstate.implementation-outcomes/v1/'+this.key,JSON.stringify(saved));}catch{this.message='Keep this view open until the original operation completes; browser storage is unavailable.';}
  }
  active(turn,key){return !this.workbench.gone&&this.turn===turn&&this.key===key&&this.keyForPlan()===key&&this.workbench.host.getState?.()?.workspace_key===this.workbench.workspace;}
  rerender(){if(!this.workbench.gone&&!this.workbench.root.querySelector('dialog[open]'))this.workbench.render();}
  errorMessage(error){this.error=error?.message||String(error);this.persist();this.rerender();}
  capture(){
    const form=this.workbench.root.querySelector('[data-outcome-form]');
    if(!form||!this.draft)return;
    const previous=JSON.stringify(this.draft);
    for(const name of ['title','before_start','before_end','after_start','after_end','time_zone','lower_bound','event_date','event_label','event_notes']){
      const element=form.querySelector('[name="'+name+'"]');if(element)this.draft[name]=element.value;
    }
    for(const name of ['impact_site_ids','control_site_ids','group_ids','qa_statuses','calendar_months','event_source_link_ids']){
      if(form.querySelector('[name="'+name+'"]'))this.draft[name]=[...form.querySelectorAll('[name="'+name+'"]:checked')].map(x=>name==='calendar_months'?Number(x.value):x.value);
    }
    for(const name of ['qa_all','event_enabled']){const el=form.querySelector('[name="'+name+'"]');if(el)this.draft[name]=el.checked;}
    if(JSON.stringify(this.draft)!==previous)this.editSequence++;
    this.persist();
  }
  change(event){if(!event.target.matches('[data-outcome-control]'))return false;this.sync();this.capture();if(['qa_all','event_enabled'].includes(event.target.name))this.rerender();return true;}
  async load(revision=null){
    this.sync();const w=this.workbench;if(!w.native||!w.plan?.id)throw Error('Open an original saved plan in its native Workspace.');
    revision=revision??this.catalogBinding?.revision??w.plan.revision;
    if(!Number.isSafeInteger(revision)||revision<1)throw Error('Save a native plan revision before selecting its observations.');
    const turn=++this.turn,key=this.key;this.busy=true;this.error='';this.rerender();
    try{
      const [catalog,saved]=await Promise.all([
        w.read('/api/implementation-outcomes/catalog',{plan_id:w.plan.id,revision}),
        w.read('/api/implementation-outcomes/list',{plan_id:w.plan.id})]);
      if(!this.active(turn,key))return;
      const previous=this.catalog?.plan_binding||this.catalogBinding;
      if(!this.draft||!previous||previous.document_digest!==catalog.plan_binding.document_digest)this.draft=initialOutcomeDraft(catalog);
      this.catalog=catalog;this.catalogBinding=copy(catalog.plan_binding);this.outcomes=saved.outcomes||[];
      this.message='Original saved revision '+catalog.plan_binding.revision+' is selected for this comparison.';
      this.persist();
      if(this.resultId)await this.openResult(this.resultId,false,true,this.resultSequence);
    }catch(error){if(this.active(turn,key))throw error;}
    finally{if(this.active(turn,key)){this.busy=false;this.rerender();}}
  }
  async openResult(id,replaceDraft=false,automatic=false,expectedSequence=null){
    this.sync();this.capture();
    if(automatic&&expectedSequence!==null&&expectedSequence!==this.resultSequence)return false;
    const sequence=automatic?this.resultSequence:++this.resultSequence;
    const edit=this.editSequence,turn=this.turn,key=this.key,w=this.workbench;
    const current=()=>this.active(turn,key)&&this.resultSequence===sequence;
    try{
    const result=await w.read('/api/implementation-outcomes/detail',{plan_id:w.plan.id,id});
    if(!current())return false;
    if(result.id!==id||result.selection?.plan_id!==w.plan.id)throw Error('The retained evaluation names another original plan.');
    let catalog=null;
    if(replaceDraft){
      catalog=await w.read('/api/implementation-outcomes/catalog',{plan_id:w.plan.id,revision:result.selection.revision});
      if(!current())return false;
      if(catalog.plan_binding.document_digest!==result.selection.document_digest)throw Error('The retained evaluation revision differs from its original plan.');
    }
    this.capture();if(!current())return false;
    this.result=result;this.resultId=result.id;this.page=0;
    const preserveDraft=replaceDraft&&this.editSequence!==edit;
    if(replaceDraft&&!preserveDraft){
      this.catalog=catalog;this.catalogBinding=copy(catalog.plan_binding);this.draft=draftFromOutcomeSelection(result.selection);
    }
    this.message=preserveDraft?'Opened the retained result. Your newer comparison edits remain in the form.':
      'Opened the retained evaluation. Editing the selection creates a separate evaluation when built.';
    this.persist();this.rerender();return true;
    }catch(error){if(current())throw error;return false;}
  }
  async build(){
    this.sync();this.capture();if(this.pending)throw Error('Reopen or resume the existing outcome operation before building another.');
    const selection=outcomeSelectionFromDraft(this.catalog,this.draft);
    this.pending={operation_id:'implementation-outcome-'+crypto.randomUUID(),selection,id:null,state:'submitting',result_sequence:this.resultSequence};
    this.persist();await this.submit();
  }
  async submit(){
    const pending=this.pending;if(!pending)return;const turn=this.turn,key=this.key,w=this.workbench;
    this.busy=true;this.error='';this.persist();this.rerender();
    try{
      const reply=await w.host.api('/api/actions',{method:'POST',body:{workspace:w.workspace,action:'implementation.outcomes.build',payload:{selection:copy(pending.selection)},operation_id:pending.operation_id}});
      if(!this.active(turn,key)||this.pending?.operation_id!==pending.operation_id)return;
      const task=reply.task||reply;this.pending.id=task.id;this.pending.state=task.state;this.persist();
      this.message='The outcome operation is retained with its original revision and comparison selection.';
      await (w.host.refresh?.({force:true})||w.host.refreshState?.({force:true}));
      if(!this.active(turn,key))return;
      await this.update({tasks:[task]});
      if(this.pending?.id)w.host.showTask?.(this.pending.id);
    }catch(error){if(this.active(turn,key)&&this.pending?.operation_id===pending.operation_id)throw error;}
    finally{if(this.active(turn,key)){this.busy=false;this.persist();this.rerender();}}
  }
  async update(state){
    this.sync();if(this.updating||!this.pending||this.workbench.gone)return;
    const p=this.pending,t=(state.tasks||[]).find(x=>p.id?x.id===p.id:x.operation_id===p.operation_id);if(!t)return;
    const changed=p.id!==t.id||p.state!==t.state;p.id=t.id;p.state=t.state;this.persist();
    if(t.state==='interrupted'){this.message='The original outcome task is interrupted. Resume that same task below.';if(changed)this.rerender();return;}
    if(['failed','cancelled'].includes(t.state)){this.error=t.error?.message||'The retained outcome operation '+t.state+'.';if(changed)this.rerender();return;}
    if(t.state!=='complete'){if(changed)this.rerender();return;}
    const turn=this.turn,key=this.key,w=this.workbench;this.updating=true;
    try{
      const task=await w.host.api('/api/task?'+new URLSearchParams({workspace:w.workspace,id:t.id}));
      if(!this.active(turn,key)||this.pending?.operation_id!==p.operation_id)return;
      const result=task.result; if(!result?.id)throw Error('The completed outcome task has no retained result identity.');
      await this.openResult(result.id,false,true,p.result_sequence);
      if(this.active(turn,key)&&this.resultId!==result.id)this.message='The new outcome evaluation is saved. Your explicitly selected result remains open; the new edition is listed below.';
      if(!this.active(turn,key)||this.pending?.operation_id!==p.operation_id)return;
      this.pending=null;this.error='';
      const saved=await w.read('/api/implementation-outcomes/list',{plan_id:w.plan.id});
      if(!this.active(turn,key))return;
      this.outcomes=saved.outcomes||[];this.persist();this.rerender();
    }catch(error){if(this.active(turn,key)&&this.pending?.operation_id===p.operation_id)throw error;}
    finally{this.updating=false;}
  }
  async resume(){
    const p=this.pending;if(!p?.id||p.state!=='interrupted')throw Error('Choose the retained interrupted outcome task.');
    const turn=this.turn,key=this.key,w=this.workbench;
    try{await w.host.api('/api/task/resume',{method:'POST',body:{id:p.id}});}catch(error){if(this.active(turn,key))throw error;return;}
    if(!this.active(turn,key))return;
    this.pending.state='queued';this.error='';this.persist();this.rerender();await w.host.refresh?.({force:true});
  }
  async act(buttonNode){
    this.sync();this.capture();const action=buttonNode.dataset.impl.replace(/^outcomes-/,'');
    if(action==='open'){await this.load();return;}
    if(action==='current'){if(this.pending)throw Error('Finish the retained outcome operation before changing its source revision.');this.catalogBinding=null;this.draft=null;this.resultId=null;await this.load(this.workbench.plan.revision);return;}
    if(action==='build'){await this.build();return;}
    if(action==='retry'){await this.submit();return;}
    if(action==='resume'){await this.resume();return;}
    if(action==='task'){if(this.pending?.id)this.workbench.host.showTask?.(this.pending.id);return;}
    if(action==='refresh'){await this.update(this.workbench.host.getState?.()||{});if(this.pending?.id){const t=await this.workbench.host.api('/api/task?'+new URLSearchParams({workspace:this.workbench.workspace,id:this.pending.id}));await this.update({tasks:[t]});}return;}
    if(action==='dismiss'){if(!['failed','cancelled'].includes(this.pending?.state))throw Error('Only a finished unsuccessful operation can be dismissed.');this.pending=null;this.error='';this.persist();this.rerender();return;}
    if(action==='result'){await this.openResult(buttonNode.dataset.id,true);return;}
    if(action==='record'){const row=this.result?.records?.[Number(buttonNode.dataset.index)];if(!row)throw Error('Choose a retained observation row.');this.workbench.dialog('<h3>Original outcome observation</h3><p>Evaluation '+esc(this.result.id)+'</p><pre class="iw-json">'+esc(JSON.stringify(row,null,2))+'</pre><button type="button" data-impl="close-dialog">Close</button>');return;}
    if(action==='previous'){this.page=Math.max(0,this.page-1);this.rerender();return;}
    if(action==='next'){this.page++;this.rerender();return;}
  }
  resultPanel(){
    const r=this.result;if(!r)return '';
    const downloads=(r._downloads||[]).filter(x=>typeof x.url==='string'&&/^\/api\/file\/[0-9a-f]{64}$/.test(x.url));
    const links=downloads.map(x=>'<a href="'+esc(x.url)+'?download=1" download>'+esc(x.label||x.filename||'Original file')+'</a>').join(' · ');
    const html=downloads.find(x=>/report\.html$/.test(x.filename||x.label||''));
    const summary=r.summary||{};
    const summaryRows=Object.entries(summary).filter(([,v])=>v===null||typeof v!=='object').map(([k,v])=>[k.replaceAll('_',' '),v]);

    const rows=Array.isArray(r.records)?r.records:[];
    const count=200,start=Math.min(this.page*count,Math.max(0,Math.floor((rows.length-1)/count)*count));
    this.page=Math.floor(start/count);
    const shown=rows.slice(start,start+count),allColumns=unique(shown.flatMap(Object.keys));
    const preferred=['observation_id','record_id','id','site_id','site_label','group_id','parameter','date','timestamp','collected_at','date_basis','time_zone','period','role','result_type','original_text','value','unit','qualifier','qa_status','status','included_in_period','included','value_basis','reason','issues','interval','detection_limit','quantitation_limit'];
    const columns=preferred.filter(x=>allColumns.includes(x));if(!columns.length)columns.push(...allColumns.slice(0,12));
    return '<section aria-label="Saved outcome evaluation"><h3>'+esc(r.selection?.title||r.id)+'</h3><p>Saved revision '+esc(r.selection?.revision)+' · evaluation '+esc(r.id)+'</p><div class="iw-actions">'+(html?'<a href="'+esc(html.url)+'" target="_blank" rel="noopener">Open retained report</a>':'')+links+'</div>'+
      table(['Summary','Value'],summaryRows,'The original summary is retained in the complete evaluation JSON.')+
      comparisonTables(r)+
      '<details><summary>Complete grouped comparison and method</summary><pre class="iw-json">'+esc(JSON.stringify({groups:r.groups,summary:r.summary,effects:r.effects},null,2))+'</pre></details>'+
      '<h4>Retained observation decisions</h4><p>'+esc(rows.length)+' original records; '+(rows.length?'showing '+(start+1)+'–'+(start+shown.length):'no rows')+'. Complete CSV and JSON downloads retain every source record and comparison reason.</p>'+
      '<div class="iw-actions">'+button('previous','Previous 200',start===0?'disabled':'')+button('next','Next 200',start+count>=rows.length?'disabled':'')+'</div>'+
      (shown.length?'<div class="iw-table-wrap"><table><thead><tr>'+columns.map(x=>'<th>'+esc(x.replaceAll('_',' '))+'</th>').join('')+'<th>Original detail</th></tr></thead><tbody>'+shown.map((row,index)=>'<tr>'+columns.map(k=>'<td>'+esc(valueText(row[k]))+'</td>').join('')+'<td>'+button('record','Inspect full record','data-index="'+(start+index)+'"')+'</td></tr>').join('')+'</tbody></table></div>':'<p>No original observations in the retained evaluation.</p>')+'</section>';
  }
  render(){
    this.sync();const w=this.workbench;
    if(!w.native)return '<p>Outcome evaluations use an original saved native revision. Export the complete field plan for receiving, then open its native revision.</p>';
    const c=this.catalog,d=this.draft;
    const p=this.pending;
    const pending=p?'<section class="iw-notice"><h3>Retained outcome operation</h3><p>'+esc(p.id||p.operation_id)+' · '+esc(p.state)+'</p><div class="iw-actions">'+(!p.id?button('retry','Retry original submission'):button('task','Open task')+button('refresh','Refresh saved result')+(p.state==='interrupted'?button('resume','Resume original task'):''))+(['failed','cancelled'].includes(p.state)?button('dismiss','Close failed operation'):'')+'</div></section>':'';
    const editions=this.outcomes.map(row=>[row.title||row.selection?.title||row.id,row.revision||row.plan_binding?.revision||row.selection?.revision,row.id]);
    const saved=editions.length?'<h3>Saved evaluations</h3><div class="iw-table-wrap"><table><thead><tr><th>Evaluation</th><th>Revision</th><th>Open</th></tr></thead><tbody>'+editions.map(row=>'<tr><td>'+esc(row[0])+'</td><td>'+esc(row[1])+'</td><td>'+button('result','Open selection and result','data-id="'+esc(row[2])+'"')+'</td></tr>').join('')+'</tbody></table></div>':'';
    let form='';
    if(c&&d){
      const siteRows=(c.sites||[]).map(x=>({id:x.id,label:(x.label||x.id)+' · '+x.id}));
      const groupRows=(c.groups||[]).map(x=>({id:x.id,label:(x.label||[x.parameter,x.unit,x.basis,x.fraction,x.method].filter(Boolean).join(' · '))+' · '+x.count+' records ('+x.dated_count+' dated)'}));
      const links=c.source_links||c.evidence?.source_links||[];
      form='<section data-outcome-form><h3>Comparison selection</h3><p>Original plan '+esc(c.plan_binding.plan_id)+' · saved revision '+esc(c.plan_binding.revision)+' · '+esc(c.plan_binding.document_digest)+'</p>'+
        '<p>Choose observed periods and sites. The comparison retains original measurement groups, qualifiers and coverage. The event is supplied context; planned task dates do not establish an intervention date.</p>'+
        field('Evaluation title',input('title',d.title))+
        '<div class="iw-two"><fieldset><legend>Before period · inclusive</legend>'+field('Start',input('before_start',d.before_start,'date'))+field('End',input('before_end',d.before_end,'date'))+'</fieldset><fieldset><legend>After period · inclusive</legend>'+field('Start',input('after_start',d.after_start,'date'))+field('End',input('after_end',d.after_end,'date'))+'</fieldset></div>'+
        '<div class="iw-two"><fieldset><legend>Impact sites</legend>'+checks('impact_site_ids',siteRows,d.impact_site_ids)+'</fieldset><fieldset><legend>Optional control sites</legend>'+checks('control_site_ids',siteRows,d.control_site_ids)+'</fieldset></div>'+
        '<fieldset><legend>Original measurement groups</legend>'+checks('group_ids',groupRows,d.group_ids)+'</fieldset>'+
        '<fieldset><legend>Original QA labels</legend><label><input data-outcome-control type="checkbox" name="qa_all" '+(d.qa_all?'checked':'')+'> Include all original QA labels</label>'+
        (!d.qa_all?checks('qa_statuses',(c.qa_statuses||[]).map(x=>({id:x,label:x||'(blank original QA label)'})),d.qa_statuses):'')+'</fieldset>'+
        '<fieldset><legend>Calendar months in both periods</legend>'+checks('calendar_months',Array.from({length:12},(_,i)=>({id:String(i+1),label:new Date(Date.UTC(2000,i,1)).toLocaleString('en',{month:'short',timeZone:'UTC'})})),d.calendar_months.map(String))+'</fieldset>'+
        '<div class="iw-two">'+field('Collection-date time zone',input('time_zone',d.time_zone),'An explicit IANA time zone such as UTC or America/New_York.')+
        field('Explicit physical lower bound (optional)',input('lower_bound',d.lower_bound,'number','step="any"'),'Leave blank when the original quantity has no declared lower bound. This is a physical domain, not a substituted censored value.')+'</div>'+
        '<fieldset><legend>Intervention event context</legend><label><input data-outcome-control type="checkbox" name="event_enabled" '+(d.event_enabled?'checked':'')+'> Retain an actual intervention event</label>'+
        (d.event_enabled?field('Actual event date',input('event_date',d.event_date,'date'))+field('Event description',input('event_label',d.event_label))+
        '<p>Original source references</p>'+checks('event_source_link_ids',links.map(x=>({id:x.id,label:x.label||x.id})),d.event_source_link_ids)+field('Event evidence and notes',textarea('event_notes',d.event_notes)):'')+'</fieldset>'+
        '<div class="iw-actions">'+button('build','Build and retain outcome evaluation',(this.busy||p?'disabled':''))+button('current','Use currently opened saved revision',(this.busy||p?'disabled':''))+'</div></section>'+
        '<details><summary>Original source coverage and monitoring context</summary><pre class="iw-json">'+esc(JSON.stringify({groups:c.groups,tasks:c.tasks,monitoring_plans:c.monitoring_plans,date_coverage:c.coverage||c.date_coverage},null,2))+'</pre></details>';
    }
    return '<section aria-label="Implementation outcomes"><div class="iw-section-head"><h3>Observed implementation outcomes</h3>'+button('open',c?'Refresh original catalogue':'Open saved-revision observations',this.busy?'disabled':'')+'</div>'+
      (this.message?'<p class="iw-notice" role="status">'+esc(this.message)+'</p>':'')+
      (this.error?'<pre class="iw-error" role="alert">'+esc(this.error)+'</pre>':'')+pending+form+saved+this.resultPanel()+'</section>';
  }
  detach(){this.capture();this.persist();this.turn++;}
}

export function createOutcomeController(workbench){return new ImplementationOutcomeController(workbench);}
