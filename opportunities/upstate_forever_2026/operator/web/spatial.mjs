import {isReceivingWaterTarget, receivingWaterTargetMatches, receivingWaterView, receivingWaterStateSignature} from './receiving_water_spatial.mjs';

import {regionMarkup,regionFeatureButton,createRegionAnalysis} from './spatial_regions.mjs';

import {renderAtlasReview,reconcileAtlasReview,editAtlasReview} from './atlas_review_fields.mjs';

const SVG_NS='http://www.w3.org/2000/svg';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const selectionKey=value=>JSON.stringify(value??null);
const validView=value=>value&&typeof value.crs==='string'&&value.crs&&Array.isArray(value.bounds)&&value.bounds.length===4&&value.bounds.every(finite)&&value.bounds[2]>value.bounds[0]&&value.bounds[3]>value.bounds[1];
const fmt=value=>finite(value)?value.toLocaleString(undefined,{maximumSignificantDigits:10}):String(value??'—');
const field=(title,body,note='')=>'<label class="spatial-field"><span>'+esc(title)+'</span>'+body+(note?'<small>'+esc(note)+'</small>':'')+'</label>';
const option=(value,title,selected)=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(title)+'</option>';
const button=(action,title,attrs='')=>'<button type="button" data-spatial-action="'+action+'" '+attrs+'>'+esc(title)+'</button>';
const identity=layer=>layer?'<span class="mono" title="'+esc(layer.sha256)+'">'+esc(layer.sha256?.slice(0,16)||layer.id)+'</span>':'—';

function geometryPath(geometry,view,size){
  if(!geometry||!validView(view))return '';
  const [left,bottom,right,top]=view.bounds;
  const xy=point=>Array.isArray(point)&&finite(point[0])&&finite(point[1])?[(point[0]-left)/(right-left)*size.width,(top-point[1])/(top-bottom)*size.height]:null;
  const line=(points,close=false)=>{
    let out='',started=false;
    for(const point of points||[]){const p=xy(point);if(!p){started=false;continue;}out+=(started?'L':'M')+p[0].toFixed(3)+' '+p[1].toFixed(3);started=true;}
    return out+(close&&started?'Z':'');
  };
  const dot=point=>{const p=xy(point);return p?'M'+(p[0]-3).toFixed(3)+' '+p[1].toFixed(3)+'a3 3 0 1 0 6 0a3 3 0 1 0 -6 0':'';};
  switch(geometry.type){
    case 'Point':return dot(geometry.coordinates);
    case 'MultiPoint':return (geometry.coordinates||[]).map(dot).join('');
    case 'LineString':return line(geometry.coordinates);
    case 'MultiLineString':return (geometry.coordinates||[]).map(points=>line(points)).join('');
    case 'Polygon':return (geometry.coordinates||[]).map(points=>line(points,true)).join('');
    case 'MultiPolygon':return (geometry.coordinates||[]).flatMap(polygon=>polygon.map(points=>line(points,true))).join('');
    case 'GeometryCollection':return (geometry.geometries||[]).map(item=>geometryPath(item,view,size)).join('');
    default:return '';
  }
}

