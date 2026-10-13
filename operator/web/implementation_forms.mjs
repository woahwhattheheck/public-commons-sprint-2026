import {clone,esc,uid,today,civil,parseMoney,applyMethod,updateRow} from './implementation_core.mjs';
const LABELS={tasks:'task',budget_lines:'cost entry',sites:'site',monitoring_plans:'monitoring plan',visits:'visit',activities:'activity',observations:'result',candidates:'candidate',source_links:'source reference'};
const button=(action,label,extra='',classes='')=>'<button type="button" data-impl="'+esc(action)+'" '+extra+' class="'+esc(classes)+'">'+esc(label)+'</button>';
const empty=text=>'<p class="iw-empty">'+esc(text)+'</p>';
const format=value=>value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
const options=(rows,selected,blank=true)=> (blank?'<option value="">—</option>':'')+rows.map(r=>'<option value="'+esc(r[0])+'" '+(String(r[0])===String(selected)?'selected':'')+'>'+esc(r[1])+'</option>').join('');
const field=(label,input,help='')=>'<label class="iw-field"><span>'+esc(label)+'</span>'+input+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
const input=(name,value='',type='text',attr='')=>'<input name="'+esc(name)+'" type="'+esc(type)+'" value="'+esc(value??'')+'" '+attr+'>';
const area=(name,value='',attr='')=>'<textarea name="'+esc(name)+'" '+attr+'>'+esc(value??'')+'</textarea>';
const select=(name,rows,value='',attr='')=>'<select name="'+esc(name)+'" '+attr+'>'+options(rows,value)+'</select>';
function download(name,text,type='text/plain;charset=utf-8'){
  const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function finite(value,label){if(String(value??'').trim()==='')return null;const n=Number(value);if(!Number.isFinite(n))throw Error(label+' must be a finite number.');return n;}
function list(text){return String(text||'').split(/[\n,]/).map(x=>x.trim()).filter(Boolean);}
function textObject(value){return typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'');}
function lines(value){return String(value??'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);}
function optionalText(value){const s=String(value??'');return s.trim()?s:null;}
function catalogNumber(item,text){
  const value=finite(text,item.label);
  if(value===null)throw Error('Record '+item.label+'.');
  if(item.type==='integer'&&!Number.isSafeInteger(value))throw Error(item.label+' must be a safe whole number.');
  if(item.minimum!==undefined&&value<item.minimum)throw Error(item.label+' must be at least '+item.minimum+'.');
  if(item.maximum!==undefined&&value>item.maximum)throw Error(item.label+' must be at most '+item.maximum+'.');
  if(item.exclusive_minimum!==undefined&&value<=item.exclusive_minimum)throw Error(item.label+' must be greater than '+item.exclusive_minimum+'.');
  if(item.exclusive_maximum!==undefined&&value>=item.exclusive_maximum)throw Error(item.label+' must be less than '+item.exclusive_maximum+'.');
  return value;
}
function docEqual(a,b){return JSON.stringify(a)===JSON.stringify(b);}

function sourceSelectionFields(workbench,choices){
  const draft=workbench.selectionDraft||{},preview=draft.preview,selected=new Set(draft.selected_ids||[]);
  let body=field('Original saved selection',select('source_choice',choices,draft.choice||'','required'));
  if(!choices.length)return body+'<p>No saved source selection is available yet. Save a community or conservation plan in its existing desk, then reopen this picker.</p>';
  body+='<p>Choose the original work or planning units to attach. Each selected row keeps its original status, quantities and source context.</p>';
  if(draft.loading)return body+'<p role="status" aria-live="polite">Reading the original saved selection…</p>';
  if(draft.error)return body+'<div class="iw-source-preview"><p class="iw-error" role="alert">'+esc(draft.error)+'</p>'+button('source-preview-retry','Read source again')+'</div>';
  if(!preview)return body+'<p role="status">Choose a saved selection to preview its original rows.</p>';
  const rows=preview.rows||[];
  body+='<div class="iw-source-preview"><h4>'+esc(preview.title||'Original source rows')+'</h4>';
  if(draft.notice)body+='<p class="iw-notice" role="status">'+esc(draft.notice)+'</p>';
  if(!rows.length)return body+'<p role="status">This source contains no importable rows. Choose another saved selection.</p></div>';
  body+=field('Find source rows',input('source_filter',draft.filter||'','search','autocomplete="off"'))+
    '<div class="iw-actions">'+button('source-select-visible','Select visible rows')+button('source-clear','Clear selection')+'</div>'+
    '<p data-source-selection-count aria-live="polite">'+selected.size+' of '+rows.length+' rows chosen.</p>'+
    '<p data-source-no-selection class="iw-hint" '+(selected.size?'hidden':'')+'>Choose at least one row. Proposed work can be chosen explicitly; its original proposed status is retained.</p>'+
    '<p data-source-no-matches class="iw-hint" hidden>No source rows match this search.</p>'+
    '<div class="iw-source-rows">';
  for(const row of rows){
    const chosen=selected.has(row.id),context=row.source_context||{},status=row.status||'Status not supplied';
    const area=[row.area_ha===null||row.area_ha===undefined?'':'Whole unit: '+row.area_ha+' ha',row.reporting_area_ha===null||row.reporting_area_ha===undefined?'':'Reporting area: '+row.reporting_area_ha+' ha'].filter(Boolean).join(' · ');
    const summary=typeof row.context_summary==='string'?row.context_summary:'';
    const search=[row.label,row.status,summary,JSON.stringify(context)].filter(Boolean).join(' ').toLocaleLowerCase();
    body+='<div class="iw-source-row" data-source-row data-source-search="'+esc(search)+'"><label class="iw-source-choice"><input type="checkbox" name="source_row" value="'+esc(row.id)+'" '+(chosen?'checked':'')+'><span><strong>'+esc(row.label)+'</strong><span class="iw-source-meta">'+esc(status)+(area?' · '+esc(area):'')+'</span>'+(summary?'<span class="iw-source-meta">'+esc(summary)+'</span>':'')+'</span></label><details><summary>Original source context</summary><pre class="iw-json">'+esc(JSON.stringify({id:row.id,...context},null,2))+'</pre></details></div>';
  }
  body+='</div><details class="iw-source-context"><summary>Saved selection reference</summary><pre class="iw-json">'+esc(JSON.stringify({title:preview.title,kind:preview.kind,source_id:preview.source_id,reference:preview.source_ref,context:preview.context||{}},null,2))+'</pre></details></div>';
  return body;
}

export function openImplementationDialog(kind,id){
    const p=this.plan,row=id?clone(p[kind].find(r=>r.id===id)):null;
    const title=kind==='settings'?'Plan settings':kind==='method'?'Add a complete method workflow':kind==='source-import'?'Import a saved native selection':kind==='field-form'?'Record a structured field visit':(row?'Edit ':'Add ')+(LABELS[kind]||kind);
    let body='';
    const refs=(collection,label)=>p[collection].map(x=>[x.id,x[label]||x.title||x.label||x.id]);
    const f=(label,name,value='',type='text',attr='',help='')=>field(label,input(name,value,type,attr),help);
    const ta=(label,name,value='',help='')=>field(label,area(name,value),help);
    const sel=(label,name,rows,value='')=>field(label,select(name,rows,value));
    if(kind==='settings'){
      body=f('Title','title',p.title,'text','required')+ta('Purpose','description',p.description)+f('Start date','start_date',p.start_date,'date','required')+f('Target date','target_date',p.target_date||'','date')+f('Working weekdays','working_days',p.working_days.join(', '),'text','required','ISO weekdays: Monday 1 through Sunday 7.')+ta('Nonworking holidays','holidays',p.holidays.join('\n'),'One YYYY-MM-DD date per line.');
    }else if(kind==='method'){
      body=sel('Method','method_id',this.catalog.method_templates.map(m=>[m.id,m.label]),this.catalog.method_templates[0]?.id)+sel('Candidate','candidate_id',refs('candidates'),'')+'<p>Named steps and dependencies will be added. Enter local durations, assignments and estimates in the work plan.</p>';
    }else if(kind==='source-import'){
      const choices=[...(this.selectionChoices?.conservation_portfolios||[]).map(x=>['conservation_portfolio:'+x.id,'Conservation · '+x.title]),...(this.selectionChoices?.community_plans||[]).map(x=>['community_plan:'+x.id,'Community · '+x.title])];
      body=sourceSelectionFields(this,choices);
    }else if(kind==='field-form'){
      const template=this.catalog.field_forms.find(f=>f.id===this.activeFormId)||this.catalog.field_forms[0];
      if(!template)throw Error('No field form templates are installed.');
      this.activeFormId=template.id;
      body=sel('Field form','fieldform_template',this.catalog.field_forms.map(f=>[f.id,f.label]),template.id)+sel('Original visit','visit_id',p.visits.map(v=>[v.id,(p.sites.find(s=>s.id===v.site_id)?.label||v.site_id)+' · '+(v.planned_date||v.id)]),p.visits[0]?.id||'')+f('Actual observation timestamp','collected_at','','text','required','Use the actual observation time with its timezone.')+sel('Activity kind','kind',[['inspection','Inspection'],['measurement','Measurement'],['sample','Sample'],['photo','Photograph']],'inspection')+f('Original sample ID (for sample activities)','sample_id','','text')+sel('Related work task','task_id',refs('tasks'),'');
      for(const item of template.fields){
        const name='answer__'+item.key,required=item.required?'required':'';
        if(item.type==='choice')body+=field(item.label,select(name,(item.choices||[]).map(x=>[x,x]),'',required));
        else if(['quantity','integer','number'].includes(item.type)){
          const bounds=(item.minimum!==undefined?' min="'+esc(item.minimum)+'"':'')+(item.maximum!==undefined?' max="'+esc(item.maximum)+'"':'');
          const help=[item.exclusive_minimum!==undefined?'Greater than '+item.exclusive_minimum+'.':'',item.exclusive_maximum!==undefined?'Less than '+item.exclusive_maximum+'.':'',item.type!=='quantity'&&item.unit?'Original unit: '+item.unit+'.':''].filter(Boolean).join(' ');
          body+=f(item.label,name,'','number','step="'+(item.type==='integer'?'1':'any')+'" '+required+bounds,help);
          if(item.type==='quantity')body+=f(item.label+' · unit',name+'__unit',item.unit||'','text',required,'Retain the original measurement unit.');
        }else if(item.type==='date')body+=f(item.label,name,'','date',required);
        else if(item.type==='monitoring_plan_ref')body+=field(item.label,select(name,refs('monitoring_plans'),'',required),'Choose a monitoring plan containing this visit site.');
        else if(item.type==='activity_refs')body+=field(item.label,area(name,'',required),'Existing activity IDs, one per line. Each activity must belong to the selected visit.')+'<details><summary>Available activity IDs</summary><ul>'+p.activities.map(a=>'<li><code>'+esc(a.id)+'</code> · '+esc(a.sample_id||a.kind)+' · '+esc(a.visit_id)+'</li>').join('')+'</ul></details>';
        else if(item.type==='attachment_refs'){
          const files=p.source_links.filter(link=>link.kind==='local_file');
          body+='<fieldset class="iw-field iw-file-choices"><legend>'+esc(item.label)+'</legend>'+(files.length?files.map(link=>'<label class="iw-source-choice"><input type="checkbox" name="'+esc(name)+'" value="'+esc(link.id)+'"><span>'+esc(link.label||link.original_filename)+'<small>'+esc(link.original_filename||link.id)+'</small></span></label>').join(''):'<p>No original files attached. Add files from the visit or Handover view before completing this field.</p>')+(item.required?'<small>Choose at least one attached file.</small>':'')+'</fieldset>';
        }else if(item.type==='attachment_ref'){
          body+=field(item.label,input(name,'','text',required+' list="'+esc(name)+'__files"')+'<datalist id="'+esc(name)+'__files">'+p.source_links.map(link=>'<option value="'+esc(link.id)+'">'+esc(link.label)+'</option>').join('')+'</datalist>','Choose an original source reference or enter the documented procedure/reference.');
        }else body+=field(item.label,area(name,'',required));
      }
    }else if(kind==='tasks'){
      const r=row||{title:'',candidate_id:'',phase:'prepare',assignee:'',status:'planned',duration_days:null,depends_on:[],progress_pct:0,notes:''};
      body=f('Title','title',r.title,'text','required')+sel('Candidate','candidate_id',refs('candidates'),r.candidate_id)+sel('Phase','phase',['prepare','design','implement','monitor','maintain','handover'].map(x=>[x,x]),r.phase)+f('Assigned role or person','assignee',r.assignee)+sel('Status','status',['planned','in_progress','complete','cancelled'].map(x=>[x,x.replaceAll('_',' ')]),r.status)+f('Duration (working days)','duration_days',r.duration_days,'number','min="0" step="1"','Leave empty while estimating; enter zero for a milestone.')+f('Start no earlier than','start_not_before',r.start_not_before||'','date')+f('Progress (%)','progress_pct',r.progress_pct,'number','min="0" max="100" step="1"')+ta('Predecessor task IDs','depends_on',(r.depends_on||[]).join('\n'),'Separate IDs with commas or new lines. Available tasks are listed below.')+'<details><summary>Available task IDs</summary><ul>'+p.tasks.filter(t=>t.id!==id).map(t=>'<li><code>'+esc(t.id)+'</code> · '+esc(t.title)+'</li>').join('')+'</ul></details>'+ta('Notes / acceptance','notes',r.notes);
    }else if(kind==='budget_lines'){
      const r=row||{kind:'budget',label:'',task_id:'',amount_minor:0,date:today(),reference:''};
      body=sel('Ledger','kind',[['budget','Budget estimate'],['commitment','Commitment'],['actual','Actual cost']],r.kind)+f('Description','label',r.label,'text','required')+sel('Task','task_id',refs('tasks'),r.task_id)+f('USD amount','amount',(r.amount_minor/100).toFixed(2),'text','required inputmode="decimal"')+f('Date','date',r.date,'date')+f('Invoice, quote or funding reference','reference',r.reference);
    }else if(kind==='sites'){
      const r=row||{label:'',candidate_id:'',latitude:null,longitude:null,coordinate_reference_system:'EPSG:4326',source_ref:''};
      body=f('Site label','label',r.label,'text','required')+sel('Candidate','candidate_id',refs('candidates'),r.candidate_id)+f('Latitude (original geographic degrees)','latitude',r.latitude,'number','min="-90" max="90" step="any"')+f('Longitude (original geographic degrees)','longitude',r.longitude,'number','min="-180" max="180" step="any"')+sel('Declared coordinate reference system','coordinate_reference_system',[['EPSG:4326','EPSG:4326 · WGS84'],['EPSG:4269','EPSG:4269 · NAD83'],['EPSG:4267','EPSG:4267 · NAD27'],['EPSG:4258','EPSG:4258 · ETRS89'],...(!['EPSG:4326','EPSG:4269','EPSG:4267','EPSG:4258','',undefined,null].includes(r.coordinate_reference_system)?[[r.coordinate_reference_system,r.coordinate_reference_system+' · original declaration']]:[])],r.coordinate_reference_system||'')+'<small>Keep the original declared datum. Blank means unstated; it does not mean WGS84. Changing coordinate numbers requires an explicit geographic declaration. No coordinate transformation is performed here.</small>'+sel('Original source reference','source_ref',refs('source_links'),r.source_ref||'')+'<small>Add a source reference in this plan before linking it to a site.</small>';
    }else if(kind==='monitoring_plans'){
      const r=row||{title:'',objective:'',site_ids:[],parameters:[],method_ref:'',frequency:'',notes:''};
      body=f('Title','title',r.title,'text','required')+ta('Monitoring question','objective',r.objective)+ta('Site IDs','site_ids',(r.site_ids||[]).join('\n'))+'<small>'+p.sites.map(s=>esc(s.id+' — '+s.label)).join('<br>')+'</small>'+ta('Parameters','parameters',(r.parameters||[]).join('\n'),'One parameter per line; preserve commas and chemical basis in the original name.')+f('Method reference','method_ref',textObject(r.method_ref))+f('Frequency / planned window','frequency',textObject(r.frequency))+ta('Notes','notes',r.notes);
    }else if(kind==='visits'){
      const r=row||{site_id:p.sites[0]?.id||'',monitoring_plan_id:'',planned_date:today(),visited_at:'',observer:'',status:'planned',notes:'',evidence_refs:[]};
      body=sel('Site','site_id',refs('sites'),r.site_id)+sel('Monitoring plan','monitoring_plan_id',refs('monitoring_plans'),r.monitoring_plan_id)+f('Planned date','planned_date',r.planned_date,'date')+f('Actual timestamp','visited_at',r.visited_at,'text','','Include the timezone, for example 2026-10-13T09:30:00-04:00.')+f('Observer','observer',r.observer)+sel('Status','status',[['planned','Planned'],['complete','Complete'],['cancelled','Cancelled']],r.status)+ta('Visit notes','notes',r.notes)+ta('File / photograph references','evidence_refs',(r.evidence_refs||[]).map(textObject).join('\n'),'One original reference per line; commas remain part of the reference.');
    }else if(kind==='activities'){
      const r=row||{visit_id:p.visits[0]?.id||'',site_id:p.visits[0]?.site_id||'',kind:'sample',sample_id:'',collected_at:'',method:'',custody_ref:'',notes:''};
      body=sel('Visit','visit_id',p.visits.map(v=>[v.id,(p.sites.find(s=>s.id===v.site_id)?.label||v.site_id)+' · '+(v.planned_date||v.id)]),r.visit_id)+'<p>The selected visit supplies this activity’s site.</p>'+sel('Activity kind','kind',['sample','measurement','inspection','photo'].map(x=>[x,x]),r.kind)+f('Original sample ID','sample_id',r.sample_id)+f('Actual collection timestamp','collected_at',r.collected_at,'text','','Preserve the recorded timezone.')+f('Method / instrument','method',textObject(r.method))+f('Custody reference','custody_ref',r.custody_ref)+ta('Notes','notes',r.notes);
    }else if(kind==='observations'){
      const r=row||{activity_id:p.activities[0]?.id||'',parameter:'',result_type:'numeric',value:null,original_text:'',unit:'',basis:'',fraction:'',qualifier:'',detection_limit:null,quantitation_limit:null,method:'',qa_status:'',notes:''};
      body=sel('Original activity','activity_id',p.activities.map(a=>[a.id,(a.sample_id||a.id)+' · '+a.kind]),r.activity_id)+f('Parameter / characteristic','parameter',r.parameter,'text','required')+sel('Reported result type','result_type',[['numeric','Numeric'],['censored','Censored / below limit'],['text','Text result'],['missing','Missing result']],r.result_type)+f('Original reported text','original_text',r.original_text,'text','','Required for numeric, censored and text results. Leave empty only for an unreported result.')+f('Numeric value','value',r.value,'number','step="any" '+(r.result_type==='numeric'?'':'disabled'))+f('Original unit','unit',r.unit)+f('Chemical basis','basis',r.basis,'text','','For example: as N, as P; retain the source wording.')+f('Sample fraction','fraction',r.fraction)+f('Qualifier / detection condition','qualifier',r.qualifier)+f('Detection limit','detection_limit',r.detection_limit,'number','min="0" step="any"')+f('Quantitation limit','quantitation_limit',r.quantitation_limit,'number','min="0" step="any"')+f('Method','method',textObject(r.method))+f('Quality status','qa_status',textObject(r.qa_status))+ta('Notes','notes',r.notes);
    }else if(kind==='candidates'){
      if(row)body=f('Candidate label','label',row.label,'text','required')+'<details><summary>Original candidate record</summary><pre>'+esc(JSON.stringify({area_ha:row.area_ha??null,source:row.source,modeled_benefits:row.modeled_benefits},null,2))+'</pre></details>';
      else body=f('Candidate label','label','','text','required')+f('Original candidate ID','native_id','','text','required')+f('Source reference','reference','','text','required')+f('Whole candidate area (ha)','area_ha','','number','min="0" step="any"')+ta('Original source snapshot (JSON)','source_snapshot','{}','Paste the original candidate record; all fields are retained. Native selection import handles saved community/conservation exports automatically.');
    }else if(kind==='source_links'){
      if(row)body=f('Title','label',row.label,'text','required')+'<details><summary>Original source reference</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details>';
      else body=f('Title','label','','text','required')+sel('Source kind','kind',[['record','Record'],['guidance','Guidance'],['dataset','Dataset'],['plan','Plan'],['method','Method']],'record')+f('Original reference','reference','','text','required');
    }
    const unavailable=kind==='source-import'&&(!this.selectionDraft?.preview||this.selectionDraft.loading||!(this.selectionDraft.selected_ids||[]).length);
    this.dialog('<form data-impl-form="'+esc(kind)+'" data-id="'+esc(id||'')+'"><h3>'+esc(title)+'</h3><div class="iw-form-grid">'+body+'</div><div class="iw-dialog-actions"><button type="submit" class="iw-primary" '+(unavailable?'disabled':'')+'>'+(kind==='source-import'?'Import chosen rows':'Save')+'</button>'+button('close-dialog','Cancel')+(row&&!['candidates','source_links'].includes(kind)?button('delete','Remove record','data-collection="'+kind+'" data-id="'+esc(id)+'"','iw-remove'):'')+'</div></form>');
    if(kind==='source-import')this.syncSourceSelection?.();
  }
export async function saveImplementationForm(form){
    const kind=form.dataset.implForm,id=form.dataset.id,values=Object.fromEntries(new FormData(form)),v=n=>values[n]||'',existing=id?clone(this.plan[kind].find(r=>r.id===id)):null;
    if(kind==='settings'){const p=clone(this.plan);p.title=v('title').trim();p.description=v('description');p.start_date=v('start_date');if(v('target_date'))p.target_date=v('target_date');else delete p.target_date;p.working_days=list(v('working_days')).map(Number);p.holidays=list(v('holidays'));this.commitLocal(p);return;}
    if(kind==='method'){this.commitLocal(applyMethod(this.plan,this.catalog,v('method_id'),v('candidate_id')),'Complete method steps added. Enter local durations, costs and assignments.');return;}
    if(kind==='field-form'){
      const template=this.catalog.field_forms.find(f=>f.id===v('fieldform_template')),visit=this.plan.visits.find(x=>x.id===v('visit_id'));
      if(!template||!visit)throw Error('Select a field form and an existing visit.');
      if(!v('collected_at')||!Number.isFinite(Date.parse(v('collected_at')))||!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(v('collected_at')))throw Error('Enter the actual timestamp with its timezone.');
      const activityKind=v('kind')||'inspection',sampleId=optionalText(v('sample_id')),taskId=v('task_id')||null;
      if(activityKind==='sample'&&!sampleId)throw Error('Record the original sample ID for this sample activity.');
      if(taskId&&!this.plan.tasks.some(t=>t.id===taskId))throw Error('Select a work task in this plan.');
      const p=clone(this.plan),activityId=uid('field-activity'),answers={},rawAnswers={},observations=[];
      for(const item of template.fields){
        const key='answer__'+item.key,raw=item.type==='attachment_refs'?new FormData(form).getAll(key).map(String).join('\n'):v(key),text=raw.trim(),unitRaw=v(key+'__unit'),unit=unitRaw.trim();
        rawAnswers[item.key]=raw;
        if(item.type==='quantity')rawAnswers[item.key+'__unit']=unitRaw;
        if(item.required&&!text)throw Error('Complete '+item.label+'.');
        if(!text)continue;
        if(['quantity','integer','number'].includes(item.type)){
          const resultUnit=item.type==='quantity'?unit:(item.unit||'1');
          if(!resultUnit)throw Error('Record the original unit for '+item.label+'.');
          const value=catalogNumber(item,text);
          answers[item.key]={value,unit:resultUnit,original_text:raw};
          observations.push({id:uid('field-result'),activity_id:activityId,parameter:item.label,result_type:'numeric',value,original_text:raw,unit:resultUnit,method:'Field form '+template.id+' '+template.version,qa_status:'field_record',notes:''});
        }else{
          if(item.type==='choice'&&!(item.choices||[]).includes(text))throw Error('Choose a listed answer for '+item.label+'.');
          if(item.type==='date')civil(text);
          if(item.type==='monitoring_plan_ref'){
            const monitor=p.monitoring_plans.find(m=>m.id===text);
            if(!monitor)throw Error('Choose an existing monitoring plan for '+item.label+'.');
            if(!monitor.site_ids.includes(visit.site_id))throw Error('The selected monitoring plan must contain this visit site.');
          }
          if(item.type==='activity_refs'||item.type==='attachment_refs'){
            const references=lines(raw);
            if(item.type==='activity_refs')for(const reference of references){
              const linked=p.activities.find(a=>a.id===reference);
              if(!linked||linked.visit_id!==visit.id||linked.site_id!==visit.site_id)throw Error('Activity '+reference+' must exist at this visit and site.');
            }
            if(item.type==='attachment_refs'&&references.some(reference=>!p.source_links.some(link=>link.id===reference&&link.kind==='local_file')))throw Error('Choose attached original files for '+item.label+'.');
            answers[item.key]={references,original_text:raw};
          }else answers[item.key]=raw;
          observations.push({id:uid('field-result'),activity_id:activityId,parameter:item.label,result_type:'text',value:null,original_text:raw,unit:'',method:'Field form '+template.id+' '+template.version,qa_status:'field_record',notes:''});
        }
      }
      p.activities.push({id:activityId,visit_id:visit.id,site_id:visit.site_id,kind:activityKind,sample_id:sampleId,collected_at:v('collected_at'),method:'Field form '+template.id+' '+template.version,notes:'',implementation_task_id:taskId,evidence_refs:[...new Set(Object.values(answers).flatMap(answer=>Array.isArray(answer?.references)?answer.references.filter(reference=>p.source_links.some(link=>link.id===reference&&link.kind==='local_file')):[]))],form_response:{catalog_id:this.catalog.id,catalog_version:this.catalog.version,template:clone(template),answers,raw_answers:rawAnswers,recorded_at:new Date().toISOString()}});
      p.observations.push(...observations);this.commitLocal(p,'Structured field activity and original results recorded.');return;
    }
    if(kind==='source-import'){
      if(this.dirty||!this.nativePlan)throw Error('Save this plan’s native revision before attaching a native source selection.');
      const draft=this.selectionDraft,preview=draft?.preview;
      if(!preview||draft.loading||draft.choice!==v('source_choice'))throw Error('Read the selected source before choosing its rows.');
      const selectedIds=[...new Set(new FormData(form).getAll('source_row').map(String))],available=new Set(preview.rows.map(row=>row.id));
      if(!selectedIds.length)throw Error('Choose at least one original source row to import.');
      if(selectedIds.some(key=>!available.has(key)))throw Error('The selected rows differ from the current source preview. Read the source again.');
      if(!/^[a-f0-9]{64}$/.test(preview.source_digest||''))throw Error('The source preview did not return its retained edition. Read the source again.');
      await this.queue('implementation.selection.import',{id:this.plan.id,expected_revision:this.plan.revision,source_id:preview.source_id,kind:preview.kind,selected_ids:selectedIds,expected_source_digest:preview.source_digest});
      if(this.gone)return;
      this.selectionDraft=null;this.selectionPreviewTurn++;
      this.root.querySelector('dialog[open]')?.close();this.render();return;
    }
    const row=existing||{id:uid(kind.replaceAll('_','-'))};
    if(kind==='tasks')Object.assign(row,{title:v('title').trim(),candidate_id:v('candidate_id')||null,phase:v('phase'),assignee:v('assignee'),status:v('status'),duration_days:v('duration_days')===''?null:finite(v('duration_days'),'Duration'),depends_on:list(v('depends_on')),progress_pct:finite(v('progress_pct'),'Progress')??0,notes:v('notes'),evidence_refs:row.evidence_refs||[]});
    if(kind==='tasks'){if(v('start_not_before'))row.start_not_before=v('start_not_before');else delete row.start_not_before;if(row.status==='complete')row.progress_pct=100;}
    if(kind==='budget_lines')Object.assign(row,{kind:v('kind'),label:v('label'),task_id:v('task_id')||null,amount_minor:parseMoney(v('amount')),date:v('date')||null,reference:optionalText(v('reference'))});
    if(kind==='sites'){
      const latitude=finite(v('latitude'),'Latitude'),longitude=finite(v('longitude'),'Longitude'),crs=v('coordinate_reference_system');
      const changed=!existing||latitude!==(existing.latitude??null)||longitude!==(existing.longitude??null);
      if((latitude!==null||longitude!==null)&&changed&&!['EPSG:4326','EPSG:4269','EPSG:4267','EPSG:4258'].includes(crs))throw Error('Declare the original geographic coordinate system before changing coordinate values. No datum is inferred or transformed.');
      if(existing?.coordinate_reference_system&&!crs&&(latitude!==null||longitude!==null))throw Error('Preserve the original coordinate declaration while its coordinate values remain.');
      Object.assign(row,{label:v('label'),candidate_id:v('candidate_id')||null,latitude,longitude,source_ref:v('source_ref')||null});
      if(crs)row.coordinate_reference_system=crs;else delete row.coordinate_reference_system;
    }
    if(kind==='monitoring_plans')Object.assign(row,{title:v('title'),objective:v('objective'),site_ids:list(v('site_ids')),parameters:lines(v('parameters')),method_ref:v('method_ref'),frequency:v('frequency'),notes:v('notes')});
    if(kind==='visits')Object.assign(row,{site_id:v('site_id'),monitoring_plan_id:v('monitoring_plan_id')||null,planned_date:v('planned_date')||null,visited_at:v('visited_at')||null,observer:v('observer'),status:v('status'),notes:v('notes'),evidence_refs:lines(v('evidence_refs'))});
    if(kind==='activities'){const visit=this.plan.visits.find(x=>x.id===v('visit_id'));if(!visit)throw Error('Select an existing visit for this activity.');Object.assign(row,{visit_id:visit.id,site_id:visit.site_id,kind:v('kind'),sample_id:optionalText(v('sample_id')),collected_at:v('collected_at')||null,method:optionalText(v('method')),custody_ref:optionalText(v('custody_ref')),notes:v('notes')});}
    if(kind==='observations')Object.assign(row,{activity_id:v('activity_id'),parameter:v('parameter'),result_type:v('result_type'),value:v('result_type')==='numeric'?finite(v('value'),'Measured value'):null,original_text:v('original_text'),unit:v('unit'),basis:v('basis'),fraction:v('fraction'),qualifier:v('qualifier'),detection_limit:finite(v('detection_limit'),'Detection limit'),quantitation_limit:finite(v('quantitation_limit'),'Quantitation limit'),method:v('method'),qa_status:v('qa_status'),notes:v('notes')});
    if(kind==='candidates'){if(existing)row.label=v('label').trim();else{const snapshot=JSON.parse(v('source_snapshot')||'{}');Object.assign(row,{label:v('label').trim(),area_ha:finite(v('area_ha'),'Area'),source:{native_id:v('native_id'),reference:v('reference'),original_snapshot:snapshot},modeled_benefits:[]});}}
    if(kind==='source_links'){if(existing)row.label=v('label').trim();else Object.assign(row,{label:v('label').trim(),kind:v('kind'),reference:v('reference')});}
    this.commitLocal(updateRow(this.plan,kind,row));
  }
export function implementationSourceChoices(){
    return [...(this.selectionChoices?.conservation_portfolios||[]).map(row=>({choice:'conservation_portfolio:'+row.id,kind:'conservation_portfolio',id:row.id})),...(this.selectionChoices?.community_plans||[]).map(row=>({choice:'community_plan:'+row.id,kind:'community_plan',id:row.id}))];
  }
export async function previewImplementationSource(choice){
    if(!this.native)throw Error('Open this picker in the native workspace containing the original source.');
    const source=this.sourceChoices().find(row=>row.choice===choice),previous=this.selectionDraft;
    const draft={choice:source?.choice||'',loading:!!source,preview:null,selected_ids:[],filter:previous?.choice===choice?previous.filter||'':'',error:'',notice:''};
    this.selectionDraft=draft;
    const request=++this.selectionPreviewTurn,turn=this.generation,planId=this.plan.id;
    this.openDialog('source-import');
    if(!source)return;
    const current=()=>!this.gone&&turn===this.generation&&this.plan?.id===planId&&request===this.selectionPreviewTurn&&this.selectionDraft===draft&&!!this.root.querySelector('dialog[open] [data-impl-form="source-import"]');
    try{
      const result=await this.read('/api/implementation/selection-preview',{kind:source.kind,source_id:source.id});
      if(!current())return;
      const preview=result.preview||result,ids=new Set();
      if(preview.schema!=='upstate.implementation-selection-preview/v1'||preview.kind!==source.kind||preview.source_id!==source.id||!/^[a-f0-9]{64}$/.test(preview.source_digest||'')||!Array.isArray(preview.rows))throw Error('The original source preview is incomplete. Read the saved selection again.');
      for(const row of preview.rows){
        if(!row||typeof row.id!=='string'||!row.id||typeof row.label!=='string'||!row.label||ids.has(row.id))throw Error('The original source preview contains an invalid or duplicate row.');
        ids.add(row.id);
      }
      const same=previous?.choice===choice&&previous.preview?.source_digest===preview.source_digest;
      draft.preview=preview;draft.loading=false;
      draft.selected_ids=same?(previous.selected_ids||[]).filter(id=>ids.has(id)):preview.rows.filter(row=>row.default_selected===true).map(row=>row.id);
      if(previous?.preview&&!same)draft.notice='The saved source edition changed. Review its current rows and choose the work to import.';
      this.openDialog('source-import');
    }catch(error){
      if(!current())return;
      draft.loading=false;draft.error=error?.message||String(error);this.openDialog('source-import');
    }
  }
export function syncImplementationSource(){
    const form=this.root.querySelector('dialog[open] [data-impl-form="source-import"]'),draft=this.selectionDraft;
    if(!form||!draft)return;
    const available=new Set((draft.preview?.rows||[]).map(row=>row.id));
    draft.selected_ids=[...form.querySelectorAll('input[name="source_row"]:checked')].map(input=>input.value).filter(id=>available.has(id));
    draft.filter=form.elements.source_filter?.value||'';
    const query=draft.filter.trim().toLocaleLowerCase();let visible=0;
    for(const row of form.querySelectorAll('[data-source-row]')){row.hidden=!!query&&!row.dataset.sourceSearch.includes(query);if(!row.hidden)visible++;}
    const count=form.querySelector('[data-source-selection-count]');if(count)count.textContent=draft.selected_ids.length+' of '+available.size+' rows chosen'+(query?' · '+visible+' visible':'')+'.';
    const empty=form.querySelector('[data-source-no-selection]');if(empty)empty.hidden=draft.selected_ids.length>0;
    const noMatches=form.querySelector('[data-source-no-matches]');if(noMatches)noMatches.hidden=visible>0||available.size===0;
    const submit=form.querySelector('button[type="submit"]');if(submit)submit.disabled=!draft.preview||draft.loading||!!this.pending||draft.selected_ids.length===0;
  }

