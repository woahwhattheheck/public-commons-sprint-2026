/** Retained discharge context inside the original Scenario analysis results. */
const rows=value=>Array.isArray(value)?value:[];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>JSON.parse(JSON.stringify(value));
const short=value=>String(value??'').slice(0,12);
const label=value=>String(value??'').replaceAll('_',' ');
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
const number=value=>numeric(value)?(value!==0&&Math.abs(value)<0.0001?value.toExponential(4):value.toLocaleString(undefined,{maximumFractionDigits:4})):value===null||value===undefined?'—':String(value);
const percent=value=>numeric(value)?number(value*100)+'%':'—';
const button=(action,title,extra='')=>'<button type="button" data-action="analysis-context-'+esc(action)+'" '+extra+'>'+esc(title)+'</button>';
const table=(heads,data)=>'<div class="table-scroll"><table class="analysis-table"><thead><tr>'+heads.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+data.map(row=>'<tr>'+row.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const options=(values,selected,identify,title)=>values.map(row=>'<option value="'+esc(identify(row))+'"'+(identify(row)===selected?' selected':'')+'>'+esc(title(row))+'</option>').join('');
const field=(title,body)=>'<label><span>'+esc(title)+'</span>'+body+'</label>';
const select=(name,body,disabled=false)=>'<select data-analysis-context-field="'+esc(name)+'"'+(disabled?' disabled':'')+'>'+body+'</select>';

export function createAnalysisSourceContext({getState,api,endpoint,submitAction,openItem,fileList,onChange=()=>{}}){
 const states=new Map();
 let active='',epoch=0;
 const workspace=()=>getState()?.workspace_key||'';
 const identity=record=>workspace()+':'+record.id;
 const reports=record=>rows(getState()?.data?.analysis_source_context?.reports).filter(r=>r.analysis_id===record.id);
 const bindingStamp=()=>JSON.stringify(rows(getState()?.data?.point_source_context?.bindings).map(r=>[r.id,r.source_signature]));
 function fingerprint(){
  return JSON.stringify({bindings:bindingStamp(),reports:getState()?.data?.analysis_source_context,
   tasks:rows(getState()?.tasks).filter(t=>t.action==='scenario.source_context.build')});
 }
 function context(record){
  const key=identity(record);
  if(!states.has(key))states.set(key,{catalog:null,loading:false,busy:false,error:'',preview:null,report:null,
    draft:{analysis_id:record.id,title:(record.title||'Scenario analysis')+' — original discharge context',links:[]},
    region:'reporting_area',binding:'',gauge:'',stamp:'',request:null,generation:0});
  return states.get(key);
 }
 function alive(key,state,generation,session){return active===key&&epoch===session&&state.generation===generation;}
 function notify(key){if(active===key)onChange();}
 function selectedBinding(state){return rows(state.catalog?.bindings).find(r=>r.id===state.binding);}
 function defaults(state){
  if(!rows(state.catalog?.regions).some(r=>r.id===state.region))state.region=state.catalog?.regions?.[0]?.id||'';
  if(!rows(state.catalog?.bindings).some(r=>r.id===state.binding))state.binding=state.catalog?.bindings?.[0]?.id||'';
  const gauges=selectedBinding(state)?.gauges||[];
  if(!gauges.includes(state.gauge))state.gauge=gauges[0]||'';
 }
 async function catalog(record,{fresh=false}={}){
  const key=identity(record),state=context(record);
  if(state.loading)return;
  if(state.catalog&&!fresh&&state.stamp===bindingStamp())return;
  state.request?.abort();state.request=new AbortController();const generation=++state.generation,session=epoch,ws=workspace();
  state.loading=true;state.error='';notify(key);
  try{
   const value=await api(endpoint('/api/analysis-source-context/catalog',{analysis_id:record.id}),{signal:state.request.signal});
   if(!alive(key,state,generation,session))return;
   if(value.workspace_key!==ws||value.analysis_id!==record.id)throw Error('The source catalog belongs to another retained analysis.');
   state.catalog=value;state.stamp=bindingStamp();defaults(state);
  }catch(error){if(alive(key,state,generation,session)&&error?.name!=='AbortError')state.error=error.message||String(error);}
  finally{if(state.generation===generation)state.loading=false;if(alive(key,state,generation,session))notify(key);}
 }
 function ensure(record){
  const state=context(record);
  if(!state.loading&&!state.error&&(!state.catalog||state.stamp!==bindingStamp()))void catalog(record);
 }
 function downloads(record){
  if(!record?.id)return '';
  const url=record.preview_url;
  return '<div class="page-actions">'+(url?'<a class="button" href="'+esc(url)+'" target="_blank" rel="noopener">Open printable source-context report</a>':'')+
   '</div>'+(typeof fileList==='function'?fileList(record._downloads||[]):'');
 }
 function resultHTML(value){
  if(!value)return '';
  const names=new Map(rows(value.runs).map(r=>[r.id,r.title]));
  return rows(value.links).map(link=>{
   const support=link.spatial_support;
   return '<section class="section analysis-section"><h3>'+esc(link.region.title)+' · '+esc(link.gauge_id)+'</h3>'+
    '<h4>Native landscape changes</h4><p>Signed change = alternative minus baseline. Each pollutant retains its original common valid cells across the selected runs.</p>'+
    table(['Run','Pollutant','Units','Baseline','Alternative','Signed change','Common area (ha)','Common coverage'],rows(link.native_changes).map(r=>[
      names.get(r.run_id)||short(r.run_id),label(r.pollutant),r.units,number(r.baseline_common_sum),number(r.common_sum),number(r.change),number(r.common_area_ha),percent(r.common_coverage_fraction)]))+
    '<h4>Original '+esc(link.source_calendar.calendar_year)+' discharge calendar</h4><p>'+esc(link.source_calendar.method)+'</p>'+
    table(['Relation','Species','Units','Complete annual amount','Actual quantified-period amount','Complete year','Peak complete month'],rows(link.source_calendar.groups).map(g=>[
      label(g.gauge_relation),g.parameter_name+' ('+g.parameter_code+')',g.amount_unit,number(g.annual_amount),number(g.quantified_period_amount),g.complete_year?'Yes':'Partial coverage',g.peak_complete_month||'—']))+
    '<details><summary>Monthly source quantities and actual facility shares</summary>'+
    rows(link.source_calendar.groups).map(g=>'<h4>'+esc(label(g.gauge_relation)+' · '+g.parameter_name)+'</h4>'+
      table(['Month','Quantified amount','Complete source-cohort amount','Units'],rows(g.months).map(m=>[
        m.month,number(m.quantified_amount),number(m.complete_cohort_amount),g.amount_unit]))+
      table(['Facility','Permit','Complete annual amount','Share of complete source cohort (%)'],rows(g.facility_mix).map(r=>[
        r.facility_name,r.permit_id,number(r.annual_amount),number(r.annual_share_percent)]))).join('')+'</details>'+
    '<h4>Source support and actual network relationships</h4>'+
    table(['Facility','Permit / outfall','Relation to gauge','Inside original whole-basin polygon'],rows(link.facilities).map(r=>[
      r.facility_name,r.permit_id+' / '+r.state_outfall_id,label(r.gauge_relation),r.in_original_whole_basin]))+
    '<p>Polygon intersection: '+esc(number(support.intersection_area_ha))+' ha; '+esc(percent(support.region_fraction_in_whole_basin))+
      ' of this reporting region and '+esc(percent(support.whole_basin_fraction_in_region))+' of the original whole gauge basin. Gauge point within the reporting region: '+
      (support.gauge_point_inside_or_on_region?'yes':'no')+'. Native results above retain the entire selected reporting region and its original valid-cell coverage.</p>'+
    '<div class="page-actions">'+rows(link.observations).map(row=>button('observation','Open '+row.title,'data-id="'+esc(row.id)+'"')).join('')+'</div>'+
    '<details><summary>Original geometry and quantity lineage</summary><pre>'+esc(JSON.stringify({gauge_source:link.gauge_source,sources:link.sources,source_signature:link.source_signature},null,2))+'</pre></details></section>';
  }).join('')+'<section class="section analysis-section"><h3>Interpretation</h3>'+rows(value.interpretation).map(t=>'<p>'+esc(t)+'</p>').join('')+
   '<details><summary>Retained native profiles and declared periods</summary><pre>'+esc(JSON.stringify(value.runs,null,2))+'</pre></details></section>';
 }
 function render(record){
  const key=identity(record);
  if(active!==key){
   if(states.has(active)){const old=states.get(active);old.request?.abort();old.generation++;old.loading=false;old.busy=false;}
   active=key;epoch++;
  }
  const state=context(record),catalogue=state.catalog,binding=selectedBinding(state),disabled=state.loading||state.busy;
  const saved=reports(record).length?reports(record):rows(catalogue?.reports);
  const currentValue=state.report||state.preview;
  let body='<section class="section analysis-section"><h2>Original source context</h2>'+
   '<p>Attach reported facility discharge calendars and actual gauge relationships to this saved native analysis. Review the source support beside the scenario reductions, then retain a printable contextual report.</p>'+
   '<p>The upstream source cohort is determined by the original network relationship. The whole-basin polygon supplies spatial context, including any downstream facilities that fall inside its footprint.</p>'+
   (state.error?'<p class="notice error" role="alert">'+esc(state.error)+'</p>':'')+
   button('refresh',state.loading?'Reading retained sources…':'Refresh source choices',disabled?'disabled':'');
  if(!catalogue)return body+'</section>';
  if(!catalogue.bindings.length)body+='<p>Use Point-source context to bind the retained original period, annual, relationship and cohort tables; return here to link those source records.</p>';
  else{
   body+='<div class="analysis-editor-grid">'+
    field('Context report title','<input data-analysis-context-field="title" value="'+esc(state.draft.title)+'" maxlength="240"'+(disabled?' disabled':'')+'>')+
    field('Native reporting region',select('region',options(catalogue.regions,state.region,r=>r.id,r=>r.title),disabled))+
    field('Original source binding',select('binding',options(catalogue.bindings,state.binding,r=>r.id,r=>r.calendar_year+' · '+r.original_facilities+' facilities · '+short(r.id)),disabled))+
    field('Original gauge',select('gauge',options(rows(binding?.gauges),state.gauge,r=>r,r=>r),disabled))+'</div>'+
    button('add','Link this region and source gauge',disabled?'disabled':'')+
    '<ul>'+state.draft.links.map((link,index)=>'<li>'+esc((catalogue.regions.find(r=>r.id===link.region_id)?.title||link.region_id)+' · '+link.gauge_id+' · '+short(link.binding_id))+' '+button('remove','Remove','data-index="'+index+'"'+(disabled?' disabled':''))+'</li>').join('')+'</ul>'+
    '<div class="page-actions">'+button('preview',state.busy?'Working…':'Preview native changes and source coverage',disabled||!state.draft.links.length?'disabled':'')+
    button('build','Retain contextual report',disabled||!state.preview?'disabled':'')+'</div>';
  }
  const pending=rows(getState()?.tasks).filter(t=>t.action==='scenario.source_context.build'&&t.payload?.selection?.analysis_id===record.id&&['queued','running','failed'].includes(t.state));
  if(pending.length)body+=table(['Report operation','Status','Details'],pending.map(t=>[t.payload.selection.title,label(t.state),t.error?.message||t.error||'']));
  body+='<h3>Retained contextual reports</h3>'+(saved.length?'<ul>'+saved.map(r=>'<li>'+esc(r.title)+' · '+r.link_count+' links '+button('open','Open report','data-id="'+esc(r.id)+'"')+'</li>').join('')+'</ul>':'<p>Retain a reviewed selection to make its source-aware report and downloads available.</p>')+'</section>';
  return body+downloads(state.report)+resultHTML(currentValue);
 }
 function change(event,record){
  const name=event.target.dataset?.analysisContextField;
  if(!name)return false;
  const state=context(record);
  if(name==='title')state.draft.title=event.target.value;
  else if(['region','binding','gauge'].includes(name)){state[name]=event.target.value;defaults(state);}
  else return false;
  if(name==='title'){state.preview=null;state.report=null;}
  notify(identity(record));return true;
 }
 async function inspect(record){
  const key=identity(record),state=context(record),selection=clone(state.draft),selectionKey=JSON.stringify(selection);
  state.request?.abort();state.request=new AbortController();
  const generation=++state.generation,session=epoch,ws=workspace();
  state.busy=true;state.preview=null;state.report=null;state.error='';notify(key);
  try{
   const value=await api('/api/analysis-source-context/preview',{method:'POST',body:{workspace:ws,selection},signal:state.request.signal});
   if(!alive(key,state,generation,session)||JSON.stringify(state.draft)!==selectionKey)return;
   if(value.workspace_key!==ws||value.analysis_id!==record.id)throw Error('The preview belongs to another retained analysis.');
   state.preview=value;state.draft=clone(value.selection);
  }catch(error){if(alive(key,state,generation,session)&&error?.name!=='AbortError')state.error=error.message||String(error);}
  finally{if(state.generation===generation)state.busy=false;if(alive(key,state,generation,session))notify(key);}
 }
 async function open(record,id){
  const key=identity(record),state=context(record);
  state.request?.abort();state.request=new AbortController();const generation=++state.generation,session=epoch,ws=workspace();
  state.busy=true;state.error='';notify(key);
  try{
   const value=await api(endpoint('/api/analysis-source-context/report',{report_id:id}),{signal:state.request.signal});
   if(!alive(key,state,generation,session))return;
   if(value.workspace_key!==ws||value.analysis_id!==record.id)throw Error('This retained source-context report belongs to a different analysis.');
   state.report=value;state.preview=null;
  }catch(error){if(alive(key,state,generation,session)&&error?.name!=='AbortError')state.error=error.message||String(error);}
  finally{if(state.generation===generation)state.busy=false;if(alive(key,state,generation,session))notify(key);}
 }
 async function dispatch(node,record){
  if(!record?.id)throw Error('Open a complete retained native analysis.');
  const action=node.dataset.action?.replace(/^analysis-context-/,''),state=context(record),key=identity(record);
  if(action==='observation')return openItem('observations',node.dataset.id);
  if(state.busy||state.loading)return;
  if(action==='refresh')return catalog(record,{fresh:true});
  if(action==='preview')return inspect(record);
  if(action==='open')return open(record,node.dataset.id);
  if(action==='add'){
   defaults(state);
   if(!state.region||!state.binding||!state.gauge)throw Error('Select an original region, source binding and gauge.');
   const link={region_id:state.region,binding_id:state.binding,gauge_id:state.gauge};
   if(state.draft.links.some(r=>JSON.stringify(r)===JSON.stringify(link)))throw Error('This original region and gauge are already linked.');
   state.draft.links.push(link);state.preview=null;state.report=null;state.error='';notify(key);return;
  }
  if(action==='remove'){
   const index=Number(node.dataset.index);
   if(!Number.isInteger(index)||index<0||index>=state.draft.links.length)throw Error('Select an existing source-context link.');
   state.draft.links.splice(index,1);state.preview=null;state.report=null;state.error='';notify(key);return;
  }
  if(action==='build'){
   if(!state.preview||JSON.stringify(state.preview.selection)!==JSON.stringify(state.draft))throw Error('Preview this exact original source-context selection first.');
   const generation=state.generation,session=epoch;
   state.busy=true;state.error='';notify(key);
   try{await submitAction('scenario.source_context.build',{selection:clone(state.preview.selection),source_signature:state.preview.source_signature});}
   catch(error){if(alive(key,state,generation,session))state.error=error.message||String(error);}
   finally{if(alive(key,state,generation,session)){state.busy=false;notify(key);}}
   return;
  }
  throw Error('Choose an available source-context action.');
 }
 function detach(){epoch++;active='';for(const state of states.values()){state.request?.abort();state.generation++;state.loading=false;state.busy=false;}}
 return {render,ensure,change,dispatch,detach,fingerprint};
}
