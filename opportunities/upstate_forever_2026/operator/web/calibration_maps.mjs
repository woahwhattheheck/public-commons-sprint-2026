/* Original-catchment residual maps inside the maintained Calibration desk. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=value=>value?String(value).slice(0,12):'—';
const human=value=>String(value??'').replaceAll('_',' ');
const count=value=>Array.isArray(value)?value.length:Number.isFinite(value)?value:0;
const number=value=>Number.isFinite(value)?value.toLocaleString(undefined,{maximumSignificantDigits:7}):'—';
const json=value=>JSON.stringify(value,null,2);
const button=(action,label,id='',extra='')=>'<button type="button" class="small" data-action="calibration-maps-'+esc(action)+'"'+(id?' data-id="'+esc(id)+'"':'')+' '+extra+'>'+esc(label)+'</button>';
const table=(headers,rows)=>'<div class="table-scroll"><table><thead><tr>'+headers.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const section=(title,description,body,actions='')=>'<section class="section"><header class="section-header"><div><h2>'+esc(title)+'</h2><p>'+esc(description)+'</p></div><div class="page-actions">'+actions+'</div></header>'+body+'</section>';
const spatialButton=(kind,id,label,collection='')=>'<button type="button" class="small" data-action="spatial-item" data-kind="'+esc(kind)+'" data-id="'+esc(id)+'"'+(collection?' data-collection="'+esc(collection)+'"':'')+'>'+esc(label)+'</button>';

/** Views and actions share the parent's workspace and request-generation guard. */
export function createCalibrationMaps({current,read,submitAction,openForm,fileList,detail,repaint,
    getReport,getUncertainty,getData,openReport,openUncertainty,activate}){
  let packet=null,request=0,formRequest=0,filter='',selectedLayer=null;
  const active=()=>packet?.workspace_key===current();
  const maps=()=>getData().calibration_maps??[];
  const reviewLinks=()=>getData().calibration_map_reviews??[];
  function reset(){packet=null;request++;formRequest++;filter='';selectedLayer=null;}
  function invalidate(){request++;formRequest++;}
  function sync(){
    if(packet&&packet.workspace_key!==current()){reset();return true;}
    if(!active())return false;
    const links=reviewLinks().filter(row=>row.map_id===packet.map.id);
    if(JSON.stringify(links)===JSON.stringify(packet.reviews??[]))return false;
    packet.reviews=links;return true;
  }
  function summary(reportId,uncertaintyId=null){
    const records=[...new Map([...(getReport()?.maps??[]),...maps()].filter(row=>row.calibration_id===reportId).map(row=>[row.id,row])).values()];
    const action=button('prepare',uncertaintyId?'Map these reference ranges':'Prepare residual maps',reportId,
      uncertaintyId?'data-uncertainty="'+esc(uncertaintyId)+'"':'');
    return section('Catchment residual maps',
      'Original source geometry, retained annual loads and native residuals. The selected profile includes held-out descriptive rows; challenger layers contain calibration catchments.',
      records.length?table(['Saved map edition','Layers','Reference ranges',''],records.map(row=>
        '<tr><td><strong>'+esc(row.title||'Catchment residual maps')+'</strong><small class="mono">'+esc(short(row.id))+'</small></td><td>'+number(row.layer_count)+'</td><td>'+esc(row.uncertainty_id?'Retained published-error sensitivity':'Nominal reference loads')+'</td><td>'+button('open','Open maps',row.id)+'</td></tr>')):
      '<p class="calibration-empty">Prepare the original catchment layers and their PDF/SVG atlas from this completed calibration.</p>',action);
  }
  async function open(id){
    const workspace=current(),ticket=++request;
    const result=await read('maps',{id});
    if(ticket!==request||workspace!==current())return;
    packet=result;filter='';selectedLayer=result.map.layers?.[0]?.id??null;
    document.querySelector('#detail-dialog')?.close();
    activate();
  }
  async function prepareForm(reportId,uncertaintyId=null){
    const workspace=current(),ticket=++formRequest;
    const retained=getReport();
    const nominal=retained?.report?.id===reportId?retained:await read('report',{id:reportId});
    if(ticket!==formRequest||workspace!==current())return;
    const report=nominal.report;
    if(report.state!=='complete'||!report.selected_run_id)throw Error('Choose a completed calibration with an eligible selected native run.');
    const uncertainties=nominal.uncertainties??[];
    if(uncertaintyId&&!uncertainties.some(row=>row.id===uncertaintyId))throw Error('Choose an original sensitivity analysis belonging to this calibration.');
    const candidates=(report.ranked_candidates??[]).filter(row=>row.run_id!==report.selected_run_id);
    const selected=report.ranked_candidates.find(row=>row.run_id===report.selected_run_id);
    const content='<div class="calibration-form"><div class="form-grid">'+
      '<div class="full calibration-source"><h3>Original selected native run</h3><p>'+esc(selected?.title||short(report.selected_run_id))+
      ' · '+esc((selected?.selected_models??report.selected_models??[]).map(v=>v.toUpperCase()).join(' + '))+
      '</p><p>The selected run is always included. Its held-out rows stay descriptive. Added challengers contain calibration catchments only.</p></div>'+
      '<label class="full"><span>Published observation-error ranges</span><select name="calibration_maps_uncertainty"><option value="">Nominal reference loads</option>'+
      uncertainties.map(row=>'<option value="'+esc(row.id)+'" '+(row.id===uncertaintyId?'selected':'')+'>'+
        esc(number(row.standard_errors)+' published standard errors · '+human(row.state)+' · '+short(row.id))+'</option>').join('')+
      '</select><small>Use the exact retained sensitivity edition, including its original missing-error coverage.</small></label>'+
      '<div class="full"><h3>Optional challenger layers</h3>'+
      (candidates.length?table(['Include','Native candidate','Calibration loss'],candidates.map(row=>
        '<tr><td><input type="checkbox" name="calibration_maps_candidates" value="'+esc(row.run_id)+'" aria-label="Include '+esc(row.title||short(row.run_id))+'"></td><td><strong>'+esc(row.title||short(row.run_id))+'</strong><small>'+esc((row.selected_models??[]).map(v=>v.toUpperCase()).join(' + '))+' · '+esc(short(row.run_id))+'</small></td><td>'+number(row.objective_score)+'</td></tr>')):
        '<p>No other eligible native candidates are retained in this calibration.</p>')+'</div>'+
      '<div class="full calibration-source"><p>Each atlas page keeps the original catchment boundary, including holes and disconnected parts. Nested upstream catchments appear separately. A shared absolute-residual display cap is used per pollutant across the selected native candidates.</p><p>Ordinary source layers also retain the complete scalar attributes for spatial inspection and editable GIS export.</p></div></div></div>';
    openForm('Prepare catchment residual maps','Create retained map sources, CSV tables and a grayscale PDF/SVG atlas from the existing completed result.',content,'Prepare maps',async()=>{
      if(workspace!==current()||ticket!==formRequest)throw Error('The study or map selection changed. Reopen this form.');
      const form=document.querySelector('#operation-form');
      const chosen=[...form.querySelectorAll('[name="calibration_maps_candidates"]:checked')].map(input=>input.value);
      const allowed=new Set(candidates.map(row=>row.run_id));
      if(chosen.some(id=>!allowed.has(id)))throw Error('Choose candidate runs from this original calibration.');
      const uncertainty=form.querySelector('[name="calibration_maps_uncertainty"]').value;
      if(uncertainty&&!uncertainties.some(row=>row.id===uncertainty))throw Error('Choose a retained sensitivity edition from this calibration.');
      return submitAction('calibration.maps.prepare',{report_id:reportId,
        candidate_run_ids:[report.selected_run_id,...new Set(chosen)],uncertainty_id:uncertainty||null});
    });
  }
  function layer(id){
    const value=packet?.map?.layers?.find(row=>row.id===id);
    if(!active()||!value)throw Error('Open an original retained residual-map layer.');
    return value;
  }
  function sourceButton(value){return spatialButton('source-info',value.source_id,'Open source map',value.source_collection_id);}
  function reviewsFor(value){
    return (packet.reviews??[]).filter(row=>row.layer_id===value.id).map(row=>
      spatialButton('spatial_reviews',row.review_id,'Open saved review')).join('');
  }
  function ticketFor(expected){
    if(!expected)return null;
    return (packet.artifacts??[]).find(row=>row.file.path===expected.path&&row.file.sha256===expected.sha256)?.download??null;
  }
  function retainedFiles(files){
    return fileList(files).replaceAll('data-action="preview-file"','data-action="calibration-maps-preview"');
  }
  function preview(fileId){
    if(!active())throw Error('Open this workspace’s retained map edition.');
    const item=(packet.artifacts??[]).find(row=>row.download.id===fileId)?.download;
    if(!item||!item.filename.toLowerCase().endsWith('.pdf'))throw Error('Choose a retained PDF from this original map edition.');
    detail(item.label||item.filename,
      '<div class="preview-options"><span>'+esc(number(item.bytes))+' bytes · <span class="mono">'+esc(short(item.sha256))+'</span></span>'+
      '<a class="button" href="'+esc(item.url)+'?download=1" download>Download original PDF</a></div>'+
      '<iframe class="preview-frame" title="'+esc(item.filename)+'" src="'+esc(item.url)+'"></iframe>',
      {kind:'file',id:item.id});
  }
  function layerFiles(value){
    return [value.geojson,value.csv,value.pdf,...(value.svg_pages??[])].filter(Boolean).map(ticketFor).filter(Boolean);
  }
  function layerDetails(value){
    const files=layerFiles(value),pages=value.svg_pages??[];
    const selected=value.run_id===packet.map.selected_run_id;
    const previews=pages.map((file,index)=>{
      const ticket=ticketFor(file);
      return ticket?'<figure class="calibration-map-page"><img loading="lazy" src="'+esc(ticket.url)+'" alt="'+esc(value.title+' — original catchment residual atlas, page '+(index+1))+'"><figcaption>Page '+(index+1)+' · <a href="'+esc(ticket.url)+'?download=1" download>Download original SVG</a></figcaption></figure>':'';
    }).join('');
    return section(value.title||human(value.parameter)+' residuals',
      selected?'Original selected native run; calibration and held-out descriptive catchments retain their own support.':'Challenger native run; original calibration catchments only.',
      '<div class="cards">'+[
        ['Pollutant',human(value.parameter),value.units],
        ['Calibration rows',number(count(value.calibration_rows)),'Original catchment/pollutant rows.'],
        ['Held-out rows',number(count(value.validation_rows)),'Selected run only; outside parameter selection.'],
        ['Incomplete native rows',number(count(value.incomplete_native_rows)),'Retained with missing support rather than assigned zero.'],
        ['Residual display cap',number(value.absolute_residual_display_cap),value.units+' · shared across these candidate maps for this pollutant.']
      ].map(([label,v,note])=>'<div class="card"><h3>'+esc(label)+'</h3><strong class="calibration-card-value">'+esc(v)+'</strong><p>'+esc(note)+'</p></div>').join('')+'</div>'+
      '<div class="section-body"><p>The source viewer shows original boundaries and scalar attributes. The retained atlas renders signed residuals as separate catchment panels; overlapping basins are not added together.</p><div class="page-actions">'+
      sourceButton(value)+button('review','Save original spatial review',value.id)+reviewsFor(value)+'</div></div>'+
      retainedFiles(files)+(previews?'<div class="calibration-map-atlas">'+previews+'</div>':'')+
      '<details class="technical"><summary>Original layer identity, spatial selection and display scale</summary><pre class="json-view">'+
      esc(json({run_id:value.run_id,profile_id:value.profile_id,selected_models:value.selected_models,
        source_collection_id:value.source_collection_id,source_id:value.source_id,
        spatial_selection:value.spatial_selection,view:value.view,absolute_residual_display_cap:value.absolute_residual_display_cap}))+'</pre></details>');
  }
  function layerTable(){
    const values=(packet.map.layers??[]).filter(row=>!filter||json([row.title,row.parameter,row.units,row.run_id,row.profile_id]).toLowerCase().includes(filter.toLowerCase()));
    return table(['Original layer','Candidate role','Rows','Support',''],values.map(value=>'<tr'+(value.id===selectedLayer?' class="calibration-selected-row"':'')+'>'+
      '<td><strong>'+esc(value.title||human(value.parameter))+'</strong><small>'+esc(value.units)+' · '+esc(short(value.run_id))+'</small></td>'+
      '<td>'+esc(value.run_id===packet.map.selected_run_id?'Original selected':'Challenger: calibration only')+'</td>'+
      '<td>'+number(count(value.rows))+'</td><td>'+number(count(value.incomplete_native_rows))+' incomplete</td>'+
      '<td class="actions-cell">'+button('layer','Atlas and files',value.id)+sourceButton(value)+reviewsFor(value)+'</td></tr>'));
  }
  function render(){
    if(!active())return '';
    const map=packet.map,notes=Array.isArray(map.interpretation)?map.interpretation:[map.interpretation].filter(Boolean);
    const value=map.layers.find(row=>row.id===selectedLayer)??map.layers[0];
    return '<header class="page-header"><div><p class="eyebrow">CALIBRATION · ORIGINAL CATCHMENTS</p><h1>'+esc(map.title||'Catchment residual maps')+
      '</h1><p>Retained observed, native and adjusted annual loads on the original catchment geometry.</p></div><div class="page-actions">'+
      button('nominal','Nominal calibration',map.calibration_id)+(map.uncertainty_id?button('uncertainty','Source-error sensitivity',map.uncertainty_id):'')+
      button('prepare','New map selection',map.calibration_id,map.uncertainty_id?'data-uncertainty="'+esc(map.uncertainty_id)+'"':'')+
      button('gis','Build editable GIS project',map.id)+button('open','Refresh retained maps',map.id)+'</div></header>'+
      section('Original catchment layers','Choose an atlas to inspect its retained support, original source attributes and files.',
      '<div class="calibration-table-controls"><label><span>Find a layer</span><input type="search" id="calibration-map-search" value="'+esc(filter)+'" placeholder="Candidate, pollutant or units"></label></div>'+
      '<div id="calibration-map-layer-table">'+layerTable()+'</div>')+
      (value?layerDetails(value):'<p class="calibration-empty">This retained map edition has no map layers.</p>')+
      section('Editable GIS and complete source files',
        'Build the retained ordinary GIS project from this exact source selection. Its task retains the editable ZIP, QGIS project and offline viewer.',
        '<div class="section-body"><div class="page-actions">'+button('gis','Build editable GIS project',map.id)+'<button type="button" data-view="gis-projects">Open editable GIS projects</button></div></div>'+
        retainedFiles(packet._downloads??[])+
        '<ul class="calibration-notes">'+notes.map(note=>'<li>'+esc(typeof note==='string'?note:json(note))+'</li>').join('')+'</ul>'+
        '<details class="technical"><summary>Original calibration, catchment lineage and GIS selection</summary><pre class="json-view">'+
        esc(json({id:map.id,calibration_id:map.calibration_id,plan_id:map.plan_id,uncertainty_id:map.uncertainty_id,
          selection:map.selection,original_catchments:map.original_catchments,gis_selection:map.gis_selection}))+'</pre></details>');
  }
  function bind(root){
    if(!active())return;
    const input=root.querySelector('#calibration-map-search');
    input?.addEventListener('input',()=>{filter=input.value;root.querySelector('#calibration-map-layer-table').innerHTML=layerTable();});
  }
  async function dispatch(node){
    const action=node.dataset.action?.replace(/^calibration-maps-/,''),id=node.dataset.id;
    if(action==='preview')return preview(node.dataset.fileId);
    if(action==='prepare')return prepareForm(id,node.dataset.uncertainty||null);
    if(action==='open')return open(id);
    if(action==='layer'){layer(id);selectedLayer=id;return repaint();}
    if(action==='review'){
      const selected=layer(id);
      return submitAction('calibration.maps.review',{map_id:packet.map.id,layer_id:selected.id});
    }
    if(action==='gis'){
      if(!active()||packet.map.id!==id)throw Error('Open the original retained map edition before building its GIS project.');
      return submitAction('gis.project.export',JSON.parse(JSON.stringify(packet.map.gis_selection)));
    }
    if(action==='nominal'){reset();return openReport(id);}
    if(action==='uncertainty'){reset();return openUncertainty(id);}
  }
  return {active,reset,invalidate,sync,summary,open,render,bind,dispatch};
}
