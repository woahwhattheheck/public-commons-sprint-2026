const root=document.querySelector('#app');
const state={workspace:null,jobs:[],queryId:null,editionId:null,tab:'search',mode:'table',page:0,pageSize:25,filter:'',statusFilter:'all',draft:null,detail:null,csrf:null,maxRequestBytes:128*1024*1024,dialog:null,notice:null,comparison:null,comparisonIds:null,pendingJobs:new Set(),busy:new Set()};
const array=value=>Array.isArray(value)?value:value&&typeof value==='object'?Object.values(value):[];
const text=value=>value==null?'Not provided':typeof value==='object'?JSON.stringify(value):String(value);
const itemKey=item=>encodeURIComponent(item.collection||'')+'/'+encodeURIComponent(item.id);
const byId=(items,id)=>array(items).find(item=>item.id===id);
const stamp=value=>value?String(value):'Not provided';
const short=value=>value?String(value).slice(0,12)+'…':'Not captured';
const percent=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(undefined,{maximumFractionDigits:2})+'%':'Not provided';
const byteSize=value=>typeof value==='number'&&Number.isFinite(value)?value<1024?value+' B':value<1024*1024?(value/1024).toFixed(1)+' KiB':(value/1024/1024).toFixed(2)+' MiB':'Not provided';
const operationId=()=>crypto.randomUUID();
const query=()=>byId(state.workspace?.queries,state.queryId);
const edition=()=>byId(state.workspace?.editions,state.editionId);
function node(tag,props={},...children){
  const element=document.createElement(tag);let deferredValue;
  for(const [key,value]of Object.entries(props)){
    if(value===undefined||value===null||value===false)continue;
    if(key==='class')element.className=value;
    else if(key==='text')element.textContent=value;
    else if(key.startsWith('on')&&typeof value==='function')element.addEventListener(key.slice(2).toLowerCase(),value);
    else if(key==='checked'||key==='disabled'||key==='selected'||key==='multiple')element[key]=!!value;
    else if(key==='value')deferredValue=value;
    else element.setAttribute(key,value===true?'':String(value));
  }
  const append=child=>{if(child===null||child===undefined||child===false)return;if(Array.isArray(child)){child.forEach(append);return;}element.append(child instanceof Node?child:document.createTextNode(String(child)));};
  children.forEach(append);if(deferredValue!==undefined)element.value=deferredValue;return element;
}
const button=(label,action,props={})=>node('button',{type:'button',onclick:()=>void safely(action),...props},label);
const badge=(value,strong=false)=>node('span',{class:'badge'+(strong?' strong':'')},String(value||'Unknown').replaceAll('_',' '));
const field=(label,input,help)=>node('div',{class:'field'},node('label',{for:input.id},label),input,help?node('p',{class:'help'},help):null);
const detailRow=(label,value)=>[node('dt',{},label),node('dd',{},value instanceof Node?value:text(value))];
function externalLink(href,label){
  try{const url=new URL(href);if(!['https:','http:'].includes(url.protocol))throw new Error('protocol');return node('a',{href:url.href,target:'_blank',rel:'noopener noreferrer'},label||url.href);}
  catch{return node('code',{},label||href||'Not provided');}
}
const jsonDetails=(label,value)=>node('details',{},node('summary',{},label),node('pre',{},JSON.stringify(value,null,2)));
function sourceLine({sha,receivedAt}={}){
  return node('div',{class:'source-line'},externalLink('https://element84.com/earth-search/','Earth Search by Element 84'),receivedAt?node('span',{},'Received '+stamp(receivedAt)):null,sha?node('code',{},'SHA256 '+sha):null);
}
function toast(message,error=false){
  state.notice={message:String(message),error};document.querySelector('.status-line')?.remove();
  const box=node('div',{class:'status-line'+(error?' error':''),role:error?'alert':'status'},message);document.body.append(box);
  setTimeout(()=>{if(box.isConnected)box.remove();},error?14000:7000);
}
async function safely(action){
  try{return await action();}
  catch(error){toast(error.message||String(error),true);}
}
async function api(path,{method='GET',body,raw=false}={}){
  const headers={};if(body!==undefined)headers['content-type']='application/json';
  if(method!=='GET'&&method!=='HEAD'&&state.csrf)headers['x-csrf-token']=state.csrf;
  const response=await fetch(path,{method,headers,credentials:'same-origin',...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok){let data;try{data=await response.json();}catch{}const error=new Error(data?.error?.message||'The local operator returned HTTP '+response.status+'.');error.code=data?.error?.code;error.status=response.status;throw error;}
  return raw?response:response.json();
}
function downloadBlob(bytes,filename,mime='application/octet-stream'){
  const value=bytes instanceof Blob?bytes:new Blob([bytes],{type:mime});const url=URL.createObjectURL(value);
  const link=node('a',{href:url,download:filename});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
}
async function downloadRoute(path,filename){const response=await api(path,{raw:true});downloadBlob(await response.blob(),filename);}
function latestDecision(key,detail=state.detail){return array(detail?.decisions).filter(d=>d.itemId===key).at(-1);}
function assetRecords(key){return array(state.detail?.assets||state.workspace?.assets).filter(a=>a.itemId===key&&(!a.editionId||a.editionId===state.editionId));}
function editionStatus(value){return String(value?.status||'PREPARED');}
function running(value){return /ACQUIRING|RUNNING|FETCHING|IN_PROGRESS|RESUMING/.test(editionStatus(value));}
function queryEditions(){return array(state.workspace?.editions).filter(item=>item.queryId===state.queryId);}
function defaultDraft(value){
  return value?{...structuredClone(value),collections:[...array(value.collections)],spatial:value.intersects?'geometry':'bbox',bbox:value.bbox?[...value.bbox]:['','','',''],geometryText:value.intersects?JSON.stringify(value.intersects,null,2):'',cloudCoverMax:value.cloudCoverMax??'',pageSize:value.pageSize??100,maxPages:value.maxPages??10}:
    {name:'Imagery review',collections:[],spatial:'bbox',bbox:['','','',''],geometryText:'',datetime:'',cloudCoverMax:'',pageSize:100,maxPages:10};
}
function currentDraft(){return state.draft||(state.draft=defaultDraft(query()));}
async function refresh({render=true,detail=true}={}){
  const result=await api('/api/state');state.workspace=result.workspace;state.jobs=result.jobs||[];
  if(state.queryId&&!byId(state.workspace.queries,state.queryId)){state.queryId=null;state.editionId=null;state.draft=null;}
  if(!state.queryId&&array(state.workspace.queries).length&&!state.draft){state.queryId=array(state.workspace.queries)[0].id;}
  const editions=queryEditions();
  if(state.editionId&&!byId(editions,state.editionId))state.editionId=null;
  if(!state.editionId&&editions.length)state.editionId=editions.at(-1).id;
  for(const job of state.jobs){
    if(!state.pendingJobs.has(job.id)||job.status==='RUNNING')continue;
    state.pendingJobs.delete(job.id);
    if(job.status==='FAILED'){toast(job.error?.message||'The operation failed. Its saved outcome remains available.',true);continue;}
    if(job.kind==='search-acquire'||job.kind==='search-resume'){
      const saved=job.result?.edition||job.result;
      if(saved?.id){state.editionId=saved.id;if(saved.queryId)state.queryId=saved.queryId;state.tab='scenes';state.page=0;}
    }
    toast(job.kind.replaceAll('-',' ')+' completed.');
  }
  if(detail&&state.editionId)state.detail=await api('/api/editions/'+encodeURIComponent(state.editionId));else if(!state.editionId)state.detail=null;
  if(render&&!state.dialog)renderApp();
}
async function jobAction(path,body,kind){
  const result=await api(path,{method:'POST',body:{...body,operationId:operationId()}});
  state.pendingJobs.add(result.id);state.jobs.push(result);toast(kind+' started. Progress is saved in the workspace.');await refresh();return result;
}
async function selectQuery(id){state.queryId=id;state.editionId=null;state.draft=null;state.detail=null;state.page=0;state.comparison=null;await refresh();}
async function selectEdition(id){state.editionId=id;state.page=0;state.detail=await api('/api/editions/'+encodeURIComponent(id));renderApp();}
function closeDialog(){
  if(!state.dialog)return;const old=state.dialog;state.dialog=null;old.close();old.remove();renderApp();
}
function modal(title,content,actions=[],wide=false){
  if(state.dialog)closeDialog();
  const dialog=node('dialog',{class:wide?'wide':''},node('div',{class:'dialog-header'},node('h2',{},title),button('Close',closeDialog,{class:'quiet small','aria-label':'Close dialog'})),node('div',{class:'dialog-body'},content),node('div',{class:'dialog-footer'},...actions));
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
  document.body.append(dialog);state.dialog=dialog;dialog.showModal();return dialog;
}
function numeric(value){return typeof value==='number'&&Number.isFinite(value);}
function bboxPolygon(value){
  if(!Array.isArray(value)||(value.length!==4&&value.length!==6))return null;
  const west=value[0],south=value[1],east=value[value.length/2],north=value[value.length/2+1];
  if(![west,south,east,north].every(numeric))return null;
  return {type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]};
}
function ringsOf(geometry){
  if(!geometry||!geometry.type)return [];
  if(geometry.type==='Polygon')return geometry.coordinates||[];
  if(geometry.type==='MultiPolygon')return (geometry.coordinates||[]).flat();
  if(geometry.type==='GeometryCollection')return (geometry.geometries||[]).flatMap(ringsOf);
  return [];
}
function unwrapRing(ring,anchor){
  if(!Array.isArray(ring))return [];
  let previous=anchor;const points=[];
  for(const value of ring){if(!Array.isArray(value)||!numeric(value[0])||!numeric(value[1]))continue;let lon=value[0];while(lon-previous>180)lon-=360;while(lon-previous< -180)lon+=360;previous=lon;points.push([lon,value[1]]);}
  if(points.length<3)return [];
  let low=Infinity,high=-Infinity;for(const p of points){low=Math.min(low,p[0]);high=Math.max(high,p[0]);}const center=(low+high)/2;
  const shift=Math.round((anchor-center)/360)*360;return points.map(([x,y])=>[x+shift,y]);
}
function footprint(items,{large=false,queryValue=query()}={}){
  const all=Array.isArray(items)?items:[items];
  const queryBBox=queryValue?.bbox;
  let anchor=0;
  if(queryBBox?.length===4){let east=queryBBox[2];if(east<queryBBox[0])east+=360;anchor=(queryBBox[0]+east)/2;}
  else{const first=all.find(item=>Array.isArray(item.bbox))?.bbox;if(first){let east=first[first.length/2];if(east<first[0])east+=360;anchor=(first[0]+east)/2;}}
  const layers=all.map(item=>{const native=ringsOf(item.geometry);const fallback=native.length===0;return {item,fallback,rings:(fallback?ringsOf(bboxPolygon(item.bbox)):native).map(ring=>unwrapRing(ring,anchor)).filter(ring=>ring.length>2)};});
  const aoi=ringsOf(queryValue?.intersects||bboxPolygon(queryBBox)).map(ring=>unwrapRing(ring,anchor)).filter(ring=>ring.length>2);
  const points=[...layers.flatMap(layer=>layer.rings.flat()),...aoi.flat()];
  if(!points.length)return node('div',{class:'empty'},node('p',{},'No native footprint or bounding box is available.'));
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const [x,y]of points){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  const spanX=Math.max(maxX-minX,.000001),spanY=Math.max(maxY-minY,.000001);
  const width=380,height=220,pad=27,scale=Math.min((width-2*pad)/spanX,(height-2*pad)/spanY);
  const offsetX=(width-spanX*scale)/2,offsetY=(height-spanY*scale)/2;
  const project=([x,y])=>[(offsetX+(x-minX)*scale).toFixed(2),(height-offsetY-(y-minY)*scale).toFixed(2)];
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 '+width+' '+height);svg.setAttribute('class','footprint'+(large?' large':''));svg.setAttribute('role','img');svg.setAttribute('aria-label','Saved scene geometry and area of interest in longitude and latitude');
  const add=(name,props,content)=>{const element=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [key,value]of Object.entries(props))element.setAttribute(key,String(value));if(content)element.textContent=content;svg.append(element);return element;};
  for(let step=0;step<=4;step++){const x=pad+(width-2*pad)*step/4,y=pad+(height-2*pad)*step/4;add('line',{x1:x,y1:pad,x2:x,y2:height-pad,class:'grid-line'});add('line',{x1:pad,y1:y,x2:width-pad,y2:y,class:'grid-line'});}
  const path=rings=>rings.map(ring=>'M'+ring.map(point=>project(point).join(',')).join(' L')+' Z').join(' ');
  for(const layer of layers){if(!layer.rings.length)continue;const el=add('path',{d:path(layer.rings),class:'scene-shape'+(layer.fallback?' fallback':''),'fill-rule':'evenodd'});const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=(layer.item.collection||'')+' / '+layer.item.id+(layer.fallback?' — bounding box':' — native geometry');el.append(title);}
  if(aoi.length)add('path',{d:path(aoi),class:'aoi-shape','fill-rule':'evenodd'});
  const wrap=lon=>((lon+180)%360+360)%360-180;
  add('text',{x:8,y:height-9,class:'map-text'},wrap(minX).toFixed(3)+'°, '+minY.toFixed(3)+'°');
  add('text',{x:width-8,y:14,'text-anchor':'end',class:'map-text'},wrap(maxX).toFixed(3)+'°, '+maxY.toFixed(3)+'°');
  return svg;
}
function collectionFor(item){return array(state.workspace?.collections).find(collection=>collection.id===item.collection);}
function paginationControls(total){
  const pages=Math.max(1,Math.ceil(total/state.pageSize));state.page=Math.min(state.page,pages-1);
  return node('div',{class:'actions'},node('span',{class:'small muted'},total?'Showing '+(state.page*state.pageSize+1)+'–'+Math.min((state.page+1)*state.pageSize,total)+' of '+total+' saved scenes':'0 saved scenes'),button('Previous',()=>{state.page=Math.max(0,state.page-1);renderApp();},{class:'small',disabled:state.page===0}),button('Next',()=>{state.page=Math.min(pages-1,state.page+1);renderApp();},{class:'small',disabled:state.page>=pages-1}));
}

