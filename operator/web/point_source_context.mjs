/* Original retained point-source source binding, using the existing observation editions. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keys=['periods','annual','relations','cohorts'];
const titles={periods:'Original reported periods',annual:'Annual quantities with network relation',relations:'Outfall-to-gauge relationships',cohorts:'Quantities by gauge cohort'};
const amount=v=>v===null||v===undefined||v===''?'—':esc(v);
const short=v=>String(v||'').slice(0,12);
const button=(action,label,id='',disabled=false)=>'<button type="button" data-action="point-source-context-'+esc(action)+'" data-id="'+esc(id)+'"'+(disabled?' disabled':'')+'>'+esc(label)+'</button>';
const table=(headers,rows)=>'<div class="point-source-table"><table><thead><tr>'+headers.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const sourceKey=row=>JSON.stringify([row.source_collection_id,row.source_id]);

export function createPointSourceContext({getState,api,endpoint,submitAction,openItem}){
 let mounted=null,workspace=null,epoch=0,request=null,catalog=null,choice={},result=null,error='',busy=false,lastFingerprint='',lastBindings='';
 const current=()=>getState()?.workspace_key;
 const bindings=()=>getState()?.data?.point_source_context?.bindings??catalog?.bindings??[];
 const fingerprint=()=>JSON.stringify((getState()?.data?.sources??[]).map(row=>row.id).sort());
 function remembered(){
  try{const value=JSON.parse(sessionStorage.getItem('upstate-point-source-context:'+workspace)||'null');return value?.choice||{};}catch{return {};}
 }
 function retain(){
  try{sessionStorage.setItem('upstate-point-source-context:'+workspace,JSON.stringify({choice}));}catch{}
 }
 function selection(){
  const out={};
  for(const kind of keys){
   const row=catalog?.choices?.[kind]?.find(v=>sourceKey(v)===choice[kind]);
   if(!row)throw Error('Choose '+titles[kind].toLowerCase()+' from the original retained sources.');
   out[kind]={source_collection_id:row.source_collection_id,source_id:row.source_id};
  }
  return out;
 }
 function previewHTML(){
  if(!result)return '';
  const calendar=result.source_calendar?.groups||[];
  let html='<section><h3>Original source coverage</h3><p>'+esc(result.calendar_year)+' · '+
   esc(result.original_series)+' original reported series · '+esc(result.original_periods)+
   ' represented periods · '+esc(result.facilities.length)+' facilities.</p><p class="point-source-note">'+esc(result.interpretation)+'</p>';
  html+=table(['Facility / state outfall','Gauge','Actual network relation','Relationship source'],result.facilities.map(row=>[
   '<strong>'+esc(row.facility_name)+'</strong><br>'+esc(row.permit_id)+' / '+esc(row.state_outfall_id),
   esc(row.gauge_id),esc(row.gauge_relation),esc(row.relation_method)]));
  html+='<h3>Reported quantities by actual network relation</h3>'+table(
   ['Gauge / relation','Original species','Quantified source amount','Complete annual amount','Unit','Source coverage'],
   calendar.map(row=>[esc(row.gauge_id)+'<br>'+esc(row.gauge_relation),
    esc(row.parameter_name)+'<br><small>'+esc(row.parameter_code)+'</small>',
    amount(row.quantified_period_amount),amount(row.annual_amount),esc(row.amount_unit),
    (row.complete_year?'Complete year across selected permits':'Partial quantified coverage')+
     (row.permits_without_species.length?'<br>Species absent: '+row.permits_without_species.map(esc).join(', '):'')]));
  html+='<details><summary>Dated reporting periods and original facility contributions</summary>';
  for(const row of calendar){
   html+='<details><summary>'+esc(row.gauge_relation)+' · '+esc(row.parameter_name)+' · '+esc(row.amount_unit)+'</summary>'+
    table(['Month','Quantified amount','Complete cohort amount','Original series coverage'],row.months.map(month=>[
     esc(month.month),amount(month.quantified_amount),amount(month.complete_cohort_amount),
     month.series.map(s=>esc(s.permit_id)+' / '+esc(s.reporting_feature)+' / '+esc(s.monitoring_location)+': '+esc(s.quantified_days)+'/'+esc(s.expected_days)+' days').join('<br>')]));
   if(row.facility_mix.length)html+=table(['Facility','Complete annual source amount','Share of complete cohort'],row.facility_mix.map(f=>[
    esc(f.facility_name)+'<br>'+esc(f.permit_id),amount(f.annual_amount)+' '+esc(row.amount_unit),amount(f.annual_share_percent)+'%']));
   html+='</details>';
  }
  html+='</details><details><summary>Original source identities and whole-basin cohort context</summary><pre>'+
   esc(JSON.stringify({sources:result.sources,cohort_quantities:result.cohort_quantities},null,2))+'</pre></details>'+
   '<div class="point-source-actions">'+button('bind','Create observation context','',busy)+button('download','Download source review')+'</div>'+
   '<p>The two retained observation views preserve complete annual and actual quantified-period quantities. The existing Observations desk provides their rows, original source downloads and dated-series presentation.</p></section>';
  return html;
 }
 function render(){
  const rows=bindings();
  return '<div class="point-source-context"><header><h2>Point-source context</h2><p>Open original reported discharge quantities from sources already retained in this study.</p></header>'+
   (error?'<p class="point-source-error" role="alert">'+esc(error)+'</p>':'')+
   '<section><h3>Select the retained original source tables</h3>'+
   (catalog?'<div class="point-source-fields">'+keys.map(kind=>'<label><span>'+esc(titles[kind])+'</span><select data-point-source-kind="'+kind+'"'+(busy?' disabled':'')+'><option value="">Choose an original source…</option>'+
    (catalog.choices[kind]||[]).map(row=>'<option value="'+esc(sourceKey(row))+'"'+(choice[kind]===sourceKey(row)?' selected':'')+'>'+
     esc(row.collection_title+' · '+row.title+' · '+row.vintage)+'</option>').join('')+'</select>'+
    (!(catalog.choices[kind]||[]).length?'<small>Import the original source manifest containing '+esc(catalog.required_source_paths[kind])+'.</small>':'')+
    '</label>').join('')+'</div><div class="point-source-actions">'+button('preview',busy?'Reading original source…':'Review source coverage','',busy)+button('refresh','Refresh retained sources','',busy)+'</div>':
    '<p>Reading the retained source catalog…</p>')+
   '<p class="point-source-note">The original reported-period and network editions remain separate sources. Cohort membership uses actual upstream/downstream relationships; the unsplit basin polygon also contains a facility downstream of the gauge.</p></section>'+
   previewHTML()+'<section><h3>Retained observation bindings</h3>'+
   (rows.length?table(['Source year','Facilities / original series','Observation context'],rows.map(row=>[
    esc(row.calendar_year),esc(row.original_facilities)+' / '+esc(row.original_series),
    row.observations.map(o=>button('open',o.title,o.id)).join(' ')])):
    '<p>Create a source binding after reviewing the original source coverage.</p>')+'</section></div>';
 }
 function repaint(){if(mounted){mounted.innerHTML=render();lastBindings=JSON.stringify(bindings());}}
 function alive(ticket,key){return ticket===epoch&&key===current()&&workspace===key&&mounted;}
 async function refresh(){
  if(!mounted||!workspace)return;
  request?.abort();request=new AbortController();const ticket=++epoch,key=workspace,signal=request.signal;
  busy=true;error='';repaint();
  try{
   const value=await api(endpoint('/api/point-source-context/catalog'),{signal});
   if(!alive(ticket,key))return;
   catalog=value;lastFingerprint=fingerprint();
   for(const kind of keys){
    const rows=catalog.choices[kind]||[];
    if(!rows.some(row=>sourceKey(row)===choice[kind]))choice[kind]=rows.length===1?sourceKey(rows[0]):'';
   }
   result=null;retain();
  }catch(e){if(alive(ticket,key)&&e?.name!=='AbortError')error=e.message||String(e);}
  finally{if(alive(ticket,key)){busy=false;repaint();}}
 }
 async function inspect(){
  const selected=selection(),selectedKey=JSON.stringify(selected);request?.abort();request=new AbortController();
  const ticket=++epoch,key=workspace,signal=request.signal;busy=true;result=null;error='';repaint();
  try{
   const value=await api('/api/point-source-context/preview',{method:'POST',body:{workspace:key,selection:selected},signal});
   if(!alive(ticket,key)||JSON.stringify(selection())!==selectedKey)return;
   result=value;
  }catch(e){if(alive(ticket,key)&&e?.name!=='AbortError')error=e.message||String(e);}
  finally{if(alive(ticket,key)){busy=false;repaint();}}
 }
 async function bind(){
  if(!result||JSON.stringify(selection())!==JSON.stringify(result.selection))throw Error('Review the exact selected original source tables first.');
  const selected=result.selection,signature=result.source_signature,ticket=epoch,key=workspace;
  busy=true;error='';repaint();
  try{
   await submitAction('observations.point_sources.bind',{selection:selected,source_signature:signature});
  }catch(e){if(alive(ticket,key))error=e.message||String(e);}
  finally{if(alive(ticket,key)){busy=false;repaint();}}
 }
 function change(event){
  const kind=event.target.dataset?.pointSourceKind;if(!keys.includes(kind))return;
  choice[kind]=event.target.value;result=null;error='';retain();repaint();
 }
 function mount(element){
  if(mounted)mounted.removeEventListener('change',change);
  mounted=element;mounted.addEventListener('change',change);
  if(workspace!==current()){workspace=current();catalog=null;choice=remembered();result=null;error='';}
  repaint();return catalog&&fingerprint()===lastFingerprint?undefined:refresh();
 }
 function update(){
  if(!mounted)return;
  if(workspace!==current()){
   request?.abort();epoch++;workspace=current();catalog=null;choice=remembered();result=null;error='';busy=false;repaint();return refresh();
  }
  if(busy)return;
  if(fingerprint()!==lastFingerprint)return refresh();
  if(JSON.stringify(bindings())!==lastBindings)repaint();
 }
 function detach(){request?.abort();epoch++;mounted?.removeEventListener('change',change);mounted=null;busy=false;}
 async function dispatch(node){
  const action=node.dataset.action?.replace(/^point-source-context-/,'');
  if(action==='open')return openItem('observations',node.dataset.id);
  if(busy)return;
  if(action==='refresh')return refresh();
  if(action==='preview')return inspect();
  if(action==='bind')return bind();
  if(action==='download'){
   if(!result)throw Error('Review original source coverage first.');
   const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)+'\n'],{type:'application/json'}));
   const anchor=document.createElement('a');anchor.href=url;anchor.download='point-source-context-'+result.calendar_year+'.json';anchor.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
 }
 function taskActions(task){
  if(task.action!=='observations.point_sources.bind'||task.state!=='complete')return '';
  return '<div class="point-source-actions">'+(task.result?.observations||[]).map(row=>button('open','Open '+row.title,row.id)).join('')+'</div>';
 }
 return {render,mount,update,detach,dispatch,taskActions};
}
