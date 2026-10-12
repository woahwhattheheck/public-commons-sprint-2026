// MIT. WFS operations browser; all source and customer work uses the original application.
const $=id=>document.getElementById(id), all=selector=>[...document.querySelectorAll(selector)];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const stringify=value=>JSON.stringify(value,null,2), short=value=>String(value??'').slice(0,12);
const text=value=>value===null||value===undefined?'—':typeof value==='object'?JSON.stringify(value):String(value);
const id=prefix=>prefix+'-'+crypto.randomUUID();
let state=null,working=false,refreshing=null,service=null,schema=null,order=null,orderPage=null,comparison=null,
    comparisonPage=null,publication=null,receivedBundle=null,featureOffset=0,comparisonOffset=0,selectedFeature=null;
const catalogs=new Map(),schemaModels=new Map(),pageSize=100;
const tokenKey='stellar-forge.wfs-session:'+location.origin;
const fragment=location.hash.slice(1);
if(/^[a-f0-9]{64}$/.test(fragment)){sessionStorage.setItem(tokenKey,fragment);history.replaceState(null,'',location.pathname+location.search);}
const token=sessionStorage.getItem(tokenKey);
const notice=(message,error=false)=>{$('notice').textContent=message;$('notice').dataset.error=String(error);};
function element(tag,value,className){const node=document.createElement(tag);if(value!==undefined)node.textContent=text(value);if(className)node.className=className;return node;}
function button(label,work){const node=element('button',label);node.type='button';node.addEventListener('click',()=>perform(work));return node;}
function cell(value){const node=document.createElement('td');if(value instanceof Node)node.append(value);else node.textContent=text(value);return node;}
function descriptive(main,detail){const node=element('div',main);if(detail)node.append(element('small',detail));return node;}
function toolbar(...buttons){const node=element('div',undefined,'toolbar');node.append(...buttons.filter(Boolean));return node;}
function table(target,rows,count,empty){const body=$(target);body.replaceChildren();if(!rows.length){const row=document.createElement('tr'),value=cell(empty);value.colSpan=count;value.className='empty';row.append(value);body.append(row);return;}
  for(const values of rows){const row=document.createElement('tr');row.append(...values.map(cell));body.append(row);}}
function facts(target,values){const root=$(target);root.replaceChildren();for(const[label,value]of values){const group=document.createElement('div');group.append(element('dt',label),element('dd',value));root.append(group);}}
function options(target,items,placeholder='Choose a record'){const select=$(target),previous=select.value;select.replaceChildren();
  select.append(new Option(placeholder,''));for(const item of items)select.append(new Option(item.label,item.id));
  if(items.some(item=>item.id===previous))select.value=previous;}
