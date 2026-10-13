/* Same-DEM gauge catchments inside the existing Calibration workflow. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=value=>String(value??'').slice(0,12)||'—';
const pretty=value=>JSON.stringify(value,null,2);
const number=value=>Number.isFinite(value)?value.toLocaleString(undefined,{maximumSignificantDigits:8}):'—';
const option=(value,label,selected)=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(label)+'</option>';
const options=(rows,selected)=>'<option value="">Choose…</option>'+rows.map(([value,label])=>option(value,label,selected)).join('');
const button=(action,label,selection=null)=>'<button type="button" class="small" data-action="calibration-catchments-'+action+'"'+
  (selection?' data-selection="'+esc(JSON.stringify(selection))+'"':'')+'>'+esc(label)+'</button>';
const table=(headers,rows)=>'<div class="table-scroll"><table><thead><tr>'+headers.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const field=(title,control,note='')=>'<label><span>'+esc(title)+'</span>'+control+(note?'<small>'+esc(note)+'</small>':'')+'</label>';
const input=(name,value,type='text',extra='')=>'<input name="'+name+'" value="'+esc(value)+'" type="'+type+'" '+extra+'>';
const select=(name,rows,value)=>'<select name="'+name+'">'+options(rows,value)+'</select>';
const key=source=>JSON.stringify([source.source_collection_id,source.source_id]);
const choice=node=>{
  let value;try{value=JSON.parse(node.dataset.selection||'null');}catch{}
  if(!value||typeof value!=='object'||Array.isArray(value)||
    ['source_collection_id','source_id','id_field'].some(k=>typeof value[k]!=='string'||!value[k]))
    throw Error('Choose an original retained catchment edition.');
  return value;
};

export function createCalibrationCatchments({current,read,api,openForm,submitAction,detail,fileList,
  getData,bindForm,formOpening,openForObservations,captureCalibrationDraft}){
  let request=0,session=null;
  const storageKey=workspace=>'upstate-calibration-catchment-draft:'+workspace;
  function invalidate(){request++;session?.release();session=null;}
  function summary(){
    const rows=getData().calibration_catchment_sources??[];
    return '<section class="section"><header class="section-header"><div><h2>Gauge catchments from the model DEM</h2>'+
      '<p>Retain original outlets and basin geometry beside a new native D8 source. Inspect terrain coverage before using whole-catchment annual loads.</p></div>'+
      button('new','Prepare gauge catchments')+'</header>'+
      (rows.length?table(['Retained source','Original observation edition','Saved grid',''],rows.map(row=>
        '<tr><td><strong>'+esc(row.title)+'</strong><small>'+esc(row.vintage)+'</small></td>'+
        '<td class="mono">'+esc(short(row.metadata?.observation_id))+'</td><td class="mono">'+esc(short(row.metadata?.grid_id))+'</td>'+
        '<td>'+button('open','Open source and map',{source_collection_id:row.source_collection_id,source_id:row.source_id,id_field:row.id_field})+'</td></tr>')):
        '<p class="calibration-empty">Choose an existing saved DEM, an original observation edition and its retained basin boundaries.</p>')+'</section>';
  }
  async function open(selection){
    const workspace=current(),ticket=++request,opening=formOpening();
    const packet=await read('catchments',selection);
    if(workspace!==current()||ticket!==request||!opening.current())return;
    const result=packet.catchments,rows=result.analysis.outlets;
    detail(result.title,'<p>'+esc(result.analysis.notes[0])+'</p><div class="page-actions">'+
      button('use','Use these catchments in calibration',selection)+
      button('export','Download complete original source',selection)+
      '<a class="button" target="_blank" rel="noopener" href="'+esc(packet.viewer_url)+'">Open complete reading report</a></div>'+
      table(['Original catchment','D8 ha','Original ha','Original overlap','Outlet movement · m','Stream cell','DEM edge/nodata cells'],
        rows.map(row=>'<tr><td class="mono">'+esc(row.catchment_id)+'</td><td>'+number(row.area_ha)+'</td><td>'+
          number(row.original_area_ha)+'</td><td>'+number(row.original_overlap_fraction)+'</td><td>'+
          number(row.original_to_model_outlet_distance_m)+'</td><td>'+esc(row.outlet_on_stream===null?'Snapping off':row.outlet_on_stream?'Yes':'No')+
          '</td><td>'+number(row.edge_or_nodata_adjacent_cells)+'</td></tr>'))+
      '<iframe class="preview-frame" title="Original and model gauge catchments" src="'+esc(packet.viewer_url)+'"></iframe>'+
      '<ul>'+result.analysis.notes.map(v=>'<li>'+esc(v)+'</li>').join('')+'</ul>'+
      fileList(packet._downloads??[])+
      '<details class="technical"><summary>Original coordinates, native settings and source identities</summary><pre class="json-view">'+
      esc(pretty({selection:result.analysis.selection,input:result.analysis.input,catchments:result.catchments}))+'</pre></details>',
      {kind:'calibration-catchments',id:result.id});
  }
  async function use(selection){
    const workspace=current(),ticket=++request,opening=formOpening();
    const packet=await read('catchments',selection);
    if(workspace!==current()||ticket!==request||!opening.current())return;
    const result=packet.catchments;
    await openForObservations({workspace_key:workspace,observation_id:result.observation_id,
      observation_record_ids:result.observation_record_ids,catchments:result.catchments,
      title:result.title+' — annual reference comparison'});
    if(workspace===current())document.querySelector('#detail-dialog')?.close();
  }
  async function prepare(){
    captureCalibrationDraft();
    const workspace=current(),ticket=++request,opening=formOpening();
    let catalog;
    try{catalog=await read('catchments-catalog');}
    catch(error){if(opening.current())throw error;return;}
    if(workspace!==current()||ticket!==request||!opening.current())return;
    let saved={};try{saved=JSON.parse(sessionStorage.getItem(storageKey(workspace))||'{}');}catch{}
    if(!catalog.grids.length)throw Error('Prepare and save an original model grid before delineating its gauge catchments.');
    if(!catalog.observations.length)throw Error('Import the original observation CSV before selecting its outlet coordinates.');
    if(!catalog.sources.length)throw Error('Import the original basin polygons before delineating a separate model basin edition.');
    const seed=saved.selection??{};
    const hasRaw=name=>Array.isArray(saved.raw)&&saved.raw.some(v=>v?.name===name);
    const rawValue=(name,fallback)=>hasRaw(name)?
      saved.raw.find(v=>v?.name===name).value:fallback;
    const rawChecked=(name,fallback)=>Array.isArray(saved.raw)&&saved.raw.some(v=>v?.name===name)?
      Boolean(saved.raw.find(v=>v?.name===name).checked):fallback;
    let formSession=null;
    let preview=null,previewInput=null,sourceFields=null,sourceTicket=0,previewTicket=0;
    const previousObservation=rawValue('cc_observation',seed.observation_id);
    const observationId=hasRaw('cc_observation')?previousObservation:catalog.observations.some(v=>v.id===previousObservation)?previousObservation:catalog.observations[0].id;
    const original=seed.original_catchments??{};
    const previousSource=rawValue('cc_source',key(original));
    const sourceKey=hasRaw('cc_source')?previousSource:catalog.sources.some(v=>key(v)===previousSource)?previousSource:key(catalog.sources[0]);
    const previousGrid=rawValue('cc_grid',seed.grid_id);
    const gridId=hasRaw('cc_grid')?previousGrid:catalog.grids.some(v=>v.id===previousGrid)?previousGrid:catalog.grids[0].id;
    const content='<div class="calibration-form" data-catchment-form><div class="form-grid">'+
      field('Source title',input('cc_title',rawValue('cc_title',seed.title||'Same-DEM gauge catchments')))+
      field('Saved model grid',select('cc_grid',catalog.grids.map(v=>[v.id,v.title]),gridId),
        'Uses this exact prepared elevation raster, including any retained conditioning.')+
      field('Original observations',select('cc_observation',catalog.observations.map(v=>[v.id,v.title]),observationId))+
      field('Coordinate carrier',select('cc_carrier',[['source_records','Original source_records metadata'],['original','Original CSV columns']],
        rawValue('cc_carrier',seed.coordinate_carrier||'source_records')),'Choose the original carrier explicitly. Fields are never substituted between carriers.')+
      field('Longitude field',select('cc_longitude',[],''),'Original WGS84 longitude in decimal degrees.')+
      field('Latitude field',select('cc_latitude',[],''),'Original WGS84 latitude in decimal degrees.')+
      '<label class="full"><input type="checkbox" name="cc_wgs84"'+(rawChecked('cc_wgs84',seed.coordinate_crs==='EPSG:4326')?' checked':'')+
        '> These original columns represent WGS84 longitude and latitude (EPSG:4326).</label>'+
      field('Original basin source',select('cc_source',catalog.sources.map(v=>[key(v),v.collection_title+' / '+v.title]),sourceKey))+
      field('Original vector layer',select('cc_layer',[],''))+
      field('Original catchment ID field',select('cc_id_field',[],''),'Must match the retained observation catchment IDs exactly.')+
      '<div class="full" data-cc-source-details></div><div class="full"><h3>Original outlets to retain</h3><div data-cc-catchments></div></div>'+
      '<label class="full"><input type="checkbox" name="cc_snap"'+(rawChecked('cc_snap',seed.snap_points)?' checked':'')+'> Snap within a native stream search window</label>'+
      field('Stream initiation area · hectares',input('cc_area',rawValue('cc_area',seed.stream_area_ha??100),'number','min="0.000001" step="any"'))+
      field('Stream search window · grid cells',input('cc_distance',rawValue('cc_distance',seed.snap_distance_cells??5),'number','min="1" step="1"'),
        'This is the native pixel search window. Actual geodesic movement and stream membership are reported.')+
      field('Scientific source and extent notes','<textarea name="cc_notes" rows="4">'+esc(rawValue('cc_notes',seed.notes??''))+'</textarea>')+
      '<div class="full"><button type="button" data-cc-preview>Inspect original outlets and terrain</button>'+
      '<div data-cc-preview-result aria-live="polite"><p>Inspect the exact selection before starting native DelineateIt.</p></div></div></div></div>';
    let root;
    const control=name=>root.querySelector('[name="'+name+'"]');
    const value=name=>control(name).value;
    function collect(){
      const pair=JSON.parse(value('cc_source'));
      const snap=control('cc_snap').checked;
      if(!control('cc_wgs84').checked)throw Error('Confirm the actual source coordinate datum before projecting the original outlets.');
      const selected={schema:'upstate.calibration-catchment-selection/v1',title:value('cc_title'),
        grid_id:value('cc_grid'),observation_id:value('cc_observation'),
        coordinate_carrier:value('cc_carrier'),coordinate_crs:'EPSG:4326',
        longitude_field:value('cc_longitude'),latitude_field:value('cc_latitude'),
        original_catchments:{source_collection_id:pair[0],source_id:pair[1],id_field:value('cc_id_field'),
          ...(value('cc_layer')?{layer:value('cc_layer')}:{})},
        catchment_ids:[...root.querySelectorAll('[name="cc_catchment"]:checked')].map(v=>v.value),
        snap_points:snap,notes:value('cc_notes')};
      if(snap)Object.assign(selected,{stream_area_ha:Number(value('cc_area')),snap_distance_cells:Number(value('cc_distance'))});
      return selected;
    }
    function save(){
      if(!formSession?.current())return;
      const raw=[...root.querySelectorAll('input,select,textarea')].map(node=>
        ({name:node.name,value:node.value,checked:node.checked,type:node.type}));
      let selection;try{selection=collect();}catch{}
      try{sessionStorage.setItem(storageKey(workspace),JSON.stringify({selection,raw}));}catch{}
    }
    function changed(){
      preview=null;previewInput=null;previewTicket++;
      root.querySelector('[data-cc-preview-result]').innerHTML='<p>Settings changed. Inspect the current original outlets and terrain before running.</p>';
      save();
    }
    function coordinateFields(initial=false){
      const row=catalog.observations.find(v=>v.id===value('cc_observation'));
      const fields=row?.coordinate_fields?.[value('cc_carrier')]??[];
      for(const [name,originalName,fallback] of [['cc_longitude','longitude_field','longitude'],['cc_latitude','latitude_field','latitude']]){
        const old=initial?rawValue(name,seed[originalName]):value(name);
        const explicit=initial?hasRaw(name):true;
        control(name).innerHTML=options(fields.map(v=>[v,v]),fields.includes(old)?old:explicit?'':fields.includes(fallback)?fallback:'');
      }
      const rawCatchments=Array.isArray(saved.raw)?saved.raw.filter(v=>v?.name==='cc_catchment'):null;
      const previous=initial?(rawCatchments?.length?rawCatchments.filter(v=>v.checked).map(v=>v.value):seed.catchment_ids):
        [...root.querySelectorAll('[name="cc_catchment"]:checked')].map(v=>v.value);
      root.querySelector('[data-cc-catchments]').innerHTML=(row?.catchment_ids??[]).map(id=>
        '<label><input type="checkbox" name="cc_catchment" value="'+esc(id)+'"'+(!previous||previous.includes(id)?' checked':'')+
        '> <span class="mono">'+esc(id)+'</span></label>').join('');
    }
    function layerFields(restore=false){
      const layer=sourceFields?.layers?.find(row=>row.name===value('cc_layer'));
      const fields=Object.keys(layer?.fields??{});
      const previous=restore?rawValue('cc_id_field',original.id_field):value('cc_id_field');
      const explicit=restore?hasRaw('cc_id_field'):true;
      control('cc_id_field').innerHTML=options(fields.map(v=>[v,v]),fields.includes(previous)?previous:explicit?'':fields.includes('catchment_id')?'catchment_id':'');
      root.querySelector('[data-cc-source-details]').innerHTML=sourceFields?
        '<details><summary>Original source fields, coordinates and sample rows</summary><p>'+esc(sourceFields.title)+' · '+esc(sourceFields.vintage)+
        '</p><pre class="json-view">'+esc(pretty({crs:layer?.crs,fields:layer?.fields,sample_rows:layer?.sample_rows}))+'</pre></details>':'';
    }
    async function loadSource(initial=false){
      const stamp=++sourceTicket,source=value('cc_source');
      sourceFields=null;control('cc_layer').innerHTML=options([],null);control('cc_id_field').innerHTML=options([],null);
      root.querySelector('[data-cc-source-details]').textContent=source?'Loading original source fields…':'Choose the original basin source.';
      if(!source){save();return;}
      try{
        const pair=JSON.parse(source);
        const result=await read('catchments-source',{source_collection_id:pair[0],source_id:pair[1]});
        if(!formSession?.current()||sourceTicket!==stamp||value('cc_source')!==source)return;
        sourceFields=result;
        const wanted=initial?rawValue('cc_layer',original.layer):result.layers[0]?.name;
        const selected=result.layers.some(v=>v.name===wanted)?wanted:initial&&hasRaw('cc_layer')?'':result.layers[0]?.name;
        control('cc_layer').innerHTML=options(result.layers.map(v=>[v.name,v.name]),selected);
        layerFields(initial);save();
      }catch(error){
        if(formSession?.current()&&sourceTicket===stamp&&value('cc_source')===source)
          root.querySelector('[data-cc-source-details]').textContent=error.message;
      }
    }
    openForm('Prepare gauge catchments','Use the original retained coordinate fields with the exact saved DEM. Native outputs are retained as a separate source edition.',
      content,'Run native delineation',async()=>{
        if(!formSession?.current()||workspace!==current())throw Error('Open the current original catchment selection.');
        const selection=collect();
        if(!preview?.can_build||previewInput!==JSON.stringify(selection))
          throw Error('Inspect this exact selection and resolve out-of-grid or NoData outlets before running.');
        save();
        return submitAction('calibration.catchments.build',{selection});
      });
    root=document.querySelector('[data-catchment-form]');
    formSession=bindForm(root,()=>{sourceTicket++;previewTicket++;});
    session=formSession;
    coordinateFields(true);
    // Source-dependent fields are restored after their original catalog options exist.
    for(const event of ['input','change'])formSession.listen(root,event,changed);
    formSession.listen(control('cc_observation'),'change',()=>{coordinateFields(false);save();});
    formSession.listen(control('cc_carrier'),'change',()=>{coordinateFields(false);save();});
    formSession.listen(control('cc_layer'),'change',()=>{layerFields();save();});
    formSession.listen(control('cc_source'),'change',()=>{void loadSource(false);});
    formSession.listen(root.querySelector('[data-cc-preview]'),'click',async()=>{
      const stamp=++previewTicket;
      try{
        const selection=collect(),encoded=JSON.stringify(selection);
        root.querySelector('[data-cc-preview-result]').textContent='Inspecting original coordinates and saved terrain…';
        const result=await api('/api/calibration/catchments-preview',{method:'POST',body:{workspace,selection}});
        if(!formSession?.current()||workspace!==current()||stamp!==previewTicket||JSON.stringify(collect())!==encoded)return;
        preview=result;previewInput=encoded;
        root.querySelector('[data-cc-preview-result]').innerHTML=
          '<p>'+esc(result.can_build?'Original outlets are on finite cells. Review basin extent before running.':'Resolve the outlet coverage shown below before running.')+'</p>'+
          table(['Original catchment','Status','Original lon / lat','Original basin in DEM rectangle','Grid cell'],
            result.outlets.map(row=>'<tr><td class="mono">'+esc(row.catchment_id)+'</td><td>'+esc(row.status)+'</td><td>'+
              esc(row.original_longitude_value)+' / '+esc(row.original_latitude_value)+'</td><td>'+
              number(row.original_basin.fraction_within_dem_rectangle)+'</td><td>'+esc(row.row)+' / '+esc(row.column)+'</td></tr>'))+
          '<p>'+esc(result.snapping_meaning)+'</p><pre class="json-view">'+
          esc(pretty({settings:result.settings,original_dem:result.dem_source,prepared_dem:result.dem,grid:result.grid}))+'</pre>';
      }catch(error){if(formSession?.current()&&stamp===previewTicket)root.querySelector('[data-cc-preview-result]').textContent=error.message;}
    });
    await loadSource(true);
  }
  async function dispatch(node){
    const action=node.dataset.action?.replace(/^calibration-catchments-/,'');
    if(action==='new')return prepare();
    const selected=choice(node);
    if(action==='open')return open(selected);
    if(action==='use')return use(selected);
    if(action==='export')return submitAction('calibration.catchments.export',{selection:selected});
  }
  function taskActions(task){
    const selection=task.result?.catchments;
    return selection?button('open','Open original catchment source',selection):'';
  }
  return {summary,dispatch,taskActions,invalidate};
}
