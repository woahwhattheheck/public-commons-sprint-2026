// MIT. Industrial operator over the original private publication service.
const $=id=>document.getElementById(id),PAGE=30;
const app={launch:null,status:null,target:null,source:null,selections:new Map(),page:0,selected:null,selectedId:null,
  selectedKey:null,reviewKey:null,receivingKey:null,objects:[],busy:false,draftKey:null};
const tokenKey='starforge.geoserver.token';
let token=location.hash.slice(1);
if(/^[a-f0-9]{64}$/.test(token)){try{sessionStorage.setItem(tokenKey,token);}catch{}history.replaceState(null,'',location.pathname);}
else try{token=sessionStorage.getItem(tokenKey);}catch{}
const lifetime=new AbortController();
window.addEventListener('pagehide',()=>{lifetime.abort();for(const url of app.objects)URL.revokeObjectURL(url);},{once:true});
const element=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node;};
function message(text,error=false){$('notice').textContent=text;$('notice').dataset.error=String(error);}
function fail(error){message((error.code?error.code+': ':'')+(error.message??String(error)),true);}
function pretty(value){return JSON.stringify(value,null,2);}
function details(title,value){
  const node=element('details',undefined,'scope-detail');node.append(element('summary',title),element('pre',pretty(value)));return node;
}
function pairs(target,rows){
  target.replaceChildren();for(const [key,value]of rows){target.append(element('dt',key),element('dd',value??'—'));}
}
async function api(path,{method='GET',input,blob=false}={}){
  const response=await fetch(path,{method,headers:{authorization:'Bearer '+token,
    ...(input===undefined?{}:{'content-type':'application/json'})},body:input===undefined?undefined:JSON.stringify(input),signal:lifetime.signal,cache:'no-store'});
  if(!response.ok){let error;try{error=(await response.json()).error;}catch{}throw Object.assign(new Error(error?.message??'The operator returned HTTP '+response.status),{code:error?.code,status:response.status});}
  return blob?response.blob():response.json();
}
function draftProfile(){const p=app.launch?.profile;return p?{baseUrl:p.baseUrl,workspace:p.workspace,datastore:p.datastore}:null;}
function saveDraft(){
  if(!app.draftKey||!app.source)return;
  try{localStorage.setItem(app.draftKey,JSON.stringify({schema:'starforge.geoserver-browser-draft.v1',
    workspace:app.launch.workspace,profile:draftProfile(),directory:$('source-directory').value,sha:$('source-sha').value,
    operation:$('operation-id').value,kind:$('publication-kind').value,expected:$('expected-publication').value,
    selections:[...app.selections].map(([id,row])=>[id,{selected:row.selected,value:row.value}])}));}
  catch{message('The current selection is open. Browser draft storage is unavailable; prepared operations are retained by the native journal.');}
}
function countSelection(){
  const count=[...app.selections.values()].filter(row=>row.selected).length;
  $('selected-count').textContent=count+' layer'+(count===1?'':'s');return count;
}
const unique=values=>[...new Set(values)];
function safeName(value){let name=String(value).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,63);if(!/^[A-Za-z_]/.test(name))name='layer_'+name.slice(0,57);return name||'layer';}
function initialLayer(layer,index){
  const styles=app.target?.styles??[],kind=layer.geometryType.includes('POINT')?'point':layer.geometryType.includes('LINE')?'line':'polygon';
  const selectedStyle=styles.find(style=>style.name===kind&&style.workspace===null)??styles.find(style=>style.workspace===app.launch.profile.workspace)??styles[0];
  const observedRoles=app.target?.roles??[],read=unique(app.launch.profile.readers.flatMap(reader=>reader.roles)).filter(role=>observedRoles.includes(role));
  const write=observedRoles.includes('ROLE_ADMINISTRATOR')?['ROLE_ADMINISTRATOR']:[];
  return {selected:app.source.manifest.layers.length<=256,value:{layerId:layer.id,name:safeName(layer.relation),title:layer.title||layer.relation,
    abstract:'',enabled:true,advertised:true,style:selectedStyle?{...selectedStyle}:{name:'',workspace:app.launch.profile.workspace},
    access:{read,write}},layer,index};
}
function field(labelText,value,update,{type='text',wide=false,placeholder,choices,multiple=false}={}){
  const label=element('label',labelText,wide?'wide':undefined);
  let control;
  if(choices){
    control=element('select');control.multiple=multiple;
    for(const choice of choices){const option=element('option',typeof choice==='string'?choice:choice.label);
      option.value=typeof choice==='string'?choice:choice.value;option.selected=multiple?value.includes(option.value):String(value)===option.value;control.append(option);}
  }else{
    control=element(type==='textarea'?'textarea':'input');if(type!=='textarea')control.type=type;
    if(type==='checkbox')control.checked=Boolean(value);else control.value=value??'';
    if(placeholder)control.placeholder=placeholder;control.autocomplete='off';
  }
  if(type==='checkbox')label.className='check-label';
  control.addEventListener('input',()=>{
    update(multiple?[...control.selectedOptions].map(option=>option.value):type==='checkbox'?control.checked:control.value);
    saveDraft();countSelection();
  });
  label.append(control);return {label,control};
}
function layerSettings(row){
  const value=row.value,area=element('div',undefined,'layer-fields');
  const add=(label,current,update,options)=>{const found=field(label,current,update,options);area.append(found.label);return found.control;};
  add('Published feature type',value.name,v=>{value.name=v;});
  add('Title',value.title,v=>{value.title=v;},{wide:true});
  add('Description',value.abstract,v=>{value.abstract=v;},{type:'textarea',wide:true});
  const flags=element('div');flags.append(field('Enabled',value.enabled,v=>{value.enabled=v;},{type:'checkbox'}).label,
    field('Advertised',value.advertised,v=>{value.advertised=v;},{type:'checkbox'}).label);area.append(flags);
  const choices=[{value:'',label:'Choose an existing style'},...(app.target?.styles??[]).map(style=>({
    value:JSON.stringify(style),label:(style.workspace??'Global')+' / '+style.name}))];
  const selectedStyle=value.style.file!==undefined?'':JSON.stringify({name:value.style.name,workspace:value.style.workspace});
  const style=add('Existing native style',selectedStyle,v=>{if(v)value.style=JSON.parse(v);},{choices,wide:true});
  style.disabled=value.style.file!==undefined;
  const upload=field('Publish an SLD source',value.style.file!==undefined,checked=>{
    if(checked){value.style={name:value.style.workspace===app.launch.profile.workspace?value.style.name:'',workspace:app.launch.profile.workspace,file:'',sha256:'',format:'sld'};}
    else{const first=app.target?.styles?.[0];value.style=first?{...first}:{name:'',workspace:app.launch.profile.workspace};}
    renderLayers();
  },{type:'checkbox'});area.append(upload.label);
  if(value.style.file!==undefined){
    add('Workspace style name',value.style.name,v=>{value.style.name=v;});
    add('Native format',value.style.format,v=>{value.style.format=v;},{choices:['sld','se']});
    add('Original SLD file on this host',value.style.file,v=>{value.style.file=v;},{wide:true,placeholder:'/absolute/path/style.sld'});
    add('Exact SLD SHA-256',value.style.sha256,v=>{value.style.sha256=v;},{wide:true});
  }
  add('Allowed read roles',value.access.read,v=>{value.access.read=v;},{choices:app.target?.roles??[],multiple:true});
  add('Allowed write roles',value.access.write,v=>{value.access.write=v;},{choices:app.target?.roles??[],multiple:true});
  const native=element('p','Service roles control GeoServer access. The observed PostGIS reader remains '+app.launch.profile.database.role+'.','muted explanation');area.append(native);
  const map=value.map??{bbox:[],width:800,height:600};row.mapDraft??={...map,bbox:[...map.bbox]};
  add('CRS:84 map bounds',row.mapDraft.bbox.join(', '),v=>{
    row.mapDraft.bbox=v.split(',').map(part=>part.trim()).filter(Boolean);
    if(row.mapDraft.bbox.length)value.map={...row.mapDraft,bbox:[...row.mapDraft.bbox]};else delete value.map;
  },{wide:true,placeholder:'west, south, east, north; blank uses advertised bounds'});
  const size=element('div');size.append(field('Map width',row.mapDraft.width,v=>{row.mapDraft.width=Number(v);if(value.map)value.map.width=Number(v);},{type:'number'}).label,
    field('Map height',row.mapDraft.height,v=>{row.mapDraft.height=Number(v);if(value.map)value.map.height=Number(v);},{type:'number'}).label);area.append(size);
  area.append(element('p','An enabled layer that is not advertised needs explicit map bounds. Native WFS receiving retains all exposed fields and the original sf_id identifiers.','muted explanation'));
  return area;
}
function filteredLayers(){
  const filter=$('layer-filter').value.trim().toLowerCase();
  return [...app.selections.values()].filter(row=>!filter||[row.layer.id,row.layer.relation,row.layer.title,row.layer.geometryType].join(' ').toLowerCase().includes(filter));
}
function renderLayers(){
  const all=filteredLayers();app.page=Math.max(0,Math.min(app.page,Math.max(0,Math.ceil(all.length/PAGE)-1)));
  const rows=all.slice(app.page*PAGE,(app.page+1)*PAGE);$('layers').replaceChildren();
  for(const row of rows){
    const container=element('div',undefined,'layer-row'),head=element('div',undefined,'layer-head'),check=element('input');
    check.type='checkbox';check.checked=row.selected;check.setAttribute('aria-label','Select '+row.layer.relation);
    check.addEventListener('change',()=>{if(check.checked&&countSelection()>=256){check.checked=false;message('Select up to 256 layers per reviewed publication.');return;}
      row.selected=check.checked;countSelection();saveDraft();});
    const names=element('div');names.append(element('div',row.layer.relation,'layer-name'),
      element('div',row.layer.title+' · '+row.layer.id,'layer-metadata'));
    head.append(check,names,element('div',row.layer.geometryType+' · EPSG:'+row.layer.srid+' · '+row.layer.rowCount+' rows','layer-metadata'));
    const settings=element('details');settings.append(element('summary','Publication, style and access settings'));
    settings.addEventListener('toggle',()=>{if(settings.open&&!settings.dataset.loaded){settings.append(layerSettings(row));settings.dataset.loaded='true';}});
    container.append(head,settings);$('layers').append(container);
  }
  if(!rows.length)$('layers').append(element('p',app.source?'No matching native views.':'Load the original accepted receipt.','empty'));
  $('page-label').textContent=all.length?(app.page*PAGE+1)+'–'+(app.page*PAGE+rows.length)+' of '+all.length:'0';
  $('previous-page').disabled=app.page===0;$('next-page').disabled=(app.page+1)*PAGE>=all.length;countSelection();
}
async function loadSource({restored}={}){
  const directory=$('source-directory').value.trim(),manifestSha256=$('source-sha').value.trim();
  const received=await api('/api/source',{method:'POST',input:{directory,...(manifestSha256?{manifestSha256}:{})}});
  app.source=received;$('source-sha').value=received.manifestSha256;app.selections=new Map();
  for(const [index,layer]of received.manifest.layers.entries()){
    const row=initialLayer(layer,index),saved=restored?.find(([id])=>id===layer.id)?.[1];
    if(saved){row.selected=saved.selected;row.value=saved.value;}app.selections.set(layer.id,row);
  }
  app.page=0;const m=received.manifest;
  $('source-summary').textContent='Project '+m.projectId+' · accepted edition '+m.editionId+' · revision '+m.revision+' · '+
    m.layers.length+' stable views · '+received.files.count+' original files · database '+m.database.name+'.'+m.database.schema;
  if(!$('expected-publication').value)$('expected-publication').value=app.status?.publication?.operationId??'';
  if(!$('rollback-directory').value)$('rollback-directory').value=directory;
  if(!$('rollback-sha').value)$('rollback-sha').value=received.manifestSha256;
  renderLayers();saveDraft();controls();message('The original accepted PostGIS source is loaded. Review the selected layers and existing service roles.');
}
function serviceSummary(){
  const p=app.launch.profile;
  pairs($('service-summary'),[['Origin',p.baseUrl],['Workspace',p.workspace],['Datastore',p.datastore],
    ['Database',p.database.name],['Schema',p.database.schema],['Reader',p.database.role],
    ['Profiles',p.readers.map(row=>row.id).join(', ')],...(app.target?[['Catalog',app.target.nativeViews.length+' native views; '+app.target.styles.length+' styles']]:[])]);
  $('cli-help').textContent='starforge geoserver inspect --connection '+app.launch.workspace+'/console-connection.json\n\n'+
    'starforge geoserver receive --connection '+app.launch.workspace+'/console-connection.json --operation ORIGINAL_ID';
}
async function loadTarget(){
  app.target=await api('/api/target');serviceSummary();
  if(app.source)renderLayers();message('Read the actual workspace, datastore, roles, styles and native views.');
}
function operations(){
  $('operations').replaceChildren();
  const rows=[...(app.status?.operations??[])].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  for(const row of rows){
    const button=element('button',row.id,row.id===app.selectedId?'active':undefined);
    button.append(element('span',row.kind+' · '+row.state+' · '+row.appliedSteps+'/'+row.steps+' steps'));
    button.addEventListener('click',()=>selectOperation(row.id).catch(fail));$('operations').append(button);
  }
  if(!rows.length)$('operations').append(element('p','This original workspace has no prepared operation yet.','muted'));
}
function controls(){
  const busy=Boolean(app.status?.active),selected=app.selected?.state,review=app.selected?.review;
  for(const id of ['prepare','rollback','export','apply','reconcile','receive','resume-prepare'])$(id).disabled=busy;
  $('prepare').disabled||=!app.source||countSelection()===0||
    $('source-directory').value.trim()!==app.source.directory||$('source-sha').value.trim()!==app.source.manifestSha256;
  $('apply').disabled||=!review;
  $('reconcile').disabled||=!review;
  $('resume-prepare').disabled||=!selected||Boolean(review);
  $('receive').disabled||=!selected||!['PUBLISHED','RECEIVED','EXPORTED'].includes(selected.state)||app.selected.request.kind==='rollback';
  $('export').disabled||=!selected||!['RECEIVED','EXPORTED','ROLLED_BACK'].includes(selected.state);
  $('cancel').disabled=!app.status?.active;
  $('connection-state').textContent=busy?'Running '+app.status.active.action:'Connected';
}
function renderReview(){
  const selected=app.selected;if(!selected)return;
  const {state,request,review}=selected;
  $('operation-state').textContent=state.state;
  pairs($('operation-summary'),[['Operation',state.id],['Project',request.projectId],['Change',request.kind],
    ['Review SHA-256',state.reviewSha256],['PostGIS manifest',request.manifestSha256],
    ['Expected publication',request.expectedPublication??'First publication'],
    ['Current work',state.receivingProgress?state.receivingProgress.readerId+' / '+state.receivingProgress.layerId:'—']]);
  const key=state.id+'|'+state.reviewSha256+'|'+(state.reconciliation?.at??'')+'|'+state.error?.at;
  if(key===app.reviewKey)return;app.reviewKey=key;$('review').replaceChildren();
  if(state.error)$('review').append(element('p',state.error.code+': '+state.error.message,'review-note'));
  if(state.receivingError)$('review').append(element('p',state.receivingError.code+': '+state.receivingError.message,'review-note'));
  if(!review){$('review').append(element('p','The original request is retained. Resume preparation to complete its exact review.','muted'));return;}
  const table=element('table',undefined,'review-table'),thead=element('thead'),tr=element('tr');
  for(const name of ['Resource','Before','After'])tr.append(element('th',name));tr.firstChild.className='resource';thead.append(tr);table.append(thead);
  const tbody=element('tbody');
  for(const step of review.steps){
    const row=element('tr'),label=element('td');label.append(element('strong',step.kind),element('pre',step.rule??step.name??step.layerId??step.path));
    const before=review.direction==='reverse'?step.desired:step.before,after=review.direction==='reverse'?step.before:step.desired;
    const prior=element('td'),next=element('td');prior.append(element('pre',before===null?'Absent':pretty(before)));next.append(element('pre',after===null?'Remove this owned resource':pretty(after)));
    row.append(label,prior,next);tbody.append(row);
  }
  table.append(tbody);const wrapper=element('div',undefined,'review-wrap');wrapper.append(table);$('review').append(wrapper);
  if(state.reconciliation?.conflicts?.length)$('review').append(details('Current resource conflicts',state.reconciliation.conflicts));
  $('review').append(details('Complete retained native review',review),details('Operation history and observed effects',state));
}
async function showMap(target,item,readerId){
  const blob=await api('/api/map?'+new URLSearchParams({operationId:app.selectedId,readerId,layerId:item.layerId}),{blob:true});
  const url=URL.createObjectURL(blob);app.objects.push(url);const img=element('img');img.src=url;img.alt='Native GeoServer WMS map of '+item.name;target.replaceChildren(img);
}
function renderReceiving(){
  const state=app.selected?.state,result=state?.receiving,key=state?.id+'|'+(result?.completedAt??'')+'|'+state?.receivingProgress?.at;
  if(key===app.receivingKey)return;app.receivingKey=key;
  for(const url of app.objects)URL.revokeObjectURL(url);app.objects=[];$('receiving').replaceChildren();
  if(!result){
    $('receiving').append(element('p',state?.receivingProgress?
      'Receiving '+state.receivingProgress.readerId+' / '+state.receivingProgress.layerId+'. Completed layers for this reader: '+state.receivingProgress.layers+'.':
      'Complete publication, then receive the actual WFS and WMS service for every configured reader.','muted'));return;
  }
  $('receiving').append(element('p','Completed '+result.completedAt+' · original review '+result.reviewSha256,'muted'));
  for(const service of result.services){
    const group=element('details',undefined,'native-reader'),summary=element('summary',service.readerId+' · '+service.roles.join(', ')+' · '+service.layers.length+' layers');
    group.append(summary);
    group.addEventListener('toggle',()=>{
      if(!group.open||group.dataset.loaded)return;group.dataset.loaded='true';
      group.append(element('p','WFS '+service.wfs.version+' · WMS '+service.wms.version+' · capabilities retained.','muted'));
      for(const item of service.layers){
        const row=element('div',undefined,'native-layer'),facts=element('div');
        facts.append(element('h3',item.name),element('p',item.state,'muted'));
        const dl=element('dl',undefined,'keyvalues');
        pairs(dl,[['Source layer',item.layerId],['Rows',item.features?.rows??'Disabled'],['Pages',item.features?.pages],
          ['WFS source',item.features?.sourceId],['Field count',item.schema?.fieldCount],
          ['Feature stream SHA',item.features?.featureSequenceSha256],['Native map',item.map?.response?.body?.sha256]]);
        facts.append(dl,details('Original receiving record',item));row.append(facts);
        if(item.map){
          const image=element('div'),button=element('button','View native WMS image');
          button.addEventListener('click',()=>{button.disabled=true;showMap(image,item,service.readerId).catch(error=>{button.disabled=false;fail(error);});});
          image.append(button,element('p','The saved PNG is loaded when requested.','map-placeholder'));row.append(image);
        }
        group.append(row);
      }
    });
    $('receiving').append(group);
  }
}
function downloadArchive(item){
  const form=element('form');form.method='POST';form.action='/download';form.target='geoserver-download';form.hidden=true;
  for(const [name,value]of Object.entries({token,operationId:app.selectedId,manifestSha256:item.manifestSha256})){
    const input=element('input');input.type='hidden';input.name=name;input.value=value;form.append(input);
  }
  document.body.append(form);form.submit();form.remove();message('The original ZIP is streaming to the browser download manager.');
}
function renderExports(){
  $('exports').replaceChildren();const rows=app.selected?.state?.exports??[];
  for(const item of rows){
    const row=element('div',undefined,'export-row'),info=element('div');
    info.append(element('strong',item.directory),element('pre','Manifest SHA-256 '+item.manifestSha256));
    if(item.archive)info.append(element('pre','ZIP '+item.archive.bytes+' bytes · SHA-256 '+item.archive.sha256));
    row.append(info);if(item.archive){const button=element('button','Download ZIP');button.addEventListener('click',()=>downloadArchive(item));row.append(button);}
    $('exports').append(row);
  }
  if(!rows.length)$('exports').append(element('p','Export freezes the complete original operator, native captures and host configuration references. An interrupted export resumes the same selected bytes.','muted'));
}
async function selectOperation(id,{silent=false}={}){
  app.selectedId=id;let selected;
  try{selected=await api('/api/operation?id='+encodeURIComponent(id));}
  catch(error){
    if(error.status!==404||![app.status?.active?.operationId,app.status?.lastJob?.operationId].includes(id))throw error;
    if(app.selectedId!==id)return;app.selected=null;app.reviewKey=null;app.receivingKey=null;
    $('operation-state').textContent=app.status?.active?.operationId===id?'Preparing':'Interrupted';
    $('operation-summary').replaceChildren();$('review').replaceChildren(element('p',app.status?.lastJob?.operationId===id&&app.status.lastJob.error?
      app.status.lastJob.error.message:'The original request is being retained.','muted'));
    renderReceiving();renderExports();operations();controls();return;
  }
  if(app.selectedId!==id)return;app.selected=selected;
  $('rollback-publication').value=id;$('rollback-expected').value=app.status?.publication?.operationId??'';
  renderReview();renderReceiving();renderExports();operations();controls();
  if(!silent)message('Opened original operation '+id+'.');
}
async function refresh({silent=false}={}){
  app.status=await api('/api/state');operations();
  if(app.selectedId)await selectOperation(app.selectedId,{silent:true});
  controls();
  const running=app.status.active;
  if(running){const progress=app.selected?.state?.receivingProgress;message('Running '+running.action+' · '+running.operationId+
    (progress?' · '+progress.readerId+' / '+progress.layerId:''));}
  else if(app.status.lastJob&&app.seenFinishedJob!==app.status.lastJob.id){const job=app.status.lastJob;app.seenFinishedJob=job.id;
    message(job.action+' · '+job.operationId+' · '+job.state+(job.error?' · '+job.error.message:''),job.state!=='COMPLETED');}
}
async function action(name,input){
  const result=await api('/api/action',{method:'POST',input:{action:name,input}});
  app.selectedId=input.operationId;message('Running '+name+' for the original operation '+input.operationId+'.');
  await refresh({silent:true});return result;
}
function newOperation(){
  $('operation-id').value='geoserver-'+crypto.randomUUID();$('expected-publication').value=app.status?.publication?.operationId??'';
  $('publication-kind').value=app.status?.publication?'refresh':'publish';$('rollback-id').value='rollback-'+crypto.randomUUID();saveDraft();
}
$('source-form').addEventListener('submit',event=>{event.preventDefault();loadSource().catch(fail);});
$('publication-form').addEventListener('submit',event=>{
  event.preventDefault();
  if(!app.source){message('Load the original accepted receipt first.',true);return;}
  const layers=[...app.selections.values()].filter(row=>row.selected).map(row=>row.value);
  action('prepare',{operationId:$('operation-id').value.trim(),kind:$('publication-kind').value,
    receivingDirectory:$('source-directory').value.trim(),manifestSha256:$('source-sha').value.trim(),
    expectedPublication:$('expected-publication').value.trim()||null,layers}).catch(fail);
});
$('rollback-form').addEventListener('submit',event=>{event.preventDefault();action('prepareRollback',{
  operationId:$('rollback-id').value.trim(),publicationId:$('rollback-publication').value.trim(),
  receivingDirectory:$('rollback-directory').value.trim(),manifestSha256:$('rollback-sha').value.trim(),
  expectedPublication:$('rollback-expected').value.trim()||null}).catch(fail);});
