/** Source-bound flow/storage preparation in the original Chemistry desk. */
export function createWaterDesk(host) {
 const {api,endpoint,perform,captureContext,currentContext,original,fileList,openCase}=host;
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const clone=x=>JSON.parse(JSON.stringify(x));
 const button=(a,t,id='')=>`<button type="button" data-action="chemistry-water-${a}" data-id="${esc(id)}">${esc(t)}</button>`;
 const option=(value,label,selected)=>`<option value="${esc(value)}"${selected?' selected':''}>${esc(label)}</option>`;
 let root=null,catalog=null,caseRecord=null,preview=null,epoch=0,request=0,draft=null,owner=null;
 const storageKey=()=>`upstate-chemistry-water-v1:${owner.key}`;
 function live(token,version=epoch){return root&&token===owner&&currentContext(token)&&version===epoch;}
 function retained(){try{return JSON.parse(localStorage.getItem(storageKey())||'null')}catch{return null}}
 function save(){if(!root||!owner)return;draft=collect();localStorage.setItem(storageKey(),JSON.stringify(draft));}
 const choiceLabels={
  delimiter:{',':'Comma (,)',';':'Semicolon (;)','tab':'Tab','|':'Vertical bar (|)'},
  format:{'cwms-json':'Original CWMS JSON','csv':'Delimited text (CSV)'},
  units:{'cms':'Cubic metres per second (cms)','m3/s':'Cubic metres per second (m3/s)','cfs':'Cubic feet per second (cfs)','m3/day':'Cubic metres per day (m3/day)','m3':'Cubic metres (m3)','ac-ft':'Acre-feet (ac-ft)','acre-ft':'Acre-feet (acre-ft)'},
  value_support:{'interval-ending':'Average over the interval ending at the timestamp','instantaneous':'Instantaneous value at the timestamp'},
  quality_type:{'integer':'Whole-number quality codes','text':'Text quality codes'},
  timestamp_format:{'iso8601':'ISO 8601 date and time','unix-ms':'Milliseconds since 1 January 1970 UTC','unix-seconds':'Seconds since 1 January 1970 UTC'},
  template_period_policy:{'repeat-single-phase':'Repeat the original chemical inputs in every water period'},
  signed_value_policy:{'mean-preserve-signed-originals':'Average every signed original value, including negative readings'}
 };
 const observationLabels={'retained':'Eligible original observation','missing':'No observation at this boundary','quality-excluded':'Quality code excluded by the selection','nonpositive':'Zero or negative original storage'};
 function options(rows,selected,labels={}){return option('','Choose explicitly',!selected)+rows.map(x=>option(x,labels[x]??x,x===selected)).join('')}
 function field(name,label,value='',type='text'){return `<label>${esc(label)}<input data-w="${esc(name)}" type="${type}" value="${esc(value)}"></label>`}
 function select(name,label,rows,value){return `<label>${esc(label)}<select data-w="${esc(name)}">${options(rows,value,choiceLabels[name]||{})}</select></label>`}
 const get=(node,name)=>node.querySelector(`[data-w="${name}"]`)?.value??'';
 function sources(){return (catalog.sources||[]).flatMap(c=>(c.entries||[]).map(e=>({key:JSON.stringify({source_collection_id:c.id,source_id:e.id}),label:c.title+' / '+(e.title||e.id)})))}
 function binding(row,type){
  const old=(type==='flow'?draft.flow_bindings:draft.storage_bindings)?.find(x=>x[type==='flow'?'flow_id':'reach_id']===row.id);
  const b=old||{},choices=new Set((b.sources||[]).map(x=>JSON.stringify(x))),cols=b._columns||[],isCSV=b.format==='csv';
  return `<details data-water-binding data-type="${type}" data-id="${esc(row.id)}" ${old?'open':''}><summary>${type==='flow'?'Flow':'Initial storage'}: ${esc(row.id)}${type==='flow'?' · '+esc((row.source??'boundary')+' → '+(row.target??'boundary')):''}</summary>
   <label class="water-check"><input data-w="enabled" type="checkbox" ${old?'checked':''}> Bind original ${type==='flow'?'flow observations':'storage observations'}</label>
   <label>Retained original source files<select data-w="sources" multiple size="5">${sources().map(s=>option(s.key,s.label,choices.has(s.key))).join('')}</select></label>
   <p class="chemistry-muted">Use the existing Sources intake to retain your own files. Select successive original files for this one series; overlapping records must agree exactly.</p>
   ${select('delimiter','CSV delimiter',[',',';','tab','|'],b.delimiter==='\t'?'tab':(b.delimiter||','))}
   ${button('inspect','Preview original columns and rows',type+':'+row.id)}<div data-water-original>${b._preview?originalView(b._preview):''}</div>
   <div class="chemistry-columns">${select('format','Original format',['cwms-json','csv'],b.format||'')}
   ${field('name','Exact series name / your series label',b.name)}${field('office','Original office / your source organization',b.office)}
   ${select('units',type==='flow'?'Original flow units':'Original storage units',type==='flow'?['cms','m3/s','cfs','m3/day']:['m3','ac-ft','acre-ft'],b.units)}
   ${field('interval_seconds','Original interval (seconds)',b.interval_seconds??'','number')}
   ${select('value_support','Meaning of each value',[type==='flow'?'interval-ending':'instantaneous'],b.value_support)}
   ${select('quality_type','Original quality-code type',['integer','text'],b.quality_type||'integer')}
   ${field('quality_codes','Included quality codes (one per line or comma separated)',(b.quality_codes||[]).join(','))}</div>
   <div data-water-csv ${isCSV?'':'hidden'}><h4>Map your original CSV columns</h4><div class="chemistry-columns">
   ${select('column_timestamp','Timestamp column',cols,b.columns?.timestamp)}${select('column_value','Value column',cols,b.columns?.value)}
   ${select('column_quality','Quality column (optional)',cols,b.columns?.quality)}
   ${select('timestamp_format','Timestamp format',['iso8601','unix-ms','unix-seconds'],b.timestamp_format)}
   ${field('timezone_offset','Fixed UTC offset for timestamps without one',b.timezone_offset||'')}
   ${field('unflagged_quality_code','Explicit code if no quality column',b.unflagged_quality_code??'')}
   <label>Missing-value tokens (one per line; include a blank line for empty cells)<textarea data-w="missing_tokens">${esc((b.missing_tokens||['']).join('\n'))}</textarea></label>
   </div></div></details>`;
 }
 function originalView(value){
  const columns=value.format==='csv'?value.columns:value.columns.map(x=>x.name);
  return `<p>${esc(value.rows)} original rows · ${esc(value.bytes)} bytes · <code>${esc(value.sha256)}</code></p>
   <p>${value.format==='csv'?'Map the original columns below.':esc(value.name)+' · '+esc(value.office)+' · '+esc(value.units)+' · '+esc(value.interval)}</p>
   <div class="chemistry-scroll"><table><thead><tr>${columns.map(x=>'<th>'+esc(x)+'</th>').join('')}</tr></thead><tbody>${value.sample.map(r=>'<tr>'+r.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')}</tbody></table></div>
   ${value.quality_codes?'<p>Original quality codes: '+esc(value.quality_codes.join(', '))+'. Choose eligible codes explicitly; this preview does not interpret them.</p>':''}`;
 }
 function collect(){
  const value={schema:'upstate.receiving-water-chemistry-selection/v1',template_case_id:caseRecord?.id||draft?.template_case_id||'',
   title:get(root,'title'),reason:get(root,'reason'),begin:get(root,'begin'),end:get(root,'end'),period_hours:Number(get(root,'period_hours')),
   template_period_policy:get(root,'template_period_policy'),signed_value_policy:get(root,'signed_value_policy'),flow_bindings:[],storage_bindings:[]};
  for(const area of root.querySelectorAll('[data-water-binding]')){
   if(!area.querySelector('[data-w=enabled]').checked)continue;
   const type=area.dataset.type,quality_type=get(area,'quality_type'),numberOrText=x=>quality_type==='integer'&&x!==''?Number(x):x;
   const previous=(draft?.[type==='flow'?'flow_bindings':'storage_bindings']||[]).find(x=>x[type==='flow'?'flow_id':'reach_id']===area.dataset.id)||{};
   const b={...previous,[type==='flow'?'flow_id':'reach_id']:area.dataset.id,
    sources:[...area.querySelector('[data-w=sources]').selectedOptions].map(x=>JSON.parse(x.value)),
    format:get(area,'format'),name:get(area,'name'),office:get(area,'office'),units:get(area,'units'),
    interval_seconds:Number(get(area,'interval_seconds')),value_support:get(area,'value_support'),quality_type,
    quality_codes:get(area,'quality_codes').split(/[\n,]/).map(x=>x.trim()).filter(Boolean).map(numberOrText),
    delimiter:get(area,'delimiter')==='tab'?'\t':get(area,'delimiter'),
    columns:{timestamp:get(area,'column_timestamp'),value:get(area,'column_value'),quality:get(area,'column_quality')},
    timestamp_format:get(area,'timestamp_format'),timezone_offset:get(area,'timezone_offset'),
    unflagged_quality_code:numberOrText(get(area,'unflagged_quality_code')),
    missing_tokens:get(area,'missing_tokens').split('\n')};
   value[type==='flow'?'flow_bindings':'storage_bindings'].push(b);
  }
  return value;
 }
 function selection(){
  const v=collect();
  for(const b of [...v.flow_bindings,...v.storage_bindings]){delete b._columns;delete b._preview;}
  return v;
 }
 function setStatus(message,error=false){const node=root?.querySelector('[data-water-status]');if(node){node.textContent=message;node.setAttribute('role',error?'alert':'status')}}
 function invalidate(){epoch++;preview=null;const node=root?.querySelector('[data-water-preview]');if(node)node.innerHTML='<p>Preview the current source and period selection before saving.</p>';save();}
 function render(){
  if(!root)return;
  root.innerHTML=`<section class="water-desk"><h2>Receiving-water source periods</h2><p>Open original flow and storage files, map their actual columns and units, then preview the complete periods in the existing chemical scenario. Boundary concentrations, species and reaction choices stay in that scenario.</p>
  <p data-water-status role="status"></p><label>Original chemical template<select data-water-template>${option('','Choose a saved one-phase chemical scenario',!draft.template_case_id)}${catalog.cases.map(c=>option(c.id,c.title,c.id===draft.template_case_id)).join('')}</select></label>
  ${button('template','Open selected chemical template')}<p class="chemistry-muted">Choose a template with one chemical phase. Its original loads, reactions, concentrations and starting chemical masses are repeated explicitly over the selected water periods.</p>
  ${caseRecord?`<p><strong>${esc(caseRecord.title)}</strong> · original case <code>${esc(caseRecord.id)}</code></p>
  <div class="chemistry-columns">${field('title','New scenario title',draft.title)}${field('reason','Source and modeling selection reason',draft.reason)}
  ${field('begin','Begin timestamp with UTC offset',draft.begin)}${field('end','End timestamp with UTC offset',draft.end)}
  ${field('period_hours','Duration of each flow period (hours)',draft.period_hours??'','number')}
  ${select('template_period_policy','Chemical template across periods',['repeat-single-phase'],draft.template_period_policy)}
  ${select('signed_value_policy','Treatment of original signed values',['mean-preserve-signed-originals'],draft.signed_value_policy)}</div>
  <p>Later storage observations are comparisons. Only the exact initial observation sets model volume; each subsequent phase continues its water balance.</p>
  ${(caseRecord.project.flows||[]).map(row=>binding(row,'flow')).join('')}
  ${(caseRecord.project.reaches||[]).map(row=>binding(row,'storage')).join('')}
  <div class="chemistry-actions">${button('preview','Preview periods and water balance')}${button('prepare','Save prepared chemical scenario')}</div>
  <div data-water-preview><p>Preview the selected original data before saving.</p></div>`:'<p>Select an original scenario to open its flow and reach mapping.</p>'}
  <h3>Saved source-period preparations</h3><div data-water-saved>${savedList()}</div><div data-water-opened></div></section>`;
  // A single delegated listener per render; all fields, including disabled ones during dispatch,
  // are read directly so the maintained host's busy lock cannot erase submitted values.
  root.oninput=changed;root.onchange=changed;
 }
 function changed(event){
  if(event.target.matches('[data-water-template]')){epoch++;preview=null;return;}
  const area=event.target.closest('[data-water-binding]');
  if(area&&event.target.matches('[data-w=format]'))area.querySelector('[data-water-csv]').hidden=event.target.value!=='csv';
  if(event.target.matches('[data-w]')){try{invalidate()}catch(error){setStatus('Draft could not be saved: '+error.message,true)}}
 }
 function savedList(){return (catalog.water_preparations||[]).map(x=>`<p>${button('open',x.title,x.id)} · ${button('case','Open chemical scenario',x.case_id)}</p>`).join('')||'<p>No source-period preparation saved yet.</p>'}
 function previewView(value){
  const rows=value.support.periods.flatMap(p=>p.storage.map(r=>({period:p.period,begin:p.begin,end:p.end,reach:r.reach,initial:r.initial_volume_m3,inflow:r.inflow_m3_day,outflow:r.outflow_m3_day,predicted:r.predicted_volume_m3,observed:r.observed_storage?.volume_m3,observedState:r.observed_storage?.state,difference:r.observed_minus_predicted_m3,flows:p.flows})));
  const cols=[['period','Period'],['begin','Begin (UTC)'],['end','End (UTC)'],['reach','Reach'],['initial','Initial storage (m³)'],['inflow','Inflow (m³/day)'],['outflow','Outflow (m³/day)'],['predicted','Flow-derived storage (m³)'],['observed','Original observed storage (m³)'],['observedState','Observation eligibility'],['difference','Eligible observed − predicted (m³)']];
  const errors=value.errors.length?'<h4>Selections requiring attention</h4>'+value.errors.map(x=>'<p><strong>'+esc([x.period!==undefined?'Period '+x.period:'',x.flow_id?'Flow '+x.flow_id:'',x.reach?'Reach '+x.reach:''].filter(Boolean).join(' · '))+'</strong> '+esc(x.reason||'Review the complete source support below.')+'</p>').join(''):'<p>Every selected interval is present and eligible; every phase retains positive storage.</p>';
  return `<h3>${value.state==='ready'?'Source periods ready':'Source selection needs correction'}</h3>${errors}<p>${rows.length} reach-period rows. Flow is m³/day; stored water and differences are m³. Original signed values, quality codes and units remain attached.</p>
   <div class="chemistry-scroll"><table><thead><tr>${cols.map(([,label])=>'<th>'+esc(label)+'</th>').join('')}</tr></thead><tbody>${rows.map(r=>'<tr>'+cols.map(([k])=>'<td>'+esc(typeof r[k]==='number'?r[k].toPrecision(9):k==='observedState'?(observationLabels[r[k]]??r[k]??'No storage series selected'):r[k])+'</td>').join('')+'</tr>').join('')}</tbody></table></div>
   <details><summary>Complete original interval support and source identities</summary><pre>${esc(JSON.stringify(value.support,null,2))}</pre></details>`;
 }
 async function act(action,id){
  const context=owner,version=epoch,sequence=++request;
  if(!live(context,version))throw Error('Reopen the original Chemistry workspace.');
  if(action==='template'){
   const selected=root.querySelector('[data-water-template]').value;if(!selected)throw Error('Choose an original chemical scenario.');
   const value=await original('case',{case_id:selected},context,selected);
   if(!live(context,version)||sequence!==request)return;
   if(value.project.phases?.length!==1)throw Error('Choose a one-phase chemical template, or create a distinct explicitly aligned one-phase scenario using the existing scenario controls.');
   if(draft.template_case_id!==selected)draft={template_case_id:selected,flow_bindings:[],storage_bindings:[],title:value.title+' — source periods',reason:'',begin:'',end:'',period_hours:'',template_period_policy:'',signed_value_policy:''};
   caseRecord=value;render();save();return;
  }
  if(action==='case')return openCase(id);
  if(action==='open'){
   const value=await original('water-preparation',{preparation_id:id},context,id);
   if(!live(context,version)||sequence!==request)return;
   root.querySelector('[data-water-opened]').innerHTML=`<h3>${esc(value.title)}</h3><p>${esc(value.reason)}</p><p>${button('case','Open original prepared chemical scenario',value.case_id)}</p>${fileList(value._downloads||[])}`;return;
  }
  if(!caseRecord)throw Error('Open the chemical template first.');
  if(action==='inspect'){
   save();const area=[...root.querySelectorAll('[data-water-binding]')].find(x=>x.dataset.type+':'+x.dataset.id===id);
   const selected=area&&[...area.querySelector('[data-w=sources]').selectedOptions].map(x=>JSON.parse(x.value));
   if(!selected?.length)throw Error('Choose original retained source files.');
   const chosen=JSON.stringify(selected),delimiter=get(area,'delimiter')==='tab'?'\t':get(area,'delimiter');
   const value=await original('water-source',{...selected[0],delimiter},context);
   if(!live(context,version)||sequence!==request||chosen!==JSON.stringify([...area.querySelector('[data-w=sources]').selectedOptions].map(x=>JSON.parse(x.value))))return;
   area.querySelector('[data-w=enabled]').checked=true;area.querySelector('[data-w=format]').value=value.format;
   if(value.format==='cwms-json'){
    for(const key of ['name','office','units'])area.querySelector(`[data-w=${key}]`).value=value[key]||'';
    const match=/^PT(\d+)([HS])$/.exec(value.interval||'');if(match)area.querySelector('[data-w=interval_seconds]').value=Number(match[1])*(match[2]==='H'?3600:1);
    area.querySelector('[data-w=quality_type]').value='integer';
   }else{
    for(const key of ['timestamp','value','quality']){const node=area.querySelector('[data-w=column_'+key+']'),old=node.value;node.innerHTML=options(value.columns,old);}
   }
   area.querySelector('[data-water-csv]').hidden=value.format!=='csv';
   area.querySelector('[data-water-original]').innerHTML=originalView(value);
   draft=collect();const row=draft[area.dataset.type==='flow'?'flow_bindings':'storage_bindings'].find(x=>x[area.dataset.type==='flow'?'flow_id':'reach_id']===area.dataset.id);
   row._preview=value;row._columns=value.format==='csv'?value.columns:[];
   epoch++;preview=null;localStorage.setItem(storageKey(),JSON.stringify(draft));setStatus('Original source opened. Select its support, quality eligibility and mapped columns explicitly.');return;
  }
  const selected=selection();save();
  if(action==='preview'){
   setStatus('Reading every original selected interval…');
   const value=await api('/api/chemistry/water-preview',{method:'POST',body:{workspace:context.key,selection:selected}});
   if(!live(context,version)||sequence!==request)return;
   if(value.workspace_key!==context.key||JSON.stringify(selection())!==JSON.stringify(selected))throw Error('The source-period response belongs to a different selection.');
   preview={selection:clone(selected),value};
   root.querySelector('[data-water-preview]').innerHTML=previewView(value);
   setStatus(value.state==='ready'?'Review the source support, then save this scenario.':'Correct the listed source-period selections.');return;
  }
  if(action==='prepare'){
   if(!preview||preview.value.state!=='ready'||JSON.stringify(preview.selection)!==JSON.stringify(selected))throw Error('Preview the current complete selection before saving.');
   await perform('water.prepare',{selection:selected},context);return;
  }
 }
 return {
  mount(element,value){root=element;catalog=value;owner=captureContext();epoch++;draft=retained()||{flow_bindings:[],storage_bindings:[]};caseRecord=null;render();},
  async restore(){if(draft?.template_case_id){root.querySelector('[data-water-template]').value=draft.template_case_id;await act('template');}},
  update(value){
   catalog=value;if(!root)return;
   const keepOptions=(node,rows)=>{
    const selected=new Set([...node.selectedOptions].map(x=>x.value)),prior=new Map([...node.options].map(x=>[x.value,x.textContent]));
    const known=new Set(rows.map(x=>x.value));
    for(const chosen of selected)if(chosen&&!known.has(chosen))rows.push({value:chosen,label:(prior.get(chosen)||chosen)+' (retained selection)'});
    node.innerHTML=rows.map(x=>option(x.value,x.label,selected.has(x.value))).join('');
   };
   const template=root.querySelector('[data-water-template]');
   if(template)keepOptions(template,[{value:'',label:'Choose a saved one-phase chemical scenario'},...catalog.cases.map(x=>({value:x.id,label:x.title}))]);
   const choices=sources().map(x=>({value:x.key,label:x.label}));
   for(const node of root.querySelectorAll('[data-water-binding] [data-w=sources]'))keepOptions(node,choices.map(x=>({...x})));
   const target=root.querySelector('[data-water-saved]');if(target)target.innerHTML=savedList();
  },
  dispatch(action,id){return act(action,id)},
  detach(){epoch++;request++;if(root){root.oninput=null;root.onchange=null}root=null;owner=null;}
 };
}
