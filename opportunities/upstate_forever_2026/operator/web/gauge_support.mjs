/** Original gauge support in the shared operator, with retained study/source identities. */
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list = value => Array.isArray(value) ? value : [];
const num = value => Number.isFinite(value) ? value.toLocaleString(undefined,{maximumFractionDigits:3}) : '—';
const refKey = source => source ? source.collection_id+'/'+source.source_id : '';
const ref = source => ({collection_id:source.collection_id,source_id:source.source_id,source_sha256:source.source_sha256});
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? '['+value.map(canonical).join(',')+']' :
  value && typeof value==='object' ? '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}' : JSON.stringify(value);
const button = (action,label,attrs='') => '<button type="button" data-gs-action="'+action+'" '+attrs+'>'+esc(label)+'</button>';
const options = (rows,selected,getKey,getTitle,empty='Choose retained source') =>
  '<option value="">'+esc(empty)+'</option>'+rows.map(row=>'<option value="'+esc(getKey(row))+'"'+
    (getKey(row)===selected?' selected':'')+'>'+esc(getTitle(row))+'</option>').join('');
const sourceTitle = row => (row.title||row.source_id)+' · '+(row.collection_title||row.collection_id);
const svgMap = (edition,stationId) => {
  const selected=list(edition?.catchments?.features).find(row=>row.properties?.station_id===stationId);
  const station=list(edition?.gauges?.features).find(row=>row.id===stationId);
  const support=list(edition?.result?.stations).find(row=>row.station_id===stationId);
  const selectedHucs=new Set(list(support?.huc_intersections).map(row=>row.huc12));
  const hucs=list(edition?.hucs?.features).filter(row=>selectedHucs.has(String(row.properties?.huc12)));
  const pairs=[];
  function visit(value){if(Array.isArray(value)&&value.length>=2&&value.slice(0,2).every(Number.isFinite))pairs.push(value);
    else if(Array.isArray(value))value.forEach(visit);}
  if(selected)visit(selected.geometry?.coordinates);
  hucs.forEach(row=>visit(row.geometry?.coordinates));
  if(station)visit(station.geometry?.coordinates);
  if(!pairs.length)return '<p class="gs-muted">This original selection has no located gauge geometry.</p>';
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  for(const p of pairs){x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);}
  const cosine=Math.cos((y0+y1)/2*Math.PI/180),w=900,h=380;
  const dx=Math.max((x1-x0)*cosine,.001),dy=Math.max(y1-y0,.001),scale=Math.min((w-40)/dx,(h-40)/dy);
  const ox=(w-dx*scale)/2,oy=(h-dy*scale)/2;
  const xy=p=>[ox+(p[0]-x0)*cosine*scale,h-oy-(p[1]-y0)*scale];
  function path(geom){const polys=geom?.type==='Polygon'?[geom.coordinates]:geom?.type==='MultiPolygon'?geom.coordinates:[];
    return polys.flatMap(poly=>poly.map(ring=>ring.map((p,i)=>(i?'L':'M')+xy(p).map(n=>n.toFixed(2)).join(',')).join(' ')+'Z')).join(' ');}
  return '<svg class="gs-map" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc('Original whole catchment and intersecting HUC12 polygons for '+stationId)+'">'+
    hucs.map(row=>'<path class="gs-huc" fill-rule="evenodd" d="'+path(row.geometry)+'"><title>'+esc(row.properties?.huc12+' '+(row.properties?.name||''))+'</title></path>').join('')+
    (selected?'<path class="gs-basin" fill-rule="evenodd" d="'+path(selected.geometry)+'"><title>Original upstream whole catchment</title></path>':'')+
    (station?'<circle class="gs-point" cx="'+xy(station.geometry.coordinates)[0]+'" cy="'+xy(station.geometry.coordinates)[1]+'" r="5"><title>'+esc(stationId)+'</title></circle>':'')+
    '</svg><p class="gs-muted">Original whole catchment: dark outline. Regional HUC12 polygons: thin outlines. Gauge: point. Display is locally scaled longitude/latitude; all reported areas use EPSG:5070.</p>';
};