$('export-form').addEventListener('submit',event=>{event.preventDefault();if(!app.selectedId)return;
  action('exportReceiving',{operationId:app.selectedId,directory:$('export-directory').value.trim(),
    ...($('archive-file').value.trim()?{archiveFile:$('archive-file').value.trim()}:{})}).catch(fail);});
$('apply').addEventListener('click',()=>action('apply',{operationId:app.selectedId,reviewSha256:app.selected.state.reviewSha256}).catch(fail));
$('reconcile').addEventListener('click',()=>action('reconcile',{operationId:app.selectedId}).catch(fail));
$('receive').addEventListener('click',()=>action('receive',{operationId:app.selectedId}).catch(fail));
$('resume-prepare').addEventListener('click',()=>{
  const r=app.selected.request;
  const input=r.kind==='rollback'?{operationId:r.operationId,publicationId:r.publicationId,receivingDirectory:r.receivingDirectory,
    manifestSha256:r.manifestSha256,expectedPublication:r.expectedPublication}:{operationId:r.operationId,receivingDirectory:r.receivingDirectory,
    manifestSha256:r.manifestSha256,expectedPublication:r.expectedPublication,kind:r.kind,layers:r.layers};
  action(r.kind==='rollback'?'prepareRollback':'prepare',input).catch(fail);
});
$('cancel').addEventListener('click',()=>api('/api/cancel',{method:'POST',input:{operationId:app.status.active.operationId}}).then(result=>message(result.state+' · '+result.operationId)).catch(fail));
$('refresh').addEventListener('click',()=>refresh().catch(fail));$('target-refresh').addEventListener('click',()=>loadTarget().catch(fail));
$('new-operation').addEventListener('click',()=>{newOperation();$('operation-id').focus();message('A new operation ID is ready. The selected accepted receipt and layer choices remain available.');});
$('layer-filter').addEventListener('input',()=>{app.page=0;renderLayers();});
$('previous-page').addEventListener('click',()=>{app.page--;renderLayers();});
$('next-page').addEventListener('click',()=>{app.page++;renderLayers();});
$('clear-selection').addEventListener('click',()=>{for(const row of app.selections.values())row.selected=false;renderLayers();saveDraft();});
$('select-page').addEventListener('click',()=>{let count=countSelection();for(const row of filteredLayers().slice(app.page*PAGE,(app.page+1)*PAGE)){
  if(!row.selected&&count<256){row.selected=true;count++;}}renderLayers();saveDraft();});