function rememberFocus(){
  const element=document.activeElement;if(!element?.id||!root.contains(element))return null;
  return {id:element.id,start:element.selectionStart,end:element.selectionEnd};
}
function restoreFocus(saved){
  if(!saved)return;const element=document.getElementById(saved.id);if(!element)return;
  element.focus({preventScroll:true});try{if(saved.start!=null)element.setSelectionRange(saved.start,saved.end);}catch{}
}
function renderApp(){
  if(!state.workspace)return;
  const savedFocus=rememberFocus(),workspace=state.workspace;
  const header=node('header',{class:'app-header'},node('div',{class:'brand'},node('span',{class:'eyebrow'},'Scene selection and delivery'),node('h1',{},'Earth Search operations')),node('div',{class:'header-actions'},button('Refresh saved state',()=>refresh(),{class:'small'}),button('Import handover',openImport,{class:'small'})));
  const bar=node('div',{class:'workspace-bar'},node('span',{},workspace.title||'Satellite imagery workspace'),node('span',{},'Revision '+workspace.revision+' · '+workspace.id));
  const list=node('div',{class:'query-list'});
  for(const value of array(workspace.queries)){
    const editions=array(workspace.editions).filter(item=>item.queryId===value.id);
    list.append(button('',()=>selectQuery(value.id),{class:'query-card'+(state.queryId===value.id?' selected':''),'aria-pressed':state.queryId===value.id}),);
    const card=list.lastElementChild;card.append(node('strong',{},value.name||value.id),node('span',{class:'meta'},array(value.collections).join(', ')||'No collection selected'),node('span',{class:'meta'},editions.length+' saved '+(editions.length===1?'edition':'editions')));
  }
  if(!array(workspace.queries).length)list.append(node('p',{class:'help'},'Save a query to begin a scene review.'));
  const sidebar=node('aside',{class:'sidebar','aria-label':'Saved searches'},node('div',{class:'sidebar-header'},node('h3',{},'Saved queries'),button('New',()=>{state.queryId=null;state.editionId=null;state.detail=null;state.draft=defaultDraft(null);state.tab='search';renderApp();},{class:'small'})),list,node('div',{class:'sidebar-footer'},externalLink('https://element84.com/earth-search/','Earth Search by Element 84'),node('p',{},'Collection rights and source metadata travel with the saved review.')));
  const title=node('div',{class:'workspace-title'},node('div',{},node('h2',{},query()?.name||'Prepare a scene query'),node('p',{class:'muted'},query()?array(query().collections).join(' · '):'Choose a collection, an area and an observation window.')),query()?badge(queryEditions().length+' editions'):null);
  const tabs=node('nav',{class:'tabs','aria-label':'Workspace views'});
  for(const [key,label]of [['search','Catalog & query'],['scenes','Scenes & assets'],['compare','Compare editions'],['review','Selections & handover']]){
    tabs.append(button(label,()=>{state.tab=key;renderApp();},{role:'tab','aria-selected':state.tab===key}));
  }
  const main=node('main',{class:'workspace',id:'main'},title,tabs);
  if(state.tab==='search')main.append(renderSearch());
  if(state.tab==='scenes')main.append(renderScenes());
  if(state.tab==='compare')main.append(renderCompare());
  if(state.tab==='review')main.append(renderSelections());
  const jobs=renderJobs();if(jobs)main.append(jobs);
  main.append(node('p',{class:'footer-note'},'Scene footprints use the saved STAC geometry. Asset retrieval and selection decisions remain attached to their original catalog and scene edition.'));
  root.replaceChildren(header,bar,node('div',{class:'app-shell'},sidebar,main));
  restoreFocus(savedFocus);
}
function renderJobs(){
  const visible=state.jobs.filter(job=>job.status==='RUNNING'||state.pendingJobs.has(job.id)||job.status==='FAILED').slice(-8);
  if(!visible.length)return null;
  return node('section',{class:'panel','aria-label':'Current operations'},node('h3',{},'Operations'),node('div',{class:'job-list'},visible.map(job=>node('div',{class:'job-row'},node('div',{},node('strong',{},job.kind.replaceAll('-',' ')),node('p',{},job.error?.message||'Started '+job.createdAt)),badge(job.status)))));
}
function collectionPanel(){
  const collections=array(state.workspace.collections),draft=currentDraft();
  const panel=node('section',{class:'panel'},node('div',{class:'panel-header'},node('div',{},node('h3',{},'Catalog and collection rights'),node('p',{class:'muted'},state.workspace.endpoint)),button(collections.length?'Refresh catalog':'Read catalog',()=>jobAction('/api/discover',{expectedRevision:state.workspace.revision},'Catalog discovery'),{class:collections.length?'small':'primary'})));
  if(!collections.length){panel.append(node('div',{class:'empty'},node('h3',{},'No saved catalog yet'),node('p',{},'Read the catalog to see its current collections, coverage and license references.')));return panel;}
  const grid=node('div',{class:'collection-grid'});
  for(const collection of collections){
    const selected=draft.collections.includes(collection.id);
    const card=node('article',{class:'collection-card'+(selected?' selected':'')},node('label',{class:'check'},node('input',{type:'checkbox',checked:selected,'aria-label':'Use '+collection.id,onchange:event=>{const current=currentDraft();current.collections=event.target.checked?[...new Set([...current.collections,collection.id])]:current.collections.filter(id=>id!==collection.id);renderApp();}}),node('h4',{},collection.title||collection.id)),node('code',{},collection.id),node('p',{},String(collection.description||'Collection description was not provided.').slice(0,320)),badge(collection.license||'License not provided'));
    const rights=array(collection.links).filter(link=>link.rel==='license'||link.rel==='cite-as'||link.rel==='about');
    if(rights.length)card.append(node('div',{class:'actions'},rights.map(link=>externalLink(link.href,link.title||link.rel))));
    card.append(jsonDetails('Collection coverage and metadata',collection));grid.append(card);
  }
  panel.append(grid,sourceLine({sha:state.workspace.catalog?.sha256,receivedAt:state.workspace.catalog?.receivedAt}));
  return panel;
}
function draftInput(id,type,property,{placeholder,step,min,max,required=false}={}){
  const draft=currentDraft();
  return node('input',{id,type,value:draft[property]??'',placeholder,step,min,max,required,oninput:event=>{currentDraft()[property]=event.target.value;}});
}
function renderSearch(){
  const wrapper=node('div',{class:'stack'}),draft=currentDraft();
  const form=node('form',{id:'query-form',onsubmit:event=>{event.preventDefault();void safely(saveQuery);}});
  const fields=node('div',{class:'fields'});
  fields.append(node('div',{class:'field field-wide'},field('Query name',draftInput('query-name','text','name',{required:true}))),node('div',{class:'field field-wide'},field('Selected collections',node('input',{id:'query-collections',type:'text',value:draft.collections.join(', '),readonly:true}),'Select one or more collections in the saved catalog below.')));
  const spatial=node('select',{id:'query-spatial',value:draft.spatial,onchange:event=>{currentDraft().spatial=event.target.value;renderApp();}},node('option',{value:'bbox'},'Bounding box'),node('option',{value:'geometry'},'GeoJSON geometry'));
  fields.append(node('div',{class:'field field-wide'},field('Area of interest',spatial)));
  if(draft.spatial==='bbox'){
    const bbox=node('div',{class:'fields four'});
    for(const [index,label]of ['West longitude','South latitude','East longitude','North latitude'].entries()){
      bbox.append(field(label,node('input',{id:'query-bbox-'+index,type:'number',step:'any',min:index%2?-90:-180,max:index%2?90:180,value:draft.bbox?.[index]??'',required:true,oninput:event=>{currentDraft().bbox[index]=event.target.value;}})));
    }
    fields.append(node('div',{class:'field field-wide'},bbox,node('p',{class:'help'},'Longitude comes before latitude. A west value greater than the east value defines an area crossing the antimeridian.')));
  }else{
    fields.append(node('div',{class:'field field-wide'},field('GeoJSON Geometry',node('textarea',{id:'query-geometry',rows:7,value:draft.geometryText,required:true,oninput:event=>{currentDraft().geometryText=event.target.value;}}),'Supply a Geometry object in longitude/latitude coordinates.')));
  }
  fields.append(node('div',{class:'field field-wide'},field('Observation time or interval',draftInput('query-datetime','text','datetime',{placeholder:'2026-01-01T00:00:00Z/2026-02-01T00:00:00Z',required:true}),'Use explicit RFC3339 timestamps. Open intervals may use ../end or start/.. .')),field('Maximum cloud cover (%)',draftInput('query-cloud','number','cloudCoverMax',{step:'any',min:0,max:100}),'Leave empty to omit the cloud-cover filter.'),field('Scenes per provider page',draftInput('query-page-size','number','pageSize',{min:1,step:1,required:true})),field('Maximum provider pages',draftInput('query-max-pages','number','maxPages',{min:1,step:1,required:true}),'The review includes this declared pagination extent.'));
  form.append(fields,node('div',{class:'actions'},node('button',{type:'submit',class:'primary'},query()?'Save query changes':'Save query'),query()?button('Review search request',reviewSearch):null));
  const editor=node('section',{class:'panel'},node('div',{class:'panel-header'},node('div',{},node('h3',{},query()?'Saved query':'New query'),node('p',{class:'muted'},'Save the complete area, time and pagination choices, then review the provider request.'))),form);
  if(query())editor.append(jsonDetails('Saved query',query()));
  wrapper.append(editor,collectionPanel());return wrapper;
}
async function saveQuery(){
  const draft=currentDraft();
  if(!draft.collections.length)throw new Error('Select at least one saved collection.');
  const payload={...(query()?{id:state.queryId}:{}),name:draft.name,collections:[...draft.collections],datetime:draft.datetime,pageSize:Number(draft.pageSize),maxPages:Number(draft.maxPages),expectedRevision:state.workspace.revision};
  if(draft.spatial==='geometry'){try{payload.intersects=JSON.parse(draft.geometryText);}catch{throw new Error('The area of interest must be valid GeoJSON.');}}
  else{if(draft.bbox.some(value=>value===''))throw new Error('Enter all four bounding-box coordinates.');payload.bbox=draft.bbox.map(Number);}
  if(draft.cloudCoverMax!==''&&draft.cloudCoverMax!=null)payload.cloudCoverMax=Number(draft.cloudCoverMax);
  const result=await api('/api/queries',{method:'POST',body:payload});const saved=result.query||result;
  if(!saved?.id)throw new Error('The query save returned no saved identity.');
  state.queryId=saved.id;state.draft=null;state.editionId=null;await refresh();toast('Query saved. Review the request to acquire its scenes.');
}
async function reviewSearch(){
  if(!query())throw new Error('Save a query before reviewing its search.');
  const review=await api('/api/search/review',{method:'POST',body:{queryId:state.queryId}});
  const request=review.request||{};
  const content=node('div',{class:'stack'},node('div',{class:'notice'},node('strong',{},'Reviewed search'),node('p',{},'This acquisition uses the saved query and its declared pagination. The review remains attached to this exact request.')),node('dl',{class:'summary-list'},detailRow('Saved query',query().name),detailRow('Collections',array(query().collections).join(', ')),detailRow('Observation interval',query().datetime),detailRow('Pagination',query().pageSize+' scenes per page · at most '+query().maxPages+' pages'),detailRow('Review identity',node('code',{},review.id))),node('pre',{},JSON.stringify(request,null,2)));
  modal('Review scene acquisition',content,[button('Back',closeDialog),button('Acquire reviewed scenes',async()=>{closeDialog();state.tab='scenes';await jobAction('/api/search/acquire',{reviewId:review.id},'Scene acquisition');},{class:'primary'})]);
}
function editionPicker(){
  const values=queryEditions();
  if(!values.length)return null;
  const select=node('select',{id:'active-edition',value:state.editionId,onchange:event=>void safely(()=>selectEdition(event.target.value))},values.map(value=>node('option',{value:value.id},(value.completedAt||value.startedAt||value.id)+' · '+editionStatus(value)+' · '+(value.itemsCount??'?')+' scenes')));
  return node('div',{class:'edition-select'},field('Saved scene edition',select),button('Review another acquisition',reviewSearch,{class:'small'}));
}
function editionSummary(){
  const value=state.detail?.edition||edition();
  if(!value)return null;
  const panel=node('section',{class:'panel'},node('div',{class:'panel-header'},node('div',{},node('h3',{},'Saved acquisition'),node('p',{class:'muted'},value.id)),badge(editionStatus(value))),node('div',{class:'metrics'},node('div',{class:'metric'},node('strong',{},value.itemsCount??array(state.detail?.items).length),node('span',{},'Retained scenes')),node('div',{class:'metric'},node('strong',{},value.pagesCount??'—'),node('span',{},'Captured pages')),node('div',{class:'metric'},node('strong',{},array(state.detail?.assets).filter(a=>a.status==='COMPLETE'||a.status==='SAVED').length),node('span',{},'Acquired assets')),node('div',{class:'metric'},node('strong',{},new Set(array(state.detail?.decisions).map(d=>d.itemId)).size),node('span',{},'Reviewed scene identities'))));
  const status=editionStatus(value);
  if(running(value))panel.append(node('div',{class:'notice'},'The provider acquisition is running. Completed pages remain part of this saved edition.'),button('Cancel acquisition',async()=>{await api('/api/search/cancel',{method:'POST',body:{editionId:value.id}});await refresh();toast('Cancellation requested for this saved acquisition.');},{class:'small'}));
  else if(/PARTIAL|INTERRUPTED|CANCELLED|CANCELED|FAILED|PAUSED/.test(status))panel.append(node('div',{class:'notice'},node('strong',{},'Coverage requires attention'),node('p',{},text(value.coverage||value.error||'The saved acquisition ended before its declared request completed.'))),button('Resume saved acquisition',()=>jobAction('/api/search/resume',{editionId:value.id},'Acquisition continuation'),{class:'small'}));
  if(value.coverage)panel.append(jsonDetails('Declared and captured coverage',value.coverage));
  panel.append(sourceLine({sha:value.digest||value.sha256,receivedAt:value.completedAt||value.startedAt}));return panel;
}