export function attachGaugeSupport(host) {
  let root=null,workspace=null,state=null,catalog=null,edition=null,selected='',search='',error='',message='';
  let busy=false,generation=0,controller=null,currentTask=null,request=null,catalogRequest=0,detailRequest=0,pendingEditionId=null;
  let reportTask=null,reportRequest=null,reportDelivery='',reportReady=null,reportBusy=false,reportHandled=null;
  let draft={title:'Regional gauge and catchment support',report_id:'',reporting_huc12s:[],huc_sources:[],utility_sources:[]};
  const storageKey=()=> 'upstate:gauge-support:'+workspace;
  function save(){try{sessionStorage.setItem(storageKey(),JSON.stringify({draft,selected,currentTask,request,reportTask,reportRequest,reportDelivery,reportReady,reportHandled}));}catch{}}
  function restore(){try{const value=JSON.parse(sessionStorage.getItem(storageKey())||'null');
    if(value){draft=value.draft||draft;selected=value.selected||'';currentTask=value.currentTask;request=value.request;reportTask=value.reportTask||null;reportRequest=value.reportRequest||null;reportDelivery=value.reportDelivery||'';reportReady=value.reportReady||null;reportHandled=value.reportHandled||null;}}catch{}}
  function read(operation,payload={}){return host.api('/api/gauge-support/'+operation,{method:'POST',body:{workspace,...payload}});}
  function note(){if(!root)return;const e=root.querySelector('[data-gs-error]'),m=root.querySelector('[data-gs-message]');
    e.hidden=!error;e.textContent=error;m.hidden=!message;m.textContent=message;}
  function fail(problem){error=problem?.message||String(problem);message='';note();}
  function source(value){return list(catalog?.sources).find(row=>refKey(row)===value);}
  function report(){return list(catalog?.reports).find(row=>row.id===draft.report_id);}
  function renderForm(){
    if(!root)return;const vectors=list(catalog?.sources).filter(row=>row.kind==='vector'),tables=list(catalog?.sources).filter(row=>row.kind==='table');
    const hucs=list(report()?.hucs),selectedHucs=new Set(draft.reporting_huc12s);
    root.querySelector('[data-gs-draft]').innerHTML='<details class="gs-card gs-draft" open><summary>Build regional gauge support</summary>'+
      '<p>Choose original retained source editions. The station geography engine resolves exact station IDs and point memberships; this support analysis intersects their whole catchments with the selected regional polygons.</p>'+
      '<form data-gs-form><div class="gs-grid"><label>Title<input data-gs-field="title" value="'+esc(draft.title)+'" required></label>'+
      '<label>Saved regional watershed report<select data-gs-field="report_id" required>'+options(list(catalog?.reports),draft.report_id,row=>row.id,row=>(row.title||row.id)+' · '+row.hucs.length+' HUC12s','Choose saved report')+'</select></label>'+
      '<label>Original HUC12 polygon source<select data-gs-field="huc_source" required>'+options(vectors,refKey(draft.huc_sources?.[0]),refKey,sourceTitle)+'</select></label>'+
      '<label>Original HUC12 field<input data-gs-field="huc_field" value="'+esc(draft.huc_sources?.[0]?.id_field||'huc12')+'" required></label>'+
      '<label>Gauge point source<select data-gs-field="point_source">'+options(vectors,refKey(draft.point_source),refKey,sourceTitle,'Choose gauge points or saved geography')+'</select></label>'+
      '<label>Saved station geography (optional)<select data-gs-field="station_edition_id">'+options(list(catalog?.station_editions),draft.station_edition_id||'',row=>row.id,row=>row.title||row.id,'Build from selected gauge points')+'</select></label>'+
      '<label>Original whole catchment source<select data-gs-field="catchment_source" required>'+options(vectors,refKey(draft.catchment_source),refKey,sourceTitle)+'</select></label>'+
      '<label>Original daily-flow coverage JSON<select data-gs-field="coverage_source" required>'+options(tables,refKey(draft.coverage_source),refKey,sourceTitle)+'</select></label>'+
      '<label>Reporting HUC12 selection<select data-gs-field="reporting_huc12s" multiple>'+hucs.map(row=>'<option value="'+esc(row.huc12)+'"'+
        (selectedHucs.has(row.huc12)?' selected':'')+'>'+esc(row.huc12+' '+row.name+(row.priority?' · priority':''))+'</option>').join('')+'</select></label>'+
      '<label>Utility polygon sources (optional)<select data-gs-field="utility_source" multiple>'+vectors.map(row=>'<option value="'+esc(refKey(row))+'"'+
        (list(draft.utility_sources).some(selected=>refKey(selected)===refKey(row))?' selected':'')+'>'+esc(sourceTitle(row))+'</option>').join('')+'</select></label>'+
      list(draft.utility_sources).map((row,index)=>'<label>'+esc(sourceTitle(source(refKey(row))||row))+' — original utility ID field<input data-gs-field="utility_field" data-gs-utility-index="'+index+'" value="'+esc(row.id_field||'id')+'"></label>').join('')+'</div>'+
      '<p class="gs-note">Whole-catchment source requests retain simplified=false and splitCatchment=false. Select all reporting HUC12s to compare the full regional domain. Utility areas are evaluated separately.</p>'+
      '<div class="gs-actions"><button type="submit"'+(busy?' disabled':'')+'>Build and retain support report</button>'+button('all-hucs','Select all reporting HUC12s')+button('priority-hucs','Select priority HUC12s')+'</div></form></details>';
  }
  function renderEditions(){
    if(!root)return;root.querySelector('[data-gs-editions]').innerHTML=options(list(catalog?.editions),edition?.id||'',row=>row.id,row=>row.title+' · '+(row.summary?.gauge_count||0)+' gauges','Choose saved support report');
  }
  function renderTasks(){
    if(!root)return;const tasks=list(state?.tasks).filter(row=>row.workspace===workspace&&['gauge.support.build','gauge.support.report'].includes(row.action));
    root.querySelector('[data-gs-tasks]').innerHTML=tasks.length?'<h2>Saved operations</h2><div class="gs-actions">'+tasks.slice(0,8).map(task=>
      button('task',(task.id===currentTask?'Current · ':'')+task.state+' · '+(task.action==='gauge.support.report'?(task.payload?.render===false?'Scientific report source':'Scientific report'):task.payload?.selection?.title||'Gauge support'),'data-id="'+esc(task.id)+'"')+
      (task.state==='complete'&&task.result?.id?button('open','Open result','data-id="'+esc(task.result.id)+'"'):'')+
      (task.state==='complete'&&task.action==='gauge.support.report'&&task.result?.source?button('report-task','Open report form','data-id="'+esc(task.id)+'"'):'')).join('')+'</div>':'';
  }
  function renderResult(){
    if(!root)return;const result=edition?.result,container=root.querySelector('[data-gs-result]');
    if(!result){container.innerHTML='<p class="gs-muted">Open a saved support report or build one from the current source catalogue.</p>';return;}
    const rows=list(result.stations).filter(row=>!search||(row.station_id+' '+row.station_name+' '+row.point_huc12s.join(' ')).toLowerCase().includes(search.toLowerCase()));
    const station=list(result.stations).find(row=>row.station_id===selected)||rows[0];if(station)selected=station.station_id;
    const summary=result.summary;
    const files=list(edition._downloads);
    const scientific=reportReady?.gauge_support_id===edition.id?reportReady:edition.scientific_report;
    const reportDownloads=list(scientific?._downloads);
    const fileLink=(file)=>'<a class="gs-link" href="'+esc(file.url)+'" download="'+esc(file.filename||file.label||'')+'">'+esc(file.filename||file.label||'Download')+'</a>';
    const important=files.filter(file=>/\.html$|gauges\.csv$|gauge-huc-intersections\.csv$|annual-flow-coverage\.csv$|gauge-support\.zip$/.test(file.filename||file.label||''));
    container.innerHTML='<section class="gs-card"><h2>'+esc(result.title)+'</h2><div class="gs-metrics">'+
      '<span><b>'+num(summary.gauge_count)+'</b>gauge catchments</span><span><b>'+num(summary.gauges_with_point_in_region)+'</b>gauge points in region</span>'+
      '<span><b>'+num(summary.complete_numeric_flow_gauges)+'</b>complete numeric calendars</span><span><b>'+num(summary.reporting_huc_count)+'</b>reporting HUC12s</span></div>'+
      '<p class="gs-muted">Saved regional report '+esc(result.regional.report_id)+' · original station geography '+esc(result.station_edition_id)+
      ' · source edition '+esc(edition.id)+'</p><div class="gs-actions">'+button('station-edition','Open source station geography')+
      button('reuse','Use this selection')+button('verify','Verify and reopen linked source')+'</div><div>'+important.map(fileLink).join('')+'</div>'+
      '<div class="gs-row"><label>Scientific report selection<select data-gs-report-delivery>'+options(list(state?.data?.deliveries),reportDelivery,row=>row.id,row=>row.title||row.id,'New report selection')+'</select></label>'+
      button('report-render','Download scientific report',reportBusy?'disabled':'')+
      button('report','Use in scientific report',reportBusy?'disabled':'')+
      (scientific?.source?button('report-open','Open prepared report form'):'')+'</div>'+
      (reportDownloads.length?'<div class="gs-actions">'+reportDownloads.filter(file=>/report\.(pdf|html|md)$|report-data\.json$|gauge-scientific-report\.zip$/.test(file.filename||file.label||'')).map(fileLink).join('')+'</div>':'')+
      (scientific?.error?'<p class="gs-note">Report rendering needs attention: '+esc(scientific.error.message)+'. Retained source and any completed formats remain available.</p>':'')+
      '<p class="gs-muted">Download a scientific PDF, HTML, Markdown, data and full source ZIP from this saved edition. Use in scientific report adds the same source to a new or saved delivery, preserving its native runs, overlays and selected studies.</p>'+
      '<details><summary>All source-preserving downloads</summary>'+files.map(fileLink).join('')+'</details></section>'+
      '<section class="gs-card"><h2>Gauges and original flow coverage</h2><label>Find gauge<input type="search" data-gs-search value="'+esc(search)+'" placeholder="Station, name or HUC12"></label>'+
      '<div class="gs-table"><table><thead><tr><th>Gauge</th><th>Point membership</th><th>Whole catchment km²</th><th>Within region</th><th>Numeric days</th><th>Original series</th></tr></thead><tbody>'+
      rows.map(row=>'<tr data-gs-station="'+esc(row.station_id)+'" aria-selected="'+(row.station_id===selected)+'" tabindex="0"><td><strong>'+esc(row.station_id)+'</strong><br>'+esc(row.station_name)+'</td>'+
      '<td>'+esc(row.point_huc12s.join(', ')||row.point_membership_status)+'<br><small>'+esc(row.location_status)+'</small></td><td>'+num(row.catchment_area_m2/1e6)+'</td>'+
      '<td>'+num(100*row.regional_domain_fraction)+'%</td><td>'+num(row.flow.totals.numeric_day_count)+' / '+num(row.flow.totals.calendar_days)+'</td><td>'+esc(row.ts_id)+'</td></tr>').join('')+'</tbody></table></div></section>'+
      (station?'<section class="gs-card"><h2>'+esc(station.station_id)+' — '+esc(station.station_name)+'</h2>'+svgMap(edition,station.station_id)+
      '<p><strong>Gauge point relative to its original supplied whole catchment: '+esc(station.point_own_catchment_relation)+'.</strong> Original source measure: '+esc(station.original_catchment_properties?.measure??'—')+'.</p>'+
      '<p>Reporting overlap: '+num(station.reporting_overlap_area_m2/1e6)+' km². Whole catchment outside regional domain: '+num(station.outside_regional_domain_area_m2/1e6)+' km².</p>'+
      '<h3>Annual coverage from the original daily-flow series</h3><div class="gs-table"><table><thead><tr><th>Year</th><th>Numeric / calendar</th><th>Approved</th><th>Estimated</th><th>Provisional</th><th>Observed-day mean cfs</th><th>Missing dates</th></tr></thead><tbody>'+
      station.flow.years.map(year=>'<tr class="gs-year"><td>'+year.year+'</td><td>'+year.numeric_day_count+' / '+year.calendar_days+'</td><td>'+year.approved_numeric_days+
        '</td><td>'+year.estimated_numeric_days+'</td><td>'+year.provisional_numeric_days+'</td><td>'+num(year.mean_observed_daily_cfs)+'</td><td>'+year.missing_date_count+'</td></tr>').join('')+
      '</tbody></table></div><p class="gs-muted">Qualifier counts may overlap. The mean is calculated over original numeric observed days; missing days remain missing.</p>'+
      '<h3>Catchment intersections with regional HUC12s</h3><div class="gs-table"><table><thead><tr><th>HUC12</th><th>Watershed</th><th>Intersection km²</th><th>Catchment %</th><th>HUC %</th><th>Reporting</th></tr></thead><tbody>'+
      station.huc_intersections.map(row=>'<tr><td>'+esc(row.huc12)+'</td><td>'+esc(row.watershed_name)+'</td><td>'+num(row.overlap_area_m2/1e6)+'</td><td>'+num(100*row.catchment_fraction)+
        '</td><td>'+num(100*row.huc_fraction)+'</td><td>'+esc(row.reporting_selected?'Selected':'Context')+'</td></tr>').join('')+'</tbody></table></div>'+
      '<details><summary>Original station, basin and source-series references</summary><pre>'+esc(JSON.stringify({station_source_ref:station.station_source_ref,catchment_source_ref:station.catchment_source_ref,
        original_catchment_properties:station.original_catchment_properties,flow_series:station.flow.station,original_years:station.flow.years},null,2))+'</pre></details></section>':'')+
      '<section class="gs-card"><h2>Reporting, upstream and utility support</h2><div class="gs-table"><table><thead><tr><th>Scope</th><th>Selection</th><th>Area km²</th><th>Gauge-catchment union km²</th><th>Intersected</th></tr></thead><tbody>'+
      result.scope_summary.map(row=>'<tr><td>'+esc(row.scope.replaceAll('_',' '))+'</td><td>'+esc(row.label||row.id)+'</td><td>'+num(row.area_m2/1e6)+'</td><td>'+num(row.catchment_union_overlap_m2/1e6)+'</td><td>'+num(100*row.covered_fraction)+'%</td></tr>').join('')+
      '</tbody></table></div><p>Nested catchments are combined by geometric union for this summary. Individual station and utility intersections remain in the JSON and CSV exports.</p>'+
      '<details><summary>Methods and retained source editions</summary>'+Object.entries(result.methods).map(([key,value])=>'<p><strong>'+esc(key.replaceAll('_',' '))+'.</strong> '+esc(value)+'</p>').join('')+
      '<pre>'+esc(JSON.stringify(result.sources.map(row=>({collection_id:row.collection_id,source_id:row.source_id,sha256:row.source_sha256,title:row.title,uri:row.uri})),null,2))+'</pre></details></section>';
  }
  async function refresh(){
    if(!root)return;const key=workspace,version=generation,sequence=++catalogRequest;message='Reading original sources and saved reports…';error='';note();
    try{const next=await read('catalog');if(!root||key!==workspace||version!==generation||sequence!==catalogRequest)return;catalog=next;
      if(!draft.point_source){const row=next.sources.find(row=>row.source_id==='nldi-daily-flow-gauge-locations-20261013');if(row)draft.point_source={...ref(row),station_id_field:'station_id'};}
      if(!draft.catchment_source){const row=next.sources.find(row=>row.source_id==='nldi-daily-flow-whole-catchments-20261013');if(row)draft.catchment_source=ref(row);}
      if(!draft.coverage_source){const row=next.sources.find(row=>row.role==='daily-flow-coverage');if(row)draft.coverage_source=ref(row);}
      message='Original source catalogue ready.';renderForm();renderEditions();renderTasks();save();note();
    }catch(problem){if(root&&key===workspace&&version===generation)fail(problem);}
  }
  async function open(id){
    if(!root)return;const key=workspace,version=generation,sequence=++detailRequest;pendingEditionId=id;message='Opening saved support and original sources…';error='';note();
    try{const next=await read('edition',{id});if(!root||key!==workspace||version!==generation||sequence!==detailRequest)return;
      edition=next;if(next.scientific_report)reportReady=next.scientific_report;if(catalog&&!list(catalog.editions).some(row=>row.id===next.id))catalog.editions=[{id:next.id,title:next.title,summary:next.summary,selection:next.selection},...list(catalog.editions)];selected=list(next.result?.stations).some(row=>row.station_id===selected)?selected:next.result?.stations?.[0]?.station_id||'';
      message='Saved support report opened.';renderEditions();renderResult();save();note();
    }catch(problem){if(root&&key===workspace&&version===generation&&sequence===detailRequest)fail(problem);}
    finally{if(sequence===detailRequest)pendingEditionId=null;}
  }
  async function submit(event){
    event.preventDefault();if(busy||!event.target.reportValidity())return;
    if(!draft.station_edition_id&&!draft.point_source){fail(Error('Choose original gauge points or a saved station geography.'));return;}
    if(!draft.reporting_huc12s.length){fail(Error('Select the reporting HUC12s.'));return;}
    const selection=clone(draft),key=workspace,version=generation,signature=canonical(selection);
    if(!request||request.signature!==signature)request={signature,id:'gauge-support-'+crypto.randomUUID()};
    busy=true;error='';message='Retaining the source selection in the existing operator queue…';save();renderForm();note();
    try{const task=await host.api('/api/actions',{method:'POST',body:{workspace:key,action:'gauge.support.build',payload:{selection},operation_id:request.id}});
      if(!root||key!==workspace||version!==generation)return;currentTask=task.id;message='Saved operation '+task.state+'.';save();
      await host.refresh({force:true});if(!root||key!==workspace||version!==generation)return;state=host.getState();renderTasks();
      if(task.state==='complete'&&task.result?.id)await open(task.result.id);
    }catch(problem){if(root&&key===workspace&&version===generation)fail(problem);}
    finally{if(root&&key===workspace&&version===generation){busy=false;renderForm();note();}}
  }
  async function openReport(value){
    if(!value?.source||!value?.delivery_selection)throw Error('Complete the original gauge report source operation first.');
    const key=workspace,version=generation;
    await host.refresh({force:true});
    if(!root||key!==workspace||version!==generation)return;
    state=host.getState();
    await host.openDelivery(clone(value.delivery_selection));
  }
  function acceptReport(task){
    if(!task||task.action!=='gauge.support.report')return;
    if(task.state==='complete'&&task.result?.source){
      reportReady={...task.result,_downloads:task._downloads||[]};reportBusy=false;reportRequest=null;
      if(reportHandled!==task.id){reportHandled=task.id;message=task.payload?.render===false?'Gauge source and map package retained. Open the prepared report form to review delivery settings.':'Scientific report and full source package ready for download.';save();renderResult();note();}
    }else if(['failed','cancelled','canceled','paused','interrupted'].includes(task.state)){
      reportBusy=false;reportRequest=null;
      if(reportHandled!==task.id){reportHandled=task.id;message='Scientific report operation '+task.state+'. Open its saved operation for the retained outputs or original error.';save();renderResult();note();
        if(task.payload?.edition_id===edition?.id)refreshReport(edition.id).catch(fail);}
    }
  }
  async function refreshReport(id){
    const key=workspace,version=generation;
    const value=await read('report',{edition_id:id});
    if(!root||key!==workspace||version!==generation||edition?.id!==id)return;
    if(value){reportReady=value;edition.scientific_report=value;save();renderResult();}
  }
  async function prepareReport(render=true){
    if(reportBusy||!edition)return;
    const payload={edition_id:edition.id,render,...(reportDelivery?{delivery_id:reportDelivery}:{})};
    const key=workspace,version=generation,signature=canonical(payload);
    if(!reportRequest||reportRequest.signature!==signature)reportRequest={signature,id:'gauge-report-'+crypto.randomUUID()};
    reportBusy=true;error='';message=render?'Rendering the saved Gauge scientific report and complete source archive…':'Retaining the saved Gauge edition, maps and original source companions…';save();renderResult();note();
    try{
      const task=await host.api('/api/actions',{method:'POST',body:{workspace:key,action:'gauge.support.report',payload,operation_id:reportRequest.id}});
      if(!root||key!==workspace||version!==generation)return;
      reportTask=task.id;save();acceptReport(task);
      await host.refresh({force:true});
      if(!root||key!==workspace||version!==generation)return;
      state=host.getState();renderTasks();acceptReport(list(state?.tasks).find(row=>row.id===reportTask));
      if(task.state==='complete'&&task.result?.source){if(render)await refreshReport(payload.edition_id);else await openReport(task.result);}
    }catch(problem){if(root&&key===workspace&&version===generation){reportBusy=false;fail(problem);renderResult();}}
  }
  function change(event){
    const target=event.target,field=target.dataset.gsField;
    if(target.matches('[data-gs-report-delivery]')){reportDelivery=target.value;reportRequest=null;save();return;}
    if(target.matches('[data-gs-editions]')){if(target.value)open(target.value);return;}
    if(!field)return;
    if(field==='report_id'){draft.report_id=target.value;draft.reporting_huc12s=list(report()?.hucs).map(row=>row.huc12);renderForm();}
    else if(field==='reporting_huc12s')draft.reporting_huc12s=Array.from(target.selectedOptions).map(row=>row.value);
    else if(field==='huc_source'){const row=source(target.value);draft.huc_sources=row?[{...ref(row),id_field:row.id_field||'huc12'}]:[];renderForm();}
    else if(field==='utility_source'){const old=list(draft.utility_sources);draft.utility_sources=Array.from(target.selectedOptions).map(option=>source(option.value)).filter(Boolean).map(row=>
      old.find(selected=>refKey(selected)===refKey(row))||{...ref(row),id_field:row.id_field||'id'});renderForm();}
    else if(field==='huc_field'){if(draft.huc_sources[0])draft.huc_sources[0].id_field=target.value.trim();}
    else if(field==='utility_field'){const index=Number(target.dataset.gsUtilityIndex);if(draft.utility_sources[index])draft.utility_sources[index].id_field=target.value.trim();}
    else if(['point_source','catchment_source','coverage_source'].includes(field)){const row=source(target.value);
      if(row)draft[field]={...ref(row),...(field==='point_source'?{station_id_field:'station_id'}:{})};else delete draft[field];}
    else if(field==='station_edition_id'){if(target.value)draft.station_edition_id=target.value;else delete draft.station_edition_id;}
    else if(field==='title')draft.title=target.value;
    save();
  }
  async function click(event){
    const station=event.target.closest('[data-gs-station]');if(station){selected=station.dataset.gsStation;save();renderResult();return;}
    const target=event.target.closest('[data-gs-action]');if(!target)return;
    const action=target.dataset.gsAction,key=workspace,version=generation;
    try{
      if(action==='refresh')await refresh();
      else if(action==='report')await prepareReport(false);
      else if(action==='report-render')await prepareReport(true);
      else if(action==='report-open')await openReport(reportReady?.gauge_support_id===edition?.id?reportReady:edition?.scientific_report);
      else if(action==='report-task'){const task=list(state?.tasks).find(row=>row.id===target.dataset.id);if(task?.result?.source)await openReport(task.result);}
      else if(action==='all-hucs'||action==='priority-hucs'){draft.reporting_huc12s=list(report()?.hucs).filter(row=>action==='all-hucs'||row.priority).map(row=>row.huc12);save();renderForm();}
      else if(action==='open')await open(target.dataset.id);
      else if(action==='task')host.showTask(target.dataset.id);
      else if(action==='reuse'&&edition){draft=clone(edition.selection);save();renderForm();root.querySelector('[data-gs-draft]').scrollIntoView({block:'start'});}
      else if(action==='station-edition'&&edition){host.openItem('station-geographies',edition.station_edition_id);}
      else if(action==='verify'&&edition){const key=workspace,version=generation;await read('verify',{id:edition.id});
        if(root&&key===workspace&&version===generation){message='Linked regional report, source bytes, station edition and support files verified.';note();}}
    }catch(problem){if(root&&key===workspace&&version===generation)fail(problem);}
  }
  function mount(container,initial=host.getState()){
    detach();root=container;state=initial;workspace=host.getWorkspace()||state?.workspace_key;generation++;
    catalog=null;edition=null;error='';message='';busy=false;selected='';search='';currentTask=null;request=null;
    reportTask=null;reportRequest=null;reportDelivery='';reportReady=null;reportBusy=false;reportHandled=null;
    draft={title:'Regional gauge and catchment support',report_id:'',reporting_huc12s:[],huc_sources:[],utility_sources:[]};restore();controller=new AbortController();
    root.innerHTML='<section class="gauge-support"><header><div><h1>Gauge support</h1><p>Original gauge locations, whole-catchment coverage and regional watershed relationships.</p></div>'+button('refresh','Refresh sources')+'</header>'+
      '<p class="gs-error" data-gs-error role="alert" hidden></p><p data-gs-message role="status" hidden></p><div data-gs-draft></div>'+
      '<div class="gs-card"><label>Saved gauge support report<select data-gs-editions></select></label><div data-gs-tasks></div></div><div data-gs-result></div></section>';
    const signal=controller.signal;root.addEventListener('click',click,{signal});root.addEventListener('change',change,{signal});
    root.addEventListener('submit',submit,{signal});root.addEventListener('input',event=>{
      if(event.target.matches('[data-gs-search]')){search=event.target.value;renderResult();const input=root.querySelector('[data-gs-search]');input.focus();input.setSelectionRange(search.length,search.length);}
      else if(event.target.matches('[data-gs-field="title"]'))change(event);
    },{signal});root.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&event.target.matches('[data-gs-station]')){event.preventDefault();selected=event.target.dataset.gsStation;save();renderResult();}},{signal});
    renderResult();refresh();
  }
  function update(next){
    if(!root)return;const key=host.getWorkspace()||next?.workspace_key;if(key!==workspace){const container=root;mount(container,next);return;}
    state=next;renderTasks();acceptReport(list(state?.tasks).find(row=>row.id===reportTask));const task=list(state?.tasks).find(row=>row.id===currentTask);
    if(task?.state==='complete'&&task.result?.id&&edition?.id!==task.result.id&&pendingEditionId!==task.result.id)open(task.result.id);
  }
  function detach(){generation++;catalogRequest++;detailRequest++;pendingEditionId=null;controller?.abort();controller=null;root=null;catalog=null;edition=null;busy=false;}
  async function prepare(selection){draft={...draft,...clone(selection||{})};save();if(root){await refresh();renderForm();}}
  return {mount,update,detach,refresh,open,prepare};
}