function section(name){for(const node of all('main>.panel'))node.hidden=node.id!==name;for(const node of all('nav>[data-section]')){if(node.dataset.section===name)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');}}
async function api(path,body,{download=false}={}) {
  if(!token)throw Error('Open the complete private workspace URL printed by the running application.');
  const response=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:{
    authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok){const value=await response.json().catch(()=>({message:'The application returned HTTP '+response.status}));
    const error=Error(value.message??value.error?.message??'The application returned HTTP '+response.status);
    error.code=value.code??value.error?.code;error.details=value;throw error;}
  return download?response:response.json();
}
const query=(kind,input={})=>api('/api/query',{kind,input});
const action=(name,input={})=>api('/api/action',{action:name,...input});
const sourceAction=(name,input={})=>{
  if(state?.project.pending)throw Error('Resume or abandon the current source operation in Operation history.');
  return action(name,{id:id(name),expectedRevision:state.project.revision,...input});
};
async function download(kind,input={}) {
  const response=await api('/api/download',{kind,input},{download:true}),blob=await response.blob();
  const name=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')??'')?.[1]??kind+'.json';
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);return{file:name,bytes:blob.size,sha256:response.headers.get('x-content-sha256')};
}
function addWindow(value,label='Open workspace'){if(!value?.url)return;const target=new URL(value.url);
  if(target.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(target.hostname))throw Error('The workspace returned an unsupported browser address.');
  const link=element('a',label);link.href=target.href;link.target='_blank';link.rel='noopener noreferrer';$('window-links').append(link);
  window.open(target.href,'_blank','noopener,noreferrer');
}
async function perform(work,{target='operation-result',message='Operation completed.'}={}) {
  if(working){notice('The current action is still running. Its state appears in Operation history.');return;}
  working=true;document.body.setAttribute('aria-busy','true');notice('Working…');
  try{const result=await work();if(result!==undefined)$(target).textContent=stringify(result);notice(message);return result;}
  catch(error){$(target).textContent=stringify(error.details??{code:error.code,message:error.message});notice(error.message,true);}
  finally{working=false;document.body.removeAttribute('aria-busy');try{await refresh();}catch(error){notice(error.message,true);}}
}
function integer(target,{optional=false}={}){const value=$(target).value.trim();if(optional&&!value)return undefined;
  if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('Enter a whole number in '+$(target).closest('label').firstChild.textContent.trim()+'.');
  return Number(value);}
function parseJson(target,{optional=false}={}){const value=$(target).value.trim();if(optional&&!value)return undefined;
  try{return JSON.parse(value);}catch{throw Error('Enter valid JSON in '+$(target).closest('label').firstChild.textContent.trim()+'.');}}
function selected(target,label='record'){const value=$(target).value;if(!value)throw Error('Choose the '+label+'.');return value;}
function acquisitionLimits(){return Object.fromEntries([['pageBytes','order-page-bytes'],['totalBytes','order-total-bytes'],
  ['maxPages','order-max-pages'],['requestTimeoutMs','order-timeout']].map(([key,target])=>[key,integer(target,{optional:true})]).filter(([,v])=>v!==undefined));}
function draftKey(){return 'stellar-forge.wfs-customer:'+state.project.id;}
const draftFields=['customer-publication','customer-kind','customer-query','customer-intent','customer-dataset','customer-max-pages','customer-max-rows','customer-max-atomic'];
let draftProject=null;
function saveDraft(){if(!state)return;sessionStorage.setItem(draftKey(),JSON.stringify(Object.fromEntries(draftFields.map(key=>[key,$(key).value]))));}
function restoreDraft(){if(draftProject===state.project.id)return;draftProject=state.project.id;let value;
  try{value=JSON.parse(sessionStorage.getItem(draftKey())??'{}');}catch{value={};}
  for(const key of draftFields)if(typeof value[key]==='string')$(key).value=value[key];
  if(!$('customer-intent').value)$('customer-intent').value=id('request');
  if(!$('customer-dataset').value)$('customer-dataset').value=id('dataset');
  saveDraft();
}
function renderState(){
  const project=state.project;
  $('project-title').textContent=project.name;$('revision').textContent='Revision '+project.revision;
  for(const[key,value]of[['source-count',project.sources.length],['query-count',project.queries.length],
    ['order-count',project.orders.length],['publication-count',project.publications.length]])$(key).textContent=value;
  $('auth-state').textContent=state.sourceAuthConfigured?'Source access: configured':'Source access: public';
  $('buyer-state').textContent=state.buyerConfigured?'Buyer: configured':'Buyer: select a private configuration at launch';
  table('services-body',project.sources.map(row=>[descriptive(row.name,row.endpoint),row.featureTypes,row.capturedAt,
    button('Open catalog',()=>openCatalog(row.id))]),4,'Add a service to capture its catalog.');
  table('queries-body',project.queries.map(row=>[descriptive(row.name,short(row.id)),row.config.wfs.typeName,row.config.wfs.srsName,
    row.config.wfs.sortBy.map(x=>x.property+' '+x.direction).join(', '),button('Create order',async()=>{
      $('order-query').value=row.id;$('order-name').value=row.name+' '+new Date().toISOString().slice(0,16);section('orders');})]),5,'Saved source queries will appear here.');
  table('orders-body',project.orders.map(row=>{
    const progress=project.pending?.progress?.orderId===row.id?project.pending.progress:{};
    return[descriptive(row.name,short(row.id)),row.state,row.rows??progress.rows??'—',row.pages??progress.pages??'—',
      toolbar(button('Open',()=>openOrder(row.id)),row.state==='READY'?button('Publish',async()=>{$('publication-order').value=row.id;section('publication');await loadPlan();}):
        project.pending?.kind==='run-order'&&project.pending.payload.queryId===row.queryId&&project.pending.progress?.orderId===row.id?button('Resume',resumePending):null)];
  }),6,'Create an order from a saved query.');
  table('comparisons-body',project.comparisons.map(row=>[descriptive(short(row.id),short(row.before)+' → '+short(row.after)),
    row.counts.added,row.counts.removed,row.counts.changed,row.counts.unchanged,button('Review',()=>openComparison(row.id))]),6,'Complete edition comparisons will appear here.');
  table('publications-body',project.publications.map(row=>[descriptive(project.orders.find(x=>x.id===row.orderId)?.name??short(row.id),short(row.id)),
    row.rows,short(row.snapshot),toolbar(button('Open edition',()=>openPublication(row.id)),row.merchantConfigured?button('Customer',async()=>{
      $('customer-publication').value=row.id;saveDraft();section('customer');await customerHistory();}):null)]),4,'Publish a complete order to create an edition.');
  options('query-schema',project.schemas.map(row=>({id:row.id,label:row.typeName+' · '+(project.sources.find(x=>x.id===row.sourceId)?.name??short(row.sourceId))})));
  options('order-query',project.queries.map(row=>({id:row.id,label:row.name})));
  const ready=project.orders.filter(row=>row.state==='READY').map(row=>({id:row.id,label:row.name+' · '+short(row.id)}));
  for(const target of['compare-before','compare-after','publication-order'])options(target,ready);
  options('customer-publication',project.publications.filter(row=>row.merchantConfigured).map(row=>({id:row.id,label:(project.orders.find(x=>x.id===row.orderId)?.name??'Edition')+' · '+short(row.id)})));
  restoreDraft();renderPending();
  table('history-body',[...project.operations].reverse().map(row=>[row.id,row.kind,row.completedAt,button('Inspect',async()=>row)]),4,'Completed operations will appear here.');
}
function renderPending(){
  const pending=state.project.pending,busy=state.busy;$('pending-panel').hidden=!pending&&!busy;
  if(pending||busy)facts('pending-summary',[
    ['Action',busy?.action??pending?.kind],['Original operation',pending?.id??busy?.id],['Started',pending?.startedAt??busy?.startedAt],
    ['Source state',pending?.state??(busy?'RUNNING':'SAVED')],['Retained progress',pending?.progress??'—'],['Last error',pending?.lastError??'—']]);
  $('pending-resume').disabled=!pending||Boolean(busy);$('pending-cancel').disabled=!busy;$('pending-abandon').disabled=!pending||Boolean(busy);
}
async function refresh(){
  if(refreshing)return refreshing;
  refreshing=(async()=>{state=await api('/api/state');renderState();return state;})();
  try{return await refreshing;}finally{refreshing=null;}
}
async function catalog(sourceId){
  if(catalogs.has(sourceId))return catalogs.get(sourceId);
  let offset=0,record,features=[];
  do{const page=await query('catalog',{sourceId,offset,limit:1000});record??=page;features.push(...page.featureTypes);
    offset=page.nextOffset;if(offset!==null&&(!Number.isSafeInteger(offset)||offset<=page.offset))throw Error('The catalog page did not advance.');
  }while(offset!==null);
  const value={...record,featureTypes:features};catalogs.set(sourceId,value);return value;
}
function renderTypes(){if(!service)return;const search=$('type-filter').value.toLocaleLowerCase();
  const rows=service.featureTypes.filter(row=>(row.name+' '+row.title).toLocaleLowerCase().includes(search));
  table('types-body',rows.map(row=>[row.name,row.title,row.defaultCrs,button('Capture schema',async()=>{
    const result=await sourceAction('describe',{sourceId:service.source.id,typeName:row.name});await refresh();await openSchema(result.schema.id);return result;
  })]),4,'No feature types match this search.');
}
async function openCatalog(sourceId){
  service=await catalog(sourceId);$('catalog-panel').hidden=false;$('catalog-title').textContent=service.source.name;
  facts('catalog-summary',[['Service',service.service.title],['Feature types',service.total],['Version',service.service.version??'2.0.0'],
    ['Fees',service.service.fees??'—'],['Access constraints',service.service.accessConstraints??'—'],['Recorded attribution',service.source.terms]]);
  renderTypes();section('services');return{source:service.source.id,featureTypes:service.featureTypes.length};
}
async function openSchema(schemaId){
  schema=await query('schema',{schemaId});schemaModels.set(schemaId,schema);$('schema-panel').hidden=false;
  $('schema-title').textContent=schema.schema.typeName;
  table('schema-body',schema.schema.properties.map(row=>[row.name,row.type,row.minOccurs+'…'+row.maxOccurs,
    row.nillable?'Yes':'No',row.geometry?'Yes':'—']),5,'The selected source schema has no properties.');
  section('services');return{schema:schema.schema.id,typeName:schema.schema.typeName,properties:schema.schema.properties.length};
}
async function selectSchema(){
  const schemaId=$('query-schema').value;if(!schemaId)return;
  const record=state.project.schemas.find(x=>x.id===schemaId);if(!record)throw Error('The selected schema is unavailable.');
  const captured=await catalog(record.sourceId),feature=captured.featureTypes.find(x=>x.name===record.typeName);
  if(!feature)throw Error('The original feature type is unavailable in the captured catalog.');
  const values=[...new Set([feature.defaultCrs,...feature.otherCrs].filter(Boolean))].map(value=>({id:value,label:value}));
  for(const target of['query-crs','query-bbox-crs']){options(target,values,'Choose a source CRS');if(!$(target).value&&values.length)$(target).value=values[0].id;}
  const scalar=record.properties.filter(row=>!row.geometry&&row.maxOccurs==='1');
  $('query-sort').placeholder=scalar.length?scalar.slice(0,3).map(row=>row.name+' A').join(', '):'A scalar source property and direction';
  if(!$('query-name').value)$('query-name').value=feature.title||feature.name;
}
function selectionInput(){
  const schemaId=selected('query-schema','captured schema'),record=state.project.schemas.find(x=>x.id===schemaId);
  const sortBy=$('query-sort').value.split(',').map(value=>{
    const match=/^\s*([^\s,]+)\s+([AD])\s*$/i.exec(value);if(!match)throw Error('Enter each sort property followed by A or D, separated by commas.');
    return{property:match[1],direction:match[2].toUpperCase()};
  });
  const bbox=$('query-bbox').value.trim(),cql=$('query-cql').value.trim();
  return{sourceId:record.sourceId,schemaId,name:$('query-name').value.trim(),selection:{
    version:'2.0.0',typeName:record.typeName,srsName:selected('query-crs','response CRS'),pageSize:integer('query-size'),sortBy,
    ...(bbox?{bbox:bbox.split(',').map(value=>value.trim()),bboxCrs:selected('query-bbox-crs','bounding box CRS')}:{ }),
    ...(cql?{cqlFilter:cql}:{})}};
}
async function openOrder(orderId,{offset=0}={}){
  order=await query('order',{orderId});featureOffset=offset;$('order-panel').hidden=false;$('order-title').textContent=order.order.name;
  facts('order-summary',[['State',order.order.state],['Rows',order.rows],['Pages',order.pages],['Source CRS',order.selection.srsName],
    ['Bytes',order.bytes],['Received',String(order.firstReceivedAt??'—')+' → '+String(order.lastReceivedAt??'—')],
    ['Type',order.selection.typeName],['Sort',order.selection.sortBy.map(x=>x.property+' '+x.direction).join(', ')],['Next source page',order.next??'Complete']]);
  $('raw-page-index').max=String(Math.max(0,order.pages-1));$('raw-page-download').disabled=!order.pages;
  await featuresPage();section('orders');return{order:order.order.id,rows:order.rows,pages:order.pages,complete:order.complete};
}
async function featuresPage(){
  if(!order)return;orderPage=await query('features',{orderId:order.order.id,offset:featureOffset,limit:pageSize});selectedFeature=null;
  $('features-page').textContent=orderPage.total?String(featureOffset+1)+'–'+Math.min(featureOffset+orderPage.features.length,orderPage.total)+' of '+orderPage.total:'0 features';
  $('features-previous').disabled=featureOffset===0;$('features-next').disabled=featureOffset+orderPage.features.length>=orderPage.total;
  const keys=[...new Set(orderPage.features.flatMap(row=>Object.keys(row.properties??{})))];
  const head=document.createElement('tr');head.append(...['Feature ID',...keys,'Geometry'].map(value=>element('th',value)));$('feature-head').replaceChildren(head);
  table('feature-body',orderPage.features.map((row,index)=>[
    button(text(row.id??'Feature '+(featureOffset+index+1)),async()=>selectFeature(index)),...keys.map(key=>text(row.properties?.[key])),row.geometry?.type??'—'
  ]),keys.length+2,'This order has no captured features in this page.');
  $('feature-json').value='';drawGeometry();if(orderPage.features.length)selectFeature(0);
}
function selectFeature(index){selectedFeature=index;$('feature-json').value=orderPage.features[index].featureJson;
  [...$('feature-body').children].forEach((row,i)=>row.classList.toggle('selected',i===index));drawGeometry();
  return{featureId:orderPage.features[index].id??null,ordinal:featureOffset+index};
}
function visitGeometry(geometry,point,line,polygon){
  if(!geometry)return;
  switch(geometry.type){
    case'Point':point(geometry.coordinates);break;case'MultiPoint':geometry.coordinates.forEach(point);break;
    case'LineString':line(geometry.coordinates);break;case'MultiLineString':geometry.coordinates.forEach(line);break;
    case'Polygon':polygon(geometry.coordinates);break;case'MultiPolygon':geometry.coordinates.forEach(polygon);break;
    case'GeometryCollection':geometry.geometries.forEach(value=>visitGeometry(value,point,line,polygon));break;
  }
}
function drawGeometry(){
  const canvas=$('geometry'),ctx=canvas.getContext('2d'),rows=orderPage?.features??[];ctx.clearRect(0,0,canvas.width,canvas.height);
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,points=0;
  const scan=coordinate=>{const x=Number(coordinate?.[0]),y=Number(coordinate?.[1]);if(!Number.isFinite(x)||!Number.isFinite(y))return;
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);points++;};
  for(const row of rows)visitGeometry(row.geometry,scan,values=>values.forEach(scan),rings=>rings.forEach(ring=>ring.forEach(scan)));
  if(!points){ctx.fillStyle='#666';ctx.font='14px system-ui';ctx.fillText('No renderable geometry in this page',28,45);
    $('geometry-caption').textContent='Original feature JSON remains available for every retained row.';return;}
  const margin=28,w=canvas.width-margin*2,h=canvas.height-margin*2,spanX=maxX-minX,spanY=maxY-minY,
    scale=Math.min(w/(spanX||1),h/(spanY||1)),offsetX=(canvas.width-spanX*scale)/2,offsetY=(canvas.height-spanY*scale)/2;
  const xy=coordinate=>[offsetX+(Number(coordinate[0])-minX)*scale,canvas.height-offsetY-(Number(coordinate[1])-minY)*scale];
  const path=coordinates=>{let started=false;for(const coordinate of coordinates){const[x,y]=xy(coordinate);
    if(!Number.isFinite(x)||!Number.isFinite(y)){started=false;continue;}if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);}};
  for(let i=0;i<rows.length;i++){
    const chosen=i===selectedFeature;ctx.strokeStyle=chosen?'#111':'#777';ctx.fillStyle=chosen?'#85857d':'#d3d3cd';ctx.lineWidth=chosen?2:1;
    visitGeometry(rows[i].geometry,coordinate=>{const[x,y]=xy(coordinate);if(!Number.isFinite(x)||!Number.isFinite(y))return;
      ctx.beginPath();ctx.arc(x,y,chosen?4:2.5,0,Math.PI*2);ctx.fill();ctx.stroke();},
      coordinates=>{ctx.beginPath();path(coordinates);ctx.stroke();},
      rings=>{ctx.beginPath();for(const ring of rings){path(ring);ctx.closePath();}ctx.fill('evenodd');ctx.stroke();});
  }
  $('geometry-caption').textContent='Showing '+rows.length+' features in this page, in the source coordinate order. CRS: '+(order?.selection.srsName??'—')+
    '. Display bounds: '+[minX,minY,maxX,maxY].join(', ')+'. Select a feature to read its original numeric values.';
}
async function openComparison(comparisonId){comparison=comparisonId;comparisonOffset=0;await comparisonsPage();section('comparison');return{comparisonId};}
async function comparisonsPage(){
  if(!comparison)return;comparisonPage=await query('comparison',{comparisonId:comparison,kind:$('comparison-group').value,offset:comparisonOffset,limit:pageSize});
  $('comparison-panel').hidden=false;const counts=comparisonPage.counts;
  facts('comparison-summary',[
    ['Added',counts.added],['Removed',counts.removed],['Changed',counts.changed],['Unchanged',counts.unchanged],['Duplicate keys',counts.ambiguousKeys],
    ['Missing earlier / later keys',counts.missingBefore+' / '+counts.missingAfter],['Key pointer',comparisonPage.keyPointer],
    ['Queries',comparisonPage.sourceSelectionsEqual?'Same source selection':'Different source selections'],
    ['Retrieval windows',comparisonPage.retrievalWindows]]);
  $('comparison-page').textContent=comparisonPage.total?String(comparisonOffset+1)+'–'+Math.min(comparisonOffset+comparisonPage.rows.length,comparisonPage.total)+' of '+comparisonPage.total:'0 records';
  $('comparison-previous').disabled=comparisonOffset===0;$('comparison-next').disabled=comparisonPage.nextOffset===null;
  const feature=value=>value===undefined?'—':stringify(Array.isArray(value)?value.map(row=>row.feature??row):value.feature??value);
  table('comparison-body',comparisonPage.rows.map(row=>[
    row.key??'Missing key',element('pre',feature(row.before??(comparisonPage.group==='missingBefore'?row:undefined)),'output'),
    element('pre',feature(row.after??(comparisonPage.group==='missingAfter'?row:undefined)),'output')]),3,'This comparison group has no records.');
}
async function loadPlan(){const orderId=selected('publication-order','complete order');const plan=await query('plan',{orderId});$('publication-plan').value=stringify(plan);return plan;}
async function openPublication(publicationId){
  publication=await query('publication',{publicationId});$('publication-panel').hidden=false;
  $('publication-title').textContent='Edition '+short(publicationId);
  facts('publication-summary',[['Rows',publication.publication.rows],['Dataset snapshot',publication.publication.snapshot],
    ['Created',publication.publication.createdAt],['Merchant',publication.publication.merchantConfigured?'Configured':'No payment configured'],
    ['Source project snapshot',publication.merchant?.edition.sourceSetId??'Prepared when merchant starts'],
    ['Merchant address',state.merchant?.publicationId===publicationId?state.merchant.url:'Stopped']]);
  $('merchant-start').disabled=!publication.publication.merchantConfigured;
  $('merchant-stop').disabled=state.merchant?.publicationId!==publicationId;
  section('publication');return{publication:publicationId,rows:publication.publication.rows,snapshot:publication.publication.snapshot};
}
const publicationId=()=>{if(!publication)throw Error('Open a dataset edition.');return publication.publication.id;};
const customerBase=()=>({publicationId:selected('customer-publication','merchant edition')});
const datasetBase=()=>({...customerBase(),id:selected('customer-dataset','original acquisition ID')});
const requestBase=()=>({...customerBase(),intentId:selected('customer-intent','original request ID')});
async function customerHistory(){
  const publicationId=$('customer-publication').value;if(!publicationId){table('customer-history',[],4,'Choose a merchant edition.');return;}
  const record=await query('publication',{publicationId});
  table('customer-history',record.customers.map(row=>[row.id,row.kind,row.product,button('Select',async()=>{
    $('customer-kind').value=row.product;$(row.kind==='request'?'customer-intent':'customer-dataset').value=row.id;
    if(row.limits){if(row.limits.maxPages!==undefined)$('customer-max-pages').value=row.limits.maxPages;
      if(row.limits.maxRows!==undefined)$('customer-max-rows').value=row.limits.maxRows;
      if(row.limits.maxTotalAtomic!==undefined)$('customer-max-atomic').value=row.limits.maxTotalAtomic;}
    saveDraft();$('customer-result').textContent=stringify(row);return row;
  })]),4,'Prepared customer requests and complete acquisitions will appear here.');
}
async function customerAction(name,input){saveDraft();const result=await action(name,input);$('customer-result').textContent=stringify(result);await customerHistory();return result;}
async function resumePending(){
  const current=await refresh(),pending=current.project.pending;if(!pending)throw Error('This project has no unfinished source operation.');
  if(current.busy)throw Error('The original action is still running.');
  const result=await action(pending.kind,{id:pending.id,expectedRevision:pending.expectedRevision,...pending.payload,
    ...(pending.kind==='run-order'?{limits:acquisitionLimits()}:{})});
  await refresh();if(result.order)await openOrder(result.order.id);return result;
}
for(const node of all('nav>[data-section]'))node.addEventListener('click',()=>{section(node.dataset.section);
  if(node.dataset.section==='customer')void perform(customerHistory,{message:'Customer records refreshed.'});});