for(const id of ['source-directory','source-sha'])$(id).addEventListener('input',controls);
for(const id of ['operation-id','publication-kind','expected-publication'])$(id).addEventListener('input',saveDraft);
async function boot(){
  if(!/^[a-f0-9]{64}$/.test(token??''))throw new Error('Open the exact private URL printed by starforge geoserver serve.');
  app.launch=await api('/api/launch');app.draftKey='starforge.geoserver.draft:'+app.launch.workspace;
  serviceSummary();await refresh({silent:true});newOperation();
  try{await loadTarget();}catch(error){fail(error);}
  let saved;try{saved=localStorage.getItem(app.draftKey);}catch{}
  if(saved){
    try{const draft=JSON.parse(saved);
      if(draft.schema==='starforge.geoserver-browser-draft.v1'&&draft.workspace===app.launch.workspace&&pretty(draft.profile)===pretty(draftProfile())){
        $('source-directory').value=draft.directory;$('source-sha').value=draft.sha;$('operation-id').value=draft.operation;
        $('publication-kind').value=draft.kind;$('expected-publication').value=draft.expected;
        await loadSource({restored:draft.selections});
      }
    }catch(error){message('The retained server is open. Reload the accepted receipt to restore this browser draft: '+error.message,true);}
  }
  const retainedId=(app.status.operations??[]).some(row=>row.id===$('operation-id').value)?$('operation-id').value:app.status.publication?.operationId;
  if(retainedId)await selectOperation(retainedId,{silent:true});
  controls();if(!$('notice').dataset.error||$('notice').dataset.error==='false')message('The original GeoServer operator is ready.');
  while(!lifetime.signal.aborted){
    await new Promise(resolve=>setTimeout(resolve,1500));
    if(document.hidden&&!app.status?.active)continue;
    try{await refresh({silent:true});}catch(error){if(lifetime.signal.aborted)return;fail(error);$('connection-state').textContent='Reconnecting';}
  }
}
boot().catch(fail);