function sceneTime(item){
  const p=item.properties||{};return p.datetime||[p.start_datetime,p.end_datetime].filter(Boolean).join(' / ')||'Not provided';
}
function filteredScenes(){
  const input=state.filter.toLowerCase().trim();
  return array(state.detail?.items).filter(item=>{
    const key=itemKey(item),decision=latestDecision(key);
    if(state.statusFilter==='UNREVIEWED'&&decision)return false;
    if(!['all','UNREVIEWED'].includes(state.statusFilter)&&decision?.status!==state.statusFilter)return false;
    return !input||[item.id,item.collection,sceneTime(item),decision?.actor,decision?.note].some(value=>String(value||'').toLowerCase().includes(input));
  });
}
function sceneDecisionBadge(item){
  const decision=latestDecision(itemKey(item));return badge(decision?.status||'UNREVIEWED',decision?.status==='SELECTED');
}
function renderScenes(){
  const section=node('div');
  if(!query()){section.append(node('div',{class:'empty'},node('h3',{},'Save a scene query first'),node('p',{},'Use Catalog & query to define the collection, area, time and declared search extent.')));return section;}
  section.append(editionPicker());
  if(!state.editionId){section.append(node('section',{class:'panel'},node('div',{class:'empty'},node('h3',{},'Ready to review the saved search'),node('p',{},'The provider request is reviewed before any scene acquisition.')),button('Review search request',reviewSearch,{class:'primary'})));return section;}
  section.append(editionSummary());
  const scenes=filteredScenes(),controls=node('div',{class:'fields'},field('Filter saved scene results',node('input',{id:'scene-filter',type:'search',value:state.filter,placeholder:'Collection, scene, date or staff note',oninput:event=>{state.filter=event.target.value;state.page=0;renderApp();}})),field('Staff selection status',node('select',{id:'scene-status-filter',value:state.statusFilter,onchange:event=>{state.statusFilter=event.target.value;state.page=0;renderApp();}},[['all','All scenes'],['UNREVIEWED','Unreviewed'],['SELECTED','Selected'],['REJECTED','Rejected'],['REVIEW','Needs review']].map(([value,label])=>node('option',{value},label)))));
  const panel=node('section',{class:'panel'},node('div',{class:'panel-header'},node('div',{},node('h3',{},'Scenes'),node('p',{class:'muted'},'The table and outline grid use the same retained STAC Features.')),node('div',{class:'actions'},button('Table',()=>{state.mode='table';renderApp();},{class:'small','aria-pressed':state.mode==='table'}),button('Footprint grid',()=>{state.mode='grid';renderApp();},{class:'small','aria-pressed':state.mode==='grid'}))),controls);
  const pagination=paginationControls(scenes.length);panel.append(pagination);
  const slice=scenes.slice(state.page*state.pageSize,(state.page+1)*state.pageSize);
  if(!slice.length)panel.append(node('div',{class:'empty'},node('h3',{},'No scenes in this view'),node('p',{},array(state.detail?.items).length?'Change the local filter or review another saved edition.':'The saved acquisition has no returned scene Features. Its coverage and provider result remain above.')));
  else if(state.mode==='grid'){
    const grid=node('div',{class:'scene-grid'});
    for(const item of slice){const p=item.properties||{};grid.append(node('article',{class:'scene-card'},footprint(item),node('div',{class:'footprint-caption'},ringsOf(item.geometry).length?'Native scene geometry · dashed area of interest':'Scene bounding box · dashed area of interest'),node('div',{class:'scene-content'},node('h3',{},item.id),node('p',{class:'muted'},item.collection),node('div',{class:'scene-meta'},node('div',{},'Observation time',node('strong',{},sceneTime(item))),node('div',{},'Cloud cover',node('strong',{},percent(p['eo:cloud_cover'])))),sceneDecisionBadge(item),node('div',{class:'actions'},button('Scene & assets',()=>openScene(item),{class:'small'}),button('Record selection',()=>openDecision(item),{class:'small'})))));}
    panel.append(grid);
  }else{
    const table=node('table',{},node('thead',{},node('tr',{},['Scene / collection','Observation time','Cloud cover','Assets','Selection','Actions'].map(name=>node('th',{},name)))));
    const body=node('tbody');
    for(const item of slice)body.append(node('tr',{},node('td',{},node('code',{},item.id),node('span',{class:'small muted'},item.collection)),node('td',{},sceneTime(item)),node('td',{class:'nowrap'},percent(item.properties?.['eo:cloud_cover'])),node('td',{},Object.keys(item.assets||{}).length),node('td',{},sceneDecisionBadge(item)),node('td',{},node('div',{class:'table-actions'},button('Details',()=>openScene(item),{class:'small'}),button('Select / review',()=>openDecision(item),{class:'small'})))));
    table.append(body);panel.append(node('div',{class:'table-wrap'},table));
  }
  section.append(panel);return section;
}
function safeAssetDownload(record){return node('a',{href:'/api/assets/'+encodeURIComponent(record.id)+'/download',download:record.filename||record.assetKey||'stac-asset'},'Download saved asset');}
async function previewAsset(record,container){
  const response=await api('/api/assets/'+encodeURIComponent(record.id)+'/preview',{raw:true});
  const blob=await response.blob();
  if(!['image/png','image/jpeg','image/webp','image/gif'].includes(blob.type.split(';')[0]))throw new Error('This saved asset is available as a download; its format does not have a native browser image preview.');
  const url=URL.createObjectURL(blob);
  const img=node('img',{class:'asset-preview',src:url,alt:'Acquired '+(record.assetKey||'scene image')+' from the saved source asset'});
  container.append(img);state.dialog?.addEventListener('close',()=>URL.revokeObjectURL(url),{once:true});
}
function openScene(item){
  const editionId=state.editionId,detailSnapshot=state.detail,key=itemKey(item),collection=collectionFor(item),records=assetRecords(key);
  const body=node('div',{class:'stack'},node('div',{class:'two-col'},node('div',{},footprint(item,{large:true}),node('p',{class:'help'},ringsOf(item.geometry).length?'Native STAC scene geometry; the dashed outline is the saved query area.':'A scene bounding box is shown because no polygon geometry was provided.')),node('dl',{class:'summary-list'},detailRow('Collection',item.collection),detailRow('Native scene ID',node('code',{},item.id)),detailRow('Observation time',sceneTime(item)),detailRow('Cloud cover',percent(item.properties?.['eo:cloud_cover'])),detailRow('Collection license',collection?.license),detailRow('Bounding box',item.bbox),detailRow('Selection',latestDecision(key,detailSnapshot)?.status||'UNREVIEWED'))));
  if(collection)body.append(node('div',{class:'notice'},node('strong',{},'Collection rights'),node('p',{},collection.license||'License metadata was not provided.'),array(collection.links).filter(link=>link.rel==='license').map(link=>externalLink(link.href,link.title||'Read source license'))));
  const assets=node('section',{},node('h3',{},'Scene assets'));
  for(const [assetKey,asset]of Object.entries(item.assets||{})){
    const captured=records.filter(record=>record.assetKey===assetKey);
    const card=node('div',{class:'asset-info'},node('h4',{},asset.title||assetKey),node('dl',{class:'summary-list'},detailRow('Asset key',node('code',{},assetKey)),detailRow('Source type',asset.type),detailRow('Roles',array(asset.roles).join(', ')||'Not provided'),detailRow('Declared size',byteSize(asset['file:size'])),detailRow('Original href',node('code',{},asset.href)),detailRow('Storage metadata',asset['storage:requester_pays']??item.properties?.['storage:requester_pays']??'Not provided')));
    const actions=node('div',{class:'actions'},button('Review asset acquisition',()=>openAssetReview(item,assetKey,editionId),{class:'small'}));
    for(const record of captured){
      card.append(node('div',{class:'source-line'},badge(record.status),node('span',{},byteSize(typeof record.bytes==='number'?record.bytes:record.sizeBytes)),node('code',{},record.sha256||'No captured hash')));
      if(['COMPLETE','SAVED','AVAILABLE'].includes(String(record.status))){
        actions.append(safeAssetDownload(record));
        if(['image/png','image/jpeg','image/webp','image/gif'].includes(String(record.mime||'').split(';')[0]))actions.append(button('Preview saved image',event=>previewAsset(record,card),{class:'small'}));
      }
    }
    card.append(actions,jsonDetails('Original asset metadata',asset));assets.append(card);
  }
  body.append(assets,jsonDetails('Original STAC Feature',item));
  modal('Scene: '+item.id,body,[button('Close',closeDialog),button('Record selection',()=>openDecision(item,{editionId,detail:detailSnapshot}),{class:'primary'})],true);
}
async function openAssetReview(item,assetKey,editionId=state.editionId){
  const input=node('input',{id:'asset-byte-limit',type:'number',min:1,max:2147483648,step:1,value:16777216,required:true});
  const initial=node('div',{class:'stack'},node('dl',{class:'summary-list'},detailRow('Collection',item.collection),detailRow('Scene',node('code',{},item.id)),detailRow('Selected asset',assetKey),detailRow('Original href',node('code',{},item.assets?.[assetKey]?.href))),field('Maximum bytes for this asset',input,'This explicit ceiling is included in the acquisition review. The source supports up to 2 GiB per selected asset.'));
  modal('Prepare asset acquisition',initial,[button('Back',()=>openScene(item)),button('Review exact asset request',async()=>{
    const maxBytes=Number(input.value);if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>2147483648)throw new Error('Choose a positive whole-byte ceiling up to 2147483648.');
    const review=await api('/api/assets/review',{method:'POST',body:{editionId,itemId:itemKey(item),assetKey,maxBytes}});
    const details=node('div',{class:'stack'},node('dl',{class:'summary-list'},detailRow('Selected asset',assetKey),detailRow('Reviewed href',node('code',{},review.href)),detailRow('Source type',review.type),detailRow('Roles',array(review.roles).join(', ')),detailRow('Collection rights',review.license),detailRow('Requester pays',review.requesterPays===true?'Yes':review.requesterPays===false?'No':'Not provided'),detailRow('Maximum transfer',byteSize(review.maxBytes)),detailRow('Review identity',node('code',{},review.id))),node('div',{class:'notice'},review.eligible?'The source has accepted this public asset for the reviewed acquisition.':text(review.reason||review.error||'This asset’s storage or rights metadata requires a different source-access path.')),jsonDetails('Complete asset review',review));
    modal('Review selected asset',details,[button('Back',()=>openAssetReview(item,assetKey,editionId)),button('Acquire reviewed asset',async()=>{closeDialog();await jobAction('/api/assets/acquire',{reviewId:review.id},'Asset acquisition');},{class:'primary',disabled:review.eligible!==true})]);
  },{class:'primary'})]);
}
function openDecision(item,{editionId=state.editionId,detail=state.detail}={}){
  const key=itemKey(item),previous=latestDecision(key,detail),revision=state.workspace.revision;
  const actor=node('input',{id:'decision-actor',type:'text',value:previous?.actor||'',required:true,autocomplete:'name'});
  const status=node('select',{id:'decision-status',value:previous?.status||'REVIEW'},node('option',{value:'SELECTED'},'Selected for delivery'),node('option',{value:'REVIEW'},'Needs further review'),node('option',{value:'REJECTED'},'Rejected for this work'));
  const note=node('textarea',{id:'decision-note',rows:5,value:previous?.note||'',placeholder:'Record the reason, intended use or next staff instruction.'});
  const selected=new Set(array(previous?.assetKeys)),assetChoices=node('fieldset',{},node('legend',{},'Assets attached to this selection'));
  for(const [assetKey,asset]of Object.entries(item.assets||{}))assetChoices.append(node('label',{class:'check'},node('input',{type:'checkbox',checked:selected.has(assetKey),onchange:event=>{if(event.target.checked)selected.add(assetKey);else selected.delete(assetKey);}}),node('span',{},asset.title||assetKey,node('span',{class:'muted'},' · '+assetKey))));
  const content=node('form',{id:'decision-form',onsubmit:event=>event.preventDefault()},node('dl',{class:'summary-list'},detailRow('Collection',item.collection),detailRow('Native scene',node('code',{},item.id)),detailRow('Source edition',node('code',{},editionId))),node('div',{class:'fields'},field('Assigned reviewer',actor),field('Selection',status),node('div',{class:'field field-wide'},field('Staff note',note))),assetChoices);
  modal('Record scene selection',content,[button('Cancel',closeDialog),button('Save selection',async()=>{
    if(!actor.value.trim())throw new Error('Enter the reviewer assigned to this scene.');
    await api('/api/decisions',{method:'POST',body:{editionId,itemId:key,status:status.value,actor:actor.value.trim(),note:note.value,assetKeys:[...selected],expectedRevision:revision}});
    closeDialog();await refresh();toast('Selection saved against the original scene edition.');
  },{class:'primary'})]);
}
function renderCompare(){
  const section=node('section',{class:'panel'},node('div',{class:'panel-header'},node('div',{},node('h3',{},'Compare retained scene editions'),node('p',{class:'muted'},'Collection and scene identity are preserved. Changed metadata is reported under that same identity.'))));
  const values=array(state.workspace.editions);
  if(values.length<2){section.append(node('div',{class:'empty'},node('h3',{},'Two saved editions are needed'),node('p',{},'Acquire another reviewed search, then compare the original retained results.')));return section;}
  const ids=state.comparisonIds||[values.at(-2).id,values.at(-1).id];
  const choice=(id,value)=>node('select',{id,value},values.map(e=>node('option',{value:e.id},(byId(state.workspace.queries,e.queryId)?.name||e.queryId)+' · '+(e.completedAt||e.startedAt||e.id)+' · '+e.id)));
  const left=choice('compare-left',ids[0]),right=choice('compare-right',ids[1]);
  section.append(node('div',{class:'fields'},field('Earlier / left edition',left),field('Later / right edition',right)),node('div',{class:'actions'},button('Compare saved editions',async()=>{
    if(left.value===right.value)throw new Error('Select two different editions.');
    state.comparisonIds=[left.value,right.value];state.comparison=await api('/api/compare?left='+encodeURIComponent(left.value)+'&right='+encodeURIComponent(right.value));renderApp();
  },{class:'primary'})));
  if(!state.comparison)return section;
  const result=state.comparison;
  const groups=[['added','Added scenes'],['removed','Removed scenes'],['changed','Changed metadata'],['unchanged','Unchanged scenes']];
  section.append(node('div',{class:'metrics'},groups.map(([key,label])=>node('div',{class:'metric'},node('strong',{},typeof result[key]==='number'?result[key]:array(result[key]).length),node('span',{},label)))));
  if(result.comparable===false||result.comparableQuery===false)section.append(node('div',{class:'notice'},text(result.reason||'These editions use different saved search inputs. Scene changes may reflect their different search coverage.')));
  if(result.leftCoverage||result.rightCoverage)section.append(jsonDetails('Coverage of the compared editions',{left:result.leftCoverage,right:result.rightCoverage}));
  for(const [key,label]of groups){
    const rows=array(result[key]);if(!rows.length)continue;
    const table=node('table',{},node('thead',{},node('tr',{},node('th',{},'Scene identity'),node('th',{},'Retained change'))),node('tbody',{},rows.map(row=>node('tr',{},node('td',{},node('code',{},typeof row==='string'?row:row.itemId||row.key||[row.collection,row.nativeItemId||row.id].filter(Boolean).join(' / '))),node('td',{},typeof row==='string'?label:jsonDetails('Change metadata',row))))));
    section.append(node('h3',{},label),node('div',{class:'table-wrap slim'},table));
  }
  section.append(jsonDetails('Complete comparison',result));return section;
}
function renderSelections(){
  const wrapper=node('div'),values=queryEditions();
  wrapper.append(editionPicker());
  const selections=node('section',{class:'panel'},node('div',{class:'panel-header'},node('div',{},node('h3',{},'Staff selections'),node('p',{class:'muted'},'The current selection for each retained scene is shown with its source edition.'))));
  if(!state.editionId){selections.append(node('div',{class:'empty'},node('p',{},'Acquire and review an edition to build a handover.')));wrapper.append(selections);return wrapper;}
  const decisions=array(state.detail?.decisions),latest=new Map();for(const decision of decisions)latest.set(decision.itemId,decision);
  if(!latest.size)selections.append(node('div',{class:'empty'},node('h3',{},'No staff selection yet'),node('p',{},'Open a scene and record its reviewer, selection, intended assets and note.')));
  else{
    const table=node('table',{},node('thead',{},node('tr',{},['Scene / collection','Selection','Assigned reviewer','Note / selected assets'].map(label=>node('th',{},label))))),body=node('tbody');
    for(const decision of latest.values()){
      const item=array(state.detail?.items).find(i=>itemKey(i)===decision.itemId);
      body.append(node('tr',{},node('td',{},node('code',{},item?.id||decision.nativeItemId||decision.itemId),node('span',{class:'small muted'},item?.collection||decision.collection||''),item?button('Edit selection',()=>openDecision(item),{class:'small quiet'}):null),node('td',{},badge(decision.status,decision.status==='SELECTED')),node('td',{},decision.actor||'Unassigned'),node('td',{},node('p',{class:'selection-note'},decision.note||'No staff note'),node('span',{class:'small muted'},array(decision.assetKeys).join(', ')))));
    }
    table.append(body);selections.append(node('div',{class:'table-wrap'},table),jsonDetails('Complete decision history',decisions));
  }
  const report=node('section',{class:'panel'},node('h3',{},'Operations report'),node('p',{class:'muted'},'Export the selected scene edition with its original source metadata and saved staff selections.'),node('div',{class:'actions'},['html','csv','json'].map(format=>button('Download '+format.toUpperCase(),()=>downloadRoute('/api/report?editionId='+encodeURIComponent(state.editionId)+'&format='+format,'stac-operations.'+format)))));
  const scope=node('select',{id:'handover-scope'},node('option',{value:'all'},'All saved editions in this workspace'),node('option',{value:'query'},'All editions of this saved query'),node('option',{value:'edition'},'Current edition'));
  const include=node('input',{id:'handover-assets',type:'checkbox',checked:true});
  const handover=node('section',{class:'panel'},node('h3',{},'Complete receiving handover'),node('p',{class:'muted'},'The handover carries source identities, work choices, decision history and content-digested relative files. The receiver keeps its own workspace identity.'),node('div',{class:'fields'},field('Handover contents',scope)),node('label',{class:'check'},include,node('span',{},'Include acquired asset files')),node('div',{class:'actions'},button('Export handover',async()=>{
    const editionIds=scope.value==='edition'?[state.editionId]:scope.value==='query'?values.map(e=>e.id):undefined;
    const bundle=await api('/api/handover/export',{method:'POST',body:{...(editionIds?{editionIds}:{}),includeAssets:include.checked}});
    downloadBlob(JSON.stringify(bundle,null,2)+'\n','stac-workspace-handover.json','application/json');toast('Complete handover prepared from the saved workspace.');
  },{class:'primary'}),button('Import into this workspace',openImport)));
  wrapper.append(selections,report,handover);return wrapper;
}
function openImport(){
  const file=node('input',{id:'handover-file',type:'file',accept:'.json,application/json',required:true});
  const content=node('div',{class:'stack'},node('p',{},'Choose a complete STAC handover. Its source edition and scene identities are preserved while this receiving workspace keeps its own identity.'),field('Saved handover JSON',file,'This browser server accepts imports up to '+byteSize(state.maxRequestBytes)+'. Larger retained bundles can be imported with the original CLI.'),node('dl',{class:'summary-list'},detailRow('Receiving workspace',state.workspace?.title),detailRow('Receiving identity',node('code',{},state.workspace?.id||''))));
  modal('Import receiving handover',content,[button('Cancel',closeDialog),button('Import complete handover',async()=>{
    const selected=file.files?.[0];if(!selected)throw new Error('Choose a saved handover JSON file.');
    if(selected.size>state.maxRequestBytes)throw new Error('The chosen file exceeds this browser server’s configured import limit. Use the original CLI for this bundle.');
    let bundle;try{bundle=JSON.parse(await selected.text());}catch{throw new Error('The chosen handover is not valid JSON.');}
    await api('/api/handover/import',{method:'POST',body:bundle});closeDialog();state.queryId=null;state.editionId=null;state.draft=null;await refresh();toast('Handover imported with its original scene identities and files.');
  },{class:'primary'})]);
}
async function establishSession(){
  const fragment=new URLSearchParams(location.hash.slice(1)),secret=fragment.get('session');
  if(secret){history.replaceState(null,'',location.pathname+location.search);const result=await api('/api/session',{method:'POST',body:{token:secret}});state.csrf=result.csrfToken;state.maxRequestBytes=result.maxRequestBytes;return;}
  const result=await api('/api/session');state.csrf=result.csrfToken;state.maxRequestBytes=result.maxRequestBytes;
}
async function boot(){
  try{await establishSession();await refresh();}
  catch(error){root.replaceChildren(node('main',{class:'loading'},node('h1',{},'Open the local operator session'),node('p',{},error.message),node('p',{class:'muted'},'Use the complete local URL printed by the STAC server. Its session key is retained only by this running operator.')));return;}
  setInterval(()=>{if(document.visibilityState!=='visible')return;if(state.jobs.some(job=>job.status==='RUNNING')||state.pendingJobs.size)void refresh().catch(error=>toast(error.message,true));},1500);
}
void boot();