$('refresh').addEventListener('click',()=>perform(refresh,{message:'Project refreshed.'}));
$('service-form').addEventListener('submit',event=>{event.preventDefault();void perform(async()=>{
  const result=await sourceAction('discover',{name:$('service-name').value.trim(),endpoint:$('service-endpoint').value.trim(),terms:$('service-terms').value});
  await refresh();await openCatalog(result.source.id);return result;
},{message:'Original service catalog captured.'});});
$('type-filter').addEventListener('input',renderTypes);
$('capabilities-download').addEventListener('click',()=>perform(()=>{if(!service)throw Error('Open a catalog.');return download('capabilities',{sourceId:service.source.id});}));
$('schema-download').addEventListener('click',()=>perform(()=>{if(!schema)throw Error('Open a schema.');return download('schema',{schemaId:schema.schema.id});}));
$('use-schema').addEventListener('click',()=>perform(async()=>{if(!schema)throw Error('Open a schema.');$('query-schema').value=schema.schema.id;await selectSchema();section('queries');}));
$('query-schema').addEventListener('change',()=>perform(selectSchema,{message:'Original schema selected.'}));
$('query-form').addEventListener('submit',event=>{event.preventDefault();void perform(async()=>{
  const result=await sourceAction('save-query',selectionInput());await refresh();$('order-query').value=result.query.id;
  $('order-name').value=result.query.name+' '+new Date().toISOString().slice(0,16);section('orders');return result;
},{message:'Source query saved.'});});
$('order-form').addEventListener('submit',event=>{event.preventDefault();void perform(async()=>{
  const result=await sourceAction('run-order',{queryId:selected('order-query','saved query'),name:$('order-name').value.trim(),limits:acquisitionLimits()});
  await refresh();await openOrder(result.order.id);return result;
},{message:'Complete source order acquired.'});});
$('features-previous').addEventListener('click',()=>perform(async()=>{featureOffset=Math.max(0,featureOffset-pageSize);await featuresPage();}));
$('features-next').addEventListener('click',()=>perform(async()=>{featureOffset+=pageSize;await featuresPage();}));
$('features-download').addEventListener('click',()=>perform(()=>download('features',{orderId:order.order.id})));
$('raw-page-download').addEventListener('click',()=>perform(()=>download('raw-page',{orderId:order.order.id,index:integer('raw-page-index')})));
$('compare-form').addEventListener('submit',event=>{event.preventDefault();void perform(async()=>{
  const result=await sourceAction('compare',{before:selected('compare-before','earlier order'),after:selected('compare-after','later order'),keyPointer:$('compare-key').value});
  await refresh();await openComparison(result.comparison.id);return result;
},{message:'Complete editions compared.'});});
$('comparison-group').addEventListener('change',()=>perform(async()=>{comparisonOffset=0;await comparisonsPage();}));
$('comparison-previous').addEventListener('click',()=>perform(async()=>{comparisonOffset=Math.max(0,comparisonOffset-pageSize);await comparisonsPage();}));
$('comparison-next').addEventListener('click',()=>perform(async()=>{comparisonOffset=comparisonPage.nextOffset;await comparisonsPage();}));
$('comparison-download').addEventListener('click',()=>perform(()=>download('comparison',{comparisonId:comparison})));
$('load-plan').addEventListener('click',()=>perform(loadPlan));
$('publication-paid').addEventListener('change',()=>{$('payment-fields').hidden=!$('publication-paid').checked;});
$('publication-form').addEventListener('submit',event=>{event.preventDefault();void perform(async()=>{
  const paid=$('publication-paid').checked;
  const result=await sourceAction('export-order',{orderId:selected('publication-order','complete order'),plan:parseJson('publication-plan',{optional:true}),
    ...(paid?{origin:$('publication-origin').value.trim(),path:$('publication-path').value.trim(),payment:parseJson('publication-payment')}:{})});
  await refresh();await openPublication(result.publication.id);return result;
},{message:'Complete dataset edition created.'});});
$('publication-open').addEventListener('click',()=>perform(async()=>{const result=await action('publication-open',{publicationId:publicationId()});addWindow(result,'Open dataset workspace');return result;}));
$('merchant-start').addEventListener('click',()=>perform(async()=>{const selected=publicationId(),result=await action('merchant-start',{publicationId:selected});
  await refresh();await openPublication(selected);return result;},{message:'Configured merchant is running.'}));