export function createSpatialWorkspace({request,getWorkspace,refreshState,showTask,openItem,toast}){
  const models=new Map();
  let current=null,pendingTarget=null;

  function newModel(key){
    return {key,catalog:null,reference:null,primary:null,comparison:null,mode:'single',view:null,scale:{mode:'auto'},overlays:[],markers:[],title:'',notes:'',atlas_review:null,previous_review_id:null,tool:'inspect',swipe:50,point:null,frame:null,descriptions:new Map(),pendingSave:null,dirty:false,exportOptions:{review_id:'',paper:'letter',dpi:220},exportOperations:new Map(),exportInFlight:null,exportItems:[],exportTasks:[]};
  }
  function alive(c){return !!c&&current===c&&!c.disposed&&getWorkspace()===c.key&&c.root.isConnected;}
  function assertCurrent(c){if(!alive(c))throw new DOMException('The selected workspace changed.','AbortError');}
  function controller(c){const value=new AbortController();c.controllers.add(value);return value;}
  function release(c,control){c.controllers.delete(control);}
  function stopGroup(c,name){c[name]?.abort();c[name]=null;}
  function quiet(error){return error?.name==='AbortError';}
  function fail(c,error){if(alive(c)&&!quiet(error)){c.root.querySelector('[data-spatial-error]').textContent=error.message||String(error);c.root.querySelector('[data-spatial-error]').hidden=false;status(c,'Review the selection and retry.');}}
  function clearError(c){const node=c.root.querySelector('[data-spatial-error]');if(node){node.hidden=true;node.textContent='';}}
  function status(c,message){if(alive(c)){c.root.querySelector('[data-spatial-status]').textContent=message;}}
  function layer(c,selected){return c.model.catalog?.layers.find(item=>item.id===(selected?.layer_id||selected));}
  function selected(c,id){const row=layer(c,id);return row?{layer_id:row.id,...(row.kind==='raster'?{band:1}:{})}:null;}
  function groupTitle(name){return ({'receiving-water-plan':'Receiving-water boundaries','receiving-water-analysis':'Receiving-water results',source:'Original sources',grid:'Model grids',run:'Native runs',comparison:'Run comparisons',delivery:'Delivery assets'})[name]||name;}
  function layerOptions(c,kind,selectedId,emptyTitle){
    const rows=(c.model.catalog?.layers||[]).filter(row=>!kind||row.kind===kind),groups=new Map();
    for(const row of rows){const name=groupTitle(row.group);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(row);}
    return (emptyTitle?option('',emptyTitle,selectedId||''):'')+[...groups].map(([name,items])=>'<optgroup label="'+esc(name)+'">'+items.map(row=>option(row.id,row.title+(row.units?' · '+row.units:''),selectedId)).join('')+'</optgroup>').join('');
  }
  async function spatial(c,path,data,signal){
    const value=await request('/api/spatial/'+path,{method:'POST',body:{workspace:c.key,...data},signal});
    assertCurrent(c);
    if(value.workspace_key!==c.key)throw Error('This response belongs to a different workspace. Reopen the selected workspace.');
    return value;
  }
  async function describe(c,selection,signal){
    if(!selection)return null;
    const row=layer(c,selection);
    if(!row)throw Error('The selected source is no longer in this workspace.');
    const key=row.sha256+':'+selectionKey(selection);
    if(c.model.descriptions.has(key))return c.model.descriptions.get(key);
    const value=await spatial(c,'describe',{selection},signal);
    c.model.descriptions.set(key,value);
    return value;
  }

  function shell(){
    return '<header class="page-header"><div><p class="eyebrow">SCIENTIFIC WORKBENCH</p><h1>Spatial review</h1><p>Review original rasters and vector sources together, inspect native values, and retain the selected view with your scientific delivery.</p></div><div class="page-actions">'+button('refresh-catalog','Refresh sources')+'</div></header>'+
    '<div class="notice error" data-spatial-error role="alert" hidden></div>'+
    '<div class="spatial-workbench">'+
      '<section class="spatial-map-area" aria-label="Spatial review workspace">'+
        '<div class="spatial-source-controls" data-spatial-source-controls></div>'+
        '<div class="spatial-tools" role="toolbar" aria-label="Map controls">'+
          '<div class="spatial-tool-group">'+button('tool-inspect','Inspect','aria-pressed="true" title="Inspect original cells and features (I)"')+button('tool-pan','Pan','aria-pressed="false" title="Pan the linked map view (P)"')+button('tool-region','Area','aria-pressed="false" title="Drag a rectangle for native region measurements (A)"')+button('tool-mark','Mark','aria-pressed="false" title="Place a review marker (M)"')+'</div>'+
          '<div class="spatial-tool-group">'+button('zoom-in','Zoom in','aria-label="Zoom in"')+button('zoom-out','Zoom out','aria-label="Zoom out"')+button('fit','Fit source','title="Fit the original reference bounds"')+'</div>'+
          '<span data-spatial-coordinate class="spatial-coordinate">Choose a source to begin.</span>'+
        '</div>'+
        '<div class="spatial-fit-confirm" data-spatial-fit-confirm hidden><p>The source uses another coordinate system. Existing markers use the current map coordinates.</p>'+button('fit-clear-markers','Clear markers and fit source')+button('fit-cancel','Keep this view')+'</div>'+
        '<div class="spatial-canvases" data-spatial-canvases><div class="spatial-map-empty">Loading retained spatial sources…</div></div>'+
        '<div class="spatial-swipe-control" data-spatial-swipe-control hidden>'+field('Reveal right source on left of divider','<input type="range" min="0" max="100" step="1" value="50" data-spatial-input="swipe">')+'</div>'+
        '<div class="spatial-map-footer"><div data-spatial-legend></div><p data-spatial-status role="status" aria-live="polite">Loading retained spatial sources…</p></div>'+
        '<div class="spatial-view-meta" data-spatial-view-meta></div>'+
        '<div class="spatial-warning" data-spatial-warnings hidden></div>'+
        '<section class="spatial-inspector" aria-label="Native point inspection"><header><h2>Original value at point</h2>'+button('clear-point','Clear inspection')+'</header><div data-spatial-inspection><p class="note">Click the map with Inspect selected to read original native cell values and nearby original features.</p></div></section>'+
        regionMarkup()+
      '</section>'+
      '<aside class="spatial-side" aria-label="Spatial review settings">'+
        '<section><h2>Vector overlays</h2><p class="note">Visible features are read in full for this viewport. Layer and attribute filters select original data.</p><div data-spatial-overlays></div><div class="spatial-overlay-add">'+field('Original vector source','<select data-spatial-input="add-overlay"><option value="">Choose a vector source</option></select>')+button('overlay-add','Add overlay')+'</div></section>'+
        '<section><h2>Review markers</h2><div data-spatial-markers></div></section>'+
        '<section><h2>Save this review</h2><div data-spatial-atlas-review></div>'+field('Review title','<input data-spatial-input="title" maxlength="240" placeholder="Review title">')+field('Interpretation and notes','<textarea data-spatial-input="notes" rows="5" placeholder="Record the finding, assumptions, or follow-up work."></textarea>')+button('save','Save review','class="primary"')+'<p class="note" data-spatial-save-status></p><div data-spatial-reviews></div></section>'+
        '<section class="spatial-export-section"><h2>Printable map packs</h2><p class="note">Export a saved revision with its original extent, overlays and markers. Save current view changes before selecting that revision.</p><div data-spatial-export-controls></div><p class="note" data-spatial-export-status role="status" aria-live="polite"></p><div data-spatial-exports></div></section>'+
      '</aside>'+
    '</div>';
  }

  function sourceControls(c){
    renderAtlasReview(c.root,c.model);
    const controls=c.root.querySelector('[data-spatial-source-controls]'),focused=controls.contains(document.activeElement)?document.activeElement.dataset.spatialInput:null;
    const m=c.model,refLayer=layer(c,m.reference),refNative=m.descriptions.get(refLayer?.sha256+':'+selectionKey(m.reference))?.native;
    const band=(name,value)=>{
      if(!value)return '';
      const row=layer(c,value),key=row?.sha256+':'+selectionKey(value),count=m.descriptions.get(key)?.native?.count||Math.max(1,value.band||1);
      return field(name==='primary'?'Left source band':'Right source band','<select data-spatial-input="'+name+'-band">'+Array.from({length:count},(_,i)=>option(String(i+1),'Band '+(i+1),String(value.band||1))).join('')+'</select>');
    };
    c.root.querySelector('[data-spatial-source-controls]').innerHTML=
      field('Reference extent / coordinate system','<select data-spatial-input="reference">'+layerOptions(c,null,m.reference?.layer_id)+'</select>',filterText(m.reference?.where))+
      (refNative?.kind==='vector'&&refNative.layers?.length?field('Reference native vector layer','<select data-spatial-input="reference-layer">'+refNative.layers.map(name=>option(name,name,m.reference.layer||refNative.selected_layer)).join('')+'</select>'):'')+
      field('Left source raster','<select data-spatial-input="primary">'+layerOptions(c,'raster',m.primary?.layer_id,'Vector-only view')+'</select>')+
      field('Right source raster','<select data-spatial-input="comparison">'+layerOptions(c,'raster',m.comparison?.layer_id,'No right source')+'</select>')+
      band('primary',m.primary)+band('comparison',m.comparison)+
      field('Display','<select data-spatial-input="mode">'+[
        ['single','Single raster'],['compare','Linked side by side'],['swipe','Swipe between sources'],['difference','Right source minus left source']
      ].map(([value,title])=>'<option value="'+value+'"'+(m.mode===value?' selected':'')+(value!=='single'&&(!m.primary||!m.comparison)?' disabled':'')+'>'+title+'</option>').join('')+'</select>')+
      field('Raster scale','<select data-spatial-input="scale-mode">'+option('auto','Visible source values','auto'===m.scale.mode?'auto':'fixed')+option('fixed','Fixed physical range',m.scale.mode)+'</select>')+
      (m.scale.mode==='fixed'?field('Minimum','<input type="number" step="any" data-spatial-input="scale-min" value="'+esc(m.scale.minimum??'')+'">')+field('Maximum','<input type="number" step="any" data-spatial-input="scale-max" value="'+esc(m.scale.maximum??'')+'">'):'');
    const add=c.root.querySelector('[data-spatial-input="add-overlay"]'),addValue=add.value;
    add.innerHTML=layerOptions(c,'vector',addValue,'Choose a vector source');
    if(focused)controls.querySelector('[data-spatial-input="'+focused+'"]')?.focus({preventScroll:true});
    c.regions?.updateSources();
  }
  function renderMarkers(c){
    c.root.querySelector('[data-spatial-markers]').innerHTML=c.model.markers.length?c.model.markers.map((item,index)=>
      '<div class="spatial-marker-row"><span class="spatial-marker-number">'+(index+1)+'</span><label><span class="sr-only">Marker '+(index+1)+' label</span><input data-spatial-input="marker-label" data-index="'+index+'" maxlength="500" value="'+esc(item.label)+'"><small>'+esc(fmt(item.x))+', '+esc(fmt(item.y))+'</small></label>'+button('marker-remove','Remove','data-index="'+index+'" class="small" aria-label="Remove marker '+(index+1)+'"')+'</div>').join(''):'<p class="note">Choose Mark, then click the map to retain a labelled point in the current coordinate system.</p>';
  }
  function renderReviews(c){
    const rows=c.model.catalog?.reviews||[];
    c.root.querySelector('[data-spatial-reviews]').innerHTML='<h3>Retained reviews</h3>'+(rows.length?'<ul class="spatial-review-list">'+rows.map(row=>'<li><div><strong>'+esc(row.title||row.content?.title||row.id)+'</strong><small>'+esc(row.created_at||row.saved_at||'')+'</small></div>'+button('review-open','Open','data-id="'+esc(row.id)+'" class="small"')+'</li>').join('')+'</ul>':'<p class="note">Saved views will appear here and in delivery selection.</p>');
    renderExports(c);
  }
  function exportSelection(m){return {review_id:m.exportOptions.review_id,paper:m.exportOptions.paper,dpi:m.exportOptions.dpi};}
  function renderExports(c){
    if(!alive(c))return;
    const m=c.model,rows=m.catalog?.reviews||[],selection=m.exportOptions;
    if(!rows.some(row=>row.id===selection.review_id))selection.review_id=rows[0]?.id||'';
    const controls=c.root.querySelector('[data-spatial-export-controls]'),focused=controls.contains(document.activeElement)?document.activeElement.dataset.spatialInput:null;
    const operation=m.exportOperations.get(JSON.stringify(exportSelection(m))),sending=!!m.exportInFlight;
    controls.innerHTML=field('Saved review','<select data-spatial-input="export-review"'+(sending?' disabled':'')+'>'+option('','Choose a saved review',selection.review_id)+rows.map(row=>option(row.id,row.title||row.content?.title||row.id,selection.review_id)).join('')+'</select>')+
      '<div class="spatial-export-format">'+field('Paper','<select data-spatial-input="export-paper"'+(sending?' disabled':'')+'>'+option('letter','US Letter',selection.paper)+option('a4','A4',selection.paper)+'</select>')+
      field('Resolution','<select data-spatial-input="export-dpi"'+(sending?' disabled':'')+'>'+[150,220,300].map(dpi=>option(String(dpi),dpi+' dpi',String(selection.dpi))).join('')+'</select>')+'</div>'+
      button('export-create',sending?'Retaining export…':operation?.task_id?'View export task':operation?.attempted?'Retry same export':'Create map pack','class="primary"'+(!selection.review_id||sending?' disabled':''));
    if(focused)controls.querySelector('[data-spatial-input="'+focused+'"]')?.focus({preventScroll:true});
    const task=operation?.task_id?m.exportTasks.find(row=>row.id===operation.task_id):null;
    c.root.querySelector('[data-spatial-export-status]').textContent=sending?'The selected revision and print settings are being retained.':task?'Export task: '+task.state+'. Open the task for its files and progress.':operation?.task_id?'Export request retained. Open its task for files and progress.':operation?.error?'The export selection is retained here. Retry to continue the same request.':selection.review_id?'The pack includes the printable figure, saved review and source provenance.':'Save a spatial review to create a printable map pack.';
    c.root.querySelector('[data-spatial-exports]').innerHTML='<h3>Retained map packs</h3>'+(m.exportItems.length?'<ul class="spatial-review-list">'+m.exportItems.map(row=>{
      const paper=row.selection?.paper,dpi=row.selection?.dpi;
      return '<li><div><strong>'+esc(row.title||row.id)+'</strong><small>'+esc([row.state,paper?paper.toUpperCase():'',dpi?dpi+' dpi':''].filter(Boolean).join(' · '))+'</small></div>'+button('export-open','Open files','data-id="'+esc(row.id)+'" class="small"')+'</li>';
    }).join('')+'</ul>':'<p class="note">Completed packs stay with this workspace and its portable archive.</p>');
  }
  async function exportReview(c){
    const m=c.model,payload=exportSelection(m);
    if(!payload.review_id||!m.catalog?.reviews.some(row=>row.id===payload.review_id))throw Error('Select a retained spatial review to export.');
    if(!['letter','a4'].includes(payload.paper)||![150,220,300].includes(payload.dpi))throw Error('Select a supported paper size and resolution.');
    const key=JSON.stringify(payload);
    let operation=m.exportOperations.get(key);
    if(operation?.task_id){if(alive(c))await showTask(operation.task_id);return;}
    if(m.exportInFlight)return;
    if(!operation){operation={operation_id:crypto.randomUUID(),payload:clone(payload),task_id:null,attempted:false,error:null};m.exportOperations.set(key,operation);}
    operation.attempted=true;operation.error=null;m.exportInFlight=operation;renderExports(c);
    try{
      const row=await request('/api/actions',{method:'POST',body:{workspace:c.key,action:'spatial.review.export',payload:operation.payload,operation_id:operation.operation_id}});
      if(!row.id)throw Error('The workspace did not return the retained export identity. Retry this same selection.');
      operation.task_id=row.id;
      if(!alive(c))return;
      await refreshState({force:true});
      if(alive(c))await showTask(row.id);
    }catch(error){operation.error=error.message||String(error);throw error;}
    finally{
      if(m.exportInFlight===operation)m.exportInFlight=null;
      if(current?.model===m&&alive(current))renderExports(current);
    }
  }
  function filterText(where){
    if(!where)return '';
    return Object.entries(where).map(([key,value])=>key+' = '+(typeof value==='string'?value:JSON.stringify(value))).join('; ');
  }
  function captureFilterDrafts(c){
    for(const article of c.root.querySelectorAll('[data-overlay-key]')){
      const item=c.model.overlays.find(row=>row._uiKey===article.dataset.overlayKey);if(!item)continue;
      if(item._resetFilterDraft){delete item._filterDraft;delete item._resetFilterDraft;continue;}
      item._filterDraft=[...article.querySelectorAll('.spatial-filter-row')].map(row=>({field:row.querySelector('[data-spatial-filter-field]').value,type:row.querySelector('[data-spatial-filter-type]').value,text:row.querySelector('[data-spatial-filter-value]').value}));
    }
  }
  function renderOverlays(c){
    captureFilterDrafts(c);
    c.root.querySelector('[data-spatial-overlays]').innerHTML=c.model.overlays.map((item,index)=>{
      const row=layer(c,item.selection),desc=c.model.descriptions.get(row?.sha256+':'+selectionKey(item.selection))?.native;
      const entries=Object.entries(item.selection.where||{});item._uiKey||=crypto.randomUUID();
      return '<article class="spatial-overlay" data-overlay-key="'+item._uiKey+'" data-overlay="'+index+'"><header><label class="check"><input type="checkbox" data-spatial-input="overlay-visible" data-index="'+index+'"'+(item.visible?' checked':'')+'><span>'+esc(item.label||row?.title||item.selection.layer_id)+'</span></label><div>'+button('overlay-fit','Fit','data-index="'+index+'" class="small" title="Fit this original layer and its selected filter"')+button('overlay-remove','Remove','data-index="'+index+'" class="small"')+'</div></header>'+
        (desc?.layers?.length?field('Native vector layer','<select data-spatial-input="overlay-layer" data-index="'+index+'">'+desc.layers.map(name=>option(name,name,item.selection.layer||desc.selected_layer)).join('')+'</select>'):'')+
        '<div class="spatial-overlay-style">'+field('Line style','<select data-spatial-input="overlay-style" data-index="'+index+'">'+['solid','dash','dot'].map(name=>option(name,name,item.style)).join('')+'</select>')+field('Width','<input type="number" min="0.25" max="8" step="0.25" data-spatial-input="overlay-width" data-index="'+index+'" value="'+esc(item.width)+'">')+field('Opacity','<input type="number" min="0" max="1" step="0.05" data-spatial-input="overlay-opacity" data-index="'+index+'" value="'+esc(item.opacity)+'">')+'</div>'+
        '<details class="spatial-filter"><summary>Attribute filters'+(entries.length?' · '+entries.length:'')+'</summary><div data-spatial-filter-rows>'+(item._filterDraft?item._filterDraft.map((draft,i)=>filterRow(c,index,draft.field,'',i,draft)):entries.map(([key,value],i)=>filterRow(c,index,key,value,i))).join('')+'</div>'+button('filter-add','Add field filter','data-index="'+index+'" class="small"')+button('filter-apply','Apply filters','data-index="'+index+'" class="small"')+button('filter-revert','Discard filter edits','data-index="'+index+'" class="small"')+'<p class="note">All field conditions must match. Native numbers retain their original type.</p></details>'+
        '<p class="spatial-overlay-progress" data-overlay-progress="'+index+'">'+esc(filterText(item.selection.where)||'Whole native layer')+'</p><small>Source '+identity(row)+'</small></article>';
    }).join('');
  }
  function filterRow(c,index,key='',value='',position=0,draft=null){
    const item=c.model.overlays[index],row=layer(c,item?.selection),desc=c.model.descriptions.get(row?.sha256+':'+selectionKey(item?.selection))?.native;
    const type=draft?.type??(value===null?'null':typeof value);
    return '<div class="spatial-filter-row"><label><span class="sr-only">Field</span><select data-spatial-filter-field>'+option('','Field',key)+Object.keys(desc?.fields||{}).map(name=>option(name,name,key)).join('')+'</select></label>'+
      '<label><span class="sr-only">Value type</span><select data-spatial-filter-type>'+['string','number','boolean','null'].map(name=>option(name,name,type)).join('')+'</select></label>'+
      '<label><span class="sr-only">Value</span><input data-spatial-filter-value value="'+esc(draft?.text??(value===null?'':String(value)))+'"></label>'+button('filter-remove','Remove','class="small" aria-label="Remove field filter"')+'</div>';
  }

  function dirty(c){c.model.dirty=true;c.root.querySelector('[data-spatial-save-status]').textContent='Unsaved view changes.';}
  function updateTool(c){
    for(const node of c.root.querySelectorAll('[data-spatial-action^="tool-"]'))node.setAttribute('aria-pressed',String(node.dataset.spatialAction==='tool-'+c.model.tool));
    for(const node of c.root.querySelectorAll('[data-spatial-map]'))node.dataset.tool=c.model.tool;
  }
  function targetMatches(row,target){
    if(isReceivingWaterTarget(target))return receivingWaterTargetMatches(row,target);
    if(target.kind==='sources')return row.source_collection_id===target.id||row.owner_id===target.id&&row.group==='source';
    if(target.kind==='source-info')return row.source_collection_id===target.collection&&row.source_id===target.id;
    if(target.kind==='grids')return row.grid_id===target.id||row.owner_id===target.id&&row.group==='grid';
    if(target.kind==='runs')return row.run_id===target.id||row.owner_id===target.id&&row.group==='run';
    if(target.kind==='comparisons')return row.owner_id===target.id&&row.group==='comparison';
    if(target.kind==='deliveries')return row.owner_id===target.id&&row.group==='delivery';
    return row.id===target.id;
  }
  function applyAtlasTarget(c,target){
    const value=target.selection,paired=Boolean(target.comparison);
    if(target.project_id!==c.model.catalog.project?.id)throw Error('This atlas panel belongs to another scientific project.');
    if(!value||!validView(value.view)||!value.primary||
       (paired?(!['compare','swipe'].includes(value.mode)||!value.comparison):(value.mode!=='single'||value.comparison!==null))||
       !Array.isArray(value.overlays)||!Array.isArray(target.bindings)){
      throw Error('Open the complete retained atlas panel selection.');
    }
    if(value.scale?.mode!=='fixed'||!finite(value.scale.minimum)||!finite(value.scale.maximum)||
       value.scale.minimum>=value.scale.maximum)throw Error('The atlas panel needs its retained physical display scale.');
    if(value.overlays.length>(c.model.catalog.limits?.overlays??24))throw Error('The atlas panel exceeds the original spatial overlay capacity.');
    const choices=[value.reference,value.primary,...(paired?[value.comparison]:[]),...value.overlays.map(item=>item.selection)];
    for(const choice of choices){
      const row=layer(c,choice),binding=target.bindings.find(item=>selectionKey(item.selection)===selectionKey(choice));
      if(!row||!binding||row.sha256!==binding.sha256||row.bytes!==binding.bytes||row.kind!==binding.kind){
        throw Error('Restore the exact native atlas source before opening this panel.');
      }
    }
    if(layer(c,value.primary)?.kind!=='raster'||(paired&&layer(c,value.comparison)?.kind!=='raster')||value.overlays.some(item=>layer(c,item.selection)?.kind!=='vector')){
      throw Error('The atlas raster and original vector overlays must retain their native layer kinds.');
    }
    stopGroup(c,'drawControl');stopGroup(c,'pointControl');
    Object.assign(c.model,{reference:clone(value.reference),primary:clone(value.primary),
      comparison:clone(value.comparison),mode:value.mode,view:clone(value.view),scale:clone(value.scale),
      overlays:clone(value.overlays),markers:[],title:value.title,notes:value.notes,atlas_review:clone(value.atlas_review||null),
      previous_review_id:null,point:null,pendingSave:null,frame:null,swipe:50});
    c.model.exportOptions.review_id='';
    c.root.querySelector('[data-spatial-input="title"]').value=value.title;
    c.root.querySelector('[data-spatial-input="notes"]').value=value.notes;
    renderExports(c);dirty(c);
  }
  function applyTarget(c,target){
    if(target.kind==='atlas-panel')return applyAtlasTarget(c,target);
    const matches=c.model.catalog.layers.filter(row=>targetMatches(row,target));
    if(isReceivingWaterTarget(target)){Object.assign(c.model,receivingWaterView(matches,target,id=>selected(c,id)));dirty(c);return;}
    if(!matches.length)throw Error('This retained item has no spatial layers available yet. Complete its native operation or choose an original source.');
    const raster=matches.find(row=>row.kind==='raster'),vector=matches.find(row=>row.kind==='vector');
    c.model.reference=selected(c,(raster||vector).id);c.model.primary=raster?selected(c,raster.id):null;
    c.model.comparison=null;c.model.mode='single';c.model.view=null;c.model.markers=[];c.model.point=null;
    if(vector&&!c.model.overlays.some(item=>item.selection.layer_id===vector.id))c.model.overlays.push({selection:selected(c,vector.id),label:vector.title,visible:true,style:'solid',width:1.5,opacity:1});
    dirty(c);
  }
  async function catalog(c,{initial=false}={}){
    stopGroup(c,'catalogControl');const control=controller(c);c.catalogControl=control;
    try{
      const value=await request('/api/spatial/catalog?workspace='+encodeURIComponent(c.key),{signal:control.signal});
      assertCurrent(c);if(value.workspace_key!==c.key)throw Error('The spatial catalog belongs to another workspace.');
      c.model.catalog=value;
      if(!value.layers.length){c.root.querySelector('[data-spatial-canvases]').innerHTML='<div class="spatial-map-empty"><h2>Import original spatial sources</h2><p>Retained raster and vector editions, prepared model grids, native runs, comparisons and delivery assets appear here as they become available.</p></div>';sourceControls(c);renderReviews(c);status(c,'No retained spatial layers are available.');return;}
      if(pendingTarget?.workspace===c.key){const target=pendingTarget;pendingTarget=null;if(target.kind==='spatial_reviews')await loadReview(c,target.id);else applyTarget(c,target);}
      if(!c.model.reference){
        const first=value.layers.find(row=>row.kind==='raster')||value.layers[0];
        c.model.reference=selected(c,first.id);c.model.primary=first.kind==='raster'?selected(c,first.id):null;
        if(first.kind==='vector')c.model.overlays.push({selection:selected(c,first.id),label:first.title,visible:true,style:'solid',width:1.5,opacity:1});
      }
      const missing=[c.model.reference,c.model.primary,c.model.comparison,...c.model.overlays.map(item=>item.selection)].filter(Boolean).filter(item=>!layer(c,item));
      if(missing.length)throw Error('A selected source is absent from this workspace. Choose a current source or restore the complete original workspace.');
      sourceControls(c);renderMarkers(c);renderReviews(c);
      c.root.querySelector('[data-spatial-input="title"]').value=c.model.title;
      c.root.querySelector('[data-spatial-input="notes"]').value=c.model.notes;
      renderOverlays(c);
      if(initial||!c.model.frame)await draw(c);
      else status(c,'Retained source catalog refreshed.');
    }catch(error){fail(c,error);}
    finally{release(c,control);if(c.catalogControl===control)c.catalogControl=null;}
  }

  function imageHTML(value,classes=''){
    if(!value)return '';
    if(value.mime!=='image/png'||typeof value.png_base64!=='string'||!/^[A-Za-z0-9+/=\s]+$/.test(value.png_base64))throw Error('The native renderer did not return a valid PNG image.');
    return '<img class="spatial-raster '+classes+'" src="data:image/png;base64,'+value.png_base64+'" width="'+value.width+'" height="'+value.height+'" alt="'+esc(value.title)+'" draggable="false">';
  }
  function mapPane(c,name,title,base,top=null){
    const frame=c.model.frame,size=frame.size;
    return '<div class="spatial-pane"><header><strong>'+esc(title)+'</strong><span>'+esc(base?.units||'')+'</span></header>'+
      '<div class="spatial-map" data-spatial-map="'+name+'" data-tool="'+c.model.tool+'" tabindex="0" role="application" aria-label="'+esc(title)+' interactive spatial review. Arrow keys pan; plus and minus zoom; I inspects, P pans, M places markers, A selects an area.">'+
      imageHTML(base)+(top?'<div class="spatial-swipe-image">'+imageHTML(top)+'</div>':'')+
      '<svg class="spatial-vector-canvas" viewBox="0 0 '+size.width+' '+size.height+'" aria-hidden="true"><g data-spatial-vector-paths></g><g data-spatial-region-paths></g><g data-spatial-marker-paths></g><g data-spatial-point-paths></g></svg>'+
      '<span class="spatial-map-axis" aria-hidden="true" title="Increasing coordinate-system Y">Y+</span></div></div>';
  }
  function rangeText(image){
    if(!image)return '';
    const scale=image.scale||{};
    return fmt(scale.minimum)+' to '+fmt(scale.maximum)+(image.units?' '+image.units:'');
  }
  function legendHTML(name,image){
    if(image?.categorical){
      const classes=(image.categories||[]).map(row=>{
        const colour=/^#[0-9a-f]{6}$/i.test(row.colour||'')?row.colour:'#7f7f7f';
        return '<li><svg class="spatial-category-swatch" viewBox="0 0 18 18" aria-hidden="true"><rect x="1" y="1" width="16" height="16" fill="'+colour+'" stroke="#777"/></svg><span><b>'+esc(row.value)+'</b> '+esc(row.label||('Code '+row.value))+'</span></li>';
      }).join('');
      const source=image.category_source||{},sources=source.sources||[],conflicts=source.conflicts||[];
      const provenance=sources.length?'<details class="spatial-category-sources"><summary>Original class labels · '+sources.length+' retained table'+(sources.length===1?'':'s')+'</summary><ul>'+sources.map(row=>'<li>'+esc(row.source_id)+'<br><small>'+esc(row.uri||'')+'</small><br><code>'+esc(row.sha256||'')+'</code></li>').join('')+'</ul></details>':'';
      const warning=conflicts.length?'<p class="note">Original tables disagree for codes '+esc(conflicts.join(', '))+'. Their codes are shown without an assigned label.</p>':'';
      return '<section class="spatial-category-legend"><strong>'+esc(name)+' · '+esc(image.title||'Land cover')+'</strong><p class="note">'+esc(image.scale?.basis||'Discrete original class codes; grey shade has no magnitude')+'</p><ul class="spatial-category-list">'+classes+'</ul>'+warning+provenance+'</section>';
    }
    const constant=image?.scale?.minimum===image?.scale?.maximum;
    return '<span class="spatial-legend-item"><span class="spatial-ramp'+(constant?' spatial-ramp-constant':'')+'" aria-hidden="true"></span><strong>'+esc(name)+'</strong> '+esc(rangeText(image))+'<small>'+esc(image?.scale?.basis||'')+'</small></span>';
  }
  function renderFrame(c){
    const focusedMap=document.activeElement?.closest?.('[data-spatial-map]'),focusName=focusedMap&&c.root.contains(focusedMap)?focusedMap.dataset.spatialMap:null;
    const m=c.model,frame=m.frame,p=frame.images?.primary,a=frame.images?.comparison,d=frame.images?.difference;
    let html='';
    if(m.mode==='compare'&&p&&a)html=mapPane(c,'primary','Left source · '+p.title,p)+mapPane(c,'comparison','Right source · '+a.title,a);
    else if(m.mode==='swipe'&&p&&a)html=mapPane(c,'swipe','Swipe · right source revealed on left',p,a);
    else if(m.mode==='difference'&&d)html=mapPane(c,'difference','Right source minus left source',d);
    else html=mapPane(c,'primary',p?.title||layer(c,m.reference)?.title||'Original vector sources',p);
    const canvases=c.root.querySelector('[data-spatial-canvases]');
    canvases.classList.toggle('spatial-linked',m.mode==='compare'&&!!p&&!!a);canvases.innerHTML=html;
    // Apply native display geometry through the trusted client under the existing CSP.
    for(const map of canvases.querySelectorAll('[data-spatial-map]'))map.style.aspectRatio=frame.size.width+' / '+frame.size.height;
    for(const image of canvases.querySelectorAll('.spatial-swipe-image'))image.style.clipPath='inset(0 '+(100-m.swipe)+'% 0 0)';
    if(focusName)(canvases.querySelector('[data-spatial-map="'+focusName+'"]')||canvases.querySelector('[data-spatial-map]'))?.focus({preventScroll:true});
    c.root.querySelector('[data-spatial-swipe-control]').hidden=!(m.mode==='swipe'&&p&&a);
    c.root.querySelector('[data-spatial-input="swipe"]').value=m.swipe;
    const images=m.mode==='difference'&&d?[['Difference',d]]:m.mode!=='single'&&a?[['Left source',p],['Right source',a]]:p?[['Raster',p]]:[];
    c.root.querySelector('[data-spatial-legend]').innerHTML=images.map(([name,image])=>legendHTML(name,image)).join('')+'<span class="spatial-nodata-key">Transparent cells: no native value</span>';
    const bounds=m.view.bounds,ref=layer(c,m.reference);
    c.root.querySelector('[data-spatial-view-meta]').innerHTML='<span><strong>View CRS</strong> '+esc(m.view.crs)+'</span><span><strong>Bounds</strong> '+bounds.map(value=>esc(fmt(value))).join(', ')+'</span><details><summary>Original source identity</summary><p>'+esc(ref?.title||'')+' · '+identity(ref)+'</p>'+images.map(([name,image])=>'<p>'+esc(name)+': '+(image.source_sha256?'<span class="mono">'+esc(image.source_sha256)+'</span>':'<span class="mono">'+esc(JSON.stringify(image.source_sha256s||{}))+'</span>')+'</p>').join('')+'<p>Display cells use nearest sampling. Inspect reads original native cells and exact source attributes.</p></details>';
    const warnings=[...(frame.warnings||[])];
    if(m.mode==='difference'&&!d)warnings.unshift(frame.pair?.reason||'These rasters cannot be differenced on one native grid with matching physical units.');
    if(frame.pair?.reason&&!frame.pair?.comparable&&m.comparison)warnings.push(frame.pair.reason);
    const warning=c.root.querySelector('[data-spatial-warnings]');warning.hidden=!warnings.length;
    warning.innerHTML=warnings.map(value=>'<p>'+esc(typeof value==='string'?value:value.message||JSON.stringify(value))+'</p>').join('');
    drawAnnotations(c);
    updateTool(c);
  }
  function mapSize(c){
    const m=c.model,width=Math.max(240,c.root.querySelector('[data-spatial-canvases]').clientWidth||900),columns=m.mode==='compare'&&m.primary&&m.comparison?2:1;
    const w=Math.max(240,Math.min(1024,Math.round((width-(columns===2?12:0))/columns)));
    return {width:w,height:Math.max(300,Math.min(650,Math.round((window.innerHeight||950)-330)))};
  }
  function drawCurrent(c,control,version){assertCurrent(c);if(control.signal.aborted||c.drawVersion!==version)throw new DOMException('A newer view was selected.','AbortError');}
  function scheduleDraw(c,delay=90){
    stopGroup(c,'drawControl');stopGroup(c,'pointControl');clearTimeout(c.drawTimer);
    c.drawVersion++;c.busy=true;status(c,'Updating the selected map view…');
    c.drawTimer=setTimeout(()=>draw(c).catch(error=>fail(c,error)),delay);
  }
  async function draw(c){
    if(!alive(c)||!c.model.reference)return;
    stopGroup(c,'drawControl');stopGroup(c,'pointControl');clearTimeout(c.drawTimer);
    const control=controller(c),version=++c.drawVersion;c.drawControl=control;c.busy=true;clearError(c);status(c,'Reading native spatial sources…');
    const m=c.model;
    try{
      const descriptions=await Promise.all([m.reference,m.primary,m.comparison,...m.overlays.map(item=>item.selection)].filter(Boolean).map(async value=>({selection:value,value:await describe(c,value,control.signal)})));
      drawCurrent(c,control,version);
      for(const {selection,value}of descriptions){
        if(value.native?.kind==='vector'&&!selection.layer&&value.native.selected_layer){selection.layer=value.native.selected_layer;m.descriptions.set(layer(c,selection)?.sha256+':'+selectionKey(selection),value);}
      }
      if(!m.primary){m.comparison=null;m.mode='single';}
      if(!m.comparison&&m.mode!=='single')m.mode='single';
      if(m.scale.mode==='fixed'&&(!finite(m.scale.minimum)||!finite(m.scale.maximum)||m.scale.maximum<=m.scale.minimum))throw Error('Enter a finite fixed scale with maximum greater than minimum.');
      const payload={reference:clone(m.reference),primary:clone(m.primary),comparison:clone(m.comparison),mode:m.mode,size:mapSize(c),scale:clone(m.scale)};
      if(validView(m.view))payload.view=clone(m.view);
      const frame=await spatial(c,'frame',payload,control.signal);drawCurrent(c,control,version);
      if(!validView(frame.view)||!finite(frame.size?.width)||!finite(frame.size?.height)||frame.size.width<=0||frame.size.height<=0)throw Error('The native renderer returned an invalid spatial viewport.');
      const oldCRS=m.view?.crs;
      m.frame=frame;m.view=clone(frame.view);m.renderedKey=frameIdentity(m);if(oldCRS&&oldCRS!==m.view.crs){m.point=null;}
      sourceControls(c);renderOverlays(c);renderFrame(c);
      c.busy=false;status(c,'Map ready. Loading complete visible vector layers…');
      await Promise.all(m.overlays.map((item,index)=>item.visible?drawOverlay(c,item,index,control,version):Promise.resolve()));
      drawCurrent(c,control,version);status(c,'Map ready · '+m.overlays.filter(item=>item.visible).length+' visible vector layer'+(m.overlays.filter(item=>item.visible).length===1?'':'s')+'.');
      if(m.point?.crs===m.view.crs)inspect(c,clone(m.point)).catch(error=>fail(c,error));
    }catch(error){control.abort();if(c.drawVersion===version){c.busy=false;fail(c,error);}}
    finally{release(c,control);if(c.drawControl===control)c.drawControl=null;}
  }
  async function drawOverlay(c,item,index,control,version){
    const view=clone(c.model.view),size=c.model.frame.size;
    const tolerance=Math.max((view.bounds[2]-view.bounds[0])/size.width,(view.bounds[3]-view.bounds[1])/size.height)*0.5;
    let offset=0,total=0,pages=0;
    for(;;){
      drawCurrent(c,control,version);
      const value=await spatial(c,'overlay',{selection:clone(item.selection),view,offset,limit:500,tolerance},control.signal);
      drawCurrent(c,control,version);
      if(value.crs!==view.crs)throw Error('An overlay arrived in a different coordinate system from the selected view.');
      const path=(value.features||[]).map(feature=>geometryPath(feature.geometry,view,size)).join('');
      for(const group of c.root.querySelectorAll('[data-spatial-vector-paths]')){
        if(!path)continue;
        const container=document.createElementNS(SVG_NS,'g');container.dataset.overlay=String(index);
        for(const casing of [true,false]){
          const shape=document.createElementNS(SVG_NS,'path');
          shape.setAttribute('d',path);shape.setAttribute('fill','none');shape.setAttribute('stroke',casing?'#fff':'#222');
          shape.setAttribute('stroke-width',String(item.width+(casing?1.5:0)));shape.setAttribute('opacity',String(item.opacity));
          shape.setAttribute('vector-effect','non-scaling-stroke');shape.setAttribute('stroke-linecap','round');shape.setAttribute('stroke-linejoin','round');
          if(item.style==='dash')shape.setAttribute('stroke-dasharray','7 4');
          if(item.style==='dot')shape.setAttribute('stroke-dasharray','1 4');
          container.appendChild(shape);
        }
        group.appendChild(container);
      }
      total+=(value.features||[]).length;pages++;
      const progress=c.root.querySelector('[data-overlay-progress="'+index+'"]');
      if(progress)progress.textContent=total.toLocaleString()+' visible features'+(value.next_offset===null?' · complete':' · loading…');
      if(value.next_offset===null)break;
      if(!Number.isSafeInteger(value.next_offset)||value.next_offset<=offset)throw Error('The native vector page did not advance. Refresh the selected source to continue.');
      offset=value.next_offset;
    }
    return {features:total,pages};
  }
  function pointToPixel(c,point){
    const view=c.model.view,size=c.model.frame?.size;
    if(!validView(view)||!size||point.crs&&point.crs!==view.crs)return null;
    return {x:(point.x-view.bounds[0])/(view.bounds[2]-view.bounds[0])*size.width,y:(view.bounds[3]-point.y)/(view.bounds[3]-view.bounds[1])*size.height};
  }
  function eventPoint(c,event,map){
    const rect=map.getBoundingClientRect(),view=c.model.view;
    if(!validView(view)||!rect.width||!rect.height)return null;
    return {x:view.bounds[0]+(event.clientX-rect.left)/rect.width*(view.bounds[2]-view.bounds[0]),y:view.bounds[3]-(event.clientY-rect.top)/rect.height*(view.bounds[3]-view.bounds[1]),crs:view.crs};
  }
  function drawAnnotations(c){
    if(!c.model.frame)return;
    const size=c.model.frame.size,region=c.regionPreview||c.model.regions?.selection;
    for(const group of c.root.querySelectorAll('[data-spatial-region-paths]')){
      group.replaceChildren();
      const visible=region?.crs===c.model.view?.crs?region:region?.display_geometry_crs===c.model.view?.crs?{geometry:region.display_geometry}:null;
      if(!visible)continue;
      const b=visible.bounds,geometry=visible.geometry||(b?{type:'Polygon',coordinates:[[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]],[b[0],b[1]]]]}:null);
      if(!geometry)continue;
      const path=document.createElementNS(SVG_NS,'path');
      path.setAttribute('d',geometryPath(geometry,c.model.view,size));path.setAttribute('fill','rgba(0,0,0,.08)');path.setAttribute('fill-rule','evenodd');path.setAttribute('stroke','#111');path.setAttribute('stroke-width','2');path.setAttribute('stroke-dasharray','6 4');path.setAttribute('vector-effect','non-scaling-stroke');group.appendChild(path);
    }
    for(const group of c.root.querySelectorAll('[data-spatial-marker-paths]')){
      group.replaceChildren();
      c.model.markers.forEach((marker,index)=>{
        const p=pointToPixel(c,marker);if(!p)return;
        const circle=document.createElementNS(SVG_NS,'circle');circle.setAttribute('cx',p.x);circle.setAttribute('cy',p.y);circle.setAttribute('r','10');circle.setAttribute('fill','#fff');circle.setAttribute('stroke','#222');circle.setAttribute('stroke-width','1.5');group.appendChild(circle);
        const text=document.createElementNS(SVG_NS,'text');text.setAttribute('x',p.x);text.setAttribute('y',p.y+4);text.setAttribute('text-anchor','middle');text.setAttribute('font-size','11');text.setAttribute('font-weight','700');text.setAttribute('fill','#222');text.textContent=String(index+1);group.appendChild(text);
        const title=document.createElementNS(SVG_NS,'title');title.textContent=marker.label||'Marker '+(index+1);circle.appendChild(title);
      });
    }
    for(const group of c.root.querySelectorAll('[data-spatial-point-paths]')){
      group.replaceChildren();const point=c.model.point;if(!point)continue;const p=pointToPixel(c,point);if(!p)return;
      for(const casing of [true,false]){const path=document.createElementNS(SVG_NS,'path');path.setAttribute('d','M'+(p.x-12)+' '+p.y+'H'+(p.x+12)+'M'+p.x+' '+(p.y-12)+'V'+(p.y+12));path.setAttribute('stroke',casing?'#fff':'#111');path.setAttribute('stroke-width',casing?'4':'1.5');path.setAttribute('vector-effect','non-scaling-stroke');group.appendChild(path);}
    }
  }
  function pixelHTML(title,pixel){
    if(!pixel)return '<section><h3>'+esc(title)+'</h3><p class="note">No raster selected.</p></section>';
    const row=pixel.layer||{},values=[
      ...(pixel.category?[['Original land-cover class',pixel.category.label],['Original class code',String(pixel.category.value)]]:[]),
      [pixel.category?'Stored class value':'Physical value',pixel.valid?(pixel.value_text??String(pixel.value))+(pixel.units?' '+pixel.units:''):pixel.reason||'No native value at this point'],
      ['Original stored value',pixel.valid?(pixel.raw_value_text??String(pixel.raw_value)):'—'],
      ['Native row / column',pixel.row!==undefined&&pixel.row!==null?String(pixel.row)+' / '+String(pixel.column):'—'],
      ['Native coordinate',pixel.coordinate?fmt(pixel.coordinate.x)+', '+fmt(pixel.coordinate.y):'—'],
      ['Native CRS',pixel.coordinate?.crs||'—'],
      ['Cell bounds',pixel.cell_bounds?.map(fmt).join(', ')||'—']
    ];
    return '<section><h3>'+esc(title)+' · '+esc(row.title||pixel.selection?.layer_id)+'</h3><dl>'+values.map(([key,value])=>'<dt>'+esc(key)+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl><small class="mono">SHA256 '+esc(pixel.source_sha256||row.sha256||'')+'</small></section>';
  }
  function exactProperties(feature){
    if(feature.properties_text&&typeof feature.properties_text==='object')return Object.entries(feature.properties_text).map(([key,value])=>'<dt>'+esc(key)+'</dt><dd>'+esc(value)+'</dd>').join('');
    if(typeof feature.properties_json==='string')return '<dd class="spatial-exact-json">'+esc(feature.properties_json)+'</dd>';
    return Object.entries(feature.properties||{}).map(([key,value])=>'<dt>'+esc(key)+'</dt><dd>'+esc(typeof value==='object'?JSON.stringify(value):String(value??'null'))+'</dd>').join('');
  }
  function featureHTML(feature,groupIndex,featureIndex){
    const operations=Array.isArray(feature.geometry_operations)?feature.geometry_operations:[];
    const sourcePosition=Number.isSafeInteger(feature.source_feature_index)?'<p class="note">Original source feature position '+esc(feature.source_feature_index)+'.</p>':'';
    const corrections=operations.length?'<details><summary>Geometry preparation · '+operations.length+' recorded operation'+(operations.length===1?'':'s')+'</summary><pre class="spatial-exact-json">'+esc(JSON.stringify(operations,null,2))+'</pre></details>':'';
    const originalGeometry=typeof feature.source_geometry_json==='string'?'<details><summary>Original source geometry</summary><pre class="spatial-exact-json">'+esc(feature.source_geometry_json)+'</pre></details>':'';
    return '<details><summary>Feature '+esc(feature.id??'')+'</summary>'+sourcePosition+'<dl>'+exactProperties(feature)+'</dl>'+regionFeatureButton(groupIndex,featureIndex,feature)+corrections+originalGeometry+'</details>';
  }
  async function inspect(c,point){
    if(!alive(c)||c.busy||!c.model.frame)return;
    stopGroup(c,'pointControl');const control=controller(c);c.pointControl=control;
    c.model.point=clone(point);drawAnnotations(c);
    const target=c.root.querySelector('[data-spatial-inspection]');target.innerHTML='<p class="note">Reading original cells and nearby original vector features…</p>';
    try{
      const size=c.model.frame.size,view=c.model.view,rect=c.root.querySelector('[data-spatial-map]')?.getBoundingClientRect();
      const tolerance=Math.max((view.bounds[2]-view.bounds[0])/(rect?.width||size.width),(view.bounds[3]-view.bounds[1])/(rect?.height||size.height))*6;
      const value=await spatial(c,'point',{primary:clone(c.model.primary),comparison:clone(c.model.comparison),point,overlays:c.model.overlays.filter(item=>item.visible).map(item=>clone(item.selection)),tolerance},control.signal);
      if(control.signal.aborted||c.pointControl!==control)return;
      c.regions?.setFeatures(value.features);
      const difference=value.difference;
      target.innerHTML='<p class="spatial-inspection-location"><strong>Selected point</strong> '+esc(fmt(point.x))+', '+esc(fmt(point.y))+' · '+esc(point.crs)+'</p>'+
        '<div class="spatial-pixel-columns">'+pixelHTML('Left source',value.primary)+(c.model.comparison?pixelHTML('Right source',value.comparison):'')+'</div>'+
        (difference?'<p class="spatial-difference-value"><strong>Right source minus left source</strong> '+esc(difference.value_text??String(difference.value))+' '+esc(difference.units||'')+'</p>':'')+
        '<div class="spatial-feature-inspection">'+(value.features||[]).map((group,groupIndex)=>'<section><h3>'+esc(group.layer?.title||group.selection?.layer_id)+'</h3>'+(group.features?.length?group.features.map((feature,featureIndex)=>featureHTML(feature,groupIndex,featureIndex)).join(''):'<p class="note">No original features within the selected point tolerance.</p>')+(group.truncated?'<p class="note">Additional nearby features exceed this point response. Zoom in or apply an attribute filter to inspect a smaller selection.</p>':'')+'</section>').join('')+'</div>';
    }catch(error){if(!quiet(error)&&alive(c)){target.innerHTML='<p class="error-text">'+esc(error.message)+'</p>';}}
    finally{release(c,control);if(c.pointControl===control)c.pointControl=null;}
  }
  function zoom(c,factor,anchor=null){
    const m=c.model;if(!validView(m.view))return;
    const [left,bottom,right,top]=m.view.bounds,x=anchor?.x??(left+right)/2,y=anchor?.y??(bottom+top)/2;
    const bounds=[x+(left-x)*factor,y+(bottom-y)*factor,x+(right-x)*factor,y+(top-y)*factor];
    if(!bounds.every(finite)||bounds[2]<=bounds[0]||bounds[3]<=bounds[1])return;
    m.view={crs:m.view.crs,bounds};dirty(c);scheduleDraw(c);
  }
  function pan(c,dx,dy){
    const m=c.model;if(!validView(m.view))return;const [left,bottom,right,top]=m.view.bounds,w=right-left,h=top-bottom;
    m.view={crs:m.view.crs,bounds:[left+dx*w,bottom+dy*h,right+dx*w,top+dy*h]};dirty(c);scheduleDraw(c);
  }
  async function fit(c,clearMarkers=false){
    const control=controller(c);
    try{
      const value=await describe(c,c.model.reference,control.signal),crs=value.native?.crs;
      if(c.model.markers.length&&c.model.view?.crs&&crs!==c.model.view.crs&&!clearMarkers){c.root.querySelector('[data-spatial-fit-confirm]').hidden=false;return;}
      if(clearMarkers){c.model.markers=[];renderMarkers(c);}
      c.model.view=null;c.model.point=null;c.root.querySelector('[data-spatial-fit-confirm]').hidden=true;dirty(c);scheduleDraw(c,0);
    }finally{release(c,control);}
  }

  function frameIdentity(m){return JSON.stringify({reference:m.reference,primary:m.primary,comparison:m.comparison,mode:m.mode,view:m.view,scale:m.scale});}
  function reviewPayload(m){
    return {title:m.title.trim(),reference:clone(m.reference),primary:clone(m.primary),comparison:clone(m.comparison),mode:m.mode,swipe:m.swipe,view:clone(m.view),scale:clone(m.scale),overlays:m.overlays.map(item=>({selection:clone(item.selection),label:item.label||'',visible:item.visible,style:item.style,width:item.width,opacity:item.opacity})),markers:clone(m.markers),notes:m.notes,...(m.atlas_review?{atlas_review:clone(m.atlas_review)}:{}),...(m.previous_review_id?{previous_review_id:m.previous_review_id}:{})};
  }
  async function save(c){
    if(c.saving)return;
    const m=c.model;reconcileAtlasReview(m);const payload=reviewPayload(m);
    if(!payload.title)throw Error('Give the review a title before saving.');
    const filterKey=value=>JSON.stringify(Object.entries(value||{}).sort(([a],[b])=>a.localeCompare(b)));
    for(const article of c.root.querySelectorAll('[data-overlay]')){
      const overlay=m.overlays[Number(article.dataset.overlay)];
      if(filterKey(readFilters(article))!==filterKey(overlay.selection.where))throw Error('Apply or discard the edited attribute filters before saving this review.');
    }
    if(!validView(payload.view)||!m.frame||c.busy||frameIdentity(m)!==m.renderedKey)throw Error('Wait for the selected map view to finish rendering before saving.');
    if(m.mode==='difference'&&!m.frame.images?.difference)throw Error(m.frame.pair?.reason||'Select comparable original rasters before saving a difference view.');
    const key=JSON.stringify(payload);
    if(!m.pendingSave||m.pendingSave.key!==key)m.pendingSave={key,operation_id:crypto.randomUUID(),payload:clone(payload)};
    const operation=m.pendingSave;c.saving=true;
    const saveButton=c.root.querySelector('[data-spatial-action="save"]');saveButton.disabled=true;
    c.root.querySelector('[data-spatial-save-status]').textContent='Retaining this review in the existing workspace…';
    try{
      const row=await request('/api/actions',{method:'POST',body:{workspace:c.key,action:'spatial.review.save',payload:operation.payload,operation_id:operation.operation_id}});
      if(!row.id)throw Error('The workspace did not return the retained operation identity. Retry this same review.');
      if(m.pendingSave===operation)m.pendingSave=null;
      if(JSON.stringify(reviewPayload(m))===key)m.dirty=false;
      m.lastSaveTask=row.id;
      if(!alive(c))return;
      c.root.querySelector('[data-spatial-save-status]').textContent=m.dirty?'Previous view retained. Your latest edits remain unsaved.':'Save operation retained. Its original view will appear below when complete.';
      await refreshState({force:true});
      if(!alive(c))return;
      await catalog(c);if(alive(c))await showTask(row.id);
    }catch(error){
      if(alive(c))c.root.querySelector('[data-spatial-save-status]').textContent='The selected review remains here. Retry Save review to resume this same request.';
      throw error;
    }finally{c.saving=false;if(alive(c))saveButton.disabled=false;}
  }
  async function loadReview(c,id){
    stopGroup(c,'reviewControl');const control=controller(c);c.reviewControl=control;
    try{
      const value=await request('/api/item?'+new URLSearchParams({workspace:c.key,kind:'spatial_reviews',id}),{signal:control.signal});
      assertCurrent(c);if(control.signal.aborted||c.reviewControl!==control)throw new DOMException('A newer review was selected.','AbortError');
      if(value.schema!=='upstate.spatial-reviews/v1'||value.id!==id||!validView(value.view)||(value.swipe!==undefined&&(!finite(value.swipe)||value.swipe<0||value.swipe>100)))throw Error('This retained item is not a valid native spatial review.');
      if(value.project_id!==c.model.catalog.project?.id)throw Error('The saved review belongs to a different scientific project.');
      if(value.atlas_review){
        const linked=await request('/api/map-atlas/review',{method:'POST',body:{workspace:c.key,delivery_id:value.atlas_review.origin.delivery_id,review_id:id},signal:control.signal});
        assertCurrent(c);if(control.signal.aborted||c.reviewControl!==control)throw new DOMException('A newer review was selected.','AbortError');
        if(linked.workspace_key!==c.key||linked.target?.review_id!==id)throw Error('The saved atlas review changed its original release.');
      }
      for(const item of [value.reference,value.primary,value.comparison,...(value.overlays||[]).map(row=>row.selection)].filter(Boolean)){
        if(!layer(c,item))throw Error('Restore this review’s complete source workspace before opening it. A referenced original layer is absent.');
      }
      stopGroup(c,'drawControl');stopGroup(c,'pointControl');
      Object.assign(c.model,{reference:clone(value.reference),primary:clone(value.primary),comparison:clone(value.comparison),mode:value.mode,swipe:value.swipe??50,view:clone(value.view),scale:clone(value.scale),overlays:clone(value.overlays),markers:clone(value.markers),title:value.title,notes:value.notes,atlas_review:clone(value.atlas_review||null),previous_review_id:id,point:null,pendingSave:null,dirty:false});
      c.model.exportOptions.review_id=id;renderExports(c);
      c.root.querySelector('[data-spatial-input="title"]').value=value.title;
      c.root.querySelector('[data-spatial-input="notes"]').value=value.notes;
      c.root.querySelector('[data-spatial-save-status]').textContent='Opened retained review. Saving changes creates a revision linked to this original.';
      sourceControls(c);renderMarkers(c);renderOverlays(c);await draw(c);
    }finally{release(c,control);if(c.reviewControl===control)c.reviewControl=null;}
  }
  async function addOverlay(c){
    const id=c.root.querySelector('[data-spatial-input="add-overlay"]').value;
    if(!id)throw Error('Choose an original vector source to add.');
    const limit=c.model.catalog?.limits?.overlays;
    if(Number.isSafeInteger(limit)&&c.model.overlays.length>=limit)throw Error('This native review supports '+limit+' vector overlays. Save a separate view for additional layers.');
    const control=controller(c),selection=selected(c,id),row=layer(c,id);
    try{
      const value=await describe(c,selection,control.signal);
      if(value.native?.selected_layer)selection.layer=value.native.selected_layer;
      if(c.model.overlays.some(item=>selectionKey(item.selection)===selectionKey(selection)))throw Error('That native vector layer is already in this view. Edit its existing filter or select a different native layer.');
      c.model.overlays.push({selection,label:row.title,visible:true,style:['solid','dash','dot'][c.model.overlays.length%3],width:1.5,opacity:1});
      if(!c.model.reference)c.model.reference=clone(selection);
      dirty(c);renderOverlays(c);scheduleDraw(c,0);
    }finally{release(c,control);}
  }
  function readFilters(article){
    const where=Object.create(null);
    for(const row of article.querySelectorAll('.spatial-filter-row')){
      const field=row.querySelector('[data-spatial-filter-field]').value,type=row.querySelector('[data-spatial-filter-type]').value,text=row.querySelector('[data-spatial-filter-value]').value;
      if(!field)throw Error('Choose a native field for each filter or remove the empty row.');
      if(Object.hasOwn(where,field))throw Error('Each original field can have only one equality filter.');
      let value=text;
      if(type==='number'){
        const numeric=text.trim();
        if(!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(numeric)||!Number.isFinite(Number(numeric)))throw Error('Numeric filters require a finite original JSON number.');
        value=Number(numeric);
        if(value===0&&/[1-9]/.test(numeric.split(/[eE]/)[0]))throw Error('This numeric value is smaller than the browser can represent exactly. Select another exact field.');
        if(Number.isInteger(value)&&!Number.isSafeInteger(value))throw Error('This integer exceeds the browser’s exact numeric range. Select the identifier as a native string field or use another exact field.');
      }else if(type==='boolean'){
        if(!['true','false'].includes(text.trim().toLowerCase()))throw Error('Boolean filters require true or false.');
        value=text.trim().toLowerCase()==='true';
      }else if(type==='null')value=null;
      where[field]=value;
    }
    return Object.keys(where).length?where:null;
  }
  function addMarker(c,point){
    const limit=c.model.catalog?.limits?.markers;
    if(Number.isSafeInteger(limit)&&c.model.markers.length>=limit){fail(c,Error('This native review supports '+limit+' markers. Remove a marker or save a separate review.'));return;}
    c.model.markers.push({x:point.x,y:point.y,label:'Marker '+(c.model.markers.length+1)});
    dirty(c);renderMarkers(c);drawAnnotations(c);
    const input=c.root.querySelector('[data-spatial-input="marker-label"][data-index="'+(c.model.markers.length-1)+'"]');input?.focus();input?.select();
  }
  async function action(c,node){
    clearError(c);const name=node.dataset.spatialAction,index=Number(node.dataset.index),m=c.model;
    if(name.startsWith('tool-')){m.tool=name.slice(5);updateTool(c);return;}
    if(name==='refresh-catalog'){await catalog(c);return draw(c);}
    if(name==='zoom-in')return zoom(c,0.65);
    if(name==='zoom-out')return zoom(c,1/0.65);
    if(name==='fit')return fit(c);
    if(name==='fit-clear-markers')return fit(c,true);
    if(name==='fit-cancel'){c.root.querySelector('[data-spatial-fit-confirm]').hidden=true;scheduleDraw(c,0);return;}
    if(name==='overlay-add')return addOverlay(c);
    if(name==='overlay-fit'){m.reference=clone(m.overlays[index].selection);dirty(c);sourceControls(c);return fit(c);}
    if(name==='overlay-remove'){m.overlays.splice(index,1);dirty(c);renderOverlays(c);scheduleDraw(c,0);return;}
    if(name==='filter-add'){node.closest('[data-overlay]').querySelector('[data-spatial-filter-rows]').insertAdjacentHTML('beforeend',filterRow(c,index));return;}
    if(name==='filter-remove'){node.closest('.spatial-filter-row').remove();return;}
    if(name==='filter-revert'){m.overlays[index]._resetFilterDraft=true;renderOverlays(c);return;}
    if(name==='filter-apply'){
      const where=readFilters(node.closest('[data-overlay]'));const overlay=m.overlays[index];
      if(where)overlay.selection.where=where;else delete overlay.selection.where;
      overlay._resetFilterDraft=true;dirty(c);scheduleDraw(c,0);return;
    }
    if(name==='marker-remove'){m.markers.splice(index,1);dirty(c);renderMarkers(c);drawAnnotations(c);return;}
    if(name==='clear-point'){stopGroup(c,'pointControl');m.point=null;drawAnnotations(c);c.root.querySelector('[data-spatial-inspection]').innerHTML='<p class="note">Click the map to inspect original native values.</p>';return;}
    if(name==='save')return save(c);
    if(name==='review-open')return loadReview(c,node.dataset.id);
    if(name==='export-create')return exportReview(c);
    if(name==='export-open')return openItem('spatial_exports',node.dataset.id);
  }
  async function change(c,node){
    clearError(c);const name=node.dataset.spatialInput,m=c.model,index=Number(node.dataset.index);
    if(editAtlasReview(m,node)){dirty(c);return;}
    if(name==='export-review'||name==='export-paper'||name==='export-dpi'){
      if(m.exportInFlight)return;
      m.exportOptions[name==='export-review'?'review_id':name.slice('export-'.length)]=name==='export-dpi'?Number(node.value):node.value;renderExports(c);return;
    }
    if(name==='reference'||name==='primary'||name==='comparison'){
      m[name]=selected(c,node.value);
      if(name==='comparison'&&m.comparison&&m.primary&&m.mode==='single')m.mode='compare';
      if(!m.primary||!m.comparison)m.mode='single';
      if(!m.reference)m.reference=clone(m.primary||m.comparison);
      dirty(c);sourceControls(c);scheduleDraw(c,0);return;
    }
    if(name==='reference-layer'){m.reference.layer=node.value;delete m.reference.where;dirty(c);scheduleDraw(c,0);return;}
    if(name==='primary-band'||name==='comparison-band'){m[name.split('-')[0]].band=Number(node.value);dirty(c);scheduleDraw(c,0);return;}
    if(name==='mode'){m.mode=node.value;dirty(c);scheduleDraw(c,0);return;}
    if(name==='scale-mode'){
      if(node.value==='auto')m.scale={mode:'auto'};
      else{
        const range=m.frame?.images?.primary?.scale||m.frame?.images?.difference?.scale||{};
        const minimum=finite(range.minimum)?range.minimum:0,maximum=finite(range.maximum)&&range.maximum>minimum?range.maximum:minimum+Math.max(1,Math.abs(minimum)*0.01);
        m.scale={mode:'fixed',minimum,maximum};
      }
      dirty(c);sourceControls(c);scheduleDraw(c,0);return;
    }
    if(name==='scale-min'||name==='scale-max'){m.scale[name==='scale-min'?'minimum':'maximum']=node.value.trim()?Number(node.value):null;dirty(c);scheduleDraw(c);return;}
    if(name==='overlay-visible'){m.overlays[index].visible=node.checked;dirty(c);scheduleDraw(c,0);return;}
    if(name==='overlay-layer'){
      const item=m.overlays[index];item.selection.layer=node.value;delete item.selection.where;item._resetFilterDraft=true;
      dirty(c);scheduleDraw(c,0);return;
    }
    if(name==='overlay-style'||name==='overlay-width'||name==='overlay-opacity'){
      const item=m.overlays[index],property=name.slice('overlay-'.length),value=property==='style'?node.value:Number(node.value);
      if(property==='width'&&(!finite(value)||value<0.25||value>8))throw Error('Line width must be between 0.25 and 8.');
      if(property==='opacity'&&(!finite(value)||value<0||value>1))throw Error('Opacity must be between zero and one.');
      item[property]=value;dirty(c);scheduleDraw(c);return;
    }
  }
  function edit(c,node){
    const name=node.dataset.spatialInput,m=c.model;
    if(editAtlasReview(m,node)){dirty(c);return;}
    if(name==='title'||name==='notes'){m[name]=node.value;dirty(c);}
    if(name==='marker-label'){m.markers[Number(node.dataset.index)].label=node.value;dirty(c);drawAnnotations(c);}
    if(name==='swipe'){
      m.swipe=Number(node.value);dirty(c);
      for(const image of c.root.querySelectorAll('.spatial-swipe-image'))image.style.clipPath='inset(0 '+(100-m.swipe)+'% 0 0)';
    }
  }
  function resetDrag(c){
    for(const map of c.root.querySelectorAll('[data-spatial-map]'))for(const child of map.children)if(child.matches('img,svg,.spatial-swipe-image'))child.style.transform='';
    c.drag=null;c.regionPreview=null;drawAnnotations(c);
  }
  function bind(c){
    const options={signal:c.events.signal};
    c.root.addEventListener('click',event=>{
      const node=event.target.closest('[data-spatial-action]');if(!node||!c.root.contains(node))return;
      event.preventDefault();action(c,node).catch(error=>fail(c,error));
    },options);
    c.root.addEventListener('change',event=>{
      const node=event.target.closest('[data-spatial-input]');if(node)change(c,node).catch(error=>fail(c,error));
    },options);
    c.root.addEventListener('input',event=>{const node=event.target.closest('[data-spatial-input]');if(node)edit(c,node);},options);
    c.root.addEventListener('pointerdown',event=>{
      const map=event.target.closest('[data-spatial-map]');if(!map||event.button!==0||c.busy||!validView(c.model.view))return;
      event.preventDefault();map.focus();map.setPointerCapture(event.pointerId);
      c.drag={pointerId:event.pointerId,map,x:event.clientX,y:event.clientY,start:eventPoint(c,event,map),tool:c.model.tool,view:clone(c.model.view),moved:false};
    },options);
    c.root.addEventListener('pointermove',event=>{
      const map=event.target.closest('[data-spatial-map]');if(!map)return;
      const point=eventPoint(c,event,map);if(point)c.root.querySelector('[data-spatial-coordinate]').textContent=fmt(point.x)+', '+fmt(point.y);
      const drag=c.drag;if(!drag||drag.pointerId!==event.pointerId)return;
      const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if(Math.hypot(dx,dy)>4&&!drag.moved){drag.moved=true;if(drag.tool!=='region')stopGroup(c,'drawControl');stopGroup(c,'pointControl');}
      if(drag.moved&&drag.tool==='region'){
        if(point?.crs===drag.start?.crs){c.regionPreview={crs:point.crs,bounds:[Math.min(drag.start.x,point.x),Math.min(drag.start.y,point.y),Math.max(drag.start.x,point.x),Math.max(drag.start.y,point.y)]};drawAnnotations(c);}
        return;
      }
      if(drag.moved){for(const pane of c.root.querySelectorAll('[data-spatial-map]'))for(const child of pane.children)if(child.matches('img,svg,.spatial-swipe-image'))child.style.transform='translate('+dx+'px,'+dy+'px)';}
    },options);
    c.root.addEventListener('pointerup',event=>{
      const drag=c.drag;if(!drag||drag.pointerId!==event.pointerId)return;
      if(drag.map.hasPointerCapture(event.pointerId))drag.map.releasePointerCapture(event.pointerId);
      const point=eventPoint(c,event,drag.map),rect=drag.map.getBoundingClientRect();
      if(drag.tool==='region'){
        try{if(drag.moved&&point&&drag.start)c.regions.selectBounds(drag.start,point);}catch(error){fail(c,error);}
        resetDrag(c);return;
      }
      if(drag.moved){
        const [left,bottom,right,top]=drag.view.bounds,dx=-(event.clientX-drag.x)/rect.width*(right-left),dy=(event.clientY-drag.y)/rect.height*(top-bottom);
        c.model.view={crs:drag.view.crs,bounds:[left+dx,bottom+dy,right+dx,top+dy]};resetDrag(c);dirty(c);scheduleDraw(c,0);
      }else{
        resetDrag(c);if(!point)return;
        if(c.model.tool==='mark')addMarker(c,point);
        else if(c.model.tool==='inspect')inspect(c,point).catch(error=>fail(c,error));
      }
    },options);
    c.root.addEventListener('pointercancel',()=>resetDrag(c),options);
    c.root.addEventListener('wheel',event=>{
      const map=event.target.closest('[data-spatial-map]');if(!map||!c.model.frame)return;
      event.preventDefault();if(c.drag?.tool==='region')return;zoom(c,Math.exp(Math.max(-1,Math.min(1,event.deltaY*0.0015))),eventPoint(c,event,map));
    },{...options,passive:false});
    c.root.addEventListener('dblclick',event=>{const map=event.target.closest('[data-spatial-map]');if(map){event.preventDefault();zoom(c,0.5,eventPoint(c,event,map));}},options);
    c.root.addEventListener('keydown',event=>{
      const map=event.target.closest('[data-spatial-map]');if(!map)return;
      const key=event.key.toLowerCase(),m=c.model;
      if(!['arrowleft','arrowright','arrowup','arrowdown','+','=','-','0','i','p','m','a','enter','escape'].includes(key))return;
      event.preventDefault();
      if(key==='arrowleft')pan(c,-0.15,0);
      if(key==='arrowright')pan(c,0.15,0);
      if(key==='arrowup')pan(c,0,0.15);
      if(key==='arrowdown')pan(c,0,-0.15);
      if(key==='+'||key==='=')zoom(c,0.65);
      if(key==='-')zoom(c,1/0.65);
      if(key==='0')fit(c).catch(error=>fail(c,error));
      if(['i','p','m','a'].includes(key)){m.tool={i:'inspect',p:'pan',m:'mark',a:'region'}[key];updateTool(c);}
      if(key==='escape')resetDrag(c);
      if(key==='enter'&&validView(m.view)){
        const point={x:(m.view.bounds[0]+m.view.bounds[2])/2,y:(m.view.bounds[1]+m.view.bounds[3])/2,crs:m.view.crs};
        if(m.tool==='mark')addMarker(c,point);else inspect(c,point).catch(error=>fail(c,error));
      }
    },options);
    if(typeof ResizeObserver==='function'){
      c.resizeObserver=new ResizeObserver(()=>{
        if(!alive(c)||!c.model.frame||c.busy)return;
        const size=mapSize(c),last=c.model.frame.size;if(size.width!==last.width||size.height!==last.height)scheduleDraw(c,150);
      });c.resizeObserver.observe(c.root.querySelector('[data-spatial-canvases]'));
    }
  }
  function signature(state){
    return JSON.stringify([['sources','grids','runs','comparisons','deliveries','spatial_reviews'].map(kind=>(state.data?.[kind]||[]).map(row=>[row.id,row.state])),receivingWaterStateSignature(state)]);
  }
  function suspend(){
    if(!current)return;const c=current;c.disposed=true;
    clearTimeout(c.drawTimer);for(const control of c.controllers)control.abort();c.controllers.clear();
    c.regions?.dispose();c.events.abort();c.resizeObserver?.disconnect();current=null;
  }
  function mount(root,state){
    if(!state?.workspace_key||getWorkspace()!==state.workspace_key)return;
    if(current?.root===root&&current.key===state.workspace_key&&root.querySelector('.spatial-workbench')){
      current.regions?.setState(state);
      current.model.exportItems=state.data?.spatial_exports||[];current.model.exportTasks=state.tasks||[];renderExports(current);
      const next=signature(state);
      if(next!==current.stateSignature){const c=current;c.stateSignature=next;catalog(c).catch(error=>fail(c,error));}
      return;
    }
    suspend();
    let model=models.get(state.workspace_key);if(!model){model=newModel(state.workspace_key);models.set(state.workspace_key,model);}
    model.exportItems=state.data?.spatial_exports||[];model.exportTasks=state.tasks||[];
    const c={key:state.workspace_key,root,model,controllers:new Set(),events:new AbortController(),drawVersion:0,drawTimer:null,disposed:false,busy:false,stateSignature:signature(state)};
    current=c;root.innerHTML=shell();
    model.regions||={};
    c.regions=createRegionAnalysis({root,model:model.regions,workspace:c.key,request,alive:()=>alive(c),refreshState,showTask,
      getSources:()=>({layers:model.catalog?.layers||[],overlays:model.overlays}),
      getSelection:()=>{
        if(c.busy||!validView(model.view)||!model.frame||frameIdentity(model)!==model.renderedKey)throw Error('Wait for the selected native map view to finish rendering.');
        return {primary:clone(model.primary),comparison:clone(model.comparison),view:clone(model.view)};
      },
      selectionChanged:()=>drawAnnotations(c),
      reopen:async value=>{
        const request=value.request;
        for(const choice of [request.primary,request.comparison].filter(Boolean))if(!layer(c,choice))throw Error('Restore this analysis’s original raster layers before reopening its area.');
        const region=request.region,points=[];
        const visit=value=>{if(Array.isArray(value)&&typeof value[0]==='number')points.push(value);else if(Array.isArray(value))value.forEach(visit);};
        visit(region.geometry?.coordinates);
        if(!points.length)throw Error('The saved region has no geographic extent.');
        let bounds=[Infinity,Infinity,-Infinity,-Infinity];
        for(const point of points){bounds[0]=Math.min(bounds[0],point[0]);bounds[1]=Math.min(bounds[1],point[1]);bounds[2]=Math.max(bounds[2],point[0]);bounds[3]=Math.max(bounds[3],point[1]);}
        if(model.view?.crs!==region.crs)model.markers=[];
        Object.assign(model,{reference:clone(request.primary),primary:clone(request.primary),comparison:clone(request.comparison),mode:request.comparison?'compare':'single',view:{crs:region.crs,bounds},scale:{mode:'auto'},point:null});
        dirty(c);sourceControls(c);renderMarkers(c);await draw(c);
      }});
    c.regions.setState(state);bind(c);renderExports(c);
    catalog(c,{initial:true}).catch(error=>fail(c,error));
  }
  async function openTarget(target){
    if(!target)return;
    pendingTarget={...clone(target),workspace:target.workspace||getWorkspace()};
    if(current&&alive(current)&&current.key===pendingTarget.workspace&&current.model.catalog){const target=pendingTarget;pendingTarget=null;if(target.kind==='spatial_reviews')return loadReview(current,target.id);applyTarget(current,target);sourceControls(current);renderMarkers(current);renderOverlays(current);await draw(current);}
  }
  return {mount,suspend,openTarget};
}
