/** Reopen original scientific deliveries, their source identities and exact files. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=value=>String(value||'').slice(0,12);
const list=value=>Array.isArray(value)?value:[];
const human=value=>String(value||'').replaceAll('_',' ').replaceAll('.',' / ');
const formatBytes=value=>{let n=Number(value)||0,i=0;const units=['B','KiB','MiB','GiB','TiB'];while(n>=1024&&i<units.length-1){n/=1024;i++;}return n.toLocaleString(undefined,{maximumFractionDigits:i?1:0})+' '+units[i];};
const safeURL=value=>typeof value==='string'&&/^\/api\/file\/[^?#\s]+$/.test(value)?value:null;
const button=(action,label,attrs='')=>'<button type="button" data-action="delivery-inspection-'+action+'" '+attrs+'>'+esc(label)+'</button>';
const groups=[['reports','Scientific reports'],['analysis','Saved scenario analysis'],['economics','Economic edition'],['receiving','Receiving-water results'],['maps','Maps and atlas'],['gis','GIS datasets and metadata'],['archives','Complete archives'],['sources','Sources and methods'],['other','Other original files']];
const previewable=path=>/\.(?:html?|pdf)$/i.test(path);
const canPreview=row=>Boolean(row&&previewable(row.path)&&(!row.fallback||/\.pdf$/i.test(row.path)));
const groupFor=row=>{
 const keys=row.keys.join(' ');
 if(/files\.report(?:$|[_ ])/.test(keys))return 'reports';
 if(/scenario_analysis_/.test(keys))return 'analysis';
 if(/economic_/.test(keys))return 'economics';
 if(/receiving_water_/.test(keys))return 'receiving';
 if(/maps\.|map_atlas|files\.map_/.test(keys))return 'maps';
 if(/\.(?:zip|tar|gz)$/i.test(row.path)||/working_archive|delivery_archive/.test(keys))return 'archives';
 if(/\.(?:tiff?|gpkg|shp|xml|vrt)$/i.test(row.path))return 'gis';
 if(/source|metadata|display_scales|original_record|manifest|package_index/.test(keys))return 'sources';
 return 'other';
};
export function deliveryFileRows(files){
 return list(files).map((row,index)=>{
  const keys=list(row.keys).map(String),path=String(row.path||row.filename||'');
  const result={...row,path,key:row.key||path,keys,title:row.title||row.label||row.filename||path,url:safeURL(row.url),preview_url:safeURL(row.preview_url),index};
  result.group=groupFor(result);
  result.isGIS=/\.(?:tiff?|gpkg|shp|xml|vrt|msk|ovr|tfw|tiff?w|wld|tab|rpb)$/i.test(path)||keys.some(key=>/^files\.gis_(?:dataset|metadata|companion)_/.test(key));
  result.search=[path,result.title,result.sha256,...keys].join(' ').toLowerCase();
  return result;
 }).filter(row=>row.url).sort((a,b)=>a.path.localeCompare(b.path));
}
export function deliveryFilePage(files,{query='',group='',page=0,pageSize=50}={}){
 const words=String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
 const selected=files.filter(row=>(!group||(group==='gis'?row.isGIS:row.group===group))&&words.every(word=>row.search.includes(word)));
 const size=[25,50,100,250].includes(Number(pageSize))?Number(pageSize):50;
 const pages=Math.max(1,Math.ceil(selected.length/size));
 const current=Math.min(Math.max(0,Math.trunc(Number(page)||0)),pages-1);
 return {rows:selected.slice(current*size,(current+1)*size),count:selected.length,bytes:selected.reduce((n,row)=>n+(Number(row.bytes)||0),0),page:current,pages,pageSize:size,start:selected.length?current*size+1:0,end:Math.min((current+1)*size,selected.length)};
}
export function attachDeliveryInspection(host){
 let active=null,root=null,generation=0,controller=null;
 const remembered=new Map();
 const workspace=()=>host.getState()?.workspace_key||'';
 function current(){if(!active||active.workspace!==workspace())throw Error('Reopen this original delivery in its saved workspace.');return active;}
 function detach(){generation++;controller?.abort();controller=null;const preview=root?.querySelector('[data-delivery-inspection-preview]');if(preview){preview.innerHTML='';preview.hidden=true;}root=null;active=null;}
 function file(path){return current().byPath.get(path);}
 function match(key){return current().files.find(row=>row.keys.includes('files.'+key));}
 function download(row,label='Download'){
  return row?.url?'<a href="'+esc(row.url)+'?download=1" download>'+esc(label)+'</a>':'';
 }
 function previewControl(row,label){
  return canPreview(row)?button('preview',label||'Preview','data-path="'+esc(row.key)+'"'):'';
 }
 function nav(action,label,id){
  return id?button(action,label,'data-id="'+esc(id)+'"'):'';
 }
 function choice(name,ids,label,names){
  if(!ids?.length)return '';
  return '<label>'+esc(label)+'<select data-delivery-inspection-choice="'+name+'">'+ids.map(id=>'<option value="'+esc(id)+'">'+esc(names(id))+'</option>').join('')+'</select></label>'+button(name,'Open selected');
 }
 function missingEndpoint(error){return error?.status===404&&error?.code==='ROUTE_MISSING';}
 async function acquire(id,expectedWorkspace,legacyRecord){
  let packet,record,error='';
  try{packet=await host.api(host.endpoint('/api/delivery-inspection',{delivery_id:id}));}
  catch(failure){
   if(!missingEndpoint(failure))throw failure;
   error='The current operator has not installed the delivery inspection endpoint';
   record=legacyRecord||await host.api(host.endpoint('/api/item',{kind:'deliveries',id}));
   if(record?.id!==id||record?.schema!=='upstate.delivery/v1')throw Error('The original delivery belongs to another retained selection.');
   packet={files:list(record._downloads).map(row=>({...row,key:row.id,path:row.filename,keys:[],title:row.label,fallback:true})),links:{}};
   return {packet,record,error};
  }
  if(packet?.schema!=='upstate.delivery-inspection/v1'||packet.workspace_key!==expectedWorkspace||packet.delivery_id!==id||
     !Array.isArray(packet.files)||packet.file_count!==packet.files.length||packet.detail?.id!==id||packet.detail?.schema!=='upstate.delivery/v1')
   throw Error('The delivery file index has an incomplete or different original identity. Receive the matching current operator component.');
  for(const file of packet.files){
   if(typeof file.path!=='string'||!file.path||!Array.isArray(file.keys)||!safeURL(file.url)||!safeURL(file.preview_url)||
      !Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[0-9a-f]{64}$/.test(file.sha256||''))
    throw Error('The original delivery inventory contains an invalid file descriptor.');
  }
  return {packet,record:packet.detail,error};
 }
 function accept(record,packet,error,expectedWorkspace,epoch){
  if(epoch!==generation||expectedWorkspace!==workspace())return null;
  const identity=expectedWorkspace+':'+record.id;
  const files=deliveryFileRows(packet.files),saved=remembered.get(identity)||{query:'',group:'',page:0,pageSize:50};
  active={record,packet,error,workspace:expectedWorkspace,identity,files,byPath:new Map(files.map(row=>[row.key,row])),display:{...saved},previewHistory:[],previewPath:null};
  return {record,files,html:render()};
 }
 async function load(id,expectedWorkspace=workspace()){
  if(!/^[0-9a-f]{64}$/.test(id||''))throw Error('Choose an original retained delivery.');
  detach();const epoch=generation;
  const result=await acquire(id,expectedWorkspace);
  return accept(result.record,result.packet,result.error,expectedWorkspace,epoch);
 }
 async function prepare(record,expectedWorkspace=workspace()){
  detach();const epoch=generation;
  const result=await acquire(record.id,expectedWorkspace,record);
  return accept(result.record,result.packet,result.error,expectedWorkspace,epoch)?.html??null;
 }
 function render(){
  const value=current(),row=value.record,links=value.packet.links||{},files=value.files;
  const source=host.getState()?.data||{};
  const names=(kind,id)=>{const record=list(source[kind]).find(row=>row.id===id);return record?.title||record?.selection?.title||short(id);};
  const report=match('report_html'),pdf=match('report'),atlas=match('map_atlas_received_browser')||match('map_atlas_browser')||match('map_atlas');
  const economic=files.find(row=>row.path==='economics/'+links.economic_edition_id+'/index.html');
  const mainArchive=match('delivery_archive'),working=match('working_archive'),original=files.find(row=>row.keys.includes('original_record'));
  return '<section data-delivery-inspection><div class="meta"><span>'+esc(human(row.state))+'</span><span>Original audit: '+esc(row.package?.auditStatus||'In progress')+'</span><span>'+(row.map_count??Object.keys(row.maps||{}).length)+' retained map PDFs</span></div>'+
   (row.error?'<p class="notice error">'+esc(row.error.message)+'</p>':'')+
   (value.error?'<p class="notice" role="status">Original file index: '+esc(value.error)+'. Existing retained download links remain available.</p>':'')+
   '<h3 class="subheading">Scientific report and complete delivery</h3><div class="page-actions">'+previewControl(report,'Open linked scientific report')+previewControl(pdf,'Preview report PDF')+
   download(pdf,'Download report PDF')+download(match('report_markdown'),'Download report Markdown')+download(match('report_data'),'Download report data')+
   previewControl(atlas,'Preview complete map atlas')+nav('atlas','Open map atlas and selections',row.id)+
   previewControl(economic,'Open retained economic desk')+download(mainArchive,'Download complete delivery ZIP')+download(working,'Download editable workspace')+'</div>'+
   '<p class="note">The linked preview adds navigation to the original HTML while preserving the report content. Companion links open only declared files from this delivery. Downloads retain the original bytes; the complete ZIP retains the offline directory structure.</p>'+
   '<h3 class="subheading">Editable map datasets</h3><div class="page-actions">'+
   previewControl(atlas,'Browse map datasets and metadata')+
   download(match('map_atlas_csv'),'Download map-to-dataset CSV')+
   download(match('map_atlas_index'),'Download dataset and lineage JSON')+
   button('gis-files','Show GIS files and metadata')+'</div>'+
   '<p class="note">Each linked map panel retains its actual GIS dataset and FGDC XML, including signed scenario changes and dimensionless priorities in current deliveries. Download accompanying files beside the GeoTIFF, or use the complete ZIP to keep relative paths intact. The atlas index records units, original grid, valid-support method, selected runs and source lineage.</p>'+
   '<h3 class="subheading">Original analysis and source context</h3>'+
   (links.analysis_id?'<p>'+esc(links.analysis_title||'Saved scenario analysis')+' · <code>'+esc(links.analysis_id)+'</code></p><p class="note">'+esc(links.source_area_count)+' retained analysis areas. Original record SHA256 '+esc(links.analysis_sha256||'Retained with the analysis')+'.</p>':'')+
   '<div class="page-actions">'+nav('analysis','Open saved scenario analysis',links.analysis_id)+nav('watershed-report','Open source watershed report',links.watershed_report_id)+
   nav('water-analysis','Open receiving-water analysis',links.receiving_water_analysis_id)+download(original,'Download original delivery record')+'</div>'+
   (links.quantity_scope?'<p class="note">Receiving-water quantity scope: '+esc(human(links.quantity_scope))+'. Overlapping areas use the retained native family union.</p>':'')+
   '<div class="filters">'+choice('plan',links.source_plan_ids,'Prepared source plan',id=>names('receiving_water_plans',id))+
   choice('source',links.source_collection_ids,'Original source edition',id=>names('sources',id))+
   choice('run',links.native_run_ids,'Original native run',id=>names('runs',id))+'</div>'+
   (value.error?'<details class="technical"><summary>Original retained delivery record</summary><pre class="json-view">'+esc(JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key])=>key!=='_downloads')),null,2))+'</pre></details>':'')+
   (row.priority?'<details class="technical"><summary>Original combined-priority settings</summary><pre class="json-view">'+esc(JSON.stringify(row.priority,null,2))+'</pre></details>':'')+
   (row.state==='failed'?'<div class="page-actions"><button type="button" data-action="delivery-resume" data-id="'+esc(row.id)+'">Resume original delivery</button></div>':'')+
   '<section data-delivery-inspection-preview hidden></section>'+
   '<h3 class="subheading">Retained files</h3><p class="note">'+files.length+' retained original files · '+formatBytes(files.reduce((n,row)=>n+(Number(row.bytes)||0),0))+'. All filters apply to the complete file inventory.</p>'+
   '<div class="filters"><label>Search original files<input type="search" data-delivery-inspection-search value="'+esc(value.display.query)+'" placeholder="Path, label, retained field or SHA256"></label>'+
   '<label>File group<select data-delivery-inspection-group><option value="">All original files</option>'+groups.map(([id,title])=>'<option value="'+id+'"'+(value.display.group===id?' selected':'')+'>'+esc(title)+' ('+files.filter(row=>id==='gis'?row.isGIS:row.group===id).length+')</option>').join('')+'</select></label>'+
   '<label>Rows per page<select data-delivery-inspection-size>'+[25,50,100,250].map(size=>'<option value="'+size+'"'+(value.display.pageSize===size?' selected':'')+'>'+size+'</option>').join('')+'</select></label></div>'+
   '<div data-delivery-inspection-files></div></section>';
 }
 function save(){
  remembered.set(current().identity,{...active.display});
  while(remembered.size>12)remembered.delete(remembered.keys().next().value);
 }
 function renderFiles(focus=false){
  if(!root||!active||active.workspace!==workspace())return;
  const page=deliveryFilePage(active.files,active.display);active.display.page=page.page;save();
  const target=root.querySelector('[data-delivery-inspection-files]');if(!target)return;
  target.innerHTML='<p role="status" aria-live="polite">Files '+page.start+'–'+page.end+' of '+page.count+' matching retained files · '+formatBytes(page.bytes)+'. Page '+(page.page+1)+' of '+page.pages+'.</p>'+
   '<div class="page-actions">'+button('page','Previous page','data-direction="-1"'+(page.page===0?' disabled':''))+button('page','Next page','data-direction="1"'+(page.page===page.pages-1?' disabled':''))+'</div>'+
   '<div class="table-scroll" tabindex="0" aria-label="Original retained delivery files"><table><thead><tr><th scope="col">Original file</th><th scope="col">Group / size</th><th scope="col">Original SHA256</th><th scope="col">Open</th></tr></thead><tbody>'+
   page.rows.map(row=>'<tr><td><strong>'+esc(row.title)+'</strong><br><code>'+esc(row.path)+'</code><details><summary>Retained fields</summary>'+esc(row.keys.join(', ')||'Original file ticket')+'</details></td>'+
    '<td>'+esc(groups.find(([id])=>id===row.group)?.[1]||row.group)+'<br>'+formatBytes(row.bytes)+'</td><td class="mono">'+esc(row.sha256||'')+'</td>'+
    '<td><div class="inline-actions">'+previewControl(row)+download(row)+'</div></td></tr>').join('')+
   '</tbody></table></div>'+
   (page.count?'':'<p class="note">No retained files match these choices.</p>');
  if(focus)target.querySelector('[tabindex]')?.focus();
 }
 function mount(container){
  if(!active||active.workspace!==workspace())return;
  root=container.querySelector('[data-delivery-inspection]');if(!root)return;
  controller?.abort();controller=new AbortController();
  root.addEventListener('input',event=>{
   if(event.target.matches('[data-delivery-inspection-search]')){active.display.query=event.target.value;active.display.page=0;renderFiles();}
  },{signal:controller.signal});
  root.addEventListener('change',event=>{
   if(event.target.matches('[data-delivery-inspection-group]'))active.display.group=event.target.value;
   else if(event.target.matches('[data-delivery-inspection-size]'))active.display.pageSize=Number(event.target.value);
   else return;
   active.display.page=0;renderFiles();
  },{signal:controller.signal});
  window.addEventListener('message',event=>{
   if(!active||active.workspace!==workspace()||event.source!==root?.querySelector('[data-delivery-inspection-frame]')?.contentWindow)return;
   const message=event.data;
   if(!message||!['upstate.delivery-member/v1','upstate.delivery-external/v1'].includes(message.type)||typeof message.url!=='string')return;
   try{
    const url=new URL(message.url,window.location.href);
    if(message.type==='upstate.delivery-external/v1'){
     if(!['https:','http:'].includes(url.protocol)||url.origin===window.location.origin||url.username||url.password)throw Error('Choose an original public HTTP or HTTPS source.');
     const notice=root?.querySelector('[data-delivery-inspection-external]');
     if(notice){
      notice.innerHTML='Original public source: <a href="'+esc(url.href)+'" target="_blank" rel="noopener noreferrer">'+esc(String(message.label||url.hostname).slice(0,500))+'</a>';
      notice.hidden=false;
     }
     window.open(url.href,'_blank','noopener,noreferrer');
     return;
    }
    const prefix='/api/file/delivery-preview/'+encodeURIComponent(active.workspace)+'/'+active.record.id+'/';
    if(url.origin!==window.location.origin||!url.pathname.startsWith(prefix))throw Error('Choose a companion declared in this original delivery.');
    const path=decodeURIComponent(url.pathname.slice(prefix.length));
    const selected=active.byPath.get(path);
    if(!selected||selected.fallback)throw Error('This link is not a declared file in the original delivery. Use its original source link or download the complete ZIP.');
    if(message.download===true||url.searchParams.get('download')==='1'||!canPreview(selected)){
     const anchor=document.createElement('a');
     anchor.href=selected.url+'?download=1';anchor.download='';
     document.body.append(anchor);anchor.click();anchor.remove();
    }else showPreview(selected,{fragment:url.hash});
   }catch(error){host.toast?.(error.message||String(error),true);}
  },{signal:controller.signal});
  renderFiles();
 }
 function showPreview(selected,{back=false,fragment=''}={}){
  const value=current();
  if(!canPreview(selected))throw Error('Choose an original retained HTML or PDF file.');
  const target=root?.querySelector('[data-delivery-inspection-preview]');if(!target)return;
  if(!back&&value.previewPath&&value.previewPath!==selected.key)value.previewHistory.push(value.previewPath);
  if(value.previewHistory.length>100)value.previewHistory.shift();
  value.previewPath=selected.key;
  const isHTML=/\.html?$/i.test(selected.path);
  const url=isHTML?selected.preview_url:selected.url;
  if(!url)throw Error('Reopen this delivery to obtain its linked HTML preview.');
  target.hidden=false;
  target.innerHTML='<h3 class="subheading">'+esc(selected.title)+'</h3><p><code>'+esc(selected.path)+'</code></p><div class="page-actions">'+
   (value.previewHistory.length?button('preview-back','Back to previous preview'):'')+
   (!isHTML?'<a href="'+esc(selected.url)+'" target="_blank" rel="noopener noreferrer">Open original in a separate tab</a>':'')+
   download(selected,isHTML?'Download original HTML':'Download original')+button('close-preview','Close preview')+'</div>'+
   '<p data-delivery-inspection-external class="note" hidden></p>'+
   '<iframe data-delivery-inspection-frame class="preview-frame" title="'+esc(selected.title)+'" src="'+esc(url+fragment)+'" referrerpolicy="no-referrer"'+(isHTML?' sandbox="allow-scripts allow-downloads allow-modals allow-popups"':'')+'></iframe>';
  target.scrollIntoView({block:'start'});
 }
 function chosen(name,allowed){
  const id=root?.querySelector('[data-delivery-inspection-choice="'+name+'"]')?.value;
  if(!list(allowed).includes(id))throw Error('Choose an original identity retained in this delivery.');
  return id;
 }
 async function dispatch(node){
  const value=current(),action=node.dataset.action.replace(/^delivery-inspection-/,'');
  const links=value.packet.links||{},expected=value.workspace;
  if(action==='page'){
   const step=Number(node.dataset.direction);if(![-1,1].includes(step))throw Error('Choose a previous or next file page.');
   value.display.page+=step;renderFiles(true);return;
  }
  if(action==='gis-files'){
   value.display.group='gis';value.display.query='';value.display.page=0;
   const group=root?.querySelector('[data-delivery-inspection-group]');
   const search=root?.querySelector('[data-delivery-inspection-search]');
   if(group)group.value='gis';if(search)search.value='';
   renderFiles(true);return;
  }
  if(action==='preview'){showPreview(file(node.dataset.path));return;}
  if(action==='preview-back'){
   const previous=value.previewHistory.pop();if(previous)showPreview(file(previous),{back:true});return;
  }
  if(action==='close-preview'){
   const target=root?.querySelector('[data-delivery-inspection-preview]');
   if(target){target.innerHTML='';target.hidden=true;}
   value.previewPath=null;value.previewHistory=[];return;
  }
  let kind,id,extension,method,args;
  if(action==='analysis'){if(node.dataset.id!==links.analysis_id)throw Error('Choose the attached saved analysis.');extension='scenario-analysis';method='open';args=[links.analysis_id,{workspace_key:expected}];}
  else if(action==='watershed-report'){if(node.dataset.id!==links.watershed_report_id)throw Error('Choose the source watershed report.');extension='scenario-reports';method='open';args=[links.watershed_report_id,{workspace_key:expected}];}
  else if(action==='atlas'){if(node.dataset.id!==value.record.id)throw Error('Choose this original delivery atlas.');extension='map-atlas';method='open';args=[value.record.id,{workspace_key:expected}];}
  else if(action==='plan')id=chosen('plan',links.source_plan_ids);
  else if(action==='water-analysis'){if(node.dataset.id!==links.receiving_water_analysis_id)throw Error('Choose the retained receiving-water analysis.');id=links.receiving_water_analysis_id;}
  else if(action==='source'){id=chosen('source',links.source_collection_ids);kind='sources';}
  else if(action==='run'){id=chosen('run',links.native_run_ids);kind='runs';}
  else throw Error('Choose an available original delivery action.');
  host.closeDetail?.();
  if(workspace()!==expected)throw Error('Return to this delivery in its original workspace.');
  if(extension)return host.openExtension(extension,method,...args);
  if(action==='plan')return host.openReceivingPlan(id);
  if(action==='water-analysis')return host.openReceivingAnalysis(id);
  return host.openItem(kind,id);
 }
 return {load,prepare,mount,dispatch,detach};
}