$('merchant-stop').addEventListener('click',()=>perform(async()=>{const selected=publicationId(),result=await action('merchant-stop',{publicationId:selected});
  await refresh();await openPublication(selected);return result;},{message:'Merchant stopped.'}));
$('preview-form').addEventListener('submit',event=>{event.preventDefault();void perform(()=>query('preview',{publicationId:publicationId(),kind:$('preview-kind').value,query:$('preview-query').value}),{target:'preview-result',message:'Native dataset query previewed.'});});
for(const key of draftFields)$(key).addEventListener('change',saveDraft);
$('customer-publication').addEventListener('change',()=>perform(customerHistory,{message:'Customer records loaded.'}));
$('new-intent').addEventListener('click',()=>{$('customer-intent').value=id('request');saveDraft();notice('New request ID selected. Existing requests remain in saved customer records.');});
$('new-dataset').addEventListener('click',()=>{$('customer-dataset').value=id('dataset');saveDraft();notice('New acquisition ID selected. Existing acquisitions remain in saved customer records.');});
$('purchase-prepare').addEventListener('click',()=>perform(()=>customerAction('prepare',{...requestBase(),kind:$('customer-kind').value,query:$('customer-query').value}),{target:'customer-result',message:'Native request prepared.'}));
for(const[name,actionName]of[['purchase-buy','buy'],['purchase-recover','recover']])$(name).addEventListener('click',()=>perform(()=>customerAction(actionName,requestBase()),{target:'customer-result',message:actionName==='buy'?'Prepared request completed.':'Original request recovered.'}));
$('purchase-download').addEventListener('click',()=>perform(()=>download('customer',requestBase()),{target:'customer-result'}));
$('dataset-prepare').addEventListener('click',()=>perform(()=>{
  const maxTotalAtomic=$('customer-max-atomic').value.trim();if(!/^\d+$/.test(maxTotalAtomic))throw Error('Set the complete acquisition budget in atomic payment units.');
  return customerAction('dataset-prepare',{...datasetBase(),kind:$('customer-kind').value,query:$('customer-query').value,
    maxPages:integer('customer-max-pages'),maxRows:integer('customer-max-rows'),maxTotalAtomic});
},{target:'customer-result',message:'Complete acquisition prepared with the saved budget.'}));
$('dataset-run').addEventListener('click',()=>perform(async()=>{const base=datasetBase();await customerAction('dataset-create',base);
  return customerAction('dataset-run',base);},{target:'customer-result',message:'Remaining dataset pages acquired.'}));
for(const name of['dataset-inspect','dataset-recover','dataset-deliver','dataset-accounting','dataset-finalize'])
  $(name).addEventListener('click',()=>perform(()=>customerAction(name,datasetBase()),{target:'customer-result'}));
$('dataset-receive').addEventListener('click',()=>perform(async()=>{
  if($('customer-kind').value!=='sources')throw Error('Select the complete project source product and its prepared acquisition.');
  const base=datasetBase();await customerAction('dataset-deliver',base);const received=await customerAction('dataset-receive',base);
  const reopened=await customerAction('customer-reopen',base),opened=await customerAction('customer-open',base);
  addWindow(opened,'Open delivered source project');return{received,reopened,opened};
},{target:'customer-result',message:'Complete source project received and reopened.'}));
$('dataset-download').addEventListener('click',()=>perform(()=>download('dataset',{...datasetBase(),file:$('dataset-file').value}),{target:'customer-result'}));
$('project-download').addEventListener('click',()=>perform(()=>download('project'),{target:'transfer-result',message:'Complete project downloaded.'}));
$('project-file').addEventListener('change',()=>{receivedBundle=null;$('project-open').disabled=true;});
$('project-receive').addEventListener('click',()=>perform(async()=>{
  const file=$('project-file').files[0];if(!file)throw Error('Choose the complete project file.');
  if(file.size>384*1024*1024)throw Error('The project file exceeds the configured receiving capacity.');
  const bundle=JSON.parse(await file.text()),result=await action('project-receive',{bundle});
  receivedBundle=bundle.bundleSha256;$('project-open').disabled=false;return result;
},{target:'transfer-result',message:'Complete project received.'}));
$('project-open').addEventListener('click',()=>perform(async()=>{if(!receivedBundle)throw Error('Receive the complete project first.');
  const result=await action('project-open',{bundleSha256:receivedBundle});addWindow(result,'Open received project');return result;},{target:'transfer-result'}));
$('pending-resume').addEventListener('click',()=>perform(resumePending,{message:'Original source operation completed.'}));
$('pending-cancel').addEventListener('click',async()=>{try{const latest=await api('/api/state');if(!latest.busy)throw Error('No application action is running.');
  const result=await api('/api/cancel',{id:latest.busy.id});$('operation-result').textContent=stringify(result);notice('Cancellation requested. Retained progress will remain available.');
}catch(error){notice(error.message,true);}});
$('pending-abandon').addEventListener('click',()=>perform(async()=>{
  const current=await refresh(),pending=current.project.pending;if(!pending)throw Error('No source operation is pending.');
  const note=$('abandon-note').value.trim();if(!note)throw Error('Record a short note for abandoning this operation.');
  return action('abandon',{id:id('abandon'),expectedRevision:current.project.revision,pendingId:pending.id,note});
},{message:'Operation abandoned and original progress retained.'}));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh().catch(error=>notice(error.message,true));});
setInterval(()=>{if(!document.hidden)void refresh().catch(error=>notice(error.message,true));},2500);
void refresh().then(()=>notice('Project ready.')).catch(error=>notice(error.message,true));
